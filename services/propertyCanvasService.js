const crypto = require('crypto');
const { AttachmentBuilder } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const {
    getArchitectureTheme,
    getBuildingModule,
    getStructuralMaterial,
    getFloorMaterial,
    getWallEdgeType,
    getFloorLabel
} = require('../data/buildingModules');
const { getFurnitureSpec } = require('../data/furniture');
const { getCity } = require('../data/cities');

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 420;
const MAX_CACHE_ENTRIES = 100;
const FONT_FAMILY = '"Segoe UI", "DejaVu Sans", "Liberation Sans", Arial, sans-serif';

const PROPERTY_CANVAS_CACHE = new Map();

function cleanCanvasText(text) {
    return String(text || '')
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function drawRoundedRect(ctx, x, y, w, h, r = 8) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
}

function drawMaterialTexture(ctx, x, y, w, h, materialId, baseColor) {
    ctx.save();
    drawRoundedRect(ctx, x, y, w, h, 4);
    ctx.clip();

    ctx.fillStyle = baseColor;
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;

    if (materialId === 'bata') {
        for (let row = 0; row < h; row += 8) {
            ctx.beginPath();
            ctx.moveTo(x, y + row);
            ctx.lineTo(x + w, y + row);
            ctx.stroke();
        }
    } else if (materialId === 'kayu' || materialId === 'bambu') {
        for (let col = 6; col < w; col += 8) {
            ctx.beginPath();
            ctx.moveTo(x + col, y);
            ctx.lineTo(x + col, y + h);
            ctx.stroke();
        }
    } else if (materialId === 'kaca') {
        ctx.strokeStyle = 'rgba(255,255,255,0.38)';
        ctx.beginPath();
        ctx.moveTo(x + 3, y + h - 4);
        ctx.lineTo(x + w - 4, y + 3);
        ctx.stroke();
    } else if (materialId === 'marmer') {
        ctx.strokeStyle = 'rgba(148,163,184,0.35)';
        ctx.beginPath();
        ctx.moveTo(x, y + h * 0.35);
        ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.65, x + w, y + h * 0.25);
        ctx.stroke();
    } else if (materialId === 'baja' || materialId === 'beton') {
        ctx.strokeStyle = 'rgba(15,23,42,0.28)';
        ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
    } else if (materialId === 'keramik') {
        ctx.strokeStyle = 'rgba(148,163,184,0.3)';
        for (let g = 10; g < w; g += 10) {
            ctx.beginPath();
            ctx.moveTo(x + g, y);
            ctx.lineTo(x + g, y + h);
            ctx.stroke();
        }
        for (let g = 10; g < h; g += 10) {
            ctx.beginPath();
            ctx.moveTo(x, y + g);
            ctx.lineTo(x + w, y + g);
            ctx.stroke();
        }
    } else if (materialId === 'rumput') {
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(x + w * 0.25, y + h * 0.3, 2, 2);
        ctx.fillRect(x + w * 0.7, y + h * 0.65, 2, 2);
    } else if (materialId === 'kolam') {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.moveTo(x + 4, y + h * 0.45);
        ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.3, x + w - 4, y + h * 0.45);
        ctx.stroke();
    }

    ctx.restore();
}

function getFurnitureShortCode(itemId) {
    const spec = getFurnitureSpec(itemId);
    if (!spec) return 'FRN';
    const raw = cleanCanvasText(spec.name).toUpperCase().replace(/[^A-Z0-9 ]/g, '');
    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
        return (words[0].slice(0, 3) + words[1].slice(0, 1)).slice(0, 4);
    }
    return raw.slice(0, 4) || 'FRN';
}

function getFurnitureCategoryColor(category) {
    const map = {
        rest: '#f472b6',
        kitchen_storage: '#38bdf8',
        business: '#fbbf24',
        station: '#f97316',
        decor: '#4ade80'
    };
    return map[category] || '#94a3b8';
}

function extractArchLayers(payload = {}) {
    const arch = payload.archData || payload.allCells?._archData || {};
    return {
        floorCells: payload.floorCells || arch.floorCells || [],
        wallEdges: payload.wallEdges || arch.wallEdges || [],
        furniture: (payload.furniture || arch.furniture || []).filter(f => !f.is_locked_rubble),
        rooms: payload.rooms || payload.stats?.detectedRooms || []
    };
}

function rotateIsoVertex(vx, vy, w, h, angle = 0) {
    const rot = ((Number(angle) % 4) + 4) % 4;
    if (rot === 1) return [vy, w - vx];
    if (rot === 2) return [w - vx, h - vy];
    if (rot === 3) return [h - vy, vx];
    return [vx, vy];
}

function getModuleShortCode(moduleId) {
    const map = {
        bedroom_std: 'KMR',
        bedroom_lux: 'VIP',
        kitchen_basic: 'DPR',
        kitchen_pro: 'CHF',
        fridge_room: 'KLK',
        freezer_room: 'FRZ',
        warehouse_cell: 'GDG',
        garage: 'GRS',
        garden: 'TMN',
        pool: 'KLM',
        lounge: 'RNG',
        greenhouse: 'GH',
        shop_stall: 'WRG',
        cafe_area: 'KFE',
        rental_room: 'KOS',
        service_bay: 'BKL',
        kiln_station: 'KLN',
        sawmill_station: 'SWM',
        smelter_station: 'SML',
        workbench: 'RKT',
        hall_custom: 'AUL',
        rooftop_lounge: 'RFT',
        monument: 'GLR',
        wall_custom: 'DND',
        glass_wall: 'KCA',
        pillar_block: 'PLR',
        balcony_rail: 'BLK',
        stairs_ext: 'TNG',
        roof_flat: 'DAK',
        roof_gable: 'PLN',
        roof_limas: 'LMS',
        roof_joglo: 'JGL',
        roof_dome: 'KBH',
        roof_spire: 'SPR'
    };
    if (map[moduleId]) return map[moduleId];
    const mod = getBuildingModule(moduleId);
    return cleanCanvasText(mod?.shortLabel || 'MOD').slice(0, 4).toUpperCase();
}

function tintHex(hex, lum = 0, alpha = 1) {
    const raw = String(hex || '#64748b').replace('#', '');
    const norm = raw.length === 3
        ? raw.split('').map(ch => ch + ch).join('')
        : raw.padEnd(6, '0').slice(0, 6);
    const num = parseInt(norm, 16) || 0x64748b;
    const adjust = (c) => {
        const v = Math.round(c + (lum >= 0 ? (255 - c) * lum : c * lum));
        return Math.max(0, Math.min(255, v));
    };
    const r = adjust((num >> 16) & 255);
    const g = adjust((num >> 8) & 255);
    const b = adjust(num & 255);
    return `rgba(${r},${g},${b},${alpha})`;
}

function rotateIsoCoord(x, y, w, h, angle = 0) {
    const rot = ((Number(angle) % 4) + 4) % 4;
    if (rot === 1) return { rx: y, ry: w - 1 - x, rW: h, rH: w };
    if (rot === 2) return { rx: w - 1 - x, ry: h - 1 - y, rW: w, rH: h };
    if (rot === 3) return { rx: h - 1 - y, ry: x, rW: h, rH: w };
    return { rx: x, ry: y, rW: w, rH: h };
}

function drawPolygon(ctx, pts, fillStyle, strokeStyle = null, lineWidth = 0.8) {
    if (!pts || pts.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
    }
    if (strokeStyle) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }
}

/**
 * Merender bangunan 3D Isometrik Voxel sesungguhnya dengan Painter's Algorithm,
 * rotasi kamera 4 sudut (0..3), geometri atap/bentuk kustom, serta status kerusakan.
 */
function drawIsometricVoxelBuilding(ctx, boxX, boxY, boxW, boxH, land, allCells, stats, theme, cameraAngle = 0, archLayers = {}) {
    drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 10);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.62)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const gridW = Math.max(3, Math.min(10, Number(land?.width || 4)));
    const gridH = Math.max(3, Math.min(10, Number(land?.height || 4)));
    const rot = ((Number(cameraAngle) % 4) + 4) % 4;
    const rotDims = rotateIsoCoord(0, 0, gridW, gridH, rot);
    const rW = rotDims.rW;
    const rH = rotDims.rH;

    const rawFloors = archLayers.floorCells || [];
    const rawWalls = archLayers.wallEdges || [];
    const rawFurn = archLayers.furniture || [];
    const hasAnyStruct = (allCells || []).length > 0 || rawFloors.length > 0 || rawWalls.length > 0;
    const buildingState = land?.building_state && land.building_state !== 'empty'
        ? land.building_state
        : (hasAnyStruct ? 'active' : 'empty');
    const condPct = Math.max(0, Math.min(100, Number(land?.condition_pct ?? 100)));

    // Kumpulkan sel legacy + 4-layer terproyeksi
    const cells = [];
    const legacyKeySet = new Set();
    let maxFloor = 1;
    let hasBasement = false;

    for (const raw of allCells || []) {
        const fl = Number(raw.floor_level ?? raw.floor ?? 1);
        const x = Number(raw.x);
        const y = Number(raw.y);
        if (x < 0 || y < 0 || x >= gridW || y >= gridH) continue;
        legacyKeySet.add(`${fl}:${x}:${y}`);
        const { rx, ry } = rotateIsoCoord(x, y, gridW, gridH, rot);
        const mod = getBuildingModule(raw.module_id || raw.mod);
        const mat = getStructuralMaterial(raw.material_id || raw.mat);
        const kind = raw.block_kind || mod.blockKind || 'module';
        const variant = raw.shape_variant || mod.shapeVariant || null;
        if (fl === -1) hasBasement = true;
        if (fl > maxFloor) maxFloor = fl;
        cells.push({
            fl, rx, ry, mod, mat, kind, variant,
            color: raw.color_hex || mod.defaultColor || mat.colorHex
        });
    }

    const extraFloors = [];
    for (const raw of rawFloors) {
        const fl = Number(raw.floor_level ?? 1);
        const x = Number(raw.x);
        const y = Number(raw.y);
        if (x < 0 || y < 0 || x >= gridW || y >= gridH) continue;
        if (fl === -1) hasBasement = true;
        if (fl > maxFloor) maxFloor = fl;
        if (legacyKeySet.has(`${fl}:${x}:${y}`)) continue;
        const { rx, ry } = rotateIsoCoord(x, y, gridW, gridH, rot);
        const fMat = getFloorMaterial(raw.floor_material_id || 'kayu');
        extraFloors.push({
            fl, rx, ry,
            fMat,
            color: raw.color_hex || fMat.colorHex,
            roofVariant: raw.roof_variant && raw.roof_variant !== 'none' ? raw.roof_variant : null,
            isPillar: Number(raw.is_pillar || 0) === 1
        });
    }

    for (const w of rawWalls) {
        const fl = Number(w.floor_level ?? 1);
        if (fl === -1) hasBasement = true;
        if (fl > maxFloor) maxFloor = fl;
    }

    // Auto-scale dimensi isometrik agar kavling 10x10 & menara tinggi tetap presisi dalam kanvas
    const maxZForFit = buildingState === 'collapsed' ? 2 : Math.max(2, maxFloor + 1.8);
    const maxHalfWByX = (boxW - 28) / Math.max(4, rW + rH);
    const maxHalfWByY = (boxH - 36) / (Math.max(4, rW + rH) * 0.52 + maxZForFit * 0.95);
    const tileHalfW = Math.max(5.5, Math.min(24, Math.min(maxHalfWByX, maxHalfWByY)));
    const tileHalfH = tileHalfW * 0.52;
    const layerH = Math.max(4.5, Math.min(19, tileHalfW * 0.95));

    const topCenterX = boxX + boxW / 2 - ((rW - rH) * tileHalfW) / 2;
    const groundTopY = boxY + boxH - 12 - (rW + rH) * tileHalfH;

    const proj = (fx, fy, fz) => [
        topCenterX + (fx - fy) * tileHalfW,
        groundTopY + (fx + fy) * tileHalfH - fz * layerH
    ];

    const drawPrism = (fx0, fx1, fy0, fy1, fz0, fz1, baseHex, alpha = 1, strokeHex = 'rgba(15,23,42,0.55)') => {
        const t00 = proj(fx0, fy0, fz1);
        const t10 = proj(fx1, fy0, fz1);
        const t11 = proj(fx1, fy1, fz1);
        const t01 = proj(fx0, fy1, fz1);
        const b10 = proj(fx1, fy0, fz0);
        const b11 = proj(fx1, fy1, fz0);
        const b01 = proj(fx0, fy1, fz0);

        drawPolygon(ctx, [t01, t11, b11, b01], tintHex(baseHex, -0.08, alpha), strokeHex, 0.7);
        drawPolygon(ctx, [t10, t11, b11, b10], tintHex(baseHex, -0.25, alpha), strokeHex, 0.7);
        drawPolygon(ctx, [t00, t10, t11, t01], tintHex(baseHex, 0.14, alpha), strokeHex, 0.7);
    };

    const drawIsoRoof = (rx, ry, zBase, variant, baseCol) => {
        const x0 = rx + 0.04;
        const x1 = rx + 0.96;
        const y0 = ry + 0.04;
        const y1 = ry + 0.96;
        const rCol = theme.roofHex || baseCol;

        if (variant === 'flat') {
            drawPrism(x0, x1, y0, y1, zBase, zBase + 0.3, rCol, 0.98);
        } else if (variant === 'gable') {
            drawPrism(x0, x1, y0, y1, zBase, zBase + 0.16, baseCol, 0.98);
            const pLeft0 = proj(x0, y0, zBase + 0.16);
            const pRight0 = proj(x1, y0, zBase + 0.16);
            const pFrontR = proj(x1, y1, zBase + 0.16);
            const pFrontL = proj(x0, y1, zBase + 0.16);
            const rMidBack = proj(rx + 0.5, y0, zBase + 0.9);
            const rMidFront = proj(rx + 0.5, y1, zBase + 0.9);
            drawPolygon(ctx, [pFrontL, pFrontR, rMidFront], tintHex(rCol, -0.05), 'rgba(15,23,42,0.55)');
            drawPolygon(ctx, [rMidBack, rMidFront, pFrontR, pRight0], tintHex(rCol, -0.22), 'rgba(15,23,42,0.55)');
            drawPolygon(ctx, [pLeft0, rMidBack, rMidFront, pFrontL], tintHex(rCol, 0.16), 'rgba(15,23,42,0.55)');
        } else if (variant === 'limas' || variant === 'hip') {
            drawPrism(x0, x1, y0, y1, zBase, zBase + 0.16, baseCol, 0.98);
            const p00 = proj(x0, y0, zBase + 0.16);
            const p10 = proj(x1, y0, zBase + 0.16);
            const p11 = proj(x1, y1, zBase + 0.16);
            const p01 = proj(x0, y1, zBase + 0.16);
            const apex = proj(rx + 0.5, ry + 0.5, zBase + 0.95);
            drawPolygon(ctx, [p01, p11, apex], tintHex(rCol, -0.02), 'rgba(15,23,42,0.55)');
            drawPolygon(ctx, [p10, p11, apex], tintHex(rCol, -0.22), 'rgba(15,23,42,0.55)');
            drawPolygon(ctx, [p00, p10, apex], tintHex(rCol, 0.18), 'rgba(15,23,42,0.55)');
        } else if (variant === 'joglo') {
            drawPrism(x0, x1, y0, y1, zBase, zBase + 0.28, rCol, 0.98);
            const s0 = proj(rx + 0.2, ry + 0.2, zBase + 0.28);
            const s1 = proj(rx + 0.8, ry + 0.2, zBase + 0.28);
            const s2 = proj(rx + 0.8, ry + 0.8, zBase + 0.28);
            const s3 = proj(rx + 0.2, ry + 0.8, zBase + 0.28);
            const apex = proj(rx + 0.5, ry + 0.5, zBase + 1.18);
            drawPolygon(ctx, [s3, s2, apex], tintHex('#92400e', 0.05), 'rgba(15,23,42,0.6)');
            drawPolygon(ctx, [s1, s2, apex], tintHex('#92400e', -0.2), 'rgba(15,23,42,0.6)');
            drawPolygon(ctx, [s0, s1, apex], tintHex('#92400e', 0.2), 'rgba(15,23,42,0.6)');
        } else if (variant === 'dome') {
            drawPrism(x0, x1, y0, y1, zBase, zBase + 0.22, baseCol, 0.98);
            const center = proj(rx + 0.5, ry + 0.5, zBase + 0.22);
            const rad = tileHalfW * 0.72;
            ctx.beginPath();
            ctx.ellipse(center[0], center[1], rad, rad * 0.75, 0, Math.PI, 0);
            ctx.closePath();
            ctx.fillStyle = tintHex(theme.accentHex || baseCol, 0.15, 0.95);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.45)';
            ctx.lineWidth = 0.8;
            ctx.stroke();
        } else if (variant === 'spire') {
            drawPrism(rx + 0.2, rx + 0.8, ry + 0.2, ry + 0.8, zBase, zBase + 0.42, baseCol, 0.98);
            const b0 = proj(rx + 0.28, ry + 0.28, zBase + 0.42);
            const b1 = proj(rx + 0.72, ry + 0.28, zBase + 0.42);
            const b2 = proj(rx + 0.72, ry + 0.72, zBase + 0.42);
            const b3 = proj(rx + 0.28, ry + 0.72, zBase + 0.42);
            const apex = proj(rx + 0.5, ry + 0.5, zBase + 1.45);
            drawPolygon(ctx, [b3, b2, apex], tintHex(theme.accentHex || baseCol, -0.04), 'rgba(15,23,42,0.6)');
            drawPolygon(ctx, [b1, b2, apex], tintHex(theme.accentHex || baseCol, -0.25), 'rgba(15,23,42,0.6)');
        }
    };

    const drawIsoWallSegment = (pA, pB, z0, z1, edgeType, hexCol) => {
        const wCol = buildingState === 'abandoned' ? '#4d5d53' : hexCol;
        const drawPanel = (t0, t1, za, zb, fill, stroke = 'rgba(15,23,42,0.65)') => {
            const ax = pA[0] + (pB[0] - pA[0]) * t0;
            const ay = pA[1] + (pB[1] - pA[1]) * t0;
            const bx = pA[0] + (pB[0] - pA[0]) * t1;
            const by = pA[1] + (pB[1] - pA[1]) * t1;
            drawPolygon(ctx, [proj(ax, ay, zb), proj(bx, by, zb), proj(bx, by, za), proj(ax, ay, za)], fill, stroke, 0.65);
        };

        if (edgeType === 'fence') {
            drawPanel(0, 1, z0, z0 + 0.34, tintHex('#b45309', 0, 0.92));
        } else if (edgeType === 'arch') {
            drawPanel(0, 0.22, z0, z1, tintHex(wCol, -0.1, 0.92));
            drawPanel(0.78, 1, z0, z1, tintHex(wCol, -0.1, 0.92));
            drawPanel(0.22, 0.78, z0 + 0.72, z1, tintHex(wCol, 0.05, 0.92));
        } else if (edgeType === 'door') {
            drawPanel(0, 0.24, z0, z1, tintHex(wCol, -0.08, 0.95));
            drawPanel(0.76, 1, z0, z1, tintHex(wCol, -0.08, 0.95));
            drawPanel(0.24, 0.76, z0 + 0.72, z1, tintHex(wCol, 0.02, 0.95));
            drawPanel(0.26, 0.74, z0 + 0.05, z0 + 0.7, tintHex('#92400e', 0.1, 0.92));
        } else if (edgeType === 'window') {
            drawPanel(0, 1, z0, z0 + 0.34, tintHex(wCol, -0.08, 0.95));
            drawPanel(0, 1, z0 + 0.76, z1, tintHex(wCol, 0.04, 0.95));
            drawPanel(0.15, 0.85, z0 + 0.34, z0 + 0.76, 'rgba(125,211,252,0.55)', 'rgba(224,242,254,0.8)');
        } else if (edgeType === 'glass_wall') {
            drawPanel(0, 1, z0, z1, 'rgba(125,211,252,0.48)', 'rgba(224,242,254,0.75)');
        } else {
            drawPanel(0, 1, z0, z1, tintHex(wCol, -0.1, 0.95));
        }
    };

    // Basement sub-pedestal jika ada lantai B1
    if (hasBasement && buildingState !== 'collapsed') {
        const bCells = cells.filter(c => c.fl === -1).sort((a, b) => (a.rx + a.ry) - (b.rx + b.ry));
        for (const c of bCells) {
            drawPrism(c.rx + 0.05, c.rx + 0.95, c.ry + 0.05, c.ry + 0.95, -0.75, -0.05, c.mat.colorHex, 0.75);
        }
        const bFloors = extraFloors.filter(f => f.fl === -1).sort((a, b) => (a.rx + a.ry) - (b.rx + b.ry));
        for (const f of bFloors) {
            drawPrism(f.rx + 0.05, f.rx + 0.95, f.ry + 0.05, f.ry + 0.95, -0.75, -0.05, f.color, 0.75);
        }
    }

    // Lantai dasar tanah isometrik (grid tipis)
    const g0 = proj(0, 0, 0);
    const g1 = proj(rW, 0, 0);
    const g2 = proj(rW, rH, 0);
    const g3 = proj(0, rH, 0);
    drawPolygon(ctx, [g0, g1, g2, g3], 'rgba(30, 41, 59, 0.72)', 'rgba(148, 163, 184, 0.25)', 1);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 0.6;
    for (let i = 1; i < rW; i++) {
        const pA = proj(i, 0, 0);
        const pB = proj(i, rH, 0);
        ctx.beginPath();
        ctx.moveTo(pA[0], pA[1]);
        ctx.lineTo(pB[0], pB[1]);
        ctx.stroke();
    }
    for (let j = 1; j < rH; j++) {
        const pA = proj(0, j, 0);
        const pB = proj(rW, j, 0);
        ctx.beginPath();
        ctx.moveTo(pA[0], pA[1]);
        ctx.lineTo(pB[0], pB[1]);
        ctx.stroke();
    }

    if (!hasAnyStruct) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = `11px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.fillText('Lahan Kosong (Siap Dibangun 3D)', boxX + boxW / 2, boxY + boxH / 2 - 12);
    } else if (buildingState === 'collapsed') {
        const groundFootprint = new Map();
        for (const c of cells) groundFootprint.set(`${c.rx}:${c.ry}`, c);
        for (const f of extraFloors) groundFootprint.set(`${f.rx}:${f.ry}`, f);
        const rubbleList = [...groundFootprint.values()].sort((a, b) => (a.rx + a.ry) - (b.rx + b.ry));
        for (const c of rubbleList) {
            const hVar = 0.22 + (((c.rx * 7 + c.ry * 13) % 4) * 0.14);
            drawPrism(c.rx + 0.08, c.rx + 0.92, c.ry + 0.08, c.ry + 0.92, 0, hVar, '#57534e', 0.95);
            drawPrism(c.rx + 0.25, c.rx + 0.72, c.ry + 0.25, c.ry + 0.72, hVar, hVar + 0.2, '#78716c', 0.95);
        }
    } else {
        // Kumpulkan semua elemen 3D per lantai untuk Painter's Algorithm
        const floorNums = new Set();
        for (const c of cells) if (c.fl >= 1) floorNums.add(c.fl);
        for (const f of extraFloors) if (f.fl >= 1) floorNums.add(f.fl);
        for (const w of rawWalls) if (Number(w.floor_level ?? 1) >= 1) floorNums.add(Number(w.floor_level ?? 1));
        for (const fu of rawFurn) if (Number(fu.floor_level ?? 1) >= 1) floorNums.add(Number(fu.floor_level ?? 1));

        for (const fl of [...floorNums].sort((a, b) => a - b)) {
            const z0 = fl - 1;
            const z1 = fl;
            const items = [];

            for (const f of extraFloors.filter(it => it.fl === fl)) {
                items.push({ depth: f.rx + f.ry - 0.1, kind: 'floorSlab', data: f });
                if (f.isPillar) items.push({ depth: f.rx + f.ry + 0.25, kind: 'pillar', data: f });
                if (f.roofVariant) items.push({ depth: f.rx + f.ry + 1.5, kind: 'roofCap', data: f });
            }

            for (const fu of rawFurn.filter(it => Number(it.floor_level ?? 1) === fl)) {
                const ax = Number(fu.anchor_x);
                const ay = Number(fu.anchor_y);
                const wC = Number(fu.width_cells || 1);
                const hC = Number(fu.height_cells || 1);
                const corners = [
                    rotateIsoVertex(ax, ay, gridW, gridH, rot),
                    rotateIsoVertex(ax + wC, ay + hC, gridW, gridH, rot)
                ];
                const fx0 = Math.min(corners[0][0], corners[1][0]);
                const fx1 = Math.max(corners[0][0], corners[1][0]);
                const fy0 = Math.min(corners[0][1], corners[1][1]);
                const fy1 = Math.max(corners[0][1], corners[1][1]);
                items.push({
                    depth: (fx0 + fx1) * 0.5 + (fy0 + fy1) * 0.5 + 0.2,
                    kind: 'furniture',
                    data: { fu, fx0, fx1, fy0, fy1 }
                });
            }

            for (const w of rawWalls.filter(it => Number(it.floor_level ?? 1) === fl)) {
                const gx = Number(w.gx);
                const gy = Number(w.gy);
                const ux1 = gx - 1;
                const uy1 = gy - 1;
                const ux2 = w.orientation === 'H' ? gx : gx - 1;
                const uy2 = w.orientation === 'H' ? gy - 1 : gy;
                const pA = rotateIsoVertex(ux1, uy1, gridW, gridH, rot);
                const pB = rotateIsoVertex(ux2, uy2, gridW, gridH, rot);
                const midDepth = (pA[0] + pB[0]) * 0.5 + (pA[1] + pB[1]) * 0.5 + 0.45;
                items.push({ depth: midDepth, kind: 'wallEdge', data: { w, pA, pB } });
            }

            for (const c of cells.filter(it => it.fl === fl)) {
                items.push({ depth: c.rx + c.ry + 0.5, kind: 'cell', data: c });
            }

            items.sort((a, b) => a.depth - b.depth);

            for (const item of items) {
                if (item.kind === 'floorSlab') {
                    const f = item.data;
                    const slabCol = buildingState === 'abandoned' ? '#4d5d53' : f.color;
                    drawPrism(f.rx + 0.04, f.rx + 0.96, f.ry + 0.04, f.ry + 0.96, z0, z0 + 0.14, slabCol, 0.96);
                } else if (item.kind === 'pillar') {
                    const f = item.data;
                    drawPrism(f.rx + 0.34, f.rx + 0.66, f.ry + 0.34, f.ry + 0.66, z0 + 0.14, z1, f.color, 0.98);
                } else if (item.kind === 'furniture') {
                    const { fu, fx0, fx1, fy0, fy1 } = item.data;
                    const spec = getFurnitureSpec(fu.item_id);
                    const fCol = getFurnitureCategoryColor(spec?.category);
                    drawPrism(fx0 + 0.16, fx1 - 0.16, fy0 + 0.16, fy1 - 0.16, z0 + 0.14, z0 + 0.5, fCol, 0.95);
                } else if (item.kind === 'wallEdge') {
                    const { w, pA, pB } = item.data;
                    const wType = getWallEdgeType(w.edge_type);
                    drawIsoWallSegment(pA, pB, z0 + 0.08, z1, w.edge_type, w.color_hex || wType.colorHex);
                } else if (item.kind === 'roofCap') {
                    const f = item.data;
                    const rCol = buildingState === 'abandoned' ? '#4d5d53' : f.color;
                    drawIsoRoof(f.rx, f.ry, z1 - 0.14, f.roofVariant, rCol);
                } else if (item.kind === 'cell') {
                    const c = item.data;
                    const x0 = c.rx + 0.04;
                    const x1 = c.rx + 0.96;
                    const y0 = c.ry + 0.04;
                    const y1 = c.ry + 0.96;
                    const baseCol = buildingState === 'abandoned' ? '#4d5d53' : c.color;
                    const alpha = (c.variant === 'glass' || c.mat.id === 'kaca') ? 0.68 : 0.98;

                    if (c.kind === 'roof') {
                        drawIsoRoof(c.rx, c.ry, z0, c.variant || 'gable', baseCol);
                        continue;
                    }

                    if (c.kind === 'shape') {
                        if (c.variant === 'pillar') {
                            drawPrism(c.rx + 0.3, c.rx + 0.7, c.ry + 0.3, c.ry + 0.7, z0, z1, baseCol, 0.98);
                            continue;
                        }
                        if (c.variant === 'balcony') {
                            drawPrism(x0, x1, y0, y1, z0, z0 + 0.22, baseCol, 0.98);
                            const p1 = proj(x0, y1, z0 + 0.46);
                            const p2 = proj(x1, y1, z0 + 0.46);
                            const p3 = proj(x1, y0, z0 + 0.46);
                            ctx.strokeStyle = '#e2e8f0';
                            ctx.lineWidth = 1;
                            ctx.beginPath();
                            ctx.moveTo(p1[0], p1[1]);
                            ctx.lineTo(p2[0], p2[1]);
                            ctx.lineTo(p3[0], p3[1]);
                            ctx.stroke();
                            continue;
                        }
                        if (c.variant === 'stairs') {
                            drawPrism(x0, x1, y0, y1, z0, z0 + 0.33, baseCol, 0.98);
                            drawPrism(x0, x1, c.ry + 0.33, y1, z0 + 0.33, z0 + 0.66, baseCol, 0.98);
                            drawPrism(x0, x1, c.ry + 0.66, y1, z0 + 0.66, z1, baseCol, 0.98);
                            continue;
                        }
                    }

                    if (c.fl === 1 && ['garden', 'pool', 'greenhouse'].includes(c.mod.id)) {
                        drawPrism(x0, x1, y0, y1, z0, z0 + 0.26, c.mod.id === 'pool' ? '#06b6d4' : '#22c55e', c.mod.id === 'greenhouse' ? 0.78 : 0.95);
                        continue;
                    }

                    drawPrism(x0, x1, y0, y1, z0, z1, baseCol, alpha);

                    if (layerH >= 7 && (c.variant === 'glass' || c.mat.id === 'kaca' || ['bedroom_std', 'bedroom_lux', 'cafe_area', 'shop_stall', 'rental_room'].includes(c.mod.id))) {
                        const w0 = proj(c.rx + 0.28, y1, z0 + 0.32);
                        const w1 = proj(c.rx + 0.72, y1, z0 + 0.32);
                        const w2 = proj(c.rx + 0.72, y1, z0 + 0.74);
                        const w3 = proj(c.rx + 0.28, y1, z0 + 0.74);
                        drawPolygon(
                            ctx,
                            [w3, w2, w1, w0],
                            c.variant === 'glass' ? 'rgba(224,242,254,0.62)' : 'rgba(253,224,71,0.58)',
                            null
                        );
                    }

                    if (buildingState === 'abandoned' || buildingState === 'worn') {
                        const k0 = proj(c.rx + 0.2, y1, z0 + 0.2);
                        const k1 = proj(c.rx + 0.55, y1, z0 + 0.65);
                        ctx.strokeStyle = buildingState === 'abandoned' ? 'rgba(22,101,52,0.75)' : 'rgba(15,23,42,0.5)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(k0[0], k0[1]);
                        ctx.lineTo(k1[0], k1[1]);
                        ctx.stroke();
                    }
                }
            }
        }
    }

    // Header overlay kamera & status
    const dirNames = ['UTARA-BARAT', 'TIMUR-UTARA', 'SELATAN-TIMUR', 'BARAT-SELATAN'];
    ctx.fillStyle = '#cbd5e1';
    ctx.font = `bold 9px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    const floorSummary = hasAnyStruct ? `${maxFloor} LT` : 'KOSONG';
    ctx.fillText(`3D VOXEL (${floorSummary}${hasBasement ? ' + B1' : ''}) | SUDUT ${dirNames[rot]}`, boxX + 10, boxY + 14);

    if (buildingState === 'collapsed') {
        ctx.fillStyle = '#ef4444';
        ctx.textAlign = 'right';
        ctx.fillText('RUNTUH! BERSIHKAN PUING', boxX + boxW - 10, boxY + 14);
    } else if (buildingState === 'abandoned') {
        ctx.fillStyle = '#f97316';
        ctx.textAlign = 'right';
        ctx.fillText(`TERBENGKALAI (${Math.round(condPct)}%)`, boxX + boxW - 10, boxY + 14);
    } else if (buildingState === 'worn') {
        ctx.fillStyle = '#fbbf24';
        ctx.textAlign = 'right';
        ctx.fillText(`USANG (${Math.round(condPct)}%)`, boxX + boxW - 10, boxY + 14);
    }
}

function buildCanvasCacheSignature(payload) {
    const arch = extractArchLayers(payload);
    return JSON.stringify({
        id: payload.land?.id || 0,
        name: payload.land?.custom_name || '',
        w: payload.land?.width || 4,
        h: payload.land?.height || 4,
        theme: payload.land?.theme_id || 'minimalis',
        city: payload.land?.city_id || 'kota_sentral',
        cond: Math.round(Number(payload.land?.condition_pct ?? 100)),
        state: payload.land?.building_state || 'active',
        cam: Number(payload.cameraAngle || 0) % 4,
        likes: Number(payload.land?.like_count || 0),
        arch: Number(payload.stats?.architectureScore || 0),
        mode: payload.layoutMode || 'active',
        floor: Number(payload.viewFloor || 1),
        proj: payload.project ? `${payload.project.status}:${Math.floor(Number(payload.project.finishes_at || 0) / 10000)}` : 'none',
        cells: (payload.allCells || []).map(c => `${c.floor_level ?? c.floor}:${c.x},${c.y}:${c.module_id ?? c.mod}:${c.material_id ?? c.mat}:${c.block_kind || 'm'}:${c.shape_variant || ''}:${c.zone_name ?? c.zn}`).sort(),
        floors: arch.floorCells.map(f => `${f.floor_level ?? 1}:${f.x},${f.y}:${f.floor_material_id}:${f.roof_variant || ''}:${f.is_pillar || 0}:${f.color_hex || ''}`).sort(),
        walls: arch.wallEdges.map(w => `${w.floor_level ?? 1}:${w.orientation}:${w.gx},${w.gy}:${w.edge_type}:${w.color_hex || ''}`).sort(),
        furn: arch.furniture.map(f => `${f.id || 0}:${f.floor_level ?? 1}:${f.item_id}:${f.anchor_x},${f.anchor_y}:${f.rotation}`).sort(),
        rooms: arch.rooms.map(r => `${r.floorLevel ?? r.floor_level ?? 1}:${r.roomKey || r.room_key}:${r.customName || r.custom_name}:${r.isIndoorValid ? 1 : 0}`).sort()
    });
}

async function generatePropertyCanvasBuffer(payload, now = Date.now()) {
    const signature = buildCanvasCacheSignature(payload);
    if (PROPERTY_CANVAS_CACHE.has(signature)) {
        return PROPERTY_CANVAS_CACHE.get(signature);
    }

    const land = payload.land || { width: 4, height: 4, custom_name: 'Kavling', city_id: 'kota_sentral', theme_id: 'minimalis', condition_pct: 100 };
    const theme = getArchitectureTheme(land.theme_id);
    const city = getCity(land.city_id);
    const viewFloor = Number(payload.viewFloor || 1);
    const layoutMode = payload.layoutMode === 'draft' ? 'draft' : 'active';
    const allCells = payload.allCells || [];
    const archLayers = extractArchLayers(payload);
    const stats = payload.stats || {};
    const project = payload.project || null;

    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    // Latar belakang bertema
    const grad = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    grad.addColorStop(0, theme.bgHex);
    grad.addColorStop(1, theme.cardHex);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Strip aksen atas
    ctx.fillStyle = theme.accentHex;
    ctx.fillRect(0, 0, CANVAS_WIDTH, 4);

    // === SISI KIRI: DENAH GRID INTERAKTIF ===
    const leftPad = 20;
    const topPad = 18;
    const panelW = 390;
    const panelH = CANVAS_HEIGHT - 36;

    drawRoundedRect(ctx, leftPad, topPad, panelW, panelH, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Header grid
    ctx.fillStyle = '#f8fafc';
    ctx.font = `bold 13px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    const floorTitle = cleanCanvasText(getFloorLabel(viewFloor));
    ctx.fillText(`DENAH ${land.width}x${land.height} - ${floorTitle}`, leftPad + 14, topPad + 24);

    // Pill status draft/active
    const modeLabel = layoutMode === 'draft' ? 'MODE DRAFT' : 'AKTIF';
    ctx.fillStyle = layoutMode === 'draft' ? '#f59e0b' : '#22c55e';
    drawRoundedRect(ctx, leftPad + panelW - 96, topPad + 10, 82, 20, 6);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = `bold 10px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(modeLabel, leftPad + panelW - 55, topPad + 24);

    // Area petak grid (mendukung hingga 10x10 XL Megalopolis)
    const gridW = Math.max(3, Math.min(10, Number(land.width || 4)));
    const gridH = Math.max(3, Math.min(10, Number(land.height || 4)));
    const availW = panelW - 44;
    const availH = panelH - 64;
    const cellSize = Math.floor(Math.min(availW / gridW, availH / gridH));
    const startX = leftPad + 28 + Math.floor((availW - cellSize * gridW) / 2);
    const startY = topPad + 46 + Math.floor((availH - cellSize * gridH) / 2);

    // Header kolom A..J
    ctx.fillStyle = theme.accentHex;
    ctx.font = `bold ${gridW > 8 ? 10 : 11}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    for (let x = 0; x < gridW; x++) {
        ctx.fillText(String.fromCharCode(65 + x), startX + x * cellSize + cellSize / 2, startY - 6);
    }
    // Header baris 1..10
    ctx.textAlign = 'right';
    for (let y = 0; y < gridH; y++) {
        ctx.fillText(String(y + 1), startX - 7, startY + y * cellSize + cellSize / 2 + 4);
    }

    // Index sel legacy & layer lantai di lantai yg dilihat
    const floorCellMap = new Map();
    for (const c of allCells) {
        const fl = Number(c.floor_level ?? c.floor ?? 1);
        if (fl !== viewFloor) continue;
        floorCellMap.set(`${c.x}:${c.y}`, c);
    }

    const layer1Map = new Map();
    for (const fc of archLayers.floorCells) {
        const fl = Number(fc.floor_level ?? 1);
        if (fl !== viewFloor) continue;
        layer1Map.set(`${Number(fc.x)}:${Number(fc.y)}`, fc);
    }

    for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
            const cx = startX + x * cellSize + 2;
            const cy = startY + y * cellSize + 2;
            const cw = cellSize - 4;
            const ch = cellSize - 4;
            const cell = floorCellMap.get(`${x}:${y}`);
            const fc = layer1Map.get(`${x}:${y}`);

            if (!cell && !fc) {
                drawRoundedRect(ctx, cx, cy, cw, ch, 4);
                ctx.fillStyle = theme.gridBgHex;
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.09)';
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.fillStyle = 'rgba(255,255,255,0.22)';
                ctx.font = `${cellSize < 44 ? 9 : 10}px ${FONT_FAMILY}`;
                ctx.textAlign = 'center';
                ctx.fillText(`${String.fromCharCode(65 + x)}${y + 1}`, cx + cw / 2, cy + ch / 2 + 3);
                continue;
            }

            if (cell) {
                const mod = getBuildingModule(cell.module_id || cell.mod);
                const mat = getStructuralMaterial(cell.material_id || cell.mat);
                const fillHex = cell.color_hex || mod.defaultColor || mat.colorHex;

                drawMaterialTexture(ctx, cx, cy, cw, ch, mat.id, fillHex);

                drawRoundedRect(ctx, cx, cy, cw, ch, 4);
                ctx.strokeStyle = mat.colorHex;
                ctx.lineWidth = 2;
                ctx.stroke();

                const badgeH = cellSize >= 54 ? 16 : 13;
                drawRoundedRect(ctx, cx + 3, cy + 3, cw - 6, badgeH, 3);
                ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
                ctx.fill();

                ctx.fillStyle = '#f8fafc';
                ctx.font = `bold ${cellSize < 44 ? 8 : 10}px ${FONT_FAMILY}`;
                ctx.textAlign = 'center';
                ctx.fillText(getModuleShortCode(mod.id), cx + cw / 2, cy + (cellSize >= 54 ? 14 : 12));

                if (cellSize >= 52) {
                    const zn = cleanCanvasText(cell.zone_name || mod.shortLabel).slice(0, 9);
                    ctx.fillStyle = 'rgba(255,255,255,0.92)';
                    ctx.font = `9px ${FONT_FAMILY}`;
                    ctx.fillText(zn, cx + cw / 2, cy + ch - 6);
                }
            } else {
                const fMat = getFloorMaterial(fc.floor_material_id || 'kayu');
                const fillHex = fc.color_hex || fMat.colorHex;
                drawMaterialTexture(ctx, cx, cy, cw, ch, fMat.id, fillHex);

                drawRoundedRect(ctx, cx, cy, cw, ch, 4);
                ctx.strokeStyle = 'rgba(255,255,255,0.22)';
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
                ctx.font = `${cellSize < 44 ? 8 : 9}px ${FONT_FAMILY}`;
                ctx.textAlign = 'left';
                ctx.fillText(`${String.fromCharCode(65 + x)}${y + 1}`, cx + 4, cy + ch - 4);
            }

            if (fc && Number(fc.is_pillar || 0) === 1) {
                ctx.fillStyle = '#e2e8f0';
                ctx.fillRect(cx + cw / 2 - 4, cy + ch / 2 - 4, 8, 8);
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 1;
                ctx.strokeRect(cx + cw / 2 - 4, cy + ch / 2 - 4, 8, 8);
            }
            if (fc && fc.roof_variant && fc.roof_variant !== 'none') {
                ctx.fillStyle = 'rgba(15,23,42,0.78)';
                drawRoundedRect(ctx, cx + cw - 15, cy + 2, 13, 11, 2);
                ctx.fill();
                ctx.fillStyle = '#fbbf24';
                ctx.font = `bold 8px ${FONT_FAMILY}`;
                ctx.textAlign = 'center';
                ctx.fillText('A', cx + cw - 8.5, cy + 10);
            }
        }
    }

    // Layer 4: Multi-size Furniture pada lantai viewFloor
    for (const fu of archLayers.furniture) {
        if (Number(fu.floor_level ?? 1) !== viewFloor) continue;
        const ax = Number(fu.anchor_x);
        const ay = Number(fu.anchor_y);
        const wC = Number(fu.width_cells || 1);
        const hC = Number(fu.height_cells || 1);
        if (ax < 0 || ay < 0 || ax >= gridW || ay >= gridH) continue;

        const spec = getFurnitureSpec(fu.item_id);
        const borderCol = getFurnitureCategoryColor(spec?.category);
        const fx = startX + ax * cellSize + 5;
        const fy = startY + ay * cellSize + 5;
        const fw = Math.min(gridW - ax, wC) * cellSize - 10;
        const fh = Math.min(gridH - ay, hC) * cellSize - 10;

        drawRoundedRect(ctx, fx, fy, fw, fh, 5);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
        ctx.fill();
        ctx.strokeStyle = borderCol;
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // Penanda arah hadap N/E/S/W
        const rotDir = String(fu.rotation || 'S').toUpperCase();
        ctx.fillStyle = borderCol;
        if (rotDir === 'N') ctx.fillRect(fx + fw / 2 - 4, fy, 8, 3);
        else if (rotDir === 'E') ctx.fillRect(fx + fw - 3, fy + fh / 2 - 4, 3, 8);
        else if (rotDir === 'W') ctx.fillRect(fx, fy + fh / 2 - 4, 3, 8);
        else ctx.fillRect(fx + fw / 2 - 4, fy + fh - 3, 8, 3);

        ctx.fillStyle = '#f8fafc';
        ctx.font = `bold ${cellSize < 44 ? 8 : 9}px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.fillText(getFurnitureShortCode(fu.item_id), fx + fw / 2, fy + fh / 2 + 3);
    }

    // Layer 2: Edge Walls (H/V 1-based) pada lantai viewFloor
    for (const we of archLayers.wallEdges) {
        if (Number(we.floor_level ?? 1) !== viewFloor) continue;
        const gx = Number(we.gx);
        const gy = Number(we.gy);
        const isH = we.orientation === 'H';
        const px1 = startX + (gx - 1) * cellSize;
        const py1 = startY + (gy - 1) * cellSize;
        const px2 = isH ? px1 + cellSize : px1;
        const py2 = isH ? py1 : py1 + cellSize;
        const edgeType = we.edge_type || 'wall';

        ctx.save();
        ctx.lineCap = 'round';
        if (edgeType === 'arch') {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = '#a78bfa';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(px1, py1);
            ctx.lineTo(px2, py2);
            ctx.stroke();
        } else if (edgeType === 'fence') {
            ctx.strokeStyle = '#b45309';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(px1, py1);
            ctx.lineTo(px2, py2);
            ctx.stroke();
        } else if (edgeType === 'door') {
            const mx1 = px1 + (px2 - px1) * 0.25;
            const my1 = py1 + (py2 - py1) * 0.25;
            const mx2 = px1 + (px2 - px1) * 0.75;
            const my2 = py1 + (py2 - py1) * 0.75;
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(px1, py1);
            ctx.lineTo(mx1, my1);
            ctx.moveTo(mx2, my2);
            ctx.lineTo(px2, py2);
            ctx.stroke();
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(mx1, my1);
            ctx.lineTo(mx2, my2);
            ctx.stroke();
        } else if (edgeType === 'window' || edgeType === 'glass_wall') {
            ctx.strokeStyle = edgeType === 'glass_wall' ? '#7dd3fc' : '#38bdf8';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(px1, py1);
            ctx.lineTo(px2, py2);
            ctx.stroke();
        } else {
            ctx.strokeStyle = we.color_hex || '#f8fafc';
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(px1, py1);
            ctx.lineTo(px2, py2);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Label Ruangan Hasil Flood-Fill pada viewFloor
    for (const r of archLayers.rooms) {
        const fl = Number(r.floorLevel ?? r.floor_level ?? 1);
        if (fl !== viewFloor) continue;
        const rCells = r.cells || [];
        if (rCells.length === 0) continue;
        let sumX = 0;
        let sumY = 0;
        for (const c of rCells) {
            sumX += Number(c.x);
            sumY += Number(c.y);
        }
        const cx = startX + (sumX / rCells.length + 0.5) * cellSize;
        const cy = startY + (sumY / rCells.length) * cellSize + 13;
        const label = cleanCanvasText(r.customName || r.custom_name || 'Ruang').slice(0, 14);
        const pillW = Math.min(cellSize * 1.6, Math.max(44, label.length * 6 + 10));

        drawRoundedRect(ctx, cx - pillW / 2, cy - 8, pillW, 14, 4);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fill();
        ctx.strokeStyle = r.isIndoorValid ? '#22c55e' : '#f59e0b';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.font = `bold 8px ${FONT_FAMILY}`;
        ctx.textAlign = 'center';
        ctx.fillText(label, cx, cy + 2);
    }

    // === SISI KANAN: KARTU INFO & SILUET 2.5D ===
    const rightX = leftPad + panelW + 16;
    const rightW = CANVAS_WIDTH - rightX - 20;

    drawRoundedRect(ctx, rightX, topPad, rightW, panelH, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Nama properti & lokasi
    const parcelTag = land.parcel_code ? ` [${land.parcel_code}]` : '';
    ctx.fillStyle = theme.accentHex;
    ctx.font = `bold 11px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.fillText(`${cleanCanvasText(city.name).toUpperCase()}${parcelTag}`, rightX + 16, topPad + 22);

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 16px ${FONT_FAMILY}`;
    ctx.fillText(cleanCanvasText(land.custom_name || 'Kavling Pribadi').slice(0, 26), rightX + 16, topPad + 42);

    const archScoreText = stats.architectureScore ? ` | Skor ${stats.architectureScore} (${stats.architectureGrade || 'C'})` : '';
    const likeText = Number(land.like_count || 0) > 0 ? ` | Like ${Number(land.like_count)}` : '';
    ctx.fillStyle = '#94a3b8';
    ctx.font = `10px ${FONT_FAMILY}`;
    ctx.fillText(`Tema: ${cleanCanvasText(theme.name)} | Kondisi: ${Math.round(Number(land.condition_pct ?? 100))}%${archScoreText}${likeText}`, rightX + 16, topPad + 58);

    // Render 3D Isometrik Voxel sesungguhnya
    const cameraAngle = Number(payload.cameraAngle || 0);
    drawIsometricVoxelBuilding(ctx, rightX + 16, topPad + 66, rightW - 32, 162, land, allCells, stats, theme, cameraAngle, archLayers);

    // Statistik Fasilitas Ringkas (2 kolom)
    const statY = topPad + 236;
    const sl = stats.storageLimits || { kulkas: 0, freezer: 0, gudang: 0 };
    const stressLabel = cleanCanvasText(stats.structuralStress?.statusLabel || 'Aman');
    const statRows = [
        [`Tidur`, `+${stats.sleepEnergyBonus ?? 50} EN`],
        [`Dapur`, `${stats.cookingSlots ?? 0} Tungku`],
        [`Kapasitas`, `K:${sl.kulkas || 0} F:${sl.freezer || 0} G:${sl.gudang || 0}`],
        [`Arsitektur`, `${stats.architectureScore ?? 0}/100 (${stats.architectureGrade || 'C'})`],
        [`Struktur`, stressLabel.slice(0, 14)],
        [`Daya Tarik`, `${stats.appealScore ?? 0} pts`]
    ];

    const colW = Math.floor((rightW - 42) / 2);
    for (let i = 0; i < statRows.length; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const sx = rightX + 16 + col * (colW + 10);
        const sy = statY + row * 24;

        drawRoundedRect(ctx, sx, sy, colW, 20, 5);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fill();

        ctx.fillStyle = '#94a3b8';
        ctx.font = `10px ${FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.fillText(statRows[i][0], sx + 7, sy + 14);

        ctx.fillStyle = '#f8fafc';
        ctx.font = `bold 10px ${FONT_FAMILY}`;
        ctx.textAlign = 'right';
        ctx.fillText(statRows[i][1], sx + colW - 7, sy + 14);
    }

    // Progress Konstruksi / Appraisal Bawah
    const barY = topPad + panelH - 52;
    const barW = rightW - 32;
    drawRoundedRect(ctx, rightX + 16, barY, barW, 38, 8);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fill();

    if (project && project.status === 'building') {
        const total = Math.max(1, Number(project.finishes_at) - Number(project.started_at));
        const elapsed = Math.max(0, Math.min(total, now - Number(project.started_at)));
        const pct = Math.min(100, Math.round((elapsed / total) * 100));
        const remSec = Math.max(0, Math.ceil((Number(project.finishes_at) - now) / 1000));

        ctx.fillStyle = '#f8fafc';
        ctx.font = `bold 10px ${FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.fillText(`KONSTRUKSI BERJALAN (${pct}% - SISA ${remSec}s)`, rightX + 24, barY + 15);

        drawRoundedRect(ctx, rightX + 24, barY + 21, barW - 16, 9, 4);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fill();

        drawRoundedRect(ctx, rightX + 24, barY + 21, Math.max(8, Math.round((barW - 16) * (pct / 100))), 9, 4);
        ctx.fillStyle = '#22c55e';
        ctx.fill();
    } else if (project && project.status === 'funding') {
        ctx.fillStyle = '#fbbf24';
        ctx.font = `bold 11px ${FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.fillText('MENUNGGU SETORAN BAHAN PROYEK', rightX + 24, barY + 23);
    } else {
        const njop = Number(stats.totalAppraisalValue || land.purchase_price || 0);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = `10px ${FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.fillText('NILAI APPRAISAL (NJOP)', rightX + 24, barY + 15);

        ctx.fillStyle = theme.accentHex;
        ctx.font = `bold 12px ${FONT_FAMILY}`;
        ctx.fillText(`Lp ${njop.toLocaleString('id-ID')}`, rightX + 24, barY + 30);
    }

    const buffer = canvas.toBuffer('image/png');
    if (PROPERTY_CANVAS_CACHE.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = PROPERTY_CANVAS_CACHE.keys().next().value;
        PROPERTY_CANVAS_CACHE.delete(oldestKey);
    }
    PROPERTY_CANVAS_CACHE.set(signature, buffer);
    return buffer;
}

async function buildPropertyCanvasAttachment(payload, now = Date.now()) {
    const sig = buildCanvasCacheSignature(payload);
    const shortHash = crypto.createHash('md5').update(sig).digest('hex').slice(0, 12);
    const fileName = `property_${payload.land?.id || 0}_${shortHash}.png`;
    const buffer = await generatePropertyCanvasBuffer(payload, now);
    const attachment = new AttachmentBuilder(buffer, {
        name: fileName,
        description: `Denah Properti ${cleanCanvasText(payload.land?.custom_name || 'Kavling')}`
    });

    return {
        buffer,
        fileName,
        url: `attachment://${fileName}`,
        attachment
    };
}

function clearPropertyCanvasCache() {
    PROPERTY_CANVAS_CACHE.clear();
}

module.exports = {
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    generatePropertyCanvasBuffer,
    buildPropertyCanvasAttachment,
    clearPropertyCanvasCache
};
