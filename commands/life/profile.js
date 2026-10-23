const { SlashCommandBuilder } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerInventory, calculateSlotsUsed } = require('../../services/inventoryService');
const { isNewbieBoostActive } = require('../../services/economyService');
const { getEducation } = require('../../data/education');
const { getJob, getRankForShifts, getNextRank } = require('../../data/jobs');
const { getBackpackByTier } = require('../../data/backpacks');
const { getLevelInfoFromXp } = require('../../data/locations');
const { ITEMS } = require('../../data/items');
const { COLORS, formatLp, renderBar, formatDuration, buildV2Card } = require('../../utils/uiBuilder');

const TOTAL_FISH_SPECIES = ITEMS.filter(i => i.tags && i.tags.includes('fish')).length;
const TOTAL_MINERAL_TYPES = ITEMS.filter(i => i.tags && i.tags.includes('mineral')).length;

module.exports = {
    name: 'profile',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Lihat kartu identitas, stat vital, karir, pendidikan, dan koleksi karakter.')
        .addUserOption(opt =>
            opt
                .setName('user')
                .setDescription('Warga lain yang ingin dilihat profilnya')
                .setRequired(false)
        ),

    async executeSlash(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const now = Date.now();

        const data = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, targetUser.id, now, true);
            if (!synced) return null;

            const invRows = await getPlayerInventory(conn, targetUser.id, false);
            const slotsUsed = calculateSlotsUsed(invRows);

            let jobShifts = 0;
            if (synced.player.current_job) {
                const [jRows] = await conn.execute(
                    `SELECT shifts_completed FROM player_job_history WHERE discord_id = ? AND job_id = ?`,
                    [targetUser.id, synced.player.current_job]
                );
                if (jRows.length > 0) jobShifts = Number(jRows[0].shifts_completed);
            }

            const [colRows] = await conn.execute(
                `SELECT item_id FROM player_collections WHERE discord_id = ?`,
                [targetUser.id]
            );

            return {
                player: synced.player,
                buffs: synced.buffs,
                slotsUsed,
                jobShifts,
                collections: colRows.map(r => r.item_id)
            };
        });

        if (!data) {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '❓ Warga Belum Terdaftar',
                    blocks: [`**${targetUser.username}** belum memulai kehidupan di Life Simulation.`],
                    ephemeral: true
                })
            );
        }

        const { player: p, buffs, slotsUsed, jobShifts, collections } = data;
        const edu = getEducation(p.education_level);
        const backpack = getBackpackByTier(p.backpack_tier);
        const fishLv = getLevelInfoFromXp(p.fishing_xp);
        const mineLv = getLevelInfoFromXp(p.mining_xp);

        // Hitung koleksi
        const fishCollected = collections.filter(id => {
            const it = ITEMS.find(x => x.id === id);
            return it && it.tags.includes('fish');
        }).length;
        const mineralCollected = collections.filter(id => {
            const it = ITEMS.find(x => x.id === id);
            return it && it.tags.includes('mineral');
        }).length;

        // Status karir
        let jobText = 'Pengangguran *(Gunakan `/job list` untuk melamar)*';
        if (p.current_job) {
            const job = getJob(p.current_job);
            const rank = getRankForShifts(jobShifts);
            const nextRank = getNextRank(jobShifts);
            const nextInfo = nextRank ? ` (${jobShifts}/${nextRank.minShifts} shift ke ${nextRank.name})` : ' (Jabatan Maksimal)';
            jobText = `${job ? `${job.emoji} **${job.name}**` : p.current_job} — Jabatan **${rank.name}**${nextInfo}`;
        }

        // Status pendidikan
        let eduText = `${edu.emoji} **${edu.name}**`;
        if (p.study_target) {
            const targetEdu = getEducation(p.study_target);
            eduText += ` *(Sedang menempuh **${targetEdu.id}**: ${p.study_sessions}/${targetEdu.sessionsRequired} sesi)*`;
        }

        // Status khusus (RS / Tidur / Newbie / Buff)
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

        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.LIFE,
                title: `🪪 Kartu Warga: ${p.username}`,
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
                        '**💼 Karir & Pendidikan:**',
                        `• Pekerjaan : ${jobText}`,
                        `• Total Shift: **${p.total_shifts} shift**`,
                        `• Pendidikan: ${eduText}`
                    ].join('\n'),
                    [
                        '**🎣 Keahlian & Eksplorasi:**',
                        `• Fishing : **Lv. ${fishLv.level}**${fishStars} (\`${fishLv.currentXp}/${fishLv.requiredXp} EXP\`)`,
                        `• Mining  : **Lv. ${mineLv.level}**${mineStars} (\`${mineLv.currentXp}/${mineLv.requiredXp} EXP\`)`,
                        `• Tas     : ${backpack.emoji} **${backpack.name}** (\`${slotsUsed} / ${p.max_slots} slot\`)`,
                        `• Koleksi : 🐟 Fishpedia **${fishCollected}/${TOTAL_FISH_SPECIES}** · 💎 Mineral **${mineralCollected}/${TOTAL_MINERAL_TYPES}**`
                    ].join('\n')
                ],
                footer: `Warga sejak ${new Date(Number(p.created_at)).toLocaleDateString('id-ID')} · Streak Harian: ${p.daily_streak} hari`
            })
        );
    }
};
