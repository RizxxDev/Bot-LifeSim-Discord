-- Migrasi 005: Rilis 2C (Sistem Kendaraan & Pembiayaan Kredit)

CREATE TABLE IF NOT EXISTS player_vehicles (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    vehicle_id VARCHAR(32) NOT NULL,
    fuel_liters DOUBLE NOT NULL DEFAULT 0,
    odometer_km DOUBLE NOT NULL DEFAULT 0,
    last_service_km DOUBLE NOT NULL DEFAULT 0,
    is_equipped TINYINT(1) NOT NULL DEFAULT 0,
    acquired_at BIGINT NOT NULL,
    UNIQUE KEY uq_user_vehicle (discord_id, vehicle_id),
    INDEX idx_veh_user_equipped (discord_id, is_equipped),
    CONSTRAINT fk_veh_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_credits (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    asset_category ENUM('vehicle', 'property') NOT NULL,
    asset_id VARCHAR(32) NOT NULL,
    total_price BIGINT NOT NULL,
    down_payment BIGINT NOT NULL,
    principal_amount BIGINT NOT NULL,
    interest_amount BIGINT NOT NULL,
    tenor_weeks INT NOT NULL,
    weeks_paid INT NOT NULL DEFAULT 0,
    weekly_installment BIGINT NOT NULL,
    principal_paid BIGINT NOT NULL DEFAULT 0,
    interest_paid BIGINT NOT NULL DEFAULT 0,
    next_due_at BIGINT NOT NULL,
    missed_weeks INT NOT NULL DEFAULT 0,
    status ENUM('active', 'paid_off', 'repossessed') NOT NULL DEFAULT 'active',
    created_at BIGINT NOT NULL,
    INDEX idx_cred_user_status (discord_id, status),
    INDEX idx_cred_due (status, next_due_at),
    CONSTRAINT fk_cred_player FOREIGN KEY (discord_id) REFERENCES players(discord_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
