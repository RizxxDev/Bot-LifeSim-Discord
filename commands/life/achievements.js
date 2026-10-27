const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const {
    ACHIEVEMENT_CATEGORIES,
    evaluatePlayerAchievements,
    claimAchievementRewards
} = require('../../services/achievementService');
const { getItem } = require('../../data/items');
const { COLORS, formatLp, buildV2Card } = require('../../utils/uiBuilder');

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

function buildAchievementsViewPayload(evalRes, selectedCategory = 'all', userId = '') {
    const filtered = selectedCategory === 'all'
        ? evalRes.achievements
        : evalRes.achievements.filter(a => a.category === selectedCategory);

    const catInfo = ACHIEVEMENT_CATEGORIES.find(c => c.id === selectedCategory);
    const title = catInfo
        ? `${catInfo.emoji} Achievement: ${catInfo.name}`
        : `🏆 Buku Pencapaian Warga (${evalRes.unlockedCount}/${evalRes.totalCount})`;

    const lines = filtered.map(a => {
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
        `📊 **Total Terbuka:** **${evalRes.unlockedCount}/${evalRes.totalCount}** Achievement · 🎁 **Siap Diklaim:** **${evalRes.claimableCount}** paket hadiah`,
        lines.slice(0, 10).join('\n\n')
    ];
    if (lines.length > 10) {
        blocks.push(lines.slice(10, 20).join('\n\n'));
    }
    if (lines.length > 20) {
        blocks.push(lines.slice(20).join('\n\n'));
    }

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`ach_cat_${userId}`)
            .setPlaceholder('Pilih Kategori Achievement...')
            .addOptions([
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
            ])
    );

    const actionRows = [selectRow];
    if (evalRes.claimableCount > 0) {
        actionRows.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ach_claim_${userId}`)
                    .setLabel(`Klaim Semua Hadiah (${evalRes.claimableCount})`)
                    .setEmoji('🎁')
                    .setStyle(ButtonStyle.Success)
            )
        );
    }

    return buildV2Card({
        accentColor: evalRes.claimableCount > 0 ? COLORS.SUCCESS : COLORS.PRIMARY,
        title,
        blocks,
        actionRows,
        footer: 'Gunakan /title equip untuk memasang Gelar Achievement yang sudah terbuka.'
    });
}

module.exports = {
    name: 'achievements',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('achievements')
        .setDescription('Lihat progres pencapaian hidupmu dan klaim hadiah item & gelar eksklusif.')
        .addSubcommand(sub =>
            sub
                .setName('view')
                .setDescription('Lihat daftar achievement berdasarkan kategori.')
                .addStringOption(opt =>
                    opt
                        .setName('kategori')
                        .setDescription('Filter kategori achievement')
                        .setRequired(false)
                        .addChoices(
                            { name: '🏆 Semua Kategori', value: 'all' },
                            { name: '💼 Karir & Pekerjaan', value: 'karir' },
                            { name: '🎓 Pendidikan & Akademik', value: 'pendidikan' },
                            { name: '📖 Koleksi & Eksplorasi', value: 'koleksi' },
                            { name: '📈 Penguasaan Keahlian', value: 'skill' },
                            { name: '🏠 Properti & Ekonomi', value: 'ekonomi' },
                            { name: '❤️ Gaya Hidup & Dedikasi', value: 'kehidupan' }
                        )
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('claim')
                .setDescription('Klaim seluruh paket hadiah item dari achievement yang telah terbuka.')
        ),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        const discordId = interaction.user.id;
        const now = Date.now();

        if (sub === 'claim') {
            const res = await withTransaction(async (conn) => {
                const synced = await syncPlayerVitals(conn, discordId, now, true);
                return await claimAchievementRewards(conn, synced.player, now);
            });

            if (res.error === 'NO_CLAIMABLE') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: 'ℹ️ Belum Ada Hadiah Siap Klaim',
                        blocks: [
                            `Kamu telah membuka **${res.evalRes.unlockedCount}/${res.evalRes.totalCount}** achievement, dan seluruh hadiahnya sudah diklaim.`,
                            'Cek daftar target berikutnya dengan `/achievements view`!'
                        ],
                        ephemeral: true
                    })
                );
            }

            if (res.error === 'BAG_FULL') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.DANGER,
                        title: '🎒 Tas Tidak Muat!',
                        blocks: [
                            'Kapasitas tasmu tidak cukup untuk menampung paket hadiah achievement.',
                            'Kosongkan beberapa slot tas atau pindahkan barang ke `/storage` terlebih dahulu!'
                        ],
                        ephemeral: true
                    })
                );
            }

            const itemLines = res.rewardedItems.map(rw => {
                const it = getItem(rw.itemId);
                return `• ${it ? it.emoji : '📦'} **${it ? it.name : rw.itemId}** ×${rw.qty}`;
            });

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `🎉 Klaim Hadiah Achievement Berhasil (${res.claimedAchievements.length} Pencapaian)!`,
                    blocks: [
                        `Selamat! Kamu telah mengklaim hadiah dari: **${res.claimedAchievements.map(a => `${a.emoji} ${a.name}`).join(', ')}**`,
                        itemLines.length > 0 ? `📦 **Item Masuk ke Tas:**\n${itemLines.join('\n')}` : null,
                        res.unlockedTitles.length > 0
                            ? `🏷️ **Gelar Baru Terbuka:** ${res.unlockedTitles.map(t => `**${t}**`).join(', ')} *(Pasang lewat \`/title equip\`)*`
                            : null
                    ],
                    footer: 'Gunakan /achievements view untuk melihat pencapaian lainnya.'
                })
            );
        }

        // Subcommand: view
        let currentCat = interaction.options.getString('kategori') || 'all';
        let evalRes = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, false);
            return await evaluatePlayerAchievements(conn, synced.player, now);
        });

        await interaction.reply(buildAchievementsViewPayload(evalRes, currentCat, discordId));
        const replyMsg = await interaction.fetchReply();

        const collector = replyMsg.createMessageComponentCollector({
            filter: i => i.user.id === discordId,
            time: 60000
        });

        collector.on('collect', async (i) => {
            try {
                if (i.customId === `ach_cat_${discordId}`) {
                    currentCat = i.values[0];
                    await i.update(buildAchievementsViewPayload(evalRes, currentCat, discordId));
                } else if (i.customId === `ach_claim_${discordId}`) {
                    const claimNow = Date.now();
                    const claimOut = await withTransaction(async (conn) => {
                        const synced = await syncPlayerVitals(conn, discordId, claimNow, true);
                        return await claimAchievementRewards(conn, synced.player, claimNow);
                    });

                    if (claimOut.error === 'BAG_FULL') {
                        return await i.reply(
                            buildV2Card({
                                accentColor: COLORS.DANGER,
                                title: '🎒 Tas Penuh!',
                                blocks: ['Kosongkan slot tasmu terlebih dahulu sebelum mengklaim hadiah achievement.'],
                                ephemeral: true
                            })
                        );
                    }

                    evalRes = await withTransaction(async (conn) => {
                        const synced = await syncPlayerVitals(conn, discordId, claimNow, false);
                        return await evaluatePlayerAchievements(conn, synced.player, claimNow);
                    });

                    await i.update(buildAchievementsViewPayload(evalRes, currentCat, discordId));
                }
            } catch {
                // Abaikan bila interaksi kadaluarsa
            }
        });
    }
};
