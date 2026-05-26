const db = require('../botHandlers/mysqlHandler');
const cropsConfig = require('../config/crops.json');

class FarmManager {
    static async isTileValid(userId, x, y) {
        const rows = await db.query('SELECT width, height FROM user_farms WHERE user_id = ?', [userId]);
        if (!rows || rows.length === 0) return false;
        const farm = rows[0];
        return (x >= 0 && x < farm.width && y >= 0 && y < farm.height);
    }

    static async plantCrop(userId, x, y, cropId) {
        if (!cropsConfig[cropId]) throw new Error('Invalid crop ID.');
        if (!(await this.isTileValid(userId, x, y))) throw new Error(`Tile [${x + 1}, ${y + 1}] is outside your farm.`);

        const tile = await db.query('SELECT crop_id FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?', [userId, x, y]);
        if (tile && tile.length > 0 && tile[0].crop_id) throw new Error('This tile is already planted.');

        await db.query(
            'INSERT INTO farm_tiles (user_id, x, y, crop_id, growth, is_watered) VALUES (?, ?, ?, ?, 0, false) ON DUPLICATE KEY UPDATE crop_id = ?, growth = 0', 
            [userId, x, y, cropId, cropId]
        );
        return true;
    }

    // =====================================
    // 🌟 FITUR BARU: PLANT ALL
    // =====================================
    static async plantAll(userId, cropId) {
        if (!cropsConfig[cropId]) throw new Error('Invalid crop ID.');

        const trx = await db.startTransaction();
        try {
            const farmData = await trx.query('SELECT width, height FROM user_farms WHERE user_id = ? FOR UPDATE', [userId]);
            if (!farmData || farmData.length === 0) throw new Error('Farm data was not found.');
            const farm = farmData[0];

            // Ambil semua petak yang SUDAH ditanami
            const tiles = await trx.query('SELECT x, y FROM farm_tiles WHERE user_id = ? AND crop_id IS NOT NULL FOR UPDATE', [userId]);
            const plantedCoords = new Set(tiles.map(t => `${t.x},${t.y}`));
            
            let plantedCount = 0;

            // Cari petak kosong dan tanami
            for (let y = 0; y < farm.height; y++) {
                for (let x = 0; x < farm.width; x++) {
                    if (!plantedCoords.has(`${x},${y}`)) {
                        await trx.query(
                            'INSERT INTO farm_tiles (user_id, x, y, crop_id, growth, is_watered) VALUES (?, ?, ?, ?, 0, false) ON DUPLICATE KEY UPDATE crop_id = ?, growth = 0', 
                            [userId, x, y, cropId, cropId]
                        );
                        plantedCount++;
                    }
                }
            }

            if (plantedCount === 0) throw new Error('No empty farm tiles are available.');

            await trx.commit();
            return plantedCount;
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

            const storageData = await trx.query('SELECT SUM(amount) as total FROM user_storage WHERE user_id = ?', [userId]);
            const farmData = await trx.query('SELECT max_storage FROM user_farms WHERE user_id = ?', [userId]);
            
            const cropYield = cropsConfig[tile[0].crop_id].yield;
            const currentStorage = parseInt(storageData[0].total) || 0;
            const maxStorage = parseInt(farmData[0].max_storage) || 50;
            
            if ((currentStorage + cropYield) > maxStorage) {
                throw new Error(`Storage is full (${currentStorage}/${maxStorage}). Sell items before harvesting.`);
            }

            await trx.query('UPDATE farm_tiles SET crop_id = NULL, growth = 0, is_watered = false WHERE user_id = ? AND x = ? AND y = ?', [userId, x, y]);
            await trx.query('INSERT INTO user_storage (user_id, item_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?', [userId, tile[0].crop_id, cropYield, cropYield]);
            
            await trx.commit();
            return cropYield;
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }

    // =====================================
    // 🌟 FITUR BARU: HARVEST ALL
    // =====================================
    static async harvestAll(userId) {
        const trx = await db.startTransaction();
        try {
            // Ambil SEMUA tanaman yang sudah siap dipanen (growth >= 100)
            const readyTiles = await trx.query('SELECT x, y, crop_id FROM farm_tiles WHERE user_id = ? AND growth >= 100 FOR UPDATE', [userId]);
            if (!readyTiles || readyTiles.length === 0) throw new Error('No crops are ready to harvest.');

            const storageData = await trx.query('SELECT SUM(amount) as total FROM user_storage WHERE user_id = ? FOR UPDATE', [userId]);
            const farmData = await trx.query('SELECT max_storage FROM user_farms WHERE user_id = ? FOR UPDATE', [userId]);
            
            let currentStorage = parseInt(storageData[0]?.total) || 0;
            const maxStorage = parseInt(farmData[0]?.max_storage) || 50;

            let harvestSummary = {};
            let harvestedCount = 0;

            // Panen satu per satu, berhenti kalau storage kepenuhan
            for (const tile of readyTiles) {
                const yieldAmt = cropsConfig[tile.crop_id].yield;
                
                // Cek apakah dengan menambahkan panen ini, storage jadi luber?
                if ((currentStorage + yieldAmt) > maxStorage) {
                    break; // Keluar dari loop panen
                }

                // Proses panen petak ini
                await trx.query('UPDATE farm_tiles SET crop_id = NULL, growth = 0, is_watered = false WHERE user_id = ? AND x = ? AND y = ?', [userId, tile.x, tile.y]);
                await trx.query('INSERT INTO user_storage (user_id, item_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?', [userId, tile.crop_id, yieldAmt, yieldAmt]);
                
                currentStorage += yieldAmt;
                harvestSummary[tile.crop_id] = (harvestSummary[tile.crop_id] || 0) + yieldAmt;
                harvestedCount++;
            }

            await trx.commit();
            
            if (harvestedCount === 0) {
                throw new Error(`Storage is full (${currentStorage}/${maxStorage}). Nothing could be harvested.`);
            }

            return { 
                summary: harvestSummary, 
                count: harvestedCount, 
                isStorageFull: harvestedCount < readyTiles.length // True jika ada tanaman yang tersisa akibat storage penuh
            };
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }
}

module.exports = FarmManager;
