const { getWibDateString } = require('../database/redis');
const { getWeatherSeason } = require('../data/events');
const { getItem, SHOPS } = require('../data/items');

const WIB_OFFSET_MS = 7 * 3600000;
const DAY_MS = 86400000;

const NEWS_HOT_MULTIPLIER = 1.15;
const NEWS_SHOP_DISCOUNT_MULTIPLIER = 0.85;

const HOT_COMMODITY_POOL = [
    'ikan_gurame',
    'ikan_patin',
    'ikan_gabus',
    'ikan_kakap',
    'ikan_kerapu',
    'batubara',
    'bijih_besi',
    'bijih_tembaga',
    'bijih_perak',
    'jagung',
    'cabai',
    'kentang',
    'stroberi',
    'telur_ayam',
    'telur_bebek',
    'susu_kambing',
    'daging_ternak',
    'nasi_goreng',
    'martabak_telur',
    'puding_susu'
];

const DISCOUNT_SHOP_POOL = ['warung', 'perkakas', 'tani', 'busana'];

const HEADLINE_TEMPLATES = [
    'Permintaan Pasar Pagi Melonjak! Pengepul Kota Buru Stok Pilihan Warga',
    'Bursa Komoditas Nusantara Menghangat: Warga Diminta Cek Gudang & Hasil Panen',
    'Suasana Ekonomi Kota Bergeliat, Diskon Toko Harian Kembali Hadir Hari Ini',
    'Kabar Pagi Nusantara: Tren Kuliner & Bahan Baku Naik Daun di Seluruh Kota',
    'Laporan Pasar Harian: Peluang Emas Penjual Komoditas & Pembeli Harian'
];

function getWibDateKey(now = Date.now()) {
    const ts = Number(now || Date.now());
    const dateKey = getWibDateString(ts);
    const wibMs = ts + WIB_OFFSET_MS;
    const nextMidnightWibMs = (Math.floor(wibMs / DAY_MS) + 1) * DAY_MS;
    const nextResetMs = nextMidnightWibMs - WIB_OFFSET_MS;
    return {
        dateKey,
        nextResetMs,
        nextResetUnix: Math.floor(nextResetMs / 1000)
    };
}

function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function nextRand(state) {
    const next = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return { state: next, value: next / 4294967296 };
}

/**
 * Pure synchronous config generator untuk Koran Kota harian berbasis tanggal WIB.
 */
function getDailyNewsConfig(now = Date.now(), overrideObj = null) {
    const { dateKey, nextResetMs, nextResetUnix } = getWibDateKey(now);
    let rng = hashSeed(`inibener_news_${dateKey}`);

    const r1 = nextRand(rng);
    rng = r1.state;
    const idx1 = Math.floor(r1.value * HOT_COMMODITY_POOL.length);

    let r2 = nextRand(rng);
    rng = r2.state;
    let idx2 = Math.floor(r2.value * (HOT_COMMODITY_POOL.length - 1));
    if (idx2 >= idx1) idx2 += 1;

    const r3 = nextRand(rng);
    rng = r3.state;
    const shopIdx = Math.floor(r3.value * DISCOUNT_SHOP_POOL.length);

    const r4 = nextRand(rng);
    rng = r4.state;
    const headlineIdx = Math.floor(r4.value * HEADLINE_TEMPLATES.length);

    let hotCommodities = [HOT_COMMODITY_POOL[idx1], HOT_COMMODITY_POOL[idx2]];
    let discountShopId = DISCOUNT_SHOP_POOL[shopIdx];

    if (overrideObj && Array.isArray(overrideObj.hotCommodities) && overrideObj.hotCommodities.length > 0) {
        const valid = overrideObj.hotCommodities.filter(id => Boolean(getItem(id)?.sellPrice));
        if (valid.length > 0) hotCommodities = valid.slice(0, 2);
    }
    if (overrideObj && typeof overrideObj.discountShopId === 'string' && SHOPS.some(s => s.id === overrideObj.discountShopId)) {
        discountShopId = overrideObj.discountShopId;
    }

    return {
        dateKey,
        nextResetMs,
        nextResetUnix,
        headline: HEADLINE_TEMPLATES[headlineIdx],
        hotCommodities,
        sellBonusMultiplier: NEWS_HOT_MULTIPLIER,
        discountShopId,
        shopDiscountMultiplier: NEWS_SHOP_DISCOUNT_MULTIPLIER,
        isOverride: Boolean(overrideObj)
    };
}

function isDailyNewsHotCommodity(itemId, now = Date.now(), overrideObj = null) {
    if (!itemId) return false;
    const cfg = getDailyNewsConfig(now, overrideObj);
    return cfg.hotCommodities.includes(String(itemId).toLowerCase());
}

function getDailyNewsDiscountShopId(now = Date.now(), overrideObj = null) {
    const cfg = getDailyNewsConfig(now, overrideObj);
    return cfg.discountShopId;
}

function formatActivityHighlight(row) {
    const username = row.username || 'Warga';
    const act = row.action;
    let details = {};
    try {
        details = row.details ? JSON.parse(row.details) : {};
    } catch {
        details = {};
    }
    const tsUnix = Math.floor(Number(row.created_at || Date.now()) / 1000);

    if (act === 'gacha_pull' && Number(details.jackpotCount || 0) > 0) {
        return `🎰 **${username}** baru saja meraih **Jackpot Gacha**! (<t:${tsUnix}:R>)`;
    }
    if (act === 'place_animal') {
        return `🐄 **${username}** membuka kandang ternak di Lembah Hijau (<t:${tsUnix}:R>)`;
    }
    if (act === 'jasa_complete' || act === 'fulfill_contract') {
        return `📦 **${username}** menuntaskan kontrak kirim antar-kota (/jasa) (<t:${tsUnix}:R>)`;
    }
    if (act === 'auction_settle' || act === 'create_listing' || act === 'place_bid') {
        return `🔨 **${username}** bertransaksi di Balai Lelang (/lelang) (<t:${tsUnix}:R>)`;
    }
    if (act === 'traktir_create' || act === 'create_drop' || act === 'social_donate' || act === 'donate_social') {
        return `🎁 **${username}** berbagi kebaikan sosial di kota (<t:${tsUnix}:R>)`;
    }
    if (act === 'buy_pen' || act === 'rent_pen') {
        return `🏡 **${username}** memperluas peternakan barunya di Lembah Hijau (<t:${tsUnix}:R>)`;
    }
    return `📰 **${username}** aktif di sektor **${row.category}** (<t:${tsUnix}:R>)`;
}

async function getDailyNewsEdition(connOrNull = null, now = Date.now()) {
    let overrideObj = null;
    let weatherOverride = null;
    let highlights = [];

    if (connOrNull && typeof connOrNull.execute === 'function') {
        try {
            const [cfgRows] = await connOrNull.execute(
                `SELECT cfg_key, cfg_value FROM economy_config WHERE cfg_key IN ('daily_news_override', 'weather_override')`
            );
            for (const row of cfgRows) {
                if (row.cfg_key === 'daily_news_override' && row.cfg_value) {
                    overrideObj = JSON.parse(row.cfg_value);
                }
                if (row.cfg_key === 'weather_override' && row.cfg_value) {
                    weatherOverride = JSON.parse(row.cfg_value);
                }
            }
        } catch {
            // Gunakan konfigurasi deterministik bawaan
        }

        try {
            const [logRows] = await connOrNull.execute(
                `SELECT l.category, l.action, l.details, l.created_at, p.username
                 FROM player_activity_logs l
                 LEFT JOIN players p ON p.discord_id = l.discord_id
                 WHERE l.category NOT IN ('admin', 'moderation')
                 ORDER BY l.created_at DESC
                 LIMIT 5`
            );
            highlights = logRows.map(formatActivityHighlight);
        } catch {
            highlights = [];
        }
    }

    const config = getDailyNewsConfig(now, overrideObj);
    const currentWeather = getWeatherSeason(now, weatherOverride);
    const nextWeather = getWeatherSeason(currentWeather.nextChangeAt + 1000, null);
    const discountShop = SHOPS.find(s => s.id === config.discountShopId) || SHOPS[0];

    const hotItems = config.hotCommodities
        .map(id => getItem(id))
        .filter(Boolean)
        .map(it => ({
            item: it,
            bonusSellPrice: Math.max(1, Math.round(it.sellPrice * config.sellBonusMultiplier))
        }));

    return {
        ...config,
        hotItems,
        discountShop,
        currentWeather,
        nextWeather,
        highlights
    };
}

module.exports = {
    NEWS_HOT_MULTIPLIER,
    NEWS_SHOP_DISCOUNT_MULTIPLIER,
    HOT_COMMODITY_POOL,
    DISCOUNT_SHOP_POOL,
    getWibDateKey,
    getDailyNewsConfig,
    isDailyNewsHotCommodity,
    getDailyNewsDiscountShopId,
    getDailyNewsEdition
};
