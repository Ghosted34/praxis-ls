# Budget Reconciliation — engineering guide

**Status:** PR 1 shipped; PRs 2 and 3 outstanding. Every decision here cites its question in
`doc/RECONCILIATION_PROGRAMME_QUESTIONNAIRE.md` §10 (answered 15/09/2026). Where this guide and the
questionnaire disagree, this guide is newer and wins; where this guide is silent, the questionnaire's
recommendation stands.

**What PR 1 changed about this guide.** Four things came out differently once the code was written,
and the guide has been corrected rather than left describing a plan nobody followed:

| Guide said | Shipped | Why |
| --- | --- | --- |
| `GET` creates the row on first read | **Reads never write.** The header is created by the first WRITE. | A GET that inserts is a non-idempotent read, and it let a `view`-only user cause a write. The sparse-line model already worked this way; the header now matches it (§4.0). |
| Module key `MOD-85`, registered in a tenant migration | **`MOD-76`, in a platform SEED** (`9132`) | `MOD-01`…`MOD-75` are taken, and `platform.module_catalogue` is seeded per platform, not migrated per tenant (`9130` is the pattern). |
| `app_setting (scope, key, value)` | **`setting (section, key, value)`** | That is the table's real shape (`0130:28`). |
| `dossier_reconciliation_suggestion` retired by comment | **Dropped** | It sits inside the orphan sweep's range, and that gate is right: a table no code touches is a hole, not a record. §8.4. |


**Module name:** **Budget Reconciliation** in the UI (Q21). Table and module names stay
`dossier_reconciliation` so no route, migration or import moves. "OCR" is retired as a label — it
already means optical character recognition one tab away (`bank_statement.ocr_used`, `10720`).

**Scope.** The third leg of budget → cash → actual. The costing is the budget; the cash request draws
it down; this is what was **actually spent**, evidenced, with the balance returned to the vault.
Overhead spend is explicitly **not** in scope (Q11) and is briefed separately.

---

## 1. The one sentence

> **One reconciliation per operations file, for ever. Its lines ARE the costing's lines. It stores
> only what a human typed; everything else is derived on read.**

Everything structural in this guide falls out of that sentence, so it is worth being precise about
why it is the right one.

The legacy **copied** the costing's lines into `ocr_line` at draft time. So did our current
`buildLines`. A copy is a decision to go stale: amend the costing and the reconciliation is wrong
until someone rebuilds it, and "rebuild" means destroying the human's work (which is exactly why
`dossier_reconciliation.repo.deleteLines` carries the comment *"DRAFT only — there is no line-edit
API, so no human-entered field is lost"* — the copy model is only safe while nothing is typed).

Owner decision Q6 removes the copy. The costing is SSOT; the sheet is a **projection** of it joined
to the budget ledger and to the few fields a person actually enters. Amend the costing and the sheet
has already changed — there is nothing to sync, nothing to rebuild, and nothing to lose. That is also
what makes "real time" (Q16) nearly free.

---

## 2. Vocabulary

| Word | Means | Lives in |
| --- | --- | --- |
| **Budget** | what the approved costing authorised for this line, **TTC** | `costing_line` (derived) |
| **Committed** | Σ claims from cash requests that are approved and not settled short | `cash_request_line` (derived) |
| **Disbursed** | Σ cash actually paid out, apportioned per line | `cash_request_payment` (derived) |
| **Actual** | what was really spent, typed or confirmed by a person | `dossier_reconciliation_line.actual_ttc` ← **stored** |
| **Variance** | Budget − Actual. Negative = overspend | derived |
| **Returned** | cash disbursed and handed back to the vault | `dossier_reconciliation_line.returned_amount` ← **stored** |
| **Outstanding** | Disbursed − Actual − Returned. What the holder still owes | derived |

All amounts are **TTC** (Q4). There is exactly one HT number in the whole module — the header's
margin figure — and §4.5 says how it is derived and why it is not a column.

---

## 3. The data model

### 3.1 What is stored, and what is not

```
dossier_reconciliation              ONE ROW PER DOSSIER, for ever (UNIQUE(dossier_id))
  ├─ status            OPEN | SUBMITTED | SETTLED
  ├─ revision          bumps every time it re-opens after a settlement
  ├─ currency, exchange_rate_to_xaf   copied from the costing (Q4 / 12771 Q8)
  └─ settlement history → dossier_reconciliation_settlement (one row per SETTLED)

dossier_reconciliation_line         ONE ROW PER costing_line THE HUMAN HAS TOUCHED
  ├─ costing_line_id   ← the key (Q1). UNIQUE with reconciliation_id.
  ├─ actual_ttc        ← typed / confirmed          (Q2)
  ├─ actual_source     DERIVED | CONFIRMED | OVERRIDDEN
  ├─ spent_on          ← the date the money left    (Q3, §4.3)
  ├─ variance_reason   ← required on overspend      (Q12)
  ├─ reason_group_id   ← one reason across several lines (Q12, §4.6)
  └─ returned_amount   ← entered by Finance         (Q14)

dossier_reconciliation_document     MANY DOCUMENTS PER LINE (Q8)
  └─ (line_id, doc_id) + uploaded_by/at + a note
```

**The line table is sparse on purpose.** A costing line nobody has touched has **no row** — it is
still rendered (budget, committed, disbursed, actual 0) because the read builds the grid from
`costing_line`. A row appears the moment someone types into it. This is what makes a new costing line
show up automatically, on a sheet that was settled last month, with no migration of anything (Q6).

### 3.2 Migration `13801_budget_reconciliation.sql`

Additive except where it retires what Q20 killed. **No backfill** — the owner confirmed every row in
the system today is mock data (Q6), so nothing true is lost by restructuring.

```sql
-- ── 1. One per file, for ever (Q6) ─────────────────────────────────────────
-- Collapse any existing rows first (mock data only), then constrain.
DELETE FROM dossier_reconciliation a
 USING dossier_reconciliation b
 WHERE a.dossier_id = b.dossier_id AND a.created_at < b.created_at;

ALTER TABLE dossier_reconciliation
  ADD CONSTRAINT uq_reconciliation_one_per_dossier UNIQUE (dossier_id);

ALTER TABLE dossier_reconciliation
  ADD COLUMN IF NOT EXISTS revision             integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS currency             char(3) NOT NULL DEFAULT 'XAF',
  ADD COLUMN IF NOT EXISTS exchange_rate_to_xaf numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS settled_by           uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS settled_at           timestamptz,
  ADD COLUMN IF NOT EXISTS returned_total       numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reopened_reason      text;

-- Status vocabulary: a living sheet is never a "draft", and Finance SETTLES
-- rather than validates (Q6 — the MD is informed, not asked).
ALTER TABLE dossier_reconciliation DROP CONSTRAINT IF EXISTS dossier_reconciliation_status_check;
UPDATE dossier_reconciliation SET status = 'OPEN'    WHERE status = 'DRAFT';
UPDATE dossier_reconciliation SET status = 'SETTLED' WHERE status = 'VALIDATED';
UPDATE dossier_reconciliation SET status = 'OPEN'    WHERE status = 'REJECTED';
ALTER TABLE dossier_reconciliation ADD CONSTRAINT dossier_reconciliation_status_check
  CHECK (status IN ('OPEN','SUBMITTED','SETTLED'));

-- ── 2. The line: keyed on the budget line, TTC, human fields only ──────────
ALTER TABLE dossier_reconciliation_line
  ADD COLUMN IF NOT EXISTS costing_line_id  uuid REFERENCES costing_line(costing_line_id),
  ADD COLUMN IF NOT EXISTS actual_ttc       numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_source    text NOT NULL DEFAULT 'DERIVED',
  ADD COLUMN IF NOT EXISTS spent_on         date,
  ADD COLUMN IF NOT EXISTS variance_reason  text,
  ADD COLUMN IF NOT EXISTS reason_group_id  uuid,
  ADD COLUMN IF NOT EXISTS returned_amount  numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_by       uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_recon_line_actual_source') THEN
    ALTER TABLE dossier_reconciliation_line ADD CONSTRAINT chk_recon_line_actual_source
      CHECK (actual_source IN ('DERIVED','CONFIRMED','OVERRIDDEN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_recon_line_money_nonneg') THEN
    ALTER TABLE dossier_reconciliation_line ADD CONSTRAINT chk_recon_line_money_nonneg
      CHECK (actual_ttc >= 0 AND returned_amount >= 0) NOT VALID;
  END IF;
END $$;

-- One row per budget line per reconciliation. The sparse-row model (§3.1)
-- depends on this: the writer upserts ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_line_costing_line
  ON dossier_reconciliation_line (reconciliation_id, costing_line_id)
  WHERE costing_line_id IS NOT NULL;

-- ── 3. Many documents per line (Q8) ────────────────────────────────────────
-- A Maersk demurrage invoice arrives for one day, then again for two. One FK
-- would make the second upload destroy the first.
CREATE TABLE IF NOT EXISTS dossier_reconciliation_document (
  recon_document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id           uuid NOT NULL REFERENCES dossier_reconciliation_line(line_id) ON DELETE CASCADE,
  doc_id            uuid NOT NULL REFERENCES document_vault(doc_id),
  note              text,
  uploaded_by       uuid REFERENCES app_user(user_id),
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (line_id, doc_id)
);
CREATE INDEX IF NOT EXISTS ix_recon_document_line ON dossier_reconciliation_document (line_id);

-- ── 4. Settlement history (Q6 — one row, but an auditable past) ────────────
CREATE TABLE IF NOT EXISTS dossier_reconciliation_settlement (
  settlement_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES dossier_reconciliation(reconciliation_id) ON DELETE CASCADE,
  revision          integer NOT NULL,
  budget_ttc        numeric(18,2) NOT NULL,
  disbursed_ttc     numeric(18,2) NOT NULL,
  actual_ttc        numeric(18,2) NOT NULL,
  returned_ttc      numeric(18,2) NOT NULL,
  settled_by        uuid REFERENCES app_user(user_id),
  settled_at        timestamptz NOT NULL DEFAULT now(),
  statement_doc_id  uuid REFERENCES document_vault(doc_id),
  UNIQUE (reconciliation_id, revision)
);

-- ── 5. cost_entry learns when the money actually left (Q3, §4.3) ───────────
ALTER TABLE cost_entry
  ADD COLUMN IF NOT EXISTS spent_on        date,
  ADD COLUMN IF NOT EXISTS costing_line_id uuid REFERENCES costing_line(costing_line_id);

COMMENT ON COLUMN cost_entry.spent_on IS
  'The date the money actually left, as recorded by the person who spent it. NOT created_at, which is when the row was written — a receipt handed in on Friday for a Tuesday payment is dated Tuesday. Becomes journal_entry.entry_date at posting.';
COMMENT ON COLUMN cost_entry.costing_line_id IS
  'The budget line this actual belongs to. Written by Budget Reconciliation settlement; NULL on entries posted by other paths (see doc/RECONCILIATION_ENGINEERING_GUIDE.md §8.1).';

CREATE INDEX IF NOT EXISTS ix_cost_entry_costing_line
  ON cost_entry (costing_line_id) WHERE costing_line_id IS NOT NULL;

-- ── 6. Retire the AI matcher (Q20) ─────────────────────────────────────────
-- Kept, not dropped: applied tables are hash-pinned and dropping is destructive.
-- The code stops reading and writing it as of this migration.
COMMENT ON TABLE dossier_reconciliation_suggestion IS
  'RETIRED by 13801 (owner decision Q20). The reconciliation line is keyed on costing_line_id, so there is nothing left to guess. Nothing reads or writes this table.';

-- ── 7. The overspend allowance (Q13) ───────────────────────────────────────
-- `setting` is (section, key, value jsonb) with UNIQUE (section, key) —
-- 0130_platform_projection.sql:28. Read via shared/config/settings.getSetting,
-- the same way pricing_variance thresholds are.
INSERT INTO setting (section, key, value)
VALUES ('finance', 'reconciliation',
        '{"overspend_allowance_amount": 1000, "overspend_allowance_percent": 2,
          "block_final_invoice": false}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- ── 8. Columns the TTC decision retires (Q4) ───────────────────────────────
-- budget_ht / actual_ht held HT and the grid is now TTC end to end. Left in
-- place, commented, and no longer read or written — the header's single margin
-- figure is derived (§4.5), never stored.
COMMENT ON COLUMN dossier_reconciliation_line.budget_ht IS
  'RETIRED by 13801 (owner decision Q4 — the grid is TTC). Not read, not written.';
COMMENT ON COLUMN dossier_reconciliation_line.actual_ht IS
  'RETIRED by 13801 (owner decision Q4 — the grid is TTC). Not read, not written.';
```

### 3.3 The module key lives in a PLATFORM migration, not this one

Q21 splits the permission key: MOD-47 stays with cost tracking, because sharing it meant a grant to
record costs was also a grant to settle a file's reconciliation — the exact pair Q18 wants apart.

`permission.module_key` is a `citext` mirroring `platform.module_catalogue` (`0110_rbac.sql:42`), and
that catalogue is registered **per platform, not per tenant**. `MOD-01` … `MOD-75` are taken, so the
new key is **`MOD-76`**, and it goes in a platform migration alongside the tenant one:

```sql
-- migrations/platform/0105_module_budget_reconciliation.sql
INSERT INTO platform.module_catalogue (module_key, group_key, name, description, sort_order, is_core)
VALUES ('MOD-76', 'finance', 'Budget Reconciliation',
        'What an operations file actually cost, per budget line, evidenced — and the cash returned to the vault.',
        760, false)
ON CONFLICT (module_key) DO NOTHING;
```

Confirm `group_key` against `0070_module_taxonomy.sql` (it was back-filled from a verb taxonomy) and
pick `sort_order` from where MOD-47 and MOD-49 sit, so the module lands beside its neighbours in the
permission matrix rather than at the end of it.

---

## 4. The engine

### 4.1 The grid is a query, not a table

`repo.gridFor(client, dossierId)` is the whole module in one read. It starts from `costing_line` —
**not** from `dossier_reconciliation_line` — which is what makes the sheet live.

```sql
SELECT cl.costing_line_id, cl.line_no, cl.label, cl.dictionary_item_id, cl.is_disbursement,
       -- BUDGET, TTC: net + the line's own VAT. Identical arithmetic to
       -- costing.repo.budgetForCosting, which is why LINE_VAT_SQL is shared.
       ROUND(cl.qty * cl.unit_cost + <LINE_VAT_SQL>, 2)        AS budget_ttc,
       claims.committed, claims.disbursed,
       -- The justification tick: the CASH REQUEST decides (Q9). true if ANY
       -- claim against this budget line was ticked.
       claims.justification_required,
       -- What the human typed (may be absent — sparse rows, §3.1)
       rl.line_id, rl.actual_ttc, rl.actual_source, rl.spent_on,
       rl.variance_reason, rl.reason_group_id, rl.returned_amount,
       docs.document_count
  FROM costing_line cl
  JOIN costing c ON c.costing_id = cl.costing_id
  LEFT JOIN LATERAL (…claims against cl.costing_line_id…)   claims ON TRUE
  LEFT JOIN dossier_reconciliation_line rl
         ON rl.reconciliation_id = $2 AND rl.costing_line_id = cl.costing_line_id
  LEFT JOIN LATERAL (SELECT count(*) AS document_count
                       FROM dossier_reconciliation_document d
                      WHERE d.line_id = rl.line_id)          docs ON TRUE
 WHERE c.dossier_id = $1 AND c.status = 'APPROVED_LOCKED'
 ORDER BY cl.line_no, cl.costing_line_id
```

Three things to notice:

1. **`claims` is the same LATERAL `costing.repo.budgetForCosting` already uses.** Extract it into a
   shared SQL fragment rather than writing it twice — two copies of commitment arithmetic will
   disagree within a quarter.
2. **Débours are not filtered.** Every line, per Q5. The `is_disbursement` flag rides on the row so
   the margin figure (§4.5) can exclude them without a second query.
3. **No `GROUP BY dictionary_item_id`.** That was the old grain (Q1) and it fused lines the owner
   needs to see apart.

### 4.2 Pre-fill: what ACTUAL says before anyone types

Q2 = C. A line with no stored row reads:

```
actual_ttc     = COALESCE(posted_for_this_line, disbursed)
actual_source  = 'DERIVED'
```

where `posted_for_this_line` is `Σ cost_entry.amount` already tagged with this `costing_line_id`, and
`disbursed` is the apportioned cash. The owner's sentence is the spec:

> *"119 250 was disbursed and the line needed 119 250. I just need to know: is that what you spent?
> If the answer is yes, you show it there and we see. If the answer is no you input the reason."*

So the grid opens with the answer already filled in as **"all of it"**, and the human's job is to
confirm or correct. Confirming without changing the number sets `actual_source = 'CONFIRMED'`;
changing it sets `'OVERRIDDEN'`. Both are a real act and both are stamped with `updated_by`.

A line with `disbursed = 0` (budgeted, never funded) pre-fills `0` — it is not a variance to explain,
it is budget nobody used (Q14).

### 4.3 `spent_on` — the owner's question, answered

> *"When do we actually post the entry? Funds would have been released but the actual transaction
> happened 3 days ago."*

This found a genuine gap. **`cost_entry` has no date column at all** — only `created_at`
(`0320_costing_procurement.sql:33-42`). The `entryDate` that `cost_tracking.recordCostInner` takes
is handed to `journalEntry.buildAndInsert` and never reaches the cost entry row. So today the ledger
can be dated correctly and the cost entry cannot say when the money moved.

**The rule:**

| Date | Means | Where |
| --- | --- | --- |
| `spent_on` | when the money actually left the holder's hands | typed on the line; defaults to the funding cash request's disbursement date |
| `journal_entry.entry_date` | the accounting date of the posting | **= `spent_on`**, so the books show the transaction when it happened |
| `created_at` | when the paperwork was done | automatic, never shown as "the date" |

So the answer to *"when do we post?"* is: **we post at settlement, dated `spent_on`.** Settling on
Friday a payment made on Tuesday produces a Tuesday-dated journal entry. The three-day gap the owner
described is recorded, not erased.

**The closed-period case.** If `spent_on` falls in a period `accounting_period` has closed, the
posting cannot carry that date. Do **not** silently move it: refuse with `PERIOD_CLOSED`, name the
period and the line, and offer the earliest open date — the reconciler either picks it (and
`spent_on` stays as typed, so the real date survives on the line) or asks Finance to reopen. Confirm
the exact period-lock helper in `0220_ledger.sql` / the ledger service before wiring this.

### 4.4 Settlement — what happens when Finance presses the button

This is the transaction that makes the module load-bearing. In one `BEGIN`:

1. **Guard.** Status is `SUBMITTED`. The settler is not the submitter (maker-checker — keep the
   existing `SELF_VALIDATE` rule). Every overspend line past the allowance has a reason; every line
   with `justification_required` and `actual_ttc > 0` has at least one document.
2. **Post the actuals.** For each line where `actual_ttc <> already_posted_for_this_line`, write one
   `cost_entry` for the **delta** — never the gross — tagged `costing_line_id`, `dictionary_item_id`,
   `spent_on`, through `cost_tracking.recordCostInner` so the journal entry, the proof-obligation
   check and the audit all happen on the existing path. The delta may be negative (a corrected
   over-post); handle it as a reversing entry rather than a negative amount, since
   `chk_cost_entry_amount_nonneg` forbids the latter.
3. **Return the cash.** `returned_total` is what Finance entered. For each funding régie advance,
   post a `CASH_RETURN` retirement for its share via `regie.retireCore` **inside this same
   transaction** (the same discipline `cash_request.justify` already uses, and the reason it uses it:
   if the retirement is refused, the whole settlement rolls back rather than leaving a settled sheet
   over an open advance).
4. **Retire the advances.** For each funding advance, post the `RECEIPT` retirement for the actual
   spend. §7.2 explains why this moved here from `cash_request.justify`.
5. **Close the funding cash requests.** Any `DISBURSED` request whose lines are all accounted for
   flips to `JUSTIFIED`.
6. **Stamp the file.** `dossier.ocr_amount = Σ actual_ttc`, `ocr_status = 'SETTLED'`,
   `ocr_reconciliation_id`.
7. **Record the settlement.** One `dossier_reconciliation_settlement` row at the current `revision`,
   with the four totals and the generated statement's `doc_id`.
8. **Tell the MD.** `dossier_reconciliation.settled` notification — FYI, not an approval (Q6, Q18).

### 4.5 The one HT number

Q4 retired HT from the grid. The margin question still has to be answerable, because
`pricing_variance` is a derived projection over this record (`10741`) and Sales reads its R/Y/G flag
without ever seeing a cost figure.

**Derived at read, never stored:**

```
actual_ht  = Σ over non-débours lines of ( actual_ttc ÷ (1 + line_vat_rate) )
margin     = quoted_ht − actual_ht          (quoted_ht: header, unchanged, from the accepted quote)
```

Say plainly what this is: **exact when the supplier charged the rate the costing assumed, approximate
otherwise.** The TTC cash number is the exact one, and it is the one the owner asked for. The HT
figure is a management indicator and is labelled as such on screen — never presented as the number
that closed the file.

### 4.6 The overspend allowance, and one reason across many lines

**Naming (Q13).** "Tolerance" and "threshold" are engineering words. On screen it is the
**Overspend allowance**, with the sub-line *"How far over budget a line may go before someone has to
explain it."* Set in the module's Configuration tab by anyone holding `approve` on MOD-76.

```js
const { overspend_allowance_amount: floor, overspend_allowance_percent: pct } =
  (await getSetting(client, "finance", "reconciliation", {})) || {};

reason_required(line) ⟺ overspend > floor  AND  overspend > budget × pct / 100
```

Both must be exceeded (questionnaire Q13's argument: 2% of a 2 500 000 customs line is 50 000 and
must be explained; 2% of a 5 000 line is 100 and must not be).

**Apply-to-many (Q12).** One network outage at customs holds a container an extra day and four lines
move together. The reason is written once:

- Type the reason on the worst line; a picker offers every other line currently demanding one.
- Tick the lines it explains; all of them get the same text and a shared `reason_group_id`.
- Editing any member edits the group. Removing one line from the group leaves the others intact.

The group id is what makes this honest: the statement and the audit can say *"one reason, four
lines"* rather than showing four identical sentences and implying four independent judgements.

### 4.7 Re-opening

A `SETTLED` reconciliation re-opens **automatically** when the facts move (Q6):

| Trigger | Effect |
| --- | --- |
| Costing amended (new line, changed amount) | `status → OPEN`, `revision += 1`, `reopened_reason` names the costing change |
| A further cash request disbursed against the file | same |
| A `cost_entry` posted against the file from another path (§8.1) | same |

Because the grid is a projection (§4.1), the new or changed line is simply **there** on the next
read, carrying whatever the human already typed on the lines that did not change. Nothing is rebuilt
and nothing is lost. The previous settlement stays in
`dossier_reconciliation_settlement`, so "what did we close at in July" remains answerable.

The owner's worked example runs exactly this path: demurrage added for day 12 → one new line; another
day plus Port Storage added at day 13 → one amended line and one new line; the container comes out on
day 1 of the 2 budgeted → `actual < disbursed`, and the difference is cash Finance expects back.

---

## 5. API

Base path `/costing/reconciliations`, module key `MOD-76`.

| Method | Path | Grant | Does |
| --- | --- | --- | --- |
| `GET` | `/:dossierId` | `view` | The sheet: header, grid, totals, gates. Creates nothing — there is no "draft it" step (Q6) and the header appears on the first write. |
| `PATCH` | `/:dossierId/lines/:costingLineId` | `edit` | **The endpoint that has never existed.** `actual_ttc`, `spent_on`, `variance_reason`, `returned_amount`. Upserts the sparse row. |
| `POST` | `/:dossierId/lines/:costingLineId/documents` | `edit` | Attach a vault document to the line. Many per line. |
| `DELETE` | `/:dossierId/lines/:costingLineId/documents/:docId` | `edit` | Detach (does not delete the vault row). |
| `POST` | `/:dossierId/reasons` | `edit` | Apply one reason to several lines (§4.6). |
| `POST` | `/:dossierId/submit` | `edit` | Operations → Finance. Runs both gates. |
| `POST` | `/:dossierId/reject` | `validate` | Back to `OPEN` with a reason. |
| `POST` | `/:dossierId/settle` | `validate` | §4.4. Finance records the returned cash and posts. |
| `GET` | `/:dossierId/statement` | `export` | PDF or xlsx (Q19). `can_export`, not `can_read` — 12771 created that column for exactly this distinction. |
| `POST` | `/:dossierId/statement/send` | `export` | Post the statement into the file's Smart Comms channel (Q19, §6.4). |
| `GET` | `/owed` | *(self)* | What the CALLER owes. Ungated like `hr_query/mine` — a person may always see their own obligations. |
| `GET` | `/owed/all` | `view` | What everyone owes, for Finance. |

Retired: `POST /` (drafting), `POST /:id/validate` (→ `settle`), and both
`/:id/suggestions/:sid/*` routes (Q20).

**Errors.** `PERIOD_CLOSED`, `REASON_REQUIRED` (carries the offending lines), `PROOF_REQUIRED`
(carries the offending lines), `SELF_VALIDATE`, `BAD_STATE`, `NO_APPROVED_COSTING`. Every list-
carrying error names **all** the lines at once — a user should get one list, not four rounds of 422.
Regenerate `doc/ERROR_CODES.md` with `node scripts/generate-api-docs.js`; adding an `AppError` changes
a count in a table and reddens `build-test` otherwise.

---

## 6. Frontend

### 6.1 The chart library (Q15)

**Recharts**, and nothing else added.

*Why it, and not the alternatives.* The binding constraint is white-labelling: every series colour
must come from a CSS custom property so a tenant's brand re-tints the charts, and `check:palette`
and `check:contrast` are gates. Recharts renders **SVG**, so `fill="var(--primary)"` simply works.
Chart.js, ECharts and uPlot render to **canvas**, where a CSS variable is not reachable and the
colours would have to be read out of the computed style and re-injected on every theme change — a
second source of truth for colour, which is the thing `check:palette` exists to prevent. Nivo is
Recharts' weight several times over. visx is excellent and lower-level, but it is a toolkit rather
than a chart library and would mean building tooltips and legends by hand, which is most of the work.

*How it ships without taxing every page.* `client/vite.config.ts` already has the mechanism and
names the rule: **one bucket for node_modules, and route-level `React.lazy` for everything else** —
adding a `manualChunks` bucket is forbidden and is what once served a blank page. So add the
packages to `ROUTE_LOCAL_VENDOR` alongside `world-atlas` and `pdfjs-dist`:

```ts
const ROUTE_LOCAL_VENDOR = [
  "world-atlas", "topojson-client", "pdfjs-dist",
  // Charts (MOD-76, and the Reporting Module after it). SVG, so series colours
  // are CSS custom properties and a tenant's brand re-tints them. Kept out of
  // `vendor` so only the screens that chart pay for it.
  "recharts", "victory-vendor", "d3-scale", "d3-shape", "d3-array",
  "d3-path", "d3-time", "d3-time-format", "d3-format", "d3-interpolate", "d3-color",
];
```

Rollup then attaches them to whichever lazy route imports them. Verify the exact sub-package list
against `package-lock.json` after install, and re-run `npm run build && npm run check:bundle`.

*The wrapper is not optional.* Add `client/src/components/ui/chart.tsx` exporting a `<Chart>` shell
and a `SERIES` token map. **No screen imports `recharts` directly**, and no chart prop ever takes a
hex literal — series colour comes from the map, which reads the same tokens `MeterGroup` uses.
`check:palette` scans text for Tailwind palette utilities and will **not** catch a raw hex in a JS
prop, so extend it with a hex-literal rule scoped to chart files, or the white-label guarantee has a
hole in it the day someone is in a hurry.

`MeterGroup` stays. It is the right tool for three labelled magnitudes and costs no bundle; charts
are for the shapes it cannot draw.

### 6.2 The sheet

Route `/costing/reconciliation` (unchanged), titled **Budget Reconciliation**.

```
┌ Budget Reconciliation · SLAS-OPS-2026-0117 ······················· [OPEN · rev 2] ┐
│                                                                                   │
│  Budget        Disbursed       Actual        Variance      To account for         │
│  2 886 115     2 650 000       2 642 000     +244 115      8 000                  │
│                                                                                   │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░   ← consumption, one track [Full view]  │
│                                                                                   │
├───────────────────────────────────────────────────────────────────────────────────┤
│ Line              Budget    Disbursed   Actual        Variance   Proof   Reason    │
│ Port Charges      150 000     150 000   [162 000]▏    −12 000    📎 2    ⚠ needed  │
│ Customs Duties  2 500 000   2 500 000   [2 480 000]   +20 000    📎 1      —       │
│ Demurrage 2d      160 000     160 000   [80 000]      +80 000     +       —        │
│ THC               236 115           0   [0]          +236 115     —     not funded │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- **One visual, then a button** (Q15). The consumption track is on the sheet; *Full view* opens a
  drawer that lazy-loads the rest — spend by line, variance waterfall, and (once `spent_on` exists
  on every posting) spend accumulating against budget over the file's life.
- **The `+` is the upload affordance** (owner's words, Q6): a line needing proof and not having it
  shows `+`; clicking opens the line modal at its Documents section.
- **`[…]` is the actual**, pre-filled per §4.2, re-footing the sheet and redrawing the track on every
  keystroke (Q16 — the legacy's `updateLine()` → `calculateTotals()`, which is the one thing about
  that screen worth copying wholesale).
- **A line the costing has not budgeted cannot be added here.** Instead, a two-line hint, per Q11
  and in the owner's own framing:

  > **Missing a line?** The costing is the budget — add it there and it appears here.
  > **[Request an unlock →]** *(deep-links to the file's costing)*

### 6.3 The line modal (Q5)

Click any line: a `<Modal size="lg">` showing that line's whole story — budget with its amendment
history, every cash request that funded it and when, the actual with who entered it and when, the
variance and its reason (and the other lines sharing that reason), and **the documents**, listed with
uploader and date, with the picker under them.

Uploads use the engine, per CLAUDE.md's third rule and `FRONTEND_GUIDE.md` §3.13 — `useUpload({
profile: "document", autoStart: false })` + `<FilePicker>` + `<UploadList>`, then
`uploadVaultFile(file, { dossier_id, doc_type: "COST_PROOF" })`.

- `profile="document"` is **required** and is not cosmetic: a customs scan must not be tonally
  corrected or it stops matching the paper, and `document_signature.artifact_hash` is taken from the
  vault row's `content_hash`.
- Accept **pdf, image, word, excel** (owner, Q6). The current `dossier-documents.tsx` accepts only
  `.pdf,.png,.jpg` at 5 MB — widen for this surface and let the server sniff the bytes, which is the
  check that counts.
- Never `<input type="file">`; `praxis/no-raw-upload` is an error in all three apps with no baseline.

### 6.4 The statement (Q19)

`GET /:id/statement?format=pdf|xlsx` — the user picks. The PDF goes through
`services/documents/templates` (so dates print **dd/mm/yyyy**; `npm run check:dates` fails ISO in
that path), the xlsx through `services/spreadsheet`.

It carries what the legacy's print engine could not: **the variance reasons** and **the proof
document list per line**. A statement showing −12 000 with no sentence explaining it is the document
that generates the email asking why.

**Send in-house** (`POST /:id/statement/send`): Smart Comms (MOD-64) already supports messages with
`attachments: [{ vault_id }]` and has dossier-scoped channels. Post the statement into the file's
channel, or direct-message a colleague. **In-house only** — no external mail path on this route, by
the owner's instruction.

### 6.5 "Cash to account for" — My workspace (Q10)

The owner asked for the friendliest accurate name. Recommended: the section is **"Cash to account
for"**, sub-line *"Money you've received that still needs a receipt."* An individual item is a
**receipt owed**. Not "compliance flag", not "outstanding obligation" — the person reading it took
cash and owes paperwork, and plain words get paperwork back faster than a compliance vocabulary does.

`workspace-page.tsx` currently renders two panels (*Awaiting me*, *Unread alerts*) under a KPI row.
Add a third panel and a third tile:

```
Cash to account for                                    3 · 412 000 XAF
Money you've received that still needs a receipt.
  SLAS-OPS-2026-0117 · Port Charges          162 000   Upload →
  SLAS-OPS-2026-0117 · Customs Duties      2 480 000   Upload →
  OVH-2026-0042      · Fuel                   12 000   Upload →
```

Fed by `GET /costing/reconciliations/owed` — every line where the caller received the cash
(`cash_request_payment.received_by`), the line needs justification, and it has no document. Operations
files and overhead alike (Q10), which is why the endpoint keys on the receiver rather than on the
dossier. Each row deep-links to the line modal.

Notifications: add to `NOTIFIABLE` in `shared/notifications/notify-events.js` —
`reconciliation.submitted`, `reconciliation.settled`, `reconciliation.reopened`,
`reconciliation.proof_owed` (the in-app + push the owner asked for). The allowlist is curated on
purpose; four keys, each with a title and an action.

### 6.6 Supporting documents on the Operations file 360 (Q8)

The owner asked for a tab on the file 360 gathering every supporting document, grouped by the line it
belongs to. **My recommendation is a section inside the existing `documents` tab rather than a ninth
tab**, and it is worth one paragraph of argument since it differs slightly from what was asked.

`File360Tab` is already `details · containers · itinerary · milestones · queries · money · people ·
documents` (`file-360.tsx:87-95`). A ninth tab called *Supporting documents* sitting beside
*Documents* forces every user to learn a distinction Praxis invented — and the honest distinction is
not "two kinds of document" but **"documents about the shipment"** (the B/L, the customs declaration)
versus **"documents proving what we spent"**. Same tab, two clearly-titled sections, no new
vocabulary:

```
Documents
├─ Shipping documents            (today's list, unchanged)
└─ Cost proofs                    grouped by budget line
   ├─ Port Charges          📎 port-invoice.pdf · 📎 receipt-scan.jpg
   ├─ Customs Duties        📎 customs-receipt.pdf
   └─ Demurrage            📎 maersk-1day.pdf · 📎 maersk-2day.pdf   ← both, per Q8
```

The Demurrage row is the case the owner named: the first Maersk invoice covered one day, the second
covered two, and both belong. The join table (§3.2) is what lets the second upload sit beside the
first instead of replacing it.

If you would rather have the separate tab, it is a one-line change to `FILE_360_TABS` and the label
map — say so and it ships that way.

---

## 7. What this changes in modules that are already shipped

### 7.1 Cash request — the proof gate comes off

Q7 moves the upload here. So `cash_request.service.justify`'s block must go:

```js
// cash_request.service.js:1044 — REMOVE
const owed = stored.filter((l) => l.justification_required === true && !l.proof_vault_id);
if (owed.length) throw new AppError("PROOF_REQUIRED", …, 422);
```

**This is not a relaxation of the control — it is a relocation of it.** The control lands on
`POST /:id/submit` here, where the upload actually exists. Leaving the gate where it is would keep
the dead end the questionnaire opened on: `PORT_CHARGES` is seeded `ALWAYS_REQUIRED`, `JustifyForm`
sends no `proof_vault_id`, and `proof_vault_id` is not even on the `CashLine` type — so a cash request
carrying that item can be disbursed and then never closed by anybody.

`cash_request_line.justification_required` **stays** and stays authoritative (Q9): the cash request
is SSOT for the tick, the dictionary only seeds its default.

### 7.2 Régie — the retirement moves to settlement

Today `justify` retires the advance with a `RECEIPT` for `Σ spent_amount`, and refuses
(`ADVANCE_NOT_CLEARED`) while any of it is open. Under Q6 and Q14, Finance records the returned cash
**here**, at settlement — so settlement is where both legs belong:

- `RECEIPT` for `actual_ttc` (what was really spent, now evidenced)
- `CASH_RETURN` for `returned_amount` (what came back to the vault)

Both inside the settlement transaction (§4.4), so a refused retirement rolls the settlement back
rather than leaving a settled sheet over an open advance — the same discipline `justify` uses today
and for the same reason.

`cash_request.justify` becomes a thin transition: record `spent_amount` as an operational note, flip
to `JUSTIFIED`. It no longer gates on proof and no longer retires anything.

> **Flagged for confirmation.** This is the one place the answers imply a change to a module that is
> already shipped and working, and it is worth one word from the owner before it is built. Everything
> else in this guide is additive to the cash request.

### 7.3 Costing — two small hooks

- **Amendment re-opens the reconciliation** (§4.7). One call in `costing.service.setStatus` on
  `APPROVE` when a settled reconciliation exists.
- **The deep link** the sheet offers (§6.2) targets the existing unlock-request flow (`10718`); no
  new endpoint.

The `LINE_HAS_CLAIMS` protection `12771` added already covers the case that matters: a budget line
carrying claims cannot be deleted out from under them, so a reconciliation line can never be orphaned.

### 7.4 Pricing variance — unchanged, fed differently

`10741` made `pricing_variance` a derived projection over this record. It keeps reading the same
header shape; only the HT actual's derivation changes (§4.5). Sales still sees margin % and the R/Y/G
flag with no cost figure, which is the boundary `10741` was written to hold.

---

## 8. Findings that the answers surfaced

### 8.1 Five shipped code paths violate "no spend without an approved costing"

Q11 is unambiguous: *"it is impossible for an operations file to have a spend without it going
through an approved costing. We should never allow that."* Agreed as policy. It is not what the code
does today. These five orchestration handlers each write a `cost_entry` against a dossier with no
costing line and no cash request:

```
src/orchestration/handlers/supplier-invoice-posted-cost-entry.js
src/orchestration/handlers/fuel-log-created-dossier-cost.js
src/orchestration/handlers/outbound-dispatched-handling-cost.js
src/orchestration/handlers/work-order-done-dossier-cost.js
src/orchestration/handlers/fleet-dispatch-returned-driver-labour.js
```

Two ways to honour the policy, and they are genuinely different:

- **Refuse at the handler.** A supplier invoice for an item the costing does not carry fails to post.
  Faithful to the policy, and it puts the failure in accounts payable's lap where nobody can act on
  it.
- **Refuse at settlement, surface in between.** ⭐ The entry posts (the ledger must record what
  happened), lands in an **Unaccounted spend** tray on the sheet, and **submission is blocked** until
  each one is either mapped to a budget line or the costing is amended to carry it.

I recommend the second. It does not permit off-budget spend — it refuses to let it hide, which is the
same end with a route to fix it. **This is a decision, not a detail**, and it is not covered by any
of the 21 answers; flagged for the owner.

### 8.2 `cost_entry` cannot say when money was spent

§4.3. Fixed by `spent_on` in `13801`, but worth recording as a finding: every cost entry in the
system is dated by when its row was written.

### 8.4 The orphan sweep counted commented-out DDL

`tests/security/mail-orphan-sweep.test.js` scanned raw migration text for `CREATE TABLE IF NOT
EXISTS`, so a **well-documented `-- DOWN` block** — one that spells out the statements to reverse a
drop — registered a table the database does not have, and the gate then demanded application code
for it. It also had no notion of a table being dropped later, so retiring a feature correctly (drop
the table, delete the code) failed it, and the only ways to green were to leave dead schema behind or
to write "not built yet" about something that was built.

Fixed in PR 1: strip line comments before scanning, and subtract anything a later migration drops.
The gate now reads what migrations DO rather than what they describe.

### 8.5 Cost proofs: Word and Excel

`document_vault` accepts PDF/PNG/JPG at 5 MB for anything carrying a `dossier_id`, which is legacy's
rule for a bill of lading and the right one for it. A cost proof is different: a carrier's demurrage
statement arrives as `.xlsx` and a clearing agent's breakdown as `.docx`, and refusing those does not
make the money unspent — it makes the evidence live in somebody's inbox instead of on the line it
proves.

PR 1 widens the list **for `doc_type = 'COST_PROOF'` only**, to 15 MB (a multi-page colour scan of a
customs file clears 5 MB routinely). The sniffer learned the ZIP container magic to support it, and
that is a deliberately weaker assertion than the other four: it says "these bytes are an archive",
not "these bytes are a Word document". The DECLARED type resolves which, and only within what the
caller allowed — so a renamed `.zip` declaring itself a PDF is still refused.

### 8.3 `proof_vault_id` is a paste-a-uuid text box

`regie-detail.tsx:313-321` renders *"Proof document id"* as a bare `<Input>`. It is the only proof
capture in the whole finance domain today. The engine built for §6.3 should replace it in the same
pass — it is four lines and it removes the last place a user is asked to paste a uuid.

---

## 9. Test plan

**Rules (pure, no I/O)** — the arithmetic every screen and the PDF share:
variance; `reason_required` at, one below and one above each allowance edge, and the case where only
one of the two is exceeded; outstanding = disbursed − actual − returned; the HT derivation with and
without débours; TTC pre-fill when a line is part-funded.

**Repo** — the grid query: a costing line with no reconciliation row renders; a line amended after
settlement renders the new budget with the old typed actual intact; two lines from the same dictionary
item stay two lines (the Q1 regression); a débours line is present (the Q5 regression).

**Service** — settlement posts deltas not gross, and posts nothing when the actual already matches;
`spent_on` reaches `journal_entry.entry_date`; a refused régie retirement rolls the whole settlement
back; self-settlement refused; `PERIOD_CLOSED` names the period; submit reports every missing reason
**and** every missing document in one error; re-opening bumps `revision` and preserves typed values;
a second settlement writes a second `dossier_reconciliation_settlement` row.

**Frontend** — the sheet re-foots on keystroke without a round trip; a refetch on focus does **not**
clobber a dirty actual (the `b6294e1` lesson); the `+` opens the line modal at Documents; two
documents on one line both persist and both render; the *Full view* drawer lazy-loads.

**Gates** — `npm run ci` from the repo root, plus `npm run check:dates`, and after `npm run build`,
`npm run check:bundle` (the chart library's placement is exactly what that gate exists to catch).
Regenerate `doc/API_REFERENCE.md` and `doc/ERROR_CODES.md` with `node scripts/generate-api-docs.js`
and commit what it writes — never edit them by hand.

---

## 10. PRs

### PR 1 — `feat(reconciliation): the line becomes writable, and proof becomes real` · **shipped**
Migration `13801` + seed `9132`. The projected grid. `PATCH /lines/:costingLineId`, the document
routes, the reason group. Submit/reject/settle without the postings. The sheet, the line modal and
the upload engine. Removes the cash request's misplaced proof gate (§7.1). Also, not originally
planned: Word and Excel accepted as cost proofs (§8.5), `pricing_variance` re-pointed at the new
shape (§7.4), and the orphan-sweep gate taught that a dropped table is not an orphan (§8.4).

### PR 2 — `feat(reconciliation): settlement posts the actuals and returns the cash`
`spent_on` → `journal_entry.entry_date`; delta postings; the régie legs (§7.2); the file stamp; the
settlement history; re-opening on costing amendment; the MD notification; "Cash to account for" on
My workspace.

### PR 3 — `feat(reconciliation): the picture, the statement, and the file's proofs`
The chart library and the `<Chart>` wrapper; the consumption track and the *Full view* drawer; the
PDF/xlsx statement and the Smart Comms send; cost proofs on the Operations file 360; the rename to
Budget Reconciliation; the MOD-76 split; retiring the matcher.
