const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const { infoEmbed, formatMoney, progressBar, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'profile',
    aliases: ['p', 'stats', 'me'],
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View your citizen profile.'),

    async executeSlash(interaction) {
        await runProfile(interaction, interaction.user);
    },

    async executePrefix(message) {
        await runProfile(message, message.author);
    }
};

async function runProfile(context, user) {
    try {
        const rows = await db.query(`
            SELECT u.*, j.name as job_name, j.emoji as job_emoji
            FROM users u
            LEFT JOIN jobs j ON u.job_id = j.id
            WHERE u.user_id = ?
        `, [user.id]);

        if (!rows || rows.length === 0) {
            return sendError(context, user, 'Profile not found. Use `/register` first.');
        }

        const data = rows[0];
        const requiredExp = Math.floor(100 * Math.pow(data.level, 1.2));
        const jobDisplay = data.job_id ? `${data.job_emoji || ''} ${data.job_name}`.trim() : 'Unemployed';

        const embed = infoEmbed(`Citizen Profile: ${user.username}`, null, user)
            .setColor(colors.primary)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Career', value: jobDisplay, inline: false },
                { name: 'Level', value: `Lv. ${data.level}`, inline: true },
                { name: 'EXP', value: progressBar(data.exp, requiredExp, 8), inline: true },
                { name: 'Skill points', value: `${data.skill_points} SP`, inline: true },
                { name: 'Cash', value: formatMoney(data.cash), inline: true },
                { name: 'Bank', value: formatMoney(data.bank), inline: true },
                { name: 'Status', value: `Energy ${data.energy}% | Hunger ${data.hunger}%`, inline: true }
            )
            .setFooter({ text: 'Next: /job list, /skill view, or /bank info' });

        return send(context, { embeds: [embed] });
    } catch (error) {
        console.error('[PROFILE ERROR]', error);
        return sendError(context, user, 'Could not load your profile.');
    }
}
