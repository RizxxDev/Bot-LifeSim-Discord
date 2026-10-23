const { checkCooldown, checkRegistration } = require('../utils/middleware');
const { sendError } = require('../utils/respond');

module.exports = {
    name: 'interactionCreate',
    async handle(interaction, client) {
        // Penanganan Autocomplete interaktif
        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (command && typeof command.autocomplete === 'function') {
                try {
                    await command.autocomplete(interaction);
                } catch (error) {
                    console.error('[AUTOCOMPLETE ERROR]', error);
                }
            }
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);
        if (!command || !command.slash) return;

        try {
            if (command.requiresRegistration !== false) {
                const registered = await checkRegistration(interaction.user.id);
                if (!registered) {
                    return sendError(interaction, interaction.user, 'Create your citizen profile first with `/register`.', { ephemeral: true });
                }
            }

            const timeLeft = await checkCooldown(command, interaction.user.id);
            if (timeLeft) {
                return sendError(interaction, interaction.user, `Please wait **${timeLeft}s** before using \`${command.name}\` again.`, { ephemeral: true });
            }

            await command.executeSlash(interaction);
        } catch (error) {
            console.error('[SLASH COMMAND ERROR]', error);
            await sendError(interaction, interaction.user, 'Something went wrong while running this command.', { ephemeral: true });
        }
    }
};
