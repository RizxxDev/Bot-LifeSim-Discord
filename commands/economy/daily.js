const { SlashCommandBuilder } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { getWibDateString } = require('../../database/redis');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerInventory, canFitItems, addItem } = require('../../services/inventoryService');
const { creditPlayerCash } = require('../../services/economyService');
const { DAILY_REWARDS } = require('../../data/constants');
const { getItem } = require('../../data/items');
const { COLORS, formatLp, buildV2Card } = require('../../utils/uiBuilder');

const STREAK_RESET_MS = 36 * 3600 * 1000;

module.exports = {
    name: 'daily',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Klaim hadiah harian beruntun (streak 7 hari: bekal makanan, umpan, & bonus hari ke-7).'),

    async executeSlash(interaction) {
        const discordId = interaction.user.id;
        const now = Date.now();
        const todayWib = getWibDateString(now);

        const res = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, true);
            const p = synced.player;

            const lastAt = Number(p.last_daily_at || 0);
            if (lastAt > 0 && getWibDateString(lastAt) === todayWib) {
                return { error: 'ALREADY_CLAIMED', streak: p.daily_streak };
            }

            let nextStreak = 1;
            if (lastAt > 0 && (now - lastAt) <= STREAK_RESET_MS) {
                nextStreak = (Number(p.daily_streak || 0) % 7) + 1;
            }

            const rewardDef = DAILY_REWARDS.find(r => r.day === nextStreak) || DAILY_REWARDS[0];
            const invRows = await getPlayerInventory(conn, discordId, true);

            const fit = canFitItems(invRows, p.max_slots, rewardDef.items);
            if (!fit.fits) {
                return { error: 'BAG_FULL', slotsBefore: fit.slotsBefore, maxSlots: fit.maxSlots };
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
                streak: nextStreak,
                rewardDef,
                player: p
            };
        });

        if (res.error === 'ALREADY_CLAIMED') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '⏳ Hadiah Harian Sudah Diklaim',
                    blocks: [
                        `Kamu sudah mengklaim hadiah hari ini (Streak saat ini: **Hari ke-${res.streak}**).`,
                        'Hadiah harian berikutnya dapat diklaim setelah pukul **00:00 WIB**.'
                    ],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'BAG_FULL') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: `🎒 Tas Penuh (${res.slotsBefore}/${res.maxSlots} Slot)`,
                    blocks: ['Kosongkan minimal 1–2 slot tas terlebih dahulu sebelum mengklaim hadiah harian.'],
                    ephemeral: true
                })
            );
        }

        const rewardLines = res.rewardDef.items.map(it => {
            const def = getItem(it.itemId);
            return `• **${it.qty}× ${def ? `${def.emoji} ${def.name}` : it.itemId}**`;
        });
        if (res.rewardDef.cash > 0) {
            rewardLines.push(`• 💵 **Bonus Tunai Hari ke-7:** **+${formatLp(res.rewardDef.cash)}**`);
        }

        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.SUCCESS,
                title: `🎁 Hadiah Harian — Streak Hari ke-${res.streak}/7!`,
                blocks: [
                    `Selamat pagi/malam **${res.player.username}**! Berikut kiriman bekal harianmu:`,
                    rewardLines.join('\n'),
                    res.streak === 7
                        ? '🎉 **Streak 7 Hari Tercapai!** Besok siklus streak akan dimulai kembali dari Hari ke-1.'
                        : `🔥 Pertahankan klaim setiap hari (maks 36 jam antar klaim) untuk mencapai bonus **Hari ke-7**!`
                ]
            })
        );
    }
};
