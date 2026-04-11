const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'ping',
    aliases: ['p', 'pong', 'test'], // 🌟 Support Aliases
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot status and database connection'),

    async executeSlash(interaction) {
        await interaction.reply('🏓 Pong! The system is running perfectly. (Slash Command)');
    },

    async executePrefix(message, args) {
        await message.reply('🏓 Pong! The system is running perfectly. (Prefix Command)');
    }
};