const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const {
    buildAvatarAttachment,
    getPlayerWardrobeState,
    setEquippedClothingSlot
} = require('../../services/avatarService');
const { fetchShopState, buildShopPanel } = require('../../services/shopService');
const {
    CLOTHING_SLOTS,
    getClothing,
    getClothingSlot,
    getClothesBySlot
} = require('../../data/clothes');
const { COLORS } = require('../../utils/uiBuilder');
const { buildPanel, btn, select } = require('../../utils/panelBuilder');

const RARITY_LABELS = {
    common: 'Common',
    uncommon: 'Uncommon',
    rare: 'Rare',
    epic: 'Epic',
    legendary: 'Legendary'
};

const DISPLAY_SLOT_ORDER = ['body', 'hair', 'hat', 'top', 'bottom', 'shoes', 'accessory'];

async function fetchWardrobePanelData(discordId, now = Date.now()) {
    const dbData = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        if (!synced) return null;
        const wardrobe = await getPlayerWardrobeState(conn, discordId, false);
        return {
            player: synced.player,
            wardrobe
        };
    });

    if (!dbData) return null;
    const avatar = await buildAvatarAttachment(dbData.wardrobe.equipped);
    return {
        player: dbData.player,
        wardrobe: dbData.wardrobe,
        avatar
    };
}

function formatActiveBuffSummary(buffs) {
    if (!buffs || !Array.isArray(buffs.activeItems) || buffs.activeItems.length === 0) {
        return '✨ **Efek Busana Aktif:** *Tidak ada (Busana kasual murni kosmetik)*';
    }

    const parts = [];
    if (buffs.workSalaryBonus > 0) {
        parts.push(`💼 +${Math.round(buffs.workSalaryBonus * 100)}% Gaji Umum`);
    }
    if (buffs.jobBonuses) {
        for (const [jId, bonus] of Object.entries(buffs.jobBonuses)) {
            if (bonus > 0) {
                parts.push(`🛵 +${Math.round(bonus * 100)}% Gaji ${jId.toUpperCase()}`);
            }
        }
    }
    if (buffs.fishingXpBonus > 0) {
        parts.push(`🎣 +${Math.round(buffs.fishingXpBonus * 100)}% EXP Fishing`);
    }
    if (buffs.farmingXpBonus > 0) {
        parts.push(`🌾 +${Math.round(buffs.farmingXpBonus * 100)}% EXP Farming`);
    }
    if (buffs.miningAccidentReduction > 0) {
        parts.push(`⛏️ -${Math.round(buffs.miningAccidentReduction * 100)}% Risiko Tambang`);
    }

    return `✨ **Efek Busana Aktif:** **${parts.join(' · ')}**`;
}

function buildWardrobePanel({ ownerId, state, selectedSlot = 'top', banner = null, now = Date.now() }) {
    const { player: p, wardrobe, avatar } = state;
    const slotMeta = getClothingSlot(selectedSlot) || getClothingSlot('top');
    const equipped = wardrobe.equipped;

    const slotLines = DISPLAY_SLOT_ORDER.map(sId => {
        const sMeta = getClothingSlot(sId);
        const cur = getClothing(equipped[sId]);
        const pointer = sId === slotMeta.id ? '▸ ' : '• ';
        if (!cur) {
            return `${pointer}${sMeta.emoji} **${sMeta.name}:** *Polos / Kosong*`;
        }
        const buffTag = cur.buffLabel ? ` *(${cur.buffLabel})*` : '';
        return `${pointer}${sMeta.emoji} **${sMeta.name}:** ${cur.emoji} **${cur.name}**${buffTag}`;
    });

    const outfitOverviewText = [
        '**🧍 Setelan Karakter Saat Ini:**',
        ...slotLines
    ].join('\n');

    const collectionAndBuffText = [
        `📦 **Koleksi Lemari:** **${wardrobe.ownedCount} / ${wardrobe.totalCatalogCount}** item terbuka`,
        formatActiveBuffSummary(wardrobe.buffs)
    ].join('\n');

    const allInSlot = getClothesBySlot(slotMeta.id);
    const ownedInSlot = allInSlot.filter(c => wardrobe.ownedSet.has(c.id));
    const currentInSlot = getClothing(equipped[slotMeta.id]);

    const slotDetailLines = [
        `**${slotMeta.emoji} Slot Dipilih: ${slotMeta.name}** *(Milikmu: ${ownedInSlot.length}/${allInSlot.length})*`,
        currentInSlot
            ? `Sedang dipakai: ${currentInSlot.emoji} **${currentInSlot.name}** — *${currentInSlot.description}*`
            : `Sedang dipakai: *Kosong / Polos* — Pilih busana dari menu di bawah untuk memakainya.`,
        `💡 *Tip: Dapatkan pakaian baru di **/shop** (kategori **👔 Butik & Distro Busana**) atau mesin kapsul **/gacha**!*`
    ].join('\n');

    // Row 1: Pilih Slot Tubuh / Pakaian
    const slotOptions = DISPLAY_SLOT_ORDER.map(sId => {
        const sMeta = getClothingSlot(sId);
        const allItems = getClothesBySlot(sId);
        const ownedCount = allItems.filter(c => wardrobe.ownedSet.has(c.id)).length;
        const cur = getClothing(equipped[sId]);
        return {
            label: sMeta.name,
            value: sMeta.id,
            emoji: sMeta.emoji,
            default: sMeta.id === slotMeta.id,
            description: `${cur ? `Dipakai: ${cur.name}` : 'Dipakai: Polos'} · Koleksi ${ownedCount}/${allItems.length}`
        };
    });

    const rowSelectSlot = select('wardrobe', 'slot', ownerId, {
        placeholder: '🗂️ Pilih bagian tubuh / slot pakaian...',
        options: slotOptions
    }, now);

    // Row 2: Pilih Pakaian di Slot Aktif
    const wearOptions = [];
    if (slotMeta.canUnequip && currentInSlot) {
        wearOptions.push({
            label: `Lepas ${slotMeta.name} (Tampil Polos)`,
            value: '_unequip_',
            emoji: '🚫',
            description: `Kosongkan slot ${slotMeta.name} dari avatar chibi kamu`
        });
    }

    for (const item of ownedInSlot) {
        const rLabel = RARITY_LABELS[item.rarity] || 'Common';
        wearOptions.push({
            label: item.name,
            value: item.id,
            emoji: item.emoji,
            default: equipped[slotMeta.id] === item.id,
            description: item.buffLabel
                ? `[${rLabel}] ✨ ${item.buffLabel}`
                : `[${rLabel}] ${item.description}`
        });
    }

    const rowSelectWear = select('wardrobe', 'wear', ownerId, {
        placeholder: ownedInSlot.length > 0
            ? `👕 Pilih ${slotMeta.name} untuk dikenakan...`
            : `🔒 Belum punya koleksi ${slotMeta.name} — beli di Butik Busana!`,
        options: wearOptions,
        arg: slotMeta.id,
        disabled: wearOptions.length === 0
    }, now);

    const hasAnyRemovableEquipped = ['hat', 'top', 'bottom', 'shoes', 'accessory']
        .some(sId => Boolean(equipped[sId]));

    // Row 3: Tombol Aksi Cepat
    const rowButtons = new ActionRowBuilder().addComponents(
        btn('wardrobe', 'unequip', ownerId, {
            label: 'Lepas Slot',
            emoji: '🚫',
            style: ButtonStyle.Secondary,
            arg: slotMeta.id,
            disabled: !slotMeta.canUnequip || !currentInSlot
        }, now),
        btn('wardrobe', 'strip_all', ownerId, {
            label: 'Mode Polos',
            emoji: '🧍',
            style: ButtonStyle.Secondary,
            arg: slotMeta.id,
            disabled: !hasAnyRemovableEquipped
        }, now),
        btn('wardrobe', 'open_butik', ownerId, {
            label: 'Butik Busana',
            emoji: '🛍️',
            style: ButtonStyle.Success
        }, now),
        btn('wardrobe', 'go_profile', ownerId, {
            label: 'Kartu Profil',
            emoji: '🪪',
            style: ButtonStyle.Primary
        }, now),
        btn('wardrobe', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary,
            arg: slotMeta.id
        }, now)
    );

    const topBlock = avatar
        ? {
            texts: [outfitOverviewText, collectionAndBuffText],
            thumbnail: {
                url: avatar.url,
                description: `Avatar Chibi ${p.username}`
            }
        }
        : [outfitOverviewText, collectionAndBuffText].join('\n\n');

    return buildPanel({
        mod: 'wardrobe',
        ownerId,
        accentColor: COLORS.LIFE,
        title: `👔 Lemari Pakaian & Avatar: ${p.username}`,
        player: p,
        banner,
        blocks: [
            topBlock,
            slotDetailLines
        ],
        rows: [rowSelectSlot, rowSelectWear, rowButtons],
        footer: 'Pakaian di Lemari bersifat permanen dan tidak memakan slot Tas (/inventory)',
        files: avatar ? [avatar.attachment] : undefined,
        now
    });
}

module.exports = {
    name: 'wardrobe',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('wardrobe')
        .setDescription('Kustomisasi avatar chibi, ganti pakaian per slot, dan lihat efek busana aktif.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchWardrobePanelData(interaction.user.id, now);
        return await interaction.reply(
            buildWardrobePanel({
                ownerId: interaction.user.id,
                state,
                selectedSlot: 'top',
                now
            })
        );
    },

    panel: {
        buttons: {
            async home(interaction, parsed) {
                const now = Date.now();
                const slotId = parsed.arg || 'top';
                const state = await fetchWardrobePanelData(interaction.user.id, now);
                return await interaction.update(
                    buildWardrobePanel({
                        ownerId: interaction.user.id,
                        state,
                        selectedSlot: slotId,
                        now
                    })
                );
            },

            async unequip(interaction, parsed) {
                const now = Date.now();
                const slotId = parsed.arg || 'top';
                const res = await withTransaction(async (conn) => {
                    return await setEquippedClothingSlot(conn, interaction.user.id, slotId, null, now);
                });

                const state = await fetchWardrobePanelData(interaction.user.id, now);
                const banner = res.ok
                    ? { type: 'info', text: `Slot **${res.slotMeta.emoji} ${res.slotMeta.name}** telah dilepas (Tampil Polos).` }
                    : { type: 'warning', text: 'Bagian dasar ini tidak dapat dilepas.' };

                return await interaction.update(
                    buildWardrobePanel({
                        ownerId: interaction.user.id,
                        state,
                        selectedSlot: slotId,
                        banner,
                        now
                    })
                );
            },

            async strip_all(interaction, parsed) {
                const now = Date.now();
                const slotId = parsed.arg || 'top';
                await withTransaction(async (conn) => {
                    for (const sId of ['hat', 'top', 'bottom', 'shoes', 'accessory']) {
                        await setEquippedClothingSlot(conn, interaction.user.id, sId, null, now);
                    }
                });

                const state = await fetchWardrobePanelData(interaction.user.id, now);
                return await interaction.update(
                    buildWardrobePanel({
                        ownerId: interaction.user.id,
                        state,
                        selectedSlot: slotId,
                        banner: { type: 'info', text: '🧍 Seluruh pakaian luar telah dilepas — Karakter Chibi kembali ke tampilan polos!' },
                        now
                    })
                );
            },

            async open_butik(interaction) {
                const now = Date.now();
                const shopState = await fetchShopState(interaction.user.id, now);
                const payload = buildShopPanel({
                    state: shopState,
                    shopId: 'busana',
                    page: 1,
                    now
                });
                return await interaction.update({
                    ...payload,
                    attachments: []
                });
            },

            async go_profile(interaction) {
                const now = Date.now();
                const { fetchProfileData, buildProfilePanel } = require('./profile');
                const data = await fetchProfileData(interaction.user.id, now);
                return await interaction.update(
                    buildProfilePanel({
                        ownerId: interaction.user.id,
                        data,
                        now
                    })
                );
            }
        },

        selects: {
            async slot(interaction) {
                const now = Date.now();
                const chosenSlot = interaction.values[0] || 'top';
                const state = await fetchWardrobePanelData(interaction.user.id, now);
                return await interaction.update(
                    buildWardrobePanel({
                        ownerId: interaction.user.id,
                        state,
                        selectedSlot: chosenSlot,
                        now
                    })
                );
            },

            async wear(interaction, parsed) {
                const now = Date.now();
                const slotId = parsed.arg || 'top';
                const chosenValue = interaction.values[0];

                if (!chosenValue || chosenValue === '_empty_') {
                    const state = await fetchWardrobePanelData(interaction.user.id, now);
                    return await interaction.update(
                        buildWardrobePanel({
                            ownerId: interaction.user.id,
                            state,
                            selectedSlot: slotId,
                            now
                        })
                    );
                }

                const targetClothingId = chosenValue === '_unequip_' ? null : chosenValue;
                const res = await withTransaction(async (conn) => {
                    return await setEquippedClothingSlot(conn, interaction.user.id, slotId, targetClothingId, now);
                });

                const state = await fetchWardrobePanelData(interaction.user.id, now);
                let banner = null;
                if (!res.ok) {
                    banner = { type: 'danger', text: 'Gagal mengganti pakaian. Pastikan pakaian sudah dimiliki di lemarimu.' };
                } else if (res.action === 'unequipped') {
                    banner = { type: 'info', text: `🚫 **${res.slotMeta.name}** dilepas dari karakter chibi kamu.` };
                } else {
                    const buffInfo = res.clothing.buffLabel ? ` *(✨ ${res.clothing.buffLabel})*` : '';
                    banner = {
                        type: 'success',
                        text: `👔 Berhasil mengenakan **${res.clothing.emoji} ${res.clothing.name}**!${buffInfo}`
                    };
                }

                return await interaction.update(
                    buildWardrobePanel({
                        ownerId: interaction.user.id,
                        state,
                        selectedSlot: slotId,
                        banner,
                        now
                    })
                );
            }
        }
    },

    DISPLAY_SLOT_ORDER,
    fetchWardrobePanelData,
    buildWardrobePanel
};
