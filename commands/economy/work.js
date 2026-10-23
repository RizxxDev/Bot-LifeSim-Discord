const { SlashCommandBuilder } = require('discord.js');
const economy = require('../../services/economyService');
const { successEmbed, formatMoney, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

const jobs = [
    'completed a delivery shift',
    'helped at the market',
    'fixed a broken terminal',
    'handled freelance admin work',
    'sold handmade goods'
];

module.exports = {
    name: 'work',
    aliases: ['kerja', 'w'],
    prefix: true,
    slash: true,
    requiresRegistration: false,
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Work to earn cash.'),

    async executeSlash(interaction) {
        await handleWork(interaction, interaction.user);
    },

    async executePrefix(message) {
        await handleWork(message, message.author);
    }
};

async function handleWork(context, user) {
    try {
        const guildId = economy.getGuildId(context);
        const result = await economy.work(guildId, user.id);

        if (!result.worked) {
            return sendError(context, user, `You are still recovering. You can work again <t:${result.availableAt}:R>.`);
        }

        const job = jobs[Math.floor(Math.random() * jobs.length)];
        const embed = successEmbed(
            'Shift Complete',
            `You ${job} and earned **${formatMoney(result.reward)}**.`,
            user
        )
            .setColor(colors.money)
            .addFields({ name: 'Cash', value: formatMoney(result.profile.cash), inline: true });

        return send(context, { embeds: [embed] });
    } catch (error) {
        console.error('[WORK ERROR]', error);
        return sendError(context, user, error.message || 'Could not process your work shift.');
    }
}
