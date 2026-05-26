const { SlashCommandBuilder } = require('discord.js');
const ShopManager = require('../../managers/ShopManager');
const shopConfig = require('../../config/shop.json');
const { successEmbed, formatMoney } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'sell',
    aliases: ['jual'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('sell')
        .setDescription('Sell an item to the global shop.')
        .addStringOption(opt => opt.setName('item').setDescription('Item ID, for example wheat.').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to sell.').setRequired(true).setMinValue(1).setMaxValue(500)),

    async executeSlash(interaction) {
        await handleSell(interaction, interaction.user, interaction.options.getString('item'), interaction.options.getInteger('amount'));
    },

    async executePrefix(message, args) {
        await handleSell(message, message.author, args[0]?.toLowerCase(), Number.parseInt(args[1], 10));
    }
};

async function handleSell(context, user, item, amount) {
    try {
        if (!item || !Number.isInteger(amount) || amount <= 0) {
            return sendError(context, user, 'Usage: `!sell <item> <amount>`.');
        }

        const result = await ShopManager.sellToShop(user.id, item, amount);
        const itemName = shopConfig.items[item]?.name || item;
        const embed = successEmbed(
            'Sale Complete',
            `You sold **${amount}x ${itemName}** to the global shop.`,
            user
        ).addFields(
            { name: 'Unit price', value: formatMoney(result.unitPrice), inline: true },
            { name: 'Total earned', value: formatMoney(result.totalPrice), inline: true }
        );

        return send(context, { embeds: [embed] });
    } catch (error) {
        return sendError(context, user, error.message);
    }
}
