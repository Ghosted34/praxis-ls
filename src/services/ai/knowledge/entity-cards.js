/**
 * Tenant rows → compact text "cards" for semantic recall. Runs on a tenant
 * connection already bound to live/sandbox. Only knowledge-bearing entities;
 * exact/current values come from function-calling, not from these cards.
 * Each card carries a confidentiality tag so retrieval can filter per RBAC.
 */
"use strict";

// [sql, mapRow→card] per entity. Defensive: LIMIT and only-if-table-exists.
const BUILDERS = [
  {
    key: "dossier",
    sql: `SELECT d.ref, d.status, d.incoterm, d.pol, d.pod, c.name AS client
            FROM dossier d LEFT JOIN client_master c ON c.client_id = d.client_id
           ORDER BY d.created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `dossier:${r.ref}`,
      title: `Operation file ${r.ref}`,
      confidentiality: "normal",
      text: `Operation file ${r.ref} for client ${r.client || "?"} — status ${r.status}, incoterm ${r.incoterm || "?"}, route ${r.pol || "?"}→${r.pod || "?"}.`,
    }),
  },
  {
    key: "client_master",
    sql: `SELECT ref, name, niu, payment_terms_days FROM client_master ORDER BY created_at DESC LIMIT $1`,
    card: (r) => ({
      ref: `client:${r.ref || r.name}`,
      title: `Client ${r.name}`,
      confidentiality: "normal",
      text: `Client ${r.name} (ref ${r.ref || "?"}, NIU ${r.niu || "?"}), payment terms ${r.payment_terms_days || "?"} days.`,
    }),
  },
  {
    key: "dictionary_item",
    sql: `SELECT code, label_fr, label_en, category, is_debours FROM dictionary_item ORDER BY code LIMIT $1`,
    card: (r) => ({
      ref: `dict:${r.code}`,
      title: `Dictionary item ${r.code}`,
      confidentiality: "normal",
      text: `Billing item ${r.code}: ${r.label_en || r.label_fr} (${r.category}${r.is_debours ? ", débours" : ""}).`,
    }),
  },
];

async function tableExists(client, name) {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1",
    [name],
  );
  return rows.length > 0;
}

async function buildEntityCards(client, opts = {}) {
  const limit = opts.limitPerEntity || 500;
  const cards = [];
  for (const b of BUILDERS) {
    if (!(await tableExists(client, b.key))) continue;
    const { rows } = await client.query(b.sql, [limit]);
    for (const r of rows) cards.push(b.card(r));
  }
  return cards;
}

module.exports = { buildEntityCards, BUILDERS };
