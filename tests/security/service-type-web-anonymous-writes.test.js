/**
 * Anonymous callers must not be able to reach any of the admin web-profile
 * write endpoints. The shape of every route under /service-types/:id/web… is
 * read from `service_type.routes.js`; each one MUST be gated on
 * `requirePermission(MODULE, "edit"|"view")` AND the authMiddleware must
 * run before the permission check.
 *
 * This is a static check (no server is started): if a future route is added
 * without a gate, the test fails before the merge.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const routesFile = path.join(
  __dirname, "../../src/modules/operations/service_type/service_type.routes.js",
);
const src = fs.readFileSync(routesFile, "utf8");

/** Pull every route declaration under /:id/web... as a block of text up to
 *  the closing `)`. The blocks live in the file in a known shape — each
 *  one is `router.<verb>(\n  "/:id/web...",\n  ...\n)`. */
function webBlocks() {
  const out = [];
  const re = /router\.(get|post|put|patch|delete)\(\s*(['"`])(\/:id\/web[^'"`]*)\2/gs;
  let m;
  while ((m = re.exec(src)) !== null) {
    // Find the matching close paren by walking depth.
    const start = m.index;
    let i = src.indexOf("(", start);
    let depth = 0;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (c === "(") depth += 1;
      else if (c === ")") {
        depth -= 1;
        if (depth === 0) { i += 1; break; }
      }
    }
    out.push({ method: m[1].toUpperCase(), path: m[3], body: src.slice(start, i) });
  }
  return out;
}

describe("the Website tab admin endpoints are gated", () => {
  test("router.use(authMiddleware) is mounted before any web route declaration", () => {
    const authIdx = src.indexOf("router.use(authMiddleware)");
    expect(authIdx).toBeGreaterThan(-1);
    const firstWeb = src.indexOf("/:id/web");
    expect(firstWeb).toBeGreaterThan(authIdx);
  });

  test("every /:id/web… route carries a requirePermission gate (or is a view), the auth chain runs first", () => {
    const blocks = webBlocks();
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      // The mount order: authMiddleware (from router.use) → permission → validator? → handler.
      // requirePermission must appear in the chain, AND the module key must be MOD-29.
      expect(block.body).toMatch(/requirePermission\(/);
      // Every non-GET write must declare edit. View-only reads are also gated, on view.
      const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(block.method);
      if (isWrite) {
        expect(block.body).toMatch(/requirePermission\(\s*MODULE\s*,\s*"edit"\s*\)/);
      } else {
        // GET can be view OR edit (publish/unpublish are technically actions; we treat
        // them on edit. GET /web alone is view).
        expect(block.body).toMatch(/requirePermission\(\s*MODULE\s*,\s*"(?:view|edit)"\s*\)/);
      }
    }
  });

  test("no public path is exposed for the admin surface", () => {
    // The admin routes share the service_type router (basePath /service-types, feature 'operations').
    // There must NOT be a public/admin route mounted at the same paths.
    expect(src).not.toMatch(/router\.(get|post|put|patch|delete)\s*\(\s*(['"`])\/public\/services/);
  });
});
