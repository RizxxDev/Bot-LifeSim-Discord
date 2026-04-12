const { checkRegister, checkCooldown } = require('../utils/middleware');

module.exports = {
    name: 'messageCreate',
    once: false,
    async handle(message, client) {
        if (message.author.bot) return;

        const prefixes = ['!', 'L', 'l']; 
        const usedPrefix = prefixes.find(p => message.content.startsWith(p));
        if (!usedPrefix) return;

        const args = message.content.slice(usedPrefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const command = client.commands.get(commandName) || client.commands.find(cmd => cmd.aliases && cmd.aliases.includes(commandName));
        if (!command || !command.prefix) return;

        try {
            const isRegistered = await checkRegister(message.author.id, command.name);
            if (!isRegistered) return message.reply('❌ **You don\'t have a character yet!** \nPlease type `!register` first.');

            const cooldownMsg = checkCooldown(client, command, message.author.id);
            if (cooldownMsg) return message.reply(cooldownMsg);

            await command.executePrefix(message, args);
        } catch (error) {
            console.error(`[PREFIX ERROR - ${command.name}]`, error);
            message.reply('❌ A system error occurred.').catch(console.error);
        }
    }
};