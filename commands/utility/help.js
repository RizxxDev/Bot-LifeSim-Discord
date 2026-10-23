const { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ComponentType 
} = require('discord.js');
const config = require('../../config.json');
const { baseEmbed, colors } = require('../../utils/ui');
const { send, edit, isSlashContext } = require('../../utils/respond');

// ==========================================
// 1. DATA MASTER KATEGORI
// ==========================================
const CATEGORIES = {
    home: {
        id: 'home',
        name: 'Beranda & Panduan Awal',
        emoji: '🏠',
        description: 'Ringkasan panduan cara bermain dan navigasi direktori perintah.',
        color: colors.primary
    },
    economy: {
        id: 'economy',
        name: 'Ekonomi & Finansial',
        emoji: '💰',
        description: 'Pengelolaan saldo dompet, tabungan bank, reward daily, shift kerja, dan profil warga.',
        color: colors.money,
        commands: ['bank', 'daily', 'work', 'pay', 'profile', 'leaderboard', 'inventory', 'phone']
    },
    farm: {
        id: 'farm',
        name: 'Pertanian & Industri',
        emoji: '🌾',
        description: 'Bercocok tanam modular 5x5, lumbung panen, resep crafting olahan, dan pasar bebas.',
        color: colors.farm,
        commands: ['farm', 'craft', 'market']
    },
    shop: {
        id: 'shop',
        name: 'Toko Global NPC',
        emoji: '🏪',
        description: 'Belanja bibit, peralatan kerja, konsumsi, dan penjualan komoditas berharga dinamis.',
        color: colors.warning,
        commands: ['shop', 'buy', 'sell']
    },
    activity: {
        id: 'activity',
        name: 'Profesi & Minigame',
        emoji: '⛏️',
        description: 'Pusat karir, pohon skill pasif, serta minigame interaktif memancing dan menambang.',
        color: colors.craft,
        commands: ['job', 'skill', 'mine', 'fish']
    },
    utility: {
        id: 'utility',
        name: 'Sistem & Bantuan',
        emoji: '⚙️',
        description: 'Registrasi kependudukan, pengecekan status sistem, dan direktori panduan bot.',
        color: colors.primary,
        commands: ['register', 'ping', 'help']
    }
};

const CATEGORY_ORDER = ['home', 'economy', 'farm', 'shop', 'activity', 'utility'];

// ==========================================
// 2. DATA DETAIL PERINTAH
// ==========================================
const COMMAND_DETAILS = {
    bank: {
        name: 'bank',
        category: 'economy',
        summary: 'Manajemen perbankan: cek saldo, deposit, penarikan, dan transfer antar rekening.',
        cooldown: '5 detik',
        registration: false,
        aliases: ['atm', 'bal', 'balance'],
        subcommands: [
            { name: '/bank info', prefix: '!bank', desc: 'Cek saldo tunai di dompet dan saldo tabungan di bank.' },
            { name: '/bank deposit <amount|all>', prefix: '!bank dep <amount>', desc: 'Setor uang tunai ke rekening bank untuk keamanan.' },
            { name: '/bank withdraw <amount|all>', prefix: '!bank wd <amount>', desc: 'Tarik uang tabungan dari bank menjadi uang tunai.' },
            { name: '/bank transfer <target> <amount>', prefix: '!bank tf @user <amount>', desc: 'Transfer saldo bank langsung ke rekening pemain lain.' }
        ],
        tips: 'Menyimpan uang di bank melindungi asetmu saat bertransaksi dan mempermudah pembayaran besar.'
    },
    daily: {
        name: 'daily',
        category: 'economy',
        summary: 'Klaim hadiah uang tunai harian gratis dan pertahankan runtunan streak.',
        cooldown: '5 detik (Reset 24 Jam)',
        registration: false,
        aliases: ['claim', 'd'],
        subcommands: [
            { name: '/daily', prefix: '!daily', desc: 'Klaim reward harian (Lp 1.500 + Lp 300 per hari streak).' }
        ],
        tips: 'Jangan sampai absen lebih dari 48 jam! Streak yang terputus akan mengulang bonus dari hari ke-1.'
    },
    work: {
        name: 'work',
        category: 'economy',
        summary: 'Bekerja shift untuk menghasilkan uang tunai dan poin EXP karakter.',
        cooldown: '1 Jam (Bisa dipotong skill Cooldown)',
        registration: false,
        aliases: ['kerja', 'w'],
        subcommands: [
            { name: '/work', prefix: '!work', desc: 'Menjalankan shift kerja untuk mendapatkan uang & EXP.' }
        ],
        tips: 'Tingkatkan Job Mastery lewat `/job` dan pohon skill `/skill` untuk mendapatkan gaji berlipat ganda.'
    },
    pay: {
        name: 'pay',
        category: 'economy',
        summary: 'Kirimkan uang tunai langsung dari dompetmu ke dompet pemain lain.',
        cooldown: '5 detik',
        registration: false,
        aliases: ['give', 'transfercash'],
        subcommands: [
            { name: '/pay <target> <amount>', prefix: '!pay @user <amount>', desc: 'Kirim uang tunai cair secara instan ke sesama warga.' }
        ],
        tips: 'Pastikan saldo tunai di dompetmu mencukupi sebelum mentransfer.'
    },
    profile: {
        name: 'profile',
        category: 'economy',
        summary: 'Melihat kartu identitas kependudukan, level RPG, EXP, SP, karir, dan keuangan.',
        cooldown: '3 detik',
        registration: true,
        aliases: ['p', 'stats', 'me'],
        subcommands: [
            { name: '/profile', prefix: '!profile', desc: 'Buka kartu profil karakter lengkap.' }
        ],
        tips: 'Setiap naik level, kamu akan mendapatkan Skill Points (SP) untuk diinvestasikan di `/skill`.'
    },
    leaderboard: {
        name: 'leaderboard',
        category: 'economy',
        summary: 'Papan peringkat 10 warga terkaya di kota berdasarkan akumulasi tunai dan tabungan.',
        cooldown: '5 detik',
        registration: false,
        aliases: ['lb', 'top', 'rich'],
        subcommands: [
            { name: '/leaderboard', prefix: '!leaderboard', desc: 'Lihat daftar 10 taipan terkaya kota.' }
        ],
        tips: 'Didukung oleh Redis Cache berkecepatan tinggi yang diperbarui secara otomatis.'
    },
    inventory: {
        name: 'inventory',
        category: 'economy',
        summary: 'Membuka tas ransel bawaan utama untuk memeriksa alat, bibit, dan hasil tambang/mancing.',
        cooldown: '5 detik',
        registration: true,
        aliases: ['inv', 'bag', 'tas'],
        subcommands: [
            { name: '/inventory', prefix: '!inventory', desc: 'Buka tas ransel bawaan karakter.' }
        ],
        tips: 'Komoditas hasil panen ladang disimpan terpisah di gudang lumbung (`/farm storage`).'
    },
    phone: {
        name: 'phone',
        category: 'economy',
        summary: 'Mengoperasikan smartphone interaktif untuk mobile banking dan status warga.',
        cooldown: '5 detik',
        registration: true,
        aliases: ['hp', 'smartphone', 'gadget'],
        subcommands: [
            { name: '/phone', prefix: '!phone', desc: 'Buka smartphone interaktif dengan menu dropdown.' }
        ],
        tips: 'Dilengkapi menu Home, Mobile Banking, Profil Warga, dan tombol Power Off.'
    },
    farm: {
        name: 'farm',
        category: 'farm',
        summary: 'Sistem ladang modular 5x5: menanam bibit, menyiram tanaman, dan memanen komoditas.',
        cooldown: '5 detik',
        registration: true,
        aliases: ['ladang', 'kebun'],
        subcommands: [
            { name: '/farm view', prefix: '!farm', desc: 'Melihat peta grid ladang 5x5 dan status tanaman.' },
            { name: '/farm plant <x> <y> <crop>', prefix: '!farm plant 1 1 wheat', desc: 'Menanam 1 petak tanah tertentu.' },
            { name: '/farm plantall <crop>', prefix: '!farm plantall wheat', desc: 'Menanam seluruh petak kosong sekaligus (Batch Multi-row).' },
            { name: '/farm water <x> <y>', prefix: '!farm water 1 1', desc: 'Menyiram 1 tanaman (tumbuh 2x lebih cepat).' },
            { name: '/farm waterall', prefix: '!farm waterall', desc: 'Menyiram seluruh tanaman yang sedang tumbuh sekaligus.' },
            { name: '/farm harvest <x> <y>', prefix: '!farm harvest 1 1', desc: 'Memanen 1 petak yang sudah matang (growth 100%).' },
            { name: '/farm harvestall', prefix: '!farm harvestall', desc: 'Memanen seluruh tanaman yang matang sekaligus ke lumbung.' },
            { name: '/farm storage', prefix: '!farm storage', desc: 'Melihat isi dan kapasitas lumbung hasil panen.' }
        ],
        tips: 'Tanaman yang disiram akan mendapatkan akselerasi pertumbuhan 2x lipat pada setiap tick game loop!'
    },
    craft: {
        name: 'craft',
        category: 'farm',
        summary: 'Dapur pengolahan bahan mentah menjadi makanan dan produk olahan bernilai tinggi.',
        cooldown: '3 detik',
        registration: true,
        aliases: ['buat', 'masak', 'olah'],
        subcommands: [
            { name: '/craft list', prefix: '!craft list', desc: 'Melihat resep olahan, bahan yang dibutuhkan, dan waktu proses.' },
            { name: '/craft start <recipe> [amount]', prefix: '!craft start flour 2', desc: 'Memulai proses pengolahan bahan.' },
            { name: '/craft queue', prefix: '!craft queue', desc: 'Memeriksa antrean masakan yang sedang berjalan.' },
            { name: '/craft claim <queue_id>', prefix: '!craft claim 1', desc: 'Mengambil hasil olahan yang sudah selesai dibuat.' }
        ],
        tips: 'Produk olahan seperti roti (`bread`) memberikan margin keuntungan jauh lebih besar saat dijual ke toko.'
    },
    market: {
        name: 'market',
        category: 'farm',
        summary: 'Bursa perdagangan bebas antar pemain untuk memperjualbelikan komoditas lumbung.',
        cooldown: '3 detik',
        registration: true,
        aliases: ['pasarpemain', 'trade'],
        subcommands: [
            { name: '/market list', prefix: '!market', desc: 'Melihat daftar penawaran komoditas aktif di bursa.' },
            { name: '/market sell <item> <amount> <price>', prefix: '!market sell wheat 10 500', desc: 'Membuka penawaran jual barang dari lumbung.' },
            { name: '/market buy <id>', prefix: '!market buy 1', desc: 'Membeli penawaran listing milik pemain lain.' }
        ],
        tips: 'Setiap listing dikenakan biaya pendaftaran Lp 50 dan pajak pasar sebesar 5% dari total harga.'
    },
    shop: {
        name: 'shop',
        category: 'shop',
        summary: 'Katalog toko NPC dengan sistem harga dinamis fluktuatif (Supply & Demand).',
        cooldown: '3 detik',
        registration: true,
        aliases: ['toko', 'pasar'],
        subcommands: [
            { name: '/shop', prefix: '!shop', desc: 'Lihat katalog harga beli/jual serta kapasitas gudang toko.' }
        ],
        tips: 'Harga toko otomatis turun jika stok melimpah dan melonjak tinggi saat stok menipis!'
    },
    buy: {
        name: 'buy',
        category: 'shop',
        summary: 'Membeli bibit pertanian, peralatan perkakas, atau bahan konsumsi dari toko global.',
        cooldown: '5 detik',
        registration: true,
        aliases: ['beli'],
        subcommands: [
            { name: '/buy <item> <amount>', prefix: '!buy wheat_seed 5', desc: 'Membeli barang dari toko (1 - 100 unit).' }
        ],
        tips: 'Pastikan uang tunai di dompetmu cukup sebelum melakukan pembelian.'
    },
    sell: {
        name: 'sell',
        category: 'shop',
        summary: 'Menjual hasil panen, ikan, atau mineral ke toko global untuk mendapatkan uang instan.',
        cooldown: '5 detik',
        registration: true,
        aliases: ['jual'],
        subcommands: [
            { name: '/sell <item> <amount>', prefix: '!sell wheat 10', desc: 'Menjual barang ke toko (1 - 500 unit).' }
        ],
        tips: 'Toko hanya dapat membeli jika kas likuiditas dan kapasitas gudangnya mencukupi.'
    },
    job: {
        name: 'job',
        category: 'activity',
        summary: 'Pusat bursa kerja warga kota: lowongan profesi, jenjang karir, dan Job Mastery.',
        cooldown: '3 detik',
        registration: false,
        aliases: ['pekerjaan', 'karir'],
        subcommands: [
            { name: '/job list', prefix: '!job list', desc: 'Daftar lowongan profesi, gaji, cooldown, dan syarat level.' },
            { name: '/job info', prefix: '!job info', desc: 'Informasi profesi aktif dan progres mastery karir.' },
            { name: '/job apply <job_id>', prefix: '!job apply janitor', desc: 'Melamar profesi yang sesuai dengan level karakter.' },
            { name: '/job resign', prefix: '!job resign', desc: 'Mengundurkan diri dari pekerjaan saat ini.' }
        ],
        tips: 'Tingkatkan level karakter ke Lv. 5 untuk melamar sebagai Programmer dengan gaji hingga Lp 4.000 per shift!'
    },
    skill: {
        name: 'skill',
        category: 'activity',
        summary: 'Pohon keahlian pasif untuk memaksimalkan produktivitas hidup dan karir warga.',
        cooldown: '3 detik',
        registration: true,
        aliases: ['skills', 'upgrade'],
        subcommands: [
            { name: '/skill view', prefix: '!skill', desc: 'Lihat status level skill pasif dan sisa poin SP.' },
            { name: '/skill upgrade <type>', prefix: '!skill upgrade income', desc: 'Naikkan skill: income, cooldown_skill, luck, defense.' },
            { name: '/skill reset', prefix: '!skill reset', desc: 'Reset seluruh skill dan kembalikan seluruh poin SP (biaya Lp 1.000).' }
        ],
        tips: 'Skill Income menambah gaji dasar, sementara Cooldown memangkas jeda waktu istirahat kerja.'
    },
    mine: {
        name: 'mine',
        category: 'activity',
        summary: 'Sesi penambangan bijih mineral interaktif: Scan kelemahan, Charge energi, dan Strike batu.',
        cooldown: '8 detik',
        registration: true,
        aliases: ['mining', 'nambang'],
        subcommands: [
            { name: '/mine', prefix: '!mine', desc: 'Memulai sesi menambang batu dan mineral langka.' }
        ],
        tips: 'Wajib membawa Pickaxe di tas. Gunakan Scan terlebih dahulu sebelum Strike untuk damage maksimal!'
    },
    fish: {
        name: 'fish',
        category: 'activity',
        summary: 'Sesi memancing ikan interaktif dengan uji ketangkasan reaksi cepat (Quick Time Event).',
        cooldown: '15 detik',
        registration: true,
        aliases: ['mancing', 'fishing'],
        subcommands: [
            { name: '/fish', prefix: '!fish', desc: 'Melemparkan kail pancing dan tunggu sambaran ikan.' }
        ],
        tips: 'Membawa Umpan (Bait) dan Pro Fishing Rod meningkatkan peluang menyambar Ikan Hiu Putih (White Shark)!'
    },
    register: {
        name: 'register',
        category: 'utility',
        summary: 'Mendaftarkan KTP warga baru ke database kota dan menerima paket modal awal.',
        cooldown: '5 detik',
        registration: false,
        aliases: ['reg', 'start'],
        subcommands: [
            { name: '/register', prefix: '!register', desc: 'Buat identitas warga baru & klaim modal Lp 10.000.' }
        ],
        tips: 'Wajib dijalankan pertama kali sebelum bisa mengoperasikan ladang, inventaris, dan belanja toko.'
    },
    ping: {
        name: 'ping',
        category: 'utility',
        summary: 'Pemeriksaan status kesehatan sistem: latensi Discord Gateway, MariaDB, dan Redis.',
        cooldown: '3 detik',
        registration: false,
        aliases: ['pong', 'status'],
        subcommands: [
            { name: '/ping', prefix: '!ping', desc: 'Cek latensi dan status koneksi database.' }
        ],
        tips: 'Bila Redis offline, bot secara otomatis beralih ke in-memory cooldown fallback tanpa downtime.'
    },
    help: {
        name: 'help',
        category: 'utility',
        summary: 'Pusat direktori panduan interaktif seluruh fitur dan perintah bot.',
        cooldown: '3 detik',
        registration: false,
        aliases: ['h', 'commands'],
        subcommands: [
            { name: '/help', prefix: '!help', desc: 'Membuka menu utama panduan interaktif.' },
            { name: '/help command:<name>', prefix: '!help <name>', desc: 'Melihat panduan spesifik dan mendalam dari satu perintah.' }
        ],
        tips: 'Gunakan menu dropdown untuk menjelajahi seluruh modul bot dengan cepat.'
    }
};

module.exports = {
    name: 'help',
    aliases: ['h', 'commands', 'panduan', 'bantuan'],
    prefix: true,
    slash: true,
    requiresRegistration: false,
    cooldown: 3,
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Buka pusat panduan dan direktori perintah bot.')
        .addStringOption(opt =>
            opt.setName('command')
                .setDescription('Nama perintah yang ingin diperiksa secara spesifik')
                .setRequired(false)
                .setAutocomplete(true)
        ),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const commandKeys = Object.keys(COMMAND_DETAILS);
        const filtered = commandKeys
            .filter(name => name.toLowerCase().includes(focusedValue))
            .slice(0, 25);

        await interaction.respond(
            filtered.map(name => ({
                name: `/${name} — ${COMMAND_DETAILS[name].summary.slice(0, 70)}...`,
                value: name
            }))
        );
    },

    async executeSlash(interaction) {
        const commandArg = interaction.options.getString('command');
        await runHelp(interaction, interaction.user, commandArg);
    },

    async executePrefix(message, args) {
        const commandArg = args[0]?.toLowerCase();
        await runHelp(message, message.author, commandArg);
    }
};

// ==========================================
// 3. LOGIC UTAMA HELP INTERAKTIF
// ==========================================
async function runHelp(context, user, specificCommand) {
    const client = context.client;

    // A. Jika pemain mencari perintah spesifik (misal /help command:farm atau !help farm)
    if (specificCommand) {
        const cmdKey = specificCommand.toLowerCase().replace(/^[!/]/, '');
        const detail = COMMAND_DETAILS[cmdKey] || findCommandByAlias(cmdKey);

        if (detail) {
            const embed = buildCommandDetailEmbed(detail, user, client);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`help_back_home:${user.id}`)
                    .setLabel('Kembali ke Menu Utama')
                    .setEmoji('🏠')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`help_close:${user.id}`)
                    .setLabel('Tutup')
                    .setEmoji('🗑️')
                    .setStyle(ButtonStyle.Secondary)
            );

            const response = await send(context, { embeds: [embed], components: [row], fetchReply: true });
            attachDetailCollector(response, context, user, client);
            return;
        }
    }

    // B. Tampilan Menu Interaktif Utama (Default: Beranda)
    let currentCategory = 'home';
    const payload = renderPage(currentCategory, user, client);
    const response = await send(context, { ...payload, fetchReply: true });

    const message = response && typeof response.createMessageComponentCollector === 'function'
        ? response
        : (context.fetchReply ? await context.fetchReply() : response);

    if (!message || typeof message.createMessageComponentCollector !== 'function') return;

    const collector = message.createMessageComponentCollector({
        time: 120000 // 2 menit timeout
    });

    collector.on('collect', async (interaction) => {
        // Keamanan: Hanya pemanggil yang boleh berinteraksi
        if (interaction.user.id !== user.id) {
            await interaction.reply({
                content: `❌ Menu panduan ini dibuka oleh **${user.username}**. Ketik \`/help\` untuk membuka panduan milikmu sendiri!`,
                ephemeral: true
            }).catch(() => {});
            return;
        }

        const customId = interaction.customId;

        // 1. Tombol Tutup
        if (customId.startsWith('help_close')) {
            collector.stop('closed');
            if (isSlashContext(context) && !interaction.replied) {
                await interaction.update({
                    embeds: [
                        baseEmbed({
                            title: '🔒 Menu Panduan Ditutup',
                            description: 'Sesi pusat bantuan telah selesai. Ketik `/help` kapan pun kamu butuh bantuan lagi!',
                            color: colors.muted,
                            user
                        })
                    ],
                    components: []
                }).catch(() => {});
            } else {
                await interaction.message.delete().catch(() => {});
            }
            return;
        }

        await interaction.deferUpdate().catch(() => {});

        // 2. Select Menu Pilihan Kategori
        if (interaction.isStringSelectMenu() && customId.startsWith('help_category')) {
            currentCategory = interaction.values[0];
            await interaction.editReply(renderPage(currentCategory, user, client)).catch(() => {});
            return;
        }

        // 3. Navigasi Tombol
        if (customId.startsWith('help_home')) {
            currentCategory = 'home';
        } else if (customId.startsWith('help_prev')) {
            const idx = CATEGORY_ORDER.indexOf(currentCategory);
            currentCategory = CATEGORY_ORDER[(idx - 1 + CATEGORY_ORDER.length) % CATEGORY_ORDER.length];
        } else if (customId.startsWith('help_next')) {
            const idx = CATEGORY_ORDER.indexOf(currentCategory);
            currentCategory = CATEGORY_ORDER[(idx + 1) % CATEGORY_ORDER.length];
        }

        await interaction.editReply(renderPage(currentCategory, user, client)).catch(() => {});
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'closed') return;
        // Nonaktifkan seluruh tombol dan menu saat sesi habis
        try {
            const disabledPayload = renderPage(currentCategory, user, client, true);
            await edit(context, message, disabledPayload).catch(() => {});
        } catch (_) {}
    });
}

// Collector khusus saat membuka deep-dive perintah spesifik
function attachDetailCollector(response, context, user, client) {
    if (!response || typeof response.createMessageComponentCollector !== 'function') return;

    const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 90000
    });

    collector.on('collect', async (interaction) => {
        if (interaction.user.id !== user.id) {
            await interaction.reply({
                content: `❌ Menu ini milik **${user.username}**. Ketik \`/help\` untuk membuka panduanmu!`,
                ephemeral: true
            }).catch(() => {});
            return;
        }

        if (interaction.customId.startsWith('help_close')) {
            collector.stop('closed');
            await interaction.message.delete().catch(() => {});
            return;
        }

        if (interaction.customId.startsWith('help_back_home')) {
            collector.stop('home');
            await interaction.deferUpdate().catch(() => {});
            await runHelp(interaction, user, null);
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'closed' || reason === 'home') return;
        try {
            await edit(context, response, { components: [] }).catch(() => {});
        } catch (_) {}
    });
}

// ==========================================
// 4. EMBED BUILDERS
// ==========================================
function renderPage(categoryId, user, client, isDisabled = false) {
    const embed = categoryId === 'home'
        ? buildHomeEmbed(client, user)
        : buildCategoryEmbed(categoryId, user, client);

    const components = buildActionRows(categoryId, user.id, isDisabled);
    return { embeds: [embed], components };
}

function buildHomeEmbed(client, user) {
    const prefix = config.bot?.prefixes?.[0] || '!';
    const totalCommands = Object.keys(COMMAND_DETAILS).length;

    const embed = baseEmbed({
        title: '🏙️ LifeSim Simulator — Pusat Bantuan & Direktori Panduan',
        description: 
            `Selamat datang di **LifeSim Simulator**! Bot simulasi kehidupan semi-RPG dengan sistem ekonomi terpadu, pertanian grid dinamis, bursa toko global fluktuatif, dan pasar pemain.\n\n` +
            `Gunakan **Slash Command** (\`/\`) atau **Prefix Command** (\`${prefix}\`) untuk bermain.`,
        color: colors.primary,
        user
    });

    if (client.user) {
        embed.setThumbnail(client.user.displayAvatarURL({ dynamic: true }));
    }

    // Panduan Quickstart
    embed.addFields({
        name: '🚀 Panduan Langkah Awal (Quickstart)',
        value: 
            `1️⃣ Ketik \`/register\` untuk membuat KTP warga & menerima modal awal **Lp 10,000**.\n` +
            `2️⃣ Gunakan \`/daily\` & \`/work\` setiap hari untuk menambah pundi uang dan EXP.\n` +
            `3️⃣ Buka bursa kerja lewat \`/job list\` dan lamar profesi pertamamu (\`/job apply janitor\`).\n` +
            `4️⃣ Kunjungi \`/shop\` untuk membeli bibit tanaman (\`/buy wheat_seed 5\`).\n` +
            `5️⃣ Kelola ladangmu lewat \`/farm view\`, tanam (\`/farm plantall wheat\`), dan siram (\`/farm waterall\`).`,
        inline: false
    });

    // Ringkasan Kategori
    const categoryLines = Object.values(CATEGORIES)
        .filter(cat => cat.id !== 'home')
        .map(cat => `${cat.emoji} **${cat.name}** (\`${cat.commands.length} Perintah\`)\n↳ *${cat.description}*`)
        .join('\n\n');

    embed.addFields({
        name: `📂 Kategori Direktori (${totalCommands} Total Perintah)`,
        value: categoryLines,
        inline: false
    });

    embed.addFields({
        name: '💡 Tips Navigasi Cepat',
        value: 
            `• Pilih **kategori pada dropdown menu** di bawah untuk melihat rincian perintah.\n` +
            `• Ingin info mendalam? Ketik \`/help command:<nama>\` atau \`${prefix}help <nama>\` *(contoh: \`/help command:farm\`)*.`,
        inline: false
    });

    embed.setFooter({
        text: `Diminta oleh ${user.username} • Prefix default: ${prefix} • Sesi aktif selama 2 menit`,
        iconURL: user.displayAvatarURL({ dynamic: true })
    });

    return embed;
}

function buildCategoryEmbed(categoryId, user, client) {
    const cat = CATEGORIES[categoryId];
    const prefix = config.bot?.prefixes?.[0] || '!';

    const embed = baseEmbed({
        title: `${cat.emoji} Kategori: ${cat.name} (${cat.commands.length} Perintah)`,
        description: `${cat.description}\n${'─'.repeat(40)}`,
        color: cat.color,
        user
    });

    if (client.user) {
        embed.setThumbnail(client.user.displayAvatarURL({ dynamic: true }));
    }

    for (const cmdName of cat.commands) {
        const cmd = COMMAND_DETAILS[cmdName];
        if (!cmd) continue;

        const aliasText = cmd.aliases.length ? `• **Alias:** ${cmd.aliases.map(a => `\`${prefix}${a}\``).join(', ')}` : '';
        const sampleSub = cmd.subcommands[0];
        const usageText = `• **Sintaks:** \`${sampleSub.name}\` *(atau \`${sampleSub.prefix}\`)*`;

        embed.addFields({
            name: `🔹 /${cmd.name}  —  ⏱️ ${cmd.cooldown}`,
            value: 
                `${cmd.summary}\n` +
                `${usageText}\n` +
                (aliasText ? `${aliasText}\n` : '') +
                `*Subcommand: ${cmd.subcommands.map(s => `\`${s.name.split(' ')[1] || s.name}\``).join(', ')}*`,
            inline: false
        });
    }

    embed.setFooter({
        text: `Ketik /help command:<nama> untuk panduan spesifik • Gunakan dropdown untuk pindah kategori`,
        iconURL: user.displayAvatarURL({ dynamic: true })
    });

    return embed;
}

function buildCommandDetailEmbed(cmd, user, client) {
    const cat = CATEGORIES[cmd.category] || CATEGORIES.utility;
    const prefix = config.bot?.prefixes?.[0] || '!';

    const embed = baseEmbed({
        title: `📖 Panduan Perintah: /${cmd.name}`,
        description: `*${cmd.summary}*\n${'─'.repeat(42)}`,
        color: cat.color,
        user
    });

    if (client.user) {
        embed.setThumbnail(client.user.displayAvatarURL({ dynamic: true }));
    }

    // Informasi Teknis Perintah
    const aliasDisplay = cmd.aliases.length ? cmd.aliases.map(a => `\`${prefix}${a}\``).join(', ') : 'Tidak ada';
    embed.addFields({
        name: '⚙️ Detail Spesifikasi',
        value: 
            `• **Kategori:** ${cat.emoji} **${cat.name}**\n` +
            `• **Jeda Cooldown:** \`${cmd.cooldown}\`\n` +
            `• **Perlu Registrasi KTP:** ${cmd.registration ? '✅ Ya (`/register`)' : '❌ Tidak'}\n` +
            `• **Alias Prefix:** ${aliasDisplay}`,
        inline: false
    });

    // Subcommand & Sintaks (dengan chunking aman batas 1024 karakter Discord)
    const subLines = cmd.subcommands.map((sub, idx) => {
        return `**${idx + 1}. \`${sub.name}\`** *(Prefix: \`${sub.prefix}\`)*\n↳ ${sub.desc}`;
    });

    let currentChunk = '';
    let part = 1;
    for (const line of subLines) {
        if ((currentChunk + '\n\n' + line).length > 850) {
            embed.addFields({
                name: `📋 Daftar Opsi & Sub-Perintah (Bagian ${part})`,
                value: currentChunk.trim(),
                inline: false
            });
            currentChunk = line;
            part++;
        } else {
            currentChunk = currentChunk ? `${currentChunk}\n\n${line}` : line;
        }
    }

    if (currentChunk) {
        embed.addFields({
            name: part > 1 ? `📋 Daftar Opsi & Sub-Perintah (Bagian ${part})` : '📋 Daftar Opsi & Sub-Perintah',
            value: currentChunk.trim(),
            inline: false
        });
    }

    // Tips Pro
    if (cmd.tips) {
        embed.addFields({
            name: '💡 Tips Ahli',
            value: cmd.tips,
            inline: false
        });
    }

    embed.setFooter({
        text: `Diminta oleh ${user.username} • LifeSim Guide System`,
        iconURL: user.displayAvatarURL({ dynamic: true })
    });

    return embed;
}

// ==========================================
// 5. COMPONENT BUILDERS (DROPDOWN & BUTTONS)
// ==========================================
function buildActionRows(currentCategory, userId, isDisabled = false) {
    // 1. String Select Menu
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`help_category:${userId}`)
        .setPlaceholder('Pilih Kategori Perintah...')
        .setDisabled(isDisabled)
        .addOptions(
            CATEGORY_ORDER.map(catKey => {
                const cat = CATEGORIES[catKey];
                return new StringSelectMenuOptionBuilder()
                    .setLabel(cat.name)
                    .setValue(cat.id)
                    .setDescription(cat.description.slice(0, 100))
                    .setEmoji(cat.emoji)
                    .setDefault(cat.id === currentCategory);
            })
        );

    const rowSelect = new ActionRowBuilder().addComponents(selectMenu);

    // 2. Buttons Navigasi
    const btnPrev = new ButtonBuilder()
        .setCustomId(`help_prev:${userId}`)
        .setLabel('Sebelumnya')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(isDisabled);

    const btnHome = new ButtonBuilder()
        .setCustomId(`help_home:${userId}`)
        .setLabel('Beranda')
        .setEmoji('🏠')
        .setStyle(currentCategory === 'home' ? ButtonStyle.Success : ButtonStyle.Primary)
        .setDisabled(isDisabled);

    const btnNext = new ButtonBuilder()
        .setCustomId(`help_next:${userId}`)
        .setLabel('Selanjutnya')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(isDisabled);

    const btnClose = new ButtonBuilder()
        .setCustomId(`help_close:${userId}`)
        .setLabel('Tutup')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(isDisabled);

    const rowButtons = new ActionRowBuilder().addComponents(btnPrev, btnHome, btnNext, btnClose);

    return [rowSelect, rowButtons];
}

function findCommandByAlias(alias) {
    return Object.values(COMMAND_DETAILS).find(cmd => cmd.aliases.includes(alias));
}
