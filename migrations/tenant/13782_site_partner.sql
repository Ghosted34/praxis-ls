-- ============================================================================
-- TENANT — 13782 Partners and clients shown on the public website.
--
-- ── THREE CLAIMS, NOT ONE LOGO WALL ────────────────────────────────────────
--
-- `kind` is required and it is the whole design. A carrier, a client and a
-- network membership make three DIFFERENT claims, and a grid that mixes them
-- makes none of them:
--
--   carrier  "we move cargo on these lines"        — a capability
--   client   "these organisations trust us"        — a reference
--   network  "we are a member of this"             — a membership
--
-- The renderer treats them separately: carriers sit on the corridor map at the
-- lane they serve, clients get a quiet monochrome band, memberships join the
-- credentials strip. `doc/WEB_BUILD_BRIEF.md` N11 forbids a "trusted by" logo
-- wall, and this column is how that stays true structurally rather than by
-- somebody remembering.
--
-- ── ck_site_partner_active_needs_permission ────────────────────────────────
--
-- THE CONSTRAINT THAT MATTERS, and it is here rather than in the service on
-- purpose.
--
-- These are third-party trademarks. Two of the marks this feature was built
-- for — GIZ, a German federal agency, and CMA CGM — operate written-permission
-- regimes, and showing a carrier's mark can additionally imply an agency
-- relationship the tenant does not have. "Did we get clearance for this one?"
-- is a question that recurs forever and is answered in somebody's inbox.
--
-- So a row cannot go live without the answer written down beside it. Not a
-- boolean — a boolean is ticked without thought — but free text: who granted
-- it, when, and under what terms. A validator could enforce this and a
-- validator can be bypassed by a repair script at 2am; a CHECK cannot.
--
-- ── LOGOS ARE VAULT DOCUMENTS ──────────────────────────────────────────────
--
-- `logo_vault_id`, scoped 'SITE' / role 'PARTNER' by 13788, exactly as an
-- insight cover is scoped 'INSIGHT' / 'COVER'. Not a URL column: a third-party
-- logo hotlinked from the partner's own CDN is a request every visitor makes to
-- someone else's server, from the tenant's page, with the tenant's referrer.
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_partner (
  partner_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  kind             text NOT NULL,
  logo_vault_id    uuid REFERENCES document_vault(doc_id),
  url              text,

  -- Who cleared this mark, when, and on what terms. Required before is_active.
  permission_note  text,

  sort_order       integer NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT false,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES app_user(user_id),

  CONSTRAINT ck_site_partner_kind CHECK (kind IN ('carrier', 'client', 'network')),
  CONSTRAINT ck_site_partner_url  CHECK (url IS NULL OR url ~* '^https?://'),
  CONSTRAINT ck_site_partner_active_needs_permission
    CHECK (is_active = false OR (permission_note IS NOT NULL AND btrim(permission_note) <> ''))
);

CREATE INDEX IF NOT EXISTS ix_site_partner_active ON site_partner (kind, sort_order) WHERE is_active;

COMMENT ON TABLE site_partner IS
  'Third-party marks shown on the public site. `kind` separates three different claims (capability, reference, membership) that a single logo wall would flatten — N11 forbids the wall.';
COMMENT ON COLUMN site_partner.permission_note IS
  'Who granted permission to use this mark, when, and under what terms. A CHECK makes it mandatory before is_active — these are other companies'' trademarks, and "did we get clearance?" must be answered in the row rather than in somebody''s inbox.';

-- ============================================================================
-- VERIFY
--   INSERT INTO site_partner(name, kind, is_active) VALUES ('X','client',true);
--     -- expect 23514: cannot activate without a permission note
--   INSERT INTO site_partner(name, kind) VALUES ('X','competitor');
--     -- expect 23514: unknown kind
--
-- DOWN
--   DROP INDEX IF EXISTS ix_site_partner_active;
--   DROP TABLE IF EXISTS site_partner;
--   -- Vault rows survive with a SITE/PARTNER scope and nothing pointing at
--   -- them; 13788's DOWN clears the scope so no orphaned public bytes remain.
-- ============================================================================
