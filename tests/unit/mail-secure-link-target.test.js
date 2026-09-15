"use strict";

/**
 * A SECURE LINK POINTS AT A DOCUMENT, AND THE FIELD HAS TO SAY SO.
 *
 * `target_ref` was `z.string().min(1).max(200)`, and `target_kind` is
 * `VAULT_DOC` and nothing else — so the value is always a document uuid, and
 * `mint` uses it as one: `assertDocumentAccess` → `document_vault.repo.get`,
 * whose `WHERE doc_id = $1` casts it.
 *
 * The mint dialog asked, in a text box, for "the vault document id this link
 * should serve". Nobody knows a document's uuid, so the box got the document's
 * NAME, the string reached Postgres, and 22P02 came back as "One of the values
 * is in the wrong format" — a sentence that names neither the field that was
 * wrong nor what a right one looks like. The screen now picks the document; this
 * is the backstop for an API caller and for a paste that lost characters, and it
 * has to answer with something actionable rather than a database error.
 *
 * The validator is exercised where it lives — the layer on the route — rather
 * than by rebuilding the schema here, which would only prove the test's copy of
 * it right.
 */

const routes = require("../../src/modules/mail/triage/triage.routes");

/**
 * The `body(...)` middleware on POST /secure-links, called directly.
 *
 * Taken as the layer immediately before the route handler — this file's
 * convention, and the only one that can be picked WITHOUT running the auth and
 * feature middleware in front of it (both are async and reject rather than
 * calling `next`, which would fail the run somewhere other than the assertion).
 * If it is ever not the validator, the assertions below say so.
 */
function validator() {
  const layer = routes.router.stack.find(
    (l) => l.route && l.route.path === "/secure-links" && l.route.methods.post,
  );
  expect(layer).toBeDefined();
  return layer.route.stack[layer.route.stack.length - 2].handle;
}

/** Run one middleware synchronously and return whatever it passed to `next`. */
function call(handle, body) {
  let out;
  handle({ body }, {}, (e) => { out = e; });
  return out;
}

const DOC = "11111111-2222-3333-4444-555555555555";

describe("minting a secure link", () => {
  test("a document NAME is refused with a sentence, not a 22P02", () => {
    const err = call(validator(), { target_kind: "VAULT_DOC", target_ref: "Test pdf" });
    expect(err).toBeTruthy();
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.status).toBe(422);
    // The message has to tell the operator what to do instead. `details` is the
    // per-field map `errMsg` unpacks into the banner.
    expect(err.details.target_ref.join(" ")).toMatch(/document/i);
  });

  test("a document id is accepted", () => {
    expect(call(validator(), { target_kind: "VAULT_DOC", target_ref: DOC })).toBeUndefined();
  });

  test("a truncated id is refused too — the paste that lost a character", () => {
    expect(call(validator(), { target_kind: "VAULT_DOC", target_ref: DOC.slice(0, -1) })).toBeTruthy();
  });
});
