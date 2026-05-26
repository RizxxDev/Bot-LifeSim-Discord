const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const config = require('../../config.json');
const { successEmbed, formatMoney, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'daily',
    aliases: ['claim', 'd'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily reward and build a streak.'),

    async executeSlash(interaction) {
        await handleDaily(interaction, interaction.user);
    },

    async executePrefix(message) {
        await handleDaily(message, message.author);
    }
};

async function handleDaily(context, user) {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    let transaction;

    try {
        transaction = await db.startTransaction();
        const rows = await transaction.query('SELECT cash, last_daily, daily_streak FROM users WHERE user_id = ? FOR UPDATE', [user.id]);
        if (!rows || rows.length === 0) throw new Error('Profile not found. Use `/register` first.');

        const data = rows[0];
        const lastDaily = data.last_daily || 0;
        const timePassed = now - lastDaily;

        if (timePassed < oneDay && lastDaily !== 0) {
            await transaction.rollback();
            const availableAt = Math.round((lastDaily + oneDay) / 1000);
            return sendError(context, user, `Daily reward already claimed. Come back <t:${availableAt}:R>.`);
        }

        let streak = data.daily_streak || 0;
        const streakBroken = timePassed > oneDay * 2 && lastDaily !== 0;
        streak = streakBroken ? 1 : streak + 1;

        const baseReward = config.economy?.dailyBaseReward || 5000;
        const streakBonus = streak * (config.economy?.dailyStreakBonus || 1000);
        const totalReward = baseReward + streakBonus;

        await transaction.query(
            'UPDATE users SET cash = cash + ?, last_daily = ?, daily_streak = ? WHERE user_id = ?',
            [totalReward, now, streak, user.id]
        );
        await transaction.commit();

        const embed = successEmbed(
            'Daily Reward Claimed',
            `You received **${formatMoney(totalReward)}** in cash.`,
            user
        )
            .setColor(colors.warning)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: 'Current streak', value: `${streak} day${streak === 1 ? '' : 's'}`, inline: true },
                { name: 'Streak bonus', value: formatMoney(streakBonus), inline: true }
            )
            .setFooter({ text: streakBroken ? 'Your streak was reset because you missed a day.' : 'Come back tomorrow to keep the streak alive.' });

        return send(context, { embeds: [embed] });
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('[DAILY ERROR]', error);
        return sendError(context, user, error.message || 'Could not process your daily reward.');
    }
}
