const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const pool = require('../../database/mariadb');

module.exports = {
    name: 'profile',
    aliases: ['p', 'stats', 'me'],
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Melihat statistik lengkap karaktermu'),

    async executeSlash(interaction) {
        await runProfile(interaction, interaction.user);
    },

    async executePrefix(message, args) {
        await runProfile(message, message.author);
    }
};

async function runProfile(context, user) {
    const userId = user.id;

    try {
        // Mengambil data uang, bank, energi, dan lapar dari tabel users
        const [rows] = await pool.query('SELECT uang, bank, energi, lapar FROM users WHERE user_id = ?', [userId]);
        
        if (rows.length === 0) {
            const failMsg = '❌ Karakter tidak ditemukan. Gunakan `/register` terlebih dahulu.';
            if (context.reply) return context.reply({ content: failMsg, ephemeral: true });
            return context.channel.send(failMsg);
        }

        const userData = rows[0];

        const embed = new EmbedBuilder()
            .setColor('#2196F3')
            .setTitle(`👤 Profil Warga: ${user.username}`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                { name: '💵 Uang Tunai', value: `Lp${userData.uang.toLocaleString()}`, inline: true },
                { name: '🏦 Saldo Bank', value: `Lp${userData.bank.toLocaleString()}`, inline: true },
                { name: '\u200B', value: '\u200B', inline: true }, // Spacer agar baris rapi
                { name: '⚡ Energi', value: `${userData.energi}/100`, inline: true },
                { name: '🍔 Lapar', value: `${userData.lapar}/100`, inline: true },
                { name: '\u200B', value: '\u200B', inline: true }
            )
            .setFooter({ text: 'Gunakan !work untuk bekerja atau !buy untuk membeli makanan' })
            .setTimestamp();

        if (context.reply) await context.reply({ embeds: [embed] });
        else await context.channel.send({ embeds: [embed] });

    } catch (error) {
        console.error('Profile error:', error);
        const errMsg = '❌ Terjadi kesalahan saat mengambil data profil.';
        if (context.reply) await context.reply(errMsg);
        else await context.channel.send(errMsg);
    }
}