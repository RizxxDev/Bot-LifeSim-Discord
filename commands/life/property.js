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
    getPlayerPropertyStatus,
    calculateProratedUpgradeRent,
    rentProperty,
    buyProperty,
    moveOutProperty
} = require('../../services/propertyService');
const {
    getPlayerLands,
    getLandById,
    getLandCells,
    computeLandStats,
    computeArchitectureScore,
    calculateLandPurchasePrice,
    calculateLandExpandPrice,
    buyLand,
    expandLand,
    setPrimaryLand,
    togglePropertyLike,
    getTotalSkillLevelFromPlayerRow
} = require('../../services/landService');
const {
    getConditionMeta,
    getHeavyRenovationRequirements,
    performLightMaintenance,
    performHeavyRenovation,
    clearCollapsedRubble,
    evacuateEmergencyStorage
} = require('../../services/buildingConditionService');
const {
    getActiveConstructionProject,
    syncLandConstruction
} = require('../../services/constructionService');
const { buildPropertyCanvasAttachment } = require('../../services/propertyCanvasService');
const {
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
} = require('../../services/propertyBusinessService');
const {
    LAND_TIERS,
    getLandTier,
    getNextLandTier,
    getMaxLandLimit,
    getProgressivePbbMultiplier
} = require('../../data/buildingModules');
const {
    getPropertyTier,
    getNpcRentTiers,
    calculateMonthlyPbb,
    convertPresetToBlueprint
} = require('../../data/properties');
const { WORKSHOP_RECIPES, getWorkshopRecipe } = require('../../data/gathering');
const { CITIES, getCity, getCityZoning } = require('../../data/cities');
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
    confirmView,
    numberModal,
    parseModalNumber,
    respondOrUpdate
} = require('../../utils/panelBuilder');
const { scheduleAutoUpdate, cancelAutoUpdate } = require('../../services/autoUpdateService');
const { isPropertyUnderDevelopment, buildPropertyUnderDevPanel } = require('../../utils/featureFlags');

const propertySessions = new Map();

function getPropSession(userId) {
    let s = propertySessions.get(userId);
    if (!s) {
        s = {
            tab: 'home',
            selectedLandId: null,
            cameraAngle: 0,
            galleryLandId: null,
            galleryCameraAngle: 0,
            buyCityId: null,
            buySelection: 'mini_3x3',
            npcTierId: 'kos',
            wsRecipeId: WORKSHOP_RECIPES[0]?.id || 'proc_papan_kayu',
            pendingStockItemId: null,
            selectedListingId: null,
            selectedRentKey: null
        };
        propertySessions.set(userId, s);
    }
    return s;
}

function formatFacilitiesLine(fac = {}) {
    return [
        `🍳 Kompor **${fac.stove || 0}**`,
        `🧊 Kulkas **${fac.kulkas || 0}**`,
        `❄️ Freezer **${fac.freezer || 0}**`,
        `📦 Gudang **${fac.gudang || 0}**`
    ].join(' · ');
}

function schedulePropertyAutoUpdate(userId, interaction, state) {
    if (!interaction || interaction.isLiveSyncProbe) return;
    const session = getPropSession(userId);
    if (session.tab !== 'biz_ws') {
        cancelAutoUpdate(`property:${userId}`);
        return;
    }
    const now = Date.now();
    const pendingMs = (state?.wsQueues || [])
        .map(q => Number(q.finishes_at || 0) - now)
        .filter(ms => ms > 0);
    if (pendingMs.length === 0) {
        cancelAutoUpdate(`property:${userId}`);
        return;
    }
    const minMs = Math.min(...pendingMs);
    scheduleAutoUpdate(`property:${userId}`, interaction, Math.max(500, minMs + 500), async () => {
        const readyNow = Date.now();
        const refreshed = await fetchPropertyState(userId, readyNow);
        const payload = await buildPropertyPanel({
            state: refreshed,
            banner: {
                type: 'success',
                text: '⚒️ **Pesanan Workshop Selesai!** Klik **Ambil Hasil Workshop** untuk memasukkan material ke tas.'
            },
            now: readyNow
        });
        return { ...payload, attachments: [] };
    });
}

async function fetchPropertyState(discordId, now = Date.now()) {
    const session = getPropSession(discordId);
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const player = synced.player;
        const currentCityId = player.current_city || 'kota_sentral';
        const status = await getPlayerPropertyStatus(conn, discordId, player.max_slots, now, false, currentCityId);
        let lands = await getPlayerLands(conn, discordId, null, false);

        if (!session.buyCityId) {
            session.buyCityId = currentCityId;
        }

        let selectedLand = lands.find(l => Number(l.id) === Number(session.selectedLandId));
        if (!selectedLand && lands.length > 0) {
            selectedLand =
                lands.find(l => l.city_id === currentCityId && Number(l.is_primary) === 1) ||
                lands.find(l => l.city_id === currentCityId) ||
                lands[0];
        }
        session.selectedLandId = selectedLand ? Number(selectedLand.id) : null;

        let selectedLandCells = [];
        let selectedLandStats = null;
        let selectedLandProject = null;
        let selectedLandCondition = null;
        let heavyRenoReqs = {};
        let selectedBizRows = [];
        let pendingRevenue = 0;

        if (selectedLand) {
            await syncLandConstruction(conn, selectedLand.id, now);
            await syncBusinessRevenueTick(conn, selectedLand.id, now);
            selectedLand = (await getLandById(conn, selectedLand.id, false)) || selectedLand;
            lands = await getPlayerLands(conn, discordId, null, false);
            selectedLandCells = await getLandCells(conn, selectedLand.id, 'active');
            selectedLandStats = computeLandStats(selectedLandCells, selectedLand, getCityZoning(selectedLand.city_id));
            selectedLandProject = await getActiveConstructionProject(conn, selectedLand.id, false);
            selectedLandCondition = getConditionMeta(selectedLand.condition_pct, selectedLand.building_state, selectedLandCells.length > 0);
            heavyRenoReqs = getHeavyRenovationRequirements(selectedLandCells, selectedLand.condition_pct);
            const [bRows] = await conn.execute(
                `SELECT * FROM land_business_state WHERE land_id = ?`,
                [selectedLand.id]
            );
            selectedBizRows = bRows;
            pendingRevenue = bRows.reduce((s, r) => s + Number(r.pending_revenue || 0), 0);
        }

        const [emergRows] = await conn.execute(
            `SELECT COALESCE(SUM(quantity), 0) AS qty FROM player_inventory WHERE discord_id = ? AND emergency_locked = 1`,
            [discordId]
        );
        const emergencyLockedCount = Number(emergRows[0]?.qty || 0);

        const [galleryRows] = await conn.execute(
            `SELECT pl.*, p.username AS owner_name,
                    (SELECT COUNT(*) FROM property_likes lk WHERE lk.land_id = pl.id) AS like_count,
                    EXISTS(SELECT 1 FROM property_likes lk2 WHERE lk2.land_id = pl.id AND lk2.liker_id = ?) AS liked_by_me
             FROM player_lands pl
             JOIN players p ON p.discord_id = pl.discord_id
             WHERE EXISTS(SELECT 1 FROM land_grid_cells c WHERE c.land_id = pl.id AND c.layout_state = 'active')
             ORDER BY like_count DESC, pl.updated_at DESC
             LIMIT 25`,
            [discordId]
        );

        const galleryLands = galleryRows || [];
        let galleryLand = galleryLands.find(g => Number(g.id) === Number(session.galleryLandId)) || galleryLands[0] || null;
        session.galleryLandId = galleryLand ? Number(galleryLand.id) : null;
        let galleryCells = [];
        let galleryStats = null;
        let galleryCondition = null;
        if (galleryLand) {
            galleryCells = await getLandCells(conn, galleryLand.id, 'active');
            galleryStats = computeLandStats(galleryCells, galleryLand, getCityZoning(galleryLand.city_id));
            galleryCondition = getConditionMeta(galleryLand.condition_pct, galleryLand.building_state, galleryCells.length > 0);
        }

        const bagRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const [wsQueues] = await conn.execute(
            `SELECT * FROM workshop_queues WHERE discord_id = ? ORDER BY finishes_at ASC`,
            [discordId]
        );

        const [marketListings] = await conn.execute(
            `SELECT l.*, pl.custom_name, pl.width, pl.height, pl.land_tier, pl.city_id, pl.condition_pct, pr.username AS seller_name
             FROM property_market_listings l
             JOIN player_lands pl ON pl.id = l.land_id
             JOIN players pr ON pr.discord_id = l.seller_id
             WHERE l.status = 'active'
             ORDER BY l.created_at DESC
             LIMIT 25`
        );

        const [vacantRooms] = await conn.execute(
            `SELECT c.land_id, c.zone_group_id, MAX(c.zone_name) AS zone_name, COUNT(*) AS cell_count,
                    pl.custom_name, pl.city_id, pl.condition_pct, pl.discord_id AS owner_id, pr.username AS owner_name
             FROM land_grid_cells c
             JOIN player_lands pl ON pl.id = c.land_id
             JOIN players pr ON pr.discord_id = pl.discord_id
             LEFT JOIN property_leases le
               ON le.land_id = c.land_id AND le.zone_group_id = c.zone_group_id AND le.is_evicted = 0
             WHERE c.layout_state = 'active'
               AND c.module_id = 'rental_room'
               AND pl.condition_pct >= 50
               AND le.id IS NULL
             GROUP BY c.land_id, c.zone_group_id, pl.custom_name, pl.city_id, pl.condition_pct, pl.discord_id, pr.username
             ORDER BY pl.city_id = ? DESC, c.land_id DESC
             LIMIT 25`,
            [currentCityId]
        );

        const totalSkillLv = getTotalSkillLevelFromPlayerRow(player);
        const maxLands = getMaxLandLimit(totalSkillLv);

        return {
            player,
            status,
            lands,
            maxLands,
            totalSkillLv,
            selectedLand,
            selectedLandCells,
            selectedLandStats,
            selectedLandProject,
            selectedLandCondition,
            heavyRenoReqs,
            selectedBizRows,
            pendingRevenue,
            emergencyLockedCount,
            galleryLands,
            galleryLand,
            galleryCells,
            galleryStats,
            galleryCondition,
            bagRows,
            wsQueues,
            marketListings,
            vacantRooms
        };
    });
}

async function buildHomeTabPanel({ state, banner = null, now = Date.now() }) {
    const p = state.player;
    const ownerId = p.discord_id;
    const session = getPropSession(ownerId);
    const curCity = getCity(p.current_city || 'kota_sentral');
    const st = state.status;
    const curTier = st.effectiveTier;

    const sourceLabelMap = {
        owned_land: '🏡 Properti Sendiri',
        p2p_room: '🚪 Kos P2P (Sewa Pemain)',
        p2p_whole: '🔑 Rumah Sewa P2P',
        npc_lease: '🔑 Sewa Pemula NPC',
        legacy: '🏠 Properti Lama',
        tunawisma: '🏕️ Tunawisma Lokal'
    };
    const lands = Array.isArray(state.lands) ? state.lands : [];
    const maxLands = Number(state.maxLands || 3);
    const localTag = sourceLabelMap[st.source] || curTier.name;
    let billingLine = '• 🏷️ **Tagihan:** Gratis *(belum punya aset/sewa aktif)*';
    if (st.source === 'owned_land' && st.land) {
        const pbbOrd = Math.max(0, lands.findIndex(l => Number(l.id) === Number(st.land.id)));
        const pbbAmt = Math.round((st.stats?.monthlyPbbBase || 0) * getProgressivePbbMultiplier(pbbOrd));
        const pbbUnix = st.land.next_pbb_at > 0 ? Math.floor(Number(st.land.next_pbb_at) / 1000) : null;
        const graceWarn = Number(st.land.grace_until || 0) > now
            ? ` · ⚠️ **TUNGGAKAN PBB! Sita <t:${Math.floor(Number(st.land.grace_until) / 1000)}:R>**`
            : '';
        billingLine = `• 🧾 **PBB Bulanan:** ${formatLp(pbbAmt)}${pbbUnix ? ` · Jatuh tempo <t:${pbbUnix}:R>` : ''}${graceWarn}`;
    } else if (st.lease) {
        const billUnix = st.lease.next_billing_at > 0 ? Math.floor(Number(st.lease.next_billing_at) / 1000) : null;
        billingLine = st.inGracePeriod
            ? `• ⚠️ **MASA TENGGANG SEWA!** Autodebit jatuh tempo <t:${Math.floor(Number(st.lease.grace_until) / 1000)}:R>`
            : `• 📅 **Sewa Mingguan:** ${formatLp(st.lease.weekly_rent)}${billUnix ? ` · Tagihan <t:${billUnix}:R>` : ''}`;
    }

    const blocks = [];
    let files = null;
    let accentColor = st.inGracePeriod ? COLORS.WARNING : COLORS.LIFE;

    if (state.selectedLand) {
        const sl = state.selectedLand;
        const slCity = getCity(sl.city_id);
        const zoning = getCityZoning(sl.city_id);
        const condPct = Number(sl.condition_pct ?? 100);
        const condMeta = state.selectedLandCondition || getConditionMeta(condPct, sl.building_state, state.selectedLandCells.length > 0);
        if (condMeta.isCollapsed || condMeta.isAbandoned) accentColor = COLORS.DANGER;
        else if (condMeta.state === 'worn') accentColor = COLORS.WARNING;

        const att = await buildPropertyCanvasAttachment({
            land: sl,
            allCells: state.selectedLandCells,
            stats: state.selectedLandStats,
            viewFloor: 1,
            layoutMode: 'active',
            project: state.selectedLandProject,
            cameraAngle: session.cameraAngle || 0
        }, now);
        files = [att.attachment];
        blocks.push({ image: { url: att.url, description: `Preview 3D ${sl.custom_name}` } });

        const localLockNote = st.facilitiesLocked
            ? `\n• 🔒 **Status Hunian Kota Ini:** Bangunan lokal berstatus **${condMeta.label}** — fasilitas \`/sleep\`, \`/cook\`, \`/storage\` terkunci hingga direnovasi!`
            : '';

        blocks.push([
            `${formatVitalsCompact(p)} | 💰 **Tunai:** ${formatLp(p.cash)} | 🏦 **Bank:** ${formatLp(p.bank)}`,
            `📍 **Lokasi Saat Ini (${curCity.emoji} ${curCity.shortName}):** **${st.customName || curTier.name}** (${localTag})`,
            `• 🛌 **Tidur:** +${curTier.sleepEnergyBonus}⚡ (${formatDuration((curTier.sleepDurationSec || 3600) * 1000)}) · ${formatFacilitiesLine(curTier.facilities)}${localLockNote}`,
            billingLine
        ].join('\n'));

        const nextTier = getNextLandTier(sl.land_tier);
        const expandInfo = nextTier
            ? `Expand -> **${nextTier.shortName}** (${formatLp(calculateLandExpandPrice(sl.land_tier, sl.city_id))})`
            : 'Ukuran Maksimal (10×10)';
        const parcelTag = sl.parcel_code ? `\`${sl.parcel_code}\` · ` : '';
        const condNote = condMeta.isCollapsed
            ? ' *(🏚️ ROBOH! Bersihkan puing di bawah sebelum membangun ulang)*'
            : condMeta.isAbandoned
                ? ' *(🔒 Fasilitas & Usaha TERKUNCI — butuh Renovasi Berat)*'
                : condMeta.state === 'worn'
                    ? ' *(Kapasitas & Omzet ×0,75)*'
                    : '';
        const archTotal = state.selectedLandStats?.architectureScore;
        const archGrade = state.selectedLandStats?.architectureGrade || 'C';
        const archText = archTotal !== undefined ? ` · ✨ **Arsitektur:** ${archTotal}/100 (${archGrade})` : '';
        const rooms = state.selectedLandStats?.detectedRooms || [];
        const furnDetails = state.selectedLandStats?.furnitureDetails || [];
        const outdoorFurnCount = furnDetails.filter(d => d.isOutdoorPenalty).length;
        const roomNamesPreview = rooms.length > 0 ? ` *(${rooms.slice(0, 3).map(r => r.customName).join(', ')})*` : '';

        blocks.push([
            `### 🗺️ Portofolio Kavling (${lands.length}/${maxLands}): ${sl.custom_name} ${Number(sl.is_primary) === 1 ? '⭐ Utama' : ''}`,
            `• 🏙️ **Kota:** ${slCity.emoji} **${slCity.name}** · ${parcelTag}*(${zoning.zoningLabel})*`,
            `• 📐 **Ukuran:** \`${sl.width}×${sl.height}\` · ${condMeta.badge} **${condMeta.label}** (**${condPct.toFixed(1)}%**)${condNote}`,
            `• 🚪 **Ruang & Perabot:** ${rooms.length} ruang (${rooms.filter(r => r.isIndoorValid).length} tertutup ✅)${roomNamesPreview} · 🛋️ **${furnDetails.length} perabot**${outdoorFurnCount > 0 ? ` *(⚠️ ${outdoorFurnCount} terbuka -50%)*` : ''}`,
            `• 💰 **NJOP:** ${formatLp(state.selectedLandStats?.totalAppraisalValue || 0)}${archText} · 🏪 **Omzet:** ${formatLp(state.pendingRevenue || 0)} · 📐 **Upgrade:** ${expandInfo}`
        ].join('\n'));
    } else {
        blocks.push([
            `${formatVitalsCompact(p)} | 💰 **Tunai:** ${formatLp(p.cash)} | 🏦 **Bank:** ${formatLp(p.bank)}`,
            `📍 **Status Lokal (${curCity.emoji} ${curCity.name}):** ${curTier.emoji} **${st.customName || curTier.name}** (${localTag})`,
            `• 🛌 **Tidur:** +${curTier.sleepEnergyBonus}⚡ (${formatDuration((curTier.sleepDurationSec || 3600) * 1000)}) · ${formatFacilitiesLine(curTier.facilities)}`,
            billingLine,
            '',
            `💡 **Kamu memiliki 0/${maxLands} kavling pribadi.** Beli kavling distrik (\`4×4\`–\`10×10\`) lewat \`/tanah\` atau sewa Kos NPC pemula di sini!`
        ].join('\n'));
    }

    if (state.emergencyLockedCount > 0) {
        blocks.push(`🚨 **Evakuasi Darurat (${state.emergencyLockedCount} barang terkunci dari puing):** Klik tombol **Evakuasi Darurat** untuk memindahkan barang ke Tas (atau sisakan sementara jika Tas penuh).`);
    }

    const rows = [];
    if (lands.length > 0 && state.selectedLand) {
        const sl = state.selectedLand;
        const nextTier = getNextLandTier(sl.land_tier);
        const condPct = Number(sl.condition_pct ?? 100);
        const condMeta = state.selectedLandCondition || getConditionMeta(condPct, sl.building_state, state.selectedLandCells.length > 0);

        rows.push(
            select('property', 'pick_land', ownerId, {
                placeholder: 'Pilih kavling milikmu untuk dikelola...',
                options: lands.slice(0, 25).map(l => {
                    const c = getCity(l.city_id);
                    const cm = getConditionMeta(l.condition_pct, l.building_state, true);
                    return {
                        label: `${l.custom_name} (${l.width}×${l.height})`,
                        value: String(l.id),
                        emoji: c.emoji,
                        description: `${l.parcel_code ? `${l.parcel_code} · ` : ''}${c.shortName} · ${cm.label} (${Math.round(l.condition_pct)}%)${Number(l.is_primary) === 1 ? ' · Utama' : ''}`,
                        default: Number(l.id) === Number(sl.id)
                    };
                })
            }, now)
        );

        let conditionActionBtn;
        if (condMeta.isCollapsed) {
            conditionActionBtn = btn('property', 'clear_rubble_prompt', ownerId, {
                label: 'Bersihkan Puing',
                emoji: '🧹',
                style: ButtonStyle.Danger
            }, now);
        } else if (condMeta.isAbandoned || condPct < 60) {
            conditionActionBtn = btn('property', 'heavy_reno_prompt', ownerId, {
                label: 'Renovasi Berat',
                emoji: '🛠️',
                style: ButtonStyle.Danger
            }, now);
        } else {
            conditionActionBtn = btn('property', 'repair_confirm', ownerId, {
                label: `Rawat (${Math.round(condPct)}%)`,
                emoji: '🔧',
                style: ButtonStyle.Secondary,
                disabled: condPct >= 99
            }, now);
        }

        rows.push(
            new ActionRowBuilder().addComponents(
                btn('bangun', 'home', ownerId, {
                    label: 'Studio /bangun',
                    emoji: '🏗️',
                    style: ButtonStyle.Success
                }, now),
                btn('property', 'rot_cam', ownerId, {
                    label: `Putar ${(Number(session.cameraAngle || 0) % 4) * 90}°`,
                    emoji: '🔄',
                    style: ButtonStyle.Secondary
                }, now),
                btn('property', 'set_primary', ownerId, {
                    label: 'Set Utama',
                    emoji: '⭐',
                    style: ButtonStyle.Primary,
                    disabled: Number(sl.is_primary) === 1
                }, now),
                conditionActionBtn,
                btn('property', 'expand_prompt', ownerId, {
                    label: nextTier ? `Perluas ${nextTier.shortName}` : 'Ukuran Max',
                    emoji: '📐',
                    style: ButtonStyle.Secondary,
                    disabled: !nextTier || condMeta.isCollapsed
                }, now)
            )
        );
    }

    const navBtns = [
        btn('tanah', 'home', ownerId, {
            label: 'Peta /tanah',
            emoji: '🗺️',
            style: ButtonStyle.Success
        }, now),
        btn('property', 'tab_npc', ownerId, {
            label: 'Sewa NPC',
            emoji: '🔑',
            style: ButtonStyle.Primary
        }, now),
        btn('property', 'tab_biz_ws', ownerId, {
            label: 'Usaha & Workshop',
            emoji: '🏪',
            style: ButtonStyle.Primary
        }, now),
        btn('property', 'tab_gallery', ownerId, {
            label: 'Galeri 3D',
            emoji: '🏛️',
            style: ButtonStyle.Secondary
        }, now)
    ];

    if (st.lease && !st.isEvicted) {
        navBtns.push(
            btn('property', 'moveout_prompt', ownerId, {
                label: 'Moveout',
                emoji: '📦',
                style: ButtonStyle.Danger
            }, now)
        );
    }
    rows.push(new ActionRowBuilder().addComponents(navBtns.slice(0, 5)));

    if (state.emergencyLockedCount > 0) {
        rows.push(
            new ActionRowBuilder().addComponents(
                btn('property', 'evacuate_confirm', ownerId, {
                    label: `Evakuasi Darurat (${state.emergencyLockedCount})`,
                    emoji: '🚨',
                    style: ButtonStyle.Danger
                }, now)
            )
        );
    }

    return buildPanel({
        mod: 'property',
        ownerId,
        accentColor,
        title: `🏘️ Portal Real Estate & Properti Terpadu`,
        banner,
        blocks,
        rows: rows.slice(0, 5),
        footer: 'Desain di /bangun · Beli kavling & lelang di /tanah · Kelola usaha, renovasi & Galeri 3D di sini.',
        files,
        now
    });
}

function buildBuyLandTabPanel({ state, banner = null, now = Date.now() }) {
    const p = state.player;
    const ownerId = p.discord_id;
    const session = getPropSession(ownerId);
    const targetCity = getCity(session.buyCityId || p.current_city || 'kota_sentral');
    const zoning = getCityZoning(targetCity.id);
    const isPreset = String(session.buySelection || '').startsWith('preset:');
    const presetId = isPreset ? session.buySelection.slice(7) : null;
    const presetBp = presetId ? convertPresetToBlueprint(presetId) : null;
    const tierObj = !isPreset ? getLandTier(session.buySelection || 'mini_3x3') : null;
    const price = isPreset
        ? Number(presetBp?.buyPrice || 0)
        : calculateLandPurchasePrice(tierObj.id, targetCity.id);

    const catalogLines = LAND_TIERS.map(t => {
        const pr = calculateLandPurchasePrice(t.id, targetCity.id);
        return `${t.emoji} **${t.name}** — **${formatLp(pr)}** *(${t.totalCells} petak)*\n   └ ${t.description}`;
    }).join('\n');

    const presetLines = ['rumah', 'rumah_mewah'].map(pid => {
        const bp = convertPresetToBlueprint(pid);
        return `🏡 **Paket Siap Huni: ${bp.name}** — **${formatLp(bp.buyPrice)}** *(Dibangun di kota tempatmu berdiri: ${getCity(p.current_city).shortName})*`;
    }).join('\n');

    const allBuyOptions = [
        ...LAND_TIERS.map(t => ({
            label: `${t.name} di ${targetCity.shortName}`,
            value: t.id,
            emoji: t.emoji,
            description: `Harga: ${formatLp(calculateLandPurchasePrice(t.id, targetCity.id))} | ${t.totalCells} petak`,
            default: session.buySelection === t.id
        })),
        ...['rumah', 'rumah_mewah'].map(pid => {
            const bp = convertPresetToBlueprint(pid);
            return {
                label: `Paket Siap Huni: ${bp.name}`,
                value: `preset:${pid}`,
                emoji: '🏡',
                description: `Harga: ${formatLp(bp.buyPrice)} | langsung jadi & siap huni`,
                default: session.buySelection === `preset:${pid}`
            };
        })
    ];

    const rows = [
        select('property', 'buy_city', ownerId, {
            placeholder: 'Pilih kota lokasi kavling...',
            options: Object.values(CITIES).map(c => ({
                label: c.name,
                value: c.id,
                emoji: c.emoji,
                description: getCityZoning(c.id).zoningLabel,
                default: c.id === targetCity.id
            }))
        }, now),
        select('property', 'buy_tier', ownerId, {
            placeholder: 'Pilih ukuran kavling atau paket siap huni...',
            options: allBuyOptions
        }, now),
        new ActionRowBuilder().addComponents(
            btn('property', 'buy_land_prompt', ownerId, {
                label: `Beli (${formatLp(price)})`,
                emoji: '🌱',
                style: ButtonStyle.Success,
                disabled: state.lands.length >= state.maxLands
            }, now),
            btn('credit', 'home', ownerId, {
                label: 'Ajukan KPR (/credit)',
                emoji: '💳',
                style: ButtonStyle.Primary
            }, now),
            btn('property', 'home', ownerId, {
                label: 'Kembali',
                emoji: '⬅️',
                style: ButtonStyle.Secondary
            }, now)
        )
    ];

    return buildPanel({
        mod: 'property',
        ownerId,
        accentColor: COLORS.SUCCESS,
        title: `🌱 Beli Kavling Baru & Paket Siap Huni`,
        banner,
        blocks: [
            `${formatVitalsCompact(p)} | 💰 **Tunai:** ${formatLp(p.cash)} | 🏦 **Bank:** ${formatLp(p.bank)} | 📦 **Slot Kavling:** \`${state.lands.length}/${state.maxLands}\``,
            `🏙️ **Kota Terpilih (${targetCity.emoji} ${targetCity.name}):** *${zoning.zoningLabel}*\n• Harga dasar: **${formatLp(zoning.landBasePrice)}** · Omzet Usaha: **×${zoning.businessTrafficMult}** · Bonus Gudang: **+${Math.round((zoning.warehouseBonus || 0) * 100)}%** · Biaya Workshop: **×${zoning.workshopCostMult}**`,
            `${catalogLines}\n${presetLines}`
        ],
        rows,
        footer: state.lands.length >= state.maxLands
            ? `Kapasitas kavlingmu penuh (${state.lands.length}/${state.maxLands}). Tingkatkan total skill +25 Lv untuk slot baru!`
            : 'Pilih kavling di /tanah (peta distrik terbatas & lelang), atau gunakan KPR di /credit.',
        now
    });
}

function buildNpcTabPanel({ state, banner = null, now = Date.now() }) {
    const p = state.player;
    const ownerId = p.discord_id;
    const session = getPropSession(ownerId);
    const npcTiers = getNpcRentTiers();
    const chosen = getPropertyTier(session.npcTierId || 'kos');
    const st = state.status;

    const tierList = npcTiers.map(t =>
        `${t.emoji} **${t.name}** — **${formatLp(t.rentPerWeek)}/minggu**\n   └ 🛌 +${t.sleepEnergyBonus}⚡ (${formatDuration((t.sleepDurationSec || 3600) * 1000)}) · ${formatFacilitiesLine(t.facilities)}`
    ).join('\n');

    const rows = [
        select('property', 'pick_npc', ownerId, {
            placeholder: 'Pilih kamar kos atau rumah kontrakan NPC...',
            options: npcTiers.map(t => ({
                label: `${t.name} (${formatLp(t.rentPerWeek)}/mgg)`,
                value: t.id,
                emoji: t.emoji,
                description: formatFacilitiesLine(t.facilities).replace(/\*\*/g, ''),
                default: t.id === chosen.id
            }))
        }, now),
        new ActionRowBuilder().addComponents(
            btn('property', 'rent_prompt', ownerId, {
                label: `Sewa ${chosen.name}`,
                emoji: '🔑',
                style: ButtonStyle.Primary,
                arg: chosen.id
            }, now),
            btn('property', 'moveout_prompt', ownerId, {
                label: 'Berhenti Sewa',
                emoji: '📦',
                style: ButtonStyle.Danger,
                disabled: !st.lease || st.isEvicted
            }, now),
            btn('property', 'home', ownerId, {
                label: 'Kembali',
                emoji: '⬅️',
                style: ButtonStyle.Secondary
            }, now)
        )
    ];

    return buildPanel({
        mod: 'property',
        ownerId,
        accentColor: COLORS.LIFE,
        title: `🔑 Sewa Pemula NPC (${getCity(p.current_city).name})`,
        banner,
        blocks: [
            `${formatVitalsCompact(p)} | 💰 **Tunai:** ${formatLp(p.cash)} | 🏦 **Bank:** ${formatLp(p.bank)}`,
            `Alternatif praktis sebelum punya tanah sendiri atau saat singgah di kota perantauan:\n${tierList}`
        ],
        rows,
        footer: 'Sewa ditagih otomatis per 7 hari dari saldo Bank. Upgrade tier mendapat potongan prorata.',
        now
    });
}

function buildBizWorkshopTabPanel({ state, banner = null, now = Date.now() }) {
    const p = state.player;
    const ownerId = p.discord_id;
    const session = getPropSession(ownerId);
    const curCity = getCity(p.current_city || 'kota_sentral');
    const sl = state.selectedLand;
    const recipe = getWorkshopRecipe(session.wsRecipeId) || WORKSHOP_RECIPES[0];

    const hasPrivateStation = Boolean(
        sl && state.selectedLandCells.some(c => recipe.stationModuleIds.includes(c.module_id))
    );
    const zoning = getCityZoning(hasPrivateStation ? sl.city_id : curCity.id);
    const feePerBatch = Math.round((hasPrivateStation ? recipe.privateFee : recipe.npcFee) * Number(zoning.workshopCostMult || 1));

    const inpText = recipe.inputs.map(inp => {
        const it = getItem(inp.itemId);
        const inBag = state.bagRows.filter(r => r.item_id === inp.itemId).reduce((s, r) => s + Number(r.quantity), 0);
        return `${inp.qty}× ${it?.emoji || '📦'} ${it?.name || inp.itemId} *(Tas: ${inBag})*`;
    }).join(' + ');

    const readyQueues = (state.wsQueues || []).filter(q => Number(q.finishes_at) <= now);
    const activeQueues = (state.wsQueues || []).filter(q => Number(q.finishes_at) > now);
    const queueLines = [];
    if (readyQueues.length > 0) {
        queueLines.push(`✅ **${readyQueues.length} batch hasil workshop siap diambil!**`);
    }
    for (const q of activeQueues.slice(0, 3)) {
        const rec = getWorkshopRecipe(q.recipe_id);
        const outItem = rec ? getItem(rec.outputItemId) : null;
        queueLines.push(`⏳ **${(rec?.outputQty || 1) * Number(q.quantity)}× ${outItem?.name || q.recipe_id}** selesai <t:${Math.floor(Number(q.finishes_at) / 1000)}:R>`);
    }

    const bizZones = state.selectedLandStats?.businessZones || [];
    const retailZones = bizZones.filter(z => ['shop', 'cafe'].includes(z.module.stats?.businessType));

    const stockSummaries = [];
    for (const row of state.selectedBizRows || []) {
        let m = {};
        try { m = JSON.parse(row.stock_json || '{}'); } catch { m = {}; }
        const itemsList = Object.entries(m).filter(([, q]) => q > 0).slice(0, 4).map(([iid, q]) => {
            const it = getItem(iid);
            return `${it?.emoji || '📦'} ${it?.name || iid} (${q})`;
        });
        if (itemsList.length > 0) stockSummaries.push(itemsList.join(', '));
    }

    const sellableBagMap = new Map();
    for (const r of state.bagRows || []) {
        const it = getItem(r.item_id);
        if (!it || (Number(it.sellPrice || 0) <= 0 && Number(it.buyPrice || 0) <= 0)) continue;
        if (Number(r.quantity) <= 0) continue;
        const prev = sellableBagMap.get(it.id) || { item: it, qty: 0 };
        prev.qty += Number(r.quantity);
        sellableBagMap.set(it.id, prev);
    }
    const sellableOptions = [...sellableBagMap.values()].slice(0, 25).map(({ item, qty }) => ({
        label: `${item.name} (Tas: ${qty})`,
        value: item.id,
        emoji: item.emoji,
        description: `Harga Ecer Usaha: ${formatLp(getControlledRetailPrice(item))}/unit`
    }));

    const outItem = getItem(recipe.outputItemId);
    const condMeta = state.selectedLandCondition;
    const isBizLocked = Boolean(sl && condMeta?.facilitiesLocked);
    const blocks = [
        [
            `### ⚒️ Workshop Material (${hasPrivateStation ? `🏡 Pribadi: ${sl.custom_name}` : `🏭 Umum: ${curCity.name}`})`,
            `• 📜 **Resep Terpilih:** **${recipe.outputQty}× ${outItem?.emoji || '🧱'} ${outItem?.name || recipe.outputItemId}**`,
            `• 📥 **Bahan/Batch:** ${inpText}`,
            `• 💰 **Biaya Jasa:** ${formatLp(feePerBatch)}/batch · ⏱️ **Waktu:** ${formatDuration(recipe.durationSec * 1000)}/batch`,
            queueLines.length > 0 ? queueLines.join('\n') : '• 💤 *Belum ada antrean workshop berjalan.*'
        ].join('\n'),
        sl
            ? [
                `### 🏪 Etalase Usaha Kavling: ${sl.custom_name}`,
                isBizLocked ? `• 🔒 **TERKUNCI (${condMeta.label}):** Renovasi atau bersihkan puing kavling di Beranda untuk mengaktifkan usaha & setor stok.` : null,
                `• 📊 **Zona Aktif:** ${bizZones.length > 0 ? `${bizZones.length} zona usaha (${retailZones.length} ritel/kafe)` : '*Belum punya Warung/Kafe/Kos di bangunan ini*'}`,
                `• 💰 **Omzet Belum Diklaim:** **${formatLp(state.pendingRevenue)}** *(Dihitung tiap jam saat kondisi >= 30% / tidak terbengkalai)*`,
                stockSummaries.length > 0 ? `• 🛒 **Stok Etalase:** ${stockSummaries.join(' | ')}` : '• 🛒 **Stok Etalase:** *Kosong (pilih item tas untuk menyetor ke etalase)*'
            ].filter(Boolean).join('\n')
            : `🏪 *Beli kavling di \`/tanah\` dan bangun Warung / Kafe / Kos di \`/bangun\` untuk mulai membuka usaha pasif.*`
    ];

    const rows = [
        select('property', 'ws_recipe', ownerId, {
            placeholder: 'Pilih resep pengolahan bahan bangunan...',
            options: WORKSHOP_RECIPES.map(r => {
                const it = getItem(r.outputItemId);
                return {
                    label: `${r.outputQty}× ${it?.name || r.outputItemId}`,
                    value: r.id,
                    emoji: it?.emoji || '🧱',
                    description: r.description,
                    default: r.id === recipe.id
                };
            })
        }, now),
        select('property', 'stock_item_select', ownerId, {
            placeholder: isBizLocked
                ? 'Usaha terkunci — renovasi properti dulu'
                : (retailZones.length > 0 ? 'Setor barang dari tas ke etalase Warung/Kafe...' : 'Butuh modul Warung/Kafe aktif untuk setor stok'),
            disabled: isBizLocked || retailZones.length === 0 || sellableOptions.length === 0,
            options: sellableOptions
        }, now),
        new ActionRowBuilder().addComponents(
            btn('property', 'ws_craft_modal', ownerId, {
                label: 'Proses Bahan (Batch)',
                emoji: '⚒️',
                style: ButtonStyle.Primary
            }, now),
            btn('property', 'ws_collect', ownerId, {
                label: `Ambil Hasil (${readyQueues.length})`,
                emoji: '📦',
                style: ButtonStyle.Success,
                disabled: readyQueues.length === 0
            }, now),
            btn('property', 'biz_collect', ownerId, {
                label: `Klaim ${formatLp(state.pendingRevenue)}`,
                emoji: '💰',
                style: ButtonStyle.Success,
                disabled: state.pendingRevenue <= 0 || !sl
            }, now),
            btn('property', 'home', ownerId, {
                label: 'Kembali',
                emoji: '⬅️',
                style: ButtonStyle.Secondary
            }, now)
        )
    ];

    return buildPanel({
        mod: 'property',
        ownerId,
        accentColor: COLORS.ECONOMY,
        title: `🏪 Manajemen Usaha & Workshop Material`,
        banner,
        blocks,
        rows,
        footer: 'Workshop Pribadi di kavlingmu memangkas biaya jasa hingga 70% dibanding Workshop Umum Kota!',
        now
    });
}

function buildMarketTabPanel({ state, banner = null, now = Date.now() }) {
    const p = state.player;
    const ownerId = p.discord_id;
    const session = getPropSession(ownerId);
    const listings = state.marketListings || [];
    const rooms = state.vacantRooms || [];

    const selectedListing = listings.find(l => Number(l.id) === Number(session.selectedListingId)) || listings[0] || null;
    if (selectedListing) session.selectedListingId = Number(selectedListing.id);

    const makeRoomKey = (r) => `${r.land_id}:${r.zone_group_id}`;
    const selectedRoom = rooms.find(r => makeRoomKey(r) === session.selectedRentKey) || rooms[0] || null;
    if (selectedRoom) session.selectedRentKey = makeRoomKey(selectedRoom);

    const roomPrice = (r) => 120000 + Number(r.cell_count || 1) * 40000;

    const listingText = listings.length > 0
        ? listings.slice(0, 6).map(l => {
            const c = getCity(l.city_id);
            const ownMark = l.seller_id === ownerId ? ' *(Milikmu)*' : '';
            return `• **#${l.id}** ${c.emoji} **${l.custom_name}** (\`${l.width}×${l.height}\`) — **${formatLp(l.asking_price)}** *(NJOP ${formatLp(l.appraisal_value)})* · Penjual: ${l.seller_name}${ownMark}`;
        }).join('\n')
        : '*Belum ada properti yang dijual oleh pemain lain saat ini.*';

    const roomText = rooms.length > 0
        ? rooms.slice(0, 5).map(r => {
            const c = getCity(r.city_id);
            const ownMark = r.owner_id === ownerId ? ' *(Kosm-mu)*' : '';
            return `• 🚪 **${r.zone_name || 'Kamar Kos'}** @ ${c.emoji} **${r.custom_name}** — **${formatLp(roomPrice(r))}/mgg** *(Pemilik: ${r.owner_name})*${ownMark}`;
        }).join('\n')
        : '*Belum ada Kamar Kos P2P kosong yang tersedia saat ini.*';

    const canBuySelected = Boolean(selectedListing && selectedListing.seller_id !== ownerId);
    const canCancelSelected = Boolean(selectedListing && selectedListing.seller_id === ownerId);
    const canRentSelected = Boolean(selectedRoom && selectedRoom.owner_id !== ownerId);

    const rows = [
        select('property', 'market_pick', ownerId, {
            placeholder: listings.length > 0 ? 'Pilih listing jual-beli properti P2P...' : 'Tidak ada listing aktif',
            disabled: listings.length === 0,
            options: listings.slice(0, 25).map(l => ({
                label: `#${l.id} ${l.custom_name} (${formatLp(l.asking_price)})`,
                value: String(l.id),
                emoji: getCity(l.city_id).emoji,
                description: `${l.width}×${l.height} · NJOP ${formatLp(l.appraisal_value)} · Penjual: ${l.seller_name}`,
                default: selectedListing && Number(selectedListing.id) === Number(l.id)
            }))
        }, now),
        select('property', 'p2p_rent_pick', ownerId, {
            placeholder: rooms.length > 0 ? 'Pilih Kamar Kos P2P pemain untuk disewa...' : 'Belum ada kamar kos P2P kosong',
            disabled: rooms.length === 0,
            options: rooms.slice(0, 25).map(r => ({
                label: `${r.zone_name || 'Kamar Kos'} @ ${r.custom_name}`,
                value: makeRoomKey(r),
                emoji: getCity(r.city_id).emoji,
                description: `${formatLp(roomPrice(r))}/mgg · Kondisi ${Math.round(r.condition_pct)}% · ${r.owner_name}`,
                default: selectedRoom && makeRoomKey(selectedRoom) === makeRoomKey(r)
            }))
        }, now),
        new ActionRowBuilder().addComponents(
            btn('property', 'market_buy_prompt', ownerId, {
                label: 'Beli Properti',
                emoji: '🏡',
                style: ButtonStyle.Success,
                disabled: !canBuySelected
            }, now),
            btn('property', 'p2p_rent_prompt', ownerId, {
                label: 'Sewa Kos P2P',
                emoji: '🔑',
                style: ButtonStyle.Primary,
                disabled: !canRentSelected
            }, now),
            btn('property', 'market_sell_modal', ownerId, {
                label: 'Jual Kavling Saya',
                emoji: '🏷️',
                style: ButtonStyle.Secondary,
                disabled: !state.selectedLand
            }, now),
            btn('property', 'market_cancel', ownerId, {
                label: 'Batal Jual',
                emoji: '❌',
                style: ButtonStyle.Danger,
                disabled: !canCancelSelected
            }, now),
            btn('property', 'home', ownerId, {
                label: 'Kembali',
                emoji: '⬅️',
                style: ButtonStyle.Secondary
            }, now)
        )
    ];

    return buildPanel({
        mod: 'property',
        ownerId,
        accentColor: COLORS.ECONOMY,
        title: `⚖️ Pasar Jual-Beli Properti & Sewa Kos P2P`,
        banner,
        blocks: [
            `Syarat perdagangan P2P (anti-alt): Umur akun >= 7 hari, >= 20 shift kerja, & Total Skill >= Lv. 10. Pajak BPHTB 5%.`,
            `### 🏘️ Properti Dijual Pemain\n${listingText}`,
            `### 🚪 Kamar Kos P2P Tersedia\n${roomText}`
        ],
        rows,
        footer: state.selectedLand
            ? `Jual Kavling terfokus: ${state.selectedLand.custom_name} (NJOP ${formatLp(state.selectedLandStats?.totalAppraisalValue || 0)})`
            : 'Pilih listing atau kamar kos dari dropdown di atas.',
        now
    });
}

async function buildGalleryTabPanel({ state, banner = null, now = Date.now() }) {
    const p = state.player;
    const ownerId = p.discord_id;
    const session = getPropSession(ownerId);
    const items = state.galleryLands || [];
    const gl = state.galleryLand;

    let files = null;
    const blocks = [];

    if (gl) {
        const c = getCity(gl.city_id);
        const condMeta = state.galleryCondition || getConditionMeta(gl.condition_pct, gl.building_state, (state.galleryCells || []).length > 0);
        const att = await buildPropertyCanvasAttachment({
            land: gl,
            allCells: state.galleryCells || [],
            stats: state.galleryStats,
            viewFloor: 1,
            layoutMode: 'active',
            cameraAngle: session.galleryCameraAngle || 0
        }, now);
        files = [att.attachment];
        blocks.push({ image: { url: att.url, description: `Galeri 3D ${gl.custom_name}` } });

        const archEval = state.galleryStats && state.galleryStats.architectureScore !== undefined
            ? state.galleryStats
            : computeArchitectureScore(state.galleryCells || [], gl);
        const archVal = Number(archEval.architectureScore || 0);
        const archGrade = archEval.architectureGrade || 'C';
        const likedByMe = Number(gl.liked_by_me || 0) === 1;
        blocks.push([
            `### 🏛️ ${gl.custom_name} — Karya **${gl.owner_name}**`,
            `• 📍 **Lokasi:** ${c.emoji} **${c.name}**${gl.parcel_code ? ` · \`${gl.parcel_code}\`` : ''} · Ukuran \`${gl.width}×${gl.height}\``,
            `• ${condMeta.badge} **${condMeta.label}** (**${Math.round(Number(gl.condition_pct ?? 100))}%**) · ✨ **Skor Arsitektur:** **${archVal}/100 (${archGrade})** · ❤️ **${gl.like_count || 0} Likes**${likedByMe ? ' *(Sudah kamu sukai)*' : ''}`
        ].join('\n'));
    } else {
        blocks.push('*Belum ada bangunan aktif di kota manapun untuk dipamerkan di Galeri 3D.*');
    }

    const rows = [];
    if (items.length > 0 && gl) {
        rows.push(
            select('property', 'gallery_pick', ownerId, {
                placeholder: 'Kunjungi karya bangunan pemain lain...',
                options: items.slice(0, 25).map(g => ({
                    label: `${g.custom_name} (${g.owner_name})`,
                    value: String(g.id),
                    emoji: getCity(g.city_id).emoji,
                    description: `${g.parcel_code || `${g.width}×${g.height}`} · ❤️ ${g.like_count || 0} · Kondisi ${Math.round(Number(g.condition_pct ?? 100))}%`,
                    default: Number(g.id) === Number(gl.id)
                }))
            }, now)
        );
    }

    const likedByMe = Boolean(gl && Number(gl.liked_by_me || 0) === 1);
    rows.push(
        new ActionRowBuilder().addComponents(
            btn('property', 'gallery_rot_cam', ownerId, {
                label: `Putar ${(Number(session.galleryCameraAngle || 0) % 4) * 90}°`,
                emoji: '🔄',
                style: ButtonStyle.Secondary,
                disabled: !gl
            }, now),
            btn('property', 'gallery_like', ownerId, {
                label: likedByMe ? `Unlike (${gl?.like_count || 0})` : `Like ❤️ (${gl?.like_count || 0})`,
                emoji: '❤️',
                style: likedByMe ? ButtonStyle.Danger : ButtonStyle.Success,
                disabled: !gl
            }, now),
            btn('property', 'home', ownerId, {
                label: 'Kembali',
                emoji: '⬅️',
                style: ButtonStyle.Secondary
            }, now)
        )
    );

    return buildPanel({
        mod: 'property',
        ownerId,
        accentColor: COLORS.LIFE,
        title: '🏛️ Galeri Kunjungan 3D Properti Warga',
        banner,
        blocks,
        rows: rows.slice(0, 5),
        footer: 'Putar sudut kamera isometrik 90° untuk mengagumi detail eksterior & beri ❤️ Like pada arsitektur favoritmu!',
        files,
        now
    });
}

async function buildPropertyPanel({ state, selectedTierId = null, banner = null, now = Date.now() }) {
    const ownerId = state.player.discord_id;
    const session = getPropSession(ownerId);
    if (selectedTierId) {
        session.npcTierId = selectedTierId;
    }

    if (session.tab === 'buy_land') return buildBuyLandTabPanel({ state, banner, now });
    if (session.tab === 'npc') return buildNpcTabPanel({ state, banner, now });
    if (session.tab === 'biz_ws') return buildBizWorkshopTabPanel({ state, banner, now });
    if (session.tab === 'market') return buildMarketTabPanel({ state, banner, now });
    if (session.tab === 'gallery') return await buildGalleryTabPanel({ state, banner, now });
    return await buildHomeTabPanel({ state, banner, now });
}

module.exports = {
    name: 'property',
    slash: true,
    lockTtl: 15,
    data: new SlashCommandBuilder()
        .setName('property')
        .setDescription(
            isPropertyUnderDevelopment()
                ? '[Under Development] Fitur properti & real estate sementara dinonaktifkan untuk perombakan.'
                : 'Portal Real Estate: beli kavling, sewa kos/P2P, kelola usaha, workshop & pasar properti.'
        ),

    async executeSlash(interaction) {
        const now = Date.now();
        if (isPropertyUnderDevelopment()) {
            cancelAutoUpdate(`property:${interaction.user.id}`);
            return await interaction.reply(
                buildPropertyUnderDevPanel({
                    mod: 'property',
                    ownerId: interaction.user.id,
                    ephemeral: true,
                    now
                })
            );
        }
        const session = getPropSession(interaction.user.id);
        session.tab = 'home';
        const state = await fetchPropertyState(interaction.user.id, now);
        return await interaction.reply(await buildPropertyPanel({ state, now }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.tab = 'home';
                const state = await fetchPropertyState(interaction.user.id, now);
                const res = await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
                schedulePropertyAutoUpdate(interaction.user.id, interaction, state);
                return res;
            },
            async tab_buy_land(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.tab = 'buy_land';
                const state = await fetchPropertyState(interaction.user.id, now);
                const res = await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
                schedulePropertyAutoUpdate(interaction.user.id, interaction, state);
                return res;
            },
            async tab_npc(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.tab = 'npc';
                const state = await fetchPropertyState(interaction.user.id, now);
                const res = await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
                schedulePropertyAutoUpdate(interaction.user.id, interaction, state);
                return res;
            },
            async tab_biz_ws(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.tab = 'biz_ws';
                const state = await fetchPropertyState(interaction.user.id, now);
                const res = await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
                schedulePropertyAutoUpdate(interaction.user.id, interaction, state);
                return res;
            },
            async tab_market(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.tab = 'market';
                const state = await fetchPropertyState(interaction.user.id, now);
                const res = await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
                schedulePropertyAutoUpdate(interaction.user.id, interaction, state);
                return res;
            },
            async tab_gallery(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.tab = 'gallery';
                cancelAutoUpdate(`property:${interaction.user.id}`);
                const state = await fetchPropertyState(interaction.user.id, now);
                return await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
            },

            async rot_cam(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.cameraAngle = (Number(session.cameraAngle || 0) + 1) % 4;
                const state = await fetchPropertyState(interaction.user.id, now);
                return await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
            },

            async gallery_rot_cam(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.galleryCameraAngle = (Number(session.galleryCameraAngle || 0) + 1) % 4;
                const state = await fetchPropertyState(interaction.user.id, now);
                return await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
            },

            async gallery_like(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                if (!session.galleryLandId) return;
                const res = await withTransaction(conn =>
                    togglePropertyLike(conn, interaction.user.id, session.galleryLandId, now)
                );
                const state = await fetchPropertyState(interaction.user.id, now);
                const banner = res.ok
                    ? {
                        type: res.liked ? 'success' : 'info',
                        text: res.liked
                            ? `❤️ Kamu menyukai karya bangunan ini! Total **${res.likeCount} Likes**.`
                            : `💔 Like dibatalkan. Total **${res.likeCount} Likes**.`
                    }
                    : { type: 'warning', text: res.error || 'Gagal memperbarui status Like.' };
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async set_primary(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                const res = await withTransaction(conn => setPrimaryLand(conn, interaction.user.id, session.selectedLandId, now));
                const state = await fetchPropertyState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `⭐ **${res.land.custom_name}** kini menjadi properti utama di kota tersebut!` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async expand_prompt(interaction) {
                const now = Date.now();
                const state = await fetchPropertyState(interaction.user.id, now);
                const sl = state.selectedLand;
                const next = sl ? getNextLandTier(sl.land_tier) : null;
                if (!sl || !next) return;
                const price = calculateLandExpandPrice(sl.land_tier, sl.city_id);
                return await interaction.update({
                    ...confirmView({
                        mod: 'property',
                        confirmAction: 'expand_confirm',
                        cancelAction: 'home',
                        ownerId: interaction.user.id,
                        title: `📐 Perluas Lahan: ${sl.custom_name}`,
                        description: [
                            `Kavling **${sl.custom_name}** akan diperluas dari **${sl.width}×${sl.height}** menjadi **${next.name}** (\`${next.totalCells} petak\`).`,
                            `• 💰 Biaya Izin & Pematangan Lahan: **${formatLp(price)}**\n• Seluruh bangunanmu saat ini tetap utuh.`
                        ],
                        confirmLabel: `Perluas (${formatLp(price)})`,
                        confirmStyle: ButtonStyle.Success,
                        arg: String(sl.id),
                        now
                    }),
                    attachments: []
                });
            },

            async expand_confirm(interaction, parsed) {
                const now = Date.now();
                const landId = Number(parsed.arg) || getPropSession(interaction.user.id).selectedLandId;
                const res = await withTransaction(conn => expandLand(conn, interaction.user.id, landId, now));
                const state = await fetchPropertyState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `📐 Lahan berhasil diperluas menjadi **${res.nextTier.name}** seharga **${formatLp(res.price)}**!` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async repair_confirm(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                const res = await withTransaction(conn => performLightMaintenance(conn, interaction.user.id, session.selectedLandId, now));
                const state = await fetchPropertyState(interaction.user.id, now);
                const costVal = res.costLp ?? res.cost ?? 0;
                const banner = res.ok
                    ? { type: 'success', text: `🔧 Perawatan ringan selesai! Kondisi pulih ke **100%** (Biaya **${formatLp(costVal)}** · Energy **-${res.energyCost || 0}⚡**).` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async heavy_reno_prompt(interaction) {
                const now = Date.now();
                const state = await fetchPropertyState(interaction.user.id, now);
                const sl = state.selectedLand;
                if (!sl) return;
                const reqs = state.heavyRenoReqs || getHeavyRenovationRequirements(state.selectedLandCells || [], sl.condition_pct);
                const matLines = Object.entries(reqs).filter(([, q]) => q > 0).map(([id, q]) => {
                    const it = getItem(id);
                    const inBag = (state.bagRows || []).filter(r => r.item_id === id).reduce((s, r) => s + Number(r.quantity), 0);
                    return `• ${it?.emoji || '📦'} **${it?.name || id}:** butuh \`${q}\` *(Di Tas: ${inBag})*`;
                });
                return await interaction.update({
                    ...confirmView({
                        mod: 'property',
                        confirmAction: 'heavy_reno_confirm',
                        cancelAction: 'home',
                        ownerId: interaction.user.id,
                        title: `🛠️ Renovasi Berat: ${sl.custom_name}`,
                        description: [
                            `Kavling **${sl.custom_name}** (Kondisi **${Math.round(Number(sl.condition_pct ?? 100))}%**) membutuhkan renovasi berat agar fasilitas \`/sleep\`, \`/cook\`, \`/storage\`, dan usaha aktif kembali.`,
                            matLines.length > 0 ? `**Material di Tas yang Dibutuhkan:**\n${matLines.join('\n')}` : '*(Tidak butuh material tambahan)*'
                        ],
                        confirmLabel: 'Renovasi Berat Sekarang',
                        confirmStyle: ButtonStyle.Danger,
                        arg: String(sl.id),
                        now
                    }),
                    attachments: []
                });
            },

            async heavy_reno_confirm(interaction, parsed) {
                const now = Date.now();
                const landId = Number(parsed.arg) || getPropSession(interaction.user.id).selectedLandId;
                const res = await withTransaction(conn => performHeavyRenovation(conn, interaction.user.id, landId, now));
                const state = await fetchPropertyState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🛠️ Renovasi berat selesai! Kondisi bangunan kembali **100%** (Biaya **${formatLp(res.costLp || 0)}** · Energy **-${res.energyCost || 0}⚡**).` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async clear_rubble_prompt(interaction) {
                const now = Date.now();
                const state = await fetchPropertyState(interaction.user.id, now);
                const sl = state.selectedLand;
                if (!sl) return;
                return await interaction.update({
                    ...confirmView({
                        mod: 'property',
                        confirmAction: 'clear_rubble_confirm',
                        cancelAction: 'home',
                        ownerId: interaction.user.id,
                        title: `🧹 Bersihkan Puing: ${sl.custom_name}`,
                        description: [
                            `Kavling **${sl.custom_name}** dalam status **Roboh**. Pembersihan puing akan:`,
                            '• Mengosongkan struktur bangunan roboh & memulihkan kondisi lahan menjadi **100%**\n• Menyelamatkan sebagian kecil material bekas ke Tas *(jika muat)*\n• Mengevakuasi barang di Kulkas/Freezer/Gudang ke Tas (`emergency_locked` jika penuh)'
                        ],
                        confirmLabel: 'Bersihkan Puing',
                        confirmStyle: ButtonStyle.Danger,
                        arg: String(sl.id),
                        now
                    }),
                    attachments: []
                });
            },

            async clear_rubble_confirm(interaction, parsed) {
                const now = Date.now();
                const landId = Number(parsed.arg) || getPropSession(interaction.user.id).selectedLandId;
                const res = await withTransaction(conn => clearCollapsedRubble(conn, interaction.user.id, landId, now));
                const state = await fetchPropertyState(interaction.user.id, now);
                const furnNote = Number(res.evacuatedFurnitureCount || 0) > 0 ? ` termasuk **${res.evacuatedFurnitureCount}** perabot` : '';
                const banner = res.ok
                    ? { type: 'success', text: `🧹 Puing dibersihkan! Kondisi kavling **100%** (Evakuasi: **${res.evacuatedCount || 0}** barang${furnNote} · Tersisa terkunci: **${res.remainingLocked || 0}**).` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async evacuate_confirm(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;
                const session = getPropSession(userId);
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await evacuateEmergencyStorage(conn, userId, session.selectedLandId, synced.player.max_slots, now);
                });
                const state = await fetchPropertyState(userId, now);
                const furnNote = Number(res.movedFurnitureCount || 0) > 0 ? ` (termasuk **${res.movedFurnitureCount}** perabot)` : '';
                const banner = res.ok
                    ? (res.movedCount > 0
                        ? { type: 'success', text: `🚨 Berhasil mengevakuasi **${res.movedCount}** barang darurat ke Tas${furnNote}! *(Sisa terkunci: **${res.remainingCount}** item)*` }
                        : { type: 'warning', text: `Tas penuh! Kosongkan slot tas dulu untuk mengevakuasi **${res.remainingCount}** barang tersisa.` })
                    : { type: 'warning', text: res.error || 'Tidak ada barang darurat yang perlu dievakuasi.' };
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async buy_land_prompt(interaction) {
                const now = Date.now();
                const ownerId = interaction.user.id;
                const session = getPropSession(ownerId);
                const state = await fetchPropertyState(ownerId, now);
                const targetCity = getCity(session.buyCityId || state.player.current_city);
                const isPreset = String(session.buySelection || '').startsWith('preset:');

                if (isPreset) {
                    const presetId = session.buySelection.slice(7);
                    const bp = convertPresetToBlueprint(presetId);
                    const pbb = calculateMonthlyPbb({ buyPrice: bp.buyPrice });
                    return await interaction.update({
                        ...confirmView({
                            mod: 'property',
                            confirmAction: 'buy_confirm',
                            cancelAction: 'tab_buy_land',
                            ownerId,
                            title: `🏡 Beli Paket Siap Huni: ${bp.name}`,
                            description: [
                                `Kamu akan membeli **${bp.name}** di **${getCity(state.player.current_city).name}** *(bisa langsung diedit ulang di \`/bangun\`)*.`,
                                `• Harga Tunai: **${formatLp(bp.buyPrice)}**\n• Estimasi PBB: **${formatLp(pbb)}/bulan**`
                            ],
                            confirmLabel: `Ya, Beli (${formatLp(bp.buyPrice)})`,
                            confirmStyle: ButtonStyle.Success,
                            arg: presetId,
                            now
                        }),
                        attachments: []
                    });
                }

                const tier = getLandTier(session.buySelection || 'mini_3x3');
                const price = calculateLandPurchasePrice(tier.id, targetCity.id);
                return await interaction.update({
                    ...confirmView({
                        mod: 'property',
                        confirmAction: 'buy_land_confirm',
                        cancelAction: 'tab_buy_land',
                        ownerId,
                        title: `🌱 Beli ${tier.name} di ${targetCity.name}`,
                        description: [
                            `Kamu akan membeli sertifikat hak milik **${tier.name}** di **${targetCity.emoji} ${targetCity.name}**.`,
                            `• Harga: **${formatLp(price)}**\n• Zoning Kota: *${getCityZoning(targetCity.id).zoningLabel}*`
                        ],
                        confirmLabel: `Beli Kavling (${formatLp(price)})`,
                        confirmStyle: ButtonStyle.Success,
                        arg: `${tier.id}:${targetCity.id}`,
                        now
                    }),
                    attachments: []
                });
            },

            async buy_land_confirm(interaction, parsed) {
                const now = Date.now();
                const ownerId = interaction.user.id;
                const session = getPropSession(ownerId);
                const [tierId, cityId] = String(parsed.arg || 'mini_3x3:kota_sentral').split(':');
                const res = await withTransaction(conn => buyLand(conn, ownerId, { cityId, landTierId: tierId }, now));
                if (res.ok) {
                    session.selectedLandId = res.landId;
                    session.tab = 'home';
                }
                const state = await fetchPropertyState(ownerId, now);
                const banner = res.ok
                    ? { type: 'success', text: `🎉 Selamat! Kamu resmi memiliki **${res.tier.name}** di **${res.city.name}**! Buka \`/bangun\` untuk mulai mendesain.` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async rent_prompt(interaction, parsed) {
                const now = Date.now();
                const tierId = parsed.arg || getPropSession(interaction.user.id).npcTierId || 'kos';
                const targetTier = getPropertyTier(tierId);
                const state = await fetchPropertyState(interaction.user.id, now);
                const prorata = calculateProratedUpgradeRent(state.status.row, targetTier, now);
                const prorataText = prorata.unusedCredit > 0
                    ? `\n• Potongan Prorata Sisa Sewa Lama: **-${formatLp(prorata.unusedCredit)}**`
                    : '';

                return await interaction.update({
                    ...confirmView({
                        mod: 'property',
                        confirmAction: 'rent_confirm',
                        cancelAction: 'tab_npc',
                        ownerId: interaction.user.id,
                        title: `🔑 Konfirmasi Sewa ${targetTier.emoji} ${targetTier.name}`,
                        description: [
                            `Menyewa di **${getCity(state.player.current_city).name}**:`,
                            `• Sewa Dasar: **${formatLp(targetTier.rentPerWeek)} / minggu**${prorataText}\n• Total Dibayar Sekarang: **${formatLp(prorata.netPayable)}**`,
                            `• Fasilitas: ${formatFacilitiesLine(targetTier.facilities)}`
                        ],
                        confirmLabel: `Sewa (${formatLp(prorata.netPayable)})`,
                        confirmStyle: ButtonStyle.Primary,
                        arg: targetTier.id,
                        now
                    }),
                    attachments: []
                });
            },

            async rent_confirm(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const tierId = parsed.arg || 'kos';
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await rentProperty(conn, synced.player, tierId, now);
                });
                const session = getPropSession(userId);
                if (!res.error) session.tab = 'home';

                const state = await fetchPropertyState(userId, now);
                let banner = null;
                if (res.error === 'ALREADY_OWNED_EQUAL_OR_HIGHER') {
                    banner = { type: 'warning', text: 'Kamu sudah memiliki properti pribadi di kota ini.' };
                } else if (res.error === 'CANNOT_DOWNGRADE_ACTIVE_RENT') {
                    banner = { type: 'warning', text: 'Gunakan tombol **Berhenti Sewa (Moveout)** sebelum turun ke tier lebih kecil.' };
                } else if (res.error === 'INSUFFICIENT_FUNDS') {
                    banner = { type: 'danger', text: `Saldo kurang! Butuh **${formatLp(res.cost)}**, saldo totalmu **${formatLp(res.totalBalance)}**.` };
                } else {
                    banner = { type: 'success', text: `🔑 Berhasil menyewa **${res.targetTier.emoji} ${res.targetTier.name}** seharga **${formatLp(res.cost)}**!` };
                }
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async buy_confirm(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const tierId = parsed.arg || 'rumah';
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await buyProperty(conn, synced.player, tierId, now);
                });
                const session = getPropSession(userId);
                if (res.ok) {
                    session.selectedLandId = res.landId;
                    session.tab = 'home';
                }
                const state = await fetchPropertyState(userId, now);
                const banner = res.ok
                    ? { type: 'success', text: `🎉 Selamat! **${res.targetTier.emoji} ${res.targetTier.name}** siap huni kini menjadi milikmu!` }
                    : { type: 'danger', text: res.message || `Saldo kurang (Butuh **${formatLp(res.cost || 0)}**).` };
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async moveout_prompt(interaction) {
                const now = Date.now();
                const state = await fetchPropertyState(interaction.user.id, now);
                const cur = state.status.effectiveTier;
                return await interaction.update({
                    ...confirmView({
                        mod: 'property',
                        confirmAction: 'moveout_confirm',
                        cancelAction: 'home',
                        ownerId: interaction.user.id,
                        title: `📦 Berhenti Sewa ${state.status.customName || cur.name}`,
                        description: [
                            `Apakah kamu yakin ingin mengakhiri kontrak sewa **${state.status.customName}** di kota ini?`,
                            '• Barang di penyimpanan lama tidak hilang permanen, tetapi terkunci hingga kamu menyewa atau punya properti lagi.'
                        ],
                        confirmLabel: 'Ya, Berhenti Sewa',
                        confirmStyle: ButtonStyle.Danger,
                        now
                    }),
                    attachments: []
                });
            },

            async moveout_confirm(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;
                const res = await withTransaction(async (conn) => {
                    await syncPlayerVitals(conn, userId, now, true);
                    return await moveOutProperty(conn, userId, now);
                });
                getPropSession(userId).tab = 'home';
                const state = await fetchPropertyState(userId, now);
                const banner = res.error
                    ? { type: 'warning', text: 'Tidak ada kontrak sewa aktif di kota ini.' }
                    : { type: 'info', text: `📦 Berhasil mengakhiri sewa **${res.prevTier.emoji} ${res.prevTier.name}**.` };
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async ws_craft_modal(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                const rec = getWorkshopRecipe(session.wsRecipeId) || WORKSHOP_RECIPES[0];
                const it = getItem(rec.outputItemId);
                const modal = numberModal('property', 'ws_craft_submit', interaction.user.id, {
                    title: `Olah ${it?.name || rec.outputItemId}`.slice(0, 45),
                    label: 'Jumlah batch yang diproses (1 - 20)',
                    placeholder: '1 - 20',
                    defaultValue: '1',
                    maxLength: 3
                }, now);
                return await interaction.showModal(modal);
            },

            async ws_collect(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await collectWorkshopQueues(conn, userId, synced.player.max_slots, now);
                });
                const state = await fetchPropertyState(userId, now);
                let banner;
                if (!res.ok) {
                    banner = { type: 'warning', text: res.error };
                } else {
                    const summary = res.collected.map(a => `${a.qty}× ${getItem(a.itemId)?.name || a.itemId}`).join(', ');
                    banner = { type: 'success', text: `📦 Mengambil hasil workshop: **${summary}**!` };
                }
                const out = await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
                schedulePropertyAutoUpdate(userId, interaction, state);
                return out;
            },

            async biz_collect(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;
                const session = getPropSession(userId);
                const res = await withTransaction(conn => collectBusinessRevenue(conn, userId, session.selectedLandId, now));
                const state = await fetchPropertyState(userId, now);
                const banner = res.ok
                    ? { type: 'success', text: `💰 Berhasil mencairkan hasil usaha **+${formatLp(res.claimed)}** ke Tunai!` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async market_sell_modal(interaction) {
                const now = Date.now();
                const state = await fetchPropertyState(interaction.user.id, now);
                const sl = state.selectedLand;
                if (!sl) return;
                const njop = Math.max(1000000, Math.round(Number(state.selectedLandStats?.totalAppraisalValue || 0)));
                const modal = numberModal('property', 'market_sell_submit', interaction.user.id, {
                    title: `Jual ${sl.custom_name}`.slice(0, 45),
                    label: `Harga Jual (NJOP: ${formatLp(njop)})`,
                    placeholder: `${Math.floor(njop * 0.7)} - ${Math.ceil(njop * 2.5)}`,
                    defaultValue: String(njop),
                    maxLength: 14
                }, now);
                return await interaction.showModal(modal);
            },

            async market_buy_prompt(interaction) {
                const now = Date.now();
                const state = await fetchPropertyState(interaction.user.id, now);
                const session = getPropSession(interaction.user.id);
                const listing = state.marketListings.find(l => Number(l.id) === Number(session.selectedListingId));
                if (!listing) return;
                return await interaction.update({
                    ...confirmView({
                        mod: 'property',
                        confirmAction: 'market_buy_confirm',
                        cancelAction: 'tab_market',
                        ownerId: interaction.user.id,
                        title: `🏡 Beli Properti P2P #${listing.id}`,
                        description: [
                            `Membeli **${listing.custom_name}** (\`${listing.width}×${listing.height}\`) di **${getCity(listing.city_id).name}** dari **${listing.seller_name}**:`,
                            `• Harga Jual: **${formatLp(listing.asking_price)}**\n• NJOP Properti: **${formatLp(listing.appraisal_value)}**`
                        ],
                        confirmLabel: `Beli Sekarang (${formatLp(listing.asking_price)})`,
                        confirmStyle: ButtonStyle.Success,
                        arg: String(listing.id),
                        now
                    }),
                    attachments: []
                });
            },

            async market_buy_confirm(interaction, parsed) {
                const now = Date.now();
                const listingId = Number(parsed.arg || getPropSession(interaction.user.id).selectedListingId);
                const res = await withTransaction(conn => buyMarketListing(conn, interaction.user.id, listingId, now));
                const session = getPropSession(interaction.user.id);
                if (res.ok) {
                    session.selectedLandId = res.landId;
                    session.tab = 'home';
                }
                const state = await fetchPropertyState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🎉 Transaksi akta jual-beli berhasil seharga **${formatLp(res.price)}** (BPHTB 5% disetor ke kas negara)!` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async market_cancel(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                const res = await withTransaction(conn => cancelMarketListing(conn, interaction.user.id, session.selectedListingId));
                const state = await fetchPropertyState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'info', text: '❌ Listing jual properti berhasil dibatalkan.' }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async p2p_rent_prompt(interaction) {
                const now = Date.now();
                const state = await fetchPropertyState(interaction.user.id, now);
                const session = getPropSession(interaction.user.id);
                const room = state.vacantRooms.find(r => `${r.land_id}:${r.zone_group_id}` === session.selectedRentKey);
                if (!room) return;
                const price = 120000 + Number(room.cell_count || 1) * 40000;
                return await interaction.update({
                    ...confirmView({
                        mod: 'property',
                        confirmAction: 'p2p_rent_confirm',
                        cancelAction: 'tab_market',
                        ownerId: interaction.user.id,
                        title: `🔑 Sewa Kos P2P: ${room.zone_name || 'Kamar Kos'}`,
                        description: [
                            `Menyewa kamar di **${room.custom_name}** (${getCity(room.city_id).name}) milik **${room.owner_name}**:`,
                            `• Sewa Mingguan: **${formatLp(price)} / minggu** *(Pembayaran autodebit mingguan, pemilik menerima 95%)*`
                        ],
                        confirmLabel: `Sewa (${formatLp(price)})`,
                        confirmStyle: ButtonStyle.Primary,
                        arg: `${room.land_id}|${room.zone_group_id}|${price}`,
                        now
                    }),
                    attachments: []
                });
            },

            async p2p_rent_confirm(interaction, parsed) {
                const now = Date.now();
                const [landIdStr, zoneGroupId, priceStr] = String(parsed.arg || '').split('|');
                const res = await withTransaction(conn =>
                    rentP2PRoomOrProperty(conn, interaction.user.id, {
                        landId: Number(landIdStr),
                        zoneGroupId,
                        weeklyRent: Number(priceStr)
                    }, now)
                );
                if (res.ok) getPropSession(interaction.user.id).tab = 'home';
                const state = await fetchPropertyState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🔑 Berhasil menyewa Kamar Kos P2P seharga **${formatLp(res.rentCost)}/minggu**!` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            }
        },

        selects: {
            async pick_land(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.selectedLandId = Number(interaction.values[0]);
                const state = await fetchPropertyState(interaction.user.id, now);
                return await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
            },

            async gallery_pick(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.galleryLandId = Number(interaction.values[0]);
                const state = await fetchPropertyState(interaction.user.id, now);
                return await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
            },

            async buy_city(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.buyCityId = interaction.values[0];
                const state = await fetchPropertyState(interaction.user.id, now);
                return await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
            },

            async buy_tier(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.buySelection = interaction.values[0];
                const state = await fetchPropertyState(interaction.user.id, now);
                return await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
            },

            async pick_npc(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.npcTierId = interaction.values[0] || 'kos';
                const state = await fetchPropertyState(interaction.user.id, now);
                return await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
            },

            async ws_recipe(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.wsRecipeId = interaction.values[0];
                const state = await fetchPropertyState(interaction.user.id, now);
                const out = await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
                schedulePropertyAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async stock_item_select(interaction) {
                const now = Date.now();
                const itemId = interaction.values[0];
                const session = getPropSession(interaction.user.id);
                session.pendingStockItemId = itemId;
                const state = await fetchPropertyState(interaction.user.id, now);
                const avail = state.bagRows.filter(r => r.item_id === itemId).reduce((s, r) => s + Number(r.quantity), 0);
                const it = getItem(itemId);
                const modal = numberModal('property', 'stock_item_submit', interaction.user.id, {
                    title: `Setor ${it?.name || itemId}`.slice(0, 45),
                    label: `Jumlah disetor ke Etalase (Di Tas: ${avail})`,
                    placeholder: `1 - ${avail}`,
                    defaultValue: String(Math.min(avail, 5)),
                    maxLength: 6
                }, now);
                return await interaction.showModal(modal);
            },

            async market_pick(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.selectedListingId = Number(interaction.values[0]);
                const state = await fetchPropertyState(interaction.user.id, now);
                return await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
            },

            async p2p_rent_pick(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                session.selectedRentKey = interaction.values[0];
                const state = await fetchPropertyState(interaction.user.id, now);
                return await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
            },

            // Backward compatibility alias jika ada pesan lama
            async pick(interaction) {
                const now = Date.now();
                const val = interaction.values[0] || 'kos';
                const session = getPropSession(interaction.user.id);
                session.npcTierId = val;
                session.tab = 'npc';
                const state = await fetchPropertyState(interaction.user.id, now);
                return await interaction.update({ ...(await buildPropertyPanel({ state, now })), attachments: [] });
            }
        },

        modals: {
            async ws_craft_submit(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                const parsed = parseModalNumber(interaction, { min: 1, max: 20 });
                if (!parsed.ok) {
                    const st = await fetchPropertyState(interaction.user.id, now);
                    return await respondOrUpdate(interaction, {
                        ...(await buildPropertyPanel({ state: st, banner: { type: 'warning', text: parsed.error }, now })),
                        attachments: []
                    });
                }

                const preState = await fetchPropertyState(interaction.user.id, now);
                const rec = getWorkshopRecipe(session.wsRecipeId) || WORKSHOP_RECIPES[0];
                const hasPrivateStation = Boolean(
                    preState.selectedLand &&
                    preState.selectedLandCells.some(c => rec.stationModuleIds.includes(c.module_id))
                );

                const res = await withTransaction(conn =>
                    startWorkshopCraft(conn, interaction.user.id, {
                        landId: hasPrivateStation ? preState.selectedLand.id : null,
                        cityId: preState.player.current_city || 'kota_sentral',
                        recipeId: rec.id,
                        batches: parsed.value
                    }, now)
                );

                const state = await fetchPropertyState(interaction.user.id, now);
                const outIt = getItem(rec.outputItemId);
                const banner = res.ok
                    ? { type: 'success', text: `⚒️ Mulai memproses **${res.outputTotal}× ${outIt?.name || rec.outputItemId}** (${res.stationLabel}, Biaya **${formatLp(res.feePaid)}**) — selesai <t:${Math.floor(res.finishesAt / 1000)}:R>!` }
                    : { type: 'warning', text: res.error };

                const payload = await buildPropertyPanel({ state, banner, now });
                const out = await respondOrUpdate(interaction, { ...payload, attachments: [] });
                schedulePropertyAutoUpdate(interaction.user.id, interaction, state);
                return out;
            },

            async stock_item_submit(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                const itemId = session.pendingStockItemId;
                const preState = await fetchPropertyState(interaction.user.id, now);
                const avail = preState.bagRows.filter(r => r.item_id === itemId).reduce((s, r) => s + Number(r.quantity), 0);
                const parsed = parseModalNumber(interaction, { min: 1, max: Math.max(1, avail) });
                if (!parsed.ok) {
                    return await respondOrUpdate(interaction, {
                        ...(await buildPropertyPanel({ state: preState, banner: { type: 'warning', text: parsed.error }, now })),
                        attachments: []
                    });
                }

                const retailZones = (preState.selectedLandStats?.businessZones || []).filter(z => ['shop', 'cafe'].includes(z.module.stats?.businessType));
                if (retailZones.length === 0) {
                    return await respondOrUpdate(interaction, {
                        ...(await buildPropertyPanel({ state: preState, banner: { type: 'warning', text: 'Kavling terpilih tidak punya Warung/Kafe aktif.' }, now })),
                        attachments: []
                    });
                }

                // Pilih zona yang cocok (kafe untuk food/dish/drink, warung untuk umum)
                const item = getItem(itemId);
                const isFoodDrink = Boolean(item?.tags?.some(t => ['dish', 'food', 'drink', 'perfect_dish'].includes(t)));
                const targetZone = retailZones.find(z => isFoodDrink ? z.module.stats.businessType === 'cafe' : z.module.stats.businessType === 'shop')
                    || retailZones[0];

                const res = await withTransaction(conn =>
                    stockBusinessItem(conn, interaction.user.id, preState.selectedLand.id, targetZone.zoneGroupId, itemId, parsed.value, now)
                );
                const state = await fetchPropertyState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🛒 Menyetor **${res.qtyAdded}× ${res.item.name}** ke etalase **${targetZone.zoneName}** (Harga **${formatLp(res.unitPrice)}/unit**, Total Stok **${res.totalStock}**)!` }
                    : { type: 'warning', text: res.error };
                return await respondOrUpdate(interaction, { ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            },

            async market_sell_submit(interaction) {
                const now = Date.now();
                const session = getPropSession(interaction.user.id);
                const parsed = parseModalNumber(interaction, { min: 100000 });
                if (!parsed.ok) {
                    const pre = await fetchPropertyState(interaction.user.id, now);
                    return await respondOrUpdate(interaction, {
                        ...(await buildPropertyPanel({ state: pre, banner: { type: 'warning', text: parsed.error }, now })),
                        attachments: []
                    });
                }
                const res = await withTransaction(conn =>
                    createMarketListing(conn, interaction.user.id, session.selectedLandId, parsed.value, now)
                );
                if (res.ok) session.selectedListingId = res.listingId;
                const state = await fetchPropertyState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🏷️ Properti resmi dipasarkan (#${res.listingId}) seharga **${formatLp(res.askingPrice)}** *(NJOP ${formatLp(res.appraisalValue)})*!` }
                    : { type: 'warning', text: res.error };
                return await respondOrUpdate(interaction, { ...(await buildPropertyPanel({ state, banner, now })), attachments: [] });
            }
        }
    },

    fetchPropertyState,
    buildPropertyPanel,
    buildHomeTabPanel,
    buildBuyLandTabPanel,
    buildNpcTabPanel,
    buildBizWorkshopTabPanel,
    buildMarketTabPanel,
    buildGalleryTabPanel
};
