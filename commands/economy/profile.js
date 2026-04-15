const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');

module.exports = {
    name: 'profile',
    aliases: ['p', 'stats', 'me'],
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Lihat statistik lengkap karaktermu'),

    async executeSlash(interaction) {
        await runProfile(interaction, interaction.user, true);
    },

    async executePrefix(message, args) {
        await runProfile(message, message.author, false);
    }
};

async function runProfile(context, user, isSlash) {
    try {
        const rows = await db.query(`
            SELECT u.*, j.name as job_name, j.emoji as job_emoji 
            FROM users u 
            LEFT JOIN jobs j ON u.job_id = j.id 
            WHERE u.user_id = ?
        `, [user.id]);
        
        if (!rows || rows.length === 0) {
            const failMsg = `❌ **${user.username}**, karakter tidak ditemukan. Gunakan \`/register\` terlebih dahulu.`;
            if (isSlash) return context.reply({ content: failMsg, ephemeral: true });
            return context.channel.send(failMsg);
        }

        const u = rows[0];
        const requiredExp = Math.floor(100 * Math.pow(u.level, 1.2));
        const jobDisplay = u.job_id ? `${u.job_emoji} ${u.job_name}` : '❌ Pengangguran';

        const embed = new EmbedBuilder()
            .setColor('#2196F3')
            .setTitle(`👤 Profil Warga: ${user.username}`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                { name: '💼 Pekerjaan', value: jobDisplay, inline: false },
                { name: '⭐ Level', value: `Level ${u.level}`, inline: true },
                { name: '📈 EXP', value: `${u.exp} / ${requiredExp}`, inline: true },
                { name: '🎯 Skill Points', value: `${u.skill_points} SP`, inline: true },
                { name: '💵 Uang Tunai', value: `Lp ${u.cash.toLocaleString()}`, inline: true },
                { name: '🏦 Saldo Bank', value: `Lp ${u.bank.toLocaleString()}`, inline: true },
                { name: '\u200B', value: '\u200B', inline: true }
            )
            .setFooter({ text: 'Gunakan !job list untuk mencari kerja atau !skill untuk upgrade keahlian' })
            .setTimestamp();

        if (isSlash) await context.reply({ embeds: [embed] });
        else await context.channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Profile error:', error);
        const errMsg = `❌ **${user.username}**, terjadi kesalahan saat mengambil data profil.`;
        if (isSlash) await context.reply({ content: errMsg, ephemeral: true });
        else await context.channel.send(errMsg);
    }
}