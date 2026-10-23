const { getItem } = require('../data/items');
const { getRolling24hSupply, getActiveUserCount, recordMarketSale } = require('../database/redis');

/**
 * Pure function untuk menghitung multiplier harga pasar dinamis berdasarkan suplai 24 jam (S) dan DAU.
 */
function computeDynamicPriceMultiplier(sold24h, baseThreshold = 100, dau = 1) {
    const T = Math.max(1, Number(baseThreshold || 100) * Math.max(1, Number(dau || 1) / 100));
    const S = Math.max(0, Number(sold24h || 0));

    if (S <= T) {
        return { multiplier: 1.0, threshold: T, sold24h: S, trend: '🟢 Stabil' };
    }

    const raw = 1 - 0.5 * ((S - T) / T);
    const multiplier = Math.max(0.5, Math.round(raw * 1000) / 1000);
    const trend = multiplier <= 0.65 ? '🔴 Banjir Suplai' : '🟡 Suplai Tinggi';
    return { multiplier, threshold: T, sold24h: S, trend };
}

async function getItemDynamicSellInfo(itemId, adminSellMultiplier = 1.0, now = Date.now()) {
    const item = getItem(itemId);
    if (!item || !item.sellPrice) return null;

    const [sold24h, dau] = await Promise.all([
        getRolling24hSupply(item.id, now),
        getActiveUserCount(now)
    ]);

    const dyn = computeDynamicPriceMultiplier(sold24h, item.baseSupplyThreshold || 100, dau);
    const unitPrice = Math.max(1, Math.round(item.sellPrice * dyn.multiplier * Number(adminSellMultiplier || 1.0)));
    const percentOfBase = Math.round((unitPrice / item.sellPrice) * 100);

    return {
        item,
        basePrice: item.sellPrice,
        unitPrice,
        percentOfBase,
        multiplier: dyn.multiplier,
        sold24h: dyn.sold24h,
        threshold: Math.round(dyn.threshold),
        trend: dyn.trend
    };
}

async function recordItemsSold(itemsSold = [], now = Date.now()) {
    for (const entry of itemsSold) {
        if (entry.qty > 0) {
            await recordMarketSale(entry.itemId, entry.qty, now);
        }
    }
}

module.exports = {
    computeDynamicPriceMultiplier,
    getItemDynamicSellInfo,
    recordItemsSold
};
