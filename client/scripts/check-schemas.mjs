#!/usr/bin/env node
/**
 * Shared-schema gate — a schema must be used by BOTH sides, or it is not shared.
 *
 * `check:shared` already proves the package RESOLVES, parses, and gives both
 * halves one Zod instance. It cannot see the failure this catches, which is
 * organisational rather than mechanical:
 *
 *   - a schema lands in `packages/shared` and only the API imports it, so the
 *     client keeps its `canSubmit` boolean and the drift F12 describes carries
 *     on with an extra file to maintain;
 *   - or only the CLIENT imports it, and the API keeps validating with its own
 *     copy — the worse direction, because now two definitions disagree AND one
 *     of them is the one that decides what gets written;
 *   - or a module's validator is migrated, someone later adds a rule back into
 *     the Express file, and the shared schema silently stops being the truth.
 *
 * That last one is the reason this is a build gate rather than a code review
 * item. `packages/shared` existed for two phases with exactly one domain in it,
 * and nothing anywhere said so.
 *
 * WHAT IT ASSERTS
 *
 *   1. Every domain exported from `packages/shared/index.js` is imported by the
 *      API somewhere under `src/`.
 *   2. …and by the client somewhere under `client/src/`.
 *   3. No API validator that has been migrated still declares its own `z.object`
 *      — a migrated file is an adapter, and a `z.object` in it means the rules
 *      came back.
 *   4. Every field in the corporate-entity master shape has a control that can
 *      write it — see WHY RULE 4 below.
 *
 * Rule 3 has an escape hatch (`ALLOW_LOCAL_SCHEMA`) for a validator that
 * genuinely needs a local shape — a query-string parser, say — and each entry
 * carries its reason.
 *
 * WHY RULE 4
 *
 * Rules 1-3 prove a schema is IMPORTED by both sides. That is not the same as
 * being USABLE, and the difference cost the corporate-entity module twenty
 * fields. `entity-common.js` was imported by the client — for RELATIONSHIP_TYPES
 * and PERSON_ROLES — so rule 1 passed, while `share_capital`,
 * `share_capital_paid_up`, `incorporation_place`, `email`, `phone` and fifteen
 * others were accepted by PATCH /entities/:id, listed in the repo's WRITABLE
 * allow-list, and rendered on the dossier's Overview tab, with no input anywhere
 * in the client. They could only ever read `—`.
 *
 * That was not cosmetic. `rules.readiness()` requires `share_capital` and a
 * public email or phone before an entity "can print a compliant letterhead", so
 * the dossier's amber "not yet complete for statutory documents" callout was
 * permanently unsatisfiable through the UI; the letterhead's share-capital
 * block — "mandatory on French invoices" — could be switched on but never
 * filled; and the cap table's CAPITAL_MISMATCH check, which compares issued
 * shares against `share_capital`, could never fire.
 *
 * A field with no control is a field that does not exist to the person using the
 * system, however well the schema is shared. Hence: the shape is the checklist.
 *
 *   node scripts/check-schemas.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const require = createRequire(import.meta.url);

/* ── what the package offers ──────────────────────────────────────────────── */

const shared = require(join(repoRoot, "packages", "shared", "index.js"));
/** `common` is primitives, consumed by the other schemas rather than directly. */
const INTERNAL = new Set(["common"]);
const domains = Object.keys(shared).filter((k) => !INTERNAL.has(k));

/* ── who imports it ───────────────────────────────────────────────────────── */

function filesUnder(dir, re) {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", dir],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter((f) => f && re.test(f) && existsSync(join(repoRoot, f)));
}

const apiFiles = filesUnder("src", /\.js$/);
const clientFiles = filesUnder("client/src", /\.tsx?$/).filter(
  (f) => !/\.test\.tsx?$/.test(f),
);

/** Which domains a file names, from its `@praxis/shared` / `@shared` import. */
function importedDomains(text) {
  const found = new Set();

  /*
   * Form 1 — property access: `require("@praxis/shared").pwaDesign`.
   *
   * Usually written as `const { a, b } = require("@praxis/shared").pwaDesign`,
   * which reaches PAST the domain to destructure its members. That form is why
   * this branch exists: matching only the braces harvested `effectivePwa` and
   * `iconLayout` as though they were domains, and reported the domain that IS
   * imported — pwaDesign — as used by nobody. A gate that reports a false
   * failure gets an exemption added to shut it up, and then it is worth nothing.
   */
  for (const m of text.matchAll(
    /require\(\s*["']@(?:praxis\/)?shared["']\s*\)\s*\.\s*(\w+)/g,
  ))
    found.add(m[1]);

  /*
   * Form 2 — destructuring the package root: `const { ledger } = require(…)`,
   * `import { journalEntry } from "@shared"`. The negative lookahead excludes
   * form 1, whose braces name members rather than domains.
   */
  const re =
    /(?:const|import)\s*\{([^}]*)\}\s*(?:=\s*require\(|from\s*)["']@(?:praxis\/)?shared["'](?!\s*\)\s*\.)/g;
  for (const m of text.matchAll(re)) {
    for (const part of m[1].split(",")) {
      // `{ journalEntry: schemas }` and `{ ledger as rules }` both name the
      // domain on the LEFT. Split on a real `:` or a whole-word `as` — an
      // earlier version used the character class `[:as]`, which also split
      // inside identifiers ("journalEntry" contains an "a") and reported every
      // domain as unused. A leading `type` is TypeScript's inline type import.
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s*(?::|\bas\b)\s*/)[0]
        .trim();
      if (name) found.add(name);
    }
  }
  return found;
}

const apiUses = new Set();
const clientUses = new Set();
for (const f of apiFiles)
  importedDomains(readFileSync(join(repoRoot, f), "utf8")).forEach((d) =>
    apiUses.add(d),
  );
for (const f of clientFiles)
  importedDomains(readFileSync(join(repoRoot, f), "utf8")).forEach((d) =>
    clientUses.add(d),
  );

/* ── rule 3: a migrated validator must not re-declare rules ───────────────── */

/** Validators allowed to keep a local `z.object`, each with the reason. */
const ALLOW_LOCAL_SCHEMA = {
  // (none yet — add `"src/modules/x/x.validator.js": "why"` when one earns it)
};

const migratedValidators = apiFiles.filter(
  (f) =>
    /\.validator\.js$/.test(f) &&
    /@praxis\/shared/.test(readFileSync(join(repoRoot, f), "utf8")),
);
const regressed = migratedValidators.filter((f) => {
  if (ALLOW_LOCAL_SCHEMA[f]) return false;
  const text = readFileSync(join(repoRoot, f), "utf8")
    // Comments quote the pattern by design — this file's own header does.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
  return /z\.object\s*\(/.test(text);
});

/* ── rule 4: every entity master field has a control ──────────────────────── */

const ENTITY_FORM = "client/src/features/masterdata/entity-form-fields.ts";
const ENTITY_DOSSIER = "client/src/features/masterdata/entity-360.tsx";

/**
 * Columns no form writes, and what writes them instead.
 *
 * An entry here is a claim that the field is reachable another way — not a
 * licence to skip it. Anything not listed and not in a form fails the build.
 */
const WRITTEN_ELSEWHERE = {
  // Superseded by the dossier's collections. Both writers for one fact is how
  // an entity ends up with a registered address in two places that disagree.
  niu: "legacy single-value column — the registrations collection replaced it",
  rccm: "legacy single-value column — the registrations collection replaced it",
  address: "legacy free-text column — the addresses collection replaced it",
  bank_block:
    "legacy jsonb — treasury accounts replaced it (letterhead falls back to it for old data only)",
  // Written by their own endpoints rather than the PATCH body.
  logo_light_ref: "POST /entities/:id/logo, from the form's upload control",
  logo_dark_ref: "POST /entities/:id/logo, from the form's upload control",
};

/**
 * The keys of an object literal, one per line — enough for the two bodies below.
 *
 * Both `key: value` and the shorthand `key,` count. The shorthand branch is not
 * optional politeness: the first run of this gate reported `consolidates` as
 * unwritable purely because the Structure modal passes it shorthand, and a gate
 * that cries wolf is a gate someone switches off.
 */
const literalKeys = (src) =>
  [...src.matchAll(/^\s+([a-z_][a-z0-9_]*)\s*(?::|,\s*$)/gim)].map((m) => m[1]);

/**
 * Everything between `marker` and the first line that closes it at `depth` 0.
 *
 * `closer` may be a string or a RegExp. The regex form exists because a
 * whitespace-exact closer is a gate that a reformat silently switches off: the
 * documents builder closed with the literal `"\n  ], ["` until the formatter
 * moved the dependency array onto its own line, at which point `sliceBody`
 * returned null, rule 5 reported "could not find the field builder", and the
 * collection stopped being watched at all. A pattern survives the wrap.
 */
function sliceBody(text, marker, closer) {
  const start = text.indexOf(marker);
  if (start === -1) return null;
  if (closer instanceof RegExp) {
    const rest = text.slice(start);
    const at = rest.search(closer);
    return at === -1 ? null : rest.slice(0, at);
  }
  const end = text.indexOf(closer, start);
  return end === -1 ? null : text.slice(start, end);
}

const entityFormSrc = existsSync(join(repoRoot, ENTITY_FORM))
  ? readFileSync(join(repoRoot, ENTITY_FORM), "utf8")
  : "";
const dossierSrc = existsSync(join(repoRoot, ENTITY_DOSSIER))
  ? readFileSync(join(repoRoot, ENTITY_DOSSIER), "utf8")
  : "";

// The form's PATCH/POST body. Its keys ARE what the form sends — `entityFormBody`
// is the single place the controls are mapped onto the request.
const formBody = sliceBody(
  entityFormSrc,
  "export function entityFormBody",
  "\n}",
);
// The Structure tab owns the four columns that describe the edge to the parent,
// because POST /structure emits its own audit event for a re-parenting.
const structureBody = sliceBody(
  dossierSrc,
  "api.setEntityStructure(",
  "\n      });",
);

const entityControls = new Set([
  ...literalKeys(formBody || ""),
  ...literalKeys(structureBody || ""),
]);
const masterKeys = shared.entityCommon?.masterShapeKeys ?? [];
const uncovered = masterKeys.filter(
  (k) => !entityControls.has(k) && !WRITTEN_ELSEWHERE[k],
);
// An exemption for a field that IS in a form is stale — it will outlive the
// reason it was written and quietly excuse the next gap.
const staleExemptions = Object.keys(WRITTEN_ELSEWHERE).filter((k) =>
  entityControls.has(k),
);

/* ── rule 5: the nested collections have controls too ─────────────────────── */

/**
 * Where each collection's `FieldSpec[]` is built, and what closes the slice.
 *
 * Documents are the odd one out: their fields depend on the chosen document
 * TYPE, so the list is assembled inside `DocumentsTab` rather than beside the
 * rest.
 */
const CHILD_BUILDERS = {
  people: ["const personFields = ", "\n];"],
  contacts: ["const contactFields = ", "\n];"],
  addresses: ["const addressFields = ", "\n];"],
  registrations: ["const registrationFields = ", "\n];"],
  "tax-registrations": ["const taxRegistrationFields = ", "\n];"],
  establishments: ["const establishmentFields = ", "\n];"],
  // The array's closing bracket followed by the useMemo dependency array —
  // whether the formatter leaves them on one line (`], [typeList]`) or splits
  // them (`],\n    [typeList],`). The indent bound keeps it from matching a
  // nested array inside a field spec.
  documents: [
    "const fields = React.useMemo<FieldSpec[]>",
    /\n {2,6}\],\s*\n? *\[/,
  ],
};

/** Nested fields written by something other than a `FieldSpec`, and by what. */
const CHILD_WRITTEN_ELSEWHERE = {
  // A vault id is not typed, it is produced: the Documents tab uploads the scan
  // to MOD-64 and patches back the id it is given. A uuid text box would satisfy
  // this gate and help nobody.
  "documents.vault_id":
    "the Attach scan control — POST /documents, then a PATCH with the returned id",
};

/** `{ key: "x", … }` — the one form every FieldSpec is written in. */
const specKeys = (src) =>
  [...src.matchAll(/\bkey:\s*"([a-z_][a-z0-9_]*)"/g)].map((m) => m[1]);

const nestedShapes = shared.entityCommon?.nestedShapeKeys ?? {};
const childGaps = [];
const missingBuilders = [];
for (const [seg, keys] of Object.entries(nestedShapes)) {
  const [marker, closer] = CHILD_BUILDERS[seg] || [];
  const body = marker ? sliceBody(dossierSrc, marker, closer) : null;
  if (!body) {
    missingBuilders.push(seg);
    continue;
  }
  const have = new Set(specKeys(body));
  for (const k of keys) {
    if (!have.has(k) && !CHILD_WRITTEN_ELSEWHERE[`${seg}.${k}`])
      childGaps.push(`${seg}.${k}`);
  }
}

/* ── rule 6: the letterhead designer names every column it can save ───────── */

/**
 * Looser than rules 4 and 5, deliberately. The designer is not a `FieldSpec`
 * list — toggles come from one array, colours and heights from a draft object,
 * the two enums from Selects that patch on change — so this asserts only that
 * each column is MENTIONED in the tab. That is enough to catch what actually
 * happened: six columns the API happily saved and the designer never named. A
 * stricter parser over hand-written JSX would break on reformatting, and a gate
 * that breaks on reformatting is a gate someone deletes.
 */
const letterheadTab = sliceBody(dossierSrc, "function LetterheadTab(", "\n}\n");
const letterheadKeys = shared.entityCommon?.letterheadKeys ?? [];
const letterheadGaps = letterheadTab
  ? letterheadKeys.filter((k) => !new RegExp(`\\b${k}\\b`).test(letterheadTab))
  : [];

/* ── report ───────────────────────────────────────────────────────────────── */

const oneSided = domains
  .map((d) => ({ d, api: apiUses.has(d), client: clientUses.has(d) }))
  .filter((r) => !r.api || !r.client);

console.warn(
  `\nShared schemas — ${domains.length} domain(s): ${domains.join(", ")}\n`,
);
for (const d of domains) {
  const api = apiUses.has(d) ? "API ✓" : "API ✗";
  const cl = clientUses.has(d) ? "client ✓" : "client ✗";
  console.warn(
    `  ${apiUses.has(d) && clientUses.has(d) ? "PASS" : "FAIL"}  ${d.padEnd(16)} ${api}   ${cl}`,
  );
}

let failed = 0;

if (oneSided.length) {
  failed += oneSided.length;
  console.error(
    `\n✗ ${oneSided.length} domain(s) are in packages/shared but not shared:\n`,
  );
  for (const r of oneSided) {
    const missing = !r.api
      ? "the API still validates with its own copy"
      : "the client still has its own rules";
    console.error(`    ${r.d} — ${missing}`);
  }
  console.error(
    "\n  A schema only one side imports is a THIRD definition, not a shared one.\n" +
      "  Either wire up the other side or move it back into that module.\n",
  );
}

if (regressed.length) {
  failed += regressed.length;
  console.error(
    `\n✗ ${regressed.length} migrated validator(s) declare their own schema again:\n`,
  );
  for (const f of regressed) console.error(`    ${relative(".", f)}`);
  console.error(
    "\n  A migrated validator is an ADAPTER: it maps the shared schema's result\n" +
      "  onto this API's error shape. A `z.object(...)` in it means a rule was\n" +
      "  added on one side only, which is the drift the package exists to stop.\n" +
      "  Put the rule in packages/shared, or add an ALLOW_LOCAL_SCHEMA entry with\n" +
      "  the reason.\n",
  );
}

if (!formBody || !structureBody) {
  failed += 1;
  console.error(
    "\n✗ Could not read the corporate-entity write surface:\n" +
      (formBody
        ? ""
        : `    ${ENTITY_FORM} — no \`export function entityFormBody\`\n`) +
      (structureBody
        ? ""
        : `    ${ENTITY_DOSSIER} — no \`api.setEntityStructure(\` call\n`) +
      "\n  Rule 4 reads those two bodies to learn which columns a person can\n" +
      "  actually write. If one was renamed, point this script at the new name —\n" +
      "  do not delete the check, or the twenty-field gap it was written for\n" +
      "  reopens silently.\n",
  );
}

if (uncovered.length) {
  failed += uncovered.length;
  console.error(
    `\n✗ ${uncovered.length} corporate-entity field(s) the API accepts but no control can write:\n`,
  );
  for (const k of uncovered) console.error(`    ${k}`);
  console.error(
    "\n  The dossier renders these, so each one reads `—` forever and the\n" +
      "  readiness checklist that asks for them can never be satisfied.\n" +
      "  Add a control in " +
      ENTITY_FORM +
      ", or — if something else\n" +
      "  writes it — say what, in WRITTEN_ELSEWHERE.\n",
  );
}

if (staleExemptions.length) {
  failed += staleExemptions.length;
  console.error(
    `\n✗ ${staleExemptions.length} WRITTEN_ELSEWHERE entr(y/ies) name a field that IS in a form now:\n`,
  );
  for (const k of staleExemptions)
    console.error(`    ${k} — ${WRITTEN_ELSEWHERE[k]}`);
  console.error(
    "\n  Drop the entry: an exemption nobody needs is one that excuses the next gap.\n",
  );
}

if (missingBuilders.length) {
  failed += missingBuilders.length;
  console.error(
    `\n✗ Could not find the field builder for ${missingBuilders.length} nested collection(s):\n`,
  );
  for (const s of missingBuilders)
    console.error(
      `    ${s} — expected \`${(CHILD_BUILDERS[s] || ["(unregistered)"])[0]}\` in ${ENTITY_DOSSIER}`,
    );
  console.error(
    "\n  Rule 5 reads those builders to learn which fields a person can set on a\n" +
      "  child record. Point CHILD_BUILDERS at the new name rather than removing\n" +
      "  the entry — an unwatched collection is how this drift started.\n",
  );
}

if (childGaps.length) {
  failed += childGaps.length;
  console.error(
    `\n✗ ${childGaps.length} nested field(s) the API accepts but no control can write:\n`,
  );
  for (const k of childGaps) console.error(`    ${k}`);
  console.error(
    "\n  Same failure as rule 4, one level down: the dossier renders these columns\n" +
      "  and nothing can fill them. Add a FieldSpec, or record what writes it in\n" +
      "  CHILD_WRITTEN_ELSEWHERE.\n",
  );
}

if (letterheadGaps.length) {
  failed += letterheadGaps.length;
  console.error(
    `\n✗ ${letterheadGaps.length} letterhead column(s) the designer never mentions:\n`,
  );
  for (const k of letterheadGaps) console.error(`    ${k}`);
  console.error(
    "\n  PUT /entities/:id/letterhead accepts these and the designer offers no way\n" +
      "  to reach them, so the stored value can only ever be the default.\n",
  );
}

if (failed) process.exit(1);
const childCount = Object.values(nestedShapes).reduce(
  (n, ks) => n + ks.length,
  0,
);
console.warn(
  `\n✓ Every shared domain is consumed by both sides; ${migratedValidators.length} validator(s) are adapters.`,
);
console.warn(
  `✓ All ${masterKeys.length} corporate-entity master fields are writable (${Object.keys(WRITTEN_ELSEWHERE).length} outside the form, each with a reason).`,
);
console.warn(
  `✓ All ${childCount} nested fields across ${Object.keys(nestedShapes).length} collections have controls.`,
);
console.warn(
  `✓ All ${letterheadKeys.length} letterhead columns are reachable in the designer.\n`,
);
