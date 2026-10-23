const db = require('../botHandlers/mysqlHandler');
const { redisClient, isRedisReady } = require('../botHandlers/redisHandler');

// In-memory fallback saat Redis offline
const memoryCooldowns = new Map();

/**
 * Mengecek apakah user sudah terdaftar di tabel users MariaDB.
 * Menggunakan SELECT 1 ... LIMIT 1 untuk efisiensi tinggi.
 */
exports.checkRegistration = async (userId) => {
    try {
        const rows = await db.query('SELECT 1 FROM users WHERE user_id = ? LIMIT 1', [userId]);
        return Boolean(rows && rows.length > 0);
    } catch (error) {
        console.error('[CHECK REGISTRATION ERROR]', error);
        return false;
    }
};

/**
 * Mengecek apakah user sedang dalam masa cooldown untuk command tertentu via Redis.
 * Menggunakan in-memory Map sebagai fallback jika Redis offline.
 */
exports.checkCooldown = async (command, userId) => {
    const cooldownAmount = command.cooldown || 3;
    const now = Date.now();

    // 1. Jalur Utama: Redis Ready
    if (isRedisReady()) {
        const redisKey = `cooldown:${command.name}:${userId}`;
        try {
            const expirationTime = await redisClient.get(redisKey);
            if (expirationTime) {
                const timeLeft = (parseInt(expirationTime, 10) - now) / 1000;
                if (timeLeft > 0) {
                    return timeLeft.toFixed(1);
                }
            }

            const expireTimestamp = now + (cooldownAmount * 1000);
            await redisClient.setEx(redisKey, cooldownAmount, expireTimestamp.toString());
            return false;
        } catch (error) {
            console.error('[REDIS COOLDOWN ERROR]', error);
            // Fallback ke in-memory jika terjadi error saat memanggil Redis
        }
    }

    // 2. Fallback: In-Memory Cooldown Map
    if (!memoryCooldowns.has(command.name)) {
        memoryCooldowns.set(command.name, new Map());
    }

    const commandTimestamps = memoryCooldowns.get(command.name);
    const expiration = commandTimestamps.get(userId);

    if (expiration && now < expiration) {
        const timeLeft = (expiration - now) / 1000;
        return timeLeft.toFixed(1);
    }

    const expireTimestamp = now + (cooldownAmount * 1000);
    commandTimestamps.set(userId, expireTimestamp);

    // Bersihkan memori otomatis setelah durasi cooldown lewat
    setTimeout(() => {
        if (commandTimestamps.get(userId) === expireTimestamp) {
            commandTimestamps.delete(userId);
        }
    }, cooldownAmount * 1000).unref();

    return false;
};
