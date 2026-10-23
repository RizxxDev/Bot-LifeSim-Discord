const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const {
    getPlayerInventory,
    calculateSlotsUsed,
    getDamagedTools,
    repairToolById
} = require('../../services/inventoryService');
const { debitPlayerFunds } = require('../../services/economyService');
const { getItem } = require('../../data/items');
const { getBackpackByTier, getNextBackpackTier } = require('../../data/backpacks');
const { COLORS, formatLp, renderBar, buildV2Card } = require('../../utils/uiBuilder');

async function buildInventoryPayload(discordId, filterCat = 'semua', ephemeral = true) {
    const data = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, Date.now(), false);
        const invRows = await getPlayerInventory(conn, discordId, false);
        return { player: synced.player, invRows };
    });

    const { player: p, invRows } = data;
    const bag = getBackpackByTier(p.backpack_tier);
    const nextBag = getNextBackpackTier(p.backpack_tier);
    const slotsUsed = calculateSlotsUsed(invRows);
    const damagedTools = getDamagedTools(invRows);
    const totalRepairCost = damagedTools.reduce((acc, d) => acc + d.repairCost, 0);

    const groups = {
        konsumsi: [],
        alat: [],
        hasil_alam: [],
        dokumen: []
    };

    for (const row of invRows) {
        const qty = Number(row.quantity || 0);
        if (qty <= 0) continue;
        const it = getItem(row.item_id);
        if (!it) continue;

        if (it.maxDurability) {
            const dur = Number(row.durability ?? it.maxDurability);
            const status = dur <= 0 ? '🔴 **RUSAK**' : `Durability: \`${dur}/${it.maxDurability}\``;
            groups.alat.push(`• ${it.emoji} **${it.name}** — ${status}`);
        } else if (it.tags.includes('bait')) {
            const slots = Math.ceil(qty / (it.stackSize || 100));
            groups.alat.push(`• ${it.emoji} **${it.name}** ×**${qty}** *(${slots} slot)*`);
        } else if (it.tags.includes('fish') || it.tags.includes('mineral') || it.tags.includes('trash')) {
            const slots = Math.ceil(qty / (it.stackSize || 20));
            groups.hasil_alam.push(`• ${it.emoji} **${it.name}** ×**${qty}** *(Harga dasar ${formatLp(it.sellPrice)} · ${slots} slot)*`);
        } else if (it.stackSize === 0 || it.tags.includes('license') || it.tags.includes('prestise') || it.tags.includes('service')) {
            groups.dokumen.push(`• ${it.emoji} **${it.name}** ×**${qty}** *(0 slot)*`);
        } else {
            const slots = Math.ceil(qty / (it.stackSize || 20));
            groups.konsumsi.push(`• ${it.emoji} **${it.name}** ×**${qty}** *(${slots} slot)*`);
        }
    }

    const blocks = [
        `${bag.emoji} **${bag.name}** · Kapasitas: \`${renderBar(slotsUsed, p.max_slots, 10)}\` (**${slotsUsed}/${p.max_slots} slot terpakai**)\n💵 **Cash:** ${formatLp(p.cash)} · 🏦 **Bank:** ${formatLp(p.bank)}`
    ];

    const addGroupBlock = (title, list) => {
        if (list.length > 0) {
            blocks.push(`**${title}**\n${list.join('\n')}`);
        }
    };

    if (filterCat === 'semua' || filterCat === 'alat') addGroupBlock('🔧 Peralatan & Umpan', groups.alat);
    if (filterCat === 'semua' || filterCat === 'konsumsi') addGroupBlock('🍱 Makanan, Minuman & Obat', groups.konsumsi);
    if (filterCat === 'semua' || filterCat === 'hasil_alam') addGroupBlock('🐟 Hasil Pancingan & Tambang', groups.hasil_alam);
    if (filterCat === 'semua' || filterCat === 'dokumen') addGroupBlock('🪪 Dokumen, Perangkat & Gelar', groups.dokumen);

    if (blocks.length === 1) {
        blocks.push('*Tidak ada barang dalam kategori ini di tasmu.*');
    }

    const btnRow = new ActionRowBuilder();
    if (damagedTools.length > 0) {
        btnRow.addComponents(
            new ButtonBuilder()
                .setCustomId('inv_repair_all')
                .setLabel(`Perbaiki Semua Alat (${formatLp(totalRepairCost)})`)
                .setEmoji('🔧')
                .setStyle(ButtonStyle.Primary)
        );
    }
    if (nextBag) {
        btnRow.addComponents(
            new ButtonBuilder()
                .setCustomId('shop_upgrade_bag')
                .setLabel(`Upgrade ke ${nextBag.name} (${formatLp(nextBag.price)})`)
                .setEmoji('🎒')
                .setStyle(ButtonStyle.Success)
        );
    }

    return buildV2Card({
        accentColor: COLORS.ECONOMY,
        title: `🎒 Isi Tas: ${p.username}`,
        blocks,
        actionRows: btnRow.components.length > 0 ? [btnRow] : [],
        footer: 'Alat ber-durability = 1 slot/unit · Makanan/Ikan/Mineral = 20/slot · Umpan = 100/slot · Dokumen = 0 slot.',
        ephemeral
    });
}

async function handleRepairAllTools(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, true);
        const damaged = getDamagedTools(invRows);

        if (damaged.length === 0) {
            return { error: 'NONE_DAMAGED' };
        }

        const totalCost = damaged.reduce((acc, d) => acc + d.repairCost, 0);
        const totalBalance = Number(p.cash) + Number(p.bank);
        if (totalBalance < totalCost) {
            return { error: 'INSUFFICIENT_FUNDS', totalCost, totalBalance };
        }

        await debitPlayerFunds(conn, p, totalCost, 'repair_tools', {
            toolsCount: damaged.length
        }, now);

        for (const d of damaged) {
            await repairToolById(conn, d.rowId, d.maxDurability);
        }

        return {
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
        .setDescription('Lihat isi tas, sisa slot penyimpanan, perbaiki alat rusak, atau upgrade tas.')
        .addStringOption(opt =>
            opt
                .setName('kategori')
                .setDescription('Filter tampilan isi tas')
                .setRequired(false)
                .addChoices(
                    { name: '📦 Semua Barang', value: 'semua' },
                    { name: '🔧 Peralatan & Umpan', value: 'alat' },
                    { name: '🍱 Makanan, Minuman & Obat', value: 'konsumsi' },
                    { name: '🐟 Hasil Pancingan & Tambang', value: 'hasil_alam' },
                    { name: '🪪 Dokumen & Gelar Prestise', value: 'dokumen' }
                )
        ),

    async executeSlash(interaction) {
        const filterCat = interaction.options.getString('kategori') || 'semua';
        const payload = await buildInventoryPayload(interaction.user.id, filterCat, true);
        return await interaction.reply(payload);
    },

    buildInventoryPayload,
    handleRepairAllTools
};
