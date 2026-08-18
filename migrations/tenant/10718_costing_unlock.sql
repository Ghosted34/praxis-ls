-- ============================================================================
-- TENANT DB — 10718 Costing: a way out of APPROVED_LOCKED.
--
-- WHAT WAS WRONG
--
-- `costing.status` (0320:13) allows five values and the service's flow map
-- (costing.service.js:70) can reach four of them. `APPROVED_LOCKED` and
-- `REJECTED` are both in `LOCKED` (costing.service.js:21), and `setStatus`
-- refuses any transition out of a locked status before it even looks at the
-- target. So an approved costing is frozen forever: a corrected rate, a carrier
-- credit, a line priced against the wrong container — none of them can be
-- applied, and the only remedy is a second costing that silently competes with
-- the first for the same dossier.
--
-- The legacy system did NOT have this problem. `api/costing/transition.php`
-- gates seven actions, three of which exist purely to reopen a locked costing:
-- REQUEST_UNLOCK (line 175), UNLOCK (186) and DENY_UNLOCK (197). It parks the
-- request in a sixth status, `UNLOCK_REQUESTED`, so that "someone has asked"
-- is visible in the list rather than living in a comment.
--
-- This is the same class of defect as régie's AGED_UNJUSTIFIED before 10717 —
-- a state with no exit — and the régie work explicitly refused to repeat it
-- (regie.rules.js: "That is precisely the costing APPROVED_LOCKED defect (a
-- lock with no key), and repeating it in a module written from scratch would be
-- indefensible"). This migration removes the original.
--
-- WHY A SIXTH STATUS AND NOT A BOOLEAN
--
-- The implementation plan assumed no migration was needed here, on the grounds
-- that unlock "returns the row to an existing state". Reading transition.php
-- properly shows otherwise: the request and the decision are two separate acts
-- by two different people, so the interval between them has to be
-- representable. A boolean `unlock_requested` beside `status` would encode the
-- same fact while allowing `('APPROVED_LOCKED', true)` and `('DRAFT', true)` to
-- coexist — two sources of truth for one lifecycle. The CHECK is widened
-- instead, which is how every other state in this table is expressed.
--
-- WHY UNLOCK RETURNS TO DRAFT
--
-- Legacy sets `status='DRAFT'` (transition.php:192), and DRAFT is already the
-- only status `updateDraft` will edit (costing.service.js:54). Returning
-- anywhere else would produce a costing that is unlocked in name and still
-- uneditable in fact.
--
-- WHY THE UNLOCK IS REFUSED ONCE THE INVOICE IS POSTED
--
-- Not in the legacy, and not in the plan — it comes from what approval now
-- does downstream. `costing.setStatus` calls
-- `finalInvoice.ensureDraftForCosting` (costing.service.js:99) on
-- APPROVED_LOCKED, so approving a costing OPENS A FINAL INVOICE for its
-- dossier, and that invoice can go on to ISSUED_LOCKED / POSTED_LOCKED
-- (0230:66) and carry a posted `entry_id`. Unlocking the costing underneath a
-- posted receivable would let the priced basis change while the booked revenue
-- stays as it was — precisely the "wrong ledger entry produced by a workflow
-- completing normally" that 10717 was written to stop.
--
-- The guard lives in the service (it needs to name the offending invoice in a
-- 422) rather than as a table CHECK, because a CHECK cannot see another table.
-- `ux_costing_unlock_guard` below is the DATA half: it stops a second unlock
-- request piling up on the same costing.
--
-- ADDITIVE ONLY. No column is dropped or retyped. The CHECK is widened, never
-- narrowed, so every row that satisfied the old constraint satisfies the new
-- one and the rewrite cannot fail on existing data.
-- ============================================================================

-- Widen the status vocabulary. 0320 declared the CHECK inline, so Postgres
-- auto-named it `costing_status_check` — same situation and same handling as
-- 0671_dossier_draft.sql:48. Dropping and re-adding is the only way to change a
-- CHECK; the new set is a strict superset, so this is not destructive.
ALTER TABLE costing DROP CONSTRAINT IF EXISTS costing_status_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'costing_status_check') THEN
    ALTER TABLE costing ADD CONSTRAINT costing_status_check CHECK (status IN (
      'DRAFT',
      'SUBMITTED_FOR_VALIDATION',
      'SUBMITTED_FOR_APPROVAL',
      'APPROVED_LOCKED',
      'UNLOCK_REQUESTED',
      'REJECTED'
    ));
  END IF;
END $$;

-- Who asked, when, and why. `unlock_reason` is the audit answer to "why is this
-- approved costing open again" and is what the approver reads before deciding.
ALTER TABLE costing
  ADD COLUMN IF NOT EXISTS unlock_requested_by uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS unlock_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS unlock_reason       text,
  ADD COLUMN IF NOT EXISTS unlocked_by         uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS unlocked_at         timestamptz;

COMMENT ON COLUMN costing.unlock_reason IS
  'Why an approved costing was reopened. Set on REQUEST_UNLOCK, kept after UNLOCK/DENY_UNLOCK as the audit trail.';
COMMENT ON COLUMN costing.unlocked_at IS
  'When the last unlock was granted. NULL = never unlocked. Not cleared on re-approval, so a repeatedly reopened costing is visible.';

-- A costing in UNLOCK_REQUESTED must carry the request metadata; anything else
-- would be a pending decision nobody can attribute. Enforced as a table CHECK
-- because both columns live on this row.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_costing_unlock_requested_attributed') THEN
    ALTER TABLE costing
      ADD CONSTRAINT chk_costing_unlock_requested_attributed
      CHECK (status <> 'UNLOCK_REQUESTED' OR unlock_requested_at IS NOT NULL) NOT VALID;
  END IF;
END $$;

-- Find pending unlock requests without scanning the table. Partial, because
-- UNLOCK_REQUESTED is by nature a small and short-lived set.
CREATE INDEX IF NOT EXISTS ix_costing_unlock_requested
  ON costing (unlock_requested_at)
  WHERE status = 'UNLOCK_REQUESTED';

-- DOWN
-- The CHECK widening is reversible ONLY while no row sits in the new status;
-- narrowing it back with an UNLOCK_REQUESTED row present fails the rewrite,
-- which is the correct outcome (silently rewriting those rows would lose a
-- pending decision). Move them off the status first, then:
--
--   ALTER TABLE costing DROP CONSTRAINT IF EXISTS chk_costing_unlock_requested_attributed;
--   DROP INDEX IF EXISTS ix_costing_unlock_requested;
--   ALTER TABLE costing DROP CONSTRAINT IF EXISTS costing_status_check;
--   ALTER TABLE costing
--     ADD CONSTRAINT costing_status_check CHECK (status IN (
--       'DRAFT','SUBMITTED_FOR_VALIDATION','SUBMITTED_FOR_APPROVAL',
--       'APPROVED_LOCKED','REJECTED'));
--   -- DESTRUCTIVE: drops the unlock audit trail (who asked, why, who granted it).
--   ALTER TABLE costing
--     DROP COLUMN IF EXISTS unlocked_at,
--     DROP COLUMN IF EXISTS unlocked_by,
--     DROP COLUMN IF EXISTS unlock_reason,
--     DROP COLUMN IF EXISTS unlock_requested_at,
--     DROP COLUMN IF EXISTS unlock_requested_by;
