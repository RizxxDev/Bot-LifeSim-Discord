const { SlashCommandBuilder } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerPropertyStatus } = require('../../services/propertyService');
const { VITALS } = require('../../data/constants');
const { COLORS, formatDuration, formatVitalsCompact, buildV2Card } = require('../../utils/uiBuilder');

module.exports = {
    name: 'sleep',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('sleep')
        .setDescription('Tidur dan beristirahat di hunianmu untuk memulihkan Energy tambahan.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const res = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, interaction.user.id, now, true);
            const p = synced.player;

            if (Number(p.hospital_until) > now) {
                return { error: 'HOSPITAL', remMs: Number(p.hospital_until) - now };
            }
            if (Number(p.sleeping_until) > now) {
                return { error: 'ALREADY_SLEEPING', remMs: Number(p.sleeping_until) - now };
            }
            if (p.energy >= VITALS.SLEEP_MAX_ENERGY_ALLOWED) {
                return { error: 'ENERGY_HIGH', player: p };
            }

            const propStatus = await getPlayerPropertyStatus(conn, interaction.user.id, p.max_slots, now, false);
            const propTier = propStatus.effectiveTier;
            const durationSec = propTier.sleepDurationSec || VITALS.SLEEP_DURATION_SEC;
            const energyBonus = propTier.sleepEnergyBonus || VITALS.SLEEP_ENERGY_BONUS;

            const wakeAt = now + durationSec * 1000;
            await conn.execute(
                `UPDATE players SET sleeping_until = ? WHERE discord_id = ?`,
                [wakeAt, interaction.user.id]
            );
            p.sleeping_until = wakeAt;
            return { player: p, wakeAt, propTier, durationSec, energyBonus };
        });

        if (res.error === 'HOSPITAL') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '🏥 Sedang Dirawat di Rumah Sakit',
                    blocks: [`Kamu masih dalam perawatan medis selama **${formatDuration(res.remMs)}**.`],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'ALREADY_SLEEPING') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.PRIMARY,
                    title: '🛌 Kamu Sedang Tidur',
                    blocks: [`Kamu baru akan bangun dalam **${formatDuration(res.remMs)}**.`],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'ENERGY_HIGH') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '⚡ Belum Mengantuk!',
                    blocks: [
                        `Energy kamu masih **${Math.round(res.player.energy)}/100** (hanya bisa \`/sleep\` saat Energy di bawah **${VITALS.SLEEP_MAX_ENERGY_ALLOWED}**).`,
                        formatVitalsCompact(res.player)
                    ],
                    ephemeral: true
                })
            );
        }

        const wakeUnix = Math.floor(res.wakeAt / 1000);
        const durationMin = Math.round(res.durationSec / 60);
        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.LIFE,
                title: `🛌 Tidur di ${res.propTier.emoji} ${res.propTier.name}`,
                blocks: [
                    `**${res.player.username}** mulai tidur nyenyak selama **${durationMin} menit** (bangun <t:${wakeUnix}:R>).`,
                    `Saat bangun nanti, kamu akan mendapatkan tambahan **+${res.energyBonus} ⚡ Energy** di luar pemulihan pasif.`
                ],
                footer: 'Selama tidur, kamu tidak dapat melakukan aktivitas /work, /study, /fishing, atau /mining.'
            })
        );
    }
};
