const { withTransaction } = require('../database/mariadb');
const { syncPlayerVitals, checkActivityEligibility, deductActivityVitals } = require('./vitalService');
const {
    calculateSlotsUsed,
    canFitItems,
    getPlayerInventory,
    addItem,
    removeItem,
    getDamagedTools,
    getInventoryRowById,
    repairToolPartialById
} = require('./inventoryService');
const { logPlayerActivity } = require('./moderationService');
const { ENERGY_PER_CRAFT, CRAFT_RECIPES, getCraftRecipe } = require('../data/crafting');
const { getItem } = require('../data/items');

/**
 * Menghitung kecukupan bahan resep prakarya dari isi tas saat ini.
 */
function resolveCraftIngredientsFromBag(invRows = [], recipe, batchCount = 1) {
    if (!recipe) {
        return { ok: false, missing: [], countsByItem: new Map() };
    }
    const mult = Math.max(1, Number(batchCount || 1));
    const countsByItem = new Map();
    for (const row of invRows) {
        const qty = Number(row.quantity || 0);
        if (qty <= 0) continue;
        countsByItem.set(row.item_id, (countsByItem.get(row.item_id) || 0) + qty);
    }

    const missing = [];
    const requiredList = [];
    for (const [itemId, perCraftQty] of Object.entries(recipe.ingredients || {})) {
        const needed = Number(perCraftQty) * mult;
        const owned = countsByItem.get(itemId) || 0;
        requiredList.push({ itemId, needed, owned });
        if (owned < needed) {
            missing.push({ itemId, needed, owned, shortBy: needed - owned });
        }
    }

    return {
        ok: missing.length === 0,
        missing,
        requiredList,
        countsByItem
    };
}

/**
 * Mensimulasikan isi tas setelah pengurangan bahan agar canFitItems akurat tanpa mutasi DB lebih dulu.
 */
function simulateBagAfterRemoval(invRows = [], requiredList = []) {
    const remMap = new Map(requiredList.map(r => [r.itemId, r.needed]));
    const cloned = [];
    for (const row of invRows) {
        const rowQty = Number(row.quantity || 0);
        if (rowQty <= 0) continue;
        const toTake = remMap.get(row.item_id) || 0;
        if (toTake <= 0) {
            cloned.push({ ...row });
            continue;
        }
        const used = Math.min(rowQty, toTake);
        remMap.set(row.item_id, toTake - used);
        const left = rowQty - used;
        if (left > 0) {
            cloned.push({ ...row, quantity: left });
        }
    }
    return cloned;
}

async function fetchCraftState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const player = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const slotsUsed = calculateSlotsUsed(invRows);
        const damagedTools = getDamagedTools(invRows);
        const repairKitCount = invRows
            .filter(r => r.item_id === 'kit_perbaikan_ringan')
            .reduce((acc, r) => acc + Number(r.quantity || 0), 0);

        return {
            player,
            invRows,
            slotsUsed,
            damagedTools,
            repairKitCount
        };
    });
}

async function executeCraftRecipe(discordId, recipeId, requestedBatch = 1, now = Date.now()) {
    const recipe = getCraftRecipe(recipeId);
    if (!recipe) {
        return { ok: false, error: 'INVALID_RECIPE' };
    }

    const batchCount = Math.max(1, Math.min(10, Math.floor(Number(requestedBatch || 1))));
    const energyCost = (recipe.energyCost || ENERGY_PER_CRAFT) * batchCount;

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);

        const elig = checkActivityEligibility(p, { energy: energyCost, hunger: 0, thirst: 0 }, 'craft', now);
        if (!elig.allowed) {
            return {
                ok: false,
                error: 'NOT_ELIGIBLE',
                message: elig.message,
                player: p,
                invRows
            };
        }

        const ingCheck = resolveCraftIngredientsFromBag(invRows, recipe, batchCount);
        if (!ingCheck.ok) {
            return {
                ok: false,
                error: 'MISSING_INGREDIENTS',
                missing: ingCheck.missing,
                recipe,
                batchCount,
                player: p,
                invRows
            };
        }

        const totalOutputQty = recipe.outputQty * batchCount;
        const simulatedRows = simulateBagAfterRemoval(invRows, ingCheck.requiredList);
        const fitCheck = canFitItems(simulatedRows, p.max_slots, [
            { itemId: recipe.outputItemId, qty: totalOutputQty }
        ]);
        if (!fitCheck.fits) {
            return {
                ok: false,
                error: 'BAG_FULL',
                slotsAfter: fitCheck.slotsAfter,
                maxSlots: fitCheck.maxSlots,
                player: p,
                invRows
            };
        }

        for (const req of ingCheck.requiredList) {
            const removed = await removeItem(conn, discordId, req.itemId, req.needed, 'bag');
            if (!removed) {
                return { ok: false, error: 'MISSING_INGREDIENTS', missing: ingCheck.missing, recipe, batchCount, player: p, invRows };
            }
        }

        await addItem(conn, discordId, recipe.outputItemId, totalOutputQty, now, 'bag');
        deductActivityVitals(p, { energy: energyCost, hunger: 0, thirst: 0 }, 0, now);

        await conn.execute(
            `UPDATE players
             SET energy = ?, hunger = ?, thirst = ?, health = ?,
                 cash = ?, bank = ?, hospital_until = ?, sleeping_until = ?
             WHERE discord_id = ?`,
            [
                p.energy, p.hunger, p.thirst, p.health,
                p.cash, p.bank, p.hospital_until, p.sleeping_until,
                discordId
            ]
        );

        await logPlayerActivity(conn, discordId, 'craft', 'craft_recipe', {
            recipeId: recipe.id,
            batchCount,
            outputItemId: recipe.outputItemId,
            outputQty: totalOutputQty
        }, now);

        const updatedInv = await getPlayerInventory(conn, discordId, false, 'bag', now);
        return {
            ok: true,
            recipe,
            outputItem: getItem(recipe.outputItemId),
            outputQty: totalOutputQty,
            batchCount,
            energyCost,
            player: p,
            invRows: updatedInv
        };
    });
}

async function executeUseRepairKit(discordId, toolRowId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);

        const kitCount = invRows
            .filter(r => r.item_id === 'kit_perbaikan_ringan')
            .reduce((acc, r) => acc + Number(r.quantity || 0), 0);

        if (kitCount <= 0) {
            return { ok: false, error: 'NO_REPAIR_KIT', player: p, invRows };
        }

        const toolRow = await getInventoryRowById(conn, toolRowId, discordId, true);
        if (!toolRow || toolRow.storage_location !== 'bag') {
            return { ok: false, error: 'TOOL_NOT_FOUND', player: p, invRows };
        }

        const toolItem = getItem(toolRow.item_id);
        if (!toolItem || !toolItem.maxDurability) {
            return { ok: false, error: 'NOT_A_TOOL', player: p, invRows };
        }

        const beforeDur = Math.max(0, Number(toolRow.durability ?? toolItem.maxDurability));
        if (beforeDur >= toolItem.maxDurability) {
            return { ok: false, error: 'TOOL_ALREADY_FULL', toolItem, player: p, invRows };
        }

        const kitItem = getItem('kit_perbaikan_ringan');
        const addAmt = Number(kitItem?.repairAmount || 25);

        await removeItem(conn, discordId, 'kit_perbaikan_ringan', 1, 'bag');
        await repairToolPartialById(conn, toolRow.id, toolItem.maxDurability, addAmt);

        const afterDur = Math.min(toolItem.maxDurability, beforeDur + addAmt);
        await logPlayerActivity(conn, discordId, 'craft', 'use_repair_kit', {
            toolItemId: toolItem.id,
            beforeDur,
            afterDur
        }, now);

        const updatedInv = await getPlayerInventory(conn, discordId, false, 'bag', now);
        return {
            ok: true,
            toolItem,
            beforeDur,
            afterDur,
            maxDurability: toolItem.maxDurability,
            restored: afterDur - beforeDur,
            player: p,
            invRows: updatedInv
        };
    });
}

module.exports = {
    CRAFT_RECIPES,
    resolveCraftIngredientsFromBag,
    simulateBagAfterRemoval,
    fetchCraftState,
    executeCraftRecipe,
    executeUseRepairKit
};
