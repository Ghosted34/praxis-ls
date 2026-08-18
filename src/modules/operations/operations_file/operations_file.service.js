/**
 * Operations file / dossier (MOD-29, KB §6.7) — the analytical cost object. Every
 * downstream money line tags dossier_id. Numbered ref via numbering.service;
 * lifecycle OPEN→IN_PROGRESS→COMPLETED/CANCELLED. SQL in the repo.
 */
"use strict";
const crypto = require("crypto");
const repo = require("./operations_file.repo");
const events = require("./operations_file.events");
const { canTransition, isTerminal } = require("./operations_file.rules");
const numbering = require("../../../services/documents/numbering.service");
const milestones = require("../milestone/milestone.service");
const geoPlace = require("../geo_place/geo_place.service");
const details = require("../shipment_details/shipment_details.service");
const itinerary = require("../itinerary/itinerary.service");
const compliance = require("../../master/compliance/compliance.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");
const { AppError } = require("../../../utils/errors");
const { atomically } = require("../../../shared/db/tx");

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
/**
 * Instantiate the service type's default itinerary on a newly opened file.
 *
 * BEST-EFFORT, like the milestone chain beside it: a file must open even if its
 * service type has no template, or the template is malformed, or 0673's column is
 * missing on this tenant. The itinerary is editable afterwards from the file, so
 * a failure here costs a default, not the work.
 *
 * The legs go through `itinerary.replace`, which validates them — so a template
 * naming a place that is not in the catalogue is refused rather than seeding a
 * route nobody can plot. `legsFromTemplate` only ever puts the file's own
 * (already verified) POL/POD on the main carriage, so the normal path is clean.
 */
async function seedItinerary(client, dossier) {
  if (!dossier || !dossier.service_type_id) return;
  try {
    const { rows } = await client.query(
      "SELECT st.itinerary_template FROM dossier d " +
        "JOIN service_type st ON st.service_type_id = d.service_type_id WHERE d.dossier_id = $1",
      [dossier.dossier_id],
    );
    const legs = itinerary.legsFromTemplate(rows[0] && rows[0].itinerary_template, dossier);
    if (legs.length) await itinerary.replace(client, dossier.dossier_id, legs);
  } catch (err) {
    logger.warn({ err, dossier: dossier.ref }, "[operations] itinerary defaults not seeded");
  }
}

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

/**
 * Fold the service type's shipment-detail values into a dossier write.
 *
 * `data.details` arrives keyed by FIELD KEY, as the form renders it. The
 * shipment-details service turns that into a real write: the fields bound to a
 * dossier column become column values, the rest become `details_json`, every
 * one is validated against its definition, and the version of the form used is
 * pinned onto the file.
 *
 * WHY THIS IS THE ONLY PATH. `details_json` is a jsonb column, so anything that
 * wrote it directly could put anything in it — and then the panel, the
 * documents and the completeness figure would all be reading values nothing had
 * checked. Routing every write through one place is what makes the field
 * definitions a contract rather than a suggestion.
 *
 * `enforceRequired` is true on CREATE only. That is the product rule: a file
 * opens on the day the booking lands, when the BL number and the ETA genuinely
 * are not known — so only the fields the service-type owner marked required are
 * demanded, and only at the moment the file is opened. Afterwards a value can be
 * cleared and corrected without the save being refused; completeness reports it.
 */
async function foldDetails(client, { data, existing = null, enforceRequired }) {
  const { details: values, ...rest } = data;
  const serviceTypeId = rest.service_type_id || (existing && existing.service_type_id);
  // Nothing to fold and no form to enforce: leave the write exactly as it was,
  // so every caller that predates the SSDC keeps working untouched.
  if (values === undefined && !enforceRequired) return rest;
  const { patch } = await details.applyValues(client, {
    serviceTypeId,
    // On update the file keeps the version it was created under — republishing
    // a form must not retroactively change what an open file is validated
    // against. On create there is no pinned version yet, so the live one is used.
    fieldSetId: existing ? existing.service_type_field_set_id : null,
    values: values || {},
    existingDetails: existing ? existing.details_json || {} : {},
    enforceRequired,
  });
  // The explicit `rest` wins over the folded patch: a caller that set `pol`
  // directly (the AI path, the sales→operations handoff) is not overridden by
  // an absent detail value.
  return { ...patch, ...rest };
}

/**
 * Open a DRAFT — the creation wizard's first step.
 *
 * WHY IT EXISTS AT ALL. A document can only be attached to a file that exists:
 * the vault's rows carry `dossier_id`. Legacy had the same constraint and
 * answered it by refusing uploads until after save, which is why in practice
 * nothing is ever attached at creation. A draft makes the upload ordinary.
 *
 * NO REF IS BURNED. Our refs are sequential and people reconcile against them,
 * so an abandoned draft must not leave a gap. The placeholder is unique by
 * construction and unmistakable; `promote` swaps it for the real one.
 *
 * NO MILESTONES, NO EVENT. `dossier.created` is what instantiates the milestone
 * chain and what the orchestration layer listens to — firing it here would
 * schedule work against a file that may never open. Promotion is the birth.
 *
 * REQUIRED FIELDS ARE NOT ENFORCED YET, deliberately: the whole point of the
 * wizard's second step is that they are filled in after this call. Promotion is
 * where the service type's `is_required` fields are demanded.
 */
async function createDraft(client, { data, actor = {} }) {
  if (data.client_id) {
    const gate = await compliance.assertAllowed(client, { kind: "client", partyId: data.client_id, action: "dossier_create" });
    if (!gate.allowed) throw new AppError("COMPLIANCE_BLOCKED", gate.reason || "This client is hard-blocked.", 409, { blockingFlags: gate.blockingFlags });
  }
  const write = await foldDetails(client, { data, enforceRequired: false });
  await client.query("BEGIN");
  try {
    const row = await repo.insert(client, {
      ...write,
      ref: "DRAFT-" + crypto.randomUUID(),
      status: "DRAFT",
      draft_started_at: new Date().toISOString(),
    });
    await audit(client, { actorUserId: actor.user_id || null, action: "dossier.draft_started", moduleKey: events.MODULE, entityRef: "dossier:" + row.dossier_id, after: { dossier_id: row.dossier_id } });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * DRAFT → OPEN. This is where a draft becomes a file.
 *
 * Everything `create` does at once, done here instead: the ref is allocated,
 * the service type's required fields are enforced, `dossier.created` fires, and
 * the milestone chain is instantiated. A caller that never reaches this point
 * has left no file behind and nothing scheduled against one.
 */
async function promote(client, { id, data = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Dossier not found", 404);
  if (before.status !== "DRAFT") throw new AppError("NOT_A_DRAFT", "This file has already been opened", 422);

  // Enforced HERE, not at draft creation: the wizard's whole shape is that the
  // details arrive after the file exists.
  const write = await foldDetails(client, { data, existing: before, enforceRequired: true });

  await client.query("BEGIN");
  let row;
  try {
    const entityId = write.entity_id || before.entity_id;
    if (!entityId) throw new AppError("REF_REQUIRED", "entity_id is required to allocate a dossier ref", 422);
    // The allocator owns generate → write → retry as one step, so the reference
    // and the promoted row commit together and the unique index on `dossier.ref`
    // stays the thing that decides a collision. See operation-reference.js.
    const alloc = await numbering.allocateOperationReference(client, {
      entityId,
      serviceTypeId: write.service_type_id || before.service_type_id || null,
      write: (ref) => repo.update(client, id, { ...write, ref, status: "OPEN" }),
    });
    row = alloc.row;
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: "dossier:" + id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "dossier:" + id, before, after: row });
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; }

  // Outside the transaction for the same reasons `create` does it — milestone
  // instantiation opens its own, and geocoding may wait on HTTP.
  await seedMilestones(client, row, actor);
  await seedItinerary(client, row);
  return await resolvePlaces(client, row);
}

/**
 * Delete abandoned drafts.
 *
 * A draft nobody finished is litter, not history: it has no ref anybody has
 * seen, no milestones, and no downstream rows to orphan. Container lines
 * cascade. Vault rows do NOT — they own bytes in storage — so they are removed
 * explicitly and their objects deleted, which is the whole reason this is a
 * function and not a one-line DELETE.
 *
 * Drafts that acquired documents are kept regardless of age: somebody uploaded
 * a bill of lading against that file, and throwing it away because they did not
 * finish the form the same afternoon is the wrong trade.
 */
async function sweepDrafts(client, { olderThanHours = 48, storage = null } = {}) {
  const { rows } = await client.query(
    `SELECT d.dossier_id FROM dossier d
      WHERE d.status = 'DRAFT'
        AND d.draft_started_at < now() - ($1 || ' hours')::interval
        AND NOT EXISTS (SELECT 1 FROM document_vault v WHERE v.dossier_id = d.dossier_id)`,
    [String(olderThanHours)],
  );
  let deleted = 0;
  for (const { dossier_id: dossierId } of rows) {
    await client.query("BEGIN");
    try {
      await client.query("DELETE FROM dossier_container_line WHERE dossier_id = $1", [dossierId]);
      await client.query("DELETE FROM dossier WHERE dossier_id = $1 AND status = 'DRAFT'", [dossierId]);
      await client.query("COMMIT");
      deleted += 1;
    } catch (err) {
      await client.query("ROLLBACK");
      logger.warn({ err, dossierId }, "draft sweep: could not delete abandoned draft");
    }
  }
  if (storage) logger.info({ deleted }, "draft sweep complete");
  return { deleted, considered: rows.length };
}

async function insertForCreate(client, { data, actor = {} }) {
  // This is deliberately boundary-free: callers such as opportunity.win own a
  // larger transaction that must commit the dossier link and the opportunity
  // transition together. It also performs no post-commit initialization.
  if (data.client_id) {
    const gate = await compliance.assertAllowed(client, { kind: "client", partyId: data.client_id, action: "dossier_create" });
    if (!gate.allowed) throw new AppError("COMPLIANCE_BLOCKED", gate.reason || "This client is hard-blocked.", 409, { blockingFlags: gate.blockingFlags });
  }
  const write = await foldDetails(client, { data, enforceRequired: true });
  if (!write.entity_id) throw new AppError("REF_REQUIRED", "entity_id is required to allocate a dossier ref", 422);

  const fields = { ...write };
  delete fields.ref;
  const alloc = await numbering.allocateOperationReference(client, {
    entityId: fields.entity_id,
    serviceTypeId: fields.service_type_id || null,
    write: (ref) => repo.insert(client, { ...fields, ref, status: "OPEN" }),
  });
  const row = alloc.row;
  await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: "dossier:" + row.dossier_id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: "dossier:" + row.dossier_id, after: row });
  return row;
}

async function initializeCreated(client, { dossier, actor = {} }) {
  // Never call while a business transaction is open. Milestone instantiation
  // owns its transaction and place resolution may wait on a geocoder.
  await seedMilestones(client, dossier, actor);
  await seedItinerary(client, dossier);
  return resolvePlaces(client, dossier);
}

async function create(client, { data, actor = {} }) {
  const row = await atomically(client, () => insertForCreate(client, { data, actor }));
  return initializeCreated(client, { dossier: row, actor });
}

/** The two dates the milestone chain is scheduled against, in the order
 *  `milestone.resolveTarget` consults them. */
const TARGET_DATES = ["promised_delivery_date", "eta"];

const sameDay = (a, b) => {
  const iso = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
  return iso(a) === iso(b);
};

/**
 * Re-baseline the chain when the date it is scheduled against moves.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 *
 * `recalculate` ran on ADVANCE, REOPEN and INSERT, and from a manual button. Its
 * validator has accepted a `TARGET_CHANGED` trigger since the weighted engine
 * shipped — and NOTHING EVER SENT ONE. So setting or correcting the promised
 * delivery date left every downstream stage sitting on dates computed from the
 * old target, and the only way to make the chain agree with the file was for
 * somebody to notice and press Recalculate.
 *
 * That is the difference between a date the engine reads once at creation and a
 * date the engine is scheduled against. The second is what was asked for, and it
 * is what `is_target_lock` needs to mean anything: the lock compresses the
 * remaining stages toward the committed date, and it cannot do that against a
 * date it was never told about.
 *
 * ── BEST-EFFORT, LIKE THE SEEDING BESIDE IT ─────────────────────────────────
 *
 * A file whose ETA was just corrected must save. A chain that could not be
 * re-planned is recoverable — the dates are stale until the next advance or a
 * press of Recalculate — whereas a rejected save loses the correction the
 * operator just made. Logged with the dossier ref so a persistent failure is
 * findable rather than silent.
 */
async function rescheduleOnTargetChange(client, { before, after, actor }) {
  const moved = TARGET_DATES.filter((k) => !sameDay(before[k], after[k]));
  if (!moved.length) return;
  try {
    await milestones.recalculate(client, {
      dossierId: after.dossier_id,
      trigger: "TARGET_CHANGED",
      actor,
    });
  } catch (err) {
    logger.warn(
      { err, dossier: after.ref, moved },
      "[operations] milestone chain not re-planned after a target-date change",
    );
  }
}

/**
 * A file's reference is fixed at the moment it opens.
 *
 * It has been printed on a transit order, quoted in an email and typed into a
 * client's own system by then, so changing it does not rename the file — it
 * creates a second name for it that only we know about. That holds however the
 * file changes afterwards: a different service type, a different entity, a
 * status transition, a correction to every other field. None of them touch it.
 *
 * REJECTED RATHER THAN STRIPPED, so a caller trying to set one finds out. An
 * echo of the value the file already has is allowed through: a client that
 * PATCHes back the object it read is not attempting a rename, and failing that
 * would punish the commonest shape of update in the system.
 *
 * The REST validator never accepted `ref` in the first place (`update` is
 * `create.partial()`, and `create` has no such field). This guard is for the
 * in-process callers — the AI action registry, the orchestration handlers —
 * which reach `service.update` directly with no zod anywhere near them.
 */
function assertReferenceUnchanged(before, patch) {
  if (!Object.prototype.hasOwnProperty.call(patch, "ref")) return;
  if (patch.ref === before.ref) return;
  throw new AppError(
    "REF_IMMUTABLE",
    "An operation file's reference is permanent and cannot be changed",
    422,
    { ref: ["already allocated as " + before.ref] },
  );
}

async function update(client, { id, patch, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Dossier not found", 404);
  if (isTerminal(before.status)) throw new AppError("LOCKED", "A " + before.status + " dossier cannot be edited", 422);
  assertReferenceUnchanged(before, patch);
  const { status, ...rest } = patch;
  // An echo of the file's own reference got this far (see above); it is dropped
  // rather than rewritten, so `ref` never appears in an UPDATE statement.
  delete rest.ref;
  const fields = await foldDetails(client, { data: rest, existing: before, enforceRequired: false });
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: "dossier:" + id, before, after: row });
  // The whole chain re-plans when the date it is scheduled against moves. Compared
  // by DAY, not by value: these are `date` columns that arrive as strings from a
  // form and as Date objects from pg, and a re-plan on every unrelated save would
  // rewrite planned dates — and log a rebaseline row — for nothing.
  await rescheduleOnTargetChange(client, { before, after: row, actor });
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
/** The file's vault documents, for screens that must show what is attached. */
const listDocuments = (client, id) => repo.vaultDocuments(client, id);
module.exports = {
  create, update, transition, get, list, listPaged, overview, listDocuments,
  // The creation wizard's lifecycle: open a draft, fill it in, promote it.
  // `create` stays for every caller that opens a file in one shot — the AI
  // path, the sales→operations handoff, imports.
  createDraft, promote, sweepDrafts,
  // Boundary-free insertion for a wider business transaction, followed by an
  // explicit post-commit initializer.
  insertForCreate, initializeCreated,
};
