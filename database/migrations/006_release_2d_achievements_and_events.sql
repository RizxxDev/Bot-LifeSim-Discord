-- Migrasi 006: Rilis 2D (Achievement, Title, & Framework Event Musiman)

ALTER TABLE players
    ADD COLUMN IF NOT EXISTS cooked_dishes_eaten INT NOT NULL DEFAULT 0 AFTER cooking_xp;

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
