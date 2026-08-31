import {
  page, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
  setChapter,
} from "./kit.mjs";

const F = (s) => `CHAPTER 11 &mdash; CI, DEPLOY &amp; ROLLBACK &nbsp;&middot;&nbsp; ${s}`;

export function chapter() {
  setChapter(11);
  const out = [];

  out.push(page("", F("THE DEVOPS HALF"), [
    band("11", "CI, Deploy &amp; Rollback", "WEEK 4 &middot; <b>TEACH + DRILL</b> &middot; ~6 HOURS &middot; <b>THE DEVOPS HALF</b>"),
    lead("You can build the thing. This week is about getting it in front of clients and getting it back out again when it is wrong. Almost every lesson here was written down after something went badly, which is why the comments in these two shell scripts read like an incident report. They are."),

    h2("The zero-downtime sequence"),
    val("<code>scripts/deploy.sh</code> lists its own eight steps in the header, and it says plainly: <strong>&ldquo;Order matters for the zero-downtime window.&rdquo;</strong>"),
    lete([
      ["1", "<b>Record what is currently running</b>, so it can be rolled back to."],
      ["2", "<b>Back up the database</b> &mdash; <i>before</i> migrations, which have no down path."],
      ["3", "<b>Build new images, tagged with the commit.</b>"],
      ["4", "<b>Run migrations</b> &mdash; additive by convention, so old code keeps working mid-deploy."],
      ["5", "<b>Restart the STANDBY api first</b>, and wait until READY."],
      ["6", "<b>Restart the PRIMARY api</b> &mdash; nginx fails over to the standby (a backup upstream) for the few seconds it is down, then traffic returns."],
      ["7", "<b>Restart the worker</b> &mdash; queue downtime is invisible to users."],
      ["8", "<b>Verify READINESS, not just liveness.</b>"],
    ]),

    callout("<strong>Step 4 is the load-bearing convention.</strong> &ldquo;Additive by convention&rdquo; is what makes steps 5 and 6 possible at all: for a few seconds, old code and new schema are running against each other. If your migration drops a column, that window is an outage. <b>Every migration you write is implicitly a promise about the deploy window</b> &mdash; and you now know why the destructive-migration gate exists.", "gold"),

    h2("Step 8, and the endpoint that could not fail"),
    cmd(`HEALTH_URL="\${HEALTH_URL:-http://localhost:3000/api/health/ready}"`),
    bl([
      "<code>/api/health</code> is <b>liveness</b> &mdash; the process is up. No dependencies touched.",
      "<code>/api/health/ready</code> is <b>readiness</b> &mdash; it probes Postgres, Redis and module loading, and returns 503 when any fails.",
      "The deploy gate uses <b>readiness</b>. That is the whole point of having two.",
    ]),
  ].join("\n")));

  // ---------------------------------------------------------- four disasters
  out.push(page("", F("FOUR THINGS THAT WENT WRONG"), [
    h1("What This Script Used To Do"),
    lead("The header lists four past behaviours and why each was a problem. Read all four; they are four different species of operational mistake, and you will meet every one of them somewhere in your career."),

    h2("1. <code>docker image prune -f</code> on every deploy"),
    callout("&ldquo;Ran on every deploy and deleted the previous image. <b>The only artifact you could have rolled back to was destroyed by the very thing that might need rolling back.</b> There was no rollback path at all &mdash; not a slow one, none.&rdquo;", "red"),
    val("A tidy-up step, added for good reasons about disk space, quietly removed the organisation's ability to recover. <strong>Housekeeping that deletes your last known-good state is not housekeeping.</strong> The fix: <code>KEEP_IMAGES=5</code> &mdash; &ldquo;enough to step back more than once during a bad afternoon; few enough not to fill the disk.&rdquo;"),

    h2("2. No backup before migrations"),
    bl([
      "&ldquo;Migrations ran against production with no dump taken first, <b>and there is not one down-migration in the repo</b> (DATA 3.5). A bad migration was unrecoverable.&rdquo;",
      "Now: <code>BACKUP_DIR=./backups</code>, <code>BACKUP_KEEP=14</code>, taken at step 2 &mdash; <b>before</b> anything touches the schema.",
    ]),

    h2("3. The health check that could not fail"),
    callout("&ldquo;<code>curl /api/health</code> was the final gate. That endpoint returned <code>{ok:true}</code> <b>unconditionally</b> and never touched the database, so <b>a container that could not reach Postgres passed the gate and the deploy printed &lsquo;deploy ✓&rsquo;</b>.&rdquo;", "red"),
    val("<strong>A gate that cannot fail is not a gate; it is a ritual.</strong> This is the operational twin of &ldquo;a warning is not a gate&rdquo; from Chapter 6, and of the coverage threshold that would have been satisfied by importing files. Whenever you add a check, the very next thing to do is <b>break the system on purpose and confirm the check goes red</b>. If you have never seen it fail, you do not know that it can."),

    h2("4. Untagged images"),
    bl([
      "&ldquo;Everything was <code>latest</code>; nothing identified which commit was running.&rdquo;",
      "During an incident the first question is always <i>what is actually deployed right now?</i> With <code>latest</code>, there is no answer &mdash; only inference.",
      "Now every image is tagged with its commit, and <code>.deploy-state/</code> records the history.",
    ]),

    h2("Deploys are announced and attributed"),
    val("Audit OBS-I5: &ldquo;Deploys were unattributed and unannounced: nothing recorded who deployed what.&rdquo; The script now announces them. <strong>In an incident, &ldquo;what changed and who changed it&rdquo; is the fastest route to a cause</strong>, and it is nearly free to record at deploy time and nearly impossible to reconstruct afterwards."),

    quiz("Which of these four failures would have been caught by a code review of <code>deploy.sh</code>?",
      ["All four — they are visible in the script",
       "Arguably none: each line is individually reasonable, and the defects are in what the script assumes about other things — the health endpoint's contents, the absence of down-migrations, what prune deletes",
       "Only the missing backup",
       "Only the untagged images"],
      1,
      "This is the same shape as NEW-04's wrong import: the bug lives in a relationship between artefacts, not inside one of them. <code>curl /api/health</code> is a perfectly sensible line &mdash; it is wrong only because of what that endpoint returned. Reviewing a file is not the same as reviewing a system."),
  ].join("\n")));

  // ---------------------------------------------------------- rollback
  out.push(page("", F("ROLLBACK"), [
    h1("<code>rollback.sh</code> &mdash; Read It Before You Need It"),
    lead("The script says so itself, twice: &ldquo;Read that file before you need it, not while you need it&rdquo;, and &ldquo;the worst time to learn what a rollback does to your database is halfway through one.&rdquo;"),

    cmd(`bash scripts/rollback.sh              # back to the previous build
bash scripts/rollback.sh <commit-sha> # back to a specific one
bash scripts/rollback.sh --list       # what can I roll back to?`),

    h2("The warning at the top of the file"),
    callout("<strong>⚠ THE DATABASE IS THE HARD PART ⚠</strong><br><br>&ldquo;This script rolls back <b>CODE</b>. It does not, and cannot safely, roll back the <b>SCHEMA</b>, because <b>there is not one down-migration in this repository</b> (audit DATA 3.5 &mdash; &lsquo;no migration is reversible&rsquo;, <b>still open</b>).&rdquo;", "red"),

    h2("So when is a rollback safe?"),
    table("mst", ["Situation", "Safe?", "Why"], [
      ["The deploy's migrations were <b>additive</b> &mdash; new tables, new nullable columns, new indexes", "<b>Yes</b>", "&ldquo;The old code simply ignores them. This is the normal case and the convention the repo already follows.&rdquo;"],
      ["The deploy <b>dropped or renamed</b> anything", "<b>No</b>", "&ldquo;Old code will query a column that no longer exists.&rdquo;"],
      ["The deploy <b>backfilled destructively</b>", "<b>No</b>", "The data the old code expects is gone."],
    ]),

    h2("And if it is not safe"),
    val("&ldquo;The database must be restored from the pre-deploy dump &mdash; which <code>deploy.sh</code> now always takes &mdash; and that means <strong>accepting the loss of every write since the deploy</strong>. <b>That is a decision for a human, so this script will not make it.</b>&rdquo;"),

    callout("<strong>That last sentence is a design principle for every operational tool you will ever build.</strong> The script automates everything that has a correct answer, and stops dead at the point where the answer is a business trade-off &mdash; how many hours of client data are we willing to lose? A tool that made that call automatically would be faster and catastrophically wrong. <b>Automate the mechanism; escalate the judgement.</b>", "gold"),

    h2("The honest open finding"),
    bl([
      "&ldquo;still open&rdquo; is written directly into the script's header.",
      "DATA 3.5 has not been fixed. The team knows, the constraint is documented, and the tooling is built to be safe <i>given</i> it.",
      "<b>This is how mature teams carry debt</b>: named, visible at the point of risk, with the mitigation attached &mdash; not hidden in a backlog nobody opens during an incident.",
    ]),

    quiz("A deploy at 14:00 added a nullable column and shipped a bug. It is 14:20. What do you do?",
      ["Restore the pre-deploy database dump",
       "Roll back the code only — the migration was additive, so old code ignores the column and no data is lost",
       "Fix forward; rollback is always riskier",
       "Roll back code and manually drop the column"],
      1,
      "This is the normal case the convention exists to enable, and it is why &ldquo;additive by convention&rdquo; matters so much. Option 1 needlessly discards twenty minutes of client writes. Option 4 turns a safe code rollback into an unsafe schema change under pressure &mdash; leave the column; it is harmless."),
  ].join("\n")));

  // ---------------------------------------------------------- 33 gates
  out.push(page("", F("THE 33 GATES"), [
    h1("<code>npm run ci</code> &mdash; All Of It"),
    lead("<code>scripts/ci-local.js</code> is the authoritative list, and the same list runs locally and in CI. That is not a coincidence &mdash; it is the point."),

    h2("Backend &mdash; 19 gates"),
    table("mst", ["Group", "Gates"], [
      ["Style &amp; types", "Lint (<code>--max-warnings 136</code>) &middot; Font gate"],
      ["Correctness", "Test (jest) &middot; jest.mock hoisting &middot; No new silent catches"],
      ["Config", "Env template matches the schema"],
      ["Migrations", "Numbering &middot; Reversibility &middot; Idempotency &middot; Destructive declared &middot; Schema drift"],
      ["SQL", "Query columns exist &middot; citext[] reads are cast &middot; No hardcoded FX literals"],
      ["API surface", "API docs in sync &middot; Write routes are validated &middot; API contract &middot; Response-contract drift"],
      ["Data integrity", "Actor FK guard"],
    ]),

    h2("Frontend &amp; console &mdash; 14 gates"),
    table("mst", ["Group", "Gates"], [
      ["Style", "Lint (client, <code>--max-warnings 112</code>) &middot; Raw-palette gate"],
      ["Design system", "Design-token contrast &middot; Motion budget &middot; <b>Frontend guide is not lying</b>"],
      ["Correctness", "Test (vitest) &middot; Build (tsc + vite) &middot; Bundle graph"],
      ["Contracts", "Shared schema package &middot; Shared-schema gate"],
      ["Console", "Lint / Test / Build (platform-console)"],
    ]),

    h2("Three properties worth copying"),
    lete([
      ["1", "<b>Local and CI run the same script.</b> No &ldquo;works on my machine, fails in CI&rdquo; class of problem, and no separate CI config drifting from reality."],
      ["2", "<b>Ratchets, not walls.</b> 136 warnings, 112 warnings, 13% functions, a silent-catch baseline. Every one grandfathers the past and blocks regression. <b>None of them could have been introduced as an absolute rule</b> &mdash; the work to reach zero has never been funded, and a gate nobody can pass gets deleted."],
      ["3", "<b>Gates encode incidents.</b> Almost every entry above traces to a specific defect. That is what makes the list defensible: nobody is guessing at good practice."],
    ]),

    cmd(`npm run ci          # everything (what CI runs)
npm run ci:fast     # the quick subset, for a tight loop
npm run ci:backend  # backend only
npm run ci:frontend # frontend only`),

    callout("<strong>Use <code>ci:fast</code> while you work and <code>ci</code> before you push.</strong> A verification loop you skip because it is slow provides zero assurance. The split exists so the honest thing is also the convenient thing &mdash; the same philosophy as the front-end paved road, applied to your own workflow.", "green"),
  ].join("\n")));

  // ---------------------------------------------------------- incidents
  out.push(page("", F("INCIDENTS"), [
    h1("When It Breaks In Production"),
    lead("<code>doc/INCIDENT_RUNBOOK.md</code> defines four severities. Knowing which one you are in determines everything that follows &mdash; who you wake, how fast you act, and how much process you skip."),

    table("mst", ["Sev", "Meaning", "Response"], [
      ["<b>SEV-1</b>", "Total outage, data loss, or a security breach", "Immediate, all hands, client comms within the hour"],
      ["<b>SEV-2</b>", "A major function broken for many users; no workaround", "Same day, named owner, client informed"],
      ["<b>SEV-3</b>", "Degraded or broken for some; a workaround exists", "Next business day, tracked"],
      ["<b>SEV-4</b>", "Cosmetic or minor; no functional impact", "Normal backlog"],
    ]),

    h2("The first five minutes"),
    lete([
      ["1", "<b>What changed?</b> Check the deploy announcements and <code>.deploy-state/</code>. Most incidents are the last deploy."],
      ["2", "<b>Readiness, not liveness.</b> <code>curl /api/health/ready</code>. Which dependency is red?"],
      ["3", "<b>Scope it.</b> One tenant or all of them? A tenant-specific fault is a data or config problem; a global one is code or infrastructure."],
      ["4", "<b>Decide: roll back or fix forward.</b> Additive migrations &rArr; rollback is cheap and safe. Otherwise it is a human decision about data loss."],
      ["5", "<b>Communicate before you are certain.</b> &ldquo;We are investigating, next update in 30 minutes&rdquo; buys more goodwill than an hour of silence followed by a perfect diagnosis."],
    ]),

    h2("Operational commands"),
    cmd(`npm run ops:status         # queues, workers, connections
npm run ops:uptime         # the probe's view
npm run ops:alert-test     # prove the alert path works BEFORE you need it
npm run ops:sweep          # scheduled maintenance sweep
npm run db:backup:status   # is the last backup real and recent?
npm run db:restore:drill   # restore into a scratch database and verify`),

    callout("<strong><code>db:restore:drill</code> is the most underrated command in the repository.</strong> A backup you have never restored is a hypothesis. This script tests it &mdash; and the reason the repo has it as a first-class npm script, rather than a paragraph in a runbook, is that anything requiring a human to remember to do it quarterly does not get done. <b>The same logic as <code>ops:alert-test</code>: verify the recovery path on a calm day.</b>", "gold"),

    h2("Writing the post-incident note"),
    bl([
      "<b>Timeline</b> with real timestamps &mdash; detection, diagnosis, mitigation, resolution.",
      "<b>Client impact</b> in the client's terms: which tenants, which function, how long.",
      "<b>Root cause</b>, following it past the first plausible answer.",
      "<b>What made it hard to find</b> &mdash; often the most valuable section, and the one that produces the next gate.",
      "<b>Actions</b>, each with an owner and a date. &ldquo;Be more careful&rdquo; is not an action.",
    ]),
    val("<strong>Notice that this repo's comments <i>are</i> post-incident notes.</strong> The <code>trust proxy</code> comment, the CORS story, NEW-04, SEC H1, F5 &mdash; each is a timeline, a root cause, and a fix, written where the next engineer will actually encounter it. That is the house style, and you are now expected to write in it."),
  ].join("\n")));

  // ---------------------------------------------------------- lab
  out.push(page("", F("LAB 10 &mdash; THE DRILL"), [
    band("L11", "Lab &mdash; Deploy, Break, Roll Back", "WEEK 4 &middot; <b>HANDS ON</b> &middot; ~2.5 HOURS &middot; SANDBOX ONLY", "lab"),
    lead("Rehearse the emergency while nothing is on fire. Everything here runs against a sandbox environment &mdash; see <code>doc/SANDBOX_TESTING.md</code>. Confirm with your onboarding lead which environment you are pointed at <b>before</b> you run anything."),

    rgroup("10.1", "Read first", [
      "Read <code>scripts/deploy.sh</code> end to end. All of it.",
      "Read <code>scripts/rollback.sh</code> end to end. All of it.",
      "Read <code>doc/DEPLOYMENT.md</code> and <code>doc/BRANCH_PROTECTION.md</code>.",
      "Write down the one step you are least sure about, and ask about it.",
    ]),
    rgroup("10.2", "Deploy", [
      "Deploy your module to sandbox with <code>bash scripts/deploy.sh</code>.",
      "Watch each of the eight steps. Note the wall-clock time of each.",
      "Confirm the image is tagged with your commit, and that a backup was written.",
      "Confirm the readiness check passed <i>and</i> that you know what it actually probed.",
    ]),
    rgroup("10.3", "Break it deliberately", [
      "Stop Postgres. Hit <code>/api/health</code> &mdash; what does liveness say?",
      "Hit <code>/api/health/ready</code> &mdash; what does readiness say?",
      "<b>This is the OBS-A2 finding, reproduced by your own hands.</b> Record both responses.",
      "Restart Postgres and confirm readiness recovers by itself.",
    ]),
    rgroup("10.4", "Roll back", [
      "<code>bash scripts/rollback.sh --list</code> &mdash; what can you go back to?",
      "Roll back to the previous build.",
      "Verify the old version is serving, and confirm your additive migration is still present and harmless.",
      "Time the whole thing. <b>Write the number down.</b>",
    ]),

    ex("The drill report", "40 min",
      "<p>Write it as though for the team: time to deploy; time to detect (from breaking Postgres to noticing); time to roll back; exactly what liveness and readiness each returned with the database down; and <b>one improvement you would make to either script</b>, with your reasoning. Bring this to Gate 4.</p>",
      "Deploy: … / Detect: … / Roll back: … / Liveness: … / Readiness: … / Improvement: …"),

    callout("<strong>&ldquo;Time to roll back&rdquo; is the number that matters most</strong>, and almost no team knows theirs. It is the difference between a five-minute blip and a forty-minute outage, and it is entirely determined by rehearsal. You now know yours.", "green"),

    dod(["Both scripts read in full", "Deployed to sandbox", "Readiness failure observed first-hand", "Rollback completed and timed", "Drill report written"]),
  ].join("\n")));

  return out;
}
