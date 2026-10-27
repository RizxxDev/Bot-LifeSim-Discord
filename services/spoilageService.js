const { getItem } = require('../data/items');

const BATCH_MERGE_TOLERANCE_MS = 3600000; // Tumpukan digabung bila selisih kesegaran <= 1 jam

function getDecayRateForLocation(location = 'bag', isEvicted = false) {
    const loc = String(location || 'bag').toLowerCase();
    if (loc === 'freezer') return 0.0;
    if (loc === 'kulkas') return isEvicted ? 1.0 : (1 / 3);
    if (loc === 'coolerbox') return 0.5;
    return 1.0;
}

function getInitialFreshnessMs(itemOrId) {
    const item = typeof itemOrId === 'string' ? getItem(itemOrId) : itemOrId;
    if (!item || !item.shelfLifeHours || item.shelfLifeHours <= 0) return null;
    return Math.round(item.shelfLifeHours * 3600000);
}

function isItemPerishable(itemOrId) {
    return getInitialFreshnessMs(itemOrId) !== null;
}

/**
 * Pure function untuk menghitung sisa kesegaran sebuah row inventory (Lazy Evaluation).
 */
function computeLazyRowFreshness(row, now = Date.now(), isEvicted = false) {
    if (row.freshness_remaining_ms === null || row.freshness_remaining_ms === undefined) {
        return {
            isPerishable: false,
            spoiled: false,
            remainingMs: null,
            decayRate: 0
        };
    }

    const prevRemaining = Number(row.freshness_remaining_ms);
    const lastUpdated = Number(row.freshness_updated_at || row.created_at || now);
    const elapsedMs = Math.max(0, now - lastUpdated);
    const decayRate = getDecayRateForLocation(row.storage_location || 'bag', isEvicted);
    const consumedFreshness = Math.round(elapsedMs * decayRate);
    const remainingMs = Math.max(0, prevRemaining - consumedFreshness);

    return {
        isPerishable: true,
        spoiled: remainingMs <= 0,
        remainingMs,
        decayRate
    };
}

function formatFreshnessBadge(remainingMs, storageLocation = 'bag') {
    if (remainingMs === null || remainingMs === undefined) return '';
    const hours = remainingMs / 3600000;
    const loc = String(storageLocation || 'bag').toLowerCase();

    if (loc === 'freezer') {
        return `🧊 beku (${Math.max(1, Math.ceil(hours))}j)`;
    }

    if (hours < 1) {
        const mins = Math.max(1, Math.ceil(remainingMs / 60000));
        return `⚠️ segar ${mins} menit`;
    }

    const roundedHours = Math.round(hours);
    if (hours < 12) {
        return `⚠️ segar ${roundedHours} jam`;
    }
    if (hours >= 48) {
        const days = (hours / 24).toFixed(1).replace(/\.0$/, '');
        return `segar ${days} hari`;
    }
    return `segar ${roundedHours} jam`;
}

/**
 * Sinkronisasi status basi seluruh item milik player di database.
 * Item yang melewati batas segar otomatis berubah menjadi 'bahan_basi' di lokasi yang sama.
 */
async function syncInventoryFreshness(conn, discordId, now = Date.now(), isEvicted = null) {
    let evictedFlag = Boolean(isEvicted);
    if (isEvicted === null) {
        const [pRows] = await conn.execute(
            `SELECT is_evicted FROM player_properties WHERE discord_id = ? LIMIT 1`,
            [discordId]
        );
        evictedFlag = pRows.length > 0 && Number(pRows[0].is_evicted) === 1;
    }

    const [rows] = await conn.execute(
        `SELECT * FROM player_inventory
         WHERE discord_id = ? AND quantity > 0 AND freshness_remaining_ms IS NOT NULL
         FOR UPDATE`,
        [discordId]
    );

    const spoiledEvents = [];

    for (const row of rows) {
        const evalRes = computeLazyRowFreshness(row, now, evictedFlag);
        if (!evalRes.isPerishable) continue;

        if (evalRes.spoiled) {
            const loc = row.storage_location || 'bag';
            const qty = Number(row.quantity || 0);

            await conn.execute(`DELETE FROM player_inventory WHERE id = ?`, [row.id]);

            if (qty > 0) {
                const [existingSpoiled] = await conn.execute(
                    `SELECT id FROM player_inventory
                     WHERE discord_id = ? AND item_id = 'bahan_basi' AND storage_location = ?
                     LIMIT 1 FOR UPDATE`,
                    [discordId, loc]
                );

                if (existingSpoiled.length > 0) {
                    await conn.execute(
                        `UPDATE player_inventory SET quantity = quantity + ? WHERE id = ?`,
                        [qty, existingSpoiled[0].id]
                    );
                } else {
                    await conn.execute(
                        `INSERT INTO player_inventory
                         (discord_id, item_id, quantity, durability, storage_location, freshness_remaining_ms, freshness_updated_at, created_at)
                         VALUES (?, 'bahan_basi', ?, NULL, ?, NULL, NULL, ?)`,
                        [discordId, qty, loc, now]
                    );
                }

                spoiledEvents.push({
                    itemId: row.item_id,
                    qty,
                    location: loc
                });
            }
        } else if (evalRes.remainingMs !== Number(row.freshness_remaining_ms) || Number(row.freshness_updated_at) !== now) {
            await conn.execute(
                `UPDATE player_inventory
                 SET freshness_remaining_ms = ?, freshness_updated_at = ?
                 WHERE id = ?`,
                [evalRes.remainingMs, now, row.id]
            );
        }
    }

    return { spoiledEvents };
}

module.exports = {
    BATCH_MERGE_TOLERANCE_MS,
    getDecayRateForLocation,
    getInitialFreshnessMs,
    isItemPerishable,
    computeLazyRowFreshness,
    formatFreshnessBadge,
    syncInventoryFreshness
};
