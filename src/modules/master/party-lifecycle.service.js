/**
 * Party lifecycle transitions shared by both masters (spec §4, §7, Hard Rules
 * 2, 3 & 9): the manual hard block/unblock, the verification / AVL-approval gate,
 * and the Smart Copy conversion bridge.
 *
 * A loose helper (no routes of its own); the two master modules call it inside a
 * request's tenant connection.
 */
"use strict";
const partyAccounting = require("./party-accounting.service");
const compliance = require("./compliance/compliance.service");
const { audit, emitEvent, resolveActorId } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");

const KIND = {
  client: { table: "client_master", pk: "client_id", moduleKey: "MOD-03", link: "linked_supplier_id", verifyField: "verification_status" },
  supplier: { table: "supplier_master", pk: "supplier_id", moduleKey: "MOD-04", link: "linked_client_id", verifyField: "verification_status" },
};

// The universal legal columns the Smart Copy bridge carries across; domain data
// (banks, contacts, addresses) is deliberately NOT here — it starts blank
// (Hard Rule 2).
const LEGAL_COLS = [
  "name", "legal_name", "trading_name", "niu", "rccm", "email", "address", "city",
  "country_code", "industry", "website", "notes", "tax_residency_country",
  "default_currency", "default_language", "risk_tier", "entity_id",
];

function cfg(kind) {
  const c = KIND[kind];
  if (!c) throw new AppError("BAD_PARTY_KIND", `unknown party kind "${kind}"`, 422);
  return c;
}

async function loadParty(c, k, id) {
  const { rows } = await c.query(`SELECT * FROM ${k.table} WHERE ${k.pk} = $1`, [id]);
  return rows[0] || null;
}

/** Manual hard block — the only path to HARD_BLOCK (Hard Rule 3). Reason required. */
async function block(c, { kind, partyId, reason, actor = {} }) {
  const k = cfg(kind);
  if (!reason || !String(reason).trim()) throw new AppError("VALIDATION_ERROR", "A block reason is required.", 422, { reason: ["required"] });
  const before = await loadParty(c, k, partyId);
  if (!before) throw new AppError("NOT_FOUND", `${kind} not found`, 404);
  const actorId = await resolveActorId(c, actor.user_id);
  await c.query("BEGIN");
  try {
    const { rows: [row] } = await c.query(
      `UPDATE ${k.table}
          SET compliance_state = 'HARD_BLOCK', hard_blocked_by = $1, hard_blocked_at = now(),
              hard_block_reason = $2, updated_at = now()
        WHERE ${k.pk} = $3 RETURNING *`,
      [actorId, reason, partyId],
    );
    await c.query(
      "INSERT INTO compliance_flag (rule_key, entity_ref, severity, message) VALUES ('party.hard_block', $1, 'HARD_BLOCK', $2)",
      [`${kind}:${partyId}`, `Manually blocked: ${reason}`],
    );
    await audit(c, { actorUserId: actor.user_id || null, action: `${kind}.blocked`, moduleKey: k.moduleKey, entityRef: `${kind}:${partyId}`, before, after: row });
    await emitEvent(c, { eventTypeKey: "party.hard_blocked", moduleKey: k.moduleKey, entityRef: `${kind}:${partyId}`, actorUserId: actor.user_id || null, priority: "HIGH", payload: { reason } });
    await c.query("COMMIT");
    return row;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

/** Lift a manual hard block and recompute the real (rules-driven) state. */
async function unblock(c, { kind, partyId, actor = {} }) {
  const k = cfg(kind);
  const before = await loadParty(c, k, partyId);
  if (!before) throw new AppError("NOT_FOUND", `${kind} not found`, 404);
  await c.query("BEGIN");
  try {
    await c.query(
      `UPDATE ${k.table} SET hard_blocked_by = NULL, hard_blocked_at = NULL, hard_block_reason = NULL, updated_at = now() WHERE ${k.pk} = $1`,
      [partyId],
    );
    await c.query(
      "UPDATE compliance_flag SET resolved_at = now() WHERE entity_ref = $1 AND rule_key = 'party.hard_block' AND resolved_at IS NULL",
      [`${kind}:${partyId}`],
    );
    await audit(c, { actorUserId: actor.user_id || null, action: `${kind}.unblocked`, moduleKey: k.moduleKey, entityRef: `${kind}:${partyId}`, before });
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
  // hard_blocked_at is now null, so sync computes and stores the real state.
  return compliance.sync(c, { kind, partyId });
}

/**
 * The verification / AVL-approval gate (Hard Rule 9). A client can only reach
 * VERIFIED, and a supplier AVL-APPROVED, once every mandatory document has a
 * verified digital scan — enforced here, so a missing scan cannot pass.
 */
async function verify(c, { kind, partyId, actor = {} }) {
  const k = cfg(kind);
  const evalr = await compliance.evaluateParty(c, { kind, partyId });
  if (evalr.party.hard_blocked_at) throw new AppError("HARD_BLOCKED", "Party is hard-blocked — unblock before verifying.", 409);
  if (!evalr.can_verify) {
    throw new AppError(
      "SCAN_REQUIRED",
      "Cannot verify: every mandatory document needs a verified digital scan in the vault (Hard Rule 9).",
      422,
    );
  }
  const set = kind === "supplier"
    ? "verification_status = 'VERIFIED', avl_status = 'APPROVED'"
    : "verification_status = 'VERIFIED'";
  const { rows: [row] } = await c.query(`UPDATE ${k.table} SET ${set}, updated_at = now() WHERE ${k.pk} = $1 RETURNING *`, [partyId]);
  await audit(c, { actorUserId: actor.user_id || null, action: `${kind}.verified`, moduleKey: k.moduleKey, entityRef: `${kind}:${partyId}`, after: row });
  return row;
}

/**
 * Smart Copy bridge (Hard Rule 2). Copies the source party's universal legal
 * data and registrations into a NEW draft row on the other master, links the two,
 * and returns the draft. Domain data (banks, contacts, addresses) starts blank —
 * the "Copy from …" toggle that fills it is a UI affordance (PR 2).
 */
async function convert(c, { fromKind, sourceId, actor = {} }) {
  const from = cfg(fromKind);
  const toKind = fromKind === "client" ? "supplier" : "client";
  const to = cfg(toKind);
  const source = await loadParty(c, from, sourceId);
  if (!source) throw new AppError("NOT_FOUND", `${fromKind} not found`, 404);

  // Idempotent-ish: if already linked, return the existing counterpart.
  if (source[from.link]) {
    const existing = await loadParty(c, to, source[from.link]);
    if (existing) return existing;
  }

  await c.query("BEGIN");
  try {
    const cols = LEGAL_COLS.filter((col) => source[col] !== undefined);
    const values = cols.map((col) => source[col]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const { rows: [draft] } = await c.query(
      `INSERT INTO ${to.table} (${cols.join(", ")}, registration_status, ${to.link})
       VALUES (${placeholders.join(", ")}, 'DRAFT', $${cols.length + 1}) RETURNING *`,
      [...values, sourceId],
    );
    // Link the source back to the new draft.
    await c.query(`UPDATE ${from.table} SET ${from.link} = $1, updated_at = now() WHERE ${from.pk} = $2`, [draft[to.pk], sourceId]);
    // Copy registrations (legal IDs), re-keyed to the new party.
    await c.query(
      `INSERT INTO party_registration (${to.pk}, country_code, kind, number, issuing_authority, issued_on, expires_on)
       SELECT $1, country_code, kind, number, issuing_authority, issued_on, expires_on
         FROM party_registration WHERE ${from.pk} = $2`,
      [draft[to.pk], sourceId],
    );
    await audit(c, {
      actorUserId: actor.user_id || null, action: `${toKind}.converted_from_${fromKind}`,
      moduleKey: to.moduleKey, entityRef: `${toKind}:${draft[to.pk]}`, after: { from: `${fromKind}:${sourceId}` },
    });
    await c.query("COMMIT");
    return draft;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

/**
 * Called by the master update service when registration_status transitions to
 * ACTIVE: allocate the aux account (idempotent) and refresh compliance. Kept
 * here so both masters share the one activation path (spec §3).
 */
async function onActivate(c, { kind, partyId }) {
  await partyAccounting.allocateAux(c, { kind, partyId });
  return compliance.sync(c, { kind, partyId });
}

module.exports = { block, unblock, verify, convert, onActivate };
