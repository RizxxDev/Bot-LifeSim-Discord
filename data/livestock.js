const LIVESTOCK_LIMITS = {
    MAX_TOTAL_PENS: 8,
    MAX_RENTED_PENS: 4,
    SPOIL_OVERDUE_MS: 36 * 3600000,
    RENT_BILLING_INTERVAL_MS: 7 * 24 * 3600000
};

function calculatePenRentPrice(nthPen) {
    const n = Math.max(1, Number(nthPen || 1));
    return Math.round(20000 * Math.pow(1.4, n - 1));
}

function calculatePenBuyPrice(nthPen) {
    const n = Math.max(1, Number(nthPen || 1));
    return Math.round(350000 * Math.pow(1.55, n - 1));
}

const LIVESTOCK_SPECIES = [
    {
        id: 'ayam_kampung',
        name: 'Ayam Kampung',
        emoji: '🐔',
        minLevel: 1,
        buyPrice: 18000,
        cycleHours: 3,
        maxCycles: 8,
        feedOptions: [
            { itemId: 'jagung', qty: 1 },
            { itemId: 'pakan_ternak', qty: 1 }
        ],
        yieldItemId: 'telur_ayam',
        yieldQty: 2,
        retireItemId: 'daging_ternak',
        retireQty: 1,
        xpReward: 18,
        description: 'Ayam petelur tangguh yang menghasilkan 2× Telur Ayam setiap 3 jam (8 siklus).'
    },
    {
        id: 'bebek_petelur',
        name: 'Bebek Petelur',
        emoji: '🦆',
        minLevel: 5,
        buyPrice: 35000,
        cycleHours: 4,
        maxCycles: 8,
        feedOptions: [
            { itemId: 'bayam', qty: 1 },
            { itemId: 'pakan_ternak', qty: 1 }
        ],
        yieldItemId: 'telur_bebek',
        yieldQty: 2,
        retireItemId: 'daging_ternak',
        retireQty: 1,
        xpReward: 28,
        description: 'Bebek unggul penghasil 2× Telur Bebek Gurih setiap 4 jam (8 siklus).'
    },
    {
        id: 'kambing_perah',
        name: 'Kambing Perah',
        emoji: '🐐',
        minLevel: 12,
        buyPrice: 95000,
        cycleHours: 6,
        maxCycles: 10,
        feedOptions: [
            { itemId: 'pakan_ternak', qty: 1 },
            { itemId: 'bayam', qty: 2 }
        ],
        yieldItemId: 'susu_kambing',
        yieldQty: 2,
        retireItemId: 'daging_ternak',
        retireQty: 2,
        xpReward: 48,
        description: 'Kambing penghasil 2× Susu Kambing Murni setiap 6 jam (10 siklus).'
    }
];

const LIVESTOCK_MAP = new Map(LIVESTOCK_SPECIES.map(s => [s.id, s]));

function getLivestockSpecies(speciesId) {
    if (!speciesId) return null;
    return LIVESTOCK_MAP.get(String(speciesId).toLowerCase()) || null;
}

module.exports = {
    LIVESTOCK_LIMITS,
    LIVESTOCK_SPECIES,
    calculatePenRentPrice,
    calculatePenBuyPrice,
    getLivestockSpecies
};
