const { SlashCommandBuilder } = require('discord.js');
const economy = require('../../services/economyService');
const { infoEmbed, successEmbed, formatMoney, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'bank',
    aliases: ['atm', 'bal', 'balance'],
    prefix: true,
    slash: true,
    requiresRegistration: false,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('bank')
        .setDescription('Manage your economy balance.')
        .addSubcommand(sub => sub.setName('info').setDescription('View your balances.'))
        .addSubcommand(sub => sub.setName('deposit').setDescription('Deposit cash into the bank.')
            .addStringOption(opt => opt.setName('amount').setDescription('Amount or "all".').setRequired(true)))
        .addSubcommand(sub => sub.setName('withdraw').setDescription('Withdraw cash from the bank.')
            .addStringOption(opt => opt.setName('amount').setDescription('Amount or "all".').setRequired(true)))
        .addSubcommand(sub => sub.setName('transfer').setDescription('Transfer bank funds to another player.')
            .addUserOption(opt => opt.setName('target').setDescription('Recipient.').setRequired(true))
            .addStringOption(opt => opt.setName('amount').setDescription('Amount or "all".').setRequired(true))),

    async executeSlash(interaction) {
        await handleBank(interaction, interaction.user, interaction.options.getSubcommand(false) || 'info', {
            amountText: interaction.options.getString('amount'),
            targetUser: interaction.options.getUser('target')
        });
    },

    async executePrefix(message, args) {
        const sub = args[0]?.toLowerCase() || 'info';
        const action = { dep: 'deposit', wd: 'withdraw', tf: 'transfer' }[sub] || sub;
        await handleBank(message, message.author, action, {
            amountText: ['deposit', 'withdraw'].includes(action) ? args[1]?.toLowerCase() : args[2]?.toLowerCase(),
            targetUser: action === 'transfer' ? message.mentions.users.first() : null
        });
    }
};

async function handleBank(context, user, action, data) {
    if (!['info', 'deposit', 'withdraw', 'transfer'].includes(action)) {
        return sendError(context, user, 'Usage: `!bank`, `!bank dep <amount/all>`, `!bank wd <amount/all>`, or `!bank tf @user <amount/all>`.');
    }

    try {
        const guildId = economy.getGuildId(context);
        const current = await economy.getBalance(guildId, user.id);

        if (action === 'info') {
            const embed = infoEmbed(`Bank Account: ${user.username}`, null, user)
                .setColor(colors.money)
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: 'Cash', value: formatMoney(current.cash), inline: true },
                    { name: 'Bank', value: formatMoney(current.bank), inline: true },
                    { name: 'Total', value: formatMoney(current.total), inline: true }
                )
                .setFooter({ text: 'Use /bank deposit, /bank withdraw, or /bank transfer.' });
            return send(context, { embeds: [embed] });
        }

        const available = action === 'deposit' ? current.cash : current.bank;
        const amount = economy.resolveAmount(data.amountText, available);
        if (!Number.isInteger(amount) || amount <= 0) {
            throw new Error('Enter a positive amount or `all`.');
        }

        let embed;
        if (action === 'deposit') {
            const profile = await economy.deposit(guildId, user.id, amount);
            embed = successEmbed('Deposit Complete', `Deposited **${formatMoney(amount)}** into your bank account.`, user)
                .addFields(
                    { name: 'Cash', value: formatMoney(profile.cash), inline: true },
                    { name: 'Bank', value: formatMoney(profile.bank), inline: true }
                );
        } else if (action === 'withdraw') {
            const profile = await economy.withdraw(guildId, user.id, amount);
            embed = successEmbed('Withdrawal Complete', `Withdrew **${formatMoney(amount)}** from your bank account.`, user)
                .addFields(
                    { name: 'Cash', value: formatMoney(profile.cash), inline: true },
                    { name: 'Bank', value: formatMoney(profile.bank), inline: true }
                );
        } else {
            if (!data.targetUser) throw new Error('Mention the player you want to transfer to.');
            if (data.targetUser.id === user.id) throw new Error('You cannot transfer money to yourself.');
            if (data.targetUser.bot) throw new Error('You cannot transfer money to a bot.');

            await economy.transferBank(guildId, user.id, data.targetUser.id, amount);
            embed = successEmbed('Transfer Complete', `Transferred **${formatMoney(amount)}** to **${data.targetUser.username}**.`, user);
        }

        return send(context, { embeds: [embed] });
    } catch (error) {
        return sendError(context, user, error.message);
    }
}
