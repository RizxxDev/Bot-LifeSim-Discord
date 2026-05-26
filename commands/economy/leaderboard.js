const { SlashCommandBuilder } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const { redisClient, isRedisReady } = require('../../botHandlers/redisHandler');
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
        let rows = null;
        let cacheUsed = false;

        if (isRedisReady()) {
            try {
                const cached = await redisClient.get('cache:leaderboard');
                if (cached) {
                    rows = JSON.parse(cached);
                    cacheUsed = true;
                }
            } catch (error) {
                console.error('[REDIS LEADERBOARD READ ERROR]', error);
            }
        }

        if (!rows) {
            rows = await db.query(`
                SELECT user_id, cash, bank, (cash + bank) AS total_wealth
                FROM users
                ORDER BY total_wealth DESC
                LIMIT 10
            `);

            if (isRedisReady() && rows?.length) {
                try {
                    await redisClient.setEx('cache:leaderboard', 300, JSON.stringify(rows));
                } catch (error) {
                    console.error('[REDIS LEADERBOARD WRITE ERROR]', error);
                }
            }
        }

        if (!rows || rows.length === 0) {
            return sendError(context, user, 'No citizen wealth data is available yet.');
        }

        const lines = [];
        for (let index = 0; index < rows.length; index++) {
            const row = rows[index];
            let username = 'Unknown Citizen';
            try {
                const discordUser = await client.users.fetch(row.user_id);
                if (discordUser) username = discordUser.username;
            } catch (error) {
                username = `Former citizen (${row.user_id})`;
            }

            const rank = ['#1', '#2', '#3'][index] || `#${index + 1}`;
            lines.push(`**${rank} ${username}** — ${formatMoney(row.total_wealth)} (Cash ${formatMoney(row.cash)} | Bank ${formatMoney(row.bank)})`);
        }

        const embed = infoEmbed('Wealth Leaderboard', lines.join('\n'), user)
            .setColor(colors.warning)
            .setThumbnail(client.user.displayAvatarURL())
            .setFooter({ text: cacheUsed ? 'Served from Redis cache.' : 'Fresh database result. Cache refreshes every 5 minutes.' });

        const self = await db.query('SELECT (cash + bank) AS total_wealth FROM users WHERE user_id = ?', [user.id]);
        if (self?.length) {
            const rankRows = await db.query('SELECT COUNT(*) AS rank_ahead FROM users WHERE (cash + bank) > ?', [self[0].total_wealth]);
            embed.addFields({ name: 'Your rank', value: `#${Number(rankRows[0].rank_ahead) + 1} with ${formatMoney(self[0].total_wealth)}`, inline: false });
        }

        return send(context, { embeds: [embed] });
    } catch (error) {
        console.error('[LEADERBOARD ERROR]', error);
        return sendError(context, user, 'Could not load the leaderboard.');
    }
}
