# Costing & Commercial — legacy vs. our build

**Date:** 20 Aug 2026 · **Scope:** the *Costing* group (Costing Module, Cost Tracking Master, Operational/Opportunity Cost Reconciliation, Financial Dictionary) and the *Commercial* group (Margin Simulator & Pricing, Extra Charges Simulator) — legacy source read in full, then judged against the screens in the screenshots.

## What I actually read

Legacy source under `doc/reference/legacy_codebase/administration/`:

| File | Lines | What it gave |
|---|---|---|
| `view/admin/costing-module.php` | 2 647 | costing worksheet, workflow, print engine, suggest |
| `view/admin/margin-simulator-billing.php` | 3 189 | margin simulator, quote setup, risk gate, PDF |
| `view/admin/extra-charges-simulator.php` | 1 181 | 5-family demurrage/storage/yard/plug/detention engine + rate modal |
| `view/admin/operational-cost-reconciliation.php` | 1 662 | budget-vs-actual, variance grade, workflow |
| `view/admin/opportunity-cost-reconciliation.php` | 1 191 | same shape, pre-award |
| `view/admin/cost-tracking.php` | 886 | the 15-item cost/advance/balance matrix |
| `view/admin/financial-dictionary.php` | 927 | **the pricing SSOT** — cost nature, VAT treatment, audit rules |
| `api/costing/{save,get,list,transition,validators,_util}.php` | — | server-side totals, status machine |

Ours: `src/modules/commercial/{margin_simulation,extra_charge_simulation,quotation,pricing_variance}` and `src/modules/costing/{costing,cost_tracking,dossier_reconciliation}` — rules + service layers.

**Which screenshots are which:** the *New Costing Worksheet*, *New Reconciliation* and *Margin Simulator (SLAS-QUO-00050)* shots are **legacy** (the first two rendered dark). The invoice `fb7db2f3`, the *Margin simulation* modal, `SBX-2026-0001`, and both *Extra-charge simulation* shots are **ours**.

---

## 1. The one defect the screenshots are all pointing at

Follow a single dossier across four of our screens:

```
Charge catalogue          →  costing line          →  margin simulation      →  invoice
(cost nature not set)        is_disbursement=true     PASS-THROUGH ×3           95,700,000 XAF
                             tax_code_id=null         price 0, margin 0%        TVA 0.00
```

`SBX-2026-0001` shows **all three lines as PASS-THROUGH**: Fret maritime 40ft, Droits de douane, THC. Only one of those is genuinely a débours. Customs duty is a statutory pass-through; **ocean freight and THC are carrier charges we resell** — in the legacy vocabulary `CHARGEABLE_SERVICE`, not `DISBURSEMENT` (`financial-dictionary.php:397–402`).

Our own maths is correct and does exactly what it is told:

```js
// margin_simulation.rules.js:49
if (ln.is_disbursement === true) { disbursementC += lineCost; }   // excluded from margin base
else { svcCostC += lineCost; svcPriceC += linePrice; if (ln.vat_applicable) vatC += ... }
```

```js
// margin_simulation.service.js:73  (fromCosting)
is_disbursement: l.is_disbursement === true,
vat_applicable: !!l.tax_code_id,
```

So when every costing line arrives flagged `is_disbursement` with no tax code, the consequences cascade deterministically: **margin base = 0 → margin 0% → VAT 0 → TVA 0.00 on the invoice.** Nothing in the chain is lying; the classification at the top is wrong.

Legacy already had the field that decides this, and made it non-optional and partly system-locked:

- **Cost Nature** — `CHARGEABLE_SERVICE | DISBURSEMENT | STATUTORY_PAYMENT | INTERNAL_COST`
- **VAT Treatment** — derived and read-only: `runLogic()` sets `VAT_OUT_OF_SCOPE_TRANSIT` for hinterland transit, `VAT_EXEMPT_STATUTORY` for statutory payments, otherwise `VAT_APPLICABLE_STANDARD`
- **Negotiable? / Billable?** — auto-forced: a disbursement or statutory line is *not* negotiable and *is* billable; an internal cost is not billable at all
- **Receipt Required / Valid Source / Justification Mandatory** — the audit contract per charge

**We have the shape of that data but nothing is driving it.** Our charge catalogue needs the nature/VAT-treatment fields populated and enforced, and `fromCosting` should be reading a *classification*, not a boolean somebody happened to set.

### Two more things wrong on that invoice

- **`TVA 0.00` on a Cameroon invoice with THC and freight.** Even if you accept the pass-through flags, the tenant VAT rate never got a chance to apply.
- **Quantities collapsed.** The simulation holds `Fret maritime 40ft — qty 40 × 2,000,000` and `THC — qty 40 × 180,000`. The invoice shows `qty 1 × 80,000,000` and `qty 1 × 7,200,000`. The unit basis is gone. Legacy went out of its way to preserve it — `setupSimUI` derives a unit from the total when only a total survives, precisely because a line that has lost its unit can never be re-priced or checked (`margin-simulator-billing.php:1687–1705`).
- **The invoice was raised at cost.** Total price on the simulation is `0.00`; the invoice bills `95,700,000` — the cost figure. Whatever path produced `fb7db2f3` is sourcing amounts from the cost side and bypassing the priced, approved document. That is the pricing gate failing open.

---

## 2. Defects in our build

**2.1 — VAT literal still live in the extra-charge engine.** The service resolves the tenant rate and even documents the fix:

```js
// extra_charge_simulation.service.js:190-194
// The VAT rate is the tenant's (settings finance.vat) ... it was a 0.1925 literal
// here, which is exactly the "frozen number" defect this module exists to avoid.
```

But the module that actually computes the total still holds it:

```js
// extra_charge_simulation.rules.js:51
const VAT_RATE = 0.1925;
// :275
const vat = round2(total_ht * VAT_RATE);
```

`fiveFamily()` never passes a rate into `simulateCharges()`. **Every saved extra-charge simulation is taxed at 19.25% regardless of the tenant setting.** The literal was removed from the display path and left in the calculation path.

**2.2 — Saved simulation with a TTC and no HT.** The *Saved simulation* dialog reads `TOTAL HT —` next to `TOTAL TTC 450,000.00 XAF`, and the row in the table below has HT, VAT and TTC all blank. `create()` does persist `total_ht` / `vat_total` for the five-family model (`service.js:148–150`), so either the read path is returning a field the dialog doesn't name, or the row predates the migration that added those columns and is NULL. Either way, a total that cannot decompose into HT + VAT is not auditable.

**2.3 — No pricing gate on submit.** `submit()` checks status and nothing else:

```js
// margin_simulation.service.js:135
const sim = await mustBe(client, id, "DRAFT", "submit");
```

`SBX-2026-0001` — 95.7M of cost, zero revenue — sits in DRAFT with a live **Submit** button. Legacy refused:

```js
// margin-simulator-billing.php:2404
if (risk-warning visible && !riskJustification) {
  alert("Cannot submit: Negative margins require justification.");
  promptRiskJustification(); return;
}
```

with a modal demanding a written business reason (*Strategic Client, Loss Leader, Bundle Deal*), persisted so Management sees it at approval. **We dropped the risk-justification concept entirely.** Maker-checker on approve is good and better than legacy — but it fires after the fact, on a document nobody was stopped from submitting.

**2.4 — The margin modal is thinner than the job.** Ours: one blank line, *Search a charge…*, Qty / Unit cost / Unit price, two checkboxes, a `POOR (0%)` chip. Legacy put the pricer's whole instrument panel on the screen — per-line **Margin** *and* **KPI** side by side, Enter-to-drop-down-the-Selling-column, a per-line **print-on-quote eye** (which fees the client actually sees), live **Profitability Snapshot** bars, a **Global Margin %** with HEALTHY/LOW/CRITICAL, and a line-notes column.

We already compute all of it (`lineEconomics` returns margin, percent and KPI band; `computeMargin` returns service vs. disbursement split and markup) — the modal just doesn't show it. And `priceForMargin(cost, target%)` exists in our rules and is exposed nowhere. That function is the single thing legacy never had and most needed: legacy seeds `sell = Math.ceil(unitCost * 1)` (`:1869`), i.e. **selling price = cost**, which is why the legacy screenshot shows `POOR (0%)` on all 8 lines and `GLOBAL MARGIN 0.0% CRITICAL`. That is a legacy artefact, not real data. **Our `unit_price: 0` is the same trap in different clothes** — neither screen ever proposes a price. Seed from a target margin instead.

**2.4a — A saved DRAFT cannot be edited. There is no endpoint.** This is the most consequential gap of the lot, and it is not a UI thinness — the API has nothing to offer.

```js
// margin_simulation.routes.js — the complete write surface
router.post("/",            ... controller.create);
router.post("/:id/submit",  ... controller.submit);
router.post("/:id/approve", ... controller.approve);
router.post("/:id/reject",  ... controller.reject);
router.post("/:id/quote",   ... controller.quote);
```

No `PATCH /:id`. `module.exports = { preview, fromCosting, create, get, list, submit, approve, reject, quote, priceForMargin }` — no `update`. **Once a margin simulation is created it is frozen, in every status including DRAFT.**

That is exactly what the `SBX-2026-0001` screenshot is showing. 95.7M of cost, zero price, three wrongly-flagged pass-through lines — and one button, **Submit**. Not a thin screen: the only two moves the API permits are *submit it as it stands* (into approval with zero revenue) or *abandon it and start again*. A pricer cannot correct a price, add a forgotten fee, or clear a bad débours flag.

Same story on extra-charge simulations: `preview, create, get, list, rates, saveRates, prefill` — no update. Which is why the *Saved simulation* dialog's only forward action is **Re-apply to workbench**: it can't edit the record, so it re-seeds the form and you save a *second* one. Every correction leaves a duplicate behind.

Legacy had this right, and it was the spine of both screens. `isEditableStatus()` returns true for `DRAFT` and `REJECTED`; `toggleEditMode(isEditable)` walks every input, select and textarea and enables or disables it, shows/hides the row-delete buttons and the Add-Line/Suggest bar, and flips the footer to a red *Read-Only View* (`costing-module.php:1538–1571`, `:1642`). The margin simulator does the same with `isLocked = (APPROVED || QUOTED || SUBMITTED)`, explicitly `false` for `REVISION`, and every line input carries `${disabled}` (`margin-simulator-billing.php:1765`, `:2003`). A rejected document reopens for editing and goes round again — that is the whole point of REJECTED as a state.

**Our costing module already does this properly** — `PATCH /:id` with `requirePermission(MOD-46, "edit")`, plus a full unlock loop (`REQUEST_UNLOCK / UNLOCK / DENY_UNLOCK`) that fixes legacy's dead end. **Commercial never got the same treatment.** Note the asymmetry this creates: `REJECTED` on a margin simulation is currently a terminal state, because the only way to act on the rejection is to build the document again from scratch.

**2.4b — The charts are gone.** Legacy put a live picture next to every set of numbers, and in each case it answered a question the table couldn't:

| Legacy screen | Chart | Question it answers |
|---|---|---|
| Margin simulator | **Profitability Snapshot** — Cost / Rev / Net bars, scaled to the largest, + Global Margin % with HEALTHY / LOW / CRITICAL | is there any daylight between cost and revenue? |
| Margin register | 4 KPI cards — Win Rate MTD + delta vs last month, Active Quotes + pipeline, Pending Approval, Projected Margin | where is the desk, this month? |
| Cost reconciliation | **Budget vs Actual** bars + **Variance Grade** — `EFFICIENT` / `OVERRUN` with the % | did we hold the budget? |
| Extra charges | 3 KPI tiles — Free Time, Chargeable days, **Timeline Status** flipping red `EXCEEDED` | has this box already blown its free time? |
| Costing registry | 4 KPI cards — MTD count, pending validation, pending approval, Total TTC | what is waiting on me? |

`updateSnapshot()` (`margin-simulator-billing.php:2155–2192`) recomputes the bars on every keystroke — you watch the Net bar grow as you price. `calculateTotals()` in the reconciliation does the same for budget-vs-actual and re-grades live (`operational-cost-reconciliation.php:1305–1355`); that is the bar chart and `PENDING` grade visible in the *New Reconciliation* screenshot, which is a legacy shot.

Ours: the margin modal has no snapshot at all; the `SBX-2026-0001` view has six flat stat tiles and no chart; the extra-charge screen has an empty breakdown pane where the families should be.

**The good news is that this one is pure frontend.** `get()` already returns everything a chart needs — `totals` carries `service_cost`, `service_price`, `disbursement_total`, `margin_amount`, `margin_percent`, `markup_percent`, `vat_total`, `total_ttc`, and every line carries `economics` with its own margin and KPI band. The extra-charge `computed` carries `families` (the five totals, pre-summed), `rows`, `port_stay_days`, `due_date` and `status`. Nothing needs computing; it needs drawing.

**2.5 — The extra-charge screen lost half its inputs and all its readouts.** Legacy pulled **BL number, consignee, gross weight + unit** straight from the ops file and displayed three KPI tiles: **Free Time**, **Chargeable days**, and **Timeline Status** flipping to a red `EXCEEDED` when gate-out passes `ATA + (free − 1)`. It also had **per-family filter pills** (All / Storage / Demurrage / Yard Occupancy / Plugging / Detention) that re-totalled on click, a **Charges Summary** modal with the assumptions echoed back (ATA, gate-out, currency, rate), and **Copy for Excel**.

Ours has file, containers, three dates, shipping line, free days, yard trigger, currency — and one empty breakdown pane. The user cannot see *why* a number came out, cannot isolate demurrage from detention, and gets no warning that the file has already blown its free time.

Also gone: **Manual Mode**. Legacy let you simulate for a lead with no ops file yet (`toggleManualMode()`, `:841`) — that is the quoting use case.

**2.6 — Rate configuration is built but not surfaced.** Ours says *"Rates come from the tenant tariff (Settings › Commercial)"*. The storage decision is right — legacy's `saveAdminSettings()` was a lie: it mutated a JS object and popped `alert("Saved locally!")`, so a reload restored 615 XAF/USD forever (`:1146–1149`).

But the backend is already finished and correctly gated — `GET /rates` on `MOD-28 view`, `PUT /rates` on `MOD-70 edit` (viewing the tariff is a pricer's right; changing a rule every simulation depends on is a settings edit, whoever's screen the button sits on). The routes file even records that legacy's *placement* was the good part: one click from the calculation, recalculating live. **Only the frontend is missing** — it currently points the user at Settings instead of opening the editor in context.

---

## 3. Legacy behaviour we must not port (confirm we haven't)

**3.1 — Company identity burned into the code.** `costing-module.php:2213–2223` hardcodes *SMART LOGISTICS AND SERVICES LTD*, the Douala address, phone and ops email; `:2397` the RC and NIU; `:2398` the Afriland account number; `:2318–2338` an MD signature SVG **and the name TIMOTHÉE MASSOMBA**; `margin-simulator-billing.php:1215` pre-fills the quote's bank block the same way. Fatal for a white-label multi-tenant product — all of it belongs in tenant branding + document templates.

**3.2 — Client-side RBAC, with a dead end.** `can(role, action)` is a JS object literal (`costing-module.php:1651–1663`). Worse, `:1717` calls `can(role, 'UNLOCK')` — and `UNLOCK` is not a key in that policy map, so it is **always false**. A costing that reaches `UNLOCK_REQUESTED` can never be unlocked by anyone, and that status appears in neither `statusConfig` nor the filter chips. Dead state, unreachable exit.

**3.3 — Duplicate costings on one ops file.** The "does this file already have a costing?" check calls `list.php?q=<ref>` (`:1061`) — a **period-filtered** (default *this month*), paginated endpoint (`:899`). A costing raised last month is invisible to the check, so you get a second costing on the same file. Ours must key that on the dossier, in the database.

**3.4 — Destructive currency conversion.** `applyConversion()` rewrites every unit cost in place, rounds to 4 dp, and only handles XAF↔foreign (foreign→foreign must round-trip through XAF) (`:1347–1394`). Each toggle loses precision permanently. Ours converts on import at the costing's own stored `exchange_rate_to_xaf` — the rate the approver actually saw. Correct; keep it.

**3.5 — VAT by checkbox, defaulted on.** `state.vatRate = 0.1925` (`:741`) and `$vatDefault = 0.1925` (`api/costing/save.php:71`) — the same number in two languages — applied by a per-line checkbox that **defaults to ticked regardless of the charge's actual VAT treatment**, which the Financial Dictionary had already determined. Our `computeCosting` takes the rate from the line's own tax code and refuses VAT on a débours. Correct; keep it.

**3.6 — Three inconsistent grading scales.** Register badge: `>20% = success` (`:1456`). Per-line KPI: POOR `<10`, FAIR, GOOD `≥20`, EXCEL `≥35` (`:1999–2001`). Global badge: CRITICAL `<10`, LOW `<20`, HEALTHY (`:2172`). One notion of "good margin", three answers. Ours reads one source (`settings commercial.pricing_variance`) — keep it, but *label the bands on screen* so the number is legible.

**3.7 — A pager that lies.** `LIST_STATE.total = rows.length` after a hard `limit=50`, and `renderDashboard` never sends a page number (`:1417–1421`, `:1508`). "Showing 1–50 of 50" forever, and pagination that re-fetches page 1.

**3.8 — "Mandatory Validation" that validates nothing.** The OCR section is headed *3. Cost Lines (Mandatory Validation)* and lines carry a `DOC REQ` badge with a red highlight when an actual is entered without a document reference (`:1265–1272`) — but `submitOCR()` does no check at all before posting. Cosmetic enforcement.

**3.9 — Three parallel cost ledgers.** `costing_line` (budget) · Cost Tracking Master's **hardcoded 15-item matrix** — `Brokerage Fees, Caution, Customs Clearance, Demurrage, …` × cost/advance/balance (`cost-tracking.php:545–561`) · OCR actuals. Three taxonomies, none reconciled, no single truth for "what did this dossier actually cost". Our `cost_tracking` must **not** reproduce the fixed 15-item list — it has to be the dictionary.

---

## 4. Legacy behaviour we lost and should restore

0. **Draft editing and the live charts** — covered in §2.4a / §2.4b above, listed here too because they are the two the screens most visibly miss.
1. **The Financial Dictionary as the pricing contract** — nature, VAT treatment, negotiable, billable, receipt requirement, valid source, justification-mandatory, service applicability. It should drive `is_disbursement`, `tax_code_id`, whether Sales may mark a line up at all, and whether reconciliation demands a document. (§1)
2. **Suggest** — load the standard line set for the service type (Sea Import / Sea Export / Air Import / Air Export / Transit) into an empty costing (`:1896–1975`). Our worksheet opens blank; that is a lot of typing and a lot of forgotten charges.
3. **The SSDC context strip** — client, service, transport ref, route, ETA/ATA, conveyance, weight, packages, commodity, place of delivery, marks — collapsed on both the costing and the margin screen. A pricer prices the *shipment*, not a list of codes.
4. **Named validator before submit** (`validator_employee_id`, a person not a role) — legacy blocked submit without one.
5. **Risk justification on negative margin**, persisted and shown to the approver. (§2.3)
6. **The document itself** — bilingual EN/FR, amount in words, and three signature blocks (Issued / Validated / Approved) each with a verification code. Our tenant-branded template must carry the same evidentiary weight.

---

## 5. Ranked

| # | Fix | Kind | Where |
|---|---|---|---|
| 1 | **`PATCH /:id` on margin + extra-charge simulations**, editable in DRAFT and REJECTED, refused otherwise — mirroring the costing module's existing `edit` gate. Without it REJECTED is a terminal state and every correction spawns a duplicate | API | `margin_simulation` + `extra_charge_simulation` routes/service |
| 2 | Populate + enforce **cost nature / VAT treatment** on the charge catalogue; derive `is_disbursement` and `tax_code_id` from it rather than trusting a stored boolean | data + API | catalogue + `margin_simulation.service.fromCosting` |
| 3 | Trace how `fb7db2f3` got **95.7M at cost with TVA 0.00 and qty collapsed to 1** — the invoice path is bypassing the priced document | API | finance / invoice service |
| 4 | Thread the tenant VAT rate into `simulateCharges`; delete `VAT_RATE` | API | `extra_charge_simulation.rules.js:51,275` |
| 5 | Gate `submit()` — zero/negative margin needs a persisted justification | API | `margin_simulation.service.submit` |
| 6 | Fix the **HT/VAT/TTC** read on saved extra-charge simulations | API | extra-charge repo/read path |
| 7 | **Draw the charts** — Profitability Snapshot + Global Margin band, Budget-vs-Actual + Variance Grade, the extra-charge KPI trio. All the data is already returned; nothing to compute | UI only | commercial + reconciliation screens |
| 8 | Surface per-line margin + KPI band, and wire `priceForMargin` to a target-margin control so the screen proposes a price instead of seeding zero | UI only | margin simulation |
| 9 | Restore the extra-charge inputs and readouts: BL/consignee/weight, family filter pills, summary + Copy for Excel, manual mode; open the **rate editor in context** (`PUT /rates` already exists) | UI only | extra-charge |
| 10 | Restore **Suggest**, the SSDC strip, and the named validator on the costing worksheet | UI + API | costing |

| 6b | **The quotation is the only source of a price.** `PATCH /final-invoices/:id` took arbitrary lines at arbitrary prices with nothing comparing them to the accepted offer — the bypass that let costing cost figures reach `fb7db2f3` in the first place. Now reconciled on unit price and cost nature (quantity stays free); releasable via an audited `pricing_override.reason` shown to the approver. Policy is `finance.invoice_pricing.source` | API | `final_invoice.rules` + service, migration 11742 |

Note the split: **1–6 are contract or data defects**, and #1 blocks day-one use of the commercial screens. **7–9 are drawing what we already return** — no backend work, which makes them the cheapest visible wins in the list.

---

## Not verified

I read the two module trees' rules and services, not the frontend or the invoicing path — so the qty-collapse and cost-as-price on `fb7db2f3` are diagnosed from the screens plus the contract our services expose, not from the code that raised the invoice. I also could not confirm whether `SBX-2026-0001`'s lines came in through `fromCosting` or were entered by hand; if by hand, the fix in §1 moves from the catalogue to the modal's defaults. The `marginpricing/*.php` legacy API internals did not transfer before the device bridge dropped — the workflow semantics above are read off the front end that calls them.
