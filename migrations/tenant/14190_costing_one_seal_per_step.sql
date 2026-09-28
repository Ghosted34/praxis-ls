-- ============================================================================
-- TENANT DB — 14190 A costing carries ONE seal per step, never more.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- A costing is sealed three times on its way through: ACKNOWLEDGED (raised),
-- REVIEWED_ACCEPTED (validated), APPROVED_DISPATCH (approved). The document
-- printed every seal on `costing:<id>` that was not revoked — and unlocking an
-- approved costing revoked nothing. So approve → unlock → re-approve printed
-- SIX seals (SBX-CST-2026-0001: the same three steps twice, identical content
-- hashes), and every further unlock would add three more.
--
-- The service now supersedes a costing's seals when it is unlocked (see
-- costing.service unlockTransition). This migration:
--
--   1. repairs existing rows: a seal signed before the costing's last unlock is
--      superseded, and of what remains only the NEWEST seal per step stays
--      live. Superseded = the revocation triple, never a delete — a printout
--      made before today must keep verifying, as "revoked", on the portal.
--   2. makes a second live seal for the same step on the same costing
--      impossible, with a partial unique index. COSTING only: other document
--      types can carry two parties signing for the same reason.
-- ============================================================================

-- 1a. Seals from before the last unlock.
UPDATE document_signature s
   SET revoked_at = now(),
       revoke_reason = 'Superseded: the costing was unlocked for amendment'
  FROM costing c
 WHERE s.doc_type = 'COSTING'
   AND s.revoked_at IS NULL
   AND s.entity_ref = 'costing:' || c.costing_id::text
   AND c.unlocked_at IS NOT NULL
   AND s.signed_at < c.unlocked_at;

-- 1b. Anything still doubled: keep the newest per (costing, step).
UPDATE document_signature s
   SET revoked_at = now(),
       revoke_reason = 'Superseded: a newer seal records this step'
  FROM (
    SELECT signature_id,
           row_number() OVER (PARTITION BY entity_ref, sign_reason ORDER BY signed_at DESC, created_at DESC) AS rn
      FROM document_signature
     WHERE doc_type = 'COSTING' AND revoked_at IS NULL AND sign_reason IS NOT NULL
  ) d
 WHERE s.signature_id = d.signature_id
   AND d.rn > 1;

-- 2. The guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sig_costing_step_live ON document_signature(entity_ref, sign_reason) WHERE doc_type = 'COSTING' AND revoked_at IS NULL AND sign_reason IS NOT NULL;

-- ============================================================================
-- VERIFY
--   SELECT entity_ref, sign_reason, count(*) FROM document_signature
--    WHERE doc_type = 'COSTING' AND revoked_at IS NULL
--    GROUP BY 1, 2 HAVING count(*) > 1;            -- expect 0 rows
--
-- DOWN
--   -- The index only; the superseded seals stay superseded (they are evidence
--   -- that a newer seal replaced them, and un-revoking would re-print them).
--   -- DROP INDEX IF EXISTS uq_sig_costing_step_live;
-- ============================================================================
