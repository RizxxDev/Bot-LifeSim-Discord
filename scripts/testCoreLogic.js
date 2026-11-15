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

    // 1. Verifikasi seluruh 35 Slash Command berhasil di-load, 0 opsi, deskripsi <= 100 karakter, & bebas fetchReply deprecated
    const cmdFiles = collectCommandFiles(path.join(__dirname, '..', 'commands'));
    assert.strictEqual(cmdFiles.length, 35, `Harusnya tepat 35 command pasca pembaruan /tanah & /bangun, ditemukan: ${cmdFiles.length}`);
    for (const file of cmdFiles) {
        const rawSrc = fs.readFileSync(file, 'utf8');
        assert(!rawSrc.includes('fetchReply: true'), `Command ${file} masih mengandung opsi deprecated fetchReply: true`);

        const textInputRe = /new TextInputBuilder\(\)[^;]*?\.setLabel\(\s*(['"`])([^'"`\r\n]+)\1\s*\)/g;
        let tiMatch;
        while ((tiMatch = textInputRe.exec(rawSrc)) !== null) {
            const labelTxt = tiMatch[2];
            if (!labelTxt.includes('${')) {
                assert(
                    labelTxt.length <= 45,
                    `Command ${file} memiliki TextInputBuilder.setLabel() > 45 karakter (${labelTxt.length}): ${labelTxt}`
                );
            }
        }

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
    console.log(`✅ [1/26] 35 Slash Commands (0 subcommand, 0 opsi, panel interaktif) berhasil dimuat & tervalidasi.`);

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
    assert.strictEqual(ACHIEVEMENTS.length, 27);
    for (const ach of ACHIEVEMENTS) {
        assert.ok(getAchievement(ach.id), `Achievement ${ach.id} harus dapat diakses`);
        for (const rw of (ach.itemRewards || [])) {
            assert.ok(getItem(rw.itemId), `Reward item ${rw.itemId} pada ${ach.id} harus terdaftar di data/items.js`);
        }
    }
    console.log('✅ [17/21] Rilis 2D + Gacha: Katalog 27 Achievement (6 Kategori, Non-Uang + Title) terverifikasi.');

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
    const { buildPanel, paginate } = require('../utils/panelBuilder');
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
    const sampleJson = samplePanel.components[0].toJSON();
    const sampleRaw = JSON.stringify(sampleJson);
    assert(!sampleRaw.includes('Tester') && !sampleRaw.includes('Sultan'), 'Mini-HUD wajib dihapus dari semua panel');
    assert.strictEqual(sampleJson.components[0].content, '## Uji Panel', 'Judul panel tetap berada di posisi paling atas');
    assert.strictEqual(sampleJson.components[1].type, 14, 'Pemisah tipis wajib tetap ada tepat di bawah judul panel');

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
    const { buildAchievementsPanel } = require('../commands/life/achievements');
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
        player: { ...samplePlayer, current_city: 'kota_barat' },
        invRows: [],
        bestPickaxe: null,
        oreInBagCount: 0
    }, null, nowTs);

    const farmPanelView = buildFarmPanel({
        state: {
            player: { ...samplePlayer, current_city: 'kota_timur' },
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
    const propPanelSelected = await buildPropertyPanel({
        state: {
            player: samplePlayer,
            lands: [],
            maxLands: 3,
            status: {
                row: null,
                isEvicted: false,
                inGracePeriod: false,
                source: 'tunawisma',
                customName: 'Tunawisma Lokal',
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

    const achSampleEval = {
        unlockedCount: 5,
        totalCount: ACHIEVEMENTS.length,
        claimableCount: 2,
        achievements: ACHIEVEMENTS.map((a, idx) => ({
            ...a,
            currentProgress: idx < 5 ? a.target : Math.floor(a.target / 2),
            unlocked: idx < 5,
            claimed: idx < 3
        }))
    };
    const achPanelAllP1 = buildAchievementsPanel({
        state: {
            player: samplePlayer,
            evalRes: achSampleEval,
            unlockedTitles: [{ title: '👑 Sultan', source: 'Achievement' }]
        },
        selectedCategory: 'all',
        page: 1,
        now: nowTs
    });
    const achPanelAllP2 = buildAchievementsPanel({
        state: {
            player: samplePlayer,
            evalRes: achSampleEval,
            unlockedTitles: [{ title: '👑 Sultan', source: 'Achievement' }]
        },
        selectedCategory: 'all',
        page: 2,
        now: nowTs
    });
    const achPanelAllP3 = buildAchievementsPanel({
        state: {
            player: samplePlayer,
            evalRes: achSampleEval,
            unlockedTitles: [{ title: '👑 Sultan', source: 'Achievement' }]
        },
        selectedCategory: 'all',
        page: 3,
        now: nowTs
    });

    const { computeSusFlagsFromMetrics } = require('../services/moderationService');
    const {
        buildAdminPlayerPanelFromData,
        buildAdminPlayerConfirmPanel,
        buildAdminPlayerLogsPanelFromData,
        buildAdminSusRadarPanelFromData
    } = require('../commands/admin/admin');

    const cleanSus = computeSusFlagsFromMetrics({
        accountAgeHours: 240,
        totalWealth: 500000,
        payIn7d: 20000,
        payOut7d: 10000,
        payTxCount7d: 1,
        faucet24h: 150000,
        activeWarnings: 0
    });
    assert.strictEqual(cleanSus.level, 'low', 'Warga wajar harus berstatus risiko low');

    const tuyulSus = computeSusFlagsFromMetrics({
        accountAgeHours: 12,
        totalWealth: 450000,
        payIn7d: 400000,
        payOut7d: 0,
        payTxCount7d: 4,
        topPartnerId: '888888888',
        topPartnerAmount: 400000,
        topPartnerTxCount: 4,
        faucet24h: 50000,
        activeWarnings: 1
    });
    assert.strictEqual(tuyulSus.level, 'high', 'Indikasi akun tuyul baru + pusaran transfer harus berstatus high');
    assert(tuyulSus.flags.length >= 3, 'Harus menghasilkan minimal 3 red flags');

    const adminPlayerPanel = buildAdminPlayerPanelFromData({
        ownerId: '123456789',
        targetRow: {
            ...samplePlayer,
            current_job: 'ojek_online',
            education_level: 'SMA',
            is_banned: 0,
            created_at: nowTs - 12 * 3600000
        },
        susAnalysis: {
            ...tuyulSus,
            payIn7d: 400000,
            payOut7d: 0,
            payTxCount7d: 4,
            faucet24h: 50000,
            activeWarnings: 1,
            warningsList: [{ reason: 'Jangan pakai akun kedua', created_at: nowTs - 3600000 }]
        },
        now: nowTs
    });

    const adminConfirmReset = buildAdminPlayerConfirmPanel({
        ownerId: '123456789',
        targetRow: samplePlayer,
        actionType: 'reset',
        now: nowTs
    });

    const adminConfirmDelete = buildAdminPlayerConfirmPanel({
        ownerId: '123456789',
        targetRow: samplePlayer,
        actionType: 'delete',
        now: nowTs
    });

    const adminLogsPanel = buildAdminPlayerLogsPanelFromData({
        ownerId: '123456789',
        targetId: '123456789',
        targetRow: samplePlayer,
        susAnalysis: { ...tuyulSus, payIn7d: 400000, payOut7d: 0 },
        logData: {
            page: 1,
            totalPages: 1,
            totalItems: 2,
            formattedLines: [
                '📥 **[MASUK `/pay`]** Menerima **+Lp 200.000** dari <@888888888> · Saldo: `Lp 650.000`',
                '⚠️ **[WARNING 1/3]** Oleh <@999999999>: *"Jangan pakai akun kedua"*'
            ]
        },
        filterCat: 'all',
        now: nowTs
    });

    const adminSusRadarPanel = buildAdminSusRadarPanelFromData({
        ownerId: '123456789',
        radarData: {
            topPayRows: [{ discord_id: '123456789', username: 'Tester', total_vol: 400000, total_in: 400000, total_out: 0, tx_count: 4 }],
            topFaucetRows: [{ discord_id: '123456789', username: 'Tester', faucet_24h: 150000, tx_count: 10 }],
            activeWarnRows: [{ discord_id: '123456789', username: 'Tester', warn_count: 1, is_banned: 0 }],
            candidates: [{ discordId: '123456789', username: 'Tester', tag: 'Transfer 7h: Lp 400.000 (4x)' }]
        },
        now: nowTs
    });

    for (const [name, pObj] of [
        ['bin (initial)', binPanelInitial],
        ['bin (found)', binPanelFound],
        ['fishing (tool gate)', fishingGatePanel],
        ['mining (tool gate)', miningGatePanel],
        ['admin (player audit)', adminPlayerPanel],
        ['admin (confirm reset)', adminConfirmReset],
        ['admin (confirm delete)', adminConfirmDelete],
        ['admin (player logs)', adminLogsPanel],
        ['admin (sus radar)', adminSusRadarPanel],
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
        ['daily', dailyPanel],
        ['achievements (all p1)', achPanelAllP1],
        ['achievements (all p2)', achPanelAllP2],
        ['achievements (all p3)', achPanelAllP3]
    ]) {
        assert((pObj.flags & 32768) === 32768, `Panel /${name} wajib menggunakan MessageFlags.IsComponentsV2`);
        const compCount = countV2Components(pObj);
        assert(compCount <= 40, `Panel /${name} melebihi batas 40 komponen (${compCount})`);
    }
    console.log('✅ [20/21] Batch 2–4 UI Revamp + /bin & Tool Gate: Seluruh Panel Interaktif & Batas <= 40 Komponen terverifikasi.');

    // ====================================================
    // 21. TEST FITUR /GACHA: 3-TIER MESIN KAPSUL, GARANSI 10x RARE+, KONVERSI DUPLIKAT & KENDARAAN EKSKLUSIF
    // ====================================================
    const {
        GACHA_TIERS,
        RARITY_META,
        DUPLICATE_TICKET_YIELD,
        getGachaTier,
        getGachaTitle,
        isRareOrAbove
    } = require('../data/gacha');
    const {
        simulateGachaPullBatch,
        isUniquePrizeAlreadyOwned
    } = require('../services/gachaService');
    const { buildGachaPanel } = require('../commands/economy/gacha');
    const {
        CLOTHES,
        CLOTHING_SLOTS,
        STARTER_CLOTHING_IDS,
        getClothing,
        getClothingAssetPath
    } = require('../data/clothes');

    // Validasi setiap tier memiliki total bobot tepat 100% dan semua item/vehicle/title/clothing valid
    for (const tier of GACHA_TIERS) {
        const sumWeight = tier.lootTable.reduce((acc, e) => acc + e.weight, 0);
        assert(Math.abs(sumWeight - 100) < 0.001, `Tier Gacha ${tier.id} harus memiliki total bobot 100% (ditemukan ${sumWeight})`);
        assert.ok(getItem(tier.ticketItemId), `Tiket Gacha ${tier.ticketItemId} untuk tier ${tier.id} harus terdaftar`);
        for (const entry of tier.lootTable) {
            assert.ok(RARITY_META[entry.rarity], `Rarity ${entry.rarity} tidak valid pada tier ${tier.id}`);
            if (entry.type === 'item') {
                assert.ok(getItem(entry.itemId), `Item Gacha ${entry.itemId} pada tier ${tier.id} harus terdaftar di data/items.js`);
            } else if (entry.type === 'vehicle') {
                assert.ok(getVehicle(entry.vehicleId), `Vehicle Gacha ${entry.vehicleId} pada tier ${tier.id} harus terdaftar di data/vehicles.js`);
            } else if (entry.type === 'title') {
                assert.ok(getGachaTitle(entry.titleId), `Title Gacha ${entry.titleId} pada tier ${tier.id} wajib terdaftar di GACHA_TITLES`);
            } else if (entry.type === 'clothing') {
                assert.ok(getClothing(entry.clothingId), `Clothing Gacha ${entry.clothingId} pada tier ${tier.id} wajib terdaftar di data/clothes.js`);
            }
        }
    }

    // Validasi Kendaraan Eksklusif Gacha (Vespa Klasik & Supercar Sport Sultan)
    const vespa = getVehicle('vespa_klasik');
    const sportCar = getVehicle('mobil_sport');
    assert.strictEqual(vespa.gachaExclusive, true);
    assert.strictEqual(vespa.canCredit, false);
    assert.strictEqual(sportCar.gachaExclusive, true);
    assert.strictEqual(sportCar.canCredit, false);

    // Vespa Klasik memberi bonus +40% shift Kurir/Ojol saat BBM cukup
    const vespaShiftBonus = calculateShiftVehicleBonus(
        { vehicle_id: 'vespa_klasik', fuel_liters: 4, odometer_km: 100, last_service_km: 0 },
        'ojek_online'
    );
    assert.strictEqual(vespaShiftBonus.active, true);
    assert.strictEqual(vespaShiftBonus.bonusMultiplier, 0.40);

    // Supercar Sport Sultan menghemat 4 Energy ke lokasi jauh ('laut')
    const sportTrip = calculateTripVehicleDiscount(
        { vehicle_id: 'mobil_sport', fuel_liters: 20, odometer_km: 200, last_service_km: 0 },
        'laut'
    );
    assert.strictEqual(sportTrip.active, true);
    assert.strictEqual(sportTrip.energyDiscount, 4);

    // Uji 10x Pull Rare+ Guarantee: jika rollFn selalu 0.0 (selalu jatuh ke entri Common pertama di pull 1-9),
    // pull ke-10 WAJIB ditarik dari pool Rare+ (Rare/Epic/Legendary)
    const batchGuaranteed = simulateGachaPullBatch(
        'warung',
        10,
        { ownedItemIds: [], ownedVehicleIds: [], unlockedTitleIds: [] },
        () => 0.0
    );
    assert.strictEqual(batchGuaranteed.results.length, 10);
    assert.strictEqual(batchGuaranteed.results[9].entry.guaranteedRarePlus, true, 'Pull ke-10 wajib memicu garansi Rare+ jika 9 pull awal Common/Uncommon');
    assert.strictEqual(
        isRareOrAbove(batchGuaranteed.results[9].entry.rarity),
        true,
        `Pull ke-10 harus minimal Rare (ditemukan ${batchGuaranteed.results[9].entry.rarity})`
    );

    // Uji Konversi Duplikat Otomatis menjadi Tiket Gacha
    assert.strictEqual(
        isUniquePrizeAlreadyOwned(
            { type: 'item', itemId: 'pancing_bambu' },
            { ownedItemIds: new Set(['pancing_bambu']), ownedVehicleIds: new Set(), unlockedTitleIds: new Set() }
        ),
        true,
        'Alat pancing yang sudah dimiliki harus terdeteksi sebagai duplikat unik'
    );
    const batchDup = simulateGachaPullBatch(
        'sultan',
        1,
        {
            ownedItemIds: [],
            ownedVehicleIds: ['mobil_sport'],
            unlockedTitleIds: []
        },
        () => 0.99 // Jatuh ke mobil_sport (Legendary: 98.5% - 99.25%) di tier sultan
    );
    assert.strictEqual(batchDup.results[0].isDuplicate, true, 'Kendaraan eksklusif yang sudah dimiliki harus otomatis menjadi duplikat');
    assert.strictEqual(
        batchDup.results[0].duplicateTickets,
        DUPLICATE_TICKET_YIELD[batchDup.results[0].entry.rarity],
        'Jumlah tiket kompensasi duplikat harus sesuai tabel rarity'
    );

    // Uji UI Panel /gacha (Machine mode, Pull Result mode, & Rates mode) <= 40 komponen & bebas "undefined"
    const gachaStateSample = {
        player: samplePlayer,
        bagRows: [{ item_id: 'tiket_gacha_warung', quantity: 3 }],
        slotsUsed: 5,
        ticketCounts: {
            tiket_gacha_warung: 3,
            tiket_gacha_mall: 0,
            tiket_gacha_sultan: 1
        },
        stats: {
            total_pulls: 12,
            warung_pulls: 10,
            mall_pulls: 1,
            sultan_pulls: 1,
            jackpot_count: 1,
            duplicate_tickets_earned: 2
        }
    };
    const gachaPanelMachine = buildGachaPanel({
        state: gachaStateSample,
        tierId: 'warung',
        mode: 'machine',
        lastPullResult: null,
        now: nowTs
    });
    const gachaPanelResult = buildGachaPanel({
        state: gachaStateSample,
        tierId: 'warung',
        mode: 'machine',
        lastPullResult: {
            ok: true,
            tier: getGachaTier('warung'),
            pullCount: 10,
            results: batchGuaranteed.results,
            ticketsUsed: 3,
            lpPaid: 175000,
            totalDuplicateTickets: batchGuaranteed.totalDuplicateTickets,
            jackpotHitCount: batchGuaranteed.jackpotHitCount
        },
        now: nowTs
    });
    const gachaPanelRates = buildGachaPanel({
        state: gachaStateSample,
        tierId: 'sultan',
        mode: 'rates',
        lastPullResult: null,
        now: nowTs
    });

    for (const [gName, gPanel] of [
        ['gacha (machine)', gachaPanelMachine],
        ['gacha (10x result)', gachaPanelResult],
        ['gacha (rates)', gachaPanelRates]
    ]) {
        assert((gPanel.flags & 32768) === 32768, `Panel /${gName} wajib menggunakan MessageFlags.IsComponentsV2`);
        const cCount = countV2Components(gPanel);
        assert(cCount <= 40, `Panel /${gName} melebihi batas 40 komponen (${cCount})`);
        const serialized = JSON.stringify(gPanel);
        assert(!serialized.includes('undefined'), `Panel /${gName} tidak boleh mengandung string "undefined"`);
    }
    console.log('✅ [21/22] Fitur /gacha: 3-Tier Mesin Kapsul, Garansi 10x Rare+, Konversi Duplikat & Panel V2 terverifikasi.');

    // ====================================================
    // 22. TEST AVATAR CHIBI 7-SLOT, COMPOSITING PNG, BUFF BUSANA, BUTIK /SHOP, /WARDROBE & /PROFILE THUMBNAIL
    // ====================================================
    const {
        normalizeEquippedOutfit,
        generateAvatarBuffer,
        buildAvatarAttachment,
        computeClothingBuffs,
        getJobClothingBonus
    } = require('../services/avatarService');
    const { buildShopPanel } = require('../services/shopService');
    const { buildWardrobePanel } = require('../commands/life/wardrobe');
    const { buildProfilePanel } = require('../commands/life/profile');
    const { countV2DisplayableText } = require('../utils/panelBuilder');

    assert.strictEqual(CLOTHING_SLOTS.length, 7, 'Sistem busana harus memiliki tepat 7 slot modular');
    assert(CLOTHES.length >= 35, `Katalog pakaian harus memiliki minimal 35 item (ditemukan ${CLOTHES.length})`);
    for (const c of CLOTHES) {
        const assetFile = getClothingAssetPath(c);
        assert.ok(assetFile && fs.existsSync(assetFile), `File sprite PNG untuk ${c.id} tidak ditemukan di ${assetFile}`);
    }

    // Uji komposisi gambar PNG karakter chibi polos vs setelan Sultan
    const defaultOutfit = normalizeEquippedOutfit(null);
    assert.strictEqual(defaultOutfit.body, 'chibi_body_light');
    assert.strictEqual(defaultOutfit.top, null, 'Default avatar harus tampil polos tanpa baju');

    const polosAvatar = await buildAvatarAttachment(defaultOutfit);
    assert.ok(Buffer.isBuffer(polosAvatar.buffer) && polosAvatar.buffer.length > 1000, 'Buffer PNG avatar polos harus valid');
    assert.strictEqual(polosAvatar.buffer.subarray(0, 4).toString('hex'), '89504e47', 'Output @napi-rs/canvas harus berupa PNG valid');
    assert(polosAvatar.url.startsWith('attachment://avatar_'), 'URL avatar harus berupa skema attachment://avatar_<hash>.png');

    const sultanOutfit = {
        body: 'chibi_body_medium',
        hair: 'hair_wavy_gold',
        hat: 'hat_crown_sultan',
        top: 'top_suit_sultan',
        bottom: 'bottom_sultan_gold',
        shoes: 'shoes_hype_neon',
        accessory: 'acc_sunglasses_aviator'
    };
    const sultanAvatar = await buildAvatarAttachment(sultanOutfit);
    assert.notStrictEqual(sultanAvatar.fileName, polosAvatar.fileName, 'Hash nama file PNG harus berubah saat pakaian diganti (anti-cache Discord)');
    const cachedBuf = await generateAvatarBuffer(sultanOutfit);
    assert.strictEqual(cachedBuf, sultanAvatar.buffer, 'Render cache RAM harus mengembalikan buffer yang sama untuk kombinasi identik');

    // Uji kalkulasi buff pasif busana & batas cap
    const ojolOutfitBuffs = computeClothingBuffs({
        body: 'chibi_body_light',
        hair: 'hair_short_black',
        hat: 'hat_helm_proyek',
        top: 'top_ojol_jacket',
        bottom: 'bottom_cargo_olive',
        shoes: 'shoes_boots_brown',
        accessory: 'acc_headphones'
    });
    assert.strictEqual(getJobClothingBonus(ojolOutfitBuffs, 'ojek_online'), 0.09, 'Jaket Ojol (+6%) + Headphone (+3%) harus memberi +9% gaji Ojol');
    assert.strictEqual(getJobClothingBonus(ojolOutfitBuffs, 'kasir_minimarket'), 0.03, 'Profesi lain tetap mendapat +3% umum dari Headphone');
    assert.strictEqual(ojolOutfitBuffs.miningAccidentReduction, 0.20, 'Helm Proyek harus mengurangi risiko tambang 20%');

    const farmerAnglerBuffs = computeClothingBuffs({
        body: 'chibi_body_light',
        hair: 'hair_short_black',
        hat: 'hat_straw_farmer',
        top: 'top_raincoat_yellow',
        bottom: 'bottom_shorts_black',
        shoes: 'shoes_sandal_jepit',
        accessory: null
    });
    assert.strictEqual(farmerAnglerBuffs.farmingXpBonus, 0.10, 'Topi Jerami Petani harus memberi +10% Farming EXP');
    assert.strictEqual(farmerAnglerBuffs.fishingXpBonus, 0.10, 'Jas Hujan Anti-Badai harus memberi +10% Fishing EXP');

    // Uji Duplikat Pakaian di Gacha otomatis dikonversi menjadi tiket
    assert.strictEqual(
        isUniquePrizeAlreadyOwned(
            { type: 'clothing', clothingId: 'hat_crown_sultan' },
            {
                ownedItemIds: new Set(),
                ownedVehicleIds: new Set(),
                unlockedTitleIds: new Set(),
                ownedClothingIds: new Set(['hat_crown_sultan'])
            }
        ),
        true,
        'Pakaian eksklusif Gacha yang sudah ada di lemari harus otomatis terdeteksi duplikat'
    );

    // Uji Panel /wardrobe, /profile (dengan thumbnail avatar), & /shop (Butik Busana)
    const sampleWardrobeState = {
        ownedSet: new Set([...STARTER_CLOTHING_IDS, 'top_suit_sultan', 'hat_crown_sultan', 'acc_sunglasses_aviator']),
        ownedCount: STARTER_CLOTHING_IDS.length + 3,
        totalCatalogCount: CLOTHES.length,
        equipped: sultanOutfit,
        buffs: computeClothingBuffs(sultanOutfit)
    };

    const wardrobePanel = buildWardrobePanel({
        ownerId: samplePlayer.discord_id,
        state: {
            player: samplePlayer,
            wardrobe: sampleWardrobeState,
            avatar: sultanAvatar
        },
        selectedSlot: 'top',
        now: nowTs
    });

    const profileWithAvatarPanel = buildProfilePanel({
        ownerId: samplePlayer.discord_id,
        data: {
            player: {
                ...samplePlayer,
                education_level: 'SMA',
                backpack_tier: 1,
                fishing_xp: 25,
                mining_xp: 60,
                farming_xp: 0,
                cooking_xp: 0,
                max_slots: 20,
                total_shifts: 10,
                daily_streak: 3,
                created_at: nowTs - 86400000,
                hospital_until: 0,
                sleeping_until: 0
            },
            buffs: [],
            slotsUsed: 4,
            propStatus: { effectiveTier: getPropertyTier('kos'), row: { ownership_type: 'rent' } },
            equippedVehicle: null,
            jobShifts: 0,
            achEval: { unlockedCount: 3, totalCount: 27, claimableCount: 1 },
            gachaStats: { total_pulls: 15, jackpot_count: 1 },
            wardrobe: sampleWardrobeState,
            avatar: sultanAvatar,
            collections: ['ikan_nila']
        },
        now: nowTs
    });

    const shopBusanaPanel = buildShopPanel({
        state: {
            player: { ...samplePlayer, backpack_tier: 1, max_slots: 20 },
            invRows: [],
            ownedClothesSet: sampleWardrobeState.ownedSet,
            slotsUsed: 2,
            liveCfg: { shop_price_multiplier: 1.0 }
        },
        shopId: 'busana',
        page: 1,
        now: nowTs
    });

    assert.strictEqual(Array.isArray(wardrobePanel.files) && wardrobePanel.files.length, 1, 'Panel /wardrobe wajib menyertakan 1 file attachment avatar');
    assert.strictEqual(Array.isArray(profileWithAvatarPanel.files) && profileWithAvatarPanel.files.length, 1, 'Panel /profile wajib menyertakan 1 file attachment avatar');

    for (const [pName, pObj] of [
        ['wardrobe', wardrobePanel],
        ['profile (chibi avatar)', profileWithAvatarPanel],
        ['shop (butik busana)', shopBusanaPanel]
    ]) {
        assert((pObj.flags & 32768) === 32768, `Panel /${pName} wajib menggunakan MessageFlags.IsComponentsV2`);
        const cCount = countV2Components(pObj);
        const tLen = countV2DisplayableText(pObj);
        assert(cCount <= 40, `Panel /${pName} melebihi batas 40 komponen (${cCount})`);
        assert(tLen <= 4000, `Panel /${pName} melebihi batas 4000 karakter (${tLen})`);
        const rawJson = JSON.stringify(pObj.components.map(c => c.toJSON()));
        assert(!rawJson.includes('undefined'), `Panel /${pName} tidak boleh mengandung string "undefined"`);
    }
    console.log('✅ [22/23] Fitur Avatar Chibi 7-Slot, Compositing PNG, Buff Busana, Butik /shop, /wardrobe & Thumbnail /profile terverifikasi.');

    // ====================================================
    // 23. TEST SISTEM MULTI-KOTA, /TRAVEL, SUPIR & LOCKDOWN PERJALANAN
    // ====================================================
    const {
        getAllCities,
        calculateCityRoute,
        calculateTravelVitalCost,
        isCommandAllowedDuringTravel,
        MOTEL_TRANSIT_CONFIG
    } = require('../data/cities');
    const { calculateIntercityFuelNeeded } = require('../data/vehicles');
    const { isJobAllowedInCity, JOBS } = require('../data/jobs');
    const {
        validateTravelAttempt,
        buildTravelStatusInterceptPanel,
        buildCityGatePanel
    } = require('../services/cityService');
    const { buildTravelPanel } = require('../commands/life/travel');
    const { buildSleepPanel } = require('../commands/life/sleep');

    // A. Verifikasi 3 kota linear & aditivitas jarak/waktu/stat Barat <-> Sentral <-> Timur
    assert.strictEqual(getAllCities().length, 3, 'Harus ada tepat 3 kota di katalog');
    assert.strictEqual(Object.keys(JOBS).length, 22, 'Katalog pekerjaan harus memiliki 22 profesi (18 dasar + 4 regional)');

    const routeBaratSentral = calculateCityRoute('kota_barat', 'kota_sentral');
    const routeSentralTimur = calculateCityRoute('kota_sentral', 'kota_timur');
    const routeBaratTimur = calculateCityRoute('kota_barat', 'kota_timur');
    const routeTimurBarat = calculateCityRoute('kota_timur', 'kota_barat');

    assert.strictEqual(routeBaratSentral.distanceKm, 30);
    assert.strictEqual(routeBaratSentral.durationSec, 60);
    assert.strictEqual(routeBaratSentral.driverFareLp, 15000);
    assert.strictEqual(routeBaratSentral.passesCentral, false);

    assert.strictEqual(routeSentralTimur.distanceKm, 45);
    assert.strictEqual(routeSentralTimur.durationSec, 90);
    assert.strictEqual(routeSentralTimur.driverFareLp, 22500);
    assert.strictEqual(routeSentralTimur.passesCentral, false);

    assert.strictEqual(routeBaratTimur.distanceKm, routeBaratSentral.distanceKm + routeSentralTimur.distanceKm, 'Jarak Barat->Timur wajib aditif (30+45 = 75 km)');
    assert.strictEqual(routeBaratTimur.durationSec, 150);
    assert.strictEqual(routeBaratTimur.driverFareLp, 35000);
    assert.strictEqual(routeBaratTimur.passesCentral, true);
    assert.strictEqual(routeTimurBarat.distanceKm, 75);
    assert.strictEqual(routeTimurBarat.passesCentral, true);

    assert.strictEqual(
        routeBaratTimur.selfDriveVitalCost.energy,
        routeBaratSentral.selfDriveVitalCost.energy + routeSentralTimur.selfDriveVitalCost.energy,
        'Pengurangan Energy 75 km wajib aditif (12 + 18 = 30)'
    );
    assert.strictEqual(
        routeBaratTimur.selfDriveVitalCost.hunger,
        routeBaratSentral.selfDriveVitalCost.hunger + routeSentralTimur.selfDriveVitalCost.hunger,
        'Pengurangan Hunger 75 km wajib aditif (8 + 12 = 20)'
    );
    assert.strictEqual(
        routeBaratTimur.selfDriveVitalCost.thirst,
        routeBaratSentral.selfDriveVitalCost.thirst + routeSentralTimur.selfDriveVitalCost.thirst,
        'Pengurangan Thirst 75 km wajib aditif (10 + 15 = 25)'
    );
    assert.deepStrictEqual(calculateTravelVitalCost(75, true), { energy: 0, hunger: 0, thirst: 0 }, 'Pakai supir wajib 0 pengurangan stat vital');

    // B. Verifikasi kebutuhan BBM antar-kota
    assert.strictEqual(calculateIntercityFuelNeeded('sepeda', 30), 0);
    assert.strictEqual(calculateIntercityFuelNeeded('motor_bekas', 30), 0.60);
    assert.strictEqual(calculateIntercityFuelNeeded('motor_bekas', 75), 1.50);
    assert.strictEqual(calculateIntercityFuelNeeded('mobil', 30), 2.00);
    assert.strictEqual(calculateIntercityFuelNeeded('mobil', 75), 5.00);
    assert.strictEqual(calculateIntercityFuelNeeded('mobil_sport', 75), 6.00);

    // C. Verifikasi validator keberangkatan (/travel): Sepeda, SIM, BBM, Energy, & Supir Mobil
    const travelPlayerBase = {
        ...samplePlayer,
        current_city: 'kota_sentral',
        traveling_until: 0,
        hospital_until: 0,
        sleeping_until: 0,
        energy: 80,
        hunger: 80,
        thirst: 80,
        cash: 200000,
        bank: 0
    };

    const rejBicycle = validateTravelAttempt({
        player: travelPlayerBase,
        equippedVehicleRow: { vehicle_id: 'sepeda', fuel_liters: 0 },
        invRows: [],
        toCityId: 'kota_barat',
        now: nowTs
    });
    assert.strictEqual(rejBicycle.ok, false);
    assert.strictEqual(rejBicycle.error, 'BICYCLE_NOT_ALLOWED');

    const rejNoSimC = validateTravelAttempt({
        player: travelPlayerBase,
        equippedVehicleRow: { vehicle_id: 'motor_bekas', fuel_liters: 4.0 },
        invRows: [],
        toCityId: 'kota_barat',
        now: nowTs
    });
    assert.strictEqual(rejNoSimC.ok, false);
    assert.strictEqual(rejNoSimC.error, 'MISSING_LICENSE');

    const rejLowFuel = validateTravelAttempt({
        player: travelPlayerBase,
        equippedVehicleRow: { vehicle_id: 'motor_bekas', fuel_liters: 0.2 },
        invRows: [{ item_id: 'sim_c', quantity: 1 }],
        toCityId: 'kota_barat',
        now: nowTs
    });
    assert.strictEqual(rejLowFuel.ok, false);
    assert.strictEqual(rejLowFuel.error, 'INSUFFICIENT_FUEL');

    const rejLowEnergy = validateTravelAttempt({
        player: { ...travelPlayerBase, energy: 10 },
        equippedVehicleRow: { vehicle_id: 'motor_bekas', fuel_liters: 4.0 },
        invRows: [{ item_id: 'sim_c', quantity: 1 }],
        toCityId: 'kota_barat',
        now: nowTs
    });
    assert.strictEqual(rejLowEnergy.ok, false);
    assert.strictEqual(rejLowEnergy.error, 'INSUFFICIENT_ENERGY');

    // Mobil + Sewa Supir sekali jalan: tidak wajib punya SIM A, stat vital utuh (0), bayar ongkos Rp 15.000
    const okCarTripDriver = validateTravelAttempt({
        player: { ...travelPlayerBase, energy: 5 }, // walau energy rendah tetap boleh disopiri!
        equippedVehicleRow: { vehicle_id: 'mobil', fuel_liters: 10.0, driver_hired_until: 0 },
        invRows: [], // tanpa sim_a
        toCityId: 'kota_barat',
        hireDriverTrip: true,
        now: nowTs
    });
    assert.strictEqual(okCarTripDriver.ok, true);
    assert.strictEqual(okCarTripDriver.effectiveHasDriver, true);
    assert.strictEqual(okCarTripDriver.driverFeeToPay, 15000);
    assert.deepStrictEqual(okCarTripDriver.vitalCost, { energy: 0, hunger: 0, thirst: 0 });

    // Mobil + Kontrak Supir Mingguan aktif: ongkos supir gratis (0)
    const okCarWeeklyDriver = validateTravelAttempt({
        player: travelPlayerBase,
        equippedVehicleRow: { vehicle_id: 'mobil_sport', fuel_liters: 20.0, driver_hired_until: nowTs + 86400000 },
        invRows: [],
        toCityId: 'kota_timur',
        hireDriverTrip: true,
        now: nowTs
    });
    assert.strictEqual(okCarWeeklyDriver.ok, true);
    assert.strictEqual(okCarWeeklyDriver.hasWeeklyContract, true);
    assert.strictEqual(okCarWeeklyDriver.driverFeeToPay, 0);

    // D. Verifikasi Lazy Settlement Kedatangan & Motel Transit (+60 Energy) di computeLazyVitals
    const arrivedEval = computeLazyVitals({
        ...travelPlayerBase,
        current_city: 'kota_barat',
        travel_origin: 'kota_barat',
        travel_destination: 'kota_timur',
        traveling_until: nowTs - 1000,
        travel_has_driver: 1,
        last_tick_at: nowTs
    }, nowTs, []);
    assert.strictEqual(arrivedEval.current_city, 'kota_timur', 'Lazy settlement wajib memindahkan current_city ke travel_destination saat tiba');
    assert.strictEqual(arrivedEval.traveling_until, 0);
    assert.strictEqual(arrivedEval.arrivedCity, 'kota_timur');

    const motelWakeEval = computeLazyVitals({
        ...travelPlayerBase,
        current_city: 'kota_barat',
        energy: 25,
        sleeping_until: nowTs - 500,
        last_tick_at: nowTs
    }, nowTs, [{ buff_type: 'motel_sleep', multiplier: MOTEL_TRANSIT_CONFIG.energyBonus, expires_at: nowTs + 60000 }]);
    assert.strictEqual(motelWakeEval.wokeUp, true);
    assert.strictEqual(motelWakeEval.energy, 85, 'Bangun dari Motel Transit (+60 ⚡) dari 25 harus menjadi 85');

    // E. Verifikasi Lockdown Perjalanan & Pembatasan Kota Pekerjaan
    assert.strictEqual(isCommandAllowedDuringTravel('travel', false), true);
    assert.strictEqual(isCommandAllowedDuringTravel('work', false), false);
    assert.strictEqual(isCommandAllowedDuringTravel('consume', false), false, 'Menyetir sendiri tidak boleh /consume');
    assert.strictEqual(isCommandAllowedDuringTravel('consume', true), true, 'Penumpang dengan supir boleh /consume');
    assert.strictEqual(isCommandAllowedDuringTravel('profile', true), true);
    assert.strictEqual(isCommandAllowedDuringTravel('wardrobe', true), true);
    assert.strictEqual(isCommandAllowedDuringTravel('inventory', true), true);
    assert.strictEqual(isCommandAllowedDuringTravel('hp', true), true, 'Hook masa depan hp harus diizinkan saat pakai supir');
    assert.strictEqual(isCommandAllowedDuringTravel('laptop', true), true, 'Hook masa depan laptop harus diizinkan saat pakai supir');
    assert.strictEqual(isCommandAllowedDuringTravel('work', true), false, 'Penumpang dengan supir tetap tidak boleh /work');
    assert.strictEqual(isCommandAllowedDuringTravel('mining', true), false);

    assert.strictEqual(isJobAllowedInCity('buruh_tambang', 'kota_barat'), true);
    assert.strictEqual(isJobAllowedInCity('buruh_tambang', 'kota_sentral'), false);
    assert.strictEqual(isJobAllowedInCity('petani_sayur', 'kota_timur'), true);
    assert.strictEqual(isJobAllowedInCity('programmer', 'kota_sentral'), true);
    assert.strictEqual(isJobAllowedInCity('programmer', 'kota_timur'), false);
    assert.strictEqual(isJobAllowedInCity('ojek_online', 'kota_barat'), true);
    assert.strictEqual(isJobAllowedInCity('ojek_online', 'kota_timur'), true);

    // F. Verifikasi Panel V2 (/travel stasioner, /travel transit aktif, Intercept, City Gate, & /sleep Motel Transit)
    const travelStationaryPanel = buildTravelPanel({
        state: {
            player: travelPlayerBase,
            arrivedCity: null,
            equipped: {
                vehicle_id: 'mobil',
                vehicle: getVehicle('mobil'),
                fuel_liters: 30,
                odometer_km: 120,
                driver_hired_until: 0,
                hasActiveDriverContract: false
            },
            invRows: [{ item_id: 'sim_a', quantity: 1 }]
        },
        selectedDestId: 'kota_timur',
        hireDriverTrip: true,
        now: nowTs
    });

    const travelInTransitPanel = buildTravelPanel({
        state: {
            player: {
                ...travelPlayerBase,
                current_city: 'kota_barat',
                travel_origin: 'kota_barat',
                travel_destination: 'kota_timur',
                traveling_until: nowTs + 90_000,
                travel_has_driver: 1
            },
            arrivedCity: null,
            equipped: {
                vehicle_id: 'mobil_sport',
                vehicle: getVehicle('mobil_sport'),
                fuel_liters: 40,
                odometer_km: 500,
                driver_hired_until: nowTs + 86400000,
                hasActiveDriverContract: true
            },
            invRows: []
        },
        now: nowTs
    });

    const travelInterceptPanel = buildTravelStatusInterceptPanel({
        player: {
            ...travelPlayerBase,
            travel_origin: 'kota_sentral',
            travel_destination: 'kota_barat',
            traveling_until: nowTs + 45_000,
            travel_has_driver: 0
        },
        blockedCommand: 'work',
        now: nowTs
    });

    const cityGateSamplePanel = buildCityGatePanel({
        player: travelPlayerBase,
        requiredCityId: 'kota_barat',
        facilityTitle: 'Pertambangan & Galian (/mining)',
        now: nowTs
    });

    const sleepAwayMotelPanel = buildSleepPanel({
        state: {
            player: { ...travelPlayerBase, current_city: 'kota_barat', energy: 40 },
            propStatus: {
                row: { ownership_type: 'rent', city_id: 'kota_sentral' },
                isEvicted: false,
                propertyCityId: 'kota_sentral',
                effectiveTier: getPropertyTier('apartemen')
            }
        },
        now: nowTs
    });

    for (const [pName, pObj] of [
        ['travel (stationary)', travelStationaryPanel],
        ['travel (in-transit)', travelInTransitPanel],
        ['travel (lockdown intercept)', travelInterceptPanel],
        ['city gate (/mining)', cityGateSamplePanel],
        ['sleep (motel transit)', sleepAwayMotelPanel]
    ]) {
        assert((pObj.flags & 32768) === 32768, `Panel ${pName} wajib menggunakan MessageFlags.IsComponentsV2`);
        const cCount = countV2Components(pObj);
        const tLen = countV2DisplayableText(pObj);
        assert(cCount <= 40, `Panel ${pName} melebihi batas 40 komponen (${cCount})`);
        assert(tLen <= 4000, `Panel ${pName} melebihi batas 4000 karakter (${tLen})`);
        const rawJson = JSON.stringify(pObj.components.map(c => c.toJSON()));
        assert(!rawJson.includes('undefined'), `Panel ${pName} tidak boleh mengandung string "undefined"`);
    }
    console.log('✅ [23/24] Sistem Multi-Kota Linear, /travel, BBM & Durasi, Supir Mobil, Lockdown Perjalanan, City Gate & Motel Transit terverifikasi.');

    // ====================================================
    // 24. TEST AUTO-UPDATE SERVICE, LIVE PANEL SYNC & PENGHAPUSAN TOMBOL SEGARKAN
    // ====================================================
    const {
        scheduleAutoUpdate,
        cancelAutoUpdate,
        clearAllAutoUpdates,
        getAutoUpdateEntry,
        registerPanelRenderer,
        trackInteractionPanel,
        setPanelMinigameLock,
        flushPlayerPanelSync,
        getActivePanelEntry
    } = require('../services/autoUpdateService');

    // A. Pengujian lifecycle timer autoUpdateService
    clearAllAutoUpdates();
    let firstFired = false;
    let replacedPayload = null;
    const mockInteraction = {
        editReply: async (p) => { replacedPayload = p; }
    };

    scheduleAutoUpdate('test:123', mockInteraction, 50, async () => {
        firstFired = true;
        return { updated: true };
    });
    assert.ok(getAutoUpdateEntry('test:123'), 'Timer harus terdaftar di autoUpdateService');

    // Menjadwalkan ulang dengan key yang sama harus membatalkan timer lama
    scheduleAutoUpdate('test:123', mockInteraction, 60, async () => {
        return { replaced: true };
    });
    assert.ok(getAutoUpdateEntry('test:123'));

    // Tunggu timer berjalan
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.strictEqual(firstFired, false, 'Callback timer lama tidak boleh dieksekusi setelah diganti');
    assert.deepStrictEqual(replacedPayload, { replaced: true }, 'Callback timer baru harus dieksekusi tepat waktu');
    assert.strictEqual(getAutoUpdateEntry('test:123'), null, 'Entry harus otomatis dihapus setelah selesai');

    // Pengujian pembatalan eksplisit
    let cancelledFired = false;
    scheduleAutoUpdate('test:cancel', mockInteraction, 100, async () => { cancelledFired = true; });
    const cancelRes = cancelAutoUpdate('test:cancel');
    assert.strictEqual(cancelRes, true, 'cancelAutoUpdate harus mengembalikan true');
    assert.strictEqual(getAutoUpdateEntry('test:cancel'), null);
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.strictEqual(cancelledFired, false, 'Timer yang dibatalkan tidak boleh dieksekusi');

    // B. Pengujian prioritas `message.edit()` (Bot Token permanen > 15 menit) di atas `editReply()`
    let msgEditCalledWith = null;
    let editReplyCalled = false;
    const mockLongInteraction = {
        fetchReply: async () => ({
            id: 'msg_sleep_60m',
            edit: async (p) => { msgEditCalledWith = p; }
        }),
        editReply: async () => { editReplyCalled = true; }
    };
    scheduleAutoUpdate('test:long_sleep', mockLongInteraction, 30, async () => ({ wokeUp: true }));
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.deepStrictEqual(msgEditCalledWith, { wokeUp: true }, 'Harus menggunakan message.edit() dari fetchReply() agar bebas batas 15 menit');
    assert.strictEqual(editReplyCalled, false, 'Tidak boleh memanggil editReply() jika message.edit() tersedia');

    // C. Pengujian Cross-Panel Live Sync & Minigame Lock Guard
    clearAllAutoUpdates();
    let syncedProfilePayload = null;
    let syncedFishingPayload = null;
    registerPanelRenderer('profile', async (uid) => ({ panel: 'profile', uid, cash: 250000 }));
    registerPanelRenderer('fishing', async (uid) => ({ panel: 'fishing', uid }));
    registerPanelRenderer('bank', async (uid) => ({ panel: 'bank', uid }));

    const profileMsg = { id: 'msg_prof_1', edit: async (p) => { syncedProfilePayload = p; } };
    const fishingMsg = { id: 'msg_fish_1', edit: async (p) => { syncedFishingPayload = p; } };
    const bankMsg = { id: 'msg_bank_1', edit: async () => {} };

    trackInteractionPanel('u_sync_1', 'profile', { message: profileMsg });
    trackInteractionPanel('u_sync_1', 'fishing', { message: fishingMsg });
    trackInteractionPanel('u_sync_1', 'bank', { message: bankMsg });
    assert.ok(getActivePanelEntry('u_sync_1', 'profile'), 'Panel profile harus tercatat di activePanels');

    // Kunci fishing karena sedang mini-game
    setPanelMinigameLock('u_sync_1', 'fishing', true);
    await flushPlayerPanelSync('u_sync_1', 'bank');

    assert.deepStrictEqual(syncedProfilePayload, { panel: 'profile', uid: 'u_sync_1', cash: 250000 }, 'Panel /profile yang terbuka harus otomatis di-edit saat state berubah di /bank');
    assert.strictEqual(syncedFishingPayload, null, 'Panel /fishing yang sedang minigameLocked tidak boleh ditimpa');

    setPanelMinigameLock('u_sync_1', 'fishing', false);
    await flushPlayerPanelSync('u_sync_1', 'bank');
    assert.deepStrictEqual(syncedFishingPayload, { panel: 'fishing', uid: 'u_sync_1' }, 'Panel /fishing harus ikut tersinkronisasi setelah minigame selesai');
    clearAllAutoUpdates();

    // D. Verifikasi bahwa tidak ada lagi tombol 'Segarkan' atau 'Cek Ulang Tas' di SELURUH 35 command (termasuk /admin)
    for (const f of cmdFiles) {
        const fileContent = fs.readFileSync(f, 'utf8');
        const matchRefresh = fileContent.match(/label:\s*['"]Segarkan\b[^'"]*['"]/i);
        assert(!matchRefresh, `Berkas ${f} masih mengandung tombol dengan label Segarkan: ${matchRefresh ? matchRefresh[0] : ''}`);
        const matchCekUlang = fileContent.match(/label:\s*['"]Cek Ulang Tas['"]/i);
        assert(!matchCekUlang, `Berkas ${f} masih mengandung tombol dengan label Cek Ulang Tas`);
    }
    console.log('✅ [24/26] Auto-Update Service (Bot Token message.edit, Cross-Panel Live Sync, & 0 Tombol Segarkan di 35 Command) terverifikasi.');

    // ====================================================
    // 25. TEST REDESIGN /PROFILE: MEDIA GALLERY, HIDE HUD, CANVAS BANNER 800x280, 2 TAB & MODE INSPEKSI
    // ====================================================
    const { assertComponentLimit } = require('../utils/panelBuilder');
    const { getHighestEquippedRarity } = require('../services/avatarService');
    const {
        BANNER_WIDTH,
        BANNER_HEIGHT,
        CITY_THEMES,
        stripEmojiForCanvas,
        clearProfileBannerCache,
        generateProfileBannerBuffer,
        buildProfileBannerAttachment
    } = require('../services/profileBannerService');

    assert.strictEqual(typeof getHighestEquippedRarity, 'function', 'getHighestEquippedRarity wajib di-export dari avatarService');
    assert.strictEqual(getHighestEquippedRarity(sultanOutfit), 'legendary');
    assert.strictEqual(stripEmojiForCanvas('👑 Sultan Raya'), 'Sultan Raya');

    // A. MediaGalleryBuilder & penghapusan Mini-HUD global pada uiBuilder/panelBuilder
    const mediaV2 = buildV2Card({
        accentColor: COLORS.PRIMARY,
        blocks: [
            { image: { url: 'attachment://hero.png', description: 'Hero Banner', spoiler: false } },
            { gallery: [{ url: 'attachment://a.png' }, { url: 'attachment://b.png', description: 'B' }] }
        ]
    });
    const mediaV2Json = mediaV2.components[0].toJSON();
    const galleryBlocks = mediaV2Json.components.filter(c => c.type === 12);
    assert.strictEqual(galleryBlocks.length, 2, 'buildV2Card wajib menghasilkan MediaGallery (type 12) untuk image & gallery');
    assert.strictEqual(galleryBlocks[0].items[0].media.url, 'attachment://hero.png');
    assert.strictEqual(galleryBlocks[1].items.length, 2);

    assert.strictEqual(countV2Components({ blocks: [{ image: { url: 'attachment://hero.png' } }] }), 3);
    assert.strictEqual(countV2Components({ blocks: [{ gallery: [{ url: 'attachment://a.png' }, { url: 'attachment://b.png' }] }] }), 4);

    assert.throws(
        () => assertComponentLimit({ blocks: [{ image: { url: 'attachment://undefined.png' } }] }),
        /undefined/,
        'assertComponentLimit wajib menolak "undefined" pada image.url'
    );
    assert.throws(
        () => assertComponentLimit({ blocks: [{ gallery: [{ url: 'attachment://ok.png', description: 'foo undefined bar' }] }] }),
        /undefined/,
        'assertComponentLimit wajib menolak "undefined" pada gallery description'
    );

    const panelWithPlayer = buildPanel({
        mod: 'test',
        ownerId: samplePlayer.discord_id,
        title: 'Panel Uji',
        player: samplePlayer,
        blocks: ['Isi'],
        now: nowTs
    });
    const panelConfirm = require('../utils/panelBuilder').confirmView({
        mod: 'test',
        confirmAction: 'yes',
        ownerId: samplePlayer.discord_id,
        title: 'Konfirmasi Uji',
        description: 'Yakin?',
        player: samplePlayer,
        now: nowTs
    });
    const panelWithPlayerJson = panelWithPlayer.components[0].toJSON();
    assert(!JSON.stringify(panelWithPlayerJson).includes('Tester'), 'buildPanel wajib menghilangkan Mini-HUD di semua command');
    assert.strictEqual(panelWithPlayerJson.components[1].type, 14, 'Separator di bawah judul panel wajib dipertahankan');
    assert(!JSON.stringify(panelConfirm.components[0].toJSON()).includes('Tester'), 'confirmView wajib ikut menghilangkan Mini-HUD');

    // B. Wide Identity Banner 800x280 Canvas & Tema Kota Dinamis + Cache LRU
    clearProfileBannerCache();
    const profilePlayerBase = {
        ...samplePlayer,
        current_city: 'kota_barat',
        current_job: 'buruh_tambang',
        education_level: 'SMA',
        backpack_tier: 1,
        fishing_xp: 25,
        mining_xp: 60,
        farming_xp: 0,
        cooking_xp: 0,
        max_slots: 20,
        total_shifts: 40,
        daily_streak: 7,
        created_at: nowTs - 15 * 86400000,
        hospital_until: 0,
        sleeping_until: 0,
        traveling_until: 0
    };
    const bannerBarat = await buildProfileBannerAttachment({
        player: profilePlayerBase,
        jobShifts: 40,
        wardrobe: sampleWardrobeState
    }, nowTs);
    assert.strictEqual(bannerBarat.buffer.subarray(0, 4).toString('hex'), '89504e47', 'Banner profil harus berupa PNG valid');
    assert.strictEqual(bannerBarat.buffer.readUInt32BE(16), BANNER_WIDTH, 'Lebar PNG banner wajib 800 px');
    assert.strictEqual(bannerBarat.buffer.readUInt32BE(20), BANNER_HEIGHT, 'Tinggi PNG banner wajib 280 px');
    assert(bannerBarat.url.startsWith('attachment://profile_'), 'URL banner wajib memakai format attachment://profile_<hash>.png');
    assert.strictEqual(bannerBarat.cityTheme.containerColor, CITY_THEMES.kota_barat.containerColor);

    const cachedBannerBuf = await generateProfileBannerBuffer({
        player: profilePlayerBase,
        jobShifts: 40,
        wardrobe: sampleWardrobeState
    }, nowTs);
    assert.strictEqual(cachedBannerBuf, bannerBarat.buffer, 'Cache LRU banner harus mengembalikan buffer identik');

    const bannerSentral = await buildProfileBannerAttachment({
        player: { ...profilePlayerBase, current_city: 'kota_sentral' },
        jobShifts: 40,
        wardrobe: sampleWardrobeState
    }, nowTs);
    const bannerTimur = await buildProfileBannerAttachment({
        player: { ...profilePlayerBase, current_city: 'kota_timur' },
        jobShifts: 40,
        wardrobe: sampleWardrobeState
    }, nowTs);
    assert.notStrictEqual(bannerBarat.fileName, bannerSentral.fileName, 'Perpindahan kota harus menghasilkan hash banner baru');
    assert.notStrictEqual(bannerSentral.fileName, bannerTimur.fileName, 'Setiap kota harus menghasilkan hash banner unik');
    assert.strictEqual(bannerSentral.cityTheme.containerColor, 0x6366F1);
    assert.strictEqual(bannerTimur.cityTheme.containerColor, 0x10B981);

    // C. Panel /profile Mode Tab Life, Tab Progress, & Mode Inspeksi Warga Lain
    const fullProfileData = {
        player: profilePlayerBase,
        buffs: [],
        slotsUsed: 5,
        propStatus: { effectiveTier: getPropertyTier('kos'), propertyCityId: 'kota_barat', row: { ownership_type: 'rent' } },
        equippedVehicle: null,
        jobShifts: 40,
        achEval: { unlockedCount: 4, totalCount: 27, claimableCount: 2 },
        gachaStats: { total_pulls: 10, jackpot_count: 1 },
        wardrobe: sampleWardrobeState,
        bannerImage: bannerBarat,
        collections: ['ikan_nila']
    };

    const profileTabLife = buildProfilePanel({
        ownerId: profilePlayerBase.discord_id,
        targetId: profilePlayerBase.discord_id,
        data: fullProfileData,
        page: 'life',
        now: nowTs
    });
    const profileTabProgress = buildProfilePanel({
        ownerId: profilePlayerBase.discord_id,
        targetId: profilePlayerBase.discord_id,
        data: fullProfileData,
        page: 'progress',
        now: nowTs
    });

    const targetIdOther = '999888777666555444';
    const targetPlayerOther = {
        ...profilePlayerBase,
        discord_id: targetIdOther,
        username: 'Warga_Lain',
        current_city: 'kota_timur'
    };
    const bannerOther = await buildProfileBannerAttachment({
        player: targetPlayerOther,
        jobShifts: 40,
        wardrobe: sampleWardrobeState
    }, nowTs);
    const profileInspectOther = buildProfilePanel({
        ownerId: profilePlayerBase.discord_id,
        targetId: targetIdOther,
        data: { ...fullProfileData, player: targetPlayerOther, bannerImage: bannerOther },
        page: 'life',
        banner: { type: 'info', text: 'Menampilkan profil **Warga_Lain**.' },
        now: nowTs
    });

    // Verifikasi struktur khusus masing-masing mode
    const lifeJson = profileTabLife.components[0].toJSON();
    assert.strictEqual(lifeJson.accent_color, CITY_THEMES.kota_barat.containerColor);
    const lifeStr = JSON.stringify(lifeJson);
    assert(lifeStr.includes(bannerBarat.url), 'Tab life wajib memuat bannerImage di MediaGallery');
    assert(lifeStr.includes('RINCIAN KEUANGAN') && lifeStr.includes('Cash') && lifeStr.includes('Bank'), 'Tab life wajib memuat Cash & Bank');
    assert(!lifeStr.includes('❤️ **100**'), 'Panel /profile tidak boleh menyisipkan Mini-HUD duplikat');
    assert(lifeStr.includes(`profile:refresh:${profilePlayerBase.discord_id}:`) && lifeStr.includes(`:life|${profilePlayerBase.discord_id}`), 'Refresh harus menyimpan page|targetId');
    assert(lifeStr.includes('open_achievements'), 'Tombol Prestasi wajib muncul saat ada hadiah siap klaim');

    const progressStr = JSON.stringify(profileTabProgress.components[0].toJSON());
    assert(progressStr.includes('LEVEL & PENGALAMAN') && progressStr.includes('Fishing') && progressStr.includes('Cooking'));
    assert(progressStr.includes(`:progress|${profilePlayerBase.discord_id}`), 'Refresh di tab progress harus menyimpan progress|targetId');

    const inspectJson = profileInspectOther.components[0].toJSON();
    const inspectStr = JSON.stringify(inspectJson);
    assert.strictEqual(inspectJson.accent_color, CITY_THEMES.kota_timur.containerColor);
    assert(inspectStr.includes('profile:me:'), 'Mode inspeksi warga lain wajib menampilkan tombol Profil Saya (me)');
    assert(inspectStr.includes('profile:open_pay:') && inspectStr.includes(`:${targetIdOther}`), 'Mode inspeksi wajib menampilkan tombol Transfer Lp dengan arg targetId');
    assert(!inspectStr.includes('open_wardrobe'), 'Mode inspeksi warga lain tidak boleh menampilkan tombol Outfit pribadi');
    assert(inspectStr.includes('Cash') && inspectStr.includes('Bank'), 'Info Cash & Bank tetap terbuka saat inspeksi warga lain');

    for (const [pName, pObj] of [
        ['profile (tab life)', profileTabLife],
        ['profile (tab progress)', profileTabProgress],
        ['profile (inspect other)', profileInspectOther]
    ]) {
        assert((pObj.flags & 32768) === 32768, `Panel /${pName} wajib menggunakan MessageFlags.IsComponentsV2`);
        assert.strictEqual(Array.isArray(pObj.files) && pObj.files.length, 1, `Panel /${pName} wajib menyertakan tepat 1 file attachment`);
        const containerJson = pObj.components[0].toJSON();
        const actionRows = containerJson.components.filter(c => c.type === 1);
        assert(actionRows.length <= 5, `Panel /${pName} melebihi 5 ActionRow (${actionRows.length})`);
        const cCount = countV2Components(pObj);
        const tLen = countV2DisplayableText(pObj);
        assert(cCount <= 40, `Panel /${pName} melebihi batas 40 komponen (${cCount})`);
        assert(tLen <= 4000, `Panel /${pName} melebihi batas 4000 karakter (${tLen})`);
        const rawJson = JSON.stringify(containerJson);
        assert(!rawJson.includes('undefined'), `Panel /${pName} tidak boleh mengandung string "undefined"`);
    }

    // D. Verifikasi handler tombol /profile & export fungsi lintas-modul
    const profileCmd = require('../commands/life/profile');
    const wardrobeCmd = require('../commands/life/wardrobe');
    const achievementsCmd = require('../commands/life/achievements');
    const payCmd = require('../commands/economy/pay');

    for (const btnName of ['home', 'summary', 'life', 'progress', 'me', 'refresh', 'open_wardrobe', 'open_achievements', 'open_pay']) {
        assert.strictEqual(typeof profileCmd.panel.buttons[btnName], 'function', `Handler tombol profile.${btnName} wajib tersedia`);
    }
    assert.strictEqual(typeof profileCmd.panel.userSelects.inspect_user, 'function');
    assert.strictEqual(typeof wardrobeCmd.fetchWardrobePanelData, 'function');
    assert.strictEqual(typeof wardrobeCmd.buildWardrobePanel, 'function');
    assert.strictEqual(typeof achievementsCmd.fetchAchievementsState, 'function');
    assert.strictEqual(typeof achievementsCmd.buildAchievementsPanel, 'function');
    assert.strictEqual(typeof payCmd.fetchPayState, 'function');
    assert.strictEqual(typeof payCmd.buildPayPanel, 'function');

    console.log('✅ [25/26] Redesign /profile (MediaGallery, Global Mini-HUD Removal, Banner Canvas 800x280, 2 Tab & Mode Inspeksi) terverifikasi.');

    // ====================================================
    // 26. TEST SISTEM PROPERTI TERBATAS & VOXEL 3D (/tanah, /bangun, /property, /gather)
    // ====================================================
    const {
        BUILDING_MODULES,
        SHAPE_BLOCKS,
        ALL_BUILDABLE_BLOCKS,
        STRUCTURAL_MATERIALS,
        LAND_TIERS,
        STARTER_TEMPLATES,
        validateCellPlacement,
        validateVoxelSupport,
        calculateStructuralStress,
        parseAsciiFloorPattern,
        parseGridAreaInput,
        parseAreaPerimeterWalls,
        parseLineWallInput,
        buildPresetBlueprintCells
    } = require('../data/buildingModules');
    const { getFurnitureSpec, getRotatedDimensions, getFootprintCells, rotateFurnitureClockwise } = require('../data/furniture');
    const { SHOPS } = require('../data/items');
    const { detectFloorRooms } = require('../services/roomDetectionService');
    const { validateFurniturePlacement } = require('../services/furnitureService');
    const {
        PARCEL_SIZE_TIERS,
        generateDistrictParcelSpecs,
        calculateFiniteParcelBasePrice
    } = require('../data/landParcels');
    const { GATHER_ZONES, WORKSHOP_RECIPES, rollGatherDrops, getWorkshopRecipe } = require('../data/gathering');
    const { getCityZoning } = require('../data/cities');
    const {
        computeLandStats,
        computeArchitectureScore,
        calculateLandPurchasePrice,
        calculateLandExpandPrice,
        P2P_PROPERTY_RULES,
        validateP2PTradeEligibility,
        validateMarketPriceBounds
    } = require('../services/landService');
    const {
        getConditionMeta,
        getHeavyRenovationRequirements
    } = require('../services/buildingConditionService');
    const { calculateConstructionRab } = require('../services/constructionService');
    const {
        generatePropertyCanvasBuffer,
        buildPropertyCanvasAttachment,
        clearPropertyCanvasCache
    } = require('../services/propertyCanvasService');
    const {
        getControlledRetailPrice
    } = require('../services/propertyBusinessService');
    const { buildGatherPanel } = require('../commands/activities/gather');
    const {
        buildStudioPanel,
        buildTemplatesPanel,
        buildMetaPanel,
        buildDepotPanel
    } = require('../commands/life/bangun');
    const {
        buildMapTabPanel,
        buildP2PTabPanel,
        buildOffersTabPanel,
        buildPbbTabPanel
    } = require('../commands/life/tanah');
    const {
        buildHomeTabPanel,
        buildBuyLandTabPanel,
        buildNpcTabPanel,
        buildBizWorkshopTabPanel,
        buildMarketTabPanel,
        buildGalleryTabPanel
    } = require('../commands/life/property');
    const { buildStoragePanel } = require('../commands/life/storage');
    const { buildHelpCategoryPayload } = require('../commands/onboarding/help');
    const gatherCmd = require('../commands/activities/gather');
    const bangunCmd = require('../commands/life/bangun');
    const tanahCmd = require('../commands/life/tanah');
    const propertyCmd = require('../commands/life/property');

    // A. Verifikasi Katalog Modul, Blok Bentuk 3D, Parsel Distrik, Workshop & Migrasi 012 + 013
    assert.strictEqual(BUILDING_MODULES.length, 23, 'Harus ada 23 modul ruangan sandbox');
    assert.strictEqual(SHAPE_BLOCKS.length, 11, 'Harus ada 11 blok bentuk 3D');
    assert.strictEqual(ALL_BUILDABLE_BLOCKS.length, 34, 'Harus ada 34 total blok (modul + bentuk)');
    assert.strictEqual(STRUCTURAL_MATERIALS.length, 7, 'Harus ada 7 material struktural');
    assert.strictEqual(LAND_TIERS.length, 5, 'Harus ada 5 ukuran kavling tanah (3x3..10x10)');
    assert.strictEqual(PARCEL_SIZE_TIERS.length, 4, 'Harus ada 4 tier ukuran parsel distrik (S/M/L/XL)');
    assert.strictEqual(STARTER_TEMPLATES.length, 5, 'Harus ada 5 preset blueprint siap pakai');
    assert.strictEqual(GATHER_ZONES.length, 3, 'Harus ada 3 zona gather di Lembah Hijau');
    assert.strictEqual(WORKSHOP_RECIPES.length, 17, 'Harus ada 17 resep workshop (9 olah bahan + 8 rakit perabotan)');
    assert.ok(getWorkshopRecipe('proc_papan_kayu'), 'Resep proc_papan_kayu wajib tersedia');

    const distSpecs = generateDistrictParcelSpecs('kota_sentral', 1);
    assert.strictEqual(distSpecs.length, 12, 'Setiap distrik wajib menghasilkan 12 parsel tanah terbatas');
    assert.strictEqual(calculateFiniteParcelBasePrice('S_4x4', 'kota_sentral', 1), 36500000, 'Harga dasar S_4x4 Distrik 1 Kota Sentral harus 36.500.000 Lp');

    const sql012 = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '012_modular_sandbox_property.sql'), 'utf8');
    const stmts012 = splitSqlStatements(sql012);
    assert.strictEqual(stmts012.length, 17, `Migrasi 012 wajib ter-parse menjadi tepat 17 statement SQL valid (ditemukan ${stmts012.length})`);
    assert.ok(sql012.includes('CREATE TABLE IF NOT EXISTS player_lands'), 'Migrasi 012 wajib membuat tabel player_lands');
    assert.ok(sql012.includes('CREATE TABLE IF NOT EXISTS land_grid_cells'), 'Migrasi 012 wajib membuat tabel land_grid_cells');

    const sql013 = fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '013_finite_land_and_voxel3d.sql'), 'utf8');
    const stmts013 = splitSqlStatements(sql013);
    assert.strictEqual(stmts013.length, 8, `Migrasi 013 wajib ter-parse menjadi tepat 8 statement SQL valid (ditemukan ${stmts013.length})`);
    assert.ok(sql013.includes('CREATE TABLE IF NOT EXISTS city_land_parcels'), 'Migrasi 013 wajib membuat tabel city_land_parcels');
    assert.ok(sql013.includes('CREATE TABLE IF NOT EXISTS land_trade_offers'), 'Migrasi 013 wajib membuat tabel land_trade_offers');
    assert.ok(sql013.includes('CREATE TABLE IF NOT EXISTS property_likes'), 'Migrasi 013 wajib membuat tabel property_likes');

    // B. Validasi Material vs Lantai Bebas, Voxel Support, Stress, ASCII Sketch & Parser Kuas Area TEPI
    const kayuL3Res = validateCellPlacement('kayu', 3, 'bedroom_std');
    assert.strictEqual(kayuL3Res.ok, true, 'Tinggi bangunan bebas: Kayu Olahan di Lantai 3 wajib diperbolehkan');
    assert.strictEqual(kayuL3Res.overSafeHeight, true, 'Kayu Olahan di Lantai 3 wajib menandai overSafeHeight');
    assert.strictEqual(validateCellPlacement('beton', 3, 'bedroom_std').ok, true, 'Beton Cor boleh sampai Lantai 4');
    assert.strictEqual(validateCellPlacement('beton', -1, 'gudang').ok, true, 'Beton Cor mendukung Basement B1');
    assert.strictEqual(validateCellPlacement('bata', -1, 'gudang').ok, false, 'Batu Bata tidak mendukung Basement B1');
    assert.strictEqual(validateCellPlacement('baja', 6, 'rooftop_lounge').ok, true, 'Rangka Baja mendukung Rooftop');
    assert.strictEqual(validateCellPlacement('bambu', 1, 'freezer_room').ok, false, 'Bambu tidak mendukung modul heavy-tech (Freezer)');

    assert.strictEqual(validateVoxelSupport([{ floor_level: 1, x: 0, y: 0 }, { floor_level: 3, x: 0, y: 0 }]).ok, false, 'Blok Lt.3 melayang tanpa penyangga di Lt.2 wajib ditolak');
    assert.strictEqual(validateVoxelSupport([
        { floor_level: 1, x: 0, y: 0 },
        { floor_level: 2, x: 0, y: 0 },
        { floor_level: 2, x: 1, y: 0 },
        { floor_level: 2, x: 2, y: 0 }
    ]).ok, true, 'Blok Lt.2 di atas Lt.1 + overhang <= 2 petak wajib valid');

    const stressEval = calculateStructuralStress([
        { floor_level: 1, x: 0, y: 0, material_id: 'kayu' },
        { floor_level: 3, x: 0, y: 0, material_id: 'kayu' }
    ]);
    assert(stressEval.overHeightCells === 1 && stressEval.dailyExtraDecay > 0, 'Over-height material wajib menambah stres & keausan harian');

    const asciiRes = parseAsciiFloorPattern('###\n#.#\n###', 4, 4);
    assert.strictEqual(asciiRes.ok, true, 'Sketsa ASCII 3x3 wajib ter-parse valid');
    assert.strictEqual(asciiRes.entries.length, 8, 'Sketsa ASCII cincin 3x3 harus menghasilkan tepat 8 blok');

    const gTepi = parseGridAreaInput('TEPI A1:D4', 4, 4);
    assert.strictEqual(gTepi.ok, true);
    assert.strictEqual(gTepi.cells.length, 12, 'Kuas TEPI A1:D4 wajib menghasilkan 12 sel keliling');
    const gRange = parseGridAreaInput('A1:C3', 3, 3);
    assert.strictEqual(gRange.ok, true);
    assert.strictEqual(gRange.cells.length, 9, 'A1:C3 wajib menghasilkan 9 sel');
    const gSize = parseGridAreaInput('B2 2x2', 4, 4);
    assert.strictEqual(gSize.ok, true);
    assert.strictEqual(gSize.cells.length, 4, 'B2 2x2 wajib menghasilkan 4 sel');
    const gSingle = parseGridAreaInput('C2', 3, 3);
    assert.strictEqual(gSingle.ok, true);
    assert.strictEqual(gSingle.cells.length, 1);
    assert.strictEqual(parseGridAreaInput('D1', 3, 3).ok, false, 'Koordinat D1 di kavling 3x3 wajib ditolak');

    // Kondisional degradasi / terbengkalai / roboh
    assert.strictEqual(getConditionMeta(85, 'active', true).state, 'active');
    assert.strictEqual(getConditionMeta(45, 'worn', true).qualityFactor, 0.75, 'Kondisi lapuk wajib menurunkan efektivitas menjadi 0.75x');
    assert.strictEqual(getConditionMeta(15, 'abandoned', true).facilitiesLocked, true, 'Kondisi terbengkalai wajib mengunci fasilitas');
    assert.strictEqual(getConditionMeta(0, 'collapsed', true).isCollapsed, true, 'Kondisi 0% roboh wajib menandai isCollapsed');
    assert.ok(Object.keys(getHeavyRenovationRequirements([{ material_id: 'bata' }], 20)).length > 0, 'Renovasi berat harus menghitung kebutuhan material');

    // C. Agregasi Statistik Kavling, Skor Arsitektur, Zoning Kota Barat (+20% Gudang) & RAB / Refund Konstruksi
    const sampleLandBarat = {
        id: 101,
        discord_id: samplePlayer.discord_id,
        city_id: 'kota_barat',
        land_tier: 'standar_4x4',
        parcel_code: 'KB-D1-01',
        width: 4,
        height: 4,
        custom_name: 'Gudang Pelabuhan Barat',
        theme_id: 'minimalis',
        purchase_price: calculateLandPurchasePrice('standar_4x4', 'kota_barat'),
        condition_pct: 100,
        building_state: 'active',
        is_primary: 1,
        next_pbb_at: nowTs + 86400000 * 15
    };
    const presetCells = buildPresetBlueprintCells('rumah_standar').map(c => ({ ...c, land_id: 101, layout_state: 'active' }));
    const presetWithExtraWarehouse = [
        ...presetCells,
        { land_id: 101, layout_state: 'active', floor_level: 1, x: 3, y: 0, zone_group_id: 'gudang_barat_1', zone_name: 'Gudang Tambahan', module_id: 'gudang', material_id: 'beton', color_hex: '#94A3B8' }
    ];
    const statsBarat = computeLandStats(presetWithExtraWarehouse, sampleLandBarat, getCityZoning('kota_barat'));
    const statsSentral = computeLandStats(presetWithExtraWarehouse, { ...sampleLandBarat, city_id: 'kota_sentral' }, getCityZoning('kota_sentral'));
    assert(statsBarat.storageLimits.gudang > statsSentral.storageLimits.gudang, 'Zoning Kota Barat (+20%) wajib memperbesar kapasitas Gudang');
    assert(statsBarat.cookingSlots >= 2, 'Preset Rumah Standar + dapur wajib menyediakan slot kompor');
    assert(statsBarat.sleepEnergyBonus >= 70, 'Kamar tidur wajib meningkatkan bonus Energy tidur');
    assert(statsBarat.totalAppraisalValue > sampleLandBarat.purchase_price, 'NJOP wajib menjumlahkan harga tanah + nilai bangunan');
    assert(statsBarat.monthlyPbbBase > 0, 'PBB bulanan kavling wajib > 0');
    const archCheck = computeArchitectureScore(presetWithExtraWarehouse, sampleLandBarat);
    assert(archCheck.architectureScore > 0 && ['S', 'A', 'B', 'C'].includes(archCheck.architectureGrade), 'Skor & grade arsitektur wajib valid');

    const rabBuild = calculateConstructionRab(presetCells, [], 100);
    assert.strictEqual(rabBuild.ok, true);
    assert(rabBuild.changedStructuralCells > 0 && rabBuild.durationMs > 0);
    const rabRenameOnly = calculateConstructionRab(
        presetCells.map(c => ({ ...c, zone_name: 'Kamar Direname' })),
        presetCells,
        100
    );
    assert.strictEqual(rabRenameOnly.changedStructuralCells, 0, 'Ubah nama zona saja tidak boleh meminta material/waktu baru');
    assert.strictEqual(rabRenameOnly.durationMs, 0);
    assert(rabRenameOnly.renamedOnlyCells > 0);

    const rabDemolish100 = calculateConstructionRab([], presetCells, 100);
    const rabDemolish0 = calculateConstructionRab([], presetCells, 0);
    assert(rabDemolish100.refundMaterials.batu_bata >= rabDemolish0.refundMaterials.batu_bata, 'Refund bongkar pada kondisi 100% (70%) wajib >= kondisi 0% (50%)');
    assert.strictEqual(rabDemolish100.refundMaterials.batu_bata, Math.floor(rabBuild.requiredMaterials.batu_bata * 0.7), 'Kondisi 100% wajib memberi refund 70%');

    // D. Aturan Anti-Alt P2P, Batas Harga Pasar (0.7x–2.5x NJOP), Pajak BPHTB 5%, Retail & KPR Tanah
    assert.strictEqual(P2P_PROPERTY_RULES.BPHTB_TAX_RATE, 0.05);
    assert.strictEqual(
        validateP2PTradeEligibility({ created_at: nowTs - 86400000 * 2, total_shifts: 30 }, 15, nowTs).ok,
        false,
        'Akun < 7 hari wajib ditolak dari perdagangan P2P'
    );
    assert.strictEqual(
        validateP2PTradeEligibility({ created_at: nowTs - 86400000 * 10, total_shifts: 10 }, 15, nowTs).ok,
        false,
        'Akun < 20 shift wajib ditolak dari perdagangan P2P'
    );
    assert.strictEqual(
        validateP2PTradeEligibility({ created_at: nowTs - 86400000 * 10, total_shifts: 25 }, 5, nowTs).ok,
        false,
        'Akun Total Skill < Lv 10 wajib ditolak dari perdagangan P2P'
    );
    assert.strictEqual(
        validateP2PTradeEligibility({ created_at: nowTs - 86400000 * 10, total_shifts: 25 }, 12, nowTs).ok,
        true,
        'Akun memenuhi 7 hari + 20 shift + 10 skill wajib lolos P2P'
    );

    const njopTest = 10000000;
    assert.strictEqual(validateMarketPriceBounds(6500000, njopTest).ok, false, 'Harga < 0.7x NJOP wajib ditolak');
    assert.strictEqual(validateMarketPriceBounds(26000000, njopTest).ok, false, 'Harga > 2.5x NJOP wajib ditolak');
    assert.strictEqual(validateMarketPriceBounds(15000000, njopTest).ok, true, 'Harga dalam rentang 0.7x–2.5x NJOP wajib valid');
    assert.strictEqual(getControlledRetailPrice({ sellPrice: 10000, buyPrice: 20000 }), 12500, 'Harga retail harus 1.25x sellPrice');

    const kprTanah = calculateCreditPlan('land:standar_4x4:kota_sentral', 12);
    assert.strictEqual(kprTanah.asset.category, 'land');
    assert.strictEqual(kprTanah.downPayment, Math.round(kprTanah.totalPrice * 0.2));
    assert(calculateLandExpandPrice('mini_3x3', 'kota_sentral') > 0);

    // E. Render PNG Voxel 3D Isometrik (800x420 + Cache LRU + Rotasi Kamera)
    clearPropertyCanvasCache();
    const denahAtt1 = await buildPropertyCanvasAttachment({
        land: sampleLandBarat,
        allCells: presetWithExtraWarehouse,
        stats: statsBarat,
        viewFloor: 1,
        layoutMode: 'active',
        project: null,
        cameraAngle: 0
    }, nowTs);
    const denahBuf2 = await generatePropertyCanvasBuffer({
        land: sampleLandBarat,
        allCells: presetWithExtraWarehouse,
        stats: statsBarat,
        viewFloor: 1,
        layoutMode: 'active',
        project: null,
        cameraAngle: 0
    }, nowTs);
    const denahBufRot90 = await generatePropertyCanvasBuffer({
        land: sampleLandBarat,
        allCells: presetWithExtraWarehouse,
        stats: statsBarat,
        viewFloor: 1,
        layoutMode: 'active',
        project: null,
        cameraAngle: 1
    }, nowTs);
    assert.strictEqual(denahAtt1.buffer.subarray(0, 4).toString('hex'), '89504e47', 'Canvas 3D properti harus PNG valid');
    assert.strictEqual(denahAtt1.buffer.readUInt32BE(16), 800, 'Lebar PNG Canvas properti wajib 800 px');
    assert.strictEqual(denahAtt1.buffer.readUInt32BE(20), 420, 'Tinggi PNG Canvas properti wajib 420 px');
    assert.strictEqual(denahBuf2, denahAtt1.buffer, 'Cache LRU canvas properti wajib mengembalikan buffer identik');
    assert.notStrictEqual(denahBufRot90, denahAtt1.buffer, 'Rotasi kamera 90° wajib menghasilkan signature render berbeda');

    // F. Verifikasi Drop Gather & Seluruh Panel Components V2 (/tanah, /bangun, /property, /storage, /help)
    const sampleGatherDrops = rollGatherDrops(GATHER_ZONES[0], { toolTier: 2 }, 3, () => 0.1);
    assert(Array.isArray(sampleGatherDrops) && sampleGatherDrops.length > 0, 'rollGatherDrops wajib menghasilkan material');

    const gatherPlayerTimur = {
        ...samplePlayer,
        current_city: 'kota_timur',
        gathering_xp: 120,
        last_gather_loc: 'hutan_pinus',
        last_gather_at: 0
    };
    const gatherGatePanel = buildGatherPanel({
        player: { ...gatherPlayerTimur, current_city: 'kota_sentral' },
        bestAxe: null,
        bestShovel: null,
        lvInfo: { level: 3, currentXp: 20, requiredXp: 150 },
        slotsUsed: 2,
        zone: GATHER_ZONES[0],
        elig: { allowed: true },
        remCd: 0
    }, null, nowTs);
    const gatherActivePanel = buildGatherPanel({
        player: gatherPlayerTimur,
        bestAxe: { item: getItem('kapak_tangan'), row: { durability: 20 } },
        bestShovel: null,
        lvInfo: { level: 3, currentXp: 20, requiredXp: 150 },
        slotsUsed: 2,
        zone: GATHER_ZONES[0],
        elig: { allowed: true },
        remCd: 0
    }, null, nowTs);

    const buildEmptyState = {
        player: gatherPlayerTimur,
        lands: [],
        land: null,
        activeCells: [],
        draftCells: [],
        project: null,
        depot: {},
        invRows: [],
        gudangRows: [],
        stats: null,
        activeStats: null,
        rab: null
    };
    const draftWithRename = presetCells.map(c => ({ ...c, layout_state: 'draft' }));
    const buildActiveState = {
        player: gatherPlayerTimur,
        lands: [sampleLandBarat],
        land: sampleLandBarat,
        activeCells: presetWithExtraWarehouse,
        draftCells: draftWithRename,
        project: null,
        depot: { batu_bata: 20, semen: 10 },
        invRows: [{ item_id: 'papan_kayu', quantity: 5, spoilage_pct: 100 }],
        gudangRows: [],
        stats: statsBarat,
        activeStats: statsBarat,
        rab: calculateConstructionRab(draftWithRename, presetWithExtraWarehouse, 100)
    };
    const studioEmptyPanel = await buildStudioPanel({ ownerId: gatherPlayerTimur.discord_id, state: buildEmptyState, now: nowTs });
    const studioActivePanel = await buildStudioPanel({ ownerId: gatherPlayerTimur.discord_id, state: buildActiveState, now: nowTs });
    const buildTplPanel = buildTemplatesPanel({ ownerId: gatherPlayerTimur.discord_id, state: buildActiveState, now: nowTs });
    const buildMetaView = buildMetaPanel({ ownerId: gatherPlayerTimur.discord_id, state: buildActiveState, now: nowTs });
    const buildDepotView = buildDepotPanel({ ownerId: gatherPlayerTimur.discord_id, state: buildActiveState, now: nowTs });

    const mappedParcels = distSpecs.map(sp => ({
        parcel_code: sp.parcelCode,
        city_id: sp.cityId,
        district_no: sp.districtNo,
        size_tier: sp.sizeTier,
        width: sp.width,
        height: sp.height,
        base_price: sp.basePrice,
        status: 'available',
        foreclosed_price: null,
        land_id: null,
        owner_id: null,
        like_count: 0
    }));
    const tanahState = {
        player: gatherPlayerTimur,
        lands: [sampleLandBarat],
        landPbbList: [{ land: sampleLandBarat, stats: statsBarat, mult: 1, pbbFee: statsBarat.monthlyPbbBase, cellCount: presetWithExtraWarehouse.length }],
        maxLands: 3,
        totalSkillLv: 15,
        targetCity: 'kota_sentral',
        parcels: mappedParcels,
        filteredParcels: mappedParcels,
        selectedParcel: mappedParcels[0],
        inspectedLand: null,
        inspectedCells: [],
        inspectedStats: null,
        viewerLiked: false,
        marketListings: [],
        offers: { incoming: [], outgoing: [] }
    };
    const tanahMapTab = await buildMapTabPanel({ state: tanahState, now: nowTs });
    const tanahP2PTab = buildP2PTabPanel({ state: tanahState, now: nowTs });
    const tanahOffersTab = buildOffersTabPanel({ state: tanahState, now: nowTs });
    const tanahPbbTab = buildPbbTabPanel({ state: tanahState, now: nowTs });

    const propCondMeta = getConditionMeta(100, 'active', true);
    const propModularState = {
        player: gatherPlayerTimur,
        status: {
            source: 'owned_land',
            landId: sampleLandBarat.id,
            land: sampleLandBarat,
            customName: sampleLandBarat.custom_name,
            effectiveTier: getPropertyTier('rumah'),
            actualTier: getPropertyTier('rumah'),
            capacities: { bag: 25, kulkas: 15, freezer: 10, gudang: statsBarat.storageLimits.gudang, stove: 2, coolerbox: 0 },
            isEvicted: false,
            inGracePeriod: false,
            facilitiesLocked: false,
            conditionMeta: propCondMeta
        },
        lands: [sampleLandBarat],
        maxLands: 3,
        totalSkillLv: 15,
        selectedLand: sampleLandBarat,
        selectedLandCells: presetWithExtraWarehouse,
        selectedLandStats: statsBarat,
        selectedLandProject: null,
        selectedLandCondition: propCondMeta,
        heavyRenoReqs: {},
        selectedBizRows: [],
        pendingRevenue: 0,
        emergencyLockedCount: 0,
        galleryLands: [{ ...sampleLandBarat, owner_name: gatherPlayerTimur.username, like_count: 5, liked_by_me: 0 }],
        galleryLand: { ...sampleLandBarat, owner_name: gatherPlayerTimur.username, like_count: 5, liked_by_me: 0 },
        galleryCells: presetWithExtraWarehouse,
        galleryStats: statsBarat,
        galleryCondition: propCondMeta,
        bagRows: [{ item_id: 'kayu_bulat', quantity: 12, spoilage_pct: 100 }],
        wsQueues: [],
        marketListings: [],
        vacantRooms: []
    };
    const propHomeTab = await buildHomeTabPanel({ state: propModularState, now: nowTs });
    const propBuyTab = buildBuyLandTabPanel({ state: propModularState, now: nowTs });
    const propNpcTab = buildNpcTabPanel({ state: propModularState, now: nowTs });
    const propBizTab = buildBizWorkshopTabPanel({ state: propModularState, now: nowTs });
    const propMarketTab = buildMarketTabPanel({ state: propModularState, now: nowTs });
    const propGalleryTab = await buildGalleryTabPanel({ state: propModularState, now: nowTs });
    const storModularPanel = buildStoragePanel({
        state: {
            player: gatherPlayerTimur,
            propStatus: propModularState.status,
            allRows: [],
            allLands: [sampleLandBarat]
        },
        now: nowTs
    });
    const helpLifePayload = await buildHelpCategoryPayload(gatherPlayerTimur.discord_id, 'life', false, null, nowTs);
    const helpActivitiesPayload = await buildHelpCategoryPayload(gatherPlayerTimur.discord_id, 'activities', false, null, nowTs);

    assert.strictEqual(typeof gatherCmd.panel.buttons.act, 'function');
    assert.strictEqual(typeof bangunCmd.panel.modals.paint_submit, 'function');
    assert.strictEqual(typeof bangunCmd.panel.modals.demolish_submit, 'function');
    assert.strictEqual(typeof bangunCmd.panel.modals.ascii_submit, 'function');
    assert.strictEqual(typeof tanahCmd.panel.userSelects.offer_user_pick, 'function');
    assert.strictEqual(typeof propertyCmd.panel.buttons.tab_gallery, 'function');

    for (const [label, pObj] of [
        ['gather (city gate)', gatherGatePanel],
        ['gather (active)', gatherActivePanel],
        ['bangun (empty)', studioEmptyPanel],
        ['bangun (studio + 3D canvas)', studioActivePanel],
        ['bangun (templates)', buildTplPanel],
        ['bangun (meta)', buildMetaView],
        ['bangun (depot)', buildDepotView],
        ['tanah (map)', tanahMapTab],
        ['tanah (p2p)', tanahP2PTab],
        ['tanah (offers)', tanahOffersTab],
        ['tanah (pbb)', tanahPbbTab],
        ['property (home + 3D canvas)', propHomeTab],
        ['property (buy land)', propBuyTab],
        ['property (npc lease)', propNpcTab],
        ['property (biz & workshop)', propBizTab],
        ['property (p2p market)', propMarketTab],
        ['property (gallery 3D)', propGalleryTab],
        ['storage (land scoped)', storModularPanel],
        ['help (life)', helpLifePayload],
        ['help (activities)', helpActivitiesPayload]
    ]) {
        assertComponentLimit(pObj, label);
        const serialized = JSON.stringify(pObj.components || []);
        assert(!/\bRp\s*[\d.,]+/i.test(serialized), `Panel ${label} tidak boleh mengandung mata uang Rp`);
    }
    assert.strictEqual(Array.isArray(studioActivePanel.files) && studioActivePanel.files.length, 1, 'Studio /bangun aktif wajib menyertakan 1 attachment PNG 3D');
    assert.strictEqual(Array.isArray(propHomeTab.files) && propHomeTab.files.length, 1, 'Tab home /property wajib menyertakan 1 attachment PNG 3D');
    assert.strictEqual(Array.isArray(propGalleryTab.files) && propGalleryTab.files.length, 1, 'Tab gallery /property wajib menyertakan 1 attachment PNG 3D');

    // H. Sistem 4-Layer Editor (The Sims), Edge Walls H/V, Room Flood-Fill, Multi-Size Furniture & Toko Furnitur 26 Item
    const perimA1B2 = parseAreaPerimeterWalls('A1:B2', 4, 4);
    assert.strictEqual(perimA1B2.ok, true);
    assert.strictEqual(perimA1B2.edges.length, 8, 'Perimeter 2x2 wajib menghasilkan tepat 8 segmen edge');
    const lineSouth = parseLineWallInput('A1:C1 S', 4, 4);
    assert.strictEqual(lineSouth.ok, true);
    assert.strictEqual(lineSouth.edges.length, 3, 'Garis A1:C1 S wajib menghasilkan 3 segmen horizontal');
    assert.strictEqual(lineSouth.edges[0].orientation, 'H');
    assert.strictEqual(lineSouth.edges[0].gy, 2);

    const floor3x3 = [];
    for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
            floor3x3.push({ floor_level: 1, x, y, floor_material_id: 'keramik', roof_variant: 'gable', is_pillar: 0 });
        }
    }
    const perim3x3 = parseAreaPerimeterWalls('A1:C3', 4, 4).edges.map((e, idx) => ({
        ...e,
        floor_level: 1,
        edge_type: idx === 1 ? 'door' : 'wall',
        material_id: 'bata'
    }));

    const roomWhole = detectFloorRooms({ width: 4, height: 4, floorLevel: 1, floorCells: floor3x3, wallEdges: perim3x3 });
    assert.strictEqual(roomWhole.rooms.length, 1, 'Area 3x3 tertutup wajib membentuk tepat 1 ruangan');
    assert.strictEqual(roomWhole.rooms[0].isEnclosed, true);
    assert.strictEqual(roomWhole.rooms[0].isIndoorValid, true);
    assert.strictEqual(roomWhole.rooms[0].cellCount, 9);

    const splitLine = parseLineWallInput('A1:A3 E', 4, 4).edges.map(e => ({ ...e, floor_level: 1, edge_type: 'wall', material_id: 'bata' }));
    const roomSplit = detectFloorRooms({ width: 4, height: 4, floorLevel: 1, floorCells: floor3x3, wallEdges: [...perim3x3, ...splitLine] });
    assert.strictEqual(roomSplit.rooms.length, 2, 'Sekat dinding di tengah 3x3 wajib membelah jadi 2 ruangan (3 + 6 sel)');

    const archLine = parseLineWallInput('A1:A3 E', 4, 4).edges.map(e => ({ ...e, floor_level: 1, edge_type: 'arch', material_id: 'semen' }));
    const roomArchMerged = detectFloorRooms({ width: 4, height: 4, floorLevel: 1, floorCells: floor3x3, wallEdges: [...perim3x3, ...archLine] });
    assert.strictEqual(roomArchMerged.rooms.length, 1, 'Tipe arch (gapura terbuka) tidak memutus ruangan flood-fill');

    const floorNoRoof = floor3x3.map(fc => ({ ...fc, roof_variant: null }));
    const roomOpenRoof = detectFloorRooms({ width: 4, height: 4, floorLevel: 1, floorCells: floorNoRoof, wallEdges: perim3x3 });
    assert.strictEqual(roomOpenRoof.rooms[0].hasRoof, false, 'Tanpa atap & lantai atas wajib terdeteksi tidak beratap');
    assert.strictEqual(roomOpenRoof.rooms[0].isIndoorValid, false);

    // Validasi rotasi furniture 1x2, tabrakan, penyeberangan dinding internal, & penalti outdoor 50%
    const bedSpec = getFurnitureSpec('ranjang_kayu');
    assert(bedSpec && bedSpec.width === 1 && bedSpec.height === 2);
    assert.strictEqual(rotateFurnitureClockwise('N'), 'E');
    const bedDimsE = getRotatedDimensions(bedSpec, 'E');
    assert.strictEqual(bedDimsE.widthCells, 2);
    assert.strictEqual(bedDimsE.heightCells, 1);
    assert.strictEqual(getFootprintCells(0, 0, bedDimsE.widthCells, bedDimsE.heightCells).length, 2);

    const fValid = validateFurniturePlacement({
        itemId: 'ranjang_kayu',
        anchorX: 1,
        anchorY: 0,
        rotation: 'E',
        floorLevel: 1,
        landWidth: 4,
        landHeight: 4,
        floorCells: floor3x3,
        wallEdges: [...perim3x3, ...splitLine],
        existingFurniture: [],
        detectedRooms: roomSplit
    });
    assert.strictEqual(fValid.ok, true, 'Penempatan ranjang 1x2 horizontal B1:C1 di ruangan kanan wajib valid');
    assert.strictEqual(fValid.isOutdoorPenalty, false);

    const fCrossWall = validateFurniturePlacement({
        itemId: 'ranjang_kayu',
        anchorX: 0,
        anchorY: 0,
        rotation: 'E',
        floorLevel: 1,
        landWidth: 4,
        landHeight: 4,
        floorCells: floor3x3,
        wallEdges: [...perim3x3, ...splitLine],
        existingFurniture: [],
        detectedRooms: roomSplit
    });
    assert.strictEqual(fCrossWall.ok, false, 'Perabot 2 petak yang menembus sekat dinding internal wajib ditolak');

    const fOverlap = validateFurniturePlacement({
        itemId: 'kompor_1tungku',
        anchorX: 1,
        anchorY: 0,
        rotation: 'S',
        floorLevel: 1,
        landWidth: 4,
        landHeight: 4,
        floorCells: floor3x3,
        wallEdges: perim3x3,
        existingFurniture: [{ id: 1, floor_level: 1, item_id: 'ranjang_kayu', anchor_x: 1, anchor_y: 0, width_cells: 2, height_cells: 1, rotation: 'E', is_locked_rubble: 0 }],
        detectedRooms: roomWhole
    });
    assert.strictEqual(fOverlap.ok, false, 'Perabot yang menindih petak perabot lain wajib ditolak');

    const archStatsIndoor = computeLandStats([], sampleLandBarat, getCityZoning('kota_sentral'), {
        floorCells: floor3x3,
        wallEdges: perim3x3,
        roomNamesByFloor: { 1: { [roomWhole.rooms[0].roomKey]: 'Suite Utama' } },
        furniture: [
            { id: 10, floor_level: 1, item_id: 'ranjang_kayu', anchor_x: 0, anchor_y: 0, width_cells: 2, height_cells: 1, rotation: 'E', is_locked_rubble: 0 },
            { id: 11, floor_level: 1, item_id: 'meja_tamu_resto', anchor_x: 0, anchor_y: 1, width_cells: 1, height_cells: 1, rotation: 'S', is_locked_rubble: 0 },
            { id: 12, floor_level: 1, item_id: 'kompor_komersial', anchor_x: 2, anchor_y: 1, width_cells: 1, height_cells: 2, rotation: 'S', is_locked_rubble: 0 }
        ]
    });
    assert.strictEqual(archStatsIndoor.detectedRooms[0].customName, 'Suite Utama');
    assert.strictEqual(archStatsIndoor.rentalRoomZones.length, 1, 'Ranjang + meja di ruang tertutup wajib terdeteksi sebagai Kamar Kos P2P');
    assert.strictEqual(archStatsIndoor.sleepEnergyBonus, 82, 'Ranjang kayu indoor penuh wajib memberi bonus tidur +82');
    assert.strictEqual(archStatsIndoor.cookingSlots, 2, 'Kompor komersial indoor wajib memberi 2 slot masak');

    const archStatsOutdoor = computeLandStats([], sampleLandBarat, getCityZoning('kota_sentral'), {
        floorCells: floorNoRoof,
        wallEdges: [],
        furniture: [
            { id: 20, floor_level: 1, item_id: 'kompor_komersial', anchor_x: 0, anchor_y: 0, width_cells: 1, height_cells: 2, rotation: 'S', is_locked_rubble: 0 }
        ]
    });
    assert.strictEqual(archStatsOutdoor.furnitureDetails[0].isOutdoorPenalty, true, 'Perabot indoor di ruangan tanpa dinding/atap wajib kena penalti 50%');
    assert.strictEqual(archStatsOutdoor.furnitureDetails[0].effectivenessMult, 0.5);
    assert.strictEqual(archStatsOutdoor.cookingSlots, 1, 'Efektivitas 50% dari kompor komersial (2 -> 1 tungku) wajib lebih kecil dari indoor 2');
    assert(archStatsOutdoor.cookingSlots < archStatsIndoor.cookingSlots);

    // Uji 10+ lantai menara kayu di lahan 4x4 mengalami stress berat
    const tower10Floors = [];
    for (let fl = 1; fl <= 10; fl++) {
        tower10Floors.push({ floor_level: fl, x: 0, y: 0, material_id: 'kayu', module_id: 'hall_custom' });
    }
    const rab10Floor = calculateConstructionRab(tower10Floors, [], 100);
    assert.strictEqual(rab10Floor.structuralStress.maxFloor, 10);
    assert(rab10Floor.structuralStress.overHeightCells > 0 && rab10Floor.structuralStress.dailyExtraDecay > 0, 'Menara 10 lantai kayu di 4x4 wajib memicu overHeightCells & extra decay');

    // Uji Render Canvas 4-Layer + 5 Mode Studio /bangun + Toko Furnitur 26 item (select <= 25 opsi)
    clearPropertyCanvasCache();
    const canvas4LayerPng = await generatePropertyCanvasBuffer({
        land: sampleLandBarat,
        allCells: [],
        floorCells: floor3x3,
        wallEdges: perim3x3,
        furniture: archStatsIndoor.furnitureDetails,
        rooms: archStatsIndoor.detectedRooms,
        stats: archStatsIndoor,
        viewFloor: 1,
        layoutMode: 'active',
        cameraAngle: 1
    }, nowTs);
    assert(Buffer.isBuffer(canvas4LayerPng) && canvas4LayerPng.length > 5000, 'Canvas PNG 4-Layer (dinding H/V, lantai, atap, furniture, room label) wajib valid');

    assert(SHOPS.some(s => s.id === 'furnitur'), 'Toko furnitur wajib terdaftar di SHOPS');
    const furnShopPanel = buildShopPanel({
        state: {
            player: { ...gatherPlayerTimur, backpack_tier: 1, max_slots: 20 },
            invRows: [],
            ownedClothes: new Set(),
            slotsUsed: 5,
            liveCfg: { shop_price_multiplier: 1.0 }
        },
        shopId: 'furnitur',
        selectedItemId: 'ranjang_kayu',
        page: 1,
        now: nowTs
    });
    assertComponentLimit(furnShopPanel, 'shop (furnitur 26 items sliding select page 1)');
    const furnShopPage6 = buildShopPanel({
        state: {
            player: { ...gatherPlayerTimur, backpack_tier: 1, max_slots: 20 },
            invRows: [],
            ownedClothes: new Set(),
            slotsUsed: 5,
            liveCfg: { shop_price_multiplier: 1.0 }
        },
        shopId: 'furnitur',
        page: 6,
        now: nowTs
    });
    assertComponentLimit(furnShopPage6, 'shop (furnitur 26 items sliding select page 6)');

    assert.strictEqual(typeof bangunCmd.panel.modals.wall_perim_submit, 'function');
    assert.strictEqual(typeof bangunCmd.panel.modals.place_furn_submit, 'function');
    assert.strictEqual(typeof bangunCmd.panel.modals.rename_room_submit, 'function');

    console.log('✅ [26/27] Sistem Properti 4-Layer (/tanah, /bangun 4-Layer & Flood-Fill, Perabot 1x1..2x2, Toko Furnitur, Degradasi/Roboh, Canvas 800x420 & Migrasi 015) terverifikasi.');

    // ====================================================
    // 27. TEST MODE UNDER DEVELOPMENT (PROPERTY, TANAH, BANGUN) & FALLBACK DAPUR UMUM
    // ====================================================
    const { FEATURE_FLAGS } = require('../data/constants');
    const {
        isPropertyUnderDevelopment,
        isPropertyModuleDisabled,
        buildPropertyUnderDevPanel
    } = require('../utils/featureFlags');
    const { resolveEffectiveStoveInfo } = require('../services/cookService');

    assert.strictEqual(FEATURE_FLAGS.PROPERTY_UNDER_DEVELOPMENT, true, 'FEATURE_FLAGS.PROPERTY_UNDER_DEVELOPMENT harus aktif (true)');
    assert.strictEqual(isPropertyUnderDevelopment(), true);
    assert.strictEqual(isPropertyModuleDisabled('property'), true);
    assert.strictEqual(isPropertyModuleDisabled('bangun'), true);
    assert.strictEqual(isPropertyModuleDisabled('tanah'), true);
    assert.strictEqual(isPropertyModuleDisabled('cook'), false);

    for (const [modName, modCmd] of [
        ['property', propertyCmd],
        ['bangun', bangunCmd],
        ['tanah', tanahCmd]
    ]) {
        let slashPayload = null;
        await modCmd.executeSlash({
            user: { id: '123456789' },
            reply: async (p) => {
                slashPayload = p;
                return p;
            }
        });
        assert(slashPayload, `/${modName} executeSlash wajib mengembalikan payload Under Development`);
        assert((slashPayload.flags & 64) === 64, `/${modName} Under Development reply wajib ephemeral`);
        assertComponentLimit(slashPayload, `${modName} (under dev slash)`);
        const rawSlash = JSON.stringify(slashPayload.components.map(c => c.toJSON()));
        assert(rawSlash.includes('Dalam Pengembangan'), `/${modName} wajib memuat status Dalam Pengembangan`);
        assert(!rawSlash.includes('undefined'), `/${modName} Under Development tidak boleh mengandung "undefined"`);
    }

    clearRegistry();
    for (const modName of ['property', 'bangun', 'tanah']) {
        let innerHandlerCalled = false;
        registerPanel(modName, {
            buttons: {
                async home() {
                    innerHandlerCalled = true;
                }
            }
        }, 15, true);

        let updatedPayload = null;
        const intercepted = await dispatch({
            customId: makeId(modName, 'home', '123456789', '', nowTs),
            user: { id: '123456789' },
            isButton: () => true,
            isFromMessage: () => true,
            update: async (p) => {
                updatedPayload = p;
                return p;
            }
        }, {}, nowTs + 1000);

        assert.strictEqual(intercepted, true, `panelRouter wajib mencegat interaksi tombol ${modName}`);
        assert.strictEqual(innerHandlerCalled, false, `Handler lama ${modName} tidak boleh dieksekusi saat Under Development`);
        assert(updatedPayload, `Intersepsi ${modName} harus mengirim pembaruan panel`);
        assert((updatedPayload.flags & 64) === 0, `interaction.update pada ${modName} tidak boleh memakai flag ephemeral`);
        assert(Array.isArray(updatedPayload.attachments) && updatedPayload.attachments.length === 0, `interaction.update pada ${modName} wajib membersihkan attachments lama`);
        assertComponentLimit(updatedPayload, `${modName} (under dev router)`);
    }
    clearRegistry();

    const underDevStandAlone = buildPropertyUnderDevPanel({ mod: 'property', ownerId: '123456789', now: nowTs });
    assertComponentLimit(underDevStandAlone, 'underDev standalone helper');

    const gatherRaw = JSON.stringify(gatherActivePanel.components.map(c => c.toJSON()));
    assert(!gatherRaw.includes('bangun:home:'), '/gather tidak boleh menampilkan tombol Studio /bangun saat Under Development');

    const tunawismaStove = resolveEffectiveStoveInfo({
        capacities: { stove: 0 },
        facilitiesLocked: false
    });
    assert.deepStrictEqual(tunawismaStove, { stoveSlots: 1, usingPublicStove: true });

    const lockedStove = resolveEffectiveStoveInfo({
        capacities: { stove: 3 },
        facilitiesLocked: true
    });
    assert.deepStrictEqual(lockedStove, { stoveSlots: 1, usingPublicStove: true });

    const activeMultiStove = resolveEffectiveStoveInfo({
        capacities: { stove: 2 },
        facilitiesLocked: false
    });
    assert.deepStrictEqual(activeMultiStove, { stoveSlots: 2, usingPublicStove: false });

    const cookPublicPanel = buildCookPanel({
        state: {
            player: { ...samplePlayer, current_city: 'kota_sentral', lpg_charges: 2, cooking_xp: 0 },
            buffs: [],
            propStatus: {
                effectiveTier: getPropertyTier('tunawisma'),
                capacities: { stove: 0 },
                facilitiesLocked: false
            },
            queues: [],
            invRows: [],
            gasInBag: 1,
            coalInBag: 0
        },
        mode: 'kitchen',
        now: nowTs
    });
    assertComponentLimit(cookPublicPanel, 'cook (public stove fallback)');
    const cookPublicRaw = JSON.stringify(cookPublicPanel.components.map(c => c.toJSON()));
    assert(cookPublicRaw.includes('Dapur Umum'), '/cook wajib menampilkan Dapur Umum Kota untuk warga tanpa properti saat Under Development');
    assert(!cookPublicRaw.includes('Belum Punya Dapur Aktif'), '/cook tidak boleh memblokir warga tanpa properti saat Under Development');

    const helpLifeRaw = JSON.stringify(helpLifePayload.components.map(c => c.toJSON()));
    assert(helpLifeRaw.includes('Under Development'), '/help kategori Kehidupan wajib menandai fitur properti sebagai Under Development');

    console.log('✅ [27/27] Mode Under Development (/property, /tanah, /bangun), Router Guard, /gather & Fallback Dapur Umum /cook terverifikasi.\n');

    console.log('🎉 SELURUH PENGUJIAN UNIT BERHASIL (27/27 PASSED)!');
    process.exit(0);
}

runTests().catch(err => {
    console.error('❌ Pengujian gagal:', err);
    process.exit(1);
});
