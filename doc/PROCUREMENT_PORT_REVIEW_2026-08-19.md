# Procurement port — verified review (requests, purchase orders, goods received, supplier invoices)

**Date.** 2026-08-19. **Method.** Read from source only: legacy tree
(`doc/reference/legacy_codebase/`), rebuild (`src/`, `client/src/`, `migrations/tenant/`).
No column or table name guessed; every claim is from the SQL/PHP/TS/JS that uses it.
This review supersedes the status section of `doc/PROCUREMENT_PORT_LEGACY_ANALYSIS.md`,
whose §6/§7 gaps are now **mostly closed** — flagged below where they are not.

---

## 1. Confirmation — the legacy module

The legacy screens live under **Finance & Treasury** (not "Procurement", and there is no
Procurement module in the legacy):

- `administration/view/admin/index.php:688` — menu group `FINANCE & TREASURY`
  contains: **Cash Request**, **Purchase Order**, Proforma Invoice Portal, Final Invoice
  System, Smart Receivables Ledger (SRL), Debt Management.
- The same group is duplicated in the role-scoped `view/{finance,management,operations,sales}/index.php`.

So the user's instinct is confirmed: **the legacy "own" of the PO is Finance & Treasury.**
Purchase requests, goods received and supplier invoices **do not exist in the legacy**
(no screen, no table, no API — verified by grep over `view/` and `api/`). Those three are
new in the rebuild; only **Purchase Order** and **Cash Request** are genuine ports.

---

## 2. What the legacy actually did (front-end + back-end)

The legacy is **monolithic PHP**: one `view/admin/*.php` file holds the HTML, the inline
CSS/JS, the `$_GET['ajax']` action router, and the raw `mysqli` SQL in the same file.
There is no separate FE/BE layer. The relevant pieces:

### 2.1 Purchase Order — `view/admin/purchase-order.php` (≈1 867 ln) + `view/admin/print-po.php` (590 ln)

**Back-end (inline `ajax` handlers + mysqli):**
- Tables `purchase_order_master` + `purchase_order_items` (note the `_master`/`_items`
  names — the rebuild renamed them to `purchase_order`/`purchase_order_item`).
- `po_list` (filters by `po_id`/`supplier_name`/`file_reference`), `po_get`, `po_kpis`.
- `po_approve` — `SELECT … FOR UPDATE` then `UPDATE … status='APPROVED'` (a hard-coded
  `SMART_SECURE_SALT` "security_hash").
- `po_mark_paid` — records partial payment: `amount_paid += …`, derives status
  `PARTIAL`/`PAID` (the crude ancestor of the rebuild's `purchase_order_payment`).
- `updateSupplierStats` — denormalised `supplier_master.cached_payables` /
  `cached_overdue` from `SUM(GREATEST(0, net_payable - amount_paid))`.

**Columns the legacy PO carried** (and the rebuild initially lacked): `currency`,
`delivery_date`, `delivery_location`, `pay_days`, `net_payable`, `amount_paid`,
`air_rate` (withholding), `adv_paid` (advance), `supplier_name` (denormalised snapshot),
`due_date`, `file_reference`.

**Document (`print-po.php`):**
- `numberToWords()` — amount in words, **English only** (the array has SEVEN/EIGHT…, no
  French). OHADA invoices conventionally carry it.
- Totals block: HT / VAT / TTC / air (WHT) / advance / **net payable**.
- Header: PO no., date, delivery date, terms (`N DAYS` or `IMMEDIATE`), delivery location.
- Hard-coded company identity (name / RC / NIU / email literals) + a hard-coded MD
  signature image (`signature-dg.svg`).
- QR via **quickchart.io** (external, payload `VERIFY:SMARTLS|ID|AMT|DATE|HASH`, and
  **nothing verifies it**).
- 5 hard-coded terms & conditions clauses.
- Issuer resolved from `employee_master` via `user_auth.created_by`.

### 2.2 Cash Request — `view/admin/cash-request.php` (≈2 100 ln)

- Table `cash_request_master` (`crm`): `beneficiary`, `category` (`OPS`/`OVH`),
  `remarks`, `amount_total`, `status`.
- `beneficiary` **mandatory**; `OPS` requires an operations-file reference, `OVH` has an
  overhead justification.
- Two-step: `SUBMITTED → VALIDATED` (finance) → `APPROVED_LOCKED` (management).
- `costing_lines_get` — import lines from the `APPROVED_LOCKED` costing.
- On approval it **comma-joined** `operations_file_master.cash_request_id` (a string
  accumulator — the rebuild correctly does not copy this).
- Print `#print-area` = "PAYMENT REQUEST" voucher with a **3-stamp grid**:
  `VALIDATED BY (FINANCE)` / `APPROVED BY (MANAGEMENT)` / `RECEIVED BY`.

### 2.3 Purchase request / goods received / supplier invoice

**Absent in the legacy.** No screens, tables or APIs. (Closest analogue: the PO itself,
and the WMS `grn_inbound` which is a different, WMS-side GRN family.)

---

## 3. What is ALREADY ported (verified current state)

The port landed in two migrations — `10721_procurement_port.sql` and
`10722_close_procurement_gaps.sql` — plus the `src/modules/procurement/*` modules and
`client/src/features/procurement/*.tsx` screens. Confirmed in the tree:

| Legacy behaviour | Rebuild equivalent | Where |
| --- | --- | --- |
| PO header fields (currency/delivery/pay_days/bank+momo/air/adv/terms/remarks/due/net_payable/amount_paid) | columns added | `10721` |
| PO supplier snapshot (name/NIU/address/city at issue) | `purchase_order.supplier_name…`, captured at issue, template prefers snapshot | `10721`, `10722`, `template.service.js` |
| per-line VAT | `purchase_order_item.tax_code_id` + `computeTotals` (HT/VAT/TTC) | `10721`, `purchase_order.rules.js` |
| `po_mark_paid` partial payment | `purchase_order_payment` + `pay` action + `poPayState` (PARTIAL/PAID/CLOSED) | `10722`, `purchase_order.{rules,service}` |
| `po_approve` + unlock | PO unlock loop (`UNLOCK_REQUESTED`/`REQUEST_UNLOCK`/`UNLOCK`/`DENY_UNLOCK`) | `10722`, `purchase_order.rules.js` |
| PO KPIs | KPI tiles on `purchase-orders.tsx` | FE |
| Supplier AP cache | `refreshSupplierCache` recomputes `cached_payables` + `cached_overdue` from `supplier_invoice` | `supplier_invoice.repo.js` |
| Supplier-invoice payment (was an unreachable `PAID`) | `supplier_invoice_payment` + `pay` (Dr 4011 / Cr 521) + `payState` | `10721`, `supplier_invoice.rules.js` |
| SI reversal incl. paid | `reverse` action with contra entries, `REVERSED` reachable | `10722` |
| Three-way match (was 2-way amount only) | `matchThreeWay` now does PR↔PO↔GRN↔invoice: PR total, per-item over-received / over-invoiced, currency | `supplier_invoice.rules.js` |
| GRN lines + partial receipt + document + QA/putaway bridge | `goods_received_line` (ordered/received/condition), `GOODS_RECEIVED` doc capture, `sendToWarehouse` → `wms_inbound` | `10721`, `10722`, `goods_received.service.js` |
| Cash request beneficiary/OPS-OVH/remarks/costing import | `beneficiary`, `category`, `cost_center`, `overhead_justification`, `remarks`; `importCostingLines` (APPROVED_LOCKED gate) | `10721`, `cash_request.{service,routes}` |
| Cash request two-step | `VALIDATED` restored (`validated_by/at`) | `10722` |
| Numbering fixes | `MOD-62→PR`, `MOD-59→FS`, GRN under `MOD-33` (`GRN`), no `SIN` collision | `numbering.service.js` |
| Amount in words | `kit.words`/`kit.wordsBlock` — **FR + EN** (better than legacy's EN-only) | `templates/kit.js` |
| QR | in-house SHA-256 + `praxis://verify` (legacy's quickchart URL verified nothing) | `pdf.service.js` |
| PO totals (WHT/advance/net payable) on the document | `PURCHASE_ORDER` template + loader | `registry.js`, `template.service.js` |
| Terms & conditions | configurable `k.termsBlock(cfg)` (legacy was 5 hard-coded clauses) | `kit.js` |

The rebuild is already **strictly better** than the legacy on company branding
(per-tenant `corporate_entity` vs hard-coded literals), QR (verifiable vs dead URL),
amount-in-words (FR/EN vs EN), and terms (config vs hard-code).

---

## 4. What is STILL missing / worth improving (the "more dynamic / better documents" ask)

Verified against the current tree — these do **not** already exist:

### 4.1 Cash-request document lost its 3-signature grid (the clearest gap)

Legacy print: "PAYMENT REQUEST" with `VALIDATED BY (FINANCE)` / `APPROVED BY
(MANAGEMENT)` / `RECEIVED BY`. The rebuild `CASH_REQUEST` template renders only a single
`k.signatureBlock(cfg)` (one "For the company" line). The two-step approval chain now
exists as *data* (`validated_by/at`, approver), but the printed voucher does not show
the validation/approval/receipt stamps.

**Improvement:** add a `threeStamp` block to `kit.js` (VALIDATED / APPROVED / RECEIVED)
and drive it from the cash request's `validated_by`, `approved_by` (approver), and
receipt state, wired into the `CASH_REQUEST` template.

### 4.2 Signature blocks are static config, not the actual document actors (dynamic)

`k.signatureBlock(cfg)` renders `cfg.signature.name` / `.title` — a single configured
name, the **same on every document**. The legacy resolved the real issuer from
`user_auth → employee_master`. The rebuild already *has* the actor columns and the join
pattern (`purchase_request` loader resolves `requester` via `app_user.full_name`), but the
PO/SI/GRN loaders do **not** resolve `issuer_id` / `approver_id` into the signature block.

**Improvement:** resolve per-document signatories — PO `issuer_id`+`approver_id`,
cash request `requested_by`+`validated_by`+approver, GRN `received_by` — through
`app_user → employee_master` (`signatory_name`) and pass them into `signatureBlock`,
falling back to `cfg.signature` only when the row has no actor. This makes every document
"dynamic" — it names who actually issued/approved it — with the config as the default,
not the fact.

### 4.3 Purchase-order document does not yet resolve the issuer (companion to 4.2)

`print-po.php` printed the issuing employee's name. The rebuild `PURCHASE_ORDER` loader
resolves the **supplier** snapshot fully but leaves the issuer to `cfg.signature`.
Concrete: extend the `PURCHASE_ORDER` loader (and the SI loader) to join
`app_user`/`employee_master` on `issuer_id`/`approver_id` and feed the signature block.

### 4.4 GRN "QA sign-off" field is declared but thin

The `GOODS_RECEIVED` registry entry lists `fields: ["received lines", "condition",
"note"]`; the WMS `GRN` entry lists `"QA sign-off"`. The procurement GRN records
`received_by` and per-line `condition` but has **no QA sign-off field** on the document
itself (the WMS inbound has QA HOLD). If "QA sign-off" is wanted on the procurement GRN
print, add a signatory line bound to the receiving/QA actor — small, and pairs with 4.2.

### 4.5 Legacy English-only numberToWords → keep FR/EN, but extend the currency handling

`kit.words` already beats the legacy, but it renders cents as `…/100` only. For
OHADA compliance the words block should follow the currency's minor-unit convention
(e.g. XAF is zero-decimal). Minor: `wordsBlock` should take the currency's minor units,
not assume `/100`. (Check `kit.words` before scheduling — it may already be XAF-aware.)

---

## 5. Do NOT copy (deliberate, from the legacy)

1. Hard-coded company identity / RC / NIU / email literals and the MD signature image.
2. `SMART_SECURE_SALT` security-hash scheme (vault hash + verify token replaces it).
3. The `operations_file_master.cash_request_id` **comma-join accumulator** — the
   rebuild's `cash_request_payment` + derived `disbursed_amount` is correct.
4. Date-based read-then-write numbering (`SLAS-PR-{Ymd}-{seq}`) — `doc_sequence` upsert
   is the fix.
5. `calculated_status`-style money-derived statuses stored as data (rebuild derives
   `payState`/`poPayState` at read; keep that).
6. quickchart.io QR (dead-end URL).

---

## 6. Bottom line

The procurement family is **essentially fully ported and already better than the
legacy** on correctness, numbering, three-way match, and document branding/QR/words.
The remaining work is **document polish, not data model**:

1. **Cash-request 3-signature grid** (VALIDATED/APPROVED/RECEIVED) — restore the legacy
   voucher's stamp layout.
2. **Dynamic per-document signatories** — resolve `issuer_id`/`approver_id`/
   `validated_by`/`received_by` through `app_user → employee_master` and feed
   `signatureBlock`, instead of one static `cfg.signature` name on every document.
3. **GRN QA sign-off** if the printed GRN should carry it.
4. **Minor-unit-aware amount-in-words** for zero-decimal currencies (XAF).

Everything else the legacy had is already in the rebuild, done better.
