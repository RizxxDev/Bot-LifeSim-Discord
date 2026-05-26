const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const { checkRegistration } = require('../../utils/middleware');
const { infoEmbed, successEmbed, formatMoney, progressBar, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'job',
    aliases: ['pekerjaan', 'karir'],
    prefix: true,
    slash: true,
    requiresRegistration: false,
    data: new SlashCommandBuilder()
        .setName('job')
        .setDescription('Browse and manage jobs.')
        .addSubcommand(sub => sub.setName('list').setDescription('View available jobs.'))
        .addSubcommand(sub => sub.setName('info').setDescription('View your current job.'))
        .addSubcommand(sub => sub.setName('resign').setDescription('Leave your current job.'))
        .addSubcommand(sub => sub.setName('apply').setDescription('Apply for a job.')
            .addStringOption(opt => opt.setName('job_id').setDescription('Job ID.').setRequired(true))),

    async executeSlash(interaction) {
        await handleJob(interaction, interaction.user, interaction.options.getSubcommand(), interaction.options.getString('job_id'));
    },

    async executePrefix(message, args) {
        await handleJob(message, message.author, args[0]?.toLowerCase(), args[1]?.toLowerCase());
    }
};

async function handleJob(context, user, sub, jobId) {
    if (!sub || !['list', 'info', 'resign', 'apply'].includes(sub)) {
        return sendError(context, user, 'Usage: `!job list`, `!job info`, `!job apply <job_id>`, or `!job resign`.');
    }

    try {
        if (sub === 'list') {
            const jobs = await db.query('SELECT * FROM jobs ORDER BY required_level ASC');
            const embed = infoEmbed('Job Board', 'Choose a job ID and apply when you meet the requirement.', user)
                .setColor(colors.muted);

            embed.setDescription(jobs.map((job) => {
                return `${job.emoji || ''} **${job.name}** \`${job.id}\`\nLevel ${job.required_level} required | Salary ${formatMoney(job.min_salary)} - ${formatMoney(job.max_salary)} | EXP ${job.min_exp}-${job.max_exp}`;
            }).join('\n\n') || 'No jobs are available.');

            return send(context, { embeds: [embed] });
        }

        if (!(await checkRegistration(user.id))) {
            return sendError(context, user, 'Create your citizen profile first with `/register`.');
        }

        if (sub === 'apply') {
            if (!jobId) return sendError(context, user, 'Enter a job ID.');

            const job = await db.query('SELECT * FROM jobs WHERE id = ?', [jobId]);
            if (!job.length) return sendError(context, user, 'Job ID not found.');

            const rows = await db.query('SELECT level FROM users WHERE user_id = ?', [user.id]);
            if (!rows.length || rows[0].level < job[0].required_level) {
                return sendError(context, user, `You need character level ${job[0].required_level} to apply for this job.`);
            }

            await db.query('UPDATE users SET job_id = ?, job_level = 1, job_exp = 0 WHERE user_id = ?', [job[0].id, user.id]);
            const embed = successEmbed('Application Accepted', `You are now working as **${job[0].name}**. Job mastery starts at Lv. 1.`, user);
            return send(context, { embeds: [embed] });
        }

        if (sub === 'info') {
            const rows = await db.query('SELECT u.job_level, u.job_exp, j.* FROM users u LEFT JOIN jobs j ON u.job_id = j.id WHERE u.user_id = ?', [user.id]);
            if (!rows[0] || !rows[0].id) return sendError(context, user, 'You do not have a job yet. Use `/job list`.');

            const data = rows[0];
            const requiredJobExp = Math.floor(150 * Math.pow(data.job_level, 1.3));
            const embed = infoEmbed(`Current Job: ${data.emoji || ''} ${data.name}`, null, user)
                .setColor(colors.muted)
                .addFields(
                    { name: 'Job level', value: `Lv. ${data.job_level}`, inline: true },
                    { name: 'Mastery EXP', value: progressBar(data.job_exp, requiredJobExp, 8), inline: true },
                    { name: 'Salary range', value: `${formatMoney(data.min_salary)} - ${formatMoney(data.max_salary)}`, inline: true },
                    { name: 'Cooldown', value: `${Math.round(data.cooldown / 1000)}s`, inline: true }
                );
            return send(context, { embeds: [embed] });
        }

        await db.query('UPDATE users SET job_id = NULL, job_level = 1, job_exp = 0 WHERE user_id = ?', [user.id]);
        return send(context, { embeds: [successEmbed('Job Resigned', 'You left your job. Job mastery progress has been reset.', user)] });
    } catch (error) {
        console.error('[JOB ERROR]', error);
        return sendError(context, user, 'Could not process the job command.');
    }
}
