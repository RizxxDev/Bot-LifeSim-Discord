const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const { successEmbed, formatMoney, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'pay',
    aliases: ['give', 'transfercash'],
    prefix: true,
    slash: true,
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

    let trx;
    try {
        trx = await db.startTransaction();
        const target = await trx.query('SELECT user_id FROM users WHERE user_id = ? FOR UPDATE', [targetUser.id]);
        if (!target || target.length === 0) throw new Error(`${targetUser.username} does not have a citizen profile yet.`);

        const senderData = await trx.query('SELECT cash FROM users WHERE user_id = ? FOR UPDATE', [sender.id]);
        if (!senderData[0] || senderData[0].cash < amount) throw new Error(`Not enough cash. Current cash: ${formatMoney(senderData[0]?.cash || 0)}.`);

        await trx.query('UPDATE users SET cash = cash - ? WHERE user_id = ?', [amount, sender.id]);
        await trx.query('UPDATE users SET cash = cash + ? WHERE user_id = ?', [amount, targetUser.id]);
        await trx.commit();

        const embed = successEmbed('Cash Sent', `**${sender.username}** paid **${formatMoney(amount)}** to **${targetUser.username}**.`, sender)
            .setColor(colors.money);
        return send(context, { embeds: [embed] });
    } catch (error) {
        if (trx) await trx.rollback();
        return sendError(context, sender, error.message);
    }
}
