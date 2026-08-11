# Praxis LS — Database Architecture & Schema Design

**Status:** Design of record for the data layer. Read alongside the PRD (Master Functional Spec v2), the OHADA/Tax Knowledge Base (governs all accounting behaviour), and the kickoff transcript (authoritative on tenancy).
**Owner:** JBS Praxis engineering.
**Scope:** how tenants are isolated, how *everything* is configured from the platform console (never by editing a tenant DB), how the accounting engine is modelled, and how AI vectorization is stored.

---

## 0. Reading guide

Where the source documents disagree, this file records the decision taken and why. Two disagreements are resolved up front:

1. **Tenancy.** PRD §5.3 says *schema-per-tenant*; the kickoff (Decision D5) and `WORK_TO_BE_DONE.md` say *one physical Postgres database per tenant*. **The kickoff decision governs** — it is later and it is load-bearing for the commercial model ("we hold the code, they hold the data"; a tenant can be sold access to their own Postgres). See §1.
2. **AI grounding.** PRD §5.8/10.1 say "no RAG / no vector store." **Per the product owner, vectorization is kept** — embeddings live per-tenant and are gated by the AI EMV toggle. Function-calling and vector recall coexist: function-calling for authoritative record fetches, vectors for semantic search/recall over the tenant's own corpus. See §7.

Naming: `snake_case` everywhere, surrogate PK `<entity>_id uuid default gen_random_uuid()`, `created_at/updated_at timestamptz default now()`, money as `numeric(18,2)`, rates as `numeric(9,4)`. Plain `pg` + parameterised SQL, no ORM (PRD §5.2). Every statutory-account and tax value is *data*, never a literal in code.

---

## 1. Tenancy model — database-per-tenant

```
                       ┌───────────────────────────┐
                       │      platform  (1 DB)      │   ← Praxis company dashboard writes here
                       │  tenant, tenant_database,  │
                       │  subdomain, plan, module_  │
                       │  catalogue, feature_*,     │
                       │  platform_user, provisioning│
                       └────────────┬──────────────┘
                                    │ connection registry (host/port/db/role/secret-ref)
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
   │ tenant_smartls   │   │ tenant_basecm    │   │ tenant_<slug>    │   ← one physical DB each
   │  live  + sandbox │   │  live  + sandbox │   │  live  + sandbox │
   └──────────────────┘   └──────────────────┘   └──────────────────┘
```

- **One platform database** holds the tenant registry and everything the **Praxis company dashboard** controls: who exists, their subdomain, which plan, which modules/features are switched on, provisioning state, billing, support tickets. **Tenants never see this DB**; platform users never see tenant business rows (PRD §5.3 [RULE]).
- **One physical Postgres database per tenant.** Strongest isolation (cross-tenant access impossible by construction), trivial per-tenant encrypted backup/restore (kickoff §10), and it is the only model that lets a tenant be handed credentials to *their own* Postgres (the ~2–3M XAF add-on, kickoff §5).
- **Live vs Sandbox** live **inside each tenant's Postgres as two schemas**: `live` and `sandbox`, identical structure. The top-bar Test/Live toggle switches `search_path`. A cron truncates+reseeds `sandbox` every 14 days (configurable). The wipe can never touch `live` (different schema, different sequences). This keeps sandbox data inside the tenant's own isolation boundary — no cross-tenant bleed (kickoff §6).
- **Request resolution:** subdomain → `platform.tenant`/`tenant_database` → a pooled connection to that tenant DB with `search_path = {live|sandbox}`. **[RULE]** No business query runs without a resolved tenant connection; platform-tier endpoints use the platform pool only.
- **Connection management** replaces today's single shared `pg.Pool`. A registry/manager keeps one small pool **per tenant DB**, opened lazily and capped; the current `app.current_business` RLS-by-column approach (Pixie Girl carryover) is removed — isolation is now the database boundary, not a row filter.

### Why not schema-per-tenant or RLS
Schema-per-tenant is simpler to operate but cannot cleanly hand a tenant their own DB (they'd be inside the shared cluster). RLS-by-column (current code) is the weakest: a single missing predicate leaks across tenants, and it makes "your data, your Postgres" impossible. DB-per-tenant costs more ops effort, which the documented scaling ladder already funds (1 box → split servers at 5–10 tenants → PgBouncer at 10+).

---

## 2. The core principle: configuration lives in data, driven from the platform console

The transcript is unambiguous (Blake, §3, §11.14): org charts, approval chains, services, milestones, allowances, chart of accounts, roles, tax rates — **none hard-coded, all per-tenant configuration**. The product owner's added constraint: **"we never come to the DB to configure for any tenant"** — all of it, including adding/removing features, is done from the **Praxis company dashboard**, which is a different application surface from the tenant's own Settings UI.

That yields a consistent shape across the whole schema:

> **A config layer (rows, editable) feeds an execution layer (append-only, invariant-guarded).**

| Concern | Config layer (data) | Execution layer |
|---|---|---|
| Access | `role`, `capability`, `scope`, `permission`, `field_visibility` | every endpoint/field resolver checks it |
| Workflow | `event_type`, `workflow`, `workflow_step` (validate→approve chains) | `approval_task` instances |
| Accounting | `chart_of_accounts`, `dictionary_item`, `posting_rule`, `tax_code` | `journal_entry`/`journal_line` |
| Operations | `service_type`, `milestone_template` | `dossier`, `milestone_instance` |
| Features | platform `feature_catalogue` + `plan_feature` + `tenant_feature_override` | `feature_state` resolved into each tenant |
| Pay | `allowance_type`, `payroll_component` | `payroll_run`/`payroll_run_item` |

### Two tiers of "who configures what"
1. **Platform (Praxis) tier — company dashboard, platform DB.** Provision a tenant, assign subdomain + database, pick plan, **switch module groups and features on/off**, set capacity/limits, mark Live. Feature/module changes are written in the platform DB and **projected into the tenant DB** as `feature_state` rows (via the provisioning/sync worker), so the tenant app reads a local, fast table and Praxis retains central control. Removing a feature flips its state to `off` (data preserved, UI + API gated) — never a `DROP`.
2. **Tenant tier — the tenant's own Settings UI, tenant DB.** The Tenant Super Admin tunes *within* what the plan enables: their org chart, roles, approval chains, COA sub-accounts, dictionary items, tax jurisdictions, milestone templates, branding. They cannot enable a feature their plan doesn't include.

**No schema migration is ever required to onboard a tenant or change their configuration.** Onboarding = create DB + run the standard migration set + seed reference data (COA, tax codes, default roles, event catalogue) + project feature state. That is the provisioning tool, not a manual DB session.

---

## 3. Platform database (what the company dashboard owns)

| Table | Purpose |
|---|---|
| `tenant` | one row per client company; slug, legal name, status (`PROVISIONING/LIVE/SUSPENDED`), plan, live flag (hides Test/Live toggle) |
| `tenant_database` | connection registry: host, port, db name, app role, **secret reference** (never the raw password), region, sandbox schema name, capacity tier |
| `subdomain` | `smartls` → tenant; supports rename + custom domains later |
| `plan` / `plan_feature` | commercial plans and which features each includes |
| `module_catalogue` | the 70 modules (MOD-xx), grouped; the master list a plan draws from |
| `feature_catalogue` | switchable capabilities (finer than modules, e.g. `ai.assistant`, `wms.cycle_count`, `fleet`); each has default state + dependencies |
| `tenant_feature_override` | per-tenant on/off that overrides the plan (the dashboard toggle) |
| `platform_user` | Praxis-side staff; role `PLATFORM_ROOT_ADMIN`; **never** granted tenant business access |
| `platform_audit` | append-only log of every provisioning / feature / suspension action (Watch-the-Watcher at platform level) |
| `provisioning_job` | async create-DB → migrate → seed → project-features pipeline, with state + logs |
| `support_ticket` | tenant→Praxis tickets/feedback, kanban `NEW→TRIAGED→IN_PROGRESS→SHIPPED/DECLINED` (PRD §11.2), feeds the roadmap |
| `tenant_smtp` / `tenant_branding` (light mirror) | onboarding-time brand + sender identity Praxis pre-loads; the authoritative copy lives in the tenant DB Settings |

Feature/module changes here are **projected** into each tenant DB's `feature_state`; the tenant app never queries the platform DB at request time.

---

## 4. Tenant database — the dynamic engine

### 4.1 Identity, entities, environments
- `corporate_entity` — multi-entity within a tenant (MOD-01): NIU/TIN, RCCM, address, logo, own books. Journals, master data and statements are entity-scoped; inter-company via class 18.
- `app_user`, `user_entity_scope` — users and which entity/branch they belong to.
- Environment is the **schema** (`live`/`sandbox`), not a column — so a sandbox wipe is a `TRUNCATE`/schema reset, and numbering sequences are physically separate.

### 4.2 RBAC as data (MOD-67; fixes "permissions modelled three ways")
- `role` (job area — configurable, not an enum), `capability` (`ISSUER/VALIDATOR/APPROVER` — the authority overlay), `scope` (entity/branch/department).
- `permission` (role × module × CRUD flags), `field_visibility` (role/capability × sensitive field → visible/masked — margins, salaries, supplier cost rates, GL).
- `user_role`, `user_capability`, `user_scope` assignments.
- **Line Manager** is a capability layered on any role, not a standalone role.
- Enforcement is server-side on every endpoint and field resolver; UI only reflects it. Any permission/role/capability/field change emits a high-priority immutable event and notifies CEO/Management (Watch-the-Watcher, PRD §5.7); in Live, a Super Admin cannot self-grant Issuer/Validator/Approver (maker-checker).

### 4.3 Universal Event System + workflow designer (MOD-67/§11.14)
- `event_type` — standardised `entity.action` (`invoice.issued`, `costing.approved`, `permission.changed`, `vehicle.insurance.expiring`, `advance.aged_unjustified`). Modules **register** their events, so new modules auto-appear in workflow/notification config.
- `workflow` + `workflow_step` — per event, per tenant: an ordered chain of validate/approve steps, each bound to a role/capability/scope and optionally an amount threshold. This is the **no-code approval-chain designer** (team A validates → team B approves → CEO by value). Add validators to lengthen the chain.
- `event_log` (append-only) → drives notifications, the compliance layer, dashboard/portal live updates, and feeds the immutable ledger.
- `approval_task` — the runtime instances awaiting a specific user ("approvals waiting on me").
- The **same event+schema layer** gates AI actions: an AI-proposed action is a candidate `event` validated against its Zod/`payload_schema` before a human confirms (PRD §10.3).

### 4.4 Feature state, numbering, settings, immutable ledger
- `feature_state` — the projection of platform feature decisions (fast local read; the tenant app gates modules/AI on this). Read-only to the tenant.
- `doc_sequence` (`module_key, year, seq`) — numbering `{PREFIX}-{MODULE}-{YYYY}-{NNNN}`, allocated only on issue/lock, gap-audited; **separate per schema** so sandbox never burns Live numbers.
- `setting` — tenant Settings (appearance/white-label, legal identity, workflow config, finance/tax config, comms/email, integrations, feature prefs), versioned; pushes to the running app with no redeploy (MOD-70).
- `immutable_ledger` — append-only `{actor, role, action, module, entity_ref, before_hash, after_hash, payload_json, ip, created_at}`. Every create/update/lock/post/reverse/delete/restore, every permission change, every God-Mode action, every AI action. 10-year retention. Read-only to the Audit Terminal. **Never hard-deleted, not even by God Mode.**

### 4.5 Deletion / immutability policy (PRD §8.5)
- Non-accounting master/operational data: **soft-delete**; restore needs a second admin (maker-checker); both logged.
- Accounting-connected data: **never deletable** — only reversed by a reason-bearing reversal that is itself posted/locked/logged.
- God Mode (CEO + PIN): purges junk non-accounting data only; **refuses ledger-connected records**; writes the full removed payload to the immutable ledger.

---

## 5. Accounting engine (KB governs; §4, §22, §23)

The three layers stay **separate** (never merge COA and Dictionary):

1. `chart_of_accounts` — statutory SYSCOHADA, hierarchical (`code`, `parent_code`, `class 1–9`, `normal_balance D/C`, `is_postable`, `requires_analytic`). Seeded per tenant/entity; core is regulated, tenants add sub-accounts. Creating a treasury sub-account (a new bank/MoMo wallet) auto-creates the matching COA sub-account (transcript §11.3f).
2. `dictionary_item` — operational, user-editable catalogue (friendly EN/FR names, category, **`is_disbursement`**, price/currency/shipping-line). What operators and AI interact with.
3. `posting_rule` — the glue: dict item → debit/credit account(s) + `tax_code` + context (`sale/purchase/disbursement`). **[RULE]** a dictionary item cannot be saved without a complete rule.
4. `tax_jurisdiction` / `tax_code` — **versioned** with `effective_from/to` (never overwrite): TVA 19.25%, WHT 2.2%/5.5%, IS 33%/min 2.2%/5.5%, CNPS, CFC, FNE, IRPP brackets, CAC. Postings use the version effective at the entry date.

Execution layer:
- `journal` (Achats/Ventes/Banque/Paie/OD), `journal_entry` (`entry_no` gap-free per journal/period, `status draft|validated`, `source SYSTEM_AUTO|SYSTEM_RULE|HUMAN_MANUAL|HUMAN_CORRECTION`, `review_status UNREVIEWED|ATTESTED|FLAGGED|CORRECTED`, `corrects_entry_id`, `source_doc_ref`, `period_id`), `journal_line` (`account_code`, exactly one of debit/credit > 0, **`dossier_id`** analytical dimension, `tax_code`, `currency`, `fx_rate`).
- `accounting_period` — freeze/lock; validated entries immutable; corrections = reversal+replacement (never edit in place).
- `regie_advance` (581 state machine `ISSUED→PARTIALLY_JUSTIFIED→JUSTIFIED`, `AGED_UNJUSTIFIED`, `QUERIED`) — aging auto-reclassifies 581→4211, never auto-allocates to 4731 (KB §6.8).
- Invoicing: `advance` (4191), `invoice`/`invoice_line` (proforma/final; `is_disbursement` per line), receivables/allocations, assets/depreciation.

**The KB §23 invariants are enforced in the DB** where possible (CHECK constraints + triggers): balanced entries (Σ Dr = Σ Cr), one side per line, postable-leaf-only, débours never in class 6/7, no VAT on débours, no compensation, advance≠revenue, gap-free `entry_no`, analytical completeness on 4731/706/707/direct-cost lines, immutability of validated entries, tax-code versioning, dictionary completeness. These are encoded as triggers so a bad write is rejected regardless of which service issues it.

---

## 6. Operations, HR, procurement, WMS, fleet, vault
Modelled as config→execution the same way: `service_type`/`service_territory` taxonomy → `dossier` (the operations file, the cost object) → `milestone_template` (versioned per service_type) → `milestone_instance` (insertable between two, auto-recalculating due dates); costing→ledger tagged `dossier_id`; procurement PR→PO→GRN three-way match; payroll `allowance_type`/component config → `payroll_run` (state machine) auto-posting the payroll journal; fleet/WMS registries with alert events; `document_vault` with content hash + QR + 10-year retention + compliance checker flags. Lighter modules are scaffolded now (own the tables) and deepened per phase.

---

## 7. AI vectorization (kept, per product owner)
- `ai_document` / `ai_chunk` (with `embedding vector(N)` via pgvector) — per-tenant semantic corpus (dossiers, docs, messages, dictionary). Lives **inside the tenant DB**, so embeddings never cross tenants.
- `ai_conversation` / `ai_message` / `ai_action_run` — assistant sessions and the Zod-gated action runs (proposed → validated → confirmed → executed), each logged to the immutable ledger.
- Governance (`ai_feature_flag`, `ai_access_grant`, `ai_vendor_credential` [encrypted keys], `ai_budget_period`, `ai_usage_ledger`, `ai_action_catalogue`): re-homed from the Pixie Girl `shared.*` schema into the tenant schema, costs in **XAF** (not NGN), gated by the two-part EMV toggle (front-end UI + back-end action) resolved from `feature_state`. Provider routing DeepSeek→Gemini, Whisper/Groq for voice. **PII/financial redaction before any external call.**
- Vectors complement function-calling: function-calling fetches the exact authoritative record with the user's permissions; vectors provide semantic recall over the tenant's own corpus. Both respect field-level confidentiality.

---

## 8. Migration & folder layout
```
migrations/
  platform/     0001_extensions … platform DB (company dashboard)
  tenant/       0001_extensions … per-tenant DB (run for every tenant, live+sandbox)
  seeds/        OHADA COA, Cameroon tax codes, default RBAC, event catalogue, module/feature catalogue
```
Migrations are versioned and idempotent; the provisioning tool runs `tenant/*` against each new tenant DB (both schemas) then applies `seeds/*`. Platform migrations run once for the cluster.

### 8.1 The ledger keys on FILENAME — so never rename an applied migration

`public.schema_migration(scope, filename)` records what has run, keyed on the
relative path (`src/services/platform/migrator.js`). Rename a migration that has
already run and the ledger stops matching: the migrator sees a new file and
applies it to a database that already has everything in it.

```
relation "error_event" already exists
index "ux_error_event_sig" already exists
trigger "trg_error_event_updated" already exists
```

This has happened — two migrations written with the same number, one renamed to
resolve the collision. **If you must rename an applied migration**, reconcile the
ledger instead of re-running it:

```bash
node scripts/db/mark-migration-applied.js --scope=platform --file=platform/0100_b.sql
node scripts/db/mark-migration-applied.js --scope=tenant  --file=tenant/0530_x.sql --all-tenants
```

It refuses unless it can prove the migration already ran — it reads the tables,
indexes, types and functions the file declares and checks the catalog. None
present means it never ran (use `migrate`); a partial match means it is
half-applied and needs a human, because a ledger row would freeze a broken schema
and call it done.

Avoid the situation entirely with `check-migration-numbers.js`, which fails the
build on a new number collision.

### 8.2 Every migration must be safe to run twice

Enforced by `scripts/db/check-migration-idempotency.js` (CI, blocking).

A migration re-runs more often than people expect: a file that fails part way
leaves its ledger row unwritten, so the **whole file** runs again after the fix;
`provision-tenant` replays the set; CI applies the tenant set twice on purpose to
test the ledger.

| Statement | Required form |
|---|---|
| `CREATE TABLE` | `CREATE TABLE IF NOT EXISTS` |
| `CREATE [UNIQUE] INDEX` | `… IF NOT EXISTS` |
| `ALTER TABLE … ADD COLUMN` | `ADD COLUMN IF NOT EXISTS` |
| `CREATE SCHEMA` / `EXTENSION` | `… IF NOT EXISTS` |
| `DROP <anything>` | `DROP … IF EXISTS` |
| `CREATE FUNCTION` / `PROCEDURE` | `CREATE OR REPLACE …` |
| `CREATE VIEW` | `CREATE OR REPLACE VIEW` |
| `CREATE TRIGGER` | `CREATE OR REPLACE TRIGGER` (PG14+; the deploy is pg16) |
| `INSERT` (seeds) | `… ON CONFLICT DO NOTHING` or `DO UPDATE SET …` |

**Two shapes have no native guard in any Postgres version** — `ADD CONSTRAINT`
and `CREATE TYPE`. They are the most common reason a migration that *looks*
idempotent is not. Wrap them:

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shipment_status') THEN
    CREATE TYPE shipment_status AS ENUM ('draft','booked','in_transit');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_qty_positive') THEN
    ALTER TABLE live.shipment ADD CONSTRAINT ck_qty_positive CHECK (qty > 0);
  END IF;
END $$;
```

The gate treats any `DO $$ … $$` block as the author's explicit guard and does
not look inside it.

### 8.3 An applied migration is IMMUTABLE — idempotency must not hide drift

The same gate freezes every migration that existed when it landed, by content
hash, and fails on any edit.

This is the other half of §8.2 and the more important one. `IF NOT EXISTS`
silently skips a table whose definition **changed** — which is precisely audit
DATA 3.3: `notification_preference` was created in two files with different
columns, both guarded, the earlier one won, and `created_at` exists on no
database despite `0472` declaring it. Nothing read the column, so nothing broke.
That is what made it dangerous.

Editing a migration that has run somewhere changes what a **fresh** database
gets and not what an **existing** one has. The two diverge silently, and the
`IF NOT EXISTS` you just added guarantees nobody finds out.

**A changed definition goes in a NEW migration. Always.**

The 127 files that predate the gate are grandfathered — retro-fitting a
migration that has already run in production is a bigger risk than the one being
fixed. `--report` lists the 49 that are not yet idempotent, so the backlog is
visible rather than forgotten:

```bash
node scripts/db/check-migration-idempotency.js --report
```
