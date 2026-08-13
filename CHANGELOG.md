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
