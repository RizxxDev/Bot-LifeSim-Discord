const { SlashCommandBuilder } = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { getActiveUserCount } = require('../../database/redis');
const { getLiveEconomyConfig } = require('../../services/economyService');
const { addItem, removeItem } = require('../../services/inventoryService');
const { getItem } = require('../../data/items');
const { COLORS, formatLp, buildV2Card } = require('../../utils/uiBuilder');

function isOwner(userId) {
    const ownerIds = String(process.env.OWNER_ID || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    return ownerIds.includes(userId);
}

module.exports = {
    name: 'admin',
    slash: true,
    isAdminCommand: true,
    skipRegistrationCheck: true,
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('🔒 Panel kendali ekonomi dan moderasi khusus Owner Bot.')
        .addSubcommand(sub =>
            sub.setName('stats').setDescription('Lihat dashboard makro ekonomi: total Lp beredar, inflow vs outflow 24 jam, & rasio sink.')
        )
        .addSubcommand(sub =>
            sub
                .setName('config')
                .setDescription('Ubah tuas pengali ekonomi secara live tanpa redeploy.')
                .addStringOption(opt =>
                    opt
                        .setName('key')
                        .setDescription('Parameter yang ingin diubah')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Pengali Gaji Global (salary_multiplier)', value: 'salary_multiplier' },
                            { name: 'Pengali Harga Jual NPC (sell_multiplier)', value: 'sell_multiplier' },
                            { name: 'Pajak Penghasilan (income_tax_enabled: 1 atau 0)', value: 'income_tax_enabled' },
                            { name: 'Soft Cap Harian (soft_cap_enabled: 1 atau 0)', value: 'soft_cap_enabled' }
                        )
                )
                .addNumberOption(opt =>
                    opt
                        .setName('value')
                        .setDescription('Nilai baru (contoh: 1.0, 1.2, 0.8, atau 1/0 untuk boolean)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('give')
                .setDescription('Berikan uang tunai (Lp) atau item ke warga.')
                .addUserOption(opt => opt.setName('user').setDescription('Target warga').setRequired(true))
                .addIntegerOption(opt => opt.setName('cash').setDescription('Jumlah Lp yang ditambahkan').setRequired(false))
                .addStringOption(opt => opt.setName('item').setDescription('ID item yang ditambahkan').setRequired(false))
                .addIntegerOption(opt => opt.setName('qty').setDescription('Jumlah item').setRequired(false))
        )
        .addSubcommand(sub =>
            sub
                .setName('take')
                .setDescription('Kurangi uang tunai (Lp) atau item dari warga.')
                .addUserOption(opt => opt.setName('user').setDescription('Target warga').setRequired(true))
                .addIntegerOption(opt => opt.setName('cash').setDescription('Jumlah Lp yang dikurangi').setRequired(false))
                .addStringOption(opt => opt.setName('item').setDescription('ID item yang dikurangi').setRequired(false))
                .addIntegerOption(opt => opt.setName('qty').setDescription('Jumlah item').setRequired(false))
        )
        .addSubcommand(sub =>
            sub
                .setName('ban')
                .setDescription('Ban atau unban akun warga dari sistem ekonomi.')
                .addUserOption(opt => opt.setName('user').setDescription('Target warga').setRequired(true))
                .addBooleanOption(opt => opt.setName('status').setDescription('True = Ban, False = Unban').setRequired(true))
        ),

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

        const sub = interaction.options.getSubcommand();
        const now = Date.now();

        if (sub === 'stats') {
            const since24h = now - 86400000;
            const since30d = now - 30 * 86400000;

            const [macroRows] = await Promise.all([
                query(
                    `SELECT
                        COUNT(*) AS total_players,
                        SUM(CASE WHEN last_tick_at >= ? THEN 1 ELSE 0 END) AS active_30d_players,
                        COALESCE(SUM(cash), 0) AS total_cash,
                        COALESCE(SUM(bank), 0) AS total_bank,
                        COALESCE(SUM(CASE WHEN last_tick_at >= ? THEN (cash + bank) ELSE 0 END), 0) AS active_supply
                     FROM players WHERE is_banned = 0`,
                    [since30d, since30d]
                )
            ]);

            const ledgerRows = await query(
                `SELECT type, COALESCE(SUM(amount), 0) AS total_amt
                 FROM economy_ledger
                 WHERE created_at >= ?
                 GROUP BY type`,
                [since24h]
            );

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
            const dau = await getActiveUserCount(now);
            const liveCfg = await withTransaction(conn => getLiveEconomyConfig(conn));

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.ADMIN,
                    title: '📊 Dashboard Makro Ekonomi (Owner Only)',
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
                            `• \`salary_multiplier\` : **${liveCfg.salary_multiplier}x**`,
                            `• \`sell_multiplier\`   : **${liveCfg.sell_multiplier}x**`,
                            `• \`income_tax_enabled\`: **${liveCfg.income_tax_enabled}**`,
                            `• \`soft_cap_enabled\`  : **${liveCfg.soft_cap_enabled}**`
                        ].join('\n')
                    ],
                    ephemeral: true
                })
            );
        }

        if (sub === 'config') {
            const key = interaction.options.getString('key', true);
            const rawVal = interaction.options.getNumber('value', true);
            const finalVal = (key.endsWith('_enabled')) ? Boolean(rawVal) : Number(rawVal);

            await query(
                `INSERT INTO economy_config (cfg_key, cfg_value, updated_at)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE cfg_value = VALUES(cfg_value), updated_at = VALUES(updated_at)`,
                [key, JSON.stringify(finalVal), now]
            );

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: '⚙️ Konfigurasi Ekonomi Diperbarui',
                    blocks: [`Parameter **\`${key}\`** telah diubah menjadi **\`${JSON.stringify(finalVal)}\`** secara langsung.`],
                    ephemeral: true
                })
            );
        }

        if (sub === 'give' || sub === 'take') {
            const targetUser = interaction.options.getUser('user', true);
            const cashDelta = interaction.options.getInteger('cash') || 0;
            const itemId = interaction.options.getString('item')?.toLowerCase();
            const itemQty = interaction.options.getInteger('qty') || 1;
            const isGive = sub === 'give';

            await withTransaction(async (conn) => {
                if (cashDelta > 0) {
                    if (isGive) {
                        await conn.execute(`UPDATE players SET cash = cash + ? WHERE discord_id = ?`, [cashDelta, targetUser.id]);
                    } else {
                        await conn.execute(`UPDATE players SET cash = GREATEST(0, cash - ?) WHERE discord_id = ?`, [cashDelta, targetUser.id]);
                    }
                }
                if (itemId) {
                    const it = getItem(itemId);
                    if (it) {
                        if (isGive) {
                            await addItem(conn, targetUser.id, it.id, itemQty, now);
                        } else {
                            await removeItem(conn, targetUser.id, it.id, itemQty);
                        }
                    }
                }
            });

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `✅ Admin ${isGive ? 'Give' : 'Take'} Selesai`,
                    blocks: [
                        `Target: <@${targetUser.id}>`,
                        cashDelta > 0 ? `• Cash: **${isGive ? '+' : '-'}${formatLp(cashDelta)}**` : null,
                        itemId ? `• Item: **${isGive ? '+' : '-'}${itemQty}× \`${itemId}\`**` : null
                    ],
                    ephemeral: true
                })
            );
        }

        if (sub === 'ban') {
            const targetUser = interaction.options.getUser('user', true);
            const status = interaction.options.getBoolean('status', true);
            await query(`UPDATE players SET is_banned = ? WHERE discord_id = ?`, [status ? 1 : 0, targetUser.id]);

            return await interaction.reply(
                buildV2Card({
                    accentColor: status ? COLORS.DANGER : COLORS.SUCCESS,
                    title: status ? '🔨 Akun Warga Di-Ban' : '🔓 Akun Warga Di-Unban',
                    blocks: [`Status ban untuk <@${targetUser.id}> kini: **${status ? 'BANNED' : 'AKTIF'}**.`],
                    ephemeral: true
                })
            );
        }
    }
};
