const { SlashCommandBuilder } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const {
    getPlayerVehicles,
    getEquippedVehicle,
    buyVehicleCash,
    equipVehicle,
    refuelVehicle,
    serviceVehicle
} = require('../../services/vehicleService');
const {
    FUEL_PRICE_PER_LITER,
    getAllVehicles,
    getVehicle
} = require('../../data/vehicles');
const { COLORS, formatLp, buildV2Card } = require('../../utils/uiBuilder');

const VEHICLE_CHOICES = [
    { name: '🚲 Sepeda Onthel (Lp 1.500.000)', value: 'sepeda' },
    { name: '🛵 Motor Bebek Bekas (Lp 6.000.000)', value: 'motor_bekas' },
    { name: '🏍️ Motor Matic Baru (Lp 22.000.000 · Bisa Kredit)', value: 'motor_baru' },
    { name: '🚗 Mobil Sedan Keluarga (Lp 150.000.000 · Bisa Kredit)', value: 'mobil' }
];

function formatVehicleRowStatus(vRow) {
    const v = vRow.vehicle;
    if (!v) return `• Kendaraan tidak dikenal (${vRow.vehicle_id})`;

    const activeBadge = vRow.is_equipped === 1 ? '🟢 **AKTIF DIPAKAI**' : '⚪ *Tersimpan di Garasi*';
    const fuelText = v.tankCapacity > 0
        ? `⛽ Bensin: **${vRow.fuel_liters.toFixed(2)} / ${v.tankCapacity} L**`
        : '⛽ *Tanpa Bensin (Tenaga Kayuh)*';

    const kmSinceService = Math.max(0, Number((vRow.odometer_km - vRow.last_service_km).toFixed(1)));
    const serviceStatus = vRow.overdue
        ? `⚠️ **WAJIB SERVIS!** (${kmSinceService}/${v.serviceIntervalKm} km · Bonus -50% & 10% risiko mogok)`
        : `🔧 Servis: **${kmSinceService} / ${v.serviceIntervalKm} km** *(Biaya servis: ${formatLp(v.serviceCost)})*`;

    return [
        `${v.emoji} **${v.name}** — ${activeBadge}`,
        `   └ 🛣️ Odometer: **${vRow.odometer_km.toFixed(1)} km** · ${fuelText}`,
        `   └ ${serviceStatus}`
    ].join('\n');
}

module.exports = {
    name: 'vehicle',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('vehicle')
        .setDescription('Kelola garasi kendaraan, beli kendaraan, isi bensin SPBU, dan servis berkala')
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('Lihat katalog dealer kendaraan kota beserta spesifikasi dan bonusnya')
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('Cek kondisi kendaraan di garasimu, sisa bensin, dan odometer servis')
        )
        .addSubcommand(sub =>
            sub.setName('buy')
                .setDescription('Beli kendaraan secara tunai (atau gunakan /credit apply untuk mencicil)')
                .addStringOption(opt =>
                    opt.setName('kendaraan')
                        .setDescription('Pilih kendaraan yang ingin dibeli')
                        .setRequired(true)
                        .addChoices(...VEHICLE_CHOICES)
                )
        )
        .addSubcommand(sub =>
            sub.setName('equip')
                .setDescription('Pilih kendaraan utama yang aktif digunakan untuk bekerja & bepergian')
                .addStringOption(opt =>
                    opt.setName('kendaraan')
                        .setDescription('Pilih kendaraan milikmu')
                        .setRequired(true)
                        .addChoices(...VEHICLE_CHOICES)
                )
        )
        .addSubcommand(sub =>
            sub.setName('refuel')
                .setDescription('Isi bensin kendaraan aktifmu di SPBU (Lp 10.000 per liter)')
                .addNumberOption(opt =>
                    opt.setName('liter')
                        .setDescription('Jumlah liter bensin (kosongkan untuk isi penuh Full Tank)')
                        .setMinValue(0.1)
                        .setMaxValue(40)
                )
        )
        .addSubcommand(sub =>
            sub.setName('service')
                .setDescription('Servis berkala kendaraan di bengkel resmi agar performa kembali 100%')
                .addStringOption(opt =>
                    opt.setName('kendaraan')
                        .setDescription('Pilih kendaraan yang ingin diservis (kosongkan untuk kendaraan aktif)')
                        .addChoices(...VEHICLE_CHOICES)
                )
        ),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        const discordId = interaction.user.id;
        const now = Date.now();

        const payload = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, true);
            const player = synced.player;

            if (sub === 'list') {
                const owned = await getPlayerVehicles(conn, discordId, false);
                const ownedIds = new Set(owned.map(o => o.vehicle_id));

                const lines = getAllVehicles().map(v => {
                    const badge = ownedIds.has(v.id)
                        ? '✅ **Dimiliki**'
                        : (v.canCredit ? `💳 *Bisa Kredit (/credit)*` : `💵 *Tunai*`);
                    const fuelLine = v.tankCapacity > 0
                        ? `Tangki **${v.tankCapacity} L** (Kerja: ${v.fuelPerShift} L · Perjalanan jauh: ${v.fuelPerTrip} L)`
                        : 'Bebas BBM';
                    return [
                        `${v.emoji} **${v.name}** (\`${v.id}\`) — **${formatLp(v.buyPrice)}** · ${badge}`,
                        `• ⛽ ${fuelLine} · 🔧 Servis tiap **${v.serviceIntervalKm} km** (${formatLp(v.serviceCost)})`,
                        `• ✨ Efek: ${v.description}`
                    ].join('\n');
                });

                return buildV2Card({
                    accentColor: COLORS.PRIMARY,
                    title: '🚘 Dealer & Bengkel Kendaraan Kota (/vehicle list)',
                    blocks: [
                        `💵 **Dompet:** ${formatLp(player.cash)} · 🏦 **Bank:** ${formatLp(player.bank)} · ⛽ **Harga BBM SPBU:** ${formatLp(FUEL_PRICE_PER_LITER)}/L`,
                        lines.join('\n\n'),
                        '💡 *Lokasi jauh yang mendapat diskon Energy kendaraan: Danau, Laut, Tambang Tembaga, Emas, & Berlian.*'
                    ]
                });
            }

            if (sub === 'status') {
                const owned = await getPlayerVehicles(conn, discordId, false);
                if (owned.length === 0) {
                    return buildV2Card({
                        accentColor: COLORS.PRIMARY,
                        title: '🚘 Garasi Kendaraanmu Kosong',
                        blocks: [
                            'Kamu belum memiliki kendaraan pribadi.',
                            '• Gunakan `/vehicle list` untuk melihat katalog kendaraan.\n• Gunakan `/vehicle buy` untuk membeli tunai atau `/credit apply` untuk mencicil Motor Baru / Mobil!'
                        ]
                    });
                }

                return buildV2Card({
                    accentColor: COLORS.PRIMARY,
                    title: `🚘 Garasi Kendaraan: ${player.username}`,
                    blocks: [
                        `💵 **Dompet:** ${formatLp(player.cash)} · 🏦 **Bank:** ${formatLp(player.bank)}`,
                        owned.map(formatVehicleRowStatus).join('\n\n'),
                        '💡 *Gunakan `/vehicle refuel` untuk isi bensin di SPBU dan `/vehicle service` saat mendekati batas kilometer servis.*'
                    ]
                });
            }

            if (sub === 'buy') {
                const vehId = interaction.options.getString('kendaraan', true);
                const res = await buyVehicleCash(conn, player, vehId, now);

                if (!res.ok) {
                    let msg = 'Gagal membeli kendaraan.';
                    if (res.error === 'ALREADY_OWNED') {
                        msg = `Kamu sudah memiliki **${res.vehicle.emoji} ${res.vehicle.name}** di garasimu!`;
                    } else if (res.error === 'INSUFFICIENT_FUNDS') {
                        const creditHint = res.vehicle.canCredit
                            ? `\n💡 *Uang tunai belum cukup? Kamu bisa mencicil **${res.vehicle.name}** dengan DP 20% (${formatLp(Math.round(res.required * 0.2))}) lewat \`/credit apply\`!*`
                            : '';
                        msg = `Saldo Cash + Bank kamu (**${formatLp(res.totalFunds)}**) belum cukup untuk membeli **${res.vehicle.emoji} ${res.vehicle.name}** seharga **${formatLp(res.required)}**.${creditHint}`;
                    }
                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '⚠️ Pembelian Kendaraan Gagal',
                        blocks: [msg],
                        ephemeral: true
                    });
                }

                return buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `🎉 Kendaraan Baru Dibeli: ${res.vehicle.emoji} ${res.vehicle.name}!`,
                    blocks: [
                        `Selamat! **${res.vehicle.emoji} ${res.vehicle.name}** telah masuk ke garasimu dengan tangki bensin penuh dan langsung dipasang sebagai kendaraan utama!`,
                        `💳 **Total Dibayar:** **${formatLp(res.paid)}**\n💵 **Sisa Cash:** ${formatLp(res.player.cash)} · 🏦 **Sisa Bank:** ${formatLp(res.player.bank)}`
                    ]
                });
            }

            if (sub === 'equip') {
                const vehId = interaction.options.getString('kendaraan', true);
                const res = await equipVehicle(conn, discordId, vehId);
                if (!res.ok) {
                    const v = getVehicle(vehId);
                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '⚠️ Kendaraan Tidak Dimiliki',
                        blocks: [`Kamu belum memiliki **${v ? `${v.emoji} ${v.name}` : vehId}** di garasimu.`],
                        ephemeral: true
                    });
                }

                return buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `🔑 Kendaraan Utama Diganti: ${res.vehicle.emoji} ${res.vehicle.name}`,
                    blocks: [
                        `Kamu kini menggunakan **${res.vehicle.emoji} ${res.vehicle.name}** untuk bekerja dan bepergian ke lokasi jauh.`,
                        formatVehicleRowStatus({ ...res.row, is_equipped: 1 })
                    ]
                });
            }

            if (sub === 'refuel') {
                const liters = interaction.options.getNumber('liter');
                const res = await refuelVehicle(conn, player, liters, now);

                if (!res.ok) {
                    let msg = 'Tidak dapat mengisi bensin.';
                    if (res.error === 'NO_VEHICLE') msg = 'Kamu belum memiliki kendaraan aktif di garasi.';
                    else if (res.error === 'NO_TANK') msg = `**${res.vehicle.emoji} ${res.vehicle.name}** tidak membutuhkan bensin!`;
                    else if (res.error === 'TANK_ALREADY_FULL') msg = `Tangki **${res.vehicle.emoji} ${res.vehicle.name}** sudah penuh (**${res.currentFuel}/${res.vehicle.tankCapacity} L**)!`;
                    else if (res.error === 'INSUFFICIENT_FUNDS') msg = `Saldo tidak cukup untuk membeli **${res.litersToBuy} L** bensin seharga **${formatLp(res.required)}**.`;

                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '⛽ Gagal Mengisi Bensin SPBU',
                        blocks: [msg],
                        ephemeral: true
                    });
                }

                return buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `⛽ Pengisian BBM Berhasil: +${res.litersAdded} Liter`,
                    blocks: [
                        `Tangki **${res.vehicle.emoji} ${res.vehicle.name}** kini terisi **${res.newFuel} / ${res.vehicle.tankCapacity} Liter**.`,
                        `💳 **Biaya SPBU:** **${formatLp(res.totalCost)}** (${formatLp(FUEL_PRICE_PER_LITER)}/L)\n💵 **Sisa Cash:** ${formatLp(res.player.cash)} · 🏦 **Sisa Bank:** ${formatLp(res.player.bank)}`
                    ]
                });
            }

            if (sub === 'service') {
                const vehId = interaction.options.getString('kendaraan');
                const res = await serviceVehicle(conn, player, vehId, now);

                if (!res.ok) {
                    let msg = 'Tidak dapat melakukan servis kendaraan.';
                    if (res.error === 'NO_VEHICLE' || res.error === 'NOT_OWNED') msg = 'Kamu belum memiliki kendaraan tersebut di garasimu.';
                    else if (res.error === 'ALREADY_FRESH') msg = `Kondisi **${res.vehicle.emoji} ${res.vehicle.name}** masih sangat prima (baru menempuh **${res.kmSinceLast} km** sejak servis terakhir).`;
                    else if (res.error === 'INSUFFICIENT_FUNDS') msg = `Biaya servis berkala **${res.vehicle.emoji} ${res.vehicle.name}** adalah **${formatLp(res.required)}**, sedangkan saldo Cash + Bank kamu **${formatLp(res.totalFunds)}**.`;

                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🔧 Gagal Servis Kendaraan',
                        blocks: [msg],
                        ephemeral: true
                    });
                }

                return buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `🔧 Servis Berkala Selesai: ${res.vehicle.emoji} ${res.vehicle.name}`,
                    blocks: [
                        `Mesin & komponen **${res.vehicle.emoji} ${res.vehicle.name}** telah diservis penuh pada odometer **${res.odometerKm.toFixed(1)} km** (setelah pemakaian ${res.kmServiced} km). Performa kembali **100%**!`,
                        `💳 **Biaya Bengkel:** **${formatLp(res.cost)}**\n💵 **Sisa Cash:** ${formatLp(res.player.cash)} · 🏦 **Sisa Bank:** ${formatLp(res.player.bank)}`
                    ]
                });
            }
        });

        return await interaction.reply(payload);
    }
};
