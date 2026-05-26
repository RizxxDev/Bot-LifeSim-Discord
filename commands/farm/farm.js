const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const FarmManager = require('../../managers/FarmManager');
const cropsConfig = require('../../config/crops.json');
const { infoEmbed, successEmbed, formatNumber, progressBar, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'farm',
    aliases: ['ladang', 'kebun'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('farm')
        .setDescription('Manage your farm.')
        .addSubcommand(sub => sub.setName('view').setDescription('View your farm grid.'))
        .addSubcommand(sub => sub.setName('storage').setDescription('View harvested crop storage.'))
        .addSubcommand(sub => sub.setName('plant').setDescription('Plant one crop.')
            .addIntegerOption(opt => opt.setName('x').setDescription('X coordinate.').setRequired(true).setMinValue(1))
            .addIntegerOption(opt => opt.setName('y').setDescription('Y coordinate.').setRequired(true).setMinValue(1))
            .addStringOption(opt => opt.setName('crop').setDescription('Crop ID.').setRequired(true)))
        .addSubcommand(sub => sub.setName('plantall').setDescription('Plant all empty tiles.')
            .addStringOption(opt => opt.setName('crop').setDescription('Crop ID.').setRequired(true)))
        .addSubcommand(sub => sub.setName('harvest').setDescription('Harvest one tile.')
            .addIntegerOption(opt => opt.setName('x').setDescription('X coordinate.').setRequired(true).setMinValue(1))
            .addIntegerOption(opt => opt.setName('y').setDescription('Y coordinate.').setRequired(true).setMinValue(1)))
        .addSubcommand(sub => sub.setName('harvestall').setDescription('Harvest every ready crop.')),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand(false) || 'view';
        await handleFarm(interaction, interaction.user, sub, {
            x: ['plant', 'harvest'].includes(sub) ? interaction.options.getInteger('x') - 1 : null,
            y: ['plant', 'harvest'].includes(sub) ? interaction.options.getInteger('y') - 1 : null,
            crop: ['plant', 'plantall'].includes(sub) ? interaction.options.getString('crop') : null
        });
    },

    async executePrefix(message, args) {
        const sub = args[0]?.toLowerCase() || 'view';
        await handleFarm(message, message.author, sub, {
            x: ['plant', 'harvest'].includes(sub) ? Number.parseInt(args[1], 10) - 1 : null,
            y: ['plant', 'harvest'].includes(sub) ? Number.parseInt(args[2], 10) - 1 : null,
            crop: sub === 'plant' ? args[3]?.toLowerCase() : sub === 'plantall' ? args[1]?.toLowerCase() : null
        });
    }
};

async function handleFarm(context, user, sub, data) {
    if (!['view', 'storage', 'plant', 'plantall', 'harvest', 'harvestall'].includes(sub)) {
        return sendError(context, user, 'Usage: `!farm`, `!farm storage`, `!farm plant <x> <y> <crop>`, `!farm plantall <crop>`, `!farm harvest <x> <y>`, or `!farm harvestall`.');
    }

    try {
        await db.query('INSERT IGNORE INTO user_farms (user_id) VALUES (?)', [user.id]);

        if (sub === 'view') {
            return send(context, { embeds: [await buildFarmEmbed(user)] });
        }

        if (sub === 'storage') {
            return send(context, { embeds: [await buildStorageEmbed(user)] });
        }

        if (sub === 'plant') {
            if (!Number.isInteger(data.x) || !Number.isInteger(data.y) || !data.crop) {
                return sendError(context, user, 'Enter X, Y, and crop ID.');
            }
            await FarmManager.plantCrop(user.id, data.x, data.y, data.crop);
            const cropName = cropsConfig[data.crop]?.name || data.crop;
            return send(context, { embeds: [successEmbed('Crop Planted', `Planted **${cropName}** at **[${data.x + 1}, ${data.y + 1}]**.`, user).setColor(colors.farm)] });
        }

        if (sub === 'plantall') {
            if (!data.crop) return sendError(context, user, 'Enter a crop ID.');
            const count = await FarmManager.plantAll(user.id, data.crop);
            const cropName = cropsConfig[data.crop]?.name || data.crop;
            return send(context, { embeds: [successEmbed('Farm Planted', `Planted **${count}** empty tile(s) with **${cropName}**.`, user).setColor(colors.farm)] });
        }

        if (sub === 'harvest') {
            if (!Number.isInteger(data.x) || !Number.isInteger(data.y)) {
                return sendError(context, user, 'Enter valid X and Y coordinates.');
            }
            const amount = await FarmManager.harvestCrop(user.id, data.x, data.y);
            return send(context, { embeds: [successEmbed('Crop Harvested', `Harvested **${amount} item(s)** from **[${data.x + 1}, ${data.y + 1}]**.`, user).setColor(colors.farm)] });
        }

        const result = await FarmManager.harvestAll(user.id);
        const summary = Object.entries(result.summary)
            .map(([cropId, amount]) => `• **${formatNumber(amount)}x ${cropsConfig[cropId]?.name || cropId}**`)
            .join('\n');
        const embed = successEmbed('Harvest Complete', `Harvested **${result.count}** tile(s).\n\n${summary}`, user)
            .setColor(colors.farm);
        if (result.isStorageFull) embed.setFooter({ text: 'Harvest stopped early because storage became full.' });
        return send(context, { embeds: [embed] });
    } catch (error) {
        return sendError(context, user, error.message);
    }
}

async function buildFarmEmbed(user) {
    const farmRows = await db.query('SELECT * FROM user_farms WHERE user_id = ?', [user.id]);
    const farm = farmRows[0];
    const tiles = await db.query('SELECT * FROM farm_tiles WHERE user_id = ?', [user.id]);
    const storageRows = await db.query('SELECT SUM(amount) as total FROM user_storage WHERE user_id = ?', [user.id]);
    const storage = Number(storageRows[0]?.total || 0);

    let grid = '';
    for (let y = 0; y < farm.height; y++) {
        for (let x = 0; x < farm.width; x++) {
            const tile = tiles.find(item => item.x === x && item.y === y);
            if (!tile || !tile.crop_id) grid += tile?.is_watered ? '🟦 ' : '⬛ ';
            else if (tile.growth < 100) grid += '🌱 ';
            else grid += '🌾 ';
        }
        grid += '\n';
    }

    return infoEmbed(`Farm: ${user.username}`, `\`\`\`\n${grid}\`\`\``, user)
        .setColor(colors.farm)
        .addFields(
            { name: 'Storage', value: progressBar(storage, farm.max_storage, 8), inline: true },
            { name: 'Legend', value: '⬛ Empty | 🟦 Watered | 🌱 Growing | 🌾 Ready', inline: false }
        );
}

async function buildStorageEmbed(user) {
    const farmRows = await db.query('SELECT max_storage FROM user_farms WHERE user_id = ?', [user.id]);
    const maxStorage = Number(farmRows[0]?.max_storage || 50);
    const items = await db.query('SELECT item_id, amount FROM user_storage WHERE user_id = ? AND amount > 0 ORDER BY item_id ASC', [user.id]);
    const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const embed = infoEmbed(`Farm Storage: ${user.username}`, null, user)
        .setColor(colors.farm)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .addFields({ name: 'Capacity', value: progressBar(total, maxStorage, 8), inline: false });

    embed.setDescription(items.length
        ? items.map(item => `• **${cropsConfig[item.item_id]?.name || item.item_id}** — x${formatNumber(item.amount)}`).join('\n')
        : 'Storage is empty.');

    return embed;
}
