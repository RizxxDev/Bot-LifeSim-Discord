/**
 * Katalog Lengkap Perabotan & Mesin Multi-Ukuran (1x1, 1x2, 2x2) + Rotasi N/E/S/W
 * untuk Editor Arsitektur The Sims (/bangun Layer 4 & /shop kategori furnitur).
 */

const FURNITURE_CATEGORIES = [
    { id: 'rest', name: 'Istirahat & Vital', emoji: '🛏️' },
    { id: 'kitchen_storage', name: 'Dapur & Penyimpanan', emoji: '🧊' },
    { id: 'business', name: 'Usaha & Sewa Kos', emoji: '🏪' },
    { id: 'station', name: 'Produksi & Workshop', emoji: '🏭' },
    { id: 'decor', name: 'Dekorasi & Outdoor', emoji: '🪴' }
];

const FURNITURE_CATALOG = [
    // --- ISTIRAHAT & VITAL ---
    {
        id: 'kasur_lipat',
        category: 'rest',
        name: 'Kasur Lipat Sederhana',
        shortCode: 'KSR1',
        emoji: '🛌',
        width: 1,
        height: 1,
        environment: 'indoor',
        colorHex: '#a5b4fc',
        buyPrice: 280000,
        appraisalValue: 220000,
        effects: { sleepEnergyBonus: 65, sleepDurationSec: 3600, passiveRegen: 0.3, comfort: 2 },
        description: 'Kasur 1×1 ringkas untuk /sleep (+65 EN, 60m).'
    },
    {
        id: 'ranjang_kayu',
        category: 'rest',
        name: 'Ranjang Kayu Jati',
        shortCode: 'RNJG',
        emoji: '🛏️',
        width: 1,
        height: 2,
        environment: 'indoor',
        colorHex: '#818cf8',
        buyPrice: 850000,
        appraisalValue: 700000,
        effects: { sleepEnergyBonus: 82, sleepDurationSec: 3000, passiveRegen: 0.8, comfort: 5, prestige: 2 },
        description: 'Ranjang nyaman 1×2 (+82 EN tidur 50m, memenuhi syarat kamar kos!).'
    },
    {
        id: 'ranjang_king',
        category: 'rest',
        name: 'Ranjang King Sultan',
        shortCode: 'KING',
        emoji: '👑',
        width: 2,
        height: 2,
        environment: 'indoor',
        colorHex: '#6366f1',
        buyPrice: 3200000,
        appraisalValue: 2700000,
        effects: { sleepEnergyBonus: 100, sleepDurationSec: 2100, passiveRegen: 1.8, comfort: 12, prestige: 8 },
        description: 'Ranjang mewah 2×2 memulihkan +100 EN penuh hanya dalam 35 menit!'
    },
    {
        id: 'sofa_santai',
        category: 'rest',
        name: 'Sofa Santai Ruang Tamu',
        shortCode: 'SOFA',
        emoji: '🛋️',
        width: 1,
        height: 2,
        environment: 'indoor',
        colorHex: '#c084fc',
        buyPrice: 650000,
        appraisalValue: 520000,
        effects: { sleepEnergyBonus: 58, sleepDurationSec: 3400, passiveRegen: 0.7, comfort: 6, prestige: 3 },
        description: 'Sofa empuk 1×2 (+6 Comfort, +0.7 regen Energy/jam).'
    },

    // --- DAPUR & PENYIMPANAN ---
    {
        id: 'kompor_1tungku',
        category: 'kitchen_storage',
        name: 'Kompor Gas 1 Tungku',
        shortCode: 'KMP1',
        emoji: '🔥',
        width: 1,
        height: 1,
        environment: 'indoor',
        colorHex: '#fbbf24',
        buyPrice: 350000,
        appraisalValue: 280000,
        effects: { stoveSlots: 1, comfort: 2 },
        description: 'Menambah +1 tungku memasak /cook di dalam ruangan tertutup.'
    },
    {
        id: 'kompor_komersial',
        category: 'kitchen_storage',
        name: 'Kompor Kitchen Island Pro',
        shortCode: 'KMPP',
        emoji: '👨‍🍳',
        width: 1,
        height: 2,
        environment: 'indoor',
        colorHex: '#f59e0b',
        buyPrice: 1850000,
        appraisalValue: 1500000,
        effects: { stoveSlots: 2, comfort: 5, prestige: 4 },
        description: 'Set dapur komersial 1×2 (+2 tungku /cook, mendukung dapur kafe).'
    },
    {
        id: 'kulkas_mini',
        category: 'kitchen_storage',
        name: 'Kulkas Mini 1 Pintu',
        shortCode: 'KLK1',
        emoji: '🧊',
        width: 1,
        height: 1,
        environment: 'indoor',
        colorHex: '#22d3ee',
        buyPrice: 750000,
        appraisalValue: 600000,
        effects: { kulkasSlots: 15, comfort: 1 },
        description: 'Menambah +15 slot Kulkas di properti ini (basi melambat 3×).'
    },
    {
        id: 'kulkas_2pintu',
        category: 'kitchen_storage',
        name: 'Kulkas Side-by-Side 2 Pintu',
        shortCode: 'KLK2',
        emoji: '❄️',
        width: 1,
        height: 1,
        environment: 'indoor',
        colorHex: '#06b6d4',
        buyPrice: 1950000,
        appraisalValue: 1650000,
        effects: { kulkasSlots: 30, comfort: 3, prestige: 3 },
        description: 'Kulkas jumbo 1×1 menambah +30 slot Kulkas properti.'
    },
    {
        id: 'freezer_box',
        category: 'kitchen_storage',
        name: 'Freezer Box Industri',
        shortCode: 'FRZ2',
        emoji: '🧊',
        width: 1,
        height: 2,
        environment: 'indoor',
        colorHex: '#0284c7',
        buyPrice: 2800000,
        appraisalValue: 2300000,
        effects: { freezerSlots: 30, comfort: 2 },
        description: 'Mesin pembeku 1×2 menambah +30 slot Freezer (bahan beku tahan selamanya!).'
    },
    {
        id: 'rak_gudang',
        category: 'kitchen_storage',
        name: 'Rak Besi Gudang',
        shortCode: 'RAKG',
        emoji: '📦',
        width: 1,
        height: 1,
        environment: 'any',
        colorHex: '#a8a29e',
        buyPrice: 450000,
        appraisalValue: 350000,
        effects: { gudangSlots: 20 },
        description: 'Rak logistik 1×1 (+20 slot Gudang properti).'
    },
    {
        id: 'lemari_baja',
        category: 'kitchen_storage',
        name: 'Lemari Arsip & Logistik Baja',
        shortCode: 'LMR2',
        emoji: '🗄️',
        width: 1,
        height: 2,
        environment: 'indoor',
        colorHex: '#64748b',
        buyPrice: 1450000,
        appraisalValue: 1200000,
        effects: { gudangSlots: 45, prestige: 2 },
        description: 'Lemari penyimpanan heavy-duty 1×2 (+45 slot Gudang properti).'
    },

    // --- USAHA & SEWA KOS ---
    {
        id: 'meja_kasir',
        category: 'business',
        name: 'Meja Kasir POS',
        shortCode: 'KSRM',
        emoji: '💳',
        width: 1,
        height: 1,
        environment: 'indoor',
        colorHex: '#fb923c',
        buyPrice: 950000,
        appraisalValue: 780000,
        effects: { businessType: 'shop', businessSlots: 8, appeal: 6 },
        description: 'Meja kasir 1×1: aktifkan ruangan sebagai unit usaha ritel (+8 slot etalase).'
    },
    {
        id: 'etalase_warung',
        category: 'business',
        name: 'Etalase Kaca Warung',
        shortCode: 'ETLS',
        emoji: '🏪',
        width: 1,
        height: 2,
        environment: 'indoor',
        colorHex: '#f97316',
        buyPrice: 1350000,
        appraisalValue: 1100000,
        effects: { businessType: 'shop', businessSlots: 14, appeal: 10 },
        description: 'Etalase dagangan 1×2: jual stok barang otomatis di ruangan toko.'
    },
    {
        id: 'mesin_kopi_bar',
        category: 'business',
        name: 'Bar Espresso & Kafe',
        shortCode: 'KOPI',
        emoji: '☕',
        width: 1,
        height: 2,
        environment: 'indoor',
        colorHex: '#ea580c',
        buyPrice: 2900000,
        appraisalValue: 2400000,
        effects: { businessType: 'cafe', businessSlots: 14, appeal: 16, comfort: 4, prestige: 5 },
        description: 'Meja bar kafe 1×2: menjual masakan/minuman otomatis ke pengunjung.'
    },
    {
        id: 'meja_tamu_resto',
        category: 'business',
        name: 'Set Meja Tamu / Belajar Kos',
        shortCode: 'MEJA',
        emoji: '🪑',
        width: 1,
        height: 1,
        environment: 'any',
        colorHex: '#d97706',
        buyPrice: 480000,
        appraisalValue: 380000,
        effects: { rentalCapable: true, appeal: 5, comfort: 3 },
        description: 'Pelengkap restoran & syarat kamar kos P2P (jika bersama Ranjang & Pintu).'
    },
    {
        id: 'dongkrak_bengkel',
        category: 'business',
        name: 'Hidrolik & Dongkrak Bengkel',
        shortCode: 'BNKL',
        emoji: '🔧',
        width: 2,
        height: 2,
        environment: 'any',
        colorHex: '#475569',
        buyPrice: 3600000,
        appraisalValue: 3000000,
        effects: { garageSlots: 2, fuelDiscountPct: 12, appeal: 8 },
        description: 'Rig servis kendaraan 2×2 (+2 slot garasi & -12% biaya BBM/servis lokal).'
    },

    // --- PRODUKSI & WORKSHOP ---
    {
        id: 'meja_rakit',
        category: 'station',
        name: 'Meja Kerja Pertukangan',
        shortCode: 'RAKT',
        emoji: '🪚',
        width: 1,
        height: 2,
        environment: 'any',
        colorHex: '#b45309',
        buyPrice: 780000,
        appraisalValue: 620000,
        effects: { workshopStation: 'workbench' },
        description: 'Buka resep rakit furnitur & daur ulang workshop pribadi (1×2).'
    },
    {
        id: 'tungku_kiln',
        category: 'station',
        name: 'Tungku Bakar Bata (Kiln)',
        shortCode: 'KILN',
        emoji: '🧱',
        width: 2,
        height: 2,
        environment: 'any',
        colorHex: '#dc2626',
        buyPrice: 2200000,
        appraisalValue: 1850000,
        effects: { workshopStation: 'kiln' },
        description: 'Tungku bata & kaca pribadi 2×2 di propertimu.'
    },
    {
        id: 'mesin_sawmill',
        category: 'station',
        name: 'Mesin Gergaji Sawmill',
        shortCode: 'SWML',
        emoji: '🪵',
        width: 2,
        height: 2,
        environment: 'any',
        colorHex: '#92400e',
        buyPrice: 2100000,
        appraisalValue: 1750000,
        effects: { workshopStation: 'sawmill' },
        description: 'Mesin penggergajian papan kayu massal 2×2.'
    },
    {
        id: 'smelter_baja',
        category: 'station',
        name: 'Tanur Pelebur Baja (Smelter)',
        shortCode: 'SMLT',
        emoji: '⚙️',
        width: 2,
        height: 2,
        environment: 'any',
        colorHex: '#334155',
        buyPrice: 4400000,
        appraisalValue: 3700000,
        effects: { workshopStation: 'smelter' },
        description: 'Tanur industri 2×2 untuk melebur Rangka Baja, Marmer & Kit Utilitas.'
    },

    // --- DEKORASI & OUTDOOR ---
    {
        id: 'lampu_hias',
        category: 'decor',
        name: 'Lampu Chandelier Hangat',
        shortCode: 'LMPU',
        emoji: '💡',
        width: 1,
        height: 1,
        environment: 'any',
        colorHex: '#fde047',
        buyPrice: 320000,
        appraisalValue: 260000,
        effects: { comfort: 4, prestige: 3, appeal: 4 },
        description: 'Menerangi & meningkatkan kenyamanan ruangan (+4 Comfort).'
    },
    {
        id: 'tanaman_pot',
        category: 'decor',
        name: 'Tanaman Hias Monstera',
        shortCode: 'TNMN',
        emoji: '🪴',
        width: 1,
        height: 1,
        environment: 'any',
        colorHex: '#22c55e',
        buyPrice: 180000,
        appraisalValue: 150000,
        effects: { comfort: 4, farmYieldBonusPct: 2, appeal: 3 },
        description: 'Dekorasi hijau penyegar ruangan (+4 Comfort, +2% bonus panen).'
    },
    {
        id: 'toilet_wastafel',
        category: 'decor',
        name: 'Set Kamar Mandi & Wastafel',
        shortCode: 'KMND',
        emoji: '🚿',
        width: 1,
        height: 1,
        environment: 'indoor',
        colorHex: '#93c5fd',
        buyPrice: 680000,
        appraisalValue: 550000,
        effects: { comfort: 6, passiveRegen: 0.4, prestige: 2 },
        description: 'Sanitasi lengkap 1×1 (+6 Comfort, +0.4 regen Energy/jam).'
    },
    {
        id: 'panggangan_bbq',
        category: 'decor',
        name: 'Pemanggang BBQ Taman',
        shortCode: 'BBQ1',
        emoji: '🍖',
        width: 1,
        height: 1,
        environment: 'outdoor',
        colorHex: '#b91c1c',
        buyPrice: 620000,
        appraisalValue: 500000,
        effects: { stoveSlots: 1, comfort: 4, appeal: 5 },
        description: 'Kompor BBQ khusus halaman terbuka (+1 tungku outdoor & +5 Daya Tarik).'
    },
    {
        id: 'gazebo_taman',
        category: 'decor',
        name: 'Gazebo Taman Minimalis',
        shortCode: 'GZBO',
        emoji: '⛺',
        width: 2,
        height: 2,
        environment: 'outdoor',
        colorHex: '#10b981',
        buyPrice: 2400000,
        appraisalValue: 2000000,
        effects: { comfort: 10, passiveRegen: 0.8, appeal: 10, prestige: 6 },
        description: 'Gazebo outdoor 2×2 paling cocok di taman terbuka (+10 Comfort & Prestige).'
    },
    {
        id: 'kolam_mini',
        category: 'decor',
        name: 'Kolam Renang Mini Halaman',
        shortCode: 'KLM2',
        emoji: '🏊',
        width: 2,
        height: 2,
        environment: 'outdoor',
        colorHex: '#38bdf8',
        buyPrice: 3900000,
        appraisalValue: 3300000,
        effects: { comfort: 14, prestige: 12, appeal: 14 },
        description: 'Kolam renang 2×2 mewah untuk halaman propertimu!'
    }
];

const FURNITURE_MAP = new Map(FURNITURE_CATALOG.map(f => [f.id, f]));

function getFurnitureSpec(itemId) {
    if (!itemId) return null;
    return FURNITURE_MAP.get(String(itemId).toLowerCase()) || null;
}

function normalizeFurnitureRotation(rotation = 'S') {
    const r = String(rotation || 'S').trim().toUpperCase();
    if (['N', 'UTARA', 'U', 'ATAS'].includes(r)) return 'N';
    if (['E', 'TIMUR', 'T', 'KANAN'].includes(r)) return 'E';
    if (['W', 'BARAT', 'B', 'KIRI'].includes(r)) return 'W';
    return 'S';
}

function rotateFurnitureClockwise(rotation = 'S') {
    const order = ['N', 'E', 'S', 'W'];
    const cur = normalizeFurnitureRotation(rotation);
    return order[(order.indexOf(cur) + 1) % 4];
}

function getRotatedDimensions(specOrItemId, rotation = 'S') {
    const spec = typeof specOrItemId === 'object' ? specOrItemId : getFurnitureSpec(specOrItemId);
    if (!spec) return { widthCells: 1, heightCells: 1 };
    const rot = normalizeFurnitureRotation(rotation);
    const swap = rot === 'E' || rot === 'W';
    return {
        widthCells: swap ? Number(spec.height || 1) : Number(spec.width || 1),
        heightCells: swap ? Number(spec.width || 1) : Number(spec.height || 1),
        rotation: rot
    };
}

function getFootprintCells(anchorX, anchorY, widthCells = 1, heightCells = 1) {
    const cells = [];
    for (let dy = 0; dy < Number(heightCells || 1); dy++) {
        for (let dx = 0; dx < Number(widthCells || 1); dx++) {
            cells.push({ x: Number(anchorX) + dx, y: Number(anchorY) + dy });
        }
    }
    return cells;
}

/**
 * Mengembalikan daftar garis tepi internal (orientation H/V, gx, gy 1-based)
 * yang membelah footprint item multi-ukuran (1x2, 2x1, 2x2).
 */
function getInternalWallEdgesForFootprint(anchorX, anchorY, widthCells = 1, heightCells = 1) {
    const ax = Number(anchorX);
    const ay = Number(anchorY);
    const w = Number(widthCells || 1);
    const h = Number(heightCells || 1);
    const edges = [];

    // Batas vertikal antar sel bersebelahan mendatar
    for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w - 1; dx++) {
            edges.push({ orientation: 'V', gx: ax + dx + 2, gy: ay + dy + 1 });
        }
    }
    // Batas horizontal antar sel bersebelahan vertikal
    for (let dy = 0; dy < h - 1; dy++) {
        for (let dx = 0; dx < w; dx++) {
            edges.push({ orientation: 'H', gx: ax + dx + 1, gy: ay + dy + 2 });
        }
    }
    return edges;
}

module.exports = {
    FURNITURE_CATEGORIES,
    FURNITURE_CATALOG,
    getFurnitureSpec,
    normalizeFurnitureRotation,
    rotateFurnitureClockwise,
    getRotatedDimensions,
    getFootprintCells,
    getInternalWallEdgesForFootprint
};
