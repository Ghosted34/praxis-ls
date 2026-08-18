# Legacy pricing stack → Praxis LS: what was built, what we ported, what to fix

**Date:** 18 August 2026 · **Branch:** `arena/01a0148c-praxis-ls` · **Baseline:** `21717b2`
**Scope:** the four modules named in the brief — quotation, margin simulation, extra-charge
simulation, pricing variance — traced through `doc/reference/legacy_codebase` (PHP/MySQL) and
compared against our `src/modules/commercial/*` + `migrations/tenant/*`.

This is an analysis document. **No code was changed.** Every claim below cites the file and line
it came from; every column name was read out of the migration that creates it, not assumed.

---

## 0. How the legacy schema was read (and why that matters)

The legacy DB schema is **not in the repository** — `config/db.php` was deleted in the SEC-C1
sweep (`doc/reference/README.md`) and there is no dump. So legacy table/column names here are
taken **from the SQL string literals in the PHP**, which is the only authority available. Where
I quote a legacy column I have read it from an actual `INSERT`/`SELECT`/`UPDATE` statement.

For **our** side I did not trust `0345_commercial.sql` alone, because later migrations move the
goalposts. Sweeping every tenant migration for DDL touching the four tables gives the true
current shape:

| Migration                                | Effect on the four tables                                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0345_commercial.sql`                    | creates all six tables (`quotation`, `quotation_line`, `margin_simulation`, `margin_simulation_line`, `extra_charge_simulation`, `pricing_variance`) |
| `0350_sales_crm.sql:117`                 | `quotation.opportunity_id` → FK to `opportunity`                                                                                                     |
| `0497_money_constraints.sql`             | non-negative CHECKs (all six)                                                                                                                        |
| `0498_referential_and_uniqueness.sql:98` | partial unique index on `quotation.doc_number`                                                                                                       |
| `0640_disbursement_rename.sql`           | **`is_debours` → `is_disbursement`** on `quotation_line` and `margin_simulation_line`                                                                |
| `0661_shipment_details_snapshot.sql:39`  | `quotation.shipment_details_snapshot jsonb`                                                                                                          |
| `0663_line_container_type.sql:35`        | `quotation_line.container_type_ref_id` → `dictionary_ref(ref_id)`                                                                                    |

**The `0640` rename is the trap.** `0345` still reads `is_debours`, and `costing_line` (created in
`0320`) _keeps_ `is_debours` in its own CREATE — but `0640` renames it at runtime via
`information_schema`, so the live column everywhere is `is_disbursement`. Anyone porting from the
`0345` text alone will write a column that does not exist. Our JS is correct on this
(`margin_simulation.rules.js` reads `ln.is_disbursement`); this note is so the next person
doesn't regress it.

---

## 1. Legacy inventory — what actually existed, front end vs back end

### 1.1 The pages were duplicated per role, as whole files

The same screen exists five times, once per role directory, as a **physically copied file**:

```
administration/view/{admin,management,finance,operations,sales}/margin-simulator-billing.php
administration/view/{admin,management,finance,operations,sales}/extra-charges-simulator.php
administration/view/{admin,management,finance,operations}/operational-cost-reconciliation.php
administration/view/{admin,management,operations}/opportunity-cost-reconciliation.php
```

They are near-identical (118,454 vs 118,907 vs 117,936 bytes) and drift independently — the
management copy of the margin simulator is 3,159 lines and carries UI the sales copy does not.
There is no shared component; a bug fix had to be applied five times. **Our hub already solves
this** (`client/src/features/commercial/hub.tsx` — one screen, RBAC decides the buttons), and
that is the single biggest structural win already banked.

### 1.2 Module-by-module split of responsibility

| Legacy module                             | Front end (PHP page + inline JS)                                                                                             | Back end (`administration/api/…`)                                                                                                                                                                                                         | Persisted?                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Margin simulation / quoting**           | `view/*/margin-simulator-billing.php` — line grid, live margin badge, quote-setup modal, **full PDF built in browser**       | `api/marginpricing/` — 15 endpoints: `create, save, submit, approve, reject, unlock, validate, quote, link-costing, get, list, list-approved, get-approved-costings, get-costing-package, get-costing-ssdc, financial-dictionary, events` | ✅ `marginpricing_simulations`, `_lines`, `_events`                                                    |
| **Extra-charge simulation**               | `view/*/extra-charges-simulator.php` — **100% client-side**; the whole tariff is a JS literal (`let STATE = {…}`, line ~825) | _none_ — no API directory exists                                                                                                                                                                                                          | ❌ nothing. `saveAdminSettings()` (line 1135) ends in `alert("Saved locally!")` — edits die on refresh |
| **Operational cost reconciliation** (OCR) | `view/*/operational-cost-reconciliation.php`                                                                                 | `api/ocr/` — `list, get, files, file_context, save_draft, submit, validate, reject`                                                                                                                                                       | ✅ `ocr_master`, `ocr_line`                                                                            |
| **Opportunity cost reconciliation**       | `view/*/opportunity-cost-reconciliation.php`                                                                                 | _none_                                                                                                                                                                                                                                    | ❌ `let OCR_DB = []` (line 741) — an in-memory array, wiped on reload                                  |

> ⚠️ **`api/ocr/` is not OCR-the-scanner.** It is _Operational Cost Reconciliation_
> (`SELECT … FROM ocr_master` in `api/ocr/list.php`). The name collides with
> `api/ocr/` used elsewhere for document scanning — worth knowing before anyone greps for it.

### 1.3 Confirming the brief's assumption about pricing variance

The brief said _"pricing variance (legacy own is ops reconciliation I think but confirm)"_.

**Confirmed — with an important correction.** There are **two** legacy reconciliation screens and
they are not the same thing:

- **`operational-cost-reconciliation.php`** — budget (from the approved costing) vs **actual
  cost**, line by line, with a document-reference requirement. Real backend, real tables.
  Lifecycle `DRAFT → SUBMITTED → VALIDATED / REJECTED`. Variance is computed in the browser as
  `line.bud - line.act` (line 954) and never stored — only `total_budget_ttc` and
  `total_actual_ttc` are persisted (`api/ocr/save_draft.php`).
- **`opportunity-cost-reconciliation.php`** — a **non-functional prototype**. No API, no
  persistence, and a client-side role switcher (`switchRole('OPS')`, line ~750) that lets anyone
  reassign their own role by clicking a button. It renders the same table shape as the
  operational one. Treat it as a design mock, not as behaviour to port.

So the legacy ancestor of our `pricing_variance` is **`operational-cost-reconciliation.php` +
`api/ocr/*`**. But note the semantic gap:

|            | Legacy OCR                       | Our `pricing_variance`                                                          |
| ---------- | -------------------------------- | ------------------------------------------------------------------------------- |
| Compares   | budget cost **vs** actual cost   | **quoted price** vs actual cost                                                 |
| Answers    | "did ops overspend the costing?" | "is the margin we sold still there?"                                            |
| Output     | signed variance amount per line  | `variance_percent` + `GREEN/YELLOW/RED`                                         |
| Visibility | everyone sees both numbers       | **`actual_cost` withheld from Sales** (`pricing_variance.repo.js` `SALES_COLS`) |

Ours is the better question **and** ours is a genuinely new capability, not a port. The legacy
had no cost-confidentiality boundary at all. Keep that framing when reporting progress — but see
§3.4, because we dropped the legacy's line-level detail and its document-proof gate, and both
were doing real work.

---

## 2. The legacy margin/quote engine, in detail

Worth reading closely because it is the one module the legacy did properly, and it encodes
business rules we should not lose.

### 2.1 Lifecycle and who may drive it

`DRAFT → SUBMITTED → APPROVED → QUOTED`, plus `REJECTED`, `REVISION`.

| Transition   | Endpoint           | `require_role(...)`                           | Guard enforced server-side                                                                                       |
| ------------ | ------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| create       | `create.php`       | ADMIN, MANAGEMENT, FINANCE, OPERATIONS, SALES | —                                                                                                                |
| save         | `save.php`         | ADMIN, MANAGEMENT, SALES, OPERATIONS, FINANCE | rejects if status ∈ {APPROVED, QUOTED}                                                                           |
| link costing | `link-costing.php` | ADMIN, MANAGEMENT, FINANCE, OPERATIONS, SALES | status ∈ {DRAFT, REVISION, REJECTED}; costing must be `APPROVED_LOCKED`                                          |
| submit       | `submit.php`       | **ADMIN, SALES**                              | from ∈ {DRAFT, REVISION, REJECTED}; **costing must be linked**; **risk justification required if `risk_flag=1`** |
| approve      | `approve.php`      | **ADMIN, MANAGEMENT**                         | must be `SUBMITTED`; `SELECT … FOR UPDATE`                                                                       |
| reject       | `reject.php`       | ADMIN, MANAGEMENT                             | must be `SUBMITTED`                                                                                              |
| unlock       | `unlock.php`       | ADMIN, MANAGEMENT                             | from ∈ {APPROVED, QUOTED} → `REVISION`                                                                           |
| quote        | `quote.php`        | ADMIN, MANAGEMENT, SALES                      | must be `APPROVED`; **≥1 line with `print_on_quote=1 AND sell_total_ht>0`**; totals must be > 0                  |
| validate     | `validate.php`     | ADMIN, FINANCE, MANAGEMENT                    | logs a `VALIDATED` event **without changing status**                                                             |

Every transition writes to `marginpricing_simulation_events`
(`event, actor_user_id, actor_role, from_status, to_status, message`, and `payload_json` on
quote). That is a genuine append-only audit trail, and it is richer than what we emit today.

### 2.2 Server-authoritative maths (`save.php`)

The legacy **recomputed every line on the server** and ignored client totals:

```php
$lineCostTotal = $qty * $costUnit;
$lineSellHT    = $qty * $sellUnit;
$lineVat       = $vatApp ? ($lineSellHT * $vatRate) : 0.0;   // $vatRate default 0.1925
$lineMargin    = $lineSellHT - $lineCostTotal;
$lineMarginPct = ($lineSellHT > 0) ? ($lineMargin / $lineSellHT * 100.0) : 0.0;
if ($lineMargin < 0) $riskDetected = 1;                       // ← negative-margin flag
```

Three rules worth carrying forward:

1. **Margin % is on the sell price** (`margin / sell`), not on cost. Our
   `computeMargin` uses the same denominator and additionally exposes `markup_percent`. ✅
2. **`$riskDetected`** is set by the _server_ if any line's margin is negative, and
   `submit.php` then refuses to submit without a `risk_justification`. **We have no equivalent.**
3. **FX is stored per simulation** (`exchange_rate_to_xaf`) and the XAF-converted amount is
   written onto each line (`cost_total_xaf`, `selling_total_xaf`). Rate at time of quote is
   frozen into the row.

### 2.3 Costing import (`link-costing.php`)

Imports an `APPROVED_LOCKED` costing's lines into the simulation, snapshotting client, service
type, territory and totals onto the simulation header. Notable detail — the import is **HT-first
with a documented fallback chain**:

```php
$rawTotal = (float)($ln['total_ht'] ?? 0);
if ($rawTotal <= 0) $rawTotal = (float)($ln['total_ttc'] ?? 0);      // old data
if ($rawTotal <= 0) $rawTotal = ($qty > 0 ? ($qty * $unitCost) : 0.0);
$sellTotalXaf = (float)ceil($costTotalXaf * $markup);                 // $markup = 1.0
```

`$markup = 1.0` — the import seeds **sell = cost**, i.e. zero margin, and the pricer must key in
every sell price by hand. That is the single biggest time sink in the legacy workflow and the
most obvious thing to improve (§4.1).

### 2.4 Where the quote document came from

**Entirely the browser.** `generatePDF(type)` (line 2449, ~600 lines) string-builds a full HTML
document — `@page` CSS, Google-Fonts `@import`, fixed 168px info boxes, signature `<img>`,
statutory bar — writes it into a hidden iframe and calls `window.print()`. There is **no
server-side renderer**. Consequences:

- Output depends on the operator's browser, print dialog and network (the font is fetched from
  `fonts.googleapis.com` at print time).
- **`RC: RC/DLA/2021/B/2060` and `NIU: M042116033580Q` are hard-coded** into the footer of the
  page — single-tenant by construction.
- The saved artefact is whatever the user chose in the print dialog; **nothing is archived**.
  `quote.php` stores `quote_ref` and the setup fields, never a PDF.
- The `SECURE ID` printed in the footer is `verification_hash`, computed in `save.php` as
  `sha256(simulation_ref + total + currency + time())`. Because `time()` is in the input it
  **changes on every save** and is not reproducible — it cannot actually verify anything.

Two things in that PDF _are_ worth keeping, and we do not have either (§4.4): **amount in
words**, bilingual EN/FR (`toWordsEN` / `toWordsFR`, lines 3068 / 3103), and **per-line
client-facing remarks** aggregated into a header note.

### 2.5 Bugs in the legacy worth knowing (so we don't reimplement them)

- **`quote.php` prepares a statement, closes it, and prepares it again** (lines ~70-100) — dead
  code from a MySQL `LIMIT … FOR UPDATE` workaround, left in.
- **The front end calls an endpoint that does not exist.** `saveJustification()` (line 2243)
  POSTs to `${API_BASE}/save-justification.php`. There is no such file in
  `api/marginpricing/` — I checked. The `catch` only `console.warn`s, so the justification is
  silently kept in a JS variable and only persists if the user later hits Save (which does send
  `risk_justification`). A user who justifies and immediately submits loses the text and is
  blocked by `submit.php` with a confusing error.
- **`quote.php` posts zeroed totals.** `generatePDF` sends `total_ht: 0, total_vat: 0,
total_ttc: 0` and a non-schema `quote_amount_ttc`; the server falls back to stored totals. The
  printed document and the stored total are computed by two different code paths — the browser
  divides by FX (`Number(l.sell) / fx`), the server multiplies (`$lineSellHT * $conv`). **They
  disagree whenever currency ≠ XAF.**
- **Client-side role switching** in `opportunity-cost-reconciliation.php` and partly in the
  operational one (`switchRole()` sets `CURRENT_ROLE` from a button and re-renders the action
  buttons). The operational screen's _API_ does re-check with `require_role`, so this is a UI
  lie rather than a hole; the opportunity screen has no API to check.

---

## 3. Our side: verified state, and the defects I found

I read every file under `src/modules/commercial/*` and ran the rules module directly.

### 3.1 What is genuinely better already

| Concern               | Legacy                                       | Praxis LS                                                                           |
| --------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Screen duplication    | 5 copies per screen                          | one hub, RBAC-driven (`hub.tsx`)                                                    |
| SQL location          | inline in endpoints                          | repo layer only (`CONVENTIONS.md`)                                                  |
| Multi-tenant          | hard-coded RC/NIU in the PDF                 | `corporate_entity` + per-entity template config                                     |
| Money precision       | PHP floats                                   | integer centimes in `computeMargin`                                                 |
| Cost confidentiality  | none                                         | `SALES_COLS` never selects `actual_cost`; `/:id/finance` gated on `MOD-56`          |
| Disbursement handling | none — margin on everything                  | excluded from the margin base (KB §6.7)                                             |
| Doc numbering         | `'SLAS-QU-' . date('Ymd') . str_pad($simId)` | `numbering.service` with per-entity sequences, `MOD-27` → `QTE`                     |
| Audit                 | good (`_events` table)                       | `emitEvent` + `audit`                                                               |
| Quote → invoice       | manual re-key                                | `accept({convert:true})` builds the invoice draft, carrying `container_type_ref_id` |

### 3.2 🔴 Defect — extra-charge `create` persists nothing usable

`extra_charge_simulation.service.js:create()` reads three fields off the computed result that
the five-family path **never returns**:

```js
free_days: computed.free_days,
computed_charges: JSON.stringify(computed.breakdown),
total_amount: computed.total_amount,
```

`simulateCharges()` returns `{ currency, rows, families, total_ht, vat, total_ttc, vat_rate,
containers }` — no `free_days`, no `breakdown`, no `total_amount`. Verified by running it:

```
$ node -e "…simulateCharges({containers:'2x40HC', ata:'2026-01-01', gateOut:'2026-02-10', …})"
keys: [ 'currency','rows','families','total_ht','vat','total_ttc','vat_rate','containers' ]
free_days= undefined total_amount= undefined breakdown= undefined
JSON.stringify(breakdown) = undefined
```

So on the container path the row is written with `computed_charges = undefined` (→
`JSON.stringify` returns `undefined`, not `'null'`) and `total_amount = undefined`.
`total_amount` is `NOT NULL DEFAULT 0` — `insertOne` sends an explicit `undefined`, which
node-postgres binds as NULL, so **the insert fails on the NOT NULL**. The older
`occupied_days`/`tiers` path still works because `computeDemurrage` _does_ return those three
keys. Only `POST /extra-charge-simulations/preview` is exercised by
`tests/unit/extra-charge-five-families-g16.test.js`; `create` has no test, which is why this
survived.

**Fix:** normalise both compute paths to one result shape (`total_amount`, `breakdown`,
`free_days`) before the repo call, and add a `create` test on the container path.

### 3.3 🔴 Defect — the ported demurrage rates are not the legacy rates

`extra_charge_simulation.rules.js` says its `DEFAULT_RATES` mirror the legacy "exactly" and cites
`view/admin/extra-charges-simulator.php`. They do not. I read `let STATE` out of all five copies
of that page — **all five are identical** — and compared:

| Key                                         | Legacy (all 5 copies)                            | Our `DEFAULT_RATES`                   |                          |
| ------------------------------------------- | ------------------------------------------------ | ------------------------------------- | ------------------------ |
| `demurrage[20]`                             | `[7092, 12962.4]`                                | `[300, 1200]`                         | ❌ **23.6× low**         |
| `demurrage[40]`                             | `[13465.2, 25444.8]`                             | `[600, 2400]`                         | ❌ **22.4× low**         |
| `demurrage['20RF']`                         | `[7092, 12962.4]`                                | `[0, 0]`                              | ❌ **reefers bill zero** |
| `demurrage['40HC']`                         | `[13465.2, 25444.8]`                             | `[900, 3600]`                         | ❌                       |
| `demurrage['20FR']`                         | `[7092, 12962.4]`                                | `[0, 0]`                              | ❌                       |
| `demurrage['40RF']`, `['20HC']`, `['40FR']` | present                                          | **absent** → falls back to plain size | ❌                       |
| `storage[20]` / `[40]`                      | `[300,1200,3600,6000]` / `[600,2400,7200,12000]` | same                                  | ✅                       |
| `yard`, `detention`, `plug`, `yardTrigger`  | —                                                | same                                  | ✅                       |

The storage band values were copied into the demurrage slot. The unit tests then pinned the
wrong numbers (`extra-charge-five-families-g16.test.js` asserts `40HC` tier 1 = 900), so the
suite is green and the defect is invisible. Also missing: `fx: { XAF:1, USD:615, EUR:655.957 }`
is not carried, so `fx` is caller-supplied with no default.

**This is a live quoting-accuracy bug** — a 30-day 40′ HC stay quotes ≈41,400 XAF instead of
≈331,000 XAF. It needs a decision (§4.2), not just a patch: these rates belong in tenant
settings, and hard-coded defaults are what caused the mismatch.

### 3.4 🟠 Gaps against the legacy — capability we had and lost

1. **No negative-margin risk gate.** Legacy: server sets `risk_flag`, `submit.php` blocks
   without `risk_justification`. Ours: `margin_simulation` has no status at all, let alone a
   gate. A loss-making quote can go straight out.
2. **No approval lifecycle on the simulation.** The legacy's whole point was Sales prices →
   Management approves → _then_ quote. Our `margin_simulation` table has no `status` column;
   `quotation` has `DRAFT→SENT` with no approval step in between. The quotation route maps
   `SENT: "edit"` (`quotation.routes.js`), so **a user with `edit` can send a priced quote to a
   client with no second pair of eyes.**
3. **No costing → quotation import.** `link-costing.php` pulled an approved costing's lines in
   one click. We accept a `costing_id` on the quotation (`quotation.validator.js`) but nothing
   reads it — no service imports lines from `costing_line`. Confirmed: `grep -rn
"fromCosting|importCosting"` → no matches. Pricers must re-key every line.
4. **`pricing_variance` is header-only.** Legacy `ocr_line` held `budget_ttc`, `actual_ttc`,
   `doc_ref`, `doc_required` per line, and `submit.php` **blocked submission when a line with
   `actual_ttc > 0` and `doc_required=1` had no `doc_ref`**. We store one `actual_cost` per
   dossier from `SUM(cost_entry.amount)` — no line detail, no proof requirement, no reviewable
   state. There is no `pricing_variance_line` table.
5. **No `margin_simulation → quotation` conversion.** Two disconnected tables; the simulator's
   output cannot become the quote.
6. **`quotation.content_hash` and `pdf_vault_id` are never written.** Both columns exist in
   `0345`; `grep` across `src/modules/commercial/` returns nothing for either. Same for
   `shipment_details_snapshot` (added by `0661` explicitly so an issued quote keeps what it
   said) — the quotation service never populates it, so every reprint renders live data and the
   OHADA argument in `0661`'s own header is unenforced for quotations.

### 3.5 🟠 Configuration that does not exist

Both simulators read tenant settings that **are never seeded**:

- `getSetting(client, "commercial", "demurrage_tariff")` → `extra_charge_simulation.service.js`,
  and the tiers path **throws** `"No demurrage tariff configured"` when absent.
- `getSetting(client, "commercial", "extra_charge_rates")` → falls back to the (wrong) defaults.
- `getSetting(client, "commercial", "pricing_variance")` → thresholds; falls back to
  `green_min: 20, yellow_min: 10` hard-coded in `flagFor`.

`grep -rn "'commercial'" migrations/seeds/*.sql` → **no matches.** `9050_seed_settings.sql`
seeds only `numbering` and `finance`. So out of the box the demurrage path throws and the
variance thresholds are silent code constants rather than the tenant business rule
`PHASE2_COMMERCIAL_AUDIT.md` §"Tenant business rules" says they must be.

### 3.6 🟡 Documents — our pipeline is better-architected but thinner

Ours renders server-side via `template.service` → `templates/registry.js` → `pdf-render` worker,
with per-entity config, bilingual labels, sandbox watermark and a verify token. Structurally
right. But against the legacy quote sheet:

| Element                                   | Legacy                       | Ours                                                                                                    |
| ----------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Amount in words (EN + FR)                 | ✅ `toWordsEN`/`toWordsFR`   | ❌ nothing (`grep amountInWords` → 0 hits)                                                              |
| Per-line client remarks                   | ✅ aggregated to header note | ❌ `quotation_line` has no remarks column                                                               |
| Print-on-quote per line                   | ✅ `print_on_quote`          | ❌ every line prints                                                                                    |
| Validity / terms / bank / header note     | ✅ captured at quote time    | partial — `valid_until` only; bank from entity                                                          |
| Shipment details (BL, vessel, containers) | ✅ SSDC block                | ❌ not in the QUOTATION loader (`template.service.js:387`) despite `shipment_details_snapshot` existing |
| Equipment per line                        | ❌                           | ✅ `container_type_ref_id`                                                                              |
| Archived artefact                         | ❌ print dialog only         | ✅ vault                                                                                                |
| Auto-generate on issue                    | n/a                          | ❌ **not wired**                                                                                        |

That last row is a real gap: `final_invoice.controller.js:39` calls `enqueueDocument(...)`, but
**no controller in `src/modules/commercial/` does** — `grep -rn "enqueueDocument"
src/modules/commercial/` returns nothing. The `QUOTATION` template, its record loader
(`template.service.js:387`) and the numbering token all exist; sending a quotation just never
triggers a render. A user can only get the PDF by going to Template Studio manually.

---

## 4. Recommendations — how to port it into ours and make it better

Ordered by (damage if ignored) × (cost to do). Nothing here is started; all of it is a proposal.

### 4.1 Close the loop: costing → simulation → quotation → invoice

The legacy had `costing → simulation → quote`; we have `quotation → invoice`. Neither is whole.
Build the missing two edges so the chain is unbroken:

- `POST /margin-simulations/from-costing/:costing_id` — import `costing_line` rows where
  `costing.status = 'APPROVED_LOCKED'` (mirroring `link-costing.php`'s guard), mapping
  `costing_line.unit_cost → margin_simulation_line.unit_cost` and copying `is_disbursement`.
- **Do not repeat `$markup = 1.0`.** Seed `unit_price` from a target margin using the
  `priceForMargin(cost, marginPercent)` we already have and never call from any route. Take the
  target from `costing.margin_percent` (it exists, `0320`) falling back to a tenant setting.
  This turns the legacy's most tedious step into one field.
- `POST /quotations/from-simulation/:margin_simulation_id` — carry lines across, set
  `quotation.costing_id` and `margin_percent`, so `pricing_variance` can later join
  quote ↔ simulation ↔ costing (all three FKs already exist on `pricing_variance`).

Improvement over legacy: it did this at **fixed zero markup** and only into the simulation.

### 4.2 Move the extra-charge tariff into tenant settings, and fix the rates

1. Seed `('commercial','extra_charge_rates', …)` and `('commercial','demurrage_tariff', …)` in a
   new `migrations/seeds/` file, with **the real legacy values** from §3.3.
2. Correct `DEFAULT_RATES` and **re-derive the unit-test expectations from the corrected table**
   — the current tests encode the bug and will otherwise defend it.
3. Add the missing `40RF`, `20HC`, `40FR` keys and the `fx` default.
4. Make the rate table editable in Settings with an effective-date, so a tariff change does not
   silently re-price historical simulations. **This is the actual improvement**: the legacy's
   admin modal said `alert("Saved locally!")` and lost the edit on refresh.
5. Persist the resolved rate table onto the simulation row (the `computed_charges jsonb` column
   is right there) so a stored simulation can always explain its own numbers.

### 4.3 Add the approval gate and the negative-margin guard

Port the legacy's discipline, which is real financial control we currently lack:

- Add `status` to `margin_simulation` (`DRAFT → SUBMITTED → APPROVED → REJECTED → REVISION`)
  plus `risk_flag boolean`, `risk_justification text`, `approved_by`, `approved_at`. Forward-only
  additive migration; nullable; no backfill.
- Compute `risk_flag` **server-side** in `computeMargin` (any line where
  `unit_price < unit_cost` on a non-disbursement line, or total margin < a tenant floor) — never
  trust the client, exactly as `save.php` didn't.
- Block `SUBMITTED` without a justification when flagged, and **return a typed error**
  (`AppError("MARGIN_RISK", …, 409)`) so the UI can open the justification modal instead of the
  legacy's `alert()`-and-lose-the-text.
- Re-map `quotation.routes.js` so `SENT` requires `approve` when the quote's margin is below the
  tenant floor. Today it is `SENT: "edit"`.
- Improvement over legacy: our justification saves through the **same** endpoint as the rest of
  the row, so the missing-`save-justification.php` failure mode cannot recur.

### 4.4 Make the documents genuinely better than the legacy's

Server-side rendering already beats browser printing. Close the content gap:

- **Amount in words, EN + FR**, in `templates/kit.js` as a shared helper — invoices, proformas
  and credit notes all want it, and OHADA practice expects it. Port the algorithm from
  `toWordsFR` (it handles _quatre-vingt_ / _soixante-dix_ correctly, which is the fiddly part).
- **Per-line `remarks` and `print_on_quote`** on `quotation_line` — the legacy's two most-used
  quote-shaping controls, both absent from our schema.
- **Populate `shipment_details_snapshot` on `SENT`** and render the SSDC block from the snapshot,
  honouring `0661`'s stated intent. Then extend the `QUOTATION` loader
  (`template.service.js:387`) to include it.
- **Wire `enqueueDocument`** into the quotation controller's `transition` when `to === "SENT"`,
  matching `final_invoice.controller.js:39`. One line; without it the pipeline is unreachable.
- **Write `content_hash` and `pdf_vault_id`** on issue. Make the hash **deterministic over
  document content** (lines + totals + number + currency) — deliberately _not_ the legacy's
  `sha256(… . time())`, which changed on every save and verified nothing. A reproducible hash is
  what makes the footer's verify token meaningful.
- **Capture validity / payment terms / bank / header note** on the quotation row so a reprint
  reproduces the issued document rather than today's defaults.

### 4.5 Give pricing variance the line detail and the review gate it lost

Keep our better question (quoted vs actual, cost hidden from Sales) and add back what the legacy
OCR did well:

- `pricing_variance_line` — `dictionary_item_id`, `budget_amount`, `actual_amount`, `doc_ref`,
  `doc_required`, FK to `pricing_variance`. Budget from `costing_line`, actual from `cost_entry`
  grouped by `dictionary_item_id` (both columns confirmed present).
- A **review lifecycle** (`DRAFT → SUBMITTED → VALIDATED / REJECTED`) so a variance is something
  finance signs off, not just a computed row.
- Port the **document-proof gate**: block `SUBMITTED` when a line has `actual > 0`,
  `doc_required`, and no `doc_ref` — our `cost_entry.proof_vault_id` makes this stronger than
  the legacy's free-text `doc_ref`.
- Seed `('commercial','pricing_variance','{"green_min":20,"yellow_min":10}')` so the thresholds
  are a tenant rule rather than a constant in `flagFor`.
- Keep `salesView` strict, and add a regression test asserting `actual_cost` never appears in
  any Sales-facing response — that boundary is our headline improvement and should be defended
  by a test, not by convention.

### 4.6 Do not port these

- **`opportunity-cost-reconciliation.php`** — a mock with no backend. If the _concept_
  (opportunity cost / margin leakage) is wanted, specify it fresh; there is no behaviour to
  preserve.
- **Client-side role switching** — `switchRole()` in both reconciliation screens.
- **The five-way page duplication.**
- **`verification_hash` seeded with `time()`.**
- **`api/marginpricing-old/` and `api/margin_pricingold/`** — the former is nine **zero-byte**
  files, the latter a superseded copy. Dead weight; the live implementation is
  `api/marginpricing/`.

---

## 5. Suggested sequence

| #   | Item                                                                              | Why here                                                                  | Size |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---- |
| 1   | Fix extra-charge `create` result shape (§3.2) + add the missing test              | Broken write path today                                                   | S    |
| 2   | Correct demurrage rates, re-derive tests, seed `commercial` settings (§3.3, §3.5) | Live quoting-accuracy bug; unblocks the tariff path that currently throws | S    |
| 3   | Wire `enqueueDocument` on quotation `SENT` (§4.4)                                 | One line; makes the existing template reachable                           | XS   |
| 4   | Amount in words + `content_hash`/`pdf_vault_id` on issue (§4.4)                   | Document credibility                                                      | M    |
| 5   | Costing → simulation → quotation import (§4.1)                                    | Removes the biggest manual step                                           | M    |
| 6   | Margin approval + risk gate (§4.3)                                                | Financial control we don't have                                           | M    |
| 7   | `quotation_line.remarks` / `print_on_quote` + shipment snapshot (§4.4)            | Document parity                                                           | M    |
| 8   | `pricing_variance_line` + review lifecycle (§4.5)                                 | Restores lost depth on top of our better model                            | L    |

Items 1–3 are contained fixes to shipped defects. 4–8 each want their own migration and are
sized as separate pieces of work.

---

## 6. Evidence index

Every non-obvious claim, with its source.

| Claim                                                               | Source                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `is_debours` → `is_disbursement`                                    | `migrations/tenant/0640_disbursement_rename.sql` §2 (information_schema-driven) |
| Current shape of the four tables                                    | `0345`, `0350:117`, `0497`, `0498:98`, `0640`, `0661:39`, `0663:35`             |
| Legacy tables `marginpricing_simulations` / `_lines` / `_events`    | `api/marginpricing/save.php` INSERT statements                                  |
| Legacy tables `ocr_master` / `ocr_line`                             | `api/ocr/list.php`, `api/ocr/save_draft.php`                                    |
| Role guards per endpoint                                            | `require_role([...])` at the head of each `api/marginpricing/*.php`             |
| Negative-margin gate                                                | `save.php` (`$riskDetected`), `submit.php` (blocks without justification)       |
| Costing import at zero markup                                       | `link-costing.php` (`$markup = 1.0`)                                            |
| PDF built in browser                                                | `view/management/margin-simulator-billing.php:2449` `generatePDF()`             |
| Hard-coded RC/NIU                                                   | same file, ~line 2910                                                           |
| `verification_hash` uses `time()`                                   | `save.php` (`$rawString = … . time()`)                                          |
| Missing `save-justification.php`                                    | `find . -name "save-justification*"` → 0 matches; called at line 2243           |
| Extra-charge simulator has no backend                               | no `api/extra*` directory; `saveAdminSettings()` line 1135                      |
| Opportunity reconciliation is in-memory                             | `let OCR_DB = []` line 741; zero `fetch(` in the file                           |
| Legacy demurrage rates                                              | `let STATE` in all five `extra-charges-simulator.php` copies — identical        |
| Our rates differ                                                    | `extra_charge_simulation.rules.js` `DEFAULT_RATES`                              |
| `create` reads absent keys                                          | `extra_charge_simulation.service.js` vs `node -e` run of `simulateCharges`      |
| No `commercial` settings seeded                                     | `grep -rn "'commercial'" migrations/seeds/*.sql` → 0                            |
| No costing import on our side                                       | `grep -rn "fromCosting\|importCosting" src/ client/src` → 0                     |
| Quotation never enqueues a PDF                                      | `grep -rn "enqueueDocument" src/modules/commercial/` → 0                        |
| `content_hash`/`pdf_vault_id`/`shipment_details_snapshot` unwritten | `grep` across `src/modules/commercial/` → 0                                     |
| No amount-in-words                                                  | `grep -rn "amountInWords\|toWords" src/ client/src` → 0                         |
| Sales never sees `actual_cost`                                      | `pricing_variance.repo.js` `SALES_COLS`                                         |
| `SENT` needs only `edit`                                            | `quotation.routes.js` `TRANSITION_ACTION`                                       |
