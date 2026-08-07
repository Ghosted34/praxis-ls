/**
 * Party compliance engine — the impure half (spec §4).
 *
 * Loads a party's documents, banks, expected document types and (for a client)
 * derived credit status; runs the pure rules; reconciles the result into the
 * shared `compliance_flag` table; and stores the rolled-up `compliance_state`
 * back on the master. Plus the GL-integrity parity check (§4.2): billed
 * documents versus what actually posted to the party's auxiliary account.
 *
 * GL IS THE SINGLE SOURCE OF TRUTH (Hard Rule 4). Nothing here reads a cached
 * balance column; the aux-account side comes from posted journal lines
 * (journal_entry.status = 'validated'), and a divergence from the locked source
 * documents raises a RED flag rather than being reconciled away.
 */
"use strict";
const rules = require("./compliance.rules");
const clientRepo = require("../client_master/client_master.repo");
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const MODULE_KEY = { client: "MOD-03", supplier: "MOD-04" };
// A recommendation/escalation is passable WITH a logged override; a hard block
// is not. WARN/INFO/ONBOARDING/OK are allowed outright.
const OVERRIDE_STATES = new Set(["ESCALATED", "SOFT_BLOCK_RECOMMENDATION"]);
const BLOCKING_SEVERITY = new Set(["ESCALATED", "RED", "SOFT_BLOCK_RECOMMENDATION", "HARD_BLOCK"]);

/** Per-kind wiring. Literals, never request input. */
const KIND = {
  client: { table: "client_master", pk: "client_id", docTable: "client_document", bankTable: "client_bank_account", appliesTo: "CLIENT", auxSide: "debit", categoryTable: "client_type", categoryFk: "client_type_id" },
  supplier: { table: "supplier_master", pk: "supplier_id", docTable: "supplier_document", bankTable: "supplier_bank_account", appliesTo: "SUPPLIER", auxSide: "credit", categoryTable: "supplier_type", categoryFk: "supplier_type_id" },
};

const INVOICE_LOCKED = ["ISSUED_LOCKED", "APPROVED_LOCKED", "POSTED_LOCKED"];
const SUPPLIER_INVOICE_POSTED = ["POSTED_LOCKED", "PAID"];

function cfg(kind) {
  const c = KIND[kind];
  if (!c) throw new AppError("BAD_PARTY_KIND", `unknown party kind "${kind}"`, 422);
  return c;
}

async function loadParty(client, c, id) {
  const { rows } = await client.query(`SELECT * FROM ${c.table} WHERE ${c.pk} = $1`, [id]);
  return rows[0] || null;
}

/** The party's category CODE (client_type/supplier_type code) — drives document
 *  applicability (§3.2). Null when the party has no category set. */
async function categoryCodeFor(client, c, party) {
  if (!party[c.categoryFk]) return null;
  const { rows } = await client.query(`SELECT code FROM ${c.categoryTable} WHERE ${c.categoryFk} = $1`, [party[c.categoryFk]]);
  return rows[0] ? rows[0].code : null;
}

/** The party's KYC tier for applicability: a HIGH risk tier means ENHANCED
 *  due diligence, everyone else BASIC. (No dedicated column yet; derived so an
 *  ENHANCED-only document type doesn't apply to an ordinary party.) */
const tierFor = (party) => (String(party.risk_tier || "").toUpperCase() === "HIGH" ? "ENHANCED" : "BASIC");

/** Gather everything the rules need and evaluate. Pure result, no writes. */
async function evaluateParty(client, { kind, partyId }) {
  const c = cfg(kind);
  const party = await loadParty(client, c, partyId);
  if (!party) throw new AppError("NOT_FOUND", `${kind} not found`, 404);

  // Sequential, not Promise.all: these all run on the SAME tenant client (one
  // per request), and a pg client cannot execute two queries at once.
  const { rows: documents } = await client.query(`SELECT * FROM ${c.docTable} WHERE ${c.pk} = $1`, [partyId]);
  const { rows: banks } = await client.query(`SELECT * FROM ${c.bankTable} WHERE ${c.pk} = $1`, [partyId]);
  const { rows: docTypes } = await client.query("SELECT * FROM party_document_type WHERE is_active = true");
  const category = await categoryCodeFor(client, c, party);

  // Credit status is a client concept and derives from the GL, never a cache.
  let creditStatus = null;
  if (kind === "client") {
    const { outstanding } = await clientRepo.outstandingFor(client, partyId);
    const limit = party.credit_limit === null || party.credit_limit === undefined ? null : Number(party.credit_limit);
    creditStatus = limit === null ? { within: true } : { within: outstanding <= limit, used: outstanding, limit };
  }

  // Category, country and KYC tier drive document applicability (§3.2); the
  // party's registration/AVL status drives the onboarding-vs-risk rollup (§3.3).
  const result = rules.evaluate({
    appliesTo: c.appliesTo, party, documents, docTypes, banks, creditStatus,
    category, country: party.country_code || party.tax_residency_country || null, tier: tierFor(party),
  });
  return { ...result, party };
}

/** Open (unresolved) flags for one entity_ref. */
async function openFlags(client, entityRef) {
  const { rows } = await client.query(
    "SELECT flag_id, rule_key, severity, message, created_at FROM compliance_flag WHERE entity_ref = $1 AND resolved_at IS NULL ORDER BY created_at DESC",
    [entityRef],
  );
  return rows;
}

const flagKey = (f) => `${f.rule_key}::${f.message || ""}`;

/**
 * Reconcile the desired flag set into compliance_flag for one entity: resolve
 * the open flags that no longer apply, insert the ones that are newly raised,
 * and leave unchanged the ones that persist (so their created_at — "how long has
 * this been open" — is preserved).
 */
async function reconcileFlags(client, entityRef, desired) {
  const open = await openFlags(client, entityRef);
  const openByKey = new Map(open.map((o) => [flagKey(o), o]));
  const desiredKeys = new Set(desired.map(flagKey));

  for (const o of open) {
    if (!desiredKeys.has(flagKey(o))) {
      await client.query("UPDATE compliance_flag SET resolved_at = now() WHERE flag_id = $1", [o.flag_id]);
    }
  }
  for (const d of desired) {
    if (!openByKey.has(flagKey(d))) {
      await client.query(
        "INSERT INTO compliance_flag (rule_key, entity_ref, severity, message) VALUES ($1, $2, $3, $4)",
        [d.rule_key, entityRef, d.severity, d.message],
      );
    }
  }
}

/**
 * Evaluate the party, persist the flags, and store the rolled-up
 * compliance_state on the master. Returns the evaluation plus the open flags.
 * A manual HARD_BLOCK, if set, is preserved — the recompute never lowers a
 * human's block (Hard Rule 3).
 */
async function sync(client, { kind, partyId }) {
  const c = cfg(kind);
  const entityRef = `${kind}:${partyId}`;
  const evalResult = await evaluateParty(client, { kind, partyId });

  await reconcileFlags(client, entityRef, evalResult.flags);

  // A human HARD_BLOCK outranks any computed state; never lower it here. The
  // block is recorded by `hard_blocked_at` (set by POST /:id/block, cleared by
  // /unblock), NOT by compliance_state — so an unblock that clears the timestamp
  // lets this recompute the real state on the next sync.
  const state = evalResult.party.hard_blocked_at ? "HARD_BLOCK" : evalResult.compliance_state;
  await client.query(`UPDATE ${c.table} SET compliance_state = $1, updated_at = now() WHERE ${c.pk} = $2`, [state, partyId]);

  // Carry the pure engine's `onboarding` marker onto the persisted flags (which
  // have flag_id + created_at) so the 360 can split "Required to activate" from
  // real "Compliance issues" without re-deriving the classification (§3.3).
  const onboardingByKey = new Map(evalResult.flags.map((f) => [flagKey(f), !!f.onboarding]));
  const flags = (await openFlags(client, entityRef)).map((f) => ({ ...f, onboarding: onboardingByKey.get(flagKey(f)) || false }));
  return { compliance_state: state, can_verify: evalResult.can_verify, flags };
}

/**
 * GL-integrity parity (§4.2). Sum the locked source documents against what
 * posted to the party's aux account; a mismatch over 1 XAF raises (or keeps) a
 * RED flag, and a match resolves it. Returns the two totals and the delta.
 */
async function glParity(client, { kind, partyId }) {
  const c = cfg(kind);
  const party = await loadParty(client, c, partyId);
  if (!party) throw new AppError("NOT_FOUND", `${kind} not found`, 404);
  const entityRef = `${kind}:${partyId}`;

  if (!party.coa_aux_account) return { docTotal: 0, gl: 0, mismatch: 0, flagged: false, reason: "no aux account" };

  let docTotal = 0;
  if (kind === "client") {
    const { rows } = await client.query(
      "SELECT COALESCE(SUM(total_ttc), 0) AS t FROM invoice WHERE client_id = $1 AND type = 'FINAL' AND status = ANY($2)",
      [partyId, INVOICE_LOCKED],
    );
    docTotal = Number(rows[0].t) || 0;
  } else {
    const { rows } = await client.query(
      "SELECT COALESCE(SUM(amount_ttc), 0) AS t FROM supplier_invoice WHERE supplier_id = $1 AND status = ANY($2)",
      [partyId, SUPPLIER_INVOICE_POSTED],
    );
    docTotal = Number(rows[0].t) || 0;
  }

  // The posted movement on the aux account, on the side its normal balance sits.
  const { rows: glRows } = await client.query(
    `SELECT COALESCE(SUM(jl.${c.auxSide}), 0) AS g
       FROM journal_line jl JOIN journal_entry je ON je.entry_id = jl.entry_id
      WHERE jl.account_code = $1 AND je.status = 'validated'`,
    [party.coa_aux_account],
  );
  const gl = Number(glRows[0].g) || 0;
  const mismatch = Math.round((docTotal - gl) * 100) / 100;
  const flagged = Math.abs(mismatch) > 1;

  const desired = flagged
    ? [{ rule_key: "party.gl_mismatch", severity: "RED", message: `GL Integrity Mismatch — possible unposted document or manual journal (docs ${docTotal} vs GL ${gl})` }]
    : [];
  // Reconcile ONLY the gl_mismatch flag, leaving the rules-driven flags alone.
  const open = (await openFlags(client, entityRef)).filter((f) => f.rule_key === "party.gl_mismatch");
  for (const o of open) await client.query("UPDATE compliance_flag SET resolved_at = now() WHERE flag_id = $1", [o.flag_id]);
  for (const d of desired) {
    await client.query(
      "INSERT INTO compliance_flag (rule_key, entity_ref, severity, message) VALUES ($1, $2, $3, $4)",
      [d.rule_key, entityRef, d.severity, d.message],
    );
  }

  return { docTotal, gl, mismatch, flagged };
}

/**
 * Transactional compliance gate (§5 / spec §9). Answer whether a party may be
 * USED for `action` (client: quote/dossier/invoice/dispatch; supplier: PO/GRN/
 * supplier-invoice/payment). Recomputes the pure engine so the answer is always
 * self-consistent — a stale stored state never under-reports — and returns:
 *
 *   { allowed, state, requiresOverride, blockingFlags[], reason? }
 *
 * Behaviour (Hard Rule 3 — never silently block):
 *   - HARD_BLOCK (human-set): allowed=false — a clear stop with a reason.
 *   - SOFT_BLOCK_RECOMMENDATION / ESCALATED: allowed=true, requiresOverride=true
 *     — freight moves with a logged override (reason + actor).
 *   - WARN / INFO / ONBOARDING / OK: allowed=true, requiresOverride=false.
 *
 * Pure of writes — the caller decides whether to proceed (and calls
 * `enforceAllowed` / `logOverride` to record an override).
 */
/**
 * The gate decision from an evaluation — PURE (unit-tested). Split from the DB
 * read so the HARD_BLOCK-stops / SOFT-ESCALATED-override / WARN-INFO-ONBOARDING-
 * allow rules can be asserted directly.
 */
function gateDecision({ party = {}, compliance_state = "OK", flags = [] }) {
  const hardBlocked = !!party.hard_blocked_at || compliance_state === "HARD_BLOCK";
  const state = hardBlocked ? "HARD_BLOCK" : compliance_state;
  const blockingFlags = (flags || [])
    .filter((f) => !f.onboarding && BLOCKING_SEVERITY.has(f.severity))
    .map((f) => ({ rule_key: f.rule_key, severity: f.severity, message: f.message }));
  if (hardBlocked) {
    return { allowed: false, state, requiresOverride: false, reason: party.hard_block_reason || "Party is hard-blocked", blockingFlags };
  }
  return { allowed: true, state, requiresOverride: OVERRIDE_STATES.has(state), blockingFlags };
}

async function assertAllowed(client, { kind, partyId, action = null }) {
  const evalr = await evaluateParty(client, { kind, partyId });
  return { ...gateDecision({ party: evalr.party, compliance_state: evalr.compliance_state, flags: evalr.flags }), action };
}

/** Record a compliance override (reason + actor) on the immutable ledger. */
async function logOverride(client, { kind, partyId, action = null, reason, actor = {} }) {
  if (!reason || !String(reason).trim()) throw new AppError("OVERRIDE_REASON_REQUIRED", "An override reason is required.", 422, { reason: ["required"] });
  await audit(client, {
    actorUserId: actor.user_id || null, action: `${kind}.compliance_override`, moduleKey: MODULE_KEY[kind],
    entityRef: `${kind}:${partyId}`, isSensitive: true, after: { action, reason: String(reason).trim() }, metadata: { gate_action: action || null },
  });
  return { logged: true };
}

/**
 * Enforce the gate at a call site. Throws on a hard stop; throws OVERRIDE_REQUIRED
 * (carrying the flags for the UI's override dialog) when a recommendation/
 * escalation needs a reason and none was supplied; logs and passes when a reason
 * is supplied; otherwise returns the (allowed) assessment.
 */
async function enforceAllowed(client, { kind, partyId, action = null, override = null, actor = {} }) {
  const gate = await assertAllowed(client, { kind, partyId, action });
  if (!gate.allowed) {
    throw new AppError("COMPLIANCE_BLOCKED", gate.reason || "Party is hard-blocked — action not allowed.", 409, { blockingFlags: gate.blockingFlags });
  }
  if (gate.requiresOverride) {
    const reason = override && String(override).trim() ? String(override).trim() : null;
    if (!reason) {
      throw new AppError("OVERRIDE_REQUIRED", `Compliance is ${gate.state} for this party — proceed only with a logged override reason.`, 422, { blockingFlags: gate.blockingFlags, state: gate.state });
    }
    await logOverride(client, { kind, partyId, action, reason, actor });
    return { ...gate, overridden: true, override_reason: reason };
  }
  return gate;
}

module.exports = { KIND, evaluateParty, sync, glParity, openFlags, reconcileFlags, gateDecision, assertAllowed, enforceAllowed, logOverride };
