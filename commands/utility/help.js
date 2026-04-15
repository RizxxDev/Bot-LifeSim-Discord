const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    name: 'help',
    aliases: ['h', 'commands', 'cmd'],
    prefix: true,
    slash: true,
    cooldown: 5, 
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Displays a list of all available commands in the city.'),

    async executeSlash(interaction) {
        const commands = interaction.client.commands;
        const embed = generateHelpEmbed(commands, interaction.user);
        
        await interaction.reply({ embeds: [embed] });
    },

    async executePrefix(message, args) {
        const commands = message.client.commands;
        const embed = generateHelpEmbed(commands, message.author);
        
        // Menggunakan channel.send() agar bersih
        await message.channel.send({ embeds: [embed] });
    }
};

function generateHelpEmbed(commandsCollection, user) {
    const embed = new EmbedBuilder()
        .setColor('#ffa601')
        .setTitle('📚 Help Menu 📚')
        .setDescription('Here is a list of commands you can use. You can use the prefix `L` or `/` (Slash Command).')
        .setFooter({ text: `Requested by ${user.username}`, iconURL: user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

    const economyCommands = ['bank', 'work', 'balance', 'daily', 'profile', 'craft', 'farm', 'market', 'leaderboard', 'inventory']; 
    let economyText = '';
    
    const utilityCommands = ['help', 'ping', 'register']; 
    let utilityText = '';

    commandsCollection.forEach(cmd => {
        if (economyCommands.includes(cmd.name)) {
            const desc = cmd.data ? cmd.data.description : 'No description available.';
            economyText += `🔹 **\`/${cmd.name}\`** - ${desc}\n`;
        }
        else if (utilityCommands.includes(cmd.name)) {
            const desc = cmd.data ? cmd.data.description : 'No description available.';
            utilityText += `🔹 **\`/${cmd.name}\`** - ${desc}\n`;
        }
    });

    if (economyText) embed.addFields({ name: '💰 Economy & Jobs', value: economyText });
    if (utilityText) embed.addFields({ name: '🛠️ Utility & Account', value: utilityText });

    embed.addFields({ 
        name: '💡 Tips', 
        value: 'Some commands have "Aliases" (nicknames). For example, to access the bank, you can type `!atm` or `!bal` instead of `!bank`.' 
    });

    return embed;
}