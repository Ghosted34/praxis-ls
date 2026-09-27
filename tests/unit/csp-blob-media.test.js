"use strict";

/**
 * Every attachment kind Smart Comms renders reaches its element as a `blob:`
 * URL, and CSP has to say so for each one SEPARATELY.
 *
 * ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────
 *
 * A chat attachment is membership-gated, so its bytes arrive through an
 * authenticated fetch carrying a Bearer token and are handed to the element as
 * an object URL — a plain `src` attribute cannot carry a header. The policy
 * listed `img-src` with `blob:` and said nothing about `media-src`.
 *
 * CSP falls back to `default-src` for a directive it has no value for,
 * `default-src` is `'self'`, and `blob:` is not `'self'`. So every <audio> and
 * every <video> in the product was blocked outright, on every platform:
 *
 *     Loading media from 'blob:https://…' violates the following Content
 *     Security Policy directive: "default-src 'self'". Note that 'media-src'
 *     was not explicitly set, so 'default-src' is used as a fallback.
 *
 * A blocked element reports that as an ordinary media error, which is
 * indistinguishable from a codec the device lacks. "Voice notes don't play"
 * was therefore chased through the recorder, the multipart upload, the storage
 * driver, the response headers, the object-URL technique, the service worker
 * and the browser — each of which was measured and each of which was sound.
 * The listed directive, `img-src`, is precisely why images kept working and
 * kept the real cause hidden.
 *
 * ── WHY THE TEST IS SHAPED LIKE THIS ────────────────────────────────────────
 *
 * Not "media-src contains blob:", which would pin the fix and not the lesson.
 * The defect was a directive that was never WRITTEN DOWN, so what is asserted
 * is that every directive governing something this client loads from a blob is
 * set EXPLICITLY — a silent fallback to `default-src` is the failure, whatever
 * `default-src` happens to say today.
 */

const helmet = require("helmet");
const { buildCspDirectives } = require("../../src/server");

/**
 * Every element the client hands an object URL to, and the fetch-directive
 * that governs it. Adding an attachment kind means adding its row here, which
 * is the point: the list is what a reviewer reads.
 */
const BLOB_CONSUMERS = [
  { element: "<img> — chat photos, lightbox", directive: "img-src" },
  { element: "<audio> — voice notes", directive: "media-src" },
  { element: "<video> — video attachments", directive: "media-src" },
  { element: "<iframe> — vault document preview (PDF/text)", directive: "frame-src" },
];

const directives = () =>
  buildCspDirectives(helmet.contentSecurityPolicy.getDefaultDirectives(), ["'self'"]);

describe("CSP permits the blob: URLs this client actually creates", () => {
  for (const { element, directive } of BLOB_CONSUMERS) {
    it(`sets ${directive} explicitly, so ${element} does not fall back to default-src`, () => {
      const d = directives();
      // Explicitly present. A directive that is merely absent inherits
      // default-src, which is the whole defect.
      expect(Object.keys(d)).toContain(directive);
      expect(d[directive]).toEqual(expect.arrayContaining(["blob:"]));
    });
  }

  /**
   * The fallback that did the damage, asserted directly: if `default-src` ever
   * grew `blob:` the tests above would pass for the wrong reason, and the next
   * directive somebody forgets would be invisible again.
   */
  it("does not rely on default-src carrying blob:", () => {
    expect(directives()["default-src"]).not.toEqual(expect.arrayContaining(["blob:"]));
  });

  /** Only what this product actually plays. Media it fetched itself and holds
   *  in memory — never a remote origin, never a data: URL. */
  it("keeps media-src to same-origin and blobs", () => {
    expect(directives()["media-src"]).toEqual(["'self'", "blob:"]);
  });

  /** Same discipline for frames: `'self'` for the sandboxed srcDoc previews,
   *  `blob:` for the vault document viewer — never a remote origin. */
  it("keeps frame-src to same-origin and blobs", () => {
    expect(directives()["frame-src"]).toEqual(["'self'", "blob:"]);
  });

  it("keeps the script-src the caller computed, hashes and all", () => {
    const scriptSrc = ["'self'", "'sha256-abc='"];
    expect(
      buildCspDirectives(helmet.contentSecurityPolicy.getDefaultDirectives(), scriptSrc)["script-src"],
    ).toBe(scriptSrc);
  });
});

describe("the call noise filter's WebAssembly (calls audit E5)", () => {
  it("script-src allows WebAssembly compilation ('wasm-unsafe-eval'), and still not eval", () => {
    const { buildScriptSrc } = require("../../src/server");
    const src = buildScriptSrc(helmet.contentSecurityPolicy.getDefaultDirectives(), []);
    expect(src).toContain("'wasm-unsafe-eval'");
    expect(src).not.toContain("'unsafe-eval'");
  });
});
