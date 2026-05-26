const db = require('../botHandlers/mysqlHandler');
const ShopManager = require('./ShopManager');

class GameLoop {
    constructor() {
        this.tickRate = 60 * 1000;
        this.interval = null;
        this.isRunning = false;
    }

    start() {
        if (this.interval) {
            console.log('[FARM & SHOP AI LOOP] Already running.');
            return;
        }

        this.interval = setInterval(async () => {
            if (this.isRunning) return;

            this.isRunning = true;
            try {
                await this.processGrowth();
                await ShopManager.processAiProduction();
            } finally {
                this.isRunning = false;
            }
        }, this.tickRate);

        console.log('[FARM & SHOP AI LOOP] System started.');
    }

    async processGrowth() {
        try {
            await db.query(`
                UPDATE farm_tiles
                SET growth = LEAST(100, growth + IF(is_watered = true, 10, 5))
                WHERE crop_id IS NOT NULL AND growth < 100
            `);
            await db.query('UPDATE farm_tiles SET is_watered = false WHERE crop_id IS NOT NULL');
        } catch (err) {
            console.error('[FARM LOOP ERROR]', err);
        }
    }
}

module.exports = GameLoop;
