const { VITALS, HOSPITAL } = require('../data/constants');
const { getPropertyTier } = require('../data/properties');

/**
 * Pure function untuk menghitung perubahan stat berbasis waktu (Lazy Evaluation).
 */
function computeLazyVitals(playerRow, now = Date.now(), activeBuffs = [], propertyTierObj = null) {
    let energy = Number(playerRow.energy);
    let hunger = Number(playerRow.hunger);
    let thirst = Number(playerRow.thirst);
    let health = Number(playerRow.health);
    let sleepingUntil = Number(playerRow.sleeping_until || 0);
    let hospitalUntil = Number(playerRow.hospital_until || 0);
    const lastTickAt = Number(playerRow.last_tick_at || now);

    let wokeUp = false;
    let discharged = false;

    const sleepBonus = propertyTierObj?.sleepEnergyBonus || VITALS.SLEEP_ENERGY_BONUS;
    const passiveRegenBonus = Number(propertyTierObj?.passiveEnergyRegenBonus || 0);

    // 1. Cek selesai tidur
    if (sleepingUntil > 0 && now >= sleepingUntil) {
        energy = Math.min(VITALS.MAX, energy + sleepBonus);
        sleepingUntil = 0;
        wokeUp = true;
    }

    // 2. Cek keluar dari rumah sakit
    if (hospitalUntil > 0 && now >= hospitalUntil) {
        health = Math.max(health, HOSPITAL.RECOVERY_STAT_VALUE);
        hunger = Math.max(hunger, HOSPITAL.RECOVERY_STAT_VALUE);
        thirst = Math.max(thirst, HOSPITAL.RECOVERY_STAT_VALUE);
        hospitalUntil = 0;
        discharged = true;
    }

    // 3. Hitung selisih jam sejak tick terakhir
    const dtHours = Math.max(0, (now - lastTickAt) / 3600000);

    if (dtHours > 0) {
        // Regen Energy pasif (+12/jam + bonus properti Rumah/Rumah Mewah), dikali buff energy_regen bila aktif
        const energyRegenBuff = activeBuffs.find(b => b.buff_type === 'energy_regen' && Number(b.expires_at) > now);
        const energyRegenMult = energyRegenBuff ? Number(energyRegenBuff.multiplier || 1.0) : 1.0;
        const hourlyEnergyRegen = (VITALS.ENERGY_REGEN_PER_HOUR + passiveRegenBonus) * energyRegenMult;
        energy = Math.min(VITALS.MAX, energy + hourlyEnergyRegen * dtHours);

        // Penurunan Hunger & Thirst karena waktu berhenti di batas bawah offline (20)
        if (hunger > VITALS.OFFLINE_FLOOR) {
            hunger = Math.max(VITALS.OFFLINE_FLOOR, hunger - VITALS.HUNGER_DECAY_PER_HOUR * dtHours);
        }
        if (thirst > VITALS.OFFLINE_FLOOR) {
            thirst = Math.max(VITALS.OFFLINE_FLOOR, thirst - VITALS.THIRST_DECAY_PER_HOUR * dtHours);
        }

        // Perubahan Health
        if (hunger <= 0 || thirst <= 0) {
            health = Math.max(0, health - VITALS.HEALTH_DECAY_AT_ZERO_PER_HOUR * dtHours);
        } else if (hunger >= VITALS.WELL_FED_THRESHOLD && thirst >= VITALS.WELL_FED_THRESHOLD) {
            const regenBuff = activeBuffs.find(b => b.buff_type === 'health_regen' && Number(b.expires_at) > now);
            const mult = regenBuff ? Number(regenBuff.multiplier) : 1.0;
            health = Math.min(VITALS.MAX, health + VITALS.HEALTH_REGEN_WELL_FED_PER_HOUR * mult * dtHours);
        }
    }

    return {
        energy: Math.round(energy * 100) / 100,
        hunger: Math.round(hunger * 100) / 100,
        thirst: Math.round(thirst * 100) / 100,
        health: Math.round(health * 100) / 100,
        sleeping_until: sleepingUntil,
        hospital_until: hospitalUntil,
        last_tick_at: now,
        wokeUp,
        discharged
    };
}

/**
 * Menghitung tagihan Rumah Sakit dan pemotongan cash/bank saat Health <= 0.
 */
function calculateHospitalAdmission(cash, bank, now = Date.now()) {
    const currentCash = Number(cash || 0);
    const currentBank = Number(bank || 0);
    const targetFee = Math.min(
        HOSPITAL.MAX_FEE,
        HOSPITAL.BASE_FEE + Math.round(currentCash * HOSPITAL.CASH_PERCENT)
    );

    const paidFromCash = Math.min(currentCash, targetFee);
    const remainingFee = targetFee - paidFromCash;
    const paidFromBank = Math.min(currentBank, remainingFee);
    const totalPaid = paidFromCash + paidFromBank;
    const fullPaid = totalPaid >= targetFee;

    const lockSeconds = fullPaid ? HOSPITAL.PAID_LOCK_SEC : HOSPITAL.UNPAID_LOCK_SEC;
    const hospitalUntil = now + lockSeconds * 1000;

    return {
        targetFee,
        totalPaid,
        paidFromCash,
        paidFromBank,
        newCash: currentCash - paidFromCash,
        newBank: currentBank - paidFromBank,
        lockSeconds,
        hospitalUntil
    };
}

/**
 * Sinkronisasi stat vital player di database (Lazy Evaluation + cek RS/Tidur).
 */
async function syncPlayerVitals(conn, discordId, now = Date.now(), forUpdate = true) {
    const lockClause = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await conn.execute(
        `SELECT * FROM players WHERE discord_id = ?${lockClause}`,
        [discordId]
    );
    if (rows.length === 0) return null;

    const player = rows[0];
    const [buffRows] = await conn.execute(
        `SELECT * FROM player_buffs WHERE discord_id = ? AND expires_at > ?`,
        [discordId, now]
    );
    const [propRows] = await conn.execute(
        `SELECT property_tier, is_evicted FROM player_properties WHERE discord_id = ? LIMIT 1`,
        [discordId]
    );
    const activePropTier = (propRows.length > 0 && Number(propRows[0].is_evicted) === 0)
        ? getPropertyTier(propRows[0].property_tier)
        : getPropertyTier('tunawisma');

    const lazy = computeLazyVitals(player, now, buffRows, activePropTier);
    player.energy = lazy.energy;
    player.hunger = lazy.hunger;
    player.thirst = lazy.thirst;
    player.health = lazy.health;
    player.sleeping_until = lazy.sleeping_until;
    player.hospital_until = lazy.hospital_until;
    player.last_tick_at = lazy.last_tick_at;

    let hospitalized = null;
    if (player.health <= 0 && player.hospital_until <= now) {
        hospitalized = applyHospitalToPlayerObj(player, now);
        if (hospitalized.totalPaid > 0) {
            await conn.execute(
                `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
                 VALUES (?, 'sink', 'hospital_fee', ?, ?, ?, ?)`,
                [
                    discordId,
                    hospitalized.totalPaid,
                    player.cash + player.bank,
                    JSON.stringify({ targetFee: hospitalized.targetFee }),
                    now
                ]
            );
        }
    }

    await conn.execute(
        `UPDATE players
         SET cash = ?, bank = ?, energy = ?, hunger = ?, thirst = ?, health = ?,
             sleeping_until = ?, hospital_until = ?, last_tick_at = ?
         WHERE discord_id = ?`,
        [
            player.cash,
            player.bank,
            player.energy,
            player.hunger,
            player.thirst,
            player.health,
            player.sleeping_until,
            player.hospital_until,
            player.last_tick_at,
            discordId
        ]
    );

    return {
        player,
        buffs: buffRows,
        events: {
            wokeUp: lazy.wokeUp,
            discharged: lazy.discharged,
            hospitalized
        }
    };
}

function applyHospitalToPlayerObj(player, now = Date.now()) {
    const admission = calculateHospitalAdmission(player.cash, player.bank, now);
    player.cash = admission.newCash;
    player.bank = admission.newBank;
    player.health = HOSPITAL.RECOVERY_STAT_VALUE;
    player.hunger = Math.max(player.hunger, HOSPITAL.RECOVERY_STAT_VALUE);
    player.thirst = Math.max(player.thirst, HOSPITAL.RECOVERY_STAT_VALUE);
    player.hospital_until = admission.hospitalUntil;
    player.sleeping_until = 0;
    return admission;
}

/**
 * Mengecek apakah player memenuhi syarat stat vital untuk melakukan aktivitas.
 */
function checkActivityEligibility(player, cost, activityType = 'general', now = Date.now()) {
    if (Number(player.hospital_until) > now) {
        return {
            allowed: false,
            code: 'HOSPITALIZED',
            remainingMs: Number(player.hospital_until) - now,
            message: 'Kamu masih dirawat di **Rumah Sakit** setelah pingsan. Istirahatlah sampai pulih.'
        };
    }

    if (Number(player.sleeping_until) > now) {
        return {
            allowed: false,
            code: 'SLEEPING',
            remainingMs: Number(player.sleeping_until) - now,
            message: 'Kamu sedang **tidur** (`/sleep`). Tunggu sampai bangun untuk beraktivitas.'
        };
    }

    if (player.hunger <= 0 || player.thirst <= 0) {
        return {
            allowed: false,
            code: 'STARVING_OR_DEHYDRATED',
            message: 'Perutmu keroncongan atau sangat kehausan (**Hunger/Thirst 0**)! Gunakan `/eat` dan `/drink` terlebih dahulu agar tidak pingsan.'
        };
    }

    if (activityType === 'mining' && player.health < VITALS.LOW_HEALTH_THRESHOLD) {
        return {
            allowed: false,
            code: 'LOW_HEALTH_MINING',
            message: `Kondisi kesehatanmu terlalu lemah (**❤️ ${Math.round(player.health)}/100**) untuk masuk ke tambang. Pulihkan Health minimal ke **${VITALS.LOW_HEALTH_THRESHOLD}** dengan obat atau istirahat.`
        };
    }

    if (player.energy < cost.energy) {
        return {
            allowed: false,
            code: 'LOW_ENERGY',
            message: `⚡ Energy tidak cukup! Aktivitas ini butuh **${cost.energy} Energy**, sedangkan kamu hanya punya **${Math.round(player.energy)} Energy**. Gunakan \`/sleep\` atau minum kopi/energy drink.`
        };
    }

    // Hitung penalti lunak (yield multiplier)
    let yieldMultiplier = 1.0;
    const penalties = [];
    if (player.hunger < VITALS.LOW_VITAL_PENALTY_THRESHOLD || player.thirst < VITALS.LOW_VITAL_PENALTY_THRESHOLD) {
        yieldMultiplier *= VITALS.LOW_VITAL_YIELD_MULTIPLIER;
        penalties.push('Lapar/Haus (<25): Hasil -20%');
    }
    if (player.health < VITALS.LOW_HEALTH_THRESHOLD) {
        yieldMultiplier *= VITALS.LOW_VITAL_YIELD_MULTIPLIER;
        penalties.push('Kurang Sehat (<30): Hasil -20%');
    }

    return {
        allowed: true,
        yieldMultiplier,
        penalties
    };
}

/**
 * Mengurangi stat vital akibat melakukan aktivitas.
 */
function deductActivityVitals(player, cost, extraHealthDamage = 0, now = Date.now()) {
    player.energy = Math.max(0, Math.round((player.energy - cost.energy) * 100) / 100);
    player.hunger = Math.max(0, Math.round((player.hunger - cost.hunger) * 100) / 100);
    player.thirst = Math.max(0, Math.round((player.thirst - cost.thirst) * 100) / 100);
    if (extraHealthDamage > 0) {
        player.health = Math.max(0, Math.round((player.health - extraHealthDamage) * 100) / 100);
    }

    let hospitalized = null;
    if (player.health <= 0) {
        hospitalized = applyHospitalToPlayerObj(player, now);
    }
    return hospitalized;
}

module.exports = {
    computeLazyVitals,
    calculateHospitalAdmission,
    syncPlayerVitals,
    applyHospitalToPlayerObj,
    checkActivityEligibility,
    deductActivityVitals
};
