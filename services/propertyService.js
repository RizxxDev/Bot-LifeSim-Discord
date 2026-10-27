const { getPropertyTier, calculateMonthlyPbb } = require('../data/properties');
const { debitPlayerFunds } = require('./economyService');

const ONE_WEEK_MS = 7 * 86400000;
const ONE_MONTH_MS = 30 * 86400000;
const GRACE_PERIOD_MS = 3 * 86400000;

/**
 * Menghitung potongan prorata saat upgrade sewa properti ke tier yang lebih tinggi.
 */
function calculateProratedUpgradeRent(currentPropRow, targetTierObj, now = Date.now()) {
    const baseRent = Number(targetTierObj.rentPerWeek || 0);
    if (
        !currentPropRow ||
        Number(currentPropRow.is_evicted) === 1 ||
        currentPropRow.ownership_type !== 'rent' ||
        Number(currentPropRow.grace_until || 0) > 0
    ) {
        return { baseRent, unusedCredit: 0, netPayable: baseRent };
    }

    const currentTier = getPropertyTier(currentPropRow.property_tier);
    if (!currentTier || currentTier.order >= targetTierObj.order) {
        return { baseRent, unusedCredit: 0, netPayable: baseRent };
    }

    const remainingMs = Math.max(0, Number(currentPropRow.next_billing_at || 0) - now);
    const ratio = Math.min(1, remainingMs / ONE_WEEK_MS);
    const unusedCredit = Math.round(Number(currentTier.rentPerWeek || 0) * ratio);
    const netPayable = Math.max(0, baseRent - unusedCredit);

    return {
        baseRent,
        unusedCredit,
        netPayable
    };
}

/**
 * Mengambil status properti aktif, fasilitas, dan kapasitas penyimpanan milik player.
 */
async function getPlayerPropertyStatus(conn, discordId, playerMaxSlots = 20, now = Date.now(), forUpdate = false) {
    const lock = forUpdate ? ' FOR UPDATE' : '';
    const [propRows] = await conn.execute(
        `SELECT * FROM player_properties WHERE discord_id = ?${lock}`,
        [discordId]
    );

    const [cbRows] = await conn.execute(
        `SELECT COALESCE(SUM(quantity), 0) AS total_cb
         FROM player_inventory
         WHERE discord_id = ? AND item_id = 'cooler_box'`,
        [discordId]
    );
    const hasCoolerBox = Number(cbRows[0]?.total_cb || 0) > 0;

    const row = propRows.length > 0 ? propRows[0] : null;
    const isEvicted = Boolean(row && Number(row.is_evicted) === 1);
    const inGracePeriod = Boolean(row && !isEvicted && Number(row.grace_until || 0) > 0);
    const actualTier = row ? getPropertyTier(row.property_tier) : getPropertyTier('tunawisma');
    const effectiveTier = (!row || isEvicted) ? getPropertyTier('tunawisma') : actualTier;

    return {
        row,
        actualTier,
        effectiveTier,
        isEvicted,
        inGracePeriod,
        hasCoolerBox,
        capacities: {
            bag: Number(playerMaxSlots || 20),
            coolerbox: hasCoolerBox ? 8 : 0,
            kulkas: effectiveTier.facilities.kulkas,
            freezer: effectiveTier.facilities.freezer,
            gudang: effectiveTier.facilities.gudang,
            stove: effectiveTier.facilities.stove
        }
    };
}

/**
 * Menyewa properti (baru, perpanjang/lunasi tunggakan, atau upgrade prorata).
 */
async function rentProperty(conn, player, tierId, now = Date.now()) {
    const targetTier = getPropertyTier(tierId);
    if (!targetTier || targetTier.id === 'tunawisma' || !targetTier.canRent) {
        return { error: 'NOT_RENTABLE', targetTier };
    }

    const status = await getPlayerPropertyStatus(conn, player.discord_id, player.max_slots, now, true);
    const currentRow = status.row;

    if (currentRow && Number(currentRow.is_evicted) === 0 && currentRow.ownership_type === 'owned') {
        const ownedTier = getPropertyTier(currentRow.property_tier);
        if (ownedTier.order >= targetTier.order) {
            return { error: 'ALREADY_OWNED_EQUAL_OR_HIGHER', ownedTier };
        }
    }

    if (
        currentRow &&
        Number(currentRow.is_evicted) === 0 &&
        currentRow.ownership_type === 'rent' &&
        status.actualTier.order > targetTier.order
    ) {
        return { error: 'CANNOT_DOWNGRADE_ACTIVE_RENT', currentTier: status.actualTier };
    }

    const prorata = calculateProratedUpgradeRent(currentRow, targetTier, now);
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

    if (cost > 0) {
        await debitPlayerFunds(conn, player, cost, `rent_${targetTier.id}`, {
            baseRent: prorata.baseRent,
            unusedCredit: prorata.unusedCredit
        }, now);
    }

    let nextBillingAt = now + ONE_WEEK_MS;
    if (
        currentRow &&
        Number(currentRow.is_evicted) === 0 &&
        currentRow.ownership_type === 'rent' &&
        currentRow.property_tier === targetTier.id &&
        Number(currentRow.grace_until || 0) === 0 &&
        Number(currentRow.next_billing_at || 0) > now
    ) {
        nextBillingAt = Number(currentRow.next_billing_at) + ONE_WEEK_MS;
    }

    await conn.execute(
        `INSERT INTO player_properties
         (discord_id, property_tier, ownership_type, acquired_at, next_billing_at, grace_until, is_evicted, updated_at)
         VALUES (?, ?, 'rent', ?, ?, 0, 0, ?)
         ON DUPLICATE KEY UPDATE
            property_tier = VALUES(property_tier),
            ownership_type = 'rent',
            next_billing_at = VALUES(next_billing_at),
            grace_until = 0,
            is_evicted = 0,
            updated_at = VALUES(updated_at)`,
        [player.discord_id, targetTier.id, now, nextBillingAt, now]
    );

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
 * Membeli properti secara tunai (Rumah / Rumah Mewah).
 */
async function buyProperty(conn, player, tierId, now = Date.now()) {
    const targetTier = getPropertyTier(tierId);
    if (!targetTier || targetTier.id === 'tunawisma' || !targetTier.canBuy) {
        return { error: 'NOT_BUYABLE', targetTier };
    }

    const status = await getPlayerPropertyStatus(conn, player.discord_id, player.max_slots, now, true);
    const currentRow = status.row;

    if (
        currentRow &&
        Number(currentRow.is_evicted) === 0 &&
        currentRow.ownership_type === 'owned' &&
        status.actualTier.order >= targetTier.order
    ) {
        return { error: 'ALREADY_OWNED', currentTier: status.actualTier };
    }

    const cost = Number(targetTier.buyPrice);
    const totalBalance = Number(player.cash || 0) + Number(player.bank || 0);
    if (totalBalance < cost) {
        return {
            error: 'INSUFFICIENT_FUNDS',
            cost,
            totalBalance,
            targetTier
        };
    }

    await debitPlayerFunds(conn, player, cost, `buy_property_${targetTier.id}`, {
        tier: targetTier.id
    }, now);

    const nextBillingAt = now + ONE_MONTH_MS;
    await conn.execute(
        `INSERT INTO player_properties
         (discord_id, property_tier, ownership_type, acquired_at, next_billing_at, grace_until, is_evicted, updated_at)
         VALUES (?, ?, 'owned', ?, ?, 0, 0, ?)
         ON DUPLICATE KEY UPDATE
            property_tier = VALUES(property_tier),
            ownership_type = 'owned',
            next_billing_at = VALUES(next_billing_at),
            grace_until = 0,
            is_evicted = 0,
            updated_at = VALUES(updated_at)`,
        [player.discord_id, targetTier.id, now, nextBillingAt, now]
    );

    return {
        ok: true,
        targetTier,
        cost,
        nextBillingAt,
        player
    };
}

/**
 * Keluar dari hunian sewa (moveout). Isi penyimpanan tetap tersimpan namun terkunci sampai menyewa/membeli lagi.
 */
async function moveOutProperty(conn, discordId, now = Date.now()) {
    const [rows] = await conn.execute(
        `SELECT * FROM player_properties WHERE discord_id = ? FOR UPDATE`,
        [discordId]
    );
    if (rows.length === 0 || Number(rows[0].is_evicted) === 1 || rows[0].property_tier === 'tunawisma') {
        return { error: 'NO_ACTIVE_PROPERTY' };
    }

    const current = rows[0];
    if (current.ownership_type === 'owned') {
        return { error: 'CANNOT_MOVEOUT_OWNED' };
    }

    const prevTier = getPropertyTier(current.property_tier);
    await conn.execute(
        `UPDATE player_properties
         SET is_evicted = 1, grace_until = 0, next_billing_at = 0, updated_at = ?
         WHERE discord_id = ?`,
        [now, discordId]
    );

    return { ok: true, prevTier };
}

/**
 * Memproses tagihan sewa mingguan & PBB bulanan yang jatuh tempo secara idempoten.
 */
async function processDuePropertyBillings(conn, now = Date.now()) {
    const [dueRows] = await conn.execute(
        `SELECT * FROM player_properties
         WHERE is_evicted = 0 AND next_billing_at > 0 AND next_billing_at <= ?
         FOR UPDATE`,
        [now]
    );

    const summary = { billed: 0, graced: 0, evicted: 0 };

    for (const prop of dueRows) {
        const tier = getPropertyTier(prop.property_tier);
        const isRent = prop.ownership_type === 'rent';
        const fee = isRent ? Number(tier.rentPerWeek || 0) : calculateMonthlyPbb(tier);
        const periodMs = isRent ? ONE_WEEK_MS : ONE_MONTH_MS;

        if (fee <= 0) {
            await conn.execute(
                `UPDATE player_properties SET next_billing_at = ?, updated_at = ? WHERE discord_id = ?`,
                [now + periodMs, now, prop.discord_id]
            );
            continue;
        }

        const [pRows] = await conn.execute(
            `SELECT * FROM players WHERE discord_id = ? FOR UPDATE`,
            [prop.discord_id]
        );
        if (pRows.length === 0) continue;
        const p = pRows[0];

        const totalFunds = Number(p.cash || 0) + Number(p.bank || 0);
        if (totalFunds >= fee) {
            // Bank dulu, lalu Cash (sesuai PRD 3.1: "Sewa dipotong otomatis... bank dulu, lalu cash")
            const fromBank = Math.min(Number(p.bank || 0), fee);
            const fromCash = fee - fromBank;
            p.bank = Number(p.bank || 0) - fromBank;
            p.cash = Number(p.cash || 0) - fromCash;

            await conn.execute(
                `UPDATE players SET cash = ?, bank = ? WHERE discord_id = ?`,
                [p.cash, p.bank, p.discord_id]
            );
            await conn.execute(
                `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
                 VALUES (?, 'sink', ?, ?, ?, ?, ?)`,
                [
                    p.discord_id,
                    isRent ? `weekly_rent_${tier.id}` : `monthly_pbb_${tier.id}`,
                    fee,
                    p.cash + p.bank,
                    JSON.stringify({ fromBank, fromCash, tier: tier.id }),
                    now
                ]
            );

            await conn.execute(
                `UPDATE player_properties
                 SET next_billing_at = ?, grace_until = 0, is_evicted = 0, updated_at = ?
                 WHERE discord_id = ?`,
                [now + periodMs, now, prop.discord_id]
            );
            summary.billed += 1;
        } else {
            const currentGrace = Number(prop.grace_until || 0);
            if (currentGrace === 0) {
                await conn.execute(
                    `UPDATE player_properties
                     SET grace_until = ?, updated_at = ?
                     WHERE discord_id = ?`,
                    [now + GRACE_PERIOD_MS, now, prop.discord_id]
                );
                summary.graced += 1;
            } else if (now >= currentGrace) {
                await conn.execute(
                    `UPDATE player_properties
                     SET is_evicted = 1, grace_until = 0, updated_at = ?
                     WHERE discord_id = ?`,
                    [now, prop.discord_id]
                );
                summary.evicted += 1;
            }
        }
    }

    return summary;
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
