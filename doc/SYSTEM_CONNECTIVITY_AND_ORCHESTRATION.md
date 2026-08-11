# Praxis LS — End-to-End Connectivity & the Orchestration Layer (Plan A)

**Status:** analysis + draft plan for discussion.
**Read alongside:** `DB_ARCHITECTURE.md` (§2 config→execution, §6 operations spine), `PHASE_MODULE_MAP.md`, `MODULE_DEPTH_AUDIT.md`, `WORK_TO_BE_DONE_NEXT.md`, the PRD Master Functional Spec v2, and the OHADA/Tax KB.
**One-line thesis:** the system is *integrated by a shared cost object and reporting*, but not yet *orchestrated end-to-end by events* — that missing write-time automation is what makes the modules feel disconnected.

---

# Part I — How the system connects today

## 1. The spine: the dossier (Operations File, MOD-29)

Everything financial hangs off one analytical cost object — the **dossier**. Every downstream money line carries `dossier_id` (the column is referenced across ~87 module files), and the dossier's 360° view (`operations_file.service.overview` → `operations_file.repo.overview`) aggregates the entire chain by `dossier_id`:

- planned cost (`costing` + `costing_line`, split service vs `is_disbursement`),
- **actual** cost (`cost_entry`),
- final invoices (locked: `service_ht` / `disbursement_total` / `vat_total`),
- receivables outstanding (`invoice` − `payment_allocation`),
- milestones (`milestone_instance` by status),
- procurement (`purchase_order` count + total),
- transit orders, delivery notes, vault documents,
- segregation-of-duties people (who validated/approved costing and invoices).

At the data layer, the linkage is real — not cosmetic. The margin math (`revenue_ht − actual_cost`) is computed from genuinely joined downstream rows.

## 2. The organizing pattern: config → execution

Across the whole schema an **editable config layer feeds an append-only, invariant-guarded execution layer** (DB_ARCHITECTURE §2):

| Concern | Config layer (editable) | Execution layer (append-only) |
|---|---|---|
| Operations | `service_type`, `milestone_template` | `dossier`, `milestone_instance` |
| Accounting | `chart_of_accounts`, `dictionary_item`, `posting_rule`, `tax_code` | `journal_entry` / `journal_line` (`.dossier_id`) |
| Access | `role`, `capability`, `scope`, `permission`, `field_visibility` | endpoint/field checks |
| Workflow | `event_type`, `workflow`, `workflow_step` | `approval_task` |
| Pay | `allowance_type`, `payroll_component` | `payroll_run` / `payroll_run_item` |

Platform tier (Praxis console) decides plans/features; tenant tier (Settings) tunes within them. Nothing statutory is hard-coded.

## 3. The three pieces of connective tissue

1. **`dossier_id`** — the shared analytical dimension threading sales → operations → costing → procurement → invoicing → GL.
2. **The Universal Event Engine** — `event_type` / `workflow` / `workflow_step` / `event_log` / `approval_task`. Modules register events; approval chains are no-code; the same layer gates AI actions. *This is the intended orchestration backbone.*
3. **360° aggregation + reporting (MOD-63) + the immutable ledger** — the rollup/read and audit layer.

## 4. The golden thread (stage by stage)

1. **Sales/CRM** — inbound intake → lead → opportunity (pipeline) → proposal → quotation; winning an opportunity *can* open a dossier.
2. **Operations** — dossier opens; its `service_type` selects a milestone template → milestone instances; transit orders + delivery notes captured, all tagged `dossier_id`.
3. **Commercial** — margin / extra-charge simulators + quotation set the planned price; pricing-variance compares quoted vs actual.
4. **Costing** — planned cost lines (service vs débours), approved under SoD; `cost_tracking` writes **actual** `cost_entry` rows tagged `dossier_id`.
5. **Procurement** — purchase request → PO (tagged `dossier_id`) → goods received → supplier invoice **3-way match** → posts to GL.
6. **Fleet / WMS / HR** (supporting) — fuel logs, dispatch, inbound/outbound/inventory, payroll.
7. **Finance** — proforma/advance → final invoice (bound to dossier + costing) → GL → smart receivables (receipt → FIFO allocation → ageing → dunning).
8. **Ledger** — everything posts OHADA journal lines with `journal_line.dossier_id` as the analytical dimension; P&L / TAFIRE and dossier margin roll up.
9. **Reporting / AI / Portals / Compliance** read across it; the immutable ledger records every write.

## 5. What's real vs what's thin — the orchestration gap

Per-module depth is genuinely built (payroll statutory compute, OHADA ledger, receivables FIFO, 3-way match, quotation lifecycle — see `MODULE_DEPTH_AUDIT.md`). **What's thin is the write-time orchestration *between* stages.** Handoff-by-handoff:

| Handoff | Linked by `dossier_id`? | Auto or manual today? | Cost flows back to dossier/GL? |
|---|---|---|---|
| Opportunity won → dossier | n/a | **Manual/opt-in** (`opportunity.win({ createDossier })` flag) | — |
| Quotation accepted → costing/invoice | Yes | Manual | — |
| Costing approved → draft final invoice | Yes | **Manual** | n/a |
| PO → GRN → supplier invoice (3-way) → GL | Yes | Semi (match posts GL) | Partial — GL yes; `cost_entry` not auto |
| Fuel log → dossier cost | Yes (stores `dossier_id`) | **No posting** | **No** (KB §8.7 unmet) |
| Payroll run posted → dossier labor cost | No | n/a | **No** (GL only) |
| Fleet dispatch / work order cost → cost_entry | Partial | **No** | **No** |
| WMS outbound/inbound → milestone / cost | Stores `dossier_id` | **No** | **No** |
| Milestones all done → dossier COMPLETED | Yes | **Manual** | n/a |
| Invoice paid in full → dossier close | Yes | **Manual** | n/a |

**Reading:** modules line up along the dossier and aggregate correctly in read views, but an operator must manually create each next artifact, and several operational costs (fuel, labor, dispatch, WMS) never flow back into the dossier's actual cost — so the margin picture is structurally incomplete.

## 6. Root cause: `event_log` is written but never consumed

`shared/events/emit.emitEvent` writes an `event_log` row and fans out Watch-the-Watcher notifications **inline** — and that's all. Nothing *consumes* `event_log` to trigger cross-module actions. The "outbox dispatcher replaying a committed event" is referenced in a comment (`config/database.js`) but **does not exist**: no consumer, no `processed_at` marker, no handler registry. `event_log` today is an audit/notification record, not an automation bus.

That single absence is why the Event Engine — designed to be the connective backbone — isn't actually connecting anything at write time.

---

# Part II — Plan A: build the orchestration layer (DRAFT)

**Goal:** turn the Event Engine into real write-time connective automation, so a domain event in one module deterministically drives the next-stage artifact in another — closing the handoffs and the cost-flow-back gaps in §5.

## A0. Architecture decision — async outbox (recommended)

Two options:

- **Sync in-transaction handlers** — invoke the next-stage write inside the origin transaction. Atomic and immediate, but couples modules, lengthens transactions, and a downstream failure rolls back the origin business op. Rejected as the default.
- **Async outbox** (recommended, and the design DB_ARCHITECTURE already assumes) — `event_log` *is* the outbox. A dispatcher worker reads unprocessed rows and runs registered handlers, each in its **own** tenant-scoped transaction, idempotently, with retry + dead-letter. Decoupled, resilient, replayable. Eventual consistency is acceptable here (seconds).

## A1. Foundation (build once)

1. **Consumption marking — a separate `event_dispatch` table.** `event_log` is **append-only** (a `forbid_mutation` trigger blocks UPDATE/DELETE), so the consumption marker CANNOT be a column on it. Instead `event_dispatch(event_id → DONE|FAILED|DEAD, attempts, last_error)` tracks processing; the queue = event_log rows with no dispatch row, or a `FAILED` row under the retry cap. `DEAD` = dead-letter. *(Built: migration `0462_event_orchestration.sql`.)*
2. **Handler registry.** `event_type_key → [{ handler_key, feature, run }]`; a module ships a handler and registers it in `src/orchestration/handlers/index.js`, mirroring the `*.ai.js` manifest convention. *(Built: `src/orchestration/registry.js`.)*
3. **Outbox dispatcher + scheduler.** `dispatchPending(client)` runs on a tenant connection (BullMQ job `orchestration-dispatch` via `withTenantConnection`), invokes each event's handlers, records the outcome, retries `FAILED` up to the cap, then `DEAD`. **Handlers own their own transaction** (the module services already `BEGIN/COMMIT`), so the dispatcher does NOT wrap them in a shared tx — that would collide with a service's inner `COMMIT`; at-least-once + handler idempotency is what makes this safe. A BullMQ **repeatable `orchestration-scheduler`** (every `ORCHESTRATION_DISPATCH_INTERVAL_MS`, default 30s) enumerates LIVE tenants (`registry.listActiveTenants`) and fans a dispatch job per tenant × {live, sandbox}. *(Built: `src/orchestration/dispatcher.js`, `src/jobs/handlers/orchestration-dispatch.js`, `src/jobs/handlers/orchestration-scheduler.js`, scheduled in `jobs/workers.js`.)*
4. **Seed the event keys.** `event_type` keys are free-form citext today; seed the canonical ones the handlers subscribe to (`opportunity.won`, `costing.approved`, `grn.received`, `fuel_log.recorded`, `payroll_run.posted`, `invoice.posted`, `invoice.paid`, `milestones.completed`) with `is_security_critical=false`.

## A2. Cross-cutting rules every handler must honor

- **Idempotency** — dedupe on a natural key / `source_ref` (e.g. `cost_entry.source = 'fuel_log:<id>'`) so replays never double-post. Non-negotiable for money.
- **SoD is sacred** — system-initiated financial artifacts are created in **DRAFT** only; a human still validates/approves. Orchestration never auto-approves or auto-posts money.
- **Feature-gated** — a handler no-ops if its feature/module is off for the tenant (read `feature_state`).
- **Tenant + env scoped** — handlers run in the same schema (live/sandbox) as the origin event.
- **Audited** — every handler write emits its own `event_log` + `immutable_ledger` rows.
- **Error-isolated** — a handler failure dead-letters that one handler run; it never corrupts the origin op or blocks sibling handlers.

## A3. Handler catalog (the actual linkages), phased

**Phase 1 — the core money flow (highest leverage):**
- `opportunity.won` → **create dossier** (make win auto-open a dossier; keep a manual override for edge cases).
- `costing.approved` → **draft final invoice** from the costing lines (service + débours), status DRAFT, awaiting SoD.
- `grn.received` / `supplier_invoice.matched` → **create `cost_entry`** (actual cost) tagged `dossier_id` (idempotent on the source doc).
- `invoice.posted` → ensure a receivable is open (verify current behaviour; wire if missing).

**Phase 2 — operational costs flow back (fixes the margin gap):**
- `fuel_log.recorded` → **`cost_entry`** tagged `dossier_id` (KB §8.7).
- `fleet_dispatch` / `work_order` completion → **`cost_entry`**.
- `payroll_run.posted` → dossier labor allocation where labor is dossier-attributable (else GL-only, explicitly).
- `wms.outbound`/`inbound` completion → milestone advance and/or handling cost.

**Phase 3 — lifecycle & status propagation:**
- `delivery_note.captured` → advance the matching milestone.
- `milestones.completed` → flag dossier ready to COMPLETE (prompt, not force).
- `invoice.paid` (in full) → flag dossier ready to close.

### A3 build status

**Built** (`src/orchestration/handlers/`):
- `opportunity.won → open-dossier` — idempotent (skips if already linked); coexists with the manual `win({createDossier})` path.
- `dossier.created → instantiate-milestones` — stamps the service_type's milestone template onto a new dossier; skips cleanly on ALREADY_INSTANTIATED / NO_TEMPLATE / no service_type.
- `costing.approved → draft-invoice` — DRAFT shell bound to dossier+client; one per dossier; no fabricated prices, SoD intact. **Sync primary** (in `costing.service`) + this async backstop share `ensureDraftForCosting`.
- `supplier_invoice.posted → cost-entry` — links a `cost_entry` to the invoice's **existing** GL `entry_id` (no re-post); HT amount; idempotent on `entry_id`.
- `fuel_log.created → dossier-cost` — `recordCost` (GL + cost_entry) gated on `finance.fuel_expense_account`; idempotent on `source_doc_ref`.
- `dossier.updated → instantiate-milestones` — catches a service_type set after the dossier opens (reuses the created-handler run; idempotent).
- `transit_order.created` / `delivery_note.created → advance-milestone` — config-driven via `operations.milestone_map` (event → stage code); advances the mapped milestone to DONE; inert until mapped, skips already-DONE / disallowed transitions.
- `milestone.advanced → dossier.milestones_completed` — emits a completion signal once all milestones are DONE (added the missing emit to `milestone.advance`); idempotent (emits once).
- `fleet_dispatch RETURNED → driver-labour` — PRD §6.7/§1093 labour attribution: driver daily rate (`employee.base_salary` ÷ working days) × dispatch duration → analytical `cost_entry` on the dossier (661 already in payroll's GL — no re-post). Idempotent on `cost_entry.source_ref`.
- `work_order DONE → dossier maintenance cost` — a dossier-tagged completed work order's `cost` → `cost_entry` (links its GL `entry_id` if present, else analytical). Idempotent on source_ref.
- `outbound DISPATCHED → dossier handling cost` — OPT-IN via `wms.handling_rate = {flat?, per_unit?}`; derives handling cost from picked units → analytical `cost_entry`. Idempotent on source_ref.
- `receipt.posted → dossier.fully_collected` — resolves receipt → allocation → invoice → dossier and signals once a dossier's billed invoices are fully settled; idempotent; signal only (no transition).

(`cost_entry.source_ref` added in migration `0463` as the idempotency key for these analytical, non-GL attributions.)

**Signals consumed:** the `dossier.milestones_completed` / `dossier.fully_collected` signals are surfaced through `operations_file.overview.readiness` (`milestones_complete` / `fully_collected` / `ready_to_complete`, derived from live state so the badge is robust even if a signal was missed). The client 360° modal renders a readiness banner with a **Mark complete** action that transitions the dossier — closing the lifecycle loop.

**Completeness audit** (every module's `*.events.js` reviewed): beyond the deferred list below, four handoffs surfaced that were previously unwired — `proposal.accepted → quotation`, `quotation.accepted → dossier` (a `convert` flag already drafts the invoice synchronously), `purchase_request.approved → PO` (intentional manual — buyer picks supplier), and `dossier.updated → instantiate` (late service_type). All are now recorded in `handlers/index.js` so none is silently dropped.

**Resolved decisions — intentionally NOT auto-wired** (the deferred list is now closed; rationale in `handlers/index.js`): the **payroll run stays GL-only** (company-wide 661/664) — dossier labour is driver time attributed per-job from `fleet_dispatch` (above), never a blanket split off payroll; and commercial documents stay operator-driven (proposal→quotation and quotation→invoice keep their opt-in flags; PR→PO is a manual supplier choice; lead→opportunity is already in-service).

## A4. Observability

A **flow console** (admin) surfacing `event_log` → handler runs (succeeded / retrying / dead-lettered), with manual replay. Reuses the audit-ledger read patterns. Makes the orchestration legible and debuggable — and doubles as proof to the operator that "the flow flows."

## A5. Rollout & definition of done

1. A1 foundation + one trivial handler (`opportunity.won → dossier`) green against a **real Postgres** integration test. **DoD:** winning an opportunity yields a dossier automatically, idempotently, audited.
2. Phase-1 handlers, each with an integration test asserting the artifact appears in the dossier 360°. **DoD:** quote → dossier → costing.approve → draft invoice → GRN → cost_entry all chain without manual create, and the dossier margin reconciles.
3. Phase-2 cost-flow-back handlers. **DoD:** a fuel log / payroll run / dispatch shows up as actual cost on the dossier margin.
4. Phase-3 lifecycle. **DoD:** milestones/payment drive dossier status prompts.
5. Flow console + dead-letter replay.

## A6. Risks & mitigations

- **Double-posting** → idempotency keys on every financial handler (A2).
- **Runaway/circular chains** → handlers emit new events; cap chain depth + detect cycles in the dispatcher; never let a handler re-trigger its own origin event.
- **Auto-created money bypassing controls** → DRAFT-only + human SoD (A2); covered by tests.
- **Long/failed chains hiding problems** → the flow console + dead-letter queue make failures visible and replayable.

## A7. Decisions (resolved)

1. **Reference vertical: import freight forwarding.** Prove the full thread on one lane — enquiry → lead → opportunity → quote → **win → dossier** → transit/customs milestones → procurement (shipping line, customs duties as débours) → own last-mile costs (fuel/driver) → **costing.approve → draft invoice** → post → receivable → dossier margin. The integration test (A5) walks this lane.
2. **Payroll: GL-only; driver time is the dossier-attributable bit — and it comes from operations, not the payroll run.** Per KB §8.11 the monthly **payroll run posts company-wide** (Dr 661/664, Cr 431/447/422) with **no dossier dimension**. But KB §6.7 / §17 explicitly want **direct operational labour — "driver time" booked to 661 — dossier-tagged** as an own direct cost that reduces margin. That attribution can't come from the payroll run (it doesn't know which shipment an hour belongs to); it belongs to a future **driver-time-allocation handler off fleet dispatch / work order**. So: the `payroll_run.posted → dossier` handler stays **out** (correct as GL-only); a `dispatch/work_order → 661 dossier cost` handler is the real Phase-2 item.
3. **costing.approved → draft invoice is SYNCHRONOUS.** Implemented: `costing.setStatus(APPROVE)` opens the DRAFT invoice in-request via the tx-agnostic, idempotent `finalInvoice.ensureDraftForCosting`; the async handler runs the **same** function as an idempotent backstop. Everything else stays async (seconds-latency is fine).
4. **Flow console: deferred (follow-up).** It's an admin read screen over `event_log` + `event_dispatch` showing each event's processing state — handled / retrying / **DEAD (dead-letter)** — with a manual replay button, for debugging the orchestration. Valuable but not blocking; build after the handlers + scheduling are proven.
