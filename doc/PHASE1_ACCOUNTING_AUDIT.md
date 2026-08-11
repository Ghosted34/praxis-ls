# Praxis LS — Phase 1 (Accounting Spine) Readiness Audit

**Date:** 2026-07-09
**Scope:** Phase 1 per `WORK_TO_BE_DONE.md`, verified against the actual
`migrations/tenant/*.sql`, `migrations/seeds/*`, and `src/modules/{finance,master}/*`
— checked against the OHADA/SYSCOHADA KB (esp. §22 data model, §23 the 17 hard
invariants, §5/Appendix A chart, §9/§15–19 rates) and the PRD.
**Method:** direct source/schema/seed inspection. No code changed.

---

## Verdict: the vault is built and locked; the accountant hasn't been hired.

Phase 1 is **roughly 70% foundation, ~10% brain.** The database is genuinely
excellent — the schema models the KB §22 data model faithfully, and the hardest,
most valuable part (the ledger invariants) is enforced by real Postgres triggers.
The seeds (chart of accounts, tax codes) are substantially present and correct.

But **the entire accounting service/domain layer is missing.** Every module in
`src/modules/finance/*` is the generic 5-line CRUD factory. There is no posting
engine, no invoice→balanced-entry logic, no statement computation, no tax
computation, no régie-d'avance aging. Concretely: **you cannot create a single
valid journal entry through the app today** — the generic CRUD doesn't build
lines and doesn't assign `entry_no` (which is `NOT NULL` with no default), so a
create either inserts a useless empty draft or fails outright.

This is the mirror image of a typical project: normally the logic exists and the
data model is shaky. Here the data model is superb and the logic is absent.

---

## What is genuinely solid (build on this, don't touch it)

**Schema (`0200`–`0230`, `0342`)** models KB §22 almost exactly:
- `chart_of_accounts` (code, parent_code hierarchy, class, normal_balance,
  `is_postable`, `requires_analytic`), `dictionary_item` (with the `is_disbursement`
  flag), `posting_rule` (dict item → debit/credit account + `tax_code_id` +
  `applies_context` sale/purchase/disbursement).
- `journal` / `accounting_period` / `journal_entry` (entry_no, source_doc_ref,
  status draft|validated, `source` provenance, `review_status`,
  `corrects_entry_id`) / `journal_line` (debit/credit, dossier_id, tax_code,
  currency, fx_rate).
- `regie_advance` (581 state machine → 4211), customer `advance` (4191),
  `invoice`, `fx_rate_daily`, depreciation/close scaffolding.

**Ledger invariants enforced by DB triggers** (this is the crown jewel):
- #1 balanced (deferred constraint trigger, fires on `validated` at commit),
  #2 one-side-per-line (CHECK), #3 postable-leaf-only, #4 débours never class
  6/7, #5 no VAT on a débours line, #8/#16 validated entry immutable + cannot be
  deleted (reverse-not-edit), #10 dossier_id required on analytical accounts,
  plus "≥2 lines". The deferred-balance design (build entry+lines in one txn,
  enforce at COMMIT when validated) is exactly right.

**Seeds** — `9000_seed_coa.sql` (~116 accounts, classes 1–8; class 9 optional
and correctly omitted) includes every account the KB cookbook uses (4731, 4191,
4211, 4432, 521, 581, 6053, 661, 7061, 7062). `9010_seed_tax.sql` carries VAT
19.25, IS 33, minimum 2.2/5.5, CNPS 4.2/7/1.75, CFC/FNE/CAC, IRPP — and
`tax_code` has proper versioning (`effective_from`/`effective_to`, `brackets`
jsonb for IRPP/CNPS scales). Invariant #13's *capability* is modeled.

**`financial_dictionary` module is real** — it enforces invariant #14 (rejects a
dictionary item saved without ≥1 posting rule), in a transaction, with events +
audit. The one non-generic finance/master module.

---

## The gap: the accounting brain (P0 for Phase 1)

Every one of these is a generic CRUD stub (`makeService`/`makeRepo`, ~5 lines)
with **none** of the required domain logic:

### 1. Posting / journal engine — MISSING (this is the spine's spine)
No service creates a balanced multi-line entry, assigns a gap-free `entry_no`
per journal/period (#9), or transitions draft→validated. `journal_entry` is
generic CRUD; it can't insert (entry_no NOT NULL, no lines built). **Everything
else in accounting posts through this — it must be built first.**

### 2. Account-determination engine — MISSING
The KB §22 flow (invoice_line → dictionary_item → posting_rule → lines; débours
→ credit 4731 no tax; service → credit 706/707 + VAT 4432; debit 4111; assert
Σ Dr = Σ Cr; tag dossier_id) exists nowhere. `posting_rule` is only *read* by the
dictionary module for validation, never used to *post*.

### 3. Invoicing → GL — MISSING
`proforma`, `final_invoice` are CRUD stubs. No advance-received posting (4191,
#7), no final-invoice posting (revenue recognition + débours recovery + VAT,
débours carrying no VAT), no advance application.

### 4. Régie d'avance aging — MISSING
`regie_advance` state machine + `4211` reclass path exist in schema; **no worker
or service ages 581→4211** past the policy window (#17). Nothing implements it.

### 5. Statements — MISSING
No SQL views or computation for trial balance, grand livre, Bilan, Compte de
résultat, TAFIRE, or notes. `financial_statement` is a 5-line stub.

### 6. Tax Center outputs — MISSING
`tax_declaration` is a stub. No TVA return, IS/minimum-tax, WHT, DSF, or CNPS
computation over the ledger.

### 7. PDF + Email workers — EMPTY STUBS
`src/services/pdf.service.js`, `pdf.templates.js`, `email.service.js` are all
**0 bytes**. `storage.service.js` (48 lines) is real (fixed in Phase 0). The
worker runtime exists (Phase 0) but its `PROCESSORS` registry is empty, so no
PDF/email job runs.

### Invariants not yet enforced (need the service layer above)
- #6 no compensation (netting 411 vs 401 in one line) — no rule.
- #7 advance ≠ revenue — relies on correct posting (absent).
- #9 gap-free monotonic entry_no — only a UNIQUE constraint; no assignment logic.
- #11 `source_doc_ref` required to validate — column is nullable; no validate
  path enforces it. **Recommend a trigger** blocking `status→validated` with a
  null `source_doc_ref`.
- #13 tax version effective at entry date — capability modeled, not applied.
- #17 régie aging — as above.

---

## Recommended build order

1. **Ledger posting service** (`finance/journal_entry` → real domain service):
   open period → assign gap-free `entry_no` → insert entry + lines in one txn →
   validate (balanced, deferred trigger does the assert) → reversal-not-edit
   (`corrects_entry_id`). + unit/integration tests against a real Postgres.
2. **Account-determination service** (dictionary + posting_rule → lines), per KB
   §22 flow, with the débours/VAT branching.
3. **Invoicing** (proforma → advance 4191; final invoice → 706/707 + 4432 +
   4731 recovery + advance application) posting through #1/#2.
4. **Régie d'avance aging worker** (581→4211), registered in `workers.js`.
5. **Statements**: trial balance + grand livre as SQL views → Bilan / Compte de
   résultat computation → TAFIRE / notes.
6. **Tax Center**: TVA return, IS/minimum, WHT, CNPS, DSF dataset over the ledger.
7. **PDF worker + email service**: fill the empty service stubs (Puppeteer +
   bilingual templates + QR hash; SMTP with SPF/DKIM), register both in
   `workers.js`.
8. **Close remaining invariants** (#6, #7, #9, #11, #13, #17) — some fall out of
   #1–#4; add the `source_doc_ref`-on-validate trigger and a no-compensation
   check explicitly.

Items 1–3 are the true Phase 1 spine; nothing downstream (Phase 2 commercial
cycle) can post money until they exist.

## Note carried from Phase 0 (still open, blocks trusting any of this)
Neither the seeds nor the triggers have been run against a real Postgres in this
environment. Before building on the schema, do one `db:migrate:platform` +
`db:provision` on a real PG16 (pgvector) and confirm the migrations + COA/tax
seeds apply cleanly.
