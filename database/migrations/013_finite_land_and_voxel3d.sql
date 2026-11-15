-- Migrasi 013: Sistem Kavling Kota Terbatas, Penawaran P2P Langsung, Voxel 3D Isometrik & Degradasi Bangunan

CREATE TABLE IF NOT EXISTS city_land_parcels (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    parcel_code VARCHAR(24) NOT NULL UNIQUE,
    city_id VARCHAR(32) NOT NULL,
    district_no INT NOT NULL DEFAULT 1,
    lot_no INT NOT NULL DEFAULT 1,
    size_tier VARCHAR(24) NOT NULL DEFAULT 'S',
    width TINYINT NOT NULL DEFAULT 4,
    height TINYINT NOT NULL DEFAULT 4,
    base_price BIGINT NOT NULL DEFAULT 15000000,
    status ENUM('available', 'owned', 'foreclosed', 'auction') NOT NULL DEFAULT 'available',
    owner_id VARCHAR(32) DEFAULT NULL,
    land_id BIGINT DEFAULT NULL,
    foreclosed_at BIGINT DEFAULT NULL,
    foreclosed_price BIGINT DEFAULT NULL,
    auction_price BIGINT DEFAULT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL DEFAULT 0,
    INDEX idx_parcel_city_status (city_id, status, district_no),
    INDEX idx_parcel_owner (owner_id),
    INDEX idx_parcel_land (land_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS land_trade_offers (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT NOT NULL,
    seller_id VARCHAR(32) NOT NULL,
    buyer_id VARCHAR(32) NOT NULL,
    city_id VARCHAR(32) NOT NULL DEFAULT 'kota_sentral',
    offer_price BIGINT NOT NULL DEFAULT 0,
    offered_price BIGINT NOT NULL DEFAULT 0,
    appraisal_value BIGINT NOT NULL,
    status ENUM('pending', 'accepted', 'declined', 'cancelled', 'expired') NOT NULL DEFAULT 'pending',
    expires_at BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    resolved_at BIGINT DEFAULT NULL,
    INDEX idx_offer_buyer_status (buyer_id, status),
    INDEX idx_offer_seller_status (seller_id, status),
    INDEX idx_offer_land_status (land_id, status),
    CONSTRAINT fk_offer_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE,
    CONSTRAINT fk_offer_seller FOREIGN KEY (seller_id) REFERENCES players(discord_id) ON DELETE CASCADE,
    CONSTRAINT fk_offer_buyer FOREIGN KEY (buyer_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS property_likes (
    land_id BIGINT NOT NULL,
    liker_id VARCHAR(32) NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (land_id, liker_id),
    CONSTRAINT fk_like_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE,
    CONSTRAINT fk_like_player FOREIGN KEY (liker_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE player_lands
    ADD COLUMN IF NOT EXISTS parcel_code VARCHAR(24) DEFAULT NULL AFTER id,
    ADD COLUMN IF NOT EXISTS district_no INT NOT NULL DEFAULT 1 AFTER city_id,
    ADD COLUMN IF NOT EXISTS building_state ENUM('empty', 'active', 'abandoned', 'collapsed') NOT NULL DEFAULT 'active' AFTER condition_pct,
    ADD COLUMN IF NOT EXISTS last_condition_tick_at BIGINT NOT NULL DEFAULT 0 AFTER building_state,
    ADD COLUMN IF NOT EXISTS abandoned_since BIGINT NOT NULL DEFAULT 0 AFTER last_condition_tick_at,
    ADD COLUMN IF NOT EXISTS abandoned_notified TINYINT(1) NOT NULL DEFAULT 0 AFTER abandoned_since,
    ADD COLUMN IF NOT EXISTS collapsed_at BIGINT NOT NULL DEFAULT 0 AFTER abandoned_notified,
    ADD COLUMN IF NOT EXISTS grace_until BIGINT NOT NULL DEFAULT 0 AFTER next_pbb_at,
    ADD COLUMN IF NOT EXISTS like_count INT NOT NULL DEFAULT 0 AFTER grace_until,
    ADD INDEX IF NOT EXISTS idx_lands_parcel (parcel_code),
    ADD INDEX IF NOT EXISTS idx_lands_state (building_state, next_pbb_at);

ALTER TABLE land_grid_cells
    MODIFY COLUMN floor_level SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS block_kind ENUM('module', 'shape', 'roof') NOT NULL DEFAULT 'module' AFTER zone_name,
    ADD COLUMN IF NOT EXISTS shape_variant VARCHAR(32) DEFAULT NULL AFTER material_id;

ALTER TABLE player_inventory
    ADD COLUMN IF NOT EXISTS emergency_locked TINYINT(1) NOT NULL DEFAULT 0 AFTER storage_location;

-- Seed 12 kavling perdana Distrik 1 di masing-masing dari 3 kota (S 4x4, M 6x6, L 8x8, XL 10x10)
INSERT IGNORE INTO city_land_parcels (
    parcel_code, city_id, district_no, size_tier, width, height, base_price,
    status, owner_id, land_id, created_at, updated_at
)
SELECT
    CONCAT(c.prefix, '-D1-', LPAD(s.slot_no, 2, '0')),
    c.city_id,
    1,
    s.size_tier,
    s.dim,
    s.dim,
    ROUND(c.base_land * s.price_mult + s.permit_fee),
    'available',
    NULL,
    NULL,
    UNIX_TIMESTAMP() * 1000,
    UNIX_TIMESTAMP() * 1000
FROM (
    SELECT 'kota_barat' AS city_id, 'KB' AS prefix, 15000000 AS base_land
    UNION ALL SELECT 'kota_sentral', 'KS', 35000000
    UNION ALL SELECT 'kota_timur', 'KT', 12000000
) c
JOIN (
    SELECT 1 AS slot_no, 'S' AS size_tier, 4 AS dim, 1.0 AS price_mult, 1500000 AS permit_fee
    UNION ALL SELECT 2, 'S', 4, 1.0, 1500000
    UNION ALL SELECT 3, 'S', 4, 1.0, 1500000
    UNION ALL SELECT 4, 'S', 4, 1.0, 1500000
    UNION ALL SELECT 5, 'S', 4, 1.0, 1500000
    UNION ALL SELECT 6, 'M', 6, 2.2, 4500000
    UNION ALL SELECT 7, 'M', 6, 2.2, 4500000
    UNION ALL SELECT 8, 'M', 6, 2.2, 4500000
    UNION ALL SELECT 9, 'M', 6, 2.2, 4500000
    UNION ALL SELECT 10, 'L', 8, 4.0, 10000000
    UNION ALL SELECT 11, 'L', 8, 4.0, 10000000
    UNION ALL SELECT 12, 'XL', 10, 6.8, 22000000
) s ON 1=1;

-- Inisialisasi last_condition_tick_at pada kavling lama yang sudah ada
UPDATE player_lands
SET last_condition_tick_at = updated_at
WHERE last_condition_tick_at = 0;
