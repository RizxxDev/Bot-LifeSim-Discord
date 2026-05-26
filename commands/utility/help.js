const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config.json');
const { infoEmbed, colors } = require('../../utils/ui');
const { send } = require('../../utils/respond');

module.exports = {
    name: 'help',
    aliases: ['h', 'commands'],
    prefix: true,
    slash: true,
    requiresRegistration: false,
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available commands.'),

    async executeSlash(interaction) {
        await handleHelp(interaction, interaction.user, interaction.client.commands);
    },

    async executePrefix(message) {
        await handleHelp(message, message.author, message.client.commands);
    }
};

async function handleHelp(context, user, commands) {
    const prefix = config.bot?.prefixes?.[0] || '!';
    const groups = {};

    for (const command of commands.values()) {
        const category = command.category || inferCategory(command.name);
        if (!groups[category]) groups[category] = [];
        groups[category].push(command);
    }

    const embed = infoEmbed(
        'Command Center',
        `Use slash commands or prefix commands. Default prefix: \`${prefix}\`.`,
        user
    ).setColor(colors.primary);

    for (const [category, items] of Object.entries(groups)) {
        const value = items
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((command) => {
                const aliases = command.aliases?.length ? ` (${command.aliases.join(', ')})` : '';
                return `\`${command.name}\`${aliases}`;
            })
            .join('\n');

        embed.addFields({ name: category, value: value || 'No commands', inline: true });
    }

    embed.setFooter({ text: `Try ${prefix}profile, ${prefix}shop, or /farm view` });
    return send(context, { embeds: [embed] });
}

function inferCategory(commandName) {
    if (['help', 'ping', 'register'].includes(commandName)) return 'Utility';
    if (['farm', 'craft', 'market'].includes(commandName)) return 'Farming';
    return 'Economy';
}
