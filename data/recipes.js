const RECIPES = [
    {
        id: 'nasi_putih',
        perfectItemId: 'nasi_putih_sempurna',
        name: 'Nasi Putih Pulen',
        emoji: '🍚',
        minLevel: 1,
        cookMinutes: 5,
        xp: 20,
        sellPrice: 8500,
        ingredients: [
            { type: 'item', itemId: 'padi', qty: 2, label: '2× Gabah Padi' }
        ],
        effects: { hunger: 30 },
        tags: ['food', 'cooked']
    },
    {
        id: 'tumis_bayam',
        perfectItemId: 'tumis_bayam_sempurna',
        name: 'Tumis Bayam Bawang',
        emoji: '🥬',
        minLevel: 1,
        cookMinutes: 5,
        xp: 22,
        sellPrice: 8000,
        ingredients: [
            { type: 'item', itemId: 'bayam', qty: 3, label: '3× Bayam Segar' }
        ],
        effects: { hunger: 25, health: 5 },
        tags: ['food', 'cooked']
    },
    {
        id: 'kentang_goreng',
        perfectItemId: 'kentang_goreng_sempurna',
        name: 'Kentang Goreng Renyah',
        emoji: '🍟',
        minLevel: 8,
        cookMinutes: 10,
        xp: 35,
        sellPrice: 14500,
        ingredients: [
            { type: 'item', itemId: 'kentang', qty: 3, label: '3× Kentang Umbi' }
        ],
        effects: { hunger: 35 },
        tags: ['food', 'cooked']
    },
    {
        id: 'sambal',
        perfectItemId: 'sambal',
        name: 'Sambal Cobek Pedas',
        emoji: '🌶️',
        minLevel: 10,
        cookMinutes: 10,
        xp: 40,
        sellPrice: 17500,
        ingredients: [
            { type: 'item', itemId: 'cabai', qty: 3, label: '3× Cabai Rawit' },
            { type: 'item', itemId: 'tomat', qty: 1, label: '1× Tomat Merah' }
        ],
        effects: { hunger: 10 },
        tags: ['food', 'cooked', 'ingredient']
    },
    {
        id: 'ikan_bakar_sambal',
        perfectItemId: 'ikan_bakar_sambal_sempurna',
        name: 'Ikan Bakar Sambal',
        emoji: '🐟',
        minLevel: 10,
        cookMinutes: 15,
        xp: 55,
        sellPrice: 25000,
        ingredients: [
            { type: 'fish_rarity', rarity: 'common', qty: 1, label: '1× Ikan Common' },
            { type: 'item', itemId: 'sambal', qty: 1, label: '1× Sambal Cobek' }
        ],
        effects: { hunger: 50, health: 5 },
        tags: ['food', 'cooked']
    },
    {
        id: 'nasi_goreng',
        perfectItemId: 'nasi_goreng_sempurna',
        name: 'Nasi Goreng Spesial',
        emoji: '🍛',
        minLevel: 12,
        cookMinutes: 15,
        xp: 60,
        sellPrice: 17000,
        ingredients: [
            { type: 'item', itemId: 'padi', qty: 2, label: '2× Gabah Padi' },
            { type: 'item', itemId: 'cabai', qty: 1, label: '1× Cabai Rawit' },
            { type: 'item', itemId: 'tomat', qty: 1, label: '1× Tomat Merah' }
        ],
        effects: { hunger: 60 },
        tags: ['food', 'cooked']
    },
    {
        id: 'sup_ikan',
        perfectItemId: 'sup_ikan_sempurna',
        name: 'Sup Ikan Kuah Bening',
        emoji: '🍲',
        minLevel: 18,
        cookMinutes: 20,
        xp: 80,
        sellPrice: 28000,
        ingredients: [
            { type: 'fish_rarity', rarity: 'uncommon', qty: 1, label: '1× Ikan Uncommon' },
            { type: 'item', itemId: 'kentang', qty: 2, label: '2× Kentang Umbi' },
            { type: 'item', itemId: 'tomat', qty: 1, label: '1× Tomat Merah' }
        ],
        effects: { hunger: 55, thirst: 20, health: 10 },
        tags: ['food', 'drink', 'cooked']
    },
    {
        id: 'jus_stroberi',
        perfectItemId: 'jus_stroberi_sempurna',
        name: 'Jus Stroberi Dingin',
        emoji: '🍓',
        minLevel: 25,
        cookMinutes: 15,
        xp: 95,
        sellPrice: 29000,
        ingredients: [
            { type: 'item', itemId: 'stroberi', qty: 3, label: '3× Stroberi Kebun' }
        ],
        effects: { thirst: 45, energy: 5 },
        tags: ['drink', 'cooked']
    },
    {
        id: 'pepes_ikan_spesial',
        perfectItemId: 'pepes_ikan_spesial_sempurna',
        name: 'Pepes Ikan Spesial',
        emoji: '🍃',
        minLevel: 30,
        cookMinutes: 30,
        xp: 120,
        sellPrice: 58000,
        ingredients: [
            { type: 'fish_rarity', rarity: 'rare', qty: 1, label: '1× Ikan Rare' },
            { type: 'item', itemId: 'cabai', qty: 2, label: '2× Cabai Rawit' },
            { type: 'item', itemId: 'padi', qty: 1, label: '1× Gabah Padi' }
        ],
        effects: { hunger: 70 },
        buff: { type: 'xp_boost', multiplier: 1.05, durationSec: 1800, label: '+5% EXP (30 mnt)' },
        tags: ['food', 'cooked']
    },
    {
        id: 'kopi_tubruk',
        perfectItemId: 'kopi_tubruk_sempurna',
        name: 'Kopi Tubruk Rumah',
        emoji: '☕',
        minLevel: 35,
        cookMinutes: 20,
        xp: 140,
        sellPrice: 34000,
        caffeineType: 'kopi',
        ingredients: [
            { type: 'item', itemId: 'kopi_biji', qty: 2, label: '2× Biji Kopi Arabika' }
        ],
        effects: { thirst: 15, energy: 25 },
        tags: ['drink', 'cooked']
    },
    {
        id: 'seafood_bakar',
        perfectItemId: 'seafood_bakar_sempurna',
        name: 'Seafood Bakar Bumbu',
        emoji: '🦞',
        minLevel: 40,
        cookMinutes: 45,
        xp: 175,
        sellPrice: 47000,
        ingredients: [
            { type: 'sea_fish_uncommon_plus', qty: 1, label: '1× Ikan Laut Uncommon+' },
            { type: 'item', itemId: 'cabai', qty: 2, label: '2× Cabai Rawit' }
        ],
        effects: { hunger: 80 },
        buff: { type: 'luck_boost', multiplier: 0.03, durationSec: 1800, label: '+3% Rarity (30 mnt)' },
        tags: ['food', 'cooked']
    },
    {
        id: 'es_krim_vanili',
        perfectItemId: 'es_krim_vanili_sempurna',
        name: 'Es Krim Vanili Stroberi',
        emoji: '🍨',
        minLevel: 45,
        cookMinutes: 60,
        xp: 210,
        sellPrice: 68000,
        ingredients: [
            { type: 'item', itemId: 'vanili', qty: 2, label: '2× Polong Vanili' },
            { type: 'item', itemId: 'stroberi', qty: 1, label: '1× Stroberi Kebun' }
        ],
        effects: { thirst: 30 },
        buff: { type: 'energy_regen', multiplier: 1.5, durationSec: 7200, label: 'Regen Energy ×1,5 (2 jam)' },
        tags: ['food', 'drink', 'cooked']
    }
];

const COOKING_LIMITS = {
    MAX_BATCH_PORTIONS: 5,
    ENERGY_PER_BATCH: 3
};

const SEA_FISH_UNCOMMON_PLUS_IDS = [
    'ikan_kakap',
    'ikan_kerapu',
    'ikan_tuna_kuning',
    'ikan_layaran',
    'hiu_putih'
];

for (const r of RECIPES) {
    r.cookTimeSec = r.cookMinutes * 60;
    r.resultItemId = r.id;
    r.xpReward = r.xp;
}

const RECIPE_MAP = new Map(RECIPES.map(r => [r.id, r]));

function getRecipe(recipeId) {
    if (!recipeId) return null;
    return RECIPE_MAP.get(String(recipeId).toLowerCase()) || null;
}

function getPerfectCookChance(cookingLevel) {
    return Math.min(0.25, 0.05 + Math.max(0, Number(cookingLevel || 1)) * 0.003);
}

module.exports = {
    RECIPES,
    COOKING_LIMITS,
    SEA_FISH_UNCOMMON_PLUS_IDS,
    getRecipe,
    getPerfectCookChance
};
