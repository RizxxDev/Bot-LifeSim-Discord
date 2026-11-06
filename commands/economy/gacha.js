const { SlashCommandBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getPlayerInventory, calculateSlotsUsed } = require('../../services/inventoryService');
const {
    RARITY_ORDER,
    RARITY_META,
    getAllGachaTiers,
    getGachaTier
} = require('../../data/gacha');
const {
    resolvePrizeMetadata,
    getPlayerGachaStats,
    getPlayerTicketCounts,
    executeGachaPull
} = require('../../services/gachaService');
const { getItem } = require('../../data/items');
const { formatLp } = require('../../utils/uiBuilder');
const { buildPanel, btn, select } = require('../../utils/panelBuilder');

async function fetchGachaState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const bagRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const slotsUsed = calculateSlotsUsed(bagRows);
        const ticketCounts = getPlayerTicketCounts(bagRows);
        const stats = await getPlayerGachaStats(conn, discordId);

        return {
            player: synced.player,
            bagRows,
            slotsUsed,
            ticketCounts,
            stats
        };
    });
}

function formatPullCostText(tier, count, availableTickets) {
    const ticketsUsed = Math.min(count, availableTickets);
    const lpNeeded = (count - ticketsUsed) * Number(tier.priceLp);
    const ticketItem = getItem(tier.ticketItemId);
    const ticketEmoji = ticketItem ? ticketItem.emoji : '🎟️';

    if (ticketsUsed === count) {
        return `${ticketEmoji} ${ticketsUsed} Tiket (Gratis Lp)`;
    }
    if (ticketsUsed > 0) {
        return `${ticketEmoji} ${ticketsUsed} Tiket + ${formatLp(lpNeeded)}`;
    }
    return formatLp(lpNeeded);
}

function buildGachaPanel({
    state,
    tierId = 'warung',
    mode = 'machine',
    lastPullResult = null,
    banner = null,
    now = Date.now()
}) {
    const { player: p, slotsUsed, ticketCounts, stats } = state;
    const ownerId = p.discord_id;
    const maxSlots = Number(p.max_slots || 20);
    const tier = getGachaTier(tierId);
    const ticketItem = getItem(tier.ticketItemId);
    const availableTickets = Number(ticketCounts?.[tier.ticketItemId] || 0);
    const totalFunds = Number(p.cash || 0) + Number(p.bank || 0);

    const cost1Lp = Math.max(0, 1 - Math.min(1, availableTickets)) * tier.priceLp;
    const cost10Lp = Math.max(0, 10 - Math.min(10, availableTickets)) * tier.priceLp;
    const bagHasSpace = slotsUsed < maxSlots;
    const canPull1 = bagHasSpace && totalFunds >= cost1Lp;
    const canPull10 = bagHasSpace && totalFunds >= cost10Lp;

    const blocks = [
        [
            `🎟️ **Tiket Warung:** \`×${ticketCounts?.tiket_gacha_warung || 0}\` · 🎫 **Tiket Mall:** \`×${ticketCounts?.tiket_gacha_mall || 0}\` · 💳 **Tiket Sultan:** \`×${ticketCounts?.tiket_gacha_sultan || 0}\``,
            `🎒 **Kapasitas Tas:** \`${slotsUsed}/${maxSlots} slot\` · 🎰 **Total Tarikanmu:** **${stats?.total_pulls || 0}×** *(🌟 Jackpot: **${stats?.jackpot_count || 0}×**)*`
        ].join('\n')
    ];

    if (mode === 'rates') {
        const groupedLines = [];
        for (const rKey of [...RARITY_ORDER].reverse()) {
            const rMeta = RARITY_META[rKey];
            const entries = tier.lootTable.filter(e => e.rarity === rKey);
            if (entries.length === 0) continue;

            const groupWeight = entries.reduce((s, e) => s + Number(e.weight || 0), 0);
            const itemTexts = entries.map(e => {
                const m = resolvePrizeMetadata(e);
                return `  • **${e.qty}× ${m.emoji} ${m.name}** *(${e.weight}%)*`;
            });

            groupedLines.push(
                `**${rMeta.emoji} ${rMeta.label} — Total ${groupWeight}%** *(Duplikat Unik → +${rMeta.duplicateTickets}× ${ticketItem.emoji})*\n${itemTexts.join('\n')}`
            );
        }

        blocks.push(
            `### 📋 Transparansi Rate & Hadiah: ${tier.emoji} ${tier.name}\n${groupedLines.join('\n\n')}`,
            `💡 **Aturan Jaminan & Duplikat:**\n• **10× Pull Guarantee:** Menjamin minimal **1 hadiah Rare ke atas (\`Rare\` / \`Epic\` / \`Legendary\`)**!\n• **Konversi Duplikat Otomatis:** Jika kamu mendapatkan **Kendaraan, Gelar, Lisensi, atau Alat Kerja** yang sudah kamu miliki, hadiah otomatis diubah menjadi **${ticketItem.emoji} ${ticketItem.name}** sesuai tingkat Rarity-nya.`
        );
    } else {
        const highlights = tier.lootTable
            .filter(e => e.rarity === 'legendary' || e.rarity === 'epic')
            .map(e => {
                const m = resolvePrizeMetadata(e);
                const rMeta = RARITY_META[e.rarity];
                return `${rMeta.emoji} **${m.emoji} ${m.name}**`;
            });

        blocks.push(
            [
                `### ${tier.emoji} Mesin Aktif: ${tier.name}`,
                `${tier.description}`,
                `• 💰 **Biaya 1× Putar:** **${formatPullCostText(tier, 1, availableTickets)}** *(Normal: ${formatLp(tier.priceLp)} atau 1× ${ticketItem.emoji})*`,
                `• ✨ **Biaya 10× Putar (Jaminan Rare+):** **${formatPullCostText(tier, 10, availableTickets)}**`,
                `• 🏆 **Hadiah Utama (Epic & Jackpot):** ${highlights.join(' · ')}`
            ].join('\n')
        );

        if (lastPullResult && Array.isArray(lastPullResult.results) && lastPullResult.results.length > 0) {
            const pullLines = lastPullResult.results.map((r, idx) => {
                const guaranteeBadge = r.entry.guaranteedRarePlus ? ' *(✨ Jaminan Rare+)*' : '';
                const dupBadge = r.isDuplicate
                    ? ` ➡️ 🔄 **Duplikat → +${r.duplicateTickets}× ${ticketItem.emoji} Tiket**`
                    : '';
                return `${idx + 1}. ${r.rarityInfo.emoji} **[${r.rarityInfo.label}]** **${r.entry.qty}× ${r.meta.emoji} ${r.meta.name}**${guaranteeBadge}${dupBadge}`;
            });

            const paymentSummary = [];
            if (lastPullResult.ticketsUsed > 0) {
                paymentSummary.push(`${lastPullResult.ticketsUsed}× ${ticketItem.emoji} Tiket`);
            }
            if (lastPullResult.lpPaid > 0) {
                paymentSummary.push(formatLp(lastPullResult.lpPaid));
            }

            blocks.push(
                [
                    `### 🎉 Hasil Tarikan ${lastPullResult.pullCount}× ${tier.emoji} ${tier.name} *(Dibayar: ${paymentSummary.join(' + ') || 'Gratis'})*`,
                    pullLines.join('\n')
                ].join('\n')
            );
        } else {
            blocks.push(
                [
                    `📊 **Rekap Riwayat Mesinmu:**`,
                    `• 🪙 Kapsul Warung: **${stats?.warung_pulls || 0}×** · 📦 Box Mall: **${stats?.mall_pulls || 0}×** · 💎 Brankas Sultan: **${stats?.sultan_pulls || 0}×**`,
                    `• 🔄 Total Tiket dari Konversi Duplikat: **+${stats?.duplicate_tickets_earned || 0} Tiket**`
                ].join('\n')
            );
        }
    }

    if (!bagHasSpace) {
        blocks.push(`⚠️ **Tas Penuh (${slotsUsed}/${maxSlots} slot):** Kosongkan minimal 1 slot tas lewat \`/sell\`, \`/consume\`, atau \`/storage\` sebelum memutar mesin gacha!`);
    }

    const tierSelectRow = select('gacha', 'pick_tier', ownerId, {
        placeholder: '🎰 Pilih Mesin Kapsul / Mystery Box Gacha...',
        options: getAllGachaTiers().map(t => {
            const tCount = Number(ticketCounts?.[t.ticketItemId] || 0);
            return {
                label: `${t.name} (${formatLp(t.priceLp)} / Putar)`.slice(0, 100),
                value: `${t.id}|${mode}`,
                emoji: t.emoji,
                description: `Tiketmu: ×${tCount} — ${t.description}`.slice(0, 100),
                default: t.id === tier.id
            };
        })
    }, now);

    const actionRow = new ActionRowBuilder().addComponents(
        btn('gacha', 'pull1', ownerId, {
            label: availableTickets >= 1 ? `Putar 1× (Pakai Tiket)` : `Putar 1× (${formatLp(tier.priceLp)})`,
            emoji: '🎰',
            style: ButtonStyle.Success,
            arg: tier.id,
            disabled: !canPull1
        }, now),
        btn('gacha', 'pull10', ownerId, {
            label: `Putar 10× (Jaminan Rare+)`,
            emoji: '✨',
            style: ButtonStyle.Primary,
            arg: tier.id,
            disabled: !canPull10
        }, now),
        btn('gacha', 'toggle_mode', ownerId, {
            label: mode === 'rates' ? 'Kembali ke Mesin' : 'Daftar Hadiah & Rate',
            emoji: mode === 'rates' ? '🎰' : '📋',
            style: ButtonStyle.Secondary,
            arg: `${tier.id}|${mode === 'rates' ? 'machine' : 'rates'}`
        }, now),
        btn('gacha', 'home', ownerId, {
            label: 'Segarkan',
            emoji: '🔄',
            style: ButtonStyle.Secondary,
            arg: `${tier.id}|${mode}`
        }, now)
    );

    return buildPanel({
        mod: 'gacha',
        ownerId,
        accentColor: tier.accentColor,
        title: `🎰 Pusat Kapsul & Mystery Box (/gacha)`,
        player: p,
        banner,
        blocks,
        rows: [tierSelectRow, actionRow],
        footer: 'Prioritas pembayaran otomatis memakai Tiket Gacha di tas terlebih dahulu sebelum memotong saldo Lp.',
        now
    });
}

async function handlePullInteraction(interaction, tierId, pullCount) {
    const now = Date.now();
    const userId = interaction.user.id;

    const pullRes = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, userId, now, true);
        return await executeGachaPull(conn, synced.player, tierId, pullCount, now);
    });

    const state = await fetchGachaState(userId, now);

    if (pullRes.error === 'BAG_FULL') {
        return await interaction.update(
            buildGachaPanel({
                state,
                tierId,
                mode: 'machine',
                banner: {
                    type: 'warning',
                    text: `🎒 Tas kamu penuh (${pullRes.slotsUsed}/${pullRes.maxSlots} slot)! Sisakan minimal 1 slot kosong terlebih dahulu.`
                },
                now
            })
        );
    }

    if (pullRes.error === 'INSUFFICIENT_FUNDS') {
        return await interaction.update(
            buildGachaPanel({
                state,
                tierId,
                mode: 'machine',
                banner: {
                    type: 'danger',
                    text: `Saldo Cash + Bank (${formatLp(pullRes.totalFunds)}) tidak cukup! Butuh **${formatLp(pullRes.requiredLp)}** untuk memutar ${pullCount}× **${pullRes.tier.name}**.`
                },
                now
            })
        );
    }

    let banner = {
        type: pullRes.jackpotHitCount > 0 ? 'success' : 'info',
        text: pullRes.jackpotHitCount > 0
            ? `🌟 **JACKPOT LEGENDARY!** Kamu berhasil memenangkan **${pullRes.jackpotHitCount}× hadiah Jackpot** dari **${pullRes.tier.name}**!`
            : `🎰 Berhasil membuka **${pullRes.pullCount}× ${pullRes.tier.emoji} ${pullRes.tier.name}**!${pullRes.totalDuplicateTickets > 0 ? ` (+${pullRes.totalDuplicateTickets} Tiket dari konversi duplikat)` : ''}`
    };

    if (pullRes.newlyUnlockedAchievements && pullRes.newlyUnlockedAchievements.length > 0) {
        const achNames = pullRes.newlyUnlockedAchievements.map(a => `${a.emoji} ${a.name}`).join(', ');
        banner.text += ` · 🏆 Achievement Terbuka: **${achNames}** (Klaim di \`/achievements\`)`;
    }

    return await interaction.update(
        buildGachaPanel({
            state,
            tierId: pullRes.tier.id,
            mode: 'machine',
            lastPullResult: pullRes,
            banner,
            now
        })
    );
}

module.exports = {
    name: 'gacha',
    slash: true,
    data: new SlashCommandBuilder()
        .setName('gacha')
        .setDescription('Putar Mesin Kapsul Warung, Mystery Box Mall, atau Brankas Sultan untuk hadiah eksklusif!'),

    async executeSlash(interaction) {
        const now = Date.now();
        const state = await fetchGachaState(interaction.user.id, now);
        return await interaction.reply(
            buildGachaPanel({
                state,
                tierId: 'warung',
                mode: 'machine',
                now
            })
        );
    },

    panel: {
        buttons: {
            async home(interaction, parsed) {
                const now = Date.now();
                const [tierId = 'warung', mode = 'machine'] = String(parsed.arg || 'warung|machine').split('|');
                const state = await fetchGachaState(interaction.user.id, now);
                return await interaction.update(buildGachaPanel({ state, tierId, mode, now }));
            },
            async toggle_mode(interaction, parsed) {
                const now = Date.now();
                const [tierId = 'warung', mode = 'rates'] = String(parsed.arg || 'warung|rates').split('|');
                const state = await fetchGachaState(interaction.user.id, now);
                return await interaction.update(buildGachaPanel({ state, tierId, mode, now }));
            },
            async pull1(interaction, parsed) {
                const tierId = parsed.arg || 'warung';
                return await handlePullInteraction(interaction, tierId, 1);
            },
            async pull10(interaction, parsed) {
                const tierId = parsed.arg || 'warung';
                return await handlePullInteraction(interaction, tierId, 10);
            }
        },
        selects: {
            async pick_tier(interaction) {
                const now = Date.now();
                const [tierId = 'warung', mode = 'machine'] = String(interaction.values[0] || 'warung|machine').split('|');
                const state = await fetchGachaState(interaction.user.id, now);
                return await interaction.update(buildGachaPanel({ state, tierId, mode, now }));
            }
        }
    },

    fetchGachaState,
    buildGachaPanel
};
