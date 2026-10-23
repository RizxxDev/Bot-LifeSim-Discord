const { SlashCommandBuilder } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { getDailyPayTotal, addDailyPayTotal } = require('../../database/redis');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getLevelInfoFromXp } = require('../../data/locations');
const { PAY_RULES } = require('../../data/constants');
const { COLORS, formatLp, buildV2Card } = require('../../utils/uiBuilder');

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

module.exports = {
    name: 'pay',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('pay')
        .setDescription('Transfer uang ke warga lain (Pajak transfer 5%, batas kirim Lp 1.000.000/hari).')
        .addUserOption(opt =>
            opt
                .setName('user')
                .setDescription('Warga tujuan transfer')
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt
                .setName('amount')
                .setDescription('Jumlah Lp yang diterima tujuan')
                .setMinValue(1000)
                .setMaxValue(PAY_RULES.MAX_DAILY_SEND)
                .setRequired(true)
        ),

    async executeSlash(interaction) {
        const senderId = interaction.user.id;
        const targetUser = interaction.options.getUser('user', true);
        const amount = interaction.options.getInteger('amount', true);

        if (targetUser.id === senderId || targetUser.bot) {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '⚠️ Tujuan Transfer Tidak Valid',
                    blocks: ['Kamu tidak dapat melakukan transfer ke dirimu sendiri atau ke akun bot.'],
                    ephemeral: true
                })
            );
        }

        const now = Date.now();
        const [sentToday, recvToday] = await Promise.all([
            getDailyPayTotal(senderId, 'sent', now),
            getDailyPayTotal(targetUser.id, 'recv', now)
        ]);

        if (sentToday + amount > PAY_RULES.MAX_DAILY_SEND) {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '🛑 Batas Kirim Harian Tercapai',
                    blocks: [
                        `Batas kirim maksimal adalah **${formatLp(PAY_RULES.MAX_DAILY_SEND)}/hari**. Hari ini kamu sudah mengirim **${formatLp(sentToday)}**.`
                    ],
                    ephemeral: true
                })
            );
        }

        if (recvToday + amount > PAY_RULES.MAX_DAILY_RECEIVE) {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '🛑 Batas Terima Harian Penerima Tercapai',
                    blocks: [
                        `Warga tujuan telah mencapai batas penerimaan transfer harian (**${formatLp(PAY_RULES.MAX_DAILY_RECEIVE)}/hari**).`
                    ],
                    ephemeral: true
                })
            );
        }

        const tax = Math.round(amount * PAY_RULES.TAX_RATE);
        const totalDebit = amount + tax;

        const res = await withTransaction(async (conn) => {
            const senderSync = await syncPlayerVitals(conn, senderId, now, true);
            const recvSync = await syncPlayerVitals(conn, targetUser.id, now, true);

            if (!recvSync) {
                return { error: 'TARGET_NOT_REGISTERED' };
            }

            const senderCheck = meetsPayAccountRequirements(senderSync.player, now);
            if (!senderCheck.ok) {
                return { error: 'SENDER_INELIGIBLE', reason: senderCheck.reason };
            }

            const recvCheck = meetsPayAccountRequirements(recvSync.player, now);
            if (!recvCheck.ok) {
                return { error: 'RECV_INELIGIBLE', reason: recvCheck.reason };
            }

            const s = senderSync.player;
            const r = recvSync.player;

            if ((Number(s.cash) + Number(s.bank)) < totalDebit) {
                return { error: 'INSUFFICIENT_FUNDS', totalDebit, balance: Number(s.cash) + Number(s.bank) };
            }

            const fromCash = Math.min(Number(s.cash), totalDebit);
            const fromBank = totalDebit - fromCash;
            s.cash = Number(s.cash) - fromCash;
            s.bank = Number(s.bank) - fromBank;
            r.cash = Number(r.cash) + amount;

            await conn.execute(
                `UPDATE players SET cash = ?, bank = ? WHERE discord_id = ?`,
                [s.cash, s.bank, senderId]
            );
            await conn.execute(
                `UPDATE players SET cash = ? WHERE discord_id = ?`,
                [r.cash, targetUser.id]
            );

            await conn.execute(
                `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
                 VALUES (?, 'transfer', 'pay_sent', ?, ?, ?, ?)`,
                [senderId, amount, s.cash + s.bank, JSON.stringify({ to: targetUser.id, tax }), now]
            );
            if (tax > 0) {
                await conn.execute(
                    `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
                     VALUES (?, 'sink', 'pay_tax', ?, ?, ?, ?)`,
                    [senderId, tax, s.cash + s.bank, JSON.stringify({ to: targetUser.id }), now]
                );
            }

            return { sender: s, receiver: r };
        });

        if (res.error === 'TARGET_NOT_REGISTERED') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '❓ Penerima Belum Terdaftar',
                    blocks: [`**${targetUser.username}** belum memiliki karakter di Life Simulation.`],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'SENDER_INELIGIBLE') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '🔒 Syarat Transfer Pengirim Belum Terpenuhi',
                    blocks: [`Untuk menggunakan fitur \`/pay\`, karaktermu harus ${res.reason}.`],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'RECV_INELIGIBLE') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.WARNING,
                    title: '🔒 Syarat Transfer Penerima Belum Terpenuhi',
                    blocks: [`Penerima transfer harus ${res.reason}.`],
                    ephemeral: true
                })
            );
        }

        if (res.error === 'INSUFFICIENT_FUNDS') {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.DANGER,
                    title: '❌ Saldo Tidak Cukup',
                    blocks: [
                        `Total yang dibutuhkan termasuk Pajak 5% adalah **${formatLp(res.totalDebit)}**, sedangkan total saldo Cash + Bank kamu hanya **${formatLp(res.balance)}**.`
                    ],
                    ephemeral: true
                })
            );
        }

        await Promise.all([
            addDailyPayTotal(senderId, 'sent', amount, now),
            addDailyPayTotal(targetUser.id, 'recv', amount, now)
        ]);

        return await interaction.reply(
            buildV2Card({
                accentColor: COLORS.SUCCESS,
                title: '💸 Bukti Transfer Antar Warga',
                blocks: [
                    `**${res.sender.username}** berhasil mengirim uang kepada **${res.receiver.username}** (<@${targetUser.id}>).`,
                    [
                        `• 💰 **Nominal Diterima:** **${formatLp(amount)}**`,
                        `• 🏛️ **Pajak Transfer (5%):** ${formatLp(tax)}`,
                        `• 💳 **Total Terpotong:** ${formatLp(totalDebit)}`
                    ].join('\n')
                ]
            })
        );
    }
};
