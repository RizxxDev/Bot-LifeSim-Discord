const crypto = require('crypto');
const db = require('../botHandlers/mysqlHandler');
const config = require('../config.json');
const { redisClient, isRedisReady } = require('../botHandlers/redisHandler');

const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
const WORK_COOLDOWN = 60 * 60 * 1000;
const LEADERBOARD_TTL = 300;

function getGuildId(context) {
    return context.guildId || context.guild?.id || 'global';
}

function normalizeProfile(row) {
    if (!row) return null;
    const cash = Number(row.cash || 0);
    const bank = Number(row.bank || 0);
    return {
        ...row,
        cash,
        bank,
        total: cash + bank,
        daily_streak: Number(row.daily_streak || 0),
        dailyStreak: Number(row.daily_streak || 0),
        last_daily: Number(row.last_daily || 0),
        lastDaily: Number(row.last_daily || 0),
        last_work: Number(row.last_work || 0),
        lastWork: Number(row.last_work || 0)
    };
}

async function getProfile(guildId, userId) {
    const id = typeof guildId === 'string' && !userId ? guildId : userId;
    const rows = await db.query('SELECT * FROM users WHERE user_id = ?', [id]);
    if (rows && rows.length > 0) {
        return normalizeProfile(rows[0]);
    }

    await db.query('INSERT IGNORE INTO users (user_id) VALUES (?)', [id]);
    const created = await db.query('SELECT * FROM users WHERE user_id = ?', [id]);
    return normalizeProfile(created[0] || { user_id: id, cash: 0, bank: 0 });
}

async function getBalance(guildId, userId) {
    const id = typeof guildId === 'string' && !userId ? guildId : userId;
    const rows = await db.query('SELECT cash, bank FROM users WHERE user_id = ?', [id]);
    const cash = Number(rows[0]?.cash || 0);
    const bank = Number(rows[0]?.bank || 0);
    return {
        cash,
        bank,
        total: cash + bank
    };
}

async function claimDaily(guildId, userId) {
    const id = typeof guildId === 'string' && !userId ? guildId : userId;
    const lockKey = `lock:economy:daily:${id}`;

    return withRedisLock(lockKey, 5000, async () => {
        const trx = await db.startTransaction();
        try {
            const rows = await trx.query('SELECT cash, bank, daily_streak, last_daily FROM users WHERE user_id = ? FOR UPDATE', [id]);
            const now = Date.now();

            let currentCash = 0;
            let currentBank = 0;
            let currentStreak = 0;
            let lastDaily = 0;

            if (rows && rows.length > 0) {
                currentCash = Number(rows[0].cash || 0);
                currentBank = Number(rows[0].bank || 0);
                currentStreak = Number(rows[0].daily_streak || 0);
                lastDaily = Number(rows[0].last_daily || 0);
            } else {
                await trx.query('INSERT INTO users (user_id) VALUES (?)', [id]);
            }

            if (lastDaily && now - lastDaily < DAILY_COOLDOWN) {
                await trx.rollback();
                return {
                    claimed: false,
                    availableAt: Math.round((lastDaily + DAILY_COOLDOWN) / 1000)
                };
            }

            const streakBroken = Boolean(lastDaily && now - lastDaily > DAILY_COOLDOWN * 2);
            const nextStreak = streakBroken ? 1 : currentStreak + 1;
            const baseReward = config.economy?.dailyBaseReward || 1500;
            const streakBonus = nextStreak * (config.economy?.dailyStreakBonus || 300);
            const reward = baseReward + streakBonus;
            const newCash = currentCash + reward;

            await trx.query(
                'UPDATE users SET cash = ?, daily_streak = ?, last_daily = ? WHERE user_id = ?',
                [newCash, nextStreak, now, id]
            );

            await trx.commit();
            await clearLeaderboardCache(guildId);

            return {
                claimed: true,
                reward,
                streak: nextStreak,
                streakBroken,
                profile: {
                    user_id: id,
                    cash: newCash,
                    bank: currentBank,
                    daily_streak: nextStreak,
                    dailyStreak: nextStreak,
                    last_daily: now,
                    lastDaily: now
                }
            };
        } catch (error) {
            await trx.rollback();
            throw error;
        }
    });
}

async function work(guildId, userId) {
    const id = typeof guildId === 'string' && !userId ? guildId : userId;
    const cooldownKey = `cooldown:economy:work:${id}`;

    if (isRedisReady()) {
        const ttl = await redisClient.ttl(cooldownKey);
        if (ttl > 0) {
            return { worked: false, availableAt: Math.round(Date.now() / 1000) + ttl };
        }
    }

    const lockKey = `lock:economy:work:${id}`;
    return withRedisLock(lockKey, 5000, async () => {
        const min = config.economy?.workMinReward || 750;
        const max = config.economy?.workMaxReward || 2200;
        const reward = randomInt(min, max);
        const now = Date.now();

        const trx = await db.startTransaction();
        try {
            const rows = await trx.query('SELECT cash, bank, last_work FROM users WHERE user_id = ? FOR UPDATE', [id]);
            let currentCash = 0;
            let currentBank = 0;
            let lastWork = 0;

            if (rows && rows.length > 0) {
                currentCash = Number(rows[0].cash || 0);
                currentBank = Number(rows[0].bank || 0);
                lastWork = Number(rows[0].last_work || 0);
            } else {
                await trx.query('INSERT INTO users (user_id) VALUES (?)', [id]);
            }

            if (!isRedisReady() && lastWork && now - lastWork < WORK_COOLDOWN) {
                await trx.rollback();
                return {
                    worked: false,
                    availableAt: Math.round((lastWork + WORK_COOLDOWN) / 1000)
                };
            }

            const newCash = currentCash + reward;
            await trx.query('UPDATE users SET cash = ?, last_work = ? WHERE user_id = ?', [newCash, now, id]);
            await trx.commit();

            if (isRedisReady()) {
                await redisClient.setEx(cooldownKey, Math.floor(WORK_COOLDOWN / 1000), '1');
            }

            await clearLeaderboardCache(guildId);

            return {
                worked: true,
                reward,
                profile: {
                    user_id: id,
                    cash: newCash,
                    bank: currentBank,
                    last_work: now,
                    lastWork: now
                }
            };
        } catch (error) {
            await trx.rollback();
            throw error;
        }
    });
}

async function deposit(guildId, userId, amount) {
    const id = typeof guildId === 'string' && !userId ? guildId : userId;
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error('Enter a positive amount.');
    }

    const trx = await db.startTransaction();
    try {
        const rows = await trx.query('SELECT cash, bank FROM users WHERE user_id = ? FOR UPDATE', [id]);
        if (!rows || rows.length === 0) {
            throw new Error('User not registered.');
        }

        const currentCash = Number(rows[0].cash || 0);
        const currentBank = Number(rows[0].bank || 0);

        if (currentCash < amount) {
            throw new Error('Not enough cash.');
        }

        const newCash = currentCash - amount;
        const newBank = currentBank + amount;

        await trx.query('UPDATE users SET cash = ?, bank = ? WHERE user_id = ?', [newCash, newBank, id]);
        await trx.commit();
        await clearLeaderboardCache(guildId);

        return {
            user_id: id,
            cash: newCash,
            bank: newBank,
            total: newCash + newBank
        };
    } catch (error) {
        await trx.rollback();
        throw error;
    }
}

async function withdraw(guildId, userId, amount) {
    const id = typeof guildId === 'string' && !userId ? guildId : userId;
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error('Enter a positive amount.');
    }

    const trx = await db.startTransaction();
    try {
        const rows = await trx.query('SELECT cash, bank FROM users WHERE user_id = ? FOR UPDATE', [id]);
        if (!rows || rows.length === 0) {
            throw new Error('User not registered.');
        }

        const currentCash = Number(rows[0].cash || 0);
        const currentBank = Number(rows[0].bank || 0);

        if (currentBank < amount) {
            throw new Error('Not enough bank balance.');
        }

        const newCash = currentCash + amount;
        const newBank = currentBank - amount;

        await trx.query('UPDATE users SET cash = ?, bank = ? WHERE user_id = ?', [newCash, newBank, id]);
        await trx.commit();
        await clearLeaderboardCache(guildId);

        return {
            user_id: id,
            cash: newCash,
            bank: newBank,
            total: newCash + newBank
        };
    } catch (error) {
        await trx.rollback();
        throw error;
    }
}

async function transferCash(guildId, senderId, targetId, amount) {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error('Enter a positive cash amount.');
    }
    if (senderId === targetId) {
        throw new Error('Cannot transfer to yourself.');
    }

    const sortedIds = [senderId, targetId].sort();
    const lockKey = `lock:economy:pay:${sortedIds.join(':')}`;

    return withRedisLock(lockKey, 7000, async () => {
        const trx = await db.startTransaction();
        try {
            // Lock kedua baris secara berurutan untuk mencegah deadlock
            const senderRows = await trx.query('SELECT cash, bank FROM users WHERE user_id = ? FOR UPDATE', [senderId]);
            if (!senderRows || senderRows.length === 0) {
                throw new Error('Sender not registered.');
            }

            const senderCash = Number(senderRows[0].cash || 0);
            if (senderCash < amount) {
                throw new Error('Not enough cash.');
            }

            await trx.query('INSERT IGNORE INTO users (user_id) VALUES (?)', [targetId]);
            await trx.query('SELECT cash FROM users WHERE user_id = ? FOR UPDATE', [targetId]);

            const newSenderCash = senderCash - amount;
            await trx.query('UPDATE users SET cash = ? WHERE user_id = ?', [newSenderCash, senderId]);
            await trx.query('UPDATE users SET cash = cash + ? WHERE user_id = ?', [amount, targetId]);

            await trx.commit();
            await clearLeaderboardCache(guildId);

            return {
                user_id: senderId,
                cash: newSenderCash,
                bank: Number(senderRows[0].bank || 0)
            };
        } catch (error) {
            await trx.rollback();
            throw error;
        }
    });
}

async function transferBank(guildId, senderId, targetId, amount) {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error('Enter a positive bank amount.');
    }
    if (senderId === targetId) {
        throw new Error('Cannot transfer to yourself.');
    }

    const sortedIds = [senderId, targetId].sort();
    const lockKey = `lock:economy:bank:${sortedIds.join(':')}`;

    return withRedisLock(lockKey, 7000, async () => {
        const trx = await db.startTransaction();
        try {
            const senderRows = await trx.query('SELECT cash, bank FROM users WHERE user_id = ? FOR UPDATE', [senderId]);
            if (!senderRows || senderRows.length === 0) {
                throw new Error('Sender not registered.');
            }

            const senderBank = Number(senderRows[0].bank || 0);
            if (senderBank < amount) {
                throw new Error('Not enough bank balance.');
            }

            await trx.query('INSERT IGNORE INTO users (user_id) VALUES (?)', [targetId]);
            await trx.query('SELECT bank FROM users WHERE user_id = ? FOR UPDATE', [targetId]);

            const newSenderBank = senderBank - amount;
            await trx.query('UPDATE users SET bank = ? WHERE user_id = ?', [newSenderBank, senderId]);
            await trx.query('UPDATE users SET bank = bank + ? WHERE user_id = ?', [amount, targetId]);

            await trx.commit();
            await clearLeaderboardCache(guildId);

            return {
                user_id: senderId,
                cash: Number(senderRows[0].cash || 0),
                bank: newSenderBank
            };
        } catch (error) {
            await trx.rollback();
            throw error;
        }
    });
}

async function getLeaderboard(guildId, limit = 10) {
    const cacheKey = `cache:economy:leaderboard:${guildId || 'global'}:${limit}`;

    if (isRedisReady()) {
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                return { rows: JSON.parse(cached), cacheUsed: true };
            }
        } catch (err) {
            console.error('[REDIS LEADERBOARD GET ERROR]', err);
        }
    }

    const rawRows = await db.query(
        `SELECT user_id, cash, bank, (cash + bank) AS total_wealth 
         FROM users 
         ORDER BY (cash + bank) DESC, cash DESC 
         LIMIT ?`,
        [Number(limit) || 10]
    );

    const rows = (rawRows || []).map(r => ({
        user_id: r.user_id,
        cash: Number(r.cash || 0),
        bank: Number(r.bank || 0),
        total_wealth: Number(r.total_wealth || 0)
    }));

    if (isRedisReady() && rows.length > 0) {
        try {
            await redisClient.setEx(cacheKey, LEADERBOARD_TTL, JSON.stringify(rows));
        } catch (err) {
            console.error('[REDIS LEADERBOARD SET ERROR]', err);
        }
    }

    return { rows, cacheUsed: false };
}

function resolveAmount(value, available) {
    if (!value) return NaN;
    if (String(value).toLowerCase() === 'all') return Number(available || 0);
    return Number.parseInt(value, 10);
}

async function clearLeaderboardCache(guildId) {
    if (isRedisReady()) {
        try {
            await redisClient.del(`cache:economy:leaderboard:${guildId || 'global'}:10`);
        } catch (_) {}
    }
}

/**
 * Distributed Lock dengan pelepasan atomik via Redis Lua Script
 */
async function withRedisLock(key, ttlMs, callback) {
    if (!isRedisReady()) {
        return callback();
    }

    const token = crypto.randomUUID();
    let acquired = false;
    try {
        acquired = await redisClient.set(key, token, { NX: true, PX: ttlMs });
    } catch (err) {
        console.error('[REDIS LOCK SET ERROR]', err);
        return callback();
    }

    if (!acquired) {
        throw new Error('This transaction is still being processed. Try again soon.');
    }

    try {
        return await callback();
    } finally {
        const releaseScript = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;
        try {
            await redisClient.eval(releaseScript, { keys: [key], arguments: [token] });
        } catch (err) {
            console.error('[REDIS LOCK RELEASE ERROR]', err);
        }
    }
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = {
    getGuildId,
    getProfile,
    getBalance,
    claimDaily,
    work,
    deposit,
    withdraw,
    transferCash,
    transferBank,
    getLeaderboard,
    resolveAmount,
    clearLeaderboardCache
};
