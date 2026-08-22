-- ============================================================================
-- TENANT DB — 10792 Enable PRINT_SIGN in the tenant signature menu.
--
-- doc/SIGNATURE_ENGINEERING_GUIDE.md §8.9 item 5.
--
-- 10773 seeded every signable doc type with STAMP/DRAWN only, using
-- ON CONFLICT DO NOTHING so tenant edits survive replays. Now PR-5 has shipped,
-- append PRINT_SIGN for the doc types whose product ceiling allows paper. This
-- is an UPDATE, not a replacement: tenants keep their chosen default and any
-- extra cards they have already enabled.
--
-- Idempotent. Re-runnable.
-- ============================================================================

WITH wet_doc_type(doc_type) AS (
  VALUES
    ('FINAL_INVOICE'),
    ('PROFORMA_ADVANCE'),
    ('QUOTATION'),
    ('PROPOSAL'),
    ('PURCHASE_ORDER'),
    ('DELIVERY_NOTE'),
    ('TRANSIT_ORDER')
), current_policy AS (
  SELECT s.section, s.key, s.value
    FROM setting s
    JOIN wet_doc_type d ON d.doc_type = s.key
   WHERE s.section = 'signature_policy'
), patched AS (
  SELECT section, key,
         CASE
           WHEN COALESCE(value->'allowed', '[]'::jsonb) ? 'PRINT_SIGN' THEN value
           ELSE jsonb_set(
             value,
             '{allowed}',
             COALESCE(value->'allowed', '[]'::jsonb) || '"PRINT_SIGN"'::jsonb,
             true
           )
         END AS value
    FROM current_policy
)
UPDATE setting s
   SET value = p.value,
       version = s.version + CASE WHEN s.value IS DISTINCT FROM p.value THEN 1 ELSE 0 END,
       updated_at = CASE WHEN s.value IS DISTINCT FROM p.value THEN now() ELSE s.updated_at END
  FROM patched p
 WHERE s.section = p.section
   AND s.key = p.key
   AND s.value IS DISTINCT FROM p.value;

-- ============================================================================
-- VERIFY
--   SELECT key, value->'allowed' FROM setting
--    WHERE section = 'signature_policy' AND key IN ('DELIVERY_NOTE','EMPLOYMENT_CONTRACT')
--    ORDER BY key;
--     -- DELIVERY_NOTE includes PRINT_SIGN, EMPLOYMENT_CONTRACT does not.
--
-- DOWN
--   -- DELETE PRINT_SIGN from the seeded wet-capable doc types only.
--   -- UPDATE setting SET value = jsonb_set(value, '{allowed}', (value->'allowed') - 'PRINT_SIGN')
--   --  WHERE section = 'signature_policy'
--   --    AND key IN ('FINAL_INVOICE','PROFORMA_ADVANCE','QUOTATION','PROPOSAL',
--   --                'PURCHASE_ORDER','DELIVERY_NOTE','TRANSIT_ORDER');
-- ============================================================================
