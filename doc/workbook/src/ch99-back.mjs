import {
  page, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
} from "./kit.mjs";

const F = (s) => `JBS PRAXIS ENGINEERING WORKBOOK &mdash; ${s}`;

export function backMatter() {
  const out = [];

  // ------------------------------------------------------------- gate 4
  out.push(page("", F("GATE 4 &mdash; GRADUATION"), [
    band("G4", "Gate 4 &mdash; Graduation", "<b>THE FINAL GATE</b> &middot; SIGNED OFF BY YOUR ONBOARDING LEAD", "qa"),
    lead("The last gate, and the only one with a single deliverable: <b>the graduation PR</b>. Everything you built across four weeks, merged as one reviewable change, defended in person."),

    h2("The graduation PR contains"),
    req([
      "The migration from Lab 4B, with a full house-style header and a <code>-- DOWN</code> block.",
      "The eight-file module from Chapter 5, mounted and working.",
      "The four layers of test from Lab 6, plus your anti-drift test from Chapter 6.",
      "The list screen and create dialog from Lab 7, on the paved road.",
      "The background job and its scheduler from Lab 8, both halves.",
      "The AI action from Lab 9, with its adversarial authz test.",
      "<code>AGENTS.md</code>, hand-written, under 150 lines.",
      "A QA note, a drill report, and a delegation memo.",
    ]),

    h2("And it must be"),
    rgroup("G4.1", "Green", [
      "<code>npm run ci</code> passes &mdash; all 33 gates.",
      "<b>No gate weakened.</b> No raised ratchet, no <code>eslint-disable</code>, no deleted assertion, no <code>--no-verify</code>.",
      "The coverage floor holds.",
    ]),
    rgroup("G4.2", "Defensible", [
      "You can explain every line, including any an agent wrote.",
      "Every non-obvious decision is in a comment that says <b>why not the obvious alternative</b>.",
      "You can name what you deliberately did not do, and why.",
    ]),
    rgroup("G4.3", "Demonstrated live", [
      "<b>Walk the full vertical slice</b> &mdash; screen, API, service, SQL, job, copilot.",
      "<b>Show the four error states</b> as a user would meet them.",
      "<b>Show the ungranted user being refused</b> on the AI action.",
      "<b>Roll back your sandbox deploy</b>, and state your time-to-rollback.",
    ]),
    rgroup("G4.4", "Taught back", [
      "Teach one chapter's core idea to the next new engineer, for twenty minutes.",
      "Answer their questions without notes.",
      "<b>Log what you could not answer</b> &mdash; that list is your next month.",
    ]),

    dod(["PR open and green", "Every line defensible", "Slice demonstrated", "Rollback timed", "Taught back", "Lead signed off"]),

    callout("<strong>G4.4 is not a formality.</strong> Teaching is the only reliable test of understanding, and the questions a beginner asks are the ones that find the edge of what you actually know. Every engineer who passes this gate teaches the next one &mdash; that is how this document stays alive and how the standard survives the person who wrote it.", "green"),
  ].join("\n")));

  // ------------------------------------------------------------- principles
  out.push(page("", F("THE PRINCIPLES"), [
    h1("Twenty Things This Codebase Believes"),
    lead("Every one of these is a sentence you can trace to a file, and most of them to an incident. This is the page to reread when you are about to make a decision you have not made before."),

    h2("On safety"),
    lete([
      ["1", "<b>Fail closed.</b> The missing case is the safe case. Unlisted transition &rarr; <code>approve</code>; unmatched identifier &rarr; rejected; undeclared permission &rarr; does not run."],
      ["2", "<b>Visibly broken beats invisibly open.</b> Choose the failure someone will report within the hour."],
      ["3", "<b>Recording is not preventing.</b> A perfect audit trail of unauthorised actions is still unauthorised actions."],
      ["4", "<b>Never let a value become syntax.</b> Parameterise; validate identifiers in one place nobody can bypass."],
      ["5", "<b>Reject, do not silently drop.</b> A filter that is ignored returns <i>more</i> than asked for, and looks like success."],
    ]),

    h2("On verification"),
    lete([
      ["6", "<b>A warning is not a gate.</b> If it must not reach production, something must exit non-zero."],
      ["7", "<b>A gate that cannot fail is a ritual.</b> Break the system on purpose and watch it go red."],
      ["8", "<b>Every mock is an assumption you stopped checking.</b> Never mock the boundary the bug lives at."],
      ["9", "<b>Measure before you set a threshold.</b> A guessed number either blocks the first build or means nothing forever &mdash; and both end with the gate deleted."],
      ["10", "<b>Ratchets, not walls.</b> Baseline the past, block the regression, pay down opportunistically."],
    ]),

    h2("On design"),
    lete([
      ["11", "<b>One owner of the boundary.</b> Transactions, identifiers, mail sends, event emission &mdash; one place, so it cannot be forgotten."],
      ["12", "<b>Declared is not called.</b> Six shapes of it, one test suite to hunt them."],
      ["13", "<b>An abstraction people escape is worse than none.</b> Draw the boundary where screens genuinely agree."],
      ["14", "<b>One is a default, two is a question.</b> <code>LIMIT 2</code>, not <code>LIMIT 1</code>."],
      ["15", "<b>Make the correct thing the easy thing.</b> A generator beats a convention document, every time."],
    ]),

    h2("On people"),
    lete([
      ["16", "<b>Comments explain why not the obvious alternative.</b> That is the only comment worth writing."],
      ["17", "<b>Write down the cost of a trade-off at the point you make it</b>, or someone discovers it as a bug."],
      ["18", "<b>Automate the mechanism; escalate the judgement.</b> Rollback scripts stop where data loss begins."],
      ["19", "<b>Design the fix so the transition can be incremental</b>, and you will actually finish it."],
      ["20", "<b>Tell the client before they tell you.</b>"],
    ]),
  ].join("\n")));

  // ------------------------------------------------------------- commands
  out.push(page("", F("COMMAND REFERENCE"), [
    h1("Command Reference"),
    lead("The commands you will actually type. Keep this page open in Week 1."),

    h2("Running it"),
    cmd(`npm run setup:local -- --slug=smartls --name="Smart Logistics" --with-worker
npm run dev                 # API with reload
npm run start               # API
npm run worker              # BullMQ consumer
docker compose up -d        # the full stack
docker compose logs -f api  # follow the API`),

    h2("Database"),
    cmd(`npm run db:reset:local        # migrate platform + provision smartls
npm run db:migrate:platform
npm run db:migrate:tenants
npm run db:provision -- --slug=acme --name="Acme Logistics"
npm run tenant:create-admin -- --slug=acme --email=…
npm run platform:create-admin
npm run db:backup            npm run db:backup:status
npm run db:restore:drill     # restore into scratch and verify
npm run db:check:columns     npm run db:pgbouncer-auth`),

    h2("Verifying"),
    cmd(`npm run ci                   # all 33 gates
npm run ci:fast              # tight loop
npm run ci:backend           npm run ci:frontend
npx jest <pattern>           # one test file
npm run test:coverage        # the functions ratchet
npm run lint                 # --max-warnings 136

cd client && npm run lint check:contrast check:palette check:motion \\
                       check:docs check:shared check:schemas check:bundle
cd client && npm test && npm run build`),

    h2("Operating"),
    cmd(`npm run ops:status           # queues, workers, connections
npm run ops:uptime           npm run ops:alert-test
npm run ops:sweep
bash scripts/deploy.sh       # the eight steps
bash scripts/rollback.sh --list
bash scripts/rollback.sh [<sha>]
curl localhost:3000/api/health          # liveness
curl localhost:3000/api/health/ready    # readiness — the deploy gate`),

    h2("Building"),
    cmd(`cd client && node scripts/new-screen.mjs --area operations \\
  --name "Onboarding tasks" --path /onboarding-tasks --width wide
npm run docs:api             # regenerate API_REFERENCE + ERROR_CODES
npm run ai:reindex           npm run check:fonts`),
  ].join("\n")));

  // ------------------------------------------------------------- map
  out.push(page("", F("WHERE THINGS LIVE"), [
    h1("Where Things Live"),
    lead("The map. When you do not know where to look, start here."),

    table("mst", ["Path", "What is in it"], [
      ["<code>src/server.js</code>", "The middleware chain, in order. <code>async-safe</code> first, <code>errorHandler</code> last."],
      ["<code>src/routes/index.js</code>", "Health endpoints, the tenant chain, <code>mountTenantModules</code>."],
      ["<code>src/modules/&lt;group&gt;/&lt;module&gt;/</code>", "131 modules, 26 groups, eight files each. <b>Canonical: <code>sales/lead/</code></b>."],
      ["<code>src/shared/db/</code>", "<code>query-helpers.js</code> (SEC H3), <code>tx.js</code> (<code>atomically</code>)."],
      ["<code>src/shared/crud/</code>", "<code>resource.js</code> builders, <code>with-result.js</code>, the entity registry."],
      ["<code>src/shared/events/emit.js</code>", "<code>emitEvent</code>, <code>audit</code>, Watch-the-Watcher."],
      ["<code>src/shared/http/</code>", "Module loader, transition permissions, <code>async-safe</code>."],
      ["<code>src/middleware/</code>", "auth, rbac, tenant-context, idempotency, and eight more."],
      ["<code>src/jobs/</code>", "<code>workers.js</code>, <code>queue.js</code>, <code>corn-lock.js</code>, <code>handlers/</code> (44 files)."],
      ["<code>src/services/ai/</code>", "orchestrator, llm, action-registry, <b>action-authz</b>, redact, retrieval."],
      ["<code>client/src/components/</code>", "<code>list-page.tsx</code>, <code>ui/form.tsx</code>, <code>data-list.tsx</code>."],
      ["<code>client/src/lib/</code>", "<code>use-zod-form.ts</code>, <code>outbox.ts</code>, <code>api-client.ts</code>, <code>use-action.ts</code>."],
      ["<code>packages/shared/</code>", "Schemas shared by the API and the client. One definition."],
      ["<code>packages/brand/</code>", "Design tokens. The white-label layer."],
      ["<code>migrations/platform/</code> &middot; <code>tenant/</code>", "313 migrations. Tenant ones run on every schema."],
      ["<code>tests/security/</code>", "The anti-drift suite. Read <code>orphan-wiring-sweep</code> first."],
      ["<code>scripts/ci-local.js</code>", "<b>The authoritative gate list.</b>"],
      ["<code>scripts/deploy.sh</code> &middot; <code>rollback.sh</code>", "Read both before you need either."],
      ["<code>doc/</code>", "~140 documents. Start with <code>CONVENTIONS.md</code> and <code>ERROR_HANDLING.md</code>."],
    ]),

    h2("The documents that repay a full read"),
    bl([
      "<code>doc/CONVENTIONS.md</code> &mdash; the layer rules and the module contract.",
      "<code>doc/ERROR_HANDLING.md</code> &mdash; the two rules and the seven classes.",
      "<code>doc/FRONTEND_GUIDE.md</code> &mdash; the paved road, and the gate that keeps it honest.",
      "<code>doc/INCIDENT_RUNBOOK.md</code> &mdash; SEV-1 to SEV-4.",
      "<code>doc/TENANT_ONBOARDING_CHECKLIST.md</code> &mdash; the go-live checklist.",
      "<code>doc/SANDBOX_TESTING.md</code> &mdash; what the seed does and deliberately does not.",
      "<code>doc/DEPLOYMENT.md</code> &middot; <code>doc/BRANCH_PROTECTION.md</code> &mdash; how change reaches production.",
    ]),
  ].join("\n")));

  // ------------------------------------------ final exam + certificate
  out.push(page("", F("FINAL EXAMINATION &amp; CERTIFICATE"), [
    band("EX", "Final Examination", "<b>THE LAST THING</b> &middot; 20 QUESTIONS &middot; " + "80% TO PASS", "qa"),
    lead("One written examination, drawn at random from a bank covering all thirteen chapters. It is not a memory test: every question is about a decision this codebase made and why it made it. If you did the labs, you have already met all of it."),

    h2("Unlocking the examination"),
    val("Three conditions, tracked automatically as you work through the workbook. They are shown live below &mdash; the ticks appear as you satisfy them."),
    `<div class="lockbox" id="gateBox">
      <div class="lt">Examination Requirements</div>
      <div class="lreq"><i></i><span>Enter your name to enrol</span></div>
      <div class="lreq"><i></i><span>Read every page</span></div>
      <div class="lreq"><i></i><span>Complete every lab checklist</span></div>
      <div class="cta">
        <button id="examBtn" onclick="openExam()" disabled>Examination Locked</button>
      </div>
      <p style="font-size:8.2pt;color:var(--text-light);margin-top:9px;line-height:1.45" id="bestLine">Not yet attempted. 80% required to pass.</p>
    </div>`,

    h2("Your certificate"),
    val("Pass, and the workbook issues a certificate in your name carrying your score, the number of pages completed, and a reference number derived from your name and sitting. It downloads as a landscape A4 PDF."),
    `<div class="lockbox">
      <div class="lt">Certificate of Completion</div>
      <p style="font-size:8.5pt;line-height:1.5;color:var(--text-body);margin-bottom:4px">Issued to the name you enrolled with. Your <b>best</b> score is the one printed &mdash; re-sitting to improve it is study, not cheating, and a fresh set of questions is drawn each time.</p>
      <div class="cta">
        <button id="certBtn" class="alt" onclick="downloadCertificate()" disabled>Certificate Locked</button>
      </div>
    </div>`,

    callout("<strong>An honest note about the gate, since you are an engineer and will work this out anyway.</strong> All of this runs in your browser, and the progress record is a key in <code>localStorage</code>. You could open DevTools and mark everything complete in about fifteen seconds. <b>The gate is a study aid, not a security control</b>, and pretending otherwise to this audience would be exactly the kind of dishonest check Chapter 11 spends a page criticising. The certificate is worth what the work behind it is worth. Your onboarding lead signs Gate 4, and they will know.", "gold"),
  ].join("\n")));

  // ------------------------------------------------------------- end
  out.push(page("dark", F("THE END"), [
    `<div class="cover-content">
      <div class="cover-tag">// END OF WORKBOOK</div>
      <div class="cover-title"><h1>Now Go<br><span>Build Something</span></h1></div>
      <p class="cover-sub">You arrived able to write SQL. You can now read a 1,225-file codebase, build a feature through every layer of it, test it four ways, ship it, roll it back, delegate part of it to an agent and review what comes back, and put it in front of a client who has never seen it before.<br><br>That is the whole job. Everything after this is repetition, depth, and the particular problems of whichever system you are handed next &mdash; and most JBS Praxis projects follow this format, so you have already met most of it.<br><br>Two last things. <strong>Keep writing the comments that explain why not the obvious alternative</strong> &mdash; they are how this codebase taught you, and they are how you will teach the next person. And when you find the gate whose message is unhelpful, the document that is lying, or the workaround nobody wrote down: <strong>fix it, and say so.</strong> That is what everyone before you did, and it is the only reason any of this was learnable.</p>
      <div class="cover-bottom">
        <div class="cover-meta">JBS PRAXIS &mdash; ENGINEERING<br>THE ENGINEERING WORKBOOK<br>REFERENCE CODEBASE: PRAXIS LS<br>STRICTLY CONFIDENTIAL &mdash; JBS TEAM ONLY</div>
        <div class="cover-powered">Powered by<br><strong>JBS PRAXIS</strong></div>
      </div>
    </div>`,
  ].join("\n")));

  return out;
}
