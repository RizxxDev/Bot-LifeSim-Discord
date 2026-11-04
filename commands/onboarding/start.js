const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { buildWelcomeCardPayload, getPlayerBasic } = require('../../services/onboardingService');
const { COLORS } = require('../../utils/uiBuilder');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { buildPanel, btn } = require('../../utils/panelBuilder');
const { buildHelpCategoryPayload } = require('./help');
const { fetchJobState, buildJobPanel } = require('../career/job');

function buildStartPanel(player, now = Date.now()) {
    const ownerId = player.discord_id;
    const row = new ActionRowBuilder().addComponents(
        btn('start', 'open_help', ownerId, {
            label: 'Panduan (/help)',
            emoji: '📖',
            style: ButtonStyle.Primary
        }, now),
        btn('start', 'open_job', ownerId, {
            label: 'Lowongan Kerja (/job)',
            emoji: '💼',
            style: ButtonStyle.Success
        }, now),
        btn('start', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary
        }, now)
    );

    return buildPanel({
        mod: 'start',
        ownerId,
        accentColor: COLORS.PRIMARY,
        title: `👋 Halo kembali, ${player.username}!`,
        player,
        blocks: [
            'Karaktermu sudah terdaftar dan siap beraktivitas di kota Life Simulation.',
            'Gunakan tombol pintasan di bawah untuk membuka **Pusat Panduan** atau **Pusat Karir** langsung di panel ini!'
        ],
        rows: [row],
        now
    });
}

module.exports = {
    name: 'start',
    slash: true,
    skipRegistrationCheck: true,
    data: new SlashCommandBuilder()
        .setName('start')
        .setDescription('Mulai kehidupan barumu di Life Simulation atau lihat status awal karaktermu.'),

    async executeSlash(interaction) {
        const existing = await getPlayerBasic(interaction.user.id);
        if (!existing) {
            return await interaction.reply(buildWelcomeCardPayload(true));
        }

        const now = Date.now();
        const synced = await withTransaction(conn => syncPlayerVitals(conn, interaction.user.id, now, false));
        return await interaction.reply(buildStartPanel(synced.player, now));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const synced = await withTransaction(conn => syncPlayerVitals(conn, interaction.user.id, now, false));
                return await interaction.update(buildStartPanel(synced.player, now));
            },
            async open_help(interaction) {
                const now = Date.now();
                const payload = await buildHelpCategoryPayload(interaction.user.id, 'home', false, null, now);
                return await interaction.update(payload);
            },
            async open_job(interaction) {
                const now = Date.now();
                const state = await fetchJobState(interaction.user.id, now);
                return await interaction.update(buildJobPanel({ state, now }));
            }
        }
    }
};
