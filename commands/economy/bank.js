const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');

module.exports = {
    name: 'bank',
    aliases: ['atm', 'bal', 'transfer', 'dep', 'wd', 'tf'],
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('bank')
        .setDescription('Access city banking services')
        .addSubcommand(sub => 
            sub.setName('deposit')
            .setDescription('Deposit cash into the bank')
            .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to deposit').setRequired(true).setMinValue(1))
        )
        .addSubcommand(sub => 
            sub.setName('withdraw')
            .setDescription('Withdraw cash from the bank')
            .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to withdraw').setRequired(true).setMinValue(1))
        )
        .addSubcommand(sub => 
            sub.setName('transfer')
            .setDescription('Transfer bank balance to another player')
            .addUserOption(opt => opt.setName('target').setDescription('Target player').setRequired(true))
            .addIntegerOption(opt => opt.setName('amount').setDescription('Transfer amount').setRequired(true).setMinValue(1))
        ),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        const amount = interaction.options.getInteger('amount');
        if (sub === 'deposit') await runDeposit(interaction, interaction.user, amount, true);
        else if (sub === 'withdraw') await runWithdraw(interaction, interaction.user, amount, true);
        else if (sub === 'transfer') {
            const targetUser = interaction.options.getUser('target');
            await runTransfer(interaction, interaction.user, targetUser, amount, true);
        }
    },

    async executePrefix(message, args) {
        const sub = args[0]?.toLowerCase();
        const user = message.author;

        if (!sub || !['deposit', 'withdraw', 'transfer', 'dep', 'wd', 'tf'].includes(sub)) {
            return message.channel.send(`❌ **${user.username}**, **Bank Format:**\n🔹 \`!bank deposit <amount>\`\n🔹 \`!bank withdraw <amount>\`\n🔹 \`!bank transfer @user <amount>\``);
        }

        const amount = parseInt(args[sub === 'transfer' || sub === 'tf' ? 2 : 1]);
        if (isNaN(amount) || amount <= 0) return message.channel.send(`❌ **${user.username}**, please enter a valid amount!`);

        if (['deposit', 'dep'].includes(sub)) await runDeposit(message, user, amount, false);
        else if (['withdraw', 'wd'].includes(sub)) await runWithdraw(message, user, amount, false);
        else if (['transfer', 'tf'].includes(sub)) {
            const targetUser = message.mentions.users.first();
            if (!targetUser) return message.channel.send(`❌ **${user.username}**, tag (@) the player you want to transfer to!`);
            await runTransfer(message, user, targetUser, amount, false);
        }
    }
};

async function runDeposit(context, user, amount, isSlash) {
    let transaction;
    try {
        transaction = await db.startTransaction();
        const rows = await transaction.query('SELECT cash FROM users WHERE user_id = ? FOR UPDATE', [user.id]);
        
        if (!rows[0] || rows[0].cash < amount) throw new Error(`Insufficient cash! You only have **Lp ${rows[0]?.cash.toLocaleString() || 0}**.`);
        
        await transaction.query('UPDATE users SET cash = cash - ?, bank = bank + ? WHERE user_id = ?', [amount, amount, user.id]);
        await transaction.commit();
        
        const embed = new EmbedBuilder().setColor('#4CAF50').setTitle('🏦 Deposit Successful').setDescription(`**${user.username}** deposited **Lp ${amount.toLocaleString()}** into the Bank.`);
        
        if (isSlash) await context.reply({ embeds: [embed] });
        else await context.channel.send({ embeds: [embed] });
    } catch (err) {
        if (transaction) await transaction.rollback();
        const msg = `❌ **${user.username}**, Deposit Failed: ${err.message}`;
        if (isSlash) await context.reply({ content: msg, ephemeral: true });
        else await context.channel.send(msg);
    }
}

async function runWithdraw(context, user, amount, isSlash) {
    let transaction;
    try {
        transaction = await db.startTransaction();
        const rows = await transaction.query('SELECT bank FROM users WHERE user_id = ? FOR UPDATE', [user.id]);
        
        if (!rows[0] || rows[0].bank < amount) throw new Error(`Insufficient bank balance! Your balance: **Lp ${rows[0]?.bank.toLocaleString() || 0}**.`);
        
        await transaction.query('UPDATE users SET bank = bank - ?, cash = cash + ? WHERE user_id = ?', [amount, amount, user.id]);
        await transaction.commit();
        
        const embed = new EmbedBuilder().setColor('#FF9800').setTitle('🏧 Withdrawal Successful').setDescription(`**${user.username}** withdrew **Lp ${amount.toLocaleString()}** from the Bank.`);
        
        if (isSlash) await context.reply({ embeds: [embed] });
        else await context.channel.send({ embeds: [embed] });
    } catch (err) {
        if (transaction) await transaction.rollback();
        const msg = `❌ **${user.username}**, Withdrawal Failed: ${err.message}`;
        if (isSlash) await context.reply({ content: msg, ephemeral: true });
        else await context.channel.send(msg);
    }
}

async function runTransfer(context, sender, targetUser, amount, isSlash) {
    if (sender.id === targetUser.id) {
        const msg = `❌ **${sender.username}**, you cannot transfer to yourself!`;
        if (isSlash) return context.reply({ content: msg, ephemeral: true });
        return context.channel.send(msg);
    }
    if (targetUser.bot) {
        const msg = `❌ **${sender.username}**, you cannot transfer to a Bot!`;
        if (isSlash) return context.reply({ content: msg, ephemeral: true });
        return context.channel.send(msg);
    }

    let transaction;
    try {
        transaction = await db.startTransaction();
        const targetCheck = await transaction.query('SELECT user_id FROM users WHERE user_id = ?', [targetUser.id]);
        if (targetCheck.length === 0) throw new Error(`${targetUser.username} is not registered yet!`);
        
        const senderData = await transaction.query('SELECT bank FROM users WHERE user_id = ? FOR UPDATE', [sender.id]);
        if (!senderData[0] || senderData[0].bank < amount) throw new Error(`Insufficient Bank balance! Balance: **Lp ${senderData[0]?.bank.toLocaleString() || 0}**.`);
        
        await transaction.query('UPDATE users SET bank = bank - ? WHERE user_id = ?', [amount, sender.id]);
        await transaction.query('UPDATE users SET bank = bank + ? WHERE user_id = ?', [amount, targetUser.id]);
        await transaction.commit();
        
        const embed = new EmbedBuilder().setColor('#2196F3').setTitle('💸 Transfer Successful').setDescription(`**${sender.username}** successfully sent **Lp ${amount.toLocaleString()}** to **${targetUser.username}**.`);
        
        if (isSlash) await context.reply({ embeds: [embed] });
        else await context.channel.send({ embeds: [embed] });
    } catch (err) {
        if (transaction) await transaction.rollback();
        const msg = `❌ **${sender.username}**, Transfer Failed: ${err.message}`;
        if (isSlash) await context.reply({ content: msg, ephemeral: true });
        else await context.channel.send(msg);
    }
}