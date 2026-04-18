const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');

// Helper untuk fungsi delay (menunggu waktu)
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
    name: 'fish',
    aliases: ['mancing', 'fishing'],
    prefix: true,
    slash: true,
    cooldown: 15, // Cooldown 15 detik agar tidak spam
    data: new SlashCommandBuilder()
        .setName('fish')
        .setDescription('Pergi memancing dengan sistem reaksi cepat (Quick Time Event)!'),

    async executeSlash(interaction) {
        await handleInteractiveFish(interaction, interaction.user, true);
    },

    async executePrefix(message, args) {
        await handleInteractiveFish(message, message.author, false);
    }
};

async function handleInteractiveFish(context, user, isSlash) {
    const userId = user.id;

    try {
        // 1. Cek Alat Pancing di Inventory (Opsional: Jika tidak punya, pakai pancingan default)
        const inventory = await db.query('SELECT item_id FROM inventory WHERE user_id = ? AND item_id IN ("fishing_rod", "pro_rod") AND amount > 0', [userId]);
        
        let rodType = 'bamboo';
        let rodName = 'Pancingan Bambu (Default)';
        let reactionTime = 3000; // Waktu bereaksi standar: 3 detik
        
        if (inventory.some(i => i.item_id === 'pro_rod')) {
            rodType = 'pro_rod';
            rodName = 'Pro Fishing Rod';
            reactionTime = 4500; // Pancingan Pro memberi waktu lebih lama (4.5 detik)
        } else if (inventory.some(i => i.item_id === 'fishing_rod')) {
            rodType = 'fishing_rod';
            rodName = 'Normal Fishing Rod';
            reactionTime = 3500; // 3.5 detik
        }

        // 2. Setup Pesan Awal (Melempar Kail)
        const waitEmbed = new EmbedBuilder()
            .setColor('#3498DB')
            .setTitle('🎣 Sesi Memancing')
            .setDescription(`**Alat Pancing:** \`${rodName}\`\n\n〰️ Membuang umpan ke dalam air...\n👀 *Fokus! Tunggu sampai ikan menyambar umpannya!*`);

        let responseMsg;
        if (isSlash) {
            responseMsg = await context.reply({ embeds: [waitEmbed], fetchReply: true });
        } else {
            responseMsg = await context.channel.send({ embeds: [waitEmbed] });
        }

        // 3. Waktu Menunggu Ikan Menyambar (Acak 3 - 7 Detik)
        const waitTime = randomInt(3000, 7000);
        await wait(waitTime);

        // 4. Ikan Menyambar! Munculkan Tombol
        const actionEmbed = new EmbedBuilder()
            .setColor('#E74C3C') // Warna merah tanda bahaya/harus bereaksi
            .setTitle('⚠️ IKAN MENYAMBAR! ⚠️')
            .setDescription('**CEPAT TEKAN TOMBOL DI BAWAH UNTUK MENARIKNYA!**');

        const pullButton = new ButtonBuilder()
            .setCustomId('pull_fish')
            .setLabel('TARIK KAILNYA! 🎣')
            .setStyle(ButtonStyle.Success);

        const row = new ActionRowBuilder().addComponents(pullButton);

        // Edit pesan untuk memunculkan tombol
        if (isSlash) await context.editReply({ embeds: [actionEmbed], components: [row] });
        else await responseMsg.edit({ embeds: [actionEmbed], components: [row] });

        // 5. Setup Collector (Mendengarkan Klik Tombol dengan Batas Waktu)
        const collector = responseMsg.createMessageComponentCollector({ 
            componentType: ComponentType.Button, 
            time: reactionTime, // Batas waktu bereaksi (Contoh: 3 detik)
            filter: i => i.user.id === userId
        });

        collector.on('collect', async (interaction) => {
            await interaction.deferUpdate(); // Mencegah interaksi "Failed"
            
            if (interaction.customId === 'pull_fish') {
                collector.stop('success'); // Hentikan collector dengan status sukses
            }
        });

        // 6. Evaluasi Hasil (Saat batas waktu habis atau tombol diklik)
        collector.on('end', async (collected, reason) => {
            if (reason === 'success') {
                // ✅ PEMAIN BERHASIL MENEKAN TOMBOL TEPAT WAKTU
                const fish = getRandomFish(rodType);
                const amount = fish.id === 'trash' ? 1 : randomInt(1, 2);

                // Masukkan ke Database Inventory
                try {
                    await db.query(
                        'INSERT INTO inventory (user_id, item_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?',
                        [userId, fish.id, amount, amount]
                    );

                    const successEmbed = new EmbedBuilder()
                        .setColor('#2ECC71')
                        .setTitle('🎉 Berhasil Ditarik!')
                        .setDescription(`Tarikan yang bagus, <@${userId}>!`)
                        .addFields({ name: 'Hasil Tangkapan', value: `Mendapatkan **${amount}x ${fish.emoji} ${fish.name}**` })
                        .setFooter({ text: fish.desc });

                    if (isSlash) await context.editReply({ embeds: [successEmbed], components: [] });
                    else await responseMsg.edit({ embeds: [successEmbed], components: [] });

                } catch (err) {
                    console.error('[FISHING DB ERROR]', err);
                    const errorEmbed = new EmbedBuilder().setColor('#E74C3C').setDescription('❌ Gagal menyimpan ikan ke dalam inventory.');
                    if (isSlash) await context.editReply({ embeds: [errorEmbed], components: [] });
                    else await responseMsg.edit({ embeds: [errorEmbed], components: [] });
                }

            } else if (reason === 'time') {
                // ❌ PEMAIN TERLAMBAT MENEKAN TOMBOL
                const failEmbed = new EmbedBuilder()
                    .setColor('#7F8C8D')
                    .setTitle('💨 Yah... Ikannya Lepas')
                    .setDescription(`Kamu terlalu lambat menarik kailnya! Ikan sudah membawa lari umpanmu.\n\n*Tips: Tangan harus bersiap di layar/mouse saat sedang menunggu!*`);

                if (isSlash) await context.editReply({ embeds: [failEmbed], components: [] });
                else await responseMsg.edit({ embeds: [failEmbed], components: [] });
            }
        });

    } catch (error) {
        console.error('[FISH SYSTEM ERROR]', error);
        const errMsg = `❌ **${user.username}**, joranmu patah. Terjadi kesalahan sistem.`;
        if (isSlash) await context.reply({ content: errMsg, ephemeral: true });
        else await context.channel.send(errMsg);
    }
}

// ==========================================
// FUNGSI UTILITAS
// ==========================================
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomFish(rodType) {
    const rand = Math.random() * 100;

    // Peluang berbeda jika memakai alat pancing bagus
    let trashChance = 25, salmonChance = 70, tunaChance = 95;
    if (rodType === 'pro_rod') {
        trashChance = 10; salmonChance = 50; tunaChance = 85; // Peluang Hiu (Shark) naik jadi 15%
    } else if (rodType === 'fishing_rod') {
        trashChance = 15; salmonChance = 60; tunaChance = 90; // Peluang Hiu (Shark) naik jadi 10%
    }

    if (rand < trashChance) { 
        return { id: 'trash', name: 'Sampah', emoji: '👞', desc: 'Hadeh... malah dapat sepatu bolong.' };
    } else if (rand < salmonChance) { 
        return { id: 'salmon', name: 'Ikan Salmon', emoji: '🐟', desc: 'Lumayan untuk makan malam!' };
    } else if (rand < tunaChance) { 
        return { id: 'tuna', name: 'Ikan Tuna', emoji: '🐠', desc: 'Wah! Ikan yang cukup mahal!' };
    } else { 
        return { id: 'shark', name: 'Hiu Putih', emoji: '🦈', desc: '🔥 JACKPOT! Tarikan yang sangat kuat!' };
    }
}