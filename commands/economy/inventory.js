const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');

module.exports = {
    name: 'inventory',
    aliases: ['inv', 'bag', 'tas'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('Melihat isi tas / inventory karaktermu'),

    async executeSlash(interaction) {
        await handleInventory(interaction, interaction.user, true);
    },

    async executePrefix(message, args) {
        await handleInventory(message, message.author, false);
    }
};

async function handleInventory(context, user, isSlash) {
    try {
        // Mengambil data barang yang jumlahnya lebih dari 0 dari database
        const items = await db.query('SELECT item_id, amount FROM inventory WHERE user_id = ? AND amount > 0', [user.id]);

        const embed = new EmbedBuilder()
            .setColor('#9B59B6') // Warna ungu gelap/cokelat tas
            .setTitle(`🎒 Tas Ransel: ${user.username}`)
            .setThumbnail(user.displayAvatarURL());

        // Jika tas kosong
        if (!items || items.length === 0) {
            embed.setDescription('*Tas kamu masih kosong. Dapatkan barang dari toko atau hadiah aktivitas!*');
            
            return isSlash 
                ? context.reply({ embeds: [embed] }) 
                : context.channel.send({ embeds: [embed] });
        }

        // Menyusun daftar item
        let itemList = '';
        items.forEach(item => {
            // Memformat ID item menjadi nama yang lebih rapi (misal: "iron_sword" menjadi "Iron Sword")
            const formattedName = item.item_id
                .split('_')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

            itemList += `🔹 **${formattedName}** — x${item.amount}\n`;
        });

        embed.setDescription(itemList);
        embed.setFooter({ text: 'Ketik !farm storage untuk melihat hasil panen.' });

        // Mengirim balasan (tanpa ping untuk prefix)
        return isSlash 
            ? context.reply({ embeds: [embed] }) 
            : context.channel.send({ embeds: [embed] });

    } catch (error) {
        console.error('[INVENTORY ERROR]', error);
        const errMsg = `❌ **${user.username}**, terjadi kesalahan sistem saat mencoba membuka tas.`;
        
        return isSlash 
            ? context.reply({ content: errMsg, ephemeral: true }) 
            : context.channel.send(errMsg);
    }
}