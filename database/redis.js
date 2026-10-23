require('dotenv').config();
const Redis = require('ioredis');

let redisClient = null;
let useMemoryFallback = false;

// In-memory fallback structures when Redis server is offline
const memKv = new Map();       // key -> { val, expiresAt }
const memSets = new Map();     // key -> { set: Set, expiresAt }

function cleanupMemKey(map, key) {
    const entry = map.get(key);
    if (entry && entry.expiresAt && Date.now() > entry.expiresAt) {
        map.delete(key);
        return null;
    }
    return entry;
}

function getWibDateString(ts = Date.now()) {
    // UTC+7 (7 * 3600 * 1000 = 25200000 ms)
    const wibDate = new Date(ts + 25200000);
    return wibDate.toISOString().slice(0, 10);
}

function getHourBucket(ts = Date.now()) {
    return Math.floor(ts / 3600000);
}

async function initRedis() {
    const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    try {
        const client = new Redis(url, {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            retryStrategy(times) {
                if (times > 2) return null;
                return Math.min(times * 200, 1000);
            }
        });

        client.on('error', () => {
            // Handled gracefully by fallback if disconnected
        });

        await client.connect();
        await client.ping();
        redisClient = client;
        useMemoryFallback = false;
        console.log('✅ Terhubung ke Redis.');
        return redisClient;
    } catch (err) {
        useMemoryFallback = true;
        redisClient = null;
        console.warn('⚠️ Redis tidak terjangkau, menggunakan fallback In-Memory:', err.message);
        return null;
    }
}

function isReady() {
    return Boolean(redisClient && redisClient.status === 'ready' && !useMemoryFallback);
}

// ==========================================
// 1. GENERIC KV HELPERS
// ==========================================
async function getVal(key) {
    if (isReady()) {
        return await redisClient.get(key);
    }
    const entry = cleanupMemKey(memKv, key);
    return entry ? String(entry.val) : null;
}

async function setVal(key, val, ttlSeconds = 3600) {
    if (isReady()) {
        await redisClient.set(key, String(val), 'EX', ttlSeconds);
        return;
    }
    memKv.set(key, {
        val: String(val),
        expiresAt: Date.now() + ttlSeconds * 1000
    });
}

async function delVal(key) {
    if (isReady()) {
        await redisClient.del(key);
        return;
    }
    memKv.delete(key);
}

async function incrByVal(key, amount, ttlSeconds = 93600) {
    if (isReady()) {
        const next = await redisClient.incrby(key, amount);
        if (next === amount) {
            await redisClient.expire(key, ttlSeconds);
        }
        return Number(next);
    }
    const entry = cleanupMemKey(memKv, key);
    const current = entry ? Number(entry.val) : 0;
    const next = current + amount;
    memKv.set(key, {
        val: String(next),
        expiresAt: entry ? entry.expiresAt : Date.now() + ttlSeconds * 1000
    });
    return next;
}

// ==========================================
// 2. USER DISTRIBUTED LOCK (ANTI RACE CONDITION)
// ==========================================
async function acquireUserLock(discordId, ttlSeconds = 15) {
    const key = `lock:user:${discordId}`;
    const token = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (isReady()) {
        const res = await redisClient.set(key, token, 'PX', ttlSeconds * 1000, 'NX');
        return res === 'OK' ? token : null;
    }

    const existing = cleanupMemKey(memKv, key);
    if (existing) return null;
    memKv.set(key, { val: token, expiresAt: Date.now() + ttlSeconds * 1000 });
    return token;
}

async function releaseUserLock(discordId, token) {
    const key = `lock:user:${discordId}`;
    if (isReady()) {
        const current = await redisClient.get(key);
        if (current === token) {
            await redisClient.del(key);
        }
        return;
    }
    const existing = cleanupMemKey(memKv, key);
    if (existing && existing.val === token) {
        memKv.delete(key);
    }
}

// ==========================================
// 3. COOLDOWNS (REDIS + DB FALLBACK)
// ==========================================
async function getCooldownRemaining(discordId, action, dbQueryFn = null) {
    const key = `cd:${discordId}:${action}`;
    const now = Date.now();
    const cached = await getVal(key);
    if (cached) {
        const expiresAt = Number(cached);
        if (expiresAt > now) return expiresAt - now;
    }

    if (dbQueryFn) {
        const rows = await dbQueryFn(
            `SELECT expires_at FROM player_cooldowns WHERE discord_id = ? AND action_key = ?`,
            [discordId, action]
        );
        if (rows.length > 0 && Number(rows[0].expires_at) > now) {
            const expiresAt = Number(rows[0].expires_at);
            const remSeconds = Math.ceil((expiresAt - now) / 1000);
            await setVal(key, expiresAt, remSeconds);
            return expiresAt - now;
        }
    }
    return 0;
}

async function setCooldown(discordId, action, durationSeconds, dbQueryFn = null) {
    const expiresAt = Date.now() + durationSeconds * 1000;
    const key = `cd:${discordId}:${action}`;
    await setVal(key, expiresAt, durationSeconds);

    if (dbQueryFn) {
        await dbQueryFn(
            `INSERT INTO player_cooldowns (discord_id, action_key, expires_at)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`,
            [discordId, action, expiresAt]
        );
    }
    return expiresAt;
}

// ==========================================
// 4. DAILY SOFT CAP, CAFFEINE & PAY LIMITS
// ==========================================
async function getDailyActionCount(discordId, action, ts = Date.now()) {
    const dateWib = getWibDateString(ts);
    const key = `cap:${dateWib}:${discordId}:${action}`;
    const val = await getVal(key);
    return val ? Number(val) : 0;
}

async function incrementDailyAction(discordId, action, ts = Date.now()) {
    const dateWib = getWibDateString(ts);
    const key = `cap:${dateWib}:${discordId}:${action}`;
    return await incrByVal(key, 1, 93600); // 26h TTL
}

async function getCaffeineCount(discordId, itemId, ts = Date.now()) {
    const dateWib = getWibDateString(ts);
    const key = `caffeine:${dateWib}:${discordId}:${itemId}`;
    const val = await getVal(key);
    return val ? Number(val) : 0;
}

async function incrementCaffeineCount(discordId, itemId, amount = 1, ts = Date.now()) {
    const dateWib = getWibDateString(ts);
    const key = `caffeine:${dateWib}:${discordId}:${itemId}`;
    return await incrByVal(key, amount, 93600);
}

async function getDailyPayTotal(discordId, direction = 'sent', ts = Date.now()) {
    const dateWib = getWibDateString(ts);
    const key = `pay:${dateWib}:${discordId}:${direction}`;
    const val = await getVal(key);
    return val ? Number(val) : 0;
}

async function addDailyPayTotal(discordId, direction, amount, ts = Date.now()) {
    const dateWib = getWibDateString(ts);
    const key = `pay:${dateWib}:${discordId}:${direction}`;
    return await incrByVal(key, amount, 93600);
}

// ==========================================
// 5. ROLLING 24H MARKET SUPPLY & DAU
// ==========================================
async function recordMarketSale(itemId, quantity, ts = Date.now()) {
    const bucket = getHourBucket(ts);
    const key = `market:${bucket}:${itemId}`;
    return await incrByVal(key, quantity, 90000); // 25h TTL
}

async function getRolling24hSupply(itemId, ts = Date.now()) {
    const currentBucket = getHourBucket(ts);
    let total = 0;
    const keys = [];
    for (let i = 0; i < 24; i++) {
        keys.push(`market:${currentBucket - i}:${itemId}`);
    }

    if (isReady()) {
        const vals = await redisClient.mget(keys);
        for (const v of vals) {
            if (v) total += Number(v);
        }
        return total;
    }

    for (const k of keys) {
        const v = await getVal(k);
        if (v) total += Number(v);
    }
    return total;
}

async function recordActiveUser(discordId, ts = Date.now()) {
    const dateWib = getWibDateString(ts);
    const key = `dau:${dateWib}`;
    if (isReady()) {
        await redisClient.sadd(key, discordId);
        await redisClient.expire(key, 172800);
        return;
    }
    let entry = cleanupMemKey(memSets, key);
    if (!entry) {
        entry = { set: new Set(), expiresAt: Date.now() + 172800000 };
        memSets.set(key, entry);
    }
    entry.set.add(discordId);
}

async function getActiveUserCount(ts = Date.now()) {
    const dateWib = getWibDateString(ts);
    const key = `dau:${dateWib}`;
    if (isReady()) {
        const count = await redisClient.scard(key);
        return Math.max(1, Number(count));
    }
    const entry = cleanupMemKey(memSets, key);
    return entry ? Math.max(1, entry.set.size) : 1;
}

module.exports = {
    initRedis,
    isReady,
    getWibDateString,
    getHourBucket,
    getVal,
    setVal,
    delVal,
    incrByVal,
    acquireUserLock,
    releaseUserLock,
    getCooldownRemaining,
    setCooldown,
    getDailyActionCount,
    incrementDailyAction,
    getCaffeineCount,
    incrementCaffeineCount,
    getDailyPayTotal,
    addDailyPayTotal,
    recordMarketSale,
    getRolling24hSupply,
    recordActiveUser,
    getActiveUserCount
};
