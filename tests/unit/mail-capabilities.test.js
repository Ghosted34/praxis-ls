/**
 * Provider capability matrix (§3.7).
 *
 * Two claims, and the second is the one that matters:
 *
 *   1. every adapter answers for every capability key, so a caller can trust
 *      `caps.folderMove === false` to mean "no" rather than "nobody said";
 *   2. no feature calls an adapter method its capabilities deny.
 *
 * (2) is what stops §3.5 rule 3 from being decoration. The rule says a missing
 * capability must produce a specific, non-apologetic message — "Moving messages
 * isn't available for this mailbox type" — rather than a button that throws or,
 * worse, silently does nothing. That only holds if the engine asks first.
 */
"use strict";

const { baseCapabilities, CAPABILITY_KEYS } = require("../../src/modules/mail/mail/providers/provider.interface");
const { ImapSmtpProvider } = require("../../src/modules/mail/mail/providers/imapSmtp.provider");
const { MicrosoftGraphProvider } = require("../../src/modules/mail/mail/providers/microsoftGraph.provider");
const { GmailProvider } = require("../../src/modules/mail/mail/providers/gmail.provider");

const CONN = {
  email_connection_id: "c1", email_address: "ops@smartlogistics.cm",
  imap_host: "mail.smartlogistics.cm", smtp_host: "mail.smartlogistics.cm",
};

const token = async () => "tok";
const ADAPTERS = [
  ["imap", () => new ImapSmtpProvider(CONN)],
  ["graph", () => new MicrosoftGraphProvider({ getAccessToken: token })],
  ["gmail", () => new GmailProvider({ getAccessToken: token, emailAddress: CONN.email_address })],
];

describe("every adapter answers for every capability key", () => {
  test("the base set is the whole set, and every value is a real boolean", () => {
    const base = baseCapabilities();
    expect(Object.keys(base).sort()).toEqual([...CAPABILITY_KEYS].sort());
    for (const [k, v] of Object.entries(base)) {
      expect(typeof v).toBe("boolean");
      // Absent would be `undefined` — falsy, and indistinguishable from a
      // deliberate `false` at every call site that uses truthiness.
      expect(v).not.toBeUndefined();
    }
  });

  test.each(ADAPTERS)("%s declares all of them", (_name, make) => {
    const caps = make().capabilities();
    for (const key of CAPABILITY_KEYS) {
      expect(caps).toHaveProperty(key);
      expect(typeof caps[key]).toBe("boolean");
    }
  });

  test.each(ADAPTERS)("%s adds no capability key of its own invention", (_name, make) => {
    // A key nobody else declares is a key no caller will check, which is how a
    // provider-specific path gets in through the side door (§3.5 rule 2).
    expect(Object.keys(make().capabilities()).sort()).toEqual([...CAPABILITY_KEYS].sort());
  });
});

describe("IMAP is the reference implementation (§3.5 rule 1)", () => {
  const caps = new ImapSmtpProvider(CONN).capabilities();

  test("it can do the things the programme's features actually need", () => {
    expect(caps.folders).toBe(true);      // multi-folder sync (Q3)
    expect(caps.folderMove).toBe(true);   // move to Archive/Trash
    expect(caps.serverFlags).toBe(true);  // \Seen round-trips to the server
    expect(caps.appendSent).toBe(true);   // SMTP files no Sent copy for us
  });

  test("and honestly says no to the two we deliberately do not use", () => {
    // Q11: no provider draft sync in this programme. Q7: search is Postgres FTS.
    expect(caps.serverDrafts).toBe(false);
    expect(caps.serverSearch).toBe(false);
  });
});

describe("no feature calls a method its capabilities deny", () => {
  const threads = require("../../src/modules/mail/mail/thread.service");

  const THREAD = {
    email_thread_id: "t1", email_connection_id: "c1",
    messages: [{ email_message_id: "m1", external_message_id: "<x>" }],
  };

  /** A connection whose adapter denies everything, and counts what is tried. */
  function stub(caps) {
    const tried = [];
    jest.spyOn(require("../../src/modules/mail/mail/mail.repo"), "getConnection")
      .mockResolvedValue({ email_connection_id: "c1", status: "CONNECTED", provider: "imap_smtp" });
    jest.spyOn(require("../../src/modules/mail/mail/mail.service"), "resolveAdapter")
      .mockResolvedValue({
        capabilities: () => ({ ...baseCapabilities(), ...caps }),
        markAsRead: async (id) => tried.push(["markAsRead", id]),
        moveMessage: async (id) => tried.push(["moveMessage", id]),
      });
    return tried;
  }

  afterEach(() => jest.restoreAllMocks());

  test("markAsRead is not attempted when serverFlags is false", async () => {
    const tried = stub({ serverFlags: false });
    const out = await threads.propagateToServer({}, THREAD, async (a, m) => a.markAsRead(m.external_message_id), "serverFlags");
    expect(out).toEqual({ skipped: "serverFlags" });
    expect(tried).toHaveLength(0);
  });

  test("and IS attempted when it is true", async () => {
    const tried = stub({ serverFlags: true });
    await threads.propagateToServer({}, THREAD, async (a, m) => a.markAsRead(m.external_message_id), "serverFlags");
    expect(tried).toEqual([["markAsRead", "<x>"]]);
  });

  test("moveMessage is not attempted when folderMove is false", async () => {
    const tried = stub({ folderMove: false });
    const out = await threads.propagateToServer({}, THREAD, async (a, m) => a.moveMessage(m.external_message_id), "folderMove");
    expect(out).toEqual({ skipped: "folderMove" });
    expect(tried).toHaveLength(0);
  });

  test("an absent capability key is treated as denied, not as permitted", async () => {
    // The reason baseCapabilities declares every key: `caps.folderMove` being
    // undefined must not read as "go ahead".
    const tried = stub({});
    jest.spyOn(require("../../src/modules/mail/mail/mail.service"), "resolveAdapter")
      .mockResolvedValue({ capabilities: () => ({}), moveMessage: async (id) => tried.push(["moveMessage", id]) });
    const out = await threads.propagateToServer({}, THREAD, async (a, m) => a.moveMessage(m.external_message_id), "folderMove");
    expect(out).toEqual({ skipped: "folderMove" });
    expect(tried).toHaveLength(0);
  });

  test("the two real call sites name the capability they need", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.resolve(__dirname, "../../src/modules/mail/mail/thread.service.js"), "utf8");
    expect(src).toMatch(/markAsRead[\s\S]{0,80}"serverFlags"/);
    expect(src).toMatch(/moveMessage[\s\S]{0,120}"folderMove"/);
  });

  test("gmail and graph keep their adapters (§3.5 rule 2)", () => {
    // They are gated OFF by the mail.provider.oauth flag, not deleted. A future
    // tidy-up that "removes the unused providers" would take the Phase-2 work
    // with it, so this is a tripwire rather than a behaviour check.
    expect(new MicrosoftGraphProvider({ getAccessToken: token }).capabilities().push).toBe(true);
    expect(new GmailProvider({ getAccessToken: token, emailAddress: "a@b.cm" }).capabilities().delta).toBe(true);
  });
});
