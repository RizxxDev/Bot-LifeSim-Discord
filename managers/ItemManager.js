const shopConfig = require('../config/shop.json');

const INVENTORY_TYPES = new Set(['tool', 'seed', 'consumable', 'fish', 'ore', 'junk']);

class ItemManager {
    static getConfig(itemId) {
        return shopConfig.items[itemId] || null;
    }

    static getName(itemId) {
        return this.getConfig(itemId)?.name || itemId;
    }

    static getType(itemId) {
        return this.getConfig(itemId)?.type || 'product';
    }

    static getContainer(itemId) {
        return INVENTORY_TYPES.has(this.getType(itemId)) ? 'user_inventory' : 'farm_storage';
    }

    static async getStorageUsage(dbOrTrx, userId) {
        const rows = await dbOrTrx.query('SELECT SUM(amount) AS total FROM farm_storage WHERE user_id = ?', [userId]);
        return Number(rows[0]?.total || 0);
    }

    static async getStorageCapacity(dbOrTrx, userId) {
        const rows = await dbOrTrx.query('SELECT max_storage FROM farm_profiles WHERE user_id = ?', [userId]);
        return Number(rows[0]?.max_storage || 50);
    }

    static async ensureStorageSpace(dbOrTrx, userId, amountToAdd) {
        const current = await this.getStorageUsage(dbOrTrx, userId);
        const capacity = await this.getStorageCapacity(dbOrTrx, userId);
        if (current + amountToAdd > capacity) {
            throw new Error(`Storage is full (${current}/${capacity}). Free up space first.`);
        }
    }

    static async getAmount(dbOrTrx, userId, itemId) {
        const table = this.getContainer(itemId);
        const rows = await dbOrTrx.query(`SELECT amount FROM ${table} WHERE user_id = ? AND item_id = ?`, [userId, itemId]);
        return Number(rows[0]?.amount || 0);
    }

    static async addItem(dbOrTrx, userId, itemId, amount) {
        if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer.');

        const container = this.getContainer(itemId);
        if (container === 'farm_storage') {
            await this.ensureStorageSpace(dbOrTrx, userId, amount);
            await dbOrTrx.query(
                'INSERT INTO farm_storage (user_id, item_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?',
                [userId, itemId, amount, amount]
            );
            return;
        }

        await dbOrTrx.query(
            'INSERT INTO user_inventory (user_id, item_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?',
            [userId, itemId, amount, amount]
        );
    }

    static async removeItem(dbOrTrx, userId, itemId, amount) {
        if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer.');

        const table = this.getContainer(itemId);
        const rows = await dbOrTrx.query(`SELECT amount FROM ${table} WHERE user_id = ? AND item_id = ? FOR UPDATE`, [userId, itemId]);
        if (!rows[0] || Number(rows[0].amount) < amount) {
            throw new Error(`Not enough ${this.getName(itemId)}.`);
        }

        const remaining = Number(rows[0].amount) - amount;
        if (remaining <= 0) {
            // Housekeeping: Hapus baris dengan saldo 0 untuk mencegah dead data
            await dbOrTrx.query(`DELETE FROM ${table} WHERE user_id = ? AND item_id = ?`, [userId, itemId]);
        } else {
            await dbOrTrx.query(`UPDATE ${table} SET amount = ? WHERE user_id = ? AND item_id = ?`, [remaining, userId, itemId]);
        }
    }
}

module.exports = ItemManager;
