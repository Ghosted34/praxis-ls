# Praxis LS — Code Conventions

## Module layout (MANDATORY)
Every tenant feature module lives at:
```
src/modules/<group>/<module>/
  <module>.repo.js         data access (plain pg; takes a tenant client)
  <module>.service.js      business logic (calls repo, emits events, audits)
  <module>.controller.js   thin HTTP handlers (req.tenantDb → service)
  <module>.routes.js       express.Router; exports { basePath, feature, router }
  <module>.validator.js    Zod validators
  <module>.events.js       (only if the module emits/handles domain events)
```
`<group>` is one of the 13 module groups: `dashboard, master, hr, sales,
commercial, operations, wms, fleet, costing, finance, procurement, vault,
security, ai`.

## Auto-mounting
`src/shared/http/module-loader.js` discovers every `<group>/<module>/<module>.routes.js`
and mounts it on the tenant router, gated by the module's `feature`. So adding a
module = create the folder + 5–6 files; no central wiring edit. Platform-tier
code (`src/modules/platform/*`) is mounted separately and skipped by the loader.

## The routes contract
```js
module.exports = {
  basePath: "/clients",              // path under /api/tenant
  feature: "operations",             // feature_state key gating the module (optional)
  router,                            // express.Router()
};
```

## Layer rules
- **Controller** never touches SQL. It calls `req.tenantDb((client) => service.fn(client, ...))`.
- **Service** holds the rules, calls the repo, then `emitEvent` / `audit` (from `src/shared/events/emit`).
- **Repo** is the only place with SQL; functions take `(client, ...)` so they join the request's tenant connection.
- **Validator** guards input with Zod before the controller runs.
- RBAC: gate writes with the tenant RBAC check; the AI acts with the same permissions.

## Shared kit
- `src/shared/db/query-helpers.js` — `insertOne`, `updateOne`, `getById`, `page`.
- `src/shared/events/emit.js` — `emitEvent`, `audit`.
- `src/middleware/feature-gate.js` — `requireFeature(key)`.

## Adding an AI action
Register the executor in `src/services/ai/action-registry.js` (the safety
boundary) and add the catalogue row (`ai_action_catalogue`) with its Zod/JSON
`payload_schema`. The executor calls the module **service** with the user's client.
