# Bot-LifeSim-Discord

Bot-LifeSim-Discord adalah bot Discord semi-life simulation berbasis Node.js dengan arsitektur basis data berkinerja tinggi berbasis **MariaDB 10.6+ (InnoDB)** dan **Redis v7+**. Project ini menggabungkan sistem ekonomi, pekerjaan, skill tree, farming, crafting, pasar antar pemain, toko global dengan harga dinamis, fishing, mining, leaderboard, dan antarmuka smartphone interaktif.

Bot mendukung **Prefix Command** dan **Slash Command (Discord.js v14)** secara bersamaan.

---

## Teknologi

- **Runtime:** Node.js (v18+)
- **Framework Bot:** `discord.js` v14
- **Primary Database:** MariaDB 10.6+ (InnoDB) dengan dukungan transaksi ACID murni
- **Cache & Locking:** Redis v7+ (Atomic Cooldown & Lua Distributed Locking)
- **Database Driver:** `mysql2/promise` (Connection Pooling & Prepared Statements)

---

## Fitur Utama

- **Single Source of Truth:** Seluruh data ekonomi, level, ladang, dan inventaris tersimpan terpadu di MariaDB InnoDB.
- **Relasional Utuh & Zero Orphan Data:** Seluruh tabel turunan dipasangi `FOREIGN KEY ... ON DELETE CASCADE`.
- **Query Batching:** Operasi massal seperti `plantAll` dan `harvestAll` dieksekusi dalam statement batch multi-row untuk performa kilat tanpa N+1 query loop.
- **Self-Documenting Schema:** Setiap tabel dan kolom dilengkapi `COMMENT` penjelasan teknis dan rentang nilai.
- **Sistem Ekonomi Terpadu:** Registrasi warga, modal awal, cash & bank balance, transfer dana antar pemain, deposit, withdraw, daily reward beruntun (streak), dan shift pekerjaan.
- **Sistem Ladang & Lumbung:** Ladang modular dengan bibit, pertumbuhan, penyiraman berlipat ganda, dan lumbung terpisah.
- **Pabrik & Toko Global Dinamis:** Toko NPC mandiri dengan kas modal likuiditas, stok berfluktuasi secara dinamis menurut supply-demand, dan antrean konversi resep otomatis.
- **Pasar Bebas Antar Pemain:** Jual-beli hasil komoditas dengan listing fee dan pemotongan pajak pasar.
- **Minigame Interaktif:** Mancing ikan (Reaction QTE) dan menambang bijih mineral (Scan, Charge & Strike).
- **Atomic Cooldown & Failsafe:** Cooldown menggunakan Redis dengan in-memory fallback otomatis jika Redis offline.

---

## Struktur Tabel Basis Data (Standardized Schema)

Skema database distandardisasi dengan penamaan tematik berawalan prefix modul:

| Kategori | Nama Tabel | Deskripsi |
|---|---|---|
| **Master** | `jobs` | Daftar profesi, gaji, EXP, dan cooldown shift |
| **User** | `users` | Profil pemain, saldo dompet/bank, survival (energy/hunger), level, exp, SP, mastery |
| **User** | `user_skills` | Skill tree pasif pemain (income, cooldown, luck, defense) |
| **User** | `user_inventory` | Tas bawaan barang pemain (tools, seeds, ores, fish, consumables) |
| **Farm** | `farm_profiles` | Dimensi petak ladang dan batas kapasitas lumbung pemain |
| **Farm** | `farm_tiles` | Petak tanah ladang, jenis bibit, persentase pertumbuhan, dan status siram |
| **Farm** | `farm_storage` | Lumbung gudang hasil panen dan olahan pertanian pemain |
| **Pasar & Craft** | `crafting_queue` | Antrean pengolahan bahan mentah menjadi makanan/barang olahan |
| **Pasar & Craft** | `market_listings` | Bursa listing komoditas jual-beli antar pemain |
| **Toko** | `shop_global` | Modal kas likuiditas dan kapasitas tampung toko global NPC |
| **Toko** | `shop_inventory` | Stok komoditas toko dengan algoritma harga dinamis |
| **Toko** | `shop_queue` | Antrean konversi bahan mentah toko otomatis |

---

## Konfigurasi Environment

Buat file `.env` di root project:

```env
DISCORD_TOKEN=token_bot_discord
CLIENT_ID=application_client_id
DB_HOST=localhost
DB_USER=root
DB_PASS=password_database
DB_NAME=lifesim_db
REDIS_URL=redis://localhost:6379
```

---

## Inisialisasi Basis Data & Menjalankan Bot

1. Install dependensi project:
   ```bash
   npm install
   ```

2. Jalankan inisialisasi skema database master (membuat 11 tabel lengkap dengan foreign key dan indeks):
   ```bash
   npm run init-db
   ```
   *(Atau impor langsung file `database/schema.sql` via phpMyAdmin / DBeaver / HeidiSQL).*

3. Jalankan bot:
   ```bash
   npm start
   ```

---

## Daftar Command

### Utility
- `/register` / `!register`: Mendaftarkan profil warga baru dan menerima modal awal.
- `/help` / `!help`: Menampilkan panduan seluruh command.
- `/ping` / `!ping`: Mengecek latensi bot dan koneksi basis data.

### Ekonomi & RPG
- `/profile` / `!profile`: Melihat status warga, level, exp, SP, dan karir.
- `/daily` / `!daily`: Mengklaim reward harian dan memperpanjang daily streak.
- `/work` / `!work`: Bekerja shift sesuai profesi untuk mendapatkan uang dan exp.
- `/job` / `!job`: Melihat daftar lowongan, info profesi, melamar, atau resign.
- `/skill` / `!skill`: Membuka pohon keahlian pasif, upgrade skill, atau reset SP.
- `/bank` / `!bank`: Cek rekening tabungan, deposit tunai, tarik tunai, dan transfer antar bank.
- `/pay` / `!pay`: Mengirimkan uang tunai ke pemain lain.
- `/shop` / `!shop`: Melihat katalog dan fluktuasi harga toko global.
- `/buy` / `!buy`: Membeli barang atau bibit dari toko global.
- `/sell` / `!sell`: Menjual barang hasil panen/tambang ke toko global.
- `/inventory` / `!inventory`: Membuka tas bawaan pemain.
- `/fish` / `!fish`: Memancing interaktif dengan sistem timing reaction.
- `/mine` / `!mine`: Sesi menambang batu & bijih mineral interaktif.
- `/leaderboard` / `!leaderboard`: Peringkat 10 warga terkaya (didukung cache Redis).
- `/phone` / `!phone`: Antarmuka smartphone interaktif (mobile banking & status).

### Ladang & Pasar
- `/farm view` / `!farm`: Melihat visual grid ladang pertanian.
- `/farm plant` / `!farm plant <x> <y> <crop>`: Menanam bibit pada petak tertentu.
- `/farm plantall` / `!farm plantall <crop>`: Menanam seluruh petak kosong sekaligus (Batch Multi-row Query).
- `/farm water` / `!farm water <x> <y>`: Menyiram tanaman agar tumbuh 2x lebih cepat.
- `/farm waterall` / `!farm waterall`: Menyiram seluruh tanaman yang sedang tumbuh.
- `/farm harvest` / `!farm harvest <x> <y>`: Memanen petak yang sudah matang (growth 100%).
- `/farm harvestall` / `!farm harvestall`: Memanen seluruh tanaman yang matang sekaligus.
- `/farm storage` / `!farm storage`: Melihat isi lumbung gudang pertanian.
- `/craft list` / `!craft list`: Melihat buku resep masakan & olahan.
- `/craft start` / `!craft start <recipe> [amount]`: Memulai antrean pengolahan barang.
- `/craft queue` / `!craft queue`: Memeriksa antrean crafting aktif.
- `/craft claim` / `!craft claim <id>`: Mengambil barang yang selesai diproses.
- `/market list` / `!market list`: Melihat bursa penawaran pasar antar pemain.
- `/market sell` / `!market sell <item> <amount> <price>`: Menjual barang lumbung ke pasar.
- `/market buy` / `!market buy <id>`: Membeli barang dari listing pasar pemain lain.
