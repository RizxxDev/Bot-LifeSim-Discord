require('dotenv').config();
const {
    initDatabase,
    ensureDatabaseExists,
    getMigrationStatus,
    runPendingMigrations,
    getPool
} = require('./mariadb');

async function runMigration(action = 'up') {
    try {
        await ensureDatabaseExists();
        const pool = getPool();

        if (action === 'status') {
            console.log('📋 Memeriksa status migrasi MariaDB...\n');
            const statusList = await getMigrationStatus(pool);
            for (const item of statusList) {
                const badge = item.status === 'APPLIED' ? '✅ APPLIED' : '⏳ PENDING';
                const timeInfo = item.appliedAt
                    ? `(${new Date(item.appliedAt).toISOString()} · ${item.executionMs}ms)`
                    : '';
                console.log(`  [${String(item.version).padStart(3, '0')}] ${badge} — ${item.name} ${timeInfo}`);
            }
            console.log('');
            return statusList;
        }

        console.log('🔄 Menjalankan migrasi berversi MariaDB...');
        const applied = await runPendingMigrations(pool);
        await initDatabase();

        if (applied.length === 0) {
            console.log('✨ Tidak ada migrasi baru. Skema database sudah berada di versi terbaru.');
        } else {
            for (const m of applied) {
                console.log(`  ✅ Applied [${String(m.version).padStart(3, '0')}] ${m.name} (${m.executionMs}ms)`);
            }
            console.log(`✅ Berhasil menerapkan ${applied.length} file migrasi!`);
        }

        const statusList = await getMigrationStatus(pool);
        return statusList;
    } catch (error) {
        console.error('❌ Gagal menjalankan migrasi MariaDB:', error.message);
        process.exitCode = 1;
        throw error;
    } finally {
        if (require.main === module) {
            const pool = getPool();
            if (pool) await pool.end().catch(() => {});
        }
    }
}

if (require.main === module) {
    const cliArg = (process.argv[2] || 'up').toLowerCase();
    runMigration(cliArg).catch(() => {});
}

module.exports = { runMigration };
