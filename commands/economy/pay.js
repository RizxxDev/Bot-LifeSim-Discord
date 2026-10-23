const { SlashCommandBuilder } = require('discord.js');
const economy = require('../../services/economyService');
const { successEmbed, formatMoney, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'pay',
    aliases: ['give', 'transfercash'],
    prefix: true,
    slash: true,
    requiresRegistration: false,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('pay')
        .setDescription('Give cash to another citizen.')
        .addUserOption(opt => opt.setName('target').setDescription('Recipient.').setRequired(true))
        .addIntegerOption(opt => opt.setName('amount').setDescription('Cash amount.').setRequired(true).setMinValue(1)),

    async executeSlash(interaction) {
        await handlePay(interaction, interaction.user, interaction.options.getUser('target'), interaction.options.getInteger('amount'));
    },

    async executePrefix(message, args) {
        await handlePay(message, message.author, message.mentions.users.first(), Number.parseInt(args[1], 10));
    }
};

async function handlePay(context, sender, targetUser, amount) {
    if (!targetUser) return sendError(context, sender, 'Mention the citizen you want to pay.');
    if (!Number.isInteger(amount) || amount <= 0) return sendError(context, sender, 'Enter a positive cash amount.');
    if (targetUser.id === sender.id) return sendError(context, sender, 'You cannot pay yourself.');
    if (targetUser.bot) return sendError(context, sender, 'You cannot pay a bot.');

    try {
        const guildId = economy.getGuildId(context);
        await economy.transferCash(guildId, sender.id, targetUser.id, amount);
        const embed = successEmbed('Cash Sent', `**${sender.username}** paid **${formatMoney(amount)}** to **${targetUser.username}**.`, sender)
            .setColor(colors.money);
        return send(context, { embeds: [embed] });
    } catch (error) {
        return sendError(context, sender, error.message);
    }
}
