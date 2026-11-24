ALTER TABLE players
    ADD COLUMN IF NOT EXISTS karma_points INT NOT NULL DEFAULT 0;

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
