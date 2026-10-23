const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildWelcomeCardPayload, getPlayerBasic } = require('../../services/onboardingService');
const { COLORS, formatLp, formatVitalsCompact, buildV2Card } = require('../../utils/uiBuilder');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');

module.exports = {
    name: 'start',
    slash: true,
    skipRegistrationCheck: true,
    data: new SlashCommandBuilder()
        .setName('start')
        .setDescription('Mulai kehidupan barumu di Life Simulation atau lihat status awalmu.'),

    async executeSlash(interaction) {
        const existing = await getPlayerBasic(interaction.user.id);
        if (!existing) {
            return await interaction.reply(buildWelcomeCardPayload(true));
        }

        const synced = await withTransaction(conn => syncPlayerVitals(conn, interaction.user.id));
        const p = synced.player;

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('help_open_home')
                .setLabel('Panduan (/help)')
                .setEmoji('📖')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('job_quick_list')
                .setLabel('Lowongan Kerja')
                .setEmoji('💼')
                .setStyle(ButtonStyle.Success)
        );

        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.PRIMARY,
                title: `👋 Halo kembali, ${p.username}!`,
                blocks: [
                    `Karaktermu sudah terdaftar dan siap beraktivitas.`,
                    `💵 **Dompet:** ${formatLp(p.cash)} · 🏦 **Bank:** ${formatLp(p.bank)}\n${formatVitalsCompact(p)}`
                ],
                actionRows: [row],
                ephemeral: true
            })
        );
    }
};
