# API reference

**GENERATED — do not edit by hand.** `node scripts/generate-api-docs.js`

Closes API F-25. Derived from `doc/api-contract.json`, which `check-api-contract.js` builds by mounting the real routers — so this cannot drift from the code without CI failing. The previous artefact (a Postman collection) covered 19% of the surface and had already drifted; a hand-written spec would have done the same.

| | |
|---|---|
| Routes | 1123 |
| Modules mounted | 117 |
| API version | v1 |

## The out-of-band request contract

F-25 called this out specifically: none of it was documented anywhere, and a third-party integrator could not derive it from the routes.

| Header | Meaning |
|---|---|
| `Host` | **Selects the tenant.** `<slug>.<app-domain>` reaches that tenant's data. The platform hosts (`localhost`, `api.*`, `admin.*`, the apex) are NOT tenant hosts — a tenant-API request arriving on one now answers `400 WRONG_HOST` (F-4), where it used to answer 500. |
| `X-Praxis-Env: sandbox` | Selects the sandbox schema for BUSINESS data. Honoured only on a tenant that is not live. |
| `X-Request-Id` | Correlation id, echoed on the response and repeated in every error body. Generated if absent; ignored if longer than 64 chars. |
| `Authorization: Bearer <jwt>` | Access token (`typ: "access"`). A refresh or 2FA-pending token presented here is refused. |

**Identity always resolves against the LIVE schema**, whatever `X-Praxis-Env` says — so flipping to sandbox changes which business data you see and never logs you out.

## List, filter, sort

| Parameter | Meaning |
|---|---|
| `limit`, `offset` | Page window. `limit` is clamped to 200 and defaults to 50. |
| `q` | Free-text search, where the resource declares a search column. |
| `sort` | `?sort=created_at` ascending, `?sort=-created_at` descending. **Only columns the resource declares as sortable are accepted**; anything else is `422 INVALID_SORT` rather than silently ignored (F-29). |

Unknown filter keys are refused with `422 UNKNOWN_FILTER` on resources that declare their filterable set (F-28). They used to be dropped silently, so `?stat=OPEN` returned the UNFILTERED list and looked like it had worked.

Every list response carries the pre-`LIMIT` total in `X-Total-Count` (F-26).

## Access tiers

**Not published here yet (API F-23 remains open).** `doc/api-contract.json` records the auth/RBAC middleware attached to each individual route, but nearly every router applies authentication once with `router.use(authMiddleware)`, which does not appear on the route itself. Classifying tiers off those flags produces an answer that is badly wrong (it reports almost the entire surface as public), and a security tier table that lies is worse than none. Deriving it correctly requires resolving router-level middleware in `check-api-contract.js` so that CI and this document share one answer.

What IS true and worth stating: 61 authenticated routes carry no `requirePermission` and are self-scoped by construction (`/notifications/*`, `/workspace`, `/sessions/mine`, `/ai/*`, the seven `/{resource}/mine` endpoints, `/auth/*`), and 10 routes are unauthenticated by design — each reviewed under F-24. Until the tier is machine-derived, `doc/API_CONTRACT_AUDIT.md` §F-23/F-24 is the reference for both lists.

## Routes

All 1123 mounted routes, grouped by path prefix.

### `platform/ai-vendors`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/platform/ai-vendors` | — |
| PUT | `/api/platform/ai-vendors/:vendor` | — |
| POST | `/api/platform/ai-vendors/:vendor/test` | — |

### `platform/audit`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/platform/audit` | — |

### `platform/auth`

| Method | Path | Body validated |
|---|---|---|
| POST | `/api/platform/auth/login` | — |
| POST | `/api/platform/auth/refresh` | — |

### `platform/catalogue`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/platform/catalogue/capabilities` | — |
| GET | `/api/platform/catalogue/features` | — |
| GET | `/api/platform/catalogue/modules` | — |

### `platform/errors`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/platform/errors` | — |
| GET | `/api/platform/errors/:id` | — |
| POST | `/api/platform/errors/:id/explain` | — |
| POST | `/api/platform/errors/:id/reopen` | — |
| POST | `/api/platform/errors/:id/resolve` | — |
| GET | `/api/platform/errors/:id/share` | — |
| GET | `/api/platform/errors/export` | — |
| GET | `/api/platform/errors/modules` | — |
| GET | `/api/platform/errors/recent` | — |
| GET | `/api/platform/errors/stats` | — |
| GET | `/api/platform/errors/trends` | — |

### `platform/escalation`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/platform/escalation/log` | — |
| GET | `/api/platform/escalation/rules` | — |
| POST | `/api/platform/escalation/rules` | — |
| DELETE | `/api/platform/escalation/rules/:id` | — |
| PATCH | `/api/platform/escalation/rules/:id` | — |
| PUT | `/api/platform/escalation/rules/:id` | — |
| POST | `/api/platform/escalation/rules/preview` | — |

### `platform/health`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/platform/health/summary` | — |

### `platform/notifications`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/platform/notifications` | — |
| POST | `/api/platform/notifications` | — |
| POST | `/api/platform/notifications/:id/read` | — |
| POST | `/api/platform/notifications/read-all` | — |
| GET | `/api/platform/notifications/unread-count` | — |

### `platform/ops`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/platform/ops/backups` | — |
| POST | `/api/platform/ops/backups` | — |
| POST | `/api/platform/ops/backups/:slug` | — |
| GET | `/api/platform/ops/backups/preflight` | — |
| POST | `/api/platform/ops/backups/prune` | — |
| GET | `/api/platform/ops/backups/runs` | — |
| GET | `/api/platform/ops/backups/wal` | — |
| GET | `/api/platform/ops/drills` | — |
| POST | `/api/platform/ops/drills` | — |
| POST | `/api/platform/ops/drills/:slug` | — |
| GET | `/api/platform/ops/entitlements` | — |
| PUT | `/api/platform/ops/entitlements/:planId` | — |
| DELETE | `/api/platform/ops/entitlements/:planId/:metric` | — |
| GET | `/api/platform/ops/health` | — |
| GET | `/api/platform/ops/health/:tenantId` | — |
| POST | `/api/platform/ops/health/collect` | — |
| GET | `/api/platform/ops/maintenance` | — |
| POST | `/api/platform/ops/maintenance` | — |
| DELETE | `/api/platform/ops/maintenance/:id` | — |
| GET | `/api/platform/ops/objects` | — |
| POST | `/api/platform/ops/objects/:slug/scan` | — |
| POST | `/api/platform/ops/objects/:slug/sync` | — |
| GET | `/api/platform/ops/support/:ticketId/context` | — |
| GET | `/api/platform/ops/telemetry/:slug` | — |
| GET | `/api/platform/ops/uptime` | — |
| GET | `/api/platform/ops/uptime/incidents` | — |
| POST | `/api/platform/ops/uptime/probe` | — |
| GET | `/api/platform/ops/uptime/targets` | — |
| GET | `/api/platform/ops/usage` | — |
| GET | `/api/platform/ops/usage/:tenantId` | — |
| POST | `/api/platform/ops/usage/measure` | — |
| GET | `/api/platform/ops/usage/metrics` | — |

### `platform/plans`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/platform/plans` | — |
| POST | `/api/platform/plans` | — |
| DELETE | `/api/platform/plans/:id` | — |
| PATCH | `/api/platform/plans/:id` | — |
| GET | `/api/platform/plans/:id/features` | — |
| PUT | `/api/platform/plans/:id/features` | — |

### `platform/roles`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/platform/roles` | — |
| POST | `/api/platform/roles` | — |
| DELETE | `/api/platform/roles/:id` | — |
| PUT | `/api/platform/roles/:id/permissions` | — |

### `platform/settings`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/platform/settings` | — |
| GET | `/api/platform/settings/:section/:key` | — |
| PUT | `/api/platform/settings/:section/:key` | — |
| POST | `/api/platform/settings/:section/:key/test` | — |
| POST | `/api/platform/settings/push/vapid/generate` | — |

### `platform/support`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/platform/support/tickets` | — |
| GET | `/api/platform/support/tickets/:id` | — |
| PATCH | `/api/platform/support/tickets/:id` | — |

### `platform/tenants`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/platform/tenants` | — |
| POST | `/api/platform/tenants` | — |
| GET | `/api/platform/tenants/:slug` | — |
| POST | `/api/platform/tenants/:slug/admin` | — |
| PATCH | `/api/platform/tenants/:slug/capacity` | — |
| GET | `/api/platform/tenants/:slug/features` | — |
| DELETE | `/api/platform/tenants/:slug/features/:featureKey` | — |
| PATCH | `/api/platform/tenants/:slug/features/:featureKey` | — |
| POST | `/api/platform/tenants/:slug/go-live` | — |
| POST | `/api/platform/tenants/:slug/migrate` | — |
| PATCH | `/api/platform/tenants/:slug/plan` | — |
| POST | `/api/platform/tenants/:slug/resume` | — |
| PATCH | `/api/platform/tenants/:slug/sandbox` | — |
| POST | `/api/platform/tenants/:slug/sandbox/wipe` | — |
| POST | `/api/platform/tenants/:slug/suspend` | — |

### `platform/users`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/platform/users` | — |
| POST | `/api/platform/users` | — |
| DELETE | `/api/platform/users/:id` | — |
| PATCH | `/api/platform/users/:id` | — |
| POST | `/api/platform/users/:id/password` | — |

### `tenant/ai`

| Method | Path | Body validated |
|---|---|---|
| POST | `/api/tenant/ai/actions/:id/confirm` | — |
| POST | `/api/tenant/ai/ask` | — |
| POST | `/api/tenant/ai/ask/stream` | — |
| POST | `/api/tenant/ai/batches/:batchId/confirm` | — |
| GET | `/api/tenant/ai/conversations` | — |
| POST | `/api/tenant/ai/export/tables` | — |
| POST | `/api/tenant/ai/feedback` | — |
| GET | `/api/tenant/ai/governance/budget` | — |
| POST | `/api/tenant/ai/governance/budget` | — |
| GET | `/api/tenant/ai/governance/can-use` | — |
| GET | `/api/tenant/ai/governance/features` | — |
| PATCH | `/api/tenant/ai/governance/features/:key` | — |
| GET | `/api/tenant/ai/governance/grants` | — |
| POST | `/api/tenant/ai/governance/grants` | — |
| POST | `/api/tenant/ai/governance/grants/revoke` | — |
| GET | `/api/tenant/ai/governance/usage` | — |
| GET | `/api/tenant/ai/history` | — |
| POST | `/api/tenant/ai/history/clear` | — |
| GET | `/api/tenant/ai/options` | — |

### `tenant/appraisals`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/appraisals/` | — |
| POST | `/api/tenant/appraisals/` | — |
| DELETE | `/api/tenant/appraisals/:id` | — |
| GET | `/api/tenant/appraisals/:id` | — |
| PATCH | `/api/tenant/appraisals/:id` | — |
| POST | `/api/tenant/appraisals/:id/reward` | — |
| GET | `/api/tenant/appraisals/mine` | — |

### `tenant/approvals`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/approvals` | — |
| POST | `/api/tenant/approvals/:id/act` | — |

### `tenant/assets`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/assets/` | — |
| POST | `/api/tenant/assets/` | — |
| GET | `/api/tenant/assets/:id` | — |
| PATCH | `/api/tenant/assets/:id` | — |
| POST | `/api/tenant/assets/:id/depreciate` | — |
| POST | `/api/tenant/assets/:id/dispose` | — |

### `tenant/attendance`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/attendance/` | — |
| POST | `/api/tenant/attendance/` | — |
| DELETE | `/api/tenant/attendance/:id` | — |
| GET | `/api/tenant/attendance/:id` | — |
| PATCH | `/api/tenant/attendance/:id` | — |
| POST | `/api/tenant/attendance/:id/clock-out` | — |
| GET | `/api/tenant/attendance/absence` | — |
| POST | `/api/tenant/attendance/clock-in` | — |
| POST | `/api/tenant/attendance/clock-out` | — |
| GET | `/api/tenant/attendance/days` | — |
| POST | `/api/tenant/attendance/days/:dayId/justify` | — |
| GET | `/api/tenant/attendance/days/mine` | — |
| GET | `/api/tenant/attendance/devices` | — |
| POST | `/api/tenant/attendance/devices` | — |
| PATCH | `/api/tenant/attendance/devices/:deviceId` | — |
| GET | `/api/tenant/attendance/open` | — |
| GET | `/api/tenant/attendance/place-search` | — |
| POST | `/api/tenant/attendance/reconcile` | — |
| GET | `/api/tenant/attendance/work-sites` | — |
| POST | `/api/tenant/attendance/work-sites` | — |
| PATCH | `/api/tenant/attendance/work-sites/:siteId` | — |

### `tenant/audit`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/audit/` | — |
| GET | `/api/tenant/audit/:id` | — |
| GET | `/api/tenant/audit/events` | — |
| GET | `/api/tenant/audit/my-feed` | — |
| GET | `/api/tenant/audit/reviews` | — |
| POST | `/api/tenant/audit/reviews` | — |
| GET | `/api/tenant/audit/reviews/:id` | — |
| PATCH | `/api/tenant/audit/reviews/:id` | — |
| PATCH | `/api/tenant/audit/reviews/:id/entries/:entryId` | — |
| GET | `/api/tenant/audit/soft-deletes` | — |
| POST | `/api/tenant/audit/soft-deletes/:id/request-restore` | — |
| POST | `/api/tenant/audit/soft-deletes/:id/restore` | — |

### `tenant/auth`

| Method | Path | Body validated |
|---|---|---|
| POST | `/api/tenant/auth/2fa/disable` | — |
| POST | `/api/tenant/auth/2fa/enable` | — |
| POST | `/api/tenant/auth/2fa/setup` | — |
| POST | `/api/tenant/auth/2fa/verify` | — |
| POST | `/api/tenant/auth/avatar` | — |
| POST | `/api/tenant/auth/change-password` | — |
| POST | `/api/tenant/auth/forgot-password` | — |
| POST | `/api/tenant/auth/login` | — |
| POST | `/api/tenant/auth/logout` | — |
| GET | `/api/tenant/auth/me` | — |
| GET | `/api/tenant/auth/pin/devices` | — |
| DELETE | `/api/tenant/auth/pin/devices/:deviceId` | — |
| POST | `/api/tenant/auth/pin/login` | — |
| POST | `/api/tenant/auth/pin/register` | — |
| POST | `/api/tenant/auth/refresh` | — |
| POST | `/api/tenant/auth/reset-password` | — |

### `tenant/branding`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/branding/` | — |
| PUT | `/api/tenant/branding/` | — |
| GET | `/api/tenant/branding/login` | — |
| PUT | `/api/tenant/branding/login` | — |
| POST | `/api/tenant/branding/login/background` | — |
| POST | `/api/tenant/branding/logo` | — |
| GET | `/api/tenant/branding/pwa` | — |
| PUT | `/api/tenant/branding/pwa` | — |
| POST | `/api/tenant/branding/pwa/icon` | — |

### `tenant/campaigns`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/campaigns/` | — |
| POST | `/api/tenant/campaigns/` | — |
| GET | `/api/tenant/campaigns/:id` | — |
| PATCH | `/api/tenant/campaigns/:id` | — |
| POST | `/api/tenant/campaigns/:id/approve` | — |
| POST | `/api/tenant/campaigns/:id/reject` | — |
| POST | `/api/tenant/campaigns/:id/send` | — |
| POST | `/api/tenant/campaigns/:id/transition` | — |
| GET | `/api/tenant/campaigns/export.csv` | — |
| GET | `/api/tenant/campaigns/senders` | — |
| POST | `/api/tenant/campaigns/senders` | — |
| DELETE | `/api/tenant/campaigns/senders/:id` | — |
| POST | `/api/tenant/campaigns/senders/:id/verify` | — |
| GET | `/api/tenant/campaigns/subscribers` | — |
| POST | `/api/tenant/campaigns/subscribers` | — |
| POST | `/api/tenant/campaigns/subscribers/unsubscribe` | — |
| GET | `/api/tenant/campaigns/templates` | — |
| POST | `/api/tenant/campaigns/templates` | — |
| DELETE | `/api/tenant/campaigns/templates/:id` | — |
| GET | `/api/tenant/campaigns/templates/:id` | — |
| PATCH | `/api/tenant/campaigns/templates/:id` | — |
| GET | `/api/tenant/campaigns/tiles` | — |

### `tenant/capabilities`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/capabilities/` | — |
| POST | `/api/tenant/capabilities/` | — |
| DELETE | `/api/tenant/capabilities/:id` | — |
| GET | `/api/tenant/capabilities/:id` | — |
| PATCH | `/api/tenant/capabilities/:id` | — |
| GET | `/api/tenant/capabilities/users/:userId` | — |
| PUT | `/api/tenant/capabilities/users/:userId` | — |

### `tenant/careers`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/careers/` | — |
| GET | `/api/tenant/careers/:token` | — |
| POST | `/api/tenant/careers/:token/apply` | — |

### `tenant/cash-requests`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/cash-requests/` | — |
| POST | `/api/tenant/cash-requests/` | — |
| GET | `/api/tenant/cash-requests/:id` | — |
| PATCH | `/api/tenant/cash-requests/:id` | — |
| POST | `/api/tenant/cash-requests/:id/disburse` | — |
| POST | `/api/tenant/cash-requests/:id/justify` | — |
| POST | `/api/tenant/cash-requests/:id/transition` | — |

### `tenant/catalogue`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/catalogue/modules` | — |

### `tenant/chart-of-accounts`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/chart-of-accounts/` | — |
| POST | `/api/tenant/chart-of-accounts/` | — |
| DELETE | `/api/tenant/chart-of-accounts/:code` | — |
| GET | `/api/tenant/chart-of-accounts/:code` | — |
| PATCH | `/api/tenant/chart-of-accounts/:code` | — |

### `tenant/client-types`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/client-types/` | — |
| POST | `/api/tenant/client-types/` | — |
| DELETE | `/api/tenant/client-types/:id` | — |
| GET | `/api/tenant/client-types/:id` | — |
| PATCH | `/api/tenant/client-types/:id` | — |

### `tenant/clients`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/clients/` | — |
| POST | `/api/tenant/clients/` | — |
| GET | `/api/tenant/clients/:id` | — |
| PATCH | `/api/tenant/clients/:id` | — |
| GET | `/api/tenant/clients/:id/360` | — |
| GET | `/api/tenant/clients/:id/addresses` | — |
| POST | `/api/tenant/clients/:id/addresses` | — |
| DELETE | `/api/tenant/clients/:id/addresses/:childId` | — |
| PATCH | `/api/tenant/clients/:id/addresses/:childId` | — |
| GET | `/api/tenant/clients/:id/aging` | — |
| GET | `/api/tenant/clients/:id/banks` | — |
| POST | `/api/tenant/clients/:id/banks` | — |
| POST | `/api/tenant/clients/:id/banks/:bankId/reveal` | — |
| DELETE | `/api/tenant/clients/:id/banks/:childId` | — |
| PATCH | `/api/tenant/clients/:id/banks/:childId` | — |
| GET | `/api/tenant/clients/:id/beneficial-owners` | — |
| POST | `/api/tenant/clients/:id/beneficial-owners` | — |
| DELETE | `/api/tenant/clients/:id/beneficial-owners/:childId` | — |
| PATCH | `/api/tenant/clients/:id/beneficial-owners/:childId` | — |
| POST | `/api/tenant/clients/:id/block` | — |
| POST | `/api/tenant/clients/:id/change-requests/:crid/approve` | — |
| POST | `/api/tenant/clients/:id/change-requests/:crid/reject` | — |
| GET | `/api/tenant/clients/:id/contacts` | — |
| POST | `/api/tenant/clients/:id/contacts` | — |
| DELETE | `/api/tenant/clients/:id/contacts/:childId` | — |
| PATCH | `/api/tenant/clients/:id/contacts/:childId` | — |
| POST | `/api/tenant/clients/:id/copy-from-origin` | — |
| GET | `/api/tenant/clients/:id/credit` | — |
| GET | `/api/tenant/clients/:id/documents` | — |
| POST | `/api/tenant/clients/:id/documents` | — |
| DELETE | `/api/tenant/clients/:id/documents/:childId` | — |
| PATCH | `/api/tenant/clients/:id/documents/:childId` | — |
| POST | `/api/tenant/clients/:id/documents/:childId/verify` | — |
| POST | `/api/tenant/clients/:id/merge` | — |
| POST | `/api/tenant/clients/:id/merge-preview` | — |
| PUT | `/api/tenant/clients/:id/public-reference-consent` | — |
| GET | `/api/tenant/clients/:id/registrations` | — |
| POST | `/api/tenant/clients/:id/registrations` | — |
| DELETE | `/api/tenant/clients/:id/registrations/:childId` | — |
| PATCH | `/api/tenant/clients/:id/registrations/:childId` | — |
| POST | `/api/tenant/clients/:id/unblock` | — |
| POST | `/api/tenant/clients/:id/verify` | — |
| POST | `/api/tenant/clients/convert-from-supplier/:id` | — |
| POST | `/api/tenant/clients/dedupe-check` | — |

### `tenant/company-profile`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/company-profile/` | — |
| PUT | `/api/tenant/company-profile/` | — |
| POST | `/api/tenant/company-profile/extract` | — |
| POST | `/api/tenant/company-profile/refresh` | — |

### `tenant/compliance`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/compliance/` | — |
| POST | `/api/tenant/compliance/:id/resolve` | — |
| GET | `/api/tenant/compliance/catalogue` | — |
| POST | `/api/tenant/compliance/run` | — |

### `tenant/contracts`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/contracts/` | — |
| POST | `/api/tenant/contracts/` | — |
| DELETE | `/api/tenant/contracts/:id` | — |
| GET | `/api/tenant/contracts/:id` | — |
| PATCH | `/api/tenant/contracts/:id` | — |
| POST | `/api/tenant/contracts/:id/status` | — |
| GET | `/api/tenant/contracts/mine` | — |

### `tenant/cost-tracking`

| Method | Path | Body validated |
|---|---|---|
| POST | `/api/tenant/cost-tracking/` | — |
| GET | `/api/tenant/cost-tracking/dossier/:dossierId` | — |
| GET | `/api/tenant/cost-tracking/dossier/:dossierId/reconcile` | — |

### `tenant/costings`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/costings/` | — |
| POST | `/api/tenant/costings/` | — |
| GET | `/api/tenant/costings/:id` | — |
| PATCH | `/api/tenant/costings/:id` | — |
| POST | `/api/tenant/costings/:id/status` | — |

### `tenant/countries`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/countries/` | — |
| GET | `/api/tenant/countries/:code` | — |

### `tenant/credit-notes`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/credit-notes/` | — |
| POST | `/api/tenant/credit-notes/` | — |
| GET | `/api/tenant/credit-notes/:id` | — |
| PATCH | `/api/tenant/credit-notes/:id` | — |
| POST | `/api/tenant/credit-notes/:id/post` | — |

### `tenant/currencies`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/currencies/` | — |
| POST | `/api/tenant/currencies/` | — |
| DELETE | `/api/tenant/currencies/:code` | — |
| PATCH | `/api/tenant/currencies/:code` | — |
| GET | `/api/tenant/currencies/:code/360` | — |
| POST | `/api/tenant/currencies/base` | — |
| GET | `/api/tenant/currencies/convert` | — |
| GET | `/api/tenant/currencies/rate` | — |
| GET | `/api/tenant/currencies/rates` | — |
| POST | `/api/tenant/currencies/rates` | — |
| POST | `/api/tenant/currencies/sync` | — |

### `tenant/cycle-counts`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/cycle-counts/` | — |
| POST | `/api/tenant/cycle-counts/` | — |
| DELETE | `/api/tenant/cycle-counts/:id` | — |
| GET | `/api/tenant/cycle-counts/:id` | — |
| PATCH | `/api/tenant/cycle-counts/:id` | — |

### `tenant/dashboard`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/dashboard/` | — |
| GET | `/api/tenant/dashboard/control-tower` | — |
| GET | `/api/tenant/dashboard/kpis` | — |

### `tenant/delivery-notes`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/delivery-notes/` | — |
| POST | `/api/tenant/delivery-notes/` | — |
| GET | `/api/tenant/delivery-notes/:id` | — |

### `tenant/dispatch`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/dispatch/` | — |
| POST | `/api/tenant/dispatch/` | — |
| DELETE | `/api/tenant/dispatch/:id` | — |
| GET | `/api/tenant/dispatch/:id` | — |
| PATCH | `/api/tenant/dispatch/:id` | — |
| POST | `/api/tenant/dispatch/:id/status` | — |

### `tenant/document-templates`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/document-templates/` | — |
| POST | `/api/tenant/document-templates/:docType/:id/send` | — |
| GET | `/api/tenant/document-templates/:docType/config` | — |
| PUT | `/api/tenant/document-templates/:docType/config` | — |
| POST | `/api/tenant/document-templates/:docType/generate` | — |
| POST | `/api/tenant/document-templates/:docType/preview` | — |
| GET | `/api/tenant/document-templates/:docType/records` | — |

### `tenant/document-verification`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/document-verification/scan` | yes |
| GET | `/api/tenant/document-verification/verify` | yes |

### `tenant/documents`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/documents/` | — |
| POST | `/api/tenant/documents/` | — |
| DELETE | `/api/tenant/documents/:id` | — |
| GET | `/api/tenant/documents/:id` | — |
| GET | `/api/tenant/documents/:id/download` | — |

### `tenant/drivers`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/drivers/` | — |
| POST | `/api/tenant/drivers/` | — |
| DELETE | `/api/tenant/drivers/:id` | — |
| GET | `/api/tenant/drivers/:id` | — |
| PATCH | `/api/tenant/drivers/:id` | — |
| GET | `/api/tenant/drivers/expiring` | — |
| POST | `/api/tenant/drivers/scan` | — |

### `tenant/employees`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/employees/` | — |
| POST | `/api/tenant/employees/` | — |
| DELETE | `/api/tenant/employees/:id` | — |
| GET | `/api/tenant/employees/:id` | — |
| PATCH | `/api/tenant/employees/:id` | — |
| POST | `/api/tenant/employees/:id/active` | — |
| GET | `/api/tenant/employees/:id/managers` | — |
| GET | `/api/tenant/employees/:id/references` | — |
| GET | `/api/tenant/employees/:id/reports` | — |
| GET | `/api/tenant/employees/:id/team` | — |
| GET | `/api/tenant/employees/drivers` | — |
| GET | `/api/tenant/employees/roster` | — |

### `tenant/entities`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/entities/` | — |
| POST | `/api/tenant/entities/` | — |
| GET | `/api/tenant/entities/:id` | — |
| PATCH | `/api/tenant/entities/:id` | — |
| GET | `/api/tenant/entities/:id/360` | — |
| POST | `/api/tenant/entities/:id/active` | — |
| GET | `/api/tenant/entities/:id/addresses` | — |
| POST | `/api/tenant/entities/:id/addresses` | — |
| DELETE | `/api/tenant/entities/:id/addresses/:childId` | — |
| PATCH | `/api/tenant/entities/:id/addresses/:childId` | — |
| GET | `/api/tenant/entities/:id/cap-table` | — |
| GET | `/api/tenant/entities/:id/contacts` | — |
| POST | `/api/tenant/entities/:id/contacts` | — |
| DELETE | `/api/tenant/entities/:id/contacts/:childId` | — |
| PATCH | `/api/tenant/entities/:id/contacts/:childId` | — |
| GET | `/api/tenant/entities/:id/documents` | — |
| POST | `/api/tenant/entities/:id/documents` | — |
| DELETE | `/api/tenant/entities/:id/documents/:childId` | — |
| PATCH | `/api/tenant/entities/:id/documents/:childId` | — |
| POST | `/api/tenant/entities/:id/documents/:childId/verify` | — |
| GET | `/api/tenant/entities/:id/establishments` | — |
| POST | `/api/tenant/entities/:id/establishments` | — |
| DELETE | `/api/tenant/entities/:id/establishments/:childId` | — |
| PATCH | `/api/tenant/entities/:id/establishments/:childId` | — |
| GET | `/api/tenant/entities/:id/letterhead` | — |
| PUT | `/api/tenant/entities/:id/letterhead` | — |
| POST | `/api/tenant/entities/:id/logo` | — |
| POST | `/api/tenant/entities/:id/ops-reference-prefix` | — |
| GET | `/api/tenant/entities/:id/people` | — |
| POST | `/api/tenant/entities/:id/people` | — |
| DELETE | `/api/tenant/entities/:id/people/:childId` | — |
| PATCH | `/api/tenant/entities/:id/people/:childId` | — |
| GET | `/api/tenant/entities/:id/registrations` | — |
| POST | `/api/tenant/entities/:id/registrations` | — |
| DELETE | `/api/tenant/entities/:id/registrations/:childId` | — |
| PATCH | `/api/tenant/entities/:id/registrations/:childId` | — |
| GET | `/api/tenant/entities/:id/renewals` | — |
| POST | `/api/tenant/entities/:id/status` | — |
| POST | `/api/tenant/entities/:id/structure` | — |
| GET | `/api/tenant/entities/:id/tax-registrations` | — |
| POST | `/api/tenant/entities/:id/tax-registrations` | — |
| DELETE | `/api/tenant/entities/:id/tax-registrations/:childId` | — |
| PATCH | `/api/tenant/entities/:id/tax-registrations/:childId` | — |
| GET | `/api/tenant/entities/:id/working-calendar` | — |
| PUT | `/api/tenant/entities/:id/working-calendar` | — |
| POST | `/api/tenant/entities/:id/working-calendar/reset` | — |

### `tenant/equipment`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/equipment/` | — |
| POST | `/api/tenant/equipment/` | — |
| DELETE | `/api/tenant/equipment/:id` | — |
| GET | `/api/tenant/equipment/:id` | — |
| PATCH | `/api/tenant/equipment/:id` | — |
| POST | `/api/tenant/equipment/:id/status` | — |

### `tenant/event-types`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/event-types` | — |
| POST | `/api/tenant/event-types` | — |

### `tenant/expense-rates`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/expense-rates/` | — |
| POST | `/api/tenant/expense-rates/` | — |
| DELETE | `/api/tenant/expense-rates/:id` | — |
| GET | `/api/tenant/expense-rates/:id` | — |
| PATCH | `/api/tenant/expense-rates/:id` | — |
| GET | `/api/tenant/expense-rates/resolve` | — |

### `tenant/extra-charge-simulations`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/extra-charge-simulations/` | — |
| POST | `/api/tenant/extra-charge-simulations/` | — |
| GET | `/api/tenant/extra-charge-simulations/:id` | — |
| POST | `/api/tenant/extra-charge-simulations/preview` | — |

### `tenant/field-visibility`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/field-visibility/` | — |
| POST | `/api/tenant/field-visibility/` | — |
| DELETE | `/api/tenant/field-visibility/:id` | — |
| GET | `/api/tenant/field-visibility/:id` | — |
| PATCH | `/api/tenant/field-visibility/:id` | — |

### `tenant/final-invoices`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/final-invoices/` | — |
| POST | `/api/tenant/final-invoices/` | — |
| GET | `/api/tenant/final-invoices/:id` | — |
| PATCH | `/api/tenant/final-invoices/:id` | — |
| POST | `/api/tenant/final-invoices/:id/submit` | — |
| GET | `/api/tenant/final-invoices/:id/totals` | — |

### `tenant/financial-dictionary`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/financial-dictionary/` | — |
| POST | `/api/tenant/financial-dictionary/` | — |
| GET | `/api/tenant/financial-dictionary/:id` | — |
| PATCH | `/api/tenant/financial-dictionary/:id` | — |
| GET | `/api/tenant/financial-dictionary/:id/360` | — |
| GET | `/api/tenant/financial-dictionary/:id/rate-history` | — |
| POST | `/api/tenant/financial-dictionary/:id/rates/supersede` | — |
| GET | `/api/tenant/financial-dictionary/:id/spend` | — |
| POST | `/api/tenant/financial-dictionary/import/commit` | — |
| POST | `/api/tenant/financial-dictionary/import/errors` | — |
| GET | `/api/tenant/financial-dictionary/import/template` | — |
| POST | `/api/tenant/financial-dictionary/import/validate` | — |
| GET | `/api/tenant/financial-dictionary/refs` | — |
| POST | `/api/tenant/financial-dictionary/refs` | — |
| PATCH | `/api/tenant/financial-dictionary/refs/:id` | — |
| GET | `/api/tenant/financial-dictionary/search` | — |

### `tenant/financing`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/financing/` | — |
| POST | `/api/tenant/financing/` | — |
| DELETE | `/api/tenant/financing/:id` | — |
| GET | `/api/tenant/financing/:id` | — |
| PATCH | `/api/tenant/financing/:id` | — |
| POST | `/api/tenant/financing/:id/drawdown` | — |
| POST | `/api/tenant/financing/:id/repay` | — |

### `tenant/fuel`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/fuel/` | — |
| POST | `/api/tenant/fuel/` | — |
| DELETE | `/api/tenant/fuel/:id` | — |
| GET | `/api/tenant/fuel/:id` | — |
| PATCH | `/api/tenant/fuel/:id` | — |

### `tenant/geo-places`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/geo-places/` | — |
| POST | `/api/tenant/geo-places/` | — |
| POST | `/api/tenant/geo-places/confirm` | — |
| GET | `/api/tenant/geo-places/search` | — |

### `tenant/god-mode`

| Method | Path | Body validated |
|---|---|---|
| POST | `/api/tenant/god-mode/purge` | — |
| GET | `/api/tenant/god-mode/soft-deletes` | — |

### `tenant/goods-received`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/goods-received/` | — |
| POST | `/api/tenant/goods-received/` | — |
| GET | `/api/tenant/goods-received/:id` | — |

### `tenant/hr`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/hr/queries/` | — |
| POST | `/api/tenant/hr/queries/` | — |
| DELETE | `/api/tenant/hr/queries/:id` | — |
| GET | `/api/tenant/hr/queries/:id` | — |
| PATCH | `/api/tenant/hr/queries/:id` | — |
| POST | `/api/tenant/hr/queries/:id/respond` | — |
| GET | `/api/tenant/hr/queries/mine` | — |
| GET | `/api/tenant/hr/sanctions/` | — |
| POST | `/api/tenant/hr/sanctions/` | — |
| DELETE | `/api/tenant/hr/sanctions/:id` | — |
| GET | `/api/tenant/hr/sanctions/:id` | — |
| PATCH | `/api/tenant/hr/sanctions/:id` | — |
| POST | `/api/tenant/hr/sanctions/:id/lift` | — |
| GET | `/api/tenant/hr/sanctions/mine` | — |

### `tenant/inbound`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/inbound/` | — |
| POST | `/api/tenant/inbound/` | — |
| DELETE | `/api/tenant/inbound/:id` | — |
| GET | `/api/tenant/inbound/:id` | — |
| PATCH | `/api/tenant/inbound/:id` | — |
| POST | `/api/tenant/inbound/:id/qa` | — |

### `tenant/incidents`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/incidents/` | — |
| POST | `/api/tenant/incidents/` | — |
| DELETE | `/api/tenant/incidents/:id` | — |
| GET | `/api/tenant/incidents/:id` | — |
| PATCH | `/api/tenant/incidents/:id` | — |
| POST | `/api/tenant/incidents/:id/status` | — |

### `tenant/intake`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/intake/enquiries` | — |
| POST | `/api/tenant/intake/enquiries` | — |
| GET | `/api/tenant/intake/enquiries/:id` | — |
| PATCH | `/api/tenant/intake/enquiries/:id` | — |
| POST | `/api/tenant/intake/enquiries/:id/read` | — |
| POST | `/api/tenant/intake/enquiries/:id/respond` | — |
| POST | `/api/tenant/intake/enquiries/:id/transition` | — |
| POST | `/api/tenant/intake/enquiries/:id/triage` | — |
| GET | `/api/tenant/intake/enquiries/export.csv` | — |
| GET | `/api/tenant/intake/enquiries/tiles` | — |

### `tenant/inventory`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/inventory/` | — |
| POST | `/api/tenant/inventory/` | — |
| DELETE | `/api/tenant/inventory/:id` | — |
| GET | `/api/tenant/inventory/:id` | — |
| PATCH | `/api/tenant/inventory/:id` | — |
| POST | `/api/tenant/inventory/:id/move` | — |
| GET | `/api/tenant/inventory/:id/movements` | — |
| POST | `/api/tenant/inventory/:id/state` | — |

### `tenant/journal-entries`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/journal-entries/` | — |
| POST | `/api/tenant/journal-entries/` | — |
| GET | `/api/tenant/journal-entries/:id` | — |
| POST | `/api/tenant/journal-entries/:id/reverse` | — |

### `tenant/leads`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/leads/` | — |
| POST | `/api/tenant/leads/` | — |
| GET | `/api/tenant/leads/:id` | — |
| PATCH | `/api/tenant/leads/:id` | — |
| POST | `/api/tenant/leads/:id/convert` | — |
| POST | `/api/tenant/leads/:id/transition` | — |

### `tenant/leave`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/leave/` | — |
| POST | `/api/tenant/leave/` | — |
| DELETE | `/api/tenant/leave/:id` | — |
| GET | `/api/tenant/leave/:id` | — |
| PATCH | `/api/tenant/leave/:id` | — |
| POST | `/api/tenant/leave/:id/cancel` | — |
| POST | `/api/tenant/leave/:id/decision` | — |
| POST | `/api/tenant/leave/adjustments` | — |
| GET | `/api/tenant/leave/balances/:employeeId` | — |
| GET | `/api/tenant/leave/holidays` | — |
| POST | `/api/tenant/leave/holidays` | — |
| DELETE | `/api/tenant/leave/holidays/:id` | — |
| GET | `/api/tenant/leave/ledger/:employeeId` | — |
| GET | `/api/tenant/leave/mine` | — |
| GET | `/api/tenant/leave/mine/balances` | — |
| GET | `/api/tenant/leave/types` | — |
| POST | `/api/tenant/leave/types` | — |
| PATCH | `/api/tenant/leave/types/:id` | — |

### `tenant/locations`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/locations/` | — |
| POST | `/api/tenant/locations/` | — |
| DELETE | `/api/tenant/locations/:id` | — |
| GET | `/api/tenant/locations/:id` | — |
| PATCH | `/api/tenant/locations/:id` | — |

### `tenant/mail`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/mail/autodiscover` | — |
| GET | `/api/tenant/mail/client/:id/timeline` | — |
| GET | `/api/tenant/mail/connections` | — |
| POST | `/api/tenant/mail/connections` | — |
| PATCH | `/api/tenant/mail/connections/:id` | — |
| POST | `/api/tenant/mail/connections/:id/default` | — |
| POST | `/api/tenant/mail/connections/:id/sync` | — |
| POST | `/api/tenant/mail/connections/:id/test` | — |
| GET | `/api/tenant/mail/inbox` | — |
| GET | `/api/tenant/mail/oauth/google/callback` | — |
| GET | `/api/tenant/mail/oauth/google/start` | — |
| GET | `/api/tenant/mail/oauth/microsoft/callback` | — |
| GET | `/api/tenant/mail/oauth/microsoft/start` | — |
| GET | `/api/tenant/mail/recipients` | — |
| POST | `/api/tenant/mail/send` | — |
| GET | `/api/tenant/mail/senders` | — |
| POST | `/api/tenant/mail/senders` | — |
| PATCH | `/api/tenant/mail/senders/:id` | — |
| POST | `/api/tenant/mail/senders/:id/archive` | — |
| GET | `/api/tenant/mail/sent` | — |
| GET | `/api/tenant/mail/thread` | — |
| GET | `/api/tenant/mail/thread/:id` | — |
| GET | `/api/tenant/mail/thread/:id/attachments` | — |
| POST | `/api/tenant/mail/thread/:id/link` | — |
| POST | `/api/tenant/mail/thread/:id/read` | — |
| POST | `/api/tenant/mail/thread/:id/reply` | — |
| POST | `/api/tenant/mail/webhook/google` | — |
| POST | `/api/tenant/mail/webhook/microsoft` | — |

### `tenant/margin-simulations`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/margin-simulations/` | — |
| POST | `/api/tenant/margin-simulations/` | — |
| GET | `/api/tenant/margin-simulations/:id` | — |
| POST | `/api/tenant/margin-simulations/preview` | — |

### `tenant/master-config`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/master-config/:appliesTo` | — |
| PUT | `/api/tenant/master-config/:appliesTo` | — |

### `tenant/me`

| Method | Path | Body validated |
|---|---|---|
| DELETE | `/api/tenant/me/preferences/appearance` | — |
| GET | `/api/tenant/me/preferences/appearance` | — |
| PUT | `/api/tenant/me/preferences/appearance` | yes |
| GET | `/api/tenant/me/preferences/shell` | — |
| PUT | `/api/tenant/me/preferences/shell` | yes |

### `tenant/meetings`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/meetings/` | — |
| POST | `/api/tenant/meetings/` | — |
| GET | `/api/tenant/meetings/:id` | — |
| PATCH | `/api/tenant/meetings/:id` | — |
| GET | `/api/tenant/meetings/:id/discovery` | — |
| PUT | `/api/tenant/meetings/:id/discovery/:sectionKey` | — |
| POST | `/api/tenant/meetings/:id/discovery/:sectionKey/dictate` | — |
| POST | `/api/tenant/meetings/:id/notes` | — |
| GET | `/api/tenant/meetings/discovery/client/:clientId` | — |
| GET | `/api/tenant/meetings/discovery/lead/:leadId` | — |
| GET | `/api/tenant/meetings/discovery/prompts` | — |
| POST | `/api/tenant/meetings/discovery/prompts` | — |
| PATCH | `/api/tenant/meetings/discovery/prompts/:promptId` | — |

### `tenant/milestones`

| Method | Path | Body validated |
|---|---|---|
| POST | `/api/tenant/milestones/:id/advance` | — |
| POST | `/api/tenant/milestones/:id/reopen` | — |
| GET | `/api/tenant/milestones/assumptions/:serviceTypeId` | — |
| PUT | `/api/tenant/milestones/assumptions/:serviceTypeId` | — |
| GET | `/api/tenant/milestones/attribution` | — |
| GET | `/api/tenant/milestones/dossier/:dossierId` | — |
| POST | `/api/tenant/milestones/dossier/:dossierId/recalculate` | — |
| POST | `/api/tenant/milestones/dossier/:dossierId/stages` | — |
| POST | `/api/tenant/milestones/instantiate` | — |
| GET | `/api/tenant/milestones/system-default/:serviceTypeId` | — |
| GET | `/api/tenant/milestones/templates` | — |
| POST | `/api/tenant/milestones/templates` | — |

### `tenant/notifications`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/notifications/` | — |
| POST | `/api/tenant/notifications/:id/read` | — |
| GET | `/api/tenant/notifications/categories` | — |
| GET | `/api/tenant/notifications/preferences` | — |
| PUT | `/api/tenant/notifications/preferences` | — |
| GET | `/api/tenant/notifications/push/public-key` | — |
| DELETE | `/api/tenant/notifications/push/subscribe` | — |
| POST | `/api/tenant/notifications/push/subscribe` | — |
| POST | `/api/tenant/notifications/read-all` | — |
| GET | `/api/tenant/notifications/unread-count` | — |

### `tenant/numbering-schemes`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/numbering-schemes/:moduleKey` | — |
| PUT | `/api/tenant/numbering-schemes/:moduleKey` | — |

### `tenant/onboarding`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/onboarding/` | — |
| POST | `/api/tenant/onboarding/` | — |
| GET | `/api/tenant/onboarding/:id` | — |
| POST | `/api/tenant/onboarding/:id/complete` | — |
| POST | `/api/tenant/onboarding/:id/items` | — |
| PATCH | `/api/tenant/onboarding/items/:itemId` | — |

### `tenant/operations`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/operations/` | — |
| POST | `/api/tenant/operations/` | — |
| GET | `/api/tenant/operations/:id` | — |
| PATCH | `/api/tenant/operations/:id` | — |
| GET | `/api/tenant/operations/:id/360` | — |
| GET | `/api/tenant/operations/:id/containers` | — |
| PUT | `/api/tenant/operations/:id/containers` | — |
| GET | `/api/tenant/operations/:id/itinerary` | — |
| PUT | `/api/tenant/operations/:id/itinerary` | — |
| POST | `/api/tenant/operations/:id/marks/revert` | — |
| POST | `/api/tenant/operations/:id/promote` | — |
| GET | `/api/tenant/operations/:id/shipment-details` | — |
| POST | `/api/tenant/operations/:id/transition` | — |
| POST | `/api/tenant/operations/drafts` | — |

### `tenant/opportunities`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/opportunities/` | — |
| POST | `/api/tenant/opportunities/` | — |
| GET | `/api/tenant/opportunities/:id` | — |
| PATCH | `/api/tenant/opportunities/:id` | — |
| POST | `/api/tenant/opportunities/:id/lose` | — |
| POST | `/api/tenant/opportunities/:id/move` | — |
| POST | `/api/tenant/opportunities/:id/win` | — |
| GET | `/api/tenant/opportunities/board` | — |
| GET | `/api/tenant/opportunities/export.csv` | — |
| GET | `/api/tenant/opportunities/metrics` | — |
| GET | `/api/tenant/opportunities/stages` | — |

### `tenant/outbound`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/outbound/` | — |
| POST | `/api/tenant/outbound/` | — |
| DELETE | `/api/tenant/outbound/:id` | — |
| GET | `/api/tenant/outbound/:id` | — |
| PATCH | `/api/tenant/outbound/:id` | — |
| GET | `/api/tenant/outbound/:id/lines` | — |
| POST | `/api/tenant/outbound/:id/lines` | — |
| PATCH | `/api/tenant/outbound/:id/lines/:lineId` | — |
| POST | `/api/tenant/outbound/:id/status` | — |

### `tenant/partnership-requests`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/partnership-requests/` | — |
| POST | `/api/tenant/partnership-requests/` | — |
| GET | `/api/tenant/partnership-requests/:id` | — |
| PATCH | `/api/tenant/partnership-requests/:id` | — |
| POST | `/api/tenant/partnership-requests/:id/approve` | — |
| POST | `/api/tenant/partnership-requests/:id/profile` | — |
| POST | `/api/tenant/partnership-requests/:id/reject` | — |
| POST | `/api/tenant/partnership-requests/:id/transition` | — |
| GET | `/api/tenant/partnership-requests/export.csv` | — |
| GET | `/api/tenant/partnership-requests/tiles` | — |

### `tenant/party-document-types`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/party-document-types/` | — |
| POST | `/api/tenant/party-document-types/` | — |
| DELETE | `/api/tenant/party-document-types/:id` | — |
| GET | `/api/tenant/party-document-types/:id` | — |
| PATCH | `/api/tenant/party-document-types/:id` | — |

### `tenant/payment-gateways`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/payment-gateways/` | — |
| POST | `/api/tenant/payment-gateways/` | — |
| DELETE | `/api/tenant/payment-gateways/:provider` | — |
| GET | `/api/tenant/payment-gateways/:provider` | — |
| PATCH | `/api/tenant/payment-gateways/:provider/active` | — |
| PATCH | `/api/tenant/payment-gateways/:provider/role` | — |

### `tenant/payroll`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/payroll/` | — |
| POST | `/api/tenant/payroll/` | — |
| GET | `/api/tenant/payroll/:id` | — |
| POST | `/api/tenant/payroll/:id/compute` | — |
| POST | `/api/tenant/payroll/:id/status` | — |
| GET | `/api/tenant/payroll/mine` | — |

### `tenant/permissions`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/permissions/` | — |
| POST | `/api/tenant/permissions/` | — |
| DELETE | `/api/tenant/permissions/:id` | — |
| GET | `/api/tenant/permissions/:id` | — |
| PATCH | `/api/tenant/permissions/:id` | — |
| PUT | `/api/tenant/permissions/grant` | — |
| GET | `/api/tenant/permissions/matrix` | — |
| GET | `/api/tenant/permissions/mine` | — |

### `tenant/portal`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/portal/auditor` | — |
| POST | `/api/tenant/portal/auth/accept` | — |
| POST | `/api/tenant/portal/auth/forgot` | — |
| POST | `/api/tenant/portal/auth/login` | — |
| GET | `/api/tenant/portal/client` | — |
| GET | `/api/tenant/portal/client/dossier/:dossierId` | — |
| GET | `/api/tenant/portal/client/tickets` | — |
| POST | `/api/tenant/portal/client/tickets` | — |
| GET | `/api/tenant/portal/client/tickets/:id` | — |
| POST | `/api/tenant/portal/client/tickets/:id/replies` | — |
| GET | `/api/tenant/portal/investor` | — |
| GET | `/api/tenant/portal/me` | — |
| GET | `/api/tenant/portal/users` | — |
| POST | `/api/tenant/portal/users` | — |
| POST | `/api/tenant/portal/users/:id/password` | — |
| POST | `/api/tenant/portal/users/:id/status` | — |
| POST | `/api/tenant/portal/users/invite` | — |

### `tenant/portals`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/portals/access` | — |
| POST | `/api/tenant/portals/access` | — |
| POST | `/api/tenant/portals/access/:id/revoke` | — |
| GET | `/api/tenant/portals/access/check` | — |
| GET | `/api/tenant/portals/auditor` | — |
| GET | `/api/tenant/portals/client` | — |
| GET | `/api/tenant/portals/client/dossier/:dossierId` | — |
| GET | `/api/tenant/portals/investor` | — |

### `tenant/pricing-variance`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/pricing-variance/` | — |
| GET | `/api/tenant/pricing-variance/:id` | — |
| GET | `/api/tenant/pricing-variance/:id/finance` | — |
| POST | `/api/tenant/pricing-variance/compute` | — |

### `tenant/proformas`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/proformas/advances` | — |
| GET | `/api/tenant/proformas/advances/:id` | — |
| POST | `/api/tenant/proformas/pay` | — |

### `tenant/proposals`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/proposals/` | — |
| POST | `/api/tenant/proposals/` | — |
| GET | `/api/tenant/proposals/:id` | — |
| PATCH | `/api/tenant/proposals/:id` | — |
| POST | `/api/tenant/proposals/:id/accept` | — |
| POST | `/api/tenant/proposals/:id/generate` | — |
| POST | `/api/tenant/proposals/:id/share` | — |
| POST | `/api/tenant/proposals/:id/share/revoke` | — |
| POST | `/api/tenant/proposals/:id/transition` | — |

### `tenant/public`

| Method | Path | Body validated |
|---|---|---|
| POST | `/api/tenant/public/intake/contact-enquiries` | — |
| POST | `/api/tenant/public/intake/newsletter` | — |
| POST | `/api/tenant/public/intake/partnerships` | — |
| POST | `/api/tenant/public/intake/quote-requests` | — |
| GET | `/api/tenant/public/portfolio/` | — |
| GET | `/api/tenant/public/portfolio/:slug` | — |
| GET | `/api/tenant/public/portfolio/media/:id` | — |
| GET | `/api/tenant/public/proposals/:token` | — |
| GET | `/api/tenant/public/proposals/:token/pdf` | — |
| GET | `/api/tenant/public/tracking/:reference` | — |

### `tenant/purchase-orders`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/purchase-orders/` | — |
| POST | `/api/tenant/purchase-orders/` | — |
| GET | `/api/tenant/purchase-orders/:id` | — |
| PATCH | `/api/tenant/purchase-orders/:id` | — |
| POST | `/api/tenant/purchase-orders/:id/transition` | — |

### `tenant/purchase-requests`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/purchase-requests/` | — |
| POST | `/api/tenant/purchase-requests/` | — |
| GET | `/api/tenant/purchase-requests/:id` | — |
| POST | `/api/tenant/purchase-requests/:id/transition` | — |

### `tenant/q-tickets`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/q-tickets/` | — |
| POST | `/api/tenant/q-tickets/` | — |
| GET | `/api/tenant/q-tickets/:id` | — |
| POST | `/api/tenant/q-tickets/:id/replies` | — |
| POST | `/api/tenant/q-tickets/:id/resolve` | — |

### `tenant/quotations`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/quotations/` | — |
| POST | `/api/tenant/quotations/` | — |
| GET | `/api/tenant/quotations/:id` | — |
| PATCH | `/api/tenant/quotations/:id` | — |
| POST | `/api/tenant/quotations/:id/accept` | — |
| POST | `/api/tenant/quotations/:id/transition` | — |

### `tenant/quote-requests`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/quote-requests/` | — |
| POST | `/api/tenant/quote-requests/` | — |
| GET | `/api/tenant/quote-requests/:id` | — |
| PATCH | `/api/tenant/quote-requests/:id` | — |
| GET | `/api/tenant/quote-requests/:id/attachments` | — |
| POST | `/api/tenant/quote-requests/:id/attachments` | — |
| DELETE | `/api/tenant/quote-requests/:id/attachments/:attachmentId` | — |
| POST | `/api/tenant/quote-requests/:id/convert-to-opportunity` | — |
| POST | `/api/tenant/quote-requests/:id/transition` | — |
| GET | `/api/tenant/quote-requests/export.csv` | — |
| GET | `/api/tenant/quote-requests/tiles` | — |

### `tenant/rate-providers`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/rate-providers/` | — |
| POST | `/api/tenant/rate-providers/` | — |
| GET | `/api/tenant/rate-providers/:id` | — |
| PATCH | `/api/tenant/rate-providers/:id` | — |

### `tenant/receivables`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/receivables/` | — |
| POST | `/api/tenant/receivables/` | — |
| GET | `/api/tenant/receivables/:id` | — |
| POST | `/api/tenant/receivables/:id/post` | — |
| GET | `/api/tenant/receivables/ageing` | — |
| GET | `/api/tenant/receivables/overdue` | — |
| GET | `/api/tenant/receivables/reminders` | — |

### `tenant/regie`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/regie/` | — |
| GET | `/api/tenant/regie/:id` | — |
| POST | `/api/tenant/regie/age-due` | — |
| POST | `/api/tenant/regie/issue` | — |

### `tenant/reports`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/reports/catalogue` | — |
| GET | `/api/tenant/reports/run/:key` | — |
| GET | `/api/tenant/reports/run/:key/export` | — |
| POST | `/api/tenant/reports/run/:key/pdf` | — |
| GET | `/api/tenant/reports/saved` | — |
| POST | `/api/tenant/reports/saved` | — |
| DELETE | `/api/tenant/reports/saved/:id` | — |
| GET | `/api/tenant/reports/saved/:id/run` | — |
| GET | `/api/tenant/reports/scheduled` | — |
| POST | `/api/tenant/reports/scheduled` | — |
| DELETE | `/api/tenant/reports/scheduled/:id` | — |
| PATCH | `/api/tenant/reports/scheduled/:id` | — |
| POST | `/api/tenant/reports/scheduled/run-due` | — |
| GET | `/api/tenant/reports/tiles` | — |
| PUT | `/api/tenant/reports/tiles` | — |

### `tenant/roles`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/roles/` | — |
| POST | `/api/tenant/roles/` | — |
| DELETE | `/api/tenant/roles/:id` | — |
| GET | `/api/tenant/roles/:id` | — |
| PATCH | `/api/tenant/roles/:id` | — |

### `tenant/scopes`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/scopes/` | — |
| POST | `/api/tenant/scopes/` | — |
| DELETE | `/api/tenant/scopes/:id` | — |
| GET | `/api/tenant/scopes/:id` | — |
| PATCH | `/api/tenant/scopes/:id` | — |
| GET | `/api/tenant/scopes/:id/members` | — |
| POST | `/api/tenant/scopes/:id/members` | — |
| DELETE | `/api/tenant/scopes/:id/members/:userId` | — |
| GET | `/api/tenant/scopes/entities` | — |
| GET | `/api/tenant/scopes/options` | — |
| GET | `/api/tenant/scopes/tree` | — |

### `tenant/service-types`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/service-types/` | — |
| POST | `/api/tenant/service-types/` | — |
| DELETE | `/api/tenant/service-types/:id` | — |
| GET | `/api/tenant/service-types/:id` | — |
| PATCH | `/api/tenant/service-types/:id` | — |
| GET | `/api/tenant/service-types/:id/360` | — |
| PUT | `/api/tenant/service-types/:id/containers` | — |
| GET | `/api/tenant/service-types/:id/detail-form` | — |
| DELETE | `/api/tenant/service-types/:id/dictionary/:itemId` | — |
| PUT | `/api/tenant/service-types/:id/dictionary/:itemId` | — |
| GET | `/api/tenant/service-types/:id/field-sets` | — |
| POST | `/api/tenant/service-types/:id/field-sets` | — |
| GET | `/api/tenant/service-types/:id/field-sets/:setId` | — |
| POST | `/api/tenant/service-types/:id/field-sets/:setId/fields` | — |
| DELETE | `/api/tenant/service-types/:id/field-sets/:setId/fields/:fieldId` | — |
| PATCH | `/api/tenant/service-types/:id/field-sets/:setId/fields/:fieldId` | — |
| POST | `/api/tenant/service-types/:id/field-sets/:setId/publish` | — |

### `tenant/sessions`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/sessions/` | — |
| POST | `/api/tenant/sessions/` | — |
| DELETE | `/api/tenant/sessions/:id` | — |
| GET | `/api/tenant/sessions/:id` | — |
| PATCH | `/api/tenant/sessions/:id` | — |
| POST | `/api/tenant/sessions/:id/kill` | — |
| GET | `/api/tenant/sessions/mine` | — |
| POST | `/api/tenant/sessions/mine/revoke-all` | — |

### `tenant/settings`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/settings/` | — |
| GET | `/api/tenant/settings/:section` | — |
| DELETE | `/api/tenant/settings/:section/:key` | — |
| GET | `/api/tenant/settings/:section/:key` | — |
| PUT | `/api/tenant/settings/:section/:key` | — |
| POST | `/api/tenant/settings/integration_secret/:key/test` | — |
| GET | `/api/tenant/settings/sections` | — |

### `tenant/signatures`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/signatures/` | — |
| POST | `/api/tenant/signatures/` | — |

### `tenant/smartcomm`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/smartcomm/channels` | — |
| POST | `/api/tenant/smartcomm/channels` | — |
| GET | `/api/tenant/smartcomm/channels/:id` | — |
| POST | `/api/tenant/smartcomm/channels/:id/archive` | — |
| POST | `/api/tenant/smartcomm/channels/:id/certify` | — |
| DELETE | `/api/tenant/smartcomm/channels/:id/draft` | — |
| GET | `/api/tenant/smartcomm/channels/:id/draft` | — |
| PUT | `/api/tenant/smartcomm/channels/:id/draft` | — |
| GET | `/api/tenant/smartcomm/channels/:id/members` | — |
| POST | `/api/tenant/smartcomm/channels/:id/members` | — |
| DELETE | `/api/tenant/smartcomm/channels/:id/members/:userId` | — |
| GET | `/api/tenant/smartcomm/channels/:id/messages` | — |
| POST | `/api/tenant/smartcomm/channels/:id/messages` | — |
| POST | `/api/tenant/smartcomm/channels/:id/mute` | — |
| POST | `/api/tenant/smartcomm/channels/:id/pin` | — |
| POST | `/api/tenant/smartcomm/channels/:id/read` | — |
| GET | `/api/tenant/smartcomm/colleagues` | — |
| GET | `/api/tenant/smartcomm/config` | — |
| PUT | `/api/tenant/smartcomm/config/email` | — |
| POST | `/api/tenant/smartcomm/config/email/dns-check` | — |
| POST | `/api/tenant/smartcomm/config/email/test` | — |
| POST | `/api/tenant/smartcomm/config/email/test-send` | — |
| PUT | `/api/tenant/smartcomm/config/whatsapp` | — |
| POST | `/api/tenant/smartcomm/config/whatsapp/test` | — |
| DELETE | `/api/tenant/smartcomm/messages/:messageId` | — |
| PATCH | `/api/tenant/smartcomm/messages/:messageId` | — |
| POST | `/api/tenant/smartcomm/messages/:messageId/react` | — |
| POST | `/api/tenant/smartcomm/messages/:messageId/star` | — |
| GET | `/api/tenant/smartcomm/quick-replies` | — |
| POST | `/api/tenant/smartcomm/quick-replies` | — |
| DELETE | `/api/tenant/smartcomm/quick-replies/:id` | — |
| PATCH | `/api/tenant/smartcomm/quick-replies/:id` | — |
| GET | `/api/tenant/smartcomm/search` | — |
| GET | `/api/tenant/smartcomm/starred` | — |
| GET | `/api/tenant/smartcomm/unread` | — |

### `tenant/sops`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/sops/` | — |
| POST | `/api/tenant/sops/` | — |
| DELETE | `/api/tenant/sops/:id` | — |
| GET | `/api/tenant/sops/:id` | — |
| PATCH | `/api/tenant/sops/:id` | — |
| GET | `/api/tenant/sops/rules` | — |
| POST | `/api/tenant/sops/rules` | — |
| DELETE | `/api/tenant/sops/rules/:id` | — |
| GET | `/api/tenant/sops/rules/:id` | — |
| PATCH | `/api/tenant/sops/rules/:id` | — |

### `tenant/statements`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/statements/balance-sheet` | yes |
| GET | `/api/tenant/statements/cash-flow` | yes |
| GET | `/api/tenant/statements/grand-livre` | yes |
| GET | `/api/tenant/statements/income-statement` | yes |
| GET | `/api/tenant/statements/notes` | yes |
| GET | `/api/tenant/statements/periods` | yes |
| POST | `/api/tenant/statements/periods/close` | — |
| GET | `/api/tenant/statements/trial-balance` | yes |

### `tenant/success-stories`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/success-stories/` | — |
| POST | `/api/tenant/success-stories/` | — |
| GET | `/api/tenant/success-stories/:id` | — |
| PATCH | `/api/tenant/success-stories/:id` | — |
| POST | `/api/tenant/success-stories/:id/publish` | — |
| POST | `/api/tenant/success-stories/:id/sign-off` | — |
| POST | `/api/tenant/success-stories/:id/unpublish` | — |
| GET | `/api/tenant/success-stories/eligible-dossiers` | — |
| POST | `/api/tenant/success-stories/generate` | — |

### `tenant/succession`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/succession/` | — |
| POST | `/api/tenant/succession/` | — |
| DELETE | `/api/tenant/succession/:id` | — |
| GET | `/api/tenant/succession/:id` | — |
| PATCH | `/api/tenant/succession/:id` | — |

### `tenant/supplier-invoices`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/supplier-invoices/` | — |
| POST | `/api/tenant/supplier-invoices/` | — |
| GET | `/api/tenant/supplier-invoices/:id` | — |
| POST | `/api/tenant/supplier-invoices/:id/match` | — |
| POST | `/api/tenant/supplier-invoices/:id/post` | — |

### `tenant/supplier-types`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/supplier-types/` | — |
| POST | `/api/tenant/supplier-types/` | — |
| DELETE | `/api/tenant/supplier-types/:id` | — |
| GET | `/api/tenant/supplier-types/:id` | — |
| PATCH | `/api/tenant/supplier-types/:id` | — |

### `tenant/suppliers`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/suppliers/` | — |
| POST | `/api/tenant/suppliers/` | — |
| GET | `/api/tenant/suppliers/:id` | — |
| PATCH | `/api/tenant/suppliers/:id` | — |
| GET | `/api/tenant/suppliers/:id/360` | — |
| GET | `/api/tenant/suppliers/:id/addresses` | — |
| POST | `/api/tenant/suppliers/:id/addresses` | — |
| DELETE | `/api/tenant/suppliers/:id/addresses/:childId` | — |
| PATCH | `/api/tenant/suppliers/:id/addresses/:childId` | — |
| GET | `/api/tenant/suppliers/:id/aging` | — |
| GET | `/api/tenant/suppliers/:id/banks` | — |
| POST | `/api/tenant/suppliers/:id/banks` | — |
| POST | `/api/tenant/suppliers/:id/banks/:bankId/reveal` | — |
| DELETE | `/api/tenant/suppliers/:id/banks/:childId` | — |
| PATCH | `/api/tenant/suppliers/:id/banks/:childId` | — |
| GET | `/api/tenant/suppliers/:id/beneficial-owners` | — |
| POST | `/api/tenant/suppliers/:id/beneficial-owners` | — |
| DELETE | `/api/tenant/suppliers/:id/beneficial-owners/:childId` | — |
| PATCH | `/api/tenant/suppliers/:id/beneficial-owners/:childId` | — |
| POST | `/api/tenant/suppliers/:id/block` | — |
| POST | `/api/tenant/suppliers/:id/change-requests/:crid/approve` | — |
| POST | `/api/tenant/suppliers/:id/change-requests/:crid/reject` | — |
| GET | `/api/tenant/suppliers/:id/contacts` | — |
| POST | `/api/tenant/suppliers/:id/contacts` | — |
| DELETE | `/api/tenant/suppliers/:id/contacts/:childId` | — |
| PATCH | `/api/tenant/suppliers/:id/contacts/:childId` | — |
| POST | `/api/tenant/suppliers/:id/copy-from-origin` | — |
| GET | `/api/tenant/suppliers/:id/documents` | — |
| POST | `/api/tenant/suppliers/:id/documents` | — |
| DELETE | `/api/tenant/suppliers/:id/documents/:childId` | — |
| PATCH | `/api/tenant/suppliers/:id/documents/:childId` | — |
| POST | `/api/tenant/suppliers/:id/documents/:childId/verify` | — |
| POST | `/api/tenant/suppliers/:id/merge` | — |
| POST | `/api/tenant/suppliers/:id/merge-preview` | — |
| GET | `/api/tenant/suppliers/:id/registrations` | — |
| POST | `/api/tenant/suppliers/:id/registrations` | — |
| DELETE | `/api/tenant/suppliers/:id/registrations/:childId` | — |
| PATCH | `/api/tenant/suppliers/:id/registrations/:childId` | — |
| POST | `/api/tenant/suppliers/:id/unblock` | — |
| POST | `/api/tenant/suppliers/:id/verify` | — |
| POST | `/api/tenant/suppliers/convert-from-client/:id` | — |
| POST | `/api/tenant/suppliers/dedupe-check` | — |

### `tenant/support`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/support/tickets` | — |
| POST | `/api/tenant/support/tickets` | — |
| GET | `/api/tenant/support/tickets/:id` | — |
| POST | `/api/tenant/support/tickets/:id/csat` | — |

### `tenant/talent-pool`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/talent-pool/` | — |
| POST | `/api/tenant/talent-pool/` | — |
| DELETE | `/api/tenant/talent-pool/:id` | — |
| GET | `/api/tenant/talent-pool/:id` | — |
| PATCH | `/api/tenant/talent-pool/:id` | — |

### `tenant/tax`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/tax/cnps-declaration` | yes |
| GET | `/api/tenant/tax/corporate-tax` | yes |
| GET | `/api/tenant/tax/declarations` | — |
| POST | `/api/tenant/tax/declarations` | — |
| GET | `/api/tenant/tax/declarations/:id` | — |
| POST | `/api/tenant/tax/declarations/:id/approve` | — |
| POST | `/api/tenant/tax/declarations/:id/submit` | — |
| GET | `/api/tenant/tax/dsf-dataset` | yes |
| GET | `/api/tenant/tax/vat-return` | yes |
| GET | `/api/tenant/tax/withholding-return` | yes |

### `tenant/tax-jurisdictions`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/tax-jurisdictions/` | — |
| POST | `/api/tenant/tax-jurisdictions/` | — |
| GET | `/api/tenant/tax-jurisdictions/:id` | — |
| PATCH | `/api/tenant/tax-jurisdictions/:id` | — |
| POST | `/api/tenant/tax-jurisdictions/:id/active` | — |
| GET | `/api/tenant/tax-jurisdictions/:id/codes` | — |
| POST | `/api/tenant/tax-jurisdictions/:id/codes` | — |
| POST | `/api/tenant/tax-jurisdictions/:id/codes/supersede` | — |
| GET | `/api/tenant/tax-jurisdictions/:id/effective` | — |

### `tenant/trainings`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/trainings/` | — |
| POST | `/api/tenant/trainings/` | — |
| DELETE | `/api/tenant/trainings/:id` | — |
| GET | `/api/tenant/trainings/:id` | — |
| PATCH | `/api/tenant/trainings/:id` | — |
| GET | `/api/tenant/trainings/:id/attendees` | — |
| POST | `/api/tenant/trainings/:id/attendees` | — |
| PATCH | `/api/tenant/trainings/:id/attendees/:attendeeId` | — |
| POST | `/api/tenant/trainings/:id/status` | — |

### `tenant/transit-orders`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/transit-orders/` | — |
| POST | `/api/tenant/transit-orders/` | — |
| GET | `/api/tenant/transit-orders/:id` | — |
| PATCH | `/api/tenant/transit-orders/:id` | — |

### `tenant/treasury-accounts`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/treasury-accounts/` | — |
| POST | `/api/tenant/treasury-accounts/` | — |
| GET | `/api/tenant/treasury-accounts/:id` | — |
| PATCH | `/api/tenant/treasury-accounts/:id` | — |
| GET | `/api/tenant/treasury-accounts/:id/360` | — |
| POST | `/api/tenant/treasury-accounts/:id/active` | — |
| POST | `/api/tenant/treasury-accounts/:id/primary` | — |
| POST | `/api/tenant/treasury-accounts/:id/unverify` | — |
| POST | `/api/tenant/treasury-accounts/:id/verify` | — |

### `tenant/treasury-categories`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/treasury-categories/` | — |
| POST | `/api/tenant/treasury-categories/` | — |
| DELETE | `/api/tenant/treasury-categories/:id` | — |
| GET | `/api/tenant/treasury-categories/:id` | — |
| PATCH | `/api/tenant/treasury-categories/:id` | — |
| POST | `/api/tenant/treasury-categories/:id/active` | — |

### `tenant/users`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/users/` | — |
| POST | `/api/tenant/users/` | — |
| GET | `/api/tenant/users/:id` | — |
| PATCH | `/api/tenant/users/:id` | — |
| GET | `/api/tenant/users/:id/email-signature` | — |
| PUT | `/api/tenant/users/:id/email-signature` | — |
| POST | `/api/tenant/users/:id/password` | — |
| POST | `/api/tenant/users/:id/status` | — |
| GET | `/api/tenant/users/employees` | — |

### `tenant/vacancies`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/vacancies/` | — |
| POST | `/api/tenant/vacancies/` | — |
| DELETE | `/api/tenant/vacancies/:id` | — |
| GET | `/api/tenant/vacancies/:id` | — |
| PATCH | `/api/tenant/vacancies/:id` | — |
| GET | `/api/tenant/vacancies/:id/applicants` | — |
| POST | `/api/tenant/vacancies/:id/applicants` | — |
| PATCH | `/api/tenant/vacancies/:id/applicants/:applicantId` | — |
| GET | `/api/tenant/vacancies/:id/applicants/:applicantId/answers` | — |
| POST | `/api/tenant/vacancies/:id/applicants/:applicantId/answers` | — |
| GET | `/api/tenant/vacancies/:id/applicants/:applicantId/cv` | — |
| POST | `/api/tenant/vacancies/:id/applicants/:applicantId/score` | — |
| GET | `/api/tenant/vacancies/:id/criteria` | — |
| POST | `/api/tenant/vacancies/:id/criteria` | — |
| DELETE | `/api/tenant/vacancies/:id/criteria/:criterionId` | — |
| POST | `/api/tenant/vacancies/:id/publish` | — |
| GET | `/api/tenant/vacancies/:id/questions` | — |
| POST | `/api/tenant/vacancies/:id/questions` | — |
| DELETE | `/api/tenant/vacancies/:id/questions/:questionId` | — |
| POST | `/api/tenant/vacancies/:id/questions/generate` | — |
| POST | `/api/tenant/vacancies/:id/score-all` | — |
| POST | `/api/tenant/vacancies/:id/status` | — |
| POST | `/api/tenant/vacancies/draft` | — |
| GET | `/api/tenant/vacancies/hiring-entities` | — |
| POST | `/api/tenant/vacancies/intake/follow-ups` | — |
| GET | `/api/tenant/vacancies/intake/questions` | — |
| POST | `/api/tenant/vacancies/intake/transcribe` | — |
| GET | `/api/tenant/vacancies/place-search` | — |
| GET | `/api/tenant/vacancies/talent-pool` | — |

### `tenant/vehicle-compliance`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/vehicle-compliance/` | — |
| POST | `/api/tenant/vehicle-compliance/` | — |
| DELETE | `/api/tenant/vehicle-compliance/:id` | — |
| GET | `/api/tenant/vehicle-compliance/:id` | — |
| PATCH | `/api/tenant/vehicle-compliance/:id` | — |
| GET | `/api/tenant/vehicle-compliance/expiring` | — |
| POST | `/api/tenant/vehicle-compliance/scan` | — |

### `tenant/vehicles`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/vehicles/` | — |
| POST | `/api/tenant/vehicles/` | — |
| DELETE | `/api/tenant/vehicles/:id` | — |
| GET | `/api/tenant/vehicles/:id` | — |
| PATCH | `/api/tenant/vehicles/:id` | — |

### `tenant/work-orders`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/work-orders/` | — |
| POST | `/api/tenant/work-orders/` | — |
| DELETE | `/api/tenant/work-orders/:id` | — |
| GET | `/api/tenant/work-orders/:id` | — |
| PATCH | `/api/tenant/work-orders/:id` | — |
| GET | `/api/tenant/work-orders/:id/parts` | — |
| POST | `/api/tenant/work-orders/:id/parts` | — |
| POST | `/api/tenant/work-orders/:id/status` | — |

### `tenant/workflows`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/workflows` | — |
| POST | `/api/tenant/workflows` | — |
| GET | `/api/tenant/workflows/:id` | — |
| PATCH | `/api/tenant/workflows/:id` | — |
| GET | `/api/tenant/workflows/:id/steps` | — |
| POST | `/api/tenant/workflows/:id/steps` | — |
| DELETE | `/api/tenant/workflows/:id/steps/:stepId` | — |

### `tenant/workspace`

| Method | Path | Body validated |
|---|---|---|
| GET | `/api/tenant/workspace/` | — |

