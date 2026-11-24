const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const {
    AUCTION_CONSTANTS,
    getMinimumNextBid,
    fetchAuctionState,
    createAuctionListing,
    placeAuctionBid,
    cancelAuctionListing,
    claimAuctionItems
} = require('../../services/auctionService');
const { makeId } = require('../../utils/panelId');
const { getClothing } = require('../../data/clothes');
const { getItem } = require('../../data/items');
const { COLORS, formatLp, formatDuration } = require('../../utils/uiBuilder');
const { buildPanel, btn, select, numberModal, parseModalNumber } = require('../../utils/panelBuilder');

function getNextDurationHours(cur) {
    const idx = AUCTION_CONSTANTS.DURATIONS_HOURS.indexOf(Number(cur));
    return AUCTION_CONSTANTS.DURATIONS_HOURS[(idx + 1) % AUCTION_CONSTANTS.DURATIONS_HOURS.length];
}

function getAuctionAssetDisplay(itemKind, itemId) {
    if (itemKind === 'clothing') {
        const c = getClothing(itemId);
        return c ? { name: c.name, emoji: c.emoji, rarity: c.rarity, extra: c.buffLabel || `Slot ${c.slot}` } : { name: itemId, emoji: '🧥', rarity: 'rare', extra: '' };
    }
    const it = getItem(itemId);
    return it
        ? { name: it.name, emoji: it.emoji, rarity: it.rarity || 'common', maxDurability: it.maxDurability || null, extra: it.description || '' }
        : { name: itemId, emoji: '📦', rarity: 'common', maxDurability: null, extra: '' };
}

function formatAuctionBanner(res) {
    if (!res) return null;
    if (!res.ok) {
        if (res.error === 'INSUFFICIENT_FUNDS') {
            return {
                type: 'danger',
                text: `Saldo Cash + Bank (${formatLp(res.totalFunds)}) tidak mencukupi untuk memasang bid sebesar **${formatLp(res.required)}**.`
            };
        }
        if (res.error === 'BID_TOO_LOW') {
            return {
                type: 'warning',
                text: `Nominal bid terlalu rendah! Minimum bid saat ini adalah **${formatLp(res.minRequiredBid)}**.`
            };
        }
        if (res.error === 'SELF_BID') {
            return { type: 'warning', text: 'Kamu tidak bisa menawar barang lelang milikmu sendiri.' };
        }
        if (res.error === 'ALREADY_HIGHEST_BIDDER') {
            return { type: 'warning', text: 'Kamu sudah menjadi penawar tertinggi pada lelang ini!' };
        }
        if (res.error === 'ALREADY_OWN_CLOTHING') {
            return { type: 'warning', text: 'Kamu sudah memiliki busana tersebut di `/wardrobe` sehingga tidak bisa ikut menawar.' };
        }
        if (res.error === 'START_PRICE_TOO_LOW') {
            return { type: 'warning', text: `Harga awal lelang minimal **${formatLp(AUCTION_CONSTANTS.MIN_START_PRICE)}**.` };
        }
        if (res.error === 'INVALID_RESERVE_PRICE') {
            return { type: 'warning', text: 'Harga reserve harus **0** *(tanpa reserve)* atau minimal sama dengan harga awal.' };
        }
        if (res.error === 'TOO_MANY_ACTIVE_AUCTIONS') {
            return {
                type: 'warning',
                text: `Kamu sudah mencapai batas maksimal **${res.activeCount}/${res.max}** lelang aktif bersamaan.`
            };
        }
        if (res.error === 'HAS_ACTIVE_BIDS') {
            return { type: 'warning', text: 'Lelang yang sudah memiliki penawar aktif tidak dapat dibatalkan.' };
        }
        if (res.error === 'BAG_FULL') {
            return {
                type: 'warning',
                text: `Slot tas penuh (${res.slotsUsed}/${res.maxSlots})! Kosongkan tas di \`/inventory\` atau \`/storage\` sebelum mengklaim barang lelang.`
            };
        }
        if (res.error === 'AUCTION_NOT_ACTIVE' || res.error === 'AUCTION_ENDED' || res.error === 'AUCTION_NOT_FOUND') {
            return { type: 'warning', text: 'Sesi lelang ini sudah berakhir atau tidak tersedia.' };
        }
        if (res.error === 'NO_CLAIMS') {
            return { type: 'warning', text: 'Belum ada item di Kotak Klaim Lelang.' };
        }
        return { type: 'danger', text: 'Gagal memproses operasi balai lelang.' };
    }

    if (res.bidAmount) {
        const asset = getAuctionAssetDisplay(res.auction.item_kind, res.auction.item_id);
        const snipeNote = res.snipeTriggered ? ' ⏱️ *(Anti-sniping aktif: waktu diperpanjang +120 detik!)*' : '';
        return {
            type: 'success',
            text: `💸 Bid **${formatLp(res.bidAmount)}** pada ${asset.emoji} **${asset.name}** diterima! Dana terkunci di escrow hingga tersalip/selesai.${snipeNote}`
        };
    }

    if (res.auction && res.auction.status === 'active') {
        const asset = getAuctionAssetDisplay(res.auction.item_kind, res.auction.item_id);
        return {
            type: 'success',
            text: `🏛️ Lelang #${res.auction.id} (**${asset.emoji} ${asset.name}**) resmi dibuka dengan harga awal **${formatLp(res.auction.start_price)}**!`
        };
    }

    if (res.auction && res.auction.status === 'cancelled') {
        return {
            type: 'success',
            text: `↩️ Lelang #${res.auction.id} dibatalkan. Barang dipindahkan ke **Kotak Klaim Lelang**.`
        };
    }

    if (res.claimed) {
        const list = res.claimed.map(c => c.displayName).join(', ');
        const extra = res.partialBagFull ? ' *(Sebagian tertunda karena tas penuh)*' : '';
        return {
            type: 'success',
            text: `📥 Berhasil mengklaim hasil lelang: **${list}**${extra}!`
        };
    }

    return null;
}

function buildLelangPanel({
    state,
    tab = 'browse',
    selectedAuctionId = null,
    sellSource = 'inventory',
    sellSelectionKey = null,
    durationHours = 12,
    banner = null,
    now = Date.now()
}) {
    const {
        player: p,
        slotsUsed,
        eligibleBagRows,
        eligibleClothes,
        activeAuctions,
        mySellingAuctions,
        myWinningBids,
        myClaims
    } = state;

    const ownerId = p.discord_id;
    const activeTab = ['browse', 'sell', 'mine'].includes(tab) ? tab : 'browse';
    const activeSource = sellSource === 'clothing' ? 'clothing' : 'inventory';
    const cleanDuration = AUCTION_CONSTANTS.DURATIONS_HOURS.includes(Number(durationHours)) ? Number(durationHours) : 12;

    const tabRow = new ActionRowBuilder().addComponents(
        btn('lelang', 'tab', ownerId, {
            label: `Balai Lelang (${activeAuctions.length})`,
            emoji: '🏛️',
            style: activeTab === 'browse' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: `browse|${activeSource}|${cleanDuration}`
        }, now),
        btn('lelang', 'tab', ownerId, {
            label: 'Pasang Lelang',
            emoji: '🏷️',
            style: activeTab === 'sell' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: `sell|${activeSource}|${cleanDuration}`
        }, now),
        btn('lelang', 'tab', ownerId, {
            label: `Kelola & Klaim (${myClaims.length})`,
            emoji: '📦',
            style: activeTab === 'mine' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: `mine|${activeSource}|${cleanDuration}`
        }, now)
    );

    const blocks = [
        `🎒 **Tas:** \`${slotsUsed}/${p.max_slots}\` · 🔥 **Bid Memimpin:** **${myWinningBids.length}** · 📥 **Kotak Klaim:** **${myClaims.length} item**`
    ];
    const rows = [tabRow];

    if (activeTab === 'browse') {
        const chosen = activeAuctions.find(a => String(a.id) === String(selectedAuctionId)) || activeAuctions[0] || null;
        if (!chosen) {
            blocks.push('🏛️ Balai Lelang sedang sepi. Jadilah yang pertama melelang alat, busana, mineral, atau ikan langka di tab **Pasang Lelang**!');
        } else {
            const listLines = activeAuctions.slice(0, 6).map(a => {
                const asset = getAuctionAssetDisplay(a.item_kind, a.item_id);
                const ptr = a.id === chosen.id ? '▶️ ' : '• ';
                const priceLabel = Number(a.current_bid) > 0 ? `Bid ${formatLp(a.current_bid)}` : `Awal ${formatLp(a.start_price)}`;
                return `${ptr}**#${a.id}** ${asset.emoji} **${asset.name}** · **${priceLabel}** · ⏳ ${formatDuration(Math.max(0, Number(a.ends_at) - now))}`;
            });
            blocks.push(listLines.join('\n'));

            const chosenAsset = getAuctionAssetDisplay(chosen.item_kind, chosen.item_id);
            const minNextBid = getMinimumNextBid(chosen);
            const remMs = Math.max(0, Number(chosen.ends_at) - now);
            const metaBadges = [];
            if (chosen.durability !== null && chosen.durability !== undefined && chosenAsset.maxDurability) {
                metaBadges.push(`🔧 Durability \`${chosen.durability}/${chosenAsset.maxDurability}\``);
            }
            if (chosen.freshness_remaining_ms !== null && chosen.freshness_remaining_ms !== undefined) {
                metaBadges.push(`❄️ Kesegaran Beku \`${formatDuration(Number(chosen.freshness_remaining_ms))}\``);
            }
            if (chosen.item_kind === 'clothing') {
                metaBadges.push(`🧥 Busana Wardrobe`);
            }
            if (Number(chosen.reserve_price || 0) > 0) {
                const reserveStatus = Number(chosen.current_bid) >= Number(chosen.reserve_price)
                    ? '✅ Harga Reserve Terpenuhi'
                    : '🔒 Memakai Harga Reserve';
                metaBadges.push(reserveStatus);
            }

            const isSeller = chosen.seller_id === ownerId;
            const isLeader = chosen.highest_bidder_id === ownerId;

            blocks.push([
                `**Detail Lot #${chosen.id}: ${chosenAsset.emoji} ${chosenAsset.name}**`,
                `• 👤 **Penjual:** ${chosen.seller_name || `<@${chosen.seller_id}>`} · **Total Bid:** ${chosen.bid_count}×`,
                `• 💰 **Harga Saat Ini:** **${Number(chosen.current_bid) > 0 ? formatLp(chosen.current_bid) : formatLp(chosen.start_price)}** *(Penawar tertinggi: ${chosen.highest_bidder_id ? (chosen.bidder_name || `<@${chosen.highest_bidder_id}>`) : 'Belum ada'})*`,
                `• ⏳ **Sisa Waktu:** **${formatDuration(remMs)}** *(Anti-snipe +120 detik jika bid di <2 menit terakhir)*`,
                metaBadges.length > 0 ? `• ${metaBadges.join(' · ')}` : null
            ].filter(Boolean).join('\n'));

            rows.push(
                select('lelang', 'pick_auction', ownerId, {
                    placeholder: '🏛️ Pilih lot lelang yang ingin diperiksa / ditawar...',
                    options: activeAuctions.slice(0, 25).map(a => {
                        const ast = getAuctionAssetDisplay(a.item_kind, a.item_id);
                        const cur = Number(a.current_bid) > 0 ? a.current_bid : a.start_price;
                        return {
                            label: `#${a.id} ${ast.name} (${formatLp(cur)})`.slice(0, 100),
                            value: String(a.id),
                            emoji: ast.emoji,
                            description: `Bid min berikutnya: ${formatLp(getMinimumNextBid(a))}`.slice(0, 100),
                            default: a.id === chosen.id
                        };
                    })
                }, now)
            );

            rows.push(
                new ActionRowBuilder().addComponents(
                    btn('lelang', 'bid_min', ownerId, {
                        label: isSeller ? 'Barang Milikmu' : isLeader ? 'Kamu Memimpin Bid' : `Bid ${formatLp(minNextBid)}`,
                        emoji: '💸',
                        style: isSeller || isLeader ? ButtonStyle.Secondary : ButtonStyle.Success,
                        arg: `${chosen.id}|${minNextBid}`,
                        disabled: isSeller || isLeader
                    }, now),
                    btn('lelang', 'open_bid_modal', ownerId, {
                        label: 'Bid Nominal Custom',
                        emoji: '✏️',
                        style: ButtonStyle.Primary,
                        arg: String(chosen.id),
                        disabled: isSeller || isLeader
                    }, now)
                )
            );
        }
    } else if (activeTab === 'sell') {
        rows.push(
            new ActionRowBuilder().addComponents(
                btn('lelang', 'sell_src', ownerId, {
                    label: `Dari Tas (${eligibleBagRows.length})`,
                    emoji: '🎒',
                    style: activeSource === 'inventory' ? ButtonStyle.Success : ButtonStyle.Secondary,
                    arg: `inventory|${cleanDuration}`
                }, now),
                btn('lelang', 'sell_src', ownerId, {
                    label: `Busana Lemari (${eligibleClothes.length})`,
                    emoji: '🧥',
                    style: activeSource === 'clothing' ? ButtonStyle.Success : ButtonStyle.Secondary,
                    arg: `clothing|${cleanDuration}`
                }, now)
            )
        );

        const pool = activeSource === 'clothing'
            ? eligibleClothes.map(ec => ({
                key: `clothing|0|${ec.clothing.id}`,
                itemKind: 'clothing',
                rowId: '0',
                itemId: ec.clothing.id,
                name: ec.clothing.name,
                emoji: ec.clothing.emoji,
                detail: ec.isEquipped ? 'Sedang dipakai (otomatis dilepas saat lelang)' : `Lemari slot ${ec.clothing.slot}`
            }))
            : eligibleBagRows.map(({ row, item }) => {
                let extra = `Stok ×${row.quantity}`;
                if (item.maxDurability) extra = `Durability ${row.durability ?? item.maxDurability}/${item.maxDurability}`;
                else if (row.freshness_remaining_ms !== null) extra = `Segar ${formatDuration(Number(row.freshness_remaining_ms))}`;
                return {
                    key: `inventory|${row.id}|${item.id}`,
                    itemKind: 'inventory',
                    rowId: String(row.id),
                    itemId: item.id,
                    name: item.name,
                    emoji: item.emoji,
                    detail: extra
                };
            });

        const chosenSell = pool.find(x => x.key === sellSelectionKey) || pool[0] || null;
        const myActiveCount = mySellingAuctions.filter(a => a.status === 'active').length;

        if (!chosenSell) {
            blocks.push(
                activeSource === 'clothing'
                    ? '🧥 Tidak ada busana non-starter di lemarimu yang dapat dilelang.'
                    : '🎒 Tidak ada item layak lelang di tasmu (Alat kerja utuh, Ikan Rare+, Mineral berharga, atau Item Gacha/Trofi Rare+).'
            );
        } else {
            blocks.push([
                `**Item Siap Dilelang:** ${chosenSell.emoji} **${chosenSell.name}**`,
                `• ℹ️ **Status:** ${chosenSell.detail}`,
                `• ⏳ **Durasi Dipilih:** **${cleanDuration} Jam** · Kuota Lelang Aktif: \`${myActiveCount}/${AUCTION_CONSTANTS.MAX_ACTIVE_AUCTIONS_PER_SELLER}\``,
                '❄️ *Item perishable (Ikan Rare+) dibekukan kesegarannya selama di escrow lelang.*'
            ].join('\n'));

            rows.push(
                select('lelang', 'pick_sell_item', ownerId, {
                    placeholder: '🏷️ Pilih item atau busana untuk dilelang...',
                    options: pool.slice(0, 25).map(entry => ({
                        label: `${entry.name}`.slice(0, 100),
                        value: `${cleanDuration}~${entry.key}`,
                        emoji: entry.emoji,
                        description: entry.detail.slice(0, 100),
                        default: entry.key === chosenSell.key
                    }))
                }, now)
            );

            const nextDur = getNextDurationHours(cleanDuration);
            rows.push(
                new ActionRowBuilder().addComponents(
                    btn('lelang', 'cycle_dur', ownerId, {
                        label: `Durasi: ${cleanDuration} Jam`,
                        emoji: '🕒',
                        style: ButtonStyle.Secondary,
                        arg: `${chosenSell.key}|${nextDur}`
                    }, now),
                    btn('lelang', 'open_list_modal', ownerId, {
                        label: `Pasang Lelang (${cleanDuration}j)`,
                        emoji: '🏛️',
                        style: ButtonStyle.Success,
                        arg: `${cleanDuration}|${chosenSell.key}`,
                        disabled: myActiveCount >= AUCTION_CONSTANTS.MAX_ACTIVE_AUCTIONS_PER_SELLER
                    }, now)
                )
            );
        }
    } else {
        if (myClaims.length === 0) {
            blocks.push('📭 **Kotak Klaim Lelang:** Kosong.');
        } else {
            const claimLines = myClaims.slice(0, 6).map(c => {
                const asset = getAuctionAssetDisplay(c.item_kind, c.item_id);
                const reasonLabel = c.claim_reason === 'won' ? '🏆 Menang' : '↩️ Dikembalikan';
                return `• ${reasonLabel} **#${c.auction_id}** ${asset.emoji} **${asset.name}**`;
            });
            blocks.push(['**📥 KOTAK KLAIM HASIL LELANG:**', ...claimLines].join('\n'));
        }

        if (mySellingAuctions.length === 0) {
            blocks.push('🏷️ **Lelang Milikmu:** Belum ada riwayat lelang yang kamu pasang.');
        } else {
            const sellLines = mySellingAuctions.slice(0, 6).map(a => {
                const asset = getAuctionAssetDisplay(a.item_kind, a.item_id);
                const bidTxt = Number(a.current_bid) > 0 ? `Bid: ${formatLp(a.current_bid)}` : `Awal: ${formatLp(a.start_price)}`;
                return `• **#${a.id}** [${a.status.toUpperCase()}] ${asset.emoji} ${asset.name} — ${bidTxt}`;
            });
            blocks.push(['**🏷️ DAFTAR LELANG YANG KAMU PASANG:**', ...sellLines].join('\n'));
        }

        const mineBtns = [
            btn('lelang', 'claim_all', ownerId, {
                label: `Klaim Semua (${myClaims.length})`,
                emoji: '📥',
                style: myClaims.length > 0 ? ButtonStyle.Success : ButtonStyle.Secondary,
                arg: 'all',
                disabled: myClaims.length <= 0
            }, now)
        ];

        const cancellable = mySellingAuctions.filter(a => a.status === 'active' && Number(a.bid_count || 0) === 0);
        for (const a of cancellable.slice(0, 3)) {
            const ast = getAuctionAssetDisplay(a.item_kind, a.item_id);
            mineBtns.push(
                btn('lelang', 'cancel', ownerId, {
                    label: `Batalkan #${a.id} (${ast.name.slice(0, 10)})`,
                    emoji: '❌',
                    style: ButtonStyle.Danger,
                    arg: String(a.id)
                }, now)
            );
        }
        rows.push(new ActionRowBuilder().addComponents(mineBtns.slice(0, 4)));
    }

    return buildPanel({
        mod: 'lelang',
        ownerId,
        player: p,
        accentColor: COLORS.WARNING,
        title: '🏛️ Balai Lelang Barang Langka & Koleksi',
        banner,
        blocks,
        rows,
        footer: 'Durasi 1/6/12/24j • Anti-sniping +120s • Refund outbid instan • Pajak hasil lelang 5%.',
        now
    });
}

module.exports = {
    name: 'lelang',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('lelang')
        .setDescription('Balai lelang antar-warga untuk melelang alat, busana, trofi gacha, mineral, & ikan Rare+.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchAuctionState(interaction.user.id, now);
        return await interaction.reply(buildLelangPanel({ state, now }));
    },

    panel: {
        buttons: {
            async tab(interaction, parsed) {
                const now = Date.now();
                const [tab = 'browse', sellSource = 'inventory', durStr = '12'] = String(parsed.arg || '').split('|');
                const state = await fetchAuctionState(interaction.user.id, now);
                return await interaction.update({
                    ...buildLelangPanel({
                        state,
                        tab,
                        sellSource,
                        durationHours: Number(durStr) || 12,
                        now
                    }),
                    attachments: []
                });
            },

            async sell_src(interaction, parsed) {
                const now = Date.now();
                const [sellSource = 'inventory', durStr = '12'] = String(parsed.arg || '').split('|');
                const state = await fetchAuctionState(interaction.user.id, now);
                return await interaction.update({
                    ...buildLelangPanel({
                        state,
                        tab: 'sell',
                        sellSource,
                        durationHours: Number(durStr) || 12,
                        now
                    }),
                    attachments: []
                });
            },

            async cycle_dur(interaction, parsed) {
                const now = Date.now();
                const [itemKind = 'inventory', rowId = '0', itemId = '', nextDurStr = '12'] = String(parsed.arg || '').split('|');
                const state = await fetchAuctionState(interaction.user.id, now);
                return await interaction.update({
                    ...buildLelangPanel({
                        state,
                        tab: 'sell',
                        sellSource: itemKind,
                        sellSelectionKey: `${itemKind}|${rowId}|${itemId}`,
                        durationHours: Number(nextDurStr) || 12,
                        now
                    }),
                    attachments: []
                });
            },

            async bid_min(interaction, parsed) {
                const now = Date.now();
                const [auctionIdStr = '0', amountStr = '0'] = String(parsed.arg || '').split('|');
                const res = await placeAuctionBid(interaction.user.id, Number(auctionIdStr), Number(amountStr), now);
                const state = await fetchAuctionState(interaction.user.id, now);
                return await interaction.update({
                    ...buildLelangPanel({
                        state,
                        tab: 'browse',
                        selectedAuctionId: auctionIdStr,
                        banner: formatAuctionBanner(res),
                        now
                    }),
                    attachments: []
                });
            },

            async open_bid_modal(interaction, parsed) {
                const now = Date.now();
                const auctionId = parsed.arg || '0';
                const modal = numberModal('lelang', 'bid_modal', interaction.user.id, {
                    title: `Bid Lelang #${auctionId}`,
                    label: 'Nominal Bid (Lp)',
                    placeholder: 'Contoh: 50000',
                    arg: String(auctionId)
                }, now);
                return await interaction.showModal(modal);
            },

            async open_list_modal(interaction, parsed) {
                const now = Date.now();
                const [durStr = '12', itemKind = 'inventory', rowId = '0', itemId = ''] = String(parsed.arg || '').split('|');
                const asset = getAuctionAssetDisplay(itemKind, itemId);
                const modal = new ModalBuilder()
                    .setCustomId(makeId('lelang', 'list_modal', interaction.user.id, `${durStr}|${itemKind}|${rowId}|${itemId}`, now))
                    .setTitle(`Lelang: ${asset.name.slice(0, 28)}`);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('start_price')
                            .setLabel('Harga Awal Lelang (Min Lp 10.000)')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Contoh: 25000')
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('reserve_price')
                            .setLabel('Harga Reserve Opsional (0 = Tanpa)')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('0')
                            .setValue('0')
                            .setRequired(false)
                    )
                );
                return await interaction.showModal(modal);
            },

            async cancel(interaction, parsed) {
                const now = Date.now();
                const res = await cancelAuctionListing(interaction.user.id, Number(parsed.arg || 0), now);
                const state = await fetchAuctionState(interaction.user.id, now);
                return await interaction.update({
                    ...buildLelangPanel({
                        state,
                        tab: 'mine',
                        banner: formatAuctionBanner(res),
                        now
                    }),
                    attachments: []
                });
            },

            async claim_all(interaction) {
                const now = Date.now();
                const res = await claimAuctionItems(interaction.user.id, null, now);
                const state = await fetchAuctionState(interaction.user.id, now);
                return await interaction.update({
                    ...buildLelangPanel({
                        state,
                        tab: 'mine',
                        banner: formatAuctionBanner(res),
                        now
                    }),
                    attachments: []
                });
            }
        },

        selects: {
            async pick_auction(interaction) {
                const now = Date.now();
                const auctionId = interaction.values[0] || '';
                const state = await fetchAuctionState(interaction.user.id, now);
                return await interaction.update({
                    ...buildLelangPanel({
                        state,
                        tab: 'browse',
                        selectedAuctionId: auctionId,
                        now
                    }),
                    attachments: []
                });
            },

            async pick_sell_item(interaction) {
                const now = Date.now();
                const raw = String(interaction.values[0] || '');
                const [durStr = '12', selKey = ''] = raw.split('~');
                const [itemKind = 'inventory'] = selKey.split('|');
                const state = await fetchAuctionState(interaction.user.id, now);
                return await interaction.update({
                    ...buildLelangPanel({
                        state,
                        tab: 'sell',
                        sellSource: itemKind,
                        sellSelectionKey: selKey,
                        durationHours: Number(durStr) || 12,
                        now
                    }),
                    attachments: []
                });
            }
        },

        modals: {
            async bid_modal(interaction, parsed) {
                const now = Date.now();
                const auctionId = parsed.arg || '0';
                const parsedBid = parseModalNumber(interaction, 'amount', {
                    min: AUCTION_CONSTANTS.MIN_START_PRICE,
                    max: 999999999
                });

                let res;
                if (!parsedBid.ok) {
                    res = { ok: false, error: 'BID_TOO_LOW', minRequiredBid: AUCTION_CONSTANTS.MIN_START_PRICE };
                } else {
                    res = await placeAuctionBid(interaction.user.id, Number(auctionId), parsedBid.value, now);
                }

                const state = await fetchAuctionState(interaction.user.id, now);
                const payload = buildLelangPanel({
                    state,
                    tab: 'browse',
                    selectedAuctionId: auctionId,
                    banner: formatAuctionBanner(res),
                    now
                });
                if (typeof interaction.update === 'function') {
                    return await interaction.update({ ...payload, attachments: [] });
                }
                return await interaction.reply(payload);
            },

            async list_modal(interaction, parsed) {
                const now = Date.now();
                const [durStr = '12', itemKind = 'inventory', rowId = '0', itemId = ''] = String(parsed.arg || '').split('|');
                const parsedStart = parseModalNumber(interaction, 'start_price', {
                    min: AUCTION_CONSTANTS.MIN_START_PRICE,
                    max: 999999999
                });

                const reserveRaw = (interaction.fields.getTextInputValue('reserve_price') || '0').trim();
                let reserveVal = 0;
                let reserveInvalid = false;
                if (reserveRaw !== '' && reserveRaw !== '0') {
                    const parsedRes = parseModalNumber(interaction, 'reserve_price', { min: 0, max: 999999999 });
                    if (!parsedRes.ok) {
                        reserveInvalid = true;
                    } else {
                        reserveVal = parsedRes.value;
                    }
                }

                let res;
                if (!parsedStart.ok) {
                    res = { ok: false, error: 'START_PRICE_TOO_LOW', minStartPrice: AUCTION_CONSTANTS.MIN_START_PRICE };
                } else if (reserveInvalid) {
                    res = { ok: false, error: 'INVALID_RESERVE_PRICE', startPrice: parsedStart.value };
                } else {
                    res = await createAuctionListing(interaction.user.id, {
                        itemKind,
                        sourceRowId: itemKind === 'inventory' && Number(rowId) > 0 ? Number(rowId) : null,
                        itemId,
                        durationHours: Number(durStr) || 12,
                        startPrice: parsedStart.value,
                        reservePrice: reserveVal,
                        now
                    });
                }

                const state = await fetchAuctionState(interaction.user.id, now);
                const payload = buildLelangPanel({
                    state,
                    tab: res.ok ? 'mine' : 'sell',
                    sellSource: itemKind,
                    sellSelectionKey: `${itemKind}|${rowId}|${itemId}`,
                    durationHours: Number(durStr) || 12,
                    banner: formatAuctionBanner(res),
                    now
                });
                if (typeof interaction.update === 'function') {
                    return await interaction.update({ ...payload, attachments: [] });
                }
                return await interaction.reply(payload);
            }
        }
    },

    buildLelangPanel
};
