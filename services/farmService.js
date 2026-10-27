const {
    CROPS,
    CROP_WILT_AFTER_MS,
    FARM_LIMITS,
    getCrop,
    getRentPlotPrice,
    getBuyPlotPrice,
    getBonusYieldChanceFromLevel
} = require('../data/crops');
const { getItem } = require('../data/items');
const { getLevelInfoFromXp } = require('../data/locations');
const { getPlayerInventory, canFitItems, addItem, removeItem } = require('./inventoryService');
const { logLedger } = require('./economyService');
const { getWeatherSeason } = require('../data/events');
const { getCurrentWeather, getActiveSeasonalEvent, awardEventActivityProgress } = require('./eventService');

function getPhaseDurationMs(crop, fertilizerType, weatherSeason = null) {
    const fertMult = fertilizerType === 'urea' ? 0.75 : 1.0;
    const weatherMult = (weatherSeason && weatherSeason.cropSpeedMultipliers && weatherSeason.cropSpeedMultipliers[crop.id])
        ? Number(weatherSeason.cropSpeedMultipliers[crop.id])
        : 1.0;
    const totalGrowMs = Math.round(crop.growTimeMs * fertMult * weatherMult);
    return Math.round(totalGrowMs / 2);
}

/**
 * Menghitung transisi fase lahan pertanian secara lazy (Tunas -> Berbunga -> Matang -> Layu).
 */
function computeLazyPlotState(plotRow, now = Date.now(), weatherSeason = null) {
    const weather = weatherSeason || getWeatherSeason(now);
    const state = {
        ...plotRow,
        plot_number: Number(plotRow.plot_number),
        phase: Number(plotRow.phase || 0),
        watered: Number(plotRow.watered || 0),
        phase_started_at: Number(plotRow.phase_started_at || 0),
        mature_at: Number(plotRow.mature_at || 0),
        next_billing_at: Number(plotRow.next_billing_at || 0),
        is_locked: Number(plotRow.is_locked || 0),
        mutated: false,
        remainingPhaseMs: 0,
        wiltRemainingMs: 0
    };

    if (!state.crop_id || state.phase === 0) {
        return state;
    }

    const crop = getCrop(state.crop_id);
    if (!crop) {
        return state;
    }

    const phaseDurationMs = getPhaseDurationMs(crop, state.fertilizer_type, weather);

    // Musim Hujan: otomatis menyiram tanaman di Fase 1 atau Fase 2 yang belum disiram
    if (weather.autoWaterFarm && (state.phase === 1 || state.phase === 2) && state.watered === 0) {
        state.watered = 1;
        state.phase_started_at = state.phase_started_at > 0 ? state.phase_started_at : now;
        state.mutated = true;
    }

    // Fase 1 (Tunas) -> Fase 2 (Berbunga) bila sudah disiram
    if (state.phase === 1 && state.watered === 1) {
        const elapsed = Math.max(0, now - state.phase_started_at);
        if (elapsed >= phaseDurationMs) {
            state.phase = 2;
            state.watered = weather.autoWaterFarm ? 1 : 0;
            state.phase_started_at = state.phase_started_at + phaseDurationMs;
            state.mutated = true;
        }
    }

    // Fase 2 (Berbunga) -> Fase 3 (Matang) bila sudah disiram
    if (state.phase === 2 && state.watered === 1) {
        const elapsed = Math.max(0, now - state.phase_started_at);
        if (elapsed >= phaseDurationMs) {
            const matureAt = state.phase_started_at + phaseDurationMs;
            state.mature_at = matureAt;
            state.phase = 3;
            state.watered = 0;
            state.mutated = true;
        }
    }

    // Fase 3 (Matang) -> Fase 4 (Layu) bila dibiarkan > 24 jam sejak matang
    if (state.phase === 3) {
        const matureAt = state.mature_at > 0 ? state.mature_at : state.phase_started_at;
        if (now >= matureAt + CROP_WILT_AFTER_MS) {
            state.phase = 4;
            state.mutated = true;
        } else {
            state.wiltRemainingMs = Math.max(0, (matureAt + CROP_WILT_AFTER_MS) - now);
        }
    }

    // Hitung sisa waktu fase aktif untuk tampilan UI
    if (state.phase === 1 || state.phase === 2) {
        if (state.watered === 1) {
            const elapsed = Math.max(0, now - state.phase_started_at);
            state.remainingPhaseMs = Math.max(0, phaseDurationMs - elapsed);
        } else {
            state.remainingPhaseMs = phaseDurationMs;
        }
    }

    return state;
}

async function getPlayerFarmPlots(conn, discordId, now = Date.now(), forUpdate = false) {
    const lockSql = forUpdate ? 'FOR UPDATE' : '';
    const [rows] = await conn.execute(
        `SELECT * FROM player_farm_plots WHERE discord_id = ? ORDER BY plot_number ASC ${lockSql}`,
        [discordId]
    );
    const weather = await getCurrentWeather(conn, now);

    const syncedPlots = [];
    for (const row of rows) {
        const computed = computeLazyPlotState(row, now, weather);
        if (computed.mutated) {
            await conn.execute(
                `UPDATE player_farm_plots
                 SET phase = ?, watered = ?, phase_started_at = ?, mature_at = ?
                 WHERE id = ?`,
                [computed.phase, computed.watered, computed.phase_started_at, computed.mature_at, computed.id]
            );
        }
        syncedPlots.push(computed);
    }

    return syncedPlots;
}

async function rentFarmPlot(conn, player, now = Date.now()) {
    const plots = await getPlayerFarmPlots(conn, player.discord_id, now, true);
    if (plots.length >= FARM_LIMITS.MAX_TOTAL_PLOTS) {
        return { error: 'MAX_TOTAL_PLOTS', maxTotal: FARM_LIMITS.MAX_TOTAL_PLOTS };
    }

    const rentedPlots = plots.filter(p => p.ownership_type === 'rent');
    if (rentedPlots.length >= FARM_LIMITS.MAX_RENTED_PLOTS) {
        return { error: 'MAX_RENTED_PLOTS', maxRented: FARM_LIMITS.MAX_RENTED_PLOTS };
    }

    const nextRentRank = rentedPlots.length + 1;
    const cost = getRentPlotPrice(nextRentRank);
    if (Number(player.cash) < cost) {
        return { error: 'INSUFFICIENT_CASH', cost, cash: Number(player.cash) };
    }

    const nextPlotNumber = plots.length > 0 ? Math.max(...plots.map(p => p.plot_number)) + 1 : 1;
    const nextBillingAt = now + FARM_LIMITS.RENT_BILLING_INTERVAL_MS;

    player.cash = Number(player.cash) - cost;
    await conn.execute(
        `UPDATE players SET cash = ? WHERE discord_id = ?`,
        [player.cash, player.discord_id]
    );

    await conn.execute(
        `INSERT INTO player_farm_plots
         (discord_id, plot_number, ownership_type, crop_id, phase, watered, fertilizer_type, phase_started_at, mature_at, next_billing_at, is_locked)
         VALUES (?, ?, 'rent', NULL, 0, 0, NULL, 0, 0, ?, 0)`,
        [player.discord_id, nextPlotNumber, nextBillingAt]
    );

    await logLedger(
        conn,
        player.discord_id,
        'sink',
        'farm_rent_plot',
        cost,
        player.cash + Number(player.bank),
        { plotNumber: nextPlotNumber, rentRank: nextRentRank }
    );

    return {
        ok: true,
        plotNumber: nextPlotNumber,
        rentRank: nextRentRank,
        cost,
        nextBillingAt,
        player
    };
}

async function buyFarmPlot(conn, player, now = Date.now()) {
    const plots = await getPlayerFarmPlots(conn, player.discord_id, now, true);
    if (plots.length >= FARM_LIMITS.MAX_TOTAL_PLOTS) {
        return { error: 'MAX_TOTAL_PLOTS', maxTotal: FARM_LIMITS.MAX_TOTAL_PLOTS };
    }

    const ownedPlots = plots.filter(p => p.ownership_type === 'owned');
    const nextBuyRank = ownedPlots.length + 1;
    const cost = getBuyPlotPrice(nextBuyRank);
    if (Number(player.cash) < cost) {
        return { error: 'INSUFFICIENT_CASH', cost, cash: Number(player.cash) };
    }

    const nextPlotNumber = plots.length > 0 ? Math.max(...plots.map(p => p.plot_number)) + 1 : 1;

    player.cash = Number(player.cash) - cost;
    await conn.execute(
        `UPDATE players SET cash = ? WHERE discord_id = ?`,
        [player.cash, player.discord_id]
    );

    await conn.execute(
        `INSERT INTO player_farm_plots
         (discord_id, plot_number, ownership_type, crop_id, phase, watered, fertilizer_type, phase_started_at, mature_at, next_billing_at, is_locked)
         VALUES (?, ?, 'owned', NULL, 0, 0, NULL, 0, 0, 0, 0)`,
        [player.discord_id, nextPlotNumber]
    );

    await logLedger(
        conn,
        player.discord_id,
        'sink',
        'farm_buy_plot',
        cost,
        player.cash + Number(player.bank),
        { plotNumber: nextPlotNumber, buyRank: nextBuyRank }
    );

    return {
        ok: true,
        plotNumber: nextPlotNumber,
        buyRank: nextBuyRank,
        cost,
        player
    };
}

async function plantPlots(conn, player, cropOrSeedInput, plotNumber = null, now = Date.now()) {
    const crop = getCrop(cropOrSeedInput);
    if (!crop) {
        return { error: 'INVALID_CROP' };
    }

    const farmingLv = getLevelInfoFromXp(player.farming_xp || 0).level;
    if (farmingLv < crop.minLevel) {
        return { error: 'LEVEL_TOO_LOW', requiredLevel: crop.minLevel, currentLevel: farmingLv, crop };
    }

    const plots = await getPlayerFarmPlots(conn, player.discord_id, now, true);
    if (plots.length === 0) {
        return { error: 'NO_PLOTS' };
    }

    let emptyPlots = plots.filter(p => !p.is_locked && p.phase === 0);
    if (plotNumber !== null) {
        const target = plots.find(p => p.plot_number === Number(plotNumber));
        if (!target) return { error: 'PLOT_NOT_FOUND', plotNumber };
        if (target.is_locked) return { error: 'PLOT_LOCKED', plotNumber };
        if (target.phase !== 0) return { error: 'PLOT_NOT_EMPTY', plotNumber };
        emptyPlots = [target];
    }

    if (emptyPlots.length === 0) {
        return { error: 'NO_EMPTY_PLOTS' };
    }

    const bagRows = await getPlayerInventory(conn, player.discord_id, true, 'bag', now);
    const seedOwned = bagRows
        .filter(r => r.item_id === crop.seedId)
        .reduce((acc, r) => acc + Number(r.quantity), 0);

    if (seedOwned <= 0) {
        return { error: 'NO_SEEDS', seedItem: getItem(crop.seedId), crop };
    }

    const maxByEnergy = Math.floor(Number(player.energy) / FARM_LIMITS.ENERGY_PLANT);
    if (maxByEnergy <= 0) {
        return { error: 'INSUFFICIENT_ENERGY', requiredEnergy: FARM_LIMITS.ENERGY_PLANT, energy: player.energy };
    }

    const plantCount = Math.min(emptyPlots.length, seedOwned, maxByEnergy);
    const plotsToPlant = emptyPlots.slice(0, plantCount);
    const weather = await getCurrentWeather(conn, now);
    const initialWatered = weather.autoWaterFarm ? 1 : 0;

    await removeItem(conn, player.discord_id, crop.seedId, plantCount, 'bag');

    for (const p of plotsToPlant) {
        await conn.execute(
            `UPDATE player_farm_plots
             SET crop_id = ?, phase = 1, watered = ?, fertilizer_type = NULL, phase_started_at = ?, mature_at = 0
             WHERE id = ?`,
            [crop.id, initialWatered, now, p.id]
        );
    }

    const energyCost = plantCount * FARM_LIMITS.ENERGY_PLANT;
    player.energy = Math.max(0, Number(player.energy) - energyCost);
    player.last_farm_crop = crop.id;

    await conn.execute(
        `UPDATE players SET energy = ?, last_farm_crop = ? WHERE discord_id = ?`,
        [player.energy, crop.id, player.discord_id]
    );

    return {
        ok: true,
        crop,
        plantedPlots: plotsToPlant.map(p => p.plot_number),
        seedsUsed: plantCount,
        energyCost,
        player
    };
}

async function waterPlots(conn, player, plotNumber = null, now = Date.now()) {
    const plots = await getPlayerFarmPlots(conn, player.discord_id, now, true);
    if (plots.length === 0) {
        return { error: 'NO_PLOTS' };
    }

    let dryPlots = plots.filter(p => !p.is_locked && (p.phase === 1 || p.phase === 2) && p.watered === 0);
    if (plotNumber !== null) {
        const target = plots.find(p => p.plot_number === Number(plotNumber));
        if (!target) return { error: 'PLOT_NOT_FOUND', plotNumber };
        if (target.is_locked) return { error: 'PLOT_LOCKED', plotNumber };
        if (target.phase !== 1 && target.phase !== 2) return { error: 'PLOT_NOT_GROW_PHASE', plotNumber };
        if (target.watered === 1) return { error: 'ALREADY_WATERED', plotNumber };
        dryPlots = [target];
    }

    if (dryPlots.length === 0) {
        return { error: 'NO_DRY_PLOTS' };
    }

    const maxByEnergy = Math.floor(Number(player.energy) / FARM_LIMITS.ENERGY_WATER);
    if (maxByEnergy <= 0) {
        return { error: 'INSUFFICIENT_ENERGY', requiredEnergy: FARM_LIMITS.ENERGY_WATER, energy: player.energy };
    }

    const waterCount = Math.min(dryPlots.length, maxByEnergy);
    const plotsToWater = dryPlots.slice(0, waterCount);

    for (const p of plotsToWater) {
        await conn.execute(
            `UPDATE player_farm_plots SET watered = 1, phase_started_at = ? WHERE id = ?`,
            [now, p.id]
        );
    }

    const energyCost = waterCount * FARM_LIMITS.ENERGY_WATER;
    player.energy = Math.max(0, Number(player.energy) - energyCost);

    await conn.execute(
        `UPDATE players SET energy = ? WHERE discord_id = ?`,
        [player.energy, player.discord_id]
    );

    return {
        ok: true,
        wateredPlots: plotsToWater.map(p => p.plot_number),
        energyCost,
        player
    };
}

async function fertilizePlot(conn, player, plotNumber = null, fertilizerInput = 'pupuk_urea', now = Date.now()) {
    const normalized = String(fertilizerInput || '').toLowerCase();
    const fertItemId = (normalized === 'urea' || normalized === 'pupuk_urea')
        ? 'pupuk_urea'
        : (normalized === 'kompos' ? 'kompos' : null);

    if (!fertItemId) {
        return { error: 'INVALID_FERTILIZER' };
    }

    const fertCode = fertItemId === 'pupuk_urea' ? 'urea' : 'kompos';
    const plots = await getPlayerFarmPlots(conn, player.discord_id, now, true);
    if (plots.length === 0) {
        return { error: 'NO_PLOTS' };
    }

    let targetPlot = null;
    if (plotNumber !== null) {
        targetPlot = plots.find(p => p.plot_number === Number(plotNumber));
        if (!targetPlot) return { error: 'PLOT_NOT_FOUND', plotNumber };
        if (targetPlot.is_locked) return { error: 'PLOT_LOCKED', plotNumber };
        if (targetPlot.phase !== 1) return { error: 'MUST_BE_PHASE_1', plotNumber };
        if (targetPlot.fertilizer_type) return { error: 'ALREADY_FERTILIZED', plotNumber };
    } else {
        targetPlot = plots.find(p => !p.is_locked && p.phase === 1 && !p.fertilizer_type);
        if (!targetPlot) return { error: 'NO_ELIGIBLE_PLOT' };
    }

    const bagRows = await getPlayerInventory(conn, player.discord_id, true, 'bag', now);
    const ownedFert = bagRows
        .filter(r => r.item_id === fertItemId)
        .reduce((acc, r) => acc + Number(r.quantity), 0);

    if (ownedFert <= 0) {
        return { error: 'NO_FERTILIZER_ITEM', item: getItem(fertItemId) };
    }

    await removeItem(conn, player.discord_id, fertItemId, 1, 'bag');
    await conn.execute(
        `UPDATE player_farm_plots SET fertilizer_type = ? WHERE id = ?`,
        [fertCode, targetPlot.id]
    );

    return {
        ok: true,
        plotNumber: targetPlot.plot_number,
        fertilizerType: fertCode,
        item: getItem(fertItemId)
    };
}

async function harvestPlots(conn, player, plotNumber = null, now = Date.now(), activeBuffs = [], rollFn = Math.random) {
    const plots = await getPlayerFarmPlots(conn, player.discord_id, now, true);
    if (plots.length === 0) {
        return { error: 'NO_PLOTS' };
    }

    let harvestable = plots.filter(p => !p.is_locked && (p.phase === 3 || p.phase === 4));
    if (plotNumber !== null) {
        const target = plots.find(p => p.plot_number === Number(plotNumber));
        if (!target) return { error: 'PLOT_NOT_FOUND', plotNumber };
        if (target.is_locked) return { error: 'PLOT_LOCKED', plotNumber };
        if (target.phase !== 3 && target.phase !== 4) return { error: 'NOT_READY_TO_HARVEST', plotNumber };
        harvestable = [target];
    }

    if (harvestable.length === 0) {
        return { error: 'NO_HARVESTABLE_PLOTS' };
    }

    const maxByEnergy = Math.floor(Number(player.energy) / FARM_LIMITS.ENERGY_HARVEST);
    if (maxByEnergy <= 0) {
        return { error: 'INSUFFICIENT_ENERGY', requiredEnergy: FARM_LIMITS.ENERGY_HARVEST, energy: player.energy };
    }

    const farmingLvBefore = getLevelInfoFromXp(player.farming_xp || 0).level;
    const bonusChance = getBonusYieldChanceFromLevel(farmingLvBefore);

    const xpBuff = (activeBuffs || []).find(b => b.buff_type === 'xp_boost' && Number(b.expires_at) > now);
    const activeEvent = await getActiveSeasonalEvent(conn, now);
    const eventFarmMult = activeEvent?.config?.bonuses?.farmingXpMult || 1.0;
    const xpMult = (xpBuff ? Number(xpBuff.multiplier) : 1.0) * eventFarmMult;

    const harvestedItems = {};
    const harvestedPlots = [];
    let totalXpGained = 0;
    let wiltedCount = 0;

    for (const p of harvestable.slice(0, maxByEnergy)) {
        const bagRows = await getPlayerInventory(conn, player.discord_id, true, 'bag', now);
        const crop = getCrop(p.crop_id);
        const dropItemId = p.phase === 4 ? 'bahan_basi' : (crop ? crop.cropItemId : 'bahan_basi');

        let qty = 1;
        if (p.phase === 3 && crop) {
            const compostBonus = p.fertilizer_type === 'kompos' ? 1 : 0;
            const lvBonus = rollFn() < bonusChance ? 1 : 0;
            qty = crop.baseYield + compostBonus + lvBonus;
        }

        const fitCheck = canFitItems(bagRows, player.max_slots, [{ itemId: dropItemId, qty }]);
        if (!fitCheck.fits) {
            if (harvestedPlots.length === 0) {
                return { error: 'BAG_FULL', usedSlots: fitCheck.slotsBefore, maxSlots: Number(player.max_slots) };
            }
            break;
        }

        if (p.phase === 3 && crop) {
            totalXpGained += Math.round(crop.xpReward * xpMult);
        } else {
            wiltedCount += 1;
        }

        await addItem(conn, player.discord_id, dropItemId, qty, now, 'bag');
        await conn.execute(
            `UPDATE player_farm_plots
             SET crop_id = NULL, phase = 0, watered = 0, fertilizer_type = NULL, phase_started_at = 0, mature_at = 0
             WHERE id = ?`,
            [p.id]
        );

        harvestedItems[dropItemId] = (harvestedItems[dropItemId] || 0) + qty;
        harvestedPlots.push(p.plot_number);
    }

    const energyCost = harvestedPlots.length * FARM_LIMITS.ENERGY_HARVEST;
    player.energy = Math.max(0, Number(player.energy) - energyCost);
    player.farming_xp = Number(player.farming_xp || 0) + totalXpGained;

    await conn.execute(
        `UPDATE players SET energy = ?, farming_xp = ? WHERE discord_id = ?`,
        [player.energy, player.farming_xp, player.discord_id]
    );

    const farmingLvAfter = getLevelInfoFromXp(player.farming_xp).level;
    const eventReward = harvestedPlots.length > 0
        ? await awardEventActivityProgress(conn, player.discord_id, 'farm_harvest', now)
        : null;

    return {
        ok: true,
        harvestedPlots,
        harvestedItems,
        wiltedCount,
        totalXpGained,
        energyCost,
        leveledUp: farmingLvAfter > farmingLvBefore,
        newLevel: farmingLvAfter,
        eventReward,
        player
    };
}

async function craftCompost(conn, player, batchesCount = 1, now = Date.now()) {
    const reqBatches = Math.max(1, Math.min(50, Number(batchesCount) || 1));
    const bagRows = await getPlayerInventory(conn, player.discord_id, true, 'bag', now);
    const ownedBasi = bagRows
        .filter(r => r.item_id === 'bahan_basi')
        .reduce((acc, r) => acc + Number(r.quantity), 0);

    const maxPossible = Math.floor(ownedBasi / FARM_LIMITS.COMPOST_ROTTEN_COST);
    if (maxPossible <= 0) {
        return { error: 'INSUFFICIENT_ROTTEN', ownedBasi, requiredPerBatch: FARM_LIMITS.COMPOST_ROTTEN_COST };
    }

    const actualBatches = Math.min(reqBatches, maxPossible);
    const basiUsed = actualBatches * FARM_LIMITS.COMPOST_ROTTEN_COST;

    // Bila bahan_basi tidak habis seluruhnya dan kompos belum ada di tas, cek slot tas
    const fitCheck = canFitItems(bagRows, player.max_slots, [{ itemId: 'kompos', qty: actualBatches }]);
    if (basiUsed < ownedBasi && !fitCheck.fits) {
        return { error: 'BAG_FULL', usedSlots: fitCheck.slotsBefore, maxSlots: Number(player.max_slots) };
    }

    await removeItem(conn, player.discord_id, 'bahan_basi', basiUsed, 'bag');
    await addItem(conn, player.discord_id, 'kompos', actualBatches, now, 'bag');

    return {
        ok: true,
        batchesCreated: actualBatches,
        basiUsed,
        remainingBasi: ownedBasi - basiUsed
    };
}

/**
 * Penagihan sewa mingguan petak kebun sewa oleh schedulerService.
 */
async function processDueFarmPlotBillings(conn, now = Date.now()) {
    const [dueRows] = await conn.execute(
        `SELECT * FROM player_farm_plots
         WHERE ownership_type = 'rent' AND next_billing_at > 0 AND next_billing_at <= ?
         ORDER BY discord_id ASC, plot_number ASC`,
        [now]
    );

    if (dueRows.length === 0) return { paidCount: 0, lockedCount: 0 };

    const byUser = new Map();
    for (const r of dueRows) {
        if (!byUser.has(r.discord_id)) byUser.set(r.discord_id, []);
        byUser.get(r.discord_id).push(r);
    }

    let paidCount = 0;
    let lockedCount = 0;

    for (const [discordId, userDuePlots] of byUser.entries()) {
        const [allRentRows] = await conn.execute(
            `SELECT id, plot_number FROM player_farm_plots
             WHERE discord_id = ? AND ownership_type = 'rent'
             ORDER BY plot_number ASC`,
            [discordId]
        );
        const rankMap = new Map();
        allRentRows.forEach((r, idx) => rankMap.set(r.id, idx + 1));

        const [pRows] = await conn.execute(
            `SELECT cash, bank FROM players WHERE discord_id = ? FOR UPDATE`,
            [discordId]
        );
        if (pRows.length === 0) continue;

        let cash = Number(pRows[0].cash);
        let bank = Number(pRows[0].bank);

        for (const plot of userDuePlots) {
            const rentRank = rankMap.get(plot.id) || 1;
            const rentCost = getRentPlotPrice(rentRank);

            if (cash + bank >= rentCost) {
                const fromBank = Math.min(bank, rentCost);
                bank -= fromBank;
                cash -= (rentCost - fromBank);

                await conn.execute(
                    `UPDATE player_farm_plots
                     SET is_locked = 0, next_billing_at = ?
                     WHERE id = ?`,
                    [now + FARM_LIMITS.RENT_BILLING_INTERVAL_MS, plot.id]
                );

                await logLedger(
                    conn,
                    discordId,
                    'sink',
                    'farm_weekly_rent',
                    rentCost,
                    cash + bank,
                    { plotNumber: plot.plot_number, rentRank }
                );
                paidCount += 1;
            } else {
                // Gagal bayar: kunci petak sewa dan jadwalkan cek ulang 24 jam kemudian
                await conn.execute(
                    `UPDATE player_farm_plots
                     SET is_locked = 1, next_billing_at = ?
                     WHERE id = ?`,
                    [now + 24 * 3600 * 1000, plot.id]
                );
                lockedCount += 1;
            }
        }

        await conn.execute(
            `UPDATE players SET cash = ?, bank = ? WHERE discord_id = ?`,
            [cash, bank, discordId]
        );
    }

    return { paidCount, lockedCount };
}

module.exports = {
    getPhaseDurationMs,
    computeLazyPlotState,
    getPlayerFarmPlots,
    rentFarmPlot,
    buyFarmPlot,
    plantPlots,
    waterPlots,
    fertilizePlot,
    harvestPlots,
    craftCompost,
    processDueFarmPlotBillings
};
