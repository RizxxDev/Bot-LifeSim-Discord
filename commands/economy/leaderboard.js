const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');

module.exports = {
    name: 'leaderboard',
    aliases: ['lb', 'top', 'rich'],
    prefix: true,
    slash: true,
    cooldown: 10, // Cooldown agak lama agar tidak spam request API Discord
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Melihat daftar 10 warga terkaya di kota (Cash + Bank)'),

    async executeSlash(interaction) {
        await handleLeaderboard(interaction, interaction.client, interaction.user, true);
    },

    async executePrefix(message, args) {
        await handleLeaderboard(message, message.client, message.author, false);
    }
};

async function handleLeaderboard(context, client, commandUser, isSlash) {
    try {
        // Ambil 10 orang dengan total uang terbanyak (cash + bank) menggunakan SQL Math
        const rows = await db.query(`
            SELECT user_id, cash, bank, (cash + bank) AS total_wealth 
            FROM users 
            ORDER BY total_wealth DESC 
            LIMIT 10
        `);

        if (!rows || rows.length === 0) {
            const msg = `❌ **${commandUser.username}**, belum ada data orang kaya di kota ini.`;
            return isSlash ? context.reply({ content: msg, ephemeral: true }) : context.channel.send(msg);
        }

        const embed = new EmbedBuilder()
            .setColor('#FFD700') // Warna Emas
            .setTitle('🏆 Top 10 Orang Terkaya')
            .setThumbnail(client.user.displayAvatarURL())
            .setFooter({ text: `Diminta oleh ${commandUser.username}`, iconURL: commandUser.displayAvatarURL({ dynamic: true }) })
            .setTimestamp();

        let leaderboardText = '';
        
        // Looping untuk menyusun daftar pemain
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            let username = 'Unknown Citizen';
            
            try {
                // Fetch data user dari Discord API untuk mendapatkan nama asli
                const user = await client.users.fetch(row.user_id);
                if (user) username = user.username;
            } catch (e) {
                // Jika user sudah menghapus akun atau bot gagal menemukan user
                username = `Warga Keluar (ID: ${row.user_id})`;
            }

            // Memberikan medali khusus untuk ranking 1, 2, dan 3
            let medal = '🔹';
            if (i === 0) medal = '🥇';
            else if (i === 1) medal = '🥈';
            else if (i === 2) medal = '🥉';

            // Format Angka agar memiliki titik (contoh: 1000000 -> 1.000.000)
            const totalStr = parseInt(row.total_wealth).toLocaleString();
            const cashStr = parseInt(row.cash).toLocaleString();
            const bankStr = parseInt(row.bank).toLocaleString();

            leaderboardText += `${medal} **#${i + 1} | ${username}**\n`;
            leaderboardText += `└ 💰 **Lp ${totalStr}** (💵 ${cashStr} | 🏦 ${bankStr})\n\n`;
        }

        embed.setDescription(leaderboardText);

        // Mengirim balasan sesuai standar anti-ping
        return isSlash ? context.reply({ embeds: [embed] }) : context.channel.send({ embeds: [embed] });

    } catch (error) {
        console.error('[LEADERBOARD ERROR]', error);
        const errMsg = `❌ **${commandUser.username}**, terjadi kesalahan saat mengambil data leaderboard.`;
        return isSlash ? context.reply({ content: errMsg, ephemeral: true }) : context.channel.send(errMsg);
    }
}