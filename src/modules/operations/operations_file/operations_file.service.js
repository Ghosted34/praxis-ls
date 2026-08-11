/**
 * Operations file / dossier (MOD-29, KB §6.7) — the analytical cost object. Every
 * downstream money line tags dossier_id. Numbered ref via numbering.service;
 * lifecycle OPEN→IN_PROGRESS→COMPLETED/CANCELLED. SQL in the repo.
 */
"use strict";
const repo = require("./operations_file.repo");
const events = require("./operations_file.events");
const { canTransition, isTerminal } = require("./operations_file.rules");
const numbering = require("../../../services/documents/numbering.service");
const milestones = require("../milestone/milestone.service");
const geoPlace = require("../geo_place/geo_place.service");
const compliance = require("../../master/compliance/compliance.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");
const { AppError } = require("../../../utils/errors");

/**
 * Seed the dossier's milestone chain from its service type's active template.
 *
 * WHY THIS IS AUTOMATIC (2026-08-01). Instantiating milestones was a separate
 * manual call that, in practice, nobody made: the sandbox seed did it for one
 * dossier in five, and no screen ever wired `POST /milestones/instantiate` at
 * all. The result was dossiers with no chain, an empty 360° Milestones tab, and
 * a Control Tower with nothing to show progress from. A step that reliably
 * doesn't happen shouldn't be a step — the dossier is the centre of gravity and
 * milestones are its spine.
 *
 * BEST-EFFORT, AND DELIBERATELY SO. Called AFTER the dossier's transaction has
 * committed, in its own, and every failure is swallowed with a warning:
 *
 *   - no service_type_id on the dossier        → nothing to template from
 *   - no active template for that service type → instantiate throws 422
 *   - anything else                            → logged, not raised
 *
 * A dossier that exists without milestones is a normal, recoverable state (add
 * the template, instantiate later). A dossier that FAILED TO BE CREATED because
 * its milestones couldn't be seeded is not. Never let the tail wag the dog.
 */
async function seedMilestones(client, dossier, actor) {
  if (!dossier || !dossier.service_type_id) return;
  try {
    await milestones.instantiate(client, {
      dossierId: dossier.dossier_id,
      serviceTypeId: dossier.service_type_id,
      // Offsets run from today, not from the ETA: the template describes a
      // schedule from booking onward, and a dossier is booked when it's created.
      baseDate: null,
      actor,
    });
  } catch (err) {
    logger.warn(
      { dossier: dossier.ref, err },
      "[operations] milestone chain not seeded (dossier created regardless)",
    );
  }
}

/**
 * Turn free-text POL/POD into real geo_place references, at SAVE time.
 *
 * WHY HERE. Resolution used to happen only when the Control Tower map rendered,
 * which was the wrong trigger twice over: a port typed on a dossier nobody
 * looked at on the dashboard was never added to the catalogue at all, and even
 * when it was, nothing went back to link the dossier to the row it had just
 * created — so that dossier kept matching by name forever despite an exact row
 * now existing. Resolving on save fixes both: the port enters the catalogue the
 * first time anyone types it, and the dossier is linked immediately.
 *
 * Only fills a GAP: a dossier that already carries an id (the user picked from
 * the list) is left alone, and so is one with no port text to resolve.
 *
 * BEST-EFFORT, and outside any transaction — resolveMany may call Geoapify over
 * HTTP on a cache miss, and geoapify.service explicitly requires callers not to
 * hold a DB transaction across that wait. A failure leaves the dossier exactly
 * as the user saved it: the text is intact, the map falls back to name matching,
 * and the next save can try again. Never block a save on a geocoder.
 */
async function resolvePlaces(client, dossier) {
  if (!dossier) return dossier;
  const wanted = [];
  if (dossier.pol && !dossier.pol_place_id) wanted.push(dossier.pol);
  if (dossier.pod && !dossier.pod_place_id) wanted.push(dossier.pod);
  if (!wanted.length) return dossier;

  try {
    const found = await geoPlace.resolveMany(client, wanted);
    const patch = {};
    const polHit = dossier.pol ? found.get(dossier.pol) : null;
    const podHit = dossier.pod ? found.get(dossier.pod) : null;
    if (!dossier.pol_place_id && polHit && polHit.geo_place_id) patch.pol_place_id = polHit.geo_place_id;
    if (!dossier.pod_place_id && podHit && podHit.geo_place_id) patch.pod_place_id = podHit.geo_place_id;
    if (!Object.keys(patch).length) return dossier;
    return await repo.update(client, dossier.dossier_id, patch);
  } catch (err) {
    logger.warn(
      { dossier: dossier.ref, err },
      "[operations] port references unresolved (dossier saved regardless)",
    );
    return dossier;
  }
}

async function create(client, { data, actor = {} }) {
  // Transactional compliance gate (§5): a hard-blocked client cannot open a
  // dossier. Softer states (SOFT_BLOCK/ESCALATED) pass so freight keeps moving —
  // the flags surface on the 360 and the override dialog logs the reason.
  if (data.client_id) {
    const gate = await compliance.assertAllowed(client, { kind: "client", partyId: data.client_id, action: "dossier_create" });
    if (!gate.allowed) throw new AppError("COMPLIANCE_BLOCKED", gate.reason || "This client is hard-blocked.", 409, { blockingFlags: gate.blockingFlags });
  }
  await client.query("BEGIN");
  let row;
  try {
    let ref = data.ref || null;
    if (!ref && data.entity_id) {
      const alloc = await numbering.allocate(client, { moduleKey: events.MODULE, entityId: data.entity_id, date: new Date().toISOString().slice(0, 10) });
      ref = alloc.number;
    }
    if (!ref) throw new AppError("REF_REQUIRED", "entity_id is required to allocate a dossier ref", 422);
    row = await repo.insert(client, { ...data, ref, status: "OPEN" });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: "dossier:" + row.dossier_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "dossier:" + row.dossier_id, after: row });
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; }

  // Both of these run outside the transaction above on purpose:
  // milestone.instantiate opens its own BEGIN/COMMIT (nesting would make its
  // COMMIT close ours), and resolvePlaces may wait on an HTTP geocode.
  await seedMilestones(client, row, actor);
  return await resolvePlaces(client, row);
}

async function update(client, { id, patch, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Dossier not found", 404);
  if (isTerminal(before.status)) throw new AppError("LOCKED", "A " + before.status + " dossier cannot be edited", 422);
  const { status, ...fields } = patch;
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: "dossier:" + id, before, after: row });
  // Edits change ports too — retyping POL clears its id client-side, so this is
  // what re-links it. Safe to call unconditionally: it no-ops when both ids are
  // already set, which is the common case.
  return await resolvePlaces(client, row);
}

async function transition(client, { id, to, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Dossier not found", 404);
  if (!canTransition(before.status, to)) throw new AppError("BAD_TRANSITION", "Cannot move dossier from " + before.status + " to " + to, 422);
  const row = await repo.update(client, id, { status: to });
  await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: "dossier:" + id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.statusChange(to), moduleKey: events.MODULE, entityRef: "dossier:" + id, before, after: row });
  return row;
}


const round2 = (n) => Math.round(n * 100) / 100;
const { reconcile } = require("../../costing/costing/costing.rules");

const person = (id, name) => (id ? { user_id: id, name: name || null } : null);

/**
 * 360° view of a dossier: header + downstream rollups, plus derived economics
 * (billed vs planned/actual cost, gross margin, receivable outstanding), the
 * Money breakdown (service HT / débours / TVA / margin / budget-vs-actual), the
 * SoD People (issuer/validator/approver with names) and document rows.
 * Margin keys are named so the `dossier.margin` field-mask catches them
 * (`dossier_margin`, `margin_percent`) — Sales/Ops receive them nulled.
 */
async function overview(client, id) {
  const dossier = await repo.get(client, id);
  if (!dossier) throw new AppError("NOT_FOUND", "Dossier not found", 404);
  const agg = await repo.overview(client, id);
  const billed = Number(agg.invoices.billed_ttc || 0);
  const plannedCost = Number(agg.costing.planned_cost || 0);
  const actualCost = Number(agg.actual.actual_cost || 0);
  const grossMargin = round2(billed - actualCost);
  const marginPercent = billed > 0 ? round2((grossMargin / billed) * 100) : 0;
  const milestones = agg.milestones.reduce((acc, m) => { acc[m.status] = m.n; return acc; }, {});

  // Money breakdown. Revenue side is the LOCKED final invoices (what was actually
  // billed); dossier margin = HT revenue (service + débours, VAT excluded) minus
  // ALL actual direct costs — débours are billed at cost so they net out of the
  // margin when re-invoiced 1:1 (KB §6.7).
  const serviceHt = Number(agg.invoices.billed_service_ht || 0);
  const disbursementBilled = Number(agg.invoices.billed_disbursement || 0);
  const vatTotal = Number(agg.invoices.billed_vat || 0);
  const revenueHt = round2(serviceHt + disbursementBilled);
  const dossierMargin = round2(revenueHt - actualCost);
  const money = {
    service_ht: serviceHt,
    disbursement_total: disbursementBilled,
    vat_total: vatTotal,
    revenue_ht: revenueHt,
    billed_ttc: billed,
    planned_service_cost: Number(agg.costing.planned_service_cost || 0),
    planned_disbursement: Number(agg.costing.planned_disbursement || 0),
    planned_cost: plannedCost,
    actual_cost: actualCost,
    dossier_margin: dossierMargin,
    margin_percent: revenueHt > 0 ? round2((dossierMargin / revenueHt) * 100) : 0,
    budget: reconcile(plannedCost, actualCost),
  };

  const cp = agg.people.costing;
  const ip = agg.people.invoice;
  const people = {
    costing: cp ? { doc_number: cp.doc_number, status: cp.status, validator: person(cp.validator_id, cp.validator_name), approver: person(cp.approver_id, cp.approver_name) } : null,
    invoice: ip ? { doc_number: ip.doc_number, status: ip.status, issuer: person(ip.issuer_id, ip.issuer_name), validator: person(ip.validator_id, ip.validator_name), approver: person(ip.approver_id, ip.approver_name) } : null,
  };

  // Lifecycle readiness (drives the 360° prompt + the dossier.milestones_completed /
  // dossier.fully_collected signals). Derived from live state so the badge is robust
  // even if a signal was missed.
  const msTotal = Object.values(milestones).reduce((a, b) => a + b, 0);
  const milestonesComplete = msTotal > 0 && (milestones.DONE || 0) === msTotal;
  const fullyCollected = billed > 0 && Number(agg.outstanding.outstanding || 0) === 0;
  const readiness = {
    milestones_complete: milestonesComplete,
    fully_collected: fullyCollected,
    ready_to_complete: milestonesComplete && !["COMPLETED", "CANCELLED"].includes(dossier.status),
  };

  return {
    dossier: { dossier_id: dossier.dossier_id, ref: dossier.ref, status: dossier.status, client_id: dossier.client_id, service_type_id: dossier.service_type_id },
    readiness,
    costing: { count: agg.costing.count, planned_cost: plannedCost },
    costs: { actual_cost: actualCost, gl_entries: agg.actual.entries },
    invoicing: { count: agg.invoices.count, invoiced_ttc: Number(agg.invoices.invoiced_ttc || 0), billed_ttc: billed, outstanding: Number(agg.outstanding.outstanding || 0) },
    economics: { billed_ttc: billed, actual_cost: actualCost, gross_margin: grossMargin, margin_percent: marginPercent },
    money,
    people,
    milestones,
    procurement: { po_count: agg.procurement.po_count, po_total: Number(agg.procurement.po_total || 0) },
    documents: { transit_orders: agg.transit.count, delivery_notes: agg.delivery.count },
    document_rows: agg.documentRows,
  };
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
/** One page plus the true match count, for the paged list endpoint. */
const listPaged = (client, q) => repo.listPaged(client, q);
module.exports = { create, update, transition, get, list, listPaged, overview };
