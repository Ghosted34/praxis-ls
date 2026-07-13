# Security, Business Setup & Settings — Full Implementation Guide

A complete, reproduce-it-exactly reference for the three system modules as built in Pixie Girl Hub:

- **Business Setup** (`business_setup`) — company identity, money config, provisioning new brands
- **Settings** (`settings`) — document templates, notifications, scheduled reports, integration secrets, policies
- **Security / IAM** (`iam` + `access`) — users, sessions, audit, security events, access reviews, TOTP, RBAC roles & permission matrix

The document is split into two independent halves. **Part A — Backend** and **Part B — Frontend**. Each half is self-contained: you can hand Part A to a backend engineer and Part B to a frontend engineer and they will produce interoperable results because they share the same contract (route paths, the `{ data }` envelope, the `X-Brand-Context` header, and the module/action permission vocabulary).

> Stack assumed: **Backend** Node.js + Express + PostgreSQL (raw `pg`, no ORM) + Redis + Socket.io + Zod + argon2. **Frontend** React + TypeScript + Vite + TanStack Query v5 + Zustand + Tailwind (core utilities only) + lucide-react.

---

# PART A — BACKEND IMPLEMENTATION

## A0. Non-negotiable conventions

Every module is a folder `src/modules/<name>/` (or `src/shared/<name>/` for cross-brand concerns) with a **fixed six-file shape**:

| File | Responsibility | Hard rule |
|------|----------------|-----------|
| `<mod>.routes.js` | Express router, one line per endpoint, wires `requirePermission` + validator + controller | mounted under `/api/v1/<mod>` |
| `<mod>.controller.js` | Thin HTTP glue — reads `req`, calls the service, sends `res.json({ data })` | **no business logic**, never touches the DB |
| `<mod>.service.js` | Business logic, transactions, invariants, audit, event emission | **never touches `req`/`res`** |
| `<mod>.repo.js` | Parameterised SQL only | **never emits events, never audits** |
| `<mod>.validator.js` | Zod schemas wrapped as Express middleware | rejects unknown keys with `.strict()` |
| `<mod>.events.js` | Domain event emitter | small payloads (IDs + brand only) |

The layering rule, stated once and enforced everywhere:

```
controller → service → repo
   ↑            ↓
  req/res     audit + events + transaction
```

Controllers never call repos directly. Services never see `req`/`res`. Repos never emit events. This is what makes the modules mechanical to reproduce.

### The response envelope

Every successful response is `res.json({ data: <payload> })`. Creates return `201`. Paginated lists return `{ data: { rows, total } }` (or a `meta` sibling). The frontend fetch wrapper unwraps `data` automatically, so keep it uniform.

### Standard service context

Every mutating service function receives (or destructures) a context of `{ brand, user, request_id }`. A tiny helper on the controller builds it:

```js
const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});
```

IAM's service uses the shape `{ business, user_id, request_id }` (called `ctx`) — same idea, older naming. Pick one and be consistent; both are shown below as they exist.

---

## A1. The middleware stack (build this first)

Everything downstream depends on four middleware, applied in this exact order at the `/api/v1` mount:

```
helmet/cors/compression/request-id
  → authMiddleware            (JWT → req.user)
  → brandContextMiddleware    (X-Brand-Context → req.brand / req.brand_id)
  → requirePermission(mod,act)(→ req.permission_scope)
  → validator (Zod)
  → controller
```

### A1.1 `req.user` shape (produced by auth)

The auth middleware verifies the access-token JWT and hydrates `req.user`. The RBAC and brand middleware depend on these fields:

```
req.user = {
  user_id,                     // uuid
  is_ceo,                      // boolean — bypasses ALL permission checks
  role_ids: [uuid],            // flat role list (fallback)
  role_grants: [{ role_id, business }],  // brand-scoped grants ('*' = all)
  default_business_key,
  available_businesses: [key], // brands this user may enter
}
```

### A1.2 Brand-context middleware (`middleware/brand-context.js`)

Resolves which brand (schema) the request operates on. Order: `X-Brand-Context` header → URL `:brand` param → `user.default_business_key`.

```js
async function brandContextMiddleware(req, _res, next) {
  if (!req.user) throw new AppError("AUTH_REQUIRED", "Authentication required first", 401);

  let brand = req.headers["x-brand-context"] || req.params.brand || req.user.default_business_key;
  brand = typeof brand === "string" ? brand.toLowerCase().trim() : null;

  if (!brand || !VALID_BRANDS.has(brand))
    throw new AppError("BRAND_CONTEXT_REQUIRED", "Missing or invalid X-Brand-Context header", 400);

  // CEO has implicit access to every brand; everyone else must be granted.
  if (!req.user.is_ceo && !req.user.available_businesses.includes(brand))
    throw new AppError("BRAND_ACCESS_DENIED", `No access to ${brand}`, 403);

  const business = await identityCache.getBrandConfig(brand); // 30s TTL cache
  if (!business) throw new AppError("BRAND_NOT_FOUND", `Brand config not found for ${brand}`, 500);

  req.brand = brand;
  req.brand_id = business.business_id;
  req.brand_config = business;

  // Bind brand+user into AsyncLocalStorage so downstream transactions set the
  // Postgres session GUCs (app.current_business / app.current_user_id) that
  // RLS + audit rely on. Wrapping next() keeps the async chain inside scope.
  return requestContext.run(
    { brand, userId: req.user.user_id },
    () => next(),
  );
}
```

Key ideas to reproduce:
- **Entity isolation is enforced here**, at the application layer. Each brand is a separate Postgres schema; the resolved `req.brand` selects the schema in every repo query.
- The brand config is cached (30s) and invalidated when Business Setup edits the config.
- Cross-brand aggregate views must bypass this middleware via dedicated `/group/*` routes.

### A1.3 RBAC middleware (`middleware/rbac.js`)

Checks module × action. Scope (`own`/`team`/`all`) is *resolved* here but *enforced* inside repos (via SQL `WHERE`), because scope needs table-specific filters.

```js
const VALID_ACTIONS = new Set(["view","create","edit","delete","approve","export","publish"]);

function requirePermission(moduleKey, action) {
  if (!moduleKey) throw new Error("requirePermission: moduleKey required");
  if (!VALID_ACTIONS.has(action)) throw new Error(`invalid action "${action}"`);

  return async function rbacCheck(req, _res, next) {
    if (!req.user) throw new AppError("AUTH_REQUIRED", "Authentication required", 401);

    // CEO bypass — sees everything by design.
    if (req.user.is_ceo) { req.permission_scope = "all"; return next(); }

    // Only grants for the CURRENT brand ('*' = all brands) count.
    const roleGrants = Array.isArray(req.user.role_grants) ? req.user.role_grants : null;
    const role_ids = req.brand && roleGrants
      ? [...new Set(roleGrants
          .filter((g) => g.business === "*" || g.business === req.brand)
          .map((g) => g.role_id))]
      : req.user.role_ids;

    const grants = await identityCache.getGrants({ role_ids, module: moduleKey, action });
    if (!grants || grants.length === 0)
      throw new AppError("PERMISSION_DENIED", `No permission for ${moduleKey}.${action}`, 403);

    // Most-permissive scope wins.
    req.permission_scope = grants.some((g) => g.record_scope === "all") ? "all"
      : grants.some((g) => g.record_scope === "team") ? "team" : "own";
    return next();
  };
}

// Hard owner-only gate (no role can satisfy it) — for CEO-reserved surfaces.
function requireCeo(req, _res, next) {
  if (!req.user) throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
  if (!req.user.is_ceo) throw new AppError("PERMISSION_DENIED", "Reserved to the CEO", 403);
  return next();
}
```

Permission table layout (`shared.permissions`):

```
role_id | module | action | record_scope | allowed
```
- `module` ∈ the catalog keys (A2)
- `action` ∈ view | create | edit | delete | approve | export | publish
- `record_scope` ∈ all | own | team

Grants are cached with a 30s TTL and invalidated on any matrix edit, so changes take effect on the user's next request without a restart.

### A1.4 Audit helper (`middleware/audit.js`)

Not Express middleware — a function called *from services* where before/after snapshots are known. Writes one append-only row and **never throws** (audit failure must not break a committed action).

```js
async function audit({ business, user_id, action_key, target_type, target_id,
                       before=null, after=null, metadata=null, request_id=null,
                       ip=null, user_agent=null, is_sensitive=false,
                       user_name=null, module=null }) {
  if (!config.ENABLE_AUDIT_LOG) return;
  const mod = module || (action_key ? String(action_key).split(".")[0] : "system");
  const meta = { ...(metadata || {}) };
  if (request_id) meta.request_id = request_id;
  try {
    await query(
      `INSERT INTO shared.audit_log
         (business, user_id, user_name, module, action, table_name, record_id,
          before_state, after_state, ip_address, user_agent, is_sensitive, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [ business || "system", user_id, user_name || (user_id ? String(user_id) : "system"),
        mod, action_key, target_type, target_id,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        ip, user_agent, is_sensitive, JSON.stringify(meta) ]);
  } catch (err) { logger.error({ err, action_key, target_id }, "audit log write failed"); }
}
```

Table `shared.audit_log` is **append-only** — a DB trigger blocks UPDATE/DELETE. `action_key` is dotted (`business_setup.config.update`); its prefix becomes `module`. Mark sensitive events with `is_sensitive: true` (password resets, all RBAC mutations).

### A1.5 Real-time settings broadcast

Any settings-type write emits a Socket.io event so open browsers invalidate and refetch. Wrapped in try/catch because sockets may be down during seeding/tests:

```js
function emitSettingsUpdated(payload) {
  try {
    require("../../realtime/emitter").getBroadcaster().emit("settings:updated", payload);
  } catch { /* socket not initialised — non-fatal */ }
}
```

---

## A2. The permission catalog — RBAC single source of truth (`shared/access/access.catalog.js`)

This is the spine of the whole security model. It is the **authoritative list of module keys** and it must exactly equal the distinct `requirePermission(module, …)` keys enforced across `src/`. If they drift, the permission table accumulates dead keys or misses live ones.

Structure:

```js
const GROUPS = [ // sidebar sections; the grant grid bands columns by these
  { key: "run", label: "Run" }, { key: "workspace", label: "Workspace" },
  { key: "operate", label: "Operate" }, { key: "finance", label: "Finance" },
  { key: "people", label: "People" }, { key: "grow", label: "Grow" },
  { key: "system", label: "System" },
];

const MODULE_CATALOG = [
  { key: "dashboards", group: "run", label: "Dashboard", description: "KPIs & today's numbers" },
  // ... one row per enforced module, each with key + group + label + description
  { key: "settings", group: "system", label: "Settings", description: "Configure the hub" },
  { key: "business_setup", group: "system", label: "Business Setup", description: "Company profile, brands & payment gateways" },
  { key: "iam", group: "system", label: "IAM & Security", description: "Users, access, sessions & audit" },
  { key: "audit", group: "system", label: "Audit Log", description: "Who did what, and when" },
];

const MODULES      = MODULE_CATALOG.map((m) => m.key);
const ACTIONS      = ["view","create","edit","delete","approve","export"];
const RECORD_SCOPES= ["all","own","team"];
```

It exposes validators (`isValidModule`, `isValidAction`, `isValidScope`) and a `catalog()` function that returns the module×action grid the admin matrix UI renders:

```js
function catalog() {
  return {
    modules: MODULE_CATALOG.map((m) => ({ module: m.key, label: m.label,
      description: m.description, group: m.group, actions: ACTIONS })),
    groups: GROUPS, actions: ACTIONS, record_scopes: RECORD_SCOPES,
  };
}
```

**Governance rule to reproduce:** whenever you add a module (a new route gated on a new `requirePermission` key), add a catalog entry here AND a nav entry on the frontend with a `permission` field. When you retire one, remove it here and ship a migration purging its `shared.permissions` rows. The label shown in the grant grid is the same label the sidebar shows — one edit renames it everywhere.

---

## A3. Access escalation guards (`shared/access/access.guards.js`)

Pure functions that throw on violation. They stop a *delegated* admin (has `settings` permission but is not the owner) from escalating their own privileges. The CEO bypasses them (already bypasses everything).

```js
const OWNER_ROLE_ID = "11111111-1111-1111-1111-000000000001"; // seeded owner role

const isOwnerActor = (a) => Boolean(a && a.is_ceo);
const isOwnerRole  = (r) => r && r.role_id === OWNER_ROLE_ID;

function assertCanMutateRole(actor, role)      { if (role?.is_system && !isOwnerActor(actor)) throw new PermissionDeniedError("Only the owner can modify a system role"); }
function assertCanDeleteRole(actor, role)      { if (role?.is_system) throw new ConflictError("System roles cannot be deleted"); }
function assertCanEditPermissions(actor, role) { if (role?.is_system && !isOwnerActor(actor)) throw new PermissionDeniedError("Only the owner can edit a system role's permissions"); }
function assertCanGrantRole(actor, role)       { if (isOwnerRole(role) && !isOwnerActor(actor)) throw new PermissionDeniedError("Only the owner can grant the owner role"); }
function assertCanRevokeRole(actor, role)      { if (isOwnerRole(role) && !isOwnerActor(actor)) throw new PermissionDeniedError("Only the owner can revoke the owner role"); }
```

Rules: system roles can never be deleted; their definition/permissions change only by the owner; the owner role is granted/revoked only by the owner; and the service must never strand the system without an owner (see A6.3 revoke).

---

## A4. Business Setup module (`src/modules/business_setup/`)

Mounted at `/api/v1/business-setup`, gated on the `business_setup` permission. Owns brand identity, money config, and provisioning new brands.

### A4.1 Routes (full map)

```js
const can = (action) => requirePermission("business_setup", action);

// Businesses (provision a new brand — runs DDL; CEO-level create)
GET   /businesses                       can(view)   → listBusinesses
POST  /businesses                       can(create) → provisionBusiness

// Email signatures (one brand template, per-staff render)
GET   /email-signature-template         can(view)
PUT   /email-signature-template         can(edit)
GET   /email-signatures                 can(view)
GET   /email-signatures/:userId         can(view)
PUT   /email-signatures/:userId         can(edit)

// Brand profile (business_config)
GET   /config                           can(view)
PATCH /config                           can(edit)

// Currencies
GET   /currencies                       can(view)
POST  /currencies                       can(edit)
PATCH /currencies/:code                 can(edit)

// FX rates
GET   /fx-rates                         can(view)
GET   /fx-rates/latest                  can(view)
POST  /fx-rates                         can(edit)

// Bank accounts (masked numbers)
GET   /bank-accounts                    can(view)
POST  /bank-accounts                    can(create)
GET   /bank-accounts/:id                can(view)
PATCH /bank-accounts/:id                can(edit)

// Tax rates (effective-dated)
GET   /tax-rates                        can(view)
GET   /tax-rates/effective              can(view)   // resolver other modules call
POST  /tax-rates                        can(create)
PATCH /tax-rates/:id                    can(edit)
POST  /tax-rates/:id/supersede          can(edit)

// Document numbering (prefix editable only before first issuance)
GET   /document-numbering               can(view)
PATCH /document-numbering/:id           can(edit)

// Custom field defs
GET   /custom-fields                    can(view)
POST  /custom-fields                    can(create)
PATCH /custom-fields/:id                can(edit)

// Pipeline stage defs
GET   /pipeline-stages                  can(view)
POST  /pipeline-stages                  can(create)
PATCH /pipeline-stages/:id              can(edit)
DELETE /pipeline-stages/:id             can(delete)

// Payment gateways (CEO-managed; secrets write-only)
GET   /payment-gateways                 can(view)
POST  /payment-gateways                 can(edit)
PATCH /payment-gateways/:provider/active can(edit)
PATCH /payment-gateways/:provider/role   can(edit)
DELETE /payment-gateways/:provider       can(delete)
```

### A4.2 Shared config tables (schema `shared` unless noted)

| Table | Notes |
|-------|-------|
| `business_config` | one row per brand; profile, currencies, rates, JSONB policy blobs, branding tokens |
| `currencies` | currency catalogue (global) |
| `currency_rates` | FX with manual-override support |
| `bank_accounts` | per-brand; account number masked in API responses |
| `tax_rates` | effective-dated; `excluded_modules[]`; `tax_type` sales/purchases/payroll |
| `document_numbering` | prefix + padding; locks after first issued doc |
| `custom_field_defs` | per-entity dynamic fields |
| `pipeline_stage_defs` | crm/delivery/purchase_order/production stages |

### A4.3 Service patterns worth copying

**Every write is a transaction + audit + (sometimes) event.** Canonical shape:

```js
async function updateConfig({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const current = await repo.getConfig({ client, brand });
    if (!current) throw new NotFoundError("Business config not found");

    // Invariant: document_prefix can't change after the first doc is issued.
    if (input.document_prefix && input.document_prefix !== current.document_prefix) {
      const seqs = await repo.listNumbering({ client, brand });
      if (seqs.some((s) => s.next_number > 1))
        throw new ConflictError("document_prefix cannot change after the first document has been issued");
    }

    const updated = await repo.updateConfig({ client, brand, patch: input });
    await audit({ business: brand, user_id: user?.user_id,
      action_key: "business_setup.config.update", target_type: "business_config",
      target_id: updated.config_id, metadata: { fields: Object.keys(input) }, request_id });
    events.emit("config.updated", { brand });

    // If branding tokens changed, tell open browsers to re-fetch /public/branding.
    if (Object.keys(input).some((k) => ["accent_colour","secondary_colour","logo_path",
        "logo_alt_path","favicon_path","brand_theme","brand_fonts","display_name"].includes(k))) {
      try { require("../platform_settings/platform-settings.service")
        .emitBrandingUpdated({ scope: "business", brand }); } catch {}
    }
    return updated;
  });
}
```

**Field masking for sensitive data** (bank account numbers) — mask in the service before returning:

```js
function maskAccount(row) {
  const n = String(row.account_number || "");
  const last4 = n.slice(-4);
  const masked = n.length > 4 ? `${"•".repeat(n.length - 4)}${last4}` : n;
  return { ...row, account_number_masked: masked, account_number_last4: last4 };
}
```

**Effective-dated tax** — never edit history; `supersede` sets `effective_to`, and a resolver (`listEffectiveTaxes`) tells other modules which taxes apply now for a given module.

### A4.4 Provisioning a new brand (`business-provision.service.js`)

This is the standout: it runs DDL to spin up a whole new tenant schema in-process, gated on `business_setup:create` (CEO). Steps:

1. Validate `business_key` against a strict regex `^[a-z][a-z0-9_]{1,62}$` (identifiers can't be bound as SQL params, so the regex is the injection guard).
2. Reject if the config row or schema already exists (409).
3. `CREATE SCHEMA <key>`.
4. Insert the `shared.business_config` seed row (must exist before FK-referencing templates).
5. Apply every `migrations/template/*.template` file with `{{BUSINESS}}` substituted for the key.
6. Verify table count via `information_schema.tables`.
7. `registerBrand(key)` — add to the live in-memory brand registry so it serves traffic **without a restart**.
8. Audit `business_setup.provision`.
9. **On any failure, roll back**: `DROP SCHEMA IF EXISTS <key> CASCADE` + delete the config row, so a retry starts clean.

```js
const client = await getPool().connect();
try {
  await client.query(`CREATE SCHEMA ${key}`);               // key is regex-validated
  await client.query(`INSERT INTO shared.business_config (...) VALUES (...)`, [...]);
  for (const file of templates) {
    const sql = fs.readFileSync(path.join(TEMPLATE_DIR, file), "utf-8")
                  .replace(/{{BUSINESS}}/g, key);
    await client.query(sql);
  }
  registerBrand(key);
  await audit({ ... action_key: "business_setup.provision" ... });
} catch (err) {
  await client.query(`DROP SCHEMA IF EXISTS ${key} CASCADE`);
  await client.query(`DELETE FROM shared.business_config WHERE business_key = $1`, [key]);
  throw new AppError("PROVISION_FAILED", `Failed to provision '${key}': ${err.message}`, 500);
} finally { client.release(); }
```

### A4.5 Validators (Zod, `.strict()`)

All bodies parsed by `mw(schema)`: `req.body = schema.parse(req.body ?? {})`. Highlights:
- `configUpdate` — a large partial object; rates use `z.coerce.number().min(0).max(1)`; `instagram_handle` transforms a pasted URL/`@handle` into a bare handle; nested JSONB blobs typed `z.record(z.any())`.
- `businessProvision` — `business_key` regex as above; currencies `z.string().length(3)`.
- `taxCreate` — `tax_type` enum, `effective_from`/`effective_to` as `z.string().date()`, `excluded_modules[]`.
- `customFieldCreate` — `entity_type` and `field_type` enums.

---

## A5. Settings module (`src/modules/settings/`)

Mounted at `/api/v1/settings`, gated on `settings` — **except notification preferences, which are self-service** (any authenticated user manages their own; no `settings` permission required).

### A5.1 Routes

```js
const can = (action) => requirePermission("settings", action);

// Document templates
GET/POST/PATCH/DELETE  /document-templates[/:id]        can(view/create/edit/delete)
POST  /document-templates/:id/set-default               can(edit)

// Notification preferences (SELF-SERVICE — no can())
GET   /notification-preferences
PUT   /notification-preferences

// Scheduled reports
GET/POST/PATCH/DELETE  /scheduled-reports[/:id]         can(view/create/edit/delete)

// Integration secrets (WRITE-ONLY)
GET   /integration-secrets                              can(view)   // metadata only
PUT   /integration-secrets                              can(edit)
DELETE /integration-secrets/:id                         can(delete)

// Business policies (Settings owns content; Studio decides web placement)
GET/POST/PATCH/DELETE  /policies[/:id]                  can(view/create/edit/delete)
```

### A5.2 Two patterns that matter

**Write-only integration secrets.** The plaintext is encrypted with AES-256-GCM and *never* read back; the list endpoint returns only metadata (`provider`, `key_name`, `last4`). This is the secure alternative to writing API keys into `.env`.

```js
async function setSecret({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const secret_enc = crypto.encrypt(input.secret);      // AES-256-GCM
    const last4 = String(input.secret).slice(-4);
    const row = await repo.upsertSecret({ client, brand,
      row: { provider: input.provider, key_name: input.key_name, secret_enc, last4 },
      user_id: user?.user_id });
    await audit({ business: brand, user_id: user?.user_id,
      action_key: "settings.integration_secret.set", target_type: "integration_secret",
      target_id: row.secret_id,
      metadata: { provider: input.provider, key_name: input.key_name, sensitive: true },
      request_id });
    return row; // never includes secret_enc
  });
}
```

**Versioned policies.** On update, if `body_html` changed, bump `version = (existing.version || 1) + 1` so the renderer always reads the latest published copy and an audit reviewer can diff revisions.

Every settings write also calls `emitSettingsUpdated({ tile, brand })` (except the per-user notification prefs).

### A5.3 Validators

- `templateCreate` — `doc_type`, `name`, `status` enum draft/published/archived, HTML fields nullable, `css_vars` record.
- `notificationPref` — `channel` enum email/sms/push/in_app, `category`, `enabled`.
- `reportCreate` — `cadence` enum daily/weekly/monthly/quarterly/on_event, `recipients[]` emails, `formats[]` pdf/csv/xlsx.
- `secretSet` — `secret` bounded `min(1).max(4000)` so a paste error can't blow the cipher.
- `policyCreate` — `slug` regex `^[a-z][a-z0-9-]*$`, `body_html` up to 200k.

---

## A6. Security / IAM module (`src/shared/iam/` + `src/shared/access/`)

Two cooperating modules:
- **`iam`** (mounted `/api/v1/iam`, gated on `iam`) — users, sessions, audit queries, security events, access reviews, TOTP.
- **`access`** (mounted `/api/v1/access`, gated on `settings`) — roles, the role→permission matrix, user-role grants, per-user brand access.

### A6.1 IAM routes

```js
const can = (action) => requirePermission("iam", action);

GET  /stats                                   can(view)   // security dashboard

// Users
GET  /users                                   can(view)
GET  /users/:userId                           can(view)
POST /users/provision-staff/:profileId        can(create)
POST /users/provision-external                can(create)
POST /users/:userId/deactivate                can(edit)
POST /users/:userId/reactivate                can(edit)
POST /users/:userId/reset-password            can(edit)
POST /users/:userId/send-reset-link           can(edit)

// Sessions (admin)
GET    /sessions                              can(view)
GET    /sessions/:userId                      can(view)
DELETE /sessions/:userId/:sessionId           can(edit)
DELETE /sessions/:userId                      can(edit)

// Sessions (self-service, auth only)
GET    /my-sessions
DELETE /my-sessions/:sessionId

// Audit (literal routes BEFORE the :logId param route)
GET  /audit/export                            can(export)
GET  /audit/record/:table/:recordId           can(view)
GET  /audit                                    can(view)
GET  /audit/:logId                             can(view)

// Security events
GET  /events                                   can(view)

// Access reviews
GET   /reviews                                 can(view)
POST  /reviews                                 can(create)
GET   /reviews/:reviewId                       can(view)
PATCH /reviews/:reviewId                       can(edit)
GET   /reviews/:reviewId/export                can(export)
PATCH /reviews/:reviewId/entries/:entryId      can(edit)

// TOTP (self-service, auth only)
POST /totp/setup
POST /totp/verify
POST /totp/disable    // POST not DELETE — carries password in body for re-auth
GET  /totp/status
```

> **Route ordering gotcha:** register `/audit/export` and `/audit/record/...` *before* `/audit/:logId`, or Express matches `export` as a `:logId` UUID.

### A6.2 IAM service — patterns to reproduce

**Provisioning a login always grants at least one role, atomically.** A staff profile may have only one login (a second splits role grants across logins → "granted a role but sees nothing"). Temp password is random, argon2-hashed, returned once.

```js
async function provisionStaffLogin(ctx, profileId, input) {
  const tempPassword = crypto.randomBytes(16).toString("base64url");
  const password_hash = await argon2.hash(tempPassword, hashOptions);

  const user = await transaction(async (client) => {
    const existing = await repo.findLoginForProfile(client, profileId);
    if (existing) throw new ConflictError(`This staff profile already has a login (${existing.email})`);
    const created = await repo.provisionStaffLogin(client, profileId, {
      email: input.email, password_hash,
      default_business: input.default_business,
      permitted_businesses: input.permitted_businesses });
    if (!created) throw new NotFoundError("Staff profile");
    await grantProvisionRoles(client, { user_id: created.user_id,
      role_ids: input.role_ids, business: input.default_business, granted_by: ctx.user_id });
    return created;
  });

  await audit({ business: ctx.business, user_id: ctx.user_id, action_key: "provision_login",
    target_type: "users", target_id: user.user_id,
    after: { email: user.email, profile_type: "staff" }, request_id: ctx.request_id });
  events.emit("user_provisioned", { business: ctx.business, user_id: user.user_id });
  return { ...user, temp_password: tempPassword };
}
```

**Deactivation revokes all Redis refresh tokens** so existing sessions die immediately, and refuses to deactivate the CEO:

```js
if (existing.is_ceo) throw new AppError("CANNOT_DEACTIVATE_CEO", "Cannot deactivate the CEO account", 403);
// ... after repo.deactivateUser:
await revokeAllRedisTokens(userId);   // SCAN refresh:* and DEL those owned by userId
```

**Admin password reset** generates a temp password, hashes it, revokes Redis tokens + deletes sessions, and audits `is_sensitive: true`.

**TOTP is implemented from crypto primitives (RFC 6238), no external lib.** `setupTotp` generates 20 random bytes, base32-encodes them, encrypts for storage, and returns an `otpauth://` URI for the QR. `verifyTotp` decrypts, checks the 6-digit code over a ±1 step window, then flips `totp_enabled`. `disableTotp` requires the account password (argon2 verify) before disabling.

```js
const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email)}`
          + `?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
```

**Access reviews snapshot the world at creation.** `createAccessReview` inserts the review then snapshots every active user with their roles/permissions into `access_review_entries`. Reviewers then decide each entry (`approved`/`revoked`/`flagged`) with a note; completing the review stamps `completed_at`/`completed_by`. Everything audits.

**Audit + review export build CSV in-service** (with proper quote-escaping) and return `{ content, content_type, filename }`; the controller streams it with the right headers.

### A6.3 Access service — roles, matrix, grants (`shared/access/`)

Every mutation is audited **as sensitive** (`is_sensitive: true`) and emits an event. The escalation guards (A3) run before each mutation. The RBAC middleware reads `shared.permissions` fresh (30s cache), so matrix/grant changes take effect on the user's next request.

Routes (gated on `settings`):

```
GET  /catalog                                 // the module×action grid
GET/POST         /roles                        // list / create
GET/PATCH/DELETE /roles/:role_id
GET/PUT          /roles/:role_id/permissions   // read / replace the matrix
GET/POST         /users/:user_id/roles         // list / grant
DELETE           /users/:user_id/roles/:role_id
GET/PUT          /users/:user_id/access         // per-user brand access
```

Patterns:

- **System-wide role (`business = null`) is owner-only** to create; otherwise scoped to the current brand.
- **`setRolePermissions` validates every grant against the catalog** (unknown module/action/scope → 422; duplicate `module.action` → 422), diffs before/after, and audits the full matrix change.
- **Granting a brand-scoped role auto-extends brand access.** A role scoped to a brand the user can't enter is a silent no-op (brand-context 403s before RBAC sees it), so `grantUserRole` adds that brand to `permitted_businesses` when needed:

```js
if (input.business !== "*" && !(target.permitted_businesses || []).includes(input.business)) {
  await grantsRepo.setUserAccess({ client, user_id,
    permitted_businesses: [...(target.permitted_businesses || []), input.business],
    default_business: target.default_business || input.business });
}
```

- **Never strand the system without an owner.** Revoking the owner role checks the active holder count and refuses if it would drop to zero:

```js
if (guards.isOwnerRole(role)) {
  const holders = await grantsRepo.countActiveRoleHolders({ client, role_id });
  if (holders <= 1) throw new ConflictError("Cannot revoke the last owner");
}
```

- **`setUserAccess`** validates that every `permitted_businesses` entry is a real brand and that `default_business` is within the permitted set.

### A6.4 IAM/security tables (schema `shared`)

`users`, `user_sessions`, `roles`, `permissions`, `user_roles` (grants, with `business` + `expires_at`), `audit_log` (append-only), `access_reviews`, `access_review_entries`. TOTP secret + `totp_enabled` live on `users`.

---

## A7. Backend build order (checklist)

1. `config/database.js` (`query`, `transaction`, pool, ALS request-context + RLS GUCs), `config/redis.js`, `config/brands.js` (`VALID_BRANDS`, `BRAND_KEY_RE`, `registerBrand`).
2. `utils/errors.js` (`AppError`, `NotFoundError`, `ConflictError`, `ValidationError`, `PermissionDeniedError`), `utils/password.js` (argon2 `hashOptions`).
3. Middleware: `auth`, `brand-context`, `rbac`, `audit`, `request-id`, `error-handler`.
4. `shared/access/access.catalog.js` — the SSOT (A2). Seed `shared.roles` (owner + system roles) and `shared.permissions`.
5. `services/encryption.service.js` (AES-256-GCM `encrypt`/`decrypt`).
6. Modules in order: `business_setup` → `settings` → `iam` → `access`. Each: repo → service → controller → validator → routes → events.
7. Mount routers under `/api/v1` after the middleware chain.
8. Verify: RBAC denies without grant, brand isolation holds, audit rows are append-only, secrets never read back.

---
---

# PART B — FRONTEND IMPLEMENTATION

The frontend is a React + TypeScript SPA (Vite). It renders the three modules as pages behind an app shell, talks to the backend through one fetch wrapper, and keeps server state in TanStack Query keyed by the active brand. **Reproducing the layout accurately is the priority**, so this half is explicit about tokens, components, and per-page structure.

## B0. Design system — reproduce these tokens exactly

Two-layer theming. **Layer A** = platform skin (white-label). **Layer B** = per-brand tint. Colours are CSS variables holding *space-separated RGB channels* (so Tailwind `rgb(var(--x) / <alpha>)` works). Never inline a hex, font, or radius — always a token.

`styles/index.css` `:root` (dark default):

```css
:root {
  --bg: 15 8 9;              /* #0F0809 near-black, maroon pinch */
  --text: 244 233 217;       /* #F4E9D9 warm cream */
  --text-muted: 179 164 155;
  --text-faint: 128 112 107;

  --accent: 168 29 29;       /* #A81D1D working red (legible on black) */
  --accent-deep: 105 9 9;    /* #690909 Pixie anchor — filled buttons */
  --accent-glow: 216 92 87;

  --info: 110 134 168;
  --success: 127 160 106;
  --warn: 201 162 75;
  --danger: 229 84 78;

  --font-display: "Playfair Display", Georgia, serif;   /* headings, numerals */
  --font-body: "Montserrat", system-ui, sans-serif;     /* body */
  --font-mono: "JetBrains Mono", monospace;             /* money figures */

  --radius: 18px;
  --glass-shadow: /* layered soft shadow */;
}
```

A light theme overrides the same variables (near-white `--bg`, `--accent: 105 9 9`, `--info: 24 120 185`, etc).

Utility classes to define once and reuse everywhere:

```css
.glass    { background: <translucent panel>; backdrop-filter: blur(...); border: 1px solid rgb(var(--text)/0.08); box-shadow: var(--glass-shadow); }
.hairline { border-color: rgb(var(--text) / 0.08); }
.micro    { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: rgb(var(--text-faint)); font-weight: 700; }
```

Tailwind is configured to expose the tokens as colour utilities: `bg-accent`, `text-accent-glow`, `border-line`, `text-text-muted`, `bg-success/10`, `rounded-[var(--radius)]`, `shadow-glass`, `font-display`. **Only Tailwind core utilities** — no custom compiler.

Mandatory UI rules (the "canon"):
- **Glassmorphism** on every overlay, dropdown, drawer, menu (`.glass`).
- **Four states on every screen**: loading skeleton, empty (with CTA), error (with retry), permission-denied.
- **Permission-aware rendering** — hide controls the user lacks; the API still enforces.
- **Money** via a `MoneyText` component (NGN-based, `--font-mono`), never recompute history with a live rate.
- **Mobile-first**, then desktop.

## B1. Shared primitives (`components/ui/primitives.tsx`)

Build these first; every page composes them.

- **`Button`** — variants `primary` (filled `bg-accent-deep`, cream text `#F4E9D9`), `secondary` (neutral glass), `ghost`, `danger`; sizes `sm`/`md`. Accent used sparingly.
- **`IconButton`** — 38px square glass button with optional notification `dot`.
- **`Card`** — `glass rounded-[var(--radius)] shadow-glass`. The base container for everything.
- **`Pill`** — tone map `success | warn | danger | info | accent | neutral`, each `text-<tone> bg-<tone>/~13%`, optional leading dot.
- Form controls live in `components/ui/Form.tsx` (`Field`, `TextInput`, `SaveBar`) and `controls.tsx` (`Select`, `Toggle`, `NumberField`, `ErrorState`, `ReauthDialog`), plus `Modal.tsx`, `Drawer.tsx`, `DataTable.tsx`.

`ErrorState` is the standard error panel used across all three modules: `<ErrorState message={(q.error as Error)?.message} onRetry={() => q.refetch()} />`.

## B2. The API client (`lib/api.ts`) — the frontend/backend contract

One fetch wrapper the whole app uses. Reproduce these behaviours exactly:

- **Access token in memory only** (`let accessToken`), never localStorage (XSS can't read it). Refresh token is an httpOnly cookie sent via `credentials: "include"`.
- **`X-Brand-Context` on every authed call**, read from the persisted business store (`localStorage["pgh-business"].state.activeKey`) *without importing the store* (avoids a cycle).
- **Silent refresh-and-retry on 401**: POST `/auth/refresh` once (shared in-flight promise so concurrent 401s don't race), re-set the token, retry. On failure, clear token and fire a `pgh:session-expired` event; a root overlay then blurs the app and asks for password/PIN. A `pgh-session-locked` localStorage flag survives reloads so a locked session can't be silently revived.
- **Unwraps the `{ data }` envelope** (leaves `{ data, meta }` intact for paginated lists).

```ts
export const api = {
  get:   <T>(p, scope="v1") => request<T>(p, { method:"GET", scope }),
  post:  <T>(p, body?, scope="v1") => request<T>(p, { method:"POST", body, scope }),
  patch: <T>(p, body?, scope="v1") => request<T>(p, { method:"PATCH", body, scope }),
  put:   <T>(p, body?, scope="v1") => request<T>(p, { method:"PUT", body, scope }),
  delete:<T>(p, scope="v1") => request<T>(p, { method:"DELETE", scope }),
  getBlob, postForm, download,   // multipart upload w/ progress; authed blob download
};
```

For CSV/xlsx exports (audit log, access reviews), a plain `fetch` with the bearer header pulls the blob and triggers an `<a download>` (see `downloadAuditExport` / `downloadReviewExport`).

## B3. Active-brand store (`stores/business.ts`)

Zustand + `persist` (name `pgh-business`). Persists only the active brand **key**; the brand list + identity (logo, accents) come from the DB via `/api/public/branding`. Hooks: `useBusinesses()`, `useActiveBusiness()`, and `useBusinessStore((s) => s.activeKey)`. A `FALLBACK_BUSINESSES` array renders the switcher before the branding payload lands.

Every per-brand query key includes `activeKey`, so switching brands refetches automatically.

## B4. Data layer — typed TanStack Query hooks

Each module gets a `lib/<module>.ts` file of typed hooks. The **pattern is uniform**:

- Reads: `useQuery({ queryKey: [name, brand, ...filters], queryFn: () => api.get(path) })`.
- Writes: `useMutation({ mutationFn, onSuccess: () => qc.invalidateQueries({ queryKey: [name, brand] }) })`.
- Brand comes from `const brand = useBusinessStore((s) => s.activeKey)`.

`lib/settings.ts` (all TS interfaces + hooks) covers **both** `/business-setup/*` and `/settings/*`:

```ts
export function useBusinessConfig() {
  const brand = useBrand();
  return useQuery<BusinessConfig>({ queryKey: ["bs-config", brand],
    queryFn: () => api.get("/business-setup/config") });
}
export function useSaveBusinessConfig() {
  const qc = useQueryClient(); const brand = useBrand();
  return useMutation({ mutationFn: (patch: Partial<BusinessConfig>) =>
      api.patch("/business-setup/config", patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bs-config", brand] }) });
}
```

Provide interfaces for `BusinessConfig`, `Currency`, `FxRate`, `TaxRate`, `DocSequence`, `CustomField`, `PipelineStage`, `BankAccount` (with `account_number_masked`/`_last4`), `PaymentGateway` (`has_credentials` boolean, never the secret), `DocumentTemplate`, `NotificationPref`, `ScheduledReport`, `IntegrationSecret` (`last4` only), `EmailSignature`, `BusinessPolicy`, plus `BusinessRow`/`useProvisionBusiness`.

`lib/iam.ts` mirrors this for security: interfaces `IamUser`, `UserSession`, `SecurityStats`, `SecurityEvent`, `AuditEntry`, `AccessReview`, `AccessReviewEntry`, `TotpSetupResponse`, and filter types. Hooks include `useSecurityStats` (with `refetchInterval: 300_000`), `useIamUsers`, `useUserDetail`, `useProvisionStaff`, `useProvisionExternal`, `useDeactivateUser`/`useReactivateUser` (invalidate both `iam-users` and `iam-stats`), session hooks, `useAuditLog`, `useSecurityEvents`, review hooks, and the four TOTP hooks. Exports build query strings from filter objects.

## B5. Routing (`router.tsx`)

`createBrowserRouter`. Public pre-auth routes (`/login`, `/reset-password`, public token pages) render standalone. Everything else sits behind `<RequireAuth>` (restores the session from the refresh cookie), then inside `<AppShell>` (sidebar + top bar). Settings and IAM are eagerly imported (small); heavy modules are `lazyWithRetry` (retries a stale hashed chunk once, then forces one reload).

Route map for the three modules:

```
// Settings — landing (card grid) + one focused sub-page per tile
settings                       → SettingsHome
settings/business-setup        → BusinessSetupPage
settings/businesses            → BusinessesPage
settings/appearance            → AppearancePage      (branding — Layer A/B)
settings/login                 → LoginEditorPage
settings/currencies            → CurrenciesPage
settings/tax-rates             → TaxRatesPage
settings/payment-gateways      → PaymentGatewaysPage
settings/bank-accounts         → BankAccountsPage
settings/document-numbering    → DocumentNumberingPage
settings/custom-fields         → CustomFieldsPage
settings/pipeline-stages       → PipelineStagesPage
settings/document-templates    → DocumentTemplatesPage
settings/email-signatures      → EmailSignaturesPage
settings/notifications         → NotificationPreferencesPage
settings/scheduled-reports     → ScheduledReportsPage
settings/integration-secrets   → IntegrationSecretsPage
settings/policies              → BusinessPoliciesPage
settings/factory-languages     → FactoryLanguagePage

// Roles / permission matrix live in Org & Workflow
org-workflow                   → OrgWorkflowPage

// IAM & Security — landing + sub-pages
iam-security                   → IamSecurityPage      (dashboard)
iam-security/users             → IamUsersPage
iam-security/audit             → IamAuditPage
iam-security/events            → IamSecurityEventsPage
iam-security/sessions          → IamSessionsPage
iam-security/reviews           → IamAccessReviewsPage
iam-security/mfa               → IamMfaPage
```

Note the deliberate cross-links: Settings' "IAM & Security", "Roles & Access" and "Audit" tiles deep-link into the IAM module and Org & Workflow rather than duplicating them.

## B6. Settings landing layout (`SettingsHome.tsx`)

A **card grid grouped into sections**. Data is a static `SECTIONS` array; each `Tile` has `{ key, label, desc, icon, to, external?, soon? }`. Sections: **Identity**, **Money**, **Operations**, **Communication**, **Integrations & Security**.

Structure:

```tsx
<div className="max-w-[1280px] mx-auto">
  <header>  {/* font-display 22px title + muted 13px subtitle */}  </header>
  {SECTIONS.map((section) => (
    <section className="mb-7">
      <div className="micro mb-3">{section.title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {section.tiles.map((t) => <SettingsTile tile={t} />)}
      </div>
    </section>
  ))}
</div>
```

Each `SettingsTile` is a `Link` styled `glass rounded-[var(--radius)] shadow-glass p-4 flex items-center gap-3.5 group hover:border-accent/40`, containing: a 40px rounded icon chip (`bg-accent/10 text-accent-glow border-accent/20`; `external` tiles use `info` tones + a "module" tag), a title (`font-display 15px`) + description (`text-text-faint 12px`), and a trailing `ChevronRight` that nudges right on hover. `soon` tiles render disabled at `opacity-50`.

## B7. Business Setup page layout (`BusinessSetupPage.tsx`)

A **tabbed editor over the active brand's `business_config` row**, with a **preview-first dirty save** (only the diff is patched). Container `max-w-[860px] mx-auto pb-24`.

Structure:
1. **Header** — 44px icon chip + `font-display 22px` title + subtitle naming the active business.
2. **Tab bar** — a pill group in a `bg-text-primary/[0.04] rounded-[10px] p-1 w-fit` track; active tab `bg-accent/15 text-accent-glow`. Tabs: **Profile · Financial · Identity · Policies**.
3. **Tab body** — each tab renders `Card`s of `Field` + input controls.
4. **Sticky `SaveBar`** — appears only when `dirty`; `bottom-4 sticky`; Save/Cancel.

Dirty-tracking pattern (reproduce verbatim):

```tsx
const [draft, setDraft] = useState<BusinessConfig | null>(null);
useEffect(() => { if (cfg.data) setDraft(cfg.data); }, [cfg.data]);

const dirty = useMemo(() =>
  !!(cfg.data && draft && JSON.stringify(cfg.data) !== JSON.stringify(draft)),
  [cfg.data, draft]);

const set = (k, v) => setDraft((d) => d ? { ...d, [k]: v } : d);

const onSave = () => {               // diff-only PATCH
  const patch = {};
  Object.keys(draft).forEach((k) => {
    if (JSON.stringify(draft[k]) !== JSON.stringify(cfg.data[k])) patch[k] = draft[k];
  });
  if (Object.keys(patch).length) save.mutate(patch);
};
```

The four states are all present: loading (`Loader2` spinner + text), error (`ErrorState` with retry), and the render only proceeds once `draft` exists.

Tab contents:
- **Profile** — display/legal name, address, phone/email/website, Instagram (with a `@` prefix adornment), and three **`SensitiveField`s** (TIN, CAC, VAT) that mask by default and require a `ReauthDialog` (password re-confirm) to reveal/edit; mission statement textarea.
- **Financial** — VAT/WHT rates shown as **percent** (stored as decimals, converted on edit), fiscal-year-start `Select`, a `Toggle` for staff-recorded manual payments, and deep-links to Currencies/Gateways/Tax tiles.
- **Identity** — read-only document prefix (locked; managed in Document Numbering), deep-links to Appearance/Templates/Bank Accounts, plus **Public Identity** (storefront domain, sales subdomain), **Praxis brand voice** (tone, exclamation policy, banned words, no-fabricated-reviews toggle), and the **live viewer ticker** defaults.
- **Policies** — flat JSONB editors (`JsonScalarEditor` renders each key by primitive type: boolean→Toggle, number→NumberField, string→TextInput; nested objects read-only) for cancellation/loyalty/intercompany, plus a link out to the versioned Business Policies editor.

## B8. IAM & Security dashboard layout (`IamSecurityPage.tsx`)

A **security dashboard**: health-card grid + quick-nav tiles + recent-events feed + click-through detail modals. Container `max-w-[1000px] mx-auto space-y-6`. Data from `useSecurityStats()` (auto-refetches every 5 min).

Structure:
1. **`<ModuleInsights module="iam_security" />`** — AI insight banner (optional).
2. **Header** — `ShieldCheck` icon chip + title/subtitle.
3. **Health cards** — a `grid sm:grid-cols-2 lg:grid-cols-3 gap-3` of six `HealthCard`s: Failed Logins (24h), Inactive Accounts, Locked Accounts, Pending Invites, Users Without MFA, Active Sessions. Each is a `Card` with a **left accent border** (`border-l-[3px]`) tinted by `tone` (`success | warn | danger`), a `micro` label + icon, and a big `font-display 28px tabular-nums` value. Clicking opens a detail `Modal`.
4. **Quick-nav tiles** — same glass-tile pattern as Settings, linking to Users & Access, Audit Log, Security Events, Sessions, Access Reviews, MFA Setup.
5. **Deep-link card** to Roles & Permissions (Org & Workflow), tinted `info`.
6. **Recent security events feed** — a `Card` listing up to 10 events, each a hairline-separated row: icon chip + `user_name` + humanised action + `formatDateTime(occurred_at)` · IP.
7. **Detail modals** — one per health card; empty states read "No … in the last 24 hours" and offer a button that navigates into the filtered Users list (`/iam-security/users?status=locked`) or MFA page.

`HealthCard` skeleton:

```tsx
<Card className={cn("p-4 border-l-[3px] cursor-pointer hover:border-accent/40", toneMap[tone])}>
  <button onClick={onClick} className="w-full text-left">
    <div className="flex items-center gap-2 mb-2">
      {icon}
      <span className="text-[11px] uppercase tracking-wide font-bold text-text-muted">{label}</span>
    </div>
    <div className="font-display text-[28px] font-medium tabular-nums">
      {loading ? "..." : (value ?? 0)}
    </div>
  </button>
</Card>
```

The tone is data-driven, e.g. `tone={(s?.locked_accounts ?? 0) > 0 ? "danger" : "success"}` — the dashboard turns red only when something is actually wrong.

## B9. Sub-page conventions (Users, Audit, Sessions, Reviews, MFA)

The IAM sub-pages and the Settings sub-pages (Currencies, Tax Rates, Bank Accounts, etc.) all follow one template:

1. `useBreadcrumbs([...])` at the top for the shell breadcrumb trail.
2. A header row (icon chip + title + optional primary action `Button`).
3. The four states via the query object (`isLoading` skeleton, `isError` → `ErrorState`, empty → CTA card, else data).
4. Data rendered in a `DataTable`/`Card` list; row actions open a `Modal` or `Drawer` for create/edit.
5. Mutations invalidate the relevant query key; success toasts; permission-aware action buttons.

Specifics:
- **Users** — filterable table (search/status/profile_type); provision-staff and provision-external modals return a **one-time temp password** to copy; row actions deactivate/reactivate/reset. 
- **Audit** — filter bar (module, action, user, date range, sensitive), paginated table, before/after diff in a drawer, and CSV/xlsx export via `downloadAuditExport`.
- **Sessions** — admin list + revoke (single/all); a self "my-sessions" view.
- **Access Reviews** — list + create; a detail view iterates entries with approve/revoke/flag decisions and an export.
- **MFA** — `useTotpSetup` shows a QR from the `otpauth://` URI; `useTotpVerify` confirms the 6-digit code; `useTotpDisable` re-prompts for password.

## B10. Frontend build order (checklist)

1. `styles/index.css` tokens (B0) + Tailwind config exposing them.
2. `lib/api.ts` (B2), `stores/business.ts` (B3), `lib/cn.ts`, `lib/format.ts`.
3. `components/ui/primitives.tsx` + `Form`/`controls`/`Modal`/`Drawer`/`DataTable` (B1).
4. `AppShell` (sidebar from a `modules.ts` nav list carrying a `permission` field so it hides modules the user can't access) + `RequireAuth`.
5. `lib/settings.ts` and `lib/iam.ts` data hooks (B4).
6. `router.tsx` (B5).
7. Pages: `SettingsHome` → `BusinessSetupPage` → the Settings sub-pages → `IamSecurityPage` → the IAM sub-pages.
8. Verify each page renders all four states, respects permissions (hide controls), and includes brand in every query key.

---

## Appendix — the shared contract (both halves must agree)

| Concern | Contract |
|---|---|
| Base URL | `/api/v1` (protected), `/api/public` (unauthed) |
| Brand selection | `X-Brand-Context: <brand_key>` header on every authed call |
| Success envelope | `{ data: <payload> }`; lists `{ data: { rows, total } }` or `{ data, meta }` |
| Error envelope | `{ error: { code, message } }` with proper HTTP status |
| Auth | access token (memory) in `Authorization: Bearer`, refresh token httpOnly cookie |
| Permission vocabulary | modules from `access.catalog.js`; actions view/create/edit/delete/approve/export/publish; scopes all/own/team |
| Module paths | `/business-setup/*`, `/settings/*`, `/iam/*`, `/access/*` |
| Secrets | write-only; API returns metadata + `last4` only, never the value |
| Sensitive data | bank numbers masked server-side; RBAC mutations audited `is_sensitive: true` |
| Real-time | `settings:updated` and branding events → clients invalidate queries |
