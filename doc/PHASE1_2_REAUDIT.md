# Praxis LS — Phase 1 & Phase 2 Re-Audit (post gap-closure)

Scope: re-audit the accounting spine (Phase 1) and commercial cycle (Phase 2)
against the source documents in `doc/` — the PRD (`SmartLS_PRD_Master_Functional_Spec_v2.md`),
the OHADA/Cameroon knowledge base (`SmartLS_OHADA_Accounting_Tax_KnowledgeBase (1).md`),
`BUILD_CONVENTIONS.md`, `AI_READINESS.md`, and the module catalogue — and confirm
that every module belonging to those two phases is now a real module rather than
a generic CRUD stub. This supersedes the gap lists in `PHASE1_ACCOUNTING_AUDIT.md`
and `PHASE2_COMMERCIAL_AUDIT.md`.

Verification basis: no Postgres is available in this environment, so correctness
is established at three levels — pure business rules covered by unit tests
(188 tests across 31 suites, all green), module load/mount checks against the
real `module-loader`, and the DB triggers/constraints in `migrations/tenant/*`
which remain the final authority on balance, immutability and referential rules
at runtime.

---

## 1. Verdict

**Phase 1 — COMPLETE.** The accounting spine is whole: chart of accounts,
financial dictionary + account determination, the OHADA journal engine with
reversal-not-edit, the full statement set (trial balance, grand livre, Bilan,
Compte de résultat incl. class 8, and TAFIRE with OHADA operating/investing/
financing sectioning), the Tax Center (TVA return + IS/minimum tax), treasury
accounts, proforma/advance and final invoicing bound to the ledger, régie
d'avance with aging, the vault, and document verification (gated + public QR
scan).

**Phase 2 — COMPLETE.** The commercial cycle is whole: corporate entities,
client/supplier masters, currency + live FX, expense-rate cards, the dossier
registry with a 360° aggregation, milestones, project costing + cost tracking +
reconciliation, the cash-request disbursal document wired to régie, both
simulators (margin and demurrage), smart receivables (receipt → FIFO allocation
→ ageing → dunning), the full procurement chain (PR → PO → GRN → supplier
invoice with three-way match → GL), transit orders and delivery notes, and
project financing/debt.

Every **behavioural** module in Phases 1 and 2 is a real module (custom service
orchestrating a transaction, all SQL confined to its repo, pure rules that are
unit-tested, gated routes, a Zod validator). The only Phase-1/2 module still on
generic CRUD is `tax_jurisdiction` (MOD-07) — a seeded reference lookup where
generic CRUD is appropriate; the tax _behaviour_ lives in `tax_code` +
`tax_declaration`, both real.

---

## 2. What was closed in this sprint

Gap modules upgraded from stub → real, with their key domain logic and the
OHADA/PRD rule each honours:

| MOD      | Module                         | Domain logic added                                                                                    | Rule honoured               |
| -------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------- |
| 06       | Chart of Accounts              | class-of-code, postable-leaf invariant, no-delete-if-referenced, statutory rows undeletable           | KB §2 (COA), §23 invariants |
| 09       | Treasury Accounts              | coa_code must be class-5; MoMo needs network + class-6 fee acct; activate/deactivate                  | KB §7 treasury              |
| 01       | Corporate Entities             | unique code, NIU/RCCM, doc prefix, fiscal-year-start (1–12)                                           | PRD entity model            |
| 10       | Expense Rates                  | effective-dated rate cards; most-specific resolver (line+variant, date)                               | PRD rate cards              |
| 27       | Margin Simulator               | margin on services only, débours excluded; priceForMargin inversion                                   | KB §6.7                     |
| 28       | Demurrage Simulator            | tiered per-day tariff from settings, free-day handling                                                | PRD extra-charges           |
| 30       | Transit Order                  | numbered (OT) + document capture                                                                      | §8 numbering/capture        |
| 32       | Delivery Note                  | numbered + capture                                                                                    | §8 numbering/capture        |
| 49       | Cash Request                   | DRAFT→SUBMITTED→APPROVED→DISBURSED→JUSTIFIED; disburse issues a régie advance                         | KB §6.8                     |
| 52       | Smart Receivables              | receipt Dr cash / Cr 4111, FIFO allocation, 0/1-30/31-60/61-90/90+ ageing, dunning policy             | KB §8                       |
| 53       | Project Financing/Debt         | drawdown Dr treasury / Cr 162; repayment Dr 162+671 / Cr treasury; auto-settle                        | KB §11                      |
| 56       | General Ledger                 | grand livre per-account running-balance movements                                                     | KB §22                      |
| 59       | Cash-Flow / TAFIRE             | classify each cash entry's counterpart into operating/investing/financing                             | KB §12.1                    |
| 60/61/62 | PO / GRN+Supplier Invoice / PR | requisition→order→receive→3-way-match→GL (Dr expense + input-VAT, Cr supplier net of WHT + WHT)       | KB §8.5                     |
| 66       | Document Verification          | gated /verify + public /scan (tamper verdict, no confidential leak)                                   | §8.4 doc DNA                |
| 29       | Operations File 360°           | rollup of costing, actual GL cost, billed + outstanding, milestones, procurement, docs → gross margin | KB §6.7 cost object         |

Also fixed: the nested AI modules `ai/governance` and `ai/insights` had a wrong
relative path (`../../config` → corrected to `../../../config`). They still carry
Phase-4 scaffold debt (they import `utils/money` and `config/brands`, which do
not yet exist), so the loader continues to skip them safely — no boot impact.

---

## 3. Convention compliance (BUILD_CONVENTIONS.md)

- **SQL only in repos.** Confirmed for every module built this sprint; services
  orchestrate `BEGIN/COMMIT/ROLLBACK` and call repo methods. `eslint src --quiet`
  reports 0 errors.
- **Save-to-draft → edit → post → get-back.** Honoured by every document with a
  lifecycle: final invoice, supplier invoice, purchase order, cash request,
  receipts. Posting is terminal (locked); corrections go through reversal, never
  edit-in-place (ledger #23.16).
- **Capture-once / update-in-sync.** Every module that allocates a document
  number captures into `document_vault` on post/issue (final & supplier invoice,
  PO, transit order, delivery note, cash request, receipt).
- **Numbering is tenant-configurable.** All allocation goes through
  `numbering.service`, which reads per-tenant schemes from `setting`; nothing is
  hard-coded.
- **Business rules from settings, not code.** Demurrage tariff
  (`commercial.demurrage_tariff`), dunning policy (`finance.receivables_dunning`),
  three-way-match tolerance (`procurement.three_way_match`), régie window
  (`finance.regie`) are all read at runtime.
- **Approval chains + AI-generate→approve.** Final invoice remains the exemplar
  (registered with the approval dispatcher); the new lifecycle modules expose the
  same submit/transition surface a chain or the AI can drive.

## 4. Accounting correctness spot-checks (unit-tested)

- Supplier-invoice posting balances: Dr expense + Dr input-VAT (4452) = Cr
  supplier net-of-WHT (4011) + Cr WHT payable (4471). Tested.
- Debt repayment balances: Dr 162 principal + Dr 671 interest = Cr treasury.
  Tested.
- Receipts: full amount Dr cash / Cr 4111; allocation is sub-ledger (FIFO),
  overpayment leaves an unapplied remainder. Tested.
- Margin excludes débours from the margin base; TAFIRE sections sum to the net
  cash change (opening + operating + investing + financing = closing). Tested.

## 5. Residual items (not Phase-1/2 blockers)

- **PDF/Email runtime** — service code is complete; needs Chromium + SMTP
  provisioning (Phase 5 infra).
- **`tax_jurisdiction` (MOD-07)** — generic CRUD over a seeded lookup; acceptable
  as reference data. Could be given a thin validator if desired.
- **MOD-54 Asset Management** — tables exist; the depreciation-posting module is
  Phase 3.
- **MOD-27 Pricing Variance Index** — the simulator (P2) is done; the
  sales-facing R/Y/G variance index is Phase 4.
- **Sales cycle MOD-20..26** and the **AI service layer** — Phase 4.

## 6. Test ledger

31 unit suites, 188 tests passing (2 DB-gated integration tests skipped).
New this sprint: `simulators`, `receivables`, `procurement`, `phase12-gaps`,
plus `statements-extra` (TAFIRE) and `document-verification-scan` extensions.
