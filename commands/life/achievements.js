const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonStyle
} = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const {
    ACHIEVEMENT_CATEGORIES,
    evaluatePlayerAchievements,
    claimAchievementRewards,
    getUnlockedTitles
} = require('../../services/achievementService');
const { getItem } = require('../../data/items');
const { COLORS, formatLp } = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select,
    paginate
} = require('../../utils/panelBuilder');

function formatRewardLabel(ach) {
    const parts = [];
    if (ach.titleReward) {
        parts.push(`🏷️ Gelar **${ach.titleReward}**`);
    }
    for (const rw of (ach.itemRewards || [])) {
        const it = getItem(rw.itemId);
        parts.push(`${it ? it.emoji : '📦'} ${it ? it.name : rw.itemId} ×${rw.qty}`);
    }
    return parts.join(' · ') || '-';
}

async function fetchAchievementsState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const evalRes = await evaluatePlayerAchievements(conn, synced.player, now);
        const unlockedTitles = await getUnlockedTitles(conn, synced.player, now);
        return {
            player: synced.player,
            evalRes,
            unlockedTitles
        };
    });
}

function parseCatPageArg(rawArg) {
    if (!rawArg) return { cat: 'all', page: 1 };
    const [catPart, pagePart] = String(rawArg).split(':');
    return {
        cat: catPart || 'all',
        page: Math.max(1, parseInt(pagePart || '1', 10) || 1)
    };
}

function buildAchievementsPanel({
    state,
    selectedCategory = 'all',
    page = 1,
    banner = null,
    now = Date.now()
}) {
    const { player: p, evalRes, unlockedTitles } = state;
    const ownerId = p.discord_id;

    const rawFiltered = selectedCategory === 'all'
        ? [...evalRes.achievements].sort((a, b) => {
            const aReady = a.unlocked && !a.claimed ? 1 : 0;
            const bReady = b.unlocked && !b.claimed ? 1 : 0;
            return bReady - aReady;
        })
        : evalRes.achievements.filter(a => a.category === selectedCategory);

    const pg = paginate(rawFiltered, page, 9);
    const catInfo = ACHIEVEMENT_CATEGORIES.find(c => c.id === selectedCategory);
    const pageSuffix = pg.totalPages > 1 ? ` · Hal ${pg.page}/${pg.totalPages}` : '';
    const title = catInfo
        ? `${catInfo.emoji} Achievement & Gelar: ${catInfo.name}${pageSuffix}`
        : `🏆 Buku Pencapaian & Gelar Warga (${evalRes.unlockedCount}/${evalRes.totalCount}${pageSuffix})`;

    const lines = pg.slice.map(a => {
        const statusIcon = a.unlocked
            ? (a.claimed ? '✅' : '🎁')
            : '🔒';
        const progText = a.metric === 'net_worth'
            ? `${formatLp(a.currentProgress)} / ${formatLp(a.target)}`
            : `${a.currentProgress}/${a.target}`;
        const claimTag = a.unlocked && !a.claimed ? ' *(Siap Klaim!)*' : '';
        return `${statusIcon} **${a.emoji} ${a.name}** (${progText})${claimTag}\n   └ *${a.description}* · Hadiah: ${formatRewardLabel(a)}`;
    });

    const blocks = [
        [
            `📊 **Total Terbuka:** **${evalRes.unlockedCount}/${evalRes.totalCount}** Achievement · 🎁 **Siap Diklaim:** **${evalRes.claimableCount}** paket`,
            `🏷️ **Gelar Kehormatan Aktif:** ${p.equipped_title ? `**${p.equipped_title}**` : '*Belum dipasang*'} *(Koleksi Gelar: **${unlockedTitles.length}** terbuka)*`
        ].join('\n'),
        lines.join('\n\n')
    ];

    const stateArg = `${selectedCategory}:${pg.page}`;

    const rows = [
        select('achievements', 'cat', ownerId, {
            placeholder: '🏆 Filter Kategori Achievement...',
            options: [
                {
                    label: `Semua Kategori (${evalRes.unlockedCount}/${evalRes.totalCount})`,
                    value: 'all',
                    emoji: '🏆',
                    default: selectedCategory === 'all'
                },
                ...ACHIEVEMENT_CATEGORIES.map(c => {
                    const catList = evalRes.achievements.filter(a => a.category === c.id);
                    const catUnlocked = catList.filter(a => a.unlocked).length;
                    return {
                        label: `${c.name} (${catUnlocked}/${catList.length})`,
                        value: c.id,
                        emoji: c.emoji,
                        default: selectedCategory === c.id
                    };
                })
            ]
        }, now)
    ];

    if (unlockedTitles.length > 0) {
        rows.push(
            select('achievements', 'equip_title', ownerId, {
                placeholder: '🏷️ Pilih Gelar Kehormatan (Title) untuk dipasang...',
                arg: stateArg,
                options: unlockedTitles.slice(0, 25).map(t => ({
                    label: t.title.slice(0, 100),
                    value: t.title.slice(0, 100),
                    emoji: p.equipped_title === t.title ? '✅' : '🏷️',
                    description: t.source.slice(0, 100),
                    default: p.equipped_title === t.title
                }))
            }, now)
        );
    }

    const actionButtons = [];
    if (pg.totalPages > 1) {
        actionButtons.push(
            btn('achievements', 'prev_page', ownerId, {
                label: `${pg.page}/${pg.totalPages}`,
                emoji: '◀️',
                style: ButtonStyle.Secondary,
                disabled: pg.page <= 1,
                arg: `${selectedCategory}:${pg.page - 1}`
            }, now),
            btn('achievements', 'next_page', ownerId, {
                emoji: '▶️',
                style: ButtonStyle.Secondary,
                disabled: pg.page >= pg.totalPages,
                arg: `${selectedCategory}:${pg.page + 1}`
            }, now)
        );
    }

    actionButtons.push(
        btn('achievements', 'claim', ownerId, {
            label: evalRes.claimableCount > 0 ? `Klaim Semua (${evalRes.claimableCount})` : 'Semua Diklaim',
            emoji: '🎁',
            style: ButtonStyle.Success,
            disabled: evalRes.claimableCount <= 0,
            arg: stateArg
        }, now)
    );

    if (p.equipped_title) {
        actionButtons.push(
            btn('achievements', 'unequip', ownerId, {
                label: 'Lepas Gelar',
                emoji: '🚫',
                style: ButtonStyle.Secondary,
                arg: stateArg
            }, now)
        );
    }

    actionButtons.push(
        btn('achievements', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary,
            arg: stateArg
        }, now)
    );

    rows.push(new ActionRowBuilder().addComponents(actionButtons));

    return buildPanel({
        mod: 'achievements',
        ownerId,
        accentColor: evalRes.claimableCount > 0 ? COLORS.SUCCESS : COLORS.PRIMARY,
        title,
        player: p,
        banner,
        blocks,
        rows,
        footer: 'Selesaikan achievement, beli item prestise di /shop, putar /gacha, atau ikuti /event untuk membuka gelar eksklusif.',
        now
    });
}

module.exports = {
    name: 'achievements',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('achievements')
        .setDescription('Buka panel achievement & gelar (Title): cek progres, klaim hadiah, dan pasang gelar profil.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchAchievementsState(interaction.user.id, now);
        return await interaction.reply(buildAchievementsPanel({ state, now }));
    },

    panel: {
        buttons: {
            async home(interaction, parsed) {
                const now = Date.now();
                const { cat, page } = parseCatPageArg(parsed.arg);
                const state = await fetchAchievementsState(interaction.user.id, now);
                return await interaction.update(buildAchievementsPanel({ state, selectedCategory: cat, page, now }));
            },
            async prev_page(interaction, parsed) {
                const now = Date.now();
                const { cat, page } = parseCatPageArg(parsed.arg);
                const state = await fetchAchievementsState(interaction.user.id, now);
                return await interaction.update(buildAchievementsPanel({ state, selectedCategory: cat, page, now }));
            },
            async next_page(interaction, parsed) {
                const now = Date.now();
                const { cat, page } = parseCatPageArg(parsed.arg);
                const state = await fetchAchievementsState(interaction.user.id, now);
                return await interaction.update(buildAchievementsPanel({ state, selectedCategory: cat, page, now }));
            },
            async claim(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const { cat, page } = parseCatPageArg(parsed.arg);
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await claimAchievementRewards(conn, synced.player, now);
                });

                const state = await fetchAchievementsState(userId, now);
                let banner = null;
                if (res.error === 'NO_CLAIMABLE') {
                    banner = { type: 'info', text: 'Belum ada hadiah achievement yang siap diklaim.' };
                } else if (res.error === 'BAG_FULL') {
                    banner = { type: 'danger', text: '🎒 Kapasitas tas penuh! Kosongkan slot tas atau pindahkan barang ke `/storage` terlebih dahulu.' };
                } else {
                    const itemSummary = res.rewardedItems.map(rw => {
                        const it = getItem(rw.itemId);
                        return `${it ? it.emoji : '📦'} ${it ? it.name : rw.itemId} ×${rw.qty}`;
                    }).join(', ');
                    const titleSummary = res.unlockedTitles.length > 0
                        ? ` · Gelar Baru: **${res.unlockedTitles.join(', ')}**`
                        : '';
                    banner = {
                        type: 'success',
                        text: `🎉 Berhasil mengklaim **${res.claimedAchievements.length} Achievement**! Hadiah: ${itemSummary || '-'}${titleSummary}`
                    };
                }

                return await interaction.update(buildAchievementsPanel({ state, selectedCategory: cat, page, banner, now }));
            },
            async unequip(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const { cat, page } = parseCatPageArg(parsed.arg);
                await withTransaction(async (conn) => {
                    await syncPlayerVitals(conn, userId, now, true);
                    await conn.execute(`UPDATE players SET equipped_title = NULL WHERE discord_id = ?`, [userId]);
                });

                const state = await fetchAchievementsState(userId, now);
                return await interaction.update(
                    buildAchievementsPanel({
                        state,
                        selectedCategory: cat,
                        page,
                        banner: { type: 'info', text: '🏷️ Gelar kehormatan pada profilmu telah dilepas.' },
                        now
                    })
                );
            }
        },
        selects: {
            async cat(interaction) {
                const now = Date.now();
                const cat = interaction.values[0] || 'all';
                const state = await fetchAchievementsState(interaction.user.id, now);
                return await interaction.update(buildAchievementsPanel({ state, selectedCategory: cat, page: 1, now }));
            },
            async equip_title(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const { cat, page } = parseCatPageArg(parsed.arg);
                const chosenTitle = interaction.values[0] || '';

                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    const unlocked = await getUnlockedTitles(conn, synced.player, now);
                    const matched = unlocked.find(t => t.title === chosenTitle);
                    if (!matched) return { error: 'NOT_UNLOCKED' };
                    await conn.execute(`UPDATE players SET equipped_title = ? WHERE discord_id = ?`, [matched.title, userId]);
                    return { ok: true, matched };
                });

                const state = await fetchAchievementsState(userId, now);
                const banner = res.ok
                    ? { type: 'success', text: `✨ Gelar **${res.matched.title}** berhasil dipasang ke profilmu!` }
                    : { type: 'warning', text: 'Gelar tersebut belum terbuka.' };
                return await interaction.update(buildAchievementsPanel({ state, selectedCategory: cat, page, banner, now }));
            }
        }
    },

    buildAchievementsPanel
};
