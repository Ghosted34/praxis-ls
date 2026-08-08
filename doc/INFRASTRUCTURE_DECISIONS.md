# Praxis LS — Infrastructure Decision Log

**Companion to:** `doc/INFRASTRUCTURE_PLAN.md`. Each decision below gates one or more workstreams (WS-xx) in that plan; nothing they block can start until the row is resolved.
**How to use:** for each decision, tick one box, add owner + date, and note any modification. "Approve" = proceed as recommended; "Modify" = proceed with the noted change; "Defer" = park and unblock later.

## Sign-off summary

| # | Decision | Recommendation | Blocks | Status |
|---|---|---|---|---|
| D1 | Email domain onboarding model | Support both; default delegation | WS-E2, WS-E5 | ☐ pending |
| D2 | Outbound transport | CF authenticated SMTP first | WS-E1 | ☐ pending |
| D3 | PgBouncer / transaction pooling | Yes — deploy now | WS-S1 | ☐ pending |
| D4 | Backup targets + RPO/RTO | RPO ≤24h (≤5m PITR), RTO ≤1h | WS-B1, WS-B3 | ☐ pending |
| D5 | Entitlement/metering scope | Spend + seats first | WS-S3 | ☐ pending |
| D6 | Backup account separation + key custody | Independent account, Praxis-held key | WS-B1, WS-B2 | ☐ pending |

---

### D1 — Email domain onboarding model · blocks WS-E2, WS-E5

Tenant addresses live on the tenant's own domain, which must reach Cloudflare Email Routing before the 5 addresses can auto-provision.

**Recommendation:** support both paths, default to full delegation, fall back to MX-only.

- ☐ **Approve** — both paths, default delegation
- ☐ **Modify** — delegation only / MX-only only: ____________________
- ☐ **Defer**

Owner: ______________ Date: __________ Notes: ______________________________

---

### D2 — Outbound transport · blocks WS-E1

Cloudflare Email Service offers authenticated SMTP, a REST `send_email` binding, and Workers bindings.

**Recommendation:** authenticated SMTP first (near drop-in for the existing nodemailer transport); add REST later if needed.

- ☐ **Approve** — SMTP first
- ☐ **Modify** — REST binding first / other: ____________________
- ☐ **Defer**

Owner: ______________ Date: __________ Notes: ______________________________

---

### D3 — PgBouncer / transaction pooling · blocks WS-S1

The code is switch-on-ready (`TENANT_DB_POOLER_HOST` seam; per-request single connection + startup-param `search_path` already built). Deploying the pooler banks the tenant-ceiling fix.

**Recommendation:** yes — deploy PgBouncer (transaction mode) in the infra manifest now.

- ☐ **Approve** — deploy now
- ☐ **Modify** — conditions: ____________________
- ☐ **Defer**

Owner: ______________ Date: __________ Notes: ______________________________

---

### D4 — Backup targets + RPO/RTO · blocks WS-B1, WS-B3

Per-tenant logical dumps are straightforward; cluster PITR availability depends on whether Postgres is managed or self-run. Targets must be ratified before restore drills can pass/fail against them.

**Recommendation:** RPO ≤ 24h from nightly dumps (≤ 5 min where PITR is available); RTO ≤ 1h per tenant; rehearse restore before sign-off.

- ☐ **Approve** — targets as recommended
- ☐ **Modify** — RPO ______ / RTO ______ / PITR available: yes ☐ no ☐
- ☐ **Defer**

Owner: ______________ Date: __________ Notes: ______________________________

---

### D5 — Entitlement / metering scope · blocks WS-S3

The metering layer (`plan_entitlement` / `tenant_usage`) is the bridge from feature-gating to billing. Meters can land incrementally.

**Recommendation:** spend + seats first (highest value, data mostly exists), storage + email next.

- ☐ **Approve** — spend + seats first
- ☐ **Modify** — scope: ____________________
- ☐ **Defer**

Owner: ______________ Date: __________ Notes: ______________________________

---

### D6 — Backup account separation + key custody · blocks WS-B1, WS-B2

Offsite backups protect against account compromise only if they live outside the primary account, and encryption only helps if key custody is defined.

**Recommendation:** offsite backups in an independent provider/account (separate from primary storage); encryption key held by Praxis, not the app credential.

- ☐ **Approve** — independent account, Praxis-held key
- ☐ **Modify** — arrangement: ____________________
- ☐ **Defer**

Owner: ______________ Date: __________ Notes: ______________________________

---

*Resolving D1, D4, and D5 unblocks the three largest phases (email provisioning, backup/restore, entitlement). D2/D3/D6 are lower-friction and can be ticked in the same pass.*
