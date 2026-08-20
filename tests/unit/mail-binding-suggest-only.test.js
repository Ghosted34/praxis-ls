"use strict";

const binding = require("../../src/modules/mail/binding/binding.service");

function client(handlers) {
  return {
    query: jest.fn(async (sql, params) => {
      for (const [re, fn] of handlers) {
        if (re.test(sql)) return fn(sql, params);
      }
      return { rows: [] };
    }),
  };
}

describe("ingest never writes entity_ref while auto-accept is off", () => {
  test("suggestions are inserted; thread.entity_ref is not updated for a new match", async () => {
    const updates = [];
    const inserts = [];
    const c = client([
      [/FROM setting|getSetting/, () => ({ rows: [{ value: { auto_accept_threshold: null } }] })],
      [/FROM dossier/, () => ({ rows: [{ dossier_id: "d1", ref: "SLAS-2026-0042" }] })],
      [/FROM invoice/, () => ({ rows: [] })],
      [/client_master|client_contact/, () => ({ rows: [] })],
      [/FROM email_thread WHERE/, () => ({ rows: [{ entity_ref: null }] })],
      [/INSERT INTO email_binding_suggestion/, (_s, p) => { inserts.push(p); return { rows: [{}] }; }],
      [/UPDATE email_thread SET entity_ref/, (_s, p) => { updates.push(p); return { rows: [{}] }; }],
    ]);

    jest.spyOn(require("../../src/shared/config/settings"), "getSetting")
      .mockResolvedValue({ auto_accept_threshold: null });

    await binding.suggestOnIngest(c, {
      threadId: "t1",
      fromAddress: "x@y.cm",
      subject: "SLAS-2026-0042",
    });

    expect(inserts.length).toBeGreaterThan(0);
    expect(updates.filter((p) => p[1] && p[1].startsWith("dossier:"))).toHaveLength(0);
  });
});
