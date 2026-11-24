const { withTransaction } = require('../database/mariadb');
const { syncPlayerVitals } = require('./vitalService');
const { getPlayerInventory, canFitItems, addItem, removeItem, calculateSlotsUsed } = require('./inventoryService');
const { debitPlayerFunds, logLedger } = require('./economyService');
const { logPlayerActivity } = require('./moderationService');
const {
    LIVESTOCK_LIMITS,
    LIVESTOCK_SPECIES,
    calculatePenRentPrice,
    calculatePenBuyPrice,
    getLivestockSpecies
} = require('../data/livestock');
const { getItem } = require('../data/items');
const { getLevelInfoFromXp } = require('../data/locations');
const { getBonusYieldChanceFromLevel } = require('../data/crops');
const { VITALS } = require('../data/constants');

/**
 * Pure function untuk menghitung status & transisi fase kandang ternak secara lazy (tahan restart).
 */
function computeLazyPenState(penRow, now = Date.now()) {
    const base = {
        ...penRow,
        pen_number: Number(penRow.pen_number),
        phase: Number(penRow.phase || 0),
        fed: Number(penRow.fed || 0),
        cleaned: Number(penRow.cleaned ?? 1),
        cycles_left: Number(penRow.cycles_left || 0),
        phase_started_at: penRow.phase_started_at ? Number(penRow.phase_started_at) : 0,
        mature_at: penRow.mature_at ? Number(penRow.mature_at) : 0,
        next_billing_at: penRow.next_billing_at ? Number(penRow.next_billing_at) : 0,
        is_locked: Number(penRow.is_locked || 0),
        mutated: false,
        remainingMs: 0,
        spoilAt: 0,
        isReady: false,
        needsFeed: false,
        isRetired: false
    };

    if (!base.species_id || base.phase === 0) {
        base.phase = 0;
        base.phaseLabel = '⬜ Kosong';
        return base;
    }

    const species = getLivestockSpecies(base.species_id);
    if (!species) {
        base.phaseLabel = '⬜ Kosong';
        return base;
    }

    if (base.phase === 2 && base.mature_at > 0) {
        const spoilAt = base.mature_at + LIVESTOCK_LIMITS.SPOIL_OVERDUE_MS;
        base.spoilAt = spoilAt;
        if (now >= spoilAt) {
            base.phase = 4;
            base.mutated = true;
        } else if (now >= base.mature_at) {
            base.phase = 3;
            base.mutated = true;
        } else {
            base.remainingMs = Math.max(0, base.mature_at - now);
        }
    } else if (base.phase === 3) {
        const spoilAt = base.mature_at > 0 ? base.mature_at + LIVESTOCK_LIMITS.SPOIL_OVERDUE_MS : 0;
        base.spoilAt = spoilAt;
        if (spoilAt > 0 && now >= spoilAt) {
            base.phase = 4;
            base.mutated = true;
        }
    }

    if (base.phase === 1) {
        base.needsFeed = true;
        base.phaseLabel = '🍽️ Butuh Pakan';
    } else if (base.phase === 2) {
        base.phaseLabel = '⏳ Sedang Produktif';
    } else if (base.phase === 3) {
        base.isReady = true;
        base.phaseLabel = '🥚 Siap Panen!';
    } else if (base.phase === 4) {
        base.isRetired = true;
        base.phaseLabel = '🧹 Perlu Dibersihkan';
    }

    return base;
}

async function getPlayerLivestockPens(conn, discordId, now = Date.now(), forUpdate = false) {
    const lockSql = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await conn.execute(
        `SELECT * FROM player_livestock_pens WHERE discord_id = ? ORDER BY pen_number ASC${lockSql}`,
        [discordId]
    );

    const result = [];
    for (const row of rows) {
        const computed = computeLazyPenState(row, now);
        if (computed.mutated) {
            await conn.execute(
                `UPDATE player_livestock_pens SET phase = ? WHERE id = ?`,
                [computed.phase, computed.id]
            );
        }
        result.push(computed);
    }
    return result;
}

async function fetchTernakState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const player = synced.player;
        const pens = await getPlayerLivestockPens(conn, discordId, now, false);
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const lvInfo = getLevelInfoFromXp(player.farming_xp || 0);
        const slotsUsed = calculateSlotsUsed(invRows);

        const feedStock = {
            jagung: invRows.filter(r => r.item_id === 'jagung').reduce((a, r) => a + Number(r.quantity || 0), 0),
            bayam: invRows.filter(r => r.item_id === 'bayam').reduce((a, r) => a + Number(r.quantity || 0), 0),
            pakan_ternak: invRows.filter(r => r.item_id === 'pakan_ternak').reduce((a, r) => a + Number(r.quantity || 0), 0)
        };

        return {
            player,
            pens,
            invRows,
            lvInfo,
            slotsUsed,
            feedStock
        };
    });
}

async function rentOrBuyPen(discordId, ownershipType = 'rented', now = Date.now()) {
    const isBuy = ownershipType === 'owned';
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        if ((p.current_city || 'kota_sentral') !== 'kota_timur') {
            return { ok: false, error: 'WRONG_CITY', player: p };
        }

        const pens = await getPlayerLivestockPens(conn, discordId, now, true);
        if (pens.length >= LIVESTOCK_LIMITS.MAX_TOTAL_PENS) {
            return { ok: false, error: 'MAX_TOTAL_PENS', maxTotal: LIVESTOCK_LIMITS.MAX_TOTAL_PENS, player: p };
        }

        const rentedPens = pens.filter(x => x.ownership_type === 'rented');
        const ownedPens = pens.filter(x => x.ownership_type === 'owned');

        if (!isBuy && rentedPens.length >= LIVESTOCK_LIMITS.MAX_RENTED_PENS) {
            return { ok: false, error: 'MAX_RENTED_PENS', maxRented: LIVESTOCK_LIMITS.MAX_RENTED_PENS, player: p };
        }

        const nth = isBuy ? (ownedPens.length + 1) : (rentedPens.length + 1);
        const cost = isBuy ? calculatePenBuyPrice(nth) : calculatePenRentPrice(nth);
        const totalFunds = Number(p.cash) + Number(p.bank);
        if (totalFunds < cost) {
            return { ok: false, error: 'INSUFFICIENT_FUNDS', cost, totalFunds, player: p };
        }

        await debitPlayerFunds(conn, p, cost, isBuy ? 'livestock_buy_pen' : 'livestock_rent_pen', { nth }, now);

        const usedNumbers = new Set(pens.map(x => x.pen_number));
        let nextNum = 1;
        while (usedNumbers.has(nextNum)) nextNum += 1;

        const nextBillingAt = isBuy ? null : (now + LIVESTOCK_LIMITS.RENT_BILLING_INTERVAL_MS);
        await conn.execute(
            `INSERT INTO player_livestock_pens
             (discord_id, pen_number, ownership_type, species_id, phase, fed, cleaned, cycles_left, phase_started_at, mature_at, next_billing_at, is_locked)
             VALUES (?, ?, ?, NULL, 0, 0, 1, 0, NULL, NULL, ?, 0)`,
            [discordId, nextNum, isBuy ? 'owned' : 'rented', nextBillingAt]
        );

        await logPlayerActivity(conn, discordId, 'livestock', isBuy ? 'buy_pen' : 'rent_pen', { penNumber: nextNum, cost }, now);
        return { ok: true, ownershipType: isBuy ? 'owned' : 'rented', penNumber: nextNum, cost, player: p };
    });
}

async function buyAndPlaceLivestock(discordId, speciesId, now = Date.now()) {
    const species = getLivestockSpecies(speciesId);
    if (!species) return { ok: false, error: 'INVALID_SPECIES' };

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        if ((p.current_city || 'kota_sentral') !== 'kota_timur') {
            return { ok: false, error: 'WRONG_CITY', player: p };
        }

        const lvInfo = getLevelInfoFromXp(p.farming_xp || 0);
        if (lvInfo.level < species.minLevel) {
            return { ok: false, error: 'LEVEL_TOO_LOW', minLevel: species.minLevel, currentLevel: lvInfo.level, species, player: p };
        }

        const pens = await getPlayerLivestockPens(conn, discordId, now, true);
        const emptyPen = pens.find(x => !x.is_locked && x.phase === 0 && !x.species_id);
        if (!emptyPen) {
            return { ok: false, error: 'NO_EMPTY_PEN', player: p };
        }

        const totalFunds = Number(p.cash) + Number(p.bank);
        if (totalFunds < species.buyPrice) {
            return { ok: false, error: 'INSUFFICIENT_FUNDS', cost: species.buyPrice, totalFunds, species, player: p };
        }

        await debitPlayerFunds(conn, p, species.buyPrice, 'livestock_buy_animal', {
            speciesId: species.id,
            penNumber: emptyPen.pen_number
        }, now);

        await conn.execute(
            `UPDATE player_livestock_pens
             SET species_id = ?, phase = 1, fed = 0, cleaned = 1, cycles_left = ?, phase_started_at = ?, mature_at = NULL
             WHERE id = ?`,
            [species.id, species.maxCycles, now, emptyPen.id]
        );

        await logPlayerActivity(conn, discordId, 'livestock', 'place_animal', {
            speciesId: species.id,
            penNumber: emptyPen.pen_number
        }, now);

        return { ok: true, species, penNumber: emptyPen.pen_number, cost: species.buyPrice, player: p };
    });
}

async function feedAllPens(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        if ((p.current_city || 'kota_sentral') !== 'kota_timur') {
            return { ok: false, error: 'WRONG_CITY', player: p };
        }

        const pens = await getPlayerLivestockPens(conn, discordId, now, true);
        const hungryPens = pens.filter(x => !x.is_locked && x.phase === 1 && x.species_id);
        if (hungryPens.length === 0) {
            return { ok: false, error: 'NO_HUNGRY_PENS', player: p };
        }

        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
        const bagCounts = new Map();
        for (const r of invRows) {
            bagCounts.set(r.item_id, (bagCounts.get(r.item_id) || 0) + Number(r.quantity || 0));
        }

        let fedCount = 0;
        let energySpent = 0;
        const consumedFeedMap = new Map();

        for (const pen of hungryPens) {
            const species = getLivestockSpecies(pen.species_id);
            if (!species) continue;
            if (p.energy < 1) break;

            const chosenOpt = (species.feedOptions || []).find(opt => (bagCounts.get(opt.itemId) || 0) >= opt.qty);
            if (!chosenOpt) continue;

            bagCounts.set(chosenOpt.itemId, (bagCounts.get(chosenOpt.itemId) || 0) - chosenOpt.qty);
            consumedFeedMap.set(chosenOpt.itemId, (consumedFeedMap.get(chosenOpt.itemId) || 0) + chosenOpt.qty);

            const matureAt = now + species.cycleHours * 3600000;
            await conn.execute(
                `UPDATE player_livestock_pens
                 SET phase = 2, fed = 1, phase_started_at = ?, mature_at = ?
                 WHERE id = ?`,
                [now, matureAt, pen.id]
            );

            p.energy = Math.max(0, Math.round((p.energy - 1) * 100) / 100);
            energySpent += 1;
            fedCount += 1;
        }

        if (fedCount === 0) {
            return { ok: false, error: p.energy < 1 ? 'LOW_ENERGY' : 'NO_FEED_IN_BAG', player: p };
        }

        for (const [feedItemId, qty] of consumedFeedMap.entries()) {
            await removeItem(conn, discordId, feedItemId, qty, 'bag');
        }

        await conn.execute(`UPDATE players SET energy = ? WHERE discord_id = ?`, [p.energy, discordId]);

        return {
            ok: true,
            fedCount,
            energySpent,
            consumedFeed: Array.from(consumedFeedMap.entries()).map(([itemId, qty]) => ({ itemId, qty })),
            player: p
        };
    });
}

async function harvestAllPens(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        if ((p.current_city || 'kota_sentral') !== 'kota_timur') {
            return { ok: false, error: 'WRONG_CITY', player: p };
        }

        const pens = await getPlayerLivestockPens(conn, discordId, now, true);
        const readyPens = pens.filter(x => !x.is_locked && x.phase === 3 && x.species_id);
        if (readyPens.length === 0) {
            return { ok: false, error: 'NO_READY_PENS', player: p };
        }

        let invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
        const lvInfo = getLevelInfoFromXp(p.farming_xp || 0);
        const bonusChance = getBonusYieldChanceFromLevel(lvInfo.level);

        let harvestedCount = 0;
        let retiredCount = 0;
        let xpGained = 0;
        const gainsMap = new Map();
        const simulatedInv = invRows.map(r => ({ ...r }));

        for (const pen of readyPens) {
            const species = getLivestockSpecies(pen.species_id);
            if (!species) continue;

            const bonusUnit = Math.random() < bonusChance ? 1 : 0;
            const produceQty = species.yieldQty + bonusUnit;
            const nextCycles = Math.max(0, Number(pen.cycles_left || 1) - 1);
            const willRetire = nextCycles <= 0;

            const toAdd = [{ itemId: species.yieldItemId, qty: produceQty }];
            if (willRetire && species.retireItemId && species.retireQty > 0) {
                toAdd.push({ itemId: species.retireItemId, qty: species.retireQty });
            }

            const fit = canFitItems(simulatedInv, p.max_slots, toAdd);
            if (!fit.fits) {
                if (harvestedCount === 0) {
                    return { ok: false, error: 'BAG_FULL', slotsAfter: fit.slotsAfter, maxSlots: fit.maxSlots, player: p };
                }
                break;
            }

            for (const itemEntry of toAdd) {
                await addItem(conn, discordId, itemEntry.itemId, itemEntry.qty, now, 'bag');
                gainsMap.set(itemEntry.itemId, (gainsMap.get(itemEntry.itemId) || 0) + itemEntry.qty);
                // Perbarui simulasi kapasitas slot secara ringkas
                const itMeta = getItem(itemEntry.itemId);
                simulatedInv.push({ item_id: itemEntry.itemId, quantity: itemEntry.qty, durability: null, freshness_remaining_ms: itMeta?.shelfLifeHours ? itMeta.shelfLifeHours * 3600000 : null });
            }

            if (willRetire) {
                retiredCount += 1;
                await conn.execute(
                    `UPDATE player_livestock_pens
                     SET species_id = NULL, phase = 0, fed = 0, cleaned = 1, cycles_left = 0, phase_started_at = NULL, mature_at = NULL
                     WHERE id = ?`,
                    [pen.id]
                );
            } else {
                await conn.execute(
                    `UPDATE player_livestock_pens
                     SET phase = 1, fed = 0, cycles_left = ?, phase_started_at = ?, mature_at = NULL
                     WHERE id = ?`,
                    [nextCycles, now, pen.id]
                );
            }

            xpGained += species.xpReward || 15;
            harvestedCount += 1;
        }

        const oldLv = lvInfo.level;
        p.farming_xp = Number(p.farming_xp || 0) + xpGained;
        const newLv = getLevelInfoFromXp(p.farming_xp).level;

        await conn.execute(`UPDATE players SET farming_xp = ? WHERE discord_id = ?`, [p.farming_xp, discordId]);
        await logPlayerActivity(conn, discordId, 'livestock', 'harvest', {
            harvestedCount,
            retiredCount,
            xpGained
        }, now);

        return {
            ok: true,
            harvestedCount,
            retiredCount,
            xpGained,
            leveledUp: newLv > oldLv,
            newLevel: newLv,
            gains: Array.from(gainsMap.entries()).map(([itemId, qty]) => ({ itemId, qty })),
            player: p
        };
    });
}

async function cleanRetiredPens(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const pens = await getPlayerLivestockPens(conn, discordId, now, true);
        const dirtyPens = pens.filter(x => !x.is_locked && x.phase === 4);
        if (dirtyPens.length === 0) {
            return { ok: false, error: 'NO_DIRTY_PENS', player: p };
        }
        for (const pen of dirtyPens) {
            await conn.execute(
                `UPDATE player_livestock_pens
                 SET species_id = NULL, phase = 0, fed = 0, cleaned = 1, cycles_left = 0, phase_started_at = NULL, mature_at = NULL
                 WHERE id = ?`,
                [pen.id]
            );
        }
        return { ok: true, cleanedCount: dirtyPens.length, player: p };
    });
}

async function releaseRentedPen(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const pens = await getPlayerLivestockPens(conn, discordId, now, true);
        const releasable = pens
            .filter(x => x.ownership_type === 'rented' && (x.phase === 0 || x.phase === 4 || x.is_locked === 1))
            .sort((a, b) => b.pen_number - a.pen_number)[0];

        if (!releasable) {
            return { ok: false, error: 'NO_RELEASABLE_RENTED_PEN', player: p };
        }
        await conn.execute(`DELETE FROM player_livestock_pens WHERE id = ?`, [releasable.id]);
        return { ok: true, penNumber: releasable.pen_number, player: p };
    });
}

async function unlockLockedPens(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const pens = await getPlayerLivestockPens(conn, discordId, now, true);
        const lockedRented = pens.filter(x => x.ownership_type === 'rented' && x.is_locked === 1);
        if (lockedRented.length === 0) {
            return { ok: false, error: 'NO_LOCKED_PENS', player: p };
        }

        const rentedAll = pens.filter(x => x.ownership_type === 'rented');
        let totalCost = 0;
        for (const pen of lockedRented) {
            const rank = rentedAll.findIndex(r => r.id === pen.id) + 1;
            totalCost += calculatePenRentPrice(Math.max(1, rank));
        }

        const totalFunds = Number(p.cash) + Number(p.bank);
        if (totalFunds < totalCost) {
            return { ok: false, error: 'INSUFFICIENT_FUNDS', cost: totalCost, totalFunds, player: p };
        }

        await debitPlayerFunds(conn, p, totalCost, 'livestock_unlock_rent', { count: lockedRented.length }, now);
        for (const pen of lockedRented) {
            await conn.execute(
                `UPDATE player_livestock_pens SET is_locked = 0, next_billing_at = ? WHERE id = ?`,
                [now + LIVESTOCK_LIMITS.RENT_BILLING_INTERVAL_MS, pen.id]
            );
        }

        return { ok: true, unlockedCount: lockedRented.length, cost: totalCost, player: p };
    });
}

async function processDueLivestockPenBillings(conn, now = Date.now()) {
    const [dueRows] = await conn.execute(
        `SELECT * FROM player_livestock_pens
         WHERE ownership_type = 'rented' AND next_billing_at IS NOT NULL AND next_billing_at <= ?
         FOR UPDATE`,
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

    for (const [discordId, userDuePens] of byUser.entries()) {
        const [allRentRows] = await conn.execute(
            `SELECT id FROM player_livestock_pens
             WHERE discord_id = ? AND ownership_type = 'rented'
             ORDER BY pen_number ASC`,
            [discordId]
        );
        const rankMap = new Map();
        allRentRows.forEach((r, idx) => rankMap.set(r.id, idx + 1));

        const [pRows] = await conn.execute(
            `SELECT cash, bank FROM players WHERE discord_id = ? FOR UPDATE`,
            [discordId]
        );
        if (pRows.length === 0) continue;

        let cash = Number(pRows[0].cash || 0);
        let bank = Number(pRows[0].bank || 0);

        for (const pen of userDuePens) {
            const rank = rankMap.get(pen.id) || 1;
            const rentCost = calculatePenRentPrice(rank);

            if (cash + bank >= rentCost) {
                const fromBank = Math.min(bank, rentCost);
                bank -= fromBank;
                cash -= (rentCost - fromBank);

                await conn.execute(
                    `UPDATE player_livestock_pens SET is_locked = 0, next_billing_at = ? WHERE id = ?`,
                    [now + LIVESTOCK_LIMITS.RENT_BILLING_INTERVAL_MS, pen.id]
                );

                await logLedger(
                    conn,
                    discordId,
                    'sink',
                    'livestock_weekly_rent',
                    rentCost,
                    cash + bank,
                    { penNumber: pen.pen_number, rank },
                    now
                );
                paidCount += 1;
            } else {
                await conn.execute(
                    `UPDATE player_livestock_pens SET is_locked = 1, next_billing_at = ? WHERE id = ?`,
                    [now + 24 * 3600 * 1000, pen.id]
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
    LIVESTOCK_SPECIES,
    computeLazyPenState,
    getPlayerLivestockPens,
    fetchTernakState,
    rentOrBuyPen,
    buyAndPlaceLivestock,
    feedAllPens,
    harvestAllPens,
    cleanRetiredPens,
    releaseRentedPen,
    unlockLockedPens,
    processDueLivestockPenBillings
};
