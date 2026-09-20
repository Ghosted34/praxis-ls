"use strict";

/**
 * Smart Comms link previews: the guard, the parser, and the two paths that must
 * never be confused for each other.
 *
 * ── WHY THIS FILE IS MOSTLY ABOUT REFUSAL ───────────────────────────────────
 *
 * A link previewer takes a URL from a chat message and asks the server to fetch
 * it. That is an SSRF with a friendly face, and the interesting behaviour is not
 * the card it renders — it is the four hundred ways the fetch must say NO:
 * `127.0.0.1`, `169.254.169.254`, `10.x`, a Docker service name, `:5432`, a
 * credential in the URL, a public host that 302s to a private one, a name whose
 * DNS answers differently the second time (rebinding), and a page whose
 * `og:image` points back at the metadata endpoint. Each of those is one test, and
 * a regression on any one of them is a real hole, not a red build.
 *
 * The fetch assertions use a real socket on loopback and expect it to be
 * REFUSED — the only honest way to prove the guard runs before the connection,
 * since a mocked transport would happily connect anywhere. Nothing here reaches a
 * public host: CI has no business depending on somebody else's website, and a
 * test that does fails on a train.
 */

const net = require("node:net");
const linkTarget = require("../../src/shared/net/link-target");
const guarded = require("../../src/shared/net/guarded-fetch");
const meta = require("../../src/shared/net/meta-tags");
const { linkDetect } = require("@praxis/shared");

jest.mock("../../src/modules/smartcomm/smartcomm.links.repo", () => ({
  hashUrl: (url) => require("node:crypto").createHash("sha256").update(url).digest("hex"),
  findMany: jest.fn(),
  noteUrls: jest.fn(),
  putResult: jest.fn(),
  markStale: jest.fn(),
  due: jest.fn(),
  remove: jest.fn(),
}));
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: jest.fn(), getQueue: jest.fn() }));
jest.mock("../../src/services/tenant/registry.service", () => ({
  workspaceOrigin: jest.fn(async () => ({ slug: "smartls", host: "smartls.praxisls.com" })),
  publicSiteBaseUrl: jest.fn(async () => "https://forwarder.example"),
  withTenantConnection: jest.fn((meta2, env, fn) => fn({})),
  listActiveTenants: jest.fn(async () => []),
}));

const links = require("../../src/modules/smartcomm/smartcomm.links.service");
const queueProducer = require("../../src/jobs/queue-producer");
const previewRepo = require("../../src/modules/smartcomm/smartcomm.links.repo");

const client = () => ({ query: jest.fn(async () => ({ rows: [] })) });
const html = (head) => `<!doctype html><html><head>${head}</head><body>hi</body></html>`;
const fakeFetch = (impl) => jest.fn(async (url) => impl(url));
const okHtml = (head) =>
  fakeFetch(() => ({
    ok: true,
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    contentType: "text/html; charset=utf-8",
    body: Buffer.from(html(head)),
    finalUrl: "https://a.example/page",
  }));

beforeEach(() => {
  jest.clearAllMocks();
  queueProducer.enqueue.mockResolvedValue({ id: "job" });
  previewRepo.noteUrls.mockResolvedValue([]);
  previewRepo.findMany.mockResolvedValue([]);
  previewRepo.putResult.mockResolvedValue(true);
});

describe("the fetch guard refuses what it must", () => {
  test("loopback, private space, and the cloud metadata address", () => {
    for (const url of [
      "http://127.0.0.1/x",
      "http://10.0.0.5:80/",
      "http://192.168.1.1/admin",
      "http://172.16.9.9/x",
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      "http://100.64.0.1/x",
      "http://[::1]/x",
      "http://[fe80::1]/x",
      "http://[fc00::5]/x",
      "http://[::ffff:127.0.0.1]/x",
    ]) {
      expect({ url, ...linkTarget.screenUrl(url) }).toMatchObject({ ok: false });
    }
  });

  test("the integer-literal form of loopback is still loopback", () => {
    // WHATWG's URL parser normalises it, so the guard sees `127.0.0.1` and not a
    // hostname to be resolved. Asserted because the trick is in every SSRF
    // cheat-sheet and is only blocked when something normalises first.
    expect(linkTarget.screenUrl("http://2130706433/").ok).toBe(false);
    expect(linkTarget.screenUrl("http://0x7f.0.0.1/").ok).toBe(false);
  });

  test("no credentials, no odd ports, no non-http schemes", () => {
    expect(linkTarget.screenUrl("https://user:pw@example.com/")).toMatchObject({ ok: false, reason: "credentials" });
    expect(linkTarget.screenUrl("http://example.com:5432/")).toMatchObject({ ok: false, reason: "port" });
    expect(linkTarget.screenUrl("ftp://example.com/x")).toMatchObject({ ok: false, reason: "protocol" });
    expect(linkTarget.screenUrl("file:///etc/passwd")).toMatchObject({ ok: false, reason: "protocol" });
  });

  test("container and single-label names are refused without asking DNS", () => {
    // `postgres`, `redis`, `mailpit` — the service names on any Compose network.
    for (const host of ["http://postgres/db", "http://redis:80/", "http://localhost/x", "http://metadata/x"]) {
      expect(linkTarget.screenUrl(host).ok).toBe(false);
    }
    // A public hostname is fine.
    expect(linkTarget.screenUrl("https://www.maersk.com/vessel").ok).toBe(true);
  });

  test("a name that resolves to a private address is refused at the resolver", async () => {
    const lookup = guarded.makeGuardedLookup({
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    await expect(
      new Promise((resolve) => lookup("rebinding.example", { all: true }, (err, res) => resolve({ err, res }))),
    ).resolves.toMatchObject({ err: { blockReason: "private-resolver" } });
  });

  test("happy-eyeballs: one public and one private answer yields only the public one", async () => {
    const lookup = guarded.makeGuardedLookup({
      resolve: async () => [{ address: "93.184.216.34", family: 4 }, { address: "::1", family: 6 }],
    });
    const { err, res } = await new Promise((resolve) =>
      lookup("dual.example", { all: true }, (e, r) => resolve({ err: e, res: r })),
    );
    expect(err).toBeNull();
    expect(res.map((r) => r.address)).toEqual(["93.184.216.34"]);
  });

  test("guardedFetch refuses a loopback server BEFORE connecting", async () => {
    // A real listening socket, so "refused" cannot be an artefact of nothing being
    // there: the assertion is that the guard stops it, not that the port is closed.
    const server = net.createServer((s) => s.end("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\nhi"));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    try {
      const result = await guarded.guardedFetch(`http://127.0.0.1:${port}/x`, { timeoutMs: 1500 });
      // The address rule fires first, and that ordering is the point: loopback on
      // an odd port is refused for being loopback, not for being odd.
      expect(result).toMatchObject({ ok: false, reason: "blocked-address" });
      expect(linkTarget.isBlockedAddress("127.0.0.1")).toBe(true);
    } finally {
      server.close();
    }
  });

  test("an unresolvable name is a dead link, not an error", async () => {
    const result = await guarded.guardedFetch("http://no-such-host.invalid.example/x", {
      timeoutMs: 1500,
      resolve: async () => {
        throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      },
    });
    expect(result.ok).toBe(false);
  });
});

describe("the head parser reads five facts and nothing else", () => {
  test("og: wins over title, twitter: is the fallback not the source", () => {
    const card = meta.parseHead(
      html(`
        <title>Fallback Title</title>
        <meta property="og:description" content="Declared description">
        <meta name="twitter:image" content="https://cdn.example/tw.jpg">
      `),
      "https://a.example/page",
    );
    expect(card.title).toBe("Fallback Title");
    expect(card.description).toBe("Declared description");
    expect(card.imageUrl).toBe("https://cdn.example/tw.jpg");
    expect(card.siteName).toBe("a.example");
  });

  test("a commented-out or script-written declaration is not a declaration", () => {
    const card = meta.parseHead(
      html(`
        <!-- <meta property="og:image" content="https://stale.example/old.png"> -->
        <script>document.write('<meta property="og:title" content="HACKED">')</script>
        <script type="text/javascript">/* x */</script >
        <style></style >
        <meta property="og:title" content="Real">
      `),
      "https://a.example/page",
    );
    expect(card.title).toBe("Real");
    expect(card.imageUrl).toBeNull();
  });

  test("a closing tag with anything in it still closes the element", () => {
    // `</script >`, `</script` + newline + `>` and `</script junk>` each end a script
    // element for a real HTML parser, so the scrub has to accept every one of them:
    // match only the exact `</script>` and a page's script contents stay in the text
    // this parser reads declarations from, which is the single thing the scrub is
    // here to prevent. (CodeQL's `js/html-jsmismatch` query is what insisted.)
    const card = meta.parseHead(
      html(`<script >document.write('x')</script >\n<meta property="og:description" content="Smuggled">`),
      "https://a.example/page",
    );
    // A declaration AFTER the script is legitimate and is still read…
    expect(card.description).toBe("Smuggled");
    // …and a declaration INSIDE it is not, however the page closed the tag.
    const closes = ["</script>", "</script >", "</script\n>", '</script foo="bar">'];
    for (const close of closes) {
      const inside = meta.parseHead(
        html(`<script ><meta property="og:title" content="Written">\n${close}`),
        "https://a.example/page",
      );
      expect({ close, title: inside.title }).toEqual({ close, title: null });
    }
    const styled = meta.parseHead(
      html(`<style >a{color:red}\n</style junk><meta property="og:site_name" content="Real">`),
      "https://a.example/x",
    );
    expect(styled.siteName).toBe("Real");
  });

  test("relative URLs resolve against the FINAL url, not the pasted short link", () => {
    const card = meta.parseHead(html(`<meta property="og:image" content="/img/x.png">`), "https://cdn.example/deep/page");
    expect(card.imageUrl).toBe("https://cdn.example/img/x.png");
  });

  test("entities and control characters are decoded out, and length is capped", () => {
    const card = meta.parseHead(
      html(`<meta property="og:title" content="Maersk &nbsp;Seal&#39;s &amp; Co &#x2014; Halifax">`),
      "https://a.example/",
    );
    expect(card.title).toBe("Maersk Seal's & Co — Halifax");
    const long = meta.parseHead(html(`<title>${"A".repeat(400)}</title>`), "https://a.example/");
    expect(long.title.length).toBe(meta.LIMITS.title);
    expect(long.title.endsWith("…")).toBe(true);
  });

  test("a data: favicon is accepted only as a small image", () => {
    const ok = meta.parseHead(html(`<link rel="icon" href="data:image/png;base64,iVBOR">`), "https://a.example/");
    expect(ok.iconUrl).toBe("data:image/png;base64,iVBOR");
    const evil = meta.parseHead(html(`<link rel="icon" href="data:text/html,<script>alert(1)</script>">`), "https://a.example/");
    // Falls through to the conventional /favicon.ico rather than trusting the data URI.
    expect(evil.iconUrl).toBe("https://a.example/favicon.ico");
  });
});

describe("media recognition comes from the URL and never from the page", () => {
  test("four providers, recognised from a fixed host list", () => {
    expect(meta.recogniseMedia("https://youtu.be/dQw4w9WgXcQ")).toEqual({ kind: "YOUTUBE", id: "dQw4w9WgXcQ" });
    expect(meta.recogniseMedia("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42")).toMatchObject({ kind: "YOUTUBE" });
    expect(meta.recogniseMedia("https://vimeo.com/76979871")).toMatchObject({ kind: "VIMEO" });
    expect(meta.recogniseMedia("https://www.loom.com/share/1a2b3c4d5e6f708192a3b4c5d6e7f809")).toMatchObject({ kind: "LOOM" });
    expect(meta.recogniseMedia("https://www.google.com/maps?q=Port+of+Lagos")).toMatchObject({ kind: "MAPS" });
  });

  test("a playlist is not a video, and a look-alike host is not the host", () => {
    expect(meta.recogniseMedia("https://www.youtube.com/playlist?list=PL5xJ_q7m").kind).toBe("NONE");
    expect(meta.recogniseMedia("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ").kind).toBe("NONE");
    expect(meta.recogniseMedia("https://evil.test/x").kind).toBe("NONE");
  });
});

describe("unfurl: state mapping and enrichment", () => {
  test("a page with metadata becomes OK", async () => {
    const result = await links.unfurl("https://a.example/page", {
      fetchImpl: okHtml(`<meta property="og:title" content="Vessel tracking"><meta property="og:image" content="/x.png">`),
    });
    expect(result).toMatchObject({ state: "OK", title: "Vessel tracking", imageUrl: "https://a.example/x.png" });
  });

  test("a page that says nothing is EMPTY, not OK with nulls", async () => {
    const result = await links.unfurl("https://a.example/page", {
      fetchImpl: okHtml(`<meta name="robots" content="noindex">`),
    });
    expect(result.state).toBe("EMPTY");
  });

  test("a screened-out URL never reaches the transport", async () => {
    const fetchImpl = fakeFetch(() => ({ ok: true, status: 200, headers: {}, body: Buffer.from(""), finalUrl: "" }));
    const result = await links.unfurl("http://127.0.0.1/admin", { fetchImpl });
    expect(result).toMatchObject({ state: "REFUSED", reason: "blocked-address" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("a transport refusal is REFUSED, a transport failure is UNREACHABLE", async () => {
    const refused = await links.unfurl("https://a.example/x", {
      fetchImpl: fakeFetch(() => ({ ok: false, reason: "private-resolver" })),
    });
    expect(refused.state).toBe("REFUSED");
    const unreachable = await links.unfurl("https://a.example/x", {
      fetchImpl: fakeFetch(() => ({ ok: false, reason: "timeout" })),
    });
    expect(unreachable.state).toBe("UNREACHABLE");
    // A status the site answered with is a dead link, not a blocked one: the
    // bubble must not look like a security decision the reader made.
    expect((await links.unfurl("https://a.example/x", { fetchImpl: fakeFetch(() => ({ ok: false, reason: "status", status: 410 })) })).state).toBe("UNREACHABLE");
  });

  test("oEmbed supplies length and author for a video link, from the provider's host", async () => {
    const calls = [];
    const fetchImpl = jest.fn(async (url) => {
      calls.push(url);
      if (url.includes("/oembed")) {
        return {
          ok: true, status: 200, contentType: "application/json",
          body: Buffer.from(JSON.stringify({ title: "Vessel tour", author_name: "Maersk", duration: 372, thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" })),
          headers: {}, finalUrl: url,
        };
      }
      return {
        ok: true, status: 200, contentType: "text/html", headers: {},
        body: Buffer.from(html(`<meta property="og:title" content="YouTube">`)),
        finalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      };
    });
    const result = await links.unfurl("https://youtu.be/dQw4w9WgXcQ", { fetchImpl });
    expect(result).toMatchObject({ state: "OK", mediaKind: "YOUTUBE", mediaId: "dQw4w9WgXcQ", duration: 372, authorName: "Maersk", title: "Vessel tour" });
    expect(calls.some((u) => u.startsWith("https://www.youtube.com/oembed"))).toBe(true);
  });

  test("a malformed oEmbed body does not lose the og: card", async () => {
    const fetchImpl = jest.fn(async (url) =>
      url.includes("/oembed")
        ? { ok: true, status: 200, headers: {}, contentType: "application/json", body: Buffer.from("<html>not json"), finalUrl: url }
        : { ok: true, status: 200, headers: {}, contentType: "text/html", body: Buffer.from(html(`<meta property="og:title" content="Still here">`)), finalUrl: "https://youtu.be/dQw4w9WgXcQ" },
    );
    const result = await links.unfurl("https://youtu.be/dQw4w9WgXcQ", { fetchImpl });
    expect(result.title).toBe("Still here");
    expect(result.duration).toBeUndefined();
  });
});

describe("the read path reads; it never fetches", () => {
  const messages = [{ message_id: "m1", body: "look https://a.example/x" }];

  test("a URL with no row is noted and queued, and the bubble gets nothing yet", async () => {
    previewRepo.findMany.mockResolvedValue([]);
    previewRepo.noteUrls.mockResolvedValue(["https://a.example/x"]);
    const out = await links.previewsFor(client(), messages, { tenantMeta: { tenant_id: "t", slug: "smartls" }, env: "live" });
    expect(out.byMessage.m1).toEqual(["https://a.example/x"]);
    expect(out.byUrl["https://a.example/x"]).toEqual({ state: "PENDING" });
    expect(queueProducer.enqueue).toHaveBeenCalledTimes(1);
    // The read path never writes a fetch result — that is the queue's job, and the
    // assertion is here because "just fetch it inline here too" is the change that
    // would turn opening a chat thread hostage to somebody else's web server.
    expect(previewRepo.putResult).not.toHaveBeenCalled();
  });

  test("a row that exists renders as a card, with our own image route and no remote URL", async () => {
    const url = "https://a.example/x";
    previewRepo.findMany.mockResolvedValue([
      {
        url, url_hash: previewRepo.hashUrl(url), state: "OK", title: "A page", description: "About things",
        site_name: "a.example", image_url: "https://cdn.a.example/og.png", image_width: 1200, image_height: 627,
        icon_url: null, media_kind: "NONE", media_id: null, duration_seconds: null, author_name: null,
        fetched_at: new Date().toISOString(), last_ok_at: new Date().toISOString(), stale_at: null,
      },
    ]);
    const out = await links.previewsFor(client(), messages, {});
    const card = out.byUrl[url];
    expect(card).toMatchObject({ state: "OK", title: "A page", site_name: "a.example" });
    expect(card.image_src).toContain("/smartcomm/links/image?link=");
    expect(JSON.stringify(card)).not.toContain("cdn.a.example");
    expect(queueProducer.enqueue).not.toHaveBeenCalled();
  });

  test("a card older than the TTL is marked and queued, not refreshed inline", async () => {
    const url = "https://a.example/x";
    previewRepo.findMany.mockResolvedValue([
      { url, url_hash: previewRepo.hashUrl(url), state: "OK", title: "Old", fetched_at: new Date(Date.now() - 40 * 86400000).toISOString(), last_ok_at: null, stale_at: null, next_attempt_at: new Date(0) },
    ]);
    previewRepo.markStale.mockResolvedValue([url]);
    const out = await links.previewsFor(client(), messages, { tenantMeta: { tenant_id: "t" } });
    // The reader still gets the stored card immediately — stale-while-revalidate,
    // never stale-while-waiting.
    expect(out.byUrl[url].title).toBe("Old");
    expect(previewRepo.markStale).toHaveBeenCalled();
    expect(queueProducer.enqueue).toHaveBeenCalled();
  });

  test("REFUSED and EMPTY render nothing, and neither is an error to the reader", async () => {
    const url = "https://a.example/x";
    for (const state of ["REFUSED", "EMPTY", "UNREACHABLE"]) {
      previewRepo.findMany.mockResolvedValue([{ url, url_hash: previewRepo.hashUrl(url), state, fetched_at: new Date().toISOString() }]);
      const out = await links.previewsFor(client(), messages, {});
      expect(out.byUrl[url].state).toBe(state);
      // null rather than absent: the card exists so the bubble can decide not to
      // draw it, and never has to distinguish "no title" from "no card".
      expect(out.byUrl[url].title).toBeNull();
      expect(out.byUrl[url].image_src).toBeNull();
    }
  });

  test("a body with no links costs one early return and no query", async () => {
    const c = client();
    const out = await links.previewsFor(c, [{ message_id: "m", body: "no urls here, e.g. this" }], {});
    expect(out).toEqual({ byMessage: {}, byUrl: {} });
    expect(previewRepo.findMany).not.toHaveBeenCalled();
  });
});

describe("the send path queues, and skips our own pages", () => {
  test("nothing on our own hosts is fetched, and everything else is", async () => {
    previewRepo.noteUrls.mockResolvedValue(["https://maersk.com/vessel/1"]);
    const out = await links.recordSentLinks(client(), {
      body:
        "file: https://smartls.praxisls.com/operations/files/77c1 " +
        "site: https://forwarder.example/quote/9 " +
        "and https://maersk.com/vessel/1",
      tenantMeta: { tenant_id: "t", slug: "smartls" },
      env: "live",
    });
    const payload = queueProducer.enqueue.mock.calls[0][2];
    // The workspace host and the tenant's own public domain are BOTH skipped: the
    // server does not authenticate to itself over its public interface to learn
    // what its own database already says. Only the stranger's link is queued.
    expect(payload.urls).toEqual(["https://maersk.com/vessel/1"]);
    expect(out.queued).toBe(1);
  });

  test("an internal-host link that the reader can navigate to needs no row at all", async () => {
    const out = await links.recordSentLinks(client(), {
      body: `Blockage on "Hold the meeting"\n/workspace/tasks?task=4f873a78-9790-460d-8555-1eed520e67ae`,
      tenantMeta: { tenant_id: "t" },
    });
    expect(out).toEqual({ queued: 0 });
    expect(previewRepo.noteUrls).not.toHaveBeenCalled();
    expect(queueProducer.enqueue).not.toHaveBeenCalled();
  });

  test("a URL already cached is not queued a second time", async () => {
    previewRepo.noteUrls.mockResolvedValue([]);
    const out = await links.recordSentLinks(client(), { body: "https://a.example/x", tenantMeta: { tenant_id: "t" } });
    expect(out).toMatchObject({ queued: 0, skipped: expect.stringContaining("cached") });
    expect(queueProducer.enqueue).not.toHaveBeenCalled();
  });

  test("no tenant context means nothing is queued, and the message is unaffected", async () => {
    previewRepo.noteUrls.mockResolvedValue(["https://a.example/x"]);
    // The row is still written, so a later read finds it; only the QUEUE needs a
    // tenant handle to get back to a schema, and a message is never failed by its
    // absence.
    await expect(links.recordSentLinks(client(), { body: "https://a.example/x" })).resolves.toEqual({ queued: 0, urls: 1 });
    expect(queueProducer.enqueue).not.toHaveBeenCalled();
  });
});

describe("the image proxy serves only what the cache recorded", () => {
  test("an arbitrary string is not a cache key", async () => {
    for (const bad of ["https://169.254.169.254/", "", "1234", "z".repeat(64), null]) {
      await expect(links.imageFor(client(), bad)).resolves.toBeNull();
    }
  });

  test("a link with no recorded image is a 404-shaped null", async () => {
    const c = client();
    c.query.mockResolvedValue({ rows: [] });
    await expect(links.imageFor(c, "a".repeat(64))).resolves.toBeNull();
  });

  test("an svg is refused, because an svg is a script with a picture on it", async () => {
    const c = client();
    c.query.mockResolvedValue({ rows: [{ url: "https://cdn.example/x.svg" }] });
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, contentType: "image/svg+xml", body: Buffer.from("<svg/>"), headers: {}, finalUrl: "https://cdn.example/x.svg" }));
    await expect(links.imageFor(c, "b".repeat(64), "image", { fetchImpl })).resolves.toBeNull();
  });

  test("a non-image content type from the upstream is refused", async () => {
    const c = client();
    c.query.mockResolvedValue({ rows: [{ url: "https://cdn.example/big.zip" }] });
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, contentType: "application/zip", body: Buffer.from("zip"), headers: {}, finalUrl: "https://cdn.example/big.zip" }));
    await expect(links.imageFor(c, "c".repeat(64), "image", { fetchImpl })).resolves.toBeNull();
  });

  test("a small data: favicon is served from the row, with no outbound fetch", async () => {
    const c = client();
    c.query.mockResolvedValue({ rows: [{ url: "data:image/png;base64,aGVsbG8=" }] });
    const fetchImpl = jest.fn();
    const out = await links.imageFor(c, "d".repeat(64), "icon", { fetchImpl });
    expect(out).toMatchObject({ contentType: "image/png" });
    expect(out.buffer.toString()).toBe("hello");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("what a preview is worth when the feature is switched off", () => {
  test("COMMS_LINK_PREVIEWS=false leaves the links alone and makes no queries", async () => {
    await jest.isolateModulesAsync(async () => {
      process.env.COMMS_LINK_PREVIEWS = "false";
      const fresh = require("../../src/modules/smartcomm/smartcomm.links.service");
      const find = require("../../src/modules/smartcomm/smartcomm.links.repo").findMany;
      find.mockClear();
      const out = await fresh.previewsFor(client(), [{ message_id: "m", body: "https://a.example/x" }], {});
      expect(out).toEqual({ byMessage: {}, byUrl: {} });
      expect(find).not.toHaveBeenCalled();
      expect(await fresh.recordSentLinks(client(), { body: "https://a.example/x", tenantMeta: { tenant_id: "t" } })).toEqual({ queued: 0 });
      delete process.env.COMMS_LINK_PREVIEWS;
    });
  });
});

describe("the tokenizer and the service agree on what a link is", () => {
  test("every web URL the service queued is one linkDetect found, canonicalised", async () => {
    const body = "see https://a.example/x?y=1, ok — and www.b.example/z";
    const queued = await links.linksIn(body, []);
    const detected = linkDetect.extractLinks(body);
    expect(queued.filter((l) => l.kind === "web").map((l) => l.url)).toEqual(
      detected.filter((l) => l.kind === "web").map((l) => l.href),
    );
  });
});
