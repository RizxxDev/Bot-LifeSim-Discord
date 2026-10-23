const { SlashCommandBuilder } = require('discord.js');
const economy = require('../../services/economyService');
const { infoEmbed, formatMoney, colors } = require('../../utils/ui');
const { send, sendError } = require('../../utils/respond');

module.exports = {
    name: 'leaderboard',
    aliases: ['lb', 'top', 'rich'],
    prefix: true,
    slash: true,
    requiresRegistration: false,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the top 10 richest citizens.'),

    async executeSlash(interaction) {
        await handleLeaderboard(interaction, interaction.client, interaction.user);
    },

    async executePrefix(message) {
        await handleLeaderboard(message, message.client, message.author);
    }
};

async function handleLeaderboard(context, client, user) {
    try {
        const guildId = economy.getGuildId(context);
        const { rows, cacheUsed } = await economy.getLeaderboard(guildId);

        if (!rows || rows.length === 0) {
            return sendError(context, user, 'No citizen wealth data is available yet.');
        }

        // Ambil data user Discord secara paralel dengan Promise.allSettled
        const userPromises = rows.map(row => 
            client.users.fetch(row.user_id)
                .then(u => u.username)
                .catch(() => `Former citizen (${row.user_id})`)
        );
        const settledUsers = await Promise.allSettled(userPromises);

        const lines = rows.map((row, index) => {
            const username = settledUsers[index]?.status === 'fulfilled'
                ? settledUsers[index].value
                : `Former citizen (${row.user_id})`;
            const rank = ['#1', '#2', '#3'][index] || `#${index + 1}`;
            return `**${rank} ${username}** - ${formatMoney(row.total_wealth)} (Cash ${formatMoney(row.cash)} | Bank ${formatMoney(row.bank)})`;
        });

        const embed = infoEmbed('Wealth Leaderboard', lines.join('\n'), user)
            .setColor(colors.warning)
            .setThumbnail(client.user.displayAvatarURL())
            .setFooter({ text: cacheUsed ? 'Served from Redis cache.' : 'Fresh MariaDB result. Cache refreshes every 5 minutes.' });

        const self = await economy.getBalance(guildId, user.id);
        if (self.total > 0) {
            embed.addFields({ name: 'Your wealth', value: formatMoney(self.total), inline: false });
        }

        return send(context, { embeds: [embed] });
    } catch (error) {
        console.error('[LEADERBOARD ERROR]', error);
        return sendError(context, user, 'Could not load the leaderboard.');
    }
}
