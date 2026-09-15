-- ============================================================================
-- TENANT — 13783 Certifications, licences and memberships, for publication.
--
-- ── WHY THIS IS NOT company_profile.certifications ─────────────────────────
--
-- `company_profile` (0691) already holds `certifications text[]` and
-- `memberships text[]`, and the overlap is real enough to answer here rather
-- than leave for a reviewer to find.
--
-- Those arrays are a SALES fact sheet: what a bid writer cites in a proposal.
-- They are a list of names, and that is all a proposal needs.
--
-- A published credentials strip needs what an array cannot hold: the issuing
-- body, the licence number a procurement officer will verify, the date it was
-- granted, the date it lapses, a logo, and a link. It also needs a decision the
-- sales list does not make — WHICH of them we put on the internet. Not every
-- certification a salesperson cites is one a tenant wants indexed with its
-- number beside it.
--
-- So: two tables, one relationship, stated. A later PR may offer "publish this
-- one" from the sales list; it must not silently mirror the array, because the
-- moment it does, deleting a row in one place leaves the other asserting it.
--
-- ── EXPIRY IS A COLUMN BECAUSE CREDENTIALS LAPSE ───────────────────────────
--
-- The single most damaging thing on a freight forwarder's site is an expired
-- licence number presented as current. `expires_on` lets the read filter it
-- out and the settings list warn about it, instead of it sitting there until a
-- customer notices. This is also the strongest content on the page when it is
-- true, which is exactly why it must not be allowed to go stale.
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_credential (
  credential_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  issuer         text,
  -- The licence or membership number. Verifiable, and therefore worth showing:
  -- unlike RCCM/NIU (deliberately withheld — see 13787), a credential number is
  -- an invitation to check rather than an identity to impersonate.
  identifier     text,
  issued_on      date,
  expires_on     date,
  logo_vault_id  uuid REFERENCES document_vault(doc_id),
  url            text,
  sort_order     integer NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES app_user(user_id),

  CONSTRAINT ck_site_credential_url   CHECK (url IS NULL OR url ~* '^https?://'),
  CONSTRAINT ck_site_credential_dates CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);

CREATE INDEX IF NOT EXISTS ix_site_credential_active ON site_credential (sort_order) WHERE is_active;

COMMENT ON TABLE site_credential IS
  'Certifications, licences and memberships published on the website. Distinct from company_profile.certifications (a sales fact sheet, names only): this carries issuer, number, dates, logo and the decision to publish. The two are related, never mirrored — mirroring means deleting one leaves the other asserting it.';
COMMENT ON COLUMN site_credential.expires_on IS
  'When it lapses. An expired licence number shown as current is the most damaging thing a forwarder can publish, so the read filters on this rather than trusting somebody to remember.';

-- ============================================================================
-- VERIFY
--   INSERT INTO site_credential(name, issued_on, expires_on)
--     VALUES ('X', '2026-01-01', '2025-01-01');       -- expect 23514
--
-- DOWN
--   DROP INDEX IF EXISTS ix_site_credential_active;
--   DROP TABLE IF EXISTS site_credential;
-- ============================================================================
