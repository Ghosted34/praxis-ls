/**
 * `highlights_fr` / `highlights_en` are jsonb, and the values reaching them
 * must be JSON.
 *
 * THE DEFECT. `upsertProfile` passed the patch value straight through as a
 * query parameter. node-postgres serialises a JS array as a POSTGRES ARRAY
 * LITERAL — `{"a","b"}` — which is not JSON, so casting it to jsonb raises
 * 22P02 and the API answers `400 INVALID_VALUE`, "One of the values is in the
 * wrong format". Every save carrying highlights failed that way, and the
 * message named no field, so it read as a mystery rejection of a page of copy.
 *
 * `gallery_vault_ids` is `uuid[]`, where the raw array is exactly right — so
 * this is per-column, not "stringify every array", and that is the distinction
 * the tests below hold.
 */
"use strict";

const repo = require("../../src/modules/operations/service_type_web/service_type_web.repo");

const ST = "b58cef10-092a-4ad0-b2ef-02eedf22fb6e";
const GALLERY = "22222222-2222-4222-8222-222222222222";

/** Capture what the repo would actually send to Postgres. */
function fakeClient() {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      return { rows: [{}], rowCount: 1 };
    },
  };
}

describe("upsertProfile — jsonb columns are sent as JSON", () => {
  test("highlights go to Postgres as a JSON array, not an array literal", async () => {
    const client = fakeClient();
    const highlights = ["Origin collection and inland haulage", "Port handling"];
    await repo.upsertProfile(client, ST, { highlights_en: highlights });

    const { params } = client.calls[0];
    const sent = params[params.length - 1];

    // A string, so node-postgres cannot turn it into `{"a","b"}`.
    expect(typeof sent).toBe("string");
    // And it round-trips as the array the caller passed.
    expect(JSON.parse(sent)).toEqual(highlights);
  });

  test("both languages are covered", async () => {
    const client = fakeClient();
    await repo.upsertProfile(client, ST, {
      highlights_fr: ["Enlèvement à l'origine"],
      highlights_en: ["Origin collection"],
    });
    const { params } = client.calls[0];
    // params[0] is the id; the two highlight columns follow in column order.
    const [, fr, en] = params;
    expect(JSON.parse(fr)).toEqual(["Enlèvement à l'origine"]);
    expect(JSON.parse(en)).toEqual(["Origin collection"]);
  });

  test("an empty highlights list clears the column as `[]`, not as NULL", async () => {
    // The column is NOT NULL DEFAULT '[]'::jsonb — sending null would raise
    // 23502 rather than emptying the list.
    const client = fakeClient();
    await repo.upsertProfile(client, ST, { highlights_en: [] });
    const { params } = client.calls[0];
    expect(params[params.length - 1]).toBe("[]");
  });

  test("gallery_vault_ids stays a real array — the column is uuid[], not jsonb", async () => {
    const client = fakeClient();
    await repo.upsertProfile(client, ST, { gallery_vault_ids: [GALLERY] });
    const { params } = client.calls[0];
    expect(params[params.length - 1]).toEqual([GALLERY]);
  });

  test("text columns are untouched", async () => {
    const client = fakeClient();
    await repo.upsertProfile(client, ST, { short_description_en: "Plain text." });
    const { params } = client.calls[0];
    expect(params[params.length - 1]).toBe("Plain text.");
  });
});
