const { checkRegister, checkCooldown } = require('../utils/middleware');

module.exports = {
    name: 'interactionCreate',
    once: false,
    async handle(interaction, client) {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);
        if (!command || !command.slash) return;

        try {
            const isRegistered = await checkRegister(interaction.user.id, command.name);
            if (!isRegistered) return interaction.reply({ content: '❌ **You don\'t have a character yet!** \nPlease type `/register` first.', ephemeral: true });

            const cooldownMsg = checkCooldown(client, command, interaction.user.id);
            if (cooldownMsg) return interaction.reply({ content: cooldownMsg, ephemeral: true });

            await command.executeSlash(interaction);
        } catch (error) {
            console.error(`[SLASH ERROR - ${command.name}]`, error);
            const errorMsg = '❌ An error occurred while executing the command.';
            if (interaction.replied || interaction.deferred) await interaction.followUp({ content: errorMsg, ephemeral: true });
            else await interaction.reply({ content: errorMsg, ephemeral: true });
        }
    }
};