const { ButtonStyle } = require('discord.js');
const { withTransaction } = require('../database/mariadb');
const { syncPlayerVitals } = require('./vitalService');
const { getPlayerInventory, canFitItems, addItem, calculateSlotsUsed } = require('./inventoryService');
const { debitPlayerFunds, getLiveEconomyConfig } = require('./economyService');
const { getPlayerOwnedClothingIds, grantClothing } = require('./avatarService');
const { SHOPS, getItem, getItemsByShop } = require('../data/items');
const { getBackpackByTier, getNextBackpackTier } = require('../data/backpacks');
const { COLORS, formatLp } = require('../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select,
    quantityRow,
    pageRow
} = require('../utils/panelBuilder');

const ITEMS_PER_PAGE = 5;
const EXPENSIVE_PURCHASE_THRESHOLD = 1000000;

function getEffectiveItemPrice(item, liveConfig = {}) {
    if (!item) return 0;
    if (item.lockedPrice) return item.buyPrice;
    const overrides = liveConfig.price_overrides || {};
    if (overrides[item.id] !== undefined && Number(overrides[item.id]) > 0) {
        return Number(overrides[item.id]);
    }
    return item.buyPrice;
}

async function fetchShopState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const ownedClothes = await getPlayerOwnedClothingIds(conn, discordId, false);
        const liveCfg = await getLiveEconomyConfig(conn);
        return {
            player: synced.player,
            invRows,
            ownedClothes,
            slotsUsed: calculateSlotsUsed(invRows),
            liveCfg
        };
    });
}

function buildShopPanel({
    state,
    shopId = 'warung',
    page = 1,
    selectedItemId = null,
    banner = null,
    now = Date.now()
}) {
    const { player: p, slotsUsed, liveCfg } = state;
    const ownedClothes = state.ownedClothes || new Set();
    const ownerId = p.discord_id;
    const shop = SHOPS.find(s => s.id === shopId) || SHOPS[0];
    const allItems = getItemsByShop(shop.id);

    const totalPages = Math.max(1, Math.ceil(allItems.length / ITEMS_PER_PAGE));
    const safePage = Math.max(1, Math.min(totalPages, Number(page) || 1));
    const pageItems = allItems.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

    const activeItem = allItems.find(it => it.id === selectedItemId) || pageItems[0] || allItems[0] || null;
    const activeItemId = activeItem ? activeItem.id : null;

    const blocks = [
        `${shop.description}\n🎒 **Kapasitas Tas:** \`${slotsUsed}/${p.max_slots} slot terpakai\``
    ];

    const extraNavBtns = [];

    if (shop.id === 'perkakas') {
        const curBag = getBackpackByTier(p.backpack_tier);
        const nextBag = getNextBackpackTier(p.backpack_tier);
        if (nextBag) {
            blocks.push(
                `🎒 **Upgrade Kapasitas Tas:** ${curBag.name} (${curBag.slots} slot) ➡️ **${nextBag.emoji} ${nextBag.name} (${nextBag.slots} slot)** — **${formatLp(nextBag.price)}**`
            );
            extraNavBtns.push(
                btn('shop', 'upgrade_bag', ownerId, {
                    label: `Upgrade Tas (${formatLp(nextBag.price)})`,
                    emoji: '🎒',
                    style: ButtonStyle.Success
                }, now)
            );
        } else {
            blocks.push(
                `🎒 **Kapasitas Tas Maksimal:** Kamu sudah memiliki **${curBag.emoji} ${curBag.name} (${curBag.slots} slot)**!`
            );
        }
    }

    if (shop.id === 'busana') {
        blocks.push(
            `👔 **Lemari Pakaian (\`/wardrobe\`):** Pakaian yang dibeli langsung masuk ke lemarimu (**0 slot tas**) dan bisa dicoba kapan saja di \`/wardrobe\`!`
        );
    }

    const itemLines = pageItems.map(item => {
        const price = getEffectiveItemPrice(item, liveCfg);
        const isSel = item.id === activeItemId;
        const pointer = isSel ? '▶️ ' : '• ';
        const isClothingOwned = item.tags?.includes('clothing') && ownedClothes.has(item.id);
        const slotNote = item.tags?.includes('clothing')
            ? (isClothingOwned ? '✅ Sudah di Lemari' : 'Lemari /wardrobe')
            : item.stackSize === 0
                ? '0 slot'
                : item.maxDurability
                    ? `1 slot/unit · Dur ${item.maxDurability}`
                    : `${item.stackSize}/slot`;
        return `${pointer}${item.emoji} **${item.name}** — **${formatLp(price)}** *(${slotNote})*\n  -# ${item.description}`;
    });

    blocks.push(itemLines.join('\n'));

    // Row 1: Pilih Toko
    const rows = [
        select('shop', 'store', ownerId, {
            placeholder: '🏪 Pilih Toko...',
            options: SHOPS.map(s => ({
                label: s.name,
                value: s.id,
                emoji: s.emoji,
                description: s.description.slice(0, 95),
                default: s.id === shop.id
            }))
        }, now)
    ];

    // Row 2: Pilih Barang di Toko Ini
    if (allItems.length > 0) {
        rows.push(
            select('shop', 'item', ownerId, {
                placeholder: '🛒 Pilih barang yang ingin dibeli...',
                options: allItems.map(it => {
                    const price = getEffectiveItemPrice(it, liveCfg);
                    return {
                        label: `${it.name} — ${formatLp(price)}`,
                        value: `${shop.id}:${safePage}:${it.id}`,
                        emoji: it.emoji,
                        description: it.description.slice(0, 95),
                        default: it.id === activeItemId
                    };
                })
            }, now)
        );
    }

    // Row 3: Tombol Kuantitas Cepat untuk Barang Terpilih
    if (activeItem) {
        const isSingleOnly = activeItem.stackSize === 0 || Boolean(activeItem.maxDurability);
        rows.push(
            quantityRow('shop', 'buy', ownerId, {
                presets: [1, 5, 10],
                maxLabel: '×20',
                argPrefix: `${shop.id}:${safePage}:${activeItem.id}`,
                customAction: 'buy_modal',
                disableMulti: isSingleOnly
            }, now)
        );
    }

    // Row 4: Navigasi Halaman + Tombol Upgrade Tas (jika ada)
    if (totalPages > 1 || extraNavBtns.length > 0) {
        rows.push(
            pageRow('shop', 'page', ownerId, {
                page: safePage,
                totalPages,
                argPrefix: shop.id,
                extraButtons: extraNavBtns
            }, now)
        );
    }

    return buildPanel({
        mod: 'shop',
        ownerId,
        accentColor: COLORS.ECONOMY,
        title: `${shop.emoji} ${shop.name}`,
        player: p,
        banner,
        blocks,
        rows,
        footer: `Halaman ${safePage}/${totalPages} · Pembayaran otomatis mendebit Cash lalu Bank bila kurang.`,
        now
    });
}

async function buildShopViewPayload(discordId, shopId = 'warung', page = 0, _ephemeral = false, now = Date.now()) {
    const state = await fetchShopState(discordId, now);
    return buildShopPanel({
        state,
        shopId,
        page: Number(page || 0) + 1,
        now
    });
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
        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
        const liveCfg = await getLiveEconomyConfig(conn);

        const unitPrice = getEffectiveItemPrice(item, liveCfg);
        const totalCost = unitPrice * qty;

        // Jika pakaian (/wardrobe), cek kepemilikan di player_clothes
        const isClothingItem = Boolean(item.tags && item.tags.includes('clothing'));
        if (isClothingItem) {
            const ownedClothes = await getPlayerOwnedClothingIds(conn, discordId, true);
            if (ownedClothes.has(item.id)) {
                return { error: 'ALREADY_OWNED_UNIQUE', item, player: p };
            }
        } else if (item.stackSize === 0 && item.id !== 'izin_melaut') {
            // Jika item non-stackable unik (SIM C, Laptop, Gelar Prestise), cek apakah sudah punya
            const alreadyHas = invRows.some(r => r.item_id === item.id && Number(r.quantity) > 0);
            if (alreadyHas) {
                return { error: 'ALREADY_OWNED_UNIQUE', item, player: p };
            }
        }

        const fitCheck = isClothingItem
            ? { fits: true, slotsBefore: calculateSlotsUsed(invRows), slotsAfter: calculateSlotsUsed(invRows), maxSlots: p.max_slots }
            : canFitItems(invRows, p.max_slots, [{ itemId: item.id, qty }]);
        if (!fitCheck.fits) {
            return {
                error: 'BAG_FULL',
                slotsBefore: fitCheck.slotsBefore,
                slotsAfter: fitCheck.slotsAfter,
                maxSlots: fitCheck.maxSlots,
                player: p
            };
        }

        const totalBalance = Number(p.cash) + Number(p.bank);
        if (totalBalance < totalCost) {
            return { error: 'INSUFFICIENT_FUNDS', totalCost, totalBalance, player: p };
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

        // Khusus gelar prestise: langsung pasang ke profil
        if (item.tags && item.tags.includes('prestise') && item.titleLabel) {
            await conn.execute(
                `UPDATE players SET equipped_title = ? WHERE discord_id = ?`,
                [item.titleLabel, discordId]
            );
            p.equipped_title = item.titleLabel;
        }

        let autoEquippedClothing = false;
        if (isClothingItem) {
            const grantRes = await grantClothing(conn, discordId, item.id, true, now);
            autoEquippedClothing = Boolean(grantRes.autoEquipped);
        } else {
            await addItem(conn, discordId, item.id, qty, now, 'bag');
        }

        return {
            ok: true,
            item,
            qty,
            unitPrice,
            totalCost,
            payment,
            autoEquippedClothing,
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
            return { error: 'MAX_TIER', currentBag: getBackpackByTier(p.backpack_tier), player: p };
        }

        const totalBalance = Number(p.cash) + Number(p.bank);
        if (totalBalance < nextBag.price) {
            return { error: 'INSUFFICIENT_FUNDS', nextBag, totalBalance, player: p };
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
            ok: true,
            nextBag,
            payment,
            player: p
        };
    });
}

function formatPurchaseBanner(res) {
    if (res.error === 'ITEM_NOT_BUYABLE') {
        return { type: 'danger', text: 'Barang tersebut tidak tersedia di toko.' };
    }
    if (res.error === 'ALREADY_OWNED_UNIQUE') {
        return { type: 'warning', text: `Kamu sudah memiliki **${res.item.emoji} ${res.item.name}** secara permanen!` };
    }
    if (res.error === 'BAG_FULL') {
        return {
            type: 'warning',
            text: `Kapasitas tas tidak cukup! Butuh **${res.slotsAfter}/${res.maxSlots} slot**. Jual sebagian barang di \`/sell\` atau upgrade tasmu.`
        };
    }
    if (res.error === 'INSUFFICIENT_FUNDS') {
        return {
            type: 'danger',
            text: `Saldo tidak cukup! Harga **${formatLp(res.totalCost)}**, sedangkan Cash + Bank kamu **${formatLp(res.totalBalance)}**.`
        };
    }

    let extra = '';
    if (res.item.id === 'izin_melaut') {
        extra = ' *(⚓ Izin Melaut 24j aktif)*';
    } else if (res.item.tags && res.item.tags.includes('clothing')) {
        extra = res.autoEquippedClothing
            ? ' *(👔 Masuk ke `/wardrobe` & langsung dikenakan ke karaktermu!)*'
            : ' *(👔 Tersimpan di `/wardrobe` — buka `/wardrobe` untuk mengganti gaya!)*';
    }
    return {
        type: 'success',
        text: `Berhasil membeli **${res.qty}× ${res.item.emoji} ${res.item.name}** seharga **${formatLp(res.totalCost)}**!${extra}`
    };
}

module.exports = {
    ITEMS_PER_PAGE,
    EXPENSIVE_PURCHASE_THRESHOLD,
    getEffectiveItemPrice,
    fetchShopState,
    buildShopPanel,
    buildShopViewPayload,
    executeItemPurchase,
    executeBackpackUpgrade,
    formatPurchaseBanner
};
