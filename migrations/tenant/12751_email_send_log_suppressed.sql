-- ============================================================================
-- TENANT DB — 12751 email_send_log: admit the SUPPRESSED status
--
-- `email.service.send` has written status='SUPPRESSED' for every sandbox send
-- since G2, and 0410's CHECK never listed the value. So each of those inserts
-- raised 23514 into the caller's `.catch(() => {})` and NO row was written —
-- the exact opposite of the audit trail the suppression block exists to leave.
-- The failure was invisible from both ends: the log showed nothing, and the
-- caller was handed a value it read as a successful send.
--
-- Worse on the pooled sandbox path. `withTenantConnection` pins that schema
-- inside an explicit BEGIN (registry.service.js, WS-S1), so the swallowed 23514
-- aborted the enclosing transaction and every later statement in the business
-- operation failed with 25P02 — a mail log write taking down the invoice that
-- triggered it.
--
-- SUPPRESSED is deliberately NOT folded into FAILED. Nothing went wrong: the
-- message was withheld by policy (PRD §5.5 — the sandbox must never mail real
-- clients), and anything reading this table to count delivery problems must not
-- count it as one. entitlement.service already sums only SENT/DELIVERED toward
-- the emails_month allowance, so a withheld message correctly bills nothing and
-- needs no change there.
--
-- The old constraint is dropped by CATALOGUE LOOKUP rather than by its expected
-- name. `DROP CONSTRAINT IF EXISTS email_send_log_status_check` would silently
-- do nothing against a database where the name differs, and the ADD would then
-- sit alongside a surviving constraint that still rejects SUPPRESSED —
-- reintroducing this bug while the migration reported success.
--
-- Safe to run twice, which it will be: a file that fails part way leaves its
-- ledger row unwritten and the whole thing re-runs after the fix, provisioning
-- replays the set, and CI applies the tenant set twice deliberately. The drop
-- skips any constraint that already admits SUPPRESSED (so the second pass
-- removes nothing), and the add is guarded on the constraint not being there.
-- ============================================================================

DO $$
DECLARE con_name text;
BEGIN
  FOR con_name IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = to_regclass('email_send_log')
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) ILIKE '%status%'
       AND pg_get_constraintdef(c.oid) NOT ILIKE '%SUPPRESSED%'
  LOOP
    EXECUTE format('ALTER TABLE email_send_log DROP CONSTRAINT %I', con_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = to_regclass('email_send_log')
       AND conname = 'email_send_log_status_check'
  ) THEN
    ALTER TABLE email_send_log
      ADD CONSTRAINT email_send_log_status_check
      CHECK (status IN ('QUEUED','SENT','DELIVERED','BOUNCED','COMPLAINED','FAILED','SUPPRESSED'));
  END IF;
END $$;

COMMENT ON COLUMN email_send_log.status IS
  'Outcome of one send attempt. SENT means the transport accepted the message '
  '(250) — NOT that it was delivered; nothing currently writes DELIVERED or '
  'BOUNCED. SUPPRESSED means the message was withheld by environment policy '
  'and never handed to a transport, which is not a failure.';

-- DOWN
--   ALTER TABLE email_send_log DROP CONSTRAINT IF EXISTS email_send_log_status_check;
--   ALTER TABLE email_send_log ADD CONSTRAINT email_send_log_status_check
--     CHECK (status IN ('QUEUED','SENT','DELIVERED','BOUNCED','COMPLAINED','FAILED'));
--   -- NB: rows already recorded SUPPRESSED must be resolved before this runs.
