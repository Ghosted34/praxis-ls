-- ============================================================================
-- TENANT DB — 0665 default numbering schemes for entity/client/supplier documents.
--
-- The KYC document number is a Praxis system reference, allocated at create
-- time. Keep the defaults in tenant settings so each tenant can change the
-- prefix, code, padding and reset cadence from Settings without renumbering
-- existing records.
-- ============================================================================

INSERT INTO setting (section, key, value) VALUES
  ('numbering', 'MOD-01-DOC', '{"code":"DOC","padding":5,"reset":"yearly","separator":"-"}'::jsonb),
  ('numbering', 'MOD-03-DOC', '{"prefix":"CLI","code":"DOC","padding":5,"reset":"yearly","separator":"-"}'::jsonb),
  ('numbering', 'MOD-04-DOC', '{"prefix":"SUP","code":"DOC","padding":5,"reset":"yearly","separator":"-"}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- DOWN
-- DELETE FROM setting
--  WHERE section = 'numbering'
--    AND key IN ('MOD-01-DOC', 'MOD-03-DOC', 'MOD-04-DOC');
--
-- The guarded delete only removes these defaults when a tenant rolls back
-- before customizing them. If a tenant edited either scheme, preserve that
-- business setting and remove it manually only after an explicit decision.
-- ============================================================================
