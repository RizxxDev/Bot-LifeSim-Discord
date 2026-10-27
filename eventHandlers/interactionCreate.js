const { withTransaction } = require('../database/mariadb');
const { acquireUserLock, releaseUserLock, recordActiveUser } = require('../database/redis');
const {
    buildWelcomeCardPayload,
    buildRegistrationModal,
    buildRegistrationErrorPayload,
    getPlayerBasic,
    processRegistrationModal
} = require('../services/onboardingService');
const { syncPlayerVitals } = require('../services/vitalService');
const { getLiveEconomyConfig } = require('../services/economyService');
const { removeItem } = require('../services/inventoryService');
const {
    getEffectiveItemPrice,
    buildShopViewPayload,
    buildItemQuantityPickerPayload,
    buildCustomBuyModal,
    executeItemPurchase,
    executeBackpackUpgrade,
    buildPurchaseResultPayload
} = require('../services/shopService');
const { buildHelpCategoryPayload } = require('../commands/onboarding/help');
const { buildJobListPayload } = require('../commands/career/job');
const { handleRepairAllTools } = require('../commands/economy/inventory');
const { handleFarmQuickAction } = require('../commands/activities/farm');
const { handleCookQuickCollect } = require('../commands/activities/cook');
const { getItem } = require('../data/items');
const { COLORS, formatLp, buildV2Card, validateUsername } = require('../utils/uiBuilder');

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
                }

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
                const cid = interaction.customId;
                const userId = interaction.user.id;

                // Tombol milik collector lokal di /work, /fishing, /mining, /buy diabaikan di sini
                if (
                    cid.startsWith('work_mg_') ||
                    cid.startsWith('fish_pull_') ||
                    cid.startsWith('mine_swing_') ||
                    cid.startsWith('buy_confirm_') ||
                    cid.startsWith('buy_cancel_')
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

                if (cid === 'rename_open_modal') {
                    return await interaction.showModal(buildRegistrationModal(true));
                }

                if (cid === 'help_open_home') {
                    const payload = await buildHelpCategoryPayload(userId, 'home', true);
                    return await interaction.reply(payload);
                }

                // Pastikan user sudah terdaftar untuk tombol fitur game di bawah ini
                const player = await getPlayerBasic(userId);
                if (!player) {
                    return await interaction.reply(buildWelcomeCardPayload(true));
                }

                if (cid === 'job_quick_list') {
                    const payload = await buildJobListPayload(userId, true);
                    return await interaction.reply(payload);
                }

                if (cid.startsWith('farm_quick_')) {
                    const actionType = cid.replace('farm_quick_', '');
                    return await handleFarmQuickAction(interaction, actionType);
                }

                if (cid === 'cook_quick_collect') {
                    return await handleCookQuickCollect(interaction);
                }

                if (cid.startsWith('shop_jump_')) {
                    const shopId = cid.replace('shop_jump_', '');
                    const payload = await buildShopViewPayload(userId, shopId, 0, true);
                    return await interaction.reply(payload);
                }

                if (cid.startsWith('shop_page_')) {
                    const parts = cid.replace('shop_page_', '').split('_');
                    const page = Number(parts.pop());
                    const shopId = parts.join('_');
                    const payload = await buildShopViewPayload(userId, shopId, page, false);
                    return await interaction.update(payload);
                }

                if (cid.startsWith('shop_pick_')) {
                    const itemId = cid.replace('shop_pick_', '');
                    const item = getItem(itemId);
                    if (!item) return;
                    const liveCfg = await withTransaction(conn => getLiveEconomyConfig(conn));
                    const unitPrice = getEffectiveItemPrice(item, liveCfg);
                    return await interaction.reply(buildItemQuantityPickerPayload(item, unitPrice));
                }

                if (cid.startsWith('shop_execbuy_')) {
                    const rest = cid.replace('shop_execbuy_', '');
                    const lastUnderscore = rest.lastIndexOf('_');
                    const itemId = rest.slice(0, lastUnderscore);
                    const qty = Number(rest.slice(lastUnderscore + 1));

                    const res = await executeItemPurchase(userId, itemId, qty, Date.now());
                    return await interaction.reply(buildPurchaseResultPayload(res, true));
                }

                if (cid.startsWith('shop_modalbuy_')) {
                    const itemId = cid.replace('shop_modalbuy_', '');
                    const item = getItem(itemId);
                    if (!item) return;
                    return await interaction.showModal(buildCustomBuyModal(item));
                }

                if (cid === 'shop_upgrade_bag') {
                    const res = await executeBackpackUpgrade(userId, Date.now());
                    if (res.error === 'MAX_TIER') {
                        return await interaction.reply(
                            buildV2Card({
                                accentColor: COLORS.SUCCESS,
                                title: '🎒 Kapasitas Tas Sudah Maksimal!',
                                blocks: [`Kamu sudah memiliki **${res.currentBag.emoji} ${res.currentBag.name} (${res.currentBag.slots} slot)**.`],
                                ephemeral: true
                            })
                        );
                    }
                    if (res.error === 'INSUFFICIENT_FUNDS') {
                        return await interaction.reply(
                            buildV2Card({
                                accentColor: COLORS.DANGER,
                                title: '💸 Saldo Tidak Cukup untuk Upgrade Tas',
                                blocks: [
                                    `Harga upgrade ke **${res.nextBag.emoji} ${res.nextBag.name} (${res.nextBag.slots} slot)** adalah **${formatLp(res.nextBag.price)}**, sedangkan saldo Cash + Bank kamu **${formatLp(res.totalBalance)}**.`
                                ],
                                ephemeral: true
                            })
                        );
                    }
                    return await interaction.reply(
                        buildV2Card({
                            accentColor: COLORS.SUCCESS,
                            title: `🎒 Tas Di-upgrade: ${res.nextBag.emoji} ${res.nextBag.name}!`,
                            blocks: [
                                `Kapasitas tasmu kini meningkat menjadi **${res.nextBag.slots} slot**!`,
                                `• 💳 **Biaya Upgrade:** ${formatLp(res.nextBag.price)}\n• 💵 **Sisa Cash:** ${formatLp(res.player.cash)} · 🏦 **Sisa Bank:** ${formatLp(res.player.bank)}`
                            ],
                            ephemeral: true
                        })
                    );
                }

                if (cid === 'inv_repair_all') {
                    const res = await handleRepairAllTools(userId, Date.now());
                    if (res.error === 'NONE_DAMAGED') {
                        return await interaction.reply(
                            buildV2Card({
                                accentColor: COLORS.SUCCESS,
                                title: '✨ Semua Alat Masih Prima',
                                blocks: ['Tidak ada peralatan di tasmu yang membutuhkan perbaikan.'],
                                ephemeral: true
                            })
                        );
                    }
                    if (res.error === 'INSUFFICIENT_FUNDS') {
                        return await interaction.reply(
                            buildV2Card({
                                accentColor: COLORS.DANGER,
                                title: '💸 Saldo Tidak Cukup untuk Perbaikan',
                                blocks: [
                                    `Total biaya perbaikan adalah **${formatLp(res.totalCost)}**, sedangkan saldo Cash + Bank kamu hanya **${formatLp(res.totalBalance)}**.`
                                ],
                                ephemeral: true
                            })
                        );
                    }
                    const list = res.repaired.map(d => `• ${d.item.emoji} **${d.item.name}** (\`${d.currentDurability} → ${d.maxDurability}\`)`).join('\n');
                    return await interaction.reply(
                        buildV2Card({
                            accentColor: COLORS.SUCCESS,
                            title: '🔧 Peralatan Berhasil Diperbaiki!',
                            blocks: [
                                list,
                                `💳 **Total Biaya Perbaikan:** **${formatLp(res.totalCost)}**\n💵 **Sisa Cash:** ${formatLp(res.player.cash)} · 🏦 **Sisa Bank:** ${formatLp(res.player.bank)}`
                            ],
                            ephemeral: true
                        })
                    );
                }
                return;
            }

            // ==========================================
            // 4. SELECT MENU INTERACTIONS
            // ==========================================
            if (interaction.isStringSelectMenu()) {
                const cid = interaction.customId;
                const selected = interaction.values[0];
                const userId = interaction.user.id;

                if (cid === 'help_select_category') {
                    const payload = await buildHelpCategoryPayload(userId, selected, true);
                    return await interaction.update(payload);
                }

                if (cid === 'shop_select_store') {
                    const player = await getPlayerBasic(userId);
                    if (!player) {
                        return await interaction.reply(buildWelcomeCardPayload(true));
                    }
                    const payload = await buildShopViewPayload(userId, selected, 0, false);
                    return await interaction.update(payload);
                }
                return;
            }

            // ==========================================
            // 5. MODAL SUBMIT INTERACTIONS
            // ==========================================
            if (interaction.isModalSubmit()) {
                const cid = interaction.customId;
                const userId = interaction.user.id;

                if (cid === 'reg_submit_modal') {
                    return await processRegistrationModal(interaction);
                }

                if (cid === 'rename_submit_modal') {
                    const rawName = interaction.fields.getTextInputValue('username_input');
                    const val = validateUsername(rawName);
                    if (!val.valid) {
                        return await interaction.reply(buildRegistrationErrorPayload(val.reason, true));
                    }

                    try {
                        await withTransaction(async (conn) => {
                            const [dup] = await conn.execute(
                                `SELECT discord_id FROM players WHERE username_lower = ? AND discord_id != ? LIMIT 1`,
                                [val.usernameLower, userId]
                            );
                            if (dup.length > 0) {
                                throw new Error('USERNAME_TAKEN');
                            }
                            const consumed = await removeItem(conn, userId, 'surat_ganti_nama', 1);
                            if (!consumed) {
                                throw new Error('NO_RENAME_ITEM');
                            }
                            await conn.execute(
                                `UPDATE players SET username = ?, username_lower = ? WHERE discord_id = ?`,
                                [val.username, val.usernameLower, userId]
                            );
                        });
                    } catch (err) {
                        if (err.message === 'USERNAME_TAKEN' || err.code === 'ER_DUP_ENTRY') {
                            return await interaction.reply(
                                buildRegistrationErrorPayload(`Username **\`${val.username}\`** sudah digunakan warga lain!`, true)
                            );
                        }
                        if (err.message === 'NO_RENAME_ITEM') {
                            return await interaction.reply(
                                buildV2Card({
                                    accentColor: COLORS.DANGER,
                                    title: '❌ Akta Ganti Nama Tidak Ditemukan',
                                    blocks: ['Kamu tidak memiliki **📜 Akta Ganti Nama Resmi** di tasmu.'],
                                    ephemeral: true
                                })
                            );
                        }
                        throw err;
                    }

                    return await interaction.reply(
                        buildV2Card({
                            accentColor: COLORS.SUCCESS,
                            title: '📜 Perubahan Nama Resmi Disetujui!',
                            blocks: [`Identitas karaktermu kini telah resmi berganti menjadi **${val.username}**!`],
                            ephemeral: true
                        })
                    );
                }

                if (cid.startsWith('shop_modalsubmit_')) {
                    const itemId = cid.replace('shop_modalsubmit_', '');
                    const rawQty = interaction.fields.getTextInputValue('buy_amount_input');
                    const qty = Math.floor(Number(rawQty.replace(/[^0-9]/g, '')));
                    if (!qty || qty <= 0 || qty > 100) {
                        return await interaction.reply(
                            buildV2Card({
                                accentColor: COLORS.WARNING,
                                title: '⚠️ Jumlah Tidak Valid',
                                blocks: ['Masukkan angka jumlah barang antara **1 sampai 100**.'],
                                ephemeral: true
                            })
                        );
                    }
                    const res = await executeItemPurchase(userId, itemId, qty, Date.now());
                    return await interaction.reply(buildPurchaseResultPayload(res, true));
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
