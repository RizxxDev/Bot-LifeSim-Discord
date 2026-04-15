const db = require('../botHandlers/mysqlHandler');

class MarketManager {
    static async listToMarket(userId, itemId, amount, price) {
        const LISTING_FEE = 50;
        const trx = await db.startTransaction();
        try {
            const user = await trx.query('SELECT cash FROM users WHERE user_id = ? FOR UPDATE', [userId]);
            if (!user[0] || user[0].cash < LISTING_FEE) throw new Error("Uang tidak cukup untuk membayar Listing Fee (Lp 50).");

            const storage = await trx.query('SELECT amount FROM user_storage WHERE user_id = ? AND item_id = ? FOR UPDATE', [userId, itemId]);
            if (!storage[0] || storage[0].amount < amount) throw new Error("Item di storage tidak cukup!");

            await trx.query('UPDATE users SET cash = cash - ? WHERE user_id = ?', [LISTING_FEE, userId]);
            await trx.query('UPDATE user_storage SET amount = amount - ? WHERE user_id = ? AND item_id = ?', [amount, userId, itemId]);
            await trx.query('INSERT INTO market_listings (seller_id, item_id, amount, price) VALUES (?, ?, ?, ?)', [userId, itemId, amount, price]);

            await trx.commit();
            return true;
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }

    static async buyFromMarket(buyerId, listingId) {
        const MARKET_TAX = 0.05;
        const trx = await db.startTransaction();
        try {
            const listing = await trx.query('SELECT * FROM market_listings WHERE id = ? FOR UPDATE', [listingId]);
            if (!listing || listing.length === 0) throw new Error("Barang ini sudah terjual atau ditarik.");
            if (listing[0].seller_id === buyerId) throw new Error("Tidak bisa membeli barangmu sendiri!");

            const buyer = await trx.query('SELECT cash FROM users WHERE user_id = ? FOR UPDATE', [buyerId]);
            if (!buyer[0] || buyer[0].cash < listing[0].price) throw new Error("Uangmu tidak cukup!");

            const taxAmount = Math.floor(listing[0].price * MARKET_TAX);
            const sellerReceives = listing[0].price - taxAmount;

            await trx.query('UPDATE users SET cash = cash - ? WHERE user_id = ?', [listing[0].price, buyerId]); 
            await trx.query('UPDATE users SET cash = cash + ? WHERE user_id = ?', [sellerReceives, listing[0].seller_id]); 
            await trx.query('INSERT INTO user_storage (user_id, item_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?', [buyerId, listing[0].item_id, listing[0].amount, listing[0].amount]); 
            await trx.query('DELETE FROM market_listings WHERE id = ?', [listingId]);

            await trx.commit();
            return true;
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }
}
module.exports = MarketManager;