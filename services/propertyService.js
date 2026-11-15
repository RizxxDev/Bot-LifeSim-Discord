const { getPropertyTier, calculateMonthlyPbb, convertPresetToBlueprint } = require('../data/properties');
const { getProgressivePbbMultiplier } = require('../data/buildingModules');
const { debitPlayerFunds, creditPlayerCash, logLedger } = require('./economyService');
const {
    getEffectiveLocalProperty,
    getLandCells,
    computeLandStats,
    buyLand,
    forecloseAbandonedLands
} = require('./landService');

const ONE_WEEK_MS = 7 * 86400000;
const ONE_MONTH_MS = 30 * 86400000;
const GRACE_PERIOD_MS = 3 * 86400000;

/**
 * Menghitung prorata sewa untuk upgrade kontrak kos/kontrakan dalam kota yang sama.
 */
function calculateProratedUpgradeRent(currentPropRow, targetTierObj, now = Date.now()) {
    const baseRent = Number(targetTierObj.rentPerWeek || 0);
    if (!currentPropRow || Number(currentPropRow.is_evicted) === 1 || currentPropRow.ownership_type === 'owned') {
        return { baseRent, unusedCredit: 0, netPayable: baseRent };
    }

    const tierId = currentPropRow.preset_tier || currentPropRow.property_tier;
    const currentTier = getPropertyTier(tierId);
    if (!currentTier || currentTier.order >= targetTierObj.order) {
        return { baseRent, unusedCredit: 0, netPayable: baseRent };
    }

    const remainingMs = Math.max(0, Number(currentPropRow.next_billing_at || 0) - now);
    const ratio = Math.min(1, remainingMs / ONE_WEEK_MS);
    const unusedCredit = Math.round(Number(currentTier.rentPerWeek || 0) * ratio);
    const netPayable = Math.max(0, baseRent - unusedCredit);

    return { baseRent, unusedCredit, netPayable };
}

/**
 * Mengambil status properti efektif pemain pada kota tempat berada (atau cityId tertentu).
 * Mempertahankan seluruh struktur field lama plus landId/land/cityLands untuk sistem modular.
 */
async function getPlayerPropertyStatus(conn, discordId, playerMaxSlots = 20, now = Date.now(), forUpdate = false, cityId = null) {
    let targetCity = cityId;
    if (!targetCity) {
        const [pRows] = await conn.execute(
            `SELECT current_city, traveling_until, travel_destination FROM players WHERE discord_id = ? LIMIT 1`,
            [discordId]
        );
        if (pRows.length > 0) {
            const p = pRows[0];
            targetCity = (Number(p.traveling_until || 0) > 0 && now >= Number(p.traveling_until) && p.travel_destination)
                ? p.travel_destination
                : (p.current_city || 'kota_sentral');
        } else {
            targetCity = 'kota_sentral';
        }
    }

    const effective = await getEffectiveLocalProperty(conn, discordId, targetCity, playerMaxSlots, now, forUpdate);

    const [cbRows] = await conn.execute(
        `SELECT COALESCE(SUM(quantity), 0) AS total_cb
         FROM player_inventory
         WHERE discord_id = ? AND item_id = 'cooler_box'`,
        [discordId]
    );
    const hasCoolerBox = Number(cbRows[0]?.total_cb || 0) > 0;

    const effectiveTier = effective.tierObj || getPropertyTier('tunawisma');
    const storageLimits = effective.storageLimits || {
        bag: Number(playerMaxSlots || 20),
        kulkas: 0,
        freezer: 0,
        gudang: 0
    };

    const compatRow = effective.lease || effective.land || effective.legacyRow || null;

    return {
        row: compatRow,
        lease: effective.lease || null,
        landId: effective.landId || null,
        land: effective.land || null,
        cityLands: effective.cityLands || [],
        stats: effective.stats || null,
        source: effective.source,
        ownershipType: effective.ownershipType,
        customName: effective.customName,
        conditionPct: effective.conditionPct ?? 100,
        buildingState: effective.buildingState || 'active',
        conditionMeta: effective.conditionMeta || null,
        facilitiesLocked: Boolean(effective.facilitiesLocked),
        propertyCityId: effective.cityId || targetCity,
        actualTier: effectiveTier,
        effectiveTier,
        isEvicted: Boolean(effective.isEvicted),
        inGracePeriod: Boolean(effective.lease && Number(effective.lease.grace_until || 0) > now),
        hasCoolerBox,
        capacities: {
            bag: Number(playerMaxSlots || 20),
            coolerbox: hasCoolerBox ? 8 : 0,
            kulkas: Number(storageLimits.kulkas || 0),
            freezer: Number(storageLimits.freezer || 0),
            gudang: Number(storageLimits.gudang || 0),
            stove: Number(effective.cookingSlots || 0)
        }
    };
}

/**
 * Menyewa hunian NPC pemula (Kos / Kontrakan) di kota pemain saat ini.
 */
async function rentProperty(conn, player, tierId, now = Date.now()) {
    const targetTier = getPropertyTier(tierId);
    if (!targetTier || targetTier.id === 'tunawisma' || !targetTier.canRent) {
        return { error: 'NOT_RENTABLE', targetTier };
    }

    const cityId = player.current_city || 'kota_sentral';
    const status = await getPlayerPropertyStatus(conn, player.discord_id, player.max_slots, now, true, cityId);

    if (status.source === 'owned_land') {
        return { error: 'ALREADY_OWNED_EQUAL_OR_HIGHER', ownedTier: status.actualTier };
    }

    const currentLease = status.lease;
    if (currentLease && currentLease.lease_kind === 'npc_preset' && Number(currentLease.is_evicted) === 0) {
        const curNpcTier = getPropertyTier(currentLease.preset_tier);
        if (curNpcTier.order > targetTier.order) {
            return { error: 'CANNOT_DOWNGRADE_ACTIVE_RENT', currentTier: curNpcTier };
        }
    }

    const prorata = calculateProratedUpgradeRent(currentLease, targetTier, now);
    const cost = prorata.netPayable;
    const totalBalance = Number(player.cash || 0) + Number(player.bank || 0);
    if (totalBalance < cost) {
        return {
            error: 'INSUFFICIENT_FUNDS',
            cost,
            totalBalance,
            targetTier
        };
    }

    await debitPlayerFunds(
        conn,
        player,
        cost,
        'property_rent',
        { tierId: targetTier.id, cityId, prorata },
        now
    );

    const nextBillingAt = now + ONE_WEEK_MS;

    if (currentLease && currentLease.lease_kind === 'npc_preset') {
        await conn.execute(
            `UPDATE property_leases
             SET preset_tier = ?, weekly_rent = ?, next_billing_at = ?, grace_until = 0, is_evicted = 0
             WHERE id = ?`,
            [targetTier.id, targetTier.rentPerWeek, nextBillingAt, currentLease.id]
        );
    } else {
        await conn.execute(
            `INSERT INTO property_leases
             (land_id, zone_group_id, owner_id, tenant_id, city_id, lease_kind, preset_tier, weekly_rent, next_billing_at, grace_until, is_evicted, created_at)
             VALUES (NULL, NULL, NULL, ?, ?, 'npc_preset', ?, ?, ?, 0, 0, ?)`,
            [player.discord_id, cityId, targetTier.id, targetTier.rentPerWeek, nextBillingAt, now]
        );
    }

    return {
        ok: true,
        targetTier,
        cost,
        prorata,
        nextBillingAt,
        player
    };
}

/**
 * Membeli paket rumah preset (mengonversi ke kavling modular + cetak biru siap pakai).
 */
async function buyProperty(conn, player, tierId, now = Date.now()) {
    const bp = convertPresetToBlueprint(tierId);
    if (!bp) {
        return { error: 'NOT_BUYABLE', targetTier: getPropertyTier(tierId) };
    }

    const cityId = player.current_city || 'kota_sentral';
    const cost = Number(bp.buyPrice);
    const totalBalance = Number(player.cash || 0) + Number(player.bank || 0);
    if (totalBalance < cost) {
        return {
            error: 'INSUFFICIENT_FUNDS',
            cost,
            totalBalance,
            targetTier: getPropertyTier(tierId)
        };
    }

    const res = await buyLand(conn, player.discord_id, {
        cityId,
        landTierId: bp.landTier,
        customName: bp.name,
        themeId: bp.themeId,
        initialCells: bp.cells,
        customPurchasePrice: cost
    }, now);

    if (!res.ok) {
        return { error: 'PURCHASE_FAILED', message: res.error, targetTier: getPropertyTier(tierId) };
    }

    return {
        ok: true,
        targetTier: getPropertyTier(tierId),
        landId: res.landId,
        cost,
        nextBillingAt: now + ONE_MONTH_MS,
        player
    };
}

/**
 * Mengakhiri kontrak sewa (Kos/Kontrakan/P2P) di kota aktif.
 */
async function moveOutProperty(conn, discordId, now = Date.now(), cityId = null) {
    let targetCity = cityId;
    if (!targetCity) {
        const [pRows] = await conn.execute(`SELECT current_city FROM players WHERE discord_id = ? LIMIT 1`, [discordId]);
        targetCity = pRows[0]?.current_city || 'kota_sentral';
    }

    const [leaseRows] = await conn.execute(
        `SELECT * FROM property_leases WHERE tenant_id = ? AND city_id = ? AND is_evicted = 0 FOR UPDATE`,
        [discordId, targetCity]
    );

    if (leaseRows.length === 0) {
        // Fallback cek legacy player_properties
        const [legacyRows] = await conn.execute(
            `SELECT * FROM player_properties WHERE discord_id = ? AND ownership_type = 'rent' AND is_evicted = 0 FOR UPDATE`,
            [discordId]
        );
        if (legacyRows.length === 0) {
            return { error: 'NO_ACTIVE_PROPERTY' };
        }
        await conn.execute(
            `UPDATE player_properties SET is_evicted = 1, grace_until = 0, next_billing_at = 0, updated_at = ? WHERE discord_id = ?`,
            [now, discordId]
        );
        return { ok: true, prevTier: getPropertyTier(legacyRows[0].property_tier) };
    }

    const current = leaseRows[0];
    await conn.execute(
        `UPDATE property_leases SET is_evicted = 1, grace_until = 0, next_billing_at = 0 WHERE id = ?`,
        [current.id]
    );
    return { ok: true, prevTier: getPropertyTier(current.preset_tier || 'kos') };
}

/**
 * Scheduler Ekonomi:
 * 1. Menagih sewa mingguan property_leases (NPC & P2P) + masa tenggang 3 hari.
 * 2. Menagih PBB bulanan progresif seluruh kavling player_lands.
 */
async function processDuePropertyBillings(conn, now = Date.now()) {
    let leaseCharged = 0;
    let evicted = 0;
    let pbbCharged = 0;

    // 1. Tagihan Sewa (NPC & P2P)
    const [dueLeases] = await conn.execute(
        `SELECT * FROM property_leases
         WHERE is_evicted = 0 AND next_billing_at > 0 AND next_billing_at <= ?
         FOR UPDATE`,
        [now]
    );

    for (const lease of dueLeases) {
        const [tRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? FOR UPDATE`, [lease.tenant_id]);
        if (tRows.length === 0) continue;
        const tenant = tRows[0];
        const fee = Number(lease.weekly_rent || 0);
        const bankBal = Number(tenant.bank || 0);

        if (bankBal >= fee) {
            const newBank = bankBal - fee;
            await conn.execute(`UPDATE players SET bank = ? WHERE discord_id = ?`, [newBank, lease.tenant_id]);
            await logLedger(
                conn,
                lease.tenant_id,
                'sink',
                lease.lease_kind === 'npc_preset' ? 'property_rent_auto' : 'p2p_property_rent_auto',
                fee,
                Number(tenant.cash || 0) + newBank,
                { leaseId: lease.id, cityId: lease.city_id },
                now
            );

            // Salurkan 95% ke pemilik jika kontrak P2P
            if (lease.owner_id && lease.lease_kind !== 'npc_preset') {
                const [oRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? FOR UPDATE`, [lease.owner_id]);
                if (oRows.length > 0) {
                    const net = Math.round(fee * 0.95);
                    await creditPlayerCash(conn, oRows[0], net, 'p2p_property_rent_income', { leaseId: lease.id, tenantId: lease.tenant_id }, now);
                }
            }

            await conn.execute(
                `UPDATE property_leases SET next_billing_at = ?, grace_until = 0 WHERE id = ?`,
                [Number(lease.next_billing_at) + ONE_WEEK_MS, lease.id]
            );
            leaseCharged += 1;
        } else {
            const graceUntil = Number(lease.grace_until || 0);
            if (graceUntil === 0) {
                await conn.execute(
                    `UPDATE property_leases SET grace_until = ? WHERE id = ?`,
                    [now + GRACE_PERIOD_MS, lease.id]
                );
            } else if (now >= graceUntil) {
                await conn.execute(
                    `UPDATE property_leases SET is_evicted = 1, grace_until = 0 WHERE id = ?`,
                    [lease.id]
                );
                evicted += 1;
            }
        }
    }

    // 2. Tagihan PBB Bulanan Kavling player_lands (progresif per jumlah kavling pemilik)
    const [dueLands] = await conn.execute(
        `SELECT * FROM player_lands WHERE next_pbb_at > 0 AND next_pbb_at <= ? ORDER BY discord_id ASC, acquired_at ASC FOR UPDATE`,
        [now]
    );

    const ownerOrdinalCounter = new Map();
    for (const land of dueLands) {
        const ord = ownerOrdinalCounter.get(land.discord_id) || 0;
        ownerOrdinalCounter.set(land.discord_id, ord + 1);

        const cells = await getLandCells(conn, land.id, 'active');
        const stats = computeLandStats(cells, land);
        const mult = getProgressivePbbMultiplier(ord);
        const pbbFee = Math.max(0, Math.round(stats.monthlyPbbBase * mult));

        const [pRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? FOR UPDATE`, [land.discord_id]);
        if (pRows.length === 0) continue;
        const owner = pRows[0];
        const bankBal = Number(owner.bank || 0);

        if (bankBal >= pbbFee && pbbFee > 0) {
            const newBank = bankBal - pbbFee;
            await conn.execute(`UPDATE players SET bank = ? WHERE discord_id = ?`, [newBank, land.discord_id]);
            await logLedger(
                conn,
                land.discord_id,
                'sink',
                'property_land_pbb',
                pbbFee,
                Number(owner.cash || 0) + newBank,
                { landId: land.id, progressiveMult: mult },
                now
            );
            await conn.execute(
                `UPDATE player_lands SET next_pbb_at = ? WHERE id = ?`,
                [Number(land.next_pbb_at) + ONE_MONTH_MS, land.id]
            );
            pbbCharged += 1;
        } else {
            // Jika gagal bayar PBB, mulai grace period penyitaan 21 hari & turunkan kondisi karena terbengkalai
            const nextGrace = Number(land.grace_until || 0) > 0
                ? Number(land.grace_until)
                : (now + (21 * 86400000));
            await conn.execute(
                `UPDATE player_lands
                 SET next_pbb_at = ?, grace_until = ?, condition_pct = GREATEST(0, condition_pct - 5)
                 WHERE id = ?`,
                [now + 86400000, nextGrace, land.id]
            );
        }
    }

    // 3. Sita kavling yang melewati grace period PBB 21 hari atau terbengkalai > 21 hari
    const forecloseRes = await forecloseAbandonedLands(conn, now);

    return { leaseCharged, evicted, pbbCharged, foreclosed: forecloseRes.foreclosedCount, calculateMonthlyPbb };
}

module.exports = {
    ONE_WEEK_MS,
    ONE_MONTH_MS,
    GRACE_PERIOD_MS,
    calculateProratedUpgradeRent,
    getPlayerPropertyStatus,
    rentProperty,
    buyProperty,
    moveOutProperty,
    processDuePropertyBillings
};
