const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags
} = require('discord.js');
const {
    MAX_DAILY_KARMA_EARN,
    MIN_DROP_PORTIONS,
    MAX_DROP_PORTIONS,
    getKarmaPerks,
    getTraktirDropKarmaPerClaim,
    fetchTraktirState,
    createChannelTraktirDrop,
    claimChannelTraktirDrop,
    donateToSocialPost
} = require('../../services/karmaService');
const { getEffectiveItemPrice } = require('../../services/shopService');
const { makeId } = require('../../utils/panelId');
const { getItem } = require('../../data/items');
const { COLORS, formatLp, formatDuration, renderBar } = require('../../utils/uiBuilder');
const { buildPanel, btn, select, numberModal, parseModalNumber } = require('../../utils/panelBuilder');

function formatTraktirBanner(res) {
    if (!res) return null;
    if (!res.ok) {
        if (res.error === 'INSUFFICIENT_FUNDS') {
            return {
                type: 'danger',
                text: `Saldo Cash + Bank (${formatLp(res.totalFunds)}) tidak cukup untuk menraktir senilai **${formatLp(res.required)}**.`
            };
        }
        if (res.error === 'INSUFFICIENT_BAG_ITEM' || res.error === 'INSUFFICIENT_ITEM') {
            return {
                type: 'warning',
                text: `Jumlah **${res.item?.name || 'item'}** di tasmu (${res.owned || 0}) kurang dari jumlah yang diminta (${res.required || res.requested}).`
            };
        }
        if (res.error === 'INVALID_PORTIONS') {
            return {
                type: 'warning',
                text: `Jumlah porsi traktiran harus antara **${res.min || MIN_DROP_PORTIONS}–${res.max || MAX_DROP_PORTIONS} porsi**.`
            };
        }
        if (res.error === 'INVALID_QTY') {
            return {
                type: 'warning',
                text: 'Jumlah donasi harus berupa angka bulat antara **1–50**.'
            };
        }
        if (res.error === 'DAILY_KARMA_CAP_REACHED') {
            return {
                type: 'warning',
                text: `Batas perolehan Karma harianmu (**${res.dailyUsed}/${res.dailyCap}**) sudah penuh hari ini. Coba lagi besok (reset 00:00 WIB)!`
            };
        }
        if (res.error === 'EXCEEDS_DAILY_CAP') {
            return {
                type: 'warning',
                text: `Sisa kuota Karma harianmu tinggal **${res.remainingCap}** (maksimal donasi **${res.maxAllowedQty}×** item ini hari ini agar tidak mubazir).`
            };
        }
        if (res.error === 'IN_HOSPITAL' || res.error === 'SLEEPING') {
            return { type: 'warning', text: 'Selesaikan istirahat/perawatanmu terlebih dahulu sebelum membuat traktiran.' };
        }
        return { type: 'danger', text: 'Gagal memproses aksi traktir/donasi.' };
    }

    if (res.drop) {
        const drop = res.drop;
        return {
            type: 'success',
            text: `🎉 Berhasil menebar **${drop.total_portions}× ${res.item.emoji} ${res.item.name}** ke channel! Kamu mendapat **+${drop.karma_per_claim} Karma** tiap warga mengambil bagiannya (maks ${MAX_DAILY_KARMA_EARN}/hari).`
        };
    }

    if (res.karmaRes) {
        const capNote = res.karmaRes.cappedOut
            ? ` *(menyentuh batas harian ${res.karmaRes.dailyUsed}/${res.karmaRes.dailyCap})*`
            : ` *(Kuota hari ini: ${res.karmaRes.dailyUsed}/${res.karmaRes.dailyCap})*`;
        return {
            type: 'success',
            text: `💖 Terima kasih! Kamu mendonasikan **${res.qty}× ${res.item.emoji} ${res.item.name}** ke Pos Sosial Kota dan memperoleh **+${res.karmaRes.granted} ⭐ Karma**${capNote}.`
        };
    }

    return null;
}

function buildPublicTraktirDropMessage({ drop, item, creatorName = null, now = Date.now() }) {
    const resolvedItem = item || getItem(drop.item_id);
    const total = Number(drop.total_portions || 1);
    const rem = Math.max(0, Number(drop.remaining_portions || 0));
    const remMs = Math.max(0, Number(drop.expires_at || 0) - now);
    const isExpired = remMs <= 0;
    const isEmpty = rem <= 0;

    const hostLabel = creatorName ? `**${creatorName}** (<@${drop.creator_id}>)` : `<@${drop.creator_id}>`;
    const quoteLine = drop.note ? `\n💬 *"${drop.note}"*` : '';
    const statusLine = isEmpty
        ? '📭 **Semua porsi sudah habis diambil warga!**'
        : isExpired
            ? '⌛ **Traktiran ini sudah kedaluwarsa.**'
            : `🎁 **Tersisa ${rem}/${total} porsi** · Berakhir dalam **${formatDuration(remMs)}**`;

    const label = isEmpty
        ? 'Sudah Habis Diambil'
        : isExpired
            ? 'Waktu Habis'
            : `Ambil Gratis (${rem}/${total})`;

    return buildPanel({
        mod: 'traktir',
        ownerId: '0',
        accentColor: isEmpty || isExpired ? COLORS.SECONDARY : COLORS.SUCCESS,
        title: `🍱 Traktiran Warga: ${resolvedItem ? `${resolvedItem.emoji} ${resolvedItem.name}` : drop.item_id}`,
        blocks: [
            `${hostLabel} mentraktir **${total} porsi** ${resolvedItem ? `${resolvedItem.emoji} **${resolvedItem.name}**` : drop.item_id} gratis untuk warga sekitar!${quoteLine}`,
            resolvedItem?.description ? `✨ *Efek item:* ${resolvedItem.description}` : null,
            `${renderBar(rem, total, 10)} · ${statusLine}`
        ],
        rows: [
            new ActionRowBuilder().addComponents(
                btn('traktir', 'claim_drop', '0', {
                    label,
                    emoji: '🎁',
                    style: isEmpty || isExpired ? ButtonStyle.Secondary : ButtonStyle.Success,
                    arg: String(drop.id),
                    disabled: isEmpty || isExpired
                }, now)
            )
        ],
        footer: '1 porsi per warga • Pembuat traktiran tidak dapat mengambil jatahnya sendiri.',
        now
    });
}

function buildTraktirPanel({
    state,
    tab = 'drop',
    source = 'buy',
    selectedItemId = null,
    banner = null,
    now = Date.now()
}) {
    const {
        player: p,
        slotsUsed,
        dailyKarmaUsed,
        perks,
        buyCatalog,
        shareableBag,
        donatableBag
    } = state;

    const ownerId = p.discord_id;
    const activeTab = tab === 'donate' ? 'donate' : 'drop';
    const activeSource = source === 'bag' ? 'bag' : 'buy';

    const nextTierLine = perks.nextTier
        ? `Berikutnya: ${perks.nextTier.emoji} **${perks.nextTier.name}** (${perks.karmaPoints}/${perks.nextTier.minKarma})`
        : '👑 **Tier Karma Tertinggi Tercapai!**';

    const headerBlock = [
        `${perks.tierEmoji} **Reputasi Sosial:** **${perks.tierName}** · ⭐ **${perks.karmaPoints} Poin Karma**`,
        `📊 **Kuota Harian:** \`${dailyKarmaUsed}/${MAX_DAILY_KARMA_EARN} Karma\` *(Reset 00:00 WIB)* · ${nextTierLine}`,
        `🏥 **Diskon Biaya RS:** **-${Math.round(perks.hospitalDiscountRate * 100)}%** *(maks -20%)* · 💳 **Diskon Bunga /credit:** **-${(perks.creditRateReduction * 100).toFixed(1)}%** *(maks -2.0%)*`
    ].join('\n');

    const tabRow = new ActionRowBuilder().addComponents(
        btn('traktir', 'tab', ownerId, {
            label: 'Traktir Channel',
            emoji: '🍱',
            style: activeTab === 'drop' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: `drop|${activeSource}`
        }, now),
        btn('traktir', 'tab', ownerId, {
            label: `Donasi Pos Sosial (${donatableBag.length})`,
            emoji: '📦',
            style: activeTab === 'donate' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: `donate|${activeSource}`
        }, now)
    );

    const blocks = [headerBlock];
    const rows = [tabRow];

    if (activeTab === 'drop') {
        const sourceRow = new ActionRowBuilder().addComponents(
            btn('traktir', 'src', ownerId, {
                label: 'Beli & Traktir Langsung',
                emoji: '🛒',
                style: activeSource === 'buy' ? ButtonStyle.Success : ButtonStyle.Secondary,
                arg: 'buy'
            }, now),
            btn('traktir', 'src', ownerId, {
                label: `Bagikan dari Tas (${shareableBag.length})`,
                emoji: '🎒',
                style: activeSource === 'bag' ? ButtonStyle.Success : ButtonStyle.Secondary,
                arg: 'bag'
            }, now)
        );
        rows.push(sourceRow);

        const pool = activeSource === 'bag'
            ? shareableBag.map(e => ({
                item: e.item,
                owned: e.qty,
                effectivePrice: 0,
                karmaPerClaim: getTraktirDropKarmaPerClaim(e.item, 0)
            }))
            : buyCatalog.map(e => ({
                item: e.item,
                owned: 0,
                effectivePrice: e.effectivePrice,
                karmaPerClaim: e.karmaPerClaim
            }));

        const chosen = pool.find(e => e.item.id === selectedItemId) || pool[0] || null;

        if (!chosen) {
            blocks.push(
                activeSource === 'bag'
                    ? '🎒 Kamu belum memiliki stok makanan/minuman minimal **2 porsi** di tas. Beralihlah ke **Beli & Traktir Langsung** atau masak dulu di `/cook`!'
                    : '🏪 Tidak ada item traktir toko yang tersedia saat ini.'
            );
        } else {
            const costPreview3 = activeSource === 'buy'
                ? `Biaya 3 porsi: **${formatLp(chosen.effectivePrice * 3)}**`
                : `Stok di tas: **×${chosen.owned}** *(Gratis dari tas)*`;

            blocks.push([
                `**Menu Terpilih:** ${chosen.item.emoji} **${chosen.item.name}**`,
                `⭐ **+${chosen.karmaPerClaim} Karma/klaim** · ${costPreview3}`,
                chosen.item.description ? `*${chosen.item.description}*` : null,
                '⚠️ *Item yang sudah ditraktirkan tidak dapat ditarik kembali. Karma bertambah saat warga mengambil bagiannya.*'
            ].filter(Boolean).join('\n'));

            rows.push(
                select('traktir', 'pick_drop_item', ownerId, {
                    placeholder: activeSource === 'bag' ? '🎒 Pilih makanan/minuman dari tas...' : '🛒 Pilih menu makanan/minuman untuk ditraktir...',
                    options: pool.slice(0, 25).map(e => ({
                        label: `${e.item.name} (+${e.karmaPerClaim} Karma/klaim)`.slice(0, 100),
                        value: `${activeSource}|${e.item.id}`,
                        emoji: e.item.emoji,
                        description: activeSource === 'buy'
                            ? `${formatLp(e.effectivePrice)}/porsi`.slice(0, 100)
                            : `Tersedia ×${e.owned} di tas`.slice(0, 100),
                        default: e.item.id === chosen.item.id
                    }))
                }, now)
            );

            const maxBagPortions = activeSource === 'bag' ? chosen.owned : MAX_DROP_PORTIONS;
            rows.push(
                new ActionRowBuilder().addComponents(
                    btn('traktir', 'drop_go', ownerId, {
                        label: 'Traktir 2 Porsi',
                        emoji: '🍱',
                        style: ButtonStyle.Success,
                        arg: `${activeSource}|${chosen.item.id}|2`,
                        disabled: activeSource === 'bag' && maxBagPortions < 2
                    }, now),
                    btn('traktir', 'drop_go', ownerId, {
                        label: 'Traktir 3 Porsi',
                        emoji: '🍱',
                        style: ButtonStyle.Success,
                        arg: `${activeSource}|${chosen.item.id}|3`,
                        disabled: activeSource === 'bag' && maxBagPortions < 3
                    }, now),
                    btn('traktir', 'drop_go', ownerId, {
                        label: 'Traktir 5 Porsi',
                        emoji: '🍱',
                        style: ButtonStyle.Primary,
                        arg: `${activeSource}|${chosen.item.id}|5`,
                        disabled: activeSource === 'bag' && maxBagPortions < 5
                    }, now),
                    btn('traktir', 'drop_modal_open', ownerId, {
                        label: 'Custom Porsi/Pesan',
                        emoji: '✏️',
                        style: ButtonStyle.Secondary,
                        arg: `${activeSource}|${chosen.item.id}`
                    }, now)
                )
            );
        }
    } else {
        const chosenDonate = donatableBag.find(d => d.item.id === selectedItemId) || donatableBag[0] || null;
        if (!chosenDonate) {
            blocks.push(
                `📦 **Pos Sosial Kota** menerima rongsokan (/bin), bahan masakan, hasil panen/ternak, atau obat ringan dari tasmu.\n🎒 Tasmu saat ini (\`${slotsUsed}/${p.max_slots}\`) belum memiliki item yang dapat didonasikan.`
            );
        } else {
            blocks.push([
                `📦 **Item Terpilih:** ${chosenDonate.item.emoji} **${chosenDonate.item.name}** *(Milikmu: ×${chosenDonate.qty})*`,
                `⭐ **Nilai Donasi:** **+${chosenDonate.karmaPerUnit} Karma / item**`,
                `🎒 **Slot Tas:** \`${slotsUsed}/${p.max_slots}\` *(Donasi juga membantu melapangkan isi tasmu!)*`
            ].join('\n'));

            rows.push(
                select('traktir', 'pick_donate', ownerId, {
                    placeholder: '📦 Pilih item dari tas untuk didonasikan...',
                    options: donatableBag.slice(0, 25).map(d => ({
                        label: `${d.item.name} (×${d.qty}) — +${d.karmaPerUnit} Karma/bh`.slice(0, 100),
                        value: d.item.id,
                        emoji: d.item.emoji,
                        description: `Donasi +${d.karmaPerUnit} Karma per buah (stok ${d.qty})`.slice(0, 100),
                        default: d.item.id === chosenDonate.item.id
                    }))
                }, now)
            );

            const donateAllQty = Math.min(chosenDonate.qty, 50);
            rows.push(
                new ActionRowBuilder().addComponents(
                    btn('traktir', 'donate_go', ownerId, {
                        label: 'Donasi ×1',
                        emoji: '📦',
                        style: ButtonStyle.Success,
                        arg: `${chosenDonate.item.id}|1`,
                        disabled: chosenDonate.qty < 1 || dailyKarmaUsed >= MAX_DAILY_KARMA_EARN
                    }, now),
                    btn('traktir', 'donate_go', ownerId, {
                        label: 'Donasi ×5',
                        emoji: '📦',
                        style: ButtonStyle.Success,
                        arg: `${chosenDonate.item.id}|5`,
                        disabled: chosenDonate.qty < 5 || dailyKarmaUsed >= MAX_DAILY_KARMA_EARN
                    }, now),
                    btn('traktir', 'donate_go', ownerId, {
                        label: `Semua (×${donateAllQty})`,
                        emoji: '💖',
                        style: ButtonStyle.Primary,
                        arg: `${chosenDonate.item.id}|${donateAllQty}|all`,
                        disabled: chosenDonate.qty < 1 || dailyKarmaUsed >= MAX_DAILY_KARMA_EARN
                    }, now),
                    btn('traktir', 'donate_modal_open', ownerId, {
                        label: 'Jumlah Custom',
                        emoji: '✏️',
                        style: ButtonStyle.Secondary,
                        arg: chosenDonate.item.id,
                        disabled: dailyKarmaUsed >= MAX_DAILY_KARMA_EARN
                    }, now)
                )
            );
        }
    }

    return buildPanel({
        mod: 'traktir',
        ownerId,
        player: p,
        accentColor: COLORS.SUCCESS,
        title: '🎁 Traktir Warga & Pos Sosial Kota',
        banner,
        blocks,
        rows,
        footer: 'Maksimal +50 Poin Karma per hari (reset 00:00 WIB) • Diskon RS & /credit aktif otomatis.',
        now
    });
}

async function publishChannelTraktirDrop(interaction, dropResult, now) {
    if (!dropResult?.ok || !dropResult.drop) return;
    if (!interaction.channel || typeof interaction.channel.send !== 'function') return;
    const publicPayload = buildPublicTraktirDropMessage({
        drop: dropResult.drop,
        item: dropResult.item,
        creatorName: dropResult.player?.username || interaction.user.username,
        now
    });
    await interaction.channel.send(publicPayload);
}

module.exports = {
    name: 'traktir',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('traktir')
        .setDescription('Traktir makanan di channel & donasi ke Pos Sosial kota untuk kumpulkan Poin Karma!'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchTraktirState(interaction.user.id, now);
        return await interaction.reply(buildTraktirPanel({ state, now }));
    },

    panel: {
        publicButtons: new Set(['claim_drop']),

        buttons: {
            async tab(interaction, parsed) {
                const now = Date.now();
                const [tab = 'drop', source = 'buy'] = String(parsed.arg || '').split('|');
                const state = await fetchTraktirState(interaction.user.id, now);
                return await interaction.update({
                    ...buildTraktirPanel({ state, tab, source, now }),
                    attachments: []
                });
            },

            async src(interaction, parsed) {
                const now = Date.now();
                const source = parsed.arg === 'bag' ? 'bag' : 'buy';
                const state = await fetchTraktirState(interaction.user.id, now);
                return await interaction.update({
                    ...buildTraktirPanel({ state, tab: 'drop', source, now }),
                    attachments: []
                });
            },

            async drop_go(interaction, parsed) {
                const now = Date.now();
                const [source = 'buy', itemId = '', rawPortions = '3'] = String(parsed.arg || '').split('|');
                const portions = Number(rawPortions) || 3;
                const res = await createChannelTraktirDrop(interaction.user.id, {
                    channelId: interaction.channelId || null,
                    source,
                    itemId,
                    portions,
                    now
                });

                if (res.ok) {
                    await publishChannelTraktirDrop(interaction, res, now);
                }

                const state = await fetchTraktirState(interaction.user.id, now);
                return await interaction.update({
                    ...buildTraktirPanel({
                        state,
                        tab: 'drop',
                        source,
                        selectedItemId: itemId,
                        banner: formatTraktirBanner(res),
                        now
                    }),
                    attachments: []
                });
            },

            async drop_modal_open(interaction, parsed) {
                const now = Date.now();
                const [source = 'buy', itemId = ''] = String(parsed.arg || '').split('|');
                const item = getItem(itemId);
                const modal = new ModalBuilder()
                    .setCustomId(makeId('traktir', 'drop_modal', interaction.user.id, `${source}|${itemId}`, now))
                    .setTitle(`Traktir ${item ? item.name.slice(0, 28) : 'Makanan'}`);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('portions')
                            .setLabel('Jumlah Porsi (2 - 10)')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Contoh: 3')
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('note')
                            .setLabel('Pesan / Ucapan Traktir (Opsional)')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(140)
                            .setPlaceholder('Makan siang gratis biar semangat kerja!')
                            .setRequired(false)
                    )
                );
                return await interaction.showModal(modal);
            },

            async donate_go(interaction, parsed) {
                const now = Date.now();
                const [itemId = '', rawQty = '1'] = String(parsed.arg || '').split('|');
                const qty = Math.max(1, Number(rawQty) || 1);
                const res = await donateToSocialPost(interaction.user.id, itemId, qty, now);
                const state = await fetchTraktirState(interaction.user.id, now);
                return await interaction.update({
                    ...buildTraktirPanel({
                        state,
                        tab: 'donate',
                        selectedItemId: itemId,
                        banner: formatTraktirBanner(res),
                        now
                    }),
                    attachments: []
                });
            },

            async donate_modal_open(interaction, parsed) {
                const now = Date.now();
                const itemId = parsed.arg || '';
                const item = getItem(itemId);
                const modal = numberModal('traktir', 'donate_modal', interaction.user.id, {
                    title: `Donasi ${item ? item.name.slice(0, 28) : 'Item'}`,
                    label: 'Jumlah Item yang Didonasikan',
                    placeholder: 'Contoh: 5',
                    arg: itemId
                }, now);
                return await interaction.showModal(modal);
            },

            async claim_drop(interaction, parsed) {
                const now = Date.now();
                const dropId = Number(parsed.arg || 0);
                const res = await claimChannelTraktirDrop(interaction.user.id, dropId, now);

                if (!res.ok) {
                    let msg = 'Tidak dapat mengambil traktiran ini.';
                    if (res.error === 'SELF_CLAIM') {
                        msg = '🙅 Kamu adalah pembuat traktiran ini, jadi tidak bisa mengambil jatahmu sendiri.';
                    } else if (res.error === 'ALREADY_CLAIMED') {
                        msg = '✅ Kamu sudah mengambil 1 porsi dari traktiran ini sebelumnya.';
                    } else if (res.error === 'BAG_FULL') {
                        msg = `🎒 Tasmu penuh (${res.slotsBefore}/${res.maxSlots} slot)! Kosongkan 1 slot dulu di /inventory atau /storage.`;
                    } else if (res.error === 'DROP_EMPTY') {
                        msg = '📭 Yah, semua porsi traktiran ini sudah habis diambil warga lain!';
                    } else if (res.error === 'DROP_EXPIRED') {
                        msg = '⌛ Waktu klaim traktiran ini sudah habis.';
                    }

                    const errPayload = buildPanel({
                        mod: 'traktir',
                        ownerId: interaction.user.id,
                        accentColor: COLORS.WARNING,
                        title: '🎁 Klaim Traktiran',
                        blocks: [msg],
                        now
                    });
                    return await interaction.reply({
                        ...errPayload,
                        flags: errPayload.flags | MessageFlags.Ephemeral
                    });
                }

                const updatedPublic = buildPublicTraktirDropMessage({
                    drop: res.drop,
                    item: res.item,
                    creatorName: res.drop.creator_name,
                    now
                });

                await interaction.update({ ...updatedPublic, attachments: [] });

                const hostText = res.drop.creator_name || `<@${res.drop.creator_id}>`;
                const notice = buildPanel({
                    mod: 'traktir',
                    ownerId: interaction.user.id,
                    accentColor: COLORS.SUCCESS,
                    title: '✅ Traktiran Berhasil Diambil!',
                    blocks: [
                        `Kamu menerima **1× ${res.item.emoji} ${res.item.name}** ke dalam tasmu dari traktiran **${hostText}**!`,
                        '💡 Gunakan `/consume` kapan saja untuk menyantapnya.'
                    ],
                    now
                });
                return await interaction.followUp({
                    ...notice,
                    flags: notice.flags | MessageFlags.Ephemeral
                });
            }
        },

        selects: {
            async pick_drop_item(interaction) {
                const now = Date.now();
                const [source = 'buy', itemId = ''] = String(interaction.values[0] || '').split('|');
                const state = await fetchTraktirState(interaction.user.id, now);
                return await interaction.update({
                    ...buildTraktirPanel({
                        state,
                        tab: 'drop',
                        source,
                        selectedItemId: itemId,
                        now
                    }),
                    attachments: []
                });
            },

            async pick_donate(interaction) {
                const now = Date.now();
                const itemId = interaction.values[0] || '';
                const state = await fetchTraktirState(interaction.user.id, now);
                return await interaction.update({
                    ...buildTraktirPanel({
                        state,
                        tab: 'donate',
                        selectedItemId: itemId,
                        now
                    }),
                    attachments: []
                });
            }
        },

        modals: {
            async drop_modal(interaction, parsed) {
                const now = Date.now();
                const [source = 'buy', itemId = ''] = String(parsed.arg || '').split('|');
                const parsedPortions = parseModalNumber(interaction, 'portions', {
                    min: MIN_DROP_PORTIONS,
                    max: MAX_DROP_PORTIONS
                });
                const note = interaction.fields.getTextInputValue('note') || null;

                let res;
                if (!parsedPortions.ok) {
                    res = { ok: false, error: 'INVALID_PORTIONS', min: MIN_DROP_PORTIONS, max: MAX_DROP_PORTIONS };
                } else {
                    res = await createChannelTraktirDrop(interaction.user.id, {
                        channelId: interaction.channelId || null,
                        source,
                        itemId,
                        portions: parsedPortions.value,
                        note,
                        now
                    });
                    if (res.ok) {
                        await publishChannelTraktirDrop(interaction, res, now);
                    }
                }

                const state = await fetchTraktirState(interaction.user.id, now);
                const payload = buildTraktirPanel({
                    state,
                    tab: 'drop',
                    source,
                    selectedItemId: itemId,
                    banner: formatTraktirBanner(res),
                    now
                });
                if (typeof interaction.update === 'function') {
                    return await interaction.update({ ...payload, attachments: [] });
                }
                return await interaction.reply(payload);
            },

            async donate_modal(interaction, parsed) {
                const now = Date.now();
                const itemId = parsed.arg || '';
                const parsedQty = parseModalNumber(interaction, 'amount', { min: 1, max: 50 });

                let res;
                if (!parsedQty.ok) {
                    res = { ok: false, error: 'INVALID_QTY' };
                } else {
                    res = await donateToSocialPost(interaction.user.id, itemId, parsedQty.value, now);
                }

                const state = await fetchTraktirState(interaction.user.id, now);
                const payload = buildTraktirPanel({
                    state,
                    tab: 'donate',
                    selectedItemId: itemId,
                    banner: formatTraktirBanner(res),
                    now
                });
                if (typeof interaction.update === 'function') {
                    return await interaction.update({ ...payload, attachments: [] });
                }
                return await interaction.reply(payload);
            }
        }
    },

    buildTraktirPanel,
    buildPublicTraktirDropMessage
};
