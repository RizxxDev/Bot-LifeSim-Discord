const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { formatLp } = require('../utils/uiBuilder');

function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/**
 * Menghasilkan soal mini-game 4 pilihan sesuai tipe profesi.
 */
function generateWorkMinigame(type = 'refleks') {
    switch (type) {
        case 'hitung': {
            const totalBelanja = (Math.floor(Math.random() * 14) + 3) * 2500;
            const uangDibayar = Math.ceil((totalBelanja + 5000) / 10000) * 10000;
            const correct = uangDibayar - totalBelanja;
            const wrongSet = new Set([
                correct + 2500,
                Math.max(1000, correct - 2500),
                correct + 5000,
                Math.max(500, correct - 5000)
            ]);
            wrongSet.delete(correct);
            const wrongs = [...wrongSet].slice(0, 3);
            const options = shuffleArray([correct, ...wrongs]).map(val => ({
                label: formatLp(val),
                isCorrect: val === correct
            }));
            return {
                prompt: `🧾 **Hitung Kembalian!**\nTotal tagihan pelanggan adalah **${formatLp(totalBelanja)}** dan pelanggan membayar dengan uang **${formatLp(uangDibayar)}**.\nBerapa uang kembalian yang tepat?`,
                options
            };
        }

        case 'rute': {
            const routes = [
                { name: 'Jl. Sudirman', dist: 4, traffic: 'Lancar (+0 mnt)', total: 8 },
                { name: 'Jl. Ahmad Yani', dist: 3, traffic: 'Macet Parah (+10 mnt)', total: 16 },
                { name: 'Jl. Lingkar Luar', dist: 6, traffic: 'Sedikit Padat (+2 mnt)', total: 14 },
                { name: 'Jl. Pasar Lama', dist: 2, traffic: 'Tutup Perbaikan (+15 mnt)', total: 19 }
            ];
            // Acak waktu tempuh agar tidak bisa dihafal
            const randomized = routes.map(r => {
                const dist = Math.floor(Math.random() * 6) + 2;
                const delay = [0, 3, 7, 12][Math.floor(Math.random() * 4)];
                const status = delay === 0 ? '🟢 Lancar' : delay <= 3 ? '🟡 Ramai' : '🔴 Macet';
                return {
                    name: r.name,
                    desc: `${r.name}: ${dist * 2} mnt perjalanan + ${status} (+${delay} mnt)`,
                    total: dist * 2 + delay
                };
            });
            // Pastikan ada 1 nilai minimum unik
            randomized.sort((a, b) => a.total - b.total);
            if (randomized[0].total === randomized[1].total) {
                randomized[0].total -= 1;
            }
            const fastestName = randomized[0].name;
            const displayOrder = shuffleArray(randomized);
            return {
                prompt: `🗺️ **Pilih Rute Tercepat!**\nPerhatikan estimasi waktu perjalanan + kemacetan berikut:\n` +
                    displayOrder.map(r => `• **${r.desc}**`).join('\n') +
                    `\n\nManakah rute paling cepat sampai tujuan?`,
                options: displayOrder.map(r => ({
                    label: r.name,
                    isCorrect: r.name === fastestName
                }))
            };
        }

        case 'ketelitian': {
            const codeSets = [
                {
                    context: 'Temukan kode atau penulisan yang **SALAH / BUG**:',
                    correct: 'SAlDO_AKHIR = cash - +',
                    wrongs: ['TOTAL_GAJI = pokok + bonus', 'PAJAK = gaji * 0.02', 'STATUS = "AKTIF"']
                },
                {
                    context: 'Manakah nomor arsip yang **TIDAK SESUAI FORMAT** (`INV-2026-XXXX`)?',
                    correct: 'INV-2026-99A',
                    wrongs: ['INV-2026-1042', 'INV-2026-8831', 'INV-2026-4209']
                },
                {
                    context: 'Temukan baris data yang mengandung **kesalahan ketik (typo)**:',
                    correct: 'Laporan Keuagan Bulanan',
                    wrongs: ['Daftar Hadir Karyawan', 'Rekapitulasi Anggaran', 'Dokumen Evaluasi Kinerja']
                }
            ];
            const picked = codeSets[Math.floor(Math.random() * codeSets.length)];
            const opts = shuffleArray([
                { label: picked.correct, isCorrect: true },
                ...picked.wrongs.map(w => ({ label: w, isCorrect: false }))
            ]);
            return {
                prompt: `🔍 **Uji Ketelitian Kerja!**\n${picked.context}`,
                options: opts
            };
        }

        case 'diagnosa': {
            const cases = [
                {
                    symptom: 'Pasien datang dengan suhu tubuh **39°C** dan menggigil.',
                    correct: 'Berikan Penurun Demam',
                    wrongs: ['Pasang Gips Tulang', 'Cabut Gigi', 'Beri Obat Mata']
                },
                {
                    symptom: 'Pasien mengalami **luka gores terbuka** akibat kecelakaan kerja.',
                    correct: 'Bersihkan & Pasang Perban Steril',
                    wrongs: ['Beri Obat Batuk', 'Periksa Kacamata', 'Fisioterapi Lutut']
                },
                {
                    symptom: 'Pasien mengeluh **dehidrasi berat** dan lemas setelah kepanasan.',
                    correct: 'Infus Cairan Elektrolit',
                    wrongs: ['Operasi Usus Buntu', 'Pasang Penyangga Leher', 'Salep Kulit']
                }
            ];
            const c = cases[Math.floor(Math.random() * cases.length)];
            return {
                prompt: `🩺 **Tindakan Medis Cepat!**\n${c.symptom}\nApa tindakan pertama yang paling tepat?`,
                options: shuffleArray([
                    { label: c.correct, isCorrect: true },
                    ...c.wrongs.map(w => ({ label: w, isCorrect: false }))
                ])
            };
        }

        case 'keputusan': {
            const scenarios = [
                {
                    q: 'Mesin produksi utama mendadak panas berlebih saat jam sibuk. Apa keputusanmu?',
                    correct: 'Hentikan Sementara & Panggil Teknisi',
                    wrongs: ['Paksa Jalan Terus', 'Abaikan Laporan', 'Matikan Seluruh Gedung 1 Minggu']
                },
                {
                    q: 'Klien besar meminta perubahan mendadak sebelum tenggat waktu besok.',
                    correct: 'Negosiasi Prioritas & Tambah Shift Tim',
                    wrongs: ['Batalkan Kontrak Sepihak', 'Matikan Telepon Kantor', 'Hapus Database Proyek']
                }
            ];
            const s = scenarios[Math.floor(Math.random() * scenarios.length)];
            return {
                prompt: `💼 **Keputusan Manajerial!**\n${s.q}`,
                options: shuffleArray([
                    { label: s.correct, isCorrect: true },
                    ...s.wrongs.map(w => ({ label: w, isCorrect: false }))
                ])
            };
        }

        case 'refleks':
        default: {
            const pool = [
                { emoji: '🟢', name: 'Hijau' },
                { emoji: '🔵', name: 'Biru' },
                { emoji: '🟡', name: 'Kuning' },
                { emoji: '🟣', name: 'Ungu' }
            ];
            const target = pool[Math.floor(Math.random() * pool.length)];
            const shuffled = shuffleArray(pool);
            return {
                prompt: `⚡ **Uji Fokus & Refleks!**\nKlik tombol **${target.emoji} ${target.name}** di bawah ini sebelum waktu habis!`,
                options: shuffled.map(p => ({
                    label: `${p.emoji} ${p.name}`,
                    isCorrect: p.name === target.name
                }))
            };
        }
    }
}

function buildWorkMinigameRow(nonce, options) {
    const row = new ActionRowBuilder();
    options.forEach((opt, idx) => {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`work_mg_${nonce}_${idx}`)
                .setLabel(opt.label.slice(0, 80))
                .setStyle(ButtonStyle.Primary)
        );
    });
    return row;
}

module.exports = {
    generateWorkMinigame,
    buildWorkMinigameRow
};
