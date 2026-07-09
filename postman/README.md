# Praxis LS — Postman (Phase 0 acceptance)

Import `praxis-ls.phase0.postman_collection.json` into Postman. Variables live on
the collection (no separate environment needed), but you can promote them to an
environment if you prefer.

## Before you run

1. Backend up: `npm run dev` (see `doc/SETUP.md`).
2. A tenant provisioned + an admin created:
   ```bash
   npm run db:migrate:platform
   npm run db:provision -- --slug=smartls --name="Smart Logistics" --plan=full
   npm run tenant:create-admin -- --slug=smartls --email=you@example.com --name="You" --password=secret123
   npm run platform:create-admin -- --email=root@praxisls.com --password=root123
   ```
3. **Tenant resolution is by `Host` header.** `localhost` is the _platform_ host,
   so tenant requests send `Host: smartls.praxisls.com`. Postman sends custom Host
   headers as-is — nothing to configure. (Alternative: add
   `127.0.0.1 smartls.praxisls.com` to your hosts file and set `baseUrl` to
   `http://smartls.praxisls.com:8080`.)

## Set these collection variables

`platformEmail/platformPassword`, `tenantEmail/tenantPassword`, `slug`, and
`tenantHost` — to match what you created above. Tokens (`accessToken`,
`refreshToken`, `platformToken`, `roleId`, `sessionId`, …) are captured
automatically by the login/list requests' test scripts.

## Run order

1. **1 · Platform** → `POST /auth/login` (stashes `platformToken`). If you haven't
   provisioned yet, run _provision_ then _go-live_.
2. **2 · Tenant Auth** → `POST /auth/login` (stashes `accessToken`/`refreshToken`;
   or `pendingToken` if the user has 2FA on → then `2fa/verify`).
3. Everything else, in any order.

## Phase 0 "done" checklist (what each folder proves)

| #   | Folder          | Passes when                                                                                                                                                     | Backing item                                  |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 0   | Smoke           | `whoami` returns the tenant                                                                                                                                     | multi-tenancy + Host routing                  |
| 1   | Platform        | login works; `tenants`/`catalogue` list                                                                                                                         | platform console API + platform login         |
| 2   | Tenant Auth     | login → access+refresh; refresh renews; 2FA setup/enable/verify; **refresh returns 401 SESSION_EXPIRED after 30 min idle**                                      | Auth, 2FA, 30-min inactivity                  |
| 3   | IAM / RBAC      | `/users` is **401 without a token** (proves gating); roles/capabilities/scopes/permissions/field-visibility list; a non-CEO user gets exactly the seeded grants | app_user gating, RBAC engine, permission seed |
| 4   | Sessions        | `/sessions/mine` works with no grant; killing someone else's needs MOD-68/CEO                                                                                   | Redis session store + remote kill             |
| 5   | Audit + restore | ledger reads; soft-delete request-restore then restore by a **different** admin                                                                                 | immutable ledger, two-tier deletion           |
| 6   | Settings        | `/settings` gated read                                                                                                                                          | setting module gating                         |
| 7   | Event Engine    | register an event type; create a workflow bound to an _approvable_ event; add/remove steps; read approvals                                                      | Universal Event Engine admin API              |
| 8   | Notifications   | after a `POST /permissions` (folder 3), a **HIGH** notification exists for CEO/MANAGEMENT                                                                       | Watch-the-Watcher                             |

## Not yet testable here (correctly)

Frontend-only Phase 0 items (platform console UI, sandbox toggle/banner,
white-label rendering) have no API to hit — they wait on `client/`. `scopeColumn`
record-scoping and the Line-Manager _application_ are backend mechanisms with no
Phase 0 route yet (see `doc/WORK_TO_BE_DONE.md`).
