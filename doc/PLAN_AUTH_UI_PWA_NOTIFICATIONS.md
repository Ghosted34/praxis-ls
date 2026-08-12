# Praxis LS — Implementation Plan: Forgot-Password, UI Beautification, PWA Install & Notification Workflow

> Status: **PLAN — nothing built yet.** Scoped against the current codebase (API =
> Node/Express multi-tenant, client = React 18 + Vite + Tailwind v3 + vite-plugin-pwa).
> Every section names the real files it touches so this can be executed as-is.

---

## 0. Context that shaped this plan

Findings from the current tree that the plan builds on:

- **Auth is mature but has no password recovery.** `src/modules/security/app_user/`
  handles login, refresh, 2FA (TOTP), and device PIN. Auth actions live at
  `/api/tenant/auth/*` (the `authRouter` in `app_user.routes.js`). There is **no**
  forgot/reset path and **no** `password_reset` table in `migrations/tenant`.
- **The UI already has a design system.** `client/src/index.css` defines the Lovable
  "Control Tower" tokens (surfaces, brand orange `#F5821F` / smart-blue, Playfair +
  Montserrat, shadow + motion scales). Per `doc/FRONTEND_PLAN.md` the FE is being
  rebuilt to replicate the Lovable mock in `doc/reference/reference-mock-lovable`.
  So "beautify" = **finish and standardize that replication**, not start from zero.
- **PWA is ~70% there.** `vite.config.ts` runs `vite-plugin-pwa` (autoUpdate,
  workbox app-shell caching); `src/routes/pwa.js` serves a **per-tenant** dynamic
  manifest + icons Host-resolved; `client/index.html` has the manifest link + iOS
  meta tags. Missing: the in-app **install experience** and offline/update UX.
- **Notification backend is rich.** `src/services/notifications.service.js` already
  writes in-app notifications and fans out to **email, web-push, WhatsApp, SMS** with
  per-user preferences; realtime is wired via socket.io (`src/realtime/`) and web-push
  via `src/shared/push/push.service.js` (VAPID). Missing: a **push-subscription
  endpoint**, the **frontend inbox/bell + opt-in UI**, and **event→notify wiring**.

The recurring theme: the backend plumbing is largely present; most remaining work is
the **client experience** plus a few backend gaps (reset tokens, push subscribe route,
event wiring).

---

## 1. Forgot Password — email reset-link flow

**Goal.** Self-service recovery: user requests a link by email, clicks a one-time
tokenized link, sets a new password. Tenant-scoped (Host-resolved, exactly like login).

### 1.1 Data model

New tenant migration `migrations/tenant/00xx_password_reset.sql`:

- Table `password_reset` — `reset_id (uuid pk)`, `user_id (fk app_user)`,
  `token_hash (text)` — store a **SHA-256 of the token, never the raw token**,
  `expires_at (timestamptz)`, `used_at (timestamptz null)`, `requested_ip`,
  `created_at`. Index on `token_hash` and on `user_id`.
- Token lifetime: **30 min**, single-use. On successful reset, mark `used_at` and
  **force logout of ALL of the user's sessions** (DECIDED) — reuse the session-revoke path already used on
  refresh-token reuse in `app_user.service.js`).

### 1.2 Backend

- **Repo** (`app_user.repo.js`): `createResetToken`, `findLiveResetByHash`,
  `markResetUsed`. Password write reuses the existing `setPasswordHash`.
- **Service** (`app_user.service.js`):
  - `requestPasswordReset({ email, ip })` — look up user; **always return success**
    (no user-enumeration leak, mirroring the existing "same error for no-such-user
    vs wrong-password" comment in `login`). If the user exists + is active: generate
    a 32-byte random token, store its hash, send the email.
  - `resetPassword({ token, newPassword })` — hash the token, find a live unused row,
    verify not expired, argon2-hash the new password, `setPasswordHash`, `markResetUsed`,
    revoke sessions. Enforce the **password policy below**.
- **Password policy (DECIDED — full policy).** Applied to reset _and_ backfilled into
  `validator.create`/`validator.password` so the rule is one shared validator:
  - **Min length 12**, must include upper + lower + digit + symbol.
  - Reject the email/username as a substring and obvious sequences.
  - **Breached-password check** via HaveIBeenPwned range API (k-anonymity: send only
    the first 5 chars of the SHA-1, compare suffixes locally — the full hash never
    leaves the server). Fail closed to "allow" only if HIBP is unreachable, and log it.
- **Email** via `src/services/email.service.js` `send()` with a branded template
  (tenant name/logo from branding service, same source `src/routes/pwa.js` uses).
  Link target: `https://<tenant-host>/reset-password?token=…`.
- **Controller + routes** (`app_user.controller.js`, `app_user.routes.js`) — add to
  the **public** `authRouter`:
  - `POST /api/tenant/auth/forgot-password` (body: email)
  - `POST /api/tenant/auth/reset-password` (body: token, password)
- **Validators** (`app_user.validator.js`): `forgotPassword`, `resetPassword`.
- **Rate limiting.** Apply `express-rate-limit` (already a dependency) to
  forgot-password per-IP + per-email to blunt abuse/enumeration timing.
- **Audit.** Emit audit-ledger entries for request + completion (the module already
  has `audit_ledger`).

### 1.3 Frontend

- Wire the **existing but dead** "Forgot password?" link in
  `client/src/features/auth/login-modal.tsx` (line ~216). Add a `forgot` stage to the
  modal's `Stage` state → email input → "check your inbox" confirmation.
- New route + screen `client/src/features/auth/reset-password-page.tsx` mounted at
  `/reset-password` (React Router). Reads `?token=`, shows new-password + confirm
  fields (reuse `components/ui/input.tsx` + the password reveal pattern already in the
  modal), calls `/auth/reset-password`, then routes to sign-in with a success toast.
- Handle expired/used-token and weak-password errors inline.

### 1.4 Verification

Unit-test the service (happy path, expired, reused, unknown email returns success,
enumeration parity). Add a Postman entry (repo already keeps `postman/`). Manual
end-to-end on a provisioned tenant.

**Estimate:** ~1.5–2 days. Lowest-risk, highest-value item → build first.

---

## 2. UI Beautification — plan

The design language already exists; the work is **consistency, completion, and polish**,
not a new theme. Recommended as a phased pass rather than a big-bang rewrite.

### 2.1 Establish the baseline

- Audit `doc/reference/reference-mock-lovable` vs the live screens and record the gap
  (which screens match the mock, which are still Phase-0 hand-rolled). Produce a short
  screen-by-screen status table.
- Lock the token layer: confirm every color/spacing/shadow/radius in `index.css` +
  `tailwind.config.ts` is a semantic token, and that no screen hardcodes hex/px. The
  tenant white-label loader (`src/lib/theme.ts`) must remain the single source of the
  accent override — do not fork it.

### 2.2 Component primitives

- Standardize `components/ui/*` (button, card, input, modal, table, pill, kpi-tile,
  states, skeleton) so every feature screen consumes them rather than bespoke markup.
  Each primitive: variants documented, focus-visible ring, disabled/loading states,
  dark-mode verified.
- Introduce a lightweight **Storybook-style preview route** (internal, `/ui-kit`) so
  primitives can be reviewed in isolation without spinning through real data.

### 2.3 Layout & motion polish

- App shell (`app/layout/app-shell.tsx`): refine the rail/topbar rhythm, the
  LIVE/TEST badge, and the mobile slide-over to match the mock.
- Apply the `--ease` / `--dur` motion tokens consistently (page/section transitions,
  skeleton→content, modal enter/exit). Respect `prefers-reduced-motion`.
- Empty / loading / error states everywhere via `components/ui/states.tsx` +
  `skeleton.tsx` — no raw spinners.

### 2.4 Consistency sweep

- Typography scale (Playfair display headings vs Montserrat body) applied uniformly.
- Responsive audit at mobile / tablet / desktop for the high-traffic screens
  (dashboard, finance, sales, fleet, operations).
- Accessibility: color-contrast on brand orange surfaces, keyboard nav, aria labels.

### 2.5 Sequencing

Phase A: tokens + primitives + `/ui-kit` (foundation). Phase B: shell + navigation.
Phase C: screen-by-screen replication, highest-traffic first. Ship per-phase behind
the normal build; no feature flag needed since it's visual.

**Estimate:** phased; A ≈ 2–3 days, B ≈ 2 days, C ≈ ongoing per screen. This is the
one item to keep **iterative** rather than one PR.

---

## 3. PWA Installability — "download the app on any device"

Most infra exists; this is finishing the **install & offline UX** so it feels like a
real installable app on iOS, Android, and desktop.

### 3.1 Confirm the foundation

- Verify the per-tenant manifest (`src/routes/pwa.js`) emits everything an installable
  PWA needs: `name`, `short_name`, `start_url`, `scope`, `display: "standalone"`,
  `theme_color`, `background_color`, and icons at 192/512 **plus a maskable 512**
  (the route already renders a maskable variant — confirm it's referenced in the
  manifest with `"purpose": "maskable"`).
- Ship real icon assets: `client/public/icon-192.png` + `icon-512.png` fallbacks
  (noted as a TODO in `doc/FRONTEND_PLAN.md`).
- Confirm the service worker (`vite-plugin-pwa` autoUpdate) registers in prod and the
  `navigateFallback` app-shell caching works offline.

### 3.2 Install experience (the missing piece)

- **Android / desktop Chromium:** capture the `beforeinstallprompt` event, suppress
  the mini-infobar, and surface a branded **"Install app"** button (in the topbar
  menu + optionally a one-time banner). Call `prompt()` on click; hide once installed
  (`appinstalled` event / `display-mode: standalone` check).
- **iOS / Safari:** no `beforeinstallprompt`. Detect iOS + not-standalone and show a
  **dismissible banner** (DECIDED) that opens a short **"Add to Home Screen"**
  instruction sheet (Share → Add to Home Screen) with the tenant icon preview. This is
  the only way to "install" on iOS. Dismissal is remembered (localStorage) so it shows
  at most once per user unless they clear it; re-surface only via the topbar menu.
- Put this in a small `usePwaInstall()` hook + an `<InstallPrompt/>` component so any
  screen can trigger it; persist "dismissed" in-memory/localStorage so it isn't nagging.

### 3.3 Offline & update UX

- **Offline fallback page** for navigations when the SW has no cache + network is down
  (branded "You're offline" screen).
- **Update-available toast:** with `registerType: "autoUpdate"` the SW updates on next
  load; add a "New version available — reload" toast (from the plugin's
  `registerSW({ onNeedRefresh })`) so users aren't stuck on a stale shell mid-session.
- Decide the **offline data policy** now: today only the app shell is cached (API is
  denylisted from the SW, correctly). If any read-only screens should work offline,
  that's a follow-up requiring cached API responses — call it out but keep out of v1.

### 3.4 Verification

Lighthouse PWA audit (installable + best-practices), real-device install test on
Android Chrome, iOS Safari, and desktop Edge/Chrome, plus an offline-reload test.

**Estimate:** ~1.5–2 days (mostly the install UI + iOS instructions + testing).

---

## 4. Notification Workflow

The service layer is the strong point here; the work is a **subscription endpoint**,
the **frontend surface**, and **wiring events to notifications**.

### 4.1 Backend gaps

- **Push subscription endpoint (missing).** `push.service.js` can send but nothing lets
  the browser register a subscription. Add under `/api/tenant/notifications`:
  - `GET  /notifications/push/public-key` → returns VAPID public key
    (`push.service.resolveVapid().publicKey`).
  - `POST /notifications/push/subscribe` → stores the browser `PushSubscription`
    for `req.user` (new `push_subscription` table if none exists: `user_id`,
    `endpoint`, `p256dh`, `auth`, `user_agent`, `created_at`, unique on endpoint).
  - `DELETE /notifications/push/subscribe` → remove on unsubscribe/logout.
    Confirm `push.service.sendToUser` reads from this same table.
- **Preferences** already exist (`notification.routes.js` GET/PUT `/preferences`,
  `notifications.service.upsertPreference`) — reuse as-is.

### 4.2 Event → notification wiring

- **Proposed v1 category catalog (DECISION: pick from this).** You weren't sure which
  categories to ship, so here's a sensible default set. "Default on/off" is the initial
  per-user preference; **security is unconditional** (ignores preferences entirely).

  | Category      | Fires on                                                                  | Default              | Notes                                                           |
  | ------------- | ------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------- |
  | `security`    | new-device sign-in, password reset/change, 2FA enable/disable, PIN change | **ON, locked**       | Unconditional per `notification.repo.js`; cannot be turned off. |
  | `approvals`   | a workflow item is waiting on you / your request was approved or rejected | **ON**               | Highest day-to-day value.                                       |
  | `assignments` | a record/task is assigned to you or you're @mentioned                     | **ON**               |                                                                 |
  | `finance`     | invoice paid/overdue, payment received, posting errors                    | **ON**               | High-signal money events only.                                  |
  | `operations`  | shipment/fleet status changes relevant to you                             | **OFF**              | Can be noisy; opt-in.                                           |
  | `system`      | maintenance, new-version, tenant announcements                            | **ON (in-app only)** | Email/push default off.                                         |

  Each row maps to a `notification_type` the existing preference system already keys on.
  Recommend shipping `security`, `approvals`, `assignments`, `finance` in v1 and holding
  `operations`/`system` push until there's demand — but all six can be defined up front.

- Wire producers: modules emit their existing domain events (`*.events.js`), and a
  thin subscriber calls `notifications.service.notify({...})`. Security-critical alerts
  (password reset done, new-device login) fire **unconditionally** per the existing
  `notification.repo.js` rule; everything else consults preferences.
  - Immediate win: hook the **§1 password-reset completion** to a security notification.

### 4.3 Frontend surface

- **Notification bell** in the app shell: unread badge from
  `GET /notifications/unread-count`, dropdown/inbox from `GET /notifications`, mark-read
  / mark-all-read wired to the existing endpoints. Live updates via the socket.io
  client already in deps (`socket.io-client`) — subscribe to the `notification.created`
  channel.
- **Full inbox screen** (paginated list, filters by read/category).
- **Push opt-in UI:** a "Enable notifications" control that requests
  `Notification.permission`, subscribes via the service worker's `pushManager`, and
  POSTs to `/notifications/push/subscribe` using the fetched VAPID key. Gate the prompt
  so it only appears after a meaningful action (not on first paint).
- **Preferences screen:** per-category × per-channel (in-app / email / push / WhatsApp /
  SMS) toggles bound to `GET/PUT /notifications/preferences`.

### 4.4 Verification

End-to-end: trigger an event → assert in-app row + socket push + web-push delivery on a
real device; toggle a preference off and assert suppression; confirm security alerts
ignore preferences.

**Estimate:** ~3–4 days (subscribe endpoint + bell + inbox + prefs + opt-in + wiring).

---

## 5. Suggested sequencing & dependencies

1. **Forgot password (§1)** — self-contained, high value, unblocks a security
   notification for §4. _Build first._
2. **PWA install (§3)** — small, independent, needs the SW registered (it is) and is a
   prerequisite for web-push opt-in in §4 (push needs a registered service worker).
3. **Notifications (§4)** — depends on §3's service worker for the push channel; in-app
   - email channels can land without it.
4. **UI beautification (§2)** — parallelizable and iterative; runs alongside the others
   rather than blocking them. Do the token/primitive foundation early so §1/§3/§4
   screens are built on the finished primitives, not reworked later.

Rough total for §1 + §3 + §4 core: ~1.5–2 weeks. §2 is continuous.

## 6. Decisions (resolved)

- **Password policy:** full policy — min 12 chars, upper/lower/digit/symbol, no
  email substring, **HIBP breached-password check** (k-anonymity). Shared validator
  reused across reset + create + admin set-password.
- **Reset session handling:** **force logout of all sessions** on successful reset.
- **iOS install:** **dismissible banner** → "Add to Home Screen" sheet; dismissal
  remembered, re-openable from the topbar menu.
- **Notification categories:** default catalog in §4.2. v1 ships `security` (locked on),
  `approvals`, `assignments`, `finance`; `operations`/`system` push held for later.
- **Offline scope:** **app-shell-offline only for v1** (assumed default — no read-only
  data caching yet; API stays denylisted from the SW). Flag if you want any read-only
  screen to work offline and it becomes a scoped follow-up.
