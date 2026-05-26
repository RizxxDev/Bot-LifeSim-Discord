const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const { successEmbed, formatMoney, progressBar, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'work',
    aliases: ['kerja', 'w'],
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Work your current job to earn cash and EXP.'),

    async executeSlash(interaction) {
        await handleWork(interaction, interaction.user);
    },

    async executePrefix(message) {
        await handleWork(message, message.author);
    }
};

async function handleWork(context, user) {
    const now = Date.now();
    let trx;

    try {
        trx = await db.startTransaction();
        const rows = await trx.query(`
            SELECT u.*, s.income, s.cooldown_skill, s.luck, s.defense,
                   j.name, j.min_salary, j.max_salary, j.cooldown, j.min_exp, j.max_exp, j.emoji
            FROM users u
            LEFT JOIN user_skills s ON u.user_id = s.user_id
            LEFT JOIN jobs j ON u.job_id = j.id
            WHERE u.user_id = ? FOR UPDATE
        `, [user.id]);

        const data = rows[0];
        if (!data || !data.job_id) {
            await trx.rollback();
            return sendError(context, user, 'You do not have a job yet. Use `/job list` and `/job apply`.');
        }

        const cooldownReduction = Math.max(0.5, 1 - (0.05 * (data.cooldown_skill || 0)));
        const finalCooldown = data.cooldown * cooldownReduction;
        const timePassed = now - data.last_work;

        if (timePassed < finalCooldown) {
            await trx.rollback();
            const readyAt = Math.round((data.last_work + finalCooldown) / 1000);
            return sendError(context, user, `You are still recovering. You can work again <t:${readyAt}:R>.`);
        }

        const failChance = Math.max(0, 0.05 - ((data.defense || 0) * 0.02));
        if (Math.random() < failChance) {
            await trx.query('UPDATE users SET last_work = ? WHERE user_id = ?', [now, user.id]);
            await trx.commit();
            return sendError(context, user, 'The shift went badly today. You earned nothing, but the cooldown was applied.', { ephemeral: false });
        }

        let salary = Math.floor(Math.random() * (data.max_salary - data.min_salary + 1)) + data.min_salary;
        salary += (data.income || 0) * 50;

        const currentJobLevel = data.job_level || 1;
        const jobBonus = Math.floor(salary * ((currentJobLevel - 1) * 0.05));
        salary += jobBonus;

        const critical = Math.random() < (0.10 + ((data.luck || 0) * 0.05));
        if (critical) salary *= 2;

        const earnedExp = randomInt(data.min_exp || 10, data.max_exp || 20);

        let newExp = data.exp + earnedExp;
        let newLevel = data.level;
        let newSkillPoints = data.skill_points;
        let leveledUp = false;
        const requiredExp = Math.floor(100 * Math.pow(newLevel, 1.2));

        if (newExp >= requiredExp) {
            newExp = 0;
            newLevel++;
            newSkillPoints++;
            leveledUp = true;
        }

        let newJobExp = (data.job_exp || 0) + earnedExp;
        let newJobLevel = currentJobLevel;
        let promoted = false;
        const requiredJobExp = Math.floor(150 * Math.pow(newJobLevel, 1.3));

        if (newJobExp >= requiredJobExp) {
            newJobExp = 0;
            newJobLevel++;
            promoted = true;
        }

        await trx.query(
            'UPDATE users SET cash = cash + ?, exp = ?, level = ?, skill_points = ?, last_work = ?, job_exp = ?, job_level = ? WHERE user_id = ?',
            [salary, newExp, newLevel, newSkillPoints, now, newJobExp, newJobLevel, user.id]
        );
        await trx.commit();

        const embed = successEmbed(
            'Shift Complete',
            `${data.emoji || ''} You worked as **${data.name} (Lv. ${currentJobLevel})** and earned **${formatMoney(salary)}**.`,
            user
        )
            .setColor(colors.money)
            .addFields(
                { name: 'EXP gained', value: `${earnedExp} EXP`, inline: true },
                { name: 'Character EXP', value: progressBar(newExp, Math.floor(100 * Math.pow(newLevel, 1.2)), 8), inline: true },
                { name: 'Job EXP', value: progressBar(newJobExp, Math.floor(150 * Math.pow(newJobLevel, 1.3)), 8), inline: true }
            );

        const notes = [];
        if (critical) notes.push('Lucky payout: salary doubled.');
        if (leveledUp) notes.push(`Character level up: Lv. ${newLevel}.`);
        if (promoted) notes.push(`Job mastery promoted: Lv. ${newJobLevel}.`);
        if (notes.length) embed.addFields({ name: 'Highlights', value: notes.join('\n'), inline: false });

        return send(context, { embeds: [embed] });
    } catch (error) {
        if (trx) await trx.rollback();
        console.error('[WORK ERROR]', error);
        return sendError(context, user, 'Could not process your work shift.');
    }
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
