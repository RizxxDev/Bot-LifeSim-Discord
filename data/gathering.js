const { getLevelInfoFromXp } = require('./locations');

/**
 * Konfigurasi Aktivitas Kehutanan & Galian Alam (/gather) di Kota Timur (Lembah Hijau)
 * serta Resep Pengolahan Material Konstruksi Workshop.
 */

const GATHER_ACTIVITY_COST = {
    energy: 10,
    hunger: 4,
    thirst: 5,
    cooldownSec: 240 // 4 menit per ekspedisi
};

const GATHER_ZONES = [
    {
        id: 'hutan_pinus',
        name: 'Hutan Bambu & Kayu Lembah',
        emoji: '🌲',
        cityId: 'kota_timur',
        minLevel: 1,
        requiredToolTag: 'axe',
        minToolTier: 1,
        baseXp: 16,
        description: 'Menebang pohon kayu & rumpun bambu di tepian Lembah Hijau.',
        drops: [
            { itemId: 'kayu_bulat', minQty: 2, maxQty: 4, weight: 52 },
            { itemId: 'bambu', minQty: 2, maxQty: 5, weight: 40 },
            { itemId: 'sampah_kardus', minQty: 1, maxQty: 2, weight: 8 }
        ]
    },
    {
        id: 'tepian_sungai',
        name: 'Bantaran Sungai & Tanah Liat',
        emoji: '🏖️',
        cityId: 'kota_timur',
        minLevel: 1,
        requiredToolTag: 'shovel',
        minToolTier: 1,
        baseXp: 18,
        description: 'Menggali tanah liat basah & pasir sungai bahan baku bata dan beton.',
        drops: [
            { itemId: 'tanah_liat', minQty: 2, maxQty: 5, weight: 48 },
            { itemId: 'pasir_bangunan', minQty: 2, maxQty: 5, weight: 44 },
            { itemId: 'batu_kapur', minQty: 1, maxQty: 2, weight: 8 }
        ]
    },
    {
        id: 'hutan_jati',
        name: 'Hutan Kayu Keras Pedalaman',
        emoji: '🪓',
        cityId: 'kota_timur',
        minLevel: 8,
        requiredToolTag: 'axe',
        minToolTier: 2,
        baseXp: 28,
        description: 'Zona kayu lebat Lv. 8+ (butuh Kapak Besi / Gergaji Mesin); hasil tebangan jauh lebih banyak.',
        drops: [
            { itemId: 'kayu_bulat', minQty: 4, maxQty: 7, weight: 65 },
            { itemId: 'bambu', minQty: 3, maxQty: 6, weight: 35 }
        ]
    }
];

function getGatherZone(zoneId) {
    return GATHER_ZONES.find(z => z.id === zoneId) || GATHER_ZONES[0];
}

function rollGatherDrops(zone, toolBonusPct = 0, skillLevel = 1) {
    const rolls = 2 + (Math.random() < (0.25 + toolBonusPct + skillLevel * 0.01) ? 1 : 0);
    const totalWeight = zone.drops.reduce((acc, d) => acc + d.weight, 0);
    const tally = new Map();

    for (let i = 0; i < rolls; i++) {
        let r = Math.random() * totalWeight;
        let chosen = zone.drops[0];
        for (const d of zone.drops) {
            r -= d.weight;
            if (r <= 0) {
                chosen = d;
                break;
            }
        }
        const qtyRange = chosen.maxQty - chosen.minQty + 1;
        const baseQty = chosen.minQty + Math.floor(Math.random() * qtyRange);
        const bonusQty = Math.random() < toolBonusPct ? 1 : 0;
        const finalQty = baseQty + bonusQty;
        tally.set(chosen.itemId, (tally.get(chosen.itemId) || 0) + finalQty);
    }

    return [...tally.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
}

/**
 * Resep Pengolahan Bahan Bangunan Jadi di Workshop Umum Kota maupun Workshop Pribadi.
 */
const WORKSHOP_RECIPES = [
    {
        id: 'proc_papan_kayu',
        outputItemId: 'papan_kayu',
        outputQty: 2,
        stationType: 'sawmill',
        stationModuleIds: ['sawmill_station', 'workbench'],
        inputs: [{ itemId: 'kayu_bulat', qty: 2 }],
        npcFee: 2000,
        privateFee: 600,
        durationSec: 45,
        description: 'Menggergaji 2× Kayu Gelondongan -> 2× Papan Kayu Olahan.'
    },
    {
        id: 'proc_batu_bata',
        outputItemId: 'batu_bata',
        outputQty: 2,
        stationType: 'kiln',
        stationModuleIds: ['kiln_station'],
        inputs: [{ itemId: 'tanah_liat', qty: 3 }, { itemId: 'batubara', qty: 1 }],
        npcFee: 3500,
        privateFee: 1000,
        durationSec: 75,
        description: 'Membakar 3× Tanah Liat + 1× Batubara -> 2× Batu Bata Merah.'
    },
    {
        id: 'proc_semen',
        outputItemId: 'semen',
        outputQty: 2,
        stationType: 'kiln',
        stationModuleIds: ['kiln_station'],
        inputs: [{ itemId: 'batu_kapur', qty: 2 }, { itemId: 'pasir_bangunan', qty: 1 }, { itemId: 'batubara', qty: 1 }],
        npcFee: 4500,
        privateFee: 1200,
        durationSec: 90,
        description: 'Mengolah Batu Kapur + Pasir + Batubara -> 2× Semen Sak.'
    },
    {
        id: 'proc_beton_cor',
        outputItemId: 'beton_cor',
        outputQty: 1,
        stationType: 'smelter',
        stationModuleIds: ['smelter_station', 'kiln_station'],
        inputs: [{ itemId: 'semen', qty: 1 }, { itemId: 'pasir_bangunan', qty: 2 }, { itemId: 'batu_kapur', qty: 1 }],
        npcFee: 7000,
        privateFee: 2000,
        durationSec: 120,
        description: 'Mencor 1× Semen + 2× Pasir + 1× Batu Kapur -> 1× Panel Beton.'
    },
    {
        id: 'proc_rangka_baja',
        outputItemId: 'rangka_baja',
        outputQty: 1,
        stationType: 'smelter',
        stationModuleIds: ['smelter_station'],
        inputs: [{ itemId: 'bijih_besi', qty: 2 }, { itemId: 'batubara', qty: 1 }],
        npcFee: 9000,
        privateFee: 2500,
        durationSec: 150,
        description: 'Melebur 2× Bijih Besi + 1× Batubara -> 1× Rangka Baja.'
    },
    {
        id: 'proc_kaca_panel',
        outputItemId: 'kaca_panel',
        outputQty: 1,
        stationType: 'kiln',
        stationModuleIds: ['kiln_station'],
        inputs: [{ itemId: 'kuarsa', qty: 1 }, { itemId: 'pasir_bangunan', qty: 2 }, { itemId: 'batubara', qty: 1 }],
        npcFee: 11000,
        privateFee: 3000,
        durationSec: 135,
        description: 'Melelehkan Kuarsa + Pasir + Batubara -> 1× Panel Kaca.'
    },
    {
        id: 'proc_marmer',
        outputItemId: 'marmer',
        outputQty: 1,
        stationType: 'smelter',
        stationModuleIds: ['smelter_station', 'workbench'],
        inputs: [{ itemId: 'kuarsa', qty: 1 }, { itemId: 'batu_kapur', qty: 2 }, { itemId: 'pasir_bangunan', qty: 1 }],
        npcFee: 16000,
        privateFee: 4500,
        durationSec: 180,
        description: 'Memoles Kuarsa + Batu Kapur + Pasir -> 1× Lempeng Marmer.'
    },
    {
        id: 'proc_kit_utilitas',
        outputItemId: 'kit_utilitas',
        outputQty: 1,
        stationType: 'smelter',
        stationModuleIds: ['smelter_station', 'workbench'],
        inputs: [{ itemId: 'bijih_tembaga', qty: 2 }, { itemId: 'bijih_timah', qty: 1 }],
        npcFee: 12000,
        privateFee: 3500,
        durationSec: 120,
        description: 'Merakit 2× Bijih Tembaga + 1× Bijih Timah -> 1× Kit Listrik & Pipa.'
    },
    {
        id: 'proc_seng_daur',
        outputItemId: 'seng_daur',
        outputQty: 1,
        stationType: 'workbench',
        stationModuleIds: ['workbench'],
        inputs: [{ itemId: 'sampah_besi', qty: 2 }, { itemId: 'sampah_kardus', qty: 1 }],
        npcFee: 1500,
        privateFee: 400,
        durationSec: 45,
        description: 'Mendaur ulang 2× Sampah Besi + 1× Kardus -> 1× Seng & Papan Daur Ulang.'
    },
    {
        id: 'craft_kasur_lipat',
        outputItemId: 'kasur_lipat',
        outputQty: 1,
        stationType: 'workbench',
        stationModuleIds: ['workbench'],
        inputs: [{ itemId: 'papan_kayu', qty: 2 }, { itemId: 'seng_daur', qty: 1 }],
        npcFee: 25000,
        privateFee: 8000,
        durationSec: 90,
        description: 'Merakit Kasur Lipat Sederhana (1×1) untuk /bangun.'
    },
    {
        id: 'craft_ranjang_kayu',
        outputItemId: 'ranjang_kayu',
        outputQty: 1,
        stationType: 'workbench',
        stationModuleIds: ['workbench', 'sawmill_station'],
        inputs: [{ itemId: 'papan_kayu', qty: 4 }, { itemId: 'rangka_baja', qty: 1 }],
        npcFee: 55000,
        privateFee: 18000,
        durationSec: 150,
        description: 'Membuat Ranjang Kayu Jati (1×2) dari 4× Papan Kayu + 1× Rangka Baja.'
    },
    {
        id: 'craft_ranjang_king',
        outputItemId: 'ranjang_king',
        outputQty: 1,
        stationType: 'workbench',
        stationModuleIds: ['workbench', 'sawmill_station'],
        inputs: [{ itemId: 'papan_kayu', qty: 6 }, { itemId: 'marmer', qty: 2 }, { itemId: 'rangka_baja', qty: 2 }],
        npcFee: 140000,
        privateFee: 45000,
        durationSec: 240,
        description: 'Membuat Ranjang King Sultan (2×2) dari Papan Kayu, Marmer & Baja.'
    },
    {
        id: 'craft_kompor_1tungku',
        outputItemId: 'kompor_1tungku',
        outputQty: 1,
        stationType: 'workbench',
        stationModuleIds: ['workbench', 'smelter_station'],
        inputs: [{ itemId: 'rangka_baja', qty: 1 }, { itemId: 'kit_utilitas', qty: 1 }],
        npcFee: 30000,
        privateFee: 10000,
        durationSec: 100,
        description: 'Merakit Kompor Gas 1 Tungku (1×1) untuk /cook di rumah.'
    },
    {
        id: 'craft_kulkas_2pintu',
        outputItemId: 'kulkas_2pintu',
        outputQty: 1,
        stationType: 'workbench',
        stationModuleIds: ['workbench', 'smelter_station'],
        inputs: [{ itemId: 'rangka_baja', qty: 2 }, { itemId: 'kit_utilitas', qty: 2 }, { itemId: 'kaca_panel', qty: 1 }],
        npcFee: 95000,
        privateFee: 30000,
        durationSec: 180,
        description: 'Merakit Kulkas Side-by-Side (+30 slot Kulkas properti).'
    },
    {
        id: 'craft_rak_gudang',
        outputItemId: 'rak_gudang',
        outputQty: 1,
        stationType: 'workbench',
        stationModuleIds: ['workbench'],
        inputs: [{ itemId: 'papan_kayu', qty: 3 }, { itemId: 'rangka_baja', qty: 1 }],
        npcFee: 28000,
        privateFee: 9000,
        durationSec: 90,
        description: 'Merakit Rak Besi Gudang (+20 slot Gudang properti).'
    },
    {
        id: 'craft_etalase_warung',
        outputItemId: 'etalase_warung',
        outputQty: 1,
        stationType: 'workbench',
        stationModuleIds: ['workbench', 'kiln_station'],
        inputs: [{ itemId: 'papan_kayu', qty: 3 }, { itemId: 'kaca_panel', qty: 2 }],
        npcFee: 65000,
        privateFee: 20000,
        durationSec: 140,
        description: 'Merakit Etalase Kaca Warung (1×2) untuk berdagang otomatis.'
    },
    {
        id: 'craft_meja_rakit',
        outputItemId: 'meja_rakit',
        outputQty: 1,
        stationType: 'workbench',
        stationModuleIds: ['workbench', 'sawmill_station'],
        inputs: [{ itemId: 'papan_kayu', qty: 4 }, { itemId: 'rangka_baja', qty: 1 }],
        npcFee: 40000,
        privateFee: 12000,
        durationSec: 120,
        description: 'Merakit Meja Kerja Pertukangan (1×2) untuk dipasang di properti.'
    }
];

function getWorkshopRecipe(recipeId) {
    return WORKSHOP_RECIPES.find(r => r.id === recipeId) || null;
}

module.exports = {
    GATHER_ACTIVITY_COST,
    GATHER_ZONES,
    WORKSHOP_RECIPES,
    getGatherZone,
    rollGatherDrops,
    getWorkshopRecipe,
    getLevelInfoFromXp
};
