const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const {
    JASA_CONSTANTS,
    getJasaItemBasePrice,
    getJasaTradableItems,
    validateJasaOrderInput,
    fetchJasaState,
    createJasaContract,
    fulfillJasaContract,
    cancelJasaContract,
    claimJasaDeliveries
} = require('../../services/jasaService');
const { makeId } = require('../../utils/panelId');
const { getCity, CITIES, DEFAULT_CITY_ID } = require('../../data/cities');
const { getItem } = require('../../data/items');
const { COLORS, formatLp, formatDuration } = require('../../utils/uiBuilder');
const { buildPanel, btn, select, parseModalNumber } = require('../../utils/panelBuilder');

const CITY_IDS = CITIES.map(c => c.id);

function getNextCityId(currentCityId) {
    const idx = CITY_IDS.indexOf(currentCityId);
    return CITY_IDS[(idx + 1) % CITY_IDS.length];
}

function formatJasaBanner(res) {
    if (!res) return null;
    if (!res.ok) {
        if (res.error === 'INSUFFICIENT_FUNDS') {
            return {
                type: 'danger',
                text: `Saldo Cash + Bank (${formatLp(res.totalFunds)}) tidak cukup untuk jaminan escrow sebesar **${formatLp(res.required)}**.`
            };
        }
        if (res.error === 'TOO_MANY_OPEN_ORDERS') {
            return {
                type: 'warning',
                text: `Kamu sudah memiliki maksimal **${res.openCount}/${res.max}** kontrak Jasa aktif.`
            };
        }
        if (res.error === 'REWARD_OUT_OF_BOUNDS') {
            return {
                type: 'warning',
                text: `Upah untuk **${res.qty}× ${res.item.name}** wajib di rentang **${formatLp(res.minRewardLp)} – ${formatLp(res.maxRewardLp)}** (0.5×–5.0× nilai dasar, min Lp 5.000).`
            };
        }
        if (res.error === 'INVALID_QTY') {
            return {
                type: 'warning',
                text: `Jumlah barang kontrak wajib antara **${JASA_CONSTANTS.MIN_QTY}–${JASA_CONSTANTS.MAX_QTY}**.`
            };
        }
        if (res.error === 'WRONG_CITY') {
            const reqCity = getCity(res.requiredCityId);
            const curCity = getCity(res.currentCityId);
            return {
                type: 'warning',
                text: `Kontrak ini ditujukan di ${reqCity.emoji} **${reqCity.name}**, sedangkan kamu saat ini di ${curCity.emoji} **${curCity.name}**. Gunakan \`/travel\` ke kota tujuan dulu!`
            };
        }
        if (res.error === 'SELF_FULFILL') {
            return { type: 'warning', text: 'Kamu tidak dapat mengerjakan kontrak yang kamu pasang sendiri.' };
        }
        if (res.error === 'INSUFFICIENT_ITEM') {
            return {
                type: 'warning',
                text: `Stok **${res.item?.name || 'barang'}** di tasmu (${res.owned}/${res.required}) belum cukup untuk menyelesaikan kontrak ini.`
            };
        }
        if (res.error === 'BAG_FULL') {
            return {
                type: 'warning',
                text: `Slot tas penuh (${res.slotsUsed}/${res.maxSlots})! Kosongkan tas di \`/inventory\` atau \`/storage\` sebelum mengklaim kiriman.`
            };
        }
        if (res.error === 'TRAVELLING') {
            return { type: 'warning', text: 'Tunggu perjalanan `/travel` selesai terlebih dahulu.' };
        }
        if (res.error === 'CONTRACT_NOT_OPEN' || res.error === 'CONTRACT_EXPIRED' || res.error === 'CONTRACT_NOT_FOUND') {
            return { type: 'warning', text: 'Kontrak ini sudah diambil warga lain, dibatalkan, atau kedaluwarsa.' };
        }
        if (res.error === 'NO_DELIVERIES') {
            return { type: 'warning', text: 'Kotak pengambilan kirimanmu masih kosong.' };
        }
        return { type: 'danger', text: 'Gagal memproses operasi papan Jasa.' };
    }

    if (res.contract && res.workerPayoutLp) {
        return {
            type: 'success',
            text: `🤝 Kontrak #${res.contract.id} (**${res.contract.quantity}× ${res.item?.name || res.contract.item_id}**) selesai! Kamu menerima upah bersih **+${formatLp(res.workerPayoutLp)}** *(potongan pajak kota 5%: ${formatLp(res.taxLp)})*.`
        };
    }

    if (res.contract && res.validation) {
        return {
            type: 'success',
            text: `📋 Order Jasa #${res.contract.id} dipasang di ${res.city.emoji} **${res.city.shortName}**: butuh **${res.contract.quantity}× ${res.validation.item.name}** dengan jaminan **${formatLp(res.contract.reward_lp)}** (berlaku 48 jam).`
        };
    }

    if (res.refundLp) {
        return {
            type: 'success',
            text: `↩️ Kontrak #${res.contract.id} dibatalkan. Dana jaminan **+${formatLp(res.refundLp)}** dikembalikan utuh ke Cash.`
        };
    }

    if (res.claimed) {
        const summary = res.claimed.map(c => `${c.quantity}× ${c.item ? `${c.item.emoji} ${c.item.name}` : c.itemId}`).join(', ');
        const extra = res.partialBagFull ? ' *(Sebagian tertunda karena tas penuh)*' : '';
        return {
            type: 'success',
            text: `📦 Berhasil mengambil kiriman Jasa ke tasmu: **${summary}**${extra}!`
        };
    }

    return null;
}

function buildJasaPanel({
    state,
    tab = 'board',
    cityFilter = 'all',
    selectedContractId = null,
    createCategory = 'alam',
    createItemId = null,
    targetCityId = null,
    banner = null,
    now = Date.now()
}) {
    const { player: p, invRows, slotsUsed, openContracts, myContracts, claimBoxes } = state;
    const ownerId = p.discord_id;
    const activeTab = ['board', 'create', 'mine'].includes(tab) ? tab : 'board';
    const currentCity = getCity(p.current_city || DEFAULT_CITY_ID);
    const chosenTargetCity = getCity(targetCityId || p.current_city || DEFAULT_CITY_ID);

    const bagCounts = new Map();
    for (const r of invRows) {
        bagCounts.set(r.item_id, (bagCounts.get(r.item_id) || 0) + Number(r.quantity || 0));
    }

    const tabRow = new ActionRowBuilder().addComponents(
        btn('jasa', 'tab', ownerId, {
            label: `Papan Order (${openContracts.length})`,
            emoji: '📋',
            style: activeTab === 'board' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: `board|${cityFilter}`
        }, now),
        btn('jasa', 'tab', ownerId, {
            label: 'Pasang Order',
            emoji: '➕',
            style: activeTab === 'create' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: `create|${createCategory}`
        }, now),
        btn('jasa', 'tab', ownerId, {
            label: `Orderku & Klaim (${claimBoxes.length})`,
            emoji: '📦',
            style: activeTab === 'mine' ? ButtonStyle.Primary : ButtonStyle.Secondary,
            arg: `mine|${cityFilter}`
        }, now)
    );

    const blocks = [
        `📍 **Lokasi Saat Ini:** ${currentCity.emoji} **${currentCity.name}** · 🎒 **Tas:** \`${slotsUsed}/${p.max_slots}\` · 📦 **Siap Diklaim:** **${claimBoxes.length} paket**`
    ];
    const rows = [tabRow];

    if (activeTab === 'board') {
        const filterRow = new ActionRowBuilder().addComponents(
            btn('jasa', 'filter', ownerId, {
                label: 'Semua Kota',
                emoji: '🌐',
                style: cityFilter === 'all' ? ButtonStyle.Success : ButtonStyle.Secondary,
                arg: 'all'
            }, now),
            ...CITIES.map(c =>
                btn('jasa', 'filter', ownerId, {
                    label: c.shortName,
                    emoji: c.emoji,
                    style: cityFilter === c.id ? ButtonStyle.Success : ButtonStyle.Secondary,
                    arg: c.id
                }, now)
            )
        );
        rows.push(filterRow);

        const chosen = openContracts.find(c => String(c.id) === String(selectedContractId)) || openContracts[0] || null;
        if (!chosen) {
            blocks.push('📭 Belum ada kontrak order Jasa terbuka pada filter kota ini. Buka tab **Pasang Order** untuk membuat kontrak!');
        } else {
            const listLines = openContracts.slice(0, 6).map(c => {
                const it = getItem(c.item_id);
                const cCity = getCity(c.target_city_id);
                const ptr = c.id === chosen.id ? '▶️ ' : '• ';
                return `${ptr}**#${c.id}** ${it ? `${it.emoji} **${it.name}**` : c.item_id} ×${c.quantity} → ${cCity.emoji} ${cCity.shortName} · Upah **${formatLp(c.reward_lp)}**`;
            });
            blocks.push(listLines.join('\n'));

            const chosenItem = getItem(chosen.item_id);
            const chosenCity = getCity(chosen.target_city_id);
            const ownedQty = bagCounts.get(chosen.item_id) || 0;
            const taxEst = Math.round(Number(chosen.reward_lp) * JASA_CONSTANTS.TAX_RATE);
            const payoutEst = Number(chosen.reward_lp) - taxEst;
            const isSelf = chosen.requester_id === ownerId;
            const inRightCity = currentCity.id === chosenCity.id;
            const remMs = Math.max(0, Number(chosen.expires_at) - now);

            blocks.push([
                `**Detail Kontrak #${chosen.id}** *(Pemesan: ${chosen.requester_name || `<@${chosen.requester_id}>`})*`,
                `• 📦 Kebutuhan: **${chosen.quantity}× ${chosenItem ? `${chosenItem.emoji} ${chosenItem.name}` : chosen.item_id}** *(Di tasmu: ${ownedQty})*`,
                `• 🏙️ Lokasi Antar: ${chosenCity.emoji} **${chosenCity.name}** ${inRightCity ? '✅' : '*(Harus `/travel` ke sana)*'}`,
                `• 💵 Upah Bersih Pekerja: **${formatLp(payoutEst)}** *(Pajak 5%: ${formatLp(taxEst)})* · Sisa Waktu: **${formatDuration(remMs)}**`,
                chosen.note ? `• 📝 Catatan: *"${chosen.note}"*` : null
            ].filter(Boolean).join('\n'));

            rows.push(
                select('jasa', 'pick_contract', ownerId, {
                    placeholder: '📋 Pilih kontrak yang ingin diperiksa / dikerjakan...',
                    options: openContracts.slice(0, 25).map(c => {
                        const it = getItem(c.item_id);
                        const cCity = getCity(c.target_city_id);
                        return {
                            label: `#${c.id} ${c.quantity}x ${it ? it.name : c.item_id} (${formatLp(c.reward_lp)})`.slice(0, 100),
                            value: `${cityFilter}|${c.id}`,
                            emoji: it?.emoji || '📦',
                            description: `Antar ke ${cCity.shortName}`.slice(0, 100),
                            default: c.id === chosen.id
                        };
                    })
                }, now)
            );

            rows.push(
                new ActionRowBuilder().addComponents(
                    btn('jasa', 'fulfill', ownerId, {
                        label: isSelf ? 'Kontrak Milikmu Sendiri' : `Antar & Terima ${formatLp(payoutEst)}`,
                        emoji: '🤝',
                        style: isSelf || !inRightCity || ownedQty < Number(chosen.quantity) ? ButtonStyle.Secondary : ButtonStyle.Success,
                        arg: `${cityFilter}|${chosen.id}`,
                        disabled: isSelf || !inRightCity || ownedQty < Number(chosen.quantity)
                    }, now)
                )
            );
        }
    } else if (activeTab === 'create') {
        const activeCat = ['alam', 'tani', 'suplai'].includes(createCategory) ? createCategory : 'alam';
        const catItems = getJasaTradableItems(activeCat).slice(0, 25);
        const chosenItem = catItems.find(i => i.id === createItemId) || catItems[0] || null;

        rows.push(
            new ActionRowBuilder().addComponents(
                btn('jasa', 'cat', ownerId, {
                    label: 'Alam & Tambang',
                    emoji: '🪵',
                    style: activeCat === 'alam' ? ButtonStyle.Success : ButtonStyle.Secondary,
                    arg: `alam|${chosenTargetCity.id}`
                }, now),
                btn('jasa', 'cat', ownerId, {
                    label: 'Tani & Ternak',
                    emoji: '🌾',
                    style: activeCat === 'tani' ? ButtonStyle.Success : ButtonStyle.Secondary,
                    arg: `tani|${chosenTargetCity.id}`
                }, now),
                btn('jasa', 'cat', ownerId, {
                    label: 'Suplai & Olahan',
                    emoji: '🛠️',
                    style: activeCat === 'suplai' ? ButtonStyle.Success : ButtonStyle.Secondary,
                    arg: `suplai|${chosenTargetCity.id}`
                }, now),
                btn('jasa', 'cycle_city', ownerId, {
                    label: `Tujuan: ${chosenTargetCity.shortName}`,
                    emoji: chosenTargetCity.emoji,
                    style: ButtonStyle.Primary,
                    arg: `${activeCat}|${chosenItem ? chosenItem.id : ''}|${getNextCityId(chosenTargetCity.id)}`
                }, now)
            )
        );

        const openOwnedCount = myContracts.filter(c => c.status === 'open').length;

        if (!chosenItem) {
            blocks.push('Tidak ada item katalog pada kategori ini.');
        } else {
            const sampleCheck10 = validateJasaOrderInput(chosenItem.id, 10, 999999999);
            const sample10 = validateJasaOrderInput(chosenItem.id, 10, sampleCheck10.minRewardLp || JASA_CONSTANTS.MIN_REWARD_LP);
            const unitBase = getJasaItemBasePrice(chosenItem);
            const fair10Lp = Math.max(sample10.minRewardLp || JASA_CONSTANTS.MIN_REWARD_LP, Math.min(sample10.maxRewardLp || JASA_CONSTANTS.MIN_REWARD_LP, Math.round(unitBase * 10 * 1.2)));

            blocks.push([
                `**Item Terpilih:** ${chosenItem.emoji} **${chosenItem.name}** *(Harga Dasar: ${formatLp(unitBase)}/bh)*`,
                `• 🏙️ **Kota Pengiriman:** ${chosenTargetCity.emoji} **${chosenTargetCity.name}** *(Barang masuk ke Kotak Klaim di kota ini)*`,
                `• 📋 **Kuota Order Aktif:** \`${openOwnedCount}/${JASA_CONSTANTS.MAX_OPEN_ORDERS}\` · Pajak Kontrak: **5%** *(dipotong saat selesai)*`,
                `• 💡 **Contoh ×10:** Rentang Upah **${formatLp(sample10.minRewardLp)} – ${formatLp(sample10.maxRewardLp)}**`
            ].join('\n'));

            rows.push(
                select('jasa', 'pick_create_item', ownerId, {
                    placeholder: '🛒 Pilih barang yang ingin diorder...',
                    options: catItems.map(it => ({
                        label: `${it.name} (${formatLp(getJasaItemBasePrice(it))}/bh)`.slice(0, 100),
                        value: `${activeCat}|${chosenTargetCity.id}|${it.id}`,
                        emoji: it.emoji,
                        default: it.id === chosenItem.id
                    }))
                }, now)
            );

            rows.push(
                new ActionRowBuilder().addComponents(
                    btn('jasa', 'quick_create', ownerId, {
                        label: `Order 10× (${formatLp(fair10Lp)})`,
                        emoji: '⚡',
                        style: ButtonStyle.Success,
                        arg: `${activeCat}|${chosenTargetCity.id}|${chosenItem.id}|10|${fair10Lp}`,
                        disabled: openOwnedCount >= JASA_CONSTANTS.MAX_OPEN_ORDERS
                    }, now),
                    btn('jasa', 'open_create_modal', ownerId, {
                        label: 'Atur Jumlah & Upah Custom',
                        emoji: '✏️',
                        style: ButtonStyle.Primary,
                        arg: `${activeCat}|${chosenTargetCity.id}|${chosenItem.id}`,
                        disabled: openOwnedCount >= JASA_CONSTANTS.MAX_OPEN_ORDERS
                    }, now)
                )
            );
        }
    } else {
        const myOpen = myContracts.filter(c => c.status === 'open');
        const claimLocalCount = claimBoxes.filter(b => b.delivery_city_id === currentCity.id).length;

        if (claimBoxes.length === 0) {
            blocks.push('📭 **Kotak Klaim Kiriman:** Kosong.');
        } else {
            const boxLines = claimBoxes.slice(0, 6).map(b => {
                const it = getItem(b.item_id);
                const cCity = getCity(b.delivery_city_id);
                const hereMark = b.delivery_city_id === currentCity.id ? '✅ Siap diambil' : '*(Perlu ke kota ini)*';
                return `• **#${b.contract_id}** ${it ? `${it.emoji} **${it.name}**` : b.item_id} ×${b.quantity} — ${cCity.emoji} ${cCity.shortName} ${hereMark}`;
            });
            blocks.push(['**📦 KOTAK KLAIM KIRIMAN MASUK:**', ...boxLines].join('\n'));
        }

        if (myContracts.length === 0) {
            blocks.push('📋 **Riwayat Order Kamu:** Belum ada order Jasa yang dipasang.');
        } else {
            const histLines = myContracts.slice(0, 6).map(c => {
                const it = getItem(c.item_id);
                const cCity = getCity(c.target_city_id);
                return `• **#${c.id}** [${c.status.toUpperCase()}] ${it ? it.name : c.item_id} ×${c.quantity} → ${cCity.shortName} (${formatLp(c.reward_lp)})`;
            });
            blocks.push(['**📋 KONTRAK YANG KAMU PASANG:**', ...histLines].join('\n'));
        }

        const mineActions = [];
        mineActions.push(
            btn('jasa', 'claim_all', ownerId, {
                label: `Ambil Kiriman di ${currentCity.shortName} (${claimLocalCount})`,
                emoji: '📥',
                style: claimLocalCount > 0 ? ButtonStyle.Success : ButtonStyle.Secondary,
                arg: cityFilter,
                disabled: claimLocalCount <= 0
            }, now)
        );
        for (const oc of myOpen.slice(0, 3)) {
            const it = getItem(oc.item_id);
            mineActions.push(
                btn('jasa', 'cancel', ownerId, {
                    label: `Batalkan #${oc.id} (${it ? it.name.slice(0, 12) : oc.item_id})`,
                    emoji: '❌',
                    style: ButtonStyle.Danger,
                    arg: `${cityFilter}|${oc.id}`
                }, now)
            );
        }
        rows.push(new ActionRowBuilder().addComponents(mineActions.slice(0, 4)));
    }

    return buildPanel({
        mod: 'jasa',
        ownerId,
        player: p,
        accentColor: COLORS.PRIMARY,
        title: '🤝 Papan Order Jasa & Logistik Antar-Kota',
        banner,
        blocks,
        rows,
        footer: 'Batas upah 0.5×–5.0× nilai dasar (min Lp 5.000) • Pajak kota 5% • Refund otomatis jika >48 jam.',
        now
    });
}

module.exports = {
    name: 'jasa',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('jasa')
        .setDescription('Papan kontrak jasa & pengiriman barang antar-kota beserta jaminan escrow.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchJasaState(interaction.user.id, 'all', now);
        return await interaction.reply(buildJasaPanel({ state, now }));
    },

    panel: {
        buttons: {
            async tab(interaction, parsed) {
                const now = Date.now();
                const [tab = 'board', arg2 = 'all'] = String(parsed.arg || '').split('|');
                const cityFilter = tab === 'board' ? arg2 : 'all';
                const createCategory = tab === 'create' ? arg2 : 'alam';
                const state = await fetchJasaState(interaction.user.id, cityFilter, now);
                return await interaction.update({
                    ...buildJasaPanel({ state, tab, cityFilter, createCategory, now }),
                    attachments: []
                });
            },

            async filter(interaction, parsed) {
                const now = Date.now();
                const cityFilter = parsed.arg || 'all';
                const state = await fetchJasaState(interaction.user.id, cityFilter, now);
                return await interaction.update({
                    ...buildJasaPanel({ state, tab: 'board', cityFilter, now }),
                    attachments: []
                });
            },

            async cat(interaction, parsed) {
                const now = Date.now();
                const [cat = 'alam', targetCityId = ''] = String(parsed.arg || '').split('|');
                const state = await fetchJasaState(interaction.user.id, 'all', now);
                return await interaction.update({
                    ...buildJasaPanel({
                        state,
                        tab: 'create',
                        createCategory: cat,
                        targetCityId: targetCityId || undefined,
                        now
                    }),
                    attachments: []
                });
            },

            async cycle_city(interaction, parsed) {
                const now = Date.now();
                const [cat = 'alam', itemId = '', nextCityId = DEFAULT_CITY_ID] = String(parsed.arg || '').split('|');
                const state = await fetchJasaState(interaction.user.id, 'all', now);
                return await interaction.update({
                    ...buildJasaPanel({
                        state,
                        tab: 'create',
                        createCategory: cat,
                        createItemId: itemId || null,
                        targetCityId: nextCityId,
                        now
                    }),
                    attachments: []
                });
            },

            async quick_create(interaction, parsed) {
                const now = Date.now();
                const [cat = 'alam', targetCityId = DEFAULT_CITY_ID, itemId = '', rawQty = '10', rawReward = '5000'] = String(parsed.arg || '').split('|');
                const res = await createJasaContract(interaction.user.id, {
                    targetCityId,
                    itemId,
                    quantity: Number(rawQty),
                    rewardLp: Number(rawReward),
                    now
                });
                const state = await fetchJasaState(interaction.user.id, 'all', now);
                return await interaction.update({
                    ...buildJasaPanel({
                        state,
                        tab: res.ok ? 'mine' : 'create',
                        createCategory: cat,
                        createItemId: itemId,
                        targetCityId,
                        banner: formatJasaBanner(res),
                        now
                    }),
                    attachments: []
                });
            },

            async open_create_modal(interaction, parsed) {
                const now = Date.now();
                const [cat = 'alam', targetCityId = DEFAULT_CITY_ID, itemId = ''] = String(parsed.arg || '').split('|');
                const item = getItem(itemId);
                const modal = new ModalBuilder()
                    .setCustomId(makeId('jasa', 'create_modal', interaction.user.id, `${cat}|${targetCityId}|${itemId}`, now))
                    .setTitle(`Order: ${item ? item.name.slice(0, 30) : 'Barang'}`);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('quantity')
                            .setLabel('Jumlah Barang (1 - 50)')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Contoh: 20')
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('reward')
                            .setLabel('Total Upah Kontrak (Lp)')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Contoh: 75000')
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('note')
                            .setLabel('Catatan Kontrak (Opsional)')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(120)
                            .setPlaceholder('Butuh cepat untuk proyek!')
                            .setRequired(false)
                    )
                );
                return await interaction.showModal(modal);
            },

            async fulfill(interaction, parsed) {
                const now = Date.now();
                const [cityFilter = 'all', contractIdStr = '0'] = String(parsed.arg || '').split('|');
                const res = await fulfillJasaContract(interaction.user.id, Number(contractIdStr), now);
                const state = await fetchJasaState(interaction.user.id, cityFilter, now);
                return await interaction.update({
                    ...buildJasaPanel({
                        state,
                        tab: 'board',
                        cityFilter,
                        banner: formatJasaBanner(res),
                        now
                    }),
                    attachments: []
                });
            },

            async cancel(interaction, parsed) {
                const now = Date.now();
                const [cityFilter = 'all', contractIdStr = '0'] = String(parsed.arg || '').split('|');
                const res = await cancelJasaContract(interaction.user.id, Number(contractIdStr), now);
                const state = await fetchJasaState(interaction.user.id, cityFilter, now);
                return await interaction.update({
                    ...buildJasaPanel({
                        state,
                        tab: 'mine',
                        cityFilter,
                        banner: formatJasaBanner(res),
                        now
                    }),
                    attachments: []
                });
            },

            async claim_all(interaction, parsed) {
                const now = Date.now();
                const cityFilter = parsed.arg || 'all';
                const res = await claimJasaDeliveries(interaction.user.id, null, now);
                const state = await fetchJasaState(interaction.user.id, cityFilter, now);
                return await interaction.update({
                    ...buildJasaPanel({
                        state,
                        tab: 'mine',
                        cityFilter,
                        banner: formatJasaBanner(res),
                        now
                    }),
                    attachments: []
                });
            }
        },

        selects: {
            async pick_contract(interaction) {
                const now = Date.now();
                const [cityFilter = 'all', contractId = ''] = String(interaction.values[0] || '').split('|');
                const state = await fetchJasaState(interaction.user.id, cityFilter, now);
                return await interaction.update({
                    ...buildJasaPanel({
                        state,
                        tab: 'board',
                        cityFilter,
                        selectedContractId: contractId,
                        now
                    }),
                    attachments: []
                });
            },

            async pick_create_item(interaction) {
                const now = Date.now();
                const [cat = 'alam', targetCityId = DEFAULT_CITY_ID, itemId = ''] = String(interaction.values[0] || '').split('|');
                const state = await fetchJasaState(interaction.user.id, 'all', now);
                return await interaction.update({
                    ...buildJasaPanel({
                        state,
                        tab: 'create',
                        createCategory: cat,
                        targetCityId,
                        createItemId: itemId,
                        now
                    }),
                    attachments: []
                });
            }
        },

        modals: {
            async create_modal(interaction, parsed) {
                const now = Date.now();
                const [cat = 'alam', targetCityId = DEFAULT_CITY_ID, itemId = ''] = String(parsed.arg || '').split('|');
                const parsedQty = parseModalNumber(interaction, 'quantity', {
                    min: JASA_CONSTANTS.MIN_QTY,
                    max: JASA_CONSTANTS.MAX_QTY
                });
                const parsedReward = parseModalNumber(interaction, 'reward', {
                    min: JASA_CONSTANTS.MIN_REWARD_LP,
                    max: 50000000
                });
                const note = interaction.fields.getTextInputValue('note') || null;

                let res;
                if (!parsedQty.ok) {
                    res = { ok: false, error: 'INVALID_QTY' };
                } else if (!parsedReward.ok) {
                    res = validateJasaOrderInput(itemId, parsedQty.value, 0);
                } else {
                    res = await createJasaContract(interaction.user.id, {
                        targetCityId,
                        itemId,
                        quantity: parsedQty.value,
                        rewardLp: parsedReward.value,
                        note,
                        now
                    });
                }

                const state = await fetchJasaState(interaction.user.id, 'all', now);
                const payload = buildJasaPanel({
                    state,
                    tab: res.ok ? 'mine' : 'create',
                    createCategory: cat,
                    targetCityId,
                    createItemId: itemId,
                    banner: formatJasaBanner(res),
                    now
                });
                if (typeof interaction.update === 'function') {
                    return await interaction.update({ ...payload, attachments: [] });
                }
                return await interaction.reply(payload);
            }
        }
    },

    buildJasaPanel
};
