const RARITY_ORDER = ['trash', 'common', 'uncommon', 'rare', 'epic', 'legendary'];

const RARITY_LABELS = {
    trash:     { name: 'Sampah',    emoji: '♻️', xp: 4 },
    common:    { name: 'Common',    emoji: '⚪', xp: 10 },
    uncommon:  { name: 'Uncommon',  emoji: '🟢', xp: 20 },
    rare:      { name: 'Rare',      emoji: '🔵', xp: 45 },
    epic:      { name: 'Epic',      emoji: '🟣', xp: 100 },
    legendary: { name: 'Legendary', emoji: '🌟', xp: 250 }
};

const BASE_FISHING_WEIGHTS = {
    trash: 0.150,
    common: 0.550,
    uncommon: 0.220,
    rare: 0.065,
    epic: 0.013,
    legendary: 0.002
};

const BASE_MINING_WEIGHTS = {
    common: 0.650,
    uncommon: 0.240,
    rare: 0.085,
    epic: 0.021,
    legendary: 0.004
};

const FISHING_LOCATIONS = [
    {
        id: 'sungai',
        name: 'Sungai Kota',
        emoji: '🏞️',
        minLevel: 1,
        minRodTier: 1,
        requiresSeaPermit: false,
        description: 'Perairan tenang di pinggir kota, cocok untuk pemancing pemula.',
        loot: {
            trash: ['sampah_sandal', 'sampah_kaleng', 'sampah_botol'],
            common: ['ikan_mujair', 'ikan_lele'],
            uncommon: ['ikan_nila', 'ikan_gurame'],
            rare: ['ikan_patin'],
            epic: ['ikan_belida'],
            legendary: ['ikan_arwana']
        }
    },
    {
        id: 'danau',
        name: 'Danau Hijau',
        emoji: '🛶',
        minLevel: 10,
        minRodTier: 2, // Fiberglass
        requiresSeaPermit: false,
        description: 'Danau alami yang dalam, dihuni ikan predator air tawar.',
        loot: {
            trash: ['sampah_sandal', 'sampah_kaleng', 'sampah_botol'],
            common: ['ikan_mas', 'ikan_tawes'],
            uncommon: ['ikan_gabus', 'ikan_baung'],
            rare: ['ikan_toman'],
            epic: ['ikan_sidat'],
            legendary: ['ikan_arapaima']
        }
    },
    {
        id: 'laut',
        name: 'Laut Lepas',
        emoji: '🌊',
        minLevel: 25,
        minRodTier: 3, // Carbon
        requiresSeaPermit: true,
        description: 'Perairan samudra dengan arus kuat dan tangkapan bernilai jutaan Lp.',
        loot: {
            trash: ['sampah_kaleng', 'sampah_botol'],
            common: ['ikan_kembung', 'ikan_tongkol'],
            uncommon: ['ikan_kakap', 'ikan_kerapu'],
            rare: ['ikan_tuna_kuning'],
            epic: ['ikan_layaran'],
            legendary: ['ikan_tuna_biru']
        }
    }
];

const MINING_LOCATIONS = [
    {
        id: 'tambang_batu',
        name: 'Tambang Batu Permukaan',
        emoji: '🪨',
        minLevel: 1,
        minPickaxeTier: 1,
        requiresHelmet: false,
        accidentChance: 0.02,
        description: 'Terowongan dangkal kaya batubara dan bijih besi.',
        loot: {
            common: ['batu_kapur', 'batubara'],
            uncommon: ['bijih_besi'],
            rare: ['kuarsa'],
            epic: ['fosil_purba'],
            legendary: ['geode_ametis']
        }
    },
    {
        id: 'tambang_tembaga',
        name: 'Tambang Tembaga & Perak',
        emoji: '🟠',
        minLevel: 10,
        minPickaxeTier: 2, // Besi
        requiresHelmet: false,
        accidentChance: 0.03,
        description: 'Lapisan batuan menengah dengan urat tembaga, perak, dan giok.',
        loot: {
            common: ['bijih_tembaga', 'bijih_timah'],
            uncommon: ['bijih_perak'],
            rare: ['batu_giok'],
            epic: ['safir_biru'],
            legendary: ['kristal_langka']
        }
    },
    {
        id: 'tambang_emas',
        name: 'Tambang Emas Dalam',
        emoji: '🪙',
        minLevel: 25,
        minPickaxeTier: 3, // Baja
        requiresHelmet: true,
        accidentChance: 0.04,
        description: 'Terowongan panas di kedalaman tinggi yang menyimpan bijih emas dan rubi.',
        loot: {
            common: ['bijih_besi', 'bijih_perak'],
            uncommon: ['bijih_emas'],
            rare: ['permata_rubi'],
            epic: ['emas_murni'],
            legendary: ['bongkahan_emas_raksasa']
        }
    },
    {
        id: 'tambang_berlian',
        name: 'Gua Inti Berlian',
        emoji: '💎',
        minLevel: 40,
        minPickaxeTier: 4, // Titanium
        requiresHelmet: true,
        accidentChance: 0.05,
        description: 'Zona terdalam bertekanan ekstrem tempat berlian dan zamrud terbentuk.',
        loot: {
            common: ['kuarsa'],
            uncommon: ['bijih_emas'],
            rare: ['permata_zamrud'],
            epic: ['berlian_kasar'],
            legendary: ['berlian_biru']
        }
    }
];

function xpRequiredForNextLevel(level) {
    return Math.round(20 * Math.pow(Math.max(1, level), 1.35));
}

function getLevelInfoFromXp(totalXp = 0) {
    let xp = Math.max(0, Number(totalXp || 0));
    let level = 1;
    while (true) {
        const req = xpRequiredForNextLevel(level);
        if (xp >= req) {
            xp -= req;
            level += 1;
        } else {
            return {
                level,
                currentXp: xp,
                requiredXp: req,
                masteryStars: level > 50 ? Math.floor((level - 50) / 10) + 1 : 0,
                rarityBonus: Math.min(0.25, (level - 1) * 0.005)
            };
        }
    }
}

function getFishingLocation(locId) {
    return FISHING_LOCATIONS.find(l => l.id === locId) || FISHING_LOCATIONS[0];
}

function getMiningLocation(locId) {
    return MINING_LOCATIONS.find(l => l.id === locId) || MINING_LOCATIONS[0];
}

function rollLoot({
    isFishing = true,
    location,
    toolRarityBonus = 0,
    baitRarityBonus = 0,
    baitMinTier = 'uncommon',
    skillRarityBonus = 0,
    buffRarityBonus = 0,
    softCapTrashBonus = 0,
    minigameSuccess = true
}) {
    const base = isFishing ? { ...BASE_FISHING_WEIGHTS } : { ...BASE_MINING_WEIGHTS };
    const totalBonus = toolRarityBonus + skillRarityBonus + buffRarityBonus;

    if (isFishing && softCapTrashBonus > 0) {
        base.trash = (base.trash || 0) + softCapTrashBonus;
    }

    // Apply rarity multipliers to higher tiers
    for (const tier of ['uncommon', 'rare', 'epic', 'legendary']) {
        if (base[tier] !== undefined) {
            let mult = 1 + totalBonus;
            if (isFishing && baitRarityBonus > 0) {
                const tierIdx = RARITY_ORDER.indexOf(tier);
                const minIdx = RARITY_ORDER.indexOf(baitMinTier || 'uncommon');
                if (tierIdx >= minIdx) {
                    mult += baitRarityBonus;
                }
            }
            base[tier] *= mult;
        }
    }

    // Jika mini-game gagal, hilangkan peluang epic & legendary (hasil turun, bukan nol)
    if (!minigameSuccess) {
        delete base.epic;
        delete base.legendary;
    }

    // Filter hanya tier yang punya item di lokasi ini
    const entries = Object.entries(base).filter(([tier]) => {
        const list = location.loot[tier];
        return Array.isArray(list) && list.length > 0;
    });

    const sumWeights = entries.reduce((acc, [, w]) => acc + w, 0);
    let r = Math.random() * sumWeights;
    let chosenTier = entries[0][0];

    for (const [tier, weight] of entries) {
        if (r <= weight) {
            chosenTier = tier;
            break;
        }
        r -= weight;
    }

    const pool = location.loot[chosenTier];
    const itemId = pool[Math.floor(Math.random() * pool.length)];

    // Untuk mining common, berikan 1-3 pcs sesuai PRD
    let quantity = 1;
    if (!isFishing && chosenTier === 'common') {
        quantity = minigameSuccess ? (1 + Math.floor(Math.random() * 3)) : 1;
    }

    return {
        rarity: chosenTier,
        rarityInfo: RARITY_LABELS[chosenTier],
        itemId,
        quantity
    };
}

module.exports = {
    RARITY_ORDER,
    RARITY_LABELS,
    FISHING_LOCATIONS,
    MINING_LOCATIONS,
    xpRequiredForNextLevel,
    getLevelInfoFromXp,
    getFishingLocation,
    getMiningLocation,
    rollLoot
};
