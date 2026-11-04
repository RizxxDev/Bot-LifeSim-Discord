const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerPropertyStatus } = require('../../services/propertyService');
const { VITALS } = require('../../data/constants');
const { COLORS, formatDuration } = require('../../utils/uiBuilder');
const { buildPanel, btn } = require('../../utils/panelBuilder');

async function fetchSleepState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const propStatus = await getPlayerPropertyStatus(conn, discordId, synced.player.max_slots, now, false);
        return { player: synced.player, propStatus };
    });
}

function buildSleepPanel({ state, banner = null, now = Date.now() }) {
    const { player: p, propStatus } = state;
    const ownerId = p.discord_id;
    const propTier = propStatus.effectiveTier;
    const durationSec = propTier.sleepDurationSec || VITALS.SLEEP_DURATION_SEC;
    const durationMin = Math.round(durationSec / 60);
    const energyBonus = propTier.sleepEnergyBonus || VITALS.SLEEP_ENERGY_BONUS;

    const inHospital = Number(p.hospital_until) > now;
    const isSleeping = Number(p.sleeping_until) > now;
    const energyTooHigh = p.energy >= VITALS.SLEEP_MAX_ENERGY_ALLOWED;

    let statusText = '';
    if (inHospital) {
        const remMs = Number(p.hospital_until) - now;
        statusText = `🏥 **Status:** Sedang dirawat di Rumah Sakit — keluar **<t:${Math.floor(Number(p.hospital_until) / 1000)}:R>** (${formatDuration(remMs)})`;
    } else if (isSleeping) {
        const remMs = Number(p.sleeping_until) - now;
        statusText = `🛌 **Status:** Sedang tidur nyenyak — bangun **<t:${Math.floor(Number(p.sleeping_until) / 1000)}:R>** (${formatDuration(remMs)})`;
    } else if (energyTooHigh) {
        statusText = `⚡ **Status:** Belum mengantuk! Energy kamu masih **${Math.round(p.energy)}/100** *(Hanya bisa tidur saat Energy di bawah **${VITALS.SLEEP_MAX_ENERGY_ALLOWED}**)*`;
    } else {
        statusText = `🟢 **Status:** Siap beristirahat di **${propTier.emoji} ${propTier.name}**!`;
    }

    const blocks = [
        statusText,
        [
            `🏠 **Tempat Istirahatmu:** ${propTier.emoji} **${propTier.name}**`,
            `• ⏱️ Durasi Tidur      : **${durationMin} menit**`,
            `• ⚡ Bonus Pemulihan   : **+${energyBonus} Energy** saat bangun`,
            `• 🔋 Regen Pasif Hunian: **+${12 + (propTier.passiveEnergyRegenBonus || 0)} Energy/jam**`
        ].join('\n')
    ];

    const canStartSleep = !inHospital && !isSleeping && !energyTooHigh;
    const row = new ActionRowBuilder().addComponents(
        btn('sleep', 'start', ownerId, {
            label: isSleeping
                ? 'Sedang Tidur...'
                : (energyTooHigh ? `Energy Masih Tinggi (${Math.round(p.energy)}/100)` : `Mulai Tidur (+${energyBonus} ⚡ · ${durationMin}m)`),
            emoji: '🛌',
            style: ButtonStyle.Primary,
            disabled: !canStartSleep
        }, now),
        btn('sleep', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary
        }, now)
    );

    return buildPanel({
        mod: 'sleep',
        ownerId,
        accentColor: COLORS.LIFE,
        title: `🛌 Kamar Istirahat & Tidur (/sleep)`,
        player: p,
        banner,
        blocks,
        rows: [row],
        footer: 'Selama tidur berlangsung, kamu tidak dapat bekerja, kuliah, memancing, atau menambang. Upgrade hunian di /property untuk tidur lebih cepat & pulih lebih besar!',
        now
    });
}

module.exports = {
    name: 'sleep',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('sleep')
        .setDescription('Buka panel istirahat & tidur di hunianmu untuk memulihkan Energy tambahan.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchSleepState(interaction.user.id, now);
        return await interaction.reply(buildSleepPanel({ state, now }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchSleepState(interaction.user.id, now);
                return await interaction.update(buildSleepPanel({ state, now }));
            },
            async start(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;

                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    const p = synced.player;
                    const propStatus = await getPlayerPropertyStatus(conn, userId, p.max_slots, now, false);

                    if (Number(p.hospital_until) > now) {
                        return { error: 'HOSPITAL', player: p, propStatus };
                    }
                    if (Number(p.sleeping_until) > now) {
                        return { error: 'ALREADY_SLEEPING', player: p, propStatus };
                    }
                    if (p.energy >= VITALS.SLEEP_MAX_ENERGY_ALLOWED) {
                        return { error: 'ENERGY_HIGH', player: p, propStatus };
                    }

                    const propTier = propStatus.effectiveTier;
                    const durationSec = propTier.sleepDurationSec || VITALS.SLEEP_DURATION_SEC;
                    const energyBonus = propTier.sleepEnergyBonus || VITALS.SLEEP_ENERGY_BONUS;
                    const wakeAt = now + durationSec * 1000;

                    await conn.execute(`UPDATE players SET sleeping_until = ? WHERE discord_id = ?`, [wakeAt, userId]);
                    p.sleeping_until = wakeAt;

                    return {
                        ok: true,
                        player: p,
                        propStatus,
                        wakeAt,
                        energyBonus
                    };
                });

                let banner = null;
                if (res.ok) {
                    const wakeUnix = Math.floor(res.wakeAt / 1000);
                    banner = {
                        type: 'success',
                        text: `🛌 Kamu mulai tidur nyenyak! Bangun **<t:${wakeUnix}:R>** dengan tambahan **+${res.energyBonus} ⚡ Energy**.`
                    };
                } else if (res.error === 'ENERGY_HIGH') {
                    banner = { type: 'warning', text: `Energy kamu masih di atas ${VITALS.SLEEP_MAX_ENERGY_ALLOWED}!` };
                } else {
                    banner = { type: 'warning', text: 'Kamu sedang tidak dapat memulai tidur saat ini.' };
                }

                return await interaction.update(
                    buildSleepPanel({
                        state: { player: res.player, propStatus: res.propStatus },
                        banner,
                        now
                    })
                );
            }
        }
    },

    buildSleepPanel
};
