import {
  page, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
  setChapter,
} from "./kit.mjs";

const F = (s) => `CHAPTER 13 &mdash; SHIPPING TO A CLIENT &nbsp;&middot;&nbsp; ${s}`;

export function chapter() {
  setChapter(13);
  const out = [];

  out.push(page("", F("THE LAST MILE"), [
    band("13", "Shipping To A Client", "WEEK 4 &middot; <b>TEACH + REHEARSE</b> &middot; ~5 HOURS"),
    lead("Everything until now was engineering. This chapter is the part that decides whether the engineering was worth anything: provisioning a tenant, configuring it, proving it, training the people who will use it every day, and staying close while they learn. At JBS Praxis, engineers do this. It is not someone else's job."),

    h2("Why the engineer is in the room"),
    bl([
      "You know which errors are configuration and which are defects &mdash; class G versus everything else.",
      "You know what the sandbox does differently, so you can demonstrate safely without inventing a fake environment.",
      "You know what the system <b>cannot</b> do, and saying so early is worth more than any feature.",
      "<b>And you learn what the software is actually for.</b> Every good decision in Chapters 3&ndash;9 came from somebody understanding the business &mdash; &ldquo;one is a default, two is a question&rdquo; is not a programming insight.",
    ]),

    h2("The shape of a go-live"),
    flow([
      { t: "PROVISION", b: "schema, admin, plan" },
      { t: "CONFIGURE", b: "brand, mail, AI, FX &mdash; <b>tested at runtime</b>" },
      { t: "SEED &amp; REHEARSE", b: "sandbox, realistic data, the full flow" },
      { t: "TRAIN", b: "by role, on their own data" },
      { t: "HYPERCARE", b: "close support while habits form" },
    ]),

    callout("<strong>The goal stated at the end of the official checklist is the one to internalise:</strong> &ldquo;Record anything that needed a config change, not a key entry, in the tenant's handover note &mdash; <b>the goal is that the NEXT tenant needs only keys and brand assets.</b>&rdquo; Every onboarding should make the next one shorter. If yours needed code, that is a finding, not a chore.", "gold"),

    h2("Provisioning"),
    cmd(`npm run db:provision -- --slug=acme --name="Acme Logistics" --plan=standard
npm run db:migrate:tenants
npm run tenant:create-admin -- --slug=acme --email=… --name="…"

# Locally, all of it in one:
npm run setup:local -- --slug=acme --name="Acme Logistics" --with-worker`),
    val("Before you start, the official checklist requires: the tenant is provisioned with <code>status = LIVE</code>, the admin user exists <strong>and can sign in</strong>, and you hold a <strong>Settings (MOD-70) edit</strong> grant &mdash; every runtime test is capability-gated on <code>settings.write</code>. Keep the tenant URL to hand: <code>https://&lt;slug&gt;.praxisls.com</code>."),
  ].join("\n")));

  // ---------------------------------------------------------- checklist
  out.push(page("", F("THE CONFIGURATION CHECKLIST"), [
    h1("Eight Sections, Every One Tested At Runtime"),
    lead("<code>doc/TENANT_ONBOARDING_CHECKLIST.md</code> is the operator's checklist. Its defining property: <b>&ldquo;every step is a click or a curl in the running app &mdash; none of them require a redeploy&rdquo;</b>, and each step ends in a test, not a saved form."),

    rgroup("1", "Branding (white-label)", [
      "Logo and login background; save and hard-refresh the login page.",
      "Brand colours &mdash; <b>confirm the login page repaints without a deploy</b> (live CSS variables).",
      "PWA identity: the install prompt must use the tenant's name and icon.",
      "<b>Verify</b> the &ldquo;Powered by JBS Praxis LLC&rdquo; footer is present on login.",
    ]),
    rgroup("2", "Sending identity (SMTP)", [
      "SMTP host/port/credentials plus a verified identity for at least one purpose.",
      "<code>POST /api/platform/settings/mail.default/test</code> &rarr; <code>{ ok: true }</code> <b>and a probe email must actually arrive</b>.",
      "Then send a <b>real</b> document: issue a test invoice, Send from the viewer, confirm an <code>email_send_log</code> row with status <code>SENT</code>.",
    ]),
    rgroup("3", "AI providers", [
      "Add the tenant's keys: vision, voice, generation, embeddings.",
      "<code>POST /api/platform/ai-vendors/&lt;vendor&gt;/test</code> per vendor. &ldquo;A failed key answers with <b>the provider's error, not a timeout</b>.&rdquo;",
      "AI Control: per-user and per-tenant <b>spend caps</b> and feature flags. Sandbox is always mock.",
      "Generate a PDF. If it fails, the worker image lacks Chromium or <code>PUPPETEER_EXECUTABLE_PATH</code> is unset.",
    ]),
    rgroup("4", "FX rates", [
      "Enable the source and paste the key; trigger <b>Sync now</b>.",
      "Confirm a real conversion returns the new rate.",
      "<b>Confirm <code>fx-sync</code> is in the worker's registered repeatables</b> &mdash; otherwise rates only move when someone clicks.",
    ]),

    callout("<strong>Section 4's last item is Chapter 8 arriving in the field.</strong> A worker with no scheduler is a job nobody starts &mdash; and the client would discover it weeks later as quietly stale exchange rates on their invoices. The checklist exists because someone lived that. <b>Every checklist item is a scar.</b>", "red"),

    h2("Why runtime tests, not saved settings"),
    val("A saved SMTP password proves someone typed a password. <code>{ ok: true }</code> plus an email in an inbox proves the system can send mail. <strong>The distinction between &ldquo;configured&rdquo; and &ldquo;working&rdquo; is where go-lives fail</strong>, and it is the same distinction as the health endpoint that returned <code>{ok:true}</code> unconditionally, and the coverage gate satisfied by importing files. You have now seen this idea in three completely different parts of the system."),

    quiz("A client's AI vendor key is wrong. What should the test endpoint return?",
      ["A 500 — the integration is broken",
       "The provider's own error, surfaced to the operator, so they can see it is a rejected key and not a network problem",
       "A timeout, since the request will not complete",
       "{ ok: false } with no detail"],
      1,
      "The checklist specifies this explicitly. A timeout tells the operator nothing and sends them to check firewalls. The provider's error message &mdash; &ldquo;invalid API key&rdquo; &mdash; tells them exactly what to fix. This is class G from the error taxonomy: a configuration problem with a fix-it path, never an engineering page."),
  ].join("\n")));

  // ---------------------------------------------------------- sandbox
  out.push(page("", F("SANDBOX &amp; REHEARSAL"), [
    h1("Rehearse On Real-Shaped Data"),
    lead("<code>doc/SANDBOX_TESTING.md</code>: &ldquo;get a tenant's <b>sandbox</b> schema populated with realistic Cameroon freight-forwarder data so every built screen shows something, then walk the whole app end-to-end <b>without risking live data</b>.&rdquo;"),

    h2("What the seed gives you"),
    bl([
      "2 corporate entities, 6 clients, 5 suppliers, 8 employees, 3 treasury accounts, <b>5 dossiers at different stages</b>.",
      "The whole sales funnel &mdash; leads &rarr; meetings &rarr; campaigns &rarr; opportunities across every pipeline stage &rarr; proposals.",
      "Commercial, finance documents, fixed assets, the full fleet, WMS, procurement (PR &rarr; PO &rarr; GRN), and HR.",
      "<b>Realistic, domain-correct data</b> &mdash; not <code>test1</code>, <code>test2</code>, <code>asdf</code>. This matters enormously for training.",
    ]),

    h2("And what it deliberately does not"),
    callout("<strong>&ldquo;It does not post to the general ledger.&rdquo;</strong> Because it is direct SQL rather than the service layer, it does not write <code>journal_entry</code> / <code>journal_line</code> rows &mdash; &ldquo;that keeps it clear of the ledger invariant triggers (balanced / gap-free <code>entry_no</code> / mandatory <code>source_doc_ref</code>)&rdquo;. Finance documents are seeded in <b>pre-posting states</b> with <code>entry_id = NULL</code>.", "gold"),

    val("<strong>Read the consequence, and then read how it is handled.</strong> &ldquo;Trial balance, financial statements, and true receivables ageing are empty until you post real entries &mdash; <b>and posting is exactly what you should test through the app</b>.&rdquo; The gap is not an oversight; it is deliberately left as the thing the operator must exercise. And so the dashboard is not simply blank, the seed sets <code>cached_receivables</code> and <code>cached_overdue</code> so the tiles still show numbers. <b>A limitation, documented, mitigated, and turned into a test.</b>"),

    h2("Sandbox hygiene &mdash; the three guards"),
    table("mst", ["In TEST mode", "What happens"], [
      ["Sending an email", "Recorded as <code>SUPPRESSED</code> &mdash; <b>it never leaves the server</b>"],
      ["Generating a PDF", "Watermarked <b><code>TEST SANDBOX</code></b>"],
      ["AI generation", "Takes the <b>mock</b> path &mdash; no spend, no egress"],
    ]),
    bl([
      "<b>Spot-check all three</b> before you put a client in front of the sandbox. The checklist says so.",
      "<code>sandbox_wipe_days</code> defaults to 14; confirm the daily scheduler tick appears in the worker log.",
      "Remember the environment rule from Chapter 1: sandbox is active only when <code>!tenant.is_live</code> <b>and</b> the request carries <code>X-Praxis-Env: sandbox</code>.",
    ]),

    h2("A real gotcha, documented with a date"),
    callout("<strong>⚠ Machine/DB switch (2026-07-22).</strong> If a login user was re-created in live with a new <code>user_id</code> while the sandbox still holds the old row for the same email, <b>every TEST-mode write fails with <code>409 Referenced record not found</code></b> (FK 23503 on the actor user). The seed now tombstones the stale row's unique email/username and mirrors the new one &mdash; so the fix is simply to <b>re-run the seed, no wipe needed</b>.", "green"),
    val("<strong>That is what a good gotcha note looks like:</strong> the symptom the operator will actually see, the underlying cause, the date it was found, and a one-line fix. Write yours this way. You will meet it on someone else's laptop in six months."),
  ].join("\n")));

  // ---------------------------------------------------------- surfaces
  out.push(page("", F("EXTERNAL SURFACES &amp; GOD MODE"), [
    h1("The Parts Clients See That You Never Look At"),
    lead("Sections 6 and 7 of the checklist. These surfaces are used by people who do not work for your client &mdash; their customers, their auditors, the public &mdash; which makes them the least forgiving part of the system."),

    h2("The portal"),
    req([
      "Invite a test client contact via Settings &rarr; Portal Access.",
      "Sign in at <code>/portal</code> and confirm the client terminal renders.",
      "<b>Do this as the contact would</b>, in a clean browser profile. A portal that works only in your logged-in session is not tested.",
    ]),

    h2("The public site"),
    req([
      "<code>/public</code> loads; the quote form posts an intake row into the sales queue.",
      "<b><code>/public/track</code> answers 404 &mdash; not 401 &mdash; for an unknown reference.</b>",
      "Careers and portfolio pages render.",
    ]),
    callout("<strong>Why 404 and not 401 on an unknown tracking reference?</strong> Because 401 says <i>&ldquo;this exists, you just cannot see it&rdquo;</i>. On a public endpoint that is an <b>enumeration oracle</b>: an attacker can discover which reference numbers are real by watching the status code. 404 for both &ldquo;does not exist&rdquo; and &ldquo;not yours&rdquo; leaks nothing. This is the same care about status codes as <code>WRONG_HOST</code>, the CORS 403 and <code>LOCKED</code> 422 &mdash; <b>chosen for what it reveals as much as what it means</b>.", "red"),

    h2("The auditor data room"),
    req([
      "Grant an AUDITOR portal access.",
      "Raise a data-room request from the portal.",
      "Attach a <b>VERIFIED</b> vault document as staff.",
      "Confirm the auditor can download it &mdash; end to end, as both parties.",
    ]),

    h2("God Mode"),
    bl([
      "CEO &rarr; God Mode &rarr; Set PIN, or wait for the weekly rotation email.",
      "<b>Confirm purge works</b>, and that an expired PIN is <b>refused after 7 days</b>.",
      "Test the refusal, not just the success. An expiry nobody has watched expire is an assumption.",
    ]),
    val("<strong>Notice the pattern across every section of this checklist:</strong> test the thing working, then test the thing refusing. Send the email <i>and</i> check the suppression. Download as the auditor <i>and</i> confirm the expired PIN is rejected. <strong>Half of correctness is refusing correctly</strong> &mdash; and it is the half nobody demonstrates in a demo."),
  ].join("\n")));

  // ---------------------------------------------------------- training
  out.push(page("", F("TRAINING THE CLIENT"), [
    h1("Training People, Not Demonstrating Software"),
    lead("The most common failure is a beautiful two-hour walkthrough of every screen, after which nobody can do their own job. Train by role, on their data, with their hands on the keyboard."),

    h2("Four rules"),
    lete([
      ["1", "<b>By role, not by module.</b> A finance clerk does not need the fleet screens. Build a session per role around the five things that person does daily."],
      ["2", "<b>On their own data.</b> Their client names, their dossier references, their currencies. Generic demo data teaches the software; their data teaches <i>their job in the software</i>."],
      ["3", "<b>They drive.</b> If you are holding the keyboard, you are the only person learning. Talk them through it; do not do it for them."],
      ["4", "<b>Teach the error states.</b> What a 422 looks like, what &ldquo;already revoked&rdquo; means, what to do when a PDF does not arrive. <b>Confidence comes from having already seen the thing go wrong once</b>, in a room with you in it."],
    ]),

    h2("Rule 4, made concrete"),
    callout("Deliberately trigger, in front of them: a validation error with a highlighted field; an action on a locked record; an idempotent no-op showing &ldquo;that was already done&rdquo;; and an offline save that queues and replays. <b>Those four moments prevent more support tickets than any amount of happy-path training</b> &mdash; because each one is otherwise interpreted as &ldquo;the system is broken&rdquo;.", "gold"),

    h2("A session plan"),
    table("mst", ["Session", "Who", "Content"], [
      ["Admin (2h)", "Tenant admin", "Users, roles, permissions, branding, settings, God Mode boundaries"],
      ["Operations (2h)", "Ops staff", "Dossiers end to end, milestones, documents, the four error states"],
      ["Commercial (90m)", "Sales &amp; commercial", "Leads &rarr; qualification &rarr; conversion, quotations, costings"],
      ["Finance (2h)", "Finance", "Invoices, posting, receivables, FX &mdash; <b>and what posting means, because the sandbox cannot rehearse it</b>"],
      ["Copilot (45m)", "Everyone", "What it can do, that it <b>cannot exceed your own permissions</b>, and why writes always confirm"],
    ]),

    h2("The copilot session is different"),
    bl([
      "Users need to know the assistant <b>runs as them</b> &mdash; it cannot do what they cannot do. This is reassuring, and it is true because of Chapter 9.",
      "They need to know <b>every write asks first</b>, and that they should read the card, not reflex-click. Say why: confirmations that appear everywhere stop being read.",
      "They need to know sensitive data is <b>redacted before it leaves</b>, and that sandbox AI is mocked.",
      "<b>Explain the limits honestly.</b> A user who trusts it for everything will be burned; a user who trusts it for nothing wasted your integration.",
    ]),

    ex("Write the one-page role card", "40 min",
      "<p>Pick one role and write the single page they keep beside their screen: their five daily tasks as numbered steps, the four error states with what to do about each, and who to contact. <b>One page.</b> If it needs two, you have not understood the role yet.</p>",
      "Role: … / Tasks: … / Errors: … / Contact: …"),
  ].join("\n")));

  // ---------------------------------------------------------- gate 4
  out.push(page("", F("HYPERCARE &amp; HANDOVER"), [
    h1("The First Two Weeks"),
    lead("Go-live is not the end of a project; it is the start of the only period in which the client decides whether they trust the system."),

    rgroup("H1", "Days 1&ndash;3 &mdash; presence", [
      "Someone available on a channel the client actually uses, within minutes.",
      "A daily check of <code>ops:status</code>, the error monitor, and the mail send log.",
      "<b>Log every question.</b> Questions are the highest-quality product feedback you will ever get.",
      "Fix configuration immediately; queue defects properly &mdash; and be able to tell the two apart out loud.",
    ]),
    rgroup("H2", "Days 4&ndash;14 &mdash; withdrawal", [
      "Move from &ldquo;we are watching&rdquo; to &ldquo;raise a ticket&rdquo;, deliberately and with a date.",
      "A weekly review of error rates, queue depth, and slow endpoints.",
      "Convert the recurring questions into training material or a UI change.",
      "Confirm backups are running and <b>run a restore drill</b> against the new tenant.",
    ]),
    rgroup("H3", "The handover note", [
      "Everything that needed a config change rather than a key entry.",
      "Anything client-specific a future engineer would be surprised by.",
      "The role cards, and who was trained on what.",
      "<b>Open items, with owners and dates.</b>",
    ]),

    callout("<strong>The handover note is the deliverable that makes the next go-live cheaper.</strong> The checklist's stated goal &mdash; that the next tenant needs only keys and brand assets &mdash; is only reachable if every onboarding writes down what it had to work around. <b>An undocumented workaround is a permanent tax on everyone who comes after you.</b>", "green"),

    h2("Escalation, so nobody has to guess"),
    stack([
      ["<b>Configuration</b>", "You fix it now. Log it in the handover note."],
      ["<b>Training gap</b>", "You fix it now, and update the role card."],
      ["<b>SEV-3/4 defect</b>", "Ticket, owner, date. Tell the client the date and then meet it."],
      ["<b>SEV-1/2 defect</b>", "Incident runbook. Tell the client <b>before</b> they tell you."],
    ]),
    val("<strong>&ldquo;Tell the client before they tell you&rdquo; is the whole of client trust in six words.</strong> A team that reports its own outage is a team that is watching. A team that learns of its outage from the client is a team that is not &mdash; and no amount of technical excellence recovers that impression."),
  ].join("\n")));

  return out;
}
