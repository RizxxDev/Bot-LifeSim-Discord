const { ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../database/mariadb');
const {
    DEFAULT_CITY_ID,
    getCity,
    getAllCities,
    calculateCityRoute,
    calculateTravelVitalCost,
    isCommandAllowedDuringTravel
} = require('../data/cities');
const {
    getVehicle,
    calculateIntercityFuelNeeded
} = require('../data/vehicles');
const { getItem } = require('../data/items');
const { syncPlayerVitals } = require('./vitalService');
const { getEquippedVehicle } = require('./vehicleService');
const { getPlayerInventory } = require('./inventoryService');
const { debitPlayerFunds } = require('./economyService');
const { COLORS, formatLp } = require('../utils/uiBuilder');
const { buildPanel, btn } = require('../utils/panelBuilder');

/**
 * Merender peta linear 3 kota (Barat <---> Pusat <---> Timur) beserta penanda posisi/perjalanan.
 */
function renderLinearMapText({
    currentCityId = DEFAULT_CITY_ID,
    travelingOriginId = null,
    travelingDestId = null,
    vehicleEmoji = '🚗'
} = {}) {
    const cities = getAllCities();
    if (travelingOriginId && travelingDestId) {
        const orig = getCity(travelingOriginId);
        const dest = getCity(travelingDestId);
        const route = calculateCityRoute(orig.id, dest.id);
        const viaNote = route?.passesCentral ? ' *(Melintasi Tol Metropolis Sentral)*' : '';
        return [
            `🗺️ **Rute Aktif (${route ? route.distanceKm : 0} km):**`,
            `[${orig.emoji} ${orig.shortName}] ════${vehicleEmoji}════► [${dest.emoji} ${dest.shortName}]${viaNote}`
        ].join('\n');
    }

    const activeId = getCity(currentCityId).id;
    const nodes = cities.map(c => {
        if (c.id === activeId) {
            return `📍 **[${c.emoji} ${c.shortName}]**`;
        }
        return `[${c.emoji} ${c.shortName}]`;
    });

    return `${nodes[0]} ──*(30 km)*── ${nodes[1]} ──*(45 km)*── ${nodes[2]}`;
}

/**
 * Mengecek kepemilikan item lisensi (sim_c / sim_a) di tas/inventori pemain.
 */
function hasOwnedItem(invRows = [], itemId) {
    if (!itemId) return true;
    return invRows.some(r => r.item_id === itemId && Number(r.quantity || 0) > 0);
}

/**
 * Validasi murni (pure function) untuk keberangkatan perjalanan antar-kota.
 */
function validateTravelAttempt({
    player,
    equippedVehicleRow,
    invRows = [],
    toCityId,
    hireDriverTrip = false,
    now = Date.now()
}) {
    const fromCity = getCity(player?.current_city || DEFAULT_CITY_ID);
    const toCity = toCityId ? getCity(toCityId) : null;

    if (!toCity || !toCityId || String(toCity.id) !== String(toCityId).toLowerCase()) {
        return { ok: false, error: 'INVALID_DESTINATION', message: 'Kota tujuan tidak ditemukan.' };
    }

    if (fromCity.id === toCity.id) {
        return { ok: false, error: 'ALREADY_IN_CITY', fromCity, toCity, message: `Kamu sudah berada di **${toCity.emoji} ${toCity.name}**!` };
    }

    if (Number(player.traveling_until || 0) > now) {
        return {
            ok: false,
            error: 'ALREADY_TRAVELING',
            remainingMs: Number(player.traveling_until) - now,
            message: 'Kamu masih sedang dalam perjalanan menuju kota lain.'
        };
    }

    if (Number(player.hospital_until || 0) > now) {
        return {
            ok: false,
            error: 'HOSPITALIZED',
            remainingMs: Number(player.hospital_until) - now,
            message: 'Kamu sedang dirawat di Rumah Sakit dan belum boleh bepergian antar-kota.'
        };
    }

    if (Number(player.sleeping_until || 0) > now) {
        return {
            ok: false,
            error: 'SLEEPING',
            remainingMs: Number(player.sleeping_until) - now,
            message: 'Kamu sedang tidur (`/sleep`). Tunggu bangun terlebih dahulu sebelum berangkat.'
        };
    }

    if (!equippedVehicleRow || !equippedVehicleRow.vehicle_id) {
        return {
            ok: false,
            error: 'NO_VEHICLE',
            message: 'Kamu belum memiliki kendaraan aktif! Beli atau pasang kendaraan bermotor di `/vehicle` untuk bepergian antar-kota.'
        };
    }

    const v = equippedVehicleRow.vehicle || getVehicle(equippedVehicleRow.vehicle_id);
    if (!v) {
        return {
            ok: false,
            error: 'NO_VEHICLE',
            message: 'Data kendaraan aktif tidak ditemukan. Silakan cek `/vehicle`.'
        };
    }

    if (!v.canIntercityTravel) {
        return {
            ok: false,
            error: 'BICYCLE_NOT_ALLOWED',
            vehicle: v,
            message: `🚲 **${v.name}** dilarang masuk jalur tol antar-kota! Gunakan minimal sepeda motor atau mobil di \`/vehicle\`.`
        };
    }

    const route = calculateCityRoute(fromCity.id, toCity.id);
    const hasWeeklyContract = Boolean(
        v.supportsDriver &&
        (equippedVehicleRow.hasActiveDriverContract || Number(equippedVehicleRow.driver_hired_until || 0) > now)
    );

    if (hireDriverTrip && !v.supportsDriver) {
        return {
            ok: false,
            error: 'DRIVER_REQUIRES_CAR',
            vehicle: v,
            route,
            message: `Jasa Supir Pribadi hanya tersedia untuk kendaraan roda empat (**Mobil Sedan / Supercar**), tidak tersedia untuk **${v.name}**.`
        };
    }

    const effectiveHasDriver = Boolean(v.supportsDriver && (hasWeeklyContract || hireDriverTrip));

    // Jika mengemudi sendiri (tanpa supir), wajib punya SIM yang sesuai (SIM C untuk motor, SIM A untuk mobil)
    if (!effectiveHasDriver && v.reqLicenseItem && !hasOwnedItem(invRows, v.reqLicenseItem)) {
        const licItem = getItem(v.reqLicenseItem);
        const licLabel = licItem ? `${licItem.emoji} **${licItem.name}**` : `**${v.reqLicenseItem}**`;
        return {
            ok: false,
            error: 'MISSING_LICENSE',
            requiredLicense: v.reqLicenseItem,
            vehicle: v,
            route,
            message: `Mengemudi **${v.emoji} ${v.name}** antar-kota wajib memiliki ${licLabel}! Buat terlebih dahulu di \`/shop\` bagian **Kantor Layanan Publik**${v.supportsDriver ? ' atau gunakan jasa **Supir**' : ''}.`
        };
    }

    const fuelNeeded = calculateIntercityFuelNeeded(v, route.distanceKm);
    const currentFuel = Number(equippedVehicleRow.fuel_liters || 0);
    if (currentFuel + 1e-6 < fuelNeeded) {
        return {
            ok: false,
            error: 'INSUFFICIENT_FUEL',
            fuelNeeded,
            currentFuel,
            vehicle: v,
            route,
            message: `⛽ Bensin **${v.emoji} ${v.name}** tidak cukup! Rute **${route.distanceKm} km** butuh **${fuelNeeded.toFixed(2)} L**, sisa tangki hanya **${currentFuel.toFixed(2)} L**. Isi penuh BBM di \`/vehicle\`.`
        };
    }

    const driverFeeToPay = (hireDriverTrip && !hasWeeklyContract) ? route.driverFareLp : 0;
    const totalFunds = Number(player.cash || 0) + Number(player.bank || 0);
    if (driverFeeToPay > 0 && totalFunds < driverFeeToPay) {
        return {
            ok: false,
            error: 'INSUFFICIENT_DRIVER_FUNDS',
            driverFeeToPay,
            totalFunds,
            vehicle: v,
            route,
            message: `Saldo Cash + Bank (${formatLp(totalFunds)}) tidak cukup untuk membayar ongkos sewa Supir sebesar **${formatLp(driverFeeToPay)}**.`
        };
    }

    const vitalCost = calculateTravelVitalCost(route.distanceKm, effectiveHasDriver);
    if (!effectiveHasDriver) {
        if (Number(player.hunger || 0) <= 0 || Number(player.thirst || 0) <= 0) {
            return {
                ok: false,
                error: 'STARVING_OR_DEHYDRATED',
                vitalCost,
                vehicle: v,
                route,
                message: 'Kondisimu terlalu kelaparan/kehausan (**Hunger/Thirst 0**) untuk menyetir jauh! Makan atau minum dulu lewat `/consume`.'
            };
        }
        if (Number(player.energy || 0) < vitalCost.energy) {
            return {
                ok: false,
                error: 'INSUFFICIENT_ENERGY',
                vitalCost,
                currentEnergy: Number(player.energy || 0),
                vehicle: v,
                route,
                message: `⚡ Energy tidak cukup untuk menyetir sejauh **${route.distanceKm} km**! Butuh minimal **${vitalCost.energy} Energy**, kamu hanya punya **${Math.round(Number(player.energy || 0))} Energy**. Istirahat di \`/sleep\`, minum kopi, atau sewa **Supir Mobil**.`
            };
        }
    }

    return {
        ok: true,
        fromCity,
        toCity,
        route,
        vehicle: v,
        fuelNeeded,
        currentFuel,
        remainingFuelAfter: Math.max(0, Number((currentFuel - fuelNeeded).toFixed(2))),
        hasWeeklyContract,
        effectiveHasDriver,
        driverFeeToPay,
        vitalCost,
        arriveAt: now + route.durationMs
    };
}

/**
 * Menyelesaikan ketibaan pemain di database apabila waktu tempuh perjalanan telah tercapai.
 */
async function settlePlayerTravelIfArrived(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        if (!synced) return null;
        return {
            player: synced.player,
            arrivedCity: synced.events?.arrivedCity ? getCity(synced.events.arrivedCity) : null
        };
    });
}

/**
 * Mengeksekusi keberangkatan perjalanan antar-kota secara transaksional.
 */
async function executeStartTravel(discordId, toCityId, hireDriverTrip = false, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        if (!synced) return { ok: false, error: 'NOT_REGISTERED', message: 'Karakter belum terdaftar.' };

        const player = synced.player;
        const equipped = await getEquippedVehicle(conn, discordId, true, now);
        const invRows = await getPlayerInventory(conn, discordId, false, 'all', now);

        const check = validateTravelAttempt({
            player,
            equippedVehicleRow: equipped,
            invRows,
            toCityId,
            hireDriverTrip,
            now
        });

        if (!check.ok) {
            return { ...check, player };
        }

        if (check.driverFeeToPay > 0) {
            await debitPlayerFunds(
                conn,
                player,
                check.driverFeeToPay,
                'travel_driver_trip',
                {
                    from: check.fromCity.id,
                    to: check.toCity.id,
                    distanceKm: check.route.distanceKm,
                    vehicleId: check.vehicle.id
                },
                now
            );
        }

        const newOdometer = Number((Number(equipped.odometer_km || 0) + check.route.distanceKm).toFixed(1));
        await conn.execute(
            `UPDATE player_vehicles SET fuel_liters = ?, odometer_km = ? WHERE id = ?`,
            [check.remainingFuelAfter, newOdometer, equipped.id]
        );

        player.energy = Math.max(0, Math.round((Number(player.energy) - check.vitalCost.energy) * 100) / 100);
        player.hunger = Math.max(0, Math.round((Number(player.hunger) - check.vitalCost.hunger) * 100) / 100);
        player.thirst = Math.max(0, Math.round((Number(player.thirst) - check.vitalCost.thirst) * 100) / 100);
        player.traveling_until = check.arriveAt;
        player.travel_origin = check.fromCity.id;
        player.travel_destination = check.toCity.id;
        player.travel_has_driver = check.effectiveHasDriver ? 1 : 0;

        await conn.execute(
            `UPDATE players
             SET cash = ?, bank = ?, energy = ?, hunger = ?, thirst = ?,
                 traveling_until = ?, travel_origin = ?, travel_destination = ?, travel_has_driver = ?
             WHERE discord_id = ?`,
            [
                player.cash,
                player.bank,
                player.energy,
                player.hunger,
                player.thirst,
                player.traveling_until,
                player.travel_origin,
                player.travel_destination,
                player.travel_has_driver,
                discordId
            ]
        );

        return {
            ...check,
            newOdometer,
            player
        };
    });
}

/**
 * Membangun kartu pencegat (intercept) saat pemain mencoba menjalankan command yang terkunci selama perjalanan.
 */
function buildTravelStatusInterceptPanel({
    player,
    blockedCommand = null,
    ephemeral = true,
    now = Date.now()
}) {
    const orig = getCity(player.travel_origin || player.current_city || DEFAULT_CITY_ID);
    const dest = getCity(player.travel_destination || DEFAULT_CITY_ID);
    const arriveUnix = Math.floor(Number(player.traveling_until || now) / 1000);
    const hasDriver = Number(player.travel_has_driver || 0) === 1;

    const driverText = hasDriver
        ? '👨‍✈️ **Mode Penumpang Eksekutif (Disopiri Supir)**\n   └ Selama di mobil, kamu tetap bebas membuka `/consume`, `/profile`, `/wardrobe`, dan `/inventory`!'
        : '🛵 **Mode Mengemudi Sendiri**\n   └ Fokus menyetir di jalan raya! Seluruh aktivitas lain dikunci sampai kamu tiba di kota tujuan.';

    const blockedNotice = blockedCommand
        ? `⛔ Perintah \`/${blockedCommand}\` tidak dapat dijalankan saat sedang dalam perjalanan antar-kota.`
        : null;

    const blocks = [
        blockedNotice,
        renderLinearMapText({
            travelingOriginId: orig.id,
            travelingDestId: dest.id,
            vehicleEmoji: hasDriver ? '🚘' : '🚗'
        }),
        [
            `⏱️ **Estimasi Tiba di ${dest.emoji} ${dest.name}:** <t:${arriveUnix}:R> (<t:${arriveUnix}:T>)`,
            driverText
        ].join('\n')
    ].filter(Boolean);

    const row = new ActionRowBuilder().addComponents(
        btn('travel', 'home', player.discord_id, {
            label: 'Cek Panel /travel',
            emoji: '🗺️',
            style: ButtonStyle.Primary
        }, now)
    );

    return buildPanel({
        mod: 'travel',
        ownerId: player.discord_id,
        accentColor: COLORS.WARNING,
        title: `🚗 Sedang Dalam Perjalanan Antar-Kota`,
        player,
        blocks,
        rows: [row],
        footer: 'Gunakan /travel kapan saja untuk memantau sisa waktu tiba di kota tujuan.',
        ephemeral,
        now
    });
}

/**
 * Membangun kartu gerbang kota (City Gate) saat pemain membuka fasilitas eksklusif kota lain.
 */
function buildCityGatePanel({
    player,
    requiredCityId,
    facilityTitle = 'Fasilitas Eksklusif Kota',
    reasonText = null,
    ephemeral = false,
    now = Date.now()
}) {
    const currentCity = getCity(player.current_city || DEFAULT_CITY_ID);
    const targetCity = getCity(requiredCityId);
    const route = calculateCityRoute(currentCity.id, targetCity.id);

    const desc = reasonText
        || `Fasilitas **${facilityTitle}** hanya tersedia di **${targetCity.emoji} ${targetCity.name}** *(Posisi: ${targetCity.positionLabel})*.`;

    const routeLine = route
        ? `🛣️ **Jarak dari lokasimu saat ini (${currentCity.emoji} ${currentCity.shortName}):** **${route.distanceKm} km** *(Waktu tempuh: ${route.durationSec} detik)*`
        : `📍 Kamu saat ini berada di **${currentCity.emoji} ${currentCity.name}**.`;

    const blocks = [
        desc,
        [
            `📍 **Lokasimu Sekarang:** ${currentCity.emoji} **${currentCity.name}**`,
            `🎯 **Kota Tujuan:** ${targetCity.emoji} **${targetCity.name}** — *${targetCity.tagline}*`,
            routeLine
        ].join('\n'),
        renderLinearMapText({ currentCityId: currentCity.id })
    ];

    const row = new ActionRowBuilder().addComponents(
        btn('travel', 'pick_dest_btn', player.discord_id, {
            label: `Rencanakan Rute ke ${targetCity.shortName}`,
            emoji: '🚗',
            style: ButtonStyle.Success,
            arg: targetCity.id
        }, now),
        btn('travel', 'home', player.discord_id, {
            label: 'Buka Peta /travel',
            emoji: '🗺️',
            style: ButtonStyle.Secondary
        }, now)
    );

    return buildPanel({
        mod: 'travel',
        ownerId: player.discord_id,
        accentColor: COLORS.WARNING,
        title: `🏙️ Lokasi Berbeda: ${facilityTitle}`,
        player,
        blocks,
        rows: [row],
        footer: 'Siapkan kendaraan bermotor & bensin yang cukup di /vehicle sebelum berangkat.',
        ephemeral,
        now
    });
}

module.exports = {
    renderLinearMapText,
    hasOwnedItem,
    validateTravelAttempt,
    settlePlayerTravelIfArrived,
    executeStartTravel,
    isCommandAllowedDuringTravel,
    buildTravelStatusInterceptPanel,
    buildCityGatePanel
};
