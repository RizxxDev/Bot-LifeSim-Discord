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
