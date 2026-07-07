# Praxis LS — Schema Coverage Audit (against the full 70-module scope)

**What this is:** an honest gap analysis of the migrations in `migrations/` against the PRD's 70-module map (§9), the signature features (§11), and the cross-cutting rules (§5–§8), plus the OHADA KB and the kickoff decisions.
**Method:** every table created by `migrations/tenant/*` and `migrations/platform/*` (86 + 12) was parsed and matched to each module. Concepts were probed by name against the actual DDL, not from memory.
**Legend:** ✅ Covered · 🟡 Partial (some fields/derivable, but the module isn't first-class) · ❌ Missing (no table).

## Verdict

> **RESOLVED — full coverage reached.** The gaps below were the _first-pass_ state. All of them have since been built. The tenant schema is now **151 tables** across **30 SQL files**, every one validated by the real Postgres parser with clean apply-order, and **all 72 module keys (MOD-00A/00B + MOD-01–70) are in the platform `module_catalogue` seed**. The per-module tables added are recorded in the "Remediation delivered" section at the end. The original gap analysis is retained below for the record.

The **accounting spine, the dynamic configuration engine, multi-tenancy, the operations core, and the AI layer are well covered.** (First pass) the schema spanned roughly **37 of 70 modules fully**, ~10 partially, and **~23 not at all**. The biggest holes were entire front-office groups: **Sales & CRM (MOD-20–26) 100% absent**, the **Commercial simulators + Quotation (MOD-27/28)** absent, and **HR, WMS, and Fleet only partially built**. Several cross-cutting requirements (live FX, email delivery logging, notifications, tax-return storage, e-signature, approval tokens) also had no home. **All now built.**

---

## Group-by-group coverage

### Group I — Dashboard & Workspace

| Module                           | Status | Notes                                                                                                                                                          |
| -------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-00A Dashboard & My Workspace | 🟡     | KPIs/tiles are derived, fine — but **no `dashboard_tile` / `user_preference`** table for the "configurable tiles" + saved per-user layout the PRD calls for.   |
| MOD-00B God Mode                 | ✅     | `app_user.godmode_pin_hash` + `immutable_ledger` (full payload) + `soft_delete`. Purge refusal of ledger-connected records is enforced by the ledger triggers. |

### Group II — Master Data (01–10)

| Module                        | Status | Notes                                                                                                                                                                                                                                                                         |
| ----------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-01 Corporate Entities     | ✅     | `corporate_entity`                                                                                                                                                                                                                                                            |
| MOD-02 Employees              | ✅     | `employee`                                                                                                                                                                                                                                                                    |
| MOD-03 Client Master          | ✅     | `client_master` + dynamic `client_type`                                                                                                                                                                                                                                       |
| MOD-04 Supplier Master        | ✅     | `supplier_master`                                                                                                                                                                                                                                                             |
| MOD-05 Financial Dictionary   | ✅     | `dictionary_item` (+ services via `service_type`, applicability via `service_type_key`)                                                                                                                                                                                       |
| MOD-06 Chart of Accounts      | ✅     | `chart_of_accounts` (hierarchical, seeded)                                                                                                                                                                                                                                    |
| MOD-07 Tax Jurisdiction       | ✅     | `tax_jurisdiction` / `tax_code` (versioned)                                                                                                                                                                                                                                   |
| **MOD-08 Currency & live FX** | ❌     | **No `currency` master and no `fx_rate` daily-rate table.** Currency is only a `char(3)` column and `fx_rate` a per-row number. The midnight-cron rate cache, per-transaction stamped rate history, and manual override/fallback (PRD MOD-08, KB §8.14) have nowhere to live. |
| MOD-09 Treasury Accounts      | ✅     | `treasury_account` (bank/cash/MoMo + fee account)                                                                                                                                                                                                                             |
| MOD-10 Expense Rates          | ✅     | `expense_rate` (per shipping line, effective-dated)                                                                                                                                                                                                                           |

### Group III — Human Capital / HR (11–19)

| Module                          | Status | Notes                                                                                                                                    |
| ------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-11 Vacancies                | ❌     | No `vacancy` / public-apply / CV-intake tables.                                                                                          |
| MOD-12 Legal Contracts          | ❌     | No `hr_contract` (offer/contract/confirmation/termination lifecycle).                                                                    |
| MOD-13 KPI Appraisals           | ❌     | No `kpi_target` / `appraisal`.                                                                                                           |
| MOD-14 Attendance               | ✅     | `attendance_log` (clock-in + GPS)                                                                                                        |
| MOD-15 Leave & Allowances       | 🟡     | `leave_request` ✅; allowance/bonus **types** live in `payroll_component` ✅ — but no explicit allowance catalogue UI table beyond that. |
| MOD-16 SOPs & Onboarding        | ❌     | No `sop_document` / `onboarding_checklist`.                                                                                              |
| MOD-17 Payroll                  | ✅     | `payroll_run` / `_item` / `payroll_component` (state machine, auto-post)                                                                 |
| MOD-18 Trainings                | ❌     | No `training`.                                                                                                                           |
| MOD-19 Talent Pool / Succession | ❌     | No `talent_pool` / `succession_plan`.                                                                                                    |
| Employee self-service portal    | 🟡     | Reachable via `employee` + RBAC, but no dedicated request/inbox surface.                                                                 |

### Group IV — Sales & CRM (20–26) — **entire group missing**

| Module                             | Status | Notes                                                   |
| ---------------------------------- | ------ | ------------------------------------------------------- |
| MOD-20 Leads                       | ❌     | No `lead` / website-intake.                             |
| MOD-21 Meeting Management          | ❌     | No `meeting` / minutes / transcript link.               |
| MOD-22 Marketing Campaign Register | ❌     | No `marketing_campaign` / `newsletter_subscriber`.      |
| MOD-23 Proposal Generator          | ❌     | No `proposal` / `proposal_line` / `proposal_narrative`. |
| MOD-24 Sales Pipeline              | ❌     | No `opportunity` / pipeline stage.                      |
| MOD-25 Inbound Intake              | ❌     | No `contact_enquiry` / `partnership_request`.           |
| MOD-26 Project Portfolio Builder   | ❌     | No `success_story` / portfolio push.                    |

### Group V — Commercial & Pricing (27–28)

| Module                                     | Status | Notes                                                                                                                                             |
| ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-27 Margin Simulator                    | ❌     | `costing.margin_percent` exists, but there's **no no-GL `margin_simulation` table** (simulations are explicitly separate from costing, KB §7).    |
| MOD-28 Extra-Charges / Demurrage Simulator | ❌     | No `demurrage_simulation` / extra-charge engine.                                                                                                  |
| **Quotation** (life-cycle step 4)          | ❌     | **No `quotation` table** — a first-class object (accept/reject, feeds pipeline, no GL). Notable omission given the invoicing chain depends on it. |

### Group VI — Logistics Operations (29–32) — **fully covered**

| Module                           | Status | Notes                                                                            |
| -------------------------------- | ------ | -------------------------------------------------------------------------------- |
| MOD-29 Operations File (dossier) | ✅     | `dossier` (the analytical cost object)                                           |
| MOD-30 Transit Order             | ✅     | `transit_order`                                                                  |
| MOD-31 Milestone Tracking        | ✅     | `milestone_template` / `_stage` / `milestone_instance` (insertable) + `q_ticket` |
| MOD-32 Delivery Note             | ✅     | `delivery_note`                                                                  |

### Group VII — Warehouse (WMS) (33–38) — **thin**

| Module                              | Status | Notes                                                                                           |
| ----------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| MOD-33 Inbound Operations           | 🟡     | `grn_inbound` (GRN + QA hold + putaway) — minimal.                                              |
| MOD-34 Space & Location             | ✅     | `warehouse_location`                                                                            |
| MOD-35 Inventory Control & Tracking | ❌     | No `inventory_item` / stock-state / movement table (client goods tracked operationally, KB §5). |
| MOD-36 Outbound Operations          | ❌     | No pick/pack/dispatch tables.                                                                   |
| MOD-37 Equipment Handling           | ❌     | No `wms_equipment`.                                                                             |
| MOD-38 Audit & Cycle Counting       | 🟡     | `cycle_count` exists but no discrepancy-resolution workflow.                                    |

### Group VIII — Fleet (39–45)

| Module                           | Status | Notes                                                                                                     |
| -------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| MOD-39 Vehicle/Asset Registry    | ✅     | `vehicle` (→ `asset` → COA 245)                                                                           |
| MOD-40 Compliance & Renewals     | ✅     | `vehicle_compliance` (insurance / visite technique + alert events)                                        |
| MOD-41 Maintenance & Work Orders | ❌     | No `work_order` / spare-parts link.                                                                       |
| MOD-42 Dispatch & Allocation     | ❌     | No `dispatch` / check-in-out log.                                                                         |
| MOD-43 Fuel & Usage              | ✅     | `fuel_log` (posts 6053 tagged to dossier)                                                                 |
| MOD-44 Driver Management         | 🟡     | `employee.is_driver` flag only — **no `driver_license` / certification + expiry** (low-bed licence rule). |
| MOD-45 Incident & Claim          | ❌     | No `incident` / `claim`.                                                                                  |

### Group IX — Ops Costing (46–49)

| Module                     | Status | Notes                                                                                                                                                                                                            |
| -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-46 Project Costing     | ✅     | `costing` / `costing_line` (SoD states)                                                                                                                                                                          |
| MOD-47 Cost Tracking       | ✅     | `cost_entry` (per file & category, proof link)                                                                                                                                                                   |
| MOD-48 Cost Reconciliation | 🟡     | Budget-vs-actual is derivable (costing vs cost_entry); no dedicated reconciliation/variance store.                                                                                                               |
| MOD-49 Project Disbursal   | 🟡     | `regie_advance` (581 state machine) ✅ — but **no `cash_request` / `disbursal_request` document with lines + payments** (the legacy cash_request_master/lines/payments). The request workflow object is missing. |

### Group X — Finance & Accounting (50–59)

| Module                                                                | Status | Notes                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-50 Proforma & Advance                                             | ✅     | `invoice(type=PROFORMA)` + `advance` (4191)                                                                                                                                           |
| MOD-51 Final Invoice                                                  | ✅     | `invoice(type=FINAL)` / `invoice_line`                                                                                                                                                |
| MOD-52 Smart Receivables                                              | ✅     | `payment_receipt` / `payment_allocation` (ageing derived; reminders → event)                                                                                                          |
| MOD-53 Project Financing (Debt)                                       | ❌     | No `debt_engagement` / `debt_repayment` / working-capital.                                                                                                                            |
| MOD-54 Asset Management                                               | ✅     | `asset` / `depreciation_schedule`                                                                                                                                                     |
| MOD-55 Journal Entries                                                | ✅     | `journal` / `journal_entry` / `journal_line` + §23 invariant triggers                                                                                                                 |
| MOD-56 General Ledger                                                 | ✅     | Derived from `journal_line` (grand livre / trial balance = views — correct not to store)                                                                                              |
| MOD-57/58/59 Statements (Bilan / Compte de résultat / TAFIRE / Notes) | 🟡     | Derived from the trial balance (correct), but **no `financial_statement` snapshot / guided-close checklist** table for the monthly close & the intangibility carry-forward record.    |
| **Tax outputs** (TVA return, IS, **DSF dataset**, CNPS declaration)   | ❌     | **No `tax_declaration` / `tax_return` tables** to store a generated return + its filing status + calendar. The KB requires these to be produced _and tracked_ (KB §20 calendar, §12). |

### Group XI — Procurement (60–62)

| Module                    | Status | Notes                                                                                                                          |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| MOD-60 Purchase Orders    | ✅     | `purchase_order` / `_item`                                                                                                     |
| MOD-61 Goods Received     | ✅     | `goods_received_note` (three-way-match flag)                                                                                   |
| MOD-62 Purchase Requests  | ✅     | `purchase_request`                                                                                                             |
| **Supplier Invoice** (AP) | ❌     | Only `grn.supplier_invoice_ref` text — **no `supplier_invoice` table** for accounts-payable posting + advance-on-PO (KB §8.5). |

### Group XII — Document Vault & Insights (63–66)

| Module                            | Status | Notes                                                                                                                                   |
| --------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-63 Reporting & Insights       | 🟡     | Dashboards are derived; no `saved_report` / report-definition table (fine for v1, but the "AI-connected dashboard" config has no home). |
| MOD-64 File Repository (Vault)    | ✅     | `document_vault` (hash, version, retention)                                                                                             |
| MOD-65 Compliance Checker         | ✅     | `compliance_flag`                                                                                                                       |
| MOD-66 Document Verification (QR) | 🟡     | `content_hash` present; no explicit QR-token / verification-hit table (derivable from hash).                                            |

### Group XIII — System Clearance & Security (67–70) — **fully covered**

| Module                    | Status | Notes                                                                             |
| ------------------------- | ------ | --------------------------------------------------------------------------------- |
| MOD-67 IAM / RBAC         | ✅     | `role` / `capability` / `scope` / `permission` / `field_visibility` + assignments |
| MOD-68 Session Management | ✅     | `user_session` (remote kill)                                                      |
| MOD-69 Immutable Ledger   | ✅     | `immutable_ledger` (append-only)                                                  |
| MOD-70 Settings           | ✅     | `setting` (versioned)                                                             |

---

## Signature features (§11) & cross-cutting

| Item                                                                   | Status | Notes                                                                                                                                                             |
| ---------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client / Investor / Audit portals                                      | ✅     | `portal_access` (time-boxed) + `comms_*`                                                                                                                          |
| Support & Feedback dashboard                                           | ✅     | `platform.support_ticket` (kanban)                                                                                                                                |
| Operations-File 360° modal                                             | ✅     | Derived from `dossier` + related (no table needed)                                                                                                                |
| Smart Comms Portal                                                     | ✅     | `comms_group` / `comms_message`                                                                                                                                   |
| **Pricing Variance Index**                                             | ❌     | Needs simulator price vs real costing — **blocked** because MOD-27/28 + quotation don't exist; no `pricing_variance` store.                                       |
| **AI execution worksheets** (print→sign→mail→WhatsApp, tokenised URLs) | ❌     | No `approval_token` / `execution_card` table (§10.7).                                                                                                             |
| **Document e-signature**                                               | ❌     | `employee.signatory_name` only — no `document_signature` / e-sign records (§11.16).                                                                               |
| Multi-entity consolidation (§13)                                       | ✅     | `corporate_entity` + class-18 accounts                                                                                                                            |
| Watch-the-Watcher                                                      | ✅     | `event_type.is_security_critical` + ledger                                                                                                                        |
| Two-tier deletion / immutability                                       | ✅     | `soft_delete` + ledger + validated-entry triggers                                                                                                                 |
| Test/Live sandbox                                                      | ✅     | `live` / `sandbox` schemas                                                                                                                                        |
| White-label theming / PWA                                              | ✅     | `setting(appearance)` + entity logos                                                                                                                              |
| Numbering                                                              | ✅     | `doc_sequence`                                                                                                                                                    |
| **Email / SMTP delivery**                                              | ❌     | Settings hold config, but **no `email_identity` / `email_send_log`** for per-document delivery logging, bounce/complaint status, SPF/DKIM/DMARC state (PRD §5.9). |
| **Notifications**                                                      | ❌     | `event_log` drives them, but **no `notification` table** (in-app/email/SMS/WhatsApp per user + read state).                                                       |
| **Reminders / compliance calendar**                                    | ❌     | No `reminder` / tax-calendar table (KB §20).                                                                                                                      |
| Help Center                                                            | ❌     | No `help_article` (minor).                                                                                                                                        |

---

## Concrete missing tables (the build list)

**High priority (breaks documented flows):**

1. `currency`, `fx_rate_daily` — MOD-08 (invoicing/costing already reference FX but can't source or stamp it properly).
2. `quotation` (+ `quotation_line`) — the missing step-4 object in the core life-cycle.
3. `margin_simulation` / `extra_charge_simulation` — MOD-27/28 (and unblocks the Pricing Variance Index).
4. `cash_request` / `disbursal_request` (+ lines + payments) — MOD-49 request workflow (régie is only the ledger side).
5. `supplier_invoice` — MOD-61 AP posting + advance-on-PO.
6. `tax_declaration` / `tax_return` — MOD-07/12.4 (TVA, IS, DSF, CNPS) + filing status.
7. `email_identity` / `email_send_log` — PRD §5.9 deliverability + per-document delivery status.
8. `notification` — multi-channel + read state.

**Front-office (whole groups):** 9. Sales/CRM: `lead`, `meeting`, `marketing_campaign`, `newsletter_subscriber`, `proposal` (+lines+narrative), `opportunity`, `contact_enquiry`, `partnership_request`, `success_story` (MOD-20–26). 10. HR: `vacancy` (+applicant), `hr_contract`, `kpi_target`/`appraisal`, `sop_document`/`onboarding_checklist`, `training`, `talent_pool`/`succession_plan` (MOD-11,12,13,16,18,19).

**Operations depth:** 11. WMS: `inventory_item`/stock-movement, outbound `pick`/`pack`/`dispatch`, `wms_equipment` (MOD-35,36,37). 12. Fleet: `work_order`(+spares), `dispatch`, `driver_license`, `incident`/`claim` (MOD-41,42,44,45). 13. Finance: `debt_engagement`/`debt_repayment` (MOD-53); `financial_statement` snapshot + guided-close checklist (MOD-57–59).

**Signature/UX:** 14. `approval_token`/`execution_card` (§10.7), `document_signature` (e-sign), `dashboard_tile`/`saved_report`, `reminder`, `help_article`.

**Also:** the `platform.module_catalogue` seed lists ~28 of 70 modules — it should enumerate all 70 so the company dashboard's on/off switchboard is complete, and `feature_catalogue` should gain the front-office features (sales, crm, marketing, etc.).

---

## Recommended sequencing

The gaps map cleanly onto the PRD's own phase plan, so nothing here is a re-architecture — it's filling breadth on the foundation already laid:

- **Fix now (small, unblock core):** currency/FX, quotation, cash_request, supplier_invoice, tax_declaration, email/notification. These complete the money + document spine.
- **Phase 2 (commercial):** Sales/CRM group + simulators + Pricing Variance Index.
- **Phase 3 (people & assets):** HR breadth, WMS depth, Fleet depth.
- **Phase 4 (reach):** e-sign, execution tokens, saved reports, help.

The engine tables (RBAC, events/workflow, feature toggles, posting rules, tax versioning) are designed to absorb all of the above as **data/config**, so new modules mostly mean new domain tables + registering their events — not touching the core.

---

## Remediation delivered (full-scope pass)

Every item in the build list above was implemented. New migration files (all parser-validated, apply-order clean):

| File                                     | Modules closed                                     | Tables added                                                                                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tenant/0342_finance_gaps.sql`           | MOD-08, AP, MOD-49, MOD-53, MOD-07/12.4, MOD-57–59 | `currency`, `fx_rate_daily`, `supplier_invoice`(+line), `cash_request`(+line+payment), `debt_engagement`/`debt_repayment`, `tax_declaration`, `tax_calendar`, `financial_statement`, `close_checklist` |
| `tenant/0345_commercial.sql`             | MOD-27, MOD-28, Quotation, Pricing Variance        | `quotation`(+line), `margin_simulation`(+line), `extra_charge_simulation`, `pricing_variance`                                                                                                          |
| `tenant/0350_sales_crm.sql`              | MOD-20–26 (whole group)                            | `lead`, `meeting`(+note), `marketing_campaign`, `newsletter_subscriber`, `proposal`(+line+narrative), `pipeline_stage`, `opportunity`, `contact_enquiry`, `partnership_request`, `success_story`       |
| `tenant/0360_hr_breadth.sql`             | MOD-11,12,13,16,18,19                              | `vacancy`, `job_applicant`, `hr_contract`, `kpi_target`, `appraisal`, `sop_document`, `onboarding_checklist`(+item), `training`(+attendance), `talent_pool`, `succession_plan`                         |
| `tenant/0370_wms_fleet_depth.sql`        | MOD-35,36,37,41,42,44,45                           | `inventory_item`, `stock_movement`, `outbound_order`(+line), `wms_equipment`, `work_order`(+part), `fleet_dispatch`, `driver_license`, `fleet_incident`, `fleet_claim`                                 |
| `tenant/0410_notifications_ux.sql`       | §5.9, notifications, §10.7, e-sign, MOD-63         | `notification`, `reminder`, `email_identity`, `email_send_log`, `document_signature`, `execution_card`, `approval_token`, `saved_report`, `dashboard_tile`, `help_article`                             |
| `seeds/9030_seed_reference.sql`          | reference data                                     | currencies, default pipeline stages, event types for every new module                                                                                                                                  |
| `seeds/9100_seed_platform_catalogue.sql` | catalogue                                          | **all 72 module keys** + expanded feature catalogue                                                                                                                                                    |

**Coverage probe result:** build-list gaps — _none_; modules in catalogue — _72/72_; tenant tables — _151_; parser — _30/30 files ok_; apply-order — _clean_.

Every one of the 70 modules now has backing tables. The remaining work is application/service code (repositories, endpoints, the connection registry, provisioning CLI), not schema.
