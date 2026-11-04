const { withTransaction } = require('../database/mariadb');
const { getRolling24hSupply, getActiveUserCount, recordMarketSale } = require('../database/redis');
const { syncPlayerVitals } = require('./vitalService');
const { getPlayerInventory, removeItem } = require('./inventoryService');
const { creditPlayerCash, getLiveEconomyConfig } = require('./economyService');
const { getItem } = require('../data/items');

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

/**
 * Menjual item tunggal atau bulk ('semua_ikan', 'semua_tambang', 'semua_tani', 'semua_masakan', 'semua_sampah', 'semua_hasil') dari tas.
 */
async function executeSellItems(discordId, itemArg, amountArg = null, now = Date.now()) {
    const res = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
        const liveCfg = await getLiveEconomyConfig(conn);
        const sellMultiplier = Number(liveCfg.sell_multiplier || 1.0);

        const toSell = [];

        if (['semua_ikan', 'semua_tambang', 'semua_tani', 'semua_masakan', 'semua_sampah', 'semua_hasil'].includes(itemArg)) {
            const groupedSell = new Map();
            for (const row of invRows) {
                const it = getItem(row.item_id);
                if (!it || !it.sellPrice || Number(row.quantity) <= 0) continue;

                const isFish = it.tags && it.tags.includes('fish');
                const isMineral = it.tags && it.tags.includes('mineral');
                const isCrop = it.tags && it.tags.includes('crop');
                const isCooked = it.tags && it.tags.includes('cooked');
                const isTrash = it.tags && it.tags.includes('trash');

                if (
                    (itemArg === 'semua_ikan' && (isFish || isTrash)) ||
                    (itemArg === 'semua_tambang' && isMineral) ||
                    (itemArg === 'semua_tani' && isCrop) ||
                    (itemArg === 'semua_masakan' && isCooked) ||
                    (itemArg === 'semua_sampah' && isTrash) ||
                    (itemArg === 'semua_hasil' && (isFish || isMineral || isCrop || isTrash))
                ) {
                    const prev = groupedSell.get(it.id) || { item: it, qty: 0 };
                    prev.qty += Number(row.quantity);
                    groupedSell.set(it.id, prev);
                }
            }
            toSell.push(...groupedSell.values());
        } else {
            const it = getItem(itemArg);
            if (!it || !it.sellPrice) {
                return { error: 'NOT_SELLABLE', player: p };
            }
            const owned = invRows
                .filter(r => r.item_id === it.id)
                .reduce((acc, r) => acc + Number(r.quantity), 0);

            if (owned <= 0) {
                return { error: 'NOT_OWNED', item: it, player: p };
            }

            const sellQty = amountArg && amountArg !== 'max'
                ? Math.min(owned, Math.max(1, Number(amountArg)))
                : owned;
            toSell.push({ item: it, qty: sellQty });
        }

        if (toSell.length === 0) {
            return { error: 'EMPTY_MATCH', player: p };
        }

        let grandTotal = 0;
        const soldDetails = [];

        for (const entry of toSell) {
            const dynInfo = await getItemDynamicSellInfo(entry.item.id, sellMultiplier, now);
            const revenue = dynInfo.unitPrice * entry.qty;
            grandTotal += revenue;

            await removeItem(conn, discordId, entry.item.id, entry.qty, 'bag');

            soldDetails.push({
                itemId: entry.item.id,
                item: entry.item,
                qty: entry.qty,
                unitPrice: dynInfo.unitPrice,
                percentOfBase: dynInfo.percentOfBase,
                revenue
            });
        }

        await creditPlayerCash(conn, p, grandTotal, `sell_${itemArg}`, {
            itemsCount: soldDetails.length
        }, now);

        return {
            ok: true,
            player: p,
            grandTotal,
            soldDetails,
            totalItemsSold: soldDetails.reduce((acc, d) => acc + d.qty, 0)
        };
    });

    if (res.ok && res.soldDetails?.length > 0) {
        await recordItemsSold(
            res.soldDetails.map(d => ({ itemId: d.itemId, qty: d.qty })),
            now
        );
    }

    return res;
}

module.exports = {
    computeDynamicPriceMultiplier,
    getItemDynamicSellInfo,
    recordItemsSold,
    executeSellItems
};
