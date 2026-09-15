/**
 * Website media — the upload control's server half (guide §6.3, O-10).
 *
 * ── WHAT THESE TESTS ARE ACTUALLY PROTECTING ───────────────────────────────
 *
 * Three rules, and none of them is about whether an upload works:
 *
 *   §1.3   a generated image may not occupy a slot a visitor reads as
 *          evidence. The migration (13789) makes it impossible at the row; this
 *          proves the SERVICE refuses it first, with the reason in the message,
 *          because "violates check constraint" is not something to show a
 *          marketing administrator.
 *   §9.4   a mark with a baked-in white background does not render. O-3 says
 *          the supplied logos are exactly that. `stats.isOpaque` is the test a
 *          note in a document cannot perform.
 *   §9.7   every partner rendered has a permission note — asserted, not
 *          inspected.
 *
 * ── AND ONE ABOUT PATHS ────────────────────────────────────────────────────
 *
 * `resolveVariant` is the only thing standing between a URL segment and a
 * storage key. It is tested for what it REFUSES, not for what it returns.
 */
"use strict";

const media = require("../../src/modules/site/site_settings/site_settings.media");
const { siteSettings } = require("@praxis/shared");

/* ── the slot register ──────────────────────────────────────────────────────*/

describe("the slot register", () => {
  test("every slot the shared schema offers has an owner on the server", () => {
    // The two halves are in different packages on purpose — the client needs
    // the constraints, the server needs the tables — so nothing but a test
    // stops one growing a slot the other has never heard of. A slot with no
    // owner would validate, reach the service, and 422 with "Unknown slot".
    expect(Object.keys(media.OWNERS).sort()).toEqual(siteSettings.SITE_MEDIA_SLOT_IDS.sort());
  });

  test("every slot is an evidence slot, so none of them accepts generated imagery", () => {
    // §1.3's list is leadership portraits, entity covers and service covers.
    // The two MARK slots are here as well, and deliberately: a generated
    // version of another company's trademark is a worse failure than a
    // generated portrait, not a lesser one. If a later PR adds an ATMOSPHERE
    // slot — the one place generated imagery is legitimate — this test is the
    // thing that has to be updated deliberately rather than discovered.
    for (const [slot, spec] of Object.entries(siteSettings.SITE_MEDIA_SLOTS)) {
      expect(`${slot}:${spec.evidence}`).toBe(`${slot}:true`);
    }
  });

  test("the two slots that sit on a dark band require transparency", () => {
    // O-3. A carrier's mark and a certifier's mark are the ones §9.4 puts on a
    // dark ground; a portrait and an entity cover are photographs on their own
    // plate and are supposed to be opaque.
    expect(siteSettings.SITE_MEDIA_SLOTS["partner-mark"].transparent).toBe(true);
    expect(siteSettings.SITE_MEDIA_SLOTS["credential-mark"].transparent).toBe(true);
    expect(siteSettings.SITE_MEDIA_SLOTS["leader-portrait"].transparent).toBe(false);
    expect(siteSettings.SITE_MEDIA_SLOTS["entity-cover"].transparent).toBe(false);
  });

  test("SVG is not an accepted type", () => {
    // The vault's sniffer works on magic bytes and SVG has none, so `sniff:
    // true` would have to be turned off for exactly the format that most needs
    // it — and an SVG served from this origin is markup the browser executes.
    // §9.4's "SVG or transparent PNG @2x" is answered by the second half.
    expect(media.IMAGE_TYPES).not.toContain("image/svg+xml");
    expect(media.IMAGE_TYPES).toEqual(["image/png", "image/jpeg", "image/webp"]);
  });
});

/* ── §1.3, in the service ───────────────────────────────────────────────────*/

describe("provenance", () => {
  const client = { async query() { return { rows: [], rowCount: 0 }; } };

  test("refuses a generated image for an evidence slot, and says why", async () => {
    await expect(
      media.upload(client, {
        slot: "leader-portrait",
        ownerId: "11111111-1111-1111-1111-111111111111",
        dataUrl: "data:image/png;base64,AAAA",
        provenance: "generated",
      }),
    ).rejects.toMatchObject({
      status: 422,
      // The MESSAGE matters as much as the refusal: an administrator who is
      // told "invalid provenance" uploads the same file again under a
      // different word.
      message: expect.stringContaining("§1.3"),
    });
  });

  test("the refusal happens before the file is even parsed", async () => {
    // Ordering, not politeness: it means a 40 MB generated portrait is refused
    // without being base64-decoded into memory first. The data URL below is not
    // a valid image, and a run that reached `parseDataUrl` would fail with
    // BAD_FILE_TYPE instead.
    await expect(
      media.upload(client, {
        slot: "entity-cover",
        ownerId: "11111111-1111-1111-1111-111111111111",
        dataUrl: "not-a-data-url",
        provenance: "generated",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("an unknown slot is refused rather than looked up", async () => {
    await expect(
      media.upload(client, { slot: "hero-atmosphere", ownerId: "x", provenance: "owned" }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

/* ── the shared schema, which is what the route actually validates ──────────*/

describe("the upload body", () => {
  const valid = {
    slot: "partner-mark",
    owner_id: "11111111-1111-1111-1111-111111111111",
    provenance: "owned",
    data_url: "data:image/png;base64,AAAA",
  };
  const parse = (patch) => siteSettings.siteMediaUpload.safeParse({ ...valid, ...patch });

  test("accepts a complete body", () => {
    expect(parse({}).success).toBe(true);
  });

  test("refuses a slot outside the register", () => {
    expect(parse({ slot: "service-cover" }).success).toBe(false);
  });

  test("refuses a provenance outside §1.3's three words", () => {
    expect(parse({ provenance: "stock" }).success).toBe(false);
  });

  test("requires a provenance at all — §6.3 makes it a required field", () => {
    const { provenance, ...without } = valid;
    expect(siteSettings.siteMediaUpload.safeParse(without).success).toBe(false);
  });

  test("refuses an unknown field rather than ignoring it", () => {
    // `.strict()`. A body carrying `is_active: true` alongside an upload would
    // otherwise be silently dropped, which reads to the caller as accepted.
    expect(parse({ is_active: true }).success).toBe(false);
  });
});

/* ── the variant resolver: what it refuses ──────────────────────────────────*/

describe("resolveVariant", () => {
  const doc = {
    storage_path: "tenant_smartls/vault/doc_abc123.png",
    public_media_variants: { widths: [480, 960], formats: ["avif", "webp"] },
  };

  test("resolves a width and format the row actually records", () => {
    expect(media.resolveVariant(doc, "960", "avif")).toEqual({
      key: "tenant_smartls/vault/doc_abc123@960.avif",
      contentType: "image/avif",
    });
  });

  test("refuses a width that was never written", () => {
    // sharp never upscales, so a 700 px logo has no 1600 rung. A srcset
    // advertising one would be a 404 per visitor per image.
    expect(media.resolveVariant(doc, "1600", "avif")).toBeNull();
  });

  test("refuses a format that was never written", () => {
    expect(media.resolveVariant(doc, "960", "jxl")).toBeNull();
  });

  test("refuses a document with no ladder at all", () => {
    expect(media.resolveVariant({ ...doc, public_media_variants: null }, "960", "avif")).toBeNull();
  });

  test("no part of the request reaches the key", () => {
    // The width and the format are compared against the recorded arrays BEFORE
    // `variantKey` is called, so there is no path in which a caller's string is
    // concatenated into a storage key. Traversal, absolute paths and a
    // different extension are all simply "not in the list".
    expect(media.resolveVariant(doc, "../../etc/passwd", "avif")).toBeNull();
    expect(media.resolveVariant(doc, "960", "../webp")).toBeNull();
    expect(media.resolveVariant(doc, "960.0", "avif")).toBeNull();
  });
});

describe("variantKey", () => {
  test("replaces the extension rather than appending to it", () => {
    expect(media.variantKey("t/vault/doc_a.png", 480, "webp")).toBe("t/vault/doc_a@480.webp");
    expect(media.variantKey("t/vault/doc_a.jpeg", 1600, "avif")).toBe("t/vault/doc_a@1600.avif");
  });

  test("a key with dots in the directory keeps them", () => {
    // The regex is anchored to the END, so only the real extension moves.
    expect(media.variantKey("t.v1/vault/doc_a.png", 480, "webp")).toBe("t.v1/vault/doc_a@480.webp");
  });
});
