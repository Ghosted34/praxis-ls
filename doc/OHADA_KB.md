# SmartLS — OHADA / SYSCOHADA Accounting & Cameroon Tax Knowledge Base
### Developer Reference — attach to the PRD (Master Functional Specification v1.0)

**Scope:** This document is the single source of truth for how SmartLS records money. It covers (A) the full OHADA/SYSCOHADA accounting model — principles, the complete chart of accounts, double-entry mechanics, the logistics-specific disbursement model, journal-entry recipes, payroll, VAT, fixed assets and the financial statements; and (B) a **Tax Center** giving the exact rates payable in Cameroon. It is written for engineers who have **no prior exposure to OHADA or Cameroonian tax**, so it defines every term and gives the exact accounts and postings to implement.

**Jurisdiction assumed:** Cameroon (CEMAC / OHADA zone). **Currency:** XAF (FCFA). **Accounting framework:** SYSCOHADA révisé (the chart of accounts annexed to the **AUDCIF** — *Acte uniforme relatif au droit comptable et à l'information financière*, adopted 26 Jan 2017, in force 1 Jan 2018 for company accounts). **Language of record:** the statutory chart is in French; account names below are given in French (canonical) with English glosses.

> **Legal disclaimer.** Account numbers and treatments follow SYSCOHADA révisé and are stable. **Tax rates, brackets and thresholds change every year with the Cameroon Finance Law (Loi de Finances).** Every rate in the Tax Center must be re-validated each January against the current Finance Law and signed off by a licensed Cameroonian accountant (expert-comptable) before go-live. This document is engineering guidance, not tax advice.

---

## Table of contents

**PART A — ACCOUNTING**
0. How to use this document (conventions)
1. What OHADA / SYSCOHADA is (the legal frame)
2. The core accounting principles (and what each means for the code)
3. Double-entry mechanics (the rules the engine must obey)
4. Architecture: Chart of Accounts vs Financial Dictionary vs Posting Rules — **the merge decision**
5. The full chart of accounts (all 9 classes)
6. The logistics accounting model — **débours vs revenue** (the most important section)
7. The document & operation lifecycle — what actually hits the ledger
8. Journal-entry cookbook (every common operation, with postings)
9. Payroll accounting & computation (Cameroon)
10. VAT (TVA) mechanics
11. Fixed assets & depreciation
12. The financial statements (Bilan, Compte de résultat, TAFIRE, Notes, ESS) + management balances
13. Books, records & the audit trail

**PART B — TAX CENTER (exact rates)**
14. Cameroon tax overview & taxpayer regimes
15. Corporate Income Tax (IS) + minimum tax
16. VAT (TVA)
17. Withholding taxes / précompte / acompte
18. Payroll taxes & social contributions
19. Other taxes (patente, registration, stamp, property, customs)
20. Tax calendar
21. Tax-jurisdiction data model (for MOD-07)

**PART C — DEVELOPER APPENDICES**
22. Recommended data model & the account-determination engine
23. Hard validation rules the system MUST enforce
24. End-to-end worked scenario (the 10M ACME operation)
25. Glossary / bilingual financial dictionary
26. Sources

---

# PART A — ACCOUNTING

## 0. How to use this document (conventions)

- **Dr** = Debit, **Cr** = Credit. Every posting has at least one Dr line and one Cr line, and **total Dr must equal total Cr** (the golden rule; see §3).
- Account codes are SYSCOHADA révisé. A code like `4731` is a 4-digit **sub-account** of the 3-digit account `473`, which sits inside the 2-digit account `47`, inside **class 4**. Codes get more specific as digits are added (decimal classification).
- `XAF` amounts in examples are illustrative.
- Where a treatment is logistics-specific (transit/freight-forwarding), it is flagged **[LOGISTICS]**.
- Where something maps to a SmartLS module it is flagged, e.g. **(MOD-55 Journal Entries)**.
- **[VERIFY]** marks a figure or rule to confirm with a licensed accountant before go-live.

---

## 1. What OHADA / SYSCOHADA is (the legal frame)

**OHADA** (Organisation pour l'Harmonisation en Afrique du Droit des Affaires) is a treaty organisation of **17 African member states** (incl. Cameroon, Côte d'Ivoire, Senegal, Gabon, Congo, Chad, CAR, Equatorial Guinea, Benin, Burkina Faso, Mali, Niger, Togo, Guinea, Guinea-Bissau, Comoros, DRC). It issues **Uniform Acts** that are directly applicable law in every member state.

**SYSCOHADA** (*Système Comptable OHADA*) is the accounting system — a mandatory **chart of accounts** plus valuation and presentation rules — annexed to the accounting Uniform Act. The current version is **SYSCOHADA révisé**, annexed to the **AUDCIF** (in force **1 Jan 2018** for individual/company accounts; **1 Jan 2019** for consolidated/combined accounts). It replaced the older 2000 Act.

**Who must keep accounts (Art. 2 AUDCIF):** essentially every commercial company, state/parastatal entity, mixed-economy company, cooperative and any producer of goods/services engaging in economic activity for profit or not — except entities under public-accounting rules. **Banks, financial institutions and insurers use their own specific charts** (not SYSCOHADA). A logistics company like Smart Logistics is squarely **inside SYSCOHADA**.

**Three accounting systems by size (turnover / chiffre d'affaires):**

| System | French name | Who | Statements required |
|---|---|---|---|
| Normal | Système normal | Turnover **> 100M XAF** (and any company by default) | Bilan, Compte de résultat, TAFIRE, Notes annexes, + ESS (statistical) |
| Light | Système allégé (SMT) | Turnover **≤ 100M XAF** | Simplified Bilan, Compte de résultat, Notes (no TAFIRE, no ESS) |
| Minimum cash | Système minimal de trésorerie | Very small (thresholds: 60M trade / 40M craft / 30M services — figures per revised AUDCIF; **[VERIFY]**) | Cash-basis statement only |

> **For SmartLS:** a freight forwarder handling multi-million-XAF single operations is on the **Système normal**. Build for the normal system (full Bilan + Compte de résultat + TAFIRE + Notes). This also aligns with the **régime du réel** for tax (§14).

**Fiscal year (Art. 7):** 12 months, coinciding with the **calendar year** (1 Jan – 31 Dec). First year may be shorter/longer. **Annual statements must be drawn up within 4 months of year-end** (Art. 23) and approved within 6 months.

**Language & currency (Art. 17):** bookkeeping in the **official language and the legal currency** of the country → for Cameroon, French (or English in Anglophone practice) and **XAF**. SmartLS's EN/FR localization (per PRD §2.1) is compatible, but the **canonical account names are French**.

**Retention (Art. 24):** books, supporting documents and records kept **10 years**. → Directly relevant to **MOD-64 File Repository** and **MOD-69 Immutable Ledger**.

---

## 2. The core accounting principles (and what each means for the code)

SYSCOHADA is built on a set of principles ("principes comptables"). Each has a concrete engineering consequence.

1. **Prudence (prudent-man rule).** Anticipate probable losses, never anticipate profits. → The engine must let you book provisions/impairments for probable losses (classes 19, 29, 39, 49, 59, 69) even with no profit, but must **not** recognise unrealised gains as income (e.g. unrealised FX gains go to a balance-sheet holding account, not to P&L — see §8 FX).

2. **Historical cost (coût historique).** Assets are recorded at acquisition/production cost, not market value (revaluation only under specific rules). → Asset cost = purchase price + directly attributable costs (transport, customs, install) net of recoverable VAT. **(MOD-54 Asset Management)**.

3. **Going concern (continuité d'exploitation).** Accounts assume the business continues. → Normal (not liquidation) valuation basis.

4. **Accrual / matching (spécialisation / rattachement des charges et produits à l'exercice; indépendance des exercices).** Record income and expenses **in the period they are earned/incurred**, regardless of cash timing. **This is the single most important principle for SmartLS** (see §7): cash received before a service is rendered is a **liability (advance)**, not revenue.

5. **Permanence of methods (permanence des méthodes).** Same accounting methods period to period; any change disclosed in the Notes. → Configuration of depreciation methods, valuation methods, etc. must be versioned, not silently changed.

6. **Non-compensation (non-compensation).** You may **not** net an asset against a liability, or income against an expense, unless legally founded. → The engine must never offset a client receivable against a supplier payable, or revenue against cost, in the GL. (Débours are *not* an exception — they transit a third-party account and are cleared against themselves, not netted against revenue; see §6.)

7. **Intangibility of the opening balance (intangibilité du bilan d'ouverture).** Opening balance of a year = closing balance of the prior year, exactly. → Year-end close must carry forward every balance; no manual re-baselining.

8. **Faithful image / regularity / transparency (image fidèle, régularité, transparence, bonne foi).** The statements must faithfully present assets, financial position and result. Where a rule is insufficient, add explanation in the Notes.

9. **Substance / clarity, and the "importance significative" (materiality).** Present information clearly; immaterial items may be grouped.

> **Engineering takeaway:** items 4, 6 and 7 are the ones a naïve ERP violates. Bake them in as invariants (see §23).

---

## 3. Double-entry mechanics (the rules the engine must obey)

**The golden rule.** Every economic event is recorded as a **journal entry (écriture)** made of ≥2 lines. Each line is a Debit **or** a Credit on one account for a positive amount. **Σ Debits = Σ Credits** for every entry. An entry that does not balance must be rejected.

**What Debit/Credit mean per account family (normal balances):**

| Class family | Increases with | Decreases with | "Normal" balance |
|---|---|---|---|
| **Assets** (classes 2, 3, 5; debit-side of class 4) | **Debit** | Credit | Debit |
| **Liabilities & equity** (class 1; credit-side of class 4) | **Credit** | Debit | Credit |
| **Expenses / charges** (classes 6, and 8 charge accounts) | **Debit** | Credit | Debit |
| **Income / produits** (classes 7, and 8 income accounts) | **Credit** | Debit | Credit |

Mnemonics that always hold in SYSCOHADA:
- Receiving cash into the bank → **Dr 521** (asset up). Paying out → **Cr 521** (asset down).
- Recognising a sale of service → **Cr 706** (income up) and the counterpart **Dr 411** (client owes us) or **Dr 5xx** (cash in).
- Recognising a cost → **Dr 6xx** (expense up) and **Cr 401 / 5xx** (we owe a supplier / cash out).
- A customer advance (money before the work) → **Cr 4191** (liability up) with **Dr 521** (cash in).

**The accounting equation** it all serves:
`Assets = Liabilities + Equity` and, over a period, `Result (profit/loss) = Income (class 7/8) − Expenses (class 6/8)`. The result computed in classes 6/7/8 lands in **account 131 Résultat net** (equity) at year-end.

**Terminaison convention (a SYSCOHADA quirk worth knowing):** among 2-digit management accounts, **odd endings = charges, even endings = products** (e.g. 67 charges financières / 77 produits financiers; 65 autres charges / 75 autres produits). A trailing **9** on a management account relates to provisions/reprises. A trailing **9** on a balance-sheet account (19, 29, 39, 49, 59) = depreciation/provision. This lets you infer an account's nature from its number.

**Journals (journaux).** Entries are grouped into day-books before centralisation: typically **Achats** (purchases), **Ventes** (sales), **Banque/Caisse** (treasury), **Paie** (payroll), **OD** (opérations diverses / miscellaneous). SmartLS's **MOD-55 Journal Entries** should let entries be tagged to a journal; the **grand livre** and **balance** are derived (see §13).

---

## 4. Architecture: Chart of Accounts vs Financial Dictionary vs Posting Rules — the merge decision

**Your question: should MOD-05 (Financial Dictionary) and MOD-06 (Chart of Accounts) be merged? — No. Keep them as separate layers, and eliminate the overlap that currently exists between them.** Here is why, and the model to build.

There are **three** distinct concepts. Your PRD collapses two of them, which is the source of the confusion.

### Layer 1 — Chart of Accounts (COA) = MOD-06
The **statutory** SYSCOHADA ledger accounts (classes 1–9). Properties:
- **Regulated & stable** — defined by OHADA, the same for every company; it changes only when OHADA revises the standard.
- **Hierarchical** — class (1 digit) → account (2 digits) → sub-account (3 digits) → detail (4+ digits). **This "Main account / Sub-account" hierarchy is exactly what your MOD-05 note describes — but it belongs HERE, in the COA, not in the Financial Dictionary.**
- It is what the **General Ledger, trial balance, financial statements and tax returns** are built on.
- Audience: accountants, auditors, the tax authority.

### Layer 2 — Financial Dictionary / Item Catalogue = MOD-05 (re-scoped)
The **operational** catalogue of things that appear on quotes, costings, invoices and disbursements. Examples for SmartLS:
`Customs duty (débours)`, `Maersk THC / handling`, `PAD port storage`, `Shipping-line D&D`, `Last-mile trucking`, `Transit commission`, `Documentation fee`, `Escort/convoy fee`.
Properties:
- **Company-specific & user-editable** — it grows as the business adds services and as shipping-line rates change (**MOD-10 Expense Rates** feeds pricing here).
- Each item is **friendly-named** and is what non-accountants and the **AI agent (MOD 6.2)** interact with ("AI scans Financial Dictionary, maps expense…" — this only works if each dictionary item carries its accounting mapping).
- Each item carries **pricing/rate data** — which has no place in a statutory COA.

### Layer 3 — Posting Rules / Account Determination (the glue — build it explicitly)
The mapping engine: **each Financial Dictionary item → one or more COA accounts + a tax code + a débours-vs-revenue classification.** This is the layer SAP calls "account determination" and Odoo implements as product→account mapping. It is where the intelligence lives.

**Why merging Layers 1 and 2 is a mistake:**
1. **Cardinality.** A single dictionary line can post to **several** accounts. Example — an invoice line "Transit commission 500,000" posts to **Cr 706** (revenue) **and Cr 4432** (output VAT) **and Dr 411** (client). A line "Customs duty (débours) 5,000,000" posts to **Dr/Cr 4731** only, touching **no** revenue account. A flat merged list cannot express this.
2. **Governance.** The COA is regulated and shared; the dictionary is operational and mutable. Different change-control, different owners.
3. **Data shape.** The dictionary needs rate/price/currency/shipping-line fields; the COA must stay a clean statutory list for reporting and audit.
4. **Audience & reuse.** Reports and auditors need the clean COA; operators and the AI need the friendly dictionary. One dictionary item may even map differently per context (débours vs refacturation).

**What to actually do:**
- Move the **Main/Sub-account hierarchy into MOD-06 (COA)**. The COA is the hierarchy.
- Re-scope **MOD-05** as the **Item Catalogue with account determination** (not a parallel chart).
- Build **Layer 3** as a `posting_rules` table (see §22). Every dictionary item **must** carry: a default account (or accounts), a **tax_code**, and a **`is_debours` flag**. No dictionary item may be saved without a complete mapping — enforce this (see §23).

> **One-line answer for the dev team:** *"COA = statutory accounts (hierarchical, MOD-06). Dictionary = operational items you bill/cost (MOD-05). Never duplicate the account hierarchy inside the dictionary — instead, every dictionary item points to COA accounts through a posting rule that also carries its tax code and its débours flag."*

---

## 5. The full chart of accounts (all 9 classes)

SYSCOHADA uses a **decimal, 9-class** codification. Classes **1–5 are balance-sheet** accounts; **6–7 are the ordinary-activity P&L**; **8 is out-of-ordinary-activity (HAO) and income tax**; **9 is off-balance-sheet commitments + cost accounting (optional)**.

> The tables below list **every 2-digit account** and the **principal 3-digit accounts**, plus the **4-digit detail that matters for a logistics company**. Column "Bal" = normal balance (D=debit, C=credit). "★" = high-frequency for SmartLS. **The complete 4-digit reference chart for every class is in Appendix A** — seed your `chart_of_accounts` table from it (and reconcile against the official annexed plan in your uploaded *2017 Revised OHADA Accounting Plan* for any edge account).

### CLASS 1 — Comptes de ressources durables (Equity & long-term liabilities) — Bal: **C**

| Code | Designation (FR) | EN gloss | Notes |
|---|---|---|---|
| 10 | Capital | Capital | |
| 101 | Capital social | Share capital | The company's registered capital |
| 104 | Compte de l'exploitant | Sole-trader's account | Only for sole proprietorships |
| 105 | Primes liées au capital social | Share premiums | |
| 106 | Écarts de réévaluation | Revaluation surplus | Not distributable |
| 109 | Actionnaires, capital souscrit non appelé | Uncalled subscribed capital | Contra (debit) |
| 11 | Réserves | Reserves | |
| 111 | Réserve légale | Legal reserve | |
| 112 | Réserves statutaires | Statutory reserves | |
| 118 | Autres réserves | Other reserves | |
| 12 | Report à nouveau | Retained earnings b/f | 121 credit (profit c/f), 129 debit (loss c/f) |
| 13 | Résultat net de l'exercice | Net result for the year | ★ 131 profit / 139 loss — the P&L lands here at close |
| 14 | Subventions d'investissement | Investment/capital grants | Grants for buying assets |
| 15 | Provisions réglementées et fonds assimilés | Regulated provisions | e.g. 151 amortissements dérogatoires (tax-driven) |
| 16 | Emprunts et dettes assimilées | Loans & similar debt | ★ 162 loans from credit institutions; 165 deposits/guarantees received; 166 accrued interest |
| 17 | Dettes de location acquisition | Finance-lease liabilities | Leasing/crédit-bail liability side |
| 18 | Dettes liées à des participations / comptes de liaison | Inter-company / branch liaison | Used for multi-entity (MOD-01) inter-company |
| 19 | Provisions pour risques et charges | Provisions for risks & charges | ★ 191 litigation, 194 FX loss, 195 tax, 198 other |

### CLASS 2 — Comptes d'actif immobilisé (Fixed / non-current assets) — Bal: **D**

| Code | Designation (FR) | EN gloss | Notes |
|---|---|---|---|
| 20 | Charges immobilisées | Capitalised set-up costs | 201 frais d'établissement, 202 charges à répartir |
| 21 | Immobilisations incorporelles | Intangible assets | 211 dev. costs, 212 patents/licences, **213 logiciels & sites internet** (the ERP licence itself), 215 fonds commercial, 216 droit au bail |
| 22 | Terrains | Land | 221 agricultural, 222 bare land, 223 built land |
| 23 | Bâtiments, installations techniques et agencements | Buildings, plant & fittings | ★ warehouses, docks: 231 buildings on own land, 233 infrastructure works, 234 installations techniques |
| 24 | Matériel, mobilier et actifs biologiques | Equipment, furniture, biological | ★ 241 matériel & outillage; **2442 matériel informatique**; **2444 mobilier de bureau**; **245 Matériel de transport (the FLEET — trucks, trailers, forklifts on wheels)** |
| 25 | Avances et acomptes versés sur immobilisations | Advances on fixed assets | Deposits paid on assets under order |
| 26 | Titres de participation | Investments in subsidiaries | Long-term equity holdings |
| 27 | Autres immobilisations financières | Other financial fixed assets | 271 loans, 272 staff loans, **275 dépôts et cautionnements versés** (deposits/guarantees paid, e.g. to PAD/shipping lines) |
| 28 | Amortissements | Accumulated depreciation | Contra-asset (credit): 2813 software, 2831 buildings, **2845 matériel de transport** |
| 29 | Dépréciations des immobilisations | Impairment of fixed assets | Contra (credit) |

**[LOGISTICS] Fleet & warehouse mapping (MOD-39, MOD-54):** trucks/trailers → **245**; forklifts/reach-stackers → **241** (industrial equipment) or **245** if road-registered; warehouse building → **231/233**; racking/fit-out → **234/237/238**; the SmartLS software licence itself → **213**. Each asset's accumulated depreciation posts to the matching **28xx** contra account.

### CLASS 3 — Comptes de stocks (Inventory) — Bal: **D**

| Code | Designation (FR) | EN gloss | Notes |
|---|---|---|---|
| 31 | Marchandises | Goods for resale | Rare for a pure forwarder |
| 32 | Matières premières et fournitures liées | Raw materials | |
| 33 | Autres approvisionnements | Other supplies | ★ **331/332 consumables, spare parts, tyres, lubricants** for the fleet; fuel stock if held |
| 34 | Produits en cours | Work-in-progress | |
| 35 | Services en cours | Services in progress | Could hold partially-rendered operations |
| 36 | Produits finis | Finished goods | |
| 37 | Produits intermédiaires et résiduels | Intermediate/residual products | |
| 38 | Stocks en cours de route, en consignation, en dépôt | Goods in transit / on consignment | |
| 39 | Dépréciations des stocks | Inventory impairment | Contra (credit) |

> **[LOGISTICS] Critical:** **client goods held in the SmartLS warehouse are NOT SmartLS inventory.** They belong to the client. Do **not** record them in class 3. Track them **operationally** in the WMS (MOD-33–38) and, if you want them on the books, only as **off-balance-sheet commitments in class 9** (goods held for third parties). Only SmartLS's *own* consumables/spares go in class 3.

### CLASS 4 — Comptes de tiers (Third parties: receivables & payables) — Bal: **mixed**

This class is the heart of a forwarder's ledger. Full detail (verified against the révisé plan):

| Code | Designation (FR) | EN gloss | Bal | Notes |
|---|---|---|---|---|
| 40 | Fournisseurs et comptes rattachés | Suppliers | C | |
| 401 | Fournisseurs, dettes en compte | Trade payables | C | ★ 4011 Fournisseurs |
| 4013 | Fournisseurs sous-traitants | Subcontractor suppliers | C | ★ subcontracted trucking/handling |
| 408 | Fournisseurs, factures non parvenues | Accrued supplier invoices | C | Goods/services received, invoice not yet in |
| 409 | Fournisseurs débiteurs | Supplier debit balances | D | 4091 advances paid to suppliers |
| 41 | Clients et comptes rattachés | Customers | D | |
| 411 | Clients | Trade receivables | D | ★ 4111 Clients |
| 4114 | Clients, État et collectivités publiques | Public-sector customers | D | Often withhold tax (see §17) |
| 416 | Créances clients litigieuses ou douteuses | Doubtful/disputed receivables | D | 4161 litigious, 4162 doubtful |
| 418 | Clients, produits à recevoir | Accrued client income | D | ★ 4181 clients, factures à établir (revenue earned, not yet invoiced) |
| 419 | Clients créditeurs | Customer credit balances | C | ★★ **4191 Clients, avances et acomptes reçus** — customer advances (money before the work) |
| 42 | Personnel | Personnel | mixed | |
| 421 | Personnel, avances et acomptes | Staff advances | D | ★ 4211 avances, 4212 acomptes (MOD-15 Salary Advance) |
| 422 | Personnel, rémunérations dues | Net pay payable | C | ★★ net salary owed to staff |
| 423 | Personnel, oppositions, saisies-arrêts | Garnishments | C | Court-ordered wage deductions |
| 43 | Organismes sociaux | Social bodies | C | |
| 431 | Sécurité sociale (CNPS) | Social security (CNPS) | C | ★★ pension, family allowance, work-injury payable |
| 438 | Organismes sociaux, charges à payer | Accrued social charges | C | |
| 44 | État et collectivités publiques | State & public authorities | mixed | |
| 441 | État, impôt sur les bénéfices | Corporate income tax (IS) | C | ★ IS liability |
| 442 | État, autres impôts et taxes | Other taxes | C | 4421 State taxes, 4426 customs duties, 4428 other |
| 443 | État, TVA facturée | Output VAT | C | ★★ **4431 sur ventes, 4432 sur prestations de services** (services!), 4433 sur travaux |
| 444 | État, TVA due ou crédit de TVA | Net VAT position | mixed | 4441 TVA due (payable), 4449 crédit de TVA à reporter (carry-forward, debit) |
| 445 | État, TVA récupérable | Input (recoverable) VAT | D | ★★ 4451 sur immobilisations, 4452 sur achats, 4453 sur transport, 4454 sur services extérieurs et autres charges |
| 447 | État, impôts retenus à la source | Taxes withheld at source | C | ★★ IRPP + CAC withheld on salaries; WHT withheld from suppliers |
| 449 | État, créances et dettes diverses | Other State receivables/payables | mixed | ★ advance IS / précompte **suffered** (debit — recoverable) |
| 45 | Organismes internationaux | International organisations | mixed | |
| 46 | Apporteurs, associés et groupe | Partners/shareholders & group | mixed | 462 associés, 465 dividends payable |
| 47 | Débiteurs et créditeurs divers | Sundry debtors & creditors | mixed | |
| 471 | Débiteurs et créditeurs divers | Sundry debtors/creditors | mixed | 4711 débiteurs divers, 4712 créditeurs divers |
| **473** | **Intermédiaires, opérations faites pour le compte de tiers** | **Agent — operations on behalf of third parties** | mixed | ★★★ **THE DÉBOURS ACCOUNT (see §6).** 4731 Mandants, 4732 Mandataires, 4733 Commettants, 4734 Commissionnaires |
| 476 | Charges constatées d'avance | Prepaid expenses | D | Insurance/licences paid in advance |
| 477 | Produits constatés d'avance | Deferred income | C | ★ income invoiced but not yet earned |
| 478 | Écarts de conversion – Actif | FX translation – asset | D | Unrealised FX loss holding (see §8) |
| 479 | Écarts de conversion – Passif | FX translation – liability | C | Unrealised FX gain holding (see §8) |
| 48 | Créances et dettes hors activités ordinaires (HAO) | Non-operating receivables/payables | mixed | e.g. 481 suppliers of fixed assets |
| 481 | Fournisseurs d'investissements | Fixed-asset suppliers | C | ★ buying trucks/equipment on credit (MOD-54, MOD-60) |
| 485 | Créances sur cessions d'immobilisations | Receivable on asset disposals | D | Selling a used truck |
| 49 | Dépréciations et provisions pour risques à court terme (tiers) | Impairment of third-party accounts | C | ★ 491 dépréciations des comptes clients (bad-debt provision) |

### CLASS 5 — Comptes de trésorerie (Treasury: cash & equivalents) — Bal: **D**

| Code | Designation (FR) | EN gloss | Notes |
|---|---|---|---|
| 50 | Titres de placement | Marketable securities | Short-term investments |
| 51 | Valeurs à encaisser | Items for collection | 511/513 cheques & effects to collect, **515 virements de fonds** (internal transfers in transit) |
| 52 | Banques | Banks | ★★ 521 banques locales (one sub-account per bank account) — MOD-09 |
| 53 | Établissements financiers et assimilés | Financial establishments / postal | 531 chèques postaux (CCP); use for **Mobile Money** (see note) |
| 54 | Instruments de trésorerie | Treasury instruments | |
| 56 | Banques, crédits de trésorerie et d'escompte | Short-term bank credit / overdraft | Credit balance = overdraft |
| 57 | Caisse | Cash on hand | ★★ 571 caisse siège; petty cash — MOD-09 |
| 58 | Régies d'avances, accréditifs et virements internes | Imprest, LCs, internal transfers | ★ **585 virements de fonds** — use for transfers between own accounts to keep entries balanced |
| 59 | Dépréciations et provisions pour risques à court terme | Treasury impairment | Contra (credit) |

> **[MOD-09] Mobile Money (MTN MoMo / Orange Money):** SYSCOHADA has **no dedicated Mobile-Money account**. Create company sub-accounts under **`538x` "Autres organismes financiers"** (e.g. `5381 MTN MoMo`, `5382 Orange Money`), one per wallet; treat each exactly like a bank/cash account (Bal D). **Internal transfers** (bank→cash, cash→MoMo) must route through **585 virements de fonds** so both legs balance and you never double-count between the till and the phone. **Reconciliation is manual — there is no MNO/aggregator API:** finance clears each wallet against the MNO app/statement periodically. Two consequences for the build: (1) book the **MoMo transaction fee separately** to `6315`/`631` — the wallet debit ≠ the amount that reaches the counterparty, and ignoring the fee makes the till-vs-phone reconciliation drift by exactly the fees; (2) give the receiving leg a **"cash-in-transit" sub-state that a person clears manually** when receipt is confirmed, rather than assuming instant settlement.

### CLASS 6 — Comptes de charges des activités ordinaires (Ordinary expenses) — Bal: **D**

| Code | Designation (FR) | EN gloss | Notes |
|---|---|---|---|
| 60 | Achats et variations de stocks | Purchases & stock changes | 601 marchandises, 602 matières premières, 604 matières consommables, **605 autres achats (6051 eau, 6052 électricité, 6053 carburants/fuel, 6054 fournitures d'entretien, 6055 fournitures de bureau)**, 608 achats d'emballages |
| 61 | Transports | Transport | ★★ **611 transports sur achats, 612 transports sur ventes, 613 transports pour le compte de tiers, 614 transports du personnel, 616 transports de plis, 618 autres frais de transport** |
| 62 | Services extérieurs A | External services A | 621 sous-traitance générale, 622 locations et charges locatives, 623 redevances de crédit-bail, **624 entretien, réparations & maintenance** (fleet upkeep), 625 primes d'assurance, 626 études & documentation, 627 publicité, 628 télécommunications |
| 63 | Services extérieurs B | External services B | 631 frais bancaires, **632 rémunérations d'intermédiaires & de conseils (6324 honoraires)**, 633 frais de formation, 637 rémunérations de personnel extérieur, 638 autres charges externes |
| 64 | Impôts et taxes | Taxes (non-income) | ★ 641 impôts & taxes directs (**patente/business licence, vignette**), 645 impôts indirects, 646 droits d'enregistrement, 647 pénalités & amendes fiscales, 648 autres |
| 65 | Autres charges | Other operating expenses | 651 pertes sur créances clients (bad debts written off), 654 valeurs comptables des cessions courantes d'immo, 658 charges diverses |
| 66 | Charges de personnel | Personnel expenses | ★★ **661 rémunérations directes personnel national, 662 personnel non national, 663 indemnités forfaitaires, 664 charges sociales (employer CNPS/CFC/FNE), 668 autres charges sociales** |
| 67 | Frais financiers et charges assimilées | Financial expenses | 671 intérêts des emprunts, 673 escomptes accordés, **676 pertes de change** (realised FX loss), 678 pertes sur risques financiers |
| 68 | Dotations aux amortissements | Depreciation expense | ★★ **681 dotations aux amortissements d'exploitation** (fleet/warehouse depreciation), 687 à caractère financier |
| 69 | Dotations aux provisions et dépréciations | Provisions/impairment expense | 691 d'exploitation (incl. bad-debt provision), 697 financières |

### CLASS 7 — Comptes de produits des activités ordinaires (Ordinary income) — Bal: **C**

| Code | Designation (FR) | EN gloss | Notes |
|---|---|---|---|
| 70 | Ventes | Sales / revenue | ★★★ 701 ventes de marchandises, 705 travaux facturés, **706 Services vendus (the core forwarder revenue — transport, transit commission, handling done in own name)**, 707 produits accessoires |
| 71 | Subventions d'exploitation | Operating grants | |
| 72 | Production immobilisée | Own-work capitalised | Building an asset for own use |
| 73 | Variations des stocks de biens et services produits | Change in WIP/finished stock | |
| 75 | Autres produits | Other operating income | 754 produits des cessions courantes d'immobilisations, 758 produits divers |
| 77 | Revenus financiers et produits assimilés | Financial income | 771 intérêts de prêts, 776 gains de change (realised FX gain), 777 gains sur cessions de titres |
| 78 | Transferts de charges | Charge transfers | Reclassification of costs to be capitalised/recovered |
| 79 | Reprises de provisions et de dépréciations | Provision/impairment reversals | 791 d'exploitation, 797 financières |

> **[LOGISTICS] Revenue mapping:** transport/last-mile done with SmartLS's own fleet, transit commission, documentation fees, handling done in SmartLS's own name → **706 Services vendus** (use sub-accounts, e.g. `7061 Transport`, `7062 Commission de transit`, `7063 Frais de documentation`). Truly ancillary/one-off recoveries that are **refacturation** (not débours) → **707 Produits accessoires** or **758**. **Débours never appear in class 7** (see §6).

### CLASS 8 — Comptes des autres charges et autres produits (HAO — out of ordinary activity — and income tax) — Bal: **mixed**

| Code | Designation (FR) | EN gloss | Notes |
|---|---|---|---|
| 81 | Valeurs comptables des cessions d'immobilisations | Net book value of disposed assets | Dr — the leftover value when you sell/scrap an asset |
| 82 | Produits des cessions d'immobilisations | Proceeds from asset disposals | Cr — sale price of a used truck |
| 83 | Charges hors activités ordinaires | Non-operating expenses | Exceptional losses |
| 84 | Produits hors activités ordinaires | Non-operating income | Exceptional gains |
| 85 | Dotations hors activités ordinaires | Non-operating provisions | |
| 86 | Reprises hors activités ordinaires | Non-operating reversals | |
| 87 | Participation des travailleurs | Employee profit-sharing | Where applicable |
| 88 | Subventions d'équilibre | Balancing subsidies | |
| 89 | Impôts sur le résultat | Income taxes | ★★ **891 Impôt sur les bénéfices de l'exercice (IS)** — the corporate-tax charge |

### CLASS 9 — Engagements hors bilan & comptabilité analytique de gestion (Off-balance-sheet & cost accounting) — **optional**

Class 9 is **not mandatory** (application facultative). It serves two purposes: (a) **off-balance-sheet commitments** (engagements donnés/reçus — guarantees, sureties, **client goods held**) which the AUDCIF (Art. 33) requires to be *followed*; and (b) **cost accounting** (coûts, coûts de revient, écarts).

> **For SmartLS:** do **not** implement per-dossier costing as class-9 accounts. Implement it as an **analytical dimension** (a `dossier_id` / cost-object tag) on every journal line (see §6 and §22). That is how modern ERPs do it and it's far cleaner than parallel class-9 accounts. Reserve class 9 (if used at all) for genuine off-balance-sheet commitments such as **customs bonds/guarantees given** and **client goods held in the warehouse**.

---

## 6. The logistics accounting model — débours vs revenue **[LOGISTICS — READ THIS TWICE]**

This is the concept that, if wrong, makes every downstream number wrong. A freight forwarder handles two fundamentally different kinds of money and they must **never** be mixed.

### 6.1 The two categories

**(a) Débours (disbursements / frais avancés).** Money SmartLS pays **in the client's name and on the client's behalf** — customs duties, port (PAD/RTC) charges, shipping-line charges, terminal fees. This is **not SmartLS's revenue and not SmartLS's expense.** It is a **pure pass-through**: the client's money, or money SmartLS fronts and recovers exactly (au franc près). It transits a **third-party account (473)** and **never touches classes 6 or 7**.

**(b) Service revenue (prestations).** What SmartLS actually sells — transit commission, last-mile transport with own fleet, documentation, handling done in SmartLS's own name. This **is** revenue (**class 706/707**), it carries **VAT (19.25%)**, and it is what corporate tax and the turnover-based minimum tax are computed on.

**The dedicated SYSCOHADA account for (a) is `473 – Intermédiaires, opérations faites pour le compte de tiers`.** Because SmartLS acts as the client's **agent (mandataire)** paying bills for the client (the **mandant**), track disbursements per client/dossier in **`4731 Mandants`**.

### 6.2 Conditions to qualify as a true débours (all must hold)
1. An **explicit mandate** from the client to pay on their behalf.
2. The third-party document (customs receipt, port invoice) is ideally **in the client's name**.
3. **Exact reimbursement** — re-invoiced at cost, no margin added.
4. Shown as a **separate, non-taxable "Débours" line** on the SmartLS invoice.

If any condition fails, it is **not** a débours — it becomes **refacturation** (see §6.5): the cost goes to class 6, the re-invoice to class 7, and **VAT applies to the whole thing**. Getting this classification right per Financial-Dictionary item (the `is_debours` flag, §4/§22) is a core system responsibility.

### 6.3 The worked example (your ACME scenario), entry by entry

Client **ACME** pays SmartLS **10,000,000 XAF**, broken down as:

| Line | Amount | Nature | Account it will touch |
|---|---|---|---|
| Customs duties | 5,000,000 | **Débours** | 4731 (transit) |
| Shipping-line charges | 2,000,000 | **Débours** | 4731 (transit) |
| Port (PAD) charges | 1,000,000 | **Débours** | 4731 (transit) |
| Last-mile delivery (own fleet) | 1,500,000 | **Service** | 706 (revenue) + VAT |
| Service charge / transit commission | 500,000 | **Service** | 706 (revenue) + VAT |

So **SmartLS's turnover on this operation = 2,000,000**, not 10,000,000. The other **8,000,000 is débours** — other people's money passing through.

**VAT note (settle this in config):** services are quoted **HT** (VAT-exclusive) and VAT of **19.25%** is added on top → VAT = 2,000,000 × 19.25% = **385,000**. This makes the client's total **10,385,000**, i.e. **385,000 more than the 10M advance** — the VAT. Either the advance should have been 10,385,000, or ACME tops up 385,000. (If instead services were quoted **TTC**, back out the VAT: service HT = 2,000,000 ÷ 1.1925 = 1,677,149, VAT = 322,851, and the 10M covers everything — but recognised revenue is then lower. **The HT/TTC choice is a mandatory quote-level setting.**) The entries below use the HT-on-top model.

| # | Event | Dr account | Dr | Cr account | Cr |
|---|---|---|---|---|---|
| 1 | Advance received (proforma paid, MOD-50) | 521 Banque | 10,000,000 | **4191** Clients, avances reçues | 10,000,000 |
| 2 | Pay customs (débours) | **4731** Mandants – ACME | 5,000,000 | 521 Banque | 5,000,000 |
| 3 | Pay shipping line (débours) | **4731** Mandants – ACME | 2,000,000 | 521 Banque | 2,000,000 |
| 4 | Pay port/PAD (débours) | **4731** Mandants – ACME | 1,000,000 | 521 Banque | 1,000,000 |
| 5 | Issue final invoice (MOD-51) | **4111** Clients – ACME | 10,385,000 | 7061 Transport / 7062 Commission / **4432** TVA / **4731** Mandants (recover débours) | 1,500,000 / 500,000 / 385,000 / 8,000,000 |
| 6 | Apply advance to invoice | 4191 Clients, avances reçues | 10,000,000 | 4111 Clients – ACME | 10,000,000 |
| 7 | Client settles VAT balance | 521 Banque | 385,000 | 4111 Clients – ACME | 385,000 |

**Answer to "how many double-entry records": seven** — 1 advance, 3 disbursement payments, 1 compound invoice (this is where revenue is finally recognised **and** the 4731 débours account is zeroed out), 1 to net the advance, 1 to collect the VAT top-up.

After entry 5, look at what each account holds:
- **4731 (ACME):** 8,000,000 Dr (entries 2–4) − 8,000,000 Cr (entry 5) = **0** ✔ (débours fully recovered, no P&L impact ever).
- **706:** 2,000,000 Cr → **turnover = 2,000,000** ✔ (débours excluded).
- **4432:** 385,000 Cr → output VAT only on the service base ✔.

Entries can be compressed (batch 2–4 if same-day; drop 7 if quoted TTC) but keep them separate for a clean audit trail and per-dossier reconciliation.

### 6.4 Why the separation is non-negotiable — the wrong way

If a naïve build lets the full 10,000,000 flow into a revenue account, three things break simultaneously in Cameroon:

| Metric | Correct (turnover 2,000,000) | Wrong (turnover 10,000,000) |
|---|---|---|
| Turnover-based **minimum tax** @ 2.2% | **44,000** | 220,000 (5× too much, **every operation**) |
| **Output VAT** @ 19.25% | **385,000** | 1,925,000 (huge phantom liability) |
| **Margin visibility** | Clear (revenue − own costs) | Destroyed (débours drowns the margin) |

The minimum tax is levied on **turnover** and is the tax you pay **even at a loss** (§15). Inflating turnover with débours is therefore a direct, recurring cash loss.

### 6.5 The other case — refacturation (when it is NOT a débours)

If SmartLS **subcontracts** transport/handling in **its own name** (no client mandate, invoice in SmartLS's name), it is **refacturation**, not débours:
- The subcontractor cost → **class 6** (e.g. `613 Transports pour le compte de tiers` or `4013/621 sous-traitance`), with **recoverable input VAT → 445**.
- The re-invoice to the client → **class 7** (`706`/`707`), with **output VAT → 4432**.
- SmartLS **may add a margin**; VAT applies to the full re-invoiced amount.

Example — subcontracted trucking 800,000 HT re-invoiced at 1,000,000 HT:
- Cost: **Dr 613** 800,000 / **Dr 4453** (VAT recoverable on transport) 154,000 / **Cr 4013** 954,000.
- Re-invoice: **Dr 411** 1,192,500 / **Cr 706** 1,000,000 / **Cr 4432** 192,500. Margin 200,000 flows to the P&L.

> **System rule:** the **`is_debours` flag** on each Financial-Dictionary item (or per invoice line) decides the whole treatment. Débours → route to 4731, no VAT, no class 6/7. Refacturation → class 6 cost + class 7 revenue + VAT both sides. Never let a line be ambiguous.

### 6.6 Withholding tax (précompte / acompte) variant

If ACME is a **withholding agent** (the State, a public entity, a large taxpayer), it withholds an **advance income tax on the service portion only — never on débours** (another reason to separate them). When withheld, the amount is a **receivable** for SmartLS (an advance on its own IS), booked to **449 État, créances et dettes diverses**, and the client pays that much less:

Assume 2.2% on the 2,000,000 service base = 44,000. At settlement:
- **Dr 521** (cash received, reduced) + **Dr 449** 44,000 (advance tax suffered) / **Cr 411** (clearing). The 449 balance is later offset against the year's IS (441). Rate/applicability depends on the client and regime — see §17.

### 6.7 Per-dossier costing — the analytical dimension (MOD-46–49)

Every shipment is a **dossier** (operation file, MOD-29) and must be a **cost object**. **Tag every journal line** — every 4731 débours, every 706 revenue line, every own direct cost (fuel 6053, subcontract 613, driver time) — with the **`dossier_id`**. Then:

`Dossier margin = Service revenue (706/707 tagged to dossier) − SmartLS's OWN direct costs tagged to dossier`
**Débours are excluded from the margin** — they are neither revenue nor cost; they are pass-through. (You may still show "débours handled" as an operational metric.)

This single analytical dimension powers **MOD-46 Project Costing**, **MOD-47 Cost Tracking (per file and per category of disbursement)**, **MOD-48 Reconciliation (budget vs actual)** and the **MOD-27 Margin Simulator** — and it is the *same* data feeding the quote and the P&L-per-dossier. Implement it as a dimension on `journal_lines`, **not** as class-9 accounts.

### 6.8 Operational cash advances (régie d'avance) and the justification workflow — MOD-49

When Operations draws a lump sum to spend at the port/customs (e.g. 500,000 XAF), they rarely spend it exactly. **Do not post to 4731 on issue** — you don't yet know the per-dossier split, and some cash will come back. Model it as a **régie d'avance** in account **581** with an explicit state machine; the clean §8.2 disbursement entries are the *output* of this workflow, not the input.

**States:** `ISSUED → PARTIALLY_JUSTIFIED → JUSTIFIED (closed)`, plus `AGED_UNJUSTIFIED` and `QUERIED`.

| Step | Event | Posting |
|---|---|---|
| 1 | Advance issued to holder | `Dr 581 Régies d'avances (holder) / Cr 521 Banque` — clean, factual, **auto-posts** (money left the bank) |
| 2 | Holder returns with receipts (retirement) | per receipt, tagged per dossier: `Dr 4731 Mandants (dossier) / Cr 581` — this is where §8.2's entries are actually generated |
| 3 | Unspent cash returned | `Dr 571 Caisse / Cr 581` |
| 4 | Fully justified | 581 for that advance nets to **zero** |
| 5 | Unsupported spend (no valid receipt) | hold as a **query** — write off to `658` or recover from the holder; **never invent a 4731 line without a document** |

**The "nobody retired it in a week" rule.** The advance is *already recorded* (step 1) and never blocks anything — it validly sits in 581. What you must **not** do is auto-allocate it to 4731 (that fabricates a split without receipts). Instead, after the **policy window** (e.g. 7 days, configurable) the advance auto-transitions to `AGED_UNJUSTIFIED` and the open balance is **reclassified from 581 to a receivable from the holder** — `Dr 4211 Personnel, avances (holder) / Cr 581` — so the money becomes that person's responsibility to justify or repay, not a floating suspense. **MOD-49** owns issuance and retirement; **MOD-65** raises the aging flag.

---

## 7. The document & operation lifecycle — what actually hits the ledger

The second-most-common ERP mistake is **recognising revenue too early**. The accrual/matching principle (§2.4) governs exactly when the GL is touched. Map your pipeline like this:

| Stage | SmartLS module | GL entry? | What/why |
|---|---|---|---|
| Internal costing / estimate | MOD-46, MOD-27 Margin Simulator | **None** | Feeds the quote & the analytical/budget module only |
| Quotation (devis) to client | MOD-23 Proposal / MOD-27/28 | **None** | Commercial offer; a pipeline record (MOD-24), not accounting |
| **Proforma invoice** | **MOD-50** | **None** | A proforma is **not a real invoice** and is **not revenue** — never post it as a sale |
| **Client pays the proforma** | MOD-50 → MOD-09 | **Yes → advance** | **Dr 521 / Cr 4191.** Money before the work = a **liability** (customer advance), not income |
| Operation runs; disbursements paid | MOD-29/30, MOD-49 Disbursal | **Yes → 4731** | Each débours: **Dr 4731 / Cr 521** (see §6) |
| **Operation performed → final invoice** | **MOD-51** | **Yes → revenue** | Revenue recognised now: **Dr 411 / Cr 706 + Cr 4432**, plus clearing of the advance (4191) and débours (4731) |
| Cash movements throughout | MOD-09, MOD-52 | **Yes** | 521 / 571 / 53x |

**Only two pipeline stages touch the ledger: the payment (advance) and the final invoice (revenue).** Everything else is an operational/commercial state in SmartLS. This clean split — commercial workflow vs accounting event — is the guardrail that keeps engineers from polluting the books.

**Revenue-recognition timing.** For a discrete shipment, recognise revenue on **completion of the operation** (final invoice). For a long-running operation spanning a month-end, recognise by **stage of completion** using **4181 (clients, factures à établir)** for earned-but-not-yet-invoiced work and **477 (produits constatés d'avance)** for invoiced-but-not-yet-earned work. This is what keeps each fiscal period's result faithful (Art. 59–60 AUDCIF).

**Advance vs deferred income — don't confuse them:**
- **4191 Clients, avances et acomptes reçus** = cash received before invoicing (a proforma deposit). It is cleared by the final invoice.
- **477 Produits constatés d'avance** = you *invoiced* (revenue posted) but haven't yet earned it; defer the unearned part to next period.

---

## 8. Journal-entry cookbook (every common operation)

These are copy-ready posting templates for **MOD-55 (Journal Entries)** and the auto-posting logic behind invoices, payroll and treasury. Amounts are placeholders. Every recipe balances (Σ Dr = Σ Cr).

### 8.1 Customer advance received (proforma paid) — MOD-50
```
Dr  521  Banque .................................. gross received
    Cr  4191 Clients, avances et acomptes reçus ... gross received
```

### 8.2 Disbursement paid on client's behalf (débours) — MOD-49
```
Dr  4731 Mandants – <client> (dossier <id>) ....... amount
    Cr  521 Banque (or 571 Caisse / 53x MoMo) ...... amount
```
Repeat per débours (customs 4426-type receipt, port, shipping line). **No VAT, no class 6/7.**

> **These clean entries are the *output* of the cash-handling workflow, not the input.** When Ops draws a lump-sum cash advance to the port and spends an unknown amount, the money first sits in a **régie d'avance (581)**; the `Dr 4731 / Cr 521` lines above are generated only once the advance is *retired* against receipts. See **§6.8** for the state machine.

### 8.3 Final service invoice with débours recovery + VAT — MOD-51
```
Dr  4111 Clients – <client> .......................... service_TTC + debours_total
    Cr  706x Services vendus (per service line) ...... service_HT
    Cr  4432 État, TVA facturée sur prestations ...... service_HT × 19.25%
    Cr  4731 Mandants – <client> ..................... debours_total   (clears §8.2)
```
Then clear the advance:
```
Dr  4191 Clients, avances et acomptes reçus .......... advance_applied
    Cr  4111 Clients – <client> ...................... advance_applied
```

### 8.4 Refacturation (subcontract in own name, NOT débours) — §6.5
Cost:
```
Dr  613  Transports pour le compte de tiers .......... cost_HT
Dr  4453 État, TVA récupérable sur transport ......... cost_HT × 19.25%
    Cr  4013 Fournisseurs sous-traitants ............. cost_TTC
```
Re-invoice (margin allowed):
```
Dr  4111 Clients ..................................... reinvoice_TTC
    Cr  706  Services vendus ......................... reinvoice_HT
    Cr  4432 État, TVA facturée sur prestations ...... reinvoice_HT × 19.25%
```

### 8.5 Ordinary supplier invoice (office/overheads) — MOD-60/61
```
Dr  6xx  <expense by nature> ......................... amount_HT
Dr  4452 État, TVA récupérable sur achats ............ amount_HT × 19.25%   (if recoverable)
    Cr  4011 Fournisseurs ........................... amount_TTC
```
Payment:
```
Dr  4011 Fournisseurs ................................ amount_TTC
    Cr  521 Banque .................................. amount_TTC
```

### 8.6 Client payment received against an invoice (no advance) — MOD-52
```
Dr  521 Banque ....................................... amount
    Cr  4111 Clients ................................ amount
```

### 8.7 Fuel purchase for the fleet — MOD-43
```
Dr  6053 Achats de carburants ........................ fuel_HT
Dr  4452 État, TVA récupérable sur achats ............ fuel_HT × 19.25%   (fuel VAT recoverability [VERIFY])
    Cr  521 / 571 / 53x ............................. fuel_TTC
```

### 8.8 Fixed-asset (truck) acquisition — MOD-54 / MOD-39
Cost = purchase price + directly attributable costs (delivery, customs, registration), net of recoverable VAT (§11):
```
Dr  245  Matériel de transport ....................... asset_cost_HT
Dr  4451 État, TVA récupérable sur immobilisations ... asset_cost_HT × 19.25%   (if recoverable)
    Cr  481 Fournisseurs d'investissements .......... asset_cost_TTC   (or 521 if paid cash)
```

### 8.9 Monthly depreciation (dotation aux amortissements) — MOD-54
```
Dr  6813 Dotations aux amort. des immo. corporelles .. period_depreciation
    Cr  2845 Amortissements du matériel de transport .. period_depreciation
```

### 8.10 Disposal of a used asset (sell a truck) — MOD-54
Remove net book value (HAO):
```
Dr  2845 Amortissements du matériel de transport ..... accumulated_depr
Dr  81   Valeurs comptables des cessions d'immo ...... net_book_value
    Cr  245 Matériel de transport ................... original_cost
```
Record the sale:
```
Dr  485  Créances sur cessions d'immobilisations ..... sale_price_TTC
    Cr  82  Produits des cessions d'immobilisations .. sale_price_HT
    Cr  4431 État, TVA facturée sur ventes .......... sale_price_HT × 19.25%
```

### 8.11 Payroll — full monthly entry — MOD-17 (see §9 for rates/computation)
(A) Gross salary + employee deductions:
```
Dr  661  Rémunérations directes (personnel national) . gross
    Cr  431  Sécurité sociale (CNPS employee 4.2%) .... employee_CNPS
    Cr  447  État, impôts retenus à la source ........ IRPP + CAC + CFC(emp) + RAV/TDL
    Cr  4211 Personnel, avances (recovered) .......... advances_recovered   (MOD-15)
    Cr  422  Personnel, rémunérations dues (net) ..... net_pay
```
(B) Employer social charges:
```
Dr  664  Charges sociales ............................ employer_total
    Cr  431  Sécurité sociale (CNPS employer) ........ pension4.2 + family7 + injury1.75-5
    Cr  447/438 État / organismes (FNE 1% + CFC 1.5%) . employer_parafiscal
```
(C) Pay net salaries:
```
Dr  422 Personnel, rémunérations dues ................ net_pay
    Cr  521 Banque ................................. net_pay
```
(D) Remit to CNPS and the State (by the 15th):
```
Dr  431 Sécurité sociale ............................. total_CNPS (emp+employer)
Dr  447 État, impôts retenus à la source ............. total_taxes_withheld
    Cr  521 Banque ................................. total_remitted
```

### 8.12 Monthly VAT settlement — §10
Net output VAT against input VAT:
```
Dr  4432/4431 État, TVA facturée ..................... total_output_VAT
    Cr  4451/4452/4453/4454 État, TVA récupérable .... total_input_VAT
    Cr  4441 État, TVA due ........................... net_payable   (if output > input)
```
If input > output, debit **4449 crédit de TVA à reporter** for the carry-forward instead. Pay the net:
```
Dr  4441 État, TVA due ............................... net_payable
    Cr  521 Banque ................................. net_payable
```

### 8.13 Corporate income tax — accrual & instalments — §15
Monthly minimum-tax instalment / acompte:
```
Dr  449  État, acomptes d'IS versés .................. instalment
    Cr  521 Banque ................................. instalment
```
Year-end IS charge:
```
Dr  891  Impôts sur le résultat (IS) ................. IS_for_year
    Cr  441 État, impôt sur les bénéfices ........... IS_for_year
```
Offset instalments/WHT already paid (449) against 441; pay or carry the balance.

### 8.14 Foreign-currency (FX) operations — Art. 51–58 AUDCIF
Record the asset/receivable/payable at the **spot rate on the transaction date**. At year-end, re-translate open FX receivables/payables at the **closing rate**; the difference goes to **balance-sheet holding accounts**, not P&L:
```
Unrealised LOSS (payable up / receivable down):
Dr  478 Écarts de conversion – Actif ................. difference
    Cr  4011/411 ................................... difference
  → then book a provision:  Dr 6791 / Cr 194 Provisions pour pertes de change

Unrealised GAIN (receivable up / payable down):
Dr  411/4011 ........................................ difference
    Cr  479 Écarts de conversion – Passif ........... difference   (NOT income — prudence)
```
On **actual settlement**, the realised difference goes to P&L: **676 Pertes de change** or **776 Gains de change**.

### 8.15 Bad debt — MOD-52
Provision (probable loss):
```
Dr  6594 / 691 Dotations aux dépréciations des créances  amount
    Cr  491 Dépréciations des comptes clients .......... amount
```
Write-off (loss certain):
```
Dr  651 Pertes sur créances clients .................. amount_HT
Dr  4431 (VAT adjustment if allowed) ................. VAT   [VERIFY]
    Cr  4111 Clients ............................... amount_TTC
```

### 8.16 Internal transfer between own treasury accounts — MOD-09
Always route through 585 so both legs balance and nothing is double-counted:
```
Dr  585 Virements de fonds ........................... amount     (leg 1: leaving bank)
    Cr  521 Banque ................................. amount
Dr  571 Caisse (or 53x MoMo) ......................... amount     (leg 2: arriving)
    Cr  585 Virements de fonds ..................... amount
```

### 8.17 Year-end close (clôture)
1. Post all accruals (4181 factures à établir, 408 factures non parvenues, 476/477 CCA/PCA), depreciation, provisions, FX re-translation, VAT, IS.
2. **Balance the P&L into the result:** the sum of classes 6/7/8 is transferred to **131 Résultat net**.
3. Carry every balance-sheet account forward as the **opening balance** of next year (intangibility, §2.7).
4. Produce Bilan, Compte de résultat, TAFIRE, Notes (§12).

---

## 9. Payroll accounting & computation (Cameroon) — MOD-17

Cameroon payroll turns one gross figure into ~8 separate levies split across employee and employer. **All rates [VERIFY] annually against the Finance Law + CNPS decree; confirm with a licensed accountant.** SmartLS is **not** a tax authority — payslips must be labelled as computed estimates until professionally validated.

### 9.1 The levies (2025/2026 figures)

**Employee side (withheld from gross):**
| Levy | Rate | Base / cap | Posts to |
|---|---|---|---|
| CNPS pension (vieillesse) | **4.2%** | capped at **750,000 XAF/mo** (max 31,500) | 431 |
| CFC (Crédit Foncier / housing) | **1%** | taxable salary, no cap | 447 |
| **IRPP** (income tax, PAYE) | **progressive** (see 9.2) | net taxable salary | 447 |
| CAC (surtax on IRPP) | **10% of IRPP** | — | 447 |
| Council tax (TDL) | fixed brackets | only salaries **> 500,000/mo** | 447 |
| CRTV / RAV (audiovisual) | fixed brackets | higher salaries (~>1,000,000/mo) | 447 |

**Employer side (on top of gross):**
| Contribution | Rate | Base / cap | Posts to |
|---|---|---|---|
| CNPS pension | **4.2%** | capped 750,000 | 431 (via 664) |
| CNPS family allowances (prestations familiales) | **7%** | capped 750,000 | 431 (via 664) |
| CNPS work injury (accident du travail) | **1.75% / 2.5% / 5%** by risk class | full gross | 431 (via 664) |
| CFC employer | **1.5%** | full gross | 447/438 (via 664) |
| FNE (National Employment Fund) | **1%** | full gross | 447/438 (via 664) |

> **[LOGISTICS] Risk class:** office staff ≈ 1.75%; **drivers, warehouse and port handling are higher-risk (likely 2.5–5%)** — set the work-injury rate **per employee category**. Employer total ≈ **15.45%** at 1.75%, rising to **~16–19%** for operational staff.

### 9.2 IRPP computation (order of operations)
IRPP is on **net taxable**, not gross. Standard method:
1. `SBT` = gross taxable salary (incl. taxable benefits in kind: housing 15%, vehicle 10%, etc.).
2. Deduct **CNPS pension** (4.2%, capped).
3. Deduct **30%** professional allowance (frais professionnels).
4. Deduct the annual abatement **500,000 ÷ 12 = 41,667/mo**.
5. Apply the **annual** progressive scale, then **×1.10 (CAC)**:

| Annual net taxable (XAF) | Base rate | With CAC |
|---|---|---|
| 0 – 2,000,000 | 10% | 11% |
| 2,000,001 – 3,000,000 | 15% | 16.5% |
| 3,000,001 – 5,000,000 | 25% | 27.5% |
| above 5,000,000 | 35% | 38.5% |

> **[VERIFY]** Some 2025/26 sources show a 5th top band (38.5% base above 10,000,000) and there is source-level disagreement on whether CNPS/30%/abatement all apply — lock the exact barème and base with an expert-comptable against the current CGI. Build the scale as **configurable brackets with effective dates** (do not hard-code).

### 9.3 Worked example — gross 500,000 XAF/month
- Employee CNPS pension: 500,000 × 4.2% = **21,000**
- Employee CFC: 500,000 × 1% = **5,000**
- IRPP: on net-taxable ≈ (500,000 − 21,000) × 70% − 41,667 = **≈ 293,633/mo taxable base → apply barème** → **≈ [compute with accountant]**; add CAC 10%.
- **Employer:** pension 21,000 + family 35,000 + injury 12,500 (@2.5%) + CFC 7,500 + FNE 5,000 = **≈ 81,000**
- **Fully-loaded monthly cost ≈ 581,000** (gross + employer charges).

### 9.4 Deadlines & posting
- **Monthly:** DIPE return + remittance to **CNPS and DGI by the 15th** of the following month. Late = 10% penalty + 1.5%/month interest.
- Posting: use the four-step block in **§8.11**.

---

## 10. VAT (TVA) mechanics — MOD-07

- **Standard rate: 19.25%** (17.5% base + 10% CAC). **Exports zero-rated.**
- **Output VAT (TVA facturée / collectée)** — charged to clients, a **liability** → **443** (services: **4432**). 
- **Input VAT (TVA récupérable / déductible)** — paid to suppliers, an **asset** → **445** (`4451` on assets, `4452` on purchases, `4453` on transport, `4454` on external services).
- **Monthly settlement:** `Net VAT = output (443) − input (445)`. If positive → **4441 TVA due**, pay by the **15th**. If negative → **4449 crédit de TVA à reporter** (carry forward). See **§8.12**.
- **VAT registration** applies to taxpayers with turnover **≥ 50M XAF** on the actual-earnings regime (§14) — SmartLS qualifies.

**[LOGISTICS] The débours exclusion (repeat):** true débours (§6) are **outside the VAT base** — SmartLS neither charges output VAT on them nor reclaims input VAT on them (the VAT belongs to the client, who receives the supporting documents in their name). VAT applies **only** to the **service** portion. This is *the* reason a forwarder must keep débours (473) out of the VAT engine entirely.

**Non-recoverable input VAT** exists (certain expenses, e.g. some passenger-vehicle costs, entertainment) — where non-recoverable, the VAT is **added to the expense** (no 445 line). Flag recoverability per Financial-Dictionary item.

---

## 11. Fixed assets & depreciation — MOD-54 / MOD-39

**Cost (historical cost, §2.2):** purchase price + directly attributable costs (transport-in, customs, installation, registration) **net of recoverable VAT**. Grants received do **not** reduce the asset cost (they go to 14).

**Depreciation (amortissement):** the systematic write-down of a depreciable asset over its useful life. `Depreciable base = cost − residual value`. SYSCOHADA favours the **straight-line (linéaire)** method by default; **declining-balance (dégressif)** is allowed where justified; **amortissement dérogatoire** (the tax-accelerated excess) is booked in **151** (class 1) with the charge in class 85 / reversal in 86.

**Indicative useful lives / rates [VERIFY with tax rules]:**
| Asset | Account | Typical life | Straight-line rate |
|---|---|---|---|
| Buildings | 231/233 | 20–50 yrs | 2–5% |
| Warehouse fit-out / racking | 234/237 | 10 yrs | 10% |
| Trucks / trailers (fleet) | 245 | 4–5 yrs | 20–25% |
| Forklifts / handling equipment | 241 | 5–10 yrs | 10–20% |
| Office/IT equipment | 2442 | 3–4 yrs | 25–33% |
| Software (the ERP) | 213 | 3–5 yrs | 20–33% |

**Postings:** monthly/annual charge **Dr 681x / Cr 28xx** (§8.9). On disposal, reverse accumulated depreciation, book NBV to **81**, proceeds to **82** + VAT (§8.10). **MOD-54's lifecycle (Acquisition → Barcode → Depreciation → Disposal)** maps exactly to accounts **245 → (tag) → 2845/681 → 81/82**.

---

## 12. The financial statements & management balances

### 12.1 The statutory statements (Système normal)
1. **Bilan (Balance Sheet)** — snapshot at close. Assets: actif immobilisé (class 2), actif circulant (classes 3, 4-debit), trésorerie-actif (class 5-debit). Liabilities & equity: capitaux propres (class 1 equity), dettes financières (16/17), passif circulant (class 4-credit), trésorerie-passif (56). **(MOD-56)**
2. **Compte de résultat (Income Statement)** — performance for the year, built from classes **6, 7, 8**, ending at **131 Résultat net**. **(MOD-57/58)**
3. **TAFIRE (Tableau Financier des Ressources et des Emplois)** — the SYSCOHADA cash/financing-flows statement (OHADA's answer to the IFRS cash-flow statement): analyses self-financing (CAFG), investments, financing. **(MOD-59)** — *note: the PRD labels MOD-56 "IFRS" and MOD-59 "Cash Flow"; for statutory Cameroon filing you need the **OHADA TAFIRE**, not (only) an IFRS cash-flow. Support OHADA output first; IFRS can be an optional second view for investors (MOD 5.2).*
4. **Notes annexes (Notes)** — accounting policies, breakdowns, off-balance-sheet commitments (given/received), method changes.
5. **ESS (État Supplémentaire Statistique)** — statistical annex for the tax/statistics administration (normal system only).

### 12.2 The intermediate management balances (Soldes Intermédiaires de Gestion — SIG)
The Compte de résultat is structured so these cascade out automatically — expose them as KPIs (MOD-00A, MOD-63):
- **Marge commerciale** = sales of goods − cost of goods (mostly N/A for a pure forwarder).
- **Chiffre d'affaires** = 70 (**services 706** dominate for SmartLS; **débours excluded**).
- **Valeur ajoutée (VA)** = production − external consumption (60/61/62/63).
- **Excédent brut d'exploitation (EBE/EBITDA-like)** = VA − personnel (66) − taxes (64) + operating subsidies (71).
- **Résultat d'exploitation** = EBE − depreciation/provisions (68/69) + reversals (79).
- **Résultat financier** = 77 − 67.
- **Résultat des activités ordinaires (RAO)** = exploitation + financier.
- **Résultat HAO** = class 84/82 − 83/81/85.
- **Résultat net** = RAO + HAO − participation (87) − **IS (891)** → lands in **131**.

> Because **débours are excluded from CA and from VA/EBE**, all these ratios stay meaningful only if §6 is implemented correctly.

---

## 13. Books, records & the audit trail — MOD-55 / MOD-64 / MOD-69

**Mandatory books (Art. 19 AUDCIF):**
- **Journal** — chronological record of all entries (derived from MOD-55; taggable by day-book: achats, ventes, banque, paie, OD).
- **Grand livre (General Ledger)** — all movements account by account (**MOD-56**, derived).
- **Balance générale des comptes (Trial balance)** — per account: opening balance, period debit total, period credit total, closing balance. **Must always balance** (Σ debit balances = Σ credit balances). Derived — not entered.
- **Livre d'inventaire** — the Bilan + Compte de résultat + inventory summary per year.

**Computerised-accounting requirements (Art. 22 AUDCIF) — directly relevant to MOD-69 Immutable Ledger:**
- **Irreversibility** — no deletion/modification of validated entries; corrections only by **contra/reversing entries** (Art. 20: an error is corrected by a **negative entry** of the wrong item, then the correct entry — never by erasing). → MOD-00B "soft delete + push to immutable ledger" must implement **reversal**, not destruction.
- **Chronology preserved** — periodic freeze ("computing fence") at least quarterly; validated periods locked.
- **Every entry backed by a dated, numbered supporting document** of probative value. → MOD-65 Compliance Checker (flag missing evidence) and MOD-66 Document Verification enforce this.
- **Full audit reconstruction** — the system must let an auditor reconstruct the audit trail and access the treatment logic. → MOD-69 (user, action, date, IP, module) is exactly this; extend it to capture the **before/after account state** of each posting.
- **10-year retention** (Art. 24) → MOD-64 File Repository.

**Posting automation, provenance & the human-review model (design decision — MOD-55/69):** the principle is **"system posts, human attests"**, so the close never waits on an accountant.
- **The system is the primary author.** Sub-ledger events (invoices MOD-51, payments MOD-09/52, payroll MOD-17, VAT, depreciation MOD-54) generate their journal entries automatically and post them **live**. Manual keying is the exception.
- **"Approval" is attestation, not a release gate.** A posted entry is already in the books; a reviewer *reviews, attests, or flags* — they do not unlock it. **If no one reviews within the policy window, the entry stays valid** and carries an `UNREVIEWED` flag that MOD-65 surfaces. Nothing is held hostage to human availability. *(The one exception is the cash-advance retirement in §6.8, where a per-dossier allocation cannot be fabricated without receipts.)*
- **Provenance on every entry.** `source ∈ {SYSTEM_AUTO, SYSTEM_RULE, HUMAN_MANUAL, HUMAN_CORRECTION}` and `review_status ∈ {UNREVIEWED, ATTESTED, FLAGGED, CORRECTED}`. Auditors get three filter views: what the system posted untouched, what a human attested, and what a human flagged-and-corrected.
- **"Edit" depends on state — compliance-critical (Art. 20/22).** A **draft** entry may be edited freely (not yet a legal book entry). A **validated** entry may **never** be edited in place — the "Fix this" action must **reverse the original and post a replacement** (`source = HUMAN_CORRECTION`, linked via `corrects_entry_id`), and the audit log ties the two together. Do **not** build in-place mutation of posted entries: an audit log over a mutated legal entry still fails a DGI inspection.

**Practical invariants for the ledger engine:** entries are **immutable once validated**; validation locks the period; sequential, gap-free numbering per journal; each line carries `dossier_id` (analytical) and a supporting-document reference. See §23.

---

# PART B — TAX CENTER (exact rates payable)

> **This is the reference for MOD-07 (Tax Jurisdiction).** Every rate below is **Cameroon, 2025/2026** and must be **re-validated each January against the Finance Law (Loi de Finances)** and signed off by an expert-comptable before go-live. Build all of it as **configurable tax codes with effective dates** (§21) — never hard-code a rate in application logic.

## 14. Cameroon tax overview & taxpayer regimes

Cameroon tax is administered by the **DGI (Direction Générale des Impôts)**; customs by the **DGD**. The framework is the **Code Général des Impôts (CGI)**, updated yearly by the Finance Law. Returns must be **presented in conformity with the OHADA/SYSCOHADA accounting system**.

**Taxpayer regimes (drive which taxes/rates apply):**
| Regime | Annual turnover | Notes |
|---|---|---|
| Flat-rate (impôt libératoire) | < 10M XAF | Micro |
| Simplified (simplifié) | 10M – 50M XAF | Minimum tax **5.5%** |
| **Actual earnings (réel)** | **≥ 50M XAF** | **VAT-registered; minimum tax 2.2%; full OHADA books** |

> **SmartLS is on the *régime du réel*** (single operations run into the millions; turnover ≫ 50M). All rates below assume **réel**.

---

## 15. Corporate Income Tax (IS — Impôt sur les Sociétés) + minimum tax

| Item | Rate | Notes |
|---|---|---|
| **Standard IS** | **33%** | 30% base **+ 10% CAC** = 33%. Applies to companies with turnover > 3bn; 30% base rate otherwise. **[VERIFY band]** |
| **Minimum tax (réel)** | **2.2%** of turnover | 2% + 10% CAC, on **monthly gross turnover**. Paid as a monthly instalment; **offset against IS**; is the **sole tax if greater than IS** — i.e. you pay it **even at a loss**. |
| Minimum tax (simplifié) | 5.5% of turnover | Non-réel taxpayers |
| Administered-margin sectors | special (e.g. 14% of margin) | Not applicable to standard logistics |

**Base:** taxable profit = accounting profit ± tax reintegrations/deductions (non-deductible expenses added back — e.g. invoices lacking CGI §150(5) mandatory info are **non-deductible**; tax-haven payments non-deductible).
**Losses:** carried forward **up to 4 years** (no carry-back).
**Instalments:** monthly minimum-tax instalments (2.2% of turnover) → **449** (§8.13); annual IS charge → **891 / 441**; instalments + WHT suffered (449) offset against 441.
**Filing:** annual return by **15 March** (Large Taxpayers Unit) / 15 April / 15 May depending on the tax centre.

> **[LOGISTICS] Why §6 matters again:** the 2.2% minimum tax is on **turnover**. Débours must be **out** of turnover or SmartLS overpays 2.2% of every pass-through franc, permanently, regardless of profit.

---

## 16. VAT (TVA — Taxe sur la Valeur Ajoutée)

| Item | Value |
|---|---|
| **Standard rate** | **19.25%** (17.5% + 10% CAC) |
| Exports | **0%** (zero-rated) |
| Exemptions | certain essentials, medical, educational, financial services |
| Registration threshold | turnover **≥ 50M XAF** (réel) |
| Filing & payment | **monthly, by the 15th** |
| Late payment | 1.5%/month interest, up to 50% of principal |

**Accounts:** output **443** (services **4432**), input **445**, net **4441** (due) / **4449** (credit c/f). **Débours are outside the VAT base** (§6, §10).

---

## 17. Withholding taxes / précompte / acompte

Cameroon withholds tax at source in several situations. **These are advances on the recipient's own tax (offset later), except non-resident SIT which is often final.**

| Situation | Rate | Nature | SmartLS impact |
|---|---|---|---|
| **Advance IS on purchases/imports for resale** (précompte) | **0.5% / 2% / 5% / 10% / 14% / 15% / 15.04% / 20%** by regime | Advance on IS | If a supplier isn't registered, higher rates apply |
| **Deduction at source on service invoices** (public procurement < 5M) | **5.5%** irrespective of provider regime | Advance on IS | When SmartLS invoices such clients, tax is withheld from its payment |
| Advance on SmartLS's own service revenue (réel-registered) | **2.2%** on the **service** base | Advance on IS | Client withholds; SmartLS books to **449**, offsets against IS |
| **Non-resident services (SIT / TSR)** | **15%** general (10%/3% in specific cases) | Often **final** | If SmartLS pays a foreign supplier for services used in Cameroon, SmartLS must **withhold and remit** SIT |
| Dividends | **16.5%** | WHT | On distributions |
| Interest | 16.5% | WHT | On loans |
| Royalties to non-residents | 15% (no CAC) | WHT | On licence/royalty payments |
| Tax-haven beneficiary | **33%** | penalty rate | Any of the above to tax-haven residents |

**Key system behaviours (MOD-07 + MOD-51 + MOD-60):**
- **WHT is computed on the taxable service/purchase base — never on débours.**
- When SmartLS is **withheld from** (as a supplier): reduce cash received, book the withheld amount to **449** (receivable), offset against IS at year-end.
- When SmartLS **must withhold** (paying a non-resident for services, or paying certain local suppliers): withhold, book to **447** (payable to State), remit, and reduce the supplier payment.
- The **précompte "n'est pas récupérable sur le prix"** and is **calculated without CAC**.

---

## 18. Payroll taxes & social contributions (summary table)

Full detail and computation in **§9**. Consolidated rate card:

| Levy | Employee | Employer | Base / cap | Remit to | Posts |
|---|---|---|---|---|---|
| CNPS pension | 4.2% | 4.2% | cap 750,000/mo | CNPS | 431 |
| CNPS family allowances | — | 7% | cap 750,000/mo | CNPS | 431 |
| CNPS work injury | — | 1.75–5% | full gross | CNPS | 431 |
| CFC (housing) | 1% | 1.5% | taxable salary | DGI/CFC | 447/438 |
| FNE (employment) | — | 1% | taxable salary | DGI/FNE | 447/438 |
| IRPP (PAYE) | progressive | — | net taxable | DGI | 447 |
| CAC on IRPP | 10% of IRPP | — | — | DGI | 447 |
| Council tax (TDL) | fixed brackets (>500k) | — | — | Commune | 447 |
| CRTV/RAV | fixed brackets | — | — | CRTV | 447 |

- Employer total ≈ **15.45%** (office) to **~16–19%** (operational). Remittance (DIPE) + payment **by the 15th** monthly.

---

## 19. Other taxes

| Tax | Rate / basis | Notes |
|---|---|---|
| **Business licence (patente)** | based on turnover/activity | Annual; **641** |
| **Property tax (taxe foncière)** | **0.1%** of assessed value | On owned real estate (warehouses) |
| **Registration duties (droits d'enregistrement)** | 1%–15% by act; public contracts ≥ 5M ⇒ registration | Contracts, transfers |
| **Business sale / transfer** | **10%** | On sale of a going concern |
| **Share transfer** | **5%** | Without transfer of the business |
| **Stamp duty (droit de timbre)** | fixed by document | CEMAC rules |
| **Customs duties (droits de douane)** | **5%–30%** by CET category | On imports — usually a **client débours** for SmartLS, not SmartLS's own cost |
| **Excise duties** | 5% / 12.5% / 25–50% | Luxury, tobacco, drinks, etc. |
| **Special tax on money transfers** | 1% (+ fixed per-transaction for MFIs) | Mobile-money/withdrawals |
| **Vignette / axle tax** | per vehicle | Fleet-relevant; **645/641** |

---

## 20. Tax calendar (Cameroon)

| Obligation | Deadline |
|---|---|
| VAT return + payment | **15th** of the following month |
| Payroll (DIPE) + IRPP/CNPS remittance | **15th** of the following month |
| Minimum-tax / IS monthly instalment | monthly (with the above cycle) |
| WHT/précompte remittance | with the monthly cycle |
| **Annual IS return (DSF — Déclaration Statistique et Fiscale)** | **15 March** (LTU) / 15 April / 15 May by tax centre — filed **in OHADA/SYSCOHADA format** |
| Annual wage declaration (DIPE annuelle) | per DGI schedule |

Late filing/payment: fixed fines + **1.5%/month** interest; payroll **10% penalty (up to 30%)**. Build a **compliance calendar with alerts** (MOD-40 Alert Engine pattern, MOD-65 Compliance Checker).

---

## 21. Tax-jurisdiction data model (MOD-07)

Model taxes as **versioned tax codes**, not constants. Minimum schema:

```
tax_jurisdiction(id, country='CM', name, currency='XAF')
tax_code(
  id, jurisdiction_id, code,            -- e.g. 'TVA_STD', 'WHT_SERVICE_REEL', 'IS_MIN'
  kind,                                 -- 'VAT' | 'WHT' | 'INCOME' | 'PAYROLL' | 'OTHER'
  rate_percent,                         -- e.g. 19.25
  base_rule,                            -- 'service_ht' | 'turnover' | 'net_taxable' | ...
  applies_to,                           -- 'sales' | 'purchases' | 'salary' | 'nonresident' ...
  recoverable BOOLEAN,                  -- for input VAT
  posts_debit_account, posts_credit_account,  -- links to COA
  effective_from DATE, effective_to DATE,     -- versioning!
  legal_reference                       -- CGI article / Finance Law year
)
```
Seed for Cameroon: `TVA_STD 19.25`, `TVA_EXPORT 0`, `IS_STD 33`, `IS_MIN_REEL 2.2`, `IS_MIN_SIMPL 5.5`, `WHT_SERVICE 2.2/5.5`, `SIT_NONRES 15`, `CNPS_PENSION_EE 4.2` (cap), `CNPS_FAMILY_ER 7` (cap), `CNPS_INJURY_ER 1.75/2.5/5`, `CFC_EE 1`, `CFC_ER 1.5`, `FNE_ER 1`, `IRPP` (bracket table), `CAC 10`. Each with `effective_from` so a new Finance Law is a **new version**, not an overwrite (preserves history for restating prior periods).

---

# PART C — DEVELOPER APPENDICES

## 22. Recommended data model & the account-determination engine

Minimum tables to make the accounting engine correct. (Illustrative; adapt to the microservice boundaries in PRD §1.)

```
-- LAYER 1: statutory chart (MOD-06) — seed from the uploaded 2017 revised plan
chart_of_accounts(
  code PK,                 -- '4731', '706', '245' ...
  parent_code,             -- hierarchy: '4731'→'473'→'47'
  label_fr, label_en,
  class SMALLINT,          -- 1..9
  normal_balance,          -- 'D' | 'C'
  is_postable BOOLEAN,     -- only leaf/detail accounts are postable
  requires_analytic BOOLEAN -- e.g. 4731, 706 require a dossier_id
)

-- LAYER 2: operational catalogue (MOD-05, re-scoped)
dictionary_item(
  id PK, code, label_fr, label_en,
  category,                -- 'debours' | 'service' | 'overhead' | 'asset' ...
  is_debours BOOLEAN,      -- THE flag (§6)
  default_price, currency, shipping_line, source, -- (MOD-10 rates)
)

-- LAYER 3: account determination / posting rules (the glue)
posting_rule(
  id PK, dictionary_item_id FK,
  debit_account FK -> chart_of_accounts,
  credit_account FK -> chart_of_accounts,
  tax_code FK -> tax_code,      -- NULL for débours
  applies_context               -- 'sale' | 'purchase' | 'disbursement'
)

-- OPERATIONS / analytical
dossier(id PK, ref, client_id, entity_id, status, mbl, containers[])   -- MOD-29
budget_line(dossier_id, dictionary_item_id, qty, unit_cost)            -- MOD-46/48

-- LEDGER
journal(id PK, code, name)                                             -- ventes/achats/banque/paie/OD
journal_entry(
  id PK, journal_id, entry_no,        -- gap-free sequence per journal
  date, description, source_doc_ref,  -- supporting doc (Art. 22)
  status,                             -- 'draft' | 'validated'  (validated = immutable)
  source,                             -- 'SYSTEM_AUTO'|'SYSTEM_RULE'|'HUMAN_MANUAL'|'HUMAN_CORRECTION' (provenance, §13)
  review_status,                      -- 'UNREVIEWED'|'ATTESTED'|'FLAGGED'|'CORRECTED' (attest, don't gate)
  corrects_entry_id FK NULL,          -- the validated entry this one reverses/replaces (never edit in place)
  attested_by NULL, attested_at NULL, -- who reviewed and when
  period_id, created_by, created_at, ip
)
journal_line(
  id PK, entry_id FK, account_code FK,
  debit NUMERIC, credit NUMERIC,      -- exactly one > 0
  dossier_id FK NULL,                 -- analytical dimension (§6.7)
  tax_code FK NULL, currency, fx_rate
)

-- INVOICING
advance(id, dossier_id, client_id, amount, received_date, applied_amount)  -- 4191, MOD-50
cash_advance(id, holder_id, amount, issued_date, state, justified_amount,  -- 581 régie d'avance, MOD-49 (§6.8)
             returned_amount, aged_after_days)  -- state: ISSUED|PARTIALLY_JUSTIFIED|JUSTIFIED|AGED_UNJUSTIFIED|QUERIED
invoice(id, dossier_id, client_id, type, ...)                              -- proforma|final, MOD-50/51
invoice_line(invoice_id, dictionary_item_id, qty, unit_price, is_debours, tax_code)

-- audit
immutable_log(id, user, action, entity, before_json, after_json, date, ip, module) -- MOD-69
```

**Account-determination flow (how an invoice becomes a balanced entry):**
1. For each `invoice_line`, read its `dictionary_item` and `posting_rule`.
2. If `is_debours` → credit **4731** (recover), **no tax**. Else → credit the mapped **706/707** and add a **VAT line (4432)** from `tax_code`.
3. Debit **4111** for the line total (HT + VAT for services; cost for débours recovery).
4. Sum lines; assert **Σ Dr = Σ Cr**; attach `dossier_id` to every line; write one `journal_entry`.
5. Apply any `advance` (Dr 4191 / Cr 4111) and any WHT suffered (Dr 449).

---

## 23. Hard validation rules the system MUST enforce (invariants)

1. **Balanced entries.** Reject any `journal_entry` where `Σ debit ≠ Σ credit`.
2. **One side per line.** Each `journal_line` has exactly one of `debit`/`credit` > 0.
3. **Postable accounts only.** Postings allowed only to leaf accounts (`is_postable = true`).
4. **Débours never in class 6/7.** Any line where `is_debours = true` must post to **473** (or a client/advance account) — reject if it targets a class-6 or class-7 account.
5. **VAT only on the service/purchase base.** No output VAT line may be generated from a débours line.
6. **No compensation.** Never net a receivable (411) against a payable (401), or income against expense, in one line (§2.6).
7. **Advance ≠ revenue.** Money received before a final invoice posts to **4191**, never to class 7 (§7).
8. **Immutability.** A `validated` entry cannot be updated or deleted — only reversed by a contra entry (Art. 20/22). Validating locks the period.
9. **Sequence integrity.** `entry_no` is gap-free and monotonic per journal per period.
10. **Analytical completeness.** Lines on **4731, 706, 707** and direct-cost accounts require a non-null `dossier_id`.
11. **Supporting document.** No entry validates without a `source_doc_ref` (link to MOD-64) — MOD-65 flags violations.
12. **Currency/FX.** Foreign-currency lines store `currency` + `fx_rate`; year-end re-translation routes to 478/479 (§8.14), not P&L.
13. **Tax versioning.** Postings use the `tax_code` version whose `effective_from ≤ entry.date`.
14. **Dictionary completeness.** A `dictionary_item` cannot be saved without a complete `posting_rule` (accounts + tax_code or explicit débours).
15. **Provenance & review are mandatory, but review never gates.** Every `journal_entry` records a `source` and a `review_status`. A missing human review never blocks the ledger — an unreviewed entry is valid and flagged, not withheld (§13).
16. **Corrections, not edits.** A `validated` entry is immutable; any fix is a linked reversal + replacement (`source = HUMAN_CORRECTION`, `corrects_entry_id` set). Reject any attempt to update or delete a validated entry in place (Art. 20/22).
17. **Advance justification aging.** A cash advance posts to **581** on issue and is retired to **4731** only against receipts. An advance still open past its policy window auto-reclassifies from 581 to a receivable from the holder (**4211**) — never auto-allocated to 4731. MOD-65 flags it (§6.8).

---

## 24. End-to-end worked scenario (the 10M ACME operation, full trace)

**Setup:** ACME import; SmartLS on réel; services quoted HT + 19.25% VAT; dossier `SLAS-2026-0001`.

1. **Costing (MOD-46):** budget_lines seeded from dictionary (customs 5,000,000 débours; shipping 2,000,000 débours; port 1,000,000 débours; last-mile 1,500,000 service; commission 500,000 service). **No GL.**
2. **Quote → Proforma (MOD-27/50):** proforma total presented. **No GL.**
3. **ACME pays 10,000,000 (MOD-50 → MOD-09):**
   `Dr 521 10,000,000 / Cr 4191(ACME) 10,000,000` — dossier-tagged.
4. **Disbursements (MOD-49), each dossier-tagged:**
   `Dr 4731(ACME) 5,000,000 / Cr 521 5,000,000` (customs)
   `Dr 4731(ACME) 2,000,000 / Cr 521 2,000,000` (shipping)
   `Dr 4731(ACME) 1,000,000 / Cr 521 1,000,000` (port)
5. **Operation runs; last-mile performed with own fleet** (fuel/driver costs booked to 6053/661, dossier-tagged — these are SmartLS's own costs, part of margin).
6. **Final invoice (MOD-51):**
   `Dr 4111(ACME) 10,385,000 / Cr 7061 1,500,000 / Cr 7062 500,000 / Cr 4432 385,000 / Cr 4731(ACME) 8,000,000`
7. **Apply advance:** `Dr 4191(ACME) 10,000,000 / Cr 4111(ACME) 10,000,000`
8. **VAT top-up settled:** `Dr 521 385,000 / Cr 4111(ACME) 385,000`

**Result checks:** 4731(ACME) = 0 (débours recovered); turnover (706x) = **2,000,000**; output VAT (4432) = **385,000**; **dossier margin** = 2,000,000 − (fuel + driver + any subcontract) with **débours excluded**. Minimum tax base on this op = 2,000,000 (⇒ 44,000 @2.2%), not 10,000,000. Every downstream statement (Compte de résultat, VAT return, IS) is now correct.

---

## 25. Glossary / bilingual financial dictionary (key terms)

| EN | FR | Meaning |
|---|---|---|
| Chart of accounts | Plan comptable | The statutory list of accounts (SYSCOHADA) |
| Journal entry | Écriture comptable | A balanced Dr/Cr record of an event |
| Debit / Credit | Débit / Crédit | Left/right sides of an entry |
| Trial balance | Balance générale | Per-account opening/movements/closing summary |
| General ledger | Grand livre | All movements, account by account |
| Day-book / Journal | Journal | Chronological book (ventes, achats, banque, paie, OD) |
| Disbursement | Débours / frais avancés | Money paid on the client's behalf; pass-through (473) |
| Re-invoicing | Refacturation | Cost incurred in own name then re-billed (class 6 → 7 + VAT) |
| Customer advance | Avance / acompte reçu | Money received before the work (4191) |
| Deferred income | Produit constaté d'avance | Invoiced but not yet earned (477) |
| Accrued income | Facture à établir | Earned but not yet invoiced (4181) |
| Output VAT | TVA facturée / collectée | VAT charged to clients (443) |
| Input VAT | TVA récupérable / déductible | VAT paid to suppliers (445) |
| Withholding tax | Retenue à la source / précompte | Tax withheld from a payment (447 payable / 449 suffered) |
| Corporate income tax | Impôt sur les sociétés (IS) | Tax on company profit (891/441) |
| Minimum tax | Minimum de perception / impôt minimum | Turnover-based floor tax (2.2%/5.5%) |
| Depreciation | Amortissement | Systematic write-down of an asset (681/28xx) |
| Impairment / provision | Dépréciation / provision | Recognition of a probable loss (19/29/39/49/59/69) |
| Net result | Résultat net | Profit or loss for the year (131) |
| Balance sheet | Bilan | Snapshot of assets/liabilities/equity |
| Income statement | Compte de résultat | Period performance (classes 6/7/8) |
| Cash-flow (OHADA) | TAFIRE | SYSCOHADA financing-flows statement |
| Notes | Notes annexes | Disclosures & breakdowns |
| Operation file | Dossier | The per-shipment cost object (analytical unit) |
| Agent/principal | Mandataire / mandant | SmartLS acts as agent (mandataire) for the client (mandant) |

---

## 26. Sources

**Primary law / standard (authoritative — attached to your project):**
- **AUDCIF** — Acte uniforme relatif au droit comptable et à l'information financière (OHADA, 2017); your uploaded `audcif_jo-ohada-15-02-2017.pdf`.
- **SYSCOHADA révisé** chart of accounts & application guide; your uploaded `2017_Revised_OHADA_Accounting_Plan_pdf.pdf` (seed the full 4-digit list from this).
- **Cameroon Code Général des Impôts (CGI)** + the annual **Loi de Finances**; DGI: impots.cm (annual Finance Law circular).
- **CNPS** decree on contribution rates & the 750,000 ceiling; cnps.cm.

**Practitioner references (for cross-checking; verify against primary law):**
- PwC Worldwide Tax Summaries — Cameroon (corporate, individual, other taxes, WHT, administration).
- Cameroon payroll guides (CNPS 4.2%/7%/1.75–5%, CFC 1%/1.5%, FNE 1%, DIPE by the 15th).
- SYSCOHADA chart-of-accounts references (plan-comptable-ohada.com; class-4 detail incl. **473 Intermédiaires, opérations faites pour le compte de tiers**).
- French débours doctrine (compta-online, ANAFAGC) — the pass-through/no-VAT/no-P&L treatment SYSCOHADA inherits.

---

### Document control
- **Version:** 1.0 (2026). Owner: SmartLS / JBS Praxis accounting workstream.
- **Review trigger:** every January (new Finance Law) and on any OHADA revision.
- **Sign-off required before go-live:** a licensed Cameroonian expert-comptable must validate every rate in Part B and the payroll computation in §9.
- **Companion documents:** this file is designed to sit beside the PRD (Master Functional Specification v1.0). Where they disagree on accounting behaviour, **this document governs**.

---

*Appendices A–C follow: (A) the complete 4-digit SYSCOHADA chart of accounts for every class; (B) additional logistics-specific journal recipes; (C) the statutory statement layouts.*

---

# APPENDIX A — Complete SYSCOHADA (révisé) chart of accounts

**How to read this:** accounts are listed hierarchically — 2-digit (heading) → 3-digit → 4-digit. Seed these into `chart_of_accounts` (§22); mark only the leaf accounts you actually use as `is_postable = true`. Normal balance follows the class rule (§3): classes 2/3/5 debit, class 1 credit, class 6 debit, class 7 credit; class 4 and class 8 are mixed (noted). Contra accounts (28xx, 29xx, 39xx, 49x, 59x) carry the **opposite** balance to their family. **★ = high-frequency for a Cameroon freight forwarder.** This is a comprehensive working chart; for any 4-digit code not listed, the **officially annexed AUDCIF plan governs** (reconcile against your uploaded plan).

## Class 1 — Comptes de ressources durables (equity & long-term liabilities) — normal balance **C**

**10 — CAPITAL**
- 101 Capital social — 1011 souscrit non appelé · 1012 souscrit appelé non versé · 1013 souscrit appelé versé non amorti · 1014 souscrit appelé versé amorti · 1018 soumis à conditions particulières
- 102 Capital par dotation — 1021 Dotation initiale · 1022 Dotations complémentaires · 1028 Autres dotations
- 103 Capital personnel
- 104 Compte de l'exploitant
- 105 Primes liées aux capitaux propres — 1051 d'émission · 1052 d'apport · 1053 de fusion · 1054 de conversion · 1058 autres
- 106 Écarts de réévaluation — 1061 légale · 1062 libre
- 109 Actionnaires, capital souscrit non appelé *(contra, debit)*

**11 — RÉSERVES**
- 111 Réserve légale
- 112 Réserves statutaires ou contractuelles
- 113 Réserves réglementées
- 118 Autres réserves

**12 — REPORT À NOUVEAU**
- 121 Report à nouveau créditeur *(C)*
- 129 Report à nouveau débiteur *(D)*

**13 — RÉSULTAT NET DE L'EXERCICE** ★
- 130 Résultat en instance d'affectation
- 131 Résultat net : bénéfice *(C)*
- 139 Résultat net : perte *(D)*

**14 — SUBVENTIONS D'INVESTISSEMENT**
- 141 Subventions d'équipement A (État)
- 142 Subventions d'équipement B (autres organismes)
- 148 Autres subventions d'investissement

**15 — PROVISIONS RÉGLEMENTÉES ET FONDS ASSIMILÉS**
- 151 Amortissements dérogatoires · 152 Plus-values de cession à réinvestir · 153 Fonds réglementés · 154 Provision spéciale de réévaluation · 155 Provisions réglementées relatives aux immobilisations · 156 relatives aux stocks · 157 Provisions pour investissement · 158 Autres

**16 — EMPRUNTS ET DETTES ASSIMILÉES** ★
- 161 Emprunts obligataires · 162 Emprunts et dettes auprès des établissements de crédit ★ · 163 Avances reçues de l'État · 164 Avances reçues et comptes courants bloqués · 165 Dépôts et cautionnements reçus · 166 Intérêts courus · 167 Avances assorties de conditions particulières · 168 Autres emprunts et dettes

**17 — DETTES DE LOCATION ACQUISITION (crédit-bail)**
- 172 Crédit-bail immobilier · 173 Crédit-bail mobilier · 176 Intérêts courus · 178 Autres

**18 — DETTES LIÉES À DES PARTICIPATIONS & COMPTES DE LIAISON** *(multi-entity, MOD-01)*
- 181 Dettes liées à des participations (groupe) · 182 (hors groupe) · 183 Comptes permanents bloqués des établissements et succursales · 184 Comptes permanents non bloqués · 185 Comptes de liaison charges et produits · 188 Comptes de liaison des sociétés en participation

**19 — PROVISIONS POUR RISQUES ET CHARGES**
- 191 Provisions pour litiges · 192 pour garanties données aux clients · 193 pour pertes sur marchés à achèvement futur · 194 pour pertes de change · 195 pour impôts · 196 pour pensions et obligations similaires · 197 pour charges à répartir · 198 Autres

## Class 2 — Comptes d'actif immobilisé (non-current assets) — normal balance **D**

**20 — CHARGES IMMOBILISÉES** — *suppressed in SYSCOHADA révisé* (frais d'établissement / charges à répartir are now expensed, not capitalised). Retained only for legacy mapping; do **not** create new balances here.

**21 — IMMOBILISATIONS INCORPORELLES**
- 211 Frais de développement · 212 Brevets, licences, concessions et droits similaires · **213 Logiciels et sites internet** ★ *(the ERP licence)* · 214 Marques · 215 Fonds commercial · 216 Droit au bail · 218 Autres droits et valeurs incorporels · 219 Immobilisations incorporelles en cours

**22 — TERRAINS**
- 221 Terrains agricoles et forestiers · 222 Terrains nus · 223 Terrains bâtis · 224 Travaux de mise en valeur des terrains · 225 Terrains de gisement · 226 Terrains aménagés · 228 Autres terrains

**23 — BÂTIMENTS, INSTALLATIONS TECHNIQUES ET AGENCEMENTS** ★ *(warehouses, docks)*
- 231 Bâtiments … sur sol propre ★ · 232 Bâtiments … sur sol d'autrui · 233 Ouvrages d'infrastructure · 234 Installations techniques · 235 Aménagements de bureaux · 237 Agencements et aménagements · 238 Autres installations et agencements

**24 — MATÉRIEL, MOBILIER ET ACTIFS BIOLOGIQUES** ★
- 241 Matériel et outillage industriel et commercial *(forklifts, reach-stackers)* ★
- 242 Matériel et outillage agricole
- 243 Matériel d'emballage récupérable et identifiable
- 244 Matériel et mobilier — 2441 Matériel de bureau · **2442 Matériel informatique** ★ · 2443 Matériel bureautique · **2444 Mobilier de bureau** ★ · 2447 Objets d'art
- **245 Matériel de transport** ★★ *(the FLEET)* — 2451 Matériel automobile (road: trucks, trailers) · 2452 Matériel ferroviaire · 2453 Matériel fluvial/lagunaire · 2454 Matériel naval · 2455 Matériel aérien
- 246 Actifs biologiques · 247 Agencements et aménagements du matériel · 248 Autres matériels

**25 — AVANCES ET ACOMPTES VERSÉS SUR IMMOBILISATIONS**
- 251 sur immobilisations incorporelles · 252 sur immobilisations corporelles

**26 — TITRES DE PARTICIPATION**
- 261 sociétés sous contrôle exclusif · 262 sous contrôle conjoint · 263 influence notable · 265 organismes professionnels · 266 parts dans des GIE · 268 Autres

**27 — AUTRES IMMOBILISATIONS FINANCIÈRES**
- 271 Prêts et créances non commerciales · 272 Prêts au personnel · 273 Créances sur l'État · 274 Titres immobilisés · **275 Dépôts et cautionnements versés** ★ *(deposits/guarantees paid to PAD, shipping lines, landlords)* · 276 Intérêts courus · 277 Créances rattachées à des participations et avances à des GIE · 278 Immobilisations financières diverses

**28 — AMORTISSEMENTS** *(contra-asset, balance **C**)*
- 281 Amort. des immobilisations incorporelles — 2813 logiciels
- 283 Amort. des bâtiments, installations techniques et agencements — 2831 bâtiments sur sol propre
- 284 Amort. du matériel — 2841 matériel et outillage · 2844 matériel et mobilier · **2845 matériel de transport** ★

**29 — DÉPRÉCIATIONS DES IMMOBILISATIONS** *(contra, balance **C**)*
- 291 incorporelles · 292 terrains · 293 bâtiments et installations · 294 matériel · 295 avances et acomptes versés · 296 titres de participation · 297 autres immobilisations financières

## Class 3 — Comptes de stocks (inventory) — normal balance **D**

> **[LOGISTICS] Reminder:** client goods in the warehouse are **not** SmartLS stock — track them in the WMS and, if on the books, only as class-9 commitments (§5). Only SmartLS's own consumables/spares/fuel-in-tank belong here.

**31 — MARCHANDISES** — 311 Marchandises A · 312 Marchandises B
**32 — MATIÈRES PREMIÈRES ET FOURNITURES LIÉES** — 321 Matières A · 322 Matières B · 323 Fournitures liées
**33 — AUTRES APPROVISIONNEMENTS** ★ *(spares, tyres, lubricants)* — 331 Matières consommables · 332 Fournitures d'atelier et d'usine · 333 Fournitures de magasin · 334 Fournitures de bureau · 335 Emballages (3351 perdus · 3352 récupérables non identifiables · 3353 à usage mixte) · 338 Autres
**34 — PRODUITS EN COURS** — 341 Produits en cours · 342 Travaux en cours · 343 Produits intermédiaires en cours · 344 Produits résiduels en cours
**35 — SERVICES EN COURS** — 351 Études en cours · 352 Prestations de services en cours *(partially-rendered operations at month-end)*
**36 — PRODUITS FINIS** — 361 Produits finis A · 362 Produits finis B
**37 — PRODUITS INTERMÉDIAIRES ET RÉSIDUELS** — 371 Produits intermédiaires · 372 Produits résiduels
**38 — STOCKS EN COURS DE ROUTE, EN CONSIGNATION OU EN DÉPÔT** — 381 Marchandises en cours de route · 382 Matières premières en cours de route · 383 Autres approvisionnements en cours de route · 386 Produits finis en cours de route · 388 Stock en consignation ou en dépôt
**39 — DÉPRÉCIATIONS DES STOCKS** *(contra, balance **C**)* — 391 marchandises · 392 matières premières · 393 autres approvisionnements · 394 produits en cours · 395 services en cours · 396 produits finis · 397 produits intermédiaires et résiduels


## Class 4 — Comptes de tiers (third parties) — normal balance **mixed**

**40 — FOURNISSEURS ET COMPTES RATTACHÉS** *(C)*
- 401 Fournisseurs, dettes en compte — **4011 Fournisseurs** ★ · 4012 Fournisseurs groupe · **4013 Fournisseurs sous-traitants** ★
- 402 Fournisseurs, effets à payer
- 408 Fournisseurs, factures non parvenues *(accrued: goods/services received, invoice not in)* ★
- 409 Fournisseurs débiteurs — 4091 avances et acomptes versés ★ · 4092 créances pour emballages à rendre · 4093 créances litigieuses · 4094 autres créances

**41 — CLIENTS ET COMPTES RATTACHÉS** *(D)*
- 411 Clients — **4111 Clients** ★ · 4112 Clients groupe
- 412 Clients, effets à recevoir
- 414 Clients, État et collectivités publiques *(public-sector clients — withhold tax, §17)* ★
- 416 Créances clients litigieuses ou douteuses — 4161 litigieuses · 4162 douteuses
- 418 Clients, produits à recevoir — **4181 Clients, factures à établir** ★ *(earned, not yet invoiced)*
- 419 Clients créditeurs — **4191 Clients, avances et acomptes reçus** ★★ · 4192 dettes pour emballages consignés · 4198 RRR à accorder

**42 — PERSONNEL** *(mixed)*
- 421 Personnel, avances et acomptes — 4211 avances · 4212 acomptes ★ *(MOD-15)*
- **422 Personnel, rémunérations dues** ★★ *(net pay payable)*
- 423 Personnel, oppositions et saisies-arrêts *(garnishments)* · 424 Œuvres sociales internes · 425 Représentants du personnel · 426 Participation aux bénéfices · 427 Personnel — dépôts · 428 Charges à payer et produits à recevoir (4281 congés à payer · 4286 autres)

**43 — ORGANISMES SOCIAUX** *(C)*
- **431 Sécurité sociale (CNPS)** ★★ — 4311 Prestations familiales · 4312 Accidents du travail · 4313 Caisse de retraite (pension/vieillesse)
- 432 Caisses de retraite complémentaire · 433 Autres organismes sociaux · 438 Organismes sociaux, charges à payer (4381 sur congés à payer · 4386 autres)

**44 — ÉTAT ET COLLECTIVITÉS PUBLIQUES** *(mixed)*
- **441 État, impôt sur les bénéfices (IS)** ★
- 442 État, autres impôts et taxes — 4421 impôts et taxes d'État · **4426 Droits de douane** · 4428 autres
- **443 État, TVA facturée** *(output VAT, C)* ★★ — 4431 sur ventes · **4432 sur prestations de services** ★★ · 4433 sur travaux · 4434 sur production livrée à soi-même · 4435 sur factures à établir
- 444 État, TVA due ou crédit de TVA — 4441 TVA due *(payable, C)* ★ · 4449 crédit de TVA à reporter *(D)*
- **445 État, TVA récupérable** *(input VAT, D)* ★★ — 4451 sur immobilisations · 4452 sur achats · 4453 sur transport · 4454 sur services extérieurs et autres charges · 4455 sur factures non parvenues · 4456 transférée par d'autres entreprises
- 446 État, autres taxes sur le chiffre d'affaires
- **447 État, impôts retenus à la source** *(C)* ★★ — 4471 Impôt sur les traitements et salaires (IRPP + CAC) · 4472 sur revenus des valeurs mobilières · 4473 sur loyers · 4474 autres retenues (WHT withheld from suppliers)
- 448 État, charges à payer et produits à recevoir
- 449 État, créances et dettes diverses — 4491 obligations cautionnées · **4492 acomptes/avances sur impôts (acomptes IS + précompte SUFFERED, D)** ★ · 4494 subventions à recevoir · 4499 autres

**45 — ORGANISMES INTERNATIONAUX** — 451 organismes africains · 452 autres organismes internationaux · 458 fonds de dotation
**46 — APPORTEURS, ASSOCIÉS ET GROUPE** *(mixed)* — 461 opérations sur le capital (4613 capital appelé non versé · 4616 versements reçus sur augmentation · 4617 actionnaires défaillants) · 462 comptes courants d'associés · 463 opérations faites en commun · 464 opérations sur autres valeurs · 465 dividendes à payer · 466/468 groupe autres opérations
**47 — DÉBITEURS ET CRÉDITEURS DIVERS** *(mixed)*
- 471 Comptes d'attente *(suspense — clear before close)*
- 472 Versements restant à effectuer sur titres non libérés
- **473 Intermédiaires, opérations faites pour le compte de tiers** ★★★ *(THE DÉBOURS ACCOUNT, §6)* — **4731 Mandants** ★★ · 4732 Mandataires · 4733 Commettants · 4734 Commissionnaires · 4738 Autres intermédiaires
- 474 Répartition périodique des charges et des produits
- 476 Charges constatées d'avance *(prepaid, D)* ★
- 477 Produits constatés d'avance *(deferred income, C)* ★
- 478 Écarts de conversion — Actif *(unrealised FX loss holding, D)* — 4781 diminution des créances · 4782 augmentation des dettes
- 479 Écarts de conversion — Passif *(unrealised FX gain holding, C)* — 4791 augmentation des créances · 4792 diminution des dettes

**48 — CRÉANCES ET DETTES HORS ACTIVITÉS ORDINAIRES (HAO)** *(mixed)*
- **481 Fournisseurs d'investissements** ★ *(buying fleet/equipment on credit)* — 4811 immobilisations incorporelles · 4812 immobilisations corporelles · 4817 retenues de garantie
- 482 Fournisseurs d'investissements, effets à payer · 483 Dettes sur acquisitions de titres de placement · 484 Autres dettes HAO
- 485 Créances sur cessions d'immobilisations *(selling a used truck)* · 486 Créances sur cessions de titres · 488 Autres créances HAO

**49 — DÉPRÉCIATIONS ET RISQUES PROVISIONNÉS (tiers)** *(contra, balance **C**)*
- 490 Dépréciations des comptes fournisseurs · **491 Dépréciations des comptes clients** ★ *(bad-debt provision)* (4911 litigieuses · 4912 douteuses) · 492 personnel · 493 organismes sociaux · 494 État · 495 associés/groupe · 496 débiteurs divers · 497 créances HAO · 499 Risques provisionnés

## Class 5 — Comptes de trésorerie (treasury) — normal balance **D**

**50 — TITRES DE PLACEMENT** — 501 Titres du Trésor et bons de caisse CT · 502 Actions · 503 Obligations · 504 Bons de souscription · 505 Titres négociables hors région · 506 Intérêts courus · 508 Autres
**51 — VALEURS À ENCAISSER** — 511 Effets à encaisser · 512 Effets à l'encaissement · 513 Chèques à encaisser · 514 Chèques à l'encaissement · 515 Cartes de crédit à encaisser · 518 Autres
**52 — BANQUES** ★★ — **521 Banques locales** ★★ *(one sub-account per bank account — MOD-09)* · 522 Banques autres États CEMAC/UEMOA · 523 Banques autres États zone franc · 524 Banques hors zone franc · 526 Banques, intérêts courus
**53 — ÉTABLISSEMENTS FINANCIERS ET ASSIMILÉS** — 531 Chèques postaux (CCP) · 532 Trésor · 533 Sociétés de gestion et d'intermédiation · **538 Autres organismes financiers** → *recommended home for Mobile Money sub-accounts, e.g. 5381 MTN MoMo, 5382 Orange Money* ★
**54 — INSTRUMENTS DE TRÉSORERIE** — 541 Options de taux d'intérêt · 542 Options de change · 543 Marchés à terme · 545 Avoirs d'or/métaux précieux · 548 Autres
**56 — BANQUES, CRÉDITS DE TRÉSORERIE ET D'ESCOMPTE** — 561 Crédits de trésorerie · 564 Escompte de crédits ordinaires · 565 de crédits de campagne · 566 Banques, découverts *(overdraft — credit balance)*
**57 — CAISSE** ★★ — **571 Caisse siège social** ★★ · 572 Caisse succursale A · 573 Caisse succursale B
**58 — RÉGIES D'AVANCES, ACCRÉDITIFS ET VIREMENTS INTERNES** — 581 Régies d'avances · 582 Accréditifs · **585 Virements de fonds** ★ *(route every own-account transfer through here — §8.16)* · 588 Autres
**59 — DÉPRÉCIATIONS ET PROVISIONS POUR RISQUES À COURT TERME** *(contra, balance **C**)* — 590/591 dépréciations des titres de placement · 592 des valeurs à encaisser · 599 risques provisionnés à caractère financier

## Class 6 — Comptes de charges des activités ordinaires (expenses) — normal balance **D**

**60 — ACHATS ET VARIATIONS DE STOCKS**
- 601 Achats de marchandises · 602 Achats de matières premières et fournitures liées
- 603 Variations des stocks de biens achetés — 6031 marchandises · 6032 matières premières · 6033 autres approvisionnements *(sign can be Dr or Cr)*
- 604 Achats stockés de matières et fournitures consommables
- 605 Autres achats — 6051 Eau · 6052 Électricité · **6053 Autres énergies / carburants** ★ *(fleet fuel — MOD-43)* · 6054 Fournitures d'entretien non stockables · 6055 Fournitures de bureau non stockables · 6058 Petit matériel et outillage
- 608 Achats d'emballages — 6081 perdus · 6082 récupérables non identifiables · 6083 à usage mixte

**61 — TRANSPORTS** ★
- 611 Transports sur achats · 612 Transports sur ventes · **613 Transports pour le compte de tiers** ★ *(subcontracted haulage in own name — refacturation, §6.5)* · 614 Transports du personnel · 616 Transports de plis · 618 Autres frais de transport

**62 — SERVICES EXTÉRIEURS A**
- 621 Sous-traitance générale ★ · 622 Locations et charges locatives (6221 terrains · 6222 bâtiments · 6223 matériel et outillage · **6224 matériel de transport** *(truck rental)*) · 623 Redevances de crédit-bail (6232 immobilier · 6233 mobilier) · **624 Entretien, réparations et maintenance** ★ (6241 biens immobiliers · 6242 biens mobiliers · 6243 maintenance) · 625 Primes d'assurance ★ (6251 multirisques · **6252 matériel de transport** · 6253 risques d'exploitation) · 626 Études, recherches et documentation · 627 Publicité, publications, relations publiques · 628 Frais de télécommunications (6281 téléphone · 6282 internet)

**63 — SERVICES EXTÉRIEURS B**
- 631 Frais bancaires (6311 sur effets · 6315 commissions sur cartes) · **632 Rémunérations d'intermédiaires et de conseils** (6321 commissions/courtages sur achats · 6322 sur ventes · **6324 Honoraires** ★ · 6325 frais d'actes et de contentieux) · 633 Frais de formation du personnel · 634 Redevances pour brevets, licences, logiciels · 635 Cotisations · 637 Rémunérations de personnel extérieur (6371 intérimaire · 6372 détaché) · 638 Autres charges externes

**64 — IMPÔTS ET TAXES**
- 641 Impôts et taxes directs — 6411 Impôts fonciers · **6412 Patente, licences et taxes annexes** ★ *(business licence)* · 6413 Taxes sur salaires · 6415 Formation professionnelle (FNE-type) · **6418 Autres directs** *(vignette/axle tax — fleet)* · 645 Impôts et taxes indirects · 646 Droits d'enregistrement · 647 Pénalités et amendes fiscales · 648 Autres

**65 — AUTRES CHARGES**
- 651 Pertes sur créances clients et autres débiteurs *(bad debts written off)* · 652 Quote-part de résultat sur opérations faites en commun · 654 Valeurs comptables des cessions COURANTES d'immobilisations · 658 Charges diverses · 659 Charges provisionnées d'exploitation

**66 — CHARGES DE PERSONNEL** ★★
- **661 Rémunérations directes — personnel national** ★ — 6611 Appointements, salaires et commissions · 6612 Primes et gratifications · 6613 Congés payés · 6614 Indemnités de préavis et de licenciement · 6615 Indemnités de maladie
- 662 Rémunérations directes — personnel non national · 663 Indemnités forfaitaires
- **664 Charges sociales** ★ *(employer CNPS/CFC/FNE)* — 6641 sur personnel national · 6642 sur personnel non national
- 666 Rémunération de l'exploitant individuel · 667 Rémunération transférée de personnel extérieur · 668 Autres charges sociales

**67 — FRAIS FINANCIERS ET CHARGES ASSIMILÉES**
- 671 Intérêts des emprunts · 672 Intérêts dans loyers de location acquisition · 673 Escomptes accordés · 674 Autres intérêts · **676 Pertes de change** ★ *(realised FX loss)* · 677 Pertes sur cessions de titres · 678 Pertes sur risques financiers · 679 Charges provisionnées financières

**68 — DOTATIONS AUX AMORTISSEMENTS** ★
- 681 Dotations aux amortissements d'exploitation — 6812 immobilisations incorporelles · **6813 immobilisations corporelles** ★ *(fleet/warehouse depreciation)* · 687 Dotations aux amortissements à caractère financier

**69 — DOTATIONS AUX PROVISIONS ET AUX DÉPRÉCIATIONS**
- 691 d'exploitation — 6911 provisions pour risques et charges · 6912 dépréciations des immobilisations · 6913 des stocks · **6914 des créances** ★ · 697 financières


## Class 7 — Comptes de produits des activités ordinaires (income) — normal balance **C**

**70 — VENTES** ★★
- 701 Ventes de marchandises · 702 Ventes de produits finis · 703 Ventes de produits intermédiaires · 704 Ventes de produits résiduels · 705 Travaux facturés
- **706 Services vendus** ★★★ *(core forwarder revenue)* — 7061 Transport / freight / last-mile · 7062 Commission de transit / d'agrément en douane · 7063 Frais de documentation / dossier · 7064 Manutention / handling (own name) · 7068 Autres services
- 707 Produits accessoires — 7071 Ports et frais accessoires facturés · 7073 Bonifications obtenues · 7078 Autres *(use for genuine refacturation recoveries, §6.5)*

**71 — SUBVENTIONS D'EXPLOITATION** — 711 sur produits à l'exportation · 718 autres
**72 — PRODUCTION IMMOBILISÉE** — 721 immobilisations incorporelles · 722 immobilisations corporelles
**73 — VARIATIONS DES STOCKS DE BIENS ET SERVICES PRODUITS** — 734 produits en cours · 735 en-cours de services · 736 produits finis · 737 produits intermédiaires et résiduels
**75 — AUTRES PRODUITS** — 752 quote-part de résultat sur opérations faites en commun · **754 Produits des cessions COURANTES d'immobilisations** · 758 Produits divers · 759 Reprises de charges provisionnées d'exploitation
**77 — REVENUS FINANCIERS ET PRODUITS ASSIMILÉS** — 771 Intérêts de prêts · 772 Revenus de participations · 773 Escomptes obtenus · 774 Revenus de titres de placement · **776 Gains de change** ★ *(realised FX gain)* · 777 Gains sur cessions de titres · 778 Gains sur risques financiers · 779 Reprises de charges provisionnées financières
**78 — TRANSFERTS DE CHARGES** — 781 d'exploitation · 787 financières
**79 — REPRISES DE PROVISIONS ET DE DÉPRÉCIATIONS** — 791 d'exploitation · 797 financières

## Class 8 — Comptes des autres charges et autres produits (HAO) & income tax — normal balance **mixed**

**81 — VALEURS COMPTABLES DES CESSIONS D'IMMOBILISATIONS** *(Dr)* — 811 incorporelles · **812 corporelles** ★ *(NBV of a sold/scrapped truck)*
**82 — PRODUITS DES CESSIONS D'IMMOBILISATIONS** *(Cr)* — 821 incorporelles · **822 corporelles** ★ *(sale price of a used asset)*
**83 — CHARGES HORS ACTIVITÉS ORDINAIRES** *(Dr)* — 831 charges HAO constatées · 834 pertes sur créances HAO · 835 dons et libéralités accordés · 836 abandons de créances consentis · 838 autres
**84 — PRODUITS HORS ACTIVITÉS ORDINAIRES** *(Cr)* — 841 produits HAO constatés · 845 dons et libéralités obtenus · 846 abandons de créances obtenus · 848 autres
**85 — DOTATIONS HORS ACTIVITÉS ORDINAIRES** *(Dr)* — 851 provisions réglementées · 852 amortissements HAO · 853 dépréciations HAO · 854 provisions pour risques et charges HAO · 858 autres
**86 — REPRISES HORS ACTIVITÉS ORDINAIRES** *(Cr)* — 861 provisions réglementées · 862 amortissements HAO · 863 dépréciations HAO · **865 quote-part de subventions d'investissement virée au résultat** · 868 autres
**87 — PARTICIPATION DES TRAVAILLEURS** *(Dr)* — 871 participation légale aux bénéfices
**88 — SUBVENTIONS D'ÉQUILIBRE** *(Cr)* — 881 État · 884 Groupe · 888 Autres
**89 — IMPÔTS SUR LE RÉSULTAT** *(Dr)* ★ — **891 Impôts sur les bénéfices de l'exercice (IS)** ★ · 892 Rappel d'impôts sur résultats antérieurs · 895 Impôt minimum forfaitaire / minimum de perception *(book the minimum tax here if greater than IS — §15; [VERIFY local sub-code])* · 899 Autres impôts sur le résultat

## Class 9 — Comptabilité des engagements & comptabilité analytique de gestion — **optional (facultative)**

Not mandatory. Two uses:

**(a) Engagements hors bilan (off-balance-sheet commitments) — Art. 33 AUDCIF requires these to be followed:**
- 90 Engagements obtenus et engagements accordés — 901 Engagements obtenus (guarantees received) · 902 Engagements accordés *(guarantees/sureties GIVEN — e.g. **customs bonds / caution en douane**, bank guarantees)* ★ · 903 Engagements réciproques
- 91 Contreparties des engagements *(mirror accounts so the off-balance-sheet set self-balances)*
- *(Also the natural home, if you choose to book them, for **client goods held in the warehouse** — MOD-33–38.)*

**(b) Comptabilité analytique de gestion (cost accounting):** 92 Comptes de reclassement / coûts · 93 Coûts de production · 94 Coûts de revient et stocks · 95 Écarts sur coûts préétablis · 96 Écarts sur niveaux d'activité · 98 Résultats analytiques · 99 Liaisons internes.

> **[LOGISTICS] Do NOT use class 9 for per-dossier costing.** Implement dossier costing as an **analytical dimension** on `journal_lines` (§6.7, §22). Reserve class 9 for genuine off-balance-sheet commitments (customs bonds given, client goods held).


---

# APPENDIX B — Additional logistics-specific journal recipes

These extend the cookbook in §8 with situations specific to freight forwarding. Same rules apply: every entry balances; débours-vs-refacturation classification (§6) decides the treatment.

### B.1 Container deposit / caution paid to a shipping line (refundable)
Paid on the client's behalf and refundable → it is a **débours-type advance**, not a cost:
```
Dr  4731 Mandants – <client> (dossier) ........... deposit         (or 275 if it is SmartLS's own refundable deposit)
    Cr  521 Banque ............................... deposit
```
On refund: reverse (Dr 521 / Cr 4731). If the line **retains** part for damage and re-bills the client, that retained part becomes either a client débours recovery or, if in SmartLS's name, a refacturation (B.2).

### B.2 Demurrage / detention (surestaries)
- **If paid on the client's behalf under mandate** → débours: `Dr 4731 / Cr 521`, recovered on the invoice against 4731 (no VAT).
- **If SmartLS is billed in its own name and re-bills with/without margin** → refacturation: cost `Dr 621/613 + Dr 445 / Cr 401`; re-invoice `Dr 411 / Cr 707 + Cr 4432`.

### B.3 Customs bond / guarantee given (caution en douane) — off-balance-sheet
No cash moves when the bond is *issued*; record the commitment in class 9 (§ Appendix A, class 9):
```
Dr  902 Engagements accordés (customs bond) ...... bond_amount
    Cr  91  Contrepartie des engagements accordés .. bond_amount
```
Reverse when released. Any bank/insurer **fee** for issuing the guarantee is a real cost → `Dr 631/638 + Dr 445 / Cr 521`.

### B.4 Credit note / avoir issued to a client (billing correction)
Correct by a **negative/contra** entry (Art. 20 — never edit the original):
```
Dr  706  Services vendus ......................... amount_HT
Dr  4432 État, TVA facturée ...................... amount_HT × 19.25%
    Cr  4111 Clients ............................. amount_TTC
```

### B.5 Stage-of-completion at month-end (operation spans the close)
Work performed but not yet invoiced → accrue revenue (§7):
```
Dr  4181 Clients, factures à établir ............. earned_not_invoiced_HT
    Cr  706 Services vendus ..................... earned_not_invoiced_HT
    (VAT is recognised when the actual invoice is issued next period)
```
Conversely, invoiced but not yet earned → defer: `Dr 706 / Cr 477` for the unearned portion.

> **Automate the accrual, don't hand-calculate it at 11:59 PM (MOD 6.1 Event Engine).** Two hard requirements: (1) the Event Engine **proposes a draft** accrual from milestone %/WMS status for a human to attest — it must not silently auto-post a revenue figure; and (2) it must be booked as a **reversing entry that auto-extourns on day 1 of the next period**, or the accrual double-counts against the real invoice when it is issued. The auto-reversal is the piece teams forget.

### B.6 Bad-debt recovery (a written-off receivable is later paid)
```
Dr  521 Banque ................................... amount_received
    Cr  758 Produits divers (or 759 reprise) ...... amount_received
```

### B.7 SmartLS must withhold SIT on a foreign (non-resident) service supplier — §17
Foreign supplier invoice 10,000,000 for services used in Cameroon, SIT 15% withheld:
```
Dr  62x/63x <service> ............................ 10,000,000
    Cr  401 Fournisseurs ........................ 8,500,000     (paid to supplier)
    Cr  447 État, impôts retenus à la source .... 1,500,000     (SIT to remit to DGI)
```
Remit the 1,500,000: `Dr 447 / Cr 521`.

### B.8 Cash shortage / overage in the till (caisse) — MOD-09
Shortage found at count: `Dr 658 Charges diverses / Cr 571 Caisse`. Overage: `Dr 571 Caisse / Cr 758 Produits divers`. Investigate before posting (MOD-65).

### B.9 Advance to a customs broker / sub-agent (SmartLS's own supplier advance)
```
Dr  4091 Fournisseurs, avances et acomptes versés  advance
    Cr  521 Banque ............................... advance
```
Cleared when the broker's invoice arrives (Dr 62x/6324 + Dr 445 / Cr 4091 + Cr 401 balance).

---

# APPENDIX C — Statutory statement layouts (Système normal)

For MOD-56/57/58/59. These are the SYSCOHADA rubrics and the account ranges that feed them. Generate them from the trial balance; never key them by hand.

### C.1 Bilan (Balance Sheet) — rubric → accounts

**ACTIF**
| Rubric | Feeds from |
|---|---|
| Immobilisations incorporelles | 21 net of 281/291 |
| Immobilisations corporelles | 22, 23, 24 net of 283/284/293/294 *(incl. 245 fleet)* |
| Avances & acomptes sur immobilisations | 25 |
| Immobilisations financières | 26, 27 net of 296/297 |
| **Total actif immobilisé** | Σ above |
| Actif circulant HAO | 485, 488 |
| Stocks et en-cours | 3 net of 39 |
| Créances & emplois assimilés | 409, 41 (net of 491), 44-debit, 47-debit |
| **Total actif circulant** | Σ above |
| Titres de placement / Valeurs à encaisser | 50 (net 590), 51 |
| Banques, CCP, caisse | 52, 53, 57 |
| **Total trésorerie-actif** | Σ above |
| Écart de conversion-Actif | 478 |
| **TOTAL ACTIF** | Σ |

**PASSIF**
| Rubric | Feeds from |
|---|---|
| Capital | 101 (less 109 not called) |
| Primes & écarts de réévaluation | 105, 106 |
| Réserves | 111, 112, 113, 118 |
| Report à nouveau (+/−) | 121 / 129 |
| Résultat net (+/−) | 131 / 139 |
| Subventions d'investissement | 14 |
| Provisions réglementées | 15 |
| **Total capitaux propres** | Σ above |
| Emprunts & dettes financières | 16 |
| Dettes de location acquisition | 17 |
| Provisions pour risques et charges | 19 |
| **Total dettes financières** → **Total ressources stables** | Σ |
| Dettes circulantes HAO | 481–484 |
| Clients, avances reçues | 4191 |
| Fournisseurs d'exploitation | 40 |
| Dettes fiscales et sociales | 43, 44-credit |
| Autres dettes | 46, 47-credit |
| **Total passif circulant** | Σ above |
| Banques (escompte, trésorerie, découverts) | 564/565, 561, 566 |
| **Total trésorerie-passif** | Σ |
| Écart de conversion-Passif | 479 |
| **TOTAL PASSIF** | Σ (must equal TOTAL ACTIF) |

### C.2 Compte de résultat (Income Statement) — the cascade
| Line | = | Feeds from |
|---|---|---|
| Ventes de marchandises | | 701 |
| − Achats de marchandises (± variation) | | 601 (± 6031) |
| **MARGE COMMERCIALE** | | |
| + **Chiffre d'affaires** *(services dominate)* | | 701 + 705 + **706** + 707 *(débours EXCLUDED)* |
| + Production stockée / immobilisée / subventions / autres produits / transferts | | 73, 72, 71, 75, 781 |
| − Achats matières & autres (± variations) | | 602/604/605 (± 6032/6033) |
| − Transports | | 61 |
| − Services extérieurs | | 62, 63 |
| − Impôts et taxes | | 64 |
| − Autres charges | | 65 |
| **VALEUR AJOUTÉE (VA)** | | |
| − Charges de personnel | | 66 |
| **EXCÉDENT BRUT D'EXPLOITATION (EBE)** | | |
| + Reprises / − Dotations aux amort. & provisions | | 791 / 681, 691 |
| **RÉSULTAT D'EXPLOITATION** | | |
| + Revenus financiers − Frais financiers | | 77 / 67 |
| **RÉSULTAT FINANCIER** | | |
| **RÉSULTAT DES ACTIVITÉS ORDINAIRES (RAO)** | = expl. + fin. | |
| + Produits HAO − Charges HAO | | 82/84/86/88 / 81/83/85 |
| **RÉSULTAT HORS ACTIVITÉS ORDINAIRES** | | |
| − Participation des travailleurs | | 87 |
| − Impôts sur le résultat (IS / minimum tax) | | 89 |
| **RÉSULTAT NET** *(→ account 131/139)* | | |

### C.3 TAFIRE & the other two
- **TAFIRE** (MOD-59): built from the movement (opening→closing) of stable resources and uses — CAFG (self-financing capacity, derived from EBE ± non-cash), investment (Δ class 2), financing (Δ class 1 equity, 16/17), and the resulting change in working capital and net treasury. Produce this **OHADA** statement for statutory filing (the IFRS cash-flow can be an optional investor view — see PRD note in §12.1).
- **Notes annexes**: accounting policies, asset/depreciation tables, breakdown of significant lines, **off-balance-sheet commitments (class 9: customs bonds given, client goods held)**, method changes.
- **ESS**: statistical annex (employment, wages, investment, value added) — normal system only.

---

### Document control (updated)
- **Version:** 1.1 (2026) — now includes the complete 4-digit chart of accounts (Appendix A), extended logistics recipes (Appendix B) and statement layouts (Appendix C).
- **Review trigger:** every January (new Finance Law) and on any OHADA revision.
- **Sign-off required before go-live:** a licensed Cameroonian expert-comptable must validate every rate in Part B, the payroll computation in §9, and any 4-digit account marked [VERIFY].
- **Governs:** where this document and the PRD disagree on accounting behaviour, **this document governs**.

---

# APPENDIX D — Developer quick reference & anti-patterns

For the engineering team: pin D.1, internalise D.2. This is the part you'll use daily.

## D.1 The accounts you'll touch 90% of the time

| Situation | Debit | Credit |
|---|---|---|
| Client pays a proforma (advance) | 521 | 4191 |
| Pay customs/port/line on client's behalf (débours) | 4731 | 521 / 571 / 538 |
| Issue final service invoice | 4111 | 706 + 4432 + 4731 (recover débours) |
| Apply advance to invoice | 4191 | 4111 |
| Client pays an invoice | 521 | 4111 |
| Supplier bill (overhead) | 6xx + 4452 | 4011 |
| Pay a supplier | 4011 | 521 |
| Subcontracted haulage in own name (cost) | 613 + 4453 | 4013 |
| Re-bill that haulage (+ margin) | 4111 | 706 + 4432 |
| Fleet fuel | 6053 + 4452 | 521 / 571 / 538 |
| Buy a truck | 245 + 4451 | 481 / 521 |
| Monthly depreciation | 6813 | 2845 |
| Sell a used truck | 2845 + 812 (NBV) / 485 | 245 / 822 + 4431 |
| Gross salary + employee deductions | 661 | 431 + 447 + 422 |
| Employer social charges | 664 | 431 + 447/438 |
| Pay salaries | 422 | 521 |
| Remit CNPS + taxes | 431 + 447 | 521 |
| Monthly VAT (net payable) | 4432 | 445x + 4441 |
| Pay VAT | 4441 | 521 |
| Minimum-tax / IS instalment | 4492 | 521 |
| Year-end IS charge | 891 | 441 |
| WHT suffered (client withheld from us) | 4492 / 449 | 4111 |
| WHT we withhold from a supplier | 401 / 62x | 447 |
| Internal transfer (bank→cash) | 585, then 571 | 521, then 585 |
| Realised FX loss / gain | 676 | 776 |
| Bad-debt provision | 6914 | 491 |

## D.2 Anti-patterns — the mistakes that corrupt the books (with the fix)

1. **Booking the full client payment as revenue.** WRONG: `Dr 521 / Cr 706` for the whole 10,000,000. FIX: advance→4191, débours→4731, revenue only on the service portion (§6). *Symptom: turnover & VAT inflated 3–5×, permanent minimum-tax overpayment.*
2. **Débours in class 6 with the recovery in class 7.** WRONG: `Dr 613 / Cr 706` for customs paid under mandate. FIX: `Dr/Cr 4731`, no VAT, no P&L (§6.2). *Symptom: phantom revenue and cost.*
3. **Charging VAT on débours.** FIX: VAT only on the service base (§10). *Symptom: over-collected VAT, client disputes.*
4. **Recognising revenue on the proforma.** FIX: proforma = no GL; revenue on the final invoice (§7). *Symptom: revenue in the wrong period.*
5. **Editing/deleting a validated entry.** FIX: reverse with a contra entry (Art. 20; §13; B.4). *Symptom: broken audit trail, failed inspection.*
6. **Netting a client receivable against a supplier payable.** FIX: non-compensation — gross on both sides (§2.6).
7. **Hard-coding tax rates** (`base * 0.1925`). FIX: versioned `tax_code` with effective dates (§21). *Symptom: a new Finance Law breaks the code and prior-period restatement.*
8. **Recording client warehouse goods as class-3 stock.** FIX: WMS operationally; class-9 commitment if on the books (§5). *Symptom: inflated assets, wrong VA/EBE.*
9. **Recognising unrealised FX gains as income** (`Cr 776` at year-end on an open receivable). FIX: hold in 479; only realised differences hit P&L (§8.14). *Symptom: overstated profit and tax.*
10. **A 4731/706 line with no `dossier_id`.** FIX: analytical completeness is a hard reject (§23, rule 10). *Symptom: no per-dossier margin.*

## D.3 "Which account?" — 20-second decision guide
- **Money in before the work?** → 4191 (advance), never 706.
- **Paid for the client, recovered exactly, under mandate?** → 4731, no VAT.
- **Paid in our own name to re-bill (maybe with margin)?** → class 6 cost + class 7 revenue + VAT both sides.
- **Selling our own service (transport / commission / docs)?** → 706 + 4432.
- **Buying something lasting > 1 year?** → class 2 asset (then depreciate), not class 6.
- **Paying staff?** → 661/664 (expense) · 431/447 (owed to bodies) · 422 (net to staff).
- **A tax we collect for the State?** → class 4 liability (443 / 447 / 4441), never class 6.
- **A tax that is our own cost (patente, foncier, vignette)?** → 64 (expense).
- **Moving our own money between accounts?** → through 585.

---

*End of knowledge base.*
