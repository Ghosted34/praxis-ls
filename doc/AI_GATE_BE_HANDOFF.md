# AI gate — the ai_enabled field

_2026-07-16. Small backend change so the global AI toggle reaches the UI._

> **STATUS: IMPLEMENTED (2026-07-16).** Done in this repo — see "Implementation" at
> the bottom. `login` / `2fa/verify` / `pin/login` now return `user.ai_enabled`.
> Windows `npm test` is the authoritative check.

## Context

AI is toggled per tenant from the developer dashboard via the `ai.assistant.backend`
feature flag (`ai_feature_flag` table; the whole `/ai/*` router is already mounted
`feature: "ai.assistant.backend"`). Product rule: **when AI is off, no AI affordance
appears in any module, for any user.**

The FE now routes every AI affordance through one gate
(`client/src/components/ai-actions.tsx` → `useAiEnabled()` / `<AiGate>` / `<AiActions>`).
That gate reads **`user.ai_enabled`** off the auth session. Until the BE sends it, the
gate defaults **off** (fail-safe — AI is opt-in, so nothing leaks early).

The existing `/ai/governance/features` endpoint can't drive this: it's
`requirePermission("MOD-70", "view")`, i.e. admin-only, but the gate must work for
every user.

## The ask

Add a boolean **`ai_enabled`** to the `user` object returned by the auth endpoints,
resolved from the tenant's `ai.assistant.backend` feature flag (the same value the
router-mount gate already computes):

- `POST /api/tenant/auth/login` → `{ access_token, refresh_token, user: { …, ai_enabled } }`
- `POST /api/tenant/auth/2fa/verify` → same `user` shape
- `POST /api/tenant/auth/pin/login` → same `user` shape

The FE caches the `user` object and restores it on reload (there is no `/me`
endpoint — `whoami` returns tenant/env only), so putting it on `user` is enough; no
new endpoint required.

Resolution: `ai_enabled = canUseFeature(tenant, "ai.assistant.backend")` at the feature
(tenant) level — the per-user AI *grant* is separate and enforced server-side inside the
orchestrator; this flag only decides whether the UI shows AI at all.

## Consequence / acceptable limitation

Because the flag rides on login, toggling AI in the dev dashboard takes effect for a
user **on their next login** (or token refresh, if you also thread it there). That's
fine for an admin-controlled, rarely-flipped switch. If you want it live without
re-login, also return `ai_enabled` from the refresh path and we'll thread it in.

## FE (done)

- `useAiEnabled()` / `<AiGate>` / `<AiActions>` — `client/src/components/ai-actions.tsx`
- `User.ai_enabled?: boolean` — `client/src/app/auth/auth-context.tsx`
- All 47 scaffold AI panels + the new master-data screens already gate on it.

## Implementation (BE, 2026-07-16)

- `src/modules/ai/governance/governance.service.js` — new **`isFeatureEnabled(client,
  featureKey)`**: tenant-level flag read (ignores per-user grant + budget), exported.
- `src/modules/security/app_user/app_user.service.js` — `issueSessionTokens()` (the single
  chokepoint for login, `verifyTotp` and `pinLogin`) now resolves
  `ai_enabled = isFeatureEnabled(client, "ai.assistant.backend")` and adds it to the returned
  `user`. Wrapped in `resolveAiEnabled()` → **never throws**; any read error ⇒ `false`, so a
  governance hiccup can't block sign-in. Read on the identity (live) client, consistent with
  the identity-pinned-to-live model.
- Resolution is the **feature-level flag only** (the tenant switch). Per-user AI grants +
  budget stay enforced server-side inside the orchestrator; this flag just decides whether the
  UI shows AI at all.
- **Limitation (unchanged):** rides on login, so a dev-dashboard toggle takes effect on the
  user's next login. `refresh` doesn't re-send it (the cached user keeps the value across
  reload). Thread it through `refresh` later if live flipping is ever needed.
- Verified: file-tool reads confirm both files well-formed (in-sandbox `node --check` hit the
  known mount-truncation artifact — **Windows `npm run lint` + `npm test` authoritative**).
