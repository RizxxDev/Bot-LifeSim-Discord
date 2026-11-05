const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonStyle
} = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { getActiveUserCount } = require('../../database/redis');
const { getLiveEconomyConfig } = require('../../services/economyService');
const { addItem } = require('../../services/inventoryService');
const {
    SEASONAL_EVENTS,
    getCurrentWeather,
    setWeatherOverride,
    getActiveSeasonalEvent,
    startSeasonalEvent,
    stopSeasonalEvent
} = require('../../services/eventService');
const {
    MAX_WARNINGS_BEFORE_AUTOBAN,
    logPlayerActivity,
    getPlayerSusAnalysis,
    getRadarSusSummary,
    getPlayerCombinedLogs,
    issuePlayerWarning,
    clearPlayerWarnings,
    resetPlayerAccount,
    deletePlayerAccount
} = require('../../services/moderationService');
const { getItem } = require('../../data/items');
const { COLORS, formatLp, buildV2Card } = require('../../utils/uiBuilder');
const { makeId } = require('../../utils/panelId');
const {
    buildPanel,
    btn,
    select,
    userSelect,
    numberModal,
    parseModalNumber,
    respondOrUpdate
} = require('../../utils/panelBuilder');

function isOwner(userId) {
    const ownerIds = String(process.env.OWNER_ID || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    return ownerIds.includes(userId);
}

function buildAdminTabRow(ownerId, activeTab = 'stats', now = Date.now()) {
    const tabs = [
        { id: 'stats', label: 'Ekonomi', emoji: '📊' },
        { id: 'player', label: 'Kelola Pemain', emoji: '👤' },
        { id: 'sus', label: 'Radar Sus', emoji: '🚨' },
        { id: 'event', label: 'Event & Cuaca', emoji: '🎪' },
        { id: 'config', label: 'Multiplier', emoji: '⚙️' }
    ];
    return new ActionRowBuilder().addComponents(
        tabs.map(t =>
            btn('admin', 'tab', ownerId, {
                label: t.label,
                emoji: t.emoji,
                style: t.id === activeTab ? ButtonStyle.Primary : ButtonStyle.Secondary,
                arg: t.id
            }, now)
        )
    );
}

async function buildAdminStatsPanel(ownerId, banner = null, now = Date.now()) {
    const since24h = now - 86400000;
    const since30d = now - 30 * 86400000;

    const [macroRows, ledgerRows, dau, liveCfg] = await Promise.all([
        query(
            `SELECT
                COUNT(*) AS total_players,
                SUM(CASE WHEN last_tick_at >= ? THEN 1 ELSE 0 END) AS active_30d_players,
                COALESCE(SUM(cash), 0) AS total_cash,
                COALESCE(SUM(bank), 0) AS total_bank,
                COALESCE(SUM(CASE WHEN last_tick_at >= ? THEN (cash + bank) ELSE 0 END), 0) AS active_supply
             FROM players WHERE is_banned = 0`,
            [since30d, since30d]
        ),
        query(
            `SELECT type, COALESCE(SUM(amount), 0) AS total_amt
             FROM economy_ledger
             WHERE created_at >= ?
             GROUP BY type`,
            [since24h]
        ),
        getActiveUserCount(now),
        withTransaction(conn => getLiveEconomyConfig(conn))
    ]);

    const m = macroRows[0] || {};
    const totalSupply = Number(m.total_cash || 0) + Number(m.total_bank || 0);
    const active30d = Math.max(1, Number(m.active_30d_players || 1));
    const perActiveCapita = Math.round(Number(m.active_supply || 0) / active30d);

    let faucet24h = 0;
    let sink24h = 0;
    for (const r of ledgerRows) {
        if (r.type === 'faucet') faucet24h = Number(r.total_amt);
        if (r.type === 'sink') sink24h = Number(r.total_amt);
    }

    const ratio = faucet24h > 0 ? Math.round((sink24h / faucet24h) * 100) : 100;

    return buildPanel({
        mod: 'admin',
        ownerId,
        accentColor: COLORS.ADMIN,
        title: '🔒 Panel Kendali Owner — Makro Ekonomi',
        banner,
        blocks: [
            [
                '**👥 Populasi Warga:**',
                `• Total Terdaftar : **${m.total_players || 0} warga**`,
                `• Aktif 30 Hari   : **${m.active_30d_players || 0} warga**`,
                `• DAU Hari Ini    : **${dau} warga**`
            ].join('\n'),
            [
                '**💰 Suplai Uang Beredar (Money Supply):**',
                `• Total Cash      : **${formatLp(m.total_cash)}**`,
                `• Total Bank      : **${formatLp(m.total_bank)}**`,
                `• Total Beredar   : **${formatLp(totalSupply)}**`,
                `• Rata-rata/Aktif : **${formatLp(perActiveCapita)} / warga aktif**`
            ].join('\n'),
            [
                '**🔄 Arus Kas 24 Jam Terakhir:**',
                `• 🟢 Faucet (Inflow) : **+${formatLp(faucet24h)}**`,
                `• 🔴 Sink (Outflow)  : **-${formatLp(sink24h)}**`,
                `• ⚖️ Rasio Sink/Faucet: **${ratio}%** *(Target sehat: 75–95%)*`
            ].join('\n'),
            [
                '**⚙️ Konfigurasi Live Saat Ini:**',
                `• \`salary_multiplier\` : **${liveCfg.salary_multiplier}x** · \`sell_multiplier\` : **${liveCfg.sell_multiplier}x**`,
                `• \`income_tax_enabled\`: **${liveCfg.income_tax_enabled}** · \`wealth_tax_enabled\`: **${liveCfg.wealth_tax_enabled}** · \`soft_cap_enabled\`: **${liveCfg.soft_cap_enabled}**`
            ].join('\n')
        ],
        rows: [buildAdminTabRow(ownerId, 'stats', now)],
        ephemeral: true,
        now
    });
}

function buildAdminPlayerPanelFromData({
    ownerId,
    targetRow = null,
    susAnalysis = null,
    banner = null,
    now = Date.now()
}) {
    const blocks = [];

    if (targetRow) {
        const totalWealth = Number(targetRow.cash || 0) + Number(targetRow.bank || 0);
        const createdUnix = Math.floor(Number(targetRow.created_at || now) / 1000);
        const activeWarnings = Number(susAnalysis?.activeWarnings || 0);
        const lastWarn = susAnalysis?.warningsList?.[0] || null;

        const profileLines = [
            `👤 **Warga Terpilih:** **${targetRow.username}** (<@${targetRow.discord_id}> · ID: \`${targetRow.discord_id}\`)`,
            `• 💵 Cash: **${formatLp(targetRow.cash)}** · 🏦 Bank: **${formatLp(targetRow.bank)}** *(Total: **${formatLp(totalWealth)}**)*`,
            `• 💼 Profesi: **${targetRow.current_job || 'Pengangguran'}** · 🎓 Pendidikan: **${targetRow.education_level || 'SD'}** · 📅 Daftar: <t:${createdUnix}:R>`,
            `• 🛡️ Status Akun: ${Number(targetRow.is_banned) === 1 ? '🔴 **BANNED**' : '🟢 **AKTIF**'} · ⚠️ Warning Aktif: **${activeWarnings}/${MAX_WARNINGS_BEFORE_AUTOBAN} Strike**`
        ];
        if (lastWarn) {
            profileLines.push(`• 📝 Warning Terakhir: *"${lastWarn.reason}"* (<t:${Math.floor(Number(lastWarn.created_at) / 1000)}:R>)`);
        }
        blocks.push(profileLines.join('\n'));

        if (susAnalysis) {
            const susLines = [
                `### 🕵️ Indikator Audit & Deteksi Sus: ${susAnalysis.badge} *(Skor Risiko: ${susAnalysis.score}/100)*`,
                `• 💸 Transfer \`/pay\` (7 Hari): Masuk **+${formatLp(susAnalysis.payIn7d)}** | Keluar **-${formatLp(susAnalysis.payOut7d)}** (**${susAnalysis.payTxCount7d}×** tx)`,
                `• 📈 Pemasukan Faucet (24 Jam): **+${formatLp(susAnalysis.faucet24h)}**`
            ];
            if (susAnalysis.flags && susAnalysis.flags.length > 0) {
                susLines.push('**🚩 Temuan Red Flags:**');
                for (const fl of susAnalysis.flags) {
                    susLines.push(`  ${fl}`);
                }
            } else {
                susLines.push('• ✅ Tidak ditemukan pola transaksi mencurigakan dalam 7 hari terakhir.');
            }
            blocks.push(susLines.join('\n'));
        }
    } else {
        blocks.push(
            'Pilih warga melalui menu **User Select** di bawah (atau lewat tab **🚨 Radar Sus**) untuk memeriksa log histori, mendeteksi indikasi kecurangan/tuyul, memberi warning, mereset progres, atau menghapus akun.'
        );
    }

    const rows = [
        buildAdminTabRow(ownerId, 'player', now),
        userSelect('admin', 'pick_user', ownerId, '👤 Pilih Warga untuk Dikelola / Diaudit...', now)
    ];

    if (targetRow) {
        const isBanned = Number(targetRow.is_banned) === 1;
        const activeWarnings = Number(susAnalysis?.activeWarnings || 0);

        rows.push(
            new ActionRowBuilder().addComponents(
                btn('admin', 'give_cash_modal', ownerId, {
                    label: 'Give Cash',
                    emoji: '➕',
                    style: ButtonStyle.Success,
                    arg: targetRow.discord_id
                }, now),
                btn('admin', 'take_cash_modal', ownerId, {
                    label: 'Take Cash',
                    emoji: '➖',
                    style: ButtonStyle.Primary,
                    arg: targetRow.discord_id
                }, now),
                btn('admin', 'give_item_modal', ownerId, {
                    label: 'Give Item',
                    emoji: '📦',
                    style: ButtonStyle.Secondary,
                    arg: targetRow.discord_id
                }, now),
                btn('admin', 'view_logs', ownerId, {
                    label: 'Lihat Logs & Histori',
                    emoji: '📜',
                    style: ButtonStyle.Primary,
                    arg: `${targetRow.discord_id}|all|1`
                }, now)
            ),
            new ActionRowBuilder().addComponents(
                btn('admin', 'warn_modal', ownerId, {
                    label: `Warning (${activeWarnings}/${MAX_WARNINGS_BEFORE_AUTOBAN})`,
                    emoji: '⚠️',
                    style: ButtonStyle.Primary,
                    arg: targetRow.discord_id
                }, now),
                btn('admin', 'clear_warn', ownerId, {
                    label: 'Cabut Warning',
                    emoji: '🧹',
                    style: ButtonStyle.Secondary,
                    arg: targetRow.discord_id,
                    disabled: activeWarnings <= 0
                }, now),
                btn('admin', 'toggle_ban', ownerId, {
                    label: isBanned ? 'Unban' : 'Ban',
                    emoji: isBanned ? '🔓' : '🔨',
                    style: isBanned ? ButtonStyle.Success : ButtonStyle.Danger,
                    arg: targetRow.discord_id
                }, now),
                btn('admin', 'ask_reset', ownerId, {
                    label: 'Reset ke Nol',
                    emoji: '🔄',
                    style: ButtonStyle.Danger,
                    arg: targetRow.discord_id
                }, now),
                btn('admin', 'ask_delete', ownerId, {
                    label: 'Hapus Akun',
                    emoji: '🗑️',
                    style: ButtonStyle.Danger,
                    arg: targetRow.discord_id
                }, now)
            )
        );
    }

    return buildPanel({
        mod: 'admin',
        ownerId,
        accentColor: COLORS.ADMIN,
        title: '🔒 Panel Kendali Owner — Kelola & Audit Pemain',
        banner,
        blocks,
        rows,
        ephemeral: true,
        now
    });
}

async function buildAdminPlayerPanel(ownerId, targetId = null, banner = null, now = Date.now()) {
    let targetRow = null;
    let susAnalysis = null;
    if (targetId) {
        const rows = await query(
            `SELECT discord_id, username, cash, bank, current_job, education_level, is_banned, created_at
             FROM players WHERE discord_id = ? LIMIT 1`,
            [targetId]
        );
        targetRow = rows[0] || null;
        if (targetRow) {
            susAnalysis = await getPlayerSusAnalysis(targetId, now);
        }
    }

    return buildAdminPlayerPanelFromData({
        ownerId,
        targetRow,
        susAnalysis,
        banner,
        now
    });
}

function buildAdminPlayerConfirmPanel({
    ownerId,
    targetRow,
    actionType = 'reset',
    now = Date.now()
}) {
    const isDelete = actionType === 'delete';
    const totalWealth = Number(targetRow.cash || 0) + Number(targetRow.bank || 0);

    const blocks = [
        [
            isDelete
                ? `### 🗑️ Konfirmasi Hapus Akun Permanen (Delete)`
                : `### 🔄 Konfirmasi Reset Progres Akun ke Titik Nol (Zero-Start)`,
            `Target Warga: **${targetRow.username}** (<@${targetRow.discord_id}> · ID: \`${targetRow.discord_id}\`)`,
            `Total Kekayaan Saat Ini: **${formatLp(totalWealth)}** *(Cash: ${formatLp(targetRow.cash)} | Bank: ${formatLp(targetRow.bank)})*`,
            '',
            isDelete
                ? `⚠️ **PERINGATAN KERAS:** Tindakan ini akan **menghapus akun beserta seluruh data tas, properti, kendaraan, kebun, kredit, dan progres** secara permanen dari database. Pemain harus mendaftar ulang dari \`/start\` jika ingin bermain kembali.`
                : `⚠️ **PERINGATAN:** Tindakan ini akan **mengosongkan seluruh uang (Cash & Bank menjadi Lp 0), menghapus properti, kendaraan, kredit, skill XP, serta mengembalikan isi tas ke bekal awal Zero-Start (3× Roti & 3× Air Mineral)** tanpa menghapus username/akun warga.`
        ].join('\n')
    ];

    const confirmRow = new ActionRowBuilder().addComponents(
        btn('admin', isDelete ? 'confirm_delete' : 'confirm_reset', ownerId, {
            label: isDelete ? 'Ya, Hapus Akun Permanen!' : 'Ya, Reset Progres ke Nol!',
            emoji: isDelete ? '🗑️' : '🔄',
            style: ButtonStyle.Danger,
            arg: targetRow.discord_id
        }, now),
        btn('admin', 'back_player', ownerId, {
            label: 'Batal & Kembali',
            emoji: '🔙',
            style: ButtonStyle.Secondary,
            arg: targetRow.discord_id
        }, now)
    );

    return buildPanel({
        mod: 'admin',
        ownerId,
        accentColor: COLORS.DANGER,
        title: isDelete ? '⚠️ Konfirmasi Hapus Akun Warga' : '⚠️ Konfirmasi Reset Akun Warga',
        blocks,
        rows: [confirmRow],
        ephemeral: true,
        now
    });
}

function buildAdminPlayerLogsPanelFromData({
    ownerId,
    targetId,
    targetRow = null,
    susAnalysis = null,
    logData,
    filterCat = 'all',
    banner = null,
    now = Date.now()
}) {
    const filterLabels = {
        all: '📋 Semua Log (Transaksi + Aktivitas + Moderasi)',
        transfer: '💸 Khusus Transfer /pay (Lacak Aliran Dana / Tuyul)',
        economy: '💰 Transaksi Ekonomi (Faucet, Sink, Jual/Beli, Kerja)',
        moderation: '🛡️ Riwayat Moderasi & Warning',
        command: '⌨️ Riwayat Eksekusi Command'
    };

    const headerLines = [
        `👤 **Target Audit:** **${targetRow ? targetRow.username : 'Warga (Terhapus)'}** (<@${targetId}> · ID: \`${targetId}\`)`,
        `• 🔍 **Filter Aktif:** ${filterLabels[filterCat] || filterLabels.all}`,
        susAnalysis
            ? `• 🕵️ **Status Sus:** ${susAnalysis.badge} *(Skor: ${susAnalysis.score}/100 · Transfer 7h: Masuk +${formatLp(susAnalysis.payIn7d)} / Keluar -${formatLp(susAnalysis.payOut7d)})*`
            : `• ℹ️ Menampilkan log historis yang tersimpan di database.`
    ];

    const logLines =
        logData.formattedLines.length > 0
            ? logData.formattedLines.join('\n')
            : '*Belum ada catatan log pada kategori ini.*';

    const filterSelect = select('admin', 'log_filter', ownerId, {
        placeholder: '🔍 Filter Kategori Log Warga...',
        options: [
            { label: 'Semua Log (Gabungan)', value: `${targetId}|all`, emoji: '📋', default: filterCat === 'all' },
            { label: 'Khusus Transfer /pay (Cek Tuyul)', value: `${targetId}|transfer`, emoji: '💸', default: filterCat === 'transfer' },
            { label: 'Transaksi Ekonomi (Faucet & Sink)', value: `${targetId}|economy`, emoji: '💰', default: filterCat === 'economy' },
            { label: 'Riwayat Moderasi & Warning', value: `${targetId}|moderation`, emoji: '🛡️', default: filterCat === 'moderation' },
            { label: 'Riwayat Eksekusi Command', value: `${targetId}|command`, emoji: '⌨️', default: filterCat === 'command' }
        ]
    }, now);

    const navRow = new ActionRowBuilder().addComponents(
        btn('admin', 'log_page', ownerId, {
            label: 'Sebelumnya',
            emoji: '◀️',
            style: ButtonStyle.Secondary,
            arg: `${targetId}|${filterCat}|${Math.max(1, logData.page - 1)}|prev`,
            disabled: logData.page <= 1
        }, now),
        btn('admin', 'noop', ownerId, {
            label: `Hal ${logData.page}/${logData.totalPages} (${logData.totalItems} Log)`,
            style: ButtonStyle.Secondary,
            arg: 'log_pg_info',
            disabled: true
        }, now),
        btn('admin', 'log_page', ownerId, {
            label: 'Berikutnya',
            emoji: '▶️',
            style: ButtonStyle.Secondary,
            arg: `${targetId}|${filterCat}|${Math.min(logData.totalPages, logData.page + 1)}|next`,
            disabled: logData.page >= logData.totalPages
        }, now),
        btn('admin', 'back_player', ownerId, {
            label: 'Kembali ke Kelola Pemain',
            emoji: '🔙',
            style: ButtonStyle.Primary,
            arg: targetId
        }, now)
    );

    return buildPanel({
        mod: 'admin',
        ownerId,
        accentColor: COLORS.ADMIN,
        title: `📜 Riwayat & Audit Logs — ${targetRow ? targetRow.username : targetId}`,
        banner,
        blocks: [
            headerLines.join('\n'),
            `### 📄 Daftar Catatan Aktivitas & Transaksi (Hal ${logData.page}/${logData.totalPages})\n${logLines}`
        ],
        rows: [filterSelect, navRow],
        ephemeral: true,
        now
    });
}

async function buildAdminPlayerLogsPanel(ownerId, targetId, filterCat = 'all', page = 1, banner = null, now = Date.now()) {
    const [rows, susAnalysis, logData] = await Promise.all([
        query(`SELECT discord_id, username, cash, bank, is_banned, created_at FROM players WHERE discord_id = ? LIMIT 1`, [targetId]),
        getPlayerSusAnalysis(targetId, now),
        getPlayerCombinedLogs(targetId, filterCat, page, 8)
    ]);

    return buildAdminPlayerLogsPanelFromData({
        ownerId,
        targetId,
        targetRow: rows[0] || null,
        susAnalysis,
        logData,
        filterCat,
        banner,
        now
    });
}

function buildAdminSusRadarPanelFromData({
    ownerId,
    radarData,
    banner = null,
    now = Date.now()
}) {
    const payLines =
        radarData.topPayRows && radarData.topPayRows.length > 0
            ? radarData.topPayRows.map((r, i) =>
                `${i + 1}. **${r.username || r.discord_id}** (<@${r.discord_id}>) — Volume: **${formatLp(r.total_vol)}** *(Masuk: +${formatLp(r.total_in)} | Keluar: -${formatLp(r.total_out)} · ${r.tx_count}× tx)*`
            ).join('\n')
            : '*Belum ada aktivitas transfer `/pay` dalam 7 hari terakhir.*';

    const faucetLines =
        radarData.topFaucetRows && radarData.topFaucetRows.length > 0
            ? radarData.topFaucetRows.map((r, i) =>
                `${i + 1}. **${r.username || r.discord_id}** (<@${r.discord_id}>) — Faucet 24j: **+${formatLp(r.faucet_24h)}** *(${r.tx_count}× aktivitas)*`
            ).join('\n')
            : '*Belum ada pemasukan faucet dalam 24 jam terakhir.*';

    const warnLines =
        radarData.activeWarnRows && radarData.activeWarnRows.length > 0
            ? radarData.activeWarnRows.map((r, i) =>
                `${i + 1}. **${r.username || r.discord_id}** (<@${r.discord_id}>) — **⚠️ ${r.warn_count}/${MAX_WARNINGS_BEFORE_AUTOBAN} Strike** ${Number(r.is_banned) === 1 ? '*(🔴 BANNED)*' : '*(🟢 Aktif)*'}`
            ).join('\n')
            : '*Tidak ada warga yang memiliki warning aktif saat ini.*';

    const rows = [buildAdminTabRow(ownerId, 'sus', now)];

    if (radarData.candidates && radarData.candidates.length > 0) {
        rows.push(
            select('admin', 'inspect_sus', ownerId, {
                placeholder: '🔍 Pilih Warga dari Radar Sus untuk Diaudit Lebih Lanjut...',
                options: radarData.candidates.map(c => ({
                    label: `${c.username} (${c.discordId})`.slice(0, 100),
                    value: c.discordId,
                    emoji: '🕵️',
                    description: String(c.tag || 'Klik untuk buka profil & logs').slice(0, 100)
                }))
            }, now)
        );
    }

    rows.push(
        new ActionRowBuilder().addComponents(
            btn('admin', 'tab', ownerId, {
                label: 'Segarkan Radar Sus',
                emoji: '🔄',
                style: ButtonStyle.Secondary,
                arg: 'sus_refresh'
            }, now)
        )
    );

    return buildPanel({
        mod: 'admin',
        ownerId,
        accentColor: COLORS.ADMIN,
        title: '🚨 Panel Kendali Owner — Radar Sus & Deteksi Anomali',
        banner,
        blocks: [
            `### 💸 Top Perputaran Transfer \`/pay\` (7 Hari Terakhir — Pantau Indikasi Tuyul)\n${payLines}`,
            `### 📈 Top Pemasukan Faucet Sistem (24 Jam Terakhir)\n${faucetLines}`,
            `### ⚠️ Warga dengan Warning Aktif\n${warnLines}`
        ],
        rows,
        ephemeral: true,
        now
    });
}

async function buildAdminSusRadarPanel(ownerId, banner = null, now = Date.now()) {
    const radarData = await getRadarSusSummary(now);
    return buildAdminSusRadarPanelFromData({
        ownerId,
        radarData,
        banner,
        now
    });
}

async function buildAdminEventPanel(ownerId, banner = null, now = Date.now()) {
    const statusData = await withTransaction(async (conn) => {
        const weather = await getCurrentWeather(conn, now);
        const active = await getActiveSeasonalEvent(conn, now);
        return { weather, active };
    });

    const blocks = [
        [
            `• **Cuaca Saat Ini:** ${statusData.weather.emoji} **${statusData.weather.name}** (${statusData.weather.isOverride ? 'Override Manual' : 'Siklus Otomatis 2 Minggu'})`,
            statusData.active
                ? `• **Event Aktif:** ${statusData.active.config.emoji} **${statusData.active.config.name}** (\`${statusData.active.stateRow.event_key}\`)\n• **Progres Komunitas:** **${statusData.active.stateRow.community_progress}/${statusData.active.config.communityGoal.target}**\n• **THR Lebaran:** ${statusData.active.lebaranThr?.active ? `Aktif (×${statusData.active.lebaranThr.multiplier})` : 'Tidak Aktif'}`
                : '• **Event Aktif:** *Tidak ada event musiman yang sedang aktif*'
        ].join('\n')
    ];

    const eventSelect = select('admin', 'start_event', ownerId, {
        placeholder: '▶️ Pilih Event Musiman untuk Dimulai (Durasi 7 Hari)...',
        options: SEASONAL_EVENTS.map(ev => ({
            label: `${ev.name} (7 Hari)`.slice(0, 100),
            value: ev.id,
            emoji: ev.emoji,
            description: ev.description.slice(0, 100)
        }))
    }, now);

    const controlRow = new ActionRowBuilder().addComponents(
        btn('admin', 'stop_event', ownerId, {
            label: 'Hentikan Event',
            emoji: '⏹️',
            style: ButtonStyle.Danger,
            disabled: !statusData.active
        }, now),
        btn('admin', 'weather', ownerId, {
            label: 'Auto 2 Minggu',
            emoji: '🔄',
            style: ButtonStyle.Secondary,
            arg: 'auto'
        }, now),
        btn('admin', 'weather', ownerId, {
            label: 'Paksa Hujan',
            emoji: '🌧️',
            style: ButtonStyle.Primary,
            arg: 'hujan'
        }, now),
        btn('admin', 'weather', ownerId, {
            label: 'Paksa Kemarau',
            emoji: '☀️',
            style: ButtonStyle.Primary,
            arg: 'kemarau'
        }, now)
    );

    return buildPanel({
        mod: 'admin',
        ownerId,
        accentColor: COLORS.ADMIN,
        title: '🔒 Panel Kendali Owner — Event & Cuaca',
        banner,
        blocks,
        rows: [buildAdminTabRow(ownerId, 'event', now), eventSelect, controlRow],
        ephemeral: true,
        now
    });
}

async function buildAdminConfigPanel(ownerId, banner = null, now = Date.now()) {
    const liveCfg = await withTransaction(conn => getLiveEconomyConfig(conn));

    const blocks = [
        [
            '**⚙️ Parameter Live Ekonomi Saat Ini:**',
            `• \`salary_multiplier\`  : **${liveCfg.salary_multiplier}x** *(Rentang aman: 0.5 – 2.0)*`,
            `• \`sell_multiplier\`    : **${liveCfg.sell_multiplier}x** *(Rentang aman: 0.5 – 2.0)*`,
            `• \`income_tax_enabled\` : **${liveCfg.income_tax_enabled ? '🟢 Aktif' : '🔴 Nonaktif'}**`,
            `• \`wealth_tax_enabled\` : **${liveCfg.wealth_tax_enabled ? '🟢 Aktif' : '🔴 Nonaktif'}**`,
            `• \`soft_cap_enabled\`   : **${liveCfg.soft_cap_enabled ? '🟢 Aktif' : '🔴 Nonaktif'}**`
        ].join('\n')
    ];

    const multSelect = select('admin', 'set_mult', ownerId, {
        placeholder: '📈 Pilih Preset Pengali Gaji / Harga Jual...',
        options: [
            { label: 'Salary Multiplier: 0.8x (Deflasi)', value: 'salary_multiplier|0.8', emoji: '💼' },
            { label: 'Salary Multiplier: 1.0x (Normal)', value: 'salary_multiplier|1.0', emoji: '💼' },
            { label: 'Salary Multiplier: 1.2x (Boost)', value: 'salary_multiplier|1.2', emoji: '💼' },
            { label: 'Salary Multiplier: 1.5x (Event)', value: 'salary_multiplier|1.5', emoji: '💼' },
            { label: 'Sell Multiplier: 0.8x (Deflasi)', value: 'sell_multiplier|0.8', emoji: '💰' },
            { label: 'Sell Multiplier: 1.0x (Normal)', value: 'sell_multiplier|1.0', emoji: '💰' },
            { label: 'Sell Multiplier: 1.2x (Boost)', value: 'sell_multiplier|1.2', emoji: '💰' },
            { label: 'Sell Multiplier: 1.5x (Event)', value: 'sell_multiplier|1.5', emoji: '💰' }
        ]
    }, now);

    const toggleRow = new ActionRowBuilder().addComponents(
        btn('admin', 'toggle_cfg', ownerId, {
            label: `Pajak Gaji: ${liveCfg.income_tax_enabled ? 'ON' : 'OFF'}`,
            emoji: '🏛️',
            style: liveCfg.income_tax_enabled ? ButtonStyle.Success : ButtonStyle.Secondary,
            arg: 'income_tax_enabled'
        }, now),
        btn('admin', 'toggle_cfg', ownerId, {
            label: `Pajak Kaya: ${liveCfg.wealth_tax_enabled ? 'ON' : 'OFF'}`,
            emoji: '💎',
            style: liveCfg.wealth_tax_enabled ? ButtonStyle.Success : ButtonStyle.Secondary,
            arg: 'wealth_tax_enabled'
        }, now),
        btn('admin', 'toggle_cfg', ownerId, {
            label: `Soft Cap: ${liveCfg.soft_cap_enabled ? 'ON' : 'OFF'}`,
            emoji: '🛡️',
            style: liveCfg.soft_cap_enabled ? ButtonStyle.Success : ButtonStyle.Secondary,
            arg: 'soft_cap_enabled'
        }, now)
    );

    return buildPanel({
        mod: 'admin',
        ownerId,
        accentColor: COLORS.ADMIN,
        title: '🔒 Panel Kendali Owner — Multiplier & Pajak',
        banner,
        blocks,
        rows: [buildAdminTabRow(ownerId, 'config', now), multSelect, toggleRow],
        ephemeral: true,
        now
    });
}

module.exports = {
    name: 'admin',
    slash: true,
    isAdminCommand: true,
    skipRegistrationCheck: true,
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('🔒 Buka panel kendali ekonomi, audit logs, radar sus, warning, & reset/delete khusus Owner.'),

    async executeSlash(interaction) {
        if (!isOwner(interaction.user.id)) {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '🔒 Akses Ditolak',
                    blocks: ['Command `/admin` hanya dapat dijalankan oleh Developer/Owner bot yang terdaftar di `OWNER_ID`.'],
                    ephemeral: true
                })
            );
        }

        const now = Date.now();
        return await interaction.reply(await buildAdminStatsPanel(interaction.user.id, null, now));
    },

    panel: {
        buttons: {
            async tab(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const tab = parsed.arg || 'stats';
                if (tab === 'player') return await interaction.update(await buildAdminPlayerPanel(interaction.user.id, null, null, now));
                if (tab === 'sus' || tab === 'sus_refresh') {
                    return await interaction.update(await buildAdminSusRadarPanel(interaction.user.id, null, now));
                }
                if (tab === 'event') return await interaction.update(await buildAdminEventPanel(interaction.user.id, null, now));
                if (tab === 'config') return await interaction.update(await buildAdminConfigPanel(interaction.user.id, null, now));
                return await interaction.update(await buildAdminStatsPanel(interaction.user.id, null, now));
            },
            async back_player(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const targetId = parsed.arg || null;
                return await interaction.update(await buildAdminPlayerPanel(interaction.user.id, targetId, null, now));
            },
            async view_logs(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const [targetId, filterCat = 'all', pageStr = '1'] = String(parsed.arg || '').split('|');
                return await interaction.update(
                    await buildAdminPlayerLogsPanel(interaction.user.id, targetId, filterCat, Number(pageStr) || 1, null, now)
                );
            },
            async log_page(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const [targetId, filterCat = 'all', pageStr = '1'] = String(parsed.arg || '').split('|');
                return await interaction.update(
                    await buildAdminPlayerLogsPanel(interaction.user.id, targetId, filterCat, Number(pageStr) || 1, null, now)
                );
            },
            async give_cash_modal(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const modal = numberModal('admin', 'give_cash_submit', interaction.user.id, {
                    title: '➕ Berikan Cash (Lp) ke Warga',
                    label: 'Jumlah Lp yang ditambahkan',
                    placeholder: 'Contoh: 100000',
                    arg: parsed.arg
                });
                return await interaction.showModal(modal);
            },
            async take_cash_modal(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const modal = numberModal('admin', 'take_cash_submit', interaction.user.id, {
                    title: '➖ Kurangi Cash (Lp) dari Warga',
                    label: 'Jumlah Lp yang dikurangi',
                    placeholder: 'Contoh: 50000',
                    arg: parsed.arg
                });
                return await interaction.showModal(modal);
            },
            async give_item_modal(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const modal = new ModalBuilder()
                    .setCustomId(makeId('admin', 'give_item_submit', interaction.user.id, parsed.arg))
                    .setTitle('📦 Berikan Item ke Warga')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('item_id')
                                .setLabel('ID Item (contoh: nasi_bungkus, pancing_bambu)')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('qty')
                                .setLabel('Jumlah Item')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('1')
                                .setRequired(true)
                        )
                    );
                return await interaction.showModal(modal);
            },
            async warn_modal(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const modal = new ModalBuilder()
                    .setCustomId(makeId('admin', 'warn_submit', interaction.user.id, parsed.arg))
                    .setTitle('⚠️ Beri Peringatan (Warning) ke Warga')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('reason')
                                .setLabel('Pesan / Alasan Peringatan untuk Warga')
                                .setStyle(TextInputStyle.Paragraph)
                                .setPlaceholder('Contoh: Dilarang menyalurkan uang dari akun kedua (akun tuyul). Pelanggaran ke-3 akan di-ban!')
                                .setMaxLength(350)
                                .setRequired(true)
                        )
                    );
                return await interaction.showModal(modal);
            },
            async clear_warn(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const targetId = parsed.arg || '';
                await clearPlayerWarnings(targetId, interaction.user.id, now);
                return await interaction.update(
                    await buildAdminPlayerPanel(
                        interaction.user.id,
                        targetId,
                        { type: 'success', text: `🧹 Seluruh warning aktif untuk <@${targetId}> berhasil dicabut.` },
                        now
                    )
                );
            },
            async toggle_ban(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const targetId = parsed.arg || '';
                const rows = await query(`SELECT is_banned FROM players WHERE discord_id = ? LIMIT 1`, [targetId]);
                let nextBan = 0;
                if (rows.length > 0) {
                    nextBan = Number(rows[0].is_banned) === 1 ? 0 : 1;
                    await query(`UPDATE players SET is_banned = ? WHERE discord_id = ?`, [nextBan, targetId]);
                    await logPlayerActivity(
                        null,
                        targetId,
                        'moderation',
                        'ban_toggled',
                        { adminId: interaction.user.id, isBanned: nextBan === 1 },
                        now
                    );
                }
                return await interaction.update(
                    await buildAdminPlayerPanel(
                        interaction.user.id,
                        targetId,
                        {
                            type: nextBan === 1 ? 'danger' : 'success',
                            text: nextBan === 1
                                ? `🔨 Akun <@${targetId}> telah dibekukan (BANNED).`
                                : `🔓 Akun <@${targetId}> telah dipulihkan (UNBANNED).`
                        },
                        now
                    )
                );
            },
            async ask_reset(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const targetId = parsed.arg || '';
                const rows = await query(
                    `SELECT discord_id, username, cash, bank FROM players WHERE discord_id = ? LIMIT 1`,
                    [targetId]
                );
                if (rows.length === 0) {
                    return await interaction.update(
                        await buildAdminPlayerPanel(
                            interaction.user.id,
                            null,
                            { type: 'danger', text: 'Akun warga tidak ditemukan.' },
                            now
                        )
                    );
                }
                return await interaction.update(
                    buildAdminPlayerConfirmPanel({
                        ownerId: interaction.user.id,
                        targetRow: rows[0],
                        actionType: 'reset',
                        now
                    })
                );
            },
            async ask_delete(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const targetId = parsed.arg || '';
                const rows = await query(
                    `SELECT discord_id, username, cash, bank FROM players WHERE discord_id = ? LIMIT 1`,
                    [targetId]
                );
                if (rows.length === 0) {
                    return await interaction.update(
                        await buildAdminPlayerPanel(
                            interaction.user.id,
                            null,
                            { type: 'danger', text: 'Akun warga tidak ditemukan.' },
                            now
                        )
                    );
                }
                return await interaction.update(
                    buildAdminPlayerConfirmPanel({
                        ownerId: interaction.user.id,
                        targetRow: rows[0],
                        actionType: 'delete',
                        now
                    })
                );
            },
            async confirm_reset(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const targetId = parsed.arg || '';
                const res = await resetPlayerAccount(targetId, interaction.user.id, now);
                if (!res.ok) {
                    return await interaction.update(
                        await buildAdminPlayerPanel(
                            interaction.user.id,
                            null,
                            { type: 'danger', text: res.error },
                            now
                        )
                    );
                }
                return await interaction.update(
                    await buildAdminPlayerPanel(
                        interaction.user.id,
                        targetId,
                        {
                            type: 'success',
                            text: `🔄 Progres akun **${res.username}** (<@${targetId}>) berhasil di-reset ke Titik Nol (Zero-Start)! Harta sebelumnya yang dihapus: ${formatLp(res.prevWealth)}.`
                        },
                        now
                    )
                );
            },
            async confirm_delete(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const targetId = parsed.arg || '';
                const res = await deletePlayerAccount(targetId, interaction.user.id, now);
                if (!res.ok) {
                    return await interaction.update(
                        await buildAdminPlayerPanel(
                            interaction.user.id,
                            null,
                            { type: 'danger', text: res.error },
                            now
                        )
                    );
                }
                return await interaction.update(
                    await buildAdminPlayerPanel(
                        interaction.user.id,
                        null,
                        {
                            type: 'danger',
                            text: `🗑️ Akun **${res.username}** (<@${targetId}>) telah dihapus permanen dari database! (Harta terakhir: ${formatLp(res.prevWealth)}).`
                        },
                        now
                    )
                );
            },
            async stop_event(interaction) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                await withTransaction(conn => stopSeasonalEvent(conn, now));
                return await interaction.update(
                    await buildAdminEventPanel(
                        interaction.user.id,
                        { type: 'warning', text: '⏹️ Event musiman aktif telah dihentikan.' },
                        now
                    )
                );
            },
            async weather(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const mode = parsed.arg || 'auto';
                const w = await withTransaction(conn => setWeatherOverride(conn, mode, now));
                return await interaction.update(
                    await buildAdminEventPanel(
                        interaction.user.id,
                        { type: 'success', text: `🌦️ Cuaca diatur ke **${w.emoji} ${w.name}** (Mode: ${mode}).` },
                        now
                    )
                );
            },
            async toggle_cfg(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const key = parsed.arg || '';
                const liveCfg = await withTransaction(conn => getLiveEconomyConfig(conn));
                const nextVal = !Boolean(liveCfg[key]);
                await query(
                    `INSERT INTO economy_config (cfg_key, cfg_value, updated_at)
                     VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE cfg_value = VALUES(cfg_value), updated_at = VALUES(updated_at)`,
                    [key, JSON.stringify(nextVal), now]
                );
                return await interaction.update(
                    await buildAdminConfigPanel(
                        interaction.user.id,
                        { type: 'success', text: `⚙️ Parameter \`${key}\` diubah menjadi **${nextVal ? 'ON' : 'OFF'}**.` },
                        now
                    )
                );
            }
        },
        selects: {
            async pick_user(interaction) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const targetId = interaction.values[0] || '';
                const check = await query(`SELECT discord_id FROM players WHERE discord_id = ? LIMIT 1`, [targetId]);
                if (check.length === 0) {
                    return await interaction.update(
                        await buildAdminPlayerPanel(
                            interaction.user.id,
                            null,
                            { type: 'warning', text: `User <@${targetId}> belum terdaftar sebagai warga di database.` },
                            now
                        )
                    );
                }
                return await interaction.update(await buildAdminPlayerPanel(interaction.user.id, targetId, null, now));
            },
            async inspect_sus(interaction) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const targetId = interaction.values[0] || '';
                return await interaction.update(await buildAdminPlayerPanel(interaction.user.id, targetId, null, now));
            },
            async log_filter(interaction) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const [targetId, filterCat = 'all'] = String(interaction.values[0] || '').split('|');
                return await interaction.update(
                    await buildAdminPlayerLogsPanel(interaction.user.id, targetId, filterCat, 1, null, now)
                );
            },
            async start_event(interaction) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const eventId = interaction.values[0] || 'lebaran';
                const started = await withTransaction(conn => startSeasonalEvent(conn, eventId, 7, now));
                return await interaction.update(
                    await buildAdminEventPanel(
                        interaction.user.id,
                        { type: 'success', text: `🎉 Event **${started.config.emoji} ${started.config.name}** dimulai selama 7 hari!` },
                        now
                    )
                );
            },
            async set_mult(interaction) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const [key, valStr] = String(interaction.values[0] || '').split('|');
                const val = Number(valStr) || 1.0;
                await query(
                    `INSERT INTO economy_config (cfg_key, cfg_value, updated_at)
                     VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE cfg_value = VALUES(cfg_value), updated_at = VALUES(updated_at)`,
                    [key, JSON.stringify(val), now]
                );
                return await interaction.update(
                    await buildAdminConfigPanel(
                        interaction.user.id,
                        { type: 'success', text: `⚙️ Parameter \`${key}\` diatur ke **${val}x**.` },
                        now
                    )
                );
            }
        },
        modals: {
            async give_cash_submit(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const targetId = parsed.arg || '';
                const parsedNum = parseModalNumber(interaction, 'amount', { min: 1 });
                if (!parsedNum.ok) {
                    return await respondOrUpdate(
                        interaction,
                        await buildAdminPlayerPanel(interaction.user.id, targetId, { type: 'warning', text: parsedNum.error }, now)
                    );
                }

                await withTransaction(async (conn) => {
                    const [rows] = await conn.execute(`SELECT cash, bank FROM players WHERE discord_id = ? FOR UPDATE`, [targetId]);
                    if (rows.length === 0) return;
                    const nextCash = Number(rows[0].cash || 0) + parsedNum.value;
                    await conn.execute(`UPDATE players SET cash = ? WHERE discord_id = ?`, [nextCash, targetId]);
                    await conn.execute(
                        `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
                         VALUES (?, 'faucet', 'admin_give', ?, ?, ?, ?)`,
                        [targetId, parsedNum.value, nextCash + Number(rows[0].bank || 0), JSON.stringify({ adminId: interaction.user.id }), now]
                    );
                });

                return await respondOrUpdate(
                    interaction,
                    await buildAdminPlayerPanel(
                        interaction.user.id,
                        targetId,
                        { type: 'success', text: `➕ Berhasil menambahkan **+${formatLp(parsedNum.value)}** ke <@${targetId}>.` },
                        now
                    )
                );
            },
            async take_cash_submit(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const targetId = parsed.arg || '';
                const parsedNum = parseModalNumber(interaction, 'amount', { min: 1 });
                if (!parsedNum.ok) {
                    return await respondOrUpdate(
                        interaction,
                        await buildAdminPlayerPanel(interaction.user.id, targetId, { type: 'warning', text: parsedNum.error }, now)
                    );
                }

                await withTransaction(async (conn) => {
                    const [rows] = await conn.execute(`SELECT cash, bank FROM players WHERE discord_id = ? FOR UPDATE`, [targetId]);
                    if (rows.length === 0) return;
                    const curCash = Number(rows[0].cash || 0);
                    const nextCash = Math.max(0, curCash - parsedNum.value);
                    const delta = curCash - nextCash;
                    await conn.execute(`UPDATE players SET cash = ? WHERE discord_id = ?`, [nextCash, targetId]);
                    if (delta > 0) {
                        await conn.execute(
                            `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
                             VALUES (?, 'sink', 'admin_take', ?, ?, ?, ?)`,
                            [targetId, delta, nextCash + Number(rows[0].bank || 0), JSON.stringify({ adminId: interaction.user.id }), now]
                        );
                    }
                });

                return await respondOrUpdate(
                    interaction,
                    await buildAdminPlayerPanel(
                        interaction.user.id,
                        targetId,
                        { type: 'success', text: `➖ Berhasil mengurangi **-${formatLp(parsedNum.value)}** dari <@${targetId}>.` },
                        now
                    )
                );
            },
            async give_item_submit(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const targetId = parsed.arg || '';
                const itemId = (interaction.fields.getTextInputValue('item_id') || '').trim().toLowerCase();
                const qty = Math.max(1, parseInt(interaction.fields.getTextInputValue('qty') || '1', 10) || 1);
                const it = getItem(itemId);

                if (!it) {
                    return await respondOrUpdate(
                        interaction,
                        await buildAdminPlayerPanel(
                            interaction.user.id,
                            targetId,
                            { type: 'danger', text: `Item \`${itemId}\` tidak ditemukan di katalog.` },
                            now
                        )
                    );
                }

                await withTransaction(conn => addItem(conn, targetId, it.id, qty, now));
                return await respondOrUpdate(
                    interaction,
                    await buildAdminPlayerPanel(
                        interaction.user.id,
                        targetId,
                        { type: 'success', text: `📦 Berhasil memberikan **${qty}× ${it.emoji} ${it.name}** ke <@${targetId}>.` },
                        now
                    )
                );
            },
            async warn_submit(interaction, parsed, client) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const targetId = parsed.arg || '';
                const reason = (interaction.fields.getTextInputValue('reason') || '').trim();

                const res = await issuePlayerWarning(client || interaction.client, {
                    targetId,
                    adminId: interaction.user.id,
                    reason,
                    now
                });

                const dmInfo = res.dmSent
                    ? '📩 Pesan DM terkirim.'
                    : '📌 DM user terkunci (kartu peringatan otomatis dicegat di in-game saat ia pakai command).';

                const bannerText = res.autoBanned
                    ? `🔨 Warning ke-${res.activeCount}/${MAX_WARNINGS_BEFORE_AUTOBAN} diterbitkan! Akun <@${targetId}> **otomatis di-BAN**. (${dmInfo})`
                    : `⚠️ Warning ke-${res.activeCount}/${MAX_WARNINGS_BEFORE_AUTOBAN} berhasil dikirim ke <@${targetId}>! (${dmInfo})`;

                return await respondOrUpdate(
                    interaction,
                    await buildAdminPlayerPanel(
                        interaction.user.id,
                        targetId,
                        { type: res.autoBanned ? 'danger' : 'warning', text: bannerText },
                        now
                    )
                );
            }
        }
    },

    buildAdminPlayerPanelFromData,
    buildAdminPlayerConfirmPanel,
    buildAdminPlayerLogsPanelFromData,
    buildAdminSusRadarPanelFromData
};
