const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const config = require('../../config.json');
const { successEmbed, formatMoney } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'register',
    aliases: ['reg', 'start'],
    prefix: true,
    slash: true,
    requiresRegistration: false,
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Create your citizen profile and receive starting cash.'),

    async executeSlash(interaction) {
        await handleRegister(interaction, interaction.user);
    },

    async executePrefix(message) {
        await handleRegister(message, message.author);
    }
};

async function handleRegister(context, user) {
    try {
        const existingUser = await db.query('SELECT user_id FROM users WHERE user_id = ?', [user.id]);
        if (existingUser && existingUser.length > 0) {
            return sendError(context, user, 'You already have a citizen profile.');
        }

        const startCapital = config.economy?.startingCash || 10000;
        await db.query(
            'INSERT INTO users (user_id, cash, bank, energy, hunger) VALUES (?, ?, 0, 100, 100)',
            [user.id, startCapital]
        );
        await db.query('INSERT IGNORE INTO user_skills (user_id) VALUES (?)', [user.id]);
        await db.query('INSERT IGNORE INTO user_farms (user_id) VALUES (?)', [user.id]);

        const embed = successEmbed(
            'Citizen Profile Created',
            `Welcome, **${user.username}**. Your city life starts now.`,
            user
        )
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Starting cash', value: formatMoney(startCapital), inline: true },
                { name: 'Next step', value: '`/job list` or `!job list`', inline: true }
            );

        return send(context, { embeds: [embed] });
    } catch (error) {
        console.error('[REGISTER ERROR]', error);
        return sendError(context, user, 'Could not create your citizen profile.');
    }
}
