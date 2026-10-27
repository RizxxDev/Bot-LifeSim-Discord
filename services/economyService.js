const {
    NEWBIE_BOOST,
    INCOME_TAX_BRACKETS,
    WEALTH_TAX_BRACKETS,
    SOFT_CAPS
} = require('../data/constants');

function isNewbieBoostActive(player, now = Date.now()) {
    const createdAt = Number(player.created_at || now);
    return (now - createdAt) <= NEWBIE_BOOST.DURATION_MS;
}

function calculateIncomeTax(grossSalary, player, now = Date.now(), taxEnabled = true) {
    if (!taxEnabled) return { tax: 0, rate: 0, newbieExempt: false };
    if (isNewbieBoostActive(player, now) && NEWBIE_BOOST.TAX_EXEMPT) {
        return { tax: 0, rate: 0, newbieExempt: true };
    }

    let rate = 0;
    for (const bracket of INCOME_TAX_BRACKETS) {
        if (grossSalary <= bracket.maxGross) {
            rate = bracket.rate;
            break;
        }
    }

    const tax = Math.round(grossSalary * rate);
    return { tax, rate, newbieExempt: false };
}

function calculateMarginalWealthTax(totalWealth) {
    let wealth = Math.max(0, Number(totalWealth || 0));
    let prevLimit = 0;
    let totalTax = 0;

    for (const bracket of WEALTH_TAX_BRACKETS) {
        if (wealth <= prevLimit) break;
        const taxableInBracket = Math.min(wealth, bracket.upTo) - prevLimit;
        if (taxableInBracket > 0 && bracket.rate > 0) {
            totalTax += taxableInBracket * bracket.rate;
        }
        prevLimit = bracket.upTo;
    }

    return Math.round(totalTax);
}

function getSoftCapModifier(action, currentCountAfterIncrement, softCapEnabled = true) {
    if (!softCapEnabled) {
        return { multiplier: 1.0, trashBonus: 0, isCapped: false };
    }
    const tiers = SOFT_CAPS[action] || [{ maxCount: Infinity, multiplier: 1.0, trashBonus: 0 }];
    for (const tier of tiers) {
        if (currentCountAfterIncrement <= tier.maxCount) {
            return {
                multiplier: tier.multiplier,
                trashBonus: tier.trashBonus || 0,
                isCapped: tier.multiplier < 1.0
            };
        }
    }
    const last = tiers[tiers.length - 1];
    return {
        multiplier: last.multiplier,
        trashBonus: last.trashBonus || 0,
        isCapped: last.multiplier < 1.0
    };
}

/**
 * Mengambil konfigurasi ekonomi dinamis dari tabel economy_config.
 */
async function getLiveEconomyConfig(conn) {
    const defaults = {
        salary_multiplier: 1.0,
        sell_multiplier: 1.0,
        income_tax_enabled: true,
        wealth_tax_enabled: true,
        soft_cap_enabled: true,
        price_overrides: {}
    };

    try {
        const [rows] = await conn.execute(`SELECT cfg_key, cfg_value FROM economy_config`);
        for (const r of rows) {
            try {
                defaults[r.cfg_key] = JSON.parse(r.cfg_value);
            } catch {
                // ignore malformed json
            }
        }
    } catch {
        // use defaults
    }
    return defaults;
}

/**
 * Memotong saldo player (Cash terlebih dahulu, sisanya otomatis dari Bank).
 */
async function debitPlayerFunds(conn, player, amount, source, meta = {}, now = Date.now()) {
    const cost = Math.round(Number(amount || 0));
    if (cost <= 0) return { fromCash: 0, fromBank: 0 };

    const cash = Number(player.cash || 0);
    const bank = Number(player.bank || 0);
    if (cash + bank < cost) {
        throw new Error('INSUFFICIENT_FUNDS');
    }

    const fromCash = Math.min(cash, cost);
    const fromBank = cost - fromCash;

    player.cash = cash - fromCash;
    player.bank = bank - fromBank;

    await conn.execute(
        `UPDATE players SET cash = ?, bank = ? WHERE discord_id = ?`,
        [player.cash, player.bank, player.discord_id]
    );

    await conn.execute(
        `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
         VALUES (?, 'sink', ?, ?, ?, ?, ?)`,
        [
            player.discord_id,
            source,
            cost,
            player.cash + player.bank,
            JSON.stringify({ fromCash, fromBank, ...meta }),
            now
        ]
    );

    return { fromCash, fromBank };
}

/**
 * Menambah saldo Cash player dan mencatatnya sebagai faucet di economy_ledger.
 */
async function creditPlayerCash(conn, player, amount, source, meta = {}, now = Date.now()) {
    const gain = Math.round(Number(amount || 0));
    if (gain <= 0) return 0;

    player.cash = Number(player.cash || 0) + gain;

    await conn.execute(
        `UPDATE players SET cash = ? WHERE discord_id = ?`,
        [player.cash, player.discord_id]
    );

    await conn.execute(
        `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
         VALUES (?, 'faucet', ?, ?, ?, ?, ?)`,
        [
            player.discord_id,
            source,
            gain,
            player.cash + Number(player.bank || 0),
            JSON.stringify(meta),
            now
        ]
    );

    return gain;
}

async function logLedger(conn, discordId, type, source, amount, balanceAfter, meta = {}, now = Date.now()) {
    await conn.execute(
        `INSERT INTO economy_ledger (discord_id, type, source, amount, balance_after, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            discordId,
            type,
            source,
            Math.round(Number(amount || 0)),
            Math.round(Number(balanceAfter || 0)),
            JSON.stringify(meta || {}),
            now
        ]
    );
}

module.exports = {
    isNewbieBoostActive,
    calculateIncomeTax,
    calculateMarginalWealthTax,
    getSoftCapModifier,
    getLiveEconomyConfig,
    debitPlayerFunds,
    creditPlayerCash,
    logLedger
};
