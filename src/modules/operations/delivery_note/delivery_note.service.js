/**
 * Delivery note (MOD-32) — proof of delivery on a dossier.
 *
 * The document the client signs at the gate. Numbered at ISSUE, captured to the
 * vault, and — unlike the legacy bordereau — able to record what was written in
 * the "Received By" box, which is the only thing that makes it evidence.
 *
 * All SQL is in the repo; all lifecycle decisions are in the rules.
 */
"use strict";

const repo = require("./delivery_note.repo");
const rules = require("./delivery_note.rules");
const events = require("./delivery_note.events");
// Shared with the transit order — one mapping of "which dossier column feeds
// which document field", so the two cannot drift when a column is added.
const prefillShared = require("../_shared/dossier-prefill");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const shipmentDetails = require("../shipment_details/shipment_details.service");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "delivery_note:" + id;

/* ── helpers ────────────────────────────────────────────────────────────── */

/**
 * G23 — a line IS its label.
 *
 * The old code was `if (!l.inventory_item_id) continue`, so a line the operator
 * typed by hand vanished between the form and the note: 201 Created, document
 * printed, cargo missing. Silently shortening a proof-of-delivery is the worst
 * available failure mode — invisible until the dispute months later.
 *
 * So: insert on `label`, and REFUSE a line that has neither a label nor a stock
 * item rather than skipping it. The index is 1-based so the message names the
 * row the operator is looking at.
 */
async function replaceLines(client, id, lines) {
  await repo.deleteLines(client, id);
  const rows = (lines || []).filter(Boolean);
  for (let i = 0; i < rows.length; i += 1) {
    const l = rows[i];
    const label = typeof l.label === "string" ? l.label.trim() : "";
    if (!label && !l.inventory_item_id) {
      throw new AppError("VALIDATION_ERROR", `Line ${i + 1} needs a description.`, 422, {
        [`lines.${i}.label`]: ["a line needs a description (or a stock item)"],
      });
    }
    await repo.insertLine(client, {
      delivery_note_id: id,
      inventory_item_id: l.inventory_item_id || null,
      label: label || null,
      qty: Number(l.qty) || 1,
    });
  }
}

/**
 * Replace the container selection, snapshotting each box as it is picked.
 *
 * The snapshot is the reason this is not just a join table. A delivery note is
 * a record of what was handed over on a date; if the file is corrected later (a
 * mistyped number fixed, a unit removed) the note must still print what was
 * actually signed for. So `container_no`/`seal_no`/weight are copied at pick
 * time and the unit link is kept only for provenance.
 */
async function replaceContainers(client, { id, dossierId, containers }) {
  await repo.deleteContainers(client, id);
  const rows = rules.normaliseContainers(containers);
  if (!rows.length) return;

  const unitIds = rows.map((r) => r.dossier_container_unit_id).filter(Boolean);
  const known = await repo.unitsOnDossier(client, dossierId, unitIds);
  /*
   * The re-delivery guard, asked HERE and not trusted from the picker.
   *
   * The picker's `delivered_on` is as old as the page it was drawn on, and a
   * box can be signed for by another operator between opening the form and
   * saving it. `excludeNoteId` is this note, so re-saving a note that already
   * carries the box is not accused of re-delivering it.
   */
  rules.assertRedeliveryExplained(
    rows,
    await repo.deliveredUnits(client, { unitIds, excludeNoteId: id }),
  );
  const lineIds = rows.map((r) => r.dossier_container_line_id).filter(Boolean);
  const knownLines = await repo.linesOnDossier(client, dossierId, lineIds);

  const foreign = unitIds.filter((u) => !known.has(u));
  const foreignLines = lineIds.filter((l) => !knownLines.has(l));
  if (foreign.length || foreignLines.length) {
    // Pointing a note at a box (or a container line) on somebody else's file
    // is either a bug or an attempt to fabricate provenance. Either way it is
    // not a 500.
    throw new AppError(
      "UNKNOWN_CONTAINER",
      "One or more containers are not on this operations file.",
      422,
      { containers: [...foreign, ...foreignLines] },
    );
  }

  for (const r of rows) {
    if (r.dossier_container_line_id) {
      // The GROUPED shape (10708). The file's own type code and remaining
      // quantity are snapshotted here, at pick time — a later correction to
      // the file cannot rewrite what was signed for.
      const line = knownLines.get(r.dossier_container_line_id);
      await repo.insertContainer(client, {
        delivery_note_id: id,
        dossier_container_line_id: r.dossier_container_line_id,
        container_type_code: (line && line.container_type_code) || r.container_type_code,
        qty: (line && Number(line.remaining) >= 1) ? Number(line.remaining) : r.qty,
        seq: r.seq,
        container_no: null,
        seal_no: null,
        gross_weight_kg: null,
        notes: r.notes,
      });
      continue;
    }
    const unit = r.dossier_container_unit_id ? known.get(r.dossier_container_unit_id) : null;
    await repo.insertContainer(client, {
      delivery_note_id: id,
      dossier_container_unit_id: r.dossier_container_unit_id,
      seq: r.seq,
      qty: 1,
      // Prefer the file's own values; fall back to whatever was typed.
      container_no: (unit && unit.container_no) || r.container_no,
      seal_no: r.seal_no || (unit && unit.seal_no) || null,
      gross_weight_kg: r.gross_weight_kg ?? (unit && unit.gross_weight_kg) ?? null,
      notes: r.notes,
      redelivery_reason: r.redelivery_reason,
    });
  }
}

/* ── reads ──────────────────────────────────────────────────────────────── */

async function get(client, id) {
  const dn = await repo.getFull(client, id);
  if (!dn) return null;
  const [lines, containers] = await Promise.all([
    repo.listLines(client, id),
    repo.listContainers(client, id),
  ]);
  return {
    ...dn,
    lines,
    containers,
    allowed_transitions: rules.NEXT[dn.status] || [],
    issue_blockers: dn.status === "DRAFT" ? rules.issueBlockers(dn, { lines, containers }) : [],
  };
}

const list = (client, q) => repo.listDN(client, q);
const summary = (client, q) => repo.statusCounts(client, q);

/**
 * A create body, prefilled from the file the note is for.
 *
 * The containers are the point. A file with "12 × 45' HC" carries twelve
 * container numbers and twelve seal numbers, and the delivery note is the
 * document they exist to travel on — twenty-four hand-transcribed alphanumerics
 * per note, which is not a task people do accurately. Prefilled, the note cannot
 * drift from the file.
 *
 * Returns `{ body, inferred, from }` on the same contract as the transit
 * order's: `body` spreads into the create payload, `from` names what was
 * copied, `inferred` names what was derived. Nothing is binding.
 */
async function prefill(client, { dossier_id }) {
  const found = await repo.dossierForPrefill(client, dossier_id);
  if (!found) throw new AppError("NOT_FOUND", "Operations file not found", 404);
  return prefillShared.deliveryNoteFrom(found.dossier, found.containers, found.lines);
}

/** The file's boxes, for the picker. */
async function availableContainers(client, { dossierId, excludeNoteId = null }) {
  if (!dossierId) throw new AppError("VALIDATION_ERROR", "dossier_id is required", 422);
  return repo.containersForDossier(client, dossierId, { excludeNoteId });
}

/**
 * How much of this file has been delivered.
 *
 * The answer nobody could get before: a twelve-container file delivered over
 * three weeks had `already_on` per box and nothing that added up. Derived from
 * the notes (see `repo.progressForDossier`), so there is no second source of
 * truth to drift.
 *
 * `containerised` comes off the service type rather than off the count: a file
 * whose service type does not capture containers reports `containerised: false`
 * and every surface can hide the whole idea, instead of showing "0 of 0
 * containers" on a customs-brokerage file that will never have one.
 */
async function progress(client, { dossierId }) {
  if (!dossierId) throw new AppError("VALIDATION_ERROR", "dossier_id is required", 422);
  const [rows, captures] = await Promise.all([
    repo.progressForDossier(client, dossierId),
    repo.capturesContainers(client, dossierId),
  ]);
  const out = rules.deliveryProgress(rows);
  return { ...out, containerised: captures && out.total > 0, captures_containers: captures };
}

/* ── writes ─────────────────────────────────────────────────────────────── */

/**
 * Create a DRAFT. No number is allocated here.
 *
 * That is the deliberate break from legacy, which allocated `MAX(seq)+1` on the
 * first save and then — because `create.php` never reads the `dn_number` the
 * client sends back — allocated ANOTHER one on every subsequent save, orphaning
 * the first. Numbers are burned at ISSUE, once, in `issue()`.
 */
async function create(client, {
  entityId = null, dossierId = null, consignee = null, cityZone = null, contactPerson = null,
  address = null, phone = null, deliveryDate = null, lines = [], containers = [], actor = {},
}) {
  let entity = entityId;
  if (dossierId) {
    const brief = await repo.dossierBrief(client, dossierId);
    if (!brief) throw new AppError("NOT_FOUND", "Operations file not found", 404);
    entity = entity || brief.entity_id;
    // The consignee defaults to the file's client — it is right nearly always,
    // and typing a client name that the file already knows invites a mismatch
    // between the note and the invoice.
    consignee = consignee || brief.client_name || null;
  }

  await client.query("BEGIN");
  try {
    const dn = await repo.insertDN(client, {
      dossier_id: dossierId, entity_id: entity, consignee, city_zone: cityZone,
      contact_person: contactPerson, address, phone, delivery_date: deliveryDate,
      status: "DRAFT",
      created_by: await resolveActorId(client, actor.user_id),
    });
    await replaceLines(client, dn.delivery_note_id, lines);
    if (containers && containers.length) {
      if (!dossierId) {
        throw new AppError("VALIDATION_ERROR", "Containers can only be selected on a note attached to a file.", 422);
      }
      await replaceContainers(client, { id: dn.delivery_note_id, dossierId, containers });
    }
    await emitEvent(client, {
      eventTypeKey: events.CREATED, moduleKey: events.MODULE,
      entityRef: ref(dn.delivery_note_id), actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE,
      entityRef: ref(dn.delivery_note_id), after: dn,
    });
    await client.query("COMMIT");
    return get(client, dn.delivery_note_id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function update(client, { id, patch = {}, lines = null, containers = null, actor = {} }) {
  const before = await repo.getDN(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Delivery note not found", 404);
  rules.assertEditable(before, patch);
  if ((lines || containers) && !rules.EDITABLE.has(before.status)) {
    throw new AppError("LOCKED", `Cargo cannot change on a ${before.status} delivery note.`, 422);
  }

  const fields = {};
  const copy = [
    "dossier_id", "entity_id", "consignee", "city_zone", "contact_person",
    "address", "phone", "delivery_date", "reservations",
  ];
  for (const k of copy) if (patch[k] !== undefined) fields[k] = patch[k];

  await client.query("BEGIN");
  try {
    const after = Object.keys(fields).length ? await repo.update(client, id, fields) : before;
    if (lines) await replaceLines(client, id, lines);
    if (containers) {
      const dossierId = fields.dossier_id || before.dossier_id;
      if (!dossierId) throw new AppError("VALIDATION_ERROR", "Containers need a file.", 422);
      await replaceContainers(client, { id, dossierId, containers });
    }
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE,
      entityRef: ref(id), before, after,
    });
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Allocate the number, freeze the shipment details, capture the PDF.
 *
 * Completeness is asserted BEFORE `numbering.allocate` so an incomplete note
 * cannot burn a sequence number on its way to a 422 — the legacy failure that
 * left gaps in the DN series nobody could account for.
 */
async function issue(client, { id, actor = {} }) {
  const before = await repo.getDN(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Delivery note not found", 404);
  rules.assertTransition(before.status, "ISSUED");

  const [lines, containers] = await Promise.all([
    repo.listLines(client, id),
    repo.listContainers(client, id),
  ]);
  rules.assertCanIssue(before, { lines, containers });

  await client.query("BEGIN");
  try {
    const { number } = await numbering.allocate(client, {
      moduleKey: events.MODULE,
      entityId: before.entity_id,
      date: before.delivery_date || new Date().toISOString().slice(0, 10),
    });
    const after = await repo.update(client, id, {
      status: "ISSUED",
      doc_number: number,
      issued_at: new Date().toISOString(),
      issued_by: await resolveActorId(client, actor.user_id),
    });

    // Freeze the routing facts onto the note, so a reprint years later shows
    // what was authorised rather than what the file says today.
    if (before.dossier_id) {
      await shipmentDetails.snapshotOnto(client, {
        table: "delivery_note", id, dossierId: before.dossier_id,
      });
    }
    await documents.capture(client, {
      entityRef: ref(id), docType: "DELIVERY_NOTE", status: "VERIFIED",
    });
    await emitEvent(client, {
      eventTypeKey: events.ISSUED, moduleKey: events.MODULE,
      entityRef: ref(id), actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.ISSUED, moduleKey: events.MODULE,
      entityRef: ref(id), before, after,
    });
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Record the handover — the state the whole module exists for.
 *
 * `reservations` is captured here rather than only at update, because the
 * client's own words ("carton 3 crushed") are written at the gate, in the
 * moment, and that is precisely when they are worth something.
 */
async function confirmDelivery(client, {
  id, receivedByName, receivedAt = null, reservations = null, signatureVaultId = null, actor = {},
}) {
  const before = await repo.getDN(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Delivery note not found", 404);
  rules.assertTransition(before.status, "DELIVERED");
  rules.assertCanDeliver({ receivedByName });

  await client.query("BEGIN");
  try {
    const fields = {
      status: "DELIVERED",
      received_by_name: String(receivedByName).trim(),
      received_at: receivedAt || new Date().toISOString(),
    };
    if (reservations !== null && reservations !== undefined) fields.reservations = reservations;
    if (signatureVaultId) fields.signature_vault_id = signatureVaultId;
    // A delivery with no recorded arrival date is the G23 gap; if nobody set
    // one, the day it was signed for is the honest answer.
    if (!before.delivery_date) {
      fields.delivery_date = String(fields.received_at).slice(0, 10);
    }

    const after = await repo.update(client, id, fields);
    await emitEvent(client, {
      eventTypeKey: events.DELIVERED, moduleKey: events.MODULE,
      entityRef: ref(id), actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.DELIVERED, moduleKey: events.MODULE,
      entityRef: ref(id), before, after,
    });
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Withdraw a note. The number is kept — a gap in the series is a question. */
async function cancel(client, { id, reason, actor = {} }) {
  const before = await repo.getDN(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Delivery note not found", 404);
  rules.assertTransition(before.status, "CANCELLED");
  if (!reason || !String(reason).trim()) {
    throw new AppError("VALIDATION_ERROR", "A cancellation needs a reason.", 422, {
      reason: ["required"],
    });
  }

  await client.query("BEGIN");
  try {
    const after = await repo.update(client, id, {
      status: "CANCELLED",
      cancelled_at: new Date().toISOString(),
      cancel_reason: String(reason).trim(),
    });
    await emitEvent(client, {
      eventTypeKey: events.CANCELLED, moduleKey: events.MODULE,
      entityRef: ref(id), actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null, action: events.CANCELLED, moduleKey: events.MODULE,
      entityRef: ref(id), before, after,
    });
    await client.query("COMMIT");
    return get(client, id);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Generic transition, for the workflow control on the screen. */
async function transition(client, { id, to, reason = null, receivedByName = null, actor = {} }) {
  const target = String(to || "").toUpperCase();
  if (target === "ISSUED") return issue(client, { id, actor });
  if (target === "DELIVERED") return confirmDelivery(client, { id, receivedByName, reservations: reason, actor });
  if (target === "CANCELLED") return cancel(client, { id, reason, actor });
  throw new AppError("BAD_STATE", `Cannot move a delivery note to "${target}".`, 422);
}

module.exports = {
  create, update, issue, confirmDelivery, cancel, transition,
  get, list, summary, availableContainers, progress, prefill,
};
