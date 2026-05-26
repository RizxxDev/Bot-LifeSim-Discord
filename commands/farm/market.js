const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const MarketManager = require('../../managers/MarketManager');
const { infoEmbed, successEmbed, formatMoney, formatNumber, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'market',
    aliases: ['pasar', 'trade'],
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('market')
        .setDescription('Player-to-player storage market.')
        .addSubcommand(sub => sub.setName('list').setDescription('View current listings.'))
        .addSubcommand(sub => sub.setName('sell').setDescription('List an item from farm storage.')
            .addStringOption(opt => opt.setName('item').setDescription('Item ID.').setRequired(true))
            .addIntegerOption(opt => opt.setName('amount').setDescription('Amount.').setRequired(true).setMinValue(1))
            .addIntegerOption(opt => opt.setName('price').setDescription('Total price.').setRequired(true).setMinValue(1)))
        .addSubcommand(sub => sub.setName('buy').setDescription('Buy a listing.')
            .addIntegerOption(opt => opt.setName('id').setDescription('Listing ID.').setRequired(true).setMinValue(1))),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand(false) || 'list';
        await handleMarket(interaction, interaction.user, sub, {
            item: interaction.options.getString('item'),
            amount: interaction.options.getInteger('amount'),
            price: interaction.options.getInteger('price'),
            listingId: interaction.options.getInteger('id')
        });
    },

    async executePrefix(message, args) {
        const sub = args[0]?.toLowerCase() || 'list';
        await handleMarket(message, message.author, sub, {
            item: args[1]?.toLowerCase(),
            amount: Number.parseInt(args[2], 10),
            price: Number.parseInt(args[3], 10),
            listingId: Number.parseInt(args[1], 10)
        });
    }
};

async function handleMarket(context, user, sub, data) {
    if (!['list', 'sell', 'buy'].includes(sub)) {
        return sendError(context, user, 'Usage: `!market`, `!market sell <item> <amount> <price>`, or `!market buy <id>`.');
    }

    try {
        if (sub === 'list') {
            const listings = await db.query('SELECT * FROM market_listings ORDER BY created_at DESC LIMIT 10');
            const embed = infoEmbed('Player Market', null, user)
                .setColor(colors.market);

            embed.setDescription(listings.length ? listings.map((listing) => {
                return `**#${listing.id}** ${formatNumber(listing.amount)}x **${listing.item_id}** — ${formatMoney(listing.price)}\nSeller: <@${listing.seller_id}>`;
            }).join('\n\n') : 'No active listings.');

            return send(context, { embeds: [embed] });
        }

        if (sub === 'sell') {
            await MarketManager.listToMarket(user.id, data.item, data.amount, data.price);
            const embed = successEmbed('Listing Created', `Listed **${formatNumber(data.amount)}x ${data.item}** for **${formatMoney(data.price)}**. Listing fee: ${formatMoney(50)}.`, user)
                .setColor(colors.market);
            return send(context, { embeds: [embed] });
        }

        await MarketManager.buyFromMarket(user.id, data.listingId);
        const embed = successEmbed('Market Purchase Complete', 'The item was added to your farm storage.', user)
            .setColor(colors.market);
        return send(context, { embeds: [embed] });
    } catch (error) {
        return sendError(context, user, error.message);
    }
}
