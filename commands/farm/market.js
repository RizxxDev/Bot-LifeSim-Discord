const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const MarketManager = require('../../managers/MarketManager'); 

module.exports = {
    name: 'market',
    aliases: ['pasar', 'trade'],
    prefix: true,
    slash: true,
    data: new SlashCommandBuilder()
        .setName('market')
        .setDescription('Pasar Bebas Antar Pemain')
        .addSubcommand(sub => sub.setName('list').setDescription('Lihat barang yang dijual'))
        .addSubcommand(sub => 
            sub.setName('sell')
            .setDescription('Jual item dari storage ke market')
            .addStringOption(opt => opt.setName('item').setDescription('ID Item (contoh: wheat)').setRequired(true))
            .addIntegerOption(opt => opt.setName('amount').setDescription('Jumlah').setRequired(true))
            .addIntegerOption(opt => opt.setName('price').setDescription('Harga Total').setRequired(true))
        )
        .addSubcommand(sub => 
            sub.setName('buy')
            .setDescription('Beli item dari market')
            .addIntegerOption(opt => opt.setName('id').setDescription('ID Lapak').setRequired(true))
        ),

    async executeSlash(interaction) {
        // 🌟 Default ke 'list'
        const sub = interaction.options.getSubcommand(false) || 'list';
        
        let item = null, amount = null, price = null, listingId = null;

        if(sub === 'sell') {
            item = interaction.options.getString('item');
            amount = interaction.options.getInteger('amount');
            price = interaction.options.getInteger('price');
        } else if (sub === 'buy') {
            listingId = interaction.options.getInteger('id');
        }

        const data = { item, amount, price, listingId };
        await handleMarket(interaction, interaction.user, sub, data, true);
    },

    async executePrefix(message, args) {
        const user = message.author;
        
        // 🌟 Default ke 'list'
        const sub = args[0] ? args[0].toLowerCase() : 'list';

        if (!['list', 'sell', 'buy'].includes(sub)) {
            return message.channel.send(`❌ **${user.username}**, Format: \`!market\`, \`!market sell <item> <jumlah> <harga>\`, \`!market buy <id>\``);
        }

        const data = {
            item: args[1]?.toLowerCase(),
            amount: parseInt(args[2]),
            price: parseInt(args[3]),
            listingId: parseInt(args[1])
        };
        await handleMarket(message, user, sub, data, false);
    }
};

async function handleMarket(context, user, sub, data, isSlash) {
    try {
        if (sub === 'list') {
            const listings = await db.query('SELECT * FROM market_listings ORDER BY created_at DESC LIMIT 10');
            const embed = new EmbedBuilder().setColor('#FF9800').setTitle('🏪 Global Player Market');
            
            let desc = '';
            listings.forEach(l => {
                desc += `**ID: ${l.id}** | 📦 ${l.amount}x **${l.item_id}**\n`;
                desc += `└ Harga: Lp ${l.price} | Penjual: <@${l.seller_id}>\n\n`;
            });
            
            embed.setDescription(desc || 'Pasar sedang sepi. Belum ada lapak.');
            return isSlash ? context.reply({ embeds: [embed] }) : context.channel.send({ embeds: [embed] });
        }

        if (sub === 'sell') {
            if (!data.item || isNaN(data.amount) || isNaN(data.price)) throw new Error("Format salah!");
            await MarketManager.listToMarket(user.id, data.item, data.amount, data.price);
            const msg = `🏪 **${user.username}** memasang lapak: **${data.amount}x ${data.item}** seharga **Lp ${data.price}**! (Fee: Lp 50)`;
            return isSlash ? context.reply(msg) : context.channel.send(msg);
        }

        if (sub === 'buy') {
            if (isNaN(data.listingId)) throw new Error("Masukkan ID Lapak yang valid!");
            await MarketManager.buyFromMarket(user.id, data.listingId);
            const msg = `🛍️ **${user.username}** berhasil membeli barang dari market! Item masuk ke Storage.`;
            return isSlash ? context.reply(msg) : context.channel.send(msg);
        }

    } catch (error) {
        const errMsg = `❌ **${user.username}**, ${error.message}`;
        if (isSlash) await context.reply({ content: errMsg, ephemeral: true });
        else await context.channel.send(errMsg);
    }
}