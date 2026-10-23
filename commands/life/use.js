const { SlashCommandBuilder } = require('discord.js');
const { autocompleteInventoryByTags, handleConsumptionCommand } = require('../../services/consumptionService');

module.exports = {
    name: 'use',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('use')
        .setDescription('Gunakan obat, vitamin, surat izin melaut, akta ganti nama, atau gelar prestise.')
        .addStringOption(opt =>
            opt
                .setName('item')
                .setDescription('Pilih item dari isi tasmu')
                .setAutocomplete(true)
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt
                .setName('amount')
                .setDescription('Jumlah yang ingin digunakan (default 1)')
                .setMinValue(1)
                .setMaxValue(20)
                .setRequired(false)
        ),

    async autocomplete(interaction) {
        await autocompleteInventoryByTags(interaction, ['medicine', 'license', 'service', 'prestise']);
    },

    async executeSlash(interaction) {
        await handleConsumptionCommand(interaction, 'use');
    }
};
