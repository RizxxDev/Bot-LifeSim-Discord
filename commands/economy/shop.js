const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const ShopManager = require('../../managers/ShopManager');
const shopConfig = require('../../config/shop.json');

module.exports = {
    name: 'shop',
    aliases: ['toko', 'pasar', 'market'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Melihat harga pasar saat ini di Pusat Ekonomi Global'),

    async executeSlash(interaction) {
        await handleShopView(interaction, interaction.user, true);
    },

    async executePrefix(message, args) {
        await handleShopView(message, message.author, false);
    }
};

async function handleShopView(context, user, isSlash) {
    try {
        const shopData = await db.query('SELECT cash, max_storage FROM global_shop WHERE id = 1');
        const inventory = await db.query('SELECT item_id, amount FROM shop_inventory');
        
        const shopCash = shopData[0]?.cash || 0;
        const maxStorage = shopData[0]?.max_storage || 10000;
        
        let currentTotalStorage = 0;
        inventory.forEach(i => currentTotalStorage += i.amount);

        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('🏪 Pusat Perdagangan Global (Market)')
            .setDescription(`Sistem ekonomi dinamis! Harga naik saat langka, dan turun saat melimpah.\n\n🏦 **Kas Negara:** \`Lp ${shopCash.toLocaleString()}\`\n📦 **Kapasitas Gudang:** \`${currentTotalStorage.toLocaleString()} / ${maxStorage.toLocaleString()}\`\n━━━━━━━━━━━━━━━━━━━━━━`);

        let rawItems = '';
        let productItems = '';

        for (const [id, config] of Object.entries(shopConfig.items)) {
            const stockRow = inventory.find(i => i.item_id === id);
            const currentStock = stockRow ? stockRow.amount : 0;
            
            const currentPrice = ShopManager.calculatePrice(id, currentStock);
            const sellPrice = Math.max(config.min_price, Math.floor(currentPrice * 0.85)); 
            
            let trendEmoji = '⚖️ Stabil';
            if (currentStock < config.target_stock * 0.5) trendEmoji = '📈 Naik (Langka!)';
            else if (currentStock > config.target_stock * 1.2) trendEmoji = '📉 Turun (Melimpah)';

            const itemUI = `**${config.name}** (ID: \`${id}\`) — Stok: **${currentStock}/${config.target_stock}**\n> 🛒 Beli: **Lp ${currentPrice}**\n> 💵 Jual: **Lp ${sellPrice}**\n> 📊 Trend: ${trendEmoji}\n\n`;

            if (config.type === 'raw') rawItems += itemUI;
            else if (config.type === 'product') productItems += itemUI;
            else rawItems += itemUI; 
        }

        if (rawItems) embed.addFields({ name: '🌾 Bahan Mentah (Raw)', value: rawItems });
        if (productItems) embed.addFields({ name: '🍞 Produk Olahan (Processed)', value: productItems });

        // Footer sudah diubah untuk mengarahkan ke command baru
        embed.setFooter({ text: '💡 Tips: Gunakan command !buy <item> <jumlah> atau !sell <item> <jumlah>' });

        return isSlash ? context.reply({ embeds: [embed] }) : context.channel.send({ embeds: [embed] });

    } catch (error) {
        const errMsg = `❌ **${user.username}**, ${error.message}`;
        if (isSlash) await context.reply({ content: errMsg, ephemeral: true });
        else await context.channel.send(errMsg);
    }
}