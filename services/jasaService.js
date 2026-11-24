const { withTransaction } = require('../database/mariadb');
const { syncPlayerVitals } = require('./vitalService');
const { getPlayerInventory, addItem, removeItem, canFitItems, calculateSlotsUsed } = require('./inventoryService');
const { isItemPerishable } = require('./spoilageService');
const { debitPlayerFunds, creditPlayerCash } = require('./economyService');
const { logPlayerActivity } = require('./moderationService');
const { getCity, DEFAULT_CITY_ID } = require('../data/cities');
const { getItem, ITEMS } = require('../data/items');

const JASA_CONSTANTS = {
    MIN_QTY: 1,
    MAX_QTY: 50,
    MIN_REWARD_LP: 5000,
    MIN_PRICE_MULTIPLIER: 0.5,
    MAX_PRICE_MULTIPLIER: 5.0,
    TAX_RATE: 0.05,
    MAX_OPEN_ORDERS: 3,
    ORDER_EXPIRY_MS: 48 * 3600000
};

function getJasaItemBasePrice(item) {
    if (!item) return 0;
    return Math.max(Number(item.sellPrice || 0), Number(item.buyPrice || 0));
}

function classifyJasaCategory(item) {
    const tags = Array.isArray(item?.tags) ? item.tags : [];
    if (
        tags.includes('gather') ||
        tags.includes('raw_material') ||
        tags.includes('processed_material') ||
        tags.includes('building_material') ||
        tags.includes('ore') ||
        tags.includes('mineral') ||
        tags.includes('trash') ||
        tags.includes('spoiled') ||
        tags.includes('fuel') ||
        item.id.startsWith('sampah_') ||
        item.id === 'bahan_basi'
    ) {
        return 'alam';
    }
    if (
        tags.includes('crop') ||
        tags.includes('seed') ||
        tags.includes('feed') ||
        tags.includes('fertilizer') ||
        tags.includes('livestock_product') ||
        tags.includes('ingredient')
    ) {
        return 'tani';
    }
    return 'suplai';
}

function isJasaTradableItem(item) {
    if (!item || item.durability || item.maxDurability || item.untradable || item.lockedPrice) return false;
    if (item.id.endsWith('_sempurna')) return false;
    if (isItemPerishable(item.id)) return false;

    const tags = Array.isArray(item.tags) ? item.tags : [];
    const blockedTags = [
        'tool', 'fishing_rod', 'pickaxe', 'helmet', 'axe', 'shovel',
        'clothes', 'clothing', 'accessory', 'lootbox', 'gacha', 'gacha_ticket',
        'gacha_exclusive', 'trophy', 'voucher', 'relic', 'weapon', 'license',
        'service', 'prestise', 'storage', 'furniture', 'device', 'perfect_dish'
    ];
    if (tags.some(t => blockedTags.includes(t))) return false;

    const rarity = String(item.rarity || '').toLowerCase();
    if (['legendary', 'mythic'].includes(rarity)) return false;

    const allowedTags = [
        'gather', 'raw_material', 'processed_material', 'building_material',
        'ore', 'mineral', 'trash', 'spoiled', 'fuel',
        'crop', 'seed', 'feed', 'fertilizer', 'livestock_product', 'ingredient',
        'food', 'drink', 'cooked', 'medicine', 'bait', 'repair_kit'
    ];
    const hasAllowedTag = tags.some(t => allowedTags.includes(t)) || item.id.startsWith('sampah_') || item.id === 'bahan_basi';
    if (!hasAllowedTag) return false;

    return getJasaItemBasePrice(item) > 0;
}

function getJasaTradableItems(categoryFilter = null) {
    const all = ITEMS.filter(it => isJasaTradableItem(it));
    const filtered = categoryFilter
        ? all.filter(it => classifyJasaCategory(it) === categoryFilter)
        : all;

    return filtered.sort((a, b) => getJasaItemBasePrice(b) - getJasaItemBasePrice(a) || a.name.localeCompare(b.name));
}

function validateJasaOrderInput(itemId, qty, rewardLp) {
    const item = getItem(itemId);
    if (!isJasaTradableItem(item)) {
        return { ok: false, error: 'ITEM_NOT_TRADABLE' };
    }

    const cleanQty = Math.floor(Number(qty || 0));
    if (!Number.isFinite(cleanQty) || cleanQty < JASA_CONSTANTS.MIN_QTY || cleanQty > JASA_CONSTANTS.MAX_QTY) {
        return {
            ok: false,
            error: 'INVALID_QTY',
            minQty: JASA_CONSTANTS.MIN_QTY,
            maxQty: JASA_CONSTANTS.MAX_QTY
        };
    }

    const unitBasePrice = getJasaItemBasePrice(item);
    const baseTotalValue = unitBasePrice * cleanQty;
    const minRewardLp = Math.max(
        JASA_CONSTANTS.MIN_REWARD_LP,
        Math.round(baseTotalValue * JASA_CONSTANTS.MIN_PRICE_MULTIPLIER)
    );
    const maxRewardLp = Math.max(
        minRewardLp,
        Math.round(baseTotalValue * JASA_CONSTANTS.MAX_PRICE_MULTIPLIER)
    );

    const cleanReward = Math.floor(Number(rewardLp || 0));
    if (!Number.isFinite(cleanReward) || cleanReward < minRewardLp || cleanReward > maxRewardLp) {
        return {
            ok: false,
            error: 'REWARD_OUT_OF_BOUNDS',
            minRewardLp,
            maxRewardLp,
            baseTotalValue,
            item,
            qty: cleanQty
        };
    }

    const taxLp = Math.round(cleanReward * JASA_CONSTANTS.TAX_RATE);
    const workerPayoutLp = cleanReward - taxLp;

    return {
        ok: true,
        item,
        qty: cleanQty,
        unitBasePrice,
        baseTotalValue,
        minRewardLp,
        maxRewardLp,
        rewardLp: cleanReward,
        taxLp,
        workerPayoutLp
    };
}

async function fetchJasaState(discordId, cityFilter = 'all', now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, false);
        const player = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, false, 'bag', now);
        const slotsUsed = calculateSlotsUsed(invRows);

        let citySql = '';
        const openParams = [now];
        if (cityFilter && cityFilter !== 'all') {
            citySql = ' AND jc.target_city_id = ?';
            openParams.push(cityFilter);
        }

        const [openContracts] = await conn.execute(
            `SELECT jc.*, p.username AS requester_name
             FROM jasa_contracts jc
             LEFT JOIN players p ON p.discord_id = jc.requester_id
             WHERE jc.status = 'open' AND jc.expires_at > ?${citySql}
             ORDER BY jc.reward_lp DESC, jc.created_at DESC
             LIMIT 25`,
            openParams
        );

        const [myContracts] = await conn.execute(
            `SELECT jc.*, p.username AS worker_name
             FROM jasa_contracts jc
             LEFT JOIN players p ON p.discord_id = jc.worker_id
             WHERE jc.requester_id = ?
             ORDER BY CASE WHEN jc.status = 'open' THEN 0 ELSE 1 END ASC, jc.created_at DESC
             LIMIT 10`,
            [discordId]
        );

        const [claimBoxes] = await conn.execute(
            `SELECT * FROM player_jasa_claim_box
             WHERE discord_id = ?
             ORDER BY created_at ASC`,
            [discordId]
        );

        return {
            player,
            invRows,
            slotsUsed,
            openContracts,
            myContracts,
            claimBoxes,
            cityFilter
        };
    });
}

async function createJasaContract(discordId, {
    targetCityId = null,
    itemId,
    quantity,
    rewardLp,
    note = null,
    now = Date.now()
}) {
    const valid = validateJasaOrderInput(itemId, quantity, rewardLp);
    if (!valid.ok) {
        return valid;
    }

    const cleanNote = note ? String(note).trim().slice(0, 120) || null : null;

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;

        if (Number(p.hospital_until || 0) > now) {
            return { ok: false, error: 'IN_HOSPITAL', until: Number(p.hospital_until), player: p };
        }
        if (Number(p.sleeping_until || 0) > now) {
            return { ok: false, error: 'SLEEPING', until: Number(p.sleeping_until), player: p };
        }

        const resolvedCity = getCity(targetCityId || p.current_city || DEFAULT_CITY_ID);
        const [countRows] = await conn.execute(
            `SELECT COUNT(*) AS cnt FROM jasa_contracts WHERE requester_id = ? AND status = 'open'`,
            [discordId]
        );
        const openCount = Number(countRows[0]?.cnt || 0);
        if (openCount >= JASA_CONSTANTS.MAX_OPEN_ORDERS) {
            return {
                ok: false,
                error: 'TOO_MANY_OPEN_ORDERS',
                openCount,
                max: JASA_CONSTANTS.MAX_OPEN_ORDERS,
                player: p
            };
        }

        const totalFunds = Number(p.cash || 0) + Number(p.bank || 0);
        if (totalFunds < valid.rewardLp) {
            return {
                ok: false,
                error: 'INSUFFICIENT_FUNDS',
                required: valid.rewardLp,
                totalFunds,
                player: p
            };
        }

        await debitPlayerFunds(conn, p, valid.rewardLp, 'jasa_escrow', {
            itemId: valid.item.id,
            quantity: valid.qty,
            targetCityId: resolvedCity.id
        }, now);

        const expiresAt = now + JASA_CONSTANTS.ORDER_EXPIRY_MS;
        const [ins] = await conn.execute(
            `INSERT INTO jasa_contracts
                (requester_id, target_city_id, item_id, quantity, reward_lp, note, status, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
            [
                discordId,
                resolvedCity.id,
                valid.item.id,
                valid.qty,
                valid.rewardLp,
                cleanNote,
                expiresAt,
                now
            ]
        );

        const contractId = Number(ins.insertId);
        await logPlayerActivity(conn, discordId, 'jasa', 'create_contract', {
            contractId,
            targetCityId: resolvedCity.id,
            itemId: valid.item.id,
            quantity: valid.qty,
            rewardLp: valid.rewardLp
        }, now);

        return {
            ok: true,
            contract: {
                id: contractId,
                requester_id: discordId,
                target_city_id: resolvedCity.id,
                item_id: valid.item.id,
                quantity: valid.qty,
                reward_lp: valid.rewardLp,
                note: cleanNote,
                status: 'open',
                expires_at: expiresAt,
                created_at: now
            },
            validation: valid,
            city: resolvedCity,
            player: p
        };
    });
}

async function fulfillJasaContract(workerId, contractId, now = Date.now()) {
    const cleanId = Number(contractId || 0);
    if (!Number.isFinite(cleanId) || cleanId <= 0) {
        return { ok: false, error: 'CONTRACT_NOT_FOUND' };
    }

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, workerId, now, true);
        const worker = synced.player;

        if (Number(worker.hospital_until || 0) > now) {
            return { ok: false, error: 'IN_HOSPITAL', until: Number(worker.hospital_until), player: worker };
        }
        if (Number(worker.sleeping_until || 0) > now) {
            return { ok: false, error: 'SLEEPING', until: Number(worker.sleeping_until), player: worker };
        }
        if (worker.is_travelling) {
            return { ok: false, error: 'TRAVELLING', until: Number(worker.travel_until || 0), player: worker };
        }

        const [rows] = await conn.execute(
            `SELECT jc.*, p.username AS requester_name
             FROM jasa_contracts jc
             LEFT JOIN players p ON p.discord_id = jc.requester_id
             WHERE jc.id = ?
             FOR UPDATE`,
            [cleanId]
        );
        const contract = rows[0];
        if (!contract) {
            return { ok: false, error: 'CONTRACT_NOT_FOUND', player: worker };
        }
        if (contract.status !== 'open') {
            return { ok: false, error: 'CONTRACT_NOT_OPEN', contract, player: worker };
        }
        if (Number(contract.expires_at) <= now) {
            return { ok: false, error: 'CONTRACT_EXPIRED', contract, player: worker };
        }
        if (contract.requester_id === workerId) {
            return { ok: false, error: 'SELF_FULFILL', contract, player: worker };
        }

        const workerCity = worker.current_city || DEFAULT_CITY_ID;
        if (workerCity !== contract.target_city_id) {
            return {
                ok: false,
                error: 'WRONG_CITY',
                requiredCityId: contract.target_city_id,
                currentCityId: workerCity,
                contract,
                player: worker
            };
        }

        const item = getItem(contract.item_id);
        const invRows = await getPlayerInventory(conn, workerId, true, 'bag', now);
        const owned = invRows
            .filter(r => r.item_id === contract.item_id)
            .reduce((acc, r) => acc + Number(r.quantity || 0), 0);
        const needed = Number(contract.quantity || 0);

        if (owned < needed) {
            return {
                ok: false,
                error: 'INSUFFICIENT_ITEM',
                owned,
                required: needed,
                item,
                contract,
                player: worker
            };
        }

        const removed = await removeItem(conn, workerId, contract.item_id, needed, 'bag');
        if (!removed) {
            return {
                ok: false,
                error: 'INSUFFICIENT_ITEM',
                owned,
                required: needed,
                item,
                contract,
                player: worker
            };
        }

        await conn.execute(
            `UPDATE jasa_contracts
             SET status = 'completed', worker_id = ?, completed_at = ?
             WHERE id = ?`,
            [workerId, now, cleanId]
        );

        await conn.execute(
            `INSERT INTO player_jasa_claim_box
                (discord_id, contract_id, item_id, quantity, delivery_city_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                contract.requester_id,
                cleanId,
                contract.item_id,
                needed,
                contract.target_city_id,
                now
            ]
        );

        const grossReward = Number(contract.reward_lp || 0);
        const taxLp = Math.round(grossReward * JASA_CONSTANTS.TAX_RATE);
        const workerPayoutLp = grossReward - taxLp;

        await creditPlayerCash(conn, worker, workerPayoutLp, 'jasa_payout', {
            contractId: cleanId,
            requesterId: contract.requester_id,
            grossReward,
            taxLp
        }, now);

        await logPlayerActivity(conn, workerId, 'jasa', 'fulfill_contract', {
            contractId: cleanId,
            requesterId: contract.requester_id,
            itemId: contract.item_id,
            quantity: needed,
            workerPayoutLp,
            taxLp
        }, now);

        return {
            ok: true,
            contract: { ...contract, status: 'completed', worker_id: workerId, completed_at: now },
            item,
            grossReward,
            taxLp,
            workerPayoutLp,
            player: worker
        };
    });
}

async function cancelJasaContract(discordId, contractId, now = Date.now()) {
    const cleanId = Number(contractId || 0);
    if (!Number.isFinite(cleanId) || cleanId <= 0) {
        return { ok: false, error: 'CONTRACT_NOT_FOUND' };
    }

    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;

        const [rows] = await conn.execute(
            `SELECT * FROM jasa_contracts WHERE id = ? FOR UPDATE`,
            [cleanId]
        );
        const contract = rows[0];
        if (!contract || contract.requester_id !== discordId) {
            return { ok: false, error: 'CONTRACT_NOT_FOUND', player: p };
        }
        if (contract.status !== 'open') {
            return { ok: false, error: 'CONTRACT_NOT_OPEN', contract, player: p };
        }

        await conn.execute(
            `UPDATE jasa_contracts SET status = 'cancelled', completed_at = ? WHERE id = ?`,
            [now, cleanId]
        );

        const refundLp = Number(contract.reward_lp || 0);
        await creditPlayerCash(conn, p, refundLp, 'jasa_refund_cancel', {
            contractId: cleanId
        }, now);

        await logPlayerActivity(conn, discordId, 'jasa', 'cancel_contract', {
            contractId: cleanId,
            refundLp
        }, now);

        return {
            ok: true,
            contract: { ...contract, status: 'cancelled' },
            item: getItem(contract.item_id),
            refundLp,
            player: p
        };
    });
}

async function claimJasaDeliveries(discordId, boxId = null, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const p = synced.player;
        const currentCity = p.current_city || DEFAULT_CITY_ID;

        if (p.is_travelling) {
            return { ok: false, error: 'TRAVELLING', player: p };
        }

        const query = boxId
            ? `SELECT * FROM player_jasa_claim_box WHERE discord_id = ? AND id = ? FOR UPDATE`
            : `SELECT * FROM player_jasa_claim_box WHERE discord_id = ? ORDER BY created_at ASC FOR UPDATE`;
        const params = boxId ? [discordId, Number(boxId)] : [discordId];
        const [boxes] = await conn.execute(query, params);

        if (boxes.length === 0) {
            return { ok: false, error: 'NO_DELIVERIES', player: p };
        }

        const localBoxes = boxes.filter(b => b.delivery_city_id === currentCity);
        if (localBoxes.length === 0) {
            return {
                ok: false,
                error: 'WRONG_CITY',
                requiredCityId: boxes[0].delivery_city_id,
                currentCityId: currentCity,
                player: p
            };
        }

        let invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
        const claimed = [];
        let blockedByBag = false;

        for (const box of localBoxes) {
            const fit = canFitItems(invRows, p.max_slots, [{ itemId: box.item_id, qty: Number(box.quantity) }]);
            if (!fit.fits) {
                blockedByBag = true;
                break;
            }
            await addItem(conn, discordId, box.item_id, Number(box.quantity), now, 'bag');
            await conn.execute(`DELETE FROM player_jasa_claim_box WHERE id = ?`, [box.id]);
            invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
            claimed.push({
                boxId: box.id,
                contractId: box.contract_id,
                item: getItem(box.item_id),
                itemId: box.item_id,
                quantity: Number(box.quantity)
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

        await logPlayerActivity(conn, discordId, 'jasa', 'claim_delivery', {
            claimedCount: claimed.length,
            cityId: currentCity
        }, now);

        return {
            ok: true,
            claimed,
            partialBagFull: blockedByBag,
            player: p
        };
    });
}

async function processExpiredJasaContracts(conn, now = Date.now()) {
    const [expiredRows] = await conn.execute(
        `SELECT * FROM jasa_contracts
         WHERE status = 'open' AND expires_at <= ?
         ORDER BY expires_at ASC
         LIMIT 25
         FOR UPDATE`,
        [now]
    );

    let processed = 0;
    for (const c of expiredRows) {
        await conn.execute(
            `UPDATE jasa_contracts SET status = 'expired', completed_at = ? WHERE id = ?`,
            [now, c.id]
        );
        const [pRows] = await conn.execute(
            `SELECT discord_id, cash, bank FROM players WHERE discord_id = ? FOR UPDATE`,
            [c.requester_id]
        );
        if (pRows[0]) {
            await creditPlayerCash(conn, pRows[0], Number(c.reward_lp || 0), 'jasa_refund_expired', {
                contractId: c.id
            }, now);
        }
        processed += 1;
    }

    return processed;
}

module.exports = {
    JASA_CONSTANTS,
    getJasaItemBasePrice,
    classifyJasaCategory,
    isJasaTradableItem,
    getJasaTradableItems,
    validateJasaOrderInput,
    fetchJasaState,
    createJasaContract,
    fulfillJasaContract,
    cancelJasaContract,
    claimJasaDeliveries,
    processExpiredJasaContracts
};
