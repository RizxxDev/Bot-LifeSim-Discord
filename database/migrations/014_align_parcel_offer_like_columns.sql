-- ============================================================================
-- Migration 014: Align city_land_parcels & land_trade_offers columns/ENUMs
-- ============================================================================

ALTER TABLE city_land_parcels
    ADD COLUMN IF NOT EXISTS lot_no INT NOT NULL DEFAULT 1 AFTER district_no,
    ADD COLUMN IF NOT EXISTS foreclosed_price BIGINT DEFAULT NULL AFTER foreclosed_at,
    MODIFY COLUMN status ENUM('available', 'owned', 'foreclosed', 'auction') NOT NULL DEFAULT 'available',
    MODIFY COLUMN updated_at BIGINT NOT NULL DEFAULT 0;

UPDATE city_land_parcels
SET lot_no = CAST(SUBSTRING_INDEX(parcel_code, '-', -1) AS UNSIGNED)
WHERE lot_no = 1 AND parcel_code LIKE '%-D%-%';

ALTER TABLE land_trade_offers
    ADD COLUMN IF NOT EXISTS offer_price BIGINT NOT NULL DEFAULT 0 AFTER city_id,
    ADD COLUMN IF NOT EXISTS expires_at BIGINT NOT NULL DEFAULT 0 AFTER status,
    MODIFY COLUMN offered_price BIGINT NOT NULL DEFAULT 0,
    MODIFY COLUMN status ENUM('pending', 'accepted', 'declined', 'cancelled', 'expired') NOT NULL DEFAULT 'pending';
