"use strict";
/**
 * Marks & Numbers — one generator, because five printed documents read it.
 *
 * WHAT THIS RECOVERS
 *
 * Legacy generated the marks string from the container lines and made the field
 * read-only (`operations-registry.php:641`): 1 × 20' Reefer and 2 × 40' HC
 * printed as `01*20'RF, 02*40'HC`. We seeded it as a free-text box instead,
 * which is a regression rather than a simplification — the final invoice, the
 * transit order, the delivery note and both costing packages all read that
 * string, and a clerk retyping it by hand is how five documents come to disagree
 * with the container editor sitting next to it.
 *
 * WHY IT IS HERE AND NOT IN EITHER SIDE
 *
 * The server is authoritative: it recomputes on every container write, so the
 * stored string cannot drift from the equipment. The browser needs the same
 * answer to show a live preview under the container editor while someone is
 * still typing. Two implementations of a format that must stay byte-identical
 * with a legacy PHP file is the definition of a thing that will drift, so it is
 * written once and imported by both.
 *
 * THE FORMAT IS NOT NEGOTIABLE
 *
 * Zero-padded quantity, `*`, the type token, joined with `, `. Byte-identical to
 * legacy so a file created in 2024 and a file created today print the same way.
 * Anything prettier is a decision to make old and new documents differ.
 */

/**
 * Family → legacy's type code. `DC` is the fallback because an unfamilied box
 * is, in practice, a dry one.
 *
 * TK, VT and BU are ours: legacy knew DC/HC/OT/FR/RF and had no ISO tank,
 * ventilated or bulk type at all. Extending the vocabulary for a type legacy
 * could not express is not the same as changing how the ones it knew print.
 */
const FAMILY_TOKEN = {
  DRY: "DC",
  REEFER: "RF",
  FLATRACK: "FR",
  OPENTOP: "OT",
  ISOTANK: "TK",
  VENTILATED: "VT",
  BULK: "BU",
};

/**
 * The token one container type prints as.
 *
 * A seeded type carries an explicit `extra.marks_token` (0668) and that always
 * wins — it is the only way to be certain a 45' HC prints `45'HC` rather than
 * something derived. The derivation below exists for TENANT-created types,
 * where the alternative is a blank that silently shortens a B/L line.
 *
 * @param {{ code?: string, extra?: { marks_token?: string, size?: string, family?: string } }} type
 * @returns {string} never empty
 */
function marksTokenFor(type) {
  const extra = (type && type.extra) || {};
  if (extra.marks_token) return String(extra.marks_token);

  const size = String(extra.size || "");
  const digits = (size.match(/^\d+/) || [])[0];
  const family = extra.family || "DRY";

  // "High cube" is a TYPE in legacy's vocabulary, not a size: `40HC` prints as
  // `40'HC`, not `40HC'DC`. It only applies to dry boxes — a 40' HC reefer
  // prints `40'RF`, because five type codes cannot say both things at once.
  const code =
    /HC$/i.test(size) && family === "DRY" ? "HC" : FAMILY_TOKEN[family] || "DC";

  if (digits) return digits + "'" + code;
  // No size at all — the size-less legacy rows (FLATRACK, REEFER, …). The bare
  // type code, and failing even that the registry code. Never an empty token:
  // `01*` on a bill of lading is worse than a token nobody loves.
  return code || String((type && type.code) || "");
}

/**
 * The marks string for a file's equipment.
 *
 * @param {{ qty: number|string, container_type_ref_id: string }[]} lines
 *        the dossier's container lines, in their stored order — the order is
 *        the operator's and is preserved, not sorted, because it is how they
 *        described the shipment.
 * @param {Map<string, object>|Record<string, object>} typesById
 *        the CONTAINER_TYPE registry rows, keyed by ref_id
 * @returns {string} e.g. `01*20'RF, 02*40'HC`; empty when nothing qualifies
 */
function marksFromContainers(lines, typesById) {
  const get = (id) =>
    typesById instanceof Map ? typesById.get(id) : (typesById || {})[id];

  return (lines || [])
    .filter((l) => l && Number(l.qty) > 0 && l.container_type_ref_id)
    .map((l) => {
      const token = marksTokenFor(get(l.container_type_ref_id) || {});
      // Zero-padded to two, and NOT truncated past it: legacy padded with
      // `String(qty).padStart(2,'0')`, so 100 boxes print `100`, not `00`.
      return String(Math.trunc(Number(l.qty))).padStart(2, "0") + "*" + token;
    })
    .join(", ");
}

exports.FAMILY_TOKEN = FAMILY_TOKEN;
exports.marksTokenFor = marksTokenFor;
exports.marksFromContainers = marksFromContainers;
