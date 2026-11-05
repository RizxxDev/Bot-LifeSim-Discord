const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { BANK } = require('../../data/constants');
const { COLORS, formatLp } = require('../../utils/uiBuilder');
const {
    buildPanel,
    btn,
    percentRow,
    numberModal,
    parseModalNumber,
    respondOrUpdate
} = require('../../utils/panelBuilder');

function buildBankPanel(player, mode = 'home', banner = null, now = Date.now()) {
    const ownerId = player.discord_id;
    const cash = Number(player.cash || 0);
    const bank = Number(player.bank || 0);
    const total = cash + bank;

    const summaryBlock = [
        `• 💵 **Dompet (Cash):** **${formatLp(cash)}**`,
        `• 🏦 **Tabungan Bank:** **${formatLp(bank)}**`,
        `• 💎 **Total Kekayaan:** **${formatLp(total)}**`
    ].join('\n');

    const infoBlock = `💡 **Keamanan Bank:** Uang di **Bank** aman dari potongan persentase biaya Rumah Sakit saat pingsan. Biaya admin bank hanya **${formatLp(BANK.MONTHLY_ADMIN_FEE)}/bulan** *(gratis bila saldo bank di bawah ${formatLp(BANK.EXEMPT_BELOW_BALANCE)})*.`;

    const rows = [];
    const blocks = [summaryBlock, infoBlock];

    if (mode === 'deposit') {
        blocks.push(
            `📥 **Mode Setor Tunai (Deposit)**\nPilih persentase dari **Cash (${formatLp(cash)})** yang ingin disetor ke rekening Bank, atau klik **✏️ Nominal Lain**:`
        );
        rows.push(
            percentRow('bank', 'dep_pct', ownerId, {
                customAction: 'dep_modal',
                backAction: 'home',
                disabled: cash <= 0
            }, now)
        );
    } else if (mode === 'withdraw') {
        blocks.push(
            `📤 **Mode Tarik Tunai (Withdraw)**\nPilih persentase dari **Saldo Bank (${formatLp(bank)})** yang ingin ditarik ke Dompet, atau klik **✏️ Nominal Lain**:`
        );
        rows.push(
            percentRow('bank', 'wd_pct', ownerId, {
                customAction: 'wd_modal',
                backAction: 'home',
                disabled: bank <= 0
            }, now)
        );
    } else {
        rows.push(
            new ActionRowBuilder().addComponents(
                btn('bank', 'mode_dep', ownerId, {
                    label: 'Setor Tunai (Deposit)',
                    emoji: '📥',
                    style: ButtonStyle.Success,
                    disabled: cash <= 0
                }, now),
                btn('bank', 'mode_wd', ownerId, {
                    label: 'Tarik Tunai (Withdraw)',
                    emoji: '📤',
                    style: ButtonStyle.Primary,
                    disabled: bank <= 0
                }, now),
                btn('bank', 'home', ownerId, {
                    label: 'Segarkan',
                    emoji: '🔄',
                    style: ButtonStyle.Secondary
                }, now)
            )
        );
    }

    return buildPanel({
        mod: 'bank',
        ownerId,
        accentColor: COLORS.ECONOMY,
        title: `🏦 Layanan Perbankan & Dompet`,
        player,
        banner,
        blocks,
        rows,
        footer: 'Pilih tombol di bawah untuk menyetor atau menarik uang tunai secara instan.',
        now
    });
}

async function executeBankTransfer(discordId, direction, amountOrPct, isPercent = false, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const cash = Number(p.cash || 0);
        const bank = Number(p.bank || 0);

        if (direction === 'deposit') {
            if (cash <= 0) {
                return { error: 'EMPTY_SOURCE', player: p };
            }
            const amount = isPercent
                ? (amountOrPct >= 100 ? cash : Math.max(1, Math.floor((cash * amountOrPct) / 100)))
                : Math.floor(Number(amountOrPct));

            if (!amount || amount <= 0) {
                return { error: 'INVALID_AMOUNT', player: p };
            }
            if (amount > cash) {
                return { error: 'INSUFFICIENT_CASH', currentCash: cash, player: p };
            }

            p.cash = cash - amount;
            p.bank = bank + amount;
            await conn.execute(
                `UPDATE players SET cash = ?, bank = ? WHERE discord_id = ?`,
                [p.cash, p.bank, discordId]
            );
            return { ok: true, amount, player: p };
        } else {
            if (bank <= 0) {
                return { error: 'EMPTY_SOURCE', player: p };
            }
            const amount = isPercent
                ? (amountOrPct >= 100 ? bank : Math.max(1, Math.floor((bank * amountOrPct) / 100)))
                : Math.floor(Number(amountOrPct));

            if (!amount || amount <= 0) {
                return { error: 'INVALID_AMOUNT', player: p };
            }
            if (amount > bank) {
                return { error: 'INSUFFICIENT_BANK', currentBank: bank, player: p };
            }

            p.bank = bank - amount;
            p.cash = cash + amount;
            await conn.execute(
                `UPDATE players SET cash = ?, bank = ? WHERE discord_id = ?`,
                [p.cash, p.bank, discordId]
            );
            return { ok: true, amount, player: p };
        }
    });
}

module.exports = {
    name: 'bank',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('bank')
        .setDescription('Kelola saldo Dompet (Cash), Tabungan Bank, Setor Tunai, dan Tarik Tunai.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const synced = await withTransaction(conn => syncPlayerVitals(conn, interaction.user.id, now, false));
        return await interaction.reply(buildBankPanel(synced.player, 'home', null, now));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const synced = await withTransaction(conn => syncPlayerVitals(conn, interaction.user.id, now, false));
                return await interaction.update(buildBankPanel(synced.player, 'home', null, now));
            },
            async mode_dep(interaction) {
                const now = Date.now();
                const synced = await withTransaction(conn => syncPlayerVitals(conn, interaction.user.id, now, false));
                return await interaction.update(buildBankPanel(synced.player, 'deposit', null, now));
            },
            async mode_wd(interaction) {
                const now = Date.now();
                const synced = await withTransaction(conn => syncPlayerVitals(conn, interaction.user.id, now, false));
                return await interaction.update(buildBankPanel(synced.player, 'withdraw', null, now));
            },
            async dep_pct(interaction, parsed) {
                const now = Date.now();
                const pct = Number(parsed.arg || 100);
                const res = await executeBankTransfer(interaction.user.id, 'deposit', pct, true, now);
                if (!res.ok) {
                    return await interaction.update(
                        buildBankPanel(res.player, 'deposit', {
                            type: 'warning',
                            text: 'Saldo uang tunai (Cash) kamu kosong atau tidak mencukupi untuk disetor.'
                        }, now)
                    );
                }
                return await interaction.update(
                    buildBankPanel(res.player, 'home', {
                        type: 'success',
                        text: `Berhasil menyetor **${formatLp(res.amount)}** ke rekening Bank.`
                    }, now)
                );
            },
            async wd_pct(interaction, parsed) {
                const now = Date.now();
                const pct = Number(parsed.arg || 100);
                const res = await executeBankTransfer(interaction.user.id, 'withdraw', pct, true, now);
                if (!res.ok) {
                    return await interaction.update(
                        buildBankPanel(res.player, 'withdraw', {
                            type: 'warning',
                            text: 'Saldo tabungan Bank kamu kosong atau tidak mencukupi untuk ditarik.'
                        }, now)
                    );
                }
                return await interaction.update(
                    buildBankPanel(res.player, 'home', {
                        type: 'success',
                        text: `Berhasil menarik **${formatLp(res.amount)}** dari Bank ke Dompet.`
                    }, now)
                );
            },
            async dep_modal(interaction) {
                const now = Date.now();
                return await interaction.showModal(
                    numberModal('bank', 'dep_submit', interaction.user.id, {
                        title: 'Setor Tunai ke Bank',
                        label: 'Nominal Lp yang ingin disetor',
                        placeholder: 'Contoh: 50000'
                    }, now)
                );
            },
            async wd_modal(interaction) {
                const now = Date.now();
                return await interaction.showModal(
                    numberModal('bank', 'wd_submit', interaction.user.id, {
                        title: 'Tarik Tunai dari Bank',
                        label: 'Nominal Lp yang ingin ditarik',
                        placeholder: 'Contoh: 50000'
                    }, now)
                );
            }
        },
        modals: {
            async dep_submit(interaction) {
                const now = Date.now();
                const parsedNum = parseModalNumber(interaction, { min: 1 });
                if (!parsedNum.ok) {
                    const synced = await withTransaction(conn => syncPlayerVitals(conn, interaction.user.id, now, false));
                    const payload = buildBankPanel(synced.player, 'deposit', { type: 'warning', text: parsedNum.error }, now);
                    return await respondOrUpdate(interaction, payload);
                }

                const res = await executeBankTransfer(interaction.user.id, 'deposit', parsedNum.value, false, now);
                if (!res.ok) {
                    const msg = res.error === 'INSUFFICIENT_CASH'
                        ? `Uang tunai tidak cukup! Saldo Cash kamu hanya **${formatLp(res.currentCash)}**.`
                        : 'Nominal setoran tidak valid.';
                    const payload = buildBankPanel(res.player, 'deposit', { type: 'danger', text: msg }, now);
                    return await respondOrUpdate(interaction, payload);
                }

                const payload = buildBankPanel(res.player, 'home', {
                    type: 'success',
                    text: `Berhasil menyetor **${formatLp(res.amount)}** ke rekening Bank.`
                }, now);
                return await respondOrUpdate(interaction, payload);
            },
            async wd_submit(interaction) {
                const now = Date.now();
                const parsedNum = parseModalNumber(interaction, { min: 1 });
                if (!parsedNum.ok) {
                    const synced = await withTransaction(conn => syncPlayerVitals(conn, interaction.user.id, now, false));
                    const payload = buildBankPanel(synced.player, 'withdraw', { type: 'warning', text: parsedNum.error }, now);
                    return await respondOrUpdate(interaction, payload);
                }

                const res = await executeBankTransfer(interaction.user.id, 'withdraw', parsedNum.value, false, now);
                if (!res.ok) {
                    const msg = res.error === 'INSUFFICIENT_BANK'
                        ? `Saldo Bank tidak cukup! Tabunganmu saat ini hanya **${formatLp(res.currentBank)}**.`
                        : 'Nominal penarikan tidak valid.';
                    const payload = buildBankPanel(res.player, 'withdraw', { type: 'danger', text: msg }, now);
                    return await respondOrUpdate(interaction, payload);
                }

                const payload = buildBankPanel(res.player, 'home', {
                    type: 'success',
                    text: `Berhasil menarik **${formatLp(res.amount)}** dari Bank ke Dompet.`
                }, now);
                return await respondOrUpdate(interaction, payload);
            }
        }
    },

    buildBankPanel,
    executeBankTransfer
};
