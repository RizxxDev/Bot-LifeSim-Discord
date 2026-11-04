const { SlashCommandBuilder, ButtonStyle } = require('discord.js');
const { getItem } = require('../../data/items');
const { formatLp } = require('../../utils/uiBuilder');
const {
    confirmView,
    numberModal,
    parseModalNumber
} = require('../../utils/panelBuilder');
const {
    EXPENSIVE_PURCHASE_THRESHOLD,
    getEffectiveItemPrice,
    fetchShopState,
    buildShopPanel,
    executeItemPurchase,
    executeBackpackUpgrade,
    formatPurchaseBanner
} = require('../../services/shopService');

async function handleBuyFlow(interaction, shopId, page, itemId, qty, now = Date.now()) {
    const userId = interaction.user.id;
    const item = getItem(itemId);
    const state = await fetchShopState(userId, now);

    if (!item) {
        const payload = buildShopPanel({
            state,
            shopId,
            page,
            banner: { type: 'danger', text: 'Barang tidak ditemukan.' },
            now
        });
        return interaction.isFromMessage() ? await interaction.update(payload) : await interaction.reply(payload);
    }

    const finalQty = item.stackSize === 0 ? 1 : qty;
    const unitPrice = getEffectiveItemPrice(item, state.liveCfg);
    const totalCost = unitPrice * finalQty;
    const totalBalance = Number(state.player.cash) + Number(state.player.bank);

    // Konfirmasi 2-Langkah untuk pembelian mahal (>= Lp 1.000.000) bila saldo mencukupi
    if (totalCost >= EXPENSIVE_PURCHASE_THRESHOLD && totalBalance >= totalCost) {
        const confirmPayload = confirmView({
            mod: 'shop',
            confirmAction: 'buy_confirm',
            cancelAction: 'buy_cancel',
            ownerId: userId,
            title: '💳 Konfirmasi Pembelian Bernilai Besar',
            description: [
                `Kamu akan membeli **${finalQty}× ${item.emoji} ${item.name}** dengan rincian:`,
                `• Harga Satuan: **${formatLp(unitPrice)}**\n• Total Pembayaran: **${formatLp(totalCost)}**\n• Saldo Cash + Bank: **${formatLp(totalBalance)}**`,
                'Apakah kamu yakin ingin melanjutkan transaksi ini?'
            ],
            confirmLabel: `Ya, Beli (${formatLp(totalCost)})`,
            confirmStyle: ButtonStyle.Success,
            arg: `${shopId}:${page}:${item.id}:${finalQty}`,
            cancelArg: `${shopId}:${page}:${item.id}`,
            player: state.player,
            now
        });
        return interaction.isFromMessage()
            ? await interaction.update(confirmPayload)
            : await interaction.reply(confirmPayload);
    }

    const res = await executeItemPurchase(userId, item.id, finalQty, now);
    const updatedState = await fetchShopState(userId, now);
    const payload = buildShopPanel({
        state: updatedState,
        shopId,
        page,
        selectedItemId: item.id,
        banner: formatPurchaseBanner(res),
        now
    });

    return interaction.isFromMessage() ? await interaction.update(payload) : await interaction.reply(payload);
}

module.exports = {
    name: 'shop',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Buka katalog Toko Kota untuk membeli makanan, alat, benih, elektronik, atau upgrade tas.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchShopState(interaction.user.id, now);
        return await interaction.reply(
            buildShopPanel({
                state,
                shopId: 'warung',
                page: 1,
                now
            })
        );
    },

    panel: {
        buttons: {
            async page(interaction, parsed) {
                const now = Date.now();
                const [shopId = 'warung', rawPage = '1'] = (parsed.arg || '').split(':');
                const state = await fetchShopState(interaction.user.id, now);
                return await interaction.update(
                    buildShopPanel({
                        state,
                        shopId,
                        page: Number(rawPage) || 1,
                        now
                    })
                );
            },
            async buy(interaction, parsed) {
                const now = Date.now();
                const [shopId = 'warung', rawPage = '1', itemId = '', rawQty = '1'] = (parsed.arg || '').split(':');
                const qty = rawQty === 'max' ? 20 : Number(rawQty) || 1;
                return await handleBuyFlow(interaction, shopId, Number(rawPage) || 1, itemId, qty, now);
            },
            async buy_confirm(interaction, parsed) {
                const now = Date.now();
                const [shopId = 'warung', rawPage = '1', itemId = '', rawQty = '1'] = (parsed.arg || '').split(':');
                const qty = Number(rawQty) || 1;
                const res = await executeItemPurchase(interaction.user.id, itemId, qty, now);
                const state = await fetchShopState(interaction.user.id, now);
                return await interaction.update(
                    buildShopPanel({
                        state,
                        shopId,
                        page: Number(rawPage) || 1,
                        selectedItemId: itemId,
                        banner: formatPurchaseBanner(res),
                        now
                    })
                );
            },
            async buy_cancel(interaction, parsed) {
                const now = Date.now();
                const [shopId = 'warung', rawPage = '1', itemId = ''] = (parsed.arg || '').split(':');
                const state = await fetchShopState(interaction.user.id, now);
                return await interaction.update(
                    buildShopPanel({
                        state,
                        shopId,
                        page: Number(rawPage) || 1,
                        selectedItemId: itemId,
                        banner: { type: 'info', text: 'Transaksi pembelian dibatalkan.' },
                        now
                    })
                );
            },
            async buy_modal(interaction, parsed) {
                const now = Date.now();
                const [shopId = 'warung', rawPage = '1', itemId = ''] = (parsed.arg || '').split(':');
                const item = getItem(itemId);
                return await interaction.showModal(
                    numberModal('shop', 'buy_submit', interaction.user.id, {
                        title: `Beli ${item ? item.name : 'Barang'}`,
                        label: 'Jumlah yang ingin dibeli (1 - 100)',
                        placeholder: 'Contoh: 15',
                        maxLength: 3,
                        arg: `${shopId}:${rawPage}:${itemId}`
                    }, now)
                );
            },
            async upgrade_bag(interaction) {
                const now = Date.now();
                const res = await executeBackpackUpgrade(interaction.user.id, now);
                const state = await fetchShopState(interaction.user.id, now);

                let banner = null;
                if (res.error === 'MAX_TIER') {
                    banner = { type: 'info', text: `Kapasitas tasmu sudah di tier tertinggi (**${res.currentBag.name}**).` };
                } else if (res.error === 'INSUFFICIENT_FUNDS') {
                    banner = {
                        type: 'danger',
                        text: `Saldo tidak cukup! Harga upgrade ke **${res.nextBag.name}** adalah **${formatLp(res.nextBag.price)}**.`
                    };
                } else {
                    banner = {
                        type: 'success',
                        text: `🎒 Tas berhasil di-upgrade ke **${res.nextBag.emoji} ${res.nextBag.name} (${res.nextBag.slots} slot)** seharga **${formatLp(res.nextBag.price)}**!`
                    };
                }

                return await interaction.update(
                    buildShopPanel({
                        state,
                        shopId: 'perkakas',
                        page: 1,
                        banner,
                        now
                    })
                );
            }
        },
        selects: {
            async store(interaction) {
                const now = Date.now();
                const shopId = interaction.values[0] || 'warung';
                const state = await fetchShopState(interaction.user.id, now);
                return await interaction.update(
                    buildShopPanel({
                        state,
                        shopId,
                        page: 1,
                        now
                    })
                );
            },
            async item(interaction) {
                const now = Date.now();
                const [shopId = 'warung', rawPage = '1', itemId = ''] = (interaction.values[0] || '').split(':');
                const state = await fetchShopState(interaction.user.id, now);
                return await interaction.update(
                    buildShopPanel({
                        state,
                        shopId,
                        page: Number(rawPage) || 1,
                        selectedItemId: itemId,
                        now
                    })
                );
            }
        },
        modals: {
            async buy_submit(interaction, parsed) {
                const now = Date.now();
                const [shopId = 'warung', rawPage = '1', itemId = ''] = (parsed.arg || '').split(':');
                const parsedNum = parseModalNumber(interaction, { min: 1, max: 100 });

                if (!parsedNum.ok) {
                    const state = await fetchShopState(interaction.user.id, now);
                    const payload = buildShopPanel({
                        state,
                        shopId,
                        page: Number(rawPage) || 1,
                        selectedItemId: itemId,
                        banner: { type: 'warning', text: parsedNum.error },
                        now
                    });
                    return interaction.isFromMessage() ? await interaction.update(payload) : await interaction.reply(payload);
                }

                return await handleBuyFlow(interaction, shopId, Number(rawPage) || 1, itemId, parsedNum.value, now);
            }
        }
    }
};
