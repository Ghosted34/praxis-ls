"use strict";

/**
 * The website quote form's contract with the intake endpoint.
 *
 * WS2's job was to stop the marketing form and the API disagreeing about which
 * fields exist. Four of the five "missing" fields were on the TABLE all along
 * (0683) and absent only from the public Zod schema, so the failure was a 422
 * on a field the database would happily have stored. The rest of this file is
 * about the two things that go wrong when a stranger can write:
 *
 *   · a coordinate must never be believed. `origin_place` carries an id and the
 *     text that produced it, and the server re-asks the provider — otherwise
 *     anyone can POST a pin and have it stored as provider-vouched.
 *   · a rejected FILE is the requester's problem and must reach them; a failed
 *     STORAGE is ours and must not cost the enquiry.
 */

jest.mock("../../src/modules/operations/geo_place/geo_place.service");
jest.mock("../../src/modules/vault/document_vault/document_vault.service");
jest.mock("../../src/config/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const fs = require("node:fs");
const path = require("node:path");

const geoPlace = require("../../src/modules/operations/geo_place/geo_place.service");
const vault = require("../../src/modules/vault/document_vault/document_vault.service");
const { AppError } = require("../../src/utils/errors");
const service = require("../../src/modules/sales/public_intake/public_intake.service");
const { schemas } = require("../../src/modules/sales/public_intake/public_intake.validator");

const quote = (over = {}) => ({ incoterm: "FOB", ...over });
const parse = (body) => schemas.quote.safeParse(body);

beforeEach(() => jest.clearAllMocks());

describe("the five fields the wizard needs", () => {
  it("accepts every one of them", async () => {
    const r = parse(quote({
      estimated_weight: 1200.5,
      project_cargo_flag: true,
      warehouse_location: "Bonabéri",
      warehouse_duration: "DAYS_7_TO_14",
      additional_notes: "Two 40ft, one out of gauge.",
    }));
    expect(r.success).toBe(true);
  });

  it("coerces a weight typed into a text input", () => {
    // A number input hands back a string. Refusing it would be a 422 the
    // visitor cannot see the cause of.
    const r = parse(quote({ estimated_weight: "1200" }));
    expect(r.success).toBe(true);
    expect(r.data.estimated_weight).toBe(1200);
  });

  it("refuses a negative weight", () => {
    expect(parse(quote({ estimated_weight: -1 })).success).toBe(false);
  });

  it("still refuses a field nobody added to the schema", () => {
    // `.strict()` is the reason this endpoint is safe to leave anonymous, and
    // the reason the previous marketing page was refused on every submit.
    expect(parse(quote({ container_count: 2 })).success).toBe(false);
  });

  it("still insists on the incoterm", () => {
    // Resolved decision 3. It is the one required field, and the shipped form
    // left it optional.
    expect(parse({ origin_location: "Shanghai" }).success).toBe(false);
  });
});

describe("warehouse_duration matches the column it is written to", () => {
  it("accepts exactly the values the CHECK constraint allows", () => {
    // A public enum that drifts from the CHECK is a 500 on INSERT instead of a
    // 422 naming the field, and it is discovered by a prospect.
    const sql = fs.readFileSync(
      path.join(__dirname, "../../migrations/tenant/0683_sales_crm_f6_lead_intake.sql"),
      "utf8",
    );
    // The CHECK spans three lines with the list on its own, so this reads from
    // the column name to the end of its constraint and takes every quoted
    // token in between — the only quoted things in that window are the enum.
    const start = sql.indexOf("  warehouse_duration ");
    const clause = sql.slice(start, sql.indexOf("))", start));
    const fromSql = [...clause.matchAll(/'([A-Z_0-9]+)'/g)].map((m) => m[1]).sort();

    expect(fromSql.length).toBeGreaterThan(0);
    for (const value of fromSql) {
      expect(parse(quote({ warehouse_duration: value })).success).toBe(true);
    }
    expect(parse(quote({ warehouse_duration: "A_FORTNIGHT" })).success).toBe(false);
  });
});

describe("a picked place carries no coordinate", () => {
  it("takes the provider's id and the text that produced it", () => {
    const r = parse(quote({
      origin_place: { provider_place_id: "51ab…", query: "Douala", country: "CM" },
    }));
    expect(r.success).toBe(true);
  });

  it("refuses a latitude, which is the forgery this prevents", () => {
    // A body that can carry a coordinate can carry ANY coordinate and have it
    // stored with source='GEOAPIFY'. `.strict()` on the pick is what stops that
    // being a matter of the service remembering to ignore it.
    expect(parse(quote({
      origin_place: { provider_place_id: "p1", query: "Douala", latitude: 0, longitude: 0 },
    })).success).toBe(false);
  });
});

describe("resolvePlace", () => {
  it("re-asks the provider and stores what IT says", async () => {
    geoPlace.confirmSuggestion.mockResolvedValue({ geo_place_id: "g1" });
    const id = await service.resolvePlace({}, { provider_place_id: "p1", query: "Douala" }, "origin");
    expect(id).toBe("g1");
    expect(geoPlace.confirmSuggestion).toHaveBeenCalledWith({}, expect.objectContaining({
      query: "Douala",
      providerPlaceId: "p1",
    }));
  });

  it("records that the REQUESTER confirmed it, not an operator", async () => {
    // The operator picker writes "confirmed by an operator" into the stored
    // provenance. A row minted from an anonymous form must not claim a
    // colleague vouched for it — somebody reading the catalogue later has to be
    // able to tell the two apart.
    geoPlace.confirmSuggestion.mockResolvedValue({ geo_place_id: "g1" });
    await service.resolvePlace({}, { provider_place_id: "p1", query: "Douala" }, "origin");
    expect(geoPlace.confirmSuggestion.mock.calls[0][1].confirmedBy).toBe("the requester");
  });

  it("returns null rather than throwing when the provider is down", async () => {
    // The prospect has typed a route and attached an invoice. Losing that
    // because Geoapify timed out would be the worst trade on this page — the
    // text they typed is already the field the desk reads.
    geoPlace.confirmSuggestion.mockRejectedValue(new AppError("PLACE_PROVIDER_UNAVAILABLE", "down", 502));
    await expect(service.resolvePlace({}, { provider_place_id: "p1", query: "X" }, "origin"))
      .resolves.toBeNull();
  });

  it("asks for nothing when the requester typed free text", async () => {
    expect(await service.resolvePlace({}, null, "origin")).toBeNull();
    expect(await service.resolvePlace({}, {}, "origin")).toBeNull();
    expect(geoPlace.confirmSuggestion).not.toHaveBeenCalled();
  });
});

describe("storeAttachment", () => {
  const withFile = { attachment_data_url: "data:application/pdf;base64,AAA=", attachment_filename: "packing.pdf" };

  it("stores the file with the bytes sniffed, not the label believed", async () => {
    // The second upload path a stranger can reach. A .exe declaring itself a
    // PDF is refused on what it contains.
    vault.createDocument.mockResolvedValue({ doc_id: "d1" });
    const id = await service.storeAttachment({}, withFile);
    expect(id).toBe("d1");
    expect(vault.createDocument).toHaveBeenCalledWith({}, expect.objectContaining({
      sniff: true,
      maxBytes: service.ATTACHMENT_MAX_BYTES,
      allowedTypes: service.ATTACHMENT_TYPES,
    }));
  });

  it("accepts only the three formats the sniffer can actually verify", () => {
    // Accepting .docx here would mean accepting it unsniffed.
    expect(service.ATTACHMENT_TYPES).toEqual(["application/pdf", "image/png", "image/jpeg"]);
  });

  it("tells the requester when THEIR file is the problem", async () => {
    // Silently dropping a 20 MB invoice and confirming the request leaves them
    // believing the desk has a file nobody received.
    vault.createDocument.mockRejectedValue(new AppError("FILE_TOO_LARGE", "File exceeds 8 MB", 413));
    await expect(service.storeAttachment({}, withFile)).rejects.toMatchObject({ status: 413 });
  });

  it("keeps the enquiry when OUR storage is the problem", async () => {
    // The enquiry is worth more than the attachment.
    vault.createDocument.mockRejectedValue(new AppError("STORAGE_ERROR", "s3 unreachable", 500));
    await expect(service.storeAttachment({}, withFile)).resolves.toBeNull();
  });

  it("does nothing at all when no file was offered", async () => {
    // Resolved decision 5: optional. Requiring an invoice before somebody can
    // ask a price loses every prospect who is still shopping.
    expect(await service.storeAttachment({}, {})).toBeNull();
    expect(vault.createDocument).not.toHaveBeenCalled();
  });
});
