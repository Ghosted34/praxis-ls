-- ============================================================================
-- 13910 — Office expenses (MOD-77). Review 16 Sep 2026, item #37.
--
-- WHY A TABLE OF ITS OWN. The office's running costs — rent, electricity,
-- water, internet, stationery, cleaning — had no home. They were either hung
-- off a dossier they have nothing to do with (which corrupts file costing and
-- the client-profitability numbers downstream), or typed straight into the
-- journal, which demands the person paying the water bill know SYSCOHADA
-- account codes. This table records the expense as a business object first;
-- posting to the GL is a separate, explicit act that produces one balanced
-- entry (Dr expense account / Cr treasury) through journal_entry.service,
-- exactly the way debt drawdowns and repayments post.
--
-- WHY expense_coa IS A COLUMN AND NOT A CATEGORY→ACCOUNT MAP IN CODE. The
-- seeded chart has no postable "rent" leaf (622 is a non-postable grouping
-- after 9001), and any map hardcoded here would assume every tenant numbers
-- its chart the way the seeds do — the exact mistake finance-accounts.js
-- documents ('521'). So the row names its own postable expense account,
-- picked in the UI from the tenant's real chart, and `category` stays what it
-- is: an analytics label, not an accounting decision.
--
-- CONSTRAINTS ON A NEW TABLE ARE FINE (the 13791 rule constrains only
-- pre-existing tables — see tests/unit/migration-constraint-ordering.test.js).
--
-- LIFECYCLE. DRAFT → POSTED. A draft can be edited or deleted freely; a posted
-- expense is history (its entry is in the ledger) and can only be corrected by
-- a reversing journal entry, so the service refuses UPDATE/DELETE once
-- entry_id is set. No VOID state: an unposted mistake is deleted, a posted one
-- is reversed — the same two-outcome model the journal itself uses.
-- ============================================================================

CREATE TABLE IF NOT EXISTS office_expense (
  office_expense_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid NOT NULL REFERENCES corporate_entity(entity_id),
  -- Analytics label; the enum lives in the app layer (shared zod + the UI)
  -- so a tenant vocabulary change is a code constant, not a migration.
  category         text NOT NULL,
  label            text NOT NULL,
  supplier_id      uuid REFERENCES supplier_master(supplier_id),
  expense_date     date NOT NULL DEFAULT CURRENT_DATE,
  amount           numeric(18,2) NOT NULL CHECK (amount > 0),
  currency         char(3) NOT NULL DEFAULT 'XAF' REFERENCES currency(code),
  -- The postable account this expense debits when posted. Named per row (see
  -- header); validated postable by assert_line_valid at posting time.
  expense_coa      text NOT NULL REFERENCES chart_of_accounts(code),
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED')),
  entry_id         uuid REFERENCES journal_entry(entry_id),
  notes            text,
  created_by       uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_office_expense_entity_date
  ON office_expense(entity_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS ix_office_expense_status
  ON office_expense(status);

COMMENT ON TABLE office_expense IS
  'MOD-77 — office running costs (rent, utilities, supplies…), recorded as business objects and posted to the GL explicitly (13910, review #37).';
COMMENT ON COLUMN office_expense.expense_coa IS
  'Postable expense account this row debits when posted — named per row because no hardcoded category map survives a tenant renumbering its chart.';

-- ── Event catalogue (emitEvent requires a catalogued key; 0120 model) ───────
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('office_expense.created', 'MOD-77', 'Office expense recorded', false, false),
 ('office_expense.updated', 'MOD-77', 'Office expense updated',  false, false),
 ('office_expense.posted',  'MOD-77', 'Office expense posted to the ledger', false, false),
 ('office_expense.deleted', 'MOD-77', 'Office expense draft deleted', false, false)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- DROP TABLE IF EXISTS office_expense;
-- DELETE FROM event_type WHERE key LIKE 'office_expense.%';
