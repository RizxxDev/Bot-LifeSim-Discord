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

        // Ambil Data User + Skill + Job secara bersamaan menggunakan JOIN
        const userRows = await trx.query(`
            SELECT u.*, s.income, s.cooldown_skill, s.luck, s.defense, j.name, j.min_salary, j.max_salary, j.cooldown, j.exp_gain, j.emoji
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

        // 1. Kalkulasi Cooldown (Berdasarkan Skill)
        const cooldownReduction = Math.max(0.5, 1 - (0.05 * (u.cooldown_skill || 0))); // Maksimal 50% reduksi
        const finalCooldown = u.cooldown * cooldownReduction;
        const timePassed = now - u.last_work;

        if (timePassed < finalCooldown) {
            await trx.rollback();
            const timeLeft = u.last_work + finalCooldown;
            const waitMsg = `⏳ **${user.username}**, kamu masih kelelahan. Kamu bisa bekerja lagi <t:${Math.round(timeLeft / 1000)}:R>.`;
            return isSlash ? context.reply({ content: waitMsg, ephemeral: true }) : context.channel.send(waitMsg);
        }

        // 2. Cek Kesalahan/Kegagalan (Berdasarkan Skill Defense)
        const failChance = Math.max(0, 0.05 - ((u.defense || 0) * 0.02)); // 5% dasar, -2% per level
        if (Math.random() < failChance) {
            await trx.query('UPDATE users SET last_work = ? WHERE user_id = ?', [now, userId]);
            await trx.commit();
            const failMsg = `🤕 **${user.username}** membuat kekacauan di tempat kerja hari ini dan mendapatkan **Lp 0**...`;
            return isSlash ? context.reply(failMsg) : context.channel.send(failMsg);
        }

        // 3. Kalkulasi Gaji & Keberuntungan (Luck & Income Skill)
        let salary = Math.floor(Math.random() * (u.max_salary - u.min_salary + 1)) + u.min_salary;
        salary += ((u.income || 0) * 50); // Bonus Lp 50 per level income

        const luckChance = 0.10 + ((u.luck || 0) * 0.05); // 10% dasar, +5% per level
        let isCrit = false;

        if (Math.random() < luckChance) {
            salary *= 2;
            isCrit = true;
        }

        // 4. Kalkulasi EXP dan Naik Level
        let newExp = u.exp + u.exp_gain;
        let newLevel = u.level;
        let newSp = u.skill_points;
        let leveledUp = false;

        const requiredExp = Math.floor(100 * Math.pow(newLevel, 1.2));

        if (newExp >= requiredExp) {
            newExp = 0; // Reset exp setelah naik level
            newLevel++;
            newSp++;
            leveledUp = true;
        }

        // 5. Simpan Data ke Database
        await trx.query(
            'UPDATE users SET cash = cash + ?, exp = ?, level = ?, skill_points = ?, last_work = ? WHERE user_id = ?',
            [salary, newExp, newLevel, newSp, now, userId]
        );
        await trx.commit();

        // 6. Format Pesan Keluaran
        let msg = `${u.emoji} **${user.username}** bekerja sebagai **${u.name}** dan mendapatkan **Lp ${salary.toLocaleString()}**!`;
        if (isCrit) msg += ` 🍀 *(Gaji Ganda!)*`;
        if (leveledUp) msg += `\n🆙 **LEVEL UP!** Kamu sekarang Level **${newLevel}** dan mendapatkan **1 Skill Point (SP)**!`;

        return isSlash ? context.reply(msg) : context.channel.send(msg);

    } catch (error) {
        if (trx) await trx.rollback();
        console.error('[WORK ERROR]', error);
        const errMsg = `❌ **${user.username}**, terjadi kesalahan sistem saat bekerja.`;
        return isSlash ? context.reply({ content: errMsg, ephemeral: true }) : context.channel.send(errMsg);
    }
}