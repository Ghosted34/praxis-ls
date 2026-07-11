"use strict";
const email = require("../../src/services/email.service");

// Fake client answering email_identity + settings queries by SQL shape.
function makeClient({ identity = null, settings = {} }) {
  return {
    query: async (sql, _params) => {
      if (/FROM email_identity/.test(sql)) return { rows: identity ? [identity] : [] };
      if (/FROM setting/.test(sql)) return { rows: [{ value: settings }] };
      return { rows: [] };
    },
  };
}

describe("email: per-purpose verified identity, DB-first + env fallback", () => {
  test("resolves From + host from email_identity for the purpose", async () => {
    const client = makeClient({ identity: { purpose: "BILLING", from_address: "billing@acme.cm", from_name: "Acme Billing", smtp_host: "mail.acme.cm", smtp_port: 587, reply_to: "ar@acme.cm" } });
    const cfg = await email.resolveMail(client, { purpose: "BILLING" });
    expect(cfg.from).toBe('"Acme Billing" <billing@acme.cm>');
    expect(cfg.smtp_host).toBe("mail.acme.cm");
    expect(cfg.reply_to).toBe("ar@acme.cm");
    expect(cfg.identity_purpose).toBe("BILLING");
  });

  test("send uses the purpose identity + injected transport", async () => {
    const sent = [];
    const tx = { sendMail: async (m) => { sent.push(m); return { messageId: "1" }; } };
    const client = makeClient({ identity: { purpose: "DOCUMENTS", from_address: "docs@acme.cm", from_name: "Acme Docs", smtp_host: "h" } });
    await email.send(client, { to: "x@y.cm", subject: "Delivery note", purpose: "DOCUMENTS" }, tx);
    expect(sent[0].from).toBe('"Acme Docs" <docs@acme.cm>');
    expect(sent[0].to).toBe("x@y.cm");
  });

  test("explicit from overrides the identity", async () => {
    const sent = [];
    const tx = { sendMail: async (m) => { sent.push(m); return {}; } };
    const client = makeClient({ identity: { purpose: "SUPPORT", from_address: "help@acme.cm", smtp_host: "h" } });
    await email.send(client, { to: "x@y.cm", subject: "Hi", from: "ceo@acme.cm", purpose: "SUPPORT" }, tx);
    expect(sent[0].from).toBe("ceo@acme.cm");
  });

  test("no identity + no SMTP anywhere → refuses to send", async () => {
    const client = makeClient({ identity: null, settings: {} });
    // env SMTP_HOST is empty in test → no host resolvable
    await expect(email.send(client, { to: "a@b.cm", subject: "x", purpose: "NOTIFICATIONS" })).rejects.toThrow(/no sender configured|required/);
  });
});
