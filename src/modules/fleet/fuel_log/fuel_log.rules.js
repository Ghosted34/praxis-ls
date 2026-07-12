/** Fuel log pure rules (MOD-43) — consumption maths. */
"use strict";

/** Litres per 100 km given litres burned over a distance. null if not computable. */
function efficiencyL100(litres, distanceKm) {
  const l = Number(litres || 0);
  const d = Number(distanceKm || 0);
  if (l <= 0 || d <= 0) return null;
  return Math.round((l / d) * 100 * 100) / 100;
}

/** A new odometer reading must not go backwards vs the last recorded value. */
function odometerValid(newOdo, lastOdo) {
  if (newOdo === null || newOdo === undefined) return true;
  if (lastOdo === null || lastOdo === undefined) return true;
  return Number(newOdo) >= Number(lastOdo);
}

module.exports = { efficiencyL100, odometerValid };
