const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { getCooldownRemaining, setCooldown, incrementDailyAction } = require('../../database/redis');
const { syncPlayerVitals, checkActivityEligibility, deductActivityVitals } = require('../../services/vitalService');
const {
    calculateSlotsUsed,
    getPlayerInventory,
    canFitItems,
    addItem,
    recordCollection
} = require('../../services/inventoryService');
const { executeQuickMeal } = require('../../services/consumptionService');
const { executeSellItems } = require('../../services/marketService');
const { awardEventActivityProgress } = require('../../services/eventService');
const { getItem } = require('../../data/items');
const { ACTIVITY_COSTS } = require('../../data/constants');
const { COLORS, formatLp, formatDuration } = require('../../utils/uiBuilder');
const { buildPanel, btn } = require('../../utils/panelBuilder');

/**
 * Tabel Loot Tempat Sampah Kota (/bin):
 * - Common (55%): Rongsokan daur ulang (Botol, Kaleng, Sandal, Kardus, Besi Tua)
 * - Uncommon (28%): Makanan, Minuman, Umpan Cacing, atau Bahan Basi untuk Kompos
 * - Rare (16%): Rongsokan elektronik bernilai tinggi (Radio Rusak, Bangkai HP)
 * - Jackpot (1%): Alat kerja bekas layak pakai (Pancingan Bambu / Beliung Batu)
 */
const BIN_LOOT_TABLE = [
    // Common — 55% total weight
    { itemId: 'sampah_botol',  minQty: 1, maxQty: 3, weight: 14, tierLabel: '⚪ Rongsokan Umum', flavor: 'Kamu mengaduk tumpukan plastik di sudut tong sampah dan menemukan botol bekas.' },
    { itemId: 'sampah_kaleng', minQty: 1, maxQty: 3, weight: 13, tierLabel: '⚪ Rongsokan Umum', flavor: 'Terdengar bunyi gemerincing logam saat kamu mengangkat kantong sampah.' },
    { itemId: 'sampah_sandal', minQty: 1, maxQty: 2, weight: 10, tierLabel: '⚪ Rongsokan Umum', flavor: 'Ada sandal karet putus yang masih laku ditimbang di Bank Sampah.' },
    { itemId: 'sampah_kardus', minQty: 1, maxQty: 2, weight: 11, tierLabel: '⚪ Rongsokan Umum', flavor: 'Kamu melipat tumpukan kardus kering di belakang minimarket.' },
    { itemId: 'sampah_besi',   minQty: 1, maxQty: 2, weight: 7,  tierLabel: '🟢 Rongsokan Logam', flavor: 'Lumayan berat! Kamu menemukan potongan besi tua yang dicari pengepul.' },

    // Uncommon — 28% total weight
    { itemId: 'roti',          minQty: 1, maxQty: 1, weight: 6,  tierLabel: '🟢 Makanan Layak Makan', flavor: 'Roti kemasan yang baru disortir dari rak toko, bungkusnya masih rapat!' },
    { itemId: 'air_mineral',   minQty: 1, maxQty: 1, weight: 6,  tierLabel: '🟢 Minuman Segel', flavor: 'Sebotol air mineral yang masih tersegel utuh di dekat bangku taman.' },
    { itemId: 'mie_instan',    minQty: 1, maxQty: 1, weight: 5,  tierLabel: '🟢 Makanan Kemasan', flavor: 'Bungkus mie instan yang sedikit penyok namun isinya masih aman dikonsumsi.' },
    { itemId: 'umpan_cacing',  minQty: 2, maxQty: 4, weight: 6,  tierLabel: '🟢 Bekal Memancing', flavor: 'Di balik tanah lembap bawah tong sampah, kamu mengumpulkan cacing tanah segar.' },
    { itemId: 'bahan_basi',    minQty: 1, maxQty: 2, weight: 5,  tierLabel: '🟢 Bahan Kompos', flavor: 'Sisa organik dapur yang bisa didaur ulang menjadi Pupuk Kompos di `/farm`.' },

    // Rare — 16% total weight
    { itemId: 'sampah_radio',  minQty: 1, maxQty: 1, weight: 10, tierLabel: '🔵 Rongsokan Elektronik (Rare)', flavor: 'Kamu menemukan radio tua rusak! Tukang servis berani membeli komponennya cukup mahal.' },
    { itemId: 'sampah_hp',     minQty: 1, maxQty: 1, weight: 6,  tierLabel: '🟣 Barang Kanibal Berharga (Rare)', flavor: 'Rezeki anak rajin! Ada bangkai HP mati total yang mesinnya laku keras di pasar loak.' },

    // Jackpot — 1% total weight
    { itemId: 'pancing_bambu', minQty: 1, maxQty: 1, weight: 0.5, tierLabel: '🌟 JACKPOT TEMUAN LANGKA!', flavor: 'LUAR BIASA! Seseorang membuang Pancingan Bambu yang masih utuh dan siap dipakai di `/fishing`!' },
    { itemId: 'beliung_batu',  minQty: 1, maxQty: 1, weight: 0.5, tierLabel: '🌟 JACKPOT TEMUAN LANGKA!', flavor: 'LUAR BIASA! Kamu menemukan Beliung Batu utuh di dekat kontainer proyek untuk `/mining`!' }
];

function rollBinLoot(rollFn = Math.random) {
    const totalWeight = BIN_LOOT_TABLE.reduce((acc, entry) => acc + entry.weight, 0);
    let r = rollFn() * totalWeight;
    let picked = BIN_LOOT_TABLE[0];

    for (const entry of BIN_LOOT_TABLE) {
        r -= entry.weight;
        if (r <= 0) {
            picked = entry;
            break;
        }
    }

    const span = Math.max(0, picked.maxQty - picked.minQty);
    const qty = picked.minQty + (span > 0 ? Math.floor(rollFn() * (span + 1)) : 0);
    const item = getItem(picked.itemId);

    return {
        itemId: picked.itemId,
        item,
        qty,
        tierLabel: picked.tierLabel,
        flavor: picked.flavor
    };
}

function describeItemUsage(item) {
    if (!item) return 'Bisa disimpan di tas.';
    const parts = [];
    if (item.tags?.includes('food') || item.tags?.includes('drink')) {
        const eff = [];
        if (item.effects?.hunger) eff.push(`+${item.effects.hunger} Hunger`);
        if (item.effects?.thirst) eff.push(`+${item.effects.thirst} Thirst`);
        if (item.effects?.energy) eff.push(`+${item.effects.energy} Energy`);
        parts.push(`Bisa dikonsumsi di \`/consume\` (${eff.join(', ')})`);
    }
    if (item.tags?.includes('bait')) {
        parts.push('Umpan pancing untuk `/fishing`');
    }
    if (item.tags?.includes('fishing_rod')) {
        parts.push('Membuka akses memancing di `/fishing`!');
    }
    if (item.tags?.includes('pickaxe')) {
        parts.push('Membuka akses menambang di `/mining`!');
    }
    if (item.id === 'bahan_basi') {
        parts.push('5× Bahan Basi dapat diolah jadi Pupuk Kompos di `/farm`');
    }
    if (item.sellPrice > 0) {
        parts.push(`Nilai jual dasar **${formatLp(item.sellPrice)}/unit**`);
    }
    return parts.join(' · ') || item.description;
}

async function fetchBinState(discordId, now = Date.now()) {
    const remCd = await getCooldownRemaining(discordId, 'bin', query);
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const p = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const slotsUsed = calculateSlotsUsed(invRows);
        const elig = checkActivityEligibility(p, ACTIVITY_COSTS.bin, 'bin', now);

        let trashUnits = 0;
        let estTrashValue = 0;
        for (const r of invRows) {
            const it = getItem(r.item_id);
            const qty = Number(r.quantity || 0);
            if (it && qty > 0 && it.tags?.includes('trash') && it.sellPrice > 0) {
                trashUnits += qty;
                estTrashValue += it.sellPrice * qty;
            }
        }

        const hasRod = invRows.some(r => {
            const it = getItem(r.item_id);
            return it?.tags?.includes('fishing_rod') && Number(r.quantity) > 0 && Number(r.durability ?? 1) > 0;
        });
        const hasPickaxe = invRows.some(r => {
            const it = getItem(r.item_id);
            return it?.tags?.includes('pickaxe') && Number(r.quantity) > 0 && Number(r.durability ?? 1) > 0;
        });

        return {
            player: p,
            invRows,
            slotsUsed,
            elig,
            remCd,
            trashUnits,
            estTrashValue,
            hasRod,
            hasPickaxe
        };
    });
}

function buildBinPanel({
    state,
    foundLoot = null,
    banner = null,
    now = Date.now()
}) {
    const {
        player: p,
        slotsUsed,
        elig,
        remCd,
        trashUnits,
        estTrashValue,
        hasRod,
        hasPickaxe
    } = state;
    const ownerId = p.discord_id;

    const toolProgressParts = [
        hasRod ? '🎋 Pancingan: ✅ Punya' : `🎋 Pancingan Bambu: **${formatLp(50000)}** (\`/shop\`)`,
        hasPickaxe ? '🪨 Beliung: ✅ Punya' : `🪨 Beliung Batu: **${formatLp(60000)}** (\`/shop\`)`
    ];

    const blocks = [];

    if (foundLoot && foundLoot.item) {
        const it = foundLoot.item;
        const totalEstSell = (it.sellPrice || 0) * foundLoot.qty;
        const sellNote = totalEstSell > 0
            ? `\n• 💰 **Estimasi Nilai Jual:** **${formatLp(totalEstSell)}**`
            : '';

        blocks.push(
            [
                `### 🎉 Hasil Mengais Tempat Sampah`,
                `_${foundLoot.flavor}_`,
                ``,
                `• 📦 **Barang Ditemukan:** **${foundLoot.qty}× ${it.emoji} ${it.name}**`,
                `• 🏷️ **Kategori:** ${foundLoot.tierLabel || '♻️ Rongsokan Umum'}`,
                `• ✨ **Kegunaan:** ${describeItemUsage(it)}${sellNote}`
            ].join('\n')
        );
    } else {
        blocks.push(
            [
                `### 🗑️ Tempat Sampah & Sudut Rongsokan Kota`,
                `Tempat warga baru merintis modal dari nol! Aduk tempat sampah setiap **5 detik** untuk menemukan **barang rongsokan**, **makanan/minuman layak konsumsi**, **umpan pancing**, hingga **alat bekas**.`,
                `• ⚡ **Biaya Aktivitas:** \`1 Energy\` · ⏱️ **Cooldown:** \`5 Detik\``,
                `• 🎯 **Target Modal Alat:** ${toolProgressParts.join(' · ')}`
            ].join('\n')
        );
    }

    const maxSlots = Number(p.max_slots || 20);
    const statusLines = [
        `🎒 **Kapasitas Tas:** \`${slotsUsed}/${maxSlots} slot\` · ♻️ **Rongsokan di Tas:** **${trashUnits} unit** *(~${formatLp(estTrashValue)})*`
    ];

    if (remCd > 0) {
        const readyUnix = Math.floor((now + remCd) / 1000);
        statusLines.push(`⏳ **Cooldown:** Siap mencari lagi **<t:${readyUnix}:R>** (${formatDuration(remCd)}).`);
    } else if (!elig.allowed) {
        statusLines.push(`⚠️ **Kondisi Tubuh:** ${elig.message}`);
    } else if (slotsUsed >= maxSlots) {
        statusLines.push(`🎒 **Tas Penuh:** Klik tombol **💰 Jual Rongsokan** atau jual barang di \`/sell\` terlebih dahulu!`);
    } else {
        statusLines.push(`🟢 **Status:** Siap mengais tempat sampah! Klik tombol **🔍 ${foundLoot ? 'Cari Lagi' : 'Cari di Tempat Sampah'}** di bawah.`);
    }

    blocks.push(statusLines.join('\n'));

    const canSearch = elig.allowed && slotsUsed < maxSlots;

    const row = new ActionRowBuilder().addComponents(
        btn('bin', 'search', ownerId, {
            label: foundLoot ? 'Cari Lagi (5d)' : 'Cari di Tempat Sampah',
            emoji: '🔍',
            style: ButtonStyle.Success,
            disabled: !canSearch
        }, now),
        btn('bin', 'sell_trash', ownerId, {
            label: `Jual Rongsokan (${trashUnits})`,
            emoji: '💰',
            style: ButtonStyle.Primary,
            disabled: trashUnits <= 0
        }, now),
        btn('bin', 'quick_meal', ownerId, {
            label: 'Makan Cepat',
            emoji: '🍴',
            style: ButtonStyle.Secondary
        }, now),
        btn('bin', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary
        }, now)
    );

    return buildPanel({
        mod: 'bin',
        ownerId,
        accentColor: foundLoot ? COLORS.SUCCESS : COLORS.ACT,
        title: `🗑️ Memulung & Mengais Tempat Sampah (/bin)`,
        player: p,
        banner,
        blocks,
        rows: [row],
        footer: 'Cooldown 5 detik · Jual rongsokan untuk membeli Pancingan Bambu (Lp 50.000) atau Beliung Batu (Lp 60.000) di /shop.',
        now
    });
}

async function handleBinSearch(interaction, rollFn = Math.random) {
    const now = Date.now();
    const userId = interaction.user.id;

    const remCd = await getCooldownRemaining(userId, 'bin', query);
    if (remCd > 0) {
        const state = await fetchBinState(userId, now);
        return await interaction.update(
            buildBinPanel({
                state,
                banner: {
                    type: 'warning',
                    text: `⏳ Sabar! Tunggu **${formatDuration(remCd)}** lagi sebelum mengais tempat sampah kembali.`
                },
                now
            })
        );
    }

    let outcome = null;
    await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, userId, now, true);
        const p = synced.player;
        const elig = checkActivityEligibility(p, ACTIVITY_COSTS.bin, 'bin', now);
        if (!elig.allowed) {
            outcome = { error: 'NOT_ELIGIBLE', message: elig.message };
            return;
        }

        const invRows = await getPlayerInventory(conn, userId, true, 'bag', now);
        const loot = rollBinLoot(rollFn);
        const fitCheck = canFitItems(invRows, p.max_slots, [{ itemId: loot.itemId, qty: loot.qty }]);
        if (!fitCheck.fits) {
            outcome = { error: 'BAG_FULL', maxSlots: p.max_slots };
            return;
        }

        await deductActivityVitals(conn, p, ACTIVITY_COSTS.bin, now);
        await addItem(conn, userId, loot.itemId, loot.qty, now, 'bag');
        await recordCollection(conn, userId, loot.itemId, loot.qty, now);
        const eventReward = await awardEventActivityProgress(conn, userId, 'bin', now);

        outcome = {
            ok: true,
            loot,
            eventReward
        };
    });

    if (!outcome || !outcome.ok) {
        const state = await fetchBinState(userId, now);
        const errText = outcome?.error === 'BAG_FULL'
            ? `🎒 Tasmu sudah penuh (${state.slotsUsed}/${state.player.max_slots} slot)! Klik **💰 Jual Rongsokan** atau kosongkan tas di \`/sell\`.`
            : (outcome?.message || 'Kondisi tubuhmu belum memungkinkan untuk mencari barang.');
        return await interaction.update(
            buildBinPanel({
                state,
                banner: { type: 'danger', text: errText },
                now
            })
        );
    }

    await setCooldown(userId, 'bin', ACTIVITY_COSTS.bin.cooldownSec, query);
    await incrementDailyAction(userId, 'bin', now);

    const state = await fetchBinState(userId, now);
    const { loot, eventReward } = outcome;
    const evNotice = eventReward
        ? ` · 🎪 Event: **+${eventReward.tokensAdded} ${eventReward.tokenEmoji} ${eventReward.tokenName}**!`
        : '';

    return await interaction.update(
        buildBinPanel({
            state,
            foundLoot: loot,
            banner: {
                type: 'success',
                text: `🔍 Kamu menemukan **${loot.qty}× ${loot.item.emoji} ${loot.item.name}** dari tempat sampah! (-⚡${ACTIVITY_COSTS.bin.energy} Energy)${evNotice}`
            },
            now
        })
    );
}

module.exports = {
    name: 'bin',
    slash: true,
    lockTtl: 10,
    data: new SlashCommandBuilder()
        .setName('bin')
        .setDescription('Cari barang rongsokan, makanan, atau alat bekas di tempat sampah kota (cooldown 5 detik).'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchBinState(interaction.user.id, now);
        return await interaction.reply(buildBinPanel({ state, now }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchBinState(interaction.user.id, now);
                return await interaction.update(buildBinPanel({ state, now }));
            },
            async search(interaction) {
                return await handleBinSearch(interaction);
            },
            async sell_trash(interaction) {
                const now = Date.now();
                const res = await executeSellItems(interaction.user.id, 'semua_sampah', null, now);
                const state = await fetchBinState(interaction.user.id, now);
                const banner = res.ok
                    ? {
                        type: 'success',
                        text: `💰 Berhasil menjual **${res.totalItemsSold} unit rongsokan** ke Bank Sampah seharga **+${formatLp(res.grandTotal)}**!`
                    }
                    : {
                        type: 'warning',
                        text: 'Tidak ada barang rongsokan di tasmu yang bisa dijual saat ini.'
                    };
                return await interaction.update(buildBinPanel({ state, banner, now }));
            },
            async quick_meal(interaction) {
                const now = Date.now();
                const meal = await executeQuickMeal(interaction.user.id, now);
                const state = await fetchBinState(interaction.user.id, now);
                const banner = meal.consumedSummary?.length > 0
                    ? { type: 'success', text: `🍴 Mengonsumsi bekal cepat: **${meal.consumedSummary.join(', ')}**!` }
                    : { type: 'info', text: 'Kondisi tubuhmu sudah kenyang atau tidak ada makanan/minuman di tas.' };
                return await interaction.update(buildBinPanel({ state, banner, now }));
            }
        }
    },

    BIN_LOOT_TABLE,
    rollBinLoot,
    fetchBinState,
    buildBinPanel
};
