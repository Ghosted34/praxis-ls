# Praxis LS (SmartLS) — Multi-Tenant Logistics ERP

**Product:** Praxis Logistics Solutions ("Praxis LS"), working/legacy name **SmartLS** in code & docs.
**Vendor:** JBS Praxis LLC · **First tenant:** Smart Logistics (Cameroon)
**What it is:** a white-label, multi-tenant SaaS ERP for heavyweight logistics operators (freight forwarding, customs clearance, warehouse management, fleet management) in the OHADA/CEMAC region, built on a native OHADA/SYSCOHADA accounting core.

This repo rebuilds the existing PHP/Bootstrap/MySQL SmartLS system (84 tables, ~714 files) on a modern, tested, multi-tenant stack — carrying forward the domain logic that works (document lifecycle, segregation-of-duties, milestone engine, logistics taxonomy) and fixing what doesn't (no accounting layer, hard-coded secrets, no tests/CI, English-only UI).

Source of truth for all product decisions: the **PRD (Master Functional Spec v2)**, the **OHADA Accounting/Tax Knowledge Base**, the **Super-Admin/RBAC User-Journey doc**, and the **kickoff meeting transcript** — kept in `doc/`.

> **Precedence note:** the kickoff transcript was recorded _after_ the PRD v2 and revises it on a few points (the transcript's `✅ Decision` blocks are the team's final call). Where the two disagree, this README follows the transcript. The main deltas: **one dedicated PostgreSQL database per tenant** (not schema-per-tenant in a shared cluster — see §3), **Oso** as the named RBAC policy engine, AI provider routing as **primary/fallback** rather than strict per-job assignment, and **AWS S3** for object storage rather than a non-AWS S3-compatible provider. Everything else in the PRD (accounting spine, module map, RBAC model, roadmap) still holds.

---

## 1. Monorepo layout

```layout
src             # NestJS backend.
client          # React + Vite frontend (PWA)
scripts         # Migration scripts, startup scripts and any other needed in the product
doc/            # PRD, OHADA KB, RBAC/User-Journey, kickoff transcript
packages/shared # Zod schemas, types, posting-rules & tax libraries, i18n dictionaries (shared FE/BE)
```

Package manager: **pnpm** with **Turborepo**. Shared TypeScript types live in `packages/shared` so there is one definition of every entity across API and web.

## 2. Stack summary

| Layer          | Choice                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend       | React 18 + Vite + TypeScript, installable PWA                                                                                                                     |
| Backend        | Node.js (TypeScript), NestJS modular monolith                                                                                                                     |
| Database       | PostgreSQL 16 — **one dedicated database per tenant** (not schema-per-tenant in a shared cluster)                                                                 |
| Cache / queue  | Redis + BullMQ                                                                                                                                                    |
| Realtime       | Socket.IO                                                                                                                                                         |
| PDF            | Puppeteer + headless Chromium                                                                                                                                     |
| Validation     | Zod (shared between API DTOs and AI action gate)                                                                                                                  |
| Containers     | Docker + Docker Compose (k3s-ready)                                                                                                                               |
| Hosting        | Self-managed VPS/VDS; scales up per tenant                                                                                                                        |
| Object storage | **AWS S3** (cheapest S3-compatible option at the client's chosen scale; local disk for now)                                                                       |
| AI providers   | **DeepSeek primary / Gemini fallback** for reasoning + content; self-hosted **Whisper** primary / **Groq** fallback for voice-to-text; per-tenant spend dashboard |
| RBAC engine    | **Oso** — central authorization policy library, server + client enforced                                                                                          |

## 3. Multi-tenancy (cross-cutting)

- **Isolation: one dedicated PostgreSQL database per tenant** — not a shared cluster with schema-per-tenant. _"We hold the code; they hold the data."_ Onboarding a tenant provisions (or steps up) a Postgres instance for them; a shared `platform` database still holds the tenant registry, subdomains, and plans.
- **Live/Sandbox within the tenant's own database:** each tenant's Postgres holds a **Live** environment and a **Sandbox** environment (as two schemas/databases inside that instance — isolation is already guaranteed at the tenant level, so this only needs to separate Live from Test, not tenant from tenant). A top-bar toggle (frontend) switches sessions; sandbox is auto-wiped on a cron (default 14 days); the toggle hides once a tenant goes Live. No shared staging server.
- **Tenant resolution:** by subdomain (`<tenant>.praxisls.com`) → backend middleware resolves the request to that tenant's own database connection; no query runs without a resolved tenant context.
- **Tenant-owned access (paid tier):** every tenant's data already lives in its own database by default. Granting the _tenant itself_ direct credentialed access to administer that Postgres (back it up, migrate off, inspect directly) is a separate, priced offering (~2–3M XAF setup + ~500k/yr maintenance, indicative) — not the default for every tenant.
- **White-labelling:** per-tenant company name, light/dark logos, colour tokens, fonts, document numbering, generated PWA manifest — with a subtle "Powered by JBS Praxis LLC" footer line.
- **Scaling ladder:** 1 tenant → current box (12 GB/6-core) · 2–4 → vertical scale (24 GB/8-core+) · 5–10 → split servers (app / each tenant's Postgres / workers) · 10+ → connection pooler + dedicated object storage. A new tenant means adding a new Postgres instance/database, not just a new schema.
- **Backups:** daily encrypted full backups of every tenant database + the platform database, shipped to Google Drive/OneDrive initially, with a path to S3 later.

## 4. Module map (70 modules, 13 groups)

| Group                          | Covers                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Dashboard & Workspace       | Role-filtered home; CEO God Mode purge console                                                                                                     |
| II. Master Data                | Corporate entities, employees, clients, suppliers, financial dictionary, chart of accounts, tax jurisdiction, currency/FX, treasury, expense rates |
| III. HR                        | Vacancies, contracts, KPIs, attendance, leave/allowances, SOPs, payroll (auto-posting), trainings, succession                                      |
| IV. Sales & CRM                | Leads, meetings, campaigns, AI-assisted proposals, pipeline (Kanban), inbound intake, portfolio builder                                            |
| V. Commercial & Pricing        | Margin simulator, extra-charges simulator (no GL impact)                                                                                           |
| VI. Logistics Operations       | Operations file registry (the dossier), transit orders, milestone tracking, delivery notes                                                         |
| VII. Warehouse (WMS)           | Inbound/GRN, space & location, inventory, outbound, equipment, cycle counting                                                                      |
| VIII. Fleet                    | Vehicle registry, compliance/renewals, maintenance, dispatch, fuel tracking, driver mgmt, incidents                                                |
| IX. Ops Costing                | Project costing (posts to ledger), cost tracking/reconciliation, disbursal (régie d'avance)                                                        |
| X. Finance & Treasury          | Proforma/final invoices, receivables, financing, asset mgmt & depreciation, journals, general ledger, statements + DSF                             |
| XI. Procurement                | Purchase orders, goods received (three-way match), purchase requests                                                                               |
| XII. Document Vault & Insights | Reporting, file vault (10-yr retention), compliance checker, QR document verification                                                              |
| XIII. System & Security        | IAM/RBAC, session management, immutable ledger, system-wide settings                                                                               |

Full purpose/features/access/acceptance-criteria per module: `doc/PRD.md` §9.

## 5. Delivery roadmap (accounting core first, no big-bang cutover)

1. **Foundations** — auth/2FA, RBAC engine, multi-tenancy, white-label, immutable ledger, Event Engine skeleton, Test/Live sandbox.
2. **Accounting spine** — COA, posting rules, journals/GL, tax engine, statements/DSF, PDF, email.
3. **Commercial cycle** — master data, operations file + milestones + 360° modal, costing, invoicing, procurement.
4. **People & assets** — HR/payroll, fleet, WMS.
5. **Intelligence & reach** — AI assistant + voice/vision, Pricing Variance Index, portals, support dashboard, comms, BI.
6. **Hardening & migration** — pen-test, performance, restore drills, client-owned MySQL→PostgreSQL migration, go-live.

See `WORK_TO_BE_DONE.md` for the full task breakdown per phase.

## 6. Companion documents (`doc/`)

- `PRD.md` — Master Functional Spec (primary source for both READMEs)
- `OHADA_Accounting_Tax_KnowledgeBase.md` — accounting/tax source of truth
- `SuperAdmin_UserJourney_RBAC.md` — human-readable access map
- `Kickoff_Meeting_Transcript.md` — decisions log, action items, open questions, glossary

## 7. Team & working agreement

- Everyone is full-stack; David leans front-end, Victor leans back-end, Blake organises/cleans up/handles deep-linking; Elisha owns AI automation + the Universal Event Engine.
- PR-based workflow on a dedicated GitHub repo; Victor owns repo setup and this README.
- Yearly renewable contracts, milestone-based; team coordination in one WhatsApp group (no one-to-one side channels).
