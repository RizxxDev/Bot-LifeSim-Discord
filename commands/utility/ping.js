const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const { isRedisReady } = require('../../botHandlers/redisHandler');
const { infoEmbed, colors } = require('../../utils/ui');
const { send } = require('../../utils/respond');

module.exports = {
    name: 'ping',
    aliases: ['pong', 'status'],
    prefix: true,
    slash: true,
    requiresRegistration: false,
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot, database, and Redis status.'),

    async executeSlash(interaction) {
        await handlePing(interaction, interaction.user);
    },

    async executePrefix(message) {
        await handlePing(message, message.author);
    }
};

async function handlePing(context, user) {
    let databaseStatus = 'Offline';

    try {
        await db.query('SELECT 1 AS ok');
        databaseStatus = 'Online';
    } catch (error) {
        databaseStatus = 'Error';
    }

    const embed = infoEmbed('System Status', 'The bot is responding normally.', user)
        .setColor(databaseStatus === 'Online' ? colors.success : colors.warning)
        .addFields(
            { name: 'Discord', value: 'Online', inline: true },
            { name: 'Database', value: databaseStatus, inline: true },
            { name: 'Redis', value: isRedisReady() ? 'Online' : 'Fallback mode', inline: true }
        );

    return send(context, { embeds: [embed] });
}
