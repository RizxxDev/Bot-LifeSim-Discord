const { acquireUserLock, releaseUserLock, recordActiveUser } = require('../database/redis');
const { getPlayerBasic, buildWelcomeCardPayload } = require('./onboardingService');
const { COLORS, buildV2Card } = require('../utils/uiBuilder');
const { parseId } = require('../utils/panelId');
const { buildExpiredPanel } = require('../utils/panelBuilder');

const registry = new Map();

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
            await interaction.update(expiredCard);
        } else {
            await interaction.reply({ ...expiredCard, ephemeral: true });
        }
        return true;
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
