const { SlashCommandBuilder } = require('discord.js');
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
const { COLORS, formatLp, formatDuration, buildV2Card } = require('../../utils/uiBuilder');

const PROPERTY_CHOICES = [
    { name: '🛏️ Kamar Kos Sederhana (Sewa Lp 70rb/mgg)', value: 'kos' },
    { name: '🏘️ Kontrakan Petak (Sewa Lp 175rb/mgg)', value: 'kontrakan' },
    { name: '🏠 Rumah Pribadi (Sewa Lp 450rb/mgg · Beli Lp 75jt)', value: 'rumah' },
    { name: '🏰 Rumah Mewah / Mansion (Beli Lp 600jt)', value: 'rumah_mewah' }
];

const RENTABLE_CHOICES = PROPERTY_CHOICES.filter(c => c.value !== 'rumah_mewah');
const BUYABLE_CHOICES = PROPERTY_CHOICES.filter(c => c.value === 'rumah' || c.value === 'rumah_mewah');

function formatFacilitiesLine(facilities) {
    const parts = [];
    if (facilities.kulkas > 0) parts.push(`❄️ Kulkas **${facilities.kulkas} slot**`);
    if (facilities.freezer > 0) parts.push(`🧊 Freezer **${facilities.freezer} slot**`);
    if (facilities.stove > 0) parts.push(`🍳 Dapur **${facilities.stove} tungku**`);
    if (facilities.gudang > 0) parts.push(`📦 Gudang **${facilities.gudang} slot**`);
    return parts.length > 0 ? parts.join(' · ') : 'Tidak ada fasilitas penyimpanan/dapur';
}

module.exports = {
    name: 'property',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('property')
        .setDescription('Kelola tempat tinggal: sewa kos/kontrakan, beli rumah, atau cek fasilitas hunian.')
        .addSubcommand(sub =>
            sub.setName('list').setDescription('Lihat daftar properti (Kos, Kontrakan, Rumah, Rumah Mewah) dan fasilitasnya.')
        )
        .addSubcommand(sub =>
            sub
                .setName('info')
                .setDescription('Lihat rincian lengkap fasilitas, biaya sewa/beli, dan bonus dari satu properti.')
                .addStringOption(opt =>
                    opt
                        .setName('tier')
                        .setDescription('Pilih jenis properti')
                        .setRequired(true)
                        .addChoices(...PROPERTY_CHOICES)
                )
        )
        .addSubcommand(sub =>
            sub.setName('status').setDescription('Cek status hunianmu saat ini, jadwal sewa/PBB, dan kapasitas fasilitas.')
        )
        .addSubcommand(sub =>
            sub
                .setName('rent')
                .setDescription('Sewa properti mingguan atau upgrade ke tier lebih tinggi (prorata otomatis).')
                .addStringOption(opt =>
                    opt
                        .setName('tier')
                        .setDescription('Pilih properti yang ingin disewa')
                        .setRequired(true)
                        .addChoices(...RENTABLE_CHOICES)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('buy')
                .setDescription('Beli Rumah Pribadi atau Rumah Mewah secara tunai.')
                .addStringOption(opt =>
                    opt
                        .setName('tier')
                        .setDescription('Pilih properti yang ingin dibeli')
                        .setRequired(true)
                        .addChoices(...BUYABLE_CHOICES)
                )
        )
        .addSubcommand(sub =>
            sub.setName('moveout').setDescription('Akhiri masa sewa properti saat ini (isi penyimpanan dikunci namun tetap aman).')
        ),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        const discordId = interaction.user.id;
        const now = Date.now();

        if (sub === 'list') {
            const data = await withTransaction(async (conn) => {
                const synced = await syncPlayerVitals(conn, discordId, now, false);
                const status = await getPlayerPropertyStatus(conn, discordId, synced.player.max_slots, now, false);
                return { player: synced.player, status };
            });

            const tiers = getAllPropertyTiers();
            const tierBlocks = tiers.map(t => {
                const priceParts = [];
                if (t.canRent) priceParts.push(`Sewa: **${formatLp(t.rentPerWeek)}/mgg**`);
                if (t.canBuy) priceParts.push(`Beli: **${formatLp(t.buyPrice)}** *(PBB ${formatLp(calculateMonthlyPbb(t))}/bln)*`);

                const sleepDurationMin = Math.round(t.sleepDurationSec / 60);
                const regenPart = t.passiveEnergyRegenBonus > 0 ? ` · Regen Pasif **+${t.passiveEnergyRegenBonus} ⚡/jam**` : '';

                return [
                    `${t.emoji} **${t.name}** (\`${t.id}\`)`,
                    `• 💰 ${priceParts.join(' · ')}`,
                    `• 🛌 Tidur: **+${t.sleepEnergyBonus} ⚡ Energy** (${sleepDurationMin} mnt)${regenPart}`,
                    `• 🏠 Fasilitas: ${formatFacilitiesLine(t.facilities)}`
                ].join('\n');
            });

            const cur = data.status.effectiveTier;
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.LIFE,
                    title: '🏠 Katalog Properti & Tempat Tinggal Kota',
                    blocks: [
                        `📍 **Hunianmu Saat Ini:** ${cur.emoji} **${cur.name}** · 💵 Cash: **${formatLp(data.player.cash)}** · 🏦 Bank: **${formatLp(data.player.bank)}**`,
                        ...tierBlocks
                    ],
                    footer: 'Gunakan /property rent tier:<nama> untuk menyewa atau /property buy tier:<nama> untuk membeli.'
                })
            );
        }

        if (sub === 'info') {
            const tierId = interaction.options.getString('tier', true);
            const t = getPropertyTier(tierId);
            const sleepMin = Math.round(t.sleepDurationSec / 60);
            const pbb = calculateMonthlyPbb(t);

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.LIFE,
                    title: `${t.emoji} Info Properti: ${t.name}`,
                    blocks: [
                        t.description,
                        [
                            '**💰 Biaya & Kepemilikan:**',
                            `• Sewa Mingguan : ${t.canRent ? `**${formatLp(t.rentPerWeek)} / minggu**` : '*Tidak bisa disewa*'}`,
                            `• Harga Beli    : ${t.canBuy ? `**${formatLp(t.buyPrice)}**` : '*Hanya sewa*'}`,
                            `• PBB Bulanan   : ${pbb > 0 ? `**${formatLp(pbb)} / bulan (0,2%)**` : 'Bebas PBB'}`
                        ].join('\n'),
                        [
                            '**✨ Fasilitas & Keuntungan:**',
                            `• 🛌 Bonus \`/sleep\` : **+${t.sleepEnergyBonus} ⚡ Energy** (durasi ${sleepMin} menit)`,
                            `• ⚡ Regen Pasif    : **+${12 + t.passiveEnergyRegenBonus} Energy/jam** *(+${t.passiveEnergyRegenBonus} bonus)*`,
                            `• ❄️ Kulkas         : **${t.facilities.kulkas} slot** *(memperlambat basi 3× lipat)*`,
                            `• 🧊 Freezer        : **${t.facilities.freezer} slot** *(makanan/ikan tidak basi)*`,
                            `• 🍳 Dapur          : **${t.facilities.stove} tungku masak**`,
                            `• 📦 Gudang         : **${t.facilities.gudang} slot** *(perluasan tas barang tidak basi)*`
                        ].join('\n')
                    ],
                    ephemeral: true
                })
            );
        }

        if (sub === 'status') {
            const data = await withTransaction(async (conn) => {
                const synced = await syncPlayerVitals(conn, discordId, now, false);
                const status = await getPlayerPropertyStatus(conn, discordId, synced.player.max_slots, now, false);
                return { player: synced.player, status };
            });

            const { status } = data;
            const cur = status.effectiveTier;
            const row = status.row;

            const billingLines = [];
            if (!row || status.isEvicted) {
                billingLines.push('• Status Kontrak: **Tunawisma (Tanpa Tagihan Aktif)**');
                if (status.isEvicted) {
                    billingLines.push(`⚠️ *Kontrak **${status.actualTier.name}** sebelumnya berakhir/diusir. Isi Kulkas, Freezer, dan Gudangmu tetap tersimpan aman namun dikunci sampai kamu menyewa/membeli properti lagi.*`);
                }
            } else if (row.ownership_type === 'rent') {
                const remMs = Math.max(0, Number(row.next_billing_at) - now);
                billingLines.push(`• Tipe Hunian   : **Sewa Mingguan (${formatLp(cur.rentPerWeek)}/mgg)**`);
                billingLines.push(`• Jatuh Tempo   : **${formatDuration(remMs)}** (<t:${Math.floor(Number(row.next_billing_at) / 1000)}:R>)`);
                if (status.inGracePeriod) {
                    const graceRem = Math.max(0, Number(row.grace_until) - now);
                    billingLines.push(`🚨 **MASA TENGGANG AKTIF:** Lunasi sewa dalam **${formatDuration(graceRem)}** dengan \`/property rent tier:${cur.id}\` agar tidak diusir!`);
                }
            } else {
                const pbb = calculateMonthlyPbb(cur);
                const remMs = Math.max(0, Number(row.next_billing_at) - now);
                billingLines.push(`• Tipe Hunian   : **Milik Pribadi (Lunas)**`);
                billingLines.push(`• PBB Bulanan   : **${formatLp(pbb)}/bulan** (Jatuh tempo <t:${Math.floor(Number(row.next_billing_at) / 1000)}:R>)`);
            }

            return await interaction.reply(
                buildV2Card({
                    accentColor: status.inGracePeriod ? COLORS.WARNING : COLORS.LIFE,
                    title: `${cur.emoji} Status Hunian: ${cur.name}`,
                    blocks: [
                        cur.description,
                        billingLines.join('\n'),
                        [
                            '**📦 Kapasitas Fasilitas Aktif:**',
                            `• 🎒 Tas Pribadi : **${status.capacities.bag} slot**`,
                            `• 🧊 Cooler Box  : **${status.capacities.coolerbox} slot** ${status.hasCoolerBox ? '*(Aktif)*' : '*(Belum punya — beli di Toko Perkakas)*'}`,
                            `• ❄️ Kulkas      : **${status.capacities.kulkas} slot**`,
                            `• 🧊 Freezer     : **${status.capacities.freezer} slot**`,
                            `• 📦 Gudang      : **${status.capacities.gudang} slot**`,
                            `• 🍳 Tungku Dapur: **${status.capacities.stove} tungku**`
                        ].join('\n')
                    ],
                    footer: 'Gunakan /storage view untuk melihat dan memindahkan barang ke Kulkas/Freezer/Gudang.'
                })
            );
        }

        if (sub === 'rent') {
            const tierId = interaction.options.getString('tier', true);
            const res = await withTransaction(async (conn) => {
                const synced = await syncPlayerVitals(conn, discordId, now, true);
                return await rentProperty(conn, synced.player, tierId, now);
            });

            if (res.error === 'ALREADY_OWNED_EQUAL_OR_HIGHER') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🏠 Kamu Sudah Memiliki Properti Sendiri',
                        blocks: [`Kamu sudah memiliki **${res.ownedTier.emoji} ${res.ownedTier.name}** secara permanen, sehingga tidak perlu menyewa properti ini.`],
                        ephemeral: true
                    })
                );
            }

            if (res.error === 'CANNOT_DOWNGRADE_ACTIVE_RENT') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '⚠️ Tidak Dapat Downgrade Sewa Langsung',
                        blocks: [
                            `Kamu sedang menyewa **${res.currentTier.emoji} ${res.currentTier.name}**. Jika ingin pindah ke tier yang lebih rendah, gunakan \`/property moveout\` terlebih dahulu.`
                        ],
                        ephemeral: true
                    })
                );
            }

            if (res.error === 'INSUFFICIENT_FUNDS') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.DANGER,
                        title: '💸 Saldo Tidak Cukup untuk Menyewa',
                        blocks: [
                            `Biaya sewa **${res.targetTier.emoji} ${res.targetTier.name}** adalah **${formatLp(res.cost)}**, sedangkan total saldo Cash + Bank kamu **${formatLp(res.totalBalance)}**.`
                        ],
                        ephemeral: true
                    })
                );
            }

            const prorataNote = res.prorata.unusedCredit > 0
                ? `\n• 🔄 **Potongan Prorata Sewa Lama:** -${formatLp(res.prorata.unusedCredit)} *(Harga dasar ${formatLp(res.prorata.baseRent)})*`
                : '';

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `🔑 Berhasil Menyewa ${res.targetTier.emoji} ${res.targetTier.name}!`,
                    blocks: [
                        `Selamat menempati hunian barumu! Seluruh fasilitas **${res.targetTier.name}** kini sudah aktif.`,
                        [
                            `• 💳 **Biaya Dibayar:** **${formatLp(res.cost)}**${prorataNote}`,
                            `• 📅 **Tagihan Berikutnya:** <t:${Math.floor(res.nextBillingAt / 1000)}:F> (<t:${Math.floor(res.nextBillingAt / 1000)}:R>)`,
                            `• 🏠 **Fasilitas Terbuka:** ${formatFacilitiesLine(res.targetTier.facilities)}`,
                            `• 💵 **Sisa Cash:** ${formatLp(res.player.cash)} · 🏦 **Sisa Bank:** ${formatLp(res.player.bank)}`
                        ].join('\n')
                    ],
                    footer: 'Gunakan /storage put untuk menyimpan ikan/makanan ke Kulkas atau Freezer agar awet!'
                })
            );
        }

        if (sub === 'buy') {
            const tierId = interaction.options.getString('tier', true);
            const res = await withTransaction(async (conn) => {
                const synced = await syncPlayerVitals(conn, discordId, now, true);
                return await buyProperty(conn, synced.player, tierId, now);
            });

            if (res.error === 'ALREADY_OWNED') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🏠 Properti Sudah Dimiliki',
                        blocks: [`Kamu sudah memiliki **${res.currentTier.emoji} ${res.currentTier.name}**!`],
                        ephemeral: true
                    })
                );
            }

            if (res.error === 'INSUFFICIENT_FUNDS') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.DANGER,
                        title: '💸 Saldo Tidak Cukup untuk Membeli Properti',
                        blocks: [
                            `Harga beli **${res.targetTier.emoji} ${res.targetTier.name}** adalah **${formatLp(res.cost)}**, sedangkan total saldo Cash + Bank kamu **${formatLp(res.totalBalance)}**.`
                        ],
                        ephemeral: true
                    })
                );
            }

            const pbb = calculateMonthlyPbb(res.targetTier);
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `🎉 Selamat! Kamu Resmi Memiliki ${res.targetTier.emoji} ${res.targetTier.name}!`,
                    blocks: [
                        `Sertifikat kepemilikan **${res.targetTier.name}** kini tercatat atas namamu!`,
                        [
                            `• 💰 **Harga Pembelian:** **${formatLp(res.cost)}**`,
                            `• 🏛️ **PBB Bulanan (0,2%):** **${formatLp(pbb)} / bulan**`,
                            `• 🛌 **Bonus Tidur & Regen:** +${res.targetTier.sleepEnergyBonus} Energy · Regen +${res.targetTier.passiveEnergyRegenBonus}/jam`,
                            `• 🏠 **Fasilitas Terbuka:** ${formatFacilitiesLine(res.targetTier.facilities)}`,
                            `• 💵 **Sisa Cash:** ${formatLp(res.player.cash)} · 🏦 **Sisa Bank:** ${formatLp(res.player.bank)}`
                        ].join('\n')
                    ]
                })
            );
        }

        if (sub === 'moveout') {
            const res = await withTransaction(async (conn) => {
                await syncPlayerVitals(conn, discordId, now, true);
                return await moveOutProperty(conn, discordId, now);
            });

            if (res.error === 'NO_ACTIVE_PROPERTY') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '⛺ Kamu Belum Menyewa Properti',
                        blocks: ['Saat ini kamu tidak memiliki kontrak sewa properti yang aktif.'],
                        ephemeral: true
                    })
                );
            }

            if (res.error === 'CANNOT_MOVEOUT_OWNED') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🏠 Properti Milik Pribadi',
                        blocks: ['Rumah yang sudah dibeli menjadi hak milik permanen dan tidak bisa di-`moveout`. Kamu tetap bisa upgrade ke Rumah Mewah kapan saja.'],
                        ephemeral: true
                    })
                );
            }

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.PRIMARY,
                    title: `📦 Berhenti Menyewa ${res.prevTier.emoji} ${res.prevTier.name}`,
                    blocks: [
                        'Kamu telah mengakhiri masa sewa propertimu.',
                        '🔒 **Catatan Penyimpanan:** Seluruh barang yang masih berada di Kulkas, Freezer, atau Gudang **tidak hilang**, namun dikunci sementara hingga kamu menyewa atau membeli properti lagi.'
                    ]
                })
            );
        }
    }
};
