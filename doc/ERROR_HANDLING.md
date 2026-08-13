# Error handling

Two rules decide everything in this file:

> **A mutation is never silent.** If server state changed — or was meant to —
> the user is told. Classes A–C below cover reads, teardowns and local storage.
> Class F, mutations, is never quiet.

> **"Don't interrupt the user" and "don't tell engineering" are different
> decisions.** Class D is silent to the user and visible to us. Conflating them
> is what today's `.catch(() => {})` does, and why a background sync could fail
> for every user for a week with no signal at all.

The rest of the document is the classification these rules produce.

## The taxonomy

Every catch block, `.catch()` and swallowed rejection in the client belongs to
exactly one of these classes. The **marker** column is what a reviewer looks
for to know a silent catch was deliberate — the lint rule (§Enforcement below)
refuses any silent catch without one.

| Class | Definition | Toast | Report | Marker |
|---|---|---|---|---|
| **A · Storage** | `localStorage` / `sessionStorage` write or read that fails on quota or private mode | none | none | `/* @silent:storage */` |
| **B · Parse fallback** | Non-JSON body, malformed cache entry, unparseable draft — a defined fallback exists | none | none | `/* @silent:parse */` |
| **C · Teardown** | Closing a socket/connection already gone; the original error is the useful one | none | none | `/* @silent:teardown */` |
| **D · Best-effort background** | Fire-and-forget the user did not initiate: read receipts, push cleanup, telemetry | none | **`notice`** | `onError: "notice"` |
| **E · Degraded read** | A read that failed where partial UI is acceptable — but the user must see the degradation | inline note | **`notice`** | `onError: "notice"` + visible marker |
| **F · Mutation** | Anything that changes server state | **always** | `warning`+ if unexpected | never silent |
| **G · Config** | A prerequisite is unset (SMTP, API key, geofence policy) | **callout with fix-it link** | **never** | `CONFIG_MISSING` (424) |

### Worked examples from the code

| Site | Class | Action |
|---|---|---|
| `api-client.ts:378` `/* non-JSON body — keep the status text */` | B | Correct; mark `@silent:parse` |
| `form-draft.ts:166` `/* still full; the draft is lost but the form is not */` | A | Correct; mark `@silent:storage` |
| `nav-access-cache.ts:92` `/* private mode … falls back to the skeleton */` | A | Correct; mark `@silent:storage` |
| `mail-idle.js:81` `try { await imap.logout(); } catch { /* noop */ }` | C | Correct; mark `@silent:teardown` |
| `mail.tsx:49` `markThreadRead(id).catch(() => {})` | D | `onError: "notice"` |
| `turn.tsx:516,534` AI feedback ping | D | `onError: "notice"` |
| `push-opt-in.tsx:87` subscription cleanup | D | `onError: "notice"` |
| `invoices.tsx:42` name resolution best-effort | E | `notice` + show ids unresolved |
| `masterdata-api.ts:978` `listSalesTaxCodes` | **F** | Fixed in this PR (B1) |
| `new-account-modal.tsx:135` `/* soft */` | **F** | Fixed in this PR (B2) |
| `clock-punch.tsx:54` location fix | **G** | Fixed in this PR (B3) |

## The mutation envelope

Successful mutations return one of:

```json
{ "ok": true, "changed": true,  "data": { "…": "…" } }
{ "ok": true, "changed": false, "message": "Session was already revoked" }
```

`ok:false` is never returned — failures throw and are handled by
`middleware/error-handler.js`. `changed` answers *"did server state actually
move?"* — `changed:false` is the case that made the session-kill bug look like
nothing happened: the second click to revoke an already-revoked session
succeeds with a 200 whose body says the row was unchanged. The client renders
that as *"That session was already revoked"*, not silence.

**Why not 409.** An already-revoked session is not a conflict, and the server
comment says so correctly. Making idempotent success a 4xx would break the
offline outbox at `client/src/lib/outbox.ts` — it replays writes that failed
offline, and a replayed successful kill would then surface as an error for an
operation that worked. Genuine conflicts (stale-record edit, double-post) keep
409; idempotent no-ops keep 200 with `changed:false`.

**Rollout.** PR1 adds a `withResult()` helper in `src/shared/crud/` and
applies it to the ~25 action endpoints (`/kill`, `/revoke-all`, `/approve`,
`/transition`, `/post`, `/purge`, `/supersede`, `/regularize`). `useAction`
treats a **missing envelope** as `changed:true` so the ~466 mutation routes
not yet converted still work. A later PR converts the rest and flips the
default.

## Client — `useAction`

```ts
const revoke = useAction(
  (id: string) => tenant(`/sessions/${id}/kill`, { method: "POST" }),
  {
    success: "Session revoked",
    idle: "That session was already revoked",
    onSuccess: () => { mine.reload(); all.reload(); },
  },
);
```

This is the mutation shape. Five lines, correct in every branch — the
`try/catch/setError`/no-toast/no-idle version it replaces was twelve lines
and got three of the five branches wrong.

### The expected/unexpected split

The most important line in the whole design:

```
call
 ├─ resolves
 │   ├─ { changed: true }  → success toast   → onSuccess
 │   ├─ { changed: false } → info toast (idle) → onSuccess
 │   └─ no envelope        → success toast   (legacy path)
 └─ throws
     ├─ EXPECTED  (400/403/404/409/422, CONFIG_MISSING, NETWORK_DOWN, AbortError)
     │      → error toast · NEVER reported
     └─ UNEXPECTED (5xx, TypeError, DOWNLOAD_FAILED, schema mismatch)
            → error toast · reported at `onError` severity (default "error")
```

Reporting a 403 rebuilds the firehose the backend's `NOTIFY_SEVERITIES` was
written to prevent. `isNetworkError()` at `api-client.ts:202` already
separates "the server made a decision" from "the connection died" — this
extends the same thinking to reporting.

### Class D/E — silent to the user, visible to us

```ts
const markRead = useAction(() => api.markThreadRead(id), { onError: "notice" });
```

No `success`, so no toast — this is background best-effort. A failure records
at `notice`, which per `NOTIFY_SEVERITIES` never webhooks and never spends the
20/min rate limit, but does create an `error_event` row with a rising
`occurrence_count`. A read-receipt call broken for every user becomes one
visible row in the monitor instead of nothing at all.

### Class A/B/C — silent everywhere, deliberately

`useAction` is a mutation wrapper; classes A–C are storage / parse / teardown
sites that do not go through it. Mark the catch with the taxonomy comment:

```ts
try {
  localStorage.setItem(key, value);
} catch {
  /* @silent:storage — private mode; the draft is lost but the form is not */
}
```

## Server — `AppError`, `withResult`, `CONFIG_MISSING`

Throw an `AppError` and the middleware picks the right status; the shape is
already documented at `src/utils/errors.js`. Two new patterns:

**`withResult(fn)`** wraps a mutation handler so its response body is
`{ ok, changed, data? | message? }`. Applied to action endpoints in this PR;
extend to CRUD writes in the follow-up.

**`CONFIG_MISSING`** returns 424 Failed Dependency with the setting key, the
deep-link route to fix it, and the affected feature. These must never reach
`error_event` — they are unfinished setup, not code faults. Mixing them in
would degrade the monitor's signal until people stopped reading it.

```js
throw new AppError("CONFIG_MISSING", "SMTP host is not set", 424, {
  setting_key: "smtp.host",
  settings_route: "/settings/email",
  feature: "Email sending",
});
```

The client's `<ConfigMissingCallout>` renders any `CONFIG_MISSING` with a
working link to `settings_route`. New integrations inherit the behaviour with
no UI work.

## Enforcement

Three ESLint rules land as `"warn"` with a baseline so the CI ratchet works
the way `--max-warnings 136` already does in this repo:

- **R1 · `no-unmarked-silent-catch`** — every catch whose body is empty or
  comment-only must carry `/* @silent:storage|parse|teardown */`.
- **R2 · `mutation-requires-feedback`** — an `await` of a `POST|PATCH|PUT|DELETE`
  request (or a known-mutating `api.*` call) inside a component must be
  inside `useAction`, or followed by a `toast.*` call in every branch.
- **R3 · `no-raw-catch-setError`** — flags the exact `try/catch/setError`
  shape that `useAction` replaces. Autofixable in the common case.

Backend gets an equivalent scanner at `scripts/check-silent-catch.js` and a
new response-contract check at `scripts/check-response-contract.js` (§8b of
the PR guide) — the latter is what catches the B4 class of bug: client type
declares a field the API never sends.

## References

- Error reporter: `src/shared/observability/error-reporter.js`
- Severity gate: `error-reporter.js:70` (`NOTIFY_SEVERITIES`)
- Global error handler: `src/middleware/error-handler.js`
- Browser error sink: `src/routes/client-errors.js`
- Client reporting: `client/src/lib/error-reporting.ts`
- Toast primitive: `client/src/components/ui/toast.tsx`
- The expected/unexpected precedent: `api-client.ts:202` (`isNetworkError`)
