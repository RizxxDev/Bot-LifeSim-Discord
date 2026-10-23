const { SlashCommandBuilder } = require('discord.js');
const economy = require('../../services/economyService');
const { successEmbed, formatMoney, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'daily',
    aliases: ['claim', 'd'],
    prefix: true,
    slash: true,
    requiresRegistration: false,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily economy reward.'),

    async executeSlash(interaction) {
        await handleDaily(interaction, interaction.user);
    },

    async executePrefix(message) {
        await handleDaily(message, message.author);
    }
};

async function handleDaily(context, user) {
    try {
        const guildId = economy.getGuildId(context);
        const result = await economy.claimDaily(guildId, user.id);

        if (!result.claimed) {
            return sendError(context, user, `Daily reward already claimed. Come back <t:${result.availableAt}:R>.`);
        }

        const embed = successEmbed(
            'Daily Reward Claimed',
            `You received **${formatMoney(result.reward)}** in cash.`,
            user
        )
            .setColor(colors.warning)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Current streak', value: `${result.streak} day${result.streak === 1 ? '' : 's'}`, inline: true },
                { name: 'Cash', value: formatMoney(result.profile.cash), inline: true }
            )
            .setFooter({ text: result.streakBroken ? 'Your streak was reset because you missed a day.' : 'Come back tomorrow to keep the streak alive.' });

        return send(context, { embeds: [embed] });
    } catch (error) {
        console.error('[DAILY ERROR]', error);
        return sendError(context, user, error.message || 'Could not process your daily reward.');
    }
}
