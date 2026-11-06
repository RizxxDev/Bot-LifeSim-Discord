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
    cooked_dishes_eaten INT NOT NULL DEFAULT 0,
    lpg_charges INT NOT NULL DEFAULT 0,
    backpack_tier INT NOT NULL DEFAULT 0,
    max_slots INT NOT NULL DEFAULT 20,
    equipped_title VARCHAR(64) DEFAULT NULL,
    daily_streak INT NOT NULL DEFAULT 0,
    last_daily_at BIGINT NOT NULL DEFAULT 0,
    last_fishing_loc VARCHAR(32) NOT NULL DEFAULT 'sungai',
    last_fishing_bait VARCHAR(32) NOT NULL DEFAULT 'umpan_cacing',
    last_mining_loc VARCHAR(32) NOT NULL DEFAULT 'tambang_batu',
    last_farm_crop VARCHAR(64) DEFAULT 'bayam',
    is_banned TINYINT(1) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_inventory (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    durability INT DEFAULT NULL,
    storage_location VARCHAR(16) NOT NULL DEFAULT 'bag',
    freshness_remaining_ms BIGINT DEFAULT NULL,
    freshness_updated_at BIGINT DEFAULT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_inv_user_item (discord_id, item_id),
    INDEX idx_inv_user_loc_item (discord_id, storage_location, item_id),
    CONSTRAINT fk_inv_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_properties (
    discord_id VARCHAR(32) NOT NULL PRIMARY KEY,
    property_tier VARCHAR(32) NOT NULL,
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
    is_equipped TINYINT(1) NOT NULL DEFAULT 0,
    acquired_at BIGINT NOT NULL,
    UNIQUE KEY uq_user_vehicle (discord_id, vehicle_id),
    INDEX idx_veh_user_equipped (discord_id, is_equipped),
    CONSTRAINT fk_veh_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_credits (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    asset_category ENUM('vehicle', 'property') NOT NULL,
    asset_id VARCHAR(32) NOT NULL,
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
