"use strict";
const email = require("../../src/services/email.service");

describe("SMTP resolves from settings, not env", () => {
  test("refuses to send with no client and no injected transport", async () => {
    await expect(email.send(null, { to: "a@b.com", subject: "x" })).rejects.toThrow(/no SMTP configured|required/);
  });
  test("uses tenant settings (getSection 'email') to build the transport", async () => {
    const sent = [];
    const fakeTx = { sendMail: async (m) => { sent.push(m); return { messageId: "1" }; } };
    const client = { query: async () => ({ rows: [{ key: "from", value: "ops@tenant.cm" }] }) };
    await email.send(client, { to: "c@d.com", subject: "Hi", html: "<b>x</b>" }, fakeTx);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("c@d.com");
  });
});
