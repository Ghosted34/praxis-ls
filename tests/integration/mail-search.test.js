/**
 * SEARCH CORRECTNESS (§3.7, §5.9) — FTS finds by subject, body and participant,
 * and respects folder and visibility filters.
 *
 * §3.7's acceptance is "FTS finds by subject, body, participant; respects
 * folder and visibility filters", and §5.9's is the search
 * `from:maersk has:attachment folder:INBOX demurrage` returning the right
 * threads. The parser (`mail/search.js`) and the SQL builder
 * (`thread.repo.listThreads`) were both present and untested against the real
 * query a search box produces — the one named test file for the feature did
 * not exist. This file covers the full path: mini-language string → parsed
 * filters → the SQL that reaches the driver.
 *
 * The mini-language is deliberately forgiving (an unknown operator is searched
 * as text), so the parser assertions pin the forgiving behaviour too — a
 * "correction" that makes `foo:bar` throw would break the box for real users.
 */
"use strict";

const search = require("../../src/modules/mail/mail/search");
const threads = require("../../src/modules/mail/mail/thread.service");

/** Records every statement instead of running it. */
function recorder() {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows: [] };
    },
    sql: () => calls.map((c) => c.text).join("\n---\n"),
    last: () => calls[calls.length - 1],
  };
}

const ACTOR = { user_id: "u-1" };

/* ── The mini-language ─────────────────────────────────────────────────────── */

describe("the search mini-language parses", () => {
  test("free text becomes a tsquery with prefix matching on the last word", () => {
    const p = search.parseQuery("demur");
    expect(p.tsquery).toBe("demur:*");
    const two = search.parseQuery("port charges");
    expect(two.tsquery).toBe("port & charges:*");
  });

  test("tsquery metacharacters are stripped, not escaped, so & means the character", () => {
    const p = search.parseQuery("A & B");
    expect(p.tsquery).toBe("A & B:*");
    expect(() => search.parseQuery("a:b'c")).not.toThrow();
  });

  test("quoted phrases group into a phrase match, not ANDed words", () => {
    // "Quotes group" is the parser's own contract; the tsquery form of a
    // phrase is the documented FOLLOWED BY operator.
    const p = search.parseQuery('"invoice 42" status');
    expect(p.tsquery).toBe("invoice <-> 42 & status:*");
    const last = search.parseQuery('"bill of lading"');
    expect(last.tsquery).toBe("bill <-> of <-> lading:*");
  });

  test("a quoted operator value is the phrase, not a literal quote mark", () => {
    const p = search.parseQuery('subject:"bill of lading"');
    expect(p.filters.subject).toEqual(["bill of lading"]);
    expect(p.tsquery).toBeNull();
  });

  test("from:/to:/subject: land in their filters, lowercased for addresses", () => {
    const p = search.parseQuery("from:Maersk@x.cm to:ops@y.cm subject:BL");
    expect(p.filters.from).toEqual(["maersk@x.cm"]);
    expect(p.filters.to).toEqual(["ops@y.cm"]);
    expect(p.filters.subject).toEqual(["BL"]);
    expect(p.tsquery).toBeNull();
  });

  test("folder:/in: recognise the six canonical folders and nothing else", () => {
    expect(search.parseQuery("folder:INBOX").filters.folder).toBe("INBOX");
    expect(search.parseQuery("in:archive").filters.folder).toBe("ARCHIVE");
    // An unknown folder is not refused — it is searched as text, and the colon
    // is stripped so `folder:promotions` finds either word.
    expect(search.parseQuery("folder:promotions").filters.folder).toBeNull();
    expect(search.parseQuery("folder:promotions").tsquery).toBe("folder & promotions:*");
  });

  test("client:, label:, stream:, is:, has:, before:, after: parse", () => {
    expect(search.parseQuery("client:MAERSK").filters.client).toBe("MAERSK");
    expect(search.parseQuery("label:urgent").filters.label).toBe("urgent");
    expect(search.parseQuery("stream:human").filters.stream).toBe("HUMAN");
    const is = search.parseQuery("is:unread").filters;
    expect(is.unread).toBe(true);
    expect(search.parseQuery("is:read").filters.unread).toBe(false);
    expect(search.parseQuery("is:starred").filters.starred).toBe(true);
    expect(search.parseQuery("is:vip").filters.vip).toBe(true);
    expect(search.parseQuery("has:attachment").filters.hasAttachment).toBe(true);
    expect(search.parseQuery("after:7d").filters.after).toBeInstanceOf(Date);
    expect(search.parseQuery("before:2026-08-19").filters.before).toBeInstanceOf(Date);
  });

  test("a dangling operator is ignored rather than matching everything", () => {
    const p = search.parseQuery("demurrage from:");
    expect(p.filters.from).toEqual([]);
    expect(p.tsquery).toBe("demurrage:*");
  });

  test("an unknown operator is searched as text — forgiving, never an error", () => {
    const p = search.parseQuery("foo:bar");
    expect(p.tsquery).toBe("foo & bar:*");
    expect(p.filters.from).toEqual([]);
  });

  test("a nonsense date is searched as text, not thrown away or thrown", () => {
    const p = search.parseQuery("before:next tuesday");
    expect(p.filters.before).toBeNull();
    expect(p.tsquery).toContain("tuesday:*");
  });

  test("a hostile run of underscores parses instantly, as a dangling operator", () => {
    // CodeQL flagged the first tokeniser draft for a polynomial regex: on
    // `____…____:` the `[a-z_]+` group backtracked once per character, O(n²)
    // over a string the caller controls. With a linear tokeniser this parse
    // completes in milliseconds; a reintroduction of the quadratic pattern
    // blows the suite timeout rather than quietly shipping a DoS.
    const hostile = `${"_".repeat(50000)}:`;
    const started = Date.now();
    const p = search.parseQuery(hostile);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(p.filters.from).toEqual([]);
    expect(p.tsquery).toBeNull();
  });
});

/* ── The call site: the query the driver receives ──────────────────────────── */

describe("the search box reaches the list query (§5.9)", () => {
  test("from:maersk has:attachment folder:INBOX demurrage — every operator lands", async () => {
    const c = recorder();
    await threads.list(c, ACTOR, { q: "from:maersk has:attachment folder:INBOX demurrage" });

    const sql = c.sql();
    // The free-text remainder → FTS over search_tsv (subject A + participants B
    // + body C, per migration 10733), folded the same way the document was.
    expect(sql).toMatch(/search_tsv @@ to_tsquery\('simple', unaccent_safe\(\$\d+\)\)/);
    // The participant half of §3.7: from/to are separate, scoped subqueries.
    expect(sql).toMatch(/m3\.from_address::text ILIKE ANY/);
    expect(sql).toMatch(/t\.has_attachment/);
    expect(sql).toMatch(/m2\.folder = \$\d+/);
    expect(c.last().params).toContain("INBOX");
    expect(c.last().params).toContain("demurrage:*");
    // `from:` is an ARRAY parameter for ILIKE ANY — several addresses may be
    // quoted with several from: operators.
    expect(c.last().params).toContainEqual(["%maersk%"]);
  });

  test("a free-text search finds participants — to: and from: both match", async () => {
    const c = recorder();
    await threads.list(c, ACTOR, { q: "from:ops@maersk.cm" });
    const sql = c.sql();
    expect(sql).toMatch(/m3\.from_address::text ILIKE ANY \(\$\d+\)/);
    expect(c.last().params).toContainEqual(["%ops@maersk.cm%"]);

    const c2 = recorder();
    await threads.list(c2, ACTOR, { q: "to:billing@co.cm" });
    expect(c2.sql()).toMatch(/array_to_string\(m4\.to_address::text\[\], ' '\) ILIKE ANY/);
    expect(c2.last().params).toContainEqual(["%billing@co.cm%"]);
  });

  test("client:MAERSK filters on the bound entity, not on participants", async () => {
    const c = recorder();
    await threads.list(c, ACTOR, { q: "client:MAERSK" });
    const sql = c.sql();
    expect(sql).toMatch(/t\.entity_ref IN \(SELECT 'client:' \|\| cm\.client_id::text FROM client_master cm/);
    expect(sql).toMatch(/cm\.name ILIKE \$\d+/);
    expect(c.last().params).toContain("%MAERSK%");
    // A name filter is not a participant filter: being cc'd on someone else's
    // thread does not make it the client's.
    expect(sql).not.toMatch(/m3\.from_address/);
  });

  test("unread, starred, label, before and after reach the query", async () => {
    const c = recorder();
    await threads.list(c, ACTOR, {
      q: "is:unread is:starred label:urgent before:2026-08-19 after:2026-08-01",
    });
    const sql = c.sql();
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM email_message_state s6/);
    expect(sql).toMatch(/s8\.is_starred/);
    expect(sql).toMatch(/l\.name = \$\d+/);
    expect(sql).toMatch(/t\.last_message_at < \$\d+/);
    expect(sql).toMatch(/t\.last_message_at > \$\d+/);
    expect(c.last().params).toContain("urgent");
  });

  test("subject: goes to the thread subject, and entity_ref stays a URL filter", async () => {
    const c = recorder();
    await threads.list(c, ACTOR, { q: 'subject:"bill of lading"', entity_ref: "client:c-1" });
    const sql = c.sql();
    expect(sql).toMatch(/t\.subject ILIKE \$\d+/);
    expect(sql).toMatch(/t\.entity_ref = \$\d+/);
    expect(c.last().params).toContain("%bill of lading%");
    expect(c.last().params).toContain("client:c-1");
  });

  test("an unquoted subject: takes one word; the rest is free text, as typed", async () => {
    // Gmail-like: `subject:bill of lading` filters the subject on `bill` and
    // searches the rest as words. A phrase needs quotes — pinned here so the
    // forgiving single-word behaviour is a decision, not an accident.
    const c = recorder();
    await threads.list(c, ACTOR, { q: "subject:bill of lading" });
    expect(c.sql()).toMatch(/t\.subject ILIKE \$\d+/);
    expect(c.last().params).toContain("%bill%");
    expect(c.last().params).toContain("of & lading:*");
  });

  test("the list keeps the visibility predicate while searching", async () => {
    // §3.7's second half: "respects folder AND visibility filters". The
    // visibility predicate is asserted against the same builder in
    // mail-visibility-wiring; here we assert the two travel together on the
    // search path specifically.
    const c = recorder();
    await threads.list(c, ACTOR, { q: "demurrage folder:SPAM" });
    const sql = c.sql();
    expect(sql).toMatch(/t\.visibility = 'COMPANY'/);
    expect(sql).toMatch(/email_thread_share/);
    expect(sql).toMatch(/m2\.folder = \$\d+/);
    expect(c.last().params).toContain("SPAM");
  });

  test("the limit is clamped to 200 and ordered vip-first, newest-first", async () => {
    const c = recorder();
    await threads.list(c, ACTOR, { q: "demurrage", limit: 99999 });
    const sql = c.sql();
    expect(sql).toMatch(/LIMIT \$\d+/);
    expect(c.last().params).toContain(200);
    expect(sql).toMatch(/ORDER BY t\.is_vip DESC, t\.last_message_at DESC/);
  });

  test("the cited example returns a row list shape, not raw SQL output", async () => {
    // §5.9 acceptance: the query returns THREADS. The recorder stands in for
    // the database; the row contract here is participants-as-array — the
    // FN-1 shape — because this query crosses the driver boundary.
    const c = {
      query: async () => ({
        rows: [{ email_thread_id: "t1", participants: ["ops@maersk.cm"], subject: "Demurrage" }],
      }),
    };
    const rows = await threads.list(c, ACTOR, { q: "from:maersk has:attachment folder:INBOX demurrage" });
    expect(rows).toHaveLength(1);
    expect(Array.isArray(rows[0].participants)).toBe(true);
  });
});
