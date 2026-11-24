const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonStyle
} = require('discord.js');
const {
    LIVESTOCK_LIMITS,
    LIVESTOCK_SPECIES,
    calculatePenRentPrice,
    calculatePenBuyPrice,
    getLivestockSpecies
} = require('../../data/livestock');
const {
    fetchTernakState,
    rentOrBuyPen,
    buyAndPlaceLivestock,
    feedAllPens,
    harvestAllPens,
    cleanRetiredPens,
    releaseRentedPen,
    unlockLockedPens
} = require('../../services/livestockService');
const { buildCityGatePanel } = require('../../services/cityService');
const { getItem } = require('../../data/items');
const { COLORS, formatLp } = require('../../utils/uiBuilder');
const { buildPanel, btn, select, confirmView } = require('../../utils/panelBuilder');
const { scheduleAutoUpdate, cancelAutoUpdate } = require('../../services/autoUpdateService');

function scheduleTernakAutoUpdate(userId, interaction, state) {
    if (!interaction || interaction.isLiveSyncProbe) return;
    if ((state?.player?.current_city || 'kota_sentral') !== 'kota_timur') {
        cancelAutoUpdate(`ternak:${userId}`);
        return;
    }
    const pendingMs = (state.pens || [])
        .filter(pen => !pen.is_locked && pen.phase === 2 && Number(pen.remainingMs || 0) > 0)
        .map(pen => Number(pen.remainingMs));

    if (pendingMs.length === 0) {
        cancelAutoUpdate(`ternak:${userId}`);
        return;
    }

    const delayMs = Math.max(500, Math.min(...pendingMs) + 500);
    scheduleAutoUpdate(`ternak:${userId}`, interaction, delayMs, async () => {
        const readyNow = Date.now();
        const freshState = await fetchTernakState(userId, readyNow);
        scheduleTernakAutoUpdate(userId, interaction, freshState);
        return buildTernakPanel({
            state: freshState,
            banner: {
                type: 'success',
                text: '🥚 **Hasil ternakmu di kandang baru saja siap dipanen!** Klik **🧺 Panen Semua** untuk mengambil ke tas.'
            },
            now: readyNow
        });
    });
}

function formatPenLine(pen) {
    const typeTag = pen.ownership_type === 'owned' ? '🏡 Milik' : '📑 Sewa';
    if (pen.is_locked) {
        return `🔒 **Kandang #${pen.pen_number}** (${typeTag}) — **TERKUNCI** *(Tunggakan sewa mingguan)*`;
    }
    if (pen.phase === 0 || !pen.species_id) {
        return `⬜ **Kandang #${pen.pen_number}** (${typeTag}) — *Kosong (Siap diisi ternak)*`;
    }
    const sp = getLivestockSpecies(pen.species_id);
    const spName = sp ? `${sp.emoji} **${sp.name}**` : pen.species_id;
    const cycleTag = `\`${pen.cycles_left}/${sp ? sp.maxCycles : '?'} siklus\``;

    if (pen.phase === 1) {
        const feedHint = sp
            ? sp.feedOptions.map(o => `${o.qty}× ${(getItem(o.itemId)?.name || o.itemId)}`).join(' / ')
            : 'Pakan';
        return `🍽️ **Kandang #${pen.pen_number}** (${typeTag}) — ${spName} (${cycleTag}): **Butuh Pakan** *(${feedHint})*`;
    }
    if (pen.phase === 2) {
        const unix = Math.floor(pen.mature_at / 1000);
        return `⏳ **Kandang #${pen.pen_number}** (${typeTag}) — ${spName} (${cycleTag}): Panen **<t:${unix}:R>**`;
    }
    if (pen.phase === 3) {
        return `🥚 **Kandang #${pen.pen_number}** (${typeTag}) — ${spName} (${cycleTag}): **SIAP PANEN!**`;
    }
    return `🧹 **Kandang #${pen.pen_number}** (${typeTag}) — ${spName}: **Terbengkalai (>36j), perlu dibersihkan**`;
}

function buildTernakPanel({
    state,
    selectedSpeciesId = null,
    banner = null,
    ephemeral = false,
    now = Date.now()
}) {
    const { player: p, pens = [], lvInfo, slotsUsed, feedStock = {} } = state;
    const ownerId = p.discord_id;

    if ((p.current_city || 'kota_sentral') !== 'kota_timur') {
        return buildCityGatePanel({
            player: p,
            requiredCityId: 'kota_timur',
            facilityTitle: 'Peternakan Kandang (/ternak)',
            reasonText: 'Lahan kandang peternakan hanya berlokasi di kawasan hijau **🏞️ Lembah Hijau (`kota_timur`)** yang bebas polusi industri.',
            ephemeral,
            now
        });
    }

    const rentedCount = pens.filter(x => x.ownership_type === 'rented').length;
    const ownedCount = pens.filter(x => x.ownership_type === 'owned').length;
    const lockedCount = pens.filter(x => x.is_locked === 1).length;
    const emptyUnlocked = pens.filter(x => !x.is_locked && x.phase === 0).length;
    const hungryCount = pens.filter(x => !x.is_locked && x.phase === 1).length;
    const readyCount = pens.filter(x => !x.is_locked && x.phase === 3).length;
    const dirtyCount = pens.filter(x => !x.is_locked && x.phase === 4).length;

    const nextRentCost = calculatePenRentPrice(rentedCount + 1);
    const nextBuyCost = calculatePenBuyPrice(ownedCount + 1);
    const activeSpecies = getLivestockSpecies(selectedSpeciesId) || LIVESTOCK_SPECIES[0];

    const feedLine = `🌽 Jagung: \`${feedStock.jagung || 0}\` · 🥬 Bayam: \`${feedStock.bayam || 0}\` · 🌾 Pelet Pakan: \`${feedStock.pakan_ternak || 0}\``;
    const blocks = [
        [
            `🐄 **Lahan Kandang:** \`${pens.length}/${LIVESTOCK_LIMITS.MAX_TOTAL_PENS}\` *(Sewa: ${rentedCount}/${LIVESTOCK_LIMITS.MAX_RENTED_PENS} · Milik: ${ownedCount})*`,
            `✨ **Skill Farming:** **Lv. ${lvInfo.level}** · 🎒 **Tas:** \`${slotsUsed}/${p.max_slots} slot\``,
            `🧺 **Stok Pakan:** ${feedLine}`
        ].join('\n')
    ];

    if (pens.length === 0) {
        blocks.push(`Kamu belum memiliki kandang ternak di Lembah Hijau!\nSewa kandang pertamamu mulai **${formatLp(nextRentCost)}/minggu** atau beli permanen **${formatLp(nextBuyCost)}**.`);
    } else {
        blocks.push(pens.map(formatPenLine).join('\n'));
    }

    if (activeSpecies) {
        const yItem = getItem(activeSpecies.yieldItemId);
        blocks.push(
            `🐾 **Bibit Dipilih:** ${activeSpecies.emoji} **${activeSpecies.name}** — **${formatLp(activeSpecies.buyPrice)}** *(Min Farming Lv. ${activeSpecies.minLevel} · Panen ${activeSpecies.yieldQty}× ${yItem ? yItem.name : activeSpecies.yieldItemId} / ${activeSpecies.cycleHours}j × ${activeSpecies.maxCycles} siklus)*`
        );
    }

    const rows = [];
    rows.push(
        select('ternak', 'pick_species', ownerId, {
            placeholder: '🐾 Pilih Jenis Hewan Ternak...',
            options: LIVESTOCK_SPECIES.map(sp => ({
                label: `${sp.name} (${formatLp(sp.buyPrice)} · Lv.${sp.minLevel}+)`.slice(0, 100),
                value: sp.id,
                emoji: sp.emoji,
                description: sp.description.slice(0, 100),
                default: sp.id === activeSpecies.id
            }))
        }, now)
    );

    rows.push(
        new ActionRowBuilder().addComponents(
            btn('ternak', 'buy_animal', ownerId, {
                label: `Taruh ${activeSpecies.name.split(' ')[0]} (${formatLp(activeSpecies.buyPrice)})`,
                emoji: activeSpecies.emoji,
                style: ButtonStyle.Success,
                arg: activeSpecies.id,
                disabled: emptyUnlocked <= 0 || lvInfo.level < activeSpecies.minLevel
            }, now),
            btn('ternak', 'feed_all', ownerId, {
                label: `Beri Pakan (${hungryCount})`,
                emoji: '🌾',
                style: ButtonStyle.Primary,
                disabled: hungryCount <= 0
            }, now),
            btn('ternak', 'harvest_all', ownerId, {
                label: `Panen Semua (${readyCount})`,
                emoji: '🧺',
                style: ButtonStyle.Success,
                disabled: readyCount <= 0
            }, now),
            btn('ternak', 'clean_all', ownerId, {
                label: `Bersihkan (${dirtyCount})`,
                emoji: '🧹',
                style: ButtonStyle.Secondary,
                disabled: dirtyCount <= 0
            }, now)
        )
    );

    const penButtons = [
        btn('ternak', 'rent_pen', ownerId, {
            label: `Sewa Kandang (${formatLp(nextRentCost)}/mgg)`,
            emoji: '📑',
            style: ButtonStyle.Primary,
            disabled: pens.length >= LIVESTOCK_LIMITS.MAX_TOTAL_PENS || rentedCount >= LIVESTOCK_LIMITS.MAX_RENTED_PENS
        }, now),
        btn('ternak', 'buy_pen', ownerId, {
            label: `Beli Kandang (${formatLp(nextBuyCost)})`,
            emoji: '🏡',
            style: ButtonStyle.Secondary,
            disabled: pens.length >= LIVESTOCK_LIMITS.MAX_TOTAL_PENS
        }, now)
    ];

    if (lockedCount > 0) {
        penButtons.push(
            btn('ternak', 'unlock_pens', ownerId, {
                label: `Lunasi Tunggakan (${lockedCount})`,
                emoji: '🔓',
                style: ButtonStyle.Danger
            }, now)
        );
    }

    const canReleaseRent = pens.some(x => x.ownership_type === 'rented' && (x.phase === 0 || x.phase === 4 || x.is_locked === 1));
    if (canReleaseRent) {
        penButtons.push(
            btn('ternak', 'release_rent', ownerId, {
                label: 'Lepas Sewa',
                emoji: '📤',
                style: ButtonStyle.Secondary
            }, now)
        );
    }

    rows.push(new ActionRowBuilder().addComponents(penButtons.slice(0, 5)));

    return buildPanel({
        mod: 'ternak',
        ownerId,
        accentColor: COLORS.ACT,
        title: '🐄 Peternakan Lembah Hijau (/ternak)',
        player: p,
        banner,
        blocks,
        rows,
        footer: 'Gunakan hasil Jagung & Bayam dari /farm atau beli Pelet Pakan Ternak di /shop (Toko Tani).',
        ephemeral,
        now
    });
}

function formatTernakBanner(res) {
    if (!res.ok) {
        if (res.error === 'WRONG_CITY') return { type: 'warning', text: 'Kamu harus berada di **🏞️ Lembah Hijau** untuk mengelola kandang ternak.' };
        if (res.error === 'MAX_TOTAL_PENS') return { type: 'warning', text: `Kapasitas maksimal **${res.maxTotal} kandang** sudah tercapai.` };
        if (res.error === 'MAX_RENTED_PENS') return { type: 'warning', text: `Batas kandang sewa (**${res.maxRented} kandang**) tercapai. Beli kandang permanen untuk memperluas!` };
        if (res.error === 'INSUFFICIENT_FUNDS') return { type: 'danger', text: `Saldo tidak cukup! Butuh **${formatLp(res.cost)}**, saldo Cash + Bank kamu **${formatLp(res.totalFunds)}**.` };
        if (res.error === 'LEVEL_TOO_LOW') return { type: 'warning', text: `${res.species.emoji} **${res.species.name}** membutuhkan minimal **Farming Lv. ${res.minLevel}** (Levelmu: Lv. ${res.currentLevel}).` };
        if (res.error === 'NO_EMPTY_PEN') return { type: 'warning', text: 'Tidak ada kandang kosong yang aktif. Sewa/beli kandang atau panen/bersihkan kandang lebih dulu.' };
        if (res.error === 'LOW_ENERGY') return { type: 'warning', text: '⚡ Energy habis! Istirahat di `/sleep` atau konsumsi makanan dulu.' };
        if (res.error === 'NO_FEED_IN_BAG') return { type: 'warning', text: 'Stok pakan di tas tidak mencukupi! Siapkan **🌽 Jagung**, **🥬 Bayam**, atau beli **🌾 Pelet Pakan Ternak** di `/shop`.' };
        if (res.error === 'BAG_FULL') return { type: 'warning', text: `Tas penuh (${res.slotsAfter}/${res.maxSlots} slot)! Kosongkan tas sebelum memanen ternak.` };
        if (res.error === 'NO_RELEASABLE_RENTED_PEN') return { type: 'warning', text: 'Hanya kandang sewa yang sedang kosong, terbengkalai, atau terkunci yang dapat dilepas.' };
        return { type: 'info', text: 'Tidak ada perubahan yang dapat diproses saat ini.' };
    }

    if (res.ownershipType) {
        return {
            type: 'success',
            text: `Berhasil ${res.ownershipType === 'owned' ? 'membeli permanen' : 'menyewa'} **Kandang #${res.penNumber}** seharga **${formatLp(res.cost)}**!`
        };
    }
    if (res.species) {
        return {
            type: 'success',
            text: `Berhasil menempatkan ${res.species.emoji} **${res.species.name}** ke **Kandang #${res.penNumber}** (${formatLp(res.cost)}). Klik **🌾 Beri Pakan** untuk memulai siklus produksi!`
        };
    }
    if (res.fedCount) {
        return {
            type: 'success',
            text: `Berhasil memberi pakan **${res.fedCount} kandang** *(⚡ -${res.energySpent} Energy)*! Produksi telur/susu dimulai.`
        };
    }
    if (res.harvestedCount) {
        const gainStr = res.gains
            .map(g => {
                const it = getItem(g.itemId);
                return `${g.qty}× ${it ? `${it.emoji} ${it.name}` : g.itemId}`;
            })
            .join(', ');
        const retireNote = res.retiredCount > 0 ? ` · ${res.retiredCount} ternak masuk masa pensiun (+Daging)` : '';
        const lvNote = res.leveledUp ? ` · 🎉 Farming Lv. ${res.newLevel}!` : '';
        return {
            type: 'success',
            text: `Memanen **${res.harvestedCount} kandang**: **${gainStr}** *(+${res.xpGained} Farming EXP${retireNote}${lvNote})*!`
        };
    }
    if (res.cleanedCount) {
        return { type: 'success', text: `Berhasil membersihkan **${res.cleanedCount} kandang** yang terbengkalai.` };
    }
    if (res.unlockedCount) {
        return { type: 'success', text: `Berhasil melunasi tunggakan dan membuka **${res.unlockedCount} kandang** (${formatLp(res.cost)})!` };
    }
    if (res.penNumber) {
        return { type: 'success', text: `Sewa **Kandang #${res.penNumber}** telah dilepas.` };
    }
    return { type: 'success', text: 'Aksi kandang selesai.' };
}

module.exports = {
    name: 'ternak',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('ternak')
        .setDescription('Kelola kandang ayam, bebek, dan kambing di Lembah Hijau untuk panen telur & susu.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchTernakState(interaction.user.id, now);
        scheduleTernakAutoUpdate(interaction.user.id, interaction, state);
        return await interaction.reply(buildTernakPanel({ state, now }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchTernakState(interaction.user.id, now);
                scheduleTernakAutoUpdate(interaction.user.id, interaction, state);
                return await interaction.update({ ...buildTernakPanel({ state, now }), attachments: [] });
            },
            async rent_pen(interaction) {
                const now = Date.now();
                const res = await rentOrBuyPen(interaction.user.id, 'rented', now);
                const state = await fetchTernakState(interaction.user.id, now);
                scheduleTernakAutoUpdate(interaction.user.id, interaction, state);
                return await interaction.update({
                    ...buildTernakPanel({ state, banner: formatTernakBanner(res), now }),
                    attachments: []
                });
            },
            async buy_pen(interaction) {
                const now = Date.now();
                const stateBefore = await fetchTernakState(interaction.user.id, now);
                const ownedCount = stateBefore.pens.filter(x => x.ownership_type === 'owned').length;
                const price = calculatePenBuyPrice(ownedCount + 1);
                return await interaction.update({
                    ...confirmView({
                        mod: 'ternak',
                        confirmAction: 'buy_pen_confirm',
                        cancelAction: 'home',
                        ownerId: interaction.user.id,
                        title: '🏡 Konfirmasi Beli Kandang Permanen',
                        description: `Apakah kamu yakin ingin membeli **1× Kandang Ternak Permanen** seharga **${formatLp(price)}**? *(Bebas biaya sewa mingguan selamanya)*`,
                        confirmLabel: `Beli (${formatLp(price)})`,
                        confirmStyle: ButtonStyle.Success,
                        now
                    }),
                    attachments: []
                });
            },
            async buy_pen_confirm(interaction) {
                const now = Date.now();
                const res = await rentOrBuyPen(interaction.user.id, 'owned', now);
                const state = await fetchTernakState(interaction.user.id, now);
                scheduleTernakAutoUpdate(interaction.user.id, interaction, state);
                return await interaction.update({
                    ...buildTernakPanel({ state, banner: formatTernakBanner(res), now }),
                    attachments: []
                });
            },
            async buy_animal(interaction, parsed) {
                const now = Date.now();
                const speciesId = parsed.arg || 'ayam_kampung';
                const res = await buyAndPlaceLivestock(interaction.user.id, speciesId, now);
                const state = await fetchTernakState(interaction.user.id, now);
                scheduleTernakAutoUpdate(interaction.user.id, interaction, state);
                return await interaction.update({
                    ...buildTernakPanel({ state, selectedSpeciesId: speciesId, banner: formatTernakBanner(res), now }),
                    attachments: []
                });
            },
            async feed_all(interaction) {
                const now = Date.now();
                const res = await feedAllPens(interaction.user.id, now);
                const state = await fetchTernakState(interaction.user.id, now);
                scheduleTernakAutoUpdate(interaction.user.id, interaction, state);
                return await interaction.update({
                    ...buildTernakPanel({ state, banner: formatTernakBanner(res), now }),
                    attachments: []
                });
            },
            async harvest_all(interaction) {
                const now = Date.now();
                const res = await harvestAllPens(interaction.user.id, now);
                const state = await fetchTernakState(interaction.user.id, now);
                scheduleTernakAutoUpdate(interaction.user.id, interaction, state);
                return await interaction.update({
                    ...buildTernakPanel({ state, banner: formatTernakBanner(res), now }),
                    attachments: []
                });
            },
            async clean_all(interaction) {
                const now = Date.now();
                const res = await cleanRetiredPens(interaction.user.id, now);
                const state = await fetchTernakState(interaction.user.id, now);
                scheduleTernakAutoUpdate(interaction.user.id, interaction, state);
                return await interaction.update({
                    ...buildTernakPanel({ state, banner: formatTernakBanner(res), now }),
                    attachments: []
                });
            },
            async unlock_pens(interaction) {
                const now = Date.now();
                const res = await unlockLockedPens(interaction.user.id, now);
                const state = await fetchTernakState(interaction.user.id, now);
                scheduleTernakAutoUpdate(interaction.user.id, interaction, state);
                return await interaction.update({
                    ...buildTernakPanel({ state, banner: formatTernakBanner(res), now }),
                    attachments: []
                });
            },
            async release_rent(interaction) {
                const now = Date.now();
                const res = await releaseRentedPen(interaction.user.id, now);
                const state = await fetchTernakState(interaction.user.id, now);
                scheduleTernakAutoUpdate(interaction.user.id, interaction, state);
                return await interaction.update({
                    ...buildTernakPanel({ state, banner: formatTernakBanner(res), now }),
                    attachments: []
                });
            }
        },
        selects: {
            async pick_species(interaction) {
                const now = Date.now();
                const speciesId = interaction.values[0] || 'ayam_kampung';
                const state = await fetchTernakState(interaction.user.id, now);
                scheduleTernakAutoUpdate(interaction.user.id, interaction, state);
                return await interaction.update({
                    ...buildTernakPanel({ state, selectedSpeciesId: speciesId, now }),
                    attachments: []
                });
            }
        }
    },

    buildTernakPanel,
    fetchTernakState
};
