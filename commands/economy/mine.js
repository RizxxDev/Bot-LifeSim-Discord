const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const ItemManager = require('../../managers/ItemManager');
const { infoEmbed, successEmbed, progressBar, colors } = require('../../utils/ui');
const { send, edit, sendError } = require('../../utils/respond');

module.exports = {
    name: 'mine',
    aliases: ['mining', 'nambang'],
    prefix: true,
    slash: true,
    cooldown: 8,
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
        const inventory = await db.query('SELECT item_id FROM user_inventory WHERE user_id = ? AND item_id IN ("pickaxe", "gpick") AND amount > 0', [user.id]);
        const userRows = await db.query('SELECT mining_level, mining_exp FROM users WHERE user_id = ?', [user.id]);
        const miningLevel = Number(userRows[0]?.mining_level || 1);
        const hasGoldPick = inventory.some(item => item.item_id === 'gpick');
        const hasPick = inventory.some(item => item.item_id === 'pickaxe');

        if (!hasGoldPick && !hasPick) {
            return sendError(context, user, 'You need a pickaxe before mining. Buy one from `/shop` with `/buy pickaxe 1`.');
        }

        const pickType = hasGoldPick ? 'gpick' : 'pickaxe';
        const pickName = hasGoldPick ? 'Golden Pickaxe' : 'Pickaxe';
        const orePool = buildOrePool(pickType, miningLevel);

        const startButton = new ButtonBuilder()
            .setCustomId(`mine_start:${user.id}`)
            .setLabel('Start')
            .setEmoji('⛏️')
            .setStyle(ButtonStyle.Primary);
        const startRow = new ActionRowBuilder().addComponents(startButton);
        const startEmbed = infoEmbed('Mining Site', `Tool: **${pickName}**\nMining mastery: **Lv. ${miningLevel}**\nAvailable ore: ${orePool.map(id => getOreDetails(id).name).join(', ')}`, user)
            .setColor(colors.craft)
            .setFooter({ text: 'Scan reveals weak spots, Charge boosts the next Strike.' });

        const response = await send(context, { embeds: [startEmbed], components: [startRow], fetchReply: true });
        const state = { oreId: null, hp: 0, maxHp: 0, charge: 0, scanned: false, note: 'Pick an action.' };

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
                state.note = 'Ore found. Scan, charge, then strike.';
                await interaction.editReply(renderMiningState(user, state));
                return;
            }

            if (!state.oreId) return;

            if (interaction.customId.startsWith('mine_scan')) {
                state.scanned = true;
                state.note = 'Weak spot found. Your next strike gains bonus damage.';
                await interaction.editReply(renderMiningState(user, state));
                return;
            }

            if (interaction.customId.startsWith('mine_charge')) {
                state.charge = Math.min(3, state.charge + 1);
                state.note = state.charge >= 3 ? 'Fully charged. Strike now.' : `Charge level ${state.charge}.`;
                await interaction.editReply(renderMiningState(user, state));
                return;
            }

            const damage = calculateDamage(pickType, miningLevel, state);
            state.hp = Math.max(0, state.hp - damage);
            state.charge = 0;
            state.scanned = false;
            state.note = `Strike dealt ${damage} damage.`;

            if (state.hp > 0) {
                await interaction.editReply(renderMiningState(user, state));
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

function renderMiningState(user, state) {
    const ore = getOreDetails(state.oreId);
    const embed = infoEmbed('Mining Session', null, user)
        .setColor(colors.craft)
        .addFields(
            { name: 'Ore', value: `${ore.name} (${ore.rarity})`, inline: true },
            { name: 'HP', value: `${state.hp} / ${state.maxHp}`, inline: true },
            { name: 'Charge', value: `${state.charge}/3`, inline: true },
            { name: 'Status', value: state.note, inline: false }
        )
        .setFooter({ text: 'Scan: safer bonus | Charge: bigger hit | Strike: deal damage' });

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`mine_scan:${user.id}`).setLabel('Scan').setEmoji('🔎').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`mine_charge:${user.id}`).setLabel('Charge').setEmoji('⚡').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`mine_strike:${user.id}`).setLabel('Strike').setEmoji('⛏️').setStyle(ButtonStyle.Success)
        )]
    };
}

async function saveMiningReward(interaction, user, oreId) {
    const ore = getOreDetails(oreId);
    const rewardAmount = ['rock', 'coal', 'copper_ore'].includes(oreId) ? randomInt(1, 3) : randomInt(2, 5);
    const bonus = Math.random() < 0.35 ? getBonusOre(oreId) : null;
    const expGain = ore.exp;

    let trx;
    try {
        trx = await db.startTransaction();
        await ItemManager.addItem(trx, user.id, oreId, rewardAmount);

        if (bonus) {
            await ItemManager.addItem(trx, user.id, bonus.id, bonus.amount);
        }

        const mastery = await addMiningExp(trx, user.id, expGain);
        await trx.commit();

        const lines = [`${rewardAmount}x ${ore.name}`];
        if (bonus) lines.push(`${bonus.amount}x ${getOreDetails(bonus.id).name}`);

        const embed = successEmbed('Ore Collected', lines.join('\n'), user)
            .setColor(colors.craft)
            .addFields(
                { name: 'Mining EXP', value: `+${expGain} EXP`, inline: true },
                { name: 'Mastery', value: progressBar(mastery.exp, mastery.requiredExp, 8), inline: true }
            );
        if (mastery.leveledUp) embed.addFields({ name: 'Level Up', value: `Mining mastery reached Lv. ${mastery.level}.`, inline: false });

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

async function addMiningExp(trx, userId, gain) {
    const rows = await trx.query('SELECT mining_level, mining_exp FROM users WHERE user_id = ? FOR UPDATE', [userId]);
    let level = Number(rows[0]?.mining_level || 1);
    let exp = Number(rows[0]?.mining_exp || 0) + gain;
    let requiredExp = getRequiredMiningExp(level);
    let leveledUp = false;

    while (exp >= requiredExp) {
        exp -= requiredExp;
        level++;
        leveledUp = true;
        requiredExp = getRequiredMiningExp(level);
    }

    await trx.query('UPDATE users SET mining_level = ?, mining_exp = ? WHERE user_id = ?', [level, exp, userId]);
    return { level, exp, requiredExp, leveledUp };
}

function getRequiredMiningExp(level) {
    return Math.floor(80 * Math.pow(level, 1.25));
}

function calculateDamage(pickType, miningLevel, state) {
    const base = pickType === 'gpick' ? randomInt(9, 16) : randomInt(4, 10);
    const masteryBonus = Math.floor(miningLevel / 2);
    const chargeBonus = state.charge * (pickType === 'gpick' ? 5 : 3);
    const scanBonus = state.scanned ? randomInt(5, 9) : 0;
    return base + masteryBonus + chargeBonus + scanBonus;
}

function buildOrePool(pickType, miningLevel) {
    if (pickType === 'gpick') return ['rock', 'coal', 'iron_ore', 'copper_ore', 'gold_ore', 'diamond_ore'];
    if (miningLevel >= 4) return ['rock', 'coal', 'iron_ore', 'copper_ore', 'gold_ore'];
    return ['rock', 'coal', 'iron_ore', 'copper_ore'];
}

function getBonusOre(oreId) {
    const id = oreId === 'rock' ? randomChoice(['coal', 'copper_ore']) : randomChoice(['rock', 'coal']);
    return { id, amount: randomInt(1, 2) };
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function getOreDetails(oreId) {
    const data = {
        rock: { name: 'Rock', rarity: 'Common', minHp: 10, maxHp: 25, exp: 10 },
        coal: { name: 'Coal Ore', rarity: 'Common', minHp: 20, maxHp: 30, exp: 15 },
        copper_ore: { name: 'Copper Ore', rarity: 'Uncommon', minHp: 15, maxHp: 27, exp: 20 },
        iron_ore: { name: 'Iron Ore', rarity: 'Rare', minHp: 30, maxHp: 40, exp: 35 },
        gold_ore: { name: 'Gold Ore', rarity: 'Epic', minHp: 40, maxHp: 55, exp: 55 },
        diamond_ore: { name: 'Diamond Ore', rarity: 'Legendary', minHp: 55, maxHp: 75, exp: 90 }
    };

    return data[oreId] || data.rock;
}
