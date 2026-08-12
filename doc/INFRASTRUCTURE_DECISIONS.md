# Praxis LS — Infrastructure Decision Log

**Companion to:** `doc/INFRASTRUCTURE_PLAN.md`. Each decision below gates one or more workstreams (WS-xx) in that plan; nothing they block can start until the row is resolved.
**How to use:** for each decision, tick one box, add owner + date, and note any modification. "Approve" = proceed as recommended; "Modify" = proceed with the noted change; "Defer" = park and unblock later.

**Status: all six decisions resolved as recommended (2026-08-10).** Every workstream in `INFRASTRUCTURE_PLAN.md` is unblocked; no decision gate remains.

## Sign-off summary

| # | Decision | Recommendation | Blocks | Status |
|---|---|---|---|---|
| D1 | Email domain onboarding model | Support both; default delegation | WS-E2, WS-E5 | ☑ **approved** 2026-08-10 |
| D2 | Outbound transport | CF authenticated SMTP first | WS-E1 | ☑ **approved** 2026-08-10 |
| D3 | PgBouncer / transaction pooling | Yes — deploy now | WS-S1 | ☑ **approved** 2026-08-10 |
| D4 | Backup targets + RPO/RTO | RPO ≤24h (≤5m PITR), RTO ≤1h | WS-B1, WS-B3 | ☑ **approved** 2026-08-10 |
| D5 | Entitlement/metering scope | Spend + seats first | WS-S3 | ☑ **approved** 2026-08-10 |
| D6 | Backup account separation + key custody | Independent account, Praxis-held key | WS-B1, WS-B2 | ☑ **approved** 2026-08-10 |

---

### D1 — Email domain onboarding model · blocks WS-E2, WS-E5

Tenant addresses live on the tenant's own domain, which must reach Cloudflare Email Routing before the 5 addresses can auto-provision.

**Recommendation:** support both paths, default to full delegation, fall back to MX-only.

- ☑ **Approve** — both paths, default delegation
- ☐ **Modify** — delegation only / MX-only only: ____________________
- ☐ **Defer**

Owner: JBS Praxis engineering Date: 2026-08-10 Notes: Approved as recommended. Carried into `doc/INTEGRATION_PLAN.md` §D1.

---

### D2 — Outbound transport · blocks WS-E1

Cloudflare Email Service offers authenticated SMTP, a REST `send_email` binding, and Workers bindings.

**Recommendation:** authenticated SMTP first (near drop-in for the existing nodemailer transport); add REST later if needed.

- ☑ **Approve** — SMTP first
- ☐ **Modify** — REST binding first / other: ____________________
- ☐ **Defer**

Owner: JBS Praxis engineering Date: 2026-08-10 Notes: Approved as recommended. Carried into `doc/INTEGRATION_PLAN.md` §D2.

---

### D3 — PgBouncer / transaction pooling · blocks WS-S1

The code is switch-on-ready (`TENANT_DB_POOLER_HOST` seam; per-request single connection + startup-param `search_path` already built). Deploying the pooler banks the tenant-ceiling fix.

**Recommendation:** yes — deploy PgBouncer (transaction mode) in the infra manifest now.

- ☑ **Approve** — deploy now
- ☐ **Modify** — conditions: ____________________
- ☐ **Defer**

Owner: JBS Praxis engineering Date: 2026-08-10 Notes: Approved as recommended. Sequencing note — WS-S2 (per-tenant DB credentials) changes what the pooler authenticates with, so land S2 first or size PgBouncer's auth config for per-tenant roles up front.

---

### D4 — Backup targets + RPO/RTO · blocks WS-B1, WS-B3

Per-tenant logical dumps are straightforward; cluster PITR availability depends on whether Postgres is managed or self-run. Targets must be ratified before restore drills can pass/fail against them.

**Recommendation:** RPO ≤ 24h from nightly dumps (≤ 5 min where PITR is available); RTO ≤ 1h per tenant; rehearse restore before sign-off.

- ☑ **Approve** — targets as recommended
- ☐ **Modify** — RPO ______ / RTO ______ / PITR available: yes ☐ no ☐
- ☐ **Defer**

Owner: JBS Praxis engineering Date: 2026-08-10 Notes: Approved as recommended. Open item — PITR availability still depends on the Postgres host (managed vs self-run); the ≤5m RPO applies only where WAL archiving is available. Confirm at WS-B1 build time.

---

### D5 — Entitlement / metering scope · blocks WS-S3

The metering layer (`plan_entitlement` / `tenant_usage`) is the bridge from feature-gating to billing. Meters can land incrementally.

**Recommendation:** spend + seats first (highest value, data mostly exists), storage + email next.

- ☑ **Approve** — spend + seats first
- ☐ **Modify** — scope: ____________________
- ☐ **Defer**

Owner: JBS Praxis engineering Date: 2026-08-10 Notes: Approved as recommended. Spend reuses the existing `ai_budget_period` / `ai_usage_ledger`; seats count active `app_user`. Storage + email follow.

---

### D6 — Backup account separation + key custody · blocks WS-B1, WS-B2

Offsite backups protect against account compromise only if they live outside the primary account, and encryption only helps if key custody is defined.

**Recommendation:** offsite backups in an independent provider/account (separate from primary storage); encryption key held by Praxis, not the app credential.

- ☑ **Approve** — independent account, Praxis-held key
- ☐ **Modify** — arrangement: ____________________
- ☐ **Defer**

Owner: JBS Praxis engineering Date: 2026-08-10 Notes: Approved as recommended. The backup encryption key is itself a secret requiring custody separate from `ENCRYPTION_KEY` — it must not be recoverable from a compromised app credential.

---

*All six decisions resolved 2026-08-10. Every phase in `doc/INFRASTRUCTURE_PLAN.md` §7 is unblocked; D1/D2 are additionally carried in `doc/INTEGRATION_PLAN.md`.*
