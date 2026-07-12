/** Warehouse location pure rules (MOD-34) — human-readable slot label. */
"use strict";

/** Compose a slot label: "A-12-3-B" from zone/aisle/rack/bin, or the yard name. */
function label(loc) {
  if (!loc) return "";
  if (loc.yard) return `Yard ${loc.yard}`;
  const parts = [loc.zone, loc.aisle, loc.rack, loc.bin].filter((p) => p !== null && p !== undefined && p !== "");
  return parts.join("-");
}

module.exports = { label };
