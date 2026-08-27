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
 * ── THE CONSIGNEE BLOCK IS NOT PREFILLED AT ALL ────────────────────────────
 *
 * `consignee`, `contact_person`, `phone` and `address` are columns on
 * DELIVERY_NOTE, not on `dossier` — the file simply does not record who the
 * goods are being handed to. The only candidate is `dossier.client_id`, and a
 * client is not a consignee: the consignee is regularly the customer's own
 * buyer, a bonded warehouse or a site foreman.
 *
 * Filling that box with the client's name would be right often enough to stop
 * being checked and wrong often enough to matter — on the document somebody
 * signs to say they received the goods. So the note asks, and rule 2 in the
 * header holds: an empty box gets filled in, a plausible wrong one gets skimmed
 * past.
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
   * `place_delivery` is a free-text contractual point on the transport leg. Put
   * into that field it would show as legacy unverified text, with the picker's
   * own "not linked to a place, so it will not appear on the map" warning
   * underneath — a box that LOOKS filled, is flagged as wrong, and still has to
   * be redone. An empty picker the operator searches properly is strictly
   * better, so the file leaves it alone.
   */

  /*
   * A delivery-note line is `{ label, qty }` — no marks, no weight, because the
   * note is a receipt for COUNT, not a customs description. `package_count` is
   * the quantity being handed over; the transit order's version of this line
   * carries the weight and marks instead, which is why the two are built
   * separately rather than sharing one shape.
   */
  const label = (dossier.commodity_desc || dossier.commodity || "").trim();
  if (label) {
    const line = { label: label.slice(0, 500) };
    const qty = num(dossier.package_count);
    if (qty !== null && qty >= 0) line.qty = qty;
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

module.exports = { transitOrderFrom, deliveryNoteFrom, cargoLine, directionFromRegime, splitRegime };
