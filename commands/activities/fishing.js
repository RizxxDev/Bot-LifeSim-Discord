const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { getCooldownRemaining, setCooldown, incrementDailyAction } = require('../../database/redis');
const { syncPlayerVitals, checkActivityEligibility, deductActivityVitals } = require('../../services/vitalService');
const {
    calculateSlotsUsed,
    getPlayerInventory,
    addItem,
    removeItem,
    getBestWorkingTool,
    damageTool,
    recordCollection
} = require('../../services/inventoryService');
const { isNewbieBoostActive, getSoftCapModifier, getLiveEconomyConfig } = require('../../services/economyService');
const { applyTripVehicleUsage } = require('../../services/vehicleService');
const { getCurrentWeather, getActiveSeasonalEvent, awardEventActivityProgress } = require('../../services/eventService');
const { executeQuickMeal } = require('../../services/consumptionService');
const { executeSellItems } = require('../../services/marketService');
const { FISHING_LOCATIONS, getFishingLocation, getLevelInfoFromXp, rollLoot } = require('../../data/locations');
const { getItem } = require('../../data/items');
const { ACTIVITY_COSTS } = require('../../data/constants');
const { COLORS, formatLp, formatDuration, buildV2Card } = require('../../utils/uiBuilder');
const { buildPanel, btn, select } = require('../../utils/panelBuilder');

const BAIT_IDS = ['umpan_cacing', 'umpan_udang', 'umpan_pro'];

function sleepMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchFishingState(discordId, now = Date.now()) {
    const remCd = await getCooldownRemaining(discordId, 'fishing', query);
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const p = synced.player;
        const buffs = synced.buffs;
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const weather = await getCurrentWeather(conn, now);

        const bestRod = getBestWorkingTool(invRows, 'fishing_rod');
        const lvInfo = getLevelInfoFromXp(p.fishing_xp);
        const slotsUsed = calculateSlotsUsed(invRows);
        const locId = p.last_fishing_loc || 'sungai';
        const location = getFishingLocation(locId);

        const baitCounts = {};
        for (const bid of BAIT_IDS) {
            baitCounts[bid] = invRows
                .filter(r => r.item_id === bid)
                .reduce((acc, r) => acc + Number(r.quantity), 0);
        }

        let activeBaitId = p.last_fishing_bait || 'umpan_cacing';
        if ((baitCounts[activeBaitId] || 0) <= 0) {
            const firstOwned = BAIT_IDS.find(id => (baitCounts[id] || 0) > 0);
            if (firstOwned) activeBaitId = firstOwned;
        }
        const baitItem = getItem(activeBaitId) || getItem('umpan_cacing');

        const activePermit = buffs.find(b => b.buff_type === 'sea_permit' && Number(b.expires_at) > now);
        const permitInBag = invRows.some(r => r.item_id === 'izin_melaut' && Number(r.quantity) > 0);
        const hasSeaAccess = Boolean(activePermit || permitInBag);

        const fishInBagCount = invRows
            .filter(r => {
                const it = getItem(r.item_id);
                return it && it.tags && (it.tags.includes('fish') || it.tags.includes('trash'));
            })
            .reduce((acc, r) => acc + Number(r.quantity), 0);

        const elig = checkActivityEligibility(p, ACTIVITY_COSTS.fishing, 'fishing', now);

        return {
            player: p,
            buffs,
            invRows,
            weather,
            bestRod,
            lvInfo,
            slotsUsed,
            location,
            baitCounts,
            activeBaitId,
            baitItem,
            hasSeaAccess,
            fishInBagCount,
            elig,
            remCd
        };
    });
}

function buildFishingRows(ownerId, state, now = Date.now()) {
    const { location, activeBaitId, baitCounts, lvInfo, bestRod, hasSeaAccess, slotsUsed, player, elig, remCd, fishInBagCount } = state;

    const locRow = select('fishing', 'loc', ownerId, {
        placeholder: '🏞️ Pilih Lokasi Memancing...',
        options: FISHING_LOCATIONS.map(loc => {
            const unlocked = lvInfo.level >= loc.minLevel && (bestRod ? (bestRod.item.toolTier || 1) >= loc.minRodTier : false);
            return {
                label: `${loc.name} (Lv. ${loc.minLevel}+)`,
                value: loc.id,
                emoji: unlocked ? loc.emoji : '🔒',
                description: `Syarat: Fishing Lv.${loc.minLevel} & Pancingan Tier ${loc.minRodTier}${loc.requiresSeaPermit ? ' + Izin Melaut' : ''}`,
                default: loc.id === location.id
            };
        })
    }, now);

    const baitRow = select('fishing', 'bait', ownerId, {
        placeholder: '🪱 Pilih Umpan Pancing...',
        options: BAIT_IDS.map(bid => {
            const it = getItem(bid);
            const qty = baitCounts[bid] || 0;
            return {
                label: `${it.name} (Stok: ×${qty})`,
                value: bid,
                emoji: it.emoji,
                description: it.description.slice(0, 95),
                default: bid === activeBaitId
            };
        })
    }, now);

    const canCast =
        remCd <= 0 &&
        elig.allowed &&
        slotsUsed < Number(player.max_slots) &&
        Boolean(bestRod) &&
        lvInfo.level >= location.minLevel &&
        (bestRod.item.toolTier || 1) >= location.minRodTier &&
        (!location.requiresSeaPermit || hasSeaAccess) &&
        (baitCounts[activeBaitId] || 0) > 0;

    const actionRow = new ActionRowBuilder().addComponents(
        btn('fishing', 'cast', ownerId, {
            label: remCd > 0 ? 'Menunggu Air Tenang' : 'Lempar Kail',
            emoji: '🎣',
            style: ButtonStyle.Success,
            disabled: !canCast
        }, now),
        btn('fishing', 'quick_meal', ownerId, {
            label: 'Makan Cepat',
            emoji: '🍴',
            style: ButtonStyle.Primary
        }, now),
        btn('fishing', 'sell_fish', ownerId, {
            label: `Jual Ikan (${fishInBagCount})`,
            emoji: '💰',
            style: ButtonStyle.Secondary,
            disabled: fishInBagCount <= 0
        }, now),
        btn('fishing', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary
        }, now)
    );

    return [locRow, baitRow, actionRow];
}

function buildFishingPrepPanel(state, banner = null, now = Date.now()) {
    const { player: p, weather, bestRod, lvInfo, slotsUsed, location, baitItem, baitCounts, hasSeaAccess, elig, remCd } = state;
    const ownerId = p.discord_id;

    if (!bestRod) {
        const hasBrokenRod = (state.invRows || []).some(r => {
            const it = getItem(r.item_id);
            return it?.tags?.includes('fishing_rod') && Number(r.quantity) > 0 && Number(r.durability) <= 0;
        });

        const gateBlocks = [
            hasBrokenRod
                ? `⚠️ **Pancinganmu di tas sudah rusak (Durability 0)!**\nBuka \`/inventory\` untuk memperbaikinya atau beli pancingan baru di \`/shop\`.`
                : `🔒 **Kamu belum memiliki Alat Pancing!**\nUntuk menggunakan \`/fishing\`, kamu wajib memiliki minimal **🎋 Pancingan Bambu** dan **🪱 Umpan Cacing** di dalam tasmu.`,
            [
                `### 🛠️ Cara Mendapatkan Alat Pancing Pertamamu:`,
                `1. **Cari Modal dari Nol (\`/bin\`):** Gunakan perintah \`/bin\` (cooldown **5 detik**) untuk mencari barang rongsokan di tempat sampah kota (atau peluang 1% menemukan Pancingan bekas!).`,
                `2. **Jual Rongsokan:** Klik tombol **💰 Jual Rongsokan** di panel \`/bin\` atau gunakan \`/sell\` hingga tabunganmu mencapai **${formatLp(55000)}**.`,
                `3. **Beli di Toko Perkakas (\`/shop\`):** Pilih **🔧 Toko Perkakas & Outdoor**, lalu beli **🎋 Pancingan Bambu (${formatLp(50000)})** dan **🪱 Umpan Cacing (${formatLp(1000)}/buah)**.`
            ].join('\n')
        ];

        const gateRow = new ActionRowBuilder().addComponents(
            btn('fishing', 'home', ownerId, {
                label: 'Cek Ulang Tas',
                emoji: '🔄',
                style: ButtonStyle.Primary
            }, now),
            btn('fishing', 'sell_fish', ownerId, {
                label: `Jual Ikan (${state.fishInBagCount || 0})`,
                emoji: '💰',
                style: ButtonStyle.Secondary,
                disabled: (state.fishInBagCount || 0) <= 0
            }, now)
        );

        return buildPanel({
            mod: 'fishing',
            ownerId,
            accentColor: COLORS.WARNING,
            title: `🔒 Alat Pancing Diperlukan (/fishing)`,
            player: p,
            banner,
            blocks: gateBlocks,
            rows: [gateRow],
            footer: 'Gunakan /bin untuk mengumpulkan modal awal atau /shop untuk membeli Pancingan Bambu.',
            now
        });
    }

    const weatherBonus = Number(weather.fishingRarityBonus?.[location.id] || 0);

    const rodText = bestRod
        ? `${bestRod.item.emoji} **${bestRod.item.name}** *(Durability: \`${bestRod.row.durability}/${bestRod.item.maxDurability}\`)*`
        : '❌ **Tidak ada pancingan siap pakai!** *(Beli di `/shop` atau perbaiki di `/inventory`)*';

    const baitQty = baitCounts[baitItem.id] || 0;
    const baitText = `${baitItem.emoji} **${baitItem.name}** *(Tersedia: \`×${baitQty}\`)*`;

    const statusNotices = [];
    if (remCd > 0) {
        statusNotices.push(`⏳ **Cooldown:** Siap melempar kail lagi **<t:${Math.floor((now + remCd) / 1000)}:R>** (${formatDuration(remCd)}).`);
    }
    if (!elig.allowed) statusNotices.push(`⚠️ **Kondisi Tubuh:** ${elig.message}`);
    if (slotsUsed >= Number(p.max_slots)) statusNotices.push(`🎒 **Tas Penuh (${slotsUsed}/${p.max_slots} slot):** Klik **💰 Jual Ikan** terlebih dahulu!`);
    if (lvInfo.level < location.minLevel) statusNotices.push(`🔒 **Level Kurang:** Lokasi ini butuh **Fishing Lv. ${location.minLevel}** (Levelmu: Lv. ${lvInfo.level}).`);
    if (bestRod && (bestRod.item.toolTier || 1) < location.minRodTier) {
        statusNotices.push(`🔒 **Pancingan Kurang Kuat:** Lokasi ini butuh minimal pancingan Tier ${location.minRodTier}.`);
    }
    if (location.requiresSeaPermit && !hasSeaAccess) {
        statusNotices.push(`⚓ **Izin Melaut:** Lokasi Laut Lepas wajib memiliki **Surat Izin Melaut** dari \`/shop\`.`);
    }
    if (baitQty <= 0) {
        statusNotices.push(`🪱 **Umpan Habis:** Beli umpan terlebih dahulu di Toko Perkakas (\`/shop\`).`);
    }

    const blocks = [
        [
            `📍 **Lokasi Aktif:** ${location.emoji} **${location.name}** *(Syarat Lv. ${location.minLevel})*`,
            `✨ **Skill Fishing:** **Lv. ${lvInfo.level}** (\`${lvInfo.currentXp}/${lvInfo.requiredXp} EXP\`)`,
            `🎋 **Pancingan:** ${rodText}`,
            `🪱 **Umpan Aktif:** ${baitText}`,
            `🎒 **Slot Tas:** \`${slotsUsed}/${p.max_slots} slot\` · ${weather.emoji} **${weather.name}**${weatherBonus > 0 ? ` *(+${Math.round(weatherBonus * 100)}% ikan langka)*` : ''}`
        ].join('\n'),
        statusNotices.length > 0
            ? statusNotices.join('\n')
            : '✅ **Siap Memancing!** Klik tombol **🎣 Lempar Kail** dan tarik saat pelampung tenggelam!'
    ];

    return buildPanel({
        mod: 'fishing',
        ownerId,
        accentColor: COLORS.ACT,
        title: `🎣 Dermaga & Spot Memancing`,
        player: p,
        banner,
        blocks,
        rows: buildFishingRows(ownerId, state, now),
        footer: 'Biaya per lemparan: 8 Energy · 4 Hunger · 5 Thirst · Cooldown 45 detik.',
        now
    });
}

async function runFishingCast(interaction, now = Date.now()) {
    const discordId = interaction.user.id;
    const remCd = await getCooldownRemaining(discordId, 'fishing', query);
    if (remCd > 0) {
        const state = await fetchFishingState(discordId, now);
        return await interaction.update(
            buildFishingPrepPanel(state, {
                type: 'warning',
                text: `Air masih beriak! Kamu bisa melempar kail lagi <t:${Math.floor((now + remCd) / 1000)}:R>.`
            }, now)
        );
    }

    const cost = ACTIVITY_COSTS.fishing;
    const pre = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const buffs = synced.buffs;
        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);

        const elig = checkActivityEligibility(p, cost, 'fishing', now);
        if (!elig.allowed) return { error: elig.message };

        const slotsUsed = calculateSlotsUsed(invRows);
        if (slotsUsed >= Number(p.max_slots)) return { error: 'Tasmu sudah penuh! Jual ikan terlebih dahulu.' };

        const bestRod = getBestWorkingTool(invRows, 'fishing_rod');
        if (!bestRod) return { error: 'Tidak ada pancingan siap pakai! Perbaiki di `/inventory` atau beli di `/shop`.' };

        const locId = p.last_fishing_loc || 'sungai';
        const location = getFishingLocation(locId);
        const lvInfo = getLevelInfoFromXp(p.fishing_xp);

        if (lvInfo.level < location.minLevel) {
            return { error: `Lokasi ${location.name} membutuhkan Fishing Lv. ${location.minLevel}.` };
        }
        if ((bestRod.item.toolTier || 1) < location.minRodTier) {
            return { error: `Lokasi ${location.name} membutuhkan pancingan minimal Tier ${location.minRodTier}.` };
        }

        if (location.requiresSeaPermit) {
            const activePermit = buffs.find(b => b.buff_type === 'sea_permit' && Number(b.expires_at) > now);
            if (!activePermit) {
                const permitRow = invRows.find(r => r.item_id === 'izin_melaut' && Number(r.quantity) > 0);
                if (!permitRow) {
                    return { error: 'Memancing di Laut Lepas membutuhkan ⚓ Surat Izin Melaut dari `/shop`.' };
                }
                await removeItem(conn, discordId, 'izin_melaut', 1, 'bag');
                const expiresAt = now + 86400000;
                await conn.execute(
                    `INSERT INTO player_buffs (discord_id, buff_type, multiplier, expires_at)
                     VALUES (?, 'sea_permit', 1.0, ?)
                     ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
                    [discordId, expiresAt]
                );
            }
        }

        const preferredBaitId = p.last_fishing_bait || 'umpan_cacing';
        let baitItem = getItem(preferredBaitId);
        let baitOwned = invRows
            .filter(r => r.item_id === preferredBaitId)
            .reduce((acc, r) => acc + Number(r.quantity), 0);

        if (baitOwned <= 0) {
            for (const fallbackId of BAIT_IDS) {
                const qty = invRows
                    .filter(r => r.item_id === fallbackId)
                    .reduce((acc, r) => acc + Number(r.quantity), 0);
                if (qty > 0) {
                    baitItem = getItem(fallbackId);
                    baitOwned = qty;
                    break;
                }
            }
        }

        if (!baitItem || baitOwned <= 0) {
            return { error: 'Persediaan umpanmu habis! Beli umpan di Toko Perkakas (`/shop`).' };
        }

        await setCooldown(
            discordId,
            'fishing',
            cost.cooldownSec,
            (sql, params) => conn.execute(sql, params)
        );

        return {
            player: p,
            location,
            rod: bestRod,
            baitItem,
            elig,
            lvInfo
        };
    });

    if (pre.error) {
        const state = await fetchFishingState(discordId, now);
        return await interaction.update(buildFishingPrepPanel(state, { type: 'danger', text: pre.error }, now));
    }

    await interaction.update(
        buildV2Card({
            accentColor: COLORS.ACT,
            title: `${pre.location.emoji} Memancing di ${pre.location.name}...`,
            blocks: [
                `Kamu memasang **${pre.baitItem.emoji} ${pre.baitItem.name}** pada **${pre.rod.item.emoji} ${pre.rod.item.name}** dan melempar kail ke air...`,
                '🌊 *Menunggu pelampung bergerak... Bersiaplah menekan tombol **🎣 Tarik!** saat muncul!*'
            ]
        })
    );

    const waitMs = 2000 + Math.floor(Math.random() * 2000);
    await sleepMs(waitMs);

    const nonce = `${discordId.slice(-4)}_${Date.now().toString(36)}`;
    const pullBtnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`fish_pull_${nonce}`)
            .setLabel('Tarik!')
            .setEmoji('🎣')
            .setStyle(ButtonStyle.Success)
    );

    const promptMsg = await interaction.editReply(
        buildV2Card({
            accentColor: COLORS.WARNING,
            title: `💦 STRIKE! Pelampung Tenggelam!`,
            blocks: [
                `Sesuatu menyambar umpanmu di **${pre.location.name}**!`,
                '⚡ Klik tombol **🎣 Tarik!** di bawah dalam **6 detik**!'
            ],
            actionRows: [pullBtnRow]
        })
    );

    let pulledInTime = false;
    try {
        const btnInt = await promptMsg.awaitMessageComponent({
            filter: i => i.user.id === discordId && i.customId === `fish_pull_${nonce}`,
            time: 6000
        });
        await btnInt.deferUpdate();
        pulledInTime = true;
    } catch {
        pulledInTime = false;
    }

    const finishNow = Date.now();
    const dailyFishCount = await incrementDailyAction(discordId, 'fishing', finishNow);

    const outcome = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, finishNow, true);
        const p = synced.player;
        const buffs = synced.buffs;
        const liveCfg = await getLiveEconomyConfig(conn);

        const softCap = getSoftCapModifier('fishing', dailyFishCount, liveCfg.soft_cap_enabled);
        const luckBuff = buffs.find(b => b.buff_type === 'luck_boost' && Number(b.expires_at) > finishNow);
        const xpBuff = buffs.find(b => b.buff_type === 'xp_boost' && Number(b.expires_at) > finishNow);
        const weather = await getCurrentWeather(conn, finishNow);
        const activeEvent = await getActiveSeasonalEvent(conn, finishNow);

        const weatherRarity = Number(weather.fishingRarityBonus?.[pre.location.id] || 0);
        const eventRarity = Number(activeEvent?.config?.bonuses?.rarityBonus || 0);
        const totalBuffRarity = (luckBuff ? Number(luckBuff.multiplier) : 0) + weatherRarity + eventRarity;

        const loot = rollLoot({
            isFishing: true,
            location: pre.location,
            toolRarityBonus: pre.rod.item.rarityBonus || 0,
            baitRarityBonus: pre.baitItem.rarityBonus || 0,
            baitMinTier: pre.baitItem.minBoostTier || 'uncommon',
            skillRarityBonus: pre.lvInfo.rarityBonus || 0,
            buffRarityBonus: totalBuffRarity,
            softCapTrashBonus: softCap.trashBonus || 0,
            minigameSuccess: pulledInTime
        });

        const caughtItem = getItem(loot.itemId);

        await removeItem(conn, discordId, pre.baitItem.id, 1, 'bag');
        await damageTool(conn, pre.rod.row.id, 1);
        await addItem(conn, discordId, caughtItem.id, loot.quantity, finishNow, 'bag');

        let isNewDiscovery = false;
        if (caughtItem.tags && caughtItem.tags.includes('fish')) {
            isNewDiscovery = await recordCollection(conn, discordId, caughtItem.id, loot.quantity, finishNow);
        }

        const newbieMult = isNewbieBoostActive(p, finishNow) ? 1.5 : 1.0;
        const xpBuffMult = (xpBuff ? Number(xpBuff.multiplier) : 1.0) * Number(activeEvent?.config?.bonuses?.fishingXpMult || 1.0);
        const mgXpMult = pulledInTime ? 1.0 : 0.5;
        const gainedXp = Math.max(
            1,
            Math.round(loot.rarityInfo.xp * mgXpMult * softCap.multiplier * newbieMult * xpBuffMult)
        );

        const oldLv = getLevelInfoFromXp(p.fishing_xp).level;
        p.fishing_xp = Number(p.fishing_xp || 0) + gainedXp;
        const newLvInfo = getLevelInfoFromXp(p.fishing_xp);
        const leveledUp = newLvInfo.level > oldLv;

        const tripVeh = await applyTripVehicleUsage(conn, discordId, pre.location.id);
        const effectiveCost = {
            ...cost,
            energy: Math.max(1, cost.energy - Number(tripVeh.energyDiscount || 0))
        };
        const hospitalized = deductActivityVitals(p, effectiveCost, 0, finishNow);

        await conn.execute(
            `UPDATE players
             SET energy = ?, hunger = ?, thirst = ?, health = ?,
                 cash = ?, bank = ?, hospital_until = ?, sleeping_until = ?,
                 fishing_xp = ?, last_fishing_loc = ?, last_fishing_bait = ?
             WHERE discord_id = ?`,
            [
                p.energy, p.hunger, p.thirst, p.health,
                p.cash, p.bank, p.hospital_until, p.sleeping_until,
                p.fishing_xp, pre.location.id, pre.baitItem.id,
                discordId
            ]
        );

        const remainingRodDur = Math.max(0, Number(pre.rod.row.durability) - 1);
        const eventReward = await awardEventActivityProgress(conn, discordId, 'fishing', finishNow);

        return {
            player: p,
            loot,
            caughtItem,
            gainedXp,
            newLvInfo,
            leveledUp,
            isNewDiscovery,
            remainingRodDur,
            softCap,
            tripVeh,
            weather,
            weatherRarity,
            eventReward,
            hospitalized
        };
    });

    const notes = [];
    if (outcome.weatherRarity > 0) {
        notes.push(`${outcome.weather.emoji} **${outcome.weather.name}:** Peluang ikan langka di ${pre.location.name} meningkat **+${Math.round(outcome.weatherRarity * 100)}%**!`);
    }
    if (outcome.eventReward) {
        notes.push(`${outcome.eventReward.eventConfig.emoji} **${outcome.eventReward.eventConfig.name}:** **+${outcome.eventReward.tokensAdded} ${outcome.eventReward.tokenEmoji} ${outcome.eventReward.tokenName}** (+1 Progres Komunitas)`);
    }
    if (outcome.tripVeh?.active && outcome.tripVeh.energyDiscount > 0) {
        const v = outcome.tripVeh.vehicle;
        const fuelStr = outcome.tripVeh.fuelConsumed > 0 ? ` · ⛽ -${outcome.tripVeh.fuelConsumed}L` : '';
        notes.push(`🚘 **Perjalanan (${v.emoji} ${v.name}):** Hemat **⚡${outcome.tripVeh.energyDiscount} Energy** (+${outcome.tripVeh.kmAdded} km${fuelStr})`);
    }
    if (!pulledInTime) {
        notes.push('⏱️ *Terlambat menarik kail!* Ikan besar sempat lolos (peluang Epic/Legendary hilang & EXP 50%).');
    }
    if (outcome.isNewDiscovery) {
        notes.push(`📖 **SPESIES BARU!** **${outcome.caughtItem.name}** tercatat untuk pertama kalinya di **Fishpedia** profilmu!`);
    }
    if (outcome.leveledUp) {
        notes.push(`🎉 **LEVEL UP!** Skill Fishing kamu naik ke **Lv. ${outcome.newLvInfo.level}**!`);
    }
    if (outcome.remainingRodDur === 0) {
        notes.push(`🔧 **Pancinganmu Rusak (Durability 0)!** Perbaiki lewat \`/inventory\` sebelum memancing lagi.`);
    }

    const nextCastUnix = Math.floor((now + cost.cooldownSec * 1000) / 1000);
    const updatedState = await fetchFishingState(discordId, finishNow);

    const resultPanel = buildPanel({
        mod: 'fishing',
        ownerId: discordId,
        accentColor: pulledInTime ? COLORS.ACT : COLORS.WARNING,
        title: `🎣 Hasil Memancing di ${pre.location.name}`,
        player: outcome.player,
        banner: {
            type: pulledInTime ? 'success' : 'warning',
            text: `Berhasil mengangkat **${outcome.loot.quantity}× ${outcome.caughtItem.emoji} ${outcome.caughtItem.name}** (${outcome.loot.rarityInfo.emoji} ${outcome.loot.rarityInfo.name})!`
        },
        blocks: [
            [
                `• 💰 **Harga Dasar Pasar:** ${formatLp(outcome.caughtItem.sellPrice)} / ekor`,
                `• ✨ **Fishing EXP:** +${outcome.gainedXp} EXP *(Lv. ${outcome.newLvInfo.level} — ${outcome.newLvInfo.currentXp}/${outcome.newLvInfo.requiredXp})*`,
                `• 🎋 **Durability ${pre.rod.item.name}:** \`${outcome.remainingRodDur}/${pre.rod.item.maxDurability}\``,
                `• ⏳ **Lemparan Berikutnya:** Siap **<t:${nextCastUnix}:R>**`
            ].join('\n'),
            notes.length > 0 ? notes.join('\n') : null
        ],
        rows: buildFishingRows(discordId, updatedState, finishNow),
        footer: 'Pilih lokasi/umpan atau klik Segarkan setelah hitungan mundur selesai untuk melempar kail lagi.',
        now: finishNow
    });

    await interaction.editReply(resultPanel);
}

module.exports = {
    name: 'fishing',
    slash: true,
    lockTtl: 25,
    data: new SlashCommandBuilder()
        .setName('fishing')
        .setDescription('Buka panel memancing interaktif: pilih lokasi, pilih umpan, lempar kail, dan jual hasil.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchFishingState(interaction.user.id, now);
        return await interaction.reply(buildFishingPrepPanel(state, null, now));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchFishingState(interaction.user.id, now);
                return await interaction.update(buildFishingPrepPanel(state, null, now));
            },
            async cast(interaction) {
                return await runFishingCast(interaction, Date.now());
            },
            async quick_meal(interaction) {
                const now = Date.now();
                const meal = await executeQuickMeal(interaction.user.id, now);
                const state = await fetchFishingState(interaction.user.id, now);
                const banner = meal.consumedSummary.length > 0
                    ? { type: 'success', text: `Makan cepat berhasil: mengonsumsi **${meal.consumedSummary.join(', ')}**.` }
                    : { type: 'info', text: 'Kondisi tubuhmu sudah kenyang atau tidak ada makanan/minuman di tas.' };
                return await interaction.update(buildFishingPrepPanel(state, banner, now));
            },
            async sell_fish(interaction) {
                const now = Date.now();
                const res = await executeSellItems(interaction.user.id, 'semua_ikan', null, now);
                const state = await fetchFishingState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `💰 Berhasil menjual **${res.totalItemsSold} tangkapan** ke Pasar Ikan seharga **+${formatLp(res.grandTotal)}**!` }
                    : { type: 'warning', text: 'Tidak ada ikan atau tangkapan di tasmu untuk dijual.' };
                return await interaction.update(buildFishingPrepPanel(state, banner, now));
            }
        },
        selects: {
            async loc(interaction) {
                const now = Date.now();
                const locId = interaction.values[0] || 'sungai';
                await query(`UPDATE players SET last_fishing_loc = ? WHERE discord_id = ?`, [locId, interaction.user.id]);
                const state = await fetchFishingState(interaction.user.id, now);
                return await interaction.update(buildFishingPrepPanel(state, null, now));
            },
            async bait(interaction) {
                const now = Date.now();
                const baitId = interaction.values[0] || 'umpan_cacing';
                await query(`UPDATE players SET last_fishing_bait = ? WHERE discord_id = ?`, [baitId, interaction.user.id]);
                const state = await fetchFishingState(interaction.user.id, now);
                return await interaction.update(buildFishingPrepPanel(state, null, now));
            }
        }
    },

    buildFishingPrepPanel
};
