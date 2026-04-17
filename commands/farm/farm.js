const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const FarmManager = require('../../managers/FarmManager'); 
const cropsConfig = require('../../config/crops.json'); 

module.exports = {
    name: 'farm',
    aliases: ['ladang', 'kebun'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('farm')
        .setDescription('Manajemen ladang pertanian')
        .addSubcommand(sub => sub.setName('view').setDescription('Lihat kondisi ladangmu'))
        .addSubcommand(sub => sub.setName('storage').setDescription('Lihat isi gudang penyimpanan hasil panen'))
        .addSubcommand(sub => 
            sub.setName('plant')
            .setDescription('Tanam benih di satu petak ladang')
            .addIntegerOption(opt => opt.setName('x').setDescription('Koordinat X').setRequired(true).setMinValue(1))
            .addIntegerOption(opt => opt.setName('y').setDescription('Koordinat Y').setRequired(true).setMinValue(1))
            .addStringOption(opt => opt.setName('crop').setDescription('Jenis tanaman').setRequired(true))
        )
        .addSubcommand(sub => 
            sub.setName('plantall')
            .setDescription('Tanam benih sekaligus di semua petak kosong!')
            .addStringOption(opt => opt.setName('crop').setDescription('Jenis tanaman (contoh: wheat)').setRequired(true))
        )
        .addSubcommand(sub => 
            sub.setName('harvest')
            .setDescription('Panen tanaman di satu petak')
            .addIntegerOption(opt => opt.setName('x').setDescription('Koordinat X').setRequired(true).setMinValue(1))
            .addIntegerOption(opt => opt.setName('y').setDescription('Koordinat Y').setRequired(true).setMinValue(1))
        )
        .addSubcommand(sub => 
            sub.setName('harvestall')
            .setDescription('Panen SEMUA tanaman yang sudah siap sekaligus!')
        ),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand(false) || 'view'; 
        
        let x = null, y = null, crop = null;

        if (sub === 'plant' || sub === 'harvest') {
            x = interaction.options.getInteger('x') - 1; 
            y = interaction.options.getInteger('y') - 1;
        }
        if (sub === 'plant' || sub === 'plantall') {
            crop = interaction.options.getString('crop');
        }
        
        await handleFarmCommand(interaction, interaction.user, sub, { x, y, crop }, true);
    },

    async executePrefix(message, args) {
        const user = message.author;
        const sub = args[0] ? args[0].toLowerCase() : 'view';

        if (!['view', 'plant', 'plantall', 'harvest', 'harvestall', 'storage'].includes(sub)) {
            return message.channel.send(`❌ **${user.username}**, Format: \n\`!farm\` | \`!farm storage\` | \`!farm plant <x> <y> <crop>\` | \`!farm plantall <crop>\` | \`!farm harvest <x> <y>\` | \`!farm harvestall\``);
        }

        let x = null, y = null, crop = null;

        if (sub === 'plant' || sub === 'harvest') {
            x = (args[1] !== undefined && args[1] !== '') ? parseInt(args[1]) - 1 : null;
            y = (args[2] !== undefined && args[2] !== '') ? parseInt(args[2]) - 1 : null;
            crop = args[3]?.toLowerCase();
        } else if (sub === 'plantall') {
            crop = args[1]?.toLowerCase();
        }

        await handleFarmCommand(message, user, sub, { x, y, crop }, false);
    }
};

async function handleFarmCommand(context, user, sub, data, isSlash) {
    const userId = user.id;

    try {
        await db.query('INSERT IGNORE INTO user_farms (user_id) VALUES (?)', [userId]);

        if (sub === 'view') {
            const farmData = await db.query('SELECT * FROM user_farms WHERE user_id = ?', [userId]);
            if (!farmData || farmData.length === 0) throw new Error("Data ladang gagal dimuat.");
            
            const farm = farmData[0];
            const tiles = await db.query('SELECT * FROM farm_tiles WHERE user_id = ?', [userId]);
            
            let gridVisual = '';
            for (let y = 0; y < farm.height; y++) {
                for (let x = 0; x < farm.width; x++) {
                    const tile = tiles.find(t => t.x === x && t.y === y);
                    if (!tile || !tile.crop_id) {
                        gridVisual += (tile && tile.is_watered) ? '🟦 ' : '🟫 '; 
                    } else if (tile.growth < 100) {
                        gridVisual += '🌱 '; 
                    } else {
                        gridVisual += '🌾 '; 
                    }
                }
                gridVisual += '\n';
            }

            const storageData = await db.query('SELECT SUM(amount) as total FROM user_storage WHERE user_id = ?', [userId]);

            const embed = new EmbedBuilder()
                .setColor('#4CAF50')
                .setTitle(`🚜 Ladang Milik ${user.username}`)
                .setDescription(`**Grid Map (${farm.width}x${farm.height})**\n\n${gridVisual}`)
                .addFields(
                    { name: '📦 Storage', value: `${storageData[0].total || 0} / ${farm.max_storage} items`, inline: true },
                    { name: '💡 Keterangan', value: '🟫 Kosong | 🟦 Basah | 🌱 Tumbuh | 🌾 Panen', inline: false }
                );

            return isSlash ? context.reply({ embeds: [embed] }) : context.channel.send({ embeds: [embed] });
        }

        if (sub === 'storage') {
            const farmData = await db.query('SELECT max_storage FROM user_farms WHERE user_id = ?', [userId]);
            const maxStorage = farmData[0].max_storage;
            const items = await db.query('SELECT item_id, amount FROM user_storage WHERE user_id = ? AND amount > 0', [userId]);
            
            const embed = new EmbedBuilder().setColor('#8B4513').setTitle(`📦 Gudang Penyimpanan: ${user.username}`).setThumbnail(user.displayAvatarURL());

            if (!items || items.length === 0) {
                embed.setDescription(`*Gudangmu masih kosong.*`).addFields({ name: '📊 Kapasitas', value: `0 / ${maxStorage} Terisi` });
                return isSlash ? context.reply({ embeds: [embed] }) : context.channel.send({ embeds: [embed] });
            }

            let totalItems = 0;
            let itemList = '';
            items.forEach(item => {
                totalItems += item.amount;
                const itemName = cropsConfig[item.item_id]?.name || item.item_id;
                itemList += `🔹 **${itemName}** x${item.amount}\n`;
            });

            embed.setDescription(itemList);
            let capacityText = `${totalItems} / ${maxStorage} Terisi`;
            if (totalItems >= maxStorage * 0.8) capacityText += ` ⚠️ *(Hampir Penuh!)*`;
            if (totalItems >= maxStorage) capacityText += ` 🚨 *(Penuh!)*`;

            embed.addFields({ name: '📊 Kapasitas', value: capacityText });
            return isSlash ? context.reply({ embeds: [embed] }) : context.channel.send({ embeds: [embed] });
        }

        if (sub === 'plant') {
            if (data.x === null || data.y === null || isNaN(data.x) || isNaN(data.y) || !data.crop) throw new Error("Koordinat X, Y, dan jenis tanaman harus diisi.");
            await FarmManager.plantCrop(userId, data.x, data.y, data.crop);
            const msg = `🌱 **${user.username}** berhasil menanam **${cropsConfig[data.crop].name}** di [${data.x + 1}, ${data.y + 1}]!`;
            return isSlash ? context.reply(msg) : context.channel.send(msg);
        }

        // =====================================
        // 🌟 EKSEKUSI PLANT ALL
        // =====================================
        if (sub === 'plantall') {
            if (!data.crop) throw new Error("Jenis tanaman harus diisi. Format: `!farm plantall <crop>`");
            const count = await FarmManager.plantAll(userId, data.crop);
            const msg = `🌱 **${user.username}** berhasil menanam **${count} petak** **${cropsConfig[data.crop].name}** sekaligus di lahan yang kosong!`;
            return isSlash ? context.reply(msg) : context.channel.send(msg);
        }

        if (sub === 'harvest') {
            if (data.x === null || data.y === null || isNaN(data.x) || isNaN(data.y)) throw new Error("Koordinat X dan Y harus diisi.");
            const yieldAmount = await FarmManager.harvestCrop(userId, data.x, data.y);
            const msg = `🌾 **${user.username}** memanen tanaman di [${data.x + 1}, ${data.y + 1}] dan mendapat **${yieldAmount} item**!`;
            return isSlash ? context.reply(msg) : context.channel.send(msg);
        }

        // =====================================
        // 🌟 EKSEKUSI HARVEST ALL
        // =====================================
        if (sub === 'harvestall') {
            const result = await FarmManager.harvestAll(userId);
            
            let summaryText = '';
            for (const [cropId, amount] of Object.entries(result.summary)) {
                const name = cropsConfig[cropId]?.name || cropId;
                summaryText += `🔹 **${amount}x ${name}**\n`;
            }

            let msg = `🚜 **${user.username}** memanen **${result.count} petak** sekaligus dan mendapatkan:\n${summaryText}`;
            
            if (result.isStorageFull) {
                msg += `\n⚠️ *Proses panen dihentikan di tengah jalan karena Storage penuh!*`;
            }

            return isSlash ? context.reply(msg) : context.channel.send(msg);
        }

    } catch (error) {
        const errMsg = `❌ **${user.username}**, ${error.message}`;
        if (isSlash) await context.reply({ content: errMsg, ephemeral: true });
        else await context.channel.send(errMsg);
    }
}