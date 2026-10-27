const WEATHER_CYCLE_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 hari (2 minggu)
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const LEBARAN_THR_DURATION_MS = 3 * 24 * 60 * 60 * 1000; // 3 hari pertama sejak awal Lebaran
const LEBARAN_THR_MULTIPLIER = 1.5;

const WEATHER_SEASONS = {
    hujan: {
        id: 'hujan',
        name: 'Musim Hujan',
        emoji: '🌧️',
        description: 'Kebun otomatis tersiram di Fase 1 & 2, peluang ikan sungai/danau meningkat (+5%), namun tambang lebih licin (+1% risiko kecelakaan).',
        autoWaterFarm: true,
        cropSpeedMultipliers: {},
        fishingRarityBonus: {
            sungai: 0.05,
            danau: 0.05,
            laut: 0
        },
        miningAccidentDelta: 0.01
    },
    kemarau: {
        id: 'kemarau',
        name: 'Musim Kemarau',
        emoji: '☀️',
        description: 'Tanaman Cabai & Kopi tumbuh 10% lebih cepat, serta perairan Laut lebih tenang (+5% peluang ikan langka di Laut).',
        autoWaterFarm: false,
        cropSpeedMultipliers: {
            cabai: 0.90,
            kopi_biji: 0.90
        },
        fishingRarityBonus: {
            sungai: 0,
            danau: 0,
            laut: 0.05
        },
        miningAccidentDelta: 0
    }
};

function getWeatherSeason(now = Date.now(), overrideId = null) {
    if (overrideId && WEATHER_SEASONS[overrideId]) {
        const cycleIdx = Math.floor(now / WEATHER_CYCLE_DURATION_MS);
        const nextChangeAt = (cycleIdx + 1) * WEATHER_CYCLE_DURATION_MS;
        return {
            ...WEATHER_SEASONS[overrideId],
            isOverride: true,
            nextChangeAt
        };
    }
    const cycleIdx = Math.floor(now / WEATHER_CYCLE_DURATION_MS);
    const seasonKey = cycleIdx % 2 === 0 ? 'hujan' : 'kemarau';
    const nextChangeAt = (cycleIdx + 1) * WEATHER_CYCLE_DURATION_MS;
    return {
        ...WEATHER_SEASONS[seasonKey],
        isOverride: false,
        nextChangeAt
    };
}

const SEASONAL_EVENTS = [
    {
        id: 'halloween',
        name: 'Festival Malam Labu',
        emoji: '🎃',
        tokenName: 'Permen Labu',
        tokenEmoji: '🍬',
        description: 'Malam misterius menyelimuti kota! Kumpulkan Permen Labu dari aktivitas harian dan tukarkan dengan hadiah eksklusif.',
        scheduleType: 'fixed',
        fixedRange: { startMonth: 10, startDay: 25, endMonth: 11, endDay: 1 },
        bonuses: {
            fishingXpMult: 1.15,
            miningXpMult: 1.15,
            farmingXpMult: 1.0,
            cookingXpMult: 1.0,
            rarityBonus: 0.03,
            lebaranThr: false
        },
        communityGoal: {
            target: 500,
            description: 'Selesaikan total 500 aktivitas warga selama Festival Malam Labu.',
            rewardItems: [
                { itemId: 'kolak_labu', qty: 2 },
                { itemId: 'umpan_pro', qty: 5 }
            ]
        },
        shopItems: [
            {
                id: 'title_halloween',
                type: 'title',
                name: 'Gelar: 🎃 Sang Penjaga Malam',
                titleValue: '🎃 Sang Penjaga Malam',
                emoji: '🎃',
                tokenCost: 40,
                description: 'Gelar kosmetik eksklusif Festival Malam Labu.'
            },
            {
                id: 'item_kolak_labu',
                type: 'item',
                name: 'Kolak Labu Manis (x2)',
                itemId: 'kolak_labu',
                qty: 2,
                emoji: '🎃',
                tokenCost: 12,
                description: 'Sajian manis labu kuning yang memulihkan 60 Lapar, 40 Haus, & 25 Energi.'
            },
            {
                id: 'item_umpan_pro_hw',
                type: 'item',
                name: 'Umpan Lure Pro (x5)',
                itemId: 'umpan_pro',
                qty: 5,
                emoji: 'ルアー',
                tokenCost: 15,
                description: 'Paket 5 umpan lure profesional untuk berburu ikan langka.'
            }
        ]
    },
    {
        id: 'natal',
        name: 'Pekan Musim Dingin & Natal',
        emoji: '🎄',
        tokenName: 'Keping Salju',
        tokenEmoji: '❄️',
        description: 'Suasana hangat di tengah akhir tahun! Kumpulkan Keping Salju dari aktivitas harianmu.',
        scheduleType: 'fixed',
        fixedRange: { startMonth: 12, startDay: 20, endMonth: 12, endDay: 26 },
        bonuses: {
            fishingXpMult: 1.0,
            miningXpMult: 1.0,
            farmingXpMult: 1.15,
            cookingXpMult: 1.15,
            rarityBonus: 0.03,
            lebaranThr: false
        },
        communityGoal: {
            target: 500,
            description: 'Selesaikan total 500 aktivitas warga selama Pekan Natal.',
            rewardItems: [
                { itemId: 'kue_natal', qty: 2 },
                { itemId: 'gas_lpg', qty: 1 }
            ]
        },
        shopItems: [
            {
                id: 'title_natal',
                type: 'title',
                name: 'Gelar: 🎄 Bintang Musim Dingin',
                titleValue: '🎄 Bintang Musim Dingin',
                emoji: '🎄',
                tokenCost: 40,
                description: 'Gelar kosmetik eksklusif Pekan Musim Dingin & Natal.'
            },
            {
                id: 'item_kue_natal',
                type: 'item',
                name: 'Kue Jahe Natal (x2)',
                itemId: 'kue_natal',
                qty: 2,
                emoji: '🍪',
                tokenCost: 12,
                description: 'Kue rempah jahe hangat yang memulihkan 55 Lapar, 25 Haus, & 30 Energi.'
            },
            {
                id: 'item_gas_lpg_natal',
                type: 'item',
                name: 'Tabung Gas LPG 3kg (x2)',
                itemId: 'gas_lpg',
                qty: 2,
                emoji: '⛽',
                tokenCost: 15,
                description: 'Bahan bakar kompor cepat untuk memasak hidangan akhir tahun.'
            }
        ]
    },
    {
        id: 'tahun_baru',
        name: 'Semarak Tahun Baru',
        emoji: '🎆',
        tokenName: 'Koin Kembang Api',
        tokenEmoji: '🎇',
        description: 'Sambut lembaran baru dengan semangat membara dan bonus +20% EXP untuk seluruh keahlian!',
        scheduleType: 'fixed',
        fixedRange: { startMonth: 12, startDay: 28, endMonth: 1, endDay: 3 },
        bonuses: {
            fishingXpMult: 1.20,
            miningXpMult: 1.20,
            farmingXpMult: 1.20,
            cookingXpMult: 1.20,
            rarityBonus: 0.05,
            lebaranThr: false
        },
        communityGoal: {
            target: 600,
            description: 'Selesaikan total 600 aktivitas warga untuk menyalakan Pesta Kembang Api Kota.',
            rewardItems: [
                { itemId: 'energy_drink', qty: 3 },
                { itemId: 'vitamin_c', qty: 2 }
            ]
        },
        shopItems: [
            {
                id: 'title_tahun_baru',
                type: 'title',
                name: 'Gelar: 🎆 Pelopor Tahun Baru',
                titleValue: '🎆 Pelopor Tahun Baru',
                emoji: '🎆',
                tokenCost: 45,
                description: 'Gelar kosmetik eksklusif perayaan Tahun Baru.'
            },
            {
                id: 'item_energy_ny',
                type: 'item',
                name: 'Energy Drink (x3)',
                itemId: 'energy_drink',
                qty: 3,
                emoji: '⚡',
                tokenCost: 15,
                description: 'Pulihkan energi untuk mengejar resolusi tahun baru.'
            },
            {
                id: 'item_pupuk_ny',
                type: 'item',
                name: 'Pupuk Kompos Organik (x5)',
                itemId: 'kompos',
                qty: 5,
                emoji: '🌱',
                tokenCost: 15,
                description: 'Pupuk organik penyubur panen.'
            }
        ]
    },
    {
        id: 'imlek',
        name: 'Festival Tahun Baru Imlek',
        emoji: '🧧',
        tokenName: 'Angpao Keberuntungan',
        tokenEmoji: '🧧',
        description: 'Lampion merah menghiasi jalanan kota! Nikmati peningkatan peluang hasil langka di seluruh aktivitas.',
        scheduleType: 'manual',
        fixedRange: null,
        bonuses: {
            fishingXpMult: 1.10,
            miningXpMult: 1.10,
            farmingXpMult: 1.10,
            cookingXpMult: 1.10,
            rarityBonus: 0.08,
            lebaranThr: false
        },
        communityGoal: {
            target: 500,
            description: 'Selesaikan total 500 aktivitas warga untuk menggelar Parade Barongsai Kota.',
            rewardItems: [
                { itemId: 'kue_keranjang', qty: 2 },
                { itemId: 'umpan_pro', qty: 5 }
            ]
        },
        shopItems: [
            {
                id: 'title_imlek',
                type: 'title',
                name: 'Gelar: 🐉 Pembawa Hoki',
                titleValue: '🐉 Pembawa Hoki',
                emoji: '🐉',
                tokenCost: 40,
                description: 'Gelar kosmetik eksklusif Festival Tahun Baru Imlek.'
            },
            {
                id: 'item_kue_keranjang',
                type: 'item',
                name: 'Kue Keranjang Hoki (x2)',
                itemId: 'kue_keranjang',
                qty: 2,
                emoji: '🥮',
                tokenCost: 12,
                description: 'Kue manis legit khas Imlek yang memulihkan 65 Lapar & 30 Energi.'
            },
            {
                id: 'item_umpan_imlek',
                type: 'item',
                name: 'Umpan Udang Segar (x8)',
                itemId: 'umpan_udang',
                qty: 8,
                emoji: '🦐',
                tokenCost: 14,
                description: 'Paket umpan udang pilihan untuk memancing ikan keberuntungan.'
            }
        ]
    },
    {
        id: 'lebaran',
        name: 'Semarak Idul Fitri & Lebaran',
        emoji: '🌙',
        tokenName: 'Ketupat Lebaran',
        tokenEmoji: '🫔',
        description: 'Selamat Hari Raya Idul Fitri! Nikmati THR Lebaran x1,5 dari gaji dasar selama 3 hari pertama (1-3 Syawal) serta hidangan khas Lebaran.',
        scheduleType: 'manual',
        fixedRange: null,
        bonuses: {
            fishingXpMult: 1.10,
            miningXpMult: 1.10,
            farmingXpMult: 1.15,
            cookingXpMult: 1.20,
            rarityBonus: 0.04,
            lebaranThr: true
        },
        communityGoal: {
            target: 750,
            description: 'Selesaikan total 750 aktivitas warga untuk menggelar Halalbihalal Akbar Kota.',
            rewardItems: [
                { itemId: 'ketupat_opor', qty: 2 },
                { itemId: 'vitamin_c', qty: 2 }
            ]
        },
        shopItems: [
            {
                id: 'title_lebaran',
                type: 'title',
                name: 'Gelar: 🌙 Pahlawan Silaturahmi',
                titleValue: '🌙 Pahlawan Silaturahmi',
                emoji: '🌙',
                tokenCost: 45,
                description: 'Gelar kosmetik eksklusif Semarak Idul Fitri.'
            },
            {
                id: 'item_ketupat_opor',
                type: 'item',
                name: 'Ketupat Opor Spesial (x2)',
                itemId: 'ketupat_opor',
                qty: 2,
                emoji: '🍲',
                tokenCost: 14,
                description: 'Hidangan istimewa Lebaran yang memulihkan 80 Lapar, 45 Haus, & 30 Energi.'
            },
            {
                id: 'item_kompos_lebaran',
                type: 'item',
                name: 'Pupuk Kompos Organik (x5)',
                itemId: 'kompos',
                qty: 5,
                emoji: '🌱',
                tokenCost: 15,
                description: 'Pupuk organik untuk menyuburkan kebun pasca mudik.'
            }
        ]
    },
    {
        id: 'kemerdekaan',
        name: 'Gebyar Kemerdekaan 17 Agustus',
        emoji: '🇮🇩',
        tokenName: 'Kupon Merdeka',
        tokenEmoji: '🎟️',
        description: 'Rayakan Hari Kemerdekaan Republik Indonesia dengan lomba rakyat, +15% EXP semua keahlian, dan Tumpeng Merdeka!',
        scheduleType: 'fixed',
        fixedRange: { startMonth: 8, startDay: 10, endMonth: 8, endDay: 24 },
        bonuses: {
            fishingXpMult: 1.15,
            miningXpMult: 1.15,
            farmingXpMult: 1.15,
            cookingXpMult: 1.15,
            rarityBonus: 0.05,
            lebaranThr: false
        },
        communityGoal: {
            target: 800,
            description: 'Selesaikan total 800 aktivitas warga untuk menyemarakkan Pesta Rakyat 17 Agustus.',
            rewardItems: [
                { itemId: 'tumpeng_merdeka', qty: 2 },
                { itemId: 'energy_drink', qty: 3 }
            ]
        },
        shopItems: [
            {
                id: 'title_kemerdekaan',
                type: 'title',
                name: 'Gelar: 🇮🇩 Pejuang Kemerdekaan',
                titleValue: '🇮🇩 Pejuang Kemerdekaan',
                emoji: '🇮🇩',
                tokenCost: 45,
                description: 'Gelar kosmetik eksklusif Gebyar Kemerdekaan 17 Agustus.'
            },
            {
                id: 'item_tumpeng_merdeka',
                type: 'item',
                name: 'Tumpeng Merdeka (x2)',
                itemId: 'tumpeng_merdeka',
                qty: 2,
                emoji: '🍛',
                tokenCost: 14,
                description: 'Nasi tumpeng komplit perayaan kemerdekaan (+85 Lapar, +40 Haus, +30 Energi).'
            },
            {
                id: 'item_energy_merdeka',
                type: 'item',
                name: 'Energy Drink (x3)',
                itemId: 'energy_drink',
                qty: 3,
                emoji: '⚡',
                tokenCost: 15,
                description: 'Minuman penambah stamina lomba 17-an.'
            }
        ]
    }
];

const EVENT_MAP = new Map(SEASONAL_EVENTS.map(e => [e.id, e]));

function getSeasonalEventConfig(eventId) {
    if (!eventId) return null;
    return EVENT_MAP.get(String(eventId).toLowerCase()) || null;
}

function getFixedCalendarEventForTimestamp(now = Date.now()) {
    const wibDate = new Date(now + WIB_OFFSET_MS);
    const year = wibDate.getUTCFullYear();
    const month = wibDate.getUTCMonth() + 1;
    const day = wibDate.getUTCDate();

    for (const ev of SEASONAL_EVENTS) {
        if (ev.scheduleType !== 'fixed' || !ev.fixedRange) continue;
        const r = ev.fixedRange;

        if (r.startMonth <= r.endMonth) {
            const afterStart = month > r.startMonth || (month === r.startMonth && day >= r.startDay);
            const beforeEnd = month < r.endMonth || (month === r.endMonth && day <= r.endDay);
            if (afterStart && beforeEnd) {
                const startsAt = Date.UTC(year, r.startMonth - 1, r.startDay, 0, 0, 0) - WIB_OFFSET_MS;
                const endsAt = Date.UTC(year, r.endMonth - 1, r.endDay, 23, 59, 59, 999) - WIB_OFFSET_MS;
                return {
                    eventConfig: ev,
                    eventKey: `${ev.id}_${year}`,
                    startsAt,
                    endsAt
                };
            }
        } else {
            // Cross-year range (e.g. Dec 28 - Jan 3)
            if (month === r.startMonth && day >= r.startDay) {
                const startsAt = Date.UTC(year, r.startMonth - 1, r.startDay, 0, 0, 0) - WIB_OFFSET_MS;
                const endsAt = Date.UTC(year + 1, r.endMonth - 1, r.endDay, 23, 59, 59, 999) - WIB_OFFSET_MS;
                return {
                    eventConfig: ev,
                    eventKey: `${ev.id}_${year}`,
                    startsAt,
                    endsAt
                };
            }
            if (month === r.endMonth && day <= r.endDay) {
                const startsAt = Date.UTC(year - 1, r.startMonth - 1, r.startDay, 0, 0, 0) - WIB_OFFSET_MS;
                const endsAt = Date.UTC(year, r.endMonth - 1, r.endDay, 23, 59, 59, 999) - WIB_OFFSET_MS;
                return {
                    eventConfig: ev,
                    eventKey: `${ev.id}_${year - 1}`,
                    startsAt,
                    endsAt
                };
            }
        }
    }
    return null;
}

module.exports = {
    WEATHER_CYCLE_DURATION_MS,
    LEBARAN_THR_DURATION_MS,
    LEBARAN_THR_MULTIPLIER,
    WEATHER_SEASONS,
    SEASONAL_EVENTS,
    getWeatherSeason,
    getSeasonalEventConfig,
    getFixedCalendarEventForTimestamp
};
