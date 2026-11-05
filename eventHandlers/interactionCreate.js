const { acquireUserLock, releaseUserLock, recordActiveUser } = require('../database/redis');
const {
    buildWelcomeCardPayload,
    buildRegistrationModal,
    getPlayerBasic,
    processRegistrationModal
} = require('../services/onboardingService');
const {
    logPlayerActivity,
    getUnacknowledgedWarnings,
    acknowledgePlayerWarnings,
    buildWarningInterceptPayload
} = require('../services/moderationService');
const { buildHelpCategoryPayload } = require('../commands/onboarding/help');
const { fetchJobState, buildJobPanel } = require('../commands/career/job');
const { COLORS, buildV2Card } = require('../utils/uiBuilder');
const panelRouter = require('../services/panelRouter');

module.exports = {
    name: 'interactionCreate',
    async handle(interaction, client) {
        try {
            // ==========================================
            // 1. AUTOCOMPLETE
            // ==========================================
            if (interaction.isAutocomplete()) {
                const command = client.commands.get(interaction.commandName);
                if (command && typeof command.autocomplete === 'function') {
                    await command.autocomplete(interaction);
                }
                return;
            }

            // ==========================================
            // 2. SLASH COMMAND (CHAT INPUT)
            // ==========================================
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) return;

                const userId = interaction.user.id;
                await recordActiveUser(userId);

                if (!command.skipRegistrationCheck) {
                    const player = await getPlayerBasic(userId);
                    if (!player) {
                        return await interaction.reply(buildWelcomeCardPayload(true));
                    }
                    if (Number(player.is_banned) === 1) {
                        return await interaction.reply(
                            buildV2Card({
                                accentColor: COLORS.DANGER,
                                title: '🔨 Akun Dibekukan',
                                blocks: ['Akun karaktermu telah dibekukan oleh Administrator karena pelanggaran aturan ekonomi.'],
                                ephemeral: true
                            })
                        );
                    }

                    const unackWarnings = await getUnacknowledgedWarnings(userId);
                    if (unackWarnings.length > 0) {
                        const warnPayload = await buildWarningInterceptPayload(userId, unackWarnings);
                        return await interaction.reply(warnPayload);
                    }
                }

                await logPlayerActivity(null, userId, 'command', `slash:${interaction.commandName}`, {}, Date.now());

                const lockTtl = Number(command.lockTtl) || 15;
                const lockToken = await acquireUserLock(userId, lockTtl);
                if (!lockToken) {
                    return await interaction.reply(
                        buildV2Card({
                            accentColor: COLORS.WARNING,
                            title: '⏳ Sedang Memproses Perintah Sebelumnya',
                            blocks: ['Selesaikan atau tunggu perintahmu sebelumnya selesai diproses terlebih dahulu.'],
                            ephemeral: true
                        })
                    );
                }

                try {
                    await command.executeSlash(interaction);
                } finally {
                    await releaseUserLock(userId, lockToken);
                }
                return;
            }

            // ==========================================
            // 3. BUTTON INTERACTIONS
            // ==========================================
            if (interaction.isButton()) {
                if (await panelRouter.dispatch(interaction, client)) {
                    return;
                }

                const cid = interaction.customId;
                const userId = interaction.user.id;

                if (cid.startsWith('warn_ack_btn:')) {
                    const targetOwner = cid.split(':')[1] || '';
                    if (targetOwner !== userId) {
                        return await interaction.reply(
                            buildV2Card({
                                accentColor: COLORS.WARNING,
                                title: '🔒 Bukan Peringatan Milikmu',
                                blocks: ['Tombol konfirmasi peringatan ini hanya untuk pemilik akun terkait.'],
                                ephemeral: true
                            })
                        );
                    }
                    await acknowledgePlayerWarnings(userId);
                    return await interaction.update(
                        buildV2Card({
                            accentColor: COLORS.SUCCESS,
                            title: '✅ Peringatan Telah Dikonfirmasi',
                            blocks: [
                                'Terima kasih telah membaca peringatan resmi Administrator. Silakan jalankan kembali perintah permainanmu dengan tertib!'
                            ],
                            ephemeral: true
                        })
                    );
                }

                // Tombol milik collector lokal mini-game di /work, /fishing, /mining diabaikan di sini
                if (
                    cid.startsWith('work_mg_') ||
                    cid.startsWith('fish_pull_') ||
                    cid.startsWith('mine_swing_')
                ) {
                    return;
                }

                if (cid === 'reg_open_modal') {
                    const existing = await getPlayerBasic(userId);
                    if (existing) {
                        return await interaction.reply(
                            buildV2Card({
                                accentColor: COLORS.PRIMARY,
                                title: 'ℹ️ Karakter Sudah Aktif',
                                blocks: [`Kamu sudah terdaftar sebagai **${existing.username}**! Gunakan \`/profile\` atau \`/help\`.`],
                                ephemeral: true
                            })
                        );
                    }
                    return await interaction.showModal(buildRegistrationModal(false));
                }

                if (cid === 'help_open_home') {
                    const payload = await buildHelpCategoryPayload(userId, 'home', true);
                    return await interaction.reply(payload);
                }

                if (cid === 'job_quick_list') {
                    const player = await getPlayerBasic(userId);
                    if (!player) {
                        return await interaction.reply(buildWelcomeCardPayload(true));
                    }
                    const now = Date.now();
                    const state = await fetchJobState(userId, now);
                    return await interaction.reply(buildJobPanel({ state, now }));
                }

                return;
            }

            // ==========================================
            // 4. SELECT MENU INTERACTIONS
            // ==========================================
            if (typeof interaction.isAnySelectMenu === 'function' ? interaction.isAnySelectMenu() : interaction.isStringSelectMenu()) {
                await panelRouter.dispatch(interaction, client);
                return;
            }

            // ==========================================
            // 5. MODAL SUBMIT INTERACTIONS
            // ==========================================
            if (interaction.isModalSubmit()) {
                if (await panelRouter.dispatch(interaction, client)) {
                    return;
                }

                const cid = interaction.customId;
                if (cid === 'reg_submit_modal') {
                    return await processRegistrationModal(interaction);
                }
            }
        } catch (error) {
            console.error('[INTERACTION ERROR]', error);
            const errPayload = buildV2Card({
                accentColor: COLORS.DANGER,
                title: '❌ Terjadi Kesalahan Internal',
                blocks: ['Maaf, terjadi kendala saat menjalankan interaksi ini. Silakan coba beberapa saat lagi.'],
                ephemeral: true
            });
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errPayload).catch(() => {});
            } else {
                await interaction.reply(errPayload).catch(() => {});
            }
        }
    }
};
