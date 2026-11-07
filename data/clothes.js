const path = require('path');

const AVATAR_CANVAS_SIZE = 256;
const ASSETS_AVATAR_ROOT = path.join(__dirname, '..', 'assets', 'avatar');

/**
 * Urutan Z-Index layer komposisi dari paling belakang ke paling depan.
 */
const CLOTHING_SLOTS = [
    {
        id: 'body',
        column: 'equipped_body',
        folder: 'base',
        name: 'Tubuh & Kulit',
        emoji: '🧍',
        canUnequip: false,
        defaultId: 'chibi_body_light'
    },
    {
        id: 'bottom',
        column: 'equipped_bottom',
        folder: 'bottom',
        name: 'Celana / Bawahan',
        emoji: '👖',
        canUnequip: true,
        defaultId: null
    },
    {
        id: 'shoes',
        column: 'equipped_shoes',
        folder: 'shoes',
        name: 'Sepatu / Alas Kaki',
        emoji: '👟',
        canUnequip: true,
        defaultId: null
    },
    {
        id: 'top',
        column: 'equipped_top',
        folder: 'top',
        name: 'Baju / Atasan',
        emoji: '👕',
        canUnequip: true,
        defaultId: null
    },
    {
        id: 'hair',
        column: 'equipped_hair',
        folder: 'hair',
        name: 'Gaya Rambut',
        emoji: '💇',
        canUnequip: true,
        defaultId: 'hair_short_black'
    },
    {
        id: 'hat',
        column: 'equipped_hat',
        folder: 'hat',
        name: 'Topi / Pelindung Kepala',
        emoji: '🧢',
        canUnequip: true,
        defaultId: null
    },
    {
        id: 'accessory',
        column: 'equipped_accessory',
        folder: 'accessory',
        name: 'Aksesoris Wajah & Leher',
        emoji: '👓',
        canUnequip: true,
        defaultId: null
    }
];

const SLOT_MAP = new Map(CLOTHING_SLOTS.map(s => [s.id, s]));

const CLOTHES = [
    // ==========================================
    // 1. BASE CHIBI BODY (Starter Gratis)
    // ==========================================
    {
        id: 'chibi_body_light',
        slot: 'body',
        name: 'Tubuh Chibi (Kulit Cerah)',
        emoji: '🧍',
        rarity: 'common',
        source: 'starter',
        isStarter: true,
        priceLp: 0,
        file: 'base/chibi_body_light.png',
        buffs: null,
        description: 'Tubuh karakter chibi dasar dengan warna kulit cerah.'
    },
    {
        id: 'chibi_body_medium',
        slot: 'body',
        name: 'Tubuh Chibi (Sawo Matang)',
        emoji: '🧍🏽',
        rarity: 'common',
        source: 'starter',
        isStarter: true,
        priceLp: 0,
        file: 'base/chibi_body_medium.png',
        buffs: null,
        description: 'Tubuh karakter chibi dasar dengan warna kulit sawo matang khas tropis.'
    },
    {
        id: 'chibi_body_dark',
        slot: 'body',
        name: 'Tubuh Chibi (Kulit Eksotis)',
        emoji: '🧍🏿',
        rarity: 'common',
        source: 'starter',
        isStarter: true,
        priceLp: 0,
        file: 'base/chibi_body_dark.png',
        buffs: null,
        description: 'Tubuh karakter chibi dasar dengan warna kulit cokelat eksotis.'
    },

    // ==========================================
    // 2. HAIR / GAYA RAMBUT
    // ==========================================
    {
        id: 'hair_short_black',
        slot: 'hair',
        name: 'Rambut Pendek Hitam',
        emoji: '💇',
        rarity: 'common',
        source: 'starter',
        isStarter: true,
        priceLp: 0,
        file: 'hair/hair_short_black.png',
        buffs: null,
        description: 'Potongan rambut pendek hitam rapi bergaya kasual.'
    },
    {
        id: 'hair_short_brown',
        slot: 'hair',
        name: 'Rambut Cokelat Kasual',
        emoji: '💇🏽',
        rarity: 'common',
        source: 'starter',
        isStarter: true,
        priceLp: 0,
        file: 'hair/hair_short_brown.png',
        buffs: null,
        description: 'Potongan rambut berponi warna cokelat hangat.'
    },
    {
        id: 'hair_ponytail',
        slot: 'hair',
        name: 'Rambut Kuncir Kuda',
        emoji: '👱‍♀️',
        rarity: 'common',
        source: 'starter',
        isStarter: true,
        priceLp: 0,
        file: 'hair/hair_ponytail.png',
        buffs: null,
        description: 'Gaya rambut ikat kuncir belakang yang lincah dan aktif.'
    },
    {
        id: 'hair_messy_silver',
        slot: 'hair',
        name: 'Rambut Perak Anime',
        emoji: '🤍',
        rarity: 'uncommon',
        source: 'shop',
        isStarter: false,
        priceLp: 95000,
        file: 'hair/hair_messy_silver.png',
        buffs: null,
        description: 'Gaya rambut spiky warna perak metalik ala karakter utama.'
    },
    {
        id: 'hair_wavy_gold',
        slot: 'hair',
        name: 'Rambut Pirang Bergelombang',
        emoji: '💛',
        rarity: 'rare',
        source: 'shop',
        isStarter: false,
        priceLp: 135000,
        file: 'hair/hair_wavy_gold.png',
        buffs: null,
        description: 'Rambut pirang keemasan bergelombang lembut nan elegan.'
    },

    // ==========================================
    // 3. TOP / ATASAN BAJU
    // ==========================================
    {
        id: 'top_tshirt_white',
        slot: 'top',
        name: 'Kaos Oblong Putih',
        emoji: '👕',
        rarity: 'common',
        source: 'starter',
        isStarter: true,
        priceLp: 0,
        file: 'top/top_tshirt_white.png',
        buffs: null,
        description: 'Kaos katun putih bersih yang adem dipakai sehari-hari.'
    },
    {
        id: 'top_flannel_red',
        slot: 'top',
        name: 'Kemeja Flanel Merah',
        emoji: '👔',
        rarity: 'common',
        source: 'shop',
        isStarter: false,
        priceLp: 45000,
        file: 'top/top_flannel_red.png',
        buffs: null,
        description: 'Kemeja flanel motif kotak merah-hitam favorit anak nongkrong.'
    },
    {
        id: 'top_batik_nusantara',
        slot: 'top',
        name: 'Kemeja Batik Nusantara',
        emoji: '👘',
        rarity: 'uncommon',
        source: 'shop',
        isStarter: false,
        priceLp: 85000,
        file: 'top/top_batik_nusantara.png',
        buffs: null,
        description: 'Batik tulis cokelat keemasan untuk tampil berwibawa di setiap acara.'
    },
    {
        id: 'top_hoodie_black',
        slot: 'top',
        name: 'Hoodie Streetwear Hitam',
        emoji: '🧥',
        rarity: 'uncommon',
        source: 'shop',
        isStarter: false,
        priceLp: 120000,
        file: 'top/top_hoodie_black.png',
        buffs: null,
        description: 'Jaket hoodie hitam tebal lengkap dengan kantong depan.'
    },
    {
        id: 'top_raincoat_yellow',
        slot: 'top',
        name: 'Jas Hujan Anti-Badai',
        emoji: '🌧️',
        rarity: 'rare',
        source: 'shop',
        isStarter: false,
        priceLp: 160000,
        file: 'top/top_raincoat_yellow.png',
        buffs: { fishingXpBonus: 0.10 },
        buffLabel: '+10% Fishing EXP di /fishing',
        description: 'Jas hujan kuning tahan cipratan ombak (+10% Fishing EXP saat memancing).'
    },
    {
        id: 'top_suit_executive',
        slot: 'top',
        name: 'Jas Eksekutif Kantor',
        emoji: '🤵',
        rarity: 'rare',
        source: 'shop',
        isStarter: false,
        priceLp: 450000,
        file: 'top/top_suit_executive.png',
        buffs: { workSalaryBonus: 0.03 },
        buffLabel: '+3% Gaji Kerja di /work',
        description: 'Setelan jas rapi berdasi merah yang meningkatkan karisma kerja (+3% Gaji /work).'
    },
    {
        id: 'top_ojol_jacket',
        slot: 'top',
        name: 'Jaket Ojol Legendaris',
        emoji: '🛵',
        rarity: 'epic',
        source: 'gacha',
        isStarter: false,
        priceLp: 0,
        file: 'top/top_ojol_jacket.png',
        buffs: {
            jobBonuses: {
                kurir_paket: 0.06,
                ojek_online: 0.06
            }
        },
        buffLabel: '+6% Gaji Kurir Paket & Ojek Online',
        description: 'Jaket hijau strip reflektif kebanggaan pejuang jalanan (+6% Gaji Kurir & Ojol).'
    },
    {
        id: 'top_suit_sultan',
        slot: 'top',
        name: 'Tuxedo Kaisar Sultan',
        emoji: '👑',
        rarity: 'legendary',
        source: 'gacha',
        isStarter: false,
        priceLp: 0,
        file: 'top/top_suit_sultan.png',
        buffs: { workSalaryBonus: 0.08 },
        buffLabel: '+8% Gaji Seluruh Profesi',
        description: 'Jubah tuxedo putih berbalut benang emas eksklusif Brankas Sultan (+8% Gaji /work).'
    },

    // ==========================================
    // 4. BOTTOM / CELANA BAWAHAN
    // ==========================================
    {
        id: 'bottom_shorts_black',
        slot: 'bottom',
        name: 'Celana Pendek Santai',
        emoji: '🩳',
        rarity: 'common',
        source: 'starter',
        isStarter: true,
        priceLp: 0,
        file: 'bottom/bottom_shorts_black.png',
        buffs: null,
        description: 'Celana pendek hitam nyaman untuk bersantai keliling kota.'
    },
    {
        id: 'bottom_jeans_blue',
        slot: 'bottom',
        name: 'Celana Jeans Biru',
        emoji: '👖',
        rarity: 'common',
        source: 'shop',
        isStarter: false,
        priceLp: 40000,
        file: 'bottom/bottom_jeans_blue.png',
        buffs: null,
        description: 'Celana denim biru klasik dengan jahitan kuat.'
    },
    {
        id: 'bottom_cargo_olive',
        slot: 'bottom',
        name: 'Celana Cargo Lapangan',
        emoji: '👖',
        rarity: 'uncommon',
        source: 'shop',
        isStarter: false,
        priceLp: 70000,
        file: 'bottom/bottom_cargo_olive.png',
        buffs: null,
        description: 'Celana lapangan hijau olive berkantong samping tangguh.'
    },
    {
        id: 'bottom_pants_formal',
        slot: 'bottom',
        name: 'Celana Bahan Eksekutif',
        emoji: '👖',
        rarity: 'uncommon',
        source: 'shop',
        isStarter: false,
        priceLp: 125000,
        file: 'bottom/bottom_pants_formal.png',
        buffs: null,
        description: 'Celana kain hitam berpotongan rapi lengkap dengan sabuk kulit.'
    },
    {
        id: 'bottom_sultan_gold',
        slot: 'bottom',
        name: 'Celana Sutra Lis Emas',
        emoji: '✨',
        rarity: 'epic',
        source: 'gacha',
        isStarter: false,
        priceLp: 0,
        file: 'bottom/bottom_sultan_gold.png',
        buffs: { workSalaryBonus: 0.04 },
        buffLabel: '+4% Gaji Seluruh Profesi',
        description: 'Celana sutra putih beraksen emas eksklusif Mystery Box Mall (+4% Gaji /work).'
    },

    // ==========================================
    // 5. SHOES / SEPATU & ALAS KAKI
    // ==========================================
    {
        id: 'shoes_sandal_jepit',
        slot: 'shoes',
        name: 'Sandal Jepit Legendaris',
        emoji: '🩴',
        rarity: 'common',
        source: 'shop',
        isStarter: false,
        priceLp: 15000,
        file: 'shoes/shoes_sandal_jepit.png',
        buffs: null,
        description: 'Sandal karet putih tali biru anti selip sejuta umat.'
    },
    {
        id: 'shoes_sneakers_white',
        slot: 'shoes',
        name: 'Sneakers Putih Kasual',
        emoji: '👟',
        rarity: 'common',
        source: 'shop',
        isStarter: false,
        priceLp: 60000,
        file: 'shoes/shoes_sneakers_white.png',
        buffs: null,
        description: 'Sepatu kets putih bersih yang cocok dipadukan dengan gaya apa pun.'
    },
    {
        id: 'shoes_boots_brown',
        slot: 'shoes',
        name: 'Sepatu Boots Kulit',
        emoji: '🥾',
        rarity: 'uncommon',
        source: 'shop',
        isStarter: false,
        priceLp: 110000,
        file: 'shoes/shoes_boots_brown.png',
        buffs: null,
        description: 'Sepatu boots kulit cokelat kokoh untuk medan berat.'
    },
    {
        id: 'shoes_pantofel_black',
        slot: 'shoes',
        name: 'Sepatu Pantofel Mengkilap',
        emoji: '👞',
        rarity: 'rare',
        source: 'shop',
        isStarter: false,
        priceLp: 165000,
        file: 'shoes/shoes_pantofel_black.png',
        buffs: null,
        description: 'Sepatu kulit hitam mengkilap pelengkap setelan formal.'
    },
    {
        id: 'shoes_hype_neon',
        slot: 'shoes',
        name: 'Sneakers Hypebeast Edisi Terbatas',
        emoji: '🔥',
        rarity: 'epic',
        source: 'gacha',
        isStarter: false,
        priceLp: 0,
        file: 'shoes/shoes_hype_neon.png',
        buffs: { workSalaryBonus: 0.04 },
        buffLabel: '+4% Gaji Seluruh Profesi',
        description: 'Sneakers kolaborasi langka dari Mystery Box Mall (+4% Gaji /work).'
    },

    // ==========================================
    // 6. HAT / TOPI & PELINDUNG KEPALA
    // ==========================================
    {
        id: 'hat_cap_black',
        slot: 'hat',
        name: 'Topi Baseball Hitam',
        emoji: '🧢',
        rarity: 'common',
        source: 'shop',
        isStarter: false,
        priceLp: 35000,
        file: 'hat/hat_cap_black.png',
        buffs: null,
        description: 'Topi baseball hitam kasual penghalau terik matahari.'
    },
    {
        id: 'hat_beanie_red',
        slot: 'hat',
        name: 'Kupluk Rajut Merah',
        emoji: '🧶',
        rarity: 'common',
        source: 'shop',
        isStarter: false,
        priceLp: 50000,
        file: 'hat/hat_beanie_red.png',
        buffs: null,
        description: 'Kupluk rajut merah hangat bergaya distro kota.'
    },
    {
        id: 'hat_straw_farmer',
        slot: 'hat',
        name: 'Topi Jerami Petani',
        emoji: '👒',
        rarity: 'rare',
        source: 'shop',
        isStarter: false,
        priceLp: 75000,
        file: 'hat/hat_straw_farmer.png',
        buffs: { farmingXpBonus: 0.10 },
        buffLabel: '+10% Farming EXP saat panen /farm',
        description: 'Topi anyaman jerami sejuk untuk pekebun sejati (+10% Farming EXP di /farm).'
    },
    {
        id: 'hat_helm_proyek',
        slot: 'hat',
        name: 'Helm Proyek Safety',
        emoji: '👷',
        rarity: 'rare',
        source: 'shop',
        isStarter: false,
        priceLp: 90000,
        file: 'hat/hat_helm_proyek.png',
        buffs: { miningAccidentReduction: 0.20 },
        buffLabel: '-20% Risiko Kecelakaan /mining',
        description: 'Helm safety kuning keras pelindung kepala (-20% risiko runtuhan batu /mining).'
    },
    {
        id: 'hat_crown_sultan',
        slot: 'hat',
        name: 'Mahkota Raja Emas',
        emoji: '👑',
        rarity: 'epic',
        source: 'gacha',
        isStarter: false,
        priceLp: 0,
        file: 'hat/hat_crown_sultan.png',
        buffs: { workSalaryBonus: 0.05 },
        buffLabel: '+5% Gaji Seluruh Profesi',
        description: 'Mahkota emas murni bertatahkan permata dari Brankas Sultan (+5% Gaji /work).'
    },

    // ==========================================
    // 7. ACCESSORY / AKSESORIS WAJAH & LEHER
    // ==========================================
    {
        id: 'acc_masker_medis',
        slot: 'accessory',
        name: 'Masker Kain Hitam',
        emoji: '😷',
        rarity: 'common',
        source: 'shop',
        isStarter: false,
        priceLp: 20000,
        file: 'accessory/acc_masker_medis.png',
        buffs: null,
        description: 'Masker kain hitam bergaya minimalis penangkal debu jalanan.'
    },
    {
        id: 'acc_glasses_black',
        slot: 'accessory',
        name: 'Kacamata Baca Hitam',
        emoji: '👓',
        rarity: 'common',
        source: 'shop',
        isStarter: false,
        priceLp: 40000,
        file: 'accessory/acc_glasses_black.png',
        buffs: null,
        description: 'Kacamata berbingkai hitam tebal untuk tampilan intelektual.'
    },
    {
        id: 'acc_sunglasses_aviator',
        slot: 'accessory',
        name: 'Kacamata Hitam Aviator',
        emoji: '🕶️',
        rarity: 'uncommon',
        source: 'shop',
        isStarter: false,
        priceLp: 85000,
        file: 'accessory/acc_sunglasses_aviator.png',
        buffs: null,
        description: 'Kacamata hitam gelap penambah aura keren maksimal.'
    },
    {
        id: 'acc_headphones',
        slot: 'accessory',
        name: 'Headphone Gaming Neon',
        emoji: '🎧',
        rarity: 'rare',
        source: 'gacha',
        isStarter: false,
        priceLp: 0,
        file: 'accessory/acc_headphones.png',
        buffs: { workSalaryBonus: 0.03 },
        buffLabel: '+3% Gaji Kerja di /work',
        description: 'Headphone kalung leher berlampu cyan dari Kapsul Warung (+3% Gaji /work).'
    }
];

const CLOTHING_MAP = new Map(CLOTHES.map(c => [c.id, c]));
const STARTER_CLOTHING_IDS = CLOTHES.filter(c => c.isStarter).map(c => c.id);

function getClothing(id) {
    if (!id) return null;
    return CLOTHING_MAP.get(String(id).toLowerCase()) || null;
}

function getClothingSlot(slotId) {
    if (!slotId) return null;
    return SLOT_MAP.get(String(slotId).toLowerCase()) || null;
}

function getClothesBySlot(slotId) {
    return CLOTHES.filter(c => c.slot === slotId);
}

function getShopClothes() {
    return CLOTHES.filter(c => c.source === 'shop' && c.priceLp > 0);
}

function getClothingAssetPath(clothingOrId) {
    const obj = typeof clothingOrId === 'string' ? getClothing(clothingOrId) : clothingOrId;
    if (!obj || !obj.file) return null;
    return path.join(ASSETS_AVATAR_ROOT, ...obj.file.split('/'));
}

module.exports = {
    AVATAR_CANVAS_SIZE,
    ASSETS_AVATAR_ROOT,
    CLOTHING_SLOTS,
    CLOTHES,
    STARTER_CLOTHING_IDS,
    getClothing,
    getClothingSlot,
    getClothesBySlot,
    getShopClothes,
    getClothingAssetPath
};
