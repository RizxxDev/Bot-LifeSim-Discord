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
        // 2. VERIFIKASI KONEKSI DATABASE
        // ==========================================
        try {
            await pool.query('SELECT 1');
            console.log('✅ MariaDB database connected and ready!');

            // ==========================================
            // 3. START GAME LOOP
            // ==========================================
            const farmLoop = new GameLoop();
            farmLoop.start();
        } catch (err) {
            console.error('❌ MariaDB Connection Error:', err.message || err);
        }
    }
};
