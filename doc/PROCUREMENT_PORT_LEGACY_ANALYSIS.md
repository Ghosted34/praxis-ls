# Legacy → Praxis LS port analysis: requests, purchase orders, goods received, supplier invoices

**Scope.** The procurement family — purchase requests, purchase orders, goods received and
supplier invoices — plus the legacy screens they came from (which live under **Finance &
Treasury**, confirmed below) and the cash-request/payment-voucher workflow that shared the
same legacy area. Every claim below was read from source, either the legacy tree
(`doc/reference/legacy_codebase/`) or the rebuild (`src/`, `client/src/`, `migrations/tenant/`).
Nothing is inferred from a filename alone; column names were taken from the SQL/PHP that
uses them, not guessed.

**Method.** Same as `doc/LEGACY_COSTING_SET_NAMING_MAP.md`: match legacy screens → legacy
tables/endpoints → new module/table, follow the SQL, record the deltas, and only then decide
what to port. This document adds the **document-generation comparison**, because the legacy
print paths (`print-po.php`, `cash-request.php` `#print-area`) are where the richest behaviour
lives and where the rebuild's templates still have gaps.

**Date.** 2026-08-18. Legacy tree is read-only reference (`doc/reference/README.md`).

---

## 0. Build status (same day — every gap in §6 and §7 was implemented)

All items in the port sequence below were built in this session, on branch
`arena/01a01627-praxis-ls`, with tests:

| # | Work | Where | Verified by |
| - | ---- | ----- | ----------- |
| 1 | Numbering fixes — `MOD-62 → PR`, `MOD-59 → FS` (statements), GRN allocates under `MOD-33` (`GRN`), never the SI `SIN` counter | `src/services/documents/numbering.service.js`, `goods_received.events.js` | `tests/unit/numbering.test.js` (3 new cases) |
| 2 | PO header enrichment — currency, delivery date/location, payment means + days, bank/MoMo block, `air_rate`, `adv_paid`, terms, remarks, `due_on`, `total_ht/vat`, `net_payable`, `amount_paid`, `entity_id`, supplier name/NIU snapshot at issue; per-line VAT via the purchase posting rule | `migrations/tenant/10720_procurement_port.sql`, `purchase_order/{rules,repo,service,validator,controller}.js`, PO template + loader, PO form | `tests/unit/procurement.test.js` (`computeTotals`/`netPayable`/`dueOn`); `tests/db/query-columns.test.js` |
| 3 | AP payment flow — `supplier_invoice_payment`, `pay` route/action, Dr 4011 / Cr treasury posting, `PAID` reachable, `amount_paid` derived, supplier `cached_payables` refreshed | `10720`, `supplier_invoice/{rules,repo,service,validator,controller,routes,events,ai}.js`, SI screen "Record payment" | `tests/unit/procurement.test.js` (`buildPaymentLines`, `payState`); `tests/unit/ai-readiness.test.js` |
| 4 | GRN lines + document — `goods_received_line`, doc number + capture as `GOODS_RECEIVED`, lines in form, native document page | `10720`, `goods_received/*`, `document_vault.types.js`, registry + loader, GRN screen | `tests/unit/ai-readiness.test.js`; `tests/db/query-columns.test.js` |
| 5 | True three-way match — PR total, per-item quantities (over-received / over-invoiced), currency | `supplier_invoice.rules.js` (`matchThreeWay`), `service.computeMatch`, repo `poFacts/poLineQty/prTotal` | `tests/unit/procurement.test.js` (5 new cases) |
| 6 | Cash request legacy UX — beneficiary, OPS/OVH context, remarks, approved-costing line import | `10720`, `cash_request/{service,repo,validator,controller,routes,ai}.js`, cash-request form + "Import costing" | `tests/unit/cash-request-partial-disbursement.test.js` still green; `ai-readiness` |
| 7 | Kit amount-in-words (FR/EN) + wired into PO / supplier invoice / final invoice; cash-request voucher fields (requester, beneficiary, category, remarks) | `src/services/documents/templates/{kit,registry}.js`, `template.service.js` loaders | `tests/unit/` full suite; client `tsc` + `vitest` (1 517 tests) |

Validation run this session: `eslint` root clean of new warnings, `jest tests/unit`
252/252 suites, `tests/db/*` (query-columns, migration gates) green,
`client tsc -b` clean, `vitest run` 97/97 files. `10720` is additive and passes the
idempotency / reversibility / destructive-DDL / column gates.

### Round 2 — every open gap from the follow-up review closed (same day, `10721`)

After the first build the remaining gaps were reviewed and four product decisions
were asked: restore two-step cash approval, SI reversal incl. paid, PO-level
payment, full WMS GRN bridge. All four were answered "yes", and the rest were
unambiguous. All landed in migration `10721_close_procurement_gaps.sql`:

| Gap | What shipped | Where |
| --- | ------------ | ----- |
| PO unlock (mirrors costing 10718) | `UNLOCK_REQUESTED` status, `REQUEST_UNLOCK/UNLOCK/DENY_UNLOCK`, reason + audit columns, guard refuses once a supplier invoice against the PO reached the ledger | `purchase_order.{rules,service,routes,validator,ai}.js`, PO screen |
| PO payment (legacy `po_mark_paid`) | `purchase_order_payment`, `pay` action (no GL post — supplier invoice is the accounting path), `PARTIAL`/`PAID` derived by `poPayState`, fully-paid RECEIVED → CLOSED | `purchase_order.*`, PO screen "Record payment" |
| Cash request two-step (legacy VALIDATED) | `VALIDATED` restored, `validated_by/at`, second approval chain on new `disbursal.validated` event (default MANAGEMENT), chain completion advances one leg | `10721` seed, `cash_request.{rules,service,routes,validator,ai}.js`, cash screen |
| SI reversal incl. paid | `reverse` action: contra entries for the posting AND each payment, `REVERSED` finally writable, `reversed_at/by/reason` | `supplier_invoice.{service,validator,controller,routes,events,ai}.js`, SI screen |
| Supplier cache overdue half | `supplier_master.cached_overdue` maintained in `refreshSupplierCache` (due_on < today, posted/paid) | `10721`, `supplier_invoice.repo.js` |
| GRN entity default | GRN numbering falls back to the PO's entity — a GRN can no longer print a truncated UUID | `goods_received.service.js`, GRN form |
| Draft-PO edit UI | `PATCH` reached from the screen: Edit on DRAFT rows, form prefills header + items | `purchase-orders.tsx` |
| Full supplier snapshot | address/city captured at issue; template loader prefers the snapshot | `10721`, PO service + loader |
| Costing picker on cash request | costing select, auto-links the dossier's APPROVED_LOCKED costing → "Import costing" now works | cash-request form |
| Auto-PDF on issue | `enqueueDocument` wired: PO on issue, SI on post, GRN on record, PR + cash request on submit | five controllers |
| WMS bridge (full) | `POST /goods-received/:id/send-to-warehouse` creates the WMS inbound (QA HOLD) with the received lines, links `wms_inbound_id`; entity default uses the PO's | `10721`, `goods_received.{service,routes,validator,ai}.js`, GRN screen |

**Validation round 2:** `jest tests/unit` 253/253 suites (incl. new
`procurement-gaps.test.js` — two-step, PO pay/unlock, SI reversal), migration
idempotency / reversibility / destructive-DDL / query-column gates green,
`client tsc -b` clean, `vitest run` 97/97 files, eslint clean of new warnings.

**Still requires the deploy step:** applying `10720` + `10721` to tenant schemas
(`scripts/db/migrate-tenants.js`) — no Postgres exists in this sandbox — and the
DB-backed integration test for `pay`/`reverse` (the 41 integration tests are
DB-skipped here; the rules are unit-tested).

---

## 1. Confirmation: where the legacy actually kept these screens

The user asked to confirm the legacy module name. It is **Finance & Treasury** — and the
menu is explicit about it:

- `administration/view/admin/index.php:688` — menu group **`FINANCE & TREASURY`**
  (`<i class="fa-solid fa-building-columns category-icon"></i> FINANCE & TREASURY`) contains:
  **Cash Request** (`cash-request.php:693`), **Purchase Order** (`purchase-order.php:694`),
  Proforma Invoice Portal, Final Invoice System, Smart Receivables Ledger (SRL), Debt Management.
- The Finance role has its own copy of the same menu (`administration/view/finance/index.php:614-625`),
  again with Cash Request + Purchase Order under the Finance & Treasury group.
- `grep -rn "FINANCE & TREASURY" administration/ --include="*.php"` → the exact string appears
  in the admin index and in the role-scoped copies of it; no screen calls itself "Procurement".

**Consequence.** In the legacy there is no Procurement module. Purchase Order and Cash
Request are **finance screens**. Purchase requests, goods received and supplier invoices as
modules **do not exist in the legacy** (see §3). The rebuild's `procurement/` module
(`MOD-60/61/62`) is therefore *not a straight port of one legacy screen* — it is the
procurement side of what the legacy did inside Finance & Treasury, plus genuinely new work.

---

## 2. The naming map, in one table

| New module (`src/modules/procurement/`) | MOD     | Legacy screen (the source of truth)                                  | Legacy API                                | Legacy tables                                                        | New tables |
| --------------------------------------- | ------- | ------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------- | ---------- |
| `purchase_request`                      | MOD-62  | **none — no legacy screen exists** (closest: cash-request's OVH flow) | none                                     | —                                                                     | `purchase_request`, `purchase_request_line` |
| `purchase_order`                        | MOD-60  | `view/admin/purchase-order.php` (1 867 ln) + `view/admin/print-po.php` (590 ln); 9 role copies | none — SQL + ajax inline in the view      | `purchase_order_master`, `purchase_order_items`                      | `purchase_order`, `purchase_order_item` |
| `goods_received`                        | MOD-61  | **none — no legacy GRN screen exists** (nearest: `delivery-note.php`, an outbound doc) | none                                     | —                                                                     | `goods_received_note`, `grn_line` (+ WMS `grn_inbound`) |
| `supplier_invoice`                      | MOD-61  | **no legacy module** — vendor invoice existed only as a document *type*: transit-order "Submitted Documents" checkbox `INVOICE` (`view/admin/transit-order.php:602`) and vault category `INVOICE` ("Supplier Invoice", `view/admin/documents-vault.php:904`) | none                                     | — (only `supplier_documents`/`supplier_document` attachment tables)   | `supplier_invoice`, `supplier_invoice_line` |
| (legacy cash request → new) `costing/cash_request` | MOD-49 | `view/admin/cash-request.php` (3 218 ln, the largest legacy finance screen) | none — SQL + ajax inline | `cash_request_master`, `cash_request_lines`, `cash_request_payments` | `cash_request`, `cash_request_line`, `cash_request_payment` (+ `regie_advance`) |

**Copy proliferation, same as the costing set.** `purchase-order.php` exists in 9 copies
(admin, finance, management, `archive/*`, `smart-logistics/...`); `print-po.php` in 3;
`supplier-master-registry.php` in 12; `cash-request.php` in 16 (14 distinct hashes —
`doc/LEGACY_COSTING_SET_NAMING_MAP.md` §5). `view/admin/` is the largest/latest for PO;
`view/finance/cash-request.php` (132 914 B) is 266 bytes larger than admin — the finance
copy is canonical for cash request. The admin and finance PO copies are byte-different but
have **identical ajax handler sets** (diff of `ajax === '...'` strings: exit 0, no diff).

---

## 3. What the legacy did — front end

### 3.1 Purchase order screen (`purchase-order.php`)

One PHP file does page + API. The front end calls `purchase-order.php?ajax=...` with
`fetch` and renders a Bootstrap dashboard: KPI tiles (pending / approved / overdue / total
payables), a filterable list, and a large modal form. The form captures **all of this**:

- supplier (search picker over `supplier_master`, `suppliers_list`), ops file link
  (`ops_files_list` / `ops_file_get`, which back-fills the client)
- `expense_category` (OPERATIONS / OVERHEAD), `delivery_location`, `delivery_date`
- `currency` (free `char(3)`, default XAF — no FX, no validation)
- `payment_means` (CASH / BANK_TRANSFER / CHEQUE / MOBILE_MONEY) with `pay_days` and a
  **full payment block**: `bank_name`, `account_number`, `account_name`,
  `momo_network`, `momo_number` (toggle logic `togglePayFields()`)
- `air_rate` (**withholding %**, "AIR" — the Acompte sur Impôt on the PO), `adv_paid`
  (advance already paid)
- line items from the **financial dictionary** picker (`fd_search` over
  `financial_dictionary` with `name_en`, `name_fr`, `vat_treatment`), each line carrying
  `description`, `qty`, `unit_price`, `vat_rate`; the client sends back `total_ht`,
  `total_vat`, `total_ttc`, `net_payable`
- `terms` (free text) and `remarks` ("Prints on PDF")
- status lifecycle DRAFT → PENDING → APPROVED → PARTIAL → PAID, plus
  **request-unlock / unlock** (`po_request_unlock` with a reason, `po_unlock`)

Buttons are role-conditional: only ADMIN/FINANCE see Approve and Mark Paid; only
ADMIN/MANAGEMENT see Unlock.

### 3.2 PO print (`print-po.php`)

A standalone A4 print page (`window.print()` on load) with hand-built CSS:
- **hard-coded company block** — "SMART LOGISTICS AND SERVICES LTD / 1030, Avenue Douala
  Manga Bell, Bali / Po Box 5120, Douala, Cameroon / 00237 233 420 281 |
  procurement@smartls.cm" and legal line "RC/DLA/2021/B/2060 | NIU: M042116033580Q"
  (`print-po.php:164-169`)
- supplier card: name, address, **NIU, RCCM, tel, bank, account** (`sup_*` joins)
- PO details: number, date, **delivery date, terms (pay_days + method), place of delivery**
- items table **paginated 10 rows/page** with padded ruled rows
- totals: HT, VAT, **Grand total TTC, Withholding (air_rate%)**, **Less Advance**,
  **Net Payable** — `netPayable = totalTTC − airAmt − advPaid` (`print-po.php:124-133`)
- **amount in words** (`numberToWords()`, `print-po.php:34-82`)
- **QR code via QuickChart.io** with payload
  `VERIFY:SMARTLS|ID:<po>|AMT:<total>|DATE:<date>|HASH:<first 10 of security_hash>` — an
  external third-party API, and **no verification endpoint backs it** (nothing server-side
  resolves the QR)
- issuer/approver **stamp blocks** with `issuer_auth_id` (`ISS-…`) / `approver_auth_id`
  (`APP-…`) and the MD signature **image hard-coded** (`assets/img/signature-dg.svg`),
  "PENDING" when not approved
- hard-coded **terms & conditions** array (`print-po.php:171-176`): Scope & Acceptance,
  Delivery & Quality, Pricing & Taxes, Invoicing, Payment & Law

### 3.3 Cash request screen (`cash-request.php`)

Same single-file pattern. Front end: KPI tiles (validation/approval/disburse counts,
total disbursed), list with **row-level visibility** (non-ADMIN/FINANCE/MANAGEMENT see only
their own — `pr_list` injects `AND crm.created_by = ?`), big modal form:

- `category` OPS / OVH. OPS **requires** an ops file and back-fills client + `sea_bl`;
  OVH requires `cost_center` + `overhead_justification`
- `beneficiary` (required), `remarks`
- `disburse_method` CASH / BANK / CHEQUE / MOMO with **method-specific validation**
  (BANK needs name+IBAN+holder; MOMO needs number+network; CHEQUE needs number)
- lines **imported from the approved costing** (`costing_lines_get` — refuses unless the
  costing is `APPROVED_LOCKED`), with per-line `is_imported` + `justification_required`
  flags and VAT normalisation (0.1925 stored as decimal → shown as 19.25 %)
- `pr_save` **generates the PR number in PHP**: `SLAS-PR-{Ymd}-{seq:04d}` (daily reset,
  read-modify-write on the existing max — racy)
- transitions: SUBMIT (creator or ADMIN/MANAGEMENT override) → VALIDATE (**finance only**) →
  APPROVE (MANAGEMENT/ADMIN only) → DISBURSE (finance only, with amount + note, guards
  over-payment) → status `PARTIALLY_DISBURSED` / `DISBURSED`; REJECT from
  DRAFT/SUBMITTED/VALIDATED
- on APPROVE the screen **writes back into `operations_file_master`**: appends the PR id to a
  **comma-joined string** `cash_request_id` and sums `cash_request_amount` (denormalised,
  stringly-typed accumulation)

### 3.4 Print for cash request

A hidden `#print-area` div, populated by `quickPrint()` then `window.print()`:
- hard-coded "SMART LOGISTICS AND SERVICES LTD / … finance@smartls.cm" and footer
  "RC/DLA/2021/B/2060 | NIU: M0421160335800"
- title **"PAYMENT REQUEST — Internal Finance Voucher"**, requisitioner grid (name, employee
  id, dept, job title), meta grid (PR date/number, costing ref, file ref, BL, beneficiary,
  total)
- line table CODE / DESCRIPTION / QTY / UNIT PRICE / TOTAL EX / VAT / TOTAL INC
- **signature grid: VALIDATED BY (FINANCE) / APPROVED BY (MANAGEMENT) / RECEIVED BY** —
  validated stamp built in JS with a pseudo-hash, MD signature **image hard-coded**
  (`signature-dg.webp`)

### 3.5 Suppliers (`supplier-master-registry.php` + `api/suppliers/*`)

The only one of the family with a **real API layer** (`doc_add.php`, `get.php`, `list.php`,
`save.php`). Fields: name, `supplier_type`, contact, `niu`, `rccm`, `address`, `country`,
`payment_method`, `payment_terms_days`, bank + **mobile-money block**, `status`, `rating`;
documents with `storage_mode` **DIGITAL / PHYSICAL** and a `physical_ref` for paper files
(`doc_add.php`). Two quirks worth knowing: the insert uses table `supplier_document`
(singular) while the read uses `supplier_documents` (plural) — a real legacy table-name bug;
and `cached_payables`/`cached_overdue` are maintained by the **PO screen**
(`updateSupplierStats()` runs after every approve/mark-paid).

### 3.6 What the legacy did NOT have (front end or back end)

`grep -rn "goods received\|goods_receiv\|GRN" administration/ --include="*.php"` → **zero
hits** in any screen or API (only the word "GRN" inside a PDF filename under `uploads/`).
`grep -rni "purchase request\|purchase_request" administration/ --include="*.php"` → zero
hits (all "request" hits are cash requests). Supplier invoice → only the two document-type
tags listed in §2. There is **no three-way match, no goods receipt, no AP module, no PO
payment ledger** in the legacy — the "supplier invoice" was a paper attachment and a vault
category, and PO payment was a manual `po_mark_paid` update on the PO row.

---

## 4. What the legacy did — back end

All of it is inline SQL in the views (mysqli prepared statements); the "API" is the view
itself switching on `$_GET['ajax']`. Business logic worth naming:

| Behaviour | Legacy implementation | Location |
| --------- | --------------------- | -------- |
| PO numbering | **non-sequential, unguessable**: `'SLAS-PO-' . date('YmdHis') . '-' . bin2hex(random_bytes(3))` | `purchase-order.php` `po_save` |
| PO approval security | `issuer_auth_id`/`approver_auth_id` = `ISS-`/`APP-` + sha256-prefix; `security_hash` = sha256(id+amount+created_at+now+**`'SMART_SECURE_SALT'` hard-coded in source**) | `po_approve` |
| PO payment | `po_mark_paid` — locks row, adds to `amount_paid`, status PARTIAL/PAID, updates supplier cache | `po_mark_paid` |
| Unlock workflow | `po_request_unlock` (reason) → `po_unlock` (ADMIN/MANAGEMENT) resets to DRAFT | `po_unlock` |
| Supplier payables cache | `updateSupplierStats` — `SUM(GREATEST(0, net_payable − amount_paid))` for payables and overdue | top of `purchase-order.php` |
| WHT on PO | `air_rate` % applied to **HT**, `net_payable = total_ttc − air − advance` | `print-po.php` |
| Cash-request numbering | `SLAS-PR-{Ymd}-{seq}` — **daily** reset, read-then-write (race) | `pr_save` |
| Cash-request approval side-effect | appends PR id to comma-joined `cash_request_id` + sums `cash_request_amount` on `operations_file_master` | `pr_transition` APPROVE |
| Cash-request disbursement | `pr_disburse` — one-to-many `cash_request_payments`, `disbursed_total` accumulated, PARTIALLY_DISBURSED/DISBURSED, over-payment guard | `pr_disburse` |
| Costing-gated line import | `costing_lines_get` — only when linked costing is `APPROVED_LOCKED` | `costing_lines_get` |

---

## 5. What the rebuild already has (checked, so nothing below re-suggests it)

These exist and work; the port must build on them, not duplicate them:

- **Backend modules** — `src/modules/procurement/{purchase_request,purchase_order,goods_received,supplier_invoice}/` (989 LOC total, each with repo/service/rules/controller/routes/validator/events/ai) plus `src/modules/costing/{cash_request,regie}/` for the legacy cash-request lineage.
- **Lifecycles** — PR `DRAFT→SUBMITTED→APPROVED→ORDERED`; PO `DRAFT→ISSUED_LOCKED→APPROVED_LOCKED→RECEIVED→CLOSED`; GRN records receipt and advances the PO to `RECEIVED`; SI `DRAFT→MATCHED→POSTED_LOCKED` with a real three-way check (`matchThreeWay`) and GL posting (Dr 6xx + 4452 / Cr 4011 + 4471 WHT, `supplier_invoice.rules.js`).
- **Workflow engine** — PR/PO/SI/cash request all open tenant-configurable approval chains (`pr.submitted` 0491, `po.issued`, `supplier_invoice.matched`) with `assertNoPendingChain` and `onApproved` handlers.
- **Numbering + capture** — per-module/per-year/per-entity `doc_sequence` (`numbering.service.js`), `documents.capture` on issue/submit/match.
- **Compliance gates** — `assertSupplierUsable` + `compliance.assertAllowed` hard-block on PO create/issue and SI create/post; proof obligations on cash-request lines.
- **Document templates + Studio** — registry entries for `PURCHASE_ORDER`, `SUPPLIER_INVOICE`, `PURCHASE_REQUEST`, `CASH_REQUEST`, `REGIE_ADVANCE`, `GRN`, `DELIVERY_NOTE`, `TRANSIT_ORDER` with real-record loaders (`template.service.js`), per-tenant beautify config, preview + Puppeteer PDF → vault with SHA-256 + QR (`praxis://verify`) — the rebuild's QR is **in-house and resolvable**, which the legacy QuickChart QR never was.
- **Front end** — React screens `client/src/features/procurement/{purchase-requests,purchase-orders,goods-received,supplier-invoices}.tsx` + costing cash-request screens; `<DocButton>` opens the native document page for PO/PR/SI.
- **Cash request partial disbursement** — `PARTIALLY_DISBURSED`, `disbursed_amount`, per-payment `regie_advance_id` (`10719_cash_request_partial_disbursement.sql`) — this already fixes the legacy's most fragile state, and its migration comment explicitly refuses to add a state nothing can write.

**Deliberately NOT present (verified, do not build without a decision):** PO `VALIDATED`
state (legacy had it; `LEGACY_COSTING_SET_NAMING_MAP.md` §4.2 flags it), PO unlock workflow
(`grep -rln -i unlock src/modules/` → only account lockout), legacy `calculated_status`
(see `doc/COST_TRACKING_LEGACY_COMPARISON.md` §5), legacy comma-joined denormalisation.

---

## 6. Gaps — what the legacy had that the rebuild is missing (or does differently)

Prioritised. Each item names the evidence; none re-suggests anything in §5.

### 6.1 PO header is thin: payment terms, delivery, WHT, advance, net payable are gone (HIGH)

Legacy PO carried `payment_means`, `pay_days`, `bank_name`, `account_number`,
`account_name`, `momo_network`, `momo_number`, `delivery_date`, `delivery_location`,
`air_rate` (WHT %), `adv_paid`, `terms`, `due_date`, `net_payable`, `amount_paid`, `remarks`
(`purchase_order_master` INSERT, `po_save`). The rebuild's `purchase_order`
(`0320_costing_procurement.sql:55`) has only `supplier_id, dossier_id, doc_number,
expense_category, total_ttc, security_hash, issuer_id, approver_id, status`. The FE form
(`purchase-orders.tsx`) exposes only supplier, dossier, category, items. Consequences:

- **No withholding and no advance on a PO** — the exact fields the legacy printed as
  "Withholding (air_rate%) / Less Advance / Net Payable" (the rebuild's SI handles WHT on the
  invoice side, but the legacy applied WHT *at the PO*, which is what the supplier's copy of
  the document showed).
- **No payment terms on the document** — the PO template meta only renders date + delivery;
  the loader leaves `delivery_on` unset (`template.service.js` PO loader) so even the one
  date shows blank.
- **No paid/partial tracking on the PO** — legacy had `po_mark_paid` and PARTIAL/PAID
  statuses; the rebuild's PO terminal states are RECEIVED→CLOSED and payment lives nowhere
  on the PO. The supplier 360 drill-ins read `cached_payables`, but nothing writes it (§6.3).

**Port shape:** additive columns on `purchase_order` (`currency`, `delivery_on`,
`delivery_location`, `payment_means`, `pay_days`, `air_rate`, `adv_paid`, `terms`,
`due_on`, `net_payable`, `amount_paid` + bank/momo jsonb like `supplier_master.bank_block`),
FE form fields, and the PO template blocks. This is the single highest-value port.

### 6.2 Numbering collisions: PR and GRN tokens are wrong/missing (HIGH)

`numbering.service.js` `MODULE_TOKENS`:
- `"MOD-59": "PR"` — but MOD-59 is **financial statements** (`financial_statement.events.js`),
  and the PR module is MOD-62 (`purchase_request.events.js`, `0491`). A purchase request
  allocated with `MOD-62` hits **no token** and falls back to the numeric code → numbers
  like `SLS-62-2026-0001` instead of `SLAS-PR-…`.
- `"MOD-61": "SIN"` is shared by **two documents**: supplier invoice *and* goods received
  (`goods_received.events.js` also declares MOD-61). GRN numbering therefore prints `SIN`
  and **shares the sequence with supplier invoices** — two document families, one counter.
- `"MOD-49": "CSH"` covers both cash request and régie (fine — they are one workflow), and
  `"MOD-33": "GRN"` exists but nothing in procurement uses MOD-33.

**Port shape:** add `"MOD-62": "PR"`, give goods received its own key (MOD-61 vs MOD-33
decision — PRD calls GRN MOD-61; simplest is a distinct token entry keyed to the module the
GRN service actually emits, e.g. `"MOD-61-GRN": "GRN"`, or make goods_received emit MOD-33
as the WMS numbering already assumes).

### 6.3 Supplier payables/overdue cache: column exists, no writer (MEDIUM-HIGH)

`supplier_master.cached_payables` exists (`0300_masterdata.sql:50`) but **nothing in `src/`
writes it** (grep: zero hits) and the rebuild has no `cached_overdue` at all. The legacy
maintained both from PO flows (`updateSupplierStats`). The supplier 360 / master screens can
therefore show a stale zero. Because the rebuild's payables now come from `supplier_invoice`
(not PO), the cache (if kept) must be maintained by SI post/pay and PO issue — or dropped in
favour of a live join; the legacy naming map already showed this cache is presentation data.

### 6.4 Supplier invoice `PAID` is an unreachable state (MEDIUM-HIGH)

`supplier_invoice.status` CHECK includes `PAID` and `REVERSED` (`0342_finance_gaps.sql`),
and `due_on` exists — but the module has **no pay action** (routes are only `/match` and
`/post`; `grep -rn "PAID" src/modules/procurement/supplier_invoice/` → zero hits) and there
is no payment table for AP. The KB's own payment posting (Dr 4011 / Cr 521, `OHADA_KB.md`
§8.5) is not implemented anywhere (grep for 4011 in modules → only the SI rules/service
itself). Same class of bug `10719` fixed for cash request: a state nothing can write. The
legacy's `po_mark_paid`/`PARTIAL` was crude but it did track AP payment on the document.

**Port shape:** an AP payment flow (amount, treasury account, paid_on, entry) — either a
`supplier_invoice_payment` table mirroring `cash_request_payment`, or wiring into
`debt_engagement`/smart-receivables-style allocations — that posts Dr 4011 / Cr 521 and
moves SI to PAID, then updates the payables cache.

### 6.5 GRN: no lines, no partial receipt, no QA, no document (MEDIUM-HIGH)

The procurement GRN (`goods_received_note`) is a header-only row: `record()` inserts
`po_id, received_by, supplier_invoice_ref, three_way_matched` and nothing else; the FE form
collects exactly four fields. The line detail that exists (`grn_line`: `ordered, received,
condition` in `0476`) is attached to **`grn_inbound` (WMS)** — the two GRN families do not
talk: the WMS GRN has no `po_id`, the procurement GRN has no lines/QA/putaway. The registry
`GRN` template binds `wms/inbound` and its loader fakes the PO ref from `dossier_id` and
prints supplier "—" (`template.service.js` GRN loader), so:

- a partial delivery (received < ordered) cannot be recorded or printed;
- the PO shows RECEIVED with no quantity evidence;
- the procurement GRN has **no document page at all** (no DocButton on
  `goods-received.tsx`).

The legacy had no GRN at all, so this is not a parity gap — it is the rebuild finishing its
own feature. The PRD's three-way match (PR↔PO↔GRN↔invoice, §5 doc table) cannot be a real
three-way match until the GRN carries quantities.

### 6.6 Three-way match is really a two-way amount check (MEDIUM)

`matchThreeWay` checks (a) a GRN exists for the PO, (b) invoice HT vs PO total within
tolerance. It does not compare the **PR** at all, does not compare **quantities** (PO qty vs
GRN received vs invoice qty), does not compare **per-line** amounts, and ignores **currency**
(the SI has `currency` + `fx_rate`; the PO has neither, so an FX-denominated PO cannot
match). PRD MOD-61 explicitly says PR ↔ PO ↔ GRN ↔ supplier invoice.

**Port shape:** include the PR chain in the match inputs, add qty and per-line variance
fields, and settle the currency question first (the §6.1 PO `currency` column is a
prerequisite).

### 6.7 Cash request: beneficiary + OPS/OVH context + costing-line import are gone (MEDIUM)

The legacy cash request made `beneficiary` mandatory, split OPS vs OVH with different
required fields, and imported lines from the `APPROVED_LOCKED` costing
(`costing_lines_get`). The rebuild's `cash_request` has none of these (no beneficiary
column, no category, no costing-line import UX — `costing_id` FK exists but nothing reads
the approved costing's lines into the request). The validation/approval two-step
(`VALIDATED`) was already flagged in `LEGACY_COSTING_SET_NAMING_MAP.md` §4.2 and is a
deliberate-looking simplification; the rest looks like port loss. The régie link and
partial-disbursement work (§5) is strictly better than the legacy and must be kept.

### 6.8 PO/PR supplier snapshot vs live join (LOW)

Legacy denormalised `supplier_name` onto the PO (so a deleted supplier didn't blank the
document); the rebuild joins `supplier_master` live. The templates already follow the
"snapshot at issue" convention (transit order `shipment_details_snapshot`, delivery-note
containers) — if the PO issue path captures nothing, a supplier rename after issue changes
the printed PO. Same pattern as `0476` line-item labels. Cheap to fix: snapshot
`supplier_name`/`supplier_niu` at `ISSUED_LOCKED`.

---

## 7. Documents: legacy print vs rebuild templates

| Aspect | Legacy (print-po / cash-request print) | Rebuild (templates/registry + kit) | Verdict |
| ------ | -------------------------------------- | ---------------------------------- | ------- |
| Company identity | **hard-coded** "SMART LOGISTICS AND SERVICES LTD…", RC/NIU literals, `finance@smartls.cm` | per-tenant `corporate_entity` branding + legal footer + `doc_prefix` | ✅ rebuild strictly better |
| Signature | **hard-coded MD image** `signature-dg.svg` (same face on every doc) | `k.signatureBlock(cfg)` + named issuer/approver from config; `employee.signatory_name` exists for PDF signing | ✅ rebuild better (though legacy's named stamp blocks "VALIDATED BY / APPROVED BY / RECEIVED BY" are worth copying into CASH_REQUEST) |
| Amount in words | `numberToWords()` on PO and on final invoice (`printfi.php` "ARRÊTÉE LA PRÉSENTE FACTURE À LA SOMME DE") | **absent from `kit.js`** (grep: no words helper) | ⛔ rebuild gap — OHADA invoices conventionally carry the amount in words; add a shared `k.words(amount, lang)` |
| QR | QuickChart.io external URL, payload `VERIFY:SMARTLS|…`, **nothing verifies it** | in-house SHA-256 + `praxis://verify` QR in `pdf.service.js`, resolvable | ✅ rebuild strictly better |
| PO totals | HT / VAT / **TTC / WHT / Advance / Net Payable** | HT / VAT / TTC only | ⛔ rebuild gap (needs §6.1 columns) |
| PO header | PO no., date, **delivery date, terms, place of delivery** | date + blank delivery | ⛔ rebuild gap |
| Terms & conditions | hard-coded 5-clause array on PO | `k.termsBlock(cfg)` — configurable from Studio | ✅ rebuild better (config wins) |
| Pagination | hand-rolled 10-row chunks | CSS `@page` pagination | ✅ rebuild better |
| GRN | — (didn't exist) | template exists but binds `grn_inbound`, PO ref faked from `dossier_id`, supplier "—" | ⚠️ rebuild work-in-progress (§6.5) |
| Cash request print | PAYMENT REQUEST voucher with requisitioner + 3-signature grid | `CASH_REQUEST` template is a `lineDoc` (no requisitioner grid, no VALIDATED/APPROVED/RECEIVED stamps) | ⚠️ port the legacy grid + stamps into the template |

---

## 8. Do NOT copy (deliberate)

1. **Hard-coded secrets and identities** — `'SMART_SECURE_SALT'` in `po_approve`, the
   company name/RC/NIU/address literals in `print-po.php` and `cash-request.php`, the MD
   signature image. The rebuild's per-tenant branding + vault hashing is the fix.
2. **Comma-joined denormalisation** — `operations_file_master.cash_request_id` string
   accumulation on approval. The rebuild's `cash_request_payment` + `disbursed_amount`
   (`10719`) is the correct shape; keep it.
3. **Date-based, read-then-write numbering** (`SLAS-PR-{Ymd}-{seq}`) — the atomic
   `doc_sequence` upsert is the fix (but see §6.2 for the token bugs).
4. **`calculated_status`-style money-derived statuses** — see
   `doc/COST_TRACKING_LEGACY_COMPARISON.md` §5; same reasoning applies to any "paid" status
   derived from a cache.
5. **The legacy PO `security_hash` scheme** — sha256 over a hard-coded salt, truncated, with
   a QR that resolves nowhere. The vault hash + verify token replaces it.
6. **`supplier_document(s)` plural/singular table bug** — do not copy the inconsistency;
   the rebuild's party-document capture (`src/modules/master/_shared/nested.js`,
   `MOD-04-DOC` supplier KYC documents with `SUP` numbering) is the target.

---

## 9. Recommended port sequence

1. **Numbering fixes (§6.2)** — smallest, highest correctness: `MOD-62 → PR`, distinct GRN
   token, and a test asserting PO/PR/GRN/SI/cash-request numbers never collide per
   (module, year, entity).
2. **PO header enrichment (§6.1 + §6.8)** — additive migration (currency, delivery, payment
   terms, bank/momo block, `air_rate`, `adv_paid`, terms, `net_payable`, `amount_paid`,
   supplier snapshot at issue), FE form fields, template blocks (WHT/advance/net payable,
   delivery date/location, payment terms), snapshot capture on `ISSUED_LOCKED`.
3. **AP payment flow (§6.4 + §6.3)** — SI payment recording → `PAID` reachable, Dr 4011 /
   Cr 521 posting, payables cache writer (or live-join decision).
4. **GRN lines + document (§6.5)** — reconcile the two GRN families (procurement
   `goods_received_note` gains `grn_line`-style lines with `ordered/received/condition`, a
   `po_id` on `grn_inbound` or a shared binding), partial-receipt states, DocButton +
   loader on the procurement GRN.
5. **True three-way match (§6.6)** — PR in the match, qty + per-line variance, currency
   after §6.1 lands.
6. **Cash request legacy UX (§6.7)** — beneficiary, OPS/OVH context, approved-costing line
   import; keep the régie + partial-disbursement engine.
7. **Kit: amount in words (§7)** + port the cash-request voucher grid/stamps into
   `CASH_REQUEST` template.

## 10. Verification

Every table and column above was read from source: legacy from the `INSERT`/`FROM` clauses
of `administration/view/{admin,finance}/*.php`, `administration/view/admin/print-po.php`,
`administration/api/suppliers/*.php`; rebuild from `migrations/tenant/{0300,0320,0330,0342,0476,0477,0491,10719}_*.sql`,
`src/modules/procurement/*/*.js`, `src/modules/costing/cash_request/*.js`,
`src/services/documents/{numbering.service.js,templates/registry.js}`,
`src/modules/documents/template/template.service.js`,
`client/src/features/procurement/*.tsx`. The "does not exist" claims (§3.6, §6.3, §6.4) are
negative greps run against the live tree on 2026-08-18, so they will go stale — re-run the
grep before scheduling any of the recommended work. No code changed in this commit; analysis
only.
