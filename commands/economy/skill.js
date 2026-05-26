const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const { infoEmbed, successEmbed, formatMoney, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

const validSkills = ['income', 'cooldown_skill', 'luck', 'defense'];
const labels = {
    income: 'Income',
    cooldown_skill: 'Cooldown',
    luck: 'Luck',
    defense: 'Defense'
};

module.exports = {
    name: 'skill',
    aliases: ['skills', 'upgrade'],
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('skill')
        .setDescription('View, upgrade, or reset your skill tree.')
        .addSubcommand(sub => sub.setName('view').setDescription('View your skills and skill points.'))
        .addSubcommand(sub => sub.setName('reset').setDescription('Reset all skills for Lp 1,000.'))
        .addSubcommand(sub => sub.setName('upgrade').setDescription('Upgrade a skill.')
            .addStringOption(opt => opt.setName('type').setDescription('Skill to upgrade.').setRequired(true)
                .addChoices(
                    { name: 'Income (+50 base salary)', value: 'income' },
                    { name: 'Cooldown (-5% work cooldown)', value: 'cooldown_skill' },
                    { name: 'Luck (+5% double salary chance)', value: 'luck' },
                    { name: 'Defense (-2% work failure chance)', value: 'defense' }
                ))),

    async executeSlash(interaction) {
        await handleSkill(interaction, interaction.user, interaction.options.getSubcommand(), interaction.options.getString('type'));
    },

    async executePrefix(message, args) {
        await handleSkill(message, message.author, args[0]?.toLowerCase(), args[1]?.toLowerCase());
    }
};

async function handleSkill(context, user, sub, skillType) {
    if (!sub || !['view', 'reset', 'upgrade'].includes(sub)) {
        return sendError(context, user, 'Usage: `!skill view`, `!skill upgrade <type>`, or `!skill reset`.');
    }

    await db.query('INSERT IGNORE INTO user_skills (user_id) VALUES (?)', [user.id]);

    if (sub === 'view') {
        const userRows = await db.query('SELECT skill_points FROM users WHERE user_id = ?', [user.id]);
        const skillRows = await db.query('SELECT * FROM user_skills WHERE user_id = ?', [user.id]);
        const skills = skillRows[0];

        const embed = infoEmbed('Skill Tree', `Available points: **${userRows[0].skill_points} SP**`, user)
            .setColor(colors.inventory);

        for (const id of validSkills) {
            const level = skills[id] || 0;
            embed.addFields({
                name: labels[id],
                value: `Level ${level}/5\nCost: ${level >= 5 ? 'MAX' : `${level + 1} SP`}`,
                inline: true
            });
        }

        return send(context, { embeds: [embed] });
    }

    if (sub === 'upgrade') {
        if (!validSkills.includes(skillType)) {
            return sendError(context, user, 'Choose one skill: `income`, `cooldown_skill`, `luck`, or `defense`.');
        }

        let trx;
        try {
            trx = await db.startTransaction();
            const userRows = await trx.query('SELECT skill_points FROM users WHERE user_id = ? FOR UPDATE', [user.id]);
            const skillRows = await trx.query(`SELECT ${skillType} FROM user_skills WHERE user_id = ? FOR UPDATE`, [user.id]);
            const currentLevel = skillRows[0][skillType] || 0;
            const cost = currentLevel + 1;

            if (currentLevel >= 5) throw new Error('This skill is already maxed.');
            if (userRows[0].skill_points < cost) throw new Error(`Not enough SP. Required: ${cost} SP.`);

            await trx.query('UPDATE users SET skill_points = skill_points - ? WHERE user_id = ?', [cost, user.id]);
            await trx.query(`UPDATE user_skills SET ${skillType} = ${skillType} + 1 WHERE user_id = ?`, [user.id]);
            await trx.commit();

            return send(context, { embeds: [successEmbed('Skill Upgraded', `**${labels[skillType]}** is now Level ${currentLevel + 1}.`, user)] });
        } catch (error) {
            if (trx) await trx.rollback();
            return sendError(context, user, error.message);
        }
    }

    let trx;
    try {
        trx = await db.startTransaction();
        const userRows = await trx.query('SELECT cash FROM users WHERE user_id = ? FOR UPDATE', [user.id]);
        if (userRows[0].cash < 1000) throw new Error(`You need ${formatMoney(1000)} to reset skills.`);

        const skillRows = await trx.query('SELECT * FROM user_skills WHERE user_id = ? FOR UPDATE', [user.id]);
        const skills = skillRows[0];
        const refund = validSkills.reduce((sum, id) => {
            const level = skills[id] || 0;
            return sum + (level * (level + 1) / 2);
        }, 0);

        await trx.query('UPDATE users SET cash = cash - 1000, skill_points = skill_points + ? WHERE user_id = ?', [refund, user.id]);
        await trx.query('UPDATE user_skills SET income = 0, cooldown_skill = 0, luck = 0, defense = 0 WHERE user_id = ?', [user.id]);
        await trx.commit();

        return send(context, { embeds: [successEmbed('Skills Reset', `All skills were reset. Refunded **${refund} SP** for ${formatMoney(1000)}.`, user)] });
    } catch (error) {
        if (trx) await trx.rollback();
        return sendError(context, user, error.message);
    }
}
