import {
  page, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
  setChapter,
} from "./kit.mjs";

const F = (s) => `CHAPTER 12 &mdash; PROMPTING THE AGENTS &nbsp;&middot;&nbsp; ${s}`;

export function chapter() {
  setChapter(12);
  const out = [];

  out.push(page("", F("THREE TOOLS, ONE SKILL"), [
    band("12", "Prompting The Agents", "WEEK 4 &middot; <b>TEACH + BUILD</b> &middot; ~6 HOURS &middot; <b>THE MULTIPLIER</b>"),
    lead("Claude Code, Arena and Jules. Three products, three execution models, one underlying skill: giving an agent enough context to do the work and enough scaffolding to <b>prove</b> it did the work. Everything in the first ten chapters &mdash; the gates, the tests, the conventions &mdash; is what makes agents useful here. This chapter is why."),

    h2("The three, honestly compared"),
    table("mst", ["", "Claude Code", "Arena Agent Mode", "Jules"], [
      ["Vendor", "Anthropic", "Arena.ai", "Google Labs"],
      ["Execution", "Synchronous, your terminal", "Session workspace on a cloned repo", "Asynchronous, Google Cloud VM"],
      ["Where code lives", "Your working directory", "A copy of your repo in the session", "A cloned checkout in a remote VM"],
      ["Output", "Edits in your tree; commits and PRs if you ask", "Commits to a working branch, opens a PR", "A pull request per task"],
      ["Steering", "Continuous", "Conversational, mid-session", "Plan approval up front, limited after"],
      ["Config file", "<code>CLAUDE.md</code>", "<code>AGENTS.md</code>", "<code>AGENTS.md</code>"],
      ["Best at", "The one hard thing you must think about", "Repo-scoped work reviewed as a PR", "A queue of small, independent changes"],
    ]),

    callout("<strong>The split is natural, not competitive.</strong> Jules takes the queue of small, independent, low-risk changes &mdash; dependency bumps, test coverage, lint fixes. Claude Code takes the one hard thing that needs a human in the loop. Arena sits where you want repo-scoped work that arrives as a reviewable pull request. Learn all three; they touch different parts of your day.", "green"),

    h2("The one skill"),
    flow([
      { t: "EXPLORE", b: "make it read before it writes" },
      { t: "PLAN", b: "get the approach agreed <b>before</b> any code" },
      { t: "CODE", b: "small, scoped, one concern" },
      { t: "VERIFY", b: "<b>always give it a way to check itself</b>" },
    ]),

    val("<strong>Explore &rarr; Plan &rarr; Code &rarr; Verify.</strong> Anthropic's own guidance for Claude Code, and it transfers unchanged to the other two. The single most common failure is skipping straight to Code &mdash; and the second most common is skipping Verify, which is the step this codebase is unusually well equipped for."),

    h2("Why praxis-ls is a good agent environment"),
    bl([
      "<b>33 gates</b> that exit non-zero. An agent can run <code>npm run ci</code> and know, without asking you, whether it succeeded.",
      "<b>375 tests</b>, including structural ones that catch the &ldquo;declared, not called&rdquo; mistakes agents make often.",
      "<b>131 modules in one shape.</b> &ldquo;Follow the pattern in <code>sales/lead</code>&rdquo; is a complete, unambiguous specification.",
      "<b>Comments that explain why.</b> The agent reads the same rationale you do &mdash; and will not innocently undo a fix whose reason is written above it.",
    ]),
    callout("<strong>Turn that around and it becomes the real argument for everything in Chapters 4&ndash;10.</strong> Consistency, gates and rationale comments were always good practice for humans. They are now the difference between an agent that accelerates you and an agent that generates plausible work you have to check line by line.", "gold"),
  ].join("\n")));

  // ---------------------------------------------------------- prompts
  out.push(page("", F("WRITING THE PROMPT"), [
    h1("Specific Context Beats Polite Instructions"),
    lead("The published guidance is consistent across all three tools and across every practitioner report: vague prompts produce vague work, and the fix is not politeness or emphasis &mdash; it is <b>context and a success criterion</b>."),

    h2("Before and after"),
    table("mst", ["Vague", "Specific"], [
      ["&ldquo;Add tests for the lead module&rdquo;", "&ldquo;Test <code>lead.rules.js</code> for the transition out of a terminal state. Assert the error code and status. No mocks &mdash; the file is pure.&rdquo;"],
      ["&ldquo;Fix the failing build&rdquo;", "&ldquo;<code>npm run ci</code> fails at &lsquo;Query columns exist&rsquo;. Run it, read the output, fix the query. Do not change the gate.&rdquo;"],
      ["&ldquo;Make the list screen better&rdquo;", "&ldquo;<code>OnboardingTasksPage</code> is missing <code>emptyFiltered</code>. Add it following <code>ClientsPage</code>. Copy must differ from <code>empty</code>.&rdquo;"],
      ["&ldquo;Add a module for X&rdquo;", "&ldquo;Build <code>operations/x</code> following <code>src/modules/sales/lead/</code> exactly: same eight files, same layering. Table already exists as migration 00314. Run <code>npm run ci:backend</code> until green.&rdquo;"],
    ]),

    h2("Four things every good prompt contains"),
    lete([
      ["1", "<b>The exemplar.</b> A path to a file that already does this correctly. In this repo that is nearly always available, and it is worth more than three paragraphs of description."],
      ["2", "<b>The boundary.</b> What must <i>not</i> change. Agents are eager; scope creep is the default failure."],
      ["3", "<b>The verification.</b> The exact command that proves success. <code>npm run ci:backend</code>, <code>npx jest onboarding-task</code>, <code>npm run check:docs</code>."],
      ["4", "<b>The gotcha.</b> Anything non-obvious it cannot infer &mdash; snake_case folders, the lint ratchet, never <code>Promise.all</code> over <code>req.tenantDb</code>."],
    ]),

  ].join("\n")));

  out.push(page("", F("GUARD CLAUSES"), [
    h1("Guard Clauses Worth Keeping On Hand"),
    lead("Four paragraphs you will paste more often than any code snippet in this workbook."),

    cmd(`# Over-eagerness
"Don't add features, refactors, or 'improvements' beyond what I asked for.
 If you think something else needs doing, tell me — don't do it."

# Reversibility and safety
"Ask before any destructive or shared-system action. Never use --no-verify.
 Never weaken a gate to make it pass."

# Anti-test-hardcoding
"Implement the general algorithm. The tests verify the behaviour; they do not
 define it. Do not special-case inputs to make a test pass."

# Verification
"After each change, run: npm run ci:backend. Paste the output. If it fails,
 fix the cause, not the check."`),

    callout("<strong>&ldquo;Never weaken a gate to make it pass&rdquo; is the single highest-value sentence you can put in a prompt in this repository.</strong> An agent facing <code>--max-warnings 136</code> with 137 warnings has two ways to make the command exit zero, and one of them takes one character. It is doing what you asked. You have to say which kind of green you want.", "red"),

    h2("Give it a way to see"),
    bl([
      "Reference files with <code>@</code> so it reads rather than guesses.",
      "Pipe evidence in: <code>cat error.log | claude</code>. Paste the failing output, not your summary of it.",
      "Paste screenshots for front-end work &mdash; a visual target is a verification loop.",
      "<b>The general principle: an agent with a way to check its own work behaves completely differently from one without.</b>",
    ]),

    quiz("Your agent's change makes <code>npm run ci</code> pass by adding <code>eslint-disable</code> comments. What went wrong in your prompt?",
      ["Nothing — the gate passes",
       "You specified the command but not what counts as legitimately passing; the agent optimised the metric you gave it",
       "The model is too weak for this task",
       "You should not let agents run lint"],
      1,
      "This is Goodhart's law with a shell exit code. You asked for &ldquo;exit 0&rdquo; and got it. State the intent (&ldquo;fix the warnings; do not suppress them; do not raise the ratchet&rdquo;) and the same model produces the right work. Nearly every disappointing agent result traces back to an unstated success criterion."),
  ].join("\n")));

  // ---------------------------------------------------------- AGENTS.md
  out.push(page("", F("AGENTS.md"), [
    h1("The Config File &mdash; And How To Get It Wrong"),
    lead("<code>AGENTS.md</code> is the emerging cross-tool standard; Jules and Arena read it, and Claude Code has its own <code>CLAUDE.md</code>. This repository currently has <b>neither</b>, which makes writing one an excellent Week 4 contribution &mdash; provided you write it correctly."),

    callout("<strong>The research finding you must know first:</strong> in a published evaluation, an <b>LLM-generated <code>AGENTS.md</code> reduced task success in five of eight settings and added 2.45&ndash;3.92 extra steps</b> per task. Asking an agent to write its own instructions produces a plausible, comprehensive, actively harmful document. <b>Write it by hand.</b>", "red"),

    h2("Why bloat hurts"),
    bl([
      "The file is loaded <b>every session</b>, consuming context before any work starts.",
      "Anthropic's guidance is to keep <code>CLAUDE.md</code> <b>under about 200 lines</b>; the wider <code>AGENTS.md</code> convention lands around 150.",
      "<b>A bloated file causes rules to be ignored</b> &mdash; including the three that actually mattered.",
      "Include only what the model <b>cannot infer</b>: commands, non-default conventions, gotchas, environment quirks, repo etiquette.",
    ]),

    h2("What belongs in this repo's file"),
    table("mst", ["Section", "Content"], [
      ["<b>Commands, first</b>", "<code>npm run dev</code>, <code>ci</code>, <code>ci:fast</code>, <code>ci:backend</code>, <code>setup:local</code>, <code>db:migrate:tenants</code>. Lead with these &mdash; they are the highest-value lines."],
      ["<b>File-scoped checks</b>", "<code>npx jest &lt;file&gt;</code> beats a full run. Prefer checks an agent can run in seconds and repeat."],
      ["<b>Exemplars</b>", "&ldquo;Backend module: <code>src/modules/sales/lead/</code>. List screen: <code>ClientsPage</code>. Migration: <code>12743_hr_contract_doc_number.sql</code>.&rdquo;"],
      ["<b>Do / Don't</b>", "Snake_case module folders. No SQL outside <code>.repo.js</code>. Never <code>Promise.all</code> over <code>req.tenantDb</code>. Never raise a ratchet."],
      ["<b>Safety split</b>", "Allowed unprompted: read, lint, test, build. Ask first: installs, <code>git push</code>, deletes, migrations, anything touching a shared environment."],
      ["<b>Escape hatch</b>", "&ldquo;If you are stuck or the instructions conflict with the code, stop and ask &mdash; or propose a plan. Do not guess.&rdquo;"],
    ]),

    h2("And treat it as code"),
    bl([
      "Update it <b>in the same PR</b> as the convention it describes. A stale <code>AGENTS.md</code> is F5 all over again, aimed at a machine.",
      "<b>Never put secrets in it.</b> It is read by remote agents on cloud VMs.",
      "Nested per-directory files are supported for monorepos &mdash; <code>client/AGENTS.md</code> could carry the eleven frontend gates.",
    ]),

    callout("<strong>Notice that a good <code>AGENTS.md</code> is just this workbook, compressed to 150 lines for a reader with no memory.</strong> If you cannot write it after finishing this document, that is useful information about which chapter to reread. If you can, you have understood the codebase &mdash; which is exactly why it is the Week 4 task.", "gold"),
  ].join("\n")));

  // ---------------------------------------------------------- workflows
  out.push(page("", F("THREE WORKFLOWS"), [
    h1("Working With Each Tool"),

    h2("Claude Code &mdash; synchronous, supervised"),
    lete([
      ["1", "<b>Plan mode first</b> (Shift+Tab). Make it produce the approach before it writes anything. Argue with the plan; that conversation is cheap and the code is not."],
      ["2", "<b>Checkpoint with git.</b> The reported team pattern is &ldquo;save state, let it run 30 minutes, then accept or start fresh&rdquo; &mdash; starting fresh is a normal outcome, not a failure."],
      ["3", "<b>Classify the task.</b> Async and auto-accept for peripheral work; synchronous supervision for core business logic. In this repo, that maps cleanly: a test file, yes; <code>action-authz.js</code>, watch every line."],
      ["4", "<b>Custom slash commands</b> for anything you do twice."],
      ["5", "Anthropic's own honest number: <b>one-shot works about a third of the time.</b> Plan for iteration."],
    ]),

    h2("Arena Agent Mode &mdash; repo-scoped, PR-delivered"),
    bl([
      "With a repository connected, the assistant works <b>in a copy of your repo</b>, commits to a working branch, and opens a pull request.",
      "Review the changes in the <b>Diff tab</b>, then merge or pull that branch.",
      "<b>Once the pull request is merged or closed, the session can no longer push.</b> Anything created after that stays in the session and cannot be pushed, downloaded, or carried into a new session.",
      "<b>So: push before you merge, and start a fresh session for new work.</b> That is a real operational rule, not a detail.",
      "With no repository connected, files live in the session workspace and are downloaded as a zip.",
    ]),
    callout("<strong>The branch-scoped session model is a feature, not a limitation.</strong> It forces the same discipline as branch protection: work arrives as a reviewable diff on a branch, and merging is a deliberate human act that closes the session. It fits this repo's <code>BRANCH_PROTECTION.md</code> workflow exactly.", "green"),

    h2("Jules &mdash; asynchronous, plan-gated"),
    lete([
      ["1", "Point it at a GitHub repository and branch, and describe <b>one specific task</b>."],
      ["2", "It clones into a cloud VM, then <b>writes a plan and waits for your approval</b>. Read the plan properly &mdash; if you wander off, a timer may auto-approve it."],
      ["3", "It executes in the background, runs your tests, and opens a PR. You review it like any teammate's."],
      ["4", "Best for: <b>test generation, bug fixes from a symptom, dependency bumps, documentation</b>. Worst for: anything needing continuous steering."],
      ["5", "Practitioner consensus: async agents need <b>validation loops, tests, and issues broken into small chunks with the where and why stated.</b> That is a description of this repository."],
    ]),

    val("<strong>The common thread.</strong> All three deliver a diff you must review. None of them removes your responsibility for the code &mdash; and the review is where your Chapters 1&ndash;10 knowledge earns its keep. <strong>An agent makes a competent engineer faster; it makes an engineer who cannot review the output dangerous.</strong>"),
  ].join("\n")));

  // ---------------------------------------------------------- review
  out.push(page("", F("REVIEWING AGENT WORK"), [
    h1("The Trust-Then-Verify Gap"),
    lead("The named anti-pattern. Agent output is fluent, well-formatted, confidently commented and frequently correct &mdash; which is exactly what makes the incorrect fraction so dangerous. Fluency is not evidence."),

    h2("Where agents fail in <i>this</i> codebase specifically"),
    table("mst", ["Failure", "How to catch it"], [
      ["<b>Declared, not called</b>", "It adds a middleware but does not mount it; a handler with no producer; a manifest entry with no catalogue row. <b>Run the wiring sweep.</b>"],
      ["<b>Plausible column names</b>", "It writes <code>client_type</code> because that is the obvious name. The real column is <code>client_type_id</code>. <b><code>npm run db:check:columns</code>.</b>"],
      ["<b>Mocking the interesting boundary</b>", "The test passes and proves nothing. <b>Read every <code>jest.mock</code> it added and ask what it hides.</b>"],
      ["<b>Silent catches</b>", "Defensive <code>try/catch</code> everywhere, all empty. <b>The silent-catch gate, and your own eyes.</b>"],
      ["<b>Weakening a gate</b>", "<code>eslint-disable</code>, a raised ratchet, a deleted assertion. <b>Read the diff for changes to config and test files, first.</b>"],
      ["<b>Layer violations</b>", "SQL in the service because it was two lines shorter. <b>Read the repo/service boundary in every diff.</b>"],
      ["<b>Fail-open defaults</b>", "A new state added to <code>NEXT</code> but not to <code>TRANSITION_ACTION</code>, with a permissive fallback invented. <b>Check the fail-closed direction.</b>"],
    ]),

    callout("<strong>Read the diff in this order, always:</strong> config files &rarr; test files &rarr; migrations &rarr; source. Config and test changes are where a green build gets manufactured, and they are the smallest, easiest part of the diff to skim past. If a &ldquo;fix the tests&rdquo; task changed the tests rather than the code, you need to know that in the first ten seconds.", "gold"),

    h2("The review questions"),
    req([
      "Did it change any gate, threshold, baseline or lint directive? <b>Why?</b>",
      "Does every new <code>catch</code> either handle, log, or carry a taxonomy marker?",
      "Is every new mock justified &mdash; and what would slip past it?",
      "Does the new code follow the eight-file layering, or has logic leaked?",
      "Are new lookup tables and defaults <b>fail-closed</b>?",
      "Is anything declared but not called? Run the sweep, do not eyeball it.",
      "Would I have written the migration header this way? Does it say what is lost?",
      "<b>Can I explain every line to my onboarding lead?</b> If not, it does not merge.",
    ]),

    val("<strong>That last question is the standard, and it is not negotiable.</strong> You are accountable for what you merge, regardless of what wrote it. &ldquo;The agent did it&rdquo; has never been an acceptable answer about a line of code, and it never will be."),
  ].join("\n")));

  // ---------------------------------------------------------- lab
  out.push(page("", F("LAB 11 &mdash; DELEGATE AND VERIFY"), [
    band("L12", "Lab &mdash; Delegate Something Real", "WEEK 4 &middot; <b>HANDS ON</b> &middot; ~3 HOURS", "lab"),
    lead("Three tasks, deliberately chosen so one should succeed, one should need iteration, and one should expose a limit. The deliverable is not the code &mdash; it is your <b>judgement</b> about when to delegate."),

    rgroup("11.1", "Task A &mdash; well-scoped (should succeed)", [
      "Ask an agent to add the db-layer tests for your repo's <code>list</code> filters.",
      "Give it: the exemplar test file, the file under test, and <code>npx jest onboarding-task</code> as the verification.",
      "<b>Record the prompt verbatim.</b>",
      "Review against the seven failure modes. Note anything you had to fix.",
    ]),
    rgroup("11.2", "Task B &mdash; needs iteration", [
      "Ask it to add a <code>?sort=</code> parameter to your list endpoint, matching <code>resolveSort</code> in the CRUD kit.",
      "Do <b>not</b> mention the allow-list requirement. See whether it discovers it.",
      "If it builds an <code>ORDER BY</code> from user input unguarded, <b>that is SEC H3 recurring</b> &mdash; record exactly how it got there.",
      "Then reprompt with the constraint and compare the two attempts.",
    ]),
    rgroup("11.3", "Task C &mdash; should expose a limit", [
      "Ask it to decide whether assigning a PENDING task should auto-advance it to IN_PROGRESS, and to implement its choice.",
      "This is a <b>product</b> decision with no right answer in the code.",
      "Record what it did: did it choose confidently, hedge, or ask?",
      "Write what this tells you about which decisions you may delegate.",
    ]),

    ex("The delegation memo", "45 min",
      "<p>Write the memo for the team: (1) the three prompts verbatim; (2) what each produced; (3) time spent prompting and reviewing versus your estimate of writing it yourself; (4) which of the seven failure modes you actually saw; (5) <b>your rule</b> for what you will and will not delegate in this codebase. Point (5) is the real output.</p>",
      "Prompts: … / Results: … / Time: … / Failures seen: … / My rule: …"),

    h2("Then write the file"),
    req([
      "Draft <code>AGENTS.md</code> for this repository. <b>By hand.</b> Under 150 lines.",
      "Commands first. Exemplar paths. Do/Don't. The safety split. The escape hatch.",
      "<b>Test it:</b> run Task A again in a fresh session with the file present. Did it need fewer corrections?",
      "Bring it to Gate 4. If it is good, it ships &mdash; and every engineer after you benefits.",
    ]),

    callout("<strong>This is the highest-leverage thing a new engineer can contribute in their first month.</strong> You have just read the whole codebase with fresh eyes and written down what confused you. That is precisely the perspective a good <code>AGENTS.md</code> requires, and precisely the perspective everyone loses after six months here.", "green"),

    dod(["Three tasks delegated and reviewed", "Failure modes recorded", "Delegation rule written", "<code>AGENTS.md</code> hand-written and tested"]),
  ].join("\n")));

  return out;
}
