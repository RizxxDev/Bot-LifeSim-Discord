const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const pool = require('../../database/mariadb'); // Disesuaikan dengan path folder

module.exports = {
    name: 'bank',
    aliases: ['atm', 'bal', 'transfer', 'dep', 'wd', 'tf'],
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('bank')
        .setDescription('Akses layanan perbankan kota')
        .addSubcommand(sub => 
            sub.setName('deposit')
            .setDescription('Simpan uang tunai ke bank')
            .addIntegerOption(opt => opt.setName('jumlah').setDescription('Jumlah yang ingin disetor').setRequired(true).setMinValue(1))
        )
        .addSubcommand(sub => 
            sub.setName('withdraw')
            .setDescription('Tarik uang dari bank')
            .addIntegerOption(opt => opt.setName('jumlah').setDescription('Jumlah yang ingin ditarik').setRequired(true).setMinValue(1))
        )
        .addSubcommand(sub => 
            sub.setName('transfer')
            .setDescription('Transfer saldo bank ke pemain lain')
            .addUserOption(opt => opt.setName('target').setDescription('Pemain tujuan').setRequired(true))
            .addIntegerOption(opt => opt.setName('jumlah').setDescription('Jumlah transfer').setRequired(true).setMinValue(1))
        ),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        const amount = interaction.options.getInteger('jumlah');

        if (sub === 'deposit') await runDeposit(interaction, interaction.user, amount);
        else if (sub === 'withdraw') await runWithdraw(interaction, interaction.user, amount);
        else if (sub === 'transfer') {
            const targetUser = interaction.options.getUser('target');
            await runTransfer(interaction, interaction.user, targetUser, amount);
        }
    },

    async executePrefix(message, args) {
        const sub = args[0] ? args[0].toLowerCase() : null;

        if (!sub || !['deposit', 'withdraw', 'transfer', 'dep', 'wd', 'tf'].includes(sub)) {
            return message.reply('❌ **Format Bank:**\n🔹 `!bank deposit <jumlah>` (Simpan uang)\n🔹 `!bank withdraw <jumlah>` (Tarik uang)\n🔹 `!bank transfer @user <jumlah>` (Kirim uang)');
        }

        if (['deposit', 'dep'].includes(sub)) {
            const amount = parseInt(args[1]);
            if (isNaN(amount) || amount <= 0) return message.reply('❌ Masukkan jumlah yang valid!');
            await runDeposit(message, message.author, amount);
        } 
        else if (['withdraw', 'wd'].includes(sub)) {
            const amount = parseInt(args[1]);
            if (isNaN(amount) || amount <= 0) return message.reply('❌ Masukkan jumlah yang valid!');
            await runWithdraw(message, message.author, amount);
        } 
        else if (['transfer', 'tf'].includes(sub)) {
            const targetUser = message.mentions.users.first();
            const amount = parseInt(args[2]);

            if (!targetUser) return message.reply('❌ Tag (@) pemain yang ingin ditransfer!');
            if (isNaN(amount) || amount <= 0) return message.reply('❌ Masukkan jumlah transfer yang valid!');
            await runTransfer(message, message.author, targetUser, amount);
        }
    }
};

// ==========================================
// 1. FUNGSI DEPOSIT (Tunai -> Bank)
// ==========================================
async function runDeposit(context, user, amount) {
    const userId = user.id;
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        const [rows] = await connection.query('SELECT uang FROM users WHERE user_id = ? FOR UPDATE', [userId]);
        
        if (!rows[0] || rows[0].uang < amount) {
            throw new Error(`Uang tunaimu tidak cukup! Kamu hanya punya **Lp ${rows[0]?.uang.toLocaleString() || 0}**.`);
        }

        await connection.query('UPDATE users SET uang = uang - ?, bank = bank + ? WHERE user_id = ?', [amount, amount, userId]);
        await connection.commit();

        const embed = new EmbedBuilder()
            .setColor('#4CAF50')
            .setTitle('🏦 Deposit Berhasil')
            .setDescription(`Kamu menyetor **Lp ${amount.toLocaleString()}** ke Bank.`);
        
        await context.reply({ embeds: [embed] });
    } catch (err) {
        await connection.rollback();
        await context.reply({ content: `❌ Gagal Deposit: ${err.message}`, ephemeral: true });
    } finally {
        if (connection) connection.release();
    }
}

// ==========================================
// 2. FUNGSI WITHDRAW (Bank -> Tunai)
// ==========================================
async function runWithdraw(context, user, amount) {
    const userId = user.id;
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        const [rows] = await connection.query('SELECT bank FROM users WHERE user_id = ? FOR UPDATE', [userId]);
        
        if (!rows[0] || rows[0].bank < amount) {
            throw new Error(`Saldo bank tidak cukup! Saldomu: **Lp ${rows[0]?.bank.toLocaleString() || 0}**.`);
        }

        await connection.query('UPDATE users SET bank = bank - ?, uang = uang + ? WHERE user_id = ?', [amount, amount, userId]);
        await connection.commit();

        const embed = new EmbedBuilder()
            .setColor('#FF9800')
            .setTitle('🏧 Penarikan Berhasil')
            .setDescription(`Kamu menarik **Lp ${amount.toLocaleString()}** dari Bank.`);
        
        await context.reply({ embeds: [embed] });
    } catch (err) {
        await connection.rollback();
        await context.reply({ content: `❌ Gagal Tarik: ${err.message}`, ephemeral: true });
    } finally {
        if (connection) connection.release();
    }
}

// ==========================================
// 3. FUNGSI TRANSFER (Bank Pemain A -> Bank Pemain B)
// ==========================================
async function runTransfer(context, sender, targetUser, amount) {
    if (sender.id === targetUser.id) {
        return context.reply({ content: '❌ Kamu tidak bisa transfer ke dirimu sendiri!', ephemeral: true });
    }
    if (targetUser.bot) {
        return context.reply({ content: '❌ Kamu tidak bisa transfer ke Bot!', ephemeral: true });
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        // Cek target apakah sudah register
        const [targetCheck] = await connection.query('SELECT user_id FROM users WHERE user_id = ?', [targetUser.id]);
        if (targetCheck.length === 0) {
            throw new Error(`${targetUser.username} belum terdaftar di kota ini! (Suruh dia register)`);
        }

        // Cek uang pengirim & kunci baris pengirim agar tidak ada transaksi ganda bersamaan
        const [senderData] = await connection.query('SELECT bank FROM users WHERE user_id = ? FOR UPDATE', [sender.id]);
        if (!senderData[0] || senderData[0].bank < amount) {
            throw new Error(`Saldo Bank kamu tidak cukup! Saldomu: **Lp ${senderData[0]?.bank.toLocaleString() || 0}**.`);
        }

        // Lakukan pemindahan uang (Transfer via Bank)
        await connection.query('UPDATE users SET bank = bank - ? WHERE user_id = ?', [amount, sender.id]);
        await connection.query('UPDATE users SET bank = bank + ? WHERE user_id = ?', [amount, targetUser.id]);
        
        await connection.commit();

        const embed = new EmbedBuilder()
            .setColor('#2196F3')
            .setTitle('💸 Transfer Berhasil')
            .setDescription(`Kamu berhasil mengirim **Lp ${amount.toLocaleString()}** ke **${targetUser.username}** via Bank.`);
        
        await context.reply({ embeds: [embed] });
    } catch (err) {
        await connection.rollback();
        await context.reply({ content: `❌ Transfer Gagal: ${err.message}`, ephemeral: true });
    } finally {
        if (connection) connection.release();
    }
}