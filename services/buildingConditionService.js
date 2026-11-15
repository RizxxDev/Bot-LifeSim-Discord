const {
    getStructuralMaterial,
    getFloorMaterial,
    getWallEdgeType,
    getRoofVariant,
    getBuildingModule,
    calculateStructuralStress
} = require('../data/buildingModules');
const { getWeatherSeason } = require('../data/events');
const { getCity } = require('../data/cities');
const { debitPlayerFunds } = require('./economyService');
const { getItem } = require('../data/items');
const { formatLp } = require('../utils/uiBuilder');

const ONE_DAY_MS = 24 * 3600 * 1000;

const CONDITION_THRESHOLDS = {
    GOOD_MIN: 70,
    WORN_MIN: 35,
    ABANDONED_MIN: 1,
    COLLAPSED: 0,
    FORECLOSURE_GRACE_MS: 21 * ONE_DAY_MS
};

function getConditionMeta(conditionPct = 100, buildingState = 'active', hasCells = true) {
    const pct = Math.max(0, Math.min(100, Number(conditionPct ?? 100)));
    if (buildingState === 'collapsed' || (hasCells && pct <= 0)) {
        return {
            state: 'collapsed',
            badge: '💥 RUBUH (PUING)',
            label: 'Bangunan Rubuh (Butuh Pembersihan Puing)',
            qualityFactor: 0,
            facilitiesLocked: true,
            isAbandoned: true,
            isCollapsed: true
        };
    }
    if (!hasCells || buildingState === 'empty') {
        return {
            state: 'empty',
            badge: '🟢 Lahan Kosong',
            label: 'Tanah Kosong (Siap Dibangun)',
            qualityFactor: 1.0,
            facilitiesLocked: false,
            isAbandoned: false,
            isCollapsed: false
        };
    }
    if (buildingState === 'abandoned' || pct < CONDITION_THRESHOLDS.WORN_MIN) {
        return {
            state: 'abandoned',
            badge: '🔴 TERBENGKALAI',
            label: 'Terbengkalai (<35% · Fasilitas Terkunci!)',
            qualityFactor: 0,
            facilitiesLocked: true,
            isAbandoned: true,
            isCollapsed: false
        };
    }
    if (pct < CONDITION_THRESHOLDS.GOOD_MIN) {
        return {
            state: 'worn',
            badge: '🟡 Mulai Usang',
            label: 'Mulai Usang (35–69% · Performa 75%)',
            qualityFactor: 0.75,
            facilitiesLocked: false,
            isAbandoned: false,
            isCollapsed: false
        };
    }
    return {
        state: 'active',
        badge: '🟢 Terawat Baik',
        label: 'Terawat Baik (70–100% · Performa 100%)',
        qualityFactor: 1.0,
        facilitiesLocked: false,
        isAbandoned: false,
        isCollapsed: false
    };
}

function aggregateCellMaterials(cells = [], ratio = 1.0) {
    const map = {};
    for (const c of cells || []) {
        const mat = getStructuralMaterial(c.material_id ?? c.mat ?? 'kayu');
        const mod = getBuildingModule(c.module_id ?? c.mod ?? 'hall_custom');
        const mult = Number(mod.materialCostMult || 1.0);

        for (const [itemId, qty] of Object.entries(mat.costPerCell || {})) {
            const raw = Number(qty || 0) * mult;
            map[itemId] = (map[itemId] || 0) + raw;
        }
        for (const [itemId, qty] of Object.entries(mod.extraCostPerCell || {})) {
            map[itemId] = (map[itemId] || 0) + Number(qty || 0);
        }
    }

    const out = {};
    for (const [itemId, total] of Object.entries(map)) {
        const amt = Math.floor(total * ratio);
        if (amt > 0) out[itemId] = amt;
    }
    return out;
}

function computeDailyDegradationRate(cells = [], land = null, now = Date.now(), hasBusiness = false) {
    const weather = getWeatherSeason(now);
    const isRainySeason = weather.id === 'hujan';

    if (!cells || cells.length === 0) {
        return {
            dailyDecayPct: 0,
            baseWearRate: 0,
            stress: calculateStructuralStress([]),
            isRainySeason,
            weather,
            stormCollapseChance: 0
        };
    }

    let wearSum = 0;
    let appraisalSum = 0;
    for (const c of cells) {
        const mat = getStructuralMaterial(c.material_id ?? c.mat ?? 'kayu');
        const mod = getBuildingModule(c.module_id ?? c.mod ?? 'hall_custom');
        wearSum += Number(mat.dailyWearRate ?? 1.5);
        appraisalSum += Number(mat.appraisalValuePerCell || 0) + Number(mod.appraisalPerCell || 0);
    }

    const baseWearRate = Math.round((wearSum / cells.length) * 100) / 100;
    const stress = calculateStructuralStress(cells);
    const bizLoad = hasBusiness ? 0.6 : 0;
    const weatherMult = isRainySeason ? 1.5 : 1.0;
    const rawDaily = (baseWearRate + stress.dailyExtraDecay + bizLoad) * weatherMult;
    const dailyDecayPct = Math.round(rawDaily * 100) / 100;

    const condPct = Number(land?.condition_pct ?? 100);
    let stormCollapseChance = 0;
    if (isRainySeason && condPct < CONDITION_THRESHOLDS.WORN_MIN) {
        stormCollapseChance = Math.min(0.65, 0.10 + (stress.stormCollapseRiskPct / 100));
    } else if (isRainySeason && stress.stressRatio >= 1.5 && condPct < 50) {
        stormCollapseChance = Math.min(0.35, stress.stormCollapseRiskPct / 150);
    }

    return {
        dailyDecayPct,
        baseWearRate,
        appraisalSum,
        stress,
        isRainySeason,
        weather,
        stormCollapseChance
    };
}

async function sendConditionDmAlert(client, discordId, title, body) {
    if (!client || !client.users) return false;
    try {
        const user = await client.users.fetch(discordId);
        if (!user) return false;
        await user.send({
            content: `### ${title}\n${body}`
        });
        return true;
    } catch {
        return false;
    }
}

async function triggerBuildingCollapse(conn, land, cells, now = Date.now(), client = null, reason = 'degradation') {
    await conn.execute(
        `UPDATE player_lands
         SET condition_pct = 0,
             building_state = 'collapsed',
             collapsed_at = CASE WHEN collapsed_at > 0 THEN collapsed_at ELSE ? END,
             last_condition_tick_at = ?,
             updated_at = ?
         WHERE id = ?`,
        [now, now, now, land.id]
    );

    // Kunci barang di kulkas/freezer/gudang ke Penitipan Darurat agar perlu dibersihkan/evakuasi
    await conn.execute(
        `UPDATE player_inventory
         SET emergency_locked = 1
         WHERE land_id = ? AND storage_location IN ('kulkas', 'freezer', 'gudang')`,
        [land.id]
    );

    // Putus aman kontrak sewa P2P di properti yang rubuh
    await conn.execute(
        `UPDATE property_leases
         SET is_evicted = 1
         WHERE land_id = ? AND is_evicted = 0`,
        [land.id]
    );

    // Kunci seluruh perabotan terpasang di bangunan yang rubuh agar aman di Penitipan Darurat
    await conn.execute(
        `UPDATE land_furniture_items
         SET is_locked_rubble = 1
         WHERE land_id = ?`,
        [land.id]
    );

    if (client && land.discord_id) {
        const city = getCity(land.city_id);
        await sendConditionDmAlert(
            client,
            land.discord_id,
            `💥 BANGUNAN RUBUH! (${land.custom_name})`,
            [
                `Bangunanmu **${land.custom_name}** (\`${land.parcel_code || `#${land.id}`}\`) di ${city.emoji} **${city.name}** telah **RUBUH menjadi Puing** (${reason === 'storm' ? 'akibat badai Musim Hujan & stres struktur tinggi' : 'kondisi turun hingga 0%'}).`,
                `• 📦 Barang dari Kulkas/Freezer/Gudang diamankan ke **Penitipan Darurat Terkunci**.`,
                `• 🚜 Segera buka \`/property\` untuk **Bersihkan Puing** (refund ±30% bahan) & **Evakuasi Barang Darurat**.`
            ].join('\n')
        );
    }
}

/**
 * Evaluasi malas (lazy evaluation) penurunan kondisi bangunan per kavling.
 */
async function syncLandCondition(conn, landId, now = Date.now(), client = null) {
    const [landRows] = await conn.execute(
        `SELECT * FROM player_lands WHERE id = ? LIMIT 1 FOR UPDATE`,
        [landId]
    );
    if (landRows.length === 0) return { ok: false, error: 'Kavling tidak ditemukan.' };
    const land = landRows[0];

    if (land.building_state === 'collapsed') {
        return {
            ok: true,
            land,
            state: 'collapsed',
            conditionPct: 0,
            abandoned: true,
            collapsed: true
        };
    }

    const [cells] = await conn.execute(
        `SELECT * FROM land_grid_cells WHERE land_id = ? AND layout_state = 'active'`,
        [landId]
    );
    const [floorRows] = await conn.execute(
        `SELECT * FROM land_floor_cells WHERE land_id = ? AND layout_state = 'active'`,
        [landId]
    );

    if (cells.length === 0 && floorRows.length === 0) {
        if (land.building_state !== 'empty' || Number(land.last_condition_tick_at || 0) === 0) {
            await conn.execute(
                `UPDATE player_lands SET building_state = 'empty', last_condition_tick_at = ? WHERE id = ?`,
                [now, landId]
            );
            land.building_state = 'empty';
            land.last_condition_tick_at = now;
        }
        return {
            ok: true,
            land,
            state: 'empty',
            conditionPct: Number(land.condition_pct ?? 100),
            abandoned: false,
            collapsed: false
        };
    }

    const degCells = cells.length > 0
        ? cells
        : floorRows.map(fc => ({ floor_level: fc.floor_level, material_id: fc.floor_material_id, module_id: 'hall_custom' }));

    const lastTick = Number(land.last_condition_tick_at || land.updated_at || land.acquired_at || now);
    const elapsedMs = Math.max(0, now - lastTick);
    const elapsedDays = elapsedMs / ONE_DAY_MS;
    const prevCond = Math.max(0, Math.min(100, Number(land.condition_pct ?? 100)));

    // Jangan ubah jika baru < 5 menit sejak tick terakhir
    if (elapsedMs < 5 * 60 * 1000) {
        const meta = getConditionMeta(prevCond, land.building_state, true);
        return {
            ok: true,
            land,
            state: meta.state,
            conditionPct: prevCond,
            abandoned: meta.isAbandoned,
            collapsed: meta.isCollapsed
        };
    }

    const [bizRows] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM land_business_state WHERE land_id = ? AND is_open = 1`,
        [landId]
    );
    const hasBiz = Number(bizRows[0]?.cnt || 0) > 0;
    const deg = computeDailyDegradationRate(degCells, land, now, hasBiz);

    const decay = deg.dailyDecayPct * elapsedDays;
    let nextCond = Math.max(0, Math.round((prevCond - decay) * 100) / 100);

    // Cek risiko rubuh karena badai saat terbengkalai / stres tinggi
    if (nextCond > 0 && elapsedDays >= 0.25 && deg.stormCollapseChance > 0) {
        const roll = Math.random();
        if (roll < deg.stormCollapseChance * Math.min(2, elapsedDays)) {
            await triggerBuildingCollapse(conn, land, cells, now, client, 'storm');
            land.condition_pct = 0;
            land.building_state = 'collapsed';
            return {
                ok: true,
                land,
                state: 'collapsed',
                conditionPct: 0,
                abandoned: true,
                collapsed: true,
                stormCollapsed: true
            };
        }
    }

    if (nextCond <= 0) {
        await triggerBuildingCollapse(conn, land, cells, now, client, 'degradation');
        land.condition_pct = 0;
        land.building_state = 'collapsed';
        return {
            ok: true,
            land,
            state: 'collapsed',
            conditionPct: 0,
            abandoned: true,
            collapsed: true
        };
    }

    let nextState = 'active';
    let abandonedSince = Number(land.abandoned_since || 0);
    let abandonedNotified = Number(land.abandoned_notified || 0);

    if (nextCond < CONDITION_THRESHOLDS.WORN_MIN) {
        nextState = 'abandoned';
        if (abandonedSince === 0) abandonedSince = now;
        if (!abandonedNotified && client) {
            const city = getCity(land.city_id);
            const sent = await sendConditionDmAlert(
                client,
                land.discord_id,
                `⚠️ PERINGATAN PROPERTI TERBENGKALAI (${land.custom_name})`,
                [
                    `Kondisi bangunan **${land.custom_name}** (\`${land.parcel_code || `#${land.id}`}\`) di ${city.emoji} **${city.name}** turun ke **${nextCond.toFixed(1)}%** dan berstatus **TERBENGKALAI**!`,
                    `• 🔒 Fasilitas Kulkas, Freezer, Dapur & Usaha sedang **terkunci sementara**.`,
                    `• 🛠️ Buka \`/property\` untuk **Renovasi Berat** sebelum kondisi jatuh ke **0% (Rubuh)** atau disita kota.`
                ].join('\n')
            );
            if (sent) abandonedNotified = 1;
        }
    } else {
        abandonedSince = 0;
        abandonedNotified = 0;
    }

    await conn.execute(
        `UPDATE player_lands
         SET condition_pct = ?,
             building_state = ?,
             abandoned_since = ?,
             abandoned_notified = ?,
             last_condition_tick_at = ?
         WHERE id = ?`,
        [nextCond, nextState, abandonedSince, abandonedNotified, now, landId]
    );

    land.condition_pct = nextCond;
    land.building_state = nextState;
    land.abandoned_since = abandonedSince;
    land.abandoned_notified = abandonedNotified;
    land.last_condition_tick_at = now;

    return {
        ok: true,
        land,
        state: nextState,
        conditionPct: nextCond,
        abandoned: nextState === 'abandoned',
        collapsed: false,
        degradation: deg
    };
}

/**
 * Perawatan Ringan (untuk kondisi >= 35%, energi + Lp kecil + opsional bahan tambal jika Usang).
 */
async function performLightMaintenance(conn, discordId, landId, now = Date.now()) {
    const syncRes = await syncLandCondition(conn, landId, now, null);
    if (!syncRes.ok) return syncRes;
    const land = syncRes.land;
    if (land.discord_id !== discordId) return { ok: false, error: 'Kavling bukan milikmu.' };
    if (land.building_state === 'collapsed') {
        return { ok: false, error: 'Bangunan sudah **RUBUH**. Gunakan tombol **🚜 Bersihkan Puing** terlebih dahulu.' };
    }
    if (land.building_state === 'abandoned' || Number(land.condition_pct) < CONDITION_THRESHOLDS.WORN_MIN) {
        return { ok: false, error: 'Kondisi sudah **< 35% (Terbengkalai)**. Wajib memakai **🛠️ Renovasi Berat (Berbahan)**!' };
    }

    const condPct = Number(land.condition_pct ?? 100);
    if (condPct >= 99) {
        return { ok: false, error: 'Kondisi bangunan masih prima (100%).' };
    }

    const [pRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? LIMIT 1 FOR UPDATE`, [discordId]);
    if (pRows.length === 0) return { ok: false, error: 'Akun tidak ditemukan.' };
    const player = pRows[0];

    const energyCost = 15;
    if (Number(player.energy || 0) < energyCost) {
        return { ok: false, error: `Energy tidak cukup untuk merawat bangunan (Butuh **${energyCost}⚡**, kamu punya ${player.energy}⚡).` };
    }

    const [cells] = await conn.execute(
        `SELECT * FROM land_grid_cells WHERE land_id = ? AND layout_state = 'active'`,
        [landId]
    );
    const totalMatValue = Object.entries(aggregateCellMaterials(cells, 1.0))
        .reduce((acc, [id, q]) => acc + q * Number(getItem(id)?.buyPrice || 2000), 0);

    const isWorn = condPct < CONDITION_THRESHOLDS.GOOD_MIN;
    const baseCost = Math.max(4000, Math.round((100 - condPct) * 0.01 * Math.max(400000, totalMatValue * 0.12)));
    const lpCost = isWorn ? Math.round(baseCost * 1.35) : baseCost;

    try {
        await debitPlayerFunds(conn, player, lpCost, 'property_light_maintenance', { landId, condPct }, now);
    } catch (err) {
        if (err.message === 'INSUFFICIENT_FUNDS') {
            return { ok: false, error: `Saldo tidak cukup untuk perawatan ringan (Butuh **${formatLp(lpCost)}**).` };
        }
        throw err;
    }

    await conn.execute(
        `UPDATE players SET energy = GREATEST(0, energy - ?) WHERE discord_id = ?`,
        [energyCost, discordId]
    );
    await conn.execute(
        `UPDATE player_lands
         SET condition_pct = 100, building_state = ?, last_condition_tick_at = ?, updated_at = ?
         WHERE id = ?`,
        [cells.length > 0 ? 'active' : 'empty', now, now, landId]
    );

    return { ok: true, costLp: lpCost, energyCost, restoredFrom: condPct };
}

function getHeavyRenovationRequirements(cells = [], conditionPct = 30) {
    const missingRatio = Math.max(0.15, Math.min(0.45, (100 - conditionPct) / 220));
    const reqMats = aggregateCellMaterials(cells, missingRatio);
    // Pastikan minimal ada sedikit bahan untuk bangunan terbengkalai
    if (cells.length > 0 && Object.keys(reqMats).length === 0) {
        reqMats.papan_kayu = Math.max(2, Math.ceil(cells.length / 4));
    }
    return reqMats;
}

/**
 * Renovasi Berat (untuk bangunan Mulai Usang atau Terbengkalai <35%) menggunakan Depot / Tas + Lp + Energy.
 */
async function performHeavyRenovation(conn, discordId, landId, now = Date.now()) {
    const syncRes = await syncLandCondition(conn, landId, now, null);
    if (!syncRes.ok) return syncRes;
    const land = syncRes.land;
    if (land.discord_id !== discordId) return { ok: false, error: 'Kavling bukan milikmu.' };
    if (land.building_state === 'collapsed') {
        return { ok: false, error: 'Bangunan sudah **RUBUH**. Gunakan **🚜 Bersihkan Puing** dahulu!' };
    }

    const condPct = Number(land.condition_pct ?? 100);
    if (condPct >= 95 && land.building_state !== 'abandoned') {
        return { ok: false, error: 'Bangunan ini masih dalam kondisi prima, tidak perlu Renovasi Berat.' };
    }

    const [pRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? LIMIT 1 FOR UPDATE`, [discordId]);
    if (pRows.length === 0) return { ok: false, error: 'Akun tidak ditemukan.' };
    const player = pRows[0];

    const energyCost = 25;
    if (Number(player.energy || 0) < energyCost) {
        return { ok: false, error: `Energy kurang untuk renovasi berat (Butuh **${energyCost}⚡**).` };
    }

    const [cells] = await conn.execute(
        `SELECT * FROM land_grid_cells WHERE land_id = ? AND layout_state = 'active'`,
        [landId]
    );
    const reqMats = getHeavyRenovationRequirements(cells, condPct);

    // Cek ketersediaan bahan gabungan Depot Kavling + Tas Pemain
    const [depotRows] = await conn.execute(`SELECT item_id, quantity FROM land_material_depots WHERE land_id = ? FOR UPDATE`, [landId]);
    const depotMap = new Map(depotRows.map(r => [r.item_id, Number(r.quantity || 0)]));
    const [bagRows] = await conn.execute(
        `SELECT id, item_id, quantity FROM player_inventory WHERE discord_id = ? AND storage_location = 'bag' ORDER BY id ASC FOR UPDATE`,
        [discordId]
    );

    const bagQtyMap = new Map();
    for (const r of bagRows) {
        bagQtyMap.set(r.item_id, (bagQtyMap.get(r.item_id) || 0) + Number(r.quantity || 0));
    }

    const missing = [];
    for (const [itemId, need] of Object.entries(reqMats)) {
        const have = (depotMap.get(itemId) || 0) + (bagQtyMap.get(itemId) || 0);
        if (have < need) {
            const it = getItem(itemId);
            missing.push(`${it?.emoji || '🧱'} ${it?.name || itemId}: ${have}/${need}`);
        }
    }
    if (missing.length > 0) {
        return {
            ok: false,
            error: `Bahan renovasi belum cukup (bisa taruh di Tas atau Depot \`/bangun\`):\n• ${missing.join('\n• ')}`
        };
    }

    const lpCost = Math.max(15000, Math.round((100 - condPct) * 500 + cells.length * 1500));
    try {
        await debitPlayerFunds(conn, player, lpCost, 'property_heavy_renovation', { landId, condPct }, now);
    } catch (err) {
        if (err.message === 'INSUFFICIENT_FUNDS') {
            return { ok: false, error: `Saldo kurang untuk biaya tukang renovasi (Butuh **${formatLp(lpCost)}**).` };
        }
        throw err;
    }

    // Potong bahan: prioritaskan Depot lalu Tas
    for (const [itemId, need] of Object.entries(reqMats)) {
        let rem = need;
        const inDepot = depotMap.get(itemId) || 0;
        if (inDepot > 0) {
            const take = Math.min(inDepot, rem);
            rem -= take;
            if (inDepot - take <= 0) {
                await conn.execute(`DELETE FROM land_material_depots WHERE land_id = ? AND item_id = ?`, [landId, itemId]);
            } else {
                await conn.execute(`UPDATE land_material_depots SET quantity = quantity - ? WHERE land_id = ? AND item_id = ?`, [take, landId, itemId]);
            }
        }
        if (rem > 0) {
            for (const row of bagRows) {
                if (row.item_id !== itemId || rem <= 0) continue;
                const rq = Number(row.quantity || 0);
                if (rq <= 0) continue;
                const take = Math.min(rq, rem);
                rem -= take;
                row.quantity -= take;
                if (row.quantity <= 0) {
                    await conn.execute(`DELETE FROM player_inventory WHERE id = ?`, [row.id]);
                } else {
                    await conn.execute(`UPDATE player_inventory SET quantity = ? WHERE id = ?`, [row.quantity, row.id]);
                }
            }
        }
    }

    await conn.execute(`UPDATE players SET energy = GREATEST(0, energy - ?) WHERE discord_id = ?`, [energyCost, discordId]);
    await conn.execute(
        `UPDATE player_lands
         SET condition_pct = 100,
             building_state = ?,
             abandoned_since = 0,
             abandoned_notified = 0,
             last_condition_tick_at = ?,
             updated_at = ?
         WHERE id = ?`,
        [cells.length > 0 ? 'active' : 'empty', now, now, landId]
    );

    return { ok: true, costLp: lpCost, energyCost, materialsUsed: reqMats, restoredFrom: condPct };
}

/**
 * Membersihkan Puing bangunan yang Rubuh (salvage 30% bahan ke Depot, reset kavling ke siap bangun).
 */
async function clearCollapsedRubble(conn, discordId, landId, now = Date.now()) {
    const [landRows] = await conn.execute(`SELECT * FROM player_lands WHERE id = ? LIMIT 1 FOR UPDATE`, [landId]);
    if (landRows.length === 0 || landRows[0].discord_id !== discordId) {
        return { ok: false, error: 'Kavling tidak ditemukan.' };
    }
    const land = landRows[0];
    if (land.building_state !== 'collapsed' && Number(land.condition_pct ?? 100) > 0) {
        return { ok: false, error: 'Bangunan ini tidak berstatus Rubuh.' };
    }

    const [pRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? LIMIT 1 FOR UPDATE`, [discordId]);
    if (pRows.length === 0) return { ok: false, error: 'Akun tidak ditemukan.' };
    const energyCost = 30;
    if (Number(pRows[0].energy || 0) < energyCost) {
        return { ok: false, error: `Energy tidak cukup untuk membersihkan puing (Butuh **${energyCost}⚡**).` };
    }

    const [cells] = await conn.execute(
        `SELECT * FROM land_grid_cells WHERE land_id = ? AND layout_state = 'active'`,
        [landId]
    );
    const [floorRows] = await conn.execute(
        `SELECT * FROM land_floor_cells WHERE land_id = ? AND layout_state = 'active'`,
        [landId]
    );
    const [wallRows] = await conn.execute(
        `SELECT * FROM land_wall_edges WHERE land_id = ? AND layout_state = 'active'`,
        [landId]
    );

    const salvaged = aggregateCellMaterials(cells, 0.30);
    const gridKeySet = new Set(cells.map(c => `${c.floor_level}:${c.x}:${c.y}`));
    for (const fc of floorRows) {
        if (gridKeySet.has(`${fc.floor_level}:${fc.x}:${fc.y}`)) continue;
        const fm = getFloorMaterial(fc.floor_material_id);
        for (const [id, q] of Object.entries(fm.costPerCell || {})) {
            const add = Math.floor(Number(q || 0) * 0.30);
            if (add > 0) salvaged[id] = (salvaged[id] || 0) + add;
        }
        const rv = getRoofVariant(fc.roof_variant);
        for (const [id, q] of Object.entries(rv.costPerCell || {})) {
            const add = Math.floor(Number(q || 0) * 0.30);
            if (add > 0) salvaged[id] = (salvaged[id] || 0) + add;
        }
    }
    for (const we of wallRows) {
        const ws = getWallEdgeType(we.edge_type);
        for (const [id, q] of Object.entries(ws.costPerEdge || {})) {
            const add = Math.floor(Number(q || 0) * 0.30);
            if (add > 0) salvaged[id] = (salvaged[id] || 0) + add;
        }
    }

    for (const [itemId, qty] of Object.entries(salvaged)) {
        await conn.execute(
            `INSERT INTO land_material_depots (land_id, item_id, quantity)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
            [landId, itemId, qty]
        );
    }

    await conn.execute(`DELETE FROM land_rooms WHERE land_id = ?`, [landId]);
    await conn.execute(`DELETE FROM land_wall_edges WHERE land_id = ?`, [landId]);
    await conn.execute(`DELETE FROM land_floor_cells WHERE land_id = ?`, [landId]);
    await conn.execute(`DELETE FROM land_grid_cells WHERE land_id = ?`, [landId]);
    await conn.execute(`DELETE FROM land_business_state WHERE land_id = ?`, [landId]);
    await conn.execute(`UPDATE players SET energy = GREATEST(0, energy - ?) WHERE discord_id = ?`, [energyCost, discordId]);
    await conn.execute(
        `UPDATE player_lands
         SET condition_pct = 100,
             building_state = 'empty',
             abandoned_since = 0,
             abandoned_notified = 0,
             collapsed_at = 0,
             last_condition_tick_at = ?,
             updated_at = ?
         WHERE id = ?`,
        [now, now, landId]
    );

    const evacuated = await evacuateEmergencyStorage(conn, discordId, landId, Number(pRows[0].max_slots || 20), now);
    return {
        ok: true,
        energyCost,
        salvaged,
        evacuatedCount: evacuated.movedCount,
        evacuatedFurnitureCount: evacuated.movedFurnitureCount || 0,
        remainingLocked: evacuated.remainingCount
    };
}

/**
 * Evakuasi barang & perabotan dari Penitipan Darurat (storage & furnitur kavling yang rubuh/terbengkalai) ke Tas pemain.
 */
async function evacuateEmergencyStorage(conn, discordId, landId, playerMaxSlots = 20, now = Date.now()) {
    const [lockedRows] = await conn.execute(
        `SELECT * FROM player_inventory
         WHERE discord_id = ? AND land_id = ? AND storage_location IN ('kulkas', 'freezer', 'gudang')
         ORDER BY id ASC FOR UPDATE`,
        [discordId, landId]
    );
    const [lockedFurniture] = await conn.execute(
        `SELECT * FROM land_furniture_items
         WHERE land_id = ? AND is_locked_rubble = 1
         ORDER BY id ASC FOR UPDATE`,
        [landId]
    );
    if (lockedRows.length === 0 && lockedFurniture.length === 0) {
        return { ok: true, movedCount: 0, movedFurnitureCount: 0, remainingCount: 0 };
    }

    const [bagRows] = await conn.execute(
        `SELECT item_id, quantity, freshness_remaining_ms FROM player_inventory
         WHERE discord_id = ? AND storage_location = 'bag' FOR UPDATE`,
        [discordId]
    );

    const { calculateSlotsUsed, addItem } = require('./inventoryService');
    let bagUsed = calculateSlotsUsed(bagRows);
    let movedCount = 0;
    let movedFurnitureCount = 0;
    let remainingCount = 0;

    for (const row of lockedRows) {
        const it = getItem(row.item_id);
        const isStackable = it ? it.stackable !== false : true;
        const hasMatchInBag = isStackable && bagRows.some(
            b => b.item_id === row.item_id && (b.freshness_remaining_ms ?? null) === (row.freshness_remaining_ms ?? null)
        );
        const slotsNeeded = hasMatchInBag ? 0 : (isStackable ? 1 : Number(row.quantity || 1));

        if (bagUsed + slotsNeeded <= Number(playerMaxSlots || 20)) {
            await conn.execute(
                `UPDATE player_inventory
                 SET storage_location = 'bag', land_id = NULL, emergency_locked = 0
                 WHERE id = ?`,
                [row.id]
            );
            bagUsed += slotsNeeded;
            movedCount += Number(row.quantity || 1);
            bagRows.push({ item_id: row.item_id, quantity: row.quantity, freshness_remaining_ms: row.freshness_remaining_ms });
        } else {
            remainingCount += Number(row.quantity || 1);
        }
    }

    for (const fRow of lockedFurniture) {
        const it = getItem(fRow.item_id);
        const isStackable = it ? it.stackable !== false : true;
        const hasMatchInBag = isStackable && bagRows.some(b => b.item_id === fRow.item_id && b.freshness_remaining_ms == null);
        const slotsNeeded = hasMatchInBag ? 0 : 1;

        if (bagUsed + slotsNeeded <= Number(playerMaxSlots || 20)) {
            await addItem(conn, discordId, fRow.item_id, 1, now, 'bag');
            await conn.execute(`DELETE FROM land_furniture_items WHERE id = ?`, [fRow.id]);
            bagUsed += slotsNeeded;
            movedCount += 1;
            movedFurnitureCount += 1;
            bagRows.push({ item_id: fRow.item_id, quantity: 1, freshness_remaining_ms: null });
        } else {
            remainingCount += 1;
        }
    }

    return { ok: true, movedCount, movedFurnitureCount, remainingCount };
}

/**
 * Batch scheduler tick untuk memeriksa seluruh kavling yang belum dicek >= 1 jam.
 */
async function runScheduledBuildingConditionChecks(conn, now = Date.now(), client = null) {
    const cutoff = now - 3600000;
    const [rows] = await conn.execute(
        `SELECT id FROM player_lands
         WHERE building_state IN ('active', 'abandoned')
           AND last_condition_tick_at <= ?
         LIMIT 50`,
        [cutoff]
    );

    let checked = 0;
    for (const r of rows) {
        await syncLandCondition(conn, r.id, now, client);
        checked += 1;
    }
    return { checked };
}

module.exports = {
    ONE_DAY_MS,
    CONDITION_THRESHOLDS,
    getConditionMeta,
    aggregateCellMaterials,
    computeDailyDegradationRate,
    getHeavyRenovationRequirements,
    triggerBuildingCollapse,
    syncLandCondition,
    performLightMaintenance,
    performHeavyRenovation,
    clearCollapsedRubble,
    evacuateEmergencyStorage,
    runScheduledBuildingConditionChecks
};
