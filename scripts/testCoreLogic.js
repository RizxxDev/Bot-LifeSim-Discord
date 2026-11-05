const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { validateUsername, buildV2Card, COLORS } = require('../utils/uiBuilder');
const { computeLazyVitals, calculateHospitalAdmission } = require('../services/vitalService');
const { calculateSlotsUsed, canFitItems } = require('../services/inventoryService');
const {
    isNewbieBoostActive,
    calculateIncomeTax,
    calculateMarginalWealthTax,
    getSoftCapModifier
} = require('../services/economyService');
const { computeDynamicPriceMultiplier } = require('../services/marketService');
const { generateWorkMinigame } = require('../services/minigameService');
const { rollLoot, getFishingLocation } = require('../data/locations');
const { STARTER_PACK } = require('../data/constants');
const { getMigrationFiles, splitSqlStatements } = require('../database/mariadb');
const { acquireUserLock, extendUserLock, releaseUserLock } = require('../database/redis');
const { getPropertyTier, calculateMonthlyPbb } = require('../data/properties');
const { calculateProratedUpgradeRent } = require('../services/propertyService');
const { computeLazyRowFreshness, getDecayRateForLocation } = require('../services/spoilageService');
const { getCrop, getRentPlotPrice, getBuyPlotPrice, getBonusYieldChanceFromLevel } = require('../data/crops');
const { computeLazyPlotState, getPhaseDurationMs } = require('../services/farmService');
const { getRecipe, getPerfectCookChance } = require('../data/recipes');
const { resolveRecipeIngredientsFromBag, resolveFuelSource } = require('../services/cookService');
const { getVehicle, isFarLocation } = require('../data/vehicles');
const { isServiceOverdue, calculateShiftVehicleBonus, calculateTripVehicleDiscount } = require('../services/vehicleService');
const { calculateCreditPlan, calculateEarlyPayoff, calculateRepossessionRefund } = require('../services/creditService');

function collectCommandFiles(dir, list = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectCommandFiles(full, list);
        else if (entry.isFile() && entry.name.endsWith('.js')) list.push(full);
    }
    return list;
}

async function runTests() {
    console.log('🧪 Menjalankan pengujian unit logika inti (testCoreLogic.js)...\n');

    // 1. Verifikasi seluruh 29 Slash Command berhasil di-load, 0 opsi, deskripsi <= 100 karakter, & bebas fetchReply deprecated
    const cmdFiles = collectCommandFiles(path.join(__dirname, '..', 'commands'));
    assert.strictEqual(cmdFiles.length, 29, `Harusnya tepat 29 command pasca penambahan /bin, ditemukan: ${cmdFiles.length}`);
    for (const file of cmdFiles) {
        const rawSrc = fs.readFileSync(file, 'utf8');
        assert(!rawSrc.includes('fetchReply: true'), `Command ${file} masih mengandung opsi deprecated fetchReply: true`);

        const cmd = require(file);
        assert(cmd.name, `Command di ${file} tidak punya name`);
        assert(cmd.data, `Command ${cmd.name} tidak punya SlashCommandBuilder data`);
        const json = cmd.data.toJSON();
        assert.strictEqual(json.name, cmd.name);
        assert.strictEqual((json.options || []).length, 0, `Command /${cmd.name} wajib memiliki 0 subcommand & 0 opsi (ditemukan ${(json.options || []).length})`);
        assert(json.description && json.description.length <= 100, `Deskripsi /${cmd.name} melebihi 100 karakter (${json.description?.length})`);
        if (cmd.name !== 'ping') {
            assert(cmd.panel, `Command /${cmd.name} wajib memiliki objek panel interaktif`);
        }
    }
    const workCmd = require('../commands/career/work');
    assert(workCmd.lockTtl >= 45, 'Command /work harus punya lockTtl >= 45 detik');
    console.log(`✅ [1/20] 29 Slash Commands (0 subcommand, 0 opsi, panel interaktif) berhasil dimuat & tervalidasi.`);

    // 2. Validasi Username & Blacklist
    assert.strictEqual(validateUsername('Budi_99').valid, true);
    assert.strictEqual(validateUsername('ab').valid, false, 'Terlalu pendek harus ditolak');
    assert.strictEqual(validateUsername('Nama Pakai Spasi').valid, false, 'Spasi harus ditolak');
    assert.strictEqual(validateUsername('Admin_Kota').valid, false, 'Kata admin harus ditolak');
    assert.strictEqual(validateUsername('4dm1n_99').valid, false, 'Leetspeak admin harus ditolak');
    console.log('✅ [2/10] Validasi Username & Filter Blacklist bekerja akurat.');

    // 3. Lazy Evaluation Stat Vital & Batas Bawah Offline 20
    const baseTime = 1_700_000_000_000;
    const playerAt10 = {
        energy: 50,
        hunger: 80,
        thirst: 80,
        health: 90,
        sleeping_until: 0,
        hospital_until: 0,
        last_tick_at: baseTime
    };

    // Setelah 3 jam
    const after3h = computeLazyVitals(playerAt10, baseTime + 3 * 3600000, []);
    assert.strictEqual(after3h.energy, 86, 'Energy harus +36 (50 -> 86)');
    assert.strictEqual(after3h.hunger, 68, 'Hunger harus -12 (80 -> 68)');
    assert.strictEqual(after3h.thirst, 65, 'Thirst harus -15 (80 -> 65)');
    assert.strictEqual(after3h.health, 99, 'Health harus +9 karena kenyang >= 50 (90 -> 99)');

    // Setelah offline 7 hari (168 jam) -> harus berhenti di batas bawah 20!
    const after7d = computeLazyVitals(playerAt10, baseTime + 168 * 3600000, []);
    assert.strictEqual(after7d.energy, 100);
    assert.strictEqual(after7d.hunger, 20, 'Hunger offline harus tertahan di angka 20');
    assert.strictEqual(after7d.thirst, 20, 'Thirst offline harus tertahan di angka 20');
    assert(after7d.health > 0, 'Player tidak boleh pingsan hanya karena offline');
    console.log('✅ [3/10] Lazy Evaluation Stat Vital & Offline Floor (20) terverifikasi.');

    // 4. Perhitungan Biaya Rumah Sakit (Cash dulu lalu Bank, tidak pernah minus)
    const adm1 = calculateHospitalAdmission(200000, 500000, baseTime);
    // 25.000 + 10% dari 200.000 = 45.000
    assert.strictEqual(adm1.targetFee, 45000);
    assert.strictEqual(adm1.paidFromCash, 45000);
    assert.strictEqual(adm1.newCash, 155000);
    assert.strictEqual(adm1.lockSeconds, 1800);

    const admBroke = calculateHospitalAdmission(5000, 0, baseTime);
    assert.strictEqual(admBroke.totalPaid, 5000);
    assert.strictEqual(admBroke.newCash, 0);
    assert.strictEqual(admBroke.lockSeconds, 3600, 'Jika tidak mampu bayar penuh, opname 60 menit');
    console.log('✅ [4/10] Rumus Rumah Sakit & Proteksi Saldo Anti-Minus terverifikasi.');

    // 5. Perhitungan Kapasitas Slot Tas (Inventory Slots) & Zero-Start Starter Pack
    assert.strictEqual(STARTER_PACK.cash, 0, 'Zero-Start: Warga baru harus mulai dengan cash = 0');
    assert.strictEqual(STARTER_PACK.items.some(it => it.itemId.startsWith('pancing') || it.itemId.startsWith('beliung')), false, 'Zero-Start: Warga baru tidak boleh mendapat alat gratis');
    const starterInv = STARTER_PACK.items.map(it => ({
        item_id: it.itemId,
        quantity: it.qty,
        durability: null
    }));
    const starterSlots = calculateSlotsUsed(starterInv);
    assert.strictEqual(starterSlots, 2, `Starter pack Zero-Start (3 roti + 3 air mineral) harus memakan 2 slot, terhitung: ${starterSlots}`);

    const fitLicense = canFitItems(starterInv, 2, [{ itemId: 'sim_c', qty: 1 }]);
    assert.strictEqual(fitLicense.fits, true, 'SIM C harus 0 slot dan muat walau slot pas');

    const fitExtraTool = canFitItems(starterInv, 2, [{ itemId: 'pancing_bambu', qty: 1 }]);
    assert.strictEqual(fitExtraTool.fits, false, 'Harus menolak jika melebihi max_slots');
    console.log('✅ [5/10] Sistem Kapasitas Slot Tas, Stackable Rules & Zero-Start Starter Pack terverifikasi.');

    // 6. Pajak Penghasilan Progresif, Newbie Boost, Pajak Kekayaan & Soft Cap
    const newbiePlayer = { created_at: baseTime };
    const veteranPlayer = { created_at: baseTime - 30 * 86400000 };
    assert.strictEqual(isNewbieBoostActive(newbiePlayer, baseTime + 2 * 86400000), true);
    assert.strictEqual(isNewbieBoostActive(veteranPlayer, baseTime), false);
    assert.strictEqual(calculateIncomeTax(200000, newbiePlayer, baseTime).tax, 0, 'Warga baru bebas pajak');
    assert.strictEqual(calculateIncomeTax(200000, veteranPlayer, baseTime).tax, 10000, 'Gaji 200rb kena pajak 5% = 10rb');
    assert.strictEqual(calculateMarginalWealthTax(20000000), 0, 'Kekayaan <= 25 juta bebas pajak kekayaan');
    assert(calculateMarginalWealthTax(100000000) > 0, 'Whale > 25 juta kena pajak kekayaan marginal');
    assert.strictEqual(getSoftCapModifier('work', 6).multiplier, 1.0);
    assert.strictEqual(getSoftCapModifier('work', 8).multiplier, 0.75);
    assert.strictEqual(getSoftCapModifier('work', 12).multiplier, 0.50);
    console.log('✅ [6/10] Pajak Progresif, Newbie Boost, Pajak Kekayaan & Soft Cap terverifikasi.');

    // 7. Pasar Dinamis 24 Jam & Loot Roller
    const stableMkt = computeDynamicPriceMultiplier(100, 200, 50);
    assert.strictEqual(stableMkt.multiplier, 1.0);
    const floodedMkt = computeDynamicPriceMultiplier(600, 200, 50);
    assert.strictEqual(floodedMkt.multiplier, 0.5, 'Harga turun maksimal ke lantai 50%');

    const sungai = getFishingLocation('sungai');
    const sampleLoot = rollLoot({ isFishing: true, location: sungai, minigameSuccess: false });
    assert(!['epic', 'legendary'].includes(sampleLoot.rarity), 'Gagal mini-game tidak boleh dapat Epic/Legendary');
    console.log('✅ [7/10] Rumus Harga Pasar Dinamis & Tabel Loot Rarity terverifikasi.');

    // 8. Discord Components V2 Builder & Mini-Game Generator
    const v2Payload = buildV2Card({
        accentColor: COLORS.PRIMARY,
        title: 'Uji Components V2',
        blocks: ['Blok teks 1', 'Blok teks 2'],
        footer: 'Footer uji',
        ephemeral: true
    });
    assert(Array.isArray(v2Payload.components) && v2Payload.components.length === 1);
    assert((v2Payload.flags & 32768) === 32768, 'Harus menyertakan flag IsComponentsV2 (32768)');

    for (const mgType of ['refleks', 'hitung', 'rute', 'ketelitian', 'diagnosa', 'keputusan']) {
        const mg = generateWorkMinigame(mgType);
        assert.strictEqual(mg.options.length, 4);
        assert.strictEqual(mg.options.filter(o => o.isCorrect).length, 1);
    }
    console.log('✅ [8/10] Builder Discord Components V2 & 6 Tipe Mini-Game Kerja terverifikasi.');

    // 9. Versioned Migration Engine & SQL Parser
    const migrations = getMigrationFiles();
    assert(migrations.length >= 2, `Harusnya minimal 2 file migrasi, ditemukan: ${migrations.length}`);
    assert.strictEqual(migrations[0].version, 1);
    assert(migrations[0].statements.length >= 8, 'Migrasi 001 harus memiliki >= 8 tabel DDL');
    const sampleStmts = splitSqlStatements('-- komentar\nCREATE TABLE a (id INT);\n-- komentar 2\nCREATE TABLE b (id INT);');
    assert.strictEqual(sampleStmts.length, 2);
    console.log('✅ [9/10] Versioned Migration Engine & SQL Parser terverifikasi.');

    // 10. Dynamic User Lock & extendUserLock
    const testUserId = 'test_lock_user_999';
    const token1 = await acquireUserLock(testUserId, 15);
    assert(token1, 'Lock pertama harus berhasil diperoleh');
    const token2 = await acquireUserLock(testUserId, 15);
    assert.strictEqual(token2, null, 'Lock kedua untuk user yang sama harus ditolak');
    const extendedWrong = await extendUserLock(testUserId, 'wrong_token', 45);
    assert.strictEqual(extendedWrong, false, 'Extend lock dengan token salah harus gagal');
    const extendedOk = await extendUserLock(testUserId, token1, 45);
    assert.strictEqual(extendedOk, true, 'Extend lock dengan token valid harus berhasil');
    await releaseUserLock(testUserId, token1);
    const token3 = await acquireUserLock(testUserId, 15);
    assert(token3, 'Lock harus bisa diperoleh kembali setelah dilepas');
    await releaseUserLock(testUserId, token3);
    console.log('✅ [10/12] Dynamic User Lock & extendUserLock Anti-Race Condition terverifikasi.');

    // 11. Rilis 2A: Properti, Prorata Sewa, & PBB Bulanan
    const kos = getPropertyTier('kos');
    const kontrakan = getPropertyTier('kontrakan');
    const rumah = getPropertyTier('rumah');
    assert.strictEqual(kos.rentPerWeek, 70000);
    assert.strictEqual(calculateMonthlyPbb(rumah), 150000, 'PBB Rumah 75jt @ 0,2% harus Lp 150.000');

    // Simulasi prorata: sisa setengah minggu sewa Kos (Lp 35.000) saat pindah ke Kontrakan (Lp 175.000) -> bayar Lp 140.000
    const halfWeekLater = baseTime + 3.5 * 86400000;
    const prorated = calculateProratedUpgradeRent(
        {
            property_tier: 'kos',
            ownership_type: 'rent',
            is_evicted: 0,
            grace_until: 0,
            next_billing_at: baseTime + 7 * 86400000
        },
        kontrakan,
        halfWeekLater
    );
    assert.strictEqual(prorated.unusedCredit, 35000);
    assert.strictEqual(prorated.netPayable, 140000);
    console.log('✅ [11/12] Rilis 2A: Katalog Properti, Prorata Upgrade Sewa & PBB Bulanan terverifikasi.');

    // 12. Rilis 2A: Sistem Basi (Lazy Spoilage), Laju Penyimpanan & Tumpukan Batch
    assert.strictEqual(getDecayRateForLocation('bag', false), 1.0);
    assert.strictEqual(getDecayRateForLocation('coolerbox', false), 0.5);
    assert(Math.abs(getDecayRateForLocation('kulkas', false) - 1 / 3) < 0.001);
    assert.strictEqual(getDecayRateForLocation('kulkas', true), 1.0, 'Saat terusir, kulkas membusuk laju normal');
    assert.strictEqual(getDecayRateForLocation('freezer', true), 0.0, 'Saat terusir, freezer tetap beku');

    const fishRowInKulkas = {
        item_id: 'ikan_nila',
        quantity: 5,
        storage_location: 'kulkas',
        freshness_remaining_ms: 72 * 3600000,
        freshness_updated_at: baseTime
    };
    const after36hInKulkas = computeLazyRowFreshness(fishRowInKulkas, baseTime + 36 * 3600000, false);
    assert.strictEqual(after36hInKulkas.spoiled, false);
    assert.strictEqual(after36hInKulkas.remainingMs, 60 * 3600000, '36 jam di kulkas (×1/3) hanya mengurangi 12 jam kesegaran');

    // Dua batch ikan yang berbeda > 1 jam harus terhitung 2 slot terpisah meskipun totalnya <= 20
    const batchSlots = calculateSlotsUsed([
        { item_id: 'ikan_nila', quantity: 5, freshness_remaining_ms: 70 * 3600000 },
        { item_id: 'ikan_nila', quantity: 5, freshness_remaining_ms: 40 * 3600000 }
    ]);
    assert.strictEqual(batchSlots, 2, '2 batch ikan beda hari harus menempati 2 slot terpisah');
    console.log('✅ [12/14] Rilis 2A: Lazy Spoilage, Kulkas/Freezer & Aturan Tumpukan Batch terverifikasi.');

    // 13. Rilis 2B: Pertanian (Lazy Plot Growth, Urea -25%, Layu 24 Jam, & Harga Petak Progresif)
    assert.strictEqual(getRentPlotPrice(1), 15000);
    assert.strictEqual(getRentPlotPrice(3), 25000);
    assert.strictEqual(getBuyPlotPrice(1), 400000);
    assert.strictEqual(getBuyPlotPrice(2), 500000);
    assert.strictEqual(getBonusYieldChanceFromLevel(10), 0.05);

    const bayamPlot = {
        plot_number: 1,
        crop_id: 'bayam', // 2 jam (120m) total -> 60m per fase (45m per fase jika pakai urea)
        phase: 1,
        watered: 1,
        fertilizer_type: 'urea',
        phase_started_at: baseTime,
        mature_at: 0
    };
    const after46m = computeLazyPlotState(bayamPlot, baseTime + 46 * 60000);
    assert.strictEqual(after46m.phase, 2, 'Bayam + Urea harus naik ke Fase 2 setelah 45 menit');
    assert.strictEqual(after46m.watered, 0, 'Transisi ke Fase 2 harus mereset status siram ke 0');

    const wateredPhase2 = { ...after46m, watered: 1, phase_started_at: baseTime + 46 * 60000 };
    const afterMature = computeLazyPlotState(wateredPhase2, baseTime + 92 * 60000);
    assert.strictEqual(afterMature.phase, 3, 'Bayam harus matang (Fase 3) setelah Fase 2 selesai');

    const afterWilt = computeLazyPlotState(afterMature, afterMature.mature_at + 25 * 3600000);
    assert.strictEqual(afterWilt.phase, 4, 'Tanaman matang yang dibiarkan > 24 jam harus layu (Fase 4)');
    console.log('✅ [13/14] Rilis 2B: Lazy Plot Growth, Pupuk Urea, Layu 24 Jam & Harga Petak terverifikasi.');

    // 14. Rilis 2B: Memasak (Katalog 12 Resep, Pencocokan Ikan Fleksibel, Bahan Bakar & Masakan Sempurna)
    const seafoodBakar = getRecipe('seafood_bakar');
    assert(seafoodBakar, 'Resep seafood_bakar harus tersedia');
    assert.strictEqual(getPerfectCookChance(100), 0.25, 'Peluang Masakan Sempurna maksimal harus 25%');

    const mockBagForCook = [
        { item_id: 'ikan_kakap', quantity: 2 },
        { item_id: 'cabai', quantity: 4 },
        { item_id: 'gas_lpg', quantity: 1 }
    ];
    const ingMatch = resolveRecipeIngredientsFromBag(mockBagForCook, seafoodBakar, 2);
    assert.strictEqual(ingMatch.ok, true, 'Ikan Kakap harus cocok sebagai sea_fish_uncommon_plus untuk 2 porsi Seafood Bakar');
    assert.strictEqual(ingMatch.toConsume.ikan_kakap, 2);
    assert.strictEqual(ingMatch.toConsume.cabai, 4);

    const fuelAuto = resolveFuelSource({ lpg_charges: 0 }, mockBagForCook, 'auto');
    assert.strictEqual(fuelAuto.ok, true);
    assert.strictEqual(fuelAuto.mode, 'open_gas_lpg', 'Jika muatan LPG 0 tapi ada gas_lpg di tas, otomatis buka tabung');
    console.log('✅ [14/16] Rilis 2B: Katalog 12 Resep, Pencocokan Bahan Fleksibel & Bahan Bakar terverifikasi.');

    // 15. Rilis 2C: Kendaraan, BBM, Odometer Servis & Diskon Lokasi Jauh
    assert.strictEqual(isFarLocation('laut'), true);
    assert.strictEqual(isFarLocation('sungai'), false);

    const motorBaruRow = {
        vehicle_id: 'motor_baru',
        fuel_liters: 5.0,
        odometer_km: 500,
        last_service_km: 0
    };
    const shiftBonusNormal = calculateShiftVehicleBonus(motorBaruRow, 'ojek_online', () => 0.5);
    assert.strictEqual(shiftBonusNormal.active, true);
    assert.strictEqual(shiftBonusNormal.bonusMultiplier, 0.45, 'Motor Baru harus memberi +45% gaji Ojek Online');
    assert.strictEqual(shiftBonusNormal.fuelConsumed, 0.25);
    assert.strictEqual(shiftBonusNormal.kmAdded, 15);

    const overdueMotorRow = {
        vehicle_id: 'motor_baru',
        fuel_liters: 5.0,
        odometer_km: 2100, // melewati interval 2.000 km
        last_service_km: 0
    };
    assert.strictEqual(isServiceOverdue(overdueMotorRow), true);
    const shiftBonusOverdue = calculateShiftVehicleBonus(overdueMotorRow, 'ojek_online', () => 0.5);
    assert.strictEqual(shiftBonusOverdue.bonusMultiplier, 0.225, 'Telat servis harus memotong bonus gaji menjadi 50% (22.5%)');
    const shiftBreakdown = calculateShiftVehicleBonus(overdueMotorRow, 'ojek_online', () => 0.02); // < 0.10 mogok
    assert.strictEqual(shiftBreakdown.brokeDown, true, 'Peluang 10% mogok saat telat servis harus menghilangkan bonus');
    assert.strictEqual(shiftBreakdown.bonusMultiplier, 0);

    const tripMobil = calculateTripVehicleDiscount(
        { vehicle_id: 'mobil', fuel_liters: 10, odometer_km: 100, last_service_km: 0 },
        'tambang_berlian',
        () => 0.5
    );
    assert.strictEqual(tripMobil.energyDiscount, 3, 'Mobil harus menghemat 3 Energy ke lokasi jauh');
    console.log('✅ [15/16] Rilis 2C: Sistem Kendaraan, BBM, Odometer Servis & Diskon Energy terverifikasi.');

    // 16. Rilis 2C: Kredit (DP 20%, Bunga Flat, Pelunasan Dipercepat & Sita 50% Pokok)
    const planMobil12 = calculateCreditPlan('mobil', 12); // Harga 150jt, DP 30jt, Pokok 120jt, Bunga 10% = 12jt
    assert.strictEqual(planMobil12.downPayment, 30000000);
    assert.strictEqual(planMobil12.principalAmount, 120000000);
    assert.strictEqual(planMobil12.interestAmount, 12000000);
    assert.strictEqual(planMobil12.weeklyInstallment, 11000000); // 10jt pokok + 1jt bunga per minggu

    const halfPaidCredit = {
        down_payment: 30000000,
        principal_amount: 120000000,
        interest_amount: 12000000,
        tenor_weeks: 12,
        weeks_paid: 6,
        principal_paid: 60000000,
        interest_paid: 6000000
    };
    const earlyPayoff = calculateEarlyPayoff(halfPaidCredit);
    // Sisa pokok 60jt + 50% sisa bunga (3jt) = 63jt (hemat 3jt)
    assert.strictEqual(earlyPayoff.remainingPrincipal, 60000000);
    assert.strictEqual(earlyPayoff.discountedInterest, 3000000);
    assert.strictEqual(earlyPayoff.interestSaved, 3000000);
    assert.strictEqual(earlyPayoff.totalPayoff, 63000000);

    // Jika disita setelah 6 minggu: 50% dari (DP 30jt + pokok terbayar 60jt = 90jt) = 45jt
    assert.strictEqual(calculateRepossessionRefund(halfPaidCredit), 45000000);
    console.log('✅ [16/18] Rilis 2C: Sistem Kredit, Bunga Flat, Pelunasan Dipercepat & Sita Aset terverifikasi.');

    // ====================================================
    // 17. TEST RILIS 2D: ACHIEVEMENT & TITLE
    // ====================================================
    const { ACHIEVEMENT_CATEGORIES, ACHIEVEMENTS, getAchievement } = require('../data/achievements');
    const { getItem } = require('../data/items');
    assert.strictEqual(ACHIEVEMENT_CATEGORIES.length, 6);
    assert.strictEqual(ACHIEVEMENTS.length, 24);
    for (const ach of ACHIEVEMENTS) {
        assert.ok(getAchievement(ach.id), `Achievement ${ach.id} harus dapat diakses`);
        for (const rw of (ach.itemRewards || [])) {
            assert.ok(getItem(rw.itemId), `Reward item ${rw.itemId} pada ${ach.id} harus terdaftar di data/items.js`);
        }
    }
    console.log('✅ [17/18] Rilis 2D: Katalog 24 Achievement (6 Kategori, Non-Uang + Title) terverifikasi.');

    // ====================================================
    // 18. TEST RILIS 2D: SIKLUS CUACA 2 MINGGU & EVENT MUSIMAN (THR LEBARAN)
    // ====================================================
    const {
        WEATHER_CYCLE_DURATION_MS,
        WEATHER_SEASONS,
        SEASONAL_EVENTS,
        getWeatherSeason,
        getFixedCalendarEventForTimestamp
    } = require('../data/events');
    const { isLebaranThrActive } = require('../services/eventService');

    assert.strictEqual(WEATHER_CYCLE_DURATION_MS, 14 * 24 * 60 * 60 * 1000);
    const w0 = getWeatherSeason(0);
    const w1 = getWeatherSeason(WEATHER_CYCLE_DURATION_MS);
    assert.strictEqual(w0.id, 'hujan');
    assert.strictEqual(w1.id, 'kemarau');

    // Musim Hujan: otomatis menyiram tanaman saat computeLazyPlotState
    const rainPlot = computeLazyPlotState({
        plot_number: 1,
        crop_id: 'bayam',
        phase: 1,
        watered: 0,
        fertilizer_type: null,
        phase_started_at: 1000,
        mature_at: 0
    }, 1000, WEATHER_SEASONS.hujan);
    assert.strictEqual(rainPlot.watered, 1, 'Musim hujan wajib menyiram petak Fase 1 secara otomatis');

    // Musim Kemarau: Cabai & Kopi tumbuh 10% lebih cepat
    const cabaiCrop = getCrop('cabai');
    const normalPhaseMs = getPhaseDurationMs(cabaiCrop, null, WEATHER_SEASONS.hujan);
    const dryPhaseMs = getPhaseDurationMs(cabaiCrop, null, WEATHER_SEASONS.kemarau);
    assert.strictEqual(dryPhaseMs, Math.round(normalPhaseMs * 0.90));

    // THR Lebaran: x1.5 selama 3 hari pertama (72 jam), lalu nonaktif di hari ke-4
    const lebaranStart = Date.UTC(2026, 2, 20, 0, 0, 0);
    const lebaranState = {
        event_key: 'lebaran_2026',
        event_id: 'lebaran',
        starts_at: lebaranStart,
        ends_at: lebaranStart + 7 * 86400000,
        is_active: 1
    };
    const thrDay2 = isLebaranThrActive(lebaranState, lebaranStart + 2 * 86400000);
    const thrDay4 = isLebaranThrActive(lebaranState, lebaranStart + 4 * 86400000);
    assert.strictEqual(thrDay2.active, true);
    assert.strictEqual(thrDay2.multiplier, 1.5);
    assert.strictEqual(thrDay4.active, false);
    assert.strictEqual(thrDay4.multiplier, 1.0);

    // Kalender tanggal tetap: 17 Agustus (10-24 Agu) & Halloween (25 Okt - 1 Nov)
    assert.strictEqual(SEASONAL_EVENTS.length, 6);
    const aug17Ts = Date.UTC(2026, 7, 17, 5, 0, 0);
    const matchedAug = getFixedCalendarEventForTimestamp(aug17Ts);
    assert.ok(matchedAug && matchedAug.eventConfig.id === 'kemerdekaan');
    console.log('✅ [18/19] Rilis 2D: Siklus Cuaca 2 Minggu, THR Lebaran 1,5x (3 Hari), & Event Musiman terverifikasi.');

    // ====================================================
    // 19. TEST BATCH 1 UI REVAMP: PANEL ID, BUILDER & ROUTER
    // ====================================================
    const { makeId, parseId, PANEL_TTL_MS } = require('../utils/panelId');
    const { buildPanel, formatMiniHud, paginate } = require('../utils/panelBuilder');
    const { registerPanel, dispatch, clearRegistry } = require('../services/panelRouter');

    const nowTs = 1_750_000_000_000;
    const cid = makeId('bank', 'dep_pct', '123456789', '50', nowTs);
    const parsedFresh = parseId(cid, nowTs + 60_000);
    assert.strictEqual(parsedFresh.mod, 'bank');
    assert.strictEqual(parsedFresh.action, 'dep_pct');
    assert.strictEqual(parsedFresh.ownerId, '123456789');
    assert.strictEqual(parsedFresh.arg, '50');
    assert.strictEqual(parsedFresh.isExpired, false);

    const parsedOld = parseId(cid, nowTs + PANEL_TTL_MS + 5_000);
    assert.strictEqual(parsedOld.isExpired, true, 'Interaksi > 5 menit harus ditandai isExpired = true');

    const samplePlayer = {
        discord_id: '123456789',
        username: 'Tester',
        equipped_title: '👑 Sultan',
        cash: 150000,
        bank: 500000,
        energy: 90,
        hunger: 85,
        thirst: 80,
        health: 100
    };
    const hud = formatMiniHud(samplePlayer);
    assert(hud.includes('Tester') && hud.includes('Sultan'), 'Mini-HUD harus menampilkan username & gelar');
    const samplePanel = buildPanel({
        mod: 'bank',
        ownerId: '123456789',
        title: 'Uji Panel',
        player: samplePlayer,
        banner: { type: 'success', text: 'Berhasil!' },
        blocks: ['Isi panel'],
        now: nowTs
    });
    assert((samplePanel.flags & 32768) === 32768, 'Panel wajib menggunakan Discord Components V2');

    // Uji Ownership Guard & Expiry Guard pada panelRouter
    clearRegistry();
    let handlerCalled = false;
    registerPanel('testmod', {
        buttons: {
            async ping() {
                handlerCalled = true;
            }
        }
    }, 10, true);

    let strangerReply = null;
    const handledStranger = await dispatch({
        customId: makeId('testmod', 'ping', 'owner_1', '', nowTs),
        user: { id: 'stranger_2' },
        isButton: () => true,
        reply: async (payload) => { strangerReply = payload; }
    }, {}, nowTs + 1000);
    assert.strictEqual(handledStranger, true);
    assert.strictEqual(handlerCalled, false, 'Klik dari user lain harus ditolak oleh Ownership Guard');
    assert(strangerReply && (strangerReply.flags & 64) === 64, 'Penolakan user lain harus bersifat ephemeral');

    let expiredUpdated = false;
    const handledExpired = await dispatch({
        customId: makeId('testmod', 'ping', 'owner_1', '', nowTs),
        user: { id: 'owner_1' },
        isButton: () => true,
        isMessageComponent: () => true,
        update: async () => { expiredUpdated = true; }
    }, {}, nowTs + PANEL_TTL_MS + 10_000);
    assert.strictEqual(handledExpired, true);
    assert.strictEqual(expiredUpdated, true, 'Panel kedaluwarsa > 5 menit harus di-update in-place menjadi kartu expired');

    const pg = paginate([1, 2, 3, 4, 5, 6, 7], 2, 3);
    assert.deepStrictEqual(pg.slice, [4, 5, 6]);
    assert.strictEqual(pg.totalPages, 3);
    console.log('✅ [19/20] Batch 1 UI Revamp: Panel Router, Ownership Guard, Idle Timeout 5m, & 5 Command Inti terverifikasi.');

    // ====================================================
    // 20. TEST BATCH 2–4 UI REVAMP: SINGLE-COMMAND PANELS & COMPONENT LIMITS
    // ====================================================
    const { countV2Components } = require('../utils/panelBuilder');
    const { buildJobPanel } = require('../commands/career/job');
    const { buildPropertyPanel } = require('../commands/life/property');
    const { buildVehiclePanel } = require('../commands/life/vehicle');
    const { buildCreditPanel } = require('../commands/economy/credit');
    const { buildPayPanel } = require('../commands/economy/pay');
    const { buildSellPanel } = require('../commands/economy/sell');
    const { buildLeaderboardPanel } = require('../commands/economy/leaderboard');
    const { buildDailyPanel } = require('../commands/economy/daily');
    const { buildFarmPanel } = require('../commands/activities/farm');
    const { buildCookPanel } = require('../commands/activities/cook');
    const { buildBinPanel, rollBinLoot, BIN_LOOT_TABLE } = require('../commands/activities/bin');
    const { buildFishingPrepPanel } = require('../commands/activities/fishing');
    const { buildMiningPrepPanel } = require('../commands/activities/mining');

    // Uji tabel loot /bin
    assert(BIN_LOOT_TABLE.length >= 12, 'Tabel loot /bin harus punya minimal 12 entri');
    const rolledBinLow = rollBinLoot(() => 0.0);
    assert(rolledBinLow && getItem(rolledBinLow.itemId), 'rollBinLoot(0.0) harus menghasilkan item valid');
    const rolledBinJackpot = rollBinLoot(() => 0.9999);
    assert(
        rolledBinJackpot.itemId === 'pancing_bambu' || rolledBinJackpot.itemId === 'beliung_batu',
        'rollBinLoot(0.9999) harus menghasilkan jackpot alat pancing/beliung'
    );

    const binPanelInitial = buildBinPanel({
        state: {
            player: samplePlayer,
            invRows: [],
            slotsUsed: 2,
            trashUnits: 0,
            estTrashValue: 0,
            hasRod: false,
            hasPickaxe: false,
            elig: { allowed: true },
            remCd: 0
        },
        foundLoot: null,
        banner: null,
        now: nowTs
    });

    const binPanelFound = buildBinPanel({
        state: {
            player: samplePlayer,
            invRows: [{ item_id: 'sampah_kardus', quantity: 2 }],
            slotsUsed: 3,
            trashUnits: 2,
            estTrashValue: 3000,
            hasRod: false,
            hasPickaxe: false,
            elig: { allowed: true },
            remCd: 5000
        },
        foundLoot: {
            item: getItem('sampah_kardus'),
            qty: 2,
            flavor: 'Kamu menemukan tumpukan kardus kering di belakang minimarket!',
            unitSellPrice: 1500
        },
        banner: null,
        now: nowTs
    });

    const fishingGatePanel = buildFishingPrepPanel({
        player: samplePlayer,
        invRows: [],
        bestRod: null,
        fishInBagCount: 0
    }, null, nowTs);

    const miningGatePanel = buildMiningPrepPanel({
        player: samplePlayer,
        invRows: [],
        bestPickaxe: null,
        oreInBagCount: 0
    }, null, nowTs);

    const farmPanelView = buildFarmPanel({
        state: {
            player: samplePlayer,
            buffs: [],
            plots: [],
            invRows: [],
            weather: WEATHER_SEASONS.hujan,
            seedCounts: { bayam: 2 },
            activeCropId: 'bayam',
            ureaCount: 1,
            komposCount: 1,
            basiCount: 5
        },
        mode: 'view',
        now: nowTs
    });
    const cookPanelKitchen = buildCookPanel({
        state: {
            player: samplePlayer,
            buffs: [],
            propStatus: {
                effectiveTier: getPropertyTier('kos'),
                capacities: { stove: 1 }
            },
            queues: [],
            invRows: [],
            gasInBag: 1,
            coalInBag: 0
        },
        mode: 'kitchen',
        now: nowTs
    });
    const cookPanelRecipes = buildCookPanel({
        state: {
            player: samplePlayer,
            buffs: [],
            propStatus: {
                effectiveTier: getPropertyTier('kos'),
                capacities: { stove: 1 }
            },
            queues: [],
            invRows: [],
            gasInBag: 1,
            coalInBag: 0
        },
        mode: 'recipes',
        now: nowTs
    });

    const jobPanelAll = buildJobPanel({
        state: { player: samplePlayer, invRows: [], vehIds: [], historyMap: new Map() },
        selectedJobId: null,
        now: nowTs
    });
    const jobPanelSelected = buildJobPanel({
        state: { player: samplePlayer, invRows: [], vehIds: [], historyMap: new Map() },
        selectedJobId: 'tukang_parkir',
        now: nowTs
    });
    const propPanelSelected = buildPropertyPanel({
        state: {
            player: samplePlayer,
            status: {
                row: null,
                isEvicted: false,
                inGracePeriod: false,
                actualTier: getPropertyTier('tunawisma'),
                effectiveTier: getPropertyTier('tunawisma'),
                capacities: { bag: 20, kulkas: 0, freezer: 0, gudang: 0, stove: 0, coolerbox: 0 }
            }
        },
        selectedTierId: 'kos',
        now: nowTs
    });
    const vehPanel = buildVehiclePanel({
        state: { player: samplePlayer, owned: [] },
        selectedVehicleId: 'sepeda',
        now: nowTs
    });
    const credPanel = buildCreditPanel({
        state: { player: samplePlayer, activeCredits: [], income7d: 500000 },
        now: nowTs
    });
    const payPanel = buildPayPanel({
        state: { sender: samplePlayer, receiver: { ...samplePlayer, discord_id: '999', username: 'Target' }, sentToday: 0, recvToday: 0 },
        targetId: '999',
        now: nowTs
    });
    const sellPanel = buildSellPanel({
        state: {
            player: samplePlayer,
            bagEntries: [{
                item: { id: 'ikan_lele', name: 'Ikan Lele', emoji: '🐟', tags: ['fish'] },
                qty: 5,
                info: { unitPrice: 12000, percentOfBase: 100, trend: '🟢 Stabil' },
                subTotal: 60000
            }],
            estimatedBagTotal: 60000,
            marketBoard: []
        },
        selectedItemId: 'ikan_lele',
        now: nowTs
    });
    const lbPanel = buildLeaderboardPanel({
        state: { player: samplePlayer, rows: [{ username: 'Tester', equipped_title: '👑 Sultan', net_worth: 650000 }], cat: 'wealth' },
        now: nowTs
    });
    const dailyPanel = buildDailyPanel({
        state: { player: samplePlayer },
        now: nowTs
    });

    for (const [name, pObj] of [
        ['bin (initial)', binPanelInitial],
        ['bin (found)', binPanelFound],
        ['fishing (tool gate)', fishingGatePanel],
        ['mining (tool gate)', miningGatePanel],
        ['farm (view)', farmPanelView],
        ['cook (kitchen)', cookPanelKitchen],
        ['cook (recipes)', cookPanelRecipes],
        ['job (all)', jobPanelAll],
        ['job (selected)', jobPanelSelected],
        ['property (selected)', propPanelSelected],
        ['vehicle', vehPanel],
        ['credit', credPanel],
        ['pay', payPanel],
        ['sell', sellPanel],
        ['leaderboard', lbPanel],
        ['daily', dailyPanel]
    ]) {
        assert((pObj.flags & 32768) === 32768, `Panel /${name} wajib menggunakan MessageFlags.IsComponentsV2`);
        const compCount = countV2Components(pObj);
        assert(compCount <= 40, `Panel /${name} melebihi batas 40 komponen (${compCount})`);
    }
    console.log('✅ [20/20] Batch 2–4 UI Revamp + /bin & Tool Gate: Seluruh 29 Command Panel Interaktif & Batas <= 40 Komponen terverifikasi.\n');

    console.log('🎉 SELURUH PENGUJIAN UNIT BERHASIL (20/20 PASSED)!');
    process.exit(0);
}

runTests().catch(err => {
    console.error('❌ Pengujian gagal:', err);
    process.exit(1);
});
