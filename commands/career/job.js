const { SlashCommandBuilder } = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerInventory } = require('../../services/inventoryService');
const { JOBS, PROMOTION_RANKS, getJob, getRankForShifts, getNextRank } = require('../../data/jobs');
const { meetsEducationRequirement, getEducation } = require('../../data/education');
const { getItem } = require('../../data/items');
const { COLORS, formatLp, formatDuration, buildV2Card } = require('../../utils/uiBuilder');

const RESIGN_COOLDOWN_MS = 24 * 3600 * 1000;

async function buildJobListPayload(discordId, ephemeral = false) {
    const now = Date.now();
    const data = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const invRows = await getPlayerInventory(conn, discordId, false);
        const [histRows] = await conn.execute(
            `SELECT job_id, shifts_completed FROM player_job_history WHERE discord_id = ?`,
            [discordId]
        );
        return {
            player: synced.player,
            invRows,
            historyMap: new Map(histRows.map(r => [r.job_id, Number(r.shifts_completed)]))
        };
    });

    const { player: p, invRows, historyMap } = data;
    const ownedItems = new Set(invRows.filter(r => r.quantity > 0).map(r => r.item_id));

    const tierGroups = [0, 1, 2, 3, 4].map(tier => {
        const tierJobs = JOBS.filter(j => j.tier === tier);
        const lines = tierJobs.map(j => {
            const eduOk = meetsEducationRequirement(p.education_level, j.reqEducation);
            const itemOk = !j.reqItem || ownedItems.has(j.reqItem);
            const shiftsOk = p.total_shifts >= (j.reqTotalShifts || 0);
            const histOk = !j.reqJobHistory || (historyMap.get(j.reqJobHistory.jobId) || 0) >= j.reqJobHistory.shifts;
            const unlocked = eduOk && itemOk && shiftsOk && histOk;

            const reqParts = [];
            if (j.reqEducation) reqParts.push(`Ijazah ${j.reqEducation}`);
            if (j.reqItem) {
                const it = getItem(j.reqItem);
                reqParts.push(it ? it.name : j.reqItem);
            }
            if (j.reqTotalShifts) reqParts.push(`${j.reqTotalShifts} Total Shift`);
            if (j.reqJobHistory) reqParts.push(`Perawat ${j.reqJobHistory.shifts} Shift`);

            const reqLabel = reqParts.length > 0 ? reqParts.join(' + ') : 'Tanpa Syarat';
            const myShifts = historyMap.get(j.id) || 0;
            const rank = getRankForShifts(myShifts);
            const isCurrent = p.current_job === j.id ? ' 👈 **(Pekerjaanmu)**' : '';

            return `${unlocked ? '✅' : '🔒'} ${j.emoji} **${j.name}** (\`${j.id}\`) — **${formatLp(j.baseSalary)}/shift** · Syarat: *${reqLabel}* · Riwayat: ${myShifts} shift (${rank.name})${isCurrent}`;
        });
        return `**🏢 Tier ${tier}**\n${lines.join('\n')}`;
    });

    return buildV2Card({
        accentColor: COLORS.CAREER,
        title: '💼 Bursa Lowongan Kerja Kota',
        blocks: [
            `🎓 **Pendidikanmu:** ${p.education_level} · 📊 **Total Pengalaman:** ${p.total_shifts} shift`,
            ...tierGroups
        ],
        footer: 'Gunakan /job apply pekerjaan:<nama> untuk melamar, atau /job info pekerjaan:<nama> untuk detail gaji.',
        ephemeral
    });
}

module.exports = {
    name: 'job',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('job')
        .setDescription('Kelola karir: lihat lowongan kerja, detail profesi, lamar pekerjaan, atau resign.')
        .addSubcommand(sub =>
            sub.setName('list').setDescription('Lihat daftar seluruh profesi dan syaratnya.')
        )
        .addSubcommand(sub =>
            sub
                .setName('info')
                .setDescription('Lihat rincian gaji per jabatan dan syarat suatu profesi.')
                .addStringOption(opt =>
                    opt
                        .setName('pekerjaan')
                        .setDescription('Pilih profesi')
                        .setAutocomplete(true)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('apply')
                .setDescription('Lamar pekerjaan yang syaratnya sudah kamu penuhi.')
                .addStringOption(opt =>
                    opt
                        .setName('pekerjaan')
                        .setDescription('Pilih profesi yang ingin dilamar')
                        .setAutocomplete(true)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('resign').setDescription('Mengundurkan diri dari pekerjaan saat ini (jeda 24 jam sebelum melamar lagi).')
        ),

    async autocomplete(interaction) {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        const choices = JOBS
            .filter(j => `${j.id} ${j.name}`.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(j => ({
                name: `${j.name} (Tier ${j.tier} — ${formatLp(j.baseSalary)}/shift)`,
                value: j.id
            }));
        await interaction.respond(choices);
    },

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        const discordId = interaction.user.id;
        const now = Date.now();

        if (sub === 'list') {
            const payload = await buildJobListPayload(discordId, false);
            return await interaction.reply(payload);
        }

        if (sub === 'info') {
            const jobId = interaction.options.getString('pekerjaan', true);
            const job = getJob(jobId);
            if (!job) {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.DANGER,
                        title: '❌ Profesi Tidak Ditemukan',
                        blocks: ['Gunakan `/job list` untuk melihat daftar profesi yang tersedia.'],
                        ephemeral: true
                    })
                );
            }

            const rows = await query(
                `SELECT shifts_completed FROM player_job_history WHERE discord_id = ? AND job_id = ?`,
                [discordId, job.id]
            );
            const myShifts = rows.length > 0 ? Number(rows[0].shifts_completed) : 0;
            const myRank = getRankForShifts(myShifts);

            const rankTable = PROMOTION_RANKS.map(r => {
                const sal = Math.round(job.baseSalary * r.multiplier);
                const mark = r.id === myRank.id ? ' 👈 **(Jabatanmu)**' : '';
                return `• **${r.name}** (≥ ${r.minShifts} shift): **${formatLp(sal)}/shift** *(Bonus Mini-Game: ${formatLp(Math.round(sal * 1.1))})*${mark}`;
            }).join('\n');

            const reqs = [];
            reqs.push(`🎓 Pendidikan: **${job.reqEducation ? getEducation(job.reqEducation).name : 'Tidak ada'}**`);
            if (job.reqItem) {
                const it = getItem(job.reqItem);
                reqs.push(`🧰 Kepemilikan Item: **${it ? `${it.emoji} ${it.name}` : job.reqItem}**`);
            }
            if (job.reqTotalShifts) reqs.push(`📊 Total Shift Kerja: **≥ ${job.reqTotalShifts} shift**`);
            if (job.reqJobHistory) reqs.push(`🩺 Pengalaman Khusus: **Perawat ≥ ${job.reqJobHistory.shifts} shift**`);

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.CAREER,
                    title: `${job.emoji} Profesi: ${job.name} (Tier ${job.tier})`,
                    blocks: [
                        job.description,
                        `**📋 Syarat Melamar:**\n${reqs.join('\n')}\n• ⚡ Biaya per Shift: **${job.energyCost} Energy · 8 Hunger · 10 Thirst**`,
                        `**📈 Tabel Gaji Pokok per Jabatan:**\n${rankTable}`,
                        `📊 **Pengalamanmu di profesi ini:** **${myShifts} shift**`
                    ]
                })
            );
        }

        if (sub === 'apply') {
            const jobId = interaction.options.getString('pekerjaan', true);
            const job = getJob(jobId);
            if (!job) {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.DANGER,
                        title: '❌ Profesi Tidak Valid',
                        blocks: ['Pilih profesi dari daftar autocomplete atau cek `/job list`.'],
                        ephemeral: true
                    })
                );
            }

            const res = await withTransaction(async (conn) => {
                const synced = await syncPlayerVitals(conn, discordId, now, true);
                const p = synced.player;

                if (p.current_job) {
                    return { error: 'ALREADY_EMPLOYED', currentJob: getJob(p.current_job) };
                }

                const resignedAt = Number(p.job_resigned_at || 0);
                if (resignedAt > 0 && (now - resignedAt) < RESIGN_COOLDOWN_MS) {
                    return {
                        error: 'RESIGN_COOLDOWN',
                        remMs: RESIGN_COOLDOWN_MS - (now - resignedAt)
                    };
                }

                if (!meetsEducationRequirement(p.education_level, job.reqEducation)) {
                    return { error: 'REQ_EDU', reqEdu: job.reqEducation, myEdu: p.education_level };
                }

                if (job.reqItem) {
                    const invRows = await getPlayerInventory(conn, discordId, false);
                    const hasItem = invRows.some(r => r.item_id === job.reqItem && Number(r.quantity) > 0);
                    if (!hasItem) {
                        return { error: 'REQ_ITEM', reqItem: getItem(job.reqItem) };
                    }
                }

                if (job.reqTotalShifts && p.total_shifts < job.reqTotalShifts) {
                    return { error: 'REQ_SHIFTS', req: job.reqTotalShifts, my: p.total_shifts };
                }

                if (job.reqJobHistory) {
                    const [hRows] = await conn.execute(
                        `SELECT shifts_completed FROM player_job_history WHERE discord_id = ? AND job_id = ?`,
                        [discordId, job.reqJobHistory.jobId]
                    );
                    const done = hRows.length > 0 ? Number(hRows[0].shifts_completed) : 0;
                    if (done < job.reqJobHistory.shifts) {
                        return { error: 'REQ_HISTORY', req: job.reqJobHistory.shifts, done };
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

                const [jRows] = await conn.execute(
                    `SELECT shifts_completed FROM player_job_history WHERE discord_id = ? AND job_id = ?`,
                    [discordId, job.id]
                );
                const shifts = jRows.length > 0 ? Number(jRows[0].shifts_completed) : 0;

                return { player: p, shifts };
            });

            if (res.error === 'ALREADY_EMPLOYED') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '⚠️ Kamu Masih Memiliki Pekerjaan Aktif',
                        blocks: [
                            `Kamu saat ini bekerja sebagai **${res.currentJob ? `${res.currentJob.emoji} ${res.currentJob.name}` : 'Pekerja'}**.`,
                            'Gunakan `/job resign` terlebih dahulu jika ingin pindah karir.'
                        ],
                        ephemeral: true
                    })
                );
            }

            if (res.error === 'RESIGN_COOLDOWN') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '⏳ Masa Tunggu Pasca Resign',
                        blocks: [
                            `Kamu baru saja mengundurkan diri. Kamu dapat melamar pekerjaan baru dalam **${formatDuration(res.remMs)}**.`
                        ],
                        ephemeral: true
                    })
                );
            }

            if (res.error === 'REQ_EDU') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.DANGER,
                        title: '🎓 Syarat Pendidikan Belum Terpenuhi',
                        blocks: [
                            `Profesi **${job.emoji} ${job.name}** membutuhkan ijazah minimal **${res.reqEdu}**, sedangkan pendidikanmu saat ini **${res.myEdu}**.`,
                            'Tingkatkan pendidikanmu dengan command `/study`!'
                        ],
                        ephemeral: true
                    })
                );
            }

            if (res.error === 'REQ_ITEM') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.DANGER,
                        title: '🧰 Syarat Peralatan/Dokumen Belum Terpenuhi',
                        blocks: [
                            `Untuk melamar sebagai **${job.emoji} ${job.name}**, kamu wajib memiliki **${res.reqItem.emoji} ${res.reqItem.name}** (${formatLp(res.reqItem.buyPrice)}).`,
                            'Beli terlebih dahulu lewat `/shop` atau `/buy`!'
                        ],
                        ephemeral: true
                    })
                );
            }

            if (res.error === 'REQ_SHIFTS') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.DANGER,
                        title: '📊 Pengalaman Kerja Belum Cukup',
                        blocks: [
                            `Profesi ini membutuhkan total pengalaman **${res.req} shift**, sedangkan kamu baru menyelesaikan **${res.my} shift**.`
                        ],
                        ephemeral: true
                    })
                );
            }

            if (res.error === 'REQ_HISTORY') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.DANGER,
                        title: '🩺 Syarat Pengalaman Medis Belum Cukup',
                        blocks: [
                            `Untuk menjadi **Dokter Spesialis**, kamu harus pernah bekerja sebagai **Perawat** minimal **${res.req} shift** (saat ini: **${res.done} shift**).`
                        ],
                        ephemeral: true
                    })
                );
            }

            const rank = getRankForShifts(res.shifts);
            const nextRank = getNextRank(res.shifts);
            const salary = Math.round(job.baseSalary * rank.multiplier);

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `🎉 Lamaran Diterima: ${job.emoji} ${job.name}!`,
                    blocks: [
                        `Selamat **${res.player.username}**! Kamu resmi diterima bekerja sebagai **${job.name}** dengan jabatan **${rank.name}**.`,
                        [
                            `• 💵 **Gaji Pokok:** ${formatLp(salary)} / shift`,
                            `• ⚡ **Biaya per Shift:** ${job.energyCost} Energy · 8 Hunger · 10 Thirst`,
                            `• 📈 **Progres Jabatan:** ${res.shifts} shift${nextRank ? ` (Naik ke ${nextRank.name} di ${nextRank.minShifts} shift)` : ' (Jabatan Tertinggi)'}`
                        ].join('\n'),
                        'Ketik `/work` sekarang untuk memulai shift pertamamu!'
                ]
                })
            );
        }

        if (sub === 'resign') {
            const res = await withTransaction(async (conn) => {
                const synced = await syncPlayerVitals(conn, discordId, now, true);
                const p = synced.player;
                if (!p.current_job) {
                    return { error: 'NO_JOB' };
                }
                const oldJob = getJob(p.current_job);
                await conn.execute(
                    `UPDATE players SET current_job = NULL, job_resigned_at = ? WHERE discord_id = ?`,
                    [now, discordId]
                );
                return { oldJob, player: p };
            });

            if (res.error === 'NO_JOB') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '❓ Kamu Belum Bekerja',
                        blocks: ['Kamu tidak memiliki pekerjaan aktif saat ini. Gunakan `/job list` untuk mencari lowongan.'],
                        ephemeral: true
                    })
                );
            }

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '📄 Pengunduran Diri Disetujui',
                    blocks: [
                        `Kamu telah resmi mengundurkan diri dari profesi **${res.oldJob ? `${res.oldJob.emoji} ${res.oldJob.name}` : 'Pekerjaanmu'}**.`,
                        '• Seluruh riwayat jumlah shift dan jabatanmu **tetap tersimpan** jika suatu saat kamu kembali ke profesi ini.\n• ⏳ Kamu harus menunggu **24 jam** sebelum dapat melamar pekerjaan baru.'
                    ]
                })
            );
        }
    },

    buildJobListPayload
};
