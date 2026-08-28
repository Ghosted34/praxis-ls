/**
 * Prefilling a document from the operations file it belongs to.
 *
 * ── THE PROBLEM ────────────────────────────────────────────────────────────
 *
 * Open "New transit order", pick a file, and the panel at the top of the dialog
 * shows the customs regime, the declaration number, the incoterm, the commodity,
 * the gross weight, the package count and the marks. Then the form underneath
 * asks for the customs regime, the declaration number, the incoterm and a cargo
 * line — every one of them already on screen, an inch higher, read-only.
 *
 * That is not a small annoyance. It is a re-typing step between a record and a
 * document derived from that record, so every transit order is an opportunity
 * for the two to disagree — and when they do, the file says one thing and the
 * document lodged with customs says another.
 *
 * ── WHAT THIS DOES, AND WHAT IT REFUSES TO DO ──────────────────────────────
 *
 * It returns a DRAFT BODY, shaped exactly like the create payload, from what the
 * dossier actually holds. Three rules, and the second and third are the ones
 * that matter:
 *
 *   1. Every field stays editable. This is a starting point, not a lock — the
 *      operator is the one lodging the declaration and they overrule the file.
 *
 *   2. IT NEVER INVENTS. A field the dossier does not hold comes back absent,
 *      not guessed. A plausible wrong value in a customs document is worse than
 *      an empty box, because an empty box gets filled in and a filled one gets
 *      skimmed past.
 *
 *   3. EVERY INFERENCE IS DECLARED. Exactly one value here is derived rather
 *      than copied — the direction, from the regime prefix — and it is reported
 *      in `inferred` so the UI can mark it as a suggestion rather than a fact.
 *
 * Shared because the delivery note wants the same thing from the same file, and
 * two copies of "which dossier column feeds which document field" would drift
 * the first time a column was added.
 */
"use strict";

/** IM* is an import and EX* is an export, by definition of the regime codes. */
function directionFromRegime(regime) {
  const r = String(regime || "").trim().toUpperCase();
  if (/^IM/.test(r)) return "IMPORT";
  if (/^EX/.test(r)) return "EXPORT";
  return null;
}

/** The standard regimes; anything else the file holds is a write-in. */
function splitRegime(regime, allowed) {
  const r = String(regime || "").trim().toUpperCase();
  if (!r) return {};
  return allowed.includes(r) ? { customs_regime: r } : { customs_regime_other: r.slice(0, 60) };
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * A weight in the file's unit, as kilogrammes.
 *
 * The dossier stores a number and a unit (`KG` | `TON` | `LB`, 0660) because a
 * client quotes in whichever they trade in. The delivery note stores
 * kilogrammes flat: it is a receipt, and a receipt that needs a unit conversion
 * to check against a weighbridge ticket is a receipt nobody checks.
 *
 * An unknown unit returns null rather than assuming kilogrammes — a weight
 * wrong by a factor of a thousand on a proof of delivery is worse than no
 * weight, and it is the failure nobody would spot on the page.
 */
const KG_PER = { KG: 1, TON: 1000, LB: 0.45359237 };
function kilogrammes(value, unit) {
  // `num(null)` is 0, because `Number(null)` is 0 — so an ABSENT weight has to
  // be rejected before the conversion, or a file that never recorded one prints
  // "0 kg" on the document somebody signs to say they received the goods.
  if (value === null || value === undefined || value === "") return null;
  const n = num(value);
  if (n === null || n < 0) return null;
  const factor = KG_PER[String(unit || "KG").trim().toUpperCase()];
  if (!factor) return null;
  return Math.round(n * factor * 1000) / 1000;
}

/**
 * One cargo line from the dossier's own cargo columns (0660).
 *
 * `label` is required by the transit-order validator and is the one field with
 * no sensible fallback, so a file with no commodity at all yields NO line rather
 * than a line labelled "Cargo" that somebody has to notice and correct.
 *
 * Weight is a string on the line and a numeric on the dossier: the line carries
 * "25000 tonne" because that is what prints, and dropping the unit would leave a
 * bare number whose meaning depends on a column the document does not show.
 */
function cargoLine(d) {
  const label = (d.commodity_desc || d.commodity || "").trim();
  if (!label) return null;
  const weight = d.gross_weight
    ? [num(d.gross_weight), (d.weight_unit || "").trim()].filter(Boolean).join(" ")
    : null;
  const line = { label: label.slice(0, 500) };
  if (d.marks_numbers) line.marks = String(d.marks_numbers).slice(0, 200);
  if (d.package_count !== null && d.package_count !== undefined) {
    const p = num(d.package_count);
    if (p !== null && p >= 0) line.packages = p;
  }
  if (weight) line.weight = weight.slice(0, 60);
  return line;
}

/**
 * The transit-order create body, from a dossier.
 *
 * @param dossier the row, as `dossier-prefill.repo` selects it
 * @param entity  the dossier's corporate entity, for the money defaults
 * @param regimes rules.CUSTOMS_REGIMES — passed in so this module does not
 *                depend on the transit-order module it feeds
 */
function transitOrderFrom(dossier, entity, regimes) {
  if (!dossier) return { body: {}, inferred: [], from: [] };
  const body = { dossier_id: dossier.dossier_id };
  const from = [];
  const inferred = [];

  if (dossier.entity_id) { body.entity_id = dossier.entity_id; from.push("entity_id"); }

  const regime = splitRegime(dossier.customs_regime, regimes);
  if (regime.customs_regime || regime.customs_regime_other) {
    Object.assign(body, regime);
    from.push("customs_regime");
    const dir = directionFromRegime(dossier.customs_regime);
    // The ONE derived value. Reported so the form can show it as a suggestion —
    // an operator who is running an IM7 as something unusual must see that the
    // direction was assumed rather than read off the file.
    if (dir) { body.service_direction = dir; inferred.push("service_direction"); }
  }

  /*
   * Money. The currency comes from the ENTITY, not the file: the declared value
   * is what this company is declaring, in the money it keeps its books in.
   *
   * THE RATE IS NOT PREFILLED, and it used to be — `declared_fx_to_xaf = 1` for
   * a XAF entity. This body is documented as "shaped exactly like the create
   * payload so the form can spread it", and the create schema now REFUSES that
   * field by name (it was accepted and ignored: the rate is derived from the
   * currency master). A prefill that seeds a field the create call rejects
   * hands the operator a 422 on a form they never touched.
   *
   * Nothing is lost: `GET /transit-orders/currencies` returns each currency
   * with its live rate already resolved, which is what the form's rate field
   * reads — a derived read-out, never a second number to mistype.
   */
  const currency = (entity && entity.default_currency) || null;
  if (currency) {
    body.declared_currency = currency;
    from.push("declared_currency");
  }

  /*
   * `departure_date` is DELIBERATELY NOT PREFILLED.
   *
   * The dossier records `eta` — an ARRIVAL — and nothing else date-shaped. Using
   * it here would print a "Date de départ" wrong by the length of the voyage,
   * on a document lodged with customs, and it would look filled in, so nobody
   * would check it. This is rule 2 in the header: an empty box gets filled in, a
   * plausible wrong one gets skimmed past.
   */

  const line = cargoLine(dossier);
  if (line) { body.lines = [line]; from.push("lines"); }

  return { body, inferred, from };
}

/**
 * The delivery-note create body, from a dossier and its container units.
 *
 * ── WHAT MAKES THIS ONE WORTH MORE THAN THE TRANSIT ORDER ──────────────────
 *
 * The containers. A file with "12 × 45' HC" has twelve `dossier_container_unit`
 * rows, each with a container number and a seal number — and the delivery note
 * is the document those numbers exist to travel on. Typed by hand that is
 * twenty-four transcriptions of eleven-character alphanumerics per note, which
 * is not a task humans do accurately. Copied, it cannot drift from the file.
 *
 * The units come through by ID (`dossier_container_unit_id`), not as loose
 * strings: the validator accepts either, but a pick keeps the note pointing at
 * the box on the file rather than at a copy of its number that stops matching
 * the moment somebody corrects a typo upstream.
 *
 * A GROUPED file has no units yet — it states "3 × 40' HC" as a container
 * LINE, and until 10708 that whole shape was invisible to this prefill, so
 * the most common file on a containerised service type prefilled nothing.
 * The line travels as `{ dossier_container_line_id, container_type_code,
 * qty }` and the note prints it the way the file states it.
 *
 * ── THE CONSIGNEE, AND WHY IT IS NOW SUGGESTED RATHER THAN BLANK ───────────
 *
 * `consignee`, `contact_person` and `phone` are columns on DELIVERY_NOTE, not
 * on `dossier`: the file does not record who the goods are handed to. The only
 * candidate is the file's CLIENT, and a client is not a consignee — it is
 * regularly the customer's own buyer, a bonded warehouse or a site foreman.
 *
 * This used to leave the box empty on that reasoning. The reasoning is right
 * and the conclusion was wrong: an empty box on the busiest field of the form
 * is not neutrality, it is retyping the client's name on the nine notes out of
 * ten where the client IS the consignee. So it is filled and returned in
 * `inferred`, which the form renders as "suggested — check it" rather than as
 * "from the file". The operator confirms or overtypes; nobody transcribes.
 *
 * ── THE ADDRESS IS FROM THE FILE NOW ───────────────────────────────────────
 *
 * It was not, and the reason was real: `place_delivery` was free text on
 * several service types while the note's field is a verified PlacePicker, so
 * copying one into the other produced a box that LOOKED filled and was flagged
 * unverified underneath. Migration 12748 makes every field bound to
 * `place_delivery` a GEO_PLACE, so its value is a catalogue name — the same
 * thing the picker holds. The objection is gone and the copy is now correct.
 *
 * @param dossier    the row, as `dossierForPrefill` selects it
 * @param containers `dossier_container_unit` rows for that file
 * @param lines      `dossier_container_line` rows (the GROUPED shape), with
 *                   their remaining quantity and type code
 */
function deliveryNoteFrom(dossier, containers = [], lines = []) {
  if (!dossier) return { body: {}, inferred: [], from: [] };
  const body = { dossier_id: dossier.dossier_id };
  const from = [];
  const inferred = [];

  if (dossier.entity_id) { body.entity_id = dossier.entity_id; from.push("entity_id"); }

  /*
   * `city_zone` is NOT prefilled from `place_delivery`, though it is tempting.
   *
   * That field is a `PlacePicker` — the control whose entire purpose is that a
   * location cannot be committed as free text, because "Doula" is one letter
   * from Cameroon's main port and a typo used to save cleanly and get
   * forward-geocoded into a confident wrong coordinate. It accepts only a
   * verified catalogue entry.
   *
   * `place_delivery` was free text on several service types, so copying it into
   * that picker produced a box that LOOKED filled and carried the picker's own
   * "not linked to a place" warning underneath — filled, flagged wrong, and
   * still to be redone.
   *
   * Migration 12748 makes every field bound to `place_delivery` a GEO_PLACE, so
   * the value is a catalogue name: the same thing the picker holds. The copy is
   * now correct, and it is the address the client was quoted.
   */
  if (dossier.place_delivery) {
    body.city_zone = String(dossier.place_delivery).trim();
    body.address = String(dossier.place_delivery).trim();
    from.push("city_zone", "address");
  }

  /*
   * The consignee, SUGGESTED rather than stated.
   *
   * A client is not a consignee — see the header. But leaving it blank meant
   * retyping the client's name on the nine notes in ten where they are the same
   * party, so it is filled and declared in `inferred`; the form shows "suggested
   * — check it" and the operator confirms or overtypes.
   */
  if (dossier.client_name) {
    body.consignee = String(dossier.client_name).slice(0, 200);
    inferred.push("consignee");
  }
  // The person a driver rings at the gate, from the client's primary contact.
  // Same standing as the consignee: a real answer to check, not a fact.
  if (dossier.contact_name) {
    body.contact_person = String(dossier.contact_name).slice(0, 200);
    inferred.push("contact_person");
  }
  if (dossier.contact_phone) {
    body.phone = String(dossier.contact_phone).slice(0, 40);
    inferred.push("phone");
  }
  /*
   * WHEN the goods are expected. `promised_delivery_date` is what the CLIENT was
   * promised and is exactly this document's date; `eta` is the carrier's guess
   * at the port and is not, so it is not used here. Copied when the file has the
   * promise, absent otherwise — never derived from the ETA, which would print a
   * delivery date wrong by the length of the last mile.
   */
  if (dossier.promised_delivery_date) {
    body.delivery_date = dossier.promised_delivery_date;
    from.push("delivery_date");
  }

  /*
   * The cargo line, which on a non-container file is the WHOLE document.
   *
   * It used to be `{label, qty}` only, on the reasoning that a note is a receipt
   * for count rather than a customs description. That holds for a sea file whose
   * substance is the container manifest. It is wrong for an air file, where the
   * packages ARE the substance: the weight is what the consignee checks at the
   * counter and what a claim is argued over, and the marks are how the cartons
   * are identified — the same job the container number does on a box.
   *
   * Weight arrives in the file's own unit (KG / TON / LB) and is stored on the
   * note in kilogrammes, because a receipt should not need a conversion to read.
   */
  const label = (dossier.commodity_desc || dossier.commodity || "").trim();
  if (label) {
    const line = { label: label.slice(0, 500) };
    // Same trap as the weight, and it was already here: `num(null)` is 0, so a
    // file with no package count produced a line reading "0". A delivery note
    // for zero packages is not a thing; absent means absent, and the note's own
    // default of 1 is the honest fallback.
    const qty = dossier.package_count === null || dossier.package_count === undefined
      ? null : num(dossier.package_count);
    if (qty !== null && qty > 0) line.qty = qty;
    const kg = kilogrammes(dossier.gross_weight, dossier.weight_unit);
    if (kg !== null) line.gross_weight_kg = kg;
    if (dossier.marks_numbers) line.marks = String(dossier.marks_numbers).slice(0, 200);
    body.lines = [line];
    from.push("lines");
  }

  if (containers.length || lines.length) {
    body.containers = [
      // Grouped lines first, the way the file states them (10708).
      ...(lines || []).map((l) => ({
        dossier_container_line_id: l.dossier_container_line_id,
        container_type_code: l.container_type_code || null,
        qty: (Number(l.qty) || 0) > 0 ? Number(l.qty) : 1,
        container_no: null,
        seal_no: null,
        gross_weight_kg: null,
      })),
      // Per-box units by ID, so the note stays pointed at the box on the file.
      // `already_on` rides along so the form can skip boxes another note
      // already covers rather than silently double-delivering them.
      ...(containers || []).map((c) => ({
        dossier_container_unit_id: c.dossier_container_unit_id,
        container_no: c.container_no || null,
        seal_no: c.seal_no || null,
        gross_weight_kg: num(c.gross_weight_kg),
        already_on: Array.isArray(c.already_on) ? c.already_on : [],
      })),
    ];
    from.push("containers");
  }

  return { body, inferred, from };
}

module.exports = { transitOrderFrom, deliveryNoteFrom, cargoLine, kilogrammes, directionFromRegime, splitRegime };
