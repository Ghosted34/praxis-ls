"use strict";
/**
 * Adding a field to a draft field set — the REAL repo, not a mock of it.
 *
 * Reported live, NOTICE, from the tenant console:
 *
 *   FIELD_NOT_WRITABLE: data_type, facet_role, group_code, key, label_en,
 *                       label_fr, seq
 *   POST /api/tenant/service-types/:id/field-sets/:setId/fields  → 422
 *
 * The cause was one wrong argument. `insertField` filters the payload through
 * `FIELD_WRITABLE`, then hands the result — plus the parent key — to
 * `insertOne(..., INSERT_WRITABLE)`. `INSERT_WRITABLE` was
 * `new Set(["service_type_field_set_id"])`, and `assertWritable` checks EVERY
 * key of the object it is given, not just the ones the caller supplied. So the
 * allow-list rejected the very columns the repo had just cleaned and approved,
 * and creating a field was impossible on every tenant, always. `updateField`
 * passes `FIELD_WRITABLE` and worked fine, which is why editing a field looked
 * normal and only adding one failed.
 *
 * WHY THIS TEST EXISTS AND THE EXISTING ONES DID NOT CATCH IT.
 * tests/unit/service-type-fields.test.js mocks the whole repo module — it
 * governs the service's versioning rules, which is a different question — so
 * `insertField` never ran. A 100%-green suite and a feature that had never once
 * worked, at the same time. These tests call the real repo and let a fake
 * client record what reached the database.
 */

const repo = require("../../src/modules/operations/shipment_details/shipment_details.repo");

const SET = "22222222-2222-2222-2222-222222222222";

/** Records the statement instead of running it, and answers with a plausible
 *  row so callers that read the result keep working. */
function recordingClient() {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      return { rows: [{ service_type_field_id: "f1" }], rowCount: 1 };
    },
  };
}

/** What the UI actually posts for a new text field. */
const payload = {
  group_code: "DETAILS",
  seq: 10,
  key: "bl_number",
  label_fr: "Numéro BL",
  label_en: "BL number",
  data_type: "TEXT",
  // A real value from chk_stf_facet_role — the same row was inserted against a
  // live tenant schema to confirm the statement this builds actually executes.
  facet_role: "TRANSPORT_REF",
};

describe("shipment_details.repo.insertField", () => {
  test("writes the field instead of answering FIELD_NOT_WRITABLE", async () => {
    const client = recordingClient();
    await expect(repo.insertField(client, SET, payload)).resolves.toBeTruthy();
  });

  test("every posted property reaches the INSERT, with the parent key", async () => {
    const client = recordingClient();
    await repo.insertField(client, SET, payload);

    const { text, params } = client.calls[0];
    expect(text).toMatch(/^INSERT INTO service_type_field \(/);
    for (const col of Object.keys(payload)) {
      expect(text).toContain(`"${col}"`);
    }
    expect(text).toContain('"service_type_field_set_id"');
    // The parent key is the repo's own, taken from the argument and never from
    // the payload — first column, first parameter.
    expect(params[0]).toBe(SET);
    expect(params).toEqual(expect.arrayContaining(Object.values(payload)));
  });

  test("a caller cannot smuggle in a column that is not a field property", async () => {
    // The allow-list still has to be an allow-list. `is_system` marks a field
    // the tenant may not delete; if a payload could set it, a tenant could mint
    // undeletable fields.
    const client = recordingClient();
    await repo.insertField(client, SET, {
      ...payload,
      is_system: true,
      service_type_field_id: "attacker-chosen",
    });

    const { text } = client.calls[0];
    expect(text).not.toContain('"is_system"');
    // The pk appears nowhere but the parent FK, whose name merely starts alike.
    expect(text).not.toMatch(/"service_type_field_id"/);
  });

  test("the two allow-lists cannot drift — insert accepts everything update does", () => {
    // Guards the shape of the fix as much as the fix: INSERT_WRITABLE is
    // derived from FIELD_WRITABLE. Re-listing the columns by hand is how this
    // broke, and how it would break again when a column is added to one list.
    const src = require("fs").readFileSync(
      require.resolve("../../src/modules/operations/shipment_details/shipment_details.repo"),
      "utf8",
    );
    expect(src).toMatch(/INSERT_WRITABLE\s*=\s*new Set\(\[\s*\.\.\.FIELD_WRITABLE/);
  });
});
