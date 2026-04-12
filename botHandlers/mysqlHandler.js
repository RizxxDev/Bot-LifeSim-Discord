const pool = require('../database/mariadb');

const acquireTimeLimit = 10000; // Timeout 10 detik seperti OwO Bot

// Shortcut untuk query biasa
exports.query = async function (sql, variables = []) {
    const [rows] = await pool.query(sql, variables);
    return rows;
};

// Sistem Transaksi Khusus dengan Auto-Timeout
exports.startTransaction = async () => {
    const conn = await pool.getConnection();
    await conn.beginTransaction();

    // Timer: Jika bot lupa commit/rollback, sistem otomatis membatalkannya
    const releaseTimer = setTimeout(async () => {
        console.error(`[DB] Transaksi Terlalu Lama! Auto-Rollback dieksekusi.`);
        await result.rollback();
    }, acquireTimeLimit);

    const result = {
        commit: async () => {
            clearTimeout(releaseTimer);
            try {
                await conn.commit();
            } catch (err) {
                await conn.rollback();
                throw err;
            } finally {
                conn.release();
            }
        },
        rollback: async () => {
            clearTimeout(releaseTimer);
            await conn.rollback();
            conn.release();
        },
        query: async (sql, variables = []) => {
            const [rows] = await conn.query(sql, variables);
            return rows;
        }
    };

    return result;
};