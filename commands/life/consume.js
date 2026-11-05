const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerInventory, removeItem } = require('../../services/inventoryService');
const {
    groupBagConsumables,
    executeItemConsumption
} = require('../../services/consumptionService');
const { getItem } = require('../../data/items');
const { COLORS, validateUsername } = require('../../utils/uiBuilder');
const { makeId } = require('../../utils/panelId');
const {
    buildPanel,
    btn,
    select,
    quantityRow,
    numberModal,
    parseModalNumber,
    respondOrUpdate
} = require('../../utils/panelBuilder');

const TAB_LABELS = {
    food: '🍔 Makanan',
    drink: '💧 Minuman',
    use: '💊 Obat & Dokumen'
};

function buildConsumePanel({
    player,
    invRows = [],
    tab = 'food',
    selectedItemId = null,
    banner = null,
    now = Date.now()
}) {
    const ownerId = player.discord_id;
    const grouped = groupBagConsumables(invRows, tab);

    let activeEntry = grouped.find(g => g.item.id === selectedItemId) || grouped[0] || null;
    const activeItemId = activeEntry ? activeEntry.item.id : null;

    // Baris 1: Tab Kategori
    const tabRow = new ActionRowBuilder().addComponents(
        btn('consume', 'tab', ownerId, {
            label: 'Makanan',
            emoji: '🍔',
            style: tab === 'food' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: 'food'
        }, now),
        btn('consume', 'tab', ownerId, {
            label: 'Minuman',
            emoji: '💧',
            style: tab === 'drink' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: 'drink'
        }, now),
        btn('consume', 'tab', ownerId, {
            label: 'Obat & Dokumen',
            emoji: '💊',
            style: tab === 'use' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: 'use'
        }, now)
    );

    const blocks = [];
    const rows = [tabRow];

    if (grouped.length === 0) {
        blocks.push(
            `📂 **Kategori: ${TAB_LABELS[tab] || TAB_LABELS.food}**\nKamu belum memiliki item di kategori ini dalam tasmu.\n💡 *Kunjungi \`/shop\` atau masak hidangan di \`/cook\` untuk mengisi perbekalan!*`
        );
    } else {
        const listLines = grouped.slice(0, 12).map(entry => {
            const isSel = entry.item.id === activeItemId;
            const pointer = isSel ? '▶️ ' : '• ';
            const freshText = entry.freshnessBadge ? ` · *(${entry.freshnessBadge})*` : '';
            return `${pointer}${entry.item.emoji} **${entry.item.name}** \`×${entry.totalQty}\` — ${entry.effectSummary}${freshText}`;
        });
        if (grouped.length > 12) {
            listLines.push(`*...dan ${grouped.length - 12} item lainnya di dropdown.*`);
        }

        blocks.push(
            `📂 **Kategori: ${TAB_LABELS[tab] || TAB_LABELS.food}**\n${listLines.join('\n')}`
        );

        // Baris 2: Dropdown pilih item
        const options = grouped.map(entry => ({
            label: `${entry.item.name} (×${entry.totalQty})`,
            value: `${tab}:${entry.item.id}`,
            description: `${entry.effectSummary}${entry.freshnessBadge ? ` | ${entry.freshnessBadge}` : ''}`,
            emoji: entry.item.emoji,
            default: entry.item.id === activeItemId
        }));

        rows.push(
            select('consume', 'pick', ownerId, {
                placeholder: 'Pilih item yang ingin dikonsumsi / digunakan...',
                options
            }, now)
        );

        // Baris 3: Tombol aksi sesuai jenis item terpilih
        if (activeEntry) {
            const it = activeEntry.item;
            if (it.id === 'surat_ganti_nama') {
                rows.push(
                    new ActionRowBuilder().addComponents(
                        btn('consume', 'open_rename', ownerId, {
                            label: 'Gunakan Akta Ganti Nama',
                            emoji: '📜',
                            style: ButtonStyle.Primary
                        }, now)
                    )
                );
            } else if (it.tags && it.tags.includes('prestise') && it.titleLabel) {
                rows.push(
                    new ActionRowBuilder().addComponents(
                        btn('consume', 'exec', ownerId, {
                            label: `Pasang Gelar: ${it.titleLabel}`,
                            emoji: '👑',
                            style: ButtonStyle.Success,
                            arg: `${tab}:${it.id}:1`
                        }, now)
                    )
                );
            } else if (it.id === 'sim_c' || it.id === 'sim_a' || it.id === 'laptop' || it.id === 'surat_izin_melaut') {
                blocks.push(`ℹ️ **${it.emoji} ${it.name}** bersifat **pasif** — otomatis aktif selama berada di dalam tasmu.`);
            } else {
                rows.push(
                    quantityRow('consume', 'exec', ownerId, {
                        presets: [1, 3, 5],
                        maxLabel: tab === 'use' && it.id === 'gas_lpg' ? 'Semua' : 'Penuh',
                        argPrefix: `${tab}:${it.id}`,
                        customAction: 'qty_modal',
                        disableMulti: activeEntry.totalQty <= 1
                    }, now)
                );
            }
        }
    }

    return buildPanel({
        mod: 'consume',
        ownerId,
        accentColor: COLORS.LIFE,
        title: `🍽️ Konsumsi & Penggunaan Item`,
        player,
        banner,
        blocks,
        rows,
        footer: 'Konsumsi otomatis berhenti saat stat vital mencapai 100 agar item tidak terbuang sia-sia.',
        now
    });
}

function formatConsumptionBanner(res) {
    if (!res.ok) {
        if (res.error === 'NOT_OWNED') {
            return { type: 'warning', text: 'Persediaan item tersebut di tasmu sudah habis.' };
        }
        if (res.error === 'PASSIVE_ITEM') {
            return { type: 'info', text: 'Item ini bersifat pasif dan otomatis aktif selama ada di tasmu.' };
        }
        if (res.error === 'ALREADY_FULL') {
            return { type: 'info', text: 'Kondisi stat targetmu sudah penuh (100)! Item tidak jadi dikonsumsi agar tidak terbuang.' };
        }
        return { type: 'danger', text: 'Item tidak dapat digunakan.' };
    }

    if (res.equippedTitle) {
        return {
            type: 'success',
            text: `👑 Gelar **${res.equippedTitle}** berhasil dipasang dan tampil di \`/profile\`!`
        };
    }

    if (res.lpgRefilled) {
        return {
            type: 'success',
            text: `🔥 Berhasil memasang **${res.usedCount}× Tabung Gas LPG** (**+${res.addedCharges}x masak**, total cadangan: **${res.totalCharges}x masak**).`
        };
    }

    const gainParts = [];
    if (res.totalGain.hunger > 0) gainParts.push(`🍔+${Math.round(res.totalGain.hunger)}`);
    if (res.totalGain.thirst > 0) gainParts.push(`💧+${Math.round(res.totalGain.thirst)}`);
    if (res.totalGain.energy > 0) gainParts.push(`⚡+${Math.round(res.totalGain.energy)}`);
    if (res.totalGain.health > 0) gainParts.push(`❤️+${Math.round(res.totalGain.health)}`);
    if (res.appliedBuff) gainParts.push(`✨Buff: ${res.appliedBuff.label}`);

    let msg = `Mengonsumsi **${res.usedCount}× ${res.item.emoji} ${res.item.name}** (${gainParts.join(' · ') || 'Efek diterapkan'}).`;
    if (res.caffeineReducedCount > 0) {
        msg += ` *(☕ Toleransi kafein harian aktif)*`;
    }
    if (res.buffSkippedStronger) {
        msg += ` *(ℹ️ Buff restoran yang lebih kuat tetap dipertahankan)*`;
    }
    return { type: 'success', text: msg };
}

async function fetchConsumeState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        return { player: synced.player, invRows };
    });
}

module.exports = {
    name: 'consume',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('consume')
        .setDescription('Makan, minum, atau gunakan obat, gas LPG, akta ganti nama, dan gelar dari tasmu.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchConsumeState(interaction.user.id, now);
        return await interaction.reply(
            buildConsumePanel({
                player: state.player,
                invRows: state.invRows,
                tab: 'food',
                now
            })
        );
    },

    panel: {
        buttons: {
            async tab(interaction, parsed) {
                const now = Date.now();
                const tab = parsed.arg || 'food';
                const state = await fetchConsumeState(interaction.user.id, now);
                return await interaction.update(
                    buildConsumePanel({
                        player: state.player,
                        invRows: state.invRows,
                        tab,
                        now
                    })
                );
            },
            async exec(interaction, parsed) {
                const now = Date.now();
                const [tab = 'food', itemId = '', rawQty = '1'] = (parsed.arg || '').split(':');
                const reqAmount = rawQty === 'max' ? 'max' : Number(rawQty) || 1;

                const res = await executeItemConsumption(interaction.user.id, itemId, reqAmount, now);
                const banner = formatConsumptionBanner(res);

                return await interaction.update(
                    buildConsumePanel({
                        player: res.player,
                        invRows: res.invRows,
                        tab,
                        selectedItemId: itemId,
                        banner,
                        now
                    })
                );
            },
            async qty_modal(interaction, parsed) {
                const now = Date.now();
                const [tab = 'food', itemId = ''] = (parsed.arg || '').split(':');
                const item = getItem(itemId);
                return await interaction.showModal(
                    numberModal('consume', 'qty_submit', interaction.user.id, {
                        title: `Konsumsi ${item ? item.name : 'Item'}`,
                        label: 'Jumlah yang ingin digunakan (1 - 20)',
                        placeholder: 'Contoh: 3',
                        arg: `${tab}:${itemId}`
                    }, now)
                );
            },
            async open_rename(interaction) {
                const now = Date.now();
                const modal = new ModalBuilder()
                    .setCustomId(makeId('consume', 'rename_submit', interaction.user.id, 'use', now))
                    .setTitle('Ganti Nama Karakter Resmi');

                const usernameInput = new TextInputBuilder()
                    .setCustomId('username_input')
                    .setLabel('Nama / Username Baru (3-16 karakter)')
                    .setPlaceholder('Contoh: Budi_Santoso99 (huruf, angka, underscore)')
                    .setMinLength(3)
                    .setMaxLength(16)
                    .setRequired(true)
                    .setStyle(TextInputStyle.Short);

                modal.addComponents(new ActionRowBuilder().addComponents(usernameInput));
                return await interaction.showModal(modal);
            }
        },
        selects: {
            async pick(interaction) {
                const now = Date.now();
                const val = interaction.values[0] || '';
                const [tab = 'food', itemId = ''] = val.split(':');
                const state = await fetchConsumeState(interaction.user.id, now);
                return await interaction.update(
                    buildConsumePanel({
                        player: state.player,
                        invRows: state.invRows,
                        tab,
                        selectedItemId: itemId,
                        now
                    })
                );
            }
        },
        modals: {
            async qty_submit(interaction, parsed) {
                const now = Date.now();
                const [tab = 'food', itemId = ''] = (parsed.arg || '').split(':');
                const parsedNum = parseModalNumber(interaction, { min: 1, max: 20 });

                if (!parsedNum.ok) {
                    const state = await fetchConsumeState(interaction.user.id, now);
                    const payload = buildConsumePanel({
                        player: state.player,
                        invRows: state.invRows,
                        tab,
                        selectedItemId: itemId,
                        banner: { type: 'warning', text: parsedNum.error },
                        now
                    });
                    return await respondOrUpdate(interaction, payload);
                }

                const res = await executeItemConsumption(interaction.user.id, itemId, parsedNum.value, now);
                const banner = formatConsumptionBanner(res);
                const payload = buildConsumePanel({
                    player: res.player,
                    invRows: res.invRows,
                    tab,
                    selectedItemId: itemId,
                    banner,
                    now
                });
                return await respondOrUpdate(interaction, payload);
            },
            async rename_submit(interaction) {
                const now = Date.now();
                const userId = interaction.user.id;
                const rawName = interaction.fields.getTextInputValue('username_input');
                const val = validateUsername(rawName);

                if (!val.valid) {
                    const state = await fetchConsumeState(userId, now);
                    const payload = buildConsumePanel({
                        player: state.player,
                        invRows: state.invRows,
                        tab: 'use',
                        selectedItemId: 'surat_ganti_nama',
                        banner: { type: 'warning', text: val.reason },
                        now
                    });
                    return await respondOrUpdate(interaction, payload);
                }

                let banner = null;
                try {
                    await withTransaction(async (conn) => {
                        const [dup] = await conn.execute(
                            `SELECT discord_id FROM players WHERE username_lower = ? AND discord_id != ? LIMIT 1`,
                            [val.usernameLower, userId]
                        );
                        if (dup.length > 0) {
                            throw new Error('USERNAME_TAKEN');
                        }
                        const consumed = await removeItem(conn, userId, 'surat_ganti_nama', 1, 'bag');
                        if (!consumed) {
                            throw new Error('NO_RENAME_ITEM');
                        }
                        await conn.execute(
                            `UPDATE players SET username = ?, username_lower = ? WHERE discord_id = ?`,
                            [val.username, val.usernameLower, userId]
                        );
                    });
                    banner = {
                        type: 'success',
                        text: `📜 Perubahan nama resmi disetujui! Identitasmu kini berganti menjadi **${val.username}**.`
                    };
                } catch (err) {
                    if (err.message === 'USERNAME_TAKEN' || err.code === 'ER_DUP_ENTRY') {
                        banner = { type: 'danger', text: `Username **\`${val.username}\`** sudah digunakan warga lain!` };
                    } else if (err.message === 'NO_RENAME_ITEM') {
                        banner = { type: 'danger', text: 'Kamu tidak memiliki **📜 Akta Ganti Nama Resmi** di tasmu.' };
                    } else {
                        throw err;
                    }
                }

                const state = await fetchConsumeState(userId, now);
                const payload = buildConsumePanel({
                    player: state.player,
                    invRows: state.invRows,
                    tab: 'use',
                    banner,
                    now
                });
                return await respondOrUpdate(interaction, payload);
            }
        }
    },

    buildConsumePanel
};
