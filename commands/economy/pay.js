const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { getDailyPayTotal, addDailyPayTotal } = require('../../database/redis');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getLevelInfoFromXp } = require('../../data/locations');
const { PAY_RULES } = require('../../data/constants');
const { COLORS, formatLp } = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    userSelect,
    percentRow,
    confirmView,
    numberModal,
    parseModalNumber
} = require('../../utils/panelBuilder');

function meetsPayAccountRequirements(player, now = Date.now()) {
    const ageMs = now - Number(player.created_at || now);
    if (ageMs < PAY_RULES.MIN_ACCOUNT_AGE_MS) {
        return { ok: false, reason: 'berumur minimal **7 hari** sejak terdaftar' };
    }
    const fishLv = getLevelInfoFromXp(player.fishing_xp).level;
    const mineLv = getLevelInfoFromXp(player.mining_xp).level;
    const totalSkill = fishLv + mineLv;
    const hasProgress = Number(player.total_shifts) >= PAY_RULES.MIN_SHIFTS || totalSkill >= PAY_RULES.MIN_TOTAL_SKILL_LEVEL;

    if (!hasProgress) {
        return {
            ok: false,
            reason: `memiliki minimal **${PAY_RULES.MIN_SHIFTS} shift kerja** atau **total level skill ≥ ${PAY_RULES.MIN_TOTAL_SKILL_LEVEL}**`
        };
    }
    return { ok: true };
}

async function fetchPayState(senderId, targetId = null, now = Date.now()) {
    const [sentToday, recvToday] = await Promise.all([
        getDailyPayTotal(senderId, 'sent', now),
        targetId ? getDailyPayTotal(targetId, 'recv', now) : Promise.resolve(0)
    ]);

    return await withTransaction(async (conn) => {
        const senderSync = await syncPlayerVitals(conn, senderId, now, false);
        const recvSync = targetId ? await syncPlayerVitals(conn, targetId, now, false) : null;
        return {
            sender: senderSync.player,
            receiver: recvSync ? recvSync.player : null,
            sentToday,
            recvToday
        };
    });
}

function buildPayPanel({
    state,
    targetId = null,
    banner = null,
    now = Date.now()
}) {
    const { sender: s, receiver: r, sentToday, recvToday } = state;
    const ownerId = s.discord_id;
    const totalFunds = Number(s.cash) + Number(s.bank);
    const maxAffordableSend = Math.max(0, Math.floor(totalFunds / (1 + PAY_RULES.TAX_RATE)));
    const remainingSendQuota = Math.max(0, PAY_RULES.MAX_DAILY_SEND - sentToday);
    const remainingRecvQuota = r ? Math.max(0, PAY_RULES.MAX_DAILY_RECEIVE - recvToday) : PAY_RULES.MAX_DAILY_RECEIVE;
    const maxTransferable = Math.min(maxAffordableSend, remainingSendQuota, remainingRecvQuota);

    const blocks = [
        [
            `💸 **Aturan & Kuota Transfer Harian:**`,
            `• 🏛️ Pajak Transfer      : **${Math.round(PAY_RULES.TAX_RATE * 100)}%** *(Ditanggung pengirim)*`,
            `• 📤 Sisa Kuota Kirimmu  : **${formatLp(remainingSendQuota)}** *(Terpakai hari ini: ${formatLp(sentToday)} / ${formatLp(PAY_RULES.MAX_DAILY_SEND)})*`,
            `• 💳 Maksimal Bisa Kirim : **${formatLp(maxTransferable)}** *(Dari saldo Cash + Bank)*`
        ].join('\n')
    ];

    if (targetId && r) {
        blocks.push(
            [
                `🎯 **Penerima Terpilih:** **${r.username}** (<@${targetId}>)`,
                `• 📥 Sisa Kuota Terima Penerima Hari Ini: **${formatLp(remainingRecvQuota)}**`,
                `Pilih nominal cepat di bawah atau klik **✏️ Nominal Lain** untuk memasukkan jumlah transfer:`
            ].join('\n')
        );
    } else {
        blocks.push('👇 **Langkah 1:** Pilih warga tujuan transfer melalui menu dropdown di bawah ini.');
    }

    const rows = [
        userSelect('pay', 'user', ownerId, '💸 Pilih Warga Tujuan Transfer...', now)
    ];

    if (targetId && r) {
        rows.push(
            percentRow('pay', 'amt', ownerId, {
                argPrefix: targetId,
                customAction: 'amt_open_modal',
                disabled: maxTransferable < 1000
            }, now)
        );
    }

    rows.push(
        new ActionRowBuilder().addComponents(
            btn('pay', 'home', ownerId, {
                label: 'Reset / Segarkan',
                emoji: '🔄',
                style: ButtonStyle.Secondary
            }, now)
        )
    );

    return buildPanel({
        mod: 'pay',
        ownerId,
        accentColor: COLORS.ECONOMY,
        title: '💸 Layanan Transfer Antar Warga (/pay)',
        player: s,
        banner,
        blocks,
        rows,
        footer: 'Syarat transfer: umur akun min. 7 hari & minimal 5 shift kerja atau total level skill ≥ 5.',
        now
    });
}

function buildPayConfirmView({ state, targetId, amount, now = Date.now() }) {
    const { sender: s, receiver: r } = state;
    const tax = Math.round(amount * PAY_RULES.TAX_RATE);
    const totalDebit = amount + tax;

    return confirmView({
        mod: 'pay',
        confirmAction: 'send_confirm',
        cancelAction: 'home',
        ownerId: s.discord_id,
        title: `💸 Konfirmasi Transfer ke ${r ? r.username : targetId}`,
        description: [
            `Kamu akan mengirim uang kepada **${r ? r.username : 'Warga'}** (<@${targetId}>):`,
            [
                `• 💰 Nominal Diterima Tujuan : **${formatLp(amount)}**`,
                `• 🏛️ Pajak Transfer (5%)     : **${formatLp(tax)}**`,
                `• 💳 Total Saldo Terpotong   : **${formatLp(totalDebit)}**`
            ].join('\n'),
            'Transaksi yang sudah dikirim tidak dapat dibatalkan. Lanjutkan transfer?'
        ],
        confirmLabel: `Ya, Kirim (${formatLp(totalDebit)})`,
        confirmStyle: ButtonStyle.Success,
        arg: `${targetId}|${amount}`,
        player: s,
        now
    });
}

module.exports = {
    name: 'pay',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('pay')
        .setDescription('Buka panel transfer uang antar warga (Pajak 5%, batas kirim Lp 1.000.000/hari).'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchPayState(interaction.user.id, null, now);
        return await interaction.reply(buildPayPanel({ state, now }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchPayState(interaction.user.id, null, now);
                return await interaction.update(buildPayPanel({ state, now }));
            },
            async amt(interaction, parsed) {
                const now = Date.now();
                const senderId = interaction.user.id;
                const [targetId, pctStr] = String(parsed.arg || '').split(':');

                if (!targetId) {
                    const state = await fetchPayState(senderId, null, now);
                    return await interaction.update(
                        buildPayPanel({
                            state,
                            banner: { type: 'warning', text: 'Pilih warga tujuan transfer terlebih dahulu.' },
                            now
                        })
                    );
                }

                const state = await fetchPayState(senderId, targetId, now);
                const totalFunds = Number(state.sender.cash) + Number(state.sender.bank);
                const maxAffordableSend = Math.max(0, Math.floor(totalFunds / (1 + PAY_RULES.TAX_RATE)));
                const remainingSendQuota = Math.max(0, PAY_RULES.MAX_DAILY_SEND - state.sentToday);
                const remainingRecvQuota = Math.max(0, PAY_RULES.MAX_DAILY_RECEIVE - state.recvToday);
                const maxTransferable = Math.min(maxAffordableSend, remainingSendQuota, remainingRecvQuota);

                const pct = Number(pctStr) || 25;
                const amount = Math.floor((maxTransferable * pct) / 100);

                if (amount < 1000) {
                    return await interaction.update(
                        buildPayPanel({
                            state,
                            targetId,
                            banner: { type: 'warning', text: 'Nominal transfer minimal adalah **Lp 1.000**.' },
                            now
                        })
                    );
                }

                return await interaction.update(buildPayConfirmView({ state, targetId, amount, now }));
            },
            async amt_open_modal(interaction, parsed) {
                const now = Date.now();
                const senderId = interaction.user.id;
                const targetId = parsed.arg || '';
                const modal = numberModal('pay', 'amt_modal', senderId, {
                    title: '💸 Nominal Transfer Uang (Lp)',
                    label: 'Jumlah Lp yang diterima tujuan (Min 1.000)',
                    placeholder: 'Contoh: 50000',
                    arg: targetId
                }, now);
                return await interaction.showModal(modal);
            },
            async send_confirm(interaction, parsed) {
                const now = Date.now();
                const senderId = interaction.user.id;
                const [targetId, amtStr] = String(parsed.arg || '').split('|');
                const amount = Number(amtStr) || 0;

                if (!targetId || amount < 1000) {
                    const state = await fetchPayState(senderId, null, now);
                    return await interaction.update(
                        buildPayPanel({
                            state,
                            banner: { type: 'warning', text: 'Data transfer tidak valid.' },
                            now
                        })
                    );
                }

                const [sentToday, recvToday] = await Promise.all([
                    getDailyPayTotal(senderId, 'sent', now),
                    getDailyPayTotal(targetId, 'recv', now)
                ]);

                if (sentToday + amount > PAY_RULES.MAX_DAILY_SEND) {
                    const state = await fetchPayState(senderId, targetId, now);
                    return await interaction.update(
                        buildPayPanel({
                            state,
                            targetId,
                            banner: { type: 'danger', text: `Batas kirim harian (${formatLp(PAY_RULES.MAX_DAILY_SEND)}/hari) terlampaui.` },
                            now
                        })
                    );
                }

                if (recvToday + amount > PAY_RULES.MAX_DAILY_RECEIVE) {
                    const state = await fetchPayState(senderId, targetId, now);
                    return await interaction.update(
                        buildPayPanel({
                            state,
                            targetId,
                            banner: { type: 'danger', text: `Penerima telah mencapai batas terima harian (${formatLp(PAY_RULES.MAX_DAILY_RECEIVE)}/hari).` },
                            now
                        })
                    );
                }

                const tax = Math.round(amount * PAY_RULES.TAX_RATE);
                const totalDebit = amount + tax;

                const res = await withTransaction(async (conn) => {
                    const senderSync = await syncPlayerVitals(conn, senderId, now, true);
                    const recvSync = await syncPlayerVitals(conn, targetId, now, true);
                    if (!recvSync) return { error: 'TARGET_NOT_REGISTERED' };

                    const senderCheck = meetsPayAccountRequirements(senderSync.player, now);
                    if (!senderCheck.ok) return { error: 'SENDER_INELIGIBLE', reason: senderCheck.reason };

                    const recvCheck = meetsPayAccountRequirements(recvSync.player, now);
                    if (!recvCheck.ok) return { error: 'RECV_INELIGIBLE', reason: recvCheck.reason };

                    const s = senderSync.player;
                    const r = recvSync.player;
                    if (Number(s.cash) + Number(s.bank) < totalDebit) {
                        return { error: 'INSUFFICIENT_FUNDS', totalDebit, balance: Number(s.cash) + Number(s.bank) };
                    }

                    const fromCash = Math.min(Number(s.cash), totalDebit);
                    const fromBank = totalDebit - fromCash;
                    s.cash = Number(s.cash) - fromCash;
                    s.bank = Number(s.bank) - fromBank;
                    r.cash = Number(r.cash) + amount;

                    await conn.execute(`UPDATE players SET cash = ?, bank = ? WHERE discord_id = ?`, [s.cash, s.bank, senderId]);
                    await conn.execute(`UPDATE players SET cash = ? WHERE discord_id = ?`, [r.cash, targetId]);

                    await conn.execute(
                        `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
                         VALUES (?, 'transfer', 'pay_sent', ?, ?, ?, ?)`,
                        [senderId, amount, s.cash + s.bank, JSON.stringify({ to: targetId, tax }), now]
                    );
                    if (tax > 0) {
                        await conn.execute(
                            `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
                             VALUES (?, 'sink', 'pay_tax', ?, ?, ?, ?)`,
                            [senderId, tax, s.cash + s.bank, JSON.stringify({ to: targetId }), now]
                        );
                    }
                    return { ok: true, sender: s, receiver: r };
                });

                let banner = null;
                if (res.ok) {
                    await Promise.all([
                        addDailyPayTotal(senderId, 'sent', amount, now),
                        addDailyPayTotal(targetId, 'recv', amount, now)
                    ]);
                    banner = {
                        type: 'success',
                        text: `💸 Berhasil mengirim **${formatLp(amount)}** ke **${res.receiver.username}** (<@${targetId}>)! Pajak 5%: **${formatLp(tax)}**.`
                    };
                } else if (res.error === 'SENDER_INELIGIBLE') {
                    banner = { type: 'warning', text: `Syarat pengirim belum terpenuhi: harus ${res.reason}.` };
                } else if (res.error === 'RECV_INELIGIBLE') {
                    banner = { type: 'warning', text: `Syarat penerima belum terpenuhi: harus ${res.reason}.` };
                } else if (res.error === 'INSUFFICIENT_FUNDS') {
                    banner = { type: 'danger', text: `Saldo tidak cukup! Butuh **${formatLp(res.totalDebit)}** (termasuk pajak 5%).` };
                } else {
                    banner = { type: 'warning', text: 'Warga tujuan belum terdaftar.' };
                }

                const state = await fetchPayState(senderId, null, now);
                return await interaction.update(buildPayPanel({ state, banner, now }));
            }
        },
        selects: {
            async user(interaction) {
                const now = Date.now();
                const senderId = interaction.user.id;
                const targetId = interaction.values[0] || '';

                if (targetId === senderId) {
                    const state = await fetchPayState(senderId, null, now);
                    return await interaction.update(
                        buildPayPanel({
                            state,
                            banner: { type: 'warning', text: 'Kamu tidak dapat mengirim transfer ke dirimu sendiri.' },
                            now
                        })
                    );
                }

                const state = await fetchPayState(senderId, targetId, now);
                if (!state.receiver) {
                    return await interaction.update(
                        buildPayPanel({
                            state,
                            banner: { type: 'warning', text: `Warga <@${targetId}> belum terdaftar di Life Simulation.` },
                            now
                        })
                    );
                }

                return await interaction.update(buildPayPanel({ state, targetId, now }));
            }
        },
        modals: {
            async amt_modal(interaction, parsed) {
                const now = Date.now();
                const senderId = interaction.user.id;
                const targetId = parsed.arg || '';
                const parsedNum = parseModalNumber(interaction, 'amount', {
                    min: 1000,
                    max: PAY_RULES.MAX_DAILY_SEND
                });

                const state = await fetchPayState(senderId, targetId, now);
                if (!parsedNum.ok) {
                    return await interaction.update(
                        buildPayPanel({
                            state,
                            targetId,
                            banner: { type: 'warning', text: parsedNum.error },
                            now
                        })
                    );
                }

                return await interaction.update(
                    buildPayConfirmView({
                        state,
                        targetId,
                        amount: parsedNum.value,
                        now
                    })
                );
            }
        }
    },

    buildPayPanel
};
