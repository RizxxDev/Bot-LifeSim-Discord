const fs = require('fs');
const crypto = require('crypto');
const { AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const {
    AVATAR_CANVAS_SIZE,
    CLOTHING_SLOTS,
    CLOTHES,
    STARTER_CLOTHING_IDS,
    getClothing,
    getClothingSlot,
    getClothingAssetPath
} = require('../data/clothes');

const IMAGE_CACHE = new Map();
const RENDER_CACHE = new Map();
const MAX_RENDER_CACHE = 150;

/**
 * Menormalkan objek pakaian aktif pemain.
 * Jika pemain belum pernah mengatur lemari (row === null), gunakan tubuh polos cerah & rambut pendek hitam.
 */
function normalizeEquippedOutfit(row = null) {
    if (!row) {
        return {
            body: 'chibi_body_light',
            hair: 'hair_short_black',
            hat: null,
            top: null,
            bottom: null,
            shoes: null,
            accessory: null
        };
    }

    const bodyObj = getClothing(row.equipped_body);
    return {
        body: (bodyObj && bodyObj.slot === 'body') ? bodyObj.id : 'chibi_body_light',
        hair: row.equipped_hair && getClothing(row.equipped_hair)?.slot === 'hair' ? row.equipped_hair : null,
        hat: row.equipped_hat && getClothing(row.equipped_hat)?.slot === 'hat' ? row.equipped_hat : null,
        top: row.equipped_top && getClothing(row.equipped_top)?.slot === 'top' ? row.equipped_top : null,
        bottom: row.equipped_bottom && getClothing(row.equipped_bottom)?.slot === 'bottom' ? row.equipped_bottom : null,
        shoes: row.equipped_shoes && getClothing(row.equipped_shoes)?.slot === 'shoes' ? row.equipped_shoes : null,
        accessory: row.equipped_accessory && getClothing(row.equipped_accessory)?.slot === 'accessory' ? row.equipped_accessory : null
    };
}

function buildOutfitSignature(equipped) {
    const norm = normalizeEquippedOutfit({
        equipped_body: equipped?.body ?? equipped?.equipped_body,
        equipped_hair: equipped?.hair !== undefined ? equipped.hair : equipped?.equipped_hair,
        equipped_hat: equipped?.hat ?? equipped?.equipped_hat,
        equipped_top: equipped?.top ?? equipped?.equipped_top,
        equipped_bottom: equipped?.bottom ?? equipped?.equipped_bottom,
        equipped_shoes: equipped?.shoes ?? equipped?.equipped_shoes,
        equipped_accessory: equipped?.accessory ?? equipped?.equipped_accessory
    });
    return CLOTHING_SLOTS.map(s => `${s.id}:${norm[s.id] || 'none'}`).join('|');
}

function getHighestEquippedRarity(normOutfit) {
    const rank = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };
    let best = 'common';
    for (const slot of CLOTHING_SLOTS) {
        if (slot.id === 'body') continue;
        const item = getClothing(normOutfit[slot.id]);
        if (item && (rank[item.rarity] || 1) > (rank[best] || 1)) {
            best = item.rarity;
        }
    }
    return best;
}

async function loadCachedLayerImage(clothingId) {
    if (!clothingId) return null;
    if (IMAGE_CACHE.has(clothingId)) {
        return IMAGE_CACHE.get(clothingId);
    }
    const assetPath = getClothingAssetPath(clothingId);
    if (!assetPath || !fs.existsSync(assetPath)) {
        return null;
    }
    const buf = fs.readFileSync(assetPath);
    const img = await loadImage(buf);
    IMAGE_CACHE.set(clothingId, img);
    return img;
}

function clearAvatarCache() {
    IMAGE_CACHE.clear();
    RENDER_CACHE.clear();
}

function drawPortraitBackdrop(ctx, highestRarity) {
    const s = AVATAR_CANVAS_SIZE;
    const pad = 6;
    const w = s - pad * 2;
    const r = 28;

    const palettes = {
        common: ['#F4F7FB', '#DDE5F0', '#CBD5E1'],
        uncommon: ['#ECFDF5', '#D1FAE5', '#6EE7B7'],
        rare: ['#EFF6FF', '#DBEAFE', '#60A5FA'],
        epic: ['#FAF5FF', '#F3E8FF', '#C084FC'],
        legendary: ['#FFFBEB', '#FEF3C7', '#F59E0B']
    };
    const [topCol, botCol, borderCol] = palettes[highestRarity] || palettes.common;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pad + r, pad);
    ctx.lineTo(pad + w - r, pad);
    ctx.quadraticCurveTo(pad + w, pad, pad + w, pad + r);
    ctx.lineTo(pad + w, pad + w - r);
    ctx.quadraticCurveTo(pad + w, pad + w, pad + w - r, pad + w);
    ctx.lineTo(pad + r, pad + w);
    ctx.quadraticCurveTo(pad, pad + w, pad, pad + w - r);
    ctx.lineTo(pad, pad + r);
    ctx.quadraticCurveTo(pad, pad, pad + r, pad);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, pad, 0, pad + w);
    grad.addColorStop(0, topCol);
    grad.addColorStop(1, botCol);
    ctx.fillStyle = grad;
    ctx.fill();

    // Soft radial spotlight behind chibi head/body
    const radGrad = ctx.createRadialGradient(s / 2, s * 0.45, 16, s / 2, s * 0.45, 110);
    radGrad.addColorStop(0, 'rgba(255, 255, 255, 0.75)');
    radGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = radGrad;
    ctx.fill();

    ctx.lineWidth = 4;
    ctx.strokeStyle = borderCol;
    ctx.stroke();
    ctx.restore();
}

/**
 * Merender gambar PNG 256x256 avatar chibi berdasarkan kombinasi layer pakaian aktif.
 */
async function generateAvatarBuffer(equippedInput = null) {
    const norm = (equippedInput && equippedInput.body !== undefined)
        ? normalizeEquippedOutfit({
            equipped_body: equippedInput.body,
            equipped_hair: equippedInput.hair,
            equipped_hat: equippedInput.hat,
            equipped_top: equippedInput.top,
            equipped_bottom: equippedInput.bottom,
            equipped_shoes: equippedInput.shoes,
            equipped_accessory: equippedInput.accessory
        })
        : normalizeEquippedOutfit(equippedInput);

    const sig = buildOutfitSignature(norm);
    if (RENDER_CACHE.has(sig)) {
        return RENDER_CACHE.get(sig);
    }

    const canvas = createCanvas(AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
    const ctx = canvas.getContext('2d');

    const highestRarity = getHighestEquippedRarity(norm);
    drawPortraitBackdrop(ctx, highestRarity);

    for (const slot of CLOTHING_SLOTS) {
        const cid = norm[slot.id];
        if (!cid) continue;
        const img = await loadCachedLayerImage(cid);
        if (img) {
            ctx.drawImage(img, 0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
        }
    }

    const buffer = canvas.toBuffer('image/png');
    if (RENDER_CACHE.size >= MAX_RENDER_CACHE) {
        const oldestKey = RENDER_CACHE.keys().next().value;
        RENDER_CACHE.delete(oldestKey);
    }
    RENDER_CACHE.set(sig, buffer);
    return buffer;
}

/**
 * Menghasilkan AttachmentBuilder + URL 'attachment://avatar_<hash>.png' siap pakai untuk Discord Components V2.
 */
async function buildAvatarAttachment(equippedInput = null) {
    const norm = (equippedInput && equippedInput.body !== undefined)
        ? {
            body: equippedInput.body,
            hair: equippedInput.hair,
            hat: equippedInput.hat,
            top: equippedInput.top,
            bottom: equippedInput.bottom,
            shoes: equippedInput.shoes,
            accessory: equippedInput.accessory
        }
        : normalizeEquippedOutfit(equippedInput);

    const sig = buildOutfitSignature(norm);
    const shortHash = crypto.createHash('md5').update(sig).digest('hex').slice(0, 10);
    const fileName = `avatar_${shortHash}.png`;
    const buffer = await generateAvatarBuffer(norm);
    const attachment = new AttachmentBuilder(buffer, {
        name: fileName,
        description: 'Avatar Karakter Chibi'
    });

    return {
        buffer,
        fileName,
        url: `attachment://${fileName}`,
        attachment
    };
}

/**
 * Menghitung akumulasi buff pasif dari seluruh pakaian yang sedang dikenakan.
 */
function computeClothingBuffs(equippedInput = null) {
    const norm = (equippedInput && equippedInput.body !== undefined)
        ? equippedInput
        : normalizeEquippedOutfit(equippedInput);

    let workSalaryBonus = 0;
    const jobBonuses = {};
    let fishingXpBonus = 0;
    let farmingXpBonus = 0;
    let miningAccidentReduction = 0;
    const activeItems = [];

    for (const slot of CLOTHING_SLOTS) {
        const cid = norm[slot.id];
        if (!cid) continue;
        const item = getClothing(cid);
        if (!item || !item.buffs) continue;

        if (item.buffs.workSalaryBonus) {
            workSalaryBonus += Number(item.buffs.workSalaryBonus);
        }
        if (item.buffs.jobBonuses) {
            for (const [jId, val] of Object.entries(item.buffs.jobBonuses)) {
                jobBonuses[jId] = (jobBonuses[jId] || 0) + Number(val);
            }
        }
        if (item.buffs.fishingXpBonus) {
            fishingXpBonus += Number(item.buffs.fishingXpBonus);
        }
        if (item.buffs.farmingXpBonus) {
            farmingXpBonus += Number(item.buffs.farmingXpBonus);
        }
        if (item.buffs.miningAccidentReduction) {
            miningAccidentReduction += Number(item.buffs.miningAccidentReduction);
        }

        if (item.buffLabel) {
            activeItems.push({
                id: item.id,
                name: item.name,
                emoji: item.emoji,
                buffLabel: item.buffLabel
            });
        }
    }

    return {
        workSalaryBonus: Math.min(0.20, Number(workSalaryBonus.toFixed(4))),
        jobBonuses,
        fishingXpBonus: Math.min(0.25, Number(fishingXpBonus.toFixed(4))),
        farmingXpBonus: Math.min(0.25, Number(farmingXpBonus.toFixed(4))),
        miningAccidentReduction: Math.min(0.40, Number(miningAccidentReduction.toFixed(4))),
        activeItems
    };
}

function getJobClothingBonus(clothingBuffs, jobId) {
    if (!clothingBuffs) return 0;
    const general = Number(clothingBuffs.workSalaryBonus || 0);
    const specific = Number(clothingBuffs.jobBonuses?.[jobId] || 0);
    return Math.min(0.20, Number((general + specific).toFixed(4)));
}

function formatEquippedSummaryLines(equippedInput = null) {
    const norm = (equippedInput && equippedInput.body !== undefined)
        ? equippedInput
        : normalizeEquippedOutfit(equippedInput);

    const displaySlots = ['hat', 'hair', 'top', 'bottom', 'shoes', 'accessory'];
    const parts = [];
    for (const sId of displaySlots) {
        const c = getClothing(norm[sId]);
        if (c) {
            parts.push(`${c.emoji} ${c.name}`);
        }
    }
    if (parts.length === 0) {
        return '🧍 *Polos (Belum memakai pakaian)*';
    }
    return parts.join(' · ');
}

/**
 * Mengambil state kepemilikan pakaian & pakaian aktif pemain dari DB.
 */
async function getPlayerEquippedOutfit(conn, discordId, forUpdate = false) {
    const lockSql = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await conn.execute(
        `SELECT * FROM player_equipped_clothes WHERE discord_id = ?${lockSql}`,
        [discordId]
    );
    return normalizeEquippedOutfit(rows[0] || null);
}

async function getPlayerOwnedClothingIds(conn, discordId, forUpdate = false) {
    const lockSql = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await conn.execute(
        `SELECT clothing_id FROM player_clothes WHERE discord_id = ?${lockSql}`,
        [discordId]
    );
    const owned = new Set(STARTER_CLOTHING_IDS);
    for (const r of rows) {
        if (getClothing(r.clothing_id)) {
            owned.add(r.clothing_id);
        }
    }
    return owned;
}

async function getPlayerWardrobeState(conn, discordId, forUpdate = false) {
    const ownedSet = await getPlayerOwnedClothingIds(conn, discordId, forUpdate);
    const equipped = await getPlayerEquippedOutfit(conn, discordId, forUpdate);
    const buffs = computeClothingBuffs(equipped);

    return {
        ownedSet,
        ownedCount: ownedSet.size,
        totalCatalogCount: CLOTHES.length,
        equipped,
        buffs
    };
}

/**
 * Menambahkan pakaian ke lemari pemain (digunakan oleh /shop dan /gacha).
 */
async function grantClothing(conn, discordId, clothingId, autoEquipIfEmpty = true, now = Date.now()) {
    const clothing = getClothing(clothingId);
    if (!clothing) return { ok: false, error: 'INVALID_CLOTHING' };

    const ownedSet = await getPlayerOwnedClothingIds(conn, discordId, true);
    if (ownedSet.has(clothing.id)) {
        return { ok: false, error: 'ALREADY_OWNED', clothing };
    }

    await conn.execute(
        `INSERT INTO player_clothes (discord_id, clothing_id, acquired_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE acquired_at = VALUES(acquired_at)`,
        [discordId, clothing.id, now]
    );

    let autoEquipped = false;
    if (autoEquipIfEmpty && clothing.slot !== 'body' && clothing.slot !== 'hair') {
        const slotMeta = getClothingSlot(clothing.slot);
        const equipped = await getPlayerEquippedOutfit(conn, discordId, true);
        if (slotMeta && !equipped[clothing.slot]) {
            await conn.execute(
                `INSERT INTO player_equipped_clothes (discord_id, ${slotMeta.column}, updated_at)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE ${slotMeta.column} = VALUES(${slotMeta.column}), updated_at = VALUES(updated_at)`,
                [discordId, clothing.id, now]
            );
            autoEquipped = true;
        }
    }

    return {
        ok: true,
        clothing,
        autoEquipped
    };
}

/**
 * Memasang atau melepas pakaian pada slot tertentu di /wardrobe.
 */
async function setEquippedClothingSlot(conn, discordId, slotId, clothingIdOrNull, now = Date.now()) {
    const slotMeta = getClothingSlot(slotId);
    if (!slotMeta) {
        return { ok: false, error: 'INVALID_SLOT' };
    }

    if (!clothingIdOrNull) {
        if (!slotMeta.canUnequip) {
            return { ok: false, error: 'CANNOT_UNEQUIP_SLOT', slotMeta };
        }
        await conn.execute(
            `INSERT INTO player_equipped_clothes (discord_id, ${slotMeta.column}, updated_at)
             VALUES (?, NULL, ?)
             ON DUPLICATE KEY UPDATE ${slotMeta.column} = NULL, updated_at = VALUES(updated_at)`,
            [discordId, now]
        );
        const updated = await getPlayerEquippedOutfit(conn, discordId, false);
        return { ok: true, action: 'unequipped', slotMeta, clothing: null, equipped: updated };
    }

    const clothing = getClothing(clothingIdOrNull);
    if (!clothing || clothing.slot !== slotMeta.id) {
        return { ok: false, error: 'SLOT_MISMATCH', slotMeta };
    }

    const ownedSet = await getPlayerOwnedClothingIds(conn, discordId, true);
    if (!ownedSet.has(clothing.id)) {
        return { ok: false, error: 'NOT_OWNED', clothing, slotMeta };
    }

    await conn.execute(
        `INSERT INTO player_equipped_clothes (discord_id, ${slotMeta.column}, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE ${slotMeta.column} = VALUES(${slotMeta.column}), updated_at = VALUES(updated_at)`,
        [discordId, clothing.id, now]
    );

    const updated = await getPlayerEquippedOutfit(conn, discordId, false);
    return { ok: true, action: 'equipped', slotMeta, clothing, equipped: updated };
}

module.exports = {
    normalizeEquippedOutfit,
    buildOutfitSignature,
    generateAvatarBuffer,
    buildAvatarAttachment,
    clearAvatarCache,
    computeClothingBuffs,
    getJobClothingBonus,
    formatEquippedSummaryLines,
    getPlayerEquippedOutfit,
    getPlayerOwnedClothingIds,
    getPlayerWardrobeState,
    grantClothing,
    setEquippedClothingSlot
};
