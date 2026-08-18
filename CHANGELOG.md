# Changelog

All notable changes to Praxis LS.

**Why this file exists (TC-R1).** There was no unit of "a release" in this
system — no tags, no GitHub releases, no changelog, and all three
`package.json` files frozen at `0.1.0` across 93 CI runs and 44 production
deploys. Every commit was silently a deployment, and the only way to answer
"what changed between Tuesday and Thursday?" was to read `git log` and hope the
messages were useful. They often were not: the merge commits — the ones a
changelog would be built from — include _"Lots of changes"_, _"a lot"_ and
_"audit portan and opportunities board list"_ (TC-R4).

**How to use it.** Add a line under `## Unreleased` in the same PR as the
change. At release time, rename that heading to the version and date, tag the
commit (`git tag -a v0.2.0 -m "..."`), and start a fresh `Unreleased`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Dates are ISO-8601, UTC.

---

## Unreleased

### Added

- **The employee 360° is now the full record (10708).** The profile grew
  Payroll (payslips per period with the standard PDF), Advances (amount,
  recovered, outstanding and the recovery plan) and Sanctions tabs, and the
  Contracts tab gained **Renew**: one click creates a NEW draft contract that
  supersedes the signed one — terms carried over, new term starting the day
  after the old one ends and keeping its length, both dates overridable. The
  signed wording is never copied into the renewal, because it carries the old
  dates; the new DRAFT is exactly the state redrafting exists for.
- **Appraisals gained manual scoring beside the AI score.** Each KPI line in a
  review now has an editable rating input the manager types into (commit on
  Enter/blur, ✕ to clear and follow the evidence suggestion again). The
  manager's number and the evidence-derived suggestion stay in separate
  columns permanently — a human may disagree with the model, and the system
  now records when they did (`rated_at`).
- **SOPs are documents you can read and draft.** The "New SOP" form collects
  the facts the company knows — scope, owning role, effective date, the
  purpose in their own words and the steps they already have — and the AI
  writes the standard professional document (Purpose, Scope, Responsibilities,
  Procedure, Records, Compliance) around them, never inventing a clause the
  company didn't state; where the material is thin the document says
  "To be completed:" instead of guessing. Clicking any procedure in the
  register opens the generated document, editable and re-draftable, with a
  Render PDF step that files it in the vault.
- **Trainings record the whole meeting.** A "Record meeting" button on the
  session panel starts before the meeting and captures everything; the stream
  is sliced every ~25 s, each slice transcribed and appended to the session's
  transcript, and "Draft minutes with AI" folds the transcript + notes into
  the minutes. The trainings screen also gained bottom padding so the last
  table no longer sits flush against the viewport edge.
- **Delivery prefill now picks up GROUPED containers.** A file that states
  "3 × 40' HC" (container lines, no per-box numbers yet) now prefills the
  delivery note with that line — type, quantity and remaining count — and the
  printed manifest renders it as the file states it. Boxes another note
  already covers are flagged (`already_on`) and no longer auto-ticked, so a
  twice-delivered box is a deliberate split load, not an accident.
- **The milestones Templates tab is now a register you can act on.** Each
  template lists its service type, version, stage count and every stage with
  its due offset, weight, owner tier and flags (anchor, SLA-locked, internal
  only, needs proof, auto-advance) — with a plain-English explanation of what
  a template does. And the dead list is dead no longer: **New template**
  publishes a first chain for any service type from this screen (the picker
  surfaces the ones with no chain), **Edit chain** opens the full stage editor
  seeded from the CURRENT version — so re-publishing does not silently revert
  it to the shipped default — and **Activate** rolls a superseded version back
  instead of minting a byte-identical new one.

- **Partnership and vendor applications are vetted, and an approved vendor
  stops being re-typed (F10).** `partnership_request` was five columns against a
  form that vets forwarding agents: no country, no contact title, and no
  network memberships — which is the field an agent is actually vetted on. It
  now carries all three (memberships as a jsonb array, GIN-indexed, so "who
  claims WCA" is one query), the applicant's corporate profile as a vault
  document rather than a filename concatenated onto a public directory in the
  browser, capped internal notes, and a decision that records who made it and
  why (a rejection without a reason is refused by the database). The status
  vocabulary moves to the legacy API's own NEW / IN_REVIEW / APPROVED /
  REJECTED and existing rows are translated, so one state does not end up with
  two names. Approving a VENDOR_REGISTRATION now opens a DRAFT supplier in the
  same transaction — the legacy printed "approved vendors must be manually
  onboarded", which is a limitation dressed as a control; the real control is
  that a DRAFT supplier has no auxiliary accounting account and, as of this
  change, cannot be put on a purchase order until somebody holding the approve
  permission verifies it. An existing supplier of the same name is reused, and
  a unique index makes that true under concurrency. An agency partnership opens
  a supplier only when the approver asks. New register at /sales/partnerships
  with the four KPI tiles computed from two partitions the API proves add up.
  Migration `0688_sales_crm_f10_partnership.sql`.
- **BREAKING:** `/api/tenant/intake/partnerships*` → `/api/tenant/partnership-requests*`.
  Partnership requests are their own module (`sales/partnership_request`);
  contact enquiries keep `/intake/enquiries`. Nothing in `client/` called the
  old paths. The AI manifest key `review_partnership` is now
  `review_partnership_request`, plus `get_partnership_request`,
  `create_partnership_request` and `approve_partnership_request` — re-run
  `node scripts/ai/sync-actions.js` to rebuild `ai_action_catalogue`.
- **Operation-file references stop being guessable.** A dossier reference is the
  one number in this system a CLIENT holds, and it was sequential:
  `SLAS-OPS-2026-0142` tells whoever holds it how many files we opened this year,
  roughly where theirs sits, and that `…-0141` and `…-0143` are worth trying. New
  files now get `SL7Z3K9QW2M4XBSM` — an entity prefix, a 60-bit
  `crypto.randomBytes` core in Crockford Base32, and a service-type code — which
  is the legacy `SL6721864SM` convention modernised rather than discarded. The
  allocator owns generate → write → retry as one step, so the unique index on
  `dossier.ref` is the only thing that decides a collision (a savepoint per
  attempt, because a 23505 otherwise poisons the caller's transaction). References
  are allocated by the backend alone: `service.create` used to take one from its
  payload, which three of its four callers — including the AI action registry —
  could set. Once allocated a reference never changes: updates that carry a
  different `ref` are refused, and status, service-type and entity changes leave it
  alone. **Financial and statutory numbering is untouched** — invoices, receipts,
  journal entries and tax documents keep their gap-free `doc_sequence` numbers,
  which is what reconciliation needs. Every existing reference stays valid, nothing
  is rewritten, and search reaches all three schemes (including the display
  spelling `SL-7Z3K9QW2M4XB-SM`). Entity prefixes and service codes are seeded for
  existing rows by migration `0682`, editable until the first file uses them, and
  audited when changed — on the entity dossier and the Service Type form
  respectively.
- **Structured client discovery on meetings (MOD-21, Sales & CRM F1).** A
  meeting against a lead is now captured in the three named sections of the
  Client Discovery Framework — business and operations context, pain points,
  proposed strategy — instead of one free-text box, because those three sections
  are what a proposal is later drafted from and free text is not data. Each can
  be typed or dictated; dictation runs through the existing `ai-transcribe`
  worker, which is the half that was missing (`meeting.transcript_vault_id` used
  to be read off the request body, so the flag "this meeting has a transcript"
  was an assertion the caller made about itself — only the worker writes it now).
  The scripted probing questions above each box are seeded rows in EN and FR,
  editable per tenant, not markup. Meeting location is captured. A section whose
  audio failed to transcribe says so on the record rather than sitting blank, and
  a lead's latest discovery set is one call (`GET /meetings/discovery/lead/:id`).
  Migration `0681_meeting_discovery.sql`.

- **Change your own password (`POST /api/tenant/auth/change-password`).** The
  third leg of the password story, and the one that was missing: recovery by
  email covered "locked out" and `POST /users/:id/password` covered "someone
  else's account", but an ordinary user who simply wanted a different password
  had no route — the admin one is behind the MOD-67 edit grant, so most users
  could only rotate their credential by mailing themselves a reset link, and
  only while outbound mail was healthy. The new endpoint verifies the current
  password with the same Argon2id compare login uses (a live access token is
  deliberately not sufficient proof), applies the full password policy to the new
  one, voids any outstanding reset links, and force-signs-out every OTHER session
  while keeping the caller's. Rate limited per user, not per IP — the caller has
  already proved who they are, so the only budget a key can exhaust is their own.
  Surfaced as a **Password** card on Security → My security.

- **Tax rates & jurisdictions is now a working 360 (MOD-07).** The screen that
  feeds every invoice's VAT/WHT postings — account determination reads the
  effective-dated `tax_code` at the entry date — becomes a jurisdiction → dossier
  master-detail, with a tab per tax family (TVA / IS / retenues / paie / autre)
  showing each code's current effective rate and full version timeline. Fixes the
  write path that made no-code amendment impossible: the Add-code **Kind** dropdown
  sent `TVA/IS/MIN_TAX/PATENTE` — values the API enum rejects — so TVA and IS
  codes could not be created from the UI at all; kinds are now the canonical
  `VAT/WHT/INCOME/PAYROLL/OTHER` shown with Cameroon labels (the instrument stays
  in the Code field). Adds GL posting-account pickers, a base-rule field, and a
  **structured brackets/caps editor** for the IRPP progressive scale, CNPS caps and
  work-injury risk classes (previously seed-only JSON). A new **Amend rate** action
  wires the existing atomic `supersedeCode` to
  `POST /tax-jurisdictions/:id/codes/supersede` — expire the current row, open the
  new one, in one transaction — so a Finance-Law change is a new version, never an
  overwrite.
- **Counterparty governance (PR3-C).** The dedup detection shipped in §5.1 now
  has its UI (an amber "Possible duplicates" panel on both create forms and at
  the top of the 360), plus: a **governed merge** (`party_merge/`) that
  reattaches every FK loser→survivor by catalogue discovery, preserves the
  loser's names as `party_alias` rows, soft-archives the loser
  (`registration_status='ARCHIVED'`, `merged_into_id`) rather than deleting it,
  deactivates its aux account and re-points its open compliance flags —
  CEO/Admin only, routed through a maker-checker in Live; **copy-from-origin**
  for a converted party (`cloneFromOrigin`); 360 **deep links**, inline-SVG
  **charts** and the **supplier AVL scorecard**; an audited **masked-bank
  reveal**; a **sensitive-field maker-checker** (bank / legal name / tax
  registration / credit limit / status changes become pending change requests in
  Live, applied on a second authorization); and a transactional
  `compliance.assertAllowed` **gate** wired at dossier and PO creation
  (migration `0517`).

### Security

- Access tokens now respect session revocation — killing a session, the idle
  timeout, or refresh-reuse detection ends the token immediately rather than
  leaving it valid for up to 15 minutes (`SEC-M1`).
- The Socket.IO handshake resolves the tenant from the Host header in
  production; a client can no longer name its own tenant (`SEC-M4`).
- The `runtime` and `worker` containers run as an unprivileged user instead of
  root (`SEC-L1`). **Operational note:** the first deploy after this chowns
  `./media`, `./uploads`, `./logs` and `./data` to uid 1000.

### Added

- **Delivery notes: whole-row click opens the snapshot modal, and the document page shows the real note in the app theme.** The delivery-notes list now opens its detail modal on a click anywhere in the row (the same `onRowClick` gesture as the transit-orders list, with the ref cell as the keyboard/AT activator). The document page (`/documents/DELIVERY_NOTE/:id` and `/documents/TRANSIT_ORDER/:id`) gains bespoke **native** renderers — consignee, delivery details, container manifest, cargo, reservations and the named received-by block for delivery notes; shipment facts, five-column cargo with declared value, customs regime, insurance/surveyor elections and the attached-document checklist for transit orders — block-for-block with the PDF template but rendered in the app theme, since the white print sheet does not blend with the dark UI. The generic card body was the defect for these two documents: it had no vocabulary for containers, reservations, vessel, regime or checklist. Download PDF is unchanged (vaulted, QR-verifiable). Edit-while-DRAFT was already fully wired (detail modal Edit button gated on `DRAFT` → `PATCH /delivery-notes/:id` with header + lines + containers; `rules.EDITABLE` is exactly `{DRAFT}`) and is verified end-to-end by the delivery-note lifecycle tests.

### Added

- **System-email fallback sender** (the two-config email model, `doc/EMAIL_TWO_CONFIGS.md`). System emails (OTP, invites, invoices, notifications) now fall back to a Praxis-owned sender — `no-reply@praxisls.com` / `support@praxisls.com` — sent through the deploy-wide SMTP when a tenant hasn't configured their own mail, so tenants who haven't pointed their DNS at us never lose system mail. The fallback is configured + live-tested in the **Platform Console → Integrations → System-email fallback sender** (platform `mail.fallback` setting, password encrypted at rest), with env `SMTP_*` / `MAIL_*` as last-resort defaults (`migration 0091`). Fixed `MAIL_DEFAULT_FROM` being referenced but undefined; `MAIL_FALLBACK_DOMAIN` default is now `praxisls.com`.
- **Mailbox is now reachable in the Comms workstation**: `Comms → Mailbox` (`/comms/mail`) mounts the existing provider-agnostic mailbox UI (Microsoft 365 / Google / IMAP-SMTP, inbound + outbound) alongside Smart Comms chat and Setup; `Comms → Setup` now explains the two-config split (system email vs mailbox) and the fallback.
- `dossier.title` — the sales→operations handoff has never worked, because two
  services wrote a column the table did not have (`NEW-08`, migration `0508`).
- Backend coverage is measured in CI, with the threshold expressed in functions
  rather than lines (`TC-CI3`, `TC-Q1`).
- `.env.example` is reconciled against the config schema in CI, and the
  environment is now validated _before_ migrations rather than after
  (`TC-E1`).
- Destructive migrations must carry an explicit `-- DESTRUCTIVE:` marker
  (`OBS-I3`).
- Deploys record which commit shipped, when, by whom, and whether they finished
  (`TC-R3`); a deploy can be pinned to a named commit (`TC-D7`); an opt-in
  `AUTO_ROLLBACK=1` reverts a build that fails its readiness gate (`OBS-I4`).

### Changed

- Lint blocks the build, as a ratchet against the current warning count rather
  than an unachievable zero (`TC-CI10`).
- `npm audit` blocks at high severity, with a dated exception for the known
  `exceljs` transitive finding instead of a permanent bypass (`TC-CI4`).
- CI has a concurrency group, so two rapid pushes no longer produce two deploys
  ordered by completion time (`TC-D8`).

### Fixed

- **PDF preview on client / supplier / corporate-entity document uploads showed
  Chrome's "This content is blocked" interstitial.** `FileDrop` previewed a
  picked PDF in a `sandbox=""` iframe pointed at a `data:` URL. Chrome's built-in
  PDF viewer is a plugin, so Helmet's default `object-src 'none'` and the empty
  sandbox (no plugin token exists) both refuse it — images kept working because
  they render in `<img>`. Previews now paint pages onto a canvas via pdf.js
  (loaded on demand, left out of the vendor chunk) so the operator can confirm
  they picked the right scan before submitting. A render failure still offers
  "Open in a new tab", which is top-level navigation and is not subject to
  `object-src`.
- **Saved dates came back blank on every edit form, and could not be re-saved
  (`NEW-11`).** node-postgres parsed a `date` column into a JS `Date` at midnight
  in the API's timezone, so `res.json()` sent `2021-09-20T23:00:00.000Z` for a
  registration issued on the 21st: the wrong day, in a format
  `<input type="date">` cannot render. Re-opening a corporate entity or one of
  its registrations, documents or tax registrations therefore showed an empty
  Issued on / Expires on for dates that were saved, and pressing Save posted the
  timestamp back — `issued_on: Use the format YYYY-MM-DD., That date doesn't
exist.` on a field nobody had touched. `date` columns now arrive as the
  `YYYY-MM-DD` string Postgres sent (`src/shared/db/pg-date-types.js`), which is
  the format the shared `isoDate` schema validates and the date inputs expect, so
  the value round-trips unchanged. `dateFmt` reads a bare date as a calendar date
  rather than a UTC instant, and the entity and nested-child forms normalise
  whatever they are seeded with, so a timestamp reaching a date control degrades
  to the right day instead of a blank box. Applies to every `date` column in the
  product, not only master data; `timestamptz` columns are unaffected.
- `win({ createDossier })` and the `opportunity.won` handler both 500'd or
  dead-lettered on every run (`NEW-08`).
- Client test suite: a test that could only run on Linux, a Zod instance split,
  a timezone-dependent assertion, and a shell rendered without the app's
  providers (`NEW-12`).

---

## 0.1.0

The state of the system at the time of the Phase-0 audits (2026-08-04). Recorded
as a baseline so `Unreleased` has something to be relative to; the history
before this point is `git log`.
