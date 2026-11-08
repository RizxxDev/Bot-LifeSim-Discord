-- Migrasi 011: Fitur Multi-Kota, Perjalanan Antar-Kota (/travel), Properti per Kota & Kontrak Supir Mobil
ALTER TABLE players
    ADD COLUMN current_city VARCHAR(32) NOT NULL DEFAULT 'kota_sentral' AFTER last_tick_at,
    ADD COLUMN traveling_until BIGINT NOT NULL DEFAULT 0 AFTER current_city,
    ADD COLUMN travel_origin VARCHAR(32) DEFAULT NULL AFTER traveling_until,
    ADD COLUMN travel_destination VARCHAR(32) DEFAULT NULL AFTER travel_origin,
    ADD COLUMN travel_has_driver TINYINT(1) NOT NULL DEFAULT 0 AFTER travel_destination;

ALTER TABLE player_properties
    ADD COLUMN city_id VARCHAR(32) NOT NULL DEFAULT 'kota_sentral' AFTER property_tier;

ALTER TABLE player_vehicles
    ADD COLUMN driver_hired_until BIGINT NOT NULL DEFAULT 0 AFTER last_service_km;
