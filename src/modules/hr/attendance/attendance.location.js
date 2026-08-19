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
  const hasCoords = latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined;
  const presented = location_source === "gps" || (location_source == null && hasCoords);
  const refused = location_source === "none" || (!presented && !hasCoords);

  if (refused || !presented) return "no_gps";
  if (within_geofence === false) return "off_site";
  if (within_geofence === true) return "on_site";
  // Coordinates, no worksite. Not a missing fix — saying "No GPS" here is how
  // a tenant that has not placed a fence yet trains people to ignore the flag.
  return "unfenced";
}

module.exports = { locationStatus, locationSourceFromFix };
