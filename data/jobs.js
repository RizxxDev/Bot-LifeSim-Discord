const PROMOTION_RANKS = [
    { id: 'junior', name: 'Junior', minShifts: 0, multiplier: 1.00 },
    { id: 'staff',  name: 'Staff',  minShifts: 30, multiplier: 1.15 },
    { id: 'senior', name: 'Senior', minShifts: 100, multiplier: 1.30 },
    { id: 'kepala', name: 'Kepala', minShifts: 250, multiplier: 1.50 }
];

const JOBS = [
    // TIER 0 (Tanpa syarat)
    {
        id: 'tukang_parkir',
        name: 'Tukang Parkir',
        emoji: '🅿️',
        tier: 0,
        reqEducation: null,
        reqItem: null,
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 25000,
        energyCost: 20,
        minigameType: 'refleks',
        description: 'Mengatur keluar-masuk kendaraan di ruko dan pasar.'
    },
    {
        id: 'petugas_kebersihan',
        name: 'Petugas Kebersihan',
        emoji: '🧹',
        tier: 0,
        reqEducation: null,
        reqItem: null,
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 28000,
        energyCost: 20,
        minigameType: 'refleks',
        description: 'Menjaga kebersihan taman kota dan fasilitas umum.'
    },
    {
        id: 'kuli_panggul',
        name: 'Kuli Panggul',
        emoji: '📦',
        tier: 0,
        reqEducation: null,
        reqItem: null,
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 32000,
        energyCost: 25,
        minigameType: 'refleks',
        description: 'Mengangkut muatan gudang dan pasar induk. Butuh tenaga ekstra.'
    },

    // TIER 1 (SMP)
    {
        id: 'pelayan_warung',
        name: 'Pelayan Warung',
        emoji: '🍽️',
        tier: 1,
        reqEducation: 'SMP',
        reqItem: null,
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 40000,
        energyCost: 20,
        minigameType: 'hitung',
        description: 'Melayani pesanan pelanggan dan menghitung nota makan.'
    },
    {
        id: 'kurir_paket',
        name: 'Kurir Paket',
        emoji: '📬',
        tier: 1,
        reqEducation: 'SMP',
        reqItem: null,
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 45000,
        energyCost: 20,
        minigameType: 'rute',
        description: 'Mengantar paket ke berbagai alamat tepat waktu.'
    },

    // TIER 2 (SMA)
    {
        id: 'kasir_minimarket',
        name: 'Kasir Minimarket',
        emoji: '🏪',
        tier: 2,
        reqEducation: 'SMA',
        reqItem: null,
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 60000,
        energyCost: 20,
        minigameType: 'hitung',
        description: 'Melayani transaksi pembayaran dan kembalian pelanggan.'
    },
    {
        id: 'satpam',
        name: 'Satpam',
        emoji: '🛡️',
        tier: 2,
        reqEducation: 'SMA',
        reqItem: null,
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 62000,
        energyCost: 20,
        minigameType: 'refleks',
        description: 'Menjaga keamanan gedung dan merespons situasi darurat.'
    },
    {
        id: 'ojek_online',
        name: 'Ojek Online',
        emoji: '🛵',
        tier: 2,
        reqEducation: 'SMA',
        reqItem: 'sim_c',
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 70000,
        energyCost: 20,
        minigameType: 'rute',
        description: 'Mengantar penumpang dan makanan melewati kemacetan kota.'
    },
    {
        id: 'taksi_online',
        name: 'Taksi Online',
        emoji: '🚕',
        tier: 2,
        reqEducation: 'SMA',
        reqItem: 'sim_a',
        reqVehicle: 'mobil',
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 140000,
        energyCost: 20,
        minigameType: 'rute',
        description: 'Mengemudikan mobil pribadi untuk layanan transportasi penumpang dalam kota.'
    },
    {
        id: 'sopir_pribadi',
        name: 'Sopir Pribadi',
        emoji: '🧑‍✈️',
        tier: 3,
        reqEducation: 'SMA',
        reqItem: 'sim_a',
        reqVehicle: 'mobil',
        reqTotalShifts: 100,
        reqJobHistory: null,
        baseSalary: 160000,
        energyCost: 20,
        minigameType: 'rute',
        description: 'Sopir eksekutif berpengalaman untuk mobilitas VIP dengan penghasilan tinggi.'
    },

    // TIER 3 (D3 / S1)
    {
        id: 'staff_admin',
        name: 'Staff Admin',
        emoji: '🗂️',
        tier: 3,
        reqEducation: 'D3',
        reqItem: 'laptop',
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 105000,
        energyCost: 20,
        minigameType: 'ketelitian',
        description: 'Mengelola dokumen kantor, arsip, dan rekap data harian.'
    },
    {
        id: 'perawat',
        name: 'Perawat',
        emoji: '🩺',
        tier: 3,
        reqEducation: 'D3',
        reqItem: null,
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 115000,
        energyCost: 20,
        minigameType: 'diagnosa',
        description: 'Merawat pasien dan membantu pemeriksaan medis di rumah sakit.'
    },
    {
        id: 'guru',
        name: 'Guru',
        emoji: '👩‍🏫',
        tier: 3,
        reqEducation: 'S1',
        reqItem: null,
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 125000,
        energyCost: 20,
        minigameType: 'ketelitian',
        description: 'Mengajar siswa dan mengoreksi lembar ujian sekolah.'
    },
    {
        id: 'akuntan',
        name: 'Akuntan',
        emoji: '📊',
        tier: 3,
        reqEducation: 'S1',
        reqItem: null,
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 145000,
        energyCost: 20,
        minigameType: 'hitung',
        description: 'Menyusun laporan keuangan dan mengaudit pembukuan perusahaan.'
    },
    {
        id: 'programmer',
        name: 'Programmer',
        emoji: '💻',
        tier: 3,
        reqEducation: 'S1',
        reqItem: 'laptop',
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 170000,
        energyCost: 20,
        minigameType: 'ketelitian',
        description: 'Membangun aplikasi dan memperbaiki bug sistem.'
    },

    // TIER 4 (S2)
    {
        id: 'dosen',
        name: 'Dosen Universitas',
        emoji: '🏛️',
        tier: 4,
        reqEducation: 'S2',
        reqItem: null,
        reqTotalShifts: 0,
        reqJobHistory: null,
        baseSalary: 210000,
        energyCost: 25,
        minigameType: 'ketelitian',
        description: 'Mengajar mahasiswa dan membimbing riset akademik.'
    },
    {
        id: 'manajer',
        name: 'Manajer Operasional',
        emoji: '💼',
        tier: 4,
        reqEducation: 'S2',
        reqItem: null,
        reqTotalShifts: 200,
        reqJobHistory: null,
        baseSalary: 230000,
        energyCost: 25,
        minigameType: 'keputusan',
        description: 'Memimpin strategi tim dan mengambil keputusan kritis perusahaan.'
    },
    {
        id: 'dokter_spesialis',
        name: 'Dokter Spesialis',
        emoji: '⚕️',
        tier: 4,
        reqEducation: 'S2',
        reqItem: null,
        reqTotalShifts: 0,
        reqJobHistory: { jobId: 'perawat', shifts: 100 },
        baseSalary: 250000,
        energyCost: 25,
        minigameType: 'diagnosa',
        description: 'Menangani diagnosis penyakit kompleks di rumah sakit utama.'
    }
];

function getJob(jobId) {
    return JOBS.find(j => j.id === jobId) || null;
}

function getRankForShifts(shiftsCompleted = 0) {
    let currentRank = PROMOTION_RANKS[0];
    for (const rank of PROMOTION_RANKS) {
        if (shiftsCompleted >= rank.minShifts) {
            currentRank = rank;
        }
    }
    return currentRank;
}

function getNextRank(shiftsCompleted = 0) {
    for (const rank of PROMOTION_RANKS) {
        if (shiftsCompleted < rank.minShifts) {
            return rank;
        }
    }
    return null;
}

module.exports = {
    JOBS,
    PROMOTION_RANKS,
    getJob,
    getRankForShifts,
    getNextRank
};
