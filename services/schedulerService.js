const { withTransaction, query } = require('../database/mariadb');
const { calculateMarginalWealthTax, getLiveEconomyConfig } = require('./economyService');
const { BANK } = require('../data/constants');

function getWibParts(ts = Date.now()) {
    const d = new Date(ts + 7 * 3600000);
    return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        dayOfWeek: d.getUTCDay() // 0 = Sun, 1 = Mon
    };
}

function getIsoWeekKey(ts = Date.now()) {
    const p = getWibParts(ts);
    const weekNum = Math.ceil(p.day / 7);
    return `${p.year}-M${p.month}-W${weekNum}`;
}

async function runPeriodicEconomyMaintenance(now = Date.now()) {
    const parts = getWibParts(now);

    // 1. Pajak Kekayaan Mingguan (hari Senin)
    if (parts.dayOfWeek === 1) {
        const weekKey = getIsoWeekKey(now);
        const rows = await query(`SELECT cfg_value FROM economy_config WHERE cfg_key = 'last_wealth_tax_week'`);
        const lastWeek = rows.length > 0 ? JSON.parse(rows[0].cfg_value) : null;

        if (lastWeek !== weekKey) {
            await withTransaction(async (conn) => {
                const liveCfg = await getLiveEconomyConfig(conn);
                if (liveCfg.wealth_tax_enabled !== false) {
                    const [whales] = await conn.execute(
                        `SELECT discord_id, cash, bank FROM players WHERE (cash + bank) > 25000000 AND is_banned = 0 FOR UPDATE`
                    );
                    for (const w of whales) {
                        const totalWealth = Number(w.cash) + Number(w.bank);
                        const tax = calculateMarginalWealthTax(totalWealth);
                        if (tax > 0) {
                            const fromBank = Math.min(Number(w.bank), tax);
                            const fromCash = Math.min(Number(w.cash), tax - fromBank);
                            const newBank = Number(w.bank) - fromBank;
                            const newCash = Number(w.cash) - fromCash;

                            await conn.execute(
                                `UPDATE players SET cash = ?, bank = ? WHERE discord_id = ?`,
                                [newCash, newBank, w.discord_id]
                            );
                            await conn.execute(
                                `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
                                 VALUES (?, 'sink', 'weekly_wealth_tax', ?, ?, ?, ?)`,
                                [w.discord_id, fromBank + fromCash, newCash + newBank, JSON.stringify({ weekKey }), now]
                            );
                        }
                    }
                }
                await conn.execute(
                    `INSERT INTO economy_config (cfg_key, cfg_value, updated_at)
                     VALUES ('last_wealth_tax_week', ?, ?)
                     ON DUPLICATE KEY UPDATE cfg_value = VALUES(cfg_value), updated_at = VALUES(updated_at)`,
                    [JSON.stringify(weekKey), now]
                );
            });
        }
    }

    // 2. Biaya Admin Bank Bulanan (tanggal 1)
    if (parts.day === 1) {
        const monthKey = `${parts.year}-${String(parts.month).padStart(2, '0')}`;
        const rows = await query(`SELECT cfg_value FROM economy_config WHERE cfg_key = 'last_bank_fee_month'`);
        const lastMonth = rows.length > 0 ? JSON.parse(rows[0].cfg_value) : null;

        if (lastMonth !== monthKey) {
            await withTransaction(async (conn) => {
                const [accounts] = await conn.execute(
                    `SELECT discord_id, cash, bank FROM players WHERE bank >= ? AND is_banned = 0 FOR UPDATE`,
                    [BANK.EXEMPT_BELOW_BALANCE]
                );
                for (const acc of accounts) {
                    const fee = Math.min(Number(acc.bank), BANK.MONTHLY_ADMIN_FEE);
                    if (fee > 0) {
                        const newBank = Number(acc.bank) - fee;
                        await conn.execute(
                            `UPDATE players SET bank = ? WHERE discord_id = ?`,
                            [newBank, acc.discord_id]
                        );
                        await conn.execute(
                            `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
                             VALUES (?, 'sink', 'monthly_bank_fee', ?, ?, ?, ?)`,
                            [acc.discord_id, fee, Number(acc.cash) + newBank, JSON.stringify({ monthKey }), now]
                        );
                    }
                }
                await conn.execute(
                    `INSERT INTO economy_config (cfg_key, cfg_value, updated_at)
                     VALUES ('last_bank_fee_month', ?, ?)
                     ON DUPLICATE KEY UPDATE cfg_value = VALUES(cfg_value), updated_at = VALUES(updated_at)`,
                    [JSON.stringify(monthKey), now]
                );
            });
        }
    }
}

function startMaintenanceScheduler() {
    const interval = setInterval(() => {
        runPeriodicEconomyMaintenance(Date.now()).catch(err => {
            console.error('[SCHEDULER ERROR]', err.message);
        });
    }, 3600 * 1000);
    interval.unref?.();
    return interval;
}

module.exports = {
    runPeriodicEconomyMaintenance,
    startMaintenanceScheduler
};
