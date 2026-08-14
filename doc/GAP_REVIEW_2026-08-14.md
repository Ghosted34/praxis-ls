# Praxis LS — Gap Review

**Date:** 14 August 2026 · **Repo:** `main` @ `37e5846`
**Basis:** `SmartLS_PRD_Master_Functional_Spec_v2.md` and `Praxis_LS_Kickoff_Meeting_Transcript.md`, both read in full, verified against source — `src/modules`, `client/src` (112 screens), 125 tenant migrations, `src/jobs/workers.js`, `.github/workflows/ci.yaml`.

Pure gaps only. Architecture deviations that just need the PRD amended are excluded.

---

## P0 — unmet `[RULE]`s

### G1 · Bilingual EN/FR missing from the app UI

PRD §14/§15.1 require full EN/FR with a top-bar toggle; the meeting (§11.3) was emphatic that OHADA account names are French-only and rough translations won't do.

- **Done:** data-level labels (`label_fr`/`name_fr` on `chart_of_accounts`, `dictionary_item`, `service_type`, `milestone_template` — migrations `0200`, `0310`, indexed in `0504`); PDF templates bilingual (`title: { fr, en }` in `documents/templates/registry.js`, `fr-FR` XAF formatting).
- **Missing:** the entire UI layer. No i18n dependency in `client/package.json`, no locale files under `client/src`, no toggle in `app-shell.tsx`. All 112 screens hardcoded English.

Compounds with every screen shipped. Land the runtime and shell now even if per-screen translation trails.

**DoD:** i18n runtime + `en`/`fr` dictionaries at the shell; language on the existing `preference` module; top-bar toggle; statutory output defaults to FR; CI check blocking new hardcoded user-facing strings.

### G2 · Sandbox doesn't sandbox its side-effects

PRD §5.5 `[RULE]`: in Test mode — no real client emails, no real AI spend (or hard cap), separate numbering, watermarked PDFs.

| | |
|---|---|
| Separate numbering | ✅ falls out of schema separation (`doc_sequences` is per-schema) |
| No real client emails | ❌ `jobs/handlers/email-send.js` uses `env` only to pick the connection, then sends |
| No real AI spend / cap | ❌ nothing in `services/ai/*` or `ai/governance` branches on env |
| Watermarked PDFs | ❌ `templates/kit.js` supports watermarks, `registry.js` sets `PAID`/`COPY` — nothing sets TEST/SANDBOX |

Concrete failure: a training session in Test, on a tenant with SMTP configured, emails a real invoice to a real client. Training is precisely what the sandbox was specified for, so this gets exercised on day one of the first rollout.

**DoD:** env-aware guard in the email service (suppress or redirect to a logged sink); sandbox AI budget forced to a hard low cap or mock vendor; `watermark: "TEST"` on any non-live render; one test per leg.

### G3 · Sandbox auto-wipe is never scheduled

PRD §5.5 and the meeting both lock a wipe cron, default 14 days. `scripts/db/sandbox-wipe.js` exists and `tenant.sandbox_wipe_days` is read in `registry.service.js` — but `src/jobs/workers.js` registers repeatables for orchestration, mail-sync, webhook-renew, retention, health, FX, backup, prune and object-sync, and **nothing for sandbox wipe**. It only runs if someone remembers the CLI.

Also silently breaks the space rationale (PRD §6.2 — the 75 GB box is tight).

**DoD:** repeatable in `workers.js` reading `sandbox_wipe_days` per tenant; a test asserting Live schemas are unreachable from the wipe path.

### G4 · "Powered by JBS Praxis LLC" missing from login/splash

PRD §5.4 `[RULE]`, and the founder raised it twice (meeting §11.1 — the login page as marketing surface). Currently appears only in `client/src/features/portal/portal-chrome.tsx:50`. Not on tenant login, not on splash.

Minutes of work, highest external visibility of anything on this list.

---

## P1 — feature surface

### G5 · God Mode: regex accounting guard, no dependency preview

`godmode.service.js` correctly requires an Argon2-verified PIN and writes the full removed payload to the ledger. Two problems:

**The accounting exclusion is a naming convention, not a referential check.** PRD §8.5 `[RULE]` excludes all posted accounting records. The implementation:

```js
if (/^(invoice|journal|receipt|payment|asset|payroll):/i.test(row.entity_ref || "")) { … refuse }
```

`credit_note:`, `supplier_invoice:`, `cash_request:`, `regie:`, `depreciation:` are all plausible today and all purgeable. Every new posting module depends on someone remembering to edit a regex in an unrelated file.

**No dependency preview.** Meeting §11.2 is specific: *"It shows every file connected to the record and asks whether to delete across everything."* `POST /god-mode/purge` takes a `softDeleteId` and acts.

**DoD:** replace the regex with a real check — does this entity carry any `journal_entry` / `immutable_ledger` reference, discovered by catalogue the way `party_merge` already discovers FKs (the technique is already in-house). Add `GET /god-mode/:id/dependencies`. Add a test enumerating every posting-linked table and asserting each is refused.

### G6 · No public, website-facing surfaces

Only unauthenticated tenant routes are `/maintenance` and the QR `/document-verification/scan` — verified by scanning every `*.routes.js` for auth (only the deprecated, unmounted `ai/ai.routes.js` lacks one; that coverage is genuinely good). So four specified public surfaces don't exist:

- **Website lead / quote-request intake API** (meeting §11.5; MOD-20/25) — `inbound_intake` is internal-only.
- **Public job-application UI** (meeting §11.4) — *"candidates upload CVs and answer a few questions, feeding applications straight in."* `vacancy` has `addApplicant`, no public path to it.
- **Vacancy posting to the tenant website** (MOD-11).
- **Portfolio / success-story push to the tenant website** (meeting §11.5; MOD-26) — the stated point was *"no back-end engineer needed to hand-code portfolio updates."*

Commercially load-bearing: the meeting positions website connection as a sellable package.

### G7 · Expense Rates has no Excel import

Locked as a ✅ Decision in the meeting (§11.3): onboarding collects rates and shipping lines via *"an Excel template the client fills, which we import."* `exceljs` is a dependency (used for export) but there's no import path in `master/expense_rate`.

Matters more than it looks — the rate card is the entire mechanism behind the costing speed-up the founder highlighted (*"~a day to ~10 seconds"*), and it's a per-tenant onboarding task. Without import, every new tenant's rate card is hand-keyed.

### G8 · Support & Feedback: context capture never wired

The module is otherwise right — `platform.support_ticket` in the central platform DB keyed by `tenant_id` (console triages across tenants with no cross-tenant fan-out), every tenant query scoped, `submitCsat` refused until `SHIPPED`/`DECLINED`, and `platform-console/src/features/Support.tsx` renders the full `NEW → TRIAGED → IN_PROGRESS → SHIPPED → DECLINED` kanban.

**Gap:** the meeting's Pixie Girl model (§11.16) — *"Need help? Send this to your system admin"* capturing an auto-screenshot plus full context (hub, area, page, action, error). The `context` jsonb column exists and the service accepts it; `support-page.tsx` posts only `{ kind, title, body }`. Nothing populates it.

`client/src/lib/error-reporting.ts` already captures route + error (ErrorBoundary + `window.onerror` + `unhandledrejection`, deduped, `sendBeacon` on unload). Wiring it to pre-fill `context` closes most of this; the screenshot is the only new piece.

### G9 · Multi-entity consolidation: schema exists, nothing reads it

`corporate_entity` carries `parent_entity_id`, `relationship_type`, `ownership_percent`, `consolidates`, `is_group_parent` — unconsumed. The MOD-63 report registry has nine producers (income statement, bilan, trial balance, TAFIRE, receivables ageing, reminders, cash position, procurement spend, dossier margin), none consolidated.

PRD §13 and Settings §12 both call for a group read layer for Management/Investor. A tenant with two entities gets two sets of books and no group view.

---

## P2 — readiness

### G10 · Integration coverage is 5 files

`tests/integration/` holds 5 tests (`journal-posting`, `ledger-hardening`, `mail-imap`, `orchestration-import-freight`, `party-merge`) against 176 test files total, and CI runs `npx jest` with no Postgres service container.

Untested end-to-end: gap-free numbering under concurrency, RBAC enforcement, three-way match, receipt allocation, TAFIRE, tax returns. Highest-value next investment on this list.

### G11 · No load test

Nothing — no k6, artillery or autocannon. PRD §14 targets p95 < 400 ms at 20–50 concurrent users per tenant.

### G12 · MySQL → PostgreSQL migration tooling: zero lines

No `mysql` reference anywhere in `scripts/` or `src/`. Correctly deferred (PRD §16 makes migration client-owned, post-build) — but *"with our tooling/support"* is a commitment, and the staging-schema reconciliation approach should be designed before Phase 5 opens, not during it.

### G13 · Key rotation and history secret scan unconfirmed

CI has a working-tree secret scan, `npm audit` blocking at high with a dated exception, and CodeQL — all good. But the scan's own comment notes **git history is not covered**, and `scripts/scan-history-secrets.sh` exists outside CI.

PRD Appendix A states the discovery-shared Gemini / Groq / DeepSeek / exchangerate keys are *"considered exposed and MUST be rotated before build."* Confirm rotation happened; run the history scan once.

### G14 · Backup off-box destination and restore drill cadence

`backup-run.js` and `db:objects:sync` exist and are scheduled. PRD §6.3 additionally requires backups shipped **off-box** with **monthly restore tests** (`db:restore:drill` exists, unscheduled). Confirm the off-box destination is configured in production and put the drill on a cadence.

### G15 · Provider runtime enablement

PDF/Chromium, Groq voice, Gemini vision, SMTP, FX all throw until keys or binaries are present. Needs one documented tenant-onboarding checklist run against `/vendors/:vendor/test`.

---

## Suggested order

1. **G2** sandbox side-effects — smallest fix here, and the only one that embarrasses you in front of a client during training. Before the first rollout.
2. **G3** schedule the wipe — one repeatable in `workers.js`.
3. **G4** login strapline — minutes.
4. **G1** start bilingual EN/FR — land the runtime and shell now; it only gets worse.
5. **G5** God Mode referential guard — before another posting module ships.
6. **G7** Excel rate import + **G6** public intake — onboarding and commercial blockers for tenant #2.
7. **G8** wire `error-reporting.ts` into ticket `context` (small), then **G9** consolidation.
8. **G13/G14** confirm rotation, off-box target, drill cadence — cheap, and they're assurances already given.
9. **G10** integration suite against real Postgres → **G11** load test → **G12** migration tooling.

---

*Read directly from source at `37e5846`, not from the repo's status docs.*
