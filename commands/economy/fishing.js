const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const ItemManager = require('../../managers/ItemManager');
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
        const inventory = await db.query(
            'SELECT item_id, amount FROM user_inventory WHERE user_id = ? AND item_id IN ("fishing_rod", "pro_rod", "bait") AND amount > 0',
            [user.id]
        );

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

        const usesBait = inventory.some(item => item.item_id === 'bait' && Number(item.amount) > 0);
        const waitingEmbed = infoEmbed('Fishing Session', `Rod: **${rodName}**\n\nCasting the line... stay ready.`, user)
            .setColor(colors.primary);
        if (usesBait) waitingEmbed.addFields({ name: 'Bait', value: '1x bait will be used for this cast.', inline: true });

        const response = await send(context, { embeds: [waitingEmbed], fetchReply: true });

        if (usesBait) {
            await ItemManager.removeItem(db, user.id, 'bait', 1);
        }

        await wait(randomInt(3000, 7000));

        const actions = [
            { id: 'pull', label: 'Pull', emoji: '🎣' },
            { id: 'steady', label: 'Steady', emoji: '🧵' },
            { id: 'release', label: 'Release', emoji: '🌊' }
        ];
        const correctAction = randomChoice(actions);
        const rareBite = Math.random() < (usesBait ? 0.18 : 0.08);
        const finalReactionTime = rareBite ? Math.max(1800, reactionTime - 900) : reactionTime;

        const row = new ActionRowBuilder().addComponents(actions.map(action => new ButtonBuilder()
            .setCustomId(`fish_${action.id}:${user.id}`)
            .setLabel(action.label)
            .setEmoji(action.emoji)
            .setStyle(action.id === correctAction.id ? ButtonStyle.Success : ButtonStyle.Secondary)));

        const actionEmbed = infoEmbed(
            'Bite Detected',
            `The line jerks. Choose **${correctAction.label}** before it escapes.${rareBite ? '\n\nRare bite: shorter timing window, better reward odds.' : ''}`,
            user
        ).setColor(colors.danger);

        await edit(context, response, { embeds: [actionEmbed], components: [row] });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: finalReactionTime
        });

        collector.on('collect', async (interaction) => {
            if (interaction.user.id !== user.id) {
                await interaction.reply({ content: 'This fishing session belongs to another player.', ephemeral: true }).catch(() => {});
                return;
            }

            await interaction.deferUpdate();
            collector.stop(interaction.customId.startsWith(`fish_${correctAction.id}`) ? 'success' : 'failed');
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'success') {
                const fish = getRandomFish(rodType, usesBait, rareBite);
                const amount = fish.id === 'trash' ? 1 : randomInt(1, 2);

                try {
                    await ItemManager.addItem(db, user.id, fish.id, amount);

                    const embed = successEmbed('Catch Secured', `You caught **${amount}x ${fish.emoji} ${fish.name}**.`, user)
                        .setFooter({ text: `${fish.desc} Sell it with /sell ${fish.id} ${amount}, or use it in recipes.` });
                    await edit(context, response, { embeds: [embed], components: [] });
                } catch (error) {
                    console.error('[FISHING DB ERROR]', error);
                    await edit(context, response, { embeds: [infoEmbed('Fishing Error', 'The catch could not be saved.', user).setColor(colors.danger)], components: [] });
                }
            } else {
                const message = reason === 'failed'
                    ? 'Wrong move. The hook slipped and the fish escaped.'
                    : 'You reacted too late. Try again when the cooldown ends.';
                const embed = infoEmbed('The Fish Escaped', message, user)
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

function randomChoice(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function getRandomFish(rodType, usesBait = false, rareBite = false) {
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

    if (usesBait) {
        trashChance = Math.max(3, trashChance - 8);
        salmonChance -= 8;
        tunaChance -= 5;
    }

    if (rareBite) {
        trashChance = 0;
        salmonChance = Math.max(20, salmonChance - 20);
        tunaChance = Math.max(65, tunaChance - 10);
    }

    if (roll < trashChance) return { id: 'trash', name: 'Trash', emoji: '👞', desc: 'Not glamorous, but it can become bait.' };
    if (roll < salmonChance) return { id: 'salmon', name: 'Salmon', emoji: '🐟', desc: 'A reliable catch.' };
    if (roll < tunaChance) return { id: 'tuna', name: 'Tuna', emoji: '🐠', desc: 'A valuable catch.' };
    return { id: 'shark', name: 'White Shark', emoji: '🦈', desc: 'Jackpot catch.' };
}
