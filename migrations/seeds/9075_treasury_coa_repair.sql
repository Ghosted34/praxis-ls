-- Fix Treasury category parents to be non-postable in seed data.
-- Runs after 9000, 9001, and 9070 so all parents exist before update.
-- Audit item #30: 571, 581, 5381, 5382, 5711 must be non-postable so
-- child leaves can be allocated under them safely.

UPDATE chart_of_accounts
   SET is_postable = false
 WHERE code IN ('571', '581', '5381', '5382', '5711');

-- DOWN
-- UPDATE chart_of_accounts SET is_postable = true WHERE code IN ('571', '581', '5381', '5382', '5711');
