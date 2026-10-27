-- Migration 002: Migration Tracking Table & Ledger Index Hardening
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at BIGINT NOT NULL,
    execution_ms INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
