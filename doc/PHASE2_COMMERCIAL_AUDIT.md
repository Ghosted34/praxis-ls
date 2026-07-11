# Praxis LS — Phase 2 (Commercial Cycle) Audit & Build Plan

**Date:** 2026-07-10
**Scope:** Phase 2 per `WORK_TO_BE_DONE.md`, verified against the actual
`migrations/tenant/*.sql` and `src/modules/{master,operations,commercial,costing,procurement,sales}/*`,
governed by the OHADA/tax KB (esp. §6.7 dossier costing, §8) and the PRD.
Built to `doc/CONVENTIONS.md`, `doc/BUILD_CONVENTIONS.md`, `doc/AI_READINESS.md`.

## Verdict: same shape as Phase 1 — the schema is built, the brain is not.

The Phase 2 data model is comprehensive and well-shaped (dossier, client/supplier
master with KYC/credit/withholding-agent flags, costing with a margin + approval
lifecycle, `cost_entry` posting to `journal_entry`, milestone templates/instances,
PO/GRN with `three_way_matched` + status lifecycle, `fx_rate_daily` with manual
override, `currency`, `service_type` with territory). But **every Phase 2 module
is the generic 5-line CRUD stub** except `financial_dictionary` and `regie`. The
domain logic — the commercial cycle around the dossier — is unbuilt.

## What is solid (build on it)
Tables present and correctly modelled:
`corporate_entity, client_type, client_master, supplier_master, employee` ·
`service_type, dossier, milestone_template(_stage), milestone_instance,
transit_order, delivery_note, q_ticket` ·
`costing, costing_line, cost_entry, purchase_request, purchase_order,
purchase_order_item, goods_received_note` ·
`quotation(_line), margin_simulation(_line), extra_charge_simulation,
pricing_variance` · `currency, fx_rate_daily` · `supplier_invoice(_line),
cash_request(_line/_payment)`.
Phase 1 already delivered: ledger posting, determination, invoicing (proforma +
final invoice), régie aging, statements, tax center, numbering, document capture,
workflow executor, settings.

## The gap — build order (dependency-first)

### 1. Master data (MOD-03/04/16) — foundational, everything references it
Real modules over `client_master` (KYC docs, credit_limit, payment_terms,
is_withholding_agent), `supplier_master` (incl. mobile money), `corporate_entity`,
`employee`, `client_type`, `service_type`. Add validation + a **credit-limit check
helper** (invoicing/costing consults it) + KYC completeness. Lifecycle where
sensible; reads everywhere.

### 2. Currency & live FX (MOD-08) — infra used by costing/invoicing
`fx.service`: daily `exchangerate-api` fetch → `fx_rate_daily` (worker cron),
manual override/fallback, and a **rate resolver** (`rateFor(base,quote,date)`)
that stamps a per-transaction rate. Costing/invoicing read the stamped rate.

### 3. Operations File Registry — the dossier (MOD-29) — the cost object
Dossier lifecycle (OPEN→IN_PROGRESS→COMPLETED→CANCELLED), `ref` numbering (via
numbering.service), service_type/territory taxonomy, owners (ops/sales). Every
downstream money line tags `dossier_id` (KB §6.7). This is the heart of Phase 2.

### 4. Milestone engine (MOD-30) — versioned templates → instances
`milestone_template(_stage)` per service_type (versioned); on dossier open,
instantiate the active template's stages into `milestone_instance`; advance
stages (PENDING→IN_PROGRESS→DONE) with evidence; push to Client Portal (Phase 4).

### 5. Project costing (MOD-46/47/48/49) — posts to the ledger, tagged dossier
`costing` + `costing_line` (draft→validate→approve lifecycle, margin %, débours
excluded from margin per §6.7); **cost_tracking** = actual `cost_entry` rows
posting to GL tagged `dossier_id` (Dr class 6 or 4731 for débours); **cost
reconciliation** budget(costing) vs actual(cost_entry); project disbursal =
régie (built). Dossier margin = Σ706/707 − own direct costs, débours excluded.

### 6. Simulators (MOD-27) — no GL impact
`margin_simulation(_line)` and `extra_charge_simulation`: pure what-if math over
dictionary items + FX; never touches the ledger. Pricing Variance Index feeds
Sales (R/Y/G vs real costing, no raw cost exposure) — Phase 4 UI.

### 7. Invoicing → tie to dossier (MOD-50/51) — mostly built in Phase 1
Proforma/advance (4191) and final invoice (revenue + débours recovery + VAT +
advance clear) exist. Phase 2 work: bind them to the dossier + costing (pull
lines from costing), stamp FX, honour client credit limit / withholding-agent.

### 8. Smart Receivables Ledger (MOD-52)
Ageing buckets (current/30/60/90+), payment_receipt → payment_allocation against
invoices, `cached_receivables`/`cached_overdue` refresh on the client, reminder
cadence (tenant setting) → email worker. Bad-debt path (§8.15).

### 9. Procurement (MOD-60/61) — PR → PO → GRN, three-way match
`purchase_request` → `purchase_order` (issue/approve lifecycle, numbering) →
`goods_received_note` (+ supplier_invoice) with the **three-way match**
(PR↔PO↔GRN↔supplier invoice) setting `three_way_matched`; on match, post the
supplier invoice to GL (Dr 6xx + 4452 VAT / Cr 4011, KB §8.5), tagged dossier
for operational spend.

### 10. Transit orders & delivery notes (MOD-31/32) — operational docs
`transit_order`, `delivery_note` lifecycle + numbering + document capture; no GL.

### 11. Operations-File 360° (MOD-29 view) — aggregation
A read service assembling header + milestones + people + role-gated money
(costing/invoices/receivables, field-visibility applied) + documents + comms +
audit for one dossier. Powers the 360° modal.

## Cross-cutting (every module, per the conventions)
- Lifecycle: draft → submit → approve → post/lock, list + get; locked = immutable.
- SQL only in repos; services orchestrate + own the transaction.
- Numbered docs allocate from `doc_sequence` + capture in `document_vault`.
- Approvable docs bind a workflow; the executor + dispatcher post on approval.
- `<module>.ai.js` manifest + screen-registry entry per module.
- Tenant business rules (credit terms, reminder cadence, margin floor, FX source)
  read from `setting`, never hard-coded.
- Money tagged `dossier_id`; débours excluded from margin/turnover (§6).

## Standing caveat (unchanged)
No Postgres in this sandbox: domain logic is proven at unit/mock level + by DB
constraints/triggers; the DB-gated integration suite + seed runs need a
provisioned tenant DB to confirm end-to-end.

## Recommended build sequence
1 → 2 → 3 → 5 → 4 → 8 → 9 → 6 → 10 → 7(bind) → 11. (Master + FX + dossier first;
they unblock everything. Costing before milestones since costing feeds margins.)
