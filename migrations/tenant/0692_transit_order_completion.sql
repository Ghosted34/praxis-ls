-- ============================================================================
-- 0692 — the transit order becomes a document, not a stub.
--
-- ── WHAT THE LEGACY ORDRE DE TRANSIT ACTUALLY IS ────────────────────────────
--
-- `administration/view/operations/transit-order.php` is a 1031-line screen that
-- produces ONE printed instrument: the bilingual "ORDRE DE TRANSIT / Transit
-- Authorization" a client signs and stamps to authorise us to declare their
-- cargo. It is not an internal note. It carries a client's signature, it names
-- a declared value the declaration is built on, and it states in writing who
-- carries the insurance risk and who calls the surveyor if the cargo is damaged.
--
-- The rebuild's `transit_order` (0310) has six columns: dossier, ot_number,
-- customs_regime, service_direction, declared_value, submitted_docs. Everything
-- the printed instrument commits the two parties TO is missing. Specifically —
-- and this is the finding, not an opinion:
--
--   `insurance_type`          legacy WRITES it (create_transit_order.php:47),
--                             the print template renders the clause from it
--                             (transit-order.php:715, "Assurance non couverte
--                             par SMART LOGISTICS"). Not carried across at all.
--   `transit_departure_date`  legacy writes it; prints as "Date de départ".
--                             Not carried across.
--   surveyor responsibility   printed as a two-box choice ("Sera demandé par
--                             NOUS / par SMART LOGISTICS", transit-order.php
--                             :723-726) and never persisted even in legacy —
--                             the box was ticked on paper and lost.
--   declared-value currency   legacy's cargo-value box is FREE TEXT and the
--                             placeholder is literally "e.g. 50.000 EUR"
--                             (transit-order.php:511), so the currency lived
--                             inside the number as a string. `declared_value`
--                             is numeric(18,2) with no currency beside it,
--                             which is worse: it looks precise and isn't.
--   "Autre régime"            the printed form has an "Other Regime: ______"
--                             write-in line the five-value CHECK cannot hold.
--
-- ── WHAT THIS MIGRATION DOES *NOT* DO, DELIBERATELY ─────────────────────────
--
-- It does not add client, vessel, BL, POL, POD, ATA, commodity, packages,
-- weight, marks or place-of-delivery columns — every one of which the legacy
-- screen displays, and every one of which `get_file.php` READ FROM THE FILE and
-- rendered read-only. Those are facts about the shipment, they live on the
-- dossier, and 0660/0661 already solved carrying them onto a document: the
-- shipment-details projection reads them live and `shipment_details_snapshot`
-- freezes them when the document locks. Copying them into `transit_order`
-- columns would create a second place for a vessel name to live and disagree.
--
-- The rule this file follows: a column here only for what the ORDER DECIDES,
-- never for what the FILE already knows.
--
-- ── THE LIFECYCLE, WHICH IS THE REAL UPGRADE ────────────────────────────────
--
-- Legacy had no status. `create.php` INSERTs and the operator prints; there is
-- no record of whether the client ever signed, and the OT number is burned at
-- the moment someone opens the form (it is allocated on page render, so every
-- abandoned form leaves a gap in a sequence customs officers read).
--
-- Here it is a document with states:
--
--   DRAFT      being prepared. NO NUMBER YET — numbering.allocate() is called
--              on ISSUE, not on create, so an abandoned draft burns nothing.
--   ISSUED     numbered, printed, sent to the client for signature. This is the
--              state that freezes the shipment-details snapshot (0661).
--   SIGNED     the client returned it stamped; signed_at + the scan in the
--              vault. This is the state that authorises lodging a declaration.
--   LODGED     the customs declaration citing it has been filed; carries the
--              declaration reference the milestone chain reports on.
--   CANCELLED  withdrawn. Terminal, and a numbered order that is cancelled
--              KEEPS its number (customs sequences may not be re-used).
--
-- ── WHY declared_value GETS A CURRENCY AND AN FX RATE ───────────────────────
--
-- The declared value is the base of duty. It is almost never in XAF — it is the
-- supplier-invoice value in EUR, USD or CNY — and the duty is assessed in XAF at
-- a rate on a date. Storing one number with no currency means the figure on the
-- order cannot be reconciled to either the supplier invoice or the duty paid.
-- Three columns state it once and completely, matching how `costing` (0320)
-- already stores currency + exchange_rate_to_xaf.
--
-- Backfill is XAF at 1.0 for existing rows, which is the only safe assumption:
-- every existing row was written by a form that had no currency picker, in a
-- tenant whose functional currency is XAF.
-- ============================================================================

-- ── 1. Commitments the printed instrument makes ─────────────────────────────

ALTER TABLE transit_order
  ADD COLUMN IF NOT EXISTS entity_id           uuid REFERENCES corporate_entity(entity_id),
  ADD COLUMN IF NOT EXISTS insurance_type      text NOT NULL DEFAULT 'CLIENT',
  ADD COLUMN IF NOT EXISTS surveyor_party      text NOT NULL DEFAULT 'CLIENT',
  ADD COLUMN IF NOT EXISTS departure_date      date,
  ADD COLUMN IF NOT EXISTS customs_regime_other text,
  ADD COLUMN IF NOT EXISTS declared_currency   char(3) NOT NULL DEFAULT 'XAF',
  ADD COLUMN IF NOT EXISTS declared_fx_to_xaf  numeric(18,8) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS instructions        text;

COMMENT ON COLUMN transit_order.entity_id IS
  'Which of our corporate entities issues this order — the letterhead, and the numbering scope. Legacy was single-entity and had no equivalent.';
COMMENT ON COLUMN transit_order.insurance_type IS
  'Who carries the marine/transit risk. Prints as the "Assurance non couverte par ..." clause (legacy transit-order.php:715).';
COMMENT ON COLUMN transit_order.surveyor_party IS
  'Who applies for the survey ("constat d''expert") if the cargo is damaged. Printed as a tick-box in legacy and never persisted.';
COMMENT ON COLUMN transit_order.customs_regime_other IS
  'The write-in "Autre Régime" line. Only meaningful when customs_regime IS NULL.';
COMMENT ON COLUMN transit_order.declared_fx_to_xaf IS
  'Rate used to express declared_value in XAF for duty. 1 when declared_currency is XAF.';

-- ── 2. Lifecycle ────────────────────────────────────────────────────────────

ALTER TABLE transit_order
  ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS issued_at         timestamptz,
  ADD COLUMN IF NOT EXISTS issued_by         uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS signed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS signed_by_name    text,
  ADD COLUMN IF NOT EXISTS signature_vault_id uuid REFERENCES document_vault(doc_id),
  ADD COLUMN IF NOT EXISTS lodged_at         timestamptz,
  ADD COLUMN IF NOT EXISTS declaration_ref   text,
  ADD COLUMN IF NOT EXISTS cancelled_at      timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason     text,
  ADD COLUMN IF NOT EXISTS created_by        uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN transit_order.status IS
  'DRAFT -> ISSUED -> SIGNED -> LODGED, or CANCELLED. A number is allocated at ISSUED, never at DRAFT, so an abandoned draft burns no customs sequence.';
COMMENT ON COLUMN transit_order.signature_vault_id IS
  'The scan of the client-stamped order. Required to reach SIGNED — the state that authorises lodging a declaration.';
COMMENT ON COLUMN transit_order.declaration_ref IS
  'The customs declaration number filed against this order (the legacy form had nowhere to record it).';

-- ── 3. Existing rows are ISSUED, not DRAFT ──────────────────────────────────
--
-- Every pre-0692 row was created by a code path that allocated a number and
-- captured a document immediately — that is precisely the ISSUED state, and
-- calling them DRAFT would claim they had never been sent to a client when
-- some certainly were. Guarded on ot_number so a row that somehow has none is
-- left in DRAFT rather than asserted to be issued.
UPDATE transit_order
   SET status    = 'ISSUED',
       issued_at = COALESCE(issued_at, created_at)
 WHERE status = 'DRAFT'
   AND ot_number IS NOT NULL;

-- ── 4. Constraints ──────────────────────────────────────────────────────────
--
-- Added after the backfill so the rows being described already satisfy them.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_transit_order_status') THEN
    ALTER TABLE transit_order ADD CONSTRAINT chk_transit_order_status
      CHECK (status IN ('DRAFT','ISSUED','SIGNED','LODGED','CANCELLED'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_transit_order_insurance') THEN
    ALTER TABLE transit_order ADD CONSTRAINT chk_transit_order_insurance
      CHECK (insurance_type IN ('CLIENT','COMPANY'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_transit_order_surveyor') THEN
    ALTER TABLE transit_order ADD CONSTRAINT chk_transit_order_surveyor
      CHECK (surveyor_party IN ('CLIENT','COMPANY'));
  END IF;
END $$;

-- A regime must be stated exactly one way: a coded one OR a write-in, never
-- both and — once the order is issued — never neither. A DRAFT may have
-- neither, because that is what a draft is for.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_transit_order_regime_stated') THEN
    ALTER TABLE transit_order ADD CONSTRAINT chk_transit_order_regime_stated
      CHECK (
        customs_regime IS NULL
        OR customs_regime_other IS NULL
      ) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_transit_order_fx_positive') THEN
    ALTER TABLE transit_order ADD CONSTRAINT chk_transit_order_fx_positive
      CHECK (declared_fx_to_xaf > 0) NOT VALID;
  END IF;
END $$;

-- An ISSUED order has a number, and a number is unique per entity. Partial so
-- DRAFTs (all NULL) do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS ux_transit_order_number
  ON transit_order (entity_id, ot_number)
  WHERE ot_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_transit_order_status ON transit_order (status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_transit_order_entity ON transit_order (entity_id);

-- ── 5. Lines carry their own value and marks ────────────────────────────────
--
-- The printed cargo table has five columns — Marks / Packages / Description /
-- Weight / Value (transit-order.php:678-688) — and `transit_order_line` (0476)
-- has three: label, packages, weight. Legacy filled the row from the FILE and
-- typed one value into one box, because it only ever printed a single line.
-- A consolidation with three suppliers' cargo under one BL is four boxes of
-- ciment at one value and a generator at another, and that has to be two lines
-- whose values sum to the declared value.
ALTER TABLE transit_order_line
  ADD COLUMN IF NOT EXISTS marks       text,
  ADD COLUMN IF NOT EXISTS hs_code     text,
  ADD COLUMN IF NOT EXISTS value_amount numeric(18,2),
  ADD COLUMN IF NOT EXISTS line_no     integer;

COMMENT ON COLUMN transit_order_line.hs_code IS
  'Tariff heading for this line. Not on the legacy form, but it is what the declaration is built from and the operator already knows it here.';

CREATE INDEX IF NOT EXISTS ix_to_line_order ON transit_order_line (transit_order_id, line_no);

-- ── 6. updated_at, like every other document head in this schema ────────────
CREATE OR REPLACE TRIGGER trg_transit_order_updated
  BEFORE UPDATE ON transit_order
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DOWN
-- Dropping these DESTROYS the signature record, the lodging reference and the
-- declared-value currency of every order — none of which can be reconstructed
-- from the dossier. Restore from the pre-deploy dump instead.
--
-- DROP TRIGGER IF EXISTS trg_transit_order_updated ON transit_order;
-- DROP INDEX IF EXISTS ix_to_line_order;
-- ALTER TABLE transit_order_line
--   DROP COLUMN IF EXISTS marks,
--   DROP COLUMN IF EXISTS hs_code,
--   DROP COLUMN IF EXISTS value_amount,
--   DROP COLUMN IF EXISTS line_no;
-- DROP INDEX IF EXISTS ix_transit_order_entity;
-- DROP INDEX IF EXISTS ix_transit_order_status;
-- DROP INDEX IF EXISTS ux_transit_order_number;
-- ALTER TABLE transit_order DROP CONSTRAINT IF EXISTS chk_transit_order_fx_positive;
-- ALTER TABLE transit_order DROP CONSTRAINT IF EXISTS chk_transit_order_regime_stated;
-- ALTER TABLE transit_order DROP CONSTRAINT IF EXISTS chk_transit_order_surveyor;
-- ALTER TABLE transit_order DROP CONSTRAINT IF EXISTS chk_transit_order_insurance;
-- ALTER TABLE transit_order DROP CONSTRAINT IF EXISTS chk_transit_order_status;
-- ALTER TABLE transit_order
--   DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS created_by,
--   DROP COLUMN IF EXISTS cancel_reason, DROP COLUMN IF EXISTS cancelled_at,
--   DROP COLUMN IF EXISTS declaration_ref, DROP COLUMN IF EXISTS lodged_at,
--   DROP COLUMN IF EXISTS signature_vault_id, DROP COLUMN IF EXISTS signed_by_name,
--   DROP COLUMN IF EXISTS signed_at, DROP COLUMN IF EXISTS issued_by,
--   DROP COLUMN IF EXISTS issued_at, DROP COLUMN IF EXISTS status,
--   DROP COLUMN IF EXISTS instructions, DROP COLUMN IF EXISTS declared_fx_to_xaf,
--   DROP COLUMN IF EXISTS declared_currency, DROP COLUMN IF EXISTS customs_regime_other,
--   DROP COLUMN IF EXISTS departure_date, DROP COLUMN IF EXISTS surveyor_party,
--   DROP COLUMN IF EXISTS insurance_type, DROP COLUMN IF EXISTS entity_id;
