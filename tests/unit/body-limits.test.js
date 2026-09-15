"use strict";

/**
 * The body-size exemptions, pinned.
 *
 * WHY THIS TEST EXISTS. The same defect has been found three times — a CV, a
 * staff file, and every picture on a tenant's website — and each time the
 * symptom was identical and useless: the feature simply did not work, with no
 * field to blame and no message the screen could show, because body-parser
 * raises its 413 BEFORE any application code runs. Nothing failed while the
 * feature was being built, because the developer's test image was small.
 *
 * So this is a gate rather than a regression test. It asserts the two things
 * that were actually wrong each time:
 *
 *   1. The limit covers the cap the feature ADVERTISES, after base64. The
 *      arithmetic is the whole bug: 10 MB of image is 13.4 MB of JSON, so a
 *      12 MB limit still refuses a 10 MB upload, and "we raised it" is not the
 *      same statement as "it works".
 *   2. The route actually matches. A regex that is subtly wrong fails open onto
 *      the 2 MB parser and looks exactly like no fix at all.
 *
 * The parsers are exercised for real, through express, rather than by asserting
 * on the shape of the list — mounting order is half of what makes this work
 * (body-parser sets `req._body` and every later parser bails on it), and only a
 * real request can catch that being got wrong.
 */

const express = require("express");
const request = require("supertest");

const {
  RAISED,
  DEFAULT_LIMIT,
  encodedSize,
  parseLimit,
} = require("../../src/shared/http/body-limits");

/** The parser stack from server.js, in its order, and nothing else. */
function appWithParsers() {
  const app = express();
  for (const group of RAISED) {
    app.use(group.path, express.json({ limit: group.limit }));
  }
  app.use(express.json({ limit: DEFAULT_LIMIT }));
  // Answers only if the body parsed — which is the single fact under test.
  app.use((req, res) => res.status(200).json({ bytes: (req.body.data_url || "").length }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ type: err.type }));
  return app;
}

/** A JSON body carrying `bytes` worth of file as a base64 data URL. */
const bodyFor = (bytes) => ({
  role: "COVER",
  original_name: "photo.webp",
  data_url: "data:image/webp;base64," + "A".repeat(Math.ceil(bytes / 3) * 4),
});

describe("raised body limits", () => {
  it.each(RAISED.map((g) => [g.name, g]))(
    "%s: the limit covers the cap the feature advertises, after base64",
    (_name, group) => {
      expect(parseLimit(group.limit)).toBeGreaterThanOrEqual(
        encodedSize(group.advertises),
      );
    },
  );

  it("the website-images group is the one that needs more than 12mb", () => {
    // Pins the arithmetic that made the first attempt at this fix wrong: the
    // 12mb the CV and staff-file groups use is correct for 8 MB and 6 MB and
    // NOT correct for the 10 MB these screens promise.
    const images = RAISED.find((g) => g.name === "website-images");
    expect(encodedSize(images.advertises)).toBeGreaterThan(12 * 1024 * 1024);
    expect(parseLimit(images.limit)).toBeGreaterThanOrEqual(
      encodedSize(images.advertises),
    );
  });
});

describe("the routes that carry a picture", () => {
  // Every path in the website-images group, and the DELETE that must NOT be in
  // it. `/web/media/:docId` removes one image and carries no body; if the regex
  // swallowed it that would be a 15 MB buffer granted to a route that needs none.
  const COVERED = [
    "/api/tenant/service-types/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0/web/media",
    "/api/v1/tenant/service-types/abc/web/media",
    "/api/tenant/insights/abc/cover",
    "/api/tenant/insights/abc/gallery",
    "/api/tenant/site-settings/media",
    "/api/tenant/success-stories/abc/media",
  ];
  const NOT_COVERED = [
    "/api/tenant/service-types/abc/web/media/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
    "/api/tenant/service-types/abc/web",
    "/api/tenant/service-types",
    "/api/tenant/invoices",
  ];

  // 4 MB: an ordinary phone photograph, comfortably over the 2 MB global limit
  // once base64'd and comfortably under the 10 MB the screens advertise. This
  // is the size that used to fail, so it is the size the test sends.
  const PHOTO = 4 * 1024 * 1024;

  it.each(COVERED)("accepts a 4 MB photograph on %s", async (path) => {
    const res = await request(appWithParsers()).post(path).send(bodyFor(PHOTO));
    expect(res.status).toBe(200);
  });

  it.each(NOT_COVERED)("leaves %s on the 2 MB global parser", async (path) => {
    const res = await request(appWithParsers()).post(path).send(bodyFor(PHOTO));
    expect(res.status).toBe(413);
    expect(res.body.type).toBe("entity.too.large");
  });

  it("still refuses a body past even the raised limit", async () => {
    // The raise is a raise, not a removal. Anything past it is still a 413 —
    // and `document_vault` re-checks the DECODED bytes against the slot's own
    // 10 MB cap well before this point.
    const res = await request(appWithParsers())
      .post("/api/tenant/service-types/abc/web/media")
      .send(bodyFor(20 * 1024 * 1024));
    expect(res.status).toBe(413);
  });
});

describe("the pre-existing exemptions still hold", () => {
  it("takes an 8 MB CV on the careers apply path", async () => {
    const res = await request(appWithParsers())
      .post("/api/tenant/careers/sea-freight-clerk/apply")
      .send(bodyFor(8 * 1024 * 1024));
    expect(res.status).toBe(200);
  });

  it("takes a staff file's documents", async () => {
    for (const path of [
      "/api/tenant/employees",
      "/api/tenant/employees/abc/documents",
    ]) {
      const res = await request(appWithParsers())
        .post(path)
        .send(bodyFor(6 * 1024 * 1024));
      expect(res.status).toBe(200);
    }
  });
});
