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
const {
    P2P_PROPERTY_RULES,
    getPlayerLands,
    getLandById,
    getLandCells,
    computeLandStats,
    listCityParcels,
    buyLand,
    setPrimaryLand,
    createDirectLandOffer,
    acceptDirectLandOffer,
    cancelOrDeclineLandOffer,
    getDirectLandOffers,
    payLandPbb,
    togglePropertyLike,
    getTotalSkillLevelFromPlayerRow
} = require('../../services/landService');
const {
    createMarketListing,
    buyMarketListing,
    cancelMarketListing
} = require('../../services/propertyBusinessService');
const { buildPropertyCanvasAttachment } = require('../../services/propertyCanvasService');
const { getMaxLandLimit, getProgressivePbbMultiplier } = require('../../data/buildingModules');
const { getParcelSizeTier, AUTO_EXPAND_OCCUPANCY_RATIO } = require('../../data/landParcels');
const { CITIES, getCity, getCityZoning } = require('../../data/cities');
const { COLORS, formatLp, formatVitalsCompact } = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select,
    userSelect,
    confirmView,
    numberModal,
    parseModalNumber,
    respondOrUpdate
} = require('../../utils/panelBuilder');
const { isPropertyUnderDevelopment, buildPropertyUnderDevPanel } = require('../../utils/featureFlags');

const tanahSessions = new Map();

function getTanahSession(userId) {
    let s = tanahSessions.get(userId);
    if (!s) {
        s = {
            tab: 'map',
            cityId: null,
            statusFilter: 'all',
            parcelCode: null,
            inspectMode: false,
            inspectCam: 0,
            selectedListingId: null,
            offerLandId: null,
            offerTargetId: null,
            selectedOfferKey: null,
            pbbLandId: null
        };
        tanahSessions.set(userId, s);
    }
    return s;
}

async function fetchTanahState(discordId, now = Date.now()) {
    const session = getTanahSession(discordId);
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const player = synced.player;
        const targetCity = getCity(session.cityId || player.current_city || 'kota_sentral').id;
        session.cityId = targetCity;

        const parcels = await listCityParcels(conn, targetCity, null, now);
        const lands = await getPlayerLands(conn, discordId, null, false);
        const totalSkillLv = getTotalSkillLevelFromPlayerRow(player);
        const maxLands = getMaxLandLimit(totalSkillLv);

        const filteredParcels = session.statusFilter === 'all'
            ? parcels
            : parcels.filter(p => p.status === session.statusFilter);

        let selectedParcel = filteredParcels.find(p => p.parcel_code === session.parcelCode)
            || filteredParcels[0]
            || parcels[0]
            || null;
        session.parcelCode = selectedParcel ? selectedParcel.parcel_code : null;

        let inspectedLand = null;
        let inspectedCells = [];
        let inspectedStats = null;
        let viewerLiked = false;

        if (session.inspectMode && selectedParcel?.land_id) {
            inspectedLand = await getLandById(conn, selectedParcel.land_id, false);
            if (inspectedLand) {
                inspectedCells = await getLandCells(conn, inspectedLand.id, 'active');
                inspectedStats = computeLandStats(inspectedCells, inspectedLand, getCityZoning(inspectedLand.city_id));
                const [lRows] = await conn.execute(
                    `SELECT 1 FROM property_likes WHERE land_id = ? AND liker_id = ? LIMIT 1`,
                    [inspectedLand.id, discordId]
                );
                viewerLiked = lRows.length > 0;
            } else {
                session.inspectMode = false;
            }
        } else {
            session.inspectMode = false;
        }

        const [marketListings] = await conn.execute(
            `SELECT l.*, pl.custom_name, pl.width, pl.height, pl.land_tier, pl.city_id, pl.parcel_code, pl.condition_pct, pl.building_state, pr.username AS seller_name
             FROM property_market_listings l
             JOIN player_lands pl ON pl.id = l.land_id
             JOIN players pr ON pr.discord_id = l.seller_id
             WHERE l.status = 'active'
             ORDER BY l.created_at DESC
             LIMIT 25`
        );

        const offers = await getDirectLandOffers(conn, discordId, now);

        const landPbbList = [];
        for (let i = 0; i < lands.length; i++) {
            const l = lands[i];
            const cells = await getLandCells(conn, l.id, 'active');
            const stats = computeLandStats(cells, l, getCityZoning(l.city_id));
            const mult = getProgressivePbbMultiplier(i);
            const pbbFee = Math.max(10000, Math.round(stats.monthlyPbbBase * mult));
            landPbbList.push({ land: l, stats, mult, pbbFee, cellCount: cells.length });
        }

        if (!session.offerLandId && lands.length > 0) {
            session.offerLandId = Number(lands[0].id);
        } else if (session.offerLandId && !lands.some(l => Number(l.id) === Number(session.offerLandId))) {
            session.offerLandId = lands[0] ? Number(lands[0].id) : null;
        }

        if (!session.pbbLandId && lands.length > 0) {
            session.pbbLandId = Number(lands[0].id);
        } else if (session.pbbLandId && !lands.some(l => Number(l.id) === Number(session.pbbLandId))) {
            session.pbbLandId = lands[0] ? Number(lands[0].id) : null;
        }

        return {
            player,
            lands,
            landPbbList,
            maxLands,
            totalSkillLv,
            targetCity,
            parcels,
            filteredParcels,
            selectedParcel,
            inspectedLand,
            inspectedCells,
            inspectedStats,
            viewerLiked,
            marketListings,
            offers
        };
    });
}

function buildNavRow(ownerId, activeTab, pendingIncomingCount = 0, now = Date.now()) {
    return new ActionRowBuilder().addComponents(
        btn('tanah', 'map_tab', ownerId, {
            label: 'Peta Kota',
            emoji: '🗺️',
            style: activeTab === 'map' ? ButtonStyle.Primary : ButtonStyle.Secondary
        }, now),
        btn('tanah', 'p2p_tab', ownerId, {
            label: 'Pasar P2P',
            emoji: '⚖️',
            style: activeTab === 'p2p' ? ButtonStyle.Primary : ButtonStyle.Secondary
        }, now),
        btn('tanah', 'offers_tab', ownerId, {
            label: pendingIncomingCount > 0 ? `Tawaran (${pendingIncomingCount})` : 'Tawaran Langsung',
            emoji: '🤝',
            style: activeTab === 'offers' ? ButtonStyle.Primary : ButtonStyle.Secondary
        }, now),
        btn('tanah', 'pbb_tab', ownerId, {
            label: 'PBB & Aset',
            emoji: '🧾',
            style: activeTab === 'pbb' ? ButtonStyle.Primary : ButtonStyle.Secondary
        }, now),
        btn('property', 'home', ownerId, {
            label: 'Portal /property',
            emoji: '🏘️',
            style: ButtonStyle.Secondary
        }, now)
    );
}

async function buildMapTabPanel({ state, banner = null, now = Date.now() }) {
    const p = state.player;
    const ownerId = p.discord_id;
    const session = getTanahSession(ownerId);
    const city = getCity(state.targetCity);
    const zoning = getCityZoning(city.id);
    const incomingCnt = state.offers?.incoming?.length || 0;

    // Mode Inspect Gedung 3D saat klik kavling milik warga
    if (session.inspectMode && state.inspectedLand && state.selectedParcel) {
        const land = state.inspectedLand;
        const parcel = state.selectedParcel;
        const att = await buildPropertyCanvasAttachment({
            land,
            allCells: state.inspectedCells,
            stats: state.inspectedStats,
            viewFloor: 1,
            layoutMode: 'active',
            cameraAngle: session.inspectCam
        }, now);

        const isSelfOwner = land.discord_id === ownerId;
        const likeCount = Number(land.like_count || 0);
        const condMeta = state.inspectedStats?.conditionMeta;

        const row1 = new ActionRowBuilder().addComponents(
            btn('tanah', 'rot_cam', ownerId, {
                label: 'Putar 90°',
                emoji: '🔄',
                style: ButtonStyle.Primary
            }, now),
            btn('tanah', 'like_parcel', ownerId, {
                label: state.viewerLiked ? `Disukai (${likeCount})` : `Beri Like (${likeCount})`,
                emoji: '❤️',
                style: state.viewerLiked ? ButtonStyle.Danger : ButtonStyle.Success,
                disabled: isSelfOwner
            }, now),
            btn('tanah', 'inspect_close', ownerId, {
                label: 'Kembali ke Peta',
                emoji: '🗺️',
                style: ButtonStyle.Secondary
            }, now),
            ...(isSelfOwner ? [
                btn('bangun', 'home', ownerId, {
                    label: 'Edit di /bangun',
                    emoji: '🏗️',
                    style: ButtonStyle.Success
                }, now)
            ] : [])
        );

        return buildPanel({
            mod: 'tanah',
            ownerId,
            accentColor: COLORS.PRIMARY,
            title: `🏛️ Kunjungan 3D: ${land.custom_name} [${parcel.parcel_code}]`,
            banner,
            blocks: [
                { image: { url: att.url, description: `Tampilan 3D ${land.custom_name}` } },
                [
                    `👤 **Pemilik:** <@${land.discord_id}> · 📍 **Lokasi:** ${city.emoji} ${city.name} (Distrik ${parcel.district_no})`,
                    `🏆 **Skor Arsitektur:** **${state.inspectedStats.architectureScore}/100 (${state.inspectedStats.architectureGrade})** · ❤️ **${likeCount} Likes**`,
                    `${condMeta?.badge || '✅'} **Status:** ${condMeta?.label || 'Aktif'} (**${Math.round(Number(land.condition_pct ?? 100))}%**) · 💰 **NJOP:** ${formatLp(state.inspectedStats.totalAppraisalValue)}`
                ].join('\n')
            ],
            rows: [row1, buildNavRow(ownerId, 'map', incomingCnt, now)],
            files: [att.attachment],
            footer: 'Klik Putar 90° untuk melihat sisi lain bangunan 3D isometrik.',
            now
        });
    }

    const ownedCount = state.parcels.filter(pc => pc.status === 'owned').length;
    const totalCount = Math.max(1, state.parcels.length);
    const occPct = Math.round((ownedCount / totalCount) * 100);
    const maxDist = state.parcels.reduce((m, pc) => Math.max(m, Number(pc.district_no || 1)), 1);

    const sel = state.selectedParcel;
    const listPreview = state.filteredParcels.slice(0, 8).map(pc => {
        const icon = pc.status === 'available' ? '🟢' : pc.status === 'foreclosed' ? '⚡' : '🏠';
        const tierSpec = getParcelSizeTier(pc.size_tier);
        if (pc.status === 'owned') {
            const extra = pc.custom_name ? ` — **${pc.custom_name}**` : '';
            const ownerTag = pc.owner_id === ownerId ? '*(Milikmu)*' : `(${pc.owner_username || 'Warga'})`;
            return `${icon} \`${pc.parcel_code}\` **${tierSpec.code} ${pc.width}×${pc.height}**${extra} · ${ownerTag} · ❤️ ${Number(pc.like_count || 0)}`;
        }
        const pr = pc.status === 'foreclosed' && pc.foreclosed_price ? pc.foreclosed_price : pc.base_price;
        const tag = pc.status === 'foreclosed' ? ' *(Sitaan Lelang -35%)*' : '';
        return `${icon} \`${pc.parcel_code}\` **${tierSpec.code} ${pc.width}×${pc.height}** — **${formatLp(pr)}**${tag}`;
    }).join('\n') || '*Tidak ada kavling dengan filter ini di kota tersebut.*';

    let detailLine = '*Pilih kode kavling dari dropdown untuk melihat detail atau membelinya.*';
    if (sel) {
        const tierSpec = getParcelSizeTier(sel.size_tier);
        if (sel.status === 'owned') {
            detailLine = [
                `📍 **Kavling Terpilih: \`${sel.parcel_code}\`** (${tierSpec.label}, Distrik ${sel.district_no})`,
                `• 🏠 **Bangunan:** ${sel.custom_name || 'Tanah Kosong'} · **Pemilik:** <@${sel.owner_id}>`,
                `• 📊 **Kondisi:** ${Math.round(Number(sel.condition_pct ?? 100))}% · **Status:** ${sel.building_state || 'active'} · ❤️ ${Number(sel.like_count || 0)} Likes`
            ].join('\n');
        } else {
            const effPrice = sel.status === 'foreclosed' && sel.foreclosed_price ? Number(sel.foreclosed_price) : Number(sel.base_price);
            detailLine = [
                `🌱 **Kavling Terpilih: \`${sel.parcel_code}\`** (${tierSpec.label}, Distrik ${sel.district_no})`,
                `• 💵 **Harga Beli:** **${formatLp(effPrice)}**${sel.status === 'foreclosed' ? ' *(Diskon Sitaan Lelang)*' : ''}`,
                `• 📦 **Luas Footprint:** ${sel.width}×${sel.height} (${sel.width * sel.height} sel/lantai · Tinggi Bebas Tanpa Batas)`
            ].join('\n');
        }
    }

    const canBuySel = Boolean(sel && ['available', 'foreclosed'].includes(sel.status) && state.lands.length < state.maxLands);
    const canInspectSel = Boolean(sel && sel.status === 'owned' && sel.land_id);
    const selPrice = sel
        ? (sel.status === 'foreclosed' && sel.foreclosed_price ? Number(sel.foreclosed_price) : Number(sel.base_price))
        : 0;

    const rows = [
        select('tanah', 'buy_city', ownerId, {
            placeholder: 'Pilih kota peta kavling...',
            options: Object.values(CITIES).map(c => ({
                label: c.name,
                value: c.id,
                emoji: c.emoji,
                description: getCityZoning(c.id).zoningLabel,
                default: c.id === city.id
            }))
        }, now),
        select('tanah', 'filter_dist', ownerId, {
            placeholder: 'Filter status kavling...',
            options: [
                { label: `Semua Kavling (${state.parcels.length})`, value: 'all', emoji: '🗺️', default: session.statusFilter === 'all' },
                { label: `Tersedia Dibeli (${state.parcels.filter(x => x.status === 'available').length})`, value: 'available', emoji: '🟢', default: session.statusFilter === 'available' },
                { label: `Lelang Sitaan (${state.parcels.filter(x => x.status === 'foreclosed').length})`, value: 'foreclosed', emoji: '⚡', default: session.statusFilter === 'foreclosed' },
                { label: `Sudah Dimiliki (${ownedCount})`, value: 'owned', emoji: '🏠', default: session.statusFilter === 'owned' }
            ]
        }, now),
        select('tanah', 'inspect_parcel', ownerId, {
            placeholder: state.filteredParcels.length > 0 ? 'Pilih kode kavling di peta kota...' : 'Tidak ada kavling cocok',
            disabled: state.filteredParcels.length === 0,
            options: state.filteredParcels.slice(0, 25).map(pc => {
                const icon = pc.status === 'available' ? '🟢' : pc.status === 'foreclosed' ? '⚡' : '🏠';
                const pr = pc.status === 'foreclosed' && pc.foreclosed_price ? pc.foreclosed_price : pc.base_price;
                return {
                    label: `${pc.parcel_code} (${pc.width}×${pc.height})`,
                    value: pc.parcel_code,
                    emoji: icon,
                    description: pc.status === 'owned'
                        ? `Milik ${pc.owner_username || 'Warga'} · ${pc.custom_name || 'Kavling'}`
                        : `${formatLp(pr)}${pc.status === 'foreclosed' ? ' · Lelang' : ' · Siap Beli'}`,
                    default: sel && sel.parcel_code === pc.parcel_code
                };
            })
        }, now),
        new ActionRowBuilder().addComponents(
            btn('tanah', 'buy_parcel_prompt', ownerId, {
                label: sel && sel.status !== 'owned' ? `Beli ${sel.parcel_code} (${formatLp(selPrice)})` : 'Kavling Terisi',
                emoji: sel?.status === 'foreclosed' ? '⚡' : '🌱',
                style: ButtonStyle.Success,
                disabled: !canBuySel
            }, now),
            btn('tanah', 'inspect_open', ownerId, {
                label: 'Kunjungi 3D',
                emoji: '🏛️',
                style: ButtonStyle.Primary,
                disabled: !canInspectSel
            }, now),
            btn('credit', 'home', ownerId, {
                label: 'KPR (/credit)',
                emoji: '💳',
                style: ButtonStyle.Secondary
            }, now)
        ),
        buildNavRow(ownerId, 'map', incomingCnt, now)
    ];

    return buildPanel({
        mod: 'tanah',
        ownerId,
        accentColor: COLORS.LIFE,
        title: `🗺️ Bursa Tanah Terbatas — ${city.emoji} ${city.name}`,
        banner,
        blocks: [
            `${formatVitalsCompact(p)} | 💰 **Tunai:** ${formatLp(p.cash)} | 🏦 **Bank:** ${formatLp(p.bank)} | 📦 **Slotmu:** \`${state.lands.length}/${state.maxLands}\``,
            `🏙️ **${zoning.zoningLabel}** · Distrik Aktif: **1–${maxDist}** · Hunian Terisi: **${ownedCount}/${totalCount} (${occPct}%)** *(Ekspansi distrik otomatis di ${Math.round(AUTO_EXPAND_OCCUPANCY_RATIO * 100)}%)*`,
            listPreview,
            detailLine
        ],
        rows,
        footer: state.lands.length >= state.maxLands
            ? `Batas kavling penuh (${state.lands.length}/${state.maxLands}). Tingkatkan total skill +25 Lv atau jual aset di Pasar P2P!`
            : 'Pilih kavling kosong atau Sitaan Lelang (-35%), atau kunjungi bangunan 3D warga untuk memberi Like.',
        now
    });
}

function buildP2PTabPanel({ state, banner = null, now = Date.now() }) {
    const p = state.player;
    const ownerId = p.discord_id;
    const session = getTanahSession(ownerId);
    const listings = state.marketListings || [];
    const incomingCnt = state.offers?.incoming?.length || 0;

    const selectedListing = listings.find(l => Number(l.id) === Number(session.selectedListingId))
        || listings[0]
        || null;
    if (selectedListing) session.selectedListingId = Number(selectedListing.id);

    const listText = listings.length > 0
        ? listings.slice(0, 8).map(l => {
            const c = getCity(l.city_id);
            const ownMark = l.seller_id === ownerId ? ' *(Milikmu)*' : '';
            const code = l.parcel_code ? `\`${l.parcel_code}\` ` : '';
            return `• **#${l.id}** ${c.emoji} ${code}**${l.custom_name}** (\`${l.width}×${l.height}\`) — **${formatLp(l.asking_price)}** *(NJOP ${formatLp(l.appraisal_value)})* · ${l.seller_name}${ownMark}`;
        }).join('\n')
        : '*Belum ada properti yang dipasarkan di Pasar Publik P2P saat ini.*';

    const canBuy = Boolean(selectedListing && selectedListing.seller_id !== ownerId && state.lands.length < state.maxLands);
    const canCancel = Boolean(selectedListing && selectedListing.seller_id === ownerId);

    const rows = [
        select('tanah', 'market_pick', ownerId, {
            placeholder: listings.length > 0 ? 'Pilih listing properti P2P...' : 'Tidak ada listing aktif',
            disabled: listings.length === 0,
            options: listings.slice(0, 25).map(l => ({
                label: `#${l.id} ${l.custom_name} (${formatLp(l.asking_price)})`,
                value: String(l.id),
                emoji: getCity(l.city_id).emoji,
                description: `${l.width}×${l.height} · Penjual: ${l.seller_name}`,
                default: selectedListing && Number(selectedListing.id) === Number(l.id)
            }))
        }, now),
        new ActionRowBuilder().addComponents(
            btn('tanah', 'market_buy_prompt', ownerId, {
                label: 'Beli dari Pasar',
                emoji: '🏡',
                style: ButtonStyle.Success,
                disabled: !canBuy
            }, now),
            btn('tanah', 'market_sell_modal', ownerId, {
                label: 'Jual Kavling Saya',
                emoji: '🏷️',
                style: ButtonStyle.Primary,
                disabled: state.lands.length === 0
            }, now),
            btn('tanah', 'market_cancel', ownerId, {
                label: 'Batalkan Listing',
                emoji: '❌',
                style: ButtonStyle.Danger,
                disabled: !canCancel
            }, now)
        ),
        buildNavRow(ownerId, 'p2p', incomingCnt, now)
    ];

    return buildPanel({
        mod: 'tanah',
        ownerId,
        accentColor: COLORS.ECONOMY,
        title: '⚖️ Pasar Publik Jual-Beli Properti P2P',
        banner,
        blocks: [
            `Syarat P2P: Akun >= 7 hari, >= ${P2P_PROPERTY_RULES.MIN_SHIFTS} shift, & Total Skill >= Lv.${P2P_PROPERTY_RULES.MIN_TOTAL_SKILL_LEVEL}. Rentang harga NJOP 0.7×–2.5× + Pajak BPHTB 5%.`,
            listText
        ],
        rows,
        footer: 'Jual aset ke pasar terbuka atau gunakan tab Tawaran Langsung untuk bernegosiasi dengan pemain tertentu.',
        now
    });
}

function buildOffersTabPanel({ state, banner = null, now = Date.now() }) {
    const p = state.player;
    const ownerId = p.discord_id;
    const session = getTanahSession(ownerId);
    const { incoming = [], outgoing = [] } = state.offers || {};

    const allOffers = [
        ...incoming.map(o => ({ key: `in:${o.id}`, kind: 'in', row: o })),
        ...outgoing.map(o => ({ key: `out:${o.id}`, kind: 'out', row: o }))
    ];

    const selectedOffer = allOffers.find(x => x.key === session.selectedOfferKey) || allOffers[0] || null;
    if (selectedOffer) session.selectedOfferKey = selectedOffer.key;

    const inLines = incoming.length > 0
        ? incoming.slice(0, 5).map(o => `• **#${o.id}** dari **${o.seller_name || 'Warga'}**: **${o.custom_name}** (\`${o.parcel_code || `${o.width}×${o.height}`}\`) seharga **${formatLp(o.offer_price)}** · Kadaluarsa <t:${Math.floor(Number(o.expires_at) / 1000)}:R>`).join('\n')
        : '*Tidak ada tawaran masuk untukmu.*';

    const outLines = outgoing.length > 0
        ? outgoing.slice(0, 5).map(o => `• **#${o.id}** ke **${o.buyer_name || 'Warga'}**: **${o.custom_name}** seharga **${formatLp(o.offer_price)}**`).join('\n')
        : '*Tidak ada tawaran keluar yang aktif.*';

    const offerTargetLine = session.offerTargetId
        ? `🎯 **Target Pembeli Terpilih:** <@${session.offerTargetId}> — Klik **Atur Harga & Kirim** di bawah!`
        : '1️⃣ Pilih kavlingmu yang ingin ditawarkan, lalu pilih warga target lewat User Select.';

    const rows = [];
    if (state.lands.length > 0) {
        rows.push(
            select('tanah', 'offer_land_pick', ownerId, {
                placeholder: 'Pilih kavling milikmu untuk ditawarkan...',
                options: state.lands.slice(0, 25).map(l => ({
                    label: `${l.custom_name} (${l.parcel_code || `${l.width}×${l.height}`})`,
                    value: String(l.id),
                    emoji: getCity(l.city_id).emoji,
                    default: Number(l.id) === Number(session.offerLandId)
                }))
            }, now)
        );
        rows.push(
            userSelect('tanah', 'offer_user_pick', ownerId, {
                placeholder: 'Pilih pemain target untuk ditawari tanah...'
            }, now)
        );
    }

    if (allOffers.length > 0) {
        rows.push(
            select('tanah', 'pick_active_offer', ownerId, {
                placeholder: 'Pilih tawaran masuk/keluar untuk ditindaklanjuti...',
                options: allOffers.slice(0, 25).map(item => ({
                    label: item.kind === 'in'
                        ? `[Masuk #${item.row.id}] ${item.row.custom_name} (${formatLp(item.row.offer_price)})`
                        : `[Keluar #${item.row.id}] ${item.row.custom_name} (${formatLp(item.row.offer_price)})`,
                    value: item.key,
                    emoji: item.kind === 'in' ? '📥' : '📤',
                    default: selectedOffer && selectedOffer.key === item.key
                }))
            }, now)
        );
    }

    const actionBtns = [];
    if (state.lands.length > 0) {
        actionBtns.push(
            btn('tanah', 'offer_send_modal', ownerId, {
                label: 'Atur Harga & Kirim',
                emoji: '📨',
                style: ButtonStyle.Primary,
                disabled: !session.offerTargetId || !session.offerLandId
            }, now)
        );
    }
    if (selectedOffer?.kind === 'in') {
        actionBtns.push(
            btn('tanah', 'offer_accept_prompt', ownerId, {
                label: `Terima #${selectedOffer.row.id} (${formatLp(selectedOffer.row.offer_price)})`,
                emoji: '✅',
                style: ButtonStyle.Success
            }, now)
        );
    }
    if (selectedOffer) {
        actionBtns.push(
            btn('tanah', 'offer_decline', ownerId, {
                label: selectedOffer.kind === 'in' ? 'Tolak' : 'Batalkan Tawaran',
                emoji: '❌',
                style: ButtonStyle.Danger
            }, now)
        );
    }
    if (actionBtns.length > 0) {
        rows.push(new ActionRowBuilder().addComponents(actionBtns.slice(0, 5)));
    }
    rows.push(buildNavRow(ownerId, 'offers', incoming.length, now));

    return buildPanel({
        mod: 'tanah',
        ownerId,
        accentColor: COLORS.CAREER,
        title: '🤝 Tawaran Jual-Beli Tanah Langsung (P2P Escrow)',
        banner,
        blocks: [
            offerTargetLine,
            `### 📥 Tawaran Masuk\n${inLines}`,
            `### 📤 Tawaran Keluar\n${outLines}`
        ],
        rows: rows.slice(0, 5),
        footer: 'Penawaran berlaku 48 jam, diaudit dalam batas NJOP (0.7×–2.5×), dan dikenakan pajak BPHTB 5%.',
        now
    });
}

function buildPbbTabPanel({ state, banner = null, now = Date.now() }) {
    const p = state.player;
    const ownerId = p.discord_id;
    const session = getTanahSession(ownerId);
    const items = state.landPbbList || [];
    const incomingCnt = state.offers?.incoming?.length || 0;

    const picked = items.find(x => Number(x.land.id) === Number(session.pbbLandId)) || items[0] || null;
    if (picked) session.pbbLandId = Number(picked.land.id);

    const listText = items.length > 0
        ? items.map((x, idx) => {
            const c = getCity(x.land.city_id);
            const pbbDue = x.land.next_pbb_at > 0 ? `<t:${Math.floor(Number(x.land.next_pbb_at) / 1000)}:R>` : 'Belum dijadwalkan';
            const graceWarn = Number(x.land.grace_until || 0) > now
                ? ` · ⚠️ **TUNGGAKAN! Sita <t:${Math.floor(Number(x.land.grace_until) / 1000)}:R>**`
                : '';
            return `${idx + 1}. ${c.emoji} **${x.land.custom_name}** \`${x.land.parcel_code || `${x.land.width}×${x.land.height}`}\`${Number(x.land.is_primary) === 1 ? ' ⭐' : ''}\n   └ PBB: **${formatLp(x.pbbFee)}/bln** *(×${x.mult})* · Tempo: ${pbbDue} · Kondisi: **${Math.round(Number(x.land.condition_pct ?? 100))}%**${graceWarn}`;
        }).join('\n')
        : '*Kamu belum memiliki kavling tanah di kota manapun.*';

    const rows = [];
    if (items.length > 0 && picked) {
        rows.push(
            select('tanah', 'pbb_land_pick', ownerId, {
                placeholder: 'Pilih kavling dari portofoliomu...',
                options: items.slice(0, 25).map(x => ({
                    label: `${x.land.custom_name} (${formatLp(x.pbbFee)}/bln)`,
                    value: String(x.land.id),
                    emoji: getCity(x.land.city_id).emoji,
                    description: `${x.land.parcel_code || `${x.land.width}×${x.land.height}`} · Kondisi ${Math.round(Number(x.land.condition_pct ?? 100))}%`,
                    default: Number(x.land.id) === Number(picked.land.id)
                }))
            }, now)
        );
        rows.push(
            new ActionRowBuilder().addComponents(
                btn('tanah', 'pay_pbb_confirm', ownerId, {
                    label: `Bayar PBB (${formatLp(picked.pbbFee)})`,
                    emoji: '🧾',
                    style: ButtonStyle.Success
                }, now),
                btn('tanah', 'set_primary', ownerId, {
                    label: 'Set Utama',
                    emoji: '⭐',
                    style: ButtonStyle.Primary,
                    disabled: Number(picked.land.is_primary) === 1
                }, now),
                btn('bangun', 'home', ownerId, {
                    label: 'Studio /bangun',
                    emoji: '🏗️',
                    style: ButtonStyle.Secondary
                }, now)
            )
        );
    }
    rows.push(buildNavRow(ownerId, 'pbb', incomingCnt, now));

    return buildPanel({
        mod: 'tanah',
        ownerId,
        accentColor: COLORS.LIFE,
        title: `🧾 Portofolio Kavling & Pajak Bumi Bangunan (${items.length}/${state.maxLands})`,
        banner,
        blocks: [
            `${formatVitalsCompact(p)} | 💰 **Tunai:** ${formatLp(p.cash)} | 🏦 **Bank:** ${formatLp(p.bank)}`,
            listText
        ],
        rows,
        footer: 'Membayar PBB tepat waktu mencegah masa tenggang 21 hari dan penyitaan kavling oleh pemerintah kota.',
        now
    });
}

async function buildTanahPanel({ state, banner = null, now = Date.now() }) {
    const session = getTanahSession(state.player.discord_id);
    if (session.tab === 'p2p') return buildP2PTabPanel({ state, banner, now });
    if (session.tab === 'offers') return buildOffersTabPanel({ state, banner, now });
    if (session.tab === 'pbb') return buildPbbTabPanel({ state, banner, now });
    return await buildMapTabPanel({ state, banner, now });
}

module.exports = {
    name: 'tanah',
    slash: true,
    lockTtl: 15,
    data: new SlashCommandBuilder()
        .setName('tanah')
        .setDescription(
            isPropertyUnderDevelopment()
                ? '[Under Development] Fitur kavling tanah & pasar P2P sementara dinonaktifkan untuk perombakan.'
                : 'Peta Kavling Kota Terbatas, Lelang Sitaan, Pasar P2P, Tawaran Langsung & PBB.'
        ),

    async executeSlash(interaction) {
        const now = Date.now();
        if (isPropertyUnderDevelopment()) {
            return await interaction.reply(
                buildPropertyUnderDevPanel({
                    mod: 'tanah',
                    ownerId: interaction.user.id,
                    ephemeral: true,
                    now
                })
            );
        }
        const session = getTanahSession(interaction.user.id);
        session.tab = 'map';
        session.inspectMode = false;
        const state = await fetchTanahState(interaction.user.id, now);
        return await interaction.reply(await buildTanahPanel({ state, now }));
    },

    panel: {
        buttons: {
            async map_tab(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.tab = 'map';
                session.inspectMode = false;
                const state = await fetchTanahState(interaction.user.id, now);
                return await interaction.update({ ...(await buildTanahPanel({ state, now })), attachments: [] });
            },
            async p2p_tab(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.tab = 'p2p';
                session.inspectMode = false;
                const state = await fetchTanahState(interaction.user.id, now);
                return await interaction.update({ ...(await buildTanahPanel({ state, now })), attachments: [] });
            },
            async offers_tab(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.tab = 'offers';
                session.inspectMode = false;
                const state = await fetchTanahState(interaction.user.id, now);
                return await interaction.update({ ...(await buildTanahPanel({ state, now })), attachments: [] });
            },
            async pbb_tab(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.tab = 'pbb';
                session.inspectMode = false;
                const state = await fetchTanahState(interaction.user.id, now);
                return await interaction.update({ ...(await buildTanahPanel({ state, now })), attachments: [] });
            },

            async inspect_open(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.tab = 'map';
                session.inspectMode = true;
                session.inspectCam = 0;
                const state = await fetchTanahState(interaction.user.id, now);
                return await interaction.update({ ...(await buildTanahPanel({ state, now })), attachments: [] });
            },
            async inspect_close(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.inspectMode = false;
                const state = await fetchTanahState(interaction.user.id, now);
                return await interaction.update({ ...(await buildTanahPanel({ state, now })), attachments: [] });
            },
            async rot_cam(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.inspectCam = (Number(session.inspectCam || 0) + 1) % 4;
                const state = await fetchTanahState(interaction.user.id, now);
                return await interaction.update({ ...(await buildTanahPanel({ state, now })), attachments: [] });
            },
            async like_parcel(interaction) {
                const now = Date.now();
                const statePre = await fetchTanahState(interaction.user.id, now);
                const landId = statePre.selectedParcel?.land_id;
                if (!landId) return;
                const res = await withTransaction(conn => togglePropertyLike(conn, interaction.user.id, landId, now));
                const state = await fetchTanahState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: res.liked ? `❤️ Kamu menyukai bangunan ini! Total Like: **${res.likeCount}**` : `💔 Like dibatalkan. Total Like: **${res.likeCount}**` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildTanahPanel({ state, banner, now })), attachments: [] });
            },

            async buy_parcel_prompt(interaction) {
                const now = Date.now();
                const state = await fetchTanahState(interaction.user.id, now);
                const sel = state.selectedParcel;
                if (!sel || sel.status === 'owned') return;
                const price = sel.status === 'foreclosed' && sel.foreclosed_price ? Number(sel.foreclosed_price) : Number(sel.base_price);
                return await interaction.update({
                    ...confirmView({
                        mod: 'tanah',
                        confirmAction: 'buy_parcel_confirm',
                        cancelAction: 'map_tab',
                        ownerId: interaction.user.id,
                        title: `Konfirmasi Pembelian Kavling ${sel.parcel_code}`,
                        description: [
                            `Kamu akan membeli kavling terbatas **${sel.parcel_code}** (${sel.width}×${sel.height}, Distrik ${sel.district_no}) di **${getCity(sel.city_id).name}**.`,
                            `Harga: **${formatLp(price)}**${sel.status === 'foreclosed' ? ' *(Harga Sitaan Lelang)*' : ''}`
                        ].join('\n'),
                        confirmLabel: `Bayar ${formatLp(price)}`,
                        accentColor: COLORS.SUCCESS,
                        now
                    }),
                    attachments: []
                });
            },
            async buy_parcel_confirm(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                const code = session.parcelCode;
                const res = await withTransaction(conn =>
                    buyLand(conn, interaction.user.id, { parcelCode: code, cityId: session.cityId }, now)
                );
                const state = await fetchTanahState(interaction.user.id, now);
                const distMsg = res.districtExpanded ? ` *(🎉 Distrik ${res.districtExpanded} baru saja dibuka di kota ini!)*` : '';
                const banner = res.ok
                    ? { type: 'success', text: `🎉 Resmi memiliki kavling **${res.parcelCode}** (${res.tier.name}) di **${res.city.name}**! Gunakan \`/bangun\` untuk mulai mendesain 3D.${distMsg}` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildTanahPanel({ state, banner, now })), attachments: [] });
            },

            async market_buy_prompt(interaction) {
                const now = Date.now();
                const state = await fetchTanahState(interaction.user.id, now);
                const session = getTanahSession(interaction.user.id);
                const listing = state.marketListings.find(l => Number(l.id) === Number(session.selectedListingId));
                if (!listing) return;
                return await interaction.update({
                    ...confirmView({
                        mod: 'tanah',
                        confirmAction: 'market_buy_confirm',
                        cancelAction: 'p2p_tab',
                        ownerId: interaction.user.id,
                        title: `Konfirmasi Beli Properti P2P #${listing.id}`,
                        description: `Beli **${listing.custom_name}** (\`${listing.width}×${listing.height}\`) di **${getCity(listing.city_id).name}** seharga **${formatLp(listing.asking_price)}** *(Termasuk pajak BPHTB 5%)*?`,
                        confirmLabel: `Bayar ${formatLp(listing.asking_price)}`,
                        accentColor: COLORS.SUCCESS,
                        now
                    }),
                    attachments: []
                });
            },
            async market_buy_confirm(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                const res = await withTransaction(conn => buyMarketListing(conn, interaction.user.id, session.selectedListingId, now));
                const state = await fetchTanahState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🎉 Berhasil membeli properti #${res.landId} seharga **${formatLp(res.price)}** (BPHTB 5%: ${formatLp(res.taxBphtb)})!` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildTanahPanel({ state, banner, now })), attachments: [] });
            },
            async market_cancel(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                const res = await withTransaction(conn => cancelMarketListing(conn, interaction.user.id, session.selectedListingId));
                const state = await fetchTanahState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'info', text: '🏷️ Listing propertimu dibatalkan dari Pasar P2P.' }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildTanahPanel({ state, banner, now })), attachments: [] });
            },
            async market_sell_modal(interaction) {
                const now = Date.now();
                const state = await fetchTanahState(interaction.user.id, now);
                const sl = state.lands.find(l => Number(l.id) === Number(getTanahSession(interaction.user.id).pbbLandId)) || state.lands[0];
                if (!sl) return;
                getTanahSession(interaction.user.id).pbbLandId = Number(sl.id);
                const modal = numberModal('tanah', 'market_sell_submit', interaction.user.id, {
                    title: `Jual ${sl.custom_name.slice(0, 22)}`,
                    label: 'Harga Jual P2P (0.7×–2.5× NJOP)',
                    placeholder: String(Math.max(1000000, Number(sl.purchase_price || 2000000)))
                }, now);
                return await interaction.showModal(modal);
            },

            async offer_send_modal(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                if (!session.offerLandId || !session.offerTargetId) return;
                const modal = numberModal('tanah', 'offer_send_submit', interaction.user.id, {
                    title: 'Kirim Penawaran Tanah Langsung',
                    label: 'Harga Penawaran (0.7×–2.5× NJOP)',
                    placeholder: 'Contoh: 15000000'
                }, now);
                return await interaction.showModal(modal);
            },
            async offer_accept_prompt(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                const key = String(session.selectedOfferKey || '');
                if (!key.startsWith('in:')) return;
                const offerId = Number(key.slice(3));
                const state = await fetchTanahState(interaction.user.id, now);
                const offer = state.offers.incoming.find(o => Number(o.id) === offerId);
                if (!offer) return;
                return await interaction.update({
                    ...confirmView({
                        mod: 'tanah',
                        confirmAction: 'offer_accept_confirm',
                        cancelAction: 'offers_tab',
                        ownerId: interaction.user.id,
                        title: `Terima Tawaran Tanah #${offer.id}`,
                        description: `Beli langsung **${offer.custom_name}** (${offer.parcel_code || `${offer.width}×${offer.height}`}) dari **${offer.seller_name || 'Warga'}** seharga **${formatLp(offer.offer_price)}**?`,
                        confirmLabel: `Bayar ${formatLp(offer.offer_price)}`,
                        accentColor: COLORS.SUCCESS,
                        now
                    }),
                    attachments: []
                });
            },
            async offer_accept_confirm(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                const key = String(session.selectedOfferKey || '');
                const offerId = key.startsWith('in:') ? Number(key.slice(3)) : 0;
                const res = await withTransaction(conn => acceptDirectLandOffer(conn, interaction.user.id, offerId, now));
                const state = await fetchTanahState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🎉 Kamu resmi membeli **${res.landName}** seharga **${formatLp(res.price)}** (BPHTB ${formatLp(res.taxBphtb)})!` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildTanahPanel({ state, banner, now })), attachments: [] });
            },
            async offer_decline(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                const key = String(session.selectedOfferKey || '');
                const [kind, idStr] = key.split(':');
                const offerId = Number(idStr || 0);
                const res = await withTransaction(conn =>
                    cancelOrDeclineLandOffer(conn, interaction.user.id, offerId, kind === 'out' ? 'cancel' : 'decline')
                );
                const state = await fetchTanahState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'info', text: kind === 'out' ? '🗑️ Penawaran keluar dibatalkan.' : '🙅 Penawaran ditolak.' }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildTanahPanel({ state, banner, now })), attachments: [] });
            },

            async pay_pbb_confirm(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                const res = await withTransaction(conn => payLandPbb(conn, interaction.user.id, session.pbbLandId, now));
                const state = await fetchTanahState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🧾 PBB **${res.landName}** (${formatLp(res.pbbFee)}) lunas! Jatuh tempo berikutnya <t:${Math.floor(res.nextPbbAt / 1000)}:R>.` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildTanahPanel({ state, banner, now })), attachments: [] });
            },
            async set_primary(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                const res = await withTransaction(conn => setPrimaryLand(conn, interaction.user.id, session.pbbLandId, now));
                const state = await fetchTanahState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `⭐ **${res.land.custom_name}** dijadikan properti utama di kota terkait.` }
                    : { type: 'warning', text: res.error };
                return await interaction.update({ ...(await buildTanahPanel({ state, banner, now })), attachments: [] });
            }
        },

        selects: {
            async buy_city(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.cityId = getCity(interaction.values[0]).id;
                session.parcelCode = null;
                session.inspectMode = false;
                const state = await fetchTanahState(interaction.user.id, now);
                return await interaction.update({ ...(await buildTanahPanel({ state, now })), attachments: [] });
            },
            async filter_dist(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.statusFilter = interaction.values[0] || 'all';
                session.parcelCode = null;
                const state = await fetchTanahState(interaction.user.id, now);
                return await interaction.update({ ...(await buildTanahPanel({ state, now })), attachments: [] });
            },
            async inspect_parcel(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.parcelCode = interaction.values[0];
                const state = await fetchTanahState(interaction.user.id, now);
                return await interaction.update({ ...(await buildTanahPanel({ state, now })), attachments: [] });
            },
            async market_pick(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.selectedListingId = Number(interaction.values[0]);
                const state = await fetchTanahState(interaction.user.id, now);
                return await interaction.update({ ...(await buildTanahPanel({ state, now })), attachments: [] });
            },
            async offer_land_pick(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.offerLandId = Number(interaction.values[0]);
                const state = await fetchTanahState(interaction.user.id, now);
                return await interaction.update({ ...(await buildTanahPanel({ state, now })), attachments: [] });
            },
            async pick_active_offer(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.selectedOfferKey = interaction.values[0];
                const state = await fetchTanahState(interaction.user.id, now);
                return await interaction.update({ ...(await buildTanahPanel({ state, now })), attachments: [] });
            },
            async pbb_land_pick(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.pbbLandId = Number(interaction.values[0]);
                const state = await fetchTanahState(interaction.user.id, now);
                return await interaction.update({ ...(await buildTanahPanel({ state, now })), attachments: [] });
            }
        },

        userSelects: {
            async offer_user_pick(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                session.offerTargetId = interaction.values[0];
                const state = await fetchTanahState(interaction.user.id, now);
                const banner = { type: 'info', text: `🎯 Target terpilih: <@${session.offerTargetId}>. Klik **Atur Harga & Kirim** untuk mengajukan tawaran.` };
                return await interaction.update({ ...(await buildTanahPanel({ state, banner, now })), attachments: [] });
            }
        },

        modals: {
            async market_sell_submit(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                const parsed = parseModalNumber(interaction, { min: 100000 });
                const pre = await fetchTanahState(interaction.user.id, now);
                if (!parsed.ok) {
                    return await respondOrUpdate(interaction, { ...(await buildTanahPanel({ state: pre, banner: { type: 'warning', text: parsed.error }, now })), attachments: [] });
                }
                const targetLandId = session.pbbLandId || pre.lands[0]?.id;
                const res = await withTransaction(conn => createMarketListing(conn, interaction.user.id, targetLandId, parsed.value, now));
                if (res.ok) session.selectedListingId = res.listingId;
                const state = await fetchTanahState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `🏷️ Properti dipasarkan (#${res.listingId}) seharga **${formatLp(res.askingPrice)}** *(NJOP ${formatLp(res.appraisalValue)})*!` }
                    : { type: 'warning', text: res.error };
                return await respondOrUpdate(interaction, { ...(await buildTanahPanel({ state, banner, now })), attachments: [] });
            },

            async offer_send_submit(interaction) {
                const now = Date.now();
                const session = getTanahSession(interaction.user.id);
                const parsed = parseModalNumber(interaction, { min: 100000 });
                const pre = await fetchTanahState(interaction.user.id, now);
                if (!parsed.ok) {
                    return await respondOrUpdate(interaction, { ...(await buildTanahPanel({ state: pre, banner: { type: 'warning', text: parsed.error }, now })), attachments: [] });
                }
                const targetUserId = session.offerTargetId;
                const res = await withTransaction(conn =>
                    createDirectLandOffer(conn, interaction.user.id, targetUserId, session.offerLandId, parsed.value, now)
                );
                if (res.ok) {
                    session.selectedOfferKey = `out:${res.offerId}`;
                    session.offerTargetId = null;
                }
                const state = await fetchTanahState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `📨 Penawaran **${res.land.custom_name}** seharga **${formatLp(res.offerPrice)}** terkirim ke <@${targetUserId}> (berlaku 48 jam)!` }
                    : { type: 'warning', text: res.error };
                return await respondOrUpdate(interaction, { ...(await buildTanahPanel({ state, banner, now })), attachments: [] });
            }
        }
    },

    fetchTanahState,
    buildTanahPanel,
    buildMapTabPanel,
    buildP2PTabPanel,
    buildOffersTabPanel,
    buildPbbTabPanel
};
