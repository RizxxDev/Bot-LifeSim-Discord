const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');

module.exports = {
    name: 'work',
    aliases: ['kerja', 'w'],
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Bekerja untuk mendapatkan uang dan EXP'),

    async executeSlash(interaction) {
        await handleWork(interaction, interaction.user, true);
    },

    async executePrefix(message, args) {
        await handleWork(message, message.author, false);
    }
};

async function handleWork(context, user, isSlash) {
    const userId = user.id;
    const now = Date.now();

    let trx;
    try {
        trx = await db.startTransaction();

        const userRows = await trx.query(`
            SELECT u.*, s.income, s.cooldown_skill, s.luck, s.defense, j.name, j.min_salary, j.max_salary, j.cooldown, j.min_exp, j.max_exp, j.emoji
            FROM users u
            LEFT JOIN user_skills s ON u.user_id = s.user_id
            LEFT JOIN jobs j ON u.job_id = j.id
            WHERE u.user_id = ? FOR UPDATE
        `, [userId]);

        const u = userRows[0];

        if (!u || !u.job_id) {
            await trx.rollback();
            const msg = `❌ **${user.username}**, kamu belum memiliki pekerjaan! Gunakan \`/job list\` dan \`/job apply\`.`;
            return isSlash ? context.reply({ content: msg, ephemeral: true }) : context.channel.send(msg);
        }

        // 1. Kalkulasi Cooldown
        const cooldownReduction = Math.max(0.5, 1 - (0.05 * (u.cooldown_skill || 0))); 
        const finalCooldown = u.cooldown * cooldownReduction;
        const timePassed = now - u.last_work;

        if (timePassed < finalCooldown) {
            await trx.rollback();
            const timeLeft = u.last_work + finalCooldown;
            const waitMsg = `⏳ **${user.username}**, kamu masih kelelahan. Kamu bisa bekerja lagi <t:${Math.round(timeLeft / 1000)}:R>.`;
            return isSlash ? context.reply({ content: waitMsg, ephemeral: true }) : context.channel.send(waitMsg);
        }

        // 2. Cek Kesalahan/Kegagalan
        const failChance = Math.max(0, 0.05 - ((u.defense || 0) * 0.02)); 
        if (Math.random() < failChance) {
            await trx.query('UPDATE users SET last_work = ? WHERE user_id = ?', [now, userId]);
            await trx.commit();
            const failMsg = `🤕 **${user.username}** membuat kekacauan di tempat kerja hari ini dan mendapatkan **Lp 0**...`;
            return isSlash ? context.reply(failMsg) : context.channel.send(failMsg);
        }

        // 3. Kalkulasi Gaji Dasar & Keberuntungan
        let salary = Math.floor(Math.random() * (u.max_salary - u.min_salary + 1)) + u.min_salary;
        salary += ((u.income || 0) * 50); 
        
        // 🌟 BONUS JOB LEVEL (Setiap naik 1 level job, gaji bertambah 5%)
        const currentJobLevel = u.job_level || 1;
        const jobBonus = Math.floor(salary * ((currentJobLevel - 1) * 0.05));
        salary += jobBonus;

        const luckChance = 0.10 + ((u.luck || 0) * 0.05); 
        let isCrit = false;
        if (Math.random() < luckChance) {
            salary *= 2;
            isCrit = true;
        }

        // 4. Kalkulasi EXP Karakter & EXP Pekerjaan
        const minExp = u.min_exp || 10;
        const maxExp = u.max_exp || 20;
        const earnedExp = Math.floor(Math.random() * (maxExp - minExp + 1)) + minExp;

        // Level Karakter Utama
        let newExp = u.exp + earnedExp;
        let newLevel = u.level;
        let newSp = u.skill_points;
        let charLeveledUp = false;
        const requiredExp = Math.floor(100 * Math.pow(newLevel, 1.2));

        if (newExp >= requiredExp) {
            newExp = 0; 
            newLevel++;
            newSp++;
            charLeveledUp = true;
        }

        // 🌟 Level Pekerjaan (Job Mastery)
        let newJobExp = (u.job_exp || 0) + earnedExp;
        let newJobLevel = currentJobLevel;
        let jobLeveledUp = false;
        // Kebutuhan exp untuk Job lebih tinggi dari exp karakter biasa
        const reqJobExp = Math.floor(150 * Math.pow(newJobLevel, 1.3)); 

        if (newJobExp >= reqJobExp) {
            newJobExp = 0;
            newJobLevel++;
            jobLeveledUp = true;
        }

        // 5. Simpan Data ke Database
        await trx.query(
            'UPDATE users SET cash = cash + ?, exp = ?, level = ?, skill_points = ?, last_work = ?, job_exp = ?, job_level = ? WHERE user_id = ?',
            [salary, newExp, newLevel, newSp, now, newJobExp, newJobLevel, userId]
        );
        await trx.commit();

        // 6. Format Pesan Keluaran
        let msg = `${u.emoji} **${user.username}** bekerja sebagai **${u.name} (Lv. ${currentJobLevel})** dan mendapatkan **Lp ${salary.toLocaleString()}**!\n✨ Mendapatkan **${earnedExp} EXP**!`;
        if (isCrit) msg += ` 🍀 *(Gaji Ganda!)*`;
        if (charLeveledUp) msg += `\n🆙 **LEVEL UP!** Karaktermu sekarang Level **${newLevel}**!`;
        if (jobLeveledUp) msg += `\n🎖️ **PROMOSI!** Keahlian profesimu naik menjadi **Level ${newJobLevel}**! (Bonus gaji meningkat)`;

        return isSlash ? context.reply(msg) : context.channel.send(msg);

    } catch (error) {
        if (trx) await trx.rollback();
        console.error('[WORK ERROR]', error);
        const errMsg = `❌ **${user.username}**, terjadi kesalahan sistem saat bekerja.`;
        return isSlash ? context.reply({ content: errMsg, ephemeral: true }) : context.channel.send(errMsg);
    }
}