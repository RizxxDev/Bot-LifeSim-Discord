const { SlashCommandBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const {
    getPlayerInventory,
    calculateSlotsUsed,
    getDamagedTools,
    repairToolById
} = require('../../services/inventoryService');
const { getPlayerPropertyStatus } = require('../../services/propertyService');
const { formatFreshnessBadge } = require('../../services/spoilageService');
const { debitPlayerFunds } = require('../../services/economyService');
const { executeBackpackUpgrade } = require('../../services/shopService');
const { getItem } = require('../../data/items');
const { getBackpackByTier, getNextBackpackTier } = require('../../data/backpacks');
const { COLORS, formatLp, renderBar } = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select,
    paginate,
    pageRow
} = require('../../utils/panelBuilder');

const CATEGORIES = [
    { label: 'Semua Barang', value: 'semua', emoji: '📦', description: 'Tampilkan seluruh barang di tasmu' },
    { label: 'Peralatan & Umpan', value: 'alat', emoji: '🔧', description: 'Pancingan, beliung, penyiram, kompor, umpan' },
    { label: 'Makanan, Minuman & Obat', value: 'konsumsi', emoji: '🍱', description: 'Makanan, minuman, masakan, obat, benih, bahan' },
    { label: 'Hasil Pancingan & Tambang', value: 'hasil_alam', emoji: '🐟', description: 'Ikan, mineral tambang, dan hasil panen' },
    { label: 'Dokumen & Gelar Prestise', value: 'dokumen', emoji: '🪪', description: 'SIM, laptop, izin melaut, akta, dan gelar' }
];

async function fetchInventoryState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const propStatus = await getPlayerPropertyStatus(conn, discordId, synced.player.max_slots, now, false);
        const allRows = await getPlayerInventory(conn, discordId, false, 'all', now);
        return { player: synced.player, propStatus, allRows };
    });
}

function buildInventoryPanel({
    state,
    filterCat = 'semua',
    page = 1,
    banner = null,
    now = Date.now()
}) {
    const { player: p, propStatus, allRows } = state;
    const ownerId = p.discord_id;
    const invRows = allRows.filter(r => !r.storage_location || r.storage_location === 'bag');
    const storageRows = allRows.filter(r => r.storage_location && r.storage_location !== 'bag');

    const bag = getBackpackByTier(p.backpack_tier);
    const nextBag = getNextBackpackTier(p.backpack_tier);
    const slotsUsed = calculateSlotsUsed(invRows);
    const damagedTools = getDamagedTools(invRows);
    const totalRepairCost = damagedTools.reduce((acc, d) => acc + d.repairCost, 0);

    const entries = [];
    let expiringCount = 0;

    for (const row of invRows) {
        const qty = Number(row.quantity || 0);
        if (qty <= 0) continue;
        const it = getItem(row.item_id);
        if (!it) continue;

        let freshInfo = '';
        if (row.freshness_remaining_ms !== null && row.freshness_remaining_ms !== undefined) {
            const remMs = Number(row.freshness_remaining_ms);
            if (remMs < 12 * 3600000) expiringCount += qty;
            freshInfo = ` · *${formatFreshnessBadge(remMs, 'bag')}*`;
        }

        let cat = 'konsumsi';
        let line = '';

        if (it.maxDurability) {
            cat = 'alat';
            const dur = Number(row.durability ?? it.maxDurability);
            const status = dur <= 0 ? '🔴 **RUSAK**' : `Durability: \`${dur}/${it.maxDurability}\``;
            line = `• ${it.emoji} **${it.name}** — ${status}`;
        } else if (it.tags && it.tags.includes('bait')) {
            cat = 'alat';
            const slots = Math.ceil(qty / (it.stackSize || 100));
            line = `• ${it.emoji} **${it.name}** ×**${qty}** *(${slots} slot)*`;
        } else if (it.tags && (it.tags.includes('fish') || it.tags.includes('mineral') || it.tags.includes('trash') || it.tags.includes('crop'))) {
            cat = 'hasil_alam';
            const slots = Math.ceil(qty / (it.stackSize || 20));
            line = `• ${it.emoji} **${it.name}** ×**${qty}**${freshInfo} *(Dasar ${formatLp(it.sellPrice)} · ${slots} slot)*`;
        } else if (it.stackSize === 0 || (it.tags && (it.tags.includes('license') || it.tags.includes('prestise') || it.tags.includes('service')))) {
            cat = 'dokumen';
            line = `• ${it.emoji} **${it.name}** ×**${qty}** *(0 slot)*`;
        } else {
            cat = 'konsumsi';
            const slots = Math.ceil(qty / (it.stackSize || 20));
            line = `• ${it.emoji} **${it.name}** ×**${qty}**${freshInfo} *(${slots} slot)*`;
        }

        if (filterCat === 'semua' || filterCat === cat) {
            entries.push(line);
        }
    }

    const paged = paginate(entries, page, 10);

    const blocks = [
        `${bag.emoji} **${bag.name}** · Kapasitas: \`${renderBar(slotsUsed, p.max_slots, 10)}\` (**${slotsUsed}/${p.max_slots} slot terpakai**)`
    ];

    if (expiringCount > 0) {
        blocks.push(
            `⚠️ **Peringatan Kesegaran:** Ada **${expiringCount} item** di tasmu yang sisa kesegarannya **< 12 jam**! Segera konsumsi di \`/consume\`, jual di \`/sell\`, atau simpan ke \`/storage\`.`
        );
    }

    const activeCatObj = CATEGORIES.find(c => c.value === filterCat) || CATEGORIES[0];
    if (paged.slice.length > 0) {
        blocks.push(`**${activeCatObj.emoji} ${activeCatObj.label} (${paged.total} tumpukan):**\n${paged.slice.join('\n')}`);
    } else {
        blocks.push(`**${activeCatObj.emoji} ${activeCatObj.label}:**\n*Tidak ada barang dalam kategori ini di tasmu.*`);
    }

    if (storageRows.length > 0 || propStatus.effectiveTier.id !== 'tunawisma' || propStatus.hasCoolerBox) {
        const countLoc = loc => calculateSlotsUsed(storageRows.filter(r => r.storage_location === loc));
        const cap = propStatus.capacities;
        const storageSummary = [];
        if (cap.coolerbox > 0 || countLoc('coolerbox') > 0) storageSummary.push(`🧊 Cooler Box: \`${countLoc('coolerbox')}/${cap.coolerbox}\``);
        if (cap.kulkas > 0 || countLoc('kulkas') > 0) storageSummary.push(`❄️ Kulkas: \`${countLoc('kulkas')}/${cap.kulkas}\``);
        if (cap.freezer > 0 || countLoc('freezer') > 0) storageSummary.push(`🧊 Freezer: \`${countLoc('freezer')}/${cap.freezer}\``);
        if (cap.gudang > 0 || countLoc('gudang') > 0) storageSummary.push(`📦 Gudang: \`${countLoc('gudang')}/${cap.gudang}\``);
        if (storageSummary.length > 0) {
            blocks.push(`**🏠 Penyimpanan Lain (\`/storage\`):** ${storageSummary.join(' · ')}`);
        }
    }

    // Row 1: Filter Kategori
    const rows = [
        select('inventory', 'cat', ownerId, {
            placeholder: '📂 Filter Kategori Tas...',
            options: CATEGORIES.map(c => ({
                label: c.label,
                value: c.value,
                emoji: c.emoji,
                description: c.description,
                default: c.value === filterCat
            }))
        }, now)
    ];

    // Row 2: Pagination + Repair + Upgrade Bag
    const extraBtns = [];
    if (damagedTools.length > 0) {
        extraBtns.push(
            btn('inventory', 'repair_all', ownerId, {
                label: `Perbaiki Alat (${formatLp(totalRepairCost)})`,
                emoji: '🔧',
                style: ButtonStyle.Primary,
                arg: `${filterCat}:${paged.page}`
            }, now)
        );
    }
    if (nextBag) {
        extraBtns.push(
            btn('inventory', 'upgrade_bag', ownerId, {
                label: `Upgrade ${nextBag.name} (${formatLp(nextBag.price)})`,
                emoji: '🎒',
                style: ButtonStyle.Success,
                arg: `${filterCat}:${paged.page}`
            }, now)
        );
    }

    rows.push(
        pageRow('inventory', 'page', ownerId, {
            page: paged.page,
            totalPages: paged.totalPages,
            argPrefix: filterCat,
            extraButtons: extraBtns
        }, now)
    );

    return buildPanel({
        mod: 'inventory',
        ownerId,
        accentColor: COLORS.ECONOMY,
        title: `🎒 Isi Tas & Peralatan`,
        player: p,
        banner,
        blocks,
        rows,
        footer: 'Alat = 1 slot/unit · Makanan/Ikan/Mineral = 20/slot (per batch kesegaran) · Umpan = 100/slot · Dokumen = 0 slot.',
        now
    });
}

async function buildInventoryPayload(discordId, filterCat = 'semua', _ephemeral = false, now = Date.now()) {
    const state = await fetchInventoryState(discordId, now);
    return buildInventoryPanel({ state, filterCat, page: 1, now });
}

async function handleRepairAllTools(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
        const damaged = getDamagedTools(invRows);

        if (damaged.length === 0) {
            return { error: 'NONE_DAMAGED', player: p };
        }

        const totalCost = damaged.reduce((acc, d) => acc + d.repairCost, 0);
        const totalBalance = Number(p.cash) + Number(p.bank);
        if (totalBalance < totalCost) {
            return { error: 'INSUFFICIENT_FUNDS', totalCost, totalBalance, player: p };
        }

        await debitPlayerFunds(conn, p, totalCost, 'repair_tools', {
            toolsCount: damaged.length
        }, now);

        for (const d of damaged) {
            await repairToolById(conn, d.rowId, d.maxDurability);
        }

        return {
            ok: true,
            repaired: damaged,
            totalCost,
            player: p
        };
    });
}

module.exports = {
    name: 'inventory',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('Lihat isi tas, filter kategori barang, perbaiki alat rusak, atau upgrade tas.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchInventoryState(interaction.user.id, now);
        return await interaction.reply(buildInventoryPanel({ state, filterCat: 'semua', page: 1, now }));
    },

    panel: {
        buttons: {
            async page(interaction, parsed) {
                const now = Date.now();
                const [filterCat = 'semua', rawPage = '1'] = (parsed.arg || '').split(':');
                const state = await fetchInventoryState(interaction.user.id, now);
                return await interaction.update(
                    buildInventoryPanel({
                        state,
                        filterCat,
                        page: Number(rawPage) || 1,
                        now
                    })
                );
            },
            async repair_all(interaction, parsed) {
                const now = Date.now();
                const [filterCat = 'semua', rawPage = '1'] = (parsed.arg || '').split(':');
                const res = await handleRepairAllTools(interaction.user.id, now);
                const state = await fetchInventoryState(interaction.user.id, now);

                let banner = null;
                if (res.error === 'NONE_DAMAGED') {
                    banner = { type: 'info', text: 'Semua peralatan di tasmu masih dalam kondisi prima.' };
                } else if (res.error === 'INSUFFICIENT_FUNDS') {
                    banner = {
                        type: 'danger',
                        text: `Saldo tidak cukup untuk perbaikan! Butuh **${formatLp(res.totalCost)}**, sedangkan Cash + Bank kamu **${formatLp(res.totalBalance)}**.`
                    };
                } else {
                    banner = {
                        type: 'success',
                        text: `🔧 Berhasil memperbaiki **${res.repaired.length} peralatan** dengan total biaya **${formatLp(res.totalCost)}**!`
                    };
                }

                return await interaction.update(
                    buildInventoryPanel({
                        state,
                        filterCat,
                        page: Number(rawPage) || 1,
                        banner,
                        now
                    })
                );
            },
            async upgrade_bag(interaction, parsed) {
                const now = Date.now();
                const [filterCat = 'semua', rawPage = '1'] = (parsed.arg || '').split(':');
                const res = await executeBackpackUpgrade(interaction.user.id, now);
                const state = await fetchInventoryState(interaction.user.id, now);

                let banner = null;
                if (res.error === 'MAX_TIER') {
                    banner = { type: 'info', text: `Kapasitas tasmu sudah maksimal (**${res.currentBag.name}**).` };
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
                    buildInventoryPanel({
                        state,
                        filterCat,
                        page: Number(rawPage) || 1,
                        banner,
                        now
                    })
                );
            }
        },
        selects: {
            async cat(interaction) {
                const now = Date.now();
                const filterCat = interaction.values[0] || 'semua';
                const state = await fetchInventoryState(interaction.user.id, now);
                return await interaction.update(
                    buildInventoryPanel({
                        state,
                        filterCat,
                        page: 1,
                        now
                    })
                );
            }
        }
    },

    buildInventoryPanel,
    buildInventoryPayload,
    handleRepairAllTools
};
