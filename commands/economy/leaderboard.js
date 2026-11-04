const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { getVal, setVal } = require('../../database/redis');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getLevelInfoFromXp } = require('../../data/locations');
const { getJob } = require('../../data/jobs');
const { COLORS, formatLp } = require('../../utils/uiBuilder');
const { buildPanel, btn } = require('../../utils/panelBuilder');

const CATEGORIES = [
    { id: 'wealth', label: 'Kekayaan', emoji: '💎', title: '💎 Peringkat Global: Warga Terkaya' },
    { id: 'work', label: 'Total Shift', emoji: '💼', title: '💼 Peringkat Global: Pekerja Terajin' },
    { id: 'fishing', label: 'Fishing', emoji: '🎣', title: '🎣 Peringkat Global: Master Pemancing' },
    { id: 'mining', label: 'Mining', emoji: '⛏️', title: '⛏️ Peringkat Global: Master Penambang' },
    { id: 'farming', label: 'Farming', emoji: '🌾', title: '🌾 Peringkat Global: Master Petani' },
    { id: 'cooking', label: 'Cooking', emoji: '🍳', title: '🍳 Peringkat Global: Master Chef' }
];

async function fetchLeaderboardRows(cat = 'wealth') {
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
        } else if (cat === 'farming') {
            sql = `SELECT username, equipped_title, farming_xp FROM players WHERE is_banned = 0 ORDER BY farming_xp DESC LIMIT 10`;
        } else if (cat === 'cooking') {
            sql = `SELECT username, equipped_title, cooking_xp FROM players WHERE is_banned = 0 ORDER BY cooking_xp DESC LIMIT 10`;
        } else {
            sql = `SELECT username, equipped_title, (cash + bank) AS net_worth FROM players WHERE is_banned = 0 ORDER BY net_worth DESC LIMIT 10`;
        }

        rows = await query(sql);
        await setVal(cacheKey, JSON.stringify(rows), 300);
    }

    return rows;
}

async function fetchLeaderboardState(discordId, cat = 'wealth', now = Date.now()) {
    const [player, rows] = await Promise.all([
        withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, false);
            return synced.player;
        }),
        fetchLeaderboardRows(cat)
    ]);
    return { player, rows, cat };
}

function buildLeaderboardPanel({ state, now = Date.now() }) {
    const { player: p, rows, cat } = state;
    const ownerId = p.discord_id;
    const activeCat = CATEGORIES.find(c => c.id === cat) || CATEGORIES[0];

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
        if (cat === 'farming') {
            const lv = getLevelInfoFromXp(r.farming_xp || 0);
            return `${rankBadge} **${r.username}**${titleStr} — **Farming Lv. ${lv.level}** *(${Number(r.farming_xp || 0).toLocaleString('id-ID')} EXP)*`;
        }
        if (cat === 'cooking') {
            const lv = getLevelInfoFromXp(r.cooking_xp || 0);
            return `${rankBadge} **${r.username}**${titleStr} — **Cooking Lv. ${lv.level}** *(${Number(r.cooking_xp || 0).toLocaleString('id-ID')} EXP)*`;
        }
        return `${rankBadge} **${r.username}**${titleStr} — **${formatLp(r.net_worth)}**`;
    });

    const row1 = new ActionRowBuilder().addComponents(
        CATEGORIES.slice(0, 3).map(c =>
            btn('leaderboard', 'cat', ownerId, {
                label: c.label,
                emoji: c.emoji,
                style: c.id === activeCat.id ? ButtonStyle.Primary : ButtonStyle.Secondary,
                arg: c.id
            }, now)
        )
    );

    const row2 = new ActionRowBuilder().addComponents(
        CATEGORIES.slice(3, 6).map(c =>
            btn('leaderboard', 'cat', ownerId, {
                label: c.label,
                emoji: c.emoji,
                style: c.id === activeCat.id ? ButtonStyle.Primary : ButtonStyle.Secondary,
                arg: c.id
            }, now)
        )
    );

    return buildPanel({
        mod: 'leaderboard',
        ownerId,
        accentColor: COLORS.ECONOMY,
        title: activeCat.title,
        player: p,
        blocks: [
            lines.length > 0 ? lines.join('\n') : '*Belum ada data warga yang tercatat.*'
        ],
        rows: [row1, row2],
        footer: 'Data peringkat diperbarui otomatis setiap 5 menit.',
        now
    });
}

module.exports = {
    name: 'leaderboard',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Buka papan peringkat global warga Life Simulation (Kekayaan, Karir, & 4 Skill).'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchLeaderboardState(interaction.user.id, 'wealth', now);
        return await interaction.reply(buildLeaderboardPanel({ state, now }));
    },

    panel: {
        buttons: {
            async cat(interaction, parsed) {
                const now = Date.now();
                const cat = parsed.arg || 'wealth';
                const state = await fetchLeaderboardState(interaction.user.id, cat, now);
                return await interaction.update(buildLeaderboardPanel({ state, now }));
            }
        }
    },

    buildLeaderboardPanel
};
