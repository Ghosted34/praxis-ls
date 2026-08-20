-- ============================================================================
-- TENANT DB — 10745 Advance allocation (§3.4, owner-decided).
--
-- THE QUESTION WAS ASKED, NOT GUESSED. Legacy carries `advance_received` on
-- every cost LINE and gives advances a whole tab; ours records an advance per
-- FILE (advance, 0230:38 — cash from a client is a liability drawn down by
-- the final invoice, not an attribute of a cost line; a client advances
-- against the file, not against "Demurrage"). The owner's decision
-- (2026-08-19): advances STAY per file, with OPTIONAL per-item allocation for
-- the case where a client genuinely earmarks money ("this is for demurrage").
--
-- So this table is an EARMARK, not a second copy of the money: each row
-- assigns part of one advance to one dictionary item. The advance row keeps
-- being the single source of the amount received; the allocations must never
-- sum past it (service-enforced — a CHECK cannot see across rows), and a file
-- with no allocations behaves exactly as before.
-- ============================================================================

CREATE TABLE IF NOT EXISTS advance_allocation (
  advance_allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id         uuid NOT NULL REFERENCES advance(advance_id) ON DELETE CASCADE,
  dictionary_item_id uuid NOT NULL REFERENCES dictionary_item(dictionary_item_id),
  amount             numeric(18,2) NOT NULL CHECK (amount > 0),
  note               text,
  created_by         uuid REFERENCES app_user(user_id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_advance_allocation_advance
  ON advance_allocation(advance_id);
CREATE INDEX IF NOT EXISTS ix_advance_allocation_item
  ON advance_allocation(dictionary_item_id);

COMMENT ON TABLE advance_allocation IS
  'Optional earmark of part of a per-file advance onto a cost item (§3.4, owner-decided). The advance stays the single record of money received; allocations never sum past it (service rule).';

-- DOWN
-- Additive only; reversible with no data loss.
--
--   DROP TABLE IF EXISTS advance_allocation;
