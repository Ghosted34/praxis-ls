-- ============================================================================
-- TENANT DB — 0696: let two partnership applications point at one supplier.
--
-- 0688 added `ux_partnership_request_supplier`, a UNIQUE index on
-- partnership_request(supplier_id) WHERE supplier_id IS NOT NULL, described in
-- that file as what "makes the check true under concurrency". The check it was
-- meant to defend is the per-row one — an application must not be approved
-- twice — but the index it created enforces something else: that no supplier is
-- ever referenced by more than ONE application.
--
-- That directly contradicts the behaviour partnership_request.service documents
-- and implements a few lines above it:
--
--     "an existing supplier with the same normalised name is REUSED rather than
--      duplicated"
--     draftSupplierFor() → const existing = await repo.findSupplierByNameNorm(…)
--                          if (existing) return { supplier: existing, reused: true };
--
-- The reuse branch runs, finds the supplier, and then the UPDATE that writes
-- supplier_id onto the second application violates the unique index. Observed
-- end to end: a vendor that applies twice — routine, and the exact case the
-- comment calls out ("the register can be re-approved after a re-application
-- without growing a second payable party") — makes the second application
-- permanently un-approvable, answering an opaque
-- `409 CONFLICT: A record with these values already exists`.
--
-- tests/unit/partnership-f10.test.js asserts the reuse path and passes: it
-- mocks the repo, so the branch is proven and the constraint that forbids its
-- result is not in the test's world at all.
--
-- The index is therefore replaced with a plain one — supplier_id is still worth
-- an index (the register filters on it) but must not be unique. The per-row
-- "already approved" guarantee moves to where it belongs, a `FOR UPDATE` lock
-- taken inside approve()'s transaction.
--
-- Idempotent: DROP … IF EXISTS, CREATE … IF NOT EXISTS.
-- ============================================================================

DROP INDEX IF EXISTS ux_partnership_request_supplier;

CREATE INDEX IF NOT EXISTS ix_partnership_request_supplier
  ON partnership_request(supplier_id) WHERE supplier_id IS NOT NULL;

-- DOWN (only safe while no supplier backs two applications)
-- DROP INDEX IF EXISTS ix_partnership_request_supplier;
-- CREATE UNIQUE INDEX IF NOT EXISTS ux_partnership_request_supplier
--   ON partnership_request(supplier_id) WHERE supplier_id IS NOT NULL;
