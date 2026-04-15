const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');

module.exports = {
    name: 'skill',
    aliases: ['skills', 'upgrade'],
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('skill')
        .setDescription('Kelola Pohon Keahlian (Skill Tree) karaktermu')
        .addSubcommand(sub => sub.setName('view').setDescription('Lihat skill dan Skill Points (SP) kamu'))
        .addSubcommand(sub => sub.setName('reset').setDescription('Reset semua skill (Biaya 1000 Lp)'))
        .addSubcommand(sub => 
            sub.setName('upgrade')
            .setDescription('Tingkatkan skill spesifik')
            .addStringOption(opt => 
                opt.setName('type')
                .setDescription('Pilih skill')
                .setRequired(true)
                .addChoices(
                    { name: 'Income (+50 Gaji Dasar)', value: 'income' },
                    { name: 'Cooldown (-5% Waktu Tunggu)', value: 'cooldown_skill' },
                    { name: 'Luck (+5% Peluang Gaji Ganda)', value: 'luck' },
                    { name: 'Defense (-2% Peluang Gagal Kerja)', value: 'defense' }
                )
            )
        ),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        const skillType = interaction.options.getString('type');
        await handleSkill(interaction, interaction.user, sub, skillType, true);
    },

    async executePrefix(message, args) {
        const sub = args[0]?.toLowerCase();
        const skillType = args[1]?.toLowerCase();

        if (!sub || !['view', 'reset', 'upgrade'].includes(sub)) {
            return message.channel.send(`❌ **${message.author.username}**, Format: \`!skill view\`, \`!skill upgrade <tipe>\`, \`!skill reset\``);
        }
        await handleSkill(message, message.author, sub, skillType, false);
    }
};

async function handleSkill(context, user, sub, skillType, isSlash) {
    const userId = user.id;

    // Pastikan baris user_skills ada
    await db.query('INSERT IGNORE INTO user_skills (user_id) VALUES (?)', [userId]);

    if (sub === 'view') {
        const userData = await db.query('SELECT skill_points FROM users WHERE user_id = ?', [userId]);
        const skills = await db.query('SELECT * FROM user_skills WHERE user_id = ?', [userId]);
        const s = skills[0];

        const embed = new EmbedBuilder()
            .setColor('#FF0055')
            .setTitle(`🧬 Pohon Keahlian: ${user.username}`)
            .setDescription(`**Skill Points (SP) Tersedia:** ${userData[0].skill_points} SP`)
            .addFields(
                { name: '💸 Income', value: `Level ${s.income}/5\nBiaya: ${s.income >= 5 ? 'MAX' : s.income + 1 + ' SP'}`, inline: true },
                { name: '⏳ Cooldown', value: `Level ${s.cooldown_skill}/5\nBiaya: ${s.cooldown_skill >= 5 ? 'MAX' : s.cooldown_skill + 1 + ' SP'}`, inline: true },
                { name: '🍀 Luck', value: `Level ${s.luck}/5\nBiaya: ${s.luck >= 5 ? 'MAX' : s.luck + 1 + ' SP'}`, inline: true },
                { name: '🛡️ Defense', value: `Level ${s.defense}/5\nBiaya: ${s.defense >= 5 ? 'MAX' : s.defense + 1 + ' SP'}`, inline: true }
            );
        return isSlash ? context.reply({ embeds: [embed] }) : context.channel.send({ embeds: [embed] });
    }

    if (sub === 'upgrade') {
        const validSkills = ['income', 'cooldown_skill', 'luck', 'defense'];
        if (!validSkills.includes(skillType)) {
            const msg = `❌ **${user.username}**, Skill tidak valid! Pilih: income, cooldown_skill, luck, defense.`;
            return isSlash ? context.reply({ content: msg, ephemeral: true }) : context.channel.send(msg);
        }

        let trx;
        try {
            trx = await db.startTransaction();
            const userData = await trx.query('SELECT skill_points FROM users WHERE user_id = ? FOR UPDATE', [userId]);
            const skills = await trx.query(`SELECT ${skillType} FROM user_skills WHERE user_id = ? FOR UPDATE`, [userId]);
            
            const currentLevel = skills[0][skillType];
            const cost = currentLevel + 1;

            if (currentLevel >= 5) throw new Error('Skill ini sudah mencapai Level Maksimal (5).');
            if (userData[0].skill_points < cost) throw new Error(`SP Tidak cukup! Butuh ${cost} SP.`);

            await trx.query('UPDATE users SET skill_points = skill_points - ? WHERE user_id = ?', [cost, userId]);
            await trx.query(`UPDATE user_skills SET ${skillType} = ${skillType} + 1 WHERE user_id = ?`, [userId]);
            
            await trx.commit();
            const msg = `🧬 **${user.username}** berhasil meningkatkan skill **${skillType}** ke Level ${currentLevel + 1}!`;
            return isSlash ? context.reply(msg) : context.channel.send(msg);
        } catch (err) {
            if (trx) await trx.rollback();
            const msg = `❌ **${user.username}**, ${err.message}`;
            return isSlash ? context.reply({ content: msg, ephemeral: true }) : context.channel.send(msg);
        }
    }

    if (sub === 'reset') {
        let trx;
        try {
            trx = await db.startTransaction();
            const userData = await trx.query('SELECT cash FROM users WHERE user_id = ? FOR UPDATE', [userId]);
            if (userData[0].cash < 1000) throw new Error('Kamu butuh Lp 1000 untuk mereset skill.');

            const skills = await trx.query('SELECT * FROM user_skills WHERE user_id = ? FOR UPDATE', [userId]);
            const s = skills[0];
            
            // Kalkulasi pengembalian SP menggunakan rumus deret aritmatika: n(n+1)/2
            const refund = (s.income*(s.income+1)/2) + (s.cooldown_skill*(s.cooldown_skill+1)/2) + (s.luck*(s.luck+1)/2) + (s.defense*(s.defense+1)/2);

            await trx.query('UPDATE users SET cash = cash - 1000, skill_points = skill_points + ? WHERE user_id = ?', [refund, userId]);
            await trx.query('UPDATE user_skills SET income = 0, cooldown_skill = 0, luck = 0, defense = 0 WHERE user_id = ?', [userId]);
            
            await trx.commit();
            const msg = `🔄 **${user.username}**, Skill tree direset! Mengembalikan **${refund} SP** dengan biaya Lp 1000.`;
            return isSlash ? context.reply(msg) : context.channel.send(msg);
        } catch (err) {
            if (trx) await trx.rollback();
            const msg = `❌ **${user.username}**, ${err.message}`;
            return isSlash ? context.reply({ content: msg, ephemeral: true }) : context.channel.send(msg);
        }
    }
}