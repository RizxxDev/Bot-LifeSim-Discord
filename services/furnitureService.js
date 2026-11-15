const {
    getFurnitureSpec,
    normalizeFurnitureRotation,
    rotateFurnitureClockwise,
    getRotatedDimensions,
    getFootprintCells,
    getInternalWallEdgesForFootprint
} = require('../data/furniture');
const { parseSingleCoordInput } = require('../data/buildingModules');
const { getItem } = require('../data/items');
const { getPlayerInventory, removeItem, addItem, canFitItems } = require('./inventoryService');
const {
    detectFloorRooms,
    buildWallEdgeMap,
    PASSAGE_BLOCKING_EDGE_TYPES
} = require('./roomDetectionService');

/**
 * Memvalidasi penempatan/rotasi perabotan multi-ukuran (1x1, 1x2, 2x2) pada suatu lantai.
 */
function validateFurniturePlacement({
    itemId,
    anchorX,
    anchorY,
    rotation = 'S',
    floorLevel = 1,
    landWidth = 4,
    landHeight = 4,
    floorCells = [],
    wallEdges = [],
    existingFurniture = [],
    ignoreFurnitureId = null,
    detectedRooms = null
} = {}) {
    const spec = getFurnitureSpec(itemId);
    if (!spec) {
        return { ok: false, error: 'Item ini bukan perabotan arsitektur yang valid.' };
    }

    const ax = Number(anchorX);
    const ay = Number(anchorY);
    const fl = Number(floorLevel);
    const dims = getRotatedDimensions(spec, rotation);
    const footprint = getFootprintCells(ax, ay, dims.widthCells, dims.heightCells);

    // 1. Cek batas tapak tanah
    for (const cell of footprint) {
        if (cell.x < 0 || cell.y < 0 || cell.x >= Number(landWidth) || cell.y >= Number(landHeight)) {
            return {
                ok: false,
                error: `Perabot **${spec.name}** (${dims.widthCells}×${dims.heightCells}, arah ${dims.rotation}) keluar batas kavling ${landWidth}×${landHeight}.`
            };
        }
    }

    // 2. Cek keberadaan lantai di bawah seluruh petak footprint
    const floorSet = new Set();
    for (const c of floorCells || []) {
        if (c.floor_level !== undefined && Number(c.floor_level) !== fl) continue;
        floorSet.add(`${Number(c.x)}:${Number(c.y)}`);
    }
    for (const cell of footprint) {
        if (!floorSet.has(`${cell.x}:${cell.y}`)) {
            const coord = `${String.fromCharCode(65 + cell.x)}${cell.y + 1}`;
            return {
                ok: false,
                error: `Petak **${coord}** di lantai ini belum memiliki lantai aktif. Bangun lantai terlebih dahulu di Layer 1!`
            };
        }
    }

    // 3. Cek tabrakan dinding sekat di tengah footprint item (untuk item >= 2 petak)
    const edgeMap = buildWallEdgeMap(wallEdges, fl);
    const internalEdges = getInternalWallEdgesForFootprint(ax, ay, dims.widthCells, dims.heightCells);
    for (const ie of internalEdges) {
        const edgeKey = `${ie.orientation}:${ie.gx}:${ie.gy}`;
        const existingEdge = edgeMap.get(edgeKey);
        if (existingEdge && PASSAGE_BLOCKING_EDGE_TYPES.has(existingEdge.edge_type)) {
            return {
                ok: false,
                error: `Perabot **${spec.name}** (${dims.widthCells}×${dims.heightCells}) terbelah dinding/sekat! Geser koordinat atau putar 90°.`
            };
        }
    }

    // 4. Cek tumpang tindih dengan perabot lain di lantai yang sama
    const occupiedMap = new Map();
    for (const f of existingFurniture || []) {
        if (Number(f.floor_level ?? 1) !== fl) continue;
        if (f.is_locked_rubble) continue;
        if (ignoreFurnitureId !== null && Number(f.id) === Number(ignoreFurnitureId)) continue;

        const fw = Number(f.width_cells || 1);
        const fh = Number(f.height_cells || 1);
        for (const oc of getFootprintCells(f.anchor_x, f.anchor_y, fw, fh)) {
            occupiedMap.set(`${oc.x}:${oc.y}`, f);
        }
    }

    for (const cell of footprint) {
        const blocker = occupiedMap.get(`${cell.x}:${cell.y}`);
        if (blocker) {
            const blockerSpec = getFurnitureSpec(blocker.item_id);
            const coord = `${String.fromCharCode(65 + cell.x)}${cell.y + 1}`;
            return {
                ok: false,
                error: `Petak **${coord}** sudah ditempati oleh **${blockerSpec ? blockerSpec.name : blocker.item_id}**. Geser atau cabut perabot lama dahulu.`
            };
        }
    }

    // 5. Hitung efektivitas ruangan (indoor di area terbuka/tanpa atap -> penalti 50%)
    let roomInfo = null;
    const roomDetection = (detectedRooms && detectedRooms.cellToRoom instanceof Map)
        ? detectedRooms
        : detectFloorRooms({
        width: landWidth,
        height: landHeight,
        floorLevel: fl,
        floorCells: (floorCells || []).filter(c => c.floor_level === undefined || Number(c.floor_level) === fl),
        wallEdges: (wallEdges || []).filter(e => e.floor_level === undefined || Number(e.floor_level) === fl),
        upperFloorCells: (floorCells || []).filter(c => c.floor_level !== undefined && Number(c.floor_level) === fl + 1)
    });
    roomInfo = roomDetection.cellToRoom.get(`${ax}:${ay}`) || null;

    let effectivenessMult = 1.0;
    let isOutdoorPenalty = false;
    let warning = null;

    if (spec.environment === 'indoor') {
        if (!roomInfo || !roomInfo.isEnclosed || !roomInfo.hasRoof) {
            effectivenessMult = 0.5;
            isOutdoorPenalty = true;
            warning = 'Perabot indoor ditaruh di ruang terbuka/tanpa atap — efektivitas bekerja 50% hingga ruangan ditutup dinding & atap!';
        }
    }

    return {
        ok: true,
        spec,
        anchorX: ax,
        anchorY: ay,
        widthCells: dims.widthCells,
        heightCells: dims.heightCells,
        rotation: dims.rotation,
        footprint,
        roomInfo,
        effectivenessMult,
        isOutdoorPenalty,
        warning
    };
}

async function getLandFurniture(conn, landId, floorLevel = null, includeLocked = false) {
    const params = [landId];
    let sql = `SELECT * FROM land_furniture_items WHERE land_id = ?`;
    if (!includeLocked) {
        sql += ` AND is_locked_rubble = 0`;
    }
    if (floorLevel !== null && floorLevel !== undefined) {
        sql += ` AND floor_level = ?`;
        params.push(Number(floorLevel));
    }
    sql += ` ORDER BY floor_level ASC, id ASC`;
    const [rows] = await conn.execute(sql, params);
    return rows;
}

async function loadActiveFloorWallAndFurniture(conn, landId) {
    const [floorCells] = await conn.execute(
        `SELECT * FROM land_floor_cells WHERE land_id = ? AND layout_state = 'active'`,
        [landId]
    );
    const [wallEdges] = await conn.execute(
        `SELECT * FROM land_wall_edges WHERE land_id = ? AND layout_state = 'active'`,
        [landId]
    );
    const furniture = await getLandFurniture(conn, landId, null, false);
    return { floorCells, wallEdges, furniture };
}

/**
 * Memasang perabotan langsung dari Tas (/inventory) atau Gudang properti (tanpa timer konstruksi).
 */
async function placeFurniture(conn, discordId, landId, {
    itemId,
    floorLevel = 1,
    coordInput = 'A1',
    anchorX = null,
    anchorY = null,
    rotation = 'S'
}, now = Date.now()) {
    const [lRows] = await conn.execute(`SELECT * FROM player_lands WHERE id = ? LIMIT 1 FOR UPDATE`, [landId]);
    if (lRows.length === 0 || lRows[0].discord_id !== discordId) {
        return { ok: false, error: 'Kavling tidak ditemukan atau bukan milikmu.' };
    }
    const land = lRows[0];
    if (land.building_state === 'collapsed') {
        return { ok: false, error: 'Bangunan berstatus **Rubuh**. Bersihkan puing di `/property` sebelum menata perabotan.' };
    }

    const spec = getFurnitureSpec(itemId);
    if (!spec) {
        return { ok: false, error: 'Item perabotan tidak ditemukan di katalog.' };
    }

    let ax = anchorX;
    let ay = anchorY;
    if (ax === null || ay === null || ax === undefined || ay === undefined) {
        const parsed = parseSingleCoordInput(coordInput, Number(land.width), Number(land.height));
        if (!parsed.ok) return parsed;
        ax = parsed.x;
        ay = parsed.y;
    }

    // Cek ketersediaan item di Tas terlebih dahulu, lalu Gudang lokal properti
    const bagRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
    const bagQty = bagRows.filter(r => r.item_id === spec.id).reduce((s, r) => s + Number(r.quantity || 0), 0);
    const gudangRows = bagQty > 0 ? [] : await getPlayerInventory(conn, discordId, true, 'gudang', now, landId);
    const gudangQty = gudangRows.filter(r => r.item_id === spec.id).reduce((s, r) => s + Number(r.quantity || 0), 0);

    if (bagQty < 1 && gudangQty < 1) {
        return {
            ok: false,
            error: `Kamu belum memiliki **${spec.emoji} ${spec.name}** di Tas atau Gudang properti ini. Beli di \`/shop\` (Toko Furnitur) atau rakit di Workshop!`
        };
    }

    const { floorCells, wallEdges, furniture } = await loadActiveFloorWallAndFurniture(conn, landId);
    const check = validateFurniturePlacement({
        itemId: spec.id,
        anchorX: ax,
        anchorY: ay,
        rotation,
        floorLevel: Number(floorLevel),
        landWidth: Number(land.width),
        landHeight: Number(land.height),
        floorCells,
        wallEdges,
        existingFurniture: furniture
    });
    if (!check.ok) return check;

    if (bagQty >= 1) {
        await removeItem(conn, discordId, spec.id, 1, 'bag');
    } else {
        await removeItem(conn, discordId, spec.id, 1, 'gudang', landId);
    }

    const [ins] = await conn.execute(
        `INSERT INTO land_furniture_items
         (land_id, floor_level, item_id, anchor_x, anchor_y, width_cells, height_cells, rotation, condition_pct, is_locked_rubble, placed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 100.00, 0, ?)`,
        [landId, Number(floorLevel), spec.id, check.anchorX, check.anchorY, check.widthCells, check.heightCells, check.rotation, now]
    );
    await conn.execute(`UPDATE player_lands SET updated_at = ? WHERE id = ?`, [now, landId]);

    return {
        ok: true,
        furnitureId: ins.insertId,
        spec,
        anchorX: check.anchorX,
        anchorY: check.anchorY,
        widthCells: check.widthCells,
        heightCells: check.heightCells,
        rotation: check.rotation,
        warning: check.warning
    };
}

/**
 * Menggeser koordinat atau memutar arah perabotan terpasang tanpa timer.
 */
async function rotateOrMoveFurniture(conn, discordId, landId, furnitureId, {
    coordInput = null,
    anchorX = null,
    anchorY = null,
    rotation = null,
    rotateCw = false
} = {}, now = Date.now()) {
    const [lRows] = await conn.execute(`SELECT * FROM player_lands WHERE id = ? LIMIT 1 FOR UPDATE`, [landId]);
    if (lRows.length === 0 || lRows[0].discord_id !== discordId) {
        return { ok: false, error: 'Kavling tidak ditemukan.' };
    }
    const land = lRows[0];

    const [fRows] = await conn.execute(
        `SELECT * FROM land_furniture_items WHERE id = ? AND land_id = ? AND is_locked_rubble = 0 LIMIT 1 FOR UPDATE`,
        [furnitureId, landId]
    );
    if (fRows.length === 0) {
        return { ok: false, error: 'Perabotan tidak ditemukan di properti ini.' };
    }
    const itemRow = fRows[0];

    let nextX = Number(itemRow.anchor_x);
    let nextY = Number(itemRow.anchor_y);
    if (anchorX !== null && anchorY !== null && anchorX !== undefined && anchorY !== undefined) {
        nextX = Number(anchorX);
        nextY = Number(anchorY);
    } else if (coordInput) {
        const parsed = parseSingleCoordInput(coordInput, Number(land.width), Number(land.height));
        if (!parsed.ok) return parsed;
        nextX = parsed.x;
        nextY = parsed.y;
    }

    const nextRot = rotateCw
        ? rotateFurnitureClockwise(itemRow.rotation)
        : (rotation ? normalizeFurnitureRotation(rotation) : itemRow.rotation);

    const { floorCells, wallEdges, furniture } = await loadActiveFloorWallAndFurniture(conn, landId);
    const check = validateFurniturePlacement({
        itemId: itemRow.item_id,
        anchorX: nextX,
        anchorY: nextY,
        rotation: nextRot,
        floorLevel: Number(itemRow.floor_level),
        landWidth: Number(land.width),
        landHeight: Number(land.height),
        floorCells,
        wallEdges,
        existingFurniture: furniture,
        ignoreFurnitureId: itemRow.id
    });
    if (!check.ok) return check;

    await conn.execute(
        `UPDATE land_furniture_items
         SET anchor_x = ?, anchor_y = ?, width_cells = ?, height_cells = ?, rotation = ?
         WHERE id = ?`,
        [check.anchorX, check.anchorY, check.widthCells, check.heightCells, check.rotation, itemRow.id]
    );
    await conn.execute(`UPDATE player_lands SET updated_at = ? WHERE id = ?`, [now, landId]);

    return {
        ok: true,
        furnitureId: itemRow.id,
        spec: check.spec,
        anchorX: check.anchorX,
        anchorY: check.anchorY,
        widthCells: check.widthCells,
        heightCells: check.heightCells,
        rotation: check.rotation,
        warning: check.warning
    };
}

/**
 * Mencabut perabotan dari lantai dan mengembalikannya utuh ke Tas (/inventory).
 */
async function pickupFurniture(conn, discordId, landId, furnitureId, maxSlots = 20, now = Date.now()) {
    const [lRows] = await conn.execute(`SELECT * FROM player_lands WHERE id = ? LIMIT 1 FOR UPDATE`, [landId]);
    if (lRows.length === 0 || lRows[0].discord_id !== discordId) {
        return { ok: false, error: 'Kavling tidak ditemukan.' };
    }
    const [fRows] = await conn.execute(
        `SELECT * FROM land_furniture_items WHERE id = ? AND land_id = ? AND is_locked_rubble = 0 LIMIT 1 FOR UPDATE`,
        [furnitureId, landId]
    );
    if (fRows.length === 0) {
        return { ok: false, error: 'Perabotan tidak ditemukan atau sedang terkunci puing.' };
    }
    const row = fRows[0];
    const bagRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
    if (!canFitItems(bagRows, Number(maxSlots || 20), [{ itemId: row.item_id, qty: 1 }])) {
        return { ok: false, error: 'Tas (/inventory) penuh! Kosongkan 1 slot tas terlebih dahulu.' };
    }

    await conn.execute(`DELETE FROM land_furniture_items WHERE id = ?`, [row.id]);
    await addItem(conn, discordId, row.item_id, 1, now, 'bag');
    await conn.execute(`UPDATE player_lands SET updated_at = ? WHERE id = ?`, [now, landId]);

    return {
        ok: true,
        itemId: row.item_id,
        item: getItem(row.item_id) || getFurnitureSpec(row.item_id)
    };
}

module.exports = {
    validateFurniturePlacement,
    getLandFurniture,
    placeFurniture,
    rotateOrMoveFurniture,
    pickupFurniture
};
