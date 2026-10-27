const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { getCooldownRemaining, setCooldown, incrementDailyAction } = require('../../database/redis');
const { syncPlayerVitals, checkActivityEligibility, deductActivityVitals } = require('../../services/vitalService');
const {
    calculateSlotsUsed,
    getPlayerInventory,
    addItem,
    getBestWorkingTool,
    damageTool,
    recordCollection
} = require('../../services/inventoryService');
const { isNewbieBoostActive, getSoftCapModifier, getLiveEconomyConfig } = require('../../services/economyService');
const { applyTripVehicleUsage } = require('../../services/vehicleService');
const { getCurrentWeather, getActiveSeasonalEvent, awardEventActivityProgress } = require('../../services/eventService');
const { getMiningLocation, getLevelInfoFromXp, rollLoot } = require('../../data/locations');
const { getItem } = require('../../data/items');
const { ACTIVITY_COSTS } = require('../../data/constants');
const { COLORS, formatLp, formatDuration, formatVitalsCompact, buildV2Card } = require('../../utils/uiBuilder');

function sleepMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
    name: 'mining',
    slash: true,
    lockTtl: 25,
    data: new SlashCommandBuilder()
        .setName('mining')
        .setDescription('Menambang batu, bijih logam, emas, dan berlian di dalam terowongan tambang.')
        .addStringOption(opt =>
            opt
                .setName('lokasi')
                .setDescription('Pilih lokasi tambang (kosongkan untuk lokasi terakhir)')
                .setRequired(false)
                .addChoices(
                    { name: '🪨 Tambang Batu Permukaan (Lv. 1+ · Beliung Batu)', value: 'tambang_batu' },
                    { name: '🟠 Tambang Tembaga & Perak (Lv. 10+ · Beliung Besi)', value: 'tambang_tembaga' },
                    { name: '🪙 Tambang Emas Dalam (Lv. 25+ · Beliung Baja + Helm)', value: 'tambang_emas' },
                    { name: '💎 Gua Inti Berlian (Lv. 40+ · Beliung Titanium + Helm)', value: 'tambang_berlian' }
                )
        ),

    async executeSlash(interaction) {
        const discordId = interaction.user.id;
        const now = Date.now();

        const remCd = await getCooldownRemaining(discordId, 'mining', query);
        if (remCd > 0) {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '⏳ Debu Tambang Masih Tebal',
                    blocks: [`Kamu bisa kembali menambang dalam **${formatDuration(remCd)}** (<t:${Math.floor((now + remCd) / 1000)}:R>).`],
                    ephemeral: true
                })
            );
        }

        const optLoc = interaction.options.getString('lokasi');
        const cost = ACTIVITY_COSTS.mining;

        const pre = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, true);
            const p = synced.player;
            const invRows = await getPlayerInventory(conn, discordId, true);

            const elig = checkActivityEligibility(p, cost, 'mining', now);
            if (!elig.allowed) {
                return { error: 'INELIGIBLE', elig, player: p };
            }

            const slotsUsed = calculateSlotsUsed(invRows);
            if (slotsUsed >= Number(p.max_slots)) {
                return { error: 'BAG_FULL', slotsUsed, maxSlots: p.max_slots };
            }

            const bestPickaxe = getBestWorkingTool(invRows, 'pickaxe');
            if (!bestPickaxe) {
                return { error: 'NO_PICKAXE' };
            }

            const helmet = getBestWorkingTool(invRows, 'helmet');

            const locId = optLoc || p.last_mining_loc || 'tambang_batu';
            const location = getMiningLocation(locId);
            const lvInfo = getLevelInfoFromXp(p.mining_xp);

            if (lvInfo.level < location.minLevel) {
                return { error: 'LOW_LEVEL', location, myLevel: lvInfo.level };
            }

            if ((bestPickaxe.item.toolTier || 1) < location.minPickaxeTier) {
                return { error: 'LOW_PICKAXE', location, myPickaxe: bestPickaxe.item };
            }

            if (location.requiresHelmet && !helmet) {
                return { error: 'NO_HELMET', location };
            }

            await setCooldown(
                discordId,
                'mining',
                cost.cooldownSec,
                (sql, params) => conn.execute(sql, params)
            );

            return {
                player: p,
                location,
                pickaxe: bestPickaxe,
                helmet,
                elig,
                lvInfo
            };
        });

        if (pre.error === 'INELIGIBLE') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '⚠️ Tidak Dapat Menambang',
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
                        'Kapasitas tasmu sudah penuh! Jual hasil tambangmu dengan `/sell` atau upgrade tasmu di `/shop`.'
                    ],
                    actionRows: [fullRow],
                    ephemeral: true
                })
            );
        }

        if (pre.error === 'NO_PICKAXE') {
            const pickRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('shop_jump_perkakas')
                    .setLabel('Buka Toko Perkakas')
                    .setEmoji('⛏️')
                    .setStyle(ButtonStyle.Primary)
            );
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '⛏️ Tidak Ada Beliung yang Siap Pakai!',
                    blocks: [
                        'Beliungmu rusak (Durability 0) atau kamu belum memiliki beliung.',
                        'Perbaiki beliungmu lewat `/inventory` atau beli beliung baru di Toko Perkakas (`/shop`).'
                    ],
                    actionRows: [pickRow],
                    ephemeral: true
                })
            );
        }

        if (pre.error === 'LOW_LEVEL') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '🔒 Lokasi Tambang Belum Terbuka',
                    blocks: [
                        `Lokasi **${pre.location.emoji} ${pre.location.name}** membutuhkan **Mining Lv. ${pre.location.minLevel}**, sedangkan levelmu saat ini **Lv. ${pre.myLevel}**.`
                    ],
                    ephemeral: true
                })
            );
        }

        if (pre.error === 'LOW_PICKAXE') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '⛏️ Beliung Kurang Kuat!',
                    blocks: [
                        `Menambang di **${pre.location.emoji} ${pre.location.name}** membutuhkan minimal beliung Tier ${pre.location.minPickaxeTier}, sedangkan kamu memakai **${pre.myPickaxe.name}**.`
                    ],
                    ephemeral: true
                })
            );
        }

        if (pre.error === 'NO_HELMET') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '⛑️ Wajib Menggunakan Helm Keselamatan!',
                    blocks: [
                        `Lokasi **${pre.location.emoji} ${pre.location.name}** berada di kedalaman berisiko tinggi dan mewajibkan **⛑️ Helm Keselamatan Tambang** yang masih layak pakai.`,
                        'Beli di Toko Perkakas (`/shop` atau `/buy item:helm_tambang`) atau perbaiki di `/inventory`.'
                    ],
                    ephemeral: true
                })
            );
        }

        await interaction.reply(
            buildV2Card({
                accentColor: COLORS.ACT,
                title: `${pre.location.emoji} Menambang di ${pre.location.name}...`,
                blocks: [
                    `Kamu mengamati retakan dinding batuan menggunakan **${pre.pickaxe.item.emoji} ${pre.pickaxe.item.name}**...`,
                    '🔦 *Bersiaplah menekan tombol **⛏️ Ayunkan!** saat titik lemah batuan terlihat!*'
                ]
            })
        );

        const waitMs = 2000 + Math.floor(Math.random() * 2000);
        await sleepMs(waitMs);

        const nonce = `${discordId.slice(-4)}_${Date.now().toString(36)}`;
        const swingRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`mine_swing_${nonce}`)
                .setLabel('Ayunkan!')
                .setEmoji('⛏️')
                .setStyle(ButtonStyle.Success)
        );

        const promptMsg = await interaction.editReply(
            buildV2Card({
                accentColor: COLORS.WARNING,
                title: `✨ Urat Mineral Terlihat!`,
                blocks: [
                    `Celah batuan di **${pre.location.name}** terbuka!`,
                    '⚡ Klik tombol **⛏️ Ayunkan!** di bawah dalam **6 detik**!'
                ],
                actionRows: [swingRow]
            })
        );

        let swungInTime = false;
        try {
            const btnInt = await promptMsg.awaitMessageComponent({
                filter: i => i.user.id === discordId && i.customId === `mine_swing_${nonce}`,
                time: 6000
            });
            await btnInt.deferUpdate();
            swungInTime = true;
        } catch {
            swungInTime = false;
        }

        const finishNow = Date.now();
        const dailyMineCount = await incrementDailyAction(discordId, 'mining', finishNow);

        const outcome = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, finishNow, true);
            const p = synced.player;
            const buffs = synced.buffs;
            const liveCfg = await getLiveEconomyConfig(conn);

            const softCap = getSoftCapModifier('mining', dailyMineCount, liveCfg.soft_cap_enabled);
            const luckBuff = buffs.find(b => b.buff_type === 'luck_boost' && Number(b.expires_at) > finishNow);
            const xpBuff = buffs.find(b => b.buff_type === 'xp_boost' && Number(b.expires_at) > finishNow);
            const weather = await getCurrentWeather(conn, finishNow);
            const activeEvent = await getActiveSeasonalEvent(conn, finishNow);

            const eventRarity = Number(activeEvent?.config?.bonuses?.rarityBonus || 0);
            const totalBuffRarity = (luckBuff ? Number(luckBuff.multiplier) : 0) + eventRarity;

            const loot = rollLoot({
                isFishing: false,
                location: pre.location,
                toolRarityBonus: pre.pickaxe.item.rarityBonus || 0,
                skillRarityBonus: pre.lvInfo.rarityBonus || 0,
                buffRarityBonus: totalBuffRarity,
                minigameSuccess: swungInTime
            });

            const minedItem = getItem(loot.itemId);

            await damageTool(conn, pre.pickaxe.row.id, 1);
            if (pre.helmet) {
                await damageTool(conn, pre.helmet.row.id, 1);
            }

            await addItem(conn, discordId, minedItem.id, loot.quantity, finishNow);
            const isNewDiscovery = await recordCollection(conn, discordId, minedItem.id, loot.quantity, finishNow);

            // Cek risiko kecelakaan tambang (dikurangi 70% oleh Helm, ditambah cuaca musim hujan +1%)
            const baseAccident = (pre.location.accidentChance || 0.03) + Number(weather.miningAccidentDelta || 0);
            const finalAccidentChance = pre.helmet ? baseAccident * 0.30 : baseAccident;
            let accidentDamage = 0;
            if (Math.random() < finalAccidentChance) {
                accidentDamage = 10 + Math.floor(Math.random() * 16); // 10 s/d 25 Health
            }

            const newbieMult = isNewbieBoostActive(p, finishNow) ? 1.5 : 1.0;
            const xpBuffMult = (xpBuff ? Number(xpBuff.multiplier) : 1.0) * Number(activeEvent?.config?.bonuses?.miningXpMult || 1.0);
            const mgXpMult = swungInTime ? 1.0 : 0.5;
            const gainedXp = Math.max(
                1,
                Math.round(loot.rarityInfo.xp * mgXpMult * softCap.multiplier * newbieMult * xpBuffMult)
            );

            const oldLv = getLevelInfoFromXp(p.mining_xp).level;
            p.mining_xp = Number(p.mining_xp || 0) + gainedXp;
            const newLvInfo = getLevelInfoFromXp(p.mining_xp);
            const leveledUp = newLvInfo.level > oldLv;

            const tripVeh = await applyTripVehicleUsage(conn, discordId, pre.location.id);
            const effectiveCost = {
                ...cost,
                energy: Math.max(1, cost.energy - Number(tripVeh.energyDiscount || 0))
            };
            const hospitalized = deductActivityVitals(p, effectiveCost, accidentDamage, finishNow);
            if (hospitalized && hospitalized.totalPaid > 0) {
                await conn.execute(
                    `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
                     VALUES (?, 'sink', 'hospital_fee_mining', ?, ?, ?, ?)`,
                    [
                        discordId,
                        hospitalized.totalPaid,
                        p.cash + p.bank,
                        JSON.stringify({ targetFee: hospitalized.targetFee }),
                        finishNow
                    ]
                );
            }

            await conn.execute(
                `UPDATE players
                 SET energy = ?, hunger = ?, thirst = ?, health = ?,
                     cash = ?, bank = ?, hospital_until = ?, sleeping_until = ?,
                     mining_xp = ?, last_mining_loc = ?
                 WHERE discord_id = ?`,
                [
                    p.energy, p.hunger, p.thirst, p.health,
                    p.cash, p.bank, p.hospital_until, p.sleeping_until,
                    p.mining_xp, pre.location.id,
                    discordId
                ]
            );

            const remainingPickDur = Math.max(0, Number(pre.pickaxe.row.durability) - 1);
            const eventReward = await awardEventActivityProgress(conn, discordId, 'mining', finishNow);

            return {
                player: p,
                loot,
                minedItem,
                gainedXp,
                newLvInfo,
                leveledUp,
                isNewDiscovery,
                accidentDamage,
                remainingPickDur,
                softCap,
                tripVeh,
                eventReward,
                hospitalized
            };
        });

        const notes = [];
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
        if (!swungInTime) {
            notes.push('⏱️ *Ayunan kurang tepat waktu!* Kamu kehilangan peluang mendapatkan Epic/Legendary dan EXP 50%.');
        }
        if (outcome.accidentDamage > 0) {
            notes.push(`⚠️ **Runtuhan Batu Kecil!** Kamu terkena serpihan batu dan kehilangan **-${outcome.accidentDamage} ❤️ Health**${!pre.helmet ? ' *(Gunakan Helm Keselamatan untuk menekan risiko 70%!)*' : ''}.`);
        }
        if (outcome.hospitalized) {
            notes.push(`🚑 **PINGSAN DI TAMBANG!** Tim penyelamat membawamu ke Rumah Sakit (Biaya perawatan: **${formatLp(outcome.hospitalized.totalPaid)}**).`);
        }
        if (outcome.isNewDiscovery) {
            notes.push(`📖 **TEMUAN BARU!** **${outcome.minedItem.name}** tercatat untuk pertama kalinya di **Buku Mineral** profilmu!`);
        }
        if (outcome.leveledUp) {
            notes.push(`🎉 **LEVEL UP!** Skill Mining kamu naik ke **Lv. ${outcome.newLvInfo.level}**!`);
        }
        if (outcome.remainingPickDur === 0) {
            notes.push(`🔧 **Beliungmu Rusak (Durability 0)!** Perbaiki lewat \`/inventory\` sebelum menambang lagi.`);
        }
        if (outcome.softCap.isCapped) {
            notes.push(`📉 *Soft Cap Harian (Ayunan ke-${dailyMineCount}):* EXP ×${outcome.softCap.multiplier}.`);
        }

        await interaction.editReply(
            buildV2Card({
                accentColor: outcome.accidentDamage > 0 ? COLORS.WARNING : COLORS.ACT,
                title: `⛏️ Hasil Tambang di ${pre.location.name}`,
                blocks: [
                    `Kamu berhasil menggali **${outcome.loot.quantity}× ${outcome.minedItem.emoji} ${outcome.minedItem.name}**!`,
                    [
                        `• 🏷️ **Rarity:** ${outcome.loot.rarityInfo.emoji} **${outcome.loot.rarityInfo.name}**`,
                        `• 💰 **Harga Dasar Pengepul:** ${formatLp(outcome.minedItem.sellPrice)} / unit`,
                        `• ✨ **Mining EXP:** +${outcome.gainedXp} EXP *(Lv. ${outcome.newLvInfo.level} — ${outcome.newLvInfo.currentXp}/${outcome.newLvInfo.requiredXp})*`,
                        `• ⛏️ **Durability ${pre.pickaxe.item.name}:** ${outcome.remainingPickDur}/${pre.pickaxe.item.maxDurability}`
                    ].join('\n'),
                    `📊 **Kondisi Tubuh:** ${formatVitalsCompact(outcome.player)}`,
                    notes.length > 0 ? notes.join('\n') : null
                ],
                footer: 'Jual hasil galianmu ke Pengepul Tambang dengan command /sell.'
            })
        );
    }
};
