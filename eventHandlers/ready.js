const { REST, Routes } = require('discord.js');
const pool = require('../database/mariadb'); 

module.exports = {
    name: 'ready',
    once: true,
    async handle(client) {
        console.log(`✅ Bot is Online as ${client.user.tag}`);
        client.user.setActivity('The Real Life Sim', { type: 0 });

        const commandsJSON = client.slashCommandData || [];

        // 1. Mendaftarkan Slash Command
        try {
            console.log('🌍 Registering Global Slash Commands...');
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commandsJSON });
            console.log('✅ Slash Commands registered successfully!');
        } catch (error) {
            console.error('❌ Failed to register Slash Commands:', error);
        }

        // 2. Setup Database RPG
        try {
            console.log('🗄️ Checking and preparing database tables...');
            
            // Tabel Users (Update dengan kolom Level, EXP, dll)
            await pool.query(`
                CREATE TABLE IF NOT EXISTS users (
                    user_id VARCHAR(25) PRIMARY KEY, 
                    cash BIGINT DEFAULT 0, 
                    bank BIGINT DEFAULT 0, 
                    energy INT DEFAULT 100, 
                    hunger INT DEFAULT 100, 
                    last_daily BIGINT DEFAULT 0, 
                    daily_streak INT DEFAULT 0,
                    level INT DEFAULT 1,
                    exp INT DEFAULT 0,
                    skill_points INT DEFAULT 0,
                    job_id VARCHAR(50) DEFAULT NULL,
                    last_work BIGINT DEFAULT 0
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);

            // Memaksa penambahan kolom baru jika tabel users sudah ada sebelumnya
            try {
                await pool.query("ALTER TABLE users ADD COLUMN level INT DEFAULT 1, ADD COLUMN exp INT DEFAULT 0, ADD COLUMN skill_points INT DEFAULT 0, ADD COLUMN job_id VARCHAR(50) DEFAULT NULL, ADD COLUMN last_work BIGINT DEFAULT 0;");
            } catch (err) { 
                if (err.code !== 'ER_DUP_FIELDNAME') console.error('Peringatan DB Users:', err.message); 
            }

            // Tabel Pohon Keahlian (Skill Tree)
            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_skills (
                    user_id VARCHAR(25) PRIMARY KEY,
                    income INT DEFAULT 0,
                    cooldown_skill INT DEFAULT 0,
                    luck INT DEFAULT 0,
                    defense INT DEFAULT 0
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);

            // Tabel Daftar Pekerjaan (Jobs)
            await pool.query(`
                CREATE TABLE IF NOT EXISTS jobs (
                    id VARCHAR(50) PRIMARY KEY,
                    name VARCHAR(50),
                    min_salary INT,
                    max_salary INT,
                    cooldown BIGINT,
                    exp_gain INT,
                    required_level INT,
                    emoji VARCHAR(10) DEFAULT '💼'
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);

            // Masukkan Pekerjaan Default (Akan diabaikan jika sudah ada berkat IGNORE)
            await pool.query(`
                INSERT IGNORE INTO jobs (id, name, min_salary, max_salary, cooldown, exp_gain, required_level, emoji) VALUES 
                ('janitor', 'Janitor', 100, 200, 60000, 20, 1, '🧹'),
                ('barista', 'Barista', 250, 450, 120000, 35, 3, '☕'),
                ('programmer', 'Programmer', 600, 1000, 300000, 65, 5, '💻');
            `);

            // Tabel Lama
            await pool.query(`CREATE TABLE IF NOT EXISTS inventory (user_id VARCHAR(25), item_id VARCHAR(50), amount INT DEFAULT 0, PRIMARY KEY (user_id, item_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
            await pool.query(`CREATE TABLE IF NOT EXISTS market (id INT AUTO_INCREMENT PRIMARY KEY, seller_id VARCHAR(25), item_id VARCHAR(50), amount INT, unit_price BIGINT, date_sold TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
            
            console.log('✅ All MariaDB tables are ready to use!');
        } catch (err) {
            console.error('❌ Failed to prepare MariaDB tables:', err);
        }
    }
};