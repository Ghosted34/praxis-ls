import {
  page, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
  setChapter,
} from "./kit.mjs";

const F = (s) => `CHAPTER 9 &mdash; LLM INTEGRATION &nbsp;&middot;&nbsp; ${s}`;

export function chapter() {
  setChapter(9);
  const out = [];

  out.push(page("", F("THE AGENT LOOP"), [
    band("09", "LLM Integration", "WEEK 3 &middot; <b>TEACH + BUILD</b> &middot; ~6 HOURS"),
    lead("An assistant that can read and write real ERP records on behalf of a real user. Every safety property in this design was earned &mdash; one of them by a High-severity audit finding that is the best security lesson in the codebase. Read the loop first, then the finding."),

    h2("The loop, from the source header"),
    flow([
      { t: "RECALL", b: "retrieve context; redact before egress" },
      { t: "PLAN", b: "function-calling against the tool list" },
      { t: "GATE", b: "Zod-validate proposed actions (&le;2 self-correct)" },
      { t: "CONFIRM", b: "return action cards for a <b>human</b> to approve" },
      { t: "EXECUTE", b: "run with <b>the user's</b> permissions" },
      { t: "LOG", b: "immutable ledger, every time" },
    ]),

    val("<strong>&ldquo;The AI never exceeds the calling user; sensitive text is redacted before egress.&rdquo;</strong> Those two clauses are the entire security posture, and the rest of this chapter is how each is actually enforced &mdash; because for a while, one of them was not."),

    h2("Three numbers that control cost"),
    table("mst", ["Constant", "Value", "The trade-off it encodes"], [
      ["<code>HISTORY_TURNS</code>", "20", "Stored history is unbounded; this caps only what is <b>re-sent</b>, so cost per call stays flat however long the thread grows. ~10 exchanges."],
      ["<code>SUMMARY_BATCH</code>", "10", "How many messages fall out of the window before the summary regenerates."],
      ["<code>NARRATION_TURNS</code>", "5", "Confirmation narration needs &ldquo;what was just done and the step before&rdquo; &mdash; not 20 turns of context on every confirm."],
    ]),

    h2("And the honesty about what that costs"),
    callout("On <code>SUMMARY_BATCH</code>: &ldquo;Regenerating on every turn would mean a second model call per question &mdash; roughly doubling the cost of a long thread, against a budget that is hard-capped per tenant. Batching makes it one extra call per ten turns. <b>The price is a gap</b>: up to <code>SUMMARY_BATCH - 1</code> messages can sit outside both the replay window and the summary, so a detail mentioned exactly there is briefly unavailable until the next batch absorbs it. <b>Bounded, self-correcting, and much cheaper than the alternative &mdash; but real, so it is written down rather than discovered.</b>&rdquo;", "gold"),

    val("<strong>&ldquo;Written down rather than discovered.&rdquo;</strong> That is the standard. Every engineering decision has a downside; the difference between a good codebase and a bad one is whether the downside is documented at the point of the trade-off or found by a user eighteen months later. When you make a trade-off, name the cost in a comment."),
  ].join("\n")));

  // ---------------------------------------------------------- SEC H1
  out.push(page("", F("SEC H1 &mdash; THE BYPASS"), [
    h1("SEC H1: Recording Is Not Preventing"),
    lead("Open <code>src/services/ai/action-authz.js</code> and read its header. This is the most instructive security finding in the repository, and it is worth reading twice."),

    h2("The setup &mdash; everything looked right"),
    lete([
      ["1", "The AI action catalogue has carried a <code>required_permission</code> column <b>from the start</b>."],
      ["2", "The registrar <b>populates it</b> from each module's manifest."],
      ["3", "The orchestrator even <b>SELECTs it</b> into the tool list."],
      ["4", "<b>IT WAS NEVER COMPARED AGAINST ANYTHING.</b>"],
    ]),

    cmd(`// Both execution sites, verbatim:
const out    = fn ? await fn({ client, user, payload }) : { error: "no executor" };
const result = await fn({ client, user, payload });`),

    h2("Why it survived review"),
    callout("&ldquo;Authorization in this codebase lives <b>exclusively in route middleware</b> &mdash; services do not check grants. <code>action-registry.js</code> says of its executors: <i>each calls a module SERVICE with the caller's client + identity (module RBAC/audit applies)</i>. <b>The audit half was true. The RBAC half was not</b> &mdash; and the assistant router carries only <code>authMiddleware</code> plus a tenant-wide feature flag.&rdquo;", "red"),

    val("<strong>So the assistant was a general-purpose bypass around the module grant matrix, available to every authenticated user in any tenant with AI enabled.</strong>"),

    h2("What that meant in practice"),
    bl([
      "<b>Ten write actions</b> were reachable that way: <code>create_client</code>, <code>open_dossier</code>, <code>update_dossier</code>, <code>transition_dossier</code>, <code>create_costing</code>, <code>draft_quotation</code>, <code>draft_final_invoice</code>, <code>draft_purchase_order</code>, <code>draft_supplier_invoice</code>, <code>draft_cash_request</code>.",
      "&ldquo;A warehouse operator holding <b>only WMS grants</b> could ask the assistant, <b>in ordinary language</b>, to draft a supplier invoice and a cash request &mdash; creating financial documents they cannot create through any screen or route available to them.&rdquo;",
      "&ldquo;Every one was faithfully written to the immutable ledger, so the audit trail would have recorded the unauthorized action accurately.&rdquo;",
    ]),

    callout("<strong>&ldquo;Recording is not preventing.&rdquo;</strong> Four words worth engraving. The audit trail worked flawlessly. It would have given you a perfect, timestamped, attributable record of every unauthorised financial document &mdash; after the fact. Observability and control are different systems solving different problems, and a beautiful audit log can make a team feel safe while nothing is actually stopping anything.", "red"),

    h2("The root cause, generalised"),
    val("Remember the &ldquo;declared, not called&rdquo; family from Chapter 6? This is its most dangerous member. The column existed. It was populated. It was read into memory. <strong>The comparison was never written.</strong> Every artefact of the security control was present except the one line that enforces it &mdash; and every reviewer who checked &ldquo;is there a permission column?&rdquo; got a yes."),

    quiz("What kind of test catches SEC H1?",
      ["A unit test of the action registry",
       "An integration test that logs in as a user with narrow grants, asks the assistant to perform an action outside them, and asserts it is refused",
       "A schema test that the column is populated",
       "Code review by a security engineer"],
      1,
      "The test has to be adversarial and end-to-end: a real low-privilege identity attempting a real out-of-scope action. Every narrower test passes on the broken code &mdash; the column is there, the registrar fills it, the orchestrator reads it. <b>Test the property you care about (&ldquo;this user cannot do that&rdquo;), not the mechanism you built to provide it.</b>"),
  ].join("\n")));

  // ---------------------------------------------------------- fail closed
  out.push(page("", F("FAIL CLOSED, PROPERLY"), [
    h1("The Fix, And Its Uncomfortable Rule"),
    lead("<code>action-authz.js</code> now compares the action's <code>required_permission</code> against the caller's grants. But the interesting part is what it does when there is no requirement to compare."),

    val("<strong>&ldquo;An action whose <code>required_permission</code> is null does not execute.&rdquo;</strong>"),

    callout("&ldquo;That is <b>the opposite of the usual instinct</b> &mdash; &lsquo;no requirement means no restriction&rsquo; &mdash; and it is deliberate: a missing requirement means <b>the catalogue is incomplete</b>, and the safe reading of an incomplete authorization record is <i>no</i>. A registrar that forgets to declare a permission produces <b>a visibly broken action rather than an invisibly open one</b>.&rdquo;", "gold"),

    h2("Visibly broken beats invisibly open"),
    stack([
      ["<b>Invisibly open</b>", "The action works. Everyone is happy. Nobody knows the permission is missing. It is found by an auditor, or by an incident."],
      ["<b>Visibly broken</b>", "The action fails on first use. Someone files a bug within the hour. The fix is one line in a manifest."],
    ]),
    val("Write that comparison on a card and keep it. Given a choice between a failure mode users will report immediately and one nobody will notice, <strong>choose the loud one</strong> &mdash; even when it costs you a support ticket. The quiet failure is not cheaper; its bill just arrives later, with interest."),

    h2("You have now seen fail-closed three times"),
    table("mst", ["Where", "The unlisted / missing case"], [
      ["<code>lead.routes.js</code>", "A transition not in <code>TRANSITION_ACTION</code> defaults to <code>approve</code> &mdash; the <b>higher</b> permission."],
      ["<code>query-helpers.js</code>", "An identifier not matching <code>IDENT_RE</code> is <b>rejected</b>, not sanitised and passed."],
      ["<code>action-authz.js</code>", "An action with no declared permission <b>does not run</b>."],
    ]),
    callout("<strong>Three unrelated subsystems, one principle, applied consistently.</strong> That consistency is what makes a codebase learnable: once you know how this team resolves ambiguity, you can predict the behaviour of code you have not read. Apply it in your own module and reviewers will recognise it immediately.", "green"),

    h2("Reads are gated too"),
    bl([
      "The header is explicit that reads are gated, not just writes.",
      "A read action returns tenant data the caller may not be entitled to see &mdash; a list of financial documents is a disclosure even if nothing is written.",
      "The Chapter 3 principle again: <b>hidden money is <code>null</code>, not zero</b>. Here, an ungranted read is refused, not silently emptied.",
    ]),
  ].join("\n")));

  // ---------------------------------------------------------- vendors
  out.push(page("", F("VENDORS, DEGRADATION &amp; MARKUP"), [
    h1("<code>llm.service.js</code> &mdash; Vendor-Agnostic By Construction"),
    lead("Three practical lessons about integrating a model provider, all of which apply to any third-party API you will ever wire up."),

    h2("1. DB-first, env-fallback, then degrade"),
    cmd(`const PRIMARY  = "deepseek";
const FALLBACK = "gemini";

async function resolveVendor(client, name) {
  const db = await platformVendors.getConfig(name);
  if (db && db.is_active !== false && db.api_key && db.endpoint_url) return db;
  const env = ENV_VENDORS[name];
  if (env && env.api_key && env.endpoint_url) return env;
  return null;
}`),
    lete([
      ["1", "<b>Platform database first</b> &mdash; one shared, encrypted <code>platform.ai_vendor_credential</code> set, rotatable without a deploy."],
      ["2", "<b><code>.env</code> fallback</b> &mdash; BUILD_CONVENTIONS §7, so local development works with no platform record."],
      ["3", "<b>If neither is set, the call degrades to a clear stub.</b> Not a crash, not a hang, not a silent empty answer &mdash; a stub that says what is missing."],
    ]),
    callout("<strong>Point 3 is class G from the error taxonomy.</strong> An unconfigured API key is not an incident, it is a configuration task &mdash; so it produces a callout with a fix-it link, and it never pages engineering. Notice how the taxonomy you learned in Chapter 8 predicts the correct behaviour here without anyone having to think about it again.", "green"),

    h2("2. All vendors speak one shape"),
    bl([
      "Every configured vendor exposes an OpenAI-compatible <code>/chat/completions</code> endpoint.",
      "The adapter layer is therefore thin, and adding a vendor is a database row, not a code change.",
      "<b>Standardising on the widest-supported wire format is how you stay vendor-agnostic in practice</b>, as opposed to in an architecture diagram.",
    ]),

    h2("3. The markup-leak defence &mdash; models misbehave"),
    cmd(`// Some models (notably DeepSeek, esp. when handed a large tool list) emit their
// tool-call markup as TEXT in \`content\` instead of the structured \`tool_calls\`
// field. Left as-is it leaks raw markup to the user and the real action never runs.
const TOOLCALL_MARKUP = /[｜▁]|DSML|invoke\\s+name="/i;`),
    lete([
      ["A", "<b>Two failures in one bug</b>: the user sees raw markup, <i>and</i> the action silently never runs."],
      ["B", "The recovery <b>parses out any usable calls</b> and, either way, <b>strips the markup</b> so the user never sees it. Fix the visible symptom and the invisible one."],
      ["C", "The pattern is <b>anchored on the actual markup characters</b> &mdash; the full-width pipe, the ▁ token, the literal DSML marker, an <code>invoke name=\"</code> tag &mdash; &ldquo;so it never false-triggers on prose that merely says <i>tool calls</i>.&rdquo;"],
    ]),
    callout("<strong>Lesson C is the one people skip.</strong> A defensive regex that fires on ordinary text is a new bug wearing the costume of a fix &mdash; and a user asking &ldquo;how do tool calls work?&rdquo; getting their sentence mangled is a genuinely baffling support ticket. Anchor on structure, never on vocabulary.", "gold"),

    h2("Redaction before egress"),
    bl([
      "<code>redact.js</code> covers IBAN, card numbers with separators, <b>OHADA-zone RIB</b> bank accounts, <b>Cameroon NIU</b> tax IDs, social security numbers, phones and emails.",
      "&ldquo;For a system handling OHADA financial data, <b>these are not edge cases.</b>&rdquo; The original three patterns missed most of them.",
      "<b>Pattern-based, not NER-based</b>, and the reason is stated: NER for person names &ldquo;would require a model call or a library dependency this layer cannot afford on every egress path&rdquo;.",
      "<b>&ldquo;ORDER MATTERS: more specific patterns must run before general ones. A RIB with spaces would be partially caught by the phone pattern if it ran first.&rdquo;</b>",
    ]),
    val("<strong>Localisation is a security requirement, not a nicety.</strong> A redaction library built for US and EU formats would pass every test written by its authors and leak Cameroonian tax IDs on day one. Know the data your clients actually hold."),
  ].join("\n")));

  // ---------------------------------------------------------- lab
  out.push(page("", F("LAB 9 &mdash; AN AI ACTION"), [
    band("L9", "Lab &mdash; Give The Copilot Your Module", "WEEK 3 &middot; <b>HANDS ON</b> &middot; ~2.5 HOURS", "lab"),
    lead("Your module has an <code>.ai.js</code> manifest from Chapter 5. A manifest is a declaration &mdash; and you have now read what happens to declarations nobody enforces. Wire it through properly."),

    h2("Step 1 &mdash; The executor"),
    req([
      "Add entries to <code>src/services/ai/action-registry.js</code> following the house shape.",
      "Each calls <b>your existing service function</b> with <code>{ client, user, payload }</code>. No new logic.",
      "Return <code>{ entity_ref: \"onboarding_task:&lt;id&gt;\" }</code> &mdash; match the existing convention exactly.",
      "If your service takes camelCase args and the AI payload is snake_case, adapt <b>here</b>, in the registry &mdash; that is what the field-name adapter is for.",
    ]),

    h2("Step 2 &mdash; The catalogue row"),
    req([
      "An <code>ai_action_catalogue</code> row per action, with a <code>payload_schema</code>.",
      "<b><code>required_permission</code> must be populated.</b> Null means the action will not execute &mdash; by design.",
      "Confirm the registrar picks it up from your manifest rather than you hand-writing it, and say which mechanism you used.",
    ]),

    h2("Step 3 &mdash; Prove the gate holds"),
    ex("The adversarial test", "45 min",
      "<p>This is the SEC H1 test, for your module. Create a user with <b>no</b> grants on your module. Ask the assistant, in plain language, to create and then cancel an onboarding task. Record: what the assistant says; whether the action card appears at all; what happens on confirm; and what lands in the ledger. Then repeat with a user who has <code>edit</code> but not the higher grant, targeting whichever transition your map gates hardest.</p>",
      "No grants: … / edit-only on the gated transition: … / Ledger: …"),

    callout("<strong>If either attempt succeeds, stop and escalate immediately.</strong> Do not fix it quietly and do not carry on with the lab. A permission bypass on the AI surface is a Sev-2 at minimum, and the correct behaviour &mdash; which is also being assessed here &mdash; is to raise it the moment you see it.", "red"),

    h2("Step 4 &mdash; Write the test down"),
    req([
      "Turn the exercise into <code>tests/integration/onboarding-task-ai-authz.test.js</code>.",
      "Assert refusal for the ungranted user, and success for the properly granted one.",
      "Assert that an action with <code>required_permission</code> nulled out <b>does not execute</b>.",
      "This test is the one that would have caught SEC H1. Write it as though it will.",
    ]),

    h2("Step 5 &mdash; The describe strings, tested"),
    ex("Does the model actually pick the right tool?", "30 min",
      "<p>Ask the assistant five differently-phrased versions of the same intent (&ldquo;mark the KYC task done&rdquo;, &ldquo;close off the KYC item&rdquo;, &ldquo;the KYC pack is in&rdquo;&hellip;). Record which tool it chose each time. Where it chose wrong, improve the <code>describe</code> string &mdash; not the code &mdash; and retest. Paste before/after.</p>",
      "Phrasings and choices: … / describe before: … / after: … / result: …"),

    val("<strong>Step 5 is prompt engineering inside a production system, and it is the bridge to Chapter 12.</strong> The <code>describe</code> field is a prompt. It is versioned, reviewed, and it has measurable behaviour. Treating prompts as code &mdash; testable, improvable, owned &mdash; is the difference between an AI feature that works and one that works on the demo."),

    dod(["Executor wired to the existing service", "Catalogue rows with permissions", "Ungranted user refused", "Authz test written", "Describe strings tuned against real phrasings"]),
  ].join("\n")));

  // -------------------------------------------------------------- gate 3
  out.push(page("", `CHAPTER 9 &mdash; LLM INTEGRATION &nbsp;&middot;&nbsp; GATE 3`, [
    band("G3", "Gate 3 &mdash; End of Week Three", "<b>PROVE IT</b> &middot; BEFORE WEEK 4 OPENS &middot; SIGNED OFF BY YOUR LEAD", "qa"),
    lead("Three weeks in, and your feature now exists at every layer: a screen, an API, a service, SQL, a background job and an AI action. This gate asks whether it is one coherent thing or six things that happen to share a name."),

    rgroup("G3.1", "Front end", [
      "My screen is on the paved road, scaffolded through the generator.",
      "Both empty states exist, and their copy differs.",
      "<b>Zero client-side validation of my own</b> &mdash; the shared schema is the only source of truth.",
      "All eleven frontend gates are green.",
      "I can explain F5 and why the &ldquo;frontend guide is not lying&rdquo; gate exists.",
      "I have seen my own write queue and replay while offline.",
    ]),
    rgroup("G3.2", "Jobs and errors", [
      "Handler and scheduler both shipped; single-fire proven with two workers running.",
      "I can state my handler's idempotency <b>mechanism</b> &mdash; not a hope that it will not run twice.",
      "I can classify any failure into the seven-class taxonomy and say what it should show the user.",
      "I can explain <code>changed:false</code>, and why making it a 409 would break the outbox.",
      "I can tell the NEW-04 story and say what test would have caught it.",
    ]),
    rgroup("G3.3", "AI", [
      "My AI action reuses the same service, schema and permission as the HTTP route.",
      "<b>The ungranted user is refused</b>, and I have the integration test that proves it.",
      "I can tell the SEC H1 story and explain &ldquo;recording is not preventing&rdquo;.",
      "I can explain why a null <code>required_permission</code> refuses to execute.",
      "I tuned my <code>describe</code> strings against five real phrasings and recorded the before and after.",
    ]),

    dod(["Vertical slice demoable", "Job both halves", "AI authz tested adversarially", "Eleven frontend gates green", "Lead signed off"]),

    callout("<strong>Week 3 done, and this is the week that made you full-stack.</strong> You have now followed a single idea &mdash; a task that someone in an office needs to tick off &mdash; from a React dialog through a shared Zod schema, an Express chain, a service, a transaction, SQL, an event, a queue, and a language model, and back. Week 4 is about getting it to a client and keeping it there.", "green"),
  ].join("\n")));

  return out;
}
