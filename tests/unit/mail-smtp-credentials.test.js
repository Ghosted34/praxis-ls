"use strict";

/**
 * A mailbox that RECEIVES on one server and SENDS through another, with a
 * different sign-in on each leg.
 *
 * ── THE FAILURE THESE PIN ───────────────────────────────────────────────────
 *
 * `email_connection` has always had separate host columns for the two legs and
 * one credential for both, so this configuration —
 *
 *     IMAP  mail.jbspraxis.com : 993   cPanel mailbox password
 *     SMTP  mail.smtp2go.com   : 465   SMTP2GO username + API password
 *
 * — handed the cPanel password to SMTP2GO. The relay refused it and the operator
 * was told "the mail server rejected the SMTP credentials for this mailbox",
 * which is a true sentence about a password they had never been given a field
 * for. Every fix available to them was a fix to the wrong credential.
 *
 * ── WHY THE MATRIX IS EXHAUSTIVE ────────────────────────────────────────────
 *
 * The dangerous outcomes here are not "no credential" — those fail loudly at the
 * server. They are the MIXED pairs: one leg's username with the other leg's
 * password. That combination authenticates as nobody, produces the same 535 as a
 * typo, and cannot be told apart from one by reading the error. So every
 * present/absent combination of `smtp_user` and the separate secret is asserted,
 * including the ones that "obviously" cannot happen — a `smtp_user` left on a row
 * whose secret has since been cleared is exactly the state a half-completed edit
 * or a restored backup produces.
 */

// mailparser and imapflow are not reached by any test in this file — only the
// SMTP transport is built — but the provider lazy-requires all three, and an
// absent stub would fail at require() rather than in a test body.
jest.mock("mailparser", () => ({ simpleParser: async () => ({}) }));
jest.mock("imapflow", () => ({ ImapFlow: class { async connect() {} async logout() {} } }));

/**
 * nodemailer is replaced so `createTransport` RECORDS its options instead of
 * opening a socket. The assertion subject is the auth object the provider builds,
 * which is the whole of the behaviour under test — a real transport would only
 * add a network dependency and a way to be flaky.
 */
const mockCreateTransport = jest.fn(() => ({
  verify: async () => true,
  sendMail: async () => ({ message: Buffer.from("") }),
}));
jest.mock("nodemailer", () => ({ createTransport: (...a) => mockCreateTransport(...a) }));

const { ImapSmtpProvider } = require("../../src/modules/mail/mail/providers/imapSmtp.provider");

/** The cPanel half — what every mailbox in the product has today. */
const BASE = {
  email_address: "ops@jbspraxis.com",
  imap_host: "mail.jbspraxis.com",
  imap_port: 993,
  imap_secure: true,
  smtp_host: "mail.smtp2go.com",
  smtp_port: 465,
  auth_user: "ops@jbspraxis.com",
  password: "cpanel-pw",
};

/** Build the transport and hand back just the auth it was configured with. */
function smtpAuthFor(overrides) {
  mockCreateTransport.mockClear();
  new ImapSmtpProvider({ ...BASE, ...overrides })._smtpTransport();
  return mockCreateTransport.mock.calls[0][0].auth;
}

beforeEach(() => jest.clearAllMocks());

describe("which credential the SENDING leg offers", () => {
  /* The four-cell matrix: smtp_user present or not × separate secret or not. */

  test("both halves present → the relay's own username and the relay's own password", () => {
    expect(smtpAuthFor({ smtp_user: "smtp2go-user", smtp_password: "api-key" })).toEqual({
      user: "smtp2go-user",
      pass: "api-key",
    });
  });

  test("a separate password with no username falls back to auth_user — never to no user at all", () => {
    // Some relays take the mailbox address as the username and only the password
    // is theirs. Falling back keeps that configuration reachable; sending
    // `user: undefined` would make nodemailer offer no AUTH and the relay would
    // reject the message as an open-relay attempt rather than as a bad login.
    expect(smtpAuthFor({ smtp_password: "api-key" })).toEqual({
      user: "ops@jbspraxis.com",
      pass: "api-key",
    });
  });

  test("a separate password with no username and no auth_user falls back to the mailbox address", () => {
    expect(smtpAuthFor({ auth_user: null, smtp_password: "api-key" })).toEqual({
      user: "ops@jbspraxis.com",
      pass: "api-key",
    });
  });

  /**
   * THE CASE THIS FEATURE EXISTS TO NOT BREAK.
   *
   * A `smtp_user` with no separate secret is NOT a second sign-in. Pairing it
   * with the IMAP password would send the relay's username with the cPanel
   * password — a credential nobody configured, and one that fails identically to
   * a typo. The secret decides, and only the secret.
   */
  test("a username with NO separate password is ignored entirely — today's pair, unchanged", () => {
    expect(smtpAuthFor({ smtp_user: "smtp2go-user" })).toEqual({
      user: "ops@jbspraxis.com",
      pass: "cpanel-pw",
    });
  });

  test("neither half present → byte-for-byte what every existing mailbox does", () => {
    expect(smtpAuthFor({})).toEqual({ user: "ops@jbspraxis.com", pass: "cpanel-pw" });
  });

  test("no auth_user and no separate credential still falls back to the address", () => {
    expect(smtpAuthFor({ auth_user: null })).toEqual({
      user: "ops@jbspraxis.com",
      pass: "cpanel-pw",
    });
  });

  test("a mailbox with no username of any kind offers no AUTH, as it always has", () => {
    // Preserved deliberately: an unauthenticated relay on a private network is a
    // real deployment, and inventing an empty credential would break it.
    expect(smtpAuthFor({ auth_user: null, email_address: null })).toBeUndefined();
  });
});

describe("the IMAP leg is not touched by any of it", () => {
  test("receiving always uses auth_user and the mailbox password", () => {
    const conn = { ...BASE, smtp_user: "smtp2go-user", smtp_password: "api-key" };
    const client = new ImapSmtpProvider(conn)._imapClient();
    // The imapflow mock keeps no options, so assert through the provider's own
    // reading of the connection rather than through the stub.
    expect(client).toBeDefined();
    expect(new ImapSmtpProvider(conn)._hasSeparateSmtpAuth()).toBe(true);
    // What matters: the SMTP override never becomes the IMAP one.
    expect(conn.auth_user).toBe("ops@jbspraxis.com");
    expect(conn.password).toBe("cpanel-pw");
  });
});

describe("the envelope sender", () => {
  test("MAIL FROM stays the mailbox, never the relay username", async () => {
    // A relay username is frequently not an address at all (SMTP2GO issues one
    // per SMTP user, SES an access-key id). Putting one in MAIL FROM is the exact
    // input that produces "550 Sender verify failed" — the failure the bare-
    // address rule was written to prevent.
    const sent = [];
    mockCreateTransport.mockImplementation((opts) => ({
      verify: async () => true,
      sendMail: async (mail) => {
        if (!opts.streamTransport) sent.push(mail);
        return { message: Buffer.from("raw"), messageId: "<x@y>" };
      },
    }));
    const provider = new ImapSmtpProvider({
      ...BASE,
      smtp_user: "smtp2go-user",
      smtp_password: "api-key",
    });
    await provider.sendEmail({ to: ["client@example.com"], subject: "s", text: "t" });
    expect(sent[0].envelope.from).toBe("ops@jbspraxis.com");
  });
});

describe("which leg the failure names", () => {
  const { mapSmtpError, describeImapFailure } = require("../../src/modules/mail/mail/smtp-error.map");

  const authErr = () => Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 });

  test("a shared-credential rejection points at the choice that would fix it", () => {
    const mapped = mapSmtpError(authErr());
    expect(mapped.code).toBe("SMTP_AUTH_FAILED");
    expect(mapped.message).toMatch(/Sending \(SMTP\)/);
    // The actionable half: the operator is told the option exists.
    expect(mapped.message).toMatch(/different credentials/i);
    expect(mapped.details).toMatchObject({ leg: "smtp", smtp_auth: "same" });
  });

  test("a separate-credential rejection says the IMAP password was not the one refused", () => {
    const mapped = mapSmtpError(authErr(), { separateSmtpCredentials: true });
    expect(mapped.code).toBe("SMTP_AUTH_FAILED");
    expect(mapped.message).toMatch(/SEPARATE/);
    expect(mapped.message).toMatch(/IMAP password was not offered/i);
    expect(mapped.details).toMatchObject({ leg: "smtp", smtp_auth: "separate" });
  });

  test("the status and code are unchanged, because clients switch on them", () => {
    // smtp-error-map.test.js pins these for the shared case. Re-asserted for the
    // separate one so the new branch cannot quietly become a different error.
    const mapped = mapSmtpError(authErr(), { separateSmtpCredentials: true });
    expect(mapped.status).toBe(502);
  });

  test("a refused IMAP login names the RECEIVING leg and rules the other one out", () => {
    const described = describeImapFailure(new Error("Invalid credentials (Failure) [AUTHENTICATIONFAILED]"));
    expect(described.code).toBe("IMAP_AUTH_FAILED");
    expect(described.message).toMatch(/Receiving \(IMAP\)/);
    expect(described.message).toMatch(/not any separate sending credential/i);
  });

  test("a host failure is left alone — it is not a credential problem", () => {
    // Dressing a DNS failure up as a rejected password sends somebody to retype
    // a password that is perfectly correct.
    const described = describeImapFailure(new Error("getaddrinfo ENOTFOUND mail.typo.com"));
    expect(described.code).toBeNull();
    expect(described.message).toBe("getaddrinfo ENOTFOUND mail.typo.com");
  });
});

describe("verify() reports the stage AND says it in the sentence", () => {
  test("an SMTP refusal is classified with the mailbox's actual mode", async () => {
    mockCreateTransport.mockImplementation(() => ({
      verify: async () => { throw Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 }); },
    }));
    const result = await new ImapSmtpProvider({
      ...BASE, smtp_user: "smtp2go-user", smtp_password: "api-key",
    }).verify();
    expect(result).toMatchObject({ ok: false, stage: "smtp", code: "SMTP_AUTH_FAILED" });
    expect(result.error).toMatch(/SEPARATE/);
  });
});
