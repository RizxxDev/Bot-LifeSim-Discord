require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { initDatabase } = require('./database/mariadb');
const { initRedis } = require('./database/redis');
const { registerPanel } = require('./services/panelRouter');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

client.commands = new Collection();
client.slashCommandData = [];
client.adminCommandData = [];

// ==========================================
// 1. SLASH COMMAND HANDLER
// ==========================================
function loadCommands(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            loadCommands(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            const command = require(fullPath);
            if (command.name && command.slash && command.data) {
                client.commands.set(command.name, command);
                if (command.panel) {
                    registerPanel(
                        command.name,
                        command.panel,
                        command.lockTtl || 15,
                        Boolean(command.skipRegistrationCheck)
                    );
                }
                if (command.isAdminCommand) {
                    client.adminCommandData.push(command.data.toJSON());
                } else {
                    client.slashCommandData.push(command.data.toJSON());
                }
            }
        }
    }
}

loadCommands(path.join(__dirname, 'commands'));
console.log(`✅ Loaded ${client.commands.size} slash command(s).`);

// ==========================================
// 2. EVENT HANDLER
// ==========================================
const eventsPath = path.join(__dirname, 'eventHandlers');
if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        const event = require(filePath);

        if (event.name && typeof event.handle === 'function') {
            if (event.once) {
                client.once(event.name, (...args) => event.handle(...args, client));
            } else {
                client.on(event.name, (...args) => event.handle(...args, client));
            }
        }
    }
    console.log(`✅ Loaded ${eventFiles.length} event(s).`);
}

// ==========================================
// 3. DATABASE, REDIS & BOT STARTUP
// ==========================================
async function main() {
    if (!process.env.DISCORD_TOKEN) {
        throw new Error('DISCORD_TOKEN belum diatur di file .env');
    }

    await initDatabase();
    console.log('✅ Database MariaDB siap.');

    await initRedis();

    await client.login(process.env.DISCORD_TOKEN);
}

if (require.main === module) {
    main().catch((error) => {
        console.error('[BOT STARTUP ERROR]', error);
        process.exitCode = 1;
    });
}

module.exports = { client };
