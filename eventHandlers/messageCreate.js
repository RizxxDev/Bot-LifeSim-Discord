const config = require('../config.json');
const { checkCooldown, checkRegistration } = require('../utils/middleware');
const { sendError } = require('../utils/respond');

module.exports = {
    name: 'messageCreate',
    async handle(message, client) {
        if (message.author.bot) return;

        const prefixes = config.bot?.prefixes || ['!'];
        const prefix = prefixes.find((item) => message.content.startsWith(item));
        if (!prefix) return;

        const args = message.content.slice(prefix.length).trim().split(/ +/).filter(Boolean);
        const commandName = args.shift()?.toLowerCase();
        if (!commandName) return;

        const command = client.commands.get(commandName) || client.commands.get(client.aliases.get(commandName));
        if (!command || !command.prefix) return;

        try {
            if (command.requiresRegistration !== false) {
                const isRegistered = await checkRegistration(message.author.id);
                if (!isRegistered) {
                    return sendError(message, message.author, 'Create your citizen profile first with `/register` or `!register`.');
                }
            }

            const timeLeft = await checkCooldown(command, message.author.id);
            if (timeLeft) {
                return sendError(message, message.author, `Please wait **${timeLeft}s** before using \`${command.name}\` again.`);
            }

            await command.executePrefix(message, args);
        } catch (error) {
            console.error('[COMMAND EXECUTION ERROR]', error);
            await sendError(message, message.author, 'Something went wrong while running this command.');
        }
    }
};
