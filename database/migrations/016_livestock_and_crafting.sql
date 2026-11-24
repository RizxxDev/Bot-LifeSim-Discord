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
