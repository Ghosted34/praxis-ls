/** Warehouse location pure rules (MOD-34) — human-readable slot label. */
"use strict";

/** Compose a slot label: "A-12-3-B" from zone/aisle/rack/bin, or the yard name. */
function label(loc) {
  if (!loc) return "";
  if (loc.yard) return `Yard ${loc.yard}`;
  const parts = [loc.zone, loc.aisle, loc.rack, loc.bin].filter((p) => p !== null && p !== undefined && p !== "");
  return parts.join("-");
}

/**
 * The same label, as SQL — what `?q=` searches, so a search matches the text
 * the list shows ("A-12-3-B", "Yard Y1"). Kept beside `label` because the two
 * must agree: `concat_ws` skips NULLs and `NULLIF` drops the empty strings the
 * JS filters out; a non-empty yard wins, as it does above.
 */
const LABEL_SQL =
  "CASE WHEN COALESCE(yard, '') <> '' THEN 'Yard ' || yard " +
  "ELSE concat_ws('-', NULLIF(zone, ''), NULLIF(aisle, ''), NULLIF(rack, ''), NULLIF(bin, '')) END";

module.exports = { label, LABEL_SQL };
