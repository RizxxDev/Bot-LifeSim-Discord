const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder
} = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getUnlockedTitles } = require('../../services/achievementService');
const { COLORS, buildV2Card } = require('../../utils/uiBuilder');

module.exports = {
    name: 'title',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('title')
        .setDescription('Kelola dan pasang Gelar Kehormatan (Title) pada profil warga kotamu.')
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('Lihat seluruh daftar gelar (Title) yang telah kamu buka.')
        )
        .addSubcommand(sub =>
            sub
                .setName('equip')
                .setDescription('Pasang salah satu gelar yang telah kamu buka ke profilmu.')
                .addStringOption(opt =>
                    opt
                        .setName('gelar')
                        .setDescription('Pilih atau ketik nama gelar yang ingin dipasang')
                        .setRequired(true)
                        .setAutocomplete(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('unequip')
                .setDescription('Lepas gelar yang sedang terpasang di profilmu.')
        ),

    async autocomplete(interaction) {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        try {
            const titles = await withTransaction(async (conn) => {
                const synced = await syncPlayerVitals(conn, interaction.user.id, Date.now(), false);
                return await getUnlockedTitles(conn, synced.player, Date.now());
            });

            const filtered = titles.filter(
                t => !focused || `${t.title} ${t.source}`.toLowerCase().includes(focused)
            );
            await interaction.respond(
                filtered.slice(0, 25).map(t => ({
                    name: `${t.title} (${t.source})`.slice(0, 100),
                    value: t.title
                }))
            );
        } catch {
            await interaction.respond([]);
        }
    },

    async executeSlash(interaction) {
        const sub = interaction.options.getSubcommand();
        const discordId = interaction.user.id;
        const now = Date.now();

        if (sub === 'unequip') {
            const player = await withTransaction(async (conn) => {
                const synced = await syncPlayerVitals(conn, discordId, now, true);
                await conn.execute(
                    `UPDATE players SET equipped_title = NULL WHERE discord_id = ?`,
                    [discordId]
                );
                synced.player.equipped_title = null;
                return synced.player;
            });

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.PRIMARY,
                    title: '🏷️ Gelar Dilepas',
                    blocks: [
                        `Gelar kehormatan pada profil **${player.username}** telah dilepas.`,
                        'Gunakan `/title list` atau `/title equip` kapan saja untuk memasang gelar kembali.'
                    ]
                })
            );
        }

        if (sub === 'equip') {
            const inputTitle = interaction.options.getString('gelar', true).trim();
            const res = await withTransaction(async (conn) => {
                const synced = await syncPlayerVitals(conn, discordId, now, true);
                const unlocked = await getUnlockedTitles(conn, synced.player, now);
                const matched = unlocked.find(
                    t => t.title.toLowerCase() === inputTitle.toLowerCase() ||
                         t.id.toLowerCase() === inputTitle.toLowerCase() ||
                         t.title.toLowerCase().includes(inputTitle.toLowerCase())
                );

                if (!matched) {
                    return { error: 'NOT_UNLOCKED', unlocked };
                }

                await conn.execute(
                    `UPDATE players SET equipped_title = ? WHERE discord_id = ?`,
                    [matched.title, discordId]
                );
                synced.player.equipped_title = matched.title;
                return { matched, player: synced.player };
            });

            if (res.error === 'NOT_UNLOCKED') {
                return await interaction.reply(
                    buildV2Card({
                        accentColor: COLORS.WARNING,
                        title: '🔒 Gelar Belum Terbuka',
                        blocks: [
                            `Kamu belum membuka gelar **"${inputTitle}"**.`,
                            'Cek daftar gelar yang sudah kamu miliki lewat `/title list` atau selesaikan tantangan di `/achievements`!'
                        ],
                        ephemeral: true
                    })
                );
            }

            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.SUCCESS,
                    title: '✨ Gelar Kehormatan Dipasang!',
                    blocks: [
                        `Profil **${res.player.username}** kini menyandang gelar **${res.matched.title}**!`,
                        `• 📌 **Sumber Gelar:** ${res.matched.source}`
                    ],
                    footer: 'Gelar ini tampil secara publik pada kartu /profile kamu.'
                })
            );
        }

        // Subcommand: list
        const data = await withTransaction(async (conn) => {
            const synced = await syncPlayerVitals(conn, discordId, now, false);
            const unlocked = await getUnlockedTitles(conn, synced.player, now);
            return { player: synced.player, unlocked };
        });

        if (data.unlocked.length === 0) {
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.PRIMARY,
                    title: '🏷️ Koleksi Gelar Kehormatan (0 Terbuka)',
                    blocks: [
                        'Kamu belum memiliki gelar kehormatan yang terbuka saat ini.',
                        '💡 **Cara Membuka Gelar:**\n• Selesaikan pencapaian di `/achievements view`\n• Tukarkan token di `/event shop` saat event berlangsung\n• Beli item Prestise di Toko Perkakas/Layanan (`/shop`)'
                    ]
                })
            );
        }

        const listLines = data.unlocked.map((t, idx) => {
            const isEquipped = data.player.equipped_title === t.title;
            return `${idx + 1}. **${t.title}** — *${t.source}*${isEquipped ? ' ✅ *(Terpasang)*' : ''}`;
        });

        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`title_eq_${discordId}`)
                .setPlaceholder('Pilih gelar untuk langsung dipasang...')
                .addOptions(
                    data.unlocked.slice(0, 25).map(t => ({
                        label: t.title.slice(0, 100),
                        description: t.source.slice(0, 100),
                        value: t.title,
                        default: data.player.equipped_title === t.title
                    }))
                )
        );

        await interaction.reply(
            buildV2Card({
                accentColor: COLORS.PRIMARY,
                title: `🏷️ Koleksi Gelar ${data.player.username} (${data.unlocked.length} Terbuka)`,
                blocks: [
                    `🎖️ **Gelar Aktif Saat Ini:** ${data.player.equipped_title ? `**${data.player.equipped_title}**` : '*Belum ada gelar terpasang*'}`,
                    listLines.join('\n')
                ],
                actionRows: [selectRow],
                footer: 'Pilih gelar dari menu di bawah atau gunakan /title equip.'
            })
        );
        const replyMsg = await interaction.fetchReply();

        const collector = replyMsg.createMessageComponentCollector({
            filter: i => i.user.id === discordId && i.customId === `title_eq_${discordId}`,
            time: 60000
        });

        collector.on('collect', async (i) => {
            try {
                const chosenTitle = i.values[0];
                await withTransaction(async (conn) => {
                    await conn.execute(
                        `UPDATE players SET equipped_title = ? WHERE discord_id = ?`,
                        [chosenTitle, discordId]
                    );
                });
                await i.update(
                    buildV2Card({
                        accentColor: COLORS.SUCCESS,
                        title: `✨ Gelar Dipasang: ${chosenTitle}`,
                        blocks: [
                            `🎖️ **Gelar Aktif Saat Ini:** **${chosenTitle}**`,
                            listLines.map(line => line.replace(' ✅ *(Terpasang)*', '')).join('\n')
                        ],
                        footer: 'Gelar berhasil diperbarui! Cek tampilan barumu di /profile.'
                    })
                );
            } catch {
                // Abaikan bila kadaluarsa
            }
        });
    }
};
