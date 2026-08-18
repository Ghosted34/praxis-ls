#!/usr/bin/env node
/**
 * Static check: every `alias.column` in a raw SQL string must exist on the
 * table that alias resolves to.
 *
 * WHY THIS EXISTS. Three production incidents in one week had the same shape:
 * `st.code` where service_type has `key`, `st.name` where it has `name_fr`,
 * `ce.country` where corporate_entity has `country_code`. Postgres cannot tell
 * you about any of them until the route runs, and then it tells you about
 * exactly ONE — the first column it fails to resolve — so a query with two bad
 * columns takes two deploys to fix. The information needed to catch all of them
 * is sitting in migrations/ the whole time.
 *
 * WHAT IT IS NOT. Not a SQL parser and not a type checker. It resolves table
 * aliases from FROM/JOIN and looks up qualified column references; anything it
 * cannot resolve with confidence it SKIPS rather than guesses. The design bias
 * is total: a false positive costs a developer an argument with a green build,
 * so every ambiguity resolves to silence. It will miss unqualified columns,
 * columns inside views, and anything behind a template interpolation. It still
 * catches the entire class of bug above.
 *
 * THE BACKLOG IS GRANDFATHERED, same reasoning as the reversibility and
 * idempotency gates: `query-columns.baseline.json` records the references that
 * were already broken when this landed, so the gate enforces on NEW code from
 * day one instead of waiting on a fix it cannot make safely. A baselined entry
 * that gets fixed is removed from the baseline by --update; a baselined entry
 * that MOVES still fails, because the reference is matched on file+ref, not on
 * line number. Run --report to see what is still owed.
 *
 * Usage:
 *   node scripts/db/check-query-columns.js            # gate: exit 1 on NEW findings
 *   node scripts/db/check-query-columns.js --report   # everything, baseline included
 *   node scripts/db/check-query-columns.js --json     # machine-readable
 *   node scripts/db/check-query-columns.js --update   # rewrite the baseline
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC_DIRS = ["src"];
const MIGRATION_DIRS = ["migrations/tenant", "migrations/platform"];

/* ── 1. The catalogue ──────────────────────────────────────────────────────
 *
 * Built by replaying the migrations in filename order, the same order the
 * runner applies them. Tables gain columns from CREATE TABLE and ADD COLUMN,
 * lose them to DROP COLUMN, and rename through RENAME COLUMN. A table whose
 * shape we cannot fully determine is marked OPAQUE and never produces a
 * finding — see markOpaque callers for what triggers that.
 */
function listFiles(dir, ext) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => path.join(abs, f));
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

/** Split a parenthesised column list on top-level commas only, so that
 *  `numeric(18,2)` and `CHECK (x IN ('a','b'))` do not split a definition. */
function splitTopLevel(body) {
  const out = [];
  let depth = 0;
  let buf = "";
  let quote = null;
  for (const ch of body) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/** Read the balanced parenthesised block starting at `open`. */
function readParens(s, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return { body: s.slice(open + 1, i), end: i };
    }
  }
  return null;
}

const TABLE_CONSTRAINT = /^\s*(?:CONSTRAINT\b|PRIMARY\s+KEY\b|FOREIGN\s+KEY\b|UNIQUE\b|CHECK\b|EXCLUDE\b|LIKE\b)/i;

function buildCatalogue() {
  /** table -> Set(columns). Platform tables are keyed "platform.x", tenant
   *  tables by bare name — the two live in different databases and a bare
   *  `tenant` in a tenant repo must not resolve to platform.tenant. */
  const tables = new Map();
  /** tables we refuse to reason about */
  const opaque = new Set();
  /** schema names, so `platform.tenant` reads as a relation, not a column */
  const schemas = new Set(["public", "pg_catalog", "information_schema"]);
  const markOpaque = (t) => opaque.add(t);
  const ensure = (t) => {
    if (!tables.has(t)) tables.set(t, new Set());
    return tables.get(t);
  };

  const files = MIGRATION_DIRS.flatMap((d) => listFiles(d, ".sql"));
  for (const file of files) {
    const sql = stripSqlComments(fs.readFileSync(file, "utf8"));
    let sm;
    const schemaRe = /CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
    while ((sm = schemaRe.exec(sql))) schemas.add(sm[1].toLowerCase());

    // CREATE TABLE [IF NOT EXISTS] name ( ... )
    const createRe = /CREATE\s+(?:UNLOGGED\s+|TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_.]*)\s*\(/gi;
    let m;
    while ((m = createRe.exec(sql))) {
      const name = m[1].toLowerCase();
      const block = readParens(sql, createRe.lastIndex - 1);
      if (!block) {
        markOpaque(name);
        continue;
      }
      const cols = ensure(name);
      for (const raw of splitTopLevel(block.body)) {
        if (TABLE_CONSTRAINT.test(raw)) continue;
        const col = raw.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+/i);
        if (col) cols.add(col[1].toLowerCase());
      }
      // CREATE TABLE x (LIKE y ...) copies a shape we did not enumerate.
      if (/\bLIKE\s+[a-z_]/i.test(block.body)) markOpaque(name);
    }

    // CREATE TABLE ... AS SELECT — shape comes from the query, not a list.
    const ctasRe = /CREATE\s+(?:UNLOGGED\s+|TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_.]*)\s+AS\b/gi;
    while ((m = ctasRe.exec(sql))) markOpaque(m[1].toLowerCase());

    // Views and materialised views: real relations that queries join to, whose
    // column list we do not compute. Known-by-name so an alias pointing at one
    // resolves to "skip" rather than "unknown table".
    const viewRe = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_.]*)/gi;
    while ((m = viewRe.exec(sql))) {
      ensure(m[1].toLowerCase());
      markOpaque(m[1].toLowerCase());
    }

    // ALTER TABLE [IF EXISTS] [ONLY] name <action>[, <action>...];
    const alterRe = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([a-z_][a-z0-9_.]*)([\s\S]*?);/gi;
    while ((m = alterRe.exec(sql))) {
      const name = m[1].toLowerCase();
      const body = m[2];
      const cols = ensure(name);
      let a;
      const addRe = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
      while ((a = addRe.exec(body))) cols.add(a[1].toLowerCase());
      const dropRe = /DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
      while ((a = dropRe.exec(body))) cols.delete(a[1].toLowerCase());
      const renRe = /RENAME\s+COLUMN\s+"?([a-z_][a-z0-9_]*)"?\s+TO\s+"?([a-z_][a-z0-9_]*)"?/gi;
      while ((a = renRe.exec(body))) {
        cols.delete(a[1].toLowerCase());
        cols.add(a[2].toLowerCase());
      }
      // `ALTER TABLE x RENAME TO y` moves a shape we then stop tracking.
      if (/RENAME\s+TO\s+/i.test(body) && !/RENAME\s+COLUMN/i.test(body)) {
        markOpaque(name);
      }
    }

    // DDL inside EXECUTE '...' / EXECUTE format(...). The ALTER pass above
    // stops at the first `;`, which a quoted statement does not have, so run a
    // second permissive sweep for ADD COLUMN over the raw text. This pass only
    // ever ADDS to the catalogue: over-adding costs a missed finding, whereas
    // over-removing would invent one, and the bias is always toward silence.
    const execAdd = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([a-z_][a-z0-9_.]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
    while ((m = execAdd.exec(sql))) ensure(m[1].toLowerCase()).add(m[2].toLowerCase());

    // 0640's shape: rename a column on EVERY table that carries it, driven by
    // information_schema. The table is dynamic but both column names are
    // literal, so the rename can be applied exactly rather than given up on.
    const dynRen = /ALTER\s+TABLE\s+%I\s+RENAME\s+COLUMN\s+([a-z_][a-z0-9_]*)\s+TO\s+([a-z_][a-z0-9_]*)/gi;
    while ((m = dynRen.exec(sql))) {
      const [, from, to] = [m[0], m[1].toLowerCase(), m[2].toLowerCase()];
      for (const cols of tables.values()) {
        if (cols.has(from)) {
          cols.delete(from);
          cols.add(to);
        }
      }
    }

    // Any OTHER dynamic DDL naming its table with %I could add or drop a
    // column we cannot attribute. Constraint and index DDL cannot, so it is
    // excluded rather than poisoning the whole catalogue.
    const dynOther = sql.match(/(?:ALTER|CREATE)\s+TABLE[^;']*?%I[^;']*/gi) || [];
    for (const stmt of dynOther) {
      if (/RENAME\s+COLUMN|DROP\s+CONSTRAINT|ADD\s+CONSTRAINT|CREATE\s+INDEX/i.test(stmt)) continue;
      if (/ADD\s+COLUMN|DROP\s+COLUMN/i.test(stmt)) for (const t of tables.keys()) markOpaque(t);
    }
  }

  // A table we only ever saw referenced, never defined, has no column list and
  // must not produce findings.
  for (const [t, cols] of tables) if (cols.size === 0) markOpaque(t);
  return { tables, opaque, schemas };
}

/* ── 2. SQL strings inside the JS ──────────────────────────────────────────
 *
 * We take template literals and single/double-quoted strings that look like
 * SQL, wherever they appear. Deliberately NOT limited to `.query(` call sites:
 * plenty of queries are built as a `const SQL = ...` and passed in later, and a
 * broken column is broken wherever the string was written.
 */
function extractSqlStrings(code) {
  const out = [];
  const push = (text, index) => {
    if (!/\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\b/i.test(text)) return;
    if (!/\b(?:SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(text)) return;
    out.push({ text, index });
  };

  // Template literals. `${...}` becomes a marker so nothing downstream reads
  // interpolated text as SQL, and so we can refuse queries whose FROM clause
  // is itself interpolated.
  const tpl = /`((?:[^`\\]|\\.)*)`/gs;
  let m;
  while ((m = tpl.exec(code))) {
    push(m[1].replace(/\$\{[^}]*\}/g, "  INTERP  "), m.index);
  }

  // Ordinary strings, including the "..." + "..." concatenations this codebase
  // favours: adjacent quoted chunks joined by + are glued back together.
  //
  // The chunks are re-extracted with a literal matcher rather than split on
  // "+", because SQL contains its own pluses — `version = setting.version + 1`
  // split into `version = setting.version` and `1` and glued back as
  // `setting.version1`, which is a column nothing has and a finding nobody can
  // act on. Never split the payload to find its seams.
  const concat = /(["'])(?:(?!\1)[^\\\n]|\\.)*\1(?:\s*\+\s*(["'])(?:(?!\2)[^\\\n]|\\.)*\2)*/g;
  const literal = /(["'])((?:(?!\1)[^\\]|\\.)*)\1/g;
  while ((m = concat.exec(code))) {
    const parts = m[0].match(literal) || [];
    push(parts.map((p) => p.slice(1, -1)).join(""), m.index);
  }
  return out;
}

const SQL_KEYWORDS = new Set([
  "select", "from", "where", "join", "inner", "left", "right", "full", "outer",
  "cross", "lateral", "on", "using", "and", "or", "not", "in", "as", "is",
  "null", "case", "when", "then", "else", "end", "group", "order", "by",
  "having", "limit", "offset", "union", "all", "distinct", "insert", "into",
  "values", "update", "set", "delete", "returning", "with", "recursive",
  "coalesce", "count", "sum", "avg", "min", "max", "exists", "between", "like",
  "ilike", "asc", "desc", "nulls", "first", "last", "over", "partition",
  "conflict", "do", "nothing", "excluded", "true", "false", "cast", "filter",
  "array", "any", "some", "interval", "extract", "current_date", "now",
]);

/** alias -> table for one statement, plus the set of names we must not judge. */
function resolveAliases(sql) {
  const aliases = new Map();
  const opaqueAliases = new Set();

  // CTE names are relations with computed shapes.
  const cte = /(?:WITH|,)\s+(?:RECURSIVE\s+)?([a-z_][a-z0-9_]*)\s+AS\s*(?:MATERIALIZED\s+|NOT\s+MATERIALIZED\s+)?\(/gi;
  let m;
  while ((m = cte.exec(sql))) opaqueAliases.add(m[1].toLowerCase());

  // A subquery in FROM/JOIN position: `FROM ( ... ) alias`
  const sub = /\b(?:FROM|JOIN)\s*\(\s*SELECT[\s\S]*?\)\s*(?:AS\s+)?([a-z_][a-z0-9_]*)/gi;
  while ((m = sub.exec(sql))) opaqueAliases.add(m[1].toLowerCase());

  // A set-returning function in FROM position: `FROM jsonb_to_recordset(...) x`
  const fn = /\b(?:FROM|JOIN)\s+[a-z_][a-z0-9_]*\s*\([\s\S]*?\)\s*(?:AS\s+)?([a-z_][a-z0-9_]*)/gi;
  while ((m = fn.exec(sql))) opaqueAliases.add(m[1].toLowerCase());

  const src = /\b(?:FROM|JOIN)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*|INTERP)(\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?/gi;
  while ((m = src.exec(sql))) {
    const table = m[1].toLowerCase();
    const alias = (m[3] || "").toLowerCase();
    if (table === "interp") {
      if (alias) opaqueAliases.add(alias);
      continue;
    }
    if (SQL_KEYWORDS.has(table)) continue;
    const key = alias && !SQL_KEYWORDS.has(alias) ? alias : table;
    if (aliases.has(key) && aliases.get(key) !== table) {
      // Same short name meaning two things — almost always two statements
      // sharing one literal. Refuse both.
      opaqueAliases.add(key);
    }
    aliases.set(key, table);
  }

  // UPDATE x SET / INSERT INTO x / DELETE FROM x
  const upd = /\bUPDATE\s+(?:ONLY\s+)?([a-z_][a-z0-9_.]*)(\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?\s+SET\b/gi;
  while ((m = upd.exec(sql))) {
    const table = m[1].toLowerCase();
    const alias = (m[3] || "").toLowerCase();
    aliases.set(alias && !SQL_KEYWORDS.has(alias) ? alias : table, table);
  }
  const ins = /\bINSERT\s+INTO\s+([a-z_][a-z0-9_.]*)/gi;
  while ((m = ins.exec(sql))) aliases.set(m[1].toLowerCase(), m[1].toLowerCase());

  return { aliases, opaqueAliases };
}

function checkSql(sql, cat) {
  const findings = [];
  const { aliases, opaqueAliases } = resolveAliases(sql);
  if (!aliases.size) return findings;

  const ref = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g;
  let m;
  const seen = new Set();
  while ((m = ref.exec(sql))) {
    const alias = m[1].toLowerCase();
    const col = m[2].toLowerCase();
    if (col === "*") continue;
    if (cat.schemas.has(alias)) continue; // `platform.tenant` is a relation
    if (opaqueAliases.has(alias)) continue;
    if (!aliases.has(alias)) continue; // schema-qualified name, jsonb path, etc.
    const table = aliases.get(alias);
    if (cat.opaque.has(table)) continue;
    const cols = cat.tables.get(table);
    if (!cols) continue;
    if (cols.has(col)) continue;
    const key = `${alias}.${col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({ ref: key, table, column: col, candidates: suggest(col, cols) });
  }
  return findings;
}

/** Nearest existing column names, so the report says what to write instead. */
function suggest(col, cols) {
  const all = [...cols];
  const near = all.filter(
    (c) => c.startsWith(col + "_") || c.endsWith("_" + col) || c === col + "_code" || col.startsWith(c),
  );
  if (near.length) return near.slice(0, 4);
  return all
    .map((c) => [c, distance(col, c)])
    .filter(([, d]) => d <= 3)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([c]) => c);
}
function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length][b.length];
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      walk(p, acc);
    } else if (e.name.endsWith(".js") && !e.name.endsWith(".test.js")) acc.push(p);
  }
  return acc;
}

function lineOf(code, index) {
  return code.slice(0, index).split("\n").length;
}

const BASELINE = path.join(__dirname, "query-columns.baseline.json");

function loadBaseline() {
  if (!fs.existsSync(BASELINE)) return new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
    return new Set((raw.grandfathered || []).map((e) => `${e.file}|${e.ref}`));
  } catch {
    return new Set();
  }
}

function main() {
  const json = process.argv.includes("--json");
  const report = process.argv.includes("--report");
  const update = process.argv.includes("--update");
  const cat = buildCatalogue();
  const files = SRC_DIRS.flatMap((d) =>
    fs.existsSync(path.join(ROOT, d)) ? walk(path.join(ROOT, d)) : [],
  );

  const findings = [];
  for (const file of files) {
    const code = fs.readFileSync(file, "utf8");
    if (!/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(code)) continue;
    for (const { text, index } of extractSqlStrings(code)) {
      for (const f of checkSql(text, cat)) {
        findings.push({
          file: path.relative(ROOT, file).replace(/\\/g, "/"),
          line: lineOf(code, index),
          ...f,
        });
      }
    }
  }

  if (update) {
    fs.writeFileSync(
      BASELINE,
      JSON.stringify(
        {
          note: "References already broken when check-query-columns landed. Fix and remove; do not add.",
          generated_against_tables: cat.tables.size,
          grandfathered: findings
            .map((f) => ({ file: f.file, ref: f.ref, table: f.table, column: f.column }))
            .sort((a, b) => (a.file + a.ref).localeCompare(b.file + b.ref)),
        },
        null,
        2,
      ) + "\n",
    );
    console.warn(`check-query-columns: baseline written with ${findings.length} entr(ies).`);
    process.exit(0);
  }

  const baseline = loadBaseline();
  const fresh = findings.filter((f) => !baseline.has(`${f.file}|${f.ref}`));
  const held = findings.length - fresh.length;
  const shown = report ? findings : fresh;

  if (json) {
    process.stdout.write(
      JSON.stringify(
        { tables: cat.tables.size, opaque: cat.opaque.size, grandfathered: held, findings: shown },
        null,
        2,
      ) + "\n",
    );
  } else if (!shown.length) {
    console.warn(
      `check-query-columns: OK — ${cat.tables.size} tables in the catalogue, no new unresolved column references` +
        (held ? ` (${held} grandfathered).` : "."),
    );
  } else {
    console.error(`check-query-columns: ${shown.length} unresolved column reference(s)\n`);
    for (const f of shown) {
      const hint = f.candidates.length ? `  did you mean: ${f.candidates.join(", ")}` : "";
      const mark = baseline.has(`${f.file}|${f.ref}`) ? " [grandfathered]" : "";
      console.error(
        `  ${f.file}:${f.line}  ${f.ref}  — ${f.table} has no column "${f.column}"${hint}${mark}`,
      );
    }
    console.error(
      `\nThe catalogue is built from migrations/. A column added outside a migration is` +
        `\nnot a column: add it there. If this reference is genuinely fine, say why in` +
        `\nthe PR — do not widen the baseline.`,
    );
  }
  process.exit(report ? 0 : fresh.length ? 1 : 0);
}

if (require.main === module) main();
module.exports = { buildCatalogue, extractSqlStrings, resolveAliases, checkSql };
