"use strict";

/**
 * The link tokenizer both sides share, and the route table it reads through.
 *
 * Two things are pinned here that nothing else in the suite can:
 *
 *   · `parseUrl` round-trips EVERY type in `entity-route`'s DETAIL table. The
 *     table is the single source of truth for both directions now — a prefix that
 *     stops matching its own builder is the bug this file exists to make
 *     impossible rather than a bug a reader finds by clicking a chat link to a
 *     404-shaped dashboard.
 *   · what the tokenizer refuses, not only what it accepts. A linkifier's damage
 *     is done by its false positives (`e.g.` turned into a hyperlink teaches
 *     people the underline means nothing) and by what it lets through an `href`
 *     (`javascript:`). Both halves are the contract.
 */

const { linkDetect, entityRoute } = require("@praxis/shared");

// `peelTail` is deliberately not imported: it is a private step of the scan, and
// the only honest way to test it is through `extractLinks`, which is what feeds it
// the whitespace-bounded candidate it assumes.
const { extractLinks, webUrls, entityRefs, normaliseUrl, toAppPath } = linkDetect;
const kinds = Object.keys(entityRoute.DETAIL);

describe("entity-route: the URL table round-trips", () => {
  test.each(kinds)("%s survives build → parse", (type) => {
    const id = "abc-123_DEF";
    const url = entityRoute.urlFor(`${type}:${id}`);
    expect(url).toBeTruthy();
    const back = entityRoute.parseUrl(url);
    expect(back).toMatchObject({ type, id, precision: "record" });
  });

  test("an absolute URL on our own host is the same record as the bare path", () => {
    const ref = "task:11111111-1111-1111-1111-111111111111";
    const path = entityRoute.urlFor(ref);
    expect(entityRoute.parseUrl(path).id).toEqual(entityRoute.parseUrl(`https://smartls.praxisls.com${path}`).id);
  });

  test("a sub-resource of a record is not the record", () => {
    // `/operations/files/<id>` is the file. `/operations/files/<id>/notes` is a
    // tab inside it, and claiming it as the file would send a chat click
    // somewhere the sender never pointed.
    expect(entityRoute.parseUrl("/operations/files/77c1/notes")).toBeNull();
  });

  test("a list landing names no record and says so by returning null", () => {
    for (const path of ["/hr/payroll", "/master/clients", "/"]) {
      expect(entityRoute.parseUrl(path)).toBeNull();
    }
  });

  test("a query-shaped detail route needs its parameter, and ignores a stray one", () => {
    expect(entityRoute.parseUrl("/workspace/tasks")).toBeNull();
    expect(entityRoute.parseUrl("/workspace/tasks?other=x")).toBeNull();
  });

  test("a trailing slash is the same page", () => {
    expect(entityRoute.parseUrl("/operations/files/77c1/")).toEqual(entityRoute.parseUrl("/operations/files/77c1"));
  });

  test("refuses junk without throwing", () => {
    for (const bad of ["", null, undefined, "not a url", "http://", "javascript:alert(1)"]) {
      expect(() => entityRoute.parseUrl(bad)).not.toThrow();
      expect(entityRoute.parseUrl(bad)).toBeNull();
    }
  });
});

/**
 * Pathological input, and the address rules the ReDoS rewrite moved off a regex.
 *
 * CodeQL's `js/redos` flagged the old patterns and it was right to: an anchored
 * `+` class re-tried at every start position is quadratic work, and the string it
 * is quadratic on is a chat message — input the sender controls. The scanner is now
 * one linear pass, and these rules are what prove the change kept the semantics:
 * the same acceptances, the same refusals, and a hostile body that a reader can
 * paste into a channel without making anybody's server sweat.
 */
describe("a message cannot make the scanner quadratic", () => {
  test("ten thousand punctuation marks after a URL still peel in one pass", () => {
    const body = "look https://a.example/x" + "!".repeat(10000) + " ok";
    const links = extractLinks(body);
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe("https://a.example/x");
  });

  test("a wall of percent signs is not an address, and is not a scan", () => {
    expect(extractLinks("%".repeat(20000))).toEqual([]);
    expect(extractLinks("100%".repeat(5000))).toEqual([]);
  });

  test("a wall of at-signs finds nothing", () => {
    expect(extractLinks("@".repeat(20000))).toEqual([]);
    expect(extractLinks("a@".repeat(5000))).toEqual([]);
  });

  test("a path of slashes and a stray letter is trimmed, not retried", () => {
    expect(entityRoute.parseUrl("/operations/files/abc///")).not.toBeNull();
    expect(entityRoute.parseUrl("/operations/files/abc///").id).toBe("abc");
  });
});

describe("the address rules, unchanged by the rewrite", () => {
  const mails = (text) => extractLinks(text).filter((l) => l.kind === "mail").map((l) => l.raw);

  test("a sentence-final period is not part of the address", () => {
    expect(mails("write ops@c.example.")).toEqual(["ops@c.example"]);
  });

  test("a host needs a dot and a lettered TLD of 2–24", () => {
    expect(mails("ping ops@c")).toEqual([]);
    expect(mails("ping ops@c.")).toEqual([]);
    expect(mails("ping ops@c.x")).toEqual([]);
    expect(mails("ping ops@c.ex")).toEqual(["ops@c.ex"]);
  });

  test("the local part keeps what people type and stops at a space", () => {
    expect(mails("mail me at first.last+tag@sub.example.co.uk now")).toEqual(["first.last+tag@sub.example.co.uk"]);
  });

  test("a hyphen ends a host label but never starts the TLD with one", () => {
    expect(mails("ops@team-ops.example.com")).toEqual(["ops@team-ops.example.com"]);
    expect(mails("ops@example.c-m")).toEqual([]);
  });

  test("an address inside a URL stays part of the URL", () => {
    const links = extractLinks("see https://user@host.com/page");
    expect(links.map((l) => l.kind)).toEqual(["web"]);
  });
});

describe("extractLinks: what becomes a link", () => {
  test("the offsets index the sender's characters, for every kind", () => {
    // A renderer slices the body at these offsets, so a wrong `start` silently
    // mis-cuts the sentence and a wrong `end` overlaps the next link — which the
    // dedupe pass then drops, losing links rather than showing them twice.
    const body =
      "see https://a.example/x (and www.b.example/y) or /workspace/tasks?task=9, mail ops@c.example";
    for (const link of extractLinks(body)) {
      expect(body.slice(link.start, link.end)).toBe(link.raw);
    }
    expect(extractLinks(body).map((l) => l.kind)).toEqual(["web", "web", "app", "mail"]);
  });

  test("a scheme or www is required — a bare domain is not enough", () => {
    // `doc.pdf`, `e.g.`, `v1.2` and `192.168.1.1` are ordinary freight prose. A
    // product that underlines half of it teaches people that an underline means
    // nothing, which is the whole reason this rule exists and is asserted here
    // rather than commented.
    for (const text of ["see e.g. this", "the doc.pdf is attached", "v1.2 or later", "ping 192.168.1.1", "Slas.2026 ref"]) {
      expect(extractLinks(text)).toEqual([]);
    }
    expect(extractLinks("https://maersk.com/vessel/1").map((l) => l.kind)).toEqual(["web"]);
    expect(extractLinks("www.maersk.com/vessel/1").map((l) => l.kind)).toEqual(["web"]);
  });

  test("an app route becomes an in-app link with a label", () => {
    const body = `Blockage on "Hold the meeting": Lights out!\n/workspace/tasks?task=4f873a78-9790-460d-8555-1eed520e67ae`;
    const [link] = extractLinks(body);
    expect(link).toMatchObject({
      kind: "app",
      label: "Task",
      entity: { type: "task", id: "4f873a78-9790-460d-8555-1eed520e67ae" },
    });
    // The offsets index the SENDER's characters, so a renderer can slice text out
    // of the body rather than re-finding anything.
    expect(body.slice(link.start, link.end)).toBe(link.raw);
  });

  test("an unknown path stays text", () => {
    expect(extractLinks("read /not/a/route anywhere")).toEqual([]);
    // `/hr/payroll` is a real screen but addresses no record, so it is not
    // something a bubble may promise a card for.
    expect(extractLinks("open /hr/payroll")).toEqual([]);
  });

  test("trailing punctuation and brackets are peeled without eating the URL", () => {
    expect(extractLinks("see https://en.wikipedia.org/wiki/Freight_(rail).")[0].raw)
      .toBe("https://en.wikipedia.org/wiki/Freight_(rail)");
    expect(extractLinks("(https://a.example/x) and more")[0].raw).toBe("https://a.example/x");
    expect(extractLinks("https://x.example/a, https://x.example/b")[1].raw).toBe("https://x.example/b");
    // `peelTail` is only ever handed what the regex stopped at a whitespace
    // boundary on, so the sentence tail is not part of its input. This is the
    // case that matters: a query array ends in the bracket a naive peeler eats.
    expect(extractLinks("look https://a.example/x?y=(z), ok")[0].raw).toBe("https://a.example/x?y=(z)");
  });

  test("an email address is a mailto link, never a fetch target", () => {
    const [link] = extractLinks("ops at ops@smartls.praxisls.com, please");
    expect(link).toMatchObject({ kind: "mail", href: "mailto:ops@smartls.praxisls.com" });
    expect(webUrls("ops at ops@smartls.praxisls.com")).toEqual([]);
  });

  test("the schemes that must never reach an href are refused", () => {
    // `data:text/html,<script>` is a same-origin document, `javascript:` is an
    // expression, `file:` is the reader's disk. Refused at the tokenizer means no
    // renderer downstream has to remember.
    for (const text of ["data:text/html,<script>alert(1)</script>", "javascript:alert(1)//", "file:///etc/passwd", "vbscript:msgbox"]) {
      expect(extractLinks(text)).toEqual([]);
    }
  });

  test("one body cannot flood the renderer with links", () => {
    const body = Array.from({ length: 60 }, (_, i) => `https://a.example/${i}`).join(" ");
    expect(extractLinks(body).length).toBe(linkDetect.MAX_LINKS);
  });
});

describe("normaliseUrl: the cache key", () => {
  test("case, default port and fragment are not identity", () => {
    const a = normaliseUrl("HTTP://Example.COM:80/a?b=1#frag");
    const b = normaliseUrl("http://example.com/a?b=1");
    expect(a).toBe(b);
    expect(a).toBe("http://example.com/a?b=1");
  });
  test("https and http are different pages, and a non-default port is a different target", () => {
    expect(normaliseUrl("https://x.example")).not.toBe(normaliseUrl("http://x.example"));
    // The cache key KEEPS a non-default port — `:8080` is a different server, and
    // merging them would show one site's card for another's. What refuses the
    // fetch is the guard, not the key: an odd port is clickable in chat (the
    // reader's browser, the reader's network) and never fetched by our server.
    expect(normaliseUrl("http://x.example:8080/a")).toBe("http://x.example:8080/a");
    expect(require("../../src/shared/net/link-target").screenUrl("http://x.example:8080/a").ok).toBe(false);
  });
  test("a trailing slash on a root is not a different page, on a path it is", () => {
    expect(normaliseUrl("https://x.example/")).toBe(normaliseUrl("https://x.example"));
    expect(normaliseUrl("https://x.example/docs/")).not.toBe(normaliseUrl("https://x.example/docs"));
  });
  test("refuses anything that is not http(s)", () => {
    expect(normaliseUrl("ftp://x.example/a")).toBeNull();
    expect(normaliseUrl("mailto:a@b.example")).toBeNull();
    expect(normaliseUrl("/workspace/tasks")).toBeNull();
  });
});

describe("toAppPath: whose page is this", () => {
  test("a subdomain of an owned domain is ours", () => {
    expect(toAppPath("https://smartls.praxisls.com/operations/files/1", ["praxisls.com"])).toBe("/operations/files/1");
  });
  test("a look-alike suffix is NOT ours", () => {
    // The classic. `praxisls.com.evil.test` starts with the string and is a
    // different registrable domain entirely, and treating it as ours would let a
    // message send a reader off-site while the bubble told them they were staying.
    expect(toAppPath("https://praxisls.com.evil.test/x", ["praxisls.com"])).toBeNull();
    expect(toAppPath("https://evil.com/?next=https://praxisls.com/x", ["praxisls.com"])).toBeNull();
  });
  test("the query rides along, because that is where the record lives for two route shapes", () => {
    expect(toAppPath("https://app.praxisls.com/workspace/tasks?task=9", ["praxisls.com"])).toBe("/workspace/tasks?task=9");
  });
  test("no hosts claimed, no claim", () => {
    expect(toAppPath("https://app.praxisls.com/x", [])).toBeNull();
  });
});

describe("webUrls / entityRefs: what a page of messages costs", () => {
  test("one fetch per URL, however many times it is pasted", () => {
    const body = "https://a.example/x https://a.example/x https://a.example/x#top";
    expect(webUrls(body)).toEqual(["https://a.example/x"]);
  });
  test("one record reference per record, however many ways it is written", () => {
    const body = "/workspace/tasks?task=1 and again /workspace/tasks?task=1";
    expect(entityRefs(body)).toEqual(["task:1"]);
  });
  test("an empty or missing body yields nothing rather than throwing", () => {
    expect(webUrls(null)).toEqual([]);
    expect(entityRefs(undefined)).toEqual([]);
    expect(extractLinks("")).toEqual([]);
  });
});
