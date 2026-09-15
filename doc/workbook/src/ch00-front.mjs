import {
  page, cover, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
  setChapter,
} from "./kit.mjs";

const F = (s) => `JBS PRAXIS ENGINEERING WORKBOOK &mdash; ${s}`;

export function frontMatter() {
  setChapter(0);
  const out = [];

  out.push(cover({
    tag: "// THE ENGINEERING WORKBOOK &mdash; WEEK 1 TO WEEK 4",
    kicker: "JBS Praxis &middot; Standard Operating Procedure for Engineers",
    title: "From Data\nto Full-Stack",
    titleAccent: "in One Month",
    sub: "The official onboarding bible for every engineer joining JBS Praxis. Not notes to read &mdash; a workbook to run. Every chapter is grounded in the Praxis LS codebase: 131 modules, 1,422 routes, 313 migrations, 375 test files and 33 CI gates. You will read the real code, break it on purpose, fix it, and ship it. Finish this and you can build a system of this class.",
    meta: "JBS PRAXIS &mdash; ENGINEERING\nREFERENCE CODEBASE: PRAXIS LS\n4 WEEKS &middot; 13 CHAPTERS &middot; WORKBOOK + PLAYGROUND\nFULL-STACK &middot; DEVOPS &middot; AI &amp; PROMPT ENGINEERING\nSTRICTLY CONFIDENTIAL &mdash; JBS TEAM ONLY",
    powered: "Powered by\n<strong>JBS PRAXIS</strong>",
  }));

  // ---------------------------------------------------------------- how to use
  out.push(page("", F("HOW TO USE THIS WORKBOOK"), [
    h1("How To Use This Workbook"),
    lead("This document is a working tool, not a manual. It has three kinds of page and four kinds of interactive block. Learn the shapes now and the next hundred pages will read themselves."),

    h2("The three page types"),
    cards([
      { name: "TEACH", role: "WHITE BAND · THE CONCEPT", color: "var(--fin)", items: [
        "Explains one idea, with real code from the repo",
        "Every claim points at a file you can open",
        "Ends with a self-check question" ] },
      { name: "LAB", role: "SLATE BAND · HANDS ON KEYBOARD", color: "var(--accent-gold)", items: [
        "You run commands and change files",
        "Expected output is printed so you can compare",
        "Deliberate breakage, then repair" ] },
      { name: "GATE", role: "GREEN BAND · PROVE IT", color: "var(--accent-green)", items: [
        "Checklist you must pass before moving on",
        "Mirrors the real CI gates the repo enforces",
        "Signed off by your onboarding lead" ] },
    ], true),

    h2("The four interactive blocks"),
    bl([
      "<b>Checklists</b> &mdash; every square box is clickable. Tick it and it stays ticked, even after you close the browser.",
      "<b>Answer boxes</b> &mdash; the dashed boxes are real text fields. Type in them. Your writing is saved locally.",
      "<b>Self-checks</b> &mdash; pick an option and it marks itself instantly, then explains <i>why</i>. Wrong answers teach more than right ones, so guess honestly.",
      "<b>Progress bar</b> &mdash; the teal line along the bottom of the window tracks every box, tick and question in the whole workbook.",
    ]),

    callout("<strong>Your work is saved in this browser only.</strong> It lives in <code>localStorage</code> under one key. Use the same browser and profile throughout the month. <b>Reset</b> in the top bar wipes it deliberately; nothing else will."),

    h2("How you finish it"),
    stack([
      ["Read every page", "The workbook notices which pages you have actually scrolled through. All of them must be seen before the final examination unlocks."],
      ["Tick every lab item", "Each square box in a LAB or GATE page is a task. The final examination stays locked until every one is ticked."],
      ["Sit the examination", "Twenty questions drawn at random from all thirteen chapters. 80% to pass, re-sit as often as you like, best score stands."],
      ["Collect the certificate", "Passing unlocks a PDF certificate in your name, carrying your score and a reference number."],
    ]),

    callout("<strong>Read this in order and do not skip the labs.</strong> The chapters build one system across four weeks. Chapter 9 assumes you built the module in Chapter 5. Skipping the keyboard work and reading only the prose is the single most reliable way to finish this document without gaining the ability it promises.", "gold"),
  ].join("\n")));

  // ---------------------------------------------------------------- first run
  out.push(page("", F("BEFORE YOU START — SETTING THIS UP"), [
    h1("Before You Start"),
    lead("Five minutes of setup, once. This page is about the workbook itself &mdash; where to keep the file, which browser to open it in, and how your progress survives being closed. Do this before Chapter 1, because a workbook that forgets your work is worse than paper."),

    h2("Step 1 — Put the file somewhere permanent"),
    bl([
      "Save <code>PRAXIS_ENGINEERING_WORKBOOK.html</code> to a real folder you own &mdash; <code>Documents/JBS Praxis/</code> is ideal. <b>Not</b> the Downloads folder, and not the Desktop.",
      "This matters more than it sounds. Your progress is keyed to the file's location. Move the file later and the browser treats it as a different document, and your ticks and answers will not follow it.",
      "Do not rename it. Do not keep two copies open in two tabs &mdash; the second one to save wins, and you will lose work.",
      "It is a single self-contained file. There is no folder of assets beside it, nothing to install, and it works with the wifi off.",
    ]),

    h2("Step 2 — Open it in Google Chrome"),
    stack([
      ["Windows", "Right-click the file → <b>Open with</b> → <b>Google Chrome</b>. Then tick <i>Always use this app</i>."],
      ["macOS", "Right-click → <b>Open With</b> → <b>Google Chrome</b>. Or drag the file onto the Chrome icon in the Dock."],
      ["Linux", "<code>google-chrome ~/Documents/'JBS Praxis'/PRAXIS_ENGINEERING_WORKBOOK.html</code>"],
      ["Check", "The address bar should read <code>file:///…</code>. That is correct &mdash; this file is not served from anywhere."],
    ]),
    callout("<strong>Chrome or Edge, and not a private window.</strong> The workbook is built and tested against Chromium browsers; the PDF export in particular depends on how Chrome renders. Safari and Firefox will display the pages, but the export is untested there. <b>Never use Incognito or Private mode</b> &mdash; that storage is destroyed the moment you close the window, and a month of work goes with it."),

    h2("Step 3 — Enrol"),
    bl([
      "On first open you are asked for your full name. Type it as you want it to appear on a certificate, because that is exactly where it goes &mdash; spelling, capitals and all.",
      "Your name is stored on your own machine only. Nothing is uploaded, there is no account, no login, no server. Open DevTools and watch the Network tab if you want to confirm that: the file makes zero requests.",
      "After that, everything you do is recorded automatically as you go. There is no save button.",
    ]),

    val("<strong>You need a working machine too, but not yet.</strong> Docker, Node, Git and an editor are Chapter 2's job, and that chapter installs them with you step by step, checking each one before moving on. Right now all you need is this file and Chrome."),
  ].join("\n")));

  out.push(page("", F("BEFORE YOU START — PROTECTING YOUR WORK"), [
    h1("Protecting Your Work"),
    lead("The workbook remembers everything you do, automatically, with no save button. That is a convenience with one sharp edge: the memory lives in the browser, not in the file. Five things destroy it, and one habit protects you from all five."),

    h2("Know how to protect your work"),
    stack([
      ["What is saved", "Every checkbox, every typed answer, every self-check, which pages you have read, and your exam scores."],
      ["Where", "Chrome's <code>localStorage</code>, under one key: <code>jbs-praxis-workbook-v1</code>."],
      ["What destroys it", "<b>Reset</b> in the top bar (it asks first) · clearing browsing data with <i>Cookies and other site data</i> ticked · Incognito · a different browser or profile · moving the file."],
      ["Your backup", "Hit <b>Download PDF</b> at the end of each week. The export captures your typed answers and ticks as they stand, which makes it a snapshot you can keep or send to your lead."],
    ]),

    h2("What the top bar does"),
    stack([
      ["Download PDF", "Exports the whole workbook &mdash; or just the pages you tick with the INCLUDE box &mdash; as a real PDF. Give it a minute; it renders every page at high resolution."],
      ["Edit", "Makes every page directly editable. Correct a line, paste in a note from your lead, then export. Click again to lock it."],
      ["Reset", "Wipes everything and starts you over, name included. It asks first. Nothing else in the workbook clears your data."],
      ["Progress", "The live percentage, and the teal bar along the bottom edge of the window."],
      ["Your name", "Shown on the right once you have enrolled, so you always know whose copy this is."],
    ]),

    callout("<strong>Export at the end of every week.</strong> It takes a minute and it is the only copy of your work that exists outside one browser profile on one machine. Engineers who lose three weeks of answers always lose them the same way: a routine clear-browsing-data, on a Friday, with the box ticked.", "gold"),

    quiz("You have worked through Week 1. Tonight you clear your browsing history, including cookies and other site data, and reopen the workbook tomorrow. What do you find?",
      ["Everything is intact — the file stores progress inside itself",
       "An empty workbook: the enrolment prompt returns and every tick is gone",
       "Only the typed answers survive; the checkboxes reset",
       "Chrome restores it automatically from the recycle bin"],
      1,
      "The HTML file on disk never changes &mdash; your progress lives in the browser's <code>localStorage</code> for that file, not in the file. Clearing site data deletes it, permanently and without warning. This is exactly why the weekly PDF export exists: it is the only copy of your work that survives outside the browser."),
  ].join("\n")));

  // ---------------------------------------------------------------- the promise
  out.push(page("", F("WHAT YOU WILL BE ABLE TO DO"), [
    h1("The Promise, and the Proof"),
    lead("At the end of four weeks you will not &ldquo;know about&rdquo; full-stack engineering. You will have shipped a working vertical slice into a system of real size, passed the same gates a senior engineer passes, and be able to do it again unaided."),

    h2("The capability contract"),
    lete([
      ["1", "Build a complete <b>backend module</b> — routes, validator, controller, service, repo, rules, events, AI manifest — that auto-mounts with no central wiring edit."],
      ["2", "Write a <b>migration</b> that passes numbering, reversibility, idempotency and destructive-declaration checks."],
      ["3", "Build the <b>frontend</b> for it: a list screen, a write form on a shared Zod schema, registered in the screen registry and the nav."],
      ["4", "Make it <b>multi-tenant safe</b> — the right tenant, the right permission, one pooled connection, one transaction boundary."],
      ["5", "Make it <b>observable</b> — events, audit rows, a correct error envelope with a <code>request_id</code> that survives to the client."],
      ["6", "Give it an <b>AI surface</b> that obeys the same RBAC as the HTTP surface, and prove it cannot exceed it."],
      ["7", "Take it through <b>CI, review, deploy and rollback</b> — 33 gates, branch protection, four containers, a one-shot migrate."],
      ["8", "<b>Train a client</b> on it — the eight-step tenant go-live, sandbox seeding, and the incident runbook when it goes wrong at 2am."],
      ["9", "Direct <b>AI coding agents</b> — Claude Code, Arena, Jules — to do this work faster than you could alone, and verify their output rather than trusting it."],
    ]),

    val("<strong>The proof is a pull request.</strong> Week 4 ends with you opening a real PR against a real repository: a feature nobody has built, passing every gate, reviewed by a human who did not write it. That PR is the real graduation. The written examination at the back of this workbook &mdash; twenty questions, 80% to pass, a certificate in your name &mdash; only checks that you can explain what you built and why it is shaped that way."),

    h2("Who this is for"),
    bl([
      "<b>The data engineer</b> who writes good SQL and Python but has never owned an HTTP request end to end. You are the primary reader; the ramp is built for you.",
      "<b>The junior full-stack engineer</b> who can build a CRUD app but has never worked in a codebase with 1,422 routes and cannot yet see why the discipline exists.",
      "<b>The experienced engineer joining JBS Praxis</b> who needs the house conventions fast. Read chapters 1, 4, 7 and 11, run the labs, skip the rest.",
    ]),

    quiz("Read the nine points above once more. Which statement is the most accurate description of what this workbook is asking of you?",
      ["Read all thirteen chapters carefully and take notes as you go",
       "Do the labs on a copy of the code, so nothing you write is ever seen by anyone else",
       "Build a working vertical slice — backend, database, frontend, tests, deploy — and open a real pull request that a colleague reviews",
       "Memorise the architecture well enough to describe it in an interview"],
      2,
      "Every one of the nine points ends in something that exists after you have finished: a module, a migration, a screen, a deploy, a trained client. None of them ends in <i>having read</i>. The proof at the end of the month is a pull request against a real repository, reviewed by somebody who did not write it &mdash; which is also why the labs are not optional and not done on a private copy."),
  ].join("\n")));

  // ---------------------------------------------------------------- the map
  out.push(page("", F("THE FOUR-WEEK MAP"), [
    h1("The Four-Week Map"),
    lead("Thirteen chapters over four weeks. Each week ends with a GATE page you must pass before the next week opens. The system you build accumulates: nothing is a throwaway exercise."),

    table("mst",
      ["WK", "Chapter", "What you learn", "What you ship"],
      [
        ["1", "<span class='mname'>1 · The Shape of the System</span>", "Architecture, the request pipeline, why the layers exist", "A guided tour with annotations"],
        ["1", "<span class='mname'>2 · Environment &amp; First Run</span>", "Docker, Postgres, Redis, env vars, migrations", "The whole stack running locally"],
        ["1", "<span class='mname'>3 · Reading a Module</span>", "The 8-file anatomy, via <code>sales/lead</code>", "A line-by-line dissection"],
        ["1", "<span class='mname'>GATE 1</span>", "&mdash;", "Stack up, tests green, tour signed off"],
        ["2", "<span class='mname'>4 · Data &amp; Migrations</span>", "Schema, tenancy, the query helpers, SQL safety", "Two migrations that pass all gates"],
        ["2", "<span class='mname'>5 · Build a Module</span>", "Routes → validator → controller → service → repo", "Your first working backend feature"],
        ["2", "<span class='mname'>6 · Testing It</span>", "Unit, integration, security gates, the coverage ratchet", "A test suite that catches a real bug"],
        ["2", "<span class='mname'>GATE 2</span>", "&mdash;", "Module merged behind a feature flag"],
        ["3", "<span class='mname'>7 · The Frontend</span>", "React, the paved road, shared schemas, the registry", "A list screen and a write form"],
        ["3", "<span class='mname'>8 · Jobs, Queues &amp; Events</span>", "BullMQ, cron locks, the error contract, Watch-the-Watcher", "A background job with both halves"],
        ["3", "<span class='mname'>9 · LLM Integration</span>", "Vendors, orchestrator, action registry, RBAC parity", "An AI action on your own module"],
        ["3", "<span class='mname'>GATE 3</span>", "&mdash;", "Full vertical slice demoable"],
        ["4", "<span class='mname'>10 · Notifications, Email &amp; Push</span>", "In-app, SMTP, VAPID web push, degrading without breaking", "A notification that reaches a human"],
        ["4", "<span class='mname'>11 · CI, Deploy &amp; Rollback</span>", "33 gates, branch protection, containers, incidents", "A deploy and a practised rollback"],
        ["4", "<span class='mname'>12 · Prompting the Agents</span>", "Claude Code, Arena, Jules — plan, verify, guard", "An agent-built feature you verified"],
        ["4", "<span class='mname'>13 · Shipping to a Client</span>", "Tenant onboarding, sandbox, training, hypercare", "A go-live rehearsal"],
        ["4", "<span class='mname'>GATE 4</span>", "&mdash;", "<b>The graduation PR</b>"],
        ["4", "<span class='mname'>FINAL EXAM</span>", "20 questions drawn at random from all 13 chapters", "<b>Your certificate, at 80%</b>"],
      ]),

    callout("<strong>The weeks are a rhythm, not a deadline.</strong> If Week 2 takes ten days, take ten days. The gates are the real checkpoints; the calendar is a suggestion. Nobody has ever been penalised here for taking longer and understanding it properly.", "gold"),
  ].join("\n")));

  return out;
}
