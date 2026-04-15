const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const CraftingManager = require('../../managers/CraftingManager');

module.exports = {
    name: 'craft',
    aliases: ['buat', 'masak', 'olah'],
    prefix: true,
    slash: true,
    cooldown: 3,
    data: new SlashCommandBuilder()
        .setName('craft')
        .setDescription('Sistem pengolahan hasil panen')
        .addSubcommand(sub => sub.setName('list').setDescription('Lihat daftar resep yang tersedia'))
        .addSubcommand(sub => sub.setName('queue').setDescription('Lihat antrian crafting-mu yang sedang berjalan'))
        .addSubcommand(sub => 
            sub.setName('start')
            .setDescription('Mulai membuat barang')
            .addStringOption(opt => opt.setName('recipe').setDescription('ID Resep (contoh: flour, bread)').setRequired(true))
            .addIntegerOption(opt => opt.setName('amount').setDescription('Jumlah yang ingin dibuat').setMinValue(1).setMaxValue(100))
        )
        .addSubcommand(sub => 
            sub.setName('claim')
            .setDescription('Ambil barang yang sudah selesai')
            .addIntegerOption(opt => opt.setName('queue_id').setDescription('ID Antrian').setRequired(true))
        ),

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        const data = {
            recipe: interaction.options.getString('recipe'),
            amount: interaction.options.getInteger('amount') || 1,
            queueId: interaction.options.getInteger('queue_id')
        };
        await handleCraft(interaction, interaction.user, sub, data, true);
    },

    async executePrefix(message, args) {
        const user = message.author;
        const sub = args[0]?.toLowerCase();

        if (!sub || !['list', 'queue', 'start', 'claim'].includes(sub)) {
            return message.channel.send(`❌ **${user.username}**, Format: \`!craft list\`, \`!craft queue\`, \`!craft start <resep> [jumlah]\`, \`!craft claim <queue_id>\``);
        }

        const data = {
            recipe: args[1]?.toLowerCase(),
            amount: parseInt(args[2]) || 1,
            queueId: parseInt(args[1])
        };
        await handleCraft(message, user, sub, data, false);
    }
};

async function handleCraft(context, user, sub, data, isSlash) {
    try {
        if (sub === 'list') {
            const recipes = CraftingManager.getRecipes();
            const embed = new EmbedBuilder().setColor('#FF9800').setTitle('📜 Buku Resep (Crafting)');
            
            let desc = '';
            for (const [id, req] of Object.entries(recipes)) {
                let ingredientsText = Object.entries(req.ingredients).map(([item, qty]) => `${qty}x ${item}`).join(', ');
                desc += `${req.emoji} **${req.name}** (ID: \`${id}\`)\n`;
                desc += `└ ⏱️ ${req.time_mins} Menit | 🧪 Bahan: ${ingredientsText}\n\n`;
            }
            
            embed.setDescription(desc || 'Belum ada resep yang tersedia.');
            return isSlash ? context.reply({ embeds: [embed] }) : context.channel.send({ embeds: [embed] });
        }

        if (sub === 'queue') {
            const queue = await CraftingManager.getQueue(user.id);
            const embed = new EmbedBuilder().setColor('#2196F3').setTitle(`⏳ Antrian Crafting: ${user.username}`);
            
            if (!queue || queue.length === 0) {
                embed.setDescription("Kamu sedang tidak memproses barang apapun.");
            } else {
                const recipes = CraftingManager.getRecipes();
                let desc = '';
                queue.forEach(q => {
                    const itemName = recipes[q.recipe_id]?.name || q.recipe_id;
                    const isDone = Date.now() >= q.end_time;
                    const timeText = isDone ? '✅ **SIAP DIAMBIL**' : `Selesai <t:${Math.round(q.end_time / 1000)}:R>`;
                    
                    desc += `**[ID: ${q.id}]** ${q.amount}x **${itemName}**\n└ ${timeText}\n\n`;
                });
                embed.setDescription(desc);
                embed.setFooter({ text: 'Gunakan !craft claim <ID> untuk mengambil barang' });
            }
            
            return isSlash ? context.reply({ embeds: [embed] }) : context.channel.send({ embeds: [embed] });
        }

        if (sub === 'start') {
            if (!data.recipe) throw new Error("Format salah! Masukkan ID Resep.");
            
            const finishTime = await CraftingManager.startCrafting(user.id, data.recipe, data.amount);
            const timestamp = Math.round(finishTime / 1000);
            
            const msg = `🛠️ **${user.username}** mulai mengolah **${data.amount}x ${data.recipe}**! Proses akan selesai <t:${timestamp}:R>.`;
            return isSlash ? context.reply(msg) : context.channel.send(msg);
        }

        if (sub === 'claim') {
            if (isNaN(data.queueId)) throw new Error("Format salah! Masukkan ID Antrian.");
            
            const result = await CraftingManager.claimCrafting(user.id, data.queueId);
            const msg = `🎉 **${user.username}** berhasil mengambil **${result.amount}x ${result.itemName}** ${result.emoji}! (Barang masuk ke Storage)`;
            return isSlash ? context.reply(msg) : context.channel.send(msg);
        }

    } catch (error) {
        const errMsg = `❌ **${user.username}**, ${error.message}`;
        if (isSlash) await context.reply({ content: errMsg, ephemeral: true });
        else await context.channel.send(errMsg);
    }
}