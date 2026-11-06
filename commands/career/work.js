const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { getCooldownRemaining, setCooldown, incrementDailyAction } = require('../../database/redis');
const { syncPlayerVitals, checkActivityEligibility, deductActivityVitals } = require('../../services/vitalService');
const {
    isNewbieBoostActive,
    calculateIncomeTax,
    getSoftCapModifier,
    getLiveEconomyConfig,
    creditPlayerCash
} = require('../../services/economyService');
const { generateWorkMinigame, buildWorkMinigameRow } = require('../../services/minigameService');
const { applyShiftVehicleUsage, getEquippedVehicle } = require('../../services/vehicleService');
const { getActiveSeasonalEvent, awardEventActivityProgress } = require('../../services/eventService');
const { rollActivityBonusTicket } = require('../../services/gachaService');
const { executeQuickMeal } = require('../../services/consumptionService');
const { getJob, getRankForShifts, getNextRank } = require('../../data/jobs');
const { ACTIVITY_COSTS } = require('../../data/constants');
const { COLORS, formatLp, formatDuration, buildV2Card } = require('../../utils/uiBuilder');
const { buildPanel, btn } = require('../../utils/panelBuilder');

async function fetchWorkPrepState(discordId, now = Date.now()) {
    const remCd = await getCooldownRemaining(discordId, 'work', query);
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const p = synced.player;
        const job = p.current_job ? getJob(p.current_job) : null;
        let shiftsCompleted = 0;
        if (job) {
            const [jRows] = await conn.execute(
                `SELECT shifts_completed FROM player_job_history WHERE discord_id = ? AND job_id = ?`,
                [discordId, job.id]
            );
            if (jRows.length > 0) shiftsCompleted = Number(jRows[0].shifts_completed);
        }
        const equippedVehicle = await getEquippedVehicle(conn, discordId, false);
        const activeEvent = await getActiveSeasonalEvent(conn, now);

        const cost = job
            ? {
                energy: job.energyCost || ACTIVITY_COSTS.work_normal.energy,
                hunger: ACTIVITY_COSTS.work_normal.hunger,
                thirst: ACTIVITY_COSTS.work_normal.thirst,
                cooldownSec: ACTIVITY_COSTS.work_normal.cooldownSec
            }
            : ACTIVITY_COSTS.work_normal;

        const elig = checkActivityEligibility(p, cost, 'work', now);

        return {
            player: p,
            job,
            shiftsCompleted,
            equippedVehicle,
            activeEvent,
            cost,
            elig,
            remCd
        };
    });
}

function buildWorkPrepPanel(state, banner = null, now = Date.now()) {
    const { player: p, job, shiftsCompleted, equippedVehicle, activeEvent, cost, elig, remCd } = state;
    const ownerId = p.discord_id;
    const blocks = [];

    if (!job) {
        blocks.push(
            `💼 **Status Karir:** Kamu saat ini **belum memiliki pekerjaan**.\nKetik \`/job\` untuk melihat lowongan kerja dan melamar profesi pertamamu!`
        );
    } else {
        const rank = getRankForShifts(shiftsCompleted);
        const nextRank = getNextRank(shiftsCompleted);
        const basePay = Math.round(job.baseSalary * rank.multiplier);
        const thrInfo = activeEvent?.lebaranThr?.active ? ` · 🌙 **THR ×${activeEvent.lebaranThr.multiplier}**` : '';

        blocks.push(
            [
                `🏢 **Profesi Aktif:** ${job.emoji} **${job.name}** — Jabatan **${rank.name}** (×${rank.multiplier})`,
                `💵 **Estimasi Gaji Pokok:** **${formatLp(basePay)} / shift**${thrInfo}`,
                `📈 **Pengalaman:** **${shiftsCompleted} shift**${nextRank ? ` *(Menuju ${nextRank.name}: ${shiftsCompleted}/${nextRank.minShifts})*` : ' *(Jabatan Puncak)*'}`,
                `⚡ **Biaya Vital Shift:** **-${cost.energy} Energy · -${cost.hunger} Hunger · -${cost.thirst} Thirst**`
            ].join('\n')
        );

        if (equippedVehicle?.vehicle) {
            const v = equippedVehicle.vehicle;
            const fuelStr = v.tankCapacity > 0 ? ` · ⛽ ${equippedVehicle.fuel_liters.toFixed(1)}L` : '';
            blocks.push(`🚘 **Kendaraan Kerja:** ${v.emoji} **${v.name}** (${equippedVehicle.odometer_km.toFixed(0)} km${fuelStr})`);
        }

        if (remCd > 0) {
            const readyUnix = Math.floor((now + remCd) / 1000);
            blocks.push(`⏳ **Status Shift:** Istirahat kerja — siap kembali **<t:${readyUnix}:R>** (${formatDuration(remCd)}).`);
        } else if (!elig.allowed) {
            blocks.push(`⚠️ **Belum Siap Bekerja:** ${elig.message}`);
        } else {
            blocks.push(`✅ **Status Shift:** Siap memulai shift kerja! Selesaikan mini-game dalam 30 detik untuk **Bonus Gaji +10%**.`);
        }
    }

    const canStart = Boolean(job && remCd <= 0 && elig.allowed);

    const row = new ActionRowBuilder().addComponents(
        btn('work', 'start', ownerId, {
            label: remCd > 0 ? 'Sedang Istirahat' : 'Mulai Shift Kerja',
            emoji: '▶️',
            style: ButtonStyle.Success,
            disabled: !canStart
        }, now),
        btn('work', 'quick_meal', ownerId, {
            label: 'Makan Cepat',
            emoji: '🍴',
            style: ButtonStyle.Primary
        }, now),
        btn('work', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary
        }, now)
    );

    return buildPanel({
        mod: 'work',
        ownerId,
        accentColor: COLORS.CAREER,
        title: `💼 Persiapan Shift Kerja`,
        player: p,
        banner,
        blocks,
        rows: [row],
        footer: 'Cooldown shift kerja adalah 60 menit.',
        now
    });
}

async function runWorkShift(interaction, now = Date.now()) {
    const discordId = interaction.user.id;
    const remCd = await getCooldownRemaining(discordId, 'work', query);
    if (remCd > 0) {
        const state = await fetchWorkPrepState(discordId, now);
        const payload = buildWorkPrepPanel(state, {
            type: 'warning',
            text: `Kamu masih dalam waktu istirahat shift! Siap bekerja kembali <t:${Math.floor((now + remCd) / 1000)}:R>.`
        }, now);
        return interaction.isMessageComponent() ? await interaction.update(payload) : await interaction.reply(payload);
    }

    const preCheck = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;

        if (!p.current_job) return { error: 'NO_JOB' };
        const job = getJob(p.current_job);
        if (!job) return { error: 'NO_JOB' };

        const cost = {
            energy: job.energyCost || ACTIVITY_COSTS.work_normal.energy,
            hunger: ACTIVITY_COSTS.work_normal.hunger,
            thirst: ACTIVITY_COSTS.work_normal.thirst,
            cooldownSec: ACTIVITY_COSTS.work_normal.cooldownSec
        };

        const elig = checkActivityEligibility(p, cost, 'work', now);
        if (!elig.allowed) {
            return { error: 'INELIGIBLE', elig };
        }

        await setCooldown(
            discordId,
            'work',
            cost.cooldownSec,
            (sql, params) => conn.execute(sql, params)
        );

        return { player: p, job, cost, elig };
    });

    if (preCheck.error) {
        const state = await fetchWorkPrepState(discordId, now);
        const msg = preCheck.error === 'NO_JOB'
            ? 'Kamu belum memiliki pekerjaan! Gunakan `/job` untuk melamar.'
            : preCheck.elig.message;
        const payload = buildWorkPrepPanel(state, { type: 'danger', text: msg }, now);
        return interaction.isMessageComponent() ? await interaction.update(payload) : await interaction.reply(payload);
    }

    const { job, cost, elig } = preCheck;
    const minigame = generateWorkMinigame(job.minigameType);
    const nonce = `${discordId.slice(-4)}_${Date.now().toString(36)}`;
    const mgRow = buildWorkMinigameRow(nonce, minigame.options);

    const mgPayload = buildV2Card({
        accentColor: COLORS.CAREER,
        title: `${job.emoji} Shift Kerja: ${job.name}`,
        blocks: [
            minigame.prompt,
            '⏱️ Pilih jawaban yang benar dalam **30 detik** untuk mendapatkan **100% Gaji + Bonus 10%**!'
        ],
        actionRows: [mgRow]
    });

    let replyMsg;
    if (interaction.isMessageComponent()) {
        await interaction.update(mgPayload);
        replyMsg = interaction.message;
    } else {
        await interaction.reply(mgPayload);
        replyMsg = await interaction.fetchReply();
    }

    let chosenIndex = null;
    try {
        const btnInt = await replyMsg.awaitMessageComponent({
            filter: i => i.user.id === discordId && i.customId.startsWith(`work_mg_${nonce}_`),
            time: 30000
        });
        await btnInt.deferUpdate();
        const parts = btnInt.customId.split('_');
        chosenIndex = Number(parts[parts.length - 1]);
    } catch {
        chosenIndex = null;
    }

    const isCorrect = chosenIndex !== null && Boolean(minigame.options[chosenIndex]?.isCorrect);
    const correctOption = minigame.options.find(o => o.isCorrect);

    const finishNow = Date.now();
    const dailyWorkCount = await incrementDailyAction(discordId, 'work', finishNow);

    const outcome = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, finishNow, true);
        const p = synced.player;
        const liveCfg = await getLiveEconomyConfig(conn);

        const [jRows] = await conn.execute(
            `SELECT shifts_completed FROM player_job_history WHERE discord_id = ? AND job_id = ? FOR UPDATE`,
            [discordId, job.id]
        );
        const oldShifts = jRows.length > 0 ? Number(jRows[0].shifts_completed) : 0;
        const oldRank = getRankForShifts(oldShifts);

        const newbieActive = isNewbieBoostActive(p, finishNow);
        const shiftGain = (newbieActive && (oldShifts % 2 === 1)) ? 2 : 1;
        const newShifts = oldShifts + shiftGain;
        const newRank = getRankForShifts(newShifts);
        const promoted = newRank.id !== oldRank.id;

        const minigameMult = isCorrect ? 1.10 : 0.70;
        const softCap = getSoftCapModifier('work', dailyWorkCount, liveCfg.soft_cap_enabled);
        const adminSalaryMult = Number(liveCfg.salary_multiplier || 1.0);
        const vehicleRes = await applyShiftVehicleUsage(conn, discordId, job.id);
        const vehicleMult = 1 + Number(vehicleRes.bonusMultiplier || 0);

        const activeEvent = await getActiveSeasonalEvent(conn, finishNow);
        const lebaranThrMult = activeEvent?.lebaranThr?.active ? Number(activeEvent.lebaranThr.multiplier || 1.5) : 1.0;

        const grossSalary = Math.round(
            job.baseSalary *
            lebaranThrMult *
            oldRank.multiplier *
            minigameMult *
            vehicleMult *
            elig.yieldMultiplier *
            softCap.multiplier *
            adminSalaryMult
        );

        const taxInfo = calculateIncomeTax(grossSalary, p, finishNow, liveCfg.income_tax_enabled);
        const netSalary = Math.max(1000, grossSalary - taxInfo.tax);

        const hospitalized = deductActivityVitals(p, cost, 0, finishNow);

        p.total_shifts = Number(p.total_shifts || 0) + 1;

        await conn.execute(
            `INSERT INTO player_job_history (discord_id, job_id, shifts_completed)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE shifts_completed = ?`,
            [discordId, job.id, newShifts, newShifts]
        );

        await conn.execute(
            `UPDATE players
             SET energy = ?, hunger = ?, thirst = ?, health = ?,
                 cash = ?, bank = ?, hospital_until = ?, sleeping_until = ?,
                 total_shifts = ?
             WHERE discord_id = ?`,
            [
                p.energy, p.hunger, p.thirst, p.health,
                p.cash, p.bank, p.hospital_until, p.sleeping_until,
                p.total_shifts, discordId
            ]
        );

        await creditPlayerCash(conn, p, netSalary, `work_${job.id}`, {
            grossSalary,
            tax: taxInfo.tax,
            isCorrect,
            rank: oldRank.id,
            dailyWorkCount,
            lebaranThrMult
        }, finishNow);

        const eventReward = await awardEventActivityProgress(conn, discordId, 'work', finishNow);
        const gachaTicketDrop = await rollActivityBonusTicket(
            conn,
            discordId,
            'work',
            { jobTier: job.tier || 1, maxSlots: p.max_slots },
            finishNow
        );

        return {
            player: p,
            oldRank,
            newRank,
            promoted,
            newShifts,
            shiftGain,
            newbieActive,
            grossSalary,
            taxInfo,
            netSalary,
            softCap,
            vehicleRes,
            lebaranThrActive: Boolean(activeEvent?.lebaranThr?.active),
            lebaranThrMult,
            eventReward,
            gachaTicketDrop,
            hospitalized
        };
    });

    const nextRank = getNextRank(outcome.newShifts);
    const notes = [];
    if (outcome.vehicleRes?.active && outcome.vehicleRes.bonusMultiplier > 0) {
        const v = outcome.vehicleRes.vehicle;
        const srvWarn = outcome.vehicleRes.overdue ? ' · ⚠️ *Telat Servis (-50% bonus)*' : '';
        const fuelInfo = outcome.vehicleRes.fuelConsumed > 0 ? ` · ⛽ -${outcome.vehicleRes.fuelConsumed}L` : '';
        notes.push(`🚘 **Bonus Kendaraan (${v.emoji} ${v.name}):** **+${Math.round(outcome.vehicleRes.bonusMultiplier * 100)}% Gaji** (+${outcome.vehicleRes.kmAdded} km${fuelInfo}${srvWarn})`);
    } else if (outcome.vehicleRes?.brokeDown) {
        notes.push(`🚨 **Kendaraan Mogok!** **${outcome.vehicleRes.vehicle.name}** mogok di jalan karena terlambat diservis (bonus gaji hangus). Segera gunakan \`/vehicle\`!`);
    } else if (outcome.vehicleRes?.reason === 'NO_FUEL') {
        notes.push(`⛽ **Bensin Habis!** Tangki **${outcome.vehicleRes.vehicle.name}** kosong sehingga bonus gaji tidak aktif. Isi bensin di \`/vehicle\`!`);
    }
    if (outcome.lebaranThrActive) {
        notes.push(`🌙 **THR Lebaran Aktif (1–3 Syawal):** Gaji dasar shift ini dikalikan **×${outcome.lebaranThrMult}**!`);
    }
    if (outcome.eventReward) {
        notes.push(`${outcome.eventReward.eventConfig.emoji} **${outcome.eventReward.eventConfig.name}:** **+${outcome.eventReward.tokensAdded} ${outcome.eventReward.tokenEmoji} ${outcome.eventReward.tokenName}** (+1 Progres Komunitas)`);
    }
    if (outcome.gachaTicketDrop?.dropped) {
        notes.push(`🎰 **Bonus Hoki Gacha:** Kamu menemukan **+1× ${outcome.gachaTicketDrop.item.emoji} ${outcome.gachaTicketDrop.item.name}**! (Gunakan di \`/gacha\`)`);
    }
    if (outcome.newbieActive) {
        notes.push(`🌱 **Newbie Boost Aktif:** Bebas pajak penghasilan & progres pengalaman kerja ×1,5 (+${outcome.shiftGain} poin shift)!`);
    }
    if (elig.penalties.length > 0) {
        notes.push(`⚠️ **Penalti Kondisi Tubuh:** ${elig.penalties.join(', ')}`);
    }
    if (outcome.softCap.isCapped) {
        notes.push(`📉 **Soft Cap Harian (Shift ke-${dailyWorkCount}):** Tubuhmu mulai lelah bekerja lembur hari ini (Hasil ×${outcome.softCap.multiplier}).`);
    }
    if (outcome.promoted) {
        notes.push(`🎊 **PROMOSI JABATAN!** Selamat, kamu naik jabatan dari **${outcome.oldRank.name}** menjadi **${outcome.newRank.name}** (Gaji ×${outcome.newRank.multiplier})!`);
    }
    if (outcome.hospitalized) {
        notes.push(`🚑 **PINGSAN!** Karena terlalu memaksakan diri, kamu dilarikan ke Rumah Sakit (Biaya perawatan: **${formatLp(outcome.hospitalized.totalPaid)}**).`);
    }

    const headerResult = isCorrect
        ? `Kerja Bagus! Jawabanmu tepat (**${correctOption?.label || ''}**) — Gaji Penuh + Bonus 10%!`
        : chosenIndex === null
            ? `Waktu Habis! Jawaban yang tepat adalah **${correctOption?.label || ''}** — Kamu tetap menerima 70% gaji.`
            : `Kurang Tepat! Jawaban yang benar adalah **${correctOption?.label || ''}** — Kamu tetap menerima 70% gaji.`;

    const nextShiftUnix = Math.floor((now + cost.cooldownSec * 1000) / 1000);
    const resultRow = new ActionRowBuilder().addComponents(
        btn('work', 'home', discordId, {
            label: 'Panel Kerja',
            emoji: '🔁',
            style: ButtonStyle.Primary
        }, finishNow),
        btn('work', 'quick_meal', discordId, {
            label: 'Makan Cepat',
            emoji: '🍴',
            style: ButtonStyle.Success
        }, finishNow)
    );

    const resultPanel = buildPanel({
        mod: 'work',
        ownerId: discordId,
        accentColor: isCorrect ? COLORS.SUCCESS : COLORS.WARNING,
        title: `${job.emoji} Slip Gaji Shift: ${job.name} (${outcome.oldRank.name})`,
        player: outcome.player,
        banner: { type: isCorrect ? 'success' : 'warning', text: headerResult },
        blocks: [
            [
                `• 💰 **Gaji Kotor:** ${formatLp(outcome.grossSalary)}`,
                `• 🏛️ **Pajak Penghasilan (${Math.round(outcome.taxInfo.rate * 100)}%):** -${formatLp(outcome.taxInfo.tax)}${outcome.taxInfo.newbieExempt ? ' *(Bebas Pajak Warga Baru)*' : ''}`,
                `• 💵 **Gaji Bersih Diterima:** **+${formatLp(outcome.netSalary)}**`,
                `• 📈 **Pengalaman Profesi:** **${outcome.newShifts} shift**${nextRank ? ` *(Menuju ${nextRank.name}: ${outcome.newShifts}/${nextRank.minShifts})*` : ' *(Jabatan Puncak)*'}`,
                `• ⏳ **Shift Berikutnya:** Siap **<t:${nextShiftUnix}:R>**`
            ].join('\n'),
            notes.length > 0 ? notes.join('\n') : null
        ],
        rows: [resultRow],
        footer: 'Gunakan tombol Makan Cepat untuk memulihkan Hunger & Thirst usai bekerja.',
        now: finishNow
    });

    await interaction.editReply(resultPanel);
}

module.exports = {
    name: 'work',
    slash: true,
    lockTtl: 45,
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Buka panel shift kerja, selesaikan mini-game profesi, dan terima gaji!'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchWorkPrepState(interaction.user.id, now);
        return await interaction.reply(buildWorkPrepPanel(state, null, now));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchWorkPrepState(interaction.user.id, now);
                return await interaction.update(buildWorkPrepPanel(state, null, now));
            },
            async start(interaction) {
                return await runWorkShift(interaction, Date.now());
            },
            async quick_meal(interaction) {
                const now = Date.now();
                const meal = await executeQuickMeal(interaction.user.id, now);
                const state = await fetchWorkPrepState(interaction.user.id, now);
                const banner = meal.consumedSummary.length > 0
                    ? { type: 'success', text: `Makan cepat berhasil: mengonsumsi **${meal.consumedSummary.join(', ')}**.` }
                    : { type: 'info', text: 'Kondisi tubuhmu sudah kenyang atau tidak ada makanan/minuman di tas.' };
                return await interaction.update(buildWorkPrepPanel(state, banner, now));
            }
        }
    }
};
