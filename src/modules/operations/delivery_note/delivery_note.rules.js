/**
 * Delivery note (MOD-32) — pure lifecycle. No SQL, no HTTP.
 *
 * WHY THIS FILE EXISTS. The legacy bordereau had no lifecycle: the PHP endpoint
 * INSERTed a row and the operator hit Print. The printed page has a "Received By
 * (Client) — Name, Signature & Stamp" box on it, and nothing ever captured what
 * was written there. So the states below are not decoration — DELIVERED is the
 * moment the document stops being a printout and becomes evidence, and
 * `assertCanDeliver` is the reason.
 *
 * Same split as transit_order.rules.js and quotation.rules.js: pure functions,
 * testable without a database, so the service reads as a sequence of decisions.
 */
"use strict";

const { AppError } = require("../../../utils/errors");

/**
 * DRAFT      being prepared; no number burned yet.
 * ISSUED     numbered and printed, goods on their way out.
 * DELIVERED  signed for at the far end. The evidentiary state.
 * CANCELLED  withdrawn.
 *
 * DELIVERED IS TERMINAL, and that is the point. Once a client has signed for
 * goods, what they signed is a fact — it does not get edited afterwards. A
 * mistake found later is corrected by issuing a new note that references this
 * one, not by rewriting the record of what was accepted at the gate.
 */
const NEXT = {
  DRAFT: ["ISSUED", "CANCELLED"],
  ISSUED: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

/** States in which the header, lines and containers may be edited freely. */
const EDITABLE = new Set(["DRAFT"]);

/**
 * An ISSUED note has been printed and is travelling with a driver. The delivery
 * address genuinely does get corrected mid-run ("they moved to gate 4"), and a
 * phone number is not part of what anybody signs — so those may still change.
 * The consignee and the cargo may not: those are what the document asserts.
 */
const POST_ISSUE_EDITABLE_FIELDS = new Set([
  "address",
  "phone",
  "contact_person",
  "city_zone",
  "delivery_date",
]);

function assertTransition(from, to) {
  const allowed = NEXT[from];
  if (!allowed) throw new AppError("BAD_STATE", `Unknown delivery note state "${from}"`, 422);
  if (!allowed.includes(to)) {
    throw new AppError(
      "BAD_STATE",
      allowed.length
        ? `Cannot move delivery note ${from} -> ${to}. From ${from} it can only go to: ${allowed.join(", ")}.`
        : `A ${from} delivery note is final and cannot be moved to ${to}.`,
      422,
    );
  }
  return true;
}

/**
 * What an ISSUE requires.
 *
 * Checked here rather than with NOT NULL columns because a DRAFT is explicitly
 * allowed to be incomplete — that is what a draft is for. Returns everything
 * that is missing rather than throwing on the first, so the operator fixes the
 * form once instead of three times.
 *
 * `address` is on this list on purpose: a proof-of-delivery with no delivery
 * address proves nothing, which is the G23 finding. `city_zone` does not
 * substitute — "Bonabéri" does not identify a gate.
 */
function issueBlockers(dn, { lines = [], containers = [] } = {}) {
  const missing = [];
  if (!dn.dossier_id) missing.push("operations file");
  if (!dn.consignee || !String(dn.consignee).trim()) missing.push("consignee");
  if (!dn.address || !String(dn.address).trim()) missing.push("delivery address");
  if (!lines.length && !containers.length) missing.push("something to deliver (cargo lines or containers)");
  return missing;
}

function assertCanIssue(dn, ctx) {
  const missing = issueBlockers(dn, ctx);
  if (missing.length) {
    throw new AppError(
      "INCOMPLETE",
      `A delivery note cannot be issued without: ${missing.join(", ")}.`,
      422,
      { missing },
    );
  }
  return true;
}

/**
 * Confirming a delivery requires a NAME. Not a checkbox, not a timestamp we
 * generate — the name of the human who signed for the goods.
 *
 * This is the entire value of the document. A note marked delivered with nobody
 * named is exactly as useless as the legacy printout, and it is worse than
 * useless if anyone believes it, because it looks like a record.
 */
function assertCanDeliver({ receivedByName }) {
  if (!receivedByName || !String(receivedByName).trim()) {
    throw new AppError(
      "NO_RECIPIENT",
      "Record who received the goods — a delivery note without a name is not proof of anything.",
      422,
      { received_by_name: ["required to confirm a delivery"] },
    );
  }
  return true;
}

function assertEditable(dn, fields = {}) {
  if (EDITABLE.has(dn.status)) return true;
  if (dn.status === "CANCELLED" || dn.status === "DELIVERED") {
    throw new AppError("LOCKED", `A ${dn.status} delivery note cannot be edited.`, 422);
  }
  const blocked = Object.keys(fields).filter((k) => !POST_ISSUE_EDITABLE_FIELDS.has(k));
  if (blocked.length) {
    throw new AppError(
      "LOCKED",
      `An ISSUED delivery note is already with the driver; only ${[...POST_ISSUE_EDITABLE_FIELDS].join(", ")} may still change (tried: ${blocked.join(", ")}).`,
      422,
      { blocked },
    );
  }
  return true;
}

/**
 * Normalise the container selection.
 *
 * Accepts either a pick from the file (`{ dossier_container_unit_id, … }`) or a
 * hand-typed box (`{ container_no }`), because a container that never made it
 * onto the file still gets delivered and refusing it would push people straight
 * back to the legacy paste box.
 *
 * De-duplicates on the unit id and on the container number, since picking the
 * same box twice is a UI slip rather than an intent to deliver it twice.
 */
function normaliseContainers(rows) {
  if (rows === null || rows === undefined) return [];
  if (!Array.isArray(rows)) throw new AppError("VALIDATION_ERROR", "containers must be a list", 422);

  const out = [];
  const seenUnits = new Set();
  const seenLines = new Set();
  const seenNumbers = new Set();

  rows.forEach((raw, i) => {
    if (!raw) return;
    const unitId = raw.dossier_container_unit_id || null;
    // 10708 — the GROUPED shape: a container line from a file with no per-box
    // numbers yet. A row is identified by unit, by line, or by a typed number.
    const lineId = raw.dossier_container_line_id || null;
    const no = raw.container_no ? String(raw.container_no).trim().toUpperCase() : null;

    if (!unitId && !lineId && !no) {
      throw new AppError("VALIDATION_ERROR", `Container ${i + 1} needs a number.`, 422, {
        [`containers.${i}.container_no`]: ["a container needs a number (or pick one from the file)"],
      });
    }
    if (unitId && seenUnits.has(unitId)) return;
    if (lineId && seenLines.has(lineId)) return;
    if (!unitId && !lineId && no && seenNumbers.has(no)) return;
    if (unitId) seenUnits.add(unitId);
    if (lineId) seenLines.add(lineId);
    if (no) seenNumbers.add(no);

    const qty = raw.qty === null || raw.qty === undefined ? 1 : Number(raw.qty);
    out.push({
      dossier_container_unit_id: unitId,
      dossier_container_line_id: lineId,
      container_type_code: raw.container_type_code ? String(raw.container_type_code).trim().slice(0, 60) : null,
      // A grouped row's quantity is how many of the type this note hands
      // over; a per-box row is one box. At least one, and never fractional.
      qty: Number.isFinite(qty) && qty >= 1 ? Math.floor(qty) : 1,
      container_no: no,
      seal_no: raw.seal_no ? String(raw.seal_no).trim() : null,
      gross_weight_kg: raw.gross_weight_kg === null || raw.gross_weight_kg === undefined
        ? null
        : Number(raw.gross_weight_kg),
      notes: raw.notes ? String(raw.notes).slice(0, 500) : null,
      seq: out.length,
    });
  });

  return out;
}

module.exports = {
  NEXT,
  EDITABLE,
  POST_ISSUE_EDITABLE_FIELDS,
  assertTransition,
  issueBlockers,
  assertCanIssue,
  assertCanDeliver,
  assertEditable,
  normaliseContainers,
};
