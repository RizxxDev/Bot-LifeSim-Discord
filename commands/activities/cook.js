const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonStyle
} = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerPropertyStatus } = require('../../services/propertyService');
const { getPlayerInventory } = require('../../services/inventoryService');
const {
    getActiveCookingQueues,
    resolveEffectiveStoveInfo,
    startCookingBatch,
    collectFinishedCooking,
    resolveRecipeIngredientsFromBag
} = require('../../services/cookService');
const {
    RECIPES,
    getRecipe,
    getPerfectCookChance
} = require('../../data/recipes');
const { getItem } = require('../../data/items');
const { getCity } = require('../../data/cities');
const { getLevelInfoFromXp } = require('../../data/locations');
const {
    COLORS,
    formatLp,
    formatDuration
} = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select
} = require('../../utils/panelBuilder');
const { scheduleAutoUpdate, cancelAutoUpdate } = require('../../services/autoUpdateService');

function scheduleCookAutoUpdate(userId, interaction, state, selectedRecipeId = null) {
    const now = Date.now();
    const pending = (state.queues || [])
        .map(q => Number(q.finishes_at || 0))
        .filter(fin => fin > now);
    if (pending.length === 0) {
        cancelAutoUpdate(`cook:${userId}`);
        return;
    }
    const nextFinishAt = Math.min(...pending);
    const delayMs = Math.max(500, (nextFinishAt - now) + 500);
    scheduleAutoUpdate(`cook:${userId}`, interaction, delayMs, async () => {
        const readyNow = Date.now();
        const freshState = await fetchCookState(userId, readyNow);
        scheduleCookAutoUpdate(userId, interaction, freshState, selectedRecipeId);
        return buildCookPanel({
            state: freshState,
            mode: 'kitchen',
            selectedRecipeId,
            banner: {
                type: 'success',
                text: '🍽️ **Masakan di tungku sudah matang!** Klik tombol **🍽️ Ambil Matang** untuk memindahkan ke tasmu.'
            },
            now: readyNow
        });
    });
}

function formatIngredientsList(recipe, portions = 1) {
    return recipe.ingredients
        .map(ing => {
            const totalQty = ing.qty * portions;
            if (ing.type === 'item') {
                const it = getItem(ing.itemId);
                return `${totalQty}× ${it ? `${it.emoji} ${it.name}` : ing.itemId}`;
            }
            const cleanLabel = String(ing.label || '').replace(/^\d+[x×]\s*/i, '');
            return `${totalQty}× ${cleanLabel}`;
        })
        .join(' + ');
}

async function fetchCookState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const p = synced.player;
        const propStatus = await getPlayerPropertyStatus(conn, discordId, p.max_slots, now, false, p.current_city || 'kota_sentral');
        const queues = await getActiveCookingQueues(conn, discordId, false);
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);

        const gasInBag = invRows.filter(r => r.item_id === 'gas_lpg').reduce((a, r) => a + Number(r.quantity), 0);
        const coalInBag = invRows.filter(r => r.item_id === 'batubara').reduce((a, r) => a + Number(r.quantity), 0);

        return {
            player: p,
            buffs: synced.buffs,
            propStatus,
            queues,
            invRows,
            gasInBag,
            coalInBag
        };
    });
}

function buildCookPanel({
    state,
    mode = 'kitchen',
    selectedRecipeId = null,
    banner = null,
    now = Date.now()
}) {
    const { player: p, propStatus, queues, invRows, gasInBag, coalInBag } = state;
    const ownerId = p.discord_id;
    const { stoveSlots, usingPublicStove } = resolveEffectiveStoveInfo(propStatus);
    const cookingInfo = getLevelInfoFromXp(p.cooking_xp || 0);
    const perfectPct = Math.round(getPerfectCookChance(cookingInfo.level) * 100);

    const allRecipes = Object.values(RECIPES);
    let activeRecipe = allRecipes.find(r => r.id === selectedRecipeId);
    if (!activeRecipe) {
        activeRecipe = allRecipes.find(r => cookingInfo.level >= r.minLevel && resolveRecipeIngredientsFromBag(invRows, r, 1).ok) || allRecipes[0];
    }

    const curCity = getCity(propStatus.propertyCityId || p.current_city || 'kota_sentral');
    const kitchenTitle = propStatus.customName || propStatus.effectiveTier.name;
    const kitchenFurns = (propStatus.stats?.furnitureDetails || []).filter(d => Number(d.spec?.effects?.cookingSlots || 0) > 0);
    const kitchenFurnLine = kitchenFurns.length > 0
        ? `🍳 **Perabot Dapur:** ${kitchenFurns.slice(0, 3).map(d => `${d.spec.emoji} **${d.spec.name}**${d.room ? ` *(${d.room.customName})*` : ''}${d.isOutdoorPenalty ? ' *(⚠️ Outdoor -50%)*' : ''}`).join(', ')}`
        : null;
    const kitchenLocationLine = usingPublicStove
        ? `🍲 **Dapur Umum (${curCity.emoji} ${curCity.shortName}):** Tungku Publik Sementara · 🔥 Tungku: **${queues.length}/${stoveSlots} Slot**`
        : `🏠 **Dapur Lokal (${curCity.emoji} ${curCity.shortName}):** ${propStatus.effectiveTier.emoji} **${kitchenTitle}** · 🔥 Tungku: **${queues.length}/${stoveSlots} Slot**`;
    const headerLines = [
        `👨‍🍳 **Cooking Lv. ${cookingInfo.level}** (\`${cookingInfo.currentXp}/${cookingInfo.requiredXp} EXP\`) · 🌟 Peluang Masakan Sempurna: **${perfectPct}%**`,
        kitchenLocationLine,
        kitchenFurnLine,
        `⛽ **Bahan Bakar:** **${Number(p.lpg_charges || 0)}x muatan LPG** *(Tas: ${gasInBag}× Tabung LPG · ${coalInBag}× Batu Bara)*`
    ].filter(Boolean);

    const blocks = [headerLines.join('\n')];
    const rows = [];

    if (mode === 'recipes') {
        const tiers = [
            { title: '🥣 **Resep Pemula (Lv. 1–10)**', list: allRecipes.filter(r => r.minLevel <= 10) },
            { title: '🍛 **Resep Menengah (Lv. 12–25)**', list: allRecipes.filter(r => r.minLevel >= 12 && r.minLevel <= 25) },
            { title: '👑 **Resep Chef Ahli (Lv. 30–45)**', list: allRecipes.filter(r => r.minLevel >= 30) }
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
                return `${unlocked} ${r.emoji} **${r.name}** · ⏱️ ${r.cookMinutes}m · 💰 ${formatLp(resultItem?.sellPrice || 0)}\n   └ Bahan: ${formatIngredientsList(r, 1)} · Efek: ${effParts.join(' ')}`;
            });
            blocks.push(`${t.title}\n${lines.join('\n')}`);
        }

        rows.push(
            new ActionRowBuilder().addComponents(
                btn('cook', 'home', ownerId, {
                    label: 'Kembali ke Dapur',
                    emoji: '⬅️',
                    style: ButtonStyle.Secondary
                }, now)
            )
        );
    } else {
        // Status Tungku
        if (!usingPublicStove && propStatus.facilitiesLocked) {
            const condLabel = propStatus.conditionMeta?.label || 'Terbengkalai/Roboh';
            blocks.push(`🔒 **Dapur Terkunci (${condLabel}):** Bangunan lokalmu butuh perbaikan terlebih dahulu! Buka \`/property\` untuk **Renovasi Berat** / **Bersihkan Puing**, atau sewa Kos NPC sementara.`);
        } else if (stoveSlots <= 0) {
            blocks.push('⚠️ **Belum Punya Dapur Aktif di Kota Ini:** Bangun modul **Dapur** di `/bangun` atau sewa minimal **🛏️ Kamar Kos Sederhana** lewat `/property`.');
        } else if (queues.length === 0) {
            blocks.push(
                usingPublicStove
                    ? '🍲 **Status Tungku (Dapur Umum Kota):** 1 tungku publik tersedia gratis selama fitur `/property` & `/bangun` dalam pengembangan.'
                    : '🍳 **Status Tungku:** Seluruh tungku kompor sedang kosong dan siap digunakan.'
            );
        } else {
            const qLines = queues.map(q => {
                const rec = getRecipe(q.recipe_id);
                const recLabel = rec ? `${rec.emoji} **${rec.name}**` : q.recipe_id;
                const remMs = Math.max(0, q.finishes_at - now);
                if (remMs <= 0) {
                    return `✅ **Tungku #${q.slot_number}:** ${q.portions}× ${recLabel} — **MATANG & SIAP DIAMBIL!**`;
                }
                const finishUnix = Math.floor(q.finishes_at / 1000);
                return `🔥 **Tungku #${q.slot_number}:** ${q.portions}× ${recLabel} — Matang <t:${finishUnix}:R> (${formatDuration(remMs)})`;
            });
            blocks.push(`**🔥 Antrean Tungku Kompor:**\n${qLines.join('\n')}`);
        }

        // Detail Resep Terpilih
        if (activeRecipe) {
            const resItem = getItem(activeRecipe.resultItemId);
            const check1 = resolveRecipeIngredientsFromBag(invRows, activeRecipe, 1);
            const effParts = [];
            if (resItem?.effects?.hunger) effParts.push(`🍔+${resItem.effects.hunger}`);
            if (resItem?.effects?.thirst) effParts.push(`💧+${resItem.effects.thirst}`);
            if (resItem?.effects?.energy) effParts.push(`⚡+${resItem.effects.energy}`);
            if (resItem?.effects?.health) effParts.push(`❤️+${resItem.effects.health}`);
            if (resItem?.buff) effParts.push(`✨${resItem.buff.label}`);

            blocks.push(
                [
                    `🍲 **Resep Terpilih: ${activeRecipe.emoji} ${activeRecipe.name} (Syarat Lv. ${activeRecipe.minLevel})**`,
                    `• 🧺 Bahan / Porsi: ${formatIngredientsList(activeRecipe, 1)}`,
                    `• 📈 Efek Hidangan: ${effParts.join(' · ')} · 💰 Jual: **${formatLp(resItem?.sellPrice || 0)}**`,
                    check1.ok
                        ? `• ✅ **Bahan di Tas Siap!** Klik tombol masak di bawah (1–5 porsi hanya makan 1 bahan bakar & ⚡3 Energy).`
                        : `• ⚠️ **Bahan Kurang di Tas:** ${check1.missing.map(m => `${m.shortage}× ${m.label}`).join(', ')}`
                ].join('\n')
            );
        }

        // Row 1: Pilih Resep
        rows.push(
            select('cook', 'recipe', ownerId, {
                placeholder: '🍲 Pilih resep masakan...',
                options: allRecipes.map(r => {
                    const unlocked = cookingInfo.level >= r.minLevel;
                    const ingOk = resolveRecipeIngredientsFromBag(invRows, r, 1).ok;
                    return {
                        label: `${r.name} (Lv.${r.minLevel}+ · ${r.cookMinutes}m)`,
                        value: r.id,
                        emoji: !unlocked ? '🔒' : ingOk ? r.emoji : '🧺',
                        description: `Bahan: ${formatIngredientsList(r, 1)}`.slice(0, 95),
                        default: activeRecipe && r.id === activeRecipe.id
                    };
                })
            }, now)
        );

        const hasStoveSpace = stoveSlots > 0 && queues.length < stoveSlots;
        const hasFuel = Number(p.lpg_charges || 0) > 0 || gasInBag > 0 || coalInBag > 0;
        const canCookBase = Boolean(
            activeRecipe &&
            cookingInfo.level >= activeRecipe.minLevel &&
            hasStoveSpace &&
            hasFuel &&
            Number(p.energy) >= 3
        );

        const can1 = canCookBase && resolveRecipeIngredientsFromBag(invRows, activeRecipe, 1).ok;
        const can3 = canCookBase && resolveRecipeIngredientsFromBag(invRows, activeRecipe, 3).ok;
        const can5 = canCookBase && resolveRecipeIngredientsFromBag(invRows, activeRecipe, 5).ok;
        const hasFinished = queues.some(q => q.finishes_at <= now);

        // Row 2: Tombol Masak & Ambil
        rows.push(
            new ActionRowBuilder().addComponents(
                btn('cook', 'start', ownerId, {
                    label: 'Masak ×1',
                    emoji: '🔥',
                    style: ButtonStyle.Primary,
                    arg: `${activeRecipe.id}:1`,
                    disabled: !can1
                }, now),
                btn('cook', 'start', ownerId, {
                    label: 'Masak ×3',
                    emoji: '🔥',
                    style: ButtonStyle.Secondary,
                    arg: `${activeRecipe.id}:3`,
                    disabled: !can3
                }, now),
                btn('cook', 'start', ownerId, {
                    label: 'Masak ×5',
                    emoji: '🔥',
                    style: ButtonStyle.Secondary,
                    arg: `${activeRecipe.id}:5`,
                    disabled: !can5
                }, now),
                btn('cook', 'collect', ownerId, {
                    label: 'Ambil Matang',
                    emoji: '🍽️',
                    style: ButtonStyle.Success,
                    disabled: !hasFinished
                }, now),
                btn('cook', 'book', ownerId, {
                    label: 'Buku Resep',
                    emoji: '📖',
                    style: ButtonStyle.Secondary
                }, now)
            )
        );
    }

    return buildPanel({
        mod: 'cook',
        ownerId,
        accentColor: COLORS.PRIMARY,
        title: `🍳 Dapur & Tungku Masak`,
        player: p,
        banner,
        blocks,
        rows,
        footer: 'Hidangan rumahan dapat dimakan di /consume atau dijual di /sell.',
        now
    });
}

async function handleCookQuickCollect(interaction) {
    const now = Date.now();
    const userId = interaction.user.id;
    let banner = null;

    await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, userId, now, true);
        const res = await collectFinishedCooking(conn, synced.player, now, synced.buffs);
        if (res.ok) {
            const dishSummary = Object.entries(res.collectedDishes)
                .map(([id, qty]) => {
                    const it = getItem(id);
                    return `${qty}× ${it ? `${it.emoji} ${it.name}` : id}`;
                })
                .join(', ');
            const lvMsg = res.leveledUp ? ` 🎉 **Naik ke Cooking Lv. ${res.newLevel}!**` : '';
            banner = {
                type: 'success',
                text: `🍽️ Masakan matang diambil: **${dishSummary}** (+${res.totalXpGained} EXP)!${lvMsg}`
            };
        } else {
            banner = {
                type: 'warning',
                text: res.error === 'BAG_FULL'
                    ? 'Tasmu penuh! Kosongkan ruang di tas atau pindahkan barang ke `/storage`.'
                    : 'Belum ada masakan yang matang saat ini.'
            };
        }
    });

    const state = await fetchCookState(userId, now);
    const res = await interaction.update(buildCookPanel({ state, mode: 'kitchen', banner, now }));
    scheduleCookAutoUpdate(userId, interaction, state);
    return res;
}

module.exports = {
    name: 'cook',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('cook')
        .setDescription('Buka dapur interaktif: pilih resep masakan rumahan, nyalakan tungku, dan ambil hidangan matang.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchCookState(interaction.user.id, now);
        const res = await interaction.reply(buildCookPanel({ state, mode: 'kitchen', now }));
        scheduleCookAutoUpdate(interaction.user.id, interaction, state);
        return res;
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchCookState(interaction.user.id, now);
                const res = await interaction.update(buildCookPanel({ state, mode: 'kitchen', now }));
                scheduleCookAutoUpdate(interaction.user.id, interaction, state);
                return res;
            },
            async book(interaction) {
                const now = Date.now();
                const state = await fetchCookState(interaction.user.id, now);
                cancelAutoUpdate(`cook:${interaction.user.id}`);
                return await interaction.update(buildCookPanel({ state, mode: 'recipes', now }));
            },
            async start(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const [recipeId = 'nasi_putih', rawPortions = '1'] = (parsed.arg || '').split(':');
                const portions = Number(rawPortions) || 1;

                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await startCookingBatch(conn, synced.player, recipeId, portions, 'auto', now);
                });

                const state = await fetchCookState(userId, now);
                let banner = null;
                if (res.ok) {
                    banner = {
                        type: 'success',
                        text: `🔥 Mulai memasak **${res.portions}× ${res.recipe.emoji} ${res.recipe.name}** di Tungku #${res.slotNumber} (${res.fuelUsedLabel})!`
                    };
                } else {
                    banner = {
                        type: 'warning',
                        text: 'Gagal memasak: pastikan tungku kosong tersedia, bahan di tas cukup, dan ada bahan bakar LPG/Batu Bara.'
                    };
                }

                const out = await interaction.update(
                    buildCookPanel({
                        state,
                        mode: 'kitchen',
                        selectedRecipeId: recipeId,
                        banner,
                        now
                    })
                );
                scheduleCookAutoUpdate(userId, interaction, state, recipeId);
                return out;
            },
            async collect(interaction) {
                return await handleCookQuickCollect(interaction);
            }
        },
        selects: {
            async recipe(interaction) {
                const now = Date.now();
                const recipeId = interaction.values[0] || 'nasi_putih';
                const state = await fetchCookState(interaction.user.id, now);
                const out = await interaction.update(
                    buildCookPanel({
                        state,
                        mode: 'kitchen',
                        selectedRecipeId: recipeId,
                        now
                    })
                );
                scheduleCookAutoUpdate(interaction.user.id, interaction, state, recipeId);
                return out;
            }
        }
    },

    fetchCookState,
    buildCookPanel,
    handleCookQuickCollect
};
