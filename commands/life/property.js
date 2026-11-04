const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const {
    getPlayerPropertyStatus,
    rentProperty,
    buyProperty,
    moveOutProperty,
    calculateProratedUpgradeRent
} = require('../../services/propertyService');
const {
    getPropertyTier,
    getAllPropertyTiers,
    calculateMonthlyPbb
} = require('../../data/properties');
const { COLORS, formatLp, formatDuration } = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select,
    confirmView
} = require('../../utils/panelBuilder');

function formatFacilitiesLine(facilities) {
    const parts = [];
    if (facilities.kulkas > 0) parts.push(`❄️ Kulkas **${facilities.kulkas} slot**`);
    if (facilities.freezer > 0) parts.push(`🧊 Freezer **${facilities.freezer} slot**`);
    if (facilities.stove > 0) parts.push(`🍳 Dapur **${facilities.stove} tungku**`);
    if (facilities.gudang > 0) parts.push(`📦 Gudang **${facilities.gudang} slot**`);
    return parts.length > 0 ? parts.join(' · ') : 'Tidak ada fasilitas penyimpanan/dapur';
}

async function fetchPropertyState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const status = await getPlayerPropertyStatus(conn, discordId, synced.player.max_slots, now, false);
        return { player: synced.player, status };
    });
}

function buildPropertyPanel({
    state,
    selectedTierId = null,
    banner = null,
    now = Date.now()
}) {
    const { player: p, status } = state;
    const ownerId = p.discord_id;
    const cur = status.effectiveTier;
    const row = status.row;
    const allTiers = getAllPropertyTiers();

    const activeTier = selectedTierId ? getPropertyTier(selectedTierId) : null;

    const billingLines = [];
    if (!row || status.isEvicted) {
        billingLines.push('• Status Kontrak: **Tunawisma (Tanpa Tagihan Aktif)**');
        if (status.isEvicted) {
            billingLines.push(`⚠️ *Kontrak **${status.actualTier.name}** berakhir. Isi Kulkas, Freezer, & Gudang tetap aman namun dikunci hingga kamu menyewa/membeli properti lagi.*`);
        }
    } else if (row.ownership_type === 'rent') {
        const remMs = Math.max(0, Number(row.next_billing_at) - now);
        billingLines.push(`• Tipe Hunian   : **Sewa Mingguan (${formatLp(cur.rentPerWeek)}/mgg)**`);
        billingLines.push(`• Jatuh Tempo   : **<t:${Math.floor(Number(row.next_billing_at) / 1000)}:R>** (${formatDuration(remMs)})`);
        if (status.inGracePeriod) {
            const graceRem = Math.max(0, Number(row.grace_until) - now);
            billingLines.push(`🚨 **MASA TENGGANG AKTIF:** Perpanjang sewa dalam **${formatDuration(graceRem)}** agar tidak diusir!`);
        }
    } else {
        const pbb = calculateMonthlyPbb(cur);
        billingLines.push(`• Tipe Hunian   : **Milik Pribadi (Lunas)**`);
        billingLines.push(`• PBB Bulanan   : **${formatLp(pbb)}/bulan** (Jatuh tempo <t:${Math.floor(Number(row.next_billing_at) / 1000)}:R>)`);
    }

    const blocks = [
        [
            `🏠 **Hunianmu Saat Ini:** ${cur.emoji} **${cur.name}**`,
            ...billingLines,
            `• 📦 **Fasilitas Aktif:** ❄️ Kulkas \`${status.capacities.kulkas}\` · 🧊 Freezer \`${status.capacities.freezer}\` · 📦 Gudang \`${status.capacities.gudang}\` · 🍳 Dapur \`${status.capacities.stove} tungku\` · 🧊 Cooler Box \`${status.capacities.coolerbox}\``
        ].join('\n')
    ];

    if (activeTier && activeTier.id !== 'tunawisma') {
        const sleepMin = Math.round(activeTier.sleepDurationSec / 60);
        const pbb = calculateMonthlyPbb(activeTier);
        blocks.push(
            [
                `🔎 **Detail Properti: ${activeTier.emoji} ${activeTier.name}**`,
                `_${activeTier.description}_`,
                `• 📑 Sewa Mingguan : ${activeTier.canRent ? `**${formatLp(activeTier.rentPerWeek)} / minggu**` : '*Tidak disewakan*'}`,
                `• 🏡 Harga Beli    : ${activeTier.canBuy ? `**${formatLp(activeTier.buyPrice)}** *(PBB ${formatLp(pbb)}/bln · Bisa Kredit di \`/credit\`)*` : '*Hanya sewa*'}`,
                `• 🛌 Bonus \`/sleep\` : **+${activeTier.sleepEnergyBonus} ⚡ Energy** (${sleepMin} menit) · Regen Pasif **+${12 + activeTier.passiveEnergyRegenBonus} ⚡/jam**`,
                `• 🏠 Fasilitas     : ${formatFacilitiesLine(activeTier.facilities)}`
            ].join('\n')
        );
    } else {
        const tierBlocks = allTiers.map(t => {
            const priceParts = [];
            if (t.canRent) priceParts.push(`Sewa: **${formatLp(t.rentPerWeek)}/mgg**`);
            if (t.canBuy) priceParts.push(`Beli: **${formatLp(t.buyPrice)}**`);
            return `${t.emoji} **${t.name}** — ${priceParts.join(' · ')}\n   └ 🛌 +${t.sleepEnergyBonus} ⚡ · ${formatFacilitiesLine(t.facilities)}`;
        });
        blocks.push(`**📋 Katalog Properti Kota:**\n${tierBlocks.join('\n')}`);
    }

    const rows = [
        select('property', 'pick', ownerId, {
            placeholder: '🏠 Pilih properti untuk melihat rincian, menyewa, atau membeli...',
            options: allTiers.map(t => {
                const priceParts = [];
                if (t.canRent) priceParts.push(`Sewa ${formatLp(t.rentPerWeek)}/mgg`);
                if (t.canBuy) priceParts.push(`Beli ${formatLp(t.buyPrice)}`);
                return {
                    label: `${t.name}`,
                    value: t.id,
                    emoji: t.emoji,
                    description: `${priceParts.join(' | ')} — ${formatFacilitiesLine(t.facilities).replace(/\*\*/g, '')}`,
                    default: activeTier ? activeTier.id === t.id : false
                };
            })
        }, now)
    ];

    const btnComponents = [];
    if (activeTier && activeTier.id !== 'tunawisma') {
        if (activeTier.canRent) {
            btnComponents.push(
                btn('property', 'rent_prompt', ownerId, {
                    label: `Sewa (${formatLp(activeTier.rentPerWeek)}/mgg)`,
                    emoji: '🔑',
                    style: ButtonStyle.Primary,
                    arg: activeTier.id
                }, now)
            );
        }
        if (activeTier.canBuy) {
            btnComponents.push(
                btn('property', 'buy_prompt', ownerId, {
                    label: `Beli Tunai (${formatLp(activeTier.buyPrice)})`,
                    emoji: '🏡',
                    style: ButtonStyle.Success,
                    arg: activeTier.id
                }, now)
            );
        }
        btnComponents.push(
            btn('property', 'home', ownerId, {
                label: 'Semua Katalog',
                emoji: '📋',
                style: ButtonStyle.Secondary
            }, now)
        );
    }

    if (row && row.ownership_type === 'rent' && !status.isEvicted) {
        btnComponents.push(
            btn('property', 'moveout_prompt', ownerId, {
                label: 'Berhenti Sewa (Moveout)',
                emoji: '📦',
                style: ButtonStyle.Danger
            }, now)
        );
    }

    btnComponents.push(
        btn('property', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary
        }, now)
    );

    rows.push(new ActionRowBuilder().addComponents(btnComponents.slice(0, 5)));

    return buildPanel({
        mod: 'property',
        ownerId,
        accentColor: status.inGracePeriod ? COLORS.WARNING : COLORS.LIFE,
        title: `🏠 Agen Properti & Tempat Tinggal`,
        player: p,
        banner,
        blocks,
        rows,
        footer: 'Gunakan /storage untuk menyimpan barang ke Kulkas/Freezer/Gudang atau /credit untuk mencicil Rumah.',
        now
    });
}

module.exports = {
    name: 'property',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('property')
        .setDescription('Buka panel properti interaktif: sewa kos/kontrakan, beli rumah, atau cek fasilitas hunian.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchPropertyState(interaction.user.id, now);
        return await interaction.reply(buildPropertyPanel({ state, now }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchPropertyState(interaction.user.id, now);
                return await interaction.update(buildPropertyPanel({ state, now }));
            },
            async rent_prompt(interaction, parsed) {
                const now = Date.now();
                const tierId = parsed.arg || 'kos';
                const targetTier = getPropertyTier(tierId);
                const state = await fetchPropertyState(interaction.user.id, now);
                const prorata = calculateProratedUpgradeRent(state.status.row, targetTier, now);

                const prorataText = prorata.unusedCredit > 0
                    ? `\n• Potongan Prorata Sisa Sewa Lama: **-${formatLp(prorata.unusedCredit)}**`
                    : '';

                return await interaction.update(
                    confirmView({
                        mod: 'property',
                        confirmAction: 'rent_confirm',
                        cancelAction: 'home',
                        ownerId: interaction.user.id,
                        title: `🔑 Konfirmasi Sewa ${targetTier.emoji} ${targetTier.name}`,
                        description: [
                            `Kamu akan menyewa **${targetTier.emoji} ${targetTier.name}** dengan rincian:`,
                            `• Biaya Sewa Dasar: **${formatLp(targetTier.rentPerWeek)} / minggu**${prorataText}\n• Total Dibayar Sekarang: **${formatLp(prorata.netPayable)}**`,
                            `• Fasilitas: ${formatFacilitiesLine(targetTier.facilities)}`
                        ],
                        confirmLabel: `Ya, Sewa (${formatLp(prorata.netPayable)})`,
                        confirmStyle: ButtonStyle.Primary,
                        arg: targetTier.id,
                        player: state.player,
                        now
                    })
                );
            },
            async rent_confirm(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const tierId = parsed.arg || 'kos';
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await rentProperty(conn, synced.player, tierId, now);
                });

                const state = await fetchPropertyState(userId, now);
                let banner = null;
                if (res.error === 'ALREADY_OWNED_EQUAL_OR_HIGHER') {
                    banner = { type: 'warning', text: `Kamu sudah memiliki **${res.ownedTier.name}** secara permanen.` };
                } else if (res.error === 'CANNOT_DOWNGRADE_ACTIVE_RENT') {
                    banner = { type: 'warning', text: `Gunakan tombol **Berhenti Sewa (Moveout)** terlebih dahulu jika ingin pindah ke tier sewa yang lebih rendah.` };
                } else if (res.error === 'INSUFFICIENT_FUNDS') {
                    banner = { type: 'danger', text: `Saldo tidak cukup! Butuh **${formatLp(res.cost)}**, sedangkan Cash + Bank kamu **${formatLp(res.totalBalance)}**.` };
                } else {
                    banner = {
                        type: 'success',
                        text: `🔑 Berhasil menyewa **${res.targetTier.emoji} ${res.targetTier.name}** seharga **${formatLp(res.cost)}**!`
                    };
                }

                return await interaction.update(buildPropertyPanel({ state, selectedTierId: tierId, banner, now }));
            },
            async buy_prompt(interaction, parsed) {
                const now = Date.now();
                const tierId = parsed.arg || 'rumah';
                const targetTier = getPropertyTier(tierId);
                const state = await fetchPropertyState(interaction.user.id, now);
                const pbb = calculateMonthlyPbb(targetTier);

                return await interaction.update(
                    confirmView({
                        mod: 'property',
                        confirmAction: 'buy_confirm',
                        cancelAction: 'home',
                        ownerId: interaction.user.id,
                        title: `🏡 Konfirmasi Pembelian ${targetTier.emoji} ${targetTier.name}`,
                        description: [
                            `Kamu akan membeli **${targetTier.emoji} ${targetTier.name}** secara permanen:`,
                            `• Harga Beli Tunai: **${formatLp(targetTier.buyPrice)}**\n• PBB Bulanan (0,2%): **${formatLp(pbb)} / bulan**\n• Fasilitas: ${formatFacilitiesLine(targetTier.facilities)}`,
                            'Apakah kamu yakin ingin menyelesaikan transaksi pembelian properti ini?'
                        ],
                        confirmLabel: `Ya, Beli (${formatLp(targetTier.buyPrice)})`,
                        confirmStyle: ButtonStyle.Success,
                        arg: targetTier.id,
                        player: state.player,
                        now
                    })
                );
            },
            async buy_confirm(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const tierId = parsed.arg || 'rumah';
                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await buyProperty(conn, synced.player, tierId, now);
                });

                const state = await fetchPropertyState(userId, now);
                let banner = null;
                if (res.error === 'ALREADY_OWNED') {
                    banner = { type: 'warning', text: `Kamu sudah memiliki **${res.currentTier.name}**!` };
                } else if (res.error === 'INSUFFICIENT_FUNDS') {
                    banner = { type: 'danger', text: `Saldo tidak cukup! Harga beli **${formatLp(res.cost)}**, sedangkan Cash + Bank kamu **${formatLp(res.totalBalance)}**.` };
                } else {
                    banner = {
                        type: 'success',
                        text: `🎉 Selamat! Kamu resmi memiliki **${res.targetTier.emoji} ${res.targetTier.name}** seharga **${formatLp(res.cost)}**!`
                    };
                }

                return await interaction.update(buildPropertyPanel({ state, selectedTierId: tierId, banner, now }));
            },
            async moveout_prompt(interaction) {
                const now = Date.now();
                const state = await fetchPropertyState(interaction.user.id, now);
                const cur = state.status.effectiveTier;

                return await interaction.update(
                    confirmView({
                        mod: 'property',
                        confirmAction: 'moveout_confirm',
                        cancelAction: 'home',
                        ownerId: interaction.user.id,
                        title: `📦 Konfirmasi Berhenti Menyewa ${cur.emoji} ${cur.name}`,
                        description: [
                            `Apakah kamu yakin ingin mengakhiri masa sewa **${cur.emoji} ${cur.name}** sekarang?`,
                            '• Seluruh barang yang masih berada di Kulkas, Freezer, atau Gudang **tidak hilang**, namun dikunci sementara hingga kamu menyewa atau membeli properti lagi.'
                        ],
                        confirmLabel: 'Ya, Berhenti Sewa',
                        confirmStyle: ButtonStyle.Danger,
                        player: state.player,
                        now
                    })
                );
            },
            async moveout_confirm(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;
                const res = await withTransaction(async (conn) => {
                    await syncPlayerVitals(conn, userId, now, true);
                    return await moveOutProperty(conn, userId, now);
                });

                const state = await fetchPropertyState(userId, now);
                const banner = res.error
                    ? { type: 'warning', text: 'Tidak dapat mengakhiri sewa properti saat ini.' }
                    : { type: 'info', text: `📦 Kamu telah berhenti menyewa **${res.prevTier.emoji} ${res.prevTier.name}**.` };
                return await interaction.update(buildPropertyPanel({ state, banner, now }));
            }
        },
        selects: {
            async pick(interaction) {
                const now = Date.now();
                const tierId = interaction.values[0] || '';
                const state = await fetchPropertyState(interaction.user.id, now);
                return await interaction.update(
                    buildPropertyPanel({
                        state,
                        selectedTierId: tierId,
                        now
                    })
                );
            }
        }
    },

    buildPropertyPanel
};
