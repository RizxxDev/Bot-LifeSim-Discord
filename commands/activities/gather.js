const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonStyle
} = require('discord.js');
const {
    GATHER_ZONES,
    fetchGatherState,
    selectGatherZone,
    executeGatherAction
} = require('../../services/gatherService');
const { GATHER_ACTIVITY_COST } = require('../../data/gathering');
const { ACTIVITY_COSTS } = require('../../data/constants');
const { executeQuickMeal } = require('../../services/consumptionService');
const { buildCityGatePanel } = require('../../services/cityService');
const { getItem } = require('../../data/items');
const {
    COLORS,
    formatLp,
    formatVitalsCompact,
    renderBar
} = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select
} = require('../../utils/panelBuilder');
const { scheduleAutoUpdate, cancelAutoUpdate } = require('../../services/autoUpdateService');
const { isPropertyUnderDevelopment } = require('../../utils/featureFlags');

function countBuildingMaterialsInBag(invRows = []) {
    return invRows.reduce((sum, row) => {
        const it = getItem(row.item_id);
        if (it?.tags?.includes('building_material') && Number(row.quantity) > 0) {
            return sum + Number(row.quantity);
        }
        return sum;
    }, 0);
}

function getZoneToolStatus(state) {
    const zone = state.zone;
    const isAxe = zone.requiredToolTag === 'axe';
    const matchingTool = isAxe ? state.bestAxe : state.bestShovel;
    const brokenMatching = (state.invRows || []).some(r => {
        const it = getItem(r.item_id);
        return it?.tags?.includes(zone.requiredToolTag) && Number(r.quantity) > 0 && Number(r.durability) <= 0;
    });
    const tierOk = Boolean(matchingTool) && Number(matchingTool.item.toolTier || 1) >= Number(zone.minToolTier || 1);
    return {
        isAxe,
        matchingTool,
        brokenMatching,
        tierOk,
        toolName: isAxe ? 'Kapak' : 'Sekop',
        starterId: isAxe ? 'kapak_tangan' : 'sekop_baja'
    };
}

function scheduleGatherCooldown(userId, interaction, remCd) {
    if (!interaction || interaction.isLiveSyncProbe) return;
    if (Number(remCd || 0) <= 0) {
        cancelAutoUpdate(`gather:${userId}`);
        return;
    }
    scheduleAutoUpdate(`gather:${userId}`, interaction, Number(remCd) + 500, async () => {
        const readyNow = Date.now();
        const readyState = await fetchGatherState(userId, readyNow);
        return buildGatherPanel(readyState, {
            type: 'success',
            text: '🌲 **Alat & staminamu sudah siap!** Klik **Tebang / Gali Sekarang** untuk ekspedisi berikutnya.'
        }, readyNow);
    });
}

function buildGatherRows(ownerId, state, now = Date.now()) {
    const { player: p, lvInfo, slotsUsed, zone, elig, remCd } = state;
    const toolStatus = getZoneToolStatus(state);
    const matCount = countBuildingMaterialsInBag(state.invRows);

    const zoneRow = select('gather', 'zone', ownerId, {
        placeholder: 'Pilih lokasi hutan atau galian material...',
        options: GATHER_ZONES.map(z => {
            const needTool = z.requiredToolTag === 'axe' ? `Kapak T${z.minToolTier}+` : `Sekop T${z.minToolTier}+`;
            return {
                label: `${z.name} (Min Lv. ${z.minLevel})`,
                value: z.id,
                emoji: z.emoji,
                description: `Alat: ${needTool} | +${z.baseXp} Gathering EXP`,
                default: z.id === zone.id
            };
        })
    }, now);

    const canAct =
        remCd <= 0 &&
        elig.allowed &&
        slotsUsed < Number(p.max_slots || 20) &&
        lvInfo.level >= Number(zone.minLevel || 1) &&
        toolStatus.tierOk;

    const actionButtons = [
        btn('gather', 'act', ownerId, {
            label: remCd > 0 ? 'Masih Istirahat' : 'Tebang / Gali Sekarang',
            emoji: toolStatus.isAxe ? '🪓' : '🏗️',
            style: ButtonStyle.Success,
            disabled: !canAct
        }, now),
        btn('gather', 'quick_meal', ownerId, {
            label: 'Makan Cepat',
            emoji: '🍴',
            style: ButtonStyle.Primary
        }, now),
        btn('shop', 'page', ownerId, {
            label: 'Beli Alat (/shop)',
            emoji: '🔧',
            style: ButtonStyle.Secondary,
            arg: 'perkakas:1'
        }, now)
    ];
    if (!isPropertyUnderDevelopment()) {
        actionButtons.push(
            btn('bangun', 'home', ownerId, {
                label: `Studio /bangun (${matCount} bahan)`,
                emoji: '🏗️',
                style: ButtonStyle.Secondary
            }, now)
        );
    }
    const actionRow = new ActionRowBuilder().addComponents(...actionButtons);

    return [zoneRow, actionRow];
}

function buildGatherPanel(state, banner = null, now = Date.now()) {
    const { player: p, bestAxe, bestShovel, lvInfo, slotsUsed, zone, elig, remCd } = state;
    if ((p.current_city || 'kota_sentral') !== 'kota_timur') {
        cancelAutoUpdate(`gather:${p.discord_id}`);
        return buildCityGatePanel({
            player: p,
            requiredCityId: 'kota_timur',
            facilityTitle: '🌲 Hutan Kayu & Galian Alam (/gather)',
            reasonText: 'Sumber bahan bangunan mentah (**Kayu Gelondongan**, **Bambu Konstruksi**, **Tanah Liat**, dan **Pasir Sungai**) hanya terdapat di kawasan hijau **🌿 Lembah Hijau (`kota_timur`)**! Gunakan `/travel` untuk pergi ke sana.',
            now
        });
    }

    const ownerId = p.discord_id;
    const cost = ACTIVITY_COSTS.gather || GATHER_ACTIVITY_COST;
    const toolStatus = getZoneToolStatus(state);

    const axeTxt = bestAxe
        ? `${bestAxe.item.emoji} **${bestAxe.item.name}** *(Dur. ${bestAxe.row.durability}/${bestAxe.item.maxDurability})*`
        : '❌ *Belum punya Kapak aktif*';
    const shovelTxt = bestShovel
        ? `${bestShovel.item.emoji} **${bestShovel.item.name}** *(Dur. ${bestShovel.row.durability}/${bestShovel.item.maxDurability})*`
        : '❌ *Belum punya Sekop aktif*';

    const dropPreview = (zone.drops || []).map(d => {
        const it = getItem(d.itemId);
        return `${it?.emoji || '📦'} ${it?.name || d.itemId} (${d.minQty}-${d.maxQty})`;
    }).join(' · ');

    let statusNote = null;
    const maxSlots = Number(p.max_slots || 20);
    if (remCd > 0) {
        const readyUnix = Math.floor((now + remCd) / 1000);
        statusNote = `⏳ **Sedang beristirahat:** Siap menebang/menggali lagi <t:${readyUnix}:R>.`;
    } else if (!elig.allowed) {
        statusNote = `⚠️ **Kondisi Tubuh Belum Memadai:** ${elig.message}`;
    } else if (slotsUsed >= maxSlots) {
        statusNote = isPropertyUnderDevelopment()
            ? `⚠️ **Tas Penuh (${slotsUsed}/${maxSlots}):** Pindahkan barang ke \`/storage\` atau upgrade ukuran tas di \`/inventory\`.`
            : `⚠️ **Tas Penuh (${slotsUsed}/${maxSlots}):** Setor bahan ke Gudang Proyek \`/bangun\` atau pindahkan ke \`/storage\`.`;
    } else if (!toolStatus.matchingTool) {
        statusNote = toolStatus.brokenMatching
            ? `🔧 **${toolStatus.toolName} milikmu di tas rusak (Durability 0)!** Perbaiki lewat \`/inventory\` atau beli baru di \`/shop\`.`
            : `🔒 **Butuh ${toolStatus.toolName} Tier ${zone.minToolTier}+** untuk zona **${zone.name}**! Beli di \`/shop\` (*Toko Perkakas*).`;
    } else if (!toolStatus.tierOk) {
        statusNote = `🔒 **Tier Alat Kurang:** Zona ini butuh **${toolStatus.toolName} Tier ${zone.minToolTier}+** (saat ini Tier ${toolStatus.matchingTool.item.toolTier || 1}).`;
    } else if (lvInfo.level < Number(zone.minLevel || 1)) {
        statusNote = `🔒 **Level Gathering Kurang:** Butuh **Lv. ${zone.minLevel}** (kamu masih Lv. ${lvInfo.level}).`;
    }

    const cdLabel = remCd > 0
        ? `<t:${Math.floor((now + remCd) / 1000)}:R>`
        : '✅ **Siap!**';

    const blocks = [
        [
            `📊 **Kondisi:** ${formatVitalsCompact(p)} | 💰 **Tunai:** ${formatLp(p.cash)}`,
            `🪓 **Kapak:** ${axeTxt}`,
            `🏗️ **Sekop:** ${shovelTxt}`,
            `🎒 **Slot Tas:** \`${slotsUsed}/${maxSlots}\` · 🌲 **Gathering Lv. ${lvInfo.level}** (\`${renderBar(lvInfo.currentXp, lvInfo.requiredXp, 6)}\`)`
        ].join('\n'),
        [
            `### ${zone.emoji} Zona Terpilih: ${zone.name}`,
            `> ${zone.description}`,
            `• 🛠️ **Syarat:** ${toolStatus.toolName} Tier ${zone.minToolTier}+ · Min **Gathering Lv. ${zone.minLevel}**`,
            `• 📦 **Potensi Hasil:** ${dropPreview}`,
            `• ⚡ **Biaya Ekspedisi:** -${cost.energy} Energy · -${cost.hunger} Hunger · -${cost.thirst} Thirst *(Cooldown ${Math.round(cost.cooldownSec / 60)} menit)*`,
            `• ⏳ **Status Cooldown:** ${cdLabel}`
        ].join('\n'),
        statusNote
    ];

    return buildPanel({
        mod: 'gather',
        ownerId,
        accentColor: COLORS.ACT,
        title: '🌲 Hutan Kayu & Galian Material (/gather)',
        banner,
        blocks,
        rows: buildGatherRows(ownerId, state, now),
        footer: isPropertyUnderDevelopment()
            ? 'Kumpulkan Kayu Bulat, Bambu, Tanah Liat & Pasir. Fitur Workshop /property & /bangun sedang dalam pengembangan.'
            : 'Olah Kayu Bulat, Bambu, Tanah Liat & Pasir menjadi material konstruksi di /property (Menu Workshop) lalu bangun di /bangun!',
        now
    });
}

function buildGatherOutcomePanel(outcome, state, now = Date.now()) {
    const ownerId = state.player.discord_id;
    const dropLines = outcome.drops.map(d =>
        `• +${d.quantity}× ${d.item?.emoji || '📦'} **${d.item?.name || d.itemId}**`
    );

    const notes = [];
    if (outcome.tripVeh?.vehicle) {
        const v = outcome.tripVeh.vehicle;
        const fuelStr = outcome.tripVeh.fuelConsumed > 0 ? ` · ⛽ -${outcome.tripVeh.fuelConsumed}L` : '';
        notes.push(`🚘 **Perjalanan (${v.emoji} ${v.name}):** Hemat **⚡${outcome.tripVeh.energyDiscount} Energy** (+${outcome.tripVeh.kmAdded} km${fuelStr})`);
    }
    if (outcome.softCap && outcome.softCap.multiplier < 1) {
        notes.push(`📉 **Soft Cap Harian:** Kelelahan mengurangi hasil & XP menjadi **${Math.round(outcome.softCap.multiplier * 100)}%**.`);
    }
    if (outcome.leveledUp) {
        notes.push(`🎉 **LEVEL UP!** Skill Gathering kamu naik ke **Lv. ${outcome.newLvInfo.level}**!`);
    }
    if (outcome.remainingToolDur === 0) {
        notes.push(`🔧 **${outcome.tool.item.name} Rusak (Durability 0)!** Perbaiki lewat \`/inventory\`.`);
    }
    if (outcome.hospitalized) {
        notes.push(`🚑 **PINGSAN DI HUTAN!** Kamu dirawat di Rumah Sakit (Biaya: **${formatLp(outcome.hospitalized.totalPaid)}**).`);
    }
    if (outcome.eventReward?.completed) {
        notes.push(`🎊 **Misi Event Musiman Selesai!** Kamu mendapat progres event.`);
    }
    if (outcome.gachaTicketDrop?.awarded) {
        notes.push(`🎟️ **Bonus Gacha!** Kamu menemukan **1× Tiket Undian** di semak-semak!`);
    }

    const nextUnix = Math.floor((now + (outcome.cooldownSec || 240) * 1000) / 1000);
    const blocks = [
        [
            `📊 **Kondisi:** ${formatVitalsCompact(state.player)} | 🎒 **Tas:** \`${state.slotsUsed}/${Number(state.player.max_slots || 20)}\``,
            ...dropLines
        ].join('\n'),
        [
            `• ✨ **Gathering EXP:** +${outcome.gainedXp} EXP *(Lv. ${outcome.newLvInfo.level} — ${outcome.newLvInfo.currentXp}/${outcome.newLvInfo.requiredXp})*`,
            `• 🛠️ **Durability ${outcome.tool.item.name}:** \`${outcome.remainingToolDur}/${outcome.tool.item.maxDurability}\``,
            `• ⏳ **Ekspedisi Berikutnya:** Siap <t:${nextUnix}:R>`
        ].join('\n'),
        notes.length > 0 ? notes.join('\n') : null
    ];

    return buildPanel({
        mod: 'gather',
        ownerId,
        accentColor: COLORS.SUCCESS,
        title: `🌲 Hasil Ekspedisi di ${outcome.zone.name}`,
        banner: {
            type: 'success',
            text: `Berhasil mengumpulkan **${outcome.drops.reduce((s, d) => s + d.quantity, 0)} unit material bangunan mentah**!`
        },
        blocks,
        rows: buildGatherRows(ownerId, state, now),
        footer: 'Panel ini akan diperbarui otomatis setelah cooldown selesai.',
        now
    });
}

module.exports = {
    name: 'gather',
    slash: true,
    lockTtl: 15,
    data: new SlashCommandBuilder()
        .setName('gather')
        .setDescription('Hutan & Galian Material — tebang kayu, bambu, tanah liat & pasir di Lembah Hijau.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchGatherState(interaction.user.id, now);
        const payload = buildGatherPanel(state, null, now);
        const res = await interaction.reply(payload);
        scheduleGatherCooldown(interaction.user.id, interaction, state.remCd);
        return res;
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchGatherState(interaction.user.id, now);
                const payload = buildGatherPanel(state, null, now);
                const res = await interaction.update({ ...payload, attachments: [] });
                scheduleGatherCooldown(interaction.user.id, interaction, state.remCd);
                return res;
            },
            async act(interaction) {
                const now = Date.now();
                const outcome = await executeGatherAction(interaction.user.id, null, now);
                const state = await fetchGatherState(interaction.user.id, Date.now());
                if (!outcome.ok) {
                    const errPayload = buildGatherPanel(state, { type: 'warning', text: outcome.error }, Date.now());
                    const res = await interaction.update({ ...errPayload, attachments: [] });
                    scheduleGatherCooldown(interaction.user.id, interaction, state.remCd);
                    return res;
                }
                const okPayload = buildGatherOutcomePanel(outcome, state, Date.now());
                const res = await interaction.update({ ...okPayload, attachments: [] });
                scheduleGatherCooldown(interaction.user.id, interaction, state.remCd);
                return res;
            },
            async quick_meal(interaction) {
                const now = Date.now();
                const meal = await executeQuickMeal(interaction.user.id, now);
                const state = await fetchGatherState(interaction.user.id, now);
                const banner = meal.consumedSummary.length > 0
                    ? { type: 'success', text: `Makan cepat berhasil: **${meal.consumedSummary.join(', ')}**.` }
                    : { type: 'info', text: 'Tubuhmu sudah kenyang atau tidak ada makanan/minuman siap santap di tas.' };
                const payload = buildGatherPanel(state, banner, now);
                const res = await interaction.update({ ...payload, attachments: [] });
                scheduleGatherCooldown(interaction.user.id, interaction, state.remCd);
                return res;
            }
        },
        selects: {
            async zone(interaction) {
                const now = Date.now();
                const zoneId = interaction.values[0] || 'hutan_pinus';
                await selectGatherZone(interaction.user.id, zoneId, now);
                const state = await fetchGatherState(interaction.user.id, now);
                const payload = buildGatherPanel(state, null, now);
                const res = await interaction.update({ ...payload, attachments: [] });
                scheduleGatherCooldown(interaction.user.id, interaction, state.remCd);
                return res;
            }
        }
    },

    buildGatherPanel,
    buildGatherOutcomePanel
};
