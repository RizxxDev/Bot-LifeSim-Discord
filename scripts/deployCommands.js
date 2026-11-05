require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

function loadCommands(dir, list = []) {
    if (!fs.existsSync(dir)) return list;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            loadCommands(fullPath, list);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            const command = require(fullPath);
            if (command.name && command.slash && command.data) {
                list.push(command);
            }
        }
    }
    return list;
}

async function deploy() {
    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.CLIENT_ID;
    const devGuildId = (process.env.DEV_GUILD_ID || '').trim();

    if (!token || !clientId) {
        console.error('❌ DISCORD_TOKEN atau CLIENT_ID belum disetel di file .env');
        process.exit(1);
    }

    const commandsPath = path.join(__dirname, '..', 'commands');
    const allCommands = loadCommands(commandsPath);

    const publicCommands = [];
    const adminCommands = [];

    for (const cmd of allCommands) {
        const data = cmd.data.toJSON();
        if (cmd.isAdminCommand) {
            adminCommands.push(data);
        } else {
            publicCommands.push(data);
        }
    }

    console.log(`📦 Ditemukan ${allCommands.length} command (${publicCommands.length} publik, ${adminCommands.length} admin).`);

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        if (devGuildId && adminCommands.length > 0) {
            console.log(`🔄 Mendaftarkan ${publicCommands.length} global command & ${adminCommands.length} dev-guild command (${devGuildId})...`);
            await rest.put(Routes.applicationCommands(clientId), { body: publicCommands });
            await rest.put(Routes.applicationGuildCommands(clientId, devGuildId), { body: adminCommands });
        } else {
            const combined = [...publicCommands, ...adminCommands];
            console.log(`🔄 Mendaftarkan ${combined.length} global slash command(s)...`);
            await rest.put(Routes.applicationCommands(clientId), { body: combined });
        }
        console.log('✅ Seluruh Slash Command berhasil didaftarkan ke Discord!');
    } catch (error) {
        console.error('❌ Terjadi kesalahan saat deploy command ke Discord:', error);
        process.exit(1);
    }
}

deploy();
