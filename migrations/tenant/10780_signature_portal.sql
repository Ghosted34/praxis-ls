-- ============================================================================
-- TENANT DB — 10780 The verification portal's wiring: its feature switch, its
-- one piece of configuration, and its two event types.
--
-- The guide names this file `signature_portal_events`. It carries three things
-- rather than one because they are the same switch-on: a portal with events
-- nobody can reach, or a flag with no events behind it, is half a deployment —
-- and the numbering re-check (§3.9, see 10779) had already moved the file, so
-- there was no filename to preserve.
--
-- doc/SIGNATURE_ENGINEERING_GUIDE.md §5.5.
--
-- ── NAMESPACE ──────────────────────────────────────────────────────────────
-- The guide names these `signature.scanned_new_ip` and `signature.scan_anomaly`.
-- They ship as `document_signature.*` for the reason 10774 already recorded and
-- this file inherits: the mail programme owns the `signature.*` prefix for
-- EMAIL signatures (10768 — signature.template.changed, .profile.changed,
-- .cache.invalidated). Two unrelated concepts under one event prefix makes the
-- event log unreadable to whoever reads it next, and the log is the thing these
-- events exist for. The prefix is also what categories.js keys on, so a split
-- namespace would route half of one feature's events to the wrong bucket.
--
-- ── PRIORITY ───────────────────────────────────────────────────────────────
-- Neither is is_security_critical. That flag drives the Watch-the-Watcher
-- fan-out to CEO/MANAGEMENT (shared/events/emit.js) and is reserved for RBAC
-- and God Mode changes. `scan_anomaly` is emitted at HIGH priority by the
-- caller instead (§5.5 step 4), which reaches the people who own the document
-- without turning the executive alert channel into a QR feed.
--
-- NOTE: no semicolons inside the seed strings below. The idempotency checker
-- finds a statement by slicing between semicolons without tracking quotes, so a
-- ';' in a description hides the ON CONFLICT clause from it and the seed is
-- reported as non-idempotent when it is not. Same note as 10774.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The switch (§3.5).
--
-- ON by default: this chapter IS the portal, and a QR printed on paper that
-- resolves to a 403 is worse than no QR. `default_state` answers "is this
-- shippable?", not "did the customer buy it?" — plan inclusion is the
-- commercial gate (9110's own note).
--
-- The other three ship OFF because their chapters have not landed. They are
-- seeded now anyway so that presets.js's CARD_FLAG lookups have rows to read
-- and an administrator can SEE the switches that are coming, rather than PR-3
-- discovering on merge day that nothing can turn it on. Their catalogue halves
-- are in migrations/seeds/9115_seed_signature_features.sql — a tenant flag
-- with no catalogue row is a feature nobody has
-- (tests/security/feature-catalogue-coverage.test.js).
-- ---------------------------------------------------------------------------
INSERT INTO feature_state (feature_key, state, source) VALUES
  ('signatures.portal',   'on',  'default'),
  ('signatures.external', 'off', 'default'),
  ('signatures.qes',      'off', 'default'),
  ('signatures.wet',      'off', 'default')
ON CONFLICT (feature_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The one piece of portal configuration.
--
-- A tenant is reached at <slug>.<APP_BASE_DOMAIN>, and that is what the QR
-- encodes by default — derived per render from the request's own host, so
-- nothing has to be configured for the common case. This setting exists for the
-- tenant serving the portal from a domain of its own; NULL means "use the host
-- this request arrived on" (services/signatures/verify-link.js).
--
-- It is deliberately not a required value. A misconfigured one prints a wrong
-- host on paper, and paper cannot be re-issued.
-- ---------------------------------------------------------------------------
INSERT INTO setting (section, key, value) VALUES
  ('signature_policy', 'verify_base_url', 'null'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. The event types.
-- ---------------------------------------------------------------------------
INSERT INTO event_type (key, module_key, name, description) VALUES
  ('document_signature.scanned_new_ip', 'MOD-64', 'Document verified from a new address',
   'A signature was verified from a network address that had never verified it before. Off by default per tenant (signature_policy.notify_on_scan) because a tenant issuing hundreds of delivery notes would drown in it.'),
  ('document_signature.scan_anomaly',   'MOD-64', 'Unusual verification activity',
   'One signature was verified more times in a rolling hour than signature_policy.scan_anomaly_threshold allows. A document verified forty times in an hour is either under audit or being shopped around, and both are worth knowing.')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- VERIFY
--   SELECT feature_key, state FROM feature_state WHERE feature_key LIKE 'signatures%'
--    ORDER BY feature_key;        -- expect signatures(on) + the four above
--   SELECT value FROM setting
--    WHERE section = 'signature_policy' AND key = 'verify_base_url';   -- null
--   SELECT key, module_key FROM event_type
--    WHERE key IN ('document_signature.scanned_new_ip','document_signature.scan_anomaly');
--     -- expect 2 rows, both MOD-64
--
-- DOWN
--   -- DESTRUCTIVE. Removing signatures.portal takes the public portal offline
--   -- for this tenant: every QR already printed on paper starts answering 403,
--   -- and paper cannot be re-issued. event_log rows keep their key as text so
--   -- history stays readable, but any workflow bound to one of these stops
--   -- firing.
--   DELETE FROM feature_state WHERE feature_key IN
--     ('signatures.portal','signatures.external','signatures.qes','signatures.wet');
--   DELETE FROM setting WHERE section = 'signature_policy' AND key = 'verify_base_url';
--   DELETE FROM event_type WHERE key IN
--     ('document_signature.scanned_new_ip','document_signature.scan_anomaly');
-- ============================================================================
