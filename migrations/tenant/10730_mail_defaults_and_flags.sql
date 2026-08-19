-- ============================================================================
-- TENANT DB — 10730 Mail defaults and the mail.* feature flags.
--
-- ── THE DEFAULTS ────────────────────────────────────────────────────────────
--
-- One `mail` settings section holds every tenant-wide mailbox default, so a
-- limit has one home instead of being scattered across columns that each need
-- their own migration to change. Per-connection columns (10728) override these;
-- NULL there means inherit from here.
--
-- The throttle defaults are deliberately conservative. Shared cPanel hosting
-- commonly caps a domain at 200/hour, and the cost of being wrong in the safe
-- direction is a message arriving twenty minutes late, while the cost of being
-- wrong the other way is the mailbox suspended. An administrator who knows
-- their host's real ceiling raises it in one screen.
--
-- ── THE FLAGS ───────────────────────────────────────────────────────────────
--
-- Every new surface in the Smart Mail programme sits behind a `mail.*` key, all
-- seeded OFF. Off is the honest default for a tenant that has not been told
-- anything is coming, and it is what lets the first tenant pilot each piece
-- without every other tenant seeing half-built screens.
--
-- `mail.provider.oauth` is off for a different reason and should stay off: the
-- Microsoft and Google adapters are built, tested and working, but this
-- programme is deliberately doing one provider — IMAP/SMTP — properly first.
-- The flag hides the connect buttons; the adapters keep running in CI so they
-- do not rot while they wait.
--
-- Enabling these for the pilot tenant is a Platform Console action, not a
-- migration: the console owns projection into feature_state, and a migration
-- that hard-codes one tenant's slug would be wrong on every other database it
-- runs against. See doc/SMART_MAIL_ENGINEERING_GUIDE.md §4 rollout.
-- ============================================================================

INSERT INTO setting (section, key, value) VALUES
  ('mail', 'limits', '{
     "send_limit_hourly": 150,
     "send_limit_daily": 1000,
     "sync_depth_days": 90,
     "attachment_max_bytes": 26214400,
     "folder_sync_limit": 25
   }'::jsonb),
  ('mail', 'policy', '{
     "personal_mailbox_per_user": 1,
     "shared_default_visibility": "TEAM",
     "personal_default_visibility": "PRIVATE",
     "archive_on_offboard": true,
     "record_sender_header": true
   }'::jsonb),
  ('mail', 'origin', '{
     "stamp_outbound": true,
     "header_prefix": "X-Praxis"
   }'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- Feature flags. `source = 'default'` marks these as seeded rather than
-- projected from a plan, so the console can tell the difference between "this
-- tenant''s plan says off" and "nobody has decided yet".
INSERT INTO feature_state (feature_key, state, source) VALUES
  ('mail.core',           'off', 'default'),
  ('mail.composer',       'off', 'default'),
  ('mail.shared_inbox',   'off', 'default'),
  ('mail.provider.oauth', 'off', 'default'),
  ('mail.signatures',     'off', 'default'),
  ('mail.deliverability', 'off', 'default'),
  ('mail.binding',        'off', 'default'),
  ('mail.notes',          'off', 'default'),
  ('mail.doc_intake',     'off', 'default'),
  ('mail.ai',             'off', 'default'),
  ('mail.followup',       'off', 'default'),
  ('mail.secure_links',   'off', 'default'),
  ('mail.archive',        'off', 'default'),
  ('mail.antispoof',      'off', 'default')
ON CONFLICT (feature_key) DO NOTHING;

-- DOWN
--   DELETE FROM feature_state WHERE feature_key IN (
--     'mail.core','mail.composer','mail.shared_inbox','mail.provider.oauth',
--     'mail.signatures','mail.deliverability','mail.binding','mail.notes',
--     'mail.doc_intake','mail.ai','mail.followup','mail.secure_links',
--     'mail.archive','mail.antispoof');
--   -- DESTRUCTIVE: removes tenant-edited mailbox defaults along with the seeded
--   -- ones — the rows are edited in place, so an administrator''s raised send
--   -- limit is deleted with them.
--   DELETE FROM setting WHERE section = 'mail' AND key IN ('limits','policy','origin');
