const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');

module.exports = {
    name: 'pay',
    aliases: ['bayar', 'give'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('pay')
        .setDescription('Memberikan uang tunai (Cash) kepada warga lain')
        .addUserOption(opt => 
            opt.setName('target')
            .setDescription('Pemain yang ingin diberikan uang')
            .setRequired(true)
        )
        .addIntegerOption(opt => 
            opt.setName('amount')
            .setDescription('Jumlah uang yang ingin diberikan')
            .setRequired(true)
            .setMinValue(1)
        ),

    async executeSlash(interaction) {
        const targetUser = interaction.options.getUser('target');
        const amount = interaction.options.getInteger('amount');
        await handlePay(interaction, interaction.user, targetUser, amount, true);
    },

    async executePrefix(message, args) {
        const user = message.author;
        
        // Cek apakah ada yang di-tag (mention)
        const targetUser = message.mentions.users.first();
        if (!targetUser) {
            return message.channel.send(`❌ **${user.username}**, tag (@) pemain yang ingin kamu beri uang!\nFormat: \`!pay @user <jumlah>\``);
        }

        // Cari angka jumlah dari argumen (biasanya di argumen ke-2 setelah tag)
        const amount = parseInt(args[1]);
        if (isNaN(amount) || amount <= 0) {
            return message.channel.send(`❌ **${user.username}**, masukkan jumlah uang yang valid (angka lebih dari 0)!`);
        }

        await handlePay(message, user, targetUser, amount, false);
    }
};

async function handlePay(context, sender, targetUser, amount, isSlash) {
    // Validasi Dasar
    if (sender.id === targetUser.id) {
        const msg = `❌ **${sender.username}**, kamu tidak bisa memberikan uang kepada dirimu sendiri!`;
        return isSlash ? context.reply({ content: msg, ephemeral: true }) : context.channel.send(msg);
    }
    if (targetUser.bot) {
        const msg = `❌ **${sender.username}**, bot tidak membutuhkan uang!`;
        return isSlash ? context.reply({ content: msg, ephemeral: true }) : context.channel.send(msg);
    }

    let trx;
    try {
        trx = await db.startTransaction();

        // 1. Cek apakah target terdaftar di database
        const targetCheck = await trx.query('SELECT user_id FROM users WHERE user_id = ?', [targetUser.id]);
        if (!targetCheck || targetCheck.length === 0) {
            throw new Error(`**${targetUser.username}** belum mendaftar sebagai warga! Suruh dia \`/register\` dulu.`);
        }
        
        // 2. Cek apakah pengirim punya cukup Cash (FOR UPDATE mengunci baris agar tidak ada duplikasi transaksi)
        const senderData = await trx.query('SELECT cash FROM users WHERE user_id = ? FOR UPDATE', [sender.id]);
        if (!senderData[0] || senderData[0].cash < amount) {
            throw new Error(`Uang tunai (Cash) kamu tidak cukup! Kamu hanya punya **Lp ${senderData[0]?.cash.toLocaleString() || 0}**.`);
        }
        
        // 3. Potong saldo pengirim dan Tambah saldo penerima
        await trx.query('UPDATE users SET cash = cash - ? WHERE user_id = ?', [amount, sender.id]);
        await trx.query('UPDATE users SET cash = cash + ? WHERE user_id = ?', [amount, targetUser.id]);
        
        await trx.commit();
        
        // 4. Tampilkan pesan berhasil
        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('💸 Pembayaran Berhasil')
            .setDescription(`**${sender.username}** telah memberikan uang tunai sebesar **Lp ${amount.toLocaleString()}** kepada **${targetUser.username}**!`)
            .setTimestamp();
        
        return isSlash ? context.reply({ embeds: [embed] }) : context.channel.send({ embeds: [embed] });

    } catch (err) {
        if (trx) await trx.rollback();
        const msg = `❌ **${sender.username}**, Pembayaran Gagal: ${err.message}`;
        return isSlash ? context.reply({ content: msg, ephemeral: true }) : context.channel.send(msg);
    }
}