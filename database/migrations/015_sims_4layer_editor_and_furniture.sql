-- ============================================================================
-- Migration 015: 4-Layer The Sims Architecture Editor, Rooms & Furniture Items
-- ============================================================================

CREATE TABLE IF NOT EXISTS land_floor_cells (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT NOT NULL,
    layout_state ENUM('active', 'draft') NOT NULL DEFAULT 'draft',
    floor_level SMALLINT NOT NULL DEFAULT 1,
    x TINYINT NOT NULL,
    y TINYINT NOT NULL,
    floor_material_id VARCHAR(32) NOT NULL DEFAULT 'kayu',
    roof_variant VARCHAR(32) DEFAULT NULL,
    color_hex VARCHAR(16) DEFAULT NULL,
    is_pillar TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_land_floor_cell (land_id, layout_state, floor_level, x, y),
    INDEX idx_floor_land_state (land_id, layout_state, floor_level),
    CONSTRAINT fk_floor_cell_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS land_wall_edges (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT NOT NULL,
    layout_state ENUM('active', 'draft') NOT NULL DEFAULT 'draft',
    floor_level SMALLINT NOT NULL DEFAULT 1,
    orientation ENUM('H', 'V') NOT NULL,
    gx TINYINT NOT NULL,
    gy TINYINT NOT NULL,
    edge_type ENUM('wall', 'door', 'window', 'glass_wall', 'arch', 'fence') NOT NULL DEFAULT 'wall',
    material_id VARCHAR(32) NOT NULL DEFAULT 'bata',
    color_hex VARCHAR(16) DEFAULT NULL,
    UNIQUE KEY uq_wall_edge (land_id, layout_state, floor_level, orientation, gx, gy),
    INDEX idx_wall_land_state (land_id, layout_state, floor_level),
    CONSTRAINT fk_wall_edge_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS land_rooms (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT NOT NULL,
    floor_level SMALLINT NOT NULL DEFAULT 1,
    room_key VARCHAR(64) NOT NULL,
    custom_name VARCHAR(64) NOT NULL DEFAULT 'Ruangan',
    room_cells_json LONGTEXT NOT NULL,
    is_enclosed TINYINT(1) NOT NULL DEFAULT 1,
    has_roof TINYINT(1) NOT NULL DEFAULT 1,
    comfort_score INT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_land_room (land_id, floor_level, room_key),
    CONSTRAINT fk_room_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS land_furniture_items (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    land_id BIGINT NOT NULL,
    floor_level SMALLINT NOT NULL DEFAULT 1,
    item_id VARCHAR(64) NOT NULL,
    anchor_x TINYINT NOT NULL,
    anchor_y TINYINT NOT NULL,
    width_cells TINYINT NOT NULL DEFAULT 1,
    height_cells TINYINT NOT NULL DEFAULT 1,
    rotation ENUM('N', 'E', 'S', 'W') NOT NULL DEFAULT 'S',
    condition_pct DECIMAL(5,2) NOT NULL DEFAULT 100.00,
    is_locked_rubble TINYINT(1) NOT NULL DEFAULT 0,
    placed_at BIGINT NOT NULL DEFAULT 0,
    INDEX idx_furn_land_floor (land_id, floor_level),
    CONSTRAINT fk_furn_land FOREIGN KEY (land_id) REFERENCES player_lands(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill aman data land_grid_cells lama ke layer lantai 4-layer bila ada
INSERT IGNORE INTO land_floor_cells (
    land_id, layout_state, floor_level, x, y, floor_material_id, roof_variant, color_hex, is_pillar
)
SELECT
    land_id,
    layout_state,
    floor_level,
    x,
    y,
    COALESCE(material_id, 'kayu'),
    CASE
        WHEN block_kind = 'roof' THEN COALESCE(shape_variant, 'gable')
        ELSE NULL
    END,
    color_hex,
    CASE
        WHEN block_kind = 'shape' AND shape_variant = 'pillar' THEN 1
        ELSE 0
    END
FROM land_grid_cells;
