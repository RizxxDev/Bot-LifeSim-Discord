const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { validateUsername, buildV2Card, COLORS } = require('../utils/uiBuilder');
const { computeLazyVitals, calculateHospitalAdmission, checkActivityEligibility } = require('../services/vitalService');
const { calculateSlotsUsed, canFitItems } = require('../services/inventoryService');
const {
    isNewbieBoostActive,
    calculateIncomeTax,
    calculateMarginalWealthTax,
    getSoftCapModifier
} = require('../services/economyService');
const { computeDynamicPriceMultiplier } = require('../services/marketService');
const { generateWorkMinigame } = require('../services/minigameService');
const { getLevelInfoFromXp, rollLoot, getFishingLocation } = require('../data/locations');
const { STARTER_PACK } = require('../data/constants');

function collectCommandFiles(dir, list = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectCommandFiles(full, list);
        else if (entry.isFile() && entry.name.endsWith('.js')) list.push(full);
    }
    return list;
}

function runTests() {
    console.log('🧪 Menjalankan pengujian unit logika inti (testCoreLogic.js)...\n');

    // 1. Verifikasi seluruh Slash Command berhasil di-load & valid JSON
    const cmdFiles = collectCommandFiles(path.join(__dirname, '..', 'commands'));
    assert(cmdFiles.length >= 20, `Harusnya ada >= 20 command, ditemukan: ${cmdFiles.length}`);
    for (const file of cmdFiles) {
        const cmd = require(file);
        assert(cmd.name, `Command di ${file} tidak punya name`);
        assert(cmd.data, `Command ${cmd.name} tidak punya SlashCommandBuilder data`);
        const json = cmd.data.toJSON();
        assert.strictEqual(json.name, cmd.name);
    }
    console.log(`✅ [1/8] ${cmdFiles.length} Slash Commands berhasil dimuat & tervalidasi.`);

    // 2. Validasi Username & Blacklist
    assert.strictEqual(validateUsername('Budi_99').valid, true);
    assert.strictEqual(validateUsername('ab').valid, false, 'Terlalu pendek harus ditolak');
    assert.strictEqual(validateUsername('Nama Pakai Spasi').valid, false, 'Spasi harus ditolak');
    assert.strictEqual(validateUsername('Admin_Kota').valid, false, 'Kata admin harus ditolak');
    assert.strictEqual(validateUsername('4dm1n_99').valid, false, 'Leetspeak admin harus ditolak');
    console.log('✅ [2/8] Validasi Username & Filter Blacklist bekerja akurat.');

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
    console.log('✅ [3/8] Lazy Evaluation Stat Vital & Offline Floor (20) terverifikasi.');

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
    console.log('✅ [4/8] Rumus Rumah Sakit & Proteksi Saldo Anti-Minus terverifikasi.');

    // 5. Perhitungan Kapasitas Slot Tas (Inventory Slots)
    const starterInv = STARTER_PACK.items.map(it => ({
        item_id: it.itemId,
        quantity: it.qty,
        durability: it.itemId.startsWith('pancing') || it.itemId.startsWith('beliung') ? 100 : null
    }));
    // pancing_bambu (1 slot) + beliung_batu (1 slot) + 20 cacing (1 slot) + 3 nasi (1 slot) + 3 roti (1 slot) + 6 air (1 slot) = 6 slot
    const starterSlots = calculateSlotsUsed(starterInv);
    assert.strictEqual(starterSlots, 6, `Starter pack harus memakan 6 slot, terhitung: ${starterSlots}`);

    // Lisensi (SIM C) tidak memakan slot
    const fitLicense = canFitItems(starterInv, 6, [{ itemId: 'sim_c', qty: 1 }]);
    assert.strictEqual(fitLicense.fits, true, 'SIM C harus 0 slot dan muat walau slot pas');

    // Menambah 1 alat baru saat slot 6/6 harus ditolak
    const fitExtraTool = canFitItems(starterInv, 6, [{ itemId: 'pancing_bambu', qty: 1 }]);
    assert.strictEqual(fitExtraTool.fits, false, 'Harus menolak jika melebihi max_slots');
    console.log('✅ [5/8] Sistem Kapasitas Slot Tas & Stackable Rules terverifikasi.');

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
    console.log('✅ [6/8] Pajak Progresif, Newbie Boost, Pajak Kekayaan & Soft Cap terverifikasi.');

    // 7. Pasar Dinamis 24 Jam & Loot Roller
    const stableMkt = computeDynamicPriceMultiplier(100, 200, 50);
    assert.strictEqual(stableMkt.multiplier, 1.0);
    const floodedMkt = computeDynamicPriceMultiplier(600, 200, 50);
    assert.strictEqual(floodedMkt.multiplier, 0.5, 'Harga turun maksimal ke lantai 50%');

    const sungai = getFishingLocation('sungai');
    const sampleLoot = rollLoot({ isFishing: true, location: sungai, minigameSuccess: false });
    assert(!['epic', 'legendary'].includes(sampleLoot.rarity), 'Gagal mini-game tidak boleh dapat Epic/Legendary');
    console.log('✅ [7/8] Rumus Harga Pasar Dinamis & Tabel Loot Rarity terverifikasi.');

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
    console.log('✅ [8/8] Builder Discord Components V2 & 6 Tipe Mini-Game Kerja terverifikasi.\n');
    console.log('🎉 SELURUH PENGUJIAN UNIT BERHASIL (8/8 PASSED)!');
}

runTests();
