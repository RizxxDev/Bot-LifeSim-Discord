const { REST, Routes } = require('discord.js');
const pool = require('../database/mariadb'); 
const GameLoop = require('../managers/GameLoop');

module.exports = {
    name: 'ready',
    once: true,
    async handle(client) {
        console.log(`✅ Bot is Online as ${client.user.tag}`);
        client.user.setActivity('Farming & Economy Simulator', { type: 0 });

        const commandsJSON = client.slashCommandData || [];

        // ==========================================
        // 1. REGISTER SLASH COMMANDS
        // ==========================================
        try {
            console.log('🌍 Registering Global Slash Commands...');
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commandsJSON });
            console.log('✅ Slash Commands registered successfully!');
        } catch (error) {
            console.error('❌ Failed to register Slash Commands:', error);
        }

        // ==========================================
        // 2. SETUP DATABASE TABLES
        // ==========================================
        try {
            console.log('🗄️ Checking and preparing database tables...');
            
            // ------------------------------------------
            // A. CORE RPG TABLES
            // ------------------------------------------
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
                    last_work BIGINT DEFAULT 0,
                    job_level INT DEFAULT 1,
                    job_exp INT DEFAULT 0
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);

            // Failsafe: Tambahkan kolom RPG dasar jika belum ada
            try {
                await pool.query("ALTER TABLE users ADD COLUMN level INT DEFAULT 1, ADD COLUMN exp INT DEFAULT 0, ADD COLUMN skill_points INT DEFAULT 0, ADD COLUMN job_id VARCHAR(50) DEFAULT NULL, ADD COLUMN last_work BIGINT DEFAULT 0;");
            } catch (err) { 
                if (err.code !== 'ER_DUP_FIELDNAME') console.error('DB Users (RPG):', err.message); 
            }

            // Failsafe: Tambahkan kolom Job Mastery secara terpisah untuk menghindari error
            try {
                await pool.query("ALTER TABLE users ADD COLUMN job_level INT DEFAULT 1, ADD COLUMN job_exp INT DEFAULT 0;");
            } catch (err) { 
                if (err.code !== 'ER_DUP_FIELDNAME') console.error('DB Users (Job Mastery):', err.message); 
            }

            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_skills (
                    user_id VARCHAR(25) PRIMARY KEY,
                    income INT DEFAULT 0,
                    cooldown_skill INT DEFAULT 0,
                    luck INT DEFAULT 0,
                    defense INT DEFAULT 0
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS jobs (
                    id VARCHAR(50) PRIMARY KEY,
                    name VARCHAR(50),
                    min_salary INT,
                    max_salary INT,
                    cooldown BIGINT,
                    min_exp INT,
                    max_exp INT,
                    required_level INT,
                    emoji VARCHAR(10) DEFAULT '💼'
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);

            try {
                await pool.query("ALTER TABLE jobs ADD COLUMN min_exp INT DEFAULT 10, ADD COLUMN max_exp INT DEFAULT 20;");
            } catch (err) { 
                if (err.code !== 'ER_DUP_FIELDNAME') console.error('DB Jobs:', err.message); 
            }

            // Memasukkan Daftar Pekerjaan
            await pool.query(`
                INSERT IGNORE INTO jobs (id, name, min_salary, max_salary, cooldown, min_exp, max_exp, required_level, emoji) VALUES 
                ('janitor', 'Janitor', 100, 200, 60000, 25, 65, 1, '🧹'),
                ('barista', 'Barista', 250, 450, 120000, 70, 150, 3, '☕'),
                ('programmer', 'Programmer', 600, 1000, 300000, 150, 320, 5, '💻');
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS inventory (
                    user_id VARCHAR(25), 
                    item_id VARCHAR(50), 
                    amount INT DEFAULT 0, 
                    PRIMARY KEY (user_id, item_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);

            // ------------------------------------------
            // B. FARMING & MARKET TABLES
            // ------------------------------------------
            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_farms (
                    user_id VARCHAR(25) PRIMARY KEY, 
                    width INT DEFAULT 5, 
                    height INT DEFAULT 5, 
                    max_storage INT DEFAULT 50
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS farm_tiles (
                    id INT AUTO_INCREMENT PRIMARY KEY, 
                    user_id VARCHAR(25), 
                    x INT, 
                    y INT, 
                    crop_id VARCHAR(50) DEFAULT NULL, 
                    growth INT DEFAULT 0, 
                    is_watered BOOLEAN DEFAULT FALSE, 
                    UNIQUE KEY unique_tile (user_id, x, y)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_storage (
                    user_id VARCHAR(25), 
                    item_id VARCHAR(50), 
                    amount INT DEFAULT 0, 
                    PRIMARY KEY (user_id, item_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS market_listings (
                    id INT AUTO_INCREMENT PRIMARY KEY, 
                    seller_id VARCHAR(25), 
                    item_id VARCHAR(50), 
                    amount INT, 
                    price BIGINT, 
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS crafting_queue (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id VARCHAR(25),
                    recipe_id VARCHAR(50),
                    amount INT,
                    start_time BIGINT,
                    end_time BIGINT,
                    INDEX idx_crafting_user (user_id),
                    INDEX idx_crafting_end_time (end_time)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);

            // ------------------------------------------
            // C. SHOP AI & CONVERTER TABLES
            // ------------------------------------------
            await pool.query(`
                CREATE TABLE IF NOT EXISTS global_shop (
                    id INT PRIMARY KEY, 
                    cash BIGINT DEFAULT 1000000, 
                    max_storage INT DEFAULT 10000
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);
            await pool.query(`INSERT IGNORE INTO global_shop (id, cash) VALUES (1, 500000);`); 

            await pool.query(`
                CREATE TABLE IF NOT EXISTS shop_inventory (
                    item_id VARCHAR(50) PRIMARY KEY, 
                    amount INT DEFAULT 0
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS shop_production_queue (
                    id INT AUTO_INCREMENT PRIMARY KEY, 
                    recipe_id VARCHAR(50), 
                    amount INT, 
                    end_time BIGINT
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `);

            await pool.query(`
                INSERT IGNORE INTO shop_inventory (item_id, amount) VALUES 
                ('wheat', 500), 
                ('flour', 200), 
                ('bread', 100);
            `);

            console.log('✅ All MariaDB tables are ready to use!');

            // ==========================================
            // 3. START GAME LOOP
            // ==========================================
            const farmLoop = new GameLoop();
            farmLoop.start();

        } catch (err) {
            console.error('❌ Failed to prepare MariaDB tables:', err);
        }
    }
};
