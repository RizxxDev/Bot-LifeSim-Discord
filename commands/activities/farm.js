const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
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
    formatDuration,
    formatVitalsCompact,
    buildV2Card
} = require('../../utils/uiBuilder');

function formatPlotLine(plot) {
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
        const waterStatus = plot.watered === 1
            ? `💧 Disiram · Sisa fase: **${formatDuration(Math.ceil(plot.remainingPhaseMs / 1000))}**`
            : `🏜️ **Belum Disiram!** *(Gunakan \`/farm water\`)*`;
        return `🔹 **Petak #${plot.plot_number}** (${typeTag}) — ${cropLabel}${fertBadge}\n   └ ${phaseName} · ${waterStatus}`;
    }

    if (plot.phase === 3) {
        const wiltLabel = plot.wiltRemainingMs > 0
            ? `Layu dalam **${formatDuration(Math.ceil(plot.wiltRemainingMs / 1000))}**`
            : 'Segera panen!';
        return `✅ **Petak #${plot.plot_number}** (${typeTag}) — ${cropLabel}${fertBadge}\n   └ 🌾 **SIAP PANEN!** · *${wiltLabel}*`;
    }

    return `🥀 **Petak #${plot.plot_number}** (${typeTag}) — ${cropLabel}\n   └ ⚠️ **LAYU** *(Panen untuk membersihkan menjadi 🤢 Bahan Basi)*`;
}

function buildFarmQuickButtons(plots, lastCropId = 'bayam') {
    const hasEmpty = plots.some(p => !p.is_locked && p.phase === 0);
    const hasDry = plots.some(p => !p.is_locked && (p.phase === 1 || p.phase === 2) && p.watered === 0);
    const hasHarvest = plots.some(p => !p.is_locked && (p.phase === 3 || p.phase === 4));
    const lastCrop = getCrop(lastCropId) || getCrop('bayam');

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('farm_quick_plant')
            .setLabel(`Tanam Semua (${lastCrop.name})`)
            .setEmoji('🌱')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!hasEmpty),
        new ButtonBuilder()
            .setCustomId('farm_quick_water')
            .setLabel('Siram Semua')
            .setEmoji('💧')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!hasDry),
        new ButtonBuilder()
            .setCustomId('farm_quick_harvest')
            .setLabel('Panen Semua')
            .setEmoji('🌾')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!hasHarvest)
    );
}

async function buildFarmDashboardPayload(conn, player, now = Date.now(), extraNotice = null) {
    const plots = await getPlayerFarmPlots(conn, player.discord_id, now, false);
    const farmingInfo = getLevelInfoFromXp(player.farming_xp || 0);
    const bonusYieldPct = Math.round(getBonusYieldChanceFromLevel(farmingInfo.level) * 100);

    const rentedCount = plots.filter(p => p.ownership_type === 'rent').length;
    const ownedCount = plots.filter(p => p.ownership_type === 'owned').length;
    const nextRentCost = rentedCount < FARM_LIMITS.MAX_RENTED_PLOTS ? getRentPlotPrice(rentedCount + 1) : null;
    const nextBuyCost = plots.length < FARM_LIMITS.MAX_TOTAL_PLOTS ? getBuyPlotPrice(ownedCount + 1) : null;

    const headerLines = [
        `👨‍🌾 **Farming Lv. ${farmingInfo.level}** (${farmingInfo.currentXp}/${farmingInfo.requiredXp} EXP) · 🍀 Peluang Hasil +1: **${bonusYieldPct}%**`,
        `🗺️ **Kapasitas Lahan:** **${plots.length}/${FARM_LIMITS.MAX_TOTAL_PLOTS} Petak** *(Sewa: ${rentedCount}/${FARM_LIMITS.MAX_RENTED_PLOTS} · Milik: ${ownedCount})*`,
        `📊 ${formatVitalsCompact(player)} · 💵 Dompet: **${formatLp(player.cash)}**`
    ];

    const plotLines = plots.length > 0
        ? plots.map(formatPlotLine).join('\n\n')
        : '🌱 *Kamu belum memiliki petak kebun! Gunakan `/farm rent` (mulai 15.000 Lp/minggu) atau `/farm buy` (mulai 400.000 Lp permanen) untuk membuka lahan pertamamu.*';

    const footerHints = [];
    if (nextRentCost !== null && plots.length < FARM_LIMITS.MAX_TOTAL_PLOTS) {
        footerHints.push(`📑 Sewa petak ke-${rentedCount + 1}: **${formatLp(nextRentCost)}/minggu** (\`/farm rent\`)`);
    }
    if (nextBuyCost !== null) {
        footerHints.push(`🏡 Beli petak permanen ke-${ownedCount + 1}: **${formatLp(nextBuyCost)}** (\`/farm buy\`)`);
    }

    const blocks = [];
    if (extraNotice) blocks.push(extraNotice);
    blocks.push(headerLines.join('\n'));
    blocks.push(plotLines);
    if (footerHints.length > 0) blocks.push(footerHints.join(' · '));

    const actionRows = plots.length > 0 ? [buildFarmQuickButtons(plots, player.last_farm_crop)] : [];

    return buildV2Card({
        accentColor: COLORS.SUCCESS,
        title: '🌾 Perkebunan & Lahan Tani (/farm)',
        blocks,
        actionRows
    });
}

async function handleFarmQuickAction(interaction, actionType) {
    const now = Date.now();
    const discordId = interaction.user.id;

    const payload = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const player = synced.player;

        if (player.sleeping_until > now || player.hospital_until > now) {
            return buildV2Card({
                accentColor: COLORS.WARNING,
                title: '⏸️ Tidak Bisa Bertani Sekarang',
                blocks: ['Kamu sedang tidur atau dirawat di RS. Tunggu hingga pulih terlebih dahulu!'],
                ephemeral: true
            });
        }

        let notice = null;
        if (actionType === 'plant') {
            const cropId = player.last_farm_crop || 'bayam';
            const res = await plantPlots(conn, player, cropId, null, now);
            if (!res.ok) {
                const seedName = res.seedItem ? `${res.seedItem.emoji} ${res.seedItem.name}` : 'bibit';
                const errMsg = res.error === 'NO_SEEDS'
                    ? `⚠️ Kamu kehabisan **${seedName}** di tas! Beli bibit dulu di \`/shop\` (Toko Tani).`
                    : res.error === 'INSUFFICIENT_ENERGY'
                        ? `⚠️ Energimu tidak cukup untuk menanam (butuh minimal **${FARM_LIMITS.ENERGY_PLANT} Energy**).`
                        : `⚠️ Tidak ada petak kosong yang siap ditanami saat ini.`;
                return buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '🌱 Gagal Menanam Cepat',
                    blocks: [errMsg],
                    ephemeral: true
                });
            }
            notice = `🌱 **Tanam Cepat Berhasil!** Menanam **${res.seedsUsed}× ${res.crop.emoji} ${res.crop.name}** di Petak **#${res.plantedPlots.join(', #')}** (-⚡${res.energyCost} Energy). Jangan lupa disiram!`;
        } else if (actionType === 'water') {
            const res = await waterPlots(conn, player, null, now);
            if (!res.ok) {
                const errMsg = res.error === 'INSUFFICIENT_ENERGY'
                    ? `⚠️ Energimu tidak cukup untuk menyiram (butuh minimal **${FARM_LIMITS.ENERGY_WATER} Energy**).`
                    : `⚠️ Semua tanaman yang sedang tumbuh sudah disiram!`;
                return buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '💧 Gagal Menyiram Cepat',
                    blocks: [errMsg],
                    ephemeral: true
                });
            }
            notice = `💧 **Siram Cepat Berhasil!** Menyiram **${res.wateredPlots.length} petak** (#${res.wateredPlots.join(', #')}) (-⚡${res.energyCost} Energy).`;
        } else if (actionType === 'harvest') {
            const res = await harvestPlots(conn, player, null, now, synced.buffs);
            if (!res.ok) {
                const errMsg = res.error === 'BAG_FULL'
                    ? `⚠️ Tasmu sudah penuh (**${res.usedSlots}/${res.maxSlots} slot**)! Kosongkan tas atau simpan ke \`/storage\` terlebih dahulu.`
                    : res.error === 'INSUFFICIENT_ENERGY'
                        ? `⚠️ Energimu tidak cukup untuk memanen (butuh minimal **${FARM_LIMITS.ENERGY_HARVEST} Energy**).`
                        : `⚠️ Belum ada petak yang siap dipanen saat ini.`;
                return buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '🌾 Gagal Memanen Cepat',
                    blocks: [errMsg],
                    ephemeral: true
                });
            }
            const itemSummary = Object.entries(res.harvestedItems)
                .map(([id, qty]) => {
                    const it = getItem(id);
                    return `${qty}× ${it ? `${it.emoji} ${it.name}` : id}`;
                })
                .join(', ');
            const lvMsg = res.leveledUp ? ` 🎉 **Naik ke Farming Lv. ${res.newLevel}!**` : '';
            notice = `🌾 **Panen Cepat Berhasil!** Memanen Petak **#${res.harvestedPlots.join(', #')}** -> **${itemSummary}** (+**${res.totalXpGained} EXP** · -⚡${res.energyCost} Energy).${lvMsg}`;
        }

        return await buildFarmDashboardPayload(conn, player, now, notice);
    });

    if (payload.flags && payload.ephemeral) {
        return await interaction.reply(payload);
    }
    return await interaction.update(payload);
}

module.exports = {
    name: 'farm',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('farm')
        .setDescription('Kelola lahan pertanian, tanam bibit, siram, beri pupuk, dan panen hasil bumi')
        .addSubcommand(sub =>
            sub.setName('view')
                .setDescription('Lihat kondisi seluruh petak kebun dan tombol aksi cepat')
        )
        .addSubcommand(sub =>
            sub.setName('rent')
                .setDescription('Sewa petak kebun baru (maksimal 8 petak sewa, bayar mingguan)')
        )
        .addSubcommand(sub =>
            sub.setName('buy')
                .setDescription('Beli petak lahan kebun permanen (bebas sewa mingguan)')
        )
        .addSubcommand(sub =>
            sub.setName('plant')
                .setDescription('Tanam bibit pada satu petak atau seluruh petak kosong')
                .addStringOption(opt =>
                    opt.setName('bibit')
                        .setDescription('Pilih bibit tanaman yang ada di tasmu')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addIntegerOption(opt =>
                    opt.setName('petak')
                        .setDescription('Nomor petak spesifik (kosongkan untuk tanam di semua petak kosong)')
                        .setMinValue(1)
                        .setMaxValue(16)
                )
        )
        .addSubcommand(sub =>
            sub.setName('water')
                .setDescription('Siram tanaman pada satu petak atau semua petak yang kering')
                .addIntegerOption(opt =>
                    opt.setName('petak')
                        .setDescription('Nomor petak spesifik (kosongkan untuk menyiram semua petak)')
                        .setMinValue(1)
                        .setMaxValue(16)
                )
        )
        .addSubcommand(sub =>
            sub.setName('fertilize')
                .setDescription('Taburkan Pupuk Urea (-25% waktu) atau Kompos (+1 hasil) pada tanaman Fase 1')
                .addStringOption(opt =>
                    opt.setName('pupuk')
                        .setDescription('Jenis pupuk yang ingin digunakan')
                        .setRequired(true)
                        .addChoices(
                            { name: '🧪 Pupuk Urea (-25% Waktu Tumbuh)', value: 'pupuk_urea' },
                            { name: '🍂 Pupuk Kompos Organik (+1 Hasil Panen)', value: 'kompos' }
                        )
                )
                .addIntegerOption(opt =>
                    opt.setName('petak')
                        .setDescription('Nomor petak Fase 1 (kosongkan untuk memilih otomatis)')
                        .setMinValue(1)
                        .setMaxValue(16)
                )
        )
        .addSubcommand(sub =>
            sub.setName('harvest')
                .setDescription('Panen tanaman matang atau bersihkan tanaman layu')
                .addIntegerOption(opt =>
                    opt.setName('petak')
                        .setDescription('Nomor petak spesifik (kosongkan untuk memanen semua petak matang)')
                        .setMinValue(1)
                        .setMaxValue(16)
                )
        )
        .addSubcommand(sub =>
            sub.setName('kompos')
                .setDescription('Daur ulang 5x Bahan Basi menjadi 1x Pupuk Kompos Organik')
                .addIntegerOption(opt =>
                    opt.setName('jumlah')
                        .setDescription('Jumlah kantong kompos yang ingin dibuat (default: 1)')
                        .setMinValue(1)
                        .setMaxValue(50)
                )
        ),

    async autocomplete(interaction) {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        try {
            const rows = await query(
                `SELECT item_id, SUM(quantity) AS total_qty
                 FROM player_inventory
                 WHERE discord_id = ? AND storage_location = 'bag' AND quantity > 0
                 GROUP BY item_id`,
                [interaction.user.id]
            );

            const choices = [];
            for (const row of rows) {
                const crop = getCrop(row.item_id);
                if (!crop) continue;
                const item = getItem(row.item_id);
                const label = `${crop.emoji} ${item ? item.name : crop.name} ×${row.total_qty} (Lv.${crop.minLevel} · ${formatDuration(crop.growTimeMs / 1000)})`;
                if (focused && !label.toLowerCase().includes(focused) && !crop.id.includes(focused)) continue;
                choices.push({
                    name: label.slice(0, 100),
                    value: crop.id
                });
            }

            if (choices.length === 0) {
                for (const crop of Object.values(CROPS)) {
                    const label = `${crop.emoji} Bibit ${crop.name} (Lv.${crop.minLevel} · Beli di /shop Toko Tani)`;
                    if (focused && !label.toLowerCase().includes(focused)) continue;
                    choices.push({ name: label.slice(0, 100), value: crop.id });
                }
            }

            await interaction.respond(choices.slice(0, 25));
        } catch {
            await interaction.respond([]);
        }
    },

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        const now = Date.now();
        const discordId = interaction.user.id;

        const responsePayload = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, true);
            const player = synced.player;

            if (sub === 'view') {
                return await buildFarmDashboardPayload(conn, player, now);
            }

            if (sub === 'rent') {
                const res = await rentFarmPlot(conn, player, now);
                if (!res.ok) {
                    const msg = res.error === 'MAX_TOTAL_PLOTS'
                        ? `Kamu sudah mencapai batas maksimal **${res.maxTotal} petak kebun**!`
                        : res.error === 'MAX_RENTED_PLOTS'
                            ? `Kamu sudah menyewa maksimal **${res.maxRented} petak sewa**! Gunakan \`/farm buy\` untuk menambah lahan permanen.`
                            : `Uang tunaimu tidak cukup! Biaya sewa petak berikutnya adalah **${formatLp(res.cost)}**, sedangkan dompetmu **${formatLp(res.cash)}**.`;
                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '⚠️ Gagal Menyewa Petak Kebun',
                        blocks: [msg],
                        ephemeral: true
                    });
                }
                const notice = `✅ **Berhasil Menyewa Petak #${res.plotNumber}!** Biaya sewa **${formatLp(res.cost)}/minggu** telah dibayar.`;
                return await buildFarmDashboardPayload(conn, player, now, notice);
            }

            if (sub === 'buy') {
                const res = await buyFarmPlot(conn, player, now);
                if (!res.ok) {
                    const msg = res.error === 'MAX_TOTAL_PLOTS'
                        ? `Kamu sudah mencapai batas maksimal **${res.maxTotal} petak kebun**!`
                        : `Uang tunaimu tidak cukup! Harga beli petak permanen berikutnya adalah **${formatLp(res.cost)}**, sedangkan dompetmu **${formatLp(res.cash)}**.`;
                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '⚠️ Gagal Membeli Lahan Permanen',
                        blocks: [msg],
                        ephemeral: true
                    });
                }
                const notice = `🏡 **Selamat! Petak Permanen #${res.plotNumber} Resmi Milikmu!** Dibeli seharga **${formatLp(res.cost)}** (bebas sewa mingguan selamanya).`;
                return await buildFarmDashboardPayload(conn, player, now, notice);
            }

            if (sub === 'plant') {
                const bibit = interaction.options.getString('bibit', true);
                const petak = interaction.options.getInteger('petak');
                const res = await plantPlots(conn, player, bibit, petak, now);

                if (!res.ok) {
                    let msg = 'Tidak dapat menanam bibit pada petak tersebut.';
                    if (res.error === 'INVALID_CROP') msg = 'Jenis bibit/tanaman tidak dikenali.';
                    else if (res.error === 'LEVEL_TOO_LOW') msg = `Menanam **${res.crop.emoji} ${res.crop.name}** membutuhkan **Farming Lv. ${res.requiredLevel}** (Levelmu saat ini: **Lv. ${res.currentLevel}**).`;
                    else if (res.error === 'NO_PLOTS') msg = 'Kamu belum punya petak kebun! Gunakan `/farm rent` atau `/farm buy` terlebih dahulu.';
                    else if (res.error === 'PLOT_NOT_FOUND') msg = `Petak **#${res.plotNumber}** tidak ditemukan.`;
                    else if (res.error === 'PLOT_LOCKED') msg = `Petak **#${res.plotNumber}** sedang terkunci karena tunggakan sewa mingguan.`;
                    else if (res.error === 'PLOT_NOT_EMPTY') msg = `Petak **#${res.plotNumber}** sedang ditanami! Panen terlebih dahulu sebelum menanam bibit baru.`;
                    else if (res.error === 'NO_EMPTY_PLOTS') msg = 'Semua petak kebunmu sedang terisi tanaman!';
                    else if (res.error === 'NO_SEEDS') msg = `Kamu tidak punya **${res.seedItem?.emoji || '🌱'} ${res.seedItem?.name || 'Bibit'}** di tas! Beli dulu di \`/shop\` (Toko Tani).`;
                    else if (res.error === 'INSUFFICIENT_ENERGY') msg = `Energimu tidak cukup! Butuh minimal **⚡${res.requiredEnergy} Energy** untuk menanam.`;

                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🌱 Gagal Menanam Bibit',
                        blocks: [msg],
                        ephemeral: true
                    });
                }

                const notice = `🌱 **Berhasil Menanam!** Menanam **${res.seedsUsed}× ${res.crop.emoji} ${res.crop.name}** di Petak **#${res.plantedPlots.join(', #')}** (-⚡${res.energyCost} Energy). Siram tanamanmu agar mulai tumbuh!`;
                return await buildFarmDashboardPayload(conn, player, now, notice);
            }

            if (sub === 'water') {
                const petak = interaction.options.getInteger('petak');
                const res = await waterPlots(conn, player, petak, now);

                if (!res.ok) {
                    let msg = 'Tidak ada petak yang perlu disiram.';
                    if (res.error === 'NO_PLOTS') msg = 'Kamu belum memiliki petak kebun.';
                    else if (res.error === 'PLOT_NOT_FOUND') msg = `Petak **#${res.plotNumber}** tidak ditemukan.`;
                    else if (res.error === 'PLOT_LOCKED') msg = `Petak **#${res.plotNumber}** sedang terkunci.`;
                    else if (res.error === 'PLOT_NOT_GROW_PHASE') msg = `Petak **#${res.plotNumber}** sedang tidak dalam fase tumbuh (kosong atau sudah matang).`;
                    else if (res.error === 'ALREADY_WATERED') msg = `Petak **#${res.plotNumber}** sudah disiram pada fase ini!`;
                    else if (res.error === 'NO_DRY_PLOTS') msg = 'Semua tanaman yang sedang tumbuh sudah disiram!';
                    else if (res.error === 'INSUFFICIENT_ENERGY') msg = `Energimu tidak cukup! Butuh minimal **⚡${res.requiredEnergy} Energy** untuk menyiram.`;

                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '💧 Gagal Menyiram Tanaman',
                        blocks: [msg],
                        ephemeral: true
                    });
                }

                const notice = `💧 **Berhasil Menyiram!** Menyiram Petak **#${res.wateredPlots.join(', #')}** (-⚡${res.energyCost} Energy). Tanaman kini aktif bertumbuh!`;
                return await buildFarmDashboardPayload(conn, player, now, notice);
            }

            if (sub === 'fertilize') {
                const pupuk = interaction.options.getString('pupuk', true);
                const petak = interaction.options.getInteger('petak');
                const res = await fertilizePlot(conn, player, petak, pupuk, now);

                if (!res.ok) {
                    let msg = 'Gagal memberikan pupuk.';
                    if (res.error === 'NO_PLOTS') msg = 'Kamu belum memiliki petak kebun.';
                    else if (res.error === 'PLOT_NOT_FOUND') msg = `Petak **#${res.plotNumber}** tidak ditemukan.`;
                    else if (res.error === 'PLOT_LOCKED') msg = `Petak **#${res.plotNumber}** sedang terkunci.`;
                    else if (res.error === 'MUST_BE_PHASE_1') msg = `Pupuk hanya dapat diberikan saat tanaman berada di **Fase 1 (Tunas)**!`;
                    else if (res.error === 'ALREADY_FERTILIZED') msg = `Petak **#${res.plotNumber}** sudah diberi pupuk sebelumnya!`;
                    else if (res.error === 'NO_ELIGIBLE_PLOT') msg = 'Tidak ada petak pada **Fase 1 (Tunas)** yang belum dipupuk saat ini.';
                    else if (res.error === 'NO_FERTILIZER_ITEM') msg = `Kamu tidak memiliki **${res.item?.emoji || '🧪'} ${res.item?.name || 'Pupuk'}** di tasmu!`;

                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🧪 Gagal Memberi Pupuk',
                        blocks: [msg],
                        ephemeral: true
                    });
                }

                const effectDesc = res.fertilizerType === 'urea' ? 'Durasi tumbuh dipercepat **-25%**' : 'Hasil panen bertambah **+1 buah**';
                const notice = `🧪 **Pemupukan Berhasil!** Menaburkan **1× ${res.item.emoji} ${res.item.name}** pada **Petak #${res.plotNumber}** (*${effectDesc}*).`;
                return await buildFarmDashboardPayload(conn, player, now, notice);
            }

            if (sub === 'harvest') {
                const petak = interaction.options.getInteger('petak');
                const res = await harvestPlots(conn, player, petak, now, synced.buffs);

                if (!res.ok) {
                    let msg = 'Belum ada tanaman yang siap dipanen.';
                    if (res.error === 'NO_PLOTS') msg = 'Kamu belum memiliki petak kebun.';
                    else if (res.error === 'PLOT_NOT_FOUND') msg = `Petak **#${res.plotNumber}** tidak ditemukan.`;
                    else if (res.error === 'PLOT_LOCKED') msg = `Petak **#${res.plotNumber}** sedang terkunci.`;
                    else if (res.error === 'NOT_READY_TO_HARVEST') msg = `Tanaman di Petak **#${res.plotNumber}** belum matang!`;
                    else if (res.error === 'NO_HARVESTABLE_PLOTS') msg = 'Belum ada petak kebun yang siap dipanen saat ini.';
                    else if (res.error === 'INSUFFICIENT_ENERGY') msg = `Energimu tidak cukup! Butuh minimal **⚡${res.requiredEnergy} Energy** untuk memanen.`;
                    else if (res.error === 'BAG_FULL') msg = `Tasmu penuh (**${res.usedSlots}/${res.maxSlots} slot**)! Kosongkan tas atau simpan barang ke \`/storage\` terlebih dahulu.`;

                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🌾 Gagal Memanen',
                        blocks: [msg],
                        ephemeral: true
                    });
                }

                const itemSummary = Object.entries(res.harvestedItems)
                    .map(([id, qty]) => {
                        const it = getItem(id);
                        return `${qty}× ${it ? `${it.emoji} ${it.name}` : id}`;
                    })
                    .join(', ');
                const lvMsg = res.leveledUp ? ` 🎉 **Naik ke Farming Lv. ${res.newLevel}!**` : '';
                const notice = `🌾 **Panen Berhasil!** Memanen Petak **#${res.harvestedPlots.join(', #')}** -> **${itemSummary}** (+**${res.totalXpGained} EXP** · -⚡${res.energyCost} Energy).${lvMsg}`;
                return await buildFarmDashboardPayload(conn, player, now, notice);
            }

            if (sub === 'kompos') {
                const jumlah = interaction.options.getInteger('jumlah') || 1;
                const res = await craftCompost(conn, player, jumlah, now);

                if (!res.ok) {
                    const msg = res.error === 'INSUFFICIENT_ROTTEN'
                        ? `Kamu membutuhkan minimal **${res.requiredPerBatch}× 🤢 Bahan Basi** di tas untuk membuat 1× Kompos (Saat ini punya: **${res.ownedBasi}×**).`
                        : `Tasmu penuh (**${res.usedSlots}/${res.maxSlots} slot**)! Kosongkan minimal 1 slot tas terlebih dahulu.`;
                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🍂 Gagal Membuat Kompos',
                        blocks: [msg],
                        ephemeral: true
                    });
                }

                return buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: '🍂 Daur Ulang Kompos Berhasil!',
                    blocks: [
                        `Kamu mengolah **${res.basiUsed}× 🤢 Bahan Basi** menjadi **${res.batchesCreated}× 🍂 Pupuk Kompos Organik** *(sisa Bahan Basi di tas: ${res.remainingBasi})*.`,
                        `💡 Gunakan \`/farm fertilize pupuk:kompos\` pada tanaman Fase 1 untuk menambah **+1 hasil panen**!`
                    ]
                });
            }
        });

        return await interaction.reply(responsePayload);
    },

    handleFarmQuickAction
};
