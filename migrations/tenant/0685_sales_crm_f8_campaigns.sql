-- ============================================================================
-- TENANT DB — 0685 Sales & CRM F8: marketing campaigns as a budget-and-
-- performance record.
--
-- Vertical slice for doc/SALES_CRM_FEATURES.md#F8. `marketing_campaign` was
-- built as an EMAIL-SENDING record — name, channel, dates, assets_json — and
-- the question the register has to answer is "what did we spend and what did
-- we get". None of the money and none of the performance was in the table.
--
-- This migration owns:
--   1. platform / owner / target service / remarks — the campaign's identity.
--   2. budget_amount + budget_currency — the money.
--   3. targets and actuals for leads, opportunities and deals won.
--   4. PENDING_APPROVAL in the status vocabulary, plus the approval stamps and
--      the rejection reason that make an approval an auditable event rather
--      than a status value someone typed.
--   5. updated_at, which the table never had.
--
-- WHAT IS DELIBERATELY NOT HERE. No campaign→lead attribution link. F8 settles
-- that performance figures are hand-entered from the external ad manager, and
-- a half-built attribution join would make the same numbers look derived.
-- `actuals_updated_at` exists precisely so the UI can say WHEN a human last
-- typed them — the honesty notice the legacy screen prints, as a column.
--
-- ON THE STATUS VOCABULARY. The legacy has PLANNED / PENDING_APPROVAL /
-- ACTIVE / PAUSED / COMPLETED; this table has DRAFT / ACTIVE / PAUSED / ENDED.
-- DRAFT *is* PLANNED and ENDED *is* COMPLETED — same state, this repo's
-- spelling, already written into live rows and the screen. Adding the legacy
-- spellings alongside would give one state two names, which is the mistake F6
-- spent a slice correcting one column over. So exactly ONE state is genuinely
-- new: PENDING_APPROVAL.
--
-- Idempotent: every ALTER is ADD COLUMN IF NOT EXISTS, every constraint is
-- added inside a DO block that checks pg_constraint, every INSERT carries ON
-- CONFLICT, and the status CHECK is dropped by name before being re-added
-- (doc/DB_ARCHITECTURE.md §8.2). Applies twice cleanly.
-- ============================================================================

-- ─── 1. Identity: platform, owner, target service, remarks ──────────────────
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS platform        text NOT NULL DEFAULT 'OTHER';
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS owner_user_id   uuid REFERENCES app_user(user_id);
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS target_service  text NOT NULL DEFAULT 'ALL';
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS remarks         text;

-- The platform vocabulary is the legacy's, unchanged
-- (market-campaign-registration.php lines 599-604). It is a CLOSED set because
-- it is what the register filters and groups on, and a free-text channel column
-- is why the existing `channel` cannot be filtered usefully today.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_marketing_campaign_platform') THEN
    ALTER TABLE marketing_campaign
      ADD CONSTRAINT ck_marketing_campaign_platform
      CHECK (platform IN ('META','GOOGLE','LINKEDIN','EMAIL','OFFLINE','OTHER'));
  END IF;
END $$;

-- `target_service` is NOT constrained, and that is a decision rather than an
-- oversight. The legacy hard-codes four options (ALL / SEA_FREIGHT /
-- AIR_FREIGHT / WAREHOUSING) in a <select>; this system carries a tenant-owned
-- service-type catalogue (0660), and BUILD_CONVENTIONS §6 says a value a tenant
-- might reasonably extend is configuration, not a constant. A CHECK here would
-- make adding a service type a migration.

-- The existing free-text `channel` column stays. It predates this slice, the
-- send path reads nothing from it, and dropping a column that live rows carry
-- to replace it with a stricter one is a data-loss migration in exchange for
-- tidiness. `platform` is the filterable one; `channel` is a note.

-- ─── 2. The money ───────────────────────────────────────────────────────────
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS budget_amount   numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS budget_currency char(3) NOT NULL DEFAULT 'XAF' REFERENCES currency(code);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_marketing_campaign_budget_amount') THEN
    ALTER TABLE marketing_campaign
      ADD CONSTRAINT ck_marketing_campaign_budget_amount CHECK (budget_amount >= 0);
  END IF;
END $$;

-- ─── 3. Targets and actuals ─────────────────────────────────────────────────
-- Three planned figures and three recorded ones, on the same row, so "did it do
-- what we said it would" is one read. Both sets are hand-entered: the targets by
-- whoever plans the campaign, the actuals by whoever reads the ad manager's
-- weekly report. NOT NULL DEFAULT 0 rather than nullable — a campaign with no
-- leads recorded and a campaign nobody has updated yet both sum correctly into
-- the KPI tiles, and `actuals_updated_at` is what distinguishes them.
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS target_leads         integer NOT NULL DEFAULT 0;
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS target_opportunities integer NOT NULL DEFAULT 0;
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS target_won           integer NOT NULL DEFAULT 0;
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS actual_leads         integer NOT NULL DEFAULT 0;
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS actual_opportunities integer NOT NULL DEFAULT 0;
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS actual_won           integer NOT NULL DEFAULT 0;

-- When a human last typed the actuals, and who. The legacy screen prints
-- "Update these figures weekly based on external ad manager reports" as a
-- static notice; this is the same statement as data, so the screen can say
-- "as of 2 August" or "never updated" instead of implying the numbers are live.
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS actuals_updated_at      timestamptz;
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS actuals_updated_by_user_id uuid REFERENCES app_user(user_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_marketing_campaign_counts_non_negative') THEN
    ALTER TABLE marketing_campaign
      ADD CONSTRAINT ck_marketing_campaign_counts_non_negative
      CHECK (target_leads >= 0 AND target_opportunities >= 0 AND target_won >= 0
         AND actual_leads >= 0 AND actual_opportunities >= 0 AND actual_won >= 0);
  END IF;
END $$;

-- Deals won cannot exceed the leads that produced them. This is the one
-- arithmetic relationship between the hand-entered figures that is always
-- true, and without it the average-conversion tile can read over 100% — which
-- is how a typo in a weekly update becomes a number in a board pack.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_marketing_campaign_actuals_coherent') THEN
    ALTER TABLE marketing_campaign
      ADD CONSTRAINT ck_marketing_campaign_actuals_coherent
      CHECK (actual_won <= actual_leads AND actual_opportunities <= actual_leads);
  END IF;
END $$;

-- ─── 4. Approval ────────────────────────────────────────────────────────────
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS submitted_at        timestamptz;
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS submitted_by_user_id uuid REFERENCES app_user(user_id);
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS approved_at         timestamptz;
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS approved_by_user_id  uuid REFERENCES app_user(user_id);
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS rejected_at         timestamptz;
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS rejected_by_user_id  uuid REFERENCES app_user(user_id);
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS rejection_reason    text;

-- PENDING_APPROVAL joins the vocabulary. The original CHECK was declared inline
-- and so carries Postgres's generated name; it is dropped by that name and
-- re-added under an explicit one, so the next migration that needs to touch it
-- has something to grip.
ALTER TABLE marketing_campaign DROP CONSTRAINT IF EXISTS marketing_campaign_status_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_marketing_campaign_status') THEN
    ALTER TABLE marketing_campaign
      ADD CONSTRAINT ck_marketing_campaign_status
      CHECK (status IN ('DRAFT','PENDING_APPROVAL','ACTIVE','PAUSED','ENDED'));
  END IF;
END $$;

-- A rejection without a reason is the failure mode this column exists to
-- prevent: the legacy alerts "Please provide a reason" in the BROWSER
-- (market-campaign-registration.php performRejection), which means the API
-- accepts one without. Enforced here so no caller can skip it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_marketing_campaign_rejection_reason') THEN
    ALTER TABLE marketing_campaign
      ADD CONSTRAINT ck_marketing_campaign_rejection_reason
      CHECK (rejected_at IS NULL OR (rejection_reason IS NOT NULL AND length(btrim(rejection_reason)) > 0));
  END IF;
END $$;

-- ─── 5. updated_at ──────────────────────────────────────────────────────────
-- The table only ever had created_at, so "when did this last change" was
-- unanswerable and the register could not sort by it. Backfilled from
-- created_at, which is the only honest value available for existing rows.
ALTER TABLE marketing_campaign ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE marketing_campaign SET updated_at = created_at WHERE updated_at < created_at;

CREATE OR REPLACE TRIGGER trg_marketing_campaign_updated
  BEFORE UPDATE ON marketing_campaign
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 6. Indexes ─────────────────────────────────────────────────────────────
-- The register filters on status and platform, searches name and owner, and
-- orders by start date then creation.
CREATE INDEX IF NOT EXISTS ix_marketing_campaign_status    ON marketing_campaign(status);
CREATE INDEX IF NOT EXISTS ix_marketing_campaign_platform  ON marketing_campaign(platform);
CREATE INDEX IF NOT EXISTS ix_marketing_campaign_owner     ON marketing_campaign(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_marketing_campaign_starts_on ON marketing_campaign(starts_on DESC NULLS LAST, created_at DESC);

-- ─── 7. Event types for the notification / workflow designer ────────────────
-- The module has emitted campaign.created and campaign.<status> since it was
-- written and none of them were registered, so the designer could not offer a
-- campaign event at all. The approval events are new with this slice.
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('campaign.created',          'MOD-22', 'Campaign created',                 false, false),
 ('campaign.updated',          'MOD-22', 'Campaign updated',                 false, false),
 ('campaign.submitted',        'MOD-22', 'Campaign submitted for approval',  false, true),
 ('campaign.approved',         'MOD-22', 'Campaign approved',                false, false),
 ('campaign.rejected',         'MOD-22', 'Campaign rejected',                false, false),
 ('campaign.active',           'MOD-22', 'Campaign activated',               false, false),
 ('campaign.paused',           'MOD-22', 'Campaign paused',                  false, false),
 ('campaign.ended',            'MOD-22', 'Campaign ended',                   false, false),
 ('campaign.actuals_recorded', 'MOD-22', 'Campaign performance recorded',    false, false),
 ('newsletter.subscribed',     'MOD-22', 'Newsletter subscribed',            false, false),
 ('newsletter.unsubscribed',   'MOD-22', 'Newsletter unsubscribed',          false, false)
ON CONFLICT (key) DO NOTHING;


-- DOWN
-- ALTER TABLE live.thing DROP COLUMN new_col;



-- IRREVERSIBLE: drops customer_note, the data cannot be reconstructed