/**
 * Transit order (MOD-30) — the client's written authorisation to declare their
 * cargo, and the instruction sheet the declaration is built from.
 *
 * ── WHAT CHANGED FROM THE LEGACY, AND WHY ───────────────────────────────────
 *
 * The legacy module (`api/operation/transit_order/create.php`, plus a 1031-line
 * print screen) did exactly one thing: INSERT a row, allocate a number, print.
 * Four defects came with that shape, and the design below is a response to each
 * rather than a reorganisation for its own sake.
 *
 * 1. THE NUMBER WAS BURNED ON PAGE LOAD. `transit-order.php` renders
 *    `$nextOtNumber` into the form before anyone types, and `create.php`
 *    re-derives it with `MAX(ot_number_sequence) + 1`. Abandon the form and the
 *    sequence has a hole; two operators open it at once and both print the same
 *    number until whoever saves second is silently renumbered. Here a number is
 *    allocated in `issue()`, inside the transaction that commits the issue, via
 *    the tenant numbering service whose UPSERT…RETURNING serialises allocation.
 *    A draft costs nothing.
 *
 * 2. NOTHING RECORDED THE SIGNATURE. The whole instrument exists to be signed
 *    and stamped by the client, and the legacy row had no column for it. So an
 *    order was authorised in exactly the same sense whether the client had
 *    agreed or not. `sign()` takes the scan, and `lodge()` refuses without it.
 *
 * 3. SHIPMENT FACTS WERE COPIED, NOT REFERENCED — twice over. `get_file.php`
 *    read fifteen columns off the file to populate read-only boxes, and the
 *    print template re-derived vessel/route/reference with its own JavaScript
 *    (`smartTransportRef`, `smartConveyance`, `smartRoute`) — a third copy of
 *    logic that already existed twice in PHP. None of it was stored, so a
 *    reprint two weeks later silently showed different facts than the copy the
 *    client signed. Here the facts come from the shipment-details projection
 *    (0660) and are FROZEN onto the order at issue (0661), so the reprint
 *    matches the signature.
 *
 * 4. IT WAS DETACHED FROM THE FILE'S TIMELINE. Creating an order told the
 *    milestone engine nothing. `transit_order.created` is already wired to the
 *    T1_LODGED stage in the seeded chains; this emits the lifecycle events so
 *    the file's timeline moves when the order actually moves.
 *
 * All SQL is in the repo; all lifecycle and arithmetic decisions are in rules.
 */
"use strict";

const repo = require("./transit_order.repo");
const events = require("./transit_order.events");
const rules = require("./transit_order.rules");
// Shared with the delivery note: both are documents derived from the same file,
// and two copies of "which dossier column feeds which document field" would
// drift the first time a column was added.
const prefillShared = require("../_shared/dossier-prefill");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const shipmentDetails = require("../shipment_details/shipment_details.service");
const currency = require("../../master/currency/currency.service");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const ref = (id) => "transit_order:" + id;
const today = () => new Date().toISOString().slice(0, 10);

/* ── declared-value FX ────────────────────────────────────────────────────── */

/**
 * The rate that expresses a declared value in XAF — the duty base.
 *
 * 10692 stored it as a hand-typed number; that is the wrong input for a rate
 * the tenant already maintains in the currency master (MOD-08, `fx_rate_daily`,
 * fed by the live exchangerate-api sync). So it is now DERIVED, never accepted
 * from the caller: the currency master's base→quote rows are the single source
 * of truth, a manual override still wins via the resolver, and `1` is the
 * identity for XAF itself.
 *
 * The stored rows are base→quote (1 base = rate quote). The order needs the
 * inverse direction (XAF per declared-currency unit), so when no direct
 * code→XAF row exists the base XAF→code row is inverted.
 *
 * @returns {{ rate: number, source: string, as_of_date: string } | null}
 *          null when the currency has no rate yet (caller falls back to 1, and
 *          the form's currencies endpoint surfaces the gap).
 */
async function fxToXaf(client, code) {
  const c = String(code || "XAF").toUpperCase();
  if (c === "XAF") return { rate: 1, source: "identity", as_of_date: today() };
  try {
    const direct = await currency.rateFor(client, { base: c, quote: "XAF", date: today() });
    return { rate: Number(direct.rate), source: direct.source, as_of_date: direct.as_of_date };
  } catch {
    try {
      const inverse = await currency.rateFor(client, { base: "XAF", quote: c, date: today() });
      return {
        rate: Math.round((1 / Number(inverse.rate)) * 1e8) / 1e8,
        source: inverse.source,
        as_of_date: inverse.as_of_date,
      };
    } catch {
      return null;
    }
  }
}

/**
 * The currencies the form offers, with their live rate to XAF attached — one
 * call, so the picker and its derived-rate field can never disagree about the
 * vocabulary or the number. Reads the same active set as the currency master
 * (MOD-08), but is served under MOD-30 so the transit-order screen works even
 * when the finance.fx feature is off for a tenant.
 */
async function currenciesForOrder(client) {
  const rows = await currency.listCurrencies(client);
  const out = [];
  for (const c of rows) {
    const fx = await fxToXaf(client, c.code);
    out.push({
      code: c.code,
      name: c.name,
      symbol: c.symbol || null,
      is_base: c.is_base === true,
      rate_to_xaf: fx ? fx.rate : null,
      rate_source: fx ? fx.source : null,
      rate_as_of_date: fx ? fx.as_of_date : null,
    });
  }
  return out;
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

/**
 * One order, with its lines, its computed value reconciliation, and the
 * shipment facts — frozen if the order has been issued, live if it is a draft.
 *
 * WHY THE FALLBACK IS THIS WAY ROUND. A draft has no snapshot, and showing it
 * the live projection is right: it is still being prepared and should reflect
 * whatever ops last learned about the file. An issued order has a snapshot and
 * must show that, because it is what the client signed. Which one was used is
 * reported in `shipment_details_source` rather than left for the reader to
 * infer — a document that cannot tell you whether it is current or historic is
 * how the legacy reprint problem went unnoticed for years.
 */
async function get(client, id, { lang = "en" } = {}) {
  const to = await repo.getFull(client, id);
  if (!to) return null;
  const lines = await repo.listLines(client, id);

  let details = to.shipment_details_snapshot || null;
  let source = details ? "SNAPSHOT" : null;
  if (!details && to.dossier_id) {
    try {
      details = await shipmentDetails.forDossier(client, to.dossier_id, { lang });
      source = "LIVE";
    } catch (err) {
      // A file whose service type lost its field set must not make the order
      // unreadable — same forgiving-read rule shipment_details itself follows.
      logger.warn({ err, transit_order_id: id }, "[transit_order] shipment details unavailable");
      details = null;
    }
  }

  return {
    ...to,
    lines,
    totals: rules.computeValues(to, lines),
    shipment_details: details,
    shipment_details_source: source,
    // What the UI may offer, decided by the same table the service enforces —
    // so a button can never exist for a transition the API would refuse.
    allowed_transitions: rules.NEXT[to.status] || [],
    issue_blockers: to.status === "DRAFT" ? rules.issueBlockers(to) : [],
  };
}

/**
 * A create body, prefilled from the file the order is for.
 *
 * The dialog already SHOWS the operator the file's regime, commodity, weight,
 * packages and marks in a read-only panel, then asks them to type the same
 * things in again underneath. That gap is where a transit order comes to
 * disagree with the file it was raised from — and the document that disagrees is
 * the one lodged with customs.
 *
 * Returns `{ body, inferred, from }`: `body` is shaped exactly like the create
 * payload so the form can spread it, `from` names what was copied, and
 * `inferred` names the one value that was DERIVED rather than read (the
 * direction, from the regime prefix) so the UI can mark it as a suggestion.
 * Nothing here is binding — every field stays editable.
 */
const prefill = async (client, { dossier_id }) => {
  const d = await repo.dossierForPrefill(client, dossier_id);
  if (!d) throw new AppError("NOT_FOUND", "Operations file not found", 404);
  // The entity's money defaults ride on the same row from the join.
  return prefillShared.transitOrderFrom(d, { default_currency: d.default_currency }, rules.CUSTOMS_REGIMES);
};

const list = (client, q) => repo.listTO(client, q);
const summary = (client, q) => repo.statusCounts(client, q);

/** The checklist vocabulary, served so the form is never a hard-coded copy. */
const docTypes = () => rules.SUBMITTED_DOC_TYPES;

/* ── lines ─────────────────────────────────────────────────────────────────── */

/**
 * Replace the cargo lines wholesale.
 *
 * G23: the previous implementation did `if (!l || !l.inventory_item_id)
 * continue;` — skipping every line that was not a catalogue item. The validator
 * marked `inventory_item_id` OPTIONAL and `label` free text, and
 * `transit_order_line` declares `label NOT NULL` and got its
 * `inventory_item_id` column only in 0477. So the commonest possible payload —
 * `{ label: "30 sacs ciment", packages: 30 }`, which is exactly what a
 * forwarding order carries and what the legacy print view produced — returned
 * 201 with an allocated number, a captured document, and ZERO LINES. No error.
 *
 * A blank label is now rejected by name instead of dropped, which is the actual
 * fix: the failure mode was silence, not strictness.
 */
async function replaceLines(client, transitOrderId, lines) {
  await repo.deleteLines(client, transitOrderId);
  const out = [];
  for (let i = 0; i < (lines || []).length; i += 1) {
    const l = lines[i] || {};
    const label = String(l.label || "").trim();
    if (!label) {
      throw new AppError("VALIDATION_ERROR", `Cargo line ${i + 1} has no description`, 422, {
        lines: [`line ${i + 1}: a description is required`],
      });
    }
    const row = await repo.insertLine(client, {
      transit_order_id: transitOrderId,
      inventory_item_id: l.inventory_item_id || null,
      label,
      marks: l.marks || null,
      hs_code: l.hs_code || null,
      packages: Number(l.packages) || 1,
      weight: l.weight || null,
      value_amount: l.value_amount === null || l.value_amount === undefined ? null : Number(l.value_amount),
      line_no: i + 1,
    });
    out.push(row);
  }
  return out;
}

/* ── writes ────────────────────────────────────────────────────────────────── */

/**
 * Create a DRAFT. No number, no captured document — both of those are what
 * `issue()` is for.
 *
 * The entity falls back to the dossier's own when the caller does not name one.
 * The legacy system was single-entity so the question never arose; here an
 * order printed on the wrong letterhead is a real error, and the file already
 * knows the answer.
 *
 * DUPLICATE GUARD. A dossier with a live order already is the overwhelmingly
 * common way a second one gets raised by mistake (two ops on the same file). It
 * is not forbidden — consolidations legitimately need several — but it is
 * reported unless the caller says `allow_duplicate`, because an accidental
 * second order means a second number quoted to customs.
 */
async function create(client, {
  entityId = null, dossierId = null, customsRegime = null, customsRegimeOther = null,
  serviceDirection = null, declaredValue = null, declaredCurrency = "XAF",
  insuranceType = "CLIENT", surveyorParty = "CLIENT", departureDate = null, instructions = null,
  submittedDocs = [], lines = [], allowDuplicate = false, actor = {},
} = {}) {
  let entity = entityId;
  let brief = null;
  if (dossierId) {
    brief = await repo.dossierBrief(client, dossierId);
    if (!brief) throw new AppError("NOT_FOUND", "Operations file not found", 404);
    if (!entity) entity = brief.entity_id;
    if (!allowDuplicate) {
      const live = await repo.liveForDossier(client, dossierId);
      if (live.length) {
        throw new AppError(
          "DUPLICATE_ORDER",
          `File ${brief.ref} already has a transit order (${live.map((o) => o.ot_number || "draft").join(", ")}). Re-send that one, or pass allow_duplicate to raise a second.`,
          409,
          { existing: live },
        );
      }
    }
    // The file's own regime is the default — retyping a value the file already
    // holds is how the two come to disagree.
    if (!customsRegime && !customsRegimeOther && brief.customs_regime
        && rules.CUSTOMS_REGIMES.includes(brief.customs_regime)) {
      customsRegime = brief.customs_regime;
    }
  }

  const docs = rules.normaliseDocs(submittedDocs);
  const declaredCurrencyCode = (declaredCurrency || "XAF").toUpperCase();
  // Derived, never trusted from the caller — the rate is the currency master's
  // business, and a hand-typed figure is how two copies of "the rate" drift.
  const fx = await fxToXaf(client, declaredCurrencyCode);

  await client.query("BEGIN");
  try {
    const to = await repo.insertTO(client, {
      entity_id: entity,
      dossier_id: dossierId,
      status: "DRAFT",
      ot_number: null,
      customs_regime: customsRegime,
      customs_regime_other: customsRegime ? null : customsRegimeOther,
      service_direction: serviceDirection,
      declared_value: declaredValue,
      declared_currency: declaredCurrencyCode,
      declared_fx_to_xaf: fx ? fx.rate : 1,
      insurance_type: insuranceType,
      surveyor_party: surveyorParty,
      departure_date: departureDate,
      instructions,
      submitted_docs: JSON.stringify(docs),
      // Same FK guard as `issued_by` below — see DATA 2.4.
      created_by: await resolveActorId(client, actor.user_id),
    });
    await replaceLines(client, to.transit_order_id, lines);
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE,
      entityRef: ref(to.transit_order_id), after: to,
    });
    await client.query("COMMIT");
    return get(client, to.transit_order_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Patch a draft (or the three still-mutable fields of an issued order). */
async function update(client, { id, patch = {}, lines = null, actor = {} }) {
  const before = await repo.getTO(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Transit order not found", 404);
  rules.assertEditable(before, patch);
  if (lines && !rules.EDITABLE.has(before.status)) {
    throw new AppError("LOCKED", `Cargo lines cannot change on a ${before.status} transit order.`, 422);
  }

  const fields = {};
  const copy = [
    "entity_id", "dossier_id", "customs_regime", "customs_regime_other", "service_direction",
    "declared_value", "declared_currency", "insurance_type",
    "surveyor_party", "departure_date", "instructions",
  ];
  for (const k of copy) if (patch[k] !== undefined) fields[k] = patch[k];
  // The regime is stated one way or the other, never both (chk_..._regime_stated).
  if (fields.customs_regime) fields.customs_regime_other = null;
  if (fields.customs_regime_other) fields.customs_regime = null;
  // The FX rate is derived from the currency master, never taken from the patch.
  if (patch.declared_currency !== undefined) {
    const fx = await fxToXaf(client, fields.declared_currency || "XAF");
    fields.declared_fx_to_xaf = fx ? fx.rate : 1;
  }
  if (patch.submitted_docs !== undefined) {
    fields.submitted_docs = JSON.stringify(rules.normaliseDocs(patch.submitted_docs));
  }

  await client.query("BEGIN");
  try {
    const after = Object.keys(fields).length ? await repo.update(client, id, fields) : before;
    if (lines) await replaceLines(client, id, lines);
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE,
      entityRef: ref(id), before, after,
    });
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Kept as its own entry point because the AI action and the print screen both
 * want "tick these boxes" without touching anything else, and because the old
 * `PATCH /:id` did exactly this and callers exist.
 */
async function updateDocs(client, { transitOrderId, submittedDocs, actor = {} }) {
  return update(client, { id: transitOrderId, patch: { submitted_docs: submittedDocs }, actor });
}

/**
 * DRAFT → ISSUED. Allocates the number, freezes the shipment facts, captures
 * the document, and tells the file's timeline.
 *
 * Order matters inside the transaction: completeness is asserted BEFORE a
 * number is allocated, so a failed issue never burns one.
 */
async function issue(client, { id, date = null, actor = {} }) {
  const before = await repo.getTO(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Transit order not found", 404);
  rules.assertTransition(before.status, "ISSUED");
  rules.assertCanIssue(before);

  await client.query("BEGIN");
  try {
    const { number } = await numbering.allocate(client, {
      moduleKey: events.MODULE, entityId: before.entity_id, date: date || today(),
    });
    const after = await repo.update(client, id, {
      status: "ISSUED", ot_number: number, issued_at: new Date().toISOString(),
      // DATA 2.4 — `issued_by` is REFERENCES app_user(user_id), and identity is
      // pinned to the LIVE schema while this write may land in SANDBOX. A raw
      // live user id there raises 23503 and takes the whole issue with it, so
      // the id is resolved against the schema being written to (or nulled).
      issued_by: await resolveActorId(client, actor.user_id),
    });
    // 0661 — what this order says about the shipment is now what it said when
    // the client was asked to sign it, whatever the file does next.
    if (before.dossier_id) {
      await shipmentDetails.snapshotOnto(client, {
        table: "transit_order", id, dossierId: before.dossier_id,
      });
    }
    await documents.capture(client, { entityRef: ref(id), docType: "TRANSIT_ORDER", status: "VERIFIED" });
    await emitEvent(client, {
      eventTypeKey: events.ISSUED, moduleKey: events.MODULE, entityRef: ref(id),
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.ISSUED, moduleKey: events.MODULE,
      entityRef: ref(id), before, after,
    });
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** ISSUED → SIGNED. The scan is the point; a status without one proves nothing. */
async function sign(client, { id, signatureVaultId = null, signedByName = null, signedAt = null, actor = {} }) {
  const before = await repo.getTO(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Transit order not found", 404);
  rules.assertTransition(before.status, "SIGNED");
  if (!signatureVaultId && !before.signature_vault_id) {
    throw new AppError("NO_SIGNED_COPY", "Attach the client-signed copy to mark this order signed.", 422);
  }

  await client.query("BEGIN");
  try {
    const after = await repo.update(client, id, {
      status: "SIGNED",
      signature_vault_id: signatureVaultId || before.signature_vault_id,
      signed_by_name: signedByName || before.signed_by_name,
      signed_at: signedAt || new Date().toISOString(),
    });
    await emitEvent(client, {
      eventTypeKey: events.SIGNED, moduleKey: events.MODULE, entityRef: ref(id),
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.SIGNED, moduleKey: events.MODULE,
      entityRef: ref(id), before, after,
    });
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** SIGNED → LODGED, carrying the declaration reference the chain reports on. */
async function lodge(client, { id, declarationRef = null, lodgedAt = null, actor = {} }) {
  const before = await repo.getTO(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Transit order not found", 404);
  rules.assertTransition(before.status, "LODGED");
  rules.assertCanLodge(before);
  if (!declarationRef) {
    throw new AppError("VALIDATION_ERROR", "The customs declaration reference is required to record a lodging.", 422, {
      declaration_ref: ["required"],
    });
  }

  await client.query("BEGIN");
  try {
    const after = await repo.update(client, id, {
      status: "LODGED", declaration_ref: declarationRef, lodged_at: lodgedAt || new Date().toISOString(),
    });
    await emitEvent(client, {
      eventTypeKey: events.LODGED, moduleKey: events.MODULE, entityRef: ref(id),
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.LODGED, moduleKey: events.MODULE,
      entityRef: ref(id), before, after,
    });
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Cancel. A numbered order KEEPS its number — a customs sequence with a reused
 * number is worse than one with a documented gap, and the reason is recorded so
 * the gap explains itself.
 */
async function cancel(client, { id, reason = null, actor = {} }) {
  const before = await repo.getTO(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Transit order not found", 404);
  rules.assertTransition(before.status, "CANCELLED");
  if (!reason) {
    throw new AppError("VALIDATION_ERROR", "A cancellation reason is required.", 422, { reason: ["required"] });
  }

  await client.query("BEGIN");
  try {
    const after = await repo.update(client, id, {
      status: "CANCELLED", cancelled_at: new Date().toISOString(), cancel_reason: reason,
    });
    await emitEvent(client, {
      eventTypeKey: events.CANCELLED, moduleKey: events.MODULE, entityRef: ref(id),
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.CANCELLED, moduleKey: events.MODULE,
      entityRef: ref(id), before, after,
    });
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** One entry point for the generic `POST /:id/transition` shape. */
const TRANSITIONS = {
  ISSUED: (client, p) => issue(client, p),
  SIGNED: (client, p) => sign(client, p),
  LODGED: (client, p) => lodge(client, p),
  CANCELLED: (client, p) => cancel(client, p),
};
async function transition(client, { id, to, actor = {}, ...rest }) {
  // `to` is caller-supplied, so look it up as own-property only. A plain object
  // literal still inherits from Object.prototype, and `TRANSITIONS.constructor`
  // (or toString/valueOf/hasOwnProperty) would sail past a truthiness check and
  // then be invoked. The HTTP validator pins `to` to an enum, but this service
  // is exported and must not depend on every caller doing that for it.
  const fn = Object.hasOwn(TRANSITIONS, to) ? TRANSITIONS[to] : null;
  if (typeof fn !== "function") {
    throw new AppError("BAD_STATE", `"${to}" is not a transit-order state that can be moved to.`, 422);
  }
  return fn(client, { id, actor, ...rest });
}

module.exports = {
  create, update, updateDocs, issue, sign, lodge, cancel, transition,
  get, list, summary, docTypes, currencies: currenciesForOrder, prefill,
};
