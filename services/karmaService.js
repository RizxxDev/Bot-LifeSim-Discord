const { withTransaction } = require('../database/mariadb');
const { getVal, incrByVal, getWibDateString } = require('../database/redis');
const { syncPlayerVitals } = require('./vitalService');
const { getPlayerInventory, addItem, removeItem, canFitItems, calculateSlotsUsed } = require('./inventoryService');
const { debitPlayerFunds, getLiveEconomyConfig } = require('./economyService');
const { getEffectiveItemPrice } = require('./shopService');
const { logPlayerActivity } = require('./moderationService');
const { getItem, ITEMS } = require('../data/items');
const { MAX_DAILY_KARMA_EARN, KARMA_TIERS, getKarmaPerks } = require('../data/karma');

const MIN_DROP_PORTIONS = 2;
const MAX_DROP_PORTIONS = 10;
const DROP_TTL_MS = 2 * 60 * 60 * 1000;
const KARMA_PER_CLAIM = 2;

function getDailyKarmaRedisKey(discordId, now = Date.now()) {
    const dateWib = getWibDateString(now);
    return `karma_daily:${dateWib}:${discordId}`;
}

async function getDailyKarmaEarned(discordId, now = Date.now()) {
    const key = getDailyKarmaRedisKey(discordId, now);
    const val = await getVal(key);
    return Math.max(0, Number(val || 0));
}

async function awardCappedKarma(conn, discordId, rawPoints, now = Date.now()) {
    const requested = Math.max(0, Math.floor(Number(rawPoints || 0)));
    const usedBefore = await getDailyKarmaEarned(discordId, now);
    const remainingCap = Math.max(0, MAX_DAILY_KARMA_EARN - usedBefore);
    const granted = Math.min(requested, remainingCap);

    if (granted > 0) {
        await conn.execute(
            `UPDATE players SET karma_points = karma_points + ? WHERE discord_id = ?`,
            [granted, discordId]
        );
        await incrByVal(getDailyKarmaRedisKey(discordId, now), granted, 93600);
    }

    const [pRows] = await conn.execute(
        `SELECT karma_points FROM players WHERE discord_id = ?`,
        [discordId]
    );
    const totalKarma = Number(pRows[0]?.karma_points || 0);

    return {
        requested,
        granted,
        dailyUsed: usedBefore + granted,
        dailyCap: MAX_DAILY_KARMA_EARN,
        cappedOut: granted < requested,
        totalKarma
    };
}

function isTraktirDropItem(item) {
    if (!item || item.durability || item.untradable || !item.effects) return false;
    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (tags.includes('medicine') || tags.includes('raw')) return false;
    return tags.includes('food') || tags.includes('drink');
}

function getTraktirDropKarmaPerClaim(item, unitPrice = 0) {
    const refPrice = Math.max(Number(unitPrice || 0), Number(item?.buyPrice || 0), Number(item?.sellPrice || 0));
    if (refPrice >= 50000) return 4;
    if (refPrice >= 15000) return 3;
    return KARMA_PER_CLAIM;
}

function getTraktirBuyCatalog(liveConfig = null, now = Date.now()) {
    return ITEMS
        .filter(it => isTraktirDropItem(it) && Number(it.buyPrice || 0) > 0 && Number(it.buyPrice) <= 250000)
        .map(it => ({
            item: it,
            effectivePrice: getEffectiveItemPrice(it, liveConfig, now),
            karmaPerClaim: getTraktirDropKarmaPerClaim(it, getEffectiveItemPrice(it, liveConfig, now))
        }))
        .sort((a, b) => a.effectivePrice - b.effectivePrice)
        .slice(0, 25);
}

function getShareableBagRows(invRows = []) {
    const grouped = new Map();
    for (const row of invRows) {
        const qty = Number(row.quantity || 0);
        if (qty <= 0) continue;
        const item = getItem(row.item_id);
        if (!isTraktirDropItem(item)) continue;
        const prev = grouped.get(item.id) || { item, qty: 0 };
        prev.qty += qty;
        grouped.set(item.id, prev);
    }
    return Array.from(grouped.values()).filter(entry => entry.qty >= MIN_DROP_PORTIONS);
}

function isSocialDonatableItem(item) {
    if (!item || item.durability || item.maxDurability || item.untradable) return false;
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const blockedTags = [
        'tool', 'fishing_rod', 'pickaxe', 'helmet', 'axe', 'shovel',
        'clothes', 'clothing', 'accessory', 'lootbox', 'gacha', 'gacha_ticket',
        'gacha_exclusive', 'trophy', 'voucher', 'relic', 'weapon', 'license',
        'service', 'prestise', 'storage', 'furniture', 'device'
    ];
    if (tags.some(t => blockedTags.includes(t))) return false;
    const rarity = String(item.rarity || '').toLowerCase();
    if (['epic', 'legendary', 'mythic'].includes(rarity)) return false;
    if (item.id.startsWith('sampah_') || item.id === 'bahan_basi') return true;
    const allowedTags = [
        'trash', 'spoiled', 'junk', 'rongsokan', 'food', 'drink', 'cooked',
        'medicine', 'crop', 'farm', 'livestock_product', 'feed', 'ingredient',
        'material', 'gather', 'raw_material', 'processed_material', 'building_material',
        'resource', 'wood', 'fish', 'ore', 'mineral', 'consumable'
    ];
    return tags.some(t => allowedTags.includes(t));
}

function getSocialDonationKarmaPerUnit(item) {
    if (!item) return 1;
    const refValue = Math.max(Number(item.sellPrice || 0), Math.round(Number(item.buyPrice || 0) * 0.4));
    if (refValue >= 25000) return 3;
    if (refValue >= 5000) return 2;
    return 1;
}

function getDonatableBagRows(invRows = []) {
    const grouped = new Map();
    for (const row of invRows) {
        const qty = Number(row.quantity || 0);
        if (qty <= 0) continue;
        const item = getItem(row.item_id);
        if (!isSocialDonatableItem(item)) continue;
        const prev = grouped.get(item.id) || {
            item,
            qty: 0,
            karmaPerUnit: getSocialDonationKarmaPerUnit(item)
        };
        prev.qty += qty;
        grouped.set(item.id, prev);
    }
    return Array.from(grouped.values()).sort((a, b) => b.karmaPerUnit - a.karmaPerUnit || b.qty - a.qty);
}

async function fetchTraktirState(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const player = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const liveConfig = await getLiveEconomyConfig(conn);
        const dailyKarmaUsed = await getDailyKarmaEarned(discordId, now);

        const [recentDrops] = await conn.execute(
            `SELECT * FROM social_traktir_drops
             WHERE creator_id = ?
             ORDER BY created_at DESC
             LIMIT 5`,
            [discordId]
        );

        return {
            player,
            invRows,
            slotsUsed: calculateSlotsUsed(invRows),
            liveConfig,
            dailyKarmaUsed,
            perks: getKarmaPerks(player.karma_points),
            buyCatalog: getTraktirBuyCatalog(liveConfig, now),
            shareableBag: getShareableBagRows(invRows),
            donatableBag: getDonatableBagRows(invRows),
            recentDrops
        };
    });
}

async function createChannelTraktirDrop(discordId, {
    channelId = null,
    source = 'buy',
    itemId,
    portions = 3,
    note = null,
    now = Date.now()
}) {
    const cleanPortions = Math.floor(Number(portions || 0));
    if (!Number.isFinite(cleanPortions) || cleanPortions < MIN_DROP_PORTIONS || cleanPortions > MAX_DROP_PORTIONS) {
        return { ok: false, error: 'INVALID_PORTIONS', min: MIN_DROP_PORTIONS, max: MAX_DROP_PORTIONS };
    }

    const item = getItem(itemId);
    if (!isTraktirDropItem(item)) {
        return { ok: false, error: 'INVALID_ITEM' };
    }

    const cleanNote = note ? String(note).trim().slice(0, 140) || null : null;

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;

        if (Number(p.hospital_until || 0) > now) {
            return { ok: false, error: 'IN_HOSPITAL', until: Number(p.hospital_until), player: p };
        }
        if (Number(p.sleeping_until || 0) > now) {
            return { ok: false, error: 'SLEEPING', until: Number(p.sleeping_until), player: p };
        }

        let unitPrice = 0;
        let totalCost = 0;

        if (source === 'bag') {
            const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
            const owned = invRows
                .filter(r => r.item_id === item.id)
                .reduce((acc, r) => acc + Number(r.quantity || 0), 0);
            if (owned < cleanPortions) {
                return { ok: false, error: 'INSUFFICIENT_BAG_ITEM', owned, required: cleanPortions, item, player: p };
            }
            const removed = await removeItem(conn, discordId, item.id, cleanPortions, 'bag');
            if (!removed) {
                return { ok: false, error: 'INSUFFICIENT_BAG_ITEM', owned, required: cleanPortions, item, player: p };
            }
        } else {
            if (Number(item.buyPrice || 0) <= 0) {
                return { ok: false, error: 'NOT_BUYABLE', item, player: p };
            }
            const liveConfig = await getLiveEconomyConfig(conn);
            unitPrice = getEffectiveItemPrice(item, liveConfig, now);
            totalCost = unitPrice * cleanPortions;
            const totalFunds = Number(p.cash || 0) + Number(p.bank || 0);
            if (totalFunds < totalCost) {
                return { ok: false, error: 'INSUFFICIENT_FUNDS', required: totalCost, totalFunds, item, player: p };
            }
            await debitPlayerFunds(conn, p, totalCost, 'traktir_drop', {
                itemId: item.id,
                portions: cleanPortions,
                unitPrice
            }, now);
        }

        const karmaPerClaim = getTraktirDropKarmaPerClaim(item, unitPrice);
        const expiresAt = now + DROP_TTL_MS;

        const [insertRes] = await conn.execute(
            `INSERT INTO social_traktir_drops
                (creator_id, channel_id, item_id, total_portions, remaining_portions, karma_per_claim, note, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                discordId,
                channelId ? String(channelId) : null,
                item.id,
                cleanPortions,
                cleanPortions,
                karmaPerClaim,
                cleanNote,
                expiresAt,
                now
            ]
        );

        const dropId = Number(insertRes.insertId);
        await logPlayerActivity(conn, discordId, 'traktir', 'create_drop', {
            dropId,
            source,
            itemId: item.id,
            portions: cleanPortions,
            totalCost,
            karmaPerClaim
        }, now);

        return {
            ok: true,
            drop: {
                id: dropId,
                creator_id: discordId,
                creator_name: p.username,
                channel_id: channelId,
                item_id: item.id,
                total_portions: cleanPortions,
                remaining_portions: cleanPortions,
                karma_per_claim: karmaPerClaim,
                note: cleanNote,
                expires_at: expiresAt,
                created_at: now
            },
            item,
            source,
            totalCost,
            player: p
        };
    });
}

async function claimChannelTraktirDrop(claimerId, dropId, now = Date.now()) {
    const cleanDropId = Number(dropId || 0);
    if (!Number.isFinite(cleanDropId) || cleanDropId <= 0) {
        return { ok: false, error: 'DROP_NOT_FOUND' };
    }

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, claimerId, now, true);
        const claimer = synced.player;

        const [dropRows] = await conn.execute(
            `SELECT d.*, p.username AS creator_name
             FROM social_traktir_drops d
             LEFT JOIN players p ON p.discord_id = d.creator_id
             WHERE d.id = ?
             FOR UPDATE`,
            [cleanDropId]
        );

        const drop = dropRows[0];
        if (!drop) {
            return { ok: false, error: 'DROP_NOT_FOUND' };
        }
        if (Number(drop.expires_at) <= now) {
            return { ok: false, error: 'DROP_EXPIRED', drop };
        }
        if (Number(drop.remaining_portions) <= 0) {
            return { ok: false, error: 'DROP_EMPTY', drop };
        }
        if (drop.creator_id === claimerId) {
            return { ok: false, error: 'SELF_CLAIM', drop };
        }

        const [existingClaims] = await conn.execute(
            `SELECT 1 FROM social_traktir_claims WHERE drop_id = ? AND claimer_id = ?`,
            [cleanDropId, claimerId]
        );
        if (existingClaims.length > 0) {
            return { ok: false, error: 'ALREADY_CLAIMED', drop };
        }

        const item = getItem(drop.item_id);
        if (!item) {
            return { ok: false, error: 'INVALID_ITEM', drop };
        }

        const invRows = await getPlayerInventory(conn, claimerId, true, 'bag', now);
        const fit = canFitItems(invRows, claimer.max_slots, [{ itemId: item.id, qty: 1 }]);
        if (!fit.fits) {
            return {
                ok: false,
                error: 'BAG_FULL',
                maxSlots: fit.maxSlots,
                slotsBefore: fit.slotsBefore,
                drop
            };
        }

        await conn.execute(
            `INSERT INTO social_traktir_claims (drop_id, claimer_id, claimed_at)
             VALUES (?, ?, ?)`,
            [cleanDropId, claimerId, now]
        );

        const newRemaining = Math.max(0, Number(drop.remaining_portions) - 1);
        await conn.execute(
            `UPDATE social_traktir_drops SET remaining_portions = ? WHERE id = ?`,
            [newRemaining, cleanDropId]
        );

        await addItem(conn, claimerId, item.id, 1, now, 'bag');

        const karmaRes = await awardCappedKarma(
            conn,
            drop.creator_id,
            Number(drop.karma_per_claim || KARMA_PER_CLAIM),
            now
        );

        await logPlayerActivity(conn, claimerId, 'traktir', 'claim_drop', {
            dropId: cleanDropId,
            creatorId: drop.creator_id,
            itemId: item.id,
            karmaGrantedToCreator: karmaRes.granted
        }, now);

        return {
            ok: true,
            drop: {
                ...drop,
                remaining_portions: newRemaining
            },
            item,
            claimer,
            karmaRes
        };
    });
}

async function donateToSocialPost(discordId, itemId, requestedQty = 1, now = Date.now()) {
    const item = getItem(itemId);
    if (!isSocialDonatableItem(item)) {
        return { ok: false, error: 'INVALID_ITEM' };
    }

    const qty = Math.max(1, Math.min(50, Math.floor(Number(requestedQty || 1))));
    const karmaPerUnit = getSocialDonationKarmaPerUnit(item);

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;

        const dailyUsed = await getDailyKarmaEarned(discordId, now);
        const remainingCap = Math.max(0, MAX_DAILY_KARMA_EARN - dailyUsed);
        if (remainingCap <= 0) {
            return {
                ok: false,
                error: 'DAILY_KARMA_CAP_REACHED',
                dailyUsed,
                dailyCap: MAX_DAILY_KARMA_EARN,
                player: p
            };
        }

        const maxAllowedQty = Math.max(1, Math.ceil(remainingCap / karmaPerUnit));
        if (qty > maxAllowedQty) {
            return {
                ok: false,
                error: 'EXCEEDS_DAILY_CAP',
                requestedQty: qty,
                maxAllowedQty,
                remainingCap,
                karmaPerUnit,
                dailyUsed,
                dailyCap: MAX_DAILY_KARMA_EARN,
                player: p
            };
        }

        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
        const owned = invRows
            .filter(r => r.item_id === item.id)
            .reduce((acc, r) => acc + Number(r.quantity || 0), 0);
        if (owned < qty) {
            return {
                ok: false,
                error: 'INSUFFICIENT_ITEM',
                owned,
                requested: qty,
                item,
                player: p
            };
        }

        const removed = await removeItem(conn, discordId, item.id, qty, 'bag');
        if (!removed) {
            return {
                ok: false,
                error: 'INSUFFICIENT_ITEM',
                owned,
                requested: qty,
                item,
                player: p
            };
        }

        const karmaRes = await awardCappedKarma(conn, discordId, qty * karmaPerUnit, now);
        p.karma_points = karmaRes.totalKarma;

        await logPlayerActivity(conn, discordId, 'traktir', 'donate_social', {
            itemId: item.id,
            qty,
            karmaPerUnit,
            karmaGranted: karmaRes.granted
        }, now);

        const updatedInv = await getPlayerInventory(conn, discordId, false, 'bag', now);
        return {
            ok: true,
            item,
            qty,
            karmaPerUnit,
            karmaRes,
            player: p,
            perks: getKarmaPerks(karmaRes.totalKarma),
            invRows: updatedInv
        };
    });
}

module.exports = {
    MAX_DAILY_KARMA_EARN,
    MIN_DROP_PORTIONS,
    MAX_DROP_PORTIONS,
    DROP_TTL_MS,
    KARMA_PER_CLAIM,
    KARMA_TIERS,
    getKarmaPerks,
    getDailyKarmaEarned,
    awardCappedKarma,
    isTraktirDropItem,
    getTraktirDropKarmaPerClaim,
    getTraktirBuyCatalog,
    getShareableBagRows,
    isSocialDonatableItem,
    getSocialDonationKarmaPerUnit,
    getDonatableBagRows,
    fetchTraktirState,
    createChannelTraktirDrop,
    claimChannelTraktirDrop,
    donateToSocialPost
};
