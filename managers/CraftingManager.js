const db = require('../botHandlers/mysqlHandler');
const recipes = require('../config/recipes.json');
const ItemManager = require('./ItemManager');

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
            for (const [ingredient, qty] of Object.entries(recipe.ingredients)) {
                const totalNeeded = qty * amount;
                await ItemManager.removeItem(trx, userId, ingredient, totalNeeded);
            }

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
            const resultItem = recipe.result_item || q.recipe_id;
            const totalResult = recipe.result * q.amount;

            await trx.query('DELETE FROM crafting_queue WHERE id = ?', [queueId]);
            await ItemManager.addItem(trx, userId, resultItem, totalResult);

            await trx.commit();
            return { itemName: recipe.name, amount: totalResult, emoji: recipe.emoji };
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }
}

module.exports = CraftingManager;
