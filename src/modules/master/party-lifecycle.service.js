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
const { insertOne } = require("../../shared/db/query-helpers");
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
 * The verification / AVL-approval gate (Hard Rule 9 + 14030). A client can only
 * reach VERIFIED, and a supplier AVL-APPROVED, once:
 *
 *   1. every ACTIVATION document type has a verified digital scan in the vault
 *      (`can_verify`), so a missing scan cannot pass; and
 *   2. every field the tenant marked "required to activate" is filled.
 *
 * Both come from the SAME evaluation the 360 renders, so the checklist a user
 * reads and the gate that refuses them cannot drift apart. The document set is
 * `required_for_activation`, never `is_required` on its own: a type a tenant
 * merely wants on file raises an advisory flag and gates nothing — which is the
 * rule that stops a Bank RIB holding up a client nobody has billed yet.
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
  const missingFields = evalr.missing_activation_fields || [];
  if (missingFields.length) {
    const names = missingFields.map((f) => f.label).join(", ");
    throw new AppError(
      "ACTIVATION_REQUIREMENTS_MISSING",
      `Cannot activate: ${names} ${missingFields.length === 1 ? "is" : "are"} required before a ${kind} can be activated.`,
      422,
      missingFields.reduce((acc, f) => ({ ...acc, [f.field_key]: ["required before activation"] }), {}),
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
    // Re-mirror NIU / RCCM from the copied registrations onto the new master, so
    // invoices/statements reading the legacy columns see the IDs (bug #11). The
    // mirror is derived from the registration rows because a source may have
    // been edited through the registrations tab without the master columns being
    // refreshed — the registrations are the source of truth.
    const { rows: regs } = await c.query(
      `SELECT kind, number FROM party_registration WHERE ${to.pk} = $1`,
      [draft[to.pk]],
    );
    const mirror = {};
    for (const r of regs) {
      const k = String(r.kind || "").toUpperCase();
      if (k === "NIU" && r.number) mirror.niu = r.number;
      if (k === "RCCM" && r.number) mirror.rccm = r.number;
    }
    // If the registration rows carried nothing, fall back to the source's own
    // legacy columns — some legacy clients were created before registrations
    // were split out, and their niu/rccm live only on the master.
    if (!mirror.niu && source.niu) mirror.niu = source.niu;
    if (!mirror.rccm && source.rccm) mirror.rccm = source.rccm;
    if (Object.keys(mirror).length) {
      const sets = Object.keys(mirror).map((k, i) => `${k} = $${i + 2}`).join(", ");
      const params = [draft[to.pk], ...Object.values(mirror)];
      await c.query(`UPDATE ${to.table} SET ${sets} WHERE ${to.pk} = $1`, params);
    }
    // Copy compliance/KYC document references (not the vault bytes) re-keyed to
    // the new party. The bytes live once in document_vault; copying the row is
    // what keeps a converted supplier from losing access to the statutes / tax
    // certificate that were already on file for the client. Verification state
    // is reset to PENDING so a human re-checks the copy (Hard Rule 9). Only
    // carry documents that are not already REJECTED/EXPIRED — a dead KYC scan
    // has no business following the party.
    const srcDocTable = from.table === "client_master" ? "client_document" : "supplier_document";
    const tgtDocTable = to.table === "client_master" ? "client_document" : "supplier_document";
    await c.query(
      `INSERT INTO ${tgtDocTable}
              (${to.pk}, document_type_id, document_number, issuing_authority,
               issued_on, expires_on, physical_ref, vault_id,
               scan_status, verification_status)
       SELECT $1, document_type_id, document_number, issuing_authority,
              issued_on, expires_on, physical_ref, vault_id,
              CASE WHEN vault_id IS NOT NULL THEN 'SCANNED' ELSE 'PENDING' END,
              'PENDING'
         FROM ${srcDocTable}
        WHERE ${from.pk} = $2
          AND scan_status NOT IN ('REJECTED','EXPIRED')`,
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

// The domain sections a converted party can EXPLICITLY copy from its origin
// (Hard Rule 2 — never automatic). Columns mirror the nested write allow-lists.
const CLONE_SPECS = {
  banks: { table: (k) => `${k}_bank_account`, cols: ["beneficiary_name", "bank_name", "branch", "account_number", "iban", "swift_bic", "routing_code", "currency", "momo_network", "momo_number"] },
  contacts: { table: (k) => `${k}_contact`, cols: ["name", "title", "email", "phone", "role_tags", "language", "timezone", "portal_access"] },
  addresses: { table: (k) => `${k}_address`, cols: ["line1", "line2", "city", "region", "postal_code", "country_code", "type"] },
};

/**
 * Copy chosen domain sections (banks / contacts / addresses) from a converted
 * party's LINKED ORIGIN into it — the explicit "copy from origin" affordance
 * (Hard Rule 2: domain data starts blank and is only ever copied on request).
 *
 * The origin is the counterpart the conversion bridge linked, resolved from the
 * target's `linked_*` column — never an arbitrary party, so a caller cannot pull
 * another counterparty's bank details in. Atomic + audited. Copied rows are
 * demoted to non-primary so the copy never silently reassigns the target's
 * primary contact / account.
 *
 * @param {object} opts
 * @param {"client"|"supplier"} opts.kind    the TARGET kind (the party you are on)
 * @param {string} opts.targetId             the party receiving the copies
 * @param {string[]} opts.sections           any of "banks" | "contacts" | "addresses"
 */
async function cloneFromOrigin(c, { kind, targetId, sections = [], actor = {} }) {
  const k = cfg(kind);
  const target = await loadParty(c, k, targetId);
  if (!target) throw new AppError("NOT_FOUND", `${kind} not found`, 404);
  const sourceId = target[k.link];
  if (!sourceId) throw new AppError("NO_ORIGIN", "This record is not linked to an origin to copy from.", 422);
  const sourceKind = kind === "client" ? "supplier" : "client";

  const cloned = {};
  // Iterate the code-defined section keys and keep only the ones requested —
  // `section` is therefore never a request-controlled property name (closes the
  // remote-property-injection class; the request only ever filters, never keys).
  const requested = new Set(Array.isArray(sections) ? sections : []);
  await c.query("BEGIN");
  try {
    for (const section of Object.keys(CLONE_SPECS)) {
      if (!requested.has(section)) continue;
      const spec = CLONE_SPECS[section];
      const srcTable = spec.table(sourceKind);
      const tgtTable = spec.table(kind);
      const { rows } = await c.query(
        `SELECT ${spec.cols.join(", ")} FROM ${srcTable} WHERE ${sourceKind}_id = $1 AND is_active IS NOT false`,
        [sourceId],
      );
      let n = 0;
      for (const r of rows) {
        await insertOne(c, tgtTable, { ...r, is_primary: false, [`${kind}_id`]: targetId }, "*", [...spec.cols, "is_primary", `${kind}_id`]);
        n += 1;
      }
      cloned[section] = n;
    }
    await audit(c, {
      actorUserId: actor.user_id || null, action: `${kind}.cloned_from_origin`, moduleKey: k.moduleKey,
      entityRef: `${kind}:${targetId}`, after: { from: `${sourceKind}:${sourceId}`, sections: cloned },
    });
    await c.query("COMMIT");
    return { cloned, from: `${sourceKind}:${sourceId}` };
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

module.exports = { block, unblock, verify, convert, cloneFromOrigin, onActivate };
