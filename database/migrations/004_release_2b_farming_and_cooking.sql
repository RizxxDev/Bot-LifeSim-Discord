-- Migration 004: Release 2B - Farming & Cooking
ALTER TABLE players
    ADD COLUMN IF NOT EXISTS farming_xp BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cooking_xp BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS lpg_charges INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_farm_crop VARCHAR(32) NOT NULL DEFAULT 'bayam';

CREATE TABLE IF NOT EXISTS player_farm_plots (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    plot_number INT NOT NULL,
    ownership_type ENUM('rent', 'owned') NOT NULL,
    next_billing_at BIGINT NOT NULL DEFAULT 0,
    is_locked TINYINT(1) NOT NULL DEFAULT 0,
    crop_id VARCHAR(32) DEFAULT NULL,
    fertilizer_type VARCHAR(16) DEFAULT NULL,
    phase TINYINT NOT NULL DEFAULT 0,
    watered TINYINT(1) NOT NULL DEFAULT 0,
    phase_started_at BIGINT NOT NULL DEFAULT 0,
    mature_at BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_farm_user_plot (discord_id, plot_number),
    CONSTRAINT fk_farm_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_cooking_queues (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    slot_number INT NOT NULL DEFAULT 1,
    recipe_id VARCHAR(32) NOT NULL,
    portions INT NOT NULL DEFAULT 1,
    started_at BIGINT NOT NULL,
    finishes_at BIGINT NOT NULL,
    UNIQUE KEY uq_cook_user_slot (discord_id, slot_number),
    CONSTRAINT fk_cook_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
