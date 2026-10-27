const { SlashCommandBuilder } = require('discord.js');
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
const { COLORS, renderBar, buildV2Card } = require('../../utils/uiBuilder');

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

module.exports = {
    name: 'event',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('event')
        .setDescription('Cek siklus cuaca 2 mingguan, event musiman aktif, toko token, dan target komunitas.')
        .addSubcommand(sub =>
            sub
                .setName('info')
                .setDescription('Lihat kondisi cuaca saat ini, jadwal event musiman, dan saldo token event.')
        )
        .addSubcommand(sub =>
            sub
                .setName('shop')
                .setDescription('Buka Toko Event Musiman untuk menukarkan token dengan item & gelar eksklusif.')
        )
        .addSubcommand(sub =>
            sub
                .setName('buy')
                .setDescription('Tukarkan token event dengan hadiah di Toko Event Musiman.')
                .addStringOption(opt =>
                    opt
                        .setName('item')
                        .setDescription('Pilih hadiah dari Toko Event yang sedang berlangsung')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('goal')
                .setDescription('Lihat progres Target Komunitas Global selama event berlangsung.')
        )
        .addSubcommand(sub =>
            sub
                .setName('claim')
                .setDescription('Klaim hadiah Target Komunitas Global bila target server telah tercapai.')
        ),

    async autocomplete(interaction) {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        try {
            const active = await withTransaction(conn => getActiveSeasonalEvent(conn, Date.now()));
            if (!active || !active.config.shopItems) {
                return await interaction.respond([]);
            }
            const items = active.config.shopItems.filter(
                it => !focused || `${it.id} ${it.name}`.toLowerCase().includes(focused)
            );
            await interaction.respond(
                items.slice(0, 25).map(it => ({
                    name: `${it.name} (${it.tokenCost} ${active.config.tokenName})`.slice(0, 100),
                    value: it.id
                }))
            );
        } catch {
            await interaction.respond([]);
        }
    },

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        const discordId = interaction.user.id;
        const now = Date.now();

        if (sub === 'info') {
            const data = await withTransaction(async (conn) => {
                const weather = await getCurrentWeather(conn, now);
                const active = await getActiveSeasonalEvent(conn, now);
                let progress = null;
                if (active) {
                    progress = await getPlayerEventProgress(conn, discordId, active.stateRow.event_key, false);
                }
                return { weather, active, progress };
            });

            const weatherBlock = [
                `### ${data.weather.emoji} Cuaca Kota: ${data.weather.name}`,
                `${data.weather.description}`,
                `• 🔄 **Pergantian Musim Berikutnya:** <t:${Math.floor(data.weather.nextChangeAt / 1000)}:R> *(Siklus 2 Minggu)*`
            ].join('\n');

            if (!data.active) {
                const calendarLines = SEASONAL_EVENTS.map(ev => {
                    const sched = ev.scheduleType === 'fixed'
                        ? `Tanggal Tetap (${ev.fixedRange.startDay}/${ev.fixedRange.startMonth} – ${ev.fixedRange.endDay}/${ev.fixedRange.endMonth})`
                        : `Kalender Lunar/Hijriah (Diaktifkan saat perayaan)`;
                    return `• ${ev.emoji} **${ev.name}** — *${sched}*`;
                });

                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.PRIMARY,
                        title: '🌤️ Laporan Cuaca & Kalender Event Kota',
                        blocks: [
                            weatherBlock,
                            [
                                '### 📅 Status Event Musiman: Tidak Ada Event Aktif',
                                'Saat ini kota sedang berada di hari biasa. Berikut jadwal perayaan musiman tahunan:',
                                calendarLines.join('\n')
                            ].join('\n')
                        ],
                        footer: 'Cuaca berganti otomatis setiap 2 minggu sekali.'
                    })
                );
            }

            const { config, stateRow, lebaranThr } = data.active;
            const prog = data.progress;
            const goalTarget = config.communityGoal.target;
            const goalCurr = Number(stateRow.community_progress || 0);

            const eventBlock = [
                `### ${config.emoji} Event Aktif: ${config.name}`,
                `${config.description}`,
                `• ⏳ **Berakhir:** <t:${Math.floor(Number(stateRow.ends_at) / 1000)}:R>`,
                `• ✨ **Efek Aktif:** ${formatBonusesSummary(config, lebaranThr)}`,
                `• ${config.tokenEmoji} **Saldo Token Kamu:** **${prog.token_balance} ${config.tokenName}**`,
                `• 🤝 **Kontribusi Komunitasmu:** **${prog.community_contribution} aktivitas**`,
                `• 🌐 **Target Komunitas Server:** \`${renderBar(goalCurr, goalTarget, 10)}\``
            ].join('\n');

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `${config.emoji} Pusat Informasi Cuaca & Event`,
                    blocks: [weatherBlock, eventBlock],
                    footer: 'Gunakan /event shop untuk menukar token dan /event goal untuk info hadiah komunitas.'
                })
            );
        }

        if (sub === 'shop') {
            const data = await withTransaction(async (conn) => {
                const active = await getActiveSeasonalEvent(conn, now);
                if (!active) return { active: null };
                const progress = await getPlayerEventProgress(conn, discordId, active.stateRow.event_key, false);
                return { active, progress };
            });

            if (!data.active) {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🎪 Toko Event Sedang Tutup',
                        blocks: [
                            'Saat ini tidak ada Event Musiman yang sedang berlangsung.',
                            'Gunakan `/event info` untuk melihat jadwal perayaan musiman dan kondisi cuaca saat ini.'
                        ],
                        ephemeral: true
                    })
                );
            }

            const { config, stateRow } = data.active;
            const itemLines = config.shopItems.map(it => {
                return `• **${it.name}** (\`${it.id}\`) — **${it.tokenCost} ${config.tokenEmoji} ${config.tokenName}**\n  └ *${it.description}*`;
            });

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.PRIMARY,
                    title: `${config.emoji} Toko Event: ${config.name}`,
                    blocks: [
                        `💰 **Saldo Token Kamu:** **${data.progress.token_balance} ${config.tokenEmoji} ${config.tokenName}** · ⏳ Berakhir <t:${Math.floor(Number(stateRow.ends_at) / 1000)}:R>`,
                        itemLines.join('\n\n'),
                        '⚠️ *Catatan: Token event hanya berlaku selama event berlangsung dan tidak dapat diuangkan menjadi Lp.*'
                    ],
                    footer: 'Gunakan /event buy item:<id> untuk menukarkan tokenmu.'
                })
            );
        }

        if (sub === 'buy') {
            const shopItemId = interaction.options.getString('item', true);
            const res = await withTransaction(async (conn) => {
                const synced = await syncPlayerVitals(conn, discordId, now, true);
                return await buyEventShopItem(conn, synced.player, shopItemId, now);
            });

            if (res.error === 'NO_ACTIVE_EVENT') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🎪 Tidak Ada Event Aktif',
                        blocks: ['Toko Event hanya dibuka saat ada perayaan musiman yang berlangsung.'],
                        ephemeral: true
                    })
                );
            }

            if (res.error === 'INVALID_SHOP_ITEM') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '❓ Hadiah Tidak Ditemukan',
                        blocks: ['Item tersebut tidak tersedia di Toko Event saat ini. Cek daftarnya lewat `/event shop`.'],
                        ephemeral: true
                    })
                );
            }

            if (res.error === 'INSUFFICIENT_TOKENS') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.DANGER,
                        title: `${res.active.config.tokenEmoji} Token Event Tidak Cukup`,
                        blocks: [
                            `Untuk menukar **${res.shopItem.name}**, kamu membutuhkan **${res.required} ${res.active.config.tokenName}**, sedangkan saldomu saat ini **${res.balance} ${res.active.config.tokenName}**.`,
                            'Kumpulkan lebih banyak token dari `/work`, `/fishing`, `/mining`, `/farm harvest`, atau `/cook collect`!'
                        ],
                        ephemeral: true
                    })
                );
            }

            if (res.error === 'TITLE_ALREADY_OWNED') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🏷️ Gelar Sudah Dimiliki',
                        blocks: [`Kamu sudah membuka **${res.shopItem.name}**! Gunakan \`/title equip\` untuk memasangnya.`],
                        ephemeral: true
                    })
                );
            }

            if (res.error === 'BAG_FULL') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.DANGER,
                        title: '🎒 Tas Penuh!',
                        blocks: ['Kosongkan slot tasmu terlebih dahulu sebelum menukar item dari Toko Event.'],
                        ephemeral: true
                    })
                );
            }

            const { config } = res.active;
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `${config.emoji} Penukaran Token Berhasil!`,
                    blocks: [
                        `Kamu berhasil menukarkan **${res.shopItem.tokenCost} ${config.tokenEmoji} ${config.tokenName}** dengan **${res.shopItem.name}**!`,
                        res.shopItem.type === 'title'
                            ? `🏷️ Gelar **${res.shopItem.titleValue}** kini telah terbuka di \`/title list\`!`
                            : `🎒 Item telah dimasukkan ke dalam tasmu.`,
                        `• ${config.tokenEmoji} **Sisa Token Kamu:** **${res.newBalance} ${config.tokenName}**`
                    ]
                })
            );
        }

        if (sub === 'goal') {
            const data = await withTransaction(async (conn) => {
                const active = await getActiveSeasonalEvent(conn, now);
                if (!active) return { active: null };
                const progress = await getPlayerEventProgress(conn, discordId, active.stateRow.event_key, false);
                return { active, progress };
            });

            if (!data.active) {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🌐 Tidak Ada Target Komunitas Aktif',
                        blocks: ['Saat ini tidak ada Event Musiman yang sedang berjalan.'],
                        ephemeral: true
                    })
                );
            }

            const { config, stateRow } = data.active;
            const goal = config.communityGoal;
            const curr = Number(stateRow.community_progress || 0);
            const rewardText = (goal.rewardItems || []).map(rw => {
                const it = getItem(rw.itemId);
                return `${it ? it.emoji : '📦'} **${it ? it.name : rw.itemId}** ×${rw.qty}`;
            }).join(' · ');

            return await interaction.reply(
                buildV2Card({
                    accentColor: curr >= goal.target ? COLORS.SUCCESS : COLORS.PRIMARY,
                    title: `🌐 Target Komunitas: ${config.name}`,
                    blocks: [
                        `${goal.description}`,
                        `• 📊 **Progres Warga Server:** \`${renderBar(curr, goal.target, 12)}\``,
                        `• 🤝 **Kontribusi Kamu:** **${data.progress.community_contribution} aktivitas** *(Syarat klaim: min. 1 aktivitas)*`,
                        `• 🎁 **Hadiah Komunitas:** ${rewardText}`,
                        `• 📌 **Status Klaim Kamu:** ${data.progress.goal_claimed ? '✅ Sudah Diklaim' : (curr >= goal.target ? '🎉 **Siap Diklaim dengan `/event claim`!**' : '⏳ Menunggu Target Tercapai')}`
                    ]
                })
            );
        }

        // Subcommand: claim
        const res = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, true);
            return await claimCommunityGoalReward(conn, synced.player, now);
        });

        if (res.error === 'NO_ACTIVE_EVENT') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '🌐 Tidak Ada Event Aktif',
                    blocks: ['Saat ini tidak ada hadiah Target Komunitas yang dapat diklaim.'],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'GOAL_NOT_REACHED') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '⏳ Target Komunitas Belum Tercapai',
                    blocks: [
                        `Progres server saat ini masih **${res.currentGlobal}/${res.target}** aktivitas.`,
                        'Ayo bantu selesaikan aktivitas bersama warga lainnya!'
                    ],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'NO_CONTRIBUTION') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '🤝 Belum Ada Kontribusi',
                    blocks: [
                        'Kamu harus berkontribusi minimal **1 aktivitas** (`/work`, `/fishing`, `/mining`, `/farm`, atau `/cook`) selama event berlangsung untuk mengklaim hadiah komunitas!'
                    ],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'ALREADY_CLAIMED') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.PRIMARY,
                    title: '✅ Hadiah Sudah Diklaim',
                    blocks: ['Kamu sudah mengklaim hadiah Target Komunitas untuk event ini.'],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'BAG_FULL') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '🎒 Tas Penuh!',
                    blocks: ['Kosongkan slot tasmu terlebih dahulu sebelum mengklaim hadiah komunitas.'],
                    ephemeral: true
                })
            );
        }

        const rewardLines = res.rewardItems.map(rw => {
            const it = getItem(rw.itemId);
            return `• ${it ? it.emoji : '📦'} **${it ? it.name : rw.itemId}** ×${rw.qty}`;
        });

        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.SUCCESS,
                title: `🎊 Hadiah Target Komunitas Diklaim!`,
                blocks: [
                    `Terima kasih atas kontribusimu dalam **${res.active.config.emoji} ${res.active.config.name}**!`,
                    `📦 **Hadiah Diterima:**\n${rewardLines.join('\n')}`
                ]
            })
        );
    }
};
