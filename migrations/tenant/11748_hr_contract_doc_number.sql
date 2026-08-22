-- ============================================================================
-- TENANT DB — 11748 HR contract: a real document number.
--
-- WHAT WAS WRONG
--
-- `hr_contract` had no number. The PDF template therefore printed
-- `String(hr_contract_id).slice(0, 8)` as the contract's number
-- (`template.service.js`, EMPLOYMENT_CONTRACT loader), so every employment
-- contract this system has ever issued went to an employee bearing eight hex
-- characters of a UUID — "3fa85f64" — where its reference should be.
--
-- The numbering scheme for it ALREADY EXISTED and had never been called:
-- `services/documents/numbering.service.js` maps `"MOD-12": "CTR"`, alongside
-- INV, CST, QTE and the rest. The sequence, the per-entity reset and the
-- tenant-configurable prefix were all sitting there waiting for a caller.
--
-- WHY A COLUMN AND NOT A DERIVATION
--
-- A document number is allocated once and then never changes — it is quoted in
-- letters, referenced by the employee, and cited in a dispute. Deriving it from
-- a sequence at render time would renumber the same contract on every render.
-- It is allocated at ISSUED (the moment the document leaves the building, the
-- same point the invoice numbers at) and stored.
--
-- UNIQUE, BUT NULLABLE. Nullable because every existing row has no number and
-- backfilling one would invent a reference nobody was ever given — those
-- contracts keep falling back to their id fragment, and only new issues get a
-- real number. Unique so the register cannot contain two CTR-2026-0007s; the
-- partial index skips the NULLs, which is what allows both to be true at once.
-- ============================================================================

ALTER TABLE hr_contract
  ADD COLUMN IF NOT EXISTS doc_number text;

COMMENT ON COLUMN hr_contract.doc_number IS
  'Allocated from numbering.service (MOD-12 → CTR prefix) at ISSUED, never on a draft — an unissued draft must not burn a number and leave a gap in the register. NULL on rows issued before 11748, which still render their id fragment.';

-- Partial: NULLs are the pre-11748 rows and must not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_contract_doc_number
  ON hr_contract (doc_number) WHERE doc_number IS NOT NULL;

-- DOWN
-- Additive. Dropping it loses the allocated references on every contract
-- issued since it shipped — the contracts themselves and the doc_sequence
-- counter are unaffected, but the numbers on issued paper stop resolving.
--
--   DROP INDEX IF EXISTS ux_hr_contract_doc_number;
--   ALTER TABLE hr_contract DROP COLUMN IF EXISTS doc_number;
