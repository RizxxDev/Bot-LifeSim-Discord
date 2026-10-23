const { SlashCommandBuilder } = require('discord.js');
const { autocompleteInventoryByTags, handleConsumptionCommand } = require('../../services/consumptionService');

module.exports = {
    name: 'eat',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('eat')
        .setDescription('Makan item makanan (atau ikan segar) dari tas untuk memulihkan Hunger.')
        .addStringOption(opt =>
            opt
                .setName('item')
                .setDescription('Pilih makanan dari isi tasmu')
                .setAutocomplete(true)
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt
                .setName('amount')
                .setDescription('Jumlah yang ingin dimakan (otomatis berhenti saat Hunger 100)')
                .setMinValue(1)
                .setMaxValue(20)
                .setRequired(false)
        ),

    async autocomplete(interaction) {
        await autocompleteInventoryByTags(interaction, ['food']);
    },

    async executeSlash(interaction) {
        await handleConsumptionCommand(interaction, 'eat');
    }
};
