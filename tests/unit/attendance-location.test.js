"use strict";

const { locationStatus, locationSourceFromFix } = require("../../src/modules/hr/attendance/attendance.location");

describe("locationSourceFromFix", () => {
  it("is gps only when both coordinates are present", () => {
    expect(locationSourceFromFix(4.05, 9.76)).toBe("gps");
    expect(locationSourceFromFix(0, 0)).toBe("gps");
    expect(locationSourceFromFix(null, 9.76)).toBe("none");
    expect(locationSourceFromFix(4.05, undefined)).toBe("none");
    expect(locationSourceFromFix(null, null)).toBe("none");
  });
});

describe("locationStatus", () => {
  it("is no_gps when the punch recorded none", () => {
    expect(locationStatus({ location_source: "none", within_geofence: null })).toBe("no_gps");
  });

  it("is no_gps when nothing was presented (legacy row, no coords)", () => {
    expect(locationStatus({ location_source: null, latitude: null, longitude: null, within_geofence: null })).toBe("no_gps");
  });

  it("does NOT call a GPS punch against no worksite 'No GPS'", () => {
    expect(locationStatus({
      location_source: "gps",
      latitude: 4.05,
      longitude: 9.76,
      within_geofence: null,
    })).toBe("unfenced");
  });

  it("flags off-site and on-site from the geofence snapshot", () => {
    expect(locationStatus({ location_source: "gps", latitude: 1, longitude: 1, within_geofence: false })).toBe("off_site");
    expect(locationStatus({ location_source: "gps", latitude: 1, longitude: 1, within_geofence: true })).toBe("on_site");
  });

  it("treats legacy rows that have coordinates as GPS", () => {
    expect(locationStatus({ location_source: null, latitude: 4, longitude: 9, within_geofence: true })).toBe("on_site");
  });
});
