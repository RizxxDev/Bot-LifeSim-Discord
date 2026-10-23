# 🌆 Welcome To Life Simulation — Discord Economy Bot

Bot Discord simulasi kehidupan & ekonomi realistis berbasis **Discord.js v14 (Components V2)**, **MariaDB**, dan **Redis**.

## ✨ Fitur Utama (Fase 1 / MVP)

- **🌱 Onboarding & Identitas Unik Global:** Kartu sambutan interaktif (`Welcome To Life Simulation`) dengan modal form registrasi username unik (*case-insensitive* + filter *blacklist*) dan Paket Modal Awal Warga Baru.
- **❤️ 4 Stat Vital (*Lazy Evaluation*):** `Energy`, `Hunger`, `Thirst`, dan `Health` dihitung secara *real-time* tanpa membebani server dengan cron job per user. Dilengkapi batas bawah *offline* di angka **20** agar pemain yang libur tidak langsung pingsan.
- **💼 Sistem Karir & Pendidikan:**
  - **Pendidikan (`/study`):** Jenjang `SD` → `SMP` → `SMA` → `D3` / `S1` → `S2`.
  - **Karir (`/job`, `/work`):** 16 profesi (Tier 0–4), sistem promosi jabatan (`Junior` → `Staff` → `Senior` → `Kepala`), dan 6 tipe mini-game kerja interaktif.
- **🎒 Inventory Berkapasitas & Upgrade Tas:** Mulai dari `Tas Kecil (20 slot)` hingga `Gudang Pribadi Mini (130 slot)`, lengkap dengan sistem *durability* dan perbaikan alat.
- **🍱 Konsumsi Terpisah (`/eat`, `/drink`, `/use`, `/sleep`):** Autocomplete otomatis dari isi tas dan berhenti otomatis di angka 100 agar item berlebih tidak terbuang.
- **🎣 Memancing (`/fishing`) & ⛏️ Menambang (`/mining`):** Lokasi bertingkat, alat & umpan, *mini-game* reaksi 1 tombol, serta koleksi **Fishpedia** & **Buku Mineral**.
- **📊 Ekonomi Seimbang & Anti-Inflasi:**
  - Harga kebutuhan pokok tetap (*locked price*) demi melindungi pemain baru.
  - Pasar NPC dinamis 24 jam bergulir (`/sell`) yang menyesuaikan harga berdasarkan suplai global & DAU.
  - Pajak penghasilan progresif, pajak kekayaan mingguan (*whale tax*), *soft cap* harian, dan **Newbie Boost** 7 hari pertama.

---

## 🛠️ Persyaratan & Instalasi

1. **Node.js** v18+
2. **MariaDB** / MySQL
3. **Redis** *(opsional saat pengembangan lokal — otomatis beralih ke fallback In-Memory jika Redis belum aktif)*

```bash
# 1. Salin file environment
cp .env.example .env

# 2. Instal dependensi
npm install

# 3. Jalankan migrasi tabel MariaDB
npm run migrate

# 4. Jalankan pengujian unit & simulasi ekonomi 120 hari
npm test
npm run simulate

# 5. Jalankan bot
npm run dev
```
