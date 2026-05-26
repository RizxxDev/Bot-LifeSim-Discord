const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const { infoEmbed, successEmbed, colors } = require('../../utils/ui');
const { send, edit, sendError } = require('../../utils/respond');

module.exports = {
    name: 'mine',
    aliases: ['mining', 'nambang'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('mine')
        .setDescription('Start an interactive mining session.'),

    async executeSlash(interaction) {
        await handleMine(interaction, interaction.user);
    },

    async executePrefix(message) {
        await handleMine(message, message.author);
    }
};

async function handleMine(context, user) {
    try {
        const inventory = await db.query('SELECT item_id FROM inventory WHERE user_id = ? AND item_id IN ("pickaxe", "gpick") AND amount > 0', [user.id]);
        const hasGoldPick = inventory.some(item => item.item_id === 'gpick');
        const hasPick = inventory.some(item => item.item_id === 'pickaxe');

        if (!hasGoldPick && !hasPick) {
            return sendError(context, user, 'You need a pickaxe before mining.');
        }

        const pickType = hasGoldPick ? 'gpick' : 'pickaxe';
        const pickName = hasGoldPick ? 'Golden Pickaxe' : 'Pickaxe';
        const orePool = hasGoldPick
            ? ['rock', 'coal', 'iron_ore', 'copper_ore', 'gold_ore', 'diamond_ore']
            : ['rock', 'coal', 'iron_ore', 'copper_ore'];

        const startButton = new ButtonBuilder()
            .setCustomId(`mine_start:${user.id}`)
            .setLabel('Start')
            .setEmoji('⛏️')
            .setStyle(ButtonStyle.Primary);
        const startRow = new ActionRowBuilder().addComponents(startButton);
        const startEmbed = infoEmbed('Mining Site', `Tool: **${pickName}**\nAvailable ore: ${orePool.map(id => getOreDetails(id).name).join(', ')}`, user)
            .setColor(colors.craft)
            .setFooter({ text: 'The session expires in 60 seconds.' });

        const response = await send(context, { embeds: [startEmbed], components: [startRow], fetchReply: true });
        const state = { oreId: null, hp: 0, maxHp: 0 };

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000
        });

        collector.on('collect', async (interaction) => {
            if (interaction.user.id !== user.id) {
                await interaction.reply({ content: 'This mining session belongs to another player.', ephemeral: true }).catch(() => {});
                return;
            }

            await interaction.deferUpdate();

            if (interaction.customId.startsWith('mine_start')) {
                state.oreId = randomChoice(orePool);
                const ore = getOreDetails(state.oreId);
                state.maxHp = randomInt(ore.minHp, ore.maxHp);
                state.hp = state.maxHp;
                await interaction.editReply(renderMiningState(user, state));
                return;
            }

            if (!state.oreId) return;

            const damage = pickType === 'gpick' ? randomInt(7, 15) : randomInt(3, 10);
            state.hp = Math.max(0, state.hp - damage);

            if (state.hp > 0) {
                await interaction.editReply(renderMiningState(user, state, damage));
                return;
            }

            collector.stop('broken');
            await saveMiningReward(interaction, user, state.oreId);
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'broken') return;
            const timeoutEmbed = infoEmbed('Mining Session Ended', 'The ore was not broken before the session expired.', user)
                .setColor(colors.muted);
            await edit(context, response, { embeds: [timeoutEmbed], components: [] }).catch(() => {});
        });
    } catch (error) {
        console.error('[MINE ERROR]', error);
        return sendError(context, user, 'Could not start the mining session.');
    }
}

function renderMiningState(user, state, lastDamage = null) {
    const ore = getOreDetails(state.oreId);
    const embed = infoEmbed('Mining Session', null, user)
        .setColor(colors.craft)
        .addFields(
            { name: 'Ore', value: `${ore.name} (${ore.rarity})`, inline: true },
            { name: 'HP', value: `${state.hp} / ${state.maxHp}`, inline: true },
            { name: 'Last hit', value: lastDamage ? `${lastDamage} damage` : 'Ready', inline: true }
        )
        .setFooter({ text: 'Keep hitting until the ore breaks.' });

    const button = new ButtonBuilder()
        .setCustomId(`mine_hit:${user.id}`)
        .setLabel('Mine')
        .setEmoji('⛏️')
        .setStyle(ButtonStyle.Primary);

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

async function saveMiningReward(interaction, user, oreId) {
    const ore = getOreDetails(oreId);
    const rewardAmount = ['rock', 'coal', 'copper_ore'].includes(oreId) ? randomInt(1, 3) : randomInt(2, 5);
    const bonus = Math.random() < 0.5 ? getBonusOre(oreId) : null;

    let trx;
    try {
        trx = await db.startTransaction();
        await trx.query(
            'INSERT INTO inventory (user_id, item_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?',
            [user.id, oreId, rewardAmount, rewardAmount]
        );

        if (bonus) {
            await trx.query(
                'INSERT INTO inventory (user_id, item_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?',
                [user.id, bonus.id, bonus.amount, bonus.amount]
            );
        }

        await trx.commit();

        const lines = [`${rewardAmount}x ${ore.name}`];
        if (bonus) lines.push(`${bonus.amount}x ${getOreDetails(bonus.id).name}`);

        const embed = successEmbed('Ore Collected', lines.join('\n'), user)
            .setColor(colors.craft);
        const doneButton = new ButtonBuilder()
            .setCustomId(`mine_done:${user.id}`)
            .setLabel('Finished')
            .setStyle(ButtonStyle.Success)
            .setDisabled(true);
        await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(doneButton)] });
    } catch (error) {
        if (trx) await trx.rollback();
        console.error('[MINING DB ERROR]', error);
        await interaction.editReply({ embeds: [infoEmbed('Mining Error', 'The reward could not be saved.', user).setColor(colors.danger)], components: [] });
    }
}

function getBonusOre(oreId) {
    const id = oreId === 'rock' ? randomChoice(['gold_ore', 'coal']) : randomChoice(['rock', 'coal']);
    return { id, amount: randomInt(1, 3) };
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function getOreDetails(oreId) {
    const data = {
        rock: { name: 'Rock', rarity: 'Common', minHp: 10, maxHp: 25 },
        coal: { name: 'Coal Ore', rarity: 'Common', minHp: 20, maxHp: 30 },
        copper_ore: { name: 'Copper Ore', rarity: 'Uncommon', minHp: 15, maxHp: 27 },
        iron_ore: { name: 'Iron Ore', rarity: 'Rare', minHp: 30, maxHp: 40 },
        gold_ore: { name: 'Gold Ore', rarity: 'Epic', minHp: 40, maxHp: 55 },
        diamond_ore: { name: 'Diamond Ore', rarity: 'Legendary', minHp: 55, maxHp: 75 }
    };

    return data[oreId] || data.rock;
}
