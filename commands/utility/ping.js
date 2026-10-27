const { SlashCommandBuilder } = require('discord.js');
const { COLORS, buildV2Card } = require('../../utils/uiBuilder');

module.exports = {
    name: 'ping',
    slash: true,
    skipRegistrationCheck: true,
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Cek latensi respon bot dan koneksi WebSocket Discord.'),

    async executeSlash(interaction) {
        await interaction.reply(
            buildV2Card({
                accentColor: COLORS.PRIMARY,
                title: '🏓 Pinging...',
                blocks: ['Mengukur latensi respon server...']
            })
        );
        const sent = await interaction.fetchReply();

        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        const apiPing = Math.round(interaction.client.ws.ping);

        await interaction.editReply(
            buildV2Card({
                accentColor: COLORS.PRIMARY,
                title: '🏓 Pong!',
                blocks: [
                    `• **Bot Latency:** \`${latency}ms\`\n• **API Latency:** \`${apiPing}ms\``
                ]
            })
        );
    }
};
