const { SlashCommandBuilder } = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
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
const { COLORS, renderBar, buildV2Card } = require('../../utils/uiBuilder');

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

const STORAGE_CHOICES = [
    { name: '❄️ Kulkas Rumah (Basi 3x lebih lambat)', value: 'kulkas' },
    { name: '🧊 Freezer Rumah (Tidak basi / Beku)', value: 'freezer' },
    { name: '📦 Gudang Rumah (Barang tidak basi)', value: 'gudang' },
    { name: '🧊 Cooler Box Portabel (Basi 2x lebih lambat)', value: 'coolerbox' }
];

module.exports = {
    name: 'storage',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('storage')
        .setDescription('Kelola penyimpanan Kulkas, Freezer, Gudang Rumah, dan Cooler Box portabel.')
        .addSubcommand(sub =>
            sub
                .setName('view')
                .setDescription('Lihat isi Kulkas, Freezer, Gudang, atau Cooler Box beserta sisa kesegarannya.')
                .addStringOption(opt =>
                    opt
                        .setName('tempat')
                        .setDescription('Filter lokasi penyimpanan (kosongkan untuk melihat semua)')
                        .setRequired(false)
                        .addChoices(...STORAGE_CHOICES)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('put')
                .setDescription('Simpan barang dari Tas ke Kulkas, Freezer, Gudang, atau Cooler Box.')
                .addStringOption(opt =>
                    opt
                        .setName('tempat')
                        .setDescription('Tujuan penyimpanan')
                        .setRequired(true)
                        .addChoices(...STORAGE_CHOICES)
                )
                .addStringOption(opt =>
                    opt
                        .setName('item')
                        .setDescription('Barang dari Tas yang ingin disimpan')
                        .setAutocomplete(true)
                        .setRequired(true)
                )
                .addIntegerOption(opt =>
                    opt
                        .setName('amount')
                        .setDescription('Jumlah barang yang ingin disimpan (default 1)')
                        .setMinValue(1)
                        .setMaxValue(500)
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('take')
                .setDescription('Ambil barang dari Kulkas, Freezer, Gudang, atau Cooler Box ke Tas.')
                .addStringOption(opt =>
                    opt
                        .setName('tempat')
                        .setDescription('Lokasi asal barang')
                        .setRequired(true)
                        .addChoices(...STORAGE_CHOICES)
                )
                .addStringOption(opt =>
                    opt
                        .setName('item')
                        .setDescription('Barang yang ingin diambil kembali ke Tas')
                        .setAutocomplete(true)
                        .setRequired(true)
                )
                .addIntegerOption(opt =>
                    opt
                        .setName('amount')
                        .setDescription('Jumlah barang yang ingin diambil (default 1)')
                        .setMinValue(1)
                        .setMaxValue(500)
                        .setRequired(false)
                )
        ),

    async autocomplete(interaction) {
        const sub = interaction.options.getSubcommand();
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        const targetPlace = interaction.options.getString('tempat') || 'kulkas';
        const sourceLoc = sub === 'put' ? 'bag' : targetPlace;

        try {
            const rows = await query(
                `SELECT item_id, SUM(quantity) AS total_qty
                 FROM player_inventory
                 WHERE discord_id = ? AND storage_location = ? AND quantity > 0
                 GROUP BY item_id`,
                [interaction.user.id, sourceLoc]
            );

            const choices = [];
            for (const r of rows) {
                const it = getItem(r.item_id);
                if (!it || it.stackSize === 0) continue;

                if (sub === 'put') {
                    const meta = STORAGE_META[targetPlace];
                    const perishable = isItemPerishable(it);
                    if (meta?.perishableOnly && !perishable) continue;
                    if (!meta?.perishableOnly && perishable) continue;
                }

                const searchStr = `${it.id} ${it.name}`.toLowerCase();
                if (!focused || searchStr.includes(focused)) {
                    choices.push({
                        name: `${it.name} ×${r.total_qty}`.slice(0, 100),
                        value: it.id
                    });
                }
                if (choices.length >= 25) break;
            }

            await interaction.respond(choices);
        } catch {
            await interaction.respond([]);
        }
    },

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        const discordId = interaction.user.id;
        const now = Date.now();

        if (sub === 'view') {
            const filterPlace = interaction.options.getString('tempat');
            const data = await withTransaction(async (conn) => {
                const synced = await syncPlayerVitals(conn, discordId, now, false);
                const propStatus = await getPlayerPropertyStatus(conn, discordId, synced.player.max_slots, now, false);
                const allRows = await getPlayerInventory(conn, discordId, false, 'all', now);
                return { player: synced.player, propStatus, allRows };
            });

            const { propStatus, allRows } = data;
            const placesToShow = filterPlace ? [filterPlace] : ['coolerbox', 'kulkas', 'freezer', 'gudang'];
            const blocks = [
                `🏠 **Hunian Aktif:** ${propStatus.effectiveTier.emoji} **${propStatus.effectiveTier.name}**${propStatus.isEvicted ? ' *(🔒 Kontrak berakhir/diusir — penyimpanan rumah terkunci)*' : ''}`
            ];

            for (const locKey of placesToShow) {
                const meta = STORAGE_META[locKey];
                const rowsInLoc = allRows.filter(r => r.storage_location === locKey);
                const maxCap = propStatus.capacities[locKey] || 0;
                const usedSlots = calculateSlotsUsed(rowsInLoc);

                if (maxCap <= 0 && rowsInLoc.length === 0) {
                    if (filterPlace === locKey) {
                        blocks.push(
                            `${meta.emoji} **${meta.name}** — 🔒 *Belum Terbuka*\n${locKey === 'coolerbox' ? 'Beli **🧊 Cooler Box Portabel** di Toko Perkakas (`/shop`).' : 'Sewa atau beli properti yang memiliki fasilitas ini lewat `/property list`.'}`
                        );
                    }
                    continue;
                }

                const lockNotice = (maxCap <= 0 && rowsInLoc.length > 0)
                    ? ' · 🔒 **TERKUNCI (Sewa/Beli Properti untuk Mengakses)**'
                    : '';

                const itemLines = rowsInLoc.map(r => {
                    const it = getItem(r.item_id);
                    if (!it) return null;
                    const freshBadge = r.freshness_remaining_ms !== null
                        ? ` · *${formatFreshnessBadge(r.freshness_remaining_ms, locKey)}*`
                        : '';
                    return `• ${it.emoji} **${it.name}** ×**${r.quantity}**${freshBadge}`;
                }).filter(Boolean);

                blocks.push(
                    [
                        `${meta.emoji} **${meta.name}** — \`${renderBar(usedSlots, Math.max(1, maxCap), 8)}\` (**${usedSlots}/${maxCap} slot**)${lockNotice}`,
                        `*${meta.rateText}*`,
                        itemLines.length > 0 ? itemLines.slice(0, 15).join('\n') : '*Kosong*'
                    ].join('\n')
                );
            }

            if (blocks.length === 1) {
                blocks.push('Kamu belum memiliki fasilitas penyimpanan aktif. Beli **🧊 Cooler Box** di Toko Perkakas (`/shop`) atau sewa hunian lewat `/property list`!');
            }

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.LIFE,
                    title: '🧊 Penyimpanan Rumah & Cooler Box',
                    blocks,
                    footer: 'Gunakan /storage put untuk menyimpan barang dari Tas, atau /storage take untuk mengambil ke Tas.',
                    ephemeral: true
                })
            );
        }

        const targetPlace = interaction.options.getString('tempat', true);
        const itemId = interaction.options.getString('item', true).toLowerCase();
        const reqAmount = interaction.options.getInteger('amount') || 1;
        const meta = STORAGE_META[targetPlace];
        const item = getItem(itemId);

        if (!item || item.stackSize === 0) {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '❌ Barang Tidak Valid',
                    blocks: ['Pilih barang yang valid dari daftar autocomplete. Dokumen/lisensi 0 slot tidak perlu dipindahkan.'],
                    ephemeral: true
                })
            );
        }

        if (sub === 'put') {
            const perishable = isItemPerishable(item);
            if (meta.perishableOnly && !perishable) {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: `⚠️ ${meta.name} Khusus Barang yang Bisa Basi`,
                        blocks: [
                            `**${item.emoji} ${item.name}** tidak bisa basi! Gunakan **📦 Gudang Rumah** (\`/storage put tempat:gudang\`) untuk menyimpan barang yang tidak bisa basi.`
                        ],
                        ephemeral: true
                    })
                );
            }
            if (!meta.perishableOnly && perishable) {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '⚠️ Gudang Hanya untuk Barang Tidak Basi',
                        blocks: [
                            `**${item.emoji} ${item.name}** dapat membusuk! Simpan di **❄️ Kulkas**, **🧊 Freezer**, atau **🧊 Cooler Box** agar kesegarannya terjaga.`
                        ],
                        ephemeral: true
                    })
                );
            }
        }

        const res = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, true);
            const p = synced.player;
            const propStatus = await getPlayerPropertyStatus(conn, discordId, p.max_slots, now, true);

            const maxTargetCap = propStatus.capacities[targetPlace] || 0;
            if (maxTargetCap <= 0) {
                return {
                    error: 'FACILITY_LOCKED',
                    propStatus
                };
            }

            const sourceLoc = sub === 'put' ? 'bag' : targetPlace;
            const destLoc = sub === 'put' ? targetPlace : 'bag';
            const destMaxSlots = sub === 'put' ? maxTargetCap : Number(p.max_slots || 20);

            const sourceRows = await getPlayerInventory(conn, discordId, true, sourceLoc, now);
            const destRows = await getPlayerInventory(conn, discordId, true, destLoc, now);

            const ownedInSource = sourceRows
                .filter(r => r.item_id === item.id)
                .reduce((acc, r) => acc + Number(r.quantity), 0);

            if (ownedInSource <= 0) {
                return { error: 'NOT_IN_SOURCE', sourceLoc };
            }

            const moveQty = Math.min(ownedInSource, reqAmount);

            // Simulasikan batch FIFO yang akan dipindahkan untuk mengecek kecukupan slot tujuan
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
                    destLoc,
                    slotsBefore: fitCheck.slotsBefore,
                    slotsAfter: fitCheck.slotsAfter,
                    maxSlots: fitCheck.maxSlots
                };
            }

            const removedBatches = await removeItem(conn, discordId, item.id, moveQty, sourceLoc);
            for (const b of removedBatches) {
                await addItem(conn, discordId, item.id, b.qty, now, destLoc, b.freshnessMs);
            }

            const updatedDestRows = await getPlayerInventory(conn, discordId, false, destLoc, now);
            return {
                ok: true,
                moveQty,
                destSlotsUsed: calculateSlotsUsed(updatedDestRows),
                destMaxSlots
            };
        });

        if (res.error === 'FACILITY_LOCKED') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: `🔒 ${meta.emoji} ${meta.name} Belum Terbuka / Terkunci`,
                    blocks: [
                        targetPlace === 'coolerbox'
                            ? 'Kamu belum memiliki **🧊 Cooler Box Portabel**. Beli terlebih dahulu di **Toko Perkakas** (`/shop` atau `/buy item:cooler_box`).'
                            : res.propStatus.isEvicted
                                ? 'Penyimpanan rumahmu sedang **terkunci** karena masa sewa berakhir. Sewa atau beli properti kembali lewat `/property` untuk membuka akses!'
                                : `Hunianmu saat ini (**${res.propStatus.effectiveTier.name}**) tidak memiliki fasilitas **${meta.name}**. Upgrade hunianmu lewat \`/property list\`.`
                    ],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'NOT_IN_SOURCE') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '📦 Barang Tidak Ditemukan',
                    blocks: [
                        sub === 'put'
                            ? `Kamu tidak memiliki **${item.emoji} ${item.name}** di dalam Tasmu.`
                            : `Tidak ada **${item.emoji} ${item.name}** di dalam **${meta.name}**.`
                    ],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'DEST_FULL') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '📦 Kapasitas Penyimpanan Tujuan Penuh!',
                    blocks: [
                        sub === 'put'
                            ? `**${meta.emoji} ${meta.name}** tidak cukup ruang! Butuh **${res.slotsAfter} slot**, sedangkan kapasitas maksimalnya **${res.maxSlots} slot**.`
                            : `**🎒 Tasmu** penuh! Butuh **${res.slotsAfter} slot**, sedangkan kapasitas tasmu **${res.maxSlots} slot**.`
                    ],
                    ephemeral: true
                })
            );
        }

        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.SUCCESS,
                title: sub === 'put'
                    ? `${meta.emoji} Barang Disimpan ke ${meta.name}`
                    : `🎒 Barang Diambil dari ${meta.name}`,
                blocks: [
                    sub === 'put'
                        ? `Berhasil memindahkan **${res.moveQty}× ${item.emoji} ${item.name}** dari Tas ke **${meta.emoji} ${meta.name}** *(Kapasitas: ${res.destSlotsUsed}/${res.destMaxSlots} slot)*.`
                        : `Berhasil mengambil **${res.moveQty}× ${item.emoji} ${item.name}** dari **${meta.emoji} ${meta.name}** ke **🎒 Tas** *(Kapasitas Tas: ${res.destSlotsUsed}/${res.destMaxSlots} slot)*.`
                ]
            })
        );
    }
};
