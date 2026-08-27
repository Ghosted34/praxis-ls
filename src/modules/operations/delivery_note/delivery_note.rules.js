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
      // Why this box is going out again when a signed note already covers it.
      // Carried through normalisation; the SERVICE decides whether it was
      // required, because only the database knows what has been delivered.
      redelivery_reason: raw.redelivery_reason ? String(raw.redelivery_reason).trim().slice(0, 500) : null,
      seq: out.length,
    });
  });

  return out;
}

/**
 * Refuse a re-delivery that nobody has explained.
 *
 * A box on another ISSUED note is a split load and passes silently. A box on a
 * DELIVERED note has been signed for by a named human, and handing it over
 * again is either a genuine return or — far more often — somebody picking the
 * wrong row. The reason is what tells those apart six months later, so it is
 * required, and it prints on the note.
 *
 * Refused per container and named by number, not as one blanket 422: an
 * operator re-delivering one box out of nine needs to know which.
 *
 * @param {object[]} rows      normalised container rows
 * @param {Map}      delivered unit id → { doc_number, received_at }
 */
function assertRedeliveryExplained(rows, delivered) {
  if (!delivered || !delivered.size) return true;
  const unexplained = rows.filter(
    (r) => r.dossier_container_unit_id
      && delivered.has(r.dossier_container_unit_id)
      && !r.redelivery_reason,
  );
  if (!unexplained.length) return true;

  const detail = {};
  for (const r of unexplained) {
    const on = delivered.get(r.dossier_container_unit_id);
    detail[r.container_no || r.dossier_container_unit_id] =
      `already signed for on ${on.doc_number || "another note"}`;
  }
  throw new AppError(
    "ALREADY_DELIVERED",
    unexplained.length === 1
      ? `Container ${unexplained[0].container_no || "selected"} has already been signed for. Say why it is going out again, or remove it.`
      : `${unexplained.length} of these containers have already been signed for. Say why each is going out again, or remove them.`,
    422,
    { containers: detail },
  );
}

/**
 * The lifecycle in words, FR and EN.
 *
 * A PAIR, never a pre-joined string — the same rule the transit order's
 * `statusWords` carries, and for the same reason: the printed note is
 * monolingual, and a projection that hands the renderer "Émis / Issued" as one
 * value has already made a decision `cfg.language` cannot undo.
 */
const STATUS_WORDS = {
  DRAFT: { fr: "Brouillon", en: "Draft" },
  ISSUED: { fr: "Émis", en: "Issued" },
  DELIVERED: { fr: "Livré", en: "Delivered" },
  CANCELLED: { fr: "Annulé", en: "Cancelled" },
};
const statusWords = (status) => STATUS_WORDS[String(status || "").toUpperCase()]
  || { fr: String(status || ""), en: String(status || "") };

/* ── Partial deliveries ─────────────────────────────────────────────────── */

/**
 * The file's delivery position, from the repo's rollup rows.
 *
 * PURE, and here rather than in the repo, because three surfaces need the same
 * answer and must not each do their own arithmetic: the operations file ("4 of
 * 12 still to go"), the container picker (which boxes to offer), and the
 * printed note itself ("delivery 3 · 4 remaining"). A second implementation of
 * this is how the sheet a client signs comes to disagree with the screen the
 * operator is looking at.
 *
 * ── The three states ───────────────────────────────────────────────────────
 *   delivered    a signed note covers it
 *   in_transit   a note covers it and is out with a driver, not yet signed
 *   outstanding  no live note covers it — the number that means "still to go"
 *
 * `outstanding` is NOT `total - delivered`. A box on an issued note is neither
 * delivered nor still to be sent; counting it as outstanding is what puts a
 * second truck on the road for a container that is already on the first.
 *
 * A grouped line contributes the part of its quantity that has NOT been
 * itemised — the boxes broken out of it report individually, and counting both
 * would double the file.
 */
function deliveryProgress({ units = [], lines = [] } = {}) {
  let delivered = 0;
  let inTransit = 0;
  let total = 0;

  const boxes = units.map((u) => {
    const state = u.is_delivered ? "DELIVERED" : (u.is_issued ? "IN_TRANSIT" : "OUTSTANDING");
    total += 1;
    if (state === "DELIVERED") delivered += 1;
    else if (state === "IN_TRANSIT") inTransit += 1;
    return {
      kind: "unit",
      id: u.id,
      container_no: u.container_no || null,
      seal_no: u.seal_no || null,
      container_type_code: u.container_type_code || null,
      state,
      delivered_on_note: u.delivered_on_note || null,
      delivered_at: u.delivered_at || null,
      issued_on_note: u.issued_on_note || null,
    };
  });

  const groups = [];
  for (const l of lines) {
    // Only the un-itemised part of the line is this row's to account for.
    const open = Math.max(0, Number(l.qty || 0) - Number(l.itemised || 0));
    if (open <= 0) continue;
    const deliveredQty = Math.min(open, Number(l.delivered_qty || 0));
    const issuedQty = Math.min(open - deliveredQty, Number(l.issued_qty || 0));
    total += open;
    delivered += deliveredQty;
    inTransit += issuedQty;
    groups.push({
      kind: "line",
      id: l.id,
      container_type_code: l.container_type_code || null,
      qty: open,
      delivered_qty: deliveredQty,
      in_transit_qty: issuedQty,
      outstanding_qty: open - deliveredQty - issuedQty,
    });
  }

  const outstanding = Math.max(0, total - delivered - inTransit);
  return {
    total,
    delivered,
    in_transit: inTransit,
    outstanding,
    // Stated rather than left for a caller to compute from `outstanding === 0`,
    // which is true of a file with no containers at all.
    complete: total > 0 && outstanding === 0 && inTransit === 0,
    containerised: total > 0,
    boxes,
    groups,
  };
}

/**
 * Which delivery this note is, and what it leaves behind.
 *
 * Printed on the sheet so the client's gatekeeper knows more is coming and the
 * driver knows this is not the last run. `sequence` counts the LIVE notes on
 * the file in issue order, so a cancelled note does not leave a hole in the
 * numbering the client can see.
 *
 * Returns null for a file with no containers — a non-containerised delivery
 * note says nothing about container counts, which is the honest answer rather
 * than "0 of 0".
 */
function deliveryPosition(progress, { sequence = null, ofNotes = null } = {}) {
  if (!progress || !progress.containerised) return null;
  return {
    sequence,
    of_notes: ofNotes,
    total: progress.total,
    delivered: progress.delivered,
    in_transit: progress.in_transit,
    outstanding: progress.outstanding,
  };
}

module.exports = {
  NEXT,
  STATUS_WORDS,
  statusWords,
  deliveryProgress,
  deliveryPosition,
  assertRedeliveryExplained,
  EDITABLE,
  POST_ISSUE_EDITABLE_FIELDS,
  assertTransition,
  issueBlockers,
  assertCanIssue,
  assertCanDeliver,
  assertEditable,
  normaliseContainers,
};
