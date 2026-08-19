/**
 * Punch location status — pure.
 *
 * `within_geofence` alone cannot say "we had no GPS": null also means "GPS
 * arrived, but this tenant has no worksite to judge it against". The two must
 * not share a pill. `location_source` (10740) is the snapshot of what the
 * client presented; this maps the pair onto a word the UI can act on.
 */
"use strict";

/** Snapshot written on the punch: gps if both coords arrived, else none. */
function locationSourceFromFix(latitude, longitude) {
  const has =
    latitude !== null && latitude !== undefined &&
    longitude !== null && longitude !== undefined;
  return has ? "gps" : "none";
}

function locationStatus({ location_source = null, latitude = null, longitude = null, within_geofence = null } = {}) {
  const hasCoords =
    latitude !== null && latitude !== undefined &&
    longitude !== null && longitude !== undefined;
  /*
   * `location_source === null` covers the rows written before 10740, where the
   * column does not exist to be read — the destructuring default above folds an
   * absent property into null, so this one test catches both. For those rows
   * the coordinates ARE the evidence: if a fix landed, the punch presented one.
   *
   * A row that says "none" is not merely unpresented, it is a refusal the
   * client recorded on purpose, and it falls out of `presented` on its own —
   * so there is no separate "refused" test to make. Every path that is not
   * `presented` is `no_gps`, whatever the reason.
   */
  const presented = location_source === "gps" || (location_source === null && hasCoords);
  if (!presented) return "no_gps";

  if (within_geofence === false) return "off_site";
  if (within_geofence === true) return "on_site";
  // Coordinates, no worksite. Not a missing fix — saying "No GPS" here is how
  // a tenant that has not placed a fence yet trains people to ignore the flag.
  return "unfenced";
}

module.exports = { locationStatus, locationSourceFromFix };
