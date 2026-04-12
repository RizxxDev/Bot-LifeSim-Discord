const fs = require('fs');
const path = require('path');

class EventHandler {
    constructor(client) {
        this.client = client;
        this.loadEvents();
    }

    loadEvents() {
        const eventsPath = __dirname;
        const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js') && file !== 'EventHandler.js');

        for (const file of eventFiles) {
            const event = require(`./${file}`);
            if (event.once) {
                this.client.once(event.name, (...args) => event.handle(...args, this.client));
            } else {
                this.client.on(event.name, (...args) => event.handle(...args, this.client));
            }
        }
        console.log(`✅ [SYSTEM] Loaded ${eventFiles.length} Events.`);
    }
}

module.exports = EventHandler;