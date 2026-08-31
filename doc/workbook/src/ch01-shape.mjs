import {
  page, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
  setChapter,
} from "./kit.mjs";

const F = (s) => `CHAPTER 1 &mdash; THE SHAPE OF THE SYSTEM &nbsp;&middot;&nbsp; ${s}`;

export function chapter() {
  setChapter(1);
  const out = [];

  // ------------------------------------------------------------------ opener
  out.push(page("", F("ORIENTATION"), [
    band("01", "The Shape of the System", "WEEK 1 &middot; <b>TEACH</b> &middot; ~3 HOURS &middot; NO CODE YET"),
    lead("Before you change one line, you need a map. A codebase of this size punishes people who start typing early &mdash; not because it is clever, but because almost every rule in it was written the day something broke. This chapter is the map, and every claim in it points at a file you can open."),

    h2("What you are looking at", "the numbers, so the scale is not a surprise"),
    table("mst", ["Dimension", "Count", "What that means for you"], [
      ["Backend JS files", "<b>1,225</b>", "You will never read them all. You will learn where to look."],
      ["Feature modules", "<b>131</b> in 26 groups", "Each is 5&ndash;8 small files in one folder. That is the unit of work."],
      ["HTTP routes", "<b>1,422</b> (129 mounted)", "Auto-discovered. Nobody maintains a central route list."],
      ["Migrations", "<b>313</b>", "The schema's history, in order, forward-only in production."],
      ["Test files", "<b>375</b>", "Unit, integration, db and security gates."],
      ["Error codes", "<b>478</b>", "Generated into <code>doc/ERROR_CODES.md</code>, never hand-written."],
      ["Env vars", "<b>86</b>", "Every one validated by Zod at boot, or the process refuses to start."],
      ["CI gates", "<b>33</b>", "<code>npm run ci</code>. All must pass. There is no override."],
    ]),

    callout("<strong>None of this is here to intimidate you.</strong> A 131-module system is easier to work in than a 12-module one, provided every module has the same shape. That is the whole bet this codebase makes: <b>relentless sameness</b>, so that knowing one module means knowing all of them. Chapter 3 teaches you that one module."),

    h2("The one-sentence description"),
    val("<strong>Praxis LS is a multi-tenant ERP platform:</strong> one Node/Express API and one React SPA, serving many client companies whose data is separated by Postgres schema, with a background worker fleet, a Redis-backed queue, and an AI layer that can drive the same operations a user can &mdash; under exactly the same permissions."),

    quiz("Why does the number of routes (1,422) matter more than the number of files (1,225)?",
      ["It doesn't; both are just size metrics",
       "Routes are the system's public surface — every one is a promise to a client, and a contract a test can hold you to",
       "Fewer files means better code",
       "Routes are cheaper to change than files"],
      1,
      "Files are an implementation detail you can reorganise freely. A route is a published contract: a client's browser, a mobile app or an integration may be calling it right now. That is why this repo has an API-contract gate in CI and generates <code>doc/API_REFERENCE.md</code> from the code rather than by hand."),
  ].join("\n")));

  // ------------------------------------------------------------------ layers
  out.push(page("", F("THE FIVE LAYERS"), [
    h1("The Five Layers"),
    lead("Everything in <code>src/</code> belongs to exactly one of five layers, and the layers only ever call downward. If you can place a file in this list, you know what it is allowed to do."),

    stack([
      ["<b>1 &middot; Entry</b><br><code>src/server.js</code>, <code>src/routes/index.js</code>",
       "Builds the Express app, applies global middleware, mounts two API surfaces: <code>/api/platform/*</code> (JBS staff) and <code>/api/tenant/*</code> (client users). Also serves the built SPA."],
      ["<b>2 &middot; Middleware</b><br><code>src/middleware/</code>",
       "Twelve files, each answering one question about a request before a handler sees it: who is the tenant, who is the user, may they do this, is this a replay, what is the request id."],
      ["<b>3 &middot; Modules</b><br><code>src/modules/&lt;group&gt;/&lt;module&gt;/</code>",
       "The features. 131 folders, each with the same file set. <b>This is where you will spend 80% of your time.</b>"],
      ["<b>4 &middot; Shared</b><br><code>src/shared/</code>",
       "The machinery modules stand on: db helpers, transactions, the CRUD factory, event emission, HTTP utilities, cache, observability. Changing something here changes 131 modules at once, so it is the most carefully guarded code in the repo."],
      ["<b>5 &middot; Services &amp; Jobs</b><br><code>src/services/</code>, <code>src/jobs/</code>",
       "Cross-cutting concerns (AI, storage, mail, tenant registry) and everything that happens off the request thread: 44 queue handlers and their schedulers."],
    ]),

    h2("The rule that makes it work", "one direction only"),
    callout("<strong>A layer may call downward. It may never call upward, and it may never reach sideways past its own boundary.</strong> A controller does not run SQL. A repo does not emit events. A module does not import another module's repo. When you are unsure whether something belongs in the service or the repo, ask which layer would have to know about HTTP to make it work &mdash; that is always the wrong layer.", "gold"),

    h2("Where the other top-level directories live"),
    bl([
      "<code>src/config/</code> &mdash; env parsing (Zod), logger, Redis, request context. Boot-time only.",
      "<code>src/orchestration/</code> &mdash; multi-step processes that span modules.",
      "<code>src/realtime/</code> &mdash; websocket push.",
      "<code>src/utils/</code> &mdash; leaf helpers with no dependencies, including <code>AppError</code>.",
      "<code>client/</code> &mdash; the tenant React SPA. <code>console/</code> &mdash; the JBS staff console. <code>packages/</code> &mdash; brand tokens and schemas shared between server and client.",
    ]),

    quiz("You need to send an email when an invoice is approved. Which layer owns that call?",
      ["The controller, right after it returns the response",
       "The repo, in the same transaction as the UPDATE",
       "The service — it emits an event, and a queue handler in <code>src/jobs/</code> does the sending",
       "The route file, as middleware"],
      2,
      "Business consequences belong to the service, but the service does not send the mail itself &mdash; it emits an event. Sending happens off the request thread in a job handler, so a slow or failing SMTP server cannot make an invoice approval time out. Putting it in the repo would tie mail delivery to a transaction that might roll back; putting it in the controller means it never happens when the same service is called from a job or the AI layer."),
  ].join("\n")));

  // ------------------------------------------------------------------ request life
  out.push(page("", F("THE LIFE OF A REQUEST"), [
    h1("The Life of a Request"),
    lead("This is the single most valuable page in Chapter 1. Follow one HTTP call from the socket to the database and back. Every stage here is real, in order, and readable in <code>src/server.js</code> and <code>src/routes/index.js</code>."),

    cmd(`# The request we are going to trace
POST https://acme.praxis.app/api/tenant/leads
Content-Type: application/json
Idempotency-Key: 6f1e-...
Cookie: session=...

{ "company_name": "Northwind Ltd", "contact_email": "ada@northwind.example" }`),

    h2("Stage by stage"),
    lete([
      ["01", "<b>helmet, compression, cors</b> &mdash; security headers, gzip, and the origin allowlist. The allowlist reflects any host on <code>APP_BASE_DOMAIN</code>, plus exact entries in <code>CORS_ORIGINS</code>, plus localhost in dev only."],
      ["02", "<b><code>requestIdMiddleware</code></b> &mdash; attaches a <code>request_id</code>. It appears in every log line, in the error envelope, and in the audit row. When a client reports a bug, this is the only string you need."],
      ["03", "<b><code>buildAccessLog()</code></b> &mdash; one structured line per request: who called what, with what outcome. Note that it is mounted <i>after</i> request-id, so the id is in the log."],
      ["04", "<b><code>express.json({ limit: \"2mb\" })</code></b> &mdash; body parsing, with a cap. A missing limit is a denial-of-service.."],
      ["05", "<b><code>apiVersionHeaders</code></b> then <b><code>apiLimiter</code></b> &mdash; version advertisement, then rate limiting backed by Redis so limits are shared across every API container, not per-process."],
      ["06", "<b><code>hostTenantResolver</code></b> &mdash; reads the <code>Host</code> header, finds the tenant. <code>acme.praxis.app</code> &rarr; tenant <code>acme</code>. Platform hosts (localhost, <code>api.*</code>, <code>admin.*</code>, the apex) deliberately set no tenant."],
      ["07", "<b><code>tenantContext</code></b> &mdash; picks live vs sandbox, binds the ambient request context, and exposes <code>req.tenantDb(fn)</code>: a <b>lazily acquired, once-per-request</b> pooled connection with the tenant's <code>search_path</code> already set."],
      ["08", "<b><code>idempotency</code></b> &mdash; mounted above the module loader so all ~700 tenant write endpoints get replay protection without opting in. No <code>Idempotency-Key</code> header means straight through, unchanged."],
      ["09", "<b><code>mountTenantModules</code></b> &mdash; the auto-discovered module router matches <code>/leads</code> and hands off to <code>sales/lead/lead.routes.js</code>."],
      ["10", "<b>Per-route chain</b> &mdash; <code>authMiddleware</code> &rarr; <code>requirePermission(MODULE, \"create\")</code> &rarr; <code>validator.create</code> &rarr; <code>controller.create</code>."],
      ["11", "<b>Controller &rarr; service &rarr; repo</b> &mdash; the controller unwraps HTTP, the service applies rules and emits events, the repo runs the only SQL in the building."],
      ["12", "<b>Response, or <code>errorHandler</code></b> &mdash; success returns the mutation envelope; any thrown error becomes <code>{ error: { code, message, fields }, request_id }</code> with the right status."],
    ]),

    callout("<strong>Read stage 06 and 07 again.</strong> Tenant isolation in this system is not a <code>WHERE tenant_id = ?</code> that a developer might forget. It is a Postgres <code>search_path</code> bound to a connection before your code runs. You physically cannot query another tenant's table from a request handler, because the schema those tables live in is not on your path.", "green"),
  ].join("\n")));

  // ------------------------------------------------------------------ tenancy
  out.push(page("", F("MULTI-TENANCY"), [
    h1("Multi-Tenancy, Concretely"),
    lead("&ldquo;Multi-tenant&rdquo; is the word that most often hides a security incident. Here is exactly what it means in this repo, with the three things that will bite you."),

    h2("The model", "schema-per-tenant"),
    stack([
      ["<b>One database</b>", "Postgres, with the <code>pgvector</code> extension for AI embeddings."],
      ["<b>One schema per tenant</b>", "Client Acme's tables live in schema <code>acme</code>; Northwind's in <code>northwind</code>. Same table names, same columns, different schema."],
      ["<b>A <code>platform</code> schema</b>", "JBS-owned data: the tenant registry, error events, feature flags. Not reachable from a tenant request."],
      ["<b>Sandbox schemas</b>", "A non-live tenant can carry a parallel sandbox schema, selected with the <code>X-Praxis-Env: sandbox</code> header, for training and demos (Chapter 13)."],
    ]),

    h2("The three things that will bite you"),
    cards([
      { name: "TRAP 1", role: "THE CONNECTION IS SHARED", color: "#EF4444", items: [
        "One request = one connection, on purpose",
        "Two <code>req.tenantDb</code> calls are NOT isolated from each other",
        "Never <code>Promise.all</code> over <code>req.tenantDb</code>",
      ]},
      { name: "TRAP 2", role: "THE WRONG HOST", color: "var(--accent-gold)", items: [
        "<code>localhost</code> is a <b>platform</b> host, not a tenant host",
        "Tenant calls from it get <code>400 WRONG_HOST</code>",
        "In dev, send <code>X-Praxis-Tenant: &lt;slug&gt;</code>",
      ]},
      { name: "TRAP 3", role: "IDENTIFIERS ARE NOT VALUES", color: "var(--fin)", items: [
        "A schema or column name can't be a bind parameter",
        "Use <code>ident()</code> from <code>shared/db/query-helpers.js</code>",
        "Chapter 4 covers the three-layer defence",
      ]},
    ], true),

    callout("<strong>The wrong-host trap is a teaching example in itself.</strong> It used to answer <code>500</code>. A misaddressed request is a <i>client</i> error, and answering 500 told the caller the server was broken when their <code>Host</code> header was. It now returns <code>400 WRONG_HOST</code> with a message that names the fix. Read the comment in <code>src/middleware/tenant-context.js</code> &mdash; this repo documents <i>why</i>, not <i>what</i>, and you are expected to write comments to that standard."),

    quiz("A colleague writes <code>await Promise.all([req.tenantDb(a), req.tenantDb(b)])</code> to speed up a handler. What happens?",
      ["It works and is twice as fast",
       "It fails at boot — a lint gate blocks it",
       "Both calls share one pg client, so they serialise anyway and can interleave in the same implicit transaction — a correctness hazard, not a speedup",
       "It opens two connections and exhausts the pool"],
      2,
      "Since PERF-S2 the request holds a single lazily-acquired client. <code>pg</code> serialises statements on one client, so there is no parallelism to win, and the two calls are no longer isolated from one another. The performance comment in <code>tenant-context.js</code> states that nothing in <code>src/</code> does this, and it must stay that way."),
  ].join("\n")));

  // ------------------------------------------------------------------ auto mount
  out.push(page("", F("AUTO-DISCOVERY"), [
    h1("Why Nobody Edits a Route Table"),
    lead("In most codebases, adding a feature means editing a central file that everyone else is also editing. Here, the router finds you. Understanding this one mechanism explains half the conventions in Chapter 3."),

    h2("What the loader does", "src/shared/http/module-loader.js"),
    lete([
      ["1", "Walks <code>src/modules/</code> looking for two layouts: <b>nested</b> <code>&lt;group&gt;/&lt;module&gt;/&lt;module&gt;.routes.js</code>, or <b>flat</b> <code>&lt;module&gt;/&lt;module&gt;.routes.js</code> for a standalone module."],
      ["2", "A directory that contains module subfolders is treated as a <b>group</b>, and its own <code>.routes.js</code> is ignored. <code>platform</code> is skipped entirely &mdash; it mounts separately, with its own auth."],
      ["3", "Folder names must match <code>^[a-z][a-z0-9_]*$</code>. <b>snake_case, always.</b> A folder named <code>myModule</code> is invisible to the loader &mdash; and this is the most common reason a new engineer's first route 404s."],
      ["4", "Each routes file must export <code>{ basePath, feature, router }</code>. The loader mounts <code>router</code> at <code>basePath</code>, wrapped in <code>requireFeature(feature)</code> when <code>feature</code> is non-null."],
      ["5", "A module whose <code>require()</code> throws is <b>skipped with a warning</b>, not fatal. One broken module cannot stop the server booting &mdash; which is why the wiring gates in <code>tests/security/</code> exist to catch what the warning would otherwise hide."],
    ]),

    cmd(`# The contract, from the bottom of every routes file
module.exports = { basePath: "/leads", feature: null, router };

# basePath  the URL under /api/tenant — here /api/tenant/leads
# feature   a feature-flag key, or null for always-on
# router    an express.Router()`),

    callout("<strong>&ldquo;Skipped with a warning&rdquo; is the single most dangerous behaviour in the loader,</strong> and the repo knows it. A module that fails to load produces a log line nobody reads, a route that 404s, and a green test suite. That is exactly the shape of the <b>&ldquo;declared, not called&rdquo;</b> family of defects catalogued in this codebase &mdash; and why <code>tests/security/orphan-wiring-sweep.test.js</code> exists to fail the build when a module stops mounting. <b>A warning is not a gate.</b>", "red"),

    ex("Predict the URL", "5 min",
      "<p>Given a routes file at <code>src/modules/procurement/purchase_order/purchase_order.routes.js</code> exporting <code>basePath: \"/purchase-orders\"</code>, write the full path a tenant browser would call, including the API prefix and version behaviour described on the request-life page.</p>",
      "e.g. https://acme.praxis.app/api/..."),

    quiz("You create <code>src/modules/sales/quoteItem/quoteItem.routes.js</code> and the route 404s. Why?",
      ["The file needs to be registered in <code>src/routes/index.js</code>",
       "The folder name is camelCase, so it fails the loader's <code>^[a-z][a-z0-9_]*$</code> test and is never discovered",
       "The server needs a restart",
       "<code>basePath</code> must match the folder name"],
      1,
      "The loader only descends into directories matching <code>^[a-z][a-z0-9_]*$</code>. <code>quoteItem</code> contains an uppercase letter, so it is silently invisible — no error, no warning, just a 404. Rename to <code>quote_item</code>. This is a five-minute bug that has cost people an afternoon."),
  ].join("\n")));

  // ------------------------------------------------------------------ where things live
  out.push(page("", F("THE FIELD GUIDE"), [
    h1("Where To Look: A Field Guide"),
    lead("You will spend more of this month reading than writing. This page is the lookup table &mdash; when you have a question of a given shape, go to the file named here first. Fold the corner of this page."),

    table("mst", ["When you are asking&hellip;", "Open this", "Why"], [
      ["&ldquo;How should a module be laid out?&rdquo;", "<code>doc/CONVENTIONS.md</code>", "The mandatory layout, the layer rules, and the steps to add an AI action."],
      ["&ldquo;What does a good module look like?&rdquo;", "<code>src/modules/sales/lead/</code>", "The canonical 8-file example. Chapter 3 dissects it line by line."],
      ["&ldquo;How do I query safely?&rdquo;", "<code>src/shared/db/query-helpers.js</code>", "<code>ident()</code>, <code>assertWritable()</code>, <code>insertOne</code>, <code>updateOne</code>, <code>page</code>."],
      ["&ldquo;Who owns the transaction?&rdquo;", "<code>src/shared/db/tx.js</code>", "<code>atomically()</code> — one owner, depth counter, SAVEPOINT probe."],
      ["&ldquo;How do I emit an event or audit?&rdquo;", "<code>src/shared/events/emit.js</code>", "<code>emitEvent</code> + <code>audit</code>, and the Watch-the-Watcher fan-out."],
      ["&ldquo;What error should I throw?&rdquo;", "<code>doc/ERROR_HANDLING.md</code>", "The silent-catch taxonomy A&ndash;G and the mutation envelope."],
      ["&ldquo;Does this error code exist?&rdquo;", "<code>doc/ERROR_CODES.md</code>", "<b>Generated.</b> Never edit it by hand — run <code>scripts/generate-api-docs.js</code>."],
      ["&ldquo;What is the API surface?&rdquo;", "<code>doc/API_REFERENCE.md</code>", "Also generated, and gated in CI for drift."],
      ["&ldquo;How do I build a screen?&rdquo;", "<code>doc/FRONTEND_GUIDE.md</code>", "<code>&lt;ListPage&gt;</code>, <code>useZodForm</code>, the paved road. Chapter 7."],
      ["&ldquo;What runs in CI?&rdquo;", "<code>scripts/ci-local.js</code>", "The authoritative list of all 33 gates, in order."],
      ["&ldquo;It's broken in production.&rdquo;", "<code>doc/INCIDENT_RUNBOOK.md</code>", "SEV-1 to SEV-4, with actions. Chapter 11."],
      ["&ldquo;We're onboarding a client.&rdquo;", "<code>doc/TENANT_ONBOARDING_CHECKLIST.md</code>", "The go-live sequence. Chapter 13."],
    ]),

    callout("<strong>Two of those files are generated.</strong> <code>ERROR_CODES.md</code> and <code>API_REFERENCE.md</code> are produced by <code>scripts/generate-api-docs.js</code> and checked for drift by a CI gate. If you hand-edit them, CI fails &mdash; correctly. Documentation that can drift from the code silently is worse than none, because people trust it.", "gold"),
  ].join("\n")));

  // ------------------------------------------------------------------ lab
  out.push(page("", F("LAB 1 &mdash; THE GUIDED TOUR"), [
    band("L1", "Lab &mdash; The Guided Tour", "WEEK 1 &middot; <b>HANDS ON</b> &middot; ~45 MIN &middot; READ-ONLY", "lab"),
    lead("No code changes. You are learning to navigate. Run each command, read the output, and fill in the answers. Do not skip the answer boxes &mdash; writing the answer is what moves it from your screen into your head."),

    h2("Step 1 &mdash; Count the ground"),
    cmd(`# From the repo root
find src -name "*.js" | wc -l
ls src/modules | wc -l
ls src/modules
find src/modules -name "*.routes.js" | wc -l`),
    ex("What are the 26 module groups?", "10 min",
      "<p>Run the commands above. Then open <code>doc/CONVENTIONS.md</code> and find the list of module groups it documents. <b>Compare the two.</b> Write down the number in the doc, the number on disk, and one sentence on what that difference tells you about documentation in a living codebase.</p>",
      "Doc says … , disk has … , which means …"),

    callout("<strong>That mismatch is deliberate teaching material, not a trick.</strong> <code>CONVENTIONS.md</code> describes 13 groups; there are 26 directories. The doc was true when written. This is documentation drift in its natural habitat &mdash; and it is precisely why the API reference and error codes are <i>generated</i> rather than typed. Anything a human maintains by hand will eventually lie. Design so the important things cannot.", "gold"),

    h2("Step 2 &mdash; Trace one real route"),
    cmd(`# Read the whole chain for the canonical module, in order
cat src/modules/sales/lead/lead.routes.js
cat src/modules/sales/lead/lead.validator.js
cat src/modules/sales/lead/lead.controller.js
cat src/modules/sales/lead/lead.service.js
cat src/modules/sales/lead/lead.repo.js`),
    ex("Follow POST /leads", "15 min",
      "<p>Using only those five files, list in order every function that runs when <code>POST /api/tenant/leads</code> is called, from the first middleware in the routes file to the SQL statement. You should end up with roughly eight entries. Do not worry about the shared helpers yet.</p>",
      "1. authMiddleware  2. …"),

    h2("Step 3 &mdash; Find the guard rails"),
    cmd(`# The gates that stop a module from quietly disappearing
ls tests/security/
node -e "console.log(require('./src/shared/db/query-helpers.js'))" 2>/dev/null | head`),
    ex("Name three defects the security tests prevent", "10 min",
      "<p>Read the filenames in <code>tests/security/</code> and open any two. In your own words, name three distinct kinds of mistake these tests exist to catch. For each, say why a normal unit test would <i>not</i> have caught it.</p>",
      "1. … — a unit test wouldn't catch it because …"),
  ].join("\n")));

  // ------------------------------------------------------------------ gate-ish close
  out.push(page("", F("CHAPTER 1 CHECKPOINT"), [
    h1("Chapter 1 Checkpoint"),
    lead("Tick each item honestly. These are not knowledge questions; they are &ldquo;can you do it without looking&rdquo; questions. Anything unticked is a page to reread, not a failure."),

    rgroup("1.1", "Orientation", [
      "I can name the five layers and say which direction calls flow.",
      "I can state the difference between the <b>platform</b> API and the <b>tenant</b> API.",
      "I know why a controller must never contain SQL.",
      "I can explain schema-per-tenant to a non-engineer in two sentences.",
    ]),

    rgroup("1.2", "Navigation", [
      "I can find the canonical module example without searching.",
      "I know which two docs are generated and must not be edited.",
      "I know where the authoritative list of CI gates lives.",
      "I can find the incident runbook and the tenant onboarding checklist.",
    ]),

    rgroup("1.3", "The request", [
      "I can list the middleware chain in order, from CORS to the controller.",
      "I can explain what <code>req.tenantDb</code> gives me and what it costs.",
      "I know why <code>Promise.all</code> over <code>req.tenantDb</code> is wrong.",
      "I know what happens when a module fails to <code>require()</code>, and why that is dangerous.",
    ]),

    rgroup("1.4", "Written work", [
      "Lab 1 Step 1 answered &mdash; the group-count mismatch.",
      "Lab 1 Step 2 answered &mdash; the eight-step trace.",
      "Lab 1 Step 3 answered &mdash; three defects and why unit tests miss them.",
    ]),

    dod(["Read the map", "Traced a request", "Found the guard rails", "Answers written"]),

    callout("<strong>Next:</strong> Chapter 2 puts the whole stack on your machine &mdash; Postgres with pgvector, Redis, pgbouncer, the migrator, the API and the worker &mdash; and you will run the test suite for the first time. Bring the terminal.", "green"),
  ].join("\n")));

  return out;
}
