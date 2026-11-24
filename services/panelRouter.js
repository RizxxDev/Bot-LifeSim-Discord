const { acquireUserLock, releaseUserLock, recordActiveUser } = require('../database/redis');
const { getPlayerBasic, buildWelcomeCardPayload } = require('./onboardingService');
const { getUnacknowledgedWarnings, buildWarningInterceptPayload } = require('./moderationService');
const {
    settlePlayerTravelIfArrived,
    isCommandAllowedDuringTravel,
    buildTravelStatusInterceptPanel
} = require('./cityService');
const { COLORS, buildV2Card } = require('../utils/uiBuilder');
const { parseId } = require('../utils/panelId');
const { buildExpiredPanel } = require('../utils/panelBuilder');
const { isPropertyModuleDisabled, buildPropertyUnderDevPanel } = require('../utils/featureFlags');
const { trackInteractionPanel, notifyPlayerStateChanged, cancelAutoUpdate } = require('./autoUpdateService');

const registry = new Map();

const READ_ONLY_MODS = new Set(['help', 'leaderboard', 'cooldowns', 'profile']);
const READ_ONLY_ACTIONS = new Set([
    'home', 'me', 'refresh', 'page', 'cat', 'tab', 'list', 'book', 'filter',
    'slot', 'loc', 'bait', 'seed', 'recipe', 'pick_dest', 'user',
    'mode_fert', 'mode_expand', 'rent_prompt', 'buy_prompt',
    'inspect_user', 'open_wardrobe', 'open_butik',
    'floor', 'toggle_mode', 'templates_view', 'meta_view', 'depot_view', 'switch_land',
    'tab_buy_land', 'tab_npc', 'tab_biz_ws', 'tab_market',
    'pick_land', 'buy_city', 'buy_tier', 'pick_npc', 'ws_recipe', 'market_pick', 'p2p_rent_pick',
    'rot_cam', 'palette_mode', 'ascii_modal', 'dup_floor_modal', 'filter_dist', 'inspect_parcel',
    'showcase_view', 'pbb_view', 'offers_view', 'cond_view', 'gallery_view', 'gallery_pick',
    'gallery_city', 'offer_land_pick', 'offer_price_prompt', 'p2p_tab', 'map_tab', 'offers_tab', 'pbb_tab'
]);

function isReadOnlyPanelInteraction(mod, action) {
    if (READ_ONLY_MODS.has(mod)) return true;
    const act = String(action || '');
    if (READ_ONLY_ACTIONS.has(act)) return true;
    if (act.endsWith('_modal') || act.endsWith('_prompt')) return true;
    return false;
}

/**
 * Mendaftarkan handler panel untuk modul command tertentu.
 * @param {string} mod Nama modul/command (contoh: 'bank', 'farm', 'shop')
 * @param {object} handlers Objek berisi { buttons, selects, userSelects, modals }
 * @param {number} [lockTtl=15] Durasi kunci konkurensi Redis dalam detik
 * @param {boolean} [skipRegistrationCheck=false] Lewati cek registrasi (mis. untuk admin)
 */
function registerPanel(mod, handlers, lockTtl = 15, skipRegistrationCheck = false) {
    if (!mod || !handlers) return;
    registry.set(String(mod).trim(), {
        mod: String(mod).trim(),
        handlers,
        lockTtl: Number(lockTtl) || 15,
        skipRegistrationCheck: Boolean(skipRegistrationCheck)
    });
}

function clearRegistry() {
    registry.clear();
}

function getRegisteredPanels() {
    return registry;
}

/**
 * Mengarahkan interaksi tombol, dropdown, user select, atau modal ke handler panel modul terkait.
 * Mengembalikan `true` bila interaksi telah ditangani oleh router, atau `false` bila bukan format panel terdaftar.
 */
async function dispatch(interaction, client, now = Date.now()) {
    const parsed = parseId(interaction.customId, now);
    if (!parsed) {
        return false;
    }

    const entry = registry.get(parsed.mod);
    if (!entry) {
        return false;
    }

    const isPublicButton = Boolean(
        parsed.ownerId === '0' &&
        typeof interaction.isButton === 'function' &&
        interaction.isButton() &&
        entry.handlers?.publicButtons instanceof Set &&
        entry.handlers.publicButtons.has(parsed.action)
    );

    if (!isPublicButton) {
        // 1. Validasi Kepemilikan Panel (Ownership Guard)
        if (parsed.ownerId !== interaction.user.id) {
            await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '🔒 Bukan Panel Milikmu',
                    blocks: [
                        `🔒 Panel ini milik <@${parsed.ownerId}>. Ketik \`/${parsed.mod}\` untuk membuka panelmu sendiri.`
                    ],
                    ephemeral: true
                })
            );
            return true;
        }

        // 2. Validasi Kedaluwarsa 5 Menit Sejak Interaksi Terakhir (Idle Timeout)
        if (parsed.isExpired) {
            const expiredCard = buildExpiredPanel(parsed.mod);
            const canUpdateMessage =
                (typeof interaction.isMessageComponent === 'function' && interaction.isMessageComponent()) ||
                (typeof interaction.isModalSubmit === 'function' &&
                    interaction.isModalSubmit() &&
                    typeof interaction.isFromMessage === 'function' &&
                    interaction.isFromMessage());

            if (canUpdateMessage && typeof interaction.update === 'function') {
                await interaction.update({ ...expiredCard, attachments: [] });
            } else {
                await interaction.reply({ ...expiredCard, ephemeral: true });
            }
            return true;
        }
    }

    // 3. Validasi Registrasi & Status Blokir Pemain
    await recordActiveUser(interaction.user.id, now);
    if (!entry.skipRegistrationCheck) {
        const player = await getPlayerBasic(interaction.user.id);
        if (!player) {
            await interaction.reply(buildWelcomeCardPayload(true));
            return true;
        }
        if (Number(player.is_banned) === 1) {
            await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '🔨 Akun Dibekukan',
                    blocks: ['Akun karaktermu telah dibekukan oleh Administrator karena pelanggaran aturan ekonomi.'],
                    ephemeral: true
                })
            );
            return true;
        }

        const unackWarnings = await getUnacknowledgedWarnings(interaction.user.id);
        if (unackWarnings.length > 0) {
            const warnPayload = await buildWarningInterceptPayload(interaction.user.id, unackWarnings);
            await interaction.reply(warnPayload);
            return true;
        }

        if (Number(player.traveling_until || 0) > 0) {
            if (now >= Number(player.traveling_until)) {
                await settlePlayerTravelIfArrived(interaction.user.id, now);
            } else if (!isCommandAllowedDuringTravel(parsed.mod, Number(player.travel_has_driver) === 1)) {
                await interaction.reply(
                    buildTravelStatusInterceptPanel({
                        player,
                        blockedCommand: parsed.mod,
                        ephemeral: true,
                        now
                    })
                );
                return true;
            }
        }
    }

    // 3.5. Gerbang Fitur Under Development (Properti, Tanah, Bangun)
    if (isPropertyModuleDisabled(parsed.mod)) {
        cancelAutoUpdate(`${parsed.mod}:${interaction.user.id}`);
        const willUpdate = typeof interaction.update === 'function' && (
            typeof interaction.isFromMessage !== 'function' || interaction.isFromMessage()
        );
        const payload = buildPropertyUnderDevPanel({
            mod: parsed.mod,
            ownerId: interaction.user.id,
            ephemeral: !willUpdate,
            now
        });
        if (willUpdate) {
            await interaction.update({ ...payload, attachments: [] });
        } else {
            await interaction.reply(payload);
        }
        return true;
    }

    // 4. Cari Handler Sesuai Jenis Interaksi
    const { handlers } = entry;
    let handler = null;

    if (typeof interaction.isButton === 'function' && interaction.isButton()) {
        if (parsed.action === 'noop') return true;
        handler = handlers.buttons?.[parsed.action] || handlers.onButton || null;
    } else if (typeof interaction.isStringSelectMenu === 'function' && interaction.isStringSelectMenu()) {
        handler = handlers.selects?.[parsed.action] || handlers.onSelect || null;
    } else if (typeof interaction.isUserSelectMenu === 'function' && interaction.isUserSelectMenu()) {
        handler = handlers.userSelects?.[parsed.action] || handlers.selects?.[parsed.action] || handlers.onUserSelect || null;
    } else if (typeof interaction.isModalSubmit === 'function' && interaction.isModalSubmit()) {
        handler = handlers.modals?.[parsed.action] || handlers.onModal || null;
    }

    if (!handler) {
        return false;
    }

    // 5. Kunci Konkurensi Redis per Pemain
    const lockToken = await acquireUserLock(interaction.user.id, entry.lockTtl);
    if (!lockToken) {
        await interaction.reply(
            buildV2Card({
                accentColor: COLORS.WARNING,
                title: '⏳ Sedang Memproses',
                blocks: ['Tunggu aksi sebelumnya selesai diproses!'],
                ephemeral: true
            })
        );
        return true;
    }

    try {
        await handler(interaction, parsed, client);
        if (!entry.skipRegistrationCheck) {
            trackInteractionPanel(interaction.user.id, parsed.mod, interaction, Date.now());
            if (!isReadOnlyPanelInteraction(parsed.mod, parsed.action)) {
                notifyPlayerStateChanged(interaction.user.id, parsed.mod);
            }
        }
    } finally {
        await releaseUserLock(interaction.user.id, lockToken);
    }

    return true;
}

module.exports = {
    registerPanel,
    clearRegistry,
    getRegisteredPanels,
    dispatch
};
