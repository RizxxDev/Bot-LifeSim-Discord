const { SlashCommandBuilder } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const {
    CREDIT_RULES,
    calculateCreditPlan,
    calculateEarlyPayoff,
    getActiveCredits,
    getPlayerNetIncomeLast7Days,
    applyCredit,
    payCreditInstallment,
    payoffCreditEarly
} = require('../../services/creditService');
const {
    COLORS,
    formatLp,
    formatDuration,
    buildV2Card
} = require('../../utils/uiBuilder');

const CREDIT_ASSET_CHOICES = [
    { name: '🏍️ Motor Matic Baru (Harga Lp 22 Juta · DP Lp 4,4 Juta)', value: 'motor_baru' },
    { name: '🚗 Mobil Sedan Keluarga (Harga Lp 150 Juta · DP Lp 30 Juta)', value: 'mobil' },
    { name: '🏠 Rumah Pribadi (Harga Lp 75 Juta · DP Lp 15 Juta)', value: 'rumah' },
    { name: '🏰 Rumah Mewah / Mansion (Harga Lp 600 Juta · DP Lp 120 Juta)', value: 'rumah_mewah' }
];

const TENOR_CHOICES = [
    { name: '4 Minggu (Bunga Flat 5%)', value: 4 },
    { name: '8 Minggu (Bunga Flat 8%)', value: 8 },
    { name: '12 Minggu (Bunga Flat 10%)', value: 12 },
    { name: '24 Minggu (Bunga Flat 15%)', value: 24 }
];

function formatCreditStatusBlock(c, now = Date.now()) {
    const assetLabel = c.asset ? `${c.asset.emoji} **${c.asset.name}**` : `**${c.asset_id}**`;
    const remWeeks = Math.max(0, c.tenor_weeks - c.weeks_paid);
    const early = calculateEarlyPayoff(c);
    const dueInSec = Math.max(0, Math.ceil((c.next_due_at - now) / 1000));
    const statusBadge = c.missed_weeks > 0
        ? `⚠️ **MENUNGGAK ${c.missed_weeks} MINGGU** *(Segera bayar lewat \`/credit pay\` agar aset tidak disita!)*`
        : `🟢 **Lancar** · Jatuh tempo berikutnya: **${formatDuration(dueInSec)}**`;

    return [
        `📄 **Kredit #${c.id} (${c.asset_category === 'vehicle' ? 'Kendaraan' : 'Properti'}):** ${assetLabel}`,
        `• Status: ${statusBadge}`,
        `• Progres Tenor: **${c.weeks_paid} / ${c.tenor_weeks} minggu** *(Sisa ${remWeeks}x cicilan)*`,
        `• Cicilan Mingguan: **${formatLp(c.weekly_installment)} / minggu**`,
        `• Pelunasan Dipercepat (\`/credit payoff\`): **${formatLp(early.totalPayoff)}** *(Hemat bunga ${formatLp(early.interestSaved)})*`
    ].join('\n');
}

module.exports = {
    name: 'credit',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('credit')
        .setDescription('Ajukan pembiayaan kredit kendaraan & properti, cek tagihan, atau lunasi cicilan')
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('Lihat status kontrak kredit aktif, batas kemampuan cicilan, dan simulasi tenor')
        )
        .addSubcommand(sub =>
            sub.setName('apply')
                .setDescription('Ajukan kredit Motor Baru, Mobil, Rumah, atau Rumah Mewah (DP 20%)')
                .addStringOption(opt =>
                    opt.setName('aset')
                        .setDescription('Pilih aset kendaraan atau properti yang ingin dicicil')
                        .setRequired(true)
                        .addChoices(...CREDIT_ASSET_CHOICES)
                )
                .addIntegerOption(opt =>
                    opt.setName('tenor')
                        .setDescription('Pilih tenor cicilan mingguan (4, 8, 12, atau 24 minggu)')
                        .setRequired(true)
                        .addChoices(...TENOR_CHOICES)
                )
        )
        .addSubcommand(sub =>
            sub.setName('pay')
                .setDescription('Bayar cicilan mingguan lebih awal (atau lunasi tunggakan)')
                .addStringOption(opt =>
                    opt.setName('kategori')
                        .setDescription('Pilih kredit kendaraan atau properti (kosongkan jika hanya 1 kredit)')
                        .addChoices(
                            { name: '🚘 Kredit Kendaraan', value: 'vehicle' },
                            { name: '🏠 Kredit Properti', value: 'property' }
                        )
                )
                .addIntegerOption(opt =>
                    opt.setName('minggu')
                        .setDescription('Jumlah minggu cicilan yang ingin dibayar sekaligus (default: 1)')
                        .setMinValue(1)
                        .setMaxValue(24)
                )
        )
        .addSubcommand(sub =>
            sub.setName('payoff')
                .setDescription('Lunasi seluruh sisa kredit dipercepat (diskon 50% sisa bunga)')
                .addStringOption(opt =>
                    opt.setName('kategori')
                        .setDescription('Pilih kredit kendaraan atau properti yang ingin dilunasi')
                        .addChoices(
                            { name: '🚘 Kredit Kendaraan', value: 'vehicle' },
                            { name: '🏠 Kredit Properti', value: 'property' }
                        )
                )
        ),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        const discordId = interaction.user.id;
        const now = Date.now();

        const payload = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, true);
            const player = synced.player;

            if (sub === 'status') {
                const activeCredits = await getActiveCredits(conn, discordId, false);
                const income7d = await getPlayerNetIncomeLast7Days(conn, discordId, now);
                const maxInstallment = Math.floor(income7d * CREDIT_RULES.MAX_DTI_RATIO);
                const usedInstallment = activeCredits.reduce((acc, c) => acc + c.weekly_installment, 0);
                const accountAgeDays = Math.floor(Math.max(0, now - Number(player.created_at || now)) / 86400000);

                const header = [
                    `💵 **Dompet:** ${formatLp(player.cash)} · 🏦 **Bank:** ${formatLp(player.bank)}`,
                    `📈 **Penghasilan 7 Hari Terakhir:** **${formatLp(income7d)}** · 🛡️ **Batas Cicilan Maks (50%):** **${formatLp(maxInstallment)}/mgg** *(Terpakai: ${formatLp(usedInstallment)}/mgg)*`,
                    `🪪 **Syarat Pengajuan:** Umur Akun **${accountAgeDays}/14 hari** · Pekerjaan Aktif: **${player.current_job ? '✅ Ada' : '❌ Belum Bekerja'}**`
                ].join('\n');

                const creditBlocks = activeCredits.length > 0
                    ? activeCredits.map(c => formatCreditStatusBlock(c, now)).join('\n\n')
                    : '✨ *Kamu tidak memiliki kontrak kredit aktif saat ini.*';

                const simLines = ['motor_baru', 'rumah', 'mobil', 'rumah_mewah'].map(id => {
                    const p4 = calculateCreditPlan(id, 4);
                    const p24 = calculateCreditPlan(id, 24);
                    return `• ${p4.asset.emoji} **${p4.asset.name}** (${formatLp(p4.totalPrice)}) — DP 20%: **${formatLp(p4.downPayment)}** · Cicilan: **${formatLp(p24.weeklyInstallment)}/mgg** (24 mgg) s/d **${formatLp(p4.weeklyInstallment)}/mgg** (4 mgg)`;
                });

                return buildV2Card({
                    accentColor: COLORS.ECONOMY,
                    title: '🏦 Lembaga Pembiayaan & Kredit Kota (/credit)',
                    blocks: [
                        header,
                        creditBlocks,
                        `**📋 Tabel Ringkas DP & Cicilan:**\n${simLines.join('\n')}`
                    ],
                    footer: 'Cicilan ditarik otomatis setiap minggu (Bank dulu, lalu Cash). Menunggak 2 minggu menyebabkan penyitaan aset.'
                });
            }

            if (sub === 'apply') {
                const aset = interaction.options.getString('aset', true);
                const tenor = interaction.options.getInteger('tenor', true);
                const res = await applyCredit(conn, player, aset, tenor, now);

                if (!res.ok) {
                    let msg = 'Pengajuan kredit ditolak.';
                    if (res.error === 'NO_ACTIVE_JOB') {
                        msg = 'Kamu wajib memiliki **pekerjaan tetap** sebelum mengajukan kredit! Lamar pekerjaan dulu melalui `/job apply`.';
                    } else if (res.error === 'ACCOUNT_TOO_YOUNG') {
                        msg = `Umur karaktermu belum mencapai **14 hari**! Tunggu **${formatDuration(Math.ceil(res.remainingMs / 1000))}** lagi untuk dapat mengakses fasilitas kredit.`;
                    } else if (res.error === 'CATEGORY_ALREADY_ACTIVE') {
                        msg = `Kamu masih memiliki kontrak kredit **${res.category === 'vehicle' ? 'Kendaraan' : 'Properti'}** yang belum lunas! Maksimal 1 kredit kendaraan & 1 kredit properti aktif.`;
                    } else if (res.error === 'ASSET_ALREADY_OWNED') {
                        msg = `Kamu sudah memiliki **${res.asset.emoji} ${res.asset.name}** secara penuh!`;
                    } else if (res.error === 'INCOME_TOO_LOW') {
                        msg = [
                            `Penghasilan bersih 7 hari terakhirmu (**${formatLp(res.income7d)}**) belum mencukupi batas rasio cicilan aman (maksimal 50% penghasilan = **${formatLp(res.maxAllowedInstallment)}/minggu**).`,
                            `• Cicilan yang diajukan: **${formatLp(res.requiredInstallment)}/minggu**`,
                            `💡 *Tips: Pilih tenor yang lebih panjang (mis. 12 atau 24 minggu) atau tingkatkan penghasilan lewat \`/work\` dan \`/sell\` terlebih dahulu!*`
                        ].join('\n');
                    } else if (res.error === 'INSUFFICIENT_DP') {
                        msg = `Saldo Cash + Bank kamu (**${formatLp(res.totalFunds)}**) tidak mencukupi untuk membayar **Uang Muka (DP 20%)** sebesar **${formatLp(res.requiredDp)}**.`;
                    }

                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '❌ Pengajuan Kredit Ditolak',
                        blocks: [msg],
                        ephemeral: true
                    });
                }

                const p = res.plan;
                return buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `🎉 Kredit Disetujui: ${p.asset.emoji} ${p.asset.name}!`,
                    blocks: [
                        `Selamat! Pengajuan kredit **${p.asset.emoji} ${p.asset.name}** selama **${p.tenorWeeks} minggu** telah disetujui dan aset langsung diserahkan kepadamu!`,
                        [
                            `• 💰 **Harga Aset:** ${formatLp(p.totalPrice)}`,
                            `• 💵 **Uang Muka (DP 20% Dibayar):** **${formatLp(p.downPayment)}**`,
                            `• 📊 **Pokok Pinjaman:** ${formatLp(p.principalAmount)} + **Bunga Flat (${Math.round(p.flatRate * 100)}%):** ${formatLp(p.interestAmount)}`,
                            `• 🗓️ **Cicilan Mingguan:** **${formatLp(p.weeklyInstallment)} / minggu** (selama ${p.tenorWeeks} minggu)`,
                            `• 🏦 **Sisa Saldo:** Cash ${formatLp(res.player.cash)} · Bank ${formatLp(res.player.bank)}`
                        ].join('\n')
                    ],
                    footer: 'Pastikan saldo Bank/Cash mencukupi setiap minggu untuk auto-debit cicilan.'
                });
            }

            if (sub === 'pay') {
                const kat = interaction.options.getString('kategori');
                const minggu = interaction.options.getInteger('minggu') || 1;
                const res = await payCreditInstallment(conn, player, kat, minggu, now);

                if (!res.ok) {
                    const msg = res.error === 'NO_ACTIVE_CREDIT' || res.error === 'CREDIT_NOT_FOUND'
                        ? 'Kamu tidak memiliki kontrak kredit aktif pada kategori tersebut.'
                        : `Saldo Cash + Bank kamu (**${formatLp(res.totalFunds)}**) tidak cukup untuk membayar cicilan sebesar **${formatLp(res.required)}**.`;
                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '⚠️ Gagal Membayar Cicilan',
                        blocks: [msg],
                        ephemeral: true
                    });
                }

                const assetLabel = res.credit.asset ? `${res.credit.asset.emoji} ${res.credit.asset.name}` : res.credit.asset_id;
                const doneNotice = res.isCompleted
                    ? `\n🎊 **KREDIT LUNAS SEPENUHNYA!** Aset **${assetLabel}** kini 100% bebas tanggungan!`
                    : `\n🗓️ Progres: **${res.newWeeksPaid}/${res.tenorWeeks} minggu**.`;

                return buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: '✅ Pembayaran Cicilan Berhasil!',
                    blocks: [
                        `Kamu membayar **${res.weeksPaidNow} minggu** cicilan untuk **${assetLabel}** sebesar **${formatLp(res.totalCost)}**.${doneNotice}`,
                        `💵 **Sisa Cash:** ${formatLp(res.player.cash)} · 🏦 **Sisa Bank:** ${formatLp(res.player.bank)}`
                    ]
                });
            }

            if (sub === 'payoff') {
                const kat = interaction.options.getString('kategori');
                const res = await payoffCreditEarly(conn, player, kat, now);

                if (!res.ok) {
                    const msg = res.error === 'NO_ACTIVE_CREDIT' || res.error === 'CREDIT_NOT_FOUND'
                        ? 'Kamu tidak memiliki kontrak kredit aktif pada kategori tersebut.'
                        : `Saldo Cash + Bank kamu (**${formatLp(res.totalFunds)}**) belum cukup untuk melunasi sisa tagihan dipercepat sebesar **${formatLp(res.required)}**.`;
                    return buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '⚠️ Gagal Pelunasan Dipercepat',
                        blocks: [msg],
                        ephemeral: true
                    });
                }

                const assetLabel = res.credit.asset ? `${res.credit.asset.emoji} ${res.credit.asset.name}` : res.credit.asset_id;
                return buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: `🎊 Pelunasan Dipercepat Berhasil: ${assetLabel}!`,
                    blocks: [
                        `Seluruh sisa kredit **${assetLabel}** telah **LUNAS**!`,
                        [
                            `• 💳 **Total Pelunasan Dibayar:** **${formatLp(res.payoff.totalPayoff)}**`,
                            `• 🎁 **Potongan Bunga 50% (Hemat):** **${formatLp(res.payoff.interestSaved)}**`,
                            `• 💵 **Sisa Cash:** ${formatLp(res.player.cash)} · 🏦 **Sisa Bank:** ${formatLp(res.player.bank)}`
                        ].join('\n')
                    ]
                });
            }
        });

        return await interaction.reply(payload);
    }
};
