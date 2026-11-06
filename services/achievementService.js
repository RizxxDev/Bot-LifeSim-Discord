const { ACHIEVEMENT_CATEGORIES, ACHIEVEMENTS, getAchievement } = require('../data/achievements');
const { getEducation } = require('../data/education');
const { getItem } = require('../data/items');
const { RECIPES } = require('../data/recipes');
const { getLevelInfoFromXp } = require('../data/locations');
const { SEASONAL_EVENTS } = require('../data/events');
const { GACHA_TITLES } = require('../data/gacha');
const { getPlayerInventory, getMaxSlots, canFitItems, addItem } = require('./inventoryService');

const STANDARD_RECIPE_IDS = new Set(RECIPES.map(r => r.id));

async function computePlayerMetrics(conn, player) {
    const discordId = player.discord_id;

    const [jobRows] = await conn.execute(
        `SELECT job_id, shifts_completed FROM player_job_history WHERE discord_id = ?`,
        [discordId]
    );
    const [colRows] = await conn.execute(
        `SELECT item_id, total_caught FROM player_collections WHERE discord_id = ? AND total_caught > 0`,
        [discordId]
    );
    const [propRows] = await conn.execute(
        `SELECT property_tier, ownership_type, is_evicted FROM player_properties WHERE discord_id = ?`,
        [discordId]
    );
    const [creditRows] = await conn.execute(
        `SELECT status FROM player_credits WHERE discord_id = ?`,
        [discordId]
    );
    const [vehRows] = await conn.execute(
        `SELECT vehicle_id FROM player_vehicles WHERE discord_id = ?`,
        [discordId]
    );
    const [gachaRows] = await conn.execute(
        `SELECT total_pulls, jackpot_count FROM player_gacha_stats WHERE discord_id = ? LIMIT 1`,
        [discordId]
    );

    let totalShifts = Number(player.total_shifts || 0);
    let sumJobShifts = 0;
    let maxJobShifts = 0;
    let workedDokter = player.current_job === 'dokter_spesialis';

    for (const r of jobRows) {
        const s = Number(r.shifts_completed || 0);
        sumJobShifts += s;
        if (s > maxJobShifts) maxJobShifts = s;
        if (r.job_id === 'dokter_spesialis' && s >= 1) workedDokter = true;
    }
    if (sumJobShifts > totalShifts) totalShifts = sumJobShifts;

    const fishSpecies = new Set();
    const mineralTypes = new Set();
    const cookedRecipes = new Set();

    for (const r of colRows) {
        const rawId = String(r.item_id || '');
        if (rawId.startsWith('recipe_')) {
            const recId = rawId.replace(/^recipe_/, '');
            if (STANDARD_RECIPE_IDS.has(recId)) cookedRecipes.add(recId);
            continue;
        }
        if (STANDARD_RECIPE_IDS.has(rawId)) {
            cookedRecipes.add(rawId);
        }
        const item = getItem(rawId);
        if (!item || !item.tags) continue;
        if (item.tags.includes('fish') && item.locationId) {
            fishSpecies.add(item.id);
        }
        if (item.tags.includes('mineral') && item.locationId) {
            mineralTypes.add(item.id);
        }
    }

    const eduInfo = getEducation(player.education_level);
    const fishLv = getLevelInfoFromXp(Number(player.fishing_xp || 0)).level;
    const mineLv = getLevelInfoFromXp(Number(player.mining_xp || 0)).level;
    const farmLv = getLevelInfoFromXp(Number(player.farming_xp || 0)).level;
    const cookLv = getLevelInfoFromXp(Number(player.cooking_xp || 0)).level;

    const activePropRows = propRows.filter(p => Number(p.is_evicted || 0) === 0 && p.property_tier !== 'tunawisma');
    const hasActiveProperty = activePropRows.length > 0 ? 1 : 0;
    const ownsHouse = activePropRows.some(
        p => p.ownership_type === 'owned' && (p.property_tier === 'rumah_pribadi' || p.property_tier === 'rumah_mewah')
    ) ? 1 : 0;
    const paidOffCredits = creditRows.filter(c => c.status === 'paid_off').length;
    const netWorth = Number(player.cash || 0) + Number(player.bank || 0);
    const dailyStreak = Number(player.daily_streak || 0);
    const ownsCar = vehRows.some(v => v.vehicle_id === 'mobil' || v.vehicle_id === 'mobil_sport') ? 1 : 0;
    const cookedDishesEaten = Number(player.cooked_dishes_eaten || 0);
    const gachaTotalPulls = Number(gachaRows[0]?.total_pulls || 0);
    const gachaJackpots = Number(gachaRows[0]?.jackpot_count || 0);

    return {
        total_shifts: totalShifts,
        max_job_shifts: maxJobShifts,
        is_dokter_spesialis: workedDokter ? 1 : 0,
        edu_order: eduInfo.order,
        fish_species_count: fishSpecies.size,
        mineral_types_count: mineralTypes.size,
        cooked_recipes_count: cookedRecipes.size,
        fishing_level: fishLv,
        mining_level: mineLv,
        farming_level: farmLv,
        cooking_level: cookLv,
        has_active_property: hasActiveProperty,
        owns_house: ownsHouse,
        paid_off_credits: paidOffCredits,
        net_worth: netWorth,
        daily_streak: dailyStreak,
        owns_car: ownsCar,
        cooked_dishes_eaten: cookedDishesEaten,
        gacha_total_pulls: gachaTotalPulls,
        gacha_jackpots: gachaJackpots
    };
}

async function evaluatePlayerAchievements(conn, player, now = Date.now()) {
    const discordId = player.discord_id;
    const metrics = await computePlayerMetrics(conn, player);

    const [existingRows] = await conn.execute(
        `SELECT achievement_id, claimed, unlocked_at FROM player_achievements WHERE discord_id = ?`,
        [discordId]
    );
    const existingMap = new Map(existingRows.map(r => [r.achievement_id, r]));
    const newlyUnlocked = [];

    for (const ach of ACHIEVEMENTS) {
        const val = Number(metrics[ach.metric] || 0);
        if (val >= ach.target && !existingMap.has(ach.id)) {
            await conn.execute(
                `INSERT INTO player_achievements (discord_id, achievement_id, claimed, unlocked_at)
                 VALUES (?, ?, 0, ?)
                 ON DUPLICATE KEY UPDATE unlocked_at = unlocked_at`,
                [discordId, ach.id, now]
            );
            const newRecord = {
                achievement_id: ach.id,
                claimed: 0,
                unlocked_at: now
            };
            existingMap.set(ach.id, newRecord);
            newlyUnlocked.push(ach);
        }
    }

    const detailed = ACHIEVEMENTS.map(ach => {
        const rec = existingMap.get(ach.id);
        const progress = Math.min(ach.target, Number(metrics[ach.metric] || 0));
        return {
            ...ach,
            currentProgress: progress,
            unlocked: Boolean(rec),
            claimed: rec ? Number(rec.claimed) === 1 : false,
            unlockedAt: rec ? Number(rec.unlocked_at) : null
        };
    });

    const unlockedCount = detailed.filter(a => a.unlocked).length;
    const claimableCount = detailed.filter(a => a.unlocked && !a.claimed).length;

    return {
        achievements: detailed,
        metrics,
        unlockedCount,
        totalCount: ACHIEVEMENTS.length,
        claimableCount,
        newlyUnlocked
    };
}

async function claimAchievementRewards(conn, player, now = Date.now()) {
    const discordId = player.discord_id;
    const evalRes = await evaluatePlayerAchievements(conn, player, now);
    const claimable = evalRes.achievements.filter(a => a.unlocked && !a.claimed);

    if (claimable.length === 0) {
        return { error: 'NO_CLAIMABLE', evalRes };
    }

    const aggregatedItems = new Map();
    for (const ach of claimable) {
        for (const rw of (ach.itemRewards || [])) {
            aggregatedItems.set(rw.itemId, (aggregatedItems.get(rw.itemId) || 0) + rw.qty);
        }
    }

    const itemsToGive = Array.from(aggregatedItems.entries()).map(([itemId, qty]) => ({ itemId, qty }));
    if (itemsToGive.length > 0) {
        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
        const fitCheck = canFitItems(invRows, Number(player.max_slots || 20), itemsToGive);
        if (!fitCheck.fits) {
            return { error: 'BAG_FULL', evalRes };
        }
    }

    for (const it of itemsToGive) {
        await addItem(conn, discordId, it.itemId, it.qty, now, 'bag');
    }

    for (const ach of claimable) {
        await conn.execute(
            `UPDATE player_achievements SET claimed = 1 WHERE discord_id = ? AND achievement_id = ?`,
            [discordId, ach.id]
        );
    }

    const unlockedTitles = claimable.filter(a => a.titleReward).map(a => a.titleReward);

    return {
        claimedAchievements: claimable,
        rewardedItems: itemsToGive,
        unlockedTitles,
        evalRes
    };
}

async function getUnlockedTitles(conn, player, now = Date.now()) {
    const discordId = player.discord_id;
    const evalRes = await evaluatePlayerAchievements(conn, player, now);
    const titles = [];
    const seen = new Set();

    // 1. Gelar dari Achievement yang telah terbuka
    for (const ach of evalRes.achievements) {
        if (ach.unlocked && ach.titleReward && !seen.has(ach.titleReward)) {
            seen.add(ach.titleReward);
            titles.push({
                id: `ach_${ach.id}`,
                title: ach.titleReward,
                source: `Achievement: ${ach.name}`
            });
        }
    }

    // 2. Gelar Prestise dari Inventory (Fase 1)
    const [invRows] = await conn.execute(
        `SELECT item_id, SUM(quantity) AS qty FROM player_inventory WHERE discord_id = ? AND quantity > 0 GROUP BY item_id`,
        [discordId]
    );
    for (const row of invRows) {
        const item = getItem(row.item_id);
        if (item && item.tags && item.tags.includes('prestise') && item.titleLabel && !seen.has(item.titleLabel)) {
            seen.add(item.titleLabel);
            titles.push({
                id: `item_${item.id}`,
                title: item.titleLabel,
                source: `Prestise: ${item.name}`
            });
        }
    }

    // 3. Gelar Eksklusif dari Event Musiman & Gacha (disimpan di player_collections dengan key 'title_<id>' atau 'gacha_title_<id>')
    const [colRows] = await conn.execute(
        `SELECT item_id FROM player_collections WHERE discord_id = ? AND (item_id LIKE 'title_%' OR item_id LIKE 'gacha_title_%') AND total_caught > 0`,
        [discordId]
    );
    const unlockedShopTitleIds = new Set(colRows.map(r => r.item_id));
    for (const ev of SEASONAL_EVENTS) {
        for (const shopItem of (ev.shopItems || [])) {
            if (shopItem.type === 'title' && unlockedShopTitleIds.has(shopItem.id) && !seen.has(shopItem.titleValue)) {
                seen.add(shopItem.titleValue);
                titles.push({
                    id: shopItem.id,
                    title: shopItem.titleValue,
                    source: `Event: ${ev.name}`
                });
            }
        }
    }

    for (const gt of GACHA_TITLES) {
        if (unlockedShopTitleIds.has(gt.id) && !seen.has(gt.titleValue)) {
            seen.add(gt.titleValue);
            titles.push({
                id: gt.id,
                title: gt.titleValue,
                source: `Jackpot /gacha`
            });
        }
    }

    return titles;
}

module.exports = {
    ACHIEVEMENT_CATEGORIES,
    ACHIEVEMENTS,
     getAchievement,
    computePlayerMetrics,
    evaluatePlayerAchievements,
    claimAchievementRewards,
    getUnlockedTitles
};
