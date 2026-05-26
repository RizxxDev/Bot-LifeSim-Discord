const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const { infoEmbed, successEmbed, colors } = require('../../utils/ui');
const { send, edit, sendError } = require('../../utils/respond');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
    name: 'fish',
    aliases: ['mancing', 'fishing'],
    prefix: true,
    slash: true,
    cooldown: 15,
    data: new SlashCommandBuilder()
        .setName('fish')
        .setDescription('Start a quick reaction fishing session.'),

    async executeSlash(interaction) {
        await handleInteractiveFish(interaction, interaction.user);
    },

    async executePrefix(message) {
        await handleInteractiveFish(message, message.author);
    }
};

async function handleInteractiveFish(context, user) {
    try {
        const inventory = await db.query('SELECT item_id FROM inventory WHERE user_id = ? AND item_id IN ("fishing_rod", "pro_rod") AND amount > 0', [user.id]);

        let rodType = 'bamboo';
        let rodName = 'Bamboo Rod';
        let reactionTime = 3000;

        if (inventory.some(item => item.item_id === 'pro_rod')) {
            rodType = 'pro_rod';
            rodName = 'Pro Fishing Rod';
            reactionTime = 4500;
        } else if (inventory.some(item => item.item_id === 'fishing_rod')) {
            rodType = 'fishing_rod';
            rodName = 'Fishing Rod';
            reactionTime = 3500;
        }

        const waitingEmbed = infoEmbed('Fishing Session', `Rod: **${rodName}**\n\nCasting the line... stay ready.`, user)
            .setColor(colors.primary);
        const response = await send(context, { embeds: [waitingEmbed], fetchReply: true });

        await wait(randomInt(3000, 7000));

        const button = new ButtonBuilder()
            .setCustomId(`fish_pull:${user.id}`)
            .setLabel('Pull')
            .setEmoji('🎣')
            .setStyle(ButtonStyle.Success);
        const row = new ActionRowBuilder().addComponents(button);
        const actionEmbed = infoEmbed('Bite Detected', 'Press the button before the fish escapes.', user)
            .setColor(colors.danger);

        await edit(context, response, { embeds: [actionEmbed], components: [row] });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: reactionTime
        });

        collector.on('collect', async (interaction) => {
            if (interaction.user.id !== user.id) {
                await interaction.reply({ content: 'This fishing session belongs to another player.', ephemeral: true }).catch(() => {});
                return;
            }

            await interaction.deferUpdate();
            collector.stop('success');
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'success') {
                const fish = getRandomFish(rodType);
                const amount = fish.id === 'trash' ? 1 : randomInt(1, 2);

                try {
                    await db.query(
                        'INSERT INTO inventory (user_id, item_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?',
                        [user.id, fish.id, amount, amount]
                    );

                    const embed = successEmbed('Catch Secured', `You caught **${amount}x ${fish.emoji} ${fish.name}**.`, user)
                        .setFooter({ text: fish.desc });
                    await edit(context, response, { embeds: [embed], components: [] });
                } catch (error) {
                    console.error('[FISHING DB ERROR]', error);
                    await edit(context, response, { embeds: [infoEmbed('Fishing Error', 'The catch could not be saved.', user).setColor(colors.danger)], components: [] });
                }
            } else {
                const embed = infoEmbed('The Fish Escaped', 'You reacted too late. Try again when the cooldown ends.', user)
                    .setColor(colors.muted);
                await edit(context, response, { embeds: [embed], components: [] }).catch(() => {});
            }
        });
    } catch (error) {
        console.error('[FISH SYSTEM ERROR]', error);
        return sendError(context, user, 'Could not start the fishing session.');
    }
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomFish(rodType) {
    const roll = Math.random() * 100;
    let trashChance = 25;
    let salmonChance = 70;
    let tunaChance = 95;

    if (rodType === 'pro_rod') {
        trashChance = 10;
        salmonChance = 50;
        tunaChance = 85;
    } else if (rodType === 'fishing_rod') {
        trashChance = 15;
        salmonChance = 60;
        tunaChance = 90;
    }

    if (roll < trashChance) return { id: 'trash', name: 'Trash', emoji: '👞', desc: 'Not glamorous, but it is still an item.' };
    if (roll < salmonChance) return { id: 'salmon', name: 'Salmon', emoji: '🐟', desc: 'A reliable catch.' };
    if (roll < tunaChance) return { id: 'tuna', name: 'Tuna', emoji: '🐠', desc: 'A valuable catch.' };
    return { id: 'shark', name: 'White Shark', emoji: '🦈', desc: 'Jackpot catch.' };
}
