/**
 * DB → schema cards. For each table in a schema, emit one compact text "card"
 * (columns/types, PK, FKs, CHECK enums) the AI can retrieve to understand the
 * database structure. Works for a tenant schema (live/sandbox) or 'platform'.
 * See doc/AI_KNOWLEDGE.md §2.
 */
"use strict";

async function buildSchemaCards(client, schema) {
  const cols = await client.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = $1
      ORDER BY table_name, ordinal_position`,
    [schema],
  );
  const fks = await client.query(
    `SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.table_schema = $1 AND tc.constraint_type = 'FOREIGN KEY'`,
    [schema],
  );
  const checks = await client.query(
    `SELECT tc.table_name, cc.check_clause
       FROM information_schema.table_constraints tc
       JOIN information_schema.check_constraints cc ON cc.constraint_name = tc.constraint_name AND cc.constraint_schema = tc.table_schema
      WHERE tc.table_schema = $1 AND tc.constraint_type = 'CHECK'`,
    [schema],
  );

  const byTable = new Map();
  const t = (name) => {
    if (!byTable.has(name)) byTable.set(name, { cols: [], fks: [], checks: [] });
    return byTable.get(name);
  };
  for (const r of cols.rows)
    t(r.table_name).cols.push(`${r.column_name} ${r.data_type}${r.is_nullable === "NO" ? " NOT NULL" : ""}`);
  for (const r of fks.rows)
    t(r.table_name).fks.push(`${r.column_name} → ${r.ref_table}.${r.ref_column}`);
  for (const r of checks.rows) {
    const enums = /IN \(([^)]+)\)/.exec(r.check_clause);
    if (enums) t(r.table_name).checks.push(enums[1].replace(/::[a-z ]+/g, "").trim());
  }

  const cards = [];
  for (const [table, d] of byTable) {
    const text =
      `Table ${schema}.${table}\n` +
      `Columns: ${d.cols.join("; ")}\n` +
      (d.fks.length ? `Foreign keys: ${d.fks.join("; ")}\n` : "") +
      (d.checks.length ? `Enums/checks: ${d.checks.join(" | ")}\n` : "");
    cards.push({ ref: `schema:${schema}.${table}`, title: `${schema}.${table} schema`, text });
  }
  return cards;
}

module.exports = { buildSchemaCards };
