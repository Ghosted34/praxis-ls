# The KPI Band — Engineering Guide

**Status: design record. No code has been changed on account of this document; it is
the spec the implementation PRs follow.**

Companion to [CONTROL_TOWER.md](CONTROL_TOWER.md), which explains everything above
and below the band. This document covers only the headline metric strip — the four
cards between the map and the Applications block — and turns it into a
permission-bound, role-defaulted, user-picked band chosen from a full catalog.

Questionnaire answered 2026-09-14; the ten decisions in §3 are that record.

---

## 1. What is wrong today

The band is four hardcoded cards (`kpi-strip.tsx → kpiCards()`) fed by a fixed key
set (`dashboard.repo.js → kpis()`), and it has three independent defects that all
show up as the same symptom: **LIVE and TEST disagree about what your dashboard
even is.**

1. **No choice.** A CEO, a fleet supervisor and a payroll clerk get the same four
   cards. Nobody asked them.
2. **No permission story.** "On which of the 22 numbers in this product am I
   allowed to look" is decided by a hardcoded array, not by the RBAC rows the
   product is built on.
3. **An inconsistent zero policy.** The hide rule is half-applied. SLA and fleet
   hide when unmeasurable (`NULLIF` in the repo, `fleetTotal > 0` in the client —
   correct: "0 vehicles" is a different statement from "you have no fleet").
   Revenue and receivables do the opposite: `COALESCE(SUM(total_ttc), 0)` renders
   "0.0 M XAF" on a tenant with zero invoices. One card asserts a truth; its
   neighbour asserts a guess.

### 1.1 The LIVE-vs-TEST puzzle, recorded

This is the investigation that motivated the questionnaire; keep it here so the
next reader does not re-derive it.

- **TEST is a schema switch, not a data switch.** `tenant-context.js` routes
  business queries to the `sandbox` schema when `X-Praxis-Env: sandbox` is set and
  the tenant is not live-locked. Identity, sessions and **preferences** are
  env-independent by design ("same you, sandbox data").
- The sandbox schema is seeded with demo operations: vehicles, dossiers with
  ETA+ATA, locked invoices, compliance flags. So all four KPI queries return
  non-null and four cards render.
- A young LIVE tenant has no vehicles (`fleet_total = 0` → card hidden), no
  delivered dossier with both dates (`sla_on_time_pct = NULL` → card hidden), no
  locked invoices (revenue `0` → card shown at 0.0), and near-zero overdue
  (shown at 0.0). Two cards, two zeros, two disappearances.
- Nothing was broken. Two of the four tiles were telling the truth honestly,
  and two were lying in the opposite direction (asserting 0 where nothing was
  measured). §6 makes the policy one rule, not three.

---

## 2. The idea in one paragraph

Replace the hardcoded four with a **fixed four-of-a-catalog band**: a catalog of
31 named metrics across six domains, every one bound to the module grant that
gates its source, every role configured with (a) which catalog entries it may
even see, (b) its default four, (c) which of those are locked; users
personalise the rest through an inline "Edit tiles" panel on the band itself.
One choice per user across LIVE and TEST. Every tile opens a real drill-down,
not a stub.

---

## 3. Decision record (the questionnaire)

| #    | Question                             | Decision                                                        |
| ---- | ------------------------------------ | --------------------------------------------------------------- |
| D1   | Who picks tiles?                     | User self-service **plus** admin-set role defaults.             |
| D2   | How many tiles?                      | **Fixed 4.** The user picks *which* 4. Layout never changes.    |
| D3   | Metric has no data yet?              | **Show 0 — assert the zero** (§6.3 for exactly when not).       |
| D4   | Catalog size for v1?                 | **Full.** All domains, hand-built drill-downs for every tile.   |
| D5   | LIVE vs TEST scoping?                | **One choice, both modes.** (Already the preference doctrine.)  |
| D6   | Where does the picker live?          | **Inline on the band only.** Plus KPI setup at **role creation**. |
| D7   | What does a role config hold?        | **Defaults + lock + catalog scope.**                            |
| D8   | Tile the user can't access?          | **Not a candidate at all.** Never shown, never placeheld.       |
| D9   | What does a click do?                | **Full drill-down parity** — a real modal per tile. That is why this is a guide, not a PR. |
| D10  | Rollout?                             | **PR-1 foundation, then PR-2/3/4 in parallel** by domain.       |

Two decisions from the answer round, recorded with the rest:

- **D11 (from D6/D8) — KPIs are bound by permissions at creation time.** An HR
  role may pick human-capital tiles; Operations may not. Sales sees numbers
  Finance doesn't want it to, and vice versa. The catalog itself is the access
  list — see §4.
- **D12 (from D10) — Human Capital is a first-class domain**, six tiles deep, not
  a single attendance metric bolted on.

---

## 4. The permission model: tiles inherit rights, they never grant them

The product's own doctrine, from `0110_rbac.sql`: **access is rows, not enums** —
`Role × Capability × Scope × per-module CRUD × field visibility`. The band rides
that machinery exactly; it adds no new authority and needs no new kind of check.

Every catalog entry declares:

```
{
  id: "margin_closed",
  module: "MOD-46",              // the grant whose can_read gates the tile
  source: "costing.run",         // the table the guarded query hits
  sensitive_field: "dossier.margin",  // optional field_visibility key
  ...
}
```

**Eligibility** of a tile for a user, computed server-side:

```
eligible(tile, user) =
      any of user's roles has can_read on tile.module
  AND (tile.sensitive_field is absent
       OR field_visibility for it is 'visible' for all of user's roles)
  AND the source table exists / query guard succeeds   // module installed
```

Consequences, stated because they are the whole design:

1. **A tile you can't access doesn't exist for you.** Not greyed, not "You
   don't have permission", not a placeholder — it is not in your band and not
   in your picker. (D8.) The picker's candidate list is `eligible ∩ your role's
   scope`, computed server-side; the client never filters suggestions, because a
   client-side filter is a hint, and hints are not security.
2. **The role editor cannot pick a tile the role has no grant for.** When an
   admin configures "Operations", the KPI step shows only entries whose `module`
   that role can read. Grant the module, the tile becomes pickable; revoke it,
   the config entry is pruned at save time by the server. This mirrors
   `resolveTowerPins` — a pin whose grant was revoked disappears from the
   launcher on its own; the band does the same, at resolve, not at write.
3. **Masked-sensitive hides the tile entirely.** `margin_closed` for a role with
   `dossier.margin = masked` is *unavailable*, not zeroed. "Margin 0.0" from a
   masked reader is a leak-shaped hole — it looks like an answer. Same rule for
   `employee.salary` behind `payroll_run_state`.
4. **KPI tiles never grant.** Opening the band to 31 metrics adds zero rows of
   access; every number is a read-aggregate over a module the role already can
   read. This is why the feature is safe to ship broadly and why it needs no new
   capability type — only `MOD-00A` (the tower's own gate) to see the band at all.

Scope (branch/department) follows whatever `dossier_visible`-style row-visibility
views the underlying queries already use. **Scope-aware KPI rollups are out of
v1** (see §13) — the aggregates are what the source views show; the band does not
invent a second visibility layer.

---

## 5. The catalog

Module keys below are real (`grep const MODULE` across `src/modules/*`).
Status: `now` = computed and rendered today; `free` = already computed
server-side, rendering is all it needs; `new` = one guarded query to add.
The entry count is the v1 promise (D4): **31 tiles — 4 live today, 6 free,
21 new.**

### 5.1 Money — Finance / Treasury / Costing

| id                    | EN label              | FR label                  | module        | source (guarded)                                        | status |
| --------------------- | --------------------- | ------------------------- | ------------- | ------------------------------------------------------- | ------ |
| `revenue`             | Revenue · turnover    | Chiffre d'affaires        | MOD-51        | `invoice` FINAL locked, all periods (today's query)     | now    |
| `receivables_overdue` | Receivables · past due| Créances clients · échues | MOD-52        | `/receivables/overdue` total (today's)                   | now    |
| `proformas_open`      | Proformas · open      | Pro-formas en cours       | MOD-50        | `invoice` PROFORMA count (already in `kpis()`)           | free   |
| `cash_collected`      | Cash collected · MTD  | Encaissements du mois     | MOD-52        | `payment_receipt` sum in period                          | new    |
| `payables_overdue`    | Payables · past due   | Dettes fournisseurs · échues | MOD-53     | supplier invoices past due (`supplier_invoice`)          | new    |
| `journals_unposted`   | Journals · unposted   | Écritures non comptabilisées | MOD-55    | `journal_entry` draft count (already computed)           | free   |
| `cash_requests_awaiting` | Cash requests · awaiting | Demandes de décaissement | MOD-49        | `cash_request` pending approval                          | new    |
| `margin_closed`       | Margin · closed files | Marge · dossiers clôturés | MOD-46        | costing results on closed dossiers; `sensitive_field: dossier.margin` | new|
| `dso`                 | DSO · days outstanding| Délai moyen de paiement   | MOD-51/52     | weighted age of open invoices (derived server-side)     | new    |

### 5.2 Operations

| id                  | EN label              | FR label                 | module  | source                                             | status |
| ------------------- | --------------------- | ------------------------ | ------- | -------------------------------------------------- | ------ |
| `sla_on_time`       | On-time delivery      | Livraison à l'heure      | MOD-29  | dossier ATA ≤ ETA, measurable-denominator pair (§6.4) | now    |
| `late_vs_eta`       | Past ETA · undelivered| En retard d'ETA          | MOD-29  | `eta < now() AND ata IS NULL` on open dossiers     | new    |
| `files_active`      | Active operations     | Dossiers actifs          | MOD-29  | OPEN + IN_PROGRESS (already computed)              | free   |
| `approvals_awaiting`| Approvals · awaiting you | Approvals en attente  | MOD-00A | control-tower payload count (already computed)     | free   |
| `compliance_open`   | Compliance flags · open| Signalements ouverts    | MOD-65  | `compliance_flag` unresolved (already computed)    | free   |
| `needs_location`    | Files · needs location| Dossiers · lieu à confirmer | MOD-00A | banner count, promoted to a tile (already computed) | free   |
| `dwell_days`        | Dwell · arrival→delivery | Temps de séjour     | MOD-31  | milestone pair averages, current period            | new    |

### 5.3 Fleet & Warehouse

| id                          | EN label                | FR label                  | module       | source                                        | status |
| --------------------------- | ----------------------- | ------------------------- | ------------ | --------------------------------------------- | ------ |
| `fleet_utilisation`         | Fleet · on road         | Flotte · en route         | MOD-39       | active/total vehicles (today's pair)          | now    |
| `fleet_docs_expiring`       | Fleet docs · ≤ 30 days  | Documents flotte · ≤ 30 j | MOD-40       | `vehicle_compliance` expiring (insurance, visite technique) | new|
| `work_orders_open`          | Work orders · open      | Ordres d'entretien        | MOD-41       | open `work_order` count                       | new    |
| `warehouse_occupancy`       | Warehouse · occupancy   | Entrepôt · occupation     | MOD-34       | occupancy vs capacity headroom (`0100_capacity_headroom`) | new|
| `stock_value`               | Stock value             | Valeur du stock           | MOD-35       | `inventory_item` valuation; dead-stock drill tab | new |

### 5.4 Sales & Procurement

| id                      | EN label              | FR label                | module  | source                                   | status |
| ----------------------- | --------------------- | ----------------------- | ------- | ---------------------------------------- | ------ |
| `pipeline_won`          | Won · this month      | Gagnés · ce mois        | MOD-24  | `opportunity` won in period             | new    |
| `quote_requests_open`   | Quote requests · open | Demandes de devis       | MOD-20  | `quote_request` unanswered               | new    |
| `pos_in_flight`         | POs · awaiting receipt| Commandes en cours      | MOD-60  | issued POs without GRN                   | new    |
| `purchase_requests`     | Requests · awaiting PO| Demandes d'achat        | MOD-62  | `purchase_request` pending conversion   | new    |

### 5.5 Human Capital (D12 — six tiles deep)

| id                   | EN label               | FR label                | module | source                                            | status |
| -------------------- | ---------------------- | ----------------------- | ------ | ------------------------------------------------- | ------ |
| `headcount`          | Headcount · active     | Effectif actif          | MOD-02 | `employee` active count                           | new    |
| `attendance_today`   | Attendance · today     | Présence du jour        | MOD-14 | `attendance_log` clocked vs expected, ratio pair  | new    |
| `leave_pending`      | Leave requests · pending| Congés en attente      | MOD-15 | `leave_request` awaiting approval                 | new    |
| `vacancies_open`     | Vacancies · open       | Postes à pourvoir       | MOD-11 | open `vacancy` count (feeds careers-alerts too)   | new    |
| `payroll_run_state`  | Payroll · latest run   | Paie · dernière période | MOD-17 | current `payroll_run` status; `sensitive_field: employee.salary` gates the amount in the drill | new|
| `attrition_90d`      | Attrition · 90 days    | Départs · 90 jours      | MOD-02 | `employee.deactivated` events, rolling 90d        | new    |

### 5.6 Catalog as code — the one structural promise

`src/modules/dashboard/kpi_catalog/` — **one file per domain** plus `index.js`
aggregating, each entry declaring `{ id, labelKeys, module, source, unit,
policy, sensitive_field?, drill }`. The picker, the eligibility resolver, the
value queries and the drills all read this structure; nothing else about the
band is hardcoded. This is not tidiness — it is what makes §12's parallel PRs
non-conflicting: **PR-2, PR-3 and PR-4 never touch each other's domain file, and
`dashboard.repo.js` never grows again.**

The client keeps a thin mirror — `client/src/features/dashboard/kpi-model.ts` —
holding resolution order and slot math, exactly as `tower-model.ts` does for pins
("shared by the launcher and the editor so the two cannot disagree").

---

## 6. The band: rendering rules

### 6.1 Fixed four (D2)

`xl:grid-cols-4` stays. A selection is an **ordered list of ≤ 4 ids**; slot order
= left-to-right. No wrapping, no rows, no density control — the Applications
block below the band never jumps, which is the same promise `tower-model.ts`
makes about its grid.

### 6.2 Shrink, never pad (D8)

If a user's four contains a tile that has become ineligible — module
uninstalled, grant revoked — the band renders three. There is no auto-pad from
role defaults and no "Restricted" card. A silent substitution means the CEO
meets a number they never picked; a placeholder means the band spends pixels on
a question the user is not allowed to ask. Absence is honest and stable. The
picker explains the gap in one line when the user opens it
("1 tile hidden — you no longer have access to Payroll").

### 6.3 Zeros assert; unavailability hides (D3)

One rule for all 31 tiles, ending the half-applied policy of §1.3:

```
value is a number (0 is a number)  →  render it
guard returned null (no module)    →  tile is unavailable (invisible + unpickable)
sensitive field not visible        →  unavailable
```

This means: **on an empty-but-installed LIVE tenant, a picked tile now renders
"0.0 M XAF", "0 / 0 vehicles", "0 %".** That is the chosen policy — the hint
line under each value ("Locked final invoices, all periods", "Active now") is
what keeps the zero truthful: it names the source, so "0" reads as "the source
says zero", never as "the source says nothing". `COALESCE(SUM, 0)` stays; the
`fleetTotal > 0` client condition goes away.

### 6.4 Ratios carry their denominator

`sla_on_time_pct` must not confuse "0 % on time" (everything late) with "0
dossiers measurable" (nothing to say). Ratio tiles resolve as **`{ value,
denominator }`**; denominator 0 renders `0 %` with the hint unchanged. Catalog
entries declare `unit: "pct"` to get this treatment; counts and money render
bare. No new card state, one extra column in the payload.

---

## 7. Where the UI goes

### 7.1 Inline "Edit tiles" on the band (D6)

A ghost button at the band's right end — "Edit tiles", pencil icon, same visual
class as the map card's "Updated 10:54 PM" slot. Visible on hover and focus,
always visible on touch; it is a real `<button>` with `aria-haspopup="dialog"`
(the F13 lesson from `kpi-strip.tsx`: the band lives on the app's most-visited
screen, every interaction is keyboard-reachable).

Click opens a **panel anchored over the band** (not a route; not the settings
hub):

```
┌── Your KPI band ── 4 of 4 slots ──────────────────── [Role: Operations] ─┐
│ Slots: [1 files_active ✕] [2 late_vs_eta ✕] [3 needs_location ✕] [4 …] │
│ Search…                                                                  │
│ ▸ Money 9    ▸ Operations 7    ▸ Fleet & Warehouse 5                     │
│ ▸ Sales & Procurement 4    ▸ Human Capital 6   ▸ (locked rows: 🔒)      │
│ [ Restore role default ]                          [ Cancel ] [ Apply ]   │
└──────────────────────────────────────────────────────────────────────────┘
```

- Candidate list = `eligible ∩ role scope` (D8): things you can't pick are not
  dimmed, they're not listed. A short list with an honest footer ("Showing 12 of
  31 — the rest belong to modules you don't have") is the whole permission
  story a user needs.
- Click a catalog row to fill the first empty slot; click a slot chip to cycle
  order or clear. Enter applies on a real draft; "Apply" is a single
  `PUT /me/preferences/shell` — the panel edits a draft, so Cancel means Cancel.
- Role-locked tiles render with a 🔒 and can be re-ordered (they're the user's
  first slots) but not removed. A role that locks all four gets the picker
  reduced to a read-only view — that's the admin saying "this band is managed",
  which D1+D7 allow.

### 7.2 The role editor gets a KPI step (D6, D7, D11)

`client/src/features/security/roles.tsx` — the `RoleForm` (create **and** edit)
grows a third section after name/description/line-manager: **"Control Tower
tiles"**. It renders against the role's current module permissions, which makes
the KPI step literally downstream of the permission matrix — the ordering is the
feature: first decide what Operations may read, then what it must look at.

- **Scope** (which of the 31 this role may pick) — defaults to "everything the
  role can read", admin may narrow it. Narrowing is the tool for "warehouse
  operators never see margin".
- **Default four** — ordered; constrained to `scope ∩ grant-eligible`.
- **Locks** — checkboxes on default slots.
- Save runs the same server-side validation as user saves: any id outside the
  role's current eligibility is rejected with which module grant it would need
  — so the admin learns the model rather than fighting it.
- On any permission change through the matrix, the server prunes
  scope/default/locked of tiles whose `module` just lost `can_read`, and logs
  the prune to the audit ledger (`permission.changed` event already exists).

The system seeds sensible role defaults (e.g. **Executive:**
revenue, receivables_overdue, files_active, compliance_open — today's band
minus the fleet tile, plus the ops health tile; **Finance:** revenue,
receivables_overdue, payables_overdue, cash_collected; **Operations:**
files_active, late_vs_eta, needs_location, approvals_awaiting; **Fleet:**
fleet_utilisation, fleet_docs_expiring, work_orders_open, late_vs_eta; **HR:**
headcount, attendance_today, leave_pending, vacancies_open; **Sales:**
pipeline_won, quote_requests_open, revenue, dso). A user whose roles have no
config at all falls back to today's four — behaviour-preserving for every
tenant that never touches this feature.

That seed is `migrations/seeds/9023_seed_role_kpi_defaults.sql` — a 90xx tenant
seed, not a block inside the migration that creates the table. It intersects
each curated band with the role's real `can_read` grants, so it can never
promise a tile the eligibility resolver would immediately hide, and that
intersection needs `role` and `permission` to have rows.
`provisioning.service.js → migrateTenantDb` applies every tenant migration
first and only then the 90xx seeds, with the roles themselves arriving in
9020/9021/9022 — so the same block inside `13800` writes nothing on a new
tenant and something on an existing one.

### 7.3 What does NOT get a UI

No separate settings page, no "My appearance" card (that was option c; inline
won — one door, and it's the door on the screen where the question occurs).
No tenant-wide catalog editor: the catalog is code-reviewed data, because a
custom-SQL tile is this band's first fake number waiting to happen.

---

## 8. Data model and endpoints

### 8.1 Storage

- **User selection** — `kpiPins` added to the existing `shell` preferences
  section (`PUT /me/preferences/shell`, validator in
  `src/modules/preference/preference.validator.js`):
  `kpiPins: z.array(KPI_ID).max(4).nullable()`, same bounded-list discipline
  as `railPins`/`towerPins`. `null` = "no choice made" → role default applies.
  Identity-scoped, therefore env-independent (D5): one arrangement for LIVE and
  TEST, numbers differ, slots don't.
- **Role configuration** — one new tenant table, migration numbered after
  `13797`:

  ```sql
  CREATE TABLE role_kpi_config (
    role_id     uuid PRIMARY KEY REFERENCES role(role_id) ON DELETE CASCADE,
    scope_ids   text[] NOT NULL,          -- pickable set
    default_ids text[] NOT NULL,          -- ordered, ≤ 4, ⊆ scope_ids
    locked_ids  text[] NOT NULL,          -- ⊆ default_ids
    updated_at  timestamptz NOT NULL DEFAULT now()
  );
  ```

  ids are catalog strings, validated against the catalog at write time — no FK
  to a catalog table, because the catalog is code (`0110`'s "RBAC as data" is
  about authority; a tile id is a presentation key, not a right).

### 8.2 Endpoints

| route                      | who            | what                                                       |
| -------------------------- | -------------- | ---------------------------------------------------------- |
| `GET /dashboard/kpi-catalog` | any MOD-00A  | full catalog metadata + `eligible` verdict per entry       |
| `GET /dashboard/kpis` (extended) | MOD-00A  | `{ currency, values }` — per id, a number, a ratio pair (value + denominator), or null where the guard failed |
| `PUT /me/preferences/shell` (extended) | self | `kpiPins` validated against the caller's eligibility      |
| `GET/PUT /roles/:id/kpi`   | MOD-67         | role scope/defaults/locks; server enforces §7.2            |

`/dashboard/control-tower` stays exactly as it is — the band no longer reads
its `kpis` keys; the additive-`null` tolerance in `use-control-tower.ts` moves
to the catalog/kpi endpoints unchanged (module off ⇒ null ⇒ hidden, page
never breaks).

### 8.3 Resolution order

```
band =   user.kpiPins ?? merge(role configs of user's roles, ordered:
         earlier role wins per slot, dedupe, first 4) ?? SEED_DEFAULT
       ∩ eligible(user)              // filter, no pad — §6.2
```

Computed **once, server-side** (inside the extended `/dashboard/kpis`), so the
picker preview and the painted band cannot disagree — the `tower-model.ts`
"two places must not disagree about pinned" principle, applied.

---

## 9. Drill-downs (D9 — full parity)

Today's four hand-built drills (`drilldowns.ts`: revenue, sla, overdue, fleet)
keep their builders. Each new entry declares a drill spec in the catalog and
ships with its query:

- `{ list: "/final-invoices", filter: {...} }` style — reuse the module list
  endpoints the current drills already use, one page cap (200) per the existing
  pattern, client-side joins only where a module endpoint lacks a needed
  foreign name.
- Per-domain new list reads where needed: `/payroll-runs?current=true`,
  `/attendance/summary?date=today`, `/vehicle-compliance?expiring=30d`,
  `/inventory/valuation` — the module routes mostly exist; where an aggregate
  view doesn't, the drill opens the module's hub section pre-filtered rather
  than inventing an endpoint. The catalog's `drill` field records which;
  `kpi-drilldown.tsx` grows a generic renderer for the simple
  count/table/list shapes, and tiles whose shape warrants a bespoke card keep a
  hand-built builder next to the existing four.
- Sensitive drills respect field visibility inside the modal, not just at the
  tile: the margin drill columns blank to `—` when `dossier.margin` is masked
  for any of the viewer's roles (the tile being visible means the *aggregate*
  is allowed, not the per-row figures).
- Error semantics follow the fleet lesson in `use-control-tower.ts`: a drill
  that 403s says "you don't have permission", never "all clear".

---

## 10. Labels and language

Catalog entries carry `labelKeys` into the existing `dash` i18n tree
(`client/src/lib/i18n-dict.ts` — `en` is the shape source of truth, `fr` must
match or TS refuses to compile). All 31 × (label, hint, badge) × EN/FR land in
PR-1 with the four existing keys kept as aliases so no screen churns. FR wording
follows `doc/BRAND_GLOSSARY_FR_EN.md` (`parc` for the fleet asset register,
*Créances clients* for receivables). Number/currency formatting stays with the
shared `millions()` path; `revenue_currency` remains the one XAF assumption —
its fix lives in `doc/CURRENCY_HARDCODING_SWEEP_2026-08-19.md`, and the catalog
carrying a `currencyFrom: "tenant"` field on money tiles is that sweep's hook,
not this guide's job.

---

## 11. Testing

- **Unit (jest)**: eligibility matrix (grant × scope × sensitive field × missing
  module) — the four §4 rules each get the falsifying case (mask ⇒ no tile,
  NOT "0"); resolution order incl. multi-role merge; `kpiPins` validator bounds
  (>4, unknown id, non-catalog id); zero-vs-null rendering split (§6.3/6.4) on
  revenue, SLA denominator, fleet; role-config prune-on-revoke.
- **Component/a11y**: band renders 3 tiles when one goes ineligible (shrink,
  no pad); picker keyboard path and focus trap (axe, following
  `screens.axe.test.tsx` / `control-tower.test.tsx` conventions); locked tile
  cannot be removed but can be re-ordered; panel Cancel writes nothing.
- **Fixtures**: the empty-live-tenant case must be a real fixture — every bug
  in this band so far hides in the difference between "sandbox seeded" and
  "tenant young". Assert: picked tiles all render (as zeros), unpicked are
  absent, briefing counts unaffected.

---

## 12. PR plan (D10) — foundation, then three parallel

**PR-1 — Foundation (blocks everything):**
catalog directory (all 31 entries declared; the 10 `now`/`free` tiles are
status-live — 4 today's cards plus proformas_open, journals_unposted,
files_active, approvals_awaiting, compliance_open, needs_location — the 21
`new` tiles ship status-hidden until their domain PR flips them),
eligibility resolver, extended `/dashboard/kpis` with `{values}` + ratio
denominator pairs, `kpiPins` preference + validator, `role_kpi_config`
migration + endpoints + seed of §7.2 role defaults, band renderer off resolved
selection with the zero policy of §6, inline picker panel, role-editor KPI
step, i18n for all 31, tests, and the `kpi-model.ts` client mirror. Also
removes the `fleetTotal > 0` client condition and centralises the `COALESCE`
decision in the unified §6.3 rule, so the policy flips once, everywhere.

**PR-2 — Operations, Fleet & Warehouse** (6 tiles): late_vs_eta, dwell_days,
fleet_docs_expiring, work_orders_open, warehouse_occupancy, stock_value.

**PR-3 — Money, Sales & Procurement** (9 tiles): payables_overdue,
cash_collected, cash_requests_awaiting, margin_closed (+ field_visibility
wiring), dso, pipeline_won, quote_requests_open, pos_in_flight,
purchase_requests.

**PR-4 — Human Capital** (6 tiles, D12): headcount, attendance_today,
leave_pending, vacancies_open, payroll_run_state (+ sensitive_field),
attrition_90d; plus the HR role seed example.

Parallel-safety constraints (why this splits cleanly):

1. PR-1 creates **every shared file** — repo guards, validator, migration
   numbering, i18n tree, panel, resolver. Domain PRs add only: their catalog
   file, their queries section within it, their drill entries, their tests.
2. Domain PRs **never touch `dashboard.repo.js`** — new queries live in the
   domain catalog file, called by the resolver.
3. Merge order after PR-1 is arbitrary; the only shared mutable state is the
   migration number, and PR-1 owns the sole new migration (role_kpi_config),
   so domain PRs ship zero migrations.
4. Each domain PR is independently revertable: flipping its entries back to
   hidden leaves a 15-tile band working.

---

## 13. Open questions (non-blocking)

1. **Multi-role merge order** — "earlier role wins per slot" assumes role
   assignment order is meaningful to users. If it isn't, fall back to
   first-role-only defaults; decide when the roles screen next gets touched.
2. **SLA at 0 % vs "unmeasured"** — the chosen policy renders 0 % (D3, §6.3).
   If the first tenant meeting it complains, the fallback is a `dim` modifier
   on the value (not a new state) — catalog `policy` has room.
3. **Scope-aware rollups** (branch/depot): the `scope` table is there, the
   queries mostly use visibility views. Deferred, not rejected.
4. **The map card counts vs. the band** — `needs_location` and
   `approvals_awaiting` exist as banner/strip UI elsewhere on the tower. When
   both tiles and banners are picked, the same number appears twice on one
   screen. Acceptable for v1 (the tile drills, the banner acts); revisit if it
   reads as a bug.

---

## 14. Cross-references

`doc/CONTROL_TOWER.md` · `doc/CONVENTIONS.md` (SQL-only repos, service-compose) ·
`doc/BRAND_GLOSSARY_FR_EN.md` · `doc/CURRENCY_HARDCODING_SWEEP_2026-08-19.md` ·
`migrations/tenant/0110_rbac.sql` (RBAC as data) ·
`src/modules/dashboard/` (`dashboard.repo.js → kpis()`, the new `kpi_catalog/`) ·
`client/src/features/dashboard/` (`kpi-strip.tsx`, `kpi-model.ts` (new),
`drilldowns.ts`, `tower-model.ts`) · `client/src/features/settings/tower-card.tsx`
(the picker's sibling pattern) · `client/src/features/security/roles.tsx`
· `src/modules/preference/`.
