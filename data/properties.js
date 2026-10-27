const PROPERTIES = [
    {
        id: 'tunawisma',
        order: 0,
        name: 'Tunawisma (Tanpa Hunian)',
        emoji: '⛺',
        canRent: false,
        canBuy: false,
        canCredit: false,
        rentPerWeek: 0,
        buyPrice: 0,
        pbbRateMonthly: 0,
        sleepEnergyBonus: 50,
        sleepDurationSec: 3600,
        passiveEnergyRegenBonus: 0,
        facilities: {
            kulkas: 0,
            freezer: 0,
            stove: 0,
            gudang: 0
        },
        description: 'Tidur di ruang terbuka kota (+50 Energy / 60m). Tidak memiliki akses Dapur, Kulkas, Freezer, atau Gudang.'
    },
    {
        id: 'kos',
        order: 1,
        name: 'Kamar Kos Sederhana',
        emoji: '🛏️',
        canRent: true,
        canBuy: false,
        canCredit: false,
        rentPerWeek: 70000,
        buyPrice: 0,
        pbbRateMonthly: 0,
        sleepEnergyBonus: 60,
        sleepDurationSec: 3600,
        passiveEnergyRegenBonus: 0,
        facilities: {
            kulkas: 15,
            freezer: 0,
            stove: 1,
            gudang: 0
        },
        description: 'Kamar kos ekonomis dengan 1 tungku dapur dan Kulkas 15 slot (Tidur +60 Energy).'
    },
    {
        id: 'kontrakan',
        order: 2,
        name: 'Kontrakan Petak',
        emoji: '🏘️',
        canRent: true,
        canBuy: false,
        canCredit: false,
        rentPerWeek: 175000,
        buyPrice: 0,
        pbbRateMonthly: 0,
        sleepEnergyBonus: 70,
        sleepDurationSec: 3600,
        passiveEnergyRegenBonus: 0,
        facilities: {
            kulkas: 25,
            freezer: 10,
            stove: 1,
            gudang: 20
        },
        description: 'Kontrakan nyaman dengan Kulkas 25 slot, Freezer 10 slot, 1 tungku, dan Gudang 20 slot (Tidur +70 Energy).'
    },
    {
        id: 'rumah',
        order: 3,
        name: 'Rumah Pribadi',
        emoji: '🏠',
        canRent: true,
        canBuy: true,
        canCredit: true,
        rentPerWeek: 450000,
        buyPrice: 75000000,
        pbbRateMonthly: 0.002,
        sleepEnergyBonus: 80,
        sleepDurationSec: 3600,
        passiveEnergyRegenBonus: 2,
        facilities: {
            kulkas: 40,
            freezer: 30,
            stove: 2,
            gudang: 50
        },
        description: 'Hunian keluarga dengan 2 tungku dapur, Kulkas 40, Freezer 30, Gudang 50, Tidur +80 Energy, & Regen +2/jam.'
    },
    {
        id: 'rumah_mewah',
        order: 4,
        name: 'Rumah Mewah (Mansion)',
        emoji: '🏰',
        canRent: false,
        canBuy: true,
        canCredit: true,
        rentPerWeek: 0,
        buyPrice: 600000000,
        pbbRateMonthly: 0.002,
        sleepEnergyBonus: 100,
        sleepDurationSec: 2700,
        passiveEnergyRegenBonus: 4,
        facilities: {
            kulkas: 60,
            freezer: 60,
            stove: 3,
            gudang: 100
        },
        description: 'Mansion elit dengan 3 tungku dapur, Kulkas 60, Freezer 60, Gudang 100, Tidur 45 menit (+100 Energy), & Regen +4/jam.'
    }
];

const PROPERTY_MAP = new Map(PROPERTIES.map(p => [p.id, p]));

function getPropertyTier(id) {
    return PROPERTY_MAP.get(String(id || 'tunawisma').toLowerCase()) || PROPERTIES[0];
}

function getAllPropertyTiers() {
    return PROPERTIES.filter(p => p.id !== 'tunawisma');
}

function calculateMonthlyPbb(propertyTierObj) {
    if (!propertyTierObj || !propertyTierObj.buyPrice || !propertyTierObj.pbbRateMonthly) return 0;
    return Math.round(propertyTierObj.buyPrice * propertyTierObj.pbbRateMonthly);
}

module.exports = {
    PROPERTIES,
    getPropertyTier,
    getAllPropertyTiers,
    calculateMonthlyPbb
};
