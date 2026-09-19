# Corporate Entities Module Audit — 2026-09-19

**Module:** MOD-01 — Corporate Entities

**Audit date:** 19 September 2026

**Tenant/runtime timezone used for this audit:** Africa/Lagos

**Repository:** `tomblakeasaah196/praxis-ls`

**Branch:** `arena/01a0b6e8-praxis-ls`

**Audit type:** transcript-to-code continuation audit; no application-source change

## 1. Executive conclusion

The Corporate Entities work is materially further along than the meeting summaries alone suggest. The entity dossier, country-aware legal-form selection, group structure, role-aware people/cap-table display, document register, document scan/verification flow, letterhead preview, entity working-calendar inheritance, multi-entity public network, and Public Story cover-image path all have substantial implementation in the checkout.

**Do not rebuild those addressed surfaces.** In particular, preserve the existing Public Story cover implementation and its derivative/serving model. The remaining work is mostly boundary work: permission-aware controls, transaction and compensation guarantees, tax-calendar generation, consistent confidentiality, lifecycle semantics on the public site, and a few product decisions that the current code cannot safely infer.

The most important release blockers are:

1. **The dossier exposes write controls without a route-aware edit capability.** The backend is authoritative, but the UI currently lets a view-only caller press `Edit`, `Remove`, `Verify`, status, calendar, letterhead, tax, document, and Public Story controls that may predictably return 403.
2. **Tax registration data is not connected to an obligation generator.** The schema has filing frequency, due day, responsible user, and a registration FK on `tax_calendar`, but no generator/reminder path was found.
3. **Tax and renewal confidentiality is inconsistent.** Documents are redacted for non-governance dossier callers, while raw tax registrations, tax obligations, and renewal-derived labels can still contain tax numbers.
4. **Creation of an entity and its initial registered address is not atomic or durably dependent.** The entity can be reported as successfully saved while the address request fails; offline entity creates return before the address request.
5. **Working-calendar reset is not transactional and emits no reset event.** The save path is transactional; reset is not.
6. **The Public Story/admin address fact and stranger-facing public entity card are not yet aligned.** Admin Story facts can show a registered address, while the public entity allow-list deliberately omits it. The selected direction is to publish the canonical registered address; implementation and the second-address rule still need to agree across UI, API, tests, and copy.

### Status key

- **Implemented / preserve:** materially present in source; do not rebuild. Runtime/release validation may still be outstanding.
- **Partial:** an important path exists, but a coupled failure mode, permission boundary, data state, or UX contract remains incomplete.
- **Open / required:** the transcript requirement or defect is not closed by the current implementation.
- **Decision required:** implementation should not proceed until the product/privacy rule is explicit.

## 2. Evidence and method

### Transcript evidence

Both complete raw meeting transcripts were reviewed, not just the Gemini summaries:

- Meeting 3 raw transcript: `https://gist.githubusercontent.com/tomblakeasaah196/d2efe36671493ae03f525d718f404a46/raw/fcf5aeea78fc18adcc8a89dfe1ce8b0cb995e893/meeting-3-transcript.txt`
- Meeting 4 raw transcript: `https://gist.githubusercontent.com/tomblakeasaah196/d4d21e27ae26b464202589d44efd8976/raw/meeting-4-transcript.txt`

The crosswalk below includes direct Corporate Entities requirements, defects, suggestions, workflow concerns, performance concerns, and directly coupled identity/document/tax/letterhead/working-calendar/Public Story behavior. Treasury and Currency remain out of scope except where the entity dossier intentionally links to Treasury as read-only source-of-truth data.

### Code evidence

The audit inspected the actual implementation, including:

- `src/modules/master/corporate_entity/corporate_entity.service.js`
- `src/modules/master/corporate_entity/corporate_entity.controller.js`
- `src/modules/master/corporate_entity/corporate_entity.routes.js`
- `src/modules/master/corporate_entity/corporate_entity.repo.js`
- `src/modules/master/corporate_entity/corporate_entity.calendar.js`
- `src/modules/master/corporate_entity/corporate_entity.renewals.js`
- `src/modules/master/_shared/nested.js`
- `src/modules/master/entity-360.service.js`
- `client/src/features/masterdata/corporate-entities.tsx`
- `client/src/features/masterdata/entity-360.tsx`
- `client/src/features/masterdata/entity-public-story-tab.tsx`
- `client/src/features/masterdata/entity-kpi-drill.tsx`
- `src/modules/master/entity-letterhead.service.js`
- `client/src/lib/masterdata-api.ts`
- `packages/shared/schemas/entity-common.js`
- `packages/shared/schemas/site-settings.js`
- `src/modules/site/site_settings/site_settings.service.js`
- `src/modules/site/site_settings/site_settings.media.js`
- `src/modules/site/site_settings/site_settings.repo.js`
- `src/modules/site/site_settings/site_settings.routes.js`
- `src/modules/site/site_public/site_public.routes.js`
- `public-web/src/lib/site-api.ts`
- `public-web/src/components/site/entity-network.tsx`
- migrations `0515_corporate_entity_rich.sql`, `0516_corporate_entity_documents_tax.sql`, `13787_entity_public_story.sql`
- relevant unit/component tests under `tests/unit`, `client/src/features/masterdata`, and `public-web/src`

### Git and change-scope evidence

The local checkout is a shallow graft. The local history currently exposes only the branch tip `2145add` and `origin/main` tip `9d99548`; the prior Public Story cover reference `5f97b59` is **not a local Git object** (`git cat-file -t 5f97b59` reports an invalid object). The source itself contains the implementation comments and tests describing the cover work, and the review record identifies it as **PR #418 / commit `5f97b59`**, but that PR/commit cannot be independently verified with local `git show` in this checkout.

No Corporate Entities application source was changed by this audit. The pre-existing untracked files `doc/TREASURY_MODULE_AUDIT_2026-09-19.md` and `doc/CURRENCY_MODULE_AUDIT_2026-09-19.md` were not modified.

## 3. Decision record — answered questions

The ten structured decision questions were answered in two batches. The table records the selected direction, the recommendation shown during questioning, and the implementation consequence. **Selected** is the product direction to implement; **Recommended** is retained so a deliberate deviation is not mistaken for an audit oversight.

| Q | Decision area | Selected direction | Recommendation shown | Implementation consequence |
|---:|---|---|---|---|
| 1 | Public lifecycle | **ACTIVE + `public_enabled`** | Same | Public entity JSON and cover serving must require the authoritative ACTIVE lifecycle state and the public switch. DRAFT, PENDING_REVIEW, SUSPENDED, DEACTIVATED, and ARCHIVED are not stranger-facing. |
| 2 | Public address | **Publish the canonical active registered address used by letterhead/internal workflows.** The response also says both addresses are important; if that means a second operational/trading address, it must be separately marked public and labelled rather than exposing every address row. | Country-only was the privacy recommendation | Update the public allow-list, card/Story copy, and redaction tests. Keep one structured source for the registered address so public, internal, and letterhead values cannot drift. The meaning of “both addresses” remains the one clarification noted below. |
| 3 | Tax visibility | **MOD-01 view may see full tax/registration numbers.** | Governance/approval only was the privacy recommendation | Enforce a consistent MOD-01 view boundary across 360, nested routes, renewals, letterhead source, exports, and AI reads. Non-MOD-01 callers and the public site remain redacted/allow-listed. |
| 4 | Tax calendar | **Automatic, idempotent generation.** | Same | Generate obligations from active tax registrations and jurisdiction rules, with period idempotency, responsible assignment, reminders, deregistration, superseding, and audited manual overrides where needed. |
| 5 | Registration verification | **Keep the existing `verified`/`verified_by`/`verified_at` model and add a verification workflow.** | Active/superseded/deregistered lifecycle plus approval was recommended | Add Verify/Reject or equivalent service/UI transitions and audit them. Do not add a new registration lifecycle column in this PR. A current-row rule is still needed for tax generation and letterhead because the statutory `entity_registration` row does not carry the same lifecycle model as `entity_tax_registration`. |
| 6 | Association selection | **Only ACTIVE entities for new/current links; retain inactive links as history.** | Same | Pickers for clients/suppliers, parents, and corporate shareholders enforce ACTIVE for new links; existing inactive relationships remain visible and have an explicit replacement path. |
| 7 | Entity/address creation | **Atomic server transaction.** | Same | Entity and initial registered address commit or fail together. Do not retain the current browser-only two-request success path. |
| 8 | Public Story focus | **Controlled catalogue plus optional bilingual editorial labels.** | Same | Store a stable service type/mode and allow local French/English wording only as an editorial overlay. |
| 9 | Live/test content | **LIVE-only anonymous site plus authenticated preview.** | Same | Stranger-facing routes read only LIVE content. Add a controlled preview path/token for test content with cache, robots, and tenant isolation safeguards. |
| 10 | Permissions | **MOD-01 edit includes Public Story edit.** | Separate MOD-01 and MOD-29 capabilities was recommended | MOD-01 retains explicit view/edit/approve levels; MOD-01 edit owns entity/tax/Public Story writes for this module, while MOD-01 approve owns verification actions. Reconcile the current MOD-29-only route gate so the UI and API implement the selected rule. |

### Remaining clarification, not a reason to block all work

The phrase “both addresses” needs one precise data rule before the public-address PR is merged. The safe implementation interpretation is: publish the active structured `REGISTERED` address that letterhead uses, and publish a second operational/trading address only when an operator explicitly marks that row public and supplies its public label. Do not publish every active address automatically.

The selected registration decision also leaves one technical rule to document: `entity_tax_registration` already has `is_active` and `deregistered_on`, while the statutory `entity_registration` verification row does not have the same lifecycle fields. The tax generator can use the tax-registration state; letterhead/readiness code must not invent a “current” statutory registration rule without specifying whether primary, verified, unexpired, or an explicit replacement is authoritative.

## 4. Transcript-to-code crosswalk

### A. Entity master, identity, and group structure

| ID | Meeting requirement, defect, or suggestion | Current code evidence and classification | Required implementation / acceptance condition |
|---|---|---|---|
| CE-01 | Country-specific legal forms and legal nomenclature. Meeting 3 used German GmbH/UG as the concrete example and asked that the form be represented by the correct country/code rather than a free-text abbreviation. | **Implemented, with a display check remaining.** `client/src/components/legal-form-picker.tsx` scopes choices to the selected country, searches names/aliases/codes/jurisdictions, supports keyboard navigation, and caps rendered results at 200. `packages/shared/data/legal-forms.generated.js` contains separate German records including ISO 20275 code `2HBR` for GmbH and `63KS` for Unternehmergesellschaft. `packages/shared/schemas/entity-common.js` validates the reference. The current catalogue presents the UG record with the source abbreviation `GmbH UG`; the meeting language expected an unambiguous “UG” presentation. The transcript's cited `P5D` was not found in the current generated catalogue. | Keep the official source/code records; do not replace the catalogue with free text. Confirm the canonical operator-facing label/alias for `63KS`, add a regression test for GmbH versus UG selection and stored code, and document any intentional difference between the meeting's example code and the current official catalogue. Confirm letterhead output for both forms. |
| CE-02 | Full entity profile: code, legal/trading name, country, industry, website, contact details, headcount/timezone, incorporation facts, share capital, fiscal/reporting defaults, and opening status. | **Implemented / preserve.** `client/src/features/masterdata/entity-form-fields.ts` covers the scalar form body and explicit null/clear semantics. `corporate-entities.tsx` renders the identity, public-contact, incorporation/capital, reporting, downstream-default, and group sections. `corporate_entity.repo.js` uses `WRITABLE`; `corporate_entity.service.js` filters create and update through the same allow-list. | Preserve the one-source form mapping. Add runtime parity coverage for create versus PATCH and for clearing nullable values when dependencies are available; do not reintroduce a second hand-maintained create mapper. |
| CE-03 | Multi-entity client/supplier association and entity pickers must show the entity name rather than only a UUID. | **Implemented for the current scale, partial for growth.** `client/src/features/masterdata/clients.tsx` and the entity dossier use `ENTITY_LIST = "/entities?limit=200"`; picker options use entity code/legal name. Nested lookups use names for users, employees, establishments, clients, suppliers, and entities. The server already supports `q` search in `corporate_entity.repo.js`, but the main screens filter the fetched list in the browser. | Enforce the selected lifecycle rule: only ACTIVE entities are offered for new/current client, supplier, parent, and corporate-shareholder links; preserve existing inactive links as historical data with an explicit replacement path. Replace the 200-row browser filter with server-side search/pagination. Acceptance: entity 201+ is searchable and no new picker offers a prohibited lifecycle state. |
| CE-04 | Group structure: parent, subsidiary, branch/JV/associate/SPV relationship, ownership, consolidation, group-parent flag, and no cycles. | **Implemented / preserve.** `0515_corporate_entity_rich.sql` adds the fields and self-parent check. `corporate_entity.service.js` validates parents and calls `rules.assertNoCycle` on both generic PATCH and the dedicated structure endpoint. The dossier renders ancestors/children and `StructureModal` writes the dedicated endpoint. | Preserve. Runtime-test cycle rejection, re-parenting, archived-parent behavior, and the treatment of inactive children. Do not add a second parent editor that bypasses `setStructure`. |
| CE-05 | Statutory identifiers must be per entity and per country: NIU, RCCM, VAT/EORI/SIREN/EIN and other jurisdiction-issued identifiers. | **Implemented as a collection, partial as a verification lifecycle.** `entity_registration` is separate from legacy `corporate_entity.niu/rccm`; migration 0515 backfills existing values. The dossier's Identity & registrations tab and `registrationFields` support country, kind, number, authority, issued/expiry dates, primary-for-country, and notes. | For this increment, keep the existing row shape and add the selected verification workflow rather than adding a new lifecycle column. Separately document which primary/verified/unexpired rule supplies letterhead, readiness, expiry, and admin serialization; do not silently infer “current” from array order. |
| CE-06 | Manual verification of identity/registration information. Meeting 4 distinguished “stored” from “checked.” | **Partial: verification storage exists, but the workflow is missing.** Migration 0515 has `verified`, `verified_by`, and `verified_at` on `entity_registration`, but `entityResourceSpecs()` does not expose a verification endpoint or write path and the registration UI has no Verify action. Documents have a separate implemented verification path; that does not verify the identifier itself. | Add a service-owned Verify/Reject or equivalent transition around the existing fields, with MOD-01 approval, audit actor/time, and clear UI state. Do not add active/superseded schema in this PR. Acceptance: a registration cannot become verified by an ordinary PATCH, and the current-row rule is documented separately. |
| CE-07 | People, shareholders, directors, officers, UBOs, signatories, corporate holders, and “one person can hold several roles.” | **Implemented / preserve, with confidentiality follow-up.** `entityCommon.personCreate/Update` and `personRoles()` support role tags, natural/corporate holders, share data, employee/client/supplier links, and validation. `entity-360.tsx` renders shareholder/officer views and role pills. `entity-kpi-drill.tsx` makes the shareholder/employee/subsidiary/journal KPIs actionable. | Preserve the role-union model and KPI drills. Keep the server redaction as the authority. Add permission/runtime tests for direct people/cap-table routes and verify that role changes, effective dates, and corporate-holder links are consistent with downstream use. |
| CE-08 | Contacts, addresses, registered office, PO box, trading/billing addresses, and the distinction between statutory address and where people work. | **Implemented in the dossier, partial in initial creation.** `addressFields()` and the Contacts & addresses tab support typed structured addresses, PO box, primary/active flags. Letterhead source resolution prefers an active `REGISTERED` row. The new-entity form collects a registered office but creates it only after the entity POST in `corporate-entities.tsx`; failures are caught and only logged. | Implement one atomic server transaction for the entity and initial registered address. Acceptance: a successful create cannot silently lose the address, an offline create cannot be reported as complete before both records exist, and a failed transaction leaves neither partial success nor an orphaned dependent row. Keep the dossier as the owner for later address edits. |
| CE-09 | Unsaved-change recovery, save navigation, and not losing a long entity form when the browser/network interrupts. | **Implemented for scalar entity edits; partial for dependent writes.** `useFormDraft` in `corporate-entities.tsx` stores drafts by entity/new key and exposes restore/discard. `submitQueued` keeps offline entity writes in an outbox and leaves the form open with an explicit queued state. `ChildModal` closes only after a successful nested save; URL tab/field/deep-edit helpers support return navigation. The initial address is not part of the queued entity operation. | Preserve the draft/queued UX. Extend the durable operation boundary to the initial address and any other dependent child writes, with status/retry visibility. Test refresh, close-and-restore, duplicate replay, and a successful parent/failed child sequence. |

### B. Documents, files, expiry, and sharing

| ID | Meeting requirement, defect, or suggestion | Current code evidence and classification | Required implementation / acceptance condition |
|---|---|---|---|
| CE-10 | Store administrative documents separately from expiry tracking; support physical originals, digital scans, issuing authority, document number, issued/expiry dates, country/establishment, and renewal lead time. | **Implemented / preserve.** Migration 0516 has `entity_document`, physical reference, vault pointer, scan/verification states, expiry and lead-day fields. `DocumentsTab` includes paper-only records, `physical_ref`, `expires_on`, `renewal_lead_days`, establishment, and optional scan. `corporate_entity.renewals.js` derives advisory renewal items from document expiry. | Preserve the record/file separation. Decide how inactive/superseded documents interact with compliance and letterhead; current document renewals skip `is_active=false`, which should be the documented rule. Add runtime checks that a paper-only row remains visible without being shareable. |
| CE-11 | Attachment/save defect: selecting a file while creating a document must not create an unlinked record, silently discard the file, or claim success before the file is connected. | **Partially addressed.** `DocumentsTab.save()` creates the entity-document row, consumes the returned `document_id`, uploads to the vault, and PATCHes `vault_id`; row creation failure or an upload/link error is surfaced and the row remains for retry. `nested.js` advances PENDING to SCANNED after `vault_id` is written. This closes the earlier “file picked but never linked” path, but it remains a multi-request workflow. | Add an explicit attachment state/retry model and reconciliation job for rows created without a vault link. If the vault upload succeeds but the link PATCH fails, make the retry discoverable and ensure the vault object is not orphaned. Acceptance: every failure state names whether the record, bytes, and link exist. |
| CE-12 | Manual document verification after scanning; upload must not equal human verification. | **Implemented / preserve, runtime unverified.** `POST /:id/documents/:childId/verify` is gated at `approve`; `nested.js.verify()` requires a real vault path, writes VERIFIED state/actor/time, audits, and the UI exposes Verify only for an attached unverified scan. | Preserve the two-step model. Confirm whether document verification also needs maker-checker in LIVE; currently the entity nested spec is not marked `governed`, unlike party tax registrations/banks. Make that governance decision explicit and test a non-approver, a pending vault object, and a repeated verify. |
| CE-13 | Share selected entity documents by email and as a ZIP, while not pretending paper-only records travelled. | **Implemented / preserve.** `DocumentsTab` has ID-based selection, mixed select-all state, `ShareDocumentsDialog`, vault attachments for `NewMessageDialog`, and a real ZIP built from vault bytes. `entity-documents-share.test.tsx` covers email/ZIP and the no-scan message. | Preserve. Runtime-test vault access, a mixed paper/digital selection, duplicate filenames, large selections, and a failed ZIP fetch. Keep the explicit “no file” state. |
| CE-14 | Document/file confidentiality must not be bypassed through the dossier or direct child route. | **Partial/inconsistent under the selected tax policy.** `entity-360.service.js` redacts document numbers, issuing authority, physical refs, vault IDs, paths, hashes, and notes for callers without the document governance grant. Tax registrations, tax obligations, and renewal-derived labels currently contain full numbers, but their route/capability boundary is not consistently enforced. | Implement the selected rule: MOD-01 view may see full tax/registration numbers and renewal labels; callers without MOD-01 view and all public routes must not. Apply the same authorization/serialization policy to 360, nested routes, renewals, letterhead source, exports, and AI reads. Keep document/vault redaction and approval gates intact. |

### C. Tax jurisdiction, obligations, and renewals

| ID | Meeting requirement, defect, or suggestion | Current code evidence and classification | Required implementation / acceptance condition |
|---|---|---|---|
| CE-15 | Per-entity tax jurisdiction/registration: tax kind, number, regime, filing frequency, due day, currency, WHT/reverse charge flags, portal, responsible person, active/deregistered state. | **Implemented as CRUD, partial as control workflow.** Migration 0516 and `entityCommon.taxRegistrationCreate/Update` cover the fields and cross-field rules. `entity-360.tsx` has jurisdiction/regime/responsible-user pickers and displays names rather than IDs. `entityResourceSpecs()` allows CRUD but has no `governed` maker-checker configuration. | Apply the selected permission model: MOD-01 edit owns tax-registration CRUD and MOD-01 approve owns verification actions. Ensure deregistered/inactive rows cannot be selected as current invoice/tax defaults; audit mutations and make any pending state explicit if governance is later added. |
| CE-16 | Defect: registration data should drive a tax filing calendar, with jurisdiction-specific cadence/due date, responsible person, reminders, and an explainable link back to the registration. | **Open.** `tax_calendar` exists from migration 0342 and migration 0516 adds `tax_registration_id`, `period_code`, `generated`, and `WAIVED/SUPERSEDED` statuses. `corporate_entity.repo.js` only reads existing rows; no registration-to-obligation generator, idempotency key, period roll-forward, jurisdiction rule, assignment workflow, reminder scheduler, or status transition was found. | Implement an idempotent generator contract. At minimum: derive obligation kind/cadence from active registration and jurisdiction rules; calculate period/due date with month-end handling; persist `tax_registration_id`, `period_code`, and `generated`; supersede obligations when registrations close/change; assign or inherit `responsible_user_id`; emit reminders/events; avoid duplicates on rerun. If generation is intentionally seed/import-driven, document and enforce that contract instead of leaving the UI implying automatic linkage. |
| CE-17 | Renewals and compliance warnings for documents, identifiers, and tax registrations should be useful without hard-blocking operations. | **Partial / preserve the advisory posture.** `corporate_entity.renewals.js` handles document expiry, registration expiry, and tax deregistration with a soft recommendation ladder. Documents and tax rows honor `is_active`; `entity_registration` has no active flag and is always considered. Tax renewal labels include `tax_number`. | Keep renewals advisory unless an explicit human hard-block action is added. Do not add a new `entity_registration` lifecycle schema in this increment; document the selected primary/verified/unexpired current-row rule, make renewal labels use the selected MOD-01 view policy, and connect generated tax obligations/reminders to the same as-of and audit model. |

### D. Letterhead, Treasury coupling, and working calendar

| ID | Meeting requirement, defect, or suggestion | Current code evidence and classification | Required implementation / acceptance condition |
|---|---|---|---|
| CE-18 | Letterhead must print the right country/legal form, capital, registered address/PO box, registrations, contact, logo, language, and selected Treasury payment account without creating a second bank source of truth. | **Implemented / preserve, with consistency verification.** `entity-letterhead.service.js`, `corporate_entity.service.js`, and `letterhead-blocks` compose from structured addresses/registrations and read-only Treasury accounts. The overview and designer show live preview data; payment identifiers are masked for callers without financial visibility. | Preserve the Treasury read-only boundary. Runtime-test structured-address-only, registration-row-only, bilingual, light/dark logo, inactive/superseded registration, and masked/unmasked payment-block cases. Do not add writable bank-account CRUD to MOD-01. |
| CE-19 | Address/letterhead mismatch: the address entered during entity creation must appear in the letterhead and not vanish because the structured child row was not created. | **Partial.** Letterhead resolution now prefers `entity_address` and falls back to legacy `entity.address`; migration 0515 backfills legacy addresses. The initial form's separate POST can fail silently, so the mismatch can still be created at workflow time. | Close CE-08 first. Add one source-of-truth/reconciliation test: create with a structured registered address, render letterhead, edit the address in the dossier, and verify the preview changes; if the dependent write is pending, show that state rather than a false success. |
| CE-20 | Working calendar/public holidays belong to the entity/office; inherited tenant default must be visible; an entity can override or reset to default. | **Implemented / preserve, reset partial.** `working-calendar-tab.tsx` clearly labels inherited versus own calendar, supports timezone, opening days/hours, holidays, and annual movable-feast warning. `corporate_entity.calendar.js.save()` replaces the own calendar transactionally and emits/audits `working_calendar.saved`. | Make `reset()` transactional, audit the before/after, emit `working_calendar.reset`, and handle a reset failure without leaving a half-updated state. Runtime-test timezone boundaries, holiday dates, inherited/default changes, and milestone scheduling; no such runtime test was run here. |
| CE-21 | Calendar/performance concern: avoid per-row writes and unsafe concurrent reads. | **Implemented design / runtime unverified.** The calendar is saved wholesale in one transaction. The dossier deliberately performs sequential queries on one PostgreSQL client. ZIP downloads are deliberately sequential to avoid opening many connections. | Preserve the intentional sequential behavior unless profiling proves otherwise. Add concurrency/rollback tests for two calendar saves and two media replacements; do not infer correctness from comments alone. |

### E. Public Story, public website, and cover image

| ID | Meeting requirement, defect, or suggestion | Current code evidence and classification | Required implementation / acceptance condition |
|---|---|---|---|
| CE-22 | Public Story needs bilingual summary/copy, explicit publish switch, coverage areas, service focus, entity facts, and editable website copy without retyping statutory facts. French-language handling must not collapse when only one language is supplied. | **Implemented data path, partial permission/UX.** `entity-public-story-tab.tsx` edits `public_summary_fr/en`, coverage, focus, and `public_enabled`; facts are read from the dossier. `site-settings.routes.js` currently places the write endpoint under MOD-29 `edit`, and the schema is bilingual with bounded arrays. `public-web/src/lib/site-api.ts` exposes `pickBilingual`, while `entity-network.tsx` uses it for summary/focus labels and the selected language with fallback. | Implement the selected permission rule: MOD-01 edit includes Public Story edit for this module; reconcile the current MOD-29-only route gate and pass an explicit capability to the tab. Keep statutory facts owned by the entity dossier. Define the preferred French/English fallback order for empty values and test MOD-01 view/edit/approve plus French-only/English-only content. |
| CE-23 | Public service focus should be understandable and preferably selected from a service-type/catalogue; transport mode should align with the public design system. | **Partial, decision made.** `public_focus` has a controlled `mode` enum (`sea`, `air`, `road`, `rail`) but `label_fr/en` remain free text. The selected direction is a controlled catalogue plus optional bilingual editorial labels. | Add a stable service type ID and catalogue-backed picker, while retaining optional local French/English labels. Validate the ID/mode server-side and keep mode/color derivation centralized. |
| CE-24 | Public Story cover image: upload a real operation photo, reject inappropriate/generated assets, show the image on the entity card, and support small-screen/performance-friendly delivery. | **Implemented in source / preserve; release verification outstanding.** `EntityPublicStoryTab` mounts `AssetSlotField` with `slot="entity-cover"`. The shared slot contract allows PNG/JPEG/WebP, 8 MB, 16:9 guidance, evidence provenance, and `minWidth: 1`; server media code validates type/provenance, records SITE ownership, generates only supported AVIF/WebP derivatives at 480/960/1600, archives replacements, and serves original/recorded derivatives only when the entity is publishable. `entity-network.tsx` renders `<picture>`, recorded `srcset`, lazy decoding, and an accessible name. | Do not restore the old 1200px floor. The source comments in `client/src/features/settings/website-assets.tsx` and `client/src/lib/image-compress.ts` still say the cover requires 1200px even though the current contract intentionally uses `minWidth: 1`; correct that stale documentation. Add a focused public-web test for cover `<picture>`, original fallback, recorded derivative `srcset`, and no cover state. Runtime-test upload, replacement, derivative fallback, failure/retry, and anonymous serving. |
| CE-25 | Cover-upload failure must not leave a broken public pointer or silently lose the prior cover. | **Partial.** `site_settings.media.upload()` creates the vault object, writes derivatives, then atomically scopes the new object, updates the owner pointer, archives the old object, and audits. The UI surfaces upload errors and only reloads after success. But bytes/storage are created before the DB transaction; a later DB failure can leave storage/derivative orphans, and the entity Story tab does not expose a durable retry/reconciliation state. | Add cleanup/reconciliation for vault objects created before owner-pointer commit, or an outbox/state machine that makes orphan detection and retry explicit. Acceptance: failed replacement leaves the previous cover servable, a failed new upload is not publishable, and orphaned storage/DB rows are measurable and repairable. |
| CE-26 | Multiple entities must appear on the public website as distinct cards/network nodes, with legal/trading names, summaries, coverage, service focus, and entity-specific leadership. | **Implemented / preserve.** `site_settings.service.publicEntities()` returns an explicit allow-list for multiple `public_enabled` entities. `public-web/src/components/site/entity-network.tsx` renders entity cards, legal name under trading name, bilingual copy, focus, coverage, leaders, reduced-motion behavior, and narrow-screen fallback. `buildEntityGraph` joins only shared country codes. Tests cover multi-entity graph and DOM redaction. | Preserve. Add a public endpoint/card test with two actual covers and mixed language fallback. Confirm archived/deactivated entity behavior before release; see CE-27. |
| CE-27 | Public lifecycle: an archived/deactivated/draft entity must not remain publicly listed or continue serving its cover merely because `public_enabled` is true. | **Open static defect; selected rule is clear.** `site_settings.service.publicEntities()` selects `WHERE public_enabled = true` without an explicit `registration_status = 'ACTIVE'`/`is_active` predicate. The entity cover serve query similarly checks `public_enabled = true` but not lifecycle. | Enforce `public_enabled = true` **and** the authoritative ACTIVE lifecycle state in both entity JSON and media-serving owner joins. Add tests for DRAFT, PENDING_REVIEW, SUSPENDED, DEACTIVATED, and ARCHIVED with `public_enabled=true`; verify cached URLs return 404 after deactivation. |
| CE-28 | Public address behavior: Meeting 4 called out a mismatch between the registered address shown in Story/admin and what visitors see on entity cards. | **Decision recorded; implementation required.** The Story tab fact panel derives and displays the registered address from `entity.address`/structured addresses, but `getEntityStory` and `publicEntities()` do not publish an address and the public card has no address field. The selected direction is to publish the same active structured `REGISTERED` address used by letterhead/internal workflows. | Update `site-settings.repo.js`, public serialization, card copy, and redaction tests to expose the canonical registered address. If a second operational/trading address is also requested, add an explicit public-address marker and label before exposing it; do not publish every address row automatically. |
| CE-29 | Live/test website content must not cross environments; the public site should read live content while admin can prepare/test content intentionally. | **Designed / runtime unverified; selected preview direction.** `site_public.routes.js` uses `tenantDbIn("live", ...)` for stranger-facing entity and media reads; settings writes use the authenticated tenant settings route. | Keep anonymous reads LIVE-only and add an authenticated preview path/token for test content. Test sandbox writes versus live public reads, publish toggles, media URLs, cache headers, robots behavior, and tenant isolation. |
| CE-30 | Public redaction: no RCCM/NIU, legal form, incorporation date, cap table, governance, or internal permission notes on the stranger-facing surface. | **Implemented / preserve.** `publicEntities()` builds an explicit object, and `site-public-redaction.test.js`, `about-page.test.tsx`, and `entity-network.test.tsx` assert the serialized/DOM boundary. | Preserve the allow-list. If CE-28 chooses public address disclosure, add only the explicit field and assert that all other statutory and governance fields remain absent. |

### F. UX, permissions, and navigation defects

| ID | Meeting requirement, defect, or suggestion | Current code evidence and classification | Required implementation / acceptance condition |
|---|---|---|---|
| CE-31 | KPI values should be clickable and lead to the underlying shareholders/employees/subsidiaries/journal records. | **Implemented / preserve.** `EntityKpiDrill` is mounted from the dossier and shareholder, employee, subsidiary, and journal KPI tiles have click handlers. Tests exist in `entity-kpi-drill.test.tsx`. | Runtime-test permission-denied and empty-result states; preserve the inert “Ownership recorded” metric where it is a reconciliation figure rather than a list. |
| CE-32 | Dossier actions should reflect the caller's edit/approve capability instead of displaying controls that inevitably fail. | **Open and cross-cutting.** `EntityDossier` accepts only `entityId`, `onEdit`, `onChanged`; it has `can_see_governance` but no route-aware `canEdit`. Buttons for status, child CRUD, document Verify, letterhead, calendar, and Public Story are rendered independently of capability. The Public Story component's current header says it is read-only without MOD-29, but no such prop is supplied and its inputs/buttons are not disabled. | Introduce explicit MOD-01 view/edit/approve capabilities, with MOD-01 edit including Public Story edit for this module. Reconcile the current MOD-29-only Public Story route gate. Acceptance: MOD-01 view is read-only, MOD-01 edit can edit permitted dossier/Story fields, approvers see Verify only, and the server remains authoritative for races. |
| CE-33 | User/entity lookup labels should be names, not opaque IDs; responsibility should be visible. | **Mostly implemented.** Lookups in `entity-360.tsx` use code/legal name, full name/email, establishment name, and the repo joins `responsible_name`, `manager_name`, and `jurisdiction_name`. | Preserve. Add a null/missing-user display policy and verify direct API payloads do not regress to IDs in a future refactor. |
| CE-34 | Deep links should open the correct tab/field/row and Save should not strand the operator. | **Implemented / preserve.** `useUrlTab`, `useFieldHighlight`, `useDeepLinkEdit`, date normalization in `ChildModal`, and save-then-close behavior cover the reported navigation issues. | Runtime-test deep links from readiness/compliance alerts, nested edit rows, invalid/stale row IDs, and browser Back/Refresh. |
| CE-35 | The entity list and dossier should remain usable for a large multi-entity tenant. | **Partial.** The browser cap was raised from the default 50 to the `page()` maximum 200 (`ENTITY_LIST`), avoiding the immediate “entity 51 is unfindable” problem. The code comments explicitly acknowledge that server-side search is the next step beyond 200. | Implement server-side query/search and pagination or an autocomplete endpoint. Add loading/empty/error states for the picker itself and avoid fetching a full tenant-wide list for every nested modal. |

## 5. Public Story cover-image investigation

This was investigated as a preservation example rather than treated as a rebuild candidate.

### What is present

1. **Admin control:** `client/src/features/masterdata/entity-public-story-tab.tsx` mounts `AssetSlotField` for `entity-cover` and reloads the story after a successful change.
2. **Shared contract:** `packages/shared/schemas/site-settings.js` defines the slot as an evidence image, non-transparent, max 8 MB, 16:9 guidance, with `minWidth: 1`. The one-pixel floor is intentional after the old 1200px rejection defect; derivative generation does not upscale.
3. **Upload ownership:** `src/modules/site/site_settings/site_settings.media.js` maps `entity-cover` to `corporate_entity.public_cover_vault_id`, records `SITE` scope and the `COVER` role, and uses an owner join on serving.
4. **Derivative delivery:** the server records the derivative widths/formats actually written. `public-web/src/lib/site-api.ts` creates `srcset` only from recorded variants. `entity-network.tsx` uses `<picture>` with AVIF/WebP sources and an original fallback.
5. **Public security:** media serving requires a verified vault row, SITE scope, COVER role, the entity pointer, and `public_enabled=true`; the stranger-facing JSON is an explicit allow-list with no statutory identifiers or governance fields.
6. **Replacement/archive:** the pointer update, public scope, old-cover archive, and audit are grouped in a DB transaction after vault storage. This is the correct intended shape and should be retained.
7. **Static tests:** `tests/unit/site-media.test.js` covers slot ownership, provenance, transparency policy, and variant path safety; `tests/unit/site-public-redaction.test.js` and `public-web/src/components/site/entity-network.test.tsx` cover public serialization/DOM redaction.

### What remains

- The local shallow Git history cannot prove `5f97b59` with `git show`; the review record identifies **PR #418 / commit `5f97b59`** as the prior cover work. Treat that as prior implementation evidence, not as a locally reproducible commit object.
- There is no focused `entity-network` test asserting that a non-null `cover_id` produces the expected `<picture>`/`srcset` and that a missing derivative falls back safely.
- The client comments in `website-assets.tsx` and `image-compress.ts` still describe a 1200px floor, contradicting the intentional `minWidth: 1` contract. Correct the comments/tests; do not restore the floor.
- Storage bytes/derivatives are written before the owner-pointer transaction. A transaction failure can leave an unowned object even though the public pointer remains unchanged. Add cleanup/reconciliation and release verification.
- Public JSON/media selection still needs the lifecycle predicate from CE-27.

## 6. Confidentiality and lifecycle boundary

The selected policy separates three audiences rather than treating all “non-governance” users identically:

1. **Public website:** explicit allow-list only — public entity name, country, bilingual story, coverage, focus, approved cover, leaders, and the selected canonical registered address. No tax/registration numbers, cap-table values, document references, vault paths, or internal notes.
2. **MOD-01 view:** full tax and registration numbers are allowed by the selected decision, along with compliance/renewal details. The API must enforce MOD-01 view consistently rather than relying on the UI.
3. **MOD-01 edit/approve:** mutation and verification actions are capability-gated. Document/vault references and other governance-sensitive fields retain their existing stronger redaction/approval rules unless explicitly granted.

The current defect is therefore **inconsistent enforcement**, not necessarily that tax numbers must be hidden from every dossier viewer. The implementation must make the selected MOD-01 view boundary explicit across:

- `GET /entities/:id/360`;
- tax-registration and tax-calendar child routes;
- `expiring_registrations` and renewal labels;
- letterhead source/preview;
- exports and AI/alternate reads; and
- public entity JSON and media routes.

Add serialized-body tests for MOD-01 view, MOD-01 edit/approve, no-MOD-01 callers, and anonymous public callers. Keep document identifiers, vault references, hashes, and notes redacted outside their approved governance boundary.

## 7. PR plan, merge order, and progress

### Progress snapshot

| Workstream | Status on 19 September 2026 |
|---|---|
| Transcript audit and code crosswalk | **Complete** — both raw transcripts reviewed and mapped to repository paths. |
| Decision questions | **Answered** — all ten questions have selected directions; the meaning of “both addresses” and the current statutory-registration rule still need a short implementation note. |
| Existing Corporate Entities/Public Story implementation | **Substantial and to be preserved** — this plan closes boundaries and failure modes; it is not a rebuild plan. |
| New implementation PRs in this plan | **0/10 started by this audit** — these are the recommended next PRs, not claims that they already exist. |
| Runtime/release validation | **Not run** — no live API, tenant DB, browser, migration replay, permissions, concurrency, scheduler, import, or production test was performed. |

### Ten implementation PRs

| PR | Goal | Main scope and completion signal | Dependencies | Development/parallel wave |
|---|---|---|---|---|
| **PR-01 — Entity capability UI** | Stop predictable 403 workflows. | Add MOD-01 view/edit/approve capabilities through the dossier and child tabs; MOD-01 edit includes Public Story edit; hide/disable unavailable controls and test each capability state. Reconcile the current MOD-29-only Story route. | Decision Q10 | **Wave 1.** Start immediately; other UI PRs should rebase after it if they touch `entity-360.tsx` or the Story tab. |
| **PR-02 — Atomic entity/address creation** | Prevent an entity from succeeding while its initial registered address fails. | Add one server transaction for entity plus initial registered address, idempotent retry behavior, and failure tests. Preserve draft recovery/offline messaging without reporting a partial success. | Decision Q7 | **Wave 1.** Independent of tax/public code; can be shared in a separate chat. |
| **PR-03 — Registration verification workflow** | Turn stored identifiers into auditable verified facts without inventing a new lifecycle schema. | Add service/UI Verify and selected rejection/unverify behavior around `verified`, `verified_by`, and `verified_at`; gate with MOD-01 approve and audit actor/time. Document the current-row rule separately. | Decision Q5; PR-01 for UI capability conventions | **Wave 1 development; merge after PR-01.** |
| **PR-04 — Tax boundary and renewal consistency** | Make the selected MOD-01 tax visibility policy enforceable and consistent. | Allow full tax values to MOD-01 view; deny them to other internal/public callers; align 360, nested routes, renewals, letterhead, exports, and AI reads. Keep document/vault redaction. | Decision Q3; PR-03 preferred; PR-01 capability model | **Wave 2.** Start after PR-01/03 contracts are stable. |
| **PR-05 — Tax obligation generator** | Connect active tax registrations to a real filing calendar. | Add idempotent jurisdiction/frequency/due-day generation, period codes, responsible assignment, reminders/events, manual override/waiver audit, deregistration, and superseding. Use `entity_tax_registration.is_active`/`deregistered_on` for tax rows; document statutory-registration currentness separately. | Decision Q4; PR-03/04 | **Wave 2.** Must follow the tax-state and visibility contracts. |
| **PR-06 — Public entity contract** | Make public JSON, addresses, lifecycle, preview, focus, and cover rendering agree. | Require ACTIVE + `public_enabled`; publish the canonical registered address; add explicit handling for any second public address; add the selected service catalogue with optional bilingual editorial labels; add authenticated preview isolation; add public cover `<picture>`/recorded `srcset` tests and correct stale 1200 px comments. | Decisions Q1, Q2, Q8, Q9; PR-01 if UI code is changed | **Wave 1 development, Wave 2 merge.** Keep its UI changes separate from PR-01 or merge PR-01 first. |
| **PR-07 — Media/document compensation** | Prevent orphaned vault objects and make failed linking/replacement repairable. | Add cleanup/reconciliation or an explicit outbox/state machine for pre-commit media, failed document link, derivative failure, and cover replacement. Verify old cover remains served after failed replacement. | PR-06 public contract preferred | **Wave 2.** Can be developed in parallel with PR-06 if it targets media/vault files only; merge after PR-06. |
| **PR-08 — Calendar reset integrity** | Make reset as safe as save. | Wrap reset in a transaction, audit before/after, emit `working_calendar.reset`, and test rollback/timezone/holiday/concurrency behavior. | None beyond decisions | **Wave 1.** Fully independent; safe to share separately. |
| **PR-09 — Scalable entity pickers** | Remove the 200-entity ceiling and browser-only search. | Add server-backed `q` search/pagination/autocomplete, loading/empty/error states, and ACTIVE-only new/current selection while preserving historical inactive links. | Decision Q6; PR-02 preferred to reduce `corporate-entities.tsx` conflicts | **Wave 1 development; merge after PR-02.** |
| **PR-10 — Hardening and release evidence** | Prove the merged behavior rather than relying on static inspection. | Add migration replay tests for 0515/0516/13787, orphan/unlinked-media and generated-tax metrics, browser accessibility/performance tests, concurrency tests, and live/sandbox/permission/preview verification. | PR-01 through PR-09 | **Final wave.** Do not merge as a substitute for the behavior PRs. |

### Merge order

Use this merge order to minimize rework:

```text
Decision gate
  → PR-01 capabilities
  → PR-02 atomic entity/address
  → PR-03 registration verification
  → PR-04 tax boundary/renewals
  → PR-05 tax generator
  → PR-06 public lifecycle/address/preview/cover contract
  → PR-07 media/document compensation
  → PR-08 calendar reset
  → PR-09 picker scalability
  → PR-10 hardening and runtime/release evidence
```

This is a **recommended merge order, not a requirement to serialize development**. The practical parallel assignments are:

- **Chat/track A:** PR-01 — capabilities.
- **Chat/track B:** PR-02 — atomic entity/address creation.
- **Chat/track C:** PR-03 — registration verification, provided it follows the capability contract.
- **Chat/track D:** PR-06 server/public work — lifecycle, registered-address serialization, preview isolation, and cover tests; do not concurrently edit the same Story UI files as PR-01.
- **Chat/track E:** PR-08 — calendar reset.
- **Chat/track F:** PR-09 — picker search; rebase after PR-02 if both change `corporate-entities.tsx`.

Then run:

- **PR-04** after PR-01/03;
- **PR-05** after PR-04;
- **PR-07** after PR-06;
- **PR-10** after all behavior PRs.

## 8. Required implementation sequence

The PR table above is the authoritative implementation plan. In priority terms:

### P0 — release-blocking

1. **PR-01:** capability-aware controls and the selected MOD-01/Public Story permission rule.
2. **PR-02:** atomic entity plus initial registered address creation.
3. **PR-04:** selected tax visibility and renewal consistency.
4. **PR-05:** automatic idempotent tax obligations and reminders.
5. **PR-06:** ACTIVE/public lifecycle, canonical public address, authenticated preview, and cover rendering contract.
6. **PR-07:** media/document compensation and reconciliation.

### P1 — required hardening

7. **PR-03:** registration verification workflow and current-row documentation.
8. **PR-08:** transactional/audited calendar reset.
9. **PR-09:** server-backed entity picker search and lifecycle selection.

### P2 — evidence and operations

10. **PR-10:** migration, browser, API, concurrency, metrics, preview, and release validation.

The existing legal-form catalogue, group structure, draft recovery, document sharing, document scan/verification surface, letterhead source resolution, calendar inheritance/save, Public Story cover ownership/derivatives, multi-entity rendering, and public redaction allow-list are preservation targets throughout these PRs.

## 9. Acceptance checklist

A future implementation pass should not be marked complete until all of the following are demonstrated:

- [ ] GmbH/UG and at least two non-German country legal forms store the correct catalogue code and render the intended legal nomenclature.
- [ ] A new entity with a registered address either commits both records or visibly queues/retries the dependent address; no silent console-only failure remains.
- [ ] An entity with more than 200 peers can find and select a parent/client association through server-side search.
- [ ] A caller without MOD-01 view cannot obtain tax/registration numbers or tax-number-containing renewal labels; MOD-01 view can obtain them consistently across 360, nested routes, renewals, letterhead, exports, and AI reads.
- [ ] A MOD-01 approver can intentionally verify a document and an entity registration through the selected existing verification fields; the audit trail identifies actor and time.
- [ ] A tax registration creates or is explicitly linked to idempotent obligations with a responsible person and reminder/event behavior.
- [ ] Tax registrations honor active/deregistered state, statutory registration currentness is documented, and DRAFT/PENDING_REVIEW/SUSPENDED/DEACTIVATED/ARCHIVED entities are excluded from public output.
- [ ] Calendar reset is atomic and audited; a failed reset leaves the previous own calendar intact.
- [ ] MOD-01 view, MOD-01 edit, and MOD-01 approve users see only controls they can use; MOD-01 edit can edit Public Story under the selected rule.
- [ ] The Public Story cover upload/replacement preserves the old cover on failure, cleans up/reconciles orphaned media, and serves only verified SITE-scoped media for an ACTIVE/public entity.
- [ ] Public entity cards render multiple entities, bilingual fallback, coverage/focus, cover `<picture>`/recorded `srcset`, no-cover fallback, and no statutory/governance data.
- [ ] The canonical active registered address used by letterhead/internal workflows is shown on the public Story/card; any second address is shown only with an explicit public marker and label.

## 10. Confidence and validation limits

- **Transcript coverage confidence: 96%.** Both complete raw transcripts were reviewed and the crosswalk includes their Corporate Entities and directly coupled public/document/tax/identity/calendar passages.
- **Static/code finding confidence: 97%.** Findings are tied to the paths and line-level behaviors listed above; the Public Story cover path was traced from schema and admin control through vault ownership, derivative generation, public serialization, and public rendering.
- **Runtime/release evidence confidence: 95% that it is still unverified.** No claim is made here about live API responses, tenant data, browser behavior, migration replay, import, concurrency, permission enforcement in a running stack, cron/reminders, storage cleanup, or production release behavior.

The repository has no root or client `node_modules` in this checkout. Node `v22.22.3` and npm `10.9.8` are present, but Jest/Vitest/build/typecheck/lint execution was not performed. The next validation pass must install/use the repository's dependencies and run the relevant tests plus browser/API/tenant-runtime checks before converting any “implemented” label above into release confidence.

**Bottom line:** preserve the substantial MOD-01 and Public Story work; implement the P0 boundaries in sequence, and do not close the audit by merely making the current 403s or silent partial writes less visible.
