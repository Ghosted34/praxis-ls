# Currency hardcoding sweep — report

**Date.** 2026-08-19. **Method.** grep over the live tree (`src/`, `client/src/`,
`migrations/`, `scripts/`, `packages/`), excluding the read-only legacy tree
(`doc/reference/`) and tests. Counts are exact as of this run.

**Question asked:** where is currency still hardcoded as text/labels, given that
currency settings *already exist* — and what would break if the tenant changes
base currency away from XAF.

**Answer in one line:** currency *settings* exist and are editable, but the
*money display* and several *document loaders* still hardcode `XAF` as both the
fallback code and the on-screen label, and the configured `symbol` (e.g. "FCFA")
is stored but never rendered. Changing the base currency would leave stale "XAF"
labels and wrong document currencies in a dozen places.

---

## 1. What already exists (the settings)

- `currency` table (`0342`): `code`, `name`, `symbol`, `is_base`, `decimals`,
  `is_active` — seeded `('XAF','CFA Franc BEAC','FCFA',true,0)` (`9005`, `9030`).
- Per-entity default currency: `corporate_entity.default_currency`,
  `client_master.default_currency`, `supplier_master.default_currency`
  (`0511`, `0515`) — all editable in the UI.
- A settings screen `client/src/features/settings/currencies.tsx` (with a `Base`
  badge), and `entity-360.tsx` / `corporate-entities.tsx` edit `default_currency`.

So the *settings* are genuinely in place. The problem is the *consumers* below
ignore them.

## 2. The money formatter hardcodes the code, not the symbol

- `client/src/lib/format.ts` `money()` — default `currency = "XAF"`, and it
  appends the raw **code** (`… ${cur}`), never `currency.symbol`. The configured
  symbol "FCFA" / name "CFA Franc BEAC" is never shown anywhere in the UI
  (grep for `.symbol` in display paths → only the admin CRUD reads/writes it).
- `src/services/documents/templates/kit.js` `money(n, ccy = "XAF")` — same
  default, same code-not-symbol behaviour.
- `src/services/pdf.templates.js:78` and `template.service.js:196` — same
  `ccy || "XAF"` + code append.

**Consequence.** If a tenant sets base currency USD, amounts correctly show
"… USD" *when the row carries the currency*, but any row without one falls back
to "XAF", and no document ever prints "FCFA" (the symbol the tenant configured).

## 3. Document loaders hardcode `currency: "XAF"` outright

`src/modules/documents/template/template.service.js` returns `currency: "XAF"`
for every document whose underlying table has **no currency column**:

- purchase request (`:585`), cash request (`:626`), regie advance (`:635`),
  work order (`:648`), SOP (`:675`), WMS GRN (`:738`), cycle count (`:796`),
  trip sheet (`:807`), payslip (`:835`), delivery note (`:259`), quotation
  fallback (`:425`), proforma (`:443`), proposal (`:462`).

These are **not** "fallbacks" — they ignore `corporate_entity.default_currency`
entirely. A tenant on USD still prints a XAF cash request, payslip, trip sheet,
etc. This is the highest-value fix: these loaders should resolve the document's
entity currency (or the entity's `default_currency`) instead of a literal.

(The `sampleData` blocks in `registry.js` are preview fixtures only — cosmetic,
not a bug.)

## 4. UI labels hardcode "XAF" as prose

Hardcoded strings that read wrong when the base currency changes (a sample, not
exhaustive — ~236 XAF mentions in the client):

- `client/src/features/ai-control/pages.tsx` — "Monthly cap (XAF)", "Soft cap
  (XAF)", "Hard cap (XAF)", "Cost · XAF", `money(r.cost_xaf)`.
- `client/src/features/finance/hub.tsx:132,205-207` — "Smart receivables ledger
  · XAF", "XAF total".
- `client/src/features/finance/asset-forms.tsx:128,139,383` — "Acquisition cost
  (XAF)", "Residual value (XAF)", "Proceeds (XAF)".
- `client/src/features/commercial/extra-charge-simulations.tsx:76` — dropdown
  option hardcoded `{ value: "XAF", label: "XAF — CFA franc" }` (this one is a
  real currency *option*, should come from `currency` list).
- `client/src/features/commercial/{margin-simulations,quotation-forms}.tsx` —
  `useState("XAF")`, `placeholder={tr("XAF")}`.
- `client/src/features/dashboard/use-control-tower.ts` — `currency: str(...) || "XAF"`.

## 5. `*_xaf` column naming (data-model coupling, not a display bug)

38 columns in `migrations/` and 84 field references in `client/src/` are named
`*_xaf` — `monthly_cap_xaf`, `spent_xaf`, `soft_cap_xaf`, `hard_cap_xaf`,
`cost_xaf`, `declared_value_xaf`, `revenue_currency`, `share_capital_currency`,
etc. These *store a value in the base currency* and are named after XAF. They
still *work* if the base changes (the value is just a number), but the name
becomes misleading and the next developer will assume XAF. Low urgency, but a
rename to `*_base`/`*_home` (or dropping the suffix) is the clean end-state.

## 6. Safe defaults (not bugs — leave alone)

- 24 `DEFAULT 'XAF'` in `migrations/` DDL and 51 `|| "XAF"` fallbacks in `src/`
  where a nullable currency resolves to the base. These only fire when no
  currency is present; XAF is the declared base, so they are correct today.
- `supplier_invoice.rules.js` `matchThreeWay` currency comparison and
  `transit_order.service.js` FX path both treat missing currency as XAF — also
  correct base-currency defaults.

---

## Recommended fixes (in priority order)

1. **Document loaders (§3)** — resolve the document currency from the entity's
   `default_currency` (fallback XAF) instead of the literal `"XAF"`. One shared
   helper; touches the ~13 loader sites in `template.service.js`. This is the
   only place a *wrong currency* is printed on a real document.
2. **Money formatter (§2)** — keep the code as the source of truth but resolve
   the display **symbol** (and decimals) from `currency` when available, falling
   back to the code. Currently the seeded symbol "FCFA" is dead data.
3. **UI labels (§4)** — replace hardcoded "(XAF)" labels with the base-currency
   code/symbol resolved at runtime; make the hardcoded currency *dropdowns*
   (`extra-charge-simulations`) read from the `currency` list.
4. **`*_xaf` rename (§5)** — rename to `*_base`/`*_home` in a follow-up
   migration; pure naming, no behaviour change, but prevents future confusion.

None of §2–§5 is a data-loss bug — they are *display/consistency* issues. §3 is
the one that produces a materially wrong document today if the base currency is
ever changed.
