-- ============================================================================
-- TENANT DB — 12774 Chasing an approver, without becoming a nuisance.
--
-- THE PROBLEM THIS SOLVES. A cash request cannot be funded until its file's
-- costing is APPROVED_LOCKED (12771, owner decision Q4). So a requester whose
-- costing is sitting in somebody's queue is blocked by a person, not by the
-- software — and had no way to say so except to walk to their desk. The cash
-- request screen now offers "Notify the approver" on the spot.
--
-- AND WHY IT IS RATIONED. The owner's instruction, verbatim: *"we can notify
-- just thrice a day. No more! To avoid mounting pressure on CEO."* A reminder
-- button with no ceiling is a button that gets pressed until it is ignored, and
-- the person it is aimed at is usually the one with the least slack.
--
-- THE QUOTA IS PER COSTING PER DAY, not per recipient. A director with ten
-- sheets waiting has ten real decisions to make and should hear about each; what
-- must not happen is one sheet arriving eleven times. Keying on the recipient
-- would also mean a noisy file silently spends everyone else's quota, which is
-- the failure mode that makes a control feel arbitrary.
--
-- `sent_on` is a DATE and the day is the tenant's, not UTC — the count resets
-- at local midnight, which is what "three times a day" means to the person
-- pressing the button. It is stored rather than derived from created_at so the
-- quota index is a plain b-tree on a stored column.
-- ============================================================================

CREATE TABLE IF NOT EXISTS costing_nudge (
  costing_nudge_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  costing_id        uuid NOT NULL REFERENCES costing(costing_id) ON DELETE CASCADE,
  -- Who was chased. NULL is possible and is not an error: a step assigned to a
  -- ROLE rather than a person notifies everyone holding it, and the row records
  -- that the nudge happened even where no single user owns it.
  recipient_user_id uuid REFERENCES app_user(user_id),
  -- Which queue it was sitting in. A sheet can be chased at validation and
  -- again at approval; they are different asks of different people.
  stage             text NOT NULL CHECK (stage IN ('VALIDATION','APPROVAL')),
  sent_by           uuid REFERENCES app_user(user_id),
  sent_on           date NOT NULL DEFAULT current_date,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- The quota read: "how many times has THIS sheet been chased TODAY". Leading
-- column first so the index serves the count and the audit list alike.
CREATE INDEX IF NOT EXISTS ix_costing_nudge_quota
  ON costing_nudge (costing_id, sent_on);

COMMENT ON TABLE costing_nudge IS
  'One row per reminder sent about a pending costing. Rationed to 3 per costing per day (12774) — the ceiling lives in costing.rules.NUDGE_DAILY_LIMIT, this table is the count.';
COMMENT ON COLUMN costing_nudge.sent_on IS
  'Local date the reminder was sent. The quota window; resets at local midnight.';

-- ============================================================================
-- VERIFY
--   SELECT costing_id, sent_on, count(*) FROM costing_nudge
--    GROUP BY 1, 2 HAVING count(*) > 3;
--     -- expect no rows: the service refuses the fourth send of a day.
--
-- DOWN
--   -- Safe: the table is an audit of reminders, not of decisions. Dropping it
--   -- resets every quota to full rather than losing anything a document says.
--   -- DROP TABLE IF EXISTS costing_nudge;
-- ============================================================================
