const { REST, Routes, ActivityType } = require('discord.js');
const { startMaintenanceScheduler } = require('../services/schedulerService');

module.exports = {
    name: 'ready',
    once: true,
    async handle(client) {
        console.log(`✅ Logged in as ${client.user.tag}`);
        client.user.setActivity('Life Simulation · /start | /help', { type: ActivityType.Playing });

        startMaintenanceScheduler();

        const publicCommands = client.slashCommandData || [];
        const adminCommands = client.adminCommandData || [];
        const devGuildId = (process.env.DEV_GUILD_ID || '').trim();

        if (process.env.CLIENT_ID && process.env.DISCORD_TOKEN) {
            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
            try {
                if (devGuildId && adminCommands.length > 0) {
                    console.log(`🔄 Mendaftarkan ${publicCommands.length} global command & ${adminCommands.length} dev-guild command...`);
                    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: publicCommands });
                    await rest.put(
                        Routes.applicationGuildCommands(process.env.CLIENT_ID, devGuildId),
                        { body: adminCommands }
                    );
                } else {
                    const combined = [...publicCommands, ...adminCommands];
                    console.log(`🔄 Mendaftarkan ${combined.length} global slash command(s)...`);
                    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: combined });
                }
                console.log('✅ Seluruh Slash Command berhasil didaftarkan!');
            } catch (error) {
                console.error('❌ Gagal mendaftarkan Slash Commands:', error);
            }
        }
    }
};
