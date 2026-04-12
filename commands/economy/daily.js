const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler'); 

module.exports = {
    name: 'daily',
    aliases: ['claim', 'd'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily allowance and build your streak!'),

    async executeSlash(interaction) {
        // Tanda 'true' berarti ini dari Slash Command
        await handleDaily(interaction, interaction.user, true);
    },

    async executePrefix(message, args) {
        // Tanda 'false' berarti ini dari Prefix Command (!daily)
        await handleDaily(message, message.author, false);
    }
};

async function handleDaily(context, user, isSlash) {
    const userId = user.id;
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    let transaction;
    try {
        transaction = await db.startTransaction();
        const rows = await transaction.query('SELECT cash, last_daily, daily_streak FROM users WHERE user_id = ? FOR UPDATE', [userId]);

        if (!rows || rows.length === 0) throw new Error("Character data not found.");

        const userData = rows[0];
        const lastDaily = userData.last_daily || 0;
        let streak = userData.daily_streak || 0;

        const timePassed = now - lastDaily;

        if (timePassed < ONE_DAY && lastDaily !== 0) {
            const timeLeft = lastDaily + ONE_DAY;
            const expiredTimestamp = Math.round(timeLeft / 1000);
            await transaction.rollback();
            
            const waitMsg = `⏳ **${user.username}**, please wait! You've already claimed your daily reward. Come back <t:${expiredTimestamp}:R>.`;
            
            // 🌟 JIKA SLASH COMMAND = WAJIB REPLY (Ephemeral), JIKA PREFIX = KIRIM CHAT BIASA
            if (isSlash) return await context.reply({ content: waitMsg, ephemeral: true });
            return await context.channel.send({ content: waitMsg });
        }

        let isStreakBroken = false;
        if (timePassed > (ONE_DAY * 2) && lastDaily !== 0) {
            isStreakBroken = true;
            streak = 1;
        } else {
            streak += 1;
        }

        const baseReward = 5000;
        const bonusPerStreak = 1000;
        const streakBonus = streak * bonusPerStreak;
        const totalReward = baseReward + streakBonus;

        await transaction.query(
            'UPDATE users SET cash = cash + ?, last_daily = ?, daily_streak = ? WHERE user_id = ?', 
            [totalReward, now, streak, userId]
        );
        await transaction.commit();

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('🎁 Daily Reward Claimed!')
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .setDescription(`**${user.username}** received **Lp ${totalReward.toLocaleString()}** in cash!`)
            .addFields(
                { name: '🔥 Current Streak', value: `${streak} Days`, inline: true },
                { name: '💰 Streak Bonus', value: `+Lp ${streakBonus.toLocaleString()}`, inline: true }
            )
            .setTimestamp();

        if (isStreakBroken) embed.setFooter({ text: 'Oh no! Your streak was reset because you missed a day.' });
        else embed.setFooter({ text: 'Keep it up! Don\'t forget to claim again tomorrow.' });

        // 🌟 MENGGUNAKAN CHANNEL.SEND UNTUK PREFIX COMMAND (TIDAK ADA GARIS REPLY)
        if (isSlash) await context.reply({ embeds: [embed] });
        else await context.channel.send({ embeds: [embed] });

    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('[DAILY ERROR]', error);
        
        const errorMsg = `❌ **${user.username}**, an error occurred while processing your daily claim.`;
        
        // 🌟 MENGHINDARI REPLY SAAT ERROR DI PREFIX
        if (isSlash) await context.reply({ content: errorMsg, ephemeral: true });
        else await context.channel.send({ content: errorMsg });
    }
}