SET FOREIGN_KEY_CHECKS = 0;

-- ========================================================
-- 1. TABEL MASTER: JOBS
-- ========================================================
CREATE TABLE IF NOT EXISTS jobs (
    id VARCHAR(50) PRIMARY KEY COMMENT 'ID unik profesi (contoh: janitor, barista, programmer)',
    name VARCHAR(50) NOT NULL COMMENT 'Nama tampilan pekerjaan',
    emoji VARCHAR(10) DEFAULT '💼' COMMENT 'Emoji Discord untuk profesi',
    min_salary INT UNSIGNED NOT NULL COMMENT 'Gaji minimum per shift (Lp)',
    max_salary INT UNSIGNED NOT NULL COMMENT 'Gaji maksimum per shift (Lp)',
    cooldown BIGINT UNSIGNED NOT NULL COMMENT 'Durasi jeda kerja dalam milidetik',
    min_exp INT UNSIGNED DEFAULT 10 COMMENT 'EXP minimum per shift',
    max_exp INT UNSIGNED DEFAULT 20 COMMENT 'EXP maksimum per shift',
    required_level INT UNSIGNED DEFAULT 1 COMMENT 'Level karakter minimum untuk melamar',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Waktu pembuatan data profesi'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Daftar profesi dan batas gaji karakter';

-- ========================================================
-- 2. MODUL USER (Identitas, Keuangan, RPG & Inventaris)
-- ========================================================
CREATE TABLE IF NOT EXISTS users (
    -- [A] Identitas Akun
    user_id VARCHAR(25) PRIMARY KEY COMMENT 'ID Snowflake Pengguna Discord',
    
    -- [B] Finansial & Dompet
    cash BIGINT UNSIGNED DEFAULT 0 COMMENT 'Uang tunai cair di dompet',
    bank BIGINT UNSIGNED DEFAULT 0 COMMENT 'Saldo tabungan di bank',
    last_daily BIGINT UNSIGNED DEFAULT 0 COMMENT 'Timestamp klaim daily terakhir (ms)',
    daily_streak INT UNSIGNED DEFAULT 0 COMMENT 'Runtunan hari klaim reward harian',
    
    -- [C] Status Fisik (Survival)
    energy TINYINT UNSIGNED DEFAULT 100 COMMENT 'Energi karakter (0-100)',
    hunger TINYINT UNSIGNED DEFAULT 100 COMMENT 'Tingkat kekenyangan karakter (0-100)',
    
    -- [D] RPG Level & Kemampuan
    level INT UNSIGNED DEFAULT 1 COMMENT 'Level utama karakter',
    exp INT UNSIGNED DEFAULT 0 COMMENT 'EXP utama karakter',
    skill_points INT UNSIGNED DEFAULT 0 COMMENT 'Poin skill yang belum dipakai',
    
    -- [E] Karir & Penguasaan Profesi
    job_id VARCHAR(50) DEFAULT NULL COMMENT 'ID profesi saat ini',
    last_work BIGINT UNSIGNED DEFAULT 0 COMMENT 'Timestamp kerja shift terakhir (ms)',
    job_level INT UNSIGNED DEFAULT 1 COMMENT 'Tingkat keahlian profesi (Job Mastery)',
    job_exp INT UNSIGNED DEFAULT 0 COMMENT 'EXP keahlian profesi saat ini',
    
    -- [F] Mining Mastery
    mining_level INT UNSIGNED DEFAULT 1 COMMENT 'Tingkat kemampuan menambang',
    mining_exp INT UNSIGNED DEFAULT 0 COMMENT 'EXP menambang saat ini',
    
    -- [G] Jejak Waktu
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Waktu pembuatan akun',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Waktu pembaruan data terakhir',
    
    INDEX idx_user_wealth (cash, bank),
    INDEX idx_user_level (level),
    CONSTRAINT fk_users_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tabel induk pemain: profil, saldo, survival, RPG, dan karir';

CREATE TABLE IF NOT EXISTS user_skills (
    user_id VARCHAR(25) PRIMARY KEY COMMENT 'ID Pengguna Discord',
    income TINYINT UNSIGNED DEFAULT 0 COMMENT 'Level skill penambah gaji (0-5)',
    cooldown_skill TINYINT UNSIGNED DEFAULT 0 COMMENT 'Level skill pemotong durasi kerja (0-5)',
    luck TINYINT UNSIGNED DEFAULT 0 COMMENT 'Level skill peluang gaji dobel (0-5)',
    defense TINYINT UNSIGNED DEFAULT 0 COMMENT 'Level skill proteksi kegagalan kerja (0-5)',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_skills_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Pohon keahlian pasif pemain';

CREATE TABLE IF NOT EXISTS user_inventory (
    user_id VARCHAR(25) COMMENT 'ID Pengguna Discord',
    item_id VARCHAR(50) COMMENT 'ID Item (tool, seed, consumable, ore, fish, junk)',
    amount INT UNSIGNED DEFAULT 0 COMMENT 'Jumlah unit yang dibawa di tas',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, item_id),
    CONSTRAINT fk_inv_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tas bawaan utama pemain';

-- ========================================================
-- 3. MODUL LADANG & LUMBUNG PENYIMPANAN
-- ========================================================
CREATE TABLE IF NOT EXISTS farm_profiles (
    user_id VARCHAR(25) PRIMARY KEY COMMENT 'ID Pemilik Ladang',
    width TINYINT UNSIGNED DEFAULT 5 COMMENT 'Lebar petak ladang (sumbu X)',
    height TINYINT UNSIGNED DEFAULT 5 COMMENT 'Panjang petak ladang (sumbu Y)',
    max_storage INT UNSIGNED DEFAULT 50 COMMENT 'Kapasitas maksimal lumbung hasil panen',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_farm_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Spesifikasi dimensi ladang dan kapasitas gudang pemain';

CREATE TABLE IF NOT EXISTS farm_tiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(25) NOT NULL COMMENT 'ID Pemilik Petak',
    x TINYINT UNSIGNED NOT NULL COMMENT 'Koordinat petak X (0-based)',
    y TINYINT UNSIGNED NOT NULL COMMENT 'Koordinat petak Y (0-based)',
    crop_id VARCHAR(50) DEFAULT NULL COMMENT 'ID komoditas tanaman (NULL jika kosong)',
    growth TINYINT UNSIGNED DEFAULT 0 COMMENT 'Progres pertumbuhan tanaman (0-100%)',
    is_watered BOOLEAN DEFAULT FALSE COMMENT 'Status penyiraman air (TRUE = tumbuh 2x)',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_tile (user_id, x, y),
    INDEX idx_crop_growth (crop_id, growth),
    INDEX idx_crop_watered (crop_id, is_watered),
    CONSTRAINT fk_tiles_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Petak tanah ladang aktif';

CREATE TABLE IF NOT EXISTS farm_storage (
    user_id VARCHAR(25) COMMENT 'ID Pemilik Gudang',
    item_id VARCHAR(50) COMMENT 'ID Komoditas Panen / Olahan',
    amount INT UNSIGNED DEFAULT 0 COMMENT 'Jumlah stok di gudang pertanian',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, item_id),
    CONSTRAINT fk_storage_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Gudang lumbung hasil panen ladang';

-- ========================================================
-- 4. MODUL PASAR & CRAFTING
-- ========================================================
CREATE TABLE IF NOT EXISTS crafting_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(25) NOT NULL COMMENT 'ID Pemesan',
    recipe_id VARCHAR(50) NOT NULL COMMENT 'ID Resep makanan/barang',
    amount INT UNSIGNED NOT NULL COMMENT 'Jumlah unit yang dimasak/dibuat',
    start_time BIGINT UNSIGNED NOT NULL COMMENT 'Waktu mulai proses (ms)',
    end_time BIGINT UNSIGNED NOT NULL COMMENT 'Waktu selesai proses dan siap diklaim (ms)',
    INDEX idx_crafting_user (user_id),
    INDEX idx_crafting_end (end_time),
    CONSTRAINT fk_craft_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Antrean pengolahan bahan mentah pemain';

CREATE TABLE IF NOT EXISTS market_listings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    seller_id VARCHAR(25) NOT NULL COMMENT 'ID Pemain Penjual',
    item_id VARCHAR(50) NOT NULL COMMENT 'ID Barang yang dijual dari farm_storage',
    amount INT UNSIGNED NOT NULL COMMENT 'Jumlah unit yang ditawarkan',
    price BIGINT UNSIGNED NOT NULL COMMENT 'Harga total listing (Lp)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Waktu pembuatan listing pasar',
    INDEX idx_market_seller (seller_id),
    INDEX idx_market_item (item_id),
    INDEX idx_market_created (created_at DESC),
    CONSTRAINT fk_market_seller FOREIGN KEY (seller_id) REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Bursa pasar komoditas antar pemain';

-- ========================================================
-- 5. MODUL TOKO GLOBAL & PABRIK OTOMATIS
-- ========================================================
CREATE TABLE IF NOT EXISTS shop_global (
    id INT PRIMARY KEY COMMENT 'ID Toko (Default = 1)',
    cash BIGINT UNSIGNED DEFAULT 1000000 COMMENT 'Kas likuiditas toko NPC',
    max_storage INT UNSIGNED DEFAULT 10000 COMMENT 'Kapasitas maksimal tampung stok toko',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Status modal dan kapasitas toko global NPC';

CREATE TABLE IF NOT EXISTS shop_inventory (
    item_id VARCHAR(50) PRIMARY KEY COMMENT 'ID Komoditas Toko',
    amount INT UNSIGNED DEFAULT 0 COMMENT 'Stok tersedia di toko NPC',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Stok komoditas toko dengan algoritma harga dinamis';

CREATE TABLE IF NOT EXISTS shop_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    recipe_id VARCHAR(50) NOT NULL COMMENT 'ID Produk yang diproduksi otomatis',
    amount INT UNSIGNED NOT NULL COMMENT 'Jumlah unit yang dikonversi',
    end_time BIGINT UNSIGNED NOT NULL COMMENT 'Timestamp waktu selesai produksi (ms)',
    INDEX idx_shop_queue_end (end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Pabrik konversi bahan mentah toko otomatis';

-- --------------------------------------------------------
-- DATA DEFAULT SEED
-- --------------------------------------------------------
INSERT INTO shop_global (id, cash, max_storage) VALUES (1, 500000, 10000)
ON DUPLICATE KEY UPDATE cash = VALUES(cash);

INSERT INTO jobs (id, name, min_salary, max_salary, cooldown, min_exp, max_exp, required_level, emoji) VALUES 
('janitor', 'Janitor', 500, 900, 60000, 25, 65, 1, '🧹'),
('barista', 'Barista', 1100, 1800, 120000, 70, 150, 3, '☕'),
('programmer', 'Programmer', 2500, 4000, 300000, 150, 320, 5, '💻')
ON DUPLICATE KEY UPDATE 
    min_salary = VALUES(min_salary),
    max_salary = VALUES(max_salary),
    cooldown = VALUES(cooldown);

SET FOREIGN_KEY_CHECKS = 1;
