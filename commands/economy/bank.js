const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');

module.exports = {
    name: 'bank',
    aliases: ['atm', 'bal', 'balance'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('bank')
        .setDescription('Sistem Perbankan Pusat')
        .addSubcommand(sub => sub.setName('info').setDescription('Cek saldo rekening dan uang tunai'))
        .addSubcommand(sub => 
            sub.setName('deposit')
            .setDescription('Simpan uang tunai ke bank')
            // 🌟 UBAH DARI IntegerOption MENJADI StringOption
            .addStringOption(opt => opt.setName('amount').setDescription('Jumlah uang (angka) atau ketik "all"').setRequired(true))
        )
        .addSubcommand(sub => 
            sub.setName('withdraw')
            .setDescription('Tarik uang dari bank')
            // 🌟 UBAH DARI IntegerOption MENJADI StringOption
            .addStringOption(opt => opt.setName('amount').setDescription('Jumlah uang (angka) atau ketik "all"').setRequired(true))
        )
        .addSubcommand(sub => 
            sub.setName('transfer')
            .setDescription('Transfer uang ke pemain lain')
            .addUserOption(opt => opt.setName('target').setDescription('Penerima').setRequired(true))
            // 🌟 UBAH DARI IntegerOption MENJADI StringOption
            .addStringOption(opt => opt.setName('amount').setDescription('Jumlah uang (angka) atau ketik "all"').setRequired(true))
        ),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand(false) || 'info';
        const amountStr = interaction.options.getString('amount');
        const targetUser = interaction.options.getUser('target');

        await handleBank(interaction, interaction.user, sub, { amountStr, targetUser }, true);
    },

    async executePrefix(message, args) {
        const user = message.author;
        const sub = args[0] ? args[0].toLowerCase() : 'info';

        if (!['info', 'deposit', 'dep', 'withdraw', 'wd', 'transfer', 'tf'].includes(sub)) {
            return message.channel.send(`❌ **${user.username}**, Format: \`!bank\`, \`!bank dep <jumlah/all>\`, \`!bank wd <jumlah/all>\`, \`!bank tf @user <jumlah/all>\``);
        }

        let amountStr = null;
        let targetUser = null;

        // Ambil input string berdasarkan posisi argumen
        if (['deposit', 'dep', 'withdraw', 'wd'].includes(sub)) {
            amountStr = args[1]?.toLowerCase();
        } else if (['transfer', 'tf'].includes(sub)) {
            targetUser = message.mentions.users.first();
            amountStr = args[2]?.toLowerCase();
        }

        // Normalisasi alias command
        let action = sub;
        if (sub === 'dep') action = 'deposit';
        if (sub === 'wd') action = 'withdraw';
        if (sub === 'tf') action = 'transfer';

        await handleBank(message, user, action, { amountStr, targetUser }, false);
    }
};

async function handleBank(context, user, action, data, isSlash) {
    const userId = user.id;

    try {
        const trx = await db.startTransaction();
        let commitNeeded = false;

        try {
            // Kunci baris user untuk keamanan transaksi
            const userDataRow = await trx.query('SELECT cash, bank FROM users WHERE user_id = ? FOR UPDATE', [userId]);
            if (!userDataRow || userDataRow.length === 0) {
                throw new Error("Kamu belum terdaftar! Silakan `/register` terlebih dahulu.");
            }
            const u = userDataRow[0];

            // EKSEKUSI: INFO
            if (action === 'info') {
                await trx.commit(); // Lepas kunci secepatnya karena hanya melihat data
                
                const embed = new EmbedBuilder()
                    .setColor('#3498DB')
                    .setTitle(`🏦 Rekening Bank: ${user.username}`)
                    .setThumbnail(user.displayAvatarURL())
                    .addFields(
                        { name: '💵 Uang Tunai (Cash)', value: `Lp ${u.cash.toLocaleString()}`, inline: true },
                        { name: '💳 Saldo Bank', value: `Lp ${u.bank.toLocaleString()}`, inline: true }
                    )
                    .setFooter({ text: 'Gunakan !bank dep <jumlah/all> atau !bank wd <jumlah/all>' });

                return isSlash ? context.reply({ embeds: [embed] }) : context.channel.send({ embeds: [embed] });
            }

            // ==========================================
            // 🌟 LOGIKA UNTUK KATA "ALL"
            // ==========================================
            let amount = 0;
            if (!data.amountStr) throw new Error("Masukkan jumlah uang atau ketik `all`.");

            if (data.amountStr === 'all') {
                if (action === 'deposit') amount = u.cash; // Setor semua uang tunai
                else if (action === 'withdraw' || action === 'transfer') amount = u.bank; // Tarik/Transfer semua uang di bank
            } else {
                amount = parseInt(data.amountStr); // Jika bukan "all", jadikan angka biasa
            }

            // Validasi Angka
            if (amount === 0) throw new Error("Uangmu kosong (Lp 0)! Tidak ada yang bisa diproses.");
            if (isNaN(amount) || amount < 0) throw new Error("Jumlah harus berupa angka atau ketik `all`!");

            // EKSEKUSI: DEPOSIT
            if (action === 'deposit') {
                if (u.cash < amount) throw new Error(`Uang tunaimu tidak cukup! (Cash: Lp ${u.cash.toLocaleString()})`);
                
                await trx.query('UPDATE users SET cash = cash - ?, bank = bank + ? WHERE user_id = ?', [amount, amount, userId]);
                commitNeeded = true;

                const msg = `📥 **${user.username}** menyetor **Lp ${amount.toLocaleString()}** ke dalam Bank.`;
                isSlash ? await context.reply(msg) : await context.channel.send(msg);
            }

            // EKSEKUSI: WITHDRAW
            else if (action === 'withdraw') {
                if (u.bank < amount) throw new Error(`Saldo Bank tidak cukup! (Saldo: Lp ${u.bank.toLocaleString()})`);
                
                await trx.query('UPDATE users SET cash = cash + ?, bank = bank - ? WHERE user_id = ?', [amount, amount, userId]);
                commitNeeded = true;

                const msg = `📤 **${user.username}** menarik **Lp ${amount.toLocaleString()}** dari Bank.`;
                isSlash ? await context.reply(msg) : await context.channel.send(msg);
            }

            // EKSEKUSI: TRANSFER
            else if (action === 'transfer') {
                if (!data.targetUser) throw new Error("Tag (@) pemain yang ingin ditransfer!");
                if (data.targetUser.id === userId) throw new Error("Tidak bisa transfer ke diri sendiri.");
                if (data.targetUser.bot) throw new Error("Tidak bisa transfer ke Bot.");
                if (u.bank < amount) throw new Error(`Saldo Bank tidak cukup! (Saldo: Lp ${u.bank.toLocaleString()})`);

                const targetCheck = await trx.query('SELECT user_id FROM users WHERE user_id = ? FOR UPDATE', [data.targetUser.id]);
                if (!targetCheck || targetCheck.length === 0) throw new Error(`**${data.targetUser.username}** belum mendaftar sebagai warga!`);

                await trx.query('UPDATE users SET bank = bank - ? WHERE user_id = ?', [amount, userId]);
                await trx.query('UPDATE users SET bank = bank + ? WHERE user_id = ?', [amount, data.targetUser.id]);
                commitNeeded = true;

                const msg = `💸 **${user.username}** mentransfer **Lp ${amount.toLocaleString()}** kepada **${data.targetUser.username}** melalui Bank.`;
                isSlash ? await context.reply(msg) : await context.channel.send(msg);
            }

            if (commitNeeded) {
                await trx.commit();
            }

        } catch (err) {
            await trx.rollback();
            throw err;
        }

    } catch (error) {
        const errMsg = `❌ **${user.username}**, ${error.message}`;
        if (isSlash) await context.reply({ content: errMsg, ephemeral: true });
        else await context.channel.send(errMsg);
    }
}