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
        if (!cropsConfig[cropId]) throw new Error("Benih tidak valid! (Cek kembali nama benihnya)");
        if (!(await this.isTileValid(userId, x, y))) throw new Error(`Koordinat [${x + 1}, ${y + 1}] berada di luar area ladangmu!`);

        const tile = await db.query('SELECT crop_id FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ?', [userId, x, y]);
        if (tile && tile.length > 0 && tile[0].crop_id) throw new Error("Petak tanah ini sudah ditanami!");

        await db.query(
            'INSERT INTO farm_tiles (user_id, x, y, crop_id, growth, is_watered) VALUES (?, ?, ?, ?, 0, false) ON DUPLICATE KEY UPDATE crop_id = ?, growth = 0', 
            [userId, x, y, cropId, cropId]
        );
        return true;
    }

    static async harvestCrop(userId, x, y) {
        const trx = await db.startTransaction();
        try {
            const tile = await trx.query('SELECT crop_id, growth FROM farm_tiles WHERE user_id = ? AND x = ? AND y = ? FOR UPDATE', [userId, x, y]);
            
            if (!tile || tile.length === 0 || !tile[0].crop_id) {
                throw new Error("Tidak ada tanaman di koordinat ini!");
            }

            if (tile[0].growth < 100) {
                throw new Error(`Tanaman belum siap panen! (Pertumbuhan masih ${tile[0].growth}%)`);
            }

            const storageData = await trx.query('SELECT SUM(amount) as total FROM user_storage WHERE user_id = ?', [userId]);
            const farmData = await trx.query('SELECT max_storage FROM user_farms WHERE user_id = ?', [userId]);
            
            const cropYield = cropsConfig[tile[0].crop_id].yield;
            
            // 🌟 PERBAIKAN: Gunakan parseInt() agar dibaca sebagai angka matematika, bukan teks!
            const currentStorage = parseInt(storageData[0].total) || 0;
            const maxStorage = parseInt(farmData[0].max_storage) || 50;
            
            if ((currentStorage + cropYield) > maxStorage) {
                throw new Error(`Storage penuh! (${currentStorage}/${maxStorage}). Jual barangmu di market.`);
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
}

module.exports = FarmManager;