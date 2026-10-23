const { getItem } = require('../data/items');

/**
 * Menghitung jumlah slot tas yang terpakai dari daftar row player_inventory.
 */
function calculateSlotsUsed(inventoryRows = []) {
    const stackTotals = new Map();
    let toolSlots = 0;

    for (const row of inventoryRows) {
        const qty = Number(row.quantity || 0);
        if (qty <= 0) continue;

        const item = getItem(row.item_id);
        if (!item) continue;

        // Lisensi, laptop, dan item prestise tidak memakan slot
        if (item.stackSize === 0) continue;

        // Alat ber-durability memakan 1 slot per unit
        if (item.maxDurability) {
            toolSlots += qty;
            continue;
        }

        const prev = stackTotals.get(item.id) || 0;
        stackTotals.set(item.id, prev + qty);
    }

    let stackSlots = 0;
    for (const [itemId, totalQty] of stackTotals.entries()) {
        const item = getItem(itemId);
        const stackSize = (item && item.stackSize > 0) ? item.stackSize : 20;
        stackSlots += Math.ceil(totalQty / stackSize);
    }

    return toolSlots + stackSlots;
}

/**
 * Mengecek apakah penambahan item baru masih muat di dalam kapasitas slot tas.
 */
function canFitItems(inventoryRows, maxSlots, itemsToAdd = []) {
    // Klon daftar untuk simulasi
    const simulated = inventoryRows.map(r => ({
        item_id: r.item_id,
        quantity: Number(r.quantity || 0),
        durability: r.durability
    }));

    for (const add of itemsToAdd) {
        const item = getItem(add.itemId);
        if (!item || add.qty <= 0) continue;
        if (item.stackSize === 0) continue;

        if (item.maxDurability) {
            for (let i = 0; i < add.qty; i++) {
                simulated.push({ item_id: item.id, quantity: 1, durability: item.maxDurability });
            }
        } else {
            const existing = simulated.find(r => r.item_id === item.id);
            if (existing) {
                existing.quantity += add.qty;
            } else {
                simulated.push({ item_id: item.id, quantity: add.qty, durability: null });
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

async function getPlayerInventory(conn, discordId, forUpdate = false) {
    const lock = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await conn.execute(
        `SELECT * FROM player_inventory WHERE discord_id = ? AND quantity > 0 ORDER BY id ASC${lock}`,
        [discordId]
    );
    return rows;
}

async function addItem(conn, discordId, itemId, qty = 1, now = Date.now()) {
    const item = getItem(itemId);
    if (!item || qty <= 0) return;

    if (item.maxDurability) {
        for (let i = 0; i < qty; i++) {
            await conn.execute(
                `INSERT INTO player_inventory (discord_id, item_id, quantity, durability, created_at)
                 VALUES (?, ?, 1, ?, ?)`,
                [discordId, item.id, item.maxDurability, now]
            );
        }
        return;
    }

    const [existing] = await conn.execute(
        `SELECT id, quantity FROM player_inventory WHERE discord_id = ? AND item_id = ? AND durability IS NULL LIMIT 1 FOR UPDATE`,
        [discordId, item.id]
    );

    if (existing.length > 0) {
        await conn.execute(
            `UPDATE player_inventory SET quantity = quantity + ? WHERE id = ?`,
            [qty, existing[0].id]
        );
    } else {
        await conn.execute(
            `INSERT INTO player_inventory (discord_id, item_id, quantity, durability, created_at)
             VALUES (?, ?, ?, NULL, ?)`,
            [discordId, item.id, qty, now]
        );
    }
}

async function removeItem(conn, discordId, itemId, qty = 1) {
    if (qty <= 0) return true;
    const [rows] = await conn.execute(
        `SELECT id, quantity FROM player_inventory WHERE discord_id = ? AND item_id = ? AND quantity > 0 ORDER BY id ASC FOR UPDATE`,
        [discordId, itemId]
    );

    const totalOwned = rows.reduce((acc, r) => acc + Number(r.quantity), 0);
    if (totalOwned < qty) return false;

    let remainingToRemove = qty;
    for (const row of rows) {
        if (remainingToRemove <= 0) break;
        const rowQty = Number(row.quantity);
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
    return true;
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
