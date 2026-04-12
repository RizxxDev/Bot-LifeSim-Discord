const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const config = require('../../config.json'); // Pastikan path config benar

module.exports = {
    name: 'register',
    aliases: ['reg', 'signup', 'start'],
    prefix: true,
    slash: true,
    cooldown: 10,
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register as a new citizen and receive starting capital!'),

    async executeSlash(interaction) {
        await handleRegister(interaction, interaction.user, true);
    },

    async executePrefix(message, args) {
        await handleRegister(message, message.author, false);
    }
};

async function handleRegister(context, user, isSlash) {
    try {
        const existingUser = await db.query('SELECT user_id FROM users WHERE user_id = ?', [user.id]);
        if (existingUser && existingUser.length > 0) {
            const msg = `❌ **${user.username}**, you are already registered as a citizen!`;
            if (isSlash) return context.reply({ content: msg, ephemeral: true });
            return context.channel.send(msg);
        }

        // 🌟 Mengambil Modal Awal dari config.json
        const startCapital = config.economy.startingCash || 10000; 
        
        await db.query(
            'INSERT INTO users (user_id, cash, bank, energy, hunger) VALUES (?, ?, 0, 100, 100)', 
            [user.id, startCapital]
        );

        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('🛂 Registration Successful!')
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setDescription(`Welcome to the city, **${user.username}**!\nYou are now officially a citizen.`)
            .addFields(
                { name: '💰 Starting Cash', value: `Lp ${startCapital.toLocaleString()}`, inline: true },
                { name: '⚡ Energy', value: '100/100', inline: true },
                { name: '🍔 Hunger', value: '100/100', inline: true }
            )
            .setFooter({ text: 'Type /help to see available commands.' })
            .setTimestamp();

        if (isSlash) await context.reply({ embeds: [embed] });
        else await context.channel.send({ embeds: [embed] });
    } catch (error) {
        console.error('[REGISTER ERROR]', error);
        const errMsg = `❌ **${user.username}**, registration failed due to a database error.`;
        if (isSlash) await context.reply({ content: errMsg, ephemeral: true });
        else await context.channel.send(errMsg);
    }
}