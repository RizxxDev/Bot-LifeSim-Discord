const { SlashCommandBuilder } = require('discord.js');
const { query } = require('../../database/mariadb');
const { getVal, setVal } = require('../../database/redis');
const { getLevelInfoFromXp } = require('../../data/locations');
const { getJob } = require('../../data/jobs');
const { COLORS, formatLp, buildV2Card } = require('../../utils/uiBuilder');

module.exports = {
    name: 'leaderboard',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Lihat papan peringkat global warga Life Simulation.')
        .addStringOption(opt =>
            opt
                .setName('kategori')
                .setDescription('Pilih kategori peringkat')
                .setRequired(false)
                .addChoices(
                    { name: '💎 Total Kekayaan (Cash + Bank)', value: 'wealth' },
                    { name: '💼 Pengalaman Kerja (Total Shift)', value: 'work' },
                    { name: '🎣 Level Skill Fishing', value: 'fishing' },
                    { name: '⛏️ Level Skill Mining', value: 'mining' }
                )
        ),

    async executeSlash(interaction) {
        const cat = interaction.options.getString('kategori') || 'wealth';
        const cacheKey = `lb_cache:${cat}`;
        let rows = null;

        const cached = await getVal(cacheKey);
        if (cached) {
            try {
                rows = JSON.parse(cached);
            } catch {
                rows = null;
            }
        }

        if (!rows) {
            let sql = '';
            if (cat === 'work') {
                sql = `SELECT username, equipped_title, total_shifts, current_job FROM players WHERE is_banned = 0 ORDER BY total_shifts DESC LIMIT 10`;
            } else if (cat === 'fishing') {
                sql = `SELECT username, equipped_title, fishing_xp FROM players WHERE is_banned = 0 ORDER BY fishing_xp DESC LIMIT 10`;
            } else if (cat === 'mining') {
                sql = `SELECT username, equipped_title, mining_xp FROM players WHERE is_banned = 0 ORDER BY mining_xp DESC LIMIT 10`;
            } else {
                sql = `SELECT username, equipped_title, (cash + bank) AS net_worth FROM players WHERE is_banned = 0 ORDER BY net_worth DESC LIMIT 10`;
            }

            rows = await query(sql);
            await setVal(cacheKey, JSON.stringify(rows), 300); // 5 menit cache
        }

        const medals = ['🥇', '🥈', '🥉'];
        const lines = rows.map((r, idx) => {
            const rankBadge = medals[idx] || `\`#${idx + 1}\``;
            const titleStr = r.equipped_title ? ` *(${r.equipped_title})*` : '';

            if (cat === 'work') {
                const job = r.current_job ? getJob(r.current_job) : null;
                return `${rankBadge} **${r.username}**${titleStr} — **${r.total_shifts} shift** ${job ? `(${job.emoji} ${job.name})` : ''}`;
            }
            if (cat === 'fishing') {
                const lv = getLevelInfoFromXp(r.fishing_xp);
                return `${rankBadge} **${r.username}**${titleStr} — **Fishing Lv. ${lv.level}** *(${Number(r.fishing_xp).toLocaleString('id-ID')} EXP)*`;
            }
            if (cat === 'mining') {
                const lv = getLevelInfoFromXp(r.mining_xp);
                return `${rankBadge} **${r.username}**${titleStr} — **Mining Lv. ${lv.level}** *(${Number(r.mining_xp).toLocaleString('id-ID')} EXP)*`;
            }
            return `${rankBadge} **${r.username}**${titleStr} — **${formatLp(r.net_worth)}**`;
        });

        const titles = {
            wealth: '💎 Peringkat Global: Warga Terkaya',
            work: '💼 Peringkat Global: Pekerja Terajin',
            fishing: '🎣 Peringkat Global: Master Pemancing',
            mining: '⛏️ Peringkat Global: Master Penambang'
        };

        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.ECONOMY,
                title: titles[cat] || titles.wealth,
                blocks: [
                    lines.length > 0 ? lines.join('\n') : '*Belum ada data warga yang tercatat.*'
                ],
                footer: 'Data diperbarui otomatis setiap 5 menit.'
            })
        );
    }
};
