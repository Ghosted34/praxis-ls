"use strict";

/**
 * THE PUBLIC SECURE-LINK PREVIEW (review #24) — the sandboxing question, answered.
 *
 * `/s/:token` used to offer a Download button and nothing else, and the header
 * of `secure-link-page.tsx` said why: "an in-app renderer for arbitrary vault
 * bytes is a sandboxing project, not a viewer page." Correct on its own terms,
 * and the wrong outcome — the counterparty being asked to act on a document had
 * to download an unidentified file from an emailed link to discover what it
 * was. That is the exact habit security training exists to break, so the
 * cautious choice was teaching the recipient an unsafe one.
 *
 * Shipping the preview therefore means shipping the sandboxing project, and
 * this file is the part of it that can be checked by machine. It drives the
 * REAL router through supertest — headers on a real response, not a regex over
 * the source — because every claim here is a claim about what a browser will
 * receive.
 *
 * Four things, each of which fails silently if it regresses:
 *
 *   1. ONLY PDFs AND RASTER IMAGES render in place. `text/plain` and
 *      `text/csv`, which the INTERNAL dialog happily frames, are download-only
 *      here: its reader is an authenticated colleague, this one is anybody the
 *      URL was forwarded to.
 *   2. `?disposition=inline` IS A REQUEST, NOT AN INSTRUCTION. The server
 *      decides; an unsupported type silently falls back to `attachment` so the
 *      recipient still gets their file from the same URL.
 *   3. THE PDF RESPONSE CARRIES NO `sandbox`, DELIBERATELY. Chromium will not
 *      start its PDF viewer in a sandboxed frame — that ships a blank pane,
 *      which the recipient cannot tell from a corrupt file. Every other
 *      restriction stays. This is the one test most likely to be "tidied up" by
 *      someone adding `sandbox` back for consistency, so it asserts the absence
 *      explicitly and says why.
 *   4. THE CONTENT TYPE IS REAL. It comes from the storage key's extension,
 *      because `document_vault` HAS NO `content_type` COLUMN — see below.
 */

const express = require("express");
const request = require("supertest");

/**
 * The vault, mocked at the real table's shape.
 *
 * `storage_path` and NOT `content_type`: migration 0340 creates
 * `document_vault` without a content_type column, 0669 adds original_name /
 * client_id / doc_type_ref_id / uploaded_by, 10702 adds only `public_media_*`.
 * The secure-link service used to read `doc.content_type`, which was therefore
 * `undefined` on every row in the product — every recipient was told their
 * document was `application/octet-stream`. A preview cannot be built on that,
 * which is why fixing it came first.
 */
let mockStored = {
  doc_id: "v-1",
  original_name: "Invoice INV-2026-0311.pdf",
  storage_path: "tenant_demo/vault/doc_9f3c1a2b.pdf",
};
let mockBytes = Buffer.from("%PDF-1.4 pretend");

jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  fetchBytes: jest.fn(async () => ({ doc: mockStored, buffer: mockBytes })),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
}));
// The limiter counts per IP across the whole file; 60 requests is plenty for
// this suite, but an express-rate-limit instance also needs no store here.
jest.mock("../../src/shared/http/rate-limit", () => ({
  makeLimiter: () => (_req, _res, next) => next(),
}));

const { errorHandler } = require("../../src/middleware/error-handler");
const routes = require("../../src/modules/mail/public_secure/public_secure.routes");

/** A live, unexpired link row, as `resolve()` would return it. */
const linkRow = () => ({
  secure_link_id: "sl-1",
  label: "Invoice INV-2026-0311",
  target_kind: "VAULT_DOC",
  target_ref: "v-1",
  entity_ref: null,
  view_count: 0,
  expires_at: new Date(Date.now() + 864e5).toISOString(),
  revoked_at: null,
});

function buildApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.tenantDbIn = async (_env, fn) =>
      fn({
        query: async (text) => {
          if (/FROM secure_link/.test(text) && !/INSERT/.test(text)) {
            return { rows: [linkRow()] };
          }
          return { rows: [] };
        },
      });
    next();
  });
  app.use(routes.basePath, routes.router);
  app.use((err, req, res, next) => errorHandler(err, req, res, next));
  return app;
}

const app = buildApp();
const TOKEN = "a".repeat(43);

/** Point the fixture at a different stored file. */
function storeAs(path, buffer = Buffer.from("bytes")) {
  mockStored = { doc_id: "v-1", original_name: `file${path.slice(path.lastIndexOf("."))}`, storage_path: path };
  mockBytes = buffer;
}

beforeEach(() => {
  storeAs("tenant_demo/vault/doc_9f3c1a2b.pdf", Buffer.from("%PDF-1.4 pretend"));
});

/* ── 1 · What may be shown at all ─────────────────────────────────────────── */

describe("the server decides what a stranger's browser may render", () => {
  test("a PDF is previewable, and says so as a KIND rather than a boolean", async () => {
    const res = await request(app).get(`/public/secure/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.preview_kind).toBe("pdf");
    // The type is derived from the storage key, not from a column that does
    // not exist. This is the assertion that would have caught the original bug.
    expect(res.body.data.content_type).toBe("application/pdf");
  });

  test("an image is previewable as an image — a different mechanism, not an iframe", async () => {
    storeAs("tenant_demo/vault/doc_7c11.png");
    const res = await request(app).get(`/public/secure/${TOKEN}`);
    expect(res.body.data.preview_kind).toBe("image");
    expect(res.body.data.content_type).toBe("image/png");
  });

  test.each([
    ["tenant_demo/vault/doc_1.txt", "text/plain"],
    ["tenant_demo/vault/doc_2.csv", "text/csv"],
    ["tenant_demo/vault/doc_3.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["tenant_demo/vault/doc_4.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ])("%s is download-only for an anonymous viewer", async (p, type) => {
    // text/plain and text/csv ARE framed by the internal VaultPreviewDialog.
    // The asymmetry is the point: some browsers content-sniff a text/* body
    // into markup, and this page's reader is whoever the link reached.
    storeAs(p);
    const res = await request(app).get(`/public/secure/${TOKEN}`);
    expect(res.body.data.content_type).toBe(type);
    expect(res.body.data.preview_kind).toBeNull();
  });

  test("an unrecognised extension is inert, not guessed at", async () => {
    storeAs("tenant_demo/vault/doc_5.bin");
    const res = await request(app).get(`/public/secure/${TOKEN}`);
    expect(res.body.data.content_type).toBe("application/octet-stream");
    expect(res.body.data.preview_kind).toBeNull();
  });
});

/* ── 2 · inline is a request, not an instruction ──────────────────────────── */

describe("`?disposition=inline` is a request the server may refuse", () => {
  test("granted for a PDF", async () => {
    const res = await request(app).get(`/public/secure/${TOKEN}/download?disposition=inline`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^inline;/);
  });

  test("REFUSED for a type that may not be framed — and still serves the file", async () => {
    // The recipient of a .docx asked for a preview and gets their document as
    // a download rather than an error. Same URL, no dead end.
    storeAs("tenant_demo/vault/doc_6.docx");
    const res = await request(app).get(`/public/secure/${TOKEN}/download?disposition=inline`);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
  });

  test("the plain download is untouched by any of this", async () => {
    mockStored = {
      doc_id: "v-1",
      original_name: "Invoice INV-2026-0311.pdf",
      storage_path: "tenant_demo/vault/doc_9f3c1a2b.pdf",
    };
    const res = await request(app).get(`/public/secure/${TOKEN}/download`);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="Invoice INV-2026-0311.pdf"');
  });

  test("the filename is still sanitised on the way into the header", async () => {
    mockStored = {
      doc_id: "v-1",
      original_name: 'evil";\r\nX-Injected: yes\r\n\r\n.pdf',
      storage_path: "tenant_demo/vault/doc_9.pdf",
    };
    const res = await request(app).get(`/public/secure/${TOKEN}/download`);
    expect(res.status).toBe(200);
    expect(res.headers["x-injected"]).toBeUndefined();
    expect(res.headers["content-disposition"]).not.toMatch(/\r|\n/);
  });
});

/* ── 3 · The headers a preview actually leans on ──────────────────────────── */

describe("the bytes arrive with their defences on", () => {
  test("nosniff, on every response from this route", async () => {
    const res = await request(app).get(`/public/secure/${TOKEN}/download?disposition=inline`);
    // The one that matters most: it stops a browser re-interpreting a declared
    // type, which is the manoeuvre that turns an inert upload into a live one.
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("a PDF gets NO `sandbox` token — deliberately, and this must not be 'fixed'", async () => {
    // Chromium refuses to instantiate its built-in PDF viewer inside a
    // sandboxed frame: `sandbox=""` renders a blank pane (Brave shows a block
    // page), and `object-src 'none'` closes the <embed> fallback. A preview
    // that renders nothing is worse than no preview, because the recipient
    // cannot distinguish it from a corrupt file.
    const res = await request(app).get(`/public/secure/${TOKEN}/download?disposition=inline`);
    const csp = res.headers["content-security-policy"];
    expect(csp).not.toMatch(/sandbox/);
    // Everything that does NOT break the viewer is still on.
    expect(csp).toMatch(/default-src 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/frame-ancestors 'self'/);
  });

  test("an image DOES get the full sandbox — it needs no viewer", async () => {
    storeAs("tenant_demo/vault/doc_7c11.png");
    const res = await request(app).get(`/public/secure/${TOKEN}/download?disposition=inline`);
    expect(res.headers["content-security-policy"]).toMatch(/sandbox/);
  });

  test("and the page is still unindexable and uncacheable", async () => {
    const res = await request(app).get(`/public/secure/${TOKEN}/download`);
    expect(res.headers["x-robots-tag"]).toMatch(/noindex/);
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });
});

/* ── 4 · None of this opened a new way in ─────────────────────────────────── */

describe("the preview did not widen the door", () => {
  test("a revoked link previews nothing, because it resolves to nothing", async () => {
    const app2 = express();
    app2.use((req, _res, next) => {
      req.tenantDbIn = async (_e, fn) => fn({ query: async () => ({ rows: [] }) });
      next();
    });
    app2.use(routes.basePath, routes.router);
    app2.use((err, req, res, next) => errorHandler(err, req, res, next));

    const meta = await request(app2).get(`/public/secure/${TOKEN}`);
    const inline = await request(app2).get(`/public/secure/${TOKEN}/download?disposition=inline`);
    expect(meta.status).toBe(404);
    expect(inline.status).toBe(404);
    // Same opaque wording for both, so `?disposition=inline` is not an oracle
    // that tells a stranger whether a document was ever there.
    expect(inline.body.error.message).toBe(meta.body.error.message);
  });

  test("still exactly two routes", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/public_secure/public_secure.routes.js"),
      "utf8",
    );
    const paths = [...src.matchAll(/router\.\w+\("([^"]+)"/g)].map((m) => m[1]);
    expect(paths.sort()).toEqual(["/:token", "/:token/download"]);
  });
});
