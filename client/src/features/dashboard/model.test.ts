/**
 * Control Tower model.
 *
 * None of this was testable before Phase 3: it lived inside a template literal
 * that was serialised into an `<iframe srcDoc>`. The mode heuristic in
 * particular has a documented history of getting HINTERLAND_TRANSIT wrong — a
 * road corridor drawn as a shipping lane — so it is pinned here.
 */
import { describe, expect, it } from "vitest";
import {
  firstNameOf,
  greeting,
  isLockedFinal,
  millions,
  shipmentMode,
  shipmentTone,
  toLanes,
  toLiveShipment,
} from "./model";

describe("shipmentMode", () => {
  it("trusts the dossier's service_type key over any text", () => {
    // A hinterland transit has no vessel and two ordinary city names, so text
    // sniffing alone returns "sea" — this is the exact case the key exists for.
    expect(shipmentMode({ service_key: "HINTERLAND_TRANSIT" }, "", "Douala N'Djamena")).toBe("road");
    expect(shipmentMode({ service_key: "AIR_FREIGHT_EXPORT" }, "", "")).toBe("air");
    expect(shipmentMode({ service_key: "SEA_FREIGHT_IMPORT" }, "", "")).toBe("sea");
  });

  it("falls back to text only when there is no service type", () => {
    expect(shipmentMode({}, "AF0942 CDG", "Douala Paris")).toBe("air");
    expect(shipmentMode({ service: "road haulage" }, "", "Douala Garoua")).toBe("road");
  });

  it("defaults to sea when nothing identifies the mode", () => {
    expect(shipmentMode({}, "", "")).toBe("sea");
  });
});

describe("shipmentTone", () => {
  it("maps operational language, not the generic lifecycle vocabulary", () => {
    expect(shipmentTone("Awaiting approval")).toBe("orange");
    expect(shipmentTone("At berth")).toBe("blue");
    expect(shipmentTone("Delivered")).toBe("ok");
    expect(shipmentTone("34 days overdue")).toBe("warn");
    expect(shipmentTone("Storing")).toBe("mute");
  });
});

describe("toLiveShipment", () => {
  const base = {
    ref: "SBX-OPS-2026-0142",
    status: "IN_PROGRESS",
    origin: "Shanghai",
    destination: "Douala",
    vessel_flight: "Maersk Cotonou",
    // MIDDAY UTC, deliberately. This was 23:00Z, one hour from the date
    // boundary, and `dateFmt` renders with `toLocaleDateString` and no
    // `timeZone` — i.e. in the VIEWER's zone. So the assertion below only held
    // at UTC: in Douala (WAT, UTC+1) 23:00Z on the 4th is 00:00 on the 5th, and
    // the test failed "expected '05 Jul 2026' to be '04 Jul 2026'" for every
    // developer on the team while passing on the UTC CI runner.
    //
    // Midday is the most boundary-distant instant there is, so this is robust
    // if the TZ pin is ever removed — though NOT universally: at UTC+14
    // (Kiritimati) 12:00Z is already the 5th, and no UTC hour survives every
    // offset from -12 to +14. The pin is what makes this deterministic; midday
    // just widens the margin.
    //
    // The off-by-one it was tripping over is REAL and is not fixed here: `eta`
    // is a Postgres `date`, serialised to a UTC instant at the API's local
    // midnight and then formatted in the browser's zone, so any viewer in a
    // different zone from the API can see the wrong day. Recorded as NEW-11
    // rather than papered over with a fixture change.
    eta: "2026-07-04T12:00:00.000Z",
    service_key: "SEA_FREIGHT_IMPORT",
    current_milestone: "Costing approval",
    progress: 55,
  };

  it("reads origin/destination — the keys the payload actually carries", () => {
    const s = toLiveShipment(base);
    expect(s.from).toBe("Shanghai");
    expect(s.to).toBe("Douala");
  });

  it("formats the ETA as a date, not a raw ISO timestamp", () => {
    expect(toLiveShipment(base).eta).toBe("04 Jul 2026");
  });

  it("humanises the status enum", () => {
    expect(toLiveShipment(base).status).toBe("In progress");
  });

  it("shows the current milestone, falling back to the vessel", () => {
    expect(toLiveShipment(base).stage).toBe("Costing approval");
    expect(toLiveShipment({ ...base, current_milestone: null }).stage).toBe("Maersk Cotonou");
  });

  it("keeps progress null when the dossier has no milestone chain", () => {
    // "not tracked" and "not started" are different facts. A 0%-width bar
    // asserts the second one; the panel hides the bar for the first.
    expect(toLiveShipment({ ...base, progress: null }).progress).toBeNull();
    expect(toLiveShipment({ ...base, progress: 0 }).progress).toBe(0);
  });

  it("falls back to splitting a pre-joined route string", () => {
    const s = toLiveShipment({ ref: "X", route: "Antwerp → Douala" });
    expect(s.from).toBe("Antwerp");
    expect(s.to).toBe("Douala");
  });
});

describe("toLanes", () => {
  const withCoords = {
    ref: "A",
    service_key: "SEA_FREIGHT_IMPORT",
    origin: "Antwerp",
    destination: "Douala",
    coords: {
      from: { name: "Antwerp", latitude: 51.2, longitude: 4.4 },
      to: { name: "Douala", latitude: 4.05, longitude: 9.7 },
    },
  };

  it("plots only shipments whose BOTH endpoints resolved", () => {
    expect(toLanes([withCoords])).toHaveLength(1);
    expect(toLanes([{ ...withCoords, coords: null }])).toHaveLength(0);
    expect(toLanes([{ ...withCoords, coords: { from: withCoords.coords.from } }])).toHaveLength(0);
  });

  it("rejects non-finite coordinates rather than projecting NaN", () => {
    const broken = { ...withCoords, coords: { from: { latitude: "x", longitude: 4.4 }, to: withCoords.coords.to } };
    expect(toLanes([broken])).toHaveLength(0);
  });

  it("carries the mode through so the lane draws with the right styling", () => {
    expect(toLanes([withCoords])[0].mode).toBe("sea");
  });
});

describe("greeting", () => {
  it("changes with the time of day", () => {
    expect(greeting(new Date(2026, 7, 4, 9), "Amara")).toBe("Good morning, Amara");
    expect(greeting(new Date(2026, 7, 4, 13), "Amara")).toBe("Good afternoon, Amara");
    expect(greeting(new Date(2026, 7, 4, 19), "Amara")).toBe("Good evening, Amara");
  });

  it("omits the name entirely rather than inventing one", () => {
    // The mock hardcoded "Amara", so every user in every tenant was greeted as
    // her. A bare "Good evening" reads fine; a wrong name does not.
    expect(greeting(new Date(2026, 7, 4, 19))).toBe("Good evening");
  });
});

describe("firstNameOf", () => {
  it("prefers the display name, then the email local part", () => {
    expect(firstNameOf({ display_name: "Amara Nkeng", email: "a@b.cm" })).toBe("Amara");
    expect(firstNameOf({ display_name: "", email: "grace@smartls.cm" })).toBe("grace");
    expect(firstNameOf(null)).toBe("");
  });
});

describe("money helpers", () => {
  it("isLockedFinal accepts only locked FINAL invoices", () => {
    expect(isLockedFinal({ type: "FINAL", status: "POSTED_LOCKED" })).toBe(true);
    expect(isLockedFinal({ type: "FINAL", status: "DRAFT" })).toBe(false);
    expect(isLockedFinal({ type: "PROFORMA", status: "ISSUED_LOCKED" })).toBe(false);
  });

  it("millions renders one decimal", () => {
    expect(millions(84_600_000)).toBe("84.6");
  });
});
