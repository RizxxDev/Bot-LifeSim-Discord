const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { COLORS, formatLp, formatVitalsCompact, buildV2Card } = require('../../utils/uiBuilder');
const { withTransaction } = require('../../database/mariadb');
const { syncPlayerVitals } = require('../../services/vitalService');
const { getJob } = require('../../data/jobs');

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
        usage: '`/profile [user]`',
        cost: 'Tidak ada',
        cooldown: 'Tidak ada',
        tips: 'Menampilkan stat vital (Energy, Hunger, Thirst, Health), pendidikan, karir, level memancing/tambang, dan koleksi.'
    },
    eat: {
        title: '/eat — Makan untuk Mengisi Hunger',
        usage: '`/eat item:<makanan> [amount:1]`',
        cost: 'Item makanan di inventory',
        cooldown: 'Tidak ada',
        tips: 'Konsumsi otomatis berhenti saat Hunger mencapai 100 sehingga makanan berlebih tidak terbuang.'
    },
    drink: {
        title: '/drink — Minum untuk Mengisi Thirst',
        usage: '`/drink item:<minuman> [amount:1]`',
        cost: 'Item minuman di inventory',
        cooldown: 'Tidak ada',
        tips: 'Kopi dan Energy Drink juga menambah Energy, namun efeknya berkurang setelah konsumsi ke-2 di hari yang sama.'
    },
    use: {
        title: '/use — Gunakan Obat, Vitamin, atau Dokumen',
        usage: '`/use item:<nama_item> [amount:1]`',
        cost: 'Item di inventory',
        cooldown: 'Tidak ada',
        tips: 'Gunakan untuk obat pemulih Health, Vitamin C (regen 2x), Surat Izin Melaut, atau Akta Ganti Nama.'
    },
    sleep: {
        title: '/sleep — Tidur & Istirahat',
        usage: '`/sleep`',
        cost: 'Waktu istirahat 45–60 menit',
        cooldown: 'Hanya bisa saat Energy < 80',
        tips: 'Tidur memulihkan +50 Energy (atau +60 s/d +100 Energy jika kamu menyewa/membeli properti di /property).'
    },
    property: {
        title: '/property — Sewa Kos, Kontrakan & Beli Rumah',
        usage: '`/property list` · `/property info` · `/property rent` · `/property buy` · `/property status`',
        cost: 'Sewa mulai Lp 70.000/minggu atau beli tunai',
        cooldown: 'Tidak ada',
        tips: 'Properti membuka fasilitas Kulkas, Freezer, Tungku Dapur, Gudang, serta menambah bonus pemulihan /sleep!'
    },
    storage: {
        title: '/storage — Kulkas, Freezer, Gudang & Cooler Box',
        usage: '`/storage view` · `/storage put` · `/storage take`',
        cost: 'Membutuhkan fasilitas properti atau Cooler Box',
        cooldown: 'Tidak ada',
        tips: 'Simpan ikan & makanan segar di Kulkas (basi 3x lebih lambat) atau Freezer (tidak basi) agar tidak berubah menjadi Bahan Basi.'
    },
    vehicle: {
        title: '/vehicle — Garasi Kendaraan, Bensin SPBU & Servis',
        usage: '`/vehicle list` · `/vehicle status` · `/vehicle buy` · `/vehicle equip` · `/vehicle refuel` · `/vehicle service`',
        cost: 'Sepeda mulai Lp 1,5 juta · BBM Lp 10.000/liter',
        cooldown: 'Tidak ada',
        tips: 'Kendaraan memberi bonus gaji Kurir/Ojol, membuka profesi Taksi Online/Sopir Pribadi (Mobil + SIM A), dan hemat Energy ke lokasi jauh!'
    },
    credit: {
        title: '/credit — Pembiayaan Kredit Kendaraan & Properti',
        usage: '`/credit status` · `/credit apply` · `/credit pay` · `/credit payoff`',
        cost: 'DP 20% + Bunga Flat 5%–15% (Tenor 4, 8, 12, atau 24 minggu)',
        cooldown: 'Penagihan otomatis setiap minggu (Bank dulu, lalu Cash)',
        tips: 'Syarat: umur akun >= 14 hari, punya pekerjaan tetap, dan cicilan <= 50% penghasilan 7 hari terakhir. Lunasi dipercepat untuk hemat 50% sisa bunga!'
    },
    achievements: {
        title: '/achievements — Pencapaian Warga & Hadiah',
        usage: '`/achievements view [kategori]` · `/achievements claim`',
        cost: 'Tidak ada',
        cooldown: 'Tidak ada',
        tips: 'Selesaikan 24 tantangan di 6 kategori untuk membuka Gelar Kehormatan (Title) dan paket hadiah item!'
    },
    title: {
        title: '/title — Pasang Gelar Kehormatan (Title)',
        usage: '`/title list` · `/title equip gelar:<nama>` · `/title unequip`',
        cost: 'Tidak ada',
        cooldown: 'Tidak ada',
        tips: 'Pasang gelar dari Achievement, Event Musiman, atau Butik Prestise agar tampil keren di /profile.'
    },
    event: {
        title: '/event — Cuaca 2 Mingguan & Event Musiman',
        usage: '`/event info` · `/event shop` · `/event buy` · `/event goal` · `/event claim`',
        cost: 'Token Event dari aktivitas harian',
        cooldown: 'Cuaca berganti otomatis tiap 14 hari',
        tips: 'Cek cuaca (Musim Hujan vs Kemarau), kumpulkan token saat event berlangsung, dan nikmati THR Lebaran x1,5 gaji dasar selama 3 hari pertama Lebaran!'
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
        usage: '`/job list` · `/job info` · `/job apply` · `/job resign`',
        cost: 'Syarat pendidikan/item sesuai profesi',
        cooldown: 'Resign memiliki masa tunggu 24 jam sebelum melamar lagi',
        tips: 'Riwayat jumlah shift di setiap pekerjaan tetap tersimpan meskipun kamu pindah profesi.'
    },
    work: {
        title: '/work — Bekerja 1 Shift',
        usage: '`/work`',
        cost: '⚡ 20–25 Energy · 🍔 8 Hunger · 💧 10 Thirst',
        cooldown: '60 menit',
        tips: 'Selesaikan mini-game singkat dengan benar untuk mendapat 100% gaji + bonus 10%! Naik jabatan otomatis di 30, 100, dan 250 shift.'
    },
    study: {
        title: '/study — Belajar & Kuliah',
        usage: '`/study [jenjang]`',
        cost: '⚡ 15 Energy · 🍔 5 Hunger · 💧 6 Thirst + Biaya per sesi',
        cooldown: '120 menit',
        tips: 'Tingkatkan ijazah (SD → SMP → SMA → D3/S1 → S2) untuk membuka profesi bergaji tinggi. Bisa dilakukan sambil bekerja!'
    },
    fishing: {
        title: '/fishing — Memancing Ikan',
        usage: '`/fishing [lokasi] [umpan]`',
        cost: '⚡ 8 Energy · 🍔 3 Hunger · 💧 4 Thirst · 1 Umpan · -1 Durability Pancingan',
        cooldown: '3 menit',
        tips: 'Tunggu tombol "🎣 Tarik!" muncul lalu klik dalam 6 detik. Ikan Common & Uncommon bisa dijual di /sell atau dimakan lewat /eat.'
    },
    mining: {
        title: '/mining — Menambang Mineral & Permata',
        usage: '`/mining [lokasi]`',
        cost: '⚡ 12 Energy · 🍔 5 Hunger · 💧 6 Thirst · -1 Durability Beliung',
        cooldown: '5 menit',
        tips: 'Gunakan Helm Keselamatan untuk mengurangi risiko kecelakaan tambang sebesar 70% dan mengakses Tambang Emas/Berlian.'
    },
    farm: {
        title: '/farm — Perkebunan & Lahan Tani',
        usage: '`/farm view` · `/farm rent` · `/farm buy` · `/farm plant` · `/farm water` · `/farm fertilize` · `/farm harvest` · `/farm kompos`',
        cost: 'Sewa mulai Lp 15.000/mgg atau beli permanen mulai Lp 400.000 + Bibit Toko Tani',
        cooldown: 'Tumbuh 2 fase sesuai durasi tanaman (1–12 jam)',
        tips: 'Siram tanaman di Fase 1 (Tunas) dan Fase 2 (Berbunga). Panen sebelum 24 jam sejak matang agar tidak layu menjadi Bahan Basi!'
    },
    cook: {
        title: '/cook — Memasak Hidangan Rumahan di Dapur Properti',
        usage: '`/cook recipes` · `/cook start` · `/cook status` · `/cook collect`',
        cost: '⚡ 3 Energy/batch + 1× Muatan LPG atau Batu Bara + Bahan di Tas',
        cooldown: 'Durasi masak 20–120 detik per porsi',
        tips: 'Masak hingga 5 porsi sekaligus hanya dengan 1 bahan bakar! Hidangan rumahan memulihkan stat vital besar dan memberi buff.'
    },
    shop: {
        title: '/shop — Katalog Toko Kota',
        usage: '`/shop [toko]`',
        cost: 'Lp sesuai harga barang',
        cooldown: 'Tidak ada',
        tips: 'Jelajahi Warung, Restoran, Apotek, Perkakas (termasuk Upgrade Tas), Elektronik, Kantor Layanan, dan Butik Prestise.'
    },
    buy: {
        title: '/buy — Beli Cepat via Autocomplete',
        usage: '`/buy item:<nama_item> [amount:1]`',
        cost: 'Lp sesuai harga barang (otomatis potong Bank jika Cash kurang)',
        cooldown: 'Tidak ada',
        tips: 'Cara tercepat membeli makanan, umpan, atau obat tanpa perlu membuka katalog /shop.'
    },
    sell: {
        title: '/sell — Pasar Ikan, Pengepul Tambang & Bank Sampah',
        usage: '`/sell [item] [amount]`',
        cost: 'Item hasil pancing/tambang',
        cooldown: 'Tidak ada',
        tips: 'Ketik `/sell` tanpa argumen untuk melihat papan harga pasar dinamis saat ini!'
    },
    inventory: {
        title: '/inventory — Cek Isi Tas & Perbaiki Alat',
        usage: '`/inventory [kategori]`',
        cost: 'Tidak ada',
        cooldown: 'Tidak ada',
        tips: 'Pantau kapasitas slot tasmu, perbaiki pancingan/beliung yang rusak, atau upgrade ukuran tas.'
    },
    balance: {
        title: '/balance, /deposit, /withdraw — Dompet & Bank',
        usage: '`/balance` · `/deposit amount:<jumlah>` · `/withdraw amount:<jumlah>`',
        cost: 'Biaya admin bank Lp 10.000/bulan (gratis jika saldo < Lp 500.000)',
        cooldown: 'Tidak ada',
        tips: 'Simpan uangmu di Bank agar aman dari pemotongan biaya Rumah Sakit saat pingsan.'
    },
    pay: {
        title: '/pay — Transfer Uang Antar Warga',
        usage: '`/pay user:@target amount:<jumlah>`',
        cost: 'Pajak transfer 5% ditanggung pengirim',
        cooldown: 'Batas kirim Lp 1.000.000/hari',
        tips: 'Syarat: akun minimal berumur 7 hari dan memiliki ≥20 shift kerja atau total level skill ≥10.'
    },
    daily: {
        title: '/daily — Klaim Hadiah Harian',
        usage: '`/daily`',
        cost: 'Tidak ada',
        cooldown: 'Setiap hari (reset 00:00 WIB, streak putus jika >36 jam)',
        tips: 'Jaga streak 7 hari berturut-turut untuk mendapatkan paket bekal, umpan pro, dan bonus uang tunai di hari ke-7.'
    },
    leaderboard: {
        title: '/leaderboard — Papan Peringkat Global',
        usage: '`/leaderboard [kategori]`',
        cost: 'Tidak ada',
        cooldown: 'Cache diperbarui tiap 5 menit',
        tips: 'Bandingkan total kekayaan, pengalaman kerja, level memancing, dan level menambang di seluruh server.'
    }
};

function buildHelpCategorySelect(activeCategory = 'home') {
    const select = new StringSelectMenuBuilder()
        .setCustomId('help_select_category')
        .setPlaceholder('📂 Pilih kategori panduan...')
        .addOptions([
            {
                label: 'Beranda & Cara Mulai',
                value: 'home',
                emoji: '🏠',
                description: 'Ringkasan 4 langkah awal dan rekomendasi langkah berikutnya',
                default: activeCategory === 'home'
            },
            {
                label: 'Kehidupan & Stat Vital',
                value: 'life',
                emoji: '🧍',
                description: '/profile, /eat, /drink, /use, /sleep, /cooldowns',
                default: activeCategory === 'life'
            },
            {
                label: 'Karir & Pendidikan',
                value: 'career',
                emoji: '💼',
                description: '/job, /work, /study',
                default: activeCategory === 'career'
            },
            {
                label: 'Memancing, Tambang, Tani & Masak',
                value: 'activities',
                emoji: '🎣',
                description: '/fishing, /mining, /farm, /cook, alat & resep',
                default: activeCategory === 'activities'
            },
            {
                label: 'Ekonomi, Toko & Tas',
                value: 'economy',
                emoji: '💰',
                description: '/shop, /buy, /sell, /inventory, /balance, /pay, /daily',
                default: activeCategory === 'economy'
            }
        ]);

    return new ActionRowBuilder().addComponents(select);
}

function getDynamicRecommendation(player) {
    if (!player) {
        return '👉 **Rekomendasi Saat Ini:** Kamu belum memiliki karakter! Klik tombol **🌱 Mulai Hidup Baru** atau ketik `/start`.';
    }
    if (player.hunger < 35 || player.thirst < 35) {
        return '👉 **Rekomendasi Saat Ini:** Perutmu mulai lapar/haus! Gunakan `/eat` dan `/drink` dari bekal di tasmu agar hasil kerjamu tidak berkurang.';
    }
    if (player.energy < 20) {
        return '👉 **Rekomendasi Saat Ini:** ⚡ Energy kamu rendah! Gunakan `/sleep` untuk istirahat atau minum kopi/energy drink.';
    }
    if (!player.current_job) {
        return '👉 **Rekomendasi Saat Ini:** Kamu belum punya pekerjaan tetap! Ketik `/job list` lalu lamar profesi awal dengan `/job apply`.';
    }
    const job = getJob(player.current_job);
    return `👉 **Rekomendasi Saat Ini:** Jalani shift sebagai **${job ? job.name : player.current_job}** dengan \`/work\`, tingkatkan ijazah lewat \`/study\`, atau cari penghasilan tambahan di \`/fishing\` & \`/mining\`!`;
}

async function buildHelpCategoryPayload(discordId, category = 'home', ephemeral = true) {
    let player = null;
    try {
        const synced = await withTransaction(conn => syncPlayerVitals(conn, discordId));
        if (synced) player = synced.player;
    } catch {
        // ignore if DB not ready
    }

    const selectRow = buildHelpCategorySelect(category);
    const actionRows = [selectRow];

    if (!player) {
        actionRows.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('reg_open_modal')
                    .setLabel('Mulai Hidup Baru')
                    .setEmoji('🌱')
                    .setStyle(ButtonStyle.Success)
            )
        );
    }

    if (category === 'life') {
        return buildV2Card({
            accentColor: COLORS.LIFE,
            title: '🧍 Panduan: Kehidupan & Stat Vital',
            blocks: [
                'Karaktermu memiliki 4 stat vital (0–100): **⚡ Energy**, **🍔 Hunger**, **💧 Thirst**, dan **❤️ Health**.',
                [
                    '• `/profile [user]` — Lihat kartu identitas, pekerjaan, hunian, skill, dan kondisimu.',
                    '• `/eat item [amount]` — Makan item dari tas untuk memulihkan 🍔 Hunger (FIFO).',
                    '• `/drink item [amount]` — Minum item dari tas untuk memulihkan 💧 Thirst.',
                    '• `/use item [amount]` — Pakai obat, vitamin, surat izin, atau akta ganti nama.',
                    '• `/sleep` — Tidur di hunianmu untuk memulihkan +50 s/d +100 ⚡ Energy.',
                    '• `/property` — Sewa Kos/Kontrakan atau beli Rumah untuk membuka Kulkas, Freezer, & Dapur.',
                    '• `/storage` — Simpan makanan/ikan ke Kulkas, Freezer, Gudang, atau Cooler Box.',
                    '• `/vehicle` — Kelola kendaraan, isi bensin di SPBU, dan servis berkala di bengkel.',
                    '• `/achievements` & `/title` — Klaim hadiah pencapaian dan pasang Gelar Kehormatan.',
                    '• `/event` — Cek cuaca 2 mingguan, toko token event musiman, dan target komunitas.',
                    '• `/cooldowns` — Lihat semua jadwal tunggu aktivitasmu.'
                ].join('\n'),
                '💡 **Tips Penting:** Saat kamu *offline*, Hunger dan Thirst berhenti berkurang di angka **20** (kamu tidak akan pingsan karena libur bermain). Namun jangan beraktivitas saat Hunger/Thirst = 0 agar Health tidak habis dan masuk Rumah Sakit!'
            ],
            actionRows,
            footer: 'Ketik /help command:<nama> untuk rincian mendalam tiap command.',
            ephemeral
        });
    }

    if (category === 'career') {
        return buildV2Card({
            accentColor: COLORS.CAREER,
            title: '💼 Panduan: Karir & Pendidikan',
            blocks: [
                'Bangun karirmu dari pekerjaan dasar hingga profesi spesialis bergaji ratusan ribu Lp per shift.',
                [
                    '• `/job list` — Lihat daftar lowongan kerja (Tier 0 s/d Tier 4) beserta syaratnya.',
                    '• `/job apply pekerjaan:<nama>` — Lamar pekerjaan yang syaratnya sudah kamu penuhi.',
                    '• `/work` — Bekerja 1 shift (cooldown 60 mnt). Selesaikan mini-game untuk bonus +10% gaji!',
                    '• `/study [jenjang]` — Ikuti sesi belajar/kuliah (SD → SMP → SMA → D3/S1 → S2, cooldown 120 mnt).',
                    '• `/job resign` — Mengundurkan diri dari pekerjaan saat ini (jeda 24 jam sebelum melamar lagi).'
                ].join('\n'),
                '💡 **Promosi Otomatis:** Setiap profesi memiliki jenjang **Junior (0 shift)** → **Staff (30 shift, gaji ×1,15)** → **Senior (100 shift, ×1,30)** → **Kepala (250 shift, ×1,50)**.'
            ],
            actionRows,
            footer: 'Kuliah dan bekerja memiliki cooldown terpisah, namun berbagi pool Energy yang sama.',
            ephemeral
        });
    }

    if (category === 'activities') {
        return buildV2Card({
            accentColor: COLORS.ACT,
            title: '🎣 Panduan: Memancing, Menambang, Bertani & Memasak',
            blocks: [
                'Cari penghasilan tambahan, kelola perkebunan, dan olah hasil panen/tangkapan menjadi masakan bernilai tinggi.',
                [
                    '• `/fishing [lokasi] [umpan]` — Memancing ikan (cooldown 3 mnt, butuh Pancingan & Umpan).',
                    '• `/mining [lokasi]` — Menambang bijih & permata (cooldown 5 mnt, butuh Beliung).',
                    '• `/farm` — Sewa/beli petak kebun, tanam bibit Toko Tani, siram 2 fase, pupuk, dan panen.',
                    '• `/cook` — Masak ikan & hasil tani di tungku dapur propertimu menjadi hidangan ber-buff.',
                    '• `/sell` — Jual tangkapan, hasil tani, atau masakan ke Pasar Dinamis.',
                    '• `/inventory` — Cek durability alat, perbaiki alat yang rusak, atau upgrade kapasitas tas.'
                ].join('\n'),
                '💡 **Tips Produksi:** Simpan hasil panen dan masakan di **Kulkas/Freezer** (`/storage`) agar awet, atau olah **5× Bahan Basi** menjadi **Pupuk Kompos** lewat `/farm kompos`!'
            ],
            actionRows,
            footer: 'Setiap tangkapan baru otomatis tercatat di Fishpedia & Buku Mineral profilmu.',
            ephemeral
        });
    }

    if (category === 'economy') {
        return buildV2Card({
            accentColor: COLORS.ECONOMY,
            title: '💰 Panduan: Ekonomi, Toko & Tas',
            blocks: [
                'Kelola keuanganmu, belanja kebutuhan, dan pantau harga pasar dinamis.',
                [
                    '• `/shop` — Buka katalog interaktif per toko (Warung, Restoran, Apotek, Perkakas, dll).',
                    '• `/buy item [amount]` — Beli barang secara cepat dengan fitur autocomplete.',
                    '• `/sell [item] [amount]` — Jual hasil pancing/tambang atau cek papan harga pasar 24 jam.',
                    '• `/inventory` — Lihat isi tas (mulai 20 slot, bisa di-upgrade hingga 130 slot).',
                    '• `/balance` · `/deposit` · `/withdraw` — Kelola uang tunai (Cash) dan tabungan Bank.',
                    '• `/credit` — Cicil Motor Baru, Mobil, Rumah, atau Rumah Mewah dengan DP 20%.',
                    '• `/pay user amount` — Transfer uang ke warga lain (pajak 5%, akun ≥7 hari).',
                    '• `/daily` — Ambil hadiah harian beruntun (streak 7 hari).',
                    '• `/leaderboard` — Lihat peringkat warga terkaya & terajin.'
                ].join('\n')
            ],
            actionRows,
            footer: 'Harga kebutuhan pokok di Warung dijamin tetap dan tidak pernah mengalami inflasi.',
            ephemeral
        });
    }

    // Default: HOME
    const statusLine = player
        ? `👤 **${player.username}** · 💵 ${formatLp(player.cash)} · 🏦 ${formatLp(player.bank)}\n${formatVitalsCompact(player)}`
        : '👤 **Status:** Belum Terdaftar — Ketik `/start` atau klik tombol di bawah untuk memulai!';

    return buildV2Card({
        accentColor: COLORS.PRIMARY,
        title: '📖 Pusat Panduan Life Simulation',
        blocks: [
            'Simulasi kehidupan ekonomi nyata di Discord: bekerja, kuliah, jaga kondisi tubuh, memancing, menambang, dan kelola keuangannya.',
            statusLine,
            [
                '**🚀 Cara Mulai dalam 4 Langkah:**',
                '1️⃣ **Lamar Kerja:** Ketik `/job list` lalu pilih pekerjaan awalmu dengan `/job apply`.',
                '2️⃣ **Cari Penghasilan:** Jalankan `/work` setiap jam, serta sambi dengan `/fishing` atau `/mining`.',
                '3️⃣ **Jaga Kondisi Tubuh:** Makan (`/eat`) dan minum (`/drink`) saat lapar/haus, atau `/sleep` saat lelah.',
                '4️⃣ **Kembangkan Diri:** Tingkatkan pendidikan lewat `/study`, upgrade alat & tas di `/shop`, dan jual hasil alam di `/sell`.'
            ].join('\n'),
            getDynamicRecommendation(player)
        ],
        actionRows,
        footer: 'Gunakan menu di atas untuk melihat daftar command per kategori, atau /help command:<nama>.',
        ephemeral
    });
}

module.exports = {
    name: 'help',
    slash: true,
    skipRegistrationCheck: true,
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Panduan bermain ringkas, cara memulai, dan daftar command Life Simulation.')
        .addStringOption(opt =>
            opt
                .setName('command')
                .setDescription('Nama command yang ingin dilihat rinciannya')
                .setAutocomplete(true)
                .setRequired(false)
        ),

    async autocomplete(interaction) {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        const choices = Object.keys(COMMAND_DETAILS)
            .filter(cmd => cmd.includes(focused))
            .slice(0, 25)
            .map(cmd => ({
                name: `/${cmd} — ${COMMAND_DETAILS[cmd].title.split('—')[1]?.trim() || ''}`,
                value: cmd
            }));
        await interaction.respond(choices);
    },

    async executeSlash(interaction) {
        const cmdName = interaction.options.getString('command')?.toLowerCase().replace(/^\//, '');
        if (cmdName && COMMAND_DETAILS[cmdName]) {
            const info = COMMAND_DETAILS[cmdName];
            return await interaction.reply(
                buildV2Card({
                    accentColor: COLORS.PRIMARY,
                    title: `📘 Detail Command: ${info.title}`,
                    blocks: [
                        `• **Cara Pakai:** ${info.usage}\n• **Biaya / Syarat:** ${info.cost}\n• **Cooldown:** ${info.cooldown}`,
                        `💡 **Tips:** ${info.tips}`
                    ],
                    actionRows: [buildHelpCategorySelect('home')],
                    ephemeral: true
                })
            );
        }

        const payload = await buildHelpCategoryPayload(interaction.user.id, 'home', true);
        return await interaction.reply(payload);
    },

    buildHelpCategoryPayload
};
