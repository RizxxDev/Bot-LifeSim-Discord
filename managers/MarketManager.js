const db = require('../botHandlers/mysqlHandler');
const ItemManager = require('./ItemManager');

class MarketManager {
    static async listToMarket(userId, itemId, amount, price) {
        if (!itemId) throw new Error('Item ID is required.');
        if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive integer.');
        if (!Number.isInteger(price) || price <= 0) throw new Error('Price must be a positive integer.');

        const LISTING_FEE = 50;
        const trx = await db.startTransaction();
        try {
            const user = await trx.query('SELECT cash FROM users WHERE user_id = ? FOR UPDATE', [userId]);
            if (!user[0] || user[0].cash < LISTING_FEE) throw new Error('Not enough cash to pay the listing fee (Lp 50).');

            const storage = await trx.query('SELECT amount FROM farm_storage WHERE user_id = ? AND item_id = ? FOR UPDATE', [userId, itemId]);
            if (!storage[0] || storage[0].amount < amount) throw new Error('Not enough items in farm storage.');

            await trx.query('UPDATE users SET cash = cash - ? WHERE user_id = ?', [LISTING_FEE, userId]);
            
            const remaining = Number(storage[0].amount) - amount;
            if (remaining <= 0) {
                await trx.query('DELETE FROM farm_storage WHERE user_id = ? AND item_id = ?', [userId, itemId]);
            } else {
                await trx.query('UPDATE farm_storage SET amount = ? WHERE user_id = ? AND item_id = ?', [remaining, userId, itemId]);
            }

            await trx.query('INSERT INTO market_listings (seller_id, item_id, amount, price) VALUES (?, ?, ?, ?)', [userId, itemId, amount, price]);

            await trx.commit();
            return true;
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }

    static async buyFromMarket(buyerId, listingId) {
        if (!Number.isInteger(listingId) || listingId <= 0) throw new Error('Listing ID must be a positive integer.');

        const MARKET_TAX = 0.05;
        const trx = await db.startTransaction();
        try {
            const listing = await trx.query('SELECT * FROM market_listings WHERE id = ? FOR UPDATE', [listingId]);
            if (!listing || listing.length === 0) throw new Error('This listing was sold or removed.');
            if (listing[0].seller_id === buyerId) throw new Error('You cannot buy your own listing.');

            const buyer = await trx.query('SELECT cash FROM users WHERE user_id = ? FOR UPDATE', [buyerId]);
            if (!buyer[0] || buyer[0].cash < listing[0].price) throw new Error('Not enough cash for this purchase.');
            await ItemManager.ensureStorageSpace(trx, buyerId, Number(listing[0].amount));

            const taxAmount = Math.floor(listing[0].price * MARKET_TAX);
            const sellerReceives = listing[0].price - taxAmount;

            await trx.query('UPDATE users SET cash = cash - ? WHERE user_id = ?', [listing[0].price, buyerId]); 
            await trx.query('UPDATE users SET cash = cash + ? WHERE user_id = ?', [sellerReceives, listing[0].seller_id]); 
            await trx.query('INSERT INTO farm_storage (user_id, item_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?', [buyerId, listing[0].item_id, listing[0].amount, listing[0].amount]); 
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
