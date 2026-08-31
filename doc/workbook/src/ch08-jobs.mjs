import {
  page, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
  setChapter,
} from "./kit.mjs";

const F = (s) => `CHAPTER 8 &mdash; JOBS, QUEUES &amp; EVENTS &nbsp;&middot;&nbsp; ${s}`;

export function chapter() {
  setChapter(8);
  const out = [];

  out.push(page("", F("WORK THAT OUTLIVES THE REQUEST"), [
    band("08", "Jobs, Queues &amp; Events", "WEEK 3 &middot; <b>TEACH + LAB</b> &middot; ~5 HOURS"),
    lead("Rendering a PDF, sending an email, syncing FX rates, sweeping overdue records &mdash; none of these belong inside a request. This chapter covers the second runtime: a separate container, BullMQ over Redis, and 44 handlers. It also contains the two best failure stories in the entire codebase."),

    h2("Two processes, one image"),
    table("mst", ["", "API", "Worker"], [
      ["Command", "<code>node src/server.js</code>", "<code>node src/jobs/workers.js</code>"],
      ["Docker stage", "<code>runtime</code>", "<code>worker</code>"],
      ["Consumes", "HTTP requests", "BullMQ queues on Redis"],
      ["Has <code>req</code>?", "Yes", "<b>No</b> &mdash; and this is the source of most job bugs"],
      ["Scaling", "Horizontal, behind the proxy", "Horizontal &mdash; <b>which is why cron needs a lock</b>"],
    ]),

    h2("The producer side"),
    cmd(`async function enqueue(name, jobName, data, opts = {}) {
  return getProducer(name).add(jobName, data, {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    ...opts,
  });
}`),
    lete([
      ["<code>attempts: 3</code>", "Three tries, then the job is failed. <b>Which means every handler must be idempotent</b> &mdash; attempt 2 may follow a partial attempt 1."],
      ["<code>backoff</code>", "Exponential from 5s. A downstream service that is down stays down for a few seconds; hammering it immediately makes recovery slower."],
      ["<code>removeOnFail: 5000</code>", "Failures are kept <b>five times longer</b> than successes. Successes are noise; failures are the evidence you need at 2am."],
      ["Lazy producers", "Queues are created on first use and cached, sharing the app's Redis connection. No connection storm at boot."],
    ]),

    callout("<strong><code>attempts: 3</code> is a contract with every handler you will ever write.</strong> If your job sends an email and then updates a row, and it crashes between the two, attempt 2 sends a second email. Retries are not free reliability &mdash; they are a requirement placed on your code. Design the handler so that running it twice is indistinguishable from running it once.", "gold"),
  ].join("\n")));

  // ---------------------------------------------------------- corn-lock
  out.push(page("", F("THE LOCK THAT NEVER LOCKED"), [
    h1("NEW-04: A Perfect Design That Never Ran"),
    lead("Open <code>src/jobs/corn-lock.js</code>. Note the filename &mdash; we will come back to it. Read the comment at line 30. It is the most important thing in this chapter."),

    h2("What the module is for"),
    val("node-cron fires wherever a worker process runs. With two worker instances &mdash; or <code>ENABLE_WORKERS=true</code> on the API next to a dedicated worker &mdash; <strong>every cron would run twice: double email sends, double reminders, double billing.</strong> <code>withCronLock(name, fn)</code> makes each named job single-flight across all processes sharing the database."),

    h2("And the design is genuinely good"),
    bl([
      "<code>pg_try_advisory_lock(hashtext(key))</code> &mdash; <b>non-blocking</b>, so a losing instance skips rather than queueing up a second run for later.",
      "<b>Session-scoped, not transaction-scoped</b>, so <code>fn</code> is not wrapped in a long-lived transaction and jobs open their own transactions freely on other connections.",
      "<b>Crash-safe</b>: if the process dies mid-job, the connection drops and Postgres releases the lock automatically.",
      "If the unlock fails on a broken connection, <b>the client is destroyed rather than returned to the pool</b>, so a stale lock can never ride a recycled connection.",
    ]),

    h2("Now the comment"),
    val("<strong>&ldquo;This used to import <code>config/database</code>, whose <code>initDatabase()</code> IS NEVER CALLED ANYWHERE IN <code>src/</code> &mdash; proven: <code>getPool()</code> throws &lsquo;db pool not initialised&rsquo;. So EVERY cron job wrapped in <code>withCronLock</code> threw on its first line, and because jobs swallow their own errors <b>that failure was invisible</b>. The module read as working code with a sensible advisory-lock design and <b>had never once acquired a lock</b>.&rdquo;</strong>"),

    callout("<strong>Sit with that.</strong> Every element was right: the algorithm, the crash-safety, the pool hygiene, the documentation. It imported the wrong module. It threw on its first line, on every tick, since the day it was written &mdash; and the error was swallowed by the very jobs it was protecting. <b>Nobody was wrong, and nothing worked.</b>", "red"),

    h2("Three lessons, and they compound"),
    lete([
      ["1", "<b>Silent catches turn a crash into a lie.</b> The jobs swallowed their own errors, so a total failure looked identical to a successful no-op. This is why &ldquo;no new silent catches&rdquo; is one of the 33 gates."],
      ["2", "<b>Dead initialisation is invisible.</b> <code>initDatabase()</code> existed, looked essential, and was called by nothing. This is the &ldquo;declared, not called&rdquo; family again &mdash; the sixth shape."],
      ["3", "<b>Code review cannot catch this.</b> Every line is correct in isolation; the defect is in a relationship <i>between</i> files. Only running it &mdash; or a test that asserts the lock is actually acquired &mdash; finds it."],
    ]),

    h2("And the filename"),
    cmd(`src/jobs/corn-lock.js    # the real implementation — note the typo
src/jobs/cron-lock.js    # "Alias for corn-lock.js so both imports resolve."`),
    val("Someone typed <code>corn</code>. Rather than a rename that would break unknown importers, an alias module was added so both spellings resolve. <strong>Pragmatic, honest, and documented.</strong> It is also a small ongoing tax, and a reminder that a typo in a filename outlives everyone's memory of it. When you notice one on day one, say so &mdash; that is the cheapest moment it will ever be."),

    quiz("What test would have caught NEW-04 on the day it shipped?",
      ["A unit test of withCronLock with a mocked pool",
       "An integration test that calls withCronLock against a real database and asserts the function actually ran and the lock was held",
       "A lint rule about import paths",
       "Higher code coverage"],
      1,
      "A mocked pool is precisely how the bug survives &mdash; the mock supplies the pool the real code could not get. The assertion has to be behavioural and against reality: did <code>fn</code> run, was the lock genuinely acquired, and does a second concurrent caller skip? This is the mock lesson from Chapter 6 in its most expensive form."),
  ].join("\n")));

  // ---------------------------------------------------------- workers
  out.push(page("", F("THE WORKER REGISTRY"), [
    h1("<code>workers.js</code> &mdash; And The 0-Byte Stub"),
    lead("The second story. The producer side worked perfectly. Any process could enqueue a durable job. It was reliable, retried, and backed off politely."),

    val("<strong>&ldquo;It was a 0-byte stub &mdash; any job enqueued would have sat in Redis forever with nothing to process it.&rdquo;</strong>"),

    callout("<strong>Half a system is not half as useful; it is zero useful, and it looks fine.</strong> The enqueue call returns a job id. No error surfaces anywhere. The queue depth climbs in a Redis nobody is watching. This is the same shape as NEW-04 and the same shape as the mail double-stringify: <b>the failure is silent because the missing half is the half that would have complained</b>.", "red"),

    h2("The registry today"),
    cmd(`const PROCESSORS = [
  { name: "regie-aging",              concurrency: 1, handler: require("./handlers/regie-aging") },
  { name: "regie-aging-scheduler",    concurrency: 1, handler: require("./handlers/regie-aging-scheduler") },
  { name: "pdf",                      concurrency: 2, handler: require("./handlers/pdf-render") },
  { name: "email",                    concurrency: 3, handler: require("./handlers/email-send") },
  { name: "fx-sync",                  concurrency: 1, handler: require("./handlers/fx-sync") },
  { name: "fx-sync-scheduler",        concurrency: 1, handler: require("./handlers/fx-sync-scheduler") },
  { name: "ai-transcribe",            concurrency: 2, handler: require("./handlers/ai-transcribe") },
  { name: "scheduled-report",         concurrency: 1, handler: require("./handlers/scheduled-report") },
  { name: "scheduled-report-scheduler", concurrency: 1, handler: require("./handlers/scheduled-report-scheduler") },
  /* … 44 handler files in total … */
];`),

    h2("Read the pairing"),
    bl([
      "<code>fx-sync</code> and <code>fx-sync-scheduler</code>. <code>regie-aging</code> and <code>regie-aging-scheduler</code>. <code>scheduled-report</code> and <code>scheduled-report-scheduler</code>.",
      "<b>A worker without a scheduler is a job nobody starts.</b> The comment on <code>scheduled-report-scheduler</code> says it outright: the worker &ldquo;was registered from the day reports shipped and enqueued by nothing &mdash; its own header deferred the trigger to &lsquo;an app scheduled-task or external cron&rsquo;, <b>which was never part of the repo</b>, so a scheduled report only ran if somebody POSTed the route.&rdquo;",
      "When you add a background job, <b>ask immediately: what enqueues this?</b> If the answer is a document, the answer is nothing.",
    ]),

    h2("And a worker for a surface that did not exist"),
    callout("<code>ai-vision</code> &ldquo;was registered here and enqueued by nothing. It fed a document-scan turn to the assistant &mdash; <b>but the assistant has no image entry point: no route, no validator, no upload control, nothing.</b> It was a worker for a surface that was never built, and the general orphan sweep is what finally said so.&rdquo; Note how it was removed: the capability lives on in <code>services/ai/vision.service</code> with three real callers, and the comment records that restoring the chat flow means building its route first, &ldquo;at which point this handler is a <code>git show</code> away.&rdquo;", "green"),

    val("<strong>That is how to delete code.</strong> Not silently, and not never. Remove it, and leave a comment saying what it did, why it went, what still works, and how to bring it back. The git history is searchable only by someone who already suspects the thing existed."),

    h2("Concurrency is a decision"),
    lete([
      ["1", "<code>pdf: 2</code> &mdash; Puppeteer is memory-hungry; two renders is what the container can hold."],
      ["3", "<code>email: 3</code> &mdash; SMTP throughput, balanced against the sending domain's reputation."],
      ["1", "<code>fx-sync: 1</code> &mdash; a single upstream provider with rate limits; parallelism would only earn 429s."],
      ["1", "The signing-reminder pair, both at 1: &ldquo;the sweep sends outbound email and <b>the cap is enforced in SQL</b>, so parallelism would buy nothing and risk a burst against the sending domain.&rdquo;"],
    ]),
  ].join("\n")));

  // ---------------------------------------------------------- events
  out.push(page("", F("EVENTS, AUDIT &amp; THE WATCHER"), [
    h1("<code>emit.js</code> &mdash; Two Logs, One Transaction"),
    lead("Every service you write calls these two functions. They look similar and are not."),

    stack([
      ["<code>emitEvent</code> &rarr; <code>live.event_log</code>", "Drives behaviour: notifications, workflows, compliance triggers. Something is expected to <b>react</b>."],
      ["<code>audit</code> &rarr; <code>live.immutable_ledger</code>", "Append-only trail, <b>10-year retention</b>. Nothing reacts; it is the permanent record of who did what."],
    ]),

    h2("The error policy, precisely"),
    val("&ldquo;Both are best-effort-safe: a logging failure must not break the business op, <strong>EXCEPT audit of security-critical actions which should bubble up.</strong>&rdquo; A failed notification should not roll back an invoice. A failed audit of a permission change <i>should</i> &mdash; because an unlogged privilege escalation is exactly the event the log exists for."),

    h2("Watch-the-Watcher"),
    callout("Implemented <b>here, centrally</b>, &ldquo;so every security-critical event is caught no matter which module emits it &mdash; rather than wiring a notifier into each of the three (permission/role/field_visibility) services separately and <b>missing the next one someone adds</b>.&rdquo;", "green"),

    h2("How it works"),
    lete([
      ["1", "<code>event_type.is_security_critical</code>, seeded in <code>9020_seed_rbac_events.sql</code>, is <b>the single source of truth</b>."],
      ["2", "For those events the <code>event_log</code> row's priority is forced to <code>HIGH</code>."],
      ["3", "A HIGH in-app notification is fanned out to every active <b>CEO</b> and <b>MANAGEMENT</b> user &mdash; the watchers."],
      ["4", "<b>Both run in the caller's transaction</b>, so the notification is atomic with the change that triggered it. There is no window in which the privilege exists and the alert does not."],
      ["5", "The fan-out is <b>a single <code>INSERT…SELECT</code> guarded by an <code>EXISTS</code></b>, so it is a zero-row no-op for the ~99% of events that are NORMAL &mdash; no branching round-trip in JS."],
    ]),

    val("<strong>Point 5 is a craft detail worth stealing.</strong> The obvious implementation is <code>if (isSecurityCritical) { await notify(); }</code> &mdash; which costs a round-trip to <i>find out</i> on every single event in the system. Pushing the condition into the SQL makes the common case free. Correctness first, then make the common path cost nothing."),

    h2("Correlation ids without threading a parameter"),
    cmd(`function currentRequestId() {
  const ctx = requestContext.get();     // AsyncLocalStorage
  return (ctx && ctx.requestId) || null;
}`),
    callout("&ldquo;Read from AsyncLocalStorage rather than threaded through every caller: <b>there are hundreds of emit/audit sites, and a parameter that 300 call sites have to remember to pass is a parameter that will be missing somewhere.</b>&rdquo; It returns <code>null</code> when there is no request &mdash; a BullMQ worker, a scheduler, a migration. That null is information, not a gap.", "gold"),

    quiz("Why must the Watch-the-Watcher notification run inside the caller's transaction?",
      ["For performance",
       "Because otherwise a permission change could commit while its alert fails, leaving a privilege escalation with no notification — the exact scenario the feature exists to prevent",
       "Because AsyncLocalStorage requires it",
       "To preserve event ordering"],
      1,
      "Atomicity is the feature. Any design where the change and the alert can diverge has a window an attacker can aim at &mdash; and even without an attacker, an intermittent notification failure quietly destroys trust in the whole alerting system."),
  ].join("\n")));

  // ---------------------------------------------------------- error contract
  out.push(page("", F("THE ERROR CONTRACT"), [
    h1("Two Rules That Decide Everything"),
    lead("<code>doc/ERROR_HANDLING.md</code> opens with two sentences, and the entire seven-class taxonomy is derived from them. Learn the two rules and you can classify any failure you meet."),

    val("<strong>1. A mutation is never silent.</strong> If server state changed &mdash; or was meant to &mdash; the user is told."),
    val("<strong>2. &ldquo;Don't interrupt the user&rdquo; and &ldquo;don't tell engineering&rdquo; are different decisions.</strong> Conflating them is what <code>.catch(() =&gt; {})</code> does, &ldquo;and why a background sync could fail for every user for a week with no signal at all.&rdquo;"),

    callout("<strong>Rule 2 is the one nobody thinks of.</strong> A single <code>catch</code> that does nothing is making two decisions at once: do not bother the user, <i>and</i> do not tell the team. Those have completely different correct answers for background work. Separating them is the whole design.", "gold"),

    h2("The seven classes"),
    table("mst", ["Class", "When", "Toast?", "Report?"], [
      ["<b>A &middot; Storage</b>", "<code>localStorage</code> fails on quota or private mode", "none", "none"],
      ["<b>B &middot; Parse fallback</b>", "Malformed cache entry or body, with a defined fallback", "none", "none"],
      ["<b>C &middot; Teardown</b>", "Closing something already gone; the original error is the useful one", "none", "none"],
      ["<b>D &middot; Best-effort background</b>", "Fire-and-forget the user did not initiate &mdash; read receipts, telemetry", "none", "<b>notice</b>"],
      ["<b>E &middot; Degraded read</b>", "Partial UI is acceptable, <b>but the user must see the degradation</b>", "inline note", "<b>notice</b>"],
      ["<b>F &middot; Mutation</b>", "Anything that changes server state", "<b>always</b>", "warning+"],
      ["<b>G &middot; Config</b>", "A prerequisite is unset &mdash; SMTP, an API key, a geofence policy", "<b>callout + fix-it link</b>", "never"],
    ]),

    bl([
      "A, B and C carry the <code>@silent:*</code> markers the CI gate checks. <b>D is where the old code was wrong</b>: silent to the user, but it must still reach engineering.",
      "<b>G never reports.</b> A missing API key is not an engineering incident, it is a configuration task &mdash; and paging the team for it trains them to ignore the channel.",
      "<b>F is never silent, full stop.</b> There is no marker that sanctions it.",
    ]),

  ].join("\n")));

  out.push(page("", F("THE MUTATION ENVELOPE"), [
    h1("The Mutation Envelope"),
    lead("Rule 1 said a mutation is never silent. This is the shape that makes it true."),


    cmd(`{ "ok": true, "changed": true,  "data": { … } }
{ "ok": true, "changed": false, "message": "Session was already revoked" }`),

    lete([
      ["1", "<code>ok:false</code> is <b>never returned</b>. Failures throw and are handled by <code>middleware/error-handler.js</code>. One path for errors, not two."],
      ["2", "<code>changed</code> answers <b>&ldquo;did server state actually move?&rdquo;</b> This is the case that made the session-kill bug look like nothing happened: a second click to revoke an already-revoked session succeeds with a 200 whose body says the row was unchanged."],
      ["3", "The client renders that as <b>&ldquo;That session was already revoked&rdquo;</b>, not silence. The user's mental model stays correct."],
    ]),

    callout("<strong>Why <code>changed:false</code> is not a 409.</strong> An already-revoked session is not a conflict. &ldquo;Making idempotent success a 4xx <b>would break the offline outbox</b> &mdash; it replays writes that failed offline, and a replayed successful kill would then surface as an error for an operation that worked.&rdquo; Genuine conflicts &mdash; a stale-record edit, a double-post &mdash; keep 409; idempotent no-ops keep 200 with <code>changed:false</code>.", "green"),

    val("<strong>Chapter 7's outbox and this status-code decision are the same decision, seen from two ends.</strong> You cannot choose 409 here without breaking a front-end feature three layers away. This is exactly the reasoning that a full-stack engineer can do and two specialists, each correct in their own domain, cannot."),

    h2("The rollout, and the honest default"),
    bl([
      "<code>withResult()</code> in <code>src/shared/crud/</code> was applied to ~25 action endpoints &mdash; <code>/kill</code>, <code>/revoke-all</code>, <code>/approve</code>, <code>/transition</code>, <code>/post</code>, <code>/purge</code>, <code>/supersede</code>, <code>/regularize</code>.",
      "<code>useAction</code> treats a <b>missing envelope as <code>changed:true</code></b>, so the ~466 routes not yet converted still work.",
      "A later PR converts the rest and flips the default.",
      "<b>The baseline pattern again</b>: introduce the contract today, keep the old world working, migrate incrementally, flip the default last.",
    ]),

    quiz("Your new <code>/onboarding-tasks/:id/assign</code> is called with the owner it already has. What should it return?",
      ["409 — nothing to change",
       "200 with <code>{ ok:true, changed:false, message:\"Already assigned to that user\" }</code>",
       "204 No Content",
       "200 with <code>changed:true</code>, since the request succeeded"],
      1,
      "It is an idempotent no-op, not a conflict, and the client should say so out loud rather than flashing a success that implies work happened. Answer 4 is the subtle trap: it is technically a success, but it lies about whether state moved &mdash; and an outbox replay would then look like a real second assignment."),
  ].join("\n")));

  // ---------------------------------------------------------- lab
  out.push(page("", F("LAB 8 &mdash; A JOB OF YOUR OWN"), [
    band("L8", "Lab &mdash; Ship A Background Job", "WEEK 3 &middot; <b>HANDS ON</b> &middot; ~2.5 HOURS", "lab"),
    lead("Your module needs one: a nightly sweep that finds overdue onboarding tasks and notifies their owners. Both halves &mdash; because you now know what happens when you build only one."),

    h2("Part A &mdash; The handler"),
    req([
      "<code>src/jobs/handlers/onboarding-overdue.js</code>, exporting <code>async (job) =&gt; …</code>.",
      "It must iterate <b>tenants</b>, not rely on a request-scoped connection. There is no <code>req</code> here.",
      "<b>Idempotent.</b> <code>attempts: 3</code> means it may run three times &mdash; do not notify anyone twice.",
      "Handle its own errors <i>with</i> logging. Never an empty catch &mdash; you have read what that costs.",
      "Emit an event per notification so the trail exists.",
    ]),

    h2("Part B &mdash; The scheduler"),
    req([
      "<code>src/jobs/handlers/onboarding-overdue-scheduler.js</code>.",
      "Wrapped in <code>withCronLock(\"onboarding-overdue\", …)</code> &mdash; <b>this is the point of the chapter</b>.",
      "Register <b>both</b> in <code>PROCESSORS</code> with a justified concurrency.",
      "Write the justification as a comment, in the style of the signing-reminder pair.",
    ]),

    h2("Part C &mdash; Prove both halves"),
    ex("The three proofs", "45 min",
      "<p>Demonstrate, with output pasted: (1) the job runs when enqueued by hand; (2) the scheduler enqueues it on schedule; (3) <b>with two worker processes running, the cron fires exactly once</b> &mdash; start a second worker and show the loser skipping. Proof (3) is the one that would have caught NEW-04.</p>",
      "1. … 2. … 3. …"),

    cmd(`# Run a second worker to prove the lock
node src/jobs/workers.js &
node src/jobs/workers.js &
# Watch the logs: one acquires, one skips silently.

# Inspect the queue
npm run ops:status`),

    h2("Part D &mdash; The idempotency argument"),
    ex("Defend it in writing", "20 min",
      "<p>Write the paragraph you would put in the PR: exactly why running this handler twice produces the same result as running it once. Name the mechanism &mdash; a uniqueness constraint, a state check, a marker column, a dedupe key. If your answer is &ldquo;it probably won't run twice&rdquo;, you have not answered.</p>",
      "This handler is idempotent because …"),

    callout("<strong>&ldquo;It probably won't run twice&rdquo; is the sentence that precedes every duplicate-billing incident.</strong> Retries, redeploys mid-job, a network partition that makes a completed job look failed, an operator re-running something manually &mdash; all of these happen, and none of them are exotic. Write the mechanism down, and if there isn't one, build one.", "red"),

    dod(["Handler idempotent and justified", "Scheduler under <code>withCronLock</code>", "Both registered with reasoned concurrency", "Two-worker single-fire proven", "No empty catches"]),
  ].join("\n")));

  return out;
}
