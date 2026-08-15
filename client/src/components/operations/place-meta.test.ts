/**
 * The place-presentation decisions, tested where they live.
 *
 * Two of these matter more than they look:
 *
 *   `placeKey` is a SECOND implementation of `geo_place.repo.normalise`, and the
 *   only duplicated logic in this feature. The cases below are exactly the ones
 *   that motivated the original — Yaoundé, N'Djamena, a trailing space, mixed
 *   case — so if the two ever disagree, this file is where it surfaces rather
 *   than as a badge that says "unverified" about a perfectly good port.
 *
 *   `codeOf` decides which identifier an operator sees. UN/LOCODE codes the
 *   LOCALITY, so Douala's port and Douala's airport share CMDLA and only one of
 *   them can carry it; the airport's IATA code therefore rides in `formatted`
 *   (migration 0675). Getting that precedence wrong shows the wrong code on a
 *   booking-facing row.
 */
import { describe, it, expect } from "vitest";
import type { GeoPlace, PlaceSuggestion } from "@/lib/operations-api";
import {
  addressOf,
  codeOf,
  matchStoredValue,
  metaOfPlace,
  metaOfSuggestion,
  placeKey,
  VERIFICATION_COPY,
  verificationOf,
} from "./place-meta";

const place = (o: Partial<GeoPlace> = {}): GeoPlace => ({
  geo_place_id: "gp-1",
  name: "Douala",
  country: "CM",
  kind: "SEAPORT",
  latitude: "4.0482",
  longitude: "9.7004",
  verified_at: "2026-01-01T00:00:00.000Z",
  ...o,
});

describe("placeKey — must agree with geo_place.repo.normalise", () => {
  it("folds accents", () => {
    expect(placeKey("Yaoundé")).toBe("yaounde");
  });

  it("drops apostrophes, straight and curly", () => {
    expect(placeKey("N'Djamena")).toBe("ndjamena");
    expect(placeKey("N’Djamena")).toBe("ndjamena");
  });

  it("collapses punctuation and whitespace, and lowercases", () => {
    expect(placeKey("  PORT-GENTIL ")).toBe("port gentil");
    expect(placeKey("Zone Industrielle, Douala")).toBe(
      "zone industrielle douala",
    );
  });

  it("does NOT strip qualifiers — Paris and Paris CDG are different points", () => {
    expect(placeKey("Paris CDG")).not.toBe(placeKey("Paris"));
  });

  it("returns empty for a value with nothing in it", () => {
    expect(placeKey("   ")).toBe("");
    expect(placeKey("%")).toBe("");
  });
});

describe("matchStoredValue", () => {
  const rows = [
    place({ geo_place_id: "a", name: "Douala" }),
    place({ geo_place_id: "b", name: "Douala Airport" }),
  ];

  it("matches the stored name to its place, ignoring case and padding", () => {
    expect(matchStoredValue("  douala ", rows)?.geo_place_id).toBe("a");
  });

  it("does not settle for a near match — that is the failure being removed", () => {
    expect(matchStoredValue("Doula", rows)).toBeNull();
  });

  it("does not match a prefix to a longer name", () => {
    expect(matchStoredValue("Douala Air", rows)).toBeNull();
  });

  it("an empty value matches nothing", () => {
    expect(matchStoredValue("", rows)).toBeNull();
  });
});

describe("codeOf", () => {
  it("prefers UN/LOCODE", () => {
    expect(
      codeOf(place({ unlocode: "CMDLA", formatted: "DLA · whatever" })),
    ).toBe("CMDLA");
  });

  it("falls back to the IATA code an airport row carries in formatted", () => {
    expect(
      codeOf(
        place({
          unlocode: null,
          formatted: "NBO · Nairobi Jomo Kenyatta airport, Nairobi",
        }),
      ),
    ).toBe("NBO");
  });

  it("does not invent a code from an ordinary address", () => {
    expect(
      codeOf(
        place({
          unlocode: null,
          formatted: "Zone Industrielle Bassa, Douala, Cameroon",
        }),
      ),
    ).toBeNull();
  });

  it("is null when there is nothing to read", () => {
    expect(codeOf(place({ unlocode: null, formatted: null }))).toBeNull();
  });
});

describe("addressOf", () => {
  it("drops the code prefix the badge already shows", () => {
    expect(
      addressOf(
        place({ formatted: "NBO · Nairobi Jomo Kenyatta airport, Nairobi" }),
      ),
    ).toBe("Nairobi Jomo Kenyatta airport, Nairobi");
  });

  it("passes an ordinary address through", () => {
    expect(
      addressOf(place({ formatted: "Zone Industrielle Bassa, Douala" })),
    ).toBe("Zone Industrielle Bassa, Douala");
  });

  it("is null when absent", () => {
    expect(addressOf(place({ formatted: "  " }))).toBeNull();
  });
});

describe("verificationOf — the four states", () => {
  it("a confirmed place is verified", () => {
    expect(verificationOf(place())).toBe("verified");
  });

  it("a reference point says so, even though it is also verified", () => {
    // The distinction this whole feature exists to make storable: we know where
    // this is, and we are not claiming it is the exact address.
    expect(verificationOf(place({ is_reference_point: true }))).toBe(
      "reference",
    );
  });

  it("a background geocode with nobody's eyes on it is unverified", () => {
    expect(
      verificationOf(place({ verified_at: null, source: "GEOAPIFY" })),
    ).toBe("unverified");
  });

  it("no record at all is unknown — legacy free text", () => {
    expect(verificationOf(null)).toBe("unknown");
    expect(verificationOf(undefined)).toBe("unknown");
  });

  it("every state has a label and a sentence — tone never carries meaning alone", () => {
    for (const state of [
      "verified",
      "reference",
      "unverified",
      "unknown",
    ] as const) {
      expect(VERIFICATION_COPY[state].label).toBeTruthy();
      expect(VERIFICATION_COPY[state].hint.length).toBeGreaterThan(20);
    }
  });
});

describe("row facts", () => {
  it("a catalogue place reports its own verification state", () => {
    expect(metaOfPlace(place({ verified_at: null }))).toMatchObject({
      unverified: true,
      confidence: null,
    });
  });

  it("a reference point is flagged so the row can say so", () => {
    expect(
      metaOfPlace(place({ is_reference_point: true })).isReferencePoint,
    ).toBe(true);
  });

  it("a provider suggestion is never shown as unverified — it is not stored yet", () => {
    const s: PlaceSuggestion = {
      provider_place_id: "p1",
      name: "Zone Industrielle Bassa",
      formatted: "Zone Industrielle Bassa, Douala, Cameroon",
      country: "CM",
      latitude: 4.03,
      longitude: 9.7,
      kind: "ADDRESS",
      confidence: 0.84,
    };
    expect(metaOfSuggestion(s)).toMatchObject({
      unverified: false,
      confidence: 0.84,
      code: null,
    });
  });

  it("a suggestion with no confidence reports null rather than 0", () => {
    // 0 would render as "0% provider confidence", which is a claim; null renders
    // as nothing, which is the truth.
    const s = {
      provider_place_id: "p1",
      name: "Somewhere",
      latitude: 1,
      longitude: 1,
    } as PlaceSuggestion;
    expect(metaOfSuggestion(s).confidence).toBeNull();
  });
});
