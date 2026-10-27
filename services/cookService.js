const {
    RECIPES,
    COOKING_LIMITS,
    SEA_FISH_UNCOMMON_PLUS_IDS,
    getRecipe,
    getPerfectCookChance
} = require('../data/recipes');
const { getItem } = require('../data/items');
const { getLevelInfoFromXp } = require('../data/locations');
const { getPlayerPropertyStatus } = require('./propertyService');
const { getPlayerInventory, canFitItems, addItem, removeItem, recordCollection } = require('./inventoryService');
const { getActiveSeasonalEvent, awardEventActivityProgress } = require('./eventService');

async function getActiveCookingQueues(conn, discordId, forUpdate = false) {
    const lockSql = forUpdate ? 'FOR UPDATE' : '';
    const [rows] = await conn.execute(
        `SELECT * FROM player_cooking_queues WHERE discord_id = ? ORDER BY slot_number ASC, id ASC ${lockSql}`,
        [discordId]
    );
    return rows.map(r => ({
        ...r,
        id: Number(r.id),
        slot_number: Number(r.slot_number),
        portions: Number(r.portions),
        started_at: Number(r.started_at),
        finishes_at: Number(r.finishes_at)
    }));
}

/**
 * Mencocokkan bahan masakan di tas (FIFO berdasarkan urutan getPlayerInventory yang sudah mengurutkan item mudah basi lebih dulu).
 */
function resolveRecipeIngredientsFromBag(bagRows, recipe, portions = 1) {
    // Buat salinan sisa kuantitas per item_id sesuai urutan kemunculan di bagRows
    const itemPool = [];
    const indexMap = new Map();
    for (const row of bagRows) {
        const qty = Number(row.quantity);
        if (qty <= 0) continue;
        if (!indexMap.has(row.item_id)) {
            indexMap.set(row.item_id, itemPool.length);
            itemPool.push({ itemId: row.item_id, available: qty, item: getItem(row.item_id) });
        } else {
            itemPool[indexMap.get(row.item_id)].available += qty;
        }
    }

    const toConsume = {};
    const missing = [];

    for (const ing of recipe.ingredients) {
        let needed = ing.qty * portions;

        for (const entry of itemPool) {
            if (needed <= 0) break;
            if (entry.available <= 0 || !entry.item) continue;

            let matches = false;
            if (ing.type === 'item') {
                matches = entry.itemId === ing.itemId;
            } else if (ing.type === 'fish_rarity') {
                matches = Array.isArray(entry.item.tags) && entry.item.tags.includes('fish') && entry.item.rarity === ing.rarity;
            } else if (ing.type === 'sea_fish_uncommon_plus') {
                matches = SEA_FISH_UNCOMMON_PLUS_IDS.includes(entry.itemId);
            }

            if (matches) {
                const take = Math.min(entry.available, needed);
                entry.available -= take;
                needed -= take;
                toConsume[entry.itemId] = (toConsume[entry.itemId] || 0) + take;
            }
        }

        if (needed > 0) {
            missing.push({
                label: ing.label || (getItem(ing.itemId)?.name || ing.itemId),
                shortage: needed,
                requiredTotal: ing.qty * portions
            });
        }
    }

    return {
        ok: missing.length === 0,
        toConsume,
        missing
    };
}

/**
 * Menentukan bahan bakar memasak (1x muatan LPG / 1x buka gas_lpg / 1x batubara).
 */
function resolveFuelSource(player, bagRows, fuelPref = 'auto') {
    const lpgCharges = Number(player.lpg_charges || 0);
    const gasTabsOwned = bagRows
        .filter(r => r.item_id === 'gas_lpg')
        .reduce((acc, r) => acc + Number(r.quantity), 0);
    const coalOwned = bagRows
        .filter(r => r.item_id === 'batubara')
        .reduce((acc, r) => acc + Number(r.quantity), 0);

    if (fuelPref === 'batubara') {
        if (coalOwned > 0) return { ok: true, mode: 'batubara', label: '1× 🪨 Batu Bara' };
        return { ok: false };
    }

    if (fuelPref === 'lpg') {
        if (lpgCharges > 0) return { ok: true, mode: 'lpg_charge', label: '1× Muatan LPG Kompor' };
        if (gasTabsOwned > 0) return { ok: true, mode: 'open_gas_lpg', label: '1× 🟢 Tabung Gas LPG 3kg (Otomatis dipasang -> 9 sisa muatan)' };
        return { ok: false };
    }

    // Mode 'auto': utamakan muatan LPG aktif -> tabung gas LPG di tas -> batu bara di tas
    if (lpgCharges > 0) return { ok: true, mode: 'lpg_charge', label: '1× Muatan LPG Kompor' };
    if (gasTabsOwned > 0) return { ok: true, mode: 'open_gas_lpg', label: '1× 🟢 Tabung Gas LPG 3kg (Otomatis dipasang -> 9 sisa muatan)' };
    if (coalOwned > 0) return { ok: true, mode: 'batubara', label: '1× 🪨 Batu Bara' };

    return { ok: false };
}

async function startCookingBatch(conn, player, recipeInput, requestedPortions = 1, fuelPref = 'auto', now = Date.now()) {
    const recipe = getRecipe(recipeInput);
    if (!recipe) {
        return { error: 'INVALID_RECIPE' };
    }

    const cookingLv = getLevelInfoFromXp(player.cooking_xp || 0).level;
    if (cookingLv < recipe.minLevel) {
        return { error: 'LEVEL_TOO_LOW', requiredLevel: recipe.minLevel, currentLevel: cookingLv, recipe };
    }

    const portions = Math.max(1, Math.min(COOKING_LIMITS.MAX_BATCH_PORTIONS, Number(requestedPortions) || 1));

    const propStatus = await getPlayerPropertyStatus(conn, player.discord_id, player.max_slots, now, false);
    const stoveSlots = Number(propStatus.capacities?.stove || 0);
    if (stoveSlots <= 0) {
        return { error: 'NO_STOVE', propStatus };
    }

    const activeQueues = await getActiveCookingQueues(conn, player.discord_id, true);
    if (activeQueues.length >= stoveSlots) {
        return { error: 'STOVE_FULL', stoveSlots, activeQueues };
    }

    if (Number(player.energy) < COOKING_LIMITS.ENERGY_PER_BATCH) {
        return {
            error: 'INSUFFICIENT_ENERGY',
            requiredEnergy: COOKING_LIMITS.ENERGY_PER_BATCH,
            energy: player.energy
        };
    }

    const bagRows = await getPlayerInventory(conn, player.discord_id, true, 'bag', now);

    // 1. Cek ketersediaan bahan masakan
    const ingCheck = resolveRecipeIngredientsFromBag(bagRows, recipe, portions);
    if (!ingCheck.ok) {
        return { error: 'MISSING_INGREDIENTS', missing: ingCheck.missing, recipe, portions };
    }

    // 2. Cek ketersediaan bahan bakar (jangan sampai batu bara yang dipakai sebagai bahan ikut terhitung dua kali)
    const fuelCheck = resolveFuelSource(player, bagRows, fuelPref);
    if (!fuelCheck.ok) {
        return { error: 'NO_FUEL' };
    }

    // 3. Kurangi bahan masakan dari tas
    for (const [itemId, qty] of Object.entries(ingCheck.toConsume)) {
        await removeItem(conn, player.discord_id, itemId, qty, 'bag');
    }

    // 4. Kurangi bahan bakar
    if (fuelCheck.mode === 'lpg_charge') {
        player.lpg_charges = Math.max(0, Number(player.lpg_charges || 0) - 1);
    } else if (fuelCheck.mode === 'open_gas_lpg') {
        await removeItem(conn, player.discord_id, 'gas_lpg', 1, 'bag');
        player.lpg_charges = Number(player.lpg_charges || 0) + 9;
    } else if (fuelCheck.mode === 'batubara') {
        await removeItem(conn, player.discord_id, 'batubara', 1, 'bag');
    }

    // 5. Kurangi energi pemain
    player.energy = Math.max(0, Number(player.energy) - COOKING_LIMITS.ENERGY_PER_BATCH);
    await conn.execute(
        `UPDATE players SET energy = ?, lpg_charges = ? WHERE discord_id = ?`,
        [player.energy, player.lpg_charges, player.discord_id]
    );

    // 6. Tentukan nomor tungku kompor yang kosong (1..stoveSlots)
    const usedSlotNums = new Set(activeQueues.map(q => q.slot_number));
    let freeSlotNumber = 1;
    for (let s = 1; s <= stoveSlots; s++) {
        if (!usedSlotNums.has(s)) {
            freeSlotNumber = s;
            break;
        }
    }

    const totalDurationMs = recipe.cookTimeSec * portions * 1000;
    const finishesAt = now + totalDurationMs;

    await conn.execute(
        `INSERT INTO player_cooking_queues (discord_id, slot_number, recipe_id, portions, started_at, finishes_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [player.discord_id, freeSlotNumber, recipe.id, portions, now, finishesAt]
    );

    return {
        ok: true,
        recipe,
        portions,
        slotNumber: freeSlotNumber,
        stoveSlots,
        consumedIngredients: ingCheck.toConsume,
        fuelUsedLabel: fuelCheck.label,
        energyCost: COOKING_LIMITS.ENERGY_PER_BATCH,
        totalDurationMs,
        finishesAt,
        player
    };
}

async function collectFinishedCooking(conn, player, now = Date.now(), activeBuffs = [], rollFn = Math.random) {
    const queues = await getActiveCookingQueues(conn, player.discord_id, true);
    if (queues.length === 0) {
        return { error: 'NO_QUEUES' };
    }

    const finished = queues.filter(q => q.finishes_at <= now);
    const pending = queues.filter(q => q.finishes_at > now);

    if (finished.length === 0) {
        return { error: 'NONE_FINISHED', pending };
    }

    const cookingLvBefore = getLevelInfoFromXp(player.cooking_xp || 0).level;
    const perfectChance = getPerfectCookChance(cookingLvBefore);

    const xpBuff = (activeBuffs || []).find(b => b.buff_type === 'xp_boost' && Number(b.expires_at) > now);
    const activeEvent = await getActiveSeasonalEvent(conn, now);
    const eventCookMult = activeEvent?.config?.bonuses?.cookingXpMult || 1.0;
    const xpMult = (xpBuff ? Number(xpBuff.multiplier) : 1.0) * eventCookMult;

    const collectedDishes = {};
    let totalXpGained = 0;
    let collectedSlots = 0;

    for (const q of finished) {
        const recipe = getRecipe(q.recipe_id);
        if (!recipe) {
            await conn.execute(`DELETE FROM player_cooking_queues WHERE id = ?`, [q.id]);
            continue;
        }

        let normalCount = 0;
        let perfectCount = 0;
        for (let i = 0; i < q.portions; i++) {
            if (rollFn() < perfectChance) {
                perfectCount += 1;
            } else {
                normalCount += 1;
            }
        }

        const itemsToAdd = [];
        if (normalCount > 0) itemsToAdd.push({ itemId: recipe.resultItemId, qty: normalCount });
        if (perfectCount > 0) itemsToAdd.push({ itemId: recipe.perfectItemId, qty: perfectCount });

        const bagRows = await getPlayerInventory(conn, player.discord_id, true, 'bag', now);
        const fitCheck = canFitItems(bagRows, player.max_slots, itemsToAdd);

        if (!fitCheck.fits) {
            if (collectedSlots === 0) {
                return { error: 'BAG_FULL', usedSlots: fitCheck.slotsBefore, maxSlots: Number(player.max_slots) };
            }
            break;
        }

        if (normalCount > 0) {
            await addItem(conn, player.discord_id, recipe.resultItemId, normalCount, now, 'bag');
            collectedDishes[recipe.resultItemId] = (collectedDishes[recipe.resultItemId] || 0) + normalCount;
        }
        if (perfectCount > 0) {
            await addItem(conn, player.discord_id, recipe.perfectItemId, perfectCount, now, 'bag');
            collectedDishes[recipe.perfectItemId] = (collectedDishes[recipe.perfectItemId] || 0) + perfectCount;
        }

        await recordCollection(conn, player.discord_id, `recipe_${recipe.id}`, q.portions, now);

        totalXpGained += Math.round(recipe.xpReward * q.portions * xpMult);
        collectedSlots += 1;

        await conn.execute(`DELETE FROM player_cooking_queues WHERE id = ?`, [q.id]);
    }

    player.cooking_xp = Number(player.cooking_xp || 0) + totalXpGained;
    await conn.execute(
        `UPDATE players SET cooking_xp = ? WHERE discord_id = ?`,
        [player.cooking_xp, player.discord_id]
    );

    const cookingLvAfter = getLevelInfoFromXp(player.cooking_xp).level;
    const eventReward = collectedSlots > 0
        ? await awardEventActivityProgress(conn, player.discord_id, 'cook_collect', now)
        : null;

    return {
        ok: true,
        collectedDishes,
        collectedSlots,
        remainingPending: pending.length,
        totalXpGained,
        leveledUp: cookingLvAfter > cookingLvBefore,
        newLevel: cookingLvAfter,
        eventReward,
        player
    };
}

module.exports = {
    getActiveCookingQueues,
    resolveRecipeIngredientsFromBag,
    resolveFuelSource,
    startCookingBatch,
    collectFinishedCooking
};
