const db = require('../botHandlers/mysqlHandler');
const shopConfig = require('../config/shop.json');
const ItemManager = require('./ItemManager');

class ShopManager {
    
    // 🧮 1. DYNAMIC PRICING ALGORITHM
    static calculatePrice(itemId, currentStock) {
        const item = shopConfig.items[itemId];
        if (!item) return 0;

        // Cegah pembagian dengan 0
        const stock = currentStock > 0 ? currentStock : 1;
        
        // Rumus: Base * (Target / Current)
        let rawPrice = item.base_price * (item.target_stock / stock);
        
        // Anti-Inflasi / Deflasi (Clamp ke min dan max)
        let finalPrice = Math.max(item.min_price, Math.min(item.max_price, rawPrice));
        
        return Math.floor(finalPrice);
    }

    static calculateTrade(itemId, currentStock, amount, mode) {
        const item = shopConfig.items[itemId];
        if (!item) return { unitPrice: 0, totalPrice: 0 };

        let totalPrice = 0;
        for (let i = 0; i < amount; i++) {
            const stockAfterStep = mode === 'buy'
                ? Math.max(1, currentStock - i)
                : currentStock + i;
            const marketPrice = this.calculatePrice(itemId, stockAfterStep);
            const unitPrice = mode === 'sell'
                ? Math.max(item.min_price, Math.floor(marketPrice * 0.85))
                : marketPrice;
            totalPrice += unitPrice;
        }

        return {
            unitPrice: Math.floor(totalPrice / amount),
            totalPrice
        };
    }

    // 🛍️ 2. PLAYER BELI DARI SHOP
    static async buyFromShop(userId, itemId, amount) {
        const itemConfig = shopConfig.items[itemId];
        if (!itemConfig) throw new Error('This item is not sold by the shop.');
        if (!Number.isInteger(amount) || amount < 1 || amount > 100) throw new Error('Buy amount must be between 1 and 100.');

        const trx = await db.startTransaction();
        try {
            // Cek Stok Shop
            const shopStock = await trx.query('SELECT amount FROM shop_inventory WHERE item_id = ? FOR UPDATE', [itemId]);
            const currentStock = shopStock[0]?.amount || 0;
            if (currentStock < amount) throw new Error(`Not enough shop stock. Remaining: ${currentStock}.`);

            const { unitPrice, totalPrice } = this.calculateTrade(itemId, currentStock, amount, 'buy');

            // Cek Uang Player & Storage Player
            const user = await trx.query('SELECT cash FROM users WHERE user_id = ? FOR UPDATE', [userId]);
            if (!user[0] || user[0].cash < totalPrice) throw new Error(`Not enough cash. Required: Lp ${totalPrice.toLocaleString('en-US')}.`);

            // Transaksi (Pindah Barang & Uang)
            await trx.query('UPDATE users SET cash = cash - ? WHERE user_id = ?', [totalPrice, userId]);
            await trx.query('UPDATE shop_global SET cash = cash + ? WHERE id = 1', [totalPrice]); // Uang masuk ke Shop
            
            await trx.query('UPDATE shop_inventory SET amount = amount - ? WHERE item_id = ?', [amount, itemId]);
            await ItemManager.addItem(trx, userId, itemId, amount);

            await trx.commit();
            return { unitPrice, totalPrice };
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }

    // 💸 3. PLAYER JUAL KE SHOP
    static async sellToShop(userId, itemId, amount) {
        const itemConfig = shopConfig.items[itemId];
        if (!itemConfig) throw new Error('The shop does not buy this item.');
        if (!Number.isInteger(amount) || amount < 1 || amount > 500) throw new Error('Sell amount must be between 1 and 500.');

        const trx = await db.startTransaction();
        try {
            const shopStock = await trx.query('SELECT amount FROM shop_inventory WHERE item_id = ? FOR UPDATE', [itemId]);
            const currentStock = shopStock[0]?.amount || 0;
            const { unitPrice, totalPrice } = this.calculateTrade(itemId, currentStock, amount, 'sell');

            // Cek Uang Shop (APAKAH SHOP PUNYA UANG UNTUK MEMBAYAR?)
            const shop = await trx.query('SELECT cash, max_storage FROM shop_global WHERE id = 1 FOR UPDATE');
            if (shop[0].cash < totalPrice) throw new Error('The shop does not have enough cash right now.');

            // Cek Kapasitas Storage Shop
            const totalItems = await trx.query('SELECT SUM(amount) as total FROM shop_inventory');
            if ((parseInt(totalItems[0].total, 10) + amount) > shop[0].max_storage) throw new Error('The shop storage is full right now.');

            // Transaksi (Pindah Barang & Uang)
            await trx.query('UPDATE shop_global SET cash = cash - ? WHERE id = 1', [totalPrice]); // Uang Shop berkurang
            await trx.query('UPDATE users SET cash = cash + ? WHERE user_id = ?', [totalPrice, userId]);
            
            await ItemManager.removeItem(trx, userId, itemId, amount);
            await trx.query('INSERT INTO shop_inventory (item_id, amount) VALUES (?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?', [itemId, amount, amount]);

            await trx.commit();
            return { unitPrice, totalPrice };
        } catch (err) {
            await trx.rollback();
            throw err;
        }
    }

    // ⚙️ 4. AI PRODUCTION LOOP (CONVERTER SYSTEM)
    // Dipanggil setiap menit oleh GameLoop.js
    static async processAiProduction() {
        try {
            // A. Proses Antrian yang sudah selesai
            const now = Date.now();
            const finishedQueues = await db.query('SELECT * FROM shop_queue WHERE end_time <= ?', [now]);
            
            for (const q of finishedQueues) {
                const recipe = shopConfig.recipes[q.recipe_id];
                const resultAmount = recipe.result * q.amount;
                // Masukkan hasil ke Gudang Shop
                await db.query('INSERT INTO shop_inventory (item_id, amount) VALUES (?, ?) ON DUPLICATE KEY UPDATE amount = amount + ?', [q.recipe_id, resultAmount, resultAmount]);
                await db.query('DELETE FROM shop_queue WHERE id = ?', [q.id]);
            }

            // B. AI Decision: Haruskah produksi barang baru?
            for (const [productId, recipe] of Object.entries(shopConfig.recipes)) {
                const stock = await db.query('SELECT amount FROM shop_inventory WHERE item_id = ?', [productId]);
                const currentStock = stock[0]?.amount || 0;
                const targetStock = shopConfig.items[productId].target_stock;

                // Jika stok produk kurang dari target, AI mencoba membuat (Craft)
                if (currentStock < targetStock) {
                    let canCraft = true;
                    // Cek apakah bahan mentah tersedia di Gudang Shop
                    for (const [ingredient, qtyRequired] of Object.entries(recipe.ingredients)) {
                        const ingStock = await db.query('SELECT amount FROM shop_inventory WHERE item_id = ?', [ingredient]);
                        if (!ingStock[0] || ingStock[0].amount < (qtyRequired * Math.min(10, recipe.max_queue))) canCraft = false;
                    }

                    if (canCraft) {
                        // AI membuat batch produksi (misal: 10 item sekaligus)
                        const craftAmount = Math.min(10, recipe.max_queue); 
                        
                        // Potong bahan dari Gudang
                        for (const [ingredient, qtyRequired] of Object.entries(recipe.ingredients)) {
                            await db.query('UPDATE shop_inventory SET amount = amount - ? WHERE item_id = ?', [(qtyRequired * craftAmount), ingredient]);
                        }
                        
                        // Masukkan ke antrian produksi
                        const finishTime = now + (recipe.time_mins * 60 * 1000);
                        await db.query('INSERT INTO shop_queue (recipe_id, amount, end_time) VALUES (?, ?, ?)', [productId, craftAmount, finishTime]);
                    }
                }
            }
        } catch (err) {
            console.error('[SHOP AI ERROR]', err);
        }
    }
}

module.exports = ShopManager;
