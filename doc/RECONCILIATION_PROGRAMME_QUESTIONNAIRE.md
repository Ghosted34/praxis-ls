# Praxis LS — Reconciliation revamp: full legacy + codebase read, and a 21-question decision sheet

**Revision 1.** Written after reading the legacy OCR module end to end — the 1 662-line view, all
nine `api/ocr/` endpoints, and both departmental copies — plus every line of what Praxis LS ships
today: `dossier_reconciliation/*`, the budget ledger that landed with the costing revamp, and the
cash request's justification path. The legacy is not in the working tree any more (it was removed in
`dd824a7`); I read it out of git history at `ad1ab69`, and §9.1 lists exactly what.

**Purpose.** The costing became the budget (migration `12766`–`12774`). The cash request became the
draw-down against it (migration `12771`, shipped through #308–#312). Reconciliation is the third
leg: what was **actually** spent, evidenced, against what we authorised. The cash-request questionnaire deferred this deliberately —
its **Q18 answer was "B in principle, OUT OF SCOPE for these three PRs. OCR is a later module."**
This is that module, and this document asks the questions whose answers become
`doc/RECONCILIATION_ENGINEERING_GUIDE.md` and the PRs in §7.

**How to use it.** Answer inline under each **Answer:**. Where you are happy with my recommendation,
write `Rec`. Return the file and I will produce the engineering guide — migrations, module trees,
endpoints, component trees, acceptance criteria, test plan.

---

## 0. The finding that reorders everything

> **The screen you described cannot be built on today's reconciliation, because today's
> reconciliation has no way for a human to enter anything at all.**

That is not a criticism of it — it is a different design, built on purpose, and the purpose is
written down. But it is the opposite of what you asked for, so it is the first thing to settle.

Your sentence was: *"we ask one question, did it require justification, if yes, upload the
justification, and manually enter the amount that was actually spent."* Three verbs — **ask**,
**upload**, **enter**. Here is what the shipped module does with each:

| Your verb | Today |
| --- | --- |
| **ask** — did this line need justification? | `doc_required` is computed server-side from `dictionary_item.receipt_requirement` and never shown as a question. Nobody is asked. |
| **upload** the justification | There is no upload. `dossier_reconciliation_line.doc_ref` is a `text` column, and `buildLines` writes `doc_ref: null` (`dossier_reconciliation.service.js:42`) on every line. **No route ever writes it.** The UI's "Proof" column can therefore only ever render `Required` or `—` (`reconciliation.tsx:179`). |
| **enter** the amount actually spent | `actual_ht` is a `SUM(cost_entry.amount)` (`dossier_reconciliation.repo.js:113-118`). There is **no line-edit API** — the service says so in a comment, twice, as a *safety property*: *"DRAFT only — there is no line-edit API, so no human-entered field is lost."* |

So the module is a **read-only projection of the ledger** with a maker-checker signature on top. It
is a good projection. It is not the sheet you described.

And there is a second half to the finding, which is worse:

> **The one place in the product that *does* ask for a spent amount — the cash request's Justify
> form — is, for any line the catalogue obliges, a dead end that can never be completed.**

`cash_request.service.js:1044` refuses to close a request while any line has
`justification_required = true` and no `proof_vault_id`:

```js
const owed = stored.filter((l) => l.justification_required === true && !l.proof_vault_id);
if (owed.length) throw new AppError("PROOF_REQUIRED", …, 422);
```

The column exists. The check is right. But `JustifyForm` sends exactly this
(`cash-request-actions.tsx:236-244`):

```js
lines: lines.map((l) => ({
  dictionary_item_id, label, budget_amount, spent_amount, is_disbursement,
}))
```

No `proof_vault_id`. No `cash_request_line_id` either. And `proof_vault_id` is **not on the
`CashLine` type at all** (`costing-api.ts:696-719`) — so no screen in the tenant app can attach a
proof to a cash-request line, and the only proof field anywhere in this domain is a bare text box
labelled *"Proof document id"* where a user pastes a uuid (`regie-detail.tsx:313-321`).

**Net: `PORT_CHARGES` is seeded `ALWAYS_REQUIRED` (seed 9080:397). A cash request carrying it can be
raised, approved and disbursed — and then can never be justified by anyone, because the proof it
demands has no way in.** Your ask is not a feature request on top of a working flow. It is the
missing half of one that is currently a cul-de-sac.

---

## 1. What the legacy actually did

Read in full from git history (`git show ad1ab69:…`): `view/admin/operational-cost-reconciliation.php`
(1 662 lines — markup, the print engine, and all ~750 lines of JS), plus `api/ocr/file_context.php`,
`save_draft.php`, `submit.php`, `validate.php`, `reject.php`, `get.php`, `list.php`, `files.php`
(643 lines total). §9.1 has the inventory.

### 1.1 The screen

A register (`OCR ID · Date · File Reference · Client/Service · Budget · Actual · Status`) under four
KPI tiles — *Active Reconciliations*, *Total Budget Managed*, *Actual Spend*, *Closed Variance
(Efficiency Rate)* — and a full-screen modal in three panes:

```
┌── 1. File Context ──────┐┌── 3. Cost Lines (Mandatory Validation) ──────────────┐
│ Select Operations File  ││  Code │ Description │ Budget │ Actual Spent │ Variance │ Doc Ref
│ Client / Service / Ref  ││  ───────────────────────────────────────────────────────────────
├── 2. Performance Viz ───┤│  (read-only)        (read-only)  (typed)     (derived)  (typed)
│   ▄▄        ▄▄          ││
│  BUDGET vs ACTUAL       ││            Net Variance: 0 XAF
│  Variance Grade         ││
│     EFFICIENT           ││
└─────────────────────────┘└──────────────────────────────────────────────────────┘
```

**The interaction is exactly the one you described.** `Actual Spent` is a typed `<input
type="number">` with `oninput="updateLine(i)"`; `updateLine` recomputes that row's variance, recolours
it (`row-overrun` / `text-danger`), and calls `calculateTotals()`, which re-foots the sheet, re-scales
both bars off one shared denominator, and re-grades:

```js
if (totAct === 0)        gradeEl.innerText = "PENDING";
else if (netVar >= 0)    gradeEl.innerText = "EFFICIENT";  // "Under Budget by 12.4%"
else                     gradeEl.innerText = "OVERRUN";    // "Budget Exceeded by 8.1%"
```

That is the "at first glance, updated real time" you asked for, and it is worth copying — it costs
no infrastructure at all, because it is arithmetic on state the browser already holds.

### 1.2 Where the budget came from

`file_context.php` refuses anything but `APPROVED_LOCKED`, then reads the costing's lines directly:

```php
'costing_line_id' => (string)$r['costing_line_id'],
'line_no'         => (int)$r['line_no'],
'code'            => $r['item_code'],
'desc'            => $r['item_description'],
'budget_ttc'      => (float)$r['total_ttc'],   // the budget IS the costing line, TTC
'doc_required'    => 0                          // "Placeholder until you implement
                                                //  expense dictionary mapping"
```

Three facts in five lines, and all three matter here.

1. **The grain is `costing_line_id`, not the dictionary item.** `save_draft.php` makes it
   *mandatory* — `must_str($l['costing_line_id'] ?? null, "lines[$i].costing_line_id")`.
2. **The unit is TTC**, because a budget is cash.
3. **`doc_required` was never implemented.** It is a hardcoded `0` with a comment admitting it. So
   the "did it require justification?" question — the one you put at the centre — is the one thing
   the legacy left as a stub.

### 1.3 What "justification" meant there

`doc_ref` is a **text input**. `Doc Ref / Notes`, placeholder `REQ: Invoice/Receipt Ref…`. You typed
an invoice number. Nothing was ever attached, stored, or verifiable. The only gate was at submit:

```sql
SELECT COUNT(*) AS missing FROM ocr_line
 WHERE ocr_id=? AND doc_required=1 AND actual_ttc > 0
   AND (doc_ref IS NULL OR TRIM(doc_ref) = '')
```

— and since `doc_required` was always `0`, that query **always returned zero**. The control existed
and never once fired.

### 1.4 The workflow, and the hole in it

```
DRAFT ──submit──> SUBMITTED ──validate──> VALIDATED
  ↑                    │
  └── REJECTED <───────┘   (reason required, re-editable)
```

`validate.php` stamps `ocr_id`, `ocr_amount`, `ocr_status='VALIDATED'`, `ocr_linked_at` onto
`operations_file_master`. That write-back is the thing that closed a file financially.

Two defects worth naming so we do not reproduce them:

- **`validate.php` grants `require_role(['ADMIN','FINANCE','OPERATIONS','MANAGEMENT'])`** while
  `submit.php` is `['ADMIN','OPERATIONS']`. Operations could validate its own submission. There is
  no maker-checker at all. (Our `dossier_reconciliation.service.validate` already refuses
  self-validation — keep that.)
- **`save_draft.php` deletes every line and re-inserts** (*"Simplest approach: delete + insert all
  lines (OK for drafts)"*). Every `ocr_line` id churns on every save, and it unconditionally writes
  `ocr_status = 'DRAFT'` back onto the ops file — so re-saving a **rejected** reconciliation silently
  relabels the file as being in draft.

### 1.5 What the legacy did NOT have, and it is the whole of your ask

- **No overspend reason.** A red row is red and that is the end of it. Nothing is required, nothing is
  recorded, nobody has to answer for it. You asked for the opposite: *"any variance that shows we
  spent more than we were supposed to we must enter a reason to justify."*
- **No upload.** Covered above.
- **No link to cash.** `grep -in "cash\|disburs\|advance" operational-cost-reconciliation.php` returns
  **one** hit — a sidebar `<a href>`. The module that knew what had been handed over could not tell
  this one. So `actual_ttc` was typed from memory or from a pile of paper on the desk.
- **One reconciliation per file, for ever.** `files.php` excludes any file that already has an OCR in
  `DRAFT|SUBMITTED|VALIDATED|APPROVED`. A file reconciled in March and re-opened in June has nowhere
  to put the June invoice.

---

## 2. What Praxis LS does today

### 2.1 The reconciliation module

`src/modules/costing/dossier_reconciliation/` — 768 lines across seven files, MOD-47, mounted at
`/costing/reconciliations`. Six routes: `GET /` (latest for a dossier), `GET /:id`, `POST /`
(draft), `POST /:id/submit`, `POST /:id/validate`, `POST /:id/reject`, plus two for AI suggestions.

What it does well, and should survive intact:

- **Maker-checker is real.** `SELF_VALIDATE` refuses the submitter (`service.js`), which the legacy
  never did.
- **Three questions, not one.** `computeVarianceBlock` answers *did we quote it right* (quoted −
  budget), *did we execute to plan* (budget − actual), *did we make money* (quoted − actual), with
  `margin_percent` and an R/Y/G flag. The legacy had only the middle one.
- **An AI matcher that proposes and never confirms.** Untagged `cost_entry` rows are scored against
  the costed items (`rules.proposeMapping`, 0.7 × name + 0.3 × amount, floor 0.45) and stored
  `PROPOSED`; confirming stamps `dictionary_item_id` onto the entry itself. Same rule as MOD-09.
- **`MeterGroup`** already draws budget-vs-actual on one shared scale, with a comment citing the
  legacy's `calculateTotals()` as its source.

### 2.2 The six gaps, ranked

| # | Gap | Consequence |
| --- | --- | --- |
| 1 | **No line-edit API; `actual` is a ledger aggregate** | Your entire flow — ask, upload, enter — has no endpoint. §0. |
| 2 | **No proof upload anywhere in the domain** | `PORT_CHARGES` is `ALWAYS_REQUIRED`; a cash request carrying it can be disbursed and never justified. §0. |
| 3 | **Débours are excluded from the line grid** (`repo.js:111`) | All three items in your own example are débours. They are collapsed into one header pair with no lines. §2.3. |
| 4 | **The grain is `dictionary_item_id`** (`repo.js:112`) | Two Port Charges lines on one costing become one row, and the row cannot be lined up against the budget bar the cash request draws on (which is keyed `costing_line_id`). |
| 5 | **`justify` writes no `cost_entry`** | The spent amounts operations already typed are invisible to the reconciliation. The re-typing the legacy forced is still forced. |
| 6 | **No overspend reason; no tolerance; no gate** | Nothing anywhere demands an explanation for an overrun. |

### 2.3 The finding that forces a decision you cannot dodge

Your example is **port charges**. Here is what the reconciliation does with it today:

```sql
FROM costing_line cl JOIN costing c ON c.costing_id = cl.costing_id
WHERE c.dossier_id = $1 AND c.status = 'APPROVED_LOCKED'
  AND COALESCE(cl.is_disbursement, false) = false     -- ← line 111: débours excluded
GROUP BY cl.dictionary_item_id                        -- ← line 112: grain is the ITEM
```

`PORT_CHARGES` (`#D096`), `CUSTOMS_DUTIES_TAXES` (`#D030`) and `THC` (`#D114`) all sit inside the
`SELECT 'DISBURSEMENT'` block of seed `9080` (line 298 onward). **All three are débours, so all three
are excluded**, and the screen shows your worked example as a single pair of header numbers with no
lines at all.

The exclusion is not a bug in its own frame. `11740_reconciliation_ht_and_disbursement.sql` put it
there on purpose, citing OHADA_KB §450: débours are pass-through, neither revenue nor cost, and must
not move the margin. For the **margin** question that is exactly right.

But it is the wrong frame for **cash**, and our own costing module already made the opposite call:

> *"12768: the supplier's VAT on a débours is now BUDGETED — it counts toward the sheet's VAT and
> TTC. **A costing is a cash budget, not a fiscal invoice**, so the VAT we hand the carrier is money
> we will spend, and the budget says so."*

So there are two true numbers with two different jobs:

| | Base | Débours | Answers |
| --- | --- | --- | --- |
| **Cash** | TTC | included | *We gave you 10 000. Where is it?* ← **your question** |
| **Margin** | HT | excluded | *Did this file make money?* ← OHADA, and what MOD-47 reports today |

**This is Q4 and Q5, and it is the pair I would think about hardest.** Everything else in this
document is shape; this is substance. Get it wrong and the reconciliation reconciles a budget the
cash request never drew on.

### 2.4 The budget ledger already exists — and this module does not read it

`GET /costings/:id/budget` (`costing.service.budget`, 12771) already returns, per `costing_line`:

| | Meaning | Source |
| --- | --- | --- |
| **Budget** | `qty × unit_cost` + the line's own VAT, TTC | `costing_line` |
| **Committed** | Σ claims from APPROVED-and-not-settled-short requests | `cash_request_line` |
| **Disbursed** | Σ paid, apportioned by the request's paid ratio | `cash_request_payment` |
| **Remaining** | Budget − Committed (may be negative, deliberately) | derived |

Four columns, keyed by `costing_line_id`, in TTC, covering **every** line including débours
(owner decision Q7 = *"every line"*). **The reconciliation is the fifth column — ACTUAL — and it is
the only one missing.** That framing is what most of §5 is about.

---

## 3. The model I am proposing, in one picture

```
  COSTING (APPROVED_LOCKED) — the file's budget, TTC, every line
  ├── L1 Port Charges      150 000
  ├── L2 Customs Duties  2 500 000
  └── L3 THC               236 115
                    │  costing_line_id
      ┌─────────────┼──────────────────────────────┐
      ▼             ▼                              ▼
  CASH REQ #1   CASH REQ #2                  (supplier invoice,
  claims L1+L2  claims L3                     posted straight to
  disbursed     …                             the ledger — no
  2 650 000                                   cash request at all)
      │                                              │
      │  justify: spent_amount + PROOF               │  cost_entry
      ▼                                              ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  RECONCILIATION — one line per costing line                  │
  │                                                              │
  │  Budget │ Committed │ Disbursed │ ACTUAL │ Variance │ Proof   │
  │  150000 │   150000  │   150000  │ 162000 │  -12000  │  📎 ✓   │
  │                                    ▲                  ▲      │
  │                      pre-filled, editable        uploaded,   │
  │                      (never blank-slate)         vault-backed │
  │                                                              │
  │  −12 000 → REASON REQUIRED ──> "Port raised the tariff on    │
  │                                 01/07/2026, circular 41/26"  │
  └──────────────────────────────────────────────────────────────┘
      │
      ▼  validate (maker-checker)
  writes cost_entry per line · stamps dossier.ocr_amount
```

**The one-sentence version:** the reconciliation line is the fifth column of a ledger that already
has four, it arrives pre-filled from what the system already knows, and the human's job is to
**confirm, evidence, and explain** — not to re-type.

---

## 4. Worked example — your numbers, end to end

Continuing the file from the cash-request questionnaire. Costing `CST-2026-0043` on
`SLAS-OPS-2026-0117`, `APPROVED_LOCKED`:

| Line | Item | Budget (TTC) | Just. req? |
| --- | --- | --- | --- |
| L1 | Port Charges | 150 000 | **yes** (`ALWAYS_REQUIRED`) |
| L2 | Customs Duties & Taxes | 2 500 000 | **yes** (`ALWAYS_REQUIRED`) |
| L3 | Terminal Handling (THC) | 236 115 | conditional |
| | | **2 886 115** | |

**Mon 06/07/2026.** `DF-2026-0011` claims L1 + L2 = 2 650 000. Approved.
**Tue 07/07.** Treasury releases 1 000 000 → `PARTIALLY_DISBURSED`, one régie advance.
**Fri 10/07.** The balance 1 650 000 is released → `DISBURSED`.

**Mon 13/07 — operations comes back with paper.** Two ways this can go, and Q7 is which:

*Today's intended path (broken):* they open Justify, type 162 000 against Port Charges and 2 480 000
against Customs — and the server refuses with `PROOF_REQUIRED`, because both lines are
`ALWAYS_REQUIRED` and the form has no way to attach the port invoice. **Nothing they can do
completes this.**

*The path I am proposing:* the Justify form grows the upload, so the same screen that asks "what did
you spend" also takes the evidence. Port invoice 162 000 + scan. Customs receipt 2 480 000 + scan.

**Mon 13/07 — reconciliation.** The reconciler opens the file's sheet. Nothing is blank:

| Line | Budget | Committed | Disbursed | **Actual** | Variance | Proof |
| --- | --- | --- | --- | --- | --- | --- |
| L1 Port Charges | 150 000 | 150 000 | 150 000 | **162 000** ⟵ from justify | **−12 000** | 📎 port-inv.pdf |
| L2 Customs | 2 500 000 | 2 500 000 | 2 500 000 | **2 480 000** ⟵ from justify | **+20 000** | 📎 customs.pdf |
| L3 THC | 236 115 | 0 | 0 | **0** ⟵ typed here | +236 115 | — |
| | **2 886 115** | 2 650 000 | 2 650 000 | **2 642 000** | **+244 115** | |

L1 is red and **blocks submission until a reason is typed**. L2 is green and is asked nothing. L3 was
never claimed and never spent — Q14 decides whether that is a variance at all or simply an unused
budget line.

**Wed 15/07 — the carrier's invoice lands in accounts payable**, 198 000 for THC, posted straight to
the ledger as a `cost_entry`. It never went through a cash request. **Q11 is whether that number
appears in this sheet automatically.** It must, or ACTUAL is understated by 198 000 and nobody
notices.

**Validation.** The submitter cannot validate. The validator sees the sheet and the reason on L1, and
stamps the file. Q3 decides whether validation also writes the `cost_entry` rows that make this the
ledger's truth and not merely a sheet.

---

## 5. The questions

Twenty-one questions, five groups. ⭐ marks my recommendation.

---

### Group A — What a reconciliation IS (6 questions)

---

**Q1. What is a reconciliation line?**

- **A.** One per `dictionary_item_id`, as today — two Port Charges lines on the costing collapse
  into one row.
- **B. ⭐ One per `costing_line_id`** — the row lines up 1:1 with the budget bar the cash request
  drew against, and with `cash_request_line.costing_line_id`.
- **C.** One per cash-request line — the reconciliation follows the money, not the budget.

> **Recommendation: B**, and the legacy agrees with itself here: `ocr_line.costing_line_id` was
> **mandatory** at save. So did we, three months ago, for the cash request — `12771` put
> `costing_line_id` on `cash_request_line` for exactly this reason, and 12771's own header explains
> why the costing had to stop churning line ids to make it safe.
>
> A cannot express your example. The costing legitimately carries two lines from one catalogue item
> (per-container demurrage — that is what `container_type_ref_id` is for), and today's `GROUP BY
> cl.dictionary_item_id` already fuses them. C inverts the question: a budget line nobody claimed
> (L3 in §4) would have no row, and an unspent budget line is precisely something a reconciliation
> should show.
>
> The `UNMATCHED` bucket (actuals naming no item) stays as a line with a null `costing_line_id` —
> see Q11.

**Answer:**

---

**Q2. Where does the ACTUAL number come from?**

- **A.** Typed, always, blank slate — the legacy's model.
- **B.** Derived, always, from `cost_entry` — today's model. Nothing is typed.
- **C. ⭐ Pre-filled from what the system already knows, and editable.** The line arrives carrying
  Σ `cash_request_line.spent_amount` + Σ untied `cost_entry.amount` for that budget line; the
  reconciler confirms it, or overrides it with a reason.

> **Recommendation: C**, and this is the single biggest "better than legacy" in the document.
>
> A is what made the legacy's actuals untrustworthy: the module that knew what had been handed over
> could not tell the module recording it, so someone retyped from paper. The cash-request
> questionnaire opened on exactly this — *"the same money was entered three times, in three shapes,
> and no two of them could be reconciled without a human."* Rebuilding A would be re-opening that
> hole on the last leg.
>
> B is honest but answers a different question than yours, and it cannot ever ask *"did it require
> justification?"* — a ledger aggregate has nobody to ask.
>
> C gives you the sentence you actually said. "We gave you 10 000 for port charges" is on the row
> before the reconciler touches it, **and so is the 10 200 operations already told us they spent**.
> Confirming is one click; the typing only happens where the system genuinely does not know.
>
> An override away from the derived figure is worth recording — `actual_source` on the line
> (`DERIVED` / `OVERRIDDEN`) plus the delta, so "who changed the number and why" is answerable in
> two years. I would not make the override *reason* mandatory unless you want it (say so below);
> the overspend reason in Q12 already catches the case that matters.

**Answer:**

---

**Q3. Does a validated reconciliation write `cost_entry` rows?**

This is the Q18 the cash-request sheet deferred. `justify` today writes `spent_amount` on the line
and retires the régie advance — and **no `cost_entry`**. So the general ledger and the reconciliation
can disagree, permanently, and neither is wrong on its own terms.

- **A.** No. The reconciliation is a management document; the ledger is fed by invoices and régie
  retirements only.
- **B. ⭐ Yes, at VALIDATE** — one `cost_entry` per line for the delta between what the ledger
  already holds for that budget line and the validated actual, tagged with `dictionary_item_id` and
  the `costing_line_id`. Validation becomes the posting event.
- **C.** Yes, at justify — `cash_request.justify` writes the entry, and the reconciliation stays a
  pure projection (i.e. Q2 = B follows).

> **Recommendation: B.** It is the only answer under which the number stamped on the file
> (`dossier.ocr_amount`), the number in `cost_entry`, and the number on this sheet are the same
> number by construction rather than by luck. It also gives the maker-checker signature something to
> be *about*: validating is not "I agree with this spreadsheet", it is "post it".
>
> Two things follow and I want them said out loud, because they are the cost of B:
>
> 1. **Delta, never gross.** If a supplier invoice already posted 198 000 against THC, validating an
>    actual of 198 000 must post **0**, not a second 198 000. The entry is
>    `validated_actual − already_posted_for_this_line`, and it can be negative.
> 2. **A validated reconciliation becomes hard to amend**, because unwinding it means reversing
>    postings. That is what Q6 is for.
>
> C is defensible and cheaper, but it leaves every actual that did not come through a cash request
> (§4, Wed 15/07) with no home, and it puts the posting behind a gate — `PROOF_REQUIRED` — that
> operations cannot always clear on the day.

**Answer:**

---

**Q4. HT or TTC — and do we carry both?**

Per §2.3 these are two different true numbers. `11740` deliberately renamed the columns to
`budget_ht` / `actual_ht` because they held HT and the old names lied.

- **A.** HT only, as today. Cash questions are answered in the cash request's budget ledger.
- **B.** TTC only — rename again, and the sheet is a cash document end to end.
- **C. ⭐ Both, explicitly: the LINE grid is TTC (cash), and a separate HEADER block reports the
  HT, débours-excluded margin.** Two bases, two names, never mixed in one column.

> **Recommendation: C.** Your question is a cash question — 10 000 went out, where is it — and cash
> is TTC; that is settled doctrine here (12768, and 12771's Q8 = *"TTC, currency picked from the
> costing"*). But the margin question is a *fiscal* question and is HT with débours out, and MOD-47
> already answers it correctly with an R/Y/G flag that Sales reads. Deleting either would be a
> regression for somebody.
>
> The discipline that makes C safe is the one `11740` was written to enforce: **a column is named
> for what it holds.** So `actual_ttc` / `budget_ttc` on the line (new columns — do **not** re-rename
> the existing `*_ht` ones), and the header keeps `*_ht` for the margin block, deriving service HT
> from the same lines by stripping VAT and débours.
>
> A and B each answer one of your two constituencies and silently mislead the other.

**Answer:**

---

**Q5. Are débours lines in the grid?**

- **A.** No, as today — pass-through, out of the variance (OHADA_KB §450).
- **B. ⭐ Yes, every line, with `is_disbursement` on the row and the margin block computed
  débours-excluded from the same rows.**
- **C.** Yes, but in a separate section below the service lines.

> **Recommendation: B**, and it is forced by your own example: Port Charges, Customs Duties and THC
> are **all three** débours. Under A the sheet you described renders empty.
>
> It is also what the costing already decided for the budget ledger — 12771's Q7 = *"**A** — every
> line. The ledger covers the whole sheet."* A reconciliation whose line set differs from the ledger
> it reconciles is not a reconciliation.
>
> Nothing about OHADA is violated, because the *margin* number stays débours-excluded — it just gets
> computed with a filter instead of being the only thing that exists. C is B with extra chrome; the
> `is_disbursement` flag and a sort order do the same job without splitting the footer.

**Answer:**

---

**Q6. One reconciliation per file, a living tally, or revisions?**

A file can run for months. The legacy allowed exactly one, for ever (`files.php` excludes any file
with an OCR). Today, one **open** at a time, and after VALIDATED the UI offers "New draft".

- **A.** One per file, final at validation — the legacy.
- **B.** A living sheet: one row per file, always editable, no workflow — just a tally.
- **C. ⭐ Revisions: one OPEN at a time, validation closes it, and a later event opens
  R2 pre-filled from R1 with only the deltas to review.** The file shows the latest validated
  figure; the history is intact.

> **Recommendation: C.** A cannot absorb the invoice that arrives after close, which is not an edge
> case — demurrage and detention routinely bill weeks late. B throws away the signature, which is
> the one thing that makes this a controlled document and the reason `dossier.ocr_amount` means
> anything.
>
> C is what the code almost does already (`openForDossier` allows one DRAFT/SUBMITTED; "New draft"
> exists) — it needs a `revision` integer, a `supersedes_id`, and R2 seeded from R1 rather than from
> scratch, so re-validating is reviewing three changed rows instead of re-keying forty.
>
> If Q3 = B, R2's postings are deltas against R1's, which falls out of the same "delta, never gross"
> rule.

**Answer:**

---

### Group B — The line, and the one question it asks (5 questions)

---

**Q7. Where is the actual entered and the proof attached — one screen or two?**

Right now there are two half-screens: Justify asks for the amount and cannot take the proof;
Reconciliation can take neither.

- **A.** Cash-request Justify only. The reconciliation stays read-only and consumes it (Q2 = B).
- **B.** Reconciliation only. Justify stops asking for `spent_amount`.
- **C. ⭐ Both, with one rule: Justify is where the person who HELD the cash accounts for it;
  reconciliation is where the file is closed.** Justify captures amount + proof per line;
  reconciliation pre-fills from it, takes the lines that never went through a cash request, and
  carries the variance reasons.

> **Recommendation: C**, because the two are done by different people at different times and the
> régie makes that non-negotiable: `justify` **retires the advance in the same transaction**
> (`regie.retireCore`), and the advance belongs to the holder who took the cash. That accounting has
> to happen when they come back, not when someone closes the file in August.
>
> A leaves §4's Wed-15/07 supplier invoice with no way in and no reason field. B breaks the régie
> retirement and makes the holder's discharge wait on the reconciler.
>
> C is also the smallest change: Justify needs the upload it should always have had, and
> reconciliation needs the line-edit API it has never had. Neither screen learns the other's job.
>
> **Whatever you pick here, the upload has to be added to Justify** — §0's dead end is a live defect
> in the shipped product, not a nice-to-have.

**Answer:**

---

**Q8. What replaces `doc_ref`?**

- **A.** Keep `doc_ref text` — an invoice number typed in, as the legacy did.
- **B. ⭐ `proof_vault_id uuid REFERENCES document_vault(doc_id)` — a real upload through the
  engine — with `doc_ref` kept alongside as the supplier's own reference.**
- **C.** An array — several documents per line.

> **Recommendation: B.** `cash_request_line.proof_vault_id` already exists with exactly this FK
> (`0342:87`); the reconciliation line should match it so a proof captured at justify is the *same
> row* the reconciliation shows, not a copy.
>
> A is what the legacy had and it evidences nothing — a typed invoice number is an assertion, and
> `document_verification` cannot check an assertion.
>
> The upload must go through `useUpload` / `<FilePicker>` + `<UploadList>` (CLAUDE.md's third
> frontend rule, `praxis/no-raw-upload`), with `profile="document"` — **never** `photo` or `avatar`,
> because auto-levelling a customs scan makes it stop matching the paper, and
> `document_signature.artifact_hash` is taken from the vault row's `content_hash`. `uploadVaultFile`
> (`masterdata-api.ts:909`) already takes `dossier_id` and `doc_type`, so the proof lands in the
> file's vault folder and is findable from the 360 view, not just from this sheet.
>
> C is a real need on long lines (three partial receipts for one charge) — but `document_vault`
> already supports several rows against one `entity_ref`, so we can get C's behaviour without an
> array column: the line stores the *primary* proof and the vault query returns the rest. Tell me if
> you want the list surfaced on the row.

**Answer:**

---

**Q9. Where does "did it require justification?" come from?**

- **A.** The catalogue, live — `dictionary_item.receipt_requirement` / `requires_justification`, as
  `buildLines` reads it today.
- **B. ⭐ Inherited from the cash-request line's stored tick, falling back to the catalogue for a
  line that never went through a cash request.**
- **C.** Asked fresh on the reconciliation, defaulted from the catalogue, overridable.

> **Recommendation: B.** 12771's Q11/Q17 settled that the tick is *"catalogue-derived, overridable
> upward, blocking at close"* — so `cash_request_line.justification_required` is a **decision
> somebody already made about this money**. Re-deriving it from the catalogue at reconciliation time
> silently discards that decision: a line ticked up to "required" by a validator would come back
> "not required" here.
>
> A is today's behaviour and loses the override. C asks the user a question the system can answer,
> which is the kind of friction that turns a control into a checkbox people clear.
>
> "Overridable upward, never downward" should hold here too: the reconciler may demand proof the
> catalogue does not, and may not waive proof the catalogue does.

**Answer:**

---

**Q10. Is missing proof blocking — and where?**

- **A.** Advisory everywhere. A compliance flag and a notification, never a refusal.
- **B. ⭐ Advisory while drafting; BLOCKING at submit** for any line with `justification_required`
  and `actual > 0` and no `proof_vault_id`.
- **C.** Blocking at validate, not submit — the validator decides.

> **Recommendation: B**, and it matches the rule the codebase already applies in three places:
> *never block someone recording reality; always block the act that makes it final.*
> `proof-obligation.service` raises WARN and never throws; `cash_request.justify` blocks at close
> with `PROOF_REQUIRED` and the comment *"the LAST moment the receipt can still be produced"*.
> Submit is that moment here.
>
> Note the `actual > 0` condition, which the legacy also had: a line that was budgeted and never
> spent owes no receipt. And the block must name the lines (the `AppError` detail carries them) so
> the screen can scroll to them rather than showing a bare 422.
>
> C puts the validator in the position of either bouncing the whole sheet or waiving a control, which
> is how controls get waived.

**Answer:**

---

**Q11. Spend that never went through a cash request — and spend with no budget line.**

Two shapes of the same problem. A supplier invoice posts a `cost_entry` straight against the dossier
(`supplier-invoice-posted-cost-entry.js`, and four other orchestration handlers do the same). It may
name a `dictionary_item_id` that maps onto a costing line — or it may name nothing, or an item the
costing never budgeted.

- **A.** Out of scope. The reconciliation covers money that went through a cash request.
- **B. ⭐ In scope, all of it.** An entry that maps onto a budget line lands on that line (and
  `actual` is the union, not the cash-request figure alone). An entry that maps onto no budget line
  gets its own row with `budget = 0`, which is the largest possible overrun and therefore always
  demands a reason. Untagged entries keep today's AI-proposed mapping.
- **C.** In scope, but in a separate "off-budget" section that does not touch the variance.

> **Recommendation: B.** Under A, §4 closes at 2 642 000 when 2 840 000 actually left the building —
> the sheet is wrong by an invoice, and confidently. Under C the number everyone quotes excludes the
> spend most worth looking at.
>
> A `budget = 0, actual > 0` row is not an error state, it is **the** signal: either the costing was
> incomplete (amend it — 12771 Q6 says amending is the normal path) or somebody spent money nobody
> authorised. Both need a name on a reason field.
>
> This also settles what happens to the AI matcher — see Q20.

**Answer:**

---

### Group C — Variance, and the reason (3 questions)

---

**Q12. The overspend reason — per line, per file, or both? And what does it block?**

You said: *"Any variance that shows we spent more than we were supposed to we must enter a reason to
justify."*

- **A.** One reason per reconciliation, in the header.
- **B. ⭐ Per line, required on every overrun line, blocking at submit. A header note stays
  optional for the story that spans several lines.**
- **C.** Per line, but advisory — the validator chases it.

> **Recommendation: B.** A is what you get when you ask a spreadsheet: one paragraph covering four
> unrelated overruns, which answers none of them. The useful artefact is *"Port Charges −12 000:
> port raised the tariff on 01/07/2026, circular 41/26"* sitting on the port charges row, because
> that is what an auditor, a client query and next quarter's costing all need.
>
> C makes it optional in practice. The whole reason the legacy's control never fired is that nothing
> was ever refused.
>
> Mechanically this is `variance_reason text` on the line, and a submit-time check in the same place
> as Q10's proof check, so a user gets **one** list of what is outstanding rather than two rounds of
> 422. The reason should also be required when a validated reconciliation is **revised** into an
> overrun (Q6), not only on first submit.

**Answer:**

---

**Q13. How much overrun is an overrun?**

Rounding alone can produce a 0.01 variance. Demanding a written reason for that is how a control
becomes a nuisance, and a nuisance control gets typed "n/a".

- **A.** Any overrun at all, ≥ 0.01.
- **B. ⭐ A tenant setting with two knobs — an absolute floor and a percentage — and a reason
  required only when BOTH are exceeded.** Default: 1 000 XAF **and** 2%.
- **C.** Percentage only.

> **Recommendation: B.** The precedent is in the tree: `cash_request.disburse` uses a **±1 XAF
> tolerance** to decide `DISBURSED` vs `PARTIALLY_DISBURSED`, because exact-equality on money that
> has been through a division is a bug generator.
>
> Two knobs rather than one because either alone misbehaves at a scale you actually have: 2% of a
> 2 500 000 customs line is 50 000, which should absolutely be explained; 2% of a 5 000 line is 100,
> which should not. Requiring both exceeded means small absolute overruns pass on the floor and
> large ones are caught by it.
>
> It belongs in `settings` (`getSetting(client, "costing", "reconciliation", …)`) like
> `pricing_variance` thresholds, not hardcoded — a freight forwarder and a 3PL will not agree on the
> number.
>
> **Please give me your defaults if 1 000 / 2% is wrong.** This is the one question where I am
> guessing at your operating reality rather than reading it off the code.

**Answer:**

---

**Q14. Underspend — and a budget line that was never spent at all.**

You said *"if we spent less it is good"*, and I agree it needs no justification. But two things still
have to be decided.

- **A.** Silent. Green, no reason, nothing else happens.
- **B. ⭐ Silent for the reason field, but the sheet distinguishes three cases:** *spent less*
  (green, closed), *never claimed* (L3 in §4 — no cash request ever drew it, so it is unused budget,
  not a saving), and *claimed but not spent* — cash we hold and have not returned.
- **C.** A reason on large underspends too, because a 50% underspend usually means the costing was
  wrong.

> **Recommendation: B.** The third case is the one that matters and it is invisible under A: if
> 2 650 000 was disbursed and 2 480 000 is justified, **170 000 is sitting in somebody's hands.** The
> régie already refuses to let that pass — `justify` throws `ADVANCE_NOT_CLEARED` unless the
> remainder is recorded as returned — so the reconciliation should *show* what the régie is about to
> enforce, in the same words, before the user hits a 422.
>
> C is tempting and I would not do it: it punishes the good outcome, and the place to fix a
> systematically over-stated costing is the costing's own suggest/tier machinery, not a reason box
> here.

**Answer:**

---

### Group D — The picture (3 questions)

---

**Q15. What do the charts actually show, and where?**

You asked for *"graphs or charts showing the total budget vs actual at first glance"*. There is no
chart library in `client/` and `meter.tsx` explains why — *"at three-to-five bars it is a few divs
— a plotting library would add a bundle, a canvas, and a second set of colours competing with the
brand accent, to draw rectangles."*

- **A.** Keep `MeterGroup` as it is today — Quoted / Budget / Actual on one shared scale.
- **B. ⭐ Three pictures, all hand-drawn, no library:**
  1. **Header — a consumption bar**, not a pair of bars: one track = Budget, filled with
     Disbursed then Actual, with the overrun drawn *past* the end in `bad`. One glance answers "how
     much of it is gone".
  2. **Per line — a sparkbar in the row**, so the offending line is visible without reading five
     columns of numbers.
  3. **Portfolio — a variance strip** on the reconciliation register: one bar per open file,
     sorted by worst overrun.
- **C.** Add a charting library and build a proper dashboard.

> **Recommendation: B.** The legacy's two-bar viz is genuinely good and is already ported
> (`reconciliation.tsx:326-378` cites it by line number), but it answers "is Actual bigger than
> Budget" — and after the budget ledger landed, the interesting question has four terms, not two.
> A single track with Budget as the denominator shows Committed, Disbursed, Actual **and** the
> overrun in one object.
>
> C fails four gates at once: `check:bundle`, `check:palette` (a library ships its own palette and
> raw hex breaks white-labelling), `check:contrast`, and `check:motion`. And it buys a canvas we
> cannot theme per tenant. If we ever need a real chart it will be inline SVG, theme-token-coloured,
> not a dependency.
>
> Colour rules are not negotiable and the kit already enforces them: series colour is a **fill**
> (`--primary`), text is `--primary-ink`, and `ok`/`bad` are reserved for genuine state and always
> ship beside a label and a signed number — never colour alone. Every bar carries its own label and
> value, so no legend and no colour-only encoding.
>
> Tell me if you want a fourth: a **time** view (spend accumulating against budget over the file's
> life). It is the one genuinely new picture, and it is the one that needs dated `cost_entry` rows —
> which we only get if Q3 = B.

**Answer:**

---

**Q16. What does "updated real time" mean?**

- **A.** Live in the form — every keystroke re-foots the sheet and redraws the bars, client-side.
  The legacy's `updateLine()` → `calculateTotals()`.
- **B. ⭐ A, plus a refetch when the underlying facts can have moved** — on window focus, after any
  mutation, and when the user returns to the tab.
- **C.** B, plus a socket push so a second user watching the file sees it move.

> **Recommendation: B.** A on its own is table stakes and costs nothing — it is arithmetic on state
> React already holds, and it is what makes the sheet feel alive while you type. What A cannot do is
> notice that a colleague disbursed a tranche two minutes ago; a focus-refetch catches that at the
> moment a human would care, which is when they look back at the screen.
>
> C is possible — `src/realtime/index.js` exposes `publish(tenantSlug, groupId, event, payload)` and
> the client already holds an authenticated socket (`comms-socket.ts`) — but the collaboration
> pattern here is sequential, not simultaneous: one person reconciles a file. I would not spend the
> invalidation complexity until somebody asks. Say the word if two people really do work one sheet
> at once.
>
> One caution whichever you pick: a sheet that re-fetches **while you are typing** and overwrites
> your unsaved actual is worse than one that never refreshes. The refetch must merge, never clobber
> dirty fields — the same rule `b6294e1` ("stop the Website tab discarding unsaved page copy")
> learned the hard way.

**Answer:**

---

**Q17. The grade, and the KPI strip.**

The legacy graded the file `PENDING` / `EFFICIENT` / `OVERRUN` with a percentage underneath. We have
an R/Y/G margin flag driven by `pricing_variance` thresholds.

- **A.** Keep only the R/Y/G margin flag.
- **B. ⭐ Both, because they answer different questions** — *did we execute to plan* (budget vs
  actual, the legacy's grade, execution) and *did we make money* (quoted vs actual, the flag,
  commercial). Each labelled with its question, neither implying the other.
- **C.** Legacy grade only.

> **Recommendation: B.** They come apart in a case you will meet: a file executed beautifully against
> a budget that was quoted too cheap is `EFFICIENT` **and** `RED`. Showing one number would tell the
> operations lead they did badly or the commercial lead they did well, and exactly one of those is
> a lie.
>
> The KPI strip should mirror the register's, so the tile you press and the sheet you land on agree:
> **Budget · Disbursed · Actual · Variance** (file-level), and for the register **open
> reconciliations · total budget under reconciliation · total actual · files over budget**. I would
> drop the legacy's "Efficiency Rate" as a portfolio KPI — it averages percentages across files of
> wildly different sizes, which is a number that cannot be acted on.

**Answer:**

---

### Group E — The chain, the paper, the platform (4 questions)

---

**Q18. The workflow, who validates, and what validation gates.**

Today: `DRAFT → SUBMITTED → VALIDATED | REJECTED`, MOD-47 `edit` to submit, `approve` to
validate/reject, self-validation refused. `12771` added `can_validate` and `can_disburse` as real
permission columns.

- **A.** Keep exactly as is.
- **B. ⭐ Keep the shape, and: use `can_validate` (finance's visa) rather than `can_approve`;
  allow `REJECTED → DRAFT` so a bounced sheet is fixable in place; and make validation the gate on
  final invoicing.**
- **C.** Add a third leg — operations submits, finance validates, management approves.

> **Recommendation: B**, in three parts:
>
> *Who.* The legacy let Operations validate its own submission (§1.4) — a real hole, already closed
> here. But gating on `can_approve` means the person who approves *spending* also signs off the
> *reconciliation of that spending*, which is the one pair maker-checker most wants apart; `12771`
> created `can_validate` for precisely this distinction and 12771's Q20 called validation *"a visa,
> not a signature"*. Same word, same meaning, here.
>
> *Re-editing.* Today `REJECTED` is terminal and the UI offers "New draft", which loses the sheet.
> 12771's Q15 answered the same question for the cash request with `REJECTED → DRAFT`. Match it.
>
> *The gate.* This is the part worth your attention. **Should a final invoice be blocked until the
> file is reconciled?** It is the strongest argument for the module existing — invoicing a client
> before you know what the file cost is how margin is lost quietly. But it is also a hard gate on a
> revenue action, and if reconciliation lags, invoicing lags with it. My instinct is: **warn loudly,
> block only if you say so.** Your call, and it is a business call, not an engineering one.
>
> C adds a leg the legacy did not have and I cannot see the need — the approval chain machinery
> (`onApproved.register`) is there if you want it bindable later.

**Answer:**

---

**Q19. The printed statement.**

The legacy had a full print engine: header, file/client/service/status meta grid, the line table
(`Code · Description · Budget · Actual · Variance · Ref/Notes`), totals, and a performance note.

- **A.** No print. The screen is the document.
- **B. ⭐ A PDF through the template engine** (`services/documents/templates`, like the costing sheet
  and the cash voucher), with the proof documents listed per line and a signature block for the
  submitter and the validator.
- **C.** Export to xlsx only.

> **Recommendation: B**, and it should carry what the legacy's could not: **the variance reasons**
> and **the proof references**. A reconciliation statement with a −12 000 on it and no sentence
> explaining it is the document that generates the email asking why.
>
> Two house rules apply and both are CI-gated: dates print **dd/mm/yyyy** (`dateFmt` / `dateDmy`;
> `npm run check:dates` fails ISO in `services/documents/templates`), and if the statement is signed
> it goes through `document_signature` with `artifact_hash` taken from the vault row's
> `content_hash` — never from the bytes the caller held.
>
> C is worth having **as well** for the finance team who will want to pivot it, and `services/
> spreadsheet` already exists. It is cheap once B's projection is written.

**Answer:**

---

**Q20. The AI matcher — keep, retire, or re-aim?**

Today it scores untagged `cost_entry` rows against costed items and proposes mappings a human
confirms. Under Q1 = B most actuals arrive already keyed by `costing_line_id`, so its caseload
shrinks a lot.

- **A.** Retire it. The link is explicit now.
- **B. ⭐ Keep it, re-aimed at `costing_line` instead of `dictionary_item`,** for exactly the Q11
  population: entries that arrived with no cash request and no item, or with an item that maps onto
  two candidate budget lines.
- **C.** Extend it — have it propose the variance reason too, from the invoice it can read.

> **Recommendation: B.** A is premature: §4's Wed-15/07 invoice is not a rare shape, it is how
> accounts payable works, and those entries still need a human to say which budget line they belong
> to. The matcher's job gets *narrower and better* — fewer proposals, each more likely to be right,
> because the candidate set is budget lines rather than every catalogue item.
>
> Two rules carry over unchanged and should be restated in the guide: the assistant **proposes,
> never confirms**, and the confidence floor (0.45) exists so a human is never asked to rubber-stamp
> a guess.
>
> C crosses a line I would not cross without you saying so. A machine-suggested *reason* is a machine
> putting words in a person's mouth on the one field whose entire purpose is that a human took
> responsibility for the number. If you want assistance there, the safe shape is the assistant
> surfacing **evidence** — "the port invoice you attached reads 162 000 against a tariff dated
> 01/07/2026" — and the person writing the sentence.

**Answer:**

---

**Q21. What do we call it, and does it keep MOD-47?**

Two collisions worth ten seconds each.

*The name.* "Reconciliation" already means three things in this product: bank reconciliation
(MOD-09), treasury account reconciliation, and this. Meanwhile the costing is now called **the
budget**, so this module is the **actual**.

- **A.** Keep "Reconciliation".
- **B. ⭐ "Budget vs Actual"** in the UI — it says what the screen does, it pairs with the costing's
  new name, and it collides with nothing. Keep `dossier_reconciliation` as the table/module name so
  no migration or route changes.
- **C.** "Operational Cost Reconciliation" / "OCR" — the legacy's name.

> **Recommendation: B.** C is out for a reason that will cost us otherwise: **"OCR" already means
> optical character recognition in this codebase**, on the neighbouring screen —
> `bank_statement.ocr_used`, `ocr_provider`, `ocr_model` (migration `10720`), and the treasury
> reconciliation reads scanned statements with it. Two meanings of OCR one tab apart is a support
> ticket waiting to happen.
>
> *The module key.* `dossier_reconciliation` and `cost_tracking` **both use MOD-47**, so a grant to
> one is a grant to the other: you cannot let someone record cost entries without also letting them
> validate the file's reconciliation, or vice versa. Given Q18 turns validation into a finance visa
> that specifically should **not** follow from "may record costs", I think this needs its own key —
> **MOD-47 stays with cost tracking, reconciliation gets a new one.** It is one seed row, one
> permission migration, and it stops a segregation-of-duties hole being seeded on every new tenant.
> Say if you would rather leave it.

**Answer:**

---

## 6. Things I recommend we do NOT copy

1. **`doc_ref` as free text.** A typed invoice number evidences nothing. §1.3, Q8.
2. **Delete-and-reinsert on save.** `save_draft.php` churns every line id; our own costing had the
   same bug and `12771` had to fix it before the budget link was safe. Upsert in place.
3. **Writing `ocr_status = 'DRAFT'` onto the file from a draft save.** Re-saving a *rejected*
   reconciliation relabels the file as in-draft. Only a transition should stamp the file.
4. **Roles hardcoded in the endpoint.** `require_role([...])` per file drifted until Operations could
   validate itself. RBAC and the permission columns, always.
5. **Counting rows to mint an id** (`'SLAS-OCR-' . (1000 + COUNT(*) + 1)`) — racy, and it reuses ids
   after a delete. Our `doc_number` sequences already handle this.
6. **One reconciliation per file, for ever.** §1.5, Q6.
7. **"Efficiency Rate" as a portfolio KPI.** An unweighted average of percentages across files of
   different sizes. Q17.
8. **The hardcoded signature image.** The legacy stamped `signature-dg.webp` — the same MD signature
   — on every printed document. We have `document_signature`; use it.

---

## 7. Proposed PRs

Sequenced, not sized. Each is independently shippable and leaves the tree green.

### PR 1 — The line becomes writable, and proof becomes real

- Migration `13801`: `costing_line_id`, `budget_ttc`, `actual_ttc`, `actual_source`,
  `proof_vault_id`, `variance_reason`, `justification_required` on
  `dossier_reconciliation_line`; `revision` / `supersedes_id` on the header; the settings row for
  Q13's thresholds.
- `PATCH /costing/reconciliations/:id/lines/:lineId` — the endpoint that has never existed.
- Submit-time gates: proof (Q10) and variance reason (Q12), reported together, never one at a time.
- **The §0 defect, fixed:** `proof_vault_id` onto `CashLine`, and the upload engine into
  `JustifyForm` so an `ALWAYS_REQUIRED` line can be justified at all.

### PR 2 — The grid the sheet actually needs

- `costCompare` re-keyed to `costing_line_id`; débours in; the budget ledger's four columns joined
  so the sheet shows Budget · Committed · Disbursed · Actual · Variance.
- Pre-fill from `cash_request_line.spent_amount` ∪ `cost_entry` (Q2); Q11's unbudgeted rows.
- The matcher re-aimed at budget lines (Q20).
- If Q3 = B: `cost_entry` written at validate, delta not gross.

### PR 3 — The picture, the paper, and the close

- The consumption bar, the per-line sparkbar, the register strip (Q15); live re-footing and the
  merge-safe refetch (Q16).
- Revisions (Q6); `REJECTED → DRAFT`; `can_validate`; the invoicing gate (Q18).
- The PDF statement with reasons and proofs (Q19); the xlsx export.
- Rename in the UI, and the module key split (Q21).

---

## 8. Appendix A — the legacy OCR schema, reconstructed

There is no SQL dump in the tree. Reconstructed from every `INSERT` column list, `UPDATE … SET`
clause and `SELECT` projection in `api/ocr/`; types inferred from `bind_param` strings. Complete for
every column the code touches, silent about any it never names.

### `ocr_master`
```
ocr_id                    varchar  PK   'SLAS-OCR-1001'  (COUNT(*)+1001 — racy)
operations_file_reference varchar  FK → operations_file_master
costing_id                varchar  FK → costing_master
costing_ref               varchar       denormalised
client_id                 varchar
client_name_cached        varchar       denormalised at draft
service_type              varchar
service_territory         varchar
status                    varchar       DRAFT | SUBMITTED | VALIDATED | REJECTED
total_budget_ttc          decimal       Σ line budget_ttc, recomputed on every save
total_actual_ttc          decimal       Σ line actual_ttc
created_by_user_id        int
submitted_by_user_id / submitted_at     int, datetime
validated_by_user_id / validated_at     int, datetime
rejected_by_user_id  / rejected_at      int, datetime
reject_reason             text
created_at / updated_at   datetime
```

### `ocr_line`
```
ocr_id            varchar FK
costing_line_id   varchar  ← MANDATORY at save (must_str)
line_no           int
item_code         varchar
item_description  varchar
budget_ttc        decimal      copied from costing_line.total_ttc
actual_ttc        decimal      TYPED BY HAND
doc_ref           varchar      free text — no attachment, ever
doc_required      tinyint      ALWAYS 0 — the dictionary mapping was never built
created_at / updated_at  datetime
                  ── no proof, no variance reason, no match provenance ──
```

### `operations_file_master` — the write-back strip
```
ocr_id, ocr_amount, ocr_status, ocr_linked_at
```
Written by `save_draft.php` (status hardcoded `'DRAFT'`, amount = `total_actual_ttc`) and by
`validate.php` (status `'VALIDATED'`).

---

## 9. Appendix B — verification

### 9.1 Legacy — read this pass

Extracted from git history at `ad1ab69` (the tree deleted `doc/reference/legacy_codebase` in
`dd824a7`).

| File | Lines | Coverage |
| --- | --- | --- |
| `view/admin/operational-cost-reconciliation.php` | 1 662 | **complete** — KPI row, register, the three-pane modal, the print engine, and all JS (`loadRegister`, `renderRegisterFromDb`, `setKpis`, `loadEligibleFiles`, `openOCRModal`, `loadFileContext`, `loadOCR`, `renderLines`, `updateLine`, `calculateTotals`, `renderButtons`, `saveDraft`, `submitOCR`, `rejectOCR`, `validateOCR`, `triggerPrint`) |
| `api/ocr/file_context.php` | 124 | complete |
| `api/ocr/save_draft.php` | 249 | complete |
| `api/ocr/submit.php` / `validate.php` / `reject.php` | 209 | complete |
| `api/ocr/get.php` / `list.php` / `files.php` | 161 | complete |
| `view/admin/opportunity-cost-reconciliation.php` | 1 191 | scanned — a different module (opportunity cost), not in scope |

### 9.2 Praxis LS — read

`dossier_reconciliation/*` (all 7 files, 768 lines, **complete**) · `cash_request.service.js`
(1 311, the justify/applySpend/checkProof paths in full) · `cash_request.routes.js` ·
`costing.service.budget` + `costing.rules.summariseBudget` + `costing.repo.budgetForCosting`
(complete) · `cost_tracking.{routes,repo}.js` · `financial_dictionary.rules.proofObligation` ·
`meter.tsx` · `reconciliation.tsx` (530, complete) · `cash-request-actions.tsx` (JustifyForm in
full) · `regie-detail.tsx` (proof field) · `costing-api.ts` (`CashLine`, `ReconLine`) ·
`masterdata-api.ts` (vault upload) · `realtime/index.js` · `screen-registry.json` ·
migrations `0200`, `0342`, `0630`, `10715`, `10720`, `10741`, `11740`, `12771` · seed `9080` ·
`CLAUDE.md`, `doc/FRONTEND_GUIDE.md` §3.10/§3.12/§3.13, `doc/OHADA_KB.md` §450/§6.7,
`doc/CASH_REQUEST_PROGRAMME_QUESTIONNAIRE.md` (all 1 311 lines, including the §10 decisions).

### 9.3 Load-bearing claims and their proof

| Claim | Verified by |
| --- | --- |
| No line-edit API exists (§0, Q2) | full route read: 8 routes, none writes a line; and the service's own comment, twice: *"there is no line-edit API, so no human-entered field is lost"* |
| `doc_ref` is never written (§0) | `buildLines` sets `doc_ref: null` (`service.js:42`); `insertLines` is its only writer; `deleteLines`+`insertLines` is the only rebuild |
| `JustifyForm` sends no proof (§0, Q7) | the payload at `cash-request-actions.tsx:236-244`, read in full — 5 keys, no `proof_vault_id`, no `cash_request_line_id` |
| `proof_vault_id` is absent from `CashLine` (§0) | `costing-api.ts:696-719`, the complete type — `grep -c proof_vault_id` over that range = **0** |
| `PROOF_REQUIRED` makes an obliged line unclosable (§0) | `cash_request.service.js:1044-1053` + the two findings above |
| `PORT_CHARGES` is `ALWAYS_REQUIRED` and a débours (§0, §2.3) | seed `9080:397`, inside the `SELECT 'DISBURSEMENT'` block opening at 9080:298 |
| Débours are excluded from the line grid (§2.3, Q5) | `repo.js:111` — `AND COALESCE(cl.is_disbursement, false) = false` |
| The grain is the dictionary item (§2.2, Q1) | `repo.js:112` — `GROUP BY cl.dictionary_item_id` |
| The legacy keyed on `costing_line_id`, mandatorily (§1.2, Q1) | `save_draft.php` — `must_str($l['costing_line_id'] ?? null, "lines[$i].costing_line_id")` |
| `doc_required` was a hardcoded stub (§1.2, §1.3) | `file_context.php` — `'doc_required' => 0` with the comment *"Placeholder until you implement expense dictionary mapping"* |
| …so the legacy's proof gate never fired (§1.3) | the submit query filters `doc_required=1`, which no row ever had |
| The legacy allowed self-validation (§1.4, Q18) | `validate.php` `require_role(['ADMIN','FINANCE','OPERATIONS','MANAGEMENT'])` vs `submit.php` `['ADMIN','OPERATIONS']` |
| The legacy OCR had no cash awareness (§1.5) | `grep -in "cash\|disburs\|advance"` on the 1 662-line view → 1 hit, a sidebar `<a href>` |
| `justify` writes no `cost_entry` (§2.2, Q3) | full read of `justify` + `applySpend`: writes `spent_amount`, `proof_vault_id`, calls `regie.retireCore`, `repo.update`, `audit`. Nothing else. |
| The budget ledger already returns four columns (§2.4) | `costing.rules.summariseBudget` — `budget`, `committed`, `pending`, `disbursed`, `remaining`, `over_committed` |
| The costing is a TTC cash budget (Q4) | `12768`, quoted in `12771`'s header |
| MOD-47 is shared by two modules (Q21) | `dossier_reconciliation.routes.js:13` and `cost_tracking.routes.js:1` |
| "OCR" already means optical character recognition here (Q21) | `10720_reconciliation_ocr_and_document.sql` — `bank_statement.ocr_used/ocr_provider/ocr_model` |
| Next free migration is 13801 | highest existing is `13792_site_careers_and_alerts.sql` |
| No chart library in `client/` (Q15) | `package.json` — no recharts/d3/nivo/apex/victory; `meter.tsx`'s header explains the choice |
| A generic tenant socket publish exists (Q16) | `src/realtime/index.js:244` — `publish(tenantSlug, groupId, event, payload)` |

### 9.4 What is still inference, not fact

1. **I ran nothing.** No migration applied, no test executed, no server started. Static reading only.
   If runtime behaviour contradicts anything here, the runtime is right.
2. **The legacy read is from git history, not a live system.** The PHP is the PHP; whether the
   production database matched the schema in §8 is unknowable from here.
3. **Q13's 1 000 XAF / 2% defaults are a guess at your operating reality**, not a finding. They are
   the one number in this document I would most like you to overwrite.
4. **Q3's "delta, never gross" assumes `cost_entry` has no other writer that would double-count.**
   I read five orchestration handlers that write entries; if a sixth path exists outside
   `src/orchestration/handlers/` and `cost_tracking`, the delta arithmetic needs to know about it.
5. **Q11's claim that supplier invoices routinely bypass cash requests** is read off the existence
   of `supplier-invoice-posted-cost-entry.js`, not off your volumes. If in practice everything goes
   through a cash request, Q11 gets cheaper.
6. **Whether reconciliation should gate final invoicing (Q18) is a business decision**, and I have
   deliberately not assumed one.
7. **No effort estimates.** The PRs in §7 are sequenced, not sized.

---

## 10. DECISIONS — answered by the owner, 15/09/2026

Recorded here because the engineering guide, the migrations and the PR descriptions all cite them,
and a decision that lives only in a chat log is a decision the next engineer will re-litigate.

| Q | Topic | Decision |
| --- | --- | --- |
| 1 | Line grain | **B** — the line is the `costing_line`. |
| 2 | Where ACTUAL comes from | **C** — pre-filled and editable. |
| 3 | Does validation post `cost_entry` | **B** — validation posts. **Plus the owner's own question, which found a schema gap:** *"when do we actually post the entry? funds would have been released but the actual transaction happened 3 days ago."* `cost_entry` has **no date column at all** — only `created_at`. Answered by `spent_on` on the line, which becomes the journal entry's date. See the guide §4.3. |
| 4 | HT or TTC | **B** — **TTC only** on the line. *"119 250 was disbursed and the line needed 119 250 (100 000 HT + 19 250 VAT). I just need to know: is that what you spent?"* The HT margin figure survives as ONE derived header number, never a second column. |
| 5 | Débours in the grid | **B** — every line, **débours above all**. *"This is the SSOT of what is actually spent per file."* Plus: **a line-detail modal** showing that line's history and its supporting documents. |
| 6 | One per file / living / revisions | **ONE reconciliation per file. Never two.** A LIVING sheet bound to the costing, which is SSOT: unlock and amend the costing and this moves with it — an amended line changes here, a new line appears here **even if the sheet was already closed**. Several cash requests against one file raise the same lines here automatically, live. Under-spend leaves **cash finance expects back in the vault**, and the sheet is where that is seen and settled. **Prepared by Operations → submitted to Finance → Finance records the amount returned → MD is told. No second approval.** Plus a **summary modal** across all of it. *"There is no real data so far — everything on the system now is a mock."* → **no backfill.** |
| 7 | Entry point for the upload | **B** — the upload lives HERE. The cash request only carries the justification-required tick. *"Reconciliation is one of the main worksheets and engines used across the whole system."* |
| 8 | What replaces `doc_ref` | **B**, extended to **many documents per line** — *"the first Maersk invoice for demurrage was for one day only, the second is for two"* — so a join table, not one FK. Plus: a **supporting-documents view on the Operations file 360**, grouped by the line each document belongs to. |
| 9 | Source of the justification tick | **The cash request is SSOT.** The financial dictionary may inspire the tick; the cash request decides it. |
| 10 | Is missing proof blocking | Blocking, and it **holds the person the cash was disbursed to accountable**: the line-detail modal, an in-app + push notification, and a new section on **My workspace** listing every justification that person owes — operations files and overhead alike. |
| 11 | Spend with no cash request / no budget line | **No spend on an operations file without an approved costing. Ever.** No off-budget line, no unbudgeted row. Instead: a one- or two-line hint on the sheet — can't find a line, need a line → request an unlock, add it, re-approve — **deep-linked to the costing**. *"This is what this new system has that the old one did not get."* Overhead is a separate future module (expense module, or the costing sheet learning to be one) — briefed separately to the engineering team. |
| 12 | Overspend reason — grain and gate | **B**, plus **apply-to-many**: one reason, a picker for the other lines it explains. One network outage at customs delays a container a day and four lines move — demurrage, port storage, yard occupancy, another — and that is one sentence, typed once. |
| 13 | Tolerance | **B** — tenant-configured, in the module's configuration tab, by anyone holding approval rights there. Defaults 1 000 and 2% accepted. **Renamed** to something a person understands. |
| 14 | Underspend and cash returned | **B** — and this is where the refund of claimed-but-unused cash is seen and settled. |
| 15 | The chart set | **Add a chart library.** It will serve the Reporting Module later. Interactive. **One visual on the sheet, and a button that opens the rest** — no congestion. |
| 16 | What real time means | **B**. |
| 17 | Grade and KPI strip | **B**, and add a third if it earns its place. |
| 18 | Workflow and who validates | **B**, under Q6's chain: Operations prepares, Finance settles, MD is informed. |
| 19 | The printed statement | **B and C — let them pick.** Plus **send it in-house through Smart Comms.** In-house only. |
| 20 | The AI matcher | **Retire it.** *"From what I have described to you, what needs an AI? Justify. Prove, and I can approve."* |
| 21 | Name and module key | **B — "Budget Reconciliation".** |

### What these answers changed about the plan

- **Q6 replaced my own recommendation and is better than it.** I proposed revisions — R1 closes, R2
  opens pre-filled. The owner's answer is one row that never closes, whose LINES ARE THE COSTING'S
  LINES. That removes a whole class of "which revision is current" bugs, and it makes "real time"
  free: if the line set is a projection of `costing_line` rather than a copy of it, an amended
  costing IS an amended reconciliation, with nothing to sync. The stored line holds only what a
  human typed. See guide §3.
- **Q4 = TTC only** means the reconciliation line grid stops carrying `budget_ht` / `actual_ht`
  entirely. The margin question keeps exactly one derived HT figure at header level, so Sales's R/Y/G
  flag survives and no column holds two bases.
- **Q7 = B forces a change in the CASH REQUEST module**, which was not in scope when this sheet was
  written: `justify`'s `PROOF_REQUIRED` block must come off, because the proof it demands now lands
  somewhere else. Leaving both would keep §0's dead end alive. Guide §7.1.
- **Q6 + Q14 move the régie retirement.** Finance records the returned cash at settlement, which is
  the `CASH_RETURN` leg of the advance — so settlement, not `justify`, is where the advance is
  retired. Guide §7.2.
- **Q11 = "never" collided with five shipped code paths.** `supplier-invoice-posted-cost-entry.js`
  and four sibling orchestration handlers write `cost_entry` against a dossier with no costing line
  at all. The policy is right; the code does not implement it yet. Guide §8.1 reports this.
- **Q3's follow-up question found a real gap.** `cost_entry` has no date column — `entry_date` is
  passed to `journalEntry.buildAndInsert` and never reaches the cost entry row. A spend that happened
  three days ago cannot currently say so. Guide §4.3.
- **Q15 = a chart library** is the first new frontend dependency in this area, and
  `client/vite.config.ts` already has the mechanism for it (`ROUTE_LOCAL_VENDOR`) plus three gates
  that constrain the choice. Guide §6.1.

---

## 11. Answer summary

| Q | Topic | Your answer |
| --- | --- | --- |
| 1 | Line grain — costing line, item, or cash-request line | see §10 |
| 2 | Where ACTUAL comes from — typed / derived / **pre-filled + editable** | see §10 |
| 3 | Does validation write `cost_entry`? (the deferred Q18 seam) | see §10 |
| 4 | **HT or TTC — and do we carry both?** | see §10 |
| 5 | **Débours in the grid?** | see §10 |
| 6 | One per file, living tally, or revisions | see §10 |
| 7 | Entry point — Justify, Reconciliation, or both | see §10 |
| 8 | What replaces `doc_ref` (vault upload?) | see §10 |
| 9 | Source of "justification required" | see §10 |
| 10 | Is missing proof blocking, and where | see §10 |
| 11 | Spend with no cash request; spend with no budget line | see §10 |
| 12 | Overspend reason — grain and gate | see §10 |
| 13 | **Tolerance before a reason is demanded (your numbers)** | see §10 |
| 14 | Underspend, unclaimed budget, and cash still held | see §10 |
| 15 | The chart set | see §10 |
| 16 | What "real time" means | see §10 |
| 17 | The grade and the KPI strip | see §10 |
| 18 | Workflow, who validates, and whether it gates invoicing | see §10 |
| 19 | The printed statement (+ xlsx?) | see §10 |
| 20 | The AI matcher — keep, retire, re-aim | see §10 |
| 21 | Name, and the MOD-47 split | see §10 |
