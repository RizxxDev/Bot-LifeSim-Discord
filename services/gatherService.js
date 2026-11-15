const { withTransaction, query } = require('../database/mariadb');
const { getCooldownRemaining, setCooldown, incrementDailyAction } = require('../database/redis');
const { syncPlayerVitals, checkActivityEligibility, deductActivityVitals } = require('./vitalService');
const {
    calculateSlotsUsed,
    canFitItems,
    getPlayerInventory,
    addItem,
    getBestWorkingTool,
    damageTool,
    recordCollection
} = require('./inventoryService');
const { isNewbieBoostActive, getSoftCapModifier, getLiveEconomyConfig } = require('./economyService');
const { applyTripVehicleUsage } = require('./vehicleService');
const { awardEventActivityProgress } = require('./eventService');
const { rollActivityBonusTicket } = require('./gachaService');
const { GATHER_ZONES, GATHER_ACTIVITY_COST, getGatherZone, rollGatherDrops, getLevelInfoFromXp } = require('../data/gathering');
const { ACTIVITY_COSTS } = require('../data/constants');
const { getItem } = require('../data/items');

async function fetchGatherState(discordId, now = Date.now()) {
    const remCd = await getCooldownRemaining(discordId, 'gather', query);
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const p = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const bestAxe = getBestWorkingTool(invRows, 'axe');
        const bestShovel = getBestWorkingTool(invRows, 'shovel');
        const lvInfo = getLevelInfoFromXp(Number(p.gathering_xp || 0));
        const slotsUsed = calculateSlotsUsed(invRows);
        const zone = getGatherZone(p.last_gather_loc || 'hutan_pinus');
        const cost = ACTIVITY_COSTS.gather || GATHER_ACTIVITY_COST;
        const elig = checkActivityEligibility(p, cost, 'gather', now);

        return {
            player: p,
            buffs: synced.buffs,
            invRows,
            bestAxe,
            bestShovel,
            lvInfo,
            slotsUsed,
            zone,
            elig,
            remCd
        };
    });
}

async function selectGatherZone(discordId, zoneId, now = Date.now()) {
    const zone = getGatherZone(zoneId);
    await query(
        `UPDATE players SET last_gather_loc = ? WHERE discord_id = ?`,
        [zone.id, discordId]
    );
    return zone;
}

async function executeGatherAction(discordId, zoneIdOverride = null, now = Date.now()) {
    const remCd = await getCooldownRemaining(discordId, 'gather', query);
    if (remCd > 0) {
        return {
            ok: false,
            onCooldown: true,
            remCd,
            error: `Tanganmu masih pegal! Kamu bisa menebang/menggali lagi <t:${Math.floor((now + remCd) / 1000)}:R>.`
        };
    }

    const cost = ACTIVITY_COSTS.gather || GATHER_ACTIVITY_COST;

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const cityId = p.current_city || 'kota_sentral';
        if (cityId !== 'kota_timur') {
            return {
                ok: false,
                wrongCity: true,
                error: 'Hutan Kayu & Galian Bahan Bangunan hanya ada di **Lembah Hijau (`kota_timur`)**! Gunakan `/travel`.'
            };
        }

        const elig = checkActivityEligibility(p, cost, 'gather', now);
        if (!elig.allowed) return { ok: false, error: elig.message };

        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
        const slotsUsed = calculateSlotsUsed(invRows);
        if (slotsUsed >= Number(p.max_slots || 20)) {
            return { ok: false, error: 'Tasmu penuh! Simpan bahan ke Gudang Proyek (`/build`) atau `/storage` terlebih dahulu.' };
        }

        const zone = getGatherZone(zoneIdOverride || p.last_gather_loc || 'hutan_pinus');
        const lvInfo = getLevelInfoFromXp(Number(p.gathering_xp || 0));
        if (lvInfo.level < zone.minLevel) {
            return { ok: false, error: `Zona **${zone.name}** membutuhkan Gathering **Lv. ${zone.minLevel}** (kamu masih Lv. ${lvInfo.level}).` };
        }

        const bestTool = getBestWorkingTool(invRows, zone.requiredToolTag);
        if (!bestTool) {
            const toolHint = zone.requiredToolTag === 'axe' ? 'Kapak (`kapak_tangan`)' : 'Sekop (`sekop_baja`)';
            return { ok: false, error: `Tidak ada ${toolHint} siap pakai di tasmu! Beli di \`/shop\` (Toko Perkakas).` };
        }
        if ((bestTool.item.toolTier || 1) < zone.minToolTier) {
            return { ok: false, error: `Zona **${zone.name}** membutuhkan alat minimal Tier ${zone.minToolTier}.` };
        }

        const dailyActionCount = await incrementDailyAction(discordId, 'gathering', now);
        const ecoCfg = await getLiveEconomyConfig(conn);
        const softCap = getSoftCapModifier('gathering', dailyActionCount, ecoCfg.soft_cap_enabled);

        const rawDrops = rollGatherDrops(zone, Number(bestTool.item.rarityBonus || 0), lvInfo.level);
        const addedDrops = [];
        let simRows = [...invRows];

        for (const drop of rawDrops) {
            const qtyScaled = Math.max(1, Math.round(drop.quantity * softCap.multiplier));
            if (!canFitItems(simRows, Number(p.max_slots || 20), [{ itemId: drop.itemId, qty: qtyScaled }])) {
                continue;
            }
            await addItem(conn, discordId, drop.itemId, qtyScaled, now, 'bag');
            await recordCollection(conn, discordId, drop.itemId, qtyScaled, now);
            addedDrops.push({ itemId: drop.itemId, quantity: qtyScaled, item: getItem(drop.itemId) });
            simRows.push({ item_id: drop.itemId, quantity: qtyScaled, durability: null });
        }

        if (addedDrops.length === 0) {
            return { ok: false, error: 'Sisa slot tas tidak cukup menampung hasil! Sisakan minimal 1-2 slot kosong.' };
        }

        await damageTool(conn, bestTool.row.id, 1);
        const remainingToolDur = Math.max(0, Number(bestTool.row.durability) - 1);

        const newbieMult = isNewbieBoostActive(p, now) ? 1.5 : 1.0;
        const gainedXp = Math.max(2, Math.round(zone.baseXp * softCap.multiplier * newbieMult));
        const oldLv = lvInfo.level;
        p.gathering_xp = Number(p.gathering_xp || 0) + gainedXp;
        const newLvInfo = getLevelInfoFromXp(p.gathering_xp);

        const tripVeh = await applyTripVehicleUsage(conn, discordId, zone.id);
        const effectiveCost = {
            ...cost,
            energy: Math.max(1, cost.energy - Number(tripVeh.energyDiscount || 0))
        };
        const hospitalized = deductActivityVitals(p, effectiveCost, 0, now);

        await setCooldown(
            discordId,
            'gather',
            cost.cooldownSec,
            (sql, params) => conn.execute(sql, params)
        );

        await conn.execute(
            `UPDATE players
             SET energy = ?, hunger = ?, thirst = ?, health = ?,
                 cash = ?, bank = ?, hospital_until = ?, sleeping_until = ?,
                 gathering_xp = ?, last_gather_loc = ?
             WHERE discord_id = ?`,
            [
                p.energy, p.hunger, p.thirst, p.health,
                p.cash, p.bank, p.hospital_until, p.sleeping_until,
                p.gathering_xp, zone.id,
                discordId
            ]
        );

        const eventReward = await awardEventActivityProgress(conn, discordId, 'gather', now);
        const gachaTicketDrop = await rollActivityBonusTicket(conn, discordId, 'gather', { maxSlots: p.max_slots }, now);

        return {
            ok: true,
            zone,
            tool: bestTool,
            remainingToolDur,
            drops: addedDrops,
            gainedXp,
            newLvInfo,
            leveledUp: newLvInfo.level > oldLv,
            softCap,
            tripVeh,
            eventReward,
            gachaTicketDrop,
            hospitalized,
            cooldownSec: cost.cooldownSec
        };
    });
}

module.exports = {
    GATHER_ZONES,
    fetchGatherState,
    selectGatherZone,
    executeGatherAction
};
