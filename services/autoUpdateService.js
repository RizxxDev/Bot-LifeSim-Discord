/**
 * services/autoUpdateService.js
 *
 * Mengelola:
 * 1. Auto-Update berbasis Timer Server-Side (scheduleAutoUpdate) saat durasi status/cooldown
 *    berakhir (/travel, /sleep, /fishing, /mining, /bin, /cook, /farm, /work, /study).
 *    Memprioritaskan `message.edit()` (Bot Token permanen, bebas batas 15 menit webhook token).
 * 2. Live Panel Sync Lintas-Pesan (trackInteractionPanel & notifyPlayerStateChanged) agar panel
 *    terbuka seperti /profile, /bank, /inventory, /cooldowns, dll. otomatis memperbarui dirinya
 *    ketika terjadi perubahan data pemain dari command lain atau transfer /pay.
 */

const { PANEL_TTL_MS } = require('../utils/panelId');

const timerRegistry = new Map();
const panelRenderers = new Map();
const activePanels = new Map(); // key: `${userId}:${mod}`
const syncDebounceTimers = new Map(); // key: userId

const SYNC_DEBOUNCE_MS = 300;

/**
 * Mengekstrak referensi pesan Discord permanen dari objek Interaction atau Message.
 * Jika berasal dari Slash Command (belum punya interaction.message), melakukan fetchReply()
 * secara asinkron selagi token interaksi masih segar agar dapat di-edit via Bot Token kapan saja (> 15 menit).
 */
function resolveMessageRef(interactionOrMessage) {
    const ref = {
        raw: interactionOrMessage,
        message: null,
        messageId: null
    };

    if (!interactionOrMessage) return ref;

    if (interactionOrMessage.message && typeof interactionOrMessage.message.edit === 'function') {
        ref.message = interactionOrMessage.message;
        ref.messageId = interactionOrMessage.message.id || null;
    } else if (typeof interactionOrMessage.edit === 'function' && interactionOrMessage.id) {
        ref.message = interactionOrMessage;
        ref.messageId = interactionOrMessage.id;
    } else if (typeof interactionOrMessage.fetchReply === 'function') {
        interactionOrMessage
            .fetchReply()
            .then(msg => {
                if (msg && typeof msg.edit === 'function') {
                    ref.message = msg;
                    ref.messageId = msg.id || null;
                }
            })
            .catch(() => {});
    }

    return ref;
}

/**
 * Meng-edit pesan target dengan memprioritaskan `message.edit()` (Bot Token permanen)
 * di atas `interaction.editReply()` (Webhook Token 15 menit).
 */
async function applyMessageEdit(ref, payload) {
    if (!ref || !payload) return false;

    const raw = ref.raw;
    const isEphemeral = Boolean(
        raw?.ephemeral ||
        (ref.message?.flags?.bitfield && (ref.message.flags.bitfield & 64) === 64) ||
        (payload?.flags && (payload.flags & 64) === 64)
    );

    // 1. Jika bukan ephemeral dan sudah punya objek Message dengan .edit(), gunakan Bot Token permanen
    if (!isEphemeral && ref.message && typeof ref.message.edit === 'function') {
        await ref.message.edit(payload);
        return true;
    }

    // 2. Jika belum punya ref.message tetapi mendukung fetchReply(), ambil Message terlebih dahulu
    if (!isEphemeral && !ref.message && typeof raw?.fetchReply === 'function') {
        const fetched = await raw.fetchReply().catch(() => null);
        if (fetched && typeof fetched.edit === 'function') {
            ref.message = fetched;
            ref.messageId = fetched.id || null;
            const fetchedEphemeral = Boolean(fetched.flags?.bitfield && (fetched.flags.bitfield & 64) === 64);
            if (!fetchedEphemeral) {
                await fetched.edit(payload);
                return true;
            }
        }
    }

    // 3. Fallback ke editReply() (untuk pesan ephemeral atau mock pengujian unit)
    if (typeof raw?.editReply === 'function') {
        await raw.editReply(payload);
        return true;
    }

    // 4. Fallback langsung ke raw.edit()
    if (typeof raw?.edit === 'function') {
        await raw.edit(payload);
        return true;
    }

    return false;
}

/**
 * Menjadwalkan pembaruan otomatis pesan Discord setelah delay tertentu.
 *
 * @param {string} key ID unik timer (misal: `travel:123456789` atau `sleep:123456789`)
 * @param {object} interactionOrMessage Objek interaksi Discord atau pesan yang akan di-update
 * @param {number} delayMs Durasi tunggu dalam milidetik
 * @param {Function} updateFn Fungsi async penghasil payload panel baru: `async () => payload`
 */
function scheduleAutoUpdate(key, interactionOrMessage, delayMs, updateFn) {
    if (!key || !interactionOrMessage || interactionOrMessage.isLiveSyncProbe || typeof updateFn !== 'function') {
        return null;
    }

    cancelAutoUpdate(key);

    const safeDelay = Math.max(10, Number(delayMs || 0));
    const expiresAt = Date.now() + safeDelay;
    const ref = resolveMessageRef(interactionOrMessage);

    const timerId = setTimeout(async () => {
        timerRegistry.delete(key);
        try {
            const payload = await updateFn();
            if (!payload) return;

            await applyMessageEdit(ref, payload);

            // Jika key berformat `mod:userId`, sinkronkan juga panel lain milik pemain tersebut
            const sepIdx = String(key).indexOf(':');
            if (sepIdx > 0) {
                const modName = String(key).slice(0, sepIdx);
                const uid = String(key).slice(sepIdx + 1);
                if (uid && modName !== 'test') {
                    notifyPlayerStateChanged(uid, modName);
                }
            }
        } catch (err) {
            if (err.code === 10008 || err.code === 50027) {
                return;
            }
            console.error(`[autoUpdateService] Gagal memperbarui pesan otomatis untuk ${key}:`, err.message);
        }
    }, safeDelay);

    if (typeof timerId.unref === 'function') {
        timerId.unref();
    }

    timerRegistry.set(key, {
        timerId,
        ref,
        interactionOrMessage,
        updateFn,
        expiresAt
    });

    return timerId;
}

/**
 * Membatalkan timer auto-update aktif berdasarkan key.
 *
 * @param {string} key
 */
function cancelAutoUpdate(key) {
    const existing = timerRegistry.get(key);
    if (existing) {
        clearTimeout(existing.timerId);
        timerRegistry.delete(key);
        return true;
    }
    return false;
}

/**
 * Mendaftarkan fungsi renderer standar untuk suatu modul panel agar dapat di-update
 * secara otomatis saat state pemain berubah di panel lain.
 *
 * @param {string} mod Nama modul (misal: 'profile', 'bank', 'inventory')
 * @param {Function} renderFn `async (userId, now) => payload`
 */
function registerPanelRenderer(mod, renderFn) {
    if (!mod || typeof renderFn !== 'function') return;
    panelRenderers.set(String(mod).trim(), renderFn);
}

/**
 * Mencatat bahwa seorang pemain sedang memiliki panel `mod` yang terbuka pada pesan interaksi ini.
 * Jika pesan Discord yang sama berpindah modul secara in-place (misal dari `profile` ke `wardrobe`),
 * entri modul lama pada `messageId` tersebut otomatis dibersihkan.
 */
function trackInteractionPanel(userId, mod, interactionOrMessage, now = Date.now()) {
    if (!userId || !mod || !interactionOrMessage) return;
    const cleanMod = String(mod).trim();
    const ref = resolveMessageRef(interactionOrMessage);

    // Jika messageId diketahui, hapus entri modul lain milik user ini yang menunjuk ke messageId yang sama
    if (ref.messageId) {
        for (const [k, entry] of activePanels.entries()) {
            if (entry.userId === String(userId) && entry.mod !== cleanMod && entry.ref?.messageId === ref.messageId) {
                activePanels.delete(k);
            }
        }
    }

    if (!panelRenderers.has(cleanMod)) {
        return;
    }

    const panelKey = `${userId}:${cleanMod}`;
    const prev = activePanels.get(panelKey);
    activePanels.set(panelKey, {
        userId: String(userId),
        mod: cleanMod,
        ref,
        minigameLocked: Boolean(prev?.minigameLocked && prev?.ref?.messageId === ref.messageId),
        updatedAt: now
    });
}

/**
 * Mengunci/membuka kunci sinkronisasi otomatis pada panel yang sedang menjalankan mini-game interaktif
 * (/work, /fishing, /mining) agar tombol mini-game tidak tertimpa di tengah permainan.
 */
function setPanelMinigameLock(userId, mod, locked) {
    if (!userId || !mod) return;
    const panelKey = `${userId}:${String(mod).trim()}`;
    const entry = activePanels.get(panelKey);
    if (entry) {
        entry.minigameLocked = Boolean(locked);
        entry.updatedAt = Date.now();
    }
}

/**
 * Melakukan sinkronisasi otomatis ke seluruh panel aktif lain milik `userId` (selain `excludeMod`).
 * Dieksekusi secara debounced agar aman dari Discord API Rate Limit.
 *
 * @param {string} userId ID Discord pemain yang datanya berubah
 * @param {string|null} [excludeMod=null] Modul asal perubahan yang sudah ter-update langsung oleh interaksi
 */
function notifyPlayerStateChanged(userId, excludeMod = null) {
    if (!userId) return;
    const uid = String(userId);

    const existingTimer = syncDebounceTimers.get(uid);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
        syncDebounceTimers.delete(uid);
        await flushPlayerPanelSync(uid, excludeMod);
    }, SYNC_DEBOUNCE_MS);

    if (typeof timer.unref === 'function') {
        timer.unref();
    }
    syncDebounceTimers.set(uid, timer);
}

/**
 * Mengeksekusi pembaruan seluruh panel aktif milik `userId` yang terdaftar dan belum kedaluwarsa.
 */
async function flushPlayerPanelSync(userId, excludeMod = null) {
    if (!userId) return;
    const uid = String(userId);
    const now = Date.now();

    for (const [panelKey, entry] of activePanels.entries()) {
        if (entry.userId !== uid) continue;

        if (now - entry.updatedAt > PANEL_TTL_MS) {
            activePanels.delete(panelKey);
            continue;
        }

        if (excludeMod && entry.mod === String(excludeMod).trim()) {
            continue;
        }

        if (entry.minigameLocked) {
            continue;
        }

        const renderFn = panelRenderers.get(entry.mod);
        if (!renderFn) continue;

        try {
            const payload = await renderFn(uid, Date.now());
            if (!payload) continue;
            const ok = await applyMessageEdit(entry.ref, payload);
            if (ok) {
                entry.updatedAt = Date.now();
            }
        } catch (err) {
            if (err.code === 10008 || err.code === 50027) {
                activePanels.delete(panelKey);
                continue;
            }
            console.error(`[autoUpdateService] Gagal sinkronisasi panel ${panelKey}:`, err.message);
        }
    }
}

/**
 * Membersihkan seluruh timer & panel yang sedang terdaftar (berguna untuk testing).
 */
function clearAllAutoUpdates() {
    for (const [, entry] of timerRegistry.entries()) {
        clearTimeout(entry.timerId);
    }
    timerRegistry.clear();

    for (const [, timer] of syncDebounceTimers.entries()) {
        clearTimeout(timer);
    }
    syncDebounceTimers.clear();
    activePanels.clear();
}

/**
 * Mendapatkan status timer aktif untuk keperluan verifikasi/testing.
 *
 * @param {string} key
 */
function getAutoUpdateEntry(key) {
    return timerRegistry.get(key) || null;
}

function getActivePanelEntry(userId, mod) {
    return activePanels.get(`${userId}:${String(mod).trim()}`) || null;
}

module.exports = {
    resolveMessageRef,
    applyMessageEdit,
    scheduleAutoUpdate,
    cancelAutoUpdate,
    registerPanelRenderer,
    trackInteractionPanel,
    setPanelMinigameLock,
    notifyPlayerStateChanged,
    flushPlayerPanelSync,
    clearAllAutoUpdates,
    getAutoUpdateEntry,
    getActivePanelEntry
};
