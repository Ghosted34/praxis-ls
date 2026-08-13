# AI-Readiness — a build rule, not a phase

The AI layer (Phase 4) is built on one promise from `doc/AI_ARCHITECTURE.md`:
**"the app is the AI's toolbox" — AI capability == app capability, with zero
drift.** That promise only holds if the metadata the AI needs is produced _as
each module and screen is built_, not retrofitted at the end. So the following
are required of every feature we ship from now on, regardless of phase.

## Rule 1 — every module ships a `<module>.ai.js` manifest

The "seventh file" in a module folder (`src/modules/<group>/<module>/`). It
declares the module's AI surface — read tools (auto-approved) and write tools
(Zod-gated, RBAC-checked, confirmation-gated). The action registrar upserts it
into `ai_action_catalogue` and builds the executor map, so adding/removing a
module updates the AI's tools automatically.

Exemplar: `src/modules/finance/journal_entry/journal_entry.ai.js`. Shape:

```js
module.exports = {
  entity: "journal_entry",
  module_key: "MOD-55",
  screens: ["dashboard"], // screen ids from the registry (below)
  reads: [{ key, service, describe }],
  writes: [
    { key, service, schema, permission: { module, action }, confirm, describe },
  ],
};
```

`permission` uses the real RBAC shape `{ module, action }` that
`middleware/rbac.js` enforces — the AI never exceeds the calling user.

## Rule 2 — every screen is declared in the UI screen registry

`client/src/app/screen-registry.json` is the canonical map the AI uses to _know
the UI_: each screen -> route -> `module_key` -> purpose -> reachable
`action_key`s. When you add a `<Route>` in `client/src/app/app.tsx`, add its
screen entry. `client/src/app/screen-registry.ts` is the typed accessor the
frontend imports (nav/breadcrumbs) — the JSON stays the single source of truth.

This is what lets the assistant navigate and guide ("where do I raise an
invoice?"), power per-module beck-and-call, and deep-link an action card to the
right screen — which raw component text cannot do.

## Rule 3 — the knowledge corpus includes the UI

`src/services/ai/knowledge/codebase.js` walks `client/src` (kind `ui`) and emits
one structured `ui-screen` card per registry entry, alongside the backend code,
schema cards, and domain docs. So the global corpus covers **DB schema +
platform + codebase + domain docs + UI**. `scripts/ai/reindex.js` rebuilds it.

## Why now

The knowledge/orchestrator services today are thin scaffolds and there are few
manifests, so the catalogue is nearly empty. That's fine for Phase 4 timing —
but the _conventions_ above cost minutes per module now and save a massive
retrofit later. Treat a module without its `.ai.js`, or a route without a screen
entry, as incomplete.

## Checklist (Definition of Done for any module/screen)

- [ ] `<module>.ai.js` present; reads/writes point at real services; writes carry
      a Zod schema + `{ module, action }` permission + `confirm`.
- [ ] Every new route has a `screen-registry.json` entry (route, module_key,
      purpose, actions).
- [ ] `node scripts/ai/reindex.js --global` picks up the new cards (idempotent).

## Rule 4 — respect the per-tenant AI toggle (EMV)

AI is a **per-tenant feature**, off by default. Three feature flags gate it
(seeded `off` in `feature_catalogue`, projected into each tenant's
`feature_state` by `provisioning.projectFeatures`, flipped per tenant via a
`tenant_feature_override`):

| Flag                   | Gates                           | Enforcement point                                                                 |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| `ai.assistant`         | the assistant **UI**            | frontend hides the assistant; AI screens set `requires_feature` (below)           |
| `ai.assistant.backend` | agentic **server actions**      | the assistant route is feature-gated (module-loader `requireFeature`) — **wired** |
| `ai.vectorization`     | semantic **recall / embedding** | ingest + `reindex` MUST skip a tenant whose flag is `off` — **not yet enforced**  |

Requirements that follow from this:

- **Runtime routes** that expose an AI surface must declare `feature: "ai.*"` in
  their route export so the module-loader gates them. (`ai/assistant` does.)
- **Ingestion must honor `ai.vectorization`.** `scripts/ai/reindex.js` and the
  event-driven re-embed handler must check the tenant's flag and **skip
  embedding** a tenant that has AI off — otherwise an AI-disabled tenant's data
  gets vectorized anyway. This is a real leak to close when ingest is built.
- **AI-dependent screens declare `requires_feature`** in the screen registry
  (e.g. an assistant panel → `"requires_feature": "ai.assistant"`), so the
  frontend and the AI's own screen map both know it only exists when AI is on.
- The orchestrator only offers actions from `ai_action_catalogue` where
  `ai_enabled = true`, and every call/write is logged to `ai_usage_ledger` /
  `immutable_ledger` — unchanged, but restated so it isn't dropped.

### Known Phase-0-era gaps (flagged, not yet fixed)

- `src/modules/ai/governance` and `src/modules/ai/insights` **fail to load** at
  boot: they `require("../../config/database")` (wrong depth — should be
  `../../../config/database`) and export a bare router instead of
  `{ basePath, feature, router }`, so the module-loader skips them. Their
  `requirePermission("ai_governance" | "ai_insights", …)` also use module keys
  that aren't in `module_catalogue`, so they'd 403 for non-CEO users. These are
  Phase-4 AI admin surfaces; fix (path + export shape + real module keys + an
  `ai.assistant` feature gate) when the AI layer is built.
