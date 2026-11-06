const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerInventory, calculateSlotsUsed } = require('../../services/inventoryService');
const { getPlayerPropertyStatus } = require('../../services/propertyService');
const { getEquippedVehicle } = require('../../services/vehicleService');
const { evaluatePlayerAchievements } = require('../../services/achievementService');
const { getPlayerGachaStats } = require('../../services/gachaService');
const { isNewbieBoostActive } = require('../../services/economyService');
const { getEducation } = require('../../data/education');
const { getJob, getRankForShifts, getNextRank } = require('../../data/jobs');
const { getBackpackByTier } = require('../../data/backpacks');
const { getLevelInfoFromXp } = require('../../data/locations');
const { ITEMS } = require('../../data/items');
const { COLORS, formatLp, renderBar, formatDuration } = require('../../utils/uiBuilder');
const { buildPanel, btn, userSelect } = require('../../utils/panelBuilder');

const TOTAL_FISH_SPECIES = ITEMS.filter(i => i.tags && i.tags.includes('fish')).length;
const TOTAL_MINERAL_TYPES = ITEMS.filter(i => i.tags && i.tags.includes('mineral')).length;

async function fetchProfileData(targetId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, targetId, now, true);
        if (!synced) return null;

        const invRows = await getPlayerInventory(conn, targetId, false, 'bag', now);
        const slotsUsed = calculateSlotsUsed(invRows);
        const propStatus = await getPlayerPropertyStatus(conn, targetId, synced.player.max_slots, now, false);
        const equippedVehicle = await getEquippedVehicle(conn, targetId, false);

        let jobShifts = 0;
        if (synced.player.current_job) {
            const [jRows] = await conn.execute(
                `SELECT shifts_completed FROM player_job_history WHERE discord_id = ? AND job_id = ?`,
                [targetId, synced.player.current_job]
            );
            if (jRows.length > 0) jobShifts = Number(jRows[0].shifts_completed);
        }

        const [colRows] = await conn.execute(
            `SELECT item_id FROM player_collections WHERE discord_id = ?`,
            [targetId]
        );
        const achEval = await evaluatePlayerAchievements(conn, synced.player, now);
        const gachaStats = await getPlayerGachaStats(conn, targetId);

        return {
            player: synced.player,
            buffs: synced.buffs,
            slotsUsed,
            propStatus,
            equippedVehicle,
            jobShifts,
            achEval,
            gachaStats,
            collections: colRows.map(r => r.item_id)
        };
    });
}

function buildProfilePanel({ ownerId, data, banner = null, now = Date.now() }) {
    const { player: p, buffs, slotsUsed, propStatus, equippedVehicle, jobShifts, achEval, collections } = data;
    const gachaStats = data.gachaStats || { total_pulls: 0, jackpot_count: 0 };
    const edu = getEducation(p.education_level);
    const backpack = getBackpackByTier(p.backpack_tier);
    const fishLv = getLevelInfoFromXp(p.fishing_xp);
    const mineLv = getLevelInfoFromXp(p.mining_xp);
    const farmLv = getLevelInfoFromXp(p.farming_xp || 0);
    const cookLv = getLevelInfoFromXp(p.cooking_xp || 0);

    const fishCollected = collections.filter(id => {
        const it = ITEMS.find(x => x.id === id);
        return it && it.tags && it.tags.includes('fish');
    }).length;
    const mineralCollected = collections.filter(id => {
        const it = ITEMS.find(x => x.id === id);
        return it && it.tags && it.tags.includes('mineral');
    }).length;

    let jobText = 'Pengangguran *(Gunakan `/job` untuk melamar)*';
    if (p.current_job) {
        const job = getJob(p.current_job);
        const rank = getRankForShifts(jobShifts);
        const nextRank = getNextRank(jobShifts);
        const nextInfo = nextRank ? ` (${jobShifts}/${nextRank.minShifts} shift ke ${nextRank.name})` : ' (Jabatan Maksimal)';
        jobText = `${job ? `${job.emoji} **${job.name}**` : p.current_job} — Jabatan **${rank.name}**${nextInfo}`;
    }

    let eduText = `${edu.emoji} **${edu.name}**`;
    if (p.study_target) {
        const targetEdu = getEducation(p.study_target);
        eduText += ` *(Sedang menempuh **${targetEdu.id}**: ${p.study_sessions}/${targetEdu.sessionsRequired} sesi)*`;
    }

    const badges = [];
    if (p.equipped_title) badges.push(`**${p.equipped_title}**`);
    if (isNewbieBoostActive(p, now)) {
        const remNewbie = (Number(p.created_at) + 7 * 86400000) - now;
        badges.push(`🌱 **Newbie Boost** (${formatDuration(remNewbie)})`);
    }
    if (Number(p.hospital_until) > now) {
        badges.push(`🏥 **Dirawat di RS** (${formatDuration(Number(p.hospital_until) - now)})`);
    } else if (Number(p.sleeping_until) > now) {
        badges.push(`🛌 **Sedang Tidur** (${formatDuration(Number(p.sleeping_until) - now)})`);
    }
    for (const b of buffs) {
        const rem = Number(b.expires_at) - now;
        if (rem > 0) {
            badges.push(`✨ **${b.buff_type}** (${formatDuration(rem)})`);
        }
    }

    const fishStars = fishLv.masteryStars > 0 ? ` ⭐×${fishLv.masteryStars}` : '';
    const mineStars = mineLv.masteryStars > 0 ? ` ⭐×${mineLv.masteryStars}` : '';
    const farmStars = farmLv.masteryStars > 0 ? ` ⭐×${farmLv.masteryStars}` : '';
    const cookStars = cookLv.masteryStars > 0 ? ` ⭐×${cookLv.masteryStars}` : '';

    const propLabel = propStatus.effectiveTier.id === 'tunawisma'
        ? `${propStatus.effectiveTier.emoji} **${propStatus.effectiveTier.name}**`
        : `${propStatus.effectiveTier.emoji} **${propStatus.effectiveTier.name}** *(${propStatus.row?.ownership_type === 'owned' ? 'Milik Pribadi' : 'Sewa'})*`;

    const vehLabel = equippedVehicle?.vehicle
        ? `${equippedVehicle.vehicle.emoji} **${equippedVehicle.vehicle.name}** *(${equippedVehicle.odometer_km.toFixed(0)} km${equippedVehicle.vehicle.tankCapacity > 0 ? ` · ⛽ ${equippedVehicle.fuel_liters.toFixed(1)}L` : ''})*`
        : '🚶 *Jalan Kaki*';

    const rows = [
        userSelect('profile', 'inspect_user', ownerId, {
            placeholder: '🔍 Pilih warga lain untuk melihat kartu identitasnya...'
        }, now),
        new ActionRowBuilder().addComponents(
            btn('profile', 'me', ownerId, {
                label: 'Profil Saya',
                emoji: '🪪',
                style: p.discord_id === ownerId ? ButtonStyle.Primary : ButtonStyle.Secondary
            }, now),
            btn('profile', 'refresh', ownerId, {
                label: 'Segarkan',
                emoji: '🔄',
                style: ButtonStyle.Secondary,
                arg: p.discord_id
            }, now)
        )
    ];

    return buildPanel({
        mod: 'profile',
        ownerId,
        accentColor: COLORS.LIFE,
        title: `🪪 Kartu Warga: ${p.username}`,
        player: p,
        banner,
        blocks: [
            badges.length > 0 ? badges.join(' · ') : null,
            [
                `💵 **Dompet (Cash):** ${formatLp(p.cash)}`,
                `🏦 **Tabungan Bank:** ${formatLp(p.bank)}`,
                `💎 **Total Kekayaan:** ${formatLp(Number(p.cash) + Number(p.bank))}`
            ].join('\n'),
            [
                '**❤️ Kondisi Tubuh (Stat Vital):**',
                `⚡ Energy : \`${renderBar(p.energy, 100)}\``,
                `🍔 Hunger : \`${renderBar(p.hunger, 100)}\``,
                `💧 Thirst : \`${renderBar(p.thirst, 100)}\``,
                `❤️ Health : \`${renderBar(p.health, 100)}\``
            ].join('\n'),
            [
                '**💼 Karir, Pendidikan & Hunian:**',
                `• Pekerjaan : ${jobText}`,
                `• Total Shift: **${p.total_shifts} shift**`,
                `• Pendidikan: ${eduText}`,
                `• Hunian    : ${propLabel}`,
                `• Kendaraan : ${vehLabel}`
            ].join('\n'),
            [
                '**🎣 Keahlian & Eksplorasi:**',
                `• Fishing : **Lv. ${fishLv.level}**${fishStars} (\`${fishLv.currentXp}/${fishLv.requiredXp} EXP\`)`,
                `• Mining  : **Lv. ${mineLv.level}**${mineStars} (\`${mineLv.currentXp}/${mineLv.requiredXp} EXP\`)`,
                `• Farming : **Lv. ${farmLv.level}**${farmStars} (\`${farmLv.currentXp}/${farmLv.requiredXp} EXP\`)`,
                `• Cooking : **Lv. ${cookLv.level}**${cookStars} (\`${cookLv.currentXp}/${cookLv.requiredXp} EXP\`)`,
                `• Tas     : ${backpack.emoji} **${backpack.name}** (\`${slotsUsed} / ${p.max_slots} slot\`)`,
                `• Koleksi : 🐟 Fishpedia **${fishCollected}/${TOTAL_FISH_SPECIES}** · 💎 Mineral **${mineralCollected}/${TOTAL_MINERAL_TYPES}**`,
                `• Gacha   : 🎰 **${Number(gachaStats.total_pulls || 0)}× Pull** *(👑 ${Number(gachaStats.jackpot_count || gachaStats.jackpots_won || 0)}× Jackpot Legendary)*`,
                `• Prestasi: 🏆 Achievement **${achEval.unlockedCount}/${achEval.totalCount}**${achEval.claimableCount > 0 ? ` *(🎁 ${achEval.claimableCount} siap klaim di /achievements)*` : ''}`
            ].join('\n')
        ],
        rows,
        footer: `Warga sejak ${new Date(Number(p.created_at)).toLocaleDateString('id-ID')} · Streak Harian: ${p.daily_streak} hari`,
        now
    });
}

module.exports = {
    name: 'profile',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Lihat kartu identitas, stat vital, karir, pendidikan, dan koleksi karakter.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const data = await fetchProfileData(interaction.user.id, now);
        return await interaction.reply(
            buildProfilePanel({
                ownerId: interaction.user.id,
                data,
                now
            })
        );
    },

    panel: {
        buttons: {
            async me(interaction) {
                const now = Date.now();
                const data = await fetchProfileData(interaction.user.id, now);
                return await interaction.update(
                    buildProfilePanel({
                        ownerId: interaction.user.id,
                        data,
                        now
                    })
                );
            },
            async refresh(interaction, parsed) {
                const now = Date.now();
                const targetId = parsed.arg || interaction.user.id;
                const data = await fetchProfileData(targetId, now);
                if (!data) {
                    const myData = await fetchProfileData(interaction.user.id, now);
                    return await interaction.update(
                        buildProfilePanel({
                            ownerId: interaction.user.id,
                            data: myData,
                            banner: { type: 'warning', text: 'Warga tersebut belum terdaftar di kota ini.' },
                            now
                        })
                    );
                }
                return await interaction.update(
                    buildProfilePanel({
                        ownerId: interaction.user.id,
                        data,
                        now
                    })
                );
            }
        },
        userSelects: {
            async inspect_user(interaction) {
                const now = Date.now();
                const targetId = interaction.values[0];
                const data = await fetchProfileData(targetId, now);
                if (!data) {
                    const myData = await fetchProfileData(interaction.user.id, now);
                    return await interaction.update(
                        buildProfilePanel({
                            ownerId: interaction.user.id,
                            data: myData,
                            banner: { type: 'warning', text: `Warga <@${targetId}> belum memulai kehidupan di Life Simulation.` },
                            now
                        })
                    );
                }
                return await interaction.update(
                    buildProfilePanel({
                        ownerId: interaction.user.id,
                        data,
                        banner: targetId !== interaction.user.id
                            ? { type: 'info', text: `Menampilkan kartu identitas milik **${data.player.username}**.` }
                            : null,
                        now
                    })
                );
            }
        }
    },

    fetchProfileData,
    buildProfilePanel
};
