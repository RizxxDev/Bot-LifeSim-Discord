const { COLORS } = require('../utils/uiBuilder');

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

const RARITY_META = {
    common: {
        id: 'common',
        label: 'Common',
        emoji: '⚪',
        duplicateTickets: 1
    },
    uncommon: {
        id: 'uncommon',
        label: 'Uncommon',
        emoji: '🟢',
        duplicateTickets: 2
    },
    rare: {
        id: 'rare',
        label: 'Rare',
        emoji: '🔵',
        duplicateTickets: 3
    },
    epic: {
        id: 'epic',
        label: 'Epic',
        emoji: '🟣',
        duplicateTickets: 5
    },
    legendary: {
        id: 'legendary',
        label: 'Legendary (JACKPOT)',
        emoji: '🟡',
        duplicateTickets: 10
    }
};

const DUPLICATE_TICKET_YIELD = {
    common: 1,
    uncommon: 2,
    rare: 3,
    epic: 5,
    legendary: 10
};

const GACHA_TITLES = [
    {
        id: 'gacha_title_bocah_hoki',
        titleValue: '🎰 Bocah Hoki',
        name: 'Gelar: 🎰 Bocah Hoki',
        emoji: '🎰',
        tierId: 'warung',
        description: 'Gelar eksklusif pemenang Jackpot Mesin Kapsul Pojok Warung.'
    },
    {
        id: 'gacha_title_tangan_wangi',
        titleValue: '✨ Tangan Wangi',
        name: 'Gelar: ✨ Tangan Wangi',
        emoji: '✨',
        tierId: 'mall',
        description: 'Gelar eksklusif pemenang Jackpot Mystery Box Mall.'
    },
    {
        id: 'gacha_title_dewa_gacha',
        titleValue: '👑 Dewa Gacha',
        name: 'Gelar: 👑 Dewa Gacha',
        emoji: '👑',
        tierId: 'sultan',
        description: 'Gelar tertinggi pemenang Jackpot Brankas Eksklusif Sultan.'
    }
];

const GACHA_TITLE_MAP = new Map(GACHA_TITLES.map(t => [t.id, t]));

const GACHA_TIERS = [
    // ==========================================
    // TIER 1: KAPSUL POJOK WARUNG (Lp 25.000)
    // Total Bobot = 100.0 (Common 55%, Uncommon 27%, Rare 13%, Epic 4%, Legendary 1%)
    // ==========================================
    {
        id: 'warung',
        order: 1,
        name: 'Kapsul Pojok Warung',
        shortName: 'Kapsul Warung',
        emoji: '🪙',
        priceLp: 25000,
        ticketItemId: 'tiket_gacha_warung',
        accentColor: COLORS.SUCCESS,
        description: 'Mesin kapsul koin di depan minimarket. Berisi bekal harian, umpan, alat kerja dasar, hingga Sepeda Onthel & Gelar Bocah Hoki!',
        lootTable: [
            // Common (55%)
            { id: 'w_nasi_bungkus', type: 'item', itemId: 'nasi_bungkus', qty: 2, rarity: 'common', weight: 16 },
            { id: 'w_kopi', type: 'item', itemId: 'kopi', qty: 3, rarity: 'common', weight: 14 },
            { id: 'w_umpan_cacing', type: 'item', itemId: 'umpan_cacing', qty: 15, rarity: 'common', weight: 13 },
            { id: 'w_es_buah', type: 'item', itemId: 'es_buah', qty: 2, rarity: 'common', weight: 12 },

            // Uncommon (27%)
            { id: 'w_nasi_padang', type: 'item', itemId: 'nasi_padang', qty: 2, rarity: 'uncommon', weight: 10 },
            { id: 'w_energy_drink', type: 'item', itemId: 'energy_drink', qty: 2, rarity: 'uncommon', weight: 9 },
            { id: 'w_umpan_udang', type: 'item', itemId: 'umpan_udang', qty: 10, rarity: 'uncommon', weight: 8 },

            // Rare (13%)
            { id: 'w_pancing_bambu', type: 'item', itemId: 'pancing_bambu', qty: 1, rarity: 'rare', weight: 4.5 },
            { id: 'w_beliung_batu', type: 'item', itemId: 'beliung_batu', qty: 1, rarity: 'rare', weight: 4.5 },
            { id: 'w_gas_lpg', type: 'item', itemId: 'gas_lpg', qty: 1, rarity: 'rare', weight: 4.0 },

            // Epic (4%)
            { id: 'w_helm_tambang', type: 'item', itemId: 'helm_tambang', qty: 1, rarity: 'epic', weight: 1.5 },
            { id: 'w_cooler_box', type: 'item', itemId: 'cooler_box', qty: 1, rarity: 'epic', weight: 1.5 },
            { id: 'w_tiket_mall', type: 'item', itemId: 'tiket_gacha_mall', qty: 1, rarity: 'epic', weight: 1.0 },

            // Legendary (1%)
            { id: 'w_veh_sepeda', type: 'vehicle', vehicleId: 'sepeda', qty: 1, rarity: 'legendary', weight: 0.5 },
            { id: 'w_title_hoki', type: 'title', titleId: 'gacha_title_bocah_hoki', qty: 1, rarity: 'legendary', weight: 0.5 }
        ]
    },

    // ==========================================
    // TIER 2: MYSTERY BOX MALL (Lp 250.000)
    // Total Bobot = 100.0 (Common 52%, Uncommon 28%, Rare 14%, Epic 5%, Legendary 1%)
    // ==========================================
    {
        id: 'mall',
        order: 2,
        name: 'Mystery Box Mall',
        shortName: 'Box Mall',
        emoji: '📦',
        priceLp: 250000,
        ticketItemId: 'tiket_gacha_mall',
        accentColor: COLORS.PRIMARY,
        description: 'Kotak kejutan premium dari atrium Mall Kota. Berpeluang mendapatkan Kopi Luwak Emas, alat kerja Carbon/Baja, hingga Vespa Klasik Antik!',
        lootTable: [
            // Common (52%)
            { id: 'm_steak_wagyu', type: 'item', itemId: 'steak_wagyu', qty: 2, rarity: 'common', weight: 18 },
            { id: 'm_kotak_p3k', type: 'item', itemId: 'kotak_p3k', qty: 2, rarity: 'common', weight: 17 },
            { id: 'm_umpan_pro', type: 'item', itemId: 'umpan_pro', qty: 15, rarity: 'common', weight: 17 },

            // Uncommon (28%)
            { id: 'm_seafood_platter', type: 'item', itemId: 'seafood_platter', qty: 2, rarity: 'uncommon', weight: 10 },
            { id: 'm_pancing_fiber', type: 'item', itemId: 'pancing_fiberglass', qty: 1, rarity: 'uncommon', weight: 9 },
            { id: 'm_beliung_besi', type: 'item', itemId: 'beliung_besi', qty: 1, rarity: 'uncommon', weight: 9 },

            // Rare (14%)
            { id: 'm_kopi_luwak', type: 'item', itemId: 'kopi_luwak_emas', qty: 2, rarity: 'rare', weight: 5 },
            { id: 'm_sim_c', type: 'item', itemId: 'sim_c', qty: 1, rarity: 'rare', weight: 4.5 },
            { id: 'm_sim_a', type: 'item', itemId: 'sim_a', qty: 1, rarity: 'rare', weight: 4.5 },

            // Epic (5%)
            { id: 'm_pancing_carbon', type: 'item', itemId: 'pancing_carbon', qty: 1, rarity: 'epic', weight: 1.8 },
            { id: 'm_beliung_baja', type: 'item', itemId: 'beliung_baja', qty: 1, rarity: 'epic', weight: 1.8 },
            { id: 'm_tiket_sultan', type: 'item', itemId: 'tiket_gacha_sultan', qty: 1, rarity: 'epic', weight: 1.4 },

            // Legendary (1%)
            { id: 'm_veh_vespa', type: 'vehicle', vehicleId: 'vespa_klasik', qty: 1, rarity: 'legendary', weight: 0.5 },
            { id: 'm_title_wangi', type: 'title', titleId: 'gacha_title_tangan_wangi', qty: 1, rarity: 'legendary', weight: 0.5 }
        ]
    },

    // ==========================================
    // TIER 3: BRANKAS EKSKLUSIF SULTAN (Lp 2.500.000)
    // Total Bobot = 100.0 (Common 50%, Uncommon 28%, Rare 15%, Epic 5.5%, Legendary 1.5%)
    // ==========================================
    {
        id: 'sultan',
        order: 3,
        name: 'Brankas Eksklusif Sultan',
        shortName: 'Brankas Sultan',
        emoji: '💎',
        priceLp: 2500000,
        ticketItemId: 'tiket_gacha_sultan',
        accentColor: COLORS.GOLD,
        description: 'Brankas lapis baja khusus kaum elit! Menyimpan Eliksir Stamina Sultan, Pancingan Emas, Beliung Meteorit, dan Supercar Sport Sultan!',
        lootTable: [
            // Common (50%)
            { id: 's_kopi_luwak', type: 'item', itemId: 'kopi_luwak_emas', qty: 4, rarity: 'common', weight: 18 },
            { id: 's_seafood_platter', type: 'item', itemId: 'seafood_platter', qty: 5, rarity: 'common', weight: 16 },
            { id: 's_steak_wagyu', type: 'item', itemId: 'steak_wagyu', qty: 6, rarity: 'common', weight: 16 },

            // Uncommon (28%)
            { id: 's_eliksir', type: 'item', itemId: 'eliksir_sultan', qty: 2, rarity: 'uncommon', weight: 10 },
            { id: 's_surat_nama', type: 'item', itemId: 'surat_ganti_nama', qty: 1, rarity: 'uncommon', weight: 9 },
            { id: 's_laptop', type: 'item', itemId: 'laptop', qty: 1, rarity: 'uncommon', weight: 9 },

            // Rare (15%)
            { id: 's_pancing_pro', type: 'item', itemId: 'pancing_pro', qty: 1, rarity: 'rare', weight: 5 },
            { id: 's_beliung_titanium', type: 'item', itemId: 'beliung_titanium', qty: 1, rarity: 'rare', weight: 5 },
            { id: 's_eliksir_pack', type: 'item', itemId: 'eliksir_sultan', qty: 4, rarity: 'rare', weight: 5 },

            // Epic (5.5%)
            { id: 's_pancing_emas', type: 'item', itemId: 'pancing_emas_sultan', qty: 1, rarity: 'epic', weight: 2.0 },
            { id: 's_beliung_meteorit', type: 'item', itemId: 'beliung_meteorit', qty: 1, rarity: 'epic', weight: 2.0 },
            { id: 's_veh_motor_baru', type: 'vehicle', vehicleId: 'motor_baru', qty: 1, rarity: 'epic', weight: 1.5 },

            // Legendary (1.5%)
            { id: 's_veh_mobil_sport', type: 'vehicle', vehicleId: 'mobil_sport', qty: 1, rarity: 'legendary', weight: 0.75 },
            { id: 's_title_dewa', type: 'title', titleId: 'gacha_title_dewa_gacha', qty: 1, rarity: 'legendary', weight: 0.75 }
        ]
    }
];

const TIER_MAP = new Map(GACHA_TIERS.map(t => [t.id, t]));

const ACTIVITY_TICKET_DROPS = {
    work: {
        warungChance: 0.08,
        highTierMallChance: 0.02
    },
    fishing: {
        warungChance: 0.05
    },
    mining: {
        warungChance: 0.05
    },
    bin: {
        warungChance: 0.04
    },
    farm: {
        warungChance: 0.05
    }
};

function getGachaTier(tierId) {
    if (!tierId) return GACHA_TIERS[0];
    return TIER_MAP.get(String(tierId).toLowerCase()) || GACHA_TIERS[0];
}

function getAllGachaTiers() {
    return GACHA_TIERS;
}

function getGachaTitle(titleId) {
    if (!titleId) return null;
    return GACHA_TITLE_MAP.get(String(titleId).toLowerCase()) || null;
}

function getDuplicateTicketCount(rarity) {
    return DUPLICATE_TICKET_YIELD[String(rarity || 'common').toLowerCase()] || 1;
}

function isRareOrAbove(rarity) {
    const idx = RARITY_ORDER.indexOf(String(rarity || '').toLowerCase());
    return idx >= RARITY_ORDER.indexOf('rare');
}

/**
 * Mengundi 1 hadiah dari tabel loot mesin gacha.
 * Jika minRarity ditentukan (misal 'rare' untuk jaminan pull ke-10),
 * hanya mengundi dari kandidat dengan rarity >= minRarity.
 */
function rollGachaEntry(tierOrId, minRarity = null, rollFn = Math.random) {
    const tier = typeof tierOrId === 'string' ? getGachaTier(tierOrId) : tierOrId;
    const minIdx = minRarity ? RARITY_ORDER.indexOf(String(minRarity).toLowerCase()) : 0;

    const candidates = tier.lootTable.filter(
        entry => RARITY_ORDER.indexOf(entry.rarity) >= Math.max(0, minIdx)
    );
    const pool = candidates.length > 0 ? candidates : tier.lootTable;

    const totalWeight = pool.reduce((sum, e) => sum + Number(e.weight || 0), 0);
    let roll = Math.max(0, Math.min(0.999999, Number(rollFn()))) * totalWeight;

    for (const entry of pool) {
        roll -= Number(entry.weight || 0);
        if (roll <= 0) {
            return entry;
        }
    }
    return pool[pool.length - 1];
}

module.exports = {
    RARITY_ORDER,
    RARITY_META,
    DUPLICATE_TICKET_YIELD,
    GACHA_TITLES,
    GACHA_TIERS,
    ACTIVITY_TICKET_DROPS,
    getGachaTier,
    getAllGachaTiers,
    getGachaTitle,
    getDuplicateTicketCount,
    isRareOrAbove,
    rollGachaEntry
};
