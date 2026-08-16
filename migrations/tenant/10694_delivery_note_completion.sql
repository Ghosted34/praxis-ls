-- ============================================================================
-- 10694 — the delivery note gets the three fields a delivery note is FOR.
--
-- GAP_REVIEW G23 names this alongside the transit order, and the two defects
-- are the same defect wearing different clothes:
--
--   `address`        a proof-of-delivery with no delivery address cannot be
--                    disputed, because nothing on it says where the goods went.
--                    `city_zone` (0310) is a routing bucket for the driver, not
--                    an address — "Bonabéri" does not identify a gate.
--   `phone`          the driver's escalation path when nobody answers at the
--                    gate. Legacy printed it under the consignee; the rebuild
--                    dropped it and the number now lives in whatever WhatsApp
--                    thread dispatched the run.
--   `delivery_date`  `created_at` is when the NOTE was raised, which is not
--                    when the goods arrived. Backdated and forward-dated runs
--                    are ordinary — a note raised Friday for a Monday drop is
--                    the normal case, not the edge case. Reporting "deliveries
--                    this month" off `created_at` is therefore wrong, quietly,
--                    and only by a few days, which is the hardest kind of wrong
--                    to notice.
--
-- `delivery_date` is deliberately NULLABLE with NO backfill from `created_at`.
-- Copying the raise-date into a field that means "arrival date" would fabricate
-- an arrival for every historic row and make the fabrication indistinguishable
-- from a real one. NULL reads as "not recorded", which is the truth.
--
-- Mirrors 10692 for `transit_order`. Same reasoning, same shape.
-- ============================================================================

ALTER TABLE delivery_note
  ADD COLUMN IF NOT EXISTS address       text,
  ADD COLUMN IF NOT EXISTS phone         text,
  ADD COLUMN IF NOT EXISTS delivery_date date;

-- Deliveries are read by date far more than by id ("what went out this week").
CREATE INDEX IF NOT EXISTS ix_delivery_note_date
  ON delivery_note (delivery_date DESC NULLS LAST);

-- ── The G23 line defect, at the storage layer ───────────────────────────────
-- `label` is what a free-text line IS. The service used to skip any line
-- without an `inventory_item_id`, so "2 pallets, unlisted spares" silently
-- vanished between the form and the note. The insert now keys on `label`, so
-- the column has to be able to refuse a blank one.
UPDATE delivery_note_line
   SET label = COALESCE(NULLIF(btrim(label), ''), 'Unspecified item')
 WHERE label IS NULL OR btrim(label) = '';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_note_line_label') THEN
    ALTER TABLE delivery_note_line
      ADD CONSTRAINT chk_delivery_note_line_label CHECK (btrim(label) <> '') NOT VALID;
  END IF;
END $$;

-- DOWN
-- ALTER TABLE delivery_note_line DROP CONSTRAINT IF EXISTS chk_delivery_note_line_label;
-- DROP INDEX IF EXISTS ix_delivery_note_date;
-- ALTER TABLE delivery_note
--   DROP COLUMN IF EXISTS delivery_date,
--   DROP COLUMN IF EXISTS phone,
--   DROP COLUMN IF EXISTS address;
