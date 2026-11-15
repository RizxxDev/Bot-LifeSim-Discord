/**
 * Katalog Lengkap Properti Modular Sandbox:
 * - Tier Ukuran Kavling (3x3 s/d 8x8) & aturan kepemilikan progresif
 * - Material Struktur & batas ketahanan lantai (-1 Basement s/d 6 Rooftop)
 * - Modul Ruangan (Hunian, Usaha, Produksi, Bebas/Kreatif)
 * - Tema Arsitektur & Template Blueprint Starter
 * - Parser Kuas Area (A1:C3 / B2 2x2)
 */

const LAND_TIERS = [
    {
        id: 'mini_3x3',
        order: 1,
        name: 'Kavling Mini (3×3)',
        shortName: '3×3 Mini',
        emoji: '🟦',
        width: 3,
        height: 3,
        totalCells: 9,
        priceMult: 1.0,
        permitFee: 0,
        description: 'Kavling ringkas 9 petak untuk pos tambang, warung kecil, atau rumah pemula.'
    },
    {
        id: 'standar_4x4',
        order: 2,
        name: 'Kavling Standar (4×4)',
        shortName: '4×4 Standar',
        emoji: '🟩',
        width: 4,
        height: 4,
        totalCells: 16,
        priceMult: 1.75,
        permitFee: 2500000,
        description: 'Kavling ideal 16 petak untuk rumah keluarga, garasi, atau ruko kecil.'
    },
    {
        id: 'luas_6x6',
        order: 3,
        name: 'Kavling Luas (6×6)',
        shortName: '6×6 Luas',
        emoji: '🟨',
        width: 6,
        height: 6,
        totalCells: 36,
        priceMult: 3.8,
        permitFee: 10000000,
        description: 'Lahan lega 36 petak untuk kompleks kos, kafe besar, atau pabrik workshop.'
    },
    {
        id: 'estate_8x8',
        order: 4,
        name: 'Kavling Estate (8×8)',
        shortName: '8×8 Estate',
        emoji: '🟪',
        width: 8,
        height: 8,
        totalCells: 64,
        priceMult: 7.5,
        permitFee: 30000000,
        description: 'Lahan mega 64 petak untuk mansion sultan, mal terpadu, atau kawasan industri.'
    },
    {
        id: 'mega_10x10',
        order: 5,
        name: 'Kavling XL Imperium (10×10)',
        shortName: '10×10 XL',
        emoji: '🟨',
        width: 10,
        height: 10,
        totalCells: 100,
        priceMult: 11.5,
        permitFee: 50000000,
        description: 'Kavling langka 100 petak (tapak 10×10) untuk istana, menara kembar, dan plaza kota.'
    }
];

const LAND_TIER_MAP = new Map(LAND_TIERS.map(t => [t.id, t]));
LAND_TIER_MAP.set('s', LAND_TIERS[1]);
LAND_TIER_MAP.set('m', LAND_TIERS[2]);
LAND_TIER_MAP.set('l', LAND_TIERS[3]);
LAND_TIER_MAP.set('xl', LAND_TIERS[4]);

function getLandTier(tierId) {
    return LAND_TIER_MAP.get(String(tierId || 'mini_3x3').toLowerCase()) || LAND_TIERS[0];
}

function getNextLandTier(currentTierId) {
    const cur = getLandTier(currentTierId);
    return LAND_TIERS.find(t => t.order === cur.order + 1) || null;
}

function getMaxLandLimit(totalSkillLevel = 0) {
    const bonus = Math.floor(Math.max(0, Number(totalSkillLevel) || 0) / 25);
    return Math.min(6, 3 + bonus);
}

function getProgressivePbbMultiplier(landOrdinalIndex = 0) {
    if (landOrdinalIndex <= 0) return 1.0;
    if (landOrdinalIndex === 1) return 1.35;
    if (landOrdinalIndex === 2) return 1.75;
    return 2.25;
}

const FLOOR_LABELS = {
    [-1]: 'Basement (B1)',
    1: 'Lantai 1 (Dasar)',
    2: 'Lantai 2',
    3: 'Lantai 3',
    4: 'Lantai 4',
    5: 'Lantai 5',
    6: 'Lantai 6'
};

function getFloorLabel(floorLevel) {
    const fl = Number(floorLevel);
    if (FLOOR_LABELS[fl]) return FLOOR_LABELS[fl];
    return fl < 0 ? `Basement B${Math.abs(fl)}` : `Lantai ${fl}`;
}

const STRUCTURAL_MATERIALS = [
    {
        id: 'bambu',
        name: 'Bambu & Kayu Darurat',
        shortName: 'Bambu',
        emoji: '🎋',
        maxFloor: 1,
        safeFloorHeight: 1,
        dailyWearRate: 4.5,
        allowBasement: false,
        allowHeavyTech: false,
        pbbWeight: 0.5,
        comfortBonus: 0,
        prestigeBonus: 0,
        appraisalValuePerCell: 180000,
        buildTimePerCellSec: 45,
        maintenanceCost: 5000,
        colorHex: '#a3a86b',
        costPerCell: { bambu: 3, kayu_bulat: 1 },
        description: 'Tinggi ideal 1 lt (Aus 4.5%/hr). Membangun >1 lt mempercepat pelapukan!'
    },
    {
        id: 'kayu',
        name: 'Kayu Olahan',
        shortName: 'Kayu',
        emoji: '🪵',
        maxFloor: 2,
        safeFloorHeight: 2,
        dailyWearRate: 2.8,
        allowBasement: false,
        allowHeavyTech: true,
        pbbWeight: 0.8,
        comfortBonus: 3,
        prestigeBonus: 2,
        appraisalValuePerCell: 420000,
        buildTimePerCellSec: 75,
        maintenanceCost: 12000,
        colorHex: '#b47b48',
        costPerCell: { papan_kayu: 3, semen: 1 },
        description: 'Tinggi ideal 2 lt (Aus 2.8%/hr). Hangat & mendukung modul rumah tangga.'
    },
    {
        id: 'bata',
        name: 'Batu Bata Kokoh',
        shortName: 'Bata',
        emoji: '🧱',
        maxFloor: 3,
        safeFloorHeight: 3,
        dailyWearRate: 1.6,
        allowBasement: false,
        allowHeavyTech: true,
        pbbWeight: 1.0,
        comfortBonus: 5,
        prestigeBonus: 4,
        appraisalValuePerCell: 850000,
        buildTimePerCellSec: 110,
        maintenanceCost: 20000,
        colorHex: '#c45b43',
        costPerCell: { batu_bata: 4, semen: 2 },
        description: 'Tinggi ideal 3 lt (Aus 1.6%/hr). Seimbang untuk rumah tinggal, kos & ruko.'
    },
    {
        id: 'beton',
        name: 'Beton Bertulang',
        shortName: 'Beton',
        emoji: '🏗️',
        maxFloor: 5,
        safeFloorHeight: 5,
        dailyWearRate: 0.9,
        allowBasement: true,
        allowHeavyTech: true,
        pbbWeight: 1.35,
        comfortBonus: 6,
        prestigeBonus: 7,
        appraisalValuePerCell: 1550000,
        buildTimePerCellSec: 150,
        maintenanceCost: 35000,
        colorHex: '#8b949e',
        costPerCell: { beton_cor: 3, semen: 1, rangka_baja: 1 },
        description: 'Tinggi ideal 5 lt + Basement B1 (Aus 0.9%/hr). Kokoh untuk ruko & gudang.'
    },
    {
        id: 'baja',
        name: 'Rangka Baja Struktural',
        shortName: 'Baja',
        emoji: '🔩',
        maxFloor: 12,
        safeFloorHeight: 12,
        dailyWearRate: 0.5,
        allowBasement: true,
        allowHeavyTech: true,
        pbbWeight: 1.7,
        comfortBonus: 7,
        prestigeBonus: 12,
        appraisalValuePerCell: 2600000,
        buildTimePerCellSec: 200,
        maintenanceCost: 55000,
        colorHex: '#475569',
        costPerCell: { rangka_baja: 3, beton_cor: 2, kaca_panel: 1 },
        description: 'Tinggi ideal 12+ lt + Basement B1 (Aus 0.5%/hr). Pencakar langit super kokoh.'
    },
    {
        id: 'kaca',
        name: 'Kaca Tempered Modern',
        shortName: 'Kaca',
        emoji: '🪟',
        maxFloor: 10,
        safeFloorHeight: 10,
        dailyWearRate: 0.8,
        allowBasement: false,
        allowHeavyTech: true,
        pbbWeight: 1.6,
        comfortBonus: 10,
        prestigeBonus: 14,
        appraisalValuePerCell: 2400000,
        buildTimePerCellSec: 180,
        maintenanceCost: 50000,
        colorHex: '#38bdf8',
        costPerCell: { kaca_panel: 3, rangka_baja: 2 },
        description: 'Fasad modern ideal 10 lt (Aus 0.8%/hr). Bonus daya tarik & pencahayaan.'
    },
    {
        id: 'marmer',
        name: 'Finishing Marmer Mewah',
        shortName: 'Marmer',
        emoji: '🏛️',
        maxFloor: 10,
        safeFloorHeight: 10,
        dailyWearRate: 0.4,
        allowBasement: true,
        allowHeavyTech: true,
        pbbWeight: 2.2,
        comfortBonus: 14,
        prestigeBonus: 22,
        appraisalValuePerCell: 4200000,
        buildTimePerCellSec: 240,
        maintenanceCost: 85000,
        colorHex: '#e2e8f0',
        costPerCell: { marmer: 2, beton_cor: 2, kaca_panel: 1 },
        description: 'Material sultan ideal 10 lt + B1 (Aus 0.4%/hr). Prestise & ketahanan puncak.'
    }
];

const MATERIAL_MAP = new Map(STRUCTURAL_MATERIALS.map(m => [m.id, m]));

function getStructuralMaterial(materialId) {
    return MATERIAL_MAP.get(String(materialId || 'kayu').toLowerCase()) || STRUCTURAL_MATERIALS[1];
}

const MODULE_CATEGORIES = [
    { id: 'housing', name: 'Hunian & Hidup', emoji: '🏠' },
    { id: 'business', name: 'Usaha & Komersial', emoji: '🏪' },
    { id: 'production', name: 'Produksi & Workshop', emoji: '🏭' },
    { id: 'custom', name: 'Aula Bebas & Kreatif', emoji: '🏛️' },
    { id: 'shape', name: 'Blok Bentuk & Struktur', emoji: '🧱' },
    { id: 'roof', name: 'Model Atap Arsitektur', emoji: '⛺' }
];

const BUILDING_MODULES = [
    // --- HUNIAN & HIDUP ---
    {
        id: 'bedroom_std',
        category: 'housing',
        name: 'Kamar Tidur Standar',
        shortLabel: 'Kamar',
        emoji: '🛏️',
        defaultColor: '#818cf8',
        requiresHeavyTech: false,
        outdoorOnly: false,
        extraCostPerCell: { papan_kayu: 1 },
        appraisalPerCell: 250000,
        stats: { sleepEnergyBase: 70, sleepDurationSec: 3300, passiveRegenPerZone: 0.5, comfort: 4 },
        description: 'Ruang istirahat nyaman (+70 Energy tidur, +0.5 regen/jam).'
    },
    {
        id: 'bedroom_lux',
        category: 'housing',
        name: 'Suite Tidur Mewah',
        shortLabel: 'Suite',
        emoji: '👑',
        defaultColor: '#6366f1',
        requiresHeavyTech: true,
        outdoorOnly: false,
        extraCostPerCell: { papan_kayu: 2, kit_utilitas: 1, kaca_panel: 1 },
        appraisalPerCell: 900000,
        stats: { sleepEnergyBase: 95, sleepDurationSec: 2700, passiveRegenPerZone: 1.5, comfort: 10, prestige: 6 },
        description: 'Kamar VIP ber-AC (+95 s/d +100 Energy tidur dalam 45m, +1.5 regen/jam).'
    },
    {
        id: 'kitchen_basic',
        category: 'housing',
        name: 'Dapur Rumah',
        shortLabel: 'Dapur',
        emoji: '🍳',
        defaultColor: '#fbbf24',
        requiresHeavyTech: false,
        outdoorOnly: false,
        extraCostPerCell: { batu_bata: 1, papan_kayu: 1 },
        appraisalPerCell: 220000,
        stats: { stovePerZone: 1, comfort: 2 },
        description: 'Menambah +1 tungku memasak (/cook) untuk zona ini.'
    },
    {
        id: 'kitchen_pro',
        category: 'housing',
        name: 'Dapur Profesional',
        shortLabel: 'DapurPro',
        emoji: '👨‍🍳',
        defaultColor: '#f59e0b',
        requiresHeavyTech: true,
        outdoorOnly: false,
        extraCostPerCell: { kit_utilitas: 1, marmer: 1 },
        appraisalPerCell: 850000,
        stats: { stovePerZone: 2, comfort: 5, prestige: 4 },
        description: 'Dapur lengkap berizin komersial (+2 tungku memasak /cook).'
    },
    {
        id: 'fridge_room',
        category: 'housing',
        name: 'Ruang Pendingin (Kulkas)',
        shortLabel: 'Kulkas',
        emoji: '🧊',
        defaultColor: '#22d3ee',
        requiresHeavyTech: true,
        outdoorOnly: false,
        extraCostPerCell: { kit_utilitas: 1, seng_daur: 1 },
        appraisalPerCell: 420000,
        stats: { kulkasPerCell: 25, comfort: 1 },
        description: 'Menambah +25 slot Kulkas per petak (basi melambat 3×).'
    },
    {
        id: 'freezer_room',
        category: 'housing',
        name: 'Ruang Pembeku (Freezer)',
        shortLabel: 'Freezer',
        emoji: '❄️',
        defaultColor: '#0284c7',
        requiresHeavyTech: true,
        outdoorOnly: false,
        extraCostPerCell: { kit_utilitas: 2, rangka_baja: 1 },
        appraisalPerCell: 720000,
        stats: { freezerPerCell: 30, comfort: 2 },
        description: 'Menambah +30 slot Freezer per petak (bahan beku tahan selamanya!).'
    },
    {
        id: 'warehouse_cell',
        category: 'housing',
        name: 'Ruang Gudang Logistik',
        shortLabel: 'Gudang',
        emoji: '📦',
        defaultColor: '#a8a29e',
        requiresHeavyTech: false,
        outdoorOnly: false,
        extraCostPerCell: { papan_kayu: 2, seng_daur: 1 },
        appraisalPerCell: 300000,
        stats: { gudangPerCell: 25 },
        description: 'Menambah +25 slot Gudang per petak (bonus +20% di Pelabuhan Tanjung Barat).'
    },
    {
        id: 'garage',
        category: 'housing',
        name: 'Garasi & Parkiran',
        shortLabel: 'Garasi',
        emoji: '🚗',
        defaultColor: '#64748b',
        requiresHeavyTech: false,
        outdoorOnly: false,
        extraCostPerCell: { semen: 2, rangka_baja: 1 },
        appraisalPerCell: 480000,
        stats: { garageSlotsPerCell: 1, fuelDiscountPct: 5, comfort: 3 },
        description: 'Menambah slot garasi & diskon perawatan/bensin kendaraan lokal (-5%/petak).'
    },
    {
        id: 'garden',
        category: 'housing',
        name: 'Taman & Halaman Hijau',
        shortLabel: 'Taman',
        emoji: '🌿',
        defaultColor: '#22c55e',
        requiresHeavyTech: false,
        outdoorOnly: false,
        extraCostPerCell: { tanah_liat: 1, bambu: 1 },
        appraisalPerCell: 180000,
        stats: { comfort: 6, farmYieldBonusPct: 3 },
        description: 'Ruang terbuka hijau (+6 Comfort, +3% hasil panen lokal).'
    },
    {
        id: 'pool',
        category: 'housing',
        name: 'Kolam Renang Pribadi',
        shortLabel: 'Kolam',
        emoji: '🏊',
        defaultColor: '#38bdf8',
        requiresHeavyTech: true,
        outdoorOnly: false,
        extraCostPerCell: { semen: 2, kaca_panel: 1, kit_utilitas: 1 },
        appraisalPerCell: 950000,
        stats: { comfort: 12, prestige: 8 },
        description: 'Fasilitas mewah penambah Comfort (+12) & nilai appraisal bangunan.'
    },
    {
        id: 'lounge',
        category: 'housing',
        name: 'Ruang Keluarga / Santai',
        shortLabel: 'Lounge',
        emoji: '🛋️',
        defaultColor: '#c084fc',
        requiresHeavyTech: false,
        outdoorOnly: false,
        extraCostPerCell: { papan_kayu: 2 },
        appraisalPerCell: 280000,
        stats: { comfort: 7, passiveRegenPerZone: 0.5, prestige: 3 },
        description: 'Ruang berkumpul hangat (+7 Comfort, +0.5 regen/jam).'
    },
    {
        id: 'greenhouse',
        category: 'housing',
        name: 'Greenhouse Kaca',
        shortLabel: 'GreenH',
        emoji: '🏡',
        defaultColor: '#10b981',
        requiresHeavyTech: false,
        outdoorOnly: false,
        extraCostPerCell: { kaca_panel: 2, papan_kayu: 1 },
        appraisalPerCell: 550000,
        stats: { comfort: 5, farmYieldBonusPct: 6 },
        description: 'Rumah kaca tanaman (+6% bonus hasil /farm per petak).'
    },

    // --- USAHA & KOMERSIAL ---
    {
        id: 'shop_stall',
        category: 'business',
        name: 'Lapak Warung / Toko',
        shortLabel: 'Warung',
        emoji: '🏪',
        defaultColor: '#ec4899',
        requiresHeavyTech: false,
        outdoorOnly: false,
        extraCostPerCell: { papan_kayu: 2, kaca_panel: 1 },
        appraisalPerCell: 500000,
        stats: { businessType: 'shop', businessSlots: 10, appeal: 8, comfort: 2 },
        description: 'Etalase jualan barang/minuman ke NPC secara bertahap dari stok yang disetor.'
    },
    {
        id: 'cafe_area',
        category: 'business',
        name: 'Area Kafe & Resto',
        shortLabel: 'Kafe',
        emoji: '☕',
        defaultColor: '#f97316',
        requiresHeavyTech: true,
        outdoorOnly: false,
        extraCostPerCell: { kit_utilitas: 1, kaca_panel: 1, papan_kayu: 1 },
        appraisalPerCell: 920000,
        stats: { businessType: 'cafe', businessSlots: 12, stovePerZone: 1, appeal: 14, prestige: 5 },
        description: 'Kafe modern pemajang masakan untuk pelanggan NPC (+1 tungku, +14 Daya Tarik).'
    },
    {
        id: 'rental_room',
        category: 'business',
        name: 'Kamar Kos Sewaan',
        shortLabel: 'KosSewa',
        emoji: '🚪',
        defaultColor: '#14b8a6',
        requiresHeavyTech: false,
        outdoorOnly: false,
        extraCostPerCell: { papan_kayu: 1, batu_bata: 1 },
        appraisalPerCell: 420000,
        stats: { businessType: 'rental', rentalUnitsPerZone: 1, appeal: 6, comfort: 3 },
        description: 'Setiap zona Kamar Kos bisa disewakan ke NPC (jika Kondisi >=60%) atau pemain lain (P2P).'
    },
    {
        id: 'service_bay',
        category: 'business',
        name: 'Bengkel & Kios Jasa',
        shortLabel: 'Bengkel',
        emoji: '🔧',
        defaultColor: '#ef4444',
        requiresHeavyTech: true,
        outdoorOnly: false,
        extraCostPerCell: { rangka_baja: 1, kit_utilitas: 1 },
        appraisalPerCell: 780000,
        stats: { businessType: 'service', fuelDiscountPct: 8, appeal: 10, prestige: 4 },
        description: 'Unit bengkel komersial: diskon perawatan pribadi & pemasukan jasa servis.'
    },

    // --- PRODUKSI & WORKSHOP ---
    {
        id: 'kiln_station',
        category: 'production',
        name: 'Tungku Pembakaran (Kiln)',
        shortLabel: 'Kiln',
        emoji: '🔥',
        defaultColor: '#dc2626',
        requiresHeavyTech: false,
        outdoorOnly: false,
        extraCostPerCell: { batu_bata: 3, batu_kapur: 2 },
        appraisalPerCell: 480000,
        stats: { workshopStations: ['kiln'], appeal: 1 },
        description: 'Mengolah tanah liat -> batu bata, batu kapur -> semen, kuarsa -> panel kaca.'
    },
    {
        id: 'sawmill_station',
        category: 'production',
        name: 'Penggergajian Kayu (Sawmill)',
        shortLabel: 'Sawmill',
        emoji: '🪚',
        defaultColor: '#ca8a04',
        requiresHeavyTech: true,
        outdoorOnly: false,
        extraCostPerCell: { rangka_baja: 1, kit_utilitas: 1, papan_kayu: 1 },
        appraisalPerCell: 650000,
        stats: { workshopStations: ['sawmill'], appeal: 1 },
        description: 'Mengolah kayu gelondongan -> papan kayu & komponen bambu.'
    },
    {
        id: 'smelter_station',
        category: 'production',
        name: 'Pabrik Baja (Smelter)',
        shortLabel: 'Smelter',
        emoji: '🏭',
        defaultColor: '#334155',
        requiresHeavyTech: true,
        outdoorOnly: false,
        extraCostPerCell: { rangka_baja: 2, beton_cor: 1, kit_utilitas: 1 },
        appraisalPerCell: 1150000,
        stats: { workshopStations: ['smelter'], appeal: 1 },
        description: 'Melebur bijih besi -> rangka baja, tembaga -> kit utilitas, beton cor & marmer.'
    },
    {
        id: 'workbench',
        category: 'production',
        name: 'Meja Rakit (Workbench)',
        shortLabel: 'Rakit',
        emoji: '🛠️',
        defaultColor: '#d97706',
        requiresHeavyTech: false,
        outdoorOnly: false,
        extraCostPerCell: { papan_kayu: 2, seng_daur: 1 },
        appraisalPerCell: 360000,
        stats: { workshopStations: ['workbench'], comfort: 1 },
        description: 'Mendaur ulang sampah besi/kardus menjadi seng & papan ekonomis.'
    },

    // --- EKSPRESI KREATIF / AULA BEBAS ---
    {
        id: 'hall_custom',
        category: 'custom',
        name: 'Aula / Ruang Bebas',
        shortLabel: 'Aula',
        emoji: '🏛️',
        defaultColor: '#a855f7',
        requiresHeavyTech: false,
        outdoorOnly: false,
        extraCostPerCell: { papan_kayu: 1, batu_bata: 1 },
        appraisalPerCell: 420000,
        stats: { comfort: 6, prestige: 8 },
        description: 'Ruang serbaguna bertema bebas (Mushola, Studio, Bunker, Dojo, dll).'
    },
    {
        id: 'rooftop',
        category: 'custom',
        name: 'Dek Rooftop / Taman Langit',
        shortLabel: 'Rooftop',
        emoji: '🌇',
        defaultColor: '#f43f5e',
        requiresHeavyTech: false,
        outdoorOnly: false,
        extraCostPerCell: { kaca_panel: 1, semen: 1 },
        appraisalPerCell: 680000,
        stats: { comfort: 10, prestige: 12, appeal: 8 },
        description: 'Dek terbuka pemandangan kota (+10 Comfort, +12 Prestise, +8 Daya Tarik).'
    },
    {
        id: 'monument',
        category: 'custom',
        name: 'Galeri Trofi / Monumen',
        shortLabel: 'Galeri',
        emoji: '🏆',
        defaultColor: '#eab308',
        requiresHeavyTech: false,
        outdoorOnly: false,
        extraCostPerCell: { marmer: 1, kuarsa: 1 },
        appraisalPerCell: 1250000,
        stats: { comfort: 8, prestige: 20, appeal: 6 },
        description: 'Ruang pajang koleksi prestise (+20 Prestise, menaikkan nilai jual properti).'
    }
];

const SHAPE_BLOCKS = [
    {
        id: 'wall_custom',
        category: 'shape',
        blockKind: 'shape',
        shapeVariant: 'solid',
        name: 'Blok Struktur Penuh',
        shortLabel: 'Dinding',
        emoji: '🧱',
        defaultColor: '#94a3b8',
        requiresHeavyTech: false,
        outdoorOnly: false,
        materialCostMult: 0.75,
        extraCostPerCell: {},
        appraisalPerCell: 220000,
        stats: { comfort: 1, prestige: 2, appeal: 2, architectureBonus: 2 },
        description: 'Blok arsitektur padat untuk menara, gapura, atau pembentuk siluet bebas.'
    },
    {
        id: 'glass_wall',
        category: 'shape',
        blockKind: 'shape',
        shapeVariant: 'glass',
        name: 'Fasad & Jembatan Kaca',
        shortLabel: 'Kaca',
        emoji: '🪟',
        defaultColor: '#38bdf8',
        requiresHeavyTech: false,
        outdoorOnly: false,
        materialCostMult: 0.85,
        extraCostPerCell: { kaca_panel: 1 },
        appraisalPerCell: 480000,
        stats: { comfort: 4, prestige: 6, appeal: 5, architectureBonus: 5 },
        description: 'Blok kaca transparan untuk fasad pencakar langit, atrium, atau skybridge.'
    },
    {
        id: 'pillar_block',
        category: 'shape',
        blockKind: 'shape',
        shapeVariant: 'pillar',
        name: 'Pilar / Tiang Penopang',
        shortLabel: 'Pilar',
        emoji: '🏛️',
        defaultColor: '#cbd5e1',
        requiresHeavyTech: false,
        outdoorOnly: false,
        materialCostMult: 0.55,
        extraCostPerCell: {},
        appraisalPerCell: 260000,
        stats: { comfort: 1, prestige: 4, appeal: 4, architectureBonus: 4 },
        description: 'Tiang kokoh (hemat bahan 45%) untuk menopang bangunan melayang, kanopi & gapura.'
    },
    {
        id: 'balcony_rail',
        category: 'shape',
        blockKind: 'shape',
        shapeVariant: 'balcony',
        name: 'Balkon & Pagar Teras',
        shortLabel: 'Balkon',
        emoji: '🪴',
        defaultColor: '#4ade80',
        requiresHeavyTech: false,
        outdoorOnly: false,
        materialCostMult: 0.45,
        extraCostPerCell: {},
        appraisalPerCell: 240000,
        stats: { comfort: 4, prestige: 3, appeal: 4, architectureBonus: 4 },
        description: 'Teras terbuka berpagar untuk overhang lantai atas, jembatan, dan sudut santai.'
    },
    {
        id: 'stairs_ext',
        category: 'shape',
        blockKind: 'shape',
        shapeVariant: 'stairs',
        name: 'Tangga & Koridor Luar',
        shortLabel: 'Tangga',
        emoji: '🪜',
        defaultColor: '#fbbf24',
        requiresHeavyTech: false,
        outdoorOnly: false,
        materialCostMult: 0.5,
        extraCostPerCell: {},
        appraisalPerCell: 200000,
        stats: { comfort: 2, prestige: 2, appeal: 3, architectureBonus: 3 },
        description: 'Penghubung estetis antar-tingkat untuk eksterior panggung maupun menara.'
    },
    {
        id: 'roof_flat',
        category: 'roof',
        blockKind: 'roof',
        shapeVariant: 'flat',
        name: 'Atap Dak Datar Minimalis',
        shortLabel: 'Dak',
        emoji: '⬛',
        defaultColor: '#475569',
        requiresHeavyTech: false,
        outdoorOnly: false,
        materialCostMult: 0.55,
        extraCostPerCell: {},
        appraisalPerCell: 220000,
        stats: { comfort: 1, prestige: 3, appeal: 3, architectureBonus: 3 },
        description: 'Atap datar modern yang juga dapat menopang blok dekorasi di atasnya.'
    },
    {
        id: 'roof_gable',
        category: 'roof',
        blockKind: 'roof',
        shapeVariant: 'gable',
        name: 'Atap Pelana Miring',
        shortLabel: 'Pelana',
        emoji: '⛺',
        defaultColor: '#b45309',
        requiresHeavyTech: false,
        outdoorOnly: false,
        materialCostMult: 0.65,
        extraCostPerCell: { tanah_liat: 1 },
        appraisalPerCell: 320000,
        stats: { comfort: 3, prestige: 5, appeal: 5, architectureBonus: 5 },
        description: 'Atap segitiga klasik tropis dengan genteng hangat.'
    },
    {
        id: 'roof_limas',
        category: 'roof',
        blockKind: 'roof',
        shapeVariant: 'limas',
        name: 'Atap Limas Perisai',
        shortLabel: 'Limas',
        emoji: '🏠',
        defaultColor: '#9a3412',
        requiresHeavyTech: false,
        outdoorOnly: false,
        materialCostMult: 0.7,
        extraCostPerCell: { tanah_liat: 1 },
        appraisalPerCell: 390000,
        stats: { comfort: 4, prestige: 6, appeal: 6, architectureBonus: 6 },
        description: 'Atap limas empat sisi simetris yang elegan untuk rumah & villa.'
    },
    {
        id: 'roof_joglo',
        category: 'roof',
        blockKind: 'roof',
        shapeVariant: 'joglo',
        name: 'Atap Joglo Nusantara',
        shortLabel: 'Joglo',
        emoji: '🏯',
        defaultColor: '#7c2d12',
        requiresHeavyTech: false,
        outdoorOnly: false,
        materialCostMult: 0.85,
        extraCostPerCell: { papan_kayu: 1, tanah_liat: 1 },
        appraisalPerCell: 550000,
        stats: { comfort: 6, prestige: 9, appeal: 8, architectureBonus: 8 },
        description: 'Atap pendopo bertingkat khas Nusantara dengan skor estetika tinggi.'
    },
    {
        id: 'roof_dome',
        category: 'roof',
        blockKind: 'roof',
        shapeVariant: 'dome',
        name: 'Atap Kubah Megah',
        shortLabel: 'Kubah',
        emoji: '🕌',
        defaultColor: '#0284c7',
        requiresHeavyTech: false,
        outdoorOnly: false,
        materialCostMult: 0.9,
        extraCostPerCell: { kaca_panel: 1 },
        appraisalPerCell: 680000,
        stats: { comfort: 5, prestige: 12, appeal: 9, architectureBonus: 9 },
        description: 'Kubah lengkung monumental untuk balai raya, galeri, atau istana.'
    },
    {
        id: 'roof_spire',
        category: 'roof',
        blockKind: 'roof',
        shapeVariant: 'spire',
        name: 'Puncak Menara Runcing',
        shortLabel: 'Spire',
        emoji: '🗼',
        defaultColor: '#facc15',
        requiresHeavyTech: false,
        outdoorOnly: false,
        materialCostMult: 0.8,
        extraCostPerCell: { rangka_baja: 1 },
        appraisalPerCell: 620000,
        stats: { comfort: 2, prestige: 11, appeal: 8, architectureBonus: 8 },
        description: 'Puncak runcing pencakar langit dan menara kastil ikonik.'
    }
];

const ALL_BUILDABLE_BLOCKS = [...BUILDING_MODULES, ...SHAPE_BLOCKS];
const MODULE_MAP = new Map(ALL_BUILDABLE_BLOCKS.map(m => [m.id, m]));

function getBuildingModule(moduleId) {
    return MODULE_MAP.get(String(moduleId || 'hall_custom').toLowerCase()) || BUILDING_MODULES[0];
}

function getModulesByCategory(categoryId) {
    return ALL_BUILDABLE_BLOCKS.filter(m => m.category === categoryId);
}

function getBlockKind(moduleId) {
    const m = getBuildingModule(moduleId);
    return m.blockKind || 'module';
}

const ARCHITECTURE_THEMES = [
    {
        id: 'minimalis',
        name: 'Minimalis Hangat',
        emoji: '🏡',
        bgHex: '#18181b',
        cardHex: '#27272a',
        gridBgHex: '#3f3f46',
        accentHex: '#38bdf8',
        roofHex: '#52525b',
        wallHex: '#e4e4e7'
    },
    {
        id: 'tropis_nusantara',
        name: 'Tropis Nusantara',
        emoji: '🌴',
        bgHex: '#14261c',
        cardHex: '#1c3829',
        gridBgHex: '#254a36',
        accentHex: '#4ade80',
        roofHex: '#92400e',
        wallHex: '#fde68a'
    },
    {
        id: 'modern_industri',
        name: 'Industrial Loft',
        emoji: '🏭',
        bgHex: '#111827',
        cardHex: '#1f2937',
        gridBgHex: '#374151',
        accentHex: '#f59e0b',
        roofHex: '#334155',
        wallHex: '#9ca3af'
    },
    {
        id: 'sultan_klasik',
        name: 'Sultan Klasik',
        emoji: '🏰',
        bgHex: '#1f1629',
        cardHex: '#2e1f3d',
        gridBgHex: '#3b284e',
        accentHex: '#facc15',
        roofHex: '#7e22ce',
        wallHex: '#fef08a'
    },
    {
        id: 'cyber_studio',
        name: 'Neon Cyber Studio',
        emoji: '🌆',
        bgHex: '#090d16',
        cardHex: '#131c31',
        gridBgHex: '#1e293b',
        accentHex: '#f43f5e',
        roofHex: '#0f172a',
        wallHex: '#cbd5e1'
    }
];

const THEME_MAP = new Map(ARCHITECTURE_THEMES.map(t => [t.id, t]));

function getArchitectureTheme(themeId) {
    return THEME_MAP.get(String(themeId || 'minimalis').toLowerCase()) || ARCHITECTURE_THEMES[0];
}

/**
 * Validasi penempatan material struktur pada lantai tertentu + modul tertentu.
 * Tinggi lantai kini bebas (N >= 1), namun melampaui safeFloorHeight menambah stres struktur.
 */
function validateCellPlacement(materialId, floorLevel, moduleId) {
    const mat = getStructuralMaterial(materialId);
    const mod = getBuildingModule(moduleId);
    const floor = Number(floorLevel);

    if (!Number.isInteger(floor) || floor < -1 || floor === 0 || floor > 100) {
        return { ok: false, error: `Lantai tidak valid (${floor}). Gunakan Basement (B1) atau Lantai 1–100.` };
    }
    if (floor === -1 && !mat.allowBasement) {
        return { ok: false, error: `Material **${mat.name}** tidak kuat untuk **Basement (B1)**. Gunakan minimal **Beton**, **Baja**, atau **Marmer**.` };
    }
    if (mod.requiresHeavyTech && !mat.allowHeavyTech) {
        return { ok: false, error: `Material **${mat.name}** tidak mendukung modul **${mod.name}** (perlu minimal **Kayu Olahan** atau lebih kuat).` };
    }

    const safeH = Number(mat.safeFloorHeight || mat.maxFloor || 1);
    const stressDelta = floor >= 1 ? Math.max(0, floor - safeH) : 0;
    return {
        ok: true,
        material: mat,
        module: mod,
        overSafeHeight: stressDelta > 0,
        stressDelta
    };
}

/**
 * Hitung stres struktural akibat bangunan tinggi atau material di bawah standar ketinggian.
 */
function calculateStructuralStress(rawCells = []) {
    const cells = rawCells || [];
    if (cells.length === 0) {
        return {
            maxFloor: 0,
            overHeightCells: 0,
            stressRatio: 0,
            dailyExtraDecay: 0,
            stormCollapseRiskPct: 0,
            statusLabel: 'Normal'
        };
    }

    let maxFloor = 1;
    let overHeightCells = 0;
    let totalStress = 0;
    let totalCells = 0;

    for (const raw of cells) {
        const fl = Number(raw.floor_level ?? raw.floor ?? 1);
        const mat = getStructuralMaterial(raw.material_id ?? raw.mat ?? 'kayu');
        if (fl >= 1) {
            if (fl > maxFloor) maxFloor = fl;
            const safeH = Number(mat.safeFloorHeight || mat.maxFloor || 1);
            totalCells += 1;
            if (fl > safeH) {
                overHeightCells += 1;
                const ratio = (fl - safeH) / Math.max(1, safeH);
                totalStress += ratio;
            }
        }
    }

    const stressRatio = totalCells > 0 ? Math.round((totalStress / totalCells) * 100) / 100 : 0;
    const dailyExtraDecay = Math.round(stressRatio * 3.5 * 100) / 100;
    const stormCollapseRiskPct = Math.min(75, Math.round(stressRatio * 22));
    let statusLabel = 'Kokoh Ideal';
    if (stressRatio >= 1.5) statusLabel = 'Kritis (Risiko Rubuh Tinggi!)';
    else if (stressRatio >= 0.6) statusLabel = 'Beban Berat (Cepat Aus)';
    else if (overHeightCells > 0) statusLabel = 'Agak Tegang';

    return {
        maxFloor,
        overHeightCells,
        stressRatio,
        dailyExtraDecay,
        stormCollapseRiskPct,
        statusLabel
    };
}

/**
 * Validasi penyangga Voxel 3D fleksibel:
 * - Lantai 1 dan B1 menempel tanah (sah otomatis).
 * - Lantai Z >= 2 sah jika ada blok tepat di (x, y, Z-1) ATAU terhubung jarak Manhattan <= 2
 *   pada lantai Z menuju sel lantai Z yang punya penyangga langsung dari Z-1.
 */
function validateVoxelSupport(rawCells = []) {
    const byFloor = new Map();
    for (const raw of rawCells || []) {
        const fl = Number(raw.floor_level ?? raw.floor ?? 1);
        const x = Number(raw.x);
        const y = Number(raw.y);
        const modId = raw.module_id ?? raw.mod ?? 'hall_custom';
        if (!byFloor.has(fl)) byFloor.set(fl, new Map());
        byFloor.get(fl).set(`${x}:${y}`, { x, y, floor: fl, moduleId: modId });
    }

    const upperFloors = [...byFloor.keys()].filter(fl => fl >= 2).sort((a, b) => a - b);
    const supportedKeysByFloor = new Map();

    // Lantai 1 selalu tersangga penuh ke tanah
    if (byFloor.has(1)) {
        supportedKeysByFloor.set(1, new Set(byFloor.get(1).keys()));
    } else {
        supportedKeysByFloor.set(1, new Set());
    }

    const unsupportedCells = [];
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (const fl of upperFloors) {
        const curMap = byFloor.get(fl);
        const prevMap = byFloor.get(fl - 1) || new Map();
        const prevSupported = supportedKeysByFloor.get(fl - 1) || new Set();

        const queue = [];
        const distMap = new Map();
        const curSupported = new Set();

        for (const [k, cell] of curMap.entries()) {
            const below = prevMap.get(k);
            // Puncak runcing spire tidak bisa menopang lantai penuh di atasnya, sel lain bisa
            if (below && prevSupported.has(k) && below.moduleId !== 'roof_spire') {
                distMap.set(k, 0);
                curSupported.add(k);
                queue.push(cell);
            }
        }

        // BFS hingga jarak 2 petak di lantai yang sama (memungkinkan overhang & jembatan 4 petak)
        let head = 0;
        while (head < queue.length) {
            const node = queue[head++];
            const d = distMap.get(`${node.x}:${node.y}`);
            if (d >= 2) continue;
            for (const [dx, dy] of DIRS) {
                const nk = `${node.x + dx}:${node.y + dy}`;
                if (!curMap.has(nk)) continue;
                const nextD = d + 1;
                if (!distMap.has(nk) || distMap.get(nk) > nextD) {
                    distMap.set(nk, nextD);
                    curSupported.add(nk);
                    queue.push(curMap.get(nk));
                }
            }
        }

        for (const [k, cell] of curMap.entries()) {
            if (!curSupported.has(k)) {
                unsupportedCells.push({
                    floor: fl,
                    x: cell.x,
                    y: cell.y,
                    coord: `${String.fromCharCode(65 + cell.x)}${cell.y + 1}`
                });
            }
        }
        supportedKeysByFloor.set(fl, curSupported);
    }

    if (unsupportedCells.length > 0) {
        const sample = unsupportedCells.slice(0, 4).map(c => `Lt.${c.floor} ${c.coord}`).join(', ');
        return {
            ok: false,
            unsupportedCells,
            error: `${unsupportedCells.length} blok melayang tanpa penyangga atau melampaui batas overhang 2 petak (${sample}). Tambah Pilar di lantai bawahnya!`
        };
    }
    return { ok: true, unsupportedCells: [], error: null };
}

/**
 * Parser kuas area cepat:
 * Mendukung:
 * - "A1" (1 petak)
 * - "A1:J10" / "B2-D4" (rentang persegi panjang)
 * - "B2 2x2" (titik awal + ukuran WxH)
 * - Awalan "TEPI A1:D4" / "FRAME A1:D4" (hanya bingkai pinggir)
 */
function parseGridAreaInput(rawInput, gridWidth, gridHeight) {
    let str = String(rawInput || '').trim().toUpperCase();
    if (!str) {
        return { ok: false, error: 'Koordinat tidak boleh kosong. Contoh: `A1:C3`, `TEPI A1:D4`, `B2 2x2`, atau `A1`.' };
    }

    let isHollowFrame = false;
    if (/^(TEPI|FRAME)\s+/.test(str)) {
        isHollowFrame = true;
        str = str.replace(/^(TEPI|FRAME)\s+/, '').trim();
    }

    const parseCoord = (token) => {
        const m = token.match(/^([A-J])(10|[1-9])$/);
        if (!m) return null;
        return {
            x: m[1].charCodeAt(0) - 65,
            y: Number(m[2]) - 1
        };
    };

    let x1; let y1; let x2; let y2;

    const sizeMatch = str.match(/^([A-J](?:10|[1-9]))\s+(\d+)\s*[X*×]\s*(\d+)$/);
    if (sizeMatch) {
        const start = parseCoord(sizeMatch[1]);
        const w = Number(sizeMatch[2]);
        const h = Number(sizeMatch[3]);
        if (!start || w < 1 || h < 1) {
            return { ok: false, error: 'Format ukuran kuas tidak valid. Contoh benar: `B2 2x2`.' };
        }
        x1 = start.x;
        y1 = start.y;
        x2 = start.x + w - 1;
        y2 = start.y + h - 1;
    } else if (/[:\-]/.test(str)) {
        const parts = str.split(/[:\-]/).map(s => s.trim());
        if (parts.length !== 2) {
            return { ok: false, error: 'Format rentang koordinat salah. Gunakan contoh `A1:C3`.' };
        }
        const p1 = parseCoord(parts[0]);
        const p2 = parseCoord(parts[1]);
        if (!p1 || !p2) {
            return { ok: false, error: 'Huruf kolom `A-J` dan baris `1-10` tidak valid.' };
        }
        x1 = Math.min(p1.x, p2.x);
        y1 = Math.min(p1.y, p2.y);
        x2 = Math.max(p1.x, p2.x);
        y2 = Math.max(p1.y, p2.y);
    } else {
        const single = parseCoord(str);
        if (!single) {
            return { ok: false, error: 'Koordinat tidak dikenali. Contoh: `A1`, `A1:D4`, `TEPI A1:D4`, atau `B2 2x2`.' };
        }
        x1 = single.x;
        y1 = single.y;
        x2 = single.x;
        y2 = single.y;
    }

    if (x1 < 0 || y1 < 0 || x2 >= gridWidth || y2 >= gridHeight) {
        const maxCol = String.fromCharCode(64 + gridWidth);
        return {
            ok: false,
            error: `Area keluar dari batas kavling (${gridWidth}×${gridHeight}, batas \`A1:${maxCol}${gridHeight}\`).`
        };
    }

    const cells = [];
    for (let y = y1; y <= y2; y++) {
        for (let x = x1; x <= x2; x++) {
            if (isHollowFrame && x !== x1 && x !== x2 && y !== y1 && y !== y2) continue;
            cells.push({ x, y, coord: `${String.fromCharCode(65 + x)}${y + 1}` });
        }
    }

    return {
        ok: true,
        cells,
        isHollowFrame,
        bounds: { x1, y1, x2, y2 }
    };
}

/**
 * Parser Sketsa Teks ASCII (Modal cepat):
 * - '#' / 'X' / '@' / '1' = pakai modul terpilih
 * - 'P' = pillar_block, 'G' = glass_wall, 'B' = balcony_rail, 'R' = roof_limas, 'W' = wall_custom
 * - '.' / '_' / spasi = biarkan kosong
 */
function parseAsciiFloorPattern(asciiText, gridWidth, gridHeight, defaultModuleId = 'wall_custom') {
    const rawLines = String(asciiText || '')
        .replace(/\r/g, '')
        .split('\n')
        .map(l => l.trimEnd())
        .filter(l => l.trim().length > 0);

    if (rawLines.length === 0) {
        return { ok: false, error: 'Sketsa ASCII kosong. Contoh 4×4:\n`####`\n`#..#`\n`#..#`\n`####`' };
    }
    if (rawLines.length > gridHeight) {
        return { ok: false, error: `Jumlah baris sketsa (${rawLines.length}) melebihi tinggi tanah (${gridHeight}).` };
    }

    const SYMBOL_MAP = {
        P: 'pillar_block',
        G: 'glass_wall',
        B: 'balcony_rail',
        R: 'roof_limas',
        W: 'wall_custom'
    };

    const entries = [];
    for (let y = 0; y < rawLines.length; y++) {
        // Izinkan pemisah spasi antar simbol opsional (# . . # -> #..#) atau padat
        const compact = rawLines[y].includes(' ') && rawLines[y].replace(/\s+/g, '').length <= gridWidth
            ? rawLines[y].replace(/\s+/g, '')
            : rawLines[y];
        if (compact.length > gridWidth) {
            return { ok: false, error: `Baris ke-${y + 1} (${compact.length} karakter) melebihi lebar tanah (${gridWidth}).` };
        }
        for (let x = 0; x < compact.length; x++) {
            const ch = compact[x].toUpperCase();
            if (ch === '.' || ch === '_' || ch === '-' || ch === ' ') continue;
            let modId = defaultModuleId;
            if (SYMBOL_MAP[ch]) {
                modId = SYMBOL_MAP[ch];
            } else if (!['#', 'X', '@', '1', '*'].includes(ch)) {
                return { ok: false, error: `Karakter '${compact[x]}' tidak dikenal di baris ${y + 1}. Gunakan #, ., P, G, B, W, atau R.` };
            }
            entries.push({ x, y, moduleId: modId, coord: `${String.fromCharCode(65 + x)}${y + 1}` });
        }
    }

    if (entries.length === 0) {
        return { ok: false, error: 'Tidak ada blok yang dipasang pada sketsa (semua titik kosong).' };
    }

    return { ok: true, entries };
}

/**
 * Template starter & paket siap bangun (tetap 100% bisa diedit bebas).
 */
const STARTER_TEMPLATES = [
    {
        id: 'kosong',
        name: 'Kosongkan / Nol (100% Bebas)',
        emoji: '🧹',
        minWidth: 3,
        minHeight: 3,
        description: 'Membersihkan seluruh denah agar kamu bebas menggambar dari nol.',
        buildCells: () => []
    },
    {
        id: 'gubuk_pemula',
        name: 'Pos & Gubuk Pemula (3×3)',
        emoji: '🛖',
        minWidth: 3,
        minHeight: 3,
        description: 'Gubuk bambu hemat biaya dengan kamar tidur, dapur dasar, gudang & taman.',
        buildCells: () => [
            { floor: 1, x: 0, y: 0, zg: 'tpl-bed', zn: 'Kamar Bambu', mod: 'bedroom_std', mat: 'bambu' },
            { floor: 1, x: 1, y: 0, zg: 'tpl-kit', zn: 'Tungku Dapur', mod: 'kitchen_basic', mat: 'bambu' },
            { floor: 1, x: 2, y: 0, zg: 'tpl-wh', zn: 'Gudang Kecil', mod: 'warehouse_cell', mat: 'bambu' },
            { floor: 1, x: 0, y: 1, zg: 'tpl-grd', zn: 'Kebun Depan', mod: 'garden', mat: 'bambu' },
            { floor: 1, x: 1, y: 1, zg: 'tpl-wb', zn: 'Meja Rakit', mod: 'workbench', mat: 'bambu' }
        ]
    },
    {
        id: 'ruko_usaha',
        name: 'Ruko Usaha 2 Lantai (3×3+)',
        emoji: '🏪',
        minWidth: 3,
        minHeight: 3,
        description: 'Lantai 1 Warung + Gudang + Kiln, Lantai 2 Kamar Tidur + Dapur + Kulkas.',
        buildCells: () => [
            { floor: 1, x: 0, y: 0, zg: 'tpl-shop', zn: 'Warung Depan', mod: 'shop_stall', mat: 'bata' },
            { floor: 1, x: 1, y: 0, zg: 'tpl-shop', zn: 'Warung Depan', mod: 'shop_stall', mat: 'bata' },
            { floor: 1, x: 2, y: 0, zg: 'tpl-wh', zn: 'Gudang Ruko', mod: 'warehouse_cell', mat: 'bata' },
            { floor: 1, x: 0, y: 1, zg: 'tpl-kiln', zn: 'Tungku Belakang', mod: 'kiln_station', mat: 'bata' },
            { floor: 2, x: 0, y: 0, zg: 'tpl-bed2', zn: 'Kamar Pemilik', mod: 'bedroom_std', mat: 'kayu' },
            { floor: 2, x: 1, y: 0, zg: 'tpl-kit2', zn: 'Dapur Atas', mod: 'kitchen_basic', mat: 'kayu' },
            { floor: 2, x: 2, y: 0, zg: 'tpl-frg2', zn: 'Ruang Kulkas', mod: 'fridge_room', mat: 'kayu' }
        ]
    },
    {
        id: 'rumah_keluarga',
        name: 'Rumah Keluarga Nyaman (4×4)',
        emoji: '🏠',
        minWidth: 4,
        minHeight: 4,
        description: 'Rumah bata 4×4 lengkap: Suite, Dapur Pro, Kulkas 50, Freezer 30, Gudang 50 & Garasi.',
        buildCells: () => [
            { floor: 1, x: 0, y: 0, zg: 'tpl-bed', zn: 'Kamar Utama', mod: 'bedroom_lux', mat: 'bata' },
            { floor: 1, x: 1, y: 0, zg: 'tpl-kit', zn: 'Dapur Keluarga', mod: 'kitchen_pro', mat: 'bata' },
            { floor: 1, x: 2, y: 0, zg: 'tpl-frg', zn: 'Ruang Kulkas', mod: 'fridge_room', mat: 'bata' },
            { floor: 1, x: 3, y: 0, zg: 'tpl-frg', zn: 'Ruang Kulkas', mod: 'fridge_room', mat: 'bata' },
            { floor: 1, x: 0, y: 1, zg: 'tpl-frz', zn: 'Ruang Freezer', mod: 'freezer_room', mat: 'bata' },
            { floor: 1, x: 1, y: 1, zg: 'tpl-wh', zn: 'Gudang Rumah', mod: 'warehouse_cell', mat: 'bata' },
            { floor: 1, x: 2, y: 1, zg: 'tpl-wh', zn: 'Gudang Rumah', mod: 'warehouse_cell', mat: 'bata' },
            { floor: 1, x: 3, y: 1, zg: 'tpl-gar', zn: 'Garasi Keluarga', mod: 'garage', mat: 'bata' },
            { floor: 1, x: 0, y: 2, zg: 'tpl-grd', zn: 'Taman Depan', mod: 'garden', mat: 'bata' },
            { floor: 1, x: 1, y: 2, zg: 'tpl-lng', zn: 'Ruang Tamu', mod: 'lounge', mat: 'bata' }
        ]
    },
    {
        id: 'kompleks_kos_kafe',
        name: 'Kompleks Kos & Kafe (6×6)',
        emoji: '☕',
        minWidth: 6,
        minHeight: 6,
        description: 'Lantai 1 Kafe + Dapur Pro + Freezer; Lantai 2 berisi 3 Kamar Kos Sewaan P2P.',
        buildCells: () => [
            { floor: 1, x: 0, y: 0, zg: 'tpl-cafe', zn: 'Kafe Senja', mod: 'cafe_area', mat: 'beton' },
            { floor: 1, x: 1, y: 0, zg: 'tpl-cafe', zn: 'Kafe Senja', mod: 'cafe_area', mat: 'beton' },
            { floor: 1, x: 2, y: 0, zg: 'tpl-kit', zn: 'Dapur Kafe', mod: 'kitchen_pro', mat: 'beton' },
            { floor: 1, x: 3, y: 0, zg: 'tpl-frg', zn: 'Kulkas Kafe', mod: 'fridge_room', mat: 'beton' },
            { floor: 1, x: 4, y: 0, zg: 'tpl-frz', zn: 'Freezer Kafe', mod: 'freezer_room', mat: 'beton' },
            { floor: 1, x: 5, y: 0, zg: 'tpl-wh', zn: 'Gudang Stok', mod: 'warehouse_cell', mat: 'beton' },
            { floor: 2, x: 0, y: 0, zg: 'tpl-kos1', zn: 'Kamar Kos 01', mod: 'rental_room', mat: 'bata' },
            { floor: 2, x: 1, y: 0, zg: 'tpl-kos2', zn: 'Kamar Kos 02', mod: 'rental_room', mat: 'bata' },
            { floor: 2, x: 2, y: 0, zg: 'tpl-kos3', zn: 'Kamar Kos 03', mod: 'rental_room', mat: 'bata' },
            { floor: 2, x: 0, y: 1, zg: 'tpl-bedp', zn: 'Suite Pengelola', mod: 'bedroom_lux', mat: 'bata' }
        ]
    }
];

function getStarterTemplate(templateId) {
    return STARTER_TEMPLATES.find(t => t.id === templateId) || null;
}

/**
 * Mengonversi paket rumah siap huni lama ('rumah' / 'rumah_mewah') menjadi susunan petak blueprint
 * untuk dipakai di KPR / Paket Kontraktor di /credit.
 */
function buildPresetBlueprintCells(presetId) {
    if (presetId === 'rumah_mewah') {
        return [
            { floor: 1, x: 0, y: 0, zg: 'kpr-bed', zn: 'Suite Utama', mod: 'bedroom_lux', mat: 'marmer' },
            { floor: 1, x: 1, y: 0, zg: 'kpr-bed', zn: 'Suite Utama', mod: 'bedroom_lux', mat: 'marmer' },
            { floor: 1, x: 2, y: 0, zg: 'kpr-kit1', zn: 'Dapur Chef', mod: 'kitchen_pro', mat: 'beton' },
            { floor: 1, x: 3, y: 0, zg: 'kpr-kit2', zn: 'Pantry Samping', mod: 'kitchen_basic', mat: 'beton' },
            { floor: 1, x: 4, y: 0, zg: 'kpr-frg', zn: 'Ruang Kulkas', mod: 'fridge_room', mat: 'beton' },
            { floor: 1, x: 5, y: 0, zg: 'kpr-frg', zn: 'Ruang Kulkas', mod: 'fridge_room', mat: 'beton' },
            { floor: 1, x: 0, y: 1, zg: 'kpr-frg', zn: 'Ruang Kulkas', mod: 'fridge_room', mat: 'beton' },
            { floor: 1, x: 1, y: 1, zg: 'kpr-frz', zn: 'Walk-in Freezer', mod: 'freezer_room', mat: 'beton' },
            { floor: 1, x: 2, y: 1, zg: 'kpr-frz', zn: 'Walk-in Freezer', mod: 'freezer_room', mat: 'beton' },
            { floor: 1, x: 3, y: 1, zg: 'kpr-wh', zn: 'Gudang Besar', mod: 'warehouse_cell', mat: 'beton' },
            { floor: 1, x: 4, y: 1, zg: 'kpr-wh', zn: 'Gudang Besar', mod: 'warehouse_cell', mat: 'beton' },
            { floor: 1, x: 5, y: 1, zg: 'kpr-wh', zn: 'Gudang Besar', mod: 'warehouse_cell', mat: 'beton' },
            { floor: 1, x: 0, y: 2, zg: 'kpr-wh', zn: 'Gudang Besar', mod: 'warehouse_cell', mat: 'beton' },
            { floor: 1, x: 1, y: 2, zg: 'kpr-pool', zn: 'Kolam Renang', mod: 'pool', mat: 'kaca' },
            { floor: 1, x: 2, y: 2, zg: 'kpr-pool', zn: 'Kolam Renang', mod: 'pool', mat: 'kaca' },
            { floor: 1, x: 3, y: 2, zg: 'kpr-gar', zn: 'Garasi Sultan', mod: 'garage', mat: 'beton' }
        ];
    }
    return getStarterTemplate('rumah_keluarga').buildCells();
}

const FLOOR_MATERIALS = [
    { id: 'kayu', name: 'Lantai Papan Kayu', emoji: '🪵', colorHex: '#b47b48', comfortBonus: 3, costPerCell: { papan_kayu: 2 }, appraisalValuePerCell: 220000, dailyWearRate: 2.2, safeFloorHeight: 2 },
    { id: 'keramik', name: 'Lantai Keramik Halus', emoji: '⬜', colorHex: '#cbd5e1', comfortBonus: 5, costPerCell: { batu_bata: 2, semen: 1 }, appraisalValuePerCell: 380000, dailyWearRate: 1.4, safeFloorHeight: 3 },
    { id: 'beton', name: 'Lantai Beton Cor', emoji: '🏗️', colorHex: '#8b949e', comfortBonus: 2, costPerCell: { beton_cor: 2, semen: 1 }, appraisalValuePerCell: 550000, dailyWearRate: 0.9, safeFloorHeight: 6 },
    { id: 'marmer', name: 'Lantai Marmer Mewah', emoji: '🏛️', colorHex: '#f1f5f9', comfortBonus: 10, costPerCell: { marmer: 1, beton_cor: 1 }, appraisalValuePerCell: 1450000, dailyWearRate: 0.4, safeFloorHeight: 10 },
    { id: 'rumput', name: 'Taman Rumput Hijau', emoji: '🌿', colorHex: '#22c55e', comfortBonus: 5, costPerCell: { tanah_liat: 1, bambu: 1 }, appraisalValuePerCell: 140000, dailyWearRate: 1.2, safeFloorHeight: 1 },
    { id: 'kolam', name: 'Kolam Air & Kaca', emoji: '🌊', colorHex: '#38bdf8', comfortBonus: 9, costPerCell: { semen: 2, kaca_panel: 1 }, appraisalValuePerCell: 850000, dailyWearRate: 1.1, safeFloorHeight: 3 },
    { id: 'bambu', name: 'Geladak Bambu', emoji: '🎋', colorHex: '#a3a86b', comfortBonus: 1, costPerCell: { bambu: 2 }, appraisalValuePerCell: 110000, dailyWearRate: 4.0, safeFloorHeight: 1 },
    { id: 'bata', name: 'Ubin Terakota Bata', emoji: '🧱', colorHex: '#c45b43', comfortBonus: 4, costPerCell: { batu_bata: 2 }, appraisalValuePerCell: 280000, dailyWearRate: 1.5, safeFloorHeight: 3 },
    { id: 'baja', name: 'Dek Rangka Baja', emoji: '🔩', colorHex: '#475569', comfortBonus: 4, costPerCell: { rangka_baja: 2, beton_cor: 1 }, appraisalValuePerCell: 1100000, dailyWearRate: 0.5, safeFloorHeight: 12 },
    { id: 'kaca', name: 'Lantai Kaca Skywalk', emoji: '🪟', colorHex: '#7dd3fc', comfortBonus: 9, costPerCell: { kaca_panel: 2, rangka_baja: 1 }, appraisalValuePerCell: 1250000, dailyWearRate: 0.8, safeFloorHeight: 10 }
];

const WALL_EDGE_TYPES = [
    { id: 'wall', name: 'Dinding Padat', shortLabel: 'Dinding', emoji: '🧱', blocksPassage: true, enclosesRoom: true, costPerEdge: { batu_bata: 1, semen: 1 }, appraisalPerEdge: 160000, colorHex: '#cbd5e1' },
    { id: 'door', name: 'Pintu Kayu / Akses', shortLabel: 'Pintu', emoji: '🚪', blocksPassage: true, enclosesRoom: true, isDoor: true, costPerEdge: { papan_kayu: 2 }, appraisalPerEdge: 190000, colorHex: '#f59e0b' },
    { id: 'window', name: 'Dinding Berjendela', shortLabel: 'Jendela', emoji: '🪟', blocksPassage: true, enclosesRoom: true, isWindow: true, comfortBonus: 3, costPerEdge: { kaca_panel: 1, batu_bata: 1 }, appraisalPerEdge: 260000, colorHex: '#38bdf8' },
    { id: 'glass_wall', name: 'Dinding Kaca Penuh', shortLabel: 'Kaca', emoji: '💎', blocksPassage: true, enclosesRoom: true, isWindow: true, comfortBonus: 5, costPerEdge: { kaca_panel: 2 }, appraisalPerEdge: 360000, colorHex: '#7dd3fc' },
    { id: 'arch', name: 'Gapura / Bukaan Terbuka', shortLabel: 'Gapura', emoji: '⛩️', blocksPassage: false, enclosesRoom: false, isDoor: true, costPerEdge: { semen: 1 }, appraisalPerEdge: 140000, colorHex: '#a78bfa' },
    { id: 'fence', name: 'Pagar Balkon / Taman', shortLabel: 'Pagar', emoji: '🪵', blocksPassage: true, enclosesRoom: false, costPerEdge: { papan_kayu: 1 }, appraisalPerEdge: 95000, colorHex: '#b45309' }
];

const ROOF_VARIANTS = [
    { id: 'none', name: 'Tanpa Atap (Terbuka)', emoji: '☀️', costPerCell: {}, appraisalPerCell: 0 },
    { id: 'flat', name: 'Dak Atap Datar / Balkon', emoji: '⬛', costPerCell: { beton_cor: 1 }, appraisalPerCell: 220000 },
    { id: 'gable', name: 'Atap Pelana Klasik', emoji: '🏠', costPerCell: { papan_kayu: 1, batu_bata: 1 }, appraisalPerCell: 280000 },
    { id: 'hip', name: 'Atap Limas Modern', emoji: '🔺', costPerCell: { papan_kayu: 1, rangka_baja: 1 }, appraisalPerCell: 360000 },
    { id: 'joglo', name: 'Atap Joglo Nusantara', emoji: '🏯', costPerCell: { papan_kayu: 2 }, appraisalPerCell: 520000 },
    { id: 'dome', name: 'Kubah Megah', emoji: '🕌', costPerCell: { kaca_panel: 1, rangka_baja: 1 }, appraisalPerCell: 680000 },
    { id: 'spire', name: 'Menara Runcing (Spire)', emoji: '🗼', costPerCell: { rangka_baja: 2, marmer: 1 }, appraisalPerCell: 950000 }
];

const FLOOR_MATERIAL_MAP = new Map(FLOOR_MATERIALS.map(m => [m.id, m]));
const WALL_EDGE_MAP = new Map(WALL_EDGE_TYPES.map(w => [w.id, w]));
const ROOF_VARIANT_MAP = new Map(ROOF_VARIANTS.map(r => [r.id, r]));

function getFloorMaterial(matId) {
    return FLOOR_MATERIAL_MAP.get(String(matId || 'kayu').toLowerCase()) || FLOOR_MATERIALS[0];
}

function getWallEdgeType(edgeType) {
    return WALL_EDGE_MAP.get(String(edgeType || 'wall').toLowerCase()) || WALL_EDGE_TYPES[0];
}

function getRoofVariant(roofVariant) {
    const id = String(roofVariant || 'none').toLowerCase();
    if (id === 'limas') return ROOF_VARIANT_MAP.get('hip');
    return ROOF_VARIANT_MAP.get(id) || ROOF_VARIANTS[0];
}

/**
 * Normalisasi garis tepi antar-petak (Edge Walls):
 * - orientation 'H': batas Utara petak 1-based (gx in [1..W], gy in [1..H+1])
 * - orientation 'V': batas Barat petak 1-based (gx in [1..W+1], gy in [1..H])
 */
function normalizeWallEdgeCoord(x0, y0, side = 'S', landWidth = 4, landHeight = 4) {
    const x = Number(x0);
    const y = Number(y0);
    const w = Number(landWidth || 4);
    const h = Number(landHeight || 4);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= w || y >= h) {
        return { ok: false, error: 'Koordinat petak di luar batas tanah.' };
    }
    const s = String(side || 'S').trim().toUpperCase();
    if (s === 'N' || s === 'U' || s === 'ATAS') {
        return { ok: true, orientation: 'H', gx: x + 1, gy: y + 1 };
    }
    if (s === 'S' || s === 'BAWAH') {
        return { ok: true, orientation: 'H', gx: x + 1, gy: y + 2 };
    }
    if (s === 'W' || s === 'B' || s === 'KIRI') {
        return { ok: true, orientation: 'V', gx: x + 1, gy: y + 1 };
    }
    if (s === 'E' || s === 'T' || s === 'KANAN') {
        return { ok: true, orientation: 'V', gx: x + 2, gy: y + 1 };
    }
    return { ok: false, error: 'Arah sisi tidak valid. Gunakan N (Utara), S (Selatan), E (Timur), atau W (Barat).' };
}

function getCellBoundaryEdges(x0, y0) {
    const x = Number(x0);
    const y = Number(y0);
    return {
        N: { orientation: 'H', gx: x + 1, gy: y + 1, key: `H:${x + 1}:${y + 1}` },
        S: { orientation: 'H', gx: x + 1, gy: y + 2, key: `H:${x + 1}:${y + 2}` },
        W: { orientation: 'V', gx: x + 1, gy: y + 1, key: `V:${x + 1}:${y + 1}` },
        E: { orientation: 'V', gx: x + 2, gy: y + 1, key: `V:${x + 2}:${y + 1}` }
    };
}

function parseAreaPerimeterWalls(rawAreaInput, landWidth, landHeight) {
    const areaRes = parseGridAreaInput(String(rawAreaInput || '').replace(/^(TEPI|FRAME)\s+/i, ''), landWidth, landHeight);
    if (!areaRes.ok) return areaRes;
    const { x1, y1, x2, y2 } = areaRes.bounds;
    const edges = [];
    const seen = new Set();
    const pushEdge = (orientation, gx, gy) => {
        const key = `${orientation}:${gx}:${gy}`;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({ orientation, gx, gy, key });
    };

    for (let x = x1; x <= x2; x++) {
        pushEdge('H', x + 1, y1 + 1);
        pushEdge('H', x + 1, y2 + 2);
    }
    for (let y = y1; y <= y2; y++) {
        pushEdge('V', x1 + 1, y + 1);
        pushEdge('V', x2 + 2, y + 1);
    }

    return { ok: true, edges, bounds: areaRes.bounds };
}

/**
 * Parser tarik garis sekat / pintu / jendela:
 * Format: "A2:C2 S", "B1:B3 E", "B2 N", atau "A1" (default sisi S).
 */
function parseLineWallInput(rawLineInput, landWidth, landHeight) {
    const raw = String(rawLineInput || '').trim().toUpperCase();
    if (!raw) {
        return { ok: false, error: 'Input garis dinding kosong. Contoh: `A2:C2 S`, `B1:B3 E`, atau `B2 N`.' };
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    const sideAliases = new Set(['N', 'S', 'E', 'W', 'U', 'T', 'B', 'ATAS', 'BAWAH', 'KIRI', 'KANAN']);
    let side = 'S';
    let coordExpr = tokens[0];
    if (tokens.length >= 2 && sideAliases.has(tokens[tokens.length - 1])) {
        side = tokens[tokens.length - 1];
        coordExpr = tokens.slice(0, -1).join(' ');
    }

    const areaRes = parseGridAreaInput(coordExpr, landWidth, landHeight);
    if (!areaRes.ok) return areaRes;

    const edges = [];
    const seen = new Set();
    for (const c of areaRes.cells) {
        const norm = normalizeWallEdgeCoord(c.x, c.y, side, landWidth, landHeight);
        if (!norm.ok) return norm;
        const key = `${norm.orientation}:${norm.gx}:${norm.gy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ orientation: norm.orientation, gx: norm.gx, gy: norm.gy, key });
    }
    return { ok: true, edges, side };
}

function parseSingleCoordInput(rawCoord, landWidth, landHeight) {
    const res = parseGridAreaInput(String(rawCoord || '').trim().split(/[\s:,-]+/)[0], landWidth, landHeight);
    if (!res.ok || !res.cells.length) {
        return { ok: false, error: res.error || 'Koordinat petak tidak valid.' };
    }
    return { ok: true, x: res.cells[0].x, y: res.cells[0].y, coord: res.cells[0].coord };
}

module.exports = {
    LAND_TIERS,
    FLOOR_LABELS,
    STRUCTURAL_MATERIALS,
    FLOOR_MATERIALS,
    WALL_EDGE_TYPES,
    ROOF_VARIANTS,
    MODULE_CATEGORIES,
    BUILDING_MODULES,
    SHAPE_BLOCKS,
    ALL_BUILDABLE_BLOCKS,
    ARCHITECTURE_THEMES,
    STARTER_TEMPLATES,
    getLandTier,
    getNextLandTier,
    getMaxLandLimit,
    getProgressivePbbMultiplier,
    getFloorLabel,
    getStructuralMaterial,
    getFloorMaterial,
    getWallEdgeType,
    getRoofVariant,
    getBuildingModule,
    getModulesByCategory,
    getBlockKind,
    getArchitectureTheme,
    validateCellPlacement,
    calculateStructuralStress,
    validateVoxelSupport,
    normalizeWallEdgeCoord,
    getCellBoundaryEdges,
    parseAreaPerimeterWalls,
    parseLineWallInput,
    parseSingleCoordInput,
    parseGridAreaInput,
    parseAsciiFloorPattern,
    getStarterTemplate,
    buildPresetBlueprintCells
};
