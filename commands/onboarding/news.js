const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getDailyNewsEdition } = require('../../services/newsService');
const { COLORS, formatLp } = require('../../utils/uiBuilder');
const { buildPanel, btn } = require('../../utils/panelBuilder');

async function fetchNewsState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const edition = await getDailyNewsEdition(conn, now);
        return {
            player: synced.player,
            edition
        };
    });
}

function buildNewsPanel({ state, now = Date.now() }) {
    const { player: p, edition } = state;
    const ownerId = p.discord_id;

    const hotLines = (edition.hotItems || []).map(entry =>
        `• ${entry.item.emoji} **${entry.item.name}** — Harga dasar naik menjadi **${formatLp(entry.bonusSellPrice)}** *(+15% di \`/sell\`)*`
    );

    const weatherNextUnix = Math.floor(Number(edition.currentWeather.nextChangeAt || now) / 1000);
    const highlightsText = (edition.highlights && edition.highlights.length > 0)
        ? edition.highlights.join('\n')
        : '• *Belum ada kabar warga terbaru pagi ini. Jadilah pelopor berita dengan beraktivitas di kota!*';

    const blocks = [
        `🗞️ **Edisi ${edition.dateKey} WIB** — *${edition.headline}*\n⏰ Edisi baru terbit **<t:${edition.nextResetUnix}:R>** *(00:00 WIB)*`,
        [
            `**📈 KOMODITAS SEDANG DICARI (+15% Harga Jual di \`/sell\`):**`,
            hotLines.length > 0 ? hotLines.join('\n') : '• *Tidak ada sorotan hari ini.*'
        ].join('\n'),
        [
            `**🏷️ DISKON TOKO HARIAN (-15% di \`/shop\`):**`,
            `• ${edition.discountShop.emoji} **${edition.discountShop.name}** — Diskon **-15%** sepanjang hari ini!`,
            `  -# Catatan: Kebutuhan pokok bersubsidi Warung (lockedPrice) tetap mengikuti harga resmi tetap.`
        ].join('\n'),
        [
            `**🌦️ PRAKIRAAN CUACA KOTA (Siklus 14 Hari):**`,
            `• Aktif sekarang: ${edition.currentWeather.emoji} **${edition.currentWeather.name}** *(Berganti <t:${weatherNextUnix}:R>)*`,
            `• Perkiraan fase berikut: ${edition.nextWeather.emoji} **${edition.nextWeather.name}**`,
            `  -# ${edition.currentWeather.description}`
        ].join('\n'),
        [
            `**📣 KILAS BERITA WARGA TERBARU:**`,
            highlightsText
        ].join('\n')
    ];

    const row = new ActionRowBuilder().addComponents(
        btn('sell', 'home', ownerId, {
            label: 'Jual Komoditas (/sell)',
            emoji: '💰',
            style: ButtonStyle.Success
        }, now),
        btn('shop', 'page', ownerId, {
            label: `Buka ${edition.discountShop.name.split(' ')[0]} (-15%)`,
            emoji: edition.discountShop.emoji,
            style: ButtonStyle.Primary,
            arg: `${edition.discountShop.id}:1`
        }, now)
    );

    return buildPanel({
        mod: 'news',
        ownerId,
        accentColor: COLORS.PRIMARY,
        title: '📰 Harian Suara Nusantara (/news)',
        player: p,
        blocks,
        rows: [row],
        footer: 'Sorotan komoditas & diskon toko berganti otomatis tiap 00:00 WIB.',
        now
    });
}

module.exports = {
    name: 'news',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('news')
        .setDescription('Baca Koran Pagi Kota: tren komoditas +15%, diskon toko harian -15%, cuaca & kabar warga.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchNewsState(interaction.user.id, now);
        return await interaction.reply(buildNewsPanel({ state, now }));
    },

    panel: {
        buttons: {
            async home(interaction) {
                const now = Date.now();
                const state = await fetchNewsState(interaction.user.id, now);
                return await interaction.update({ ...buildNewsPanel({ state, now }), attachments: [] });
            }
        }
    },

    fetchNewsState,
    buildNewsPanel
};
