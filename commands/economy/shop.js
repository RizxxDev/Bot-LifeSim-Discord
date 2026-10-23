const { SlashCommandBuilder } = require('discord.js');
const { SHOPS } = require('../../data/items');
const { buildShopViewPayload } = require('../../services/shopService');

module.exports = {
    name: 'shop',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Buka katalog interaktif Toko Kota (Warung, Restoran, Apotek, Perkakas, Elektronik, dll).')
        .addStringOption(opt =>
            opt
                .setName('toko')
                .setDescription('Pilih toko yang ingin langsung dibuka')
                .setRequired(false)
                .addChoices(
                    ...SHOPS.map(s => ({ name: `${s.emoji} ${s.name}`, value: s.id }))
                )
        ),

    async executeSlash(interaction) {
        const shopId = interaction.options.getString('toko') || 'warung';
        const payload = await buildShopViewPayload(interaction.user.id, shopId, 0, false);
        return await interaction.reply(payload);
    }
};
