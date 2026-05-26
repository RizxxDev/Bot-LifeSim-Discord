# Bot-LifeSim-Discord

Bot-LifeSim-Discord adalah bot Discord semi-life simulation berbasis Node.js. Project ini menggabungkan sistem ekonomi, pekerjaan, skill, farming, crafting, market antar pemain, shop global dengan harga dinamis, fishing, mining, leaderboard, dan menu smartphone interaktif.

Bot mendukung prefix command dan slash command. Saat bot online, slash command akan didaftarkan otomatis, tabel MariaDB akan disiapkan otomatis, data pekerjaan awal dan stok shop akan diisi, lalu game loop farming dan shop AI berjalan setiap 1 menit.

## Teknologi

- Node.js
- discord.js v14
- dotenv
- mysql2 / mariadb
- Redis
- MariaDB atau MySQL

## Fitur Utama

- Sistem registrasi warga dengan modal awal.
- Ekonomi cash dan bank, termasuk deposit, withdraw, transfer, daily reward, dan pembayaran antar pemain.
- Sistem pekerjaan, EXP, level karakter, job mastery, dan skill tree.
- Farming 5x5 dengan tanam, panen, storage, plant all, dan harvest all.
- Crafting berbasis antrian untuk mengolah hasil panen.
- Shop global dengan stok, kas, kapasitas gudang, dan harga dinamis berdasarkan kelangkaan barang.
- Market antar pemain dengan listing fee dan pajak transaksi.
- Aktivitas interaktif seperti fishing dan mining.
- Leaderboard kekayaan.
- Smartphone command untuk membuka menu aplikasi seperti bank dan profile.
- Cooldown command memakai Redis.

## Struktur Project

```text
.
|-- botHandlers/       # Koneksi Redis dan helper query MariaDB/MySQL
|-- commands/          # Prefix command dan slash command
|   |-- economy/       # Ekonomi, bank, kerja, shop, inventory, fishing, mining
|   |-- farm/          # Farming, crafting, market pemain
|   `-- utility/       # Register, help, ping
|-- config/            # Data item, crop, resep, shop, dan tools
|-- database/          # Pool koneksi database
|-- eventHandlers/     # ready, messageCreate, interactionCreate
|-- managers/          # Logic farming, crafting, shop, market, game loop
|-- utils/             # Middleware cooldown Redis
|-- config.json        # Konfigurasi bot dan ekonomi dasar
|-- index.js           # Entry point bot
`-- package.json       # Script dan dependency
```

## Persiapan

Pastikan sudah tersedia:

- Node.js versi modern.
- MariaDB atau MySQL.
- Redis lokal, Redis Cloud, atau layanan Redis lain.
- Bot Discord dengan token dan application/client ID.

Install dependency:

```bash
npm install
```

Buat database kosong di MariaDB/MySQL. Tabel tidak perlu dibuat manual karena project akan menjalankan setup schema otomatis dari `eventHandlers/ready.js` saat bot berhasil login.

## Konfigurasi Environment

Buat file `.env` di root project:

```env
DISCORD_TOKEN=token_bot_discord
CLIENT_ID=application_client_id
DB_HOST=localhost
DB_USER=root
DB_PASS=password_database
DB_NAME=nama_database

# Opsional. Jika tidak diisi, bot memakai redis://localhost:6379
REDIS_URL=redis://localhost:6379
```

Keterangan:

- `DISCORD_TOKEN`: token bot Discord.
- `CLIENT_ID`: application/client ID untuk registrasi global slash command.
- `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`: koneksi MariaDB/MySQL.
- `REDIS_URL`: URL koneksi Redis. Jika kosong, default-nya `redis://localhost:6379`.

## Menjalankan Bot

Pastikan MariaDB/MySQL dan Redis sudah berjalan, lalu jalankan:

```bash
npm start
```

Script `npm start` menjalankan:

```bash
node index.js
```

Saat event `ready`, bot akan:

- Mendaftarkan global slash command ke Discord.
- Membuat atau menyiapkan tabel MariaDB yang dibutuhkan.
- Mengisi daftar pekerjaan awal seperti `janitor`, `barista`, dan `programmer`.
- Mengisi data awal `global_shop` dan `shop_inventory`.
- Menjalankan game loop setiap 1 menit untuk pertumbuhan farm dan produksi shop AI.

## Prefix dan Slash Command

Command bisa dipakai lewat slash command, misalnya:

```text
/register
/profile
/farm view
```

Untuk prefix command, kode saat ini memakai prefix `!` di `eventHandlers/messageCreate.js`, misalnya:

```text
!register
!profile
!farm view
```

Catatan: `config.json` berisi daftar prefix `["!", "l", "L"]`, tetapi handler prefix yang berjalan saat ini masih hardcoded memakai `!`.

## Daftar Command

### Utility

- `register`: membuat akun warga baru dan menerima modal awal.
- `help`: menampilkan daftar command.
- `ping`: mengecek status bot dan koneksi database.

### Economy

- `profile`: melihat statistik karakter.
- `daily`: mengambil reward harian dan streak.
- `work`: bekerja untuk mendapatkan uang dan EXP.
- `job`: melihat, melamar, mengecek, atau keluar dari pekerjaan.
- `skill`: melihat, upgrade, atau reset skill.
- `bank`: info saldo, deposit, withdraw, dan transfer bank.
- `pay`: memberi cash ke pemain lain.
- `shop`: melihat stok dan harga shop global.
- `buy`: membeli item dari shop global.
- `sell`: menjual item ke shop global.
- `inventory`: melihat isi inventory.
- `fish`: memancing dengan quick time event.
- `mine`: menambang secara interaktif.
- `leaderboard`: melihat 10 warga terkaya.
- `phone`: membuka menu smartphone interaktif.

### Farming dan Market

- `farm`: melihat ladang, storage, menanam, dan memanen.
- `craft`: melihat resep, membuat item, mengecek queue, dan claim hasil craft.
- `market`: melihat listing, menjual item ke market pemain, dan membeli listing.

## Contoh Alur Pemain

```text
!register
!job list
!job apply janitor
!work
!daily
!shop
!buy wheat 10
!farm plantall wheat
!farm harvestall
!craft list
!craft start flour 2
```

Slash command juga tersedia untuk command yang sama, contohnya `/job list`, `/work`, dan `/farm view`.

## Konfigurasi Game

Beberapa data gameplay bisa diubah lewat file konfigurasi:

- `config.json`: prefix yang direncanakan, cooldown default, modal awal, dan reward daily.
- `config/crops.json`: tanaman, waktu tumbuh, hasil panen, dan harga benih.
- `config/recipes.json`: resep crafting pemain.
- `config/shop.json`: item shop, harga dasar, stok target, batas harga, dan resep produksi shop AI.
- `config/tools.json`: data tools seperti sprinkler.

## Database

Project ini tidak memakai file migration manual. Schema dibuat dan diperbarui otomatis saat bot masuk ke event `ready`.

Tabel utama yang disiapkan antara lain:

- `users`
- `user_skills`
- `jobs`
- `inventory`
- `user_farms`
- `farm_tiles`
- `user_storage`
- `market_listings`
- `global_shop`
- `shop_inventory`
- `shop_production_queue`

Pastikan user database punya izin untuk `CREATE TABLE`, `ALTER TABLE`, `INSERT`, `SELECT`, `UPDATE`, dan `DELETE`.

## Development Notes

- Command baru bisa ditambahkan di folder `commands/<kategori>/`.
- Command yang punya `slash: true` dan `data: new SlashCommandBuilder()` akan dikumpulkan oleh `index.js` lalu didaftarkan saat bot ready.
- Cooldown command dicek lewat Redis di `utils/middleware`.
- Transaksi database memakai helper `botHandlers/mysqlHandler.js`.
- Game loop berada di `managers/GameLoop.js`.

## Troubleshooting

- Jika slash command belum muncul, tunggu propagasi global command Discord atau cek `CLIENT_ID` dan `DISCORD_TOKEN`.
- Jika command error terkait database, pastikan MariaDB/MySQL aktif dan `.env` sudah benar.
- Jika cooldown tidak berjalan atau muncul error Redis, pastikan Redis aktif atau isi `REDIS_URL`.
- Jika bot tidak membaca prefix selain `!`, itu sesuai kondisi handler saat ini.
