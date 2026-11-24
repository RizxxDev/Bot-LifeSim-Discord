const { withTransaction } = require('../database/mariadb');
const { syncPlayerVitals } = require('./vitalService');
const { getPlayerInventory, addItem, canFitItems, calculateSlotsUsed } = require('./inventoryService');
const { isItemPerishable } = require('./spoilageService');
const { debitPlayerFunds, creditPlayerCash } = require('./economyService');
const { logPlayerActivity } = require('./moderationService');
const {
    getPlayerEquippedOutfit,
    getPlayerOwnedClothingIds,
    setEquippedClothingSlot,
    grantClothing
} = require('./avatarService');
const { STARTER_CLOTHING_IDS, getClothing, getClothingSlot } = require('../data/clothes');
const { getItem } = require('../data/items');

const AUCTION_CONSTANTS = {
    DURATIONS_HOURS: [1, 6, 12, 24],
    MIN_START_PRICE: 10000,
    MIN_BID_INCREMENT_RATE: 0.05,
    MIN_BID_INCREMENT_LP: 2500,
    ANTI_SNIPE_WINDOW_MS: 120000,
    ANTI_SNIPE_EXTEND_MS: 120000,
    TAX_RATE: 0.05,
    MAX_ACTIVE_AUCTIONS_PER_SELLER: 3
};

function isItemAuctionEligible(item, invRow = null) {
    if (!item || item.untradable) return false;
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const rarity = String(item.rarity || '').toLowerCase();

    if (item.maxDurability) {
        if (invRow && Number(invRow.durability ?? item.maxDurability) <= 0) {
            return false;
        }
        return true;
    }

    if (isItemPerishable(item.id) || tags.includes('fish')) {
        if (!['rare', 'epic', 'legendary', 'mythic'].includes(rarity)) {
            return false;
        }
        if (invRow && invRow.freshness_remaining_ms !== null && Number(invRow.freshness_remaining_ms) <= 0) {
            return false;
        }
        return true;
    }

    if (['rare', 'epic', 'legendary', 'mythic'].includes(rarity)) {
        return true;
    }

    if (tags.includes('trophy') || tags.includes('gacha') || tags.includes('gacha_exclusive') || tags.includes('relic')) {
        return true;
    }

    if ((tags.includes('mineral') || tags.includes('ore')) && Number(item.sellPrice || 0) >= 20000) {
        return true;
    }

    return false;
}

function isClothingAuctionEligible(clothing) {
    if (!clothing || clothing.untradable) return false;
    return !STARTER_CLOTHING_IDS.includes(clothing.id);
}

function getMinimumNextBid(auction) {
    if (!auction) return AUCTION_CONSTANTS.MIN_START_PRICE;
    const startPrice = Math.max(AUCTION_CONSTANTS.MIN_START_PRICE, Number(auction.start_price || 0));
    if (!auction.highest_bidder_id || Number(auction.current_bid || 0) <= 0) {
        return startPrice;
    }
    const currentBid = Number(auction.current_bid);
    const inc = Math.max(
        AUCTION_CONSTANTS.MIN_BID_INCREMENT_LP,
        Math.round(currentBid * AUCTION_CONSTANTS.MIN_BID_INCREMENT_RATE)
    );
    return currentBid + inc;
}

function calculateBidEvaluation(auction, bidAmount, now = Date.now()) {
    if (!auction || auction.status !== 'active') {
        return { ok: false, error: 'AUCTION_NOT_ACTIVE' };
    }
    const endsAt = Number(auction.ends_at || 0);
    if (endsAt <= now) {
        return { ok: false, error: 'AUCTION_ENDED' };
    }

    const minRequiredBid = getMinimumNextBid(auction);
    const cleanBid = Math.floor(Number(bidAmount || 0));
    if (!Number.isFinite(cleanBid) || cleanBid < minRequiredBid) {
        return {
            ok: false,
            error: 'BID_TOO_LOW',
            minRequiredBid,
            bidAmount: cleanBid
        };
    }

    const remainingMs = endsAt - now;
    const snipeTriggered = remainingMs > 0 && remainingMs < AUCTION_CONSTANTS.ANTI_SNIPE_WINDOW_MS;
    const newEndsAt = snipeTriggered ? endsAt + AUCTION_CONSTANTS.ANTI_SNIPE_EXTEND_MS : endsAt;

    return {
        ok: true,
        bidAmount: cleanBid,
        minRequiredBid,
        snipeTriggered,
        newEndsAt
    };
}

async function fetchAuctionState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const player = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const slotsUsed = calculateSlotsUsed(invRows);

        const eligibleBagRows = [];
        for (const row of invRows) {
            if (Number(row.quantity || 0) <= 0) continue;
            const item = getItem(row.item_id);
            if (!isItemAuctionEligible(item, row)) continue;
            eligibleBagRows.push({ row, item });
        }

        const ownedClothesSet = await getPlayerOwnedClothingIds(conn, discordId, false);
        const equippedOutfit = await getPlayerEquippedOutfit(conn, discordId, false);
        const equippedIds = new Set(Object.values(equippedOutfit).filter(Boolean));
        const eligibleClothes = [];
        for (const cId of ownedClothesSet) {
            const c = getClothing(cId);
            if (!isClothingAuctionEligible(c)) continue;
            eligibleClothes.push({
                clothing: c,
                isEquipped: equippedIds.has(c.id)
            });
        }

        const [activeAuctions] = await conn.execute(
            `SELECT ma.*, s.username AS seller_name, b.username AS bidder_name
             FROM market_auctions ma
             LEFT JOIN players s ON s.discord_id = ma.seller_id
             LEFT JOIN players b ON b.discord_id = ma.highest_bidder_id
             WHERE ma.status = 'active' AND ma.ends_at > ?
             ORDER BY ma.ends_at ASC
             LIMIT 25`,
            [now]
        );

        const [mySellingAuctions] = await conn.execute(
            `SELECT ma.*, b.username AS bidder_name
             FROM market_auctions ma
             LEFT JOIN players b ON b.discord_id = ma.highest_bidder_id
             WHERE ma.seller_id = ?
             ORDER BY CASE WHEN ma.status = 'active' THEN 0 ELSE 1 END ASC, ma.created_at DESC
             LIMIT 10`,
            [discordId]
        );

        const [myWinningBids] = await conn.execute(
            `SELECT * FROM market_auctions
             WHERE highest_bidder_id = ? AND status = 'active'
             ORDER BY ends_at ASC`,
            [discordId]
        );

        const [myClaims] = await conn.execute(
            `SELECT * FROM market_auction_claims
             WHERE discord_id = ?
             ORDER BY created_at ASC`,
            [discordId]
        );

        return {
            player,
            invRows,
            slotsUsed,
            eligibleBagRows,
            eligibleClothes,
            activeAuctions,
            mySellingAuctions,
            myWinningBids,
            myClaims
        };
    });
}

async function createAuctionListing(sellerId, {
    itemKind = 'inventory',
    sourceRowId = null,
    itemId,
    durationHours = 12,
    startPrice,
    reservePrice = 0,
    now = Date.now()
}) {
    const cleanHours = Number(durationHours);
    if (!AUCTION_CONSTANTS.DURATIONS_HOURS.includes(cleanHours)) {
        return { ok: false, error: 'INVALID_DURATION', allowedHours: AUCTION_CONSTANTS.DURATIONS_HOURS };
    }

    const cleanStart = Math.floor(Number(startPrice || 0));
    if (!Number.isFinite(cleanStart) || cleanStart < AUCTION_CONSTANTS.MIN_START_PRICE) {
        return { ok: false, error: 'START_PRICE_TOO_LOW', minStartPrice: AUCTION_CONSTANTS.MIN_START_PRICE };
    }

    const cleanReserve = Math.floor(Number(reservePrice || 0));
    if (!Number.isFinite(cleanReserve) || cleanReserve < 0 || (cleanReserve > 0 && cleanReserve < cleanStart)) {
        return { ok: false, error: 'INVALID_RESERVE_PRICE', startPrice: cleanStart };
    }

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, sellerId, now, true);
        const p = synced.player;

        if (Number(p.hospital_until || 0) > now) {
            return { ok: false, error: 'IN_HOSPITAL', until: Number(p.hospital_until), player: p };
        }
        if (Number(p.sleeping_until || 0) > now) {
            return { ok: false, error: 'SLEEPING', until: Number(p.sleeping_until), player: p };
        }

        const [activeCountRows] = await conn.execute(
            `SELECT COUNT(*) AS cnt FROM market_auctions WHERE seller_id = ? AND status = 'active'`,
            [sellerId]
        );
        const activeCount = Number(activeCountRows[0]?.cnt || 0);
        if (activeCount >= AUCTION_CONSTANTS.MAX_ACTIVE_AUCTIONS_PER_SELLER) {
            return {
                ok: false,
                error: 'TOO_MANY_ACTIVE_AUCTIONS',
                activeCount,
                max: AUCTION_CONSTANTS.MAX_ACTIVE_AUCTIONS_PER_SELLER,
                player: p
            };
        }

        let storedItemId = itemId;
        let storedDurability = null;
        let storedFreshnessMs = null;

        if (itemKind === 'clothing') {
            const clothing = getClothing(itemId);
            if (!isClothingAuctionEligible(clothing)) {
                return { ok: false, error: 'ITEM_NOT_ELIGIBLE', player: p };
            }

            const [ownedRows] = await conn.execute(
                `SELECT * FROM player_clothes WHERE discord_id = ? AND clothing_id = ? FOR UPDATE`,
                [sellerId, clothing.id]
            );
            if (ownedRows.length === 0) {
                return { ok: false, error: 'ITEM_NOT_OWNED', player: p };
            }

            const equipped = await getPlayerEquippedOutfit(conn, sellerId, true);
            if (equipped[clothing.slot] === clothing.id) {
                const slotMeta = getClothingSlot(clothing.slot);
                if (slotMeta && slotMeta.canUnequip) {
                    await setEquippedClothingSlot(conn, sellerId, clothing.slot, null, now);
                } else if (slotMeta && clothing.slot === 'hair') {
                    await conn.execute(
                        `UPDATE player_equipped_clothes SET ${slotMeta.column} = 'hair_short_black', updated_at = ? WHERE discord_id = ?`,
                        [now, sellerId]
                    );
                }
            }

            await conn.execute(
                `DELETE FROM player_clothes WHERE discord_id = ? AND clothing_id = ?`,
                [sellerId, clothing.id]
            );
            storedItemId = clothing.id;
        } else {
            const invRows = await getPlayerInventory(conn, sellerId, true, 'bag', now);
            const targetRow = sourceRowId
                ? invRows.find(r => String(r.id) === String(sourceRowId) && Number(r.quantity || 0) > 0)
                : invRows.find(r => r.item_id === itemId && Number(r.quantity || 0) > 0);

            if (!targetRow) {
                return { ok: false, error: 'ITEM_NOT_OWNED', player: p };
            }
            const item = getItem(targetRow.item_id);
            if (!isItemAuctionEligible(item, targetRow)) {
                return { ok: false, error: 'ITEM_NOT_ELIGIBLE', player: p };
            }

            storedItemId = item.id;
            storedDurability = targetRow.durability !== null && targetRow.durability !== undefined
                ? Number(targetRow.durability)
                : null;
            storedFreshnessMs = targetRow.freshness_remaining_ms !== null && targetRow.freshness_remaining_ms !== undefined
                ? Number(targetRow.freshness_remaining_ms)
                : null;

            const currentQty = Number(targetRow.quantity || 0);
            if (currentQty > 1) {
                await conn.execute(
                    `UPDATE player_inventory SET quantity = quantity - 1 WHERE id = ?`,
                    [targetRow.id]
                );
            } else {
                await conn.execute(`DELETE FROM player_inventory WHERE id = ?`, [targetRow.id]);
            }
        }

        const endsAt = now + cleanHours * 3600000;
        const [ins] = await conn.execute(
            `INSERT INTO market_auctions
                (seller_id, item_kind, item_id, quantity, durability, freshness_remaining_ms,
                 start_price, reserve_price, current_bid, highest_bidder_id, bid_count,
                 status, ends_at, created_at)
             VALUES (?, ?, ?, 1, ?, ?, ?, ?, 0, NULL, 0, 'active', ?, ?)`,
            [
                sellerId,
                itemKind === 'clothing' ? 'clothing' : 'inventory',
                storedItemId,
                storedDurability,
                storedFreshnessMs,
                cleanStart,
                cleanReserve,
                endsAt,
                now
            ]
        );

        const auctionId = Number(ins.insertId);
        await logPlayerActivity(conn, sellerId, 'lelang', 'create_listing', {
            auctionId,
            itemKind: itemKind === 'clothing' ? 'clothing' : 'inventory',
            itemId: storedItemId,
            durationHours: cleanHours,
            startPrice: cleanStart,
            reservePrice: cleanReserve
        }, now);

        return {
            ok: true,
            auction: {
                id: auctionId,
                seller_id: sellerId,
                item_kind: itemKind === 'clothing' ? 'clothing' : 'inventory',
                item_id: storedItemId,
                quantity: 1,
                durability: storedDurability,
                freshness_remaining_ms: storedFreshnessMs,
                start_price: cleanStart,
                reserve_price: cleanReserve,
                current_bid: 0,
                highest_bidder_id: null,
                bid_count: 0,
                status: 'active',
                ends_at: endsAt,
                created_at: now
            },
            player: p
        };
    });
}

async function placeAuctionBid(bidderId, auctionId, bidAmount, now = Date.now()) {
    const cleanId = Number(auctionId || 0);
    if (!Number.isFinite(cleanId) || cleanId <= 0) {
        return { ok: false, error: 'AUCTION_NOT_FOUND' };
    }

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, bidderId, now, true);
        const bidder = synced.player;

        if (Number(bidder.hospital_until || 0) > now) {
            return { ok: false, error: 'IN_HOSPITAL', until: Number(bidder.hospital_until), player: bidder };
        }
        if (Number(bidder.sleeping_until || 0) > now) {
            return { ok: false, error: 'SLEEPING', until: Number(bidder.sleeping_until), player: bidder };
        }

        const [rows] = await conn.execute(
            `SELECT * FROM market_auctions WHERE id = ? FOR UPDATE`,
            [cleanId]
        );
        const auction = rows[0];
        if (!auction) {
            return { ok: false, error: 'AUCTION_NOT_FOUND', player: bidder };
        }
        if (auction.seller_id === bidderId) {
            return { ok: false, error: 'SELF_BID', auction, player: bidder };
        }
        if (auction.highest_bidder_id === bidderId) {
            return { ok: false, error: 'ALREADY_HIGHEST_BIDDER', auction, player: bidder };
        }

        if (auction.item_kind === 'clothing') {
            const ownedClothes = await getPlayerOwnedClothingIds(conn, bidderId, true);
            if (ownedClothes.has(auction.item_id)) {
                return { ok: false, error: 'ALREADY_OWN_CLOTHING', auction, player: bidder };
            }
        }

        const evalRes = calculateBidEvaluation(auction, bidAmount, now);
        if (!evalRes.ok) {
            return { ...evalRes, auction, player: bidder };
        }

        const totalFunds = Number(bidder.cash || 0) + Number(bidder.bank || 0);
        if (totalFunds < evalRes.bidAmount) {
            return {
                ok: false,
                error: 'INSUFFICIENT_FUNDS',
                required: evalRes.bidAmount,
                totalFunds,
                auction,
                player: bidder
            };
        }

        await debitPlayerFunds(conn, bidder, evalRes.bidAmount, 'auction_bid_escrow', {
            auctionId: auction.id,
            itemId: auction.item_id
        }, now);

        if (auction.highest_bidder_id && Number(auction.current_bid || 0) > 0) {
            const [prevRows] = await conn.execute(
                `SELECT discord_id, cash, bank FROM players WHERE discord_id = ? FOR UPDATE`,
                [auction.highest_bidder_id]
            );
            if (prevRows[0]) {
                await creditPlayerCash(conn, prevRows[0], Number(auction.current_bid), 'auction_outbid_refund', {
                    auctionId: auction.id,
                    outbidBy: bidderId
                }, now);
            }
        }

        const newBidCount = Number(auction.bid_count || 0) + 1;
        await conn.execute(
            `UPDATE market_auctions
             SET current_bid = ?, highest_bidder_id = ?, bid_count = ?, ends_at = ?
             WHERE id = ?`,
            [evalRes.bidAmount, bidderId, newBidCount, evalRes.newEndsAt, cleanId]
        );

        await logPlayerActivity(conn, bidderId, 'lelang', 'place_bid', {
            auctionId: cleanId,
            itemId: auction.item_id,
            bidAmount: evalRes.bidAmount,
            snipeTriggered: evalRes.snipeTriggered
        }, now);

        return {
            ok: true,
            auction: {
                ...auction,
                current_bid: evalRes.bidAmount,
                highest_bidder_id: bidderId,
                bid_count: newBidCount,
                ends_at: evalRes.newEndsAt
            },
            bidAmount: evalRes.bidAmount,
            snipeTriggered: evalRes.snipeTriggered,
            player: bidder
        };
    });
}

async function cancelAuctionListing(sellerId, auctionId, now = Date.now()) {
    const cleanId = Number(auctionId || 0);
    if (!Number.isFinite(cleanId) || cleanId <= 0) {
        return { ok: false, error: 'AUCTION_NOT_FOUND' };
    }

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, sellerId, now, true);
        const p = synced.player;

        const [rows] = await conn.execute(
            `SELECT * FROM market_auctions WHERE id = ? FOR UPDATE`,
            [cleanId]
        );
        const auction = rows[0];
        if (!auction || auction.seller_id !== sellerId) {
            return { ok: false, error: 'AUCTION_NOT_FOUND', player: p };
        }
        if (auction.status !== 'active') {
            return { ok: false, error: 'AUCTION_NOT_ACTIVE', auction, player: p };
        }
        if (Number(auction.bid_count || 0) > 0 || auction.highest_bidder_id) {
            return { ok: false, error: 'HAS_ACTIVE_BIDS', auction, player: p };
        }

        await conn.execute(
            `UPDATE market_auctions SET status = 'cancelled', settled_at = ? WHERE id = ?`,
            [now, cleanId]
        );

        await conn.execute(
            `INSERT INTO market_auction_claims
                (discord_id, auction_id, item_kind, item_id, quantity, durability, freshness_remaining_ms, claim_reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'returned_unsold', ?)`,
            [
                sellerId,
                cleanId,
                auction.item_kind,
                auction.item_id,
                Number(auction.quantity || 1),
                auction.durability,
                auction.freshness_remaining_ms,
                now
            ]
        );

        await logPlayerActivity(conn, sellerId, 'lelang', 'cancel_listing', {
            auctionId: cleanId,
            itemId: auction.item_id
        }, now);

        return { ok: true, auction: { ...auction, status: 'cancelled' }, player: p };
    });
}

async function settleDueAuctions(conn, now = Date.now()) {
    const [dueRows] = await conn.execute(
        `SELECT * FROM market_auctions
         WHERE status = 'active' AND ends_at <= ?
         ORDER BY ends_at ASC
         LIMIT 25
         FOR UPDATE`,
        [now]
    );

    let settled = 0;
    for (const a of dueRows) {
        const currentBid = Number(a.current_bid || 0);
        const reservePrice = Number(a.reserve_price || 0);
        const hasBid = Boolean(a.highest_bidder_id && currentBid > 0);
        const reserveMet = reservePrice <= 0 || currentBid >= reservePrice;

        if (hasBid && reserveMet) {
            const taxLp = Math.round(currentBid * AUCTION_CONSTANTS.TAX_RATE);
            const sellerPayout = currentBid - taxLp;

            const [sellerRows] = await conn.execute(
                `SELECT discord_id, cash, bank FROM players WHERE discord_id = ? FOR UPDATE`,
                [a.seller_id]
            );
            if (sellerRows[0]) {
                await creditPlayerCash(conn, sellerRows[0], sellerPayout, 'auction_sale_payout', {
                    auctionId: a.id,
                    itemId: a.item_id,
                    buyerId: a.highest_bidder_id,
                    grossBid: currentBid,
                    taxLp
                }, now);
            }

            await conn.execute(
                `INSERT INTO market_auction_claims
                    (discord_id, auction_id, item_kind, item_id, quantity, durability, freshness_remaining_ms, claim_reason, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'won', ?)`,
                [
                    a.highest_bidder_id,
                    a.id,
                    a.item_kind,
                    a.item_id,
                    Number(a.quantity || 1),
                    a.durability,
                    a.freshness_remaining_ms,
                    now
                ]
            );

            await conn.execute(
                `UPDATE market_auctions SET status = 'sold', settled_at = ? WHERE id = ?`,
                [now, a.id]
            );
        } else {
            if (hasBid) {
                const [bidderRows] = await conn.execute(
                    `SELECT discord_id, cash, bank FROM players WHERE discord_id = ? FOR UPDATE`,
                    [a.highest_bidder_id]
                );
                if (bidderRows[0]) {
                    await creditPlayerCash(conn, bidderRows[0], currentBid, 'auction_reserve_unmet_refund', {
                        auctionId: a.id,
                        itemId: a.item_id,
                        reservePrice
                    }, now);
                }
            }

            const reason = hasBid ? 'returned_reserve' : 'returned_unsold';
            await conn.execute(
                `INSERT INTO market_auction_claims
                    (discord_id, auction_id, item_kind, item_id, quantity, durability, freshness_remaining_ms, claim_reason, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    a.seller_id,
                    a.id,
                    a.item_kind,
                    a.item_id,
                    Number(a.quantity || 1),
                    a.durability,
                    a.freshness_remaining_ms,
                    reason,
                    now
                ]
            );

            await conn.execute(
                `UPDATE market_auctions SET status = 'unsold', settled_at = ? WHERE id = ?`,
                [now, a.id]
            );
        }

        settled += 1;
    }

    return settled;
}

async function claimAuctionItems(discordId, claimId = null, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;

        const query = claimId
            ? `SELECT * FROM market_auction_claims WHERE discord_id = ? AND id = ? FOR UPDATE`
            : `SELECT * FROM market_auction_claims WHERE discord_id = ? ORDER BY created_at ASC FOR UPDATE`;
        const params = claimId ? [discordId, Number(claimId)] : [discordId];
        const [claims] = await conn.execute(query, params);

        if (claims.length === 0) {
            return { ok: false, error: 'NO_CLAIMS', player: p };
        }

        let invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
        const claimed = [];
        let blockedByBag = false;

        for (const c of claims) {
            if (c.item_kind === 'clothing') {
                const clothing = getClothing(c.item_id);
                const grantRes = await grantClothing(conn, discordId, c.item_id, false, now);
                let compensatedLp = 0;
                if (!grantRes.ok && grantRes.error === 'ALREADY_OWNED') {
                    compensatedLp = Math.max(5000, Math.round(Number(clothing?.buyPrice || 20000) * 0.5));
                    await creditPlayerCash(conn, p, compensatedLp, 'auction_duplicate_clothing_comp', {
                        claimId: c.id,
                        clothingId: c.item_id
                    }, now);
                }
                await conn.execute(`DELETE FROM market_auction_claims WHERE id = ?`, [c.id]);
                claimed.push({
                    claimId: c.id,
                    itemKind: 'clothing',
                    itemId: c.item_id,
                    displayName: clothing ? `${clothing.emoji} ${clothing.name}` : c.item_id,
                    compensatedLp
                });
                continue;
            }

            const freshnessMs = c.freshness_remaining_ms !== null && c.freshness_remaining_ms !== undefined
                ? Number(c.freshness_remaining_ms)
                : undefined;
            const durabilityVal = c.durability !== null && c.durability !== undefined
                ? Number(c.durability)
                : undefined;

            const fit = canFitItems(invRows, p.max_slots, [{
                itemId: c.item_id,
                qty: Number(c.quantity || 1),
                freshnessMs
            }]);

            if (!fit.fits) {
                blockedByBag = true;
                continue;
            }

            await addItem(
                conn,
                discordId,
                c.item_id,
                Number(c.quantity || 1),
                now,
                'bag',
                freshnessMs,
                null,
                durabilityVal
            );
            await conn.execute(`DELETE FROM market_auction_claims WHERE id = ?`, [c.id]);
            invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);

            const item = getItem(c.item_id);
            claimed.push({
                claimId: c.id,
                itemKind: 'inventory',
                itemId: c.item_id,
                displayName: item ? `${item.emoji} ${item.name}` : c.item_id
            });
        }

        if (claimed.length === 0 && blockedByBag) {
            return {
                ok: false,
                error: 'BAG_FULL',
                maxSlots: p.max_slots,
                slotsUsed: calculateSlotsUsed(invRows),
                player: p
            };
        }

        await logPlayerActivity(conn, discordId, 'lelang', 'claim_items', {
            claimedCount: claimed.length
        }, now);

        return {
            ok: true,
            claimed,
            partialBagFull: blockedByBag,
            player: p
        };
    });
}

module.exports = {
    AUCTION_CONSTANTS,
    isItemAuctionEligible,
    isClothingAuctionEligible,
    getMinimumNextBid,
    calculateBidEvaluation,
    fetchAuctionState,
    createAuctionListing,
    placeAuctionBid,
    cancelAuctionListing,
    settleDueAuctions,
    claimAuctionItems
};
