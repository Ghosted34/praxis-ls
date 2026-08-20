/**
 * Read-only action cards. v1 never writes. Missing fields are named, never guessed.
 */
"use strict";

const RULES = {
  proforma: {
    target: "/finance/proforma/new",
    fields: [
      { field: "client_id", label: "Client", from: "thread.client_id" },
      { field: "incoterm", label: "Incoterm", from: "thread.incoterm" },
      { field: "delivery_place", label: "Place of delivery", from: "dossier.delivery_place" },
    ],
  },
  invoice: {
    target: "/finance/invoices/new",
    fields: [
      { field: "client_id", label: "Client", from: "thread.client_id" },
      { field: "currency", label: "Currency", from: "thread.currency" },
    ],
  },
};

function readinessFrom(facts, cardKey) {
  const rule = RULES[cardKey];
  if (!rule) return { ready: false, missing: [{ field: "card", label: cardKey, why: "unknown card" }] };
  const prefill = {};
  const missing = [];
  for (const f of rule.fields) {
    const v = facts[f.field];
    if (v == null || v === "") missing.push({ field: f.field, label: f.label, why: `${f.label} is not stated in this thread` });
    else prefill[f.field] = v;
  }
  return { ready: missing.length === 0, target: rule.target, prefill, missing };
}

async function readiness(client, threadId, cardKey) {
  const { rows } = await client.query(
    `SELECT t.entity_ref, t.subject FROM email_thread t WHERE t.email_thread_id = $1`,
    [threadId],
  );
  const t = rows[0] || {};
  const facts = {};
  if (t.entity_ref && t.entity_ref.startsWith("client:")) facts.client_id = t.entity_ref.slice(7);
  return readinessFrom(facts, cardKey);
}

module.exports = { RULES, readinessFrom, readiness };
