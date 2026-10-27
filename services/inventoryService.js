const { getItem } = require('../data/items');
const {
    BATCH_MERGE_TOLERANCE_MS,
    getInitialFreshnessMs,
    syncInventoryFreshness
} = require('./spoilageService');

/**
 * Menghitung jumlah slot penyimpanan yang terpakai dari daftar row player_inventory.
 * Item yang memiliki batch kesegaran berbeda dihitung per tumpukan batch.
 */
function calculateSlotsUsed(inventoryRows = []) {
    const nonPerishableTotals = new Map();
    const perishableBatches = [];
    let toolSlots = 0;

    for (const row of inventoryRows) {
        const qty = Number(row.quantity || 0);
        if (qty <= 0) continue;

        const item = getItem(row.item_id);
        if (!item) continue;

        // Lisensi, laptop, cooler_box, dan item prestise tidak memakan slot
        if (item.stackSize === 0) continue;

        // Alat ber-durability memakan 1 slot per unit
        if (item.maxDurability) {
            toolSlots += qty;
            continue;
        }

        if (row.freshness_remaining_ms !== null && row.freshness_remaining_ms !== undefined) {
            const rem = Number(row.freshness_remaining_ms);
            const existingBatch = perishableBatches.find(
                b => b.itemId === item.id && Math.abs(b.freshnessMs - rem) <= BATCH_MERGE_TOLERANCE_MS
            );
            if (existingBatch) {
                existingBatch.qty += qty;
            } else {
                perishableBatches.push({ itemId: item.id, freshnessMs: rem, qty });
            }
        } else {
            const prev = nonPerishableTotals.get(item.id) || 0;
            nonPerishableTotals.set(item.id, prev + qty);
        }
    }

    let stackSlots = 0;
    for (const [itemId, totalQty] of nonPerishableTotals.entries()) {
        const item = getItem(itemId);
        const stackSize = (item && item.stackSize > 0) ? item.stackSize : 20;
        stackSlots += Math.ceil(totalQty / stackSize);
    }

    for (const batch of perishableBatches) {
        const item = getItem(batch.itemId);
        const stackSize = (item && item.stackSize > 0) ? item.stackSize : 20;
        stackSlots += Math.ceil(batch.qty / stackSize);
    }

    return toolSlots + stackSlots;
}

/**
 * Mengecek apakah penambahan item baru masih muat di dalam kapasitas slot penyimpanan.
 */
function canFitItems(inventoryRows, maxSlots, itemsToAdd = []) {
    const simulated = inventoryRows.map(r => ({
        item_id: r.item_id,
        quantity: Number(r.quantity || 0),
        durability: r.durability,
        freshness_remaining_ms: r.freshness_remaining_ms ?? null
    }));

    for (const add of itemsToAdd) {
        const item = getItem(add.itemId);
        if (!item || add.qty <= 0) continue;
        if (item.stackSize === 0) continue;

        if (item.maxDurability) {
            for (let i = 0; i < add.qty; i++) {
                simulated.push({
                    item_id: item.id,
                    quantity: 1,
                    durability: item.maxDurability,
                    freshness_remaining_ms: null
                });
            }
            continue;
        }

        const addFreshness = add.freshnessMs !== undefined
            ? add.freshnessMs
            : getInitialFreshnessMs(item);

        if (addFreshness !== null && addFreshness !== undefined) {
            const existingBatch = simulated.find(
                r => r.item_id === item.id &&
                     r.freshness_remaining_ms !== null &&
                     Math.abs(Number(r.freshness_remaining_ms) - Number(addFreshness)) <= BATCH_MERGE_TOLERANCE_MS
            );
            if (existingBatch) {
                existingBatch.quantity += add.qty;
            } else {
                simulated.push({
                    item_id: item.id,
                    quantity: add.qty,
                    durability: null,
                    freshness_remaining_ms: addFreshness
                });
            }
        } else {
            const existing = simulated.find(r => r.item_id === item.id && r.freshness_remaining_ms === null);
            if (existing) {
                existing.quantity += add.qty;
            } else {
                simulated.push({
                    item_id: item.id,
                    quantity: add.qty,
                    durability: null,
                    freshness_remaining_ms: null
                });
            }
        }
    }

    const slotsAfter = calculateSlotsUsed(simulated);
    const slotsBefore = calculateSlotsUsed(inventoryRows);
    return {
        fits: slotsAfter <= Number(maxSlots),
        slotsBefore,
        slotsAfter,
        maxSlots: Number(maxSlots)
    };
}

/**
 * Mengambil isi inventory player di lokasi tertentu (default: 'bag').
 * Gunakan location = 'all' untuk mengambil seluruh lokasi sekaligus.
 */
async function getPlayerInventory(conn, discordId, forUpdate = false, location = 'bag', now = Date.now()) {
    await syncInventoryFreshness(conn, discordId, now);

    const lock = forUpdate ? ' FOR UPDATE' : '';
    if (location === 'all' || location === null) {
        const [rows] = await conn.execute(
            `SELECT * FROM player_inventory
             WHERE discord_id = ? AND quantity > 0
             ORDER BY CASE WHEN freshness_remaining_ms IS NULL THEN 1 ELSE 0 END ASC,
                      freshness_remaining_ms ASC, id ASC${lock}`,
            [discordId]
        );
        return rows;
    }

    const [rows] = await conn.execute(
        `SELECT * FROM player_inventory
         WHERE discord_id = ? AND storage_location = ? AND quantity > 0
         ORDER BY CASE WHEN freshness_remaining_ms IS NULL THEN 1 ELSE 0 END ASC,
                  freshness_remaining_ms ASC, id ASC${lock}`,
        [discordId, location]
    );
    return rows;
}

/**
 * Menambahkan item ke lokasi penyimpanan tertentu (default: 'bag').
 * Mendukung penggabungan tumpukan per batch kesegaran (toleransi 1 jam).
 */
async function addItem(conn, discordId, itemId, qty = 1, now = Date.now(), location = 'bag', customFreshnessMs = undefined) {
    const item = getItem(itemId);
    if (!item || qty <= 0) return;

    const loc = String(location || 'bag').toLowerCase();

    if (item.maxDurability) {
        for (let i = 0; i < qty; i++) {
            await conn.execute(
                `INSERT INTO player_inventory
                 (discord_id, item_id, quantity, durability, storage_location, freshness_remaining_ms, freshness_updated_at, created_at)
                 VALUES (?, ?, 1, ?, ?, NULL, NULL, ?)`,
                [discordId, item.id, item.maxDurability, loc, now]
            );
        }
        return;
    }

    const initialFreshness = customFreshnessMs !== undefined
        ? customFreshnessMs
        : getInitialFreshnessMs(item);

    if (initialFreshness !== null && initialFreshness !== undefined) {
        const [existingBatches] = await conn.execute(
            `SELECT id, quantity, freshness_remaining_ms
             FROM player_inventory
             WHERE discord_id = ? AND storage_location = ? AND item_id = ?
               AND durability IS NULL AND freshness_remaining_ms IS NOT NULL
               AND ABS(freshness_remaining_ms - ?) <= ?
             ORDER BY freshness_remaining_ms ASC
             LIMIT 1 FOR UPDATE`,
            [discordId, loc, item.id, initialFreshness, BATCH_MERGE_TOLERANCE_MS]
        );

        if (existingBatches.length > 0) {
            const batch = existingBatches[0];
            const mergedFreshness = Math.min(Number(batch.freshness_remaining_ms), Number(initialFreshness));
            await conn.execute(
                `UPDATE player_inventory
                 SET quantity = quantity + ?, freshness_remaining_ms = ?, freshness_updated_at = ?
                 WHERE id = ?`,
                [qty, mergedFreshness, now, batch.id]
            );
            return;
        }

        await conn.execute(
            `INSERT INTO player_inventory
             (discord_id, item_id, quantity, durability, storage_location, freshness_remaining_ms, freshness_updated_at, created_at)
             VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
            [discordId, item.id, qty, loc, initialFreshness, now, now]
        );
        return;
    }

    const [existing] = await conn.execute(
        `SELECT id, quantity FROM player_inventory
         WHERE discord_id = ? AND storage_location = ? AND item_id = ?
           AND durability IS NULL AND freshness_remaining_ms IS NULL
         LIMIT 1 FOR UPDATE`,
        [discordId, loc, item.id]
    );

    if (existing.length > 0) {
        await conn.execute(
            `UPDATE player_inventory SET quantity = quantity + ? WHERE id = ?`,
            [qty, existing[0].id]
        );
    } else {
        await conn.execute(
            `INSERT INTO player_inventory
             (discord_id, item_id, quantity, durability, storage_location, freshness_remaining_ms, freshness_updated_at, created_at)
             VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?)`,
            [discordId, item.id, qty, loc, now]
        );
    }
}

/**
 * Mengurangi item dari lokasi penyimpanan dengan urutan FIFO (yang paling dekat basi dipakai lebih dulu).
 * Mengembalikan array batch yang diambil (truthy) atau false bila stok kurang.
 */
async function removeItem(conn, discordId, itemId, qty = 1, location = 'bag') {
    if (qty <= 0) return [];
    const loc = String(location || 'bag').toLowerCase();

    const [rows] = await conn.execute(
        `SELECT id, quantity, freshness_remaining_ms
         FROM player_inventory
         WHERE discord_id = ? AND storage_location = ? AND item_id = ? AND quantity > 0
         ORDER BY CASE WHEN freshness_remaining_ms IS NULL THEN 1 ELSE 0 END ASC,
                  freshness_remaining_ms ASC, id ASC
         FOR UPDATE`,
        [discordId, loc, itemId]
    );

    const totalOwned = rows.reduce((acc, r) => acc + Number(r.quantity), 0);
    if (totalOwned < qty) return false;

    let remainingToRemove = qty;
    const removedBatches = [];

    for (const row of rows) {
        if (remainingToRemove <= 0) break;
        const rowQty = Number(row.quantity);
        const takeQty = Math.min(rowQty, remainingToRemove);

        removedBatches.push({
            qty: takeQty,
            freshnessMs: row.freshness_remaining_ms !== null ? Number(row.freshness_remaining_ms) : null
        });

        if (rowQty <= remainingToRemove) {
            await conn.execute(`DELETE FROM player_inventory WHERE id = ?`, [row.id]);
            remainingToRemove -= rowQty;
        } else {
            await conn.execute(
                `UPDATE player_inventory SET quantity = quantity - ? WHERE id = ?`,
                [remainingToRemove, row.id]
            );
            remainingToRemove = 0;
        }
    }

    return removedBatches;
}

function getBestWorkingTool(inventoryRows, toolTag) {
    let bestRow = null;
    let bestItem = null;

    for (const row of inventoryRows) {
        if (Number(row.quantity) <= 0) continue;
        const item = getItem(row.item_id);
        if (!item || !item.tags || !item.tags.includes(toolTag)) continue;
        if (Number(row.durability) <= 0) continue;

        if (!bestItem || (item.toolTier || 1) > (bestItem.toolTier || 1)) {
            bestRow = row;
            bestItem = item;
        }
    }

    return bestRow ? { row: bestRow, item: bestItem } : null;
}

function getDamagedTools(inventoryRows) {
    const damaged = [];
    for (const row of inventoryRows) {
        if (Number(row.quantity) <= 0) continue;
        const item = getItem(row.item_id);
        if (!item || !item.maxDurability) continue;
        const currentDur = Number(row.durability ?? item.maxDurability);
        if (currentDur < item.maxDurability) {
            const missing = item.maxDurability - currentDur;
            const repairCost = Math.max(100, Math.round(item.buyPrice * (missing / item.maxDurability) * 0.7));
            damaged.push({
                rowId: row.id,
                item,
                currentDurability: currentDur,
                maxDurability: item.maxDurability,
                repairCost
            });
        }
    }
    return damaged;
}

async function damageTool(conn, rowId, amount = 1) {
    await conn.execute(
        `UPDATE player_inventory SET durability = GREATEST(0, durability - ?) WHERE id = ?`,
        [amount, rowId]
    );
}

async function repairToolById(conn, rowId, maxDurability) {
    await conn.execute(
        `UPDATE player_inventory SET durability = ? WHERE id = ?`,
        [maxDurability, rowId]
    );
}

async function recordCollection(conn, discordId, itemId, qty = 1, now = Date.now()) {
    const [existing] = await conn.execute(
        `SELECT total_caught FROM player_collections WHERE discord_id = ? AND item_id = ?`,
        [discordId, itemId]
    );
    const isNewDiscovery = existing.length === 0;

    if (isNewDiscovery) {
        await conn.execute(
            `INSERT INTO player_collections (discord_id, item_id, total_caught, first_caught_at)
             VALUES (?, ?, ?, ?)`,
            [discordId, itemId, qty, now]
        );
    } else {
        await conn.execute(
            `UPDATE player_collections SET total_caught = total_caught + ? WHERE discord_id = ? AND item_id = ?`,
            [qty, discordId, itemId]
        );
    }
    return isNewDiscovery;
}

module.exports = {
    calculateSlotsUsed,
    canFitItems,
    getPlayerInventory,
    addItem,
    removeItem,
    getBestWorkingTool,
    getDamagedTools,
    damageTool,
    repairToolById,
    recordCollection
};
