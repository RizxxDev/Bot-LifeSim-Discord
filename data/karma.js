const MAX_DAILY_KARMA_EARN = 50;

const KARMA_TIERS = [
    {
        id: 'warga_biasa',
        minKarma: 0,
        name: 'Warga Biasa',
        emoji: '🌱',
        hospitalDiscountRate: 0,
        creditRateReduction: 0
    },
    {
        id: 'warga_peduli',
        minKarma: 25,
        name: 'Warga Peduli',
        emoji: '🤝',
        hospitalDiscountRate: 0.05,
        creditRateReduction: 0.005
    },
    {
        id: 'dermawan_kota',
        minKarma: 100,
        name: 'Dermawan Kota',
        emoji: '💖',
        hospitalDiscountRate: 0.10,
        creditRateReduction: 0.010
    },
    {
        id: 'filantropis_teladan',
        minKarma: 250,
        name: 'Filantropis Teladan',
        emoji: '🕊️',
        hospitalDiscountRate: 0.15,
        creditRateReduction: 0.015
    },
    {
        id: 'pahlawan_sosial',
        minKarma: 500,
        name: 'Pahlawan Sosial',
        emoji: '👑',
        hospitalDiscountRate: 0.20,
        creditRateReduction: 0.020
    }
];

function getKarmaPerks(karmaPoints = 0) {
    const pts = Math.max(0, Math.floor(Number(karmaPoints || 0)));
    let currentTier = KARMA_TIERS[0];
    for (const tier of KARMA_TIERS) {
        if (pts >= tier.minKarma) {
            currentTier = tier;
        }
    }
    const nextTier = KARMA_TIERS.find(t => t.minKarma > currentTier.minKarma) || null;
    return {
        karmaPoints: pts,
        tierId: currentTier.id,
        tierName: currentTier.name,
        tierEmoji: currentTier.emoji,
        hospitalDiscountRate: Math.min(0.20, currentTier.hospitalDiscountRate),
        creditRateReduction: Math.min(0.02, currentTier.creditRateReduction),
        nextTier
    };
}

module.exports = {
    MAX_DAILY_KARMA_EARN,
    KARMA_TIERS,
    getKarmaPerks
};
