require('dotenv').config();
const { REST, Routes } = require('discord.js');

async function clearGuildCommands() {
    if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
        console.error('❌ DISCORD_TOKEN atau CLIENT_ID belum diset di .env');
        process.exit(1);
    }

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('🔍 Mengambil daftar server (guilds) yang diikuti bot...');
        const guilds = await rest.get(Routes.userGuilds());

        if (!guilds || guilds.length === 0) {
            console.log('⚠️ Bot belum join ke server mana pun.');
            return;
        }

        for (const guild of guilds) {
            console.log(`🧹 Membersihkan guild-specific commands di: ${guild.name} (${guild.id})...`);
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id),
                { body: [] }
            );
            console.log(`✅ Guild commands di server "${guild.name}" berhasil dihapus.`);
        }

        console.log('\n✨ Selesai! Duplikat guild commands sudah bersih. Discord akan menampilkan Global Commands versi terbaru saja.');
    } catch (error) {
        console.error('❌ Terjadi kesalahan saat menghapus guild commands:', error);
    }
}

clearGuildCommands();
