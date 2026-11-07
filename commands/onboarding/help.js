const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { COLORS } = require('../../utils/uiBuilder');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getJob } = require('../../data/jobs');
const {
    buildPanel,
    btn,
    select
} = require('../../utils/panelBuilder');

const COMMAND_DETAILS = {
    start: {
        title: '/start — Mulai Hidup Baru',
        usage: '`/start`',
        cost: 'Tidak ada',
        cooldown: 'Tidak ada',
        tips: 'Membuka kartu sambutan "Welcome To Life Simulation" untuk mendaftarkan username unik karaktermu.'
    },
    profile: {
        title: '/profile — Kartu Identitas Karakter',
        usage: '`/profile` (pilih warga lewat dropdown di dalam panel)',
        cost: 'Tidak ada',
        cooldown: 'Tidak ada',
        tips: 'Menampilkan avatar chibi kustom, stat vital, pendidikan, karir, level 4 skill, hunian, kendaraan, & koleksi.'
    },
    wardrobe: {
        title: '/wardrobe — Lemari Pakaian & Kustomisasi Avatar Chibi',
        usage: '`/wardrobe` (atau klik tombol 👔 Lemari Pakaian di `/profile`)',
        cost: 'Gratis ganti pakaian · Beli busana baru di `/shop` (Butik Busana) atau `/gacha`',
        cooldown: 'Tidak ada',
        tips: 'Kustomisasi 7 slot tubuh chibi (Kulit, Rambut, Topi, Atasan, Bawahan, Sepatu, Aksesoris). Busana profesi/langka memberi buff gaji & EXP!'
    },
    consume: {
        title: '/consume — Meja Konsumsi (Makan, Minum, Obat & Dokumen)',
        usage: '`/consume`',
        cost: 'Item konsumsi di tas',
        cooldown: 'Tidak ada',
        tips: 'Menggabungkan makan, minum, vitamin, dan pemakaian dokumen. Tersedia tombol 🍴 Makan & Minum Otomatis!'
    },
    sleep: {
        title: '/sleep — Tidur & Istirahat',
        usage: '`/sleep`',
        cost: 'Waktu istirahat 30–60 menit',
        cooldown: 'Hanya bisa saat Energy < 80',
        tips: 'Tidur memulihkan +50 Energy (atau +60 s/d +100 Energy jika kamu menyewa/membeli properti di /property).'
    },
    property: {
        title: '/property — Sewa Kos, Kontrakan & Beli Rumah',
        usage: '`/property`',
        cost: 'Sewa mulai Lp 70.000/minggu atau beli tunai',
        cooldown: 'Tidak ada',
        tips: 'Properti membuka fasilitas Kulkas, Freezer, Tungku Dapur, Gudang, serta menambah bonus pemulihan /sleep!'
    },
    storage: {
        title: '/storage — Kulkas, Freezer, Gudang & Cooler Box',
        usage: '`/storage`',
        cost: 'Membutuhkan fasilitas properti atau Cooler Box',
        cooldown: 'Tidak ada',
        tips: 'Simpan ikan & makanan segar di Kulkas (basi 3x lebih lambat) atau Freezer (tidak basi) agar tidak berubah menjadi Bahan Basi.'
    },
    vehicle: {
        title: '/vehicle — Garasi Kendaraan, Bensin SPBU & Servis',
        usage: '`/vehicle`',
        cost: 'Sepeda mulai Lp 1,5 juta · BBM Lp 10.000/liter',
        cooldown: 'Tidak ada',
        tips: 'Kendaraan memberi bonus gaji Kurir/Ojol, membuka profesi Taksi Online/Sopir Pribadi (Mobil + SIM A), dan hemat Energy ke lokasi jauh!'
    },
    credit: {
        title: '/credit — Pembiayaan Kredit Kendaraan & Properti',
        usage: '`/credit`',
        cost: 'DP 20% + Bunga Flat 5%–15% (Tenor 4, 8, 12, atau 24 minggu)',
        cooldown: 'Penagihan otomatis setiap minggu (Bank dulu, lalu Cash)',
        tips: 'Syarat: umur akun >= 14 hari, punya pekerjaan tetap, dan cicilan <= 50% penghasilan 7 hari terakhir. Lunasi cepat untuk hemat 50% sisa bunga!'
    },
    achievements: {
        title: '/achievements — Pencapaian Warga & Gelar Kehormatan (Title)',
        usage: '`/achievements`',
        cost: 'Tidak ada',
        cooldown: 'Tidak ada',
        tips: 'Selesaikan 27 tantangan di 6 kategori, klaim hadiah item, dan pasang Gelar Kehormatan (Title) langsung dari panel ini!'
    },
    event: {
        title: '/event — Cuaca 2 Mingguan & Bazar Event Musiman',
        usage: '`/event`',
        cost: 'Token Event dari aktivitas harian',
        cooldown: 'Cuaca berganti otomatis tiap 14 hari',
        tips: 'Cek cuaca (Musim Hujan vs Kemarau), tukar token di bazar event, dan nikmati THR Lebaran ×1,5 gaji dasar selama 3 hari pertama Lebaran!'
    },
    cooldowns: {
        title: '/cooldowns — Cek Jadwal & Cooldown Aktif',
        usage: '`/cooldowns`',
        cost: 'Tidak ada',
        cooldown: 'Tidak ada',
        tips: 'Lihat kapan kamu bisa kembali bekerja, belajar, memancing, menambang, atau klaim hadiah harian.'
    },
    job: {
        title: '/job — Pusat Karir & Lowongan Kerja',
        usage: '`/job`',
        cost: 'Syarat pendidikan/item sesuai profesi',
        cooldown: 'Resign memiliki masa tunggu 24 jam sebelum melamar lagi',
        tips: 'Riwayat jumlah shift di setiap pekerjaan tetap tersimpan meskipun kamu pindah profesi.'
    },
    work: {
        title: '/work — Panel Kerja & Shift Harian',
        usage: '`/work`',
        cost: '⚡ 20–25 Energy · 🍔 8 Hunger · 💧 10 Thirst',
        cooldown: '60 menit',
        tips: 'Selesaikan mini-game singkat dengan benar untuk mendapat 100% gaji + bonus 10%! Naik jabatan otomatis di 30, 100, dan 250 shift.'
    },
    study: {
        title: '/study — Kampus, Akademi & Kuliah',
        usage: '`/study`',
        cost: '⚡ 15 Energy · 🍔 5 Hunger · 💧 6 Thirst + Biaya per sesi',
        cooldown: '120 menit',
        tips: 'Tingkatkan ijazah (SD → SMP → SMA → D3/S1 → S2) untuk membuka profesi bergaji tinggi. Bisa dilakukan sambil bekerja!'
    },
    bin: {
        title: '/bin — Memulung & Mengais Tempat Sampah Kota',
        usage: '`/bin`',
        cost: '⚡ 1 Energy',
        cooldown: '5 detik',
        tips: 'Cara utama warga baru mencari modal dari 0! Klik tombol 🔍 Cari di Tempat Sampah setiap 5 detik untuk menemukan rongsokan, makanan, umpan, atau jackpot alat pancing/beliung.'
    },
    fishing: {
        title: '/fishing — Dermaga & Spot Memancing',
        usage: '`/fishing`',
        cost: 'Wajib punya Pancingan + Umpan · ⚡ 8 Energy · 🍔 3 Hunger · 💧 4 Thirst',
        cooldown: '3 menit',
        tips: 'Beli Pancingan Bambu (Lp 50.000) & Umpan di /shop terlebih dahulu. Pilih spot & umpan dari dropdown lalu lempar kail!'
    },
    mining: {
        title: '/mining — Ekspedisi Pertambangan',
        usage: '`/mining`',
        cost: 'Wajib punya Beliung · ⚡ 12 Energy · 🍔 5 Hunger · 💧 6 Thirst',
        cooldown: '5 menit',
        tips: 'Beli Beliung Batu (Lp 60.000) di /shop terlebih dahulu. Gunakan Helm Keselamatan untuk mengurangi risiko kecelakaan tambang sebesar 70%.'
    },
    farm: {
        title: '/farm — Perkebunan & Lahan Tani',
        usage: '`/farm`',
        cost: 'Sewa mulai Lp 15.000/mgg atau beli permanen mulai Lp 400.000 + Bibit Toko Tani',
        cooldown: 'Tumbuh 2 fase sesuai durasi tanaman (1–12 jam)',
        tips: 'Tanam, siram semua petak, beri pupuk, daur ulang kompos, dan panen sekaligus dalam 1 panel interaktif!'
    },
    cook: {
        title: '/cook — Dapur Properti & Memasak Hidangan',
        usage: '`/cook`',
        cost: '⚡ 3 Energy/batch + 1× Muatan LPG atau Batu Bara + Bahan di Tas',
        cooldown: 'Durasi masak 20–120 detik per porsi',
        tips: 'Masak hingga 5 porsi sekaligus hanya dengan 1 bahan bakar! Hidangan rumahan memulihkan stat vital besar dan memberi buff.'
    },
    shop: {
        title: '/shop — Pusat Perbelanjaan & Katalog Toko Kota',
        usage: '`/shop`',
        cost: 'Lp sesuai harga barang (otomatis potong Bank jika Cash kurang)',
        cooldown: 'Tidak ada',
        tips: 'Jelajahi 9 toko kota (termasuk Butik & Distro Busana), pilih barang dari dropdown, dan beli langsung di panel!'
    },
    sell: {
        title: '/sell — Papan Harga Pasar & Pengepul Komoditas',
        usage: '`/sell`',
        cost: 'Komoditas di tas (ikan, mineral, hasil tani, masakan)',
        cooldown: 'Tidak ada',
        tips: 'Lihat harga pasar 24 jam secara live dan gunakan tombol cepat Jual Ikan, Jual Tambang, Jual Tani, Jual Masakan, atau Jual Semua!'
    },
    gacha: {
        title: '/gacha — Mesin Kapsul & Mystery Box 3-Tier',
        usage: '`/gacha`',
        cost: 'Tiket Gacha di tas atau Lp 25rb (Warung) / Lp 250rb (Mall) / Lp 2,5jt (Sultan)',
        cooldown: 'Tidak ada',
        tips: 'Tarik 1× atau 10× (Garansi minimal 1 hadiah Rare+ di 10× Pull)! Hadiah unik kembar otomatis dikonversi menjadi Tiket Gacha.'
    },
    inventory: {
        title: '/inventory — Tas, Reparasi Alat & Upgrade Ransel',
        usage: '`/inventory`',
        cost: 'Tidak ada',
        cooldown: 'Tidak ada',
        tips: 'Pantau kapasitas slot tasmu, perbaiki pancingan/beliung yang rusak, atau upgrade ukuran tas hingga 130 slot.'
    },
    bank: {
        title: '/bank — Brankas & Layanan Perbankan Kota',
        usage: '`/bank`',
        cost: 'Biaya admin bank Lp 10.000/bulan (gratis jika saldo < Lp 500.000)',
        cooldown: 'Tidak ada',
        tips: 'Setor (Deposit) dan Tarik (Withdraw) dengan tombol cepat 25%, 50%, Semua, atau Nominal Lain. Uang di Bank aman dari denda RS!'
    },
    pay: {
        title: '/pay — Layanan Transfer Uang Antar Warga',
        usage: '`/pay`',
        cost: 'Pajak transfer 5% ditanggung pengirim',
        cooldown: 'Batas kirim Lp 1.000.000/hari',
        tips: 'Pilih warga tujuan lewat User Select Menu dan konfirmasi nominal sebelum dikirim.'
    },
    daily: {
        title: '/daily — Klaim Hadiah Harian Beruntun',
        usage: '`/daily`',
        cost: 'Tidak ada',
        cooldown: 'Setiap hari (reset 00:00 WIB, streak putus jika >36 jam)',
        tips: 'Jaga streak 7 hari berturut-turut untuk mendapatkan paket bekal, umpan pro, dan bonus uang tunai di hari ke-7.'
    },
    leaderboard: {
        title: '/leaderboard — Papan Peringkat Global',
        usage: '`/leaderboard`',
        cost: 'Tidak ada',
        cooldown: 'Cache diperbarui tiap 5 menit',
        tips: 'Bandingkan Kekayaan, Total Shift, Fishing, Mining, Farming, dan Cooking dengan tombol kategori interaktif.'
    }
};

function getDynamicRecommendation(player) {
    if (!player) {
        return '👉 **Rekomendasi Saat Ini:** Kamu belum memiliki karakter! Klik tombol **🌱 Mulai Hidup Baru** atau ketik `/start`.';
    }
    if (player.hunger < 35 || player.thirst < 35) {
        return '👉 **Rekomendasi Saat Ini:** Perutmu mulai lapar/haus! Buka `/consume` lalu klik **🍴 Makan & Minum Otomatis** agar hasil kerjamu tetap maksimal.';
    }
    if (player.energy < 20) {
        return '👉 **Rekomendasi Saat Ini:** ⚡ Energy kamu rendah! Buka `/sleep` untuk istirahat atau minum kopi di `/consume`.';
    }
    if (!player.current_job) {
        return '👉 **Rekomendasi Saat Ini:** Kamu belum punya pekerjaan tetap! Buka `/job` untuk memilih dan melamar profesi awalmu.';
    }
    const job = getJob(player.current_job);
    return `👉 **Rekomendasi Saat Ini:** Jalani shift sebagai **${job ? job.name : player.current_job}** di \`/work\`, tingkatkan ijazah di \`/study\`, atau cari penghasilan tambahan di \`/fishing\`, \`/mining\`, & \`/farm\`!`;
}

async function fetchHelpPlayer(discordId, now = Date.now()) {
    try {
        const synced = await withTransaction(conn => syncPlayerVitals(conn, discordId, now, false));
        return synced ? synced.player : null;
    } catch {
        return null;
    }
}

async function buildHelpCategoryPayload(discordId, category = 'home', ephemeral = false, selectedCmd = null, now = Date.now()) {
    const player = await fetchHelpPlayer(discordId, now);

    const catRow = select('help', 'cat', discordId, {
        placeholder: '📂 Pilih Kategori Panduan...',
        options: [
            {
                label: 'Beranda & Cara Mulai',
                value: 'home',
                emoji: '🏠',
                description: 'Ringkasan 4 langkah awal dan rekomendasi langkah berikutnya',
                default: category === 'home' && !selectedCmd
            },
            {
                label: 'Kehidupan, Busana, Properti & Kendaraan',
                value: 'life',
                emoji: '🧍',
                description: '/profile, /wardrobe, /consume, /sleep, /property, /storage, /vehicle, /achievements',
                default: category === 'life' && !selectedCmd
            },
            {
                label: 'Karir & Pendidikan',
                value: 'career',
                emoji: '💼',
                description: '/job, /work, /study',
                default: category === 'career' && !selectedCmd
            },
            {
                label: 'Memulung, Memancing, Tambang, Tani & Masak',
                value: 'activities',
                emoji: '🎣',
                description: '/bin, /fishing, /mining, /farm, /cook',
                default: category === 'activities' && !selectedCmd
            },
            {
                label: 'Ekonomi, Bank, Toko, Gacha & Kredit',
                value: 'economy',
                emoji: '💰',
                description: '/bank, /shop, /sell, /gacha, /inventory, /credit, /pay, /daily, /leaderboard',
                default: category === 'economy' && !selectedCmd
            }
        ]
    }, now);

    const cmdRow = select('help', 'cmd', discordId, {
        placeholder: '📘 Pilih Command untuk Melihat Detail & Tips...',
        options: Object.entries(COMMAND_DETAILS).slice(0, 25).map(([cmd, info]) => ({
            label: info.title.slice(0, 100),
            value: cmd,
            emoji: '🔹',
            description: `Cooldown: ${info.cooldown}`.slice(0, 100),
            default: selectedCmd === cmd
        }))
    }, now);

    const rows = [catRow, cmdRow];

    if (!player) {
        rows.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('reg_open_modal')
                    .setLabel('Mulai Hidup Baru')
                    .setEmoji('🌱')
                    .setStyle(ButtonStyle.Success)
            )
        );
    }

    if (selectedCmd && COMMAND_DETAILS[selectedCmd]) {
        const info = COMMAND_DETAILS[selectedCmd];
        return buildPanel({
            mod: 'help',
            ownerId: discordId,
            accentColor: COLORS.PRIMARY,
            title: `📘 Detail Command: ${info.title}`,
            player,
            blocks: [
                `• **Cara Pakai:** ${info.usage}\n• **Biaya / Syarat:** ${info.cost}\n• **Cooldown:** ${info.cooldown}`,
                `💡 **Tips:** ${info.tips}`
            ],
            rows,
            footer: 'Seluruh command kini berupa 1 panel interaktif utuh tanpa perlu mengetik subcommand.',
            ephemeral,
            now
        });
    }

    if (category === 'life') {
        return buildPanel({
            mod: 'help',
            ownerId: discordId,
            accentColor: COLORS.LIFE,
            title: '🧍 Panduan: Kehidupan, Properti & Kendaraan',
            player,
            blocks: [
                'Karaktermu memiliki 4 stat vital (0–100): **⚡ Energy**, **🍔 Hunger**, **💧 Thirst**, dan **❤️ Health**.',
                [
                    '• `/profile` — Lihat kartu identitas + avatar chibi, pekerjaan, hunian, skill, dan intip profil warga lain.',
                    '• `/wardrobe` — Kustomisasi 7 slot pakaian avatar chibi dan aktifkan buff busana profesi/langka.',
                    '• `/consume` — Makan, minum, pakai obat/vitamin, atau klik **🍴 Makan & Minum Otomatis**.',
                    '• `/sleep` — Tidur di hunianmu untuk memulihkan +50 s/d +100 ⚡ Energy.',
                    '• `/property` — Sewa Kos/Kontrakan atau beli Rumah untuk membuka Kulkas, Freezer, & Dapur.',
                    '• `/storage` — Simpan makanan/ikan ke Kulkas, Freezer, Gudang, atau Cooler Box.',
                    '• `/vehicle` — Kelola kendaraan, isi bensin di SPBU, dan servis berkala di bengkel.',
                    '• `/achievements` — Klaim hadiah pencapaian dan pasang Gelar Kehormatan (Title).',
                    '• `/event` — Cek cuaca 2 mingguan, bazar token event musiman, dan target komunitas.',
                    '• `/cooldowns` — Lihat semua jadwal tunggu dan kuota harian aktivitasmu.'
                ].join('\n')
            ],
            rows,
            footer: 'Saat offline, Hunger & Thirst berhenti turun di angka 20 sehingga karaktermu aman saat istirahat bermain.',
            ephemeral,
            now
        });
    }

    if (category === 'career') {
        return buildPanel({
            mod: 'help',
            ownerId: discordId,
            accentColor: COLORS.CAREER,
            title: '💼 Panduan: Karir & Pendidikan',
            player,
            blocks: [
                'Bangun karirmu dari pekerjaan dasar hingga profesi spesialis bergaji ratusan ribu Lp per shift.',
                [
                    '• `/job` — Lihat katalog lowongan kerja (Tier 0 s/d Tier 4), lamar profesi baru, atau resign.',
                    '• `/work` — Bekerja 1 shift (cooldown 60 mnt). Selesaikan mini-game untuk bonus +10% gaji!',
                    '• `/study` — Ikuti sesi belajar/kuliah (SD → SMP → SMA → D3/S1 → S2, cooldown 120 mnt).'
                ].join('\n'),
                '💡 **Promosi Otomatis:** Setiap profesi memiliki jenjang **Junior (0 shift)** → **Staff (30 shift, gaji ×1,15)** → **Senior (100 shift, ×1,30)** → **Kepala (250 shift, ×1,50)**.'
            ],
            rows,
            footer: 'Kuliah dan bekerja memiliki cooldown terpisah, namun berbagi pool Energy yang sama.',
            ephemeral,
            now
        });
    }

    if (category === 'activities') {
        return buildPanel({
            mod: 'help',
            ownerId: discordId,
            accentColor: COLORS.ACT,
            title: '🎣 Panduan: Memulung, Memancing, Menambang, Bertani & Memasak',
            player,
            blocks: [
                'Kumpulkan modal dari nol di `/bin`, beli alat pertamamu di `/shop`, lalu kelola perikanan, tambang, kebun, dan dapur.',
                [
                    '• `/bin` — Aduk tempat sampah kota (cooldown **5 detik**) untuk mencari rongsokan, makanan, umpan, atau alat bekas.',
                    '• `/fishing` — Wajib punya Pancingan & Umpan. Pilih lokasi, lempar kail (cooldown 3 mnt), dan jual ikan.',
                    '• `/mining` — Wajib punya Beliung. Pilih lokasi tambang, ayunkan beliung (cooldown 5 mnt), dan jual mineral.',
                    '• `/farm` — Sewa/beli petak kebun, tanam bibit, siram semua petak, pupuk, kompos, & panen.',
                    '• `/cook` — Masak ikan & hasil tani di tungku dapur propertimu menjadi hidangan ber-buff.'
                ].join('\n'),
                '💡 **Tips Pemula:** Karena pemain baru mulai dari **Lp 0 tanpa alat**, gunakan `/bin` untuk mencari dan menjual rongsokan hingga cukup membeli **🎋 Pancingan Bambu (Lp 50.000)** atau **🪨 Beliung Batu (Lp 60.000)** di `/shop`!'
            ],
            rows,
            footer: 'Setiap tangkapan baru otomatis tercatat di Fishpedia & Buku Mineral profilmu.',
            ephemeral,
            now
        });
    }

    if (category === 'economy') {
        return buildPanel({
            mod: 'help',
            ownerId: discordId,
            accentColor: COLORS.ECONOMY,
            title: '💰 Panduan: Ekonomi, Bank, Toko & Kredit',
            player,
            blocks: [
                'Kelola keuanganmu, belanja kebutuhan, dan pantau harga pasar dinamis.',
                [
                    '• `/bank` — Setor (Deposit) & Tarik (Withdraw) uang dengan tombol persentase cepat atau modal.',
                    '• `/shop` — Jelajahi 9 toko kota (termasuk Butik Busana) dan beli barang dengan tombol interaktif.',
                    '• `/sell` — Cek papan harga pasar 24 jam dan jual hasil pancing, tambang, tani, & masakan.',
                    '• `/gacha` — Putar Mesin Kapsul Warung, Mystery Box Mall, atau Brankas Sultan (1× & 10× Pull).',
                    '• `/inventory` — Lihat isi tas, perbaiki alat yang rusak, atau upgrade ukuran tas (hingga 130 slot).',
                    '• `/credit` — Cicil Motor Baru, Mobil, Rumah, atau Rumah Mewah dengan DP 20%.',
                    '• `/pay` — Pilih warga lewat User Select Menu dan transfer uang (pajak 5%).',
                    '• `/daily` — Ambil hadiah harian beruntun (streak 7 hari).',
                    '• `/leaderboard` — Lihat peringkat warga terkaya, pekerja terajin, & master 4 skill.'
                ].join('\n')
            ],
            rows,
            footer: 'Harga kebutuhan pokok di Warung dijamin tetap dan tidak pernah mengalami inflasi.',
            ephemeral,
            now
        });
    }

    return buildPanel({
        mod: 'help',
        ownerId: discordId,
        accentColor: COLORS.PRIMARY,
        title: '📖 Pusat Panduan Interaktif Life Simulation',
        player,
        blocks: [
            'Simulasi kehidupan ekonomi nyata di Discord: seluruh fitur dikemas dalam **1 Command = 1 Panel Interaktif** tanpa perlu mengetik subcommand!',
            [
                '**🚀 Cara Mulai dari Nol dalam 4 Langkah:**',
                '1️⃣ **Cari Modal Awal (`/bin`):** Buka `/bin` dan klik **🔍 Cari di Tempat Sampah** tiap 5 detik, lalu jual rongsokanmu!',
                '2️⃣ **Lamar Kerja & Beli Alat:** Lamar kerja di `/job` → `/work`, lalu beli **🎋 Pancingan Bambu** atau **🪨 Beliung Batu** di `/shop`.',
                '3️⃣ **Buka `/fishing` & `/mining`:** Setelah punya alat di tas, mulai memancing, menambang, atau bertani di `/farm`.',
                '4️⃣ **Kembangkan Diri:** Jaga stat tubuh di `/consume` & `/sleep`, kuliah di `/study`, dan tabung uang di `/bank`.'
            ].join('\n'),
            getDynamicRecommendation(player)
        ],
        rows,
        footer: 'Pilih kategori atau nama command pada menu dropdown di atas untuk melihat panduan lengkap.',
        ephemeral,
        now
    });
}

module.exports = {
    name: 'help',
    slash: true,
    skipRegistrationCheck: true,
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Buka pusat panduan interaktif, cara memulai, dan rincian seluruh command Life Simulation.'),

    async executeSlash(interaction) {
        const now = Date.now();
        const payload = await buildHelpCategoryPayload(interaction.user.id, 'home', false, null, now);
        return await interaction.reply(payload);
    },

    panel: {
        selects: {
            async cat(interaction) {
                const now = Date.now();
                const cat = interaction.values[0] || 'home';
                const payload = await buildHelpCategoryPayload(interaction.user.id, cat, false, null, now);
                return await interaction.update(payload);
            },
            async cmd(interaction) {
                const now = Date.now();
                const cmd = interaction.values[0] || '';
                const payload = await buildHelpCategoryPayload(interaction.user.id, 'home', false, cmd, now);
                return await interaction.update(payload);
            }
        }
    },

    buildHelpCategoryPayload
};
