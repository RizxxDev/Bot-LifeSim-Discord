const PANEL_TTL_MS = 5 * 60 * 1000; // 5 menit sejak interaksi terakhir (idle timeout)

/**
 * Membuat customId standar panel: `modul:aksi:ownerId:waktu36[:arg]`
 */
function makeId(mod, action, ownerId, arg = '', now = Date.now()) {
    const cleanMod = String(mod || '').trim();
    const cleanAction = String(action || '').trim();
    const cleanOwner = String(ownerId || '').trim();
    if (!cleanMod || !cleanAction || !cleanOwner) {
        throw new Error(`Parameter makeId tidak lengkap: mod=${cleanMod}, action=${cleanAction}, owner=${cleanOwner}`);
    }

    const ts36 = Math.floor(Number(now) / 1000).toString(36);
    const cleanArg = arg !== undefined && arg !== null ? String(arg) : '';
    const id = cleanArg.length > 0
        ? `${cleanMod}:${cleanAction}:${cleanOwner}:${ts36}:${cleanArg}`
        : `${cleanMod}:${cleanAction}:${cleanOwner}:${ts36}`;

    if (id.length > 100) {
        throw new Error(`customId melebihi batas 100 karakter (${id.length}): ${id}`);
    }
    return id;
}

/**
 * Mengurai customId standar panel. Mengembalikan null bila bukan format panel baru.
 */
function parseId(customId, now = Date.now()) {
    if (!customId || typeof customId !== 'string' || !customId.includes(':')) {
        return null;
    }

    const parts = customId.split(':');
    if (parts.length < 4) {
        return null;
    }

    const [mod, action, ownerId, ts36, ...rest] = parts;
    if (!mod || !action || !ownerId || !ts36) {
        return null;
    }

    if (!/^[0-9a-z]+$/i.test(ts36)) {
        return null;
    }

    const parsedSec = parseInt(ts36, 36);
    if (!Number.isFinite(parsedSec) || parsedSec <= 0) {
        return null;
    }

    const issuedAt = parsedSec * 1000;
    const arg = rest.join(':');
    const isExpired = (Number(now) - issuedAt) > PANEL_TTL_MS;

    return {
        mod,
        action,
        ownerId,
        ts36,
        issuedAt,
        arg,
        isExpired
    };
}

module.exports = {
    PANEL_TTL_MS,
    makeId,
    parseId
};
