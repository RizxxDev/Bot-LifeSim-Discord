const { SlashCommandBuilder } = require('discord.js');
const { autocompleteInventoryByTags, handleConsumptionCommand } = require('../../services/consumptionService');

module.exports = {
    name: 'drink',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('drink')
        .setDescription('Minum dari tas untuk memulihkan Thirst (dan Energy untuk kopi/minuman energi).')
        .addStringOption(opt =>
            opt
                .setName('item')
                .setDescription('Pilih minuman dari isi tasmu')
                .setAutocomplete(true)
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt
                .setName('amount')
                .setDescription('Jumlah yang ingin diminum (otomatis berhenti saat Thirst 100)')
                .setMinValue(1)
                .setMaxValue(20)
                .setRequired(false)
        ),

    async autocomplete(interaction) {
        await autocompleteInventoryByTags(interaction, ['drink']);
    },

    async executeSlash(interaction) {
        await handleConsumptionCommand(interaction, 'drink');
    }
};
