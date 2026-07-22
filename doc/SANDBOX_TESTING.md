# Sandbox Testing — seed data + the full test flow

_Companion to `scripts/tenant/seed-sandbox.sql` + `scripts/tenant/seed-sandbox.js`._

The goal: get a tenant's **sandbox** schema populated with realistic Cameroon
freight-forwarder data so every built screen shows something, then walk the whole
app end-to-end without risking live data.

## 0. What the seed gives you (and what it deliberately doesn't)

The seed writes a full business dataset into the **sandbox** schema only: 2
corporate entities, 6 clients, 5 suppliers, 8 employees, 8 dictionary items (with
posting rules), 3 treasury accounts, 3 service types + a milestone template, 5
dossiers at different stages, the sales funnel (leads → meetings → campaigns →
opportunities across every pipeline stage → proposals), commercial (costings,
quotations, a margin sim, an extra-charge sim, a pricing-variance flag),
finance documents, fixed assets, the full fleet (vehicles, compliance,
fuel, dispatch, licences, work orders, incidents), WMS (locations, inbound,
inventory, movements, outbound, equipment, cycle count), procurement (PR → PO →
GRN), and HR (payroll run, leave, attendance, vacancies/applicants, contracts,
appraisals, SOPs, onboarding, trainings, talent pool, succession).

**It does not post to the general ledger.** Because it's direct SQL (not the
service layer), it does **not** write `journal_entry` / `journal_line` rows — that
keeps it clear of the ledger invariant triggers (balanced / gap-free `entry_no` /
mandatory `source_doc_ref`). So finance documents (invoices, receipts, advances,
depreciation) are seeded in **pre-posting states** with `entry_id = NULL`.

Consequence: **Trial balance, financial statements, and true receivables ageing
are empty until you post real entries** — and posting is exactly what you should
test through the app (Section 3, step F). The seed sets `cached_receivables` /
`cached_overdue` on clients so the receivables list and dashboard tiles still show
numbers before you post anything.

User FKs (`owner_user_id`, `organiser_id`, …) are left NULL — sandbox has no
`app_user` rows (auth runs off the live/identity schema). Employee links are real.

## 1. Prerequisites

- The tenant is provisioned and migrated: `npm run db:provision -- --slug=smartls --name="Smart Logistics"` (already done for `smartls`).
- Platform + tenant migrations current: `npm run db:migrate:platform` then `npm run db:migrate:tenants`.
- An admin/CEO user exists to log in with: `npm run tenant:create-admin -- --slug=smartls ...`.
- `.env` points at your Postgres (the seed reuses the same connection helper as the migrator).

## 2. Run the seed

Node runner (recommended — same DB resolution as the migrator):

```
node scripts/tenant/seed-sandbox.js --slug=smartls
```

or straight psql:

```
psql "postgresql://<user>:<pw>@<host>:5432/tenant_smartls" -v ON_ERROR_STOP=1 -f scripts/tenant/seed-sandbox.sql
```

It's idempotent — it no-ops if entity `SBX` already exists. To reseed from a clean
slate: `npm run db:sandbox:wipe -- --slug=smartls` (rebuilds the sandbox schema +
config seeds), then run the seed again.

**Optional — populate the ledger too (money-path seeder).** The SQL seed above
deliberately leaves the GL empty (Section 0). To also generate *posted* financial
data (so Statements / General Ledger / true ageing light up automatically), run the
API-driven money-path seeder with the API server up — it logs in and drives the real
endpoints (advance → invoice submit/post → receipt → payroll compute→validate →
asset depreciation), all in sandbox:

```
node scripts/tenant/seed-money-path.js --slug=smartls --email=<admin> --password=<pw>
```

It refuses to run against a live tenant (the sandbox header is ignored there), and
every step is independent + logged, so an approval-gated step never blocks the rest.
This automates Section 3.F below.

## 3. The full test flow

Log in, then **switch to TEST mode** in the top bar (the LIVE/TEST toggle — it
flips `X-Praxis-Env` to `sandbox` and reloads). Everything below is sandbox data;
nothing you do here touches live.

**A. Master data & config.** Corporate entities (2, with bank block + logo
fields), Clients (6, check credit limits + cached receivables), Suppliers (5, incl.
a MoMo supplier and a non-resident), Employees (8, 2 flagged drivers), Financial
dictionary (8 items — confirm each has a posting rule), Treasury accounts (3).

**B. Sales & CRM.** Leads board (4 across statuses) → Meetings (+ minutes) →
Campaigns (2) + subscribers → Opportunities Kanban (drag across NEW→WON) →
Proposals (2, with lines + narrative). Convert a lead, move an opportunity stage.

**C. Commercial.** Quotations (2 — one SENT with débours line carrying no VAT, one
DRAFT), Margin simulator, Extra-charge simulator, Pricing variance (GREEN flag).
Confirm margin is hidden from Sales-scoped roles.

**D. Operations.** Dossiers (5, different service types/statuses), the 360° view,
milestone timeline on `SBX-2026-0001`, a Q-ticket, transit order, delivery note.

**E. Fleet / WMS / HR (read-only lists today).** Every list should be populated:
vehicles + compliance (note the expired insurance on LT-5588 and the licence that
lapsed for Francis Ekwalla — the alert engine should flag both), fuel logs,
dispatch, work order + parts, incident; warehouse locations, inbound, inventory,
stock movements, outbound, equipment, cycle count; payroll run (COMPUTED), leave,
attendance, vacancies + applicant, contract, appraisal, SOP, onboarding, training,
talent pool, succession. **These screens have no create/edit forms yet** — that's
the open FE work in the fleet/WMS/HR lane; the seed lets you verify the read paths
and the collapsed hubs now.

**F. Finance — the money path (posts to the GL — do this through the app).**
This is the part the seed intentionally leaves for you, because posting is what
proves the ledger:
1. Take proforma `SBX-PRO-0001` → record the client advance → confirm it posts **Dr 521 / Cr 4191** (advance, not revenue).
2. Take a DRAFT final invoice (`SBX-INV-0002`) → submit → validate → approve → post → confirm **Dr 411 / Cr 706x + Cr 4432**, and that the débours line hits **4731 with no VAT** and stays out of turnover.
3. Record a receipt against a posted invoice → confirm allocation + ageing update.
4. Run **Statements** (Bilan / Compte de résultat / TAFIRE) and **General Ledger** — they should now reconcile to the trial balance.
5. **Tax Center**: run the VAT return, then file it — `POST /tax/declarations` → approve → submit (DRAFT→COMPUTED→APPROVED→FILED).
6. **Assets**: run depreciation on `SBX-AST-0001` and confirm it auto-posts **Dr 6813 / Cr 2845**; then a disposal.
7. **Payroll**: take the COMPUTED run → approve → validate → confirm the balanced payroll journal (nets to 422, CNPS to 431, IRPP/CAC to 4471).

**G. Governance & security.** Audit ledger should show every posting from F.
Change a role's permission → confirm the Watch-the-Watcher CEO alert fires.
Permission matrix, sessions, notifications.

## 4. Provider runtime enablement (test from Settings)

The PDF/voice/vision/SMTP/FX providers throw "not configured" until keys are set.
In **Settings → Integrations & keys**, add each vendor's key, then use the
**`GET /vendors/:vendor/test`** connection test. Verify: an invoice generates a
white-labelled PDF into the vault (QR-verifiable), an SMTP send goes out from the
tenant sender, and the FX cron populates rates. Do this in sandbox first.

## 5. Per-tenant encryption keys (design + test)

Today `totp_secret_enc` and similar are encrypted with a single app key
(`.env`). To move to **per-tenant keys**: mint a key per tenant at provision time,
store the reference (not the key) in `platform.tenant_database.secret_ref` (already
present, pointing at a vault path), and have the tenant DB connection resolve the
key from the secret store on boot. To test: provision two tenants, confirm a
secret encrypted under tenant A's key cannot be decrypted with tenant B's, and that
rotating one tenant's key re-wraps only that tenant's secrets. (This is a build
item, not yet implemented — flagged in the backlog.)

## 6. Reseeding / cleanup

- Reseed: `npm run db:sandbox:wipe -- --slug=smartls` then rerun the seed.
- The nightly `sandbox-wipe` cron already rebuilds sandbox schemas; wire the seed
  after it if you want fresh test data every morning.
- Live is never touched by any of this.
