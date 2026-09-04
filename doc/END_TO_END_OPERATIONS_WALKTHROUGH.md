# End-to-End Operations Walkthrough

## Purpose

One continuous business scenario, from an empty database to a set of balanced
OHADA journals — carrying **the same operation** through people and access,
master data, commercial documents, execution, payroll and accounting.

This document is written to be **followed, not just watched**. Every field has a
value, and every money step states what the ledger should do. Where the expected
result is stated, treat it as a test: if the screen disagrees, that is a finding,
not a typo.

Companion: **`E2E_DEMO_DATA_SHEET.md`** — the same values in one table, to keep
open beside the screen.

> **Data.** Identities are invented; formats are real (NIU, RCCM, CNPS, ports,
> BL and container numbers). Nothing here belongs to a real company or person.
> All amounts are **XAF**, a zero-decimal currency — whole numbers only.

---

## 0. Provision the tenant

From the repository root. Prerequisites you supply: Node 20, PostgreSQL 16 with
`pgcrypto`, `citext` and `vector` extensions, and Redis running.

**The one-shot route:**

```bash
npm run setup:local -- --slug=arena --name="Arena Logistics Cameroun" \
  --plan=full --email=admin@arena-logistics.cm --password='Praxis!Demo2026' \
  --admin-name="Blake Tchoumi"
```

**Or step by step, if you want to see each stage:**

```bash
npm run db:migrate:platform
npm run db:provision -- --slug=arena --name="Arena Logistics Cameroun" --plan=full
npm run tenant:create-admin -- --slug=arena --email=admin@arena-logistics.cm \
  --password='Praxis!Demo2026' --name="Blake Tchoumi"
npm start                # API on :8080
cd client && npm run dev # SPA on :5173, proxying /api to :8080
```

### Reaching the tenant locally

Tenants normally resolve by subdomain. On localhost the resolver accepts a
header instead — `X-Praxis-Tenant: arena` — or the `DEV_TENANT_SLUG` env var.
`localhost` is the **platform** host, so a tenant call without one of those
answers `400 WRONG_HOST`, and that error is telling you the Host header is
wrong, not that the server is broken.

### Live vs sandbox

Provisioning creates two schemas inside the tenant's own database: `public`
(Live) and `sandbox`. You asked to work on the Live side — so simply **do not**
send `X-Praxis-Env: sandbox`. Live is the default and there is nothing to switch
off. Note that once a tenant is marked `is_live`, the sandbox becomes
unreachable by design, enforced server-side rather than by hiding a toggle.

### Three checks before you start

These take a minute and save an hour.

```bash
# 1. Approval workflows actually seeded. The seeding block swallows its own
#    errors, so a tenant can look provisioned with no approval chains at all —
#    in which case documents will sail through with no validate/approve step and
#    you will wrongly conclude the workflow engine does nothing.
psql -d praxis_arena -c "SELECT count(*) FROM workflow;"        # expect > 0

# 2. Chart of accounts and the dictionary seeded.
psql -d praxis_arena -c "SELECT count(*) FROM chart_of_accounts;"  # expect ~hundreds
psql -d praxis_arena -c "SELECT count(*) FROM dictionary_item;"    # expect ~hundreds

# 3. Tax codes seeded, including TVA at 19.25%.
psql -d praxis_arena -c "SELECT code, rate_percent FROM tax_code WHERE code LIKE 'TVA%';"
```

If check 1 returns 0, re-run the tenant migrations before going further.

---

## 1. Corporate entity (MOD-01)

**Settings → Corporate Entities → Create.** First, because employees, clients,
documents, payroll and every journal line are scoped to an entity.

Only three fields are actually required — **legal name, code, country**. But
`corporate_entity.rules.js` carries a second, stricter idea called
**readiness**, and it is the one that matters: an entity is ready to *print a
compliant letterhead* only when it has legal name, legal form, incorporation
date, **share capital**, a public **email or phone**, **at least one
registration**, a **REGISTERED address**, and a **director or legal
representative**. Miss any and the dossier shows an amber "not yet complete for
statutory documents". So fill the lot.

| Field | Value |
|---|---|
| Code | `ARL` |
| Legal name | Arena Logistics Cameroun SARL |
| Trading name | Arena Logistics |
| Legal form | SARL (source: OHADA) |
| Country | CM |
| Email / Phone | `contact@arena-logistics.cm` / `+237 233 42 18 90` |
| Timezone | Africa/Douala |
| Default currency / language | XAF / fr |
| Accounting framework | **OHADA** |
| Fiscal year start month | 1 |
| VAT registered | Yes |
| Share capital | 10 000 000 XAF |
| Incorporation date / place | 2018-03-14 / Douala |
| Relationship type | HEADQUARTERS |
| Document prefix | `ARL` |
| Numbering reset | ANNUAL |

**Registrations** (two rows, not free-text fields on the header):

| Kind | Number | Authority |
|---|---|---|
| Taxpayer Card (NIU) | `M071812345678P` | DGI Douala |
| Business Licence / RCCM | `RC/DLA/2018/B/1427` | Greffe du Tribunal de Douala |

**Address** — type **REGISTERED**: 1247 Boulevard de la Liberté, Akwa, Douala.

**People** — Blake Tchoumi, role **LEGAL_REPRESENTATIVE** (the roles are
SHAREHOLDER · DIRECTOR · OFFICER · LEGAL_REPRESENTATIVE · AUTHORISED_SIGNATORY ·
BENEFICIAL_OWNER · STATUTORY_AUDITOR · SECRETARY).

**Bank block** — Afriland First Bank, IBAN `CM21 10005 00012 34567890123 45`,
SWIFT `CCEICMCX`.

**How this is built.** The entity's lifecycle is a real state machine
(`DRAFT → PENDING_REVIEW → ACTIVE → SUSPENDED → DEACTIVATED → ARCHIVED`) and
**ARCHIVED is terminal** — deliberately, because "archived then quietly
reactivated" is how a dormant company's books get mixed into a live period.
Reaching it again needs a deliberate DEACTIVATED hop, which is auditable.

**What to look at.** Open the entity 360 and find the readiness callout. It is
not decoration: the letterhead's share-capital block is mandatory on OHADA
invoices, and the cap-table mismatch check compares issued shares against
`share_capital`. Leave share capital blank and both are permanently
unsatisfiable through the UI.

---

## 1b. Accounting bootstrap — do this now or step 9 fails

**This is the step the walkthrough was missing, and it is not optional.**

`journal_entry.buildAndInsert` looks up a **journal** by code and an **open
accounting period** by date, both scoped to the entity. Neither is seeded — the
tenant seed creates the chart of accounts, the dictionary and the tax codes, but
**not** journals or periods. The sandbox seeder creates them and says why in its
own comment: *"required before anything can post to the ledger… Without these
the money-path seeder 422s 'No journal for BQ'."*

That seeder writes to the **sandbox** schema only. You are working in Live, so
nothing has created them for you. Every posting from step 9 onward will fail
until they exist.

```sql
-- Journals + an open FY2026 period for the entity. Run against the tenant DB.
INSERT INTO journal (code, name, entity_id)
SELECT v.code, v.name, e.entity_id
  FROM corporate_entity e,
       (VALUES ('VT','Ventes'), ('AC','Achats'), ('BQ','Banque'),
               ('PAIE','Paie'), ('OD','Opérations diverses')) AS v(code,name)
 WHERE e.code = 'ARL'
ON CONFLICT (entity_id, code) DO NOTHING;

INSERT INTO accounting_period (entity_id, code, starts_on, ends_on, status)
SELECT e.entity_id, '2026', DATE '2026-01-01', DATE '2026-12-31', 'OPEN'
  FROM corporate_entity e WHERE e.code = 'ARL'
ON CONFLICT (entity_id, code) DO NOTHING;
```

**Treasury accounts (MOD-09)** — Master Data → Treasury Accounts. Each maps to a
**postable** chart account:

| Kind | Label | COA |
|---|---|---|
| BANK | Afriland First Bank — compte principal | `5211` |
| CASH | Caisse siège Douala | `571` |
| MOMO | MTN Mobile Money | `5381` (fee account `631`) |

**Why 5211 and not 521.** `521` is a three-digit *grouping* with
`is_postable = false`; its postable leaves are `5211` / `5212`. Six services
once carried `treasuryCoa = "521"` as a default and every posting that fell
through to it failed at the moment money moved. The defaults now live in
settings under `('finance','accounts')` and resolve to postable leaves:
treasury `5211`, cash `571`, customer `4111`, customer advance `4191`, supplier
`4011`, disbursement `4731`. **Those are the codes you will see in the journals
later — not the three-digit groupings.**

---

## 2. Employees (MOD-02)

**People → Employees → Create**, five times. Only `full_name` is required;
everything else is optional and everything else matters.

| Full name | Department | Job title | Type | CNPS no. | Base salary | Hired on |
|---|---|---|---|---|---|---|
| Blake Tchoumi | Direction | Directeur Général | **CDI** | `0418720193` | 1 250 000 | 2018-03-14 |
| Aline Fotso | Finance | Responsable Financier | **CDI** | `0521840277` | 420 000 | 2020-06-01 |
| Serge Nkolo | Opérations | Chargé d'Opérations | **CDI** | `0619230845` | 380 000 | 2021-02-15 |
| Marthe Ekani | Ressources Humaines | Responsable RH & Paie | **CDI** | `0537910462` | 450 000 | 2019-09-02 |
| Bertrand Mbarga | Opérations | Déclarant en Douane | **CDI** | `0722640318` | 260 000 | 2023-01-09 |

Entity **ARL** on all five; signatory name = the person's own full name; bank
details at least for Mbarga, whose payslip you will generate. Set
**reports_to** so Mbarga reports to Nkolo — line manager is a real edge in the
tree, and cycles are rejected by the service.

**Employment type is `CDI`, not "Permanent".** The enum is the Cameroon/OHADA
vocabulary — CDI · CDD · STAGE · INTERIM · CONSULTANT · TEMPORARY — and it is a
*soft* enum: an unrecognised string is still accepted so a tenant is not
blocked, but the common set is what the UI and the AI understand.

**Three fields that look cosmetic and are not:**

- **`hired_on`** anchors leave accrual, which accrues per month of service. Blank
  and the accrual job has nothing to count from; the migration backfilled it
  from `created_at` as a proxy, and this is where a real date replaces that.
- **`risk_class_rate`** overrides the CNPS work-injury rate per employee. The
  default is **1.75%**, not a flat company figure — a declarant and a driver are
  not the same risk class.
- **`department`** is a display snapshot; the real reference is **`scope_id`**,
  which is what RBAC scoping filters on.

**What to look at.** Open Mbarga and note the salary is visible to you as
administrator. Come back at step 15 to see whether it is hidden from someone who
should not see it.

---

## 3. Users, roles and authority (MOD-67)

**Security → Users and Roles.** Create logins for four of the five (Mbarga needs
none) with password `Praxis!Demo2026`.

| User | Role | Authority (capability) |
|---|---|---|
| Blake Tchoumi | CEO / Executive | — (see below) |
| Aline Fotso | Finance | **VALIDATOR** |
| Serge Nkolo | Operations | **ISSUER** |
| Marthe Ekani | HR | — |

**Three different systems, and confusing them is the commonest way to get
stuck.** Access = **Role** × **Capability** × **Scope** × explicit CRUD per
module × field visibility, all of it rows a Super Admin edits — not enums, not
code. Adding a "Customs desk" unit is configuration, not a migration.

- **Role → permission matrix.** `permission(role_id, module_key)` with five
  booleans: create / read / update / delete / **approve**. This is what
  `requirePermission("MOD-03","approve")` reads.
- **Capability → the authority overlay.** ISSUER / VALIDATOR / APPROVER /
  LINE_MANAGER, assigned **per user**, never carried by a role. This is what
  document decisions and workflow steps check.
- **Scope → the organigramme tree**, which repos that opt in filter by.

**The CEO needs nothing assigned.** `is_ceo` short-circuits every
`requirePermission`, is handed all four capabilities outright, and is exempt from
the workflow eligibility test. The hint "CEO always has all" is literally true.

> **Two rules that will refuse you, both correctly.**
>
> **You cannot edit your own roles or authority** — not even as CEO. Two separate
> rules: nobody may change their own roles (`SELF_ROLE_CHANGE`), and nobody may
> grant themselves ISSUER/VALIDATOR/APPROVER (`SELF_GRANT_FORBIDDEN`). Granting
> to *another* user is fine. Always work from a second account.
>
> The reasoning is in a comment above `assertMayChangeRoles`: one
> `PATCH /users/{my own id}` adding the CEO role would flip `is_ceo` true on the
> very next request, after which every check in the product returns early.
> Forbidding self-edit outright removes the whole class of ordering arguments.

**Grants are cached for 30 seconds** in the identity cache. After changing a
permission, wait — or you will conclude the change did not save.

**Try this.** Sign in as Fotso and try to give yourself APPROVER. Refused. Then
grant it to her from the admin account. Works. That difference *is* segregation
of duties.

---

## 4. Client (MOD-03)

**Master Data → Clients → Create.**

| Field | Value |
|---|---|
| Name | Brasseries Mont Fébé SA |
| Legal name | Société des Brasseries du Mont Fébé SA |
| Client type | CONSIGNEE |
| NIU / RCCM | `M051912345678T` / `RC/DLA/2015/B/0892` |
| Country / City | CM / Douala |
| Address | Zone Industrielle de Bassa, BP 4471, Douala |
| Email / Phone | `achats@mont-febe.cm` / `+237 233 39 55 12` |
| Default currency / language | XAF / fr |
| Payment terms | 30 days |
| Credit limit | 25 000 000 |
| Advance required | Yes — 50% |
| Primary contact | Estelle Ngo Bikai — Responsable Achats — `e.ngobikai@mont-febe.cm` |
| Primary address | type **BILLING** — same address |

**Only `name` is required — and that is data, not code.** `party_field_config`
holds required/visible per field, tunable from Settings → Master Data. The seed
sets `name` mandatory and everything else visible-but-optional, so with no setup
at all that seed is the effective config.

**How activation is built, and why it will stop you.** `registration_status` is
one of the **sensitive columns** (with `legal_name`, `name`, `credit_limit`,
`niu`, `rccm`, `tax_residency_country`). In **Live**, changing one does not
write — it opens a `party_change_request` that a *second* person must approve.
In sandbox it applies directly, so training is never blocked.

So **Activate** produces "Pending approval · Sensitive changes", and the person
who raised it may not approve it. Note also:

> **Known gap.** No seeded role carries `approve` on MOD-03/MOD-04, so only a CEO
> can approve one — and if the CEO raised it, nobody can. Grant `approve` on
> MOD-03 and MOD-04 to Tenant Super Admin first, then raise as one person and
> approve as another. Finding **F-GAP-10** in
> `DOC_CODE_RECONCILIATION_2026-08-31.md`.

**Verify** is a different gate again: it refuses unless every mandatory document
has a **verified digital scan in the vault** (Hard Rule 9). Upload the taxpayer
card and business licence to see it pass.

**What to look at.** The client 360 shows a live receivables roll-up with aging
buckets — empty now, populated by step 12. And the credit limit of 25 000 000
against an operation of 7 824 500: watch for the breach warning at quotation.

---

## 5. Supplier (MOD-04)

**Master Data → Suppliers → Create.**

| Field | Value |
|---|---|
| Name | Transit Wouri SARL |
| Supplier type | TRANSPORTER |
| NIU / RCCM | `M081420987654R` / `RC/DLA/2014/B/2038` |
| Country / City | CM / Douala |
| Address | Rue Njo-Njo, Bonapriso, Douala |
| Email / Phone | `contact@transit-wouri.cm` / `+237 699 84 21 07` |
| Payment method | **MOBILE_MONEY** |
| MoMo network / number | MTN / `+237 677 45 92 13` |
| Payment terms | 15 days |
| Rating | 4 |

Same governed-activation path as the client — `registration_status` is sensitive
on both masters, because both are built on the same shared party module.
Verifying a supplier also sets `avl_status = 'APPROVED'` (approved vendor list),
which the client master has no equivalent of.

**What to look at.** Mobile money is first-class, not a note in a text field:
MoMo wallets are treasury accounts under `5381` with their own **fee account**
(`631`), so the provider's charge is booked separately from the payment rather
than silently netted off. That is a Cameroon-specific design decision, and it is
why the treasury account you created at 1b has a `momo_fee_account` column.

**Also worth trying:** the **→ Client** button. Smart Copy converts a supplier
into a draft client, carrying the universal legal data and registrations across
and linking the two — for the very common case where a haulier you buy from also
buys clearance from you.

---
## 6. Operations file (MOD-29) — the spine of everything that follows

**Operations → Operations Files → Create.**

The shipment form is not a fixed screen. It is the `SEA` field set this service
type carries, so choosing a different service type gives you different fields —
a warehousing file has no port and no ETA at all. Twenty fields, three groups,
**four required**: POL, POD, Commodity, Incoterm.

The rule behind that, from the seed itself: *required = knowable on the day the
file is opened.* A BL, a vessel, an ETA, a declaration number arrive later, and
"a form that demands them on day one gets fed invented values, which is worse
than an empty field." So several fields below are **deliberately left blank** —
note which, and which later step fills them.

**Header**

| Field | Value |
|---|---|
| Title | Import conteneur malt — Mont Fébé |
| Entity | Arena Logistics Cameroun SARL |
| Client | Brasseries Mont Fébé SA |
| Service type | Sea Freight Import (`SEA_FREIGHT_IMPORT`) |
| Currency | XAF |
| Operations owner | Serge Nkolo |

**Transport**

| Field | Value |
|---|---|
| Bill of Lading | `MSCU7842119` |
| Shipping line | MSC |
| Vessel / Voyage No | MSC NURIA / `246W` |
| Port of loading \* | Shanghai (CNSHA) |
| Port of discharge \* | Douala (CMDLA) |
| ETA | 2026-08-10 |
| ATA | **blank** — fill `2026-08-12` at step 11 |
| Place of delivery | Zone Industrielle de Bassa, Douala |

**Cargo**

| Field | Value |
|---|---|
| Commodity \* | Malt d'orge en sacs |
| Detailed description | Malt d'orge de brasserie en sacs de 50 kg, palettisé. Origine Chine. |
| Gross weight / Unit | 24000 / kg |
| Volume (CBM) | 58.5 |
| Package count | 480 |
| Marks & numbers | MONT FEBE / DLA / 1-480 |

Commodity is the *what*, not the how-much — the weight has a field of its own,
and 480 packages × 50 kg is the 24 000 kg beside it. The same 480 appears on the
delivery note in step 11.

**Customs & trade**

| Field | Value |
|---|---|
| Incoterm \* | CFR — Cost and Freight |
| Customs regime | IM4 — Home use |
| Declaration No | **blank** — fill `2026 IM4 034127` when the declaration is lodged |

**Containers — their own section**

This service type sets `captures_containers = true` (GROUPED), so the file has a
container section. Do not type the box into *Detailed description*: that field
is for cargo, and the section below is what the rest of the system reads.

Grouped line — known at booking: **40' HC (`FT40HC`) × 1**, 24 000 kg, 58.5 CBM.

Per-box unit — filled when the BL lands:

| Field | Value |
|---|---|
| Container No / Seal No | `MSCU4471820` / `CM884213` |
| Tare / Gross | 3 900 kg / 27 900 kg (cargo + tare — the VGM) |
| Discharged on | 2026-08-12 (= the ATA) |
| Out of port on | 2026-08-18 |
| Returned on | 2026-08-24 |

**Why the section earns its place.** The container type is drawn from the same
`dictionary_ref` registry that `expense_rate` prices against, so a file's
equipment and its rate card cannot disagree about what a 40' HC is. And those
three dates are what the demurrage engine counts between. In a text field, every
per-container charge on this file is an estimate; here, it is exact.

**Promote it.** A file is created as a **DRAFT** carrying a
`DRAFT-<uuid>` placeholder, and leaves draft by being **promoted** — its own
action, which allocates the real reference and enforces the fields the service
type marks required. Promote now and record the ref.

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


**What to look at.** Switch a scratch file to Warehousing and watch the ports,
vessel and ETA disappear entirely — replaced by custody questions. That is the
kick-off decision "services are configurable data, never hard-coded" made
visible, and it is the confusion the legacy system caused by showing a Port of
Loading on a warehousing job.

> From here on, **every** document points at this same file.

---

## 7. Costing (MOD-46) — where the OHADA distinction bites

Open the file's costing area, or **Costing → Costing → Create**. The modal is
titled *New costing sheet* and its own subtitle states the boundary: *"Planned
cost for a dossier — what the file will cost us, HT / VAT / TTC. Pricing
(margin) lives in the margin simulator and the quotation."*

### 7.0 The header — three fields

| Field | Value |
|---|---|
| **Dossier** \* | the operations file — the only required field |
| **Validator** | **Aline Fotso** |
| **Currency** | **XAF** — blank by default, set it |

*Validator* is "who this sheet is submitted to". The service stamps
`validator_assigned_at` on submit, so you are nominating your checker up front
rather than finding one afterwards — and it is **required**: submitting for
validation with nobody named is refused (`NO_VALIDATOR`), because a submission
with no owner goes to no one's queue.

> **If either dropdown is empty, it is a permission problem, not a broken
> control.** Validator loads `GET /users` (needs **MOD-67 view**); Currency loads
> `GET /currencies` (needs **MOD-08 view**). Neither failure is rendered
> anywhere, so a 403 arrives as an empty list. Currencies are always seeded
> (XAF, USD, EUR, NGN, CNY), so an empty currency list is *never* missing data.
>
> By default only SUPER_ADMIN, CEO and MANAGEMENT can read MOD-67, and Operations
> can read neither — which is the role that raises costings. Either run this step
> as the CEO, or grant Operations `view` on MOD-67 and MOD-08 first. Finding
> **F-GAP-12**.
>
> Currency is less fatal than it looks: the form's state defaults to `XAF`
> already, so a submit carries XAF even with no options drawn. The Validator is a
> hard block.

**A costing line carries exactly six things:** `dictionary_item_id`, `label`,
`qty`, `unit_cost`, **`is_disbursement`** (the *Débours · Pass-through*
checkbox), `tax_code_id` (the *VAT* dropdown), plus `container_type_ref_id`
recording which box the charge was priced for.

Note what is *not* on the form: **there is no margin field.**
`margin_percent` was removed from both schemas — a costing stops at HT / VAT /
TTC. An old client still sending it is silently stripped. The sheet answers one
question: *what does it cost us to execute this file?*

### 7.1 Finding the lines

The **Charge** box is a fuzzy search —
`GET /financial-dictionary/search?q=…` — scored on trigram similarity across the
English label, the French label and the description, with an exact-code and
keyword boost, and **scoped by service type** through
`service_type_dictionary_item`. That join is what makes it offer sea-import
charges rather than the whole 180-item catalogue. Type `douan`, `port` or
`conteneur` in either language and watch it rank.

### 7.2 The line set — costs only

**A costing carries what the file costs us. Nothing else.** No sell prices, no
fees, no margin — the modal's own subtitle says so, and the earlier version of
this document got it wrong by listing billable service lines here. Those belong
on the quotation (step 8), which is generated from this sheet.

**Disbursements** — tick **Débours · Pass-through**, VAT = **No VAT**. Money we
pay out on the client's behalf and re-bill at cost.

| Charge | Qty | Unit cost |
|---|---|---|
| Customs Duties & Taxes | 1 | 4 850 000 |
| Port Charges | 1 | 685 000 |
| Container Maintenance | 1 | 120 000 |
| Customs Clearance | 1 | 500 000 |
| **Disbursement subtotal** | | **6 155 000** |

**Our own costs** — leave Débours **unticked**. Things we buy, carry the risk on,
and resell.

| Charge | Qty | Unit cost | VAT |
|---|---|---|---|
| Inland Freight (bought from Transit Wouri) | 1 | 450 000 | **TVA 19.25%** |
| Bank Charges | 1 | 25 000 | No VAT |
| **Own-cost subtotal** | | **475 000** | |

**Remarks:** `Import 1×40'HC malt — MSC NURIA, BL MSCU7842119, ETA 10/08/2026`

### 7.3 Which items are which, and where to check

The dictionary carries a **direction** per item, and it is the answer to "should
this be ticked as débours?":

| Item | Direction | On this sheet |
|---|---|---|
| Customs Duties & Taxes · Port Charges · Container Maintenance · Customs Clearance | DISBURSEMENT | ticked |
| Bank Charges | EXPENSE (posts to `6311`) | unticked |
| File Opening · Documentation Fee · Import Declaration Fee · Extra Legal Work · Commission on Disbursement | REVENUE (posts to `7061`) | **not on a costing at all** |
| Inland Freight | DISBURSEMENT by default | **unticked here — a deliberate choice** |

That last row is worth understanding. The dictionary's default says trucking is
normally passed through at cost. In this scenario Arena **buys** the haulage from
Transit Wouri at 450 000 and **sells** it at 600 000, so it is our cost and our
risk, not the client's money in transit. `is_disbursement` is a per-line boolean
precisely so a tenant can make that call job by job — the direction is the
default, not the law.

It is also where the file's margin comes from. Everything else is either
pass-through (no margin by definition) or an agency fee.

### 7.4 The readout at the foot of the modal

| | XAF |
|---|---|
| Subtotal (HT) | **6 630 000** |
| VAT | **86 625** |
| Total estimated (TTC) | **6 716 625** |

**Two things about this footer that catch people out.**

**The subtotal includes every line**, disbursement and own cost alike — 6 155 000
+ 475 000. It is the whole cost of executing the file, which is the question the
sheet asks.

**The VAT here is *input* VAT, and it is recoverable.** 450 000 × 19.25% =
86 625, on the one line that carries a tax code. It is not what you will charge
the client — that VAT appears on the quotation. So the economic cost to execute
is the **HT figure, 6 630 000**.

**If your figures differ**, the fastest check: a VAT of anything other than
86 625 means a débours line has picked up a tax code, or the haulage line lost
one. The VAT dropdown defaults to **No VAT**, which is the usual culprit.


### 7.5 The four guards you cannot talk your way past

Every one is a **database trigger** on `journal_line` (`assert_line_valid`), not
a form validation — so no new screen or API route can route around them:

| Attempt | Refusal |
|---|---|
| Post to a non-postable account (e.g. `521`) | `account 521 is not postable (KB §23.3)` |
| Tax code on a disbursement line | `no VAT/tax may attach to a disbursement line (KB §23.5)` |
| Disbursement hitting a class 6 or 7 account | `disbursement line may not post to class 6/7 (KB §23.4)` |
| A `4731`, `706` or `707` line with no dossier | `account 4731 requires a dossier_id (KB §23.10)` |

That last one is PRD §8.8 made physical: `requires_analytic` is set on the
débours and revenue accounts, so **per-shipment margin can never have an
untagged hole in it.**

### 7.6 Move it through approval

States: `DRAFT → SUBMITTED_FOR_VALIDATION → SUBMITTED_FOR_APPROVAL →
APPROVED_LOCKED` (or `REJECTED`).

> **Known gap — the middle step is unreachable from the UI.** The screen offers
> **Submit for approval** and **Approve**, and nothing else. `SUBMIT_VALIDATION`
> exists in the service, the `SUBMITTED_FOR_VALIDATION` state is real, and the
> Validator you picked is required by it — but no button sends it, so that state
> can never be entered and `validator_assigned_at` is never stamped. Finding
> **F-GAP-13**.
>
> Also note **Approve is offered on a DRAFT**. One person can still take a costing
> from draft to approved-and-locked in a single click, which is the exact defect
> a comment in that file says was fixed. It is blocked only once an approval
> chain is open — and a chain only opens when somebody presses Submit first.

**So do this, which is the control that actually holds:**

1. As **Nkolo** — press **Submit for approval**. This opens the tenant's approval
   chain by firing `costing.submitted`, with the sheet's `total_ht` as the
   amount for any threshold rule.
2. As **Tchoumi** (or Fotso, if she holds APPROVER) — approve it, from the
   approvals queue or the Approve button.

That gives you genuine two-person maker-checker: the workflow executor enforces
**maker ≠ checker** for everyone, CEO included. What you cannot demonstrate
through the UI today is the three-person issue → validate → approve chain.

**Try this.** Press **Approve** as Nkolo, the person who raised it. If a chain is
open it is refused — whoever raises a record may never decide it, and that rule
has no CEO bypass. If you press Approve *first*, without submitting, no chain
exists and nothing stops you: that is F-GAP-13's second half, and it is worth
seeing once.

**To exercise the validation step anyway**, call the API directly:

```
POST /api/tenant/costings/{id}/status
{ "to": "SUBMIT_VALIDATION" }
```

It will refuse without a validator (`NO_VALIDATOR`), then move the sheet to
`SUBMITTED_FOR_VALIDATION` — which is where the Submit-for-approval button
expects to find it.

Once approved the sheet **locks**, and approval also snapshots the file's
shipment details onto it — an approved costing must keep citing the vessel and
route it was approved with, even after the carrier rolls the booking. It also
opens the DRAFT final invoice for step 12, synchronously.

Changing a locked sheet needs the unlock loop: `REQUEST_UNLOCK` (the issuer, with
a mandatory reason) → `UNLOCK` / `DENY_UNLOCK` (a decision, APPROVER only).

Totals on the approved sheet: **cost to execute 6 630 000 HT** (6 155 000
disbursement + 475 000 our own). Revenue and margin are not on this document —
they arrive in step 8.

---


## 8. Quotation (MOD-27 / commercial) — where pricing finally happens

Create from the costing, or **Sales → Quotations**, linked to client, file and
costing. **This is the first document that carries a sell price.**

> **The cast changes here — Operations cannot touch a quotation.** MOD-27 has no
> OPERATIONS row in the seeded grants, and absence means no access:
>
> | Role | create | read | edit | approve |
> |---|---|---|---|---|
> | Sales / CRM | ✓ | ✓ | ✓ | ✗ |
> | Management · Finance | ✗ | ✓ | ✗ | **✓** |
> | Super Admin · CEO | ✗ | ✓ | ✗ | ✗ (CEO bypasses regardless) |
> | Operations | — no row — | | | |
>
> The transitions split the same way — *"sending your own quotation out is not a
> decision; accepting or rejecting one is"*: `SENT` takes `edit`, `ACCEPTED` and
> `REJECTED` take `approve`.
>
> So: **create and send as a Sales user; accept as Fotso or Tchoumi.** None of
> the five employees in step 2 holds Sales, so add the **Sales / CRM** role to
> Nkolo (roles are a union — he keeps Operations). In a real tenant this would be
> a separate commercial person, which is the point: whoever prices the job is not
> whoever commits the company to the price.

**Disbursements, re-billed at cost** — no VAT, no margin, straight through:

| Line | XAF |
|---|---|
| Customs Duties & Taxes | 4 850 000 |
| Port Charges | 685 000 |
| Container Maintenance | 120 000 |
| Customs Clearance | 500 000 |
| | **6 155 000** |

**Our services** — VAT 19.25% on every line:

| Line | XAF |
|---|---|
| Inland Freight (bought at 450 000) | 600 000 |
| File Opening | 75 000 |
| Documentation Fee | 90 000 |
| Import Declaration Fee | 150 000 |
| Extra Legal Work | 300 000 |
| Commission on Disbursement | 185 000 |
| **Services HT** | **1 400 000** |
| **TVA 19.25%** | **269 500** |

| | XAF |
|---|---|
| Quote model | **HT_ON_TOP** (the default; the alternative is TTC) |
| **Quotation total** | **7 824 500** |
| Valid until | 2026-09-04 |

**The two numbers that tell the story.** Cost to execute was **6 630 000**;
we are quoting **7 824 500**. The difference is not the margin — most of it is
disbursement passing straight through. The margin is **services 1 400 000 minus
own costs 475 000 = 925 000 (66.1%)**, and that is the only figure that means
anything commercially.

Lifecycle: `DRAFT → SENT → ACCEPTED / REJECTED / EXPIRED`, and `ACCEPTED →
CONVERTED` when it becomes a final-invoice draft. Totals recompute on every edit;
the VAT rate comes from tenant settings (`finance.vat.rate_percent`), not a
constant. The **number is allocated on send**, so drafts burn none and the
sequence stays gap-auditable.

**What to look at.** It has **no accounting impact** — check the journals, still
nothing for this file. A quotation is an offer. And the PDF: tenant logo,
letterhead, NIU, RCCM, bank block, `ARL` numbering, rendered server-side by the
Puppeteer worker — the white-label engine and step 1's readiness rule paying off
together.

---

## 9. Advance-payment invoice (MOD-50)

From the accepted quotation: **Create advance invoice**, then record the payment.

| Field | Value |
|---|---|
| Amount | **3 912 250** (50% of 7 824 500) |
| Entry date | 2026-08-07 |
| Payment received | 2026-08-11, Afriland bank account |
| Signature | DIGITAL |

### What actually posts

Journal **BQ** (Banque):

| Account | | Dr | Cr |
|---|---|---|---|
| `5211` | Banque principale | 3 912 250 | |
| `4191` | Clients, avances et acomptes reçus | | 3 912 250 |

**The assertion.** A client advance is a **liability**, not revenue. Nothing
touches class 7. Open the income statement: turnover for this file is still
**zero**. The service file puts it in one line — *"A proforma is NOT revenue; a
payment on it is a LIABILITY."*

**If this fails with "No journal for BQ" or a period error, you skipped 1b.**

> **Watch rather than assert.** Whether VAT is also due when an advance on
> services is *collected* is a point of Cameroon practice this walkthrough does
> not rule on. Note what the system does and check it against `OHADA_KB.md` and
> your expert-comptable. The 4191 treatment is not in doubt; the VAT timing is.

---


## 10. Cash request (MOD-49) — régie d'avance

**Costing → Cash Requests → Create**, linked to the file and the approved
costing.

| Field | Value |
|---|---|
| Requested | **6 700 000** |
| Category | **OPS** (the other is OVH — overhead, which demands a justification) |
| Beneficiary | Serge Nkolo |
| Disbursement method | **BANK** (also CASH · CHEQUE · MOMO) |

Lines: customs 4 850 000 · port 685 000 · container maintenance 120 000 ·
customs clearance 500 000 · haulage 450 000 · contingency 95 000.

**The state machine is longer than most, and every state earns its place:**

`DRAFT → SUBMITTED → VALIDATED → APPROVED → PARTIALLY_DISBURSED / DISBURSED →
JUSTIFIED`

Two decisions, not one: **finance validates, management approves** — restored
for legacy parity. And `PARTIALLY_DISBURSED` loops to itself, because whether a
payment closes the request depends on the amount paid, not on a separate
decision. Raise as Nkolo → validate as Fotso → approve as Tchoumi → disburse
2026-08-13.

### Then justify it

On 2026-08-18 upload a receipt per line and justify. Actual spend **6 605 000**,
leaving **95 000** to return.

**What to look at.** The 95 000 gap is deliberate, and three things should react
to it: budget-versus-actual shows the variance rather than hiding it; the
compliance checker flags any line still lacking a receipt and keeps flagging it
daily; and the outstanding advance ages against the régie policy window
(`4211`). A request that reconciles to zero demonstrates none of this.

---

## 11. Delivery note (MOD-32)

**Operations → Delivery Notes → Create**, linked to the file.

| Field | Value |
|---|---|
| Consignee | Brasseries Mont Fébé SA |
| City / zone | Douala — Zone Industrielle de Bassa |
| Contact person / phone | Estelle Ngo Bikai / `+237 233 39 55 12` |
| Delivery date | 2026-08-22 |
| Line | 480 sacs malt d'orge — 24 000 kg brut |
| Container | `MSCU4471820` — pulled from the file's container unit, not retyped |

Lifecycle `DRAFT → ISSUED → DELIVERED` (or `CANCELLED`). Only a **DRAFT** is
freely editable — with one deliberate exception: an ISSUED note is travelling
with a driver, and the delivery address genuinely does get corrected mid-run
("they moved to gate 4"), so that stays editable while the lines do not.

**What to look at.** The container dropdown offers `MSCU4471820` because you put
it in the file's container section at step 6 rather than in a text field. This is
where that decision pays out.

---

## 12. Final invoice (MOD-51)

Open the file → **Create final invoice** → add lines → **submit**.

| | XAF |
|---|---|
| Disbursements re-billed at cost (no VAT) | 6 155 000 |
| Services HT | 1 400 000 |
| TVA 19.25% | 269 500 |
| **Invoice total** | **7 824 500** |
| Less advance applied | (3 912 250) |
| **Balance due** | **3 912 250** |

Entry date 2026-08-25, terms 30 days → due **2026-09-24**. Leave it unpaid so it
shows in receivables.

### How posting actually works

`submit` moves the invoice to `SUBMITTED_FOR_APPROVAL` and starts the approval
chain. **If the chain auto-approves it posts immediately; otherwise it posts on
approval.** Posting does three things in one transaction:

1. **The sale entry**, journal **VT**, counterpart `4111`. Each line's account is
   resolved by the *determination* service from the item's posting rule — not
   chosen by the user, which is the seam PRD §8.7 insists on.
2. **The number is allocated** — at post, not at draft. PRD §8.2: numbers exist
   only on issue.
3. **A second entry clears the advance**: Dr `4191` / Cr `4111`, both dossier-
   tagged, and the advance's `applied_amount` is written back.

### Three assertions

1. **Turnover is 1 400 000, not 7 824 500.** Open the income statement. The
   6 155 000 of disbursement appears nowhere in class 7. This is the assertion the
   whole OHADA design exists to satisfy.
2. **The client is not billed twice.** The advance is applied, balance due is
   3 912 250, and `4191` is cleared rather than left as a standing liability.
3. **Disbursements carry no VAT.** VAT collected is 269 500 — 19.25% of services
   only.

**Try this.** Delete the posted invoice. Refused — a posted document is
reversal-only, with a mandatory reason, and both the original and its reversal
stay permanently. Then try God Mode as the CEO: also refused, because the invoice
has written to the immutable ledger. God Mode is for junk non-accounting data,
and the ledger is beyond every role including the CEO.

---

## 13. Payroll (MOD-17)

**People → Payroll → Payroll Runs → Create**, entity ARL, period **`2026-08`**
(the format is enforced: `YYYY-MM`, and a second run for the same period is
refused with `RUN_EXISTS`).

Compute, then walk it through
`OPEN → COMPUTED → SUBMITTED → APPROVED → VALIDATED → DISBURSED`.

**You enter none of the rates.** `computePayslip` snapshots the rates in force at
compute time, so a later rate change cannot retroactively alter a closed run.
The defaults, verified against KB §9:

| | |
|---|---|
| CNPS pension | 4.2% employee + 4.2% employer, on a base **capped at 750 000/month** |
| CNPS family allowance | 7% employer (also capped) |
| CNPS work injury | **1.75%** employer default, overridden per employee by `risk_class_rate` |
| CFC | 1% employee / 1.5% employer |
| FNE | 1% employer |
| IRPP base | (gross − CNPS pension) × 70% − 41 667 monthly abatement, annualised |
| IRPP brackets | 10% to 2M · 15% to 3M · 25% to 5M · 35% above |
| CAC | 10% surtax on IRPP |

### The whole run, computed

| Employee | Gross | CNPS | CFC | IRPP | CAC | Deductions | **Net** | Employer charges |
|---|---|---|---|---|---|---|---|---|
| Mbarga | 260 000 | 10 920 | 2 600 | 13 269 | 1 327 | 28 116 | **231 884** | 40 170 |
| Nkolo | 380 000 | 15 960 | 3 800 | 23 641 | 2 364 | 45 765 | **334 235** | 58 710 |
| Fotso | 420 000 | 17 640 | 4 200 | 27 664 | 2 766 | 52 271 | **367 729** | 64 890 |
| Ekani | 450 000 | 18 900 | 4 500 | 31 692 | 3 169 | 58 262 | **391 738** | 69 525 |
| Tchoumi | 1 250 000 | 31 500 | 12 500 | 208 949 | 20 895 | 273 844 | **976 156** | 137 125 |
| **Run** | **2 760 000** | | | | | | **2 301 743** | **370 420** |

Total employer cost **3 130 420**. Mbarga's employer charges break down as
pension 10 920 · family 18 200 · injury 4 550 · CFC 3 900 · FNE 2 600.

**If your figures differ, the config is not reading the seed** — these are
arithmetic, not opinion. One caveat the code states itself: every payslip is
flagged `estimate: true` until professionally validated (KB §9).

### What posts

Journal **PAIE**: gross salary cost to class 66 (661/664), net to `422`
(staff remuneration payable), social contributions to `431` (CNPS), income tax
withheld to `447` (State). The entry must balance.

**A design decision worth noticing:** GL posting here is *gracefully degrading*.
If the ledger is not configured, the run is recorded **without** an `entry_id`
rather than failing the payroll — because people must be paid even when the
accountant has not finished setting up. Check the run carries an entry; if it
does not, that is 1b again.

**One more, if you want to see the clamp.** Give Mbarga a salary advance with an
instalment larger than his net. The recovery is clamped to what is actually
left — the unrecovered part stays owing on the recovery plan, and he takes home
zero rather than a negative payslip.

Generate Mbarga's payslip and open the PDF.

---

## 14. Accounting traceability (MOD-55 / MOD-56 / MOD-57)

**Finance → Journal Entries**, filtered to entity ARL and the file.

Every entry carries a `source` — `SYSTEM_AUTO` · `SYSTEM_RULE` ·
`HUMAN_MANUAL` · `HUMAN_CORRECTION` — and a `review_status`
(`UNREVIEWED` · `ATTESTED` · `FLAGGED` · `CORRECTED`). Everything you have
created is `SYSTEM_RULE`: posted by a rule, awaiting a human accountant's
attestation. That is the PRD's "auto-journalled, human reviewable" in the schema.

Open one entry per source and confirm it balances, names its source document and
carries the dossier:

- [ ] Advance received — **BQ** — Dr `5211` 3 912 250 / Cr `4191`
- [ ] Cash disbursement — régie `581` → `4211`
- [ ] Débours purchases — **AC** — Dr `4731` / Cr `4011`
- [ ] Haulage supplier invoice — **AC** — Dr class 6 + Dr `4452` / Cr `4011`
- [ ] Final invoice — **VT** — Dr `4111` / Cr `706` + Cr `4432` + Cr `4731`
- [ ] Advance applied — Dr `4191` / Cr `4111`
- [ ] Payroll — **PAIE** — Cr `422` / Cr `431` / Cr `447`

Then:

1. **Trial balance.** Σ Dr = Σ Cr. It cannot be otherwise — the balance rule is a
   *deferrable* constraint trigger, so an unbalanced entry is rejected at commit
   rather than found at month end. Confirm anyway.
2. **Income statement.** Turnover **1 400 000**. Not 7 824 500.
3. **Grand livre** — drill into `4731` and watch the débours net to zero across
   the purchase and the re-billing. That is the whole pass-through model in one
   account.
4. **Client statement** — advance applied, 3 912 250 outstanding, due 2026-09-24,
   in the right aging bucket.
5. **The file's 360 view** — budget versus actual with **disbursements excluded
   from margin**: revenue 1 400 000, own costs 475 000, margin **925 000 (66.1%)**.

**The entry numbering.** `entry_no` is gap-free and monotonic per journal per
period, allocated under an advisory lock. Try to find a gap; there isn't one, and
that is what makes the sequence auditable.

**Try this.** Reverse one entry (`POST /journal-entries/:id/reverse` — an
`approve`-grade action). A **new** entry appears pointing at the original through
`corrects_entry_id`. The original is untouched. Journals are corrected by
reversal, never by editing — KB §3, §13.

---
## 15. Confidentiality — what to expect, and one known gap

Log in as **Serge Nkolo** (Operations) and open:

1. The **operations file 360° view** → the margin should be masked.
2. **Costing → the approved costing** for the same file.
3. **Commercial → Margin Simulator**.
4. **Master Data → Suppliers → Transit Wouri** → the cost rates.

The seeded policy masks `dossier.margin` and `supplier.cost_rate` from
Operations and Sales.

> **Known gap, do not chase it.** As of the 2026-08-31 audit, the field-mask
> serializer is applied on only two surfaces — the employee record and the
> operations file. The margin simulator, costing, cost tracking, reconciliation,
> payroll, supplier master and expense rates do **not** apply it, so the
> configured mask silently does nothing there. If Nkolo sees a raw margin on
> screen 2, 3 or 4, that is finding **F-GAP-01** in
> `DOC_CODE_RECONCILIATION_2026-08-31.md`, not a mistake in your setup. Screen 1
> should mask correctly.

---

## Completion checklist

**Setup**

- [ ] Tenant provisioned; workflows, chart of accounts, dictionary, tax codes seeded
- [ ] Corporate entity created — OHADA framework, `ARL` prefix, and **readiness satisfied** (registrations, REGISTERED address, legal representative, share capital)
- [ ] **Journals (VT/AC/BQ/PAIE/OD) and an OPEN 2026 period exist for the entity**
- [ ] Treasury accounts created against **postable** leaves (`5211`, `571`, `5381`)
- [ ] Five employees, employment type **CDI**, `hired_on` set, Mbarga reporting to Nkolo
- [ ] Roles **and** capabilities assigned from a second account; self-grant refused
- [ ] Client and supplier created, activated through maker-checker, and verified

**Operation**

- [ ] One file promoted out of draft; container in the container section, not the description
- [ ] Every downstream document points at that file
- [ ] Costing carries **cost lines only** — no fees, no sell prices, no margin
- [ ] Costing footer: HT **6 630 000**, input VAT **86 625** (the haulage line only)
- [ ] A tax code on a disbursement line was refused by the database
- [ ] Costing issued, validated and approved by three different people
- [ ] Self-validation by the issuer refused — including for the CEO

**Money**

- [ ] Quotation 7 824 500, `HT_ON_TOP`, **no** accounting impact
- [ ] Advance 3 912 250 → Dr `5211` / Cr `4191`, **no revenue**
- [ ] Cash request through both decisions, disbursed, justified; 95 000 variance visible
- [ ] Delivery note pulls the container from the file
- [ ] Final invoice 7 824 500, advance applied, balance 3 912 250
- [ ] **Turnover = 1 400 000. Disbursements nowhere in class 7.**

**Payroll and proof**

- [ ] Payroll run to DISBURSED, carrying an `entry_id`
- [ ] Mbarga's net = **231 884**; employer charges **40 170**
- [ ] Payslip PDF generated
- [ ] Every entry balanced, `SYSTEM_RULE`, sourced and dossier-tagged
- [ ] `entry_no` gap-free per journal per period
- [ ] Trial balance balances; `4731` nets to zero in the grand livre
- [ ] Dossier margin 925 000, disbursements excluded
- [ ] Posted invoice: delete refused, God Mode purge refused, reversal creates a new linked entry

---

## If you are recording this

Four chapters: **Setup** (entity, employees, roles, client, supplier) ·
**Operation** (file, costing, quotation) · **Money** (advance invoice, cash
request, delivery note, final invoice) · **Proof** (payroll, journals, trial
balance, margin).

Record the reference and status after every save — the closing accounting
section is far more convincing when you can point back at numbers the viewer has
already watched being created.
