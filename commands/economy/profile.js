const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');

module.exports = {
    name: 'profile',
    aliases: ['p', 'stats', 'me'],
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View your character\'s full statistics'),

    async executeSlash(interaction) {
        await runProfile(interaction, interaction.user, true);
    },

    async executePrefix(message, args) {
        await runProfile(message, message.author, false);
    }
};

async function runProfile(context, user, isSlash) {
    try {
        const rows = await db.query('SELECT cash, bank, energy, hunger FROM users WHERE user_id = ?', [user.id]);
        
        if (!rows || rows.length === 0) {
            const failMsg = `❌ **${user.username}**, character not found. Please use \`/register\` first.`;
            if (isSlash) return context.reply({ content: failMsg, ephemeral: true });
            return context.channel.send(failMsg);
        }

        const userData = rows[0];
        const embed = new EmbedBuilder()
            .setColor('#2196F3')
            .setTitle(`👤 Citizen Profile: ${user.username}`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                { name: '💵 Cash', value: `Lp ${userData.cash.toLocaleString()}`, inline: true },
                { name: '🏦 Bank Balance', value: `Lp ${userData.bank.toLocaleString()}`, inline: true },
                { name: '\u200B', value: '\u200B', inline: true },
                { name: '⚡ Energy', value: `${userData.energy}/100`, inline: true },
                { name: '🍔 Hunger', value: `${userData.hunger}/100`, inline: true },
                { name: '\u200B', value: '\u200B', inline: true }
            )
            .setFooter({ text: 'Use !work to earn money or !buy to get food' })
            .setTimestamp();

        if (isSlash) await context.reply({ embeds: [embed] });
        else await context.channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('Profile error:', error);
        const errMsg = `❌ **${user.username}**, an error occurred while retrieving profile data.`;
        if (isSlash) await context.reply({ content: errMsg, ephemeral: true });
        else await context.channel.send(errMsg);
    }
}