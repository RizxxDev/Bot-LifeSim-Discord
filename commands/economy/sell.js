const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerInventory } = require('../../services/inventoryService');
const { getLiveEconomyConfig } = require('../../services/economyService');
const { getItemDynamicSellInfo, executeSellItems } = require('../../services/marketService');
const { getItem } = require('../../data/items');
const { COLORS, formatLp } = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select,
    quantityRow,
    numberModal,
    parseModalNumber
} = require('../../utils/panelBuilder');

const SAMPLE_MARKET_IDS = [
    'ikan_mujair',
    'ikan_gurame',
    'ikan_arwana',
    'batubara',
    'bijih_perak',
    'bijih_emas',
    'berlian_biru'
];

async function fetchSellState(discordId, now = Date.now()) {
    const data = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const liveCfg = await getLiveEconomyConfig(conn);
        return { player: synced.player, invRows, liveCfg };
    });

    const sellMultiplier = Number(data.liveCfg.sell_multiplier || 1.0);
    const groupedInBag = new Map();

    for (const row of data.invRows) {
        const it = getItem(row.item_id);
        if (it && it.sellPrice > 0 && Number(row.quantity) > 0) {
            const prev = groupedInBag.get(it.id) || { item: it, qty: 0 };
            prev.qty += Number(row.quantity);
            groupedInBag.set(it.id, prev);
        }
    }

    const bagEntries = [];
    let estimatedBagTotal = 0;
    for (const entry of groupedInBag.values()) {
        const info = await getItemDynamicSellInfo(entry.item.id, sellMultiplier, now);
        const subTotal = info.unitPrice * entry.qty;
        estimatedBagTotal += subTotal;
        bagEntries.push({
            ...entry,
            info,
            subTotal
        });
    }

    const marketBoard = [];
    for (const id of SAMPLE_MARKET_IDS) {
        const info = await getItemDynamicSellInfo(id, sellMultiplier, now);
        if (info) marketBoard.push(info);
    }

    return {
        player: data.player,
        bagEntries,
        estimatedBagTotal,
        marketBoard
    };
}

function buildSellPanel({
    state,
    selectedItemId = null,
    banner = null,
    now = Date.now()
}) {
    const { player: p, bagEntries, estimatedBagTotal, marketBoard } = state;
    const ownerId = p.discord_id;

    const selectedEntry = selectedItemId
        ? bagEntries.find(e => e.item.id === selectedItemId) || null
        : null;

    const bagLines = bagEntries.map(e =>
        `• ${e.item.emoji} **${e.item.name}** ×${e.qty} → **${formatLp(e.info.unitPrice)}/pcs** *(${e.info.percentOfBase}% · ${e.info.trend})* = **${formatLp(e.subTotal)}**`
    );

    const marketLines = marketBoard.map(info =>
        `• ${info.item.emoji} **${info.item.name}**: **${formatLp(info.unitPrice)}** *(Dasar ${formatLp(info.basePrice)} · ${info.percentOfBase}% · Suplai 24j: ${info.sold24h}/${info.threshold} · ${info.trend})*`
    );

    const blocks = [
        bagLines.length > 0
            ? `**🎒 Komoditas di Tasmu (Estimasi Total: ${formatLp(estimatedBagTotal)}):**\n${bagLines.slice(0, 12).join('\n')}${bagLines.length > 12 ? `\n*...dan ${bagLines.length - 12} jenis lainnya.*` : ''}`
            : '🎒 *Tasmu saat ini belum berisi komoditas (ikan, mineral, panen tani, atau masakan) yang dapat dijual.*',
        `**📈 Indeks Harga Pasar Dinamis (24 Jam):**\n${marketLines.join('\n')}`
    ];

    const rows = [];

    if (bagEntries.length > 0) {
        rows.push(
            select('sell', 'pick', ownerId, {
                placeholder: '📦 Pilih komoditas di tas untuk dijual sebagian...',
                options: bagEntries.slice(0, 25).map(e => ({
                    label: `${e.item.name} (×${e.qty})`.slice(0, 100),
                    value: e.item.id,
                    emoji: e.item.emoji,
                    description: `Harga Pasar: ${formatLp(e.info.unitPrice)}/pcs (${e.info.percentOfBase}%) — Total: ${formatLp(e.subTotal)}`.slice(0, 100),
                    default: selectedEntry ? selectedEntry.item.id === e.item.id : false
                }))
            }, now)
        );
    }

    if (selectedEntry) {
        rows.push(
            quantityRow('sell', 'qty', ownerId, {
                presets: [1, 5, 10],
                maxLabel: 'Semua',
                argPrefix: selectedEntry.item.id,
                customAction: 'qty_open_modal',
                disableMulti: selectedEntry.qty <= 1
            }, now)
        );
    }

    const hasFish = bagEntries.some(e => e.item.tags?.includes('fish') || e.item.tags?.includes('trash'));
    const hasMineral = bagEntries.some(e => e.item.tags?.includes('mineral'));
    const hasCrop = bagEntries.some(e => e.item.tags?.includes('crop'));
    const hasCooked = bagEntries.some(e => e.item.tags?.includes('cooked'));

    rows.push(
        new ActionRowBuilder().addComponents(
            btn('sell', 'bulk', ownerId, {
                label: 'Jual Ikan',
                emoji: '🐟',
                style: ButtonStyle.Primary,
                disabled: !hasFish,
                arg: 'semua_ikan'
            }, now),
            btn('sell', 'bulk', ownerId, {
                label: 'Jual Tambang',
                emoji: '⛏️',
                style: ButtonStyle.Primary,
                disabled: !hasMineral,
                arg: 'semua_tambang'
            }, now),
            btn('sell', 'bulk', ownerId, {
                label: 'Jual Tani',
                emoji: '🌾',
                style: ButtonStyle.Primary,
                disabled: !hasCrop,
                arg: 'semua_tani'
            }, now),
            btn('sell', 'bulk', ownerId, {
                label: 'Jual Masakan',
                emoji: '🍛',
                style: ButtonStyle.Primary,
                disabled: !hasCooked,
                arg: 'semua_masakan'
            }, now),
            btn('sell', 'bulk', ownerId, {
                label: 'Jual Semua Hasil',
                emoji: '💰',
                style: ButtonStyle.Success,
                disabled: bagEntries.length === 0,
                arg: 'semua_hasil'
            }, now)
        )
    );

    return buildPanel({
        mod: 'sell',
        ownerId,
        accentColor: COLORS.ECONOMY,
        title: '📊 Papan Harga Pasar & Pengepul Komoditas (/sell)',
        player: p,
        banner,
        blocks,
        rows,
        footer: 'Harga bergerak dinamis berdasarkan suplai global 24 jam (turun hingga maks 50% bila banjir suplai, pulih tiap jam).',
        now
    });
}

function formatSaleBanner(res) {
    if (!res.ok) {
        return { type: 'warning', text: 'Tidak ada komoditas yang sesuai di tasmu untuk dijual.' };
    }
    const preview = res.soldDetails
        .slice(0, 3)
        .map(d => `${d.qty}× ${d.item.emoji} ${d.item.name}`)
        .join(', ');
    const more = res.soldDetails.length > 3 ? ` (+${res.soldDetails.length - 3} lainnya)` : '';
    return {
        type: 'success',
        text: `💰 Terjual **${preview}${more}** dengan total pendapatan **+${formatLp(res.grandTotal)}**!`
    };
}

module.exports = {
    name: 'sell',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('sell')
        .setDescription('Buka panel pasar dinamis: cek harga 24 jam dan jual ikan, tambang, tani, & masakan.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchSellState(interaction.user.id, now);
        return await interaction.reply(buildSellPanel({ state, now }));
    },

    panel: {
        buttons: {
            async bulk(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const bulkKey = parsed.arg || 'semua_hasil';
                const res = await executeSellItems(userId, bulkKey, null, now);
                const state = await fetchSellState(userId, now);
                return await interaction.update(
                    buildSellPanel({
                        state,
                        banner: formatSaleBanner(res),
                        now
                    })
                );
            },
            async qty(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const [itemId, qtySpec] = String(parsed.arg || '').split(':');

                const amount = qtySpec === 'max' ? 'max' : (Number(qtySpec) || 1);
                const res = await executeSellItems(userId, itemId, amount, now);
                const state = await fetchSellState(userId, now);
                return await interaction.update(
                    buildSellPanel({
                        state,
                        selectedItemId: itemId,
                        banner: formatSaleBanner(res),
                        now
                    })
                );
            },
            async qty_open_modal(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const itemId = parsed.arg || '';
                const it = getItem(itemId);
                const modal = numberModal('sell', 'qty_modal', userId, {
                    title: `💰 Jual ${it ? it.name : itemId}`,
                    label: 'Jumlah yang ingin dijual (angka bulat)',
                    placeholder: 'Contoh: 15',
                    arg: itemId
                }, now);
                return await interaction.showModal(modal);
            }
        },
        selects: {
            async pick(interaction) {
                const now = Date.now();
                const itemId = interaction.values[0] || '';
                const state = await fetchSellState(interaction.user.id, now);
                return await interaction.update(buildSellPanel({ state, selectedItemId: itemId, now }));
            }
        },
        modals: {
            async qty_modal(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const itemId = parsed.arg || '';
                const parsedNum = parseModalNumber(interaction, 'amount', { min: 1, max: 9999 });

                if (!parsedNum.ok) {
                    const state = await fetchSellState(userId, now);
                    return await interaction.update(
                        buildSellPanel({
                            state,
                            selectedItemId: itemId,
                            banner: { type: 'warning', text: parsedNum.error },
                            now
                        })
                    );
                }

                const res = await executeSellItems(userId, itemId, parsedNum.value, now);
                const state = await fetchSellState(userId, now);
                return await interaction.update(
                    buildSellPanel({
                        state,
                        selectedItemId: itemId,
                        banner: formatSaleBanner(res),
                        now
                    })
                );
            }
        }
    },

    buildSellPanel
};
