const {
    FUEL_PRICE_PER_LITER,
    SHIFT_DISTANCE_KM,
    FAR_TRIP_DISTANCE_KM,
    OVERDUE_SERVICE_PENALTY_MULT,
    OVERDUE_BREAKDOWN_CHANCE,
    getVehicle,
    isFarLocation
} = require('../data/vehicles');
const { debitPlayerFunds } = require('./economyService');

function isServiceOverdue(vehicleRow, vehicleObj = null) {
    const v = vehicleObj || getVehicle(vehicleRow?.vehicle_id);
    if (!v || !vehicleRow) return false;
    const kmSinceService = Number(vehicleRow.odometer_km || 0) - Number(vehicleRow.last_service_km || 0);
    return kmSinceService >= Number(v.serviceIntervalKm);
}

/**
 * Menghitung bonus gaji & pemakaian BBM/odometer kendaraan saat bekerja (/work).
 */
function calculateShiftVehicleBonus(vehicleRow, jobId, rollFn = Math.random) {
    if (!vehicleRow) {
        return { active: false, bonusMultiplier: 0, fuelConsumed: 0, kmAdded: 0, overdue: false, brokeDown: false, vehicle: null };
    }

    const v = getVehicle(vehicleRow.vehicle_id);
    if (!v) {
        return { active: false, bonusMultiplier: 0, fuelConsumed: 0, kmAdded: 0, overdue: false, brokeDown: false, vehicle: null };
    }

    const baseBonus = Number(v.jobBonuses?.[jobId] || 0);
    const isCarRequiredJob = Array.isArray(v.unlocksJobs) && v.unlocksJobs.includes(jobId);

    // Jika profesi tidak memakai kendaraan sama sekali, kendaraan tidak dipakai bekerja
    if (baseBonus <= 0 && !isCarRequiredJob) {
        return { active: false, bonusMultiplier: 0, fuelConsumed: 0, kmAdded: 0, overdue: false, brokeDown: false, vehicle: v };
    }

    const currentFuel = Number(vehicleRow.fuel_liters || 0);
    if (v.fuelPerShift > 0 && currentFuel + 1e-6 < v.fuelPerShift) {
        return {
            active: false,
            reason: 'NO_FUEL',
            bonusMultiplier: 0,
            fuelConsumed: 0,
            kmAdded: 0,
            overdue: isServiceOverdue(vehicleRow, v),
            brokeDown: false,
            vehicle: v
        };
    }

    const overdue = isServiceOverdue(vehicleRow, v);
    if (overdue && rollFn() < OVERDUE_BREAKDOWN_CHANCE) {
        return {
            active: false,
            reason: 'BREAKDOWN',
            bonusMultiplier: 0,
            fuelConsumed: v.fuelPerShift,
            kmAdded: SHIFT_DISTANCE_KM,
            overdue: true,
            brokeDown: true,
            vehicle: v
        };
    }

    const effectiveBonus = overdue ? Number((baseBonus * OVERDUE_SERVICE_PENALTY_MULT).toFixed(4)) : baseBonus;

    return {
        active: true,
        bonusMultiplier: effectiveBonus,
        fuelConsumed: v.fuelPerShift,
        kmAdded: SHIFT_DISTANCE_KM,
        overdue,
        brokeDown: false,
        vehicle: v
    };
}

/**
 * Menghitung penghematan Energy ke lokasi jauh (/fishing & /mining).
 */
function calculateTripVehicleDiscount(vehicleRow, locationId, rollFn = Math.random) {
    if (!vehicleRow || !isFarLocation(locationId)) {
        return { active: false, energyDiscount: 0, fuelConsumed: 0, kmAdded: 0, overdue: false, brokeDown: false, vehicle: null };
    }

    const v = getVehicle(vehicleRow.vehicle_id);
    if (!v || Number(v.farEnergyDiscount || 0) <= 0) {
        return { active: false, energyDiscount: 0, fuelConsumed: 0, kmAdded: 0, overdue: false, brokeDown: false, vehicle: null };
    }

    const currentFuel = Number(vehicleRow.fuel_liters || 0);
    if (v.fuelPerTrip > 0 && currentFuel + 1e-6 < v.fuelPerTrip) {
        return {
            active: false,
            reason: 'NO_FUEL',
            energyDiscount: 0,
            fuelConsumed: 0,
            kmAdded: 0,
            overdue: isServiceOverdue(vehicleRow, v),
            brokeDown: false,
            vehicle: v
        };
    }

    const overdue = isServiceOverdue(vehicleRow, v);
    if (overdue && rollFn() < OVERDUE_BREAKDOWN_CHANCE) {
        return {
            active: false,
            reason: 'BREAKDOWN',
            energyDiscount: 0,
            fuelConsumed: v.fuelPerTrip,
            kmAdded: FAR_TRIP_DISTANCE_KM,
            overdue: true,
            brokeDown: true,
            vehicle: v
        };
    }

    const discount = overdue
        ? Math.max(0, Math.floor(v.farEnergyDiscount * OVERDUE_SERVICE_PENALTY_MULT))
        : v.farEnergyDiscount;

    return {
        active: true,
        energyDiscount: discount,
        fuelConsumed: v.fuelPerTrip,
        kmAdded: FAR_TRIP_DISTANCE_KM,
        overdue,
        brokeDown: false,
        vehicle: v
    };
}

async function getPlayerVehicles(conn, discordId, forUpdate = false) {
    const lockSql = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await conn.execute(
        `SELECT * FROM player_vehicles WHERE discord_id = ? ORDER BY id ASC${lockSql}`,
        [discordId]
    );
    return rows.map(r => {
        const obj = getVehicle(r.vehicle_id);
        return {
            ...r,
            id: Number(r.id),
            fuel_liters: Number(r.fuel_liters || 0),
            odometer_km: Number(r.odometer_km || 0),
            last_service_km: Number(r.last_service_km || 0),
            is_equipped: Number(r.is_equipped || 0),
            acquired_at: Number(r.acquired_at || 0),
            overdue: isServiceOverdue(r, obj),
            vehicle: obj
        };
    });
}

async function getEquippedVehicle(conn, discordId, forUpdate = false) {
    const list = await getPlayerVehicles(conn, discordId, forUpdate);
    return list.find(v => v.is_equipped === 1) || list[0] || null;
}

async function buyVehicleCash(conn, player, vehicleId, now = Date.now()) {
    const vehicle = getVehicle(vehicleId);
    if (!vehicle) return { error: 'INVALID_VEHICLE' };
    if (vehicle.gachaExclusive) {
        return { error: 'GACHA_EXCLUSIVE', vehicle };
    }

    const owned = await getPlayerVehicles(conn, player.discord_id, true);
    if (owned.some(v => v.vehicle_id === vehicle.id)) {
        return { error: 'ALREADY_OWNED', vehicle };
    }

    const totalFunds = Number(player.cash) + Number(player.bank);
    if (totalFunds < vehicle.buyPrice) {
        return { error: 'INSUFFICIENT_FUNDS', required: vehicle.buyPrice, totalFunds, vehicle };
    }

    await debitPlayerFunds(conn, player, vehicle.buyPrice, `buy_vehicle_${vehicle.id}`, { vehicleId: vehicle.id }, now);

    // Otomatis jadikan kendaraan utama
    await conn.execute(
        `UPDATE player_vehicles SET is_equipped = 0 WHERE discord_id = ?`,
        [player.discord_id]
    );

    await conn.execute(
        `INSERT INTO player_vehicles
         (discord_id, vehicle_id, fuel_liters, odometer_km, last_service_km, is_equipped, acquired_at)
         VALUES (?, ?, ?, 0, 0, 1, ?)`,
        [player.discord_id, vehicle.id, vehicle.tankCapacity, now]
    );

    return {
        ok: true,
        vehicle,
        paid: vehicle.buyPrice,
        player
    };
}

async function equipVehicle(conn, discordId, vehicleId) {
    const owned = await getPlayerVehicles(conn, discordId, true);
    const target = owned.find(v => v.vehicle_id === String(vehicleId || '').toLowerCase());
    if (!target) {
        return { error: 'NOT_OWNED' };
    }

    await conn.execute(`UPDATE player_vehicles SET is_equipped = 0 WHERE discord_id = ?`, [discordId]);
    await conn.execute(`UPDATE player_vehicles SET is_equipped = 1 WHERE id = ?`, [target.id]);

    return { ok: true, vehicle: target.vehicle, row: target };
}

async function refuelVehicle(conn, player, requestedLiters = null, now = Date.now()) {
    const equipped = await getEquippedVehicle(conn, player.discord_id, true);
    if (!equipped || !equipped.vehicle) {
        return { error: 'NO_VEHICLE' };
    }

    const v = equipped.vehicle;
    if (v.tankCapacity <= 0) {
        return { error: 'NO_TANK', vehicle: v };
    }

    const missingLiters = Math.max(0, Number((v.tankCapacity - equipped.fuel_liters).toFixed(2)));
    if (missingLiters <= 0.01) {
        return { error: 'TANK_ALREADY_FULL', vehicle: v, currentFuel: equipped.fuel_liters };
    }

    const litersToBuy = requestedLiters !== null && Number(requestedLiters) > 0
        ? Math.min(missingLiters, Number(Number(requestedLiters).toFixed(2)))
        : missingLiters;

    const totalCost = Math.max(100, Math.round(litersToBuy * FUEL_PRICE_PER_LITER));
    const totalFunds = Number(player.cash) + Number(player.bank);
    if (totalFunds < totalCost) {
        return { error: 'INSUFFICIENT_FUNDS', required: totalCost, totalFunds, litersToBuy, vehicle: v };
    }

    await debitPlayerFunds(conn, player, totalCost, 'vehicle_refuel', {
        vehicleId: v.id,
        liters: litersToBuy
    }, now);

    const newFuel = Number(Math.min(v.tankCapacity, equipped.fuel_liters + litersToBuy).toFixed(2));
    await conn.execute(
        `UPDATE player_vehicles SET fuel_liters = ? WHERE id = ?`,
        [newFuel, equipped.id]
    );

    return {
        ok: true,
        vehicle: v,
        litersAdded: litersToBuy,
        newFuel,
        totalCost,
        player
    };
}

async function serviceVehicle(conn, player, vehicleId = null, now = Date.now()) {
    const owned = await getPlayerVehicles(conn, player.discord_id, true);
    if (owned.length === 0) {
        return { error: 'NO_VEHICLE' };
    }

    const target = vehicleId
        ? owned.find(v => v.vehicle_id === String(vehicleId).toLowerCase())
        : (owned.find(v => v.is_equipped === 1) || owned[0]);

    if (!target || !target.vehicle) {
        return { error: 'NOT_OWNED' };
    }

    const v = target.vehicle;
    const kmSinceLast = Number((target.odometer_km - target.last_service_km).toFixed(1));
    if (kmSinceLast < 10) {
        return { error: 'ALREADY_FRESH', vehicle: v, kmSinceLast };
    }

    const totalFunds = Number(player.cash) + Number(player.bank);
    if (totalFunds < v.serviceCost) {
        return { error: 'INSUFFICIENT_FUNDS', required: v.serviceCost, totalFunds, vehicle: v };
    }

    await debitPlayerFunds(conn, player, v.serviceCost, 'vehicle_service', {
        vehicleId: v.id,
        odometerKm: target.odometer_km
    }, now);

    await conn.execute(
        `UPDATE player_vehicles SET last_service_km = odometer_km WHERE id = ?`,
        [target.id]
    );

    return {
        ok: true,
        vehicle: v,
        cost: v.serviceCost,
        odometerKm: target.odometer_km,
        kmServiced: kmSinceLast,
        player
    };
}

async function applyShiftVehicleUsage(conn, discordId, jobId, rollFn = Math.random) {
    const equipped = await getEquippedVehicle(conn, discordId, true);
    const calc = calculateShiftVehicleBonus(equipped, jobId, rollFn);

    if (equipped && (calc.fuelConsumed > 0 || calc.kmAdded > 0)) {
        const newFuel = Math.max(0, Number((equipped.fuel_liters - calc.fuelConsumed).toFixed(2)));
        const newOdo = Number((equipped.odometer_km + calc.kmAdded).toFixed(1));
        await conn.execute(
            `UPDATE player_vehicles SET fuel_liters = ?, odometer_km = ? WHERE id = ?`,
            [newFuel, newOdo, equipped.id]
        );
        calc.remainingFuel = newFuel;
        calc.newOdometer = newOdo;
    }

    return calc;
}

async function applyTripVehicleUsage(conn, discordId, locationId, rollFn = Math.random) {
    const equipped = await getEquippedVehicle(conn, discordId, true);
    const calc = calculateTripVehicleDiscount(equipped, locationId, rollFn);

    if (equipped && (calc.fuelConsumed > 0 || calc.kmAdded > 0)) {
        const newFuel = Math.max(0, Number((equipped.fuel_liters - calc.fuelConsumed).toFixed(2)));
        const newOdo = Number((equipped.odometer_km + calc.kmAdded).toFixed(1));
        await conn.execute(
            `UPDATE player_vehicles SET fuel_liters = ?, odometer_km = ? WHERE id = ?`,
            [newFuel, newOdo, equipped.id]
        );
        calc.remainingFuel = newFuel;
        calc.newOdometer = newOdo;
    }

    return calc;
}

module.exports = {
    isServiceOverdue,
    calculateShiftVehicleBonus,
    calculateTripVehicleDiscount,
    getPlayerVehicles,
    getEquippedVehicle,
    buyVehicleCash,
    equipVehicle,
    refuelVehicle,
    serviceVehicle,
    applyShiftVehicleUsage,
    applyTripVehicleUsage
};
