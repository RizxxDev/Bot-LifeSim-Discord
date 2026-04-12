const { REST, Routes } = require('discord.js');
const pool = require('../database/mariadb'); // Untuk execute CREATE TABLE murni

module.exports = {
    name: 'ready',
    once: true,
    async handle(client) {
        console.log(`✅ Bot is Online as ${client.user.tag}`);
        client.user.setActivity('The Real Life Sim', { type: 0 });

        const commandsJSON = client.slashCommandData || [];

        try {
            console.log('🌍 Registering Global Slash Commands...');
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commandsJSON });
            console.log('✅ Slash Commands registered successfully!');
        } catch (error) {
            console.error('❌ Failed to register Slash Commands:', error);
        }

        try {
            console.log('🗄️ Checking and preparing database tables...');
            await pool.query(`CREATE TABLE IF NOT EXISTS users (user_id VARCHAR(25) PRIMARY KEY, cash BIGINT DEFAULT 0, bank BIGINT DEFAULT 0, energy INT DEFAULT 100, hunger INT DEFAULT 100, last_daily BIGINT DEFAULT 0, daily_streak INT DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
            await pool.query(`CREATE TABLE IF NOT EXISTS inventory (user_id VARCHAR(25), item_id VARCHAR(50), amount INT DEFAULT 0, PRIMARY KEY (user_id, item_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
            await pool.query(`CREATE TABLE IF NOT EXISTS market (id INT AUTO_INCREMENT PRIMARY KEY, seller_id VARCHAR(25), item_id VARCHAR(50), amount INT, unit_price BIGINT, date_sold TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
            console.log('✅ All MariaDB tables are ready to use!');
        } catch (err) {
            console.error('❌ Failed to prepare MariaDB tables:', err);
        }
    }
};