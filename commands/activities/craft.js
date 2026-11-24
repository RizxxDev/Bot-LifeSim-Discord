const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonStyle
} = require('discord.js');
const {
    CRAFT_RECIPES,
    resolveCraftIngredientsFromBag,
    fetchCraftState,
    executeCraftRecipe,
    executeUseRepairKit
} = require('../../services/craftService');
const { getCraftRecipe } = require('../../data/crafting');
const { getItem } = require('../../data/items');
const { COLORS } = require('../../utils/uiBuilder');
const { buildPanel, btn, select } = require('../../utils/panelBuilder');
const { calculateSlotsUsed, getDamagedTools } = require('../../services/inventoryService');

function formatIngredientStatus(invRows, recipe) {
    const check = resolveCraftIngredientsFromBag(invRows, recipe, 1);
    return check.requiredList
        .map(req => {
            const it = getItem(req.itemId);
            const name = it ? `${it.emoji} ${it.name}` : req.itemId;
            const mark = req.owned >= req.needed ? '✅' : '❌';
            return `${mark} ${name}: \`${req.owned}/${req.needed}\``;
        })
        .join(' · ');
}

function buildCraftPanel({
    state,
    tab = 'craft',
    selectedRecipeId = null,
    selectedToolRowId = null,
    banner = null,
    now = Date.now()
}) {
    const { player: p, invRows } = state;
    const ownerId = p.discord_id;
    const slotsUsed = state.slotsUsed ?? calculateSlotsUsed(invRows);
    const damagedTools = state.damagedTools ?? getDamagedTools(invRows);
    const repairKitCount = state.repairKitCount ?? invRows
        .filter(r => r.item_id === 'kit_perbaikan_ringan')
        .reduce((acc, r) => acc + Number(r.quantity || 0), 0);

    const activeTab = tab === 'repair' ? 'repair' : 'craft';

    const tabRow = new ActionRowBuilder().addComponents(
        btn('craft', 'tab', ownerId, {
            label: 'Rakit Barang',
            emoji: '🛠️',
            style: activeTab === 'craft' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: 'craft'
        }, now),
        btn('craft', 'tab', ownerId, {
            label: `Pakai Kit Perbaikan (${repairKitCount})`,
            emoji: '🔧',
            style: activeTab === 'repair' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: 'repair'
        }, now)
    );

    if (activeTab === 'repair') {
        const blocks = [
            `🎒 **Slot Tas:** \`${slotsUsed}/${p.max_slots}\` · 🔧 **Kit Perbaikan Ringan:** \`×${repairKitCount}\` *(Pulihkan +25 Durability per kit)*`
        ];

        const activeTool = damagedTools.find(t => String(t.rowId) === String(selectedToolRowId)) || damagedTools[0] || null;
        if (damagedTools.length === 0) {
            blocks.push('✨ Semua alat kerja (Pancingan, Beliung, Kapak, Sekop, Helm) di tasmu dalam kondisi prima (100% Durability)!');
        } else {
            const listLines = damagedTools.slice(0, 8).map(t => {
                const ptr = activeTool && t.rowId === activeTool.rowId ? '▶️ ' : '• ';
                return `${ptr}${t.item.emoji} **${t.item.name}** — Durability \`${t.currentDurability}/${t.maxDurability}\``;
            });
            blocks.push(listLines.join('\n'));
        }

        const rows = [tabRow];
        if (damagedTools.length > 0) {
            rows.push(
                select('craft', 'pick_tool', ownerId, {
                    placeholder: '🔧 Pilih alat yang akan ditambal (+25 Dur)...',
                    options: damagedTools.slice(0, 25).map(t => ({
                        label: `${t.item.name} (${t.currentDurability}/${t.maxDurability})`.slice(0, 100),
                        value: String(t.rowId),
                        emoji: t.item.emoji,
                        default: activeTool && t.rowId === activeTool.rowId
                    }))
                }, now)
            );
            rows.push(
                new ActionRowBuilder().addComponents(
                    btn('craft', 'use_kit', ownerId, {
                        label: 'Tambal Alat (+25 Durability)',
                        emoji: '🔧',
                        style: ButtonStyle.Success,
                        arg: activeTool ? String(activeTool.rowId) : 'none',
                        disabled: repairKitCount <= 0 || !activeTool
                    }, now)
                )
            );
        }

        return buildPanel({
            mod: 'craft',
            ownerId,
            accentColor: COLORS.ACT,
            title: '🔧 Meja Perbaikan Ringan (/craft)',
            player: p,
            banner,
            blocks,
            rows,
            footer: 'Kit Perbaikan Ringan dapat dirakit dari Besi Tua & Kayu Gelondongan pada tab Rakit Barang.',
            now
        });
    }

    const activeRecipe = getCraftRecipe(selectedRecipeId) || CRAFT_RECIPES[0];
    const outItem = getItem(activeRecipe.outputItemId);
    const check1 = resolveCraftIngredientsFromBag(invRows, activeRecipe, 1);
    const check3 = resolveCraftIngredientsFromBag(invRows, activeRecipe, 3);
    const canCraft1 = check1.ok && Number(p.energy) >= activeRecipe.energyCost;
    const canCraft3 = check3.ok && Number(p.energy) >= activeRecipe.energyCost * 3;

    const recipeListLines = CRAFT_RECIPES.map(r => {
        const ptr = r.id === activeRecipe.id ? '▶️ ' : '• ';
        const ready = resolveCraftIngredientsFromBag(invRows, r, 1).ok ? '✅' : '▫️';
        return `${ptr}${ready} ${r.emoji} **${r.name}** → \`${r.outputQty}×\` (${formatIngredientStatus(invRows, r)})`;
    });

    const blocks = [
        `Meja daur ulang bebas kota: olah rongsokan \`/bin\` & hasil alam menjadi umpan pancing spesial, P3K, kompos, & kit perbaikan.\n🎒 **Kapasitas Tas:** \`${slotsUsed}/${p.max_slots} slot\``,
        recipeListLines.join('\n'),
        `🔍 **Detail Resep Aktif:** ${outItem ? `${outItem.emoji} **${outItem.name}**` : activeRecipe.name} *(×${activeRecipe.outputQty}/rakit · ⚡ ${activeRecipe.energyCost} Energy)*\n-# ${activeRecipe.description}`
    ];

    const selectRow = select('craft', 'pick_recipe', ownerId, {
        placeholder: '🛠️ Pilih Resep Prakarya...',
        options: CRAFT_RECIPES.map(r => ({
            label: `${r.name} (→ ${r.outputQty}×)`.slice(0, 100),
            value: r.id,
            emoji: r.emoji,
            description: r.description.slice(0, 100),
            default: r.id === activeRecipe.id
        }))
    }, now);

    const execRow = new ActionRowBuilder().addComponents(
        btn('craft', 'exec', ownerId, {
            label: `Rakit ×1 (⚡${activeRecipe.energyCost})`,
            emoji: '🔨',
            style: ButtonStyle.Success,
            arg: `${activeRecipe.id}:1`,
            disabled: !canCraft1
        }, now),
        btn('craft', 'exec', ownerId, {
            label: `Rakit ×3 (⚡${activeRecipe.energyCost * 3})`,
            emoji: '⚒️',
            style: ButtonStyle.Primary,
            arg: `${activeRecipe.id}:3`,
            disabled: !canCraft3
        }, now)
    );

    return buildPanel({
        mod: 'craft',
        ownerId,
        accentColor: COLORS.ACT,
        title: '♻️ Meja Daur Ulang & Prakarya (/craft)',
        player: p,
        banner,
        blocks,
        rows: [tabRow, selectRow, execRow],
        footer: 'Gunakan /bin untuk mencari rongsokan dan /fishing untuk memakai umpan hasil rakitan.',
        now
    });
}

function formatCraftBanner(res) {
    if (!res.ok) {
        if (res.error === 'NOT_ELIGIBLE') return { type: 'warning', text: res.message };
        if (res.error === 'MISSING_INGREDIENTS') {
            const lackText = (res.missing || [])
                .map(m => {
                    const it = getItem(m.itemId);
                    return `${it ? `${it.emoji} ${it.name}` : m.itemId} (${m.owned}/${m.needed})`;
                })
                .join(', ');
            return { type: 'warning', text: `Bahan kurang: **${lackText}**.` };
        }
        if (res.error === 'BAG_FULL') {
            return { type: 'warning', text: `Tas penuh (${res.slotsAfter}/${res.maxSlots} slot)! Kosongkan sebagian ruang sebelum merakit.` };
        }
        if (res.error === 'NO_REPAIR_KIT') {
            return { type: 'warning', text: 'Kamu tidak punya **🔧 Kit Perbaikan Ringan** di tas. Rakit terlebih dahulu di tab **Rakit Barang**.' };
        }
        if (res.error === 'TOOL_ALREADY_FULL') {
            return { type: 'info', text: `${res.toolItem.emoji} **${res.toolItem.name}** sudah berada pada Durability maksimal.` };
        }
        return { type: 'danger', text: 'Gagal memproses perakitan.' };
    }

    if (res.toolItem) {
        return {
            type: 'success',
            text: `Berhasil menambal ${res.toolItem.emoji} **${res.toolItem.name}** (**+${res.restored} Durability**, kini \`${res.afterDur}/${res.maxDurability}\`)!`
        };
    }

    return {
        type: 'success',
        text: `Berhasil merakit **${res.outputQty}× ${res.outputItem ? `${res.outputItem.emoji} ${res.outputItem.name}` : res.recipe.name}** *(⚡ -${res.energyCost} Energy)*!`
    };
}

module.exports = {
    name: 'craft',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('craft')
        .setDescription('Daur ulang rongsokan & hasil alam jadi umpan pancing spesial, P3K, kompos, & kit alat.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchCraftState(interaction.user.id, now);
        return await interaction.reply(buildCraftPanel({ state, now }));
    },

    panel: {
        buttons: {
            async tab(interaction, parsed) {
                const now = Date.now();
                const tab = parsed.arg === 'repair' ? 'repair' : 'craft';
                const state = await fetchCraftState(interaction.user.id, now);
                return await interaction.update({
                    ...buildCraftPanel({ state, tab, now }),
                    attachments: []
                });
            },
            async exec(interaction, parsed) {
                const now = Date.now();
                const [recipeId = '', rawBatch = '1'] = (parsed.arg || '').split(':');
                const res = await executeCraftRecipe(interaction.user.id, recipeId, Number(rawBatch) || 1, now);
                const state = res.player
                    ? {
                        player: res.player,
                        invRows: res.invRows,
                        slotsUsed: calculateSlotsUsed(res.invRows),
                        damagedTools: getDamagedTools(res.invRows),
                        repairKitCount: res.invRows.filter(r => r.item_id === 'kit_perbaikan_ringan').reduce((a, r) => a + Number(r.quantity || 0), 0)
                    }
                    : await fetchCraftState(interaction.user.id, now);
                return await interaction.update({
                    ...buildCraftPanel({
                        state,
                        tab: 'craft',
                        selectedRecipeId: recipeId,
                        banner: formatCraftBanner(res),
                        now
                    }),
                    attachments: []
                });
            },
            async use_kit(interaction, parsed) {
                const now = Date.now();
                const toolRowId = parsed.arg || '';
                const res = await executeUseRepairKit(interaction.user.id, toolRowId, now);
                const state = await fetchCraftState(interaction.user.id, now);
                return await interaction.update({
                    ...buildCraftPanel({
                        state,
                        tab: 'repair',
                        selectedToolRowId: toolRowId,
                        banner: formatCraftBanner(res),
                        now
                    }),
                    attachments: []
                });
            }
        },
        selects: {
            async pick_recipe(interaction) {
                const now = Date.now();
                const recipeId = interaction.values[0] || '';
                const state = await fetchCraftState(interaction.user.id, now);
                return await interaction.update({
                    ...buildCraftPanel({ state, tab: 'craft', selectedRecipeId: recipeId, now }),
                    attachments: []
                });
            },
            async pick_tool(interaction) {
                const now = Date.now();
                const toolRowId = interaction.values[0] || '';
                const state = await fetchCraftState(interaction.user.id, now);
                return await interaction.update({
                    ...buildCraftPanel({ state, tab: 'repair', selectedToolRowId: toolRowId, now }),
                    attachments: []
                });
            }
        }
    },

    buildCraftPanel,
    fetchCraftState
};
