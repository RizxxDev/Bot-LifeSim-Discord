const { SlashCommandBuilder } = require('discord.js');
const ShopManager = require('../../managers/ShopManager');
const shopConfig = require('../../config/shop.json');

module.exports = {
    name: 'buy',
    aliases: ['beli'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Beli item dari Shop')
        .addStringOption(opt => opt.setName('item').setDescription('ID Item (contoh: wheat)').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Jumlah').setRequired(true).setMinValue(1).setMaxValue(100)),

    async executeSlash(interaction) {
        const item = interaction.options.getString('item');
        const amount = interaction.options.getInteger('amount');
        await handleBuy(interaction, interaction.user, item, amount, true);
    },

    async executePrefix(message, args) {
        const user = message.author;
        const item = args[0]?.toLowerCase();
        const amount = parseInt(args[1]);

        if (!item || isNaN(amount)) {
            return message.channel.send(`❌ **${user.username}**, Format salah! Ketik: \`!buy <item> <jumlah>\``);
        }
        await handleBuy(message, user, item, amount, false);
    }
};

async function handleBuy(context, user, item, amount, isSlash) {
    try {
        const result = await ShopManager.buyFromShop(user.id, item, amount);
        const itemName = shopConfig.items[item]?.name || item;
        
        const msg = `🛒 **${user.username}** membeli **${amount}x ${itemName}** seharga **Lp ${result.totalPrice.toLocaleString()}** (@Lp ${result.unitPrice}/ea).`;
        return isSlash ? context.reply(msg) : context.channel.send(msg);
        
    } catch (error) {
        const errMsg = `❌ **${user.username}**, ${error.message}`;
        if (isSlash) await context.reply({ content: errMsg, ephemeral: true });
        else await context.channel.send(errMsg);
    }
}