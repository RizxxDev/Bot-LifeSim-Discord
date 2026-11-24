CREATE TABLE IF NOT EXISTS jasa_contracts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    requester_id VARCHAR(32) NOT NULL,
    worker_id VARCHAR(32) NULL,
    target_city_id VARCHAR(32) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    quantity INT NOT NULL,
    reward_lp BIGINT NOT NULL,
    note VARCHAR(120) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'open',
    expires_at BIGINT NOT NULL,
    completed_at BIGINT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_jasa_status_expires (status, expires_at),
    INDEX idx_jasa_requester (requester_id, status),
    INDEX idx_jasa_city (target_city_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_jasa_claim_box (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    contract_id BIGINT NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    quantity INT NOT NULL,
    delivery_city_id VARCHAR(32) NOT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_jasa_box_user (discord_id, delivery_city_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS market_auctions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    seller_id VARCHAR(32) NOT NULL,
    item_kind VARCHAR(16) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    durability INT NULL,
    freshness_remaining_ms BIGINT NULL,
    start_price BIGINT NOT NULL,
    reserve_price BIGINT NOT NULL DEFAULT 0,
    current_bid BIGINT NOT NULL DEFAULT 0,
    highest_bidder_id VARCHAR(32) NULL,
    bid_count INT NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    ends_at BIGINT NOT NULL,
    settled_at BIGINT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_auction_status_ends (status, ends_at),
    INDEX idx_auction_seller (seller_id, status),
    INDEX idx_auction_bidder (highest_bidder_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS market_auction_claims (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    discord_id VARCHAR(32) NOT NULL,
    auction_id BIGINT NOT NULL,
    item_kind VARCHAR(16) NOT NULL,
    item_id VARCHAR(64) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    durability INT NULL,
    freshness_remaining_ms BIGINT NULL,
    claim_reason VARCHAR(24) NOT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_auction_claim_user (discord_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
