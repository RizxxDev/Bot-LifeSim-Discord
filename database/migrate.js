require('dotenv').config();
const { initDatabase, getPool } = require('./mariadb');

async function runMigration() {
    try {
        console.log('🔄 Menjalankan migrasi database MariaDB...');
        await initDatabase();
        console.log('✅ Migrasi MariaDB selesai! Seluruh tabel siap digunakan.');
    } catch (error) {
        console.error('❌ Gagal menjalankan migrasi MariaDB:', error.message);
        process.exitCode = 1;
    } finally {
        const pool = getPool();
        if (pool) await pool.end().catch(() => {});
    }
}

if (require.main === module) {
    runMigration();
}

module.exports = { runMigration };
