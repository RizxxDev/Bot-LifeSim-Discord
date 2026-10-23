const pool = require('../database/mariadb');

const acquireTimeLimit = 10000; // Timeout 10 detik

// Shortcut untuk query biasa
exports.query = async function (sql, variables = []) {
    const [rows] = await pool.query(sql, variables);
    return rows;
};

// Sistem Transaksi Khusus dengan Auto-Timeout dan Thread Safety
exports.startTransaction = async () => {
    const conn = await pool.getConnection();
    await conn.beginTransaction();

    let isFinished = false;

    // Timer: Jika bot lupa commit/rollback, sistem otomatis membatalkannya
    const releaseTimer = setTimeout(async () => {
        if (isFinished) return;
        isFinished = true;
        console.error('[DB] Transaksi timeout! Menjalankan auto-rollback.');
        try {
            await conn.rollback();
        } catch (_) {}
        try {
            conn.release();
        } catch (_) {}
    }, acquireTimeLimit);
    releaseTimer.unref();

    const result = {
        commit: async () => {
            if (isFinished) return;
            isFinished = true;
            clearTimeout(releaseTimer);
            try {
                await conn.commit();
            } catch (err) {
                try {
                    await conn.rollback();
                } catch (_) {}
                throw err;
            } finally {
                conn.release();
            }
        },
        rollback: async () => {
            if (isFinished) return;
            isFinished = true;
            clearTimeout(releaseTimer);
            try {
                await conn.rollback();
            } finally {
                conn.release();
            }
        },
        query: async (sql, variables = []) => {
            if (isFinished) {
                throw new Error('[DB] Query executed on finished or timed out transaction.');
            }
            const [rows] = await conn.query(sql, variables);
            return rows;
        }
    };

    return result;
};

exports.pool = pool;
