const ACHIEVEMENT_CATEGORIES = [
    { id: 'karir', name: 'Karir & Pekerjaan', emoji: '💼' },
    { id: 'pendidikan', name: 'Pendidikan & Akademik', emoji: '🎓' },
    { id: 'koleksi', name: 'Koleksi & Eksplorasi', emoji: '📖' },
    { id: 'skill', name: 'Penguasaan Keahlian', emoji: '📈' },
    { id: 'ekonomi', name: 'Properti & Ekonomi', emoji: '🏠' },
    { id: 'kehidupan', name: 'Gaya Hidup & Dedikasi', emoji: '❤️' }
];

const ACHIEVEMENTS = [
    // ==========================================
    // 1. KARIR
    // ==========================================
    {
        id: 'karir_shift_10',
        category: 'karir',
        name: 'Langkah Pertama Karir',
        emoji: '💼',
        description: 'Selesaikan total 10 shift pekerjaan.',
        target: 10,
        metric: 'total_shifts',
        titleReward: null,
        itemRewards: [
            { itemId: 'nasi_bungkus', qty: 2 },
            { itemId: 'kopi', qty: 2 }
        ]
    },
    {
        id: 'karir_shift_100',
        category: 'karir',
        name: 'Pekerja Keras',
        emoji: '🔨',
        description: 'Selesaikan total 100 shift pekerjaan.',
        target: 100,
        metric: 'total_shifts',
        titleReward: '🔨 Pekerja Keras',
        itemRewards: [
            { itemId: 'energy_drink', qty: 3 }
        ]
    },
    {
        id: 'karir_kepala',
        category: 'karir',
        name: 'Puncak Jabatan',
        emoji: '👔',
        description: 'Capai jabatan Kepala (≥250 shift) pada salah satu profesi.',
        target: 250,
        metric: 'max_job_shifts',
        titleReward: '👔 Kepala Bagian',
        itemRewards: [
            { itemId: 'vitamin_c', qty: 2 }
        ]
    },
    {
        id: 'karir_dokter',
        category: 'karir',
        name: 'Sumpah Hipokrates',
        emoji: '⚕️',
        description: 'Bekerja atau menyelesaikan minimal 1 shift sebagai Dokter Spesialis.',
        target: 1,
        metric: 'is_dokter_spesialis',
        titleReward: '⚕️ Dokter Spesialis',
        itemRewards: [
            { itemId: 'kotak_p3k', qty: 2 }
        ]
    },

    // ==========================================
    // 2. PENDIDIKAN
    // ==========================================
    {
        id: 'edu_sma',
        category: 'pendidikan',
        name: 'Tamat SMA',
        emoji: '📘',
        description: 'Raih ijazah Sekolah Menengah Atas (SMA).',
        target: 2,
        metric: 'edu_order',
        titleReward: null,
        itemRewards: [
            { itemId: 'kopi', qty: 3 }
        ]
    },
    {
        id: 'edu_d3',
        category: 'pendidikan',
        name: 'Ahli Madya (D3)',
        emoji: '🎓',
        description: 'Raih gelar pendidikan Diploma (D3).',
        target: 3,
        metric: 'edu_order',
        titleReward: '🎓 Ahli Madya',
        itemRewards: [
            { itemId: 'energy_drink', qty: 2 }
        ]
    },
    {
        id: 'edu_s1',
        category: 'pendidikan',
        name: 'Sarjana Kota (S1)',
        emoji: '📜',
        description: 'Raih gelar pendidikan Sarjana (S1).',
        target: 4,
        metric: 'edu_order',
        titleReward: '🎓 Sarjana',
        itemRewards: [
            { itemId: 'vitamin_c', qty: 2 }
        ]
    },
    {
        id: 'edu_s2',
        category: 'pendidikan',
        name: 'Magister Utama (S2)',
        emoji: '👑',
        description: 'Raih gelar akademik tertinggi Pascasarjana (S2).',
        target: 5,
        metric: 'edu_order',
        titleReward: '👑 Magister',
        itemRewards: [
            { itemId: 'steak_wagyu', qty: 2 }
        ]
    },

    // ==========================================
    // 3. KOLEKSI
    // ==========================================
    {
        id: 'col_fish_10',
        category: 'koleksi',
        name: 'Kolektor Perairan',
        emoji: '🐠',
        description: 'Kumpulkan 10 spesies ikan berbeda di Fishpedia.',
        target: 10,
        metric: 'fish_species_count',
        titleReward: null,
        itemRewards: [
            { itemId: 'umpan_udang', qty: 10 }
        ]
    },
    {
        id: 'col_fish_all',
        category: 'koleksi',
        name: 'Ensiklopedia Perikanan',
        emoji: '🐟',
        description: 'Kumpulkan seluruh 21 spesies ikan standar di Fishpedia.',
        target: 21,
        metric: 'fish_species_count',
        titleReward: '🐟 Ahli Perikanan',
        itemRewards: [
            { itemId: 'umpan_pro', qty: 10 }
        ]
    },
    {
        id: 'col_mine_all',
        category: 'koleksi',
        name: 'Geolog Sejati',
        emoji: '💎',
        description: 'Temukan seluruh 15 jenis mineral & permata di Buku Mineral.',
        target: 15,
        metric: 'mineral_types_count',
        titleReward: '💎 Geolog Utama',
        itemRewards: [
            { itemId: 'kotak_p3k', qty: 3 }
        ]
    },
    {
        id: 'col_cook_all',
        category: 'koleksi',
        name: 'Master Kuliner Nusantara',
        emoji: '📖',
        description: 'Pernah memasak seluruh 12 resep masakan rumahan standar.',
        target: 12,
        metric: 'cooked_recipes_count',
        titleReward: '👨‍🍳 Master Kuliner',
        itemRewards: [
            { itemId: 'gas_lpg', qty: 2 }
        ]
    },

    // ==========================================
    // 4. SKILL
    // ==========================================
    {
        id: 'skill_fish_25',
        category: 'skill',
        name: 'Pendekar Kail Lv. 25',
        emoji: '🎣',
        description: 'Capai Fishing Level 25.',
        target: 25,
        metric: 'fishing_level',
        titleReward: '🎣 Pendekar Kail',
        itemRewards: [
            { itemId: 'umpan_pro', qty: 8 }
        ]
    },
    {
        id: 'skill_mine_25',
        category: 'skill',
        name: 'Penakluk Tambang Lv. 25',
        emoji: '⛏️',
        description: 'Capai Mining Level 25.',
        target: 25,
        metric: 'mining_level',
        titleReward: '⛏️ Penakluk Tambang',
        itemRewards: [
            { itemId: 'energy_drink', qty: 3 }
        ]
    },
    {
        id: 'skill_farm_25',
        category: 'skill',
        name: 'Petani Makmur Lv. 25',
        emoji: '🌾',
        description: 'Capai Farming Level 25.',
        target: 25,
        metric: 'farming_level',
        titleReward: '🌾 Petani Makmur',
        itemRewards: [
            { itemId: 'pupuk_urea', qty: 10 }
        ]
    },
    {
        id: 'skill_cook_25',
        category: 'skill',
        name: 'Chef Rumahan Lv. 25',
        emoji: '🍳',
        description: 'Capai Cooking Level 25.',
        target: 25,
        metric: 'cooking_level',
        titleReward: '🍳 Chef Rumahan',
        itemRewards: [
            { itemId: 'gas_lpg', qty: 2 }
        ]
    },

    // ==========================================
    // 5. EKONOMI
    // ==========================================
    {
        id: 'eko_properti_pertama',
        category: 'ekonomi',
        name: 'Atap Sendiri',
        emoji: '🛏️',
        description: 'Sewa atau miliki hunian pertamamu (selain Tunawisma).',
        target: 1,
        metric: 'has_active_property',
        titleReward: null,
        itemRewards: [
            { itemId: 'nasi_padang', qty: 3 }
        ]
    },
    {
        id: 'eko_tuan_rumah',
        category: 'ekonomi',
        name: 'Tuan Rumah',
        emoji: '🏡',
        description: 'Miliki Rumah Pribadi atau Rumah Mewah atas namamu sendiri.',
        target: 1,
        metric: 'owns_house',
        titleReward: '🏡 Tuan Rumah',
        itemRewards: [
            { itemId: 'gas_lpg', qty: 2 }
        ]
    },
    {
        id: 'eko_kredit_lunas',
        category: 'ekonomi',
        name: 'Debitur Teladan',
        emoji: '💳',
        description: 'Lunasi minimal 1 kontrak pembiayaan kredit (/credit).',
        target: 1,
        metric: 'paid_off_credits',
        titleReward: '💳 Debitur Teladan',
        itemRewards: [
            { itemId: 'vitamin_c', qty: 2 }
        ]
    },
    {
        id: 'eko_kekayaan_100jt',
        category: 'ekonomi',
        name: 'Jutawan Kota',
        emoji: '💎',
        description: 'Miliki total kekayaan (Cash + Bank) minimal Lp 100.000.000.',
        target: 100000000,
        metric: 'net_worth',
        titleReward: '💼 Jutawan Kota',
        itemRewards: [
            { itemId: 'seafood_platter', qty: 2 }
        ]
    },

    // ==========================================
    // 6. KEHIDUPAN
    // ==========================================
    {
        id: 'life_streak_7',
        category: 'kehidupan',
        name: 'Warga Rajin Sepekan',
        emoji: '📅',
        description: 'Capai streak klaim /daily selama 7 hari berturut-turut.',
        target: 7,
        metric: 'daily_streak',
        titleReward: null,
        itemRewards: [
            { itemId: 'umpan_udang', qty: 5 }
        ]
    },
    {
        id: 'life_streak_30',
        category: 'kehidupan',
        name: 'Dedikasi Sebulan Penuh',
        emoji: '🔥',
        description: 'Capai streak klaim /daily selama 30 hari berturut-turut.',
        target: 30,
        metric: 'daily_streak',
        titleReward: '🔥 Warga Disiplin',
        itemRewards: [
            { itemId: 'umpan_pro', qty: 5 },
            { itemId: 'vitamin_c', qty: 2 }
        ]
    },
    {
        id: 'life_kendaraan_mobil',
        category: 'kehidupan',
        name: 'Pengendara Roda Empat',
        emoji: '🚗',
        description: 'Miliki kendaraan Mobil Sedan Keluarga di garasimu.',
        target: 1,
        metric: 'owns_car',
        titleReward: '🚗 Eksekutif Jalanan',
        itemRewards: [
            { itemId: 'energy_drink', qty: 3 }
        ]
    },
    {
        id: 'life_makan_masakan_100',
        category: 'kehidupan',
        name: 'Pecinta Masakan Rumah',
        emoji: '🍲',
        description: 'Konsumsi 100 porsi masakan hasil olahan dapur rumah.',
        target: 100,
        metric: 'cooked_dishes_eaten',
        titleReward: '🍲 Pecinta Masakan Rumah',
        itemRewards: [
            { itemId: 'bibit_stroberi', qty: 5 }
        ]
    },
    {
        id: 'gacha_pull_10',
        category: 'koleksi',
        name: 'Pecandu Mesin Kapsul',
        emoji: '🎰',
        description: 'Putar total 10 kapsul atau Mystery Box di /gacha.',
        target: 10,
        metric: 'gacha_total_pulls',
        titleReward: null,
        itemRewards: [
            { itemId: 'tiket_gacha_warung', qty: 2 }
        ]
    },
    {
        id: 'gacha_pull_100',
        category: 'koleksi',
        name: 'Kolektor Mystery Box',
        emoji: '📦',
        description: 'Putar total 100 kapsul atau Mystery Box di /gacha.',
        target: 100,
        metric: 'gacha_total_pulls',
        titleReward: '🎰 Pemburu Kapsul',
        itemRewards: [
            { itemId: 'tiket_gacha_mall', qty: 1 }
        ]
    },
    {
        id: 'gacha_jackpot_1',
        category: 'koleksi',
        name: 'Sentuhan Emas Jackpot',
        emoji: '🌟',
        description: 'Menangkan minimal 1 hadiah Legendary (Jackpot) di /gacha.',
        target: 1,
        metric: 'gacha_jackpots',
        titleReward: null,
        itemRewards: [
            { itemId: 'tiket_gacha_sultan', qty: 1 }
        ]
    }
];

const ACHIEVEMENT_MAP = new Map(ACHIEVEMENTS.map(a => [a.id, a]));

function getAchievement(id) {
    if (!id) return null;
    return ACHIEVEMENT_MAP.get(String(id).toLowerCase()) || null;
}

function getAchievementsByCategory(categoryId) {
    return ACHIEVEMENTS.filter(a => a.category === categoryId);
}

module.exports = {
    ACHIEVEMENT_CATEGORIES,
    ACHIEVEMENTS,
    getAchievement,
    getAchievementsByCategory
};
