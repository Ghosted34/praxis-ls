/**
 * FINAL EXAMINATION BANK
 *
 * Forty questions spanning all thirteen chapters. These are DISTINCT from the
 * in-chapter self-checks: those are formative (answer, get told immediately,
 * learn). These are summative, and every one of them is answerable only by
 * someone who actually read the codebase — there are no questions here that a
 * competent engineer could guess from general industry knowledge alone.
 *
 * Each question carries the chapter it examines so the result screen can tell a
 * learner WHERE to go back to, rather than just how badly they did.
 *
 * `a` is the index of the correct option. `why` is shown on review for wrong
 * answers only — getting it right does not need an explanation, and showing
 * every explanation makes the review screen unreadable.
 */

export const EXAM = [
  // ---- Ch 1: shape of the system ----
  { ch: 1, q: "A request arrives at <code>localhost:3000/api/tenant/sales/lead</code> in local development and returns <code>400 WRONG_HOST</code>. What is happening?",
    o: ["The lead module failed to load", "<code>localhost</code> resolves as a platform host, and platform hosts may not serve tenant routes", "The route is missing from the router", "Authentication failed before routing"],
    a: 1, why: "Host resolution decides whether you are on the platform or a tenant. <code>localhost</code> is a platform host, so tenant routes are correctly refused. In development you pass the tenant explicitly with a header." },
  { ch: 1, q: "The system has 131 modules across 26 groups. Why is that easier to work in than a 12-module system, according to the architecture's own bet?",
    o: ["Because more modules means smaller files", "Because the module loader caches them", "Because every module has the same shape, so knowing one means knowing all of them", "Because modules can be deployed independently"],
    a: 2, why: "The bet is <b>relentless sameness</b>. Uniform structure is what makes scale navigable; 131 identical shapes are easier than 12 bespoke ones." },
  { ch: 1, q: "What does the <code>X-Praxis-Env: sandbox</code> header select?",
    o: ["A logging verbosity level", "A parallel sandbox schema for a non-live tenant, used for training and demos", "The staging deployment", "A read-only replica"],
    a: 1, why: "A non-live tenant can carry a parallel sandbox schema alongside its live one. This is what makes client training possible without touching real data." },

  // ---- Ch 2: environment ----
  { ch: 2, q: "Why does the readiness endpoint exist separately from the liveness endpoint?",
    o: ["Readiness is faster to call", "Liveness proves the process is up with no dependencies; readiness actually probes Postgres, Redis and module loading and can return 503", "They are the same thing behind two URLs", "Readiness is for humans, liveness for machines"],
    a: 1, why: "Liveness cannot fail — it touches nothing. Readiness probes real dependencies. <code>deploy.sh</code> gates on readiness, which is the entire reason there are two." },
  { ch: 2, q: "The lint gate is pinned at <code>--max-warnings 136</code> rather than 0. What is this pattern called and why is it used?",
    o: ["A ratchet — zero would fail today, unlimited permits decay, so pinning the current count blocks new warnings and every cleanup lowers it", "A budget, set by the team lead each sprint", "A grace period until the next release", "A limitation of ESLint's configuration"],
    a: 0, why: "A ratchet improves a large codebase without stopping to fix everything first. Any new warning fails the build; every cleanup PR lowers the number. Coverage uses the same pattern." },
  { ch: 2, q: "Why is the Postgres image in <code>docker-compose.yml</code> the pgvector build rather than stock Postgres 16?",
    o: ["It is faster for ordinary queries", "It ships better default configuration", "AI embeddings require the vector extension — it is load-bearing, not optional", "It is the only image with a healthcheck"],
    a: 2, why: "The vector extension backs the embedding storage used by the AI layer. Substituting stock Postgres breaks the AI features at query time, not at boot." },

  // ---- Ch 3: reading a module ----
  { ch: 3, q: "<code>lead.ai.js</code> hands <code>validator.schemas.aiTransition</code> to the action registry. Why does it reuse the HTTP schema instead of defining its own?",
    o: ["To save lines of code", "So the copilot's input is validated by the same Zod object as the HTTP path — one definition, two front doors", "Because the registry cannot accept custom schemas", "To make the AI responses faster"],
    a: 1, why: "One definition, two front doors. A parallel schema would be a second thing to remember to update, and the AI path would silently drift from the HTTP path." },
  { ch: 3, q: "<code>lead.repo.js</code> contains a function <code>clientTypeIdByCode</code>. What historical bug does its existence record?",
    o: ["A performance problem with repeated joins", "Passing the type code where an id was expected raised 42703 in production, while the unit test mocked the boundary and passed", "A race condition on concurrent conversions", "A missing foreign key constraint"],
    a: 1, why: "The mock certified broken code as working. This is the canonical example of why <code>check-query-columns</code> exists — a gate reads the SQL and verifies columns against the real schema." },
  { ch: 3, q: "In an AI action definition, what is the <code>describe</code> field actually for?",
    o: ["Developer documentation in the source file", "The natural-language text the model reads when choosing a tool — prompt engineering inside the codebase", "The tooltip shown in the UI", "The audit log entry"],
    a: 1, why: "The model reads <code>describe</code> to decide whether to call the action. Writing it badly is a prompt-engineering defect that manifests as the model picking the wrong tool." },
  { ch: 3, q: "The AI surface is described as 'a manifest over capabilities that already exist'. What safety property follows from that?",
    o: ["The AI runs in a separate process", "AI calls are rate-limited", "AI actions reuse existing services, schemas and permissions, so they cannot exceed what the app already allows", "AI output is always reviewed by a human"],
    a: 2, why: "Because the AI layer is a manifest rather than a parallel implementation, every permission and validation already enforced on the HTTP path applies unchanged. Safety is inherited, not re-implemented." },

  // ---- Ch 4: data & migrations ----
  { ch: 4, q: "<code>query-helpers.js</code> uses <code>assertWritable</code>, which rejects unknown columns rather than silently dropping them. Why is rejecting the safer behaviour?",
    o: ["It is faster than filtering", "Silently dropping means a caller believes a field was saved when it was not", "Dropping breaks the ORM cache", "Rejecting produces better logs"],
    a: 1, why: "Silent dropping turns a mass-assignment defence into a data-loss bug. The caller gets a 200 and a false belief. Rejecting makes the disagreement visible immediately." },
  { ch: 4, q: "Migrations are additive by convention. Which deploy step depends on that convention?",
    o: ["The database backup", "Building the images", "Restarting the standby API before the primary — old code runs against the new schema for a few seconds", "Pruning old images"],
    a: 2, why: "During the rolling restart, old code and new schema coexist. A migration that drops a column turns that window into an outage. Every migration is implicitly a promise about the deploy window." },
  { ch: 4, q: "The house migration style requires a commented <code>-- DOWN</code> section stating exactly what is lost. Why commented rather than executable?",
    o: ["Executable down-migrations are not supported by the tool", "It documents the reversal cost honestly without pretending automatic rollback is safe for data", "It runs faster", "To satisfy the linter"],
    a: 1, why: "An executable down-migration invites someone to run it under pressure and lose data. Writing down precisely what would be lost forces the decision to be conscious." },
  { ch: 4, q: "What does <code>tx.js</code>'s SAVEPOINT probe (error code 25P01) make safe?",
    o: ["Concurrent writes to the same row", "Nesting a transaction inside one of the 76 pre-existing raw BEGIN sites without double-beginning", "Rolling back across connections", "Long-running read queries"],
    a: 1, why: "The probe detects whether a transaction is already open, so the helper can use a SAVEPOINT instead of a second BEGIN. One owner of the boundary, coexisting with legacy call sites." },

  // ---- Ch 5: building ----
  { ch: 5, q: "A new module needs to be reachable over HTTP. What must you edit to register its routes?",
    o: ["A central route manifest", "<code>src/server.js</code>", "Nothing — the loader discovers modules by directory convention", "The nginx configuration"],
    a: 2, why: "The router finds you. Discovery by convention is what allows 131 modules without a contended central file — and it is why the directory layout is not negotiable." },
  { ch: 5, q: "The canonical module has eight files. What is the repo layer forbidden from containing?",
    o: ["Raw SQL", "Business rules and permission decisions — those belong in the service", "Parameter binding", "Column allow-lists"],
    a: 1, why: "The repo owns SQL and nothing else. Business rules in the repo cannot be tested or reused by the AI path, and they get duplicated the moment a second caller appears." },

  // ---- Ch 6: testing & QA ----
  { ch: 6, q: "Coverage shows lines at 40.68% but functions at 13.12%, and 99 route files sit at 100% statements with 0% functions. What does that pattern mean?",
    o: ["The coverage tool is misconfigured", "Route files are imported (so their top-level statements run) but their handlers are never invoked", "Routes are tested through integration tests only", "Statement coverage is always higher than function coverage"],
    a: 1, why: "Importing a route file executes its definitions — that is the statements. Nothing ever calls the handlers, so function coverage stays at zero. High statement coverage can mean almost nothing was tested." },
  { ch: 6, q: "Why is there deliberately no <code>branches</code> floor in the coverage configuration?",
    o: ["Branch coverage is not measurable in Jest", "A floor nobody can meet gets ignored or gamed; the ratchet only works if the number is honest", "Branches are covered by the linter", "It slows the test run"],
    a: 1, why: "A ratchet depends on the number being real and improvable. An aspirational floor that always fails trains the team to bypass the gate." },
  { ch: 6, q: "A mock is described as 'an assumption about a boundary, written down'. What is the failure mode when the assumption is wrong?",
    o: ["The test fails for the wrong reason", "The test actively certifies broken code as working", "The test becomes slow", "The mock leaks between test files"],
    a: 1, why: "It does not merely fail to catch the bug — it produces a green tick over broken code. That is worse than having no test, because it stops anyone from looking." },

  // ---- Ch 7: front end ----
  { ch: 7, q: "The 'frontend guide is not lying' CI gate exists because of which incident?",
    o: ["A designer changed the palette without telling anyone", "The guide referenced <code>crud-resource.tsx</code>, which had been deleted, and 24 areas diverged following stale instructions", "The build output exceeded the bundle budget", "Two teams shipped conflicting components"],
    a: 1, why: "Documentation pointed at a component that no longer existed, so everyone improvised differently. The gate makes the guide executable: if it describes something that is not there, CI fails." },
  { ch: 7, q: "What is the purpose of the raw-palette gate?",
    o: ["To limit the number of colours", "To forbid hardcoded colour values so every colour comes from a design token", "To enforce WCAG contrast", "To reduce CSS bundle size"],
    a: 1, why: "Raw hex values cannot be re-themed per tenant and cannot be contrast-audited. The token layer is what makes both possible; the gate stops the layer being bypassed." },
  { ch: 7, q: "<code>outbox.ts</code> exists because of which distinction?",
    o: ["Offline versus online", "A rejected fetch does not mean the request never arrived — so retrying can duplicate the write", "Optimistic versus pessimistic UI", "Client-side versus server-side validation"],
    a: 1, why: "A network failure is ambiguous: the server may have processed it. That ambiguity is resolved with <code>Idempotency-Key</code> and the idempotency middleware, so a retry is safe." },

  // ---- Ch 8: jobs, queues, events ----
  { ch: 8, q: "<code>workers.js</code> was once a zero-byte file. What was the observable symptom?",
    o: ["The API crashed on boot", "Jobs were enqueued successfully and never processed", "Redis ran out of memory immediately", "Cron jobs ran twice"],
    a: 1, why: "The producer worked perfectly, so nothing errored. Jobs accumulated in a queue with no consumer — the most dangerous kind of failure, because every signal says success." },
  { ch: 8, q: "<code>corn-lock.js</code> (the typo'd stray) imported <code>config/database</code>, whose <code>initDatabase()</code> is never called. What happened?",
    o: ["The import failed and was caught", "Every cron threw on its first line at runtime", "The lock was acquired but never released", "Cron jobs silently no-opped"],
    a: 1, why: "The require succeeded; the pool was simply never initialised, so the query function threw when called. A try/catch around an import does not protect you from the module being wrong." },
  { ch: 8, q: "<code>emit.js</code> writes to two places. What is the difference between them?",
    o: ["One is synchronous, the other asynchronous", "<code>emitEvent</code> writes <code>event_log</code>; <code>audit</code> writes the immutable ledger retained ten years", "One is per-tenant, the other global", "One is for errors, the other for successes"],
    a: 1, why: "Events drive fan-out and are operational. Audit entries are an immutable legal record with a ten-year retention. Conflating them means either losing evidence or drowning in noise." },
  { ch: 8, q: "Why is queue concurrency justified per queue (pdf 2, email 3, fx-sync 1) rather than set globally?",
    o: ["BullMQ requires it", "Each queue has a different bottleneck — CPU, remote rate limits, or a resource that must not run concurrently at all", "To make the config file self-documenting", "To spread load evenly"],
    a: 1, why: "PDF rendering is CPU-bound, email is bounded by the relay, and fx-sync must not overlap with itself. One global number would be wrong for all three." },

  // ---- Ch 9: LLM integration ----
  { ch: 9, q: "<code>action-authz.js</code> stored <code>required_permission</code> and selected it in queries, but never compared it. What is the one-line lesson?",
    o: ["Always write integration tests", "Recording is not preventing", "Permissions belong in middleware", "Never trust the AI layer"],
    a: 1, why: "The data was present, the query fetched it, the audit trail looked complete — and ten write actions were open to anyone. Storing a control is not enforcing it." },
  { ch: 9, q: "Missing AI vendor keys cause what behaviour?",
    o: ["The process refuses to boot", "The affected feature degrades and reports a reason; the system runs", "Requests queue until keys are supplied", "The system falls back to a local model"],
    a: 1, why: "Degrade, do not crash. The same rule governs SMTP and push: an unconfigured integration must never be able to take down a deployment or fail a business transaction." },

  // ---- Ch 10: notifications ----
  { ch: 10, q: "Which notification category cannot be silenced on any channel, and why?",
    o: ["<code>finance</code> — regulatory requirements", "<code>system</code> — it carries outage notices", "<code>security</code> — an attacker holding the account must not be able to turn off the breach alert", "<code>approvals</code> — workflows would stall"],
    a: 2, why: "Security is the only category flagged <code>security: true</code>. Its entire value depends on the person who might switch it off being unable to." },
  { ch: 10, q: "The default for the EMAIL channel is OFF while IN_APP is ON. What is the reasoning?",
    o: ["Email costs money to send", "In-app waits until the user looks; email arrives somewhere they did not choose to open, and defaulting to it trains people to filter it", "Email is less reliable", "GDPR requires it"],
    a: 1, why: "The default encodes respect for attention. In-app is passive and costless; email is an interruption in a space the user did not open for you." },
  { ch: 10, q: "The notification fan-out loop issued ~250 sequential queries inside an open write transaction. Why was the transaction the real problem?",
    o: ["Transactions add per-query overhead", "It pinned one of eight pooled connections and held a row lock for the whole fan-out, degrading every other user touching that row", "Postgres limits statements per transaction", "It prevented the queries from being batched"],
    a: 1, why: "A slow read is a slow read. A slow read inside a write transaction is a lock-duration bug: the blast radius is everyone touching that row, not just the triggering user." },
  { ch: 10, q: "The SMTP probe calls <code>transport.verify()</code>. What does a green result NOT prove?",
    o: ["That the host resolves", "That credentials authenticate", "That mail will arrive, survive SPF/DKIM, or stay out of spam", "That the port is correct"],
    a: 2, why: "<code>verify()</code> does connect, EHLO and AUTH, then stops. Deliverability is untested, which is why the real-send probe explicitly tells you to check the spam folder." },
  { ch: 10, q: "What happens to every existing push subscription if the deployment's VAPID keypair is rotated?",
    o: ["They migrate automatically", "They keep working — VAPID identifies the server, not the subscription", "They silently stop receiving push and every user must re-subscribe", "They error visibly on the next send, prompting a re-subscribe"],
    a: 2, why: "Subscriptions are bound to the public key they were created with. The push service simply rejects the new signature — no bounce, no error the user can see. Treat the keypair as permanent infrastructure." },
  { ch: 10, q: "<code>sendToUser</code> deletes a subscription on HTTP 404 or 410 but only logs other errors. Why the distinction?",
    o: ["404 and 410 are the only errors web-push returns", "404/410 mean permanently gone; anything else may be transient, and a network blip must not cost a user their subscription", "Deleting on any error would be faster", "Other errors are retried automatically"],
    a: 1, why: "Gone means gone — uninstalled, cleared, retired — so prune it or the table grows forever. Transient failures must not be treated as permanent." },

  // ---- Ch 11: CI, deploy, rollback ----
  { ch: 11, q: "A past deploy failure was caused by <code>docker image prune -f</code>. What did it break?",
    o: ["The build cache, slowing deploys", "It destroyed the previous image — the exact artefact rollback depends on", "It removed the database volume", "It broke the health check"],
    a: 1, why: "Rollback needs the old image to still exist. Pruning inside the deploy destroyed the thing that makes recovery possible, and it was only discovered when recovery was needed." },
  { ch: 11, q: "<code>/api/health</code> once returned <code>{ok:true}</code> unconditionally while <code>deploy.sh</code> used it as the success gate. What is the general principle?",
    o: ["Health checks should be authenticated", "A check that cannot fail is not a check", "Deploys should not be automated", "Health checks belong in the load balancer"],
    a: 1, why: "The gate guarding the most consequential moment could not report failure. Worse than no check, because it stops people looking." },
  { ch: 11, q: "<code>rollback.sh</code> is described as code-only. What is the open risk?",
    o: ["It cannot roll back the frontend", "It reverts application code but not the database, so a migration's effects survive the rollback", "It requires manual approval", "It only works on the primary"],
    a: 1, why: "Migrations have no down path by convention. Rolling code back under a migrated schema is a different state from either release — which is exactly why the pre-migration backup is step 2." },

  // ---- Ch 12: prompting ----
  { ch: 12, q: "Research cited in the workbook found that LLM-generated <code>AGENTS.md</code> files reduced task success in 5 of 8 settings. What is the recommendation?",
    o: ["Do not use AGENTS.md", "Generate it and then edit it heavily", "Write it by hand and keep it short — under about 150 lines", "Regenerate it every sprint"],
    a: 2, why: "Generated files pad out what the model could already infer, diluting the instructions that matter. Hand-written, short, command-led, with file-scoped checks." },
  { ch: 12, q: "What is the core structural difference between Claude Code and Jules?",
    o: ["One is free, the other paid", "Claude Code is synchronous and locally steerable throughout; Jules is asynchronous with plan approval up front and limited steering after", "Claude Code cannot open pull requests", "Jules does not read repository context"],
    a: 1, why: "Synchronous means you can correct mid-flight. Asynchronous means the plan is your main lever, so it must be right before you approve — Jules will auto-approve on a timer if you wander off." },
  { ch: 12, q: "Why must <code>CLAUDE.md</code> stay under roughly 200 lines?",
    o: ["A hard file-size limit", "It is loaded every session; a bloated file causes rules to be ignored", "Longer files slow down responses", "Only the first 200 lines are parsed"],
    a: 1, why: "Every line competes for attention with every other. Include only what the model cannot infer from the code itself." },

  // ---- Ch 13: shipping to a client ----
  { ch: 13, q: "In sandbox (TEST) mode, what happens to outbound email, PDFs and AI calls?",
    o: ["They are disabled entirely", "Email is SUPPRESSED, PDFs are watermarked TEST SANDBOX, AI is mocked", "They run normally but are logged", "They require a confirmation click"],
    a: 1, why: "Training must be safe and obviously distinguishable. Suppression prevents real mail to real clients; the watermark stops a training PDF being mistaken for a real document." },
  { ch: 13, q: "Sandbox seed data is inserted with direct SQL rather than through the services. Why?",
    o: ["It is faster", "So it does not post to the general ledger", "The services are unavailable in sandbox", "To bypass validation"],
    a: 1, why: "Going through the services would generate real accounting entries. Training data must exist without becoming financial fact." },
  { ch: 13, q: "What is the stated goal of the client go-live process?",
    o: ["A one-day onboarding", "Zero downtime", "That the next tenant needs only keys and brand assets — no code changes and no redeploy", "Full automation with no human steps"],
    a: 2, why: "Every step is a click or a curl against runtime configuration. If onboarding a client requires a code change, the configuration surface is incomplete." },
];

/** Number drawn for any single sitting. */
export const EXAM_DRAW = 20;
/** Percentage required to pass. */
export const PASS_MARK = 80;
