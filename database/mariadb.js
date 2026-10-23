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

async function initDatabase() {
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

    const dbPool = getPool();
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    const statements = schemaSql
        .split(';')
        .map(s => s.trim())
        .filter(Boolean);

    for (const stmt of statements) {
        await dbPool.query(stmt);
    }

    // Seed default economy config if not exists
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
    withTransaction,
    query
};
