# Auth & sessions — how it works, and the two traps in it

Written 2026-08-02 (session 19b) while diagnosing a "token expired" complaint.
Read this before changing anything in `app_user.service.js`, `api-client.ts` or
the JWT/session settings.

---

## The shape of it

**Login** (`app_user.service.issueSessionTokens`)

1. Password checked with argon2; TOTP if the user has 2FA.
2. A row in `user_session` — **Postgres is the source of truth**: `killed_at`,
   `last_seen_at`, `environment`, `refresh_jti`, `keep_signed_in`.
3. Redis gets an index entry (`shared/cache/session-store.js`) purely so "list my
   sessions" and remote-kill avoid DB round-trips. Best-effort: a Redis outage
   degrades the index, it never breaks login, logout or kill.
4. Two tokens: an **access JWT** (`JWT_ACCESS_TTL`, default 15m) and a **refresh
   JWT** (`JWT_REFRESH_TTL`, default 30d) bound to that `session_id`, whose `jti`
   is stamped onto the session row.

**Every request** — `middleware/auth.js` verifies the access JWT, then resolves
the principal through `identity-cache` (Redis, 30s TTL, reading the **live**
schema). Roles and grants are resolved per request, which is why a permission
change takes effect on the next call rather than at next login.

**Client storage** (`client/src/lib/token-store.ts`)

- access token → a **module variable, memory only**. Any reload loses it, so the
  app must refresh on boot. Deliberate: a token in `localStorage` is a token an
  XSS can read.
- refresh token → `localStorage` when "Keep me signed in" is ticked,
  `sessionStorage` when it isn't.

**Refresh** (`POST /auth/refresh`) — verify the JWT, load the session, then:

1. **Reuse detection.** The presented `jti` must equal `session.refresh_jti`. A
   mismatch means a rotated-away token was replayed → the whole session is killed
   as a compromise signal.
2. **Inactivity.** `last_seen_at` older than `SESSION_INACTIVITY_MIN` (30) → kill.
   **Skipped for `keep_signed_in` sessions** (0494).
3. Touch the session, mint a new access token, **rotate the refresh token** (new
   jti stamped on the row) and return both.

**Logout** — kill the session row, drop the Redis entry, invalidate the identity
cache; the client clears its storage.

**Per device.** Each login is its own `user_session` with its own refresh chain,
so a laptop and a phone never interfere. **Per tab is not** — tabs in one browser
share `localStorage`, so they share one refresh token for one session.

---

## Trap 1 — "last_seen_at" does not mean last seen

`last_seen_at` is written in exactly one place: `repo.touchSession()`, called
inside `refresh()`. **Nothing else in the codebase updates it** — ordinary
authenticated requests do not.

So the inactivity check does not measure "time since the user did something". It
measures **time since the last token refresh**, under a name that says otherwise.

It is correct today only because of a numeric coincidence:

```
access TTL (15 min)  <  inactivity window (30 min)
```

A refresh is forced every 15 minutes of use, which resets the clock long before
the 30-minute limit, so an active user is never falsely logged out.

**Raise `JWT_ACCESS_TTL` above `SESSION_INACTIVITY_MIN` and every user without
"keep me signed in" gets logged out mid-work**, because the gap between refreshes
would exceed the window on its own. The two settings look independent and are
not.

Proper fix: bump `last_seen_at` on any authenticated request (throttled — you do
not want an UPDATE per call). That is a change in `middleware/auth.js`, i.e. on
every request in the system, so it wants doing deliberately. A cheap interim
guard is a startup assertion that refuses to boot when the access TTL exceeds the
idle window.

---

## Trap 2 — rotation plus reuse-detection is hostile to concurrency

Every refresh rotates the token, and presenting a rotated-away token kills the
session. That is good security and it means **two simultaneous refreshes of the
same session are indistinguishable from an attack**.

`api-client.tryRefresh` de-dupes concurrent refreshes, but only **within one
tab** — it is a module-level variable. There is no `BroadcastChannel`, no Web
Locks, no `storage` listener. Two tabs, or a browser restoring several tabs at
once after a restart, can each lose their in-memory access token, each refresh,
and one of them will present a stale token and kill the session for all of them.

Not observed in the wild as of 2026-08-02 (the reported complaint was single-tab
and turned out to be Trap 3), but it is latent. If it surfaces, the fix is either
a backend grace window (keep `previous_refresh_jti` + `rotated_at`, accept the
previous jti for ~30s) or a cross-tab lock via `navigator.locks`. The grace
window is the more robust of the two because it covers races the client cannot
see.

---

## Trap 3 — FIXED 2026-08-02: the app never recovered from a failed refresh

`api()` tried a refresh on a 401 and, when it failed, simply fell through and
threw the 401. No token clear, no state change, no redirect. The app went on
believing it was authenticated while holding a dead refresh token, so every
subsequent action produced the same error and the user sat on a "token expired"
banner **indefinitely**. The only escape was signing out by hand — which is
exactly what users reported doing.

The boot path in `auth-context` had always handled this correctly (clear tokens,
status → anon, back to login). Mid-session never got the same treatment.

Now: a failed refresh calls `endSession()` → clears tokens and dispatches
`SESSION_ENDED_EVENT`, which `auth-context` listens for and turns into
`status: "anon"`. Idempotent, so a page firing six failing requests produces one
transition rather than six.

**The diagnostic tell**, if it ever recurs: if a plain page reload fixes it but
signing out is needed instead, the mid-session recovery path has regressed.

---

## "Keep me signed in" (0494)

The checkbox persisted the refresh token for 30 days and the server killed the
session after 30 minutes idle anyway. The promise and the enforcement disagreed,
and users experienced the shorter one.

The choice is now recorded on `user_session.keep_signed_in` and honoured by
`refresh()`. Everything else still applies to those sessions — rotation, reuse
detection, remote kill, `killed_at`, the 30-day refresh TTL. It is a longer
leash, not an exemption from revocation.

Threading it touched four places, and one is a trap worth remembering for **any**
new auth field:

> `zValidate` replaces `req.body` with the parsed object and `z.object()` strips
> unknown keys. A field not declared in the schema is silently dropped before the
> controller sees it. `keep_signed_in` had to be added to the login, 2FA-verify
> and PIN-login schemas or the feature would have looked implemented and done
> nothing.

Carried through the 2FA step too, or ticking the box and then completing TOTP
would lose the choice.

Sessions created before the column default to `false` — existing sessions keep
the strict timeout rather than being silently upgraded; users get the longer
session at their next sign-in.

---

## Settings and where they bite

| Setting                  | Default | Bites                                                                       |
| ------------------------ | ------- | --------------------------------------------------------------------------- |
| `JWT_ACCESS_TTL`         | `15m`   | Refresh cadence. **Must stay below `SESSION_INACTIVITY_MIN`** — see Trap 1. |
| `JWT_REFRESH_TTL`        | `30d`   | Ceiling on a keep-signed-in session, and the Redis index TTL.               |
| `SESSION_INACTIVITY_MIN` | `30`    | Idle kill for sessions **without** keep-signed-in.                          |
