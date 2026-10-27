-- Migration 001: Initial Phase 1 Schema
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
    backpack_tier INT NOT NULL DEFAULT 0,
    max_slots INT NOT NULL DEFAULT 20,
    equipped_title VARCHAR(64) DEFAULT NULL,
    daily_streak INT NOT NULL DEFAULT 0,
    last_daily_at BIGINT NOT NULL DEFAULT 0,
    last_fishing_loc VARCHAR(32) NOT NULL DEFAULT 'sungai',
    last_fishing_bait VARCHAR(32) NOT NULL DEFAULT 'umpan_cacing',
    last_mining_loc VARCHAR(32) NOT NULL DEFAULT 'tambang_batu',
    is_banned TINYINT(1) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_inventory (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    durability INT DEFAULT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_inv_user_item (discord_id, item_id),
    CONSTRAINT fk_inv_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
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
