const { SlashCommandBuilder } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { BANK } = require('../../data/constants');
const { COLORS, formatLp, buildV2Card } = require('../../utils/uiBuilder');

module.exports = {
    name: 'balance',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Lihat saldo Dompet (Cash), Tabungan Bank, dan total kekayaanmu.'),

    async executeSlash(interaction) {
        const synced = await withTransaction(conn => syncPlayerVitals(conn, interaction.user.id, Date.now(), false));
        const p = synced.player;
        const total = Number(p.cash) + Number(p.bank);

        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.ECONOMY,
                title: `🏦 Rekening & Dompet: ${p.username}`,
                blocks: [
                    [
                        `• 💵 **Dompet (Cash):** **${formatLp(p.cash)}**`,
                        `• 🏦 **Tabungan Bank:** **${formatLp(p.bank)}**`,
                        `• 💎 **Total Kekayaan:** **${formatLp(total)}**`
                    ].join('\n'),
                    `💡 **Tips Keamanan:** Uang di **Bank** aman dari potongan persentase biaya Rumah Sakit saat pingsan. Biaya admin bank hanya **${formatLp(BANK.MONTHLY_ADMIN_FEE)}/bulan** (gratis bila saldo bank di bawah ${formatLp(BANK.EXEMPT_BELOW_BALANCE)}).`
                ],
                footer: 'Gunakan /deposit untuk menabung dan /withdraw untuk menarik tunai.',
                ephemeral: true
            })
        );
    }
};
