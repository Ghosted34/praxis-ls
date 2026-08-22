"use strict";

/**
 * THE PORTAL'S WIRING, ASSERTED AS SOURCE.
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §5.2, §5.8.
 *
 * Every claim here is about something that cannot be observed by calling the
 * service: whether the ROUTE is pinned to live, whether a limiter is MOUNTED,
 * whether a deleted mechanism is really gone from the tree. Each has a failure
 * mode that is invisible in a passing unit test and expensive in production:
 *
 *   · `req.tenantDb` instead of `req.tenantDbIn("live", …)` — an anonymous
 *     visitor sends `X-Praxis-Env: sandbox` and reads the tenant's sandbox
 *     signatures. Verified as a live defect on the proposal endpoint, which is
 *     why that file carries the same pin and the same comment.
 *   · A missing limiter — `verify_code` is 2^60 and stored in plaintext, so the
 *     limiter is the SOLE defence against enumeration (§3.7). It is
 *     load-bearing, not decoration.
 *   · A surviving prefix match — `stored.startsWith(hash)` on a 4-character
 *     floor is sixteen bits, against a public endpoint.
 *
 * Source-reading tests are the right shape for these: the assertion is "the
 * wiring is present", and wiring is what a refactor silently removes.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const PORTAL = path.join(SRC, "modules/vault/document_verification");

const read = (p) => fs.readFileSync(p, "utf8");

/**
 * The file with its comments removed.
 *
 * Needed because these files DOCUMENT what was deleted — "the prefix match is
 * gone", "there is deliberately no authMiddleware here" — and a grep for the
 * removed mechanism cannot tell an explanation from an implementation. Reading
 * the prose is the point; matching on it is the bug.
 *
 * `(?<!:)//` so a `https://` inside a string literal is not mistaken for the
 * start of a line comment and used to swallow the rest of the line.
 */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<!:)\/\/[^\n]*/g, " ");
const routes = read(path.join(PORTAL, "document_verification.routes.js"));
const controller = read(path.join(PORTAL, "document_verification.controller.js"));
const service = read(path.join(PORTAL, "document_verification.service.js"));

/** Every .js under a directory, recursively. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}
const ALL_SRC = walk(SRC);

describe("§5.8 criterion 7 — the public route is pinned to LIVE", () => {
  test("the controller reads through tenantDbIn(\"live\", …)", () => {
    expect(controller).toMatch(/req\.tenantDbIn\(\s*"live"/);
  });

  test("it never falls back to the header-resolved tenantDb", () => {
    // `req.tenantDb` resolves the environment from `X-Praxis-Env`, which on a
    // route with no session means the anonymous visitor chooses it.
    expect(controller).not.toMatch(/req\.tenantDb\(/);
  });

  test("the precedent it follows still carries the same pin", () => {
    // If proposal_public ever loses this, the reasoning that justifies it here
    // has moved and somebody should notice.
    const proposal = read(path.join(SRC, "modules/sales/proposal_public/proposal_public.routes.js"));
    expect(proposal).toMatch(/tenantDbIn\("live"/);
  });
});

describe("§5.8 criterion 6 — the limiter is mounted, at the specified ceiling", () => {
  test("makeLimiter is imported and named for this surface", () => {
    expect(routes).toMatch(/makeLimiter/);
    expect(routes).toMatch(/name:\s*"signature-verify"/);
  });

  test("60 requests per 15 minutes, as §5.2 specifies", () => {
    expect(routes).toMatch(/max:\s*60/);
    expect(routes).toMatch(/windowMs:\s*15\s*\*\s*60\s*\*\s*1000/);
  });

  test("the limiter is on the route, not merely constructed", () => {
    // A limiter built and never passed to `router.get` is the exact shape of a
    // control that reads present in review and does nothing at runtime.
    expect(routes).toMatch(/router\.get\(\s*"\/:code",\s*limit\b/);
  });

  test("no authMiddleware — a stranger with paper is the whole point", () => {
    expect(code(routes)).not.toMatch(/authMiddleware/);
  });
});

describe("§5.2 — the prefix match is deleted, not merely bypassed", () => {
  test("no hash is compared by prefix anywhere in the portal", () => {
    // The defect was `stored.startsWith(hash)`. The grep is on a hash-shaped
    // receiver rather than on `startsWith` itself: the language resolver uses
    // it legitimately ("en".startsWith), and a test that forbids a String
    // method outright is one somebody deletes the next time it is inconvenient.
    expect(code(service)).not.toMatch(/(?:stored|hash|content_hash|artifact_hash)\s*\.\s*startsWith\s*\(/);
  });

  test("both hash verdicts are exact equality", () => {
    const src = code(service);
    expect(src).toMatch(/now === sig\.content_hash/);
    expect(src).toMatch(/sig\.artifact_hash === vaulted\.content_hash/);
  });

  test("no four-character hash floor survives in the validator", () => {
    // `min(4)` on a hash was sixteen bits of hex on an unlimited public route.
    const validator = code(read(path.join(PORTAL, "document_verification.validator.js")));
    expect(validator).not.toMatch(/min\(4\)/);
    expect(validator).not.toMatch(/hash/);
  });

  test("the lookup is an exact match on the unique-indexed code", () => {
    const repo = read(path.join(SRC, "modules/vault/document_signature/document_signature.repo.js"));
    expect(repo).toMatch(/WHERE verify_code = \$1/);
  });

  test("the caller cannot name the document they want checked", () => {
    // The old endpoint took doc_id / entity_ref FROM THE CALLER, so a
    // "verified" verdict said nothing about the paper in their hand.
    const validator = code(read(path.join(PORTAL, "document_verification.validator.js")));
    expect(validator).not.toMatch(/doc_id/);
    expect(validator).not.toMatch(/entity_ref/);
  });
});

describe("§5.8 criterion 2 — the custom scheme is gone from the tree", () => {
  test("no source file mentions it, in code or in prose", () => {
    // Prose counts: this grep is the acceptance criterion, and a comment
    // containing the literal makes it fail for a reader running it by hand.
    const scheme = ["praxis", "://"].join("");
    const offenders = ALL_SRC.filter((f) => read(f).includes(scheme)).map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  test("pdf.service no longer mints a verify token", () => {
    const pdf = require("../../src/services/pdf.service");
    // It returned a token whose hash was over the RENDERED BYTES — which
    // contain the QR — so it could never have been printed on the document it
    // described. That circularity is the structural defect PR-1 removed.
    expect(pdf.verifyToken).toBeUndefined();
  });

  test("renderAndStore no longer advertises a `verify` field", () => {
    const pdf = read(path.join(SRC, "services/pdf.service.js"));
    expect(pdf).not.toMatch(/verify:\s*verifyToken/);
  });
});

describe("the QR path stays short, because the path length is printed on paper", () => {
  test("the portal is mounted at /v", () => {
    // §3.7 measured it: /v/{code} is 40 characters and 33 modules (0.67mm each
    // in the 22mm the seal allocates). A /public/verify/ prefix is 52
    // characters, costs a whole QR version, and drops to 0.59mm.
    const mod = require("../../src/modules/vault/document_verification/document_verification.routes");
    expect(mod.basePath).toBe("/v");
  });

  test("it is gated on signatures.portal, and that flag is seeded ON", () => {
    const mod = require("../../src/modules/vault/document_verification/document_verification.routes");
    expect(mod.feature).toBe("signatures.portal");
    const migration = read(path.join(ROOT, "migrations/tenant/10780_signature_portal.sql"));
    expect(migration).toMatch(/\('signatures\.portal',\s*'on'/);
  });

  test("the flag has a platform catalogue row, or no tenant can switch it", () => {
    const seed = read(path.join(ROOT, "migrations/seeds/9115_seed_signature_features.sql"));
    for (const key of ["signatures.portal", "signatures.external", "signatures.qes", "signatures.wet"]) {
      expect(seed).toContain(`'${key}'`);
    }
  });
});

describe("the seal and the foot render ONE verification block", () => {
  const kit = read(path.join(SRC, "services/documents/templates/kit.js"));

  test("sealBlock delegates its QR slot to verifyBlock", () => {
    // Two pieces of markup that agree today are two pieces of markup that
    // print the same code at two different sizes tomorrow.
    expect(kit).toMatch(/verifyBlock\(\{\s*code:\s*sig\.code/);
  });

  test("footer ignores a non-object verify argument rather than printing it", () => {
    const k = require("../../src/services/documents/templates/kit");
    const cfg = { show: { qr: true }, language: "en" };
    const legacy = k.footer({ legal_name: "X" }, cfg, "some://legacy/string");
    expect(legacy).not.toContain("some:");
    expect(legacy).not.toContain("legacy");
  });

  test("footer prints the QR and the grouped code when given a real context", () => {
    const k = require("../../src/services/documents/templates/kit");
    const out = k.footer({ legal_name: "X" }, { show: { qr: true }, language: "en" }, {
      url: "https://smartls.praxisls.com/v/A4B7K92MXQ1P",
      code: "A4B7K92MXQ1P",
      qrSvg: "<svg id=\"qr\"></svg>",
    });
    expect(out).toContain("<svg id=\"qr\">");
    expect(out).toContain("A4B7-K92M-XQ1P");
    expect(out).toContain("smartls.praxisls.com");
  });

  test("an unsigned document gets no verification block at all", () => {
    // Honest: there is nothing to verify, and a symbol resolving to a 404
    // teaches readers the tenant's QRs do not work.
    const k = require("../../src/services/documents/templates/kit");
    const out = k.footer({ legal_name: "X" }, { show: { qr: true }, language: "en" }, null);
    expect(out).not.toContain("svg");
    expect(out).toContain("X");
  });
});
