# Sales & CRM F1–F14 Acceptance Audit

**Date:** 2026-08-16  
**Subject:** current `main` in `/home/user/praxis-ls`  
**Commit audited:** `2c86cc714d2d0dc9ddbcbd737fa40b6c25372592`  
**Specification:** `doc/SALES_CRM_FEATURES.md`  
**Mode:** report only; no source fixes; report added to the repository at the user’s request

## 1. Executive verdict

The current implementation **does not yet satisfy full acceptance** for Block A and F1–F14.

- **Accepted, including externally supplied runtime acceptance:** F1, F3, F8, F9.
- **Not accepted because of confirmed source defects or incomplete required behavior:** F2, F4, F5, F6, F7, F10, F11, F12, F13, F14.
- **Block A infrastructure acceptance is closed:** CI gates passed; all migrations were externally applied twice with the second application producing zero new files; tenant isolation, PgBouncer, Chromium end-to-end, and Docker image/runtime checks were reported passed.
- **Block A overall remains open only for implementation integrity:** F6/F7 contain transaction-boundary defects contrary to its transactional-integrity requirement.

The external results in this revision were supplied by the user for the exact audit date. They close resource-dependent test gaps, but they do not override directly contradictory source paths; those are called out explicitly.

### Highest-priority findings

1. **F12 public media control gap:** any vault document ID attached to a published story as cover/logo/gallery becomes anonymously retrievable. There is no image-only, ownership/purpose, or safe-media validation; the route explicitly serves PDFs. The control defect is confirmed, while actual disclosure depends on what IDs staff attach.
2. **F10 financial-control bypass:** partnership approval correctly creates a DRAFT supplier, but supplier-invoice posting does not validate supplier registration status and can create posted GL payables for that DRAFT supplier. This contradicts “nothing becomes payable” before verification.
3. **F6 and F7 partial-commit defects:** lead conversion and opportunity win open an outer transaction and call services that issue their own `BEGIN`/`COMMIT` on the same client. The inner `COMMIT` can commit the client/dossier before later outer work fails.
4. **F11 publication-integrity gaps:** story create/update does not require or validate dossier eligibility, editing does not clear prior sign-off, and dossier-link replacement can occur without reapproval. A signed story can therefore be changed and then published under stale approval.
5. **F14 tracking does not model the required public fields:** stage location is always `null`, stage reference is the milestone code, and internal `cause_note` is exposed as public `progress_note`.

## 2. Status legend

- **PASS:** implementation, selected tests, and the externally supplied runtime acceptance support the requirement.
- **FAIL:** a confirmed source-level defect or required behavior is missing.
- **RUNTIME GAP CLOSED:** a previously unavailable resource-dependent check was reported passed externally; this does not erase a separate source-level failure.

## 3. Acceptance matrix

| Area | Status | Criterion-level result |
|---|---|---|
| Block A | **FAIL (infrastructure passed)** | CI, migration apply-twice, tenant isolation, PgBouncer, Chromium, and Docker checks are externally reported passed. F6/F7 still violate transactional integrity, so the block is not fully accepted. |
| F1 Live Meetings | **PASS** | Sectioned capture, lead linkage, dictation status, visible transcription failure, and one-call discovery retrieval are implemented and unit-tested; live audio/worker success and forced-failure paths were externally reported passed. |
| F2 Company Profile | **FAIL** | Live extraction, confirmation, sandbox-credit, and tenant-isolation checks were externally reported passed, but `vertical_mix` groups only by service type; commodity is omitted. |
| F3 Proposal Builder | **PASS** | Manual lifecycle, transition rules, totals, and dictionary relations exist; the complete PostgreSQL accept-to-quotation path and hand-calculated total were externally reported passed. |
| F4 Proposal Generation | **FAIL** | Live model, payload, malformed-response, and sandbox-credit checks were externally reported passed. Discovery prefill still asks for keys F1 does not store, losing operations and strategy notes. |
| F5 Proposal Sharing | **FAIL** | Anonymous runtime controls were externally reported passed. PDF/page parity remains open: the reported match could not be confirmed as a bilingual selected-language comparison, while current source renders all PDF narratives but one selected page language. |
| F6 Lead & Quote Intake | **FAIL** | Real attachment failure cleanup was externally reported passed. Lead conversion can still partially commit; `quote_request.converted_opportunity_id` has no FK. |
| F7 Sales Pipeline | **FAIL** | Seven stages, metrics, locks, filters, and Excel numeric typing were externally/source verified. Win can partially commit its dossier, and the Kanban source silently truncates at 200 mixed-status rows. |
| F8 Campaigns | **PASS** | Approval edit lock, rejection reason, KPIs, selected tests, and real-provider email delivery were reported passed. |
| F9 Enquiries | **PASS** | Exclusive KPI bucketing, type filter, distinct replied state, and the live API/browser workflow were reported passed. |
| F10 Partnerships | **FAIL** | An exact-SHA external scenario reported DRAFT refusal, but current source still lacks profile propagation, lists all suppliers in the PO UI, and contains no supplier-status lookup in invoice posting. A scenario refusal does not establish the required status invariant. |
| F11 Success Stories | **FAIL** | Live eligible-dossier model generation and outbound financial-field exclusion were externally reported passed, but save eligibility, required dossiers, stale sign-off, and the staff workflow remain defective. |
| F12 Public Portfolio | **FAIL** | Anonymous host/live resolution, refusal behavior, tenant isolation, and limiter bursts were externally reported passed. The UI still omits the client logo, and raw media attachment IDs can expose inappropriate vault documents anonymously. |
| F13 Public Intake | **FAIL** | Anonymous host/live resolution, isolation, and limiter behavior were externally reported passed. Quote submissions still create an unlinked `quote_request`, not the required lead; contact/newsletter persistence and events remain non-atomic. |
| F14 Public Tracking | **FAIL** | Anonymous host/live resolution, cross-tenant 404, and limiter behavior were externally reported passed. Required per-stage location/reference/notes are still not faithfully represented, and the UI omits several details. |

## 4. Confirmed defects and incomplete requirements

### F1 — Live Meetings

**Implemented:**

- Meetings link to leads/clients and store discovery sections individually.
- Audio/transcription records carry explicit processing/failure status, so failed transcription is not silently represented as empty content.
- The discovery set is retrieved in one repository call.
- Selected tests cover section storage and the dictation worker contract.

**Integration defect affecting F4:**

- F1 stores discovery keys `OPERATIONS`, `PAIN_POINTS`, and `STRATEGY`.
- F4’s generator requests `BUSINESS_CONTEXT`, `PAIN_POINTS`, and `PROPOSED_STRATEGY` in `src/modules/sales/proposal/proposal.generator.js:14-15`.
- The pain-points section survives; the operations and strategy prefill values silently become empty.

F1’s own done-when behavior is accepted, including the externally reported live worker success/failure paths. Its downstream contract with F4 remains defective.

### F2 — Company Profile

**Implemented:**

- Declared and derived fields are separate.
- Document extraction returns structured suggestions requiring human confirmation.
- Derived data is computed by one SQL statement, giving it a common database snapshot.
- The query excludes cost and margin columns.
- Nightly refresh is registered; stale reads refresh; sandbox extraction returns a mock without live AI use.
- Client public-reference consent is governed through the client master flow.

**Confirmed defect:**

- `src/modules/sales/company_profile/company_profile.repo.js:51` derives `vertical_mix` by service type only. The specification explicitly requires service type **and commodity**.

**Acceptance consequence:**

- Derived figures cannot fully match the required hand-run SQL because one required dimension is absent.
- Cross-tenant isolation was externally reported passed, but it does not cure the missing commodity dimension.

### F3 — Proposal Builder

**Implemented:**

- Manual draft/create/edit behavior, commercial fields, bilingual narratives, and dictionary-linked lines.
- Enforced lifecycle `DRAFT → IN_REVIEW → SENT → ACCEPTED/REJECTED` with skipped transitions refused.
- Sending numbers and vaults the proposal.
- Acceptance computes `total_ht` from lines and inserts a linked quotation in the same explicit transaction.

**External runtime acceptance:**

- The complete manual lifecycle was reported passed against PostgreSQL, including accept-to-quotation, the hand-calculated total, and the dictionary-item relation.

No F3 acceptance defect was found.

### F4 — Grounded Proposal Generation

**Implemented:**

- Tenant company-profile facts and latest discovery are used.
- The model response has strict bilingual schema and citation validation, bounded SLA counts, retries, and manual fallback.
- Nested cost/margin/profit/purchase/unit-price keys are removed before model egress.
- Sandbox runs use the manual/mock path rather than the live model.
- Malformed model output falls back to editable narratives without a user-facing hard failure.
- Live grounded generation, outbound payload inspection, malformed fallback, and sandbox no-credit behavior were externally reported passed.

**Confirmed defect:**

- Discovery-key mismatch with F1:
  - stored: `OPERATIONS`, `PAIN_POINTS`, `STRATEGY`;
  - requested: `BUSINESS_CONTEXT`, `PAIN_POINTS`, `PROPOSED_STRATEGY`.
- The resulting draft is not grounded in the real operations and strategy notes unless those values are manually supplied in the generation request.

### F5 — Proposal Sharing

**Implemented:**

- Random signed bearer tokens are stored only as hashes.
- Public reads are sessionless and pinned to live tenant data.
- Expired, revoked, nonexistent, and invalid tokens converge on the same public 404 behavior.
- Read/download rate limiting exists.
- `viewed_at` and `downloaded_at` use `COALESCE`, preserving the first timestamp.

**Confirmed acceptance failure:**

- `src/modules/sales/proposal/proposal.document.js` generates a document independently and iterates all narratives.
- `client/src/features/sales/public-proposal.tsx` renders only the currently selected EN/FR narrative set and uses a separate branding/layout implementation.
- Therefore the vaulted PDF does not literally match the rendered public page as required.

**Runtime evidence and remaining ambiguity:**

- Anonymous access, uniform refusal behavior, tenant isolation, and limiter bursts were externally reported passed.
- A PDF/page comparison was reported as matching, but the test scope is unknown; it was not confirmed that both EN/FR narrative rows existed and one selected language was compared. The directly divergent render paths therefore remain an open acceptance issue and maintenance risk.

### F6 — Lead and Quote-Request Intake

**Implemented:**

- Lead and quote-request intake states are separate from opportunity pipeline stages.
- KPI rules account for rows by the specified buckets.
- Quote-request conversion writes the opportunity and conversion link in one transaction through the opportunity repository.
- Quote attachment upload/link cleanup is designed to remove storage if the transaction fails.
- Client conversion maps required client master fields, client type, registrations, entity, and primary contact.

**Confirmed transaction defect:**

- `src/modules/sales/lead/lead.service.js:126-190` opens a transaction and calls `client_master.service.create()` at lines 169-183.
- That called service owns its own `BEGIN`/`COMMIT` on the same connection.
- The inner `COMMIT` can commit the client before the lead update, event, or audit finishes. A subsequent failure leaves a committed client and an unconverted lead; the outer `ROLLBACK` cannot undo the prior commit.

**Externally closed resource-dependent criterion:**

- A forced real storage/database attachment failure was reported to leave neither storage/vault nor intake-link orphans.

**Confirmed schema-integrity defect:**

- `migrations/tenant/0683_sales_crm_f6_lead_intake.sql:100` declares `quote_request.converted_opportunity_id` as an unconstrained UUID.
- No later migration adds a foreign key to `opportunity(opportunity_id)`.
- The “single source of truth” can therefore contain a nonexistent opportunity ID.

### F7 — Sales Pipeline

**Implemented:**

- Seven ordered stages and default probabilities.
- Probability source rules preserve explicit/manual values.
- Settled opportunities reject further moves.
- Shared filters feed list, metrics, and export.
- Export writes BOM/CRLF CSV and leaves money cells unquoted and symbol-free so Excel can infer numeric values.
- Win/loss metrics have selected hand-calculation tests.

**Confirmed transaction defect:**

- `src/modules/sales/opportunity/opportunity.service.js` opens the win transaction, then calls transaction-owning `operations_file.service.create()`.
- Dossier creation can commit before milestone/itinerary seeding and opportunity/event/audit completion.
- Later failure can leave a dossier while the opportunity is not consistently won/linked.

**Confirmed completeness/efficiency defect:**

- `client/src/features/sales/opportunities.tsx:123-130` hard-codes `limit=200` for the board source before client-side status grouping.
- Because those 200 rows can include settled and open opportunities, older open opportunities silently disappear from the Kanban even though the API can page them.

**Verification status:**

- Excel numeric typing was externally reported passed.
- The transaction failpoint and >200-row defects remain open from direct source analysis; external Excel acceptance does not affect them.

### F8 — Campaigns

**Implemented and selected tests passing:**

- Sales-role edits are blocked while approval is pending.
- Rejection requires/records a reason.
- KPI calculations follow the specified buckets.
- Existing campaign send behavior remains exercised by `tests/unit/campaign-send.test.js`.

Real-provider email delivery was externally reported passed. No F8 acceptance defect was found.

### F9 — Contact Enquiries

**Implemented and selected tests passing:**

- KPI buckets are mutually exclusive and exhaustive under the supplied status rules.
- Enquiry type filtering exists.
- Read and replied are distinct states and response metadata is persisted.

The live API/browser workflow was externally reported passed. No F9 acceptance defect was found.

### F10 — Partnerships and Vendor Onboarding

**Implemented:**

- Required intake fields, filters, and KPI support exist.
- Approving `VENDOR_REGISTRATION` creates/reuses a DRAFT supplier.
- Duplicate supplier matching is performed before creation.
- The supplier is back-linked to the request.
- No accounting account is allocated on DRAFT creation.
- Purchase-order backend validation rejects non-verified suppliers.

**Confirmed incomplete requirement:**

- `corporate_profile_ref` is not propagated into the created supplier’s vault/document relationship, despite the requirement that the draft supplier carry the uploaded profile document.

**Confirmed UI/backend mismatch:**

- The purchase-order UI loads supplier choices without filtering to verified suppliers.
- Users can select DRAFT suppliers and only encounter backend rejection when submitting.

**Confirmed financial-control defect:**

- `src/modules/procurement/supplier_invoice/supplier_invoice.service.js:79-103` posts invoices without querying or validating supplier registration status.
- The path can create a posted payable/GL entry for the DRAFT supplier produced by partnership approval once its other posting prerequisites are satisfied.
- An exact-SHA direct-API scenario was externally reported to refuse a DRAFT supplier, but no status-specific guard exists in this source path; a refusal caused by another precondition does not establish the required invariant.
- This violates the explicit design promise that nothing becomes payable before supplier verification.

### F11 — Success Stories Builder

**Implemented:**

- Structured fields: headline, executive summary, operations execution, KPI pairs, slug, client, service category, cover, logo, gallery.
- Multi-dossier join table and readback.
- Eligible query restricts to `COMPLETED`, `FINANCIALLY_PENDING`, and `CLOSED`.
- AI selection query excludes financial columns at source.
- Sandbox/manual fallback and governed model usage.
- Navigation entry.
- Sign-off-before-publish gate.
- F12 anonymises clients whose consent is not `NAMED`.

**Confirmed backend integrity defects:**

1. `success_story.service.create()` and update accept zero dossier IDs.
2. Save does not verify that submitted dossier IDs belong to the eligible completed set; the eligibility check occurs only in AI generation.
3. `replaceDossiers()` deletes all prior links before inserting the submitted list. There is no dossier-required guard.
4. Editing does not clear `signed_off_by` or otherwise force renewed sign-off.
5. A previously signed story can therefore have content, client, media, KPIs, or dossiers changed and still pass publish under stale approval.

**Confirmed staff-workflow incompleteness:**

- `client/src/features/sales/success-stories.tsx` asks users to type comma-separated dossier UUIDs and vault UUIDs and raw KPI JSON.
- It does not provide the required eligible-file picker, client selector, governed generation workflow, or cover/logo/gallery upload workflow.
- The displayed `AiActions` entries are descriptive scaffold actions and are not wired to `/success-stories/generate`.

**Confirmed UI robustness defect:**

- `JSON.parse(kpis)` executes while constructing the request body before the `try` block (`success-stories.tsx:84-92`). Invalid KPI JSON throws outside the request error handling and can leave the form in a busy state without the normal error display.

**Externally closed resource-dependent criterion:**

- Live model generation from eligible dossiers and outbound inspection excluding cost/margin fields were reported passed.

**Additional completeness risk:**

- The eligible query has a fixed `LIMIT 200`; even after a picker is added, older eligible files would need paging/search to avoid silent omission.

### F12 — Public Portfolio

**Implemented:**

- Anonymous list/detail endpoints, live environment pinning, published-only queries, explicit response allow-lists, and read rate limiting.
- Missing and unpublished slugs use the same application 404.
- Non-`NAMED` clients receive an anonymised name and no logo URL.
- List payload is deliberately thin; detail returns the structured public fields.
- Public grid and detail pages exist.

**Confirmed UI omission:**

- The API returns `client_logo_url`, but `client/src/features/sales/public-portfolio.tsx` never renders it on either page.

**Confirmed public-media control defect:**

- `portfolio_public.service.media()` authorises a vault ID solely because it appears in a published story’s cover/logo/gallery columns.
- Story save accepts raw vault UUIDs without verifying image MIME type, ownership/purpose, or a public-media classification.
- The public route explicitly serves `.pdf` files as PDF and guesses other content types from the path.
- Consequently, attaching a same-tenant confidential document ID to a published story can make it anonymously downloadable.

**Externally closed runtime criteria:**

- Production-like anonymous host/live resolution, no-session access, refusal behavior, cross-tenant isolation, and limiter bursts were reported passed.
- Explicit source allow-lists remain the evidence that internal story columns are not serialized.

### F13 — Public Intake

**Implemented:**

- Four anonymous write endpoints: quote, contact, partnership, newsletter.
- Requests are pinned to live tenant data, rate-limited, bounded by strict validators, source-stamped as website intake, and protected by honeypot/timing anti-bot checks.
- Newsletter subscription uses an upsert.
- Public quote attachments are rejected instead of accepting ungoverned binary uploads.

**Confirmed done-when failure:**

- Quote submission calls the quote-request intake and creates a `quote_request` with `lead_id` unset.
- It does not create a lead or link one.
- The specification explicitly says quote submissions must land as leads; that criterion is false.

**Confirmed atomicity defects:**

- Contact intake persists the enquiry, then emits its event as a separate subsequent operation.
- Newsletter intake performs an autocommitted upsert, then emits its event.
- If event emission fails, the data remains committed while the HTTP request fails, inviting retry ambiguity and inconsistent downstream behavior.

**Externally closed runtime criteria:**

- Production-like anonymous host/live resolution, no-session access, cross-tenant isolation, and limiter behavior were reported passed.

**Scope note:**

- No public marketing-form frontend using `/public/intake` was found in this repository. The F13 Build/Done-when text directly requires the four endpoints rather than an in-repository public form UI, so the absence of that UI was not treated as a standalone acceptance failure.

### F14 — Public Shipment Tracking

**Implemented:**

- Anonymous exact-reference lookup, live environment pinning, rate limiting, parameterised SQL, and uniform not-found application behavior.
- Only `is_client_visible` milestones are selected.
- Origin/destination fallback changes for air, sea, and hinterland service types.
- Computed overall progress and current stage are returned.

**Confirmed data-model/response defects:**

- Milestone instances have no persisted public stage-location or stage-reference fields.
- The service returns `location: null` for every stage.
- It returns `stage_reference: x.code`, which is the milestone code, not an actual operational reference.
- It aliases internal `cause_note` as public `progress_note`; this is not a dedicated client-safe public note and can expose internal exception commentary.
- The top-level response includes the raw dossier status as `status` in addition to `computed_status`, exposing internal lifecycle vocabulary to an anonymous caller.

**Confirmed UI incompleteness:**

- The public page omits current-stage details, completion timestamps, location, stage references, and progress notes even where returned.
- It displays raw `status` rather than the computed public status.

**Externally closed runtime criteria:**

- Cross-tenant identical-404 behavior, host/live resolution, anonymous access, and burst limiting were reported passed.

## 5. Block A audit

### Verified

- Migration numbering gate passed.
- Migration reversibility gate passed.
- Migration idempotency static gate passed.
- Destructive-migration declaration gate passed.
- Schema-drift gate passed.
- New Sales/CRM migrations are represented as SQL migrations rather than runtime schema mutation.
- Tenant modules use tenant database connections rather than explicit shared-schema queries in the audited paths.
- Existing route/service/repository/validator/event/AI conventions are generally followed according to operation type; the public modules follow the existing careers public-module pattern.
- Full local backend CI passed all 16 gates.
- All ten client gates passed.
- Platform-console lint and production build passed after installing its lockfile dependencies.

### Externally accepted infrastructure and remaining block

- **Migration apply-twice:** externally reported passed; the second application produced zero new files.
- **Tenant isolation:** externally reported passed, including the public anonymous surfaces.
- **Full infrastructure:** PgBouncer behavior, Chromium end-to-end, and Docker image/runtime checks were externally reported passed.
- **Remaining Block A failure:** F6 lead conversion and F7 opportunity win still contain nested transaction/early-commit defects in current source.

## 6. Verification results

### Passed

- Targeted backend Sales/CRM tests: **23 suites, 255 tests passed**.
- Targeted client tests: **3 files, 6 tests passed**.
- Full local backend CI: **16/16 gates passed**.
- Client CI: **all ten client gates passed**; platform-console’s test gate is a configured no-op.
- Platform-console lint: **0 errors, 9 warnings**.
- Platform-console production build: **passed**.
- Migration static gates: numbering, reversibility, idempotency, destructive declarations, schema drift — **passed**.
- External PostgreSQL migration apply-twice — **reported passed; second apply produced zero new files**.
- External tenant-isolation checks — **reported passed**.
- External PgBouncer, Chromium end-to-end, and Docker image/runtime checks — **reported passed**.
- Live F1 transcription, F2 vision, F4 proposal AI, and F11 story AI checks — **reported passed**.
- F7 Excel numeric typing, F8 real-provider email delivery, F3 lifecycle, F6 attachment rollback, and F9 browser workflow — **reported passed**.
- F5/F12/F13/F14 anonymous host/live, isolation, refusal, and limiter runtime controls — **reported passed**.

### Why green tests do not overturn the findings

The relevant tests are often validator, pure-rule, source-string, or mocked-service tests. In particular:

- F3’s runtime lifecycle is externally accepted, but its repository unit test alone still does not provide that proof.
- F5’s exact bilingual selected-language PDF/page parity remains ambiguous despite a reported match.
- F6/F7 source still exposes partial-commit paths; a passing happy-path or attachment rollback test cannot prove those paths safe.
- F7 has no >200-row Kanban regression test; Excel typing is externally accepted.
- F10’s externally observed refusal does not prove a supplier-status invariant because invoice posting performs no such lookup.
- F11’s live AI path is externally accepted, while its save/sign-off/UI defects remain source-visible.
- F12–F14 public runtime controls are externally accepted, while their response/media/UI defects remain source-visible.
- F13 public runtime controls are externally accepted, while quote-to-lead and event atomicity remain source-visible.

## 7. External acceptance evidence supplied by the user

The following checks, which could not be provisioned inside this workspace, were reported passed externally:

- PostgreSQL migration application twice, with the second application producing zero new files.
- Two-tenant isolation.
- PgBouncer behavior, Chromium end-to-end, and Docker image/runtime checks.
- F1 live transcription success and forced-failure display.
- F2 live vision extraction, confirmation, and sandbox no-credit behavior.
- F3 full manual lifecycle through quotation and calculated total.
- F4 live grounded generation, outbound cost/margin inspection, malformed fallback, and sandbox no-credit behavior.
- F6 attachment/storage failure cleanup.
- F7 CSV opened in Excel with numeric money cells.
- F8 real-provider campaign email delivery.
- F9 live browser/API KPI, filter, and replied-state workflow.
- F11 eligible-dossier live generation with financial-field exclusion.
- F5/F12/F13/F14 anonymous host/live resolution, no-session access, cross-tenant/refusal behavior, and limiter bursts.

Two supplied outcomes do not close contradictory source findings:

1. **F5:** a PDF/page match was reported, but the tester could not confirm that the case contained both EN/FR narratives and compared the PDF against one selected language. Current source still has divergent render sets.
2. **F10:** an exact-SHA direct-API scenario reportedly refused a DRAFT supplier, but current invoice-posting source performs no supplier-status query. That observed refusal may have come from another prerequisite and does not establish the required invariant for all valid posting inputs.

The externally supplied results are accepted as runtime evidence. The remaining open findings are implementation defects that can be closed in this repository without further infrastructure, followed by targeted regression and final external reruns where appropriate.

## 8. Risks distinct from confirmed acceptance defects

1. **Public document disclosure impact is conditional:** the missing F12 media validation is confirmed; disclosure occurs if an inappropriate vault ID is attached to a published story.
2. **Retry ambiguity in F13:** a caller can receive a failed request after persistence succeeded, then retry and create duplicate contact intake or inconsistent event history.
3. **Approval semantics in F11:** stale sign-off makes audit history misleading even where published content itself is valid.
4. **Scale risk:** F7’s 200-row board source and F11’s 200-row eligible source are hard limits, not pagination/search contracts.
5. **Public note semantics:** treating operational `cause_note` as a public tracking note risks leaking internal blame, exceptions, or commentary.
6. **Unbounded public portfolio list:** the payload is thin as required, but it is not paginated; large tenants may eventually need paging/caching.

## 9. Unrelated/pre-existing issues and collateral-regression assessment

- `npm ci --prefix platform-console` reported **8 dependency vulnerabilities**: 4 moderate and 4 high. This is dependency-audit output, not evidence that F1–F14 introduced a functional regression.
- Platform-console lint completed with **9 warnings and no errors**.
- Migration numbering reported only grandfathered collisions at `0470` and `0475`; no new numbering failure was found.
- No failing selected test or CI gate demonstrated damage to unrelated contributor work.
- The F10 procurement consequences and F6/F7 operations-file consequences are treated as current cross-module feature defects, not silently attributed to unrelated contributors.
- No unrelated code was modified during this audit.

## 10. Verified non-regressions

- F8 campaign-send selected tests remain green.
- Existing supplier UI selected tests remain green, although they do not cover the F10 DRAFT-supplier control gaps.
- Opportunity board selected tests remain green, although they do not cover >200 rows.
- Sales 360 loading selected tests remain green.
- Backend and client local CI remain green.
- Platform-console lint/build remain green.
- The source tree stayed clean and synchronized with `origin/main` throughout the audit; the requested report is now the only untracked repository file.

## 11. Recommended remediation order

1. **Close public/financial exposure first:** F12 media validation and F10 supplier-invoice verification gate/profile propagation.
2. **Repair atomicity:** use one transaction owner for F6 lead conversion and F7 win/dossier creation; add failure-injection tests.
3. **Protect publication approval:** require at least one eligible dossier, validate every dossier on create/update, and clear sign-off after any material edit.
4. **Correct public tracking:** add/migrate dedicated location, stage-reference, and client-safe progress-note fields; remove raw dossier/cause-note exposure; render all required fields.
5. **Meet the intake contract:** create/link the required lead for F13 quote intake and make persistence/event emission atomic.
6. **Restore data completeness:** fix F4’s discovery key mapping, F2’s commodity dimension, and F7 board paging.
7. **Unify proposal rendering:** generate both F5 PDF and public page from one language-aware view model/template.
8. **Finish workflows:** build the F11 picker/client/generation/media UX and render F12 client logos.
9. **Rerun only impacted acceptance after fixes:** the broad external infrastructure suite is already reported passed. Recheck changed transaction paths, F5 with a bilingual selected-language fixture, F10 with a status-specific refusal assertion, and each affected public/browser flow.

## 12. Repository integrity

After the user-requested report addition and external-evidence revision:

- branch: `main`
- local `HEAD`: `2c86cc714d2d0dc9ddbcbd737fa40b6c25372592`
- `origin/main`: `2c86cc714d2d0dc9ddbcbd737fa40b6c25372592`
- source-code changes: none
- report added as the only repository change: `doc/SALES_CRM_ACCEPTANCE_AUDIT_2026-08-16.md` (untracked until committed)
