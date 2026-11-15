const crypto = require('crypto');
const {
    getStructuralMaterial,
    getBuildingModule,
    getFloorMaterial,
    getWallEdgeType,
    getRoofVariant,
    validateCellPlacement,
    validateVoxelSupport,
    calculateStructuralStress,
    parseGridAreaInput,
    parseAreaPerimeterWalls,
    parseLineWallInput,
    parseAsciiFloorPattern,
    getStarterTemplate,
    getFloorLabel
} = require('../data/buildingModules');
const { getItem } = require('../data/items');
const { debitPlayerFunds } = require('./economyService');
const { removeItem, addItem, canFitItems, getPlayerInventory } = require('./inventoryService');
const { syncLandRooms } = require('./roomDetectionService');
const {
    getLandById,
    getLandCells,
    getLandFloorCells,
    getLandWallEdges,
    getFullLandArchitecture,
    ensureDraftInitialized,
    normalizeCellRecord
} = require('./landService');

const MIN_BUILD_MS = 30 * 1000;
const MAX_BUILD_MS = 4 * 3600 * 1000;
const ENERGY_BOOST_COST = 20;

function makeZoneGroupId(prefix = 'z') {
    return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function getCellMaterialsMap(cell) {
    const mat = getStructuralMaterial(cell.material_id);
    const mod = getBuildingModule(cell.module_id);
    const mult = Number(mod.materialCostMult || 1);
    const out = {};
    for (const [itemId, qty] of Object.entries(mat.costPerCell || {})) {
        const raw = Number(qty || 0);
        if (raw <= 0) continue;
        out[itemId] = (out[itemId] || 0) + Math.max(1, Math.round(raw * mult));
    }
    for (const [itemId, qty] of Object.entries(mod.extraCostPerCell || {})) {
        out[itemId] = (out[itemId] || 0) + Number(qty || 0);
    }
    return out;
}

function getFloorCellMaterialsMap(fc) {
    const out = {};
    const fMat = getFloorMaterial(fc.floor_material_id || 'kayu');
    for (const [itemId, qty] of Object.entries(fMat.costPerCell || {})) {
        const q = Number(qty || 0);
        if (q > 0) out[itemId] = (out[itemId] || 0) + q;
    }
    if (fc.roof_variant && fc.roof_variant !== 'none') {
        const rVar = getRoofVariant(fc.roof_variant);
        for (const [itemId, qty] of Object.entries(rVar.costPerCell || {})) {
            const q = Number(qty || 0);
            if (q > 0) out[itemId] = (out[itemId] || 0) + q;
        }
    }
    if (Number(fc.is_pillar || 0) === 1) {
        out.batu_bata = (out.batu_bata || 0) + 1;
        out.semen = (out.semen || 0) + 1;
    }
    return out;
}

function getWallEdgeMaterialsMap(edge) {
    const out = {};
    const wType = getWallEdgeType(edge.edge_type || 'wall');
    for (const [itemId, qty] of Object.entries(wType.costPerEdge || {})) {
        const q = Number(qty || 0);
        if (q > 0) out[itemId] = (out[itemId] || 0) + q;
    }
    return out;
}

/**
 * Menghitung RAB bahan bersih (selisih draft vs active 4-Layer + legacy grid) & estimasi durasi bangun.
 */
function calculateConstructionRab(draftCells = [], activeCells = [], conditionPct = 100, draftArch = null, activeArch = null) {
    const dArch = draftArch || draftCells?._archData || { floorCells: [], wallEdges: [] };
    const aArch = activeArch || activeCells?._archData || { floorCells: [], wallEdges: [] };

    const activeMap = new Map();
    for (const raw of activeCells) {
        const c = normalizeCellRecord(raw);
        activeMap.set(`${c.floor_level}:${c.x}:${c.y}`, c);
    }

    const draftMap = new Map();
    for (const raw of draftCells) {
        const c = normalizeCellRecord(raw);
        draftMap.set(`${c.floor_level}:${c.x}:${c.y}`, c);
    }

    const activeFloorMap = new Map();
    for (const raw of aArch.floorCells || []) {
        const key = `${Number(raw.floor_level ?? 1)}:${Number(raw.x)}:${Number(raw.y)}`;
        activeFloorMap.set(key, raw);
    }
    const draftFloorMap = new Map();
    for (const raw of dArch.floorCells || []) {
        const key = `${Number(raw.floor_level ?? 1)}:${Number(raw.x)}:${Number(raw.y)}`;
        draftFloorMap.set(key, raw);
    }

    const activeWallMap = new Map();
    for (const raw of aArch.wallEdges || []) {
        const key = `${Number(raw.floor_level ?? 1)}:${raw.orientation}:${Number(raw.gx)}:${Number(raw.gy)}`;
        activeWallMap.set(key, raw);
    }
    const draftWallMap = new Map();
    for (const raw of dArch.wallEdges || []) {
        const key = `${Number(raw.floor_level ?? 1)}:${raw.orientation}:${Number(raw.gx)}:${Number(raw.gy)}`;
        draftWallMap.set(key, raw);
    }

    const requiredMaterials = {};
    const validationErrors = [];
    let buildSeconds = 0;
    let changedStructuralCells = 0;
    let renamedOnlyCells = 0;

    for (const [key, d] of draftMap.entries()) {
        const check = validateCellPlacement(d.material_id, d.floor_level, d.module_id);
        if (!check.ok) {
            const coord = `${String.fromCharCode(65 + d.x)}${d.y + 1}`;
            validationErrors.push(`${getFloorLabel(d.floor_level)} (${coord}): ${check.error}`);
        }

        const prev = activeMap.get(key);
        const sameStructure =
            prev &&
            prev.module_id === d.module_id &&
            prev.material_id === d.material_id;

        if (sameStructure) {
            if (prev.zone_name !== d.zone_name || prev.color_hex !== d.color_hex || prev.zone_group_id !== d.zone_group_id) {
                renamedOnlyCells += 1;
            }
            continue;
        }

        changedStructuralCells += 1;
        const cellMats = getCellMaterialsMap(d);
        for (const [itemId, qty] of Object.entries(cellMats)) {
            requiredMaterials[itemId] = (requiredMaterials[itemId] || 0) + qty;
        }

        const mat = getStructuralMaterial(d.material_id);
        buildSeconds += Number(mat.buildTimePerCellSec || 60);
    }

    // Layer 1 & 3: Lantai & Atap (hindari double-count dengan sel grid lama kecuali atap berubah)
    for (const [key, df] of draftFloorMap.entries()) {
        const fl = Number(df.floor_level ?? 1);
        const coord = `${String.fromCharCode(65 + Number(df.x))}${Number(df.y) + 1}`;
        const fMat = getFloorMaterial(df.floor_material_id || 'kayu');
        const structMat = getStructuralMaterial(fMat.id);
        if (fl < 0 && !structMat.allowBasement) {
            validationErrors.push(`${getFloorLabel(fl)} (${coord}): Lantai material ${fMat.name} tidak diizinkan untuk basement (gunakan Beton/Baja/Bata/Marmer).`);
        }

        const prev = activeFloorMap.get(key);
        const hasGridAtKey = draftMap.has(key);
        const prevRoof = (prev?.roof_variant && prev.roof_variant !== 'none') ? prev.roof_variant : null;
        const nextRoof = (df.roof_variant && df.roof_variant !== 'none') ? df.roof_variant : null;

        if (hasGridAtKey) {
            if (nextRoof && nextRoof !== prevRoof) {
                changedStructuralCells += 1;
                const rVar = getRoofVariant(nextRoof);
                for (const [itemId, qty] of Object.entries(rVar.costPerCell || {})) {
                    requiredMaterials[itemId] = (requiredMaterials[itemId] || 0) + Number(qty || 0);
                }
                buildSeconds += 20;
            }
            continue;
        }

        const sameFloor =
            prev &&
            (prev.floor_material_id || 'kayu') === (df.floor_material_id || 'kayu') &&
            prevRoof === nextRoof &&
            Boolean(prev.is_pillar) === Boolean(df.is_pillar);

        if (sameFloor) {
            if ((prev.color_hex || null) !== (df.color_hex || null)) {
                renamedOnlyCells += 1;
            }
            continue;
        }

        changedStructuralCells += 1;
        const floorMats = getFloorCellMaterialsMap(df);
        for (const [itemId, qty] of Object.entries(floorMats)) {
            requiredMaterials[itemId] = (requiredMaterials[itemId] || 0) + qty;
        }
        buildSeconds += 35;
    }

    // Layer 2: Dinding/Pintu/Jendela/Pagar Edge H/V
    for (const [key, dw] of draftWallMap.entries()) {
        const prev = activeWallMap.get(key);
        const sameWall =
            prev &&
            prev.edge_type === dw.edge_type &&
            (prev.material_id || 'bata') === (dw.material_id || 'bata');

        if (sameWall) {
            if ((prev.color_hex || null) !== (dw.color_hex || null)) {
                renamedOnlyCells += 1;
            }
            continue;
        }

        changedStructuralCells += 1;
        const wallMats = getWallEdgeMaterialsMap(dw);
        for (const [itemId, qty] of Object.entries(wallMats)) {
            requiredMaterials[itemId] = (requiredMaterials[itemId] || 0) + qty;
        }
        buildSeconds += 25;
    }

    // Refund bahan (50%..70% tergantung kondisi) untuk sel & edge aktif yang dibongkar/diganti
    const refundRatio = 0.50 + 0.20 * (Math.max(0, Math.min(100, Number(conditionPct ?? 100))) / 100);
    const demolishedRaw = {};
    let removedCells = 0;
    for (const [key, a] of activeMap.entries()) {
        const next = draftMap.get(key);
        if (next && next.module_id === a.module_id && next.material_id === a.material_id) {
            continue;
        }
        removedCells += 1;
        const cellMats = getCellMaterialsMap(a);
        for (const [itemId, qty] of Object.entries(cellMats)) {
            demolishedRaw[itemId] = (demolishedRaw[itemId] || 0) + qty;
        }
    }
    for (const [key, af] of activeFloorMap.entries()) {
        if (activeMap.has(key)) continue;
        const next = draftFloorMap.get(key);
        const afRoof = (af.roof_variant && af.roof_variant !== 'none') ? af.roof_variant : null;
        const nextRoof = (next?.roof_variant && next.roof_variant !== 'none') ? next.roof_variant : null;
        if (
            next &&
            (next.floor_material_id || 'kayu') === (af.floor_material_id || 'kayu') &&
            afRoof === nextRoof &&
            Boolean(next.is_pillar) === Boolean(af.is_pillar)
        ) {
            continue;
        }
        removedCells += 1;
        const floorMats = getFloorCellMaterialsMap(af);
        for (const [itemId, qty] of Object.entries(floorMats)) {
            demolishedRaw[itemId] = (demolishedRaw[itemId] || 0) + qty;
        }
    }
    for (const [key, aw] of activeWallMap.entries()) {
        const next = draftWallMap.get(key);
        if (next && next.edge_type === aw.edge_type && (next.material_id || 'bata') === (aw.material_id || 'bata')) {
            continue;
        }
        removedCells += 1;
        const wallMats = getWallEdgeMaterialsMap(aw);
        for (const [itemId, qty] of Object.entries(wallMats)) {
            demolishedRaw[itemId] = (demolishedRaw[itemId] || 0) + qty;
        }
    }

    const refundMaterials = {};
    for (const [itemId, qty] of Object.entries(demolishedRaw)) {
        const ref = Math.floor(qty * refundRatio);
        if (ref > 0) refundMaterials[itemId] = ref;
    }

    const mergedSupportCells = [...draftMap.values()];
    for (const [key, df] of draftFloorMap.entries()) {
        if (draftMap.has(key)) continue;
        const hasRoof = df.roof_variant && df.roof_variant !== 'none';
        mergedSupportCells.push({
            floor_level: Number(df.floor_level ?? 1),
            x: Number(df.x),
            y: Number(df.y),
            material_id: getStructuralMaterial(df.floor_material_id || 'kayu').id,
            module_id: hasRoof ? 'roof_gable' : 'hall_custom',
            block_kind: hasRoof ? 'roof' : 'module',
            is_pillar: Number(df.is_pillar || 0)
        });
    }

    const supportCheck = mergedSupportCells.length > 0
        ? validateVoxelSupport(mergedSupportCells)
        : { ok: true, unsupportedCells: [], error: null };
    if (!supportCheck.ok && supportCheck.error) {
        validationErrors.push(supportCheck.error);
    }
    const structuralStress = calculateStructuralStress(mergedSupportCells);

    let durationMs = 0;
    if (changedStructuralCells > 0) {
        durationMs = Math.max(MIN_BUILD_MS, Math.min(MAX_BUILD_MS, buildSeconds * 1000));
    }

    return {
        ok: validationErrors.length === 0,
        validationErrors,
        supportCheck,
        structuralStress,
        requiredMaterials,
        refundMaterials,
        changedStructuralCells,
        removedCells,
        renamedOnlyCells,
        hasChanges: changedStructuralCells > 0 || removedCells > 0 || renamedOnlyCells > 0,
        durationMs
    };
}

async function getLandDepotMap(conn, landId) {
    const [rows] = await conn.execute(
        `SELECT item_id, quantity FROM land_material_depots WHERE land_id = ? AND quantity > 0`,
        [landId]
    );
    const map = {};
    for (const r of rows) {
        map[r.item_id] = Number(r.quantity || 0);
    }
    return map;
}

async function getActiveConstructionProject(conn, landId, forUpdate = false) {
    const lock = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await conn.execute(
        `SELECT * FROM construction_projects
         WHERE land_id = ? AND status IN ('funding', 'building')
         ORDER BY id DESC LIMIT 1${lock}`,
        [landId]
    );
    return rows[0] || null;
}

async function creditDepotItems(conn, landId, itemsMap) {
    for (const [itemId, qty] of Object.entries(itemsMap || {})) {
        const addQty = Math.floor(Number(qty || 0));
        if (addQty <= 0) continue;
        await conn.execute(
            `INSERT INTO land_material_depots (land_id, item_id, quantity)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
            [landId, itemId, addQty]
        );
    }
}

async function applyDraftToActive(conn, landId, now = Date.now()) {
    await conn.execute(`DELETE FROM land_grid_cells WHERE land_id = ? AND layout_state = 'active'`, [landId]);
    const [insRes] = await conn.execute(
        `INSERT INTO land_grid_cells
         (land_id, layout_state, floor_level, x, y, zone_group_id, zone_name, module_id, material_id, block_kind, shape_variant, color_hex, meta_json)
         SELECT land_id, 'active', floor_level, x, y, zone_group_id, zone_name, module_id, material_id, block_kind, shape_variant, color_hex, meta_json
         FROM land_grid_cells
         WHERE land_id = ? AND layout_state = 'draft'`,
        [landId]
    );

    await conn.execute(`DELETE FROM land_floor_cells WHERE land_id = ? AND layout_state = 'active'`, [landId]);
    const [insFloor] = await conn.execute(
        `INSERT INTO land_floor_cells
         (land_id, layout_state, floor_level, x, y, floor_material_id, roof_variant, color_hex, is_pillar)
         SELECT land_id, 'active', floor_level, x, y, floor_material_id, roof_variant, color_hex, is_pillar
         FROM land_floor_cells
         WHERE land_id = ? AND layout_state = 'draft'`,
        [landId]
    );

    await conn.execute(`DELETE FROM land_wall_edges WHERE land_id = ? AND layout_state = 'active'`, [landId]);
    const [insWall] = await conn.execute(
        `INSERT INTO land_wall_edges
         (land_id, layout_state, floor_level, orientation, gx, gy, edge_type, material_id, color_hex)
         SELECT land_id, 'active', floor_level, orientation, gx, gy, edge_type, material_id, color_hex
         FROM land_wall_edges
         WHERE land_id = ? AND layout_state = 'draft'`,
        [landId]
    );

    const hasActive =
        Number(insRes?.affectedRows || 0) > 0 ||
        Number(insFloor?.affectedRows || 0) > 0 ||
        Number(insWall?.affectedRows || 0) > 0;
    await conn.execute(
        `UPDATE player_lands
         SET building_state = ?,
             last_condition_tick_at = CASE WHEN last_condition_tick_at = 0 THEN ? ELSE last_condition_tick_at END,
             updated_at = ?
         WHERE id = ?`,
        [hasActive ? 'active' : 'empty', now, now, landId]
    );

    const land = await getLandById(conn, landId, false);
    if (land) {
        await syncLandRooms(conn, landId, Number(land.width || 4), Number(land.height || 4));
    }
}

/**
 * Lazy-sync: menyelesaikan proyek konstruksi jika waktunya sudah lewat.
 */
async function syncLandConstruction(conn, landId, now = Date.now()) {
    const proj = await getActiveConstructionProject(conn, landId, true);
    if (!proj || proj.status !== 'building') return { completed: false, project: proj };
    if (now < Number(proj.finishes_at || 0)) {
        return { completed: false, project: proj };
    }

    await applyDraftToActive(conn, landId, now);
    await conn.execute(
        `UPDATE construction_projects SET status = 'completed' WHERE id = ?`,
        [proj.id]
    );
    return {
        completed: true,
        project: { ...proj, status: 'completed' }
    };
}

async function assertEditableLand(conn, discordId, landId, now = Date.now()) {
    const land = await getLandById(conn, landId, true);
    if (!land || land.discord_id !== discordId) {
        return { ok: false, error: 'Kavling tidak ditemukan atau bukan milikmu.' };
    }
    if (land.building_state === 'collapsed') {
        return { ok: false, error: 'Bangunan ini sedang **Runtuh (Collapsed)**! Buka `/property` -> **Bersihkan Puing** terlebih dahulu sebelum membangun ulang.' };
    }
    await syncLandConstruction(conn, landId, now);
    const activeProj = await getActiveConstructionProject(conn, landId, true);
    if (activeProj && activeProj.status === 'building') {
        const remSec = Math.max(1, Math.ceil((Number(activeProj.finishes_at) - now) / 1000));
        return {
            ok: false,
            error: `Proyek konstruksi sedang berjalan (sisa **${remSec} detik**). Selesaikan atau percepat terlebih dahulu sebelum mengubah blueprint.`
        };
    }
    return { ok: true, land, activeProj };
}

async function applyAreaToDraft(conn, discordId, landId, {
    floorLevel = 1,
    areaInput,
    moduleId,
    materialId,
    zoneName = null,
    colorHex = null
}, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;
    const land = gate.land;

    const parsed = parseGridAreaInput(areaInput, Number(land.width), Number(land.height));
    if (!parsed.ok) return parsed;

    const check = validateCellPlacement(materialId, floorLevel, moduleId);
    if (!check.ok) return { ok: false, error: check.error };

    await ensureDraftInitialized(conn, landId);

    const mod = check.module;
    const mat = check.material;
    const blockKind = mod.blockKind || 'module';
    const shapeVariant = mod.shapeVariant || null;
    const finalName = String(zoneName || mod.name).trim().slice(0, 64) || mod.name;
    const finalColor = colorHex || mod.defaultColor || mat.colorHex;
    const zoneGroupId = makeZoneGroupId('z');

    for (const cell of parsed.cells) {
        await conn.execute(
            `INSERT INTO land_grid_cells
             (land_id, layout_state, floor_level, x, y, zone_group_id, zone_name, module_id, material_id, block_kind, shape_variant, color_hex, meta_json)
             VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
             ON DUPLICATE KEY UPDATE
               zone_group_id = VALUES(zone_group_id),
               zone_name = VALUES(zone_name),
               module_id = VALUES(module_id),
               material_id = VALUES(material_id),
               block_kind = VALUES(block_kind),
               shape_variant = VALUES(shape_variant),
               color_hex = VALUES(color_hex)`,
            [landId, Number(floorLevel), cell.x, cell.y, zoneGroupId, finalName, mod.id, mat.id, blockKind, shapeVariant, finalColor]
        );
    }

    return {
        ok: true,
        paintedCount: parsed.cells.length,
        zoneName: finalName,
        module: mod,
        material: mat,
        warning: check.warning || null,
        coords: parsed.cells.map(c => c.coord)
    };
}

async function clearAreaFromDraft(conn, discordId, landId, floorLevel, areaInput, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;

    const parsed = parseGridAreaInput(areaInput, Number(gate.land.width), Number(gate.land.height));
    if (!parsed.ok) return parsed;

    await ensureDraftInitialized(conn, landId);

    let removed = 0;
    for (const cell of parsed.cells) {
        const [res] = await conn.execute(
            `DELETE FROM land_grid_cells
             WHERE land_id = ? AND layout_state = 'draft' AND floor_level = ? AND x = ? AND y = ?`,
            [landId, Number(floorLevel), cell.x, cell.y]
        );
        removed += Number(res.affectedRows || 0);
    }

    return { ok: true, removedCount: removed };
}

async function applyTemplateToDraft(conn, discordId, landId, templateId, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;
    const land = gate.land;

    const tpl = getStarterTemplate(templateId);
    if (!tpl) return { ok: false, error: 'Template tidak ditemukan.' };
    if (Number(land.width) < tpl.minWidth || Number(land.height) < tpl.minHeight) {
        return {
            ok: false,
            error: `Template **${tpl.name}** membutuhkan minimal kavling **${tpl.minWidth}×${tpl.minHeight}**.`
        };
    }

    await conn.execute(`DELETE FROM land_grid_cells WHERE land_id = ? AND layout_state = 'draft'`, [landId]);
    await conn.execute(`DELETE FROM land_floor_cells WHERE land_id = ? AND layout_state = 'draft'`, [landId]);
    await conn.execute(`DELETE FROM land_wall_edges WHERE land_id = ? AND layout_state = 'draft'`, [landId]);
    const cells = tpl.buildCells(Number(land.width), Number(land.height));
    for (const raw of cells) {
        const c = normalizeCellRecord(raw);
        if (c.x < 0 || c.y < 0 || c.x >= land.width || c.y >= land.height) continue;
        const mod = getBuildingModule(c.module_id);
        await conn.execute(
            `INSERT INTO land_grid_cells
             (land_id, layout_state, floor_level, x, y, zone_group_id, zone_name, module_id, material_id, block_kind, shape_variant, color_hex, meta_json)
             VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            [landId, c.floor_level, c.x, c.y, c.zone_group_id, c.zone_name, c.module_id, c.material_id, c.block_kind, c.shape_variant, c.color_hex || mod.defaultColor]
        );
    }

    return { ok: true, template: tpl, cellCount: cells.length };
}

/**
 * Menduplikasi seluruh denah lantai sumber (grid + lantai/atap 4-layer + dinding edge) ke lantai tujuan dalam Draft.
 */
async function duplicateFloorToDraft(conn, discordId, landId, fromFloor, toFloor, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;

    const src = Number(fromFloor);
    const dst = Number(toFloor);
    if (!Number.isInteger(dst) || dst < -1 || dst === 0 || dst > 100) {
        return { ok: false, error: 'Lantai tujuan tidak valid (gunakan -1 untuk B1 atau 1–100).' };
    }
    if (src === dst) {
        return { ok: false, error: 'Lantai sumber dan tujuan tidak boleh sama.' };
    }

    await ensureDraftInitialized(conn, landId);
    const srcCells = await getLandCells(conn, landId, 'draft', src);
    const srcFloors = await getLandFloorCells(conn, landId, 'draft', src);
    const srcWalls = await getLandWallEdges(conn, landId, 'draft', src);

    if (srcCells.length === 0 && srcFloors.length === 0 && srcWalls.length === 0) {
        return { ok: false, error: `Lantai sumber **${getFloorLabel(src)}** masih kosong di draft.` };
    }

    for (const raw of srcCells) {
        const check = validateCellPlacement(raw.material_id, dst, raw.module_id);
        if (!check.ok) {
            return { ok: false, error: `Tidak dapat menyalin ke ${getFloorLabel(dst)}: ${check.error}` };
        }
    }
    for (const rf of srcFloors) {
        const structMat = getStructuralMaterial(rf.floor_material_id || 'kayu');
        if (dst < 0 && !structMat.allowBasement) {
            return { ok: false, error: `Lantai material **${rf.floor_material_id}** tidak diizinkan untuk Basement.` };
        }
    }

    await conn.execute(
        `DELETE FROM land_grid_cells WHERE land_id = ? AND layout_state = 'draft' AND floor_level = ?`,
        [landId, dst]
    );
    await conn.execute(
        `DELETE FROM land_floor_cells WHERE land_id = ? AND layout_state = 'draft' AND floor_level = ?`,
        [landId, dst]
    );
    await conn.execute(
        `DELETE FROM land_wall_edges WHERE land_id = ? AND layout_state = 'draft' AND floor_level = ?`,
        [landId, dst]
    );

    const remapGroup = new Map();
    for (const raw of srcCells) {
        const c = normalizeCellRecord(raw);
        if (!remapGroup.has(c.zone_group_id)) {
            remapGroup.set(c.zone_group_id, makeZoneGroupId('dup'));
        }
        await conn.execute(
            `INSERT INTO land_grid_cells
             (land_id, layout_state, floor_level, x, y, zone_group_id, zone_name, module_id, material_id, block_kind, shape_variant, color_hex, meta_json)
             VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [landId, dst, c.x, c.y, remapGroup.get(c.zone_group_id), c.zone_name, c.module_id, c.material_id, c.block_kind, c.shape_variant, c.color_hex, c.meta_json]
        );
    }

    for (const rf of srcFloors) {
        await conn.execute(
            `INSERT INTO land_floor_cells
             (land_id, layout_state, floor_level, x, y, floor_material_id, roof_variant, color_hex, is_pillar)
             VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
            [landId, dst, Number(rf.x), Number(rf.y), rf.floor_material_id || 'kayu', rf.roof_variant || null, rf.color_hex || null, Number(rf.is_pillar || 0)]
        );
    }

    for (const rw of srcWalls) {
        await conn.execute(
            `INSERT INTO land_wall_edges
             (land_id, layout_state, floor_level, orientation, gx, gy, edge_type, material_id, color_hex)
             VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
            [landId, dst, rw.orientation, Number(rw.gx), Number(rw.gy), rw.edge_type || 'wall', rw.material_id || 'bata', rw.color_hex || null]
        );
    }

    return {
        ok: true,
        fromFloor: src,
        toFloor: dst,
        copiedCount: srcCells.length + srcFloors.length,
        copiedWalls: srcWalls.length
    };
}

async function upsertWallEdgesDraft(conn, landId, floorLevel, edges, edgeType = 'wall', materialId = 'bata', colorHex = null) {
    const wType = getWallEdgeType(edgeType);
    const finalColor = colorHex || wType.colorHex;
    for (const edge of edges) {
        await conn.execute(
            `INSERT INTO land_wall_edges
             (land_id, layout_state, floor_level, orientation, gx, gy, edge_type, material_id, color_hex)
             VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               edge_type = VALUES(edge_type),
               material_id = VALUES(material_id),
               color_hex = VALUES(color_hex)`,
            [landId, Number(floorLevel), edge.orientation, Number(edge.gx), Number(edge.gy), wType.id, materialId || 'bata', finalColor]
        );
    }
    return wType;
}

async function applyFloorAreaToDraft(conn, discordId, landId, {
    floorLevel = 1,
    areaInput,
    floorMaterialId = 'kayu',
    isPillar = false,
    colorHex = null
}, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;
    const land = gate.land;

    const fl = Number(floorLevel);
    if (!Number.isInteger(fl) || fl < -1 || fl === 0 || fl > 100) {
        return { ok: false, error: 'Nomor lantai tidak valid (gunakan -1 untuk B1 atau 1–100).' };
    }

    const parsed = parseGridAreaInput(areaInput, Number(land.width), Number(land.height));
    if (!parsed.ok) return parsed;

    const fMat = getFloorMaterial(floorMaterialId);
    const structMat = getStructuralMaterial(fMat.id);
    if (fl < 0 && !structMat.allowBasement) {
        return { ok: false, error: `Material lantai **${fMat.name}** tidak tahan lembap untuk Basement (gunakan Beton, Baja, Bata, atau Marmer).` };
    }

    await ensureDraftInitialized(conn, landId);
    const finalColor = colorHex || fMat.colorHex;
    const pillarVal = isPillar ? 1 : 0;

    for (const cell of parsed.cells) {
        await conn.execute(
            `INSERT INTO land_floor_cells
             (land_id, layout_state, floor_level, x, y, floor_material_id, roof_variant, color_hex, is_pillar)
             VALUES (?, 'draft', ?, ?, ?, ?, NULL, ?, ?)
             ON DUPLICATE KEY UPDATE
               floor_material_id = VALUES(floor_material_id),
               color_hex = VALUES(color_hex),
               is_pillar = VALUES(is_pillar)`,
            [landId, fl, cell.x, cell.y, fMat.id, finalColor, pillarVal]
        );
    }

    return {
        ok: true,
        paintedCount: parsed.cells.length,
        floorMaterial: fMat,
        isPillar: Boolean(pillarVal),
        coords: parsed.cells.map(c => c.coord)
    };
}

async function clearFloorAreaFromDraft(conn, discordId, landId, floorLevel, areaInput, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;

    const parsed = parseGridAreaInput(areaInput, Number(gate.land.width), Number(gate.land.height));
    if (!parsed.ok) return parsed;

    await ensureDraftInitialized(conn, landId);
    let removed = 0;
    for (const cell of parsed.cells) {
        const [res] = await conn.execute(
            `DELETE FROM land_floor_cells
             WHERE land_id = ? AND layout_state = 'draft' AND floor_level = ? AND x = ? AND y = ?`,
            [landId, Number(floorLevel), cell.x, cell.y]
        );
        removed += Number(res.affectedRows || 0);
    }

    return { ok: true, removedCount: removed };
}

async function applyPerimeterWallsToDraft(conn, discordId, landId, {
    floorLevel = 1,
    areaInput,
    edgeType = 'wall',
    materialId = 'bata',
    colorHex = null
}, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;
    const land = gate.land;

    const fl = Number(floorLevel);
    if (!Number.isInteger(fl) || fl < -1 || fl === 0 || fl > 100) {
        return { ok: false, error: 'Nomor lantai tidak valid.' };
    }

    const parsed = parseAreaPerimeterWalls(areaInput, Number(land.width), Number(land.height));
    if (!parsed.ok) return parsed;

    await ensureDraftInitialized(conn, landId);
    const wType = await upsertWallEdgesDraft(conn, landId, fl, parsed.edges, edgeType, materialId, colorHex);
    return {
        ok: true,
        edgeCount: parsed.edges.length,
        wallType: wType,
        edges: parsed.edges
    };
}

async function applyLineWallsToDraft(conn, discordId, landId, {
    floorLevel = 1,
    lineInput,
    edgeType = 'wall',
    materialId = 'bata',
    colorHex = null
}, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;
    const land = gate.land;

    const fl = Number(floorLevel);
    if (!Number.isInteger(fl) || fl < -1 || fl === 0 || fl > 100) {
        return { ok: false, error: 'Nomor lantai tidak valid.' };
    }

    const parsed = parseLineWallInput(lineInput, Number(land.width), Number(land.height));
    if (!parsed.ok) return parsed;

    await ensureDraftInitialized(conn, landId);
    const wType = await upsertWallEdgesDraft(conn, landId, fl, parsed.edges, edgeType, materialId, colorHex);
    return {
        ok: true,
        edgeCount: parsed.edges.length,
        wallType: wType,
        side: parsed.side,
        edges: parsed.edges
    };
}

async function clearWallEdgesFromDraft(conn, discordId, landId, {
    floorLevel = 1,
    lineInput = null,
    areaInput = null
}, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;
    const land = gate.land;

    let edgesToClear = [];
    if (lineInput && String(lineInput).trim()) {
        const parsedLine = parseLineWallInput(lineInput, Number(land.width), Number(land.height));
        if (parsedLine.ok) {
            edgesToClear = parsedLine.edges;
        } else if (!areaInput) {
            const parsedPerim = parseAreaPerimeterWalls(lineInput, Number(land.width), Number(land.height));
            if (!parsedPerim.ok) return parsedLine;
            edgesToClear = parsedPerim.edges;
        } else {
            return parsedLine;
        }
    } else if (areaInput && String(areaInput).trim()) {
        const parsedPerim = parseAreaPerimeterWalls(areaInput, Number(land.width), Number(land.height));
        if (!parsedPerim.ok) return parsedPerim;
        edgesToClear = parsedPerim.edges;
    } else {
        return { ok: false, error: 'Masukkan garis dinding (mis. `A1:C1 S`) atau area perimeter (mis. `A1:B2`).' };
    }

    await ensureDraftInitialized(conn, landId);
    let removed = 0;
    for (const edge of edgesToClear) {
        const [res] = await conn.execute(
            `DELETE FROM land_wall_edges
             WHERE land_id = ? AND layout_state = 'draft' AND floor_level = ? AND orientation = ? AND gx = ? AND gy = ?`,
            [landId, Number(floorLevel), edge.orientation, Number(edge.gx), Number(edge.gy)]
        );
        removed += Number(res.affectedRows || 0);
    }

    return { ok: true, removedCount: removed };
}

async function applyRoofAreaToDraft(conn, discordId, landId, {
    floorLevel = 1,
    areaInput,
    roofVariant = 'gable',
    defaultFloorMaterialId = 'beton'
}, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;
    const land = gate.land;

    const fl = Number(floorLevel);
    if (!Number.isInteger(fl) || fl < -1 || fl === 0 || fl > 100) {
        return { ok: false, error: 'Nomor lantai tidak valid.' };
    }

    const parsed = parseGridAreaInput(areaInput, Number(land.width), Number(land.height));
    if (!parsed.ok) return parsed;

    const rVar = getRoofVariant(roofVariant);
    const fMat = getFloorMaterial(defaultFloorMaterialId);
    await ensureDraftInitialized(conn, landId);

    for (const cell of parsed.cells) {
        await conn.execute(
            `INSERT INTO land_floor_cells
             (land_id, layout_state, floor_level, x, y, floor_material_id, roof_variant, color_hex, is_pillar)
             VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, 0)
             ON DUPLICATE KEY UPDATE
               roof_variant = VALUES(roof_variant)`,
            [landId, fl, cell.x, cell.y, fMat.id, rVar.id, fMat.colorHex]
        );
    }

    return {
        ok: true,
        paintedCount: parsed.cells.length,
        roofVariant: rVar,
        coords: parsed.cells.map(c => c.coord)
    };
}

/**
 * Mengaplikasikan Sketsa ASCII multi-baris (kode karakter #, +, G, P, B, R, ., dll.) ke satu lantai Draft.
 */
async function applyAsciiSketchToDraft(conn, discordId, landId, {
    floorLevel = 1,
    asciiText,
    defaultModuleId = 'wall_custom',
    materialId = 'beton'
}, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;
    const land = gate.land;

    const parsed = parseAsciiFloorPattern(asciiText, Number(land.width), Number(land.height), defaultModuleId);
    if (!parsed.ok) return parsed;

    await ensureDraftInitialized(conn, landId);

    for (const entry of parsed.entries) {
        const check = validateCellPlacement(materialId, floorLevel, entry.moduleId);
        if (!check.ok) return { ok: false, error: check.error };
    }

    await conn.execute(
        `DELETE FROM land_grid_cells WHERE land_id = ? AND layout_state = 'draft' AND floor_level = ?`,
        [landId, Number(floorLevel)]
    );

    const groupByMod = new Map();
    for (const entry of parsed.entries) {
        if (!groupByMod.has(entry.moduleId)) {
            groupByMod.set(entry.moduleId, makeZoneGroupId('sk'));
        }
        const mod = getBuildingModule(entry.moduleId);
        await conn.execute(
            `INSERT INTO land_grid_cells
             (land_id, layout_state, floor_level, x, y, zone_group_id, zone_name, module_id, material_id, block_kind, shape_variant, color_hex, meta_json)
             VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            [
                landId,
                Number(floorLevel),
                entry.x,
                entry.y,
                groupByMod.get(entry.moduleId),
                mod.name,
                mod.id,
                materialId,
                mod.blockKind || 'module',
                mod.shapeVariant || null,
                mod.defaultColor || null
            ]
        );
    }

    return {
        ok: true,
        floorLevel: Number(floorLevel),
        paintedCount: parsed.entries.length
    };
}

async function demolishActiveArea(conn, discordId, landId, floorLevel, areaInput = null, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;
    const land = gate.land;

    const flFilter = areaInput ? floorLevel : null;
    const activeCells = await getLandCells(conn, landId, 'active', flFilter);
    const activeFloors = await getLandFloorCells(conn, landId, 'active', flFilter);
    const activeWalls = await getLandWallEdges(conn, landId, 'active', flFilter);

    if (activeCells.length === 0 && activeFloors.length === 0 && activeWalls.length === 0) {
        return { ok: false, error: 'Tidak ada bangunan aktif untuk dibongkar di area tersebut.' };
    }

    let targets = activeCells;
    let floorTargets = activeFloors;
    let wallTargets = activeWalls;
    if (areaInput) {
        const parsed = parseGridAreaInput(areaInput, Number(land.width), Number(land.height));
        if (!parsed.ok) return parsed;
        const targetSet = new Set(parsed.cells.map(c => `${c.x}:${c.y}`));
        targets = activeCells.filter(c => targetSet.has(`${c.x}:${c.y}`));
        floorTargets = activeFloors.filter(f => targetSet.has(`${Number(f.x)}:${Number(f.y)}`));

        const perimParsed = parseAreaPerimeterWalls(areaInput, Number(land.width), Number(land.height));
        const edgeKeySet = new Set(perimParsed.ok ? perimParsed.edges.map(e => `${e.orientation}:${e.gx}:${e.gy}`) : []);
        wallTargets = activeWalls.filter(w => edgeKeySet.has(`${w.orientation}:${Number(w.gx)}:${Number(w.gy)}`));

        if (targets.length === 0 && floorTargets.length === 0 && wallTargets.length === 0) {
            return { ok: false, error: 'Area koordinat tersebut tidak memiliki sel atau dinding aktif.' };
        }
    }

    const condPct = Math.max(0, Math.min(100, Number(land.condition_pct ?? 100)));
    const refundRatio = 0.50 + 0.20 * (condPct / 100);
    const rawMats = {};
    const gridTargetKeys = new Set();

    for (const cell of targets) {
        gridTargetKeys.add(`${Number(cell.floor_level)}:${Number(cell.x)}:${Number(cell.y)}`);
        const cellMats = getCellMaterialsMap(cell);
        for (const [itemId, qty] of Object.entries(cellMats)) {
            rawMats[itemId] = (rawMats[itemId] || 0) + qty;
        }
        await conn.execute(`DELETE FROM land_grid_cells WHERE id = ?`, [cell.id]);
        await conn.execute(
            `DELETE FROM land_grid_cells WHERE land_id = ? AND layout_state = 'draft' AND floor_level = ? AND x = ? AND y = ?`,
            [landId, cell.floor_level, cell.x, cell.y]
        );
    }

    for (const fc of floorTargets) {
        const fKey = `${Number(fc.floor_level)}:${Number(fc.x)}:${Number(fc.y)}`;
        if (!gridTargetKeys.has(fKey)) {
            const floorMats = getFloorCellMaterialsMap(fc);
            for (const [itemId, qty] of Object.entries(floorMats)) {
                rawMats[itemId] = (rawMats[itemId] || 0) + qty;
            }
        }
        await conn.execute(`DELETE FROM land_floor_cells WHERE id = ?`, [fc.id]);
        await conn.execute(
            `DELETE FROM land_floor_cells WHERE land_id = ? AND layout_state = 'draft' AND floor_level = ? AND x = ? AND y = ?`,
            [landId, fc.floor_level, fc.x, fc.y]
        );
    }

    for (const we of wallTargets) {
        const wallMats = getWallEdgeMaterialsMap(we);
        for (const [itemId, qty] of Object.entries(wallMats)) {
            rawMats[itemId] = (rawMats[itemId] || 0) + qty;
        }
        await conn.execute(`DELETE FROM land_wall_edges WHERE id = ?`, [we.id]);
        await conn.execute(
            `DELETE FROM land_wall_edges WHERE land_id = ? AND layout_state = 'draft' AND floor_level = ? AND orientation = ? AND gx = ? AND gy = ?`,
            [landId, we.floor_level, we.orientation, we.gx, we.gy]
        );
    }

    const refunded = {};
    for (const [itemId, qty] of Object.entries(rawMats)) {
        const ref = Math.floor(qty * refundRatio);
        if (ref > 0) refunded[itemId] = ref;
    }

    await creditDepotItems(conn, landId, refunded);
    await syncLandRooms(conn, landId, Number(land.width || 4), Number(land.height || 4));
    await conn.execute(`UPDATE player_lands SET updated_at = ? WHERE id = ?`, [now, landId]);

    return {
        ok: true,
        demolishedCount: targets.length + floorTargets.length + wallTargets.length,
        refundRatioPct: Math.round(refundRatio * 100),
        refunded
    };
}

/**
 * Menyetor material bangunan dari Tas (dan opsional Gudang lokal) ke Gudang Proyek Tanah.
 */
async function depositMaterialsToDepot(conn, discordId, landId, onlyNeededForRab = true, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;

    const draftCells = await getLandCells(conn, landId, 'draft');
    const activeCells = await getLandCells(conn, landId, 'active');
    const rab = calculateConstructionRab(draftCells, activeCells, gate.land.condition_pct);
    const depot = await getLandDepotMap(conn, landId);

    const bagRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
    const gudangRows = await getPlayerInventory(conn, discordId, true, 'gudang', now, landId);
    const allSources = [...bagRows, ...gudangRows];

    const availableByItem = {};
    for (const row of allSources) {
        const it = getItem(row.item_id);
        if (!it || !it.tags) continue;
        const isBuildMat = it.tags.includes('building_material') || ['batu_kapur', 'batubara', 'bijih_besi', 'kuarsa', 'bijih_tembaga', 'sampah_besi', 'sampah_kardus'].includes(it.id);
        if (!isBuildMat) continue;
        availableByItem[row.item_id] = (availableByItem[row.item_id] || 0) + Number(row.quantity || 0);
    }

    const deposited = {};
    const entries = onlyNeededForRab
        ? Object.entries(rab.requiredMaterials)
        : Object.entries(availableByItem);

    for (const [itemId, targetQty] of entries) {
        const currentInDepot = Number(depot[itemId] || 0);
        const maxTransfer = onlyNeededForRab ? Math.max(0, Number(targetQty) - currentInDepot) : Number(availableByItem[itemId] || 0);
        if (maxTransfer <= 0) continue;

        let remainingNeed = Math.min(maxTransfer, Number(availableByItem[itemId] || 0));
        if (remainingNeed <= 0) continue;

        // Ambil dari bag dulu, sisanya dari gudang lokal tanah
        const bagAvail = bagRows.filter(r => r.item_id === itemId).reduce((s, r) => s + Number(r.quantity), 0);
        const takeBag = Math.min(remainingNeed, bagAvail);
        if (takeBag > 0) {
            await removeItem(conn, discordId, itemId, takeBag, 'bag');
            remainingNeed -= takeBag;
            deposited[itemId] = (deposited[itemId] || 0) + takeBag;
        }
        if (remainingNeed > 0) {
            const gudangAvail = gudangRows.filter(r => r.item_id === itemId).reduce((s, r) => s + Number(r.quantity), 0);
            const takeGudang = Math.min(remainingNeed, gudangAvail);
            if (takeGudang > 0) {
                await removeItem(conn, discordId, itemId, takeGudang, 'gudang', landId);
                deposited[itemId] = (deposited[itemId] || 0) + takeGudang;
            }
        }
    }

    if (Object.keys(deposited).length > 0) {
        await creditDepotItems(conn, landId, deposited);
    }

    const updatedDepot = await getLandDepotMap(conn, landId);
    return {
        ok: true,
        deposited,
        depot: updatedDepot,
        rab
    };
}

async function withdrawMaterialsFromDepot(conn, discordId, landId, itemId, quantity, maxSlots, now = Date.now()) {
    const land = await getLandById(conn, landId, true);
    if (!land || land.discord_id !== discordId) {
        return { ok: false, error: 'Kavling tidak ditemukan.' };
    }
    const qty = Math.floor(Number(quantity || 0));
    if (qty <= 0) return { ok: false, error: 'Jumlah tarik harus > 0.' };

    const [rows] = await conn.execute(
        `SELECT quantity FROM land_material_depots WHERE land_id = ? AND item_id = ? FOR UPDATE`,
        [landId, itemId]
    );
    const cur = Number(rows[0]?.quantity || 0);
    if (cur < qty) {
        return { ok: false, error: 'Stok bahan di Gudang Proyek tidak mencukupi.' };
    }

    const bagRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
    if (!canFitItems(bagRows, maxSlots, [{ itemId, qty }])) {
        return { ok: false, error: 'Tas (/inventory) penuh! Kosongkan tas terlebih dahulu.' };
    }

    if (cur === qty) {
        await conn.execute(`DELETE FROM land_material_depots WHERE land_id = ? AND item_id = ?`, [landId, itemId]);
    } else {
        await conn.execute(`UPDATE land_material_depots SET quantity = quantity - ? WHERE land_id = ? AND item_id = ?`, [qty, landId, itemId]);
    }
    await addItem(conn, discordId, itemId, qty, now, 'bag');
    return { ok: true, itemId, qty };
}

async function startConstruction(conn, discordId, landId, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;

    await ensureDraftInitialized(conn, landId);
    const draftCells = await getLandCells(conn, landId, 'draft');
    const activeCells = await getLandCells(conn, landId, 'active');

    const rab = calculateConstructionRab(draftCells, activeCells, gate.land.condition_pct);
    if (!rab.ok) {
        return { ok: false, error: `Blueprint melanggar batas struktur:\n${rab.validationErrors.slice(0, 4).join('\n')}` };
    }
    if (!rab.hasChanges) {
        return { ok: false, error: 'Belum ada perubahan blueprint dibandingkan bangunan aktif saat ini.' };
    }

    // Jika hanya ubah nama ruangan / warna tanpa perubahan fisik sel -> langsung terapkan gratis
    if (rab.changedStructuralCells === 0 && rab.removedCells === 0) {
        await applyDraftToActive(conn, landId, now);
        return { ok: true, instant: true, message: 'Perubahan penamaan & tata warna zona langsung diterapkan!', finishesAt: now };
    }

    const depot = await getLandDepotMap(conn, landId);
    const missing = {};
    for (const [itemId, need] of Object.entries(rab.requiredMaterials)) {
        const have = Number(depot[itemId] || 0);
        if (have < need) missing[itemId] = need - have;
    }

    const activeHasAny =
        activeCells.length > 0 ||
        (activeCells._archData?.floorCells?.length || 0) > 0 ||
        (activeCells._archData?.wallEdges?.length || 0) > 0;

    if (Object.keys(missing).length > 0) {
        if (gate.activeProj && gate.activeProj.status === 'funding') {
            await conn.execute(
                `UPDATE construction_projects SET required_materials_json = ? WHERE id = ?`,
                [JSON.stringify(rab.requiredMaterials), gate.activeProj.id]
            );
        } else {
            await conn.execute(
                `INSERT INTO construction_projects (land_id, discord_id, project_type, status, required_materials_json, started_at, finishes_at, worker_boost_ms, created_at)
                 VALUES (?, ?, ?, 'funding', ?, 0, 0, 0, ?)`,
                [landId, discordId, activeHasAny ? 'renovate' : 'build', JSON.stringify(rab.requiredMaterials), now]
            );
        }
        return { ok: false, status: 'funding', missing, depot, rab, error: 'Bahan di Gudang Proyek belum lengkap 100%.' };
    }

    // Konsumsi bahan dari Gudang Proyek
    for (const [itemId, need] of Object.entries(rab.requiredMaterials)) {
        if (need <= 0) continue;
        await conn.execute(
            `UPDATE land_material_depots SET quantity = quantity - ? WHERE land_id = ? AND item_id = ?`,
            [need, landId, itemId]
        );
    }
    await conn.execute(`DELETE FROM land_material_depots WHERE land_id = ? AND quantity <= 0`, [landId]);

    // Refund sel aktif yang digantikan jika renovasi
    if (Object.keys(rab.refundMaterials).length > 0) {
        await creditDepotItems(conn, landId, rab.refundMaterials);
    }

    if (rab.durationMs <= 0) {
        await applyDraftToActive(conn, landId, now);
        return { ok: true, instant: true, finishesAt: now, rab };
    }

    const finishesAt = now + rab.durationMs;
    if (gate.activeProj && gate.activeProj.status === 'funding') {
        await conn.execute(
            `UPDATE construction_projects
             SET status = 'building', required_materials_json = ?, started_at = ?, finishes_at = ?, worker_boost_ms = 0
             WHERE id = ?`,
            [JSON.stringify(rab.requiredMaterials), now, finishesAt, gate.activeProj.id]
        );
    } else {
        await conn.execute(
            `INSERT INTO construction_projects (land_id, discord_id, project_type, status, required_materials_json, started_at, finishes_at, worker_boost_ms, created_at)
             VALUES (?, ?, ?, 'building', ?, ?, ?, 0, ?)`,
            [landId, discordId, activeHasAny ? 'renovate' : 'build', JSON.stringify(rab.requiredMaterials), now, finishesAt, now]
        );
    }

    return {
        ok: true,
        instant: false,
        startedAt: now,
        finishesAt,
        durationMs: rab.durationMs,
        rab
    };
}

async function boostConstructionWithEnergy(conn, discordId, landId, now = Date.now()) {
    const syncRes = await syncLandConstruction(conn, landId, now);
    if (syncRes.completed) {
        return { ok: true, completedNow: true, savedMs: 0, finishesAt: now };
    }
    const proj = await getActiveConstructionProject(conn, landId, true);
    if (!proj || proj.status !== 'building') {
        return { ok: false, error: 'Tidak ada proyek konstruksi aktif di kavling ini.' };
    }
    const [pRows] = await conn.execute(`SELECT energy FROM players WHERE discord_id = ? FOR UPDATE`, [discordId]);
    if (pRows.length === 0) return { ok: false, error: 'Akun tidak ditemukan.' };
    const curEnergy = Number(pRows[0].energy || 0);
    if (curEnergy < ENERGY_BOOST_COST) {
        return { ok: false, error: `Energi kurang untuk ikut membangun (Butuh **${ENERGY_BOOST_COST} Energy**).` };
    }

    const remainingMs = Math.max(0, Number(proj.finishes_at) - now);
    const savedMs = remainingMs <= 30000 ? remainingMs : Math.max(15000, Math.round(remainingMs * 0.20));
    const nextFinish = Math.max(now, Number(proj.finishes_at) - savedMs);

    await conn.execute(`UPDATE players SET energy = GREATEST(0, energy - ?) WHERE discord_id = ?`, [ENERGY_BOOST_COST, discordId]);
    await conn.execute(
        `UPDATE construction_projects SET finishes_at = ?, worker_boost_ms = worker_boost_ms + ? WHERE id = ?`,
        [nextFinish, savedMs, proj.id]
    );

    const postSync = await syncLandConstruction(conn, landId, now);
    return {
        ok: true,
        completedNow: postSync.completed,
        savedMs,
        finishesAt: nextFinish,
        energyCost: ENERGY_BOOST_COST
    };
}

async function hireNpcContractorBoost(conn, discordId, landId, now = Date.now()) {
    const syncRes = await syncLandConstruction(conn, landId, now);
    if (syncRes.completed) {
        return { ok: true, completedNow: true, savedMs: 0, fee: 0, finishesAt: now };
    }
    const proj = await getActiveConstructionProject(conn, landId, true);
    if (!proj || proj.status !== 'building') {
        return { ok: false, error: 'Tidak ada proyek konstruksi aktif di kavling ini.' };
    }

    const remainingMs = Math.max(0, Number(proj.finishes_at) - now);
    const mins = Math.max(1, Math.ceil(remainingMs / 60000));
    const fee = Math.max(25000, mins * 3500);

    const [pRows] = await conn.execute(`SELECT * FROM players WHERE discord_id = ? FOR UPDATE`, [discordId]);
    if (pRows.length === 0) return { ok: false, error: 'Akun tidak ditemukan.' };
    try {
        await debitPlayerFunds(conn, pRows[0], fee, 'construction_contractor', { landId }, now);
    } catch (err) {
        if (err.message === 'INSUFFICIENT_FUNDS') {
            return { ok: false, error: `Saldo tidak cukup untuk menyewa Kontraktor Ekspres (Biaya **Lp ${fee.toLocaleString('id-ID')}**).` };
        }
        throw err;
    }

    const savedMs = remainingMs <= 60000 ? remainingMs : Math.round(remainingMs * 0.45);
    const nextFinish = Math.max(now, Number(proj.finishes_at) - savedMs);
    await conn.execute(
        `UPDATE construction_projects SET finishes_at = ?, worker_boost_ms = worker_boost_ms + ? WHERE id = ?`,
        [nextFinish, savedMs, proj.id]
    );

    const postSync = await syncLandConstruction(conn, landId, now);
    return {
        ok: true,
        completedNow: postSync.completed,
        savedMs,
        fee,
        finishesAt: nextFinish
    };
}

async function exportBlueprintCode(conn, discordId, landId, title = null, now = Date.now()) {
    const land = await getLandById(conn, landId);
    if (!land || land.discord_id !== discordId) {
        return { ok: false, error: 'Kavling tidak ditemukan.' };
    }

    let sourceState = 'draft';
    let cells = await getLandCells(conn, landId, 'draft');
    let floorCells = cells._archData?.floorCells || [];
    let wallEdges = cells._archData?.wallEdges || [];
    if (cells.length === 0 && floorCells.length === 0 && wallEdges.length === 0) {
        sourceState = 'active';
        cells = await getLandCells(conn, landId, 'active');
        floorCells = cells._archData?.floorCells || [];
        wallEdges = cells._archData?.wallEdges || [];
    }
    if (cells.length === 0 && floorCells.length === 0 && wallEdges.length === 0) {
        return { ok: false, error: 'Denah masih kosong. Pasang minimal 1 lantai, dinding, atau ruangan sebelum mengekspor kode blueprint.' };
    }

    const compact = cells.map(c => ({
        f: Number(c.floor_level),
        x: Number(c.x),
        y: Number(c.y),
        zg: c.zone_group_id,
        zn: c.zone_name,
        m: c.module_id,
        mat: c.material_id,
        bk: c.block_kind || 'module',
        sv: c.shape_variant || null,
        col: c.color_hex
    }));
    const compactFloors = floorCells.map(fc => ({
        f: Number(fc.floor_level ?? 1),
        x: Number(fc.x),
        y: Number(fc.y),
        mat: fc.floor_material_id || 'kayu',
        rv: fc.roof_variant || null,
        col: fc.color_hex || null,
        pil: Number(fc.is_pillar || 0)
    }));
    const compactWalls = wallEdges.map(we => ({
        f: Number(we.floor_level ?? 1),
        o: we.orientation,
        gx: Number(we.gx),
        gy: Number(we.gy),
        et: we.edge_type || 'wall',
        mat: we.material_id || 'bata',
        col: we.color_hex || null
    }));

    const payload = { v: 2, cells: compact, floors: compactFloors, walls: compactWalls };
    const shareCode = `PROP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const bpTitle = String(title || land.custom_name || 'Blueprint Kustom').slice(0, 64);

    await conn.execute(
        `INSERT INTO property_blueprints (share_code, author_id, title, width, height, theme_id, layout_json, usage_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [shareCode, discordId, bpTitle, land.width, land.height, land.theme_id, JSON.stringify(payload), now]
    );

    return {
        ok: true,
        shareCode,
        title: bpTitle,
        sourceState,
        cellCount: compact.length + compactFloors.length,
        wallCount: compactWalls.length
    };
}

async function importBlueprintCode(conn, discordId, landId, rawCode, now = Date.now()) {
    const gate = await assertEditableLand(conn, discordId, landId, now);
    if (!gate.ok) return gate;
    const land = gate.land;

    const code = String(rawCode || '').trim().toUpperCase();
    const [rows] = await conn.execute(`SELECT * FROM property_blueprints WHERE share_code = ? LIMIT 1`, [code]);
    if (rows.length === 0) {
        return { ok: false, error: `Kode blueprint \`${code}\` tidak ditemukan.` };
    }
    const bp = rows[0];
    if (Number(bp.width) > Number(land.width) || Number(bp.height) > Number(land.height)) {
        return {
            ok: false,
            error: `Blueprint **${bp.title}** berukuran **${bp.width}×${bp.height}**, terlalu besar untuk kavlingmu (**${land.width}×${land.height}**).`
        };
    }

    let parsed;
    try {
        parsed = JSON.parse(bp.layout_json);
    } catch {
        return { ok: false, error: 'Data blueprint rusak.' };
    }

    const legacyCells = Array.isArray(parsed) ? parsed : (parsed?.cells || []);
    const floorList = Array.isArray(parsed) ? [] : (parsed?.floors || []);
    const wallList = Array.isArray(parsed) ? [] : (parsed?.walls || []);

    await conn.execute(`DELETE FROM land_grid_cells WHERE land_id = ? AND layout_state = 'draft'`, [landId]);
    await conn.execute(`DELETE FROM land_floor_cells WHERE land_id = ? AND layout_state = 'draft'`, [landId]);
    await conn.execute(`DELETE FROM land_wall_edges WHERE land_id = ? AND layout_state = 'draft'`, [landId]);

    const w = Number(land.width);
    const h = Number(land.height);
    let importedCount = 0;

    for (const raw of legacyCells) {
        const c = normalizeCellRecord({
            floor_level: raw.f,
            x: raw.x,
            y: raw.y,
            zone_group_id: raw.zg,
            zone_name: raw.zn,
            module_id: raw.m,
            material_id: raw.mat,
            block_kind: raw.bk,
            shape_variant: raw.sv,
            color_hex: raw.col
        });
        if (c.x < 0 || c.y < 0 || c.x >= w || c.y >= h) continue;
        await conn.execute(
            `INSERT IGNORE INTO land_grid_cells
             (land_id, layout_state, floor_level, x, y, zone_group_id, zone_name, module_id, material_id, block_kind, shape_variant, color_hex, meta_json)
             VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            [landId, c.floor_level, c.x, c.y, c.zone_group_id, c.zone_name, c.module_id, c.material_id, c.block_kind, c.shape_variant, c.color_hex]
        );
        importedCount += 1;
    }

    for (const rf of floorList) {
        const fx = Number(rf.x);
        const fy = Number(rf.y);
        if (fx < 0 || fy < 0 || fx >= w || fy >= h) continue;
        await conn.execute(
            `INSERT IGNORE INTO land_floor_cells
             (land_id, layout_state, floor_level, x, y, floor_material_id, roof_variant, color_hex, is_pillar)
             VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
            [landId, Number(rf.f ?? 1), fx, fy, rf.mat || 'kayu', rf.rv || null, rf.col || null, Number(rf.pil || 0)]
        );
        importedCount += 1;
    }

    for (const rw of wallList) {
        const ori = rw.o === 'V' ? 'V' : 'H';
        const gx = Number(rw.gx);
        const gy = Number(rw.gy);
        const maxGx = ori === 'H' ? w : w + 1;
        const maxGy = ori === 'H' ? h + 1 : h;
        if (gx < 1 || gx > maxGx || gy < 1 || gy > maxGy) continue;
        await conn.execute(
            `INSERT IGNORE INTO land_wall_edges
             (land_id, layout_state, floor_level, orientation, gx, gy, edge_type, material_id, color_hex)
             VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
            [landId, Number(rw.f ?? 1), ori, gx, gy, rw.et || 'wall', rw.mat || 'bata', rw.col || null]
        );
        importedCount += 1;
    }

    await conn.execute(`UPDATE property_blueprints SET usage_count = usage_count + 1 WHERE id = ?`, [bp.id]);
    await conn.execute(`UPDATE player_lands SET theme_id = ? WHERE id = ?`, [bp.theme_id || land.theme_id, landId]);

    return { ok: true, blueprint: bp, importedCells: importedCount };
}

module.exports = {
    MIN_BUILD_MS,
    MAX_BUILD_MS,
    ENERGY_BOOST_COST,
    getCellMaterialsMap,
    getFloorCellMaterialsMap,
    getWallEdgeMaterialsMap,
    calculateConstructionRab,
    getLandDepotMap,
    getActiveConstructionProject,
    creditDepotItems,
    syncLandConstruction,
    applyAreaToDraft,
    clearAreaFromDraft,
    applyFloorAreaToDraft,
    clearFloorAreaFromDraft,
    applyPerimeterWallsToDraft,
    applyLineWallsToDraft,
    clearWallEdgesFromDraft,
    applyRoofAreaToDraft,
    applyTemplateToDraft,
    duplicateFloorToDraft,
    applyAsciiSketchToDraft,
    demolishActiveArea,
    depositMaterialsToDepot,
    withdrawMaterialsFromDepot,
    startConstruction,
    boostConstructionWithEnergy,
    hireNpcContractorBoost,
    exportBlueprintCode,
    importBlueprintCode
};
