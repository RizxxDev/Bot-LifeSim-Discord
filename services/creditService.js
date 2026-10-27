const { getVehicle } = require('../data/vehicles');
const { getPropertyTier, calculateMonthlyPbb } = require('../data/properties');
const { debitPlayerFunds, logLedger } = require('./economyService');

const CREDIT_RULES = {
    DOWN_PAYMENT_RATE: 0.20,
    MIN_ACCOUNT_AGE_MS: 14 * 86400000,
    MAX_DTI_RATIO: 0.50, // Cicilan mingguan <= 50% penghasilan bersih 7 hari terakhir
    EARLY_PAYOFF_INTEREST_DISCOUNT: 0.50,
    REPOSSESSION_PRINCIPAL_REFUND_RATE: 0.50,
    INSTALLMENT_INTERVAL_MS: 7 * 86400000
};

const TENOR_RATES = {
    4: 0.05,
    8: 0.08,
    12: 0.10,
    24: 0.15
};

function getCreditableAsset(assetId) {
    const key = String(assetId || '').toLowerCase();
    const veh = getVehicle(key);
    if (veh && veh.canCredit) {
        return {
            id: veh.id,
            category: 'vehicle',
            name: veh.name,
            emoji: veh.emoji,
            price: veh.buyPrice,
            raw: veh
        };
    }

    const prop = getPropertyTier(key);
    if (prop && prop.canCredit) {
        return {
            id: prop.id,
            category: 'property',
            name: prop.name,
            emoji: prop.emoji,
            price: prop.buyPrice,
            raw: prop
        };
    }

    return null;
}

function calculateCreditPlan(assetId, tenorWeeks) {
    const asset = getCreditableAsset(assetId);
    const tenor = Number(tenorWeeks);
    const flatRate = TENOR_RATES[tenor];

    if (!asset || flatRate === undefined) {
        return null;
    }

    const totalPrice = Number(asset.price);
    const downPayment = Math.round(totalPrice * CREDIT_RULES.DOWN_PAYMENT_RATE);
    const principalAmount = totalPrice - downPayment;
    const interestAmount = Math.round(principalAmount * flatRate);

    const weeklyPrincipal = Math.round(principalAmount / tenor);
    const weeklyInterest = Math.round(interestAmount / tenor);
    const weeklyInstallment = weeklyPrincipal + weeklyInterest;
    const totalPayable = downPayment + weeklyInstallment * tenor;

    return {
        asset,
        tenorWeeks: tenor,
        flatRate,
        totalPrice,
        downPayment,
        principalAmount,
        interestAmount,
        weeklyPrincipal,
        weeklyInterest,
        weeklyInstallment,
        totalPayable
    };
}

function calculateEarlyPayoff(creditRow) {
    const totalPrincipal = Number(creditRow.principal_amount || 0);
    const principalPaid = Number(creditRow.principal_paid || 0);
    const totalInterest = Number(creditRow.interest_amount || 0);
    const interestPaid = Number(creditRow.interest_paid || 0);

    const remainingPrincipal = Math.max(0, totalPrincipal - principalPaid);
    const remainingInterest = Math.max(0, totalInterest - interestPaid);
    const discountedInterest = Math.round(remainingInterest * (1 - CREDIT_RULES.EARLY_PAYOFF_INTEREST_DISCOUNT));
    const interestSaved = remainingInterest - discountedInterest;
    const totalPayoff = remainingPrincipal + discountedInterest;

    return {
        remainingPrincipal,
        remainingInterest,
        discountedInterest,
        interestSaved,
        totalPayoff
    };
}

function calculateRepossessionRefund(creditRow) {
    const totalPrincipalContributed = Number(creditRow.down_payment || 0) + Number(creditRow.principal_paid || 0);
    return Math.round(totalPrincipalContributed * CREDIT_RULES.REPOSSESSION_PRINCIPAL_REFUND_RATE);
}

async function getActiveCredits(conn, discordId, forUpdate = false) {
    const lockSql = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await conn.execute(
        `SELECT * FROM player_credits
         WHERE discord_id = ? AND status = 'active'
         ORDER BY id ASC${lockSql}`,
        [discordId]
    );
    return rows.map(r => ({
        ...r,
        id: Number(r.id),
        total_price: Number(r.total_price),
        down_payment: Number(r.down_payment),
        principal_amount: Number(r.principal_amount),
        interest_amount: Number(r.interest_amount),
        tenor_weeks: Number(r.tenor_weeks),
        weeks_paid: Number(r.weeks_paid),
        weekly_installment: Number(r.weekly_installment),
        principal_paid: Number(r.principal_paid),
        interest_paid: Number(r.interest_paid),
        next_due_at: Number(r.next_due_at),
        missed_weeks: Number(r.missed_weeks),
        asset: getCreditableAsset(r.asset_id)
    }));
}

async function getPlayerNetIncomeLast7Days(conn, discordId, now = Date.now()) {
    const sevenDaysAgo = now - 7 * 86400000;
    const [rows] = await conn.execute(
        `SELECT COALESCE(SUM(amount), 0) AS total_income
         FROM economy_ledger
         WHERE discord_id = ?
           AND type = 'faucet'
           AND source NOT IN ('starter_cash', 'admin_give', 'credit_repossession_refund')
           AND created_at >= ?`,
        [discordId, sevenDaysAgo]
    );
    return Number(rows[0]?.total_income || 0);
}

async function applyCredit(conn, player, assetId, tenorWeeks, now = Date.now()) {
    const plan = calculateCreditPlan(assetId, tenorWeeks);
    if (!plan) {
        return { error: 'INVALID_PLAN' };
    }

    if (!player.current_job) {
        return { error: 'NO_ACTIVE_JOB' };
    }

    const accountAgeMs = Math.max(0, now - Number(player.created_at || now));
    if (accountAgeMs < CREDIT_RULES.MIN_ACCOUNT_AGE_MS) {
        const remainingMs = CREDIT_RULES.MIN_ACCOUNT_AGE_MS - accountAgeMs;
        return { error: 'ACCOUNT_TOO_YOUNG', remainingMs };
    }

    const activeCredits = await getActiveCredits(conn, player.discord_id, true);
    if (activeCredits.some(c => c.asset_category === plan.asset.category)) {
        return { error: 'CATEGORY_ALREADY_ACTIVE', category: plan.asset.category };
    }

    // Pastikan belum memiliki aset yang sama (atau properti milik pribadi setara/lebih tinggi)
    if (plan.asset.category === 'vehicle') {
        const [vRows] = await conn.execute(
            `SELECT id FROM player_vehicles WHERE discord_id = ? AND vehicle_id = ? LIMIT 1`,
            [player.discord_id, plan.asset.id]
        );
        if (vRows.length > 0) {
            return { error: 'ASSET_ALREADY_OWNED', asset: plan.asset };
        }
    } else if (plan.asset.category === 'property') {
        const [pRows] = await conn.execute(
            `SELECT property_tier, ownership_type, is_evicted FROM player_properties WHERE discord_id = ? LIMIT 1 FOR UPDATE`,
            [player.discord_id]
        );
        if (pRows.length > 0 && Number(pRows[0].is_evicted) === 0 && pRows[0].ownership_type === 'owned') {
            const curProp = getPropertyTier(pRows[0].property_tier);
            if (curProp.order >= plan.asset.raw.order) {
                return { error: 'ASSET_ALREADY_OWNED', asset: plan.asset };
            }
        }
    }

    const income7d = await getPlayerNetIncomeLast7Days(conn, player.discord_id, now);
    const existingWeeklyLoad = activeCredits.reduce((acc, c) => acc + Number(c.weekly_installment), 0);
    const totalWeeklyInstallment = existingWeeklyLoad + plan.weeklyInstallment;
    const maxAllowedInstallment = Math.floor(income7d * CREDIT_RULES.MAX_DTI_RATIO);

    if (totalWeeklyInstallment > maxAllowedInstallment) {
        return {
            error: 'INCOME_TOO_LOW',
            income7d,
            maxAllowedInstallment,
            requiredInstallment: totalWeeklyInstallment,
            plan
        };
    }

    const totalFunds = Number(player.cash) + Number(player.bank);
    if (totalFunds < plan.downPayment) {
        return {
            error: 'INSUFFICIENT_DP',
            requiredDp: plan.downPayment,
            totalFunds,
            plan
        };
    }

    await debitPlayerFunds(
        conn,
        player,
        plan.downPayment,
        `credit_dp_${plan.asset.id}`,
        { assetId: plan.asset.id, tenorWeeks: plan.tenorWeeks },
        now
    );

    // Berikan aset kepada pemain
    if (plan.asset.category === 'vehicle') {
        await conn.execute(`UPDATE player_vehicles SET is_equipped = 0 WHERE discord_id = ?`, [player.discord_id]);
        await conn.execute(
            `INSERT INTO player_vehicles
             (discord_id, vehicle_id, fuel_liters, odometer_km, last_service_km, is_equipped, acquired_at)
             VALUES (?, ?, ?, 0, 0, 1, ?)`,
            [player.discord_id, plan.asset.id, plan.asset.raw.tankCapacity, now]
        );
    } else if (plan.asset.category === 'property') {
        const nextPbbAt = now + 30 * 86400000;
        await conn.execute(
            `INSERT INTO player_properties
             (discord_id, property_tier, ownership_type, acquired_at, next_billing_at, grace_until, is_evicted, updated_at)
             VALUES (?, ?, 'owned', ?, ?, 0, 0, ?)
             ON DUPLICATE KEY UPDATE
                property_tier = VALUES(property_tier),
                ownership_type = 'owned',
                acquired_at = VALUES(acquired_at),
                next_billing_at = VALUES(next_billing_at),
                grace_until = 0,
                is_evicted = 0,
                updated_at = VALUES(updated_at)`,
            [player.discord_id, plan.asset.id, now, nextPbbAt, now]
        );
    }

    const nextDueAt = now + CREDIT_RULES.INSTALLMENT_INTERVAL_MS;
    await conn.execute(
        `INSERT INTO player_credits
         (discord_id, asset_category, asset_id, total_price, down_payment, principal_amount, interest_amount,
          tenor_weeks, weeks_paid, weekly_installment, principal_paid, interest_paid, next_due_at, missed_weeks, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, ?, 0, 'active', ?)`,
        [
            player.discord_id,
            plan.asset.category,
            plan.asset.id,
            plan.totalPrice,
            plan.downPayment,
            plan.principalAmount,
            plan.interestAmount,
            plan.tenorWeeks,
            plan.weeklyInstallment,
            nextDueAt,
            now
        ]
    );

    return {
        ok: true,
        plan,
        nextDueAt,
        income7d,
        player
    };
}

async function payCreditInstallment(conn, player, categoryOrAssetInput = null, weeksCount = 1, now = Date.now()) {
    const activeCredits = await getActiveCredits(conn, player.discord_id, true);
    if (activeCredits.length === 0) {
        return { error: 'NO_ACTIVE_CREDIT' };
    }

    let target = activeCredits[0];
    if (categoryOrAssetInput) {
        const key = String(categoryOrAssetInput).toLowerCase();
        target = activeCredits.find(c => c.asset_category === key || c.asset_id === key) || null;
        if (!target) return { error: 'CREDIT_NOT_FOUND' };
    }

    const remainingWeeks = Math.max(1, target.tenor_weeks - target.weeks_paid);
    const payWeeks = Math.max(1, Math.min(remainingWeeks, Number(weeksCount) || 1));
    const totalCost = target.weekly_installment * payWeeks;

    const totalFunds = Number(player.cash) + Number(player.bank);
    if (totalFunds < totalCost) {
        return {
            error: 'INSUFFICIENT_FUNDS',
            required: totalCost,
            totalFunds,
            credit: target
        };
    }

    await debitPlayerFunds(
        conn,
        player,
        totalCost,
        `credit_installment_${target.asset_id}`,
        { creditId: target.id, weeksPaidNow: payWeeks },
        now
    );

    const newWeeksPaid = target.weeks_paid + payWeeks;
    const isCompleted = newWeeksPaid >= target.tenor_weeks;

    const weeklyPrincipal = Math.round(target.principal_amount / target.tenor_weeks);
    const weeklyInterest = target.weekly_installment - weeklyPrincipal;

    const newPrincipalPaid = isCompleted
        ? target.principal_amount
        : Math.min(target.principal_amount, target.principal_paid + weeklyPrincipal * payWeeks);
    const newInterestPaid = isCompleted
        ? target.interest_amount
        : Math.min(target.interest_amount, target.interest_paid + weeklyInterest * payWeeks);

    const newStatus = isCompleted ? 'paid_off' : 'active';
    const nextDueAt = isCompleted
        ? 0
        : Math.max(now, target.next_due_at) + payWeeks * CREDIT_RULES.INSTALLMENT_INTERVAL_MS;

    await conn.execute(
        `UPDATE player_credits
         SET weeks_paid = ?, principal_paid = ?, interest_paid = ?, missed_weeks = 0, next_due_at = ?, status = ?
         WHERE id = ?`,
        [newWeeksPaid, newPrincipalPaid, newInterestPaid, nextDueAt, newStatus, target.id]
    );

    return {
        ok: true,
        credit: target,
        weeksPaidNow: payWeeks,
        newWeeksPaid,
        tenorWeeks: target.tenor_weeks,
        totalCost,
        isCompleted,
        nextDueAt,
        player
    };
}

async function payoffCreditEarly(conn, player, categoryOrAssetInput = null, now = Date.now()) {
    const activeCredits = await getActiveCredits(conn, player.discord_id, true);
    if (activeCredits.length === 0) {
        return { error: 'NO_ACTIVE_CREDIT' };
    }

    let target = activeCredits[0];
    if (categoryOrAssetInput) {
        const key = String(categoryOrAssetInput).toLowerCase();
        target = activeCredits.find(c => c.asset_category === key || c.asset_id === key) || null;
        if (!target) return { error: 'CREDIT_NOT_FOUND' };
    }

    const payoff = calculateEarlyPayoff(target);
    const totalFunds = Number(player.cash) + Number(player.bank);
    if (totalFunds < payoff.totalPayoff) {
        return {
            error: 'INSUFFICIENT_FUNDS',
            required: payoff.totalPayoff,
            totalFunds,
            payoff,
            credit: target
        };
    }

    await debitPlayerFunds(
        conn,
        player,
        payoff.totalPayoff,
        `credit_early_payoff_${target.asset_id}`,
        { creditId: target.id, interestSaved: payoff.interestSaved },
        now
    );

    await conn.execute(
        `UPDATE player_credits
         SET weeks_paid = tenor_weeks,
             principal_paid = principal_amount,
             interest_paid = interest_paid + ?,
             missed_weeks = 0,
             next_due_at = 0,
             status = 'paid_off'
         WHERE id = ?`,
        [payoff.discountedInterest, target.id]
    );

    return {
        ok: true,
        credit: target,
        payoff,
        player
    };
}

/**
 * Penagihan otomatis cicilan kredit mingguan & eksekusi penyitaan aset (2 minggu tunggakan).
 */
async function processDueCreditInstallments(conn, now = Date.now()) {
    const [dueRows] = await conn.execute(
        `SELECT * FROM player_credits
         WHERE status = 'active' AND next_due_at > 0 AND next_due_at <= ?
         ORDER BY id ASC FOR UPDATE`,
        [now]
    );

    if (dueRows.length === 0) {
        return { paidCount: 0, missedCount: 0, repossessedCount: 0 };
    }

    let paidCount = 0;
    let missedCount = 0;
    let repossessedCount = 0;

    for (const c of dueRows) {
        const [pRows] = await conn.execute(
            `SELECT discord_id, cash, bank, current_job FROM players WHERE discord_id = ? FOR UPDATE`,
            [c.discord_id]
        );
        if (pRows.length === 0) continue;

        let cash = Number(pRows[0].cash);
        let bank = Number(pRows[0].bank);
        let currentJob = pRows[0].current_job;
        const installment = Number(c.weekly_installment);

        if (bank + cash >= installment) {
            // Sesuai PRD §5.2: Bank dipotong terlebih dahulu, lalu Cash
            const fromBank = Math.min(bank, installment);
            const fromCash = installment - fromBank;
            bank -= fromBank;
            cash -= fromCash;

            const newWeeksPaid = Number(c.weeks_paid) + 1;
            const tenor = Number(c.tenor_weeks);
            const isCompleted = newWeeksPaid >= tenor;

            const weeklyPrincipal = Math.round(Number(c.principal_amount) / tenor);
            const weeklyInterest = installment - weeklyPrincipal;

            const newPrincipalPaid = isCompleted
                ? Number(c.principal_amount)
                : Math.min(Number(c.principal_amount), Number(c.principal_paid) + weeklyPrincipal);
            const newInterestPaid = isCompleted
                ? Number(c.interest_amount)
                : Math.min(Number(c.interest_amount), Number(c.interest_paid) + weeklyInterest);

            await conn.execute(
                `UPDATE players SET cash = ?, bank = ? WHERE discord_id = ?`,
                [cash, bank, c.discord_id]
            );

            await conn.execute(
                `UPDATE player_credits
                 SET weeks_paid = ?, principal_paid = ?, interest_paid = ?, missed_weeks = 0,
                     next_due_at = ?, status = ?
                 WHERE id = ?`,
                [
                    newWeeksPaid,
                    newPrincipalPaid,
                    newInterestPaid,
                    isCompleted ? 0 : now + CREDIT_RULES.INSTALLMENT_INTERVAL_MS,
                    isCompleted ? 'paid_off' : 'active',
                    c.id
                ]
            );

            await logLedger(
                conn,
                c.discord_id,
                'sink',
                `credit_auto_debit_${c.asset_id}`,
                installment,
                cash + bank,
                { creditId: c.id, week: newWeeksPaid, tenor },
                now
            );

            paidCount += 1;
        } else {
            const newMissed = Number(c.missed_weeks) + 1;
            if (newMissed < 2) {
                // Tunggakan Minggu ke-1: status menunggak
                await conn.execute(
                    `UPDATE player_credits SET missed_weeks = ?, next_due_at = ? WHERE id = ?`,
                    [newMissed, now + CREDIT_RULES.INSTALLMENT_INTERVAL_MS, c.id]
                );
                missedCount += 1;
            } else {
                // Tunggakan Minggu ke-2: Sita aset & kembalikan 50% pokok yang sudah dibayar
                const refund = calculateRepossessionRefund(c);
                bank += refund;

                if (c.asset_category === 'vehicle') {
                    await conn.execute(
                        `DELETE FROM player_vehicles WHERE discord_id = ? AND vehicle_id = ?`,
                        [c.discord_id, c.asset_id]
                    );
                    // Jika ada kendaraan lain, pasang salah satu sebagai aktif
                    const [remVeh] = await conn.execute(
                        `SELECT id FROM player_vehicles WHERE discord_id = ? ORDER BY id DESC LIMIT 1`,
                        [c.discord_id]
                    );
                    if (remVeh.length > 0) {
                        await conn.execute(`UPDATE player_vehicles SET is_equipped = 1 WHERE id = ?`, [remVeh[0].id]);
                    }
                    if (c.asset_id === 'mobil' && (currentJob === 'taksi_online' || currentJob === 'sopir_pribadi')) {
                        currentJob = null;
                    }
                } else if (c.asset_category === 'property') {
                    await conn.execute(
                        `UPDATE player_properties
                         SET is_evicted = 1, ownership_type = 'rent', next_billing_at = 0, grace_until = 0, updated_at = ?
                         WHERE discord_id = ?`,
                        [now, c.discord_id]
                    );
                }

                await conn.execute(
                    `UPDATE players SET bank = ?, current_job = ? WHERE discord_id = ?`,
                    [bank, currentJob, c.discord_id]
                );

                await conn.execute(
                    `UPDATE player_credits
                     SET missed_weeks = ?, next_due_at = 0, status = 'repossessed'
                     WHERE id = ?`,
                    [newMissed, c.id]
                );

                if (refund > 0) {
                    await logLedger(
                        conn,
                        c.discord_id,
                        'faucet',
                        'credit_repossession_refund',
                        refund,
                        cash + bank,
                        { creditId: c.id, assetId: c.asset_id },
                        now
                    );
                }

                repossessedCount += 1;
            }
        }
    }

    return { paidCount, missedCount, repossessedCount };
}

module.exports = {
    CREDIT_RULES,
    TENOR_RATES,
    getCreditableAsset,
    calculateCreditPlan,
    calculateEarlyPayoff,
    calculateRepossessionRefund,
    getActiveCredits,
    getPlayerNetIncomeLast7Days,
    applyCredit,
    payCreditInstallment,
    payoffCreditEarly,
    processDueCreditInstallments
};
