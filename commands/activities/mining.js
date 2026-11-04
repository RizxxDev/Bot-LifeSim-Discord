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
const { executeQuickMeal } = require('../../services/consumptionService');
const { executeSellItems } = require('../../services/marketService');
const { MINING_LOCATIONS, getMiningLocation, getLevelInfoFromXp, rollLoot } = require('../../data/locations');
const { getItem } = require('../../data/items');
const { ACTIVITY_COSTS } = require('../../data/constants');
const { COLORS, formatLp, formatDuration, buildV2Card } = require('../../utils/uiBuilder');
const { buildPanel, btn, select } = require('../../utils/panelBuilder');

function sleepMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchMiningState(discordId, now = Date.now()) {
    const remCd = await getCooldownRemaining(discordId, 'mining', query);
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const p = synced.player;
        const buffs = synced.buffs;
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const weather = await getCurrentWeather(conn, now);

        const bestPickaxe = getBestWorkingTool(invRows, 'pickaxe');
        const helmet = getBestWorkingTool(invRows, 'helmet');
        const lvInfo = getLevelInfoFromXp(p.mining_xp);
        const slotsUsed = calculateSlotsUsed(invRows);
        const locId = p.last_mining_loc || 'tambang_batu';
        const location = getMiningLocation(locId);

        const mineralInBagCount = invRows
            .filter(r => {
                const it = getItem(r.item_id);
                return it && it.tags && it.tags.includes('mineral');
            })
            .reduce((acc, r) => acc + Number(r.quantity), 0);

        const elig = checkActivityEligibility(p, ACTIVITY_COSTS.mining, 'mining', now);

        return {
            player: p,
            buffs,
            invRows,
            weather,
            bestPickaxe,
            helmet,
            lvInfo,
            slotsUsed,
            location,
            mineralInBagCount,
            elig,
            remCd
        };
    });
}

function buildMiningRows(ownerId, state, now = Date.now()) {
    const { location, lvInfo, bestPickaxe, helmet, slotsUsed, player, elig, remCd, mineralInBagCount } = state;

    const locRow = select('mining', 'loc', ownerId, {
        placeholder: '🪨 Pilih Lokasi Terowongan Tambang...',
        options: MINING_LOCATIONS.map(loc => {
            const unlocked =
                lvInfo.level >= loc.minLevel &&
                (bestPickaxe ? (bestPickaxe.item.toolTier || 1) >= loc.minPickaxeTier : false) &&
                (!loc.requiresHelmet || Boolean(helmet));
            return {
                label: `${loc.name} (Lv. ${loc.minLevel}+)`,
                value: loc.id,
                emoji: unlocked ? loc.emoji : '🔒',
                description: `Syarat: Mining Lv.${loc.minLevel} & Beliung Tier ${loc.minPickaxeTier}${loc.requiresHelmet ? ' + Helm' : ''}`,
                default: loc.id === location.id
            };
        })
    }, now);

    const canSwing =
        remCd <= 0 &&
        elig.allowed &&
        slotsUsed < Number(player.max_slots) &&
        Boolean(bestPickaxe) &&
        lvInfo.level >= location.minLevel &&
        (bestPickaxe.item.toolTier || 1) >= location.minPickaxeTier &&
        (!location.requiresHelmet || Boolean(helmet));

    const actionRow = new ActionRowBuilder().addComponents(
        btn('mining', 'swing', ownerId, {
            label: remCd > 0 ? 'Debu Masih Tebal' : 'Ayunkan Beliung',
            emoji: '⛏️',
            style: ButtonStyle.Success,
            disabled: !canSwing
        }, now),
        btn('mining', 'quick_meal', ownerId, {
            label: 'Makan Cepat',
            emoji: '🍴',
            style: ButtonStyle.Primary
        }, now),
        btn('mining', 'sell_mineral', ownerId, {
            label: `Jual Mineral (${mineralInBagCount})`,
            emoji: '💰',
            style: ButtonStyle.Secondary,
            disabled: mineralInBagCount <= 0
        }, now),
        btn('mining', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary
        }, now)
    );

    return [locRow, actionRow];
}

function buildMiningPrepPanel(state, banner = null, now = Date.now()) {
    const { player: p, weather, bestPickaxe, helmet, lvInfo, slotsUsed, location, elig, remCd } = state;
    const ownerId = p.discord_id;

    const pickText = bestPickaxe
        ? `${bestPickaxe.item.emoji} **${bestPickaxe.item.name}** *(Durability: \`${bestPickaxe.row.durability}/${bestPickaxe.item.maxDurability}\`)*`
        : '❌ **Tidak ada beliung siap pakai!** *(Beli di `/shop` atau perbaiki di `/inventory`)*';

    const helmetText = helmet
        ? `⛑️ **${helmet.item.name}** *(Durability: \`${helmet.row.durability}/${helmet.item.maxDurability}\`)*`
        : '⚠️ *Tidak memakai Helm Keselamatan*';

    const statusNotices = [];
    if (remCd > 0) {
        statusNotices.push(`⏳ **Cooldown:** Siap menambang lagi **<t:${Math.floor((now + remCd) / 1000)}:R>** (${formatDuration(remCd)}).`);
    }
    if (!elig.allowed) statusNotices.push(`⚠️ **Kondisi Tubuh:** ${elig.message}`);
    if (slotsUsed >= Number(p.max_slots)) statusNotices.push(`🎒 **Tas Penuh (${slotsUsed}/${p.max_slots} slot):** Klik **💰 Jual Mineral** terlebih dahulu!`);
    if (lvInfo.level < location.minLevel) statusNotices.push(`🔒 **Level Kurang:** Lokasi ini butuh **Mining Lv. ${location.minLevel}** (Levelmu: Lv. ${lvInfo.level}).`);
    if (bestPickaxe && (bestPickaxe.item.toolTier || 1) < location.minPickaxeTier) {
        statusNotices.push(`🔒 **Beliung Kurang Kuat:** Lokasi ini butuh minimal beliung Tier ${location.minPickaxeTier}.`);
    }
    if (location.requiresHelmet && !helmet) {
        statusNotices.push(`⛑️ **Wajib Helm Keselamatan:** Lokasi ini berada di kedalaman berisiko tinggi dan mewajibkan Helm Tambang dari \`/shop\`.`);
    }

    const blocks = [
        [
            `📍 **Lokasi Aktif:** ${location.emoji} **${location.name}** *(Syarat Lv. ${location.minLevel})*`,
            `✨ **Skill Mining:** **Lv. ${lvInfo.level}** (\`${lvInfo.currentXp}/${lvInfo.requiredXp} EXP\`)`,
            `⛏️ **Beliung:** ${pickText}`,
            `🛡️ **Pelindung:** ${helmetText}`,
            `🎒 **Slot Tas:** \`${slotsUsed}/${p.max_slots} slot\` · ${weather.emoji} **${weather.name}**`
        ].join('\n'),
        statusNotices.length > 0
            ? statusNotices.join('\n')
            : '✅ **Siap Menambang!** Klik tombol **⛏️ Ayunkan Beliung** dan pukul urat mineral saat terlihat!'
    ];

    return buildPanel({
        mod: 'mining',
        ownerId,
        accentColor: COLORS.ACT,
        title: `⛏️ Terowongan & Gua Tambang`,
        player: p,
        banner,
        blocks,
        rows: buildMiningRows(ownerId, state, now),
        footer: 'Biaya per ayunan: 12 Energy · 6 Hunger · 7 Thirst · Cooldown 60 detik.',
        now
    });
}

async function runMiningSwing(interaction, now = Date.now()) {
    const discordId = interaction.user.id;
    const remCd = await getCooldownRemaining(discordId, 'mining', query);
    if (remCd > 0) {
        const state = await fetchMiningState(discordId, now);
        return await interaction.update(
            buildMiningPrepPanel(state, {
                type: 'warning',
                text: `Debu tambang masih tebal! Kamu bisa menambang lagi <t:${Math.floor((now + remCd) / 1000)}:R>.`
            }, now)
        );
    }

    const cost = ACTIVITY_COSTS.mining;
    const pre = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);

        const elig = checkActivityEligibility(p, cost, 'mining', now);
        if (!elig.allowed) return { error: elig.message };

        const slotsUsed = calculateSlotsUsed(invRows);
        if (slotsUsed >= Number(p.max_slots)) return { error: 'Tasmu sudah penuh! Jual hasil tambang terlebih dahulu.' };

        const bestPickaxe = getBestWorkingTool(invRows, 'pickaxe');
        if (!bestPickaxe) return { error: 'Tidak ada beliung siap pakai! Perbaiki di `/inventory` atau beli di `/shop`.' };

        const helmet = getBestWorkingTool(invRows, 'helmet');
        const locId = p.last_mining_loc || 'tambang_batu';
        const location = getMiningLocation(locId);
        const lvInfo = getLevelInfoFromXp(p.mining_xp);

        if (lvInfo.level < location.minLevel) {
            return { error: `Lokasi ${location.name} membutuhkan Mining Lv. ${location.minLevel}.` };
        }
        if ((bestPickaxe.item.toolTier || 1) < location.minPickaxeTier) {
            return { error: `Lokasi ${location.name} membutuhkan beliung minimal Tier ${location.minPickaxeTier}.` };
        }
        if (location.requiresHelmet && !helmet) {
            return { error: `Lokasi ${location.name} mewajibkan ⛑️ Helm Keselamatan Tambang!` };
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

    if (pre.error) {
        const state = await fetchMiningState(discordId, now);
        return await interaction.update(buildMiningPrepPanel(state, { type: 'danger', text: pre.error }, now));
    }

    await interaction.update(
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

        await addItem(conn, discordId, minedItem.id, loot.quantity, finishNow, 'bag');
        const isNewDiscovery = await recordCollection(conn, discordId, minedItem.id, loot.quantity, finishNow);

        const baseAccident = (pre.location.accidentChance || 0.03) + Number(weather.miningAccidentDelta || 0);
        const finalAccidentChance = pre.helmet ? baseAccident * 0.30 : baseAccident;
        let accidentDamage = 0;
        if (Math.random() < finalAccidentChance) {
            accidentDamage = 10 + Math.floor(Math.random() * 16);
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

    const nextSwingUnix = Math.floor((now + cost.cooldownSec * 1000) / 1000);
    const updatedState = await fetchMiningState(discordId, finishNow);

    const resultPanel = buildPanel({
        mod: 'mining',
        ownerId: discordId,
        accentColor: outcome.accidentDamage > 0 ? COLORS.WARNING : COLORS.ACT,
        title: `⛏️ Hasil Tambang di ${pre.location.name}`,
        player: outcome.player,
        banner: {
            type: swungInTime && outcome.accidentDamage === 0 ? 'success' : 'warning',
            text: `Berhasil menggali **${outcome.loot.quantity}× ${outcome.minedItem.emoji} ${outcome.minedItem.name}** (${outcome.loot.rarityInfo.emoji} ${outcome.loot.rarityInfo.name})!`
        },
        blocks: [
            [
                `• 💰 **Harga Dasar Pengepul:** ${formatLp(outcome.minedItem.sellPrice)} / unit`,
                `• ✨ **Mining EXP:** +${outcome.gainedXp} EXP *(Lv. ${outcome.newLvInfo.level} — ${outcome.newLvInfo.currentXp}/${outcome.newLvInfo.requiredXp})*`,
                `• ⛏️ **Durability ${pre.pickaxe.item.name}:** \`${outcome.remainingPickDur}/${pre.pickaxe.item.maxDurability}\``,
                `• ⏳ **Ayunan Berikutnya:** Siap **<t:${nextSwingUnix}:R>**`
            ].join('\n'),
            notes.length > 0 ? notes.join('\n') : null
        ],
        rows: buildMiningRows(discordId, updatedState, finishNow),
        footer: 'Pilih lokasi atau klik Segarkan setelah hitungan mundur selesai untuk menambang lagi.',
        now: finishNow
    });

    await interaction.editReply(resultPanel);
}

module.exports = {
    name: 'mining',
    slash: true,
    lockTtl: 25,
    data: new SlashCommandBuilder()
        .setName('mining')
        .setDescription('Buka panel menambang interaktif: pilih lokasi tambang, ayunkan beliung, dan jual mineral.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchMiningState(interaction.user.id, now);
        return await interaction.reply(buildMiningPrepPanel(state, null, now));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchMiningState(interaction.user.id, now);
                return await interaction.update(buildMiningPrepPanel(state, null, now));
            },
            async swing(interaction) {
                return await runMiningSwing(interaction, Date.now());
            },
            async quick_meal(interaction) {
                const now = Date.now();
                const meal = await executeQuickMeal(interaction.user.id, now);
                const state = await fetchMiningState(interaction.user.id, now);
                const banner = meal.consumedSummary.length > 0
                    ? { type: 'success', text: `Makan cepat berhasil: mengonsumsi **${meal.consumedSummary.join(', ')}**.` }
                    : { type: 'info', text: 'Kondisi tubuhmu sudah kenyang atau tidak ada makanan/minuman di tas.' };
                return await interaction.update(buildMiningPrepPanel(state, banner, now));
            },
            async sell_mineral(interaction) {
                const now = Date.now();
                const res = await executeSellItems(interaction.user.id, 'semua_tambang', null, now);
                const state = await fetchMiningState(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'success', text: `💰 Berhasil menjual **${res.totalItemsSold} mineral** ke Pengepul seharga **+${formatLp(res.grandTotal)}**!` }
                    : { type: 'warning', text: 'Tidak ada mineral tambang di tasmu untuk dijual.' };
                return await interaction.update(buildMiningPrepPanel(state, banner, now));
            }
        },
        selects: {
            async loc(interaction) {
                const now = Date.now();
                const locId = interaction.values[0] || 'tambang_batu';
                await query(`UPDATE players SET last_mining_loc = ? WHERE discord_id = ?`, [locId, interaction.user.id]);
                const state = await fetchMiningState(interaction.user.id, now);
                return await interaction.update(buildMiningPrepPanel(state, null, now));
            }
        }
    }
};
