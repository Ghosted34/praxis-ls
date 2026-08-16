"use strict";

/**
 * Two corrections to the public (unauthenticated) surface — F5, F12, F13, F14.
 *
 * ── 1. THE WEBSITE MUST BE ABLE TO NAME A CORPORATE ENTITY ──────────────────
 * quote_request.service.resolveEntityId falls back to the tenant's only active
 * corporate entity and, when there is more than one, refuses with
 * `422 ENTITY_REQUIRED` and `fields: { entity_id: […] }` — deliberately, so a
 * request is never filed under the wrong company. The public schema was
 * `.strict()` with no `entity_id` in it, so the field the error asks for was
 * the one field the endpoint rejected: on a multi-entity tenant the website's
 * quote form could not submit AT ALL, and nothing the caller sent could fix it.
 * Verified end to end before the fix — one entity: 201; two entities: an
 * unsatisfiable 422.
 *
 * ── 2. AN ANONYMOUS CALLER MUST NOT PICK THE ENVIRONMENT ────────────────────
 * `req.tenantDb` reads the environment from the `X-Praxis-Env` header. On a
 * signed-in request that is the user's LIVE/TEST toggle. On a public route the
 * "user" is the internet: sending `X-Praxis-Env: sandbox` filed a website
 * submission into the tenant's sandbox schema (verified — the row landed in
 * `sandbox.contact_enquiry`) and served sandbox rows to public readers.
 * `req.tenantDbIn("live", …)` is what the careers module already uses, and the
 * four public modules now use it too.
 */

const path = require("path");
const fs = require("fs");
const intakeV = require("../../src/modules/sales/public_intake/public_intake.validator");

describe("F13 public quote intake accepts an entity", () => {
  test("entity_id is accepted, so a multi-entity tenant's site can submit", () => {
    const id = "3f1a5a7e-2c9b-4a2e-9f0a-1d2b3c4d5e6f";
    const parsed = intakeV.schemas.quote.parse({ incoterm: "CIF", entity_id: id });
    expect(parsed.entity_id).toBe(id);
  });

  test("it must still be a uuid, and unknown keys are still refused", () => {
    expect(() => intakeV.schemas.quote.parse({ incoterm: "CIF", entity_id: "acme" })).toThrow();
    expect(() =>
      intakeV.schemas.quote.parse({ incoterm: "CIF", attachment: "data:x" }),
    ).toThrow();
  });

  test("it stays optional — a single-entity tenant sends nothing", () => {
    expect(intakeV.schemas.quote.parse({ incoterm: "CIF" }).entity_id).toBeUndefined();
  });
});

describe("public routes are pinned to the live schema", () => {
  const files = [
    "src/modules/sales/portfolio_public/portfolio_public.routes.js",
    "src/modules/sales/proposal_public/proposal_public.routes.js",
    "src/modules/sales/public_intake/public_intake.routes.js",
    "src/modules/operations/tracking_public/tracking_public.routes.js",
  ];

  test.each(files)("%s never lets the caller choose the environment", (rel) => {
    const src = fs.readFileSync(path.join(__dirname, "../..", rel), "utf8");
    // `req.tenantDb(` — the header-driven one — must not appear. The pinned
    // form `req.tenantDbIn("live",` must, at least once.
    expect(src).not.toMatch(/req\.tenantDb\(/);
    expect(src).toMatch(/req\.tenantDbIn\("live",/);
  });

  test("every public module opts out of feature gating so indexed links survive", () => {
    for (const rel of files) {
      const mod = require(path.join(__dirname, "../..", rel));
      expect(mod.feature).toBeNull();
      expect(mod.basePath).toMatch(/^\/public\//);
    }
  });
});
