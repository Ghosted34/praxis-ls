-- ============================================================================
-- TENANT DB — 10773 The tenant signature policy (funnel level 2) and its
-- defaults.
--
-- The eligibility funnel has four levels (guide §3.4):
--
--   1. DOC-TYPE CEILING   in code (document_vault.types.js) — not tenant-editable
--   2. TENANT MENU        THIS FILE — settings section `signature_policy`
--   3. SENDER, AT DISPATCH two booleans on the request (PR-3)
--   4. SIGNER CHOICE      the cards on the signing page (PR-3)
--
-- Seeded conservatively: STAMP and DRAWN on for every signable doc type;
-- CERTIFIED and PRINT_SIGN OFF until their PRs ship and their feature flags are
-- enabled. A tenant that turns on a card whose PR has not landed would produce
-- a signing page with a dead option, which is worse than not offering it.
--
-- Idempotent: ON CONFLICT DO NOTHING, so a tenant that has already tuned its
-- policy keeps its choices when this file re-runs.
-- ============================================================================

INSERT INTO setting (section, key, value)
SELECT 'signature_policy', d.doc_type,
       jsonb_build_object('allowed', jsonb_build_array('STAMP','DRAWN'), 'default', 'STAMP')
  FROM (VALUES
    ('FINAL_INVOICE'), ('PROFORMA_ADVANCE'), ('QUOTATION'), ('PROPOSAL'),
    ('PURCHASE_ORDER'), ('DELIVERY_NOTE'), ('TRANSIT_ORDER'), ('EMPLOYMENT_CONTRACT')
  ) AS d(doc_type)
ON CONFLICT (section, key) DO NOTHING;

-- Behavioural defaults. Each is read through shared/config/settings.js at
-- runtime, so none of these is hardcoded anywhere in the services.
INSERT INTO setting (section, key, value) VALUES
  -- Q9: internal signers use their session. Above this XAF threshold they also
  -- clear an emailed code. OFF by default — a dispatcher signing forty delivery
  -- notes a day would do forty OTP round-trips, and a control that painful gets
  -- switched off, which is exactly how the predecessor system lost its OTP.
  ('signature_policy', 'stepup_enabled',        'false'::jsonb),
  ('signature_policy', 'stepup_threshold_xaf',  'null'::jsonb),

  -- Q13: verification-scan telemetry. Notification off by default because a
  -- tenant issuing hundreds of delivery notes would drown in it.
  ('signature_policy', 'notify_on_scan',        'false'::jsonb),
  ('signature_policy', 'scan_anomaly_threshold','25'::jsonb),
  ('signature_policy', 'scan_retention_days',   '400'::jsonb),

  -- §3.13: the Certificate of Completion masks the signer IP unless a
  -- jurisdiction or a specific dispute requires otherwise.
  ('signature_policy', 'certificate_full_ip',   'false'::jsonb),

  -- PR-3 reminders; PR-5 unreconciled-paperwork flag. Seeded now so the whole
  -- policy shape is visible in one place from the first migration.
  ('signature_policy', 'reminder_days',         '[2, 5]'::jsonb),
  ('signature_policy', 'unreconciled_days',     '7'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- ============================================================================
-- VERIFY
--   SELECT key, value FROM setting WHERE section = 'signature_policy' ORDER BY key;
--     -- expect 8 doc-type rows + 8 behavioural rows
--   SELECT value->>'default' FROM setting
--    WHERE section = 'signature_policy' AND key = 'FINAL_INVOICE';   -- 'STAMP'
--
-- DOWN
--   -- DESTRUCTIVE: a tenant that has TUNED its policy since this ran loses those
--   -- choices, because the rows are indistinguishable from the seeded ones.
--   -- Removing them makes every signable doc type fall through to an empty menu,
--   -- so signing stops with EMPTY_SIGNATURE_MENU until the section is re-seeded.
--   -- DELETE FROM setting WHERE section = 'signature_policy';
-- ============================================================================
