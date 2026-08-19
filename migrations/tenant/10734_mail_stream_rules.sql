-- ============================================================================
-- TENANT DB — 10734 The split inbox: human conversations vs machine noise.
--
-- cPanel quota warnings, cron output, delivery-status reports and backup
-- notices arrive in the same inbox as a client asking where their container is.
-- The volume is not the problem; the interleaving is. This separates the two
-- streams so the primary inbox is people.
--
-- ── RULES FIRST, AI LATER, AND A HARD OVERRIDE ABOVE BOTH ───────────────────
--
-- Machine mail announces itself. `Auto-Submitted` (RFC 3834), `Precedence:
-- bulk`, `List-Unsubscribe` (RFC 2369), `X-Auto-Response-Suppress`, a
-- `multipart/report` content type, an empty `Return-Path` — between them these
-- settle the overwhelming majority for free, deterministically, with a reason a
-- person can read. AI only ever sees what the rules could not decide, which
-- keeps the cost near zero and the behaviour explainable.
--
-- Above both sits one rule that cannot be overridden: A MESSAGE FROM A PARTY WE
-- KNOW IS NEVER SYSTEM MAIL. If the sender resolves to a client, supplier,
-- employee or lead, it goes to the human stream no matter how many bulk headers
-- it carries — because plenty of legitimate business mail is sent through
-- marketing platforms that stamp them. Misfiling one client message is the
-- failure that makes people stop trusting the split, and it is worth being
-- conservative to avoid it.
--
-- ── EVERY VERDICT CARRIES ITS REASON ────────────────────────────────────────
--
-- `email_thread.stream_reason` records WHY, so "why is this in System?" is
-- answerable from the row rather than by re-deriving the classification. That is
-- also what makes a user correction meaningful: they are overriding a specific
-- rule, and the override can become a rule of its own.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_stream_rule (
  email_stream_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_kind  text NOT NULL CHECK (match_kind IN
                ('HEADER_PRESENT','HEADER_VALUE','FROM_ADDRESS','FROM_DOMAIN','SUBJECT_REGEX')),
  match_key   text,          -- header name, when the kind needs one
  match_value text NOT NULL,
  stream      text NOT NULL CHECK (stream IN ('HUMAN','SYSTEM')),
  reason      text NOT NULL,
  priority    integer NOT NULL DEFAULT 100,
  is_system   boolean NOT NULL DEFAULT false,   -- seeded: editable, not deletable
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES app_user(user_id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_email_stream_rule_active
  ON email_stream_rule (priority) WHERE is_active;

-- A rule IS its match. Without this the seed below has no conflict target, so
-- `ON CONFLICT DO NOTHING` never fires and a second run doubles every rule —
-- which is exactly what happened on the first verification pass. `match_key` is
-- NULL for address rules and NULLs are distinct in a unique constraint, hence
-- COALESCE rather than a plain UNIQUE.
--
-- De-duplicate BEFORE building it. A unique index cannot be created over rows
-- that already violate it, and any database that ran an earlier draft of this
-- file holds exactly those rows — the index creation then fails and takes the
-- whole migration with it, on a table the same file created. Keeping the oldest
-- of each match is right: it is the one any tenant edit was made against.
-- Only reachable on a database that ran an earlier draft of this file; a tenant
-- that edited a duplicate loses that edit, which is preferable to a migration
-- that cannot apply at all.
-- DESTRUCTIVE: removes duplicate rule rows, keeping the oldest of each match.
DELETE FROM email_stream_rule a
 USING email_stream_rule b
 WHERE a.match_kind = b.match_kind
   AND COALESCE(a.match_key, '') = COALESCE(b.match_key, '')
   AND a.match_value = b.match_value
   AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS ux_email_stream_rule_match
  ON email_stream_rule (match_kind, COALESCE(match_key, ''), match_value);

INSERT INTO email_stream_rule (match_kind, match_key, match_value, stream, reason, priority, is_system) VALUES
  ('HEADER_VALUE',   'auto-submitted',            '^(?!no$).+', 'SYSTEM', 'Marked Auto-Submitted by the sending system (RFC 3834).', 10, true),
  ('HEADER_VALUE',   'precedence',                '^(bulk|junk|list)$', 'SYSTEM', 'Sent with Precedence: bulk, which senders use to mark automated mail.', 20, true),
  ('HEADER_PRESENT', 'list-unsubscribe',          'true', 'SYSTEM', 'Carries a List-Unsubscribe header, so it is a mailing rather than a message.', 30, true),
  ('HEADER_PRESENT', 'x-auto-response-suppress',  'true', 'SYSTEM', 'Asks that auto-responses be suppressed, which only automated mail does.', 40, true),
  ('HEADER_VALUE',   'content-type',              'multipart/report', 'SYSTEM', 'A delivery-status report rather than correspondence.', 50, true),
  ('HEADER_VALUE',   'return-path',               '^<>$',    'SYSTEM', 'Empty Return-Path — a bounce or a system notification.', 60, true),
  ('FROM_ADDRESS',   NULL, '^(no-?reply|donotreply|mailer-daemon|postmaster|bounce[s+-]?|cron|root|daemon|automated|notifications?)@', 'SYSTEM', 'Sent from an address that does not accept replies.', 70, true),
  ('FROM_DOMAIN',    NULL, '^(cpanel|whm)\.',      'SYSTEM', 'Sent by the hosting control panel.', 80, true)
ON CONFLICT (match_kind, COALESCE(match_key, ''), match_value) DO NOTHING;

/* ── VIP ──────────────────────────────────────────────────────────────────── */
-- A flag on the party, not on the thread: "this account matters" is a fact about
-- the relationship, and re-deciding it per conversation is how half a client's
-- threads end up pinned and the other half not.
ALTER TABLE client_master   ADD COLUMN IF NOT EXISTS is_vip boolean NOT NULL DEFAULT false;
ALTER TABLE supplier_master ADD COLUMN IF NOT EXISTS is_vip boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ix_client_vip   ON client_master (client_id) WHERE is_vip;
CREATE INDEX IF NOT EXISTS ix_supplier_vip ON supplier_master (supplier_id) WHERE is_vip;

COMMENT ON TABLE email_stream_rule IS
  'How a message is sorted into the Human or System stream. Seeded rules are header-based and deterministic; a tenant may add its own. One rule outranks every row here and is in code, not data: a sender who resolves to a known party is never System mail.';
COMMENT ON COLUMN email_stream_rule.reason IS
  'Shown to the user as the answer to "why is this in System?". A classification the person cannot interrogate is one they will not trust.';

-- DOWN
--   DROP INDEX IF EXISTS ix_supplier_vip;
--   DROP INDEX IF EXISTS ix_client_vip;
--   DROP INDEX IF EXISTS ux_email_stream_rule_match;
--   DROP INDEX IF EXISTS ix_email_stream_rule_active;
--   -- DESTRUCTIVE: drops tenant-authored classification rules and every VIP flag
--   -- an account manager has set. The eight seeded rules are recreated by
--   -- re-running this migration; the tenant's own are not recoverable.
--   ALTER TABLE supplier_master DROP COLUMN IF EXISTS is_vip;
--   ALTER TABLE client_master   DROP COLUMN IF EXISTS is_vip;
--   DROP TABLE IF EXISTS email_stream_rule;
