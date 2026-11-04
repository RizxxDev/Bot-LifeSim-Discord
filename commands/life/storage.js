const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerPropertyStatus } = require('../../services/propertyService');
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
    parseModalNumber
} = require('../../utils/panelBuilder');

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

async function fetchStorageState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const propStatus = await getPlayerPropertyStatus(conn, discordId, synced.player.max_slots, now, false);
        const allRows = await getPlayerInventory(conn, discordId, false, 'all', now);
        return { player: synced.player, propStatus, allRows };
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
    const { player: p, propStatus, allRows } = state;
    const ownerId = p.discord_id;
    const meta = STORAGE_META[place] || STORAGE_META.kulkas;

    const bagRows = allRows.filter(r => !r.storage_location || r.storage_location === 'bag');
    const placeRows = allRows.filter(r => r.storage_location === meta.id);

    const bagSlotsUsed = calculateSlotsUsed(bagRows);
    const placeSlotsUsed = calculateSlotsUsed(placeRows);
    const maxCap = propStatus.capacities[meta.id] || 0;
    const isLocked = maxCap <= 0;

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

    const blocks = [
        [
            `🏠 **Hunian Aktif:** ${propStatus.effectiveTier.emoji} **${propStatus.effectiveTier.name}** · 🎒 **Tas:** \`${bagSlotsUsed}/${p.max_slots} slot\``,
            `${meta.emoji} **${meta.name}:** \`${renderBar(placeSlotsUsed, Math.max(1, maxCap), 8)}\` (**${placeSlotsUsed}/${maxCap} slot**) — *${meta.rateText}*`
        ].join('\n')
    ];

    if (isLocked) {
        blocks.push(
            meta.id === 'coolerbox'
                ? `🔒 **Cooler Box Belum Dimiliki:** Beli **🧊 Cooler Box Portabel** di Toko Perkakas (\`/shop\`) untuk menambah 10 slot pendingin portabel.`
                : `🔒 **Fasilitas Belum Terbuka / Terkunci:** Sewa atau beli hunian yang memiliki **${meta.name}** lewat \`/property\`.`
        );
    }

    blocks.push(
        `**📦 Isi ${meta.emoji} ${meta.name} Saat Ini:**\n${placeItemLines.length > 0 ? placeItemLines.slice(0, 12).join('\n') : '*Kosong*'}`
    );

    const rows = [tabRow];

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
        rows,
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
        const propStatus = await getPlayerPropertyStatus(conn, discordId, p.max_slots, now, true);

        const maxTargetCap = propStatus.capacities[meta.id] || 0;
        if (maxTargetCap <= 0) {
            return { error: 'FACILITY_LOCKED' };
        }

        const sourceLoc = direction === 'put' ? 'bag' : meta.id;
        const destLoc = direction === 'put' ? meta.id : 'bag';
        const destMaxSlots = direction === 'put' ? maxTargetCap : Number(p.max_slots || 20);

        const sourceRows = await getPlayerInventory(conn, discordId, true, sourceLoc, now);
        const destRows = await getPlayerInventory(conn, discordId, true, destLoc, now);

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

        const removedBatches = await removeItem(conn, discordId, item.id, moveQty, sourceLoc);
        for (const b of removedBatches) {
            await addItem(conn, discordId, item.id, b.qty, now, destLoc, b.freshnessMs);
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
                    return interaction.isFromMessage() ? await interaction.update(payload) : await interaction.reply(payload);
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
                return interaction.isFromMessage() ? await interaction.update(payload) : await interaction.reply(payload);
            }
        }
    },

    buildStoragePanel
};
