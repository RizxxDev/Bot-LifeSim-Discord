-- Migrasi 008: Sistem Moderasi Admin, Warning Player, & Audit Activity Logs

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
