import {
  page, band, h1, h2, lead, callout, val, bl, req, dod, chips, lete,
  rgroup, cards, flow, table, stack, liaison, cmd, ex, quiz,
  setChapter,
} from "./kit.mjs";

const F = (s) => `CHAPTER 3 &mdash; READING A MODULE &nbsp;&middot;&nbsp; ${s}`;

export function chapter() {
  setChapter(3);
  const out = [];

  out.push(page("", F("THE EIGHT FILES"), [
    band("03", "Reading a Module", "WEEK 1 &middot; <b>TEACH</b> &middot; ~4 HOURS &middot; <b>THE MOST IMPORTANT CHAPTER</b>"),
    lead("131 modules, one shape. This chapter dissects the canonical example &mdash; <code>src/modules/sales/lead/</code> &mdash; file by file, line by line. Learn this folder and you can read any of the other 130. It is roughly 450 lines in total, and every one of them is teaching something."),

    h2("The file set"),
    table("mst", ["File", "Lines", "Job", "May it&hellip;"], [
      ["<code>lead.routes.js</code>", "42", "URL &rarr; middleware chain &rarr; controller", "touch SQL? <b>No</b>"],
      ["<code>lead.validator.js</code>", "105", "Zod schemas + Express middleware", "touch SQL? <b>No</b>"],
      ["<code>lead.controller.js</code>", "30", "Unwrap HTTP, call service, shape response", "touch SQL? <b>No</b>"],
      ["<code>lead.service.js</code>", "192", "Business rules, transactions, events, audit", "touch SQL? <b>No</b>"],
      ["<code>lead.repo.js</code>", "57", "<b>Every SQL statement in the module</b>", "touch SQL? <b>Only here</b>"],
      ["<code>lead.rules.js</code>", "9", "Pure logic — no I/O, no db, no HTTP", "touch SQL? <b>No</b>"],
      ["<code>lead.events.js</code>", "3", "Event-name constants", "touch SQL? <b>No</b>"],
      ["<code>lead.ai.js</code>", "17", "The AI manifest — what the copilot may do", "touch SQL? <b>No</b>"],
    ]),

    callout("<strong>Notice the line counts.</strong> The controller is 30 lines for six endpoints. The rules file is 9. The events file is 3. This is not a codebase of clever abstractions &mdash; it is a codebase of <b>tiny files with unambiguous jobs</b>. When your controller starts growing, that is the signal that logic has leaked into the wrong layer.", "green"),

    h2("How the layers call each other"),
    flow([
      { t: "ROUTES", b: "auth &rarr; permission &rarr; validator &rarr; controller" },
      { t: "CONTROLLER", b: "reads <code>req</code>, calls <code>req.tenantDb</code>, calls the service" },
      { t: "SERVICE", b: "rules, transaction, repo calls, <code>emitEvent</code>, <code>audit</code>" },
      { t: "REPO", b: "parameterised SQL through the shared query helpers" },
    ]),

    quiz("Why does <code>lead.rules.js</code> exist as a separate 9-line file rather than living inside the service?",
      ["To keep the service file under a line limit",
       "Because it is pure — no db, no HTTP, no I/O — so it can be unit tested in microseconds with no mocks, and reused by the AI path and the REST path alike",
       "Because rules change more often than services",
       "It is a legacy artefact"],
      1,
      "Purity is the point. <code>assertTransition(from, to)</code> needs no database, no request and no mocks, so its test is instant and cannot rot. Everything genuinely hard about the module &mdash; ordering, transactions, side effects &mdash; stays in the service where it is visible, and the state machine stays somewhere you can read in ten seconds."),
  ].join("\n")));

  // ------------------------------------------------------------- routes
  out.push(page("", F("FILE 1 &mdash; ROUTES"), [
    h1("File 1 &mdash; <code>lead.routes.js</code>"),
    lead("42 lines that define the module's entire public surface. Read the order of the middleware carefully: in Express, order <i>is</i> the security model."),

    cmd(`const MODULE = "MOD-20";
const TRANSITION_ACTION = { CONTACTED: "edit", QUALIFIED: "edit", LOST: "approve" };

const router = express.Router();
router.use(authMiddleware);

router.get("/",            requirePermission(MODULE, "view"),   controller.list);
router.get("/:id/360",     requirePermission(MODULE, "view"),   controller.dossier);
router.get("/:id",         requirePermission(MODULE, "view"),   controller.get);
router.post("/",           requirePermission(MODULE, "create"), validator.create,  controller.create);

router.patch("/:id",       requirePermission(MODULE, "edit"),   validator.update,
  requireLifecyclePermissionOnPatch(MODULE, TRANSITION_ACTION, { field: "status" }), controller.update);

router.post("/:id/transition", validator.transition,
  requireTransitionPermission(MODULE, TRANSITION_ACTION), controller.transition);

router.post("/:id/convert", requirePermission(MODULE, "edit"), validator.convert, controller.convert);

module.exports = { basePath: "/leads", feature: null, router };`),

    h2("Four things to take from this file"),
    lete([
      ["A", "<b>A module key, not a string per route.</b> <code>MOD-20</code> is the identity the permission system, the event system and the AI manifest all share. One constant, four subsystems."],
      ["B", "<b>Permissions are per-action, not per-module.</b> <code>view</code>, <code>create</code>, <code>edit</code>, <code>approve</code>. An administrator reading the permission matrix can see exactly what a role can do."],
      ["C", "<b>The transition map is the interesting part.</b> This lifecycle used to be gated by one flat permission for every target state, so &ldquo;advance this lead&rdquo; and &ldquo;kill this lead&rdquo; required the same grant. Advancing is <code>edit</code>; a decision that <i>ends</i> the record is <code>approve</code>."],
      ["D", "<b>Anything not listed falls back to <code>approve</code>.</b> Read that again. A state added later, by someone who forgets this map, <b>fails closed</b> &mdash; it demands the higher permission rather than the lower one."],
    ]),

    callout("<strong>&ldquo;Fail closed&rdquo; is the single most transferable idea in this chapter.</strong> When a future developer extends an enum and forgets the permission table, the system must become <i>more</i> restrictive, not less. Design every lookup table you write so that the missing case is the safe case. You will apply this again in Chapters 8 and 9.", "gold"),

    h2("And one subtlety about ordering"),
    bl([
      "On <code>PATCH /:id</code>, the flat <code>edit</code> permission runs <b>first</b>, then the validator, then the lifecycle check.",
      "On <code>POST /:id/transition</code>, the <b>validator runs first</b> &mdash; deliberately. The target state must be checked against the enum <i>before</i> the permission middleware uses that state to select which gate to apply.",
      "Otherwise a caller could send an unknown state and influence which permission was checked. That is the whole reason for the comment in the file.",
    ]),

    quiz("Why does <code>PATCH /:id</code> need <code>requireLifecyclePermissionOnPatch</code> in addition to <code>requirePermission(MODULE, \"edit\")</code>?",
      ["Defence in depth — two checks are always better than one",
       "Because <code>update</code> is <code>create.partial()</code>, which makes <code>status</code> patchable, so PATCH was a second, cheaper route to a state change that <code>/transition</code> gates properly",
       "Because PATCH is less secure than POST",
       "To log the change"],
      1,
      "This is finding API F-17 in the repo. Deriving the update schema from the create schema is convenient and correct-looking, but it silently exposed every lifecycle field to a route gated only by <code>edit</code>. The extra middleware applies the same gate as <code>/transition</code> &mdash; but only when the body actually carries the field."),
  ].join("\n")));

  // ------------------------------------------------------------- validator
  out.push(page("", F("FILE 2 &mdash; VALIDATOR"), [
    h1("File 2 &mdash; <code>lead.validator.js</code>"),
    lead("105 lines, and the largest file after the service. That ratio is intentional: this is the boundary where untrusted input becomes trusted data, and it is worth being verbose about."),

    cmd(`const schemas = {
  create: z.object({
    company_name: z.string().min(1),
    email: z.string().email().optional(),
    payment_terms_days: z.number().int().min(0).max(365).optional().nullable(),
    client_type_hint: z.enum(CLIENT_TYPE).optional().nullable(),
    /* … */
  }),
  update: z.object({ /* … */ }),
  transition: z.object({ to: z.enum(["CONTACTED", "QUALIFIED", "LOST"]) }),
  convert: z.object({ client: z.object({ client_type: z.enum(CLIENT_TYPE),
                                          payment_terms_days: z.number().int().min(0).max(365) }) }),
  aiTransition: z.object({ lead_id: z.string().uuid(), to: z.enum([...]) }),
  aiConvert:    z.object({ lead_id: z.string().uuid(), client: z.object({ … }) }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;   // ← the parsed value replaces the raw one
  return next();
};`),

    h2("The five lessons in that middleware factory"),
    lete([
      ["1", "<b><code>safeParse</code>, not <code>parse</code>.</b> No exception to catch; an explicit branch you can shape into the house error envelope."],
      ["2", "<b>422, not 400.</b> The body was well-formed JSON but semantically invalid. The distinction matters to clients that retry."],
      ["3", "<b><code>fieldErrors</code> is passed through.</b> That is what lets the front end highlight the offending input rather than showing one generic toast. The error envelope's <code>fields</code> key exists for exactly this."],
      ["4", "<b><code>req.body = p.data</code>.</b> Downstream code sees the <i>parsed</i> object &mdash; coerced, stripped of unknown keys, type-safe. Nothing after this line touches raw input."],
      ["5", "<b>Schemas are exported, not just the middleware.</b> <code>module.exports = { create: mw(\"create\"), …, schemas, INTAKE_CHANNEL, CLIENT_TYPE }</code>."],
    ]),

    callout("<strong>Lesson 5 is why the AI layer is safe.</strong> <code>lead.ai.js</code> imports <code>validator.schemas.aiTransition</code> and hands it to the action registry. The copilot's input is validated by <b>the same Zod object</b> as the HTTP path &mdash; not a parallel schema someone has to remember to update. One definition, two front doors. Chapter 9 builds on this.", "green"),

    h2("Why there are separate <code>ai*</code> variants"),
    bl([
      "REST takes the id from the URL: <code>POST /leads/:id/transition</code> with body <code>{ to }</code>.",
      "The AI action has no URL, so the id must be <i>in</i> the payload: <code>{ lead_id, to }</code>.",
      "Hence <code>aiTransition</code> = <code>transition</code> + <code>lead_id: z.string().uuid()</code>.",
      "The comment notes that <code>lead_id</code> resolves to a <code>list_leads</code> picker in the copilot form &mdash; the schema drives the UI too.",
    ]),

    quiz("A teammate adds a field to <code>create</code> but forgets <code>update</code>. What is the practical consequence?",
      ["A crash on the next PATCH",
       "The field can be set at creation but never edited — an inconsistency users hit weeks later and report as a bug",
       "Nothing; Zod merges the schemas",
       "CI fails immediately"],
      1,
      "The two schemas are written out separately in this module, which is explicit and readable but does allow exactly this drift. It is the trade-off against <code>create.partial()</code> &mdash; which caused API F-17 by making <i>everything</i> patchable. There is no free option here; the answer is a test that exercises both paths."),
  ].join("\n")));

  // ------------------------------------------------------------- controller
  out.push(page("", F("FILE 3 &mdash; CONTROLLER"), [
    h1("File 3 &mdash; <code>lead.controller.js</code>"),
    lead("Thirty lines for six endpoints. Most handlers are a single expression. This is what a controller should look like when the layering is honest."),

    cmd(`const actor = (req) => req.user || { user_id: null };

list: asyncHandler(async (req, res) =>
  res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),

get: asyncHandler(async (req, res) => {
  const r = await req.tenantDb((c) => service.get(c, req.params.id));
  if (!r) throw new AppError("NOT_FOUND", "Lead not found", 404);
  res.json({ data: r });
}),

create: asyncHandler(async (req, res) =>
  res.status(201).json({ data: await req.tenantDb((c) =>
    service.create(c, { data: req.body, actor: actor(req) })) })),`),

    h2("What the controller is responsible for, exactly"),
    stack([
      ["<b>Acquiring the connection</b>", "<code>req.tenantDb(c =&gt; …)</code>. The controller owns the connection scope; the service receives a client and never knows where it came from."],
      ["<b>Translating &lsquo;nothing found&rsquo;</b>", "The service returns <code>null</code>; the controller turns that into <code>404</code>. HTTP semantics live at the HTTP layer."],
      ["<b>Choosing the status code</b>", "<code>201</code> for create, <code>200</code> for the rest."],
      ["<b>Shaping the envelope</b>", "Everything comes back as <code>{ data: … }</code>. Consistency is what makes a generic client possible."],
      ["<b>Identifying the actor</b>", "<code>req.user || { user_id: null }</code>, passed down so the service can write audit rows."],
    ]),

    h2("<code>asyncHandler</code>, and why it is not optional"),
    callout("Express 4 does not catch rejected promises from an async handler. Without a wrapper, a thrown error inside <code>async (req,res)</code> becomes an <b>unhandled rejection</b> &mdash; the request hangs until it times out, and in some Node versions the process dies. Every handler here is wrapped. The repo also loads <code>shared/http/async-safe</code> as the <b>very first line of <code>server.js</code></b>, as a belt-and-braces backstop, precisely because forgetting the wrapper is so easy.", "red"),

    h2("The dossier endpoint, and a rule about money"),
    cmd(`dossier: asyncHandler(async (req, res) => {
  const canSee = await canSeeFinancials(req);
  res.json({ data: await req.tenantDb((c) =>
    sales360.leadDossier(c, { leadId: req.params.id, canSeeFinancials: canSee })) });
}),`),
    bl([
      "The route gates this on <code>view</code>, because the dossier aggregates records the caller can already open one screen at a time.",
      "But <b>money is gated separately</b>, on the same finance-visibility check the party masters use &mdash; not a second rule invented here.",
      "And hidden money comes back as <code>null</code>, <b>not zero</b>. Zero is a fact; null is an absence. Showing a pipeline value of 0 to someone who is not allowed to see it is a lie the UI will happily total up.",
    ]),

    quiz("Why does the controller call <code>canSeeFinancials(req)</code> instead of the service doing it?",
      ["Because it is faster in the controller",
       "Because it needs <code>req</code> — it is a property of the caller, not of the data — and the service must stay callable from jobs and the AI layer where no request exists",
       "Because services cannot be async",
       "To avoid a circular import"],
      1,
      "This is the layering rule doing real work. Anything derived from <code>req</code> is resolved at the HTTP boundary and passed <i>down</i> as a plain value. If the service reached for <code>req</code>, it would break the moment a queue handler or the copilot called it — and those callers are exactly where a forgotten permission becomes a data leak."),
  ].join("\n")));

  // ------------------------------------------------------------- service
  out.push(page("", F("FILE 4 &mdash; SERVICE"), [
    h1("File 4 &mdash; <code>lead.service.js</code>"),
    lead("192 lines, the biggest file in the module, and rightly so. This is where the business lives. Every line here is a decision someone had to make about how the business actually works."),

    cmd(`async function create(client, { data, actor = {} }) {
  return atomically(client, async () => {
    const row = await repo.insert(client, {
      company_name: data.company_name,
      source: data.source || "MANUAL",
      intake_channel: data.intake_channel || data.source || "MANUAL",
      status: "NEW",
      owner_user_id: data.owner_user_id || actor.user_id || null,
      details_json: JSON.stringify(data.details || {}),
      /* … */
    });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE,
                              entityRef: ref(row.lead_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED,
                          moduleKey: events.MODULE, entityRef: ref(row.lead_id), after: row });
    return row;
  });
}`),

    h2("The anatomy of a write"),
    lete([
      ["1", "<b>Wrap in <code>atomically</code>.</b> The row, the event and the audit entry commit together or not at all. An audit row for a lead that does not exist is worse than no audit row."],
      ["2", "<b>Defaults are explicit and visible.</b> <code>status: \"NEW\"</code>, <code>source || \"MANUAL\"</code>. Read in one place, not scattered as column defaults in a migration."],
      ["3", "<b>Ownership falls back to the actor.</b> <code>data.owner_user_id || actor.user_id || null</code> &mdash; you own what you create unless you say otherwise."],
      ["4", "<b>Emit an event, then audit.</b> Two different things: the event drives downstream behaviour, the audit row is the permanent record of who did what."],
      ["5", "<b>Return the row.</b> The controller wraps it; the service does not know about HTTP."],
    ]),

  ].join("\n")));

  out.push(page("", F("FILE 4 &mdash; SERVICE (CONT.)"), [
    h1("The State Machine, Enforced"),
    lead("Nine lines in a separate file, and two independent checks that use them."),

    cmd(`// lead.rules.js — the entire file
const NEXT = { NEW:       ["CONTACTED", "LOST"],
               CONTACTED: ["QUALIFIED", "LOST"],
               QUALIFIED: ["CONVERTED", "LOST"],
               CONVERTED: [], LOST: [] };

function assertTransition(from, to) {
  if (!NEXT[from] || !NEXT[from].includes(to))
    throw new AppError("BAD_STATE", \`Cannot move lead \${from} -> \${to}\`, 422);
  return true;
}`),
    bl([
      "<b><code>CONVERTED</code> and <code>LOST</code> are terminal</b> &mdash; empty arrays. Not a comment saying so; a structure that makes it impossible.",
      "<code>update()</code> enforces the same idea separately: editing a <code>CONVERTED</code> or <code>LOST</code> lead throws <code>LOCKED</code> with 422.",
      "<b>Both checks read <code>before</code> from the repo first.</b> The rule is applied to the row's actual current state, never to a state the client claimed.",
    ]),

    callout("<strong>Never trust the client's idea of the current state.</strong> A client that sends <code>{ from: \"NEW\", to: \"CONVERTED\" }</code> is telling you what it believes, possibly from a stale page open since this morning. The service reads the row, then judges. This is also, incidentally, how you avoid a whole class of race condition.", "gold"),

    quiz("<code>update()</code> throws <code>LOCKED</code> (422) for a CONVERTED lead. Why not 403?",
      ["403 is for authentication failures only",
       "Because it is not a permissions problem — the caller may well have <code>edit</code>; the record's state forbids it. 403 would send an admin hunting through the role matrix for a grant that would not help",
       "422 is the default for all business errors",
       "403 would break the client's retry logic"],
      1,
      "Status codes are diagnostic instructions to whoever reads the log at 2am. 403 says &ldquo;this user lacks a grant&rdquo; and sends someone to the permission matrix. 422 with <code>LOCKED</code> says &ldquo;the request was understood and refused on business grounds&rdquo;. Choosing the code that points at the real cause is a recurring theme &mdash; you saw it with <code>WRONG_HOST</code> and the CORS 403."),
  ].join("\n")));

  // ------------------------------------------------------------- repo
  out.push(page("", F("FILE 5 &mdash; REPO"), [
    h1("File 5 &mdash; <code>lead.repo.js</code>"),
    lead("57 lines containing every SQL statement in the module. Small, boring, and the most security-sensitive file in the folder."),

    cmd(`const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const insert = (client, data) => insertOne(client, "lead", data);
const get    = (client, id)   => getById(client, "lead", "lead_id", id);

async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "lead", "lead_id", id, fields, "*", null, { touch: "updated_at" });
}`),

    h2("Read that comment again"),
    callout("<strong>&ldquo;Was a hand-rolled SET builder, which bypassed the identifier validation and allow-list.&rdquo;</strong> Someone wrote a perfectly reasonable <code>UPDATE lead SET x = $1, y = $2</code> builder. It worked. It also constructed column names by string concatenation from an object whose keys came, ultimately, from a request body. The shared helper exists so that no module has to get this right individually &mdash; and the lesson is that <b>the unsafe version looks completely normal</b>.", "red"),

    h2("The empty-patch guard"),
    bl([
      "<code>if (!Object.keys(fields).length) return get(client, id);</code>",
      "An <code>UPDATE</code> with no <code>SET</code> clause is a syntax error, so the naive version crashes on an empty patch.",
      "Returning the current row is the honest answer to &ldquo;change nothing&rdquo;. It also means <code>PATCH</code> with an empty body is <b>idempotent and harmless</b> rather than a 500.",
    ]),

    h2("The list query, and the pagination helper"),
    cmd(`async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.status)       { params.push(q.status);       wh.push("status = $" + params.length); }
  if (q.owner_user_id){ params.push(q.owner_user_id);wh.push("owner_user_id = $" + params.length); }
  if (q.q)            { params.push("%" + q.q + "%");
                        wh.push("(company_name ILIKE $" + params.length + " OR …)"); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(
    "SELECT * FROM lead " + where + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params);
  return rows;
}`),
    bl([
      "<b>The SQL string is concatenated, but no user value ever enters it.</b> Only <code>$n</code> placeholders do. Values go in <code>params</code>. This is the distinction that matters &mdash; not &ldquo;never build SQL with <code>+</code>&rdquo;, but &ldquo;never let a value become syntax&rdquo;.",
      "<code>page(q)</code> centralises limit/offset parsing, including the maximum page size. Without it, <code>?limit=1000000</code> is a denial-of-service.",
      "<code>ORDER BY created_at DESC</code> is always present. An unordered paginated query returns arbitrary rows per page &mdash; Postgres makes no promise otherwise.",
    ]),

  ].join("\n")));

  out.push(page("", F("FILE 5 &mdash; REPO (CONT.)"), [
    h1("The Repo's Two Lookup Helpers"),
    lead("Four lines of SQL each, and both exist because of something that went wrong."),

    callout("<strong><code>clientTypeIdByCode()</code> exists because of a 42703.</strong> <code>client_master</code> has a <code>client_type_id</code> FK and no <code>client_type</code> column. The convert path passed the <i>code</i> straight through to <code>insertOne</code> with a null allow-list &mdash; which puts every key into the INSERT column list verbatim. Postgres answered <code>column client_type of relation client_master does not exist</code>, conversion failed for <b>every</b> lead, and <b>the unit test did not see it, because it mocks <code>clientMaster.create</code></b>.", "red"),
    val("<strong>That last clause is the lesson of Chapter 6, arriving early.</strong> A mock is an assumption about a boundary, written down. When the assumption is wrong, the mock does not just fail to catch the bug &mdash; it actively certifies the broken code as working. This is why this repo has a <code>check-query-columns</code> gate that verifies every queried column actually exists in the schema."),

    h2("And a rule about defaults"),
    cmd(`// The tenant's default corporate entity, or null when genuinely ambiguous.
// One active entity is a default, two is a question. Never "the oldest" —
// that files a client, and its reference number, under the wrong company.
async function defaultEntityId(client) {
  const { rows } = await client.query(
    "SELECT entity_id FROM corporate_entity WHERE is_active IS NOT false LIMIT 2");
  return rows.length === 1 ? rows[0].entity_id : null;
}`),
    callout("<strong>&ldquo;One is a default, two is a question.&rdquo;</strong> Memorise that phrase. The tempting implementation is <code>LIMIT 1</code>, which always returns something and is always confidently wrong half the time. <code>LIMIT 2</code> lets you distinguish &ldquo;unambiguous&rdquo; from &ldquo;I must ask&rdquo;. Note also <code>is_active IS NOT false</code> rather than <code>= true</code> &mdash; it treats <code>NULL</code> as active, which is what an un-backfilled column means.", "gold"),
  ].join("\n")));

  // ------------------------------------------------------------- ai + events
  out.push(page("", F("FILES 6&ndash;8 &mdash; RULES, EVENTS, AI"), [
    h1("Files 6&ndash;8 &mdash; The Small Ones"),
    lead("Twenty-nine lines between them, and they connect this module to three whole subsystems."),

    h2("<code>lead.events.js</code> &mdash; 3 lines"),
    cmd(`module.exports = { MODULE: "MOD-20",
  CREATED: "lead.created", UPDATED: "lead.updated", CONVERTED: "lead.converted",
  transition: (status) => "lead." + String(status).toLowerCase() };`),
    bl([
      "Event names are <b>constants, never string literals at the call site</b>. A typo in <code>\"lead.creted\"</code> would emit an event nobody subscribes to &mdash; silently.",
      "<code>transition</code> is a <i>function</i>, so <code>lead.contacted</code>, <code>lead.qualified</code> and <code>lead.lost</code> are generated rather than listed. Add a state and the event name follows for free.",
      "<code>MODULE</code> lives here too, so the event system and the permission system agree on the module's identity by construction.",
    ]),

  ].join("\n")));

  out.push(page("", F("FILE 8 &mdash; THE AI MANIFEST"), [
    h1("File 8 &mdash; <code>lead.ai.js</code>"),
    lead("Seventeen lines that connect this module to the copilot &mdash; and the single most important architectural idea in the repository."),

    cmd(`module.exports = {
  entity: "lead", module_key: "MOD-20", screens: [],
  reads: [
    { key: "list_leads", service: (c, p) => service.list(c, p),
      permission: { module: "MOD-20", action: "view" },
      describe: "List sales leads (filter status/owner/intake_channel)." },
  ],
  writes: [
    { key: "transition_lead", service: (c, p) => service.transition(c, { id: p.lead_id, to: p.to }),
      schema: validator.schemas.aiTransition,
      permission: { module: "MOD-20", action: "edit" },
      confirm: true,
      describe: "Advance a lead by id to CONTACTED/QUALIFIED/LOST." },
  ],
};`),

    h2("Five properties, five guarantees"),
    table("mst", ["Key", "Guarantee"], [
      ["<code>service</code>", "The AI calls <b>the same service function</b> the HTTP controller calls. There is no parallel implementation to drift, and no way for the copilot to skip a business rule."],
      ["<code>schema</code>", "The <b>same Zod schema</b> validates the model's arguments. A hallucinated field is stripped; a malformed one is rejected before any code runs."],
      ["<code>permission</code>", "The <b>same module/action pair</b> as the REST route. The copilot can never do more than the logged-in user could do by hand."],
      ["<code>confirm</code>", "<code>true</code> on every write. The user is shown what is about to happen and must approve it. Reads do not ask."],
      ["<code>describe</code>", "The natural-language description the model actually reads when choosing a tool. <b>This is prompt engineering inside the codebase</b> — Chapter 12 returns to it."],
    ]),

    callout("<strong>This is the most important architectural idea in the repo.</strong> The AI surface is not a new set of capabilities bolted on beside the application &mdash; it is a <b>manifest over the capabilities that already exist</b>, reusing their services, their schemas and their permissions. Every AI safety property follows from that one decision. Chapter 9 shows the registry that enforces it.", "green"),

    ex("Read the descriptions as prompts", "15 min",
      "<p>Look at the <code>describe</code> strings above. <code>convert_lead</code>'s says the <code>client</code> block <b>MUST</b> carry <code>client_type</code> and <code>payment_terms_days</code>, and that &ldquo;the legacy's silent fallback to BOTH/30 is gone&rdquo;. Why is that sentence in a field the <i>model</i> reads? What would happen if it just said &ldquo;Convert a lead into a client&rdquo;?</p>",
      "Because the model uses it to …, and a vague description would cause …"),

    quiz("Could an engineer give the copilot a capability that no HTTP route exposes?",
      ["No — the manifest can only reference existing routes",
       "Yes, by pointing <code>service</code> at any service function; which is exactly why the action registry, not the manifest, is the safety boundary",
       "No, the schema prevents it",
       "Only with a platform-admin token"],
      1,
      "The manifest is <i>declarative</i>, and a declaration is only as trustworthy as whatever validates it. That is why <code>doc/CONVENTIONS.md</code> is explicit that <code>src/services/ai/action-registry.js</code> is the safety boundary, and why an action also needs a row in <code>ai_action_catalogue</code> with a <code>payload_schema</code>. Two independent places must agree before the copilot can do anything."),
  ].join("\n")));

  // ------------------------------------------------------------- lab
  out.push(page("", F("LAB 3 &mdash; DISSECTION"), [
    band("L3", "Lab &mdash; Dissect A Module You Have Never Seen", "WEEK 1 &middot; <b>HANDS ON</b> &middot; ~90 MIN", "lab"),
    lead("You have read <code>sales/lead</code> with a guide. Now prove the shape transfers: pick a module nobody has explained to you and read it cold."),

    h2("Step 1 &mdash; Choose"),
    cmd(`ls src/modules/*/ -d | head -40

# Pick one you know nothing about. Good candidates:
#   src/modules/procurement/…    src/modules/wms/…
#   src/modules/fleet/…          src/modules/costing/…
# Avoid: sales/lead (done), and anything in platform/ (different auth model)`),

    ex("The cold read", "45 min",
      "<p>For your chosen module, answer without asking anyone: (1) What is its <code>MODULE</code> key and <code>basePath</code>? (2) How many endpoints, and what permission does each need? (3) Does it have a lifecycle? If so, draw the state machine. (4) Does it emit events? Which? (5) Does it have an AI manifest, and does every write have <code>confirm: true</code>? (6) Name one thing it does that <code>sales/lead</code> does not.</p>",
      "1. … 2. … 3. … 4. … 5. … 6. …"),

    h2("Step 2 &mdash; Find the scar tissue"),
    ex("Find a comment that documents a bug", "20 min",
      "<p>Search your module &mdash; and its neighbours if needed &mdash; for a comment that explains a past defect, the way the <code>clientTypeIdByCode</code> and <code>trust proxy</code> comments do. Quote it. Then write what you think the incident looked like from the client's side on the day it happened.</p>",
      "Comment: … / From the client's side: …"),

    callout("<strong>This exercise has a second purpose.</strong> You are learning the house comment standard. Comments in this repo explain <b>why</b>, and specifically why <i>not</i> the obvious alternative. &ldquo;Increment the counter&rdquo; above <code>i++</code> is noise. &ldquo;LIMIT 2 because one is a default and two is a question&rdquo; is the most valuable line in the file. Write the second kind.", "gold"),

    h2("Step 3 &mdash; Compare"),
    ex("Where does it deviate?", "25 min",
      "<p>List every way your module's structure differs from the eight-file canon. For each deviation, decide: is this a legitimate variation (the module genuinely has no lifecycle, so no <code>.rules.js</code>), or is it drift (SQL in the service)? Be specific, and be prepared to defend your call to your onboarding lead.</p>",
      "Deviation → legitimate/drift, because …"),
  ].join("\n")));

  // ------------------------------------------------------------- gate 1
  out.push(page("", F("GATE 1 &mdash; END OF WEEK ONE"), [
    band("G1", "Gate 1 &mdash; End of Week One", "<b>PROVE IT</b> &middot; SIGNED OFF BY YOUR ONBOARDING LEAD", "qa"),
    lead("The first of four gates. You do not proceed to Week 2 until every box is ticked and a human has confirmed the demonstration items. This mirrors how the repo itself works: gates, not good intentions."),

    rgroup("G1.1", "Environment", [
      "The full compose stack runs and I can bring it up from cold in under ten minutes.",
      "A tenant is provisioned; I can log in as a tenant admin and as a platform admin.",
      "<code>npm run ci</code> passes on an unmodified checkout.",
      "I can explain what each of the eight compose services does.",
    ]),
    rgroup("G1.2", "Architecture", [
      "I can draw the request pipeline from socket to SQL from memory.",
      "I can explain schema-per-tenant and why <code>search_path</code> beats a <code>WHERE</code> clause.",
      "I can explain how a module gets mounted without anyone editing a route table.",
      "I can state the layer rule and give an example of violating it.",
    ]),
    rgroup("G1.3", "The module shape", [
      "I can name all eight files and each one's single responsibility.",
      "I can explain why the AI manifest reuses the service, schema and permission.",
      "I can explain &ldquo;fail closed&rdquo; using the transition-action map.",
      "I can explain why hidden money is <code>null</code> and not <code>0</code>.",
    ]),
    rgroup("G1.4", "Demonstrate to your lead", [
      "<b>Walk them through <code>sales/lead</code></b> in ten minutes, unprepared.",
      "<b>Present your cold-read module</b> from Lab 3 and defend your drift calls.",
      "<b>Show the comment you found</b> and tell the incident story.",
      "Ask them the one question about the codebase you most want answered.",
    ]),

    dod(["Stack running", "CI green", "Module read cold", "Walkthrough delivered", "Lead signed off"]),

    val("<strong>Week 1 done. Here is what changed:</strong> you arrived able to write SQL and read Python. You can now navigate a 1,225-file codebase, explain its request lifecycle, read any of its 131 modules unaided, and run its full verification suite. You have not yet written a line of it. <b>That was deliberate</b> &mdash; and from here on, everything you write goes into a system you actually understand."),

    callout("<strong>Next week you build.</strong> Chapter 4 is the database: schema, migrations, the query helpers, transactions and the three-layer identifier defence. Chapter 5 is your first module. Chapter 6 is proving it works. Come back with the stack running.", "green"),
  ].join("\n")));

  return out;
}
