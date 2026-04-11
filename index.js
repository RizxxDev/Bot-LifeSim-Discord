require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');

// PENTING: Pastikan file koneksi database kamu ada di folder 'database' dengan nama 'mariadb.js'
// Jika file databasemu ada di luar dengan nama 'db.js', ubah menjadi: require('./db');
const pool = require('./database/mariadb'); 

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();
client.cooldowns = new Collection(); // Disiapkan untuk sistem anti-spam
const commandsJSON = []; 

// ==========================================
// 1. LOAD COMMANDS
// ==========================================
const foldersPath = path.join(__dirname, 'commands');
if (!fs.existsSync(foldersPath)) fs.mkdirSync(foldersPath);

const commandFolders = fs.readdirSync(foldersPath);
for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    
    // Membaca sub-folder di dalam folder commands (jika ada)
    if (fs.statSync(commandsPath).isDirectory()) {
        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
        for (const file of commandFiles) {
            const command = require(path.join(commandsPath, file));
            if ('name' in command) {
                client.commands.set(command.name, command);
                // Jika command mendukung slash, masukkan ke array JSON
                if (command.slash && command.data) {
                    commandsJSON.push(command.data.toJSON());
                }
            }
        }
    } 
    // Membaca file .js langsung di dalam folder commands
    else if (folder.endsWith('.js')) {
        const command = require(commandsPath);
        if ('name' in command) {
            client.commands.set(command.name, command);
            if (command.slash && command.data) {
                commandsJSON.push(command.data.toJSON());
            }
        }
    }
}

// ==========================================
// 2. REGISTER SLASH COMMANDS & DATABASE
// ==========================================
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('ready', async () => {
    console.log(`✅ Bot Aktif sebagai ${client.user.tag}`);
    client.user.setActivity('The Real Life Sim', { type: 0 });

    // Register Slash Commands ke Discord API
    try {
        console.log('🌍 Mendaftarkan Global Slash Commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commandsJSON }
        );
        console.log('✅ Slash Commands berhasil didaftarkan!');
    } catch (error) {
        console.error('❌ Gagal mendaftarkan Slash Commands:', error);
    }

    // Setup Database Otomatis
    try {
        console.log('🗄️ Memeriksa dan menyiapkan tabel database...');
        
        await pool.query(`CREATE TABLE IF NOT EXISTS users (user_id VARCHAR(25) PRIMARY KEY, uang BIGINT DEFAULT 0, bank BIGINT DEFAULT 0, energi INT DEFAULT 100, lapar INT DEFAULT 100) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
        await pool.query(`CREATE TABLE IF NOT EXISTS inventory (user_id VARCHAR(25), item_id VARCHAR(50), jumlah INT DEFAULT 0, PRIMARY KEY (user_id, item_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
        await pool.query(`CREATE TABLE IF NOT EXISTS market (id INT AUTO_INCREMENT PRIMARY KEY, seller_id VARCHAR(25), item_id VARCHAR(50), jumlah INT, harga_satuan BIGINT, tanggal_dijual TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
        
        console.log('✅ Semua tabel MariaDB siap digunakan!');
    } catch (err) {
        console.error('❌ Gagal menyiapkan tabel MariaDB:', err);
    }
});

// ==========================================
// 3. MIDDLEWARE: GERBANG REGISTER
// ==========================================
// Command yang bisa dipakai tanpa harus punya akun/karakter
const freeCommands = ['ping', 'register', 'help'];

async function checkRegister(userId, commandName) {
    if (freeCommands.includes(commandName)) return true;

    const [userCheck] = await pool.query('SELECT user_id FROM users WHERE user_id = ?', [userId]);
    if (!userCheck || userCheck.length === 0) return false; 
    
    return true;
}

// ==========================================
// 4. MIDDLEWARE: COOLDOWN CHECKER
// ==========================================
function checkCooldown(command, userId) {
    const { cooldowns } = client;

    if (!cooldowns.has(command.name)) {
        cooldowns.set(command.name, new Collection());
    }

    const now = Date.now();
    const timestamps = cooldowns.get(command.name);
    const defaultCooldownDuration = 3; // Default cooldown 3 detik
    const cooldownAmount = (command.cooldown ?? defaultCooldownDuration) * 1000;

    if (timestamps.has(userId)) {
        const expirationTime = timestamps.get(userId) + cooldownAmount;

        if (now < expirationTime) {
            const expiredTimestamp = Math.round(expirationTime / 1000);
            return `⏳ Sabar! Tunggu <t:${expiredTimestamp}:R> sebelum menggunakan command ini lagi.`;
        }
    }

    timestamps.set(userId, now);
    setTimeout(() => timestamps.delete(userId), cooldownAmount);
    return null;
}

// ==========================================
// 5. HANDLER: SLASH COMMANDS
// ==========================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command || !command.slash) return;

    // Cek Register
    const isRegistered = await checkRegister(interaction.user.id, command.name);
    if (!isRegistered) {
        return interaction.reply({ content: '❌ **Kamu belum memiliki karakter!** \nSilakan ketik `/register` terlebih dahulu.', ephemeral: true });
    }

    // Cek Cooldown
    const cooldownMsg = checkCooldown(command, interaction.user.id);
    if (cooldownMsg) return interaction.reply({ content: cooldownMsg, ephemeral: true });

    try {
        await command.executeSlash(interaction);
    } catch (error) {
        console.error(error);
        const errorMsg = '❌ Terjadi kesalahan saat mengeksekusi command.';
        if (interaction.replied || interaction.deferred) await interaction.followUp({ content: errorMsg, ephemeral: true });
        else await interaction.reply({ content: errorMsg, ephemeral: true });
    }
});

// ==========================================
// 6. HANDLER: PREFIX COMMANDS & ALIASES
// ==========================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // 🌟 Daftar prefix yang diizinkan
    const prefixes = ['!', 'L', 'l']; 
    
    // Cek apakah pesan diawali dengan salah satu prefix
    const usedPrefix = prefixes.find(p => message.content.startsWith(p));
    if (!usedPrefix) return;

    // Potong pesan berdasarkan prefix yang digunakan
    const args = message.content.slice(usedPrefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    // Deteksi command asli atau aliasnya
    const command = client.commands.get(commandName) || client.commands.find(cmd => cmd.aliases && cmd.aliases.includes(commandName));
    if (!command || !command.prefix) return;

    // Cek Register
    const isRegistered = await checkRegister(message.author.id, command.name);
    if (!isRegistered) {
        return message.reply('❌ **Kamu belum memiliki karakter!** \nSilakan ketik `!register` terlebih dahulu.');
    }

    // Cek Cooldown
    const cooldownMsg = checkCooldown(command, message.author.id);
    if (cooldownMsg) return message.reply(cooldownMsg);

    try {
        await command.executePrefix(message, args);
    } catch (error) {
        console.error(error);
        message.reply('❌ Terjadi kesalahan sistem.');
    }
});

client.login(process.env.DISCORD_TOKEN);