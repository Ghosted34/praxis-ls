# Legacy pricing stack → Praxis LS: integration plan

**Date:** 18 August 2026 · **Branch:** `arena/01a0148c-praxis-ls` · **Written against:** `2d86ac7`
**Companion to:** `doc/LEGACY_PRICING_PORT_ANALYSIS.md` (the findings this plan acts on)

The analysis said _what_ is wrong. This says _what we change, in what order, and how we know it
worked_. Nothing here is built yet.

---

## 0. Two corrections to my own analysis — read these first

I re-checked the repository after writing the analysis and found two places where I was wrong or
duplicating work. Correcting them changes the plan materially, so they lead.

### 0.1 §4.5 is already built — do not build it again

`migrations/tenant/10715_dossier_reconciliation.sql` and
`src/modules/costing/dossier_reconciliation/` already ship exactly what §4.5 proposed:
`dossier_reconciliation` + `dossier_reconciliation_line` (`budget_ttc`, `actual_ttc`, `doc_ref`,
`doc_required`), the `DRAFT → SUBMITTED → VALIDATED | REJECTED` lifecycle, **maker-checker**
(`SELF_VALIDATE` — the submitter cannot validate, which is stronger than the legacy), and the
write-back onto `dossier` (`ocr_reconciliation_id`, `ocr_amount`, `ocr_status`). It is mounted at
`/costing/reconciliations` under `MOD-47`.

**So §4.5 collapses to one small item:** seed the `pricing_variance` thresholds (§3.5). The
line-level/proof/lifecycle work is done and lives under costing, which is the right home — it is a
_cost_ close-out, not a _pricing_ index. My §4.5 conflated them; `GAP_REVIEW_2026-08-14.md` G19
explicitly says `pricing_variance` "is a different thing and does not fill this", and it is right.

### 0.2 There is an existing gap register with a decided order

`doc/GAP_REVIEW_2026-08-14.md` (G1–G37, re-verified 15 Aug, decisions taken with the lead) already
owns this territory. **G16 is the extra-charge simulator** and carries a Definition of Done agreed
with the founder. This plan must slot into that register, not compete with it.

G16's DoD adds two requirements my analysis missed:

- **Container quantity is missing from the schema.** `extra_charge_simulation` (0345:64) has
  `container_variant text` and no count — _"a ten-container file returns one container's worth of
  charge"_. The rules engine parses quantity from free text but has nowhere to persist it.
- **The tier day arithmetic is wrong**, independently of the rate values I found. Legacy tiers are
  **absolute port-stay day numbers** (`tier 1 = max(12, free+1)…21`, `tier 2 from max(22, free+1)`);
  `computeDemurrage` rebases day 1 to the first day after the free period. Same tariff, same 7 free
  days → legacy starts billing day 12, we start day 8 and switch tier five days early.

That second point matters for sequencing: the `simulateCharges` path (G16's five families) already
uses absolute days correctly, but the older `computeDemurrage` path — still reachable, still the
one with tests — does not. **Both paths must be reconciled, or deleted down to one.**

---

## 1. Shape of the work

Seven changes, grouped into three landings. Each landing is independently shippable and leaves the
tree green.

| Landing             | Contains                                                                                              | Why grouped                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **A — Correctness** | 1. Extra-charge `create` result shape · 2. Rates, day arithmetic, container quantity, settings seed   | Both are live defects in one module; one migration, one test pass |
| **B — Documents**   | 3. Wire `enqueueDocument` · 4. Amount in words + capture-on-issue                                     | The quote document, end to end                                    |
| **C — Control**     | 5. Costing → simulation → quotation import · 6. Margin approval + risk gate · 7. Quote-shaping fields | Each depends on the one before it                                 |

Landing A is G16. Landings B and C are not in the register and should be added to it as new
entries (proposed **G38** and **G39**) rather than smuggled in — see §6.

---

## 2. Landing A — correctness (G16)

**One migration, one settings seed, one rules rewrite, one test pass.** This is the founder's
"copied as-is" item and the register ranks it 5th overall, above everything else here.

### 2.1 Migration `migrations/tenant/10716_extra_charge_container_qty.sql`

Next free number is **10716** (`10715` is the highest; `check-migration-numbers.js` fails on a
duplicate and the grandfather list is closed).

```sql
ALTER TABLE extra_charge_simulation
  ADD COLUMN IF NOT EXISTS containers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ata date,
  ADD COLUMN IF NOT EXISTS gate_out date,
  ADD COLUMN IF NOT EXISTS empty_return date,
  ADD COLUMN IF NOT EXISTS rates_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS total_ht numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_total numeric(18,2) NOT NULL DEFAULT 0;
```

Design notes, each deliberate:

- **`containers jsonb`, not a count column.** A file is `2x40HC, 1x20RF` — quantity _and_ type _and_
  size, repeated. One integer cannot hold it, and a child table for a throwaway simulation is
  overkill. Stores the parsed `[{q,s,t}]` the engine already produces.
- **`rates_snapshot`** freezes the tariff actually used, so a stored simulation can explain its own
  numbers after a tariff change. This is the `0661` snapshot-at-lock principle applied to the
  simulator, and it is what makes a settings-driven tariff safe.
- **Keep `container_variant`.** Populated by the old path; dropping it is destructive and would
  need a `-- DESTRUCTIVE:` marker (`check-destructive-migrations.js`). Additive only.
- **`total_amount` keeps its meaning** (TTC). Adding `total_ht`/`vat_total` alongside means the VAT
  the legacy showed per line survives to the row.
- Additive + `IF NOT EXISTS` throughout → passes the idempotency gate. Needs a `-- DOWN` block
  (`check-migration-reversibility.js`); it is plain `DROP COLUMN IF EXISTS`, commented, per house
  style.

### 2.2 Settings seed `migrations/seeds/9140_seed_commercial_settings.sql`

`grep -rn "'commercial'" migrations/seeds/*.sql` → zero. Three keys are read at runtime and none
exist; the tiers path _throws_ out of the box.

```sql
INSERT INTO setting (section, key, value) VALUES
 ('commercial', 'extra_charge_rates', '{ … the real legacy STATE … }'::jsonb),
 ('commercial', 'pricing_variance',   '{"green_min":20,"yellow_min":10}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;
```

Values taken verbatim from `let STATE` in `view/*/extra-charges-simulator.php` (all five copies
identical — I diffed them):

| Key                        | Value                                            |
| -------------------------- | ------------------------------------------------ |
| `demurrage.20` / `.40`     | `[7092, 12962.4]` / `[13465.2, 25444.8]`         |
| `demurrage.20RF/20HC/20FR` | `[7092, 12962.4]` (all three)                    |
| `demurrage.40RF/40HC/40FR` | `[13465.2, 25444.8]` (all three)                 |
| `storage.20` / `.40`       | `[300,1200,3600,6000]` / `[600,2400,7200,12000]` |
| `yard.20` / `.40`          | `100000` / `200000`                              |
| `detention.dry` / `.rf`    | `{20:7400,40:15000}` / `{20:37500,40:75000}`     |
| `plug.20` / `.40`          | `13000` / `13000`                                |
| `yardTrigger`              | `14`                                             |
| `fx`                       | `{XAF:1, USD:615, EUR:655.957}`                  |

`ON CONFLICT DO NOTHING` preserves tenant edits on re-run, matching `9050_seed_settings.sql`.

> **Open question for the lead — `demurrage_tariff`.** The third key
> (`getSetting(client,"commercial","demurrage_tariff")`) feeds the _old_ generic-tier path. Whether
> to seed it depends on §2.3's decision. Recommendation: don't seed it; retire the path.

### 2.3 Reconcile the two compute paths — a decision, not a patch

`extra_charge_simulation.service.js` has two engines behind one endpoint:

|                 | `simulateCharges` (G16 five-family)    | `computeDemurrage` (original)          |
| --------------- | -------------------------------------- | -------------------------------------- |
| Triggered by    | `body.containers` present              | otherwise                              |
| Day numbering   | **absolute port-stay days** ✅         | **rebased after free period** ❌ (G16) |
| Returns         | `total_ht/vat/total_ttc/rows/families` | `total_amount/breakdown/free_days`     |
| Charge families | five                                   | demurrage only                         |
| Tariff source   | `commercial.extra_charge_rates`        | `commercial.demurrage_tariff`          |
| Tested          | `preview` only                         | yes                                    |

They disagree on the arithmetic _and_ on the result shape — and the shape disagreement is exactly
what breaks `create` (§2.4). **Recommendation: retire `computeDemurrage` as a public path.** Keep
the five-family engine as the only one, keep `computeDemurrage` as an internal helper if useful,
and have the generic-tier request shape either map onto the new engine or 422 with a clear message.

Rationale: G16's DoD says make the day numbers absolute to match the legacy. Doing that to
`computeDemurrage` makes it a strictly worse duplicate of `simulateCharges` — same arithmetic,
one family instead of five. Two engines behind one endpoint is how the shape bug happened.

**This is a behaviour change for any caller using `occupied_days`/`tiers`, so it needs the lead's
yes.** If the answer is "keep both", then both must return the normalised shape from §2.4 and both
need the absolute-day fix — more work, not less.

### 2.4 Normalise the result shape, then fix `create`

The verified defect: `create` reads `computed.free_days`, `.breakdown`, `.total_amount`; the
five-family path returns none of them, so `total_amount` binds NULL against a `NOT NULL` column and
the insert fails.

Fix at the _source_, not the call site — have both paths return one contract:

```js
{
  (total_amount,
    total_ht,
    vat_total,
    breakdown,
    free_days,
    rows,
    families,
    containers,
    currency,
    rates_snapshot);
}
```

`create` then persists the new columns from §2.1 with no conditionals. Fixing it by defaulting
(`computed.total_amount ?? computed.total_ttc`) would paper over the divergence that caused it.

### 2.5 Tests — re-derive, don't adjust

`tests/unit/extra-charge-five-families-g16.test.js` currently asserts `40HC` tier 1 = 900, which is
the storage band value. **Recompute every expected number from the corrected table by hand** and
rewrite the assertions. Adjusting the existing numbers until they pass would re-enshrine the bug.

New coverage required:

- `create` on the container path — persists non-null `total_amount`, `containers`,
  `rates_snapshot`. This is the test whose absence hid the defect.
- A golden case per family (demurrage ×2 tiers, storage ×4 bands, yard, plugging, detention) from a
  real file, per G16's DoD.
- Absolute-day arithmetic: 7 free days bills nothing before day 12 and switches tier on day 22.
- Ten-container file bills ten containers (the G16 quantity defect).

**Definition of done for A:** G16's DoD, plus a green `create` on the container path, plus
`npx jest` clean and the migration gates passing.

---

## 3. Landing B — the quote document

### 3.1 Wire the render (XS)

`grep -rn "enqueueDocument" src/modules/commercial/` → nothing.
`final_invoice.controller.js:39` shows the pattern. Add to `quotation.controller.js` in
`transition` when `to === "SENT"`:

```js
enqueueDocument({
  tenantMeta: req.tenant,
  env: req.env,
  docType: "QUOTATION",
  recordId: req.params.id,
});
```

The `QUOTATION` template (`registry.js:107`), its loader (`template.service.js:387`) and the `QTE`
numbering token all already exist. Fire-and-forget by design — `generate.js` never throws.

### 3.2 Capture what was issued (S)

Three columns exist and are never written: `content_hash`, `pdf_vault_id` (0345),
`shipment_details_snapshot` (0661). On `SENT`:

- **`shipment_details_snapshot`** ← the SSDC projection, honouring `0661`'s stated intent. Then
  extend the QUOTATION loader to render from the snapshot when present, live when NULL — the
  fallback `0661` specifies.
- **`content_hash`** ← **deterministic** over lines + totals + number + currency. Explicitly _not_
  the legacy's `sha256(… . time())`, which changed on every save and verified nothing while
  printing "SECURE ID" on the page. A hash that cannot be recomputed is worse than none: it
  performs verification without providing it.
- **`pdf_vault_id`** ← set from the render job's vault capture.

### 3.3 Amount in words, EN + FR (M)

Absent (`grep amountInWords|toWords` → 0 hits). OHADA practice expects it and every legacy quote
carried it. Port `toWordsFR` from `margin-simulator-billing.php:3103` — it handles _soixante-dix_ /
_quatre-vingt_ correctly, which is the part that gets written wrong — into
`services/documents/templates/kit.js` as a shared helper, and use it in the invoice, proforma,
credit-note and quotation templates.

**Definition of done for B:** issuing a quotation produces a vaulted PDF with the amount in words,
a reproducible hash, and shipment details frozen as at issue; reprinting after the dossier changes
reproduces the original.

---

## 4. Landing C — control and flow

Sequenced: 5 → 6 → 7. Each needs the previous.

### 4.1 Costing → simulation → quotation (M)

The chain is broken at both ends: legacy had costing→simulation, we have quotation→invoice.

- `POST /margin-simulations/from-costing/:costing_id` — import `costing_line` where
  `costing.status = 'APPROVED_LOCKED'` (`link-costing.php`'s guard; the status exists in 0320's
  CHECK). Map `unit_cost`, carry `is_disbursement`.
- **Seed `unit_price` from a target margin** via `priceForMargin(cost, marginPercent)` — which
  exists in `margin_simulation.rules.js:68`, is exported, and **is called from no route**. Target
  from `costing.margin_percent` (0320), falling back to a tenant setting. The legacy imported at
  `$markup = 1.0` (sell = cost) and made the pricer key in every price by hand; this is the single
  biggest time saving available and it needs no new maths.
- `POST /quotations/from-simulation/:id` — carry lines, set `costing_id` and `margin_percent` so
  `pricing_variance` can join quote ↔ simulation ↔ costing. All three FKs already exist on
  `pricing_variance` (0345:79) and are currently unreachable.

### 4.2 Approval gate and negative-margin guard (M)

Migration `10717_margin_simulation_approval.sql` — additive:
`status` (`DRAFT|SUBMITTED|APPROVED|REJECTED|REVISION`, default `DRAFT`), `risk_flag boolean`,
`risk_justification text`, `submitted_by/at`, `approved_by/at`, `rejected_by/at`, `reject_reason`.

- **`risk_flag` computed server-side** in `computeMargin` — any non-disbursement line with
  `unit_price < unit_cost`, or total margin below a tenant floor. Never from the request body; the
  legacy got this right in `save.php` and it is the reason the rule held.
- Block `SUBMITTED` when flagged without a justification, returning a typed
  `AppError("MARGIN_RISK", …, 409)` so the UI opens the justification modal. The legacy's version
  `alert()`ed and POSTed to `save-justification.php` — **a file that does not exist** — so the text
  was silently lost. Ours saves through the same endpoint as the rest of the row, which makes that
  failure mode structurally impossible.
- **Maker-checker**, matching `dossier_reconciliation.validate` (`SELF_VALIDATE`): the submitter
  cannot approve. The legacy allowed it via the ADMIN role.
- Re-map `quotation.routes.js` `TRANSITION_ACTION` so `SENT` requires `approve` when margin is
  below the floor. It is currently `SENT: "edit"` — a priced quote reaches a client with no second
  pair of eyes.

### 4.3 Quote-shaping fields (M)

Migration `10718_quotation_line_quote_fields.sql`: `quotation_line.remarks text`,
`quotation_line.print_on_quote boolean NOT NULL DEFAULT true`; on `quotation`: `validity_note`,
`payment_terms`, `bank_details_override`, `header_note`. The legacy's two most-used controls
(`print_on_quote`, per-line remarks aggregated into a header note) and the quote-setup fields it
captured at issue. Renderer honours them; totals count only printed lines, as `quote.php` did.

**Definition of done for C:** an approved costing becomes a priced simulation in one click; a
loss-making quote cannot be submitted without a written reason or approved by its author; the
issued PDF shows only client-facing lines with their remarks.

---

## 5. What we are explicitly not doing

Carried from the analysis, restated so it is decided rather than forgotten:

- **`opportunity-cost-reconciliation.php`** — an in-memory mock (`let OCR_DB = []`, zero `fetch`).
  No behaviour to preserve. If opportunity-cost/margin-leakage is wanted, specify it fresh.
- **Client-side role switching** — `switchRole()` in both reconciliation screens.
- **Five-way page duplication** — already solved by `hub.tsx`.
- **`verification_hash` seeded with `time()`** — replaced by a deterministic hash (§3.2).
- **`api/marginpricing-old/` (nine zero-byte files) and `api/margin_pricingold/`** — dead.
- **Rebuilding line-level cost reconciliation** — already shipped as `dossier_reconciliation` (§0.1).

---

## 6. Sequencing against the existing register

`GAP_REVIEW_2026-08-14.md`'s agreed order puts **G16 fifth overall**, after G2/G3/G4/G23 and before
G17. Landing A _is_ G16 and should take that slot unchanged.

Landings B and C are not in the register. Rather than jumping the queue, propose them as new
entries and let the lead place them:

| Proposed | Content                                                                        | Suggested placement                | Argument                                                             |
| -------- | ------------------------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------- |
| **G38**  | Quotation document not generated, not captured, no amount in words (Landing B) | With G30's proposal-PDF/vault work | Same pipeline, same reviewer; §3.1 is one line                       |
| **G39**  | No costing→quote import, no margin approval gate (Landing C)                   | After G19                          | G19 closed the _cost_ side of the file; this closes the _price_ side |

One dependency worth flagging: **§3.3's amount-in-words touches the same templates as G1's
bilingual EN/FR pass** (register item 8). If G1 lands first, the helper should be built inside its
i18n runtime rather than beside it. If B lands first, G1 inherits a bilingual helper already in
`kit.js`. Either order works; doing them blind of each other means one gets rewritten.

---

## 7. Risk, and how each is contained

| Risk                                             | Containment                                                                                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Corrected rates change quoted prices ~23×**    | Real numbers, not a regression — but it _will_ be noticed. Land A behind a settings seed so a tenant can be shown the tariff before it goes live, and tell the client the day it ships. |
| **Retiring `computeDemurrage` breaks a caller**  | §2.3 needs the lead's decision first. `grep` for callers before touching it; the client only calls `preview`/`create`.                                                                  |
| **Rewriting tests looks like weakening them**    | Every new expected value is hand-derived from the seeded tariff and shown in the PR body. Reviewer checks arithmetic, not intent.                                                       |
| **Migration re-run on a live tenant**            | All additive, all `IF NOT EXISTS`, all with `-- DOWN`. Verified by `check-migration-idempotency`, `-reversibility`, `-destructive`, `-numbers`, `-schema-drift`.                        |
| **`10716` collides with a parallel stream**      | The numbering gate fails on new duplicates. Rebase and renumber _before_ applying anywhere — never rename an applied file (the ledger keys on filename; use `db:mark-applied`).         |
| **Approval gate blocks a legitimate rush quote** | The floor is a tenant setting, and `approve` is a grant. Configurable, not hard-coded.                                                                                                  |

---

## 8. Verification

Per landing, before it is called done:

1. `npx jest` — full suite green (3,026 tests as of the last audit).
2. `node scripts/db/check-migration-numbers.js` · `-reversibility` · `-idempotency` ·
   `-destructive-migrations` · `-schema-drift`.
3. `npm run lint` — under the 136-warning ceiling.
4. A throwaway Postgres 16: `migrate-platform` → `provision-tenant` → `migrate-tenants` re-run
   reports `applied 0 new file(s)`, per the method in `SALES_CRM_AUDIT_2026-08-16.md`.
5. Landing A only: a real file's charges computed by hand against the legacy PHP and compared to
   the endpoint, per family.

> **Note on this sandbox:** `node_modules` is not installed here (`require('express')` fails), so
> `ci-local.js` reports 8 environmental failures on the untouched baseline. Jest runs. Any
> implementation work needs `npm ci` first, and the gate list above must be run in an environment
> where those failures do not mask real ones.

---

## 9. What I need decided before starting

1. **§2.3 — retire `computeDemurrage`, or keep both paths?** Blocks Landing A's shape.
2. **Tariff values** — the seed uses the legacy `STATE` verbatim. Confirm those are the rates in
   force today, not stale 2024 numbers. They are ~23× the current code, so somebody should say out
   loud which is right before it reaches a client quote.
3. **Placement of G38/G39** in the register (§6), and whether Landing B waits on G1's i18n runtime.
4. **The margin floor** for §4.2 — a number, and whether it differs per service type.

Items 1 and 2 block Landing A. Items 3 and 4 can be settled while A is in flight.
