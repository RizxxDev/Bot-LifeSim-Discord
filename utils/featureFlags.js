const { FEATURE_FLAGS } = require('../data/constants');
const { COLORS } = require('./uiBuilder');
const { buildPanel } = require('./panelBuilder');

const UNDER_DEV_PROPERTY_MODS = new Set(['property', 'bangun', 'tanah']);

const UNDER_DEV_MODULE_TITLES = {
    property: '🚧 /property — Dalam Pengembangan (Under Development)',
    bangun: '🚧 /bangun — Dalam Pengembangan (Under Development)',
    tanah: '🚧 /tanah — Dalam Pengembangan (Under Development)'
};

/**
 * Mengembalikan true jika modul Properti, Tanah, dan Bangun sedang dinonaktifkan sementara.
 */
function isPropertyUnderDevelopment() {
    return Boolean(FEATURE_FLAGS && FEATURE_FLAGS.PROPERTY_UNDER_DEVELOPMENT);
}

/**
 * Mengecek apakah modul command tertentu termasuk modul yang sedang dinonaktifkan oleh flag properti.
 */
function isPropertyModuleDisabled(mod) {
    return isPropertyUnderDevelopment() && UNDER_DEV_PROPERTY_MODS.has(String(mod || '').trim());
}

/**
 * Membangun kartu panel Discord Components V2 standar untuk fitur Properti/Tanah/Bangun
 * yang sedang dalam tahap pengembangan (Under Development).
 */
function buildPropertyUnderDevPanel({
    mod = 'property',
    ownerId = '0',
    ephemeral = true,
    now = Date.now()
} = {}) {
    const cleanMod = String(mod || 'property').trim();
    const title = UNDER_DEV_MODULE_TITLES[cleanMod] || '🚧 Fitur Dalam Pengembangan (Under Development)';

    return buildPanel({
        mod: cleanMod,
        ownerId,
        accentColor: COLORS.WARNING,
        title,
        blocks: [
            '⏳ **Fitur Sementara Dinonaktifkan**\nSistem **Properti (`/property`)**, **Kavling Tanah (`/tanah`)**, dan **Arsitek Bangunan (`/bangun`)** sedang ditutup sementara karena konsep gameplay masih dalam perombakan.',
            [
                '🛡️ **Perlindungan Data & Alternatif Sementara:**',
                '• Data aset properti/kavling yang sudah ada tetap tersimpan aman (degradasi bangunan, sewa, PBB, dan penyitaan dijeda sementara).',
                '• Fitur `/cook` tetap bisa dipakai melalui **🍲 Dapur Umum Kota (1 Slot Publik)** tanpa wajib memiliki properti.',
                '• Gunakan `/sleep` (Tidur Darurat / Motel Transit), `/storage` (Cooler Box), `/gather`, `/farm`, `/fishing`, & `/mining` seperti biasa.'
            ].join('\n')
        ],
        rows: [],
        footer: 'Fitur /property, /tanah, dan /bangun akan dibuka kembali setelah konsep baru siap.',
        ephemeral,
        now
    });
}

module.exports = {
    UNDER_DEV_PROPERTY_MODS,
    isPropertyUnderDevelopment,
    isPropertyModuleDisabled,
    buildPropertyUnderDevPanel
};
