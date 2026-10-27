-- Migration 003: Release 2A - Property, Spoilage & Storage
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

ALTER TABLE player_inventory
    ADD COLUMN IF NOT EXISTS storage_location VARCHAR(16) NOT NULL DEFAULT 'bag',
    ADD COLUMN IF NOT EXISTS freshness_remaining_ms BIGINT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS freshness_updated_at BIGINT DEFAULT NULL,
    ADD INDEX IF NOT EXISTS idx_inv_user_loc_item (discord_id, storage_location, item_id);

UPDATE player_inventory
SET freshness_remaining_ms = 259200000,
    freshness_updated_at = UNIX_TIMESTAMP() * 1000
WHERE item_id LIKE 'ikan_%'
  AND freshness_remaining_ms IS NULL;
