const { createClient } = require('redis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

let connectPromise = null;
let redisReady = false;

const redisClient = createClient({
    url: redisUrl,
    socket: {
        connectTimeout: 5000,
        reconnectStrategy(retries) {
            if (retries > 5) {
                return false;
            }

            return Math.min(retries * 100, 1000);
        }
    }
});

redisClient.on('connect', () => console.log(`[REDIS] Connecting to ${redisUrl}`));
redisClient.on('ready', () => {
    redisReady = true;
    console.log('[REDIS] Ready.');
});
redisClient.on('reconnecting', () => {
    redisReady = false;
    console.warn('[REDIS] Reconnecting...');
});
redisClient.on('end', () => {
    redisReady = false;
    connectPromise = null;
    console.warn('[REDIS] Connection closed.');
});
redisClient.on('error', (err) => {
    redisReady = false;
    console.error('[REDIS ERROR]', err.message || err);
});

async function connectRedis() {
    if (isRedisReady()) {
        return true;
    }

    if (connectPromise) {
        return connectPromise;
    }

    connectPromise = redisClient.connect()
        .then(() => {
            redisReady = true;
            return true;
        })
        .catch((error) => {
            redisReady = false;
            connectPromise = null;
            console.error('[REDIS] Failed to connect. Cooldown and cache will be skipped.', error.message || error);
            return false;
        });

    return connectPromise;
}

function isRedisReady() {
    return redisReady && redisClient.isOpen && redisClient.isReady;
}

module.exports = {
    redisClient,
    connectRedis,
    isRedisReady
};
