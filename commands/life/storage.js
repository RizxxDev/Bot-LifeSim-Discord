const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerPropertyStatus } = require('../../services/propertyService');
const { getEffectiveLocalProperty, getPlayerLands } = require('../../services/landService');
const { evacuateEmergencyStorage } = require('../../services/buildingConditionService');
const { getCity } = require('../../data/cities');
const {
    getPlayerInventory,
    calculateSlotsUsed,
    canFitItems,
    addItem,
    removeItem
} = require('../../services/inventoryService');
const { isItemPerishable, formatFreshnessBadge } = require('../../services/spoilageService');
const { getItem } = require('../../data/items');
const { COLORS, renderBar } = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select,
    quantityRow,
    numberModal,
    parseModalNumber,
    respondOrUpdate
} = require('../../utils/panelBuilder');
const { isPropertyUnderDevelopment } = require('../../utils/featureFlags');

const STORAGE_META = {
    kulkas: {
        id: 'kulkas',
        name: 'Kulkas Rumah',
        emoji: '❄️',
        rateText: 'Basi 3× lebih lambat (×0,33)',
        perishableOnly: true
    },
    freezer: {
        id: 'freezer',
        name: 'Freezer Rumah',
        emoji: '🧊',
        rateText: 'Beku sempurna (Tidak basi / ×0)',
        perishableOnly: true
    },
    gudang: {
        id: 'gudang',
        name: 'Gudang Rumah',
        emoji: '📦',
        rateText: 'Khusus barang tidak basi',
        perishableOnly: false
    },
    coolerbox: {
        id: 'coolerbox',
        name: 'Cooler Box Portabel',
        emoji: '🧊',
        rateText: 'Basi 2× lebih lambat (×0,5 · Portabel)',
        perishableOnly: true
    }
};

const storageLandSelection = new Map();

async function fetchStorageState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const p = synced.player;
        const currentCity = p.current_city || 'kota_sentral';
        let propStatus = await getPlayerPropertyStatus(conn, discordId, p.max_slots, now, false, currentCity);
        const prefLandId = storageLandSelection.get(discordId);
        if (prefLandId && (propStatus.cityLands || []).some(l => Number(l.id) === Number(prefLandId))) {
            const eff = await getEffectiveLocalProperty(conn, discordId, currentCity, p.max_slots, now, false, prefLandId);
            if (eff.landId && Number(eff.landId) !== Number(propStatus.landId)) {
                propStatus = {
                    ...propStatus,
                    landId: eff.landId,
                    land: eff.land,
                    stats: eff.stats,
                    customName: eff.customName,
                    effectiveTier: eff.tierObj,
                    facilitiesLocked: eff.facilitiesLocked,
                    buildingState: eff.buildingState,
                    conditionMeta: eff.conditionMeta,
                    capacities: {
                        ...propStatus.capacities,
                        kulkas: Number(eff.storageLimits?.kulkas || 0),
                        freezer: Number(eff.storageLimits?.freezer || 0),
                        gudang: Number(eff.storageLimits?.gudang || 0),
                        stove: Number(eff.storageLimits?.stove || 0)
                    }
                };
            }
        }
        const allLands = await getPlayerLands(conn, discordId, null, false);
        const allRows = await getPlayerInventory(conn, discordId, false, 'all', now);
        return { player: p, propStatus, allRows, allLands };
    });
}

function groupRowsByItem(rows = [], locKey = 'bag') {
    const map = new Map();
    for (const r of rows) {
        const qty = Number(r.quantity || 0);
        if (qty <= 0) continue;
        const it = getItem(r.item_id);
        if (!it || it.stackSize === 0) continue;

        const existing = map.get(it.id);
        const remMs = r.freshness_remaining_ms !== null && r.freshness_remaining_ms !== undefined
            ? Number(r.freshness_remaining_ms)
            : null;
        if (!existing) {
            map.set(it.id, { item: it, totalQty: qty, minFreshnessMs: remMs });
        } else {
            existing.totalQty += qty;
            if (remMs !== null) {
                existing.minFreshnessMs = existing.minFreshnessMs === null ? remMs : Math.min(existing.minFreshnessMs, remMs);
            }
        }
    }

    return Array.from(map.values()).map(e => ({
        ...e,
        freshnessBadge: e.minFreshnessMs !== null ? formatFreshnessBadge(e.minFreshnessMs, locKey) : ''
    }));
}

function buildStoragePanel({
    state,
    place = 'kulkas',
    direction = 'put', // 'put' (Tas -> Storage) | 'take' (Storage -> Tas)
    selectedItemId = null,
    banner = null,
    now = Date.now()
}) {
    const { player: p, propStatus, allRows, allLands = [] } = state;
    const ownerId = p.discord_id;
    const meta = STORAGE_META[place] || STORAGE_META.kulkas;
    const currentCity = getCity(p.current_city || 'kota_sentral');
    const activeLandId = propStatus.landId ? Number(propStatus.landId) : null;

    const bagRows = allRows.filter(r => (!r.storage_location || r.storage_location === 'bag') && Number(r.emergency_locked || 0) === 0);
    const emergencyRows = allRows.filter(r => Number(r.emergency_locked || 0) === 1);
    const emergencyTotalQty = emergencyRows.reduce((s, r) => s + Number(r.quantity || 0), 0);
    const placeRows = allRows.filter(r => {
        if (Number(r.emergency_locked || 0) === 1) return false;
        if (r.storage_location !== meta.id) return false;
        if (meta.id === 'coolerbox') return true;
        return activeLandId !== null
            ? Number(r.land_id) === activeLandId
            : (r.land_id === null || r.land_id === undefined);
    });

    const bagSlotsUsed = calculateSlotsUsed(bagRows);
    const placeSlotsUsed = calculateSlotsUsed(placeRows);
    const maxCap = propStatus.capacities[meta.id] || 0;
    const isLocked = (meta.id !== 'coolerbox' && Boolean(propStatus.facilitiesLocked)) || maxCap <= 0;

    // Row 1: Pilih Tempat Penyimpanan + Toggle Mode Simpan/Ambil
    const tabRow = new ActionRowBuilder().addComponents(
        btn('storage', 'tab', ownerId, {
            label: 'Kulkas',
            emoji: '❄️',
            style: meta.id === 'kulkas' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: `kulkas:${direction}`
        }, now),
        btn('storage', 'tab', ownerId, {
            label: 'Freezer',
            emoji: '🧊',
            style: meta.id === 'freezer' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: `freezer:${direction}`
        }, now),
        btn('storage', 'tab', ownerId, {
            label: 'Gudang',
            emoji: '📦',
            style: meta.id === 'gudang' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: `gudang:${direction}`
        }, now),
        btn('storage', 'tab', ownerId, {
            label: 'Cooler Box',
            emoji: '🧊',
            style: meta.id === 'coolerbox' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: `coolerbox:${direction}`
        }, now),
        btn('storage', 'tab', ownerId, {
            label: direction === 'put' ? 'Mode: Simpan 📥' : 'Mode: Ambil 📤',
            style: ButtonStyle.Success,
            arg: `${meta.id}:${direction === 'put' ? 'take' : 'put'}`
        }, now)
    );

    const placeGrouped = groupRowsByItem(placeRows, meta.id);
    const placeItemLines = placeGrouped.map(e => {
        const fresh = e.freshnessBadge ? ` · *(${e.freshnessBadge})*` : '';
        return `• ${e.item.emoji} **${e.item.name}** \`×${e.totalQty}\`${fresh}`;
    });

    const homeTitle = propStatus.customName || propStatus.effectiveTier.name;
    const remoteStorageRows = allRows.filter(r =>
        ['kulkas', 'freezer', 'gudang'].includes(r.storage_location) &&
        Number(r.land_id || 0) !== Number(activeLandId || 0)
    );
    let remoteHint = null;
    if (remoteStorageRows.length > 0) {
        const byLand = new Map();
        for (const r of remoteStorageRows) {
            const key = Number(r.land_id || 0);
            const cur = byLand.get(key) || 0;
            byLand.set(key, cur + Number(r.quantity || 0));
        }
        const summaries = [...byLand.entries()].slice(0, 4).map(([lid, cnt]) => {
            if (!lid) return `🏠 Properti Sewa Lain (**${cnt}** item)`;
            const landObj = allLands.find(l => Number(l.id) === lid);
            const c = landObj ? getCity(landObj.city_id) : null;
            return landObj
                ? `${c?.emoji || '🏡'} **${landObj.custom_name}** (${c?.shortName || ''}): **${cnt}** item`
                : `🏡 Kavling #${lid}: **${cnt}** item`;
        });
        remoteHint = `🌍 **Barang di Properti / Kota Lain (Gunakan \`/travel\` untuk mengakses):**\n• ${summaries.join('\n• ')}`;
    }

    const storageFurns = (propStatus.stats?.furnitureDetails || []).filter(
        d => d.spec?.category === 'kitchen_storage' && d.spec?.effects?.storageType === meta.id
    );
    const furnLine = storageFurns.length > 0
        ? `\n🛋️ **Perabot ${meta.name}:** ${storageFurns.slice(0, 3).map(d => `${d.spec.emoji} **${d.spec.name}**${d.room ? ` *(${d.room.customName})*` : ''}${d.isOutdoorPenalty ? ' *(⚠️ Terbuka -50%)*' : ''}`).join(', ')}`
        : '';

    const blocks = [
        [
            `🏠 **Properti Lokal (${currentCity.emoji} ${currentCity.shortName}):** ${propStatus.effectiveTier.emoji} **${homeTitle}** · 🎒 **Tas:** \`${bagSlotsUsed}/${Number(p.max_slots || 20)} slot\``,
            `${meta.emoji} **${meta.name}:** \`${renderBar(placeSlotsUsed, Math.max(1, maxCap), 8)}\` (**${placeSlotsUsed}/${maxCap} slot**) — *${meta.rateText}*${furnLine}`
        ].join('\n')
    ];

    if (isLocked) {
        blocks.push(
            meta.id === 'coolerbox'
                ? `🔒 **Cooler Box Belum Dimiliki:** Beli **🧊 Cooler Box Portabel** di Toko Perkakas (\`/shop\`) untuk menambah 10 slot pendingin portabel.`
                : propStatus.facilitiesLocked
                    ? (isPropertyUnderDevelopment()
                        ? `🔒 **Fasilitas Penyimpanan Terkunci (${propStatus.conditionMeta?.label || 'Terbengkalai/Roboh'}):** Kulkas/Freezer/Gudang properti belum dapat diakses sementara karena \`/property\` sedang dalam pengembangan. Gunakan **Cooler Box Portabel** (\`/shop\`)!`
                        : `🔒 **Fasilitas Penyimpanan Terkunci (${propStatus.conditionMeta?.label || 'Terbengkalai/Roboh'}):** Renovasi bangunan atau bersihkan puing lewat \`/property\` untuk membuka kembali Kulkas/Freezer/Gudang.`)
                    : (isPropertyUnderDevelopment()
                        ? `🔒 **Fasilitas Belum Terbuka:** Fitur \`/property\` & \`/bangun\` sedang dalam pengembangan. Gunakan **🧊 Cooler Box Portabel** (Toko Perkakas \`/shop\`) untuk menyimpan bahan mudah basi!`
                        : `🔒 **Fasilitas Belum Terbuka / Terkunci:** Bangun modul Kulkas/Freezer/Gudang lewat \`/bangun\` atau sewa hunian lewat \`/property\`.`)
        );
    }

    if (emergencyTotalQty > 0) {
        blocks.push(`🚨 **Barang Evakuasi Darurat (${emergencyTotalQty} unit terkunci):** Kosongkan slot tas lalu klik **Evakuasi Darurat** di bawah untuk mengambil barang dari puing bangunan roboh!`);
    }

    blocks.push(
        `**📦 Isi ${meta.emoji} ${meta.name} Saat Ini:**\n${placeItemLines.length > 0 ? placeItemLines.slice(0, 12).join('\n') : '*Kosong*'}`
    );
    if (remoteHint) blocks.push(remoteHint);

    const rows = [tabRow];
    if (emergencyTotalQty > 0) {
        rows.push(
            new ActionRowBuilder().addComponents(
                btn('storage', 'evacuate_emergency', ownerId, {
                    label: `Evakuasi Darurat (${emergencyTotalQty})`,
                    emoji: '🚨',
                    style: ButtonStyle.Danger
                }, now)
            )
        );
    }
    if ((propStatus.cityLands || []).length > 1) {
        rows.push(
            select('storage', 'pick_land', ownerId, {
                placeholder: 'Pilih kavling lokal yang ingin diakses penyimpanannya...',
                options: propStatus.cityLands.slice(0, 25).map(l => ({
                    label: `${l.custom_name} (${l.width}×${l.height})`,
                    value: `${meta.id}:${direction}:${l.id}`,
                    emoji: '🏡',
                    description: `${currentCity.shortName}${Number(l.is_primary) === 1 ? ' · Utama' : ''}`,
                    default: Number(l.id) === Number(activeLandId)
                }))
            }, now)
        );
    }

    if (!isLocked) {
        // Daftar kandidat barang sesuai arah (put = dari Tas yang sesuai jenisnya, take = dari Storage)
        const rawSource = direction === 'put'
            ? groupRowsByItem(bagRows, 'bag').filter(e => {
                const per = isItemPerishable(e.item);
                return meta.perishableOnly ? per : !per;
            })
            : placeGrouped;

        const activeEntry = rawSource.find(e => e.item.id === selectedItemId) || rawSource[0] || null;

        if (rawSource.length > 0) {
            rows.push(
                select('storage', 'pick', ownerId, {
                    placeholder: direction === 'put'
                        ? `📥 Pilih barang dari Tas untuk disimpan ke ${meta.name}...`
                        : `📤 Pilih barang dari ${meta.name} untuk diambil ke Tas...`,
                    options: rawSource.map(e => ({
                        label: `${e.item.name} (×${e.totalQty})`,
                        value: `${meta.id}:${direction}:${e.item.id}`,
                        emoji: e.item.emoji,
                        description: e.freshnessBadge || (meta.perishableOnly ? 'Barang segar' : 'Barang tidak basi'),
                        default: activeEntry && e.item.id === activeEntry.item.id
                    }))
                }, now)
            );

            if (activeEntry) {
                rows.push(
                    quantityRow('storage', 'move', ownerId, {
                        presets: [1, 5, 10],
                        maxLabel: 'Semua',
                        argPrefix: `${meta.id}:${direction}:${activeEntry.item.id}`,
                        customAction: 'move_modal',
                        disableMulti: activeEntry.totalQty <= 1
                    }, now)
                );
            }
        } else {
            blocks.push(
                direction === 'put'
                    ? `ℹ️ *Tidak ada barang yang cocok di Tasmu untuk disimpan ke **${meta.name}**.*`
                    : `ℹ️ *Tidak ada barang di **${meta.name}** untuk diambil.*`
            );
        }
    }

    return buildPanel({
        mod: 'storage',
        ownerId,
        accentColor: COLORS.LIFE,
        title: `🧊 Penyimpanan Rumah & Cooler Box`,
        player: p,
        banner,
        blocks,
        rows: rows.slice(0, 5),
        footer: 'Klik tombol Mode di kanan atas untuk berganti antara Simpan dari Tas (📥) dan Ambil ke Tas (📤).',
        now
    });
}

async function executeStorageMove(discordId, place, direction, itemId, reqAmount, now = Date.now()) {
    const meta = STORAGE_META[place] || STORAGE_META.kulkas;
    const item = getItem(itemId);
    if (!item || item.stackSize === 0) return { error: 'INVALID_ITEM' };

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const currentCity = p.current_city || 'kota_sentral';
        const prefLandId = storageLandSelection.get(discordId);
        let propStatus = await getPlayerPropertyStatus(conn, discordId, p.max_slots, now, true, currentCity);
        if (prefLandId && (propStatus.cityLands || []).some(l => Number(l.id) === Number(prefLandId))) {
            const eff = await getEffectiveLocalProperty(conn, discordId, currentCity, p.max_slots, now, true, prefLandId);
            if (eff.landId && Number(eff.landId) !== Number(propStatus.landId)) {
                propStatus = {
                    ...propStatus,
                    landId: eff.landId,
                    facilitiesLocked: eff.facilitiesLocked,
                    capacities: {
                        ...propStatus.capacities,
                        kulkas: Number(eff.storageLimits?.kulkas || 0),
                        freezer: Number(eff.storageLimits?.freezer || 0),
                        gudang: Number(eff.storageLimits?.gudang || 0),
                        stove: Number(eff.storageLimits?.stove || 0)
                    }
                };
            }
        }

        const maxTargetCap = propStatus.capacities[meta.id] || 0;
        if ((meta.id !== 'coolerbox' && propStatus.facilitiesLocked) || maxTargetCap <= 0) {
            return { error: 'FACILITY_LOCKED' };
        }

        const isLandScoped = ['kulkas', 'freezer', 'gudang'].includes(meta.id);
        const targetLandId = isLandScoped ? (propStatus.landId ? Number(propStatus.landId) : null) : null;

        const sourceLoc = direction === 'put' ? 'bag' : meta.id;
        const destLoc = direction === 'put' ? meta.id : 'bag';
        const sourceLandId = direction === 'put' ? undefined : targetLandId;
        const destLandId = direction === 'put' ? targetLandId : null;
        const destMaxSlots = direction === 'put' ? maxTargetCap : Number(p.max_slots || 20);

        const sourceRows = await getPlayerInventory(conn, discordId, true, sourceLoc, now, sourceLandId);
        const destRows = await getPlayerInventory(conn, discordId, true, destLoc, now, destLandId);

        const ownedInSource = sourceRows
            .filter(r => r.item_id === item.id)
            .reduce((acc, r) => acc + Number(r.quantity), 0);

        if (ownedInSource <= 0) {
            return { error: 'NOT_IN_SOURCE' };
        }

        const moveQty = reqAmount === 'max'
            ? ownedInSource
            : Math.min(ownedInSource, Math.max(1, Number(reqAmount) || 1));

        let remSim = moveQty;
        const batchesToMove = [];
        for (const r of sourceRows) {
            if (r.item_id !== item.id || remSim <= 0) continue;
            const take = Math.min(Number(r.quantity), remSim);
            batchesToMove.push({
                itemId: item.id,
                qty: take,
                freshnessMs: r.freshness_remaining_ms !== null ? Number(r.freshness_remaining_ms) : null
            });
            remSim -= take;
        }

        const fitCheck = canFitItems(destRows, destMaxSlots, batchesToMove);
        if (!fitCheck.fits) {
            return {
                error: 'DEST_FULL',
                slotsAfter: fitCheck.slotsAfter,
                maxSlots: fitCheck.maxSlots
            };
        }

        const removedBatches = await removeItem(conn, discordId, item.id, moveQty, sourceLoc, sourceLandId);
        for (const b of removedBatches) {
            await addItem(conn, discordId, item.id, b.qty, now, destLoc, b.freshnessMs, destLandId);
        }

        return {
            ok: true,
            item,
            meta,
            moveQty
        };
    });
}

module.exports = {
    name: 'storage',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('storage')
        .setDescription('Kelola penyimpanan Kulkas, Freezer, Gudang Rumah, dan Cooler Box portabel secara interaktif.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchStorageState(interaction.user.id, now);
        return await interaction.reply(
            buildStoragePanel({
                state,
                place: 'kulkas',
                direction: 'put',
                now
            })
        );
    },

    panel: {
        buttons: {
            async tab(interaction, parsed) {
                const now = Date.now();
                const [place = 'kulkas', direction = 'put'] = (parsed.arg || '').split(':');
                const state = await fetchStorageState(interaction.user.id, now);
                return await interaction.update(
                    buildStoragePanel({
                        state,
                        place,
                        direction,
                        now
                    })
                );
            },
            async move(interaction, parsed) {
                const now = Date.now();
                const [place = 'kulkas', direction = 'put', itemId = '', rawQty = '1'] = (parsed.arg || '').split(':');
                const reqAmount = rawQty === 'max' ? 'max' : Number(rawQty) || 1;
                const res = await executeStorageMove(interaction.user.id, place, direction, itemId, reqAmount, now);
                const state = await fetchStorageState(interaction.user.id, now);

                let banner = null;
                if (!res.ok) {
                    banner = {
                        type: 'warning',
                        text: res.error === 'DEST_FULL'
                            ? `Kapasitas penyimpanan tujuan penuh! Butuh **${res.slotsAfter}/${res.maxSlots} slot**.`
                            : res.error === 'FACILITY_LOCKED'
                                ? (isPropertyUnderDevelopment()
                                    ? 'Fasilitas penyimpanan sedang terkunci! Fitur `/property` & `/bangun` sedang dalam pengembangan.'
                                    : 'Fasilitas penyimpanan sedang terkunci! Renovasi bangunan di `/property` atau bangun modul di `/bangun`.')
                                : 'Gagal memindahkan barang: pastikan barang masih tersedia dan ruang cukup.'
                    };
                } else {
                    banner = {
                        type: 'success',
                        text: direction === 'put'
                            ? `📥 Menyimpan **${res.moveQty}× ${res.item.emoji} ${res.item.name}** ke **${res.meta.emoji} ${res.meta.name}**!`
                            : `📤 Mengambil **${res.moveQty}× ${res.item.emoji} ${res.item.name}** dari **${res.meta.emoji} ${res.meta.name}** ke Tas!`
                    };
                }

                return await interaction.update(
                    buildStoragePanel({
                        state,
                        place,
                        direction,
                        selectedItemId: itemId,
                        banner,
                        now
                    })
                );
            },
            async evacuate_emergency(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await evacuateEmergencyStorage(conn, userId, null, synced.player.max_slots, now);
                });
                const state = await fetchStorageState(userId, now);
                const banner = res.ok
                    ? (res.movedCount > 0
                        ? { type: 'success', text: `🚨 Berhasil mengevakuasi **${res.movedCount}** barang darurat ke Tas! *(Sisa terkunci: **${res.remainingCount}**)*` }
                        : { type: 'warning', text: `Tas penuh! Kosongkan tas dulu untuk mengevakuasi **${res.remainingCount}** barang tersisa.` })
                    : { type: 'warning', text: res.error || 'Tidak ada barang darurat yang perlu dievakuasi.' };
                return await interaction.update(
                    buildStoragePanel({
                        state,
                        place: 'kulkas',
                        direction: 'take',
                        banner,
                        now
                    })
                );
            },
            async move_modal(interaction, parsed) {
                const now = Date.now();
                const [place = 'kulkas', direction = 'put', itemId = ''] = (parsed.arg || '').split(':');
                const item = getItem(itemId);
                return await interaction.showModal(
                    numberModal('storage', 'move_submit', interaction.user.id, {
                        title: `${direction === 'put' ? 'Simpan' : 'Ambil'} ${item ? item.name : 'Barang'}`,
                        label: 'Jumlah barang (1 - 500)',
                        placeholder: 'Contoh: 10',
                        arg: `${place}:${direction}:${itemId}`
                    }, now)
                );
            }
        },
        selects: {
            async pick(interaction) {
                const now = Date.now();
                const [place = 'kulkas', direction = 'put', itemId = ''] = (interaction.values[0] || '').split(':');
                const state = await fetchStorageState(interaction.user.id, now);
                return await interaction.update(
                    buildStoragePanel({
                        state,
                        place,
                        direction,
                        selectedItemId: itemId,
                        now
                    })
                );
            },
            async pick_land(interaction) {
                const now = Date.now();
                const [place = 'kulkas', direction = 'put', lidStr = ''] = (interaction.values[0] || '').split(':');
                const lid = Number(lidStr);
                if (lid > 0) storageLandSelection.set(interaction.user.id, lid);
                const state = await fetchStorageState(interaction.user.id, now);
                return await interaction.update(
                    buildStoragePanel({
                        state,
                        place,
                        direction,
                        now
                    })
                );
            }
        },
        modals: {
            async move_submit(interaction, parsed) {
                const now = Date.now();
                const [place = 'kulkas', direction = 'put', itemId = ''] = (parsed.arg || '').split(':');
                const parsedNum = parseModalNumber(interaction, { min: 1, max: 500 });

                if (!parsedNum.ok) {
                    const state = await fetchStorageState(interaction.user.id, now);
                    const payload = buildStoragePanel({
                        state,
                        place,
                        direction,
                        selectedItemId: itemId,
                        banner: { type: 'warning', text: parsedNum.error },
                        now
                    });
                    return await respondOrUpdate(interaction, payload);
                }

                const res = await executeStorageMove(interaction.user.id, place, direction, itemId, parsedNum.value, now);
                const state = await fetchStorageState(interaction.user.id, now);
                const banner = res.ok
                    ? {
                        type: 'success',
                        text: direction === 'put'
                            ? `📥 Menyimpan **${res.moveQty}× ${res.item.emoji} ${res.item.name}** ke **${res.meta.emoji} ${res.meta.name}**!`
                            : `📤 Mengambil **${res.moveQty}× ${res.item.emoji} ${res.item.name}** dari **${res.meta.emoji} ${res.meta.name}** ke Tas!`
                    }
                    : { type: 'warning', text: 'Kapasitas penyimpanan tujuan tidak mencukupi atau jumlah melebihi stok.' };

                const payload = buildStoragePanel({
                    state,
                    place,
                    direction,
                    selectedItemId: itemId,
                    banner,
                    now
                });
                return await respondOrUpdate(interaction, payload);
            }
        }
    },

    buildStoragePanel
};
