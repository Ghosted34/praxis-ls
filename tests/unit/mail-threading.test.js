/**
 * PR-1A: threading, folder mapping, stream classification and the search
 * mini-language. All four modules are pure — headers in, a decision out — which
 * is exactly why they are worth testing exhaustively: these are the decisions
 * that, once written to rows, cannot be un-made.
 *
 * The threading tests in particular guard the failure that has no recovery:
 * merging two clients' correspondence into one conversation.
 */
"use strict";

const threading = require("../../src/modules/mail/mail/threading");
const folders = require("../../src/modules/mail/mail/folders");
const stream = require("../../src/modules/mail/mail/stream");
const search = require("../../src/modules/mail/mail/search");

/* ── threading.js ─────────────────────────────────────────────────────────── */

describe("threadKeyFor: the ladder", () => {
  test("trusts the provider's own thread id only when the adapter claims server threads", () => {
    const m = { providerThreadId: "AAQk123", references: ["<root>"], externalMessageId: "<own>" };
    expect(threading.threadKeyFor(m, { serverThreads: true })).toBe("provider:AAQk123");
    // Same message, an adapter that does NOT have server threads: the id it
    // carries would be one we synthesised, so References wins instead.
    expect(threading.threadKeyFor(m, {})).toBe("<root>");
  });

  test("References[0] is the root of the chain, not the last entry", () => {
    const key = threading.threadKeyFor({ references: ["<root>", "<mid>", "<latest>"], externalMessageId: "<own>" });
    expect(key).toBe("<root>");
  });

  test("falls back to In-Reply-To when the client dropped References", () => {
    expect(threading.threadKeyFor({ inReplyTo: "<parent>", externalMessageId: "<own>" })).toBe("<parent>");
  });

  test("a message with no chain at all is a conversation of one", () => {
    expect(threading.threadKeyFor({ messageIdHeader: "<solo>" })).toBe("<solo>");
    expect(threading.threadKeyFor({ externalMessageId: "uid-42" })).toBe("<uid-42>");
  });

  test("never returns null for a message the adapter gave an id", () => {
    expect(threading.threadKeyFor({ externalMessageId: "  17  " })).toBe("<17>");
  });

  test("normalises angle brackets so <a> and a are the same conversation", () => {
    expect(threading.threadKeyFor({ inReplyTo: "abc@host" })).toBe("<abc@host>");
    expect(threading.threadKeyFor({ inReplyTo: "<abc@host>" })).toBe("<abc@host>");
  });

  test("TWO PEOPLE WRITING 'Re: Invoice' ARE TWO CONVERSATIONS", () => {
    // The bug this whole module exists to prevent. Same subject, no shared
    // reference chain — the keys must differ.
    const a = threading.threadKeyFor({ subject: "Re: Invoice", messageIdHeader: "<from-acme>" });
    const b = threading.threadKeyFor({ subject: "Re: Invoice", messageIdHeader: "<from-bolloré>" });
    expect(a).not.toBe(b);
  });
});

describe("normaliseReferences", () => {
  test("accepts an array, a folded header string, or nothing", () => {
    expect(threading.normaliseReferences(["<a>", "<b>"])).toEqual(["<a>", "<b>"]);
    expect(threading.normaliseReferences("<a>  <b>\r\n <c>")).toEqual(["<a>", "<b>", "<c>"]);
    expect(threading.normaliseReferences(null)).toEqual([]);
  });

  test("de-duplicates, because a long chain repeats its root", () => {
    expect(threading.normaliseReferences("<a> <b> <a>")).toEqual(["<a>", "<b>"]);
  });
});

describe("baseSubject", () => {
  test.each([
    ["Re: Invoice 42", "Invoice 42"],
    ["RE : Invoice 42", "Invoice 42"],
    ["Fwd: Re: Invoice 42", "Invoice 42"],
    ["TR: Facture 42", "Facture 42"],          // French forward
    ["Rép: Facture 42", "Facture 42"],         // French reply
    ["AW: Rechnung 42", "Rechnung 42"],        // German reply
    ["Re[2]: Invoice 42", "Invoice 42"],       // numbered reply counter
    ["Invoice 42", "Invoice 42"],
    ["", ""],
  ])("%s → %s", (input, expected) => {
    expect(threading.baseSubject(input)).toBe(expected);
  });

  test("does not eat a subject that merely starts with those letters", () => {
    expect(threading.baseSubject("Return of goods")).toBe("Return of goods");
    expect(threading.baseSubject("Revision 3 attached")).toBe("Revision 3 attached");
  });
});

describe("foldIntoThread", () => {
  const msg = {
    from: "Client@Acme.CM", to: ["me@co.cm"], cc: ["ops@co.cm"],
    subject: "Re: Demurrage", receivedAt: "2026-08-10T10:00:00Z", attachments: [],
  };

  test("a new thread takes the message's base subject and lowercased participants", () => {
    const f = threading.foldIntoThread(null, msg);
    expect(f.subject).toBe("Demurrage");
    expect(f.participants.sort()).toEqual(["client@acme.cm", "me@co.cm", "ops@co.cm"]);
    expect(f.first_message_at).toEqual(f.last_message_at);
  });

  test("THE FIRST SUBJECT WINS — one person renaming a thread does not rename it for everyone", () => {
    const existing = { subject: "Demurrage", participants: ["client@acme.cm"], first_message_at: "2026-08-10T10:00:00Z", last_message_at: "2026-08-10T10:00:00Z" };
    const f = threading.foldIntoThread(existing, { ...msg, subject: "Re: Demurrage — URGENT!!!" });
    expect(f.subject).toBe("Demurrage");
  });

  test("widens the time window in both directions, never narrows it", () => {
    const existing = { first_message_at: "2026-08-10T10:00:00Z", last_message_at: "2026-08-12T10:00:00Z", participants: [] };
    const earlier = threading.foldIntoThread(existing, { ...msg, receivedAt: "2026-08-09T09:00:00Z" });
    expect(earlier.first_message_at.toISOString()).toBe("2026-08-09T09:00:00.000Z");
    expect(earlier.last_message_at.toISOString()).toBe("2026-08-12T10:00:00.000Z");

    const later = threading.foldIntoThread(existing, { ...msg, receivedAt: "2026-08-14T09:00:00Z" });
    expect(later.first_message_at.toISOString()).toBe("2026-08-10T10:00:00.000Z");
    expect(later.last_message_at.toISOString()).toBe("2026-08-14T09:00:00.000Z");
  });

  test("has_attachment latches on — a thread with one attachment always had one", () => {
    const withDoc = threading.foldIntoThread(null, { ...msg, attachments: [{ filename: "bl.pdf" }] });
    expect(withDoc.has_attachment).toBe(true);
    const after = threading.foldIntoThread({ ...withDoc, has_attachment: true }, msg);
    expect(after.has_attachment).toBe(true);
  });
});

/* ── folders.js ───────────────────────────────────────────────────────────── */

describe("folder mapping", () => {
  test("RFC 6154 special-use flags beat the folder's name", () => {
    // The folder is called "Archive" but the server flags it \Sent. The flag is
    // authoritative — a name list is never finished, a flag is a statement.
    expect(folders.canonicalFor({ path: "Archive", flags: ["\\Sent"] })).toBe("SENT");
  });

  test.each([
    ["Sent", "SENT"], ["Sent Items", "SENT"], ["Sent Mail", "SENT"],
    ["INBOX.Sent", "SENT"], ["Éléments envoyés", "SENT"], ["Gesendete Elemente", "SENT"],
    ["Drafts", "DRAFTS"], ["Brouillons", "DRAFTS"],
    ["Junk", "SPAM"], ["Courrier indésirable", "SPAM"], ["Spam", "SPAM"],
    ["Trash", "TRASH"], ["Corbeille", "TRASH"], ["Deleted Items", "TRASH"],
    ["Archive", "ARCHIVE"], ["INBOX", "INBOX"],
  ])("falls back to the name: %s → %s", (path, expected) => {
    expect(folders.canonicalFor({ path })).toBe(expected);
  });

  test("Gmail's All Mail is recognised and deliberately NOT canonical", () => {
    // It contains every message a second time. Syncing it doubles the mailbox.
    expect(folders.canonicalFor({ path: "[Gmail]/All Mail", flags: ["\\All"] })).toBeNull();
  });

  test("a user's own folder is not forced into a canonical role", () => {
    expect(folders.canonicalFor({ path: "INBOX.Clients.Maersk" })).toBeNull();
  });

  test("only canonical folders sync by default; the rest are recorded, not pulled", () => {
    const rows = folders.mapFolders([
      { path: "INBOX" }, { path: "Sent" }, { path: "INBOX.Clients.Maersk" }, { path: "INBOX.2019" },
    ]);
    const syncable = rows.filter((r) => r.is_syncable).map((r) => r.canonical);
    expect(syncable.sort()).toEqual(["INBOX", "SENT"]);
    expect(rows.find((r) => r.provider_path === "INBOX.2019")).toMatchObject({ is_syncable: false, canonical: null });
  });

  test("two folders claiming the same role: the first wins, the second is demoted", () => {
    // The unique index would reject the second. A demoted folder in the wrong
    // list is recoverable; a sync that dies on a constraint is not.
    const rows = folders.mapFolders([{ path: "Sent" }, { path: "Sent Items" }]);
    const sent = rows.filter((r) => r.canonical === "SENT");
    expect(sent).toHaveLength(1);
    expect(rows.find((r) => r.provider_path === "Sent Items").canonical).toBeNull();
  });

  test("the folder cap never truncates the canonical six", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ path: `INBOX.junk${i}` }));
    const rows = folders.mapFolders([...many, { path: "INBOX" }, { path: "Sent" }, { path: "Trash" }], { limit: 5 });
    const canonical = rows.filter((r) => r.canonical).map((r) => r.canonical);
    expect(canonical.sort()).toEqual(["INBOX", "SENT", "TRASH"]);
  });
});

describe("cursorFor: UIDVALIDITY", () => {
  test("keeps the position when the folder was not renumbered", () => {
    expect(folders.cursorFor({ uidvalidity: 10, last_uid: 42 }, 10)).toEqual({ uidvalidity: 10, last_uid: 42, rescanned: false });
  });

  test("A CHANGED UIDVALIDITY RESETS TO ZERO — the remembered uids mean nothing now", () => {
    expect(folders.cursorFor({ uidvalidity: 10, last_uid: 42 }, 11)).toEqual({ uidvalidity: 11, last_uid: 0, rescanned: true });
  });

  test("a first sync starts at zero and says so", () => {
    expect(folders.cursorFor(null, 7)).toEqual({ uidvalidity: 7, last_uid: 0, rescanned: true });
  });
});

/* ── stream.js ────────────────────────────────────────────────────────────── */

describe("stream classification", () => {
  const autoRule = {
    email_stream_rule_id: "r1", match_kind: "HEADER_VALUE", match_key: "auto-submitted",
    match_value: "auto-(generated|replied)", stream: "SYSTEM", is_active: true,
    reason: "Carries Auto-Submitted, which RFC 3834 reserves for automated mail.",
  };

  test("A KNOWN PARTY IS NEVER SYSTEM MAIL, however many bulk headers it carries", () => {
    const v = stream.classify({
      headers: { "auto-submitted": "auto-generated", "precedence": "bulk", "list-unsubscribe": "<mailto:x>" },
      fromAddress: "ops@acme.cm",
      knownParty: { kind: "client", name: "Acme", is_vip: false },
      rules: [autoRule],
    });
    expect(v.stream).toBe("HUMAN");
    expect(v.reason).toMatch(/Acme/);
    expect(v.rule_id).toBeNull(); // the override is code, not a rule
  });

  test("an unknown sender with an automation header is system mail", () => {
    const v = stream.classify({ headers: { "Auto-Submitted": "auto-generated" }, rules: [autoRule] });
    expect(v).toMatchObject({ stream: "SYSTEM", rule_id: "r1" });
    expect(v.reason).toMatch(/RFC 3834/);
  });

  test("header lookup is case-insensitive across the three shapes adapters return", () => {
    const each = [
      { "AUTO-SUBMITTED": "auto-generated" },
      [{ name: "Auto-Submitted", value: "auto-generated" }],
      new Map([["auto-submitted", "auto-generated"]]),
    ];
    for (const headers of each) {
      expect(stream.classify({ headers, rules: [autoRule] }).stream).toBe("SYSTEM");
    }
  });

  test("an inactive rule is skipped", () => {
    const v = stream.classify({ headers: { "auto-submitted": "auto-generated" }, rules: [{ ...autoRule, is_active: false }] });
    expect(v.stream).toBe("HUMAN");
  });

  test("A MALFORMED TENANT REGEX IS SKIPPED, NOT THROWN — one bad rule cannot stop the sync", () => {
    const bad = { ...autoRule, match_kind: "SUBJECT_REGEX", match_value: "([unclosed" };
    expect(() => stream.classify({ subject: "anything", rules: [bad, autoRule] })).not.toThrow();
    // And the message still reaches the rule AFTER the broken one.
    expect(stream.classify({ subject: "x", headers: { "auto-submitted": "auto-replied" }, rules: [bad, autoRule] }).stream).toBe("SYSTEM");
  });

  test("the residue is HUMAN: an unmet sender is the better mistake to make", () => {
    const v = stream.classify({ fromAddress: "someone@new.cm", subject: "Quote request", rules: [autoRule] });
    expect(v.stream).toBe("HUMAN");
    expect(v.reason).toMatch(/not on record/);
  });

  test("every verdict carries a reason a person can read", () => {
    for (const args of [{}, { knownParty: { kind: "supplier", name: "S" } }, { headers: { "auto-submitted": "auto-generated" }, rules: [autoRule] }]) {
      expect(typeof stream.classify(args).reason).toBe("string");
      expect(stream.classify(args).reason.length).toBeGreaterThan(10);
    }
  });

  test.each([
    ["FROM_DOMAIN", "cpanel\\.example", { fromAddress: "no-reply@cpanel.example" }],
    ["FROM_ADDRESS", "^no-reply@", { fromAddress: "no-reply@anything.cm" }],
    ["SUBJECT_REGEX", "^backup (completed|failed)", { subject: "Backup completed" }],
    ["HEADER_PRESENT", "", { headers: { "list-unsubscribe": "<mailto:x>" } }],
  ])("match kind %s", (match_kind, match_value, message) => {
    const rule = { ...autoRule, match_kind, match_value, match_key: "list-unsubscribe" };
    expect(stream.classify({ ...message, rules: [rule] }).stream).toBe("SYSTEM");
  });
});

/* ── search.js ────────────────────────────────────────────────────────────── */

describe("the search mini-language", () => {
  test("plain text becomes a prefix-matching tsquery so results appear while typing", () => {
    const { filters, tsquery } = search.parseQuery("demurrage container");
    expect(tsquery).toBe("demurrage & container:*");
    expect(filters.from).toEqual([]);
  });

  test.each([
    ["from:client@acme.cm", "from", ["client@acme.cm"]],
    ["to:billing@co.cm", "to", ["billing@co.cm"]],
    ["subject:invoice", "subject", ["invoice"]],
  ])("%s", (q, key, expected) => {
    expect(search.parseQuery(q).filters[key]).toEqual(expected);
  });

  test("folder: and in: are the same operator", () => {
    expect(search.parseQuery("in:sent").filters.folder).toBe("SENT");
    expect(search.parseQuery("folder:TRASH").filters.folder).toBe("TRASH");
  });

  test("an unrecognised folder is searched as text rather than refused", () => {
    const { filters, tsquery } = search.parseQuery("in:nowhere");
    expect(filters.folder).toBeNull();
    expect(tsquery).toBe("in & nowhere:*"); // the colon is stripped, both words stay
  });

  test.each([
    ["is:unread", { unread: true }],
    ["is:read", { unread: false }],
    ["is:starred", { starred: true }],
    ["is:vip", { vip: true }],
    ["has:attachment", { hasAttachment: true }],
    ["stream:system", { stream: "SYSTEM" }],
  ])("%s", (q, expected) => {
    expect(search.parseQuery(q).filters).toMatchObject(expected);
  });

  test("quoted phrases stay together and are not read as operators", () => {
    const { terms } = search.parseQuery('"bill of lading" demurrage');
    expect(terms).toEqual(["bill of lading", "demurrage"]);
  });

  test('a quoted "from:x" is text, not a filter', () => {
    const { filters, terms } = search.parseQuery('"from:someone"');
    expect(filters.from).toEqual([]);
    expect(terms).toEqual(["from:someone"]);
  });

  test("a dangling operator is ignored rather than matching everything", () => {
    const { filters, tsquery } = search.parseQuery("from:");
    expect(filters.from).toEqual([]);
    expect(tsquery).toBeNull();
  });

  test("an unknown operator falls through to plain text", () => {
    const { filters, terms } = search.parseQuery("priority:high");
    expect(filters.label).toBeNull();
    expect(terms).toEqual(["priority:high"]);
  });

  test("relative and absolute dates", () => {
    const abs = search.parseQuery("before:2026-01-15").filters.before;
    expect(abs.toISOString().slice(0, 10)).toBe("2026-01-15");
    const rel = search.parseQuery("newer:7d").filters.after;
    expect(Date.now() - rel.getTime()).toBeGreaterThan(6 * 86400000);
    expect(Date.now() - rel.getTime()).toBeLessThan(8 * 86400000);
  });

  test("an unparseable date is searched as text, not silently dropped", () => {
    const { filters, terms } = search.parseQuery("before:soon");
    expect(filters.before).toBeNull();
    expect(terms).toEqual(["before:soon"]);
  });

  test("operators and free text compose", () => {
    const { filters, tsquery } = search.parseQuery("from:maersk has:attachment in:inbox demurrage");
    expect(filters).toMatchObject({ from: ["maersk"], hasAttachment: true, folder: "INBOX" });
    expect(tsquery).toBe("demurrage:*");
  });

  test("TSQUERY OPERATORS TYPED BY A USER ARE CHARACTERS, NOT SYNTAX", () => {
    // Someone searching for "R&D" must not hand Postgres a broken tsquery.
    expect(search.toTsQuery(["R&D"])).toBe("R & D:*");
    expect(search.toTsQuery(["(hello)"])).toBe("hello:*");
    expect(() => search.parseQuery("!!! & | ( )")).not.toThrow();
    expect(search.parseQuery("!!! & | ( )").tsquery).toBeNull();
  });
});
