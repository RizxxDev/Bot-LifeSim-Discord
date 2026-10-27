const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getLiveEconomyConfig } = require('../../services/economyService');
const {
    getEffectiveItemPrice,
    executeItemPurchase,
    executeBackpackUpgrade,
    buildPurchaseResultPayload
} = require('../../services/shopService');
const { getBuyableItems, getItem } = require('../../data/items');
const { COLORS, formatLp, buildV2Card } = require('../../utils/uiBuilder');

module.exports = {
    name: 'buy',
    slash: true,
    lockTtl: 45,
    data: new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Beli barang secara cepat menggunakan fitur autocomplete.')
        .addStringOption(opt =>
            opt
                .setName('item')
                .setDescription('Ketik nama barang yang ingin dibeli (atau "upgrade_tas")')
                .setAutocomplete(true)
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt
                .setName('amount')
                .setDescription('Jumlah barang yang ingin dibeli (default 1)')
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(false)
        ),

    async autocomplete(interaction) {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        const items = getBuyableItems();

        const choices = [];
        if ('upgrade_tas backpack tas'.includes(focused)) {
            choices.push({
                name: '🎒 Upgrade Kapasitas Tas (Naik ke Tier Berikutnya)',
                value: 'upgrade_tas'
            });
        }

        for (const it of items) {
            const target = `${it.id} ${it.name} ${it.shop}`.toLowerCase();
            if (!focused || target.includes(focused)) {
                choices.push({
                    name: `${it.name} — ${formatLp(it.buyPrice)} (${it.shop})`.slice(0, 100),
                    value: it.id
                });
            }
            if (choices.length >= 25) break;
        }

        await interaction.respond(choices);
    },

    async executeSlash(interaction) {
        const discordId = interaction.user.id;
        const itemId = interaction.options.getString('item', true).toLowerCase();
        const rawQty = interaction.options.getInteger('amount') || 1;

        if (itemId === 'upgrade_tas') {
            const res = await executeBackpackUpgrade(discordId, Date.now());
            if (res.error === 'MAX_TIER') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.SUCCESS,
                        title: '🎒 Kapasitas Tas Sudah Maksimal!',
                        blocks: [`Kamu sudah memiliki **${res.currentBag.emoji} ${res.currentBag.name} (${res.currentBag.slots} slot)**.`],
                        ephemeral: true
                    })
                );
            }
            if (res.error === 'INSUFFICIENT_FUNDS') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.DANGER,
                        title: '💸 Saldo Tidak Cukup untuk Upgrade Tas',
                        blocks: [
                            `Harga upgrade ke **${res.nextBag.emoji} ${res.nextBag.name} (${res.nextBag.slots} slot)** adalah **${formatLp(res.nextBag.price)}**, sedangkan saldo Cash + Bank kamu **${formatLp(res.totalBalance)}**.`
                        ],
                        ephemeral: true
                    })
                );
            }

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `🎒 Tas Di-upgrade: ${res.nextBag.emoji} ${res.nextBag.name}!`,
                    blocks: [
                        `Kapasitas tasmu kini meningkat menjadi **${res.nextBag.slots} slot**!`,
                        `• 💳 **Biaya Upgrade:** ${formatLp(res.nextBag.price)}\n• 💵 **Sisa Cash:** ${formatLp(res.player.cash)} · 🏦 **Sisa Bank:** ${formatLp(res.player.bank)}`
                    ]
                })
            );
        }

        const item = getItem(itemId);
        if (!item || !item.buyPrice || !item.shop) {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '❌ Barang Tidak Ditemukan',
                    blocks: ['Pilih barang dari daftar autocomplete atau buka katalog `/shop`.'],
                    ephemeral: true
                })
            );
        }

        const qty = item.stackSize === 0 ? 1 : rawQty;

        // Cek apakah perlu konfirmasi (total > Lp 500.000 atau > 25% total saldo)
        const pre = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, Date.now(), false);
            const liveCfg = await getLiveEconomyConfig(conn);
            const unitPrice = getEffectiveItemPrice(item, liveCfg);
            return {
                player: synced.player,
                unitPrice,
                totalCost: unitPrice * qty
            };
        });

        const totalBalance = Number(pre.player.cash) + Number(pre.player.bank);
        const needsConfirmation = pre.totalCost > 500000 || (totalBalance > 0 && pre.totalCost > totalBalance * 0.25);

        if (needsConfirmation && totalBalance >= pre.totalCost) {
            const nonce = `${discordId.slice(-4)}_${Date.now().toString(36)}`;
            const confirmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`buy_confirm_${nonce}`)
                    .setLabel(`Ya, Beli (${formatLp(pre.totalCost)})`)
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`buy_cancel_${nonce}`)
                    .setLabel('Batal')
                    .setEmoji('✖️')
                    .setStyle(ButtonStyle.Secondary)
            );

            await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '💳 Konfirmasi Pembelian Bernilai Besar',
                    blocks: [
                        `Kamu akan membeli **${qty}× ${item.emoji} ${item.name}** seharga **${formatLp(pre.totalCost)}** (${formatLp(pre.unitPrice)} / unit).`,
                        `Saldo Cash + Bank kamu saat ini: **${formatLp(totalBalance)}**.\nKlik tombol di bawah dalam **30 detik** untuk melanjutkan.`
                    ],
                    actionRows: [confirmRow]
                })
            );
            const promptMsg = await interaction.fetchReply();

            try {
                const btnInt = await promptMsg.awaitMessageComponent({
                    filter: i => i.user.id === discordId && (i.customId === `buy_confirm_${nonce}` || i.customId === `buy_cancel_${nonce}`),
                    time: 30000
                });
                await btnInt.deferUpdate();

                if (btnInt.customId === `buy_cancel_${nonce}`) {
                    return await interaction.editReply(
                        buildV2Card({
                            accentColor: COLORS.PRIMARY,
                            title: '✖️ Pembelian Dibatalkan',
                            blocks: ['Transaksi dibatalkan, saldomu tidak berkurang.']
                        })
                    );
                }
            } catch {
                return await interaction.editReply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '⌛ Waktu Konfirmasi Habis',
                        blocks: ['Transaksi pembelian dibatalkan karena tidak dikonfirmasi dalam 30 detik.']
                    })
                );
            }

            const res = await executeItemPurchase(discordId, item.id, qty, Date.now());
            return await interaction.editReply(buildPurchaseResultPayload(res, false));
        }

        const res = await executeItemPurchase(discordId, item.id, qty, Date.now());
        return await interaction.reply(buildPurchaseResultPayload(res, Boolean(res.error)));
    }
};
