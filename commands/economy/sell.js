const { SlashCommandBuilder } = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerInventory, removeItem } = require('../../services/inventoryService');
const { creditPlayerCash, getLiveEconomyConfig } = require('../../services/economyService');
const { getItemDynamicSellInfo, recordItemsSold } = require('../../services/marketService');
const { getItem, getSellableItems } = require('../../data/items');
const { COLORS, formatLp, buildV2Card } = require('../../utils/uiBuilder');

module.exports = {
    name: 'sell',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('sell')
        .setDescription('Jual ikan, hasil tambang, atau sampah ke pasar dinamis (kosongkan item untuk cek papan harga).')
        .addStringOption(opt =>
            opt
                .setName('item')
                .setDescription('Pilih item atau opsi cepat (semua_ikan, semua_tambang, semua_sampah, semua_hasil)')
                .setAutocomplete(true)
                .setRequired(false)
        )
        .addIntegerOption(opt =>
            opt
                .setName('amount')
                .setDescription('Jumlah yang ingin dijual (kosongkan untuk menjual semua dari item tersebut)')
                .setMinValue(1)
                .setMaxValue(1000)
                .setRequired(false)
        ),

    async autocomplete(interaction) {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        const bulkOptions = [
            { name: '🐟 Jual Semua Ikan di Tas (semua_ikan)', value: 'semua_ikan' },
            { name: '⛏️ Jual Semua Hasil Tambang di Tas (semua_tambang)', value: 'semua_tambang' },
            { name: '♻️ Jual Semua Sampah di Tas (semua_sampah)', value: 'semua_sampah' },
            { name: '💰 Jual Seluruh Ikan, Tambang & Sampah (semua_hasil)', value: 'semua_hasil' }
        ];

        const choices = bulkOptions.filter(o => o.name.toLowerCase().includes(focused) || o.value.includes(focused));

        try {
            const rows = await query(
                `SELECT item_id, SUM(quantity) AS total_qty
                 FROM player_inventory
                 WHERE discord_id = ? AND quantity > 0
                 GROUP BY item_id`,
                [interaction.user.id]
            );

            for (const row of rows) {
                const it = getItem(row.item_id);
                if (!it || !it.sellPrice) continue;
                const target = `${it.id} ${it.name}`.toLowerCase();
                if (!focused || target.includes(focused)) {
                    choices.push({
                        name: `${it.name} ×${row.total_qty} (Harga Dasar ${formatLp(it.sellPrice)})`.slice(0, 100),
                        value: it.id
                    });
                }
                if (choices.length >= 25) break;
            }
        } catch {
            // ignore
        }

        await interaction.respond(choices.slice(0, 25));
    },

    async executeSlash(interaction) {
        const discordId = interaction.user.id;
        const itemArg = interaction.options.getString('item')?.toLowerCase();
        const amountArg = interaction.options.getInteger('amount');
        const now = Date.now();

        // Tanpa argumen: tampilkan Papan Harga Pasar Dinamis
        if (!itemArg) {
            const data = await withTransaction(async (conn) => {
                const synced = await syncPlayerVitals(conn, discordId, now, false);
                const invRows = await getPlayerInventory(conn, discordId, false);
                const liveCfg = await getLiveEconomyConfig(conn);
                return { player: synced.player, invRows, liveCfg };
            });

            const sellMultiplier = Number(data.liveCfg.sell_multiplier || 1.0);
            const sellableInBag = [];

            for (const row of data.invRows) {
                const it = getItem(row.item_id);
                if (it && it.sellPrice > 0) {
                    sellableInBag.push({ item: it, qty: Number(row.quantity) });
                }
            }

            const bagPriceLines = [];
            let estimatedBagTotal = 0;

            for (const entry of sellableInBag) {
                const info = await getItemDynamicSellInfo(entry.item.id, sellMultiplier, now);
                const subTotal = info.unitPrice * entry.qty;
                estimatedBagTotal += subTotal;
                bagPriceLines.push(
                    `• ${entry.item.emoji} **${entry.item.name}** ×${entry.qty} → **${formatLp(info.unitPrice)}/pcs** (${info.percentOfBase}% · ${info.trend}) = **${formatLp(subTotal)}**`
                );
            }

            // Contoh komoditas utama pasar
            const sampleIds = ['ikan_mujair', 'ikan_gurame', 'ikan_arwana', 'batubara', 'bijih_perak', 'bijih_emas', 'berlian_biru'];
            const marketLines = [];
            for (const id of sampleIds) {
                const info = await getItemDynamicSellInfo(id, sellMultiplier, now);
                if (info) {
                    marketLines.push(
                        `• ${info.item.emoji} **${info.item.name}**: **${formatLp(info.unitPrice)}** *(Dasar ${formatLp(info.basePrice)} · ${info.percentOfBase}% · Suplai 24j: ${info.sold24h}/${info.threshold} · ${info.trend})*`
                    );
                }
            }

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.ECONOMY,
                    title: '📊 Papan Harga Pasar Ikan & Pengepul Tambang (24 Jam)',
                    blocks: [
                        'Harga beli NPC bergerak dinamis berdasarkan jumlah suplai global dalam 24 jam terakhir (turun hingga maks 50% bila banjir suplai, dan pulih otomatis setiap jam).',
                        bagPriceLines.length > 0
                            ? `**🎒 Komoditas di Tasmu (Estimasi Total: ${formatLp(estimatedBagTotal)}):**\n${bagPriceLines.slice(0, 12).join('\n')}`
                            : '🎒 *Tasmu saat ini belum berisi ikan, mineral, atau sampah yang bisa dijual.*',
                        `**📈 Indeks Komoditas Utama Kota:**\n${marketLines.join('\n')}`
                    ],
                    footer: 'Gunakan /sell item:semua_hasil untuk menjual semua sekaligus, atau pilih item tertentu.'
                })
            );
        }

        // Proses penjualan
        const res = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, true);
            const p = synced.player;
            const invRows = await getPlayerInventory(conn, discordId, true);
            const liveCfg = await getLiveEconomyConfig(conn);
            const sellMultiplier = Number(liveCfg.sell_multiplier || 1.0);

            const toSell = [];

            if (['semua_ikan', 'semua_tambang', 'semua_sampah', 'semua_hasil'].includes(itemArg)) {
                for (const row of invRows) {
                    const it = getItem(row.item_id);
                    if (!it || !it.sellPrice || Number(row.quantity) <= 0) continue;

                    const isFish = it.tags.includes('fish');
                    const isMineral = it.tags.includes('mineral');
                    const isTrash = it.tags.includes('trash');

                    if (
                        (itemArg === 'semua_ikan' && isFish) ||
                        (itemArg === 'semua_tambang' && isMineral) ||
                        (itemArg === 'semua_sampah' && isTrash) ||
                        (itemArg === 'semua_hasil' && (isFish || isMineral || isTrash))
                    ) {
                        toSell.push({ item: it, qty: Number(row.quantity) });
                    }
                }
            } else {
                const it = getItem(itemArg);
                if (!it || !it.sellPrice) {
                    return { error: 'NOT_SELLABLE' };
                }
                const owned = invRows
                    .filter(r => r.item_id === it.id)
                    .reduce((acc, r) => acc + Number(r.quantity), 0);

                if (owned <= 0) {
                    return { error: 'NOT_OWNED', item: it };
                }

                const sellQty = amountArg ? Math.min(owned, amountArg) : owned;
                toSell.push({ item: it, qty: sellQty });
            }

            if (toSell.length === 0) {
                return { error: 'EMPTY_MATCH' };
            }

            let grandTotal = 0;
            const soldDetails = [];

            for (const entry of toSell) {
                const dynInfo = await getItemDynamicSellInfo(entry.item.id, sellMultiplier, now);
                const revenue = dynInfo.unitPrice * entry.qty;
                grandTotal += revenue;

                await removeItem(conn, discordId, entry.item.id, entry.qty);

                soldDetails.push({
                    itemId: entry.item.id,
                    item: entry.item,
                    qty: entry.qty,
                    unitPrice: dynInfo.unitPrice,
                    percentOfBase: dynInfo.percentOfBase,
                    revenue
                });
            }

            await creditPlayerCash(conn, p, grandTotal, `sell_${itemArg}`, {
                itemsCount: soldDetails.length
            }, now);

            return {
                player: p,
                grandTotal,
                soldDetails
            };
        });

        if (res.error === 'NOT_SELLABLE') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '❌ Barang Tidak Dapat Dijual',
                    blocks: ['Hanya hasil pancingan (ikan/sampah) dan hasil tambang yang dapat dijual ke pengepul.'],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'NOT_OWNED' || res.error === 'EMPTY_MATCH') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '🎒 Tidak Ada Komoditas yang Dijual',
                    blocks: ['Kamu tidak memiliki item tersebut di dalam tasmu saat ini.'],
                    ephemeral: true
                })
            );
        }

        // Catat penambahan suplai ke Redis 24 jam bergulir
        await recordItemsSold(
            res.soldDetails.map(d => ({ itemId: d.itemId, qty: d.qty })),
            now
        );

        const summaryLines = res.soldDetails.map(d =>
            `• **${d.qty}× ${d.item.emoji} ${d.item.name}** @ ${formatLp(d.unitPrice)} *(${d.percentOfBase}%)* = **${formatLp(d.revenue)}**`
        );

        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.SUCCESS,
                title: '💰 Transaksi Penjualan Berhasil!',
                blocks: [
                    summaryLines.slice(0, 15).join('\n') + (summaryLines.length > 15 ? `\n*...dan ${summaryLines.length - 15} jenis lainnya.*` : ''),
                    `💵 **Total Diterima:** **+${formatLp(res.grandTotal)}**\n💼 **Saldo Cash Sekarang:** **${formatLp(res.player.cash)}**`
                ]
            })
        );
    }
};
