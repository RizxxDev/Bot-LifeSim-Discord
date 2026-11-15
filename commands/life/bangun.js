const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerInventory } = require('../../services/inventoryService');
const {
    getPlayerLands,
    getLandById,
    getLandCells,
    ensureDraftInitialized,
    computeLandStats,
    updateLandMetadata
} = require('../../services/landService');
const {
    ENERGY_BOOST_COST,
    calculateConstructionRab,
    getLandDepotMap,
    getActiveConstructionProject,
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
} = require('../../services/constructionService');
const {
    placeFurniture,
    rotateOrMoveFurniture,
    pickupFurniture
} = require('../../services/furnitureService');
const { renameLandRoom } = require('../../services/roomDetectionService');
const { buildPropertyCanvasAttachment } = require('../../services/propertyCanvasService');
const {
    getFloorLabel,
    STRUCTURAL_MATERIALS,
    getStructuralMaterial,
    FLOOR_MATERIALS,
    getFloorMaterial,
    WALL_EDGE_TYPES,
    getWallEdgeType,
    ROOF_VARIANTS,
    getRoofVariant,
    BUILDING_MODULES,
    SHAPE_BLOCKS,
    getBuildingModule,
    MODULE_CATEGORIES,
    ARCHITECTURE_THEMES,
    getArchitectureTheme,
    STARTER_TEMPLATES,
    validateCellPlacement
} = require('../../data/buildingModules');
const { getFurnitureSpec, normalizeFurnitureRotation } = require('../../data/furniture');
const { getCity, getCityZoning } = require('../../data/cities');
const { getItem } = require('../../data/items');
const {
    COLORS,
    formatLp,
    formatDuration,
    formatVitalsCompact
} = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select,
    numberModal,
    parseModalNumber,
    respondOrUpdate
} = require('../../utils/panelBuilder');
const { scheduleAutoUpdate, cancelAutoUpdate } = require('../../services/autoUpdateService');
const { isPropertyUnderDevelopment, buildPropertyUnderDevPanel } = require('../../utils/featureFlags');

const studioSessions = new Map();

function getStudioSession(userId) {
    let s = studioSessions.get(userId);
    if (!s) {
        s = {
            landId: null,
            floorLevel: 1,
            maxUnlockedFloor: 6,
            viewMode: 'draft',
            studioMode: 'floor', // 'floor' | 'wall' | 'roof' | 'furniture' | 'legacy'
            paletteMode: 'module',
            moduleId: 'bedroom_std',
            materialId: 'bata',
            floorMaterialId: 'kayu',
            floorPillar: false,
            wallEdgeType: 'wall',
            roofVariant: 'gable',
            selectedBagFurnId: null,
            selectedPlacedFurnId: null,
            cameraAngle: 0,
            pendingWithdrawItemId: null
        };
        studioSessions.set(userId, s);
    }
    return s;
}

function getCatShort(category) {
    if (category === 'shape') return 'Bentuk';
    if (category === 'roof') return 'Atap';
    const found = MODULE_CATEGORIES.find(c => c.id === category);
    return found ? found.name.split(' ')[0] : 'Umum';
}

function formatMatNeedsShort(reqMap = {}, depotMap = {}, limit = 8) {
    const entries = Object.entries(reqMap);
    if (entries.length === 0) return '*Tidak butuh bahan tambahan*';
    const parts = entries.slice(0, limit).map(([itemId, need]) => {
        const it = getItem(itemId);
        const have = Number(depotMap[itemId] || 0);
        const ok = have >= need;
        return `${ok ? '✅' : '🔸'} ${it?.emoji || '📦'} ${it?.name || itemId}: **${have}/${need}**`;
    });
    if (entries.length > limit) {
        parts.push(`*+${entries.length - limit} jenis lainnya*`);
    }
    return parts.join(' · ');
}

function formatMatRefundShort(refundMap = {}) {
    const entries = Object.entries(refundMap);
    if (entries.length === 0) return '';
    return entries
        .slice(0, 5)
        .map(([itemId, qty]) => {
            const it = getItem(itemId);
            return `${qty}× ${it?.emoji || '📦'} ${it?.name || itemId}`;
        })
        .join(', ');
}

function buildFloorSelectOptions(draftCells = [], session = {}, draftFloorCells = [], draftWallEdges = []) {
    const countsByFloor = new Map();
    let highest = Math.max(5, Number(session.maxUnlockedFloor || 6), Number(session.floorLevel || 1));
    for (const c of draftCells) {
        const fl = Number(c.floor_level ?? c.floor ?? 1);
        countsByFloor.set(fl, (countsByFloor.get(fl) || 0) + 1);
        if (fl > highest) highest = fl;
    }
    for (const fc of draftFloorCells) {
        const fl = Number(fc.floor_level ?? 1);
        countsByFloor.set(fl, (countsByFloor.get(fl) || 0) + 1);
        if (fl > highest) highest = fl;
    }
    for (const we of draftWallEdges) {
        const fl = Number(we.floor_level ?? 1);
        if (!countsByFloor.has(fl)) countsByFloor.set(fl, 0);
        if (fl > highest) highest = fl;
    }

    const floorList = [-1];
    const startFloor = highest > 20 ? Math.max(1, Number(session.floorLevel || 1) - 10) : 1;
    const endFloor = Math.min(100, Math.max(highest, startFloor + 21));
    for (let fl = startFloor; fl <= endFloor; fl++) {
        floorList.push(fl);
    }

    const opts = floorList.slice(0, 24).map(fl => {
        const cnt = countsByFloor.get(fl) || 0;
        const label = getFloorLabel(fl);
        return {
            label: `${label}${cnt > 0 ? ` (${cnt} sel)` : ''}`,
            value: String(fl),
            emoji: fl === -1 ? '🕳️' : '🪜',
            description: fl === -1 ? 'Lantai Bawah Tanah (Min. Beton/Baja)' : `Edit & tinjau denah ${label}`,
            default: fl === Number(session.floorLevel)
        };
    });

    if (highest < 100) {
        opts.push({
            label: `➕ Tambah Lantai ${highest + 1}`,
            value: '__add_floor__',
            emoji: '⬆️',
            description: `Buka lantai baru ke-${highest + 1} (Bebas tanpa batas ketinggian!)`
        });
    }
    return opts.slice(0, 25);
}

async function fetchBuildState(userId, now = Date.now()) {
    const session = getStudioSession(userId);
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, userId, now, false);
        const p = synced.player;
        const lands = await getPlayerLands(conn, userId, null, false);

        if (lands.length === 0) {
            return {
                player: p,
                lands: [],
                land: null,
                activeCells: [],
                draftCells: [],
                project: null,
                depot: {},
                invRows: [],
                gudangRows: [],
                stats: null,
                activeStats: null,
                rab: null
            };
        }

        let selected = lands.find(l => Number(l.id) === Number(session.landId));
        if (!selected) {
            const localCity = p.current_city || 'kota_sentral';
            selected =
                lands.find(l => l.city_id === localCity && Number(l.is_primary) === 1) ||
                lands.find(l => l.city_id === localCity) ||
                lands[0];
        }
        session.landId = Number(selected.id);

        const syncRes = await syncLandConstruction(conn, selected.id, now);
        if (syncRes.completed) {
            selected = (await getLandById(conn, selected.id, false)) || selected;
        }

        await ensureDraftInitialized(conn, selected.id);
        const activeCells = await getLandCells(conn, selected.id, 'active');
        const draftCells = await getLandCells(conn, selected.id, 'draft');
        const project = await getActiveConstructionProject(conn, selected.id, false);
        const depot = await getLandDepotMap(conn, selected.id);
        const invRows = await getPlayerInventory(conn, userId, false, 'bag', now);
        const gudangRows = await getPlayerInventory(conn, userId, false, 'gudang', now, selected.id);

        const zoning = getCityZoning(selected.city_id);
        const stats = computeLandStats(draftCells, selected, zoning);
        const activeStats = computeLandStats(activeCells, selected, zoning);
        const rab = calculateConstructionRab(draftCells, activeCells, selected.condition_pct);

        return {
            player: p,
            lands,
            land: selected,
            activeCells,
            draftCells,
            activeFloorCells: activeCells._archData?.floorCells || [],
            draftFloorCells: draftCells._archData?.floorCells || [],
            activeWallEdges: activeCells._archData?.wallEdges || [],
            draftWallEdges: draftCells._archData?.wallEdges || [],
            placedFurniture: activeCells._archData?.furniture || [],
            project,
            depot,
            invRows,
            gudangRows,
            stats,
            activeStats,
            rab,
            justCompleted: Boolean(syncRes.completed)
        };
    });
}

function scheduleBuildAutoUpdate(userId, interaction, state) {
    if (!interaction || interaction.isLiveSyncProbe) return;
    const proj = state?.project;
    if (!proj || proj.status !== 'building') {
        cancelAutoUpdate(`bangun:${userId}`);
        return;
    }
    const remMs = Number(proj.finishes_at || 0) - Date.now();
    if (remMs <= 0) {
        cancelAutoUpdate(`bangun:${userId}`);
        return;
    }
    scheduleAutoUpdate(`bangun:${userId}`, interaction, Math.max(500, remMs + 500), async () => {
        const readyNow = Date.now();
        const refreshed = await fetchBuildState(userId, readyNow);
        const payload = await buildStudioPanel({
            ownerId: userId,
            state: refreshed,
            banner: {
                type: 'success',
                text: '🎉 **Konstruksi 3D Selesai!** Bangunan barumu resmi berdiri dan aktif digunakan.'
            },
            now: readyNow
        });
        return { ...payload, attachments: [] };
    });
}

async function buildStudioPanel({ ownerId, state, banner = null, now = Date.now() }) {
    const p = state.player;
    const session = getStudioSession(ownerId);

    if (!state.land) {
        cancelAutoUpdate(`bangun:${ownerId}`);
        const row = new ActionRowBuilder().addComponents(
            btn('tanah', 'map_tab', ownerId, {
                label: 'Beli Kavling (/tanah)',
                emoji: '🗺️',
                style: ButtonStyle.Success
            }, now),
            btn('shop', 'page', ownerId, {
                label: 'Toko Material (/shop)',
                emoji: '🧱',
                style: ButtonStyle.Primary,
                arg: 'material:1'
            }, now),
            btn('gather', 'home', ownerId, {
                label: 'Cari Bahan (/gather)',
                emoji: '🌲',
                style: ButtonStyle.Secondary
            }, now)
        );
        return buildPanel({
            mod: 'bangun',
            ownerId,
            accentColor: COLORS.WARNING,
            title: '🏗️ Studio Voxel 3D & Blueprint (/bangun)',
            banner,
            blocks: [
                '⚠️ **Kamu belum memiliki kavling tanah milik sendiri!**',
                [
                    'Untuk mulai membangun rumah, menara pencakar langit, atau kompleks usaha 3D:',
                    '1. Buka **`/tanah`** dan pilih kavling kosong atau lelang sitaan (`S 4×4` s/d `XL 10×10`, atau ajukan KPR `/credit`).',
                    '2. Kembali ke **`/bangun`** untuk merancang bebas setiap lantai secara 3D isometrik!'
                ].join('\n')
            ],
            rows: [row],
            footer: 'Beli kavling terbatas kota lewat /tanah terlebih dahulu.',
            now
        });
    }

    const land = state.land;
    const city = getCity(land.city_id);
    const theme = getArchitectureTheme(land.theme_id);
    const isBuilding = state.project?.status === 'building';
    const isDraftMode = session.viewMode !== 'active';
    const studioMode = session.studioMode || 'floor';
    const isShapeMode = session.paletteMode === 'shape';
    const displayCells = isDraftMode ? state.draftCells : state.activeCells;
    const displayFloors = isDraftMode ? state.draftFloorCells : state.activeFloorCells;
    const displayWalls = isDraftMode ? state.draftWallEdges : state.activeWallEdges;
    const displayStats = isDraftMode ? state.stats : state.activeStats;

    const attachment = await buildPropertyCanvasAttachment({
        land,
        allCells: displayCells,
        floorCells: displayFloors,
        wallEdges: displayWalls,
        furniture: state.placedFurniture,
        rooms: displayStats.detectedRooms || [],
        stats: displayStats,
        viewFloor: session.floorLevel,
        layoutMode: isDraftMode ? 'draft' : 'active',
        cameraAngle: session.cameraAngle,
        project: state.project
    }, now);

    const selMod = getBuildingModule(session.moduleId);
    const selMat = getStructuralMaterial(session.materialId);
    const selFloorMat = getFloorMaterial(session.floorMaterialId);
    const selWallType = getWallEdgeType(session.wallEdgeType);
    const selRoofVar = getRoofVariant(session.roofVariant);
    const brushCheck = validateCellPlacement(selMat.id, session.floorLevel, selMod.id);

    const floorRooms = (displayStats.detectedRooms || []).filter(r => Number(r.floorLevel) === Number(session.floorLevel));
    const floorFurns = (state.placedFurniture || []).filter(f => Number(f.floor_level) === Number(session.floorLevel));
    const bagFurnItems = (state.invRows || []).filter(r => Boolean(getFurnitureSpec(r.item_id)));

    if (!session.selectedBagFurnId && bagFurnItems.length > 0) {
        session.selectedBagFurnId = bagFurnItems[0].item_id;
    }
    const selPlacedFurn = (state.placedFurniture || []).find(f => Number(f.id) === Number(session.selectedPlacedFurnId))
        || floorFurns[0]
        || state.placedFurniture?.[0]
        || null;
    if (selPlacedFurn) session.selectedPlacedFurnId = Number(selPlacedFurn.id);

    const modeBadge = isDraftMode ? '📐 **Mode: DRAFT 3D**' : '🏠 **Mode: AKTIF**';
    const floorLabel = getFloorLabel(session.floorLevel);
    const stress = displayStats.structuralStress || { statusLabel: 'Aman', overHeightCells: 0, dailyExtraDecay: 0 };

    let brushLine = '';
    if (studioMode === 'floor') {
        brushLine = `• 🪜 **Layer 1 (Lantai & Pilar):** ${selFloorMat.emoji} **${selFloorMat.name}** | Pilar Tengah: ${session.floorPillar ? '**AKTIF (◼)**' : '*Nonaktif*'} @ **${floorLabel}** | ${modeBadge}`;
    } else if (studioMode === 'wall') {
        brushLine = `• 🧱 **Layer 2 (Dinding/Pintu):** ${selWallType.emoji} **${selWallType.name}** ${selWallType.enclosesRoom ? '*(Menutup Ruangan)*' : '*(Bukaan / Pagar)*'} @ **${floorLabel}** | ${modeBadge}`;
    } else if (studioMode === 'roof') {
        brushLine = `• 🏠 **Layer 3 (Atap):** ${selRoofVar.emoji} **${selRoofVar.name}** @ **${floorLabel}** | ${modeBadge}`;
    } else if (studioMode === 'furniture') {
        const bagSpec = session.selectedBagFurnId ? getFurnitureSpec(session.selectedBagFurnId) : null;
        const bagSummary = bagSpec ? `${bagSpec.emoji} **${bagSpec.name}** (*Siap Pasang*)` : '*Tas Perabot Kosong*';
        const placedSpec = selPlacedFurn ? getFurnitureSpec(selPlacedFurn.item_id) : null;
        const placedSummary = selPlacedFurn
            ? `${placedSpec?.emoji || '🛋️'} **${placedSpec?.name || selPlacedFurn.item_id}** @ \`${String.fromCharCode(65 + Number(selPlacedFurn.anchor_x))}${Number(selPlacedFurn.anchor_y) + 1}\` [${selPlacedFurn.rotation}]`
            : '*Belum ada perabot terpasang*';
        brushLine = `• 🛋️ **Layer 4 (Perabot & Ruang):** Tas: ${bagSummary} | Pilih: ${placedSummary} @ **${floorLabel}**`;
    } else {
        brushLine = `• 🖌️ **Modul Cepat (${isShapeMode ? 'Bentuk & Atap' : 'Ruangan'}):** ${selMod.emoji} **${selMod.name}** + ${selMat.emoji} **${selMat.shortName}** @ **${floorLabel}** | ${modeBadge}`;
    }

    const roomListLine = floorRooms.length > 0
        ? `• 🚪 **Ruangan ${floorLabel}:** ${floorRooms.slice(0, 4).map((r, idx) => `[${idx + 1}] **${r.customName}** (${r.cellCount}ptk ${r.isIndoorValid ? '✅' : '🌬️Terbuka'})`).join(' · ')}`
        : null;
    const outdoorWarnCount = (displayStats.furnitureDetails || []).filter(d => d.isOutdoorPenalty).length;

    const specLine = [
        `• 📍 **Kavling:** ${city.emoji} ${city.shortName} · **${land.custom_name}** (\`${land.width}×${land.height}\`) · Kondisi **${Math.round(Number(land.condition_pct ?? 100))}%** · ${theme.emoji} ${theme.name}`,
        brushLine,
        studioMode === 'legacy' && !brushCheck.ok
            ? `• 🔴 **Kuas Terblokir:** ${brushCheck.error}`
            : (studioMode === 'legacy' && brushCheck.warning ? `• ⚠️ **Catatan Struktur:** ${brushCheck.warning}` : null),
        roomListLine,
        outdoorWarnCount > 0 ? `• 🌦️ **Peringatan Outdoor:** ${outdoorWarnCount} perabot di ruang terbuka terkena penalti efektivitas **-50%** (tutup dengan Dinding + Atap!).` : null,
        `• 🏆 **Skor Arsitektur:** **${displayStats.architectureScore}/100 (${displayStats.architectureGrade})** · 🏗️ **Stress:** ${stress.statusLabel} · 💰 **NJOP:** ${formatLp(displayStats.totalAppraisalValue)}`
    ].filter(Boolean).join('\n');

    let projectLine = '';
    if (isBuilding) {
        const endUnix = Math.floor(Number(state.project.finishes_at) / 1000);
        projectLine = [
            `🔨 **KONSTRUKSI SEDANG BERJALAN!** Estimasi selesai: <t:${endUnix}:R>`,
            `• ⚡ Percepat **-20%** dengan **Kerja (-${ENERGY_BOOST_COST}⚡)** atau **Sewa Kontraktor (-45%)**.`
        ].join('\n');
    } else if (!state.rab.ok) {
        projectLine = `🔴 **Validasi Struktur 3D:** ${state.rab.validationErrors.slice(0, 2).join(' | ')}`;
    } else if (!state.rab.hasChanges) {
        projectLine = studioMode === 'furniture'
            ? `✅ Struktur aktif siap ditata. Beli perabot baru di \`/shop\` (**Toko Furnitur**) atau rakit di **Workshop** \`/property\`!`
            : `✅ Blueprint **Draft** identik dengan bangunan aktif. Pilih layer & edit area/dinding untuk mendesain 3D!`;
    } else if (state.rab.changedStructuralCells === 0 && state.rab.removedCells === 0) {
        projectLine = `✨ **Perubahan Non-Struktural (${state.rab.renamedOnlyCells} elemen):** Ubah nama/warna **GRATIS & Instan**. Klik **Terapkan Gratis**!`;
    } else {
        const refundStr = formatMatRefundShort(state.rab.refundMaterials);
        projectLine = [
            `📋 **RAB (${state.rab.changedStructuralCells} baru/ubah, ${state.rab.removedCells} bongkar · ${formatDuration(state.rab.durationMs)}):** ${formatMatNeedsShort(state.rab.requiredMaterials, state.depot, 7)}`,
            refundStr ? `♻️ **Refund Bongkaran ke Depot:** ${refundStr}` : null
        ].filter(Boolean).join('\n');
    }

    const row1 = select('bangun', 'studio_mode', ownerId, {
        placeholder: 'Pilih Layer Studio Arsitek 4-Layer...',
        options: [
            { label: '1. Lantai & Pilar (Layer 1)', value: 'floor', emoji: '🪜', description: 'Pasang material lantai, taman, kolam, dan pilar struktur', default: studioMode === 'floor' },
            { label: '2. Dinding, Pintu & Jendela (Layer 2)', value: 'wall', emoji: '🧱', description: 'Gambar dinding batas grid, pintu akses, jendela, gapura & pagar', default: studioMode === 'wall' },
            { label: '3. Atap & Genteng (Layer 3)', value: 'roof', emoji: '🏠', description: 'Atap Pelana, Limas, Joglo, Kubah, Dak Datar, atau Spire', default: studioMode === 'roof' },
            { label: '4. Perabot & Ruangan (Layer 4)', value: 'furniture', emoji: '🛋️', description: 'Pasang/putar/pindah furniture 1x1..2x2 & beri nama ruangan', default: studioMode === 'furniture' },
            { label: '5. Modul Cepat & Sketsa ASCII', value: 'legacy', emoji: '🧩', description: 'Kuas ruangan terpadu cepat, blok bentuk 3D & Sketsa ASCII', default: studioMode === 'legacy' }
        ]
    }, now);

    let row2;
    if (studioMode === 'floor') {
        row2 = select('bangun', 'floor_mat_pick', ownerId, {
            placeholder: 'Pilih Material Lantai (Layer 1)...',
            options: FLOOR_MATERIALS.slice(0, 25).map(m => ({
                label: `${m.name} (Nyaman +${m.comfortBonus})`,
                value: m.id,
                emoji: m.emoji,
                description: `Biaya/petak: ${Object.entries(m.costPerCell).map(([k, v]) => `${v} ${getItem(k)?.name || k}`).join(', ')}`,
                default: m.id === selFloorMat.id
            }))
        }, now);
    } else if (studioMode === 'wall') {
        row2 = select('bangun', 'wall_type_pick', ownerId, {
            placeholder: 'Pilih Tipe Dinding / Bukaan Tepi Grid (Layer 2)...',
            options: WALL_EDGE_TYPES.slice(0, 25).map(w => ({
                label: `${w.name} (${w.enclosesRoom ? 'Tutup Ruang' : 'Buka/Pagar'})`,
                value: w.id,
                emoji: w.emoji,
                description: `Biaya/garis: ${Object.entries(w.costPerEdge).map(([k, v]) => `${v} ${getItem(k)?.name || k}`).join(', ')}`,
                default: w.id === selWallType.id
            }))
        }, now);
    } else if (studioMode === 'roof') {
        row2 = select('bangun', 'roof_pick', ownerId, {
            placeholder: 'Pilih Varian Atap 3D (Layer 3)...',
            options: ROOF_VARIANTS.slice(0, 25).map(r => ({
                label: r.name,
                value: r.id,
                emoji: r.emoji,
                description: Object.keys(r.costPerCell).length > 0
                    ? `Biaya/petak: ${Object.entries(r.costPerCell).map(([k, v]) => `${v} ${getItem(k)?.name || k}`).join(', ')}`
                    : 'Tanpa penutup atap (ruangan terbuka / taman)',
                default: r.id === selRoofVar.id
            }))
        }, now);
    } else if (studioMode === 'furniture') {
        const furnOptions = [];
        for (const r of bagFurnItems) {
            const spec = getFurnitureSpec(r.item_id);
            furnOptions.push({
                label: `[Tas ×${r.quantity}] ${spec.name} (${spec.width || 1}×${spec.height || 1})`,
                value: `bag:${spec.id}`,
                emoji: spec.emoji,
                description: spec.description.slice(0, 95),
                default: session.selectedBagFurnId === spec.id && !session.selectedPlacedFurnId
            });
        }
        for (const pf of state.placedFurniture || []) {
            const spec = getFurnitureSpec(pf.item_id);
            const coord = `${String.fromCharCode(65 + Number(pf.anchor_x))}${Number(pf.anchor_y) + 1}`;
            furnOptions.push({
                label: `[Terpasang Lt.${pf.floor_level}] ${spec?.name || pf.item_id} @ ${coord} [${pf.rotation}]`,
                value: `placed:${pf.id}`,
                emoji: spec?.emoji || '📌',
                description: `Klik lalu tekan Putar 90°, Pindah, atau Angkat ke Tas`,
                default: Number(session.selectedPlacedFurnId) === Number(pf.id)
            });
        }
        const safeFurnOptions = furnOptions.length > 0
            ? furnOptions.slice(0, 25)
            : [{ label: 'Belum ada perabot — Beli di /shop -> Furnitur', value: '__none__', emoji: '🛒', description: 'Atau craft perabot dasar di Menu Properti -> Workshop', default: true }];
        row2 = select('bangun', 'furn_pick', ownerId, {
            placeholder: 'Pilih Perabot di Tas (Pasang) atau Terpasang (Atur)...',
            disabled: furnOptions.length === 0,
            options: safeFurnOptions
        }, now);
    } else {
        const activePalette = isShapeMode ? SHAPE_BLOCKS : BUILDING_MODULES;
        row2 = select('bangun', 'block_pick', ownerId, {
            placeholder: isShapeMode ? 'Pilih Blok Bentuk & Atap 3D (11)...' : 'Pilih Modul Ruangan Fungsional (23)...',
            options: activePalette.slice(0, 25).map(m => ({
                label: `[${getCatShort(m.category)}] ${m.name}`,
                value: m.id,
                emoji: m.emoji,
                description: m.description,
                default: m.id === selMod.id
            }))
        }, now);
    }

    const row3 = select('bangun', 'floor', ownerId, {
        placeholder: 'Pilih lantai / tambah tingkat baru...',
        options: buildFloorSelectOptions(state.draftCells, session, state.draftFloorCells, state.draftWallEdges)
    }, now);

    let row4;
    if (studioMode === 'floor') {
        row4 = new ActionRowBuilder().addComponents(
            btn('bangun', 'floor_paint_modal', ownerId, { label: 'Pasang Lantai', emoji: '🖌️', style: ButtonStyle.Success, disabled: isBuilding }, now),
            btn('bangun', 'toggle_pillar', ownerId, { label: session.floorPillar ? 'Pilar: ON' : 'Pilar: OFF', emoji: '🏛️', style: session.floorPillar ? ButtonStyle.Primary : ButtonStyle.Secondary, disabled: isBuilding }, now),
            btn('bangun', 'floor_clear_modal', ownerId, { label: 'Hapus Lantai', emoji: '🧹', style: ButtonStyle.Secondary, disabled: isBuilding }, now),
            btn('bangun', 'dup_floor_modal', ownerId, { label: 'Duplikat Lt.', emoji: '📑', style: ButtonStyle.Secondary, disabled: isBuilding }, now)
        );
    } else if (studioMode === 'wall') {
        row4 = new ActionRowBuilder().addComponents(
            btn('bangun', 'wall_perim_modal', ownerId, { label: 'Dinding Keliling', emoji: '🔲', style: ButtonStyle.Success, disabled: isBuilding }, now),
            btn('bangun', 'wall_line_modal', ownerId, { label: 'Garis / Pintu', emoji: '➖', style: ButtonStyle.Primary, disabled: isBuilding }, now),
            btn('bangun', 'wall_clear_modal', ownerId, { label: 'Hapus Dinding', emoji: '🧹', style: ButtonStyle.Secondary, disabled: isBuilding }, now),
            btn('bangun', 'dup_floor_modal', ownerId, { label: 'Duplikat Lt.', emoji: '📑', style: ButtonStyle.Secondary, disabled: isBuilding }, now)
        );
    } else if (studioMode === 'roof') {
        row4 = new ActionRowBuilder().addComponents(
            btn('bangun', 'roof_paint_modal', ownerId, { label: 'Pasang Atap', emoji: '🏠', style: ButtonStyle.Success, disabled: isBuilding }, now),
            btn('bangun', 'roof_clear_modal', ownerId, { label: 'Lepas Atap', emoji: '🌤️', style: ButtonStyle.Secondary, disabled: isBuilding }, now),
            btn('bangun', 'dup_floor_modal', ownerId, { label: 'Duplikat Lt.', emoji: '📑', style: ButtonStyle.Secondary, disabled: isBuilding }, now)
        );
    } else if (studioMode === 'furniture') {
        row4 = new ActionRowBuilder().addComponents(
            btn('bangun', 'place_furn_modal', ownerId, { label: 'Pasang Perabot', emoji: '🛋️', style: ButtonStyle.Success, disabled: isBuilding || bagFurnItems.length === 0 }, now),
            btn('bangun', 'rotate_furn_cw', ownerId, { label: 'Putar Hadap', emoji: '🔁', style: ButtonStyle.Primary, disabled: isBuilding || !selPlacedFurn }, now),
            btn('bangun', 'move_furn_modal', ownerId, { label: 'Pindah', emoji: '📦', style: ButtonStyle.Secondary, disabled: isBuilding || !selPlacedFurn }, now),
            btn('bangun', 'pickup_furn', ownerId, { label: 'Angkat', emoji: '🎒', style: ButtonStyle.Danger, disabled: isBuilding || !selPlacedFurn }, now),
            btn('bangun', 'rename_room_modal', ownerId, { label: 'Nama Ruang', emoji: '✏️', style: ButtonStyle.Secondary, disabled: isBuilding || floorRooms.length === 0 }, now)
        );
    } else {
        row4 = new ActionRowBuilder().addComponents(
            btn('bangun', 'paint_modal', ownerId, { label: 'Pasang Area', emoji: '🖌️', style: ButtonStyle.Success, disabled: isBuilding }, now),
            btn('bangun', 'palette_mode', ownerId, { label: isShapeMode ? 'Palet Modul' : 'Bentuk/Atap', emoji: '🎨', style: ButtonStyle.Primary }, now),
            btn('bangun', 'cycle_mat', ownerId, { label: `Mat: ${selMat.shortName}`, emoji: selMat.emoji, style: ButtonStyle.Secondary }, now),
            btn('bangun', 'ascii_modal', ownerId, { label: 'Sketsa ASCII', emoji: '⌨️', style: ButtonStyle.Secondary, disabled: isBuilding }, now),
            btn('bangun', 'clear_modal', ownerId, { label: 'Hapus Area', emoji: '🧹', style: ButtonStyle.Secondary, disabled: isBuilding }, now)
        );
    }

    const row5 = isBuilding
        ? new ActionRowBuilder().addComponents(
            btn('bangun', 'boost_energy', ownerId, {
                label: `Kerja (-${ENERGY_BOOST_COST} EN)`,
                emoji: '⚡',
                style: ButtonStyle.Primary,
                disabled: Number(p.energy || 0) < ENERGY_BOOST_COST
            }, now),
            btn('bangun', 'boost_contractor', ownerId, {
                label: 'Kontraktor (-45%)',
                emoji: '👷',
                style: ButtonStyle.Success
            }, now),
            btn('bangun', 'depot_view', ownerId, {
                label: 'Depot & Tema',
                emoji: '🗃️',
                style: ButtonStyle.Secondary
            }, now),
            btn('bangun', 'toggle_mode', ownerId, {
                label: isDraftMode ? 'Lihat Aktif' : 'Lihat Draft',
                emoji: '👁️',
                style: ButtonStyle.Secondary
            }, now),
            btn('bangun', 'rot_cam', ownerId, {
                label: 'Putar Cam',
                emoji: '🔄',
                style: ButtonStyle.Secondary
            }, now)
        )
        : new ActionRowBuilder().addComponents(
            btn('bangun', 'deposit_rab', ownerId, {
                label: 'Setor RAB',
                emoji: '📦',
                style: ButtonStyle.Primary,
                disabled: !state.rab.hasChanges
            }, now),
            btn('bangun', 'start_build', ownerId, {
                label: state.rab.changedStructuralCells === 0 && state.rab.removedCells === 0 && state.rab.hasChanges
                    ? 'Terapkan Gratis'
                    : 'Mulai Bangun',
                emoji: '🔨',
                style: ButtonStyle.Success,
                disabled: !state.rab.hasChanges || !state.rab.ok
            }, now),
            btn('bangun', 'templates_view', ownerId, {
                label: 'Template/Tema/Depot',
                emoji: '🧰',
                style: ButtonStyle.Secondary
            }, now),
            btn('bangun', 'toggle_mode', ownerId, {
                label: isDraftMode ? 'Lihat Aktif' : 'Lihat Draft',
                emoji: '👁️',
                style: ButtonStyle.Secondary
            }, now),
            btn('bangun', 'rot_cam', ownerId, {
                label: 'Putar Cam',
                emoji: '🔄',
                style: ButtonStyle.Secondary
            }, now)
        );

    return buildPanel({
        mod: 'bangun',
        ownerId,
        accentColor: isBuilding ? COLORS.WARNING : COLORS.PRIMARY,
        title: `🏗️ Studio 4-Layer 3D: ${land.custom_name} (${land.width}×${land.height})`,
        banner: state.justCompleted && !banner
            ? { type: 'success', text: '🎉 **Proyek Konstruksi Rampung!** Bangunan aktifmu & deteksi ruangan telah diperbarui.' }
            : banner,
        blocks: [
            { image: { url: attachment.url, description: `3D Voxel ${land.custom_name}` } },
            `${formatVitalsCompact(p)} | 💰 **Tunai:** ${formatLp(p.cash)} | 🏦 **Bank:** ${formatLp(p.bank)}\n${specLine}`,
            projectLine
        ],
        rows: [row1, row2, row3, row4, row5],
        footer: studioMode === 'wall'
            ? 'Tip Garis Dinding/Pintu: "A1:C1 S" (tepi selatan A1..C1), "B2 E" (tepi timur B2). Gunakan Area "A1:C3" untuk keliling!'
            : 'Alur 4-Layer: 1. Lantai -> 2. Dinding/Pintu/Atap -> Klik Mulai Bangun -> 4. Pasang Perabot dari /shop!',
        files: [attachment.attachment],
        now
    });
}

function buildSubNavRow(ownerId, activeSub, now = Date.now()) {
    return new ActionRowBuilder().addComponents(
        btn('bangun', 'templates_view', ownerId, {
            label: 'Template & Kode',
            emoji: '📋',
            style: activeSub === 'templates' ? ButtonStyle.Primary : ButtonStyle.Secondary
        }, now),
        btn('bangun', 'meta_view', ownerId, {
            label: 'Kavling & Tema',
            emoji: '🏷️',
            style: activeSub === 'meta' ? ButtonStyle.Primary : ButtonStyle.Secondary
        }, now),
        btn('bangun', 'depot_view', ownerId, {
            label: 'Depot & Bongkar',
            emoji: '🗃️',
            style: activeSub === 'depot' ? ButtonStyle.Primary : ButtonStyle.Secondary
        }, now),
        btn('bangun', 'home', ownerId, {
            label: 'Kembali ke Canvas 3D',
            emoji: '⬅️',
            style: ButtonStyle.Success
        }, now)
    );
}

function buildTemplatesPanel({ ownerId, state, banner = null, now = Date.now() }) {
    const land = state.land;
    const isBuilding = state.project?.status === 'building';

    const listLines = STARTER_TEMPLATES.map(tpl => {
        const fit = Number(land.width) >= tpl.minWidth && Number(land.height) >= tpl.minHeight;
        return `${tpl.emoji} **${tpl.name}** ${fit ? '✅' : `🔒 *(Min ${tpl.minWidth}×${tpl.minHeight})*`}\n> ${tpl.description}`;
    }).join('\n');

    const tplRow = select('bangun', 'apply_tpl', ownerId, {
        placeholder: isBuilding ? 'Tidak bisa ganti template saat konstruksi berjalan' : 'Terapkan template starter ke Draft...',
        disabled: isBuilding,
        options: STARTER_TEMPLATES.map(tpl => ({
            label: tpl.name,
            value: tpl.id,
            emoji: tpl.emoji,
            description: `Minimal ${tpl.minWidth}x${tpl.minHeight} — ${tpl.description}`
        }))
    }, now);

    const btnRow = new ActionRowBuilder().addComponents(
        btn('bangun', 'export_code', ownerId, {
            label: 'Ekspor Kode Blueprint',
            emoji: '📤',
            style: ButtonStyle.Primary
        }, now),
        btn('bangun', 'import_modal', ownerId, {
            label: 'Impor Kode Blueprint',
            emoji: '📥',
            style: ButtonStyle.Success,
            disabled: isBuilding
        }, now)
    );

    return buildPanel({
        mod: 'bangun',
        ownerId,
        accentColor: COLORS.CAREER,
        title: '📋 Template Starter & Share Kode Blueprint',
        banner,
        blocks: [
            `Kavling saat ini: **${land.custom_name}** (\`${land.width}×${land.height}\`). Mengubah template hanya mengedit **Draft** terlebih dahulu.`,
            listLines
        ],
        rows: [tplRow, btnRow, buildSubNavRow(ownerId, 'templates', now)],
        footer: 'Bagikan kode PROP-XXXXXX kepada pemain lain agar mereka dapat mengimpor blueprintmu!',
        now
    });
}

function buildMetaPanel({ ownerId, state, banner = null, now = Date.now() }) {
    const lands = state.lands || [];
    const land = state.land;

    const rows = [
        select('bangun', 'switch_land', ownerId, {
            placeholder: 'Pilih kavling yang ingin diedit...',
            options: lands.slice(0, 25).map(l => {
                const c = getCity(l.city_id);
                return {
                    label: `${l.custom_name} (${l.parcel_code || `${l.width}×${l.height}`})`,
                    value: String(l.id),
                    emoji: c.emoji,
                    description: `${c.shortName} · Kondisi ${Math.round(Number(l.condition_pct ?? 100))}%${Number(l.is_primary) === 1 ? ' · Utama' : ''}`,
                    default: Number(l.id) === Number(land.id)
                };
            })
        }, now),
        select('bangun', 'theme', ownerId, {
            placeholder: 'Pilih Tema Arsitektur 3D Canvas...',
            options: ARCHITECTURE_THEMES.map(t => ({
                label: t.name,
                value: t.id,
                emoji: t.emoji,
                description: `Ubah nuansa & palet Canvas 3D ke ${t.name}`,
                default: t.id === (land.theme_id || 'minimalis')
            }))
        }, now),
        new ActionRowBuilder().addComponents(
            btn('bangun', 'rename_modal', ownerId, {
                label: 'Ubah Nama & Deskripsi',
                emoji: '✏️',
                style: ButtonStyle.Primary
            }, now),
            btn('tanah', 'pbb_tab', ownerId, {
                label: 'Portofolio & PBB (/tanah)',
                emoji: '🧾',
                style: ButtonStyle.Secondary
            }, now)
        ),
        buildSubNavRow(ownerId, 'meta', now)
    ];

    return buildPanel({
        mod: 'bangun',
        ownerId,
        accentColor: COLORS.LIFE,
        title: '🏷️ Pilih Kavling, Nama & Tema Arsitektur',
        banner,
        blocks: [
            [
                `🏠 **Kavling Aktif Studio:** **${land.custom_name}** (\`${land.parcel_code || `#${land.id}`}\`)`,
                `🎨 **Tema Canvas:** ${getArchitectureTheme(land.theme_id).emoji} **${getArchitectureTheme(land.theme_id).name}**`,
                land.description ? `📝 **Deskripsi:** ${land.description}` : '📝 **Deskripsi:** *(Belum diatur)*'
            ].join('\n')
        ],
        rows,
        footer: `Kamu memiliki ${lands.length} kavling tersebar di berbagai kota.`,
        now
    });
}

function buildDepotPanel({ ownerId, state, banner = null, now = Date.now() }) {
    const land = state.land;
    const depotEntries = Object.entries(state.depot || {}).filter(([, q]) => Number(q) > 0);
    const isBuilding = state.project?.status === 'building';

    const depotText = depotEntries.length > 0
        ? depotEntries.map(([itemId, qty]) => {
            const it = getItem(itemId);
            const need = Number(state.rab?.requiredMaterials?.[itemId] || 0);
            return `• ${it?.emoji || '📦'} **${it?.name || itemId}:** \`${qty}\` unit${need > 0 ? ` *(RAB butuh ${need})*` : ''}`;
        }).join('\n')
        : '*Gudang Proyek kavling ini sedang kosong.*';

    const rows = [];
    if (depotEntries.length > 0) {
        rows.push(
            select('bangun', 'withdraw_select', ownerId, {
                placeholder: 'Tarik material dari Depot kembali ke Tas...',
                options: depotEntries.slice(0, 25).map(([itemId, qty]) => {
                    const it = getItem(itemId);
                    return {
                        label: `${it?.name || itemId} (Tersedia: ${qty})`,
                        value: itemId,
                        emoji: it?.emoji || '📦',
                        description: 'Klik untuk memasukkan jumlah penarikan ke tas'
                    };
                })
            }, now)
        );
    }

    rows.push(
        new ActionRowBuilder().addComponents(
            btn('bangun', 'deposit_all', ownerId, {
                label: 'Setor Semua Material Tas & Gudang',
                emoji: '📦',
                style: ButtonStyle.Primary,
                disabled: isBuilding
            }, now),
            btn('bangun', 'demolish_modal', ownerId, {
                label: 'Bongkar Area Aktif (Refund)',
                emoji: '💥',
                style: ButtonStyle.Danger,
                disabled: isBuilding || (state.activeCells.length === 0 && (state.activeFloorCells?.length || 0) === 0 && (state.activeWallEdges?.length || 0) === 0)
            }, now)
        ),
        buildSubNavRow(ownerId, 'depot', now)
    );

    return buildPanel({
        mod: 'bangun',
        ownerId,
        accentColor: COLORS.ECONOMY,
        title: `🗃️ Depot Bahan & Pembongkaran: ${land.custom_name}`,
        banner,
        blocks: [
            `Bahan di **Depot Proyek** terkunci aman dan otomatis dipakai saat menekan **Mulai Bangun**.`,
            depotText
        ],
        rows,
        footer: 'Membongkar area aktif mengembalikan 50%–70% material (bergantung kondisi bangunan) langsung ke Depot.',
        now
    });
}

module.exports = {
    name: 'bangun',
    slash: true,
    lockTtl: 15,
    data: new SlashCommandBuilder()
        .setName('bangun')
        .setDescription(
            isPropertyUnderDevelopment()
                ? '[Under Development] Studio arsitek & bangun properti sementara dinonaktifkan untuk perombakan.'
                : 'Studio Arsitek 3D Voxel — bangun menara tinggi bebas, atap kustom, kuas area & Sketsa ASCII.'
        ),

    async executeSlash(interaction) {
        const now = Date.now();
        if (isPropertyUnderDevelopment()) {
            cancelAutoUpdate(`bangun:${interaction.user.id}`);
            return await interaction.reply(
                buildPropertyUnderDevPanel({
                    mod: 'bangun',
                    ownerId: interaction.user.id,
                    ephemeral: true,
                    now
                })
            );
        }
        const state = await fetchBuildState(interaction.user.id, now);
        const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, now });
        const res = await interaction.reply(payload);
        scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
        return res;
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchBuildState(interaction.user.id, now);
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, now });
                const res = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return res;
            },

            async toggle_mode(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                session.viewMode = session.viewMode === 'draft' ? 'active' : 'draft';
                const state = await fetchBuildState(interaction.user.id, now);
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, now });
                const res = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return res;
            },

            async palette_mode(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                session.paletteMode = session.paletteMode === 'module' ? 'shape' : 'module';
                if (session.paletteMode === 'shape' && !SHAPE_BLOCKS.some(b => b.id === session.moduleId)) {
                    session.moduleId = SHAPE_BLOCKS[0].id;
                } else if (session.paletteMode === 'module' && !BUILDING_MODULES.some(b => b.id === session.moduleId)) {
                    session.moduleId = BUILDING_MODULES[0].id;
                }
                const state = await fetchBuildState(interaction.user.id, now);
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, now });
                const res = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return res;
            },

            async rot_cam(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                session.cameraAngle = (Number(session.cameraAngle || 0) + 1) % 4;
                const state = await fetchBuildState(interaction.user.id, now);
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, now });
                const res = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return res;
            },

            async toggle_pillar(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                session.floorPillar = !session.floorPillar;
                const state = await fetchBuildState(interaction.user.id, now);
                const payload = await buildStudioPanel({
                    ownerId: interaction.user.id,
                    state,
                    banner: { type: 'info', text: session.floorPillar ? '🏛️ **Mode Pilar Tengah AKTIF**: Lantai yang dipasang akan disertai pilar penopang.' : '🪜 Mode Pilar Tengah dinonaktifkan (lantai normal).' },
                    now
                });
                const res = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return res;
            },

            async floor_paint_modal(interaction) {
                const now = Date.now();
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const session = getStudioSession(interaction.user.id);
                const fMat = getFloorMaterial(session.floorMaterialId);
                const maxCol = String.fromCharCode(64 + Number(state.land.width));
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:floor_paint_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle(`Pasang Lantai: ${fMat.name.slice(0, 26)}`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('area')
                                .setLabel(`Area Lantai (Batas A1:${maxCol}${state.land.height})`)
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder(`Contoh: A1:${maxCol}${state.land.height} atau B2:C3`)
                                .setRequired(true)
                                .setMaxLength(24)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('color_hex')
                                .setLabel('Warna Cat Lantai Hex (Opsional, #RRGGBB)')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('#b47b48')
                                .setRequired(false)
                                .setMaxLength(9)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async floor_clear_modal(interaction) {
                const now = Date.now();
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const session = getStudioSession(interaction.user.id);
                const maxCol = String.fromCharCode(64 + Number(state.land.width));
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:floor_clear_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle(`Hapus Lantai (${getFloorLabel(session.floorLevel).slice(0, 20)})`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('area')
                                .setLabel(`Area yang Dihapus (A1:${maxCol}${state.land.height})`)
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Contoh: A1:B2 atau B2')
                                .setRequired(true)
                                .setMaxLength(24)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async wall_perim_modal(interaction) {
                const now = Date.now();
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const session = getStudioSession(interaction.user.id);
                const wType = getWallEdgeType(session.wallEdgeType);
                const maxCol = String.fromCharCode(64 + Number(state.land.width));
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:wall_perim_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle(`Keliling Area: ${wType.name.slice(0, 24)}`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('area')
                                .setLabel(`Area Keliling (Batas A1:${maxCol}${state.land.height})`)
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder(`Contoh: A1:C3 (membuat dinding keliling luar area)`)
                                .setRequired(true)
                                .setMaxLength(24)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('color_hex')
                                .setLabel('Warna Cat Dinding Hex (Opsional, #RRGGBB)')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('#f8fafc')
                                .setRequired(false)
                                .setMaxLength(9)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async wall_line_modal(interaction) {
                const now = Date.now();
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const session = getStudioSession(interaction.user.id);
                const wType = getWallEdgeType(session.wallEdgeType);
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:wall_line_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle(`Garis Tepi: ${wType.name.slice(0, 26)}`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('line')
                                .setLabel('Garis & Arah Sisi (N/S/E/W)')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Contoh: A2:C2 S, B1:B3 E, atau B2 S (1 pintu)')
                                .setRequired(true)
                                .setMaxLength(24)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('color_hex')
                                .setLabel('Warna Tepi Hex (Opsional, #RRGGBB)')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('#f59e0b')
                                .setRequired(false)
                                .setMaxLength(9)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async wall_clear_modal(interaction) {
                const now = Date.now();
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const session = getStudioSession(interaction.user.id);
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:wall_clear_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle(`Hapus Dinding (${getFloorLabel(session.floorLevel).slice(0, 20)})`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('line')
                                .setLabel('Garis Dinding / Area yang Dihapus')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Contoh: B2 S, A1:C1 N, atau area A1:C3')
                                .setRequired(true)
                                .setMaxLength(24)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async roof_paint_modal(interaction) {
                const now = Date.now();
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const session = getStudioSession(interaction.user.id);
                const rVar = getRoofVariant(session.roofVariant);
                const maxCol = String.fromCharCode(64 + Number(state.land.width));
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:roof_paint_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle(`Pasang Atap: ${rVar.name.slice(0, 26)}`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('area')
                                .setLabel(`Area Atap (Batas A1:${maxCol}${state.land.height})`)
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder(`Contoh: A1:${maxCol}${state.land.height} atau A1:B2`)
                                .setRequired(true)
                                .setMaxLength(24)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async roof_clear_modal(interaction) {
                const now = Date.now();
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const session = getStudioSession(interaction.user.id);
                const maxCol = String.fromCharCode(64 + Number(state.land.width));
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:roof_clear_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle(`Lepas Atap (${getFloorLabel(session.floorLevel).slice(0, 20)})`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('area')
                                .setLabel(`Area Atap yang Dilepas (A1:${maxCol}${state.land.height})`)
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Contoh: A1:C3')
                                .setRequired(true)
                                .setMaxLength(24)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async place_furn_modal(interaction) {
                const now = Date.now();
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const session = getStudioSession(interaction.user.id);
                const bagSpec = session.selectedBagFurnId ? getFurnitureSpec(session.selectedBagFurnId) : null;
                const maxCol = String.fromCharCode(64 + Number(state.land.width));
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:place_furn_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle(`Pasang ${bagSpec ? bagSpec.name.slice(0, 26) : 'Perabot'}`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('coord')
                                .setLabel(`Koordinat Petak (Batas A1:${maxCol}${state.land.height})`)
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Contoh: B2 (sel anchor kiri-atas)')
                                .setRequired(true)
                                .setMaxLength(10)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('rotation')
                                .setLabel('Arah Hadap (N/E/S/W)')
                                .setPlaceholder('N=Utara, E=Timur, S=Selatan, W=Barat')
                                .setStyle(TextInputStyle.Short)
                                .setValue('S')
                                .setRequired(true)
                                .setMaxLength(4)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async rotate_furn_cw(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                if (!session.selectedPlacedFurnId) return;
                const res = await withTransaction(conn =>
                    rotateOrMoveFurniture(conn, interaction.user.id, session.landId, session.selectedPlacedFurnId, { rotateCw: true }, now)
                );
                const state = await fetchBuildState(interaction.user.id, now);
                const rotWarn = res.warning ? `\n⚠️ *${res.warning}*` : '';
                const banner = res.ok
                    ? { type: 'success', text: `🔁 **${res.spec?.name || res.item?.name || 'Perabot'}** diputar menghadap **[${res.rotation}]**!${rotWarn}` }
                    : { type: 'warning', text: res.error };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async move_furn_modal(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land || !session.selectedPlacedFurnId) return;
                const placed = (state.placedFurniture || []).find(f => Number(f.id) === Number(session.selectedPlacedFurnId));
                const curCoord = placed ? `${String.fromCharCode(65 + Number(placed.anchor_x))}${Number(placed.anchor_y) + 1}` : 'A1';
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:move_furn_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle('Pindah & Putar Perabot')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('coord')
                                .setLabel('Koordinat Baru')
                                .setStyle(TextInputStyle.Short)
                                .setValue(curCoord)
                                .setRequired(true)
                                .setMaxLength(10)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('rotation')
                                .setLabel('Arah Hadap (N/E/S/W)')
                                .setStyle(TextInputStyle.Short)
                                .setValue(placed?.rotation || 'S')
                                .setRequired(true)
                                .setMaxLength(4)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async pickup_furn(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                if (!session.selectedPlacedFurnId) return;
                const preState = await fetchBuildState(interaction.user.id, now);
                const res = await withTransaction(conn =>
                    pickupFurniture(conn, interaction.user.id, session.landId, session.selectedPlacedFurnId, preState.player.max_slots, now)
                );
                if (res.ok) session.selectedPlacedFurnId = null;
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🎒 **${res.spec?.name || res.item?.name || 'Perabot'}** berhasil diangkat kembali ke Tas (/inventory)!` }
                    : { type: 'warning', text: res.error };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async rename_room_modal(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const floorRooms = (state.activeStats?.detectedRooms || []).filter(r => Number(r.floorLevel) === Number(session.floorLevel));
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:rename_room_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle(`Ubah Nama Ruangan (${getFloorLabel(session.floorLevel).slice(0, 18)})`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('room_ref')
                                .setLabel('No. Urut / Koordinat Ruangan (1 atau B2)')
                                .setStyle(TextInputStyle.Short)
                                .setValue(floorRooms.length > 0 ? '1' : 'A1')
                                .setRequired(true)
                                .setMaxLength(32)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('custom_name')
                                .setLabel('Nama Ruangan Baru (maks 40 karakter)')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Contoh: Kamar Tidur Utama, Dapur Kafe')
                                .setRequired(true)
                                .setMaxLength(40)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async cycle_mat(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const idx = STRUCTURAL_MATERIALS.findIndex(m => m.id === session.materialId);
                const next = STRUCTURAL_MATERIALS[(idx + 1) % STRUCTURAL_MATERIALS.length];
                session.materialId = next.id;
                const state = await fetchBuildState(interaction.user.id, now);
                const payload = await buildStudioPanel({
                    ownerId: interaction.user.id,
                    state,
                    banner: { type: 'info', text: `🧱 Material kuas diganti ke ${next.emoji} **${next.name}** (Aman ≤Lt.${next.safeFloorHeight}).` },
                    now
                });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async paint_modal(interaction) {
                const now = Date.now();
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const session = getStudioSession(interaction.user.id);
                const selMod = getBuildingModule(session.moduleId);
                const maxCol = String.fromCharCode(64 + Number(state.land.width));
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:paint_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle(`Pasang ${selMod.name.slice(0, 25)}`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('area')
                                .setLabel(`Koordinat (Batas A1:${maxCol}${state.land.height})`)
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder(`Contoh: A1:B2, TEPI A1:E5, atau B2 2x2`)
                                .setRequired(true)
                                .setMaxLength(24)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('zone_name')
                                .setLabel('Nama Ruangan / Zona (Opsional)')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder(`Default: ${selMod.name}`)
                                .setRequired(false)
                                .setMaxLength(40)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('color_hex')
                                .setLabel('Warna Ruangan Hex (Opsional, #RRGGBB)')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('#38bdf8')
                                .setRequired(false)
                                .setMaxLength(9)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async dup_floor_modal(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:dup_floor_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle('Duplikat Denah Antar-Lantai')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('from_floor')
                                .setLabel('Lantai Sumber (contoh: 1, 2, -1 untuk B1)')
                                .setStyle(TextInputStyle.Short)
                                .setValue(String(session.floorLevel))
                                .setRequired(true)
                                .setMaxLength(4)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('to_floor')
                                .setLabel('Lantai Tujuan (contoh: 2, 10, atau -1)')
                                .setStyle(TextInputStyle.Short)
                                .setValue(String(Math.max(1, Number(session.floorLevel) + 1)))
                                .setRequired(true)
                                .setMaxLength(4)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async ascii_modal(interaction) {
                const now = Date.now();
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const session = getStudioSession(interaction.user.id);
                const w = Number(state.land.width);
                const sampleRow = '#'.repeat(Math.min(4, w));
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:ascii_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle(`Sketsa ASCII — ${getFloorLabel(session.floorLevel).slice(0, 22)}`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('ascii_grid')
                                .setLabel('Baris Grid (#=Dinding, G=Kaca, .=Kosong)')
                                .setStyle(TextInputStyle.Paragraph)
                                .setPlaceholder(`Kode lain: P=Pilar, B=Balkon, R=Limas, J=Joglo, D=Kubah, S=Spire\nContoh:\n${sampleRow}\n#..#\n${sampleRow}`)
                                .setRequired(true)
                                .setMaxLength(350)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async clear_modal(interaction) {
                const now = Date.now();
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const session = getStudioSession(interaction.user.id);
                const maxCol = String.fromCharCode(64 + Number(state.land.width));
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:clear_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle(`Hapus Area Draft (${getFloorLabel(session.floorLevel).slice(0, 20)})`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('area')
                                .setLabel(`Koordinat yang Dihapus (A1:${maxCol}${state.land.height})`)
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Contoh: A1:B2 atau TEPI A1:D4 atau C3')
                                .setRequired(true)
                                .setMaxLength(24)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async templates_view(interaction) {
                const now = Date.now();
                cancelAutoUpdate(`bangun:${interaction.user.id}`);
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const payload = buildTemplatesPanel({ ownerId: interaction.user.id, state, now });
                return await interaction.update({ ...payload, attachments: [] });
            },

            async export_code(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const res = await withTransaction(conn => exportBlueprintCode(conn, interaction.user.id, session.landId, null, now));
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `📤 **Kode Blueprint Dibuat:** \`${res.shareCode}\` (*${res.title}*, ${res.cellCount} sel, ${res.wallCount || 0} dinding).` }
                    : { type: 'warning', text: res.error };
                const payload = buildTemplatesPanel({ ownerId: interaction.user.id, state, banner, now });
                return await interaction.update({ ...payload, attachments: [] });
            },

            async import_modal(interaction) {
                const now = Date.now();
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:import_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle('Impor Kode Blueprint')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('code')
                                .setLabel('Masukkan Kode Blueprint (PROP-XXXXXX)')
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder('Contoh: PROP-A1B2C3')
                                .setRequired(true)
                                .setMaxLength(20)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async meta_view(interaction) {
                const now = Date.now();
                cancelAutoUpdate(`bangun:${interaction.user.id}`);
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const payload = buildMetaPanel({ ownerId: interaction.user.id, state, now });
                return await interaction.update({ ...payload, attachments: [] });
            },

            async rename_modal(interaction) {
                const now = Date.now();
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:rename_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle('Ubah Nama & Deskripsi Properti')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('custom_name')
                                .setLabel('Nama Properti (Maks 64 karakter)')
                                .setStyle(TextInputStyle.Short)
                                .setValue(String(state.land.custom_name || 'Kavling').slice(0, 64))
                                .setRequired(true)
                                .setMaxLength(64)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('description')
                                .setLabel('Deskripsi / Slogan Usaha (Opsional)')
                                .setStyle(TextInputStyle.Paragraph)
                                .setValue(String(state.land.description || '').slice(0, 280))
                                .setRequired(false)
                                .setMaxLength(280)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async depot_view(interaction) {
                const now = Date.now();
                cancelAutoUpdate(`bangun:${interaction.user.id}`);
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const payload = buildDepotPanel({ ownerId: interaction.user.id, state, now });
                return await interaction.update({ ...payload, attachments: [] });
            },

            async deposit_rab(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const res = await withTransaction(conn => depositMaterialsToDepot(conn, interaction.user.id, session.landId, true, now));
                const state = await fetchBuildState(interaction.user.id, now);
                const count = Object.values(res.deposited || {}).reduce((s, n) => s + Number(n), 0);
                const banner = !res.ok
                    ? { type: 'warning', text: res.error }
                    : count > 0
                        ? { type: 'success', text: `📦 Berhasil menyetor **${count} unit bahan sesuai RAB** ke Depot Proyek!` }
                        : { type: 'info', text: 'Tidak ada bahan di Tas/Gudang lokal yang dibutuhkan tambahan untuk RAB saat ini.' };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async deposit_all(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const res = await withTransaction(conn => depositMaterialsToDepot(conn, interaction.user.id, session.landId, false, now));
                const state = await fetchBuildState(interaction.user.id, now);
                const count = Object.values(res.deposited || {}).reduce((s, n) => s + Number(n), 0);
                const banner = !res.ok
                    ? { type: 'warning', text: res.error }
                    : count > 0
                        ? { type: 'success', text: `📦 Berhasil menyetor semua **${count} unit material konstruksi** ke Depot Proyek!` }
                        : { type: 'info', text: 'Tidak ditemukan bahan konstruksi di Tas maupun Gudang lokalmu.' };
                const payload = buildDepotPanel({ ownerId: interaction.user.id, state, banner, now });
                return await interaction.update({ ...payload, attachments: [] });
            },

            async demolish_modal(interaction) {
                const now = Date.now();
                const state = await fetchBuildState(interaction.user.id, now);
                if (!state.land) return;
                const session = getStudioSession(interaction.user.id);
                const maxCol = String.fromCharCode(64 + Number(state.land.width));
                const modal = new ModalBuilder()
                    .setCustomId(`bangun:demolish_submit:${interaction.user.id}:${now.toString(36)}`)
                    .setTitle('Bongkar Bangunan Aktif (Refund 50-70%)')
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('area')
                                .setLabel(`Ketik Koordinat (A1:${maxCol}${state.land.height}) atau SEMUA`)
                                .setStyle(TextInputStyle.Short)
                                .setPlaceholder(`Misal A1:B2 (di ${getFloorLabel(session.floorLevel)}) atau SEMUA`)
                                .setRequired(true)
                                .setMaxLength(24)
                        )
                    );
                return await interaction.showModal(modal);
            },

            async start_build(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const res = await withTransaction(conn => startConstruction(conn, interaction.user.id, session.landId, now));
                const state = await fetchBuildState(interaction.user.id, now);

                let banner;
                if (!res.ok) {
                    if (res.status === 'funding' && res.missing) {
                        const missList = Object.entries(res.missing)
                            .slice(0, 6)
                            .map(([itemId, q]) => {
                                const it = getItem(itemId);
                                return `${q}× ${it?.emoji || '📦'} ${it?.name || itemId}`;
                            })
                            .join(', ');
                        banner = {
                            type: 'warning',
                            text: `📦 **Bahan di Depot Proyek kurang:** ${missList}. Cari di \`/gather\`, olah di \`/property\`, atau beli di \`/shop\` lalu klik **Setor RAB**!`
                        };
                    } else {
                        banner = { type: 'warning', text: res.error };
                    }
                } else if (res.instant) {
                    session.viewMode = 'active';
                    banner = { type: 'success', text: res.message || '✨ **Perubahan langsung diterapkan ke bangunan aktifmu!**' };
                } else {
                    banner = {
                        type: 'success',
                        text: `🔨 **Konstruksi Dimulai!** Proyek rampung <t:${Math.floor(res.finishesAt / 1000)}:R>.`
                    };
                }

                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async boost_energy(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const res = await withTransaction(conn => boostConstructionWithEnergy(conn, interaction.user.id, session.landId, now));
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = !res.ok
                    ? { type: 'warning', text: res.error }
                    : res.completedNow
                        ? { type: 'success', text: '🎉 **Selesai!** Kerjamu langsung merampungkan seluruh konstruksi!' }
                        : { type: 'success', text: `⚡ Ikut membangun (-${res.energyCost} EN) dan mempercepat waktu **-${formatDuration(res.savedMs)}**!` };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async boost_contractor(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const res = await withTransaction(conn => hireNpcContractorBoost(conn, interaction.user.id, session.landId, now));
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = !res.ok
                    ? { type: 'warning', text: res.error }
                    : res.completedNow
                        ? { type: 'success', text: `👷 **Kontraktor Ekspres (${formatLp(res.fee)})** langsung merampungkan konstruksi!` }
                        : { type: 'success', text: `👷 **Kontraktor Ekspres** (${formatLp(res.fee)}) -> waktu dipangkas **-${formatDuration(res.savedMs)}**!` };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            }
        },

        selects: {
            async studio_mode(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const validModes = ['floor', 'wall', 'roof', 'furniture', 'legacy'];
                session.studioMode = validModes.includes(interaction.values[0]) ? interaction.values[0] : 'floor';
                if (session.studioMode === 'furniture') {
                    session.viewMode = 'active';
                }
                const state = await fetchBuildState(interaction.user.id, now);
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, now });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async floor_mat_pick(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                session.floorMaterialId = getFloorMaterial(interaction.values[0]).id;
                const state = await fetchBuildState(interaction.user.id, now);
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, now });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async wall_type_pick(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                session.wallEdgeType = getWallEdgeType(interaction.values[0]).id;
                const state = await fetchBuildState(interaction.user.id, now);
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, now });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async roof_pick(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                session.roofVariant = getRoofVariant(interaction.values[0]).id;
                const state = await fetchBuildState(interaction.user.id, now);
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, now });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async furn_pick(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const val = String(interaction.values[0] || '');
                if (val.startsWith('bag:')) {
                    session.selectedBagFurnId = val.slice(4);
                    session.selectedPlacedFurnId = null;
                } else if (val.startsWith('placed:')) {
                    session.selectedPlacedFurnId = Number(val.slice(7));
                }
                const state = await fetchBuildState(interaction.user.id, now);
                if (val.startsWith('placed:')) {
                    const pf = (state.placedFurniture || []).find(f => Number(f.id) === Number(session.selectedPlacedFurnId));
                    if (pf) session.floorLevel = Number(pf.floor_level || 1);
                }
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, now });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async block_pick(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                session.moduleId = getBuildingModule(interaction.values[0]).id;
                const state = await fetchBuildState(interaction.user.id, now);
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, now });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async material(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                session.materialId = getStructuralMaterial(interaction.values[0]).id;
                const state = await fetchBuildState(interaction.user.id, now);
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, now });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async floor(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const val = interaction.values[0];
                if (val === '__add_floor__') {
                    const preState = await fetchBuildState(interaction.user.id, now);
                    let highest = Math.max(5, Number(session.maxUnlockedFloor || 6), Number(session.floorLevel || 1));
                    for (const c of [...(preState.draftCells || []), ...(preState.draftFloorCells || []), ...(preState.draftWallEdges || [])]) {
                        highest = Math.max(highest, Number(c.floor_level || 1));
                    }
                    const nextFl = Math.min(100, highest + 1);
                    session.maxUnlockedFloor = nextFl;
                    session.floorLevel = nextFl;
                    const payload = await buildStudioPanel({
                        ownerId: interaction.user.id,
                        state: preState,
                        banner: { type: 'info', text: `⬆️ Membuka & berpindah ke **${getFloorLabel(nextFl)}**!` },
                        now
                    });
                    const out = await interaction.update({ ...payload, attachments: [] });
                    scheduleBuildAutoUpdate(interaction.user.id, interaction, preState);
                    return out;
                }

                const parsedFloor = Number(val);
                session.floorLevel = (parsedFloor === -1 || (parsedFloor >= 1 && parsedFloor <= 100)) ? parsedFloor : 1;
                session.maxUnlockedFloor = Math.max(session.maxUnlockedFloor, session.floorLevel);
                const state = await fetchBuildState(interaction.user.id, now);
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, now });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async apply_tpl(interaction) {
                const now = Date.now();
                const tplId = interaction.values[0];
                const session = getStudioSession(interaction.user.id);
                const res = await withTransaction(conn => applyTemplateToDraft(conn, interaction.user.id, session.landId, tplId, now));
                if (res.ok) session.viewMode = 'draft';
                const state = await fetchBuildState(interaction.user.id, now);
                if (!res.ok) {
                    const payload = buildTemplatesPanel({
                        ownerId: interaction.user.id,
                        state,
                        banner: { type: 'warning', text: res.error },
                        now
                    });
                    return await interaction.update({ ...payload, attachments: [] });
                }
                const payload = await buildStudioPanel({
                    ownerId: interaction.user.id,
                    state,
                    banner: { type: 'success', text: `📋 Template **${res.template.name}** (${res.cellCount} sel) dimuat ke Draft!` },
                    now
                });
                const out = await interaction.update({ ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async switch_land(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                session.landId = Number(interaction.values[0]);
                session.floorLevel = 1;
                const state = await fetchBuildState(interaction.user.id, now);
                const payload = buildMetaPanel({
                    ownerId: interaction.user.id,
                    state,
                    banner: { type: 'info', text: `Berpindah fokus studio ke **${state.land?.custom_name || 'Kavling'}**.` },
                    now
                });
                return await interaction.update({ ...payload, attachments: [] });
            },

            async theme(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const themeId = interaction.values[0];
                await withTransaction(conn => updateLandMetadata(conn, interaction.user.id, session.landId, { themeId }, now));
                const state = await fetchBuildState(interaction.user.id, now);
                const t = getArchitectureTheme(themeId);
                const payload = buildMetaPanel({
                    ownerId: interaction.user.id,
                    state,
                    banner: { type: 'success', text: `🎨 Tema arsitektur diubah menjadi ${t.emoji} **${t.name}**!` },
                    now
                });
                return await interaction.update({ ...payload, attachments: [] });
            },

            async withdraw_select(interaction) {
                const now = Date.now();
                const itemId = interaction.values[0];
                const session = getStudioSession(interaction.user.id);
                session.pendingWithdrawItemId = itemId;
                const state = await fetchBuildState(interaction.user.id, now);
                const avail = Number(state.depot?.[itemId] || 0);
                const it = getItem(itemId);
                const modal = numberModal('bangun', 'withdraw_submit', interaction.user.id, {
                    title: `Tarik ${it?.name || itemId}`.slice(0, 45),
                    label: `Jumlah yang ditarik (Tersedia: ${avail})`,
                    placeholder: `1 - ${avail}`,
                    defaultValue: String(Math.min(avail, 10)),
                    maxLength: 8
                }, now);
                return await interaction.showModal(modal);
            }
        },

        modals: {
            async floor_paint_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const areaInput = interaction.fields.getTextInputValue('area');
                const colorRaw = (interaction.fields.getTextInputValue('color_hex') || '').trim();
                const colorHex = /^#[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : null;

                const res = await withTransaction(conn =>
                    applyFloorAreaToDraft(conn, interaction.user.id, session.landId, {
                        floorLevel: session.floorLevel,
                        areaInput,
                        floorMaterialId: session.floorMaterialId,
                        isPillar: session.floorPillar,
                        colorHex
                    }, now)
                );
                if (res.ok) session.viewMode = 'draft';
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🪜 Memasang **${res.paintedCount} petak lantai** (${res.floorMaterial.name}${res.isPillar ? ' + Pilar ◼' : ''}) di Draft **${getFloorLabel(session.floorLevel)}**.` }
                    : { type: 'warning', text: res.error };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async floor_clear_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const areaInput = interaction.fields.getTextInputValue('area');
                const res = await withTransaction(conn =>
                    clearFloorAreaFromDraft(conn, interaction.user.id, session.landId, session.floorLevel, areaInput, now)
                );
                if (res.ok) session.viewMode = 'draft';
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🧹 Berhasil menghapus **${res.removedCount} petak lantai Draft**.` }
                    : { type: 'warning', text: res.error };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async wall_perim_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const areaInput = interaction.fields.getTextInputValue('area');
                const colorRaw = (interaction.fields.getTextInputValue('color_hex') || '').trim();
                const colorHex = /^#[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : null;

                const res = await withTransaction(conn =>
                    applyPerimeterWallsToDraft(conn, interaction.user.id, session.landId, {
                        floorLevel: session.floorLevel,
                        areaInput,
                        edgeType: session.wallEdgeType,
                        colorHex
                    }, now)
                );
                if (res.ok) session.viewMode = 'draft';
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🔲 Memasang **${res.edgeCount} garis ${res.wallType.name}** mengelilingi area di Draft **${getFloorLabel(session.floorLevel)}**.` }
                    : { type: 'warning', text: res.error };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async wall_line_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const lineInput = interaction.fields.getTextInputValue('line');
                const colorRaw = (interaction.fields.getTextInputValue('color_hex') || '').trim();
                const colorHex = /^#[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : null;

                const res = await withTransaction(conn =>
                    applyLineWallsToDraft(conn, interaction.user.id, session.landId, {
                        floorLevel: session.floorLevel,
                        lineInput,
                        edgeType: session.wallEdgeType,
                        colorHex
                    }, now)
                );
                if (res.ok) session.viewMode = 'draft';
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `➖ Memasang **${res.edgeCount} segmen ${res.wallType.name}** (sisi **${res.side}**) di Draft **${getFloorLabel(session.floorLevel)}**.` }
                    : { type: 'warning', text: res.error };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async wall_clear_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const lineInput = interaction.fields.getTextInputValue('line');
                const res = await withTransaction(conn =>
                    clearWallEdgesFromDraft(conn, interaction.user.id, session.landId, {
                        floorLevel: session.floorLevel,
                        lineInput
                    }, now)
                );
                if (res.ok) session.viewMode = 'draft';
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🧹 Berhasil menghapus **${res.removedCount} segmen dinding Draft**.` }
                    : { type: 'warning', text: res.error };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async roof_paint_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const areaInput = interaction.fields.getTextInputValue('area');
                const res = await withTransaction(conn =>
                    applyRoofAreaToDraft(conn, interaction.user.id, session.landId, {
                        floorLevel: session.floorLevel,
                        areaInput,
                        roofVariant: session.roofVariant,
                        defaultFloorMaterialId: session.floorMaterialId || 'beton'
                    }, now)
                );
                if (res.ok) session.viewMode = 'draft';
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🏠 Memasang **${res.paintedCount} petak ${res.roofVariant.name}** di Draft **${getFloorLabel(session.floorLevel)}**.` }
                    : { type: 'warning', text: res.error };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async roof_clear_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const areaInput = interaction.fields.getTextInputValue('area');
                const res = await withTransaction(conn =>
                    applyRoofAreaToDraft(conn, interaction.user.id, session.landId, {
                        floorLevel: session.floorLevel,
                        areaInput,
                        roofVariant: 'none'
                    }, now)
                );
                if (res.ok) session.viewMode = 'draft';
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🌤️ Melepas penutup atap pada **${res.paintedCount} petak Draft**.` }
                    : { type: 'warning', text: res.error };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async place_furn_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const coordInput = interaction.fields.getTextInputValue('coord');
                const rotation = normalizeFurnitureRotation(interaction.fields.getTextInputValue('rotation'));

                const res = await withTransaction(conn =>
                    placeFurniture(conn, interaction.user.id, session.landId, {
                        itemId: session.selectedBagFurnId,
                        floorLevel: session.floorLevel,
                        coordInput,
                        rotation
                    }, now)
                );
                if (res.ok) {
                    session.viewMode = 'active';
                    session.selectedPlacedFurnId = Number(res.furnitureId);
                }
                const state = await fetchBuildState(interaction.user.id, now);
                const needBuildHint = !res.ok && state.activeFloorCells.length === 0 && state.draftFloorCells.length > 0
                    ? '\n💡 *Lantai saat ini masih berbentuk Draft — klik **Mulai Bangun** lebih dulu agar lantai aktif sebelum menaruh perabot!*'
                    : '';
                const furnName = res.spec?.name || res.item?.name || 'Perabot';
                const placedCount = Array.isArray(res.footprint)
                    ? res.footprint.length
                    : (Number(res.widthCells || 1) * Number(res.heightCells || 1));
                const placeWarn = res.warning || (res.isOutdoorPenalty ? 'Ruangan terbuka/tanpa atap: efektivitas **50%** hingga ditutup Dinding + Atap!' : '');
                const banner = res.ok
                    ? { type: 'success', text: `🛋️ **${furnName}** (${placedCount} petak, hadap **[${res.rotation || rotation}]**) berhasil dipasang di **${getFloorLabel(session.floorLevel)}**!${placeWarn ? `\n⚠️ *${placeWarn}*` : ''}` }
                    : { type: 'warning', text: `${res.error}${needBuildHint}` };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async move_furn_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const coordInput = interaction.fields.getTextInputValue('coord');
                const rotation = normalizeFurnitureRotation(interaction.fields.getTextInputValue('rotation'));
                const res = await withTransaction(conn =>
                    rotateOrMoveFurniture(conn, interaction.user.id, session.landId, session.selectedPlacedFurnId, {
                        coordInput,
                        rotation
                    }, now)
                );
                const state = await fetchBuildState(interaction.user.id, now);
                const movedName = res.spec?.name || res.item?.name || 'Perabot';
                const moveWarn = res.warning || (res.isOutdoorPenalty ? 'Efektivitas 50% karena ruang terbuka/tanpa atap.' : '');
                const banner = res.ok
                    ? { type: 'success', text: `📦 **${movedName}** dipindahkan & diputar hadap **[${res.rotation}]**!${moveWarn ? `\n⚠️ *${moveWarn}*` : ''}` }
                    : { type: 'warning', text: res.error };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async rename_room_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const roomRef = (interaction.fields.getTextInputValue('room_ref') || '').trim();
                const newName = interaction.fields.getTextInputValue('custom_name');

                const preState = await fetchBuildState(interaction.user.id, now);
                const floorRooms = (preState.activeStats?.detectedRooms || []).filter(r => Number(r.floorLevel) === Number(session.floorLevel));
                let targetKey = roomRef;
                if (/^\d+$/.test(roomRef)) {
                    const idx = Number(roomRef) - 1;
                    if (floorRooms[idx]) targetKey = floorRooms[idx].roomKey;
                } else {
                    const byCoord = floorRooms.find(r => (r.coords || []).includes(roomRef.toUpperCase()));
                    if (byCoord) targetKey = byCoord.roomKey;
                }

                const res = await withTransaction(conn =>
                    renameLandRoom(conn, interaction.user.id, session.landId, session.floorLevel, targetKey, newName)
                );
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `✏️ Ruangan berhasil dinamai **${res.customName}**!` }
                    : { type: 'warning', text: `${res.error}${floorRooms.length === 0 ? ' (Klik Mulai Bangun dulu untuk mengaktifkan ruangan dari Draft).' : ''}` };
                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async paint_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const areaInput = interaction.fields.getTextInputValue('area');
                const zoneNameRaw = interaction.fields.getTextInputValue('zone_name') || '';
                const colorRaw = (interaction.fields.getTextInputValue('color_hex') || '').trim();
                const colorHex = /^#[0-9A-Fa-f]{6}$/.test(colorRaw) ? colorRaw : null;

                const res = await withTransaction(conn =>
                    applyAreaToDraft(conn, interaction.user.id, session.landId, {
                        floorLevel: session.floorLevel,
                        areaInput,
                        moduleId: session.moduleId,
                        materialId: session.materialId,
                        zoneName: zoneNameRaw.trim() || null,
                        colorHex
                    }, now)
                );

                if (res.ok) session.viewMode = 'draft';
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🖌️ Mengecat **${res.paintedCount} petak** (\`${res.coords[0]}..${res.coords[res.coords.length - 1]}\`) menjadi **${res.zoneName}** (${res.material.shortName}).${res.warning ? `\n${res.warning}` : ''}` }
                    : { type: 'warning', text: res.error };

                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async dup_floor_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const fromFloor = Number(interaction.fields.getTextInputValue('from_floor'));
                const toFloor = Number(interaction.fields.getTextInputValue('to_floor'));

                const res = await withTransaction(conn =>
                    duplicateFloorToDraft(conn, interaction.user.id, session.landId, fromFloor, toFloor, now)
                );
                if (res.ok) {
                    session.viewMode = 'draft';
                    session.floorLevel = res.toFloor;
                    session.maxUnlockedFloor = Math.max(session.maxUnlockedFloor, res.toFloor);
                }
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `📑 Menyalin **${res.copiedCount} sel** dari **${getFloorLabel(res.fromFloor)}** ke **${getFloorLabel(res.toFloor)}**!` }
                    : { type: 'warning', text: res.error };

                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async ascii_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const asciiText = interaction.fields.getTextInputValue('ascii_grid');

                const res = await withTransaction(conn =>
                    applyAsciiSketchToDraft(conn, interaction.user.id, session.landId, {
                        floorLevel: session.floorLevel,
                        asciiText,
                        defaultModuleId: session.moduleId,
                        materialId: session.materialId
                    }, now)
                );
                if (res.ok) session.viewMode = 'draft';
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `⌨️ Sketsa ASCII diterapkan di **${getFloorLabel(res.floorLevel)}** (**${res.paintedCount} sel** terpasang)!` }
                    : { type: 'warning', text: res.error };

                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async clear_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const areaInput = interaction.fields.getTextInputValue('area');
                const res = await withTransaction(conn =>
                    clearAreaFromDraft(conn, interaction.user.id, session.landId, session.floorLevel, areaInput, now)
                );
                if (res.ok) session.viewMode = 'draft';
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🧹 Berhasil menghapus **${res.removedCount} sel Draft**.` }
                    : { type: 'warning', text: res.error };

                const payload = await buildStudioPanel({ ownerId: interaction.user.id, state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async import_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const code = interaction.fields.getTextInputValue('code');
                const res = await withTransaction(conn =>
                    importBlueprintCode(conn, interaction.user.id, session.landId, code, now)
                );
                if (res.ok) session.viewMode = 'draft';
                const state = await fetchBuildState(interaction.user.id, now);
                if (!res.ok) {
                    const payload = buildTemplatesPanel({
                        ownerId: interaction.user.id,
                        state,
                        banner: { type: 'warning', text: res.error },
                        now
                    });
                    return await respondOrUpdate(interaction, { ...payload, attachments: [] });
                }
                const payload = await buildStudioPanel({
                    ownerId: interaction.user.id,
                    state,
                    banner: { type: 'success', text: `📥 Blueprint **${res.blueprint.title}** (${res.importedCells} sel) dimuat ke Draft!` },
                    now
                });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                scheduleBuildAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async rename_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const customName = interaction.fields.getTextInputValue('custom_name');
                const description = interaction.fields.getTextInputValue('description');
                const res = await withTransaction(conn =>
                    updateLandMetadata(conn, interaction.user.id, session.landId, { customName, description }, now)
                );
                const state = await fetchBuildState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `✏️ Properti berhasil dinamai **${res.customName}**!` }
                    : { type: 'warning', text: res.error };
                const payload = buildMetaPanel({ ownerId: interaction.user.id, state, banner, now });
                return await respondOrUpdate(interaction, { ...payload, attachments: [] });
            },

            async demolish_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const rawArea = (interaction.fields.getTextInputValue('area') || '').trim();
                const isAll = /^(semua|all|\*)$/i.test(rawArea);
                const res = await withTransaction(conn =>
                    demolishActiveArea(conn, interaction.user.id, session.landId, session.floorLevel, isAll ? null : rawArea, now)
                );
                const state = await fetchBuildState(interaction.user.id, now);
                if (!res.ok) {
                    const payload = buildDepotPanel({
                        ownerId: interaction.user.id,
                        state,
                        banner: { type: 'warning', text: res.error },
                        now
                    });
                    return await respondOrUpdate(interaction, { ...payload, attachments: [] });
                }
                const refTxt = formatMatRefundShort(res.refunded) || 'Tidak ada refund';
                const payload = buildDepotPanel({
                    ownerId: interaction.user.id,
                    state,
                    banner: { type: 'success', text: `💥 Membongkar **${res.demolishedCount} sel aktif**! Refund **${res.refundRatioPct}%** (${refTxt}) masuk ke Depot.` },
                    now
                });
                return await respondOrUpdate(interaction, { ...payload, attachments: [] });
            },

            async withdraw_submit(interaction) {
                const now = Date.now();
                const session = getStudioSession(interaction.user.id);
                const itemId = session.pendingWithdrawItemId;
                const statePre = await fetchBuildState(interaction.user.id, now);
                const avail = Number(statePre.depot?.[itemId] || 0);
                const parsed = parseModalNumber(interaction, { min: 1, max: Math.max(1, avail) });
                if (!parsed.ok) {
                    const errPayload = buildDepotPanel({
                        ownerId: interaction.user.id,
                        state: statePre,
                        banner: { type: 'warning', text: parsed.error },
                        now
                    });
                    return await respondOrUpdate(interaction, { ...errPayload, attachments: [] });
                }
                const res = await withTransaction(conn =>
                    withdrawMaterialsFromDepot(conn, interaction.user.id, session.landId, itemId, parsed.value, statePre.player.max_slots, now)
                );
                const state = await fetchBuildState(interaction.user.id, now);
                const it = getItem(itemId);
                const banner = res.ok
                    ? { type: 'success', text: `✅ Menarik **${res.qty}× ${it?.name || itemId}** ke Tas!` }
                    : { type: 'warning', text: res.error };
                const payload = buildDepotPanel({ ownerId: interaction.user.id, state, banner, now });
                return await respondOrUpdate(interaction, { ...payload, attachments: [] });
            }
        }
    },

    fetchBuildState,
    buildStudioPanel,
    buildTemplatesPanel,
    buildMetaPanel,
    buildDepotPanel
};
