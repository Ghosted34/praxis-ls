# Client Portal & Public-Facing Interfaces — Gap Analysis

**Date:** 2026-08-17
**Sources:** `doc/SmartLS_PRD_Master_Functional_Spec_v2.md` (§4, §5.2–5.3, §7.4, §11.1, §11.5, MOD-31/MOD-66), `doc/SmartLS_SuperAdmin_User_Journey_and_RBAC.docx.txt`, `doc/SmartLS_Audit_and_Revamp_Brief.docx.txt`
**Code audited:** `main` @ `a603b4af`
**Scope:** external portals (Client / Investor / Auditor) + all public no-auth surfaces, vs what the PRD dictates.

---

## 1. Portal architecture recap (what exists)

- **Two tables:** `portal_user` (identity DB — credentials only, Argon2id) and `portal_access` (tenant DB — grants: CLIENT/INVESTOR/AUDITOR, `client_id` scope, `expires_at` time-box, `is_active`).
- **Auth:** invite-first (staff MOD-67 → one-time set-password link, 7-day TTL) → short-lived 2h JWT (`typ: portal`) → per-request grant re-check (`portalAuth` middleware + `isGrantUsable`). No refresh token; `sessionStorage` on the client.
- **API:** `/api/tenant/portal/...` (public auth + staff user/grant management + scoped data views).
- **SPA:** external app at `/client-portal/*` (outside staff `RequireAuth`/shell); staff grant screen at `/portal/access` (inside shell, settings hub).

---

## 2. Client Portal — PRD §11.1 vs implemented

PRD: *"Live project/milestone view (fed by MOD-31), sprint tracker & QA feedback, document vault (own docs), secure messaging with certified PDF export of the chat, onboarding command centre, and self-service quoting/booking. Scope: only the client's own data."*

| PRD requirement | Status | Evidence / note |
|---|---|---|
| Live milestone view (MOD-31 fed) | ✅ | `clientView` + `clientDossierChain` — client-visible stages, committed dates, published assumptions |
| QA feedback | ✅ | Q tickets raise/reply against milestones (`/client/tickets`) |
| Scope = own data only | ✅ | double-scoped: `client_id` ownership + `is_client_visible` stage flag |
| Sprint tracker | ⚠️ partial | milestone timeline only; no "sprint" concept exists in the codebase |
| **Document vault (own docs)** | ❌ **GAP** | dossier chain returns milestones + assumptions only — no documents, no PDF download; invoices shown as rows, file not openable |
| **Secure messaging + certified PDF export of chat** | ❌ **GAP** | comms is staff-side only (email, team chat). No client-facing thread, no chat PDF export (PRD §11.1; §11.5 flagged "per client direction") |
| **Onboarding command centre** | ❌ **GAP** | zero references in portal module, API, or UI |
| **Self-service quoting/booking** | ❌ **GAP** | no quote/booking endpoints in portal API; only anonymous `/public/intake` (for strangers, not signed-in clients) |

## 3. Other portal tiers

| Terminal | PRD | Status | Gap |
|---|---|---|---|
| Investor / Board (§5.2) | read-only KPIs + financials, optional IFRS | ✅ | OHADA basis implemented; IFRS explicitly resolved → OHADA (code comment). No gap |
| Audit (§5.2) | time-boxed read-only records + ledger + **data room** | ⚠️ | statements/trial/procurement/ledger trail ✅, time-box ✅ — **data room for document requests/answers ❌ not implemented** |
| Employee self-service (§4, MOD-70 note) | own payslip, leave requests, SOPs | ❌ **GAP** | not implemented anywhere |

## 4. Public-facing (no-auth) interfaces — inventory

All API surfaces are pinned to **live** (`req.tenantDbIn("live")`), rate-limited, and never require a session:

| Surface | API | SPA slug | Status |
|---|---|---|---|
| Careers (MOD-11) | `GET /careers`, `/careers/:token` | `/careers` | ✅ public UI in repo |
| Portfolio / success stories (MOD-26) | `GET /public/portfolio` (+ media) | `/portfolio`, `/portfolio/:slug` | ✅ |
| Proposal share links (F5) | `GET /public/proposals/:token` (+ `/pdf`) | `/proposal/:token` | ✅ |
| Shipment tracking (F14) | `GET /public/tracking/:reference` | `/track` | ✅ |
| Intake (quote/contact/partnership/newsletter) | `POST /public/intake/*` | — (API only; marketing site posts to it) | ✅ |
| QR document verification (MOD-66) | `GET /document-verification/scan` | — | ✅ |
| **Bilingual marketing website** (brief §3.1: "the front door — story, services, quote form, partnership portal, tracking") | n/a | **not in this repo** | ❌ **GAP** — all backend APIs exist; the marketing-site frontend itself is absent |

---

## 5. Routing & naming assessment (recommendations)

### 5.1 `/client-portal` is a misnomer — agree

Investors and auditors sign in at the same URL. The route should be audience-neutral.

**Recommendation: rename the external app slug `/client-portal/*` → `/portal/*`** and move the staff grant-management screen off `/portal/access` (currently the blocker for using `/portal` — the auth boundary comment in `app.tsx` says exactly that).

- Staff screen moves to `/settings/portal-access` (it is already linked from the settings hub; one `to:` change).
- Impact is mechanical, ~10 references:
  - `client/src/app/app.tsx` (external route + staff route)
  - `client/src/features/portal/portal-app.tsx` (guard Navigate ×2)
  - `client/src/features/portal/portal-auth.tsx` (nav ×2, Link ×1)
  - `client/src/features/portal/portal-chrome.tsx` (logout assign ×1)
  - `client/src/features/settings/settings-hub.tsx` (staff link)
  - `src/modules/portal_auth/portal_auth.service.js` (invite/reset email link, line ~141)
- **Keep `/client-portal/*` as a redirect** for a transition window: invite emails already in the wild carry the old link (7-day TTL).
- API stays `/api/tenant/portal/...` — it is already audience-neutral and matches the new slug.

### 5.2 Public pages deserve a coherent namespace

Today the public pages are top-level short slugs (`/track`, `/portfolio`, `/proposal/:token`, `/careers`) sitting beside staff routes in the same router. The API already namespaces them under `/public/*`.

**Recommendation: mirror the API — group them under `/public/*`:**
`/public/track`, `/public/portfolio[/:slug]`, `/public/proposals/:token`, `/public/careers[/:token]`.

- Keeps the "stranger on the marketing site" surface visibly separate from the app in URLs, logs, and analytics.
- Same pattern as the portal: external slugs are the authentication boundary by construction — no accidental drift into staff screens.
- Old top-level paths redirect (SEO links in circulation).

### 5.3 Long-term (when the marketing site is built)

- The marketing site itself should live on its **own host/subdomain** (e.g. `www.tenant.com`) — it is the "front door" per the brief, and the app-hosted `/public/*` pages become its embedded surfaces (quote form → `/public/intake`, tracking → `/public/track`, careers → `/public/careers`).
- Alternative: `/public/*` stays on the app host and the marketing host links out. Either way the boundary is: **app host = authenticated + these public slugs; marketing host = content only.**

---

## 6. Gap summary (work items)

| # | Item | Tier | Effort |
|---|---|---|---|
| 1 | Client portal: document vault (own docs + download) | Client portal | M |
| 2 | Client portal: secure messaging + certified chat PDF | Client portal | L |
| 3 | Client portal: onboarding command centre | Client portal | M |
| 4 | Client portal: self-service quoting/booking | Client portal | M |
| 5 | Auditor: data room (document requests/answers) | Audit portal | M |
| 6 | Employee self-service portal (payslip/leave/SOPs) | Staff/employee | L |
| 7 | Marketing website frontend (bilingual) | Public | L |
| 8 | Portal slug rename `/client-portal` → `/portal` (+ staff move, redirects) | Routing | S |
| 9 | Public pages namespace `/public/*` (+ redirects) | Routing | S |
