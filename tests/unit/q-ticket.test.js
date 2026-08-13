"use strict";
/**
 * Q tickets (MOD-31) — the rules that keep a client's query in the system and
 * inside their own file.
 *
 * Three things here are security, not features, and each has a way of being got
 * wrong that no reviewer would notice: a client raising a ticket against
 * someone else's dossier, a client posting what the UI called an internal note,
 * and a resolved ticket staying resolved after the client says it is not.
 */
const service = require("../../src/modules/operations/q_ticket/q_ticket.service");

/**
 * A fake tenant client. Records what was inserted and answers the handful of
 * queries the service makes, so the rules can be driven without a database.
 */
function fakeClient({ owns = true, ticket = null } = {}) {
  const inserted = [];
  return {
    inserted,
    async query(sql, params) {
      const text = String(sql);
      // `dossier_visible` (0669), not `dossier`: the ownership check reads the
      // view so a client cannot reach a DRAFT file even by id.
      if (/FROM dossier_visible WHERE dossier_id/.test(text))
        return { rows: owns ? [{ "?column?": 1 }] : [] };
      if (/FROM milestone_instance WHERE milestone_instance_id/.test(text)) {
        return {
          rows: [
            {
              code: "CUSTOMS_RELEASED",
              dossier_id: params[0] === "bad-ms" ? "other-dossier" : "d1",
            },
          ],
        };
      }
      if (
        /^\s*SELECT \* FROM q_ticket WHERE/i.test(text) ||
        /FROM q_ticket\b/.test(text)
      ) {
        return { rows: ticket ? [ticket] : [] };
      }
      if (/INSERT INTO "?q_ticket_reply"?/i.test(text)) {
        inserted.push({ table: "q_ticket_reply", sql: text, params });
        return {
          rows: [
            {
              q_ticket_reply_id: "r1",
              is_internal: /true/.test(String(params)),
            },
          ],
        };
      }
      if (/INSERT INTO "?q_ticket"?/i.test(text)) {
        inserted.push({ table: "q_ticket", sql: text, params });
        return {
          rows: [{ q_ticket_id: "t1", dossier_id: "d1", status: "OPEN" }],
        };
      }
      if (/UPDATE q_ticket SET status/.test(text)) {
        inserted.push({ table: "status", params });
        return { rows: [{ q_ticket_id: "t1", status: params[1] }] };
      }
      return { rows: [] };
    },
  };
}

// The service emits events and audits through the shared helper; neither is
// under test here and both need a real schema.
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => {}),
  audit: jest.fn(async () => {}),
  resolveActorId: jest.fn(async () => null),
}));

describe("raising a ticket", () => {
  it("refuses a dossier that is not the client's", async () => {
    const c = fakeClient({ owns: false });
    await expect(
      service.raise(c, {
        dossierId: "d1",
        subject: "Nosy",
        clientId: "someone-else",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(c.inserted).toHaveLength(0);
  });

  it("gives the same NOT_FOUND as a missing file, so existence is not disclosed", async () => {
    const c = fakeClient({ owns: false });
    // A distinct FORBIDDEN here would tell an outsider that the id is real.
    await expect(
      service.raise(c, { dossierId: "d1", subject: "x", clientId: "x" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("allows a staff-raised ticket, which carries no clientId", async () => {
    const c = fakeClient();
    const row = await service.raise(c, {
      dossierId: "d1",
      subject: "Phoned in",
    });
    expect(row.q_ticket_id).toBe("t1");
  });

  it("refuses a milestone that belongs to a different file", async () => {
    const c = fakeClient();
    await expect(
      service.raise(c, {
        dossierId: "d1",
        milestoneInstanceId: "bad-ms",
        subject: "x",
      }),
    ).rejects.toMatchObject({ code: "MILESTONE_MISMATCH" });
  });
});

describe("the thread", () => {
  it("never lets a client post an internal note, whatever the payload says", async () => {
    const c = fakeClient({
      ticket: { q_ticket_id: "t1", dossier_id: "d1", status: "OPEN" },
    });
    await service.reply(c, {
      ticketId: "t1",
      body: "hello",
      fromClient: true,
      internal: true,
      clientId: "c1",
    });
    const reply = c.inserted.find((i) => i.table === "q_ticket_reply");
    // params order follows the insert: [ticket, body, is_from_client, is_internal, ...]
    expect(reply.params[2]).toBe(true); // from the client
    expect(reply.params[3]).toBe(false); // internal forced off
  });

  it("moves an OPEN ticket to IN_PROGRESS when we answer", async () => {
    const c = fakeClient({
      ticket: { q_ticket_id: "t1", dossier_id: "d1", status: "OPEN" },
    });
    await service.reply(c, { ticketId: "t1", body: "on it" });
    expect(c.inserted.find((i) => i.table === "status").params[1]).toBe(
      "IN_PROGRESS",
    );
  });

  it("reopens a RESOLVED ticket when the client replies to it", async () => {
    const c = fakeClient({
      ticket: { q_ticket_id: "t1", dossier_id: "d1", status: "RESOLVED" },
    });
    await service.reply(c, {
      ticketId: "t1",
      body: "still not released",
      fromClient: true,
      clientId: "c1",
    });
    // Closing a query the client does not consider closed is how a ticket
    // system stops reflecting reality.
    expect(c.inserted.find((i) => i.table === "status").params[1]).toBe("OPEN");
  });

  it("leaves a RESOLVED ticket alone when WE add a closing note", async () => {
    const c = fakeClient({
      ticket: { q_ticket_id: "t1", dossier_id: "d1", status: "RESOLVED" },
    });
    await service.reply(c, {
      ticketId: "t1",
      body: "for the record",
      internal: true,
    });
    expect(c.inserted.find((i) => i.table === "status")).toBeUndefined();
  });
});

describe("reading a ticket", () => {
  const ticket = { q_ticket_id: "t1", dossier_id: "d1", status: "OPEN" };

  it("hides internal notes from the client's view", async () => {
    const c = fakeClient({ ticket });
    c.query = async (sql) => {
      if (/FROM q_ticket_reply/.test(String(sql))) {
        return {
          rows: [
            { q_ticket_reply_id: "r1", body: "public", is_internal: false },
            {
              q_ticket_reply_id: "r2",
              body: "red channel, do not tell them",
              is_internal: true,
            },
          ],
        };
      }
      if (/FROM dossier WHERE dossier_id/.test(String(sql)))
        return { rows: [{ ok: 1 }] };
      return { rows: [ticket] };
    };
    const forClient = await service.detail(c, {
      ticketId: "t1",
      clientId: "c1",
      forClient: true,
    });
    const forStaff = await service.detail(c, { ticketId: "t1" });
    expect(forClient.replies.map((r) => r.body)).toEqual(["public"]);
    expect(forStaff.replies).toHaveLength(2);
  });
});
