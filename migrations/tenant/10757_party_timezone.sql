ALTER TABLE client_master   ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE supplier_master ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE lead            ADD COLUMN IF NOT EXISTS timezone text;
-- DOWN
--   ALTER TABLE client_master DROP COLUMN IF EXISTS timezone;
--   ALTER TABLE supplier_master DROP COLUMN IF EXISTS timezone;
--   ALTER TABLE lead DROP COLUMN IF EXISTS timezone;
