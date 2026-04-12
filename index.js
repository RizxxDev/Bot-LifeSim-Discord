require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const EventHandler = require('./eventHandlers/EventHandler'); // Import Event Loader

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ]
});

// Setup Collections
client.commands = new Collection();
client.cooldowns = new Collection();
client.slashCommandData = []; // Array sementara untuk Slash Commands

// ==========================================
// 1. COMMAND LOADER
// ==========================================
const loadCommands = (dir) => {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            loadCommands(fullPath);
        } else if (file.endsWith('.js')) {
            const command = require(fullPath);
            if (command.name) {
                client.commands.set(command.name, command);
                if (command.slash && command.data) {
                    client.slashCommandData.push(command.data.toJSON());
                }
            }
        }
    }
};

loadCommands(path.join(__dirname, 'commands'));
console.log(`✅ [SYSTEM] Loaded ${client.commands.size} Commands.`);

// ==========================================
// 2. INITIALIZE EVENT HANDLER
// ==========================================
// Memanggil class EventHandler layaknya OwO Bot
new EventHandler(client);

// ==========================================
// 3. LOGIN
// ==========================================
client.login(process.env.DISCORD_TOKEN);