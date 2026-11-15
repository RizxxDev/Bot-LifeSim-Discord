const { getMaxLandLimit, getBuildingModule } = require('../data/buildingModules');
const { getWorkshopRecipe } = require('../data/gathering');
const { getCityZoning } = require('../data/cities');
const { getItem } = require('../data/items');
const { PAY_RULES } = require('../data/constants');
const { debitPlayerFunds, creditPlayerCash, logLedger } = require('./economyService');
const { getPlayerInventory, removeItem, addItem, canFitItems } = require('./inventoryService');
const {
    P2P_PROPERTY_RULES,
    SEVEN_DAYS_MS,
    validateP2PTradeEligibility,
    validateMarketPriceBounds,
    getLandById,
    getLandCells,
    getPlayerLands,
    computeLandStats,
    getTotalSkillLevelFromPlayerRow
} = require('./landService');
const { syncLandCondition, performLightMaintenance } = require('./buildingConditionService');

function getControlledRetailPrice(item) {
    if (!item) return 0;
    const sellBase = Number(item.sellPrice || 0);
    const buyBase = Number(item.buyPrice || 0);
    if (sellBase > 0) {
        // Produk kerajinan/panen/tangkapan/masakan mendapat margin retail 25% (tidak mencetak uang berlebih)
        return Math.round(sellBase * 1.25);
    }
    // Item toko NPC tanpa harga jual hanya bisa dijual tipis (+8%)
    return Math.round(buyBase * 1.08);
}

/**
 * Menyetor stok barang atau masakan ke etalase modul usaha (Warung / Kafe).
 */
async function stockBusinessItem(conn, discordId, landId, zoneGroupId, itemId, qty = 1, now = Date.now()) {
    const land = await getLandById(conn, landId, true);
    if (!land || land.discord_id !== discordId) {
        return { ok: false, error: 'Kavling tidak ditemukan.' };
    }
    if (['abandoned', 'collapsed'].includes(land.building_state)) {
        return { ok: false, error: 'Bangunan sedang terbengkalai/runtuh! Lakukan renovasi atau pembersihan puing di `/property` sebelum mengisi etalase.' };
    }
    const cells = await getLandCells(conn, landId, 'active');
    const stats = computeLandStats(cells, land, getCityZoning(land.city_id));
    const bizZone = (stats.businessZones || []).find(bz => bz.zoneGroupId === zoneGroupId);
    const targetCell = cells.find(c => c.zone_group_id === zoneGroupId);
    if (!bizZone && !targetCell) {
        return { ok: false, error: 'Zona/etalase usaha aktif tidak ditemukan di kavling ini.' };
    }
    const mod = bizZone ? bizZone.module : getBuildingModule(targetCell.module_id);
    const bizType = mod.stats?.businessType;
    if (!['shop', 'cafe'].includes(bizType)) {
        return { ok: false, error: `Modul **${mod.name}** bukan etalase barang/masakan.` };
    }

    const item = getItem(itemId);
    if (!item || (item.sellPrice <= 0 && item.buyPrice <= 0)) {
        return { ok: false, error: 'Item ini tidak dapat dijual di etalase usaha.' };
    }
    if (bizType === 'cafe' && !(item.tags?.includes('dish') || item.tags?.includes('food') || item.tags?.includes('drink') || item.tags?.includes('perfect_dish'))) {
        return { ok: false, error: 'Kafe & Resto hanya menerima makanan, masakan, atau minuman.' };
    }

    const amount = Math.max(1, Math.floor(Number(qty || 1)));
    const bagRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
    const bagCount = bagRows.filter(r => r.item_id === itemId).reduce((s, r) => s + Number(r.quantity), 0);
    if (bagCount < amount) {
        return { ok: false, error: `Stok **${item.name}** di tasmu kurang (punya ${bagCount}, butuh ${amount}).` };
    }

    const [bizRows] = await conn.execute(
        `SELECT * FROM land_business_state WHERE land_id = ? AND zone_group_id = ? FOR UPDATE`,
        [landId, zoneGroupId]
    );

    let stockMap = {};
    if (bizRows.length > 0 && bizRows[0].stock_json) {
        try { stockMap = JSON.parse(bizRows[0].stock_json) || {}; } catch { stockMap = {}; }
    }

    const maxDistinct = mod.stats.businessSlots || 10;
    if (!stockMap[itemId] && Object.keys(stockMap).length >= maxDistinct) {
        return { ok: false, error: `Etalase zona penuh (maks ${maxDistinct} jenis barang).` };
    }

    await removeItem(conn, discordId, itemId, amount, 'bag');
    stockMap[itemId] = Number(stockMap[itemId] || 0) + amount;

    if (bizRows.length === 0) {
        await conn.execute(
            `INSERT INTO land_business_state (land_id, zone_group_id, business_type, stock_json, pending_revenue, last_tick_at, is_open)
             VALUES (?, ?, ?, ?, 0, ?, 1)`,
            [landId, zoneGroupId, bizType, JSON.stringify(stockMap), now]
        );
    } else {
        await conn.execute(
            `UPDATE land_business_state SET stock_json = ?, is_open = 1 WHERE land_id = ? AND zone_group_id = ?`,
            [JSON.stringify(stockMap), landId, zoneGroupId]
        );
    }

    return {
        ok: true,
        item,
        qtyAdded: amount,
        totalStock: stockMap[itemId],
        unitPrice: getControlledRetailPrice(item)
    };
}

/**
 * Lazy-evaluation siklus pendapatan usaha nyata (hanya dari stok tersimpan) & keausan kondisi bangunan.
 */
async function syncBusinessRevenueTick(conn, landId, now = Date.now()) {
    const land = await getLandById(conn, landId, true);
    if (!land) return { ok: false };

    const cells = await getLandCells(conn, landId, 'active');
    if (cells.length === 0) return { ok: true, soldCount: 0, addedRevenue: 0 };

    const zoning = getCityZoning(land.city_id);
    const stats = computeLandStats(cells, land, zoning);
    const condSync = await syncLandCondition(conn, landId, now);
    const nextCondition = Number(condSync.conditionPct ?? land.condition_pct ?? 100);
    const buildingState = condSync.state || land.building_state || 'active';

    let totalSold = 0;
    let totalNetAdded = 0;

    for (const bz of stats.businessZones) {
        const [rows] = await conn.execute(
            `SELECT * FROM land_business_state WHERE land_id = ? AND zone_group_id = ? FOR UPDATE`,
            [landId, bz.zoneGroupId]
        );
        const state = rows[0];
        const lastTick = state ? Number(state.last_tick_at || now) : now;
        const hours = Math.max(0, Math.min(48, (now - lastTick) / 3600000));

        if (!state) {
            await conn.execute(
                `INSERT IGNORE INTO land_business_state (land_id, zone_group_id, business_type, stock_json, pending_revenue, last_tick_at, is_open)
                 VALUES (?, ?, ?, '{}', 0, ?, 1)`,
                [landId, bz.zoneGroupId, bz.module.stats.businessType, now]
            );
            continue;
        }
        if (hours < 0.25 || Number(state.is_open) === 0 || buildingState === 'abandoned' || buildingState === 'collapsed' || nextCondition < 35) {
            await conn.execute(
                `UPDATE land_business_state SET last_tick_at = ? WHERE land_id = ? AND zone_group_id = ?`,
                [now, landId, bz.zoneGroupId]
            );
            continue;
        }

        const bizType = bz.module.stats.businessType;
        if (bizType === 'shop' || bizType === 'cafe') {
            let stockMap = {};
            try { stockMap = JSON.parse(state.stock_json || '{}') || {}; } catch { stockMap = {}; }

            const appealMult = Number(stats.appealMultiplier || 1);
            const maxBuyers = Math.floor(hours * (1.1 + stats.appealScore * 0.06) * Number(zoning.businessTrafficMult || 1) * appealMult);
            let remainingBudget = maxBuyers;
            let zoneGross = 0;

            for (const itemId of Object.keys(stockMap)) {
                if (remainingBudget <= 0) break;
                const avail = Number(stockMap[itemId] || 0);
                if (avail <= 0) {
                    delete stockMap[itemId];
                    continue;
                }
                const sellQty = Math.min(avail, remainingBudget);
                const it = getItem(itemId);
                const unitPrice = getControlledRetailPrice(it);
                zoneGross += sellQty * unitPrice;
                remainingBudget -= sellQty;
                totalSold += sellQty;
                if (avail - sellQty <= 0) delete stockMap[itemId];
                else stockMap[itemId] = avail - sellQty;
            }

            // Potong biaya listrik/operasional 5% agar tetap anti-inflasi
            const zoneNet = Math.round(zoneGross * 0.95);
            totalNetAdded += zoneNet;
            await conn.execute(
                `UPDATE land_business_state SET stock_json = ?, pending_revenue = pending_revenue + ?, last_tick_at = ? WHERE land_id = ? AND zone_group_id = ?`,
                [JSON.stringify(stockMap), zoneNet, now, landId, bz.zoneGroupId]
            );
        } else if (bizType === 'rental') {
            // Jika kamar belum disewa P2P & kondisi >= 60%, ada penghuni NPC membayar tarif kecil
            const [p2pLease] = await conn.execute(
                `SELECT id FROM property_leases WHERE land_id = ? AND zone_group_id = ? AND is_evicted = 0 LIMIT 1`,
                [landId, bz.zoneGroupId]
            );
            let zoneNet = 0;
            if (p2pLease.length === 0 && nextCondition >= 60 && hours >= 1) {
                const wholeHours = Math.floor(hours);
                const netHourly = Math.round(450 * Number(zoning.businessTrafficMult || 1));
                zoneNet = wholeHours * netHourly;
                totalNetAdded += zoneNet;
            }
            await conn.execute(
                `UPDATE land_business_state SET pending_revenue = pending_revenue + ?, last_tick_at = ? WHERE land_id = ? AND zone_group_id = ?`,
                [zoneNet, now, landId, bz.zoneGroupId]
            );
        }
    }

    return { ok: true, soldCount: totalSold, addedRevenue: totalNetAdded, conditionPct: nextCondition };
}

async function collectBusinessRevenue(conn, discordId, landId, now = Date.now()) {
    const land = await getLandById(conn, landId, true);
    if (!land || land.discord_id !== discordId) {
        return { ok: false, error: 'Kavling tidak ditemukan.' };
    }
    await syncBusinessRevenueTick(conn, landId, now);
    const [rows] = await conn.execute(
        `SELECT SUM(pending_revenue) AS total_pending FROM land_business_state WHERE land_id = ?`,
        [landId]
    );
    const pending = Math.round(Number(rows[0]?.total_pending || 0));
    if (pending <= 0) {
        return { ok: false, error: 'Belum ada hasil penjualan atau sewa yang bisa diklaim.' };
    }

    const [pRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? FOR UPDATE`, [discordId]);
    if (pRows.length === 0) return { ok: false, error: 'Akun tidak ditemukan.' };

    await conn.execute(`UPDATE land_business_state SET pending_revenue = 0 WHERE land_id = ?`, [landId]);
    await creditPlayerCash(conn, pRows[0], pending, 'property_business_income', { landId }, now);

    return { ok: true, claimed: pending };
}

async function repairLandCondition(conn, discordId, landId, now = Date.now()) {
    const res = await performLightMaintenance(conn, discordId, landId, now);
    if (!res.ok) return res;
    return { ok: true, cost: res.costLp, ...res };
}

/**
 * Mengolah bahan bangunan mentah -> bahan jadi di Workshop Umum Kota atau Workshop Pribadi.
 */
async function startWorkshopCraft(conn, discordId, { landId = null, cityId = 'kota_sentral', recipeId, batches = 1 }, now = Date.now()) {
    const recipe = getWorkshopRecipe(recipeId);
    if (!recipe) return { ok: false, error: 'Resep workshop tidak ditemukan.' };

    const count = Math.max(1, Math.min(20, Math.floor(Number(batches || 1))));
    const [pRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? FOR UPDATE`, [discordId]);
    if (pRows.length === 0) return { ok: false, error: 'Akun tidak ditemukan.' };
    const player = pRows[0];

    let targetCityId = cityId;
    let isPrivate = false;
    let stationLabel = 'Workshop Umum Kota';

    if (landId) {
        const land = await getLandById(conn, landId);
        if (!land || land.discord_id !== discordId) {
            return { ok: false, error: 'Kavling workshop tidak ditemukan.' };
        }
        if (['abandoned', 'collapsed'].includes(land.building_state)) {
            return { ok: false, error: 'Workshop pribadi terkunci karena bangunan terbengkalai/runtuh. Lakukan perawatan di `/property` terlebih dahulu.' };
        }
        const cells = await getLandCells(conn, landId, 'active');
        const stats = computeLandStats(cells, land, getCityZoning(land.city_id));
        const hasStation =
            cells.some(c => recipe.stationModuleIds.includes(c.module_id)) ||
            (stats.workshopStations || []).includes(recipe.stationType);
        if (!hasStation) {
            return {
                ok: false,
                error: `Bangunan **${land.custom_name}** belum memiliki modul stasiun yang cocok (${recipe.stationModuleIds.join(', ')}).`
            };
        }
        targetCityId = land.city_id;
        isPrivate = true;
        stationLabel = `Workshop Pribadi (${land.custom_name})`;
    }

    const zoning = getCityZoning(targetCityId);
    const feePerBatch = isPrivate ? recipe.privateFee : recipe.npcFee;
    const totalFee = Math.round(feePerBatch * count * Number(zoning.workshopCostMult || 1));

    // Cek ketersediaan semua bahan input di tas (+ gudang lokal jika workshop pribadi)
    const bagRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
    const gudangRows = isPrivate ? await getPlayerInventory(conn, discordId, true, 'gudang', now, landId) : [];

    for (const inp of recipe.inputs) {
        const need = inp.qty * count;
        const bagQty = bagRows.filter(r => r.item_id === inp.itemId).reduce((s, r) => s + Number(r.quantity), 0);
        const gudQty = gudangRows.filter(r => r.item_id === inp.itemId).reduce((s, r) => s + Number(r.quantity), 0);
        if (bagQty + gudQty < need) {
            const it = getItem(inp.itemId);
            return {
                ok: false,
                error: `Bahan kurang: butuh **${need}× ${it ? it.name : inp.itemId}** (tersedia ${bagQty + gudQty}).`
            };
        }
    }

    try {
        await debitPlayerFunds(conn, player, totalFee, 'workshop_craft_fee', { recipeId, count, isPrivate }, now);
    } catch (err) {
        if (err.message === 'INSUFFICIENT_FUNDS') {
            return { ok: false, error: `Saldo tidak cukup untuk biaya jasa/listrik (Butuh **Lp ${totalFee.toLocaleString('id-ID')}**).` };
        }
        throw err;
    }

    for (const inp of recipe.inputs) {
        let need = inp.qty * count;
        const bagQty = bagRows.filter(r => r.item_id === inp.itemId).reduce((s, r) => s + Number(r.quantity), 0);
        const takeBag = Math.min(need, bagQty);
        if (takeBag > 0) {
            await removeItem(conn, discordId, inp.itemId, takeBag, 'bag');
            need -= takeBag;
        }
        if (need > 0 && isPrivate) {
            await removeItem(conn, discordId, inp.itemId, need, 'gudang', landId);
        }
    }

    const durationMs = recipe.durationSec * 1000 * count;
    const finishesAt = now + durationMs;

    await conn.execute(
        `INSERT INTO workshop_queues (land_id, discord_id, station_module, recipe_id, quantity, started_at, finishes_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [isPrivate ? landId : null, discordId, recipe.stationType, recipe.id, count, now, finishesAt]
    );

    return {
        ok: true,
        recipe,
        batches: count,
        outputTotal: recipe.outputQty * count,
        feePaid: totalFee,
        stationLabel,
        finishesAt
    };
}

async function collectWorkshopQueues(conn, discordId, maxSlots, now = Date.now()) {
    const [rows] = await conn.execute(
        `SELECT * FROM workshop_queues WHERE discord_id = ? AND finishes_at <= ? ORDER BY finishes_at ASC FOR UPDATE`,
        [discordId, now]
    );
    if (rows.length === 0) return { ok: false, error: 'Belum ada hasil workshop yang siap diambil.' };

    const bagRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
    const itemsToAdd = [];
    for (const q of rows) {
        const recipe = getWorkshopRecipe(q.recipe_id);
        if (!recipe) continue;
        itemsToAdd.push({ itemId: recipe.outputItemId, qty: recipe.outputQty * Number(q.quantity || 1) });
    }

    if (!canFitItems(bagRows, maxSlots, itemsToAdd)) {
        return { ok: false, error: 'Tas (/inventory) tidak muat menampung seluruh hasil workshop! Kosongkan tas terlebih dahulu.' };
    }

    for (const add of itemsToAdd) {
        await addItem(conn, discordId, add.itemId, add.qty, now, 'bag');
    }
    const ids = rows.map(r => r.id);
    await conn.execute(`DELETE FROM workshop_queues WHERE id IN (${ids.map(() => '?').join(',')})`, ids);

    return { ok: true, collected: itemsToAdd };
}

/**
 * Menerbitkan atau menerima sewa kamar kos / properti P2P.
 */
async function rentP2PRoomOrProperty(conn, tenantId, { landId, zoneGroupId = null, weeklyRent = 150000 }, now = Date.now()) {
    const land = await getLandById(conn, landId, true);
    if (!land) return { ok: false, error: 'Properti tidak ditemukan.' };
    if (land.discord_id === tenantId) {
        return { ok: false, error: 'Tidak dapat menyewa properti milik sendiri.' };
    }

    const [existingTenant] = await conn.execute(
        `SELECT id FROM property_leases WHERE tenant_id = ? AND city_id = ? AND is_evicted = 0 LIMIT 1`,
        [tenantId, land.city_id]
    );
    if (existingTenant.length > 0) {
        return { ok: false, error: 'Kamu masih memiliki kontrak sewa aktif di kota ini.' };
    }

    const leaseKind = zoneGroupId ? 'p2p_room' : 'p2p_whole';
    if (leaseKind === 'p2p_room') {
        const [roomTaken] = await conn.execute(
            `SELECT id FROM property_leases WHERE land_id = ? AND zone_group_id = ? AND is_evicted = 0 LIMIT 1`,
            [landId, zoneGroupId]
        );
        if (roomTaken.length > 0) {
            return { ok: false, error: 'Kamar kos ini sudah disewa pemain lain.' };
        }
    }

    const rentCost = Math.max(25000, Math.round(Number(weeklyRent)));
    const [tRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? FOR UPDATE`, [tenantId]);
    const [oRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? FOR UPDATE`, [land.discord_id]);
    if (tRows.length === 0 || oRows.length === 0) return { ok: false, error: 'Akun pemain tidak valid.' };

    // Verifikasi anti-alt kedua pihak
    const tElig = validateP2PTradeEligibility(tRows[0], getTotalSkillLevelFromPlayerRow(tRows[0]), now);
    if (!tElig.ok) return { ok: false, error: tElig.reason };

    try {
        await debitPlayerFunds(conn, tRows[0], rentCost, 'p2p_property_rent', { landId, leaseKind }, now);
    } catch (err) {
        if (err.message === 'INSUFFICIENT_FUNDS') {
            return { ok: false, error: `Saldo tidak cukup untuk membayar sewa minggu pertama (Lp ${rentCost.toLocaleString('id-ID')}).` };
        }
        throw err;
    }

    // Pemilik menerima 95% (pajak sewa 5% sebagai sink anti-transfer)
    const ownerNet = Math.round(rentCost * 0.95);
    await creditPlayerCash(conn, oRows[0], ownerNet, 'p2p_property_rent_income', { landId, tenantId }, now);

    await conn.execute(
        `INSERT INTO property_leases (land_id, zone_group_id, owner_id, tenant_id, city_id, lease_kind, preset_tier, weekly_rent, next_billing_at, grace_until, is_evicted, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, 0, ?)`,
        [landId, zoneGroupId, land.discord_id, tenantId, land.city_id, leaseKind, rentCost, now + SEVEN_DAYS_MS, now]
    );

    return { ok: true, rentCost, ownerNet, leaseKind };
}

/**
 * Mendaftarkan kavling ke Pasar Jual-Beli Properti P2P dengan NJOP bounds & guardrail anti-alt.
 */
async function createMarketListing(conn, sellerId, landId, askingPrice, now = Date.now()) {
    const land = await getLandById(conn, landId, true);
    if (!land || land.discord_id !== sellerId) {
        return { ok: false, error: 'Kavling tidak ditemukan atau bukan milikmu.' };
    }

    const [pRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? FOR UPDATE`, [sellerId]);
    const sellerElig = validateP2PTradeEligibility(pRows[0], getTotalSkillLevelFromPlayerRow(pRows[0]), now);
    if (!sellerElig.ok) return { ok: false, error: sellerElig.reason };

    const [activeCredit] = await conn.execute(
        `SELECT id FROM player_credits WHERE land_id = ? AND status = 'active' LIMIT 1`,
        [landId]
    );
    if (activeCredit.length > 0) {
        return { ok: false, error: 'Properti ini masih menjadi agunan KPR di `/credit`. Lunasi cicilan sebelum menjual.' };
    }

    const [activeProj] = await conn.execute(
        `SELECT id FROM construction_projects WHERE land_id = ? AND status = 'building' LIMIT 1`,
        [landId]
    );
    if (activeProj.length > 0) {
        return { ok: false, error: 'Properti sedang dalam proses konstruksi aktif. Tunggu hingga selesai.' };
    }

    const [dupListing] = await conn.execute(
        `SELECT id FROM property_market_listings WHERE land_id = ? AND status = 'active' LIMIT 1`,
        [landId]
    );
    if (dupListing.length > 0) {
        return { ok: false, error: 'Kavling ini sudah terdaftar aktif di Pasar Properti.' };
    }

    const cells = await getLandCells(conn, landId, 'active');
    const stats = computeLandStats(cells, land);
    const bounds = validateMarketPriceBounds(askingPrice, stats.totalAppraisalValue);
    if (!bounds.ok) return { ok: false, error: bounds.reason };

    const [insRes] = await conn.execute(
        `INSERT INTO property_market_listings (land_id, seller_id, buyer_id, city_id, asking_price, appraisal_value, status, created_at)
         VALUES (?, ?, NULL, ?, ?, ?, 'active', ?)`,
        [landId, sellerId, land.city_id, bounds.price, bounds.njop, now]
    );

    return {
        ok: true,
        listingId: insRes.insertId,
        askingPrice: bounds.price,
        appraisalValue: bounds.njop
    };
}

async function buyMarketListing(conn, buyerId, listingId, now = Date.now()) {
    const [rows] = await conn.execute(
        `SELECT * FROM property_market_listings WHERE id = ? AND status = 'active' LIMIT 1 FOR UPDATE`,
        [listingId]
    );
    if (rows.length === 0) {
        return { ok: false, error: 'Listing properti sudah terjual atau dibatalkan.' };
    }
    const listing = rows[0];
    if (listing.seller_id === buyerId) {
        return { ok: false, error: 'Kamu tidak dapat membeli properti yang kamu jual sendiri.' };
    }

    const [bRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? FOR UPDATE`, [buyerId]);
    const [sRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? FOR UPDATE`, [listing.seller_id]);
    if (bRows.length === 0 || sRows.length === 0) {
        return { ok: false, error: 'Data penjual atau pembeli tidak valid.' };
    }

    const buyer = bRows[0];
    const buyerSkillLv = getTotalSkillLevelFromPlayerRow(buyer);
    const buyerElig = validateP2PTradeEligibility(buyer, buyerSkillLv, now);
    if (!buyerElig.ok) return { ok: false, error: buyerElig.reason };

    const buyerLands = await getPlayerLands(conn, buyerId, null, true);
    const maxLimit = getMaxLandLimit(buyerSkillLv);
    if (buyerLands.length >= maxLimit) {
        return { ok: false, error: `Kapasitas kepemilikan tanahmu penuh (${buyerLands.length}/${maxLimit} kavling).` };
    }

    const price = Number(listing.asking_price);
    const taxBphtb = Math.round(price * P2P_PROPERTY_RULES.BPHTB_TAX_RATE);
    const sellerProceeds = price - taxBphtb;

    try {
        await debitPlayerFunds(conn, buyer, price, 'p2p_property_buy', { listingId, landId: listing.land_id }, now);
    } catch (err) {
        if (err.message === 'INSUFFICIENT_FUNDS') {
            return { ok: false, error: `Saldo tidak cukup untuk membeli properti ini (Harga **Lp ${price.toLocaleString('id-ID')}**).` };
        }
        throw err;
    }

    await creditPlayerCash(conn, sRows[0], sellerProceeds, 'p2p_property_sell', { listingId, landId: listing.land_id, taxBphtb }, now);
    await logLedger(conn, buyerId, 'sink', 'p2p_property_bphtb_tax', taxBphtb, Number(buyer.cash) + Number(buyer.bank), { listingId }, now);

    // Pindahkan kepemilikan tanah ke pembeli
    await conn.execute(
        `UPDATE player_lands SET discord_id = ?, is_primary = 0, updated_at = ? WHERE id = ?`,
        [buyerId, now, listing.land_id]
    );
    await conn.execute(
        `UPDATE city_land_parcels SET owner_id = ? WHERE land_id = ?`,
        [buyerId, listing.land_id]
    );
    await conn.execute(
        `UPDATE land_trade_offers SET status = 'cancelled' WHERE land_id = ? AND status = 'pending'`,
        [listing.land_id]
    );
    await conn.execute(
        `UPDATE property_market_listings SET buyer_id = ?, status = 'sold', sold_at = ? WHERE id = ?`,
        [buyerId, now, listingId]
    );

    return {
        ok: true,
        landId: listing.land_id,
        price,
        taxBphtb,
        sellerProceeds
    };
}

async function cancelMarketListing(conn, sellerId, listingId) {
    const [res] = await conn.execute(
        `UPDATE property_market_listings SET status = 'cancelled' WHERE id = ? AND seller_id = ? AND status = 'active'`,
        [listingId, sellerId]
    );
    if (!res.affectedRows) {
        return { ok: false, error: 'Listing aktif tidak ditemukan.' };
    }
    return { ok: true };
}

module.exports = {
    P2P_PROPERTY_RULES,
    validateP2PTradeEligibility,
    validateMarketPriceBounds,
    getControlledRetailPrice,
    stockBusinessItem,
    syncBusinessRevenueTick,
    collectBusinessRevenue,
    repairLandCondition,
    startWorkshopCraft,
    collectWorkshopQueues,
    rentP2PRoomOrProperty,
    createMarketListing,
    buyMarketListing,
    cancelMarketListing
};
