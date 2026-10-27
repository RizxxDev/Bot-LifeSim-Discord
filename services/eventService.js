const {
    WEATHER_CYCLE_DURATION_MS,
    LEBARAN_THR_DURATION_MS,
    LEBARAN_THR_MULTIPLIER,
    WEATHER_SEASONS,
    SEASONAL_EVENTS,
    getWeatherSeason,
    getSeasonalEventConfig,
    getFixedCalendarEventForTimestamp
} = require('../data/events');
const { getPlayerInventory, getMaxSlots, canFitItems, addItem, recordCollection } = require('./inventoryService');

const ACTIVITY_TOKEN_REWARDS = {
    work: 2,
    fishing: 1,
    mining: 1,
    farm_harvest: 2,
    cook_collect: 2
};

async function getCurrentWeather(conn = null, now = Date.now()) {
    let overrideId = null;
    if (conn) {
        try {
            const [rows] = await conn.execute(
                `SELECT cfg_value FROM economy_config WHERE cfg_key = 'weather_override' LIMIT 1`
            );
            const val = rows[0]?.cfg_value ? String(rows[0].cfg_value).trim().toLowerCase() : '';
            if (val && WEATHER_SEASONS[val]) {
                overrideId = val;
            }
        } catch {
            // Fallback ke siklus otomatis bila tabel belum tersedia
        }
    }
    return getWeatherSeason(now, overrideId);
}

async function setWeatherOverride(conn, mode = 'auto', now = Date.now()) {
    const cleanMode = String(mode || 'auto').toLowerCase();
    const val = WEATHER_SEASONS[cleanMode] ? cleanMode : '';
    await conn.execute(
        `INSERT INTO economy_config (cfg_key, cfg_value, updated_at)
         VALUES ('weather_override', ?, ?)
         ON DUPLICATE KEY UPDATE cfg_value = VALUES(cfg_value), updated_at = VALUES(updated_at)`,
        [val, now]
    );
    return getWeatherSeason(now, val || null);
}

function isLebaranThrActive(stateRow, now = Date.now()) {
    if (!stateRow || stateRow.event_id !== 'lebaran' || Number(stateRow.is_active) !== 1) {
        return { active: false, multiplier: 1.0, endsAt: null };
    }
    const startsAt = Number(stateRow.starts_at);
    const thrEndsAt = startsAt + LEBARAN_THR_DURATION_MS;
    const isActive = now >= startsAt && now <= thrEndsAt;
    return {
        active: isActive,
        multiplier: isActive ? LEBARAN_THR_MULTIPLIER : 1.0,
        startsAt,
        endsAt: thrEndsAt
    };
}

async function getActiveSeasonalEvent(conn, now = Date.now()) {
    if (!conn) return null;

    // 1. Nonaktifkan event yang sudah lewat ends_at
    await conn.execute(
        `UPDATE seasonal_events_state SET is_active = 0, updated_at = ? WHERE is_active = 1 AND ends_at < ?`,
        [now, now]
    );

    // 2. Cek apakah ada event yang sedang aktif di tabel seasonal_events_state
    const [activeRows] = await conn.execute(
        `SELECT * FROM seasonal_events_state WHERE is_active = 1 AND starts_at <= ? AND ends_at >= ? ORDER BY starts_at DESC LIMIT 1`,
        [now, now]
    );

    if (activeRows.length > 0) {
        const stateRow = activeRows[0];
        const config = getSeasonalEventConfig(stateRow.event_id);
        if (config) {
            return {
                stateRow,
                config,
                lebaranThr: isLebaranThrActive(stateRow, now)
            };
        }
    }

    // 3. Jika tidak ada, cek jadwal kalender tanggal tetap
    const fixedMatch = getFixedCalendarEventForTimestamp(now);
    if (!fixedMatch) return null;

    const [existingRows] = await conn.execute(
        `SELECT * FROM seasonal_events_state WHERE event_key = ? LIMIT 1`,
        [fixedMatch.eventKey]
    );

    if (existingRows.length > 0) {
        // Jika sudah ada tapi is_active = 0, berarti dihentikan manual oleh Admin
        if (Number(existingRows[0].is_active) === 0) {
            return null;
        }
        return {
            stateRow: existingRows[0],
            config: fixedMatch.eventConfig,
            lebaranThr: isLebaranThrActive(existingRows[0], now)
        };
    }

    // Auto-inisialisasi state event tanggal tetap
    await conn.execute(
        `INSERT INTO seasonal_events_state (event_key, event_id, starts_at, ends_at, community_progress, is_active, updated_at)
         VALUES (?, ?, ?, ?, 0, 1, ?)`,
        [fixedMatch.eventKey, fixedMatch.eventConfig.id, fixedMatch.startsAt, fixedMatch.endsAt, now]
    );

    const newStateRow = {
        event_key: fixedMatch.eventKey,
        event_id: fixedMatch.eventConfig.id,
        starts_at: fixedMatch.startsAt,
        ends_at: fixedMatch.endsAt,
        community_progress: 0,
        is_active: 1,
        updated_at: now
    };

    return {
        stateRow: newStateRow,
        config: fixedMatch.eventConfig,
        lebaranThr: isLebaranThrActive(newStateRow, now)
    };
}

async function startSeasonalEvent(conn, eventId, durationDays = 7, now = Date.now()) {
    const config = getSeasonalEventConfig(eventId);
    if (!config) {
        return { error: 'INVALID_EVENT' };
    }

    const days = Math.max(1, Math.min(30, Number(durationDays || 7)));
    const startsAt = now;
    const endsAt = now + days * 24 * 60 * 60 * 1000;
    const year = new Date(now + 7 * 3600000).getUTCFullYear();
    const eventKey = `${config.id}_${year}`;

    await conn.execute(
        `UPDATE seasonal_events_state SET is_active = 0, updated_at = ? WHERE is_active = 1`,
        [now]
    );

    await conn.execute(
        `INSERT INTO seasonal_events_state (event_key, event_id, starts_at, ends_at, community_progress, is_active, updated_at)
         VALUES (?, ?, ?, ?, 0, 1, ?)
         ON DUPLICATE KEY UPDATE starts_at = VALUES(starts_at), ends_at = VALUES(ends_at), is_active = 1, updated_at = VALUES(updated_at)`,
        [eventKey, config.id, startsAt, endsAt, now]
    );

    const [rows] = await conn.execute(
        `SELECT * FROM seasonal_events_state WHERE event_key = ? LIMIT 1`,
        [eventKey]
    );

    return {
        stateRow: rows[0],
        config,
        lebaranThr: isLebaranThrActive(rows[0], now)
    };
}

async function stopSeasonalEvent(conn, now = Date.now()) {
    const [activeRows] = await conn.execute(
        `SELECT * FROM seasonal_events_state WHERE is_active = 1`
    );
    await conn.execute(
        `UPDATE seasonal_events_state SET is_active = 0, updated_at = ? WHERE is_active = 1`,
        [now]
    );
    return activeRows;
}

async function getPlayerEventProgress(conn, discordId, eventKey, forUpdate = false) {
    const lockSql = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await conn.execute(
        `SELECT * FROM player_event_progress WHERE discord_id = ? AND event_key = ?${lockSql}`,
        [discordId, eventKey]
    );
    if (rows.length > 0) {
        return {
            discord_id: discordId,
            event_key: eventKey,
            token_balance: Number(rows[0].token_balance || 0),
            community_contribution: Number(rows[0].community_contribution || 0),
            goal_claimed: Number(rows[0].goal_claimed || 0) === 1
        };
    }
    return {
        discord_id: discordId,
        event_key: eventKey,
        token_balance: 0,
        community_contribution: 0,
        goal_claimed: false
    };
}

async function awardEventActivityProgress(conn, discordId, activityType, now = Date.now()) {
    const active = await getActiveSeasonalEvent(conn, now);
    if (!active) return null;

    const tokensAdded = ACTIVITY_TOKEN_REWARDS[activityType] || 1;
    const eventKey = active.stateRow.event_key;

    await conn.execute(
        `INSERT INTO player_event_progress (discord_id, event_key, token_balance, community_contribution, goal_claimed, updated_at)
         VALUES (?, ?, ?, 1, 0, ?)
         ON DUPLICATE KEY UPDATE
            token_balance = token_balance + VALUES(token_balance),
            community_contribution = community_contribution + 1,
            updated_at = VALUES(updated_at)`,
        [discordId, eventKey, tokensAdded, now]
    );

    await conn.execute(
        `UPDATE seasonal_events_state
         SET community_progress = community_progress + 1, updated_at = ?
         WHERE event_key = ?`,
        [now, eventKey]
    );

    return {
        eventKey,
        eventConfig: active.config,
        tokensAdded,
        tokenName: active.config.tokenName,
        tokenEmoji: active.config.tokenEmoji
    };
}

async function buyEventShopItem(conn, player, shopItemId, now = Date.now()) {
    const discordId = player.discord_id;
    const active = await getActiveSeasonalEvent(conn, now);
    if (!active) {
        return { error: 'NO_ACTIVE_EVENT' };
    }

    const shopItem = (active.config.shopItems || []).find(
        it => it.id.toLowerCase() === String(shopItemId || '').toLowerCase()
    );
    if (!shopItem) {
        return { error: 'INVALID_SHOP_ITEM', active };
    }

    const progress = await getPlayerEventProgress(conn, discordId, active.stateRow.event_key, true);
    if (progress.token_balance < shopItem.tokenCost) {
        return {
            error: 'INSUFFICIENT_TOKENS',
            required: shopItem.tokenCost,
            balance: progress.token_balance,
            active,
            shopItem
        };
    }

    if (shopItem.type === 'title') {
        const [existingTitle] = await conn.execute(
            `SELECT total_caught FROM player_collections WHERE discord_id = ? AND item_id = ? LIMIT 1`,
            [discordId, shopItem.id]
        );
        if (existingTitle.length > 0 && Number(existingTitle[0].total_caught) > 0) {
            return { error: 'TITLE_ALREADY_OWNED', shopItem, active };
        }
        await recordCollection(conn, discordId, shopItem.id, 1, now);
    } else if (shopItem.type === 'item') {
        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
        const fitCheck = canFitItems(invRows, Number(player.max_slots || 20), [{ itemId: shopItem.itemId, qty: shopItem.qty }]);
        if (!fitCheck.fits) {
            return { error: 'BAG_FULL', shopItem, active };
        }
        await addItem(conn, discordId, shopItem.itemId, shopItem.qty, now, 'bag');
    }

    const newBalance = progress.token_balance - shopItem.tokenCost;
    await conn.execute(
        `UPDATE player_event_progress SET token_balance = ?, updated_at = ? WHERE discord_id = ? AND event_key = ?`,
        [newBalance, now, discordId, active.stateRow.event_key]
    );

    return {
        shopItem,
        newBalance,
        active
    };
}

async function claimCommunityGoalReward(conn, player, now = Date.now()) {
    const discordId = player.discord_id;
    const active = await getActiveSeasonalEvent(conn, now);
    if (!active) {
        return { error: 'NO_ACTIVE_EVENT' };
    }

    const goal = active.config.communityGoal;
    const currentGlobal = Number(active.stateRow.community_progress || 0);
    if (currentGlobal < goal.target) {
        return {
            error: 'GOAL_NOT_REACHED',
            currentGlobal,
            target: goal.target,
            active
        };
    }

    const progress = await getPlayerEventProgress(conn, discordId, active.stateRow.event_key, true);
    if (progress.community_contribution < 1) {
        return { error: 'NO_CONTRIBUTION', active };
    }
    if (progress.goal_claimed) {
        return { error: 'ALREADY_CLAIMED', active };
    }

    const rewardItems = goal.rewardItems || [];
    if (rewardItems.length > 0) {
        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);
        const fitCheck = canFitItems(invRows, Number(player.max_slots || 20), rewardItems);
        if (!fitCheck.fits) {
            return { error: 'BAG_FULL', active };
        }
        for (const rw of rewardItems) {
            await addItem(conn, discordId, rw.itemId, rw.qty, now, 'bag');
        }
    }

    await conn.execute(
        `UPDATE player_event_progress SET goal_claimed = 1, updated_at = ? WHERE discord_id = ? AND event_key = ?`,
        [now, discordId, active.stateRow.event_key]
    );

    return {
        rewardItems,
        active
    };
}

module.exports = {
    WEATHER_CYCLE_DURATION_MS,
    LEBARAN_THR_DURATION_MS,
    LEBARAN_THR_MULTIPLIER,
    SEASONAL_EVENTS,
    getCurrentWeather,
    setWeatherOverride,
    isLebaranThrActive,
    getActiveSeasonalEvent,
    startSeasonalEvent,
    stopSeasonalEvent,
    getPlayerEventProgress,
    awardEventActivityProgress,
    buyEventShopItem,
    claimCommunityGoalReward
};
