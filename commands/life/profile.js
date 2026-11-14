const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerInventory, calculateSlotsUsed } = require('../../services/inventoryService');
const { getPlayerPropertyStatus } = require('../../services/propertyService');
const { getEquippedVehicle } = require('../../services/vehicleService');
const { evaluatePlayerAchievements } = require('../../services/achievementService');
const { getPlayerGachaStats } = require('../../services/gachaService');
const {
    getPlayerWardrobeState,
    formatEquippedSummaryLines
} = require('../../services/avatarService');
const {
    buildProfileBannerAttachment,
    getCityTheme
} = require('../../services/profileBannerService');
const { getEducation } = require('../../data/education');
const { getJob, getRankForShifts, getNextRank } = require('../../data/jobs');
const { getBackpackByTier } = require('../../data/backpacks');
const { getLevelInfoFromXp } = require('../../data/locations');
const { getCity } = require('../../data/cities');
const { ITEMS } = require('../../data/items');
const { formatLp, renderBar, formatDuration } = require('../../utils/uiBuilder');
const { buildPanel, btn, userSelect } = require('../../utils/panelBuilder');

const TOTAL_FISH_SPECIES = ITEMS.filter(item => item.tags?.includes('fish')).length;
const TOTAL_MINERAL_TYPES = ITEMS.filter(item => item.tags?.includes('mineral')).length;

const PROFILE_PAGES = {
    life: {
        label: 'Kehidupan & Aset',
        title: 'Kehidupan & Aset',
        emoji: '🏙️'
    },
    progress: {
        label: 'Skill & Rekor',
        title: 'Skill & Rekor',
        emoji: '📈'
    }
};

function normalizeProfilePage(page) {
    if (page === 'summary') return 'life';
    return PROFILE_PAGES[page] ? page : 'life';
}

async function fetchProfileData(targetId, now = Date.now()) {
    const dbData = await withTransaction(async conn => {
        const synced = await syncPlayerVitals(conn, targetId, now, true);
        if (!synced) return null;

        const invRows = await getPlayerInventory(conn, targetId, false, 'bag', now);
        const slotsUsed = calculateSlotsUsed(invRows);
        const propStatus = await getPlayerPropertyStatus(conn, targetId, synced.player.max_slots, now, false);
        const equippedVehicle = await getEquippedVehicle(conn, targetId, false);

        let jobShifts = 0;
        if (synced.player.current_job) {
            const [jobRows] = await conn.execute(
                'SELECT shifts_completed FROM player_job_history WHERE discord_id = ? AND job_id = ?',
                [targetId, synced.player.current_job]
            );
            if (jobRows.length > 0) jobShifts = Number(jobRows[0].shifts_completed);
        }

        const [collectionRows] = await conn.execute(
            'SELECT item_id FROM player_collections WHERE discord_id = ?',
            [targetId]
        );
        const achEval = await evaluatePlayerAchievements(conn, synced.player, now);
        const gachaStats = await getPlayerGachaStats(conn, targetId);
        const wardrobe = await getPlayerWardrobeState(conn, targetId, false);

        return {
            player: synced.player,
            buffs: synced.buffs,
            slotsUsed,
            propStatus,
            equippedVehicle,
            jobShifts,
            achEval,
            gachaStats,
            wardrobe,
            collections: collectionRows.map(row => row.item_id)
        };
    });

    if (!dbData) return null;

    const bannerImage = await buildProfileBannerAttachment(dbData, now);
    return { ...dbData, bannerImage };
}

function buildActiveStatusTimerLines(player, buffs, now) {
    const lines = [];

    if (Number(player.hospital_until || 0) > now) {
        const rem = Number(player.hospital_until) - now;
        const ts = Math.floor(Number(player.hospital_until) / 1000);
        lines.push(`🏥 **Dirawat RS:** Selesai <t:${ts}:R> (${formatDuration(rem)})`);
    }
    if (Number(player.sleeping_until || 0) > now) {
        const rem = Number(player.sleeping_until) - now;
        const ts = Math.floor(Number(player.sleeping_until) / 1000);
        lines.push(`🛌 **Sedang Tidur:** Bangun <t:${ts}:R> (${formatDuration(rem)})`);
    }

    for (const buff of buffs || []) {
        if (buff.buff_type === 'motel_sleep') continue;
        const rem = Number(buff.expires_at || 0) - now;
        if (rem > 0) {
            const ts = Math.floor(Number(buff.expires_at) / 1000);
            lines.push(`✨ **Buff ${buff.buff_type}:** Aktif <t:${ts}:R> (${formatDuration(rem)})`);
        }
    }

    return lines;
}

function formatBriefOutfitBuffSummary(wardrobeBuffs) {
    if (!wardrobeBuffs || !Array.isArray(wardrobeBuffs.activeItems) || wardrobeBuffs.activeItems.length === 0) {
        return null;
    }

    const parts = [];
    if (wardrobeBuffs.workSalaryBonus > 0) {
        parts.push(`+${Math.round(wardrobeBuffs.workSalaryBonus * 100)}% Gaji Umum`);
    }
    if (wardrobeBuffs.jobBonuses) {
        for (const [jId, val] of Object.entries(wardrobeBuffs.jobBonuses)) {
            if (val > 0) {
                const jobObj = getJob(jId);
                parts.push(`+${Math.round(val * 100)}% Gaji ${jobObj ? jobObj.name : jId}`);
            }
        }
    }
    if (wardrobeBuffs.fishingXpBonus > 0) {
        parts.push(`+${Math.round(wardrobeBuffs.fishingXpBonus * 100)}% EXP Fishing`);
    }
    if (wardrobeBuffs.farmingXpBonus > 0) {
        parts.push(`+${Math.round(wardrobeBuffs.farmingXpBonus * 100)}% EXP Farming`);
    }
    if (wardrobeBuffs.miningAccidentReduction > 0) {
        parts.push(`-${Math.round(wardrobeBuffs.miningAccidentReduction * 100)}% Risiko Tambang`);
    }

    return parts.length > 0 ? `✨ **Bonus Busana:** ${parts.join(' · ')}` : null;
}

function buildSkillProgressLine(emoji, label, skill) {
    const currentXp = Math.max(0, Math.floor(Number(skill.currentXp) || 0));
    const requiredXp = Math.max(0, Math.floor(Number(skill.requiredXp) || 0));
    const safeCurrent = requiredXp > 0 ? Math.min(currentXp, requiredXp) : 0;
    const percentage = requiredXp > 0
        ? Math.min(100, Math.floor((currentXp / requiredXp) * 100))
        : 100;
    const progressBar = requiredXp > 0
        ? renderBar(safeCurrent, requiredXp)
        : renderBar(1, 1);
    const xpLabel = requiredXp > 0
        ? `${currentXp.toLocaleString('id-ID')}/${requiredXp.toLocaleString('id-ID')} EXP`
        : 'Maksimal';
    const mastery = skill.masteryStars > 0 ? ` ⭐×${skill.masteryStars}` : '';

    return `**${emoji} ${label} · Lv.${skill.level}**${mastery}\n${progressBar}  · ${xpLabel} · ${percentage}%`;
}

function buildProfileRows({ ownerId, targetId, page, achEval, now }) {
    const activePage = normalizeProfilePage(page);
    const activeStyle = (key) => activePage === key ? ButtonStyle.Primary : ButtonStyle.Secondary;
    const targetArg = { arg: targetId };
    const isSelf = String(targetId) === String(ownerId);
    const claimableCount = Number(achEval?.claimableCount || 0);

    const row1 = userSelect('profile', 'inspect_user', ownerId, {
        placeholder: '🔍 Cari profil warga...',
        arg: activePage
    }, now);

    const row2 = new ActionRowBuilder().addComponents(
        btn('profile', 'life', ownerId, {
            ...targetArg,
            label: 'Kehidupan & Aset',
            emoji: '🏙️',
            style: activeStyle('life')
        }, now),
        btn('profile', 'progress', ownerId, {
            ...targetArg,
            label: 'Skill & Rekor',
            emoji: '📈',
            style: activeStyle('progress')
        }, now)
    );

    const row3Buttons = [];
    if (isSelf) {
        row3Buttons.push(
            btn('profile', 'open_wardrobe', ownerId, {
                label: 'Outfit',
                emoji: '👔',
                style: ButtonStyle.Success
            }, now),
            btn('travel', 'home', ownerId, {
                label: 'Peta Kota',
                emoji: '🗺️',
                style: ButtonStyle.Secondary
            }, now)
        );
        if (activePage === 'progress' || claimableCount > 0) {
            row3Buttons.push(
                btn('profile', 'open_achievements', ownerId, {
                    label: claimableCount > 0 ? `Prestasi (${claimableCount})` : 'Prestasi',
                    emoji: '🏆',
                    style: claimableCount > 0 ? ButtonStyle.Primary : ButtonStyle.Secondary
                }, now)
            );
        }
        row3Buttons.push(
            btn('profile', 'refresh', ownerId, {
                label: 'Refresh',
                emoji: '🔄',
                style: ButtonStyle.Secondary,
                arg: `${activePage}|${targetId}`
            }, now)
        );
    } else {
        row3Buttons.push(
            btn('profile', 'me', ownerId, {
                label: 'Profil Saya',
                emoji: '🪪',
                style: ButtonStyle.Primary
            }, now),
            btn('profile', 'open_pay', ownerId, {
                label: 'Transfer Lp',
                emoji: '💸',
                style: ButtonStyle.Success,
                arg: targetId
            }, now),
            btn('profile', 'refresh', ownerId, {
                label: 'Refresh',
                emoji: '🔄',
                style: ButtonStyle.Secondary,
                arg: `${activePage}|${targetId}`
            }, now)
        );
    }

    return [
        row1,
        row2,
        new ActionRowBuilder().addComponents(row3Buttons)
    ];
}

function buildProfilePanel({
    ownerId,
    data,
    page = 'life',
    targetId = data?.player?.discord_id || ownerId,
    banner = null,
    now = Date.now()
}) {
    if (!data?.player) throw new TypeError('buildProfilePanel membutuhkan data.player yang valid.');

    const activePage = normalizeProfilePage(page);
    const {
        player: p,
        buffs = [],
        slotsUsed = 0,
        propStatus,
        equippedVehicle,
        jobShifts = 0,
        achEval,
        collections = []
    } = data;

    const gachaStats = data.gachaStats || { total_pulls: 0, jackpot_count: 0 };
    const edu = getEducation(p.education_level);
    const backpack = getBackpackByTier(p.backpack_tier);

    const fishLv = getLevelInfoFromXp(p.fishing_xp);
    const mineLv = getLevelInfoFromXp(p.mining_xp);
    const farmLv = getLevelInfoFromXp(p.farming_xp || 0);
    const cookLv = getLevelInfoFromXp(p.cooking_xp || 0);

    const fishCollected = collections.filter(id => {
        const item = ITEMS.find(entry => entry.id === id);
        return item?.tags?.includes('fish');
    }).length;
    const mineralCollected = collections.filter(id => {
        const item = ITEMS.find(entry => entry.id === id);
        return item?.tags?.includes('mineral');
    }).length;

    const curCity = getCity(p.current_city);
    const cityTheme = data.bannerImage?.cityTheme || getCityTheme(curCity.id);
    const cityLabel = Number(p.traveling_until || 0) > now
        ? `🚗 ${getCity(p.travel_origin).shortName} → ${getCity(p.travel_destination).shortName} · tiba <t:${Math.floor(Number(p.traveling_until) / 1000)}:R>`
        : `${curCity.emoji} ${curCity.name}`;

    const propertyCity = getCity(propStatus?.propertyCityId);
    const effTier = propStatus?.effectiveTier;
    const propertyLabel = !effTier || effTier.id === 'tunawisma'
        ? `${effTier?.emoji || '🏚️'} ${effTier?.name || 'Tunawisma'}`
        : `${effTier.emoji} ${effTier.name} · ${propStatus?.row?.ownership_type === 'owned' ? 'Milik pribadi' : 'Sewa'} · ${propertyCity.shortName}`;

    const vehicleLabel = equippedVehicle?.vehicle
        ? `${equippedVehicle.vehicle.emoji} ${equippedVehicle.vehicle.name} · ${Number(equippedVehicle.odometer_km || 0).toFixed(0)} km${equippedVehicle.vehicle.tankCapacity > 0 ? ` · ⛽ ${Number(equippedVehicle.fuel_liters || 0).toFixed(1)} L` : ''}`
        : '🚶 Jalan kaki';
    const outfitLabel = formatEquippedSummaryLines(data.wardrobe?.equipped || null);
    const outfitBuffLine = formatBriefOutfitBuffSummary(data.wardrobe?.buffs);

    let jobText = 'Belum bekerja · gunakan /job';
    if (p.current_job) {
        const job = getJob(p.current_job);
        const rank = getRankForShifts(jobShifts);
        const nextRank = getNextRank(jobShifts);
        const nextInfo = nextRank
            ? ` · ${jobShifts}/${nextRank.minShifts} shift menuju ${nextRank.name}`
            : ' · Jabatan maksimal';
        jobText = `${job ? `${job.emoji} ${job.name}` : p.current_job} · ${rank.name}${nextInfo}`;
    }

    let educationText = `${edu.emoji} ${edu.name}`;
    if (p.study_target) {
        const targetEducation = getEducation(p.study_target);
        educationText += ` · Sedang belajar ${targetEducation.id} (${p.study_sessions}/${targetEducation.sessionsRequired} sesi)`;
    }

    const activeStatusLines = buildActiveStatusTimerLines(p, buffs, now);

    const lifeBlocks = [
        ...(activeStatusLines.length > 0
            ? [[ '**⏱️ STATUS & TIMER AKTIF**', ...activeStatusLines ].join('\n')]
            : []),
        [
            '**💰 RINCIAN KEUANGAN**',
            `💵 **Cash** · ${formatLp(p.cash)}`,
            `🏦 **Bank** · ${formatLp(p.bank)}`
        ].join('\n'),
        [
            '**📍 LOKASI & HUNIAN**',
            `Kota saat ini: **${cityLabel}**`,
            `Tempat tinggal: **${propertyLabel}**`
        ].join('\n'),
        [
            '**💼 KARIER & PENDIDIKAN**',
            `Pekerjaan: **${jobText}**`,
            `Total shift: **${Number(p.total_shifts) || 0}**`,
            `Pendidikan: **${educationText}**`
        ].join('\n'),
        [
            '**🚘 KENDARAAN & PENAMPILAN**',
            `Kendaraan: **${vehicleLabel}**`,
            `Busana: ${outfitLabel}`,
            ...(outfitBuffLine ? [outfitBuffLine] : [])
        ].join('\n')
    ];

    const claimableCount = Number(achEval?.claimableCount || 0);
    const progressBlocks = [
        [
            '**🎯 LEVEL & PENGALAMAN**',
            buildSkillProgressLine('🎣', 'Fishing', fishLv),
            buildSkillProgressLine('⛏️', 'Mining', mineLv),
            buildSkillProgressLine('🌾', 'Farming', farmLv),
            buildSkillProgressLine('🍳', 'Cooking', cookLv)
        ].join('\n\n'),
        [
            '**🎒 TAS & ENSIKLOPEDIA**',
            `Tas: ${backpack.emoji} **${backpack.name}** · ${slotsUsed}/${p.max_slots} slot`,
            `🐟 Fishpedia: **${fishCollected}/${TOTAL_FISH_SPECIES}** spesies`,
            `💎 Mineral: **${mineralCollected}/${TOTAL_MINERAL_TYPES}** jenis`
        ].join('\n'),
        [
            '**🏆 PENCAPAIAN & GACHA**',
            `🎰 Gacha: **${Number(gachaStats.total_pulls || 0)}× pull**`,
            `👑 Jackpot legendary: **${Number(gachaStats.jackpot_count || gachaStats.jackpots_won || 0)}×**`,
            `🏆 Achievement: **${Number(achEval?.unlockedCount || 0)}/${Number(achEval?.totalCount || 0)}** terbuka`,
            ...(claimableCount > 0 ? [`🎁 **${claimableCount}** hadiah siap diklaim di /achievements`] : [])
        ].join('\n')
    ];

    const pageBlocks = activePage === 'progress' ? progressBlocks : lifeBlocks;
    const mediaObj = data.bannerImage || data.avatar;

    const blocks = [
        ...(mediaObj ? [{
            image: {
                url: mediaObj.url,
                description: `Banner Profil ${p.username}`
            }
        }] : []),
        ...pageBlocks
    ];

    const joinedAt = new Date(Number(p.created_at || now)).toLocaleDateString('id-ID');
    const footer = `Warga sejak ${joinedAt}  ·  🔥 Streak ${Number(p.daily_streak) || 0} hari`;

    return buildPanel({
        mod: 'profile',
        ownerId,
        accentColor: cityTheme.containerColor,
        title: null,
        banner,
        blocks,
        rows: buildProfileRows({ ownerId, targetId, page: activePage, achEval, now }),
        footer,
        files: mediaObj ? [mediaObj.attachment] : undefined,
        now
    });
}

async function updateProfilePage(interaction, parsed, page) {
    const now = Date.now();
    const activePage = normalizeProfilePage(page);
    const targetId = parsed?.arg || interaction.user.id;
    let data = await fetchProfileData(targetId, now);
    let banner = null;
    let activeTargetId = targetId;

    if (!data) {
        activeTargetId = interaction.user.id;
        data = await fetchProfileData(activeTargetId, now);
        banner = {
            type: 'warning',
            text: 'Warga tersebut belum terdaftar di kota ini. Menampilkan profil Anda.'
        };
        return interaction.update(buildProfilePanel({
            ownerId: interaction.user.id,
            targetId: activeTargetId,
            data,
            page: 'life',
            banner,
            now
        }));
    }

    if (activeTargetId !== interaction.user.id) {
        banner = {
            type: 'info',
            text: `Menampilkan profil **${data.player.username}**.`
        };
    }

    return interaction.update(buildProfilePanel({
        ownerId: interaction.user.id,
        targetId: activeTargetId,
        data,
        page: activePage,
        banner,
        now
    }));
}

module.exports = {
    name: 'profile',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Lihat kartu identitas, banner profil, kehidupan & aset, serta skill warga.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const data = await fetchProfileData(interaction.user.id, now);

        if (!data) {
            return interaction.reply({
                content: 'Kamu belum terdaftar di Life Simulation.',
                ephemeral: true
            });
        }

        return interaction.reply(buildProfilePanel({
            ownerId: interaction.user.id,
            targetId: interaction.user.id,
            data,
            page: 'life',
            now
        }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                return updateProfilePage(interaction, { arg: interaction.user.id }, 'life');
            },

            async summary(interaction, parsed) {
                return updateProfilePage(interaction, parsed, 'life');
            },

            async life(interaction, parsed) {
                return updateProfilePage(interaction, parsed, 'life');
            },

            async progress(interaction, parsed) {
                return updateProfilePage(interaction, parsed, 'progress');
            },

            async me(interaction) {
                return updateProfilePage(interaction, { arg: interaction.user.id }, 'life');
            },

            async refresh(interaction, parsed) {
                const rawArg = String(parsed?.arg || '');
                let page = 'life';
                let targetId = interaction.user.id;

                if (rawArg.includes('|')) {
                    const [rawPage, rawTarget] = rawArg.split('|');
                    page = normalizeProfilePage(rawPage);
                    targetId = rawTarget || interaction.user.id;
                } else if (rawArg) {
                    targetId = rawArg;
                }

                return updateProfilePage(interaction, { arg: targetId }, page);
            },

            async open_wardrobe(interaction) {
                const now = Date.now();
                const { fetchWardrobePanelData, buildWardrobePanel } = require('./wardrobe');
                const state = await fetchWardrobePanelData(interaction.user.id, now);
                return interaction.update({
                    ...buildWardrobePanel({
                        ownerId: interaction.user.id,
                        state,
                        selectedSlot: 'top',
                        now
                    }),
                    attachments: []
                });
            },

            async open_achievements(interaction) {
                const now = Date.now();
                const { fetchAchievementsState, buildAchievementsPanel } = require('./achievements');
                const state = await fetchAchievementsState(interaction.user.id, now);
                return interaction.update({
                    ...buildAchievementsPanel({ state, now }),
                    attachments: []
                });
            },

            async open_pay(interaction, parsed) {
                const now = Date.now();
                const targetId = parsed?.arg || null;
                if (!targetId || targetId === interaction.user.id) {
                    const myData = await fetchProfileData(interaction.user.id, now);
                    return interaction.update(buildProfilePanel({
                        ownerId: interaction.user.id,
                        targetId: interaction.user.id,
                        data: myData,
                        page: 'life',
                        banner: {
                            type: 'warning',
                            text: 'Pilih warga lain terlebih dahulu sebelum mengirim transfer.'
                        },
                        now
                    }));
                }

                const { fetchPayState, buildPayPanel } = require('../economy/pay');
                const state = await fetchPayState(interaction.user.id, targetId, now);

                if (Number(state.sender?.traveling_until || 0) > now) {
                    const inspectTarget = targetId || interaction.user.id;
                    const data = await fetchProfileData(inspectTarget, now);
                    const activeTargetId = data ? inspectTarget : interaction.user.id;
                    const safeData = data || await fetchProfileData(activeTargetId, now);
                    return interaction.update(buildProfilePanel({
                        ownerId: interaction.user.id,
                        targetId: activeTargetId,
                        data: safeData,
                        page: 'life',
                        banner: {
                            type: 'warning',
                            text: '🚗 Fitur transfer `/pay` tidak dapat digunakan selama kamu sedang dalam perjalanan antar-kota.'
                        },
                        now
                    }));
                }

                if (!targetId || !state.receiver) {
                    const myData = await fetchProfileData(interaction.user.id, now);
                    return interaction.update(buildProfilePanel({
                        ownerId: interaction.user.id,
                        targetId: interaction.user.id,
                        data: myData,
                        page: 'life',
                        banner: {
                            type: 'warning',
                            text: 'Warga tujuan tidak ditemukan atau belum terdaftar di Life Simulation.'
                        },
                        now
                    }));
                }

                return interaction.update({
                    ...buildPayPanel({ state, targetId, now }),
                    attachments: []
                });
            }
        },

        userSelects: {
            async inspect_user(interaction, parsed) {
                const now = Date.now();
                const activePage = normalizeProfilePage(parsed?.arg);
                const targetId = interaction.values[0];
                const data = await fetchProfileData(targetId, now);

                if (!data) {
                    const myData = await fetchProfileData(interaction.user.id, now);
                    return interaction.update(buildProfilePanel({
                        ownerId: interaction.user.id,
                        targetId: interaction.user.id,
                        data: myData,
                        page: activePage,
                        banner: {
                            type: 'warning',
                            text: `Warga <@${targetId}> belum memulai kehidupan di Life Simulation.`
                        },
                        now
                    }));
                }

                return interaction.update(buildProfilePanel({
                    ownerId: interaction.user.id,
                    targetId,
                    data,
                    page: activePage,
                    banner: targetId !== interaction.user.id
                        ? {
                            type: 'info',
                            text: `Menampilkan profil **${data.player.username}**.`
                        }
                        : null,
                    now
                }));
            }
        }
    },

    PROFILE_PAGES,
    normalizeProfilePage,
    fetchProfileData,
    buildProfilePanel
};
