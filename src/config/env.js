/**
 * Environment configuration — loaded once, validated with Zod, frozen.
 * The app boots against the PLATFORM database; per-tenant DB creds are resolved
 * at request time and are NOT in this file. See doc/DB_ARCHITECTURE.md.
 */
"use strict";

/**
 * `.env` is NOT read when PRAXIS_SKIP_DOTENV=1 — set by tests/jest.setup.js.
 *
 * jest.setup.js already states the rule ("a unit test that reads a config
 * default must not be able to see the developer's .env") and could not enforce
 * it from where it stands: it deletes a key from `process.env`, and then THIS
 * line runs and puts the key straight back from the file. Deleting is undone by
 * the next `dotenv.config()`; blanking to "" defeats zod's `.default()`, which
 * only fires on `undefined`. Neither works from outside.
 *
 * The result was a suite that passed in CI — where no `.env` file exists, so
 * this call is already a no-op — and failed on a configured developer machine,
 * pointing at code nobody had touched (`MAIL_FALLBACK_DOMAIN=nmail.praxisls.com`
 * breaking mail-fallback.test.js; a real `PG_DUMP_BIN` breaking the backup
 * preflight tests). Skipping the load under test makes a local run behave
 * exactly like CI, which is the only behaviour worth having.
 *
 * An integration test that genuinely needs configuration gets it the same way CI
 * does: real environment variables, not a file.
 */
if (process.env.PRAXIS_SKIP_DOTENV !== "1") require("dotenv").config();
const { z } = require("zod");

/**
 * A value that starts with `#` is a comment that a parser failed to strip.
 *
 * INCIDENT 2026-08-12 (the real one). `.env` carried, copied verbatim out of
 * `.env.example`:
 *
 *     TENANT_DB_POOLER_HOST=                # e.g. pgbouncer  (empty = direct to Postgres)
 *
 * Node's dotenv reads that as `""`. Docker Compose's `env_file` parser passes
 * the comment through as the VALUE. Same file, two parsers, opposite answers —
 * so every tenant pool in production tried to connect to a host named
 * `# e.g. pgbouncer  (empty = direct to Postgres)`, failed DNS, and timed out
 * after TENANT_POOL_ACQUIRE_TIMEOUT_MS. Tenant sites were down; the platform
 * console was fine, because DB_HOST has a value before its comment and parses
 * correctly. Only keys left EMPTY with a trailing comment are affected.
 *
 * It could not be reproduced locally — running through dotenv, the same file is
 * correct — which is what made it expensive to find.
 *
 * COERCED TO EMPTY, NOT FATAL. Empty is what the operator meant: these are all
 * optional keys whose comment says "e.g." or "empty = ...". Refusing to boot
 * would turn a typo into a second outage. But it is announced loudly, because a
 * silently-ignored setting is how `ALERT_WEBHOOK_URL` ends up looking configured
 * while posting nowhere.
 *
 * If a value must genuinely begin with `#`, quote it — both parsers honour
 * quotes, which is the actual fix for the ambiguity.
 */
function stripMisparsedComments(env) {
  const spoiled = [];
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string" && v.trimStart().startsWith("#")) {
      spoiled.push(k);
      env[k] = "";
    }
  }
  if (spoiled.length) {
    // console, not the logger: this runs before the logger is configured, and a
    // warning nobody sees is the failure mode being fixed here.
    console.warn(
      `[env] IGNORED ${spoiled.length} setting(s) whose value was a COMMENT, not a value: ${spoiled.join(", ")}.\n` +
        "      This happens when a key is left empty with a trailing `# comment` in .env — Docker Compose's\n" +
        "      env_file parser keeps the comment as the value where dotenv discards it. Put the comment on its\n" +
        "      own line above the key, or quote the value. Treated as empty for now.",
    );
  }
  return spoiled;
}
const misparsedEnvKeys = stripMisparsedComments(process.env);

const bool = (def) =>
  z.string().optional().transform((v) => (v === undefined ? def : /^(1|true|yes|on)$/i.test(v)));
const int = (def) =>
  z.string().optional().transform((v) => (v === undefined || v === "" ? def : Number(v))).pipe(z.number().int());

function fromUrl(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 5432,
      database: u.pathname.replace(/^\//, ""),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    };
  } catch {
    return {};
  }
}
const urlParts = process.env.DATABASE_URL ? fromUrl(process.env.DATABASE_URL) : {};

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: int(8080),
  APP_BASE_DOMAIN: z.string().default("praxisls.com"),
  // Dev-only convenience: when NODE_ENV=development, resolve a tenant on
  // localhost without a hosts-file entry. A request may still override per-call
  // with the `X-Praxis-Tenant: <slug>` header (see host-tenent-resolver.js).
  DEV_TENANT_SLUG: z.string().default(""),
  LOG_LEVEL: z.string().default("info"),
  APP_NAME: z.string().default("praxis-ls-api"),
  CORS_ORIGINS: z.string().default(""),

  /**
   * How many reverse-proxy hops sit in front of this process (audit SEC-H5).
   *
   * `app.set("trust proxy", true)` used to be unconditional, which tells Express
   * to believe the whole X-Forwarded-For chain — including the part the client
   * wrote. Every IP-keyed control downstream (rate limiting, audit `ip`) then
   * keyed on an attacker-chosen value, so a limiter could be reset per request
   * by rotating the header.
   *
   * A hop COUNT makes Express take the Nth address from the right, which is the
   * one the proxy you actually control appended. Default 1 = the single nginx in
   * front of the api/api-standby containers (see docker-compose.yml). Raise it
   * only if you genuinely add a trusted hop — a CDN in front of nginx makes it
   * 2. Setting it too high re-opens the spoof; too low keys everyone behind the
   * proxy onto one bucket.
   *
   * 0 disables proxy trust entirely (direct-to-Node, no proxy).
   */
  TRUST_PROXY_HOPS: int(1),

  /**
   * Build identity, surfaced on the readiness probe (audit TC-R2 / OBS-I5).
   * Injected at image build time; unset means "not built by CI", which the probe
   * reports honestly rather than hiding.
   */
  BUILD_SHA: z.string().default(""),
  BUILD_TIME: z.string().default(""),

  /**
   * Where alerts go (audit OBS-A1 — there is no alerting of any kind).
   *
   * Either is enough; neither is required to boot. When both are empty the app
   * logs a warning at startup rather than staying quiet, because "nobody
   * configured alerting" should be visible — a silent absence of alerting is
   * indistinguishable from working alerting right up until the night it isn't.
   *
   * See doc/MONITORING_SETUP.md.
   */
  ALERT_WEBHOOK_URL: z.string().default(""),
  ALERT_EMAIL: z.string().default(""),

  /**
   * Optional bearer token guarding GET /api/metrics (OBS-M1). Unset = open,
   * which is correct when the scraper shares the host or the network is
   * private. Set it the moment the endpoint is reachable from outside.
   */
  METRICS_TOKEN: z.string().default(""),
  // Dedicated host for the Praxis-side Platform Console (e.g. admin.praxisls.com).
  // The console static app is served ONLY when the request Host matches this, at
  // the root of that host; tenant hosts never serve it. Empty (default) = the
  // console is not served by the API at all (use its Vite dev server locally).
  PLATFORM_CONSOLE_HOST: z.string().default(""),

  /**
   * Serve the public web app (public-web/dist) on the TENANT host, at /public/*
   * and /portal/* only. Default off, like PLATFORM_CONSOLE_HOST's "not served".
   *
   * Off by default rather than on-if-dist-exists because this mount takes over
   * paths the tenant app already answers — /track, /portfolio, /careers and
   * /client-portal/* — and redirects them to the new prefixes. A deployment that
   * builds public-web by accident must not silently move those entry points out
   * from under the ERP in the same release that was supposed to be a schema
   * migration. One variable, deliberately set, is the switch.
   */
  SERVE_PUBLIC_WEB: bool(false),


  DB_HOST: z.string().default(urlParts.host || "localhost"),
  DB_PORT: int(urlParts.port || 5432),
  DB_NAME: z.string().default(urlParts.database || "praxis_platform"),
  DB_USER: z.string().default(urlParts.user || "praxis_app"),
  DB_PASSWORD: z.string().default(urlParts.password || ""),
  DB_SSL: bool(false),
  DB_POOL_MIN: int(2),
  DB_POOL_MAX: int(10),
  // INCIDENT 2026-08-12 — background sweeps and request handling shared one
  // platform pool, so the health collector could starve a login. They are two
  // pools now (services/platform/db.js: `query` vs `opsQuery`). Small on
  // purpose: background work may queue against itself, never against a user.
  OPS_POOL_MAX: int(4),
  DB_CONNECT_TIMEOUT_MS: int(10_000),
  DB_STATEMENT_TIMEOUT_MS: int(30000),
  DB_PLATFORM_SCHEMA: z.string().default("platform"),
  // RLS_READ_ENFORCE removed 2026-08-05 (DI-4.1): it gated a code path that set
  // a GUC for policies that do not exist. Turning it on cost a round-trip per
  // read and filtered nothing. Tenant isolation is the database boundary.

  TENANT_DB_HOST_DEFAULT: z.string().default(urlParts.host || "localhost"),
  TENANT_DB_PORT_DEFAULT: int(urlParts.port || 5432),
  TENANT_DB_SUPERUSER: z.string().default("postgres"),
  TENANT_DB_SUPERUSER_PASSWORD: z.string().default(""),
  TENANT_DB_APP_ROLE: z.string().default(""),
  // INCIDENT 2026-08-12 — was 8. Paired with TENANT_POOL_CACHE_MAX 24 that is a
  // 192-connection per-process ceiling, 576 across api + api-standby + worker,
  // against a Postgres default of 100. Lowered so the worst case FITS the
  // budget src/config/connection-budget.js now checks at boot. Raise it again
  // once PgBouncer carries traffic — a pooler is what makes a large client-side
  // ceiling safe, and until then this number is a promise the database cannot
  // keep.
  TENANT_POOL_MAX: int(4),

  // PERF S1. One pg.Pool per tenant DB was cached in an unbounded Map, so
  // 12 warm tenants held 96 of Postgres's 100 connections and tenant 13 was
  // refused outright. These three bound it.
  //
  //   CACHE_MAX    — how many tenant pools may exist at once; the least
  //                  recently used is drained past this. 24 × the default
  //                  max of 8 is a 192-connection ceiling in the worst case,
  //                  which is why IDLE_MS matters: pools sit at 0 when quiet.
  //   IDLE_MS      — how long an unused connection is kept before it is given
  //                  back to Postgres. With min:0 a quiet tenant holds none.
  //   ACQUIRE_TIMEOUT_MS — fail a checkout rather than hang behind a saturated
  //                  pool. A visible 503 beats a request that never returns.
  // INCIDENT 2026-08-12 — was 24. See TENANT_POOL_MAX above: the product of the
  // two is the per-process connection ceiling, and it was never compared with
  // what Postgres accepts. 4 × 12 = 48 (+ DB_POOL_MAX 10) fits three processes
  // inside a 300-connection server with the 20% headroom the boot check wants.
  TENANT_POOL_CACHE_MAX: int(12),
  TENANT_POOL_IDLE_MS: int(10_000),
  TENANT_POOL_ACQUIRE_TIMEOUT_MS: int(5_000),

  // PERF S1 seam. doc/DB_ARCHITECTURE.md:46 anticipates "PgBouncer at 10+
  // tenants"; the ladder was documented but the code had nowhere to put it.
  // Set these and every tenant pool routes through the pooler. Migrations and
  // provisioning deliberately keep using the registry's own host/port — they
  // must not go through a transaction pooler.
  TENANT_DB_POOLER_HOST: z.string().default(""),
  TENANT_DB_POOLER_PORT: int(0),

  // WS-S2. How long a decrypted per-tenant DB credential is cached in-process.
  //
  // INCIDENT 2026-08-12 — this was 60s with a READ-THROUGH cache, so every
  // tenant paid a platform-DB round trip every minute, inline, while holding the
  // registry's in-flight guard. When the ops sweeps saturated the platform DB
  // those lookups queued past TENANT_POOL_ACQUIRE_TIMEOUT_MS and tenant logins
  // failed. The cache is now stale-while-revalidate, so this is a REFRESH
  // interval rather than an expiry a request can block on, and it is long:
  // rotation is made immediate by `dbCredentials.invalidate()`, which
  // `putCredential()` already calls. The TTL only backstops a rotation performed
  // outside this process.
  //
  // Declared here because db-credential.service.js reads it off `config` — an
  // undeclared key is stripped by the schema, so without this line the variable
  // could be set in .env and silently do nothing.
  TENANT_DB_CRED_TTL_MS: int(3_600_000),

  // The hard bound on how long a COLD credential lookup may delay a tenant
  // connection. Past this the tenant is served on the shared credential and the
  // vault read finishes in the background. Deliberately far below
  // TENANT_POOL_ACQUIRE_TIMEOUT_MS: a secret-store hiccup must cost isolation
  // for one pool creation, never availability.
  TENANT_DB_CRED_TIMEOUT_MS: int(500),

  // INCIDENT 2026-08-12 — the connection budget the app is willing to open,
  // checked against Postgres's max_connections at boot. See
  // src/config/connection-budget.js. `enforce` refuses to start when the
  // configured ceiling does not fit; the default warns loudly instead, because
  // failing to start is the wrong answer on a host whose limit we misread.
  DB_BUDGET_CHECK: z.enum(["off", "warn", "enforce"]).default("warn"),
  // Processes that share one Postgres: api + api-standby + worker by default.
  // The ceiling is per-process, so the fleet total is this multiple of it.
  DB_BUDGET_PROCESSES: int(3),
  // Fraction of max_connections that must stay free for migrations, pg_dump,
  // restore drills and a human with psql.
  DB_BUDGET_HEADROOM_PCT: int(20),

  // WS-S1 — the PgBouncer auth_query lookup role. Read by
  // scripts/db/setup-pgbouncer-auth.js, which creates the role and the
  // SECURITY DEFINER function the pooler authenticates through. The password
  // must match what the pgbouncer container is given, or every pooled
  // connection fails auth in a way that looks like a Postgres outage.
  //
  // The pool SIZING knobs (max_client_conn, default_pool_size, and so on) are
  // deliberately NOT here: they are consumed by docker-compose and the
  // pgbouncer entrypoint, never by this application, and declaring config the
  // app cannot act on is how a template becomes folklore.
  PGBOUNCER_AUTH_USER: z.string().default("pgbouncer"),
  PGBOUNCER_AUTH_PASSWORD: z.string().default(""),

  // PERF S10. The host->tenant cache is keyed by the Host header, which any
  // client controls, and had no bound at all. 5,000 entries is far above a
  // real deployment's subdomain count and far below a memory problem.
  HOST_CACHE_MAX: int(5_000),

  REDIS_URL: z.string().default("redis://localhost:6379"),
  /**
   * SEC-L2. Consumed by docker-compose (`--requirepass`) and by the Redis
   * healthcheck, not by this process — the client authenticates through the
   * credentials embedded in REDIS_URL.
   *
   * Declared here anyway, and that is the point of declaring it:
   * `scripts/check-env-template.js` reconciles `.env.example` against this
   * schema in BOTH directions, so a variable documented in the template but
   * absent here is reported as "setting it does nothing". Leaving it out would
   * have made the template lie about a security control. (The check caught this
   * exact omission when the variable was added.)
   */
  REDIS_PASSWORD: z.string().default(""),

  JWT_ACCESS_SECRET: z.string().default("__dev_access__"),
  JWT_REFRESH_SECRET: z.string().default("__dev_refresh__"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  SESSION_INACTIVITY_MIN: int(30),

  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "must be 64 hex chars (32 bytes)")
    .default("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),

  AI_ENABLED_DEFAULT: bool(false),
  DEEPSEEK_API_KEY: z.string().default(""),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default("gemini-1.5-pro"),
  GROQ_API_KEY: z.string().default(""),
  WHISPER_BASE_URL: z.string().default(""),
  AI_MONTHLY_CAP_XAF: int(0),

  EMBEDDINGS_PROVIDER: z.string().default("openai"),
  EMBEDDINGS_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDINGS_DIM: int(1536),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),

  EXCHANGERATE_API_KEY: z.string().default(""),
  FX_API_KEY: z.string().default(""),
  FX_SYNC_CRON: z.string().default("0 0 * * *"),
  // IANA tz the FX cron's wall-clock time is read in. CEMAC is UTC+1, so the
  // default puts "midnight" at Douala midnight rather than UTC. Empty FX_SYNC_CRON
  // disables the daily sync (manual "Sync now" still works).
  FX_SYNC_TZ: z.string().default("Africa/Douala"),
  ENABLE_WORKERS: bool(false),

  // Monthly leave accrual (MOD-15). 02:00 on the 1st, in the FX timezone — the
  // month has to be OVER before its entitlement is earned, and the small hours
  // of the 1st is the first moment that is true for everybody. Daily would also
  // be correct (the job is idempotent per month and only ever posts a month
  // that has completed), and a tenant who wants the belt-and-braces version
  // sets `0 2 * * *`. Empty disables accrual entirely — balances then only move
  // by hand, which is a legitimate choice for an employer whose leave is
  // granted rather than accrued.
  LEAVE_ACCRUAL_CRON: z.string().default("0 2 1 * *"),

  // Nightly attendance reconciliation (MOD-14). 03:00 in the FX timezone — the
  // day being reconciled is over by then in the workplace zone, and the answer
  // is waiting before anybody opens the app. Empty disables it: days are then
  // only reconciled when somebody presses "re-run", and no rule ever charges
  // anybody automatically.
  ATTENDANCE_RECONCILE_CRON: z.string().default("0 3 * * *"),

  // Contract term + probation warnings (MOD-12). 07:00 in the FX timezone —
  // these need a human to act on them, so they should be waiting at the start
  // of the working day rather than arriving overnight. Empty disables the
  // warnings; the "lapsing soon" screen still answers the same question on
  // demand.
  CONTRACT_LAPSE_CRON: z.string().default("0 7 * * *"),
  // Régie d'avance aging (KB §6.8 step 4): reclassify advances past their
  // policy window from 581 to a receivable on the holder (4211). 06:00 UTC —
  // it POSTS to the ledger, so it runs before the working day starts rather
  // than mid-afternoon while someone is looking at the same advance. Empty
  // disables it; POST /regie/age-due still ages on demand.
  REGIE_AGING_CRON: z.string().default("0 6 * * *"),
  // Scheduled reports (1.3): the tick that fans `scheduled-report` out per live
  // tenant. HOURLY, at five past — `next_run_at` is a timestamp and the due
  // query asks `next_run_at <= now()`, so this interval is the resolution of
  // the whole feature: tick daily and every cadence becomes "whenever the cron
  // happened to fire". Five past the hour keeps it clear of the pile of jobs
  // every other scheduler puts on the hour. Empty disables it;
  // POST /reports/scheduled/run-due still runs a tenant's due reports on demand.
  SCHEDULED_REPORT_CRON: z.string().default("5 * * * *"),
  /*
   * Signing reminders (SIGNATURE_ENGINEERING_GUIDE §6.8). Hourly at :20 —
   * clear of the report tick at :05, because both fan out one job per tenant
   * and a shared minute would double the burst for no benefit.
   *
   * Hourly rather than daily because the rule is "two days, then five days":
   * a daily tick would make that mean "somewhere between two and three days,
   * depending when the fleet cron fires". Empty disables it, like every other
   * cron here.
   */
  SIGNATURE_REMINDER_CRON: z.string().default("20 * * * *"),
  /*
   * QES poll backstop (SIGNATURE_ENGINEERING_GUIDE §7.4 step 6). Every
   * thirty minutes, asking the provider where each tenant's open envelopes
   * are. The interval is the worst-case lateness of a completion whose
   * webhook was lost. Empty disables it — which means a lost webhook stalls
   * a chain until a human looks, so the worker warns when it is.
   */
  QES_POLL_CRON: z.string().default("*/30 * * * *"),
  // QES quota watch (§7.5): daily at 06:00 UTC, counting the fleet's issued
  // envelopes against the platform's monthly allowance. Wall-clock cron for
  // the reason the FX sync uses one — the monthly allowance is a calendar
  // fact, and an interval-based repeat drifts off it after every restart.
  QES_QUOTA_CRON: z.string().default("0 6 * * *"),
  /*
   * Sandbox auto-wipe (G3, PRD §5.5): daily tick that enqueues a rebuild per
   * tenant honouring each tenant's sandbox_wipe_days.
   *
   * DEFAULT IS EMPTY = DISABLED (2026-08-22). It used to be "30 3 * * *", and
   * a tenant lost a night's sandbox work to it at 03:30 UTC with nothing in the
   * console to explain why. Three defects compounded: 0101 shipped
   * `last_sandbox_wipe_at` with no backfill (NULL reads as "wipe now"), the
   * stamp that would have cleared it hung on a missing connect(), and no wipe
   * of any kind wrote an audit row. Wipes are MANUAL from now on — the console
   * button and `scripts/db/sandbox-wipe.js --slug=…`, both audited.
   *
   * The scheduler itself is intact and honours every tenant's interval. A
   * deployment that genuinely wants the cadence back sets this to a cron
   * pattern AND sets sandbox_wipe_days > 0 on the tenants that want it — two
   * deliberate acts, not one forgotten default.
   */
  SANDBOX_WIPE_CRON: z.string().default(""),
  // God-Mode PIN rotation (G24): weekly, Monday 06:00 UTC — the legacy's
  // cadence, so a destructive credential is never standing for more than a
  // week.
  GODMODE_PIN_CRON: z.string().default("0 6 * * 1"),

  // Milestone SLA scan (MOD-31): 06:00 and 18:00 — the start and the end of a
  // working day, which is when somebody can still act on "this file will
  // breach". Tenants who want it hourly set `0 * * * *`; the scan is idempotent
  // and emits only on health transitions, so more often costs noise, not
  // correctness. Empty disables the schedule.
  MILESTONE_SLA_CRON: z.string().default("0 6,18 * * *"),
  MILESTONE_SLA_TZ: z.string().default("Africa/Douala"),

  // ---- System-email FALLBACK sender (deploy-wide, see src/services/platform/mail-fallback.service.js) ----
  // Praxis-owned SMTP used when a TENANT has not configured their own mail
  // (no email_identity / email setting) so system emails (OTP, invoices,
  // notifications) still go out instead of failing. This is a last-resort env
  // default only — the authoritative source is the `mail.fallback` platform
  // setting, configured + tested in the Platform Console (Integrations → Mail).
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: int(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  MAIL_FALLBACK_DOMAIN: z.string().default("praxisls.com"),
  MAIL_DEFAULT_FROM: z.string().default("no-reply@praxisls.com"),
  MAIL_SUPPORT_FROM: z.string().default("support@praxisls.com"),
  MAIL_FALLBACK_FROM_NAME: z.string().default("Praxis"),

  // Meta WhatsApp Cloud API (MOD-64 Smart Comms). Deploy-wide fallback only —
  // per-tenant creds are set + tested in Smart Comms (token encrypted in the
  // integration_secret vault, phone_id in the plain `comms` setting).
  META_WA_TOKEN: z.string().default(""),
  META_WA_PHONE_ID: z.string().default(""),
  META_WA_API_VERSION: z.string().default("v18.0"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./data/vault"),
  CDN_BASE_URL: z.string().default(""),
  S3_ENDPOINT: z.string().default(""),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY: z.string().default(""),
  S3_SECRET_KEY: z.string().default(""),
  S3_REGION: z.string().default("us-east-1"),
  // Path-style (bucket in the path, not the host) — required for MinIO and most
  // S3-compatible providers; virtual-hosted style is the AWS default.
  S3_FORCE_PATH_STYLE: bool(true),

  // ── Backups (INFRASTRUCTURE_PLAN §3.2, WS-B1/B3; decision D6) ────────────
  //
  // DELIBERATELY SEPARATE FROM THE STORAGE_* / S3_* SETTINGS ABOVE, and that
  // separation is the entire security property, not a naming preference. D6
  // ratified that offsite backups live in an INDEPENDENT provider/account from
  // primary storage: backups that share a credential with the thing they are
  // backing up do not survive the compromise of that credential, which is one
  // of the scenarios they exist for. Pointing BACKUP_S3_* at the same bucket as
  // S3_* is a supported configuration only for local development.
  BACKUP_DRIVER: z.enum(["local", "s3"]).default("local"),
  BACKUP_LOCAL_PATH: z.string().default("./data/backups"),
  BACKUP_S3_ENDPOINT: z.string().default(""),
  BACKUP_S3_BUCKET: z.string().default(""),
  BACKUP_S3_ACCESS_KEY: z.string().default(""),
  BACKUP_S3_SECRET_KEY: z.string().default(""),
  BACKUP_S3_REGION: z.string().default("us-east-1"),
  BACKUP_S3_FORCE_PATH_STYLE: bool(true),
  // Retention, per D4: nightly kept 30 days, weekly (Sunday) kept 12 weeks.
  BACKUP_RETAIN_DAILY_DAYS: int(30),
  BACKUP_RETAIN_WEEKLY_WEEKS: int(12),
  // 0 disables the nightly fleet backup (dev, or a deployment backing up by
  // other means). Named as a cron because D4's RPO is a wall-clock promise.
  BACKUP_CRON: z.string().default("0 1 * * *"),
  // Monthly restore drill. An unrehearsed backup is the thing §3.2 warns about,
  // so this is on by default; 0/"" disables it.
  // WS-B1 layer 2 — WAL archiving (D4's "RPO <= 5 min WHERE PITR is available").
  // Postgres is self-run here, so it IS available; this is the switch. Off by
  // default because turning it on without configuring Postgres's
  // archive_command would report a healthy archive that is empty.
  WAL_ARCHIVE_ENABLED: bool(false),
  // Postgres's own `archive_mode`, set on the postgres service in
  // docker-compose. Declared here — even though the APP never archives — so
  // `walStatus()` can catch the misconfiguration that is otherwise invisible:
  // the app watching an archive that Postgres was never told to write. Those
  // two switches disagreeing produces a permanently empty archive reported as
  // broken, with no indication of which half is wrong.
  WAL_ARCHIVE_MODE: z.enum(["on", "off"]).default("off"),
  WAL_ARCHIVE_PREFIX: z.string().default("wal"),
  // How stale the archive may get before it is called broken. A segment is
  // shipped on fill or on archive_timeout, so this must exceed archive_timeout
  // with room, or a quiet database looks like a dead archiver.
  WAL_MAX_LAG_MINUTES: int(15),

  RESTORE_DRILL_CRON: z.string().default("0 4 1 * *"),
  // A drill restores into a throwaway database on the same cluster; this is its
  // name prefix. Anything matching it is treated as disposable.
  RESTORE_DRILL_DB_PREFIX: z.string().default("praxis_drill_"),
  // D4's ratified RTO target, in seconds. A drill that exceeds it is recorded
  // and flagged rather than failed — a slow restore is still a restore.
  RESTORE_RTO_TARGET_SECONDS: int(3600),
  // pg_dump/pg_restore binaries, overridable where they are not on PATH or the
  // cluster version needs a matching client.
  PG_DUMP_BIN: z.string().default("pg_dump"),
  PG_RESTORE_BIN: z.string().default("pg_restore"),

  // ── Kaizen ops (§3.1, §3.4, §3.5) ────────────────────────────────────────
  //
  // Per-tenant health sweep. Distinct from HEALTH_SAMPLE_INTERVAL_MS (0093),
  // which samples the PLATFORM: this one probes each tenant's own path, which
  // is heavier, so it runs less often. 0 disables it.
  TENANT_HEALTH_INTERVAL_MS: int(300000),
  // AMBER thresholds. Named rather than inline so the rule is tunable per
  // deployment without editing the status function every fleet has to share.
  HEALTH_JOB_FAILURE_AMBER: int(5),
  HEALTH_ERROR_AMBER: int(50),
  HEALTH_LIVENESS_SLOW_MS: int(2000),
  // WS-S1 capacity headroom — the leading indicators. See runtime-config for
  // why these defaults, and pooler-stats.service.js for why the second one is
  // only ever populated once PgBouncer carries traffic.
  HEALTH_POOL_UTILISATION_AMBER: int(80),
  HEALTH_POOLER_MAXWAIT_AMBER_MS: int(100),

  // Uptime probing (WS-U1). The interval is also the DENOMINATOR of the
  // availability figure — a missing sample counts as downtime — so changing it
  // changes what past percentages mean. 0 disables probing.
  UPTIME_PROBE_INTERVAL_MS: int(300000),
  UPTIME_PROBE_TIMEOUT_MS: int(10000),
  UPTIME_PROBE_PATH: z.string().default("/api/health/ready"),
  UPTIME_PROBE_SCHEME: z.enum(["http", "https"]).default("https"),
  // Whether the API process probes as well.
  //
  // Set FALSE once `scripts/ops/uptime-probe.js` runs as its own process, which
  // is the arrangement WS-U1 actually asks for — a prober inside the API cannot
  // observe the API being down. This is a separate switch from
  // UPTIME_PROBE_INTERVAL_MS deliberately: that value is the DENOMINATOR of the
  // availability figure, so zeroing it to stop the in-process sweep would also
  // silently redefine every past percentage. Two writers on the same interval
  // would double-sample and inflate the numbers, so exactly one should be on.
  UPTIME_PROBE_IN_PROCESS: bool(true),

  // Read by scripts/deploy.sh, not by the application — it decides whether the
  // `uptime-probe` container is rolled in THIS compose stack. Declared here
  // anyway so it validates like everything else and appears in the schema
  // rather than being an undocumented string the deploy script greps for.
  //
  // Default true: on a single-host deployment the in-compose prober is the
  // honest minimum (it survives an API crash, though not a host loss). Set
  // false when a prober runs on another host or region, which is better and is
  // what the service's own docstring recommends.
  UPTIME_PROBE_IN_COMPOSE: bool(true),

  // How long `entitlement.guard` may reuse a tenant's resolved plan status.
  // Usage is written by the metering sweep, so this cannot make the figure
  // staler than it already is; it exists to keep a per-action check off the
  // platform database. Limit CHANGES bypass it — the console invalidates on
  // write. Deliberately absent from .env.example: it defaults at the call site.
  ENTITLEMENT_STATUS_TTL_MS: int(60_000),
  // Retention for uptime_sample. Longer than health (30d) because this series
  // feeds monthly and annual availability reporting.
  UPTIME_RETAIN_DAYS: int(90),
  // The platform/admin host, probed alongside the tenant subdomains.
  PLATFORM_HOST: z.string().default(""),

  // Alert routing (WS-ER1). ALERT_WEBHOOK_URL (above) is the general channel;
  // this optional second destination is for `page`-severity events only, so a
  // fatal can reach somewhere noisier than the daily notice channel. When
  // unset, pages fall back to the general webhook — a misconfiguration must
  // degrade to "too noisy", never to "silent".
  ALERT_WEBHOOK_PAGE_URL: z.string().default(""),
  // How often the ops state is evaluated for alerting. Much less frequent than
  // collection on purpose: a channel that repeats the same RED tenant every
  // five minutes gets muted, and a muted channel is no alerting at all.
  OPS_ALERT_INTERVAL_MS: int(1800000),

  // WS-S3 — how often usage is re-measured. Enforcement reads these figures, so
  // this is also how far a tenant can drift past a hard limit between sweeps.
  // Hourly keeps that to a unit or two; the seat path takes a live count
  // anyway, because there the tenant connection is already open.
  USAGE_METER_INTERVAL_MS: int(3600000),

  PUPPETEER_EXECUTABLE_PATH: z.string().default(""),
  SANDBOX_WIPE_DAYS: int(14),

  // Orchestration outbox (Plan A): how often the scheduler fans a dispatch job
  // per tenant to drain event_log. 0 disables the recurring schedule.
  ORCHESTRATION_DISPATCH_INTERVAL_MS: int(30000),

  // Mail engine (doc/EMAIL_ENGINE_PLAN.md): how often the scheduler fans an IMAP
  // sync job per LIVE tenant to pull inbound mail. 0 disables the poll.
  MAIL_SYNC_INTERVAL_MS: int(60000),
  // How often the send queue is drained. 5s, because it is the floor on how long
  // a message waits AFTER its undo window expires — a 60s tick would turn a 20s
  // undo into "somewhere between 20 and 80 seconds", which reads as unreliable.
  // The tick is cheap: one indexed query per tenant that usually returns nothing.
  MAIL_SEND_FLUSH_INTERVAL_MS: int(5000),
  // Daily domain-health re-check (PR-2). 0 disables the schedule; POST
  // /mail/deliverability/check still runs on demand.
  MAIL_DELIVERABILITY_INTERVAL_MS: int(86400000),
  // Public RBLs for the sending IP. Comma-separated. A paid feed later is a
  // value change, not a code change (Q35).
  MAIL_RBL_HOSTS: z.string().default("zen.spamhaus.org,bl.spamcop.net,b.barracudacentral.org"),
  MAIL_SECURE_LINK_DAYS: int(7),
  // SLA clocks (PR-5 §9.2). 5 minutes: the sweep computes due dates for newly
  // arrived threads and raises breaches, so the interval is the worst-case
  // lateness of a breach alert, not of the underlying promise.
  MAIL_SLA_SWEEP_INTERVAL_MS: int(300000),
  // Snooze / no-reply boomerang / sequence steps (PR-5 §9.3). 1 minute, because
  // a follow-up is a wall-clock promise a person made to themselves — "bring
  // this back at 14:00" arriving at 14:05 is fine, at 15:00 is not.
  MAIL_FOLLOWUP_SWEEP_INTERVAL_MS: int(60000),
  MAIL_AI_MONTHLY_CAP_XAF: int(0),

  // How often to renew push subscriptions (Graph webhooks expire ~3d). 0 disables.
  MAIL_WEBHOOK_RENEW_INTERVAL_MS: int(21600000), // 6h

  // Error Command Center (doc/PROMPT_ErrorMonitor_Module.md §5.3): how often the
  // escalation evaluator sweeps active rules. 0 disables escalation entirely
  // while leaving capture, the feed and the dashboard fully working — which is
  // the right default posture for a fresh deploy that has no recipients
  // configured yet. 60s is well inside the smallest sensible rule window (the
  // schema floors threshold_window_minutes at 1).
  ERROR_ESCALATION_INTERVAL_MS: int(60000),

  // Health sampling (§8.2 "99.97% Uptime (30d)"). The collector writes one row
  // per tick to platform.health_sample, and this interval is ALSO the
  // denominator uptime is computed against — a missing sample counts as
  // downtime, because a collector that only records while it is running cannot
  // see its own outage. Changing it therefore changes the meaning of historical
  // rows: samples written at 60s and read back assuming 300s report a fifth of
  // the real uptime. Change it once, early, or purge the table with it.
  //
  // 0 disables collection; uptime then reports null and the widget renders "—"
  // rather than a figure nothing is measuring.
  HEALTH_SAMPLE_INTERVAL_MS: int(60000),

  // Gmail push (optional): Cloud Pub/Sub topic for users.watch. Empty ⇒ Gmail
  // stays on delta polling (no push).
  GOOGLE_PUBSUB_TOPIC: z.string().default(""),

  // Microsoft Graph mail (doc/EMAIL_ENGINE_PLAN.md Phase 2) — deploy-wide Azure
  // app registration. Client secret is deploy-wide (like VAPID); per-mailbox
  // OAuth tokens live encrypted in the tenant's integration_secret vault.
  // REDIRECT_URI empty ⇒ derived per-request from the tenant subdomain host.
  MS_GRAPH_CLIENT_ID: z.string().default(""),
  MS_GRAPH_CLIENT_SECRET: z.string().default(""),
  MS_GRAPH_TENANT: z.string().default("common"),
  MS_GRAPH_SCOPES: z.string().default("offline_access User.Read Mail.Read Mail.Send Mail.ReadWrite"),
  MS_GRAPH_REDIRECT_URI: z.string().default(""),

  // Google Gmail mail (doc/EMAIL_ENGINE_PLAN.md Phase 2) — deploy-wide Google
  // Cloud OAuth client. Per-mailbox tokens live in the tenant vault. Inbound via
  // Gmail history delta polling (Pub/Sub push is a later accelerator).
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_SCOPES: z.string().default("openid email https://www.googleapis.com/auth/gmail.modify"),
  GOOGLE_REDIRECT_URI: z.string().default(""),

  // Web-Push (VAPID) — deploy-wide identity, one keypair per deployment. Set +
  // tested in the Platform Console (private key encrypted in platform_setting);
  // these env vars are a fallback only. Generate via the console or web-push.
  VAPID_PUBLIC_KEY: z.string().default(""),
  VAPID_PRIVATE_KEY: z.string().default(""),
  VAPID_SUBJECT: z.string().default("mailto:admin@praxisls.com"),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  /// eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Environment validation failed — see errors above.");
}

// Production safety guard: the schema ships dev-safe defaults so the app boots
// without a .env. Those published defaults are a full auth-bypass in production,
// so refuse to boot in production unless real values are set.
const INSECURE_DEFAULTS = {
  JWT_ACCESS_SECRET: "__dev_access__",
  JWT_REFRESH_SECRET: "__dev_refresh__",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};
/**
 * TC-E2 — NOT BROADENED, and the attempt is worth recording so the next person
 * does not repeat it.
 *
 * The finding is that this guard keys solely on `NODE_ENV === "production"`,
 * while the defaults it protects are published in this repo. The obvious fix is
 * to add corroborating signals. Both candidates are wrong here:
 *
 *   APP_BASE_DOMAIN — defaults to "praxisls.com" (line 35), i.e. the DEFAULT is
 *     already production-shaped. Tripping on "domain is not localhost" throws on
 *     every developer machine, every unit test and every CI job, all of which
 *     legitimately run on the dev secrets. Written, then caught before it
 *     shipped by asking what the default actually is.
 *
 *   DB_HOST — is `postgres` in docker-compose, which is ALSO what production
 *     uses, because it is a compose service name. So "host is not local" never
 *     fires where it matters and does fire for a developer pointed at a remote
 *     database. Exactly backwards.
 *
 * And the scenario the audit worried about is narrower than it reads: the
 * Dockerfile sets `ENV NODE_ENV=production` on the runtime and worker stages, so
 * `docker compose run --rm api node scripts/…` INHERITS it and is already
 * guarded. The genuine residual is a process started outside Docker on the host
 * with NODE_ENV unset — where the schema default is "development" (line 33).
 *
 * The real fix is therefore to stop having exploitable defaults at all
 * (generate per-install secrets, or make these three required with no default),
 * which is a behaviour change needing sign-off — not a cleverer sniff. Left as
 * reported rather than shipping a guard that fires everywhere except production.
 */
if (parsed.data.NODE_ENV === "production") {
  const offenders = [];
  for (const [key, insecure] of Object.entries(INSECURE_DEFAULTS)) {
    if (parsed.data[key] === insecure) offenders.push(key);
  }
  if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
    offenders.push("JWT_ACCESS_SECRET_and_REFRESH_must_differ");
  }
  if (!parsed.data.DB_PASSWORD) offenders.push("DB_PASSWORD_empty");
  if (offenders.length) {
    /// eslint-disable-next-line no-console
    console.error("Refusing to boot in production with insecure/default secrets:", offenders.join(", "));
    throw new Error("Insecure production configuration — set real values for: " + offenders.join(", "));
  }
}

const config = Object.freeze(parsed.data);

const groups = Object.freeze({
  platform: {
    host: config.DB_HOST, port: config.DB_PORT, database: config.DB_NAME,
    user: config.DB_USER, password: config.DB_PASSWORD, schema: config.DB_PLATFORM_SCHEMA,
  },
  redis: { url: config.REDIS_URL },
  jwt: {
    accessSecret: config.JWT_ACCESS_SECRET, refreshSecret: config.JWT_REFRESH_SECRET,
    accessTtl: config.JWT_ACCESS_TTL, refreshTtl: config.JWT_REFRESH_TTL,
  },
  ai: {
    enabledDefault: config.AI_ENABLED_DEFAULT,
    deepseek: { key: config.DEEPSEEK_API_KEY, baseUrl: config.DEEPSEEK_BASE_URL, model: config.DEEPSEEK_MODEL },
    gemini: { key: config.GEMINI_API_KEY, model: config.GEMINI_MODEL },
    groq: { key: config.GROQ_API_KEY, whisperBaseUrl: config.WHISPER_BASE_URL },
    embeddings: {
      provider: config.EMBEDDINGS_PROVIDER, model: config.EMBEDDINGS_MODEL, dim: config.EMBEDDINGS_DIM,
      openaiKey: config.OPENAI_API_KEY, openaiBaseUrl: config.OPENAI_BASE_URL,
    },
    monthlyCapXaf: config.AI_MONTHLY_CAP_XAF,
  },
  storage: {
    driver: config.STORAGE_DRIVER, localPath: config.STORAGE_LOCAL_PATH,
    s3: { endpoint: config.S3_ENDPOINT, bucket: config.S3_BUCKET, accessKey: config.S3_ACCESS_KEY, secretKey: config.S3_SECRET_KEY },
  },
});

module.exports = { config, groups, misparsedEnvKeys };
