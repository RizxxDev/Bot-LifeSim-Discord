const db = require('../botHandlers/mysqlHandler');
const recipes = require('../config/recipes.json');

class CraftingManager {
    // Mengambil daftar resep
    static getRecipes() {
        return recipes;
    }

    // Melihat antrian milik seorang pemain
    static async getQueue(userId) {
        return await db.query('SELECT * FROM crafting_queue WHERE user_id = ? ORDER BY end_time ASC', [userId]);
    }

    // Memulai proses pembuatan
    static async startCrafting(userId, recipeId, amount = 1) {
        const recipe = recipes[recipeId];
        if (!recipe) throw new Error('Recipe not found.');
        if (!Number.isInteger(amount) || amount < 1 || amount > 100) throw new Error('Craft amount must be between 1 and 100.');

        const trx = await db.startTransaction();
        try {
            // 1. Cek & Potong Bahan Baku dari Storage
            for (const [ingredient, qty] of Object.entries(recipe.ingredients)) {
                const totalNeeded = qty * amount;
                const storage = await trx.query('SELECT amount FROM user_storage WHERE user_id = ? AND item_id = ? FOR UPDATE', [userId, ingredient]);

                if (!storage || storage.length === 0 || storage[0].amount < totalNeeded) {
                    throw new Error(`Missing ingredients. Required: ${totalNeeded}x ${ingredient}.`);
                }

                await trx.query('UPDATE user_storage SET amount = amount - ? WHERE user_id = ? AND item_id = ?', [totalNeeded, userId, ingredient]);
            }

            // 2. Kalkulasi Waktu & Masukkan ke Antrian
            const now = Date.now();
            const finishTime = now + (recipe.time_mins * 60 * 1000 * amount); // Waktu * Jumlah barang

            await trx.query(
                'INSERT INTO crafting_queue (user_id, recipe_id, amount, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
                [userId, recipeId, amount, now, finishTime]
            );

            await trx.commit();
            return finishTime;
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }

    // Mengklaim (mengambil) barang yang sudah selesai dibuat
    static async claimCrafting(userId, queueId) {
        if (!Number.isInteger(queueId) || queueId <= 0) throw new Error('Queue ID must be a positive integer.');

        const trx = await db.startTransaction();
        try {
            const queue = await trx.query('SELECT * FROM crafting_queue WHERE id = ? AND user_id = ? FOR UPDATE', [queueId, userId]);
            if (!queue || queue.length === 0) throw new Error('Queue entry not found or not owned by you.');

            const q = queue[0];
            if (Date.now() < q.end_time) throw new Error('This crafting job is not finished yet.');

            const recipe = recipes[q.recipe_id];
            const totalResult = recipe.result * q.amount;

            // 3. Hapus dari Antrian & Masukkan hasil ke Storage
            await trx.query('DELETE FROM crafting_queue WHERE id = ?', [queueId]);
            await trx.query('INSERT INTO user_storage (user_id, item_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?', [userId, q.recipe_id, totalResult, totalResult]);

            await trx.commit();
            return { itemName: recipe.name, amount: totalResult, emoji: recipe.emoji };
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }
}

module.exports = CraftingManager;
