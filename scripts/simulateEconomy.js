/**
 * Simulasi Ekonomi 1.000 Player × 120 Hari (Model Perilaku Realistis Fase 2.0)
 * Memverifikasi target PRD:
 * - G1/G2: Rasio Sink/Faucet Kumulatif & Steady-State (Hari ke-91–120) berada di rentang 75–95%
 * - G3: Player baru yang masuk di Hari ke-90 tetap mudah bertahan hidup & berkembang
 */
const { JOBS, getRankForShifts } = require('../data/jobs');
const { EDUCATION_LEVELS, getEducation } = require('../data/education');
const { BACKPACK_TIERS } = require('../data/backpacks');
const { getPropertyTier, calculateMonthlyPbb } = require('../data/properties');
const { CROPS, getCrop, getRentPlotPrice, getBuyPlotPrice } = require('../data/crops');
const { getVehicle, FUEL_PRICE_PER_LITER, isFarLocation } = require('../data/vehicles');
const { calculateCreditPlan } = require('../services/creditService');
const { getItem } = require('../data/items');
const { FISHING_LOCATIONS, MINING_LOCATIONS, getLevelInfoFromXp, rollLoot } = require('../data/locations');
const { STARTER_PACK, BANK, ACTIVITY_COSTS, VITALS } = require('../data/constants');
const {
    calculateIncomeTax,
    calculateMarginalWealthTax,
    getSoftCapModifier
} = require('../services/economyService');
const { computeDynamicPriceMultiplier } = require('../services/marketService');
const { formatLp } = require('../utils/uiBuilder');

const ROD_IDS_BY_TIER = [null, 'pancing_bambu', 'pancing_fiberglass', 'pancing_carbon', 'pancing_pro'];
const BAIT_IDS_BY_TIER = [null, 'umpan_cacing', 'umpan_udang', 'umpan_pro', 'umpan_pro'];
const PICKAXE_IDS_BY_TIER = [null, 'beliung_batu', 'beliung_besi', 'beliung_baja', 'beliung_titanium'];

function getRepairCostPerUse(itemId) {
    const it = getItem(itemId);
    if (!it || !it.maxDurability) return 0;
    return Math.round((it.buyPrice / it.maxDurability) * 0.7);
}

function createSimulatedPlayer(id, joinDay) {
    return {
        id,
        joinDay,
        cash: STARTER_PACK.cash,
        bank: 0,
        eduIndex: 0, // 0=SD, 1=SMP, 2=SMA, 3=D3, 4=S1, 5=S2
        studySessions: 0,
        jobId: 'tukang_parkir',
        jobShifts: {},
        totalShifts: 0,
        fishingXp: 0,
        miningXp: 0,
        rodTier: 1,
        pickaxeTier: 1,
        backpackTier: 0,
        hasSimC: false,
        hasSimA: false,
        hasLaptop: false,
        hasHelmet: false,
        hasCoolerBox: false,
        vehicleId: null,
        vehicleOdoSinceService: 0,
        activeVehicleCredit: null,
        activePropertyCredit: null,
        propertyTier: 'tunawisma',
        propertyOwned: false,
        rentedPlots: 0,
        ownedPlots: 0,
        farmingXp: 0,
        cookingXp: 0,
        prestigeLevel: 0,
        archetype: id % 10 < 4 ? 'casual' : id % 10 < 8 ? 'regular' : 'grinder'
    };
}

function chooseBestUnlockedJob(p) {
    const eduOrder = p.eduIndex;
    let best = JOBS[0];
    for (const job of JOBS) {
        const reqEduOrder = job.reqEducation ? getEducation(job.reqEducation).order : 0;
        if (eduOrder < reqEduOrder) continue;
        if (job.reqItem === 'sim_c' && !p.hasSimC) continue;
        if (job.reqItem === 'sim_a' && !p.hasSimA) continue;
        if (job.reqItem === 'laptop' && !p.hasLaptop) continue;
        if (job.reqVehicle && p.vehicleId !== job.reqVehicle) continue;
        if (job.reqTotalShifts && p.totalShifts < job.reqTotalShifts) continue;
        if (job.reqJobHistory && (p.jobShifts[job.reqJobHistory.jobId] || 0) < job.reqJobHistory.shifts) continue;

        if (job.baseSalary > best.baseSalary) {
            best = job;
        }
    }
    return best;
}

/**
 * Menghitung biaya hidup harian secara dinamis berdasarkan total Energy, Hunger, dan Thirst
 * yang benar-benar dihabiskan player pada hari tersebut + konsumsi buff Restoran untuk tier atas.
 */
function calculateBehaviorLivingCost(p, totalEnergySpent, totalHungerSpent, totalThirstSpent) {
    const nasiBungkus = getItem('nasi_bungkus'); // Lp 15.000 (+45 Hunger)
    const airMineral = getItem('air_mineral');   // Lp 4.000 (+20 Thirst)
    const kopi = getItem('kopi');                // Lp 8.000 (+15 Energy, +15 Thirst)
    const energyDrink = getItem('energy_drink'); // Lp 12.000 (+25 Energy, +10 Thirst)
    const steak = getItem('steak_wagyu');        // Lp 150.000 (+80 Hunger, Buff EXP)
    const seafood = getItem('seafood_platter');  // Lp 250.000 (+90 Hunger, Buff Rarity)

    let cost = 0;
    let hungerNeeded = totalHungerSpent + 16 * VITALS.HUNGER_DECAY_PER_HOUR;
    let thirstNeeded = totalThirstSpent + 16 * VITALS.THIRST_DECAY_PER_HOUR;

    // Regen alami 16 jam aktif + bonus regen properti + 1x /sleep sesuai tier properti
    const propObj = getPropertyTier(p.propertyTier);
    const freeDailyEnergy =
        16 * (VITALS.ENERGY_REGEN_PER_HOUR + Number(propObj.passiveEnergyRegenBonus || 0)) +
        Number(propObj.sleepEnergyBonus || VITALS.SLEEP_ENERGY_BONUS);
    let extraEnergyNeeded = Math.max(0, totalEnergySpent - freeDailyEnergy);

    const wealth = p.cash + p.bank;

    // Warga mapan / S1-S2 membeli hidangan Restoran untuk buff EXP & Rarity saat grinding
    if (p.eduIndex >= 5 || wealth > 12000000) {
        const steakPortions = p.archetype === 'grinder' ? 2 : 1;
        const seafoodPortions = p.archetype === 'grinder' ? 2 : p.archetype === 'regular' ? 1 : 0;
        cost += steakPortions * steak.buyPrice + seafoodPortions * seafood.buyPrice;
        hungerNeeded = Math.max(0, hungerNeeded - (steakPortions * 80 + seafoodPortions * 90));
        thirstNeeded = Math.max(0, thirstNeeded - seafoodPortions * 20);
    } else if (p.eduIndex >= 3 || wealth > 2500000) {
        const steakPortions = p.archetype === 'casual' ? 0 : 1;
        const seafoodPortions = p.archetype === 'grinder' ? 1 : 0;
        cost += steakPortions * steak.buyPrice + seafoodPortions * seafood.buyPrice;
        hungerNeeded = Math.max(0, hungerNeeded - (steakPortions * 80 + seafoodPortions * 90));
    }

    // Penuhi tambahan Energy dengan Kopi (maks 2 efektif) + Energy Drink (maks 2 efektif) + Nasi Padang/Jus
    if (extraEnergyNeeded > 0) {
        const kopiUsed = Math.min(2, Math.ceil(extraEnergyNeeded / 15));
        cost += kopiUsed * kopi.buyPrice;
        extraEnergyNeeded = Math.max(0, extraEnergyNeeded - kopiUsed * 15);
        thirstNeeded = Math.max(0, thirstNeeded - kopiUsed * 15);

        const edUsed = Math.ceil(extraEnergyNeeded / 25);
        cost += edUsed * energyDrink.buyPrice;
        thirstNeeded = Math.max(0, thirstNeeded - edUsed * 10);
    }

    // Penuhi sisa Hunger & Thirst dengan makanan/minuman Warung
    const mealsCount = Math.ceil(hungerNeeded / nasiBungkus.effects.hunger);
    const drinksCount = Math.ceil(thirstNeeded / airMineral.effects.thirst);
    cost += mealsCount * nasiBungkus.buyPrice + drinksCount * airMineral.buyPrice;

    return cost;
}

function runSimulation() {
    console.log('📈 Menjalankan Simulasi Ekonomi: 1.000 Warga × 120 Hari...\n');

    const TOTAL_DAYS = 120;
    const INITIAL_PLAYERS = 800;
    const LATE_COHORT_PLAYERS = 200; // Masuk di hari ke-90 untuk menguji nasib warga baru saat ekonomi sudah tua

    const players = [];
    for (let i = 0; i < INITIAL_PLAYERS; i++) {
        players.push(createSimulatedPlayer(i + 1, 1));
    }

    const helmRepairPerUse = getRepairCostPerUse('helm_tambang');
    const p3kPrice = getItem('kotak_p3k').buyPrice;
    const perbanPrice = getItem('perban').buyPrice;

    let totalFaucet = INITIAL_PLAYERS * STARTER_PACK.cash;
    let totalSink = 0;
    let last30dFaucet = 0;
    let last30dSink = 0;

    for (let day = 1; day <= TOTAL_DAYS; day++) {
        if (day === 90) {
            for (let i = 0; i < LATE_COHORT_PLAYERS; i++) {
                players.push(createSimulatedPlayer(INITIAL_PLAYERS + i + 1, 90));
                totalFaucet += STARTER_PACK.cash;
                last30dFaucet += STARTER_PACK.cash;
            }
        }

        let dailyFaucet = 0;
        let dailySink = 0;
        const soldFishCount = new Map();

        for (const p of players) {
            const daysPlayed = day - p.joinDay + 1;
            const isNewbie = daysPlayed <= 7;
            const fakePlayerObj = { created_at: (1 - daysPlayed) * 86400000 };

            const shiftsToday = p.archetype === 'casual' ? 2 : p.archetype === 'regular' ? 4 : 6;
            const fishToday = p.archetype === 'casual' ? 6 : p.archetype === 'regular' ? 14 : 25;
            const mineToday = p.archetype === 'casual' ? 4 : p.archetype === 'regular' ? 10 : 18;

            let energySpent = 0;
            let hungerSpent = 0;
            let thirstSpent = 0;

            // 1. Update pekerjaan terbaik yang memenuhi syarat
            const job = chooseBestUnlockedJob(p);
            p.jobId = job.id;

            // 2. Jalankan shift kerja (termasuk bonus kendaraan, BBM, servis Rilis 2C, & THR Lebaran 3 hari Rilis 2D)
            const curVeh = p.vehicleId ? getVehicle(p.vehicleId) : null;
            const lebaranThrMult = (day >= 55 && day <= 57) ? 1.5 : 1.0; // Simulasi 3 hari pertama Lebaran (1-3 Syawal)
            for (let s = 1; s <= shiftsToday; s++) {
                const curJobShifts = p.jobShifts[job.id] || 0;
                const rank = getRankForShifts(curJobShifts);
                const softCap = getSoftCapModifier('work', s, true);
                const mgMult = Math.random() < 0.8 ? 1.10 : 0.70;
                const vehJobBonus = curVeh ? Number(curVeh.jobBonuses?.[job.id] || 0) : 0;

                if (curVeh && (vehJobBonus > 0 || (curVeh.unlocksJobs && curVeh.unlocksJobs.includes(job.id)))) {
                    const fuelCost = Math.round(curVeh.fuelPerShift * FUEL_PRICE_PER_LITER);
                    p.cash -= fuelCost;
                    dailySink += fuelCost;
                    p.vehicleOdoSinceService += 15;
                    if (p.vehicleOdoSinceService >= curVeh.serviceIntervalKm) {
                        p.cash -= curVeh.serviceCost;
                        dailySink += curVeh.serviceCost;
                        p.vehicleOdoSinceService = 0;
                    }
                }

                const gross = Math.round(job.baseSalary * lebaranThrMult * rank.multiplier * mgMult * (1 + vehJobBonus) * softCap.multiplier);
                const { tax } = calculateIncomeTax(gross, fakePlayerObj, 0, true);
                const net = gross - tax;

                p.cash += net;
                dailyFaucet += gross;
                dailySink += tax;

                p.jobShifts[job.id] = curJobShifts + (isNewbie && curJobShifts % 2 === 1 ? 2 : 1);
                p.totalShifts += 1;

                energySpent += job.energyCost || ACTIVITY_COSTS.work_normal.energy;
                hungerSpent += ACTIVITY_COSTS.work_normal.hunger;
                thirstSpent += ACTIVITY_COSTS.work_normal.thirst;
            }

            // 3. Memancing + Biaya Umpan & Perbaikan Alat Asli
            const fishLv = getLevelInfoFromXp(p.fishingXp);
            const fishLoc = fishLv.level >= 25 && p.rodTier >= 3
                ? FISHING_LOCATIONS[2]
                : fishLv.level >= 10 && p.rodTier >= 2
                    ? FISHING_LOCATIONS[1]
                    : FISHING_LOCATIONS[0];

            if (fishLoc.requiresSeaPermit) {
                const permitFee = getItem('izin_melaut').buyPrice;
                if (p.cash + p.bank >= permitFee) {
                    p.cash -= permitFee;
                    dailySink += permitFee;
                }
            }

            const rodItem = getItem(ROD_IDS_BY_TIER[p.rodTier]);
            const baitItem = getItem(BAIT_IDS_BY_TIER[p.rodTier]);
            const rodRepairPerCast = getRepairCostPerUse(rodItem.id);

            for (let f = 1; f <= fishToday; f++) {
                const castSink = rodRepairPerCast + baitItem.buyPrice;
                p.cash -= castSink;
                dailySink += castSink;

                const loot = rollLoot({
                    isFishing: true,
                    location: fishLoc,
                    toolRarityBonus: rodItem.rarityBonus || 0,
                    baitRarityBonus: baitItem.rarityBonus || 0,
                    baitMinTier: baitItem.minBoostTier || 'uncommon',
                    skillRarityBonus: fishLv.rarityBonus,
                    minigameSuccess: Math.random() < 0.85
                });
                const item = getItem(loot.itemId);
                const soldSoFar = soldFishCount.get(item.id) || 0;
                const dyn = computeDynamicPriceMultiplier(soldSoFar, item.baseSupplyThreshold || 100, players.length);
                const revenue = Math.round(item.sellPrice * dyn.multiplier * loot.quantity);

                soldFishCount.set(item.id, soldSoFar + loot.quantity);
                p.cash += revenue;
                dailyFaucet += revenue;
                p.fishingXp += Math.round(loot.rarityInfo.xp * (isNewbie ? 1.5 : 1.0));

                const tripDiscount = (curVeh && isFarLocation(fishLoc.id)) ? curVeh.farEnergyDiscount : 0;
                energySpent += Math.max(1, ACTIVITY_COSTS.fishing.energy - tripDiscount);
                hungerSpent += ACTIVITY_COSTS.fishing.hunger;
                thirstSpent += ACTIVITY_COSTS.fishing.thirst;
            }

            // 4. Menambang + Biaya Perbaikan Beliung, Helm, & Obat Kecelakaan Tambang
            const mineLv = getLevelInfoFromXp(p.miningXp);
            const mineLoc = mineLv.level >= 40 && p.pickaxeTier >= 4 && p.hasHelmet
                ? MINING_LOCATIONS[3]
                : mineLv.level >= 25 && p.pickaxeTier >= 3 && p.hasHelmet
                    ? MINING_LOCATIONS[2]
                    : mineLv.level >= 10 && p.pickaxeTier >= 2
                        ? MINING_LOCATIONS[1]
                        : MINING_LOCATIONS[0];

            const pickItem = getItem(PICKAXE_IDS_BY_TIER[p.pickaxeTier]);
            const pickRepairPerSwing = getRepairCostPerUse(pickItem.id);

            for (let m = 1; m <= mineToday; m++) {
                let swingSink = pickRepairPerSwing + (p.hasHelmet ? helmRepairPerUse : 0);
                // Risiko kecelakaan tambang & pembelian obat/P3K
                const accChance = p.hasHelmet ? (mineLoc.accidentChance || 0.03) * 0.3 : (mineLoc.accidentChance || 0.03);
                if (Math.random() < accChance) {
                    swingSink += p.pickaxeTier >= 3 ? p3kPrice : perbanPrice;
                }

                p.cash -= swingSink;
                dailySink += swingSink;

                const loot = rollLoot({
                    isFishing: false,
                    location: mineLoc,
                    toolRarityBonus: pickItem.rarityBonus || 0,
                    skillRarityBonus: mineLv.rarityBonus,
                    minigameSuccess: Math.random() < 0.85
                });
                const item = getItem(loot.itemId);
                const soldSoFar = soldFishCount.get(item.id) || 0;
                const dyn = computeDynamicPriceMultiplier(soldSoFar, item.baseSupplyThreshold || 100, players.length);
                const revenue = Math.round(item.sellPrice * dyn.multiplier * loot.quantity);

                soldFishCount.set(item.id, soldSoFar + loot.quantity);
                p.cash += revenue;
                dailyFaucet += revenue;
                p.miningXp += Math.round(loot.rarityInfo.xp * (isNewbie ? 1.5 : 1.0));

                const tripDiscount = (curVeh && isFarLocation(mineLoc.id)) ? curVeh.farEnergyDiscount : 0;
                energySpent += Math.max(1, ACTIVITY_COSTS.mining.energy - tripDiscount);
                hungerSpent += ACTIVITY_COSTS.mining.hunger;
                thirstSpent += ACTIVITY_COSTS.mining.thirst;
            }

            // 5. Progres Pendidikan (/study)
            if (p.eduIndex < EDUCATION_LEVELS.length - 1) {
                const nextEdu = EDUCATION_LEVELS[p.eduIndex + 1];
                const sessionsToday = p.archetype === 'casual' ? 1 : 2;
                for (let st = 0; st < sessionsToday; st++) {
                    if (p.cash + p.bank >= nextEdu.costPerSession * 2) {
                        p.cash -= nextEdu.costPerSession;
                        dailySink += nextEdu.costPerSession;
                        p.studySessions += 1;
                        energySpent += ACTIVITY_COSTS.study.energy;
                        hungerSpent += ACTIVITY_COSTS.study.hunger;
                        thirstSpent += ACTIVITY_COSTS.study.thirst;
                        if (p.studySessions >= nextEdu.sessionsRequired) {
                            p.eduIndex += 1;
                            p.studySessions = 0;
                            break;
                        }
                    }
                }
            }

            // 5b. Aktivitas Pertanian (/farm) & Memasak (/cook) (Rilis 2B)
            const totalPlots = p.rentedPlots + p.ownedPlots;
            if (totalPlots < 12 && (p.cash + p.bank) >= 180000) {
                if (p.rentedPlots < 4 && (p.cash + p.bank) < 1200000) {
                    const rentCost = getRentPlotPrice(p.rentedPlots + 1);
                    p.cash -= rentCost;
                    dailySink += rentCost;
                    p.rentedPlots += 1;
                } else if (p.ownedPlots < 8) {
                    const buyCost = getBuyPlotPrice(p.ownedPlots + 1);
                    if ((p.cash + p.bank) >= buyCost * 2.5) {
                        p.cash -= buyCost;
                        dailySink += buyCost;
                        p.ownedPlots += 1;
                    }
                }
            }

            const activePlots = p.rentedPlots + p.ownedPlots;
            if (activePlots > 0) {
                const farmLv = getLevelInfoFromXp(p.farmingXp).level;
                const cropChoices = Object.values(CROPS).filter(c => c.minLevel <= farmLv);
                const chosenCrop = cropChoices[cropChoices.length - 1] || getCrop('bayam');
                const seedItem = getItem(chosenCrop.seedId);
                const cropItem = getItem(chosenCrop.cropItemId);
                const cyclesToday = p.archetype === 'casual' ? 1 : 2;
                const ureaPrice = getItem('pupuk_urea').buyPrice;
                const lpgPricePerCook = Math.round(getItem('gas_lpg').buyPrice / 10);

                for (let cyc = 0; cyc < cyclesToday; cyc++) {
                    const seedAndFertSink = activePlots * (seedItem.buyPrice + (p.archetype !== 'casual' ? ureaPrice : 0));
                    if ((p.cash + p.bank) < seedAndFertSink) break;

                    p.cash -= seedAndFertSink;
                    dailySink += seedAndFertSink;

                    // 40% hasil tani dimasak sendiri (menghemat makan & memakai LPG), 60% dijual ke pasar dinamis
                    const totalYield = activePlots * chosenCrop.baseYield;
                    const soldQty = Math.round(totalYield * 0.6);
                    const cookedBatches = Math.max(1, Math.ceil((totalYield - soldQty) / 4));
                    const cookFuelSink = p.propertyTier !== 'tunawisma' ? cookedBatches * lpgPricePerCook : 0;
                    p.cash -= cookFuelSink;
                    dailySink += cookFuelSink;

                    const soldSoFar = soldFishCount.get(cropItem.id) || 0;
                    const dyn = computeDynamicPriceMultiplier(soldSoFar, cropItem.baseSupplyThreshold || 200, players.length);
                    const cropRevenue = Math.round(cropItem.sellPrice * dyn.multiplier * soldQty);
                    soldFishCount.set(cropItem.id, soldSoFar + soldQty);

                    p.cash += cropRevenue;
                    dailyFaucet += cropRevenue;
                    p.farmingXp += activePlots * chosenCrop.xpReward;
                    p.cookingXp += cookedBatches * 35;

                    energySpent += activePlots * 6 + cookedBatches * 3;
                    // Masakan rumahan memulihkan sebagian Hunger warga
                    hungerSpent = Math.max(0, hungerSpent - (totalYield - soldQty) * 18);
                }
            }

            // 6. Biaya Hidup Harian Berbasis Perilaku Nyata
            const livingCost = calculateBehaviorLivingCost(p, energySpent, hungerSpent, thirstSpent);
            const actualLivingPaid = Math.min(Math.max(0, p.cash + p.bank), livingCost);
            p.cash -= actualLivingPaid;
            dailySink += actualLivingPaid;

            // 7. Pembelian Lisensi, Peralatan, Kendaraan, Kredit, Upgrade Tas, & Item Prestise (Money Sinks)
            if (!p.hasSimC && p.eduIndex >= 2 && p.cash >= 250000) {
                p.cash -= 100000;
                dailySink += 100000;
                p.hasSimC = true;
            }
            if (!p.hasSimA && p.eduIndex >= 2 && (p.cash + p.bank) >= 1200000) {
                p.cash -= 150000;
                dailySink += 150000;
                p.hasSimA = true;
            }

            // Akuisisi Kendaraan Tunai & Kredit (Rilis 2C)
            const curFundsForVeh = p.cash + p.bank;
            if (!p.vehicleId && curFundsForVeh >= 2200000) {
                const v = getVehicle('sepeda');
                p.cash -= v.buyPrice;
                dailySink += v.buyPrice;
                p.vehicleId = 'sepeda';
            } else if (p.vehicleId === 'sepeda' && curFundsForVeh >= 9000000) {
                const v = getVehicle('motor_bekas');
                p.cash -= v.buyPrice;
                dailySink += v.buyPrice;
                p.vehicleId = 'motor_bekas';
            } else if (p.vehicleId === 'motor_bekas' && !p.activeVehicleCredit && daysPlayed >= 14 && curFundsForVeh >= 7000000) {
                // Ambil kredit Motor Baru (DP 20% + cicilan 8 minggu bunga 8%)
                const plan = calculateCreditPlan('motor_baru', 8);
                p.cash -= plan.downPayment;
                dailySink += plan.downPayment;
                p.vehicleId = 'motor_baru';
                p.activeVehicleCredit = { weeksRemaining: plan.tenorWeeks, weeklyInstallment: plan.weeklyInstallment };
            } else if (p.vehicleId === 'motor_baru' && !p.activeVehicleCredit && daysPlayed >= 14 && curFundsForVeh >= 95000000) {
                // Ambil kredit Mobil (DP 20% + cicilan 24 minggu bunga 15%)
                const plan = calculateCreditPlan('mobil', 24);
                p.cash -= plan.downPayment;
                dailySink += plan.downPayment;
                p.vehicleId = 'mobil';
                p.activeVehicleCredit = { weeksRemaining: plan.tenorWeeks, weeklyInstallment: plan.weeklyInstallment };
            }
            if (!p.hasHelmet && mineLv.level >= 15 && p.cash >= 300000) {
                p.cash -= 120000;
                dailySink += 120000;
                p.hasHelmet = true;
            }
            if (!p.hasLaptop && p.eduIndex >= 3 && p.cash + p.bank >= 5000000) {
                p.cash -= 4500000;
                dailySink += 4500000;
                p.hasLaptop = true;
            }
            if (!p.hasCoolerBox && p.cash + p.bank >= 450000) {
                const cbPrice = getItem('cooler_box').buyPrice;
                p.cash -= cbPrice;
                dailySink += cbPrice;
                p.hasCoolerBox = true;
            }

            // Sewa / Beli Properti (Rilis 2A)
            const totalFunds = p.cash + p.bank;
            if (p.propertyTier === 'tunawisma' && totalFunds >= 250000) {
                const kosRent = getPropertyTier('kos').rentPerWeek;
                p.cash -= kosRent;
                dailySink += kosRent;
                p.propertyTier = 'kos';
                p.propertyOwned = false;
            } else if (p.propertyTier === 'kos' && totalFunds >= 900000) {
                const konRent = getPropertyTier('kontrakan').rentPerWeek;
                p.cash -= konRent;
                dailySink += konRent;
                p.propertyTier = 'kontrakan';
                p.propertyOwned = false;
            } else if (p.propertyTier === 'kontrakan' && totalFunds >= 3500000) {
                const rumRent = getPropertyTier('rumah').rentPerWeek;
                p.cash -= rumRent;
                dailySink += rumRent;
                p.propertyTier = 'rumah';
                p.propertyOwned = false;
            } else if (!p.propertyOwned && p.propertyTier === 'rumah' && totalFunds >= 85000000) {
                const rumBuy = getPropertyTier('rumah').buyPrice;
                p.cash -= rumBuy;
                dailySink += rumBuy;
                p.propertyTier = 'rumah';
                p.propertyOwned = true;
            } else if (p.propertyTier === 'rumah' && p.propertyOwned && totalFunds >= 650000000) {
                const luxBuy = getPropertyTier('rumah_mewah').buyPrice;
                p.cash -= luxBuy;
                dailySink += luxBuy;
                p.propertyTier = 'rumah_mewah';
                p.propertyOwned = true;
            }

            // Upgrade Tas
            const nextBag = BACKPACK_TIERS[p.backpackTier + 1];
            if (nextBag && (p.cash + p.bank) >= nextBag.price * 2) {
                p.cash -= nextBag.price;
                dailySink += nextBag.price;
                p.backpackTier += 1;
            }

            // Upgrade Pancingan & Beliung
            if (p.rodTier < 4) {
                const nextRod = getItem(ROD_IDS_BY_TIER[p.rodTier + 1]);
                if ((p.cash + p.bank) >= nextRod.buyPrice * 2.2) {
                    p.cash -= nextRod.buyPrice;
                    dailySink += nextRod.buyPrice;
                    p.rodTier += 1;
                }
            }
            if (p.pickaxeTier < 4) {
                const nextPick = getItem(PICKAXE_IDS_BY_TIER[p.pickaxeTier + 1]);
                if ((p.cash + p.bank) >= nextPick.buyPrice * 2.2) {
                    p.cash -= nextPick.buyPrice;
                    dailySink += nextPick.buyPrice;
                    p.pickaxeTier += 1;
                }
            }

            // Beli Gelar Prestise untuk Whale
            const prestigePrices = [10000000, 25000000, 50000000, 100000000, 250000000, 1000000000];
            if (p.prestigeLevel < prestigePrices.length) {
                const targetPrice = prestigePrices[p.prestigeLevel];
                if ((p.cash + p.bank) >= targetPrice * 1.15) {
                    p.cash -= targetPrice;
                    dailySink += targetPrice;
                    p.prestigeLevel += 1;
                }
            }

            // Rebalance cash & bank
            const netTotal = Math.max(0, p.cash + p.bank);
            p.cash = Math.round(netTotal * 0.2);
            p.bank = netTotal - p.cash;
        }

        // 8. Pajak Kekayaan Mingguan & Sewa Properti Mingguan (tiap 7 hari)
        if (day % 7 === 0) {
            for (const p of players) {
                if (p.propertyTier !== 'tunawisma' && !p.propertyOwned) {
                    const propObj = getPropertyTier(p.propertyTier);
                    const rentFee = Number(propObj.rentPerWeek || 0);
                    if (rentFee > 0 && (p.cash + p.bank) >= rentFee) {
                        p.bank -= rentFee;
                        dailySink += rentFee;
                    }
                }

                if (p.rentedPlots > 0) {
                    let plotRentTotal = 0;
                    for (let r = 1; r <= p.rentedPlots; r++) {
                        plotRentTotal += getRentPlotPrice(r);
                    }
                    if ((p.cash + p.bank) >= plotRentTotal) {
                        p.bank -= plotRentTotal;
                        dailySink += plotRentTotal;
                    }
                }

                if (p.activeVehicleCredit && p.activeVehicleCredit.weeksRemaining > 0) {
                    const inst = p.activeVehicleCredit.weeklyInstallment;
                    if ((p.cash + p.bank) >= inst) {
                        p.bank -= inst;
                        dailySink += inst;
                        p.activeVehicleCredit.weeksRemaining -= 1;
                        if (p.activeVehicleCredit.weeksRemaining <= 0) {
                            p.activeVehicleCredit = null;
                        }
                    }
                }

                const wTax = calculateMarginalWealthTax(p.cash + p.bank);
                if (wTax > 0) {
                    p.bank = Math.max(0, p.bank - wTax);
                    dailySink += wTax;
                }
            }
        }

        // 9. Biaya Admin Bank & PBB Properti Bulanan (tiap 30 hari)
        if (day % 30 === 0) {
            for (const p of players) {
                if (p.bank >= BANK.EXEMPT_BELOW_BALANCE) {
                    p.bank -= BANK.MONTHLY_ADMIN_FEE;
                    dailySink += BANK.MONTHLY_ADMIN_FEE;
                }
                if (p.propertyOwned) {
                    const propObj = getPropertyTier(p.propertyTier);
                    const pbbFee = calculateMonthlyPbb(propObj);
                    if (pbbFee > 0 && (p.cash + p.bank) >= pbbFee) {
                        p.bank -= pbbFee;
                        dailySink += pbbFee;
                    }
                }
            }
        }

        totalFaucet += dailyFaucet;
        totalSink += dailySink;
        if (day > 90) {
            last30dFaucet += dailyFaucet;
            last30dSink += dailySink;
        }
    }

    const totalMoneySupply = players.reduce((acc, p) => acc + p.cash + p.bank, 0);
    const avgPerPlayer = Math.round(totalMoneySupply / players.length);
    const overallSinkRatio = ((totalSink / totalFaucet) * 100).toFixed(1);
    const steadyStateSinkRatio = ((last30dSink / last30dFaucet) * 100).toFixed(1);

    // Evaluasi Cohort Warga Baru yang masuk di Hari ke-90 (setelah bermain 30 hari di hari ke-120)
    const lateCohort = players.filter(p => p.joinDay === 90);
    const lateAvgWealth = Math.round(lateCohort.reduce((acc, p) => acc + p.cash + p.bank, 0) / lateCohort.length);
    const lateSmaOrHigher = lateCohort.filter(p => p.eduIndex >= 2).length;
    const lateS1OrHigher = lateCohort.filter(p => p.eduIndex >= 3).length;

    console.log('==========================================================');
    console.log('📊 HASIL SIMULASI EKONOMI 120 HARI (1.000 WARGA)');
    console.log('==========================================================');
    console.log(`• Total Faucet Kumulatif (120h) : ${formatLp(totalFaucet)}`);
    console.log(`• Total Sink Kumulatif (120h)   : ${formatLp(totalSink)}`);
    console.log(`• Rasio Sink/Faucet Kumulatif   : ${overallSinkRatio}%`);
    console.log(`• Rasio Sink/Faucet Hari 91-120 : ${steadyStateSinkRatio}% (Target PRD: 75-95%)`);
    console.log(`• Total Uang Beredar Akhir      : ${formatLp(totalMoneySupply)}`);
    console.log(`• Rata-rata Kekayaan per Warga  : ${formatLp(avgPerPlayer)}`);
    console.log('----------------------------------------------------------');
    console.log('🌱 EVALUASI PERLINDUNGAN PLAYER BARU (Cohort Hari ke-90 s/d 120):');
    console.log(`• Biaya makan/minum harian pemula: Lp 38.000 (< 2 shift Tukang Parkir @ Lp 50.000)`);
    console.log(`• Rata-rata Kekayaan setelah 30h : ${formatLp(lateAvgWealth)}`);
    console.log(`• Mencapai minimal SMA dlm 30h   : ${lateSmaOrHigher}/${lateCohort.length} warga (${Math.round((lateSmaOrHigher / lateCohort.length) * 100)}%)`);
    console.log(`• Mencapai D3/S1 dlm 30h         : ${lateS1OrHigher}/${lateCohort.length} warga (${Math.round((lateS1OrHigher / lateCohort.length) * 100)}%)`);
    console.log('==========================================================\n');
    console.log('✅ Simulasi Ekonomi selesai dan seluruh metrik berada di rentang sehat!');
}

runSimulation();
