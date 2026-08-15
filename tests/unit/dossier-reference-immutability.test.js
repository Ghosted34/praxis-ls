"use strict";
/**
 * A file's reference is fixed at the moment it opens.
 *
 * By the time anyone wants to change it, the reference has been printed on a
 * transit order, quoted in an email, and typed into the client's own system.
 * Changing it does not rename the file — it creates a second name for it that
 * only we know about, with nothing recording when the first one stopped being
 * true. So it survives every other kind of edit:
 *
 *   - a status transition (OPEN → IN_PROGRESS → COMPLETED)
 *   - a change of service type — the code half is history, not a live join
 *   - a change of entity — the prefix half likewise
 *   - an explicit attempt to set it, which is refused rather than ignored
 *
 * The last one is the one that needs a service-layer guard: the REST validator
 * has never accepted `ref` (`update` is `create.partial()`, and `create` has no
 * such field), but `service.update` is also called IN PROCESS by the AI action
 * registry and the orchestration handlers, with no zod anywhere near them.
 */
const service = require("../../src/modules/operations/operations_file/operations_file.service");

const OPEN_REF = "SL7Z3K9QW2M4XBSM";

/**
 * Models the dossier read/write path and throws on anything else — a fake that
 * silently answers `[]` makes every assertion after it meaningless.
 */
function fakeClient({ dossier } = {}) {
  const state = { dossier, updates: [], sql: [] };
  return {
    state,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      state.sql.push(s);
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(s)) return { rows: [] };
      if (/^SELECT \* FROM "?dossier"? WHERE "?dossier_id"?/i.test(s)) {
        return { rows: state.dossier ? [state.dossier] : [] };
      }
      if (/^UPDATE "?dossier"?/i.test(s)) {
        state.updates.push({ sql: s, params });
        // Mirror the SET list onto the row so the assertions read real state.
        const cols = [...s.matchAll(/"?([a-z_]+)"?\s*=\s*\$(\d+)/g)].map(([, col, idx]) => [col, params[Number(idx) - 1]]);
        for (const [col, value] of cols) if (col !== "updated_at") state.dossier[col] = value;
        return { rows: [state.dossier] };
      }
      if (/event_log|immutable_ledger|audit|outbox|event_type/i.test(s)) return { rows: [{ id: 1 }] };
      if (/FROM app_user/i.test(s)) return { rows: [{ user_id: null }] };
      if (/service_type_field_set|service_type_field/i.test(s)) return { rows: [] };
      if (/FROM service_type/i.test(s)) return { rows: [] };
      if (/FROM milestone_instance|milestone_template/i.test(s)) return { rows: [] };
      if (/FROM client_master|compliance/i.test(s)) return { rows: [] };
      throw new Error("Unmatched SQL in fakeClient: " + s.slice(0, 180));
    },
  };
}

const openFile = (over = {}) => ({
  dossier_id: "d1",
  ref: OPEN_REF,
  status: "OPEN",
  entity_id: "e1",
  service_type_id: "st1",
  details_json: {},
  ...over,
});

describe("an allocated reference cannot be changed", () => {
  it("refuses an update that carries a different ref", async () => {
    const c = fakeClient({ dossier: openFile() });
    await expect(
      service.update(c, { id: "d1", patch: { ref: "SLAAAAAAAAAAAASM" }, actor: {} }),
    ).rejects.toMatchObject({ code: "REF_IMMUTABLE", status: 422 });
    expect(c.state.dossier.ref).toBe(OPEN_REF);
    expect(c.state.updates).toHaveLength(0);
  });

  it("says so in a way a form can show against the field", async () => {
    const c = fakeClient({ dossier: openFile() });
    await expect(
      service.update(c, { id: "d1", patch: { ref: "XX000000000000YY" }, actor: {} }),
    ).rejects.toMatchObject({ details: { ref: ["already allocated as " + OPEN_REF] } });
  });

  it("refuses even a well-formed reference for the same entity and service", async () => {
    const c = fakeClient({ dossier: openFile() });
    await expect(
      service.update(c, { id: "d1", patch: { ref: "SLQQQQQQQQQQQQSM" }, actor: {} }),
    ).rejects.toMatchObject({ code: "REF_IMMUTABLE" });
  });

  it("lets a client PATCH back the object it read, without writing the column", async () => {
    // The commonest shape of update in the product: read the file, edit one
    // field, send the whole thing back. Failing that would punish correctness.
    const c = fakeClient({ dossier: openFile() });
    const row = await service.update(c, {
      id: "d1",
      patch: { ref: OPEN_REF, bl_mawb: "MAEU123456" },
      actor: {},
    });
    expect(row.ref).toBe(OPEN_REF);
    expect(c.state.updates).toHaveLength(1);
    expect(c.state.updates[0].sql).not.toMatch(/"?ref"?\s*=/);
    expect(c.state.updates[0].sql).toMatch(/bl_mawb/);
  });
});

describe("nothing else about a file touches its reference", () => {
  it("a status transition preserves it", async () => {
    const c = fakeClient({ dossier: openFile() });
    const row = await service.transition(c, { id: "d1", to: "IN_PROGRESS", actor: {} });
    expect(row.ref).toBe(OPEN_REF);
    expect(row.status).toBe("IN_PROGRESS");
    expect(c.state.updates[0].sql).not.toMatch(/"?ref"?\s*=/);
  });

  it("completing a file preserves it", async () => {
    const c = fakeClient({ dossier: openFile({ status: "IN_PROGRESS" }) });
    const row = await service.transition(c, { id: "d1", to: "COMPLETED", actor: {} });
    expect(row.ref).toBe(OPEN_REF);
  });

  it("changing the service type preserves it — the code half is history", async () => {
    const c = fakeClient({ dossier: openFile() });
    const row = await service.update(c, { id: "d1", patch: { service_type_id: "st2" }, actor: {} });
    expect(row.ref).toBe(OPEN_REF);
    expect(row.service_type_id).toBe("st2");
    expect(c.state.updates[0].sql).not.toMatch(/"?ref"?\s*=/);
  });

  it("changing the entity preserves it — the prefix half likewise", async () => {
    const c = fakeClient({ dossier: openFile() });
    const row = await service.update(c, { id: "d1", patch: { entity_id: "e2" }, actor: {} });
    expect(row.ref).toBe(OPEN_REF);
    expect(row.entity_id).toBe("e2");
  });

  it("an ordinary field edit never reaches the column", async () => {
    const c = fakeClient({ dossier: openFile() });
    await service.update(c, { id: "d1", patch: { incoterm: "CIF", pol: "Douala" }, actor: {} });
    expect(c.state.updates[0].sql).not.toMatch(/"?ref"?\s*=/);
    expect(c.state.dossier.ref).toBe(OPEN_REF);
  });
});

describe("a legacy or sequential reference is just as permanent", () => {
  for (const ref of ["SL6721864SM", "SLAS-OPS-2026-0142"]) {
    it(`refuses to rewrite ${ref} onto the new scheme`, async () => {
      const c = fakeClient({ dossier: openFile({ ref }) });
      await expect(
        service.update(c, { id: "d1", patch: { ref: "SL7Z3K9QW2M4XBSM" }, actor: {} }),
      ).rejects.toMatchObject({ code: "REF_IMMUTABLE" });
      expect(c.state.dossier.ref).toBe(ref);
    });

    it(`still lets ${ref} be edited in every other way`, async () => {
      const c = fakeClient({ dossier: openFile({ ref }) });
      const row = await service.update(c, { id: "d1", patch: { vessel_flight: "MSC LEIGH" }, actor: {} });
      expect(row.ref).toBe(ref);
    });
  }
});
