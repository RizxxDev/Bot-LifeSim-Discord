const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');

module.exports = {
    name: 'job',
    aliases: ['pekerjaan', 'karir'],
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('job')
        .setDescription('Sistem manajemen pekerjaan')
        .addSubcommand(sub => sub.setName('list').setDescription('Lihat daftar pekerjaan yang tersedia'))
        .addSubcommand(sub => sub.setName('info').setDescription('Lihat info pekerjaanmu saat ini'))
        .addSubcommand(sub => sub.setName('resign').setDescription('Keluar dari pekerjaanmu saat ini'))
        .addSubcommand(sub => 
            sub.setName('apply')
            .setDescription('Melamar pekerjaan baru')
            .addStringOption(opt => opt.setName('job_id').setDescription('ID Pekerjaan yang ingin dilamar').setRequired(true))
        ),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        const jobId = interaction.options.getString('job_id');
        await handleJob(interaction, interaction.user, sub, jobId, true);
    },

    async executePrefix(message, args) {
        const sub = args[0]?.toLowerCase();
        const jobId = args[1]?.toLowerCase();

        if (!sub || !['list', 'info', 'resign', 'apply'].includes(sub)) {
            return message.channel.send(`❌ **${message.author.username}**, Format: \`!job list\`, \`!job info\`, \`!job apply <job_id>\`, \`!job resign\``);
        }
        await handleJob(message, message.author, sub, jobId, false);
    }
};

async function handleJob(context, user, sub, jobId, isSlash) {
    const userId = user.id;

    if (sub === 'list') {
        const jobs = await db.query('SELECT * FROM jobs ORDER BY required_level ASC');
        const embed = new EmbedBuilder().setColor('#2b2d31').setTitle('🏢 Lowongan Pekerjaan');
        
        let desc = '';
        jobs.forEach(j => {
            desc += `${j.emoji} **${j.name}** (ID: \`${j.id}\`)\n`;
            desc += `└ Syarat Karakter: Level ${j.required_level} | Gaji: Lp ${j.min_salary}-${j.max_salary} | EXP: ${j.min_exp}-${j.max_exp}\n\n`;
        });
        
        embed.setDescription(desc || 'Tidak ada lowongan.');
        return isSlash ? await context.reply({ embeds: [embed] }) : await context.channel.send({ embeds: [embed] });
    }

    if (sub === 'apply') {
        if (!jobId) return isSlash ? context.reply({ content: '❌ Masukkan ID Pekerjaan!', ephemeral: true }) : context.channel.send(`❌ **${user.username}**, masukkan ID Pekerjaan!`);
        
        const job = await db.query('SELECT * FROM jobs WHERE id = ?', [jobId]);
        if (!job.length) {
            const msg = `❌ **${user.username}**, ID Pekerjaan tidak ditemukan!`;
            return isSlash ? context.reply({ content: msg, ephemeral: true }) : context.channel.send(msg);
        }
        
        const userData = await db.query('SELECT level FROM users WHERE user_id = ?', [userId]);
        if (userData[0].level < job[0].required_level) {
            const msg = `❌ **${user.username}**, Kamu harus mencapai Karakter Level ${job[0].required_level} untuk melamar pekerjaan ini!`;
            return isSlash ? context.reply({ content: msg, ephemeral: true }) : context.channel.send(msg);
        }

        // 🌟 RESET JOB LEVEL & EXP JIKA LAMAR KERJA BARU
        await db.query('UPDATE users SET job_id = ?, job_level = 1, job_exp = 0 WHERE user_id = ?', [job[0].id, userId]);
        const successMsg = `🎉 **${user.username}** berhasil diterima bekerja sebagai **${job[0].name}**! Keahlian profesi dimulai dari Level 1.`;
        return isSlash ? context.reply(successMsg) : context.channel.send(successMsg);
    }

    if (sub === 'info') {
        const userData = await db.query('SELECT u.job_level, u.job_exp, j.* FROM users u LEFT JOIN jobs j ON u.job_id = j.id WHERE u.user_id = ?', [userId]);
        if (!userData[0] || !userData[0].id) {
            const msg = `❌ **${user.username}**, kamu belum memiliki pekerjaan! Gunakan \`/job list\`.`;
            return isSlash ? context.reply({ content: msg, ephemeral: true }) : context.channel.send(msg);
        }
        
        const u = userData[0];
        const reqJobExp = Math.floor(150 * Math.pow(u.job_level, 1.3)); 

        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setTitle(`Pekerjaan Saat Ini: ${u.emoji} ${u.name}`)
            .addFields(
                { name: '🎖️ Level Profesi', value: `Level **${u.job_level}**\n(${u.job_exp} / ${reqJobExp} EXP)`, inline: true },
                { name: '💰 Kisaran Gaji Dasar', value: `Lp ${u.min_salary} - ${u.max_salary}`, inline: true },
                { name: '⏱️ Waktu Tunggu', value: `${u.cooldown / 1000} detik`, inline: true }
            )
            .setFooter({ text: 'Tip: Semakin tinggi Level Profesi, semakin besar bonus gajimu!' });
            
        return isSlash ? context.reply({ embeds: [embed] }) : context.channel.send({ embeds: [embed] });
    }

    if (sub === 'resign') {
        // 🌟 RESET JOB ID, LEVEL, & EXP
        await db.query('UPDATE users SET job_id = NULL, job_level = 1, job_exp = 0 WHERE user_id = ?', [userId]);
        const msg = `👋 **${user.username}** telah mengundurkan diri dari pekerjaannya. Seluruh progress Job Level telah hangus.`;
        return isSlash ? context.reply(msg) : context.channel.send(msg);
    }
}