# Praxis LS — Full Audit, Phases 0–4 (every src file, docs, flow, principles)

Scope: audit **every** `src/**.js` file (713 total) for reachability/dead code,
completeness against the `doc/` corpus (PRD, OHADA KB, AI architecture, RBAC
journey, build conventions), end-to-end flow, and principle adherence. The bar:
*if the code cannot "talk" (implement) the documented requirements, it isn't done.*

Method: a require-graph reachability walk from the real entry points (`server.js`,
`routes/index.js` → module-loader, `jobs/workers.js`, the AI registrar/orchestrator,
and every `*.routes.js`/`*.ai.js`), diffed against all 713 files; plus a
service-by-service census (real vs generic `makeService` stub) and route-gating scan.

---

## 0. Headline verdict

**What the code already "talks":** the accounting spine (P1) and commercial cycle
(P2) are real end-to-end — master data → dossier → costing → invoicing → GL →
statements/tax → receivables — with OHADA invariants enforced in DB triggers and
mirrored in pure, tested rules. The **sales funnel** (P0-adjacent/P4) now connects
lead→opportunity→proposal→quotation→dossier. Core **P4 AI** (governance, catalogue
registrar, gated orchestrator, batch plans, voice/vision workers, reporting,
pricing-variance, compliance) is real and DB-driven.

**What it does NOT yet talk (must close):**
1. **CRITICAL security hole** — the tenant router has no global auth; several real
   routers ship **no `authMiddleware`**, so they run unauthenticated. Worst:
   **`POST /tenant/god-mode/purge`** (CEO purge console) and `/workspace`,
   `/dashboard`, and the AI `/ai` assistant. This directly violates the RBAC
   journey doc. Must gate immediately.
2. **Phase-0 security admin** — CORRECTED after closer read: the census flagged
   these "stub" for using `makeService` boilerplate, but the security-critical
   behavior was largely REAL (session `kill` invalidates store+cache; `permission`
   `upsertGrant` fires Watch-the-Watcher + invalidates cache; `audit_ledger` has
   maker-checker restore; `app_user` login/2FA/refresh real). Genuine gaps found
   & FIXED: `app_user` create stored an UNHASHED password + list/get leaked
   `password_hash`/`totp_secret_enc` (now Argon2id + safe-cols + lifecycle +
   last-CEO guard); `setting` was CRUD-by-id not a real section/key config hub
   (now real); and `scope`/`field_visibility`/`capability`/`iam_role` writes did
   NOT invalidate the grant cache → up to 30s of stale RBAC (now invalidate on
   every write; iam_role guards system/CEO-role deletion).
3. **`workflow` module is a generic stub** though the executor service is real —
   the "tenant configures its own hierarchy + level powers" requirement has an
   engine but no real config API surface.
4. **`commercial/quotation` is a stub** yet it's a first-class node in the cycle
   (proposal→quotation, quotation↔opportunity, pricing variance).
5. **Foreign/dead code still in the tree** (below) — 29 orphan files, most of them
   leftovers from the old "Maroon Noir / Naira ₦ / WhatsApp" system.
6. **Phase 4 remainder**: portals (client/investor/audit room) and Smart Comms
   (WebSocket + certified export) are stubs; that's expected but not done.

Net: Phases 1–2 are production-shaped; Phase 4 has a real spine with named gaps;
**Phase 0's security admin layer and the auth-gating hole are the highest-priority
"code doesn't talk the doc yet" items.**

---

## 1. Dead / orphan files (29) — RETAINED for reuse

Reachability: **684 / 713 reachable**, 29 orphans. **Decision: keep all 29** — some
will be reused (e.g. media/spreadsheet/socket/queue helpers). Nothing deleted.
Classified below only for awareness; revisit at Phase-5 hardening.

### 1a. Foreign leftovers — safe to delete (old system; not wired, wrong domain)
These are from the prior "Maroon Noir" ERP (Naira `₦`, `business` column,
socket.io/web-push, Meta WhatsApp, sharp image pipeline) — same class as the
Phase-0 Pixie Girl purge:
- `src/services/notifications.service.js` (shared.notifications, `business`, web-push)
- `src/services/whatsapp.service.js` (Meta WhatsApp Cloud API)
- `src/services/geoapify.service.js` (HR clock-in geocoding)
- `src/services/media.service.js`, `src/services/media-compression.service.js` (sharp)
- `src/services/icon-pipeline.service.js` (favicon/PWA generation)
- `src/services/spreadsheet.service.js`, `src/services/excel/workbook.js` (Maroon Noir ₦ xlsx)
- `src/config/database.js` (superseded pool; only referenced by other orphans)
- `src/config/socket.js`, `src/config/support.js`, `src/config/tenants.js` (empty/foreign)
- `src/config/request-context.js`, `src/jobs/corn-lock.js` (typo "corn"; foreign cron lock)
- `src/middleware/audit.js` (foreign; audit is done in-service via shared/events/emit)

### 1b. Duplicates of already-wired services — safe to delete
- `src/services/transcription.service.js` (dup of `services/ai/transcription.service.js`)
- `src/services/numbering.service.js` (dup of `services/documents/numbering.service.js`)
- `src/services/fx.service.js` (FX lives in `master/currency`)
- `src/services/pdf.templates.js`, `src/services/pdf.tenant-docs.js` (pdf.service uses neither — verify no future need)

### 1c. Deprecated / dead stubs — delete or wire
- `src/modules/ai/ai.controller.js` — explicitly `// DEPRECATED`, exports `{}`. Delete.
- `src/modules/finance/tax_declaration/tax_declaration.repo.js` — 3-line stub; the
  service delegates to `financial_statement.repo`. Harmless; delete or fold in.
- Orphan bespoke validators (their modules use generic `makeRouter`, so the
  validator is never wired): `dashboard/dashboard`, `dashboard/godmode`,
  `dashboard/workspace`, `security/audit_ledger`, `vault/document_vault`
  `.validator.js`. These are symptoms of those modules being generic stubs.

### 1d. Keep — pending wire, not dead
- `src/jobs/queue.js` **and** `src/jobs/queue-producer.js` — two enqueue helpers;
  nothing enqueues yet (workers consume). Keep ONE, delete the redundant one when
  a module first enqueues (email/pdf/ai jobs).
- `src/middleware/ai-gate.js` — thin `requireAiFeature` alias; superseded by the
  governance gate in the orchestrator, but harmless as a route-level convenience.
- `src/config/socket.js` would be replaced by a real WS server when Smart Comms
  is built (currently foreign — see 1a).

---

## 2. Completeness census (real vs generic-stub service, by group)

| Group | Real | Stub | Notes |
|-------|-----:|-----:|-------|
| master | 10 | 0 | ✅ complete (incl. CoA, treasury, tax jurisdiction) |
| finance | 8 | 0 | ✅ ledger/invoicing/statements/tax/receivables/debt |
| costing | 4 | 0 | ✅ costing/tracking/regie/cash-request |
| operations | 4 | 0 | ✅ dossier/milestone/transit/delivery |
| procurement | 4 | 0 | ✅ PR/PO/GRN/supplier-invoice |
| commercial | 3 | 1 | 🟡 **quotation stub** |
| vault | 5 | 0 | ✅ vault/sig/verify/report/compliance |
| sales | 7 | 0 | ✅ full funnel |
| dashboard | 3 | 0 | 🟡 real but **ungated** (see §3) |
| ai | 2 | 0 | ✅ assistant/governance |
| catalogue, branding | 2 | 0 | ✅ |
| **security** | **1** | **9** | 🔴 **admin surfaces generic** (P0 gap) |
| workflow | 0 | 1 | 🔴 **config surface generic** (engine real) |
| notification | 0 | 1 | 🟡 generic (acceptable for read/ack) |
| smartcomm | 0 | 1 | ⬜ Phase-4 (WS pending) |
| fleet | 4 | 3 | Phase 3 (partial) |
| hr | 4 | 5 | Phase 3 (partial) |
| wms | 2 | 4 | Phase 3 (partial) |

Phase 0–2 + sales + AI core are real. The **P0 security admin** and **workflow
config** stubs are the in-scope completeness gaps; hr/fleet/wms are Phase 3.

---

## 3. Principle adherence

- **Auth gating** — 🔴 FAIL for 4 real routers (`god-mode`, `workspace`,
  `dashboard`, `ai/assistant`): no `authMiddleware`, and the tenant router applies
  none globally. The generic `makeRouter` path DOES gate; the failures are these
  bespoke routers. **Fix: add `authMiddleware` + `requirePermission` (God Mode →
  CEO-only).**
- **SQL only in repos** — ✅ across all P1/P2/P4 real modules (verified; `eslint`
  clean). One dead stub repo (tax_declaration) delegates instead.
- **events.js declares every emitted key** — ✅ enforced this session (0 undeclared
  literals across all modules).
- **DB-first vendor/operational keys, env fallback** — ✅ AI, SMTP (per-purpose
  `email_identity`), FX all resolve DB→env.
- **Numbering + capture-once + reversal-not-edit** — ✅ on every posting document.
- **Business rules from settings** — ✅ (dunning, demurrage, three-way tolerance,
  régie window, pricing-variance thresholds).
- **AI-readiness (`.ai.js` per module)** — ✅ every real module ships one; catalogue
  auto-derived, `ai_enabled` gated by vetted executor (no drift).

## 4. End-to-end flow (does the chain connect?)

✅ enquiry/lead → opportunity(win) → dossier → costing/cash-request(régie) →
proforma/advance → final invoice → GL posting → statements/TAFIRE/tax → receipt →
receivables ageing/dunning; procurement PR→PO→GRN→supplier-invoice→GL; proposal→
quotation→(opportunity). Reporting + pricing-variance + compliance read across it;
the AI can drive any of it through the propose→confirm pipeline. The chain is
continuous. **Gap:** `quotation` is a stub, so proposal→quotation and pricing
inputs are thin; and there is no client/investor **portal** surface yet.

## 5. Readiness caveats
- No Postgres in this environment → everything verified at unit/mock/trigger-design
  level; DB triggers remain the runtime authority. A real integration run against
  a provisioned tenant is still owed.
- PDF/voice/vision providers throw "not configured" until keys are set (by design).
- Test coverage is strong on pure rules; thin on controllers/routes (no e2e HTTP).

---

## 6. Prioritized close-out list (to make the code fully "talk the docs")
1. **Gate the ungated routers** (God Mode CEO-only, workspace/dashboard/assistant auth). — security, do first.
2. **Real `security` admin modules** (app_user w/ Argon2 + lifecycle, session token logic, iam_role/permission/scope/field_visibility editing, setting surface, audit_ledger read) — Phase-0 completion.
3. **Real `workflow` config module** (create workflow/steps, level powers) over the existing executor.
4. **Real `commercial/quotation`** (lines/totals, send/accept→final invoice).
5. **Delete the §1a/§1b/§1c foreign + duplicate + deprecated files** (after your review).
6. **Phase-4 remainder**: portals + Smart Comms (WS + certified export).
7. Phase 3 (hr/fleet/wms/assets/payroll) — out of 0–4 scope but present as stubs.
