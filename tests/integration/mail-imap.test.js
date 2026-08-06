/**
 * Live IMAP/SMTP integration test for ImapSmtpProvider. SKIPPED unless real mail
 * credentials are provided via env — so CI stays hermetic and this only runs when
 * you point it at a server (Greenmail/Dovecot in docker, or a throwaway mailbox):
 *
 *   MAIL_TEST_EMAIL=you@host MAIL_TEST_PASS=secret \
 *   MAIL_TEST_IMAP_HOST=host MAIL_TEST_IMAP_PORT=993 \
 *   MAIL_TEST_SMTP_HOST=host MAIL_TEST_SMTP_PORT=465 \
 *   npx jest tests/integration/mail-imap
 *
 * It verifies the transport, sends a message to itself, and confirms fetchSince
 * ingests it — exercising the real imapflow/nodemailer call shapes that the unit
 * tests mock.
 */
"use strict";

const { ImapSmtpProvider } = require("../../src/modules/mail/providers/imapSmtp.provider");

const HAVE_CREDS = Boolean(process.env.MAIL_TEST_EMAIL && process.env.MAIL_TEST_PASS && process.env.MAIL_TEST_IMAP_HOST);
const run = HAVE_CREDS ? describe : describe.skip;

run("ImapSmtpProvider (live server)", () => {
  const conn = {
    email_address: process.env.MAIL_TEST_EMAIL,
    imap_host: process.env.MAIL_TEST_IMAP_HOST,
    imap_port: Number(process.env.MAIL_TEST_IMAP_PORT) || 993,
    imap_secure: process.env.MAIL_TEST_IMAP_SECURE !== "false",
    smtp_host: process.env.MAIL_TEST_SMTP_HOST || process.env.MAIL_TEST_IMAP_HOST,
    smtp_port: Number(process.env.MAIL_TEST_SMTP_PORT) || 465,
    smtp_secure: process.env.MAIL_TEST_SMTP_SECURE !== "false",
    auth_user: process.env.MAIL_TEST_USER || process.env.MAIL_TEST_EMAIL,
    password: process.env.MAIL_TEST_PASS,
  };
  const provider = () => new ImapSmtpProvider(conn);

  it("verifies IMAP + SMTP connectivity", async () => {
    const r = await provider().verify();
    expect(r.ok).toBe(true);
  }, 30000);

  it("sends a message to itself and fetchSince ingests it", async () => {
    const subject = `praxis-mail-test-${Date.now()}`;
    await provider().sendEmail({ to: conn.email_address, subject, bodyText: "integration test body" });

    let cursor = null;
    let found = null;
    for (let i = 0; i < 12 && !found; i += 1) {
       
      const { messages, nextCursor } = await provider().fetchSince(cursor);
      cursor = nextCursor;
      found = messages.find((m) => m.subject === subject) || null;
       
      if (!found) await new Promise((res) => setTimeout(res, 2500));
    }
    expect(found).toBeTruthy();
    expect(found.direction).toBe("IN");
    expect(found.externalMessageId).toBeTruthy();
  }, 60000);
});
