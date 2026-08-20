#!/usr/bin/env node
/**
 * citext[] read gate.
 *
 * ── THE BUG THIS EXISTS TO PREVENT, BECAUSE IT ALREADY HAPPENED TWICE ───────
 *
 * `citext` comes from an extension, so its array type has no fixed OID and
 * node-postgres ships no parser for it. A `SELECT participants FROM email_thread`
 * therefore hands JavaScript the RAW POSTGRES LITERAL as a string —
 * `"{a@b.cm,c@d.cm}"` — where every reader expects an array.
 *
 * Nothing warns. The value looks plausible in a log and serialises to JSON as a
 * string. The failure surfaces later and somewhere else, as `.filter is not a
 * function`. Because these columns feed the inbox, one uncast SELECT took down
 * the whole Mailbox screen behind an error boundary; a second uncast RETURNING
 * broke mail INGESTION silently, throwing on every message after the first in a
 * conversation, inside a worker where nobody was watching.
 *
 * Both shipped green. Unit tests mock the repo and hand the service hand-made
 * JS arrays; component tests hand the renderer hand-made JS arrays. Neither
 * layer can produce the string the database actually returns, so the defect
 * lived precisely in the gap between them. That gap is what this closes.
 *
 * ── HOW IT AVOIDS BEING NOISE ───────────────────────────────────────────────
 *
 * The `(table, column)` pairs are discovered from the MIGRATIONS, so a column
 * added later is covered without editing this file — and a SCALAR `citext`
 * column that happens to share a name with an array one (`email_send_log
 * .to_address` really is scalar) is not confused for it. A line is only flagged
 * when the statement it belongs to actually reads from the owning table.
 *
 * A gate that cries wolf gets switched off, so writes are deliberately not
 * checked: node-postgres sends a JS array as `text[]` and Postgres coerces it
 * on the way in. Only reads are broken, so only reads are flagged.
 *
 *   node scripts/check-citext-arrays.js
 *
 * Exit 0 = every citext[] read is cast. Exit 1 = at least one is not.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/**
 * Every `citext[]` column declared in one .sql file, as `[table, column]` pairs.
 *
 * The schema qualifier is matched but not kept: `platform.feature_catalogue` is
 * stored as `feature_catalogue`, because that is what a query's alias resolves
 * to. Skipping qualified declarations outright — which the first draft did, by
 * requiring `(` straight after the table name — hid every `platform.*` table
 * from the gate, `feature_catalogue.depends_on` among them.
 */
function columnsInSql(sql) {
  const pairs = [];
  // CREATE TABLE … ( … col citext[] … )
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\);/gi)) {
    const [, table, body] = m;
    for (const c of body.matchAll(/^\s*([a-z_][a-z0-9_]*)\s+citext\s*\[\s*\]/gim)) pairs.push([table, c[1]]);
  }
  // ALTER TABLE x ADD COLUMN y citext[]
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)[\s\S]{0,80}?ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+citext\s*\[\s*\]/gi)) {
    pairs.push([m[1], m[2]]);
  }
  return pairs;
}

/** `{ table => Set(column) }` for every column declared `citext[]`. */
function citextArrayColumns(root = path.join(ROOT, "migrations")) {
  const byTable = new Map();
  const add = (table, column) => {
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table).add(column);
  };

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".sql")) continue;
      for (const [table, column] of columnsInSql(fs.readFileSync(full, "utf8"))) add(table, column);
    }
  };
  walk(root);
  return byTable;
}

const jsFiles = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
};

const CAST = (col) => new RegExp(`${col}\\s*::\\s*text\\s*\\[\\s*\\]`, "i");
const STRINGIFIED = (col) => new RegExp(`array_to_string\\s*\\(\\s*[^)]*\\b${col}\\b`, "i");

/**
 * Pull the SQL out of a JavaScript file.
 *
 * Only string content is considered, so a JS parameter array that happens to
 * contain `row.to_address` is never mistaken for a query. Both shapes in this
 * codebase are covered: template literals, and the older `"…" + "…"` runs.
 */
function sqlBlobs(source) {
  const blobs = [];
  const lineOf = (index) => source.slice(0, index).split("\n").length;
  for (const m of source.matchAll(/`([^`]*)`/g)) {
    if (/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|RETURNING)\b/i.test(m[1])) {
      blobs.push({ sql: m[1], at: lineOf(m.index) });
    }
  }
  // Concatenated double-quoted SQL, the older style in this codebase. Anchored
  // to whole quoted chunks joined by `+`: a looser pattern spans from one
  // string to the next and swallows the JavaScript in between, which is how an
  // earlier draft of this gate flagged a parameter array as a SELECT.
  for (const m of source.matchAll(/((?:"(?:[^"\\\n]|\\.)*"\s*\+\s*)+"(?:[^"\\\n]|\\.)*")/g)) {
    const joined = m[1].split(/"\s*\+\s*"/).join("").replace(/^"|"$/g, "");
    if (/\b(SELECT|RETURNING)\b/i.test(joined)) blobs.push({ sql: joined, at: lineOf(m.index) });
  }
  return blobs;
}

/**
 * The parts of a statement that actually flow back into JavaScript: a SELECT
 * list, and a RETURNING clause. An INSERT's column list is neither, which is
 * why writes are not flagged — pg coerces a JS array into citext[] going in.
 */
function projections(sql) {
  const out = [];
  for (const m of sql.matchAll(/\bSELECT\b([\s\S]*?)(?=\bFROM\b|$)/gi)) out.push(m[1]);
  for (const m of sql.matchAll(/\bRETURNING\b([\s\S]*?)(?=;|$)/gi)) out.push(m[1]);
  return out;
}

function scan(file, byTable) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  return scanSource(fs.readFileSync(file, "utf8"), rel, byTable);
}

function scanSource(source, rel, byTable) {
  const hits = [];

  for (const { sql, at } of sqlBlobs(source)) {
    const tables = [...byTable.keys()].filter((t) =>
      new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+(?:[a-z_][a-z0-9_]*\\.)?${t}\\b`, "i").test(sql));
    if (!tables.length) continue;
    const columns = new Set(tables.flatMap((t) => [...byTable.get(t)]));

    // `FROM email_thread t` / `JOIN email_message m` — so `t.*` can be blamed on
    // the right table. Without this, a star on a table that has no citext[]
    // column is flagged because some subquery mentioned one that does.
    const aliasOf = new Map();
    for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s+(?:AS\s+)?([a-z][a-z0-9_]*)\b/gi)) {
      if (!/^(on|where|set|using|values|select|returning|group|order|limit|left|right|inner|outer|join)$/i.test(m[2])) {
        aliasOf.set(m[2].toLowerCase(), m[1].toLowerCase());
      }
    }

    for (const projection of projections(sql)) {
      // `SELECT *` / `RETURNING *` drags the raw column along with everything
      // else, so it needs an explicit cast appended after the star.
      for (const star of projection.matchAll(/(?:^|[\s,])([a-z][a-z0-9_]*\.)?\*/gi)) {
        const alias = star[1] ? star[1].slice(0, -1).toLowerCase() : null;
        // A qualified star names one table; a bare star means every table in
        // the statement.
        const starTables = alias
          ? [aliasOf.get(alias) || alias].filter((t) => byTable.has(t))
          : tables;
        if (!starTables.length) continue;
        const starCols = [...new Set(starTables.flatMap((t) => [...byTable.get(t)]))];
        if (starCols.every((c) => CAST(c).test(projection))) continue;
        hits.push({
          rel, at, what: `${star[1] || ""}* from ${starTables.join("/")} (carries ${starCols.join(", ")})`,
          line: projection.trim().split("\n")[0].slice(0, 90),
        });
      }
      for (const col of columns) {
        if (!new RegExp(`(?:^|[\\s,(])(?:[a-z][a-z0-9_]*\\.)?${col}\\b`, "i").test(projection)) continue;
        if (CAST(col).test(projection) || STRINGIFIED(col).test(projection)) continue;
        hits.push({ rel, at, what: col, line: projection.trim().split("\n")[0].slice(0, 90) });
      }
    }
  }
  return hits;
}

function main() {
  const byTable = citextArrayColumns();
  if (!byTable.size) {
    console.warn("No citext[] columns found in migrations — nothing to check.");
    return 0;
  }
  const pairs = [...byTable].map(([t, cols]) => `${t}.{${[...cols].join(",")}}`).join(" ");

  const seen = new Set();
  const problems = jsFiles(path.join(ROOT, "src"))
    .filter((f) => /\.query\s*\(/.test(fs.readFileSync(f, "utf8")))
    .flatMap((f) => scan(f, byTable))
    .filter((p) => {
      const key = `${p.rel}:${p.at}:${p.what}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (!problems.length) {
    console.warn(`citext[] gate: every read is cast to text[] — ${pairs}`);
    return 0;
  }

  console.error(`\n${problems.length} uncast citext[] read(s).\n`);
  console.error('node-postgres has no parser for citext[], so these hand JavaScript the raw');
  console.error('literal "{a@b.cm,c@d.cm}" as a STRING. The first .filter or .join on it throws,');
  console.error("far from here, and nothing warns in between.\n");
  console.error("Fix: cast it in the query.");
  console.error("     SELECT t.participants::text[] AS participants");
  console.error("     RETURNING *, participants::text[] AS participants\n");
  for (const p of problems) {
    console.error(`  ${p.rel}:${p.at}  ${p.what}`);
    console.error(`      ${p.line}`);
  }
  console.error("");
  return 1;
}

if (require.main === module) process.exit(main());

module.exports = { columnsInSql, citextArrayColumns, sqlBlobs, projections, scanSource };
