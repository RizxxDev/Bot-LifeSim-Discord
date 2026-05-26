require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

// 🌟 PANGGIL FUNGSI KONEKSI REDIS
const { connectRedis } = require('./botHandlers/redisHandler');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // Wajib untuk membaca prefix command
    ]
});

client.commands = new Collection();
client.aliases = new Collection();
client.slashCommandData = [];
client.cooldowns = new Collection();

// ==========================================
// COMMAND HANDLER
// ==========================================
const commandsPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(commandsPath);

for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);
    const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
    
    for (const file of commandFiles) {
        const filePath = path.join(folderPath, file);
        const command = require(filePath);
        
        if (command.name) {
            client.commands.set(command.name, command);
            
            // Register Aliases
            if (command.aliases && Array.isArray(command.aliases)) {
                command.aliases.forEach(alias => client.aliases.set(alias, command.name));
            }
            
            // Register Slash Command Data
            if (command.slash && command.data) {
                client.slashCommandData.push(command.data.toJSON());
            }
        }
    }
}

// ==========================================
// EVENT HANDLER
// ==========================================
const eventsPath = path.join(__dirname, 'eventHandlers');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    
    if (event.once) {
        client.once(event.name, (...args) => event.handle(...args, client));
    } else {
        client.on(event.name, (...args) => event.handle(...args, client));
    }
}

async function main() {
    await connectRedis();
    await client.login(process.env.DISCORD_TOKEN);
}

main().catch((error) => {
    console.error('[BOT STARTUP ERROR]', error);
    process.exitCode = 1;
});
