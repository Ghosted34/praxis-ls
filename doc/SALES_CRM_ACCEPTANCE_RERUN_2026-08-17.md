# Sales CRM Acceptance — External Rerun Checklist (2026-08-17)

**Date:** 2026-08-17
**Subject:** reruns required by §11.9 of `doc/SALES_CRM_ACCEPTANCE_AUDIT_2026-08-16.md`
**Scope:** recheck the changed transaction paths, F5 with a bilingual selected-language fixture, F10 with a status-specific refusal assertion, and each affected public/browser flow. Infrastructure suites (migrations apply-twice, PgBouncer, Chromium, Docker, two-tenant isolation) were already reported passed and are NOT re-run here unless a fix touched them (it did not).
**Owner:** Victor — runs these externally; this file only tracks the tasks.
**Repo commit under test:** `main` @ `20c27422` (post `5a3db511`, `3797a45b`)

---

## Legend

- [ ] pending — [x] passed — [~] passed with caveats noted

---

## 1. Transaction paths (F6, F7, F13) — failure-injection reruns

The audit's core Block-A finding was early-commit via nested `BEGIN`/`COMMIT`.
Fixed with `atomically()` (`src/shared/db/tx.js`) — a depth-countered transaction
owner. Reruns must PROVE rollback on injected failure, not just happy-path pass.

### T1 — F6 lead conversion rollback

- [ ] Convert a `QUALIFIED` lead in a live tenant.
- [ ] Inject a failure **after** client creation (make `repo.update`, event emit, or audit fail).
- [ ] **Expect:** no `client_master` row remains, no `party_registration` orphan,
      lead stays `QUALIFIED` (not half-converted), no audit/event rows for the
      conversion.
- [ ] Happy path re-run after injection removed: conversion succeeds once.

### T2 — F7 opportunity win rollback

- [ ] Win an open opportunity in a live tenant.
- [ ] Inject a failure **after** dossier/operations-file creation (milestone
      seeding or opportunity update fails).
- [ ] **Expect:** no orphan dossier / operations file / document-vault row,
      opportunity NOT marked won/linked.
- [ ] Happy path re-run: win completes with dossier + milestones.

### T3 — F13 public-intake atomicity (quote)

- [ ] Submit a quote via `/public/intake/quote` in live env.
- [ ] Inject an event-emission failure after persistence.
- [ ] **Expect:** no lead **and** no `quote_request` (all-or-nothing).
- [ ] Retry the same submission: exactly one lead + one linked `quote_request`
      (no duplicates, no retry ambiguity).

---

## 2. F5 — bilingual PDF/page parity fixture

The audit could not confirm the earlier "match" was a bilingual,
selected-language comparison. These reruns use a fixture with BOTH EN and FR
narrative rows and compare one selected language at a time.

### T4 — vaulted PDFs at SENT

- [ ] Create a **BILINGUAL** proposal (EN and FR narrative rows) with lines/totals.
- [ ] Send it (DRAFT → IN_REVIEW → SENT).
- [ ] **Expect:** two vaulted PDFs exist (`proposals/:id-en.pdf`,
      `proposals/:id-fr.pdf`), `proposal.pdf_vault_id` = the default-language doc.

### T5 — selected-language parity

- [ ] Public share page → pick EN → download PDF with `?lang=EN`.
- [ ] **Expect:** page and PDF show the same sections, numbers and EN text.
- [ ] Repeat with FR (`?lang=FR`): page renders ONLY FR, PDF matches exactly
      that selection (no EN leaking into the FR PDF or vice-versa).
- [ ] Note any divergence (this is the exact comparison the audit demanded).

### T6 — download reuse (regression from `5a3db511`)

- [ ] Sales → proposals → View document → Download PDF on the SENT proposal.
- [ ] **Expect:** browser **saves** the vaulted PDF (Save-As, no pop-up, no
      dead `/media` tab). Verify the file is the one vaulted at SENT (same
      bytes/verify token), i.e. no re-render.
- [ ] DRAFT proposal → Download: renders fresh, saves, no error.

---

## 3. F10 — status-specific refusal assertion

The audit's objection: an observed DRAFT refusal could come from another
precondition. The rerun must assert the refusal is the STATUS guard itself,
with all other prerequisites satisfied.

### T7 — DRAFT supplier refused with the right error

- [ ] Approve a partnership `VENDOR_REGISTRATION` → DRAFT supplier created,
      corporate profile document propagated to the supplier's vault linkage.
- [ ] POST a supplier invoice for that DRAFT supplier with **all other
      prerequisites valid** (entity, lines, amounts, dates…).
- [ ] **Expect:** `422 SUPPLIER_NOT_VERIFIED` from the status guard
      (`src/modules/procurement/supplier-eligibility.js`), not any other
      precondition error.
- [ ] Repeat with an exact-SHA pinned request to the current commit.

### T8 — posting guard + no GL side-effects

- [ ] Confirm the status check fires at invoice create AND again under lock
      immediately before the first payable/GL side effect.
- [ ] **Expect:** zero posted payables / GL entries for the DRAFT supplier.

### T9 — PO path + UI filter

- [ ] POST a purchase order to the DRAFT supplier → **Expect:**
      `SUPPLIER_NOT_VERIFIED`.
- [ ] PO UI: supplier dropdown lists ONLY ACTIVE + VERIFIED + AVL-APPROVED
      suppliers (no DRAFT entries selectable).
- [ ] Happy path: a verified supplier creates and posts an invoice cleanly.

---

## 4. Public flows (F5, F12, F13, F14) — anonymous/browser reruns

All anonymous endpoints are pinned to **live** (`req.tenantDbIn("live", …)`).
Use the production-like host so host resolution exercises the real path.

### T10 — F12 public portfolio

- [ ] Anonymous list + detail on the live host; no session.
- [ ] Missing / unpublished slug → same application 404 as nonexistent.
- [ ] Non-`NAMED` client: anonymised name, no logo URL in payload.
- [ ] `NAMED` client: `client_logo_url` present AND rendered on grid + detail.
- [ ] **Media guard:** attach a confidential vault doc id (not
      `SUCCESS_STORY_MEDIA`, or wrong `public_media_scope`) as cover/logo →
      **Expect 404**. A proper `SUCCESS_STORY_MEDIA` image → serves.
- [ ] Limiter burst on list/detail/media → rate-limited as configured.

### T11 — F13 intake endpoints

- [ ] All four anonymous endpoints (quote, contact, partnership, newsletter)
      in live env, honeypot/timing guards exercised.
- [ ] Quote submission lands as a **lead** with a linked `quote_request`
      (`lead_id` set) — the required funnel contract.
- [ ] Cross-tenant: a submission on tenant A's host is invisible to tenant B.
- [ ] Retry after a forced failure creates no duplicates (ties to T3).

### T12 — F14 public tracking

- [ ] Exact-reference lookup returns per-stage `location`,
      `stage_reference`, `progress_note`, completion timestamps, and
      `computed_status` (not raw dossier `status`).
- [ ] Cross-tenant reference → identical 404.
- [ ] Burst → rate-limited.
- [ ] UI shows all returned fields on the public page (current stage details
      included).

### T13 — F5 share controls

- [ ] Anonymous view + PDF download of a live SENT proposal.
- [ ] Revoked / expired / invalid token → uniform public 404 (no oracle).
- [ ] `viewed_at` / `downloaded_at` keep the first timestamp (`COALESCE`).

---

## Run order & bookkeeping

1. T1–T3 (transaction paths) before anything else — they gate Block A.
2. T7–T9 (F10) — financial control.
3. T4–T6 (F5), then T10–T13 (public flows).
4. Record each result in the `[ ]` box above; paste terminal/API evidence
   under the task when a run fails so the fix is targeted.
5. When a task fails, note the exact commit + reproduction here, fix in the
   repo, then re-run only that task (external infrastructure suites need no
   re-run).
