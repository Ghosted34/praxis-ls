# Changelog

All notable changes to Praxis LS.

**Why this file exists (TC-R1).** There was no unit of "a release" in this
system — no tags, no GitHub releases, no changelog, and all three
`package.json` files frozen at `0.1.0` across 93 CI runs and 44 production
deploys. Every commit was silently a deployment, and the only way to answer
"what changed between Tuesday and Thursday?" was to read `git log` and hope the
messages were useful. They often were not: the merge commits — the ones a
changelog would be built from — include *"Lots of changes"*, *"a lot"* and
*"audit portan and opportunities board list"* (TC-R4).

**How to use it.** Add a line under `## Unreleased` in the same PR as the
change. At release time, rename that heading to the version and date, tag the
commit (`git tag -a v0.2.0 -m "..."`), and start a fresh `Unreleased`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Dates are ISO-8601, UTC.

---

## Unreleased

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

- **System-email fallback sender** (the two-config email model, `doc/EMAIL_TWO_CONFIGS.md`). System emails (OTP, invites, invoices, notifications) now fall back to a Praxis-owned sender — `no-reply@praxisls.com` / `support@praxisls.com` — sent through the deploy-wide SMTP when a tenant hasn't configured their own mail, so tenants who haven't pointed their DNS at us never lose system mail. The fallback is configured + live-tested in the **Platform Console → Integrations → System-email fallback sender** (platform `mail.fallback` setting, password encrypted at rest), with env `SMTP_*` / `MAIL_*` as last-resort defaults (`migration 0090`). Fixed `MAIL_DEFAULT_FROM` being referenced but undefined; `MAIL_FALLBACK_DOMAIN` default is now `praxisls.com`.
- **Mailbox is now reachable in the Comms workstation**: `Comms → Mailbox` (`/comms/mail`) mounts the existing provider-agnostic mailbox UI (Microsoft 365 / Google / IMAP-SMTP, inbound + outbound) alongside Smart Comms chat and Setup; `Comms → Setup` now explains the two-config split (system email vs mailbox) and the fallback.
- `dossier.title` — the sales→operations handoff has never worked, because two
  services wrote a column the table did not have (`NEW-08`, migration `0508`).
- Backend coverage is measured in CI, with the threshold expressed in functions
  rather than lines (`TC-CI3`, `TC-Q1`).
- `.env.example` is reconciled against the config schema in CI, and the
  environment is now validated *before* migrations rather than after
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
