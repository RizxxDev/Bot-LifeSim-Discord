-- Migration 007: Penyelarasan Kolom Tabel Farming & Cooking (slot_number & mature_at)
ALTER TABLE player_cooking_queues
    DROP INDEX IF EXISTS uq_cook_user_stove,
    ADD COLUMN IF NOT EXISTS slot_number INT NOT NULL DEFAULT 1 AFTER discord_id,
    DROP COLUMN IF EXISTS stove_slot,
    ADD UNIQUE INDEX IF NOT EXISTS uq_cook_user_slot (discord_id, slot_number);

ALTER TABLE player_farm_plots
    ADD COLUMN IF NOT EXISTS mature_at BIGINT NOT NULL DEFAULT 0 AFTER phase_started_at,
    DROP COLUMN IF EXISTS matured_at,
    MODIFY COLUMN updated_at BIGINT NOT NULL DEFAULT 0;
