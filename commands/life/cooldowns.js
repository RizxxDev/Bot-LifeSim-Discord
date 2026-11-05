const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { getCooldownRemaining, getDailyActionCount, getWibDateString } = require('../../database/redis');
const { syncPlayerVitals } = require('../../services/vitalService');
const { COLORS, formatDuration } = require('../../utils/uiBuilder');
const { buildPanel, btn } = require('../../utils/panelBuilder');

async function buildCooldownsPanel(discordId, now = Date.now()) {
    const synced = await withTransaction(conn => syncPlayerVitals(conn, discordId, now, true));
    const p = synced.player;

    const [workCd, studyCd, binCd, fishCd, mineCd, workCount, binCount, fishCount, mineCount] = await Promise.all([
        getCooldownRemaining(discordId, 'work', query),
        getCooldownRemaining(discordId, 'study', query),
        getCooldownRemaining(discordId, 'bin', query),
        getCooldownRemaining(discordId, 'fishing', query),
        getCooldownRemaining(discordId, 'mining', query),
        getDailyActionCount(discordId, 'work', now),
        getDailyActionCount(discordId, 'bin', now),
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
        statusLines.push(`🏥 **Rumah Sakit:** Keluar **<t:${Math.floor(Number(p.hospital_until) / 1000)}:R>** (${formatDuration(Number(p.hospital_until) - now)})`);
    }
    if (Number(p.sleeping_until) > now) {
        statusLines.push(`🛌 **Tidur (/sleep):** Bangun **<t:${Math.floor(Number(p.sleeping_until) / 1000)}:R>** (${formatDuration(Number(p.sleeping_until) - now)})`);
    }
    if (statusLines.length === 0) {
        statusLines.push('🟢 **Kondisi Karakter:** Bebas beraktivitas');
    }

    const row = new ActionRowBuilder().addComponents(
        btn('cooldowns', 'home', discordId, {
            label: 'Segarkan Jadwal',
            emoji: '🔄',
            style: ButtonStyle.Secondary
        }, now)
    );

    return buildPanel({
        mod: 'cooldowns',
        ownerId: discordId,
        accentColor: COLORS.LIFE,
        title: `⏱️ Jadwal Cooldown & Kuota Harian: ${p.username}`,
        player: p,
        blocks: [
            statusLines.join('\n'),
            [
                '**⚡ Cooldown & Soft Cap Aktivitas:**',
                `• 🗑️ \`/bin\`     : ${fmtCd(binCd)} *(Cooldown 5d · Hari ini: ${binCount}x cari)*`,
                `• 💼 \`/work\`    : ${fmtCd(workCd)} *(Hari ini: ${workCount}/6 shift penuh)*`,
                `• 🎓 \`/study\`   : ${fmtCd(studyCd)}`,
                `• 🎣 \`/fishing\` : ${fmtCd(fishCd)} *(Hari ini: ${fishCount}/40 lemparan penuh)*`,
                `• ⛏️ \`/mining\`  : ${fmtCd(mineCd)} *(Hari ini: ${mineCount}/30 ayunan penuh)*`,
                `• 🎁 \`/daily\`   : ${dailyReady ? '✅ **Siap Diklaim!**' : '⏳ **Sudah diklaim hari ini (Reset 00:00 WIB)**'} *(Streak: ${p.daily_streak} hari)*`
            ].join('\n')
        ],
        rows: [row],
        footer: 'Soft cap harian di-reset setiap pukul 00:00 WIB.',
        now
    });
}

module.exports = {
    name: 'cooldowns',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('cooldowns')
        .setDescription('Cek seluruh jadwal tunggu (cooldown), kuota harian, dan status aktif karaktermu.'),

    async executeSlash(interaction) {
        const now = Date.now();
        return await interaction.reply(await buildCooldownsPanel(interaction.user.id, now));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                return await interaction.update(await buildCooldownsPanel(interaction.user.id, now));
            }
        }
    },

    buildCooldownsPanel
};
