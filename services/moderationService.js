const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { query, withTransaction } = require('../database/mariadb');
const { clearUserRedisKeys } = require('../database/redis');
const { STARTER_PACK } = require('../data/constants');
const { COLORS, formatLp, buildV2Card } = require('../utils/uiBuilder');

const MAX_WARNINGS_BEFORE_AUTOBAN = 3;

function safeJsonParse(str, fallback = {}) {
    if (!str) return fallback;
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

/**
 * Mencatat aktivitas atau tindakan moderasi pemain ke tabel player_activity_logs.
 */
async function logPlayerActivity(connOrNull, discordId, category, action, details = {}, now = Date.now()) {
    if (!discordId || !action) return;
    const sql = `
        INSERT INTO player_activity_logs (discord_id, category, action, details, created_at)
        VALUES (?, ?, ?, ?, ?)
    `;
    const params = [
        String(discordId),
        String(category || 'general').slice(0, 32),
        String(action).slice(0, 64),
        JSON.stringify(details || {}),
        now
    ];

    try {
        if (connOrNull && typeof connOrNull.execute === 'function') {
            await connOrNull.execute(sql, params);
        } else {
            await query(sql, params);
        }
    } catch {
        // Jangan gagalkan transaksi utama jika pencatatan log mengalami kendala
    }
}

/**
 * Fungsi murni (pure function) untuk menghitung skor & indikator mencurigakan (Red Flags)
 * dari metrik transaksi dan profil pemain.
 */
function computeSusFlagsFromMetrics({
    accountAgeHours = 999,
    totalWealth = 0,
    payIn7d = 0,
    payOut7d = 0,
    payTxCount7d = 0,
    topPartnerId = null,
    topPartnerAmount = 0,
    topPartnerTxCount = 0,
    faucet24h = 0,
    activeWarnings = 0
}) {
    let score = 0;
    const flags = [];
    const totalPayVolume = Number(payIn7d || 0) + Number(payOut7d || 0);

    // 1. Konsentrasi transfer /pay dengan 1 akun tertentu (indikasi akun tuyul / joki)
    if (topPartnerId && topPartnerAmount >= 150000 && (topPartnerTxCount >= 3 || topPartnerAmount >= totalPayVolume * 0.6)) {
        score += 40;
        flags.push(
            `🔁 **Pusaran Transfer \`/pay\`:** ${topPartnerTxCount}× transaksi senilai **${formatLp(topPartnerAmount)}** dengan <@${topPartnerId}> (7 hari terakhir).`
        );
    } else if (totalPayVolume >= 400000 && payTxCount7d >= 4) {
        score += 25;
        flags.push(
            `💸 **Volume \`/pay\` Tinggi:** ${payTxCount7d}× transfer dengan total perputaran **${formatLp(totalPayVolume)}** (7 hari).`
        );
    }

    // 2. Akun baru (< 72 jam) sudah menerima/mengirim transfer besar
    if (accountAgeHours <= 72 && totalPayVolume >= 150000) {
        score += 35;
        flags.push(
            `🐣 **Akun Baru (< 3 Hari) Transfer Besar:** Umur akun baru ~${Math.max(1, Math.round(accountAgeHours))} jam namun sudah terlibat transfer **${formatLp(totalPayVolume)}**.`
        );
    }

    // 3. Rasio uang masuk /pay mendominasi total harta saat ini
    if (payIn7d >= 200000 && totalWealth > 0 && payIn7d >= totalWealth * 0.75) {
        score += 25;
        flags.push(
            `📥 **Mayoritas Harta dari Transfer:** Menerima **${formatLp(payIn7d)}** via \`/pay\` dibanding total kekayaan **${formatLp(totalWealth)}**.`
        );
    }

    // 4. Lonjakan pemasukan Faucet 24 jam terakhir
    if (faucet24h >= 1500000) {
        score += 30;
        flags.push(
            `📈 **Lonjakan Faucet 24 Jam:** Mencetak **+${formatLp(faucet24h)}** dari aktivitas sistem dalam 24 jam terakhir.`
        );
    }

    // 5. Riwayat Warning Aktif
    if (activeWarnings > 0) {
        score += activeWarnings * 20;
        flags.push(
            `⚠️ **Memiliki Warning Aktif:** **${activeWarnings}/${MAX_WARNINGS_BEFORE_AUTOBAN} Strike** pelanggaran tercatat.`
        );
    }

    let level = 'low';
    let badge = '🟢 AMAN / WAJAR';
    if (score >= 60) {
        level = 'high';
        badge = '🔴 MENCURIGAKAN (SUS)';
    } else if (score >= 25) {
        level = 'medium';
        badge = '🟡 PERLU DIPANTAU';
    }

    return {
        score: Math.min(100, score),
        level,
        badge,
        flags
    };
}

/**
 * Menganalisis profil dan riwayat transaksi pemain untuk mendeteksi indikasi kecurangan/akun tuyul.
 */
async function getPlayerSusAnalysis(discordId, now = Date.now()) {
    const since24h = now - 86400000;
    const since7d = now - 7 * 86400000;

    const [playerRows, payRows, faucetRows, warnRows] = await Promise.all([
        query(`SELECT cash, bank, created_at FROM players WHERE discord_id = ? LIMIT 1`, [discordId]),
        query(
            `SELECT source, amount, meta FROM economy_ledger
             WHERE discord_id = ? AND source IN ('pay_in', 'pay_out') AND created_at >= ?`,
            [discordId, since7d]
        ),
        query(
            `SELECT COALESCE(SUM(amount), 0) AS faucet_24h
             FROM economy_ledger
             WHERE discord_id = ? AND type = 'faucet' AND created_at >= ?`,
            [discordId, since24h]
        ),
        query(
            `SELECT id, reason, admin_id, created_at, dm_sent, is_acknowledged
             FROM player_warnings
             WHERE discord_id = ? AND is_active = 1
             ORDER BY created_at DESC`,
            [discordId]
        )
    ]);

    const p = playerRows[0] || { cash: 0, bank: 0, created_at: now };
    const totalWealth = Number(p.cash || 0) + Number(p.bank || 0);
    const accountAgeHours = Math.max(0.5, (now - Number(p.created_at || now)) / 3600000);

    let payIn7d = 0;
    let payOut7d = 0;
    const partnerMap = new Map(); // partnerId -> { amount, count }

    for (const r of payRows) {
        const amt = Number(r.amount || 0);
        if (r.source === 'pay_in') payIn7d += amt;
        if (r.source === 'pay_out') payOut7d += amt;

        const meta = safeJsonParse(r.meta);
        const partnerId = meta.from || meta.to || null;
        if (partnerId) {
            const cur = partnerMap.get(partnerId) || { amount: 0, count: 0 };
            cur.amount += amt;
            cur.count += 1;
            partnerMap.set(partnerId, cur);
        }
    }

    let topPartnerId = null;
    let topPartnerAmount = 0;
    let topPartnerTxCount = 0;
    for (const [pid, stat] of partnerMap.entries()) {
        if (stat.amount > topPartnerAmount) {
            topPartnerId = pid;
            topPartnerAmount = stat.amount;
            topPartnerTxCount = stat.count;
        }
    }

    const faucet24h = Number(faucetRows[0]?.faucet_24h || 0);
    const activeWarnings = warnRows.length;

    const analysis = computeSusFlagsFromMetrics({
        accountAgeHours,
        totalWealth,
        payIn7d,
        payOut7d,
        payTxCount7d: payRows.length,
        topPartnerId,
        topPartnerAmount,
        topPartnerTxCount,
        faucet24h,
        activeWarnings
    });

    return {
        ...analysis,
        payIn7d,
        payOut7d,
        payTxCount7d: payRows.length,
        topPartnerId,
        topPartnerAmount,
        topPartnerTxCount,
        faucet24h,
        activeWarnings,
        warningsList: warnRows
    };
}

/**
 * Mengambil ringkasan Radar Sus global untuk tab 🚨 Radar Sus di /admin.
 */
async function getRadarSusSummary(now = Date.now()) {
    const since24h = now - 86400000;
    const since7d = now - 7 * 86400000;

    const [topPayRows, topFaucetRows, activeWarnRows] = await Promise.all([
        query(
            `SELECT l.discord_id, p.username,
                    COUNT(*) AS tx_count,
                    SUM(CASE WHEN l.source = 'pay_in' THEN l.amount ELSE 0 END) AS total_in,
                    SUM(CASE WHEN l.source = 'pay_out' THEN l.amount ELSE 0 END) AS total_out,
                    SUM(l.amount) AS total_vol
             FROM economy_ledger l
             LEFT JOIN players p ON p.discord_id = l.discord_id
             WHERE l.source IN ('pay_in', 'pay_out') AND l.created_at >= ?
             GROUP BY l.discord_id, p.username
             ORDER BY total_vol DESC
             LIMIT 6`,
            [since7d]
        ),
        query(
            `SELECT l.discord_id, p.username,
                    SUM(l.amount) AS faucet_24h,
                    COUNT(*) AS tx_count
             FROM economy_ledger l
             LEFT JOIN players p ON p.discord_id = l.discord_id
             WHERE l.type = 'faucet' AND l.created_at >= ?
             GROUP BY l.discord_id, p.username
             ORDER BY faucet_24h DESC
             LIMIT 6`,
            [since24h]
        ),
        query(
            `SELECT w.discord_id, p.username, p.is_banned,
                    COUNT(*) AS warn_count,
                    MAX(w.created_at) AS last_warn_at
             FROM player_warnings w
             LEFT JOIN players p ON p.discord_id = w.discord_id
             WHERE w.is_active = 1
             GROUP BY w.discord_id, p.username, p.is_banned
             ORDER BY warn_count DESC, last_warn_at DESC
             LIMIT 6`
        )
    ]);

    const candidateMap = new Map();
    for (const r of topPayRows) {
        if (!r.discord_id) continue;
        candidateMap.set(r.discord_id, {
            discordId: r.discord_id,
            username: r.username || r.discord_id,
            tag: `Transfer 7h: ${formatLp(r.total_vol)} (${r.tx_count}x)`
        });
    }
    for (const r of topFaucetRows) {
        if (!r.discord_id || candidateMap.has(r.discord_id)) continue;
        candidateMap.set(r.discord_id, {
            discordId: r.discord_id,
            username: r.username || r.discord_id,
            tag: `Faucet 24j: +${formatLp(r.faucet_24h)}`
        });
    }
    for (const r of activeWarnRows) {
        if (!r.discord_id) continue;
        candidateMap.set(r.discord_id, {
            discordId: r.discord_id,
            username: r.username || r.discord_id,
            tag: `Warning Aktif: ${r.warn_count}/${MAX_WARNINGS_BEFORE_AUTOBAN} Strike`
        });
    }

    return {
        topPayRows,
        topFaucetRows,
        activeWarnRows,
        candidates: Array.from(candidateMap.values()).slice(0, 25)
    };
}

function formatLogEntry(item) {
    const unix = Math.floor(Number(item.created_at || Date.now()) / 1000);
    const timeTag = `<t:${unix}:R>`;

    if (item.log_origin === 'ledger') {
        const meta = safeJsonParse(item.meta);
        const amt = formatLp(item.amount);
        const bal = formatLp(item.balance_after);

        if (item.source === 'pay_out') {
            return `💸 **[KELUAR \`/pay\`]** Mengirim **-${amt}** ke <@${meta.to || '?'}> (Pajak: ${formatLp(meta.tax || 0)}) · Saldo: \`${bal}\` · ${timeTag}`;
        }
        if (item.source === 'pay_in') {
            return `📥 **[MASUK \`/pay\`]** Menerima **+${amt}** dari <@${meta.from || '?'}> · Saldo: \`${bal}\` · ${timeTag}`;
        }
        if (item.source === 'admin_give') {
            return `🛠️ **[ADMIN +CASH]** Ditambahkan **+${amt}** oleh Admin <@${meta.adminId || '?'}> · Saldo: \`${bal}\` · ${timeTag}`;
        }
        if (item.source === 'admin_take') {
            return `🛠️ **[ADMIN -CASH]** Dikurangi **-${amt}** oleh Admin <@${meta.adminId || '?'}> · Saldo: \`${bal}\` · ${timeTag}`;
        }

        const sign = item.type === 'faucet' ? '+' : item.type === 'sink' ? '-' : '±';
        const icon = item.type === 'faucet' ? '🟢' : item.type === 'sink' ? '🔴' : '🔄';
        return `${icon} **[${item.source.toUpperCase()}]** **${sign}${amt}** · Saldo: \`${bal}\` · ${timeTag}`;
    }

    // Berasal dari player_activity_logs
    const details = safeJsonParse(item.details);
    if (item.action === 'warn_issued') {
        return `⚠️ **[WARNING ${details.strike || '?'}/${MAX_WARNINGS_BEFORE_AUTOBAN}]** Oleh <@${details.adminId || '?'}>: *"${details.reason || '-'}"* · ${timeTag}`;
    }
    if (item.action === 'auto_ban_3_warnings') {
        return `🔨 **[AUTO-BAN 3 STRIKE]** Akun otomatis dibekukan setelah mencapai 3 Warning aktif · ${timeTag}`;
    }
    if (item.action === 'warnings_cleared') {
        return `🧹 **[CABUT WARNING]** Seluruh warning aktif dibersihkan oleh <@${details.adminId || '?'}> · ${timeTag}`;
    }
    if (item.action === 'ban_toggled') {
        return `${details.isBanned ? '🔨 **[BAN AKUN]**' : '🔓 **[UNBAN AKUN]**'} Oleh <@${details.adminId || '?'}> · ${timeTag}`;
    }
    if (item.action === 'account_reset') {
        return `🔄 **[RESET AKUN KE NOL]** Progres di-reset oleh <@${details.adminId || '?'}> (Harta sebelumnya: ${formatLp(details.prevWealth || 0)}) · ${timeTag}`;
    }
    if (item.action === 'account_deleted') {
        return `🗑️ **[HAPUS AKUN PERMANEN]** Dihapus oleh <@${details.adminId || '?'}> (Harta terakhir: ${formatLp(details.prevWealth || 0)}) · ${timeTag}`;
    }
    if (item.action.startsWith('slash:')) {
        return `⌨️ **[COMMAND]** Menjalankan \`/${item.action.slice(6)}\` · ${timeTag}`;
    }

    return `📋 **[${item.category.toUpperCase()}]** \`${item.action}\` · ${timeTag}`;
}

/**
 * Mengambil gabungan log transaksi (economy_ledger) & log aktivitas/moderasi (player_activity_logs)
 * untuk seorang pemain dengan filter dan paginasi.
 */
async function getPlayerCombinedLogs(discordId, filterCategory = 'all', page = 1, pageSize = 8) {
    let ledgerRows = [];
    let activityRows = [];

    if (filterCategory === 'all' || filterCategory === 'transfer' || filterCategory === 'economy') {
        const ledgerWhere =
            filterCategory === 'transfer'
                ? `WHERE discord_id = ? AND source IN ('pay_in', 'pay_out')`
                : `WHERE discord_id = ?`;
        ledgerRows = await query(
            `SELECT id, discord_id, type, source, amount, balance_after, meta, created_at
             FROM economy_ledger
             ${ledgerWhere}
             ORDER BY created_at DESC, id DESC
             LIMIT 80`,
            [discordId]
        );
    }

    if (filterCategory === 'all' || filterCategory === 'moderation' || filterCategory === 'command') {
        const actWhere =
            filterCategory === 'moderation'
                ? `WHERE discord_id = ? AND category = 'moderation'`
                : filterCategory === 'command'
                    ? `WHERE discord_id = ? AND category = 'command'`
                    : `WHERE discord_id = ?`;
        activityRows = await query(
            `SELECT id, discord_id, category, action, details, created_at
             FROM player_activity_logs
             ${actWhere}
             ORDER BY created_at DESC, id DESC
             LIMIT 80`,
            [discordId]
        );
    }

    const merged = [
        ...ledgerRows.map(r => ({ ...r, log_origin: 'ledger' })),
        ...activityRows.map(r => ({ ...r, log_origin: 'activity' }))
    ].sort((a, b) => Number(b.created_at) - Number(a.created_at));

    const totalItems = merged.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.max(1, Math.min(Number(page) || 1, totalPages));
    const startIdx = (safePage - 1) * pageSize;
    const slice = merged.slice(startIdx, startIdx + pageSize);

    return {
        page: safePage,
        totalPages,
        totalItems,
        formattedLines: slice.map(formatLogEntry)
    };
}

/**
 * Memberikan Warning resmi kepada pemain, mengirim DM Discord, mencatat log,
 * dan otomatis mem-ban jika mencapai 3 Warning aktif.
 */
async function issuePlayerWarning(client, { targetId, adminId, reason, now = Date.now() }) {
    const cleanReason = String(reason || 'Pelanggaran aturan komunitas / ekonomi kota.').trim().slice(0, 400);

    const txResult = await withTransaction(async (conn) => {
        const [ins] = await conn.execute(
            `INSERT INTO player_warnings (discord_id, admin_id, reason, is_active, is_acknowledged, dm_sent, created_at)
             VALUES (?, ?, ?, 1, 0, 0, ?)`,
            [targetId, adminId, cleanReason, now]
        );

        const [cntRows] = await conn.execute(
            `SELECT COUNT(*) AS cnt FROM player_warnings WHERE discord_id = ? AND is_active = 1`,
            [targetId]
        );
        const activeCount = Number(cntRows[0]?.cnt || 1);
        let autoBanned = false;

        if (activeCount >= MAX_WARNINGS_BEFORE_AUTOBAN) {
            await conn.execute(`UPDATE players SET is_banned = 1 WHERE discord_id = ?`, [targetId]);
            autoBanned = true;
        }

        await logPlayerActivity(
            conn,
            targetId,
            'moderation',
            'warn_issued',
            { adminId, reason: cleanReason, strike: activeCount, warningId: ins.insertId },
            now
        );

        if (autoBanned) {
            await logPlayerActivity(
                conn,
                targetId,
                'moderation',
                'auto_ban_3_warnings',
                { adminId, strike: activeCount },
                now
            );
        }

        return {
            warningId: ins.insertId,
            activeCount,
            autoBanned
        };
    });

    // Kirim DM ke pemain jika memungkinkan
    let dmSent = false;
    if (client && client.users && typeof client.users.fetch === 'function') {
        try {
            const discordUser = await client.users.fetch(targetId);
            if (discordUser) {
                const dmPayload = buildV2Card({
                    accentColor: txResult.autoBanned ? COLORS.DANGER : COLORS.WARNING,
                    title: txResult.autoBanned
                        ? `🔨 Peringatan Ke-${txResult.activeCount} & Pembekuan Akun Otomatis`
                        : `⚠️ Peringatan Resmi Administrator (Strike ${txResult.activeCount}/${MAX_WARNINGS_BEFORE_AUTOBAN})`,
                    blocks: [
                        [
                            `Halo <@${targetId}>, kamu menerima **Peringatan Resmi** dari Administrator Kota:`,
                            `> 💬 **Pesan / Alasan:** *"${cleanReason}"*`,
                            `• 🛡️ **Status Peringatan:** **${txResult.activeCount}/${MAX_WARNINGS_BEFORE_AUTOBAN} Strike**`,
                            txResult.autoBanned
                                ? `• 🔴 **Konsekuensi:** Karena telah mencapai **${MAX_WARNINGS_BEFORE_AUTOBAN}× Warning Aktif**, akun karaktermu **otomatis dibekukan (Banned)**.`
                                : `• ⚠️ **Perhatian:** Jika mencapai **${MAX_WARNINGS_BEFORE_AUTOBAN}/${MAX_WARNINGS_BEFORE_AUTOBAN} Strike**, akunmu akan dibekukan secara otomatis. Harap patuhi aturan bermain yang jujur!`
                        ].join('\n')
                    ],
                    footer: 'Pesan Otomatis Sistem Moderasi Kota'
                });
                await discordUser.send(dmPayload);
                dmSent = true;
                await query(`UPDATE player_warnings SET dm_sent = 1 WHERE id = ?`, [txResult.warningId]);
            }
        } catch {
            // DM user dikunci atau tidak dapat dihubungi; sistem in-game intercept akan menanganinya
            dmSent = false;
        }
    }

    return {
        ...txResult,
        reason: cleanReason,
        dmSent
    };
}

/**
 * Mencabut / membersihkan seluruh warning aktif milik pemain.
 */
async function clearPlayerWarnings(targetId, adminId, now = Date.now()) {
    await withTransaction(async (conn) => {
        await conn.execute(
            `UPDATE player_warnings SET is_active = 0, is_acknowledged = 1 WHERE discord_id = ? AND is_active = 1`,
            [targetId]
        );
        await logPlayerActivity(conn, targetId, 'moderation', 'warnings_cleared', { adminId }, now);
    });
}

/**
 * Mengambil daftar warning aktif yang belum di-acknowledge (dibaca di in-game) oleh pemain.
 */
async function getUnacknowledgedWarnings(discordId) {
    return await query(
        `SELECT id, admin_id, reason, created_at
         FROM player_warnings
         WHERE discord_id = ? AND is_active = 1 AND is_acknowledged = 0
         ORDER BY created_at DESC`,
        [discordId]
    );
}

/**
 * Menandai seluruh warning aktif milik pemain sebagai sudah dibaca (acknowledged).
 */
async function acknowledgePlayerWarnings(discordId) {
    await query(
        `UPDATE player_warnings SET is_acknowledged = 1 WHERE discord_id = ? AND is_active = 1 AND is_acknowledged = 0`,
        [discordId]
    );
}

/**
 * Membangun Kartu Peringatan Wajib Baca di in-game saat pemain yang punya warning belum terbaca
 * mencoba menjalankan command.
 */
async function buildWarningInterceptPayload(discordId, unackRows) {
    const allActive = await query(
        `SELECT COUNT(*) AS cnt FROM player_warnings WHERE discord_id = ? AND is_active = 1`,
        [discordId]
    );
    const activeCount = Number(allActive[0]?.cnt || unackRows.length);
    const latest = unackRows[0];
    const unix = Math.floor(Number(latest.created_at || Date.now()) / 1000);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`warn_ack_btn:${discordId}`)
            .setLabel('Saya Mengerti & Tidak Mengulangi')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success)
    );

    return buildV2Card({
        accentColor: COLORS.WARNING,
        title: `⚠️ Peringatan Resmi Administrator (${activeCount}/${MAX_WARNINGS_BEFORE_AUTOBAN} Strike)`,
        blocks: [
            [
                `Halo <@${discordId}>, sebelum melanjutkan aktivitas di kota, harap baca peringatan resmi dari Administrator berikut:`,
                `> 💬 **Pesan Peringatan:** *"${latest.reason}"*`,
                `• 🕒 **Waktu Diterbitkan:** <t:${unix}:R>`,
                `• 🛡️ **Akumulasi Strike Saat Ini:** **${activeCount}/${MAX_WARNINGS_BEFORE_AUTOBAN} Strike**`,
                `• ⚠️ **Peringatan Keras:** Apabila akumulasi mencapai **${MAX_WARNINGS_BEFORE_AUTOBAN}/3 Strike**, akun karaktermu akan **dibekukan (Auto-Ban)** secara otomatis.`
            ].join('\n'),
            `Klik tombol **✅ Saya Mengerti & Tidak Mengulangi** di bawah untuk menandai pesan ini sudah dibaca dan kembali bermain.`
        ],
        componentRows: [row],
        ephemeral: true
    });
}

/**
 * Mereset seluruh progres akun pemain kembali ke titik nol (Zero-Start) tanpa menghapus akun/username.
 */
async function resetPlayerAccount(targetId, adminId, now = Date.now()) {
    const res = await withTransaction(async (conn) => {
        const [rows] = await conn.execute(
            `SELECT username, cash, bank FROM players WHERE discord_id = ? FOR UPDATE`,
            [targetId]
        );
        if (rows.length === 0) {
            return { ok: false, error: 'Akun warga tidak ditemukan di database.' };
        }

        const p = rows[0];
        const prevWealth = Number(p.cash || 0) + Number(p.bank || 0);

        const childTables = [
            'player_inventory',
            'player_job_history',
            'player_collections',
            'player_buffs',
            'player_cooldowns',
            'player_properties',
            'player_farm_plots',
            'player_cooking_queues',
            'player_vehicles',
            'player_credits',
            'player_achievements',
            'player_event_progress',
            'player_gacha_stats'
        ];

        for (const tbl of childTables) {
            await conn.execute(`DELETE FROM ${tbl} WHERE discord_id = ?`, [targetId]);
        }

        await conn.execute(
            `UPDATE players SET
                cash = ?,
                bank = 0,
                energy = 100,
                hunger = 100,
                thirst = 100,
                health = 100,
                last_tick_at = ?,
                sleeping_until = 0,
                hospital_until = 0,
                education_level = 'SD',
                study_target = NULL,
                study_sessions = 0,
                current_job = NULL,
                job_resigned_at = 0,
                total_shifts = 0,
                fishing_xp = 0,
                mining_xp = 0,
                farming_xp = 0,
                cooking_xp = 0,
                cooked_dishes_eaten = 0,
                lpg_charges = 0,
                backpack_tier = 0,
                max_slots = 20,
                equipped_title = NULL,
                daily_streak = 0,
                last_daily_at = 0,
                last_fishing_loc = 'sungai',
                last_fishing_bait = 'umpan_cacing',
                last_mining_loc = 'tambang_batu',
                last_farm_crop = 'bayam'
             WHERE discord_id = ?`,
            [STARTER_PACK.cash, now, targetId]
        );

        for (const entry of STARTER_PACK.items) {
            await conn.execute(
                `INSERT INTO player_inventory (discord_id, item_id, quantity, durability, created_at)
                 VALUES (?, ?, ?, NULL, ?)`,
                [targetId, entry.itemId, entry.qty, now]
            );
        }

        if (prevWealth > 0) {
            await conn.execute(
                `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
                 VALUES (?, 'sink', 'admin_reset', ?, 0, ?, ?)`,
                [targetId, prevWealth, JSON.stringify({ adminId }), now]
            );
        }

        await logPlayerActivity(
            conn,
            targetId,
            'moderation',
            'account_reset',
            { adminId, prevWealth, username: p.username },
            now
        );

        return { ok: true, username: p.username, prevWealth };
    });

    if (res.ok) {
        await clearUserRedisKeys(targetId, now);
    }
    return res;
}

/**
 * Menghapus akun pemain secara permanen dari tabel players (dan seluruh tabel anak via ON DELETE CASCADE)
 * sehingga pemain harus mendaftar ulang lewat /start.
 */
async function deletePlayerAccount(targetId, adminId, now = Date.now()) {
    const res = await withTransaction(async (conn) => {
        const [rows] = await conn.execute(
            `SELECT username, cash, bank FROM players WHERE discord_id = ? FOR UPDATE`,
            [targetId]
        );
        if (rows.length === 0) {
            return { ok: false, error: 'Akun warga tidak ditemukan di database.' };
        }

        const p = rows[0];
        const prevWealth = Number(p.cash || 0) + Number(p.bank || 0);

        if (prevWealth > 0) {
            await conn.execute(
                `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
                 VALUES (?, 'sink', 'admin_delete', ?, 0, ?, ?)`,
                [targetId, prevWealth, JSON.stringify({ adminId, username: p.username }), now]
            );
        }

        await logPlayerActivity(
            conn,
            targetId,
            'moderation',
            'account_deleted',
            { adminId, prevWealth, username: p.username },
            now
        );

        await conn.execute(`DELETE FROM players WHERE discord_id = ?`, [targetId]);

        return { ok: true, username: p.username, prevWealth };
    });

    if (res.ok) {
        await clearUserRedisKeys(targetId, now);
    }
    return res;
}

module.exports = {
    MAX_WARNINGS_BEFORE_AUTOBAN,
    logPlayerActivity,
    computeSusFlagsFromMetrics,
    getPlayerSusAnalysis,
    getRadarSusSummary,
    getPlayerCombinedLogs,
    issuePlayerWarning,
    clearPlayerWarnings,
    getUnacknowledgedWarnings,
    acknowledgePlayerWarnings,
    buildWarningInterceptPayload,
    resetPlayerAccount,
    deletePlayerAccount
};
