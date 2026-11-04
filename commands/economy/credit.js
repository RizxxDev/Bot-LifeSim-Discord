const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
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
    formatDuration
} = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    select,
    confirmView
} = require('../../utils/panelBuilder');

const CREDITABLE_IDS = ['motor_baru', 'rumah', 'mobil', 'rumah_mewah'];
const TENORS = [4, 8, 12, 24];

function formatCreditStatusBlock(c, now = Date.now()) {
    const assetLabel = c.asset ? `${c.asset.emoji} **${c.asset.name}**` : `**${c.asset_id}**`;
    const remWeeks = Math.max(0, c.tenor_weeks - c.weeks_paid);
    const early = calculateEarlyPayoff(c);
    const dueUnix = Math.floor(Number(c.next_due_at || now) / 1000);
    const statusBadge = c.missed_weeks > 0
        ? `⚠️ **MENUNGGAK ${c.missed_weeks} MINGGU** *(Segera bayar cicilan agar aset tidak disita!)*`
        : `🟢 **Lancar** · Jatuh tempo berikutnya: **<t:${dueUnix}:R>**`;

    return [
        `📄 **Kredit #${c.id} (${c.asset_category === 'vehicle' ? 'Kendaraan' : 'Properti'}):** ${assetLabel}`,
        `• Status: ${statusBadge}`,
        `• Progres Tenor: **${c.weeks_paid} / ${c.tenor_weeks} minggu** *(Sisa ${remWeeks}x cicilan)*`,
        `• Cicilan Mingguan: **${formatLp(c.weekly_installment)} / minggu**`,
        `• Pelunasan Dipercepat (Diskon 50% Sisa Bunga): **${formatLp(early.totalPayoff)}** *(Hemat ${formatLp(early.interestSaved)})*`
    ].join('\n');
}

async function fetchCreditState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const activeCredits = await getActiveCredits(conn, discordId, false);
        const income7d = await getPlayerNetIncomeLast7Days(conn, discordId, now);
        return {
            player: synced.player,
            activeCredits,
            income7d
        };
    });
}

function buildCreditPanel({ state, banner = null, now = Date.now() }) {
    const { player: p, activeCredits, income7d } = state;
    const ownerId = p.discord_id;

    const maxInstallment = Math.floor(income7d * CREDIT_RULES.MAX_DTI_RATIO);
    const usedInstallment = activeCredits.reduce((acc, c) => acc + c.weekly_installment, 0);
    const remainingDti = Math.max(0, maxInstallment - usedInstallment);
    const accountAgeDays = Math.floor(Math.max(0, now - Number(p.created_at || now)) / 86400000);

    const headerBlock = [
        `📈 **Penghasilan 7 Hari Terakhir:** **${formatLp(income7d)}**`,
        `🛡️ **Batas Cicilan Aman (50% DTI):** **${formatLp(maxInstallment)}/mgg** *(Terpakai: ${formatLp(usedInstallment)}/mgg · Sisa Kuota: ${formatLp(remainingDti)}/mgg)*`,
        `🪪 **Syarat Pengajuan:** Umur Akun **${accountAgeDays}/14 hari** (${accountAgeDays >= 14 ? '✅' : '⏳'}) · Pekerjaan Aktif: **${p.current_job ? '✅ Ada' : '❌ Belum Bekerja'}**`
    ].join('\n');

    const creditBlocks = activeCredits.length > 0
        ? activeCredits.map(c => formatCreditStatusBlock(c, now)).join('\n\n')
        : '✨ *Kamu tidak memiliki kontrak kredit aktif saat ini. Pilih paket cicilan di menu bawah untuk mengajukan pembiayaan.*';

    const simLines = CREDITABLE_IDS.map(id => {
        const p4 = calculateCreditPlan(id, 4);
        const p24 = calculateCreditPlan(id, 24);
        return `• ${p4.asset.emoji} **${p4.asset.name}** (${formatLp(p4.totalPrice)}) — DP 20%: **${formatLp(p4.downPayment)}** · Cicilan **${formatLp(p24.weeklyInstallment)}/mgg** (24 mgg) s/d **${formatLp(p4.weeklyInstallment)}/mgg** (4 mgg)`;
    });

    const planOptions = [];
    for (const id of CREDITABLE_IDS) {
        for (const t of TENORS) {
            const plan = calculateCreditPlan(id, t);
            if (!plan) continue;
            planOptions.push({
                label: `${plan.asset.name} — ${t} Minggu (Bunga ${Math.round(plan.flatRate * 100)}%)`,
                value: `${id}|${t}`,
                emoji: plan.asset.emoji,
                description: `DP 20%: ${formatLp(plan.downPayment)} | Cicilan: ${formatLp(plan.weeklyInstallment)}/minggu`
            });
        }
    }

    const rows = [
        select('credit', 'pick_plan', ownerId, {
            placeholder: '📋 Pilih Aset & Tenor untuk Mengajukan Kredit Baru (DP 20%)...',
            options: planOptions
        }, now)
    ];

    const actionBtns = [];
    const vehCredit = activeCredits.find(c => c.asset_category === 'vehicle');
    const propCredit = activeCredits.find(c => c.asset_category === 'property');

    if (vehCredit) {
        actionBtns.push(
            btn('credit', 'pay', ownerId, {
                label: `Bayar 1 Mgg Kendaraan (${formatLp(vehCredit.weekly_installment)})`,
                emoji: '🚘',
                style: vehCredit.missed_weeks > 0 ? ButtonStyle.Danger : ButtonStyle.Primary,
                arg: 'vehicle'
            }, now),
            btn('credit', 'payoff_prompt', ownerId, {
                label: 'Lunasi Cepat Kendaraan',
                emoji: '🎊',
                style: ButtonStyle.Success,
                arg: 'vehicle'
            }, now)
        );
    }

    if (propCredit) {
        actionBtns.push(
            btn('credit', 'pay', ownerId, {
                label: `Bayar 1 Mgg Properti (${formatLp(propCredit.weekly_installment)})`,
                emoji: '🏠',
                style: propCredit.missed_weeks > 0 ? ButtonStyle.Danger : ButtonStyle.Primary,
                arg: 'property'
            }, now),
            btn('credit', 'payoff_prompt', ownerId, {
                label: 'Lunasi Cepat Properti',
                emoji: '🎊',
                style: ButtonStyle.Success,
                arg: 'property'
            }, now)
        );
    }

    actionBtns.push(
        btn('credit', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary
        }, now)
    );

    rows.push(new ActionRowBuilder().addComponents(actionBtns.slice(0, 5)));

    const hasArrears = activeCredits.some(c => c.missed_weeks > 0);
    return buildPanel({
        mod: 'credit',
        ownerId,
        accentColor: hasArrears ? COLORS.DANGER : COLORS.ECONOMY,
        title: `🏦 Lembaga Pembiayaan & Kredit Kota`,
        player: p,
        banner,
        blocks: [
            headerBlock,
            creditBlocks,
            `**📋 Tabel Ringkas DP & Cicilan:**\n${simLines.join('\n')}`
        ],
        rows,
        footer: 'Cicilan ditarik otomatis tiap minggu (Bank dulu, lalu Cash). Menunggak 2 minggu berturut-turut memicu penyitaan aset.',
        now
    });
}

module.exports = {
    name: 'credit',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('credit')
        .setDescription('Buka panel pembiayaan kredit interaktif: ajukan cicilan kendaraan/properti, bayar, atau lunasi.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchCreditState(interaction.user.id, now);
        return await interaction.reply(buildCreditPanel({ state, now }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchCreditState(interaction.user.id, now);
                return await interaction.update(buildCreditPanel({ state, now }));
            },
            async apply_confirm(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const [assetId, tenorStr] = String(parsed.arg || '').split('|');
                const tenor = Number(tenorStr) || 4;

                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await applyCredit(conn, synced.player, assetId, tenor, now);
                });

                const state = await fetchCreditState(userId, now);
                let banner = null;
                if (res.ok) {
                    const p = res.plan;
                    banner = {
                        type: 'success',
                        text: `🎉 Kredit **${p.asset.emoji} ${p.asset.name}** (${p.tenorWeeks} mgg) disetujui! DP **${formatLp(p.downPayment)}** terbayar & cicilan **${formatLp(p.weeklyInstallment)}/mgg**.`
                    };
                } else if (res.error === 'NO_ACTIVE_JOB') {
                    banner = { type: 'warning', text: 'Pengajuan ditolak: Kamu wajib memiliki pekerjaan tetap (`/job`) terlebih dahulu!' };
                } else if (res.error === 'ACCOUNT_TOO_YOUNG') {
                    banner = { type: 'warning', text: `Pengajuan ditolak: Umur karaktermu belum 14 hari (kurang ${formatDuration(res.remainingMs)}).` };
                } else if (res.error === 'CATEGORY_ALREADY_ACTIVE') {
                    banner = { type: 'warning', text: `Pengajuan ditolak: Kamu masih memiliki kredit **${res.category === 'vehicle' ? 'Kendaraan' : 'Properti'}** yang belum lunas.` };
                } else if (res.error === 'ASSET_ALREADY_OWNED') {
                    banner = { type: 'warning', text: `Kamu sudah memiliki **${res.asset.emoji} ${res.asset.name}** secara penuh!` };
                } else if (res.error === 'INCOME_TOO_LOW') {
                    banner = {
                        type: 'danger',
                        text: `Penghasilan 7 hari (${formatLp(res.income7d)}) belum cukup! Batas cicilan aman 50% adalah **${formatLp(res.maxAllowedInstallment)}/mgg**, sedangkan total cicilanmu menjadi **${formatLp(res.requiredInstallment)}/mgg**.`
                    };
                } else if (res.error === 'INSUFFICIENT_DP') {
                    banner = {
                        type: 'danger',
                        text: `Saldo Cash + Bank (${formatLp(res.totalFunds)}) tidak mencukupi untuk membayar Uang Muka (DP 20%) sebesar **${formatLp(res.requiredDp)}**.`
                    };
                } else {
                    banner = { type: 'danger', text: 'Pengajuan kredit tidak dapat diproses.' };
                }

                return await interaction.update(buildCreditPanel({ state, banner, now }));
            },
            async pay(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const category = parsed.arg || null;

                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await payCreditInstallment(conn, synced.player, category, 1, now);
                });

                const state = await fetchCreditState(userId, now);
                let banner = null;
                if (res.ok) {
                    const assetLabel = res.credit.asset ? `${res.credit.asset.emoji} ${res.credit.asset.name}` : res.credit.asset_id;
                    const doneText = res.isCompleted
                        ? ` 🎊 **KREDIT LUNAS SEPENUHNYA!**`
                        : ` (Progres: **${res.newWeeksPaid}/${res.tenorWeeks} minggu**).`;
                    banner = {
                        type: 'success',
                        text: `✅ Berhasil membayar 1 minggu cicilan **${assetLabel}** sebesar **${formatLp(res.totalCost)}**!${doneText}`
                    };
                } else if (res.error === 'INSUFFICIENT_FUNDS') {
                    banner = {
                        type: 'danger',
                        text: `Saldo Cash + Bank (${formatLp(res.totalFunds)}) tidak cukup untuk membayar cicilan **${formatLp(res.required)}**.`
                    };
                } else {
                    banner = { type: 'warning', text: 'Tidak ditemukan kontrak kredit aktif pada kategori tersebut.' };
                }

                return await interaction.update(buildCreditPanel({ state, banner, now }));
            },
            async payoff_prompt(interaction, parsed) {
                const now = Date.now();
                const category = parsed.arg || 'vehicle';
                const state = await fetchCreditState(interaction.user.id, now);
                const credit = state.activeCredits.find(c => c.asset_category === category) || state.activeCredits[0];

                if (!credit) {
                    return await interaction.update(
                        buildCreditPanel({
                            state,
                            banner: { type: 'warning', text: 'Tidak ada kontrak kredit aktif untuk dilunasi.' },
                            now
                        })
                    );
                }

                const early = calculateEarlyPayoff(credit);
                const assetLabel = credit.asset ? `${credit.asset.emoji} ${credit.asset.name}` : credit.asset_id;

                return await interaction.update(
                    confirmView({
                        mod: 'credit',
                        confirmAction: 'payoff_confirm',
                        cancelAction: 'home',
                        ownerId: interaction.user.id,
                        title: `🎊 Konfirmasi Pelunasan Dipercepat: ${assetLabel}`,
                        description: [
                            `Kamu akan melunasi seluruh sisa kontrak kredit **${assetLabel}**:`,
                            `• Sisa Pokok Pinjaman: **${formatLp(early.remainingPrincipal)}**\n• Sisa Bunga (Diskon 50%): **${formatLp(early.discountedInterest)}** *(Hemat **${formatLp(early.interestSaved)}**)*\n• Total Pelunasan: **${formatLp(early.totalPayoff)}**`,
                            'Apakah kamu yakin ingin melunasi kredit ini sekarang?'
                        ],
                        confirmLabel: `Ya, Lunasi (${formatLp(early.totalPayoff)})`,
                        confirmStyle: ButtonStyle.Success,
                        arg: credit.asset_category,
                        player: state.player,
                        now
                    })
                );
            },
            async payoff_confirm(interaction, parsed) {
                const now = Date.now();
                const userId = interaction.user.id;
                const category = parsed.arg || null;

                const res = await withTransaction(async (conn) => {
                    const synced = await syncPlayerVitals(conn, userId, now, true);
                    return await payoffCreditEarly(conn, synced.player, category, now);
                });

                const state = await fetchCreditState(userId, now);
                let banner = null;
                if (res.ok) {
                    const assetLabel = res.credit.asset ? `${res.credit.asset.emoji} ${res.credit.asset.name}` : res.credit.asset_id;
                    banner = {
                        type: 'success',
                        text: `🎊 **KREDIT LUNAS!** Kontrak **${assetLabel}** resmi lunas dengan pembayaran **${formatLp(res.payoff.totalPayoff)}** (Hemat bunga **${formatLp(res.payoff.interestSaved)}**)!`
                    };
                } else if (res.error === 'INSUFFICIENT_FUNDS') {
                    banner = {
                        type: 'danger',
                        text: `Saldo Cash + Bank (${formatLp(res.totalFunds)}) belum cukup untuk melunasi tagihan dipercepat **${formatLp(res.required)}**.`
                    };
                } else {
                    banner = { type: 'warning', text: 'Gagal melunasi kredit dipercepat.' };
                }

                return await interaction.update(buildCreditPanel({ state, banner, now }));
            }
        },
        selects: {
            async pick_plan(interaction) {
                const now = Date.now();
                const rawVal = interaction.values[0] || '';
                const [assetId, tenorStr] = rawVal.split('|');
                const tenor = Number(tenorStr) || 4;
                const plan = calculateCreditPlan(assetId, tenor);
                const state = await fetchCreditState(interaction.user.id, now);

                if (!plan) {
                    return await interaction.update(buildCreditPanel({ state, now }));
                }

                return await interaction.update(
                    confirmView({
                        mod: 'credit',
                        confirmAction: 'apply_confirm',
                        cancelAction: 'home',
                        ownerId: interaction.user.id,
                        title: `📄 Konfirmasi Pengajuan Kredit: ${plan.asset.emoji} ${plan.asset.name}`,
                        description: [
                            `Rincian kontrak kredit **${plan.asset.emoji} ${plan.asset.name}** selama **${plan.tenorWeeks} minggu**:`,
                            [
                                `• 💰 Harga Aset         : **${formatLp(plan.totalPrice)}**`,
                                `• 💵 Uang Muka (DP 20%) : **${formatLp(plan.downPayment)}** *(Dibayar Sekarang)*`,
                                `• 📊 Pokok Pinjaman     : **${formatLp(plan.principalAmount)}**`,
                                `• 📈 Bunga Flat (${Math.round(plan.flatRate * 100)}%)  : **${formatLp(plan.interestAmount)}**`,
                                `• 🗓️ Cicilan Mingguan   : **${formatLp(plan.weeklyInstallment)} / minggu** (×${plan.tenorWeeks} minggu)`
                            ].join('\n'),
                            'Pastikan saldo mencukupi untuk DP 20% dan penghasilan 7 hari terakhir memenuhi rasio aman (50% DTI).'
                        ],
                        confirmLabel: `Ajukan & Bayar DP (${formatLp(plan.downPayment)})`,
                        confirmStyle: ButtonStyle.Primary,
                        arg: `${assetId}|${tenor}`,
                        player: state.player,
                        now
                    })
                );
            }
        }
    },

    buildCreditPanel
};
