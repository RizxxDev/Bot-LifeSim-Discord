const DEFAULT_CITY_ID = 'kota_sentral';

const TRAVEL_SECONDS_PER_KM = 2; // 30km = 60s, 45km = 90s, 75km = 150s
const WEEKLY_DRIVER_CONTRACT_COST = 100000;
const WEEKLY_DRIVER_DURATION_MS = 7 * 86400000;

const MOTEL_TRANSIT_CONFIG = {
    priceLp: 25000,
    sleepEnergyBonus: 60,
    sleepDurationSec: 45 * 60,
    name: 'Motel Transit Antar-Kota',
    emoji: '🏨'
};

/**
 * Daftar 3 Kota Linear (Barat <---> Pusat <---> Timur):
 * - kota_barat   (0 km)  : Pelabuhan Tanjung Barat
 * - kota_sentral (30 km) : Metropolis Sentral (Pusat / Default)
 * - kota_timur   (75 km) : Lembah Hijau
 */
const CITIES = [
    {
        id: 'kota_barat',
        order: 1,
        positionLabel: 'Barat (Kiri)',
        positionKm: 0,
        name: 'Pelabuhan Tanjung Barat',
        shortName: 'Tanjung Barat',
        emoji: '🚢',
        tagline: 'Kawasan Industri Pertambangan & Pelabuhan Samudra',
        description: 'Kota pesisir barat yang ramai oleh kapal kargo, dermaga laut lepas, dan terowongan tambang mineral berharga.',
        highlights: [
            '⛏️ Ekspedisi Pertambangan (`/mining` — Batu, Tembaga, Emas, Berlian)',
            '🌊 Dermaga Laut Lepas (`/fishing` spot Laut Lepas)',
            '⚓ Profesi Lokal: **Nelayan Samudra** & **Buruh Tambang**'
        ]
    },
    {
        id: 'kota_sentral',
        order: 2,
        positionLabel: 'Tengah (Kota Utama)',
        positionKm: 30,
        name: 'Metropolis Sentral',
        shortName: 'Metropolis Sentral',
        emoji: '🏛️',
        tagline: 'Pusat Pemerintahan, Kampus Universitas & Bisnis Kota',
        description: 'Jantung perekonomian utama tempat berdirinya kampus perguruan tinggi, kantor leasing, pusat perbelanjaan mall, dan gedung perkantoran.',
        highlights: [
            '🎓 Kampus & Akademi Pendidikan (`/study` — SMP s/d S2)',
            '💳 Kantor Pusat Pembiayaan & Kredit (`/credit`)',
            '🎰 Mystery Box Mall & Brankas Sultan (`/gacha`)',
            '💼 Profesi Eksekutif, Kantor, Medis Spesialis & Akademik'
        ]
    },
    {
        id: 'kota_timur',
        order: 3,
        positionLabel: 'Timur (Kanan)',
        positionKm: 75,
        name: 'Lembah Hijau',
        shortName: 'Lembah Hijau',
        emoji: '🌾',
        tagline: 'Kawasan Agropolitan, Perkebunan Raya & Danau Alami',
        description: 'Wilayah timur berudara sejuk dengan hamparan tanah subur untuk pertanian serta perairan Danau Hijau yang kaya ikan air tawar.',
        highlights: [
            '🌾 Lahan Perkebunan & Pertanian (`/farm`)',
            '🛶 Spot Memancing Danau Hijau (`/fishing` spot Danau)',
            '🧑‍🌾 Profesi Lokal: **Petani Sayur** & **Mandor Kebun**'
        ]
    }
];

const CITY_MAP = new Map(CITIES.map(c => [c.id, c]));

/**
 * Command yang selalu dapat diakses meskipun sedang dalam perjalanan (/travel).
 */
const ALWAYS_ALLOWED_DURING_TRAVEL = new Set([
    'travel',
    'help',
    'ping',
    'admin',
    'start'
]);

/**
 * Command tambahan yang dapat diakses di kursi penumpang mobil saat disopiri Supir (termasuk hook masa depan HP/Laptop).
 */
const DRIVER_ALLOWED_DURING_TRAVEL = new Set([
    ...ALWAYS_ALLOWED_DURING_TRAVEL,
    'consume',
    'profile',
    'wardrobe',
    'inventory',
    'hp',
    'laptop',
    'phone'
]);

function getCity(cityId) {
    if (!cityId) return CITY_MAP.get(DEFAULT_CITY_ID);
    return CITY_MAP.get(String(cityId).toLowerCase()) || CITY_MAP.get(DEFAULT_CITY_ID);
}

function getAllCities() {
    return CITIES;
}

/**
 * Menghitung ongkos sewa supir sekali jalan berdasarkan jarak tempuh (km).
 */
function calculateDriverTripFare(distanceKm) {
    const d = Number(distanceKm || 0);
    if (d <= 0) return 0;
    if (d <= 30) return 15000;
    if (d <= 45) return 22500;
    return 35000;
}

/**
 * Menghitung pengurangan stat pemain berdasarkan jarak tempuh.
 * Bersifat aditif penuh: cost(30km) + cost(45km) === cost(75km).
 * Jika bersama supir (withDriver = true), pengurangan stat adalah 0.
 */
function calculateTravelVitalCost(distanceKm, withDriver = false) {
    if (withDriver) {
        return { energy: 0, hunger: 0, thirst: 0 };
    }
    const d = Math.max(0, Number(distanceKm || 0));
    return {
        energy: Math.round((d / 15) * 6),  // 30km->12, 45km->18, 75km->30
        hunger: Math.round((d / 15) * 4),  // 30km->8,  45km->12, 75km->20
        thirst: Math.round((d / 15) * 5)   // 30km->10, 45km->15, 75km->25
    };
}

/**
 * Menghitung detail rute perjalanan antar dua kota pada peta linear.
 */
function calculateCityRoute(fromCityId, toCityId) {
    const fromCity = getCity(fromCityId);
    const toCity = getCity(toCityId);
    if (!fromCity || !toCity || fromCity.id === toCity.id) {
        return null;
    }

    const distanceKm = Math.abs(toCity.positionKm - fromCity.positionKm);
    const durationSec = distanceKm * TRAVEL_SECONDS_PER_KM;
    const durationMs = durationSec * 1000;
    const passesCentral =
        (fromCity.id === 'kota_barat' && toCity.id === 'kota_timur') ||
        (fromCity.id === 'kota_timur' && toCity.id === 'kota_barat');

    return {
        fromCity,
        toCity,
        distanceKm,
        durationSec,
        durationMs,
        passesCentral,
        driverFareLp: calculateDriverTripFare(distanceKm),
        selfDriveVitalCost: calculateTravelVitalCost(distanceKm, false),
        driverVitalCost: calculateTravelVitalCost(distanceKm, true)
    };
}

function isCommandAllowedDuringTravel(commandOrModName, hasDriver = false) {
    const key = String(commandOrModName || '').toLowerCase();
    if (ALWAYS_ALLOWED_DURING_TRAVEL.has(key)) return true;
    if (hasDriver && DRIVER_ALLOWED_DURING_TRAVEL.has(key)) return true;
    return false;
}

module.exports = {
    DEFAULT_CITY_ID,
    TRAVEL_SECONDS_PER_KM,
    WEEKLY_DRIVER_CONTRACT_COST,
    WEEKLY_DRIVER_DURATION_MS,
    MOTEL_TRANSIT_CONFIG,
    CITIES,
    ALWAYS_ALLOWED_DURING_TRAVEL,
    DRIVER_ALLOWED_DURING_TRAVEL,
    getCity,
    getAllCities,
    calculateDriverTripFare,
    calculateTravelVitalCost,
    calculateCityRoute,
    isCommandAllowedDuringTravel
};
