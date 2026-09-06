-- ==============================================================================
-- TENANT DB — 13779 Actually widen the mail access-audit vocabulary (repairs 12750)
--
-- ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
--
-- 12750 set out to add MAILBOX_DISCONNECTED to `email_access_audit_action_check`
-- so `mailbox.service.disconnect` could record what it did. It never widened
-- anything, on any tenant, in either schema, because of its guard:
--
--     IF to_regclass('public.email_access_audit') IS NULL THEN RETURN; END IF;
--
-- Tenant tables do not live in `public`. 0001 creates `live` and `sandbox`, and
-- every tenant migration is UNQUALIFIED DDL applied twice — once with
-- search_path=live,public and once with search_path=sandbox,public
-- (provisioning.service.migrateTenantDb). So `public.email_access_audit` is
-- always NULL, the DO block always took the early RETURN, and the file recorded
-- itself in the ledger as applied while doing nothing at all.
--
-- The constraint therefore still carried 10725's six verbs, and the INSERT in
-- `repo.recordAccessAudit` raised 23514 — surfaced to the user as the
-- error-handler's "A value violates a domain constraint" — on the LAST step of
-- disconnecting a mailbox. Since that path is not transactional, the mailbox was
-- already archived and its credential already deleted by then: the disconnect
-- half-happened and reported failure. This migration is what makes the retry,
-- and every later disconnect, land cleanly.
--
-- Same bug family as the one tests/security/signature-migration-scoping.test.js
-- was written for: a guard that reads a schema the table is not in is a guard
-- that always says "not here". The fix is the same shape — resolve through
-- search_path and mean "in the schema this migration is running in".
--
-- ── WHY A NEW FILE RATHER THAN A FIX TO 12750 ───────────────────────────────
--
-- The ledger keys on filename, so an edited 12750 would never re-run: existing
-- tenants would keep the six-verb constraint while a fresh provision got seven,
-- which is exactly the silent divergence check-migration-idempotency.js exists
-- to prevent. A changed definition goes in a new migration.
--
-- Idempotent: dropped by name and recreated, so a re-run lands on the same
-- seven-verb definition. `ALTER TABLE` is unqualified and the guard is
-- unscoped, so both passes act on their own schema's table.
-- ==============================================================================

DO $$
BEGIN
  IF to_regclass('email_access_audit') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE email_access_audit
    DROP CONSTRAINT IF EXISTS email_access_audit_action_check;

  ALTER TABLE email_access_audit
    ADD CONSTRAINT email_access_audit_action_check
    CHECK (action IN (
      'GRANTED', 'REVOKED', 'ROLE_CHANGED', 'SENT_AS',
      'MAILBOX_HANDOVER', 'MAILBOX_ARCHIVED', 'MAILBOX_DISCONNECTED'
    ));
END $$;

-- DOWN
--   -- Only safe once no MAILBOX_DISCONNECTED rows remain.
--   DO $$
--   BEGIN
--     IF to_regclass('email_access_audit') IS NULL THEN RETURN; END IF;
--     ALTER TABLE email_access_audit DROP CONSTRAINT IF EXISTS email_access_audit_action_check;
--     ALTER TABLE email_access_audit ADD CONSTRAINT email_access_audit_action_check
--       CHECK (action IN ('GRANTED','REVOKED','ROLE_CHANGED','SENT_AS','MAILBOX_HANDOVER','MAILBOX_ARCHIVED'));
--   END $$;
