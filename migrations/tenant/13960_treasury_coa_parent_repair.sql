-- Fix Treasury category parents to be non-postable in existing tenants.
-- Audit item #30: 571, 581, 5381, 5382, 5711 must be non-postable so
-- child leaves can be allocated under them safely.

UPDATE chart_of_accounts
   SET is_postable = false
 WHERE code IN ('571', '581', '5381', '5382', '5711');

-- DOWN
-- Restore prior postability if needed:
-- UPDATE chart_of_accounts SET is_postable = true WHERE code IN ('571', '581', '5381', '5382', '5711');
