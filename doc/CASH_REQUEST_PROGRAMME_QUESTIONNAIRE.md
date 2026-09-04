# Praxis LS — Cash Request revamp: full legacy + codebase read, and a 20-question decision sheet

**Revision 2.** Rewritten after reading the legacy system end to end — both halves, every
departmental copy, the archived revisions, and the three neighbouring modules (costing, cost
tracking, OCR). The reconstructed legacy schema is in §8, because there is no SQL dump in the tree
and you asked.

**Purpose.** The costing module was rebuilt across PRs #297–#302. The cash request is the money half
of that story and has not had the same treatment. You want the costing to become **the budget for an
operations file's fulfilment**, and the cash request to draw that budget down, visibly, line by
line. This document reports what both systems actually do, names what has to change, and asks the
twenty questions whose answers become the engineering guide and the three PRs.

**How to use it.** Answer inline. Where you are happy with my recommendation, write `Rec`. Return
the file and I will produce `doc/CASH_REQUEST_ENGINEERING_GUIDE.md` — migrations, module trees,
endpoints, component trees, acceptance criteria, test plan — split across the PRs in §7.

---

## 0. The finding that reorders everything

> **In the legacy system, "budget → cash → actual" was three separate manual re-typings, and the
> three modules could not see each other.**

This is not a summary. It is a `grep`:

```
$ grep -in "cash\|disburs\|advance" admin/costing-module.php
380:  <a href="cash-request.php" class="sub-link">Cash Request</a>

$ grep -in "cash\|disburs\|advance" admin/operational-cost-reconciliation.php
569:  <a href="cash-request.php" class="sub-link">Cash Request</a>
```

One hit each — a sidebar link. The legacy costing module has no idea any cash was ever raised
against it. The legacy OCR (Budget vs Actual) module has no idea either. Meanwhile:

- **`cash_request_lines`** carries `line_code, line_desc, qty, unit_cost, vat_rate, line_total,
  is_imported, justification_required`. **There is no `costing_line_id`.** The import copies text
  and numbers and forgets where they came from, permanently.
- **`ocr_line`** carries `costing_line_id` — and `save_draft.php` makes it **mandatory**
  (`must_str($l['costing_line_id'] ?? null, "lines[$i].costing_line_id")`). So the legacy *did*
  reconcile at costing-line level. Its `actual_ttc` was **typed in by hand**, because the one system
  that knew what had actually been disbursed against that line — the cash request — had thrown the
  link away.
- **`cost_entries`** is a third, parallel record: a hardcoded 15-item sheet (`COST_ITEMS`, from
  "Brokerage Fees" to "Yard Occupancy") with `actual_cost` and `advance_received` typed per item,
  and a status derived as `totalCost − totalAdvance`.

So the same money was entered three times, in three shapes, and no two of them could be reconciled
without a human. **That is the hole this revamp closes**, and it is why the `costing_line_id` link
(Q1) is the keystone rather than a nicety: the legacy's own OCR module already proves the shape is
right — it just had nothing upstream to fill it in.

---

## 1. What the legacy actually did

Read in full: `view/finance/cash-request.php` (3 242 lines — all six AJAX endpoints, the entire
JS, the print voucher), plus the costing API (`api/costing/save.php`, `transition.php`,
`get-approved.php`, `ops-file-details.php`), the OCR API (`api/ocr/file_context.php`,
`save_draft.php`), and `api/cost-tracking/cost-tracking-api.php`.

### 1.1 Five copies, one implementation

```
$ diff <(sed -n '1,960p' finance/cash-request.php) <(sed -n '1,960p' operations/cash-request.php)
(no output)
```

The PHP half is **byte-identical** across finance / operations / management / sales. `admin` differs
by 24 lines, all avatar handling. Divergence begins only in the sidebar markup. The archived copies
(`archive/financ/`, 2 278 lines) have the same six endpoints and **no budget logic of any kind** —
so nothing was removed; they are simply earlier revisions predating the VAT and justification
columns. There is one implementation of the cash request in the legacy, and I have read it.

### 1.2 The workflow

```
DRAFT ──submit──> SUBMITTED ──validate──> VALIDATED ──approve──> APPROVED_LOCKED
  ↑                                                                    │
  └──────────── REJECTED (editable, re-submittable) <──────────────────┘
                                          │
                    PARTIALLY_DISBURSED <──┴──> DISBURSED
```

Role policy, hardcoded: submit = the creator (ADMIN/MANAGEMENT override); validate = FINANCE;
approve = MANAGEMENT/ADMIN only; disburse = FINANCE. `pr_disburse` locks the row `FOR UPDATE`,
appends to `cash_request_payments`, and derives `DISBURSED` vs `PARTIALLY_DISBURSED` from
`disbursed_total + pay` against `amount_total` with a **±1 XAF tolerance**.

### 1.3 The screen, and the part worth copying

Pick the operations file from a type-ahead (`ops_files_list`), and the moment it is chosen
`checkCostingLink()` fires `costing_lines_get` and paints one of two banners:

- red — `STOP: Costing is not APPROVED. Cannot import lines.`
- green — `Costing Approved`, with an **`Import Lines`** button beside it.

That is exactly the interaction you described, and it is the right one. The import modal lists the
approved costing's lines with a checkbox each, `Code · Description · Approved Amt (TTC)`, and
"Import Selected". Imported lines land **read-only** (`is_imported = 1`, `readonly` on every input)
except the justification checkbox, which stays editable.

The line grid is: `Code · Description · Qty · Unit Price · VAT % · Just. Req? · Total (TTC)`,
footed by **Subtotal / VAT / TOTAL PAYABLE**. Default VAT on a new line: `19.25`.

**What that screen does not have — and it is the whole of your ask:** the import modal shows
`Approved Amt (TTC)` and nothing else. No "already claimed". No "remaining". Import the same costing
twice and you get the same three lines at full value, twice, with nothing anywhere objecting.

Two smaller legacy bugs, noted so we don't reproduce them: `executeImport()` calls
`addLine(code, desc, qty, price, vat, 1)` — six arguments — so the seventh, `justReq`, silently
defaults to 0 and the catalogue's justification requirement is dropped on every imported line. And
after a successful import the green banner is hidden (`costingSuccess.classList.add('d-none')`), so
a second import in the same session is impossible without reopening the record.

### 1.4 The voucher

`#print-area`: a requisitioner grid (name, employee ID, department, job title), a meta grid (PR
date, PR number, **costing ref**, file ref, BL, beneficiary, total), the line table
(`CODE · DESCRIPTION · QTY · UNIT PRICE · TOTAL EX · VAT · TOTAL INC`), a remarks box with the total
floated in it, and three signature blocks:

```
VALIDATED BY (FINANCE)   |   APPROVED BY (MANAGEMENT)   |   RECEIVED BY
```

The approval box stamps a hard-coded image — `signature-dg.webp`, the same MD signature on every
document ever printed. `RECEIVED BY` is deliberately left blank for wet ink.

### 1.5 The legacy costing, as a budget

`api/costing/transition.php` on `APPROVE`: sets `APPROVED_LOCKED`, mints an
`approval_auth_code` (`8F2A-9C10`), and **syncs `costing_ref` + `total_ht` onto
`operations_file_master`.** On `VALIDATE` it syncs `costing_id` + `costing_ref`. The unlock loop
(`REQUEST_UNLOCK` / `UNLOCK` / `DENY_UNLOCK`) exists and returns to `DRAFT`, appending a free-text
note to `remarks` — which our 10718 turned into real columns.

So the legacy *did* treat the costing as the file's budget figure. It just put one number
(`total_ht`) on the file and stopped there.

### 1.6 The legacy OCR — the shape we should honour

`api/ocr/file_context.php` refuses anything but `APPROVED_LOCKED`, then builds its lines straight
off `costing_line`:

```php
'costing_line_id' => (string)$r['costing_line_id'],
'line_no'         => (int)$r['line_no'],
'code'            => $r['item_code'],
'desc'            => $r['item_description'],
'budget_ttc'      => (float)$r['total_ttc'],     // ← the budget IS the costing line, TTC
'doc_required'    => 0                            // "Placeholder until you implement
                                                  //  expense dictionary mapping"
```

`ocr_line` then stores `budget_ttc`, `actual_ttc`, `doc_ref`, `doc_required` per `costing_line_id`,
and `save_draft.php` writes `ocr_id`, `ocr_amount`, `ocr_status`, `ocr_linked_at` back onto the
operations file.

Note two things. **The budget unit is TTC**, not HT. And `doc_required` was left as a hardcoded `0`
with a comment admitting the dictionary mapping was never done — which is the exact gap our
`dictionary_item.receipt_requirement` fills.

---

## 2. What Praxis LS does today

### 2.1 The backend

`src/modules/costing/cash_request/` — 861 lines across eight files; 8 routes; two bindable approval
legs (`disbursal.requested` → finance validates, `disbursal.validated` → management approves);
instalments derived from `Σ cash_request_payment.amount` under `FOR UPDATE` with over-payment
refused rather than clamped; **one régie advance issued per instalment**; justification retiring the
advance in the same transaction so a closed request can never sit over an open 581 balance.

All of that is better than the legacy and stays. What is missing is everything about the budget.

### 2.2 The frontend

`CashRequestForm` (a `<Modal size="lg">`) and `CashRequestsPage` (a `DataList` row with actions) —
together ~530 lines inside a 2 056-line `pages.tsx`, plus `cash-request-actions.tsx` (424 lines).

There is **no detail view**. `GET /cash-requests/:id` returns lines, payments and totals; the only
screen that calls it is the Justify dialog. `PATCH /cash-requests/:id` has **no caller at all** — a
cash request can be created and never edited. That is precisely the defect the costing revamp opened
with.

### 2.3 The eight gaps, ranked

| # | Gap | Consequence |
| --- | --- | --- |
| 1 | **No `costing_line_id` on `cash_request_line`** | Budget consumption is unanswerable. Same hole as the legacy. |
| 2 | **Débours are excluded from the reconciliation line grid** (§2.4 — the new finding) | The three lines in your own example never appear in Budget vs Actual. |
| 3 | **`justify` writes no `cost_entry`** | Justified cash never becomes an actual; budget-vs-actual is incomplete *today*. |
| 4 | **No currency, no FX rate on `cash_request`** | A non-XAF costing imports as bare numbers; request, advance and posting are all wrong together. |
| 5 | **No `qty` / `unit_cost` / `line_no` on `cash_request_line`** | The import flattens 4 × 62 000 into "248 000"; lines reshuffle on every save; the PDF prints `qty: 1`. |
| 6 | **No `cash_request.*` or `costing.*` key in `NOTIFIABLE`** | Disbursement events are emitted, audited, and reach nobody. |
| 7 | **`REJECTED` is terminal and records nothing** — no actor, no timestamp, no reason | Worse than the legacy, which let a rejected request be fixed and re-submitted. |
| 8 | **No `can_export`; no disburse/validate in the permission vocabulary** | Two standing TODOs in `rbac.js`. |

### 2.4 The finding that changes the design

Your worked example is **Port Charges 150 000 · Customs Duties 2 500 000 · Terminal Handling
198 000**. I looked all three up in the seeded catalogue:

| Item | Seed line | Direction | Receipt requirement |
| --- | --- | --- | --- |
| `PORT_CHARGES` (`#D096`, legacy `#-1119/#-1120`) | 9080:397 | **DISBURSEMENT** | `ALWAYS_REQUIRED` |
| `CUSTOMS_DUTIES_TAXES` (`#D030`, legacy `#-1047`) | 9080:328 | **DISBURSEMENT** | `ALWAYS_REQUIRED` |
| `THC` (`#D114`, legacy `#-1122/#-1123`) | 9080:416 | **DISBURSEMENT** | `CONDITIONALLY_REQUIRED` |

All three sit inside the `INSERT INTO _dict_seed (…) SELECT 'DISBURSEMENT'` block that opens at
9080:298, so `resolveDisbursement` gives all three `is_disbursement = true`. **All three are
débours.** That is not a coincidence — a cash request exists to pay third parties on the client's
behalf, so débours are most of what it ever pays.

Now read `dossier_reconciliation.repo.costCompare`:

```sql
FROM costing_line cl JOIN costing c ON c.costing_id = cl.costing_id
WHERE c.dossier_id = $1 AND c.status = 'APPROVED_LOCKED'
  AND COALESCE(cl.is_disbursement, false) = false     -- ← débours excluded
GROUP BY cl.dictionary_item_id                        -- ← and grouped by ITEM, not line
```

**Every one of your three lines is excluded from the reconciliation's line-by-line grid.** They are
collapsed into a single header pair by `disbursementTotals` (one budget number, one actual number,
no lines).

The exclusion is not a bug in its own frame. `dossier_reconciliation.rules` says so plainly: *"All
HT, service costs only — débours are pass-through and live in a separate total (OHADA_KB §450)."*
For the **margin** question that is exactly right; OHADA KB §6.7 is explicit that débours are
neither revenue nor cost.

But it is the wrong frame for **cash**. And our own costing module already made the opposite call
last month, in `computeCosting`:

> *"12768: the supplier's VAT on a débours is now BUDGETED — it counts toward the sheet's VAT and
> TTC. **A costing is a cash budget, not a fiscal invoice**, so the VAT we hand the carrier is money
> we will spend, and the budget says so."*

So the costing is already a cash budget whose `total_ttc` includes débours **and** the supplier VAT
on them. The reconciliation reads `budget_ht` with débours removed. Those are two different numbers
answering two different questions, and right now only one of them is on screen.

**This produces Q7 (does the budget ledger cover débours?) and Q8 (HT or TTC?), and it is the pair I
would think about hardest.** Getting them wrong means the cash request draws down a budget that the
reconciliation cannot see.

---

## 3. The model I am proposing, in one picture

```
                    COSTING  (one live per file, APPROVED_LOCKED)
                    the file's fulfilment budget, in cash terms
                    ├── line 1  Port Charges          150 000  (débours)
                    ├── line 2  Customs Duties      2 500 000  (débours)
                    └── line 3  THC                   198 000  (débours)
                                             total  2 848 000
                                                   │
                       ┌───────────────────────────┼───────────────────────────┐
                       │  costing_line_id (NEW)    │                           │
                       ▼                           ▼                           ▼
              CASH REQUEST #1              CASH REQUEST #2              CASH REQUEST #3
              claims L1+L2                 claims L2 balance            claims L3
              approved 2 650 000           approved 350 000             …
              paid     1 000 000  ─┐
                                   │
                                   ├─ per instalment: one régie advance, one receiver signature
                                   │
                                   ▼
                              JUSTIFICATION
                              retires the advance  +  writes cost_entry
                              tagged costing_line_id (NEW)
                                   │
                                   ▼
                    OCR / Operational Cost Reconciliation
                    Budget vs Actual — per costing line, DERIVED not typed
```

Every arrow marked NEW is one nullable foreign key. That is the whole structural change; everything
else is surface.

**The four numbers a costing line carries once this lands:**

| | Meaning | Source |
| --- | --- | --- |
| **Budget** | what the approved costing says this line costs | `costing_line`, TTC |
| **Committed** | Σ approved-and-not-cancelled cash request lines against it | `cash_request_line` |
| **Disbursed** | Σ actually paid | `cash_request_payment`, apportioned |
| **Actual** | Σ justified spend, evidenced | `cost_entry` (new tag) |

Budget − Committed = **Remaining** (what a new cash request may still claim).
Budget − Actual = **Variance** (what OCR reports).

---

## 4. Worked example — your numbers, end to end

Costing `CST-2026-0043` on file `SLAS-OPS-2026-0117`, `APPROVED_LOCKED`:

| Line | Item | Qty | Unit | Net | Upstream VAT (PT) | **Budget (TTC)** |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Port Charges | 1 | 150 000 | 150 000 | 0 | **150 000** |
| 2 | Customs Duties & Taxes | 1 | 2 500 000 | 2 500 000 | 0 | **2 500 000** |
| 3 | Terminal Handling (THC) | 2 | 99 000 | 198 000 | 38 115 | **236 115** |
| | | | | **2 848 000** | **38 115** | **2 886 115** |

*(THC carries the carrier's own VAT at 19.25%, budgeted per 12768 because it is cash we hand over.
Customs duties and port charges are government/authority receipts with no VAT to advance. This is
the pattern Q8 has to settle.)*

**Monday — cash request DF-2026-0011.** Ops picks the file. The three lines land, each showing
`Budget 150 000 · Claimed 0 · Remaining 150 000`, amount pre-filled to Remaining. Ops unticks THC
(the box has not landed), keeps lines 1 and 2. Total **2 650 000**. Submitted → validated → approved.

**Tuesday.** Treasury can release only 1 000 000. One instalment: `PARTIALLY_DISBURSED`, one régie
advance for 1 000 000, receiver signs for that tranche. Outstanding 1 650 000.

**Wednesday — someone opens a second request against the same costing.**

| Line | Budget | Committed | Disbursed | **Remaining** |
| --- | --- | --- | --- | --- |
| Port Charges | 150 000 | 150 000 | *(apportioned)* | **0** |
| Customs Duties | 2 500 000 | 2 500 000 | *(apportioned)* | **0** |
| THC | 236 115 | 0 | 0 | **236 115** |

Only THC is claimable. This is Q2 (committed, not merely disbursed) doing its work: the 1 650 000
still owed on DF-2026-0011 is **not** available to a second request, even though the cash has not
moved. Under the alternative — consumption by disbursement only — Wednesday would show 1 848 000
free and two valid approvals would take the file over budget with nobody at fault.

**Thursday — the carrier bills 4 days' detention, 480 000, unbudgeted.** Two legal routes: unlock
the costing, add the line, re-approve, then raise the cash (clean, slower); or raise it as an
`OFF_BUDGET` line with a written reason, which prints separately on the voucher and shows on the
approver's screen as `2 650 000 on budget + 480 000 off budget`. Q4 decides whether the second route
exists at all.

**Later — justification.** Ops returns with the customs receipt and the port invoice. Each justified
line writes a `cost_entry` tagged with its `costing_line_id`, so OCR's Budget vs Actual is a join,
not a re-typing — and the receipts are already attached because the catalogue said
`ALWAYS_REQUIRED` (§2.4) and the tick was on.

---

## 5. The questions

Twenty questions, five groups. ⭐ marks my recommendation.

---

### Group A — The budget ledger (7 questions)

---

**Q1. How does a cash request line remember which costing line it came from?**

- **A.** Keep the header `costing_id` only; match imported lines back by `dictionary_item_id`, or by
  label where there is none.
- **B. ⭐ Add `costing_line_id uuid REFERENCES costing_line` to `cash_request_line`**, written by the
  import, null on an ad-hoc line. Consumption becomes `GROUP BY costing_line_id`.
- **C.** A separate `costing_budget_ledger` table — one row per claim, written on approval and on
  disbursement.

> **Recommendation: B**, and the legacy's own OCR module is the argument. `ocr_line.costing_line_id`
> is not merely present, it is **mandatory** at save. The legacy engineers reached the same
> conclusion about the right key and simply had nothing upstream to populate it from, which is why
> their actuals were typed by hand.
>
> A cannot work here. `dictionary_item_id` is nullable on both sides; a costing legitimately carries
> two lines from the same catalogue item (per-container demurrage — that is exactly what
> `container_type_ref_id` exists for, 0663/D10) and `costCompare`'s `GROUP BY dictionary_item_id`
> already collapses them today; and labels get edited. C is the same information with an extra table
> to keep consistent — and 10719 already settled that argument for this module: *"adding a second
> table to hold one FK that belongs on an existing row would be redundant structure."*
>
> One nullable FK, one index.

**Answer:**

---

**Q2. What consumes budget — approved money, or disbursed money?**

Per §4: request #1 approved Monday for 2 650 000, 1 000 000 paid Tuesday. Wednesday, request #2.

- **A.** Only cash actually disbursed consumes it. Wednesday shows 1 848 000 free.
- **B. ⭐ Approved-and-not-cancelled consumes it (commitment accounting), disbursed shown
  alongside.** Wednesday shows `Committed 2 650 000 · Disbursed 1 000 000 · Remaining 236 115`.
- **C.** Anything not DRAFT or REJECTED consumes it — a submitted request already holds its slice.

> **Recommendation: B.** A is the option that loses money: between approval and payment the budget
> reads as free, so a second request is approved against headroom the first was already promised.
> C is defensible but lets an unreviewed draft-submission block a colleague — the requester holds the
> budget hostage by clicking Submit.
>
> B is what every project-budget system does, and it displays as four columns a reader can reconcile
> by eye: **Budget · Committed · Disbursed · Remaining**.
>
> This also settles *"can there be several cash requests against one costing?"* — **yes, freely.**
> The ledger is the guard, not a uniqueness rule. (Unlike the costing itself, which is one-per-file
> by `uq_costing_one_live_per_dossier`.)

**Answer:**

---

**Q3. Where does over-budget stop being a warning and become a refusal?**

- **A.** Refuse at save — a draft line can never exceed its remaining budget.
- **B. ⭐ Warn on the worksheet and at submission; **refuse at APPROVE**.
- **C.** Warn everywhere, never refuse — the approver is the control.

> **Recommendation: B.** The codebase already applies this rule in three places and it is right every
> time: proof obligations are advisory and never throw; over-*disbursement* is refused outright
> because the money has already moved; the ledger refuses a non-postable account but the costing
> tolerates a missing FX quote. The principle is **never block someone recording reality; always
> block the act that releases money.**
>
> A stops a requester typing what a carrier has actually invoiced, which is how spend leaves the
> system entirely. If you pick C, the over-budget delta must at minimum be a red banner on the
> approve dialog, not a column someone might scroll past.

**Answer:**

---

**Q4. May a cash request carry lines that are NOT on the costing?**

- **A.** No. Unbudgeted spend means unlock the costing, amend, re-approve, then raise the cash.
- **B. ⭐ Yes, marked `OFF_BUDGET`, requiring a written reason, totalled separately** on the
  worksheet, the voucher and the approver's screen.
- **C.** Yes, freely, like any other line.

> **Recommendation: B.** A is the pure position, and the costing module already argued against it in
> its own comments — the detention charge that arrives a week after billing, where *"refusing the
> unlock left that spend with nowhere to be budgeted, which is how it ends up off the file's margin
> entirely."* The same is true one document down. C makes the budget decorative.
>
> B keeps the discipline visible and gives you the report that matters — off-budget spend by file, by
> month, by requester — as a `WHERE costing_line_id IS NULL` once Q1 lands.

**Answer:**

---

**Q5. "No cash without an approved budget" — which gate enforces it?**

- **A. ⭐ An OPS cash request cannot be SUBMITTED without a linked `APPROVED_LOCKED` costing.**
- **B.** It can be submitted, but not APPROVED, without one.
- **C.** It can be approved, but not DISBURSED, without one.

> **Recommendation: A**, which is also what the legacy screen did — `checkCostingLink()` fires the
> moment the file is picked and paints `STOP: Costing is not APPROVED` before a single line can be
> imported. The lines *come from* the costing, so a request without one is not a request needing a
> stricter approver; it is an empty form. Refusing at submit is the only option that gives the
> requester a sentence they can act on, at the moment they can act on it.
>
> **OVH (overhead) is exempt by construction** — no operations file, therefore no costing. It keeps
> its existing gate: a cost centre plus a written justification. Please confirm you are happy with
> that asymmetry: it is the one hole in "no cash without an approved budget", and closing it would
> mean giving cost centres their own periodic budgets, which is a module, not a feature.

**Answer:**

---

**Q6. The costing is unlocked and amended and the budget moves. What happens to cash requests already in flight?**

- **A.** Nothing. New headroom appears; existing requests untouched.
- **B. ⭐ Nothing to the requests, but each request records the costing revision it was raised
  against**, and the file's budget bar recomputes against the current revision. A line amended
  *below* what is already committed shows as over-consumed (red), never a retroactive block.
- **C.** Amending a line with live claims re-opens those requests for re-validation.

> **Recommendation: B.** `costing_approval_snapshot` already exists (12766) with a `revision` counter
> and the frozen line set, and the amendment diff is already computed and printed on the sheet.
> Stamping `costing_revision` onto the cash request is nearly free and answers the auditor's
> question: *approved against which version of the budget?*
>
> C is the tempting one and it is wrong: an operations officer adding a detention line to the bottom
> of a costing would re-open a customs disbursement approved and paid a week ago. A is B without the
> audit answer.

**Answer:**

---

**Q7. Does the budget ledger cover débours, service lines, or both? — and what happens to the reconciliation grid?**

The pivotal question, from §2.4. All three lines in your example are débours, and
`costCompare` excludes `is_disbursement = true` from the line-by-line grid.

- **A.** The cash-request ledger covers **every** costing line including débours; the reconciliation
  grid is left as it is (service lines only, débours as one header pair).
- **B. ⭐ The ledger covers every line, **and** the reconciliation grid gains the débours lines** —
  shown in their own section, included in Budget vs Actual, and still **excluded from the margin
  maths** (which stays HT, service-only, per OHADA KB §6.7).
- **C.** Split the concepts: a **cash** budget (all lines, TTC) drives the cash request; a separate
  **margin** budget (service lines, HT) drives the reconciliation. Two ledgers, two screens.

> **Recommendation: B.** Under A we would build a budget ledger whose three biggest lines can never
> be reconciled — you would see "Customs Duties: 2 500 000 committed, 2 500 000 disbursed" on the
> cash side and nothing at all on the Budget vs Actual screen. That is the legacy's disconnect
> rebuilt in new code.
>
> C is intellectually the cleanest and I do not recommend it: two budgets against one costing is two
> numbers people will quote at each other in meetings, and the reconciliation module is the one that
> would have to explain the difference.
>
> B is one query change (drop the `is_disbursement = false` predicate, section the output) plus a
> discipline that already exists everywhere else in the codebase — **débours are visible, and they
> are excluded from margin, and those are different statements.** The costing PDF already does
> exactly this: it prints débours lines with a `(PT)` tag and an *"of which débours (at cost)"*
> subtotal inside the totals block. The reconciliation should read the same way.
>
> While we are there: `costCompare` also does `GROUP BY dictionary_item_id`, which collapses two
> lines of the same item. Once Q1 lands, that becomes `GROUP BY costing_line_id` and the
> per-container distinction survives.

**Answer:**

---

### Group B — The worksheet (4 questions)

---

**Q8. What unit is the budget in — HT or TTC? And what currency?**

Today: `costing` stores `total_ht` / `total_vat` / `total_ttc` / `total_ttc_xaf` and carries
`currency` + `exchange_rate_to_xaf`. `cash_request.amount` is the **total payable** (subtotal +
per-line VAT). `costCompare` compares **`budget_ht`** against `cost_entry.amount`. The legacy OCR
used **`budget_ttc`**. `cash_request` has **no currency column at all**.

- **A.** Budget in **HT**. Consume HT against HT; VAT handled separately.
- **B. ⭐ Budget in **TTC** — total payable — because that is the cash that leaves the building.**
  `cash_request` gains `currency` + `exchange_rate_to_xaf` + `amount_xaf`, defaulted from the
  costing, mirroring `costing.total_ttc_xaf` and its rule *"the only column any cross-costing sum may
  use"*. HT is retained per line for the margin/reconciliation side.
- **C.** Everything is XAF and HT; refuse to import from a non-XAF costing with a clear message.

> **Recommendation: B**, and our own costing module has already made this decision — 12768's comment
> is unambiguous: *"A costing is a cash budget, not a fiscal invoice, so the VAT we hand the carrier
> is money we will spend, and the budget says so."* `costing.total_ttc` is therefore already "the
> cash this file needs", which is precisely the quantity a cash request draws down. The legacy OCR
> agreed independently (`budget_ttc`). Consuming a TTC budget with HT claims would leave the VAT
> permanently unfunded, which is the defect 10746 fixed on `cash_request.amount` — do not reintroduce
> it one level up.
>
> The currency half is not a feature request but a latent wrong-number defect: today the request, the
> régie advance and the ledger posting all agree with each other and are all wrong together, which is
> the kind that survives testing. C is honest and cheap and I would accept it **if** you tell me
> every tenant prices in XAF — but the costing module has already decided otherwise, so the two
> documents would disagree.
>
> Consequence to accept: the reconciliation shows Budget (TTC) for cash and Budget (HT) for margin.
> Two labelled columns, one source.

**Answer:**

---

**Q9. Does the cash request get its own route, like the costing sheet?**

- **A.** Keep the `<Modal size="lg">` create form and row actions.
- **B. ⭐ A full route — `/costing/cash-requests/:id` — on `Record360Page` chrome**, `<Dialog>` body
  on phones, mirroring `costing-sheet-360.tsx` (FRONTEND_GUIDE §3.11).
- **C.** A right-hand drawer over the list.

> **Recommendation: B.** You asked for the costing's worksheet, and this is what that means
> structurally. Three arguments, all of which the costing revamp already made and won: the request
> carries a file strip, a line grid with four money columns, a totals block, a payments table and a
> workflow rail, none of which fits a dialog; a request awaiting approval must be **linkable**; and
> `PATCH /cash-requests/:id` currently has no caller, so the record can be created and never edited.
> C keeps list context but a drawer cannot be pasted into a message.

**Answer:**

---

**Q10. How do the lines get onto the worksheet?**

- **A.** Today's flow: create the draft, then press "Import costing" as a row action.
- **B. ⭐ Pick the file and the lines arrive immediately** — every line of the approved costing, each
  with a checkbox (all ticked), its **Budget / Claimed / Remaining** figures, and the amount
  **pre-filled to Remaining**. Untick what this request is not for; edit amounts down (or up, per
  Q3/Q4).
- **C.** A picker dialog listing the lines with remaining balances — the legacy's "Import Selected".

> **Recommendation: B, with C also present as "Add from budget" for later top-ups.** B is your
> description almost word for word, and it is the pattern the costing sheet already established with
> Suggest — the standard charge set lands *priced*, and the user fixes the two numbers nobody could
> know.
>
> A is worse than it looks: a second round-trip after a save, it silently replaces every line
> (`replaceLines` deletes and re-inserts, which is why proof-obligation flags must be cleared first),
> and there is no way to import *some* lines.
>
> Do copy the legacy's banner — `checkCostingLink()`'s red STOP / green Approved beside the file
> picker is the clearest thing on that screen. Do not copy its two bugs: imported lines must carry
> the catalogue's justification flag (the legacy dropped it via a missing seventh argument), and a
> second import must stay possible (the legacy hid the button after the first).

**Answer:**

---

**Q11. What is a cash request line made of?**

Legacy: `line_code, line_desc, qty, unit_cost, vat_rate, line_total, is_imported,
justification_required`. Ours: `budget_amount, spent_amount, is_disbursement, proof_vault_id,
vat_percent, justification_required`.

- **A.** Keep `budget_amount` — one number per line.
- **B. ⭐ `qty` × `unit_cost` → amount, plus `vat_percent`**, mirroring `costing_line` *and* the
  legacy. Add `line_no` for order and `source` (`IMPORTED` / `MANUAL` / `OFF_BUDGET`), the legacy's
  `is_imported` done properly.
- **C.** qty/unit optional — shown when imported from a costing that had them, hidden otherwise.

> **Recommendation: B.** Three concrete reasons. (i) `importCostingLines` computes `qty × unit_cost`
> and discards both, so a 2-container THC line at 99 000 becomes "198 000" and an approver cannot see
> what changed when the count moves to 3. (ii) The CASH_REQUEST PDF template already prints QTY and
> UNIT PRICE columns and is emitting `qty: 1, unit: budget_amount` into them on every row today.
> (iii) `cash_request_line` has no `line_no`, so lines read back in `cash_request_line_id` order and
> reshuffle on every save — the exact defect 12766 fixed on `costing_line`.
>
> Also settle here: **should an imported line be read-only?** The legacy locked every field except
> the justification tick. My recommendation is **softer**: the amount stays editable down to the
> remaining balance (a partial claim is the normal case), the description and item are locked to the
> costing line (that is what `costing_line_id` means), and the justification tick follows Q17.

**Answer:**

---

### Group C — The chain, the receipt and the paper (5 questions)

---

**Q12. How are the three signatures captured?**

Today: `validated_by` + `validated_at`, `approver_id` (**no timestamp**), and
`cash_request_payment.created_by`. The PDF prints three empty ruled boxes. `CASH_REQUEST` is **not**
in `SIGNATURE_CEILING`, so `signInternal` refuses it. The legacy stamped a hard-coded MD signature
image on every document.

- **A.** Keep printed boxes; sign in ink, scan to the vault.
- **B. ⭐ Register `CASH_REQUEST` in the ceiling and seal inside the transition**, exactly as the
  costing does (`sealTransition`, best-effort, logged at error, never undoing the decision):
  `VALIDATED` → `ACKNOWLEDGED`, `APPROVED` → `APPROVED_DISPATCH`, `DISBURSED` → a new reason, plus
  the receipt (Q13). Ceiling `{ signable: true, allowsQes: false, allowsWet: true }`.
- **C.** Ask each actor to choose a signature card when they act.

> **Recommendation: B.** The costing revamp already argued C down and the argument transfers: *"The
> button IS the decision… asking them to then choose a signature card is asking the same question
> twice — which is how a control becomes a thing people click through."*
>
> Two differences from COSTING. **`allowsWet: true`** — unlike a costing, this document leaves the
> building and is signed by someone receiving cash. **Not QES** — certification is bought per
> envelope from a third party and a cash voucher is internal.
>
> Add `approved_at` while we are there; the costing has it, this does not, so *"when was this
> approved"* is currently only answerable from the audit ledger.

**Answer:**

---

**Q13. Who is "the one who receives", and how is that signature collected?**

- **A. ⭐ The régie holder** — the user the advance is issued to (`holder_user_id`, defaulting to
  `requested_by`). They acknowledge in-app, stamping `received_by` / `received_at` and sealing. A
  third-party beneficiary is paid *by* the holder; that payment is the spend, evidenced at
  justification.
- **B.** The `beneficiary` — possibly external — signs through the verification-portal link, like a
  delivery-note counterparty.
- **C.** Wet only: print, sign, scan back to the vault.

> **Recommendation: A as the default, with C always available.** A is the only option true to the
> ledger: `Dr 581 régie (holder) / Cr treasury` places the money in **the holder's** hands, and
> `regie.retireCore` later reconciles against **the holder's** receipts. Making the external
> beneficiary the signer would attest the wrong fact and leave the aging clock pointing at someone
> with no login. B is the right mechanism for the *supplier's* receipt — which is the justification
> document and belongs to OCR (Q18), not here. C stays because a cash window at 06:00 is a paper
> transaction and always will be.
>
> **Schema note, and it matters:** `received_by` / `received_at` / `received_ack_kind`
> (`IN_APP` | `WET_SCAN`) belong on **`cash_request_payment`**, not on the request — each tranche is
> physically handed over separately, and the legacy's single `disbursed_time` on the header is
> exactly the shape that cannot express it.

**Answer:**

---

**Q14. Should disbursement itself be bindable to an approval chain?**

Today `disburse` is `requirePermission('MOD-49','approve')` + `requireCapability('APPROVER')`, with
no `executor.start` — unlike SUBMITTED and VALIDATED, which each open a chain.

- **A.** Keep as-is. Two approval legs are enough.
- **B. ⭐ Add a `disbursal.approved` approvable event** so a tenant *can* bind a treasury chain
  (say, over 5 000 000 needs the finance director), **with no chain bound by default**.
- **C.** Route disbursement through the régie module's gates only.

> **Recommendation: B.** One seed row and one `executor.start`; the `onApproved` handler already
> dispatches on current status. It buys the amount-banded control the capability table was built for
> (`user_capability.min_amount_xaf` / `max_amount_xaf`) without hard-coding a threshold, and *"no
> workflow bound → autoApproved, manual path stays available"* is an established pattern here (W8),
> so B is strictly a superset of A. C would move the money control into the module that posts the
> ledger rather than the one holding the approval, inverting the current split.

**Answer:**

---

**Q15. The lifecycle gaps: rejection, and a request that is never fully paid.**

Two holes, one decision. `REJECTED` is terminal (`NEXT.REJECTED = []`) with no actor, timestamp or
reason — **worse than the legacy**, where `pr_save` accepted `DRAFT` and `REJECTED` and SUBMIT
accepted `from ∈ {DRAFT, REJECTED}`. And a part-paid request stays `PARTIALLY_DISBURSED` for ever,
holding committed budget against cash that will never move.

- **A.** Surface partial disbursement properly (payments table with date, amount, method, treasury
  account, advance ref, who paid, who received; a progress bar; `PARTIALLY_DISBURSED` in the KPI
  strip) and leave both holes as they are.
- **B. ⭐ A, plus `rejected_by`/`rejected_at`/`rejection_reason` (required) with `REJECTED → DRAFT`
  so a request can be fixed and re-submitted keeping its number; plus a `CLOSE_BALANCE` action
  (`approve`-gated, reason required) that closes a request at what was actually paid and **releases
  the unpaid commitment back to the budget**.
- **C.** B, but `CLOSE_BALANCE` fires automatically after a configurable number of days.

> **Recommendation: B.** Under Q2's commitment model, A has a slow leak — a request approved for
> 2 650 000 and paid 1 000 000 that everyone has moved on from holds 1 650 000 of budget for ever,
> and the file reads as fully committed against cash that will never move. And a terminal REJECTED
> means a mistyped MoMo number costs a whole document and its number, with the approver's reason
> recorded nowhere.
>
> `CLOSE_BALANCE` is the same shape as the régie module's existing `write-off` and `unage`
> (`approve`-gated, reason required). C automates a decision about money with no human in it; the
> régie policy window is the one place that is acceptable, and even there it only *reclassifies*.
>
> Sub-question, please answer inline: **should an instalment be allocated across lines?** My
> recommendation is **no** — a treasury window pays a tranche, not a per-line breakdown. Budget
> consumption stays at the **approved** line amounts (Q2) and is trued up at justification and at
> close. The per-line truth arrives when it is evidenced.

**Answer:**

---

**Q16. The voucher.**

The `CASH_REQUEST` template already has the tenant letterhead, printed method details, Subtotal /
VAT / **TOTAL PAYABLE**, and the legacy's three signature boxes. Against the rebuilt `COSTING`
document it lacks: real seals, the requisitioner grid, the payments table, and any budget context.

- **A.** Leave it. It prints the facts.
- **B. ⭐ Costing parity**: seals where they exist (ruled boxes as fallback, as the costing does), the
  legacy's requisitioner grid (name, employee ID, department, job title — it was good), a
  **Budget / Claimed / This request / Remaining** column set per line, the off-budget total called
  out, and the payments table once anything is paid.
- **C.** B, plus a separate one-page **payment receipt** per instalment, signed by the receiver.

> **Recommendation: B, and I would take C too if you want the receiver's ink on something specific.**
> The voucher is what a beneficiary signs and a cashier pays against, so the budget columns matter on
> paper for the same reason the amendment diff does on the costing: whoever signs should see what
> this claim does to the file.
>
> Do copy the legacy's requisitioner grid and its `COSTING REF` meta row. Do **not** copy the
> hard-coded MD signature image — `PROCUREMENT_PORT_LEGACY_ANALYSIS.md` §8 item 1 already lists it as
> do-not-copy, and the seal engine is the replacement.
>
> C is a fifth registry entry, not a variant of the fourth — say so now if you want it.

**Answer:**

---

### Group D — Compliance and the OCR seam (2 questions)

---

**Q17. The "justification required" tick — who sets it, and what does it gate?**

`cash_request_line.justification_required` exists (10746) as a free boolean nothing reads.
Separately, `dictionary_item` declares `receipt_requirement`, `requires_justification` and
`proof_source` (**0630**), consumed by `proof-obligation.service.js` — advisory by design, never
throws, and says so three times in its own header. Note from §2.4 that Port Charges and Customs
Duties are already `ALWAYS_REQUIRED` and THC is `CONDITIONALLY_REQUIRED` in the seeded catalogue.

- **A.** Manual tick, advisory everywhere (today's behaviour).
- **B. ⭐ Defaulted from the catalogue, editable UP but not DOWN** — an `ALWAYS_REQUIRED` item renders
  the control **disabled with its reason shown**, not hidden — **and advisory through submit /
  approve / disburse but BLOCKING at JUSTIFIED.**
- **C.** Catalogue-only with no per-line control, and blocking at disbursement.

> **Recommendation: B**, which is two decisions that belong together.
>
> On the *source*: this is the rule the costing line grid already applies to VAT and nature, and its
> comment is the argument — the legacy defaulted a VAT box to ticked and the sample sheet shows
> `#-1047 Customs Duties & Taxes` charged 19.25% VAT, on a customs duty. Catalogue decides, the user
> may be stricter, and the control that would contradict the catalogue is disabled **with its reason
> visible** rather than hidden. (The legacy's own import dropped the flag entirely through a missing
> argument — §1.3.)
>
> On the *gate*: C's half is what the proof-obligation service exists to argue against, and it is
> right — *"A freight forwarder pays a port authority in cash at 06:00 and gets the paperwork at
> 11:00; a system that refuses the disbursement until the receipt exists does not produce more
> receipts, it produces disbursements recorded outside the system."* But A never forces the receipt
> to arrive at all. B puts the wall at the only place where the paperwork is genuinely late rather
> than merely not-yet-arrived — and it is the wall OCR needs to be able to trust. Precedent exists:
> `justify` already refuses on an uncleared advance (`ADVANCE_NOT_CLEARED`).

**Answer:**

---

**Q18. The seam into OCR (Budget vs Actual). What does justification write?**

Today `justify` writes `spent_amount` on the lines and retires the advance. It writes **no
`cost_entry`** — so justified cash never appears as an actual, and `dossier_reconciliation` compares
an approved budget against actuals booked by an entirely different path. The legacy had the same
disconnect and solved it by having a human retype `actual_ttc` into `ocr_line`.

- **A.** Leave it. OCR reads `cost_entry`; spend is expected to be recorded through cost tracking
  separately.
- **B. ⭐ Justification writes one `cost_entry` per justified line**, tagged `dossier_id`,
  `dictionary_item_id`, `proof_vault_id`, plus new columns `cash_request_line_id` **and**
  `costing_line_id` — so Budget vs Actual is a **join**, not a match.
- **C.** OCR reads `cash_request` directly alongside `cost_entry`.

> **Recommendation: B. This is the decision that determines how much of the OCR module is left to
> build**, and it is worth thinking about hardest.
>
> A is the status quo: the same spend gets entered twice, or the file's actuals are simply
> incomplete. And `dossier_reconciliation.buildLines` currently drops any actual with no
> `dictionary_item_id` into an `UNMATCHED` bucket for a human to map by hand — a whole bucket that
> largely disappears if justification writes properly tagged actuals.
>
> C makes OCR read two sources with different shapes and reconcile them itself, which is the work B
> does once, upstream, where the facts are known.
>
> With B **plus Q7B**, the OCR module reduces to roughly: read the costing lines, join the tagged
> cost entries, compute variance, add the maker-checker wrapper it already has. The legacy's
> hand-typed `actual_ttc` becomes a derived number, and `doc_required` — which the legacy left
> hardcoded to `0` with an apologetic comment — comes from the catalogue for free.

**Answer:**

---

### Group E — Platform (2 questions)

---

**Q19. The permission vocabulary: Create · Read · Update · Delete · Export · Approve · Validate · Disburse?**

Today `permission` has exactly five booleans (`can_create`, `can_read`, `can_update`, `can_delete`,
`can_approve`). `rbac.js` maps `export → can_read` and `publish → can_update` with two standing
TODOs. There is no `can_validate` and no `can_disburse`. What *does* exist is the capability
overlay: `capability.code IN ('ISSUER','VALIDATOR','APPROVER','LINE_MANAGER')` and
`user_capability(document_type, min_amount_xaf, max_amount_xaf)`.

- **A.** Add three columns: `can_export`, `can_validate`, `can_disburse`. One eight-column grid.
- **B. ⭐ Add `can_export` only; express validate/disburse as CAPABILITIES** — add `DISBURSER` to the
  capability CHECK, gate `/disburse` on `requireCapability('DISBURSER')`, and migrate the grant to
  everyone holding `APPROVER` today so nothing breaks.
- **C.** Change nothing; `approve` + `APPROVER` already gates disbursement.

> **Recommendation: B**, and the split is the whole point:
>
> - **Export is a permission.** It is a right over *data* — taking a module's contents out of the
>   building — and it does not follow from read. A junior accountant may legitimately read payroll on
>   screen and not download it as a spreadsheet. Per role × module, no amount, no document type, a
>   boolean. It belongs in `permission`, and `rbac.js` has carried the TODO since it was written.
> - **Validate and disburse are separations of duty.** The real rule is *"Marie may disburse cash
>   requests up to 500 000; above that it is the finance director"* — and `user_capability` already
>   carries `document_type`, `min_amount_xaf` and `max_amount_xaf` to say exactly that. A boolean
>   column can never express it, so A ships a control that looks complete and quietly cannot encode
>   the policy you actually run. `VALIDATOR` already exists and is already what SUBMITTED → VALIDATED
>   means.
> - C conflates *"may approve the spend"* with *"may hand over the cash"* — the one pair
>   maker-checker most wants separated. The legacy separated them too, crudely, by department:
>   `$isFinanceActor` for disburse, `MANAGEMENT/ADMIN` for approve.
>
> Cost of B: one column, one enum value, one backfill, plus a sixth letter in the matrix
> (`client/src/lib/rbac.ts` `PERMS` / `PERM_LABEL` / `PERM_TITLE` and the matrix page's colour map)
> and a fourth card on the capability screen.

**Answer:**

---

**Q20. Notifications — who hears what, and on which channel?**

What already exists and works: per-user × per-category × per-channel preferences (in-app / email /
push), a batched `notify()` producer, categories including `approvals` and `finance`, RBAC-resolved
audiences, and `notify-approvals.js` for chain events. What is missing: **no `cash_request.*` or
`costing.*` key is in the `NOTIFIABLE` allowlist**, so outside a bound workflow chain nothing is
ever sent. The legacy had no notifications at all.

- **A.** Targeted only. Submit → the finance validators; validate → the approvers; approve → the
  requester and the cashiers; disburse → the requester and the receiver; justify → the requester.
  Nobody else, ever.
- **B. ⭐ A, plus the money events broadcast to the module audience** — add `cash_request.approved`,
  `.partially_disbursed`, `.disbursed`, `.justified` and `costing.approved` to `NOTIFIABLE` with
  `action: "view"`, category `approvals` (`DOMAIN_TO_CATEGORY` already maps both `cash_request` and
  `disbursal` there), so anyone with MOD-49 view sees the file's money move and can mute the
  category.
- **C.** B, plus a daily digest of everything awaiting the reader's decision and every advance past
  its policy window.

> **Recommendation: B, with C as a fast-follow.** A is the floor and it is safe. The reason to go to
> B: *"who was paid what against my file"* is genuinely wanted by people not on the approval path,
> the audience is already RBAC-scoped so it cannot leak, and every recipient can turn the category
> off — which is what makes broadcasting safe here and not in, say, mail.
>
> C is where this should end up — an aging régie advance nobody is looking at is the exact failure
> mode OHADA KB §6.8 warns about — but it needs a scheduled job and deserves its own change.
>
> Please answer inline: **should approval and disbursement notifications default email ON, or in-app
> only?** My recommendation is **in-app by default, email opt-in, except a rejection**, which is HIGH
> priority and emails (the pattern `notify-approvals.onOutcome` already sets).

**Answer:**

---

## 6. Things I recommend we do NOT copy

Stated so they are decisions rather than omissions. All six are legacy behaviours I read this pass.

1. **The comma-joined `operations_file_master.cash_request_id` accumulator.** On approval the legacy
   appends the PR id to a comma-separated string column and adds the amount to a running
   `cash_request_amount`. Already listed as do-not-copy in `PROCUREMENT_PORT_LEGACY_ANALYSIS.md` §8
   item 2. Our file money view derives from the children.
2. **The whole denormalised money strip on the operations file** — `costing_id`, `costing_ref`,
   `total_ht`, `cash_request_id`, `cash_request_amount`, `ocr_id`, `ocr_amount`, `ocr_status`,
   `ocr_linked_at`, `proforma_invoice_id/amount`, `final_invoice_id/amount`,
   `margin_simulator_id/amount`, `margin`, `quote_amount`. Fifteen columns that are a cache of other
   tables and go stale the first time anything is voided.
3. **`cost_tracking`'s hardcoded 15-item `COST_ITEMS` array and its money-derived status.**
   `calculateStatus` returns `COMPLETED` when `totalCost − totalAdvance <= 0`.
   `doc/COST_TRACKING_LEGACY_COMPARISON.md` §5 already flags this shape; the catalogue is data here.
4. **The ±1 XAF disbursement tolerance.** `if ($newTotal > ($total + 1.0))` and
   `($newTotal >= ($total - 1.0)) ? 'DISBURSED' : …`. Our `disbursementState` compares exact rounded
   money and refuses over-payment; a tolerance that closes a request one franc short is a rounding
   bug with a status attached.
5. **The date-based read-then-write numbering** (`SLAS-PR-{Ymd}-{seq}` selected with `ORDER BY pr_id
   DESC LIMIT 1`, then incremented). Two concurrent requests get the same number. The atomic
   `doc_sequence` upsert is the fix and already exists.
6. **The hard-coded MD signature image** stamped on every approved voucher, and the hard-coded
   company identity in the print block. Per-tenant branding plus the seal engine replace both.

---

## 7. Proposed three PRs

Sequenced so each is independently shippable and nothing is half-built between them.

### PR 1 — The budget ledger (schema + backend)

Migration `12771_cash_request_budget.sql`: `costing_line_id`, `qty`, `unit_cost`, `line_no`,
`source` on `cash_request_line`; `currency`, `exchange_rate_to_xaf`, `amount_xaf`,
`costing_revision`, `approved_at`, `rejected_by/at/reason` on `cash_request`;
`received_by/at/ack_kind` on `cash_request_payment`; `cash_request_line_id` + `costing_line_id` on
`cost_entry`; `REJECTED → DRAFT` and `CLOSED_SHORT` in the status CHECK.

Service: the consumption read (`GET /costings/:id/budget` → Budget · Committed · Disbursed ·
Remaining per line), import carrying provenance and defaulting to Remaining, the over-budget checks
from Q3, off-budget handling (Q4), `CLOSE_BALANCE`, rejection with a reason, diff-based
`replaceLines` keyed on `line_no`, and `GET /cash-requests/kpis` (the list KPI strip is computed
client-side from one page today, so it is wrong past 50 rows).

Tests: consumption across several requests; over-budget refusal at approve; the amendment case;
instalments unchanged; rounding.

### PR 2 — The worksheet, the chain, the notifications

`cash-request-360.tsx` on `Record360Page`; the line grid with the four money columns and the
justification tick; the file → costing → lines flow with the STOP/Approved banner; the payments
table with a progress bar; disburse and receive dialogs; the workflow rail. `disbursal.approved`
event + seed (Q14). `NOTIFIABLE` entries and the notification wiring (Q20). `can_export` +
`DISBURSER` with the matrix and capability screens (Q19).

Tests: the 360 render, the actions each status offers, the RBAC shape, a non-CEO walkthrough
(`PERMISSION_SWEEP_BACKLOG.md` §D: *"there is no test that exercises the product as a non-CEO
user"*).

### PR 3 — Signatures, the voucher, and the OCR seam

`CASH_REQUEST` in `SIGNATURE_CEILING` + `signature_policy` seed; `sealTransition` on validate,
approve, disburse and receive; the rebuilt voucher (Q16); `justify` writing tagged `cost_entry` rows
(Q18); the compliance gate at close (Q17); the `costCompare` change from Q7 (débours sectioned in,
`GROUP BY costing_line_id`).

Tests: the seal at each transition, the document snapshot, one actual written per justified line,
and a reconciliation that now shows the three débours lines from §4.

---

## 8. Appendix A — the legacy schema, reconstructed

**You asked whether I have the backend schema. There is no SQL dump anywhere in
`doc/reference/legacy_codebase` — I checked (`find . -iname "*.sql"` returns nothing).** What
follows is reconstructed from every SQL statement in the PHP: `INSERT` column lists, `UPDATE … SET`
clauses and `SELECT` projections. It is complete for every column the code touches and silent about
any column it never names. Types are inferred from `bind_param` type strings.

### `cash_request_master`
```
pr_id                   varchar  PK   'SLAS-PR-20260115-0001'
category                enum-ish      'OPS' | 'OVH'
disburse_method         enum-ish      'CASH' | 'BANK' | 'CHEQUE' | 'MOMO'
ops_file_ref            varchar  FK → operations_file_master.operations_file_reference
client_id               varchar       denormalised from the ops file
sea_bl                  varchar       denormalised from the ops file
cost_center             varchar       OVH only
overhead_justification  text          OVH only
bank_name               varchar       also holds the MoMo NETWORK — one column, two meanings
account_number          varchar
account_name            varchar
momo_number             varchar
momo_name               varchar
cheque_number           varchar
beneficiary             varchar       mandatory
remarks                 text          prints on the PDF
amount_total            decimal       Σ line_total (TTC)
disbursed_total         decimal       running total, INCREMENTED (not recomputed)
disbursed_time          datetime      first payment only
status                  varchar       DRAFT | SUBMITTED | VALIDATED | APPROVED_LOCKED
                                      | PARTIALLY_DISBURSED | DISBURSED | REJECTED
created_by / created_at        employee_id, datetime
updated_by / updated_at        employee_id, datetime
validated_by / validated_at    employee_id, datetime
approved_by  / approved_at     employee_id, datetime   (cleared on REJECT)
rejected_by  / rejected_at     employee_id, datetime   (cleared on APPROVE)
```

### `cash_request_lines`
```
line_id                 int  PK AUTO_INCREMENT
pr_id                   varchar FK
line_code               varchar      the financial-dictionary code
line_desc               varchar
qty                     decimal
unit_cost               decimal
vat_rate                decimal      percent, default 19.25
line_total              decimal      qty × unit_cost × (1 + vat_rate/100), TTC
is_imported             tinyint      1 = came from the costing → rendered read-only
justification_required  tinyint      the "Just. Req?" tick
                        ── NO costing_line_id. This is the hole. ──
```

### `cash_request_payments`
```
pay_id        int PK AUTO_INCREMENT
pr_id         varchar FK
paid_amount   decimal
paid_by       varchar   employee_id
paid_at       datetime
note          varchar   "Ref no, Cheque no…"
              ── no treasury account, no receiver, no ledger link ──
```

### `costing_master`
```
costing_id, costing_ref, operations_file_reference, client_id, client_name_cached,
client_bill_to, service_type, service_territory, currency, exchange_rate_to_xaf,
total_ht, total_vat, total_ttc, status, costing_date, remarks,
validator_employee_id, validated_by_user_id, validated_at,
approved_by_user_id, approved_at, locked_at, approval_auth_code
```
Statuses: `DRAFT | SUBMITTED_FOR_VALIDATION | SUBMITTED_FOR_APPROVAL | APPROVED_LOCKED |
UNLOCK_REQUESTED | REJECTED`. (`get-approved.php`:51 filters on `status = 'APPROVED'`, which no
transition ever sets — a live bug in the legacy: that endpoint always 404s.)

### `costing_line`
```
costing_line_id, costing_id, line_no, item_code, item_description,
qty, unit_cost, vat_applicable, vat_rate, total_ht, total_vat, total_ttc
```
Server-side default VAT `0.1925`; `qty <= 0` coerced to 1.

### `ocr_master` / `ocr_line`
```
ocr_master: ocr_id ('SLAS-OCR-1001'), operations_file_reference, costing_id, costing_ref,
            client_id, client_name_cached, service_type, service_territory,
            status (DRAFT|SUBMITTED|VALIDATED|REJECTED), total_budget_ttc, total_actual_ttc,
            created_by_user_id, created_at, updated_at

ocr_line:   ocr_id, costing_line_id ← MANDATORY, line_no, item_code, item_description,
            budget_ttc, actual_ttc, doc_ref, doc_required, created_at, updated_at
```

### `cost_tracking_ledger` / `cost_entries`
```
cost_tracking_ledger: ledger_id, operations_file_reference, manual_status
cost_entries:         ledger_id, item_name (from the hardcoded 15-item COST_ITEMS),
                      actual_cost, advance_received, notes, updated_at
views:                view_cost_tracking_master, view_cost_item_details
```

### `operations_file_master` — the money strip
```
costing_id, costing_ref, total_ht,
cash_request_id (COMMA-JOINED string), cash_request_amount,
ocr_id, ocr_amount, ocr_status, ocr_linked_at,
proforma_invoice_id, proforma_invoice_amount,
final_invoice_id, final_invoice_amount, final_invoice_due_date,
margin_simulator_id, margin_simulator_amount, margin, quote_amount,
operations_status
```

---

## 9. Appendix B — verification

Every factual claim above was read out of the tree. This appendix says what was read and, separately,
what is inference.

### 9.1 Legacy — read this pass

| File | Lines | Coverage |
| --- | --- | --- |
| `view/finance/cash-request.php` | 3 242 | **complete** — six AJAX endpoints, all JS (state, ops search, `checkCostingLink`, `addLine`, `recalcLine`, `recalcTotal`, `loadImportLines`, `executeImport`, `saveRequest`, `submitDisbursement`, `fillBalance`), the modals, the print voucher |
| `view/admin/cash-request.php` | 3 218 | **complete** — the copy you named; sidebar, KPI grid, register table, request modal, import modal, disburse modal |
| `view/{operations,management,sales}/cash-request.php` | 3 194–3 210 | diffed against finance: **0** differing lines in the PHP half |
| `view/archive/financ/cash-request.php` + 7 other archives | 2 272–3 194 | endpoint inventory + budget-term grep: no removed logic |
| `api/costing/{save,transition,get-approved,ops-file-details}.php` | ~430 | complete |
| `api/ocr/{file_context,save_draft}.php` | 373 | complete |
| `api/cost-tracking/cost-tracking-api.php` | 493 | routing, `COST_ITEMS`, `getTrackerData`, `getFileDetails`, `calculateStatus`, `saveCosts` |
| `admin/{costing-module,operational-cost-reconciliation}.php` | 4 308 | grepped for cash/disbursement awareness (§0) + OCR budget columns |

### 9.2 Praxis LS — read

`cash_request/*` (all 8 files, 861 lines, complete) · `costing.service.js` (652, complete) ·
`costing.routes.js` · `costing.rules.computeCosting` · `rbac.js` (256, complete) ·
`notify-events.js` (136, complete allowlist) · `categories.js` · `notify-approvals.js` (90,
complete) · `proof-obligation.service.js` · `dossier_reconciliation.{service,repo,rules}.js` ·
`cost_tracking.service.js` · `regie.routes.js` · `presets.js` · `executor.js` ·
`document_vault.types.js` (`SIGNATURE_CEILING`, complete) · `template.service.js` (`CASH_REQUEST`
and `COSTING` projections) · `templates/registry.js` (both templates + `LINE_COLS`) ·
`cash-request-actions.tsx` (424, complete) · `pages.tsx` (cash-request sections) ·
`costing-lines.tsx` · `costing-api.ts` · `rbac.ts` · migrations `0110`, `0320`, `0342`, `0630`,
`10719`, `10721`, `10722`, `10746`, `12766`, `12768` · seeds `9080`, `9081`, `9097` ·
`doc/OHADA_KB.md` §§6.7–6.8, `PROCUREMENT_PORT_LEGACY_ANALYSIS.md` §§6.7–8,
`PERMISSION_SWEEP_BACKLOG.md`.

### 9.3 Load-bearing claims and their proof

| Claim | Verified by |
| --- | --- |
| Legacy costing and OCR modules have zero cash-request awareness (§0) | `grep -in "cash\|disburs\|advance"` on both views → one sidebar `<a href>` each |
| `cash_request_lines` has no `costing_line_id` (§0, §8) | the sole `INSERT INTO cash_request_lines (...)` column list, plus every `crm.`/line column referenced across the file |
| `ocr_line.costing_line_id` is mandatory (§0, §1.6) | `save_draft.php`: `must_str($l['costing_line_id'] ?? null, "lines[$i].costing_line_id")` |
| The five departmental copies share one implementation (§1.1) | `diff` of lines 1–960: finance vs operations/management/sales = 0; vs admin = 24, all avatar handling |
| No budget logic was removed from the archives (§1.1) | endpoint inventory (same six) + `grep -in "remaining\|consumed\|budget"` → no hits |
| All three example items are DISBURSEMENT (§2.4) | seed `9080` lines 328/397/416 sit inside the `SELECT 'DISBURSEMENT'` block opening at line 298; `resolveDisbursement` returns true for that direction |
| Their receipt requirements (§2.4, Q17) | `_dict_seed` column order (9080:185) mapped onto those three VALUES rows |
| `costCompare` excludes débours and groups by item (§2.4, Q7) | the query, read in full: `AND COALESCE(cl.is_disbursement,false) = false` … `GROUP BY cl.dictionary_item_id` |
| The costing is already a TTC cash budget (Q8) | `computeCosting`: débours net into `total_ht`, upstream VAT into `vat_total`, and the 12768 comment |
| `cash_request` has no currency / `approved_at` / rejection fields (§2.3) | complete column set = `0342` + `10719` + `10721` + `10722` + `10746`; none adds them |
| `justify` writes no `cost_entry` (§2.3, Q18) | full read: `replaceLines`, `checkProof`, `regie.retireCore`, `repo.update`, `audit`. Nothing else. |
| No `cash_request.*`/`costing.*` in `NOTIFIABLE` (§2.3, Q20) | full read of the allowlist — 30 keys, none from either domain |
| `CASH_REQUEST` not in `SIGNATURE_CEILING` (Q12) | full read: 8 entries, `COSTING` last, `CASH_REQUEST` absent → `signaturePolicyFor` → `NOT_SIGNABLE` |
| `PATCH /cash-requests/:id` has no caller (Q9) | `grep -rn "cash-requests/\${" client/src` → 5 hits, no PATCH |
| `permission` has five booleans; no `can_export` anywhere (Q19) | `0110_rbac.sql` + `grep -rn "can_export\|can_validate\|can_disburse"` → only the two TODO comments in `rbac.js` |
| Dictionary compliance columns are in **0630** | `grep -rln "receipt_requirement" migrations/tenant/` → `0630_financial_dictionary_360.sql`, sole hit |
| Next free migration number is 12771 (§7) | highest existing is `12769_containers_per_box_shipping.sql` |

### 9.4 What is still inference, not fact

1. **I ran nothing.** No migration applied, no test executed, no server started. Static reading only.
   If runtime behaviour contradicts a path described here, the runtime is right.
2. **There is no legacy SQL dump.** §8 is reconstructed from the SQL inside the PHP — complete for
   every column that code touches, silent about any column it never names. Types are inferred from
   `bind_param` strings, so `decimal` precision and nullability are unknown.
3. **Tenant seed state is unverified at runtime.** Whether a given tenant actually has a workflow
   bound to `disbursal.requested` / `disbursal.validated` depends on `0492`/`10722` finding roles to
   bind to — both `RAISE WARNING` and continue if they did not.
4. **§4's VAT treatment is illustrative.** I assert the *mechanism* (a débours carries the supplier's
   VAT as budgeted cash, per 12768). Whether customs duties in your practice carry advanceable VAT is
   a business fact I am taking from the seed's `vat` tag, not from an invoice. Q8 is where you correct
   it.
5. **Q2's commitment model is a design judgement, not a finding.** Neither codebase implements budget
   consumption, so there is no precedent to be faithful to; the argument is from the failure mode.
6. **Q13's "the holder is the receiver" is an accounting reading** of `Dr 581 / Cr 521` and OHADA KB
   §6.8. If in your practice the beneficiary signs and the holder is a courier, that inverts it.
7. **No effort estimates.** The PRs are sequenced, not sized.

---

## 10. DECISIONS — answered by the owner, 2026-09-04

Recorded here because the engineering guide, the migrations and the PR
descriptions all cite them, and a decision that lives only in a chat log is a
decision the next engineer will re-litigate.

| Q | Topic | Decision |
| --- | --- | --- |
| 1 | Line ↔ `costing_line` link | **B** — `costing_line_id` on `cash_request_line`. |
| 2 | Budget consumed by | **B** — committed (approved and not settled short), with disbursed shown alongside. |
| 3 | Over-budget gate | **B**, extended: warn on the worksheet; at submission demand a **written reason** and point at the costing (deep link) suggesting an unlock; **refuse at approve**. |
| 4 | Off-budget lines | **A** — none. **No money leaves without a costing.** A late detention charge is amended into the budget with a logged reason and re-approved; the process has to be seamless, not permissive. |
| 5 | Approved-costing prerequisite | **A** — at submission. At creation the request declares whether it is against an operations file (then the file is **mandatory**) or an overhead (which behaves like an expense tracker). |
| 6 | Costing amendment vs in-flight requests | **B**, with the model stated: **one budgetary line per file**. Port Charges 150 000, claimed 100 000 → 50 000 left. Amend to 200 000 → 100 000 left, claimable by another request. Amend to 95 000 → over budget, the reason shows the costing was reduced, and the 5 000 is reallocated or refunded **in reconciliation**. |
| 7 | Débours in the ledger | **A** — **every line.** The ledger covers the whole sheet; the reconciliation grid is out of scope here (see Q18). |
| 8 | Money unit and currency | **B** — TTC, currency picked from the costing at the start, rates from the daily FX cron. |
| 9 | Worksheet route | **B** — mirror the costing sheet. |
| 10 | Line seeding | **B** — lines arrive on file pick; overheads get the financial-dictionary picker instead. |
| 11 | Line shape | **B** — qty × unit_cost + VAT, and a justification checkbox defaulted from the financial dictionary but overridable. |
| 12 | Signature capture | **B** — mirror the costing's seals. The three parties are the **Requestor**, the **Approving Authority** and the **Disbursing Authority**. |
| 13 | Who receives | **A** — the régie holder. |
| 14 | Disburse as a bindable chain | **B** — `disbursal.approved`, no chain bound by default. |
| 15 | Rejection + close-balance | **B** — reason required, `REJECTED → DRAFT`, and `CLOSE_BALANCE`. |
| 16 | The voucher | **C** — costing parity **plus a separate payment receipt**, signed by **two** (disbursing authority and requestor; the requestor's signature is already on the request itself). The receipt carries the request's details, the approval date, the amount disbursed and the balance still to be disbursed; a request shows every receipt raised against it. |
| 17 | Justification tick | **B** — catalogue-derived, overridable upward, blocking at close. |
| 18 | The OCR seam | **B in principle, OUT OF SCOPE for these three PRs.** OCR is a later module; nothing here writes `cost_entry` or touches `costCompare`. |
| 19 | Permission vocabulary | **A** — real columns: `can_export`, `can_validate`, `can_disburse`. |
| 20 | Notifications | **B**. And: **validation is a visa, not a signature.** Finance validates against funds and the budget — so the validator and the approver each get a **budgetary control summary** flagging anything unbudgeted or over budget. |

### What these answers changed about the plan

- **Q4 = A removed a whole feature.** There is no `OFF_BUDGET` line kind and no
  `source` value for one. `assertFundable` refuses to submit an OPS request any
  of whose lines is not drawn from the costing (`EVERY_LINE_NEEDS_BUDGET`).
- **Q3's reason + deep link** turned a boolean gate into a two-stage one:
  `OVER_BUDGET_REASON_REQUIRED` at submission carries `costing_id` and
  `doc_number` so the screen can offer the unlock in one click, and
  `OVER_BUDGET` at approval is a flat refusal.
- **Q6 made the ledger read the LIVE costing line**, never an approval
  snapshot: amending the budget is how the balance is meant to move.
  `costing_revision` is stamped on the request for audit only.
- **Q6 also forced a change to the COSTING module** that was not in the
  original plan. `replaceLines` deleted and re-inserted every line on every
  draft save, so `costing_line_id` changed on every amendment — the budget link
  would have broken at exactly the moment Q6 is about. It upserts in place now,
  keyed on the logical identity `diffLines` already used.
- **Q18 being out of scope** means `cost_entry` is untouched and
  `dossier_reconciliation.costCompare` still excludes débours from its line
  grid. That remains a known gap, recorded in §2.4, for the OCR module to close.
- **Q19 = A** added three columns rather than one, and the AI path's action map
  had to move with `rbac.js` so an assistant is never gated more loosely than a
  person at a screen.

---

## 11. Answer summary

| Q | Topic | Your answer |
| --- | --- | --- |
| 1 | Line ↔ `costing_line` link | |
| 2 | Budget consumed by committed or disbursed | |
| 3 | Over-budget gate | |
| 4 | Off-budget lines | |
| 5 | Approved-costing prerequisite (+ OVH exemption) | |
| 6 | Costing amendment vs in-flight requests | |
| 7 | **Débours in the ledger and in the reconciliation grid** | |
| 8 | **HT or TTC, and currency** | |
| 9 | Worksheet route | |
| 10 | Line seeding UX | |
| 11 | Line shape (+ read-only imports?) | |
| 12 | Signature capture | |
| 13 | Who receives | |
| 14 | Disburse as a bindable chain | |
| 15 | Rejection + close-balance + partial visibility (+ per-line allocation?) | |
| 16 | The voucher (+ separate receipt?) | |
| 17 | Justification tick: source and gate | |
| 18 | The OCR seam | |
| 19 | Permission vocabulary | |
| 20 | Notifications (+ email default) | |
