const db = require('../botHandlers/mysqlHandler');

class GameLoop {
    constructor() {
        this.tickRate = 60 * 1000; // 1 menit sekali
    }

    start() {
        setInterval(async () => {
            await this.processGrowth();
        }, this.tickRate);
        console.log("🌱 [FARM LOOP] System Started.");
    }

    async processGrowth() {
        try {
            // Tambah growth, 2x lebih cepat jika disiram
            await db.query(`
                UPDATE farm_tiles 
                SET growth = LEAST(100, growth + IF(is_watered = true, 10, 5))
                WHERE crop_id IS NOT NULL AND growth < 100
            `);
            // Keringkan tanah setelah proses growth
            await db.query(`UPDATE farm_tiles SET is_watered = false WHERE crop_id IS NOT NULL`);
        } catch (err) {
            console.error("[FARM LOOP ERROR]", err);
        }
    }
}
module.exports = GameLoop;