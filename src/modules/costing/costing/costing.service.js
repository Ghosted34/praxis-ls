/**
 * Project costing (MOD-46, KB §6.7). A dossier BUDGET: what this file will cost
 * us, HT / VAT / TTC, with a draft → validate → approve lifecycle. No GL
 * (budget only) — actuals post via cost_tracking (MOD-47) and are reconciled
 * against this by dossier_reconciliation. SQL in the repo.
 *
 * WHAT A COSTING IS NOT (12766). It is not a price, and it does not open an
 * invoice. Costing is raised by an operations officer; the final invoice is
 * raised by a finance officer from the accepted quotation. A document that
 * silently creates another department's document is a control weakness rather
 * than a convenience, so the two paths that used to do it — a synchronous
 * `ensureDraftForCosting` here and an orchestration backstop on
 * `costing.approved` — are both gone.
 */
"use strict";
const repo = require("./costing.repo");
const events = require("./costing.events");
const { computeCosting, toXaf, snapshotLines, diffLines } = require("./costing.rules");
const suggest = require("./costing.suggest");
const numbering = require("../../../services/documents/numbering.service");
const currency = require("../../master/currency/currency.service");
const executor = require("../../../services/workflow/executor");
const onApproved = require("../../../services/workflow/on-approved");
const { assertNoPendingChain } = require("../../../services/workflow/pending-guard");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");
const { AppError } = require("../../../utils/errors");
const shipmentDetails = require("../../operations/shipment_details/shipment_details.service");

const LOCKED = new Set(["APPROVED_LOCKED", "REJECTED"]);

/**
 * The unlock loop — the way out of APPROVED_LOCKED (10718).
 *
 * `setStatus` refuses ANY transition out of a locked status before it looks at
 * the target, which is correct for the ordinary flow and is exactly why an
 * approved costing could never be corrected. Rather than punch a hole in that
 * guard, unlock is its own small state machine handled ahead of it: request,
 * grant, deny. Legacy did the same (api/costing/transition.php:175-205) and
 * parked the request in its own status so "someone has asked" is visible.
 */
const UNLOCK_FLOW = {
  REQUEST_UNLOCK: { from: "APPROVED_LOCKED", to: "UNLOCK_REQUESTED" },
  // Legacy returns to DRAFT (transition.php:192), and DRAFT is the only status
  // updateDraft will edit — anywhere else would be unlocked in name and still
  // uneditable in fact.
  UNLOCK: { from: "UNLOCK_REQUESTED", to: "DRAFT" },
  DENY_UNLOCK: { from: "UNLOCK_REQUESTED", to: "APPROVED_LOCKED" },
};

/*
 * WHY THERE IS NO INVOICE GUARD HERE ANY MORE (12766, owner decision).
 *
 * `assertInvoiceNotPosted` used to refuse an unlock once the dossier's final
 * invoice had left DRAFT. Its premise was that approving a costing priced the
 * invoice, so reopening the costing underneath a posted receivable would let
 * the priced basis move while booked revenue stayed put.
 *
 * That premise no longer holds twice over. The invoice prices from the accepted
 * QUOTATION, never from the costing (`final_invoice.assertPricedSource`), and
 * as of this change a costing does not open an invoice at all. So a posted
 * invoice says nothing about whether this file's BUDGET is still correct.
 *
 * And the guard blocked a real case. A file is billed; a week later the carrier
 * sends a detention charge because the box sat past its free time. The only
 * correct response is to reopen the costing, add the line, raise the cash to
 * pay it, and amend the invoice. Refusing the unlock left that spend with
 * nowhere to be budgeted, which is how it ends up off the file's margin
 * entirely. Rare, and precisely the case a costing exists to capture.
 *
 * What still protects the ledger is unchanged and lives where it belongs: an
 * ISSUED or POSTED invoice cannot be silently edited (`updateDraft` refuses
 * anything but DRAFT — post a reversal instead), and every unlock needs a
 * written reason plus an APPROVER-capable grant.
 */

/**
 * REQUEST_UNLOCK / UNLOCK / DENY_UNLOCK.
 *
 * Permissions are NOT ported from the legacy role lists. Hardcoded role names
 * are strictly less expressive than this system's module grants plus the SoD
 * capability overlay, so the routes express the same intent as `edit` for the
 * request and `approve` + APPROVER for the decision — the split
 * costing.routes.js already documents for SUBMIT vs APPROVE.
 */
async function unlockTransition(client, { id, action, reason = null, actor = {} }) {
  const step = UNLOCK_FLOW[action];
  if (!step) throw new AppError("BAD_ACTION", "unknown unlock action", 422);

  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Costing not found", 404);
  if (before.status !== step.from) {
    throw new AppError(
      "BAD_STATE",
      `${action} needs a costing in ${step.from}; this one is ${before.status}`,
      422,
    );
  }
  if (action === "REQUEST_UNLOCK" && !String(reason || "").trim()) {
    // The audit answer to "why is this approved costing open again". Legacy
    // appended it to a free-text remarks blob; here it is a column.
    throw new AppError("REASON_REQUIRED", "Say why the costing needs reopening", 422);
  }

  const patch = { status: step.to };
  if (action === "REQUEST_UNLOCK") {
    // DATA 2.4: FK to app_user, which lives in LIVE while this row may land in
    // SANDBOX. check-actor-fk-guard.js cannot see this idiom (it matches
    // `x_by:` in an object literal, not `patch.x_by =`), so it is guarded by
    // hand for the same reason the guard exists.
    patch.unlock_requested_by = await resolveActorId(client, actor.user_id);
    patch.unlock_requested_at = new Date().toISOString();
    patch.unlock_reason = reason;
  }
  if (action === "UNLOCK") {
    // DATA 2.4 — as above.
    patch.unlocked_by = await resolveActorId(client, actor.user_id);
    patch.unlocked_at = new Date().toISOString();
    // The sheet is editable again, so it is no longer locked. Leaving the old
    // stamp would make the printed document claim a lock that is not in force.
    patch.locked_at = null;
  }
  // DENY_UNLOCK deliberately keeps unlock_reason and the request metadata: the
  // fact that a reopening was asked for and refused is the audit trail.

  const row = await repo.update(client, id, patch);
  await emitEvent(client, {
    eventTypeKey: events.unlockEvent(action),
    moduleKey: events.MODULE,
    entityRef: "costing:" + id,
    actorUserId: actor.user_id || null,
  });
  await audit(client, {
    actorUserId: actor.user_id || null,
    action: events.unlockEvent(action),
    moduleKey: events.MODULE,
    entityRef: "costing:" + id,
    before,
    after: row,
  });
  return row;
}

async function replaceLines(client, costingId, lines) {
  await repo.deleteLines(client, costingId);
  let n = 0;
  for (const l of lines) {
    n += 1;

    await repo.insertLine(client, {
      costing_id: costingId, dictionary_item_id: l.dictionary_item_id || null, label: l.label || "Line",
      // 12766: the sheet's order. Assigned from the payload's order, which is
      // the order the person arranged the lines in on screen.
      line_no: n,
      qty: l.qty || 1, unit_cost: l.unit_cost || 0, is_disbursement: l.is_disbursement === true,
      // A pass-through line can never carry a tax code (DB rule, 0640:156), so
      // one arriving on a disbursement is dropped here rather than being sent
      // to the database to be rejected with a trigger exception.
      tax_code_id: l.is_disbursement === true ? null : (l.tax_code_id || null),
      // Which box this charge was priced for (0663). NULL for anything with no
      // equipment dimension, which is most of the catalogue.
      container_type_ref_id: l.container_type_ref_id || null,
      // 12766: the supplier's own VAT inside a pass-through gross — disclosed,
      // never charged. Meaningless on a service line, so it is not stored there.
      upstream_vat_amount: l.is_disbursement === true && l.upstream_vat_amount !== undefined && l.upstream_vat_amount !== null
        ? l.upstream_vat_amount
        : null,
    });
  }
}

/**
 * Recompute the stored totals from the lines as they now stand.
 *
 * Read back through `listLines` rather than trusting the payload: that join is
 * what supplies each line's own VAT rate from its tax code, and it is the same
 * read `get` uses — so the number stored on the row and the number the
 * worksheet footer shows cannot diverge.
 */
async function persistTotals(client, costingId, exchangeRateToXaf) {
  const lines = await repo.listLines(client, costingId);
  const totals = computeCosting(lines);
  await repo.update(client, costingId, {
    total_ht: totals.total_ht,
    total_vat: totals.vat_total,
    total_ttc: totals.total_ttc,
    total_ttc_xaf: toXaf(totals.total_ttc, exchangeRateToXaf),
  });
  return totals;
}

/**
 * The rate this sheet is priced at, defaulted from Currencies & FX.
 *
 * A rate typed from memory is a number nobody can check six months later.
 * `fx_rate_daily` is synced daily and manually overridable, so the default is a
 * real quote for the sheet's own date. An explicit rate in the payload always
 * wins — the operator may have contracted at a different one.
 *
 * Falls back to 1 rather than failing: a missing FX quote must not stop someone
 * costing a file, and the resulting sheet is still correct in its own currency.
 */
async function resolveRate(client, { currencyCode, explicit }) {
  const code = String(currencyCode || "XAF").toUpperCase();
  if (explicit !== undefined && explicit !== null && Number(explicit) > 0) return Number(explicit);
  if (code === "XAF") return 1;
  try {
    const hit = await currency.rateFor(client, {
      base: code, quote: "XAF", date: new Date().toISOString().slice(0, 10),
    });
    const rate = Number(hit && hit.rate);
    if (Number.isFinite(rate) && rate > 0) return rate;
  } catch (err) {
    // @silent:expected — no quote on file for this pair/date is ordinary (a
    // currency added this morning, a weekend with no sync). The sheet stays
    // valid in its own currency and the operator can type the rate.
    logger.info({ err: err && err.message, currency: code }, "no FX quote for costing; defaulting rate to 1");
  }
  return 1;
}

/**
 * Turn the one-live-costing-per-file unique index into a sentence.
 *
 * 12766 added `uq_costing_one_live_per_dossier`. Without this the caller gets a
 * raw 23505 with a constraint name in it; with it they are told which sheet
 * already exists so they can go and open it — which is the thing legacy's
 * duplicate check was reaching for and got wrong (it searched a period-filtered
 * endpoint, so a costing raised last month was invisible and you got a second).
 */
async function assertNoLiveCosting(client, dossierId) {
  const existing = await repo.liveForDossier(client, dossierId);
  if (existing) {
    throw new AppError(
      "COSTING_EXISTS",
      `This operations file already has a costing (${existing.doc_number || existing.costing_id.slice(0, 8)}, ${existing.status}). ` +
        "A file has one costing: open that one, and if it is approved request an unlock to amend it.",
      409,
      { costing_id: existing.costing_id, status: existing.status },
    );
  }
}

async function createDraft(client, { data, actor = {} }) {
  await assertNoLiveCosting(client, data.dossier_id);
  const rate = await resolveRate(client, {
    currencyCode: data.currency, explicit: data.exchange_rate_to_xaf,
  });
  await client.query("BEGIN");
  try {
    const costing = await repo.insert(client, {
      dossier_id: data.dossier_id, currency: data.currency || "XAF",
      // §2.2: margin_percent is deprecated and never written — costing stops
      // at HT/VAT/TTC; margin belongs to margin_simulation + quotation.
      exchange_rate_to_xaf: rate, status: "DRAFT",
      // §3.3: remarks + the named validator (legacy save.php:29,:6,:33). The
      // assignment moment is recorded so a stalled validation is visible.
      remarks: data.remarks || null,
      validator_id: data.validator_id || null,
      validator_assigned_at: data.validator_id ? new Date() : null,
    });
    if (Array.isArray(data.lines) && data.lines.length) await replaceLines(client, costing.costing_id, data.lines);
    await persistTotals(client, costing.costing_id, rate);
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "costing:" + costing.costing_id, after: costing });
    await client.query("COMMIT");
    return get(client, costing.costing_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function updateDraft(client, { id, patch = {}, lines = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Costing not found", 404);
  if (before.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT costing can be edited", 422);
  await client.query("BEGIN");
  try {
    const fields = {};
    // §2.2: margin_percent removed from the patchable set — deprecated column.
    for (const k of ["currency", "remarks"]) if (patch[k] !== undefined) fields[k] = patch[k];
    if (patch.currency !== undefined || patch.exchange_rate_to_xaf !== undefined) {
      fields.exchange_rate_to_xaf = await resolveRate(client, {
        currencyCode: patch.currency !== undefined ? patch.currency : before.currency,
        explicit: patch.exchange_rate_to_xaf,
      });
    }
    // §3.3: naming (or changing) the validator stamps when it happened.
    if (patch.validator_id !== undefined) {
      fields.validator_id = patch.validator_id;
      fields.validator_assigned_at = patch.validator_id ? new Date() : null;
    }
    if (Object.keys(fields).length) await repo.update(client, id, fields);
    if (Array.isArray(lines)) await replaceLines(client, id, lines);
    await persistTotals(
      client, id,
      fields.exchange_rate_to_xaf !== undefined ? fields.exchange_rate_to_xaf : before.exchange_rate_to_xaf,
    );
    // Editing a costing was the one transition on this document that left no
    // trail: `actor` was accepted and dropped. On a sheet that can be unlocked
    // and re-approved, "who changed the figure between approvals" is precisely
    // the question the audit log exists to answer.
    const after = await repo.get(client, id);
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE,
      entityRef: "costing:" + id, before, after,
    });
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Mint the sheet's reference, once, when it first leaves the author's desk.
 *
 * At create would burn a sequence number on every abandoned draft; at approval
 * would be too late for the validator, who needs something to refer to. First
 * submit is the moment it becomes a document other people talk about.
 *
 * A file with no corporate entity cannot be numbered (`numbering.allocate`
 * requires one to scope the sequence). That is a data gap on the file, not a
 * reason to block a submission, so it is skipped and retried on the next
 * transition — the same call is guarded on `doc_number` being null.
 */
async function ensureDocNumber(client, costing) {
  if (costing.doc_number) return costing.doc_number;
  const { rows } = await client.query("SELECT entity_id FROM dossier_visible WHERE dossier_id = $1", [costing.dossier_id]);
  const entityId = rows[0] && rows[0].entity_id;
  if (!entityId) {
    logger.warn({ costing_id: costing.costing_id }, "costing submitted on a file with no corporate entity; reference not allocated");
    return null;
  }
  const allocated = await numbering.allocate(client, {
    moduleKey: events.MODULE, entityId, date: new Date().toISOString().slice(0, 10),
  });
  return allocated.number;
}

async function setStatus(client, { id, to, actor = {}, viaChain = false }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Costing not found", 404);
  if (LOCKED.has(before.status)) throw new AppError("LOCKED", "Costing is " + before.status, 422);
  const flow = { SUBMIT_VALIDATION: "SUBMITTED_FOR_VALIDATION", SUBMIT_APPROVAL: "SUBMITTED_FOR_APPROVAL", APPROVE: "APPROVED_LOCKED", REJECT: "REJECTED" };
  const status = flow[to];
  if (!status) throw new AppError("BAD_ACTION", "unknown transition", 422);
  // §3.3: legacy save.php names validator_employee_id at submit time. Ours
  // silently allowed a costing to sit SUBMITTED_FOR_VALIDATION with nobody
  // named to validate it — a queue with no owner. Submitting for validation
  // now requires the validator to be picked first.
  if (to === "SUBMIT_VALIDATION" && !before.validator_id) {
    throw new AppError("NO_VALIDATOR", "Pick a validator before submitting for validation — a submission with nobody named goes to no one's queue", 422);
  }
  // Approving/rejecting directly while a chain is live would skip it (W4).
  if (to === "APPROVE" || to === "REJECT") {
    await assertNoPendingChain(client, "costing:" + id, { viaChain, what: "costing" });
  }

  const patch = { status };
  const now = new Date().toISOString();

  // The reference, minted once, on the way out of the author's hands.
  if (to === "SUBMIT_VALIDATION" || to === "SUBMIT_APPROVAL") {
    const number = await ensureDocNumber(client, before);
    if (number && !before.doc_number) patch.doc_number = number;
  }
  // Who actually validated, as distinct from who it was addressed to. DATA 2.4
  // — resolved against the schema being written to, same as the unlock loop.
  if (to === "SUBMIT_APPROVAL") {
    patch.validated_by = await resolveActorId(client, actor.user_id);
    patch.validated_at = now;
  }
  if (to === "APPROVE") {
    // DATA 2.4 — as above. `approver_id` has existed since 0320 and was never
    // written, which is why the file 360's People block showed a null approver
    // on every costing ever approved.
    patch.approver_id = await resolveActorId(client, actor.user_id);
    patch.approved_at = now;
    patch.locked_at = now;
  }

  const row = await repo.update(client, id, patch);
  // On submit-for-approval, open the tenant's configurable approval chain (if any
  // workflow is bound to costing.submitted).
  // No workflow bound → autoApproved and the manual APPROVE path stays available;
  // see the note on W8 in purchase_order.service.js for why nothing auto-advances.
  if (status === "SUBMITTED_FOR_APPROVAL") {
    // `total_ht` — the money the sheet commits us to. Read from the stored
    // column (12766) rather than recomputed: it is the figure the registry and
    // the KPI strip show, so the threshold and the screen agree.
    await executor.start(client, { eventTypeKey: "costing.submitted", entityRef: "costing:" + id, amountXaf: Number(row.total_ttc_xaf) || null });
  }
  if (status === "APPROVED_LOCKED") {
    await emitEvent(client, { eventTypeKey: events.APPROVED, moduleKey: events.MODULE, entityRef: "costing:" + id, actorUserId: actor.user_id || null });
    // Freeze the file's shipment details onto the costing (0661). An approved
    // costing must keep citing the vessel and route it was approved with, even
    // after the carrier rolls the booking and ops updates the file. Never
    // throws — see shipment_details.snapshotOnto.
    await shipmentDetails.snapshotOnto(client, { table: "costing", id, dossierId: before.dossier_id });
    // Freeze the LINES too (12766), so the next amendment after an unlock can
    // show the approver what moved instead of fourteen unchanged rows.
    await snapshotApproval(client, { costing: row, actor });
  }
  await audit(client, { actorUserId: actor.user_id || null, action: events.statusChange(status), moduleKey: events.MODULE, entityRef: "costing:" + id, before, after: row });
  return row;
}

/** The frozen line set for one approval. Best-effort: the approval itself has
 *  already landed, and losing a diff must not undo it. */
async function snapshotApproval(client, { costing, actor = {} }) {
  try {
    const lines = await repo.listLines(client, costing.costing_id);
    const revision = (await repo.snapshotCount(client, costing.costing_id)) + 1;
    await repo.insertSnapshot(client, {
      costing_id: costing.costing_id,
      revision,
      lines: JSON.stringify(snapshotLines(lines)),
      total_ht: costing.total_ht,
      total_vat: costing.total_vat,
      total_ttc: costing.total_ttc,
      currency: costing.currency,
      // DATA 2.4 — FK to app_user, resolved against the schema being written to.
      approved_by: await resolveActorId(client, actor.user_id),
    });
  } catch (err) {
    logger.error({ err, costing_id: costing.costing_id }, "costing approval snapshot failed; the amendment diff will be unavailable for this revision");
  }
}

/**
 * The worksheet, with everything it needs to render itself.
 *
 * `amendment` is present only on a sheet that has been approved before and has
 * since moved — which is exactly when somebody is about to be asked to approve
 * it a second time and needs to know what changed.
 */
async function get(client, id, { lang = "en" } = {}) {
  const costing = await repo.get(client, id);
  if (!costing) return null;
  const lines = await repo.listLines(client, id);
  costing.lines = lines;
  costing.totals = computeCosting(lines);
  costing.totals.total_ttc_xaf = toXaf(costing.totals.total_ttc, costing.exchange_rate_to_xaf);

  // The file this sheet is costing — its reference, its client, its service and
  // its carrier. The worksheet needs all four to name what it is looking at,
  // and a sheet opened from a pasted link has a uuid and nothing else
  // (FRONTEND_GUIDE §3.11 rule 2: the body renders from the RESPONSE).
  costing.file = costing.dossier_id
    ? await repo.dossierForCosting(client, costing.dossier_id)
    : null;
  costing.containers = costing.dossier_id
    ? await repo.containerTypesOnFile(client, costing.dossier_id)
    : [];

  /*
   * The shipment facts — frozen if the sheet was approved, live if it is still
   * being worked on. Same rule, and the same fallback direction, as the transit
   * order (transit_order.service.js:142): a draft should reflect whatever ops
   * last learned about the file, while an approved sheet must keep citing the
   * vessel and route it was approved WITH, because the carrier will roll the
   * booking and ops will update the file.
   *
   * `shipment_details_source` reports which was used rather than leaving the
   * reader to infer it. 0661 has been writing that snapshot onto costings since
   * it landed, and until now nothing read it back.
   */
  let details = costing.shipment_details_snapshot || null;
  let source = details ? "SNAPSHOT" : null;
  if (!details && costing.dossier_id) {
    try {
      details = await shipmentDetails.forDossier(client, costing.dossier_id, { lang });
      source = "LIVE";
    } catch (err) {
      // A file whose service type lost its field set must not make the costing
      // unreadable — the same forgiving-read rule shipment_details follows.
      logger.warn({ err, costing_id: id }, "[costing] shipment details unavailable");
      details = null;
    }
  }
  costing.shipment_details = details;
  costing.shipment_details_source = source;

  const snapshot = await repo.latestSnapshot(client, id);
  if (snapshot) {
    const diff = diffLines(snapshot.lines || [], lines);
    costing.amendment = diff.has_changes
      ? { ...diff, since_revision: snapshot.revision, approved_at: snapshot.approved_at }
      : null;
  } else {
    costing.amendment = null;
  }
  return costing;
}

/** The registry page: rows plus the true match count (X-Total-Count). */
const listPaged = (client, q) => repo.list(client, q);

/**
 * Bare array. Kept alongside `listPaged` for the AI tool registry, which
 * describes `list` as returning a list and would otherwise be handed a
 * `{rows, total}` envelope it has no schema for — the same split
 * final_invoice.service.js makes, for the same reason.
 */
const list = async (client, q) => (await repo.list(client, q)).rows;

/**
 * The KPI strip, aggregated over the SAME filter the page used.
 *
 * Its own endpoint rather than a `meta` block, matching cost_tracking: the
 * registry re-pages far more often than the totals change, and a client that
 * wants one should not have to pay for the other.
 */
const kpis = (client, q) => repo.kpis(client, q);

/** The standard charge set for a file, priced. Read-only — see costing.suggest. */
const suggestLines = (client, q = {}) =>
  suggest.build(client, { dossierId: q.dossier_id, tier: q.tier, onDate: q.on_date });

// A cleared approval chain approves+locks the costing (BUILD_CONVENTIONS §2/§5).
onApproved.register("costing", (client, { id, actor }) => setStatus(client, { id, to: "APPROVE", actor: actor || {}, viaChain: true }));

module.exports = {
  createDraft, updateDraft, setStatus, unlockTransition, get,
  list, listPaged, kpis, suggestLines,
};
