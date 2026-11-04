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
const { getItem } = require('../../data/items');
const { COLORS, formatLp, buildV2Card } = require('../../utils/uiBuilder');
const { makeId } = require('../../utils/panelId');
const {
    buildPanel,
    btn,
    select,
    userSelect,
    numberModal,
    parseModalNumber
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
        { id: 'stats', label: 'Ekonomi & Pajak', emoji: '📊' },
        { id: 'player', label: 'Kelola Pemain', emoji: '👤' },
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

async function buildAdminPlayerPanel(ownerId, targetId = null, banner = null, now = Date.now()) {
    let targetRow = null;
    if (targetId) {
        const rows = await query(
            `SELECT discord_id, username, cash, bank, current_job, is_banned FROM players WHERE discord_id = ? LIMIT 1`,
            [targetId]
        );
        targetRow = rows[0] || null;
    }

    const blocks = [];
    if (targetRow) {
        blocks.push(
            [
                `👤 **Warga Terpilih:** **${targetRow.username}** (<@${targetRow.discord_id}>)`,
                `• 💵 Cash: **${formatLp(targetRow.cash)}** · 🏦 Bank: **${formatLp(targetRow.bank)}**`,
                `• 💼 Profesi: **${targetRow.current_job || 'Pengangguran'}**`,
                `• 🛡️ Status Akun: ${Number(targetRow.is_banned) === 1 ? '🔴 **BANNED**' : '🟢 **AKTIF**'}`
            ].join('\n')
        );
    } else {
        blocks.push('Pilih warga melalui menu User Select di bawah untuk mengelola saldo, memberikan item, atau mem-ban/unban akun.');
    }

    const rows = [
        buildAdminTabRow(ownerId, 'player', now),
        userSelect('admin', 'pick_user', ownerId, '👤 Pilih Warga untuk Dikelola...', now)
    ];

    if (targetRow) {
        const isBanned = Number(targetRow.is_banned) === 1;
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
                btn('admin', 'toggle_ban', ownerId, {
                    label: isBanned ? 'Unban Warga' : 'Ban Warga',
                    emoji: isBanned ? '🔓' : '🔨',
                    style: isBanned ? ButtonStyle.Success : ButtonStyle.Danger,
                    arg: targetRow.discord_id
                }, now)
            )
        );
    }

    return buildPanel({
        mod: 'admin',
        ownerId,
        accentColor: COLORS.ADMIN,
        title: '🔒 Panel Kendali Owner — Kelola Pemain',
        banner,
        blocks,
        rows,
        ephemeral: true,
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
        .setDescription('🔒 Buka panel kendali ekonomi, pemain, event, & konfigurasi khusus Owner Bot.'),

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
                if (tab === 'event') return await interaction.update(await buildAdminEventPanel(interaction.user.id, null, now));
                if (tab === 'config') return await interaction.update(await buildAdminConfigPanel(interaction.user.id, null, now));
                return await interaction.update(await buildAdminStatsPanel(interaction.user.id, null, now));
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
            async toggle_ban(interaction, parsed) {
                if (!isOwner(interaction.user.id)) return;
                const now = Date.now();
                const targetId = parsed.arg || '';
                const rows = await query(`SELECT is_banned FROM players WHERE discord_id = ? LIMIT 1`, [targetId]);
                if (rows.length > 0) {
                    const nextBan = Number(rows[0].is_banned) === 1 ? 0 : 1;
                    await query(`UPDATE players SET is_banned = ? WHERE discord_id = ?`, [nextBan, targetId]);
                }
                return await interaction.update(
                    await buildAdminPlayerPanel(
                        interaction.user.id,
                        targetId,
                        { type: 'info', text: `Status ban untuk <@${targetId}> telah diperbarui.` },
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
                return await interaction.update(await buildAdminPlayerPanel(interaction.user.id, targetId, null, now));
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
                    return await interaction.update(await buildAdminPlayerPanel(interaction.user.id, targetId, { type: 'warning', text: parsedNum.error }, now));
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

                return await interaction.update(
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
                    return await interaction.update(await buildAdminPlayerPanel(interaction.user.id, targetId, { type: 'warning', text: parsedNum.error }, now));
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

                return await interaction.update(
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
                    return await interaction.update(
                        await buildAdminPlayerPanel(
                            interaction.user.id,
                            targetId,
                            { type: 'danger', text: `Item \`${itemId}\` tidak ditemukan di katalog.` },
                            now
                        )
                    );
                }

                await withTransaction(conn => addItem(conn, targetId, it.id, qty, now));
                return await interaction.update(
                    await buildAdminPlayerPanel(
                        interaction.user.id,
                        targetId,
                        { type: 'success', text: `📦 Berhasil memberikan **${qty}× ${it.emoji} ${it.name}** ke <@${targetId}>.` },
                        now
                    )
                );
            }
        }
    }
};
