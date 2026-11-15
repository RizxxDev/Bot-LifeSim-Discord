const { getCityZoning } = require('./cities');

/**
 * Definisi Ukuran Kavling Terbatas Kota (S, M, L, XL) beserta mapping alias ke tier lama.
 */
const PARCEL_SIZE_TIERS = [
    {
        code: 'S',
        legacyId: 'standar_4x4',
        tierId: 'standar_4x4',
        order: 1,
        label: 'Kavling S (4×4)',
        name: 'Kavling S (4×4)',
        shortName: 'S (4×4)',
        emoji: '🟩',
        width: 4,
        height: 4,
        totalCells: 16,
        priceMult: 1.0,
        permitFee: 1500000,
        description: 'Kavling ringkas 16 petak (tapak 4×4) — bebas bangun bertingkat ke atas.'
    },
    {
        code: 'M',
        legacyId: 'luas_6x6',
        tierId: 'luas_6x6',
        order: 2,
        label: 'Kavling M (6×6)',
        name: 'Kavling M (6×6)',
        shortName: 'M (6×6)',
        emoji: '🟦',
        width: 6,
        height: 6,
        totalCells: 36,
        priceMult: 2.2,
        permitFee: 4500000,
        description: 'Kavling menengah 36 petak (tapak 6×6) untuk villa berhalaman, kos, atau ruko.'
    },
    {
        code: 'L',
        legacyId: 'estate_8x8',
        tierId: 'estate_8x8',
        order: 3,
        label: 'Kavling L (8×8)',
        name: 'Kavling L (8×8)',
        shortName: 'L (8×8)',
        emoji: '🟪',
        width: 8,
        height: 8,
        totalCells: 64,
        priceMult: 4.0,
        permitFee: 10000000,
        description: 'Kavling besar 64 petak (tapak 8×8) untuk menara kembar, kafe, atau kompleks.'
    },
    {
        code: 'XL',
        legacyId: 'mega_10x10',
        tierId: 'mega_10x10',
        order: 4,
        label: 'Kavling XL (10×10)',
        name: 'Kavling XL (10×10)',
        shortName: 'XL (10×10)',
        emoji: '🟨',
        width: 10,
        height: 10,
        totalCells: 100,
        priceMult: 6.8,
        permitFee: 22000000,
        description: 'Kavling perdana super-luas 100 petak (tapak 10×10) untuk markas & distrik ikon kota.'
    }
];

const LEGACY_MINI_TIER = {
    code: 'XS',
    legacyId: 'mini_3x3',
    tierId: 'mini_3x3',
    order: 0,
    label: 'Kavling Mini (3×3)',
    name: 'Kavling Mini (3×3)',
    shortName: '3×3 Mini',
    emoji: '🟦',
    width: 3,
    height: 3,
    totalCells: 9,
    priceMult: 0.55,
    permitFee: 500000,
    description: 'Kavling pemula 3×3 dari sistem lama.'
};

const PARCEL_LOOKUP = new Map();
for (const t of [...PARCEL_SIZE_TIERS, LEGACY_MINI_TIER]) {
    PARCEL_LOOKUP.set(t.code.toLowerCase(), t);
    PARCEL_LOOKUP.set(t.legacyId.toLowerCase(), t);
}

const CITY_PARCEL_PREFIX = {
    kota_barat: 'KB',
    kota_sentral: 'KS',
    kota_timur: 'KT'
};

// 12 kavling terbatas per distrik di setiap kota: 5x S, 4x M, 2x L, 1x XL
const DISTRICT_PARCEL_TEMPLATE = [
    { slotNo: 1, sizeTier: 'S' },
    { slotNo: 2, sizeTier: 'S' },
    { slotNo: 3, sizeTier: 'S' },
    { slotNo: 4, sizeTier: 'S' },
    { slotNo: 5, sizeTier: 'S' },
    { slotNo: 6, sizeTier: 'M' },
    { slotNo: 7, sizeTier: 'M' },
    { slotNo: 8, sizeTier: 'M' },
    { slotNo: 9, sizeTier: 'M' },
    { slotNo: 10, sizeTier: 'L' },
    { slotNo: 11, sizeTier: 'L' },
    { slotNo: 12, sizeTier: 'XL' }
];

const AUTO_EXPAND_OCCUPANCY_RATIO = 0.85;
const MAX_DISTRICTS_PER_CITY = 5;

function getParcelSizeTier(tierOrCode) {
    const key = String(tierOrCode || 'S').toLowerCase();
    return PARCEL_LOOKUP.get(key) || PARCEL_SIZE_TIERS[0];
}

function calculateFiniteParcelBasePrice(cityId, tierOrCode) {
    const tier = getParcelSizeTier(tierOrCode);
    const zoning = getCityZoning(cityId);
    return Math.round(Number(zoning.landBasePrice || 15000000) * tier.priceMult + tier.permitFee);
}

function generateDistrictParcelSpecs(cityId = 'kota_sentral', districtNo = 1) {
    const prefix = CITY_PARCEL_PREFIX[cityId] || 'KS';
    const dNo = Math.max(1, Math.floor(Number(districtNo || 1)));
    return DISTRICT_PARCEL_TEMPLATE.map(slot => {
        const tier = getParcelSizeTier(slot.sizeTier);
        const slotStr = String(slot.slotNo).padStart(2, '0');
        const parcelCode = `${prefix}-D${dNo}-${slotStr}`;
        const basePrice = calculateFiniteParcelBasePrice(cityId, tier.code);
        return {
            parcelCode,
            parcel_code: parcelCode,
            cityId,
            city_id: cityId,
            districtNo: dNo,
            district_no: dNo,
            slotNo: slot.slotNo,
            lotNo: slot.slotNo,
            lot_no: slot.slotNo,
            sizeTier: tier.code,
            size_tier: tier.code,
            width: tier.width,
            height: tier.height,
            basePrice,
            base_price: basePrice
        };
    });
}

module.exports = {
    PARCEL_SIZE_TIERS,
    CITY_PARCEL_PREFIX,
    DISTRICT_PARCEL_TEMPLATE,
    AUTO_EXPAND_OCCUPANCY_RATIO,
    MAX_DISTRICTS_PER_CITY,
    getParcelSizeTier,
    calculateFiniteParcelBasePrice,
    generateDistrictParcelSpecs
};
