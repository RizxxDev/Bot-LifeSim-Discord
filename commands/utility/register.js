const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/mariadb'); // Pastikan path ini benar

module.exports = {
    name: 'register',
    aliases: ['reg', 'daftar', 'start'], // Bisa dipanggil dengan !register, !reg, atau !daftar
    prefix: true,
    slash: true,
    cooldown: 10, // Cooldown agak lama karena ini command 1x pakai
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Mendaftar sebagai warga baru dan dapatkan modal awal!'),

    async executeSlash(interaction) {
        await handleRegister(interaction, interaction.user);
    },

    async executePrefix(message, args) {
        await handleRegister(message, message.author);
    }
};

// ==========================================
// FUNGSI UTAMA REGISTRASI
// ==========================================
async function handleRegister(context, user) {
    const userId = user.id;

    try {
        // 1. Cek apakah user sudah terdaftar di database
        const [existingUser] = await db.query('SELECT user_id FROM users WHERE user_id = ?', [userId]);

        if (existingUser && existingUser.length > 0) {
            const msg = '❌ Kamu sudah terdaftar sebagai warga di kota ini!';
            // Ephemeral (hanya bisa dilihat user) jika lewat slash command
            return context.reply ? await context.reply({ content: msg, ephemeral: true }) : await context.channel.send(msg);
        }

        // 2. Tentukan Modal Awal untuk pemain baru
        const modalAwal = 10000; 

        // 3. Masukkan data pemain baru ke database
        // Kita juga set energi dan lapar ke 100 (kondisi bugar)
        await db.query(
            'INSERT INTO users (user_id, uang, bank, energi, lapar) VALUES (?, ?, 0, 100, 100)', 
            [userId, modalAwal]
        );

        // 4. Buat Tampilan Embed Kartu Identitas (KTP)
        const embed = new EmbedBuilder()
            .setColor('#2ECC71') // Warna Hijau Sukses
            .setTitle('🛂 Registrasi Berhasil!')
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setDescription(`Selamat datang di kota, **${user.username}**!\nKamu sekarang resmi menjadi warga.`)
            .addFields(
                { name: '💰 Modal Awal', value: `Lp ${modalAwal.toLocaleString()}`, inline: true },
                { name: '⚡ Energi', value: '100/100', inline: true },
                { name: '🍔 Lapar', value: '100/100', inline: true },
                { name: '📖 Panduan', value: 'Ketik `/help` atau `!help` untuk melihat daftar command yang bisa kamu gunakan.' }
            )
            .setFooter({ text: 'The Real Life Sim - ID: ' + userId })
            .setTimestamp();

        // 5. Kirim pesan ke Discord
        if (context.reply) await context.reply({ embeds: [embed] });
        else await context.channel.send({ embeds: [embed] });

    } catch (error) {
        console.error('[REGISTER ERROR]', error);
        const errorMsg = '❌ Terjadi kesalahan saat melakukan registrasi. Database mungkin sedang sibuk.';
        
        if (context.reply) await context.reply({ content: errorMsg, ephemeral: true });
        else await context.channel.send(errorMsg);
    }
}