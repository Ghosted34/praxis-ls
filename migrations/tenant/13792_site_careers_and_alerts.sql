-- ============================================================================
-- TENANT — 13792 The careers page when nobody is hiring.
--
-- ── THE STATE THIS IS ABOUT ────────────────────────────────────────────────
--
-- `/careers` renders a list of published vacancies, and the list is EMPTY more
-- often than it is full: a company of forty hires a handful of times a year and
-- is between rounds the rest of it. The nav item is unconditional
-- (site-header.tsx), so a tenant who is not hiring ships a permanent link to a
-- dashed rectangle reading "No open roles right now / Please check back".
--
-- That is a dead end at the exact moment somebody was interested enough to look
-- — and the product already has somewhere for them to go. `job_applicant`
-- has a NULLABLE `vacancy_id` (0360) and a `TALENT_POOL` status, and 0525's
-- `searchPool` is a LEFT JOIN, so a candidate with no vacancy attached already
-- appears in the Past applicants panel and can already be put in front of a
-- real role by 0703's `considerForVacancy`. The road is built. What was missing
-- is the door: a public way onto it, and a tenant's permission to open one.
--
-- ── WHY SWITCHES LIVE IN A TABLE AND COPY DOES NOT ────────────────────────
--
-- Every SENTENCE on the careers page is already the tenant's to rewrite, in
-- both languages, through 13790's `copy_overrides` block — so nothing in this
-- file holds words. What it holds is the two things a PUBLIC ENDPOINT has to
-- be able to check before it writes a row, and public content cannot gate a
-- public write: whether this tenant accepts an application with no role
-- attached, and whether it will take an email address to write to later.
--
-- Both default FALSE, and that is the load-bearing half of the decision. A
-- default of true would start every existing tenant receiving CVs into a
-- pipeline nobody told them about, from a page they did not change, in an
-- upgrade they did not ask for. Turning it on is a decision with a person
-- behind it.
--
-- ── WHY JOB ALERTS ARE NOT `newsletter_subscriber` ────────────────────────
--
-- They were going to be, and it is wrong twice.
--
--   · `newsletter_subscriber.email` is `citext UNIQUE` across one flat list
--     (0350). A candidate who already receives the tenant's marketing mail
--     would hit the conflict and get NO ROW — their signup silently does
--     nothing, and they find out by never being told about a job.
--   · Consent does not transfer. Somebody asking to hear about vacancies has
--     not agreed to a campaign send, and `marketing_campaign` sends to that
--     table by definition. One list with a `source` column is not two consents.
--
-- So: its own table, its own consent, and its own unsubscribe key — bulk mail
-- to a stranger needs a way out that does not require an account, and one that
-- cannot be derived from the address it belongs to.
-- ============================================================================

-- ── 1. The two switches ────────────────────────────────────────────────────

-- Singleton in the house style of 13785_site_about: `UNIQUE CHECK (singleton)`
-- makes "there is exactly one row" a thing the DATABASE enforces, rather than
-- a convention every caller has to remember and one caller will not.
CREATE TABLE IF NOT EXISTS site_careers (
  site_careers_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton        boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),

  -- Accept a CV with no vacancy attached. Lands as job_applicant with
  -- vacancy_id NULL and status TALENT_POOL — see careers.service.applyOpen.
  open_applications  boolean NOT NULL DEFAULT false,

  -- Take an address and write to it when a role opens. Implies a send
  -- obligation, which is why it is separate from the switch above: a tenant
  -- may well want CVs without committing to mail anybody back.
  alerts_enabled     boolean NOT NULL DEFAULT false,

  -- Which insight tag feeds the "life here" strip on the careers page. NULL
  -- means no strip — the correct empty state, and the one most tenants are in.
  -- A tag rather than a second content table because `insight` already has
  -- tags, an editor, and a publish flag; a careers-only copy of all three
  -- would be three chances to disagree with the originals.
  culture_tag        text,

  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES app_user(user_id),

  -- Trimmed to NULL rather than stored blank: `culture_tag = ''` would filter
  -- the insight list to nothing and read on screen as "the tenant configured a
  -- strip and it is broken", which is the opposite of what an empty box means.
  CONSTRAINT ck_site_careers_culture_tag
    CHECK (culture_tag IS NULL OR length(btrim(culture_tag)) > 0)
);

-- Seeded here, as 13785 seeds `site_about`, because `updateCareers` is an
-- UPDATE ... WHERE singleton = true: with no row to match it writes nothing and
-- reports success, so the settings screen would save and silently do nothing.
INSERT INTO site_careers (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

-- ── 2. Job alerts ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS careers_alert (
  careers_alert_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- citext, so re-subscribing with a differently-cased address updates the one
  -- row rather than creating a second one nobody can tell from the first.
  email             citext NOT NULL UNIQUE,
  name              text,

  -- The language they ASKED in. A careers page served in French that mails in
  -- English is the same defect as an untranslated advert, arriving later.
  locale            text NOT NULL DEFAULT 'fr' CHECK (locale IN ('en', 'fr')),

  -- Their own key, 32 bytes of CSPRNG minted on subscribe. An unsubscribe link
  -- must work with no account and must not be guessable from the address —
  -- `?email=` would let anyone unsubscribe anyone.
  unsubscribe_token text NOT NULL UNIQUE,

  -- Kept rather than deleted on unsubscribe: a deleted row is a row that can be
  -- re-added by the next signup form, and "I unsubscribed and it started again"
  -- is the complaint that makes a sender look like a spammer.
  is_subscribed     boolean NOT NULL DEFAULT true,
  subscribed_at     timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at   timestamptz,

  -- How far the sender has got for this person. Nullable, and the sender reads
  -- GREATEST(last_notified_at, subscribed_at) — so somebody who signs up today
  -- is not mailed the whole back catalogue of everything published this year.
  last_notified_at  timestamptz
);

-- The sender's own query: everyone still subscribed, oldest watermark first.
CREATE INDEX IF NOT EXISTS ix_careers_alert_pending
  ON careers_alert (last_notified_at NULLS FIRST)
  WHERE is_subscribed;

COMMENT ON TABLE careers_alert IS
  'Job-alert subscribers for the public careers page. Deliberately NOT newsletter_subscriber: that table is one flat marketing list with email UNIQUE, so a signup from somebody already on it would silently no-op, and consent to hear about vacancies is not consent to a campaign send.';

COMMENT ON COLUMN site_careers.open_applications IS
  'Accept an application with no vacancy attached. Written as job_applicant(vacancy_id NULL, status TALENT_POOL) and surfaced by 0525 searchPool, which LEFT JOINs vacancy. Defaults false so an upgrade never starts a pipeline nobody asked for.';

-- ── VERIFY ─────────────────────────────────────────────────────────────────
--   SELECT n.nspname, c.relname
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE c.relname IN ('site_careers', 'careers_alert');
--     -- expect four rows (live + sandbox, two tables each)
--
--   SELECT count(*) FROM site_careers;                -- expect exactly 1
--   INSERT INTO site_careers DEFAULT VALUES;          -- expect: unique violation
--   UPDATE site_careers SET culture_tag = '   ';      -- expect: ck_site_careers_culture_tag
--
--   INSERT INTO careers_alert (email, unsubscribe_token)
--        VALUES ('a@example.com', 'tok1');            -- expect: accepted
--   INSERT INTO careers_alert (email, unsubscribe_token)
--        VALUES ('A@EXAMPLE.COM', 'tok2');            -- expect: unique violation (citext)
--   INSERT INTO careers_alert (email, unsubscribe_token, locale)
--        VALUES ('b@example.com', 'tok3', 'de');      -- expect: locale check violation
--
-- DOWN
--   -- Both tables are additive and nothing outside this feature reads them, so
--   -- dropping them loses the switches and the subscriber list and nothing
--   -- else. The careers page falls back to the state this migration found it
--   -- in: the published-vacancy list, and an empty box when there is none.
--   DROP INDEX IF EXISTS ix_careers_alert_pending;
--   DROP TABLE IF EXISTS careers_alert;
--   DROP TABLE IF EXISTS site_careers;
-- ============================================================================
