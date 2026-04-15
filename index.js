require('dotenv').config();
const fs = require('fs');
const path = require('path');
// Menambahkan Partials agar bot bisa membaca pesan dari DM yang belum di-cache
const { Client, GatewayIntentBits, Collection, Partials } = require('discord.js');
const EventHandler = require('./eventHandlers/EventHandler'); //

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        // Intent untuk mendengarkan pesan di Direct Message
        GatewayIntentBits.DirectMessages 
    ],
    partials: [
        Partials.Channel,
        Partials.Message
    ]
});

// Setup Collections untuk Command dan Cooldown
client.commands = new Collection();
client.cooldowns = new Collection();
client.slashCommandData = []; // Wadah sementara untuk mendaftarkan Slash Commands

// ==========================================
// 1. COMMAND LOADER (RECURSIVE)
// ==========================================
// Membaca semua file .js di dalam folder commands secara mendalam
const loadCommands = (dir) => {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            loadCommands(fullPath); // Masuk ke sub-folder
        } else if (file.endsWith('.js')) {
            const command = require(fullPath);
            if (command.name) {
                client.commands.set(command.name, command);
                // Menyiapkan data JSON untuk registrasi Slash Command
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
// Memanggil class EventHandler untuk menangani event (ready, messageCreate, dll)
new EventHandler(client);

// ==========================================
// 3. LOGIN
// ==========================================
client.login(process.env.DISCORD_TOKEN);