-- Migration: 002_standardize_table_names.sql
-- Description: Rename existing tables to standard prefixes if upgrading from legacy schema

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Rename tabel inventory -> user_inventory jika masih pakai nama lama
DROP PROCEDURE IF EXISTS RenameTableIfExists;
DELIMITER //
CREATE PROCEDURE RenameTableIfExists(IN oldName VARCHAR(64), IN newName VARCHAR(64))
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = DATABASE() AND table_name = oldName
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = DATABASE() AND table_name = newName
    ) THEN
        SET @sql = CONCAT('RENAME TABLE ', oldName, ' TO ', newName);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END //
DELIMITER ;

CALL RenameTableIfExists('inventory', 'user_inventory');
CALL RenameTableIfExists('user_farms', 'farm_profiles');
CALL RenameTableIfExists('user_storage', 'farm_storage');
CALL RenameTableIfExists('global_shop', 'shop_global');
CALL RenameTableIfExists('shop_production_queue', 'shop_queue');

DROP PROCEDURE IF EXISTS RenameTableIfExists;

SET FOREIGN_KEY_CHECKS = 1;
