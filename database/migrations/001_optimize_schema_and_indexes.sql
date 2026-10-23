-- Migration: 001_optimize_schema_and_indexes.sql
-- Description: Unifikasi tabel users dan penambahan indeks kritis untuk optimasi query

-- 1. Konsolidasi tabel users
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(25) PRIMARY KEY,
    cash BIGINT UNSIGNED DEFAULT 0,
    bank BIGINT UNSIGNED DEFAULT 0,
    energy INT DEFAULT 100,
    hunger INT DEFAULT 100,
    level INT DEFAULT 1,
    exp INT DEFAULT 0,
    skill_points INT DEFAULT 0,
    job_id VARCHAR(50) DEFAULT NULL,
    job_level INT DEFAULT 1,
    job_exp INT DEFAULT 0,
    mining_level INT DEFAULT 1,
    mining_exp INT DEFAULT 0,
    daily_streak INT DEFAULT 0,
    last_daily BIGINT DEFAULT 0,
    last_work BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_wealth (cash, bank),
    INDEX idx_user_level (level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Indeks untuk Farm Tiles (Optimasi Game Loop & Pertanian)
-- Mencegah Full Table Scan tiap 60 detik pada processGrowth
CREATE TABLE IF NOT EXISTS farm_tiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(25),
    x INT,
    y INT,
    crop_id VARCHAR(50) DEFAULT NULL,
    growth INT DEFAULT 0,
    is_watered BOOLEAN DEFAULT FALSE,
    UNIQUE KEY unique_tile (user_id, x, y),
    INDEX idx_crop_growth (crop_id, growth),
    INDEX idx_crop_watered (crop_id, is_watered)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Indeks untuk Antrean AI Shop Production
CREATE TABLE IF NOT EXISTS shop_production_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    recipe_id VARCHAR(50),
    amount INT,
    end_time BIGINT,
    INDEX idx_queue_end_time (end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Indeks untuk Market Listings
CREATE TABLE IF NOT EXISTS market_listings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    seller_id VARCHAR(25),
    item_id VARCHAR(50),
    amount INT,
    price BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_market_seller (seller_id),
    INDEX idx_market_item (item_id),
    INDEX idx_market_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Indeks untuk Crafting Queue
CREATE TABLE IF NOT EXISTS crafting_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(25),
    recipe_id VARCHAR(50),
    amount INT,
    start_time BIGINT,
    end_time BIGINT,
    INDEX idx_crafting_user (user_id),
    INDEX idx_crafting_end (end_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
