const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonStyle
} = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerInventory } = require('../../services/inventoryService');
const { getCurrentWeather } = require('../../services/eventService');
const { rollActivityBonusTicket } = require('../../services/gachaService');
const {
    getPlayerFarmPlots,
    rentFarmPlot,
    buyFarmPlot,
    plantPlots,
    waterPlots,
    fertilizePlot,
    harvestPlots,
    craftCompost
} = require('../../services/farmService');
const {
    CROPS,
    FARM_LIMITS,
    getCrop,
    getRentPlotPrice,
    getBuyPlotPrice,
    getBonusYieldChanceFromLevel
} = require('../../data/crops');
const { getItem } = require('../../data/items');
const { getLevelInfoFromXp } = require('../../data/locations');
const {
    COLORS,
    formatLp,
    formatDuration
} = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select,
    confirmView
} = require('../../utils/panelBuilder');

function formatPlotLine(plot, now = Date.now()) {
    const typeTag = plot.ownership_type === 'owned' ? '🏡 Milik' : '📑 Sewa';
    if (plot.is_locked) {
        return `🔒 **Petak #${plot.plot_number}** (${typeTag}) — **TERKUNCI** *(Tunggakan sewa mingguan)*`;
    }
    if (plot.phase === 0 || !plot.crop_id) {
        return `🟫 **Petak #${plot.plot_number}** (${typeTag}) — *Kosong (Siap ditanam)*`;
    }

    const crop = getCrop(plot.crop_id);
    const cropLabel = crop ? `${crop.emoji} **${crop.name}**` : `🌱 **${plot.crop_id}**`;
    const fertBadge = plot.fertilizer_type === 'urea'
        ? ' · 🧪 *Urea (-25% waktu)*'
        : plot.fertilizer_type === 'kompos'
            ? ' · 🍂 *Kompos (+1 hasil)*'
            : '';

    if (plot.phase === 1 || plot.phase === 2) {
        const phaseName = plot.phase === 1 ? '🌱 Fase 1 (Tunas)' : '🌼 Fase 2 (Berbunga)';
        const readyUnix = Math.floor((now + (plot.remainingPhaseMs || 0)) / 1000);
        const waterStatus = plot.watered === 1
            ? `💧 Disiram · Selesai fase <t:${readyUnix}:R> (${formatDuration(plot.remainingPhaseMs || 0)})`
            : `🏜️ **Belum Disiram!**`;
        return `🔹 **Petak #${plot.plot_number}** (${typeTag}) — ${cropLabel}${fertBadge}\n   └ ${phaseName} · ${waterStatus}`;
    }

    if (plot.phase === 3) {
        const wiltLabel = plot.wiltRemainingMs > 0
            ? `Layu dalam **${formatDuration(plot.wiltRemainingMs)}**`
            : 'Segera panen!';
        return `✅ **Petak #${plot.plot_number}** (${typeTag}) — ${cropLabel}${fertBadge}\n   └ 🌾 **SIAP PANEN!** · *${wiltLabel}*`;
    }

    return `🥀 **Petak #${plot.plot_number}** (${typeTag}) — ${cropLabel}\n   └ ⚠️ **LAYU** *(Panen untuk membersihkan menjadi 🤢 Bahan Basi)*`;
}

async function fetchFarmState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const p = synced.player;
        const plots = await getPlayerFarmPlots(conn, discordId, now, false);
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const weather = await getCurrentWeather(conn, now);

        const seedCounts = {};
        for (const crop of Object.values(CROPS)) {
            seedCounts[crop.id] = invRows
                .filter(r => r.item_id === crop.seedId)
                .reduce((acc, r) => acc + Number(r.quantity), 0);
        }

        let activeCropId = p.last_farm_crop || 'bayam';
        if (!getCrop(activeCropId)) activeCropId = 'bayam';
        if ((seedCounts[activeCropId] || 0) <= 0) {
            const firstOwned = Object.values(CROPS).find(c => (seedCounts[c.id] || 0) > 0);
            if (firstOwned) activeCropId = firstOwned.id;
        }

        const ureaCount = invRows.filter(r => r.item_id === 'pupuk_urea').reduce((a, r) => a + Number(r.quantity), 0);
        const komposCount = invRows.filter(r => r.item_id === 'kompos').reduce((a, r) => a + Number(r.quantity), 0);
        const basiCount = invRows.filter(r => r.item_id === 'bahan_basi').reduce((a, r) => a + Number(r.quantity), 0);

        return {
            player: p,
            buffs: synced.buffs,
            plots,
            invRows,
            weather,
            seedCounts,
            activeCropId,
            ureaCount,
            komposCount,
            basiCount
        };
    });
}

function buildFarmPanel({
    state,
    mode = 'view',
    banner = null,
    now = Date.now()
}) {
    const { player: p, plots, weather, seedCounts, activeCropId, ureaCount, komposCount, basiCount } = state;
    const ownerId = p.discord_id;
    const farmingInfo = getLevelInfoFromXp(p.farming_xp || 0);
    const bonusYieldPct = Math.round(getBonusYieldChanceFromLevel(farmingInfo.level) * 100);
    const activeCrop = getCrop(activeCropId) || getCrop('bayam');

    const rentedCount = plots.filter(pl => pl.ownership_type === 'rent').length;
    const ownedCount = plots.filter(pl => pl.ownership_type === 'owned').length;
    const nextRentCost = rentedCount < FARM_LIMITS.MAX_RENTED_PLOTS && plots.length < FARM_LIMITS.MAX_TOTAL_PLOTS
        ? getRentPlotPrice(rentedCount + 1)
        : null;
    const nextBuyCost = plots.length < FARM_LIMITS.MAX_TOTAL_PLOTS
        ? getBuyPlotPrice(ownedCount + 1)
        : null;

    const headerLines = [
        `👨‍🌾 **Farming Lv. ${farmingInfo.level}** (\`${farmingInfo.currentXp}/${farmingInfo.requiredXp} EXP\`) · 🍀 Peluang Hasil +1: **${bonusYieldPct}%** · ${weather.emoji} **${weather.name}**`,
        `🗺️ **Kapasitas Lahan:** **${plots.length}/${FARM_LIMITS.MAX_TOTAL_PLOTS} Petak** *(Sewa: ${rentedCount}/${FARM_LIMITS.MAX_RENTED_PLOTS} · Milik: ${ownedCount})*`,
        `🌱 **Bibit Terpilih:** ${activeCrop.emoji} **${activeCrop.name}** *(Stok: \`×${seedCounts[activeCrop.id] || 0}\` · Lv.${activeCrop.minLevel})*`
    ];

    const plotLines = plots.length > 0
        ? plots.map(pl => formatPlotLine(pl, now)).join('\n\n')
        : '🌱 *Kamu belum memiliki petak kebun! Klik tombol **➕ Tambah Lahan** di bawah untuk menyewa (mulai Lp 15.000/mgg) atau membeli lahan permanen.*';

    const blocks = [headerLines.join('\n'), plotLines];
    const rows = [];

    if (mode === 'fertilize') {
        const eligiblePhase1 = plots.filter(pl => !pl.is_locked && pl.phase === 1 && !pl.fertilizer_type);
        blocks.push(
            [
                `🧪 **Menu Pemupukan & Daur Ulang Kompos**`,
                `• Stok **🧪 Pupuk Urea (-25% waktu):** \`×${ureaCount}\``,
                `• Stok **🍂 Pupuk Kompos (+1 hasil):** \`×${komposCount}\``,
                `• Stok **🤢 Bahan Basi:** \`×${basiCount}\` *(5 Bahan Basi = 1 Kompos)*`,
                `• Petak Fase 1 Siap Dipupuk: **${eligiblePhase1.length} petak**`
            ].join('\n')
        );

        rows.push(
            new ActionRowBuilder().addComponents(
                btn('farm', 'fert_urea', ownerId, {
                    label: `Tabur Urea (${ureaCount})`,
                    emoji: '🧪',
                    style: ButtonStyle.Primary,
                    disabled: ureaCount <= 0 || eligiblePhase1.length === 0
                }, now),
                btn('farm', 'fert_kompos', ownerId, {
                    label: `Tabur Kompos (${komposCount})`,
                    emoji: '🍂',
                    style: ButtonStyle.Success,
                    disabled: komposCount <= 0 || eligiblePhase1.length === 0
                }, now),
                btn('farm', 'craft_kompos', ownerId, {
                    label: 'Buat 1 Kompos',
                    emoji: '♻️',
                    style: ButtonStyle.Secondary,
                    arg: '1',
                    disabled: basiCount < 5
                }, now),
                btn('farm', 'craft_kompos', ownerId, {
                    label: 'Olah Semua Basi',
                    emoji: '♻️',
                    style: ButtonStyle.Secondary,
                    arg: 'all',
                    disabled: basiCount < 5
                }, now),
                btn('farm', 'home', ownerId, {
                    label: 'Kembali',
                    emoji: '⬅️',
                    style: ButtonStyle.Secondary
                }, now)
            )
        );
    } else if (mode === 'expand') {
        blocks.push(
            [
                `➕ **Perluasan Lahan Perkebunan**`,
                nextRentCost !== null
                    ? `• 📑 **Sewa Petak ke-${rentedCount + 1}:** **${formatLp(nextRentCost)} / minggu**`
                    : `• 📑 **Sewa Petak:** *Batas sewa tercapai (${rentedCount}/${FARM_LIMITS.MAX_RENTED_PLOTS})*`,
                nextBuyCost !== null
                    ? `• 🏡 **Beli Petak Permanen ke-${ownedCount + 1}:** **${formatLp(nextBuyCost)}** *(Bebas sewa selamanya)*`
                    : `• 🏡 **Beli Petak Permanen:** *Batas maksimal 16 petak tercapai*`
            ].join('\n')
        );

        rows.push(
            new ActionRowBuilder().addComponents(
                btn('farm', 'rent_prompt', ownerId, {
                    label: nextRentCost !== null ? `Sewa Petak (${formatLp(nextRentCost)}/mgg)` : 'Batas Sewa Penuh',
                    emoji: '📑',
                    style: ButtonStyle.Primary,
                    disabled: nextRentCost === null
                }, now),
                btn('farm', 'buy_prompt', ownerId, {
                    label: nextBuyCost !== null ? `Beli Permanen (${formatLp(nextBuyCost)})` : 'Lahan Penuh',
                    emoji: '🏡',
                    style: ButtonStyle.Success,
                    disabled: nextBuyCost === null
                }, now),
                btn('farm', 'home', ownerId, {
                    label: 'Kembali',
                    emoji: '⬅️',
                    style: ButtonStyle.Secondary
                }, now)
            )
        );
    } else {
        // Row 1: Dropdown pilih bibit
        rows.push(
            select('farm', 'seed', ownerId, {
                placeholder: '🌱 Pilih bibit tanaman yang ingin ditanam...',
                options: Object.values(CROPS).map(c => {
                    const qty = seedCounts[c.id] || 0;
                    const unlocked = farmingInfo.level >= c.minLevel;
                    return {
                        label: `${c.name} (Bibit: ×${qty} · Lv.${c.minLevel}+)`,
                        value: c.id,
                        emoji: unlocked ? c.emoji : '🔒',
                        description: `Waktu tumbuh: ${formatDuration(c.growTimeMs)} · Hasil: ${c.baseYield}–${c.baseYield + 2} buah · Jual: ${formatLp(c.sellPrice)}/buah`,
                        default: c.id === activeCrop.id
                    };
                })
            }, now)
        );

        const hasEmpty = plots.some(pl => !pl.is_locked && pl.phase === 0);
        const hasDry = plots.some(pl => !pl.is_locked && (pl.phase === 1 || pl.phase === 2) && pl.watered === 0);
        const hasHarvest = plots.some(pl => !pl.is_locked && (pl.phase === 3 || pl.phase === 4));

        // Row 2: Tombol Aksi Kebun
        rows.push(
            new ActionRowBuilder().addComponents(
                btn('farm', 'plant_all', ownerId, {
                    label: `Tanam (${activeCrop.name})`,
                    emoji: '🌱',
                    style: ButtonStyle.Primary,
                    disabled: !hasEmpty || (seedCounts[activeCrop.id] || 0) <= 0 || farmingInfo.level < activeCrop.minLevel
                }, now),
                btn('farm', 'water_all', ownerId, {
                    label: 'Siram Semua',
                    emoji: '💧',
                    style: ButtonStyle.Secondary,
                    disabled: !hasDry
                }, now),
                btn('farm', 'harvest_all', ownerId, {
                    label: 'Panen Semua',
                    emoji: '🌾',
                    style: ButtonStyle.Success,
                    disabled: !hasHarvest
                }, now),
                btn('farm', 'mode_fert', ownerId, {
                    label: 'Pupuk & Kompos',
                    emoji: '🧪',
                    style: ButtonStyle.Secondary
                }, now),
                btn('farm', 'mode_expand', ownerId, {
                    label: 'Tambah Lahan',
                    emoji: '➕',
                    style: ButtonStyle.Secondary
                }, now)
            )
        );
    }

    return buildPanel({
        mod: 'farm',
        ownerId,
        accentColor: COLORS.SUCCESS,
        title: `🌾 Perkebunan & Lahan Tani`,
        player: p,
        banner,
        blocks,
        rows,
        footer: 'Musim Hujan menyiram otomatis · Bibit & pupuk dapat dibeli di Toko Tani (/shop).',
        now
    });
}

async function handleFarmQuickAction(interaction, actionType) {
    const now = Date.now();
    const userId = interaction.user.id;
    let banner = null;

    await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, userId, now, true);
        const player = synced.player;
        if (actionType === 'plant') {
            const res = await plantPlots(conn, player, player.last_farm_crop || 'bayam', null, now);
            banner = res.ok
                ? { type: 'success', text: `🌱 Menanam **${res.seedsUsed}× ${res.crop.emoji} ${res.crop.name}** di Petak **#${res.plantedPlots.join(', #')}**!` }
                : { type: 'warning', text: 'Gagal menanam: pastikan ada petak kosong, bibit cukup di tas, dan Energy mencukupi.' };
        } else if (actionType === 'water') {
            const res = await waterPlots(conn, player, null, now);
            banner = res.ok
                ? { type: 'success', text: `💧 Menyiram **${res.wateredPlots.length} petak** (#${res.wateredPlots.join(', #')})!` }
                : { type: 'info', text: 'Semua tanaman yang sedang tumbuh sudah disiram.' };
        } else if (actionType === 'harvest') {
            const res = await harvestPlots(conn, player, null, now, synced.buffs);
            if (res.ok) {
                const gachaTicketDrop = await rollActivityBonusTicket(conn, userId, 'farm', { maxSlots: player.max_slots }, now);
                const ticketNotice = gachaTicketDrop?.dropped && gachaTicketDrop.item
                    ? ` · 🎟️ Bonus: **+1× ${gachaTicketDrop.item.emoji} ${gachaTicketDrop.item.name}**!`
                    : '';
                const itemSummary = Object.entries(res.harvestedItems)
                    .map(([id, qty]) => {
                        const it = getItem(id);
                        return `${qty}× ${it ? `${it.emoji} ${it.name}` : id}`;
                    })
                    .join(', ');
                banner = { type: 'success', text: `🌾 Panen berhasil dari Petak **#${res.harvestedPlots.join(', #')}**: **${itemSummary}** (+${res.totalXpGained} EXP)${ticketNotice}!` };
            } else {
                banner = { type: 'warning', text: 'Belum ada petak yang siap dipanen atau kapasitas tas penuh.' };
            }
        }
    });

    const state = await fetchFarmState(userId, now);
    return await interaction.update(buildFarmPanel({ state, banner, now }));
}

module.exports = {
    name: 'farm',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('farm')
        .setDescription('Kelola lahan pertanian interaktif: tanam bibit, siram, beri pupuk, daur ulang kompos, dan panen.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchFarmState(interaction.user.id, now);
        return await interaction.reply(buildFarmPanel({ state, mode: 'view', now }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchFarmState(interaction.user.id, now);
                return await interaction.update(buildFarmPanel({ state, mode: 'view', now }));
            },
            async mode_fert(interaction) {
                const now = Date.now();
                const state = await fetchFarmState(interaction.user.id, now);
                return await interaction.update(buildFarmPanel({ state, mode: 'fertilize', now }));
            },
            async mode_expand(interaction) {
                const now = Date.now();
                const state = await fetchFarmState(interaction.user.id, now);
                return await interaction.update(buildFarmPanel({ state, mode: 'expand', now }));
            },
            async plant_all(interaction) {
                return await handleFarmQuickAction(interaction, 'plant');
            },
            async water_all(interaction) {
                return await handleFarmQuickAction(interaction, 'water');
            },
            async harvest_all(interaction) {
                return await handleFarmQuickAction(interaction, 'harvest');
            },
            async fert_urea(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await fertilizePlot(conn, synced.player, null, 'pupuk_urea', now);
                });
                const state = await fetchFarmState(userId, now);
                const banner = res.ok
                    ? { type: 'success', text: `🧪 Menaburkan **Pupuk Urea** pada **Petak #${res.plotNumber}** (Waktu tumbuh -25%)!` }
                    : { type: 'warning', text: 'Tidak ada petak Fase 1 yang belum dipupuk atau stok Pupuk Urea habis.' };
                return await interaction.update(buildFarmPanel({ state, mode: 'fertilize', banner, now }));
            },
            async fert_kompos(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await fertilizePlot(conn, synced.player, null, 'kompos', now);
                });
                const state = await fetchFarmState(userId, now);
                const banner = res.ok
                    ? { type: 'success', text: `🍂 Menaburkan **Pupuk Kompos** pada **Petak #${res.plotNumber}** (Hasil panen +1 buah)!` }
                    : { type: 'warning', text: 'Tidak ada petak Fase 1 yang belum dipupuk atau stok Pupuk Kompos habis.' };
                return await interaction.update(buildFarmPanel({ state, mode: 'fertilize', banner, now }));
            },
            async craft_kompos(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const stateBefore = await fetchFarmState(userId, now);
                const maxBatches = Math.max(1, Math.floor(stateBefore.basiCount / 5));
                const qty = parsed.arg === 'all' ? maxBatches : 1;

                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await craftCompost(conn, synced.player, qty, now);
                });
                const state = await fetchFarmState(userId, now);
                const banner = res.ok
                    ? { type: 'success', text: `♻️ Mengolah **${res.basiUsed}× Bahan Basi** menjadi **${res.batchesCreated}× 🍂 Pupuk Kompos Organik**!` }
                    : { type: 'warning', text: 'Gagal membuat kompos: pastikan ada minimal 5 Bahan Basi dan slot tas tersedia.' };
                return await interaction.update(buildFarmPanel({ state, mode: 'fertilize', banner, now }));
            },
            async rent_prompt(interaction) {
                const now = Date.now();
                const state = await fetchFarmState(interaction.user.id, now);
                const rentedCount = state.plots.filter(pl => pl.ownership_type === 'rent').length;
                const cost = getRentPlotPrice(rentedCount + 1);

                return await interaction.update(
                    confirmView({
                        mod: 'farm',
                        confirmAction: 'rent_confirm',
                        cancelAction: 'mode_expand',
                        ownerId: interaction.user.id,
                        title: '📑 Konfirmasi Sewa Petak Kebun',
                        description: [
                            `Kamu akan menyewa **Petak Kebun #${state.plots.length + 1}** dengan biaya sewa **${formatLp(cost)} / minggu**.`,
                            'Apakah kamu yakin ingin melanjutkan?'
                        ],
                        confirmLabel: `Ya, Sewa (${formatLp(cost)})`,
                        confirmStyle: ButtonStyle.Primary,
                        player: state.player,
                        now
                    })
                );
            },
            async rent_confirm(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await rentFarmPlot(conn, synced.player, now);
                });
                const state = await fetchFarmState(userId, now);
                const banner = res.ok
                    ? { type: 'success', text: `✅ Berhasil menyewa **Petak #${res.plotNumber}** seharga **${formatLp(res.cost)}/minggu**!` }
                    : { type: 'danger', text: `Gagal menyewa petak: pastikan uang tunai (Cash) mencukupi.` };
                return await interaction.update(buildFarmPanel({ state, mode: 'view', banner, now }));
            },
            async buy_prompt(interaction) {
                const now = Date.now();
                const state = await fetchFarmState(interaction.user.id, now);
                const ownedCount = state.plots.filter(pl => pl.ownership_type === 'owned').length;
                const cost = getBuyPlotPrice(ownedCount + 1);

                return await interaction.update(
                    confirmView({
                        mod: 'farm',
                        confirmAction: 'buy_confirm',
                        cancelAction: 'mode_expand',
                        ownerId: interaction.user.id,
                        title: '🏡 Konfirmasi Beli Lahan Permanen',
                        description: [
                            `Kamu akan membeli **Petak Kebun Permanen #${state.plots.length + 1}** seharga **${formatLp(cost)}** (bebas sewa mingguan selamanya).`,
                            'Apakah kamu yakin ingin membeli petak lahan ini?'
                        ],
                        confirmLabel: `Ya, Beli (${formatLp(cost)})`,
                        confirmStyle: ButtonStyle.Success,
                        player: state.player,
                        now
                    })
                );
            },
            async buy_confirm(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await buyFarmPlot(conn, synced.player, now);
                });
                const state = await fetchFarmState(userId, now);
                const banner = res.ok
                    ? { type: 'success', text: `🏡 Selamat! **Petak Permanen #${res.plotNumber}** resmi dibeli seharga **${formatLp(res.cost)}**!` }
                    : { type: 'danger', text: `Gagal membeli lahan: pastikan uang tunai (Cash) mencukupi.` };
                return await interaction.update(buildFarmPanel({ state, mode: 'view', banner, now }));
            }
        },
        selects: {
            async seed(interaction) {
                const now = Date.now();
                const cropId = interaction.values[0] || 'bayam';
                await query(`UPDATE players SET last_farm_crop = ? WHERE discord_id = ?`, [cropId, interaction.user.id]);
                const state = await fetchFarmState(interaction.user.id, now);
                return await interaction.update(buildFarmPanel({ state, mode: 'view', now }));
            }
        }
    },

    buildFarmPanel,
    handleFarmQuickAction
};
