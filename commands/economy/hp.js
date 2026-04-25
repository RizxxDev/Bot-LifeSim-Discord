const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');

module.exports = {
    name: 'phone',
    aliases: ['hp', 'smartphone', 'gadget'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('phone')
        .setDescription('Buka smartphonemu untuk mengakses berbagai aplikasi!'),

    async executeSlash(interaction) {
        await handlePhone(interaction, interaction.user, true);
    },

    async executePrefix(message, args) {
        await handlePhone(message, message.author, false);
    }
};

async function handlePhone(context, user, isSlash) {
    const userId = user.id;

    try {
        // 1. Cek apakah pemain punya Smartphone di Inventory
        const inventory = await db.query('SELECT amount FROM inventory WHERE user_id = ? AND item_id = "smartphone"', [userId]);
        
        if (!inventory || inventory.length === 0 || inventory[0].amount < 1) {
            const msg = `❌ **${user.username}**, kamu belum memiliki Handphone! Beli \`smartphone\` di \`!shop\` atau \`!market\` terlebih dahulu.`;
            return isSlash ? context.reply({ content: msg, ephemeral: true }) : context.channel.send(msg);
        }

        // 2. Setup Menu UI (Layar Utama HP)
        const homeEmbed = new EmbedBuilder()
            .setColor('#2C3E50') // Warna tema HP (Dark Mode)
            .setTitle(`📱 Smartphone - ${user.username}`)
            .setDescription(`**Waktu Sistem:** <t:${Math.floor(Date.now() / 1000)}:f>\n\nSelamat datang di OS Simulator. Silakan pilih aplikasi dari menu di bawah ini.`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                { name: '📶 Sinyal', value: 'LTE ▮▮▮▯', inline: true },
                { name: '🔋 Baterai', value: '85%', inline: true }
            )
            .setFooter({ text: 'Sistem akan otomatis mati dalam 60 detik.' });

        // 3. Buat Dropdown Menu (Aplikasi)
        const appMenu = new StringSelectMenuBuilder()
            .setCustomId('phone_apps')
            .setPlaceholder('Pilih Aplikasi...')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Layar Utama').setDescription('Kembali ke menu awal').setValue('app_home').setEmoji('📱'),
                new StringSelectMenuOptionBuilder().setLabel('M-Banking').setDescription('Cek saldo Bank dan Uang Tunai').setValue('app_bank').setEmoji('🏦'),
                new StringSelectMenuOptionBuilder().setLabel('My Profile').setDescription('Cek Level, Pekerjaan, dan Status').setValue('app_profile').setEmoji('👤'),
                new StringSelectMenuOptionBuilder().setLabel('Matikan HP').setDescription('Tutup aplikasi smartphone').setValue('app_close').setEmoji('❌')
            );

        const row = new ActionRowBuilder().addComponents(appMenu);

        // Kirim pesan interaktif
        let responseMsg;
        if (isSlash) {
            responseMsg = await context.reply({ embeds: [homeEmbed], components: [row], fetchReply: true });
        } else {
            responseMsg = await context.channel.send({ embeds: [homeEmbed], components: [row] });
        }

        // 4. Setup Collector untuk menangkap pilihan menu
        const collector = responseMsg.createMessageComponentCollector({ 
            componentType: ComponentType.StringSelect, 
            time: 60000, // Aktif selama 1 menit
            filter: i => i.user.id === userId 
        });

        collector.on('collect', async (interaction) => {
            const selectedApp = interaction.values[0];

            try {
                if (selectedApp === 'app_home') {
                    await interaction.update({ embeds: [homeEmbed], components: [row] });
                } 
                else if (selectedApp === 'app_bank') {
                    const userData = await db.query('SELECT cash, bank FROM users WHERE user_id = ?', [userId]);
                    const u = userData[0];

                    const bankEmbed = new EmbedBuilder()
                        .setColor('#4CAF50')
                        .setTitle('🏦 Mobile Banking App')
                        .setDescription(`Selamat datang, Nasabah **${user.username}**.\n\n💵 **Uang Tunai (Cash):** \`Lp ${u.cash.toLocaleString()}\`\n💳 **Saldo Rekening (Bank):** \`Lp ${u.bank.toLocaleString()}\`\n\n*Gunakan \`!bank deposit/withdraw\` untuk bertransaksi.*`)
                        .setFooter({ text: '📱 Sedang membuka M-Banking' });
                    
                    await interaction.update({ embeds: [bankEmbed], components: [row] });
                }
                else if (selectedApp === 'app_profile') {
                    const userData = await db.query(`
                        SELECT u.*, j.name as job_name 
                        FROM users u 
                        LEFT JOIN jobs j ON u.job_id = j.id 
                        WHERE u.user_id = ?
                    `, [userId]);
                    const u = userData[0];
                    const jobDisplay = u.job_name ? u.job_name : 'Pengangguran';

                    const profileEmbed = new EmbedBuilder()
                        .setColor('#3498DB')
                        .setTitle('👤 My Profile App')
                        .addFields(
                            { name: '💼 Pekerjaan', value: jobDisplay, inline: true },
                            { name: '⭐ Level', value: `Lv. ${u.level}`, inline: true },
                            { name: '🎯 Skill Points', value: `${u.skill_points} SP`, inline: true },
                            { name: '⚡ Energi', value: `${u.energy}%`, inline: true },
                            { name: '🍔 Rasa Lapar', value: `${u.hunger}%`, inline: true }
                        )
                        .setFooter({ text: '📱 Sedang membuka Profile' });
                    
                    await interaction.update({ embeds: [profileEmbed], components: [row] });
                }
                else if (selectedApp === 'app_close') {
                    // Matikan HP
                    collector.stop('user_closed');
                }
            } catch (err) {
                console.error('[PHONE APP ERROR]', err);
                await interaction.reply({ content: 'Terjadi kesalahan saat memuat aplikasi.', ephemeral: true });
            }
        });

        // 5. Jika waktu habis atau user menekan 'Matikan HP'
        collector.on('end', async (collected, reason) => {
            const offEmbed = new EmbedBuilder()
                .setColor('#000000')
                .setDescription('📵 *Layar Smartphone dimatikan.*');

            // Hapus menu dropdown agar tidak bisa diklik lagi
            if (isSlash) await context.editReply({ embeds: [offEmbed], components: [] }).catch(()=>{});
            else await responseMsg.edit({ embeds: [offEmbed], components: [] }).catch(()=>{});
        });

    } catch (error) {
        console.error('[PHONE ERROR]', error);
        const errMsg = `❌ **${user.username}**, terjadi kesalahan saat mencoba menyalakan handphone.`;
        if (isSlash) await context.reply({ content: errMsg, ephemeral: true });
        else await context.channel.send(errMsg);
    }
}