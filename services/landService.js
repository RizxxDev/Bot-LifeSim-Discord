const {
    getLandTier,
    getNextLandTier,
    getMaxLandLimit,
    getProgressivePbbMultiplier,
    getStructuralMaterial,
    getFloorMaterial,
    getWallEdgeType,
    getRoofVariant,
    getBuildingModule,
    getArchitectureTheme,
    validateCellPlacement,
    calculateStructuralStress,
    getBlockKind
} = require('../data/buildingModules');
const { getFurnitureSpec } = require('../data/furniture');
const { detectAllFloorRooms } = require('./roomDetectionService');
const {
    PARCEL_SIZE_TIERS,
    CITY_PARCEL_PREFIX,
    AUTO_EXPAND_OCCUPANCY_RATIO,
    MAX_DISTRICTS_PER_CITY,
    getParcelSizeTier,
    generateDistrictParcelSpecs
} = require('../data/landParcels');
const { getCity, getCityZoning } = require('../data/cities');
const { getPropertyTier } = require('../data/properties');
const { getLevelInfoFromXp } = require('../data/locations');
const { PAY_RULES } = require('../data/constants');
const { debitPlayerFunds, creditPlayerCash, logLedger } = require('./economyService');
const { getConditionMeta, CONDITION_THRESHOLDS } = require('./buildingConditionService');

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;
const PBB_RATE_MONTHLY = 0.002;
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 3600 * 1000;

const P2P_PROPERTY_RULES = {
    MIN_ACCOUNT_AGE_MS: PAY_RULES.MIN_ACCOUNT_AGE_MS || SEVEN_DAYS_MS,
    MIN_SHIFTS: PAY_RULES.MIN_SHIFTS || 20,
    MIN_TOTAL_SKILL_LEVEL: PAY_RULES.MIN_TOTAL_SKILL_LEVEL || 10,
    APPRAISAL_MIN_MULT: 0.70,
    APPRAISAL_MAX_MULT: 2.50,
    BPHTB_TAX_RATE: 0.05
};

function validateP2PTradeEligibility(player, totalSkillLevel, now = Date.now()) {
    if (!player) return { ok: false, reason: 'Akun pemain tidak ditemukan.' };
    const ageMs = now - Number(player.created_at || now);
    if (ageMs < P2P_PROPERTY_RULES.MIN_ACCOUNT_AGE_MS) {
        const remDays = Math.ceil((P2P_PROPERTY_RULES.MIN_ACCOUNT_AGE_MS - ageMs) / (24 * 3600 * 1000));
        return {
            ok: false,
            reason: `Syarat anti-alt: Umur akun minimal 7 hari (sisa ~${remDays} hari lagi).`
        };
    }
    if (Number(player.total_shifts || 0) < P2P_PROPERTY_RULES.MIN_SHIFTS) {
        return {
            ok: false,
            reason: `Syarat anti-alt: Minimal ${P2P_PROPERTY_RULES.MIN_SHIFTS} shift kerja selesai (kamu baru ${player.total_shifts || 0}).`
        };
    }
    if (Number(totalSkillLevel || 0) < P2P_PROPERTY_RULES.MIN_TOTAL_SKILL_LEVEL) {
        return {
            ok: false,
            reason: `Syarat anti-alt: Minimal Total Skill Level ${P2P_PROPERTY_RULES.MIN_TOTAL_SKILL_LEVEL} (saat ini Lv.${totalSkillLevel}).`
        };
    }
    return { ok: true };
}

function validateMarketPriceBounds(askingPrice, appraisalValue) {
    const njop = Math.max(1000000, Math.round(Number(appraisalValue || 0)));
    const price = Math.round(Number(askingPrice || 0));
    if (!Number.isFinite(price) || price <= 0) {
        return { ok: false, reason: 'Harga jual properti harus lebih besar dari 0 Lp.' };
    }
    const minAllowed = Math.floor(njop * P2P_PROPERTY_RULES.APPRAISAL_MIN_MULT);
    const maxAllowed = Math.ceil(njop * P2P_PROPERTY_RULES.APPRAISAL_MAX_MULT);
    if (price < minAllowed || price > maxAllowed) {
        return {
            ok: false,
            reason: `Harga di luar batas kewajaran NJOP (Lp ${njop.toLocaleString('id-ID')}). Rentang izin: **Lp ${minAllowed.toLocaleString('id-ID')}** – **Lp ${maxAllowed.toLocaleString('id-ID')}** (0.7×–2.5×).`
        };
    }
    return { ok: true, price, minAllowed, maxAllowed, njop };
}

function getTotalSkillLevelFromPlayerRow(player) {
    if (!player) return 5;
    const xps = [
        player.fishing_xp,
        player.mining_xp,
        player.farming_xp,
        player.cooking_xp,
        player.gathering_xp
    ];
    return xps.reduce((sum, xp) => sum + getLevelInfoFromXp(Number(xp || 0)).level, 0);
}

async function getPlayerTotalSkillLevel(conn, discordId) {
    const [rows] = await conn.execute(
        `SELECT fishing_xp, mining_xp, farming_xp, cooking_xp, gathering_xp FROM players WHERE discord_id = ? LIMIT 1`,
        [discordId]
    );
    return rows.length > 0 ? getTotalSkillLevelFromPlayerRow(rows[0]) : 5;
}

function calculateLandPurchasePrice(landTierId, cityId) {
    const tier = getLandTier(landTierId);
    const zoning = getCityZoning(cityId);
    return Math.round(Number(zoning.landBasePrice || 15000000) * tier.priceMult + tier.permitFee);
}

function calculateLandExpandPrice(currentTierId, cityId) {
    const cur = getLandTier(currentTierId);
    const next = getNextLandTier(currentTierId);
    if (!next) return null;
    const zoning = getCityZoning(cityId);
    const diffMult = Math.max(0.5, next.priceMult - cur.priceMult);
    return Math.round((diffMult * Number(zoning.landBasePrice || 15000000) * (zoning.expandCostMult || 1)) + next.permitFee);
}

function normalizeCellRecord(raw) {
    const modId = String(raw.module_id || raw.mod || 'hall_custom');
    const mod = getBuildingModule(modId);
    return {
        floor_level: Number(raw.floor_level ?? raw.floor ?? 1),
        x: Number(raw.x),
        y: Number(raw.y),
        zone_group_id: String(raw.zone_group_id || raw.zg || `z-${raw.floor_level ?? 1}-${raw.x}-${raw.y}`),
        zone_name: String(raw.zone_name || raw.zn || mod.name || 'Ruangan'),
        module_id: mod.id,
        material_id: String(raw.material_id || raw.mat || 'kayu'),
        block_kind: String(raw.block_kind || mod.blockKind || getBlockKind(mod.id) || 'module'),
        shape_variant: raw.shape_variant || mod.shapeVariant || null,
        color_hex: raw.color_hex || raw.col || null,
        meta_json: raw.meta_json || null
    };
}

/**
 * Menghitung Skor Arsitektur (0..100) dari variasi blok/bentuk, ketinggian/siluet berjenjang,
 * detail fasad (atap, kaca, pilar, balkon, taman), serta integritas struktur.
 */
function computeArchitectureScore(rawCells = [], land = null, precomputedStress = null) {
    const cells = (rawCells || []).map(normalizeCellRecord);
    if (cells.length === 0) {
        return {
            architectureScore: 0,
            architectureGrade: 'C',
            appealMultiplier: 1.0,
            breakdown: { variety: 0, silhouette: 0, details: 0, integrity: 0 }
        };
    }

    const moduleSet = new Set();
    const shapeSet = new Set();
    const floorFootprints = new Map();
    const floorSet = new Set();
    let roofCount = 0;
    let archBonusSum = 0;

    for (const c of cells) {
        const mod = getBuildingModule(c.module_id);
        const kind = c.block_kind || mod.blockKind || 'module';
        moduleSet.add(mod.id);
        if (kind === 'shape' || kind === 'roof') shapeSet.add(mod.id);
        if (kind === 'roof' || mod.id === 'rooftop_lounge') roofCount += 1;
        floorSet.add(c.floor_level);

        if (!floorFootprints.has(c.floor_level)) floorFootprints.set(c.floor_level, new Set());
        floorFootprints.get(c.floor_level).add(`${c.x}:${c.y}`);

        archBonusSum += Number(mod.stats?.architectureBonus || 0);
    }

    const stress = precomputedStress || calculateStructuralStress(cells);

    // 1. Variasi Material & Blok (0..25)
    const varietyPts = Math.min(15, moduleSet.size * 2.5) + Math.min(10, shapeSet.size * 2.5);

    // 2. Vertikalitas & Siluet Berjenjang (0..25)
    const uniqueSilhouettes = new Set([...floorFootprints.values()].map(s => [...s].sort().join(',')));
    const floorPts = Math.min(10, floorSet.size * 2.2);
    const tierPts = uniqueSilhouettes.size > 1 ? Math.min(8, (uniqueSilhouettes.size - 1) * 3.5) : 0;
    const roofRatio = roofCount / cells.length;
    const roofPts = roofCount > 0 ? Math.min(7, Math.round(roofRatio * 18) + 2) : 0;
    const silhouettePts = Math.min(25, floorPts + tierPts + roofPts);

    // 3. Detail Fasad & Eksterior (0..25)
    const detailsPts = Math.min(25, Math.round(archBonusSum * 0.65));

    // 4. Kesesuaian Tema & Integritas Struktur (0..25)
    const sizeFactor = Math.min(1, cells.length / 8);
    const hasCustomDesc = land?.description && !String(land.description).startsWith('Properti pribadi di ');
    const themePts = Math.round((hasCustomDesc ? 6 : 3) * sizeFactor);
    const integrityRaw = 19 * sizeFactor * Math.max(0.2, 1 - (Number(stress?.stressRatio || 0) * 0.4));
    const integrityPts = Math.min(25, themePts + Math.round(integrityRaw));

    const total = Math.max(1, Math.min(100, Math.round(varietyPts + silhouettePts + detailsPts + integrityPts)));
    let grade = 'C';
    if (total >= 90) grade = 'S+';
    else if (total >= 75) grade = 'S';
    else if (total >= 60) grade = 'A';
    else if (total >= 40) grade = 'B';

    const appealMultiplier = Math.round((1 + Math.min(0.45, total * 0.0045)) * 100) / 100;

    return {
        architectureScore: total,
        architectureGrade: grade,
        appealMultiplier,
        breakdown: {
            variety: Math.round(varietyPts),
            silhouette: Math.round(silhouettePts),
            details: Math.round(detailsPts),
            integrity: Math.round(integrityPts)
        }
    };
}

/**
 * Mengagregasi seluruh fasilitas, kenyamanan, kapasitas penyimpanan,
 * modul usaha/workshop, skor arsitektur, stres struktur, serta NJOP appraisal dari susunan petak bangunan.
 */
function computeLandStats(rawCells = [], land = null, cityZoning = null, archData = null) {
    const cells = (rawCells || []).map(normalizeCellRecord);
    const arch = archData || rawCells?._archData || land?._archData || null;
    const floorCells = arch?.floorCells || [];
    const wallEdges = arch?.wallEdges || [];
    const furnitureList = (arch?.furniture || []).filter(f => !f.is_locked_rubble);
    const roomNamesByFloor = arch?.roomNamesByFloor || {};

    // Gabungkan sel grid lama yang belum ada di floorCells agar deteksi ruangan & stres bekerja terpadu
    const floorKeySet = new Set(floorCells.map(fc => `${Number(fc.floor_level ?? 1)}:${Number(fc.x)}:${Number(fc.y)}`));
    const mergedFloorCells = [...floorCells];
    for (const c of cells) {
        const k = `${c.floor_level}:${c.x}:${c.y}`;
        if (!floorKeySet.has(k)) {
            mergedFloorCells.push({
                floor_level: c.floor_level,
                x: c.x,
                y: c.y,
                floor_material_id: c.material_id,
                roof_variant: c.block_kind === 'roof' ? (c.shape_variant || 'gable') : 'flat',
                is_pillar: c.block_kind === 'shape' && c.shape_variant === 'pillar' ? 1 : 0
            });
        }
    }

    const zoning = cityZoning || (land ? getCityZoning(land.city_id) : getCityZoning('kota_sentral'));
    const condPct = Math.max(0, Math.min(100, Number(land?.condition_pct ?? 100)));
    const hasAnyStructure = cells.length > 0 || floorCells.length > 0 || wallEdges.length > 0 || furnitureList.length > 0;
    const conditionMeta = getConditionMeta(condPct, land?.building_state || (hasAnyStructure ? 'active' : 'empty'), hasAnyStructure);

    // Hitung stres struktur gabungan sel grid + floor cells tambahan
    const gridKeySet = new Set(cells.map(c => `${c.floor_level}:${c.x}:${c.y}`));
    const extraFloorCells = floorCells.filter(fc => !gridKeySet.has(`${Number(fc.floor_level ?? 1)}:${Number(fc.x)}:${Number(fc.y)}`));
    const stressInput = [
        ...cells,
        ...extraFloorCells.map(fc => ({
            floor_level: Number(fc.floor_level ?? 1),
            material_id: fc.floor_material_id || 'kayu'
        }))
    ];
    const structuralStress = calculateStructuralStress(stressInput);

    if (!hasAnyStructure) {
        const landValue = Number(land?.purchase_price || 0);
        return {
            totalCells: 0,
            totalZones: 0,
            zones: [],
            detectedRooms: [],
            furnitureDetails: [],
            furnitureCount: 0,
            wallEdgeCount: 0,
            floorCellCount: 0,
            floorsUsed: [],
            maxFloor: 0,
            hasBasement: false,
            hasRooftop: false,
            hasBedroom: false,
            hasLuxBedroom: false,
            sleepEnergyBonus: 50,
            sleepDurationSec: 3600,
            passiveEnergyRegenBonus: 0,
            cookingSlots: 0,
            storageLimits: { kulkas: 0, freezer: 0, gudang: 0 },
            garageSlots: 0,
            fuelDiscountPct: 0,
            farmYieldBonusPct: 0,
            comfortScore: 0,
            prestigeScore: 0,
            appealScore: 0,
            architectureScore: 0,
            architectureGrade: 'C',
            appealMultiplier: 1.0,
            structuralStress,
            conditionMeta,
            businessZones: [],
            rentalRoomZones: [],
            workshopStations: [],
            buildingMaterialAppraisal: 0,
            totalAppraisalValue: landValue,
            monthlyPbbBase: Math.round(landValue * PBB_RATE_MONTHLY),
            weeklyMaintenanceCost: 0,
            validationIssues: []
        };
    }

    const roomDetection = detectAllFloorRooms({
        width: Number(land?.width || 4),
        height: Number(land?.height || 4),
        floorCells: mergedFloorCells,
        wallEdges,
        roomNamesByFloor
    });

    const zoneMap = new Map();
    const floorSet = new Set();
    const workshopSet = new Set();
    const validationIssues = [];

    let kulkasSlots = 0;
    let freezerSlots = 0;
    let gudangRawSlots = 0;
    let garageSlots = 0;
    let fuelDiscountPct = 0;
    let farmYieldBonusPct = 0;
    let buildingMaterialAppraisal = 0;
    let weeklyMaintenanceCost = 0;
    let hasLuxBedroom = false;
    let hasStdBedroom = false;
    let hasRoofBlock = false;

    for (const c of cells) {
        const mod = getBuildingModule(c.module_id);
        const mat = getStructuralMaterial(c.material_id);
        const check = validateCellPlacement(mat.id, c.floor_level, mod.id);
        if (!check.ok) {
            const coord = `${String.fromCharCode(65 + c.x)}${c.y + 1}`;
            validationIssues.push(`Lt.${c.floor_level} ${coord}: ${check.error}`);
        }

        floorSet.add(c.floor_level);
        if (getBlockKind(mod.id) === 'roof' || mod.id === 'rooftop_lounge') {
            hasRoofBlock = true;
        }
        const matMult = Number(mod.materialCostMult || 1);
        buildingMaterialAppraisal += Math.round(Number(mat.appraisalValuePerCell || 0) * matMult) + Number(mod.appraisalPerCell || 0);
        weeklyMaintenanceCost += Math.round((Number(mat.maintenanceCost || 0) * matMult) / 2);

        const st = mod.stats || {};
        if (st.kulkasPerCell) kulkasSlots += st.kulkasPerCell;
        if (st.freezerPerCell) freezerSlots += st.freezerPerCell;
        if (st.gudangPerCell) gudangRawSlots += st.gudangPerCell;
        if (st.garageSlotsPerCell) garageSlots += st.garageSlotsPerCell;
        if (st.fuelDiscountPct) fuelDiscountPct += st.fuelDiscountPct;
        if (st.farmYieldBonusPct) farmYieldBonusPct += st.farmYieldBonusPct;

        if (mod.id === 'bedroom_lux') hasLuxBedroom = true;
        if (mod.id === 'bedroom_std') hasStdBedroom = true;

        if (Array.isArray(st.workshopStations)) {
            for (const ws of st.workshopStations) workshopSet.add(ws);
        }

        if (!zoneMap.has(c.zone_group_id)) {
            zoneMap.set(c.zone_group_id, {
                zoneGroupId: c.zone_group_id,
                zoneName: c.zone_name,
                moduleId: mod.id,
                module: mod,
                materialId: mat.id,
                material: mat,
                floorLevel: c.floor_level,
                cellCount: 0,
                coords: []
            });
        }
        const z = zoneMap.get(c.zone_group_id);
        z.cellCount += 1;
        z.coords.push(`${String.fromCharCode(65 + c.x)}${c.y + 1}`);
    }

    // Lapisan 4-Layer: Lantai & Atap non-legacy + Garis Dinding
    for (const fc of floorCells) {
        const fl = Number(fc.floor_level ?? 1);
        floorSet.add(fl);
        if (fc.roof_variant && fc.roof_variant !== 'none') {
            hasRoofBlock = true;
        }
        const isAlreadyCounted = gridKeySet.has(`${fl}:${Number(fc.x)}:${Number(fc.y)}`);
        if (!isAlreadyCounted) {
            const fMat = getFloorMaterial(fc.floor_material_id || 'kayu');
            const rVar = getRoofVariant(fc.roof_variant || 'none');
            buildingMaterialAppraisal += Number(fMat.appraisalValuePerCell || 0) + Number(rVar.appraisalPerCell || 0);
            weeklyMaintenanceCost += Math.round(Number(fMat.dailyWearRate || 1.5) * 4500);
        }
    }

    let windowComfortBonus = 0;
    for (const we of wallEdges) {
        const fl = Number(we.floor_level ?? 1);
        floorSet.add(fl);
        const wSpec = getWallEdgeType(we.edge_type);
        buildingMaterialAppraisal += Number(wSpec.appraisalPerEdge || 120000);
        weeklyMaintenanceCost += 2500;
        windowComfortBonus += Number(wSpec.comfortBonus || 0);
    }

    let cookingSlots = 0;
    let comfortScore = Math.min(25, cells.length + extraFloorCells.length) + Math.min(18, Math.round(windowComfortBonus * 0.5));
    let prestigeScore = 0;
    let passiveRegen = 0;
    let rawAppeal = 0;

    const businessZones = [];
    const rentalRoomZones = [];

    for (const z of zoneMap.values()) {
        const st = z.module.stats || {};
        const mat = z.material;

        if (st.stovePerZone) cookingSlots += st.stovePerZone;
        if (st.comfort) comfortScore += st.comfort;
        if (st.prestige) prestigeScore += st.prestige;
        if (st.passiveRegenPerZone) passiveRegen += st.passiveRegenPerZone;
        if (st.appeal) rawAppeal += st.appeal;

        comfortScore += Math.round((mat.comfortBonus || 0) * 0.5);
        prestigeScore += Math.round((mat.prestigeBonus || 0) * 0.5);

        if (st.businessType) {
            businessZones.push(z);
        }
        if (z.moduleId === 'rental_room') {
            rentalRoomZones.push(z);
        }
    }

    // Integrasi Perabotan Nyata (Layer 4) dengan pengecekan Ruangan Tertutup & Atap
    let bestFurnSleepBonus = 0;
    let bestFurnSleepDur = 3600;
    const furnitureDetails = [];
    const roomFurnitureItems = new Map();

    for (const f of furnitureList) {
        const spec = getFurnitureSpec(f.item_id);
        if (!spec) continue;
        const fl = Number(f.floor_level ?? 1);
        floorSet.add(fl);
        const floorRes = roomDetection.byFloor.get(fl);
        const room = floorRes ? floorRes.cellToRoom.get(`${Number(f.anchor_x)}:${Number(f.anchor_y)}`) || null : null;

        let effectivenessMult = 1.0;
        let isOutdoorPenalty = false;
        if (spec.environment === 'indoor' && (!room || !room.isEnclosed || !room.hasRoof)) {
            effectivenessMult = 0.5;
            isOutdoorPenalty = true;
        }

        const fx = spec.effects || {};
        if (fx.kulkasSlots) kulkasSlots += Math.round(Number(fx.kulkasSlots) * effectivenessMult);
        if (fx.freezerSlots) freezerSlots += Math.round(Number(fx.freezerSlots) * effectivenessMult);
        if (fx.gudangSlots) gudangRawSlots += Math.round(Number(fx.gudangSlots) * effectivenessMult);
        if (fx.garageSlots) garageSlots += Number(fx.garageSlots);
        if (fx.fuelDiscountPct) fuelDiscountPct += Number(fx.fuelDiscountPct);
        if (fx.farmYieldBonusPct) farmYieldBonusPct += Number(fx.farmYieldBonusPct);
        if (fx.stoveSlots) {
            const addStove = effectivenessMult < 1
                ? Math.floor(Number(fx.stoveSlots) * effectivenessMult)
                : Number(fx.stoveSlots);
            cookingSlots += addStove;
        }
        if (fx.comfort) comfortScore += Math.round(Number(fx.comfort) * effectivenessMult);
        if (fx.prestige) prestigeScore += Math.round(Number(fx.prestige) * effectivenessMult);
        if (fx.appeal) rawAppeal += Math.round(Number(fx.appeal) * effectivenessMult);
        if (fx.passiveRegen) passiveRegen += Number(fx.passiveRegen) * effectivenessMult;
        if (fx.workshopStation) workshopSet.add(fx.workshopStation);

        if (fx.sleepEnergyBonus) {
            const effSleep = Math.round(Number(fx.sleepEnergyBonus) * effectivenessMult);
            if (effSleep >= bestFurnSleepBonus) {
                bestFurnSleepBonus = effSleep;
                bestFurnSleepDur = Number(fx.sleepDurationSec || 3600);
            }
            if (spec.id === 'ranjang_king') hasLuxBedroom = true;
            else hasStdBedroom = true;
        }

        if (fx.businessType) {
            const zgId = room ? room.roomKey : `furn-${f.id}`;
            if (!businessZones.some(bz => bz.zoneGroupId === zgId)) {
                businessZones.push({
                    zoneGroupId: zgId,
                    zoneName: room ? room.customName : spec.name,
                    moduleId: spec.id,
                    module: {
                        id: spec.id,
                        name: spec.name,
                        emoji: spec.emoji,
                        stats: { businessType: fx.businessType, businessSlots: fx.businessSlots || 10 }
                    },
                    floorLevel: fl,
                    cellCount: room ? room.cellCount : (Number(f.width_cells || 1) * Number(f.height_cells || 1)),
                    effectivenessMult
                });
            }
        }

        if (room) {
            if (!roomFurnitureItems.has(room.roomKey)) roomFurnitureItems.set(room.roomKey, []);
            roomFurnitureItems.get(room.roomKey).push(spec);
        }

        buildingMaterialAppraisal += Number(spec.appraisalValue || 0);
        furnitureDetails.push({
            ...f,
            spec,
            room,
            effectivenessMult,
            isOutdoorPenalty
        });
    }

    // Deteksi Kamar Kos P2P emergent (Ruangan tertutup beratap berisi Ranjang + Meja Tamu/Belajar)
    for (const r of roomDetection.allRooms) {
        if (!r.isEnclosed || !r.hasRoof) continue;
        const specsInRoom = roomFurnitureItems.get(r.roomKey) || [];
        const hasBed = specsInRoom.some(s => s.category === 'rest' && s.id !== 'sofa_santai');
        const hasDesk = specsInRoom.some(s => s.id === 'meja_tamu_resto' || (s.effects && s.effects.rentalCapable));
        if (hasBed && hasDesk && !rentalRoomZones.some(rz => rz.zoneGroupId === r.roomKey)) {
            rentalRoomZones.push({
                zoneGroupId: r.roomKey,
                zoneName: r.customName,
                moduleId: 'rental_room',
                floorLevel: r.floorLevel,
                cellCount: r.cellCount
            });
        }
    }

    cookingSlots = Math.min(8, cookingSlots);
    passiveRegen = Math.min(6, Math.round(passiveRegen * 10) / 10);
    fuelDiscountPct = Math.min(30, fuelDiscountPct);
    farmYieldBonusPct = Math.min(35, farmYieldBonusPct);

    const gudangWithZoning = Math.round(gudangRawSlots * Number(zoning.warehouseBonus || 1));

    let sleepEnergyBonus = 55;
    let sleepDurationSec = 3600;
    if (bestFurnSleepBonus > 0) {
        sleepEnergyBonus = bestFurnSleepBonus;
        sleepDurationSec = bestFurnSleepDur;
    } else if (hasLuxBedroom) {
        sleepEnergyBonus = comfortScore >= 25 ? 100 : 95;
        sleepDurationSec = comfortScore >= 35 ? 2100 : 2700;
    } else if (hasStdBedroom) {
        sleepEnergyBonus = comfortScore >= 15 ? 80 : 70;
        sleepDurationSec = 3300;
    }

    const floorsUsed = [...floorSet].sort((a, b) => a - b);
    const maxFloor = floorsUsed.length > 0 ? Math.max(...floorsUsed) : 1;
    const archEvalInput = cells.length > 0
        ? cells
        : mergedFloorCells.map(fc => ({
            floor_level: Number(fc.floor_level ?? 1),
            x: Number(fc.x),
            y: Number(fc.y),
            material_id: fc.floor_material_id || 'kayu',
            module_id: (fc.roof_variant && fc.roof_variant !== 'none') ? 'roof_gable' : 'hall_custom',
            block_kind: (fc.roof_variant && fc.roof_variant !== 'none') ? 'roof' : 'module'
        }));
    const archEval = computeArchitectureScore(archEvalInput, land, structuralStress);
    const edgeBonusScore = Math.min(12, Math.floor(wallEdges.length / 3) + Math.min(5, roomDetection.allRooms.filter(r => r.isEnclosed).length * 2));
    const adjustedArchScore = Math.min(100, archEval.architectureScore + edgeBonusScore);
    const appealScore = Math.round((rawAppeal + comfortScore * 0.35 + prestigeScore * 0.25) * archEval.appealMultiplier);

    const landPrice = Number(land?.purchase_price || 0);
    const totalAppraisalValue = landPrice + buildingMaterialAppraisal;

    return {
        totalCells: cells.length + extraFloorCells.length,
        totalZones: zoneMap.size || roomDetection.allRooms.length,
        zones: [...zoneMap.values()],
        detectedRooms: roomDetection.allRooms,
        furnitureDetails,
        furnitureCount: furnitureList.length,
        wallEdgeCount: wallEdges.length,
        floorCellCount: mergedFloorCells.length,
        floorsUsed,
        maxFloor,
        hasBasement: floorSet.has(-1),
        hasRooftop: hasRoofBlock || floorSet.has(6),
        hasBedroom: hasLuxBedroom || hasStdBedroom || bestFurnSleepBonus > 0,
        hasLuxBedroom,
        sleepEnergyBonus,
        sleepDurationSec,
        passiveEnergyRegenBonus: passiveRegen,
        cookingSlots,
        storageLimits: {
            kulkas: kulkasSlots,
            freezer: freezerSlots,
            gudang: gudangWithZoning
        },
        garageSlots,
        fuelDiscountPct,
        farmYieldBonusPct,
        comfortScore,
        prestigeScore,
        appealScore,
        architectureScore: adjustedArchScore,
        architectureGrade: adjustedArchScore >= 90 ? 'S+' : adjustedArchScore >= 75 ? 'S' : adjustedArchScore >= 60 ? 'A' : adjustedArchScore >= 40 ? 'B' : 'C',
        appealMultiplier: archEval.appealMultiplier,
        architectureBreakdown: archEval.breakdown,
        structuralStress,
        conditionMeta,
        businessZones,
        rentalRoomZones,
        workshopStations: [...workshopSet],
        buildingMaterialAppraisal,
        totalAppraisalValue,
        monthlyPbbBase: Math.round(totalAppraisalValue * PBB_RATE_MONTHLY),
        weeklyMaintenanceCost,
        validationIssues
    };
}

async function getPlayerLands(conn, discordId, cityId = null, forUpdate = false) {
    const lock = forUpdate ? ' FOR UPDATE' : '';
    const params = [discordId];
    let sql = `SELECT * FROM player_lands WHERE discord_id = ?`;
    if (cityId) {
        sql += ` AND city_id = ?`;
        params.push(cityId);
    }
    sql += ` ORDER BY is_primary DESC, acquired_at ASC${lock}`;
    const [rows] = await conn.execute(sql, params);
    return rows;
}

async function getLandById(conn, landId, forUpdate = false) {
    const lock = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await conn.execute(
        `SELECT * FROM player_lands WHERE id = ? LIMIT 1${lock}`,
        [landId]
    );
    return rows[0] || null;
}

async function getLandFloorCells(conn, landId, layoutState = 'active', floorLevel = null) {
    const params = [landId, layoutState];
    let sql = `SELECT * FROM land_floor_cells WHERE land_id = ? AND layout_state = ?`;
    if (floorLevel !== null && floorLevel !== undefined) {
        sql += ` AND floor_level = ?`;
        params.push(Number(floorLevel));
    }
    sql += ` ORDER BY floor_level ASC, y ASC, x ASC`;
    const [rows] = await conn.execute(sql, params);
    return rows;
}

async function getLandWallEdges(conn, landId, layoutState = 'active', floorLevel = null) {
    const params = [landId, layoutState];
    let sql = `SELECT * FROM land_wall_edges WHERE land_id = ? AND layout_state = ?`;
    if (floorLevel !== null && floorLevel !== undefined) {
        sql += ` AND floor_level = ?`;
        params.push(Number(floorLevel));
    }
    sql += ` ORDER BY floor_level ASC, orientation ASC, gy ASC, gx ASC`;
    const [rows] = await conn.execute(sql, params);
    return rows;
}

async function getLandRoomsMap(conn, landId) {
    const [rows] = await conn.execute(
        `SELECT * FROM land_rooms WHERE land_id = ? ORDER BY floor_level ASC, id ASC`,
        [landId]
    );
    const roomNamesByFloor = {};
    for (const r of rows) {
        const fl = Number(r.floor_level || 1);
        if (!roomNamesByFloor[fl]) roomNamesByFloor[fl] = {};
        roomNamesByFloor[fl][r.room_key] = r.custom_name;
    }
    return { rows, roomNamesByFloor };
}

async function getFullLandArchitecture(conn, landId, layoutState = 'active') {
    const floorCells = await getLandFloorCells(conn, landId, layoutState);
    const wallEdges = await getLandWallEdges(conn, landId, layoutState);
    const { rows: roomRows, roomNamesByFloor } = await getLandRoomsMap(conn, landId);
    const [furniture] = await conn.execute(
        `SELECT * FROM land_furniture_items WHERE land_id = ? AND is_locked_rubble = 0 ORDER BY floor_level ASC, id ASC`,
        [landId]
    );
    return {
        floorCells,
        wallEdges,
        roomRows,
        roomNamesByFloor,
        furniture
    };
}

async function getLandCells(conn, landId, layoutState = 'active', floorLevel = null) {
    const params = [landId, layoutState];
    let sql = `SELECT * FROM land_grid_cells WHERE land_id = ? AND layout_state = ?`;
    if (floorLevel !== null && floorLevel !== undefined) {
        sql += ` AND floor_level = ?`;
        params.push(Number(floorLevel));
    }
    sql += ` ORDER BY floor_level ASC, y ASC, x ASC`;
    const [rows] = await conn.execute(sql, params);
    if (floorLevel === null || floorLevel === undefined) {
        const archData = await getFullLandArchitecture(conn, landId, layoutState);
        Object.defineProperty(rows, '_archData', {
            value: archData,
            enumerable: false,
            configurable: true
        });
    }
    return rows;
}

async function ensureDraftInitialized(conn, landId) {
    const [draftGridCnt] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM land_grid_cells WHERE land_id = ? AND layout_state = 'draft'`,
        [landId]
    );
    if (Number(draftGridCnt[0]?.cnt || 0) === 0) {
        const [activeRows] = await conn.execute(
            `SELECT * FROM land_grid_cells WHERE land_id = ? AND layout_state = 'active'`,
            [landId]
        );
        for (const raw of activeRows) {
            const c = normalizeCellRecord(raw);
            await conn.execute(
                `INSERT IGNORE INTO land_grid_cells
                 (land_id, layout_state, floor_level, x, y, zone_group_id, zone_name, module_id, material_id, block_kind, shape_variant, color_hex, meta_json)
                 VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [landId, c.floor_level, c.x, c.y, c.zone_group_id, c.zone_name, c.module_id, c.material_id, c.block_kind, c.shape_variant, c.color_hex, c.meta_json]
            );
        }
    }

    const [draftFloorCnt] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM land_floor_cells WHERE land_id = ? AND layout_state = 'draft'`,
        [landId]
    );
    if (Number(draftFloorCnt[0]?.cnt || 0) === 0) {
        await conn.execute(
            `INSERT IGNORE INTO land_floor_cells
             (land_id, layout_state, floor_level, x, y, floor_material_id, roof_variant, color_hex, is_pillar)
             SELECT land_id, 'draft', floor_level, x, y, floor_material_id, roof_variant, color_hex, is_pillar
             FROM land_floor_cells
             WHERE land_id = ? AND layout_state = 'active'`,
            [landId]
        );
        // Jika lantai lama ada di land_grid_cells tetapi belum ada di land_floor_cells draft, sinkronkan
        await conn.execute(
            `INSERT IGNORE INTO land_floor_cells
             (land_id, layout_state, floor_level, x, y, floor_material_id, roof_variant, color_hex, is_pillar)
             SELECT land_id, 'draft', floor_level, x, y, COALESCE(material_id, 'kayu'),
                    CASE WHEN block_kind = 'roof' THEN COALESCE(shape_variant, 'gable') ELSE NULL END,
                    color_hex,
                    CASE WHEN block_kind = 'shape' AND shape_variant = 'pillar' THEN 1 ELSE 0 END
             FROM land_grid_cells
             WHERE land_id = ? AND layout_state = 'draft'`,
            [landId]
        );
    }

    const [draftWallCnt] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM land_wall_edges WHERE land_id = ? AND layout_state = 'draft'`,
        [landId]
    );
    if (Number(draftWallCnt[0]?.cnt || 0) === 0) {
        await conn.execute(
            `INSERT IGNORE INTO land_wall_edges
             (land_id, layout_state, floor_level, orientation, gx, gy, edge_type, material_id, color_hex)
             SELECT land_id, 'draft', floor_level, orientation, gx, gy, edge_type, material_id, color_hex
             FROM land_wall_edges
             WHERE land_id = ? AND layout_state = 'active'`,
            [landId]
        );
    }
}

function inferCityIdFromParcelCode(parcelCode) {
    const code = String(parcelCode || '').trim().toUpperCase();
    for (const [cityId, prefix] of Object.entries(CITY_PARCEL_PREFIX)) {
        if (code.startsWith(`${prefix}-`)) return cityId;
    }
    return null;
}

async function checkAndAutoExpandDistrict(conn, cityId, now = Date.now()) {
    const [rows] = await conn.execute(
        `SELECT district_no, status FROM city_land_parcels WHERE city_id = ?`,
        [cityId]
    );
    if (rows.length === 0) return { expanded: false };

    let maxDistrict = 1;
    let occupied = 0;
    for (const r of rows) {
        maxDistrict = Math.max(maxDistrict, Number(r.district_no || 1));
        if (r.status === 'owned') occupied += 1;
    }

    const ratio = occupied / rows.length;
    if (ratio >= AUTO_EXPAND_OCCUPANCY_RATIO && maxDistrict < MAX_DISTRICTS_PER_CITY) {
        const nextDistrict = maxDistrict + 1;
        const specs = generateDistrictParcelSpecs(cityId, nextDistrict);
        for (const sp of specs) {
            await conn.execute(
                `INSERT IGNORE INTO city_land_parcels
                 (parcel_code, city_id, district_no, lot_no, size_tier, width, height, base_price, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)`,
                [sp.parcel_code, sp.city_id, sp.district_no, sp.lot_no, sp.size_tier, sp.width, sp.height, sp.base_price, now]
            );
        }
        return { expanded: true, newDistrict: nextDistrict, addedCount: specs.length };
    }
    return { expanded: false, occupancyRatio: ratio, maxDistrict };
}

async function ensureCityParcelsSeeded(conn, cityId, now = Date.now()) {
    const targetCity = getCity(cityId).id;
    const [cntRows] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM city_land_parcels WHERE city_id = ?`,
        [targetCity]
    );
    if (Number(cntRows[0]?.cnt || 0) === 0) {
        const specs = generateDistrictParcelSpecs(targetCity, 1);
        for (const sp of specs) {
            await conn.execute(
                `INSERT IGNORE INTO city_land_parcels
                 (parcel_code, city_id, district_no, lot_no, size_tier, width, height, base_price, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)`,
                [sp.parcel_code, sp.city_id, sp.district_no, sp.lot_no, sp.size_tier, sp.width, sp.height, sp.base_price, now]
            );
        }
    }
    await checkAndAutoExpandDistrict(conn, targetCity, now);
}

async function listCityParcels(conn, cityId, statusFilter = null, now = Date.now()) {
    const targetCity = getCity(cityId).id;
    await ensureCityParcelsSeeded(conn, targetCity, now);

    const params = [targetCity];
    let sql = `
        SELECT p.*,
               pl.custom_name, pl.building_state, pl.condition_pct, pl.like_count, pl.theme_id,
               u.username AS owner_username
        FROM city_land_parcels p
        LEFT JOIN player_lands pl ON p.land_id = pl.id
        LEFT JOIN players u ON p.owner_id = u.discord_id
        WHERE p.city_id = ?
    `;
    if (statusFilter && ['available', 'owned', 'foreclosed'].includes(statusFilter)) {
        sql += ` AND p.status = ?`;
        params.push(statusFilter);
    }
    sql += ` ORDER BY p.district_no ASC, p.lot_no ASC`;

    const [rows] = await conn.execute(sql, params);
    return rows;
}

async function buyLand(conn, discordId, opts = {}, now = Date.now()) {
    const {
        cityId = 'kota_sentral',
        landTierId = 'small_4x4',
        parcelCode = null,
        customName = null,
        themeId = 'minimalis',
        initialCells = null,
        skipDebit = false,
        customPurchasePrice = null
    } = opts;

    const [pRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? LIMIT 1 FOR UPDATE`, [discordId]);
    if (pRows.length === 0) return { ok: false, error: 'Akun tidak ditemukan.' };
    const player = pRows[0];

    const existingLands = await getPlayerLands(conn, discordId, null, true);
    const totalSkillLv = getTotalSkillLevelFromPlayerRow(player);
    const maxLimit = getMaxLandLimit(totalSkillLv);
    if (existingLands.length >= maxLimit) {
        return {
            ok: false,
            error: `Batas kepemilikan kavlingmu saat ini **${maxLimit} kavling** (Total Skill Lv.${totalSkillLv}). Naikkan skill (tiap +25 Lv memberi +1 slot, maks 6) atau jual kavling lama di Pasar P2P.`
        };
    }

    const inferredCity = parcelCode ? inferCityIdFromParcelCode(parcelCode) : null;
    const city = getCity(inferredCity || cityId);
    await ensureCityParcelsSeeded(conn, city.id, now);

    let claimedParcel = null;
    if (parcelCode) {
        const cleanCode = String(parcelCode).trim().toUpperCase();
        const [parcelRows] = await conn.execute(
            `SELECT * FROM city_land_parcels WHERE parcel_code = ? LIMIT 1 FOR UPDATE`,
            [cleanCode]
        );
        if (parcelRows.length === 0) {
            return { ok: false, error: `Kode kavling **${cleanCode}** tidak ditemukan di peta kota.` };
        }
        claimedParcel = parcelRows[0];
        if (!['available', 'foreclosed'].includes(claimedParcel.status) || claimedParcel.owner_id) {
            return { ok: false, error: `Kavling **${cleanCode}** sudah dimiliki warga lain.` };
        }
    } else {
        const sizeSpec = getParcelSizeTier(landTierId);
        const [matchingRows] = await conn.execute(
            `SELECT * FROM city_land_parcels
             WHERE city_id = ? AND size_tier = ? AND status = 'available' AND owner_id IS NULL
             ORDER BY district_no ASC, lot_no ASC LIMIT 1 FOR UPDATE`,
            [city.id, sizeSpec.code]
        );
        if (matchingRows.length > 0) {
            claimedParcel = matchingRows[0];
        } else {
            const [anyRows] = await conn.execute(
                `SELECT * FROM city_land_parcels
                 WHERE city_id = ? AND width >= ? AND height >= ? AND status = 'available' AND owner_id IS NULL
                 ORDER BY district_no ASC, lot_no ASC LIMIT 1 FOR UPDATE`,
                [city.id, sizeSpec.width, sizeSpec.height]
            );
            if (anyRows.length > 0) {
                claimedParcel = anyRows[0];
            } else {
                return {
                    ok: false,
                    error: `Semua kavling **${sizeSpec.label}** di **${city.name}** saat ini telah terjual habis! Beli di Pasar P2P (\`/tanah\`) atau tunggu pembukaan distrik baru.`
                };
            }
        }
    }

    const resolvedSize = getParcelSizeTier(claimedParcel.size_tier);
    const resolvedTierId = resolvedSize.legacyId || resolvedSize.tierId;
    const tier = getLandTier(resolvedTierId);
    let price = Number(claimedParcel.base_price || 0);
    if (claimedParcel.status === 'foreclosed' && Number(claimedParcel.foreclosed_price || 0) > 0) {
        price = Number(claimedParcel.foreclosed_price);
    }
    if (customPurchasePrice !== null) {
        price = Number(customPurchasePrice);
    }

    if (!skipDebit) {
        try {
            await debitPlayerFunds(conn, player, price, 'land_purchase', { cityId: city.id, landTierId: tier.id, parcelCode: claimedParcel.parcel_code }, now);
        } catch (err) {
            if (err.message === 'INSUFFICIENT_FUNDS') {
                return { ok: false, error: `Saldo tidak cukup untuk membeli **${claimedParcel.parcel_code}** (${tier.name}) di **${city.name}** (Butuh **Lp ${price.toLocaleString('id-ID')}**).` };
            }
            throw err;
        }
    }

    const hasPrimaryInCity = existingLands.some(l => l.city_id === city.id && Number(l.is_primary) === 1);
    const isPrimary = (existingLands.length === 0 || !hasPrimaryInCity) ? 1 : 0;
    const cleanName = String(customName || `Kavling ${claimedParcel.parcel_code}`).slice(0, 60);
    const theme = getArchitectureTheme(themeId);
    const hasInitial = Array.isArray(initialCells) && initialCells.length > 0;
    const initialState = hasInitial ? 'active' : 'empty';

    const [insRes] = await conn.execute(
        `INSERT INTO player_lands
         (discord_id, city_id, parcel_code, district_no, custom_name, description, width, height, land_tier, theme_id, is_primary, purchase_price, condition_pct, building_state, last_condition_tick_at, next_pbb_at, acquired_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 100, ?, ?, ?, ?, ?)`,
        [
            discordId,
            city.id,
            claimedParcel.parcel_code,
            Number(claimedParcel.district_no || 1),
            cleanName,
            `Properti pribadi di ${city.name} (${claimedParcel.parcel_code}).`,
            tier.width,
            tier.height,
            tier.id,
            theme.id,
            isPrimary,
            price,
            initialState,
            now,
            now + THIRTY_DAYS_MS,
            now,
            now
        ]
    );
    const landId = insRes.insertId;

    await conn.execute(
        `UPDATE city_land_parcels
         SET status = 'owned', owner_id = ?, land_id = ?, foreclosed_price = NULL, foreclosed_at = NULL
         WHERE parcel_code = ?`,
        [discordId, landId, claimedParcel.parcel_code]
    );

    if (hasInitial) {
        for (const raw of initialCells) {
            const c = normalizeCellRecord(raw);
            if (c.x < 0 || c.y < 0 || c.x >= tier.width || c.y >= tier.height) continue;
            await conn.execute(
                `INSERT IGNORE INTO land_grid_cells
                 (land_id, layout_state, floor_level, x, y, zone_group_id, zone_name, module_id, material_id, block_kind, shape_variant, color_hex, meta_json)
                 VALUES (?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [landId, c.floor_level, c.x, c.y, c.zone_group_id, c.zone_name, c.module_id, c.material_id, c.block_kind, c.shape_variant, c.color_hex, c.meta_json]
            );
        }
    }

    const expansion = await checkAndAutoExpandDistrict(conn, city.id, now);

    return {
        ok: true,
        landId,
        parcelCode: claimedParcel.parcel_code,
        districtNo: Number(claimedParcel.district_no || 1),
        city,
        tier,
        price,
        customName: cleanName,
        districtExpanded: expansion.expanded ? expansion.newDistrict : null
    };
}

async function expandLand(conn, discordId, landId, now = Date.now()) {
    const land = await getLandById(conn, landId, true);
    if (!land || land.discord_id !== discordId) {
        return { ok: false, error: 'Kavling tidak ditemukan atau bukan milikmu.' };
    }
    const nextTier = getNextLandTier(land.land_tier);
    if (!nextTier) {
        return { ok: false, error: 'Kavling ini sudah berada di ukuran maksimal (**10×10 Megalopolis**).' };
    }

    const expandPrice = calculateLandExpandPrice(land.land_tier, land.city_id);
    const [pRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? LIMIT 1 FOR UPDATE`, [discordId]);
    if (pRows.length === 0) return { ok: false, error: 'Akun tidak ditemukan.' };
    const player = pRows[0];

    try {
        await debitPlayerFunds(conn, player, expandPrice, 'land_expand', { landId, from: land.land_tier, to: nextTier.id }, now);
    } catch (err) {
        if (err.message === 'INSUFFICIENT_FUNDS') {
            return { ok: false, error: `Saldo kurang untuk memperluas kavling ke **${nextTier.name}** (Butuh **Lp ${expandPrice.toLocaleString('id-ID')}**).` };
        }
        throw err;
    }

    const newPurchasePrice = Number(land.purchase_price || 0) + expandPrice;
    await conn.execute(
        `UPDATE player_lands
         SET width = ?, height = ?, land_tier = ?, purchase_price = ?, updated_at = ?
         WHERE id = ?`,
        [nextTier.width, nextTier.height, nextTier.id, newPurchasePrice, now, landId]
    );
    if (land.parcel_code) {
        const sizeTierSpec = getParcelSizeTier(nextTier.id);
        await conn.execute(
            `UPDATE city_land_parcels SET size_tier = ?, width = ?, height = ? WHERE parcel_code = ?`,
            [sizeTierSpec.code, nextTier.width, nextTier.height, land.parcel_code]
        );
    }

    return {
        ok: true,
        landId,
        nextTier,
        cost: expandPrice
    };
}

async function setPrimaryLand(conn, discordId, landId, now = Date.now()) {
    const land = await getLandById(conn, landId, true);
    if (!land || land.discord_id !== discordId) {
        return { ok: false, error: 'Kavling tidak ditemukan.' };
    }
    await conn.execute(
        `UPDATE player_lands SET is_primary = 0 WHERE discord_id = ? AND city_id = ?`,
        [discordId, land.city_id]
    );
    await conn.execute(
        `UPDATE player_lands SET is_primary = 1, updated_at = ? WHERE id = ?`,
        [now, landId]
    );
    return { ok: true, land };
}

async function updateLandMetadata(conn, discordId, landId, { customName, description, themeId }, now = Date.now()) {
    const land = await getLandById(conn, landId, true);
    if (!land || land.discord_id !== discordId) {
        return { ok: false, error: 'Kavling tidak ditemukan.' };
    }
    const cleanName = customName !== undefined ? String(customName).trim().slice(0, 64) || land.custom_name : land.custom_name;
    const cleanDesc = description !== undefined ? String(description).trim().slice(0, 280) : land.description;
    const nextTheme = themeId ? getArchitectureTheme(themeId).id : land.theme_id;

    await conn.execute(
        `UPDATE player_lands SET custom_name = ?, description = ?, theme_id = ?, updated_at = ? WHERE id = ?`,
        [cleanName, cleanDesc, nextTheme, now, landId]
    );
    return { ok: true, customName: cleanName, description: cleanDesc, themeId: nextTheme };
}

/**
 * Mengambil status fasilitas properti efektif milik pemain pada kota tertentu:
 * 1. Kavling milik sendiri di kota tersebut (prioritas is_primary = 1)
 * 2. Sewa P2P (p2p_whole / p2p_room) di kota tersebut
 * 3. Sewa NPC pemula (kos / kontrakan) di kota tersebut
 * 4. Fallback tabel legacy player_properties jika belum termigrasi
 * 5. Tunawisma lokal kota jika belum punya apa-apa di kota itu
 */
async function getEffectiveLocalProperty(conn, discordId, cityId, playerMaxSlots = 20, now = Date.now(), forUpdate = false, preferredLandId = null) {
    const lock = forUpdate ? ' FOR UPDATE' : '';
    const zoning = getCityZoning(cityId);
    const city = getCity(cityId);

    // Cek seluruh tanah milik pemain di kota target
    const cityLands = await getPlayerLands(conn, discordId, city.id, forUpdate);
    if (cityLands.length > 0) {
        let activeLand = cityLands[0];
        if (preferredLandId) {
            const matched = cityLands.find(l => Number(l.id) === Number(preferredLandId));
            if (matched) activeLand = matched;
        }
        const cells = await getLandCells(conn, activeLand.id, 'active');
        const stats = computeLandStats(cells, activeLand, zoning);

        const condPct = Math.max(0, Math.min(100, Number(activeLand.condition_pct ?? 100)));
        const conditionMeta = stats.conditionMeta || getConditionMeta(condPct, activeLand.building_state || (cells.length > 0 ? 'active' : 'empty'), cells.length > 0);
        const facilitiesLocked = Boolean(conditionMeta.facilitiesLocked);
        const qualityFactor = Number(conditionMeta.qualityFactor ?? 1);

        const baseSleepBonus = stats.totalCells > 0 ? stats.sleepEnergyBonus : 50;
        const sleepEnergyBonus = facilitiesLocked
            ? 45
            : Math.max(50, Math.round(baseSleepBonus * qualityFactor));
        const effPassiveRegen = facilitiesLocked
            ? 0
            : Math.round(stats.passiveEnergyRegenBonus * qualityFactor * 10) / 10;
        const effCookingSlots = facilitiesLocked ? 0 : stats.cookingSlots;
        const effStorageLimits = facilitiesLocked
            ? { bag: playerMaxSlots, kulkas: 0, freezer: 0, gudang: 0 }
            : {
                bag: playerMaxSlots,
                kulkas: stats.storageLimits.kulkas,
                freezer: stats.storageLimits.freezer,
                gudang: stats.storageLimits.gudang
            };

        return {
            source: 'owned_land',
            ownershipType: 'owned',
            propertyTier: stats.totalCells > 0 ? 'modular_building' : 'empty_land',
            cityId: city.id,
            city,
            landId: activeLand.id,
            land: activeLand,
            cityLands,
            customName: activeLand.custom_name,
            isEvicted: false,
            isPrimary: Number(activeLand.is_primary) === 1,
            conditionPct: condPct,
            buildingState: conditionMeta.state,
            conditionMeta,
            facilitiesLocked,
            sleepEnergyBonus,
            sleepDurationSec: stats.totalCells > 0 ? stats.sleepDurationSec : 3600,
            passiveEnergyRegenBonus: effPassiveRegen,
            cookingSlots: effCookingSlots,
            storageLimits: effStorageLimits,
            rawStorageLimits: stats.storageLimits,
            stats,
            tierObj: {
                id: 'modular_land',
                name: activeLand.custom_name,
                emoji: getArchitectureTheme(activeLand.theme_id).emoji,
                sleepEnergyBonus,
                sleepDurationSec: stats.totalCells > 0 ? stats.sleepDurationSec : 3600,
                passiveEnergyRegenBonus: effPassiveRegen,
                cookingSlots: effCookingSlots,
                storageLimits: facilitiesLocked ? { kulkas: 0, freezer: 0, gudang: 0 } : stats.storageLimits,
                facilities: {
                    kulkas: effStorageLimits.kulkas,
                    freezer: effStorageLimits.freezer,
                    gudang: effStorageLimits.gudang,
                    stove: effCookingSlots
                }
            }
        };
    }

    // Cek sewa aktif (P2P atau NPC preset) di kota tersebut
    const [leaseRows] = await conn.execute(
        `SELECT * FROM property_leases
         WHERE tenant_id = ? AND city_id = ? AND is_evicted = 0
         ORDER BY FIELD(lease_kind, 'p2p_whole', 'p2p_room', 'npc_preset'), id ASC LIMIT 1${lock}`,
        [discordId, city.id]
    );

    if (leaseRows.length > 0) {
        const lease = leaseRows[0];
        if (lease.lease_kind === 'p2p_whole' && lease.land_id) {
            const leasedLand = await getLandById(conn, lease.land_id, forUpdate);
            if (leasedLand) {
                const cells = await getLandCells(conn, leasedLand.id, 'active');
                const stats = computeLandStats(cells, leasedLand, zoning);
                const condPct = Math.max(0, Math.min(100, Number(leasedLand.condition_pct ?? 100)));
                const conditionMeta = stats.conditionMeta || getConditionMeta(condPct, leasedLand.building_state || 'active', cells.length > 0);
                const facilitiesLocked = Boolean(conditionMeta.facilitiesLocked);
                const qualityFactor = Number(conditionMeta.qualityFactor ?? 1);
                const effSleep = facilitiesLocked ? 45 : Math.max(50, Math.round(stats.sleepEnergyBonus * qualityFactor));
                const effRegen = facilitiesLocked ? 0 : Math.round(stats.passiveEnergyRegenBonus * qualityFactor * 10) / 10;
                const effStove = facilitiesLocked ? 0 : stats.cookingSlots;

                return {
                    source: 'p2p_whole',
                    ownershipType: 'rent',
                    propertyTier: 'p2p_whole',
                    cityId: city.id,
                    city,
                    landId: leasedLand.id,
                    land: leasedLand,
                    lease,
                    cityLands: [],
                    customName: `Sewa: ${leasedLand.custom_name}`,
                    isEvicted: false,
                    conditionPct: condPct,
                    buildingState: conditionMeta.state,
                    conditionMeta,
                    facilitiesLocked,
                    sleepEnergyBonus: effSleep,
                    sleepDurationSec: stats.sleepDurationSec,
                    passiveEnergyRegenBonus: effRegen,
                    cookingSlots: effStove,
                    storageLimits: {
                        bag: playerMaxSlots,
                        kulkas: facilitiesLocked ? 0 : stats.storageLimits.kulkas,
                        freezer: facilitiesLocked ? 0 : stats.storageLimits.freezer,
                        gudang: facilitiesLocked ? 0 : stats.storageLimits.gudang
                    },
                    rawStorageLimits: stats.storageLimits,
                    stats,
                    tierObj: {
                        id: 'p2p_whole',
                        name: `Sewa ${leasedLand.custom_name}`,
                        emoji: '🏘️',
                        sleepEnergyBonus: effSleep,
                        sleepDurationSec: stats.sleepDurationSec,
                        passiveEnergyRegenBonus: effRegen,
                        cookingSlots: effStove,
                        storageLimits: facilitiesLocked ? { kulkas: 0, freezer: 0, gudang: 0 } : stats.storageLimits,
                        facilities: {
                            kulkas: facilitiesLocked ? 0 : stats.storageLimits.kulkas,
                            freezer: facilitiesLocked ? 0 : stats.storageLimits.freezer,
                            gudang: facilitiesLocked ? 0 : stats.storageLimits.gudang,
                            stove: effStove
                        }
                    }
                };
            }
        }

        if (lease.lease_kind === 'p2p_room') {
            return {
                source: 'p2p_room',
                ownershipType: 'rent',
                propertyTier: 'p2p_room',
                cityId: city.id,
                city,
                landId: lease.land_id,
                land: null,
                lease,
                cityLands: [],
                customName: 'Kamar Kos P2P',
                isEvicted: false,
                conditionPct: 100,
                sleepEnergyBonus: 72,
                sleepDurationSec: 3300,
                passiveEnergyRegenBonus: 0.5,
                cookingSlots: 1,
                storageLimits: { bag: playerMaxSlots, kulkas: 20, freezer: 10, gudang: 15 },
                stats: null,
                tierObj: {
                    id: 'p2p_room',
                    name: 'Kamar Kos P2P',
                    emoji: '🚪',
                    sleepEnergyBonus: 72,
                    sleepDurationSec: 3300,
                    passiveEnergyRegenBonus: 0.5,
                    cookingSlots: 1,
                    storageLimits: { kulkas: 20, freezer: 10, gudang: 15 },
                    facilities: { kulkas: 20, freezer: 10, gudang: 15, stove: 1 }
                }
            };
        }

        const npcTier = getPropertyTier(lease.preset_tier || 'kos');
        return {
            source: 'npc_lease',
            ownershipType: 'rent',
            propertyTier: npcTier.id,
            cityId: city.id,
            city,
            landId: null,
            land: null,
            lease,
            cityLands: [],
            customName: npcTier.name,
            isEvicted: false,
            conditionPct: 100,
            sleepEnergyBonus: npcTier.sleepEnergyBonus,
            sleepDurationSec: npcTier.sleepDurationSec,
            passiveEnergyRegenBonus: npcTier.passiveEnergyRegenBonus,
            cookingSlots: npcTier.storageLimits.stove,
            storageLimits: {
                bag: playerMaxSlots,
                kulkas: npcTier.storageLimits.kulkas,
                freezer: npcTier.storageLimits.freezer,
                gudang: npcTier.storageLimits.gudang
            },
            stats: null,
            tierObj: npcTier
        };
    }

    // Fallback ke tabel legacy player_properties jika ada baris yang belum termigrasi
    const [legacyRows] = await conn.execute(
        `SELECT * FROM player_properties WHERE discord_id = ? LIMIT 1${lock}`,
        [discordId]
    );
    if (legacyRows.length > 0 && (legacyRows[0].city_id || 'kota_sentral') === city.id && Number(legacyRows[0].is_evicted) === 0) {
        const leg = legacyRows[0];
        const tier = getPropertyTier(leg.property_tier === 'rumah_pribadi' ? 'rumah' : leg.property_tier);
        return {
            source: 'legacy',
            ownershipType: leg.ownership_type,
            propertyTier: tier.id,
            cityId: city.id,
            city,
            landId: null,
            land: null,
            cityLands: [],
            customName: tier.name,
            isEvicted: false,
            conditionPct: 100,
            sleepEnergyBonus: tier.sleepEnergyBonus,
            sleepDurationSec: tier.sleepDurationSec,
            passiveEnergyRegenBonus: tier.passiveEnergyRegenBonus,
            cookingSlots: tier.storageLimits.stove,
            storageLimits: {
                bag: playerMaxSlots,
                kulkas: tier.storageLimits.kulkas,
                freezer: tier.storageLimits.freezer,
                gudang: tier.storageLimits.gudang
            },
            stats: null,
            tierObj: tier,
            legacyRow: leg
        };
    }

    // Tunawisma di kota tersebut
    const homelessTier = getPropertyTier('tunawisma');
    return {
        source: 'tunawisma',
        ownershipType: 'none',
        propertyTier: 'tunawisma',
        cityId: city.id,
        city,
        landId: null,
        land: null,
        cityLands: [],
        customName: homelessTier.name,
        isEvicted: false,
        conditionPct: 100,
        buildingState: 'empty',
        facilitiesLocked: false,
        sleepEnergyBonus: homelessTier.sleepEnergyBonus,
        sleepDurationSec: homelessTier.sleepDurationSec,
        passiveEnergyRegenBonus: 0,
        cookingSlots: 0,
        storageLimits: { bag: playerMaxSlots, kulkas: 0, freezer: 0, gudang: 0 },
        stats: null,
        tierObj: homelessTier
    };
}

/**
 * Mengajukan penawaran jual-beli tanah langsung ke pemain lain (Direct P2P Offer).
 */
async function createDirectLandOffer(conn, sellerId, buyerId, landId, offerPrice, now = Date.now()) {
    if (!buyerId || sellerId === buyerId) {
        return { ok: false, error: 'Tidak dapat mengirim penawaran jual ke diri sendiri.' };
    }
    const land = await getLandById(conn, landId, true);
    if (!land || land.discord_id !== sellerId) {
        return { ok: false, error: 'Kavling tidak ditemukan atau bukan milikmu.' };
    }

    const [sRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? LIMIT 1 FOR UPDATE`, [sellerId]);
    const [bRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? LIMIT 1 FOR UPDATE`, [buyerId]);
    if (sRows.length === 0 || bRows.length === 0) {
        return { ok: false, error: 'Pemain target belum terdaftar di kota!' };
    }
    if (Number(bRows[0].is_banned) === 1) {
        return { ok: false, error: 'Pemain target sedang diblokir.' };
    }

    const sellerElig = validateP2PTradeEligibility(sRows[0], getTotalSkillLevelFromPlayerRow(sRows[0]), now);
    if (!sellerElig.ok) return { ok: false, error: sellerElig.reason };
    const buyerElig = validateP2PTradeEligibility(bRows[0], getTotalSkillLevelFromPlayerRow(bRows[0]), now);
    if (!buyerElig.ok) return { ok: false, error: `Pembeli target belum memenuhi syarat P2P: ${buyerElig.reason}` };

    const [activeCredit] = await conn.execute(
        `SELECT id FROM player_credits WHERE land_id = ? AND status = 'active' LIMIT 1`,
        [landId]
    );
    if (activeCredit.length > 0) {
        return { ok: false, error: 'Kavling masih menjadi agunan KPR aktif di `/credit`.' };
    }

    const [activeProj] = await conn.execute(
        `SELECT id FROM construction_projects WHERE land_id = ? AND status = 'building' LIMIT 1`,
        [landId]
    );
    if (activeProj.length > 0) {
        return { ok: false, error: 'Kavling sedang dalam proses konstruksi aktif. Tunggu hingga selesai.' };
    }

    const cells = await getLandCells(conn, landId, 'active');
    const stats = computeLandStats(cells, land);
    const bounds = validateMarketPriceBounds(offerPrice, stats.totalAppraisalValue);
    if (!bounds.ok) return { ok: false, error: bounds.reason };

    // Expire penawaran lama yang sama jika ada
    await conn.execute(
        `UPDATE land_trade_offers SET status = 'cancelled' WHERE land_id = ? AND buyer_id = ? AND status = 'pending'`,
        [landId, buyerId]
    );

    const expiresAt = now + FORTY_EIGHT_HOURS_MS;
    const [insRes] = await conn.execute(
        `INSERT INTO land_trade_offers (land_id, seller_id, buyer_id, offer_price, appraisal_value, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [landId, sellerId, buyerId, bounds.price, bounds.njop, expiresAt, now]
    );

    return {
        ok: true,
        offerId: insRes.insertId,
        land,
        offerPrice: bounds.price,
        appraisalValue: bounds.njop,
        expiresAt
    };
}

async function acceptDirectLandOffer(conn, buyerId, offerId, now = Date.now()) {
    const [rows] = await conn.execute(
        `SELECT * FROM land_trade_offers WHERE id = ? AND status = 'pending' LIMIT 1 FOR UPDATE`,
        [offerId]
    );
    if (rows.length === 0) {
        return { ok: false, error: 'Penawaran tanah sudah kedaluwarsa, dibatalkan, atau telah diselesaikan.' };
    }
    const offer = rows[0];
    if (offer.buyer_id !== buyerId) {
        return { ok: false, error: 'Penawaran ini bukan ditujukan kepadamu.' };
    }
    if (Number(offer.expires_at) <= now) {
        await conn.execute(`UPDATE land_trade_offers SET status = 'expired' WHERE id = ?`, [offerId]);
        return { ok: false, error: 'Penawaran tanah ini sudah melewati batas waktu 48 jam.' };
    }

    const land = await getLandById(conn, offer.land_id, true);
    if (!land || land.discord_id !== offer.seller_id) {
        await conn.execute(`UPDATE land_trade_offers SET status = 'cancelled' WHERE id = ?`, [offerId]);
        return { ok: false, error: 'Kepemilikan kavling telah berubah sebelum transaksi disetujui.' };
    }

    const [bRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? FOR UPDATE`, [buyerId]);
    const [sRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? FOR UPDATE`, [offer.seller_id]);
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

    const price = Number(offer.offer_price);
    const taxBphtb = Math.round(price * P2P_PROPERTY_RULES.BPHTB_TAX_RATE);
    const sellerProceeds = price - taxBphtb;

    try {
        await debitPlayerFunds(conn, buyer, price, 'p2p_direct_land_buy', { offerId, landId: land.id }, now);
    } catch (err) {
        if (err.message === 'INSUFFICIENT_FUNDS') {
            return { ok: false, error: `Saldo tidak cukup untuk membeli kavling ini (Butuh **Lp ${price.toLocaleString('id-ID')}**).` };
        }
        throw err;
    }

    await creditPlayerCash(conn, sRows[0], sellerProceeds, 'p2p_direct_land_sell', { offerId, landId: land.id, taxBphtb }, now);
    await logLedger(conn, buyerId, 'sink', 'p2p_property_bphtb_tax', taxBphtb, Number(buyer.cash) + Number(buyer.bank), { offerId }, now);

    await conn.execute(
        `UPDATE player_lands SET discord_id = ?, is_primary = 0, updated_at = ? WHERE id = ?`,
        [buyerId, now, land.id]
    );
    if (land.parcel_code) {
        await conn.execute(
            `UPDATE city_land_parcels SET owner_id = ? WHERE land_id = ?`,
            [buyerId, land.id]
        );
    }
    await conn.execute(`UPDATE land_trade_offers SET status = 'accepted' WHERE id = ?`, [offerId]);
    await conn.execute(
        `UPDATE land_trade_offers SET status = 'cancelled' WHERE land_id = ? AND id <> ? AND status = 'pending'`,
        [land.id, offerId]
    );
    await conn.execute(
        `UPDATE property_market_listings SET status = 'cancelled' WHERE land_id = ? AND status = 'active'`,
        [land.id]
    );

    return {
        ok: true,
        landId: land.id,
        landName: land.custom_name,
        price,
        taxBphtb,
        sellerProceeds
    };
}

async function cancelOrDeclineLandOffer(conn, discordId, offerId, action = 'decline') {
    const [rows] = await conn.execute(
        `SELECT * FROM land_trade_offers WHERE id = ? AND status = 'pending' LIMIT 1 FOR UPDATE`,
        [offerId]
    );
    if (rows.length === 0) {
        return { ok: false, error: 'Penawaran aktif tidak ditemukan.' };
    }
    const offer = rows[0];
    if (action === 'cancel' && offer.seller_id !== discordId) {
        return { ok: false, error: 'Hanya pengirim penawaran yang dapat membatalkannya.' };
    }
    if (action !== 'cancel' && offer.buyer_id !== discordId && offer.seller_id !== discordId) {
        return { ok: false, error: 'Penawaran ini tidak terkait dengan akunmu.' };
    }
    const nextStatus = offer.seller_id === discordId ? 'cancelled' : 'declined';
    await conn.execute(`UPDATE land_trade_offers SET status = ? WHERE id = ?`, [nextStatus, offerId]);
    return { ok: true, status: nextStatus };
}

async function getDirectLandOffers(conn, discordId, now = Date.now()) {
    await conn.execute(
        `UPDATE land_trade_offers SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`,
        [now]
    );
    const [incoming] = await conn.execute(
        `SELECT o.*, pl.custom_name, pl.city_id, pl.parcel_code, pl.width, pl.height, u.username AS seller_name
         FROM land_trade_offers o
         JOIN player_lands pl ON o.land_id = pl.id
         LEFT JOIN players u ON o.seller_id = u.discord_id
         WHERE o.buyer_id = ? AND o.status = 'pending'
         ORDER BY o.created_at DESC LIMIT 15`,
        [discordId]
    );
    const [outgoing] = await conn.execute(
        `SELECT o.*, pl.custom_name, pl.city_id, pl.parcel_code, pl.width, pl.height, u.username AS buyer_name
         FROM land_trade_offers o
         JOIN player_lands pl ON o.land_id = pl.id
         LEFT JOIN players u ON o.buyer_id = u.discord_id
         WHERE o.seller_id = ? AND o.status = 'pending'
         ORDER BY o.created_at DESC LIMIT 15`,
        [discordId]
    );
    return { incoming, outgoing };
}

async function payLandPbb(conn, discordId, landId, now = Date.now()) {
    const land = await getLandById(conn, landId, true);
    if (!land || land.discord_id !== discordId) {
        return { ok: false, error: 'Kavling tidak ditemukan.' };
    }

    const ownerLands = await getPlayerLands(conn, discordId, null, false);
    const ordIdx = Math.max(0, ownerLands.findIndex(l => Number(l.id) === Number(landId)));
    const mult = getProgressivePbbMultiplier(ordIdx);

    const cells = await getLandCells(conn, landId, 'active');
    const stats = computeLandStats(cells, land);
    const pbbFee = Math.max(10000, Math.round(stats.monthlyPbbBase * mult));

    const [pRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? LIMIT 1 FOR UPDATE`, [discordId]);
    if (pRows.length === 0) return { ok: false, error: 'Akun tidak ditemukan.' };

    try {
        await debitPlayerFunds(conn, pRows[0], pbbFee, 'property_land_pbb', { landId, manual: true, progressiveMult: mult }, now);
    } catch (err) {
        if (err.message === 'INSUFFICIENT_FUNDS') {
            return { ok: false, error: `Saldo tidak cukup untuk membayar PBB **${land.custom_name}** (Butuh **Lp ${pbbFee.toLocaleString('id-ID')}**).` };
        }
        throw err;
    }

    const baseNext = Math.max(now, Number(land.next_pbb_at || now));
    const nextPbbAt = baseNext + THIRTY_DAYS_MS;
    await conn.execute(
        `UPDATE player_lands SET next_pbb_at = ?, grace_until = 0, updated_at = ? WHERE id = ?`,
        [nextPbbAt, now, landId]
    );

    return { ok: true, landName: land.custom_name, pbbFee, nextPbbAt, progressiveMult: mult };
}

/**
 * Menyita kavling yang menunggak PBB melewati grace period 21 hari atau terbengkalai permanen 21 hari.
 * Barang penyimpanan dievakuasi ke tas (emergency_locked = 1) agar tidak pernah hilang permanen.
 */
async function forecloseAbandonedLands(conn, now = Date.now()) {
    const [candidates] = await conn.execute(
        `SELECT * FROM player_lands
         WHERE (grace_until > 0 AND grace_until <= ?)
            OR (building_state IN ('abandoned', 'collapsed') AND abandoned_since > 0 AND (abandoned_since + ?) <= ?)
         FOR UPDATE`,
        [now, CONDITION_THRESHOLDS.FORECLOSURE_GRACE_MS, now]
    );

    let foreclosedCount = 0;
    const parcelsReleased = [];

    for (const land of candidates) {
        const [activeCredits] = await conn.execute(
            `SELECT id FROM player_credits WHERE land_id = ? AND status = 'active' LIMIT 1`,
            [land.id]
        );
        // Jika masih terikat KPR aktif, biarkan pipeline repossession creditService yang menangani
        if (activeCredits.length > 0) continue;

        // Evakuasi barang dari kulkas/freezer/gudang kavling ke bag (emergency_locked = 1)
        const [evacRes] = await conn.execute(
            `UPDATE player_inventory
             SET storage_location = 'bag', land_id = NULL, emergency_locked = 1
             WHERE discord_id = ? AND land_id = ? AND storage_location <> 'bag'`,
            [land.discord_id, land.id]
        );
        const [furnRows] = await conn.execute(
            `SELECT item_id FROM land_furniture_items WHERE land_id = ?`,
            [land.id]
        );
        for (const fr of furnRows) {
            await conn.execute(
                `INSERT INTO player_inventory (discord_id, item_id, quantity, storage_location, land_id, emergency_locked, created_at)
                 VALUES (?, ?, 1, 'bag', NULL, 1, ?)`,
                [land.discord_id, fr.item_id, now]
            );
        }

        await conn.execute(`UPDATE property_leases SET is_evicted = 1, grace_until = 0 WHERE land_id = ? AND is_evicted = 0`, [land.id]);
        await conn.execute(`UPDATE property_market_listings SET status = 'cancelled' WHERE land_id = ? AND status = 'active'`, [land.id]);
        await conn.execute(`UPDATE land_trade_offers SET status = 'cancelled' WHERE land_id = ? AND status = 'pending'`, [land.id]);
        await conn.execute(`DELETE FROM land_furniture_items WHERE land_id = ?`, [land.id]);
        await conn.execute(`DELETE FROM land_rooms WHERE land_id = ?`, [land.id]);
        await conn.execute(`DELETE FROM land_wall_edges WHERE land_id = ?`, [land.id]);
        await conn.execute(`DELETE FROM land_floor_cells WHERE land_id = ?`, [land.id]);
        await conn.execute(`DELETE FROM land_grid_cells WHERE land_id = ?`, [land.id]);
        await conn.execute(`DELETE FROM land_material_depots WHERE land_id = ?`, [land.id]);
        await conn.execute(`DELETE FROM construction_projects WHERE land_id = ?`, [land.id]);
        await conn.execute(`DELETE FROM land_business_state WHERE land_id = ?`, [land.id]);
        await conn.execute(`DELETE FROM property_likes WHERE land_id = ?`, [land.id]);

        if (land.parcel_code) {
            await conn.execute(
                `UPDATE city_land_parcels
                 SET status = 'foreclosed', owner_id = NULL, land_id = NULL,
                     foreclosed_price = GREATEST(ROUND(base_price * 0.65), 1000000),
                     foreclosed_at = ?
                 WHERE parcel_code = ?`,
                [now, land.parcel_code]
            );
            parcelsReleased.push({ parcelCode: land.parcel_code, evacuatedItems: Number(evacRes.affectedRows || 0) });
        }

        await conn.execute(`DELETE FROM player_lands WHERE id = ?`, [land.id]);
        foreclosedCount += 1;
    }

    return { foreclosedCount, parcelsReleased };
}

async function togglePropertyLike(conn, viewerDiscordId, landId, now = Date.now()) {
    const land = await getLandById(conn, landId, true);
    if (!land) {
        return { ok: false, error: 'Properti tidak ditemukan.' };
    }
    if (land.discord_id === viewerDiscordId) {
        return { ok: false, error: 'Kamu tidak bisa menyukai bangunan milikmu sendiri.' };
    }

    const [existing] = await conn.execute(
        `SELECT 1 FROM property_likes WHERE land_id = ? AND liker_id = ? LIMIT 1`,
        [landId, viewerDiscordId]
    );

    let liked = false;
    if (existing.length > 0) {
        await conn.execute(`DELETE FROM property_likes WHERE land_id = ? AND liker_id = ?`, [landId, viewerDiscordId]);
        liked = false;
    } else {
        await conn.execute(
            `INSERT IGNORE INTO property_likes (land_id, liker_id, created_at) VALUES (?, ?, ?)`,
            [landId, viewerDiscordId, now]
        );
        liked = true;
    }

    const [cntRows] = await conn.execute(`SELECT COUNT(*) AS cnt FROM property_likes WHERE land_id = ?`, [landId]);
    const likeCount = Number(cntRows[0]?.cnt || 0);
    await conn.execute(`UPDATE player_lands SET like_count = ? WHERE id = ?`, [likeCount, landId]);

    return { ok: true, liked, likeCount };
}

module.exports = {
    THIRTY_DAYS_MS,
    SEVEN_DAYS_MS,
    PBB_RATE_MONTHLY,
    P2P_PROPERTY_RULES,
    PARCEL_SIZE_TIERS,
    validateP2PTradeEligibility,
    validateMarketPriceBounds,
    getTotalSkillLevelFromPlayerRow,
    getPlayerTotalSkillLevel,
    calculateLandPurchasePrice,
    calculateLandExpandPrice,
    normalizeCellRecord,
    computeArchitectureScore,
    computeLandStats,
    getPlayerLands,
    getLandById,
    getLandCells,
    getLandFloorCells,
    getLandWallEdges,
    getLandRoomsMap,
    getFullLandArchitecture,
    ensureDraftInitialized,
    ensureCityParcelsSeeded,
    checkAndAutoExpandDistrict,
    listCityParcels,
    buyLand,
    expandLand,
    setPrimaryLand,
    updateLandMetadata,
    getEffectiveLocalProperty,
    createDirectLandOffer,
    acceptDirectLandOffer,
    cancelOrDeclineLandOffer,
    getDirectLandOffers,
    payLandPbb,
    forecloseAbandonedLands,
    togglePropertyLike
};
