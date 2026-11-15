const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerPropertyStatus } = require('../../services/propertyService');
const { debitPlayerFunds } = require('../../services/economyService');
const { VITALS } = require('../../data/constants');
const { getPropertyTier } = require('../../data/properties');
const { MOTEL_TRANSIT_CONFIG, getCity } = require('../../data/cities');
const { scheduleAutoUpdate, cancelAutoUpdate } = require('../../services/autoUpdateService');
const { COLORS, formatLp, formatDuration } = require('../../utils/uiBuilder');
const { buildPanel, btn } = require('../../utils/panelBuilder');
const { isPropertyUnderDevelopment } = require('../../utils/featureFlags');

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

    const currentCity = getCity(p.current_city);
    const homeCity = getCity(propStatus.propertyCityId);
    const hasActiveHome = Boolean(propStatus.row && !propStatus.isEvicted && propStatus.effectiveTier.id !== 'tunawisma' && !propStatus.facilitiesLocked);
    const isInHomeCity = hasActiveHome && homeCity.id === currentCity.id;

    const localTier = isInHomeCity ? propStatus.effectiveTier : getPropertyTier('tunawisma');
    const durationSec = localTier.sleepDurationSec || VITALS.SLEEP_DURATION_SEC;
    const durationMin = Math.round(durationSec / 60);
    const energyBonus = localTier.sleepEnergyBonus || VITALS.SLEEP_ENERGY_BONUS;

    const motelMin = Math.round(MOTEL_TRANSIT_CONFIG.sleepDurationSec / 60);

    const localDisplayName = isInHomeCity ? (propStatus.customName || localTier.name) : localTier.name;
    const remoteDisplayName = propStatus.customName || propStatus.effectiveTier.name;

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
    } else if (propStatus.facilitiesLocked) {
        const condLabel = propStatus.conditionMeta?.label || 'Terbengkalai/Roboh';
        statusText = isPropertyUnderDevelopment()
            ? `🔒 **Hunian Lokal Terkunci (${condLabel}):** Kamar tidur di propertimu belum dapat dipakai sementara karena fitur \`/property\` sedang dalam pengembangan. Gunakan **Tidur Darurat (${localTier.name})** atau **Motel Transit**!`
            : `🔒 **Hunian Lokal Terkunci (${condLabel}):** Kamar tidur di propertimu sedang tidak dapat dipakai hingga direnovasi atau dibersihkan lewat \`/property\`. Sementara gunakan **Tidur Darurat (${localTier.name})** atau **Motel Transit**!`;
    } else if (!isInHomeCity && hasActiveHome) {
        statusText = `🧳 **Status Luar Kota:** Kamu sedang berada di **${currentCity.emoji} ${currentCity.name}**, sedangkan hunianmu (**${propStatus.effectiveTier.emoji} ${remoteDisplayName}**) ada di **${homeCity.emoji} ${homeCity.name}**. Pilih tidur darurat gratis atau sewa **Motel Transit**!`;
    } else {
        statusText = `🟢 **Status:** Siap beristirahat di **${localTier.emoji} ${localDisplayName}** (${currentCity.emoji} ${currentCity.shortName})!`;
    }

    const restFurns = isInHomeCity
        ? (propStatus.stats?.furnitureDetails || []).filter(d => d.spec?.category === 'rest' && d.spec?.id !== 'sofa_santai')
        : [];
    const bedNote = restFurns.length > 0
        ? `\n• 🛋️ Perabot Tidur    : ${restFurns.slice(0, 3).map(d => `${d.spec.emoji} **${d.spec.name}**${d.room ? ` *(${d.room.customName})*` : ''}${d.isOutdoorPenalty ? ' *(⚠️ Outdoor -50%)*' : ''}`).join(', ')}`
        : '';

    const blocks = [
        statusText,
        [
            `🏠 **Tempat Istirahat Lokal (${currentCity.emoji} ${currentCity.name}):** ${localTier.emoji} **${localDisplayName}**`,
            `• ⏱️ Durasi Tidur      : **${durationMin} menit**`,
            `• ⚡ Bonus Pemulihan   : **+${energyBonus} Energy** saat bangun`,
            `• 🔋 Regen Pasif Lokal : **+${12 + (localTier.passiveEnergyRegenBonus || 0)} Energy/jam**${bedNote}`
        ].join('\n')
    ];

    if (!isInHomeCity) {
        blocks.push(
            [
                `${MOTEL_TRANSIT_CONFIG.emoji} **Opsi Penginapan: ${MOTEL_TRANSIT_CONFIG.name}**`,
                `• 💵 Tarif Menginap  : **${formatLp(MOTEL_TRANSIT_CONFIG.priceLp)} / istirahat**`,
                `• ⏱️ Durasi & Pulih  : **${motelMin} menit** · **+${MOTEL_TRANSIT_CONFIG.sleepEnergyBonus} ⚡ Energy**`
            ].join('\n')
        );
    }

    const canStartSleep = !inHospital && !isSleeping && !energyTooHigh;
    const actionButtons = [
        btn('sleep', 'start', ownerId, {
            label: isSleeping
                ? 'Sedang Tidur...'
                : (energyTooHigh ? `Energy Masih Tinggi (${Math.round(p.energy)}/100)` : `Tidur ${localTier.name} (+${energyBonus} ⚡ · ${durationMin}m)`),
            emoji: '🛌',
            style: ButtonStyle.Primary,
            disabled: !canStartSleep
        }, now)
    ];

    if (!isInHomeCity) {
        const canAffordMotel = (Number(p.cash || 0) + Number(p.bank || 0)) >= MOTEL_TRANSIT_CONFIG.priceLp;
        actionButtons.push(
            btn('sleep', 'start_motel', ownerId, {
                label: `Motel Transit (${formatLp(MOTEL_TRANSIT_CONFIG.priceLp)} · +${MOTEL_TRANSIT_CONFIG.sleepEnergyBonus} ⚡)`,
                emoji: MOTEL_TRANSIT_CONFIG.emoji,
                style: ButtonStyle.Success,
                disabled: !canStartSleep || !canAffordMotel
            }, now)
        );
    }

    const row = new ActionRowBuilder().addComponents(actionButtons);

    return buildPanel({
        mod: 'sleep',
        ownerId,
        accentColor: COLORS.LIFE,
        title: `🛌 Kamar Istirahat & Penginapan (/sleep)`,
        player: p,
        banner,
        blocks,
        rows: [row],
        footer: 'Selama tidur berlangsung, kamu tidak dapat beraktivitas. Tampilan akan otomatis memperbarui dirinya saat kamu bangun!',
        now
    });
}

module.exports = {
    name: 'sleep',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('sleep')
        .setDescription('Buka panel istirahat & tidur di hunianmu atau Motel Transit untuk memulihkan Energy.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchSleepState(interaction.user.id, now);
        const reply = await interaction.reply(buildSleepPanel({ state, now }));
        if (Number(state.player.sleeping_until || 0) > now) {
            const remMs = Number(state.player.sleeping_until) - now;
            scheduleAutoUpdate(`sleep:${interaction.user.id}`, interaction, remMs + 500, async () => {
                const refreshed = await fetchSleepState(interaction.user.id, Date.now());
                return buildSleepPanel({
                    state: refreshed,
                    banner: { type: 'success', text: '🛌 Kamu sudah bangun tidur! Energy telah pulih kembali.' },
                    now: Date.now()
                });
            });
        }
        return reply;
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchSleepState(interaction.user.id, now);
                const reply = await interaction.update(buildSleepPanel({ state, now }));
                if (Number(state.player.sleeping_until || 0) > now) {
                    const remMs = Number(state.player.sleeping_until) - now;
                    scheduleAutoUpdate(`sleep:${interaction.user.id}`, interaction, remMs + 500, async () => {
                        const refreshed = await fetchSleepState(interaction.user.id, Date.now());
                        return buildSleepPanel({
                            state: refreshed,
                            banner: { type: 'success', text: '🛌 Kamu sudah bangun tidur! Energy telah pulih kembali.' },
                            now: Date.now()
                        });
                    });
                } else {
                    cancelAutoUpdate(`sleep:${interaction.user.id}`);
                }
                return reply;
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

                    const curCity = getCity(p.current_city);
                    const homeCity = getCity(propStatus.propertyCityId);
                    const inHome = Boolean(propStatus.row && !propStatus.isEvicted && propStatus.effectiveTier.id !== 'tunawisma' && !propStatus.facilitiesLocked && homeCity.id === curCity.id);
                    const localTier = inHome ? propStatus.effectiveTier : getPropertyTier('tunawisma');

                    const durationSec = localTier.sleepDurationSec || VITALS.SLEEP_DURATION_SEC;
                    const energyBonus = localTier.sleepEnergyBonus || VITALS.SLEEP_ENERGY_BONUS;
                    const wakeAt = now + durationSec * 1000;

                    await conn.execute(`DELETE FROM player_buffs WHERE discord_id = ? AND buff_type = 'motel_sleep'`, [userId]);
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

                const reply = await interaction.update(
                    buildSleepPanel({
                        state: { player: res.player, propStatus: res.propStatus },
                        banner,
                        now
                    })
                );

                if (res.ok && res.wakeAt > now) {
                    const remMs = res.wakeAt - now;
                    scheduleAutoUpdate(`sleep:${userId}`, interaction, remMs + 500, async () => {
                        const refreshed = await fetchSleepState(userId, Date.now());
                        return buildSleepPanel({
                            state: refreshed,
                            banner: { type: 'success', text: '🛌 Kamu sudah bangun tidur! Energy telah pulih kembali.' },
                            now: Date.now()
                        });
                    });
                }

                return reply;
            },
            async start_motel(interaction) {
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

                    const totalFunds = Number(p.cash || 0) + Number(p.bank || 0);
                    if (totalFunds < MOTEL_TRANSIT_CONFIG.priceLp) {
                        return { error: 'INSUFFICIENT_FUNDS', player: p, propStatus };
                    }

                    await debitPlayerFunds(
                        conn,
                        p,
                        MOTEL_TRANSIT_CONFIG.priceLp,
                        'motel_transit_sleep',
                        { cityId: p.current_city || 'kota_sentral' },
                        now
                    );

                    const wakeAt = now + MOTEL_TRANSIT_CONFIG.sleepDurationSec * 1000;
                    await conn.execute(
                        `INSERT INTO player_buffs (discord_id, buff_type, multiplier, expires_at)
                         VALUES (?, 'motel_sleep', ?, ?)
                         ON DUPLICATE KEY UPDATE multiplier = VALUES(multiplier), expires_at = VALUES(expires_at)`,
                        [userId, MOTEL_TRANSIT_CONFIG.sleepEnergyBonus, wakeAt + 30 * 86400000]
                    );
                    await conn.execute(`UPDATE players SET sleeping_until = ? WHERE discord_id = ?`, [wakeAt, userId]);
                    p.sleeping_until = wakeAt;

                    return {
                        ok: true,
                        player: p,
                        propStatus,
                        wakeAt,
                        energyBonus: MOTEL_TRANSIT_CONFIG.sleepEnergyBonus
                    };
                });

                let banner = null;
                if (res.ok) {
                    const wakeUnix = Math.floor(res.wakeAt / 1000);
                    banner = {
                        type: 'success',
                        text: `🏨 Check-in **${MOTEL_TRANSIT_CONFIG.name}** berhasil (${formatLp(MOTEL_TRANSIT_CONFIG.priceLp)})! Bangun **<t:${wakeUnix}:R>** dengan **+${res.energyBonus} ⚡ Energy**.`
                    };
                } else if (res.error === 'INSUFFICIENT_FUNDS') {
                    banner = { type: 'danger', text: `Saldo Cash + Bank tidak cukup untuk menyewa Motel Transit (${formatLp(MOTEL_TRANSIT_CONFIG.priceLp)}).` };
                } else if (res.error === 'ENERGY_HIGH') {
                    banner = { type: 'warning', text: `Energy kamu masih di atas ${VITALS.SLEEP_MAX_ENERGY_ALLOWED}!` };
                } else {
                    banner = { type: 'warning', text: 'Kamu sedang tidak dapat menginap di Motel saat ini.' };
                }

                const reply = await interaction.update(
                    buildSleepPanel({
                        state: { player: res.player, propStatus: res.propStatus },
                        banner,
                        now
                    })
                );

                if (res.ok && res.wakeAt > now) {
                    const remMs = res.wakeAt - now;
                    scheduleAutoUpdate(`sleep:${userId}`, interaction, remMs + 500, async () => {
                        const refreshed = await fetchSleepState(userId, Date.now());
                        return buildSleepPanel({
                            state: refreshed,
                            banner: { type: 'success', text: '🛌 Kamu sudah bangun tidur! Energy telah pulih kembali.' },
                            now: Date.now()
                        });
                    });
                }

                return reply;
            }
        }
    },

    buildSleepPanel
};
