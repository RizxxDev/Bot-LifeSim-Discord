const db = require('../botHandlers/mysqlHandler');
const ShopManager = require('./ShopManager');
const cropsConfig = require('../config/crops.json');

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
            for (const [cropId, crop] of Object.entries(cropsConfig)) {
                const normalGrowth = Math.max(1, Math.ceil(100 / Math.max(1, Number(crop.growTime_mins || 5))));
                const wateredGrowth = Math.min(100, normalGrowth * 2);
                await db.query(
                    'UPDATE farm_tiles SET growth = LEAST(100, growth + IF(is_watered = true, ?, ?)) WHERE crop_id = ? AND growth < 100',
                    [wateredGrowth, normalGrowth, cropId]
                );
            }
            await db.query('UPDATE farm_tiles SET is_watered = false WHERE is_watered = true');
        } catch (err) {
            console.error('[FARM LOOP ERROR]', err);
        }
    }
}

module.exports = GameLoop;
