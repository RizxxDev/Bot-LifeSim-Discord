const db = require('../botHandlers/mysqlHandler');
const cropsConfig = require('../config/crops.json');
const ItemManager = require('./ItemManager');

class FarmManager {
    static async isTileValid(userId, x, y) {
        const rows = await db.query('SELECT width, height FROM farm_profiles WHERE user_id = ?', [userId]);
        if (!rows || rows.length === 0) return false;
        const farm = rows[0];
        return (x >= 0 && x < farm.width && y >= 0 && y < farm.height);
    }

    static async plantCrop(userId, x, y, cropId) {
        if (!cropsConfig[cropId]) throw new Error('Invalid crop ID.');
        if (!(await this.isTileValid(userId, x, y))) throw new Error(`Tile [${x + 1}, ${y + 1}] is outside your farm.`);

        const trx = await db.startTransaction();
        try {
            const seedItem = cropsConfig[cropId].seed_item || `${cropId}_seed`;
            const tile = await trx.query('SELECT crop_id FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ? FOR UPDATE', [userId, x, y]);
            if (tile && tile.length > 0 && tile[0].crop_id) throw new Error('This tile is already planted.');

            await ItemManager.removeItem(trx, userId, seedItem, 1);
            await trx.query(
                'INSERT INTO farm_tiles (user_id, x, y, crop_id, growth, is_watered) VALUES (?, ?, ?, ?, 0, false) ON DUPLICATE KEY UPDATE crop_id = ?, growth = 0, is_watered = false',
                [userId, x, y, cropId, cropId]
            );
            await trx.commit();
            return true;
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }

    // =====================================
    // 🌟 PLANT ALL (BATCH MULTI-ROW QUERY)
    // =====================================
    static async plantAll(userId, cropId) {
        if (!cropsConfig[cropId]) throw new Error('Invalid crop ID.');

        const trx = await db.startTransaction();
        try {
            const farmData = await trx.query('SELECT width, height FROM farm_profiles WHERE user_id = ? FOR UPDATE', [userId]);
            if (!farmData || farmData.length === 0) throw new Error('Farm data was not found.');
            const farm = farmData[0];
            const seedItem = cropsConfig[cropId].seed_item || `${cropId}_seed`;
            const seedsAvailable = await ItemManager.getAmount(trx, userId, seedItem);
            if (seedsAvailable <= 0) throw new Error(`You need ${ItemManager.getName(seedItem)} before planting.`);

            const tiles = await trx.query('SELECT x, y FROM farm_tiles WHERE user_id = ? AND crop_id IS NOT NULL FOR UPDATE', [userId]);
            const plantedCoords = new Set(tiles.map(t => `${t.x},${t.y}`));

            const toPlant = [];
            for (let y = 0; y < farm.height; y++) {
                for (let x = 0; x < farm.width; x++) {
                    if (toPlant.length >= seedsAvailable) break;
                    if (!plantedCoords.has(`${x},${y}`)) {
                        toPlant.push({ x, y });
                    }
                }
                if (toPlant.length >= seedsAvailable) break;
            }

            if (toPlant.length === 0) throw new Error('No empty farm tiles are available.');

            // Batch Multi-Row Insert
            const placeholders = [];
            const values = [];
            for (const t of toPlant) {
                placeholders.push('(?, ?, ?, ?, 0, false)');
                values.push(userId, t.x, t.y, cropId);
            }

            await trx.query(
                `INSERT INTO farm_tiles (user_id, x, y, crop_id, growth, is_watered) 
                 VALUES ${placeholders.join(', ')} 
                 ON DUPLICATE KEY UPDATE crop_id = VALUES(crop_id), growth = 0, is_watered = false`,
                values
            );

            await ItemManager.removeItem(trx, userId, seedItem, toPlant.length);
            await trx.commit();
            return toPlant.length;
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }

    static async harvestCrop(userId, x, y) {
        const trx = await db.startTransaction();
        try {
            const tile = await trx.query('SELECT crop_id, growth FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ? FOR UPDATE', [userId, x, y]);
            
            if (!tile || tile.length === 0 || !tile[0].crop_id) throw new Error('No crop is planted on this tile.');
            if (tile[0].growth < 100) throw new Error(`This crop is not ready yet. Growth: ${tile[0].growth}%.`);

            const storageData = await trx.query('SELECT SUM(amount) as total FROM farm_storage WHERE user_id = ?', [userId]);
            const farmData = await trx.query('SELECT max_storage FROM farm_profiles WHERE user_id = ?', [userId]);
            
            const cropYield = cropsConfig[tile[0].crop_id]?.yield || 1;
            const currentStorage = parseInt(storageData[0]?.total, 10) || 0;
            const maxStorage = parseInt(farmData[0]?.max_storage, 10) || 50;
            
            if ((currentStorage + cropYield) > maxStorage) {
                throw new Error(`Storage is full (${currentStorage}/${maxStorage}). Sell items before harvesting.`);
            }

            await trx.query('UPDATE farm_tiles SET crop_id = NULL, growth = 0, is_watered = false WHERE user_id = ? AND x = ? AND y = ?', [userId, x, y]);
            await trx.query('INSERT INTO farm_storage (user_id, item_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?', [userId, tile[0].crop_id, cropYield, cropYield]);
            
            await trx.commit();
            return cropYield;
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }

    static async waterCrop(userId, x, y) {
        const tile = await db.query('SELECT crop_id, growth, is_watered FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?', [userId, x, y]);
        if (!tile || tile.length === 0 || !tile[0].crop_id) throw new Error('No crop is planted on this tile.');
        if (tile[0].growth >= 100) throw new Error('This crop is already ready to harvest.');
        if (tile[0].is_watered) throw new Error('This crop is already watered for the current growth tick.');

        await db.query('UPDATE farm_tiles SET is_watered = true WHERE user_id = ? AND x = ? AND y = ?', [userId, x, y]);
        return true;
    }

    static async waterAll(userId) {
        const result = await db.query('UPDATE farm_tiles SET is_watered = true WHERE user_id = ? AND crop_id IS NOT NULL AND growth < 100 AND is_watered = false', [userId]);
        return Number(result.affectedRows || 0);
    }

    // =====================================
    // 🌟 HARVEST ALL (BATCH MULTI-ROW QUERIES)
    // =====================================
    static async harvestAll(userId) {
        const trx = await db.startTransaction();
        try {
            // Ambil SEMUA tanaman yang sudah siap dipanen (growth >= 100)
            const readyTiles = await trx.query('SELECT id, x, y, crop_id FROM farm_tiles WHERE user_id = ? AND growth >= 100 FOR UPDATE', [userId]);
            if (!readyTiles || readyTiles.length === 0) throw new Error('No crops are ready to harvest.');

            const storageData = await trx.query('SELECT SUM(amount) as total FROM farm_storage WHERE user_id = ? FOR UPDATE', [userId]);
            const farmData = await trx.query('SELECT max_storage FROM farm_profiles WHERE user_id = ? FOR UPDATE', [userId]);
            
            let currentStorage = parseInt(storageData[0]?.total, 10) || 0;
            const maxStorage = parseInt(farmData[0]?.max_storage, 10) || 50;

            const harvestSummary = {};
            const harvestedIds = [];

            // Evaluasi in-memory petak mana saja yang muat di storage
            for (const tile of readyTiles) {
                const yieldAmt = cropsConfig[tile.crop_id]?.yield || 1;
                
                if ((currentStorage + yieldAmt) > maxStorage) {
                    break; // Berhenti jika kapasitas storage sudah mentok
                }

                currentStorage += yieldAmt;
                harvestSummary[tile.crop_id] = (harvestSummary[tile.crop_id] || 0) + yieldAmt;
                harvestedIds.push(tile.id);
            }

            if (harvestedIds.length === 0) {
                throw new Error(`Storage is full (${currentStorage}/${maxStorage}). Nothing could be harvested.`);
            }

            // 1. Batch Reset Petak yang Dipanen
            if (harvestedIds.length === readyTiles.length) {
                await trx.query('UPDATE farm_tiles SET crop_id = NULL, growth = 0, is_watered = false WHERE user_id = ? AND growth >= 100', [userId]);
            } else {
                await trx.query('UPDATE farm_tiles SET crop_id = NULL, growth = 0, is_watered = false WHERE id IN (?)', [harvestedIds]);
            }

            // 2. Batch Multi-Row Upsert ke farm_storage
            const storagePlaceholders = [];
            const storageValues = [];
            for (const [cropId, amount] of Object.entries(harvestSummary)) {
                storagePlaceholders.push('(?, ?, ?)');
                storageValues.push(userId, cropId, amount);
            }

            await trx.query(
                `INSERT INTO farm_storage (user_id, item_id, amount) 
                 VALUES ${storagePlaceholders.join(', ')} 
                 ON DUPLICATE KEY UPDATE amount = amount + VALUES(amount)`,
                storageValues
            );

            await trx.commit();

            return { 
                summary: harvestSummary, 
                count: harvestedIds.length, 
                isStorageFull: harvestedIds.length < readyTiles.length 
            };
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }
}

module.exports = FarmManager;
