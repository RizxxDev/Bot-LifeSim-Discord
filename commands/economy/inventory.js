const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const { infoEmbed, formatNumber, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'inventory',
    aliases: ['inv', 'bag', 'tas'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('View your carried items.'),

    async executeSlash(interaction) {
        await handleInventory(interaction, interaction.user);
    },

    async executePrefix(message) {
        await handleInventory(message, message.author);
    }
};

async function handleInventory(context, user) {
    try {
        const items = await db.query('SELECT item_id, amount FROM inventory WHERE user_id = ? AND amount > 0 ORDER BY item_id ASC', [user.id]);

        const embed = infoEmbed(`Inventory: ${user.username}`, null, user)
            .setColor(colors.inventory)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }));

        if (!items || items.length === 0) {
            embed.setDescription('Your inventory is empty.');
        } else {
            embed.setDescription(items.map((item) => {
                return `• **${formatItemName(item.item_id)}** — x${formatNumber(item.amount)}`;
            }).join('\n'));
        }

        embed.setFooter({ text: 'Farm harvests are stored separately in /farm storage.' });
        return send(context, { embeds: [embed] });
    } catch (error) {
        console.error('[INVENTORY ERROR]', error);
        return sendError(context, user, 'Could not open your inventory.');
    }
}

function formatItemName(itemId) {
    return itemId.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
