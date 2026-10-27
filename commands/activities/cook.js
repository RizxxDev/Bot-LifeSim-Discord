const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerPropertyStatus } = require('../../services/propertyService');
const {
    getActiveCookingQueues,
    startCookingBatch,
    collectFinishedCooking
} = require('../../services/cookService');
const {
    RECIPES,
    getRecipe,
    getPerfectCookChance
} = require('../../data/recipes');
const { getItem } = require('../../data/items');
const { getLevelInfoFromXp } = require('../../data/locations');
const {
    COLORS,
    formatLp,
    formatDuration,
    formatVitalsCompact,
    buildV2Card
} = require('../../utils/uiBuilder');

function formatIngredientsList(recipe, portions = 1) {
    return recipe.ingredients
        .map(ing => {
            const totalQty = ing.qty * portions;
            if (ing.type === 'item') {
                const it = getItem(ing.itemId);
                return `${totalQty}× ${it ? `${it.emoji} ${it.name}` : ing.itemId}`;
            }
            return `${totalQty}× ${ing.label}`;
        })
        .join(' + ');
}

async function buildCookStatusPayload(conn, player, now = Date.now(), extraNotice = null) {
    const propStatus = await getPlayerPropertyStatus(conn, player.discord_id, player.max_slots, now, false);
    const stoveSlots = Number(propStatus.capacities?.stove || 0);
    const queues = await getActiveCookingQueues(conn, player.discord_id, false);
    const cookingInfo = getLevelInfoFromXp(player.cooking_xp || 0);
    const perfectPct = Math.round(getPerfectCookChance(cookingInfo.level) * 100);

    const headerLines = [
        `👨‍🍳 **Cooking Lv. ${cookingInfo.level}** (${cookingInfo.currentXp}/${cookingInfo.requiredXp} EXP) · 🌟 Peluang Masakan Sempurna: **${perfectPct}%**`,
        `🏠 **Dapur Properti:** ${propStatus.effectiveTier.emoji} **${propStatus.effectiveTier.name}** · 🔥 Kapasitas Tungku: **${queues.length}/${stoveSlots} Slot**`,
        `🟢 **Cadangan Gas LPG Kompor:** **${Number(player.lpg_charges || 0)}x masak** · 📊 ${formatVitalsCompact(player)}`
    ];

    let queueBlock = '';
    if (stoveSlots <= 0) {
        queueBlock = '⚠️ *Kamu belum memiliki dapur kompor aktif! Sewa minimal **🏠 Kos-kosan Sederhana** lewat `/property rent` untuk mulai memasak di rumah.*';
    } else if (queues.length === 0) {
        queueBlock = '🍳 *Seluruh tungku kompor sedang kosong. Gunakan `/cook start` untuk mulai memasak hidangan rumahan!*';
    } else {
        const lines = queues.map(q => {
            const rec = getRecipe(q.recipe_id);
            const recLabel = rec ? `${rec.emoji} **${rec.name}**` : q.recipe_id;
            const remMs = Math.max(0, q.finishes_at - now);
            if (remMs <= 0) {
                return `✅ **Tungku #${q.slot_number}:** ${q.portions}× ${recLabel} — **MATANG & SIAP DIAMBIL!**`;
            }
            return `🔥 **Tungku #${q.slot_number}:** ${q.portions}× ${recLabel} — Matang dalam **${formatDuration(Math.ceil(remMs / 1000))}**`;
        });
        queueBlock = lines.join('\n');
    }

    const hasFinished = queues.some(q => q.finishes_at <= now);
    const actionRows = [];
    if (queues.length > 0) {
        actionRows.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('cook_quick_collect')
                    .setLabel('Ambil Masakan Matang')
                    .setEmoji('🍽️')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(!hasFinished)
            )
        );
    }

    const blocks = [];
    if (extraNotice) blocks.push(extraNotice);
    blocks.push(headerLines.join('\n'));
    blocks.push(queueBlock);

    return buildV2Card({
        accentColor: COLORS.PRIMARY,
        title: '🍳 Dapur & Tungku Masak (/cook)',
        blocks,
        actionRows
    });
}

async function handleCookQuickCollect(interaction) {
    const now = Date.now();
    const discordId = interaction.user.id;

    const payload = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const player = synced.player;

        const res = await collectFinishedCooking(conn, player, now, synced.buffs);
        if (!res.ok) {
            const msg = res.error === 'BAG_FULL'
                ? `⚠️ Tasmu penuh (**${res.usedSlots}/${res.maxSlots} slot**)! Kosongkan tas atau pindahkan barang ke \`/storage\` terlebih dahulu.`
                : `⚠️ Belum ada masakan yang matang saat ini. Tunggu beberapa saat lagi!`;
            return buildV2Card({
                accentColor: COLORS.WARNING,
                title: '🍽️ Belum Bisa Mengambil Masakan',
                blocks: [msg],
                ephemeral: true
            });
        }

        const dishSummary = Object.entries(res.collectedDishes)
            .map(([id, qty]) => {
                const it = getItem(id);
                return `${qty}× ${it ? `${it.emoji} ${it.name}` : id}`;
            })
            .join(', ');
        const lvMsg = res.leveledUp ? ` 🎉 **Naik ke Cooking Lv. ${res.newLevel}!**` : '';
        const notice = `🍽️ **Masakan Diambil!** Menerima **${dishSummary}** (+**${res.totalXpGained} EXP**).${lvMsg}`;

        return await buildCookStatusPayload(conn, player, now, notice);
    });

    if (payload.flags && payload.ephemeral) {
        return await interaction.reply(payload);
    }
    return await interaction.update(payload);
}

module.exports = {
    name: 'cook',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('cook')
        .setDescription('Masak hasil tani dan tangkapan ikan di dapur propertimu')
        .addSubcommand(sub =>
            sub.setName('recipes')
                .setDescription('Lihat daftar buku resep masakan rumahan, bahan, dan efeknya')
        )
        .addSubcommand(sub =>
            sub.setName('start')
                .setDescription('Mulai memasak resep pilihan di tungku kompor propertimu')
                .addStringOption(opt =>
                    opt.setName('resep')
                        .setDescription('Pilih resep masakan yang ingin dimasak')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
                .addIntegerOption(opt =>
                    opt.setName('porsi')
                        .setDescription('Jumlah porsi dalam 1 tungku (1-5 porsi, hemat bahan bakar)')
                        .setMinValue(1)
                        .setMaxValue(5)
                )
                .addStringOption(opt =>
                    opt.setName('bahan_bakar')
                        .setDescription('Pilih prioritas bahan bakar kompor (default: Otomatis)')
                        .addChoices(
                            { name: '⚡ Otomatis (Muatan LPG -> Tabung Gas -> Batu Bara)', value: 'auto' },
                            { name: '🟢 Gas LPG 3kg', value: 'lpg' },
                            { name: '🪨 Batu Bara', value: 'batubara' }
                        )
                )
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('Pantau progres tungku kompor dan sisa muatan gas LPG')
        )
        .addSubcommand(sub =>
            sub.setName('collect')
                .setDescription('Ambil semua hidangan yang sudah matang dari tungku kompor ke tas')
        ),

    async autocomplete(interaction) {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        try {
            const choices = [];
            for (const rec of Object.values(RECIPES)) {
                const ingText = formatIngredientsList(rec, 1);
                const label = `${rec.emoji} ${rec.name} (Lv.${rec.minLevel} · ${rec.cookTimeSec}d) — ${ingText}`;
                if (focused && !label.toLowerCase().includes(focused) && !rec.id.includes(focused)) continue;
                choices.push({
                    name: label.slice(0, 100),
                    value: rec.id
                });
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

            if (sub === 'recipes') {
                const cookingInfo = getLevelInfoFromXp(player.cooking_xp || 0);
                const perfectPct = Math.round(getPerfectCookChance(cookingInfo.level) * 100);

                const tiers = [
                    { title: '🥣 **Resep Pemula (Lv. 1–2)**', list: Object.values(RECIPES).filter(r => r.minLevel <= 2) },
                    { title: '🍛 **Resep Menengah (Lv. 3–6)**', list: Object.values(RECIPES).filter(r => r.minLevel >= 3 && r.minLevel <= 6) },
                    { title: '👑 **Resep Chef Ahli (Lv. 7–10)**', list: Object.values(RECIPES).filter(r => r.minLevel >= 7) }
                ];

                const blocks = [
                    `👨‍🍳 **Cooking Lv. ${cookingInfo.level}** (${cookingInfo.currentXp}/${cookingInfo.requiredXp} EXP) · 🌟 Peluang Masakan Sempurna: **${perfectPct}%**\n💡 *Memasak 1–5 porsi sekaligus hanya membutuhkan **⚡3 Energy** & **1 Bahan Bakar** (1× Batu Bara atau 1× Muatan LPG).*`
                ];

                for (const t of tiers) {
                    const lines = t.list.map(r => {
                        const unlocked = cookingInfo.level >= r.minLevel ? '✅' : `🔒 Lv.${r.minLevel}`;
                        const resultItem = getItem(r.resultItemId);
                        const effParts = [];
                        if (resultItem?.effects?.hunger) effParts.push(`🍔+${resultItem.effects.hunger}`);
                        if (resultItem?.effects?.thirst) effParts.push(`💧+${resultItem.effects.thirst}`);
                        if (resultItem?.effects?.energy) effParts.push(`⚡+${resultItem.effects.energy}`);
                        if (resultItem?.effects?.health) effParts.push(`❤️+${resultItem.effects.health}`);
                        if (resultItem?.buff) effParts.push(`✨${resultItem.buff.label}`);

                        return `${unlocked} ${r.emoji} **${r.name}** (\`${r.id}\`) · ⏱️ ${r.cookTimeSec}d/porsi · 💰 Jual: **${formatLp(resultItem?.sellPrice || 0)}**\n   └ Bahan: ${formatIngredientsList(r, 1)} · Efek: ${effParts.join(' ')}`;
                    });
                    blocks.push(`${t.title}\n${lines.join('\n')}`);
                }

                return buildV2Card({
                    accentColor: COLORS.PRIMARY,
                    title: '📖 Buku Resep Masakan Rumahan (/cook recipes)',
                    blocks
                });
            }

            if (sub === 'status') {
                return await buildCookStatusPayload(conn, player, now);
            }

            if (sub === 'start') {
                const resep = interaction.options.getString('resep', true);
                const porsi = interaction.options.getInteger('porsi') || 1;
                const bahanBakar = interaction.options.getString('bahan_bakar') || 'auto';

                const res = await startCookingBatch(conn, player, resep, porsi, bahanBakar, now);
                if (!res.ok) {
                    let msg = 'Tidak dapat memulai memasak.';
                    if (res.error === 'INVALID_RECIPE') msg = 'Resep tidak ditemukan. Cek daftar resep di `/cook recipes`.';
                    else if (res.error === 'LEVEL_TOO_LOW') msg = `Memasak **${res.recipe.emoji} ${res.recipe.name}** membutuhkan **Cooking Lv. ${res.requiredLevel}** (Levelmu saat ini: **Lv. ${res.currentLevel}**).`;
                    else if (res.error === 'NO_STOVE') msg = 'Kamu belum memiliki tungku kompor aktif! Sewa minimal **🏠 Kos-kosan Sederhana** lewat `/property rent`.';
                    else if (res.error === 'STOVE_FULL') msg = `Seluruh **${res.stoveSlots} tungku kompor** di propertimu sedang dipakai! Gunakan \`/cook status\` atau \`/cook collect\` terlebih dahulu.`;
                    else if (res.error === 'INSUFFICIENT_ENERGY') msg = `Energimu tidak cukup! Butuh **⚡${res.requiredEnergy} Energy** untuk memasak.`;
                    else if (res.error === 'MISSING_INGREDIENTS') {
                        const missList = res.missing.map(m => `• Kurang **${m.shortage}× ${m.label}**`).join('\n');
                        msg = `Bahan di dalam **Tas (Bag)** belum lengkap untuk memasak **${res.portions} porsi ${res.recipe.emoji} ${res.recipe.name}**:\n${missList}\n\n*(Jika bahan ada di Kulkas/Freezer/Gudang, ambil dulu lewat \`/storage withdraw\`)*`;
                    } else if (res.error === 'NO_FUEL') {
                        msg = 'Kamu tidak memiliki bahan bakar kompor! Siapkan **🟢 Tabung Gas LPG 3kg** (beli di `/shop` Toko Tani) atau **🪨 Batu Bara** (hasil `/mining`) di tasmu.';
                    }

                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🍳 Gagal Memulai Memasak',
                        blocks: [msg],
                        ephemeral: true
                    });
                }

                const usedIngText = Object.entries(res.consumedIngredients)
                    .map(([id, qty]) => {
                        const it = getItem(id);
                        return `${qty}× ${it ? `${it.emoji} ${it.name}` : id}`;
                    })
                    .join(', ');

                const notice = [
                    `🔥 **Mulai Memasak di Tungku #${res.slotNumber}!**`,
                    `🍲 **Hidangan:** **${res.portions}× ${res.recipe.emoji} ${res.recipe.name}** (Selesai dalam **${formatDuration(Math.ceil(res.totalDurationMs / 1000))}**)`,
                    `🧺 **Bahan Terpakai:** ${usedIngText}`,
                    `⛽ **Bahan Bakar:** ${res.fuelUsedLabel} · ⚡ **-${res.energyCost} Energy**`
                ].join('\n');

                return await buildCookStatusPayload(conn, player, now, notice);
            }

            if (sub === 'collect') {
                const res = await collectFinishedCooking(conn, player, now, synced.buffs);
                if (!res.ok) {
                    let msg = 'Belum ada masakan di tungku kompor.';
                    if (res.error === 'NO_QUEUES') msg = 'Tidak ada masakan yang sedang dimasak di tungku kompormu.';
                    else if (res.error === 'NONE_FINISHED') msg = 'Masakanmu masih dalam proses memasak! Cek sisa waktunya di `/cook status`.';
                    else if (res.error === 'BAG_FULL') msg = `Tasmu penuh (**${res.usedSlots}/${res.maxSlots} slot**)! Kosongkan tas atau simpan barang ke \`/storage\` terlebih dahulu.`;

                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🍽️ Belum Bisa Mengambil Masakan',
                        blocks: [msg],
                        ephemeral: true
                    });
                }

                const dishSummary = Object.entries(res.collectedDishes)
                    .map(([id, qty]) => {
                        const it = getItem(id);
                        return `${qty}× ${it ? `${it.emoji} ${it.name}` : id}`;
                    })
                    .join(', ');
                const lvMsg = res.leveledUp ? ` 🎉 **Naik ke Cooking Lv. ${res.newLevel}!**` : '';
                const notice = `🍽️ **Masakan Matang Diambil!** Kamu memperoleh **${dishSummary}** (+**${res.totalXpGained} EXP**).${lvMsg}`;

                return await buildCookStatusPayload(conn, player, now, notice);
            }
        });

        return await interaction.reply(responsePayload);
    },

    handleCookQuickCollect
};
