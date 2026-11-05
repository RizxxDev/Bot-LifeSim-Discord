const MAX_TOTAL_PLOTS = 16;
const MAX_RENTED_PLOTS = 8;
const WILT_AFTER_MATURE_MS = 24 * 3600000; // 24 jam setelah matang -> layu

const FARM_ENERGY_COSTS = {
    plant: 2,
    water: 1,
    harvest: 2
};

function calculatePlotRentPrice(nthPlot) {
    const n = Math.max(1, Number(nthPlot || 1));
    return 15000 + 5000 * (n - 1);
}

function calculatePlotBuyPrice(nthPlot) {
    const n = Math.max(1, Number(nthPlot || 1));
    return 400000 + 100000 * (n - 1);
}

const CROPS = [
    {
        id: 'bayam',
        seedId: 'bibit_bayam',
        name: 'Bayam Segar',
        emoji: '🥬',
        minLevel: 1,
        growthHours: 2,
        seedPrice: 2000,
        baseYield: 3,
        sellPrice: 2500,
        shelfLifeHours: 120,
        spoilageCategory: 'sayur',
        xp: 18
    },
    {
        id: 'tomat',
        seedId: 'bibit_tomat',
        name: 'Tomat Merah',
        emoji: '🍅',
        minLevel: 1,
        growthHours: 4,
        seedPrice: 3000,
        baseYield: 4,
        sellPrice: 3000,
        shelfLifeHours: 120,
        spoilageCategory: 'sayur',
        xp: 25
    },
    {
        id: 'jagung',
        seedId: 'bibit_jagung',
        name: 'Jagung Manis',
        emoji: '🌽',
        minLevel: 5,
        growthHours: 6,
        seedPrice: 4000,
        baseYield: 4,
        sellPrice: 4000,
        shelfLifeHours: 120,
        spoilageCategory: 'sayur',
        xp: 35
    },
    {
        id: 'cabai',
        seedId: 'bibit_cabai',
        name: 'Cabai Rawit',
        emoji: '🌶️',
        minLevel: 10,
        growthHours: 6,
        seedPrice: 5000,
        baseYield: 5,
        sellPrice: 4500,
        shelfLifeHours: 120,
        spoilageCategory: 'sayur',
        xp: 45
    },
    {
        id: 'kentang',
        seedId: 'bibit_kentang',
        name: 'Kentang Umbi',
        emoji: '🥔',
        minLevel: 15,
        growthHours: 8,
        seedPrice: 6000,
        baseYield: 6,
        sellPrice: 4500,
        shelfLifeHours: 120,
        spoilageCategory: 'sayur',
        xp: 55
    },
    {
        id: 'padi',
        seedId: 'bibit_padi',
        name: 'Gabah Padi',
        emoji: '🌾',
        minLevel: 20,
        growthHours: 10,
        seedPrice: 8000,
        baseYield: 8,
        sellPrice: 4000,
        shelfLifeHours: 336,
        spoilageCategory: 'biji',
        xp: 70
    },
    {
        id: 'stroberi',
        seedId: 'bibit_stroberi',
        name: 'Stroberi Kebun',
        emoji: '🍓',
        minLevel: 25,
        growthHours: 8,
        seedPrice: 12000,
        baseYield: 5,
        sellPrice: 9000,
        shelfLifeHours: 120,
        spoilageCategory: 'buah',
        xp: 90
    },
    {
        id: 'kopi_biji',
        seedId: 'bibit_kopi',
        name: 'Biji Kopi Arabika',
        emoji: '☕',
        minLevel: 35,
        growthHours: 12,
        seedPrice: 20000,
        baseYield: 5,
        sellPrice: 16000,
        shelfLifeHours: 336,
        spoilageCategory: 'biji',
        xp: 130
    },
    {
        id: 'vanili',
        seedId: 'bibit_vanili',
        name: 'Polong Vanili',
        emoji: '🌿',
        minLevel: 45,
        growthHours: 12,
        seedPrice: 30000,
        baseYield: 4,
        sellPrice: 27000,
        shelfLifeHours: 336,
        spoilageCategory: 'biji',
        xp: 180
    }
];

const CROP_WILT_AFTER_MS = WILT_AFTER_MATURE_MS;
const FARM_LIMITS = {
    MAX_TOTAL_PLOTS,
    MAX_RENTED_PLOTS,
    ENERGY_PLANT: FARM_ENERGY_COSTS.plant,
    ENERGY_WATER: FARM_ENERGY_COSTS.water,
    ENERGY_HARVEST: FARM_ENERGY_COSTS.harvest,
    COMPOST_ROTTEN_COST: 5,
    RENT_BILLING_INTERVAL_MS: 7 * 86400000
};

for (const c of CROPS) {
    c.growTimeMs = c.growthHours * 3600000;
    c.cropItemId = c.id;
    c.seedItemId = c.seedId;
    c.baseYieldMin = c.baseYield;
    c.baseYieldMax = c.baseYield + 2;
    c.xpReward = c.xp;
}

const CROP_MAP = new Map(CROPS.map(c => [c.id, c]));
const SEED_TO_CROP_MAP = new Map(CROPS.map(c => [c.seedId, c]));

function getCrop(idOrSeedId) {
    if (!idOrSeedId) return null;
    const key = String(idOrSeedId).toLowerCase();
    return CROP_MAP.get(key) || SEED_TO_CROP_MAP.get(key) || null;
}

function getBonusYieldChanceFromLevel(farmingLevel) {
    return Math.min(0.25, Math.max(0, Number(farmingLevel || 1) * 0.005));
}

module.exports = {
    MAX_TOTAL_PLOTS,
    MAX_RENTED_PLOTS,
    WILT_AFTER_MATURE_MS,
    CROP_WILT_AFTER_MS,
    FARM_ENERGY_COSTS,
    FARM_LIMITS,
    CROPS,
    calculatePlotRentPrice,
    calculatePlotBuyPrice,
    getRentPlotPrice: calculatePlotRentPrice,
    getBuyPlotPrice: calculatePlotBuyPrice,
    getCrop,
    getBonusYieldChanceFromLevel
};
