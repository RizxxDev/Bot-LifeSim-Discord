-- Migrasi 012: Sistem Properti Modular Sandbox ("Bebas Bangun Apa Saja") & Multi-Kavling Lintas Kota

ALTER TABLE players
    ADD COLUMN IF NOT EXISTS gathering_xp BIGINT NOT NULL DEFAULT 0 AFTER cooking_xp,
    ADD COLUMN IF NOT EXISTS last_gather_loc VARCHAR(32) NOT NULL DEFAULT 'hutan_pinus' AFTER last_farm_crop;

ALTER TABLE player_inventory
    ADD COLUMN IF NOT EXISTS land_id BIGINT DEFAULT NULL AFTER discord_id,
    ADD INDEX IF NOT EXISTS idx_inv_user_land_loc_item (discord_id, land_id, storage_location, item_id);

ALTER TABLE player_credits
    MODIFY COLUMN asset_category ENUM('vehicle', 'property', 'land') NOT NULL,
    MODIFY COLUMN asset_id VARCHAR(64) NOT NULL,
    ADD COLUMN IF NOT EXISTS land_id BIGINT DEFAULT NULL AFTER asset_id;

CREATE TABLE IF NOT EXISTS player_lands (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    city_id VARCHAR(32) NOT NULL DEFAULT 'kota_sentral',
    custom_name VARCHAR(64) NOT NULL DEFAULT 'Kavling Pribadi',
    description TEXT,
    width TINYINT NOT NULL DEFAULT 3,
    height TINYINT NOT NULL DEFAULT 3,
    land_tier VARCHAR(24) NOT NULL DEFAULT 'mini_3x3',
    theme_id VARCHAR(32) NOT NULL DEFAULT 'minimalis',
    is_primary TINYINT(1) NOT NULL DEFAULT 0,
    purchase_price BIGINT NOT NULL DEFAULT 0,
    condition_pct DOUBLE NOT NULL DEFAULT 100,
    next_pbb_at BIGINT NOT NULL DEFAULT 0,
    acquired_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    INDEX idx_lands_user_city (discord_id, city_id),
    INDEX idx_lands_pbb (next_pbb_at),
    CONSTRAINT fk_lands_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS land_grid_cells (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT NOT NULL,
    layout_state ENUM('active', 'draft') NOT NULL DEFAULT 'draft',
    floor_level TINYINT NOT NULL DEFAULT 1,
    x TINYINT NOT NULL,
    y TINYINT NOT NULL,
    zone_group_id VARCHAR(36) NOT NULL,
    zone_name VARCHAR(64) NOT NULL,
    module_id VARCHAR(48) NOT NULL,
    material_id VARCHAR(32) NOT NULL DEFAULT 'kayu',
    color_hex VARCHAR(16) DEFAULT NULL,
    meta_json TEXT,
    UNIQUE KEY uq_cell (land_id, layout_state, floor_level, x, y),
    INDEX idx_cell_land_state (land_id, layout_state, floor_level),
    CONSTRAINT fk_cell_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS land_material_depots (
    land_id BIGINT NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    PRIMARY KEY (land_id, item_id),
    CONSTRAINT fk_depot_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS construction_projects (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT NOT NULL,
    discord_id VARCHAR(32) NOT NULL,
    project_type ENUM('build', 'renovate', 'expand') NOT NULL DEFAULT 'build',
    status ENUM('funding', 'building', 'completed', 'cancelled') NOT NULL DEFAULT 'funding',
    required_materials_json TEXT NOT NULL,
    started_at BIGINT NOT NULL DEFAULT 0,
    finishes_at BIGINT NOT NULL DEFAULT 0,
    worker_boost_ms BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    INDEX idx_proj_land_status (land_id, status),
    INDEX idx_proj_user_status (discord_id, status),
    CONSTRAINT fk_proj_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE,
    CONSTRAINT fk_proj_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS land_business_state (
    land_id BIGINT NOT NULL,
    zone_group_id VARCHAR(36) NOT NULL,
    business_type VARCHAR(32) NOT NULL,
    stock_json TEXT,
    pending_revenue BIGINT NOT NULL DEFAULT 0,
    last_tick_at BIGINT NOT NULL DEFAULT 0,
    is_open TINYINT(1) NOT NULL DEFAULT 1,
    PRIMARY KEY (land_id, zone_group_id),
    CONSTRAINT fk_biz_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workshop_queues (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT DEFAULT NULL,
    discord_id VARCHAR(32) NOT NULL,
    station_module VARCHAR(48) NOT NULL,
    recipe_id VARCHAR(48) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    started_at BIGINT NOT NULL,
    finishes_at BIGINT NOT NULL,
    INDEX idx_ws_user (discord_id, finishes_at),
    CONSTRAINT fk_ws_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE,
    CONSTRAINT fk_ws_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS property_leases (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT DEFAULT NULL,
    zone_group_id VARCHAR(36) DEFAULT NULL,
    owner_id VARCHAR(32) DEFAULT NULL,
    tenant_id VARCHAR(32) NOT NULL,
    city_id VARCHAR(32) NOT NULL DEFAULT 'kota_sentral',
    lease_kind ENUM('npc_preset', 'p2p_room', 'p2p_whole') NOT NULL DEFAULT 'npc_preset',
    preset_tier VARCHAR(32) DEFAULT NULL,
    weekly_rent BIGINT NOT NULL DEFAULT 0,
    next_billing_at BIGINT NOT NULL DEFAULT 0,
    grace_until BIGINT NOT NULL DEFAULT 0,
    is_evicted TINYINT(1) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    INDEX idx_lease_tenant_city (tenant_id, city_id, is_evicted),
    INDEX idx_lease_owner (owner_id, is_evicted),
    INDEX idx_lease_land (land_id, zone_group_id, is_evicted),
    INDEX idx_lease_due (is_evicted, next_billing_at),
    CONSTRAINT fk_lease_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE,
    CONSTRAINT fk_lease_tenant FOREIGN KEY (tenant_id) REFERENCES players(discord_id) ON DELETE CASCADE,
    CONSTRAINT fk_lease_owner FOREIGN KEY (owner_id) REFERENCES players(discord_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS property_market_listings (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT NOT NULL,
    seller_id VARCHAR(32) NOT NULL,
    buyer_id VARCHAR(32) DEFAULT NULL,
    city_id VARCHAR(32) NOT NULL DEFAULT 'kota_sentral',
    asking_price BIGINT NOT NULL,
    appraisal_value BIGINT NOT NULL,
    status ENUM('active', 'sold', 'cancelled') NOT NULL DEFAULT 'active',
    created_at BIGINT NOT NULL,
    sold_at BIGINT DEFAULT NULL,
    INDEX idx_mkt_status_city (status, city_id),
    INDEX idx_mkt_land_status (land_id, status),
    CONSTRAINT fk_mkt_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE,
    CONSTRAINT fk_mkt_seller FOREIGN KEY (seller_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS property_blueprints (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    share_code VARCHAR(32) NOT NULL UNIQUE,
    author_id VARCHAR(32) NOT NULL,
    title VARCHAR(64) NOT NULL,
    width TINYINT NOT NULL,
    height TINYINT NOT NULL,
    theme_id VARCHAR(32) NOT NULL DEFAULT 'minimalis',
    layout_json MEDIUMTEXT NOT NULL,
    usage_count INT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    INDEX idx_bp_author (author_id),
    CONSTRAINT fk_bp_author FOREIGN KEY (author_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migrasi non-destruktif properti milik pribadi lama (rumah / rumah_mewah) ke player_lands
INSERT INTO player_lands (
    discord_id, city_id, custom_name, description, width, height, land_tier,
    theme_id, is_primary, purchase_price, condition_pct, next_pbb_at, acquired_at, updated_at
)
SELECT
    pp.discord_id,
    COALESCE(pp.city_id, 'kota_sentral'),
    CASE WHEN pp.property_tier = 'rumah_mewah' THEN 'Rumah Mewah (Migrasi)' ELSE 'Rumah Pribadi (Migrasi)' END,
    'Rumah hasil migrasi otomatis dari kepemilikan lama.',
    CASE WHEN pp.property_tier = 'rumah_mewah' THEN 6 ELSE 4 END,
    CASE WHEN pp.property_tier = 'rumah_mewah' THEN 6 ELSE 4 END,
    CASE WHEN pp.property_tier = 'rumah_mewah' THEN 'luas_6x6' ELSE 'standar_4x4' END,
    CASE WHEN pp.property_tier = 'rumah_mewah' THEN 'sultan_klasik' ELSE 'minimalis' END,
    1,
    CASE WHEN pp.property_tier = 'rumah_mewah' THEN 55000000 ELSE 18000000 END,
    100,
    pp.next_billing_at,
    pp.acquired_at,
    pp.updated_at
FROM player_properties pp
WHERE pp.ownership_type = 'owned'
  AND pp.property_tier IN ('rumah', 'rumah_pribadi', 'rumah_mewah')
  AND NOT EXISTS (
      SELECT 1 FROM player_lands pl WHERE pl.discord_id = pp.discord_id
  );

-- Migrasi sel grid standar (4x4) untuk bekas pemilik rumah
INSERT IGNORE INTO land_grid_cells (
    land_id, layout_state, floor_level, x, y, zone_group_id, zone_name, module_id, material_id, color_hex, meta_json
)
SELECT pl.id, 'active', 1, v.x, v.y, v.zg, v.zn, v.mod_id, 'bata', v.col, NULL
FROM player_lands pl
JOIN player_properties pp ON pp.discord_id = pl.discord_id
JOIN (
    SELECT 0 AS x, 0 AS y, 'mig-bed' AS zg, 'Kamar Utama' AS zn, 'bedroom_lux' AS mod_id, '#6366f1' AS col
    UNION ALL SELECT 1, 0, 'mig-kit', 'Dapur Keluarga', 'kitchen_pro', '#f59e0b'
    UNION ALL SELECT 2, 0, 'mig-frg', 'Ruang Kulkas', 'fridge_room', '#06b6d4'
    UNION ALL SELECT 3, 0, 'mig-frg', 'Ruang Kulkas', 'fridge_room', '#06b6d4'
    UNION ALL SELECT 0, 1, 'mig-frz', 'Ruang Freezer', 'freezer_room', '#0284c7'
    UNION ALL SELECT 1, 1, 'mig-wh', 'Gudang Rumah', 'warehouse_cell', '#78716c'
    UNION ALL SELECT 2, 1, 'mig-wh', 'Gudang Rumah', 'warehouse_cell', '#78716c'
    UNION ALL SELECT 3, 1, 'mig-grd', 'Teras & Taman', 'garden', '#22c55e'
) v ON 1=1
WHERE pp.ownership_type = 'owned'
  AND pp.property_tier IN ('rumah', 'rumah_pribadi')
  AND NOT EXISTS (SELECT 1 FROM land_grid_cells lgc WHERE lgc.land_id = pl.id);

-- Migrasi sel grid mewah (6x6) untuk bekas pemilik rumah_mewah
INSERT IGNORE INTO land_grid_cells (
    land_id, layout_state, floor_level, x, y, zone_group_id, zone_name, module_id, material_id, color_hex, meta_json
)
SELECT pl.id, 'active', 1, v.x, v.y, v.zg, v.zn, v.mod_id, v.mat_id, v.col, NULL
FROM player_lands pl
JOIN player_properties pp ON pp.discord_id = pl.discord_id
JOIN (
    SELECT 0 AS x, 0 AS y, 'mig-bed' AS zg, 'Suite Utama' AS zn, 'bedroom_lux' AS mod_id, 'marmer' AS mat_id, '#6366f1' AS col
    UNION ALL SELECT 1, 0, 'mig-bed', 'Suite Utama', 'bedroom_lux', 'marmer', '#6366f1'
    UNION ALL SELECT 2, 0, 'mig-kit1', 'Dapur Chef', 'kitchen_pro', 'beton', '#f59e0b'
    UNION ALL SELECT 3, 0, 'mig-kit2', 'Pantry Samping', 'kitchen_basic', 'beton', '#f59e0b'
    UNION ALL SELECT 4, 0, 'mig-frg', 'Ruang Kulkas', 'fridge_room', 'beton', '#06b6d4'
    UNION ALL SELECT 5, 0, 'mig-frg', 'Ruang Kulkas', 'fridge_room', 'beton', '#06b6d4'
    UNION ALL SELECT 0, 1, 'mig-frg', 'Ruang Kulkas', 'fridge_room', 'beton', '#06b6d4'
    UNION ALL SELECT 1, 1, 'mig-frz', 'Walk-in Freezer', 'freezer_room', 'beton', '#0284c7'
    UNION ALL SELECT 2, 1, 'mig-frz', 'Walk-in Freezer', 'freezer_room', 'beton', '#0284c7'
    UNION ALL SELECT 3, 1, 'mig-wh', 'Gudang Utama', 'warehouse_cell', 'beton', '#78716c'
    UNION ALL SELECT 4, 1, 'mig-wh', 'Gudang Utama', 'warehouse_cell', 'beton', '#78716c'
    UNION ALL SELECT 5, 1, 'mig-wh', 'Gudang Utama', 'warehouse_cell', 'beton', '#78716c'
    UNION ALL SELECT 0, 2, 'mig-wh', 'Gudang Utama', 'warehouse_cell', 'beton', '#78716c'
    UNION ALL SELECT 1, 2, 'mig-pool', 'Kolam Renang', 'pool', 'kaca', '#38bdf8'
    UNION ALL SELECT 2, 2, 'mig-pool', 'Kolam Renang', 'pool', 'kaca', '#38bdf8'
    UNION ALL SELECT 3, 2, 'mig-gar', 'Garasi Mewah', 'garage', 'beton', '#64748b'
) v ON 1=1
WHERE pp.ownership_type = 'owned'
  AND pp.property_tier = 'rumah_mewah'
  AND NOT EXISTS (SELECT 1 FROM land_grid_cells lgc WHERE lgc.land_id = pl.id);

-- Tautkan isi penyimpanan lama (kulkas/freezer/gudang) ke kavling perdana milik pemain
UPDATE player_inventory pi
JOIN (
    SELECT discord_id, MIN(id) AS first_land_id
    FROM player_lands
    GROUP BY discord_id
) pl ON pl.discord_id = pi.discord_id
SET pi.land_id = pl.first_land_id
WHERE pi.storage_location IN ('kulkas', 'freezer', 'gudang')
  AND pi.land_id IS NULL;

-- Migrasi sewa NPC pemula (kos / kontrakan) ke property_leases
INSERT INTO property_leases (
    land_id, zone_group_id, owner_id, tenant_id, city_id,
    lease_kind, preset_tier, weekly_rent, next_billing_at, grace_until, is_evicted, created_at
)
SELECT
    NULL, NULL, NULL, pp.discord_id, COALESCE(pp.city_id, 'kota_sentral'),
    'npc_preset', pp.property_tier,
    CASE WHEN pp.property_tier = 'kontrakan' THEN 175000 ELSE 70000 END,
    pp.next_billing_at, pp.grace_until, pp.is_evicted, pp.acquired_at
FROM player_properties pp
WHERE pp.ownership_type = 'rent'
  AND pp.property_tier IN ('kos', 'kontrakan')
  AND NOT EXISTS (
      SELECT 1 FROM property_leases pl
      WHERE pl.tenant_id = pp.discord_id AND pl.lease_kind = 'npc_preset'
  );
