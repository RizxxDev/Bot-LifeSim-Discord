const { SlashCommandBuilder } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { COLORS, formatLp, buildV2Card } = require('../../utils/uiBuilder');

module.exports = {
    name: 'deposit',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('deposit')
        .setDescription('Setor uang tunai (Cash) ke rekening Bank.')
        .addStringOption(opt =>
            opt
                .setName('amount')
                .setDescription('Jumlah Lp yang ingin disetor (atau ketik "all" untuk semua cash)')
                .setRequired(true)
        ),

    async executeSlash(interaction) {
        const raw = interaction.options.getString('amount', true).trim().toLowerCase();
        const discordId = interaction.user.id;

        const res = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, Date.now(), true);
            const p = synced.player;
            const currentCash = Number(p.cash || 0);

            let amount = 0;
            if (raw === 'all' || raw === 'semua' || raw === 'max') {
                amount = currentCash;
            } else {
                amount = Math.floor(Number(raw.replace(/[^0-9]/g, '')));
            }

            if (!amount || amount <= 0) {
                return { error: 'INVALID_AMOUNT' };
            }
            if (amount > currentCash) {
                return { error: 'INSUFFICIENT_CASH', currentCash };
            }

            p.cash = currentCash - amount;
            p.bank = Number(p.bank || 0) + amount;

            await conn.execute(
                `UPDATE players SET cash = ?, bank = ? WHERE discord_id = ?`,
                [p.cash, p.bank, discordId]
            );

            return { amount, player: p };
        });

        if (res.error === 'INVALID_AMOUNT') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '⚠️ Nominal Tidak Valid',
                    blocks: ['Masukkan angka positif (contoh: `50000`) atau ketik `all` untuk menyetor seluruh uang tunai.'],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'INSUFFICIENT_CASH') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '❌ Uang Tunai Tidak Cukup',
                    blocks: [`Saldo Cash di dompetmu saat ini hanya **${formatLp(res.currentCash)}**.`],
                    ephemeral: true
                })
            );
        }

        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.SUCCESS,
                title: '🏦 Setoran Tunai Berhasil',
                blocks: [
                    `Kamu menyetor **${formatLp(res.amount)}** ke rekening Bank.`,
                    `• 💵 **Sisa Cash:** ${formatLp(res.player.cash)}\n• 🏦 **Saldo Bank:** ${formatLp(res.player.bank)}`
                ],
                ephemeral: true
            })
        );
    }
};
