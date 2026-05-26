const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const { infoEmbed, successEmbed, formatMoney, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'bank',
    aliases: ['atm', 'bal', 'balance'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('bank')
        .setDescription('Manage your cash and bank balance.')
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

    let trx;
    try {
        trx = await db.startTransaction();
        const rows = await trx.query('SELECT cash, bank FROM users WHERE user_id = ? FOR UPDATE', [user.id]);
        if (!rows || rows.length === 0) throw new Error('Profile not found. Use `/register` first.');

        const current = rows[0];

        if (action === 'info') {
            await trx.commit();
            const embed = infoEmbed(`Bank Account: ${user.username}`, null, user)
                .setColor(colors.money)
                .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: 'Cash', value: formatMoney(current.cash), inline: true },
                    { name: 'Bank', value: formatMoney(current.bank), inline: true },
                    { name: 'Total', value: formatMoney(Number(current.cash) + Number(current.bank)), inline: true }
                )
                .setFooter({ text: 'Use /bank deposit, /bank withdraw, or /bank transfer.' });
            return send(context, { embeds: [embed] });
        }

        const amount = resolveAmount(data.amountText, action === 'deposit' ? current.cash : current.bank);
        if (!Number.isInteger(amount) || amount <= 0) {
            throw new Error('Enter a positive amount or `all`.');
        }

        let embed;
        if (action === 'deposit') {
            if (current.cash < amount) throw new Error(`Not enough cash. Current cash: ${formatMoney(current.cash)}.`);
            await trx.query('UPDATE users SET cash = cash - ?, bank = bank + ? WHERE user_id = ?', [amount, amount, user.id]);
            await trx.commit();
            embed = successEmbed('Deposit Complete', `Deposited **${formatMoney(amount)}** into your bank account.`, user);
        } else if (action === 'withdraw') {
            if (current.bank < amount) throw new Error(`Not enough bank balance. Current bank: ${formatMoney(current.bank)}.`);
            await trx.query('UPDATE users SET cash = cash + ?, bank = bank - ? WHERE user_id = ?', [amount, amount, user.id]);
            await trx.commit();
            embed = successEmbed('Withdrawal Complete', `Withdrew **${formatMoney(amount)}** from your bank account.`, user);
        } else {
            if (!data.targetUser) throw new Error('Mention the player you want to transfer to.');
            if (data.targetUser.id === user.id) throw new Error('You cannot transfer money to yourself.');
            if (data.targetUser.bot) throw new Error('You cannot transfer money to a bot.');
            if (current.bank < amount) throw new Error(`Not enough bank balance. Current bank: ${formatMoney(current.bank)}.`);

            const target = await trx.query('SELECT user_id FROM users WHERE user_id = ? FOR UPDATE', [data.targetUser.id]);
            if (!target || target.length === 0) throw new Error(`${data.targetUser.username} does not have a citizen profile yet.`);

            await trx.query('UPDATE users SET bank = bank - ? WHERE user_id = ?', [amount, user.id]);
            await trx.query('UPDATE users SET bank = bank + ? WHERE user_id = ?', [amount, data.targetUser.id]);
            await trx.commit();
            embed = successEmbed('Transfer Complete', `Transferred **${formatMoney(amount)}** to **${data.targetUser.username}**.`, user);
        }

        return send(context, { embeds: [embed] });
    } catch (error) {
        if (trx) await trx.rollback();
        return sendError(context, user, error.message);
    }
}

function resolveAmount(value, available) {
    if (!value) return NaN;
    if (String(value).toLowerCase() === 'all') return Number(available || 0);
    return Number.parseInt(value, 10);
}
