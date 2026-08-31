import {
  page, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
  setChapter,
} from "./kit.mjs";

const F = (s) => `CHAPTER 5 &mdash; BUILD A MODULE &nbsp;&middot;&nbsp; ${s}`;

export function chapter() {
  setChapter(5);
  const out = [];

  out.push(page("", F("THE BRIEF"), [
    band("05", "Build A Module", "WEEK 2 &middot; <b>BUILD</b> &middot; ~8 HOURS &middot; <b>THE CENTREPIECE</b>"),
    lead("Everything so far has been preparation. Now you build <code>operations/onboarding_task</code> &mdash; eight files, six endpoints, a lifecycle, events, audit and an AI manifest &mdash; using the table you migrated in Lab 4B. When it is done and green, you are a contributor."),

    h2("The specification"),
    val("<strong>MOD-XX &mdash; Onboarding Task.</strong> Track the checklist of tasks a team runs when a new client is signed. Tasks belong to a client, have an owner and a due date, and move through a short lifecycle. Overdue and unassigned tasks are what the team actually looks at."),

    h2("Endpoints"),
    table("mst", ["Method", "Path", "Permission", "Notes"], [
      ["GET", "<code>/onboarding-tasks</code>", "<code>view</code>", "Filter by <code>client_id</code>, <code>status</code>, <code>owner_user_id</code>; search <code>title</code>"],
      ["GET", "<code>/onboarding-tasks/:id</code>", "<code>view</code>", "404 when absent"],
      ["POST", "<code>/onboarding-tasks</code>", "<code>create</code>", "201; status starts <code>PENDING</code>"],
      ["PATCH", "<code>/onboarding-tasks/:id</code>", "<code>edit</code>", "Plus the lifecycle guard"],
      ["POST", "<code>/onboarding-tasks/:id/transition</code>", "map", "Validator <b>first</b>, then permission"],
      ["POST", "<code>/onboarding-tasks/:id/assign</code>", "<code>edit</code>", "Set or clear the owner"],
    ]),

    h2("The lifecycle"),
    flow([
      { t: "PENDING", b: "&rarr; IN_PROGRESS, CANCELLED" },
      { t: "IN_PROGRESS", b: "&rarr; DONE, CANCELLED" },
      { t: "DONE", b: "terminal" },
      { t: "CANCELLED", b: "terminal" },
    ]),

    h2("The transition-action map &mdash; your decision"),
    ex("Decide the permissions", "10 min",
      "<p>Fill in <code>TRANSITION_ACTION</code>. Which of <code>IN_PROGRESS</code>, <code>DONE</code>, <code>CANCELLED</code> is <code>edit</code> and which is <code>approve</code>? Apply the reasoning from Chapter 3: advancing is routine; a decision that <b>ends</b> the record is not. Then state what the unlisted default is and why that direction is the safe one.</p>",
      "IN_PROGRESS: … / DONE: … / CANCELLED: … / Unlisted defaults to … because …"),

    callout("<strong>Do not skip ahead to writing code.</strong> Answer the exercise above first. Half of engineering at this level is making a decision deliberately rather than by default, and this is the smallest possible instance of it.", "gold"),
  ].join("\n")));

  // ---------------------------------------------------------- order of work
  out.push(page("", F("THE ORDER OF WORK"), [
    h1("Build It Inside Out"),
    lead("Eight files, but not eight equal steps. Build from the pure centre outwards, so that every layer you add sits on something already proven."),

    table("mst", ["#", "File", "Why here", "Verify with"], [
      ["1", "<code>.rules.js</code>", "Pure. No dependencies. Testable in milliseconds.", "A unit test, immediately"],
      ["2", "<code>.events.js</code>", "Three lines of constants the service will need.", "It compiles"],
      ["3", "<code>.repo.js</code>", "SQL against the table you already migrated.", "A db test"],
      ["4", "<code>.service.js</code>", "Rules + repo + transaction + events + audit.", "Unit tests with a fake client"],
      ["5", "<code>.validator.js</code>", "Zod schemas including the <code>ai*</code> variants.", "Parse fixtures directly"],
      ["6", "<code>.controller.js</code>", "Thin. Should be almost mechanical by now.", "Nothing yet"],
      ["7", "<code>.routes.js</code>", "The chain, in the right order.", "An integration test"],
      ["8", "<code>.ai.js</code>", "The manifest over what already exists.", "The wiring sweep"],
    ]),

    callout("<strong>Why inside-out beats top-down here.</strong> If you start at the route, nothing runs until all eight files exist, and your first feedback is an integration test failing for one of six possible reasons. Starting at <code>.rules.js</code> means you have a passing test <b>four minutes in</b>, and every subsequent step adds exactly one new source of failure. That is the same principle as the gates: shrink the distance between a mistake and its detection.", "green"),

    h2("Create the folder"),
    cmd(`mkdir -p src/modules/operations/onboarding_task
cd src/modules/operations/onboarding_task

# The loader's NAME_RE is /^[a-z][a-z0-9_]*$/ — snake_case only.
# onboardingTask/ would be SILENTLY INVISIBLE. See Chapter 1.`),

    val("Keep <code>src/modules/sales/lead/</code> open in a second editor pane for the whole of this chapter. <strong>Copying the shape of a known-good module is not cheating &mdash; it is the job.</strong> What you must not copy is the <i>logic</i>: your lifecycle, fields and rules are your own."),

    h2("Pick your module key"),
    cmd(`# Find what is taken. Do not guess.
grep -rho 'MOD-[0-9]\\+' src/modules/ | sort -u -t- -k2 -n | tail -20

# Then check the feature catalogue and permission seed data for how a new
# module key is registered — a key that exists only in your routes file
# is a key no role can be granted.
grep -rn "MOD-20" --include=*.js --include=*.sql -l . | head -20`),

    callout("<strong>That second command is the real lesson.</strong> A module key is not just a string in a routes file &mdash; it appears in seed data, the feature catalogue, permission fixtures and tests. Find <i>every</i> place <code>MOD-20</code> is registered, and register yours in all of them. The <code>feature-catalogue-coverage</code> security test exists precisely because people forget one.", "red"),
  ].join("\n")));

  // ---------------------------------------------------------- files 1-3
  out.push(page("", F("STEPS 1&ndash;3 &mdash; RULES, EVENTS, REPO"), [
    h1("Steps 1&ndash;3 &mdash; The Foundation"),

    h2("Step 1 &mdash; <code>onboarding_task.rules.js</code>"),
    req([
      "Export a <code>NEXT</code> map for all four states. Terminal states get <code>[]</code>.",
      "Export <code>assertTransition(from, to)</code> throwing <code>AppError(\"BAD_STATE\", …, 422)</code>.",
      "The message must name both states, as <code>lead.rules.js</code> does.",
      "<b>No requires other than <code>AppError</code>.</b> If you reach for the db here, stop.",
    ]),
    ex("Write it, then test it", "20 min",
      "<p>Write the file, then write <code>tests/unit/onboarding-task-rules.test.js</code> covering: every legal transition passes; a transition out of a terminal state throws; an unknown <code>from</code> throws; the error's <code>code</code> and status are correct. Run <code>npx jest onboarding-task-rules</code> and paste the output.</p>",
      "Output: …"),

    h2("Step 2 &mdash; <code>onboarding_task.events.js</code>"),
    cmd(`"use strict";
module.exports = {
  MODULE: "MOD-XX",
  CREATED: "onboarding_task.created",
  UPDATED: "onboarding_task.updated",
  ASSIGNED: "onboarding_task.assigned",
  transition: (status) => "onboarding_task." + String(status).toLowerCase(),
};`),

    h2("Step 3 &mdash; <code>onboarding_task.repo.js</code>"),
    req([
      "<code>insert</code>, <code>get</code>, <code>update</code>, <code>list</code> &mdash; via the shared helpers, never hand-rolled.",
      "<code>update</code> must have the empty-patch guard: no keys &rArr; return the current row.",
      "<code>update</code> must pass <code>{ touch: \"updated_at\" }</code>.",
      "<code>list</code> must use <code>page(q)</code> for limit/offset and always <code>ORDER BY</code>.",
      "Filters: <code>client_id</code>, <code>status</code>, <code>owner_user_id</code>; search <code>q</code> against <code>title</code>.",
      "<b>Every user value goes in <code>params</code>, never into the SQL string.</b>",
      "One extra query: <code>overdueCount(client)</code> &mdash; tasks past <code>due_date</code> and not DONE/CANCELLED.",
    ]),

    callout("<strong>Watch the overdue query.</strong> &ldquo;Past due&rdquo; against <code>now()</code> is a timezone question, and <code>due_date</code> is a <code>date</code>, not a <code>timestamptz</code>. Decide explicitly whether a task due today is overdue at 00:01 or at 23:59, and write the decision in a comment. This is exactly the kind of thing that produces a client complaint six months later.", "gold"),

    ex("The repo test", "25 min",
      "<p>Write a db test that inserts three tasks with different statuses and due dates, then asserts: the unfiltered list returns all three in the right order; each filter narrows correctly; a filter with no matches returns <code>[]</code> and not an error; <code>overdueCount</code> matches your stated timezone rule. Paste the passing output.</p>",
      "Output: …"),

    quiz("Your <code>list</code> ignores <code>?stat=DONE</code> (a typo for <code>status</code>) and returns everything. Is that acceptable?",
      ["Yes — unknown parameters should be ignored, that's standard REST",
       "No — this is finding API F-28: a silently-dropped filter returns MORE rows than the caller asked for, which on a permissions or receivables screen means showing rows they meant to exclude",
       "Yes, as long as it is documented",
       "Only a problem if the parameter is a permission filter"],
      1,
      "The shared CRUD kit gained a <code>filterable</code> allow-list for exactly this. A typo that <i>narrows</i> results is a visible bug someone reports; a typo that <i>widens</i> them looks like success. Always fail loudly in the direction of exposing more data than intended."),
  ].join("\n")));

  // ---------------------------------------------------------- service
  out.push(page("", F("STEP 4 &mdash; THE SERVICE"), [
    h1("Step 4 &mdash; <code>onboarding_task.service.js</code>"),
    lead("The biggest file, and the one that will be reviewed hardest. Five exported functions, each following the anatomy from Chapter 3."),

    h2("<code>create(client, { data, actor })</code>"),
    req([
      "Wrap the whole body in <code>atomically(client, …)</code>.",
      "Set <code>status: \"PENDING\"</code> explicitly &mdash; visible in code, not hidden in a column default.",
      "<code>owner_user_id: data.owner_user_id || null</code>. <b>Do not</b> fall back to the actor: an unassigned task is a real state the team looks for.",
      "<code>emitEvent</code> then <code>audit</code>, both with <code>entityRef</code> from a <code>ref()</code> helper.",
      "Return the row.",
    ]),
    callout("<strong>Note where this deliberately differs from <code>lead</code>.</strong> A lead defaults its owner to whoever created it, because an unowned lead is a lead nobody is chasing. An onboarding task defaults to <i>unassigned</i>, because &ldquo;who still needs an owner?&rdquo; is the question the team asks every morning. <b>Same shape, opposite default, and the difference is domain knowledge, not code style.</b> Write that reasoning in a comment.", "green"),

    h2("<code>update(client, { id, patch, actor })</code>"),
    req([
      "Read <code>before</code> from the repo. 404 if absent.",
      "Refuse edits to <code>DONE</code> or <code>CANCELLED</code> with <code>AppError(\"LOCKED\", …, 422)</code>.",
      "Copy only allow-listed keys out of <code>patch</code> via a <code>TASK_FIELDS</code> array &mdash; the second line of defence behind Zod.",
      "<code>audit</code> with <b>both</b> <code>before</code> and <code>after</code>.",
    ]),

    h2("<code>transition(client, { id, to, actor })</code>"),
    req([
      "Read <code>before</code>; 404 if absent.",
      "<code>assertTransition(before.status, to)</code> &mdash; against the <b>row's</b> state, never the client's claim.",
      "Update, then <code>emitEvent(events.transition(to))</code>, then <code>audit</code>.",
    ]),

    h2("<code>assign(client, { id, ownerUserId, actor })</code>"),
    req([
      "<code>null</code> is a legal value &mdash; unassigning is a real operation, not an error.",
      "Refuse on terminal states, same as <code>update</code>.",
      "Emit <code>ASSIGNED</code>. Audit before and after.",
      "<b>Question to answer in a comment:</b> should assigning a <code>PENDING</code> task auto-advance it to <code>IN_PROGRESS</code>? Decide, and justify.",
    ]),

    val("<strong>That last question has no right answer, and that is the point.</strong> Auto-advancing is convenient and surprising; not auto-advancing is predictable and adds a click. Either is defensible. <b>What is not defensible is choosing without noticing you chose.</b> Your reviewer will ask, and &ldquo;I hadn't thought about it&rdquo; is the only wrong reply."),

    ex("Service tests", "40 min",
      "<p>Write unit tests with a fake client covering: create emits both an event and an audit row; update on a DONE task throws LOCKED with 422; transition validates against the stored status, not the payload; assign accepts null. Then write down <b>which boundary each test mocks</b>, and what a bug hiding behind that mock would look like in production.</p>",
      "Tests: … / Mocked boundaries and their blind spots: …"),
  ].join("\n")));

  // ---------------------------------------------------------- 5-8
  out.push(page("", F("STEPS 5&ndash;8 &mdash; THE EDGES"), [
    h1("Steps 5&ndash;8 &mdash; Validator, Controller, Routes, AI"),

    h2("Step 5 &mdash; <code>onboarding_task.validator.js</code>"),
    req([
      "<code>create</code>: <code>client_id</code> uuid required; <code>title</code> min 1; <code>owner_user_id</code> uuid optional nullable; <code>due_date</code> a date; <code>notes</code> optional.",
      "<code>update</code>: written out separately &mdash; <b>not</b> <code>create.partial()</code>. Remember API F-17.",
      "<code>transition</code>: <code>{ to: z.enum([...]) }</code>. <code>assign</code>: <code>{ owner_user_id: z.string().uuid().nullable() }</code>.",
      "<code>aiTransition</code> and <code>aiAssign</code>: the same, plus <code>task_id: z.string().uuid()</code>.",
      "The <code>mw(k)</code> factory, verbatim in spirit: <code>safeParse</code>, 422, <code>fieldErrors</code>, <code>req.body = p.data</code>.",
      "<b>Export <code>schemas</code> as well as the middlewares.</b> The AI file needs them.",
    ]),

    h2("Step 6 &mdash; <code>onboarding_task.controller.js</code>"),
    req([
      "One <code>asyncHandler</code> per endpoint. Every one wrapped, no exceptions.",
      "<code>const actor = (req) =&gt; req.user || { user_id: null };</code>",
      "<code>req.tenantDb((c) =&gt; service.…)</code> &mdash; and <b>never</b> <code>Promise.all</code> over it (PERF-S2).",
      "404 lives here, not in the service. 201 on create.",
      "Everything wrapped as <code>{ data: … }</code>.",
    ]),

    h2("Step 7 &mdash; <code>onboarding_task.routes.js</code>"),
    req([
      "<code>router.use(authMiddleware)</code> at the top.",
      "<code>MODULE</code> and <code>TRANSITION_ACTION</code> as constants.",
      "<code>PATCH</code>: permission &rarr; validator &rarr; <code>requireLifecyclePermissionOnPatch</code> &rarr; controller.",
      "<code>POST /:id/transition</code>: <b>validator first</b>, then <code>requireTransitionPermission</code>.",
      "<code>module.exports = { basePath: \"/onboarding-tasks\", feature: …, router }</code>.",
    ]),
    callout("<strong>The <code>feature</code> key is a real decision.</strong> <code>lead</code> exports <code>feature: null</code>, meaning always mounted. If your module should be gated behind a plan or feature flag, name it here and register it in the feature catalogue. Getting this wrong in either direction is a support ticket: a flag nobody can turn on, or a paid feature every plan receives.", "gold"),

    h2("Step 8 &mdash; <code>onboarding_task.ai.js</code>"),
    req([
      "<code>entity</code>, <code>module_key</code>, <code>screens</code>.",
      "<code>reads</code>: <code>list_onboarding_tasks</code>, <code>get_onboarding_task</code>.",
      "<code>writes</code>: <code>create_onboarding_task</code>, <code>transition_onboarding_task</code>, <code>assign_onboarding_task</code>.",
      "Every write: the <b>same</b> service function, the <b>same</b> Zod schema, the <b>same</b> permission, and <code>confirm: true</code>.",
      "<code>describe</code> strings written as prompts &mdash; state what the model must supply and what it must not assume.",
    ]),

    ex("Write the descriptions last, and carefully", "20 min",
      "<p>Write all five <code>describe</code> strings. Then reread them as if you were a language model with no other context: could you choose the right tool and fill its arguments from these sentences alone? Rewrite any that fail that test. Compare against <code>convert_lead</code>'s, which explicitly warns that a silent fallback is gone.</p>",
      "Final describes: …"),

    quiz("You give <code>list_onboarding_tasks</code> <code>confirm: true</code>. What have you done?",
      ["Improved safety at no cost",
       "Made the copilot ask permission to read — training users to click through confirmations, which devalues the confirmations that guard writes",
       "Nothing; confirm is ignored on reads",
       "Broken the action registry"],
      1,
      "Confirmation fatigue is a real failure mode. If everything asks, nobody reads the question, and the one dialogue that actually mattered gets the same reflex click. Reads do not confirm; writes always do. The value of a prompt is inversely proportional to how often it appears."),
  ].join("\n")));

  // ---------------------------------------------------------- wire + verify
  out.push(page("", F("WIRE IT UP &amp; PROVE IT"), [
    band("L5", "Lab 5 &mdash; Mount, Verify, Green", "WEEK 2 &middot; <b>HANDS ON</b> &middot; ~90 MIN", "lab"),
    lead("Eight files exist. Nothing has proven they work together. This is where the auto-discovery you learned in Chapter 1 either rewards you or humiliates you quietly."),

    h2("Step 1 &mdash; Does it even mount?"),
    cmd(`npm run dev

# Watch the boot log for your basePath. If it is absent, work down this list:
#   1. Is the folder snake_case?              NAME_RE = /^[a-z][a-z0-9_]*$/
#   2. Is the file named <module>.routes.js, matching the folder exactly?
#   3. Does it export { basePath, feature, router }?
#   4. Did require() throw?  — the loader SKIPS a throwing module with a
#      WARNING, not a crash. Read the warnings. This is the #1 time-waster.
curl -s localhost:3000/api/health | jq`),

    callout("<strong>Point 4 catches almost everyone.</strong> A typo in a require path does not crash the server &mdash; it makes your module silently not exist, while everything else works perfectly. You will spend twenty minutes testing an endpoint that was never mounted. <b>Read the boot warnings first, every time.</b>", "red"),

    h2("Step 2 &mdash; Drive it by hand"),
    cmd(`BASE=http://localhost:3000/api
TOK="<your tenant admin token>"
H="-H \\"Authorization: Bearer $TOK\\" -H \\"Content-Type: application/json\\""

# create
curl -s -X POST $BASE/onboarding-tasks -H "Authorization: Bearer $TOK" \\
  -H "Content-Type: application/json" \\
  -d '{"client_id":"<uuid>","title":"Collect KYC pack","due_date":"2026-09-01"}' | jq

# the transition your map gates hardest
curl -s -X POST $BASE/onboarding-tasks/<id>/transition -H "Authorization: Bearer $TOK" \\
  -H "Content-Type: application/json" -d '{"to":"CANCELLED"}' | jq`),

  ].join("\n")));

  out.push(page("", F("LAB 5 &mdash; PROVE IT FAILS CORRECTLY"), [
    h1("Lab 5 &mdash; Prove It Fails Correctly"),
    lead("Working is the easy half. Six failures, and each one has a right answer."),

    ex("Six failures, six correct answers", "30 min",
      "<p>Provoke each of these and record the status, the error <code>code</code>, and whether the message would help a stranger: (1) create with no <code>title</code>; (2) transition <code>PENDING</code> &rarr; <code>DONE</code>; (3) patch a <code>CANCELLED</code> task; (4) get a random UUID; (5) create with an extra unknown field &mdash; is it stripped or rejected?; (6) call any endpoint with no token.</p>",
      "1. … 2. … 3. … 4. … 5. … 6. …"),

    h2("Step 4 &mdash; The full gate run"),
    cmd(`npm run ci

# Expect trouble from, in rough order of likelihood:
#   • Lint (--max-warnings 136 — the ratchet does not forgive you)
#   • API docs in sync        → npm run docs:api
#   • Write routes are validated
#   • API contract / Response-contract drift
#   • Query columns exist
#   • orphan-wiring-sweep     → tests/security/
#   • feature-catalogue-coverage`),

    val("<strong>Do not fix a gate by weakening it.</strong> If the lint ratchet blocks you, fix the warning &mdash; do not raise 136 to 137. That number only ever goes down, and the person who raises it is the person who ended the ratchet. If you genuinely believe a gate is wrong, say so at Gate 2 with evidence; do not settle it alone in a commit."),

    dod(["Mounts on boot", "All six endpoints work by hand", "Six failures answer correctly", "<code>npm run ci</code> fully green", "No gate weakened"]),
  ].join("\n")));

  return out;
}
