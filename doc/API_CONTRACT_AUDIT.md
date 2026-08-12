# API Contract & Consistency Audit — Phase 0

**Date:** 2026-08-04
**Scope:** the whole HTTP surface — `src/routes/index.js`, `src/modules/**/*.routes.js`, their controllers, validators, services, and the shared middleware.
**Status:** audit only. **No endpoint contract has been changed.** Every remediation below is a proposal awaiting sign-off.

---

## 0. The API as it actually is

Measured by static extraction over all 101 `*.routes.js` files (`src/shared/http/module-loader.js` auto-mounts 100 of them; `platform` is mounted explicitly).

|                                        | count                                     |
| -------------------------------------- | ----------------------------------------- |
| Route handlers                         | **731**                                   |
| GET                                    | 323                                       |
| POST                                   | 259                                       |
| PATCH                                  | 78                                        |
| PUT                                    | 17                                        |
| DELETE                                 | 54                                        |
| Collection-level GETs (list endpoints) | 202                                       |
| Write routes (POST/PATCH/PUT)          | 354                                       |
| …of which carry a validator middleware | 294 (**83%**)                             |
| Distinct `AppError` codes in use       | **188**                                   |
| Documented in Postman                  | 137 (**~19%**)                            |
| OpenAPI / Swagger spec                 | **none**                                  |
| HTTP-level (supertest) tests           | 1 file, exercising the error handler only |

**Two top-level surfaces, two different auth models:**

- `/api/platform/*` — Praxis staff console. `platformAuth` (JWT `typ:"platform"`) + `requireCap("<domain>.<read|write>")` against `platform_role_permission`. Mounted at `src/routes/index.js:24`.
- `/api/tenant/*` — the tenant app. `hostTenantResolver` → `tenantContext` → `authMiddleware` (JWT `typ:"access"`) → `requirePermission("MOD-xx", action)` against the tenant `permission` table, optionally `requireCapability(...)` for segregation of duties. Mounted at `src/routes/index.js:33`.
- `/api/tenant/portal/*` — a **third** model: `portalAuth(ROLE)` for external client/investor/auditor users (`src/modules/portal_auth/portal_auth.routes.js:37-40`).

The tenant is resolved from the **`Host` header**, and the live/sandbox environment from the **`X-Praxis-Env` header** (`src/middleware/tenant-context.js:17-19`). Neither is documented anywhere a consumer would look.

**What is genuinely consistent, and should be preserved as the baseline:**

- The success envelope. 446 handlers return `res.json({ data })`, 82 return `res.status(201).json({ data })`. There is essentially one success shape. `client/src/lib/api-client.ts:148` unwraps it (`"data" in json ? json.data : json`).
- The error envelope _when it goes through the central handler_: `{ error: { code, message, fields? }, request_id }` (`src/middleware/error-handler.js`).
- CRUD verb mapping in the module template: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`.
- Pagination _clamping_, where it is used: `page()` in `src/shared/db/query-helpers.js:46-50` — `limit` default 50, max 200; `offset` ≥ 0.

Everything below is where reality diverges from that baseline.

---

## 1. Findings

Severity is rated by **how much confusion or breakage it causes a consumer**, not by internal tidiness.
🔴 Critical · 🟠 High · 🟡 Medium · ⚪ Low
**BC** = fixing it changes an existing contract (breaking change).

---

### 1.1 Inconsistent error handling

#### F-1 🔴 Eighteen deliberate client errors are returned to consumers as `500 INTERNAL_ERROR`

`src/middleware/error-handler.js:37-72` branches on `err instanceof AppError` → `ZodError` → PG `err.code` → generic 500. It **never reads `err.status`**.

Seven service files throw a plain `Error` with a `.status` property instead of an `AppError`. Every one of them lands in the generic branch:

| Throw site                                                                     | Author's intent               | What the consumer actually gets |
| ------------------------------------------------------------------------------ | ----------------------------- | ------------------------------- |
| `src/modules/dashboard/support/support.service.js:38`                          | 404 ticket not found          | **500**                         |
| `src/modules/dashboard/support/support.service.js:54`                          | 422 CSAT on unresolved ticket | **500**                         |
| `src/modules/dashboard/godmode/godmode.service.js:10,12,15`                    | 401 / 403 / 403               | **500**                         |
| `src/modules/dashboard/godmode/godmode.service.js:18,21`                       | 404 / 422                     | **500**                         |
| `src/modules/master/financial_dictionary/financial_dictionary.service.js:9,27` | 422 needs ≥1 posting rule     | **500**                         |
| `src/services/platform/support.service.js:38,43,48`                            | 404 / 422 / 404               | **500**                         |
| `src/services/platform/settings.service.js:73`                                 | 422 bad secret                | **500**                         |
| `src/services/platform/tenants.service.js:37,123,170`                          | 404 unknown slug / 400        | **500**                         |
| `src/services/platform/provisioning.service.js:360,384`                        | 400                           | **500**                         |

Concretely: `GET /api/tenant/support/tickets/<unknown-id>` returns
`500 { error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side — please try again.", reference: "<request_id>" } }`.

Three consequences: a consumer cannot distinguish "you asked for something that doesn't exist" from "we're broken"; a client that retries 5xx (correct behaviour) will retry forever; and every one of these logs at `logger.error` (`error-handler.js:66`), so they pollute alerting.

**Fix:** teach the handler to honour `err.status` / `err.expose`, or convert the 18 sites to `AppError`. **BC** — for these specific endpoints the status code changes 500 → 4xx. That is a _correction_, but a consumer that special-cases the 500 would notice, so it still needs the deprecation treatment in §2.

---

#### F-2 🟠 Three different response shapes for "your input was invalid"

Same class of error, three contracts:

| Path                            | Status  | Body                                                                         | Where                                                                                              |
| ------------------------------- | ------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 90 module validators (the norm) | **422** | `{ error: { code: "VALIDATION_ERROR", message, fields } }`                   | e.g. `src/modules/wms/inventory/inventory.validator.js:29`                                         |
| `workflow`, `scope` validators  | **400** | `{ error: { code: "VALIDATION_ERROR", message, fields } }`                   | `src/modules/workflow/workflow.validator.js:8`, `src/modules/security/scope/scope.validator.js:22` |
| **All auth endpoints**          | **422** | `{ error: { code: "`**`VALIDATION_FAILED`**`", message, `**`details`**` } }` | `src/modules/security/app_user/app_user.validator.js:14-18`                                        |
| Raw `ZodError` fallback         | **400** | `{ error: { code: "VALIDATION_ERROR", message, fields } }`                   | `src/middleware/error-handler.js:46-58`                                                            |

The third row is the worst placement possible: it covers `POST /auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/2fa/*`, `/auth/pin/*` — the first endpoints any new integrator touches. They learn `VALIDATION_FAILED` + `details`, then find the other 700 routes use `VALIDATION_ERROR` + `fields`.

**Downstream proof this is already biting:** `client/src/lib/api-client.ts:143` builds its typed error from `err.details`. The server emits `error.details` in exactly **one** file — `app_user.validator.js`. For the other ~700 routes the server emits `error.fields`, so `ApiError.details` is `undefined` and **field-level validation messages never reach the UI**. Nothing in `client/src` reads `error.fields`.

**Fix:** standardise on one status + one key. **BC** on both the status code (400↔422) and the payload key (`details`→`fields`).

---

#### F-3 🟡 Middleware-level errors omit `request_id`

`errorHandler` always includes `request_id`. These four do not:

- `src/middleware/host-tenent-resolver.js:53,58,63` — `TENANT_NOT_FOUND` (404), `TENANT_SUSPENDED` (403), `TENANT_NOT_READY` (423)
- `src/middleware/tenant-context.js:14` — `NO_TENANT_CONTEXT` (500)
- `src/middleware/feature-gate.js:11,24` — `NO_TENANT_CONTEXT` (500), `FEATURE_DISABLED` (403)
- `src/server.js:140,158` — `NOT_FOUND` (404) on `/media`
- `src/modules/security/app_user/app_user.routes.js:20` — `RATE_LIMITED` (429)

So `request_id` is _usually_ present but not guaranteed — which makes it useless as a support-correlation contract. The 500 body even instructs the consumer to quote it (`reference: request_id`).

**Fix:** additive (add the field). **Not BC.**

---

#### F-4 🟡 A platform-host request to the tenant API returns 500

`/api/tenant/*` runs `hostTenantResolver` then `tenantContext`. On a platform host (`localhost`, `api.*`, `admin.*`, the apex — `host-tenent-resolver.js:12-19`) the resolver sets `req.isPlatform` and calls `next()` **without** setting `req.tenant`. `tenantContext:13-17` then returns `500 NO_TENANT_CONTEXT`.

`GET /api/tenant/whoami` against `localhost` → **500**. This is a client error (wrong `Host`), and it is a documented footgun — `postman/README.md` warns "`localhost` is the _platform_ host". A 400 with a clear code would be self-explaining.

**Fix:** **BC** (500 → 4xx).

---

#### F-5 ⚪ 188 error codes, no registry

`NOT_FOUND` (210 uses) and `VALIDATION_ERROR` (96) dominate, but the long tail contains near-synonyms that a consumer cannot switch on reliably:
`INVALID_AMOUNT` (8) vs `BAD_AMOUNT` (8); `BAD_INPUT` vs `BAD_STATUS` vs `BAD_STATE` vs `BAD_RATE` vs `BAD_SEARCH` vs `BAD_FILE` vs `BAD_TEMPLATE`; `NOT_FOUND` vs `EMPLOYEE_NOT_FOUND`; `FORBIDDEN` vs `PERMISSION_DENIED` vs `CAPABILITY_REQUIRED` vs `NOT_YOURS` vs `NOT_A_MEMBER`.

There is no exported enum, so nothing prevents the 189th. **Fix is additive** (publish a registry, alias rather than rename).

---

### 1.2 Inconsistent endpoint / resource design

#### F-6 🔴 Two unrelated resources share the base path `/inbound`

```
src/modules/sales/inbound_intake/inbound_intake.routes.js:16   basePath "/inbound"  MOD-25  feature: null
src/modules/wms/inbound/inbound.routes.js:16                   basePath "/inbound"  MOD-33  feature: "wms"
```

`module-loader.js:78` does `tenantRouter.use(basePath, ...chain, def.router)` for each, in discovery order — sales at index **#70**, WMS at **#95**. Both mount on `/api/tenant/inbound`.

Today the path sets happen to be disjoint (sales owns `/enquiries*` and `/partnerships*`; WMS owns `/`, `/:id`, `/:id/qa`), so requests fall through from the first router to the second and land correctly. It works **by accident of route ordering**, and it produces observable inconsistency right now:

- `GET /api/tenant/inbound` (WMS goods receipts) is gated by `requireFeature("wms")`.
- `GET /api/tenant/inbound/enquiries` (sales enquiries) has **no feature gate** — sales/inbound_intake declares `feature: null`.
  With WMS switched off for a tenant, one `/inbound` route 403s `FEATURE_DISABLED` and its sibling returns 200.
- They enforce different permission modules (MOD-33 vs MOD-25) on the same namespace.

It is also a live landmine: the day WMS adds `GET /inbound/:id/lines`, or sales adds a bare `GET /`, one silently shadows the other. A consumer reading `/api/tenant/inbound/*` has no way to know it is two products.

**Fix:** move one (e.g. sales → `/enquiries` + `/partnerships`, or `/intake/*`). **BC** — URLs move.

---

#### F-7 🟡 `/portal` and `/portals` are different products

- `/api/tenant/portal/*` — external portal-user authentication and self-service (`portal_auth.routes.js`, `portalAuth()`).
- `/api/tenant/portals/*` — internal admin of _who may access_ the portals (`portal.routes.js`, `requirePermission("MOD-67")`).

One character apart, opposite audiences, opposite auth models. A typo silently hits a real endpoint with a different auth scheme.

**Fix:** rename one (`/portal-access` for the admin surface). **BC.**

---

#### F-8 🟡 Resource-name pluralisation is ~63/37

59 base paths are plural (`/clients`, `/vehicles`, `/quotations`, …). **35 are not**, and the split does not track a rule:

`/attendance` `/audit` `/branding` `/catalogue` `/compliance` `/cost-tracking` `/dashboard` `/dispatch` `/document-verification` `/equipment` `/field-visibility` `/financial-dictionary` `/financing` `/fuel` `/god-mode` `/goods-received` `/inbound` `/inventory` `/leave` `/mail` `/onboarding` `/outbound` `/payroll` `/portal` `/pricing-variance` `/regie` `/smartcomm` `/succession` `/support` `/talent-pool` `/tax` `/vehicle-compliance` `/workspace` `/ai` `/dashboard`

Some are genuine mass nouns (`/inventory`, `/mail`, `/branding`) and defensible. Others are plain collections named in the singular: `/fuel` (fuel logs, has `POST /`, `GET /:id`, `DELETE /:id`), `/dispatch` (dispatch orders), `/equipment`, `/goods-received`, `/succession`, `/onboarding`. There is no way to guess which a resource will be.

**Fix:** aliases + redirects; **BC** if the old paths are ever removed.

---

#### F-9 🟡 Module-to-URL mapping is not derivable, and three modules claim the tenant root

`module-loader.js` defaults `basePath` to `/<module-dir>`, but 100 modules override it, and the mapping is frequently non-obvious:

| Module directory              | URL            |
| ----------------------------- | -------------- |
| `finance/debt`                | `/financing`   |
| `costing/regie`               | `/regie`       |
| `finance/smart_receivables`   | `/receivables` |
| `finance/financial_statement` | `/statements`  |
| `finance/tax_declaration`     | `/tax`         |
| `hr/leave_allowance`          | `/leave`       |
| `hr/sop_onboarding`           | `/sops`        |
| `vault/document_vault`        | `/documents`   |
| `wms/warehouse_location`      | `/locations`   |
| `sales/inbound_intake`        | `/inbound`     |

Three modules declare `basePath: "/"` and mount sub-routers at the tenant root:

- `master/treasury_account` → `/treasury-accounts`, `/payment-gateways`
- `security/app_user` → `/users`, `/auth`
- `workflow` → `/event-types`, `/workflows`, `/approvals`

This is deliberate and documented in each file, and it is safe — each sub-router carries its own prefix and its own `authMiddleware`. But it means **no static reading of `basePath` yields the URL table**, which is precisely why there is no generated spec. Grep for `/api/tenant/approvals` and you find nothing.

**Fix:** a generated route manifest (§2 Phase 1). **Not BC.**

---

#### F-10 🟡 Grouping depth is arbitrary

Two HR resources are nested — `/hr/queries`, `/hr/sanctions` — while eleven siblings in the same `hr/` group are flat: `/appraisals` `/attendance` `/contracts` `/leave` `/onboarding` `/payroll` `/sops` `/succession` `/talent-pool` `/trainings` `/vacancies`. Similarly `/ai/governance` is nested under `/ai` while `/ai/ask` is a leaf of the assistant module.

**Fix:** **BC.**

---

#### F-11 🟡 Two idioms for the same operation: lifecycle transitions

18 resources move a record through a state machine. They split cleanly by domain team, not by semantics:

**`POST /:id/status` with body `{ status: "..." }`** — 11 resources
`/dispatch` `/incidents` `/work-orders` `/contracts` `/payroll` `/trainings` `/vacancies` `/equipment` `/outbound` `/users/:id/status` `/portal/users/:id/status`

**`POST /:id/transition` with body `{ to: "..." }`** — 7 resources
`/quotations` `/operations` `/purchase-orders` `/purchase-requests` `/leads` `/campaigns` `/proposals`

Plus one-offs for what is structurally the same act: `POST /leave/:id/decision`, `POST /inventory/:id/state` (`{ state }`), `POST /milestones/:id/advance`, `POST /compliance/:id/resolve`, `POST /opportunities/:id/{move,win,lose}`, `POST /success-stories/:id/{sign-off,publish,unpublish}`, `POST /assets/:id/{depreciate,dispose}`, `POST /financing/:id/{drawdown,repay}`, `POST /hr/sanctions/:id/lift`, `POST /onboarding/:id/complete`.

A client writing a generic "advance this record" helper cannot; it needs a per-resource lookup table.

**Fix:** **BC** on the URL _and_ the body key.

---

#### F-12 🟡 `DELETE` means two different things

44 `DELETE /:id` routes call `controller.archive` → `makeService.archive` (`src/shared/crud/resource.js:120-175`): flips the active column if there is one, always writes a `soft_delete` row, returns `{ archived: true, deleted: <bool>, <pk>: id }`.

Five call `controller.remove` and really delete:
`DELETE /employees/:id`, `/expense-rates/:id`, `/chart-of-accounts/:code`, `/financing/:id`, `/settings/:section/:key`.

Both return **200** with a `data` body — never 204 — and the payload differs between them. A consumer cannot tell from the contract whether the record is recoverable.

**Fix:** **BC** if the response shape is unified.

---

#### F-13 ⚪ Identity in the body instead of the URL, and inverted nesting

- `PUT /api/tenant/permissions/grant` (`permission.routes.js:27`) — `grant` is a verb, there is no identifier in the path, and the resource identity `(role_id, module_key)` comes from the body (`permission.repo.js` `upsertGrant`).
  The platform side does the same job the other way: `PUT /api/platform/roles/:id/permissions` (`platform.routes.js:40`). Two halves of one product, opposite conventions.
- `PUT /api/tenant/capabilities/users/:userId` (`capability.routes.js:29`) — users nested under capabilities; everywhere else the owner comes first.

**Fix:** **BC.**

---

#### F-14 ⚪ Reads that are POSTs, and one read that writes

- `POST /reports/run/:key/pdf` (`report.routes.js:14`) runs a report, renders a PDF, **vaults it**, returns 201. Its siblings `GET /reports/run/:key` (JSON) and `GET /reports/run/:key/export?format=csv|xlsx` (binary) are GETs. Three shapes for "run report key K".
- `POST /extra-charge-simulations/preview` and `POST /margin-simulations/preview` are pure computations gated on `"view"` — correct as POSTs (large body), but the `view`-gated POST is otherwise unheard of in this API.
- `report.controller.js:16` reads parameters from `req.body.params || req.query` — the same endpoint accepts input from two places, and nothing says which wins.

---

### 1.3 Missing / inconsistent input validation

#### F-15 🟠 60 write routes accept an unvalidated body (17% of writes)

294 of 354 write routes carry a validator. Of the 60 that don't, most are genuinely bodyless (`POST /success-stories/:id/publish`, `POST /hr/sanctions/:id/lift`). These **do read `req.body` without validating it**:

| Route                                            | File                                              | Reads                                                                               |
| ------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `PUT /api/tenant/permissions/grant`              | `security/permission/permission.routes.js:27`     | `req.body` → `role_id`, `module_key`, 5 booleans — **writes the RBAC grant matrix** |
| `PUT /api/tenant/branding`                       | `branding/branding.routes.js:17`                  | whole appearance object                                                             |
| `PUT /api/tenant/branding/login`                 | `branding/branding.routes.js:23`                  | whole login-screen object                                                           |
| `POST /api/tenant/branding/logo`                 | `branding/branding.routes.js:18`                  | `data_url`                                                                          |
| `POST /api/tenant/branding/login/background`     | `branding/branding.routes.js:24`                  | `data_url`                                                                          |
| `POST /api/tenant/mail/senders`                  | `mail/mail.routes.js:55`                          | sender upsert body                                                                  |
| `PATCH /api/tenant/mail/senders/:id`             | `mail/mail.routes.js:54`                          | sender patch                                                                        |
| `POST /api/tenant/mail/thread/:id/link`          | `mail/mail.routes.js:69`                          | link target                                                                         |
| `PATCH /api/tenant/audit/reviews/:id`            | `security/audit_ledger/audit_ledger.routes.js:31` | review completion                                                                   |
| `PATCH /api/tenant/smartcomm/quick-replies/:id`  | `smartcomm/smartcomm.routes.js:31`                | quick-reply body                                                                    |
| `POST /api/tenant/reports/run/:key/pdf`          | `vault/report/report.routes.js:14`                | `params`, `entity_id`                                                               |
| `POST /api/tenant/scopes/:id/members`            | `security/scope/scope.routes.js:66`               | member add                                                                          |
| `POST /api/platform/settings/:section/:key/test` | `platform/platform.routes.js:79`                  | — plus unvalidated `:section`/`:key`                                                |
| `POST /api/platform/ai-vendors/:vendor/test`     | `platform/platform.routes.js:84`                  | unvalidated `:vendor`                                                               |

`upsertGrant` is the one that matters most. It is SQL-parameterised and coerces the five permission flags with `!!` (`permission.repo.js`), so it is not injectable — but `role_id` and `module_key` are unchecked. A non-UUID `role_id` produces a Postgres `22P02`, which `error-handler.js:26` maps to `400 INVALID_VALUE` — a _fourth_ validation-error shape (see F-2), reached through the database rather than the validator.

**Fix:** additive for well-formed callers; **BC** for callers currently getting away with malformed input.

---

#### F-16 🟠 Query and path parameters are almost never validated

Only **3** of 92 validators parse `req.query`:
`finance/tax_declaration/tax_declaration.validator.js:11`, `finance/financial_statement/financial_statement.validator.js:12`, `vault/document_verification/document_verification.validator.js:16`.

**Zero** validate `req.params`. Everything else trusts the string and lets Postgres decide. Two visible consequences:

1. **Unknown filters are silently ignored.** Repo list methods pick named keys off `req.query` (`q.status`, `q.q`, `q.client_id`, …). `GET /api/tenant/clients?statuss=ACTIVE` returns the **unfiltered** list with 200. A consumer with a typo gets wrong data and no signal — the single most dangerous failure mode in this audit, because it is silent.
2. **Malformed IDs produce a DB-shaped error.** `GET /api/tenant/clients/not-a-uuid` → `22P02` → `400 { code: "INVALID_VALUE", message: "One of the values is in the wrong format" }`, with no `fields` and no indication that the problem was the path parameter.

Ad-hoc coercion fills the gap inconsistently: `Number(req.query.amount)` (`currency.controller.js`), `Number(limit) || 50` (`smartcomm.service.js` `thread`), `String(req.query.format || "csv")` (`report.controller.js:23`).

**Fix:** rejecting unknown query params is **BC**. Validating types is **BC** for callers currently sending junk.

---

#### F-17 🟡 `PATCH` bodies are `create.partial()`, so every writable field is patchable

The near-universal module idiom is `const schemas = { create, update: create.partial() }`. Any field accepted at create is accepted on `PATCH /:id`, including server-owned lifecycle fields where the create schema declares them — e.g. `hr/hr_contract` (`status` in `create`, so `PATCH /contracts/:id { status: "SIGNED" }` bypasses `POST /contracts/:id/status` and its gate), `hr/training`, `hr/vacancy`, `wms/equipment`, `wms/outbound`.

So for those resources there are **two** paths to a state change with **different** permission requirements (see F-21).

**Fix:** **BC** — narrowing a PATCH schema rejects bodies that work today.

---

### 1.4 Versioning gaps

#### F-18 🔴 There is no versioning of any kind

No `/v1` prefix, no `Accept-Version` / `X-API-Version` header, no media-type versioning, no `deprecated` markers, no sunset headers. Grep across `src/` and `client/src/` returns nothing.

`package.json` says `"version": "0.1.0"`, which is the deployable's version and is not surfaced on the wire. `GET /api/health` returns `{ ok: true, ts }` — no version, no build id.

The practical position: **the only version of the API is whatever is deployed right now**, and the only way to change an endpoint compatibly is to add to it. Every finding in this document that is marked **BC** currently has no mechanism to roll out behind.

This is the single highest-leverage gap, because it is the prerequisite for fixing most of the others.

---

#### F-19 🟠 Modules can vanish from the API without any error

`module-loader.js:63-70`: a module whose `require()` throws is logged at `warn` and **skipped**, and boot continues.

```js
} catch (err) {
  logger.warn({ module: `${m.group}/${m.module}`, err: err.message }, "skipped module (load error)");
  continue;
}
```

A typo in one module's dependency chain silently removes its entire route family from a running deployment; consumers see `404 NOT_FOUND` from `notFoundHandler` — indistinguishable from "you got the URL wrong". The rationale (one bad module must not crash boot) is sound; the missing half is that nothing asserts the expected route table is present. There is no startup manifest and no health signal that lists mounted modules.

**Fix:** additive (health endpoint reports the mounted set; CI asserts the manifest).

---

### 1.5 Authorization inconsistency

#### F-20 🔴 Platform secret management has no capability check

`src/modules/platform/platform.routes.js`. Every route in the file carries `requireCap(...)` — 35 of them — **except these eight**:

```
75  router.get ("/settings",                       c.settingsList);
76  router.post("/settings/push/vapid/generate",   validate("vapidGenerate"), c.vapidGenerate);
77  router.get ("/settings/:section/:key",         c.settingGet);
78  router.put ("/settings/:section/:key",         validate("platformSetting"), c.settingPut);
79  router.post("/settings/:section/:key/test",    c.settingTest);
82  router.get ("/ai-vendors",                     c.aiVendorsList);
83  router.put ("/ai-vendors/:vendor",             validate("aiVendorSet"), c.aiVendorSet);
84  router.post("/ai-vendors/:vendor/test",        c.aiVendorTest);
```

They are behind `platformAuth` (line 21), so a token is required — but **any** authenticated platform user, of **any** role, passes. The controllers add no check either (`platform.controller.js:201-242`).

What that governs: deploy-wide S3 credentials, Geoapify keys, VAPID push keys, and the AI vendor API keys every tenant's AI runtime uses (`settings.service.js`, `aiVendors`). A platform user provisioned with only `support.read` — the narrowest role in `CAP_CATALOGUE` (`platform-auth.js:69-75`) — can rotate the deployment's object-storage credentials and read back presence/last-4 of every secret.

This is a privilege-escalation hole _through_ the platform's own permission matrix, and it is the one finding here that is a security issue rather than a consistency issue.

**Fix:** add `requireCap("settings.read"/"settings.write")` (new capabilities) or reuse an existing write cap. **BC** for any non-root platform role currently relying on the gap — which is the point.

---

#### F-21 🟠 Structurally identical lifecycle endpoints require different permissions

Advancing a record's state — one operation class — is gated four different ways:

| Gate                                                                                                                                             | Endpoints                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `requireTransitionPermission(MODULE, TRANSITION_ACTION)` — per-target-state, the deliberate design in `src/shared/http/transition-permission.js` | `POST /quotations/:id/transition`, `POST /purchase-orders/:id/transition`, `POST /purchase-requests/:id/transition` (local copy), `POST /payroll/:id/status` |
| flat `requirePermission(M, "edit")`                                                                                                              | all 10 other `POST /:id/status`; `POST /operations/:id/transition`; `POST /leads/:id/transition`; `POST /campaigns/:id/transition`                           |
| flat `requirePermission(M, "approve")`                                                                                                           | `POST /proposals/:id/transition`                                                                                                                             |
| **`PATCH /:id`** with `{ status }`, gated `"edit"`                                                                                               | the F-17 resources — a second, cheaper route to the same state change                                                                                        |

So approving a purchase request needs `approve`; setting a contract to `SIGNED` or a work order to `DONE` needs only `edit`; and for `hr_contract` the same transition is reachable via `PATCH /contracts/:id` under `edit` regardless. An administrator configuring the permission matrix cannot predict what a grant permits.

Note `purchase_request.routes.js:35-38` reimplements `requireTransitionPermission` locally rather than importing the shared helper — same behaviour, duplicated.

**Fix:** **BC** — tightening a gate 403s callers who succeed today.

---

#### F-22 🟡 In Smart Comms, `view` authorises writes

`src/modules/smartcomm/smartcomm.routes.js` binds `view = requirePermission("MOD-64","view")` and `create = requirePermission("MOD-64","create")`, then gates on `view`:

```
40  POST   /channels/:id/members            view
41  DELETE /channels/:id/members/:userId    view
53  PATCH  /messages/:messageId             view
54  DELETE /messages/:messageId             view
55  POST   /messages/:messageId/react       view
56  POST   /messages/:messageId/star        view
38  POST   /channels/:id/archive            view
46  PUT    /channels/:id/draft              view
```

while `PATCH`/`DELETE /quick-replies/:id` are gated on `create`, and `POST /channels/:id/messages` on `create`.

The service does carry the real authorisation — `assertMember` on channel operations, sender-ownership on message edit/delete (`smartcomm.service.js:100-114`) — and the module header says so. Two residual gaps in the service, though:

- `react` (`smartcomm.service.js:~85`) and `star` (`~137`) never call `assertMember`, so any user with MOD-64 `view` can react to or star **any** message by id, in any channel.
- `listMembers` is `(client, { groupId }) => repo.listMembers(...)` with no membership assert, so `GET /channels/:id/members` discloses any channel's roster.

Separately from those, the contract problem stands: the RBAC action on the route is not a truthful description of what the endpoint does, so granting `MOD-64: view` also grants "add and remove channel members".

---

#### F-23 🟡 Authenticated-but-ungated endpoints are correct, but undeclared

61 routes run `authMiddleware` with no `requirePermission`. Nearly all are legitimately self-scoped and say so in a comment — `/notifications/*`, `/workspace`, `/sessions/mine`, `/ai/*`, the seven `/{resource}/mine` endpoints, `/auth/*`. Two are gated by other means: `/god-mode/*` uses `requireCeo()` + a PIN; `/support/tickets` is tenant-scoped in the service.

There is no problem with the behaviour. The problem is that "self-scoped, no grant required" is a real access tier that exists **only in prose comments** — it is not expressible in the permission matrix, not visible to an administrator, and not discoverable by a consumer. `GET /appraisals/mine` and `GET /appraisals` differ enormously in who can call them and nothing declares that.

**Fix:** additive (declare a `self` scope in the manifest).

---

#### F-24 ⚪ Unauthenticated routes — reviewed, all justified

For completeness, the 10 routes with no auth at all, each deliberate:

| Route                                     | Why                                                   |
| ----------------------------------------- | ----------------------------------------------------- |
| `GET /branding`, `GET /branding/login`    | must render before login                              |
| `POST /mail/webhook/{microsoft,google}`   | provider callbacks                                    |
| `POST /platform/auth/{login,refresh}`     | token acquisition                                     |
| `POST /portal/auth/{login,forgot,accept}` | portal token acquisition                              |
| `GET /document-verification/scan`         | public QR verification; returns only a tamper verdict |

`GET /media/*` is allow-listed in `src/server.js:136-141` and 404s (not 403s) anything outside the public prefixes — deliberate, and correct. Rate limiting exists on exactly two routes (`/auth/forgot-password`, `/auth/reset-password`, `app_user.routes.js:20-22`); `POST /auth/login`, `/auth/pin/login` and `/portal/auth/login` are unthrottled at the app layer.

---

### 1.6 Documentation gaps

#### F-25 🟠 No API spec exists; the one artefact that does is 19% complete and has drifted

- **No OpenAPI/Swagger anywhere** — no spec file, no generator, no annotations. Nothing can produce a client SDK, a mock server, or a contract test.
- `postman/praxis-ls.phase0.postman_collection.json` holds **137 requests against 731 routes (~19%)**, and is explicitly scoped to "Phase 0 acceptance". It covers fleet/WMS/HR/finance reads well and omits Smart Comms, mail, documents, reports, AI, portals, workflow approvals, and most write paths.
- Already-detected drift: the collection calls `POST /api/tenant/audit/soft-deletes/{{id}}/request-restore`, which **does** exist (`audit_ledger.routes.js:33-37`) — it was invisible to route extraction because it is the only multi-line `router.post(` in the codebase. That cuts both ways: the collection is not a reliable index of the API, and neither is grepping the routes files.
- The 61 doc files under `doc/` are design and session notes, not a reference. `doc/CONVENTIONS.md` and `doc/BUILD_CONVENTIONS.md` describe intended structure, not the delivered contract.
- **The out-of-band request contract is undocumented**: `Host` selects the tenant (`host-tenent-resolver.js`), `X-Praxis-Env: sandbox` selects the sandbox schema (`tenant-context.js:17`), and identity always resolves against the live schema regardless. A third-party integrator cannot derive any of that.

---

### 1.7 Pagination / filtering / sorting

#### F-26 🟠 No list endpoint reports a total, so no consumer can paginate

None of the 202 collection GETs return a count, a cursor, `has_more`, or a `Link` header. Every one returns a **bare array** in `data`.

`page()` (`query-helpers.js:46-50`) defaults `limit` to **50**. The frontend never sends `limit` or `offset` on any list screen — the only occurrence in `client/src` is a typeahead (`client/src/features/sales/ui.tsx:207`).

So today: **every list screen in the app silently shows at most the 50 most recent rows and presents them as the complete set.** A tenant with 300 clients sees 50 and no indication of the rest. This is a functional data-truncation problem produced directly by the contract gap, and it is the finding with the largest real-world impact after F-20.

**Fix:** adding `meta` alongside `data` is **safe** — `api-client.ts:148` returns `json.data`, so extra top-level keys are ignored by the current client. Changing `data` from an array to an object would break every consumer.

---

#### F-27 🟠 17 list endpoints have no `LIMIT` at all

These repos build list queries with no bound, so the endpoint returns the entire table:

`hr/training` · `hr/vacancy` · `hr/payroll/earning` · `finance/financial_statement` · `vault/compliance_flag` · `vault/document_signature` · `branding` · `wms/outbound` · `operations/service_type` · `catalogue` · `security/field_visibility` · `security/iam_role` · `security/capability` · `security/setting` · `security/permission` · `security/session` · `security/scope`

`security/session` and `security/permission` are the ones that grow without bound in production. `GET /api/tenant/sessions` returns every session row the tenant has ever had.

A further 17 repos hand-roll `LIMIT` without `page()` (`ai/assistant`, `security/audit_ledger`, `security/app_user`, `finance/journal_entry`, `wms/inventory`, `dashboard/*`, …), so their clamping rules differ from the shared one.

**Fix:** applying a default limit to an endpoint that currently returns everything is **BC** — a consumer relying on completeness would silently start truncating. This must be opt-in per endpoint with a `limit` parameter first.

---

#### F-28 🟡 Filtering is undeclared, per-repo, and silently ignores typos

Filter keys are picked ad hoc inside each repo: `q.status` (60 uses), `q.q` (32), `q.dossier_id` (22), `q.entity_id` (18), `q.employee_id` (14), `q.client_id` (14), `q.kind` (12), `q.vehicle_id` (10), plus `q.is_active` (9) **and** `q.active` (9) for the same concept on different resources. Nothing enumerates which resource supports which filter, and unknown keys are dropped (F-16).

Free-text search is consistently `?q=` (35 uses) — one of the few things that is uniform — but `searchColumn` is single-column and opt-in per repo, so `?q=` matches different things per resource and does nothing at all on repos that don't set it.

**Fix:** documenting is additive; rejecting unknown filters is **BC**.

---

#### F-29 🟡 Sorting is not exposed anywhere

No endpoint accepts a `sort` / `order_by` parameter. Order is fixed at `makeRepo` config time — `cfg.orderBy || "created_at DESC"` (`resource.js:31`) — and hand-written repos hardcode their own `ORDER BY`. Every consumer that wants a different order must fetch and sort client-side, which combined with F-26/F-27 means sorting over a truncated 50-row window.

**Fix:** additive.

---

### 1.8 Backward-compatibility risk

#### F-30 🔴 There is no mechanism that would catch a contract regression

- **No versioning** (F-18) — nothing to roll a change out behind.
- **No spec** (F-25) — no machine-readable statement of the contract to diff.
- **No contract tests.** 80 test files; **one** (`tests/unit/async-safe.test.js`) drives HTTP via supertest, and it exercises the error handler on a synthetic app. Three others assert status codes on service functions. **Zero** assert the response shape of a real endpoint. A PR that changes `{ data: [...] }` to `{ items: [...] }` on any of 731 routes passes CI.
- **Consumers are invisible.** The React app is the known consumer; nothing records what else calls the API. `client/src/lib/*-api.ts` (18 modules) is the de-facto client SDK, hand-maintained, with no generated types tied to the server.
- **The client couples to the envelope.** `api-client.ts:148` unwraps `data`; `:143` reads `error.code`, `error.message`, `error.details`. Those three are load-bearing across every screen.

**Current safe-change envelope — what can be changed today without breaking the app:**

| Change                                          | Safe?                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Add a field inside `data`                       | ✅                                                                  |
| Add a top-level key beside `data` (e.g. `meta`) | ✅ — client returns `json.data` only                                |
| Add a new endpoint                              | ✅                                                                  |
| Add an optional query parameter                 | ✅                                                                  |
| Add a new error `code`                          | ⚠️ — client passes it through, but screens switch on specific codes |
| Change a status code                            | ❌                                                                  |
| Rename/remove a field inside `data`             | ❌                                                                  |
| Change `data` from array to object              | ❌ — breaks all 202 list consumers                                  |
| Rename `error.fields` / `error.details`         | ❌                                                                  |
| Move a URL                                      | ❌                                                                  |
| Tighten a validator or a permission gate        | ❌                                                                  |

Everything marked ❌ is required by findings F-1, F-2, F-6, F-7, F-8, F-10, F-11, F-12, F-13, F-16, F-17, F-20, F-21, F-27.

---

## 2. Remediation roadmap

Ordering principle: **build the safety net before touching a single contract.** Phases 1–2 change nothing a consumer can observe except by addition. Phase 3 introduces the versioning mechanism. Phases 4–5 spend it.

Global rules for every phase:

- No endpoint's behaviour changes without explicit sign-off, recorded per finding.
- Every contract change ships in `v2` first; `v1` keeps its exact current behaviour, bug-for-bug (including F-1's 500s).
- Deprecation window: **two minor releases or 90 days, whichever is longer**, from the day `v2` and a migrated first-party client both ship.
- Deprecations are announced on the wire: `Deprecation: true`, `Sunset: <RFC 1123 date>`, `Link: <…>; rel="successor-version"`.

---

### Phase 1 — Make the contract observable _(no behaviour change)_

**Scope.** Discover and publish what the API is today, exactly as it is — including its inconsistencies.

**Dependencies.** None. Start here.

**Deliverables.**

1. **Route manifest generator** — `scripts/api/manifest.js` walks `module-loader.discover()`, mounts each router into a throwaway Express app, and introspects `router.stack` to emit `doc/api/manifest.json`: method, full path, module, feature gate, RBAC module+action, validator presence, handler location. Introspecting the mounted stack (not grepping source) is what handles F-9's `basePath: "/"` modules and F-25's multi-line route.
2. **OpenAPI 3.1 generation** — `doc/api/openapi.json`, from the manifest plus the existing zod schemas (`zod-to-json-schema` over each validator's exported `schemas`; 92 validators already export them). Response schemas start as `{ data: <unknown> }` and are filled in during Phase 2. It must describe reality, including `Host` and `X-Praxis-Env`, and including the three validation-error shapes.
3. **Error-code registry** — `src/shared/http/error-codes.js` enumerating all 188 codes with status and meaning; a lint rule requiring `AppError` codes to come from it. No code is renamed.
4. **Mounted-module health signal** — extend `GET /api/health` with `modules: [...]` and `api_version`. Purely additive; closes F-19's silent-skip blind spot.
5. **CI gates** — regenerate the manifest and diff against the committed copy; fail on any unreviewed route addition, removal, or gate change.

**Rollout.** Nothing to roll out — additive only. `GET /api/health` gains fields.

**Exit criteria.** `openapi.json` validates; manifest diff is green; every route in the manifest has an owner module and a declared gate.

---

### Phase 2 — Freeze the contract with tests, and fix what is unambiguously broken

**Scope.** Lock current behaviour under test, then land the changes that are corrections rather than redesigns.

**Dependencies.** Phase 1 manifest + registry.

**Deliverables.**

1. **Contract test harness** — supertest against `buildApp()` with a seeded tenant, driven from the manifest. Golden-file assertions on status + response shape for a representative route per module (~100 routes), and for every auth/RBAC boundary: 401 unauthenticated, 403 unpermitted, 404 unknown id, 422 invalid body. This is the artefact that makes every later phase safe.
2. **F-3 — `request_id` on every error.** Route the middleware-level responses in `host-tenent-resolver.js`, `tenant-context.js`, `feature-gate.js`, `server.js`, and the rate limiter through the central handler. Additive: a field appears where it was absent. **Not BC.**
3. **F-26 — pagination metadata, additive.** Add `meta: { limit, offset, count, has_more }` beside `data` on all 202 list endpoints. `data` stays a bare array. Safe because `api-client.ts:148` returns `json.data` and ignores siblings — verify per consumer before shipping.
4. **F-29 — opt-in sorting.** Add `?sort=<field>&order=asc|desc` validated against a per-resource allow-list. Absent ⇒ today's fixed order, unchanged.
5. **F-20 — platform secret authorization.** Add `settings.read` / `settings.write` / `ai_vendors.write` to `CAP_CATALOGUE` and gate the eight routes in `platform.routes.js:75-84`. Grant them to `PLATFORM_ROOT_ADMIN` (which bypasses anyway) and to any role that legitimately needs them, in the same migration that adds the capabilities — so no operator loses access at deploy. **Behaviour change, requires sign-off**, but it is a security fix and the intended state; ship it in `v1` rather than waiting for `v2`.
6. **F-22 — Smart Comms membership asserts.** Add `assertMember` to `react`, `star`, and `listMembers` in `smartcomm.service.js`. Behaviour change only for callers acting outside their channels. Sign-off required; route gates are **not** touched here (that is Phase 5).
7. **F-25 — Postman collection regenerated** from the OpenAPI document, so it can no longer drift.

**Rollout.** Items 2–4 are additive. Items 5–6 are deliberate restrictions — announce, ship behind a feature flag defaulting **on**, keep the flag for one release as a rollback.

**Exit criteria.** Contract suite green and required on every PR; `meta` present on all list endpoints; platform secret routes gated.

---

### Phase 3 — Introduce versioning

**Scope.** Build the mechanism that makes every remaining fix shippable. This phase changes no endpoint's behaviour.

**Dependencies.** Phase 2 contract tests — without them, dual-mounting risks silent divergence.

**Deliverables.**

1. **Dual mount.** `/api/v1/*` and `/api/v2/*` both serve the current routers. Un-versioned `/api/tenant/*` and `/api/platform/*` remain, permanently aliased to `v1`. At the end of this phase **all three prefixes are byte-identical** — the contract suite asserts exactly that.
2. **Version resolution.** Prefix wins; `Accept-Version` header as fallback; default `v1`. Resolved version on `req.api_version` and echoed as `X-API-Version` on every response.
3. **Compatibility-shim layer** — `src/shared/http/compat.js`, a response transform applied on the `v1` path only, so a handler can be written to the `v2` contract while `v1` consumers keep the old shape. This is what lets Phases 4–5 change handlers once instead of forking them.
4. **Deprecation tooling** — `deprecate({ sunset, successor })` middleware emitting `Deprecation`/`Sunset`/`Link`; a counter per deprecated route per consumer (by token subject and `User-Agent`) so the sunset decision is evidence-based rather than calendar-based.
5. **Client version pin.** `client/src/lib/api-client.ts` targets `/api/v1` explicitly. Generate TypeScript types from `openapi.json` and adopt them in the 18 `*-api.ts` modules, so a server contract change fails the client build.
6. **Consumer inventory.** Log distinct `(token subject, User-Agent)` pairs per route for 30 days. Nothing may be sunset before this has run.

**Rollout.** Additive. The un-versioned prefix is never removed.

**Exit criteria.** `v1` ≡ `v2` ≡ un-versioned under the contract suite; client pinned; consumer telemetry flowing.

---

### Phase 4 — Standardise errors, validation, and pagination on `v2`

**Scope.** The cross-cutting contracts — the ones every consumer touches on every call. Doing these together means one migration for a client, not three.

**Dependencies.** Phase 3 versioning + shim; Phase 3 consumer inventory.

**Deliverables (all `v2`-only; `v1` behaviour preserved via `compat.js`).**

1. **F-1 — honour `err.status`.** Convert all 18 plain-`Error` sites to `AppError`. In `v2` they return their intended 4xx. In `v1` the shim maps them back to `500 INTERNAL_ERROR` **only for the exact routes affected**, preserving today's behaviour bug-for-bug, with a deprecation header. Flagged prominently: `v1`'s 500 on `GET /support/tickets/:id` is a bug being deliberately preserved for the window.
2. **F-2 — one validation-error contract.** `v2`: **422** `{ error: { code: "VALIDATION_ERROR", message, fields } }` for every validator, replacing the four current shapes. 422 (not 400) because it is already the 90-validator majority. The shim rewrites `v2` → `v1`'s per-route legacy shape, including `app_user`'s `VALIDATION_FAILED`/`details`. Fix `api-client.ts` to read `fields` (with a `details` fallback) so field errors finally surface — deliverable in its own right.
3. **F-15 — validators on the 14 unvalidated body-reading routes**, `permission/grant` first. `v2` enforces; `v1` logs a `would_reject` warning for one release, then enforces on the same schedule as everything else in this phase.
4. **F-16 — query and path validation.** `v2`: typed params, and **unknown query parameters are rejected** with `VALIDATION_ERROR` naming the unknown key. `v1`: log-only. This is the fix for the silent-typo-returns-wrong-data failure.
5. **F-27 — bound the 17 unbounded lists.** Two steps: (a) `v1` and `v2` both gain `limit`/`offset` support and a `meta.count`, defaulting to _unbounded_ in `v1`; (b) `v2` applies the standard 50/200 default. `v1` stays unbounded for the whole window — this is the one place where the compatible path is to leave a performance problem in place until consumers have migrated. `GET /sessions` and `GET /permissions` get an interim hard cap of 5,000 in `v1` with a logged warning, as an availability guard.
6. **F-28 — declared filters.** Per-resource filter allow-lists in OpenAPI, enforced in `v2` by (4).
7. **F-5 — error-code consolidation.** `v2` collapses the near-synonyms (`BAD_AMOUNT`→`INVALID_AMOUNT`, `EMPLOYEE_NOT_FOUND`→`NOT_FOUND`, `FORBIDDEN`→`PERMISSION_DENIED`). The shim maps back for `v1`. No code is deleted from the registry; retired ones are marked `alias_of`.

**Rollout.** `v2` ships dark; first-party client migrates screen-group by screen-group behind a flag; deprecation headers go on `v1` the day the client is fully migrated; sunset only when the Phase 3 consumer counters show zero non-first-party `v1` traffic for 30 consecutive days.

**Exit criteria.** Client fully on `v2`; `v1` traffic from first-party sources at zero.

---

### Phase 5 — Standardise resource design and authorization on `v2`

**Scope.** The URL- and gate-level changes. Last, because each is individually breaking and collectively they are a client rewrite — they must land in one migration, not five.

**Dependencies.** Phase 4 complete and `v1` first-party traffic at zero.

**Deliverables (`v2` paths; `v1` paths retained and 308-redirected or dual-mounted).**

1. **F-6 — resolve the `/inbound` collision.** Sales intake moves to `/enquiries` + `/partnerships`; WMS keeps `/inbound`. **Highest priority in this phase** — it is the only finding that can silently change which handler serves a request as the code evolves. Add a boot-time assertion in `module-loader.js` that two modules may never claim the same `basePath` — that assertion is cheap and can ship in **Phase 1**, ahead of the URL move.
2. **F-11 — one lifecycle idiom.** `POST /:id/transitions` with body `{ to }` for all 18 resources plus the one-off action routes. `v1` keeps `/status` (`{ status }`) and `/transition` (`{ to }`); the shim translates both.
3. **F-21 — one lifecycle gate.** `requireTransitionPermission` on every transition route, with a per-resource `TRANSITION_ACTION` map reviewed with the business owner. Remove the local copy in `purchase_request.routes.js:35`. Pair with **F-17**: `v2` PATCH schemas drop server-owned lifecycle fields, closing the cheaper second path.
4. **F-12 — `DELETE` semantics declared.** `v2` returns **204** for hard delete and **200 `{ data: { archived: true, … } }`** for soft; OpenAPI states which each resource does. The five hard-delete routes are labelled explicitly.
5. **F-7, F-8, F-10, F-13 — naming.** `/portals`→`/portal-access`; pluralise the 20-odd genuine collections currently singular (mass nouns keep their names); flatten `/hr/queries`→`/hr-queries`, `/hr/sanctions`→`/hr-sanctions` (or nest all 13 HR resources under `/hr` — one or the other, not both); `PUT /permissions/grant`→`PUT /roles/:roleId/permissions/:moduleKey`, matching the platform side; `PUT /capabilities/users/:userId`→`PUT /users/:userId/capabilities`.
6. **F-14 — report endpoints.** `GET /reports/:key/results` (JSON), `GET /reports/:key/results.{csv,xlsx}` (binary), `POST /reports/:key/renders` (creates a vaulted PDF, 201 — a POST because it creates a resource). Single parameter source (query), documented.
7. **F-23 — declare the self-scoped tier.** A `self` marker in the manifest and OpenAPI for the 61 authenticated-ungated routes, and a `requireSelfScope()` marker middleware so the tier is expressed in code rather than comments. No behaviour change.
8. **`GET /documents/:id/download` content type** — currently hardcoded to `application/pdf` with a `.pdf` filename (`document_vault.controller.js:13-15`), while the vault accepts PNG, JPEG, WEBP, TXT, CSV, DOCX and XLSX (`document_vault.service.js:14-19`). Every non-PDF download is served mislabelled. `content_type` is not persisted on the row, so this needs either a migration or derivation from the `storage_path` extension. **This is a real defect, not a design preference** — if the 90-day window is unacceptable, it can be pulled into Phase 2 as a `v1` correction under sign-off.
9. **F-30 — client SDK generated from `openapi.json`**, replacing the hand-maintained `client/src/lib/*-api.ts`, so drift becomes a build error.

**Rollout.** One coordinated `v2.1`. `v1` and early-`v2` paths kept for the full window with `Deprecation`/`Sunset`; 308 redirects where the shape is otherwise identical (naming changes) and dual mounts where it is not (lifecycle, delete, reports). Sunset gated on the consumer counters, not the calendar.

**Exit criteria.** Un-versioned and `v1` prefixes carry zero traffic for 30 days; OpenAPI is the source of truth for client generation; contract suite covers every route in the manifest.

---

## 3. If only three things get done

1. **F-20** — platform secret endpoints have no capability check. Security, small fix, no consumer impact. _Phase 2._
2. **F-26 / F-27** — no list endpoint reports a total and 17 return unbounded results, so the app silently shows the first 50 rows of everything as if that were all of it. Wrong data in front of users today. The additive half (`meta`) is safe now. _Phase 2._
3. **F-1** — 18 deliberate 4xx conditions surface as 500s, including on tenant-facing support endpoints. _Phase 4, or Phase 2 for the tenant-facing subset under sign-off._

**F-6** is the cheapest genuine risk reduction available: the boot-time duplicate-`basePath` assertion is a few lines, changes no contract, and can land in Phase 1.
