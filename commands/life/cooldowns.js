const { SlashCommandBuilder } = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { getCooldownRemaining, getDailyActionCount, getWibDateString } = require('../../database/redis');
const { syncPlayerVitals } = require('../../services/vitalService');
const { COLORS, formatDuration, formatVitalsCompact, buildV2Card } = require('../../utils/uiBuilder');

module.exports = {
    name: 'cooldowns',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('cooldowns')
        .setDescription('Cek seluruh jadwal tunggu (cooldown), kuota harian, dan status aktif karaktermu.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const discordId = interaction.user.id;

        const synced = await withTransaction(conn => syncPlayerVitals(conn, discordId, now, true));
        const p = synced.player;

        const [workCd, studyCd, fishCd, mineCd, workCount, fishCount, mineCount] = await Promise.all([
            getCooldownRemaining(discordId, 'work', query),
            getCooldownRemaining(discordId, 'study', query),
            getCooldownRemaining(discordId, 'fishing', query),
            getCooldownRemaining(discordId, 'mining', query),
            getDailyActionCount(discordId, 'work', now),
            getDailyActionCount(discordId, 'fishing', now),
            getDailyActionCount(discordId, 'mining', now)
        ]);

        const fmtCd = (remMs) => remMs > 0
            ? `⏳ **${formatDuration(remMs)}** (<t:${Math.floor((now + remMs) / 1000)}:R>)`
            : '✅ **Siap!**';

        const todayWib = getWibDateString(now);
        const lastDailyWib = p.last_daily_at ? getWibDateString(Number(p.last_daily_at)) : null;
        const dailyReady = todayWib !== lastDailyWib;

        const statusLines = [];
        if (Number(p.hospital_until) > now) {
            statusLines.push(`🏥 **Rumah Sakit:** Keluar dalam **${formatDuration(Number(p.hospital_until) - now)}**`);
        }
        if (Number(p.sleeping_until) > now) {
            statusLines.push(`🛌 **Tidur (/sleep):** Bangun dalam **${formatDuration(Number(p.sleeping_until) - now)}**`);
        }
        if (statusLines.length === 0) {
            statusLines.push('🟢 **Kondisi:** Bebas beraktivitas');
        }

        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.LIFE,
                title: `⏱️ Jadwal & Cooldown: ${p.username}`,
                blocks: [
                    `${statusLines.join('\n')}\n${formatVitalsCompact(p)}`,
                    [
                        '**⚡ Cooldown Aktivitas:**',
                        `• 💼 \`/work\`    : ${fmtCd(workCd)} *(Hari ini: ${workCount}/6 shift penuh)*`,
                        `• 🎓 \`/study\`   : ${fmtCd(studyCd)}`,
                        `• 🎣 \`/fishing\` : ${fmtCd(fishCd)} *(Hari ini: ${fishCount}/40 lemparan penuh)*`,
                        `• ⛏️ \`/mining\`  : ${fmtCd(mineCd)} *(Hari ini: ${mineCount}/30 ayunan penuh)*`,
                        `• 🎁 \`/daily\`   : ${dailyReady ? '✅ **Siap Diklaim!**' : '⏳ **Sudah diklaim hari ini (Reset 00:00 WIB)**'} *(Streak: ${p.daily_streak} hari)*`
                    ].join('\n')
                ],
                footer: 'Soft cap harian di-reset setiap pukul 00:00 WIB.',
                ephemeral: true
            })
        );
    }
};
