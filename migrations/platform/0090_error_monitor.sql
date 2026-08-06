-- ============================================================================
-- PLATFORM DB — 0090 Error Command Center (doc/PROMPT_ErrorMonitor_Module.md)
-- ============================================================================
--
-- Gives the error sink a durable home. `shared/observability/error-reporter.js`
-- already fingerprints, dedupes and rate-limits every 5xx, worker crash and
-- browser exception (audit OBS-E1/E2) — but it holds that state in a process
-- Map and reports to a webhook. Both are ephemeral: the Map dies with the
-- process, the webhook is a notification and not a record. "What broke this
-- week" still had no answer. These tables are that answer.
--
-- WHY THE PLATFORM DB AND NOT EACH TENANT'S DB
--
-- Isolation is one Postgres database per tenant (README §3), so an error table
-- per tenant would be the "natural" placement. It is the wrong one here, for
-- three reasons:
--
--   1. Platform-wide errors have no tenant to be stored under. Boot failures,
--      registry lookups, the host resolver, and every crash that happens BEFORE
--      the tenant is resolved — which is precisely the class that takes the
--      whole deployment down — would have nowhere to go.
--   2. The console reads this. platform-console is host-gated to the admin host
--      and speaks only /api/platform; it holds no tenant connection and, by
--      PRD §5.3 [RULE], must never open one. Per-tenant storage would force the
--      admin UI to fan out across every tenant database to render one feed.
--   3. An error store is platform telemetry, not tenant business data. Keeping
--      it out of the tenant database is what lets a tenant be handed direct
--      credentialed access to their own Postgres (the paid tier) without also
--      handing them the platform's crash history.
--
-- `tenant_id` is therefore NULLABLE and NULL means platform-wide, which is the
-- distinction §4.1 of the spec asks the filter bar to expose. It is a soft
-- reference to platform.tenant with ON DELETE SET NULL rather than CASCADE:
-- de-provisioning a tenant must not silently erase the evidence of what went
-- wrong while they were live.
--
-- GRAIN: one row per (tenant, signature) — an error GROUP, not an occurrence.
-- The reporter's fingerprint (name|normalised message|top frame, with uuids and
-- numbers masked) is the signature. A hot loop firing 40k times a minute is one
-- row with occurrence_count = 40000, not 40k rows. This is the single decision
-- that keeps the table bounded and the feed readable, and it is why the spec's
-- "Total / Unique" KPIs are a SUM and a COUNT over the same table.
--
-- DOWN
-- Fully additive — four new tables, one new capability set, no changes to any
-- existing object. Reversing drops telemetry only; no application table
-- references these, so nothing else breaks.
--
-- DROP TABLE IF EXISTS platform.error_escalation_log;
-- DROP TABLE IF EXISTS platform.error_escalation_rule;
-- DROP TABLE IF EXISTS platform.error_explanation;
-- DROP TABLE IF EXISTS platform.error_event;
-- DELETE FROM platform.platform_role_permission
--  WHERE capability IN ('errors.read','errors.resolve','errors.configure');

-- ── The error group ─────────────────────────────────────────────────────────
CREATE TABLE platform.error_event (
  error_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = platform-wide (infrastructure, boot, auth, registry).
  tenant_id        uuid REFERENCES platform.tenant(tenant_id) ON DELETE SET NULL,
  -- error-reporter.js fingerprint(). Stable across line-number churn by design.
  signature        text NOT NULL,
  level            text NOT NULL DEFAULT 'error'
                     CHECK (level IN ('fatal','error','warning','notice','info')),
  origin           text NOT NULL DEFAULT 'server'
                     CHECK (origin IN ('server','browser','worker')),
  message          text NOT NULL,
  name             text,
  stack_trace      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- parsed frames
  raw_stack        text,                                  -- verbatim, for copy
  module           text,                                  -- derived from top frame
  route            text,
  file_path        text,
  line_number      integer,
  release          text,                                  -- BUILD_SHA at capture
  env              text,
  context          jsonb NOT NULL DEFAULT '{}'::jsonb,    -- user agent, url, request_id…
  first_seen       timestamptz NOT NULL DEFAULT now(),
  last_seen        timestamptz NOT NULL DEFAULT now(),
  occurrence_count integer NOT NULL DEFAULT 1,
  resolved_at      timestamptz,
  resolved_by      uuid REFERENCES platform.platform_user(platform_user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- The upsert target. COALESCE because NULL <> NULL in a unique index, so a
-- partial expression index is the only way to make "one row per platform-wide
-- signature" actually hold — without it every platform-wide error inserts a new
-- row and the aggregation this table exists for silently stops working.
CREATE UNIQUE INDEX ux_error_event_sig
  ON platform.error_event (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), signature);

-- Feed: "newest first, optionally scoped to a tenant" is the default view.
CREATE INDEX ix_error_event_recent   ON platform.error_event (last_seen DESC);
CREATE INDEX ix_error_event_tenant   ON platform.error_event (tenant_id, last_seen DESC);
CREATE INDEX ix_error_event_level    ON platform.error_event (level, last_seen DESC);
-- Partial: the default filter is status=active, and resolved rows accumulate.
CREATE INDEX ix_error_event_active   ON platform.error_event (last_seen DESC) WHERE resolved_at IS NULL;
CREATE INDEX ix_error_event_module   ON platform.error_event (module) WHERE module IS NOT NULL;

-- ── AI explanations (spec §7) ───────────────────────────────────────────────
-- Keyed by signature, not error_id: the same fault in two tenants is the same
-- explanation, and re-generating it per tenant would pay the model twice for
-- one answer. Redis holds the hot 1-hour cache; this is the durable copy that
-- survives a cache flush and lets an explanation be read back months later.
CREATE TABLE platform.error_explanation (
  explanation_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature        text UNIQUE NOT NULL,
  explanation      text NOT NULL,
  generated_by     text NOT NULL,        -- 'deepseek' | 'gemini' — vendor actually used
  model            text,
  prompt_version   smallint NOT NULL DEFAULT 1,
  requested_by     uuid REFERENCES platform.platform_user(platform_user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Escalation rules (spec §5) ──────────────────────────────────────────────
CREATE TABLE platform.error_escalation_rule (
  rule_id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid REFERENCES platform.tenant(tenant_id) ON DELETE CASCADE,
  name                     text NOT NULL,
  level_filter             text[] NOT NULL DEFAULT ARRAY['fatal']::text[],
  threshold_count          integer NOT NULL DEFAULT 5  CHECK (threshold_count  > 0),
  threshold_window_minutes integer NOT NULL DEFAULT 15 CHECK (threshold_window_minutes > 0),
  action_email             boolean NOT NULL DEFAULT true,
  action_inhouse           boolean NOT NULL DEFAULT true,
  action_webhook_url       text,
  email_recipients         text[] NOT NULL DEFAULT ARRAY[]::text[],
  escalation_delay_minutes integer NOT NULL DEFAULT 0  CHECK (escalation_delay_minutes >= 0),
  repeat_interval_minutes  integer NOT NULL DEFAULT 60 CHECK (repeat_interval_minutes  >= 0),
  active                   boolean NOT NULL DEFAULT true,
  created_by               uuid REFERENCES platform.platform_user(platform_user_id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_esc_rule_active ON platform.error_escalation_rule (active) WHERE active;

-- What actually fired, so a repeat interval can be honoured across restarts and
-- so "why was I paged at 3am" has an answer.
CREATE TABLE platform.error_escalation_log (
  log_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       uuid REFERENCES platform.error_escalation_rule(rule_id) ON DELETE CASCADE,
  error_id      uuid REFERENCES platform.error_event(error_id) ON DELETE CASCADE,
  signature     text NOT NULL,
  triggered_at  timestamptz NOT NULL DEFAULT now(),
  actions_taken jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes         text
);
CREATE INDEX ix_esc_log_rule ON platform.error_escalation_log (rule_id, triggered_at DESC);
CREATE INDEX ix_esc_log_sig  ON platform.error_escalation_log (signature, triggered_at DESC);

CREATE TRIGGER trg_error_event_updated       BEFORE UPDATE ON platform.error_event            FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at();
CREATE TRIGGER trg_error_explanation_updated BEFORE UPDATE ON platform.error_explanation      FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at();
CREATE TRIGGER trg_esc_rule_updated          BEFORE UPDATE ON platform.error_escalation_rule  FOR EACH ROW EXECUTE FUNCTION platform.set_updated_at();

-- ── Capabilities ────────────────────────────────────────────────────────────
-- Root Admin only, matching 0032's precedent. Spec §4.3 wants every admin with
-- errors.read to see BOTH tenant and platform-wide errors — that is a property
-- of the query (no module-based narrowing), not of the grant. Support/Billing
-- are deliberately not granted: stack traces and raw error context are the most
-- sensitive non-credential data the platform holds. Grant per role in the
-- console, deliberately.
INSERT INTO platform.platform_role_permission (role_id, capability)
SELECT r.role_id, c.capability
FROM platform.platform_role r
CROSS JOIN (VALUES
  ('errors.read'),('errors.resolve'),('errors.configure')
) AS c(capability)
WHERE r.code = 'PLATFORM_ROOT_ADMIN'
ON CONFLICT DO NOTHING;
