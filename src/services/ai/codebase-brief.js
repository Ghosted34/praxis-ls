/**
 * What a model has to know about THIS repository before it explains an error in it.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The Error Centre's explanation prompt was lifted verbatim from
 * `doc/PROMPT_ErrorMonitor_Module.md` §7.4, which opens "You are an expert
 * backend developer specializing in Node.js/NestJS debugging." The spec was
 * written against an ASSUMED stack — `doc/TESTING_ErrorMonitor_Module.md` §0
 * records the divergence for the routes, the tables and the exception filters,
 * but the sentence inside the prompt kept telling the model the stack was
 * NestJS.
 *
 * A model told that answers accordingly. A real production notice — a 422 on
 * POST /api/tenant/mail/send — came back explained in terms of a `SendMailDto`,
 * a `MailModule`, class-validator decorators and NestJS's ValidationPipe. Not
 * one of those exists in this repo. Every word of it was fluent, plausible, and
 * about somebody else's codebase, and the ops lead it is written for has no way
 * to tell. That is worse than no explanation: it sends whoever acts on it to
 * look for a file that was never there.
 *
 * So the facts live here, in one place, next to the model that is given them.
 *
 * ── The rule for what may go in ─────────────────────────────────────────────
 *
 * Only claims that are TRUE OF THE TREE AS COMMITTED and that are pinned by
 * `tests/unit/error-monitor-flows.test.js` — a brief that quietly rots is the
 * same failure again with a different accent. Add a fact here and add the check
 * that proves it there.
 *
 * ── And what may not ────────────────────────────────────────────────────────
 *
 * FILE NAMES, NOT FILE CONTENTS. The explanation goes to a third-party vendor
 * (DeepSeek, falling back to Gemini). Stack frames already name paths, so
 * naming a module's files alongside them tells the vendor nothing new; pasting
 * the source of those files is a different decision, about shipping the product
 * to a vendor, and it is not one this service gets to make on its own.
 */

"use strict";

const fs = require("fs");
const path = require("path");

/**
 * The stack, the layout and the conventions — stated as fact, because every
 * line of it is checked.
 *
 * Written for a reader that has one job: to not invent a NestJS codebase. The
 * "what does not exist" list earns its place — naming the absent thing is what
 * stops a model reaching for the shape it has seen ten thousand times.
 */
const CODEBASE_BRIEF = `PRAXIS LS — the codebase these errors come from. Every line here is fact.

RUNTIME
- Node 20, Express 4, CommonJS (\`require\` / \`module.exports\`). The server is
  plain JavaScript — no TypeScript, no build step, no decorators.
- NOT NestJS. There are no modules-with-decorators, no DTO classes, no
  dependency-injection container, no \`@Injectable\`, no \`ValidationPipe\`, no
  class-validator, no TypeORM and no Prisma. If an explanation needs one of
  those to be true, the explanation is wrong.
- PostgreSQL through \`pg\`, with hand-written SQL in \`*.repo.js\`. No ORM.
- Multi-tenant: one platform database plus one database per tenant. A handler
  reaches business data through \`req.tenantDb(fn)\` and identity data through
  \`req.identityDb(fn)\`.
- Background work is BullMQ workers under \`src/jobs/\`.

HTTP SURFACE
- Everything is mounted under \`/api\`: \`/api/tenant/*\` is the tenant app's API,
  \`/api/platform/*\` is the admin console's. A route in an error report is the
  mounted path, so \`POST /api/tenant/mail/send\` lives in the mail module.

HOW A MODULE IS LAID OUT
  src/modules/<area>/<module>/
    <module>.routes.js      paths, and the middleware chain on each
    <module>.controller.js  thin — reads req, calls the service, sends JSON
    <module>.service.js     the rules
    <module>.repo.js        the SQL
    <module>.validator.js   Zod schemas + the middleware built from them
- Cross-cutting code: \`src/shared/**\` (observability, http, rbac, db),
  \`src/services/**\`, \`src/middleware/**\`. Schema changes are numbered SQL files
  under \`migrations/\`.
- Front ends: \`client/\` (the tenant app) and \`platform-console/\` (the admin
  console), both React 18 + Vite + TypeScript. A browser-origin error is from
  one of those.
- Tests: Jest under \`tests/\` for the server; Vitest beside the source for the
  front ends.

VALIDATION AND ERRORS — read this before explaining any 4xx
- Request bodies are validated with ZOD. A validator module holds a \`schemas\`
  map and exports one middleware per schema; on failure it hands the next()
  callback an AppError whose code is VALIDATION_ERROR, whose status is 422 and
  whose details are Zod's \`error.flatten().fieldErrors\` — an object keyed by
  field name. Fixing a validation error means editing that Zod schema, not a
  DTO class.
- \`AppError(code, message, status, details)\` comes from \`src/utils/errors.js\`.
- \`src/middleware/error-handler.js\` is the one place that turns an error into a
  response: \`{ error: { code, message, fields }, request_id }\`.
- A report whose name is \`ValidationError\` and whose message reads
  \`VALIDATION_ERROR: <field>, <field>\` is SYNTHETIC — \`error-handler.js\` builds
  it from the failing field NAMES so the feed can group them, and its single
  stack frame is the route, not a code location. Do not describe that frame as
  where the fault is: the fault is in the schema for those fields, and the
  values that failed are not in the report.`;

/* ── Where the code for a route actually is ───────────────────────────────── */

const MODULES_ROOT = path.join(__dirname, "..", "..", "modules");
const MAX_FILES = 8;

/** lookup key → [{ dir, rank }], rank 0 exact and 1 by part. Built on first use. */
let index = null;

/**
 * `chart-of-accounts` and `chart_of_accounts` are the same word; so are
 * `clients` and `client_master`.
 *
 * A route segment is plural and kebab-cased (`/expense-rates`, `/clients`)
 * where the directory serving it is singular and snake-cased (`expense_rate`,
 * `client_master`) — a convention, not an accident. Matching raw segments
 * resolved barely a third of the mounted surface; normalising the punctuation,
 * trying the singular, and indexing each part of a compound directory name
 * takes it past four fifths. The rest are modules genuinely named something
 * else, and those get no hint rather than a wrong one.
 */
const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** The spellings a route segment might be filed under. */
const forms = (s) => {
  const k = key(s);
  const out = new Set([k]);
  if (k.endsWith("ies")) out.add(`${k.slice(0, -3)}y`);
  if (k.endsWith("es")) out.add(k.slice(0, -2));
  if (k.endsWith("s")) out.add(k.slice(0, -1));
  return [...out].filter(Boolean);
};

/**
 * `src/modules/<area>/<module>` and `src/modules/<area>`, by directory name.
 *
 * Read from the tree rather than listed here: a hand-maintained map is a second
 * statement of the layout that stops being true the first time somebody adds a
 * module, and a wrong path in an explanation is exactly the failure this file
 * exists to prevent. Best-effort throughout — a brief with no location hint is
 * still a good brief, and a missing directory must never cost anybody the
 * explanation they asked for.
 */
function moduleIndex() {
  if (index) return index;
  index = new Map();
  const add = (name, dir, rank) => {
    const list = index.get(name) || [];
    if (!list.some((e) => e.dir === dir)) list.push({ dir, rank });
    index.set(name, list);
  };
  const enter = (name, dir) => {
    add(key(name), dir, 0);
    // `client_master` answers to `clients`, `iam_role` to `roles`. A part match
    // ranks below an exact one so `currency` still beats `currency_rate` for
    // `/currencies`.
    const parts = String(name).split(/[_-]/).filter((x) => x.length > 2);
    if (parts.length > 1) for (const part of parts) add(key(part), dir, 1);
  };
  try {
    for (const area of fs.readdirSync(MODULES_ROOT, { withFileTypes: true })) {
      if (!area.isDirectory()) continue;
      enter(area.name, `src/modules/${area.name}`);
      for (const mod of fs.readdirSync(path.join(MODULES_ROOT, area.name), { withFileTypes: true })) {
        if (!mod.isDirectory()) continue;
        enter(mod.name, `src/modules/${area.name}/${mod.name}`);
      }
    }
  } catch {
    /* @silent:storage no module tree to read — the brief stands without it */
  }
  return index;
}

/**
 * The files in a module directory, so the hint names something openable.
 *
 * The five conventional files first, in the order a fault is usually traced
 * through them — alphabetical order put `access.js` and `autodiscover.js` in
 * front of `mail.validator.js` for a validation error, which is the one file
 * that mattered. Everything else follows, and the list is capped: a directory
 * of thirty files listed in full is not a hint.
 */
const ROLE_ORDER = [".routes.js", ".controller.js", ".validator.js", ".service.js", ".repo.js"];

function filesIn(dir) {
  try {
    const all = fs.readdirSync(path.join(MODULES_ROOT, "..", "..", dir))
      .filter((f) => f.endsWith(".js"))
      .sort();
    const rank = (f) => {
      const i = ROLE_ORDER.findIndex((suffix) => f.endsWith(suffix));
      return i === -1 ? ROLE_ORDER.length : i;
    };
    return all.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_FILES);
  } catch {
    return [];
  }
}

/**
 * "POST /api/tenant/mail/send" → the directories that route is served from.
 *
 * The deepest match wins and only the first two path segments are consulted:
 * `/api/tenant/mail/send` is the mail module, `send` is a verb inside it, and
 * offering a "send" module that does not exist would be the invention this is
 * here to stop. Returns [] when nothing matches — silence beats a guess.
 */
function locateRoute(route) {
  const p = String(route || "").replace(/^[A-Z]+\s+/, "").split("?")[0];
  const segs = p.split("/").filter(Boolean).filter((s) => s !== "api");
  if (!segs.length) return [];
  const ns = ["tenant", "platform"].includes(segs[0].toLowerCase()) ? segs.shift() : null;
  const idx = moduleIndex();
  const found = [];
  for (const seg of segs.slice(0, 2)) {
    const hits = forms(seg).flatMap((f) => idx.get(f) || []);
    // `/api/platform/errors` is `src/modules/platform/errors`, never
    // `src/modules/master/errors` — the namespace is a real narrowing when two
    // areas happen to share a module name.
    const scoped = ns && hits.some((h) => h.dir.includes(`/${ns}/`))
      ? hits.filter((h) => h.dir.includes(`/${ns}/`))
      : hits;
    for (const h of scoped) if (!found.some((e) => e.dir === h.dir)) found.push(h);
  }
  // Exact names before part matches, and the deepest first within each:
  // `src/modules/mail/mail` is where the route is served, `src/modules/mail` is
  // the area around it.
  return found
    .sort((a, b) => a.rank - b.rank || b.dir.split("/").length - a.dir.split("/").length)
    .map((e) => e.dir);
}

/**
 * The location hint for one error's route, as prompt text.
 *
 * Deliberately phrased as a candidate rather than an answer: the route maps to
 * a directory, and which file in it is at fault is the model's job to read out
 * of the trace.
 */
function whereToLook(route) {
  const dirs = locateRoute(route).slice(0, 3);
  if (!dirs.length) return null;
  return [
    "Candidate location for this route (from the module tree, not a guess):",
    ...dirs.map((d) => {
      const files = filesIn(d);
      return files.length ? `  ${d}/ — ${files.join(", ")}` : `  ${d}/`;
    }),
  ].join("\n");
}

module.exports = { CODEBASE_BRIEF, locateRoute, whereToLook };
