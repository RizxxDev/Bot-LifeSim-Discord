const {
    getCellBoundaryEdges,
    getFloorMaterial,
    getWallEdgeType
} = require('../data/buildingModules');

const ENCLOSING_EDGE_TYPES = new Set(['wall', 'door', 'window', 'glass_wall']);
const PASSAGE_BLOCKING_EDGE_TYPES = new Set(['wall', 'door', 'window', 'glass_wall', 'fence']);

const ADJACENT_DIRS = [
    { side: 'N', dx: 0, dy: -1 },
    { side: 'S', dx: 0, dy: 1 },
    { side: 'W', dx: -1, dy: 0 },
    { side: 'E', dx: 1, dy: 0 }
];

function formatCellCoord(x, y) {
    return `${String.fromCharCode(65 + Number(x))}${Number(y) + 1}`;
}

/**
 * Membangun peta dinding kanonik ("H:gx:gy" / "V:gx:gy" -> edge row) untuk satu lantai.
 */
function buildWallEdgeMap(wallEdges = [], floorLevel = 1) {
    const map = new Map();
    for (const e of wallEdges || []) {
        if (e.floor_level !== undefined && Number(e.floor_level) !== Number(floorLevel)) continue;
        const key = `${e.orientation}:${Number(e.gx)}:${Number(e.gy)}`;
        map.set(key, e);
    }
    return map;
}

/**
 * Algoritma Deteksi Ruangan Otomatis (Flood-Fill / Connected Components) berbasis Lantai + Edge Walls.
 */
function detectFloorRooms({
    width = 4,
    height = 4,
    floorLevel = 1,
    floorCells = [],
    wallEdges = [],
    upperFloorCells = [],
    roomNamesMap = {}
} = {}) {
    const fl = Number(floorLevel);
    const gridW = Math.max(1, Number(width || 4));
    const gridH = Math.max(1, Number(height || 4));

    const floorMap = new Map();
    for (const c of floorCells || []) {
        if (c.floor_level !== undefined && Number(c.floor_level) !== fl) continue;
        const x = Number(c.x);
        const y = Number(c.y);
        if (x < 0 || y < 0 || x >= gridW || y >= gridH) continue;
        floorMap.set(`${x}:${y}`, c);
    }

    const upperSet = new Set();
    for (const uc of upperFloorCells || []) {
        const ufl = uc.floor_level !== undefined ? Number(uc.floor_level) : fl + 1;
        if (ufl !== fl + 1) continue;
        upperSet.add(`${Number(uc.x)}:${Number(uc.y)}`);
    }

    const edgeMap = buildWallEdgeMap(wallEdges, fl);
    const visited = new Set();
    const rooms = [];
    const cellToRoom = new Map();

    // Urutkan koordinat sel agar room_key stabil & deterministik
    const sortedEntries = [...floorMap.entries()].sort(([, a], [, b]) => (Number(a.y) - Number(b.y)) || (Number(a.x) - Number(b.x)));

    let openIdx = 0;
    let enclosedIdx = 0;

    for (const [startKey, startCell] of sortedEntries) {
        if (visited.has(startKey)) continue;

        const queue = [{ x: Number(startCell.x), y: Number(startCell.y), cell: startCell }];
        visited.add(startKey);
        const component = [];

        let head = 0;
        while (head < queue.length) {
            const cur = queue[head++];
            component.push(cur);

            const boundaries = getCellBoundaryEdges(cur.x, cur.y);
            for (const dir of ADJACENT_DIRS) {
                const nx = cur.x + dir.dx;
                const ny = cur.y + dir.dy;
                const nKey = `${nx}:${ny}`;
                if (!floorMap.has(nKey) || visited.has(nKey)) continue;

                const edge = edgeMap.get(boundaries[dir.side].key);
                if (edge && PASSAGE_BLOCKING_EDGE_TYPES.has(edge.edge_type)) {
                    continue;
                }

                visited.add(nKey);
                queue.push({ x: nx, y: ny, cell: floorMap.get(nKey) });
            }
        }

        component.sort((a, b) => (a.y - b.y) || (a.x - b.x));
        const componentSet = new Set(component.map(c => `${c.x}:${c.y}`));
        const anchor = component[0];
        const roomKey = `F${fl}_${anchor.x}_${anchor.y}`;

        // Evaluasi batas keliling komponen ruangan, pintu, jendela, dan atap
        let perimeterEdges = 0;
        let enclosingEdges = 0;
        let doorCount = 0;
        let windowCount = 0;
        let roofCoveredCells = 0;
        let matComfortSum = 0;

        for (const node of component) {
            const c = node.cell;
            const mat = getFloorMaterial(c.floor_material_id || c.material_id || 'kayu');
            matComfortSum += Number(mat.comfortBonus || 0);

            const hasOwnRoof = Boolean(c.roof_variant && c.roof_variant !== 'none');
            const coveredByUpper = upperSet.has(`${node.x}:${node.y}`);
            if (hasOwnRoof || coveredByUpper) {
                roofCoveredCells += 1;
            }

            const boundaries = getCellBoundaryEdges(node.x, node.y);
            for (const dir of ADJACENT_DIRS) {
                const nx = node.x + dir.dx;
                const ny = node.y + dir.dy;
                if (componentSet.has(`${nx}:${ny}`)) continue;

                perimeterEdges += 1;
                const edge = edgeMap.get(boundaries[dir.side].key);
                if (edge) {
                    const spec = getWallEdgeType(edge.edge_type);
                    if (ENCLOSING_EDGE_TYPES.has(edge.edge_type)) {
                        enclosingEdges += 1;
                    }
                    if (spec.isDoor) doorCount += 1;
                    if (spec.isWindow) windowCount += 1;
                }
            }
        }

        const isEnclosed = perimeterEdges > 0 && enclosingEdges === perimeterEdges;
        const hasRoof = component.length > 0 && roofCoveredCells === component.length;
        const avgMatComfort = component.length > 0 ? matComfortSum / component.length : 0;
        const comfortScore = Math.round(
            avgMatComfort +
            Math.min(10, windowCount * 2) +
            (isEnclosed && hasRoof ? 4 : 0)
        );

        let defaultName;
        if (isEnclosed && hasRoof) {
            enclosedIdx += 1;
            defaultName = `Ruangan ${enclosedIdx}`;
        } else if (isEnclosed) {
            enclosedIdx += 1;
            defaultName = `Ruang Tanpa Atap ${enclosedIdx}`;
        } else {
            openIdx += 1;
            defaultName = `Area Terbuka ${openIdx}`;
        }

        const customName = (roomNamesMap && roomNamesMap[roomKey])
            ? String(roomNamesMap[roomKey]).trim().slice(0, 64)
            : defaultName;

        const coords = component.map(n => formatCellCoord(n.x, n.y));
        const roomObj = {
            roomKey,
            floorLevel: fl,
            anchor: { x: anchor.x, y: anchor.y, coord: formatCellCoord(anchor.x, anchor.y) },
            cells: component.map(n => ({ x: n.x, y: n.y })),
            cellKeys: [...componentSet],
            coords,
            cellCount: component.length,
            isEnclosed,
            hasRoof,
            isIndoorValid: isEnclosed && hasRoof,
            doorCount,
            windowCount,
            perimeterEdges,
            enclosingEdges,
            comfortScore,
            customName
        };

        rooms.push(roomObj);
        for (const k of componentSet) {
            cellToRoom.set(k, roomObj);
        }
    }

    return {
        floorLevel: fl,
        rooms,
        cellToRoom
    };
}

/**
 * Mendeteksi ruangan untuk seluruh lantai pada properti.
 */
function detectAllFloorRooms({
    width = 4,
    height = 4,
    floorCells = [],
    wallEdges = [],
    roomNamesByFloor = {}
} = {}) {
    const floorSet = new Set();
    for (const c of floorCells || []) {
        floorSet.add(Number(c.floor_level ?? 1));
    }
    const floors = [...floorSet].sort((a, b) => a - b);
    const byFloor = new Map();
    const allRooms = [];

    for (const fl of floors) {
        const res = detectFloorRooms({
            width,
            height,
            floorLevel: fl,
            floorCells,
            wallEdges,
            upperFloorCells: floorCells.filter(c => Number(c.floor_level ?? 1) === fl + 1),
            roomNamesMap: roomNamesByFloor[fl] || {}
        });
        byFloor.set(fl, res);
        for (const r of res.rooms) {
            allRooms.push(r);
        }
    }

    return { floors, byFloor, allRooms };
}

/**
 * Menyinkronkan daftar ruangan hasil flood-fill ke tabel `land_rooms`,
 * mempertahankan nama kustom yang sudah diberikan pemain berdasarkan `room_key` atau overlap petak.
 */
async function syncLandRooms(conn, landId, width, height, floorCells = null, wallEdges = null) {
    let fRows = floorCells;
    let wRows = wallEdges;
    if (!fRows) {
        const [rows] = await conn.execute(
            `SELECT * FROM land_floor_cells WHERE land_id = ? AND layout_state = 'active'`,
            [landId]
        );
        fRows = rows;
    }
    if (!wRows) {
        const [rows] = await conn.execute(
            `SELECT * FROM land_wall_edges WHERE land_id = ? AND layout_state = 'active'`,
            [landId]
        );
        wRows = rows;
    }

    const [existingRows] = await conn.execute(
        `SELECT * FROM land_rooms WHERE land_id = ?`,
        [landId]
    );
    const roomNamesByFloor = {};
    for (const ex of existingRows) {
        const fl = Number(ex.floor_level || 1);
        if (!roomNamesByFloor[fl]) roomNamesByFloor[fl] = {};
        roomNamesByFloor[fl][ex.room_key] = ex.custom_name;
    }

    const detected = detectAllFloorRooms({
        width,
        height,
        floorCells: fRows,
        wallEdges: wRows,
        roomNamesByFloor
    });

    await conn.execute(`DELETE FROM land_rooms WHERE land_id = ?`, [landId]);
    for (const r of detected.allRooms) {
        await conn.execute(
            `INSERT INTO land_rooms (land_id, floor_level, room_key, custom_name, room_cells_json, is_enclosed, has_roof, comfort_score)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                landId,
                r.floorLevel,
                r.roomKey,
                r.customName,
                JSON.stringify(r.cells),
                r.isEnclosed ? 1 : 0,
                r.hasRoof ? 1 : 0,
                r.comfortScore
            ]
        );
    }

    return detected;
}

async function renameLandRoom(conn, discordId, landId, floorLevel, roomKey, newName) {
    const [lRows] = await conn.execute(`SELECT id, discord_id, width, height FROM player_lands WHERE id = ? LIMIT 1`, [landId]);
    if (lRows.length === 0 || lRows[0].discord_id !== discordId) {
        return { ok: false, error: 'Kavling tidak ditemukan.' };
    }
    const cleanName = String(newName || '').trim().replace(/[`*@<>]/g, '').slice(0, 64);
    if (cleanName.length < 2) {
        return { ok: false, error: 'Nama area ruangan minimal 2 karakter.' };
    }

    const [upRes] = await conn.execute(
        `UPDATE land_rooms SET custom_name = ? WHERE land_id = ? AND floor_level = ? AND room_key = ?`,
        [cleanName, landId, Number(floorLevel), String(roomKey)]
    );

    if (!upRes.affectedRows) {
        // Deteksi dulu di memori untuk draft/active agar bisa langsung tersimpan namanya
        const land = lRows[0];
        const [activeFloors] = await conn.execute(
            `SELECT * FROM land_floor_cells WHERE land_id = ? AND layout_state = 'active'`,
            [landId]
        );
        const [activeWalls] = await conn.execute(
            `SELECT * FROM land_wall_edges WHERE land_id = ? AND layout_state = 'active'`,
            [landId]
        );
        const det = detectAllFloorRooms({
            width: land.width,
            height: land.height,
            floorCells: activeFloors,
            wallEdges: activeWalls
        });
        const target = det.allRooms.find(r => r.roomKey === String(roomKey) && r.floorLevel === Number(floorLevel));
        if (!target) {
            return { ok: false, error: 'Ruangan aktif belum ditemukan di lantai ini. Selesaikan konstruksi lantai/dinding terlebih dahulu.' };
        }
        await conn.execute(
            `INSERT INTO land_rooms (land_id, floor_level, room_key, custom_name, room_cells_json, is_enclosed, has_roof, comfort_score)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE custom_name = VALUES(custom_name)`,
            [
                landId,
                target.floorLevel,
                target.roomKey,
                cleanName,
                JSON.stringify(target.cells),
                target.isEnclosed ? 1 : 0,
                target.hasRoof ? 1 : 0,
                target.comfortScore
            ]
        );
    }

    return { ok: true, roomKey: String(roomKey), customName: cleanName };
}

module.exports = {
    ENCLOSING_EDGE_TYPES,
    PASSAGE_BLOCKING_EDGE_TYPES,
    buildWallEdgeMap,
    detectFloorRooms,
    detectAllFloorRooms,
    syncLandRooms,
    renameLandRoom
};
