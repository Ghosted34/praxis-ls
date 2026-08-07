/**
 * Sensitive-field maker-checker + governed-merge gating (PR3-C §5.2 / §8).
 *
 * Some changes are too consequential for one person to make alone: a bank
 * account (BEC fraud), a legal name / tax registration / credit limit / status
 * on a master, and a governed merge. In LIVE those are written here as a PENDING
 * `party_change_request` and applied only when a SECOND authorizer — someone
 * other than the requester — approves them (segregation of duties). In
 * TEST/sandbox the change applies directly so training is never blocked.
 *
 * The gate is the change-request row itself: the requester cannot approve their
 * own request (`assertNotRequester`), which is the maker-checker control. An
 * approval-task is also opened through the workflow engine for visibility /
 * notification when a tenant has one bound, but the authoritative record is this
 * table, so the control works even in a tenant with no workflow configured.
 *
 * Bank changes additionally emit a HIGH `party.bank_account_changed` event — the
 * out-of-band confirmation signal (§8; the actual e-mail to a known contact is
 * left to the notification layer / deferred per the brief).
 */
"use strict";
const { insertOne, updateOne } = require("../../../shared/db/query-helpers");
const { audit, emitEvent, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const KIND = {
  client: { table: "client_master", pk: "client_id", moduleKey: "MOD-03" },
  supplier: { table: "supplier_master", pk: "supplier_id", moduleKey: "MOD-04" },
};

// Allow-lists for the apply path — kept in step with _shared/nested.js so an
// approved change writes exactly the columns the direct path would have.
const BANK_COLS = ["beneficiary_name", "bank_name", "branch", "account_number", "iban", "swift_bic", "routing_code", "currency", "momo_network", "momo_number", "is_primary", "is_active"];
const REG_COLS = ["country_code", "kind", "number", "issuing_authority", "issued_on", "expires_on"];
const MASTER_SENSITIVE_COLS = ["legal_name", "name", "credit_limit", "registration_status", "niu", "rccm", "tax_residency_country"];

const cfg = (kind) => {
  const k = KIND[kind];
  if (!k) throw new AppError("BAD_PARTY_KIND", `unknown party kind "${kind}"`, 422);
  return k;
};

/** LIVE routes through maker-checker; TEST/sandbox applies directly. */
const isGoverned = (env) => env === "live";

/** Lower/trim/collapse — the same dedup key the write path stores (0513). */
const normName = (v) => (String(v || "").toLowerCase().replace(/\s+/g, " ").trim() || null);

/**
 * Open a PENDING change request (LIVE). Emits a change event and, for a bank
 * change, the HIGH out-of-band confirmation signal. Returns the request row with
 * a `pending: true` marker so the controller can answer 202.
 */
async function open(c, { kind, partyId, changeType, targetTable = null, targetId = null, payload = {}, reason = null, actor = {} }) {
  const k = cfg(kind);
  const requestedBy = await resolveActorId(c, actor.user_id);
  const row = await insertOne(
    c, "party_change_request",
    { party_kind: kind, party_id: partyId, change_type: changeType, target_table: targetTable, target_id: targetId, payload, reason, requested_by: requestedBy },
    "*",
    ["party_kind", "party_id", "change_type", "target_table", "target_id", "payload", "reason", "requested_by"],
  );
  await audit(c, {
    actorUserId: actor.user_id || null, action: `${kind}.change_requested`, moduleKey: k.moduleKey,
    entityRef: `party_change:${row.change_request_id}`, isSensitive: true, after: { change_type: changeType, party: `${kind}:${partyId}` },
  });
  // Approval-task for visibility (best-effort; no-op when no workflow is bound).
  await emitEvent(c, {
    eventTypeKey: "party.change_requested", moduleKey: k.moduleKey,
    entityRef: `party_change:${row.change_request_id}`, actorUserId: actor.user_id || null,
    priority: "HIGH", payload: { change_type: changeType, party: `${kind}:${partyId}` },
  });
  if (changeType === "BANK_CREATE" || changeType === "BANK_UPDATE") {
    await emitEvent(c, {
      eventTypeKey: "party.bank_account_changed", moduleKey: k.moduleKey,
      entityRef: `${kind}:${partyId}`, actorUserId: actor.user_id || null,
      priority: "HIGH", payload: { op: changeType, pending_change_request: row.change_request_id },
    });
  }
  return { ...row, pending: true };
}

/** Apply an approved change's proposed values. Runs inside the caller's tx. */
async function applyChange(c, { request, actor = {} }) {
  const k = cfg(request.party_kind);
  const pk = k.pk;
  const partyId = request.party_id;
  const payload = request.payload || {};

  if (request.change_type === "MERGE") {
    const merge = require("../party_merge/party_merge.service");
    return merge.executeMerge(c, { kind: request.party_kind, survivorId: partyId, loserId: payload.loser_id, actor });
  }
  if (request.change_type === "BANK_CREATE") {
    return insertOne(c, request.target_table, { ...payload, [pk]: partyId }, "*", [...BANK_COLS, pk]);
  }
  if (request.change_type === "BANK_UPDATE") {
    return updateOne(c, request.target_table, "bank_account_id", request.target_id, payload, "*", BANK_COLS, { touch: "updated_at" });
  }
  if (request.change_type === "TAX_REGISTRATION") {
    if (request.target_id) return updateOne(c, "party_registration", "registration_id", request.target_id, payload, "*", REG_COLS);
    return insertOne(c, "party_registration", { ...payload, [pk]: partyId }, "*", [...REG_COLS, pk]);
  }
  // Master-field sensitive change (LEGAL_NAME / CREDIT_LIMIT / STATUS).
  const patch = { ...payload };
  if (patch.legal_name !== undefined || patch.name !== undefined) {
    patch.name_norm = normName(patch.legal_name || patch.name);
  }
  const row = await updateOne(c, k.table, pk, partyId, patch, "*", [...MASTER_SENSITIVE_COLS, "name_norm"], { touch: "updated_at" });
  // An approved activation must still allocate the aux account + refresh
  // compliance, exactly as the direct update path does. onActivate is
  // transaction-less, so it is safe inside the approval's open transaction.
  if (row && row.registration_status === "ACTIVE" && !row.coa_aux_account) {
    const lifecycle = require("../party-lifecycle.service");
    await lifecycle.onActivate(c, { kind: request.party_kind, partyId });
    return updateOne(c, k.table, pk, partyId, {}, "*", null, { touch: "updated_at" });
  }
  return row;
}

// Master-level sensitive fields (§8). Tax registrations are governed at the
// nested `registrations` resource (TAX_REGISTRATION); niu/rccm mirrors ride with
// them, so they are deliberately NOT re-gated here.
const SENSITIVE_MASTER = ["legal_name", "credit_limit", "registration_status"];

/**
 * Split the sensitive master fields out of an update patch (MUTATES `patch`,
 * removing them) and classify the change. Returns `{ sensitive, changeType }`;
 * `changeType` is null when nothing sensitive is present. Called by the master
 * update service only when the request is governed (LIVE).
 */
function pickSensitiveMaster(patch) {
  const sensitive = {};
  for (const f of SENSITIVE_MASTER) {
    if (patch[f] !== undefined) { sensitive[f] = patch[f]; delete patch[f]; }
  }
  const changeType = sensitive.legal_name !== undefined ? "LEGAL_NAME"
    : sensitive.credit_limit !== undefined ? "CREDIT_LIMIT"
      : sensitive.registration_status !== undefined ? "STATUS" : null;
  return { sensitive, changeType };
}

/** The requester may never approve their own request (maker-checker). */
function assertNotRequester(request, actor) {
  if (actor.user_id && request.requested_by && String(request.requested_by) === String(actor.user_id)) {
    throw new AppError("SELF_APPROVAL", "You raised this change — it must be approved by someone else.", 403);
  }
}

async function load(c, changeRequestId) {
  const { rows } = await c.query("SELECT * FROM party_change_request WHERE change_request_id = $1", [changeRequestId]);
  return rows[0] || null;
}

/** Second-authorizer approval: apply the change and mark it APPLIED. */
async function approve(c, { kind, partyId, changeRequestId, actor = {} }) {
  const k = cfg(kind);
  const request = await load(c, changeRequestId);
  if (!request || request.party_kind !== kind || String(request.party_id) !== String(partyId)) {
    throw new AppError("NOT_FOUND", "Change request not found", 404);
  }
  if (request.status !== "PENDING") throw new AppError("ALREADY_DECIDED", `Change request already ${request.status}`, 422);
  assertNotRequester(request, actor);

  await c.query("BEGIN");
  try {
    const applied = await applyChange(c, { request, actor });
    const decidedBy = await resolveActorId(c, actor.user_id);
    const appliedRef = applied && (applied.bank_account_id || applied.registration_id || applied[k.pk])
      ? `${request.target_table || k.table}:${applied.bank_account_id || applied.registration_id || applied[k.pk]}`
      : null;
    await c.query(
      "UPDATE party_change_request SET status = 'APPLIED', decided_by = $2, decided_at = now(), applied_ref = $3 WHERE change_request_id = $1",
      [changeRequestId, decidedBy, appliedRef],
    );
    await audit(c, {
      actorUserId: actor.user_id || null, action: `${kind}.change_approved`, moduleKey: k.moduleKey,
      entityRef: `party_change:${changeRequestId}`, isSensitive: true, after: { change_type: request.change_type, applied_ref: appliedRef },
    });
    await c.query("COMMIT");
    return { approved: true, change_request_id: changeRequestId, change_type: request.change_type, applied };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

/** Reject a pending change (no application). */
async function reject(c, { kind, partyId, changeRequestId, actor = {} }) {
  const k = cfg(kind);
  const request = await load(c, changeRequestId);
  if (!request || request.party_kind !== kind || String(request.party_id) !== String(partyId)) {
    throw new AppError("NOT_FOUND", "Change request not found", 404);
  }
  if (request.status !== "PENDING") throw new AppError("ALREADY_DECIDED", `Change request already ${request.status}`, 422);
  const decidedBy = await resolveActorId(c, actor.user_id);
  const { rows: [row] } = await c.query(
    "UPDATE party_change_request SET status = 'REJECTED', decided_by = $2, decided_at = now() WHERE change_request_id = $1 RETURNING *",
    [changeRequestId, decidedBy],
  );
  await audit(c, {
    actorUserId: actor.user_id || null, action: `${kind}.change_rejected`, moduleKey: k.moduleKey,
    entityRef: `party_change:${changeRequestId}`, isSensitive: true, after: { change_type: request.change_type },
  });
  return row;
}

/** Pending change requests for a party — surfaced on the 360. */
async function pendingFor(c, { kind, partyId }) {
  const { rows } = await c.query(
    `SELECT change_request_id, change_type, target_table, target_id, payload, reason, status, requested_by, requested_at
       FROM party_change_request
      WHERE party_kind = $1 AND party_id = $2 AND status = 'PENDING'
      ORDER BY requested_at DESC`,
    [kind, partyId],
  );
  return rows;
}

module.exports = { KIND, BANK_COLS, REG_COLS, MASTER_SENSITIVE_COLS, SENSITIVE_MASTER, isGoverned, open, applyChange, approve, reject, pendingFor, pickSensitiveMaster, assertNotRequester };
