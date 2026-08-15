#!/usr/bin/env node
/**
 * Catch two schema/contract regressions that every other CI guard misses.
 *
 * The scan that preceded this file found the reported session-kill bug's root
 * cause (B4: the client type declared `revoked_at` but the API sent
 * `killed_at`) plus a hard bug next to it (B5: `killAllForUser` queried a
 * table named `session` that does not exist — it is `user_session`). Neither
 * is caught by anything already in CI:
 *
 *   tsc                     - optional fields make absence legal
 *   check-api-contract.js   - snapshots routes/methods/auth/RBAC/validator;
 *                             NOT payload shapes
 *   check-schema-drift.js   - compares migrations to each other; never sees
 *                             the client
 *
 * So this file exists. It performs two independent checks, both purely
 * static, and both must pass:
 *
 *   1. TABLE-NAMES-EXIST      every UPDATE/FROM/INTO/JOIN in a `*.repo.js` /
 *                             `*.service.js` names a table declared in a
 *                             CREATE TABLE somewhere under migrations/. This
 *                             catches the B5 class.
 *
 *   2. CLIENT-FIELD-KNOWN     every snake_case field on a client TypeScript
 *                             type either
 *                               - matches a real column in the schema, OR
 *                               - matches a server-emitted alias (SQL `AS`,
 *                                 or an object-literal key in a service/repo
 *                                 response), OR
 *                               - is listed in the committed baseline of
 *                                 view-models / computed shapes / inputs.
 *                             Anything else is a candidate B4 bug.
 *
 * The check is intentionally per-file for client types (not per-endpoint):
 * per-endpoint binding is significantly more work and the scan showed the
 * global sweep catches the same defects with far fewer false negatives.
 * Per-endpoint refinement is a follow-up worth doing once the baseline is
 * empty and the check is trusted.
 *
 * BASELINE. The check ships with a committed baseline
 * (doc/response-contract-baseline.json) so it starts green. Adding a client
 * type field the server truly does emit — but that neither the schema nor
 * the alias scan can see — is done by adding it to the baseline with a
 * one-line reason. Removing it later is what closes the loophole.
 *
 * USAGE
 *
 *   node scripts/check-response-contract.js               verify
 *   node scripts/check-response-contract.js --update      re-bless the baseline
 *
 * Exit 1 on unknown-table or unknown-client-field.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(ROOT, "doc", "response-contract-baseline.json");
const UPDATE = process.argv.includes("--update");

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

const MIGRATION_DIRS = ["migrations/tenant", "migrations/platform"];

/**
 * Every table that a CREATE TABLE mentions, plus the columns declared on it.
 * Same shape check-schema-drift.js uses; the two files could share an
 * extractor but keeping this one self-contained means the guard doesn't break
 * if the other check is renamed or restructured.
 */
function extractSchema() {
  const CREATE_TABLE =
    /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:(\w+)\.)?(\w+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
  /*
   * ALTER TABLE is read as a WHOLE STATEMENT, then every ADD COLUMN inside it.
   *
   * The previous pattern required `ALTER TABLE <name>` immediately before each
   * `ADD COLUMN`, so on the comma-separated form — which is how nearly every
   * migration in this repo widens a table —
   *
   *     ALTER TABLE party
   *       ADD COLUMN IF NOT EXISTS default_currency char(3),
   *       ADD COLUMN IF NOT EXISTS avl_status text,
   *       ADD COLUMN IF NOT EXISTS score_claims numeric(5,2);
   *
   * only `default_currency` was ever recorded. Every other column in the list
   * was invisible to the schema half of this check, which meant a client type
   * naming one of them was reported as drift against a column that has existed
   * since 0511. `avl_status` is how this was found; the same list hides dozens.
   *
   * A false alarm is not a harmless one here. The remedy the error message
   * offers is "add it to the baseline", so each invisible column was an
   * invitation to permanently exempt a real field — and the baseline is
   * consulted for EVERY type, so an entry added for one becomes a blind spot
   * for all of them.
   */
  const ALTER_TABLE = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:\w+\.)?(\w+)([\s\S]*?);/gi;
  const ADD_COLUMN_IN = /ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)/gi;

  const tables = new Set();
  const columnsByTable = new Map();

  function addColumn(table, col) {
    const key = table.toLowerCase();
    if (!columnsByTable.has(key)) columnsByTable.set(key, new Set());
    columnsByTable.get(key).add(col.toLowerCase());
  }

  function readColumns(body) {
    let depth = 0;
    let line = "";
    const lines = [];
    for (const ch of body) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) { lines.push(line); line = ""; continue; }
      line += ch;
    }
    lines.push(line);
    const out = [];
    for (const raw of lines) {
      const t = raw.replace(/--[^\n]*/g, "").trim();
      if (!t) continue;
      const first = (t.split(/\s+/)[0] || "").toUpperCase();
      if (["CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK", "FOREIGN", "EXCLUDE", "LIKE"].includes(first)) continue;
      // "col type" or "col type, col2 type2" (some migrations declare two per
      // line — scan tokens for identifiers followed by a type-shaped token).
      const m = t.match(/^(\w+)\s+\S/);
      if (m) out.push(m[1].toLowerCase());
    }
    return out;
  }

  for (const dir of MIGRATION_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs).filter((f) => f.endsWith(".sql")).sort()) {
      const sql = fs.readFileSync(path.join(abs, name), "utf8");
      for (const m of sql.matchAll(CREATE_TABLE)) {
        const tbl = m[2].toLowerCase();
        tables.add(tbl);
        for (const c of readColumns(m[3])) addColumn(tbl, c);
      }
      // One pass per ALTER TABLE statement, then every ADD COLUMN inside its
      // body — the comma-separated list, not just its first entry.
      for (const stmt of sql.matchAll(ALTER_TABLE)) {
        const tbl = stmt[1];
        // `matchAll` on a /g regex is safe to re-run per statement; the regex
        // object carries `lastIndex`, but matchAll clones it internally.
        for (const col of stmt[2].matchAll(ADD_COLUMN_IN)) addColumn(tbl, col[1]);
      }
    }
  }
  return { tables, columnsByTable };
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE-NAMES-EXIST — the B5 catcher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reserved / built-in / non-table names that appear after FROM/JOIN but must
 * not be flagged. This list is intentionally small — the confidence signal
 * that a match is real comes from the continuation check below.
 */
const NON_TABLES = new Set([
  "only", "select", "lateral", "unnest", "generate_series",
  "jsonb_array_elements", "json_array_elements",
  "jsonb_each", "json_each",
  "regexp_split_to_table",
  "values",
]);

/**
 * Prefixes that schema-qualify to an external namespace, so the identifier
 * we would otherwise inspect is a schema name, not a table. `pg_catalog.*`,
 * `information_schema.*`, cross-schema access (`platform.tenant`,
 * `tenant.foo`) — all legitimate.
 */
const KNOWN_SCHEMAS = new Set(["pg_catalog", "information_schema", "public", "platform", "tenant"]);

/**
 * A token that MUST follow a real table reference in valid SQL. If the next
 * word isn't one of these (nor a `,`, `(`, `;` or end-of-string), the match
 * was almost certainly a false positive — a `DO UPDATE SET` idiom, a comment
 * fragment reading like SQL, or a captured chunk of prose that happens to
 * start with `JOIN`.
 */
const SQL_CONTINUATION = new Set([
  "set", "where", "order", "group", "limit", "offset", "returning",
  "on", "using", "as", "join", "inner", "left", "right", "outer", "full",
  "cross", "natural", "select", "values", "and", "or", "having", "for",
  "with", "union", "intersect", "except", "window", "fetch", "lock",
  "when", "then", "else", "end", "case",
]);

/**
 * Extract every table name a piece of SQL text refers to as a target of
 * UPDATE/DELETE FROM/INSERT INTO/SELECT FROM/JOIN.
 *
 * Deliberately conservative — this file is a static scanner, not a parser,
 * and every false positive dilutes the guard's credibility. We
 *  - skip identifiers that are schema-qualified against a known schema
 *    (`platform.tenant`, `pg_catalog.pg_class`),
 *  - skip the `DO UPDATE SET` idiom, which is UPDATE followed immediately by
 *    a keyword, not a table,
 *  - skip CTE names declared earlier in the same statement, and
 *  - require the next token to be a valid SQL continuation so a chunk of
 *    prose captured out of a string literal doesn't become a false positive.
 */
function tablesReferencedIn(sql) {
  const refs = new Set();

  // CTE names declared in `WITH name AS ( … )` (any number, chained by
  // commas). The trailing statement can be SELECT / UPDATE / INSERT / DELETE,
  // so match the WITH prelude alone instead of anchoring on SELECT.
  const cteNames = new Set();
  for (const m of sql.matchAll(/\b([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)) {
    cteNames.add(m[1].toLowerCase());
  }
  // Also `INSERT INTO tbl (…) SELECT …` — the columns list inside the ( ) can
  // pick up false positives; guarded by the SQL_CONTINUATION check below.

  // A capture group per useful chunk: keyword, optional schema, table, and
  // continuation (either the next word, or the terminator). The optional
  // schema+`.` prefix is what makes `platform.tenant` skip cleanly.
  const pattern = /\b(FROM|UPDATE|INTO|JOIN)\s+(?:ONLY\s+)?(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)(?:\s*([,;()])|\s+([a-z_][a-z0-9_]*)|\s*$)/gi;

  for (const m of sql.matchAll(pattern)) {
    const schema = (m[2] || "").toLowerCase();
    const tbl = m[3].toLowerCase();
    const nextWord = (m[5] || "").toLowerCase();

    // Schema-qualified against a known schema → the identifier we care about
    // lives in another database or an external namespace; treat as valid.
    if (schema && KNOWN_SCHEMAS.has(schema)) continue;
    if (schema && schema.startsWith("pg_")) continue;

    // Bare `pg_*` catalog tables (pg_attribute, pg_namespace, …) are
    // legitimate references without a schema prefix. Same for the small set
    // of Postgres built-ins that appear elsewhere.
    if (tbl.startsWith("pg_")) continue;

    if (NON_TABLES.has(tbl)) continue;
    if (cteNames.has(tbl)) continue;

    // The DO UPDATE SET idiom: UPDATE followed by SET — no table between them.
    if (m[1].toUpperCase() === "UPDATE" && tbl === "set") continue;

    // If there IS a next word, it must be a legal SQL continuation. Absent
    // (end of match, ,;() terminator) is fine — that's the end of a
    // subquery or clause.
    if (nextWord && !SQL_CONTINUATION.has(nextWord)) continue;

    refs.add(tbl);
  }
  return refs;
}

function checkTableNames(schema) {
  const violations = [];
  const roots = ["src"];
  for (const root of roots) {
    walkFiles(path.join(ROOT, root), (file) => {
      if (!/\.(repo|service|controller)\.js$/.test(file)) return;
      const rel = path.relative(ROOT, file);
      const rawSrc = fs.readFileSync(file, "utf8");
      // Strip comments before string extraction: a JSDoc that mentions
      // "user's roles into entries" contains an apostrophe that the naive
      // string scanner would treat as an opening quote, running until the
      // next apostrophe several paragraphs away and picking up prose as if
      // it were SQL. Well-formed // and /* */ comments cover every
      // false-positive source encountered in the tree.
      const src = rawSrc
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ");
      // Match balanced quotes properly — the naive `(?:['"`])...(?:['"`])`
      // shape loses matches whenever a single-quoted string contains a
      // double-quote (or vice versa). This backreference version anchors on
      // the OPENING quote and only closes on the same character, honouring
      // escapes.
      const stringPattern = /([`'"])((?:\\.|(?!\1)[\s\S])*?)\1/g;
      for (const s of src.matchAll(stringPattern)) {
        const text = s[2];
        if (!/\b(SELECT|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\b/i.test(text)) continue;
        for (const tbl of tablesReferencedIn(text)) {
          if (!schema.tables.has(tbl)) {
            violations.push({ file: rel, table: tbl });
          }
        }
      }
    });
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT-FIELD-KNOWN — the B4 catcher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every snake_case identifier that appears as a field name in a client
 * TypeScript type, keyed by the type it appears on. `field?: T` and `field: T`
 * both count. Camel-case names (`totalRows`) are ignored — those are UI-side.
 */
function extractClientFields() {
  const out = new Map(); // "file: TypeName" -> Set(fieldName)
  const roots = [path.join(ROOT, "client", "src")];
  for (const root of roots) {
    walkFiles(root, (file) => {
      if (!/\.tsx?$/.test(file)) return;
      if (/\.(test|spec)\.tsx?$/.test(file)) return;
      const rel = path.relative(ROOT, file);
      const src = fs.readFileSync(file, "utf8");
      // Match every `export? type Name = { … }` or `interface Name { … }`,
      // being tolerant about whitespace and nesting.
      const typeRe = /(?:export\s+)?type\s+(\w+)\s*=\s*\{([\s\S]*?)\n\};|(?:export\s+)?interface\s+(\w+)\s*(?:extends[^{]*)?\{([\s\S]*?)\n\}/g;
      for (const m of src.matchAll(typeRe)) {
        const name = m[1] || m[3];
        const body = m[2] || m[4];
        const fields = new Set();
        // `snake_case?: T` or `snake_case: T`
        for (const f of body.matchAll(/^\s*([a-z][a-z0-9_]*)\??\s*:/gm)) {
          const id = f[1];
          if (!id.includes("_")) continue; // camelCase → UI, not payload
          fields.add(id);
        }
        if (fields.size) out.set(`${rel}: ${name}`, fields);
      }
    });
  }
  return out;
}

/**
 * Every identifier the SERVER can emit as a JSON key on a payload — SQL
 * column aliases (`col AS other_name`) and object-literal keys in a service
 * or controller response. Aggregated across everything under src/, then used
 * as the allow-list for client fields the schema doesn't already cover.
 */
function extractServerAliases() {
  const out = new Set();
  const roots = [path.join(ROOT, "src")];
  for (const root of roots) {
    walkFiles(root, (file) => {
      if (!file.endsWith(".js")) return;
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/\b(?:AS|as)\s+([a-z_][a-z0-9_]*)\b/g)) {
        out.add(m[1].toLowerCase());
      }
      /*
       * Object-literal keys `foo_bar:` — noisy but the union is what matters.
       *
       * ANCHORED ON THE PRECEDING `{` OR `,`, NOT ON THE START OF A LINE.
       *
       * The line-anchored version (`/^\s*([a-z][a-z0-9_]*)\s*:/gm`) could only
       * see a key that the formatter happened to put first on its line, so a
       * compact literal hid every key but the first:
       *
       *   return { lines: n, off_lines: o, net_variance: v, has_discrepancy: d };
       *
       * Every one of those IS emitted, and all but `lines` were invisible. The
       * consequence is not a missed bug, it is 26 FALSE ALARMS naming fields
       * the server sends perfectly well — and a guard that cries wolf gets its
       * findings pasted into the baseline, which is how the real drift it
       * exists to catch gets waved through next to them.
       *
       * The lookahead also picks up SHORTHAND (`{ state, days_remaining }`),
       * which the old pattern could never match in any position.
       *
       * Still deliberately conservative about what it will NOT match, because
       * every false positive here WIDENS the allow-list and weakens the check:
       * a ternary's `cond ? a_b : c` is preceded by `?`, and array elements and
       * function parameters are followed by `]` or `)`, so none of them qualify.
       */
      for (const m of src.matchAll(/(?:^|[{,])\s*([a-z][a-z0-9_]*)\s*(?=[:,}])/gm)) {
        const id = m[1];
        if (id.includes("_")) out.add(id.toLowerCase());
      }
    });
  }
  return out;
}

function checkClientFields(schema, baseline) {
  const clientFields = extractClientFields();
  const serverAliases = extractServerAliases();

  const allSchemaColumns = new Set();
  for (const cols of schema.columnsByTable.values()) {
    for (const c of cols) allSchemaColumns.add(c);
  }

  const known = new Set([
    ...allSchemaColumns,
    ...serverAliases,
    ...(baseline.allow || []),
  ]);

  const violations = [];
  for (const [where, fields] of clientFields) {
    for (const f of fields) {
      if (!known.has(f)) violations.push({ where, field: f });
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
// PLUMBING
// ─────────────────────────────────────────────────────────────────────────────

function walkFiles(dir, fn) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".git" || name === "dist" || name === "build") continue;
      walkFiles(full, fn);
    } else {
      fn(full);
    }
  }
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { tables: [], allow: [] };
  try { return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")); }
  catch { return { tables: [], allow: [] }; }
}

function saveBaseline(baseline) {
  const dir = path.dirname(BASELINE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const sorted = {
    _note: baseline._note || "Committed allow-list for scripts/check-response-contract.js. Add a field with a one-line reason in _reasons; remove it when the underlying source of truth is fixed.",
    // Carried through, or `--update` silently deletes every justification in
    // the file — which is how an allow-list stops being reviewable and starts
    // being a place things go to be forgotten. The `_note` has always asked for
    // a reason; until now there was nowhere to put one.
    ...(baseline._reasons ? { _reasons: baseline._reasons } : {}),
    tables: [...new Set(baseline.tables || [])].sort(),
    allow: [...new Set(baseline.allow || [])].sort(),
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + "\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const schema = extractSchema();
  const baseline = loadBaseline();
  const baselineTables = new Set(baseline.tables || []);
  // The `tables` half of the baseline lists table names that a repo query
  // legitimately mentions but that don't live in a CREATE TABLE we scanned —
  // views, temp tables, external-schema tables. Treat them as known.
  for (const t of baselineTables) schema.tables.add(t.toLowerCase());

  const tableViolations = checkTableNames(schema);
  const fieldViolations = checkClientFields(schema, baseline);

  if (UPDATE) {
    // --update accepts every current violation into the baseline. USE
    // SPARINGLY — the point of the check is to make each new addition a
    // conscious act, and re-blessing the whole set defeats that.
    const nextAllow = new Set(baseline.allow || []);
    for (const v of fieldViolations) nextAllow.add(v.field);
    const nextTables = new Set(baseline.tables || []);
    for (const v of tableViolations) nextTables.add(v.table);
    saveBaseline({ ...baseline, allow: [...nextAllow], tables: [...nextTables] });
    console.warn(`Baseline updated. Field allow-list: ${nextAllow.size}. Table allow-list: ${nextTables.size}.`);
    process.exit(0);
  }

  if (tableViolations.length === 0 && fieldViolations.length === 0) {
    const fieldCount = [...extractClientFields().values()].reduce((n, s) => n + s.size, 0);
    console.warn(
      `Response-contract check: ${schema.tables.size} tables, ${fieldCount} client fields, ` +
        `${(baseline.allow || []).length} allow-listed. No violations.`,
    );
    process.exit(0);
  }

  if (tableViolations.length) {
    console.warn(`\n${tableViolations.length} repo/service reference(s) to unknown table(s):\n`);
    for (const v of tableViolations) {
      console.warn(`  ${v.file}  →  UPDATE/FROM/JOIN ${v.table}`);
    }
    console.warn(
      "\nA repo naming a table that does not exist ships a 42P01 undefined_table on every call.\n" +
        "Either the table name is wrong (rename the query) or the object is a view/temp table this\n" +
        "check does not know about (add it to doc/response-contract-baseline.json under `tables`).\n",
    );
  }

  if (fieldViolations.length) {
    console.warn(`\n${fieldViolations.length} client type field(s) that no server code emits:\n`);
    for (const v of fieldViolations) {
      console.warn(`  ${v.where}  →  ${v.field}`);
    }
    console.warn(
      "\nA client field the API never sends is always `undefined`. tsc cannot see the drift because\n" +
        "the field is optional. This is the shape of the session-kill bug (revoked_at vs killed_at).\n" +
        "Either rename the client field to what the server actually emits, or if the field is a\n" +
        "computed / view-model / input shape the schema can't know about, add it to\n" +
        "doc/response-contract-baseline.json under `allow` with a one-line reason.\n",
    );
  }

  process.exit(1);
}

main();
