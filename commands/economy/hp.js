const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType } = require('discord.js');
const db = require('../../botHandlers/mysqlHandler');
const { infoEmbed, formatMoney, formatPercent, colors } = require('../../utils/ui');
const { send, edit, sendError } = require('../../utils/respond');

module.exports = {
    name: 'phone',
    aliases: ['hp', 'smartphone', 'gadget'],
    prefix: true,
    slash: true,
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('phone')
        .setDescription('Open your smartphone menu.'),

    async executeSlash(interaction) {
        await handlePhone(interaction, interaction.user);
    },

    async executePrefix(message) {
        await handlePhone(message, message.author);
    }
};

async function handlePhone(context, user) {
    try {
        const inventory = await db.query('SELECT amount FROM inventory WHERE user_id = ? AND item_id = "smartphone"', [user.id]);
        if (!inventory || inventory.length === 0 || inventory[0].amount < 1) {
            return sendError(context, user, 'You need a smartphone item before opening this menu.');
        }

        const row = createPhoneMenu(user.id);
        const homeEmbed = createHomeEmbed(user);
        const response = await send(context, { embeds: [homeEmbed], components: [row], fetchReply: true });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 60000
        });

        collector.on('collect', async (interaction) => {
            if (interaction.user.id !== user.id) {
                await interaction.reply({ content: 'This smartphone session belongs to another player.', ephemeral: true }).catch(() => {});
                return;
            }

            const selected = interaction.values[0];
            try {
                if (selected === 'app_home') {
                    await interaction.update({ embeds: [homeEmbed], components: [row] });
                } else if (selected === 'app_bank') {
                    const rows = await db.query('SELECT cash, bank FROM users WHERE user_id = ?', [user.id]);
                    const data = rows[0];
                    const embed = infoEmbed('Mobile Banking', null, user)
                        .setColor(colors.money)
                        .addFields(
                            { name: 'Cash', value: formatMoney(data.cash), inline: true },
                            { name: 'Bank', value: formatMoney(data.bank), inline: true },
                            { name: 'Total', value: formatMoney(Number(data.cash) + Number(data.bank)), inline: true }
                        )
                        .setFooter({ text: 'Use /bank for transactions.' });
                    await interaction.update({ embeds: [embed], components: [row] });
                } else if (selected === 'app_profile') {
                    const rows = await db.query(`
                        SELECT u.*, j.name as job_name
                        FROM users u
                        LEFT JOIN jobs j ON u.job_id = j.id
                        WHERE u.user_id = ?
                    `, [user.id]);
                    const data = rows[0];
                    const embed = infoEmbed('Citizen Profile', null, user)
                        .setColor(colors.primary)
                        .addFields(
                            { name: 'Job', value: data.job_name || 'Unemployed', inline: true },
                            { name: 'Level', value: `Lv. ${data.level}`, inline: true },
                            { name: 'SP', value: `${data.skill_points} SP`, inline: true },
                            { name: 'Energy', value: formatPercent(data.energy), inline: true },
                            { name: 'Hunger', value: formatPercent(data.hunger), inline: true }
                        );
                    await interaction.update({ embeds: [embed], components: [row] });
                } else if (selected === 'app_close') {
                    await interaction.deferUpdate();
                    collector.stop('closed');
                }
            } catch (error) {
                console.error('[PHONE APP ERROR]', error);
                await interaction.reply({ content: 'Could not load that app.', ephemeral: true }).catch(() => {});
            }
        });

        collector.on('end', async () => {
            const offEmbed = infoEmbed('Smartphone Closed', 'The session has ended.', user)
                .setColor(colors.muted);
            await edit(context, response, { embeds: [offEmbed], components: [] }).catch(() => {});
        });
    } catch (error) {
        console.error('[PHONE ERROR]', error);
        return sendError(context, user, 'Could not open the smartphone.');
    }
}

function createPhoneMenu(userId) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`phone_apps:${userId}`)
        .setPlaceholder('Choose an app')
        .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('Home').setDescription('Return to the home screen.').setValue('app_home').setEmoji('📱'),
            new StringSelectMenuOptionBuilder().setLabel('Banking').setDescription('View cash and bank balance.').setValue('app_bank').setEmoji('🏦'),
            new StringSelectMenuOptionBuilder().setLabel('Profile').setDescription('View character status.').setValue('app_profile').setEmoji('👤'),
            new StringSelectMenuOptionBuilder().setLabel('Power Off').setDescription('Close the smartphone.').setValue('app_close').setEmoji('❌')
        );

    return new ActionRowBuilder().addComponents(menu);
}

function createHomeEmbed(user) {
    return infoEmbed('Smartphone', `System time: <t:${Math.floor(Date.now() / 1000)}:f>`, user)
        .setColor(colors.muted)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: 'Signal', value: 'LTE ▮▮▮▯', inline: true },
            { name: 'Battery', value: '85%', inline: true }
        )
        .setFooter({ text: 'Session expires in 60 seconds.' });
}
