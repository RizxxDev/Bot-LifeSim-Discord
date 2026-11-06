-- Migrasi 009: Sistem Gacha Mesin Kapsul & Mystery Box 3-Tier

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
