const { SlashCommandBuilder } = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { getCooldownRemaining, setCooldown } = require('../../database/redis');
const { syncPlayerVitals, checkActivityEligibility, deductActivityVitals } = require('../../services/vitalService');
const { debitPlayerFunds } = require('../../services/economyService');
const { EDUCATION_LEVELS, getEducation, getAvailableNextEducations } = require('../../data/education');
const { ACTIVITY_COSTS } = require('../../data/constants');
const { COLORS, formatLp, renderBar, formatDuration, formatVitalsCompact, buildV2Card } = require('../../utils/uiBuilder');

module.exports = {
    name: 'study',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('study')
        .setDescription('Ikuti sesi belajar atau kuliah untuk meningkatkan jenjang pendidikan (SD → SMP → SMA → D3/S1 → S2).')
        .addStringOption(opt =>
            opt
                .setName('jenjang')
                .setDescription('Pilih jenjang pendidikan tujuan (khususnya saat memilih D3 atau S1 setelah SMA)')
                .setRequired(false)
                .addChoices(
                    { name: 'SMP (6 Sesi × Lp 10.000)', value: 'SMP' },
                    { name: 'SMA (10 Sesi × Lp 20.000)', value: 'SMA' },
                    { name: 'D3 — Diploma 3 (15 Sesi × Lp 35.000)', value: 'D3' },
                    { name: 'S1 — Sarjana (25 Sesi × Lp 50.000)', value: 'S1' },
                    { name: 'S2 — Magister (35 Sesi × Lp 120.000)', value: 'S2' }
                )
        ),

    async executeSlash(interaction) {
        const discordId = interaction.user.id;
        const requestedTarget = interaction.options.getString('jenjang');
        const now = Date.now();

        const remCd = await getCooldownRemaining(discordId, 'study', query);
        if (remCd > 0) {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '⏳ Jadwal Belajar Berikutnya',
                    blocks: [
                        `Otakmu masih butuh istirahat usai sesi belajar sebelumnya. Kamu bisa belajar lagi dalam **${formatDuration(remCd)}** (<t:${Math.floor((now + remCd) / 1000)}:R>).`
                    ],
                    ephemeral: true
                })
            );
        }

        const cost = ACTIVITY_COSTS.study;

        const res = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, true);
            const p = synced.player;

            const currentEdu = getEducation(p.education_level);
            const availableNext = getAvailableNextEducations(currentEdu.id);

            if (availableNext.length === 0 && !p.study_target) {
                return { error: 'MAX_EDU', currentEdu };
            }

            let targetEdu = null;
            if (p.study_target) {
                targetEdu = getEducation(p.study_target);
                if (requestedTarget && requestedTarget.toUpperCase() !== targetEdu.id) {
                    return { error: 'ALREADY_STUDYING', targetEdu, sessions: p.study_sessions };
                }
            } else if (requestedTarget) {
                const candidate = availableNext.find(e => e.id === requestedTarget.toUpperCase());
                if (!candidate) {
                    return { error: 'INVALID_TARGET', currentEdu, availableNext };
                }
                targetEdu = candidate;
            } else {
                // Default ke jenjang berikutnya (jika SMA dan tidak memilih, sarankan pilih D3 atau S1 bila lebih dari 1 opsi)
                if (availableNext.length > 1) {
                    return { error: 'CHOOSE_D3_OR_S1', currentEdu, availableNext };
                }
                targetEdu = availableNext[0];
            }

            const elig = checkActivityEligibility(p, cost, 'study', now);
            if (!elig.allowed) {
                return { error: 'INELIGIBLE', elig, player: p };
            }

            if ((Number(p.cash) + Number(p.bank)) < targetEdu.costPerSession) {
                return { error: 'NO_FUNDS', targetEdu, player: p };
            }

            await debitPlayerFunds(conn, p, targetEdu.costPerSession, `study_${targetEdu.id}`, {
                session: Number(p.study_sessions || 0) + 1
            }, now);

            const hospitalized = deductActivityVitals(p, cost, 0, now);

            const newSessions = Number(p.study_sessions || 0) + 1;
            const graduated = newSessions >= targetEdu.sessionsRequired;

            if (graduated) {
                p.education_level = targetEdu.id;
                p.study_target = null;
                p.study_sessions = 0;
            } else {
                p.study_target = targetEdu.id;
                p.study_sessions = newSessions;
            }

            await conn.execute(
                `UPDATE players
                 SET energy = ?, hunger = ?, thirst = ?, health = ?,
                     cash = ?, bank = ?, hospital_until = ?, sleeping_until = ?,
                     education_level = ?, study_target = ?, study_sessions = ?
                 WHERE discord_id = ?`,
                [
                    p.energy, p.hunger, p.thirst, p.health,
                    p.cash, p.bank, p.hospital_until, p.sleeping_until,
                    p.education_level, p.study_target, p.study_sessions,
                    discordId
                ]
            );

            await setCooldown(
                discordId,
                'study',
                cost.cooldownSec,
                (sql, params) => conn.execute(sql, params)
            );

            return {
                player: p,
                targetEdu,
                newSessions,
                graduated,
                hospitalized
            };
        });

        if (res.error === 'MAX_EDU') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: '🏛️ Pendidikan Tertinggi Tercapai!',
                    blocks: [
                        `Kamu sudah memegang gelar tertinggi **${res.currentEdu.emoji} ${res.currentEdu.name}**. Seluruh profesi di kota kini terbuka untukmu!`
                    ],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'ALREADY_STUDYING') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '📚 Sedang Menempuh Pendidikan',
                    blocks: [
                        `Kamu sedang menempuh program **${res.targetEdu.name}** (${res.sessions}/${res.targetEdu.sessionsRequired} sesi). Selesaikan jenjang ini terlebih dahulu! Cukup ketik \`/study\` tanpa argumen untuk melanjutkan.`
                    ],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'CHOOSE_D3_OR_S1' || res.error === 'INVALID_TARGET') {
            const list = res.availableNext
                .map(e => `• **${e.emoji} ${e.name}** (\`/study jenjang:${e.id}\`) — **${e.sessionsRequired} sesi** × ${formatLp(e.costPerSession)} (Total: ${formatLp(e.sessionsRequired * e.costPerSession)})`)
                .join('\n');
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.CAREER,
                    title: '🎓 Pilih Jenjang Pendidikan Tujuan',
                    blocks: [
                        `Pendidikanmu saat ini adalah **${res.currentEdu.name}**. Silakan pilih program lanjutan yang tersedia:`,
                        list
                    ],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'INELIGIBLE') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '⚠️ Tidak Dapat Mengikuti Sesi Belajar',
                    blocks: [res.elig.message, formatVitalsCompact(res.player)],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'NO_FUNDS') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '💸 Biaya Pendidikan Tidak Cukup',
                    blocks: [
                        `Biaya 1 sesi **${res.targetEdu.name}** adalah **${formatLp(res.targetEdu.costPerSession)}**, sedangkan total saldo Cash + Bank kamu hanya **${formatLp(Number(res.player.cash) + Number(res.player.bank))}**.`
                    ],
                    ephemeral: true
                })
            );
        }

        if (res.graduated) {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `🎓 KELULUSAN! Selamat Atas Ijazah ${res.targetEdu.id}!`,
                    blocks: [
                        `🎉 **${res.player.username}** telah menyelesaikan seluruh **${res.targetEdu.sessionsRequired} sesi** dan resmi meraih gelar **${res.targetEdu.emoji} ${res.targetEdu.name}**!`,
                        `• 💸 Biaya Sesi Terakhir: **-${formatLp(res.targetEdu.costPerSession)}**\n• 📊 Kondisi Saat Ini: ${formatVitalsCompact(res.player)}`,
                        `Cek lowongan kerja baru yang kini terbuka untukmu dengan \`/job list\`!`
                    ]
                })
            );
        }

        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.CAREER,
                title: `${res.targetEdu.emoji} Sesi Studi: ${res.targetEdu.name}`,
                blocks: [
                    `Kamu menyelesaikan sesi perkuliahan/belajar dengan tekun!`,
                    [
                        `• 📈 **Progres Studi:** \`${renderBar(res.newSessions, res.targetEdu.sessionsRequired, 10)}\` (**${res.newSessions}/${res.targetEdu.sessionsRequired} sesi**)`,
                        `• 💸 **Biaya Sesi:** -${formatLp(res.targetEdu.costPerSession)} *(Sisa Cash: ${formatLp(res.player.cash)})*`,
                        `• 📊 **Kondisi Tubuh:** ${formatVitalsCompact(res.player)}`
                    ].join('\n')
                ],
                footer: 'Sesi belajar berikutnya tersedia dalam 120 menit.'
            })
        );
    }
};
