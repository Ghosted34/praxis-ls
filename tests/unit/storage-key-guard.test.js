"use strict";
/**
 * Storage key guard — path traversal (CodeQL js/path-injection, flagged on
 * storage.service.js:119-120).
 *
 * Keys are composed by callers out of request data: an entity id from a route
 * parameter, a tenant slug, a document id. `path.join(base, "../../x")` resolves
 * outside the base, so an unchecked key is a traversal with a file write on the
 * end of it. The guard lives in the storage service because that is the one
 * place every caller and both drivers funnel through.
 */
const storage = require("../../src/services/storage.service");

const TRAVERSALS = [
  "../../etc/passwd",
  "tenant/../../../etc/passwd",
  "/etc/passwd",
  "..",
  "a/../../b",
  "a\\..\\b", // Windows separator
  "a//b", // empty segment
  "\0evil", // null byte
  "",
  "  ",
  ".hidden/x", // must start alphanumeric
];

const LEGITIMATE = [
  "tenant_smartls/entity/123e4567-e89b-12d3-a456-426614174000/logo_light_a1b2c3.png",
  "tenant_smartls/vault/2026/08/doc.pdf",
  "a/b/c.png",
  "plainfile.txt",
];

describe("storage key guard", () => {
  it.each(TRAVERSALS)("rejects %j on read", async (key) => {
    await expect(storage.get(key)).rejects.toMatchObject({
      code: "BAD_STORAGE_KEY",
    });
  });

  it.each(TRAVERSALS)("rejects %j on delete", async (key) => {
    await expect(storage.delete(key)).rejects.toMatchObject({
      code: "BAD_STORAGE_KEY",
    });
  });

  // An absent key on write is the documented "generate a random one" path, so it
  // is excluded here rather than treated as a traversal.
  it.each(TRAVERSALS.filter((k) => k !== ""))(
    "rejects %j on write",
    async (key) => {
      await expect(
        storage.put(Buffer.from("x"), { key, contentType: "text/plain" }),
      ).rejects.toMatchObject({ code: "BAD_STORAGE_KEY" });
    },
  );

  it("still auto-generates a key when none is given", async () => {
    const r = await storage.put(Buffer.from("x"), {
      key: "",
      contentType: "text/plain",
    });
    expect(r.key).toMatch(/^[a-f0-9]{32}$/);
  });

  it.each(LEGITIMATE)("accepts the real key shape %j", (key) => {
    // publicUrl is the cheap surface that proves the charset rule admits these;
    // the drivers are exercised by the rejection cases above.
    expect(storage.publicUrl(key)).toContain(key);
  });

  it("rejects a sibling directory whose name merely extends the base", async () => {
    // "/data/storage-evil" starts with "/data/storage" — a naive startsWith
    // check would let it through, which is why the separator is part of the test.
    await expect(storage.get("../storage-evil/x")).rejects.toMatchObject({
      code: "BAD_STORAGE_KEY",
    });
  });
});
