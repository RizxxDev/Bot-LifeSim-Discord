const { CROPS } = require('./crops');
const { RECIPES } = require('./recipes');
const { getShopClothes } = require('./clothes');

const SHOPS = [
    { id: 'warung', name: 'Warung & Minimarket', emoji: '🏪', description: 'Kebutuhan makan dan minum sehari-hari dengan harga terjangkau.' },
    { id: 'restoran', name: 'Restoran Bintang Lima', emoji: '🍽️', description: 'Hidangan mewah yang memberikan efek buff sementara.' },
    { id: 'apotek', name: 'Apotek Sehat', emoji: '💊', description: 'Obat-obatan, vitamin, P3K, dan minuman berenergi.' },
    { id: 'perkakas', name: 'Toko Perkakas & Outdoor', emoji: '🔧', description: 'Pancingan, umpan, beliung tambang, helm, serta upgrade tas.' },
    { id: 'tani', name: 'Toko Tani & Dapur', emoji: '🌾', description: 'Bibit tanaman kebun, pupuk urea, dan tabung gas LPG untuk memasak.' },
    { id: 'elektronik', name: 'Toko Elektronik', emoji: '💻', description: 'Perangkat kerja penunjang karir profesional.' },
    { id: 'layanan', name: 'Kantor Layanan Publik', emoji: '📄', description: 'Pembuatan SIM, surat izin melaut, dan dokumen resmi.' },
    { id: 'busana', name: 'Butik & Distro Busana', emoji: '👕', description: 'Pakaian kasual, gaya rambut, sepatu, topi, & aksesoris untuk karakter chibimu (/wardrobe).' },
    { id: 'prestise', name: 'Butik Prestise', emoji: '👑', description: 'Gelar dan koleksi eksklusif penanda status warga.' }
];

const ITEMS = [
    // ==========================================
    // 1. WARUNG (Makanan & Minuman Pokok)
    // ==========================================
    {
        id: 'air_mineral',
        name: 'Air Mineral',
        emoji: '💧',
        shop: 'warung',
        tags: ['drink'],
        buyPrice: 4000,
        sellPrice: 1200,
        stackSize: 20,
        lockedPrice: true,
        effects: { thirst: 20 },
        description: 'Air mineral segar pelepas dahaga (+20 Thirst).'
    },
    {
        id: 'teh_manis',
        name: 'Teh Manis Hangat',
        emoji: '🍵',
        shop: 'warung',
        tags: ['drink'],
        buyPrice: 5000,
        sellPrice: 0,
        stackSize: 20,
        lockedPrice: true,
        effects: { thirst: 25, energy: 3 },
        description: 'Teh manis hangat (+25 Thirst, +3 Energy).'
    },
    {
        id: 'kopi',
        name: 'Kopi Hitam',
        emoji: '☕',
        shop: 'warung',
        tags: ['drink'],
        buyPrice: 8000,
        sellPrice: 0,
        stackSize: 20,
        caffeineType: 'kopi',
        effects: { thirst: 15, energy: 15 },
        description: 'Kopi penambah semangat (+15 Thirst, +15 Energy; kopi ke-3 dst hari ini +5 Energy).'
    },
    {
        id: 'mie_instan',
        name: 'Mie Instan',
        emoji: '🍜',
        shop: 'warung',
        tags: ['food'],
        buyPrice: 4000,
        sellPrice: 1500,
        stackSize: 20,
        lockedPrice: true,
        effects: { hunger: 20 },
        description: 'Penyelamat di tanggal tua (+20 Hunger).'
    },
    {
        id: 'roti',
        name: 'Roti Isi',
        emoji: '🥐',
        shop: 'warung',
        tags: ['food'],
        buyPrice: 6000,
        sellPrice: 2000,
        stackSize: 20,
        lockedPrice: true,
        effects: { hunger: 15 },
        description: 'Roti praktis pengganjal perut (+15 Hunger).'
    },
    {
        id: 'nasi_bungkus',
        name: 'Nasi Bungkus',
        emoji: '🍱',
        shop: 'warung',
        tags: ['food'],
        buyPrice: 15000,
        sellPrice: 0,
        stackSize: 20,
        lockedPrice: true,
        effects: { hunger: 45 },
        description: 'Nasi lauk lengkap porsi kenyang (+45 Hunger).'
    },
    {
        id: 'es_buah',
        name: 'Es Buah Segar',
        emoji: '🍧',
        shop: 'warung',
        tags: ['food', 'drink'],
        buyPrice: 12000,
        sellPrice: 0,
        stackSize: 20,
        effects: { hunger: 10, thirst: 30 },
        description: 'Segar dan manis, bisa dimakan atau diminum (+10 Hunger, +30 Thirst).'
    },
    {
        id: 'jus_buah',
        name: 'Jus Buah Murni',
        emoji: '🧃',
        shop: 'warung',
        tags: ['drink'],
        buyPrice: 15000,
        sellPrice: 0,
        stackSize: 20,
        effects: { thirst: 40, health: 2 },
        description: 'Jus buah kaya vitamin (+40 Thirst, +2 Health).'
    },
    {
        id: 'nasi_padang',
        name: 'Nasi Padang Spesial',
        emoji: '🍛',
        shop: 'warung',
        tags: ['food'],
        buyPrice: 25000,
        sellPrice: 0,
        stackSize: 20,
        effects: { hunger: 65, health: 3 },
        description: 'Nasi rendang porsi mantap (+65 Hunger, +3 Health).'
    },

    // ==========================================
    // 2. RESTORAN (Makanan Premium + Buff)
    // ==========================================
    {
        id: 'steak_wagyu',
        name: 'Wagyu Steak',
        emoji: '🥩',
        shop: 'restoran',
        tags: ['food'],
        buyPrice: 150000,
        sellPrice: 0,
        stackSize: 20,
        effects: { hunger: 80, health: 5 },
        buff: { type: 'xp_boost', multiplier: 1.10, durationSec: 3600, label: '+10% EXP (1 jam)' },
        description: 'Steak premium (+80 Hunger, +5 Health, Buff +10% EXP selama 1 jam).'
    },
    {
        id: 'seafood_platter',
        name: 'Royal Seafood Platter',
        emoji: '🦞',
        shop: 'restoran',
        tags: ['food'],
        buyPrice: 250000,
        sellPrice: 0,
        stackSize: 20,
        effects: { hunger: 90, thirst: 20, health: 10 },
        buff: { type: 'luck_boost', multiplier: 0.05, durationSec: 3600, label: '+5% Rarity (1 jam)' },
        description: 'Hidangan laut mewah (+90 Hunger, +20 Thirst, Buff +5% Rarity selama 1 jam).'
    },

    // ==========================================
    // 3. APOTEK
    // ==========================================
    {
        id: 'paracetamol',
        name: 'Paracetamol',
        emoji: '💊',
        shop: 'apotek',
        tags: ['medicine'],
        buyPrice: 10000,
        sellPrice: 0,
        stackSize: 20,
        lockedPrice: true,
        effects: { health: 10 },
        description: 'Obat pereda nyeri dan demam ringan (+10 Health).'
    },
    {
        id: 'vitamin_c',
        name: 'Vitamin C Dosis Tinggi',
        emoji: '🍊',
        shop: 'apotek',
        tags: ['medicine'],
        buyPrice: 15000,
        sellPrice: 0,
        stackSize: 20,
        effects: { health: 5 },
        buff: { type: 'health_regen', multiplier: 2.0, durationSec: 7200, label: 'Regen Health 2x (2 jam)' },
        description: 'Suplemen daya tahan tubuh (+5 Health, Regen Health 2x selama 2 jam).'
    },
    {
        id: 'perban',
        name: 'Perban Steril',
        emoji: '🩹',
        shop: 'apotek',
        tags: ['medicine'],
        buyPrice: 20000,
        sellPrice: 0,
        stackSize: 20,
        effects: { health: 20 },
        description: 'Perban untuk merawat luka kerja atau tambang (+20 Health).'
    },
    {
        id: 'kotak_p3k',
        name: 'Kotak P3K Lengkap',
        emoji: '🧰',
        shop: 'apotek',
        tags: ['medicine'],
        buyPrice: 75000,
        sellPrice: 0,
        stackSize: 20,
        effects: { health: 50 },
        description: 'Perlengkapan medis darurat (+50 Health).'
    },
    {
        id: 'energy_drink',
        name: 'Minuman Berenergi',
        emoji: '⚡',
        shop: 'apotek',
        tags: ['drink', 'medicine'],
        buyPrice: 12000,
        sellPrice: 0,
        stackSize: 20,
        caffeineType: 'energy_drink',
        effects: { energy: 25, thirst: 10 },
        description: 'Memulihkan stamina dengan cepat (+25 Energy, +10 Thirst; botol ke-3 dst hari ini +8 Energy).'
    },

    // ==========================================
    // 4. PERKAKAS (Alat Pancing, Umpan, Tambang)
    // ==========================================
    {
        id: 'pancing_bambu',
        name: 'Pancingan Bambu',
        emoji: '🎋',
        shop: 'perkakas',
        tags: ['tool', 'fishing_rod'],
        toolTier: 1,
        buyPrice: 50000,
        sellPrice: 0,
        stackSize: 1,
        maxDurability: 100,
        rarityBonus: 0.00,
        lockedPrice: true,
        description: 'Pancingan dasar untuk memancing di Sungai (Durability 100, Bonus Rarity +0%).'
    },
    {
        id: 'pancing_fiberglass',
        name: 'Pancingan Fiberglass',
        emoji: '🎣',
        shop: 'perkakas',
        tags: ['tool', 'fishing_rod'],
        toolTier: 2,
        buyPrice: 350000,
        sellPrice: 0,
        stackSize: 1,
        maxDurability: 250,
        rarityBonus: 0.10,
        description: 'Pancingan lentur dan kuat, membuka akses Danau (Durability 250, Bonus Rarity +10%).'
    },
    {
        id: 'pancing_carbon',
        name: 'Pancingan Carbon',
        emoji: '🎣',
        shop: 'perkakas',
        tags: ['tool', 'fishing_rod'],
        toolTier: 3,
        buyPrice: 1500000,
        sellPrice: 0,
        stackSize: 1,
        maxDurability: 350,
        rarityBonus: 0.25,
        description: 'Joran serat karbon ringan untuk memancing di Laut (Durability 350, Bonus Rarity +25%).'
    },
    {
        id: 'pancing_pro',
        name: 'Pancingan Pro Titanium',
        emoji: '🏆',
        shop: 'perkakas',
        tags: ['tool', 'fishing_rod'],
        toolTier: 4,
        buyPrice: 6000000,
        sellPrice: 0,
        stackSize: 1,
        maxDurability: 500,
        rarityBonus: 0.45,
        description: 'Pancingan kelas turnamen dengan akurasi tertinggi (Durability 500, Bonus Rarity +45%).'
    },
    {
        id: 'umpan_cacing',
        name: 'Umpan Cacing Tanah',
        emoji: '🪱',
        shop: 'perkakas',
        tags: ['bait'],
        buyPrice: 1000,
        sellPrice: 400,
        stackSize: 100,
        lockedPrice: true,
        rarityBonus: 0.00,
        minBoostTier: 'uncommon',
        description: 'Umpan standar segala jenis ikan air tawar.'
    },
    {
        id: 'umpan_udang',
        name: 'Umpan Udang Segar',
        emoji: '🦐',
        shop: 'perkakas',
        tags: ['bait'],
        buyPrice: 3000,
        sellPrice: 0,
        stackSize: 100,
        rarityBonus: 0.15,
        minBoostTier: 'uncommon',
        description: 'Umpan favorit ikan menengah (+15% peluang Uncommon ke atas).'
    },
    {
        id: 'umpan_pro',
        name: 'Umpan Lure Pro',
        emoji: '🐟',
        shop: 'perkakas',
        tags: ['bait'],
        buyPrice: 8000,
        sellPrice: 0,
        stackSize: 100,
        rarityBonus: 0.30,
        minBoostTier: 'rare',
        description: 'Umpan racikan khusus ikan predator (+30% peluang Rare ke atas).'
    },
    {
        id: 'beliung_batu',
        name: 'Beliung Batu',
        emoji: '🪨',
        shop: 'perkakas',
        tags: ['tool', 'pickaxe'],
        toolTier: 1,
        buyPrice: 60000,
        sellPrice: 0,
        stackSize: 1,
        maxDurability: 100,
        rarityBonus: 0.00,
        lockedPrice: true,
        description: 'Beliung sederhana untuk Tambang Batu (Durability 100, Bonus Rarity +0%).'
    },
    {
        id: 'beliung_besi',
        name: 'Beliung Besi',
        emoji: '⛏️',
        shop: 'perkakas',
        tags: ['tool', 'pickaxe'],
        toolTier: 2,
        buyPrice: 400000,
        sellPrice: 0,
        stackSize: 1,
        maxDurability: 250,
        rarityBonus: 0.10,
        description: 'Beliung besi kokoh untuk Tambang Tembaga (Durability 250, Bonus Rarity +10%).'
    },
    {
        id: 'beliung_baja',
        name: 'Beliung Baja Tempa',
        emoji: '⚒️',
        shop: 'perkakas',
        tags: ['tool', 'pickaxe'],
        toolTier: 3,
        buyPrice: 1800000,
        sellPrice: 0,
        stackSize: 1,
        maxDurability: 350,
        rarityBonus: 0.25,
        description: 'Beliung baja untuk menembus Tambang Emas (Durability 350, Bonus Rarity +25%).'
    },
    {
        id: 'beliung_titanium',
        name: 'Beliung Titanium',
        emoji: '💎',
        shop: 'perkakas',
        tags: ['tool', 'pickaxe'],
        toolTier: 4,
        buyPrice: 7000000,
        sellPrice: 0,
        stackSize: 1,
        maxDurability: 500,
        rarityBonus: 0.45,
        description: 'Beliung terbaik untuk Tambang Berlian (Durability 500, Bonus Rarity +45%).'
    },
    {
        id: 'helm_tambang',
        name: 'Helm Keselamatan Tambang',
        emoji: '⛑️',
        shop: 'perkakas',
        tags: ['tool', 'helmet'],
        toolTier: 1,
        buyPrice: 120000,
        sellPrice: 0,
        stackSize: 1,
        maxDurability: 200,
        description: 'Mengurangi risiko kecelakaan tambang sebesar 70% dan wajib untuk tambang dalam (Durability 200).'
    },

    // ==========================================
    // 5. ELEKTRONIK
    // ==========================================
    {
        id: 'laptop',
        name: 'Laptop Kerja',
        emoji: '💻',
        shop: 'elektronik',
        tags: ['device', 'license'],
        buyPrice: 4500000,
        sellPrice: 0,
        stackSize: 0, // Tidak memakan slot tas
        description: 'Syarat wajib untuk melamar pekerjaan Staff Admin dan Programmer.'
    },

    // ==========================================
    // 6. KANTOR LAYANAN PUBLIK
    // ==========================================
    {
        id: 'sim_c',
        name: 'SIM C',
        emoji: '🪪',
        shop: 'layanan',
        tags: ['license'],
        buyPrice: 100000,
        sellPrice: 0,
        stackSize: 0,
        description: 'Surat Izin Mengemudi kendaraan roda dua. Syarat melamar Ojek Online.'
    },
    {
        id: 'sim_a',
        name: 'SIM A',
        emoji: '🪪',
        shop: 'layanan',
        tags: ['license'],
        buyPrice: 150000,
        sellPrice: 0,
        stackSize: 0,
        description: 'Surat Izin Mengemudi kendaraan roda empat (Mobil). Syarat melamar Taksi Online & Sopir Pribadi.'
    },
    {
        id: 'izin_melaut',
        name: 'Surat Izin Melaut',
        emoji: '⚓',
        shop: 'layanan',
        tags: ['license'],
        buyPrice: 50000,
        sellPrice: 0,
        stackSize: 0,
        buff: { type: 'sea_permit', multiplier: 1.0, durationSec: 86400, label: 'Izin Melaut (24 jam)' },
        description: 'Memberikan akses memancing di Laut Lepas selama 24 jam (gunakan lewat /use atau otomatis aktif saat dibeli).'
    },
    {
        id: 'surat_ganti_nama',
        name: 'Akta Ganti Nama Resmi',
        emoji: '📜',
        shop: 'layanan',
        tags: ['service'],
        buyPrice: 2500000,
        sellPrice: 0,
        stackSize: 20,
        description: 'Dokumen resmi untuk mengganti username karakter (/use surat_ganti_nama).'
    },

    // ==========================================
    // 7. BUTIK PRESTISE (Kosmetik / Title)
    // ==========================================
    {
        id: 'title_pekerja_keras',
        name: 'Gelar: Pekerja Teladan',
        emoji: '🎖️',
        shop: 'prestise',
        tags: ['prestise'],
        titleLabel: '🎖️ Pekerja Teladan',
        buyPrice: 10000000,
        sellPrice: 0,
        stackSize: 0,
        description: 'Menampilkan gelar "🎖️ Pekerja Teladan" di kartu /profile Anda.'
    },
    {
        id: 'title_tokoh_masyarakat',
        name: 'Gelar: Tokoh Masyarakat',
        emoji: '🏅',
        shop: 'prestise',
        tags: ['prestise'],
        titleLabel: '🏅 Tokoh Masyarakat',
        buyPrice: 25000000,
        sellPrice: 0,
        stackSize: 0,
        description: 'Menampilkan gelar "🏅 Tokoh Masyarakat" di kartu /profile Anda.'
    },
    {
        id: 'title_juragan_kota',
        name: 'Gelar: Juragan Kota',
        emoji: '🎩',
        shop: 'prestise',
        tags: ['prestise'],
        titleLabel: '🎩 Juragan Kota',
        buyPrice: 50000000,
        sellPrice: 0,
        stackSize: 0,
        description: 'Menampilkan gelar "🎩 Juragan Kota" di kartu /profile Anda.'
    },
    {
        id: 'title_konglomerat',
        name: 'Gelar: Konglomerat Muda',
        emoji: '💎',
        shop: 'prestise',
        tags: ['prestise'],
        titleLabel: '💎 Konglomerat Muda',
        buyPrice: 100000000,
        sellPrice: 0,
        stackSize: 0,
        description: 'Menampilkan gelar "💎 Konglomerat Muda" di kartu /profile Anda.'
    },
    {
        id: 'title_sultan_raya',
        name: 'Gelar: Sultan Raya',
        emoji: '👑',
        shop: 'prestise',
        tags: ['prestise'],
        titleLabel: '👑 Sultan Raya',
        buyPrice: 250000000,
        sellPrice: 0,
        stackSize: 0,
        description: 'Menampilkan gelar eksklusif "👑 Sultan Raya" di kartu /profile Anda.'
    },
    {
        id: 'title_legenda_hidup',
        name: 'Gelar: Legenda Hidup',
        emoji: '🐉',
        shop: 'prestise',
        tags: ['prestise'],
        titleLabel: '🐉 Legenda Hidup',
        buyPrice: 1000000000,
        sellPrice: 0,
        stackSize: 0,
        description: 'Simbol puncak kesuksesan tertinggi di Life Simulation.'
    },

    // ==========================================
    // 8. HASIL FISHING & BIN — SAMPAH / RONGSOKAN (Bank Sampah)
    // ==========================================
    {
        id: 'sampah_sandal',
        name: 'Sandal Jepit Putus',
        emoji: '🩴',
        tags: ['trash'],
        rarity: 'trash',
        buyPrice: 0,
        sellPrice: 750,
        baseSupplyThreshold: 500,
        stackSize: 20,
        description: 'Sandal jepit putus yang bisa didaur ulang di Bank Sampah.'
    },
    {
        id: 'sampah_kaleng',
        name: 'Kaleng Karatan',
        emoji: '🥫',
        tags: ['trash'],
        rarity: 'trash',
        buyPrice: 0,
        sellPrice: 900,
        baseSupplyThreshold: 500,
        stackSize: 20,
        description: 'Kaleng bekas yang bisa dijual ke pengepul rongsokan.'
    },
    {
        id: 'sampah_botol',
        name: 'Botol Plastik Bekas',
        emoji: '🍾',
        tags: ['trash'],
        rarity: 'trash',
        buyPrice: 0,
        sellPrice: 800,
        baseSupplyThreshold: 500,
        stackSize: 20,
        description: 'Botol plastik yang bisa dijual ke Bank Sampah.'
    },
    {
        id: 'sampah_kardus',
        name: 'Kardus Bekas Lipat',
        emoji: '📦',
        tags: ['trash'],
        rarity: 'trash',
        buyPrice: 0,
        sellPrice: 1500,
        baseSupplyThreshold: 400,
        stackSize: 20,
        description: 'Kardus tebal hasil memulung di tempat sampah kota (/bin).'
    },
    {
        id: 'sampah_besi',
        name: 'Besi Tua Karatan',
        emoji: '🔩',
        tags: ['trash'],
        rarity: 'common',
        buyPrice: 0,
        sellPrice: 3000,
        baseSupplyThreshold: 300,
        stackSize: 20,
        description: 'Potongan besi tua bernilai jual lumayan di pengepul rongsokan.'
    },
    {
        id: 'sampah_radio',
        name: 'Radio Tua Rusak',
        emoji: '📻',
        tags: ['trash'],
        rarity: 'uncommon',
        buyPrice: 0,
        sellPrice: 6500,
        baseSupplyThreshold: 180,
        stackSize: 10,
        description: 'Komponen elektronik bekas dari tempat sampah yang dicari tukang servis.'
    },
    {
        id: 'sampah_hp',
        name: 'Bangkai HP Mati Total',
        emoji: '📱',
        tags: ['trash'],
        rarity: 'rare',
        buyPrice: 0,
        sellPrice: 12000,
        baseSupplyThreshold: 120,
        stackSize: 10,
        description: 'Bangkai ponsel rongsokan dengan komponen kanibal bernilai tinggi.'
    },

    // ==========================================
    // 9. HASIL FISHING — IKAN (Pasar Ikan)
    // ==========================================
    // Sungai
    {
        id: 'ikan_mujair',
        name: 'Ikan Mujair',
        emoji: '🐟',
        tags: ['fish', 'food'],
        rarity: 'common',
        locationId: 'sungai',
        buyPrice: 0,
        sellPrice: 6000,
        baseSupplyThreshold: 200,
        stackSize: 20,
        effects: { hunger: 15 },
        description: 'Ikan air tawar umum. Bisa dijual di Pasar Ikan atau langsung dimakan (+15 Hunger).'
    },
    {
        id: 'ikan_lele',
        name: 'Ikan Lele',
        emoji: '🐟',
        tags: ['fish', 'food'],
        rarity: 'common',
        locationId: 'sungai',
        buyPrice: 0,
        sellPrice: 7000,
        baseSupplyThreshold: 200,
        stackSize: 20,
        effects: { hunger: 18 },
        description: 'Lele sungai segar. Bisa dijual atau dibakar untuk makan (+18 Hunger).'
    },
    {
        id: 'ikan_nila',
        name: 'Ikan Nila Merah',
        emoji: '🐠',
        tags: ['fish', 'food'],
        rarity: 'uncommon',
        locationId: 'sungai',
        buyPrice: 0,
        sellPrice: 12000,
        baseSupplyThreshold: 120,
        stackSize: 20,
        effects: { hunger: 22 },
        description: 'Nila berdaging tebal (+22 Hunger jika dimakan).'
    },
    {
        id: 'ikan_gurame',
        name: 'Ikan Gurame',
        emoji: '🐠',
        tags: ['fish', 'food'],
        rarity: 'uncommon',
        locationId: 'sungai',
        buyPrice: 0,
        sellPrice: 15000,
        baseSupplyThreshold: 100,
        stackSize: 20,
        effects: { hunger: 28 },
        description: 'Ikan gurame favorit restoran (+28 Hunger jika dimakan).'
    },
    {
        id: 'ikan_patin',
        name: 'Ikan Patin Besar',
        emoji: '🐡',
        tags: ['fish'],
        rarity: 'rare',
        locationId: 'sungai',
        buyPrice: 0,
        sellPrice: 35000,
        baseSupplyThreshold: 50,
        stackSize: 20,
        description: 'Ikan patin sungai berukuran besar yang bernilai tinggi.'
    },
    {
        id: 'ikan_belida',
        name: 'Ikan Belida',
        emoji: '🦈',
        tags: ['fish'],
        rarity: 'epic',
        locationId: 'sungai',
        buyPrice: 0,
        sellPrice: 90000,
        baseSupplyThreshold: 25,
        stackSize: 20,
        description: 'Ikan sungai langka berbentuk pipih keperakan.'
    },
    {
        id: 'ikan_arwana',
        name: 'Arwana Super Red',
        emoji: '🐉',
        tags: ['fish'],
        rarity: 'legendary',
        locationId: 'sungai',
        buyPrice: 0,
        sellPrice: 600000,
        baseSupplyThreshold: 8,
        stackSize: 20,
        description: 'Raja sungai berharga fantastis yang diburu para kolektor!'
    },

    // Danau
    {
        id: 'ikan_mas',
        name: 'Ikan Mas Danau',
        emoji: '🐟',
        tags: ['fish', 'food'],
        rarity: 'common',
        locationId: 'danau',
        buyPrice: 0,
        sellPrice: 10000,
        baseSupplyThreshold: 180,
        stackSize: 20,
        effects: { hunger: 20 },
        description: 'Ikan mas segar dari perairan danau (+20 Hunger).'
    },
    {
        id: 'ikan_tawes',
        name: 'Ikan Tawes',
        emoji: '🐟',
        tags: ['fish', 'food'],
        rarity: 'common',
        locationId: 'danau',
        buyPrice: 0,
        sellPrice: 9000,
        baseSupplyThreshold: 180,
        stackSize: 20,
        effects: { hunger: 18 },
        description: 'Ikan danau bersisik perak (+18 Hunger).'
    },
    {
        id: 'ikan_gabus',
        name: 'Ikan Gabus',
        emoji: '🐠',
        tags: ['fish', 'food'],
        rarity: 'uncommon',
        locationId: 'danau',
        buyPrice: 0,
        sellPrice: 22000,
        baseSupplyThreshold: 100,
        stackSize: 20,
        effects: { hunger: 25, health: 3 },
        description: 'Kaya albumin untuk pemulihan tubuh (+25 Hunger, +3 Health).'
    },
    {
        id: 'ikan_baung',
        name: 'Ikan Baung',
        emoji: '🐠',
        tags: ['fish', 'food'],
        rarity: 'uncommon',
        locationId: 'danau',
        buyPrice: 0,
        sellPrice: 25000,
        baseSupplyThreshold: 90,
        stackSize: 20,
        effects: { hunger: 28 },
        description: 'Ikan predator danau yang gurih (+28 Hunger).'
    },
    {
        id: 'ikan_toman',
        name: 'Ikan Toman Giant',
        emoji: '🐡',
        tags: ['fish'],
        rarity: 'rare',
        locationId: 'danau',
        buyPrice: 0,
        sellPrice: 60000,
        baseSupplyThreshold: 45,
        stackSize: 20,
        description: 'Predator ganas penghuni danau dalam.'
    },
    {
        id: 'ikan_sidat',
        name: 'Sidat Raksasa',
        emoji: '🐍',
        tags: ['fish'],
        rarity: 'epic',
        locationId: 'danau',
        buyPrice: 0,
        sellPrice: 150000,
        baseSupplyThreshold: 20,
        stackSize: 20,
        description: 'Belut danau langka bernutrisi tinggi.'
    },
    {
        id: 'ikan_arapaima',
        name: 'Arapaima Gigas',
        emoji: '🐋',
        tags: ['fish'],
        rarity: 'legendary',
        locationId: 'danau',
        buyPrice: 0,
        sellPrice: 1200000,
        baseSupplyThreshold: 6,
        stackSize: 20,
        description: 'Monster purba raksasa penghuni dasar danau!'
    },

    // Laut
    {
        id: 'ikan_kembung',
        name: 'Ikan Kembung',
        emoji: '🐟',
        tags: ['fish', 'food'],
        rarity: 'common',
        locationId: 'laut',
        buyPrice: 0,
        sellPrice: 18000,
        baseSupplyThreshold: 160,
        stackSize: 20,
        effects: { hunger: 25 },
        description: 'Ikan laut segar bergizi tinggi (+25 Hunger).'
    },
    {
        id: 'ikan_tongkol',
        name: 'Ikan Tongkol',
        emoji: '🐟',
        tags: ['fish', 'food'],
        rarity: 'common',
        locationId: 'laut',
        buyPrice: 0,
        sellPrice: 20000,
        baseSupplyThreshold: 160,
        stackSize: 20,
        effects: { hunger: 28 },
        description: 'Ikan laut berdaging padat (+28 Hunger).'
    },
    {
        id: 'ikan_kakap',
        name: 'Kakap Merah',
        emoji: '🐠',
        tags: ['fish', 'food'],
        rarity: 'uncommon',
        locationId: 'laut',
        buyPrice: 0,
        sellPrice: 45000,
        baseSupplyThreshold: 80,
        stackSize: 20,
        effects: { hunger: 30 },
        description: 'Kakap merah segar kualitas ekspor (+30 Hunger).'
    },
    {
        id: 'ikan_kerapu',
        name: 'Kerapu Macan',
        emoji: '🐠',
        tags: ['fish', 'food'],
        rarity: 'uncommon',
        locationId: 'laut',
        buyPrice: 0,
        sellPrice: 55000,
        baseSupplyThreshold: 75,
        stackSize: 20,
        effects: { hunger: 30 },
        description: 'Kerapu karang incaran restoran bintang lima (+30 Hunger).'
    },
    {
        id: 'ikan_tuna_kuning',
        name: 'Tuna Sirip Kuning',
        emoji: '🐡',
        tags: ['fish'],
        rarity: 'rare',
        locationId: 'laut',
        buyPrice: 0,
        sellPrice: 120000,
        baseSupplyThreshold: 40,
        stackSize: 20,
        description: 'Yellowfin Tuna perairan lepas.'
    },
    {
        id: 'ikan_layaran',
        name: 'Ikan Layaran (Sailfish)',
        emoji: '🦈',
        tags: ['fish'],
        rarity: 'epic',
        locationId: 'laut',
        buyPrice: 0,
        sellPrice: 350000,
        baseSupplyThreshold: 15,
        stackSize: 20,
        description: 'Perenang tercepat di samudra dengan sirip punggung megah.'
    },
    {
        id: 'ikan_tuna_biru',
        name: 'Tuna Sirip Biru Raksasa',
        emoji: '🐳',
        tags: ['fish'],
        rarity: 'legendary',
        locationId: 'laut',
        buyPrice: 0,
        sellPrice: 2500000,
        baseSupplyThreshold: 5,
        stackSize: 20,
        description: 'Tangkapan legendaris bernilai jutaan Lp di pelelangan ikan!'
    },

    // ==========================================
    // 10. HASIL MINING — MINERAL (Pengepul Tambang)
    // ==========================================
    {
        id: 'batu_kapur',
        name: 'Batu Kapur',
        emoji: '🪨',
        tags: ['mineral'],
        rarity: 'common',
        locationId: 'tambang_batu',
        buyPrice: 0,
        sellPrice: 1500,
        baseSupplyThreshold: 350,
        stackSize: 20,
        description: 'Batu galian bahan bangunan dasar.'
    },
    {
        id: 'batubara',
        name: 'Batubara',
        emoji: '⚫',
        tags: ['mineral'],
        rarity: 'common',
        locationId: 'tambang_batu',
        buyPrice: 0,
        sellPrice: 5000,
        baseSupplyThreshold: 250,
        stackSize: 20,
        description: 'Bongkahan batubara sumber energi industri.'
    },
    {
        id: 'bijih_besi',
        name: 'Bijih Besi',
        emoji: '🔩',
        tags: ['mineral'],
        rarity: 'uncommon',
        locationId: 'tambang_batu',
        buyPrice: 0,
        sellPrice: 12000,
        baseSupplyThreshold: 140,
        stackSize: 20,
        description: 'Bijih logam besi berkualitas baik.'
    },
    {
        id: 'kuarsa',
        name: 'Kristal Kuarsa',
        emoji: '🔮',
        tags: ['mineral'],
        rarity: 'rare',
        locationId: 'tambang_batu',
        buyPrice: 0,
        sellPrice: 35000,
        baseSupplyThreshold: 60,
        stackSize: 20,
        description: 'Kristal kuarsa bening berkilau.'
    },
    {
        id: 'fosil_purba',
        name: 'Fosil Purba Utuh',
        emoji: '🦴',
        tags: ['mineral'],
        rarity: 'epic',
        locationId: 'tambang_batu',
        buyPrice: 0,
        sellPrice: 120000,
        baseSupplyThreshold: 20,
        stackSize: 20,
        description: 'Fosil makhluk prasejarah yang dicari museum.'
    },
    {
        id: 'geode_ametis',
        name: 'Geode Ametis Ungu',
        emoji: '🟣',
        tags: ['mineral'],
        rarity: 'legendary',
        locationId: 'tambang_batu',
        buyPrice: 0,
        sellPrice: 400000,
        baseSupplyThreshold: 8,
        stackSize: 20,
        description: 'Batu rongga berisi kristal ametis ungu sempurna!'
    },

    // Tambang Tembaga
    {
        id: 'bijih_tembaga',
        name: 'Bijih Tembaga',
        emoji: '🟠',
        tags: ['mineral'],
        rarity: 'common',
        locationId: 'tambang_tembaga',
        buyPrice: 0,
        sellPrice: 15000,
        baseSupplyThreshold: 180,
        stackSize: 20,
        description: 'Logam tembaga penghantar listrik utama.'
    },
    {
        id: 'bijih_timah',
        name: 'Bijih Timah',
        emoji: '⚪',
        tags: ['mineral'],
        rarity: 'common',
        locationId: 'tambang_tembaga',
        buyPrice: 0,
        sellPrice: 18000,
        baseSupplyThreshold: 160,
        stackSize: 20,
        description: 'Bijih timah putih bersih.'
    },
    {
        id: 'bijih_perak',
        name: 'Bijih Perak',
        emoji: '🥈',
        tags: ['mineral'],
        rarity: 'uncommon',
        locationId: 'tambang_tembaga',
        buyPrice: 0,
        sellPrice: 50000,
        baseSupplyThreshold: 90,
        stackSize: 20,
        description: 'Logam mulia perak berkilau.'
    },
    {
        id: 'batu_giok',
        name: 'Batu Giok Hijau',
        emoji: '🟢',
        tags: ['mineral'],
        rarity: 'rare',
        locationId: 'tambang_tembaga',
        buyPrice: 0,
        sellPrice: 150000,
        baseSupplyThreshold: 40,
        stackSize: 20,
        description: 'Permata giok hijau pekat.'
    },
    {
        id: 'safir_biru',
        name: 'Permata Safir Biru',
        emoji: '🔷',
        tags: ['mineral'],
        rarity: 'epic',
        locationId: 'tambang_tembaga',
        buyPrice: 0,
        sellPrice: 500000,
        baseSupplyThreshold: 15,
        stackSize: 20,
        description: 'Batu permata safir biru berkualitas tinggi.'
    },
    {
        id: 'kristal_langka',
        name: 'Kristal Inti Bumi',
        emoji: '✨',
        tags: ['mineral'],
        rarity: 'legendary',
        locationId: 'tambang_tembaga',
        buyPrice: 0,
        sellPrice: 1500000,
        baseSupplyThreshold: 5,
        stackSize: 20,
        description: 'Kristal langka bercahaya alami dari perut bumi!'
    },

    // Tambang Emas & Berlian
    {
        id: 'bijih_emas',
        name: 'Bijih Emas',
        emoji: '🪙',
        tags: ['mineral'],
        rarity: 'uncommon',
        locationId: 'tambang_emas',
        buyPrice: 0,
        sellPrice: 140000,
        baseSupplyThreshold: 70,
        stackSize: 20,
        description: 'Urat emas murni di dalam batuan kuarsa.'
    },
    {
        id: 'permata_rubi',
        name: 'Permata Rubi Merah',
        emoji: '♦️',
        tags: ['mineral'],
        rarity: 'rare',
        locationId: 'tambang_emas',
        buyPrice: 0,
        sellPrice: 400000,
        baseSupplyThreshold: 30,
        stackSize: 20,
        description: 'Batu mirah delima merah menyala.'
    },
    {
        id: 'emas_murni',
        name: 'Batangan Emas Murni',
        emoji: '🥇',
        tags: ['mineral'],
        rarity: 'epic',
        locationId: 'tambang_emas',
        buyPrice: 0,
        sellPrice: 1500000,
        baseSupplyThreshold: 12,
        stackSize: 20,
        description: ' Bongkahan emas 24 karat siap lebur.'
    },
    {
        id: 'bongkahan_emas_raksasa',
        name: 'Bongkahan Emas Raksasa',
        emoji: '🏆',
        tags: ['mineral'],
        rarity: 'legendary',
        locationId: 'tambang_emas',
        buyPrice: 0,
        sellPrice: 3000000,
        baseSupplyThreshold: 4,
        stackSize: 20,
        description: 'Temuan emas terbesar sepanjang sejarah tambang!'
    },
    {
        id: 'permata_zamrud',
        name: 'Permata Zamrud',
        emoji: '💚',
        tags: ['mineral'],
        rarity: 'rare',
        locationId: 'tambang_berlian',
        buyPrice: 0,
        sellPrice: 300000,
        baseSupplyThreshold: 35,
        stackSize: 20,
        description: 'Zamrud hijau zamrud tanpa cacat.'
    },
    {
        id: 'berlian_kasar',
        name: 'Berlian Kasar',
        emoji: '💠',
        tags: ['mineral'],
        rarity: 'epic',
        locationId: 'tambang_berlian',
        buyPrice: 0,
        sellPrice: 900000,
        baseSupplyThreshold: 15,
        stackSize: 20,
        description: 'Berlian murni bertekanan tinggi.'
    },
    {
        id: 'berlian_biru',
        name: 'Berlian Biru Abadi',
        emoji: '💎',
        tags: ['mineral'],
        rarity: 'legendary',
        locationId: 'tambang_berlian',
        buyPrice: 0,
        sellPrice: 4000000,
        baseSupplyThreshold: 4,
        stackSize: 20,
        description: 'Permata paling langka dan paling berharga di dunia!'
    },

    // ==========================================
    // 10. RILIS 2A: PENYIMPANAN & SISTEM BASI
    // ==========================================
    {
        id: 'cooler_box',
        name: 'Cooler Box Portabel',
        emoji: '🧊',
        shop: 'perkakas',
        tags: ['device', 'storage'],
        buyPrice: 150000,
        sellPrice: 0,
        stackSize: 0,
        storageSlots: 8,
        description: 'Kotak pendingin portabel (8 slot) yang memperlambat proses basi hingga 2× lipat tanpa perlu rumah.'
    },
    {
        id: 'bahan_basi',
        name: 'Bahan Basi',
        emoji: '🤢',
        shop: null,
        tags: ['trash', 'spoiled'],
        buyPrice: 0,
        sellPrice: 300,
        baseSupplyThreshold: 500,
        stackSize: 20,
        description: 'Sisa ikan/makanan yang telah melewati batas kesegaran. Bisa dijual ke Bank Sampah (Lp 300) atau diolah jadi Kompos.'
    },

    // ==========================================
    // 11. RILIS 2B: PERTANIAN & MEMASAK
    // ==========================================
    {
        id: 'pupuk_urea',
        name: 'Pupuk Urea',
        emoji: '🧪',
        shop: 'tani',
        tags: ['fertilizer'],
        buyPrice: 5000,
        sellPrice: 0,
        stackSize: 20,
        description: 'Pupuk kimia yang mempercepat durasi tumbuh tanaman sebesar 25%.'
    },
    {
        id: 'kompos',
        name: 'Pupuk Kompos Organik',
        emoji: '🌱',
        shop: null,
        tags: ['fertilizer'],
        buyPrice: 0,
        sellPrice: 1200,
        baseSupplyThreshold: 200,
        stackSize: 20,
        description: 'Pupuk hasil daur ulang 5 Bahan Basi (/farm kompos). Menambah hasil panen +1 unit.'
    },
    {
        id: 'gas_lpg',
        name: 'Tabung Gas LPG 3Kg',
        emoji: '🔥',
        shop: 'tani',
        tags: ['fuel', 'service'],
        buyPrice: 20000,
        sellPrice: 0,
        stackSize: 20,
        lpgCharges: 10,
        description: 'Bahan bakar dapur untuk 10 batch memasak (/cook).'
    },

    // ==========================================
    // 12. RILIS 2D: ITEM & HIDANGAN EVENT MUSIMAN
    // ==========================================
    {
        id: 'kolak_labu',
        name: 'Kolak Labu Manis',
        emoji: '🎃',
        shop: null,
        tags: ['food', 'drink', 'event_item'],
        buyPrice: 0,
        sellPrice: 0,
        stackSize: 20,
        effects: { hunger: 60, thirst: 40, energy: 25, stress: -10 },
        description: 'Sajian manis labu kuning edisi Festival Malam Labu (+60 Hunger, +40 Thirst, +25 Energy, -10 Stress).'
    },
    {
        id: 'kue_natal',
        name: 'Kue Jahe Natal',
        emoji: '🍪',
        shop: null,
        tags: ['food', 'event_item'],
        buyPrice: 0,
        sellPrice: 0,
        stackSize: 20,
        effects: { hunger: 55, thirst: 25, energy: 30, stress: -15 },
        description: 'Kue rempah jahe hangat edisi Pekan Natal (+55 Hunger, +25 Thirst, +30 Energy, -15 Stress).'
    },
    {
        id: 'kue_keranjang',
        name: 'Kue Keranjang Hoki',
        emoji: '🥮',
        shop: null,
        tags: ['food', 'event_item'],
        buyPrice: 0,
        sellPrice: 0,
        stackSize: 20,
        effects: { hunger: 65, thirst: 20, energy: 30, stress: -15 },
        description: 'Kue manis legit khas Festival Imlek (+65 Hunger, +20 Thirst, +30 Energy, -15 Stress).'
    },
    {
        id: 'ketupat_opor',
        name: 'Ketupat Opor Spesial',
        emoji: '🍲',
        shop: null,
        tags: ['food', 'drink', 'event_item'],
        buyPrice: 0,
        sellPrice: 0,
        stackSize: 20,
        effects: { hunger: 80, thirst: 45, energy: 30, stress: -20 },
        description: 'Hidangan istimewa Hari Raya Idul Fitri (+80 Hunger, +45 Thirst, +30 Energy, -20 Stress).'
    },
    {
        id: 'tumpeng_merdeka',
        name: 'Tumpeng Merdeka',
        emoji: '🍛',
        shop: null,
        tags: ['food', 'drink', 'event_item'],
        buyPrice: 0,
        sellPrice: 0,
        stackSize: 20,
        effects: { hunger: 85, thirst: 40, energy: 30, stress: -20 },
        description: 'Nasi tumpeng komplit perayaan Kemerdekaan 17 Agustus (+85 Hunger, +40 Thirst, +30 Energy, -20 Stress).'
    },

    // ==========================================
    // 14. SISTEM GACHA (/GACHA): TIKET & HADIAH EKSKLUSIF
    // ==========================================
    {
        id: 'tiket_gacha_warung',
        name: 'Tiket Kapsul Warung',
        emoji: '🎟️',
        shop: null,
        tags: ['gacha_ticket'],
        buyPrice: 0,
        sellPrice: 0,
        stackSize: 100,
        description: 'Tiket untuk memutar 1× Mesin Kapsul Pojok Warung (Tier 1) di /gacha secara gratis!'
    },
    {
        id: 'tiket_gacha_mall',
        name: 'Tiket Mystery Box Mall',
        emoji: '🎫',
        shop: null,
        tags: ['gacha_ticket'],
        buyPrice: 0,
        sellPrice: 0,
        stackSize: 100,
        description: 'Tiket untuk membuka 1× Mystery Box Mall (Tier 2) di /gacha secara gratis!'
    },
    {
        id: 'tiket_gacha_sultan',
        name: 'Tiket Brankas Sultan',
        emoji: '💳',
        shop: null,
        tags: ['gacha_ticket'],
        buyPrice: 0,
        sellPrice: 0,
        stackSize: 100,
        description: 'Tiket VIP untuk membuka 1× Brankas Eksklusif Sultan (Tier 3) di /gacha secara gratis!'
    },
    {
        id: 'pancing_emas_sultan',
        name: 'Pancingan Emas Sultan',
        emoji: '🔱',
        shop: null,
        tags: ['tool', 'fishing_rod', 'gacha_exclusive'],
        buyPrice: 10000000,
        sellPrice: 0,
        stackSize: 1,
        maxDurability: 750,
        toolTier: 5,
        rarityBonus: 0.60,
        description: 'Pancingan legendaris berbalut emas 24K eksklusif /gacha (Tier 5 · Durability 750 · Bonus Rarity +60%).'
    },
    {
        id: 'beliung_meteorit',
        name: 'Beliung Meteorit',
        emoji: '☄️',
        shop: null,
        tags: ['tool', 'pickaxe', 'gacha_exclusive'],
        buyPrice: 12000000,
        sellPrice: 0,
        stackSize: 1,
        maxDurability: 750,
        toolTier: 5,
        rarityBonus: 0.60,
        description: 'Beliung tempaan logam meteorit eksklusif /gacha (Tier 5 · Durability 750 · Bonus Rarity +60%).'
    },
    {
        id: 'kopi_luwak_emas',
        name: 'Kopi Luwak Emas',
        emoji: '☕',
        shop: null,
        tags: ['drink', 'gacha_exclusive'],
        buyPrice: 0,
        sellPrice: 0,
        stackSize: 20,
        effects: { energy: 100, thirst: 30 },
        description: 'Racikan kopi luwak premium bertabur serbuk emas (+100 Energy & +30 Thirst seketika tanpa penalti kafein).'
    },
    {
        id: 'eliksir_sultan',
        name: 'Eliksir Stamina Sultan',
        emoji: '🧪',
        shop: null,
        tags: ['medicine', 'drink', 'food', 'gacha_exclusive'],
        buyPrice: 0,
        sellPrice: 0,
        stackSize: 20,
        effects: { energy: 100, hunger: 100, thirst: 100, health: 100 },
        buff: {
            type: 'luck_boost',
            multiplier: 1.15,
            durationSec: 7200,
            label: '+15% Peluang Rarity (2 Jam)'
        },
        description: 'Ramuan rahasia para Sultan! Memulihkan seluruh stat vital ke 100% + Buff +15% Rarity selama 2 jam.'
    }
];

// Tambahkan bibit & hasil panen dari katalog CROPS
for (const c of CROPS) {
    ITEMS.push({
        id: c.seedId,
        name: `Bibit ${c.name.split(' ')[0]}`,
        emoji: '🌱',
        shop: 'tani',
        tags: ['seed'],
        buyPrice: c.seedPrice,
        sellPrice: 0,
        stackSize: 100,
        cropId: c.id,
        description: `Bibit ${c.name} (Farming Lv. ${c.minLevel} · Tumbuh ${c.growthHours} jam · Hasil dasar ${c.baseYield}).`
    });

    ITEMS.push({
        id: c.id,
        name: c.name,
        emoji: c.emoji,
        shop: null,
        tags: ['crop', ...(c.spoilageCategory !== 'biji' ? ['food'] : [])],
        buyPrice: 0,
        sellPrice: c.sellPrice,
        baseSupplyThreshold: 140,
        stackSize: 20,
        shelfLifeHours: c.shelfLifeHours,
        spoilageCategory: c.spoilageCategory,
        effects: c.spoilageCategory !== 'biji' ? { hunger: 8 } : undefined,
        description: `Hasil panen kebun (Harga dasar ${c.sellPrice} · Umur segar ${c.shelfLifeHours / 24} hari).`
    });
}

// Tambahkan masakan normal & sempurna dari katalog RECIPES
for (const r of RECIPES) {
    ITEMS.push({
        id: r.id,
        name: r.name,
        emoji: r.emoji,
        shop: null,
        tags: [...r.tags],
        buyPrice: 0,
        sellPrice: r.sellPrice,
        baseSupplyThreshold: 30,
        stackSize: 20,
        shelfLifeHours: 48,
        spoilageCategory: 'masakan',
        caffeineType: r.caffeineType || undefined,
        effects: r.effects ? { ...r.effects } : undefined,
        buff: r.buff ? { ...r.buff, isHomeCooked: true } : undefined,
        description: `Masakan dapur rumah (Umur segar 48 jam).`
    });

    if (r.perfectItemId && r.perfectItemId !== r.id) {
        const perfEffects = {};
        if (r.effects) {
            for (const [k, v] of Object.entries(r.effects)) {
                perfEffects[k] = Math.round(v * 1.5);
            }
        }
        ITEMS.push({
            id: r.perfectItemId,
            name: `✨ ${r.name} (Sempurna)`,
            emoji: r.emoji,
            shop: null,
            tags: [...r.tags, 'perfect_dish'],
            buyPrice: 0,
            sellPrice: Math.round(r.sellPrice * 1.1),
            baseSupplyThreshold: 25,
            stackSize: 20,
            shelfLifeHours: 48,
            spoilageCategory: 'masakan',
            caffeineType: r.caffeineType || undefined,
            effects: perfEffects,
            buff: r.buff ? { ...r.buff, isHomeCooked: true } : undefined,
            description: `Masakan kualitas sempurna dengan efek stat ×1,5 (Umur segar 48 jam).`
        });
    }
}

for (const it of ITEMS) {
    if (it.tags && it.tags.includes('fish') && !it.shelfLifeHours) {
        it.shelfLifeHours = 72;
        it.spoilageCategory = 'fish';
    }
}

for (const c of getShopClothes()) {
    ITEMS.push({
        id: c.id,
        name: c.name,
        emoji: c.emoji,
        shop: 'busana',
        tags: ['clothing'],
        clothingId: c.id,
        clothingSlot: c.slot,
        buyPrice: c.priceLp,
        sellPrice: 0,
        stackSize: 0,
        description: c.description
    });
}

const ITEM_MAP = new Map(ITEMS.map(it => [it.id, it]));

function getItem(itemId) {
    if (!itemId) return null;
    return ITEM_MAP.get(String(itemId).toLowerCase()) || null;
}

function getItemsByShop(shopId) {
    return ITEMS.filter(i => i.shop === shopId);
}

function getBuyableItems() {
    return ITEMS.filter(i => i.buyPrice > 0 && i.shop);
}

function getSellableItems() {
    return ITEMS.filter(i => i.sellPrice > 0);
}

module.exports = {
    SHOPS,
    ITEMS,
    getItem,
    getItemsByShop,
    getBuyableItems,
    getSellableItems
};
