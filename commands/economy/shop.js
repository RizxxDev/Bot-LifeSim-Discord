const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const ShopManager = require('../../managers/ShopManager');
const shopConfig = require('../../config/shop.json');
const { infoEmbed, formatMoney, formatNumber, progressBar, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'shop',
    aliases: ['toko', 'pasar', 'market'],
    prefix: true,
    slash: true,
    requiresRegistration: false,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('View global shop stock and dynamic prices.'),

    async executeSlash(interaction) {
        await handleShopView(interaction, interaction.user);
    },

    async executePrefix(message) {
        await handleShopView(message, message.author);
    }
};

async function handleShopView(context, user) {
    try {
        const shopData = await db.query('SELECT cash, max_storage FROM global_shop WHERE id = 1');
        const inventory = await db.query('SELECT item_id, amount FROM shop_inventory');

        const cash = Number(shopData[0]?.cash || 0);
        const maxStorage = Number(shopData[0]?.max_storage || 10000);
        const usedStorage = inventory.reduce((sum, item) => sum + Number(item.amount || 0), 0);

        const embed = infoEmbed('Global Shop', 'Prices rise when stock is low and fall when stock is high.', user)
            .setColor(colors.money)
            .addFields(
                { name: 'Shop cash', value: formatMoney(cash), inline: true },
                { name: 'Storage', value: progressBar(usedStorage, maxStorage, 8), inline: true }
            );

        const groups = { raw: [], product: [] };
        for (const [id, item] of Object.entries(shopConfig.items)) {
            const stock = Number(inventory.find((row) => row.item_id === id)?.amount || 0);
            const buyPrice = ShopManager.calculatePrice(id, stock);
            const sellPrice = Math.max(item.min_price, Math.floor(buyPrice * 0.85));
            const trend = stock < item.target_stock * 0.5 ? 'Rising' : stock > item.target_stock * 1.2 ? 'Falling' : 'Stable';
            const line = `**${item.name}** \`${id}\`\nStock: ${formatNumber(stock)} / ${formatNumber(item.target_stock)} | Buy ${formatMoney(buyPrice)} | Sell ${formatMoney(sellPrice)} | ${trend}`;
            groups[item.type === 'product' ? 'product' : 'raw'].push(line);
        }

        if (groups.raw.length) embed.addFields({ name: 'Raw materials', value: groups.raw.join('\n\n'), inline: false });
        if (groups.product.length) embed.addFields({ name: 'Processed goods', value: groups.product.join('\n\n'), inline: false });
        embed.setFooter({ text: 'Use /buy item amount or /sell item amount.' });

        return send(context, { embeds: [embed] });
    } catch (error) {
        console.error('[SHOP ERROR]', error);
        return sendError(context, user, 'Could not load the global shop.');
    }
}
