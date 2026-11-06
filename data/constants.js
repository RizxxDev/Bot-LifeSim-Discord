module.exports = {
    BRANDING: {
        WELCOME_TITLE: 'Welcome To Life Simulation',
        CURRENCY_SYMBOL: 'Lp',
        TIMEZONE_LABEL: 'WIB'
    },

    STARTER_PACK: {
        cash: 0,
        items: [
            { itemId: 'roti', qty: 3 },
            { itemId: 'air_mineral', qty: 3 }
        ]
    },

    VITALS: {
        MAX: 100,
        OFFLINE_FLOOR: 20,              // Penurunan stat saat offline berhenti di 20
        ENERGY_REGEN_PER_HOUR: 12,
        HUNGER_DECAY_PER_HOUR: 4,
        THIRST_DECAY_PER_HOUR: 5,
        HEALTH_DECAY_AT_ZERO_PER_HOUR: 4,
        HEALTH_REGEN_WELL_FED_PER_HOUR: 3,
        WELL_FED_THRESHOLD: 50,
        LOW_VITAL_PENALTY_THRESHOLD: 25,
        LOW_VITAL_YIELD_MULTIPLIER: 0.8,
        LOW_HEALTH_THRESHOLD: 30,
        SLEEP_DURATION_SEC: 3600,       // 60 menit
        SLEEP_ENERGY_BONUS: 50,
        SLEEP_MAX_ENERGY_ALLOWED: 80
    },

    HOSPITAL: {
        BASE_FEE: 25000,
        CASH_PERCENT: 0.10,
        MAX_FEE: 2000000,
        PAID_LOCK_SEC: 1800,            // 30 menit
        UNPAID_LOCK_SEC: 3600,          // 60 menit jika tidak mampu bayar penuh
        RECOVERY_STAT_VALUE: 50
    },

    ACTIVITY_COSTS: {
        work_normal: { energy: 20, hunger: 8, thirst: 10, cooldownSec: 3600 },
        work_heavy:  { energy: 25, hunger: 8, thirst: 10, cooldownSec: 3600 },
        study:       { energy: 15, hunger: 5, thirst: 6,  cooldownSec: 7200 },
        fishing:     { energy: 8,  hunger: 3, thirst: 4,  cooldownSec: 180  },
        mining:      { energy: 12, hunger: 5, thirst: 6,  cooldownSec: 300  },
        bin:         { energy: 1,  hunger: 0, thirst: 0,  cooldownSec: 5    }
    },

    NEWBIE_BOOST: {
        DURATION_MS: 7 * 24 * 3600 * 1000, // 7 hari pertama
        XP_MULTIPLIER: 1.5,
        TAX_EXEMPT: true
    },

    INCOME_TAX_BRACKETS: [
        { maxGross: 50000, rate: 0.00 },
        { maxGross: 150000, rate: 0.02 },
        { maxGross: 220000, rate: 0.05 },
        { maxGross: Infinity, rate: 0.08 }
    ],

    WEALTH_TAX_BRACKETS: [
        { upTo: 25000000, rate: 0.00 },
        { upTo: 100000000, rate: 0.025 },
        { upTo: 500000000, rate: 0.04 },
        { upTo: Infinity, rate: 0.06 }
    ],

    BANK: {
        MONTHLY_ADMIN_FEE: 10000,
        EXEMPT_BELOW_BALANCE: 500000
    },

    PAY_RULES: {
        MIN_ACCOUNT_AGE_MS: 7 * 24 * 3600 * 1000,
        MIN_SHIFTS: 20,
        MIN_TOTAL_SKILL_LEVEL: 10,
        MAX_DAILY_SEND: 1000000,
        MAX_DAILY_RECEIVE: 2000000,
        TAX_RATE: 0.05
    },

    SOFT_CAPS: {
        work: [
            { maxCount: 6, multiplier: 1.0, trashBonus: 0 },
            { maxCount: 9, multiplier: 0.75, trashBonus: 0 },
            { maxCount: Infinity, multiplier: 0.50, trashBonus: 0 }
        ],
        fishing: [
            { maxCount: 40, multiplier: 1.0, trashBonus: 0 },
            { maxCount: 70, multiplier: 0.75, trashBonus: 0.10 },
            { maxCount: Infinity, multiplier: 0.50, trashBonus: 0.20 }
        ],
        mining: [
            { maxCount: 30, multiplier: 1.0, trashBonus: 0 },
            { maxCount: 50, multiplier: 0.75, trashBonus: 0.10 },
            { maxCount: Infinity, multiplier: 0.50, trashBonus: 0.20 }
        ]
    },

    DAILY_REWARDS: [
        { day: 1, items: [{ itemId: 'roti', qty: 2 }, { itemId: 'air_mineral', qty: 2 }], cash: 0 },
        { day: 2, items: [{ itemId: 'umpan_cacing', qty: 10 }, { itemId: 'teh_manis', qty: 2 }], cash: 0 },
        { day: 3, items: [{ itemId: 'nasi_bungkus', qty: 2 }, { itemId: 'kopi', qty: 1 }, { itemId: 'tiket_gacha_warung', qty: 1 }], cash: 0 },
        { day: 4, items: [{ itemId: 'umpan_udang', qty: 5 }, { itemId: 'es_buah', qty: 2 }], cash: 0 },
        { day: 5, items: [{ itemId: 'nasi_padang', qty: 1 }, { itemId: 'vitamin_c', qty: 1 }], cash: 0 },
        { day: 6, items: [{ itemId: 'umpan_pro', qty: 3 }, { itemId: 'energy_drink', qty: 1 }], cash: 0 },
        { day: 7, items: [{ itemId: 'nasi_padang', qty: 2 }, { itemId: 'umpan_pro', qty: 5 }, { itemId: 'tiket_gacha_mall', qty: 1 }], cash: 20000 }
    ],

    USERNAME_BLACKLIST: [
        'admin', 'administrator', 'moderator', 'mod', 'system', 'sistem',
        'bot', 'owner', 'developer', 'dev', 'staff', 'official', 'discord',
        'anjing', 'babi', 'bangsat', 'kontol', 'memek', 'ngentot', 'tolol',
        'goblok', 'bajingan', 'asu', 'jancok', 'pantek'
    ]
};
