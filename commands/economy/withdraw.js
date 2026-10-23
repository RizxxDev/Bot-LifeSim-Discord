const { SlashCommandBuilder } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { COLORS, formatLp, buildV2Card } = require('../../utils/uiBuilder');

module.exports = {
    name: 'withdraw',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('withdraw')
        .setDescription('Tarik uang dari rekening Bank ke dompet (Cash).')
        .addStringOption(opt =>
            opt
                .setName('amount')
                .setDescription('Jumlah Lp yang ingin ditarik (atau ketik "all" untuk semua saldo bank)')
                .setRequired(true)
        ),

    async executeSlash(interaction) {
        const raw = interaction.options.getString('amount', true).trim().toLowerCase();
        const discordId = interaction.user.id;

        const res = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, Date.now(), true);
            const p = synced.player;
            const currentBank = Number(p.bank || 0);

            let amount = 0;
            if (raw === 'all' || raw === 'semua' || raw === 'max') {
                amount = currentBank;
            } else {
                amount = Math.floor(Number(raw.replace(/[^0-9]/g, '')));
            }

            if (!amount || amount <= 0) {
                return { error: 'INVALID_AMOUNT' };
            }
            if (amount > currentBank) {
                return { error: 'INSUFFICIENT_BANK', currentBank };
            }

            p.bank = currentBank - amount;
            p.cash = Number(p.cash || 0) + amount;

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
                    blocks: ['Masukkan angka positif (contoh: `50000`) atau ketik `all` untuk menarik seluruh tabungan bank.'],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'INSUFFICIENT_BANK') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '❌ Saldo Bank Tidak Cukup',
                    blocks: [`Saldo tabungan Bank kamu saat ini hanya **${formatLp(res.currentBank)}**.`],
                    ephemeral: true
                })
            );
        }

        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.SUCCESS,
                title: '💵 Penarikan Bank Berhasil',
                blocks: [
                    `Kamu menarik **${formatLp(res.amount)}** dari Bank ke dompet.`,
                    `• 💵 **Saldo Cash:** ${formatLp(res.player.cash)}\n• 🏦 **Sisa Bank:** ${formatLp(res.player.bank)}`
                ],
                ephemeral: true
            })
        );
    }
};
