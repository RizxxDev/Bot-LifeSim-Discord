const ENERGY_PER_CRAFT = 4;

const CRAFT_RECIPES = [
    {
        id: 'craft_kompos_rongsok',
        name: 'Olahan Pupuk Kompos',
        emoji: '🧪',
        outputItemId: 'kompos',
        outputQty: 1,
        energyCost: ENERGY_PER_CRAFT,
        ingredients: {
            bahan_basi: 3,
            sampah_kardus: 1
        },
        description: 'Daur ulang bahan basi dan kardus rongsokan menjadi pupuk kompos subur.'
    },
    {
        id: 'craft_umpan_pelet',
        name: 'Umpan Pelet Jagung',
        emoji: '🌽',
        outputItemId: 'umpan_pelet_jagung',
        outputQty: 5,
        energyCost: ENERGY_PER_CRAFT,
        ingredients: {
            jagung: 2,
            sampah_kaleng: 1
        },
        description: 'Racik pelet jagung kalengan (+10% peluang Uncommon+ saat memancing).'
    },
    {
        id: 'craft_umpan_magnet',
        name: 'Umpan Magnet Rongsokan',
        emoji: '🧲',
        outputItemId: 'umpan_magnet_rongsokan',
        outputQty: 3,
        energyCost: ENERGY_PER_CRAFT,
        ingredients: {
            sampah_besi: 2,
            sampah_radio: 1
        },
        description: 'Kail bermagnet rakitan (+16% peluang Rare+ saat memancing).'
    },
    {
        id: 'craft_p3k_darurat',
        name: 'Kotak P3K Darurat',
        emoji: '🩹',
        outputItemId: 'p3k_darurat',
        outputQty: 1,
        energyCost: ENERGY_PER_CRAFT,
        ingredients: {
            sampah_botol: 2,
            bayam: 2,
            air_mineral: 1
        },
        description: 'Perban & antiseptik herbal darurat untuk memulihkan +30 ❤️ Health.'
    },
    {
        id: 'craft_kit_perbaikan',
        name: 'Kit Perbaikan Ringan',
        emoji: '🔧',
        outputItemId: 'kit_perbaikan_ringan',
        outputQty: 1,
        energyCost: ENERGY_PER_CRAFT,
        ingredients: {
            sampah_besi: 3,
            kayu_bulat: 2,
            sampah_kaleng: 1
        },
        description: 'Perkakas tambal darurat untuk memulihkan +25 Durability alat kerja.'
    }
];

const CRAFT_RECIPE_MAP = new Map(CRAFT_RECIPES.map(r => [r.id, r]));

function getCraftRecipe(recipeId) {
    if (!recipeId) return null;
    return CRAFT_RECIPE_MAP.get(String(recipeId).toLowerCase()) || null;
}

module.exports = {
    ENERGY_PER_CRAFT,
    CRAFT_RECIPES,
    getCraftRecipe
};
