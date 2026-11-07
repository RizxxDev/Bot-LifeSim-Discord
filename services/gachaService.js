const {
    RARITY_META,
    ACTIVITY_TICKET_DROPS,
    getGachaTier,
    getGachaTitle,
    getDuplicateTicketCount,
    isRareOrAbove,
    rollGachaEntry
} = require('../data/gacha');
const { getItem } = require('../data/items');
const { getVehicle } = require('../data/vehicles');
const { getClothing } = require('../data/clothes');
const { debitPlayerFunds } = require('./economyService');
const { getPlayerOwnedClothingIds, grantClothing } = require('./avatarService');
const {
    getPlayerInventory,
    calculateSlotsUsed,
    canFitItems,
    addItem,
    removeItem
} = require('./inventoryService');
const { evaluatePlayerAchievements } = require('./achievementService');

const UNIQUE_ITEM_TAGS = new Set([
    'tool',
    'fishing_rod',
    'pickaxe',
    'helmet',
    'license',
    'device',
    'storage'
]);

function isUniqueItem(itemObj) {
    if (!itemObj || !Array.isArray(itemObj.tags)) return false;
    return itemObj.tags.some(t => UNIQUE_ITEM_TAGS.has(t));
}

function resolvePrizeMetadata(entry) {
    if (entry.type === 'vehicle') {
        const veh = getVehicle(entry.vehicleId);
        return {
            name: veh ? veh.name : entry.vehicleId,
            emoji: veh ? veh.emoji : '🚘',
            categoryLabel: 'Kendaraan Garasi',
            isUnique: true
        };
    }
    if (entry.type === 'title') {
        const tObj = getGachaTitle(entry.titleId);
        return {
            name: tObj ? tObj.name : entry.titleId,
            emoji: tObj ? tObj.emoji : '👑',
            titleValue: tObj ? tObj.titleValue : entry.titleId,
            categoryLabel: 'Gelar Eksklusif',
            isUnique: true
        };
    }
    if (entry.type === 'clothing') {
        const cObj = getClothing(entry.clothingId);
        return {
            name: cObj ? cObj.name : entry.clothingId,
            emoji: cObj ? cObj.emoji : '👔',
            categoryLabel: 'Busana Eksklusif (/wardrobe)',
            isUnique: true
        };
    }
    const it = getItem(entry.itemId);
    const unique = isUniqueItem(it);
    return {
        name: it ? it.name : entry.itemId,
        emoji: it ? it.emoji : '📦',
        categoryLabel: unique ? 'Alat / Lisensi Permanen' : 'Item & Konsumsi',
        isUnique: unique
    };
}

/**
 * Mengecek apakah sebuah entri hadiah unik sudah dimiliki oleh pemain.
 * Item consumable/komoditas selalu mengembalikan false (tidak pernah dianggap duplikat).
 */
function isUniquePrizeAlreadyOwned(entry, ownershipSets) {
    const ownedItemIds = ownershipSets?.ownedItemIds || new Set();
    const ownedVehicleIds = ownershipSets?.ownedVehicleIds || new Set();
    const unlockedTitleIds = ownershipSets?.unlockedTitleIds || new Set();
    const ownedClothingIds = ownershipSets?.ownedClothingIds || new Set();

    if (entry.type === 'vehicle') {
        return ownedVehicleIds.has(entry.vehicleId);
    }
    if (entry.type === 'title') {
        return unlockedTitleIds.has(entry.titleId);
    }
    if (entry.type === 'clothing') {
        return ownedClothingIds.has(entry.clothingId);
    }
    if (entry.type === 'item') {
        const it = getItem(entry.itemId);
        if (isUniqueItem(it)) {
            return ownedItemIds.has(it.id);
        }
    }
    return false;
}

/**
 * Fungsi murni (pure function) untuk mensimulasikan 1x atau 10x tarikan gacha
 * beserta jaminan minimal 1 Rare+ pada 10x pull dan konversi duplikat otomatis.
 */
function simulateGachaPullBatch(tierOrId, pullCount = 1, initialOwnership = {}, rollFn = Math.random) {
    const tier = typeof tierOrId === 'string' ? getGachaTier(tierOrId) : tierOrId;
    const count = pullCount === 10 ? 10 : 1;

    const ownershipSets = {
        ownedItemIds: new Set(initialOwnership.ownedItemIds || []),
        ownedVehicleIds: new Set(initialOwnership.ownedVehicleIds || []),
        unlockedTitleIds: new Set(initialOwnership.unlockedTitleIds || []),
        ownedClothingIds: new Set(initialOwnership.ownedClothingIds || [])
    };

    const rawEntries = [];
    for (let i = 0; i < count; i++) {
        const isTenthGuarantee =
            count === 10 &&
            i === 9 &&
            !rawEntries.some(e => isRareOrAbove(e.rarity));

        const rolled = rollGachaEntry(tier, isTenthGuarantee ? 'rare' : null, rollFn);
        rawEntries.push({
            ...rolled,
            guaranteedRarePlus: isTenthGuarantee
        });
    }

    const results = [];
    let totalDuplicateTickets = 0;
    let jackpotHitCount = 0;

    for (const entry of rawEntries) {
        const meta = resolvePrizeMetadata(entry);
        const rarityInfo = RARITY_META[entry.rarity] || RARITY_META.common;
        const alreadyOwned = isUniquePrizeAlreadyOwned(entry, ownershipSets);

        if (entry.rarity === 'legendary') {
            jackpotHitCount += 1;
        }

        if (alreadyOwned) {
            const dupTickets = getDuplicateTicketCount(entry.rarity);
            totalDuplicateTickets += dupTickets;
            results.push({
                entry,
                meta,
                rarityInfo,
                isDuplicate: true,
                duplicateTickets: dupTickets,
                ticketItemId: tier.ticketItemId
            });
        } else {
            // Tandai kepemilikan baru agar jika item unik yang sama muncul lagi di batch 10x yang sama, otomatis jadi duplikat
            if (entry.type === 'vehicle') {
                ownershipSets.ownedVehicleIds.add(entry.vehicleId);
            } else if (entry.type === 'title') {
                ownershipSets.unlockedTitleIds.add(entry.titleId);
            } else if (entry.type === 'clothing') {
                ownershipSets.ownedClothingIds.add(entry.clothingId);
            } else if (entry.type === 'item' && meta.isUnique) {
                ownershipSets.ownedItemIds.add(entry.itemId);
            }

            results.push({
                entry,
                meta,
                rarityInfo,
                isDuplicate: false,
                duplicateTickets: 0,
                ticketItemId: tier.ticketItemId
            });
        }
    }

    return {
        tier,
        pullCount: count,
        results,
        totalDuplicateTickets,
        jackpotHitCount
    };
}

async function getPlayerGachaStats(conn, discordId) {
    const [rows] = await conn.execute(
        `SELECT * FROM player_gacha_stats WHERE discord_id = ? LIMIT 1`,
        [discordId]
    );
    if (rows.length === 0) {
        return {
            discord_id: discordId,
            warung_pulls: 0,
            mall_pulls: 0,
            sultan_pulls: 0,
            total_pulls: 0,
            jackpot_count: 0,
            duplicate_tickets_earned: 0,
            last_pull_at: 0
        };
    }
    const r = rows[0];
    return {
        discord_id: r.discord_id,
        warung_pulls: Number(r.warung_pulls || 0),
        mall_pulls: Number(r.mall_pulls || 0),
        sultan_pulls: Number(r.sultan_pulls || 0),
        total_pulls: Number(r.total_pulls || 0),
        jackpot_count: Number(r.jackpot_count || 0),
        duplicate_tickets_earned: Number(r.duplicate_tickets_earned || 0),
        last_pull_at: Number(r.last_pull_at || 0)
    };
}

function getPlayerTicketCounts(invRows = []) {
    const counts = {
        tiket_gacha_warung: 0,
        tiket_gacha_mall: 0,
        tiket_gacha_sultan: 0
    };
    for (const r of invRows) {
        const q = Number(r.quantity || 0);
        if (q > 0 && Object.prototype.hasOwnProperty.call(counts, r.item_id)) {
            counts[r.item_id] += q;
        }
    }
    return counts;
}

/**
 * Mengeksekusi tarikan Gacha 1x atau 10x secara transaksional (ACID).
 * Memprioritaskan pemakaian Tiket Gacha di tas, lalu sisanya memotong saldo Lp (Cash -> Bank).
 */
async function executeGachaPull(conn, player, tierId, pullCount = 1, now = Date.now(), rollFn = Math.random) {
    const tier = getGachaTier(tierId);
    const count = pullCount === 10 ? 10 : 1;
    const discordId = player.discord_id;

    const invRowsAll = await getPlayerInventory(conn, discordId, true, 'all', now);
    const bagRows = invRowsAll.filter(r => (r.storage_location || 'bag') === 'bag');
    const slotsUsed = calculateSlotsUsed(bagRows);
    const maxSlots = Number(player.max_slots || 20);

    if (slotsUsed >= maxSlots) {
        return {
            error: 'BAG_FULL',
            slotsUsed,
            maxSlots,
            tier
        };
    }

    const ticketCounts = getPlayerTicketCounts(bagRows);
    const availableTickets = Number(ticketCounts[tier.ticketItemId] || 0);
    const ticketsUsed = Math.min(count, availableTickets);
    const lpPullsCount = count - ticketsUsed;
    const lpCost = lpPullsCount * Number(tier.priceLp);

    const totalFunds = Number(player.cash || 0) + Number(player.bank || 0);
    if (totalFunds < lpCost) {
        return {
            error: 'INSUFFICIENT_FUNDS',
            requiredLp: lpCost,
            ticketsUsed,
            availableTickets,
            totalFunds,
            tier
        };
    }

    // Potong tiket & saldo Lp
    if (ticketsUsed > 0) {
        await removeItem(conn, discordId, tier.ticketItemId, ticketsUsed, 'bag');
    }
    if (lpCost > 0) {
        await debitPlayerFunds(
            conn,
            player,
            lpCost,
            `gacha_${tier.id}`,
            { tierId: tier.id, pullCount: count, ticketsUsed },
            now
        );
    }

    // Kumpulkan kepemilikan item unik, kendaraan, dan gelar gacha saat ini
    const [vehRows] = await conn.execute(
        `SELECT vehicle_id FROM player_vehicles WHERE discord_id = ? FOR UPDATE`,
        [discordId]
    );
    const [colRows] = await conn.execute(
        `SELECT item_id FROM player_collections WHERE discord_id = ? AND item_id LIKE 'gacha_title_%' AND total_caught > 0 FOR UPDATE`,
        [discordId]
    );

    const ownedItemIds = new Set(
        invRowsAll.filter(r => Number(r.quantity) > 0).map(r => r.item_id)
    );
    const ownedVehicleIds = new Set(vehRows.map(v => v.vehicle_id));
    const unlockedTitleIds = new Set(colRows.map(c => c.item_id));
    const ownedClothingIds = await getPlayerOwnedClothingIds(conn, discordId, true);

    const batch = simulateGachaPullBatch(
        tier,
        count,
        { ownedItemIds, ownedVehicleIds, unlockedTitleIds, ownedClothingIds },
        rollFn
    );

    // Distribusikan hadiah hasil tarikan
    const itemGrantAggregator = new Map(); // itemId -> qty
    let hasEquippedVehicle = vehRows.length > 0;

    for (const res of batch.results) {
        if (res.isDuplicate) {
            itemGrantAggregator.set(
                res.ticketItemId,
                (itemGrantAggregator.get(res.ticketItemId) || 0) + res.duplicateTickets
            );
            continue;
        }

        const { entry } = res;
        if (entry.type === 'vehicle') {
            const veh = getVehicle(entry.vehicleId);
            if (veh) {
                const equipFlag = hasEquippedVehicle ? 0 : 1;
                hasEquippedVehicle = true;
                await conn.execute(
                    `INSERT INTO player_vehicles
                     (discord_id, vehicle_id, fuel_liters, odometer_km, last_service_km, is_equipped, acquired_at)
                     VALUES (?, ?, ?, 0, 0, ?, ?)
                     ON DUPLICATE KEY UPDATE fuel_liters = VALUES(fuel_liters)`,
                    [discordId, veh.id, veh.tankCapacity, equipFlag, now]
                );
            }
        } else if (entry.type === 'title') {
            const titleObj = getGachaTitle(entry.titleId);
            if (titleObj) {
                await conn.execute(
                    `INSERT INTO player_collections (discord_id, item_id, total_caught, first_caught_at)
                     VALUES (?, ?, 1, ?)
                     ON DUPLICATE KEY UPDATE total_caught = total_caught + 1`,
                    [discordId, titleObj.id, now]
                );
                if (!player.equipped_title) {
                    player.equipped_title = titleObj.titleValue;
                    await conn.execute(
                        `UPDATE players SET equipped_title = ? WHERE discord_id = ?`,
                        [titleObj.titleValue, discordId]
                    );
                }
            }
        } else if (entry.type === 'clothing') {
            await grantClothing(conn, discordId, entry.clothingId, true, now);
        } else if (entry.type === 'item') {
            itemGrantAggregator.set(
                entry.itemId,
                (itemGrantAggregator.get(entry.itemId) || 0) + Number(entry.qty || 1)
            );
        }
    }

    for (const [grantItemId, grantQty] of itemGrantAggregator.entries()) {
        await addItem(conn, discordId, grantItemId, grantQty, now, 'bag');
    }

    // Update tabel player_gacha_stats
    const wAdd = tier.id === 'warung' ? count : 0;
    const mAdd = tier.id === 'mall' ? count : 0;
    const sAdd = tier.id === 'sultan' ? count : 0;

    await conn.execute(
        `INSERT INTO player_gacha_stats
         (discord_id, warung_pulls, mall_pulls, sultan_pulls, total_pulls, jackpot_count, duplicate_tickets_earned, last_pull_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            warung_pulls = warung_pulls + VALUES(warung_pulls),
            mall_pulls = mall_pulls + VALUES(mall_pulls),
            sultan_pulls = sultan_pulls + VALUES(sultan_pulls),
            total_pulls = total_pulls + VALUES(total_pulls),
            jackpot_count = jackpot_count + VALUES(jackpot_count),
            duplicate_tickets_earned = duplicate_tickets_earned + VALUES(duplicate_tickets_earned),
            last_pull_at = VALUES(last_pull_at)`,
        [
            discordId,
            wAdd,
            mAdd,
            sAdd,
            count,
            batch.jackpotHitCount,
            batch.totalDuplicateTickets,
            now
        ]
    );

    const stats = await getPlayerGachaStats(conn, discordId);
    const achEval = await evaluatePlayerAchievements(conn, player, now);

    return {
        ok: true,
        tier,
        pullCount: count,
        ticketsUsed,
        lpPaid: lpCost,
        results: batch.results,
        totalDuplicateTickets: batch.totalDuplicateTickets,
        jackpotHitCount: batch.jackpotHitCount,
        stats,
        newlyUnlockedAchievements: achEval.newlyUnlocked || [],
        player
    };
}

/**
 * Mengundi peluang drop bonus Tiket Gacha organik setelah pemain menyelesaikan aktivitas
 * (/work, /fishing, /mining, /bin, /farm panen).
 */
async function rollActivityBonusTicket(conn, discordId, activityType, opts = {}, now = Date.now(), rollFn = Math.random) {
    const cfg = ACTIVITY_TICKET_DROPS[activityType];
    if (!cfg) return { dropped: false };

    let chosenTicketId = null;
    const r = Number(rollFn());

    if (activityType === 'work' && Number(opts.jobTier || 1) >= 3 && cfg.highTierMallChance) {
        if (r < cfg.highTierMallChance) {
            chosenTicketId = 'tiket_gacha_mall';
        } else if (r < cfg.highTierMallChance + cfg.warungChance) {
            chosenTicketId = 'tiket_gacha_warung';
        }
    } else if (r < Number(cfg.warungChance || 0)) {
        chosenTicketId = 'tiket_gacha_warung';
    }

    if (!chosenTicketId) {
        return { dropped: false };
    }

    const ticketItem = getItem(chosenTicketId);
    if (!ticketItem) return { dropped: false };

    const bagRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
    const maxSlots = Number(opts.maxSlots || 20);
    const fit = canFitItems(bagRows, maxSlots, [{ itemId: chosenTicketId, qty: 1 }]);
    if (!fit.fits) {
        return { dropped: false };
    }

    await addItem(conn, discordId, chosenTicketId, 1, now, 'bag');
    return {
        dropped: true,
        item: ticketItem,
        qty: 1
    };
}

module.exports = {
    isUniqueItem,
    resolvePrizeMetadata,
    isUniquePrizeAlreadyOwned,
    simulateGachaPullBatch,
    getPlayerGachaStats,
    getPlayerTicketCounts,
    executeGachaPull,
    rollActivityBonusTicket
};
