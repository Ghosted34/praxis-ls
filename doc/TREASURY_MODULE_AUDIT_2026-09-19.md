# Treasury Module — Meeting 4 Allegations, Code Validation, and Required Work

**Date:** 2026-09-19  
**Scope:** Treasury only — Treasury accounts, Treasury categories, Treasury 360, bank/mobile-money reconciliation, petty-cash counts, Treasury CoA allocation, and directly related migrations/seeds.  
**Transcript status:** The complete Meeting 4 transcript was reviewed, including the raw transcript through the recording-end marker at **02:08:44**. This is not based only on Gemini’s summary.  
**Runtime status:** Targeted checks were executed after installing the root and client dependencies. Root Jest passed **6 suites / 137 tests** covering Treasury master rules, CoA defaults, reconciliation rules, reconciliation documents, and reconciliation statement documents. Client Vitest passed **3 Treasury suites / 18 tests** covering account editing, the Reconciliation tab, and cash counts. Treasury-related JavaScript files also passed `node --check`. These runs used Node `v22.22.3`; the repository declares Node `>=20 <21`, so the supported-Node run remains an acceptance gate. No browser E2E workflow, live database migration, live Treasury import, concurrency test, permission matrix, or production-data test was executed.

**Final audit confidence:** **97% engineering-evidence confidence across all 35 findings**. This rating combines complete-transcript review, source/migration/code-path verification, targeted unit/component tests, and implementation-location accuracy. It is an engineering confidence rating, not a statistical confidence interval and not runtime/QA sign-off. The remaining uncertainty is explicitly limited to behavior that requires the supported Node version, a tenant database, browser E2E workflows, live file imports, concurrency, permissions, or production data.

**Final cross-check performed:** the referenced Treasury client, service, repository, migration, seed, and reconciliation paths were checked against the checkout; all Treasury/Treasury-360/category/reconciliation JavaScript files passed `node --check`. No finding was upgraded to “Addressed” merely because its code path existed; existing foundations remain marked for targeted tests where integration behavior is still unverified.

## One-page action list — start here

The detailed validation follows this concise implementation list. Status: **Open** = work required; **Partial** = capability exists but is incomplete/unsafe; **Addressed** = foundation exists and needs only follow-up hardening.

**Dossier tab map:** `Overview` · `Statement` · `Reconciliation` · `Sub-account` · `Signatories` · `Documents` · `Timeline`. Bank reconciliation is the **Reconciliation** tab in `client/src/features/master/treasury/dossier.tsx`, rendered by `client/src/features/master/treasury/reconciliation-tab.tsx`. Cash counts are currently a workflow inside that same tab.

### Treasury account and 360

1. **[Open] Add Treasury Documents/RIB upload, view, replace, remove, expiry, and verification UI** — `client/src/features/master/treasury/dossier.tsx`, `src/modules/master/treasury-360.service.js`.
2. **[Partial] Connect document numbering, vault persistence, pending/failed states, expiry, and readiness** — Treasury document API/service plus existing vault patterns.
3. **[Open] Add Treasury account signatories, joint-signature rules, limits, and signature-card links** — `client/src/features/master/treasury/dossier.tsx`, `client/src/lib/treasury-api.ts`, Treasury account service/routes, and an additive tenant migration.
4. **[Open] Display timeline actor names instead of UUIDs** — `src/modules/master/treasury-360.service.js`, `client/src/features/master/treasury/dossier.tsx`.
5. **[Open] Add Treasury transaction reversal/void navigation linked to journal reversal** — `client/src/features/master/treasury/dossier.tsx`, `src/modules/finance/journal_entry/journal_entry.service.js`, `src/modules/finance/journal_entry/journal_entry.routes.js`.
6. **[Open] Implement real Treasury sub-accounts or rename/remove the misleading Sub-account tab** — `client/src/features/master/treasury/dossier.tsx`, `src/modules/master/treasury_account/treasury_account.service.js`, `migrations/tenant/0520_treasury_master_rich.sql`.
7. **[Open] Require bank identity and supporting evidence before marking a bank account verified** — `src/modules/master/treasury_account/treasury_account.service.js`, `src/modules/master/treasury_account/treasury_account.rules.js`.
8. **[Partial] Clear verification or require re-verification after sensitive account edits** — `src/modules/master/treasury_account/treasury_account.service.js`, `client/src/features/master/treasury/account-modal.tsx`.
9. **[Open] Add MoMo network and fee-account fields to create/edit UI and validate them** — `client/src/features/master/treasury/account-modal.tsx`, `src/modules/master/treasury_account/treasury_account.validator.js`, `src/modules/master/treasury_account/treasury_account.rules.js`.
10. **[Open] Separate bank-statement, cash-vault, petty-cash, and MoMo reconciliation modes** — `src/modules/master/treasury_category/treasury_category.service.js`, `client/src/features/master/treasury/reconciliation-tab.tsx`, `src/modules/master/reconciliation/reconciliation.service.js`.
11. **[Open] Add server-side Treasury search, filters, pagination, and load-more** — `client/src/features/master/treasury/index.tsx`, `src/modules/master/treasury_account/treasury_account.repo.js`, `src/modules/master/treasury_account/treasury_account.controller.js`.
12. **[Partial] Prevent deactivation of a primary account without replacement or explicit confirmation** — `src/modules/master/treasury_account/treasury_account.service.js`, `client/src/features/master/treasury/dossier.tsx`.
13. **[Partial] Add controlled opening-balance correction/adjustment workflow** — `src/modules/master/treasury_account/treasury_account.service.js`, `client/src/features/master/treasury/account-modal.tsx`, and `src/modules/finance/journal_entry/journal_entry.service.js`.
14. **[Open] Populate Treasury 360 `unreconciled_count`** — `src/modules/master/treasury-360.service.js`.
15. **[Open] Replace Treasury 360 `documents: []`, Signatories placeholder, and CoA-only sub-account stub** — `src/modules/master/treasury-360.service.js`, `client/src/features/master/treasury/dossier.tsx`.
16. **[Open] Make Statement lines and KPI totals use one consistent journal-status policy** — `src/modules/master/treasury-360.service.js`, `client/src/features/master/treasury/dossier.tsx`.
17. **[Open] Reduce sequential Treasury 360 queries and add measured indexes/rollups** — `src/modules/master/treasury-360.service.js`.

### Bank reconciliation

18. **[Addressed] Keep and test the existing CSV/Excel/PDF/CAMT.053/MT940 preview, mapping, duplicate, footing, matching, and approval workflow** — `client/src/features/master/treasury/reconciliation-tab.tsx`, `src/modules/master/reconciliation/`.
19. **[Partial] Disable import immediately when preview detects an exact duplicate file** — `client/src/features/master/treasury/reconciliation-tab.tsx`.
20. **[Open] Validate explicitly supplied statement profiles against entity, account, source kind, and layout** — `src/modules/master/reconciliation/reconciliation.service.js`, `src/modules/master/reconciliation/reconciliation.repo.js`.
21. **[Open] Validate manual matches for same account/entity, eligible status, currency, direction, and amount** — `src/modules/master/reconciliation/reconciliation.service.js`, `src/modules/master/reconciliation/reconciliation.repo.js`.
22. **[Open] Rebuild reconciliation totals inside the approval transaction** — `src/modules/master/reconciliation/reconciliation.service.js`.
23. **[Open] Add unmatched-bank-line → DRAFT journal-entry proposal and persist `proposed_entry_id`** — `src/modules/master/reconciliation/reconciliation.service.js`, `client/src/features/master/treasury/reconciliation-tab.tsx`, `migrations/tenant/10709_bank_reconciliation.sql`.
24. **[Partial] Add pagination/load-more for statements, statement lines, reconciliation periods, and cash counts** — `src/modules/master/reconciliation/reconciliation.repo.js`, `src/modules/master/reconciliation/reconciliation.service.js`, `client/src/lib/reconciliation-api.ts`.

### Cash counts and petty cash

25. **[Open] Restrict cash counts to cash-capable categories; currently any categorized account can pass the guard** — `src/modules/master/reconciliation/reconciliation.service.js`.
26. **[Open] Replace the XAF-only denomination grid with currency-specific denominations** — `client/src/features/master/treasury/cash-count-sheet.tsx`.
27. **[Open] Add witness selection and enforce designated-custodian attestation** — `client/src/features/master/treasury/cash-count-sheet.tsx`, `src/modules/master/reconciliation/reconciliation.service.js`, `migrations/tenant/10709_bank_reconciliation.sql`.
28. **[Open] Add cash-count approval, variance-to-DRAFT adjustment entries, and `adjustment_entry_id` linkage** — `src/modules/master/reconciliation/reconciliation.routes.js`, `src/modules/master/reconciliation/reconciliation.service.js`, `client/src/features/master/treasury/cash-count-sheet.tsx`, `migrations/tenant/10709_bank_reconciliation.sql`.
29. **[Open] Add same-day recount, correction, cancellation, and version history** — `src/modules/master/reconciliation/reconciliation.routes.js`, `src/modules/master/reconciliation/reconciliation.service.js`, `client/src/features/master/treasury/cash-count-sheet.tsx`.

### Treasury CoA and category integrity

30. **[Open] Repair postable Treasury parents in the CoA seeds, especially 571/5381/5382** — `migrations/seeds/9000_seed_coa.sql`, `migrations/seeds/9001_seed_coa_expansion.sql`, `migrations/seeds/9070_seed_treasury_master.sql`.
31. **[Open] Re-run `assertCoaParent()` during Treasury-account creation** — `src/modules/master/treasury_account/treasury_account.service.js`, `src/modules/master/treasury_account/treasury_account.rules.js`.
32. **[Open] Make next-leaf allocation concurrency-safe** — `src/modules/master/treasury_account/treasury_account.repo.js`, `src/modules/master/treasury_account/treasury_account.service.js`, and a database lock/allocator.
33. **[Open] Prevent category-parent changes from desynchronizing existing account leaves** — `src/modules/master/treasury_category/treasury_category.service.js`, `src/modules/master/treasury_category/treasury_category.repo.js`.
34. **[Open] Make 571/581 and all valid Treasury parents discoverable and understandable in the UI** — `client/src/features/master/treasury/new-category-modal.tsx`, `migrations/seeds/9000_seed_coa.sql`, `migrations/seeds/9001_seed_coa_expansion.sql`, `src/modules/master/treasury_category/treasury_category.rules.js`.
35. **[Open] Freeze or migrate category capability flags after accounts exist** — `src/modules/master/treasury_category/treasury_category.service.js`, `client/src/features/master/treasury/new-category-modal.tsx`, additive tenant migration/tests.

---

## PR split, parallel work, and merge order

### Recommendation

Split the implementation into **six feature PRs**. Each PR should carry its own migration notes, unit/service tests, and client tests; a separate test-only PR is not necessary. The existing reconciliation/import foundation in **#18 must be retained and tested, not rebuilt**.

Current status across the 35 findings: **28 Open, 6 Partial, 1 Addressed/retain-and-test**.

| PR | Scope | Audit items | Primary implementation locations | Dependency and parallelism |
|---|---|---:|---|---|
| **PR-01** | **Treasury foundation: CoA integrity, category safety, and sub-account decision** | **#6, #30–35** | `migrations/seeds/9000_seed_coa.sql`, `migrations/seeds/9001_seed_coa_expansion.sql`, `migrations/seeds/9070_seed_treasury_master.sql`; `src/modules/master/treasury_account/treasury_account.repo.js`; `src/modules/master/treasury_account/treasury_account.rules.js`; `src/modules/master/treasury_account/treasury_account.service.js`; `src/modules/master/treasury_category/treasury_category.service.js`; `client/src/features/master/treasury/dossier.tsx`; `client/src/features/master/treasury/new-category-modal.tsx` | Foundational PR. It can be developed in parallel with PR-02–PR-04 after the data-contract decision, but merge it first because the other PRs rely on valid category/CoA behavior. |
| **PR-02** | **Account identity and safety: verification, edits, MoMo, primary state, and reconciliation modes** | **#7–10, #12–13** | `src/modules/master/treasury_account/treasury_account.service.js`; `src/modules/master/treasury_account/treasury_account.rules.js`; `src/modules/master/treasury_account/treasury_account.validator.js`; `client/src/features/master/treasury/account-modal.tsx`; `client/src/features/master/treasury/reconciliation-tab.tsx`; **a new additive tenant migration** (do not edit already-applied `migrations/tenant/0520_treasury_master_rich.sql`) | Can be developed in parallel with PR-01, PR-03, and PR-04. Merge after PR-01 so it consumes the corrected category/CoA contract. |
| **PR-03** | **Documents and signatories** | **#1–3 and the document/signatory part of #15** | `client/src/features/master/treasury/dossier.tsx`; `client/src/lib/treasury-api.ts`; `src/modules/master/treasury-360.service.js`; new Treasury document/signatory service/repository/routes; an additive tenant migration using existing document-vault conventions | Independent enough to develop in parallel with PR-01, PR-02, and PR-04. Reserve the Documents and Signatories tab ownership for this PR; merge before PR-06. |
| **PR-04** | **Reconciliation tab: statement import, matching, approval, history, and proposed entries** | **#18–24** | `src/modules/master/reconciliation/reconciliation.service.js`; `src/modules/master/reconciliation/reconciliation.repo.js`; `src/modules/master/reconciliation/reconciliation.routes.js`; `src/modules/master/reconciliation/reconciliation.validator.js`; `client/src/features/master/treasury/reconciliation-tab.tsx`; `client/src/lib/reconciliation-api.ts`; `migrations/tenant/10709_bank_reconciliation.sql` | Can be developed in parallel with PR-01 and PR-03; align its account/entity/category contract with PR-02. Merge before PR-05 and before final PR-06 integration. |
| **PR-05** | **Reconciliation tab: cash-count and petty-cash controls** | **#25–29** | `src/modules/master/reconciliation/reconciliation.service.js`; `src/modules/master/reconciliation/reconciliation.repo.js`; `src/modules/master/reconciliation/reconciliation.routes.js`; `src/modules/master/reconciliation/reconciliation.validator.js`; `client/src/features/master/treasury/cash-count-sheet.tsx`; `client/src/lib/reconciliation-api.ts`; an additive tenant migration | Safest to merge after PR-04 because both use reconciliation service/repository/schema surfaces. Development can proceed in parallel only if the files and migration ownership are partitioned deliberately. |
| **PR-06** | **Treasury 360 and dossier integration: readable history, reversal navigation, list UX, KPIs, status consistency, and performance** | **#4–5, #11, #14, #16–17 plus integration of #6 and #15** | `src/modules/master/treasury-360.service.js`; `client/src/features/master/treasury/dossier.tsx`; `client/src/features/master/treasury/index.tsx`; `client/src/lib/treasury-api.ts`; `src/modules/finance/journal_entry/journal_entry.service.js`; `src/modules/finance/journal_entry/journal_entry.routes.js`; `src/modules/finance/journal_entry/journal_entry.controller.js` | Final integration PR. Develop after the read/write contracts are agreed; it can be developed in parallel with PR-05, but merge after PR-03/PR-04 and preferably after PR-05 so all seven tabs show the final state. |

### Recommended execution order

1. **PR-01** — repair and protect the Treasury CoA/category foundation.
2. **PR-02** — make account identity, verification, editing, and category capabilities safe.
3. **PR-03 and PR-04 in parallel** — build Documents/Signatories and harden the Reconciliation tab as separate workstreams.
4. **PR-05** — complete cash counts inside the Reconciliation tab.
5. **PR-06** — wire the finished data into Treasury 360, timeline, list UX, KPIs, and reversal navigation.
6. Run the final acceptance gate below before calling Treasury complete.

### What can run in parallel

- **Development Wave 1:** PR-01, PR-02, PR-03, and PR-04 can be worked on concurrently after the team freezes the schema/API contracts. They should have separate ownership of migrations and UI surfaces to avoid merge conflicts.
- **Development Wave 2:** PR-05 and PR-06 can be worked on concurrently once PR-04’s reconciliation response/status contract is agreed. Merge PR-05 before PR-06 if PR-06 consumes its final cash-count/KPI shape.
- **Do not parallelize the merge of shared reconciliation files** without rebasing: PR-04 and PR-05 both affect `src/modules/master/reconciliation/` and `client/src/lib/reconciliation-api.ts`.

### Acceptance gate required before raising confidence from static audit to runtime sign-off

- Install the repository and client dependencies, then run the targeted root Jest and client Vitest suites, including `tests/unit/treasury-master-rich.test.js`, `tests/unit/reconciliation-rules.test.js`, `tests/unit/reconciliation-documents.test.js`, `tests/unit/reconciliation-statement-document.test.js`, `client/src/features/master/treasury/account-edit.test.tsx`, `client/src/features/master/treasury/reconciliation-tab.test.tsx`, and `client/src/features/master/treasury/cash-count-sheet.test.tsx`.
- Apply the Treasury migrations and seeds to both a fresh tenant and an existing tenant; verify repair behavior for `571`, `5381`, `5382`, `5711`, and `581`.
- Exercise all seven dossier tabs in a browser: Overview, Statement, Reconciliation, Sub-account, Signatories, Documents, and Timeline.
- Import and reconcile representative CSV, Excel, PDF, CAMT.053, and MT940 statements; test duplicate files, duplicate lines, bad footing, mapping profiles, manual matches, approval races, and unmatched-line DRAFT proposals.
- Test cash counts for bank-account rejection, petty-cash acceptance, non-XAF denominations, witness/custodian rules, variance adjustments, recount/cancellation, and document issuance.
- Test concurrent Treasury-account creation under one CoA parent, category-parent changes after accounts exist, primary-account deactivation, verification invalidation, permissions, and measured Treasury 360 query latency.

---

## How to read the detailed validation

- **Open** — the allegation is confirmed or materially supported by the code and requires work.
- **Partial** — some of the requested capability exists, but the workflow is incomplete or unsafe.
- **Addressed** — the original allegation is substantially handled in the current code; only follow-up hardening may remain.
- **Design decision** — the behavior is deliberate, but it may still need a product decision if the business requirement is different.

Each detailed item states:

1. the allegation or issue raised;
2. what the codebase currently does;
3. what needs to be done;
4. the relevant implementation locations.

---

## A. Treasury account 360 and account-master UI

### 1. Add a bank-document attachment workflow to the Treasury Documents tab

**Status: Open**

**Allegation:** The meeting identified that users could not add the bank RIB, bank mandate, KYC letter, signature card, or similar bank evidence from the Treasury account dossier.

**Code validation:** `client/src/features/master/treasury/dossier.tsx` renders the Documents tab as an empty state. It has no add/upload action. The Treasury 360 response currently returns `documents: []` from `src/modules/master/treasury-360.service.js`.

**Required work:**

- Add an **Add document** action to the Documents tab in the actual Treasury dossier component:
  - `client/src/features/master/treasury/dossier.tsx`
- Define Treasury document types, at minimum:
  - Bank RIB / bank-account confirmation;
  - bank mandate;
  - KYC/identity document;
  - signature card;
  - account-opening letter;
  - other supporting Treasury document.
- Add an upload/link flow using the existing document-vault conventions rather than inventing a second file-storage path.
- Persist document metadata against the treasury account, including:
  - document type;
  - title or label;
  - document number where applicable;
  - issue date;
  - expiry date where applicable;
  - source/provenance;
  - vault document ID;
  - uploaded/replaced/removed actor;
  - verification status.
- Add replace, remove, download/view, and retry behavior.
- Show pending/failed uploads instead of silently leaving an incomplete record.
- Add the corresponding read/write service, repository, controller, route, validator, and migration if the existing document-vault relation cannot support the association directly.
- Add client and service tests.

**Relevant files:**

- `client/src/features/master/treasury/dossier.tsx`
- `src/modules/master/treasury-360.service.js`
- `src/modules/master/treasury_account/treasury_account.routes.js`
- `src/modules/master/treasury_account/treasury_account.controller.js`
- `src/modules/master/treasury_account/treasury_account.service.js`
- `src/modules/master/treasury_account/treasury_account.repo.js`
- `client/src/lib/treasury-api.ts`
- Existing document-vault services and `migrations/tenant/0516_corporate_entity_documents_tax.sql` as implementation references.

**Acceptance criteria:** A Treasury user can attach a RIB to a bank account, see it in the Documents tab, replace it, and identify who uploaded and verified it. A failed upload is visible and retryable.

---

### 2. Link document persistence, numbering, expiry, and readiness into one visible workflow

**Status: Partial**

**Allegation:** The meeting raised concern that document-number allocation and file upload were separate and that expiry handling was disconnected from document persistence.

**Code validation:** Treasury currently has no document workflow. In the related entity document flow, document rows can receive a number before the vault upload is complete, and failed uploads remain for retry. The same risk must not be copied into Treasury without explicit pending/failed states.

**Required work:**

- Decide whether a Treasury document number is allocated:
  - only after a successful vault capture; or
  - at creation time with an explicit `PENDING_UPLOAD` state.
- Make the state visible in the Treasury dossier.
- Connect expiry to readiness and verification:
  - expired RIB/KYC/mandate should affect readiness;
  - replacing an expired document should clear the corresponding readiness warning;
  - deleting the only valid document should restore the warning.
- Add an audit trail for upload, replacement, verification, expiry, and removal.
- Ensure an incomplete upload cannot appear as valid evidence.

**Relevant files:** Treasury document implementation from item 1 plus existing vault/document lifecycle services.

---

### 3. Implement real Treasury signatories and account-signature controls

**Status: Open**

**Allegation:** The meeting asked about account signatures and signature cards.

**Code validation:** The Signatories tab in `client/src/features/master/treasury/dossier.tsx` is an explicit “coming soon” state. No Treasury account signatory API is exposed.

**Required work:**

- Add signatories to the Treasury account 360.
- Support:
  - person/user or external signatory identity;
  - primary versus joint signatory;
  - single-signature and joint-signature rules;
  - monetary limits;
  - effective dates;
  - active/inactive status;
  - evidence document link;
  - appointment/removal audit.
- Add a signature-card document link under Documents.
- Add a clear relationship between account verification and signatory verification.
- Prevent a signatory from being displayed as active after removal or expiry.

**Relevant files:**

- `client/src/features/master/treasury/dossier.tsx`
- `src/modules/master/treasury-360.service.js`
- Treasury account routes/controller/service/repository
- Existing user, signature, document, and approval patterns elsewhere in the repository.

---

### 4. Replace actor UUIDs in the Treasury timeline with human-readable actors

**Status: Open**

**Allegation:** The account timeline showed a UUID instead of the user’s name.

**Code validation:** The timeline query in `src/modules/master/treasury-360.service.js` now correctly reads from `immutable_ledger` rather than the nonexistent `audit_log`, but returns `actor_user_id`. The client renders that value directly:

- `src/modules/master/treasury-360.service.js`
- `client/src/features/master/treasury/dossier.tsx`

**Required work:**

- Join `immutable_ledger.actor_user_id` to `app_user` in the timeline query.
- Return a safe display shape such as:
  - `actor_user_id`;
  - `actor_name`;
  - `actor_email` or role where appropriate.
- Render the name in the UI and retain the ID for audit/debugging.
- Render a clear “System” or “Unknown actor” label when the actor is null or cannot be resolved.
- Add a test for named actor, null actor, and missing actor.

**Acceptance criteria:** The Timeline tab displays “Jane Doe” or “System,” never only an opaque UUID.

---

### 5. Add Treasury-specific transaction reversal/void navigation

**Status: Open**

**Allegation:** The meeting asked how to reverse an incorrect Treasury transaction.

**Code validation:** Treasury displays recent journal lines but has no reversal or void action in:

- `client/src/features/master/treasury/dossier.tsx`
- `src/modules/master/treasury_account/treasury_account.routes.js`
- `src/modules/master/treasury_account/treasury_account.service.js`

There is no Treasury-specific link into the journal reversal workflow.

**Required work:**

- Decide whether reversal is:
  - a Treasury endpoint delegating to the journal-reversal service; or
  - a link to the existing journal-entry reversal screen.
- Add a reversal action to eligible statement/journal lines.
- Do not allow direct mutation or deletion of posted journal lines.
- Require a reason and confirmation.
- Display the reversal relationship from the original line and the reversal entry.
- Refresh Treasury KPIs and reconciliation state after reversal.
- Ensure a reversed line cannot continue to appear as a valid reconciled posting.
- Add permission and audit coverage.

---

### 6. Build a real Treasury sub-account hierarchy, or explicitly remove the misleading tab

**Status: Open**

**Allegation:** The meeting was uncertain whether Treasury supported sub-accounts.

**Code validation:** The current “Sub-account” tab is only a display of the account’s auto-minted CoA leaf. It does not support child Treasury accounts or a parent/child Treasury hierarchy. The service documentation says one Treasury account owns one leaf.

**Required work:**

- Make a product decision:
  - implement true Treasury sub-accounts; or
  - rename the tab to “CoA leaf” and remove the implication that Treasury sub-accounts exist.
- If implementing hierarchy, add:
  - `parent_treasury_account_id` or an equivalent relation;
  - child creation and editing;
  - parent/child validation and cycle prevention;
  - child rollups in Treasury 360;
  - hierarchy-aware primary-account rules;
  - reconciliation behavior at parent and child level;
  - document and signatory inheritance rules.
- Do not confuse a child CoA leaf with a child Treasury account.

**Relevant files:**

- `client/src/features/master/treasury/dossier.tsx`
- `src/modules/master/treasury-360.service.js`
- `src/modules/master/treasury_account/treasury_account.service.js`
- `src/modules/master/treasury_account/treasury_account.repo.js`
- `migrations/tenant/0520_treasury_master_rich.sql`

---

### 7. Enforce bank identity requirements at verification

**Status: Open**

**Allegation:** A verified account should represent an account checked against a bank letter/RIB, not merely a row someone typed.

**Code validation:** The migration comment says bank identity should be requested at verification, but `verify()` only stamps `is_verified`, `verified_by`, and `verified_at`. It does not check bank name, account number, IBAN, SWIFT/BIC, holder, or a supporting document.

**Required work:**

- Add category-aware verification rules.
- For bank categories, require the minimum agreed bank identity fields before verification.
- Require or strongly associate a verified RIB/bank-document record.
- For MoMo categories, require the agreed network and wallet identity fields.
- For petty cash, require custodian/location/float controls.
- Return field-level validation errors rather than allowing a generic verification stamp.
- Add tests for incomplete and complete verification.

**Relevant files:**

- `src/modules/master/treasury_account/treasury_account.service.js`
- `src/modules/master/treasury_account/treasury_account.rules.js`
- `src/modules/master/treasury_account/treasury_account.validator.js`
- `client/src/features/master/treasury/account-modal.tsx`
- `client/src/features/master/treasury/dossier.tsx`
- `migrations/tenant/0520_treasury_master_rich.sql`

---

### 8. Invalidate or require re-verification after sensitive account edits

**Status: Partial**

**Allegation:** Editing verified account identity or opening data should not leave a verified badge that users may trust without rechecking.

**Code validation:** The client warns that changing a verified account does not clear the stamp. The backend leaves `is_verified = true` after edits.

**Required work:**

- Decide whether sensitive edits automatically clear verification or create a `REVERIFICATION_REQUIRED` state.
- At minimum, edits to these fields should invalidate verification:
  - account number;
  - IBAN;
  - SWIFT/BIC;
  - holder;
  - bank/branch;
  - MoMo identity;
  - custodian;
  - opening balance/date.
- Preserve the prior verification event in audit history.
- Make the UI distinguish:
  - verified current data;
  - edited after verification;
  - reverified data.

---

### 9. Add missing MoMo network and fee-account controls to the account modal

**Status: Open**

**Allegation:** The meeting asked for complete mobile-money account fields.

**Code validation:** The API and types support `momo_network` and `momo_fee_account`, but `client/src/features/master/treasury/account-modal.tsx` has no state or controls for them. The dossier displays the fee CoA but cannot edit it.

**Required work:**

- Add MoMo network control, preferably a controlled list tied to the category/provider.
- Add MoMo fee-account control using a validated class-6/postable account picker.
- Include both fields in create and edit bodies.
- Make network required for a MoMo category.
- Validate that the fee account exists and is a suitable class-6 account, not only that its code starts with `6`.
- Display the values in the dossier and readiness checklist.
- Add migration/data repair for existing MoMo accounts with missing network values.

**Relevant files:**

- `client/src/features/master/treasury/account-modal.tsx`
- `client/src/features/master/treasury/dossier.tsx`
- `client/src/lib/treasury-api.ts`
- `src/modules/master/treasury_account/treasury_account.validator.js`
- `src/modules/master/treasury_account/treasury_account.rules.js`
- `src/modules/master/treasury_account/treasury_account.service.js`
- `migrations/tenant/0230_treasury_invoicing.sql`
- `migrations/seeds/9070_seed_treasury_master.sql`

---

### 10. Separate bank, cash-vault, petty-cash, and MoMo reconciliation modes

**Status: Open**

**Allegation:** The meeting raised uncertainty about petty cash versus cash vault handling.

**Code validation:** The client chooses the cash-count workflow only when `requiresCustodian` is true. The seeded `CASH` category does not require a custodian, so it follows the bank-statement reconciliation path. The backend cash-count guard is also incorrect and allows any categorized account.

**Required work:**

- Define an explicit reconciliation mode/capability on Treasury categories, for example:
  - `BANK_STATEMENT`;
  - `CASH_COUNT`;
  - `MOMO_STATEMENT`;
  - `OTHER_EXTERNAL_STATEMENT`.
- Do not use `requires_custodian` as a proxy for reconciliation type.
- Decide whether “Cash” means:
  - a cash vault requiring a physical count;
  - a cash clearing account with a statement;
  - a broad category requiring subtypes.
- Make the client route each category to the correct workflow.
- Make the backend enforce the same category capability.
- Add readiness and labels that explain why a particular reconciliation workflow is shown.

---

### 11. Fix Treasury account-list pagination and server-side search

**Status: Open**

**Allegation:** The Treasury list/search experience may not work beyond the first page.

**Code validation:**

- `client/src/features/master/treasury/index.tsx` calls `useList("/treasury-accounts")` without pagination parameters.
- `src/modules/master/treasury_account/treasury_account.repo.js` applies generic page limits.
- Search and category filtering happen only in the client over the loaded rows.

**Required work:**

- Add server-side query parameters for:
  - search text;
  - category;
  - entity;
  - kind;
  - active state;
  - verification state;
  - primary state.
- Return pagination metadata or cursor information.
- Add pagination/load-more controls to the Treasury list.
- Debounce search and cancel stale requests.
- Ensure category counts are based on the full filtered result set, not only the current page.
- Add an index strategy for common search/filter columns.

**Relevant files:**

- `client/src/features/master/treasury/index.tsx`
- `client/src/lib/treasury-api.ts`
- `src/modules/master/treasury_account/treasury_account.repo.js`
- `src/modules/master/treasury_account/treasury_account.service.js`
- `src/modules/master/treasury_account/treasury_account.controller.js`

---

### 12. Make primary-account state safe when deactivating an account

**Status: Partial**

**Allegation:** The meeting asked about primary-account controls.

**Code validation:** Atomic “set primary” exists and clears the old primary. However, the active-state endpoint allows a primary account to be deactivated, and there is no replacement or explicit clear-primary behavior.

**Required work:**

- Prevent deactivation of the current primary unless:
  - another active account is selected; or
  - the user explicitly confirms that the category will have no primary.
- Decide whether a category must always have an active primary.
- Add a database/service invariant if required.
- Add a visible primary-management action rather than relying only on “set another account primary.”
- Add tests for concurrent primary changes and primary deactivation.

**Already addressed:** `POST /treasury-accounts/:id/primary` is transactional and atomically replaces the previous primary.

---

### 13. Add proper account-correction controls for opening balances

**Status: Partial**

**Allegation:** The meeting raised whether opening balances could be edited.

**Code validation:** They can be edited directly through PATCH, but the change does not produce a balancing journal entry. Treasury 360 computes balance as opening balance plus validated journal movement.

**Required work:**

- Decide whether an opening balance is editable after the account has posted activity.
- If editable, require:
  - reason;
  - effective date;
  - approval where material;
  - audit detail;
  - optional adjustment journal entry.
- If accounting integrity requires it, make the original opening balance immutable after first posting and provide an adjustment workflow instead.
- Show the opening-balance revision history in Treasury 360.
- Add a warning when changing an opening balance that already contributes to a non-zero account balance.

---

## B. Treasury 360 data and performance

### 14. Populate Treasury 360’s reconciliation KPI

**Status: Open**

**Allegation:** Treasury 360 should show reconciliation state/count.

**Code validation:** `src/modules/master/treasury-360.service.js` returns:

```js
unreconciled_count: null
```

The client type explicitly allows `number | null`, and the KPI is not populated.

**Required work:**

- Define the meaning of the KPI:
  - unmatched statement lines;
  - unreconciled statements;
  - open reconciliation periods;
  - or a combined count.
- Query the reconciliation tables using the account ID.
- Display the count with a link to the Reconciliation tab.
- Distinguish “none,” “not calculated,” and “reconciliation unavailable.”
- Add tests for no statements, fully matched statements, unmatched lines, and approved periods.

---

### 15. Replace Treasury 360 document/signatory/sub-account stubs with real data

**Status: Open**

This consolidates the missing 360 collections:

- `documents: []`;
- Signatories placeholder;
- CoA-leaf-only Sub-account tab.

**Required work:** Implement the workflows described in items 1, 3, and 6, then update:

- `src/modules/master/treasury-360.service.js`;
- `client/src/lib/treasury-api.ts`;
- `client/src/features/master/treasury/dossier.tsx`.

The API should return structured collections rather than generic empty arrays so the client can distinguish “not loaded,” “none,” and “not supported.”

---

### 16. Make Treasury statement lines and KPIs use the same journal-status rule

**Status: Open**

**Allegation:** Treasury balances should agree with the statement displayed in the account 360.

**Code validation:**

- `_balance()` and monthly KPI queries filter to `je.status = 'validated'`.
- `_recentLines()` does not filter status.
- The Statement tab can display lines excluded from KPI totals.

**Required work:**

- Decide whether the Statement tab is:
  - validated/postable activity only; or
  - all activity with explicit status.
- Prefer a consistent query contract.
- If all statuses remain visible, label them clearly and explain why drafts/reversals are excluded from totals.
- Ensure last debit/last credit follow the same status policy.
- Add tests for draft, validated, reversed, and cancelled entries.

---

### 17. Reduce the number of sequential Treasury 360 queries

**Status: Open performance concern**

**Code validation:** `src/modules/master/treasury-360.service.js` performs many sequential queries on one request.

**Required work:**

- Profile the endpoint using realistic journal volume.
- Consolidate compatible aggregates into fewer SQL queries or a view/materialized rollup.
- Add account/date indexes for balance and movement queries.
- Avoid recalculating all historical movement data on every tab load if the UI only needs one tab.
- Consider separate lazy-loaded endpoints for:
  - overview/KPIs;
  - statements;
  - reconciliation;
  - documents;
  - timeline.
- Preserve a single-call option only if measured performance is acceptable.

---

## C. Bank-statement import and reconciliation

### 18. Preserve the implemented bank-statement import capability

**Status: Addressed, with follow-up items**

**Allegation:** The meeting asked for bank-statement PDF/CSV/Excel import and reconciliation.

**Code validation:** The current implementation supports:

- CSV;
- Excel/XLSX/XLSM;
- PDF;
- CAMT.053;
- MT940;
- preview before persistence;
- mapping confirmation;
- duplicate detection;
- footing checks;
- matching and sign-off.

The client exposes this in `client/src/features/master/treasury/reconciliation-tab.tsx`.

**Required follow-up:** Do not rebuild the importer. Complete the integrity and UX work in items 19–24 below and execute real format fixtures once dependencies are available.

---

### 19. Disable the import action when the exact file was already imported

**Status: Partial**

**Code validation:** The backend correctly rejects an exact duplicate file in `importStatement()`. The preview UI can still show a warning while leaving the import action available, causing a predictable 409 after submission.

**Required work:**

- Disable the import button when `preview.already_imported` is present.
- Link to or select the existing statement.
- Explain that re-uploading the same file is not needed.
- Keep the backend duplicate gate as the authoritative protection.

**Relevant files:**

- `client/src/features/master/treasury/reconciliation-tab.tsx`
- `src/modules/master/reconciliation/reconciliation.service.js`
- `src/modules/master/reconciliation/reconciliation.repo.js`

---

### 20. Validate statement-profile overrides against the target account and source

**Status: Open integrity issue**

**Code validation:** Normal profile discovery uses entity/source kind/header signature. However, when an explicit `statement_profile_id` is supplied, the service loads the profile without fully checking that it belongs to:

- the current entity;
- the current Treasury account’s source kind;
- the current institution/layout context.

**Required work:**

- Validate explicit profile ownership and applicability before import.
- Reject a profile from another entity or incompatible source kind.
- Include account/entity/source constraints in the profile query or service guard.
- Add tests for valid and cross-entity/profile misuse.

---

### 21. Harden manual reconciliation matching

**Status: Open integrity issue**

**Code validation:** `manualMatch()` loads the statement line but does not independently validate the supplied journal line’s:

- Treasury account;
- entity;
- journal-entry status;
- currency;
- eligibility for reconciliation.

It only checks whether the journal line already has a confirmed match.

**Required work:**

- Load and validate the journal line before inserting a match.
- Require the same Treasury account and entity.
- Require an eligible validated/posted journal entry status.
- Validate amount/direction/currency compatibility or require an explicit reason for an exception.
- Keep the database uniqueness guard.
- Add negative tests for cross-account, cross-entity, draft, reversed, and already matched lines.

---

### 22. Rebuild reconciliation totals immediately before approval

**Status: Open integrity issue**

**Code validation:** `approveReconciliation()` trusts the stored `unexplained_difference` and related totals. It does not recalculate the current matching state before approval.

**Required work:**

- Rebuild or verify the reconciliation totals inside the approval transaction.
- Lock the reconciliation and relevant match rows while approving.
- Reject approval if current matches differ from the stored working paper.
- Regenerate the content hash from the final verified totals.
- Add a test where a match changes after build but before approval.

---

### 23. Implement the proposed-entry workflow for unmatched bank lines

**Status: Open**

**Allegation:** The meeting expected unmatched bank charges, interest, receipts, and similar items to be proposed for ledger entry rather than left unaddressed.

**Code validation:** `bank_statement_line.proposed_entry_id` exists in `migrations/tenant/10709_bank_reconciliation.sql`, but the service does not populate it and the UI does not provide a propose/post action.

**Required work:**

- Add a “Propose journal entry” action for eligible unmatched lines.
- Create a DRAFT journal entry through the ordinary posting path.
- Store the resulting entry ID in `proposed_entry_id`.
- Show draft status and link to the journal approval workflow.
- Prevent duplicate proposals for the same statement line.
- Recalculate reconciliation after the draft is approved/posted.
- Keep reconciliation separate from ledger posting: reconciliation may propose, but must not silently post.

---

### 24. Add clearer reconciliation history and pagination

**Status: Partial**

**Code validation:** Statement and reconciliation list endpoints have limits and offsets, but the Treasury UI does not provide a complete pagination/load-more experience for all statement and reconciliation collections.

**Required work:**

- Add visible pagination or load-more controls for:
  - imported statements;
  - statement lines;
  - reconciliation periods;
  - cash counts.
- Preserve selected statement when loading another page.
- Display total/loaded counts.
- Make period status and approval state clear.

---

## D. Cash counts and petty-cash controls

### 25. Restrict cash counts to cash-capable Treasury categories

**Status: Open bug**

**Code validation:** `recordCashCount()` currently rejects only when both conditions are false:

```js
if (!account.requires_custodian && !account.category_code) {
  throw ...;
}
```

Any account with a category, including a bank account, can therefore pass the guard.

**Required work:**

- Add an explicit category/account capability check.
- Require a cash-count capability or a cash/petty-cash category.
- Reject BANK and MoMo accounts unless a deliberate category configuration says they support physical counts.
- Add backend tests for BANK, CASH, PETTY_CASH, and MoMo categories.

**Relevant files:**

- `src/modules/master/reconciliation/reconciliation.service.js`
- `src/modules/master/reconciliation/reconciliation.validator.js`
- `src/modules/master/treasury_category/treasury_category.service.js`
- `client/src/features/master/treasury/reconciliation-tab.tsx`

---

### 26. Replace the hard-coded XAF denomination grid

**Status: Open limitation**

**Code validation:** `client/src/features/master/treasury/cash-count-sheet.tsx` uses the constant `XAF_DENOMINATIONS` regardless of the account currency.

**Required work:**

- Add a currency-denomination catalogue or tenant-configurable denomination list.
- Load denominations from the account currency.
- Support zero-decimal and non-XAF currencies.
- Show a controlled fallback when no denomination catalogue exists.
- Ensure the server recomputes totals from the submitted denominations and does not trust client totals.
- Add tests for XAF and at least one non-XAF currency.

---

### 27. Add witness selection and enforce designated-custodian attestation

**Status: Open**

**Code validation:** The API accepts `witness_user_id`, but the client does not provide witness selection. The attestation service sets the custodian to the configured custodian or the actor; it does not require that the actor is the designated custodian.

**Required work:**

- Add custodian and witness display/selection to the count flow.
- Require the designated custodian to attest, or implement a documented delegated-attestation rule.
- Prevent an arbitrary user from becoming the custodian merely by clicking Attest.
- Store the actual attester separately from the designated custodian.
- Display:
  - counted by;
  - designated custodian;
  - attested by;
  - witness;
  - approval state.
- Add database/service constraints for the attestation rule.

---

### 28. Add cash-count approval and variance-to-DRAFT adjustment workflow

**Status: Open**

**Code validation:** The schema has `APPROVED_LOCKED`, `approved_by`, `approved_at`, and `adjustment_entry_id`, but the service/routes/client only support DRAFT → ATTESTED and document issuance.

**Required work:**

- Add a separate approval route and permission.
- Require explanation for non-zero variance, as currently implemented.
- Add “Propose adjustment” to create a DRAFT journal entry.
- Store `adjustment_entry_id`.
- Allow the normal journal approval chain to post the adjustment.
- Lock the count after approval.
- Prevent editing an approved count.
- Show the adjustment entry and resulting reconciliation state.

---

### 29. Add correction/recount/cancellation behavior for same-day counts

**Status: Open**

**Code validation:** `ux_cash_count_day` permits one non-cancelled count per account/day, but there is no update, recount, or cancellation endpoint in the Treasury UI/API.

**Required work:**

- Add an explicit correction/recount workflow.
- Decide whether a correction:
  - updates the DRAFT row;
  - cancels and replaces it;
  - creates a new version.
- Preserve the original count and reason for change.
- Permit a new count only after the prior count is cancelled or superseded according to policy.
- Add tests for duplicate same-day counts and corrected counts.

---

## E. Treasury CoA hierarchy and allocation

### 30. Repair invalid postable-parent seed data

**Status: Open data-integrity issue**

**Allegation:** The meeting raised missing/incorrect class-5 Treasury accounts and uncertainty around accounts such as 571 and 581.

**Code validation:**

- `migrations/seeds/9000_seed_coa.sql` marks `571`, `5381`, and `5382` as postable.
- `migrations/seeds/9070_seed_treasury_master.sql` uses those codes as Treasury parents.
- Treasury parents must be non-postable if child Treasury leaves are to be allocated beneath them.

**Required work:**

- Decide the canonical OHADA hierarchy for:
  - bank accounts;
  - cash vaults;
  - petty cash;
  - mobile-money accounts;
  - imprest/advance accounts such as 581.
- Repair the existing rows with an explicit corrective seed/migration, not `ON CONFLICT DO NOTHING`.
- Ensure every Treasury category parent is:
  - class 5;
  - non-postable;
  - active;
  - present before category/account creation.
- Preserve historical journal references when changing postability or hierarchy.
- Add a verification script that reports invalid Treasury parents per tenant.

**Relevant files:**

- `migrations/seeds/9000_seed_coa.sql`
- `migrations/seeds/9001_seed_coa_expansion.sql`
- `migrations/seeds/9070_seed_treasury_master.sql`
- `src/modules/master/treasury_account/treasury_account.rules.js`
- `src/modules/master/treasury_category/treasury_category.rules.js`

---

### 31. Validate the CoA parent again during account creation

**Status: Open bug**

**Code validation:** Treasury category creation validates the CoA parent, but treasury-account creation does not call `assertCoaParent()` before allocating a leaf.

**Required work:**

- Load the parent row from `category.coa_parent_code` during account creation.
- Call the parent validator before beginning allocation.
- Reject missing, wrong-class, postable, inactive, or invalid parents.
- Add a test using the currently problematic seeded parents.

**Relevant files:**

- `src/modules/master/treasury_account/treasury_account.service.js`
- `src/modules/master/treasury_account/treasury_account.rules.js`
- `src/modules/master/treasury_account/treasury_account.repo.js`

---

### 32. Make CoA leaf allocation concurrency-safe

**Status: Open bug**

**Code validation:** `existingLeavesUnder()` reads existing child codes, `nextLeafCode()` calculates the next code, and the service inserts it. There is no lock or retry around the read/allocate/insert sequence.

**Required work:**

- Use one of:
  - advisory lock keyed by tenant and parent code;
  - row lock on the parent CoA row;
  - database sequence/allocator table;
  - unique-conflict retry inside the account transaction.
- Keep the allocation and Treasury-account insert atomic.
- Add a concurrency test creating multiple accounts under the same parent.
- Preserve the no-orphan guarantee if one write fails.

---

### 33. Prevent category-parent changes from desynchronizing existing accounts

**Status: Open bug**

**Code validation:** `src/modules/master/treasury_category/treasury_category.service.js` allows a custom category’s `coa_parent_code` to change after accounts exist. Existing leaves remain under the old parent.

**Required work:**

- Block parent changes once the category has Treasury accounts or posted journal activity; or
- implement an explicit migration/reclassification workflow that handles existing leaves and journals safely.
- At minimum, show usage count and require elevated confirmation before changing a category’s parent.
- Add audit detail showing old/new parent and affected account count.
- Add tests for unused versus used categories.

---

### 34. Make 571/581 and Treasury parent choices understandable in the UI

**Status: Open UX/data-model issue**

**Allegation:** Users could not clearly find or understand the relevant class-5 accounts, including 571/581.

**Code validation:** 571 and 581 groupings exist in the CoA seed, but 581 is not exposed as a default Treasury category or clear parent choice. The default Treasury categories use 571, 5711, 5381, and 5382, some of which currently have the postability conflict described above.

**Required work:**

- Establish the canonical Treasury category-to-CoA mapping.
- Show the CoA parent label and code in the New Category modal.
- Filter the parent picker to valid class-5, non-postable parents.
- Explain why a user should select a cash-vault, petty-cash, mobile-money, or imprest parent.
- Add a repair/diagnostic screen or support report for tenants with missing 571/581 structures.

---

### 35. Prevent capability flags from changing existing-account semantics unexpectedly

**Status: Open hardening issue**

**Code validation:** Treasury category capability flags (`requires_custodian`, `is_bank_identity`, `is_momo_identity`) can be changed after accounts exist. That can change which fields appear and which reconciliation path the client chooses for existing accounts.

**Required work:**

- Either freeze capability flags after first account use, or implement an explicit category migration workflow.
- Show affected account count before changing a flag.
- Prevent a flag change that would hide existing identity data without a migration plan.
- Recompute readiness and reconciliation mode consistently after approved changes.

---

## F. Recommended implementation order

### Phase 1 — integrity and safety

1. Repair Treasury CoA parent seed data.
2. Validate CoA parents during account creation.
3. Make leaf allocation concurrency-safe.
4. Fix the cash-count account guard.
5. Harden manual reconciliation matching.
6. Recalculate reconciliation totals before approval.
7. Validate profile overrides by entity/account/source.
8. Prevent unsafe primary-account deactivation.
9. Enforce verification prerequisites and re-verification after sensitive edits.

### Phase 2 — missing operational workflows

10. Add Treasury Documents upload/link/replace/remove.
11. Add RIB/bank-document verification.
12. Add Treasury signatories and signature cards.
13. Add reversal navigation and journal-reversal integration.
14. Add proposed bank-line journal entries.
15. Add cash-count adjustment entries and approval.
16. Add cash recount/correction/cancellation.
17. Decide and implement true Treasury sub-accounts or rename the misleading tab.

### Phase 3 — account and reconciliation UX

18. Add MoMo network and fee-account controls.
19. Separate bank, cash-vault, petty-cash, and MoMo reconciliation modes.
20. Replace XAF-only denominations.
21. Add witness/custodian/attester controls.
22. Replace timeline UUIDs with names.
23. Populate `unreconciled_count`.
24. Align Statement lines and KPI status rules.
25. Add list/statement/reconciliation pagination and server-side search.

### Phase 4 — performance and verification

26. Profile and reduce Treasury 360 query count.
27. Add indexes/materialized rollups where measured necessary.
28. Add end-to-end fixtures for CSV, Excel, PDF, CAMT.053, MT940, and MoMo statements.
29. Add concurrency tests for primary selection and CoA allocation.
30. Run the full Treasury client and server test suites once dependencies are installed.
31. Execute browser workflows for:
    - bank-account creation;
    - RIB upload;
    - verification;
    - statement preview/import;
    - mapping confirmation;
    - matching;
    - approval;
    - cash count;
    - variance adjustment;
    - reversal;
    - signatory/document management.

---

## Treasury items already substantially addressed

These allegations were checked and should not be reimplemented from scratch:

- Bank-statement import for CSV, Excel, PDF, CAMT.053, and MT940 exists.
- Preview-before-import exists.
- New statement mapping confirmation exists.
- Exact-file and row-level duplicate gates exist on the backend.
- Footing validation exists and blocks non-footing imports.
- Matching suggestions, confirmation, rejection, and ignore actions exist.
- Reconciliation approval and signed reconciliation-document generation exist.
- Atomic primary-account selection exists.
- Account activation/deactivation propagates to the CoA leaf.
- Treasury account verification/unverification endpoints exist.
- Opening-balance editing exists, although its accounting-control policy needs strengthening.
- Category-driven bank/cash/MoMo form rendering exists, although MoMo fields are incomplete.
- Treasury 360 no longer depends on the nonexistent `audit_log`; it reads `immutable_ledger`.

These are implemented foundations, not evidence that the associated end-to-end workflows are complete.
