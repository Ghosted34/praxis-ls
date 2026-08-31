import {
  page, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
  setChapter,
} from "./kit.mjs";

const F = (s) => `CHAPTER 6 &mdash; TESTING &amp; QA &nbsp;&middot;&nbsp; ${s}`;

export function chapter() {
  setChapter(6);
  const out = [];

  out.push(page("", F("375 TESTS, FIVE KINDS"), [
    band("06", "Testing &amp; QA", "WEEK 3 &middot; <b>TEACH + BUILD</b> &middot; ~6 HOURS"),
    lead("375 test files in five directories, and they are not five flavours of the same thing. Each answers a different question, and the most interesting category &mdash; <code>security/</code> &mdash; does not test behaviour at all. It tests that the codebase still has the shape everyone believes it has."),

    table("mst", ["Directory", "Question it answers", "Speed", "Mocks?"], [
      ["<code>tests/unit/</code>", "Does this function do what it says, in isolation?", "milliseconds", "Heavily"],
      ["<code>tests/db/</code>", "Does this SQL do what I think against a real Postgres?", "seconds", "None"],
      ["<code>tests/integration/</code>", "Does the whole request path work end to end?", "seconds", "Minimal"],
      ["<code>tests/security/</code>", "<b>Is the codebase still shaped the way we assume?</b>", "fast", "None &mdash; it reads source"],
      ["<code>tests/fixtures/</code>", "Shared setup: not tests, but the reason the others are readable", "&mdash;", "&mdash;"],
    ]),

    callout("<strong>The fourth row is what makes this repo unusual.</strong> Most codebases test behaviour and hope structure follows. This one asserts structure directly: every route is wired, every mail send point goes through the approved helper, every feature in the catalogue exists, no new silent catch was added. These are the tests that catch the bug <i>nobody wrote a test for</i>, because they test the class of mistake rather than the instance.", "green"),

    h2("The coverage number, and why it is 13"),
    val("<code>jest.config.js</code> sets exactly one threshold: <strong><code>global: { functions: 13 }</code></strong>. Not lines. Not statements. Not branches. Read the comment above it &mdash; it is the best short essay on metrics in the repo."),

    h2("The finding behind it (TC-Q1)"),
    lete([
      ["1", "The audit measured <b>lines at 40.68%</b> against <b>functions at 13.12%</b>."],
      ["2", "<b>Every <code>*.routes.js</code> reports 100% statements with 0% functions</b> &mdash; 99 of them &mdash; because requiring the file registers the routes, and that is all the statement counter sees."],
      ["3", "So a gate set on lines or statements <b>would be satisfied by importing files</b>. It would read as healthy while measuring nothing."],
      ["4", "Only 66 of 855 files are at literally 0% statements, <b>which is what makes the codebase look far better instrumented than it is</b>."],
    ]),

    callout("<strong>And no <code>branches</code> floor, deliberately.</strong> &ldquo;Nobody has measured branch coverage on this repo, and a threshold set to a number someone guessed either fails the build the first time it runs or passes forever without meaning anything. <b>Both outcomes end with the gate being deleted.</b>&rdquo; That sentence is worth more than most testing books.", "gold"),

    quiz("Why is 13 described as a ratchet rather than a target?",
      ["Because 13 is too low to be a target",
       "Because its only job is to stop coverage going backwards from the audited baseline — it is a floor that rises as real numbers arrive, not a goal anyone is aiming at",
       "Because ratchets are easier to configure",
       "Because the team plans to remove it"],
      1,
      "A target invites gaming: write shallow tests until the number goes green. A ratchet says only &ldquo;do not make this worse&rdquo;, which is a claim you can enforce honestly. The comment is explicit that <code>branches</code> should be added and <code>functions</code> raised <i>once CI has printed a real current number</i> &mdash; measure first, then set the floor."),
  ].join("\n")));

  // ------------------------------------------------------- mocks
  out.push(page("", F("WHAT A MOCK COSTS"), [
    h1("Every Mock Is An Assumption You Stopped Checking"),
    lead("You met this in Chapter 3, in one sentence at the end of the repo comment. It deserves a page, because it is the single most expensive mistake a competent tester makes."),

    val("<strong>&ldquo;The conversion failed for every lead, and the unit test did not see it because it mocks <code>clientMaster.create</code>.&rdquo;</strong>"),

    h2("Reconstruct the failure"),
    flow([
      { t: "THE CODE", b: "convert passes <code>client_type</code> (a code) into the client master insert" },
      { t: "REALITY", b: "the table has <code>client_type_id</code>, and <b>no</b> <code>client_type</code> column" },
      { t: "POSTGRES", b: "42703 &mdash; column does not exist. Every conversion, every tenant" },
      { t: "THE TEST", b: "mocked <code>clientMaster.create</code>. <b>Green.</b>" },
    ]),

    callout("<strong>The test did not merely fail to catch the bug.</strong> It actively certified the broken code as working, and it kept doing so on every CI run while conversions failed in production. A mock does not just remove coverage &mdash; it <b>manufactures false confidence</b>, which is strictly worse than no test at all, because no test at least leaves you appropriately nervous.", "red"),

    h2("The rule"),
    stack([
      ["<b>Mock what you own and control</b>", "Your own pure functions, when you are testing a caller's orchestration rather than the callee's logic."],
      ["<b>Mock what is genuinely external</b>", "SMTP, an FX rate provider, the LLM API, a payment gateway. Things with cost, latency or side effects outside your system."],
      ["<b>Do not mock the database</b>", "Its behaviour &mdash; constraints, types, column names, transaction semantics &mdash; is precisely the thing most likely to be wrong."],
      ["<b>Do not mock across a schema boundary</b>", "The moment a mock stands in for something that reads or writes a table, your test has stopped checking the assumption that matters."],
    ]),

    h2("The rule of thumb"),
    val("<strong>If the mock encodes an assumption about a schema, an API contract, or another team's code &mdash; write a db or integration test instead.</strong> If the mock only avoids slowness or nondeterminism in code you fully control, it is fine."),

    h2("<code>jest.mock</code> hoisting &mdash; a gate of its own"),
    cmd(`// This LOOKS right and is silently broken:
const service = require("./thing.service");
jest.mock("./thing.repo");        // ← hoisted ABOVE the require by babel-jest…
                                  //   …but reasoning about it here is fragile

// The house rule: jest.mock calls go at the very top, before any require,
// and the CI gate "jest.mock hoisting" enforces it.`),
    bl([
      "<code>jest.mock</code> is hoisted by the transform, so its position in the file is misleading about when it takes effect.",
      "A mock declared after the module under test has captured a reference can end up mocking nothing.",
      "The result is a test that passes for the wrong reason &mdash; the worst possible outcome, again.",
      "Hence a <b>dedicated CI gate</b> rather than a code-review convention.",
    ]),

    ex("Audit your own mocks", "25 min",
      "<p>Open the service tests you wrote in Chapter 5. For each <code>jest.mock</code>, write: what assumption it encodes, and one concrete production bug that would slip past it. Then convert at least one of them into a db or integration test that would catch that bug. Paste the new test.</p>",
      "Mock 1 assumes … blind to … / Converted test: …"),
  ].join("\n")));

  // ------------------------------------------------------- security tests
  out.push(page("", F("THE ANTI-DRIFT TESTS"), [
    h1("<code>tests/security/</code> &mdash; Testing The Shape"),
    lead("These files do not start a server or open a database. They read the source tree and assert facts about it. They are the immune system of a codebase that 131 modules and many hands are constantly reshaping."),

    table("mst", ["Test", "The drift it prevents"], [
      ["<code>orphan-wiring-sweep</code>", "A module that exists on disk but is not reachable &mdash; because the loader <b>skips a throwing module with a warning, not a crash</b>. Without this test, a broken require is invisible."],
      ["<code>feature-catalogue-coverage</code>", "A feature declared in the catalogue with no module behind it, or a module gated on a feature nobody registered."],
      ["<code>mail-send-point-wiring</code>", "Any code path sending mail without going through the approved helper &mdash; bypassing suppression lists, rate limits and the audit trail."],
      ["<code>mail-*</code> visibility tests", "Mail templates and recipients drifting out of alignment with what the UI claims will be sent."],
      ["<code>no-refresh-audits</code>", "Audit rows written for token refreshes, which would bury real security events under routine noise."],
      ["<code>signature-*</code>", "The shape of a critical function changing without its callers being updated."],
    ]),

    h2("Six shapes of &ldquo;declared, not called&rdquo;"),
    callout("This repo has a name for the recurring family of bugs these tests hunt: a thing is <b>declared</b>, looks present in every review, appears in every doc &mdash; and is never actually <b>called</b>. A middleware registered but not mounted. A validator exported but not referenced in the route chain. A handler in the queue map with no producer. A feature in the catalogue with no module. An AI action in the manifest with no catalogue row. A gate in the script list that always exits 0.", "red"),

    val("<strong>&ldquo;A warning is not a gate.&rdquo;</strong> Repeat it. The module loader warns on a failed module. The lint config permits 136 warnings. A migration can print advice. None of those stop anything. If a condition must not reach production, <b>something has to exit non-zero</b> &mdash; and someone has to have checked that it can."),

    h2("The <code>mail-api-encoding</code> story"),
    bl([
      "A payload was being stringified twice before it went out.",
      "<b>The API was dead.</b> Every call failed at the far end.",
      "<b>The tests were green</b>, because the test asserted on the value <i>before</i> the second stringify.",
      "The lesson is the same as the mock lesson, arriving from a different direction: a test that checks an intermediate value proves nothing about what left the building.",
    ]),

    h2("Write one"),
    ex("Your own anti-drift test", "40 min",
      "<p>Write <code>tests/security/onboarding-task-wiring.test.js</code> asserting, by reading source rather than making requests: (1) the module exports the three required keys; (2) every write in the AI manifest has <code>confirm: true</code>; (3) every AI action references a schema that actually exists on the validator; (4) every state in <code>NEXT</code> appears in <code>TRANSITION_ACTION</code> <b>or</b> is deliberately absent to inherit the fail-closed default.</p>",
      "Paste the test and its passing output: …"),

    callout("<strong>Assertion (4) is the interesting one.</strong> It is not obvious whether the right assertion is &ldquo;every state is listed&rdquo; or &ldquo;absence is allowed because the default is safe&rdquo;. Argue it either way, but pick one and encode it &mdash; because an untested convention is not a convention, it is a hope.", "gold"),
  ].join("\n")));

  // ------------------------------------------------------- silent catch
  out.push(page("", F("THE SILENT-CATCH PROGRAMME"), [
    h1("&ldquo;No New Silent Catches&rdquo;"),
    lead("One of the 33 gates, and the clearest example in the repo of how to fix a systemic problem in a live codebase without stopping the world."),

    h2("The rule"),
    val("Every <code>catch</code> block whose body is <strong>empty or comment-only</strong> must carry a marker &mdash; <code>@silent:storage</code>, <code>@silent:parse</code> or <code>@silent:teardown</code> &mdash; in a block comment inside the catch body, identifying which class from <code>doc/ERROR_HANDLING.md</code> sanctions the swallow."),

    cmd(`// Sanctioned — the class is named, so a reader knows it was a decision:
try { localStorage.setItem(k, v); } catch { /* @silent:parse -- bad cache entry */ }

// Not sanctioned — the gate fails:
try { await notify(user); } catch (e) { }`),

    h2("Three design choices worth stealing"),
    lete([
      ["1", "<b>It is a scanner, not a parser.</b> The header says so outright. The vast majority of swallow sites are one of two shapes, and a regex handles both. Richer shapes &mdash; &ldquo;logs to a never-checked variable then throws it away&rdquo; &mdash; are explicitly deferred to a later phase. <b>A tool that catches 90% today beats a perfect one that ships never.</b>"],
      ["2", "<b>It ships with a baseline.</b> <code>doc/silent-catch-baseline.json</code> grandfathers the existing violations. The gate therefore passes on day one, and fails only on <i>new</i> ones. This is what makes it a ratchet rather than a wall."],
      ["3", "<b>The escape hatch is honest.</b> <code>--update</code> regenerates the baseline. It exists, it is documented, and using it is visible in the diff &mdash; so it is a decision someone has to defend in review, not a silent bypass."],
    ]),

    callout("<strong>The baseline pattern is the most reusable idea in this chapter.</strong> You will inherit codebases with thousands of violations of a rule you want to introduce. Fixing them all first is never funded. A baselined ratchet lets you introduce the rule <i>today</i>, stop the bleeding immediately, and pay down the debt opportunistically. The lint <code>--max-warnings 136</code> is the same pattern. So is <code>functions: 13</code>.", "green"),

    h2("The taxonomy"),
    bl([
      "<code>doc/ERROR_HANDLING.md</code> defines classes <b>A&ndash;G</b> of silent catch, only three of which are ever sanctioned.",
      "<code>@silent:storage</code> &mdash; a best-effort write to a store whose failure genuinely does not matter.",
      "<code>@silent:parse</code> &mdash; malformed input from a cache or an untrusted blob, where the fallback is to ignore it.",
      "<code>@silent:teardown</code> &mdash; cleanup on a path that is already failing; the original error is the one that matters.",
      "<b>Everything else must be handled, logged with context, or rethrown.</b>",
    ]),

    quiz("You need to swallow an error on a genuinely new path. What is the correct move?",
      ["Run <code>--update</code> to refresh the baseline",
       "Add the taxonomy marker naming the class that sanctions it, in the same commit — and if no class fits, that is the gate telling you the error should not be swallowed",
       "Wrap it in a try/catch that logs to console",
       "Add an eslint-disable comment"],
      1,
      "The header is explicit: adding a new silent catch requires either fixing it &mdash; the whole programme's point &mdash; or adding a marker with the taxonomy class in the same commit. <code>--update</code> is for regenerating the grandfathered set, not for laundering new debt. And &ldquo;no class fits&rdquo; is information, not an obstacle."),
  ].join("\n")));

  // ------------------------------------------------------- lab
  out.push(page("", F("LAB 6 &mdash; TEST YOUR MODULE"), [
    band("L6", "Lab &mdash; Test The Module You Built", "WEEK 3 &middot; <b>HANDS ON</b> &middot; ~3 HOURS", "lab"),
    lead("Your module works when you drive it by hand. That is the weakest possible evidence. Build the four layers of test that let someone else change your code safely."),

    rgroup("6.1", "Unit &mdash; the pure core", [
      "<code>tests/unit/onboarding-task-rules.test.js</code> &mdash; every legal transition, every illegal one, both terminal states, an unknown <code>from</code>.",
      "Assert the error <code>code</code> and status, not just that it throws.",
      "<b>No mocks at all.</b> If you need one here, your rules file is not pure.",
    ]),
    rgroup("6.2", "Unit &mdash; the service", [
      "Create emits an event <b>and</b> an audit row, inside one transaction.",
      "Update on a terminal task throws <code>LOCKED</code> / 422.",
      "Transition judges the <b>stored</b> status, not the payload's claim.",
      "Assign accepts <code>null</code>; assign on a terminal task refuses.",
      "For each mock: write the blind spot in a comment above it.",
    ]),
    rgroup("6.3", "DB &mdash; the SQL", [
      "Every filter narrows correctly; an empty result is <code>[]</code>, not an error.",
      "Pagination: page 2 does not repeat page 1 &mdash; this is what <code>ORDER BY</code> is for.",
      "The empty-patch update returns the current row and does not throw.",
      "<code>overdueCount</code> matches the timezone rule you documented.",
      "<b>Real Postgres. No mocks.</b>",
    ]),
    rgroup("6.4", "Integration &mdash; the request", [
      "Each endpoint with a valid token returns its documented status.",
      "No token &rarr; 401. Wrong permission &rarr; 403.",
      "Invalid body &rarr; 422 with <code>fields</code> populated.",
      "The transition your map gates as <code>approve</code> is refused for an <code>edit</code>-only role.",
      "An unknown id &rarr; 404 with the house error envelope.",
    ]),

    h2("Then prove it"),
    cmd(`npx jest onboarding-task            # your tests only, fast loop
npm run test:coverage               # must not drop the functions floor
npm run ci                          # all 33 gates`),

    ex("The QA note", "30 min",
      "<p>Write the QA note that ships with your PR: (1) what you tested and at which layer; (2) what you deliberately did <b>not</b> test, and why; (3) the riskiest thing about this change; (4) how a reviewer can verify it themselves in under five minutes. Keep it under 200 words &mdash; a note nobody reads has no value.</p>",
      "Tested: … / Not tested: … / Riskiest: … / Reviewer can: …"),

    val("<strong>Point (2) is the mark of a senior engineer.</strong> Anyone can list what they tested. Stating the gaps &mdash; knowingly, with reasons &mdash; is what lets a reviewer aim their attention, and it is the difference between a PR that gets rubber-stamped and one that gets genuinely reviewed."),

    dod(["Four layers written", "Coverage floor held", "<code>npm run ci</code> green", "QA note written", "Blind spots documented"]),
  ].join("\n")));

  // -------------------------------------------------------------- gate 2
  out.push(page("", `CHAPTER 6 &mdash; TESTING &amp; QA &nbsp;&middot;&nbsp; GATE 2`, [
    band("G2", "Gate 2 &mdash; End of Week Two", "<b>PROVE IT</b> &middot; BEFORE WEEK 3 OPENS &middot; SIGNED OFF BY YOUR LEAD", "qa"),
    lead("Two weeks in. You have read the system and you have added to it. This gate is about whether what you added is <b>defensible</b> &mdash; not whether it works, which you already know."),

    rgroup("G2.1", "Data", [
      "I can explain all five migration gates and what each refuses.",
      "I broke each one on purpose and can quote its error message.",
      "I can explain the three-layer identifier defence and why any one layer alone is insufficient.",
      "I can explain <code>atomically()</code>, the depth counter, and why the SAVEPOINT probe exists.",
      "My migration passes all five gates and has a full house-style header with a <code>-- DOWN</code> block.",
    ]),
    rgroup("G2.2", "The module", [
      "Eight files, mounted on boot, all six endpoints working.",
      "I can justify my <code>TRANSITION_ACTION</code> map, including what the unlisted default is and why that direction is safe.",
      "I can name every mock in my tests and state its blind spot.",
      "<code>npm run ci</code> is green and <b>I weakened nothing</b> to get there.",
      "I can explain why my module's owner default differs from <code>lead</code>'s &mdash; and that it is a domain decision, not a style one.",
    ]),
    rgroup("G2.3", "Demonstrate to your lead", [
      "<b>Walk your module end to end</b> in ten minutes.",
      "<b>Show the six deliberate failures</b> and their status codes and error codes.",
      "<b>Defend one decision</b> your lead disagrees with &mdash; or concede it, with a reason.",
      "Show the QA note, including what you deliberately did not test.",
    ]),

    quiz("Your module works locally, but <code>npm run ci</code> fails on a gate you have never seen before and do not understand. What is the correct move?",
      ["Skip the hook with <code>--no-verify</code> and fix it after the merge",
       "Comment out the failing test and open a ticket",
       "Read that gate's own script in <code>scripts/</code> to learn which invariant it protects, then fix the cause it is pointing at",
       "Ask your lead to lower the threshold so the branch goes green"],
      2,
      "Every one of the 33 gates exists because something broke once, and the gate's source is the shortest honest explanation of what it protects &mdash; usually a few dozen readable lines. <code>--no-verify</code> is forbidden by house rules. Lowering a threshold to go green is worse than it looks: it converts a ratchet into a suggestion, and it does so silently, for everyone who comes after you."),

    dod(["Migration through all five gates", "Module green", "Tests at four layers", "QA note written", "Lead signed off"]),

    callout("<strong>Week 2 done.</strong> You have written a migration a stranger can trust, a module that follows a shape 131 others follow, and tests that would catch a real regression. Next week the same feature grows a face, a background job and an AI surface &mdash; and you find out whether the layering you chose actually holds up.", "green"),
  ].join("\n")));

  return out;
}
