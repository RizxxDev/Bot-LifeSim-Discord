const FUEL_PRICE_PER_LITER = 10000;
const SHIFT_DISTANCE_KM = 15;
const FAR_TRIP_DISTANCE_KM = 5;
const OVERDUE_SERVICE_PENALTY_MULT = 0.5;
const OVERDUE_BREAKDOWN_CHANCE = 0.10;

const FAR_LOCATION_IDS = [
    'danau',
    'laut',
    'tambang_tembaga',
    'tambang_emas',
    'tambang_berlian'
];

const VEHICLES = [
    {
        id: 'sepeda',
        order: 1,
        name: 'Sepeda Onthel',
        emoji: '🚲',
        buyPrice: 1500000,
        canCredit: false,
        tankCapacity: 0,
        fuelPerShift: 0,
        fuelPerTrip: 0,
        serviceIntervalKm: 1000,
        serviceCost: 50000,
        farEnergyDiscount: 1,
        jobBonuses: {
            kurir_paket: 0.15
        },
        description: 'Sepeda hemat bebas bensin! Memberi +15% gaji Kurir Paket dan hemat -1 Energy ke lokasi jauh.'
    },
    {
        id: 'motor_bekas',
        order: 2,
        name: 'Motor Bebek Bekas',
        emoji: '🛵',
        buyPrice: 6000000,
        canCredit: false,
        tankCapacity: 4,
        fuelPerShift: 0.3,
        fuelPerTrip: 0.1,
        serviceIntervalKm: 1000,
        serviceCost: 150000,
        farEnergyDiscount: 2,
        jobBonuses: {
            kurir_paket: 0.30,
            ojek_online: 0.30
        },
        description: 'Motor tangguh harian. Memberi +30% gaji Kurir & Ojol serta hemat -2 Energy ke lokasi jauh.'
    },
    {
        id: 'motor_baru',
        order: 3,
        name: 'Motor Matic Baru',
        emoji: '🏍️',
        buyPrice: 22000000,
        canCredit: true,
        tankCapacity: 5,
        fuelPerShift: 0.25,
        fuelPerTrip: 0.08,
        serviceIntervalKm: 2000,
        serviceCost: 300000,
        farEnergyDiscount: 2,
        jobBonuses: {
            kurir_paket: 0.45,
            ojek_online: 0.45
        },
        description: 'Motor matic irit BBM (bisa dicicil lewat /credit). Memberi +45% gaji Kurir & Ojol serta hemat -2 Energy.'
    },
    {
        id: 'mobil',
        order: 4,
        name: 'Mobil Sedan Keluarga',
        emoji: '🚗',
        buyPrice: 150000000,
        canCredit: true,
        tankCapacity: 40,
        fuelPerShift: 1.0,
        fuelPerTrip: 0.3,
        serviceIntervalKm: 3000,
        serviceCost: 1500000,
        farEnergyDiscount: 3,
        jobBonuses: {
            kurir_paket: 0.45,
            ojek_online: 0.45
        },
        unlocksJobs: ['taksi_online', 'sopir_pribadi'],
        description: 'Kendaraan roda empat bergengsi (bisa dicicil). Membuka profesi Taksi Online & Sopir Pribadi serta hemat -3 Energy.'
    }
];

const VEHICLE_MAP = new Map(VEHICLES.map(v => [v.id, v]));

function getVehicle(id) {
    if (!id) return null;
    return VEHICLE_MAP.get(String(id).toLowerCase()) || null;
}

function getAllVehicles() {
    return VEHICLES;
}

function isFarLocation(locationId) {
    return FAR_LOCATION_IDS.includes(String(locationId || '').toLowerCase());
}

module.exports = {
    FUEL_PRICE_PER_LITER,
    SHIFT_DISTANCE_KM,
    FAR_TRIP_DISTANCE_KM,
    OVERDUE_SERVICE_PENALTY_MULT,
    OVERDUE_BREAKDOWN_CHANCE,
    FAR_LOCATION_IDS,
    VEHICLES,
    getVehicle,
    getAllVehicles,
    isFarLocation
};
