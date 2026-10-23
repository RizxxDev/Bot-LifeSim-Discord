const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { withTransaction } = require('../database/mariadb');
const { syncPlayerVitals } = require('./vitalService');
const { getPlayerInventory, canFitItems, addItem, calculateSlotsUsed } = require('./inventoryService');
const { debitPlayerFunds, getLiveEconomyConfig } = require('./economyService');
const { SHOPS, getItem, getItemsByShop } = require('../data/items');
const { getBackpackByTier, getNextBackpackTier } = require('../data/backpacks');
const { COLORS, formatLp, buildV2Card } = require('../utils/uiBuilder');

const ITEMS_PER_PAGE = 5;

function getEffectiveItemPrice(item, liveConfig = {}) {
    if (!item) return 0;
    if (item.lockedPrice) return item.buyPrice;
    const overrides = liveConfig.price_overrides || {};
    if (overrides[item.id] !== undefined && Number(overrides[item.id]) > 0) {
        return Number(overrides[item.id]);
    }
    return item.buyPrice;
}

async function buildShopViewPayload(discordId, shopId = 'warung', page = 0, ephemeral = false) {
    const shop = SHOPS.find(s => s.id === shopId) || SHOPS[0];
    const allItems = getItemsByShop(shop.id);

    const data = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, Date.now(), false);
        const invRows = await getPlayerInventory(conn, discordId, false);
        const liveCfg = await getLiveEconomyConfig(conn);
        return {
            player: synced.player,
            slotsUsed: calculateSlotsUsed(invRows),
            liveCfg
        };
    });

    const { player: p, slotsUsed, liveCfg } = data;
    const totalPages = Math.max(1, Math.ceil(allItems.length / ITEMS_PER_PAGE));
    const safePage = Math.max(0, Math.min(totalPages - 1, Number(page || 0)));
    const pageItems = allItems.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);

    const blocks = [
        `${shop.description}\n💵 **Cash:** ${formatLp(p.cash)} · 🏦 **Bank:** ${formatLp(p.bank)} · 🎒 **Tas:** \`${slotsUsed}/${p.max_slots} slot\``
    ];

    // Jika di Toko Perkakas halaman 1, tampilkan penawaran Upgrade Tas di bagian atas
    if (shop.id === 'perkakas' && safePage === 0) {
        const curBag = getBackpackByTier(p.backpack_tier);
        const nextBag = getNextBackpackTier(p.backpack_tier);
        if (nextBag) {
            blocks.push({
                text: `🎒 **Upgrade Kapasitas Tas:** ${curBag.name} (${curBag.slots} slot) ➡️ **${nextBag.emoji} ${nextBag.name} (${nextBag.slots} slot)**\nHarga Upgrade: **${formatLp(nextBag.price)}** — *${nextBag.description}*`,
                button: new ButtonBuilder()
                    .setCustomId('shop_upgrade_bag')
                    .setLabel(`Upgrade (${formatLp(nextBag.price)})`)
                    .setEmoji('🎒')
                    .setStyle(ButtonStyle.Success),
                separatorAfter: true
            });
        } else {
            blocks.push({
                text: `🎒 **Kapasitas Tas Maksimal:** Kamu sudah memiliki **${curBag.emoji} ${curBag.name} (${curBag.slots} slot)**!`,
                separatorAfter: true
            });
        }
    }

    for (const item of pageItems) {
        const price = getEffectiveItemPrice(item, liveCfg);
        const slotNote = item.stackSize === 0
            ? 'Tidak makan slot'
            : item.maxDurability
                ? `1 slot/unit · Durabilitas ${item.maxDurability}`
                : `Maks ${item.stackSize}/slot`;

        blocks.push({
            text: `${item.emoji} **${item.name}** (\`${item.id}\`) — **${formatLp(price)}**\n${item.description}\n-# 📦 ${slotNote}`,
            button: new ButtonBuilder()
                .setCustomId(`shop_pick_${item.id}`)
                .setLabel('Beli')
                .setEmoji('🛒')
                .setStyle(ButtonStyle.Primary)
        });
    }

    // Select Menu Toko
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('shop_select_store')
        .setPlaceholder('🏪 Pilih Toko...')
        .addOptions(
            SHOPS.map(s => ({
                label: s.name,
                value: s.id,
                emoji: s.emoji,
                description: s.description.slice(0, 95),
                default: s.id === shop.id
            }))
        );

    const actionRows = [new ActionRowBuilder().addComponents(selectMenu)];

    if (totalPages > 1) {
        const navRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`shop_page_${shop.id}_${safePage - 1}`)
                .setLabel('Sebelumnya')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage <= 0),
            new ButtonBuilder()
                .setCustomId(`shop_page_${shop.id}_${safePage + 1}`)
                .setLabel(`Halaman ${safePage + 1}/${totalPages}`)
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage >= totalPages - 1)
        );
        actionRows.push(navRow);
    }

    return buildV2Card({
        accentColor: COLORS.ECONOMY,
        title: `${shop.emoji} ${shop.name}`,
        blocks,
        actionRows,
        footer: `Halaman ${safePage + 1} dari ${totalPages} · Tips: Gunakan /buy item:<nama> untuk beli cepat.`,
        ephemeral
    });
}

function buildItemQuantityPickerPayload(item, unitPrice) {
    const qtyRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`shop_execbuy_${item.id}_1`)
            .setLabel(`Beli ×1 (${formatLp(unitPrice)})`)
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`shop_execbuy_${item.id}_5`)
            .setLabel(`Beli ×5 (${formatLp(unitPrice * 5)})`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(item.stackSize === 0 || item.maxDurability > 0),
        new ButtonBuilder()
            .setCustomId(`shop_execbuy_${item.id}_10`)
            .setLabel(`Beli ×10 (${formatLp(unitPrice * 10)})`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(item.stackSize === 0 || item.maxDurability > 0),
        new ButtonBuilder()
            .setCustomId(`shop_modalbuy_${item.id}`)
            .setLabel('Jumlah Lain...')
            .setEmoji('🔢')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(item.stackSize === 0)
    );

    return buildV2Card({
        accentColor: COLORS.ECONOMY,
        title: `🛒 Beli ${item.emoji} ${item.name}`,
        blocks: [
            `${item.description}\n• 💰 **Harga Satuan:** **${formatLp(unitPrice)}**`,
            'Pilih jumlah yang ingin kamu beli di bawah ini:'
        ],
        actionRows: [qtyRow],
        ephemeral: true
    });
}

function buildCustomBuyModal(item) {
    const modal = new ModalBuilder()
        .setCustomId(`shop_modalsubmit_${item.id}`)
        .setTitle(`Beli ${item.name}`.slice(0, 45));

    const input = new TextInputBuilder()
        .setCustomId('buy_amount_input')
        .setLabel('Jumlah yang ingin dibeli (1 - 100)')
        .setPlaceholder('Contoh: 15')
        .setMinLength(1)
        .setMaxLength(3)
        .setRequired(true)
        .setStyle(TextInputStyle.Short);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return modal;
}

/**
 * Menjalankan pembelian item secara atomik (mendukung auto-debit Cash lalu Bank, cek kapasitas slot tas, dan kepemilikan tunggal untuk lisensi/prestise).
 */
async function executeItemPurchase(discordId, itemId, quantity = 1, now = Date.now()) {
    const item = getItem(itemId);
    if (!item || !item.buyPrice || !item.shop) {
        return { error: 'ITEM_NOT_BUYABLE' };
    }

    const qty = (item.stackSize === 0) ? 1 : Math.max(1, Math.min(100, Math.floor(Number(quantity || 1))));

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, true);
        const liveCfg = await getLiveEconomyConfig(conn);

        const unitPrice = getEffectiveItemPrice(item, liveCfg);
        const totalCost = unitPrice * qty;

        // Jika item non-stackable unik (SIM C, Laptop, Gelar Prestise), cek apakah sudah punya
        if (item.stackSize === 0 && item.id !== 'izin_melaut') {
            const alreadyHas = invRows.some(r => r.item_id === item.id && Number(r.quantity) > 0);
            if (alreadyHas) {
                return { error: 'ALREADY_OWNED_UNIQUE', item };
            }
        }

        const fitCheck = canFitItems(invRows, p.max_slots, [{ itemId: item.id, qty }]);
        if (!fitCheck.fits) {
            return {
                error: 'BAG_FULL',
                slotsBefore: fitCheck.slotsBefore,
                slotsAfter: fitCheck.slotsAfter,
                maxSlots: fitCheck.maxSlots
            };
        }

        const totalBalance = Number(p.cash) + Number(p.bank);
        if (totalBalance < totalCost) {
            return { error: 'INSUFFICIENT_FUNDS', totalCost, totalBalance };
        }

        const payment = await debitPlayerFunds(conn, p, totalCost, `buy_${item.id}`, {
            itemId: item.id,
            qty,
            unitPrice
        }, now);

        // Khusus izin_melaut: langsung aktifkan juga buff sea_permit 24 jam agar praktis
        if (item.id === 'izin_melaut') {
            const expiresAt = now + 86400000;
            await conn.execute(
                `INSERT INTO player_buffs (discord_id, buff_type, multiplier, expires_at)
                 VALUES (?, 'sea_permit', 1.0, ?)
                 ON DUPLICATE KEY UPDATE expires_at = GREATEST(expires_at, ?)`,
                [discordId, expiresAt, expiresAt]
            );
        }

        // Khusus gelar prestise: langsung pasang ke profil jika belum punya gelar
        if (item.tags.includes('prestise') && item.titleLabel) {
            await conn.execute(
                `UPDATE players SET equipped_title = ? WHERE discord_id = ?`,
                [item.titleLabel, discordId]
            );
            p.equipped_title = item.titleLabel;
        }

        await addItem(conn, discordId, item.id, qty, now);

        return {
            item,
            qty,
            unitPrice,
            totalCost,
            payment,
            slotsAfter: fitCheck.slotsAfter,
            maxSlots: fitCheck.maxSlots,
            player: p
        };
    });
}

async function executeBackpackUpgrade(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const nextBag = getNextBackpackTier(p.backpack_tier);

        if (!nextBag) {
            return { error: 'MAX_TIER', currentBag: getBackpackByTier(p.backpack_tier) };
        }

        const totalBalance = Number(p.cash) + Number(p.bank);
        if (totalBalance < nextBag.price) {
            return { error: 'INSUFFICIENT_FUNDS', nextBag, totalBalance };
        }

        const payment = await debitPlayerFunds(conn, p, nextBag.price, `upgrade_bag_${nextBag.id}`, {
            fromTier: p.backpack_tier,
            toTier: nextBag.tier
        }, now);

        p.backpack_tier = nextBag.tier;
        p.max_slots = nextBag.slots;

        await conn.execute(
            `UPDATE players SET backpack_tier = ?, max_slots = ? WHERE discord_id = ?`,
            [p.backpack_tier, p.max_slots, discordId]
        );

        return {
            nextBag,
            payment,
            player: p
        };
    });
}

function buildPurchaseResultPayload(res, ephemeral = false) {
    if (res.error === 'ITEM_NOT_BUYABLE') {
        return buildV2Card({
            accentColor: COLORS.DANGER,
            title: '❌ Barang Tidak Tersedia',
            blocks: ['Item tersebut tidak dijual di toko.'],
            ephemeral: true
        });
    }
    if (res.error === 'ALREADY_OWNED_UNIQUE') {
        return buildV2Card({
            accentColor: COLORS.WARNING,
            title: 'ℹ️ Sudah Dimiliki',
            blocks: [`Kamu sudah memiliki **${res.item.emoji} ${res.item.name}** secara permanen!`],
            ephemeral: true
        });
    }
    if (res.error === 'BAG_FULL') {
        return buildV2Card({
            accentColor: COLORS.WARNING,
            title: `🎒 Kapasitas Tas Tidak Cukup (${res.slotsBefore}/${res.maxSlots} Slot)`,
            blocks: [
                `Pembelian ini membutuhkan **${res.slotsAfter} slot**, melebihi kapasitas tasmu (**${res.maxSlots} slot**).`,
                'Jual sebagian barang di `/sell` atau upgrade tasmu di Toko Perkakas (`/shop`).'
            ],
            ephemeral: true
        });
    }
    if (res.error === 'INSUFFICIENT_FUNDS') {
        return buildV2Card({
            accentColor: COLORS.DANGER,
            title: '💸 Saldo Tidak Cukup',
            blocks: [
                `Total harga pembelian adalah **${formatLp(res.totalCost)}**, sedangkan total Cash + Bank kamu hanya **${formatLp(res.totalBalance)}**.`
            ],
            ephemeral: true
        });
    }

    const payBreakdown = [];
    if (res.payment.fromCash > 0) payBreakdown.push(`Cash: ${formatLp(res.payment.fromCash)}`);
    if (res.payment.fromBank > 0) payBreakdown.push(`Auto-Debit Bank: ${formatLp(res.payment.fromBank)}`);

    return buildV2Card({
        accentColor: COLORS.SUCCESS,
        title: `🛍️ Pembelian Berhasil: ${res.qty}× ${res.item.emoji} ${res.item.name}`,
        blocks: [
            [
                `• 💳 **Total Dibayar:** **${formatLp(res.totalCost)}** *(${payBreakdown.join(' + ')})*`,
                `• 💵 **Sisa Cash:** ${formatLp(res.player.cash)} · 🏦 **Sisa Bank:** ${formatLp(res.player.bank)}`,
                `• 🎒 **Slot Tas Terpakai:** \`${res.slotsAfter} / ${res.maxSlots} slot\``
            ].join('\n'),
            res.item.id === 'izin_melaut'
                ? '⚓ **Surat Izin Melaut 24 Jam** juga telah langsung diaktifkan untukmu!'
                : null
        ],
        ephemeral
    });
}

module.exports = {
    getEffectiveItemPrice,
    buildShopViewPayload,
    buildItemQuantityPickerPayload,
    buildCustomBuyModal,
    executeItemPurchase,
    executeBackpackUpgrade,
    buildPurchaseResultPayload
};
