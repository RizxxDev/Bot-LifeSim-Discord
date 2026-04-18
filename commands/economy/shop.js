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
        .setDescription('Sistem Ekonomi Cerdas (Shop)')
        .addSubcommand(sub => sub.setName('view').setDescription('Lihat harga pasar saat ini'))
        .addSubcommand(sub => 
            sub.setName('buy')
            .setDescription('Beli item dari Shop')
            .addStringOption(opt => opt.setName('item').setDescription('ID Item (contoh: wheat)').setRequired(true))
            .addIntegerOption(opt => opt.setName('amount').setDescription('Jumlah').setRequired(true).setMinValue(1).setMaxValue(100))
        )
        .addSubcommand(sub => 
            sub.setName('sell')
            .setDescription('Jual item ke Shop')
            .addStringOption(opt => opt.setName('item').setDescription('ID Item (contoh: wheat)').setRequired(true))
            .addIntegerOption(opt => opt.setName('amount').setDescription('Jumlah').setRequired(true).setMinValue(1).setMaxValue(500))
        ),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand(false) || 'view';
        let item = null, amount = null;

        if (sub === 'buy' || sub === 'sell') {
            item = interaction.options.getString('item');
            amount = interaction.options.getInteger('amount');
        }
        await handleShop(interaction, interaction.user, sub, { item, amount }, true);
    },

    async executePrefix(message, args) {
        const user = message.author;
        const sub = args[0] ? args[0].toLowerCase() : 'view';

        if (!['view', 'buy', 'sell'].includes(sub)) {
            return message.channel.send(`❌ **${user.username}**, Format: \`!shop\`, \`!shop buy <item> <jml>\`, \`!shop sell <item> <jml>\``);
        }
        
        const item = args[1]?.toLowerCase();
        const amount = parseInt(args[2]);
        await handleShop(message, user, sub, { item, amount }, false);
    }
};

async function handleShop(context, user, sub, data, isSlash) {
    try {
        if (sub === 'view') {
            // Tarik data kas, storage, dan inventory Shop
            const shopData = await db.query('SELECT cash, max_storage FROM global_shop WHERE id = 1');
            const inventory = await db.query('SELECT item_id, amount FROM shop_inventory');
            
            const shopCash = shopData[0]?.cash || 0;
            const maxStorage = shopData[0]?.max_storage || 10000;
            
            // Hitung total item yang ada di gudang shop saat ini
            let currentTotalStorage = 0;
            inventory.forEach(i => currentTotalStorage += i.amount);

            const embed = new EmbedBuilder()
                .setColor('#2ECC71')
                .setTitle('🏪 Pusat Perdagangan Global (Market)')
                .setDescription(`Sistem ekonomi dinamis! Harga naik saat langka, dan turun saat melimpah.\n\n🏦 **Kas Negara:** \`Lp ${shopCash.toLocaleString()}\`\n📦 **Kapasitas Gudang:** \`${currentTotalStorage.toLocaleString()} / ${maxStorage.toLocaleString()}\`\n━━━━━━━━━━━━━━━━━━━━━━`);

            let rawItems = '';
            let productItems = '';

            // Looping menyusun UI per item
            for (const [id, config] of Object.entries(shopConfig.items)) {
                const stockRow = inventory.find(i => i.item_id === id);
                const currentStock = stockRow ? stockRow.amount : 0;
                
                const currentPrice = ShopManager.calculatePrice(id, currentStock);
                const sellPrice = Math.max(config.min_price, Math.floor(currentPrice * 0.85)); // Harga jual player ke shop
                
                // Menentukan Indikator Trend Harga
                let trendEmoji = '⚖️ Stabil';
                if (currentStock < config.target_stock * 0.5) trendEmoji = '📈 Naik (Langka!)';
                else if (currentStock > config.target_stock * 1.2) trendEmoji = '📉 Turun (Melimpah)';

                const itemUI = `**${config.name}** (ID: \`${id}\`) — Stok: **${currentStock}/${config.target_stock}**\n> 🛒 Beli: **Lp ${currentPrice}**\n> 💵 Jual: **Lp ${sellPrice}**\n> 📊 Trend: ${trendEmoji}\n\n`;

                // Pemisahan Kategori berdasarkan JSON
                if (config.type === 'raw') {
                    rawItems += itemUI;
                } else if (config.type === 'product') {
                    productItems += itemUI;
                } else {
                    rawItems += itemUI; // Fallback jika tidak ada type
                }
            }

            if (rawItems) embed.addFields({ name: '🌾 Bahan Mentah (Raw)', value: rawItems });
            if (productItems) embed.addFields({ name: '🍞 Produk Olahan (Processed)', value: productItems });

            embed.setFooter({ text: '💡 Tips: Ketik !shop sell <item> <jumlah> untuk menjual barangmu.' });

            return isSlash ? context.reply({ embeds: [embed] }) : context.channel.send({ embeds: [embed] });
        }

        if (sub === 'buy') {
            if (!data.item || isNaN(data.amount)) throw new Error("Format salah! Ketik `!shop buy <item> <jumlah>`");
            const result = await ShopManager.buyFromShop(user.id, data.item, data.amount);
            const msg = `🛒 **${user.username}** membeli **${data.amount}x ${shopConfig.items[data.item].name}** seharga **Lp ${result.totalPrice.toLocaleString()}** (@Lp ${result.unitPrice}/ea).`;
            return isSlash ? context.reply(msg) : context.channel.send(msg);
        }

        if (sub === 'sell') {
            if (!data.item || isNaN(data.amount)) throw new Error("Format salah! Ketik `!shop sell <item> <jumlah>`");
            const result = await ShopManager.sellToShop(user.id, data.item, data.amount);
            const msg = `💵 **${user.username}** menjual **${data.amount}x ${shopConfig.items[data.item].name}** ke Market dan mendapat **Lp ${result.totalPrice.toLocaleString()}** (@Lp ${result.unitPrice}/ea).`;
            return isSlash ? context.reply(msg) : context.channel.send(msg);
        }

    } catch (error) {
        const errMsg = `❌ **${user.username}**, ${error.message}`;
        if (isSlash) await context.reply({ content: errMsg, ephemeral: true });
        else await context.channel.send(errMsg);
    }
}