-- ============================================================================
-- TENANT DB — 10709 treasury reconciliation engine (MOD-09).
--
-- WHAT THIS IS
--
-- The "declared external truth vs our ledger" spine, for every treasury
-- account type — bank, mobile money, and cash — behind one set of tables.
--
-- THE SHAPE OF THE PROBLEM
--
-- A treasurer holds two records of the same money. Ours: `journal_line` rows
-- on the account's auto-minted class-5 CoA leaf (0520). Theirs: a statement
-- the bank issued, a CSV the MoMo merchant portal exported, or — for petty
-- cash, where no third party issues anything — a physical count. Reconciliation
-- is the act of proving those two agree, and explaining every line that does
-- not.
--
-- Four design decisions are baked into this schema. Each one exists because the
-- obvious alternative fails in a specific, known way.
--
-- ── 1. THE IMPORT NEVER TOUCHES THE LEDGER ──────────────────────────────────
--
-- There is no foreign key from `journal_line` to anything here, and nothing in
-- this migration adds a column to `journal_line`. A statement import cannot
-- write to the books, by construction rather than by discipline.
--
-- "Is this journal line reconciled?" is therefore a question answered by
-- `reconciliation_match`, not by a flag on the ledger. That costs one index
-- lookup and buys the property that the accounting spine (0220/0221/0464/0499)
-- keeps exactly the invariants it already has. Postings that a statement
-- reveals we never made (bank charges, interest, a receipt nobody recorded)
-- become DRAFT `journal_entry` rows through the ordinary posting path, with
-- `source_doc_ref` pointing back at the statement line, and they clear the
-- ordinary issuer→validator→approver gate. The reconciler proposes; the
-- existing approval chain disposes.
--
-- ── 2. THE RAW FILE AND THE RAW ROW ARE IMMUTABLE ───────────────────────────
--
-- `bank_statement.file_hash` is the SHA-256 of the bytes we were handed, and
-- `bank_statement_line.raw` is the untouched source record as jsonb. Every
-- normalised column beside `raw` is derived, and can be RE-derived by replaying
-- the profile over `raw` if a mapping turns out to have been wrong. Without
-- that, a bad mapping is unrecoverable without asking the treasurer to find the
-- file again — and the file is the one thing they will not still have.
--
-- ── 3. TWO DIFFERENT DUPLICATE GUARDS, BECAUSE THERE ARE TWO DUPLICATES ─────
--
-- FILE-level: `ux_statement_file` — the same bytes cannot be imported twice
-- into the same treasury account. This catches the double-click and the
-- "did that upload work?" re-send.
--
-- ROW-level: `ux_statement_row` — the same transaction cannot enter twice
-- across DIFFERENT files. This is the one that actually bites. Statement
-- periods overlap at boundaries constantly (a treasurer pulls 1–31 Jan, then
-- 28 Jan–28 Feb), and without a row guard the overlap silently double-counts.
-- `row_hash` is computed in the service from the natural key of the transaction
-- (date + signed amount + normalised description + the bank's own reference
-- where it gave one), NOT from the row's position in the file.
--
-- ── 4. THE STATEMENT MUST FOOT BEFORE ANYTHING IS RECONCILABLE ──────────────
--
-- `chk_statement_foots` is not a nicety. A statement whose declared closing
-- balance does not equal its declared opening balance plus the sum of its lines
-- has been mis-parsed — a dropped row, a sign convention read backwards, a
-- thousands separator eaten as a decimal point. Every one of those failures is
-- silent and produces a plausible-looking reconciliation. Arithmetic catches
-- all of them at once, before a human wastes an afternoon.
--
-- A statement may therefore sit in PARSED with `foots = false` and be examined,
-- but it cannot reach VALIDATED, and only a VALIDATED statement can be matched
-- against the ledger.
--
-- ADDITIVE ONLY. Every statement here is CREATE TABLE IF NOT EXISTS / CREATE
-- INDEX IF NOT EXISTS / a guarded constraint add. Idempotent — safe to re-run.
--
-- SCHEMA-DUAL. Like every tenant migration this runs UNQUALIFIED, once per
-- schema (live, then sandbox). See migrations/tenant/0001_extensions.sql and
-- doc/DB_ARCHITECTURE.md.
-- ============================================================================

-- ── §1  statement_profile — how to read one institution's file ──────────────
--
-- The answer to "the column names are unsure, the format and all".
--
-- We do not guess a column layout on every import. We guess ONCE, a human
-- confirms it against a live preview of the parsed values, and the confirmed
-- answer is stored against a fingerprint of the file's header. The second file
-- from that bank asks nothing.
--
-- `header_signature` is that fingerprint: a hash of the header cells after
-- case-folding, accent-stripping and whitespace collapsing. Case and spacing
-- drift between exports; the meaning does not. If a bank genuinely changes its
-- export layout the signature changes with it, and the engine re-asks rather
-- than mapping the new file with the old answer — which is the failure mode
-- that makes "smart" importers untrustworthy.
--
-- Scoped to `entity_id`, not to a treasury account: one Afriland profile serves
-- every Afriland account the entity holds.
CREATE TABLE IF NOT EXISTS statement_profile (
  statement_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid NOT NULL REFERENCES corporate_entity(entity_id),

  -- Which parser produced the rows this map applies to.
  source_kind      text NOT NULL
    CHECK (source_kind IN ('CSV','XLSX','PDF','CAMT053','MT940','MANUAL')),

  -- Free text, treasurer-supplied: 'Afriland First Bank', 'MTN MoMo Business'.
  -- Deliberately not an FK — the institution registry that would justify one
  -- does not exist, and inventing it here would block this feature on it.
  institution      text,
  label            text NOT NULL,

  -- The fingerprint. NULL for CAMT053/MT940, which are self-describing and
  -- need no map at all — those rows exist only to record the institution.
  header_signature text,

  -- The map itself: our canonical field -> the source column name/index.
  -- Canonical fields are declared in reconciliation.rules.js (CANONICAL_FIELDS)
  -- and validated there, so adding one is a code change in one place.
  column_map       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- How to read the values the map points at.
  --   SIGNED_AMOUNT        one column, negative = money out
  --   DEBIT_CREDIT_COLUMNS two columns, at most one populated per row
  --   AMOUNT_WITH_INDICATOR one amount column + a D/C marker column
  sign_convention  text NOT NULL DEFAULT 'DEBIT_CREDIT_COLUMNS'
    CHECK (sign_convention IN ('SIGNED_AMOUNT','DEBIT_CREDIT_COLUMNS','AMOUNT_WITH_INDICATOR')),
  debit_indicators  text[] NOT NULL DEFAULT ARRAY['D','DR','DEBIT','DEBIT(-)']::text[],

  -- Locale. CEMAC exports are overwhelmingly French-locale: '1 234 567,89'.
  -- Read with the anglophone assumption that becomes 1.23456789 and the
  -- statement stops footing — which is exactly what §4 is there to catch.
  date_format      text NOT NULL DEFAULT 'DD/MM/YYYY',
  decimal_separator char(1) NOT NULL DEFAULT ',',
  thousands_separator text NOT NULL DEFAULT ' ',
  encoding         text NOT NULL DEFAULT 'utf-8',
  delimiter        text,                          -- CSV only; NULL = sniff

  -- Where the table starts. Portal exports routinely put account details,
  -- a logo row and a blank line above the real header.
  header_row_index integer NOT NULL DEFAULT 1 CHECK (header_row_index >= 1),
  data_start_row   integer CHECK (data_start_row IS NULL OR data_start_row >= 1),

  -- Provenance of the map. `proposed_by_ai` records that a model drafted it;
  -- `confirmed_by` records that a human took responsibility for it. A profile
  -- is only usable once confirmed — see chk_profile_confirmed.
  proposed_by_ai   boolean NOT NULL DEFAULT false,
  ai_confidence    numeric(5,4) CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  confirmed_by     uuid REFERENCES app_user(user_id),
  confirmed_at     timestamptz,

  version          integer NOT NULL DEFAULT 1,
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- A profile is either a draft proposal or a human-owned answer. There is no
-- third state in which the engine parses money using a map nobody accepted.
DO $$ BEGIN
  ALTER TABLE statement_profile DROP CONSTRAINT IF EXISTS chk_profile_confirmed;
  ALTER TABLE statement_profile
    ADD CONSTRAINT chk_profile_confirmed
    CHECK (confirmed_at IS NULL OR confirmed_by IS NOT NULL);
END $$;

-- One ACTIVE profile per (entity, source kind, header signature). Superseding a
-- profile deactivates the old row rather than updating it, so a statement
-- imported last year still points at the map that actually parsed it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_statement_profile_signature
  ON statement_profile (entity_id, source_kind, header_signature)
  WHERE is_active = true AND header_signature IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_statement_profile_entity
  ON statement_profile (entity_id, is_active);

CREATE OR REPLACE TRIGGER trg_statement_profile_updated
  BEFORE UPDATE ON statement_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── §2  bank_statement — one imported file, one period ──────────────────────
--
-- Named `bank_statement` and not `statement` because `statement` is a reserved
-- word in enough tooling to be a nuisance; the table serves MoMo exports too.
CREATE TABLE IF NOT EXISTS bank_statement (
  statement_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treasury_account_id uuid NOT NULL REFERENCES treasury_account(treasury_account_id),
  entity_id        uuid NOT NULL REFERENCES corporate_entity(entity_id),
  statement_profile_id uuid REFERENCES statement_profile(statement_profile_id),

  source_kind      text NOT NULL
    CHECK (source_kind IN ('CSV','XLSX','PDF','CAMT053','MT940','MANUAL')),

  -- The bytes we were handed. `file_hash` is SHA-256 over the raw upload; the
  -- vault row (0340) holds the file itself so the auditor can be shown the
  -- document the numbers came from — Art. 22's source-document requirement
  -- applies to a reconciliation as much as to an entry.
  file_name        text,
  file_hash        text NOT NULL,
  file_size        integer CHECK (file_size IS NULL OR file_size >= 0),
  vault_doc_id     uuid REFERENCES document_vault(doc_id),

  -- The period the STATEMENT declares, not the period we inferred from rows.
  -- Divergence between the two is itself a finding (a truncated export).
  period_start     date,
  period_end       date,
  currency         char(3) NOT NULL DEFAULT 'XAF',

  -- The two balances the statement asserts. Both nullable because a portal CSV
  -- frequently carries neither, in which case footing falls back to the running
  -- balance column when there is one, and is skipped when there is not — with
  -- `foots` staying NULL to record that we could not check rather than
  -- pretending we did.
  opening_balance_declared numeric(18,2),
  closing_balance_declared numeric(18,2),

  line_count       integer NOT NULL DEFAULT 0 CHECK (line_count >= 0),
  duplicate_count  integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),

  -- §4. NULL = not checkable (no declared balances and no running balance).
  foots            boolean,
  footing_difference numeric(18,2),

  status           text NOT NULL DEFAULT 'UPLOADED'
    CHECK (status IN ('UPLOADED','NEEDS_MAPPING','PARSED','VALIDATED','RECONCILING','RECONCILED','CLOSED','REJECTED')),
  reject_reason    text,

  imported_by      uuid REFERENCES app_user(user_id),
  imported_at      timestamptz NOT NULL DEFAULT now(),
  validated_by     uuid REFERENCES app_user(user_id),
  validated_at     timestamptz,
  closed_by        uuid REFERENCES app_user(user_id),
  closed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- §3, file level. Same bytes, same account, once.
CREATE UNIQUE INDEX IF NOT EXISTS ux_statement_file
  ON bank_statement (treasury_account_id, file_hash);

CREATE INDEX IF NOT EXISTS ix_statement_account_period
  ON bank_statement (treasury_account_id, period_start DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS ix_statement_status
  ON bank_statement (status);
CREATE INDEX IF NOT EXISTS ix_statement_entity
  ON bank_statement (entity_id);
CREATE INDEX IF NOT EXISTS ix_statement_profile
  ON bank_statement (statement_profile_id) WHERE statement_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_statement_vault
  ON bank_statement (vault_doc_id) WHERE vault_doc_id IS NOT NULL;

-- §4. A statement that has not been shown to foot cannot be advanced past
-- PARSED. `foots IS NULL` (uncheckable) is allowed through deliberately — a
-- portal CSV with no balances anywhere is still worth reconciling, and blocking
-- it would push the treasurer back to Excel, which checks nothing at all.
DO $$ BEGIN
  ALTER TABLE bank_statement DROP CONSTRAINT IF EXISTS chk_statement_foots;
  ALTER TABLE bank_statement
    ADD CONSTRAINT chk_statement_foots
    CHECK (
      status IN ('UPLOADED','NEEDS_MAPPING','PARSED','REJECTED')
      OR foots IS NOT false
    );
END $$;

-- Coherence: a period is a period.
DO $$ BEGIN
  ALTER TABLE bank_statement DROP CONSTRAINT IF EXISTS chk_statement_period_order;
  ALTER TABLE bank_statement
    ADD CONSTRAINT chk_statement_period_order
    CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end);
END $$;

DO $$ BEGIN
  ALTER TABLE bank_statement DROP CONSTRAINT IF EXISTS chk_statement_validated_stamped;
  ALTER TABLE bank_statement
    ADD CONSTRAINT chk_statement_validated_stamped
    CHECK (validated_at IS NULL OR validated_by IS NOT NULL);
END $$;

CREATE OR REPLACE TRIGGER trg_bank_statement_updated
  BEFORE UPDATE ON bank_statement
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── §3  bank_statement_line — the external truth, one row per transaction ───
CREATE TABLE IF NOT EXISTS bank_statement_line (
  statement_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id     uuid NOT NULL REFERENCES bank_statement(statement_id) ON DELETE CASCADE,
  -- Denormalised from the parent so the row-level duplicate guard and every
  -- "unmatched on this account" query work without a join. The service writes
  -- both from one source.
  treasury_account_id uuid NOT NULL REFERENCES treasury_account(treasury_account_id),

  row_index        integer NOT NULL,
  -- §2. The source record, untouched. Everything below is derived from this
  -- through the profile, and can be re-derived.
  raw              jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Booking date is when the bank posted it; value date is when it earns
  -- interest. Matching uses booking date and falls back to value date, because
  -- a bank that gives only one almost always gives booking.
  booking_date     date NOT NULL,
  value_date       date,

  -- SIGNED, always, whatever the source convention was: positive = money INTO
  -- the account. For the class-5 asset leaf that is a DEBIT. Normalising the
  -- sign here rather than at read time means the matcher, the footing check and
  -- the running-balance check all agree by construction.
  amount           numeric(18,2) NOT NULL,
  currency         char(3) NOT NULL DEFAULT 'XAF',

  -- The fee the provider deducted on this transaction, as a POSITIVE number.
  -- Mobile money's defining difference from a bank: MTN and Orange take a cut
  -- per transaction, and it must land in the account's `momo_fee_account`
  -- (631x) rather than being netted silently into the movement. Zero for banks
  -- that charge periodically instead.
  fee_amount       numeric(18,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),

  description      text,
  counterparty     text,               -- payer/payee name, or MoMo phone number
  -- The institution's own identifier. A MoMo Financial Transaction ID or a
  -- cheque number is a STRONG key and gets its own matching tier; a bank
  -- narrative reference is weaker but still worth trying.
  external_ref     text,
  cheque_no        text,
  running_balance  numeric(18,2),      -- balance after this line, where given

  -- §3, row level. SHA-256 of the transaction's natural key, computed in the
  -- service (reconciliation.rules.rowHash) — never of the row's position.
  row_hash         text NOT NULL,

  match_status     text NOT NULL DEFAULT 'UNMATCHED'
    CHECK (match_status IN ('UNMATCHED','SUGGESTED','MATCHED','PARTIAL','IGNORED','POSTED')),
  -- How much of `amount` is covered by CONFIRMED matches. Maintained by the
  -- service inside the same transaction as the match it reflects.
  matched_amount   numeric(18,2) NOT NULL DEFAULT 0,

  -- Set when this row was rejected as a re-import of a transaction already
  -- present from another file. The row is KEPT (so the import's line count
  -- still reconciles against the file) but excluded from matching.
  duplicate_of     uuid REFERENCES bank_statement_line(statement_line_id),

  -- The DRAFT entry proposed for this line when nothing in the ledger matched.
  -- Nullable and unconstrained in status: the entry lives its own life through
  -- the approval chain, and this is only the pointer back.
  proposed_entry_id uuid REFERENCES journal_entry(entry_id),

  ignored_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- §3, row level. The guard that stops overlapping statement periods
-- double-counting. Scoped to the ACCOUNT, not the statement — the whole point
-- is to catch a row arriving in a second file.
CREATE UNIQUE INDEX IF NOT EXISTS ux_statement_row
  ON bank_statement_line (treasury_account_id, row_hash)
  WHERE duplicate_of IS NULL;

CREATE INDEX IF NOT EXISTS ix_statement_line_statement
  ON bank_statement_line (statement_id, row_index);
-- The matcher's main sweep: unmatched lines on an account within a date window.
CREATE INDEX IF NOT EXISTS ix_statement_line_match_sweep
  ON bank_statement_line (treasury_account_id, match_status, booking_date);
CREATE INDEX IF NOT EXISTS ix_statement_line_ref
  ON bank_statement_line (treasury_account_id, external_ref)
  WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_statement_line_amount
  ON bank_statement_line (treasury_account_id, amount);
CREATE INDEX IF NOT EXISTS ix_statement_line_duplicate
  ON bank_statement_line (duplicate_of) WHERE duplicate_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_statement_line_proposed_entry
  ON bank_statement_line (proposed_entry_id) WHERE proposed_entry_id IS NOT NULL;

-- A zero-amount movement is not a movement. Banks do emit them (an advice, a
-- rejected instruction); they are noise in a reconciliation and must be
-- imported as IGNORED rather than matched against anything.
DO $$ BEGIN
  ALTER TABLE bank_statement_line DROP CONSTRAINT IF EXISTS chk_statement_line_nonzero;
  ALTER TABLE bank_statement_line
    ADD CONSTRAINT chk_statement_line_nonzero
    CHECK (amount <> 0 OR match_status = 'IGNORED');
END $$;

-- Matched amount can never exceed the line, and never flips its sign.
DO $$ BEGIN
  ALTER TABLE bank_statement_line DROP CONSTRAINT IF EXISTS chk_statement_line_matched_bound;
  ALTER TABLE bank_statement_line
    ADD CONSTRAINT chk_statement_line_matched_bound
    CHECK (abs(matched_amount) <= abs(amount) AND (matched_amount = 0 OR sign(matched_amount) = sign(amount)));
END $$;

-- A row cannot be its own duplicate.
DO $$ BEGIN
  ALTER TABLE bank_statement_line DROP CONSTRAINT IF EXISTS chk_statement_line_self_dup;
  ALTER TABLE bank_statement_line
    ADD CONSTRAINT chk_statement_line_self_dup
    CHECK (duplicate_of IS NULL OR duplicate_of <> statement_line_id);
END $$;

CREATE OR REPLACE TRIGGER trg_statement_line_updated
  BEFORE UPDATE ON bank_statement_line
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── §4  reconciliation_match — the join, and the only place a match exists ──
--
-- Many-to-many on purpose. The three real shapes:
--   1:1  one statement line ↔ one journal line (the common case)
--   1:N  one lodgement of five cheques ↔ five receipt postings
--   N:1  a bank charge split across several dossiers ↔ one statement line
-- A one-to-one column on either side would model the first and lose the others,
-- and the treasurer would be back in Excel for exactly the awkward cases that
-- take the time.
CREATE TABLE IF NOT EXISTS reconciliation_match (
  match_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_line_id uuid NOT NULL REFERENCES bank_statement_line(statement_line_id) ON DELETE CASCADE,
  journal_line_id  uuid NOT NULL REFERENCES journal_line(line_id),
  treasury_account_id uuid NOT NULL REFERENCES treasury_account(treasury_account_id),

  -- The portion of the statement line this pairing accounts for, signed the
  -- same way as the line. For a plain 1:1 it is the whole amount.
  amount           numeric(18,2) NOT NULL CHECK (amount <> 0),

  -- WHY the engine believes these are the same money. `tier` is the rung of the
  -- deterministic ladder in reconciliation.rules.js (1 = exact reference hit,
  -- ascending = weaker); `confidence` is that tier's score after the date and
  -- name adjustments. Both are recorded so a reconciliation can be EXPLAINED to
  -- an auditor a year later, not merely asserted.
  tier             smallint NOT NULL CHECK (tier BETWEEN 1 AND 9),
  confidence       numeric(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  method           text NOT NULL,
  reasons          jsonb NOT NULL DEFAULT '[]'::jsonb,

  status           text NOT NULL DEFAULT 'SUGGESTED'
    CHECK (status IN ('SUGGESTED','CONFIRMED','REJECTED')),

  suggested_at     timestamptz NOT NULL DEFAULT now(),
  confirmed_by     uuid REFERENCES app_user(user_id),
  confirmed_at     timestamptz,
  rejected_by      uuid REFERENCES app_user(user_id),
  rejected_at      timestamptz,
  reject_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One pairing per (statement line, journal line) — re-running the matcher
-- refreshes a suggestion, it does not stack duplicates of it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_recon_match_pair
  ON reconciliation_match (statement_line_id, journal_line_id);

-- THE INVARIANT THAT MATTERS: a journal line can be CONFIRMED-matched exactly
-- once. Without this, the same ledger posting can be used to explain two
-- different statement lines and the account appears to reconcile while being
-- short by the amount of the posting that was counted twice. SUGGESTED rows are
-- deliberately outside the guard — the engine is allowed to offer a journal
-- line as a candidate for several statement lines, and the human picks one.
CREATE UNIQUE INDEX IF NOT EXISTS ux_recon_match_journal_once
  ON reconciliation_match (journal_line_id)
  WHERE status = 'CONFIRMED';

CREATE INDEX IF NOT EXISTS ix_recon_match_line
  ON reconciliation_match (statement_line_id, status);
CREATE INDEX IF NOT EXISTS ix_recon_match_journal
  ON reconciliation_match (journal_line_id);
CREATE INDEX IF NOT EXISTS ix_recon_match_account
  ON reconciliation_match (treasury_account_id, status);

DO $$ BEGIN
  ALTER TABLE reconciliation_match DROP CONSTRAINT IF EXISTS chk_recon_match_stamped;
  ALTER TABLE reconciliation_match
    ADD CONSTRAINT chk_recon_match_stamped
    CHECK (
      (status <> 'CONFIRMED' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
      AND (status <> 'REJECTED' OR (rejected_by IS NOT NULL AND rejected_at IS NOT NULL))
    );
END $$;

CREATE OR REPLACE TRIGGER trg_recon_match_updated
  BEFORE UPDATE ON reconciliation_match
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── §5  reconciliation — the état de rapprochement bancaire itself ──────────
--
-- The deliverable. Not the matching UI's internal state: the signed document an
-- auditor asks for and the DSF file keeps. It reconciles two balances through
-- the outstanding items that explain their difference:
--
--   ledger_balance
--     + deposits_in_transit      (we booked it, the bank has not yet)
--     - outstanding_payments     (we booked it, the payee has not presented it)
--     + unrecorded_credits       (the bank has it, we have not booked it)
--     - unrecorded_debits        (charges/fees we had not booked)
--     = statement_balance        ... and `unexplained_difference` is whatever
--                                    that identity fails to close.
--
-- APPROVED_LOCKED requires `unexplained_difference = 0`. A reconciliation that
-- does not reconcile is a draft, however tired the accountant is.
CREATE TABLE IF NOT EXISTS reconciliation (
  reconciliation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treasury_account_id uuid NOT NULL REFERENCES treasury_account(treasury_account_id),
  entity_id        uuid NOT NULL REFERENCES corporate_entity(entity_id),
  statement_id     uuid REFERENCES bank_statement(statement_id),
  period_id        uuid REFERENCES accounting_period(period_id),

  period_start     date NOT NULL,
  period_end       date NOT NULL,
  currency         char(3) NOT NULL DEFAULT 'XAF',

  ledger_balance   numeric(18,2) NOT NULL DEFAULT 0,
  statement_balance numeric(18,2) NOT NULL DEFAULT 0,

  deposits_in_transit  numeric(18,2) NOT NULL DEFAULT 0,
  outstanding_payments numeric(18,2) NOT NULL DEFAULT 0,
  unrecorded_credits   numeric(18,2) NOT NULL DEFAULT 0,
  unrecorded_debits    numeric(18,2) NOT NULL DEFAULT 0,
  unexplained_difference numeric(18,2) NOT NULL DEFAULT 0,

  matched_count    integer NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
  unmatched_statement_count integer NOT NULL DEFAULT 0 CHECK (unmatched_statement_count >= 0),
  unmatched_ledger_count    integer NOT NULL DEFAULT 0 CHECK (unmatched_ledger_count >= 0),

  -- Standard lifecycle vocabulary, per doc/BUILD_CONVENTIONS.md §1.
  status           text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SUBMITTED_FOR_VALIDATION','SUBMITTED_FOR_APPROVAL','APPROVED_LOCKED','CANCELLED')),

  -- Numbered + vaulted like every other issued document (§3 of the same doc).
  doc_number       text,
  content_hash     text,
  vault_doc_id     uuid REFERENCES document_vault(doc_id),

  notes            text,
  prepared_by      uuid REFERENCES app_user(user_id),
  prepared_at      timestamptz,
  validated_by     uuid REFERENCES app_user(user_id),
  validated_at     timestamptz,
  approved_by      uuid REFERENCES app_user(user_id),
  approved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_recon_account_period
  ON reconciliation (treasury_account_id, period_end DESC);
CREATE INDEX IF NOT EXISTS ix_recon_status ON reconciliation (status);
CREATE INDEX IF NOT EXISTS ix_recon_statement
  ON reconciliation (statement_id) WHERE statement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_recon_entity ON reconciliation (entity_id);
CREATE INDEX IF NOT EXISTS ix_recon_period
  ON reconciliation (period_id) WHERE period_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_recon_vault
  ON reconciliation (vault_doc_id) WHERE vault_doc_id IS NOT NULL;

-- One open reconciliation per account per period end. Re-running it updates the
-- draft; it does not breed drafts.
CREATE UNIQUE INDEX IF NOT EXISTS ux_recon_open_period
  ON reconciliation (treasury_account_id, period_end)
  WHERE status <> 'CANCELLED';

DO $$ BEGIN
  ALTER TABLE reconciliation DROP CONSTRAINT IF EXISTS chk_recon_period_order;
  ALTER TABLE reconciliation
    ADD CONSTRAINT chk_recon_period_order CHECK (period_start <= period_end);
END $$;

-- The rule the whole table exists to enforce.
DO $$ BEGIN
  ALTER TABLE reconciliation DROP CONSTRAINT IF EXISTS chk_recon_approved_balances;
  ALTER TABLE reconciliation
    ADD CONSTRAINT chk_recon_approved_balances
    CHECK (status <> 'APPROVED_LOCKED' OR unexplained_difference = 0);
END $$;

DO $$ BEGIN
  ALTER TABLE reconciliation DROP CONSTRAINT IF EXISTS chk_recon_approved_stamped;
  ALTER TABLE reconciliation
    ADD CONSTRAINT chk_recon_approved_stamped
    CHECK (status <> 'APPROVED_LOCKED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL));
END $$;

CREATE OR REPLACE TRIGGER trg_reconciliation_updated
  BEFORE UPDATE ON reconciliation
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── §6  cash_count — reconciliation for accounts nobody issues a statement for
--
-- Petty cash has the same shape as a bank reconciliation and none of its
-- inputs. No third party will ever send a statement for the tin in the drawer,
-- so the external truth is a PHYSICAL COUNT, attested by the custodian
-- (`treasury_account.custodian_user_id`, 0520) and ideally witnessed.
--
-- It belongs in this migration rather than its own because the question is
-- identical — "does the declared external truth agree with our ledger, and if
-- not, why" — and because a treasurer looking at the Reconciliation surface
-- should see every account they are responsible for, not the subset that
-- happens to bank somewhere.
--
-- `denominations` is the count sheet: [{"note": 10000, "qty": 14}, …]. Kept as
-- jsonb because CEMAC franc denominations are a fact about the currency, not
-- about this schema, and a tenant operating in a second currency should not
-- need a migration to count it.
CREATE TABLE IF NOT EXISTS cash_count (
  cash_count_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treasury_account_id uuid NOT NULL REFERENCES treasury_account(treasury_account_id),
  entity_id        uuid NOT NULL REFERENCES corporate_entity(entity_id),

  counted_on       date NOT NULL DEFAULT CURRENT_DATE,
  currency         char(3) NOT NULL DEFAULT 'XAF',
  denominations    jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- What was physically there, what the books say, and the gap. `difference` is
  -- generated rather than supplied: a count sheet whose arithmetic is written
  -- by the person being counted is not a control.
  counted_total    numeric(18,2) NOT NULL CHECK (counted_total >= 0),
  ledger_balance   numeric(18,2) NOT NULL DEFAULT 0,
  difference       numeric(18,2) GENERATED ALWAYS AS (counted_total - ledger_balance) STORED,
  -- Set when the float has drifted past treasury_account.float_limit — the
  -- signal the custodian card on the 360 shows.
  over_float_limit boolean NOT NULL DEFAULT false,

  custodian_user_id uuid REFERENCES app_user(user_id),
  witness_user_id  uuid REFERENCES app_user(user_id),
  attested_at      timestamptz,

  -- A shortfall is a finding, not a rounding. It stays on the record and gets
  -- an explanation, and the adjusting entry (if any) goes through the same
  -- propose→approve path as everything else.
  variance_reason  text,
  adjustment_entry_id uuid REFERENCES journal_entry(entry_id),

  status           text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','ATTESTED','APPROVED_LOCKED','CANCELLED')),
  counted_by       uuid REFERENCES app_user(user_id),
  approved_by      uuid REFERENCES app_user(user_id),
  approved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_cash_count_account
  ON cash_count (treasury_account_id, counted_on DESC);
CREATE INDEX IF NOT EXISTS ix_cash_count_status ON cash_count (status);
CREATE INDEX IF NOT EXISTS ix_cash_count_entity ON cash_count (entity_id);
CREATE INDEX IF NOT EXISTS ix_cash_count_custodian
  ON cash_count (custodian_user_id) WHERE custodian_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cash_count_adjustment
  ON cash_count (adjustment_entry_id) WHERE adjustment_entry_id IS NOT NULL;

-- One count per account per day. A second count on the same day is a re-count,
-- which corrects the row; it is not a second independent observation.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_count_day
  ON cash_count (treasury_account_id, counted_on)
  WHERE status <> 'CANCELLED';

-- An attestation without an attester is not one. This is the control the whole
-- table exists to record, so it is a constraint and not a service-layer check.
DO $$ BEGIN
  ALTER TABLE cash_count DROP CONSTRAINT IF EXISTS chk_cash_count_attested;
  ALTER TABLE cash_count
    ADD CONSTRAINT chk_cash_count_attested
    CHECK (status = 'DRAFT' OR status = 'CANCELLED'
           OR (attested_at IS NOT NULL AND custodian_user_id IS NOT NULL));
END $$;

-- Segregation of duties: the custodian cannot be their own witness.
DO $$ BEGIN
  ALTER TABLE cash_count DROP CONSTRAINT IF EXISTS chk_cash_count_witness_distinct;
  ALTER TABLE cash_count
    ADD CONSTRAINT chk_cash_count_witness_distinct
    CHECK (witness_user_id IS NULL OR custodian_user_id IS NULL OR witness_user_id <> custodian_user_id);
END $$;

-- A variance that is not explained cannot be locked away.
DO $$ BEGIN
  ALTER TABLE cash_count DROP CONSTRAINT IF EXISTS chk_cash_count_variance_explained;
  ALTER TABLE cash_count
    ADD CONSTRAINT chk_cash_count_variance_explained
    CHECK (status <> 'APPROVED_LOCKED'
           OR counted_total = ledger_balance
           OR (variance_reason IS NOT NULL AND btrim(variance_reason) <> ''));
END $$;

CREATE OR REPLACE TRIGGER trg_cash_count_updated
  BEFORE UPDATE ON cash_count
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── §7  Column commentary the schema browser will show ──────────────────────
COMMENT ON TABLE  statement_profile IS
  'How to read one institution''s statement export. Proposed once (optionally by AI), confirmed by a human, then reused by header signature so the same bank is never re-guessed.';
COMMENT ON COLUMN statement_profile.header_signature IS
  'Hash of the case-folded, accent-stripped, whitespace-collapsed header cells. A changed layout changes this and re-triggers confirmation instead of silently mis-mapping.';
COMMENT ON TABLE  bank_statement IS
  'One imported statement file (bank, MoMo or manual) for one treasury account. The raw bytes are hashed and vaulted; every derived number can be recomputed from bank_statement_line.raw.';
COMMENT ON COLUMN bank_statement.foots IS
  'Declared closing = declared opening + SUM(lines). NULL when the source declared no balances and carried no running balance, i.e. we could not check rather than we checked and it passed.';
COMMENT ON TABLE  bank_statement_line IS
  'One external transaction. `amount` is always signed with positive = money into the account, whatever convention the source used.';
COMMENT ON COLUMN bank_statement_line.row_hash IS
  'SHA-256 of the transaction natural key (date + signed amount + normalised description + institution reference). Guards against re-importing the same transaction from an overlapping statement period.';
COMMENT ON COLUMN bank_statement_line.fee_amount IS
  'Provider fee deducted on this transaction, positive. Mobile money charges per transaction and the fee posts to treasury_account.momo_fee_account (631x) rather than being netted into the movement.';
COMMENT ON TABLE  reconciliation_match IS
  'The only place a match exists — there is no reconciled flag on journal_line. Many-to-many so a lodgement of several cheques, or a charge split across dossiers, models correctly.';
COMMENT ON INDEX  ux_recon_match_journal_once IS
  'A journal line can be CONFIRMED-matched exactly once. Without it the same posting can explain two statement lines and the account appears to reconcile while being short.';
COMMENT ON TABLE  reconciliation IS
  'The etat de rapprochement bancaire — the signed deliverable. Cannot reach APPROVED_LOCKED while unexplained_difference is non-zero.';
COMMENT ON TABLE  cash_count IS
  'Reconciliation for accounts nobody issues a statement for. The external truth is a physical count attested by the custodian and, where segregation allows, a witness.';

-- DOWN
-- Additive DDL only; drop in reverse dependency order. Business data is lost by
-- doing so (imported statements, confirmed matches and signed reconciliations),
-- so export before running any of this.
--
--   DROP TABLE IF EXISTS cash_count;
--   DROP TABLE IF EXISTS reconciliation;
--   DROP TABLE IF EXISTS reconciliation_match;
--   DROP TABLE IF EXISTS bank_statement_line;
--   DROP TABLE IF EXISTS bank_statement;
--   DROP TABLE IF EXISTS statement_profile;
