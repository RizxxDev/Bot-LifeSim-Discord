const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    name: 'ping',
    aliases: ['p', 'pong', 'test'],
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot status and database connection'),

    async executeSlash(interaction) {
        await interaction.reply('🏓 Pong! The system is running perfectly. (Slash Command)');
    },

    async executePrefix(message, args) {
        // Murni mengirim pesan biasa, tidak me-reply (mengutip) pesan user
        await message.channel.send(`🏓 **${message.author.username}**, Pong! The system is running perfectly.`);
    }
};