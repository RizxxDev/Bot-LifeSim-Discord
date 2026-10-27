require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

let pool = null;

function getDbConfig(includeDatabase = true) {
    const cfg = {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        waitForConnections: true,
        connectionLimit: 15,
        queueLimit: 0,
        supportBigNumbers: true,
        bigNumberStrings: false,
        multipleStatements: true
    };
    if (includeDatabase) {
        cfg.database = process.env.DB_NAME || 'life_sim_bot';
    }
    return cfg;
}

function getPool() {
    if (!pool) {
        pool = mysql.createPool(getDbConfig(true));
    }
    return pool;
}

/**
 * Memisahkan isi file SQL menjadi daftar statement yang siap dieksekusi,
 * mengabaikan baris komentar murni dan statement kosong.
 */
function splitSqlStatements(sqlContent) {
    const withoutCommentLines = String(sqlContent || '')
        .split(/\r?\n/)
        .filter(line => !line.trim().startsWith('--'))
        .join('\n');

    return withoutCommentLines
        .split(';')
        .map(s => s.trim())
        .filter(Boolean);
}

/**
 * Membaca seluruh file migrasi bernomor di folder database/migrations/.
 */
function getMigrationFiles() {
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
        return [];
    }

    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
    const parsed = [];

    for (const file of files) {
        const match = file.match(/^(\d+)_(.+)\.sql$/);
        if (!match) continue;
        const version = Number(match[1]);
        const name = file;
        const fullPath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(fullPath, 'utf8');
        parsed.push({
            version,
            name,
            fullPath,
            sql,
            statements: splitSqlStatements(sql)
        });
    }

    parsed.sort((a, b) => a.version - b.version);
    return parsed;
}

async function ensureMigrationsTable(dbPool = getPool()) {
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INT NOT NULL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            applied_at BIGINT NOT NULL,
            execution_ms INT NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
}

async function getMigrationStatus(dbPool = getPool()) {
    await ensureMigrationsTable(dbPool);
    const [appliedRows] = await dbPool.query(
        `SELECT version, name, applied_at, execution_ms FROM schema_migrations ORDER BY version ASC`
    );
    const appliedMap = new Map(appliedRows.map(r => [Number(r.version), r]));
    const files = getMigrationFiles();

    return files.map(f => {
        const app = appliedMap.get(f.version);
        return {
            version: f.version,
            name: f.name,
            status: app ? 'APPLIED' : 'PENDING',
            appliedAt: app ? Number(app.applied_at) : null,
            executionMs: app ? Number(app.execution_ms) : null
        };
    });
}

async function runPendingMigrations(dbPool = getPool()) {
    await ensureMigrationsTable(dbPool);
    const [appliedRows] = await dbPool.query(`SELECT version FROM schema_migrations`);
    const appliedVersions = new Set(appliedRows.map(r => Number(r.version)));
    const files = getMigrationFiles();
    const newlyApplied = [];

    for (const migration of files) {
        if (appliedVersions.has(migration.version)) {
            continue;
        }

        const startAt = Date.now();
        for (const stmt of migration.statements) {
            await dbPool.query(stmt);
        }
        const execMs = Date.now() - startAt;
        const now = Date.now();

        await dbPool.execute(
            `INSERT INTO schema_migrations (version, name, applied_at, execution_ms)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at), execution_ms = VALUES(execution_ms)`,
            [migration.version, migration.name, now, execMs]
        );

        newlyApplied.push({
            version: migration.version,
            name: migration.name,
            executionMs: execMs
        });
    }

    return newlyApplied;
}

async function ensureDatabaseExists() {
    const dbName = process.env.DB_NAME || 'life_sim_bot';
    let rootConn;
    try {
        rootConn = await mysql.createConnection(getDbConfig(false));
        await rootConn.query(
            `CREATE DATABASE IF NOT EXISTS \`${dbName.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
        );
    } catch (err) {
        if (err.message && err.message.includes('auth_gssapi_client')) {
            throw new Error(
                'Autentikasi MariaDB ditolak (MariaDB meminta auth_gssapi_client karena password kosong/salah). Pastikan DB_USER dan DB_PASSWORD di file .env sudah diisi sesuai password MariaDB Anda.'
            );
        }
        throw err;
    } finally {
        if (rootConn) await rootConn.end().catch(() => {});
    }
}

async function seedDefaultEconomyConfig(dbPool = getPool()) {
    const defaultConfigs = {
        salary_multiplier: 1.0,
        sell_multiplier: 1.0,
        income_tax_enabled: true,
        wealth_tax_enabled: true,
        soft_cap_enabled: true,
        price_overrides: {}
    };

    const now = Date.now();
    for (const [key, val] of Object.entries(defaultConfigs)) {
        await dbPool.execute(
            `INSERT IGNORE INTO economy_config (cfg_key, cfg_value, updated_at) VALUES (?, ?, ?)`,
            [key, JSON.stringify(val), now]
        );
    }
}

async function initDatabase() {
    await ensureDatabaseExists();
    const dbPool = getPool();
    await runPendingMigrations(dbPool);
    await seedDefaultEconomyConfig(dbPool);
    return dbPool;
}

async function withTransaction(callback) {
    const dbPool = getPool();
    const conn = await dbPool.getConnection();
    try {
        await conn.beginTransaction();
        const result = await callback(conn);
        await conn.commit();
        return result;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function query(sql, params = []) {
    const [rows] = await getPool().execute(sql, params);
    return rows;
}

module.exports = {
    getPool,
    initDatabase,
    ensureDatabaseExists,
    splitSqlStatements,
    getMigrationFiles,
    getMigrationStatus,
    runPendingMigrations,
    withTransaction,
    query
};
