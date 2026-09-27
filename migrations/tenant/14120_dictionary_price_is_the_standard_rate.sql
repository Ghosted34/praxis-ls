-- ============================================================================
-- TENANT DB — 14120 An item's price is its STANDARD EXPENSE RATE, and only that.
--
-- ── THE BUG (meeting 5, 21 Sep 2026, 01:01:49 → 01:09:36) ──────────────────
--
-- A dictionary item had two prices that nothing kept in step:
--
--   dictionary_item.default_price   written by the dictionary form ("Default
--                                   price" step) and by the dictionary import;
--                                   read by the dictionary overview and by the
--                                   costing line picker.
--   expense_rate (no carrier, no    written by the Expense Rates screen
--   container type)                 ("Standard rate"); read by Suggest charges.
--
-- So a 20 000 XAF standard rate set on Expense Rates showed as nothing on the
-- dictionary overview and priced a hand-picked costing line at 0, while a
-- 25 000 typed into the dictionary wizard months earlier kept appearing on
-- "Bank deposit" with nobody able to find where it came from.
--
-- ── THE RULE FROM HERE ─────────────────────────────────────────────────────
--
-- The expense rate is the ONLY source. Reads join the in-force standard rate
-- (src/modules/master/expense_rate/standard-rate.sql.js) and expose it under
-- the old name, `default_price`, so no consumer changed shape. Nothing writes
-- the column any more: the dictionary create wizard turns its price into a
-- standard rate, and an edit cannot carry one.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────
--
--   1. Snapshots every non-NULL default_price, so the step is reversible.
--   2. For an item with a price and NO standard-scope rate row at all, opens
--      one: that price, in the item's currency, effective from the day the
--      item was created (never later than today), open-ended.
--      An item that already has a standard-scope rate row — in force or not —
--      keeps its rate history untouched: the rate is the source, and a stale
--      column value must not be written into the middle of a real history.
--   3. Clears the column. Leaving the old values in place would leave a second
--      answer in the table for the next query that selects `di.*` without the
--      join to find.
--
-- ── ADDITIVE + IDEMPOTENT ──────────────────────────────────────────────────
--
-- The snapshot is keyed on the item (ON CONFLICT DO NOTHING); the rate insert
-- is guarded by NOT EXISTS on the standard scope; the clear is guarded by
-- IS NOT NULL. A second run is a no-op. No CHECK or constraint is added (13791
-- rule), and the column is kept — dropping it is a separate, later decision.
-- ============================================================================

-- ── 1. Snapshot ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dictionary_item_price_snapshot_14120 (
  dictionary_item_id uuid PRIMARY KEY,
  default_price      numeric(18,2) NOT NULL,
  currency           char(3),
  captured_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE dictionary_item_price_snapshot_14120 IS
  'The dictionary_item.default_price values 14120 moved into standard expense rates and then cleared. Kept so the step can be reversed; nothing reads it.';

INSERT INTO dictionary_item_price_snapshot_14120 (dictionary_item_id, default_price, currency)
SELECT di.dictionary_item_id, di.default_price, di.currency
  FROM dictionary_item di
 WHERE di.default_price IS NOT NULL
ON CONFLICT (dictionary_item_id) DO NOTHING;

-- ── 2. Open a standard rate where the item has none ────────────────────────
INSERT INTO expense_rate
  (dictionary_item_id, rate_provider_id, container_type_ref_id, provider_kind,
   rate, currency, effective_from, effective_to, note)
SELECT di.dictionary_item_id, NULL, NULL, NULL,
       di.default_price, COALESCE(di.currency, 'XAF'),
       LEAST(di.created_at::date, CURRENT_DATE), NULL,
       'Carried over from the dictionary''s default price (14120).'
  FROM dictionary_item di
 WHERE di.default_price IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM expense_rate er
      WHERE er.dictionary_item_id = di.dictionary_item_id
        AND er.rate_provider_id IS NULL
        AND er.container_type_ref_id IS NULL
   )
ON CONFLICT DO NOTHING;

-- ── 3. Retire the column's values ──────────────────────────────────────────
UPDATE dictionary_item
   SET default_price = NULL
 WHERE default_price IS NOT NULL;

COMMENT ON COLUMN dictionary_item.default_price IS
  'RETIRED by 14120 — always NULL. An item''s price is its in-force standard expense rate (no carrier, no container type); read it through src/modules/master/expense_rate/standard-rate.sql.js.';

-- DOWN
-- Restore the column from the snapshot, then remove the rates 14120 opened
-- (identified by their note, and only while they are still the untouched
-- original — a rate someone has since superseded is real history and stays).
-- UPDATE dictionary_item di SET default_price = s.default_price
--   FROM dictionary_item_price_snapshot_14120 s
--  WHERE s.dictionary_item_id = di.dictionary_item_id AND di.default_price IS NULL;
-- DELETE FROM expense_rate
--  WHERE note = 'Carried over from the dictionary''s default price (14120).'
--    AND rate_provider_id IS NULL AND container_type_ref_id IS NULL AND effective_to IS NULL;
-- DROP TABLE IF EXISTS dictionary_item_price_snapshot_14120;
