# End-to-End Demo — Data Sheet

Companion to `END_TO_END_OPERATIONS_WALKTHROUGH.md`. Every value used in the
walkthrough, in one place, so you can keep this open beside the screen.

**Identities are invented. Formats are real** — NIU, RCCM, CNPS, ports, BL
numbers, container numbers and shipping lines all follow the shape the real
thing takes, so the fields teach you what they are for. Nothing here belongs to
a real company or person.

All amounts **XAF**, a zero-decimal currency — enter whole numbers, no decimals.

---

## 1. Tenant

| Field | Value |
|---|---|
| Slug | `arena` |
| Display name | Arena Logistics Cameroun |
| Plan | `full` |
| First admin email | `admin@arena-logistics.cm` |
| First admin password | `Praxis!Demo2026` |
| Admin display name | Blake Tchoumi |
| Local host header | `X-Praxis-Tenant: arena` |

## 2. Corporate entity (MOD-01)

| Field | Value |
|---|---|
| Code | `ARL` |
| Legal name | Arena Logistics Cameroun SARL |
| Trading name | Arena Logistics |
| Legal form | SARL (OHADA) |
| NIU | `M071812345678P` |
| RCCM | `RC/DLA/2018/B/1427` |
| Country | CM (Cameroon) |
| Address | 1247 Boulevard de la Liberté, Akwa, Douala |
| Email / Phone | `contact@arena-logistics.cm` / `+237 233 42 18 90` |
| Timezone | Africa/Douala |
| Default currency | XAF |
| Default language | fr |
| Accounting framework | OHADA |
| Fiscal year start month | 1 |
| VAT registered | Yes |
| Share capital | 10 000 000 XAF |
| Incorporation date | 2018-03-14 |
| Relationship type | HEADQUARTERS |
| Document prefix | `ARL` |
| Numbering reset | ANNUAL |
| Bank block | Afriland First Bank · IBAN `CM21 10005 00012 34567890123 45` · SWIFT `CCEICMCX` |

## 2b. Accounting bootstrap — required before anything can post

Journals and accounting periods are **not seeded**. Without them every posting
from the advance invoice onward fails with "No journal for BQ".

Journals to create for the entity: **VT** Ventes · **AC** Achats · **BQ**
Banque · **PAIE** Paie · **OD** Opérations diverses.
Accounting period: code `2026`, 2026-01-01 → 2026-12-31, status **OPEN**.

Treasury accounts (MOD-09) — note the **postable leaf**, never the grouping:

| Kind | Label | COA |
|---|---|---|
| BANK | Afriland First Bank — compte principal | `5211` |
| CASH | Caisse siège Douala | `571` |
| MOMO | MTN Mobile Money | `5381`, fee account `631` |

The account map the posting services use, from settings `('finance','accounts')`:

| Role | Account |
|---|---|
| treasury | `5211` (**not** `521` — a non-postable grouping) |
| cash | `571` |
| customer | `4111` |
| customer advance | `4191` |
| supplier | `4011` |
| disbursement | `4731` (requires a dossier_id) |

## 3. Employees (MOD-02)

CNPS numbers follow the Cameroon shape (10 digits). Salaries are monthly gross XAF.

| Full name | Department | Job title | Type | CNPS no. | Base salary | Hired | Email |
|---|---|---|---|---|---|---|---|
| Blake Tchoumi | Direction | Directeur Général | CDI | `0418720193` | 1 250 000 | 2018-03-14 | `ceo@arena-logistics.cm` |
| Aline Fotso | Finance | Responsable Financier | CDI | `0521840277` | 420 000 | 2020-06-01 | `fin.fotso@arena-logistics.cm` |
| Serge Nkolo | Opérations | Chargé d'Opérations | CDI | `0619230845` | 380 000 | 2021-02-15 | `ops.nkolo@arena-logistics.cm` |
| Marthe Ekani | Ressources Humaines | Responsable RH & Paie | CDI | `0537910462` | 450 000 | 2019-09-02 | `hr.ekani@arena-logistics.cm` |
| Bertrand Mbarga | Opérations | Déclarant en Douane | CDI | `0722640318` | 260 000 | 2023-01-09 | `dec.mbarga@arena-logistics.cm` |

Employment type **CDI** on all five (the enum is CDI · CDD · STAGE · INTERIM ·
CONSULTANT · TEMPORARY). Signatory name = the person's own full name.
Set `reports_to`: Mbarga reports to Nkolo.

## 4. Users, roles and authority (MOD-67)

The authority column is the **capability overlay** — it is what segregation of
duties actually turns on, and you cannot grant it to yourself.

| User | Role | Authority (capability) | Purpose in the scenario |
|---|---|---|---|
| Blake Tchoumi | CEO / Executive | APPROVER | Approves costing and cash request; holds the God-Mode PIN |
| Aline Fotso | Finance | VALIDATOR | Validates costing, issues invoices |
| Serge Nkolo | Operations | ISSUER | Raises the file, costing and cash request |
| Marthe Ekani | HR | — | Runs payroll |
| Bertrand Mbarga | Operations (read) | — | The employee who receives a payslip |

Password for every demo user: `Praxis!Demo2026`

## 5. Client (MOD-03)

| Field | Value |
|---|---|
| Name | Brasseries Mont Fébé SA |
| Legal name | Société des Brasseries du Mont Fébé SA |
| Client type | CONSIGNEE |
| NIU | `M051912345678T` |
| RCCM | `RC/DLA/2015/B/0892` |
| Country / City | CM / Douala |
| Address | Zone Industrielle de Bassa, BP 4471, Douala |
| Email / Phone | `achats@mont-febe.cm` / `+237 233 39 55 12` |
| Default currency / language | XAF / fr |
| Payment terms | 30 days |
| Credit limit | 25 000 000 XAF |
| Advance required | Yes, 50% |
| Primary contact | Estelle Ngo Bikai — Responsable Achats — `e.ngobikai@mont-febe.cm` |

## 6. Supplier (MOD-04)

| Field | Value |
|---|---|
| Name | Transit Wouri SARL |
| Supplier type | TRANSPORTER |
| NIU | `M081420987654R` |
| RCCM | `RC/DLA/2014/B/2038` |
| Country / City | CM / Douala |
| Address | Rue Njo-Njo, Bonapriso, Douala |
| Email / Phone | `contact@transit-wouri.cm` / `+237 699 84 21 07` |
| Payment method | MOBILE_MONEY |
| MoMo network / number | MTN / `+237 677 45 92 13` |
| Payment terms | 15 days |
| Rating | 4 |

## 7. Operations file (MOD-29)

The shipment form is **not** a fixed screen — it is the `SEA` field set the
service type carries (`9092_seed_service_type_fields.sql`), so picking a
different service type gives you different fields. Twenty fields in three
groups, of which exactly **four are required**: POL, POD, Commodity, Incoterm.

The seed states the rule behind that: *required = knowable on the day the file
is opened.* A BL number, a vessel, an ETA, a declaration number arrive days or
weeks later, and "a form that demands them on day one gets fed invented values,
which is worse than an empty field."

### Header (fixed fields, not part of the field set)

| Field | Value |
|---|---|
| Title | Import conteneur malt — Mont Fébé |
| Entity | Arena Logistics Cameroun SARL |
| Client | Brasseries Mont Fébé SA |
| Service type | Sea Freight Import (`SEA_FREIGHT_IMPORT`) |
| Currency | XAF |
| Operations owner | Serge Nkolo |

### Transport

| Field | Value | Note |
|---|---|---|
| Bill of Lading | `MSCU7842119` | Optional. The hint says leave blank when opening a file — we fill it because this file's BL has landed |
| Shipping line | MSC | Drives every costing line's expense-rate lookup |
| Vessel | MSC NURIA | |
| Voyage No | `246W` | |
| **Port of loading** | Shanghai (CNSHA) | **required** |
| **Port of discharge** | Douala (CMDLA) | **required** |
| ETA | 2026-08-10 | |
| ATA (actual arrival) | **leave blank** | Fill `2026-08-12` at step 11. Two days late — which is what makes the demurrage later realistic |
| Place of delivery | Zone Industrielle de Bassa, Douala | Same address as the delivery note |

### Cargo

| Field | Value | Note |
|---|---|---|
| **Commodity** | Malt d'orge en sacs | **required.** The *what*, not the how-much — the weight has its own field |
| Detailed description | Malt d'orge de brasserie en sacs de 50 kg, palettisé. Origine Chine. | Cargo, not equipment — containers have their own section |
| Gross weight | 24000 | |
| Unit | kg | |
| Volume (CBM) | 58.5 | |
| Package count | 480 | 480 × 50 kg = 24 000 kg, and the same 480 appears on the delivery note |
| Marks & numbers | MONT FEBE / DLA / 1-480 | |

### Customs & trade

| Field | Value | Note |
|---|---|---|
| **Incoterm** | CFR — Cost and Freight | **required** |
| Customs regime | IM4 — Home use | |
| Declaration No | **leave blank** | Fill `2026 IM4 034127` when the declaration is lodged, around 2026-08-14 |

### Containers — their own section, not the description

`SEA_FREIGHT_IMPORT` has `captures_containers = true` in `GROUPED` mode, so the
file has a container section of its own. Putting the box in *Detailed
description* works but loses everything below.

**Grouped line** — what is known at booking:

| Field | Value |
|---|---|
| Container type | 40' HC (`FT40HC`) |
| Qty | 1 |
| Gross weight | 24 000 kg |
| Volume | 58.5 |

**Per-box unit** — filled in when the BL lands:

| Field | Value | Note |
|---|---|---|
| Container No | `MSCU4471820` | Unique within a file; repeats across files, which is normal |
| Seal No | `CM884213` | |
| Tare | 3 900 kg | |
| Gross weight | 27 900 kg | Cargo 24 000 + tare 3 900 — the VGM, not the cargo weight |
| Discharged on | 2026-08-12 | = the ATA |
| Out of port on | 2026-08-18 | |
| Returned on | 2026-08-24 | |

**Why this matters, and it is the point of the section.** The container type
comes from the same `dictionary_ref` registry that `expense_rate` prices
against — so a file's equipment and its rate card can never disagree about what
a 40' HC is. And those last three dates are what the demurrage / extra-charge
engine counts between. Type the box into a text field and every per-container
charge on this file is an estimate; put it here and it is exact.

Record the allocated reference when the file is promoted — it looks like
`AL21FD3JX1CHGFSM`, not `ARL-…-0001`.

**The reference format is not what you might expect, and that is deliberate.**
A dossier ref is `<entity prefix><12-char core><service code>` — e.g.
`AL21FD3JX1CHGFSM` = prefix `AL` + random core + `SM` (sea import). It is
**not** the `ARL-…-2026-0001` shape used for invoices, and the allocator
explains why at length: a dossier reference is the one number a *client* holds,
and a sequential one would tell them how many files you opened this year and
that `…0141` and `…0143` are worth trying. The core is `crypto.randomBytes` in
Crockford Base32 (no I/L/O/U, so it survives being read down a phone line) —
60 bits, non-enumerable. Money documents keep the gap-free sequence, because
that is what OHADA expects of a statutory ledger; dossiers deliberately do not.


## 8. The money — costing, quotation and invoices

**The split that matters: a costing carries costs only.** Fees, sell prices and
margin live on the quotation. The modal's own subtitle says so.

### 8.1 Costing sheet (MOD-46) — what the file costs us

Header: dossier (required) · Validator **Aline Fotso** · Currency **XAF** ·
Remarks `Import 1×40'HC malt — MSC NURIA, BL MSCU7842119, ETA 10/08/2026`

**Disbursements** — tick *Débours · Pass-through*, VAT **No VAT**:

| Charge | Payee | XAF |
|---|---|---|
| Customs Duties & Taxes | Douanes Camerounaises | 4 850 000 |
| Port Charges | Douala International Terminal | 685 000 |
| Container Maintenance | MSC | 120 000 |
| Customs Clearance | Douanes Camerounaises | 500 000 |
| **Subtotal** | | **6 155 000** |

**Our own costs** — Débours unticked:

| Charge | Supplier | XAF | VAT |
|---|---|---|---|
| Inland Freight | Transit Wouri SARL | 450 000 | TVA 19.25% |
| Bank Charges | Afriland First Bank | 25 000 | No VAT |
| **Subtotal** | | **475 000** | |

**Footer:** Subtotal HT **6 630 000** · VAT **86 625** · Total **6 716 625**.

The VAT here is *input* VAT on the haulage line, and it is recoverable — so the
economic cost to execute is the **HT figure, 6 630 000**.

### 8.2 Quotation (MOD-27) — what we bill

| Line | XAF |
|---|---|
| Disbursements re-billed at cost (no VAT) | 6 155 000 |
| Inland Freight (bought at 450 000) | 600 000 |
| File Opening | 75 000 |
| Documentation Fee | 90 000 |
| Import Declaration Fee | 150 000 |
| Extra Legal Work | 300 000 |
| Commission on Disbursement | 185 000 |
| **Services HT** | **1 400 000** |
| **TVA 19.25%** | **269 500** |
| **Quotation total** | **7 824 500** |

1 400 000 × 19.25% = 269 500 exactly. Any other figure means a line lost its tax
code, or a disbursement line picked one up.

### 8.3 The totals that must reconcile

| | XAF |
|---|---|
| Cost to execute (costing HT) | 6 630 000 |
| **Quotation / operation total** | **7 824 500** |
| **Advance invoice, 50%** | **3 912 250** |
| **Final invoice balance due** | **3 912 250** |
| | |
| Service revenue (turnover) | 1 400 000 |
| Own direct costs | 475 000 |
| **Dossier margin** | **925 000 (66.1%)** |

**The single most important assertion:** turnover is **1 400 000**, not
7 824 500. The 6 155 000 of disbursement passes through the balance sheet and
never touches a class 7 account. If the income statement shows 7 824 500 of
revenue, the débours model is broken.

Note also what the margin is *not*: it is not 7 824 500 − 6 630 000. Pass-through
carries no margin by definition, so the only commercially meaningful figure is
services minus our own costs.

### 8.4 Cash request (régie d'avance, MOD-49)

| Field | Value |
|---|---|
| Requested | 6 700 000 |
| Actually spent | 6 605 000 (6 155 000 disbursement + 450 000 haulage) |
| Returned / variance | 95 000 |
| Category | OPS |
| Disbursement method | BANK |
| Beneficiary | Serge Nkolo |

The deliberate 95 000 gap is there so budget-vs-actual reconciliation has
something to show. A request that reconciles to zero proves less.

## 9. Delivery note (MOD-32)

| Field | Value |
|---|---|
| Consignee | Brasseries Mont Fébé SA |
| City / zone | Douala — Zone Industrielle de Bassa |
| Contact person | Estelle Ngo Bikai |
| Phone | `+237 233 39 55 12` |
| Delivery date | 2026-08-22 |
| Line | 480 sacs malt d'orge, 24 000 kg brut, container `MSCU4471820` |

## 10. Payroll (MOD-17) — period `2026-08`

You enter no rates. `computePayslip` snapshots the rates in force at compute
time, so a later change cannot alter a closed run.

| Contribution | Rate | Side |
|---|---|---|
| CNPS pension | 4.2% | employee **and** employer, base capped at 750 000/month |
| CNPS family allowance | 7.0% | employer (capped) |
| CNPS work injury | **1.75%** default | employer — overridden per employee by `risk_class_rate` |
| CFC | 1.0% / 1.5% | employee / employer |
| FNE | 1.0% | employer |
| IRPP | (gross − CNPS) × 70% − 41 667, annualised over 10/15/25/35% brackets | employee |
| CAC | 10% of IRPP | employee |

### The computed run — these are check figures, not estimates

| Employee | Gross | CNPS | CFC | IRPP | CAC | Deductions | **Net** | Employer |
|---|---|---|---|---|---|---|---|---|
| Mbarga | 260 000 | 10 920 | 2 600 | 13 269 | 1 327 | 28 116 | **231 884** | 40 170 |
| Nkolo | 380 000 | 15 960 | 3 800 | 23 641 | 2 364 | 45 765 | **334 235** | 58 710 |
| Fotso | 420 000 | 17 640 | 4 200 | 27 664 | 2 766 | 52 271 | **367 729** | 64 890 |
| Ekani | 450 000 | 18 900 | 4 500 | 31 692 | 3 169 | 58 262 | **391 738** | 69 525 |
| Tchoumi | 1 250 000 | 31 500 | 12 500 | 208 949 | 20 895 | 273 844 | **976 156** | 137 125 |
| **Run** | **2 760 000** | | | | | | **2 301 743** | **370 420** |

Total employer cost **3 130 420**. Mbarga's employer side: pension 10 920 ·
family 18 200 · injury 4 550 · CFC 3 900 · FNE 2 600.

Posts to journal **PAIE**: class 66 debit; `422` net, `431` CNPS, `447` tax.

## 11. Timeline

| Date | Event |
|---|---|
| 2026-08-03 | Operations file opened |
| 2026-08-04 | Costing raised, validated, approved |
| 2026-08-05 | Quotation issued (valid 30 days) |
| 2026-08-07 | Quotation accepted · advance invoice issued |
| 2026-08-10 | Vessel ETA Douala |
| 2026-08-11 | Advance payment received |
| 2026-08-12 | Cash request raised and approved |
| 2026-08-13 | Cash disbursed |
| 2026-08-18 | Receipts uploaded, request justified |
| 2026-08-22 | Delivery — delivery note issued |
| 2026-08-25 | Final invoice issued (terms 30 days → due 2026-09-24) |
| 2026-08-31 | Payroll run for period 2026-08 |

## 12. Reference numbers — fill in as you go

| Document | Reference | Status |
|---|---|---|
| Corporate entity | | |
| Client | | |
| Supplier | | |
| Operations file | | |
| Costing | | |
| Quotation | | |
| Advance invoice | | |
| Cash request | | |
| Delivery note | | |
| Final invoice | | |
| Payroll run | | |
| Payslip (Mbarga) | | |
