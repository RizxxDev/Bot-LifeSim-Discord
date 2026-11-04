const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { getWibDateString } = require('../../database/redis');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerInventory, canFitItems, addItem } = require('../../services/inventoryService');
const { creditPlayerCash } = require('../../services/economyService');
const { DAILY_REWARDS } = require('../../data/constants');
const { getItem } = require('../../data/items');
const { COLORS, formatLp } = require('../../utils/uiBuilder');
const { buildPanel, btn } = require('../../utils/panelBuilder');

const STREAK_RESET_MS = 36 * 3600 * 1000;

function formatRewardDef(rewardDef) {
    const parts = rewardDef.items.map(it => {
        const def = getItem(it.itemId);
        return `${it.qty}× ${def ? `${def.emoji} ${def.name}` : it.itemId}`;
    });
    if (rewardDef.cash > 0) {
        parts.push(`💵 **+${formatLp(rewardDef.cash)}**`);
    }
    return parts.join(' · ');
}

async function fetchDailyState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        return { player: synced.player };
    });
}

function buildDailyPanel({ state, banner = null, now = Date.now() }) {
    const { player: p } = state;
    const ownerId = p.discord_id;
    const todayWib = getWibDateString(now);
    const lastAt = Number(p.last_daily_at || 0);
    const alreadyClaimedToday = lastAt > 0 && getWibDateString(lastAt) === todayWib;

    let nextStreak = 1;
    if (lastAt > 0 && (now - lastAt) <= STREAK_RESET_MS) {
        nextStreak = alreadyClaimedToday
            ? Number(p.daily_streak || 1)
            : (Number(p.daily_streak || 0) % 7) + 1;
    }

    const calendarLines = DAILY_REWARDS.map(r => {
        const isCurrent = r.day === nextStreak;
        const badge = alreadyClaimedToday && r.day <= nextStreak
            ? '✅'
            : (isCurrent ? '🎁' : '▫️');
        return `${badge} **Hari ke-${r.day}:** ${formatRewardDef(r)}${isCurrent && !alreadyClaimedToday ? ' *(Siap Klaim!)*' : ''}`;
    });

    const statusLine = alreadyClaimedToday
        ? `✅ **Status Hari Ini:** Sudah diklaim (Streak saat ini: **Hari ke-${p.daily_streak}/7** · Reset pukul **00:00 WIB**)`
        : `🎉 **Status Hari Ini:** **Siap Diklaim!** (Target klaim: **Hari ke-${nextStreak}/7**)`;

    const row = new ActionRowBuilder().addComponents(
        btn('daily', 'claim', ownerId, {
            label: alreadyClaimedToday ? 'Sudah Diklaim Hari Ini' : `Klaim Hadiah Hari ke-${nextStreak}`,
            emoji: alreadyClaimedToday ? '✅' : '🎁',
            style: ButtonStyle.Success,
            disabled: alreadyClaimedToday
        }, now),
        btn('daily', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary
        }, now)
    );

    return buildPanel({
        mod: 'daily',
        ownerId,
        accentColor: alreadyClaimedToday ? COLORS.PRIMARY : COLORS.SUCCESS,
        title: `🎁 Kalender Hadiah Harian (/daily)`,
        player: p,
        banner,
        blocks: [
            statusLine,
            `**📅 Rincian Hadiah Streak 7 Hari:**\n${calendarLines.join('\n')}`
        ],
        rows: [row],
        footer: 'Jaga jarak antar klaim maksimal 36 jam agar streak 7 harimu tidak terputus.',
        now
    });
}

module.exports = {
    name: 'daily',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Buka panel hadiah harian beruntun (streak 7 hari: bekal makanan, umpan, & bonus hari ke-7).'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchDailyState(interaction.user.id, now);
        return await interaction.reply(buildDailyPanel({ state, now }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchDailyState(interaction.user.id, now);
                return await interaction.update(buildDailyPanel({ state, now }));
            },
            async claim(interaction) {
                const discordId = interaction.user.id;
                const now = Date.now();
                const todayWib = getWibDateString(now);

                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, discordId, now, true);
                    const p = synced.player;

                    const lastAt = Number(p.last_daily_at || 0);
                    if (lastAt > 0 && getWibDateString(lastAt) === todayWib) {
                        return { error: 'ALREADY_CLAIMED', streak: p.daily_streak, player: p };
                    }

                    let nextStreak = 1;
                    if (lastAt > 0 && (now - lastAt) <= STREAK_RESET_MS) {
                        nextStreak = (Number(p.daily_streak || 0) % 7) + 1;
                    }

                    const rewardDef = DAILY_REWARDS.find(r => r.day === nextStreak) || DAILY_REWARDS[0];
                    const invRows = await getPlayerInventory(conn, discordId, true);

                    const fit = canFitItems(invRows, p.max_slots, rewardDef.items);
                    if (!fit.fits) {
                        return { error: 'BAG_FULL', slotsBefore: fit.slotsBefore, maxSlots: fit.maxSlots, player: p };
                    }

                    for (const entry of rewardDef.items) {
                        await addItem(conn, discordId, entry.itemId, entry.qty, now);
                    }

                    if (rewardDef.cash > 0) {
                        await creditPlayerCash(conn, p, rewardDef.cash, `daily_day_${nextStreak}`, {
                            streak: nextStreak
                        }, now);
                    }

                    p.daily_streak = nextStreak;
                    p.last_daily_at = now;

                    await conn.execute(
                        `UPDATE players SET daily_streak = ?, last_daily_at = ? WHERE discord_id = ?`,
                        [p.daily_streak, p.last_daily_at, discordId]
                    );

                    return {
                        ok: true,
                        streak: nextStreak,
                        rewardDef,
                        player: p
                    };
                });

                let banner = null;
                if (res.ok) {
                    banner = {
                        type: 'success',
                        text: `🎁 Klaim **Hari ke-${res.streak}/7** berhasil! Diterima: ${formatRewardDef(res.rewardDef)}`
                    };
                } else if (res.error === 'ALREADY_CLAIMED') {
                    banner = { type: 'info', text: 'Kamu sudah mengklaim hadiah harian untuk hari ini. Kembali lagi besok setelah 00:00 WIB!' };
                } else if (res.error === 'BAG_FULL') {
                    banner = {
                        type: 'danger',
                        text: `🎒 Tas penuh (${res.slotsBefore}/${res.maxSlots} slot)! Kosongkan minimal 1–2 slot tas terlebih dahulu.`
                    };
                }

                return await interaction.update(
                    buildDailyPanel({
                        state: { player: res.player },
                        banner,
                        now
                    })
                );
            }
        }
    },

    buildDailyPanel
};
