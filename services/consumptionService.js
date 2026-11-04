const { withTransaction, query } = require('../database/mariadb');
const { getCaffeineCount, incrementCaffeineCount } = require('../database/redis');
const { syncPlayerVitals } = require('./vitalService');
const { getPlayerInventory, removeItem } = require('./inventoryService');
const { formatFreshnessBadge } = require('./spoilageService');
const { getItem } = require('../data/items');
const { VITALS } = require('../data/constants');

function getAllowedTagsForTab(tab = 'food') {
    if (tab === 'food' || tab === 'eat') return ['food'];
    if (tab === 'drink') return ['drink'];
    return ['medicine', 'service', 'prestise', 'license'];
}

function getTabForItem(item) {
    if (!item || !item.tags) return 'use';
    if (item.tags.includes('food')) return 'food';
    if (item.tags.includes('drink')) return 'drink';
    return 'use';
}

function formatItemEffectSummary(item) {
    if (!item) return '';
    if (item.id === 'gas_lpg') {
        return `🔥 +${item.lpgCharges || 10} muatan kompor`;
    }
    if (item.id === 'surat_ganti_nama') {
        return '📜 Ganti username karakter';
    }
    if (item.tags && item.tags.includes('prestise') && item.titleLabel) {
        return `👑 Pasang gelar "${item.titleLabel}"`;
    }
    if (item.id === 'sim_c' || item.id === 'sim_a' || item.id === 'laptop' || item.id === 'surat_izin_melaut') {
        return '🪪 Item pasif (otomatis aktif di tas)';
    }

    const parts = [];
    if (item.effects?.hunger) parts.push(`🍔+${item.effects.hunger}`);
    if (item.effects?.thirst) parts.push(`💧+${item.effects.thirst}`);
    if (item.effects?.energy) parts.push(`⚡+${item.effects.energy}`);
    if (item.effects?.health) parts.push(`❤️+${item.effects.health}`);
    if (item.buff) parts.push(`✨${item.buff.label}`);
    return parts.join(' · ') || 'Siap digunakan';
}

/**
 * Mengelompokkan item di tas berdasarkan tab ('food' | 'drink' | 'use').
 */
function groupBagConsumables(invRows = [], tab = 'food') {
    const allowedTags = getAllowedTagsForTab(tab);
    const map = new Map();

    for (const row of invRows) {
        const qty = Number(row.quantity || 0);
        if (qty <= 0) continue;
        const item = getItem(row.item_id);
        if (!item || !item.tags) continue;

        const matches = allowedTags.some(t => item.tags.includes(t)) ||
            (tab === 'use' && item.id === 'gas_lpg');
        if (!matches) continue;

        const existing = map.get(item.id);
        const remMs = row.freshness_remaining_ms !== null && row.freshness_remaining_ms !== undefined
            ? Number(row.freshness_remaining_ms)
            : null;

        if (!existing) {
            map.set(item.id, {
                item,
                totalQty: qty,
                minFreshnessMs: remMs
            });
        } else {
            existing.totalQty += qty;
            if (remMs !== null) {
                existing.minFreshnessMs = existing.minFreshnessMs === null
                    ? remMs
                    : Math.min(existing.minFreshnessMs, remMs);
            }
        }
    }

    return Array.from(map.values()).map(entry => ({
        ...entry,
        effectSummary: formatItemEffectSummary(entry.item),
        freshnessBadge: entry.minFreshnessMs !== null ? formatFreshnessBadge(entry.minFreshnessMs, 'bag') : ''
    }));
}

/**
 * Mengeksekusi konsumsi item (makanan, minuman, obat, gas LPG, gelar prestise) secara transaksional.
 */
async function executeItemConsumption(discordId, itemId, requestedAmount = 1, now = Date.now()) {
    const item = getItem(itemId);
    if (!item) {
        return { error: 'INVALID_ITEM' };
    }

    const tab = getTabForItem(item);
    let caffeineBefore = 0;
    if (item.caffeineType) {
        caffeineBefore = await getCaffeineCount(discordId, item.caffeineType, now);
    }

    const result = await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const player = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);

        const ownedQty = invRows
            .filter(r => r.item_id === item.id)
            .reduce((acc, r) => acc + Number(r.quantity), 0);

        if (ownedQty <= 0) {
            return { error: 'NOT_OWNED', player, invRows };
        }

        // Gelar Prestise: pasang gelar, tidak habis dipakai
        if (item.tags && item.tags.includes('prestise') && item.titleLabel) {
            await conn.execute(
                `UPDATE players SET equipped_title = ? WHERE discord_id = ?`,
                [item.titleLabel, discordId]
            );
            player.equipped_title = item.titleLabel;
            return {
                ok: true,
                equippedTitle: item.titleLabel,
                player,
                invRows
            };
        }

        // Item pasif
        if (item.id === 'sim_c' || item.id === 'sim_a' || item.id === 'laptop' || item.id === 'surat_izin_melaut') {
            return { error: 'PASSIVE_ITEM', player, invRows };
        }

        // Tabung Gas LPG 3kg: +10 muatan kompor per tabung
        if (item.id === 'gas_lpg') {
            const cap = requestedAmount === 'max' ? ownedQty : Math.max(1, Math.min(20, Number(requestedAmount) || 1));
            const useGas = Math.min(ownedQty, cap);
            const addedCharges = useGas * (item.lpgCharges || 10);
            await removeItem(conn, discordId, item.id, useGas, 'bag');
            const newCharges = Number(player.lpg_charges || 0) + addedCharges;
            await conn.execute(
                `UPDATE players SET lpg_charges = ? WHERE discord_id = ?`,
                [newCharges, discordId]
            );
            player.lpg_charges = newCharges;
            const updatedInv = await getPlayerInventory(conn, discordId, false, 'bag', now);
            return {
                ok: true,
                lpgRefilled: true,
                usedCount: useGas,
                addedCharges,
                totalCharges: newCharges,
                remainingOwned: ownedQty - useGas,
                player,
                invRows: updatedInv
            };
        }

        const requestedCap = requestedAmount === 'max'
            ? Math.min(ownedQty, 20)
            : Math.max(1, Math.min(20, Number(requestedAmount) || 1));
        const maxUsable = Math.min(ownedQty, requestedCap);

        let usedCount = 0;
        const totalGain = { hunger: 0, thirst: 0, energy: 0, health: 0 };
        let caffeineReducedCount = 0;

        for (let i = 0; i < maxUsable; i++) {
            if (tab === 'food' && player.hunger >= VITALS.MAX && (!item.buff || usedCount > 0)) {
                break;
            }
            if (tab === 'drink' && player.thirst >= VITALS.MAX && (!item.effects?.energy || player.energy >= VITALS.MAX)) {
                break;
            }
            if (tab === 'use' && item.effects?.health && !item.effects?.energy && (!item.buff || usedCount > 0) && player.health >= VITALS.MAX) {
                break;
            }

            usedCount += 1;

            if (item.effects?.hunger) {
                const before = player.hunger;
                player.hunger = Math.min(VITALS.MAX, player.hunger + item.effects.hunger);
                totalGain.hunger += (player.hunger - before);
            }
            if (item.effects?.thirst) {
                const before = player.thirst;
                player.thirst = Math.min(VITALS.MAX, player.thirst + item.effects.thirst);
                totalGain.thirst += (player.thirst - before);
            }
            if (item.effects?.health) {
                const before = player.health;
                player.health = Math.min(VITALS.MAX, player.health + item.effects.health);
                totalGain.health += (player.health - before);
            }
            if (item.effects?.energy) {
                let energyEffect = item.effects.energy;
                if (item.caffeineType) {
                    const cupIndex = caffeineBefore + usedCount;
                    if (cupIndex >= 3) {
                        energyEffect = item.caffeineType === 'kopi' ? 5 : 8;
                        caffeineReducedCount += 1;
                    }
                }
                const before = player.energy;
                player.energy = Math.min(VITALS.MAX, player.energy + energyEffect);
                totalGain.energy += (player.energy - before);
            }
        }

        if (usedCount === 0) {
            return { error: 'ALREADY_FULL', player, invRows };
        }

        await removeItem(conn, discordId, item.id, usedCount, 'bag');

        const isCookedDish = item.tags && item.tags.includes('cooked');
        const addedCookedEaten = isCookedDish ? usedCount : 0;
        player.cooked_dishes_eaten = Number(player.cooked_dishes_eaten || 0) + addedCookedEaten;

        await conn.execute(
            `UPDATE players SET energy = ?, hunger = ?, thirst = ?, health = ?, cooked_dishes_eaten = cooked_dishes_eaten + ? WHERE discord_id = ?`,
            [player.energy, player.hunger, player.thirst, player.health, addedCookedEaten, discordId]
        );

        let appliedBuff = null;
        let buffSkippedStronger = false;
        if (item.buff) {
            const existingBuff = (synced.buffs || []).find(
                b => b.buff_type === item.buff.type && Number(b.expires_at) > now
            );
            if (item.buff.isHomeCooked && existingBuff && Number(existingBuff.multiplier) > Number(item.buff.multiplier)) {
                buffSkippedStronger = true;
            } else {
                const expiresAt = now + item.buff.durationSec * 1000;
                await conn.execute(
                    `INSERT INTO player_buffs (discord_id, buff_type, multiplier, expires_at)
                     VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE multiplier = VALUES(multiplier), expires_at = VALUES(expires_at)`,
                    [discordId, item.buff.type, item.buff.multiplier, expiresAt]
                );
                appliedBuff = item.buff;
            }
        }

        const updatedInv = await getPlayerInventory(conn, discordId, false, 'bag', now);
        return {
            ok: true,
            item,
            usedCount,
            remainingOwned: ownedQty - usedCount,
            totalGain,
            caffeineReducedCount,
            appliedBuff,
            buffSkippedStronger,
            player,
            invRows: updatedInv
        };
    });

    if (result.ok && item.caffeineType && result.usedCount > 0) {
        await incrementCaffeineCount(discordId, item.caffeineType, result.usedCount, now);
    }

    return result;
}

/**
 * Makan/minum cepat otomatis dari tombol pasca-aktivitas (/work, /fishing, /mining).
 * Memulihkan Hunger & Thirst menggunakan makanan/minuman yang tersedia di tas.
 */
async function executeQuickMeal(discordId, now = Date.now()) {
    return await withTransaction(async (conn) => {
        const synced = await syncPlayerVitals(conn, discordId, now, true);
        const player = synced.player;
        const invRows = await getPlayerInventory(conn, discordId, true, 'bag', now);

        const consumedSummary = [];
        let totalCookedAdded = 0;

        // 1. Pulihkan Hunger jika < 85
        if (player.hunger < 85) {
            const foods = groupBagConsumables(invRows, 'food');
            for (const f of foods) {
                if (player.hunger >= 95) break;
                const gainPerUnit = Number(f.item.effects?.hunger || 0);
                if (gainPerUnit <= 0) continue;
                const needed = Math.ceil((100 - player.hunger) / gainPerUnit);
                const useQty = Math.min(f.totalQty, Math.max(1, needed));
                await removeItem(conn, discordId, f.item.id, useQty, 'bag');
                player.hunger = Math.min(VITALS.MAX, player.hunger + gainPerUnit * useQty);
                if (f.item.effects?.energy) {
                    player.energy = Math.min(VITALS.MAX, player.energy + f.item.effects.energy * useQty);
                }
                if (f.item.tags && f.item.tags.includes('cooked')) {
                    totalCookedAdded += useQty;
                }
                consumedSummary.push(`${f.item.emoji} ${f.item.name} ×${useQty}`);
            }
        }

        // 2. Pulihkan Thirst jika < 85
        if (player.thirst < 85) {
            const drinks = groupBagConsumables(invRows, 'drink');
            for (const d of drinks) {
                if (player.thirst >= 95) break;
                const gainPerUnit = Number(d.item.effects?.thirst || 0);
                if (gainPerUnit <= 0) continue;
                const needed = Math.ceil((100 - player.thirst) / gainPerUnit);
                const useQty = Math.min(d.totalQty, Math.max(1, needed));
                await removeItem(conn, discordId, d.item.id, useQty, 'bag');
                player.thirst = Math.min(VITALS.MAX, player.thirst + gainPerUnit * useQty);
                if (d.item.effects?.energy) {
                    player.energy = Math.min(VITALS.MAX, player.energy + d.item.effects.energy * useQty);
                }
                consumedSummary.push(`${d.item.emoji} ${d.item.name} ×${useQty}`);
            }
        }

        if (consumedSummary.length > 0) {
            player.cooked_dishes_eaten = Number(player.cooked_dishes_eaten || 0) + totalCookedAdded;
            await conn.execute(
                `UPDATE players SET energy = ?, hunger = ?, thirst = ?, health = ?, cooked_dishes_eaten = cooked_dishes_eaten + ? WHERE discord_id = ?`,
                [player.energy, player.hunger, player.thirst, player.health, totalCookedAdded, discordId]
            );
        }

        return {
            consumedSummary,
            player
        };
    });
}

module.exports = {
    getAllowedTagsForTab,
    getTabForItem,
    formatItemEffectSummary,
    groupBagConsumables,
    executeItemConsumption,
    executeQuickMeal
};
