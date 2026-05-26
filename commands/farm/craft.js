const { SlashCommandBuilder } = require('discord.js');
const CraftingManager = require('../../managers/CraftingManager');
const { infoEmbed, successEmbed, formatNumber, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'craft',
    aliases: ['buat', 'masak', 'olah'],
    prefix: true,
    slash: true,
    cooldown: 3,
    data: new SlashCommandBuilder()
        .setName('craft')
        .setDescription('Process farm goods into crafted items.')
        .addSubcommand(sub => sub.setName('list').setDescription('View available recipes.'))
        .addSubcommand(sub => sub.setName('queue').setDescription('View your crafting queue.'))
        .addSubcommand(sub => sub.setName('start').setDescription('Start a crafting job.')
            .addStringOption(opt => opt.setName('recipe').setDescription('Recipe ID.').setRequired(true))
            .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to craft.').setMinValue(1).setMaxValue(100)))
        .addSubcommand(sub => sub.setName('claim').setDescription('Claim a finished crafting job.')
            .addIntegerOption(opt => opt.setName('queue_id').setDescription('Queue ID.').setRequired(true))),

    async executeSlash(interaction) {
        await handleCraft(interaction, interaction.user, interaction.options.getSubcommand(), {
            recipe: interaction.options.getString('recipe'),
            amount: interaction.options.getInteger('amount') || 1,
            queueId: interaction.options.getInteger('queue_id')
        });
    },

    async executePrefix(message, args) {
        await handleCraft(message, message.author, args[0]?.toLowerCase(), {
            recipe: args[1]?.toLowerCase(),
            amount: Number.parseInt(args[2] || '1', 10),
            queueId: Number.parseInt(args[1], 10)
        });
    }
};

async function handleCraft(context, user, sub, data) {
    if (!sub || !['list', 'queue', 'start', 'claim'].includes(sub)) {
        return sendError(context, user, 'Usage: `!craft list`, `!craft queue`, `!craft start <recipe> [amount]`, or `!craft claim <queue_id>`.');
    }

    try {
        if (sub === 'list') {
            const recipes = CraftingManager.getRecipes();
            const embed = infoEmbed('Recipe Book', null, user)
                .setColor(colors.craft);

            embed.setDescription(Object.entries(recipes).map(([id, recipe]) => {
                const ingredients = Object.entries(recipe.ingredients).map(([item, qty]) => `${qty}x ${item}`).join(', ');
                return `${recipe.emoji || ''} **${recipe.name}** \`${id}\`\nTime: ${recipe.time_mins} min | Result: ${recipe.result} | Ingredients: ${ingredients}`;
            }).join('\n\n') || 'No recipes are available.');

            return send(context, { embeds: [embed] });
        }

        if (sub === 'queue') {
            const queue = await CraftingManager.getQueue(user.id);
            const recipes = CraftingManager.getRecipes();
            const embed = infoEmbed(`Crafting Queue: ${user.username}`, null, user)
                .setColor(colors.craft);

            embed.setDescription(queue.length ? queue.map((entry) => {
                const recipe = recipes[entry.recipe_id];
                const status = Date.now() >= entry.end_time ? 'Ready to claim' : `Done <t:${Math.round(entry.end_time / 1000)}:R>`;
                return `**#${entry.id}** ${formatNumber(entry.amount)}x **${recipe?.name || entry.recipe_id}** — ${status}`;
            }).join('\n') : 'No active crafting jobs.');
            embed.setFooter({ text: 'Use /craft claim queue_id when a job is ready.' });

            return send(context, { embeds: [embed] });
        }

        if (sub === 'start') {
            if (!data.recipe) return sendError(context, user, 'Enter a recipe ID.');
            if (!Number.isInteger(data.amount) || data.amount <= 0) return sendError(context, user, 'Amount must be a positive integer.');

            const finishTime = await CraftingManager.startCrafting(user.id, data.recipe, data.amount);
            const embed = successEmbed('Crafting Started', `Started **${formatNumber(data.amount)}x ${data.recipe}**. Ready <t:${Math.round(finishTime / 1000)}:R>.`, user)
                .setColor(colors.craft);
            return send(context, { embeds: [embed] });
        }

        if (!Number.isInteger(data.queueId) || data.queueId <= 0) {
            return sendError(context, user, 'Queue ID must be a positive integer.');
        }

        const result = await CraftingManager.claimCrafting(user.id, data.queueId);
        const embed = successEmbed('Crafting Claimed', `Claimed **${formatNumber(result.amount)}x ${result.itemName}** ${result.emoji || ''}.`, user)
            .setColor(colors.craft);
        return send(context, { embeds: [embed] });
    } catch (error) {
        return sendError(context, user, error.message);
    }
}
