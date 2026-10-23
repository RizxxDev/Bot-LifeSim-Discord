const BACKPACK_TIERS = [
    {
        tier: 0,
        id: 'tas_kecil',
        name: 'Tas Kecil',
        emoji: '🎒',
        slots: 20,
        price: 0,
        description: 'Tas standar warga baru. Cukup untuk membawa bekal dan alat dasar.'
    },
    {
        tier: 1,
        id: 'tas_ransel',
        name: 'Tas Ransel',
        emoji: '🎒',
        slots: 35,
        price: 150000,
        description: 'Ransel tebal dengan banyak kantong untuk memancing dan menambang lebih lama.'
    },
    {
        tier: 2,
        id: 'tas_gunung',
        name: 'Tas Gunung (Carrier)',
        emoji: '🏕️',
        slots: 55,
        price: 600000,
        description: 'Carrier kapasitas besar untuk ekspedisi tambang dan danau.'
    },
    {
        tier: 3,
        id: 'koper_ekspedisi',
        name: 'Koper Ekspedisi',
        emoji: '🧳',
        slots: 85,
        price: 2500000,
        description: 'Penyimpanan kelas profesional dengan kompartemen terpisah.'
    },
    {
        tier: 4,
        id: 'gudang_pribadi',
        name: 'Gudang Pribadi Mini',
        emoji: '📦',
        slots: 130,
        price: 10000000,
        description: 'Kapasitas logistik maksimal untuk kolektor dan pekerja senior.'
    }
];

function getBackpackByTier(tier) {
    return BACKPACK_TIERS.find(b => b.tier === Number(tier)) || BACKPACK_TIERS[0];
}

function getNextBackpackTier(currentTier) {
    return BACKPACK_TIERS.find(b => b.tier === Number(currentTier) + 1) || null;
}

module.exports = {
    BACKPACK_TIERS,
    getBackpackByTier,
    getNextBackpackTier
};
