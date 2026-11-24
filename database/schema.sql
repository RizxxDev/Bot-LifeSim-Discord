CREATE TABLE IF NOT EXISTS players (
    discord_id VARCHAR(32) NOT NULL PRIMARY KEY,
    username VARCHAR(16) NOT NULL,
    username_lower VARCHAR(16) NOT NULL UNIQUE,
    cash BIGINT NOT NULL DEFAULT 150000,
    bank BIGINT NOT NULL DEFAULT 0,
    energy DOUBLE NOT NULL DEFAULT 100,
    hunger DOUBLE NOT NULL DEFAULT 100,
    thirst DOUBLE NOT NULL DEFAULT 100,
    health DOUBLE NOT NULL DEFAULT 100,
    last_tick_at BIGINT NOT NULL,
    current_city VARCHAR(32) NOT NULL DEFAULT 'kota_sentral',
    traveling_until BIGINT NOT NULL DEFAULT 0,
    travel_origin VARCHAR(32) DEFAULT NULL,
    travel_destination VARCHAR(32) DEFAULT NULL,
    travel_has_driver TINYINT(1) NOT NULL DEFAULT 0,
    sleeping_until BIGINT NOT NULL DEFAULT 0,
    hospital_until BIGINT NOT NULL DEFAULT 0,
    education_level VARCHAR(16) NOT NULL DEFAULT 'SD',
    study_target VARCHAR(16) DEFAULT NULL,
    study_sessions INT NOT NULL DEFAULT 0,
    current_job VARCHAR(32) DEFAULT NULL,
    job_resigned_at BIGINT NOT NULL DEFAULT 0,
    total_shifts INT NOT NULL DEFAULT 0,
    fishing_xp BIGINT NOT NULL DEFAULT 0,
    mining_xp BIGINT NOT NULL DEFAULT 0,
    farming_xp BIGINT NOT NULL DEFAULT 0,
    cooking_xp BIGINT NOT NULL DEFAULT 0,
    gathering_xp BIGINT NOT NULL DEFAULT 0,
    cooked_dishes_eaten INT NOT NULL DEFAULT 0,
    lpg_charges INT NOT NULL DEFAULT 0,
    backpack_tier INT NOT NULL DEFAULT 0,
    max_slots INT NOT NULL DEFAULT 20,
    equipped_title VARCHAR(64) DEFAULT NULL,
    karma_points INT NOT NULL DEFAULT 0,
    daily_streak INT NOT NULL DEFAULT 0,
    last_daily_at BIGINT NOT NULL DEFAULT 0,
    last_fishing_loc VARCHAR(32) NOT NULL DEFAULT 'sungai',
    last_fishing_bait VARCHAR(32) NOT NULL DEFAULT 'umpan_cacing',
    last_mining_loc VARCHAR(32) NOT NULL DEFAULT 'tambang_batu',
    last_farm_crop VARCHAR(64) DEFAULT 'bayam',
    last_gather_loc VARCHAR(32) NOT NULL DEFAULT 'hutan_pinus',
    is_banned TINYINT(1) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_inventory (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    land_id BIGINT DEFAULT NULL,
    item_id VARCHAR(64) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    durability INT DEFAULT NULL,
    storage_location VARCHAR(16) NOT NULL DEFAULT 'bag',
    emergency_locked TINYINT(1) NOT NULL DEFAULT 0,
    freshness_remaining_ms BIGINT DEFAULT NULL,
    freshness_updated_at BIGINT DEFAULT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_inv_user_item (discord_id, item_id),
    INDEX idx_inv_user_loc_item (discord_id, storage_location, item_id),
    INDEX idx_inv_user_land_loc_item (discord_id, land_id, storage_location, item_id),
    CONSTRAINT fk_inv_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_properties (
    discord_id VARCHAR(32) NOT NULL PRIMARY KEY,
    property_tier VARCHAR(32) NOT NULL,
    city_id VARCHAR(32) NOT NULL DEFAULT 'kota_sentral',
    ownership_type ENUM('rent', 'owned') NOT NULL,
    acquired_at BIGINT NOT NULL,
    next_billing_at BIGINT NOT NULL DEFAULT 0,
    grace_until BIGINT NOT NULL DEFAULT 0,
    is_evicted TINYINT(1) NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    CONSTRAINT fk_prop_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_farm_plots (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    plot_number INT NOT NULL,
    ownership_type ENUM('rent', 'owned') NOT NULL,
    crop_id VARCHAR(64) DEFAULT NULL,
    phase TINYINT NOT NULL DEFAULT 0,
    watered TINYINT(1) NOT NULL DEFAULT 0,
    fertilizer_type VARCHAR(32) DEFAULT NULL,
    phase_started_at BIGINT NOT NULL DEFAULT 0,
    mature_at BIGINT NOT NULL DEFAULT 0,
    next_billing_at BIGINT NOT NULL DEFAULT 0,
    is_locked TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_user_plot (discord_id, plot_number),
    INDEX idx_farm_billing (ownership_type, next_billing_at),
    CONSTRAINT fk_farm_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_cooking_queues (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    slot_number INT NOT NULL,
    recipe_id VARCHAR(64) NOT NULL,
    portions INT NOT NULL DEFAULT 1,
    started_at BIGINT NOT NULL,
    finishes_at BIGINT NOT NULL,
    INDEX idx_cook_user (discord_id),
    CONSTRAINT fk_cook_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_vehicles (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    vehicle_id VARCHAR(32) NOT NULL,
    fuel_liters DOUBLE NOT NULL DEFAULT 0,
    odometer_km DOUBLE NOT NULL DEFAULT 0,
    last_service_km DOUBLE NOT NULL DEFAULT 0,
    driver_hired_until BIGINT NOT NULL DEFAULT 0,
    is_equipped TINYINT(1) NOT NULL DEFAULT 0,
    acquired_at BIGINT NOT NULL,
    UNIQUE KEY uq_user_vehicle (discord_id, vehicle_id),
    INDEX idx_veh_user_equipped (discord_id, is_equipped),
    CONSTRAINT fk_veh_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_credits (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    asset_category ENUM('vehicle', 'property', 'land') NOT NULL,
    asset_id VARCHAR(64) NOT NULL,
    land_id BIGINT DEFAULT NULL,
    total_price BIGINT NOT NULL,
    down_payment BIGINT NOT NULL,
    principal_amount BIGINT NOT NULL,
    interest_amount BIGINT NOT NULL,
    tenor_weeks INT NOT NULL,
    weeks_paid INT NOT NULL DEFAULT 0,
    weekly_installment BIGINT NOT NULL,
    principal_paid BIGINT NOT NULL DEFAULT 0,
    interest_paid BIGINT NOT NULL DEFAULT 0,
    next_due_at BIGINT NOT NULL,
    missed_weeks INT NOT NULL DEFAULT 0,
    status ENUM('active', 'paid_off', 'repossessed') NOT NULL DEFAULT 'active',
    created_at BIGINT NOT NULL,
    INDEX idx_cred_user_status (discord_id, status),
    INDEX idx_cred_due (status, next_due_at),
    CONSTRAINT fk_cred_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_achievements (
    discord_id VARCHAR(32) NOT NULL,
    achievement_id VARCHAR(64) NOT NULL,
    claimed TINYINT(1) NOT NULL DEFAULT 0,
    unlocked_at BIGINT NOT NULL,
    PRIMARY KEY (discord_id, achievement_id),
    CONSTRAINT fk_ach_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_event_progress (
    discord_id VARCHAR(32) NOT NULL,
    event_key VARCHAR(64) NOT NULL,
    token_balance INT NOT NULL DEFAULT 0,
    community_contribution INT NOT NULL DEFAULT 0,
    goal_claimed TINYINT(1) NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (discord_id, event_key),
    INDEX idx_evprog_event (event_key),
    CONSTRAINT fk_evprog_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS seasonal_events_state (
    event_key VARCHAR(64) NOT NULL PRIMARY KEY,
    event_id VARCHAR(32) NOT NULL,
    starts_at BIGINT NOT NULL,
    ends_at BIGINT NOT NULL,
    community_progress BIGINT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    updated_at BIGINT NOT NULL,
    INDEX idx_ses_active_dates (is_active, starts_at, ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_job_history (
    discord_id VARCHAR(32) NOT NULL,
    job_id VARCHAR(32) NOT NULL,
    shifts_completed INT NOT NULL DEFAULT 0,
    PRIMARY KEY (discord_id, job_id),
    CONSTRAINT fk_job_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_collections (
    discord_id VARCHAR(32) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    total_caught INT NOT NULL DEFAULT 1,
    first_caught_at BIGINT NOT NULL,
    PRIMARY KEY (discord_id, item_id),
    CONSTRAINT fk_col_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_buffs (
    discord_id VARCHAR(32) NOT NULL,
    buff_type VARCHAR(32) NOT NULL,
    multiplier DOUBLE NOT NULL DEFAULT 1.0,
    expires_at BIGINT NOT NULL,
    PRIMARY KEY (discord_id, buff_type),
    CONSTRAINT fk_buff_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_cooldowns (
    discord_id VARCHAR(32) NOT NULL,
    action_key VARCHAR(32) NOT NULL,
    expires_at BIGINT NOT NULL,
    PRIMARY KEY (discord_id, action_key),
    CONSTRAINT fk_cd_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS economy_ledger (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    type ENUM('faucet', 'sink', 'transfer') NOT NULL,
    source VARCHAR(64) NOT NULL,
    amount BIGINT NOT NULL,
    balance_after BIGINT NOT NULL,
    meta TEXT DEFAULT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_ledger_created (created_at),
    INDEX idx_ledger_user (discord_id),
    INDEX idx_ledger_type_created (type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS economy_config (
    cfg_key VARCHAR(64) NOT NULL PRIMARY KEY,
    cfg_value TEXT NOT NULL,
    updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_warnings (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    admin_id VARCHAR(32) NOT NULL,
    reason TEXT NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_acknowledged TINYINT(1) NOT NULL DEFAULT 0,
    dm_sent TINYINT(1) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    INDEX idx_warn_user_active (discord_id, is_active),
    INDEX idx_warn_user_ack (discord_id, is_active, is_acknowledged),
    INDEX idx_warn_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_activity_logs (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    category VARCHAR(32) NOT NULL,
    action VARCHAR(64) NOT NULL,
    details TEXT DEFAULT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_actlog_user_created (discord_id, created_at),
    INDEX idx_actlog_cat_created (category, created_at),
    INDEX idx_actlog_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_gacha_stats (
    discord_id VARCHAR(32) NOT NULL PRIMARY KEY,
    warung_pulls INT NOT NULL DEFAULT 0,
    mall_pulls INT NOT NULL DEFAULT 0,
    sultan_pulls INT NOT NULL DEFAULT 0,
    total_pulls INT NOT NULL DEFAULT 0,
    jackpot_count INT NOT NULL DEFAULT 0,
    duplicate_tickets_earned INT NOT NULL DEFAULT 0,
    last_pull_at BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_gacha_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_clothes (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    clothing_id VARCHAR(64) NOT NULL,
    acquired_at BIGINT NOT NULL,
    UNIQUE KEY uq_player_clothing (discord_id, clothing_id),
    INDEX idx_pclothes_user (discord_id),
    CONSTRAINT fk_pclothes_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_equipped_clothes (
    discord_id VARCHAR(32) NOT NULL PRIMARY KEY,
    equipped_body VARCHAR(64) NOT NULL DEFAULT 'chibi_body_light',
    equipped_hair VARCHAR(64) DEFAULT 'hair_short_black',
    equipped_hat VARCHAR(64) DEFAULT NULL,
    equipped_top VARCHAR(64) DEFAULT NULL,
    equipped_bottom VARCHAR(64) DEFAULT NULL,
    equipped_shoes VARCHAR(64) DEFAULT NULL,
    equipped_accessory VARCHAR(64) DEFAULT NULL,
    updated_at BIGINT NOT NULL,
    CONSTRAINT fk_peqclothes_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_lands (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    parcel_code VARCHAR(24) DEFAULT NULL,
    discord_id VARCHAR(32) NOT NULL,
    city_id VARCHAR(32) NOT NULL DEFAULT 'kota_sentral',
    district_no INT NOT NULL DEFAULT 1,
    custom_name VARCHAR(64) NOT NULL DEFAULT 'Kavling Pribadi',
    description TEXT,
    width TINYINT NOT NULL DEFAULT 3,
    height TINYINT NOT NULL DEFAULT 3,
    land_tier VARCHAR(24) NOT NULL DEFAULT 'mini_3x3',
    theme_id VARCHAR(32) NOT NULL DEFAULT 'minimalis',
    is_primary TINYINT(1) NOT NULL DEFAULT 0,
    purchase_price BIGINT NOT NULL DEFAULT 0,
    condition_pct DOUBLE NOT NULL DEFAULT 100,
    building_state ENUM('empty', 'active', 'abandoned', 'collapsed') NOT NULL DEFAULT 'active',
    last_condition_tick_at BIGINT NOT NULL DEFAULT 0,
    abandoned_since BIGINT NOT NULL DEFAULT 0,
    abandoned_notified TINYINT(1) NOT NULL DEFAULT 0,
    collapsed_at BIGINT NOT NULL DEFAULT 0,
    next_pbb_at BIGINT NOT NULL DEFAULT 0,
    grace_until BIGINT NOT NULL DEFAULT 0,
    like_count INT NOT NULL DEFAULT 0,
    acquired_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    INDEX idx_lands_user_city (discord_id, city_id),
    INDEX idx_lands_pbb (next_pbb_at),
    INDEX idx_lands_parcel (parcel_code),
    INDEX idx_lands_state (building_state, next_pbb_at),
    CONSTRAINT fk_lands_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS land_grid_cells (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT NOT NULL,
    layout_state ENUM('active', 'draft') NOT NULL DEFAULT 'draft',
    floor_level SMALLINT NOT NULL DEFAULT 1,
    x TINYINT NOT NULL,
    y TINYINT NOT NULL,
    zone_group_id VARCHAR(36) NOT NULL,
    zone_name VARCHAR(64) NOT NULL,
    block_kind ENUM('module', 'shape', 'roof') NOT NULL DEFAULT 'module',
    module_id VARCHAR(48) NOT NULL,
    material_id VARCHAR(32) NOT NULL DEFAULT 'kayu',
    shape_variant VARCHAR(32) DEFAULT NULL,
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

CREATE TABLE IF NOT EXISTS land_floor_cells (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT NOT NULL,
    layout_state ENUM('active', 'draft') NOT NULL DEFAULT 'draft',
    floor_level SMALLINT NOT NULL DEFAULT 1,
    x TINYINT NOT NULL,
    y TINYINT NOT NULL,
    floor_material_id VARCHAR(32) NOT NULL DEFAULT 'kayu',
    roof_variant VARCHAR(32) DEFAULT NULL,
    color_hex VARCHAR(16) DEFAULT NULL,
    is_pillar TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_land_floor_cell (land_id, layout_state, floor_level, x, y),
    INDEX idx_floor_land_state (land_id, layout_state, floor_level),
    CONSTRAINT fk_floor_cell_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS land_wall_edges (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT NOT NULL,
    layout_state ENUM('active', 'draft') NOT NULL DEFAULT 'draft',
    floor_level SMALLINT NOT NULL DEFAULT 1,
    orientation ENUM('H', 'V') NOT NULL,
    gx TINYINT NOT NULL,
    gy TINYINT NOT NULL,
    edge_type ENUM('wall', 'door', 'window', 'glass_wall', 'arch', 'fence') NOT NULL DEFAULT 'wall',
    material_id VARCHAR(32) NOT NULL DEFAULT 'bata',
    color_hex VARCHAR(16) DEFAULT NULL,
    UNIQUE KEY uq_wall_edge (land_id, layout_state, floor_level, orientation, gx, gy),
    INDEX idx_wall_land_state (land_id, layout_state, floor_level),
    CONSTRAINT fk_wall_edge_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS land_rooms (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT NOT NULL,
    floor_level SMALLINT NOT NULL DEFAULT 1,
    room_key VARCHAR(64) NOT NULL,
    custom_name VARCHAR(64) NOT NULL DEFAULT 'Ruangan',
    room_cells_json LONGTEXT NOT NULL,
    is_enclosed TINYINT(1) NOT NULL DEFAULT 1,
    has_roof TINYINT(1) NOT NULL DEFAULT 1,
    comfort_score INT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_land_room (land_id, floor_level, room_key),
    CONSTRAINT fk_room_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS land_furniture_items (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT NOT NULL,
    floor_level SMALLINT NOT NULL DEFAULT 1,
    item_id VARCHAR(64) NOT NULL,
    anchor_x TINYINT NOT NULL,
    anchor_y TINYINT NOT NULL,
    width_cells TINYINT NOT NULL DEFAULT 1,
    height_cells TINYINT NOT NULL DEFAULT 1,
    rotation ENUM('N', 'E', 'S', 'W') NOT NULL DEFAULT 'S',
    condition_pct DECIMAL(5,2) NOT NULL DEFAULT 100.00,
    is_locked_rubble TINYINT(1) NOT NULL DEFAULT 0,
    placed_at BIGINT NOT NULL DEFAULT 0,
    INDEX idx_furn_land_floor (land_id, floor_level),
    CONSTRAINT fk_furn_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_livestock_pens (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    pen_number INT NOT NULL,
    ownership_type VARCHAR(16) NOT NULL DEFAULT 'rented',
    species_id VARCHAR(64) NULL,
    phase TINYINT NOT NULL DEFAULT 0,
    fed TINYINT(1) NOT NULL DEFAULT 0,
    cleaned TINYINT(1) NOT NULL DEFAULT 1,
    cycles_left INT NOT NULL DEFAULT 0,
    phase_started_at BIGINT NULL,
    mature_at BIGINT NULL,
    next_billing_at BIGINT NULL,
    is_locked TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_player_pen (discord_id, pen_number),
    INDEX idx_pen_billing (ownership_type, next_billing_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_traktir_drops (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    creator_id VARCHAR(32) NOT NULL,
    channel_id VARCHAR(32) NULL,
    item_id VARCHAR(64) NOT NULL,
    total_portions INT NOT NULL,
    remaining_portions INT NOT NULL,
    karma_per_claim INT NOT NULL DEFAULT 2,
    note VARCHAR(140) NULL,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_traktir_creator (creator_id, created_at),
    INDEX idx_traktir_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS social_traktir_claims (
    drop_id BIGINT NOT NULL,
    claimer_id VARCHAR(32) NOT NULL,
    claimed_at BIGINT NOT NULL,
    PRIMARY KEY (drop_id, claimer_id),
    INDEX idx_traktir_claim_user (claimer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. Papan Order Jasa Antar-Warga & Kotak Pengambilan
CREATE TABLE IF NOT EXISTS jasa_contracts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    requester_id VARCHAR(32) NOT NULL,
    worker_id VARCHAR(32) NULL,
    target_city_id VARCHAR(32) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    quantity INT NOT NULL,
    reward_lp BIGINT NOT NULL,
    note VARCHAR(120) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'open',
    expires_at BIGINT NOT NULL,
    completed_at BIGINT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_jasa_status_expires (status, expires_at),
    INDEX idx_jasa_requester (requester_id, status),
    INDEX idx_jasa_city (target_city_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_jasa_claim_box (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    contract_id BIGINT NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    quantity INT NOT NULL,
    delivery_city_id VARCHAR(32) NOT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_jasa_box_user (discord_id, delivery_city_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. Balai Lelang Warga & Kotak Klaim Lelang
CREATE TABLE IF NOT EXISTS market_auctions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    seller_id VARCHAR(32) NOT NULL,
    item_kind VARCHAR(16) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    durability INT NULL,
    freshness_remaining_ms BIGINT NULL,
    start_price BIGINT NOT NULL,
    reserve_price BIGINT NOT NULL DEFAULT 0,
    current_bid BIGINT NOT NULL DEFAULT 0,
    highest_bidder_id VARCHAR(32) NULL,
    bid_count INT NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    ends_at BIGINT NOT NULL,
    settled_at BIGINT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_auction_status_ends (status, ends_at),
    INDEX idx_auction_seller (seller_id, status),
    INDEX idx_auction_bidder (highest_bidder_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS market_auction_claims (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    auction_id BIGINT NOT NULL,
    item_kind VARCHAR(16) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    durability INT NULL,
    freshness_remaining_ms BIGINT NULL,
    claim_reason VARCHAR(24) NOT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_auction_claim_user (discord_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
