const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function initDatabase() {
    console.log('[DB INIT] Connecting to MariaDB...');
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASS || '',
        database: process.env.DB_NAME || 'lifesim_db',
        multipleStatements: true
    });

    try {
        console.log('[DB INIT] Reading schema.sql...');
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        console.log('[DB INIT] Executing schema.sql...');
        await connection.query(schemaSql);
        console.log('✅ [DB INIT] Database schema successfully initialized with clean relations and constraints!');
    } catch (error) {
        console.error('❌ [DB INIT ERROR]', error.message || error);
        throw error;
    } finally {
        await connection.end();
    }
}

if (require.main === module) {
    initDatabase()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = initDatabase;
