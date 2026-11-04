const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction, query } = require('../../database/mariadb');
const { getCooldownRemaining, setCooldown } = require('../../database/redis');
const { syncPlayerVitals, checkActivityEligibility, deductActivityVitals } = require('../../services/vitalService');
const { debitPlayerFunds } = require('../../services/economyService');
const { executeQuickMeal } = require('../../services/consumptionService');
const { EDUCATION_LEVELS, getEducation, getAvailableNextEducations } = require('../../data/education');
const { ACTIVITY_COSTS } = require('../../data/constants');
const { COLORS, formatLp, renderBar, formatDuration } = require('../../utils/uiBuilder');
const { buildPanel, btn } = require('../../utils/panelBuilder');

async function fetchStudyState(discordId, now = Date.now()) {
    const remCd = await getCooldownRemaining(discordId, 'study', query);
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const p = synced.player;
        const currentEdu = getEducation(p.education_level);
        const availableNext = getAvailableNextEducations(currentEdu.id);
        const activeTarget = p.study_target ? getEducation(p.study_target) : null;
        const elig = checkActivityEligibility(p, ACTIVITY_COSTS.study, 'study', now);

        return {
            player: p,
            currentEdu,
            availableNext,
            activeTarget,
            elig,
            remCd
        };
    });
}

function buildStudyPanel(state, banner = null, now = Date.now()) {
    const { player: p, currentEdu, availableNext, activeTarget, elig, remCd } = state;
    const ownerId = p.discord_id;
    const cost = ACTIVITY_COSTS.study;

    const roadmap = EDUCATION_LEVELS.map(e => {
        const isCurrent = e.id === currentEdu.id;
        const isTarget = activeTarget && activeTarget.id === e.id;
        const mark = isCurrent ? '✅' : isTarget ? '📖' : '•';
        return `${mark} **${e.emoji} ${e.name}** (${e.sessionsRequired > 0 ? `${e.sessionsRequired} sesi × ${formatLp(e.costPerSession)}` : 'Dasar'})`;
    }).join('\n');

    const blocks = [
        `🎓 **Ijazah Saat Ini:** ${currentEdu.emoji} **${currentEdu.name}**\n⚡ **Biaya Sesi Belajar:** **-${cost.energy} Energy · -${cost.hunger} Hunger · -${cost.thirst} Thirst**`,
        `**🗺️ Jenjang Pendidikan Kota:**\n${roadmap}`
    ];

    const actionButtons = [];
    const totalBalance = Number(p.cash) + Number(p.bank);

    if (availableNext.length === 0 && !activeTarget) {
        blocks.push(`🏛️ **Pendidikan Tertinggi Tercapai!** Kamu telah memegang gelar **${currentEdu.name}**. Seluruh profesi di kota telah terbuka untukmu!`);
    } else if (activeTarget) {
        blocks.push(
            [
                `📖 **Program Studi Aktif:** ${activeTarget.emoji} **${activeTarget.name}**`,
                `📈 **Progres Sesi:** \`${renderBar(p.study_sessions, activeTarget.sessionsRequired, 10)}\` (**${p.study_sessions}/${activeTarget.sessionsRequired} sesi**)`,
                `💳 **Biaya per Sesi:** **${formatLp(activeTarget.costPerSession)}**`,
                remCd > 0
                    ? `⏳ **Jadwal Berikutnya:** Siap belajar lagi **<t:${Math.floor((now + remCd) / 1000)}:R>** (${formatDuration(remCd)}).`
                    : !elig.allowed
                        ? `⚠️ **Belum Siap Belajar:** ${elig.message}`
                        : totalBalance < activeTarget.costPerSession
                            ? `💸 **Saldo Kurang:** Butuh **${formatLp(activeTarget.costPerSession)}** untuk mengikuti sesi berikutnya.`
                            : `✅ **Siap Belajar!** Klik tombol di bawah untuk mengikuti sesi ke-${Number(p.study_sessions) + 1}.`
            ].join('\n')
        );

        const canStudy = remCd <= 0 && elig.allowed && totalBalance >= activeTarget.costPerSession;
        actionButtons.push(
            btn('study', 'attend', ownerId, {
                label: `Ikuti Sesi ${activeTarget.id} (${formatLp(activeTarget.costPerSession)})`,
                emoji: '📚',
                style: ButtonStyle.Success,
                arg: activeTarget.id,
                disabled: !canStudy
            }, now)
        );
    } else {
        const nextList = availableNext.map(
            e => `• **${e.emoji} ${e.name}**: **${e.sessionsRequired} sesi** × ${formatLp(e.costPerSession)} *(Total: ${formatLp(e.sessionsRequired * e.costPerSession)})*`
        ).join('\n');

        blocks.push(
            [
                `🎯 **Pilih Program Pendidikan Lanjutan:**`,
                nextList,
                remCd > 0
                    ? `⏳ **Jadwal Berikutnya:** Siap belajar lagi **<t:${Math.floor((now + remCd) / 1000)}:R>** (${formatDuration(remCd)}).`
                    : !elig.allowed
                        ? `⚠️ **Belum Siap Belajar:** ${elig.message}`
                        : `Klik tombol program di bawah untuk memulai sesi pertamamu!`
            ].join('\n')
        );

        for (const nextEdu of availableNext) {
            const canStart = remCd <= 0 && elig.allowed && totalBalance >= nextEdu.costPerSession;
            actionButtons.push(
                btn('study', 'attend', ownerId, {
                    label: `Ambil ${nextEdu.id} (${formatLp(nextEdu.costPerSession)}/sesi)`,
                    emoji: nextEdu.emoji,
                    style: ButtonStyle.Success,
                    arg: nextEdu.id,
                    disabled: !canStart
                }, now)
            );
        }
    }

    actionButtons.push(
        btn('study', 'quick_meal', ownerId, {
            label: 'Makan Cepat',
            emoji: '🍴',
            style: ButtonStyle.Primary
        }, now),
        btn('study', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary
        }, now)
    );

    return buildPanel({
        mod: 'study',
        ownerId,
        accentColor: COLORS.CAREER,
        title: `🎓 Akademi & Universitas Kota`,
        player: p,
        banner,
        blocks,
        rows: [new ActionRowBuilder().addComponents(actionButtons.slice(0, 5))],
        footer: 'Cooldown antar sesi belajar adalah 120 menit.',
        now
    });
}

async function executeStudySession(discordId, requestedTargetId, now = Date.now()) {
    const remCd = await getCooldownRemaining(discordId, 'study', query);
    if (remCd > 0) {
        return { error: 'COOLDOWN', remCd };
    }

    const cost = ACTIVITY_COSTS.study;
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;

        const currentEdu = getEducation(p.education_level);
        const availableNext = getAvailableNextEducations(currentEdu.id);

        if (availableNext.length === 0 && !p.study_target) {
            return { error: 'MAX_EDU' };
        }

        let targetEdu = null;
        if (p.study_target) {
            targetEdu = getEducation(p.study_target);
        } else if (requestedTargetId) {
            targetEdu = availableNext.find(e => e.id === requestedTargetId.toUpperCase()) || availableNext[0];
        } else {
            targetEdu = availableNext[0];
        }

        if (!targetEdu) {
            return { error: 'INVALID_TARGET' };
        }

        const elig = checkActivityEligibility(p, cost, 'study', now);
        if (!elig.allowed) {
            return { error: 'INELIGIBLE', message: elig.message };
        }

        if ((Number(p.cash) + Number(p.bank)) < targetEdu.costPerSession) {
            return { error: 'NO_FUNDS', targetEdu };
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
            ok: true,
            targetEdu,
            newSessions,
            graduated,
            hospitalized
        };
    });
}

module.exports = {
    name: 'study',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('study')
        .setDescription('Buka panel pendidikan & kuliah untuk meningkatkan ijazah (SD → SMP → SMA → D3/S1 → S2).'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchStudyState(interaction.user.id, now);
        return await interaction.reply(buildStudyPanel(state, null, now));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchStudyState(interaction.user.id, now);
                return await interaction.update(buildStudyPanel(state, null, now));
            },
            async attend(interaction, parsed) {
                const now = Date.now();
                const targetId = parsed.arg || '';
                const res = await executeStudySession(interaction.user.id, targetId, now);
                const state = await fetchStudyState(interaction.user.id, now);

                let banner = null;
                if (!res.ok) {
                    if (res.error === 'COOLDOWN') {
                        banner = { type: 'warning', text: `Otakmu masih istirahat! Siap belajar lagi <t:${Math.floor((now + res.remCd) / 1000)}:R>.` };
                    } else if (res.error === 'INELIGIBLE') {
                        banner = { type: 'danger', text: res.message };
                    } else if (res.error === 'NO_FUNDS') {
                        banner = { type: 'danger', text: `Saldo tidak cukup! Biaya sesi **${res.targetEdu.name}** adalah **${formatLp(res.targetEdu.costPerSession)}**.` };
                    } else {
                        banner = { type: 'warning', text: 'Tidak dapat mengikuti sesi belajar saat ini.' };
                    }
                } else if (res.graduated) {
                    banner = {
                        type: 'success',
                        text: `🎓 **KELULUSAN!** Selamat, kamu telah menyelesaikan seluruh sesi dan meraih ijazah **${res.targetEdu.emoji} ${res.targetEdu.name}**!`
                    };
                } else {
                    banner = {
                        type: 'success',
                        text: `📚 Sesi belajar **${res.targetEdu.name}** selesai! Progres: **${res.newSessions}/${res.targetEdu.sessionsRequired} sesi** (-${formatLp(res.targetEdu.costPerSession)}).`
                    };
                }

                return await interaction.update(buildStudyPanel(state, banner, now));
            },
            async quick_meal(interaction) {
                const now = Date.now();
                const meal = await executeQuickMeal(interaction.user.id, now);
                const state = await fetchStudyState(interaction.user.id, now);
                const banner = meal.consumedSummary.length > 0
                    ? { type: 'success', text: `Makan cepat berhasil: mengonsumsi **${meal.consumedSummary.join(', ')}**.` }
                    : { type: 'info', text: 'Kondisi tubuhmu sudah kenyang atau tidak ada makanan/minuman di tas.' };
                return await interaction.update(buildStudyPanel(state, banner, now));
            }
        }
    }
};
