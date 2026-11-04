const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerInventory } = require('../../services/inventoryService');
const { JOBS, PROMOTION_RANKS, getJob, getRankForShifts, getNextRank } = require('../../data/jobs');
const { meetsEducationRequirement, getEducation } = require('../../data/education');
const { getItem } = require('../../data/items');
const { getVehicle } = require('../../data/vehicles');
const { COLORS, formatLp, formatDuration } = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select,
    confirmView
} = require('../../utils/panelBuilder');

const RESIGN_COOLDOWN_MS = 24 * 3600 * 1000;

async function fetchJobState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const [vehRows] = await conn.execute(
            `SELECT vehicle_id FROM player_vehicles WHERE discord_id = ?`,
            [discordId]
        );
        const [histRows] = await conn.execute(
            `SELECT job_id, shifts_completed FROM player_job_history WHERE discord_id = ?`,
            [discordId]
        );
        return {
            player: synced.player,
            invRows,
            vehIds: vehRows.map(v => v.vehicle_id),
            historyMap: new Map(histRows.map(r => [r.job_id, Number(r.shifts_completed)]))
        };
    });
}

function checkJobUnlockStatus(state, job) {
    const { player: p, invRows, vehIds, historyMap } = state;
    const ownedItems = new Set(invRows.filter(r => Number(r.quantity) > 0).map(r => r.item_id));
    const ownedVehicles = new Set(vehIds);

    const eduOk = meetsEducationRequirement(p.education_level, job.reqEducation);
    const itemOk = !job.reqItem || ownedItems.has(job.reqItem);
    const vehOk = !job.reqVehicle || ownedVehicles.has(job.reqVehicle);
    const shiftsOk = p.total_shifts >= (job.reqTotalShifts || 0);
    const histOk = !job.reqJobHistory || (historyMap.get(job.reqJobHistory.jobId) || 0) >= job.reqJobHistory.shifts;

    const reqParts = [];
    if (job.reqEducation) reqParts.push(`Ijazah ${job.reqEducation}`);
    if (job.reqItem) {
        const it = getItem(job.reqItem);
        reqParts.push(it ? it.name : job.reqItem);
    }
    if (job.reqVehicle) {
        const v = getVehicle(job.reqVehicle);
        reqParts.push(v ? v.name : job.reqVehicle);
    }
    if (job.reqTotalShifts) reqParts.push(`${job.reqTotalShifts} Total Shift`);
    if (job.reqJobHistory) reqParts.push(`Perawat ${job.reqJobHistory.shifts} Shift`);

    return {
        unlocked: eduOk && itemOk && vehOk && shiftsOk && histOk,
        eduOk,
        itemOk,
        vehOk,
        shiftsOk,
        histOk,
        reqSummary: reqParts.length > 0 ? reqParts.join(' + ') : 'Tanpa Syarat'
    };
}

function buildJobPanel({
    state,
    selectedJobId = null,
    banner = null,
    now = Date.now()
}) {
    const { player: p, historyMap } = state;
    const ownerId = p.discord_id;
    const currentJob = p.current_job ? getJob(p.current_job) : null;
    const activeJob = selectedJobId ? getJob(selectedJobId) : null;

    const blocks = [];

    if (currentJob) {
        const myShifts = historyMap.get(currentJob.id) || 0;
        const myRank = getRankForShifts(myShifts);
        const nextRank = getNextRank(myShifts);
        blocks.push(
            `👔 **Pekerjaan Aktif:** ${currentJob.emoji} **${currentJob.name}** — Jabatan **${myRank.name}** (${myShifts} shift${nextRank ? `, menuju ${nextRank.name} di ${nextRank.minShifts} shift` : ', Jabatan Puncak'})`
        );
    } else {
        const resignedAt = Number(p.job_resigned_at || 0);
        const remResign = resignedAt > 0 ? Math.max(0, RESIGN_COOLDOWN_MS - (now - resignedAt)) : 0;
        const cdNote = remResign > 0
            ? `\n⏳ *Masa tunggu pasca resign: dapat melamar lagi <t:${Math.floor((now + remResign) / 1000)}:R> (${formatDuration(remResign)}).*`
            : '';
        blocks.push(
            `👔 **Pekerjaan Aktif:** *Pengangguran* · Pilih profesi di dropdown bawah untuk melamar!${cdNote}`
        );
    }

    if (activeJob) {
        const status = checkJobUnlockStatus(state, activeJob);
        const myShifts = historyMap.get(activeJob.id) || 0;
        const myRank = getRankForShifts(myShifts);

        const rankTable = PROMOTION_RANKS.map(r => {
            const sal = Math.round(activeJob.baseSalary * r.multiplier);
            const mark = r.id === myRank.id ? ' 👈 **(Jabatanmu)**' : '';
            return `• **${r.name}** (≥ ${r.minShifts} shift): **${formatLp(sal)}/shift** *(Bonus Mini-Game: ${formatLp(Math.round(sal * 1.1))})*${mark}`;
        }).join('\n');

        const reqLines = [
            `${status.eduOk ? '✅' : '❌'} Pendidikan: **${activeJob.reqEducation ? getEducation(activeJob.reqEducation).name : 'Tidak ada'}**`
        ];
        if (activeJob.reqItem) {
            const it = getItem(activeJob.reqItem);
            reqLines.push(`${status.itemOk ? '✅' : '❌'} Item Wajib: **${it ? `${it.emoji} ${it.name}` : activeJob.reqItem}**`);
        }
        if (activeJob.reqVehicle) {
            const v = getVehicle(activeJob.reqVehicle);
            reqLines.push(`${status.vehOk ? '✅' : '❌'} Kendaraan Wajib: **${v ? `${v.emoji} ${v.name}` : activeJob.reqVehicle}**`);
        }
        if (activeJob.reqTotalShifts) {
            reqLines.push(`${status.shiftsOk ? '✅' : '❌'} Total Pengalaman: **${p.total_shifts}/${activeJob.reqTotalShifts} shift**`);
        }
        if (activeJob.reqJobHistory) {
            const done = historyMap.get(activeJob.reqJobHistory.jobId) || 0;
            reqLines.push(`${status.histOk ? '✅' : '❌'} Riwayat Medis: **Perawat ${done}/${activeJob.reqJobHistory.shifts} shift**`);
        }

        blocks.push(
            [
                `📋 **Detail Profesi: ${activeJob.emoji} ${activeJob.name} (Tier ${activeJob.tier})**`,
                `_${activeJob.description}_`,
                `• ⚡ Biaya per Shift: **${activeJob.energyCost} Energy · 8 Hunger · 10 Thirst**`,
                `• 📊 Riwayatmu di Profesi Ini: **${myShifts} shift (${myRank.name})**`
            ].join('\n'),
            `**🔎 Syarat Melamar:**\n${reqLines.join('\n')}`,
            `**📈 Tabel Gaji Pokok per Jabatan:**\n${rankTable}`
        );
    } else {
        const tierGroups = [0, 1, 2, 3, 4].map(tier => {
            const tierJobs = JOBS.filter(j => j.tier === tier);
            const lines = tierJobs.map(j => {
                const st = checkJobUnlockStatus(state, j);
                const myShifts = historyMap.get(j.id) || 0;
                const rank = getRankForShifts(myShifts);
                const isCur = p.current_job === j.id ? ' 👈' : '';
                return `${st.unlocked ? '✅' : '🔒'} ${j.emoji} **${j.name}** — **${formatLp(j.baseSalary)}/shift** · *${st.reqSummary}* (${myShifts} shift · ${rank.name})${isCur}`;
            });
            return `**🏢 Tier ${tier}**\n${lines.join('\n')}`;
        });
        blocks.push(...tierGroups);
    }

    // Row 1: Dropdown Pilih Profesi
    const rows = [
        select('job', 'pick', ownerId, {
            placeholder: '💼 Pilih profesi untuk melihat detail & melamar...',
            options: JOBS.map(j => {
                const st = checkJobUnlockStatus(state, j);
                return {
                    label: `${j.name} (Tier ${j.tier} — ${formatLp(j.baseSalary)}/shift)`,
                    value: j.id,
                    emoji: st.unlocked ? j.emoji : '🔒',
                    description: `Syarat: ${st.reqSummary}`.slice(0, 95),
                    default: activeJob ? activeJob.id === j.id : false
                };
            })
        }, now)
    ];

    // Row 2: Tombol Aksi
    const btnComponents = [];
    if (activeJob) {
        const st = checkJobUnlockStatus(state, activeJob);
        const canApply = !p.current_job && st.unlocked;
        btnComponents.push(
            btn('job', 'apply', ownerId, {
                label: p.current_job === activeJob.id
                    ? 'Pekerjaanmu Saat Ini'
                    : p.current_job
                        ? 'Resign Dulu untuk Pindah'
                        : `Lamar: ${activeJob.name}`,
                emoji: '📝',
                style: ButtonStyle.Success,
                arg: activeJob.id,
                disabled: !canApply
            }, now),
            btn('job', 'home', ownerId, {
                label: 'Semua Lowongan',
                emoji: '📋',
                style: ButtonStyle.Secondary
            }, now)
        );
    }

    if (currentJob) {
        btnComponents.push(
            btn('job', 'resign_prompt', ownerId, {
                label: `Resign dari ${currentJob.name}`,
                emoji: '🚪',
                style: ButtonStyle.Danger
            }, now)
        );
    }

    btnComponents.push(
        btn('job', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary
        }, now)
    );

    rows.push(new ActionRowBuilder().addComponents(btnComponents.slice(0, 5)));

    return buildPanel({
        mod: 'job',
        ownerId,
        accentColor: COLORS.CAREER,
        title: `💼 Bursa Karir & Lowongan Kerja`,
        player: p,
        banner,
        blocks,
        rows,
        footer: 'Riwayat jumlah shift dan jabatanmu di setiap profesi selalu tersimpan permanen.',
        now
    });
}

async function buildJobListPayload(discordId, _ephemeral = false, now = Date.now()) {
    const state = await fetchJobState(discordId, now);
    return buildJobPanel({ state, now });
}

async function executeJobApply(discordId, jobId, now = Date.now()) {
    const job = getJob(jobId);
    if (!job) return { error: 'INVALID_JOB' };

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;

        if (p.current_job) {
            return { error: 'ALREADY_EMPLOYED', currentJob: getJob(p.current_job) };
        }

        const resignedAt = Number(p.job_resigned_at || 0);
        if (resignedAt > 0 && (now - resignedAt) < RESIGN_COOLDOWN_MS) {
            return { error: 'RESIGN_COOLDOWN', remMs: RESIGN_COOLDOWN_MS - (now - resignedAt) };
        }

        if (!meetsEducationRequirement(p.education_level, job.reqEducation)) {
            return { error: 'REQ_EDU', reqEdu: job.reqEducation };
        }

        if (job.reqItem) {
            const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
            const hasItem = invRows.some(r => r.item_id === job.reqItem && Number(r.quantity) > 0);
            if (!hasItem) {
                return { error: 'REQ_ITEM', reqItem: getItem(job.reqItem) };
            }
        }

        if (job.reqVehicle) {
            const [vRows] = await conn.execute(
                `SELECT id FROM player_vehicles WHERE discord_id = ? AND vehicle_id = ? LIMIT 1`,
                [discordId, job.reqVehicle]
            );
            if (vRows.length === 0) {
                return { error: 'REQ_VEHICLE', reqVehicle: getVehicle(job.reqVehicle) };
            }
        }

        if (job.reqTotalShifts && p.total_shifts < job.reqTotalShifts) {
            return { error: 'REQ_SHIFTS', req: job.reqTotalShifts };
        }

        if (job.reqJobHistory) {
            const [hRows] = await conn.execute(
                `SELECT shifts_completed FROM player_job_history WHERE discord_id = ? AND job_id = ?`,
                [discordId, job.reqJobHistory.jobId]
            );
            const done = hRows.length > 0 ? Number(hRows[0].shifts_completed) : 0;
            if (done < job.reqJobHistory.shifts) {
                return { error: 'REQ_HISTORY', req: job.reqJobHistory.shifts };
            }
        }

        await conn.execute(
            `UPDATE players SET current_job = ? WHERE discord_id = ?`,
            [job.id, discordId]
        );
        await conn.execute(
            `INSERT IGNORE INTO player_job_history (discord_id, job_id, shifts_completed) VALUES (?, ?, 0)`,
            [discordId, job.id]
        );

        return { ok: true, job };
    });
}

module.exports = {
    name: 'job',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('job')
        .setDescription('Buka bursa karir interaktif: lihat daftar lowongan kerja, detail gaji, lamar, atau resign.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchJobState(interaction.user.id, now);
        return await interaction.reply(buildJobPanel({ state, now }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchJobState(interaction.user.id, now);
                return await interaction.update(buildJobPanel({ state, now }));
            },
            async apply(interaction, parsed) {
                const now = Date.now();
                const jobId = parsed.arg || '';
                const res = await executeJobApply(interaction.user.id, jobId, now);
                const state = await fetchJobState(interaction.user.id, now);

                let banner = null;
                if (!res.ok) {
                    if (res.error === 'ALREADY_EMPLOYED') {
                        banner = { type: 'warning', text: 'Kamu masih memiliki pekerjaan aktif! Resign terlebih dahulu bila ingin pindah karir.' };
                    } else if (res.error === 'RESIGN_COOLDOWN') {
                        banner = { type: 'warning', text: `Kamu baru saja resign! Dapat melamar pekerjaan baru dalam **${formatDuration(res.remMs)}**.` };
                    } else {
                        banner = { type: 'danger', text: 'Syarat melamar profesi ini belum terpenuhi.' };
                    }
                } else {
                    banner = {
                        type: 'success',
                        text: `🎉 Lamaran diterima! Kamu kini resmi bekerja sebagai **${res.job.emoji} ${res.job.name}**. Gunakan \`/work\` untuk memulai shift!`
                    };
                }

                return await interaction.update(
                    buildJobPanel({
                        state,
                        selectedJobId: jobId,
                        banner,
                        now
                    })
                );
            },
            async resign_prompt(interaction) {
                const now = Date.now();
                const state = await fetchJobState(interaction.user.id, now);
                const currentJob = state.player.current_job ? getJob(state.player.current_job) : null;
                if (!currentJob) {
                    return await interaction.update(
                        buildJobPanel({
                            state,
                            banner: { type: 'warning', text: 'Kamu sedang tidak memiliki pekerjaan aktif.' },
                            now
                        })
                    );
                }

                return await interaction.update(
                    confirmView({
                        mod: 'job',
                        confirmAction: 'resign_confirm',
                        cancelAction: 'home',
                        ownerId: interaction.user.id,
                        title: '🚪 Konfirmasi Pengunduran Diri (Resign)',
                        description: [
                            `Apakah kamu yakin ingin mengundurkan diri dari profesi **${currentJob.emoji} ${currentJob.name}**?`,
                            '• Riwayat jumlah shift dan jabatanmu **tetap tersimpan**.\n• ⏳ Terdapat **masa tunggu 24 jam** sebelum kamu dapat melamar pekerjaan baru.'
                        ],
                        confirmLabel: 'Ya, Resign Sekarang',
                        confirmStyle: ButtonStyle.Danger,
                        player: state.player,
                        now
                    })
                );
            },
            async resign_confirm(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;
                let oldJob = null;

                await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    if (synced.player.current_job) {
                        oldJob = getJob(synced.player.current_job);
                        await conn.execute(
                            `UPDATE players SET current_job = NULL, job_resigned_at = ? WHERE discord_id = ?`,
                            [now, userId]
                        );
                    }
                });

                const state = await fetchJobState(userId, now);
                return await interaction.update(
                    buildJobPanel({
                        state,
                        banner: oldJob
                            ? { type: 'info', text: `📄 Kamu telah resmi mengundurkan diri dari **${oldJob.emoji} ${oldJob.name}** (jeda melamar kembali: 24 jam).` }
                            : { type: 'warning', text: 'Kamu tidak memiliki pekerjaan aktif.' },
                        now
                    })
                );
            }
        },
        selects: {
            async pick(interaction) {
                const now = Date.now();
                const jobId = interaction.values[0] || '';
                const state = await fetchJobState(interaction.user.id, now);
                return await interaction.update(
                    buildJobPanel({
                        state,
                        selectedJobId: jobId,
                        now
                    })
                );
            }
        }
    },

    buildJobPanel,
    buildJobListPayload
};
