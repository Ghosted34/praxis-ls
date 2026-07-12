# Praxis LS — Work To Be Done (post Phase 0–4 audit)

Derived from `PHASE0_4_FULL_AUDIT.md`. Ordered by priority. The 29 orphan files are
**retained for reuse** — not in this list. Each item has a definition-of-done so we
know when the code "talks the doc."

Legend: 🔴 blocking/security · 🟠 completeness gap (in-scope P0–P4) · 🟡 polish ·
⬜ later phase.

---

## P0 — Security & correctness (do first)

### 1. 🔴 Gate every unauthenticated router
The tenant router applies host-resolution + tenant-context only (no global auth).
These real routers currently run **unauthenticated**:
- `dashboard/godmode` → `POST /god-mode/purge` (CEO purge console) — **CEO-only**
- `dashboard/workspace`, `dashboard/dashboard`
- `ai/assistant` (`/ai/ask`, `/ai/actions/:id/confirm`, `/ai/batches/:id/confirm`)

DoD: each router `router.use(authMiddleware)` + appropriate `requirePermission`
(God Mode gated to CEO/God-Mode capability; assistant gated to `ai.assistant`
feature + an authenticated `req.user`). Add a boot-time assertion/test that every
mounted tenant router carries auth (so this can't regress).

### 2. 🔴 Harden the module-loader against ungated routers
Add a guard in `module-loader` (or a unit test over `discover()`) that fails the
build if a mounted router exposes a route with no auth chain, unless explicitly
allow-listed (e.g. the public QR `/document-verification/scan`).

DoD: test asserts the allow-list is the ONLY set of public tenant routes.

---

## P1 — Phase-0 completion: real security admin (RBAC doc)

The RBAC engine is real; the admin **surfaces** are generic `makeService` stubs.
Build real modules (rules + repo + service + validator + gated routes + `.ai.js`):

### 3. 🟠 `security/app_user` (MOD-67)
Create/disable/reactivate users, Argon2id password set/reset, force-logout, role
assignment. DoD: no plaintext passwords; password ops audited; cannot delete the
last CEO; lifecycle states enforced.

### 4. 🟠 `security/session` (MOD-68)
List active sessions, revoke a session/all sessions, token rotation, idle/absolute
expiry. DoD: revocation invalidates the refresh token; audited.

### 5. 🟠 `security/iam_role` + `permission` + `scope` + `field_visibility` + `capability`
Role CRUD; per-role module permission matrix (create/read/update/delete/approve);
data scopes; field-level visibility; capability toggles. DoD: editing a role's
permissions is reflected by `requirePermission` on the next request; every change
emits a security-critical event (Watch-the-Watcher) — verify the fan-out fires.

### 6. 🟠 `security/setting` (MOD-70) real surface
Validated CRUD over `setting` (sections: numbering, business rules, email, fx,
dunning, demurrage, three-way tolerance, pricing thresholds) — the tenant
self-config hub. DoD: writes go through `putSetting` (version bump); numbering
scheme validation reuses `numbering_setting`.

### 7. 🟠 `security/audit_ledger` (MOD-69) read surface
Query/filter the immutable ledger (actor, module, entity, date), export. DoD:
read-only; no mutation path; respects RBAC (who can see what).

---

## P2 — Phase-2 completeness gaps

### 8. 🟠 `commercial/quotation` (real)
Header + lines + totals (HT/TTC, quote model), status DRAFT→SENT→ACCEPTED→
CONVERTED, numbered + captured, accept→final invoice (or dossier). Wire the
proposal→quotation and opportunity↔quotation links that already reference it.
DoD: proposal.accept can target a real quotation; pricing-variance can read a
real quoted price.

### 9. 🟠 `workflow` real config module
Over the existing executor: CRUD workflows + steps, per-level powers (who can
approve at each level), bind a workflow to an event type, activate/deactivate.
DoD: "tenant sets up its own hierarchy + level powers" is doable via API; the
executor picks up the tenant's active workflow; sample seed workflow still works.

### 10. 🟡 `notification` module surface
List/mark-read/ack per user (the table + Watch-the-Watcher writes already exist).
DoD: users can read and clear their notifications; no duplicate notifier.

---

## P3 — Phase-4 remainder (intelligence & reach)

### 11. ⬜ Portals
- **Client Portal** (↔ dossier 360, invoices, documents) — scoped read surface for
  external client users.
- **Investor/Board terminal** (↔ statements/reporting) — read-only KPI room.
- **Audit Terminal / data room** (↔ vault + audit_ledger) — controlled document room.
DoD: each is a scoped, gated read surface reusing existing services (no new business
logic); external-user auth model defined.

### 12. ⬜ Smart Comms (`smartcomm`)
Real WebSocket messaging (server + `config/socket` wired), groups/threads, presence,
certified export of a conversation (hash + vault capture). DoD: messages persist,
export produces a verifiable document via the vault/verification path.

### 13. 🟡 AI layer follow-ups
- Event-driven re-embed handler (grounding freshness on `entity.action`).
- Per-user long-term memory (preferences) beyond conversation history.
- Retire/merge `middleware/ai-gate` vs governance gate (pick one).

---

## P4 — Cross-cutting readiness (before go-live)

### 14. 🟠 Integration tests against a real Postgres
Everything is unit/mock-level today. Stand up a provisioned tenant and test: ledger
balance/immutability triggers, numbering gap-free allocation, three-way match,
receipt allocation, TAFIRE, tax returns, RBAC enforcement end-to-end.
DoD: a CI job provisions a throwaway tenant DB and runs the integration suite green.

### 15. 🟠 HTTP/e2e coverage
Controllers/routes have thin coverage. Add supertest-level tests for the critical
flows (invoice lifecycle, receipt, procurement match, lead→opportunity→proposal).

### 16. 🟡 Provider runtime enablement
PDF (Chromium), voice (Groq/Whisper), vision (Gemini), SMTP, FX — all throw "not
configured" until keys are set. Document the tenant onboarding checklist + run the
`/vendors/:vendor/test` connection tests.

### 17. 🟡 Seed completeness
Verify seeds exist for: pipeline_stage (sales Kanban), email_identity defaults,
tax_code effective rows, COA statutory rows, default workflows. Add any missing.

---

## Later phases (out of P0–P4 scope; present as stubs)

### 18. ⬜ Phase 3 — People & assets
- HR: `attendance`, `hr_contract`, `leave_allowance`, `training`, `vacancy`,
  `payroll` (CNPS/IRPP/CAC/CFC/RAV auto-compute, KB §9) — 5 stubs + payroll depth.
- Fleet: `fleet_dispatch`, `incident`, `work_order` (3 stubs; fuel→dossier cost).
- WMS: `equipment`, `inbound`, `inventory`, `outbound` (4 stubs).
- Finance: `asset` (MOD-54) — acquisition→depreciation auto-post→disposal (KB §11).

### 19. ⬜ Phase 5 — Hardening & migration
CI secret/dependency scanning, load test (p95<400ms), encrypted backups + PITR,
MySQL→Postgres data migration + reconciliation, go-live (God Mode, Test/Live toggle,
audit). Revisit the 29 retained orphan files here — reuse or remove.

---

## Suggested execution order
1 → 2 (security gating, ~small, do immediately) → 6 (setting hub, unblocks config) →
3,4,5,7 (security admin) → 9 (workflow config) → 8 (quotation) → 10 (notifications) →
14,15 (integration/e2e tests) → 11,12 (portals, smart comms) → 13,16,17 (AI/runtime/
seeds) → Phase 3 → Phase 5.
