const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../database/mariadb'); // Pastikan path ini benar

module.exports = {
    name: 'daily',
    aliases: ['claim', 'd'], // Bisa dipanggil dengan !daily, !claim, atau !d
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Klaim uang saku harianmu dan kumpulkan bonus streak!'),

    async executeSlash(interaction) {
        await handleDaily(interaction, interaction.user);
    },

    async executePrefix(message, args) {
        await handleDaily(message, message.author);
    }
};

// ==========================================
// FUNGSI UTAMA DAILY & STREAK
// ==========================================
async function handleDaily(context, user) {
    const userId = user.id;
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000; // 24 jam dalam milidetik

    let conn;
    try {
        // Gunakan transaksi untuk mencegah duplikasi (bug spam)
        conn = await db.getConnection();
        await conn.beginTransaction();

        // Kunci data user sementara (FOR UPDATE)
        const [rows] = await conn.query('SELECT uang, last_daily, daily_streak FROM users WHERE user_id = ? FOR UPDATE', [userId]);

        // Jika entah kenapa data tidak ada (meski sudah dicek di index.js)
        if (!rows || rows.length === 0) throw new Error("Data pemain tidak ditemukan.");

        const userData = rows[0];
        const lastDaily = userData.last_daily || 0;
        let streak = userData.daily_streak || 0;

        const timePassed = now - lastDaily;

        // 1. CEK: Apakah belum 24 jam?
        if (timePassed < ONE_DAY && lastDaily !== 0) {
            const timeLeft = lastDaily + ONE_DAY;
            const expiredTimestamp = Math.round(timeLeft / 1000);
            
            await conn.rollback(); // Batalkan transaksi
            
            const waitMsg = `⏳ Sabar bos! Kamu sudah mengambil jatah harian. Kembali lagi <t:${expiredTimestamp}:R>.`;
            return context.reply ? await context.reply({ content: waitMsg, ephemeral: true }) : await context.channel.send(waitMsg);
        }

        // 2. CEK: Apakah streak hangus? (Lebih dari 48 jam tidak claim)
        let isStreakBroken = false;
        if (timePassed > (ONE_DAY * 2) && lastDaily !== 0) {
            isStreakBroken = true;
            streak = 1; // Hangus, mulai dari 1 lagi
        } else {
            streak += 1; // Lanjut terus!
        }

        // 3. KALKULASI HADIAH
        const baseReward = 5000; // Hadiah dasar: Rp 5.000
        const bonusPerStreak = 1000; // Tiap nambah streak, dapat tambahan Rp 1.000
        const streakBonus = streak * bonusPerStreak;
        const totalReward = baseReward + streakBonus;

        // 4. UPDATE DATABASE
        await conn.query(
            'UPDATE users SET uang = uang + ?, last_daily = ?, daily_streak = ? WHERE user_id = ?', 
            [totalReward, now, streak, userId]
        );
        await conn.commit(); // Simpan permanen

        // 5. BUAT TAMPILAN PESAN
        const embed = new EmbedBuilder()
            .setColor('#FFD700') // Warna Emas
            .setTitle('🎁 Hadiah Harian Berhasil Diklaim!')
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setDescription(`Kamu mendapatkan uang tunai sebesar **Lp ${totalReward.toLocaleString()}**!`)
            .addFields(
                { name: '🔥 Streak Saat Ini', value: `${streak} Hari`, inline: true },
                { name: '💰 Bonus Streak', value: `+Lp ${streakBonus.toLocaleString()}`, inline: true }
            )
            .setTimestamp();

        // Tambahkan peringatan jika streak-nya baru saja hancur
        if (isStreakBroken) {
            embed.setFooter({ text: 'Yah, streak kamu sebelumnya hangus karena bolos 1 hari! Mulai dari awal lagi ya.' });
        } else {
            embed.setFooter({ text: 'Jangan lupa kembali besok agar streak tidak hangus!' });
        }

        if (context.reply) await context.reply({ embeds: [embed] });
        else await context.channel.send({ embeds: [embed] });

    } catch (error) {
        if (conn) await conn.rollback(); // Batalkan semua jika error
        console.error('[DAILY ERROR]', error);
        
        const errorMsg = '❌ Terjadi kesalahan saat memproses klaim harian.';
        if (context.reply) await context.reply({ content: errorMsg, ephemeral: true });
        else await context.channel.send(errorMsg);
        
    } finally {
        if (conn) conn.release(); // Kembalikan koneksi ke Pool
    }
}