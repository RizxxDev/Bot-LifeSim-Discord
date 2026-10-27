const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
const { applyShiftVehicleUsage } = require('../../services/vehicleService');
const { getActiveSeasonalEvent, awardEventActivityProgress } = require('../../services/eventService');
const { getJob, getRankForShifts, getNextRank } = require('../../data/jobs');
const { ACTIVITY_COSTS } = require('../../data/constants');
const { COLORS, formatLp, formatDuration, formatVitalsCompact, buildV2Card } = require('../../utils/uiBuilder');

module.exports = {
    name: 'work',
    slash: true,
    lockTtl: 45,
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Jalani 1 shift pekerjaanmu, selesaikan mini-game kerja, dan terima gaji!'),

    async executeSlash(interaction) {
        const discordId = interaction.user.id;
        const now = Date.now();

        const remCd = await getCooldownRemaining(discordId, 'work', query);
        if (remCd > 0) {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '⏳ Istirahat Shift Kerja',
                    blocks: [
                        `Kamu baru saja menyelesaikan shift kerja. Kamu bisa kembali bekerja dalam **${formatDuration(remCd)}** (<t:${Math.floor((now + remCd) / 1000)}:R>).`
                    ],
                    ephemeral: true
                })
            );
        }

        // Cek pekerjaan & stat vital sebelum memulai mini-game
        const preCheck = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, true);
            const p = synced.player;

            if (!p.current_job) {
                return { error: 'NO_JOB' };
            }

            const job = getJob(p.current_job);
            if (!job) {
                return { error: 'NO_JOB' };
            }

            const cost = {
                energy: job.energyCost || ACTIVITY_COSTS.work_normal.energy,
                hunger: ACTIVITY_COSTS.work_normal.hunger,
                thirst: ACTIVITY_COSTS.work_normal.thirst,
                cooldownSec: ACTIVITY_COSTS.work_normal.cooldownSec
            };

            const elig = checkActivityEligibility(p, cost, 'work', now);
            if (!elig.allowed) {
                return { error: 'INELIGIBLE', elig, player: p };
            }

            // Kunci cooldown di awal agar tidak bisa di-spam sebelum mini-game selesai
            await setCooldown(
                discordId,
                'work',
                cost.cooldownSec,
                (sql, params) => conn.execute(sql, params)
            );

            return { player: p, job, cost, elig };
        });

        if (preCheck.error === 'NO_JOB') {
            const jobRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('job_quick_list')
                    .setLabel('Lihat Lowongan Kerja (/job list)')
                    .setEmoji('💼')
                    .setStyle(ButtonStyle.Primary)
            );
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '💼 Kamu Belum Memiliki Pekerjaan!',
                    blocks: [
                        'Lamar pekerjaan pertamamu terlebih dahulu sebelum menggunakan `/work`.',
                        'Tersedia pekerjaan Tier 0 (Tukang Parkir, Petugas Kebersihan, Kuli Panggul) tanpa syarat ijazah!'
                    ],
                    actionRows: [jobRow],
                    ephemeral: true
                })
            );
        }

        if (preCheck.error === 'INELIGIBLE') {
            const quickRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('shop_jump_warung')
                    .setLabel('Beli Makan/Minum di Warung')
                    .setEmoji('🏪')
                    .setStyle(ButtonStyle.Secondary)
            );
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '⚠️ Tidak Dapat Memulai Shift Kerja',
                    blocks: [
                        preCheck.elig.message,
                        formatVitalsCompact(preCheck.player)
                    ],
                    actionRows: [quickRow],
                    ephemeral: true
                })
            );
        }

        const { job, cost, elig } = preCheck;
        const minigame = generateWorkMinigame(job.minigameType);
        const nonce = `${discordId.slice(-4)}_${Date.now().toString(36)}`;
        const mgRow = buildWorkMinigameRow(nonce, minigame.options);

        await interaction.reply(
            buildV2Card({
                accentColor: COLORS.CAREER,
                title: `${job.emoji} Shift Kerja: ${job.name}`,
                blocks: [
                    minigame.prompt,
                    '⏱️ Pilih jawaban yang benar dalam **30 detik** untuk mendapatkan **100% Gaji + Bonus 10%**!'
                ],
                actionRows: [mgRow]
            })
        );
        const replyMsg = await interaction.fetchReply();

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

        // Hitung hasil shift & simpan ke DB
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

            // Newbie boost memberikan +50% progres pengalaman shift (tiap shift genap dapat +1 ekstra shift pengalaman)
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
            notes.push(`🚨 **Kendaraan Mogok!** **${outcome.vehicleRes.vehicle.name}** mogok di jalan karena terlambat diservis (bonus gaji hangus). Segera gunakan \`/vehicle service\`!`);
        } else if (outcome.vehicleRes?.reason === 'NO_FUEL') {
            notes.push(`⛽ **Bensin Habis!** Tangki **${outcome.vehicleRes.vehicle.name}** kosong sehingga bonus gaji tidak aktif. Isi bensin di \`/vehicle refuel\`!`);
        }
        if (outcome.lebaranThrActive) {
            notes.push(`🌙 **THR Lebaran Aktif (1–3 Syawal):** Gaji dasar shift ini dikalikan **×${outcome.lebaranThrMult}**!`);
        }
        if (outcome.eventReward) {
            notes.push(`${outcome.eventReward.eventConfig.emoji} **${outcome.eventReward.eventConfig.name}:** **+${outcome.eventReward.tokensAdded} ${outcome.eventReward.tokenEmoji} ${outcome.eventReward.tokenName}** (+1 Progres Komunitas)`);
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
            ? `✅ **Kerja Bagus!** Jawabanmu tepat (**${correctOption?.label || ''}**) — Gaji Penuh + Bonus 10%!`
            : chosenIndex === null
                ? `⌛ **Waktu Habis!** Jawaban yang tepat adalah **${correctOption?.label || ''}** — Kamu tetap menerima 70% gaji.`
                : `❌ **Kurang Tepat!** Jawaban yang benar adalah **${correctOption?.label || ''}** — Kamu tetap menerima 70% gaji.`;

        await interaction.editReply(
            buildV2Card({
                accentColor: isCorrect ? COLORS.SUCCESS : COLORS.WARNING,
                title: `${job.emoji} Slip Gaji Shift: ${job.name} (${outcome.oldRank.name})`,
                blocks: [
                    headerResult,
                    [
                        `• 💰 **Gaji Kotor:** ${formatLp(outcome.grossSalary)}`,
                        `• 🏛️ **Pajak Penghasilan (${Math.round(outcome.taxInfo.rate * 100)}%):** -${formatLp(outcome.taxInfo.tax)}${outcome.taxInfo.newbieExempt ? ' *(Bebas Pajak Warga Baru)*' : ''}`,
                        `• 💵 **Gaji Bersih Diterima:** **+${formatLp(outcome.netSalary)}** *(Saldo Cash: ${formatLp(outcome.player.cash)})*`,
                        `• 📈 **Pengalaman Profesi:** **${outcome.newShifts} shift**${nextRank ? ` *(Menuju ${nextRank.name}: ${outcome.newShifts}/${nextRank.minShifts})*` : ' *(Jabatan Puncak)*'}`
                    ].join('\n'),
                    `📊 **Kondisi Usai Shift:** ${formatVitalsCompact(outcome.player)}`,
                    notes.length > 0 ? notes.join('\n') : null
                ],
                footer: 'Shift berikutnya tersedia dalam 60 menit.'
            })
        );
    }
};
