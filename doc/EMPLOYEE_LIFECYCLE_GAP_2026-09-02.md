# Employee — creation to provisioned account

**Date:** 2 Sep 2026 · **Scope:** the whole path from "we have hired somebody" to
"they have a staff record a contract can be generated from, a file of their
papers, and a way to sign in." Audited against the legacy save endpoint and
against a real signed CDI.

## What I read

| Source | What it gave |
|---|---|
| `migrations/tenant/0300_masterdata.sql:50` + 6 later alters | the `employee` table as it stood: 20 columns |
| `client/src/features/hr/employee-360.tsx` | `NewEmployeeForm` — the seven-field modal |
| `client/src/features/security/users.tsx` | `UserForm` — provisioning, and which way the link ran |
| `doc/reference/legacy_codebase/administration/api/employees/save.php` | the payload the legacy system enforced |
| `…/api/employees/{pending_users,provision_pending_update}.php` | the legacy provisioning queue and its activation-token email |
| A signed *CONTRAT DE TRAVAIL* (SLAS/DAF/RH/254230) | the document this record has to be able to produce |

---

## 1. The defect all of it points at

A work contract is generated **from** the employee record. Article by article, the
one I read states:

```
SLAS/DAF/RH/254230
Mme FORMUM Epse FORGHAB Florence Ngwenjang, Née le 28 Février 1970 à NTAMBU
MUNDUM, Fille de FORMUM Isaac et de NJENG Onika, Titulaire de la CNI N° 101510674
délivrée le 03 février 2021 à CE54. Demeurant à Ndogbong Douala, et De
nationalité Camerounaise
…
Le matricule SLAS-137 lui est attribué.        Une période d'essai de 4 mois.
Salaire de base : 600,000  ·  Prime de responsabilité : 50,000  ·  Total : 650,000
Lieu de travail : Douala   ·  Du Lundi au Vendredi de 08h00 à 17h00
```

Of the facts in that block, the `employee` table could store **none**. Not the
civility, not the birth date or birth place, not either parent's name, not the
CNI number or where and when it was issued, not the residence, not the
nationality, not the matricule, not the probation term, not the place of work,
not the hours — and not the *prime*, because `base_salary` is one number and
`employee_earning` (0466) is per-period variable pay, so a standing allowance
had nowhere to live at all.

A generator reading that record could only produce a document with holes in it,
discovered at the moment somebody tried to print one.

## 2. The creation form asked for less than the schema could already hold

`NewEmployeeForm` collected seven fields: name, entity, department, job title,
line manager, email, employment type. The table already had `cnps_number`,
`base_salary`, `hired_on`, `phone_desk`, `phone_mobile`, `bank_block`,
`risk_class_rate`, `signatory_name`, `avatar_ref` and `is_driver` — ten columns
the form never mentioned, so the only way to populate them was the API.

## 3. Gaps against the legacy payload

`save.php` accepted, and we had nowhere to put: `address`, `nationality`,
`id_card_number`, `num_children`, `dob`, `marital_status`, `contract_reference`,
`payment_method`, `status` (its `PENDING` state), the avatar upload, and the
whole `employee_documents` table (CV / CONTRACT / ID_CARD / OTHER).

## 4. Nobody could see whether a person had a login

`app_user.employee_id` existed, and the only UI for it was a picker **on the user
form** — the link ran user → employee. An employee record could not answer "has
anyone provisioned this person?", so the question meant opening a different area
and searching. Legacy answered it with a bespoke `pending_users.php`.

Worse, `POST /users` required an administrator to type a password. That
credential is known to two people from the moment it exists, travels over
WhatsApp to reach its owner, and is usually never changed. Legacy did better: it
created the row with `must_set_password = 1` and mailed an activation token.

## 5. No document store, for the one population whose papers expire

`client_document`, `supplier_document` and `entity_document` (0511, 0516) all
carry a typed row with a number, an issuing authority, an issue date, an expiry,
a vault link and separate scan/verification states. Employees had nothing — so
"whose ID lapses this quarter" was unanswerable about the only people whose
documents actually lapse.

---

## What was built

| Gap | Fix |
|---|---|
| The contract's identification clause | `12763` — civility, gender, maiden name, DOB, birth place, both parents, nationality, marital status, dependants, ID type/number/issued-on/issued-at/expires-on, residence |
| Contact card | `12763` — WhatsApp, personal email, emergency contact (name / relationship / phone), alongside 12759's two phones |
| The terms a contract states | `12763` — probation months, place of work, working hours, payment method, salary currency |
| The matricule | `12763` — `employee.staff_no` + `employee_number_sequence`, allocated per entity from `corporate_entity.code` in one `INSERT … ON CONFLICT DO UPDATE … RETURNING`, never typed |
| "Hired, no login yet" vs "resigned in March" | `12763` — `employee.status` (PENDING / ACTIVE / SUSPENDED / TERMINATED). `is_active` stays, derived by a trigger, so every existing consumer is untouched |
| The staff file | `12764` — `employee_document`, the same shape as `entity_document`; `party_document_type.applies_to` learns `EMPLOYEE`, with 13 seeded types |
| The salary decomposition | `12765` — `employee_allowance`: dated, standing lines with `is_taxable` / `in_cnps_base` / `in_gross` recorded rather than inferred from a label |
| The seven-field modal | `employee-wizard.tsx` — three steps, a real `role="progressbar"`, every field present whether or not it can be filled today. Only the name blocks |
| Editing | `employee-360.tsx` — the same fields as sections, not steps. Both read one model (`employee-form-model.ts`) so they cannot drift |
| "Is this contract-ready?" | `employees.rules.contractReadiness` — one list, read by the wizard's meter, the dossier's panel, and (next) contract generation. `GET /employees/:id/readiness` and `/readiness-requirements` |
| The provisioning link | `Provision account` on the dossier → `/security/users?provision=<id>`. Only the id travels; the Users screen reads the record itself |
| Typed passwords | `POST /users` takes `invite: true` — a random hash nobody holds, plus a 72-hour single-use activation link, reusing `password_reset` (0471). `POST /users/:id/invite` re-sends |
| "Who has no login?" | A filter on the roster (`has_account`), not a bespoke endpoint — so it composes with entity, department and the rest |

### Deliberately not done

- **A scan does not gate creation.** 0516 states the rule and this follows it: a
  document may be recorded from paper with a `physical_ref`. Refusing to record a
  CNI you are holding because the scanner is down is how a register ends up
  incomplete, and an incomplete register is worse than an unscanned one. What
  refuses to run without the file is contract generation.
- **No partial save.** The wizard writes once, in one transaction across three
  tables. A half-written hire that looks whole is the state `status` exists to
  make visible, not to produce.
- **Allowances are not wired into payroll compute yet.** They are recorded,
  dated, and totalled into the gross the contract prints. Adding them to a
  payroll run is a payroll change, and belongs with it.

### Confidentiality

`employee.personal` joins `employee.salary` as a maskable `field_key`
(`shared/rbac/field-mask.js`): a payroll clerk needs a salary and has no business
with a parent's name or a home address. Nothing is masked until an administrator
says so on the Field visibility screen — the key becomes *available*, it does not
become *applied*. Allowance amounts are redacted at the two allowance endpoints
rather than through `FIELD_MAP`, because `amount` is a property name shared with
invoices, receipts and journal lines, and nulling it globally would blank half the
product for anybody masked on salary.
