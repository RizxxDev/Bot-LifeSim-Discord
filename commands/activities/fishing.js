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
const { FISHING_LOCATIONS, getFishingLocation, getLevelInfoFromXp, rollLoot } = require('../../data/locations');
const { getItem } = require('../../data/items');
const { ACTIVITY_COSTS } = require('../../data/constants');
const { COLORS, formatLp, formatDuration, formatVitalsCompact, buildV2Card } = require('../../utils/uiBuilder');

function sleepMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    name: 'fishing',
    slash: true,
    lockTtl: 25,
    data: new SlashCommandBuilder()
        .setName('fishing')
        .setDescription('Memancing ikan di Sungai, Danau, atau Laut Lepas.')
        .addStringOption(opt =>
            opt
                .setName('lokasi')
                .setDescription('Pilih lokasi memancing (kosongkan untuk lokasi terakhir)')
                .setRequired(false)
                .addChoices(
                    { name: '🏞️ Sungai Kota (Lv. 1+ · Pancingan Bambu)', value: 'sungai' },
                    { name: '🛶 Danau Hijau (Lv. 10+ · Pancingan Fiberglass)', value: 'danau' },
                    { name: '🌊 Laut Lepas (Lv. 25+ · Pancingan Carbon + Izin Melaut)', value: 'laut' }
                )
        )
        .addStringOption(opt =>
            opt
                .setName('umpan')
                .setDescription('Pilih umpan yang ingin dipakai (kosongkan untuk umpan terakhir)')
                .setRequired(false)
                .addChoices(
                    { name: '🪱 Umpan Cacing Tanah (Standar)', value: 'umpan_cacing' },
                    { name: '🦐 Umpan Udang Segar (+15% Uncommon+)', value: 'umpan_udang' },
                    { name: '🐟 Umpan Lure Pro (+30% Rare+)', value: 'umpan_pro' }
                )
        ),

    async executeSlash(interaction) {
        const discordId = interaction.user.id;
        const now = Date.now();

        const remCd = await getCooldownRemaining(discordId, 'fishing', query);
        if (remCd > 0) {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '⏳ Menunggu Ikan Kembali Tenang',
                    blocks: [`Kamu bisa melempar kail lagi dalam **${formatDuration(remCd)}** (<t:${Math.floor((now + remCd) / 1000)}:R>).`],
                    ephemeral: true
                })
            );
        }

        const optLoc = interaction.options.getString('lokasi');
        const optBait = interaction.options.getString('umpan');
        const cost = ACTIVITY_COSTS.fishing;

        // Pre-check alat, umpan, lokasi, slot tas, dan stat vital
        const pre = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, true);
            const p = synced.player;
            const buffs = synced.buffs;
            const invRows = await getPlayerInventory(conn, discordId, true);

            const elig = checkActivityEligibility(p, cost, 'fishing', now);
            if (!elig.allowed) {
                return { error: 'INELIGIBLE', elig, player: p };
            }

            const slotsUsed = calculateSlotsUsed(invRows);
            if (slotsUsed >= Number(p.max_slots)) {
                return { error: 'BAG_FULL', slotsUsed, maxSlots: p.max_slots };
            }

            const bestRod = getBestWorkingTool(invRows, 'fishing_rod');
            if (!bestRod) {
                return { error: 'NO_ROD' };
            }

            const locId = optLoc || p.last_fishing_loc || 'sungai';
            const location = getFishingLocation(locId);
            const lvInfo = getLevelInfoFromXp(p.fishing_xp);

            if (lvInfo.level < location.minLevel) {
                return { error: 'LOW_LEVEL', location, myLevel: lvInfo.level };
            }

            if ((bestRod.item.toolTier || 1) < location.minRodTier) {
                return { error: 'LOW_ROD', location, myRod: bestRod.item };
            }

            // Cek izin melaut bila lokasi = laut
            if (location.requiresSeaPermit) {
                const activePermit = buffs.find(b => b.buff_type === 'sea_permit' && Number(b.expires_at) > now);
                if (!activePermit) {
                    const permitRow = invRows.find(r => r.item_id === 'izin_melaut' && Number(r.quantity) > 0);
                    if (!permitRow) {
                        return { error: 'NO_SEA_PERMIT' };
                    }
                    // Otomatis aktifkan izin melaut 24 jam dari inventory
                    await removeItem(conn, discordId, 'izin_melaut', 1);
                    const expiresAt = now + 86400000;
                    await conn.execute(
                        `INSERT INTO player_buffs (discord_id, buff_type, multiplier, expires_at)
                         VALUES (?, 'sea_permit', 1.0, ?)
                         ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
                        [discordId, expiresAt]
                    );
                }
            }

            // Pilih umpan
            const preferredBaitId = optBait || p.last_fishing_bait || 'umpan_cacing';
            let baitItem = getItem(preferredBaitId);
            let baitOwned = invRows
                .filter(r => r.item_id === preferredBaitId)
                .reduce((acc, r) => acc + Number(r.quantity), 0);

            if (baitOwned <= 0 && !optBait) {
                // Fallback ke umpan apa saja yang dimiliki
                for (const fallbackId of ['umpan_cacing', 'umpan_udang', 'umpan_pro']) {
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
                return { error: 'NO_BAIT', requestedBait: baitItem || getItem('umpan_cacing') };
            }

            // Kunci cooldown di awal agar tidak bisa di-spam
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

        if (pre.error === 'INELIGIBLE') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '⚠️ Tidak Dapat Memancing',
                    blocks: [pre.elig.message, formatVitalsCompact(pre.player)],
                    ephemeral: true
                })
            );
        }

        if (pre.error === 'BAG_FULL') {
            const fullRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('shop_jump_perkakas')
                    .setLabel('Upgrade Tas di Toko Perkakas')
                    .setEmoji('🎒')
                    .setStyle(ButtonStyle.Primary)
            );
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: `🎒 Tas Penuh (${pre.slotsUsed}/${pre.maxSlots} Slot)!`,
                    blocks: [
                        'Kapasitas tasmu sudah penuh! Jual tangkapanmu dengan `/sell`, konsumsi makanan/minuman, atau upgrade kapasitas tas di `/shop`.'
                    ],
                    actionRows: [fullRow],
                    ephemeral: true
                })
            );
        }

        if (pre.error === 'NO_ROD') {
            const rodRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('shop_jump_perkakas')
                    .setLabel('Beli Pancingan di Toko Perkakas')
                    .setEmoji('🔧')
                    .setStyle(ButtonStyle.Primary)
            );
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '🎋 Tidak Ada Pancingan yang Siap Pakai!',
                    blocks: [
                        'Pancinganmu rusak (Durability 0) atau kamu belum memiliki pancingan.',
                        'Perbaiki alatmu lewat `/inventory` atau beli pancingan baru di Toko Perkakas (`/shop`).'
                    ],
                    actionRows: [rodRow],
                    ephemeral: true
                })
            );
        }

        if (pre.error === 'LOW_LEVEL') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '🔒 Lokasi Memancing Belum Terbuka',
                    blocks: [
                        `Lokasi **${pre.location.emoji} ${pre.location.name}** membutuhkan **Fishing Lv. ${pre.location.minLevel}**, sedangkan levelmu saat ini **Lv. ${pre.myLevel}**.`
                    ],
                    ephemeral: true
                })
            );
        }

        if (pre.error === 'LOW_ROD') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '🎣 Pancingan Kurang Kuat!',
                    blocks: [
                        `Memancing di **${pre.location.emoji} ${pre.location.name}** membutuhkan minimal pancingan Tier ${pre.location.minRodTier} (Fiberglass/Carbon), sedangkan kamu memakai **${pre.myRod.name}**.`
                    ],
                    ephemeral: true
                })
            );
        }

        if (pre.error === 'NO_SEA_PERMIT') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '⚓ Butuh Surat Izin Melaut!',
                    blocks: [
                        'Untuk memancing di **🌊 Laut Lepas**, kamu wajib memiliki **⚓ Surat Izin Melaut** (berlaku 24 jam, Rp/Lp 50.000).',
                        'Beli terlebih dahulu di **Kantor Layanan Publik** (`/shop` atau `/buy item:izin_melaut`).'
                    ],
                    ephemeral: true
                })
            );
        }

        if (pre.error === 'NO_BAIT') {
            const baitRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('shop_jump_perkakas')
                    .setLabel('Beli Umpan di Toko Perkakas')
                    .setEmoji('🪱')
                    .setStyle(ButtonStyle.Primary)
            );
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '🪱 Umpan Habis!',
                    blocks: [
                        `Kamu tidak memiliki **${pre.requestedBait.emoji} ${pre.requestedBait.name}** di tasmu. Beli umpan terlebih dahulu lewat \`/buy item:umpan_cacing amount:20\` atau tombol di bawah.`
                    ],
                    actionRows: [baitRow],
                    ephemeral: true
                })
            );
        }

        // Tahap 1: Tampilkan animasi menunggu umpan disambar (jeda acak 2-4 detik)
        await interaction.reply(
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

            // Kurangi umpan & durability pancingan, tambah tangkapan
            await removeItem(conn, discordId, pre.baitItem.id, 1);
            await damageTool(conn, pre.rod.row.id, 1);
            await addItem(conn, discordId, caughtItem.id, loot.quantity, finishNow);

            let isNewDiscovery = false;
            if (caughtItem.tags.includes('fish')) {
                isNewDiscovery = await recordCollection(conn, discordId, caughtItem.id, loot.quantity, finishNow);
            }

            // Hitung EXP
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
        } else if (outcome.tripVeh?.brokeDown) {
            notes.push(`🚨 **Kendaraan Mogok!** **${outcome.tripVeh.vehicle.name}** mogok karena telat diservis (penghematan Energy hilang).`);
        } else if (outcome.tripVeh?.reason === 'NO_FUEL') {
            notes.push(`⛽ **Bensin Habis!** Isi bensin **${outcome.tripVeh.vehicle.name}** lewat \`/vehicle refuel\` untuk menghemat Energy perjalanan jauh.`);
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
        if (outcome.softCap.isCapped) {
            notes.push(`📉 *Soft Cap Harian (Lemparan ke-${dailyFishCount}):* EXP ×${outcome.softCap.multiplier} & peluang sampah meningkat.`);
        }

        await interaction.editReply(
            buildV2Card({
                accentColor: pulledInTime ? COLORS.ACT : COLORS.WARNING,
                title: `🎣 Hasil Memancing di ${pre.location.name}`,
                blocks: [
                    `Kamu berhasil mengangkat **${outcome.loot.quantity}× ${outcome.caughtItem.emoji} ${outcome.caughtItem.name}**!`,
                    [
                        `• 🏷️ **Rarity:** ${outcome.loot.rarityInfo.emoji} **${outcome.loot.rarityInfo.name}**`,
                        `• 💰 **Harga Dasar Pasar:** ${formatLp(outcome.caughtItem.sellPrice)} / ekor`,
                        `• ✨ **Fishing EXP:** +${outcome.gainedXp} EXP *(Lv. ${outcome.newLvInfo.level} — ${outcome.newLvInfo.currentXp}/${outcome.newLvInfo.requiredXp})*`,
                        `• 🎣 **Durability ${pre.rod.item.name}:** ${outcome.remainingRodDur}/${pre.rod.item.maxDurability}`
                    ].join('\n'),
                    `📊 **Kondisi Tubuh:** ${formatVitalsCompact(outcome.player)}`,
                    notes.length > 0 ? notes.join('\n') : null
                ],
                footer: 'Gunakan /sell untuk menjual ke Pasar Ikan atau /eat untuk membakar ikan segar.'
            })
        );
    }
};
