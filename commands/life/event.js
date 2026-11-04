const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const {
    SEASONAL_EVENTS,
    getCurrentWeather,
    getActiveSeasonalEvent,
    getPlayerEventProgress,
    buyEventShopItem,
    claimCommunityGoalReward
} = require('../../services/eventService');
const { getItem } = require('../../data/items');
const { COLORS, renderBar } = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select
} = require('../../utils/panelBuilder');

function formatBonusesSummary(config, lebaranThr) {
    const parts = [];
    const b = config.bonuses || {};
    if (lebaranThr?.active) {
        parts.push(`🌙 **THR Lebaran ×${lebaranThr.multiplier} Gaji Dasar** (berakhir <t:${Math.floor(lebaranThr.endsAt / 1000)}:R>)`);
    } else if (b.lebaranThr) {
        parts.push(`🌙 *Periode THR Lebaran 3 hari pertama telah selesai*`);
    }
    if (b.fishingXpMult > 1) parts.push(`🎣 Fishing EXP ×${b.fishingXpMult}`);
    if (b.miningXpMult > 1) parts.push(`⛏️ Mining EXP ×${b.miningXpMult}`);
    if (b.farmingXpMult > 1) parts.push(`🌾 Farming EXP ×${b.farmingXpMult}`);
    if (b.cookingXpMult > 1) parts.push(`🍳 Cooking EXP ×${b.cookingXpMult}`);
    if (b.rarityBonus > 0) parts.push(`✨ Rarity +${Math.round(b.rarityBonus * 100)}%`);
    return parts.join(' · ') || 'Standar';
}

async function fetchEventState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const weather = await getCurrentWeather(conn, now);
        const active = await getActiveSeasonalEvent(conn, now);
        let progress = null;
        if (active) {
            progress = await getPlayerEventProgress(conn, discordId, active.stateRow.event_key, false);
        }
        return {
            player: synced.player,
            weather,
            active,
            progress
        };
    });
}

function buildEventPanel({
    state,
    selectedShopItemId = null,
    banner = null,
    now = Date.now()
}) {
    const { player: p, weather, active, progress } = state;
    const ownerId = p.discord_id;

    const weatherBlock = [
        `### ${weather.emoji} Cuaca Kota: ${weather.name}`,
        `${weather.description}`,
        `• 🔄 **Pergantian Musim Berikutnya:** <t:${Math.floor(weather.nextChangeAt / 1000)}:R> *(Siklus 2 Minggu)*`
    ].join('\n');

    const blocks = [weatherBlock];
    const rows = [];

    if (!active) {
        const calendarLines = SEASONAL_EVENTS.map(ev => {
            const sched = ev.scheduleType === 'fixed'
                ? `Tanggal Tetap (${ev.fixedRange.startDay}/${ev.fixedRange.startMonth} – ${ev.fixedRange.endDay}/${ev.fixedRange.endMonth})`
                : `Kalender Lunar/Hijriah (Diaktifkan saat perayaan)`;
            return `• ${ev.emoji} **${ev.name}** — *${sched}*`;
        });

        blocks.push(
            [
                '### 📅 Status Event Musiman: Tidak Ada Event Aktif',
                'Saat ini kota sedang berada di hari biasa. Berikut jadwal perayaan musiman tahunan:',
                calendarLines.join('\n')
            ].join('\n')
        );

        rows.push(
            new ActionRowBuilder().addComponents(
                btn('event', 'home', ownerId, {
                    label: 'Segarkan Cuaca & Event',
                    emoji: '🔄',
                    style: ButtonStyle.Secondary
                }, now)
            )
        );
    } else {
        const { config, stateRow, lebaranThr } = active;
        const goal = config.communityGoal;
        const goalTarget = goal.target;
        const goalCurr = Number(stateRow.community_progress || 0);
        const goalRewardText = (goal.rewardItems || []).map(rw => {
            const it = getItem(rw.itemId);
            return `${it ? it.emoji : '📦'} **${it ? it.name : rw.itemId}** ×${rw.qty}`;
        }).join(' · ');

        const shopItems = config.shopItems || [];
        const activeShopItem = selectedShopItemId
            ? shopItems.find(it => it.id === selectedShopItemId) || shopItems[0]
            : shopItems[0];

        const shopLines = shopItems.map(it =>
            `• **${it.name}** — **${it.tokenCost} ${config.tokenEmoji} ${config.tokenName}** *( ${it.description} )*`
        );

        blocks.push(
            [
                `### ${config.emoji} Event Aktif: ${config.name}`,
                `${config.description}`,
                `• ⏳ **Berakhir:** <t:${Math.floor(Number(stateRow.ends_at) / 1000)}:R>`,
                `• ✨ **Efek Aktif:** ${formatBonusesSummary(config, lebaranThr)}`,
                `• ${config.tokenEmoji} **Saldo Token Kamu:** **${progress.token_balance} ${config.tokenName}**`,
                `• 🌐 **Target Komunitas:** \`${renderBar(goalCurr, goalTarget, 10)}\` *(Kontribusimu: **${progress.community_contribution}x** · Hadiah: ${goalRewardText})*`
            ].join('\n'),
            `**🎪 Bazar Token Event:**\n${shopLines.join('\n')}`
        );

        if (shopItems.length > 0) {
            rows.push(
                select('event', 'pick_item', ownerId, {
                    placeholder: `🎪 Pilih hadiah Bazar ${config.name} untuk ditukar...`,
                    options: shopItems.slice(0, 25).map(it => ({
                        label: `${it.name} (${it.tokenCost} ${config.tokenName})`.slice(0, 100),
                        value: it.id,
                        emoji: config.tokenEmoji,
                        description: it.description.slice(0, 100),
                        default: activeShopItem ? activeShopItem.id === it.id : false
                    }))
                }, now)
            );
        }

        const actionBtns = [];
        if (activeShopItem) {
            const canAfford = Number(progress.token_balance || 0) >= activeShopItem.tokenCost;
            actionBtns.push(
                btn('event', 'buy', ownerId, {
                    label: `Tukar: ${activeShopItem.name} (${activeShopItem.tokenCost})`.slice(0, 80),
                    emoji: '🛍️',
                    style: ButtonStyle.Primary,
                    disabled: !canAfford,
                    arg: activeShopItem.id
                }, now)
            );
        }

        const canClaimGoal = goalCurr >= goalTarget && progress.community_contribution >= 1 && !progress.goal_claimed;
        actionBtns.push(
            btn('event', 'claim_goal', ownerId, {
                label: progress.goal_claimed
                    ? 'Hadiah Komunitas Diklaim'
                    : (goalCurr >= goalTarget ? 'Klaim Hadiah Komunitas!' : `Target Komunitas (${goalCurr}/${goalTarget})`),
                emoji: progress.goal_claimed ? '✅' : '🎁',
                style: ButtonStyle.Success,
                disabled: !canClaimGoal
            }, now),
            btn('event', 'home', ownerId, {
                label: 'Segarkan',
                emoji: '🔄',
                style: ButtonStyle.Secondary
            }, now)
        );

        rows.push(new ActionRowBuilder().addComponents(actionBtns));
    }

    return buildPanel({
        mod: 'event',
        ownerId,
        accentColor: active ? COLORS.SUCCESS : COLORS.PRIMARY,
        title: active ? `${active.config.emoji} Pusat Cuaca & Bazar Event: ${active.config.name}` : '🌤️ Pusat Cuaca & Kalender Event Kota',
        player: p,
        banner,
        blocks,
        rows,
        footer: 'Cuaca berganti otomatis tiap 2 minggu. Kumpulkan token dari aktivitas harian saat event berlangsung.',
        now
    });
}

module.exports = {
    name: 'event',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('event')
        .setDescription('Buka panel cuaca 2 mingguan, event musiman aktif, bazar penukaran token, dan target komunitas.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchEventState(interaction.user.id, now);
        return await interaction.reply(buildEventPanel({ state, now }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchEventState(interaction.user.id, now);
                return await interaction.update(buildEventPanel({ state, now }));
            },
            async buy(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const shopItemId = parsed.arg || '';

                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await buyEventShopItem(conn, synced.player, shopItemId, now);
                });

                const state = await fetchEventState(userId, now);
                let banner = null;
                if (res.error === 'NO_ACTIVE_EVENT') {
                    banner = { type: 'warning', text: 'Saat ini tidak ada event musiman yang aktif.' };
                } else if (res.error === 'INSUFFICIENT_TOKENS') {
                    banner = {
                        type: 'danger',
                        text: `Token tidak cukup! Butuh **${res.required} ${res.active.config.tokenName}**, saldomu **${res.balance}**.`
                    };
                } else if (res.error === 'TITLE_ALREADY_OWNED') {
                    banner = { type: 'warning', text: `Kamu sudah memiliki gelar **${res.shopItem.name}**! Pasang lewat \`/achievements\`.` };
                } else if (res.error === 'BAG_FULL') {
                    banner = { type: 'danger', text: '🎒 Tasmu penuh! Kosongkan slot tas terlebih dahulu.' };
                } else if (res.shopItem) {
                    banner = {
                        type: 'success',
                        text: `🎉 Berhasil menukar **${res.shopItem.tokenCost} ${res.active.config.tokenEmoji}** dengan **${res.shopItem.name}**!`
                    };
                } else {
                    banner = { type: 'warning', text: 'Gagal menukar hadiah event.' };
                }

                return await interaction.update(buildEventPanel({ state, selectedShopItemId: shopItemId, banner, now }));
            },
            async claim_goal(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await claimCommunityGoalReward(conn, synced.player, now);
                });

                const state = await fetchEventState(userId, now);
                let banner = null;
                if (res.error === 'GOAL_NOT_REACHED') {
                    banner = { type: 'warning', text: `Target komunitas belum tercapai (${res.currentGlobal}/${res.target}).` };
                } else if (res.error === 'NO_CONTRIBUTION') {
                    banner = { type: 'warning', text: 'Kamu harus berkontribusi minimal 1 aktivitas selama event untuk mengklaim hadiah komunitas!' };
                } else if (res.error === 'ALREADY_CLAIMED') {
                    banner = { type: 'info', text: 'Kamu sudah mengklaim hadiah Target Komunitas untuk event ini.' };
                } else if (res.error === 'BAG_FULL') {
                    banner = { type: 'danger', text: '🎒 Tasmu penuh! Kosongkan slot tas terlebih dahulu.' };
                } else if (res.rewardItems) {
                    const rewardSummary = res.rewardItems.map(rw => {
                        const it = getItem(rw.itemId);
                        return `${it ? it.emoji : '📦'} ${it ? it.name : rw.itemId} ×${rw.qty}`;
                    }).join(', ');
                    banner = {
                        type: 'success',
                        text: `🎊 Hadiah Target Komunitas berhasil diklaim: **${rewardSummary}**!`
                    };
                }

                return await interaction.update(buildEventPanel({ state, banner, now }));
            }
        },
        selects: {
            async pick_item(interaction) {
                const now = Date.now();
                const shopItemId = interaction.values[0] || '';
                const state = await fetchEventState(interaction.user.id, now);
                return await interaction.update(buildEventPanel({ state, selectedShopItemId: shopItemId, now }));
            }
        }
    },

    buildEventPanel
};
