import {
  page, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
  setChapter,
} from "./kit.mjs";

const F = (s) => `CHAPTER 2 &mdash; ENVIRONMENT &amp; FIRST RUN &nbsp;&middot;&nbsp; ${s}`;

export function chapter() {
  setChapter(2);
  const out = [];

  out.push(page("", F("WHAT YOU ARE BUILDING"), [
    band("02", "Environment &amp; First Run", "WEEK 1 &middot; <b>LAB</b> &middot; ~4 HOURS &middot; TERMINAL OPEN"),
    lead("By the end of this chapter the whole platform runs on your machine: Postgres with pgvector, Redis, a connection pooler, the migrator, the API, the worker fleet, and both front ends. You will also run the 33-gate CI suite for the first time and read what it tells you."),

    h2("The two ways to run it"),
    cards([
      { name: "OPTION A", role: "DOCKER COMPOSE — RECOMMENDED", color: "var(--fin)", items: [
        "One command, everything included",
        "Matches production topology exactly",
        "Slower file watching on macOS",
        "Start here on day one",
      ]},
      { name: "OPTION B", role: "NATIVE — FASTER INNER LOOP", color: "var(--accent-gold)", items: [
        "You install Postgres 16 + Redis yourself",
        "<code>npm run setup:local</code> does the rest",
        "Fastest edit-reload cycle",
        "Move here once Option A has worked once",
      ]},
    ]),

    callout("<strong>Do Option A first, even if you intend to live in Option B.</strong> Getting the compose stack up proves your Docker, your ports and your <code>.env</code> are sane, and it is the same topology you will deploy in Chapter 11. Debugging a native setup without ever having seen the system work is the hard way round."),

    h2("The services, and what each is for"),
    stack([
      ["<code>postgres</code>", "Postgres 16 on the stock <b>pgvector</b> image. Holds every tenant schema plus <code>platform</code>. The vector extension is for AI embeddings (Chapter 9), not an optional extra."],
      ["<code>redis</code>", "Three jobs: the BullMQ queue backing <code>src/jobs/</code>, the shared rate-limit store, and the cache in <code>src/shared/cache/</code>."],
      ["<code>pgbouncer</code>", "Connection pooler. Postgres connections are expensive; with several API containers plus a worker fleet you exhaust <code>max_connections</code> quickly. The pooler is why the app can scale horizontally."],
      ["<code>migrate</code>", "A <b>one-shot</b> container. Runs platform then tenant migrations and exits. Deploys wait for it to exit 0 before starting the app — that ordering is the whole point."],
      ["<code>api</code> / <code>api-standby</code>", "<code>node src/server.js</code>. Two of them, so a deploy can shift traffic without a gap."],
      ["<code>worker</code>", "<code>node src/jobs/workers.js</code>. Consumes the queue: PDF rendering, email, FX sync, mail sync, sweeps."],
      ["<code>uptime-probe</code>", "Polls the health endpoints and records availability. Chapter 11."],
      ["<code>puppeteer-preflight</code>", "Verifies the headless-Chrome dependency needed for PDF rendering, at startup rather than at 2am when a client asks for an invoice."],
    ]),

    quiz("Why is <code>migrate</code> a separate one-shot container instead of code that runs when the API boots?",
      ["It's just cleaner organisation",
       "So migrations run exactly once for the whole fleet, and complete before any app container serves traffic",
       "Because migrations need more memory",
       "To keep the API image smaller"],
      1,
      "If each API container migrated on boot, three containers would race to apply the same migration, and a container could serve requests against a half-migrated schema. A one-shot container that must exit 0 first gives you a single, ordered, verifiable migration step — the same reason the deploy script waits on it."),
  ].join("\n")));

  // ---------------------------------------------------------------- env vars
  out.push(page("", F("THE ENV FILE"), [
    h1("86 Variables, and Why It Refuses To Boot"),
    lead("<code>.env.example</code> is 21 KB and defines 86 variables. That sounds hostile until you understand the design: every one is parsed and validated by Zod at boot, and a missing or malformed value <b>stops the process</b> rather than producing a subtle runtime failure three hours later."),

    h2("Fail fast, loudly", "src/config/env.js"),
    callout("<strong>A misconfigured system that boots is worse than one that doesn't.</strong> If <code>SMTP_HOST</code> is empty and the app starts anyway, you discover it when a client's password-reset email never arrives &mdash; silently, days later, with no error anywhere. Validating at boot converts an invisible production incident into a visible startup failure on your laptop. This is the same instinct as the CI gates: <b>move the failure as early and as loudly as possible.</b>", "green"),

    h2("The groups"),
    table("mst", ["Group", "Examples", "Note"], [
      ["<b>Core</b>", "<code>NODE_ENV</code>, <code>PORT</code>, <code>APP_BASE_DOMAIN</code>", "<code>APP_BASE_DOMAIN</code> drives tenant resolution <i>and</i> the CORS allowlist."],
      ["<b>Auth</b>", "<code>JWT_SECRET</code>, session config, <code>TRUST_PROXY_HOPS</code>", "<code>TRUST_PROXY_HOPS</code> is a security control — see below."],
      ["<b>Database</b>", "<code>DATABASE_URL</code>, pool sizes, statement timeouts", "Pool max interacts with the one-connection-per-request model."],
      ["<b>Redis</b>", "<code>REDIS_URL</code>, queue prefixes", "Shared by queue, cache and rate limiter."],
      ["<b>AI</b>", "Vendor keys, model names, embedding config", "Chapter 9. Absent keys degrade features, they do not crash."],
      ["<b>Mail</b>", "<code>SMTP_*</code>, IMAP sync settings", "The mail module both sends and syncs."],
      ["<b>Storage</b>", "Driver (<code>local</code> or <code>s3</code>), bucket, signing TTL", "The <code>/media</code> route is allow-listed regardless of driver."],
      ["<b>Ops</b>", "Alerting webhooks, health thresholds, backup and restore-drill schedules, uptime, DB budget", "Chapter 11 uses all of these."],
    ]),

    h2("One variable worth studying"),
    cmd(`# src/server.js
app.set("trust proxy", config.TRUST_PROXY_HOPS > 0 ? config.TRUST_PROXY_HOPS : false);`),
    bl([
      "This was once <code>true</code>, meaning &ldquo;trust the entire <code>X-Forwarded-For</code> chain&rdquo;.",
      "The left of that chain is written by <b>the client</b>. So <code>req.ip</code> was attacker-controlled.",
      "Which meant every IP-keyed rate limiter could be bypassed, and every audit row's <code>ip</code> could be forged.",
      "A <b>hop count</b> makes Express take the address appended by the proxy you actually run.",
    ]),
    callout("<strong>Notice the shape of that fix.</strong> The vulnerable version was not sloppy &mdash; <code>trust proxy: true</code> is in a hundred tutorials. It was <i>wrong for this deployment</i>. Most real security work looks like this: not exotic exploits, but a default that stops being safe once you know where your traffic comes from.", "gold"),
  ].join("\n")));

  // ---------------------------------------------------------------- lab: compose
  out.push(page("", F("LAB 2A &mdash; THE STACK UP"), [
    band("L2A", "Lab &mdash; Bring The Stack Up", "WEEK 1 &middot; <b>HANDS ON</b> &middot; ~60 MIN &middot; DOCKER", "lab"),
    lead("Work through these in order. If a step fails, do not skip it &mdash; the failures here are the ones you will meet again on a client's server."),

    h2("Step 1 &mdash; Prerequisites"),
    cmd(`node --version      # expect v20.x
docker --version
docker compose version
git --version`),
    req([
      "Node 20 installed (not 18, not 22 &mdash; match the Dockerfile base).",
      "Docker Desktop or Docker Engine running.",
      "At least 4 GB free RAM allocated to Docker.",
      "Ports 5432, 6379, 6432 and 3000 free on the host.",
    ]),

    h2("Step 2 &mdash; Configure"),
    cmd(`cp .env.example .env

# Open .env and set, at minimum:
#   DATABASE_URL       point at the compose postgres service
#   REDIS_URL          point at the compose redis service
#   JWT_SECRET         any long random string for local
#   APP_BASE_DOMAIN    localhost  (see the note below)
#
# Leave the AI, SMTP and S3 keys empty for now. Those features
# degrade gracefully; you do not need them to boot.`),

    callout("<strong>Read <code>.env.example</code> top to bottom once.</strong> It is 21 KB of comments explaining what each knob does &mdash; genuinely one of the better documents in the repo. Twenty minutes here saves a day later.", "gold"),

  ].join("\n")));

  out.push(page("", F("LAB 2A &mdash; UP &amp; ALIVE"), [
    h1("Lab 2A &mdash; Bringing It Up"),
    lead("Two commands, then the two questions that tell you whether it really worked."),

    cmd(`docker compose up -d postgres redis pgbouncer

# Wait for postgres to report healthy, then run the one-shot migrator
docker compose run --rm migrate

# Expect: platform migrations applied, then tenant migrations, then exit 0.
# A non-zero exit here means STOP and read the output. Do not start the API.

docker compose up -d api worker
docker compose ps`),

    ex("Record what came up", "10 min",
      "<p>Paste the output of <code>docker compose ps</code>. For each service, note its state. Then answer: which one is <b>not</b> running, and why is that correct?</p>",
      "…"),

    h2("Step 4 &mdash; Prove it is alive"),
    cmd(`curl -s localhost:3000/api/health          # liveness  — must never fail
curl -s localhost:3000/api/health/ready    # readiness — probes PG, Redis, modules`),

    callout("<strong>Two health endpoints, not one, and the difference is a real lesson.</strong> Liveness answers &ldquo;is the process alive&rdquo; and has no dependencies, so it cannot fail. Readiness actually probes Postgres, Redis and the module loader, and returns <b>503</b> when they are down. There used to be a single inline <code>{ok:true}</code> handler, and <code>deploy.sh</code> used it as the gate that said a deploy had worked &mdash; a check that could not fail, guarding the thing most worth checking. Chapter 11 returns to this.", "red"),

    quiz("<code>/api/health</code> returns 200 but <code>/api/health/ready</code> returns 503. What have you learned?",
      ["The server is broken and should be restarted",
       "The process is up but a dependency — Postgres, Redis or module loading — is not; the container is alive but must not receive traffic",
       "Nothing; 503 is normal at startup",
       "The load balancer is misconfigured"],
      1,
      "That is precisely the split the two endpoints exist to express. An orchestrator uses liveness to decide whether to <i>restart</i> the container and readiness to decide whether to <i>route traffic</i> to it. Restarting on a failed readiness probe when the real problem is that Postgres is down turns one outage into a crash loop."),
  ].join("\n")));

  // ---------------------------------------------------------------- lab: data
  out.push(page("", F("LAB 2B &mdash; A TENANT AND A LOGIN"), [
    band("L2B", "Lab &mdash; Create A Tenant, Log In", "WEEK 1 &middot; <b>HANDS ON</b> &middot; ~45 MIN", "lab"),
    lead("An empty platform has no tenants, so there is nothing to log into. Provisioning a tenant creates its schema, runs the tenant migrations into it, and registers it. This is a miniature of the real client onboarding in Chapter 13."),

    h2("Step 1 &mdash; Provision"),
    cmd(`# The convenience script does platform migrate + provision in one go
npm run db:reset:local

# Which is equivalent to:
#   node scripts/db/migrate-platform.js
#   node scripts/db/provision-tenant.js --slug=smartls --name="Smart Logistics"`),

    h2("Step 2 &mdash; Make an admin"),
    cmd(`node scripts/tenant/create-admin.js --slug=smartls \\
  --email=you@example.com --password=secret123 --name="Your Name"

# And a platform (JBS staff) admin for the console:
node scripts/platform/create-admin.js`),

  ].join("\n")));

  out.push(page("", F("LAB 2B &mdash; TALKING TO THE TENANT"), [
    h1("Lab 2B &mdash; Talking To The Tenant"),
    lead("You have a tenant and an admin. Now find out how the API decides which tenant you mean."),

    h2("Step 3 &mdash; Talk to the tenant API"),
    callout("<strong>Here is Trap 2 from Chapter 1, in the flesh.</strong> <code>localhost</code> is a <b>platform</b> host. Calling <code>/api/tenant/*</code> on it gets you <code>400 WRONG_HOST</code> &mdash; correctly. In development you pass the tenant explicitly with a header.", "gold"),
    cmd(`# WRONG — this is a platform host, so there is no tenant
curl -s localhost:3000/api/tenant/whoami

# RIGHT — name the tenant explicitly in development
curl -s localhost:3000/api/tenant/whoami \\
  -H "X-Praxis-Tenant: smartls"

# Expect: { "data": { "tenant": "smartls", "env": "live", "is_live": ... } }`),

    ex("Read the error you got", "10 min",
      "<p>Run the WRONG version first and paste the full JSON response. Identify the three parts of the error envelope. Then say what a client-side developer could do with the <code>request_id</code>, and what the <code>message</code> told them that a bare 500 would not have.</p>",
      "Response: … / The three parts are … / request_id lets me …"),

    h2("Step 4 &mdash; The whole system, one command"),
    cmd(`# Native route (Option B) — DB steps then boot, idempotent, re-runnable
npm run setup:local

# Add the worker alongside the API
node scripts/local-setup.js --with-worker

# Just the DB work, no server
node scripts/local-setup.js --no-start`),

    ex("Log in through the UI", "15 min",
      "<p>Start the client (<code>npm run dev --prefix client</code>), open it in a browser, and log in with the admin you created. Then find any list screen and note: how many rows, and does the empty state or the populated state appear? Write down the first screen you saw that made you think &ldquo;how did they build that?&rdquo; &mdash; you will build one in Chapter 7.</p>",
      "Screen: … / What puzzled me: …"),
  ].join("\n")));

  // ---------------------------------------------------------------- CI
  out.push(page("", F("LAB 2C &mdash; RUNNING THE GATES"), [
    band("L2C", "Lab &mdash; Run All 33 Gates", "WEEK 1 &middot; <b>HANDS ON</b> &middot; ~40 MIN", "lab"),
    lead("<code>npm run ci</code> runs the same checks the pipeline runs. Running it now, on an unmodified checkout, teaches you what &ldquo;green&rdquo; looks like &mdash; so that when you break something in Week 2 you can tell the difference."),

    cmd(`npm run ci            # everything (slow — go make coffee)
npm run ci:fast       # the quick subset
npm run ci:backend    # backend gates only
npm run ci:frontend   # client + console gates only`),

    h2("What the 33 gates actually check", "scripts/ci-local.js is the authority"),
    table("mst", ["Family", "Gates", "The invariant"], [
      ["<b>Style</b>", "Lint (backend, client, console), fonts, motion budget, raw-palette, design-token contrast", "The UI cannot drift off-brand, and contrast stays accessible."],
      ["<b>Config</b>", "Env template matches the schema", "<code>.env.example</code> cannot fall behind <code>config/env.js</code> — so a new var is never undocumented."],
      ["<b>Tests</b>", "jest (backend), vitest (client), console tests", "375 backend test files."],
      ["<b>Migrations</b>", "Numbering, reversibility, idempotency, destructive-declaration, schema drift", "Five separate gates. Chapter 4 explains each."],
      ["<b>SQL safety</b>", "Query columns exist, citext[] reads are cast", "A query naming a column that does not exist fails in CI, not in production."],
      ["<b>Contracts</b>", "API contract, response-contract drift, API docs in sync, shared schema, shared-schema gate", "The published surface and its docs cannot diverge."],
      ["<b>Correctness</b>", "Write routes are validated, no silent catches, actor-FK guard, no FX literals, jest.mock hoisting", "Each one encodes a bug class that reached production once."],
      ["<b>Build</b>", "tsc + vite build, bundle graph, frontend guide is not lying", "Including a gate that checks the <i>documentation</i> against the code."],
    ]),

    callout("<strong>&ldquo;Frontend guide is not lying&rdquo; is a real gate name.</strong> <code>client/</code> has a check that verifies the code examples in <code>doc/FRONTEND_GUIDE.md</code> still match the components they describe. Consider what that says about how seriously this team takes documentation drift &mdash; and hold your own writing to it.", "green"),

    ex("Read one gate's source", "20 min",
      "<p>Pick any gate from <code>scripts/</code> that sounds mysterious &mdash; <code>check-silent-catch.js</code>, <code>check-actor-fk-guard.js</code> and <code>check-currency-literals.js</code> are all good choices. Read it. Then write: (a) what pattern it looks for, (b) the bug it prevents, and (c) how you would trigger it deliberately.</p>",
      "Gate: … / Pattern: … / Bug: … / To trigger it I would …"),

    quiz("<code>npm run lint</code> is configured as <code>eslint . --max-warnings 136</code>. Why an oddly specific number?",
      ["It's arbitrary — someone picked a round-ish figure",
       "It's a ratchet: 136 is the current debt, pinned so it can never grow, and lowered as warnings are fixed",
       "ESLint requires a numeric limit",
       "It allows 136 files to be skipped"],
      1,
      "A ratchet is how you improve a large codebase without stopping to fix everything first. Zero would fail today; unlimited permits infinite decay. Pinning the current count means any new warning fails the build, and every cleanup PR lowers the number. You will meet the same pattern as a coverage ratchet in Chapter 6."),
  ].join("\n")));

  // ---------------------------------------------------------------- checkpoint
  out.push(page("", F("CHAPTER 2 CHECKPOINT"), [
    h1("Chapter 2 Checkpoint"),
    lead("This is the first checkpoint with real consequences. Everything from Chapter 4 onwards assumes a working local stack, so do not tick these optimistically."),

    rgroup("2.1", "The stack runs", [
      "<code>docker compose ps</code> shows postgres, redis, pgbouncer, api and worker up.",
      "<code>migrate</code> ran and exited <b>0</b>.",
      "<code>/api/health</code> returns 200 and <code>/api/health/ready</code> returns 200.",
      "I can explain the difference between those two endpoints without looking.",
    ]),
    rgroup("2.2", "Data and access", [
      "A tenant is provisioned and I know its slug.",
      "I created a tenant admin and logged into the client UI.",
      "I called <code>/api/tenant/whoami</code> successfully with <code>X-Praxis-Tenant</code>.",
      "I triggered <code>WRONG_HOST</code> on purpose and read the envelope.",
    ]),
    rgroup("2.3", "The gates", [
      "<code>npm run ci</code> completed on an unmodified checkout.",
      "I know where the authoritative gate list lives.",
      "I read the source of at least one gate and can explain what it prevents.",
      "I understand why <code>--max-warnings 136</code> is a ratchet, not a magic number.",
    ]),
    rgroup("2.4", "Configuration", [
      "I read <code>.env.example</code> end to end.",
      "I can name the eight variable groups.",
      "I can explain the <code>TRUST_PROXY_HOPS</code> fix and why <code>true</code> was unsafe here.",
      "I understand why the app refuses to boot on bad config.",
    ]),

    dod(["Stack up", "Tenant provisioned", "Logged in", "CI green", "Gate source read"]),

    callout("<strong>If CI is red on a clean checkout,</strong> that is worth raising with your lead before continuing &mdash; it usually means a local dependency (Docker, a Postgres extension, a Chrome download) rather than the repo. Do not spend a day alone on it; this is exactly the escape hatch the team expects you to use.", "gold"),
  ].join("\n")));

  return out;
}
