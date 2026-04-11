const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'help',
    aliases: ['h', 'bantuan', 'cmd'], // Pemain bisa ketik !h atau !bantuan
    prefix: true,
    slash: true,
    cooldown: 5, // Cooldown agak lama agar tidak di-spam
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Menampilkan daftar semua command yang tersedia di kota.'),

    async executeSlash(interaction) {
        // Mengambil semua data command yang ada di memory bot
        const commands = interaction.client.commands;
        const embed = generateHelpEmbed(commands, interaction.user);
        
        await interaction.reply({ embeds: [embed] });
    },

    async executePrefix(message, args) {
        const commands = message.client.commands;
        const embed = generateHelpEmbed(commands, message.author);
        
        await message.reply({ embeds: [embed] });
    }
};

// ==========================================
// FUNGSI PEMBUAT TAMPILAN EMBED (UI)
// ==========================================
function generateHelpEmbed(commandsCollection, user) {
    const embed = new EmbedBuilder()
        .setColor('#2b2d31') // Warna abu-abu gelap khas Discord
        .setTitle('📚 Pusat Bantuan The Real Life Sim')
        .setDescription('Selamat datang di panduan kota! Berikut adalah daftar command yang bisa kamu gunakan. Kamu bisa menggunakan awalan `!`, `L`, atau `/` (Slash Command).')
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setFooter({ text: `Diminta oleh ${user.username}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    // 🌟 KATEGORI 1: EKONOMI & BANK
    const economyCommands = ['bank', 'work', 'balance']; // Tambahkan nama command barumu di sini nanti
    let economyText = '';
    
    // 🌟 KATEGORI 2: UTILITAS & AKUN
    const utilityCommands = ['help', 'ping', 'register']; 
    let utilityText = '';

    // Loop melalui semua command yang terdaftar di bot
    commandsCollection.forEach(cmd => {
        // Jika command tersebut ada di daftar kategori Ekonomi
        if (economyCommands.includes(cmd.name)) {
            // Ambil deskripsi dari SlashCommandBuilder, jika tidak ada pakai teks default
            const desc = cmd.data ? cmd.data.description : 'Tidak ada deskripsi.';
            economyText += `🔹 **\`/${cmd.name}\`** - ${desc}\n`;
        }
        // Jika command tersebut ada di daftar kategori Utilitas
        else if (utilityCommands.includes(cmd.name)) {
            const desc = cmd.data ? cmd.data.description : 'Tidak ada deskripsi.';
            utilityText += `🔹 **\`/${cmd.name}\`** - ${desc}\n`;
        }
    });

    // Masukkan kategori ke dalam Embed jika teksnya tidak kosong
    if (economyText) {
        embed.addFields({ name: '💰 Keuangan & Pekerjaan', value: economyText });
    }
    
    if (utilityText) {
        embed.addFields({ name: '🛠️ Utilitas & Akun', value: utilityText });
    }

    // Tambahan Tips
    embed.addFields({ 
        name: '💡 Tips', 
        value: 'Beberapa command memiliki "Alias" (nama panggilan). Misalnya untuk bank, kamu bisa ketik `!atm` atau `!bal` alih-alih `!bank`.' 
    });

    return embed;
}