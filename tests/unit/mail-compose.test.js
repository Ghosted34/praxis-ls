/**
 * The email serializer. Every assertion here is a rule about what survives the
 * trip to Outlook, Gmail and Apple Mail — not a rule about our own rendering.
 *
 * The suite is deliberately exhaustive, because this is the one function whose
 * output leaves the building as the company. A bug here is not a broken screen
 * somebody reloads; it is a malformed message in a customer's inbox, and it
 * cannot be recalled.
 */
"use strict";

/**
 * ── WHY sanitize-html IS MOCKED HERE, AND WHAT THAT DOES AND DOES NOT PROVE ──
 *
 * `sanitize-html@2.17` depends on an ESM-only `htmlparser2`. Node 20 and 22 both
 * `require()` it happily — verified against the exact runtime in `engines`, so
 * production and the inbound ingest path are unaffected — but Jest loads modules
 * through its own CommonJS runtime rather than Node's, and that one cannot.
 *
 * So the stub below stands in for it. What these tests therefore prove is that
 * the quoted fragment is ROUTED THROUGH the sanitizer; what sanitize-html then
 * does with it is that library's own business and its own test suite's.
 *
 * That boundary is acceptable precisely because it is narrow: since the erpBlock
 * change there is exactly ONE fragment in this file that is not escaped by
 * construction, and every other rule below is asserted against the real code.
 */
jest.mock("sanitize-html", () => {
  const fn = (html) => String(html)
    .replace(/<(script|style|iframe|object|embed|noscript|textarea)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  fn.defaults = { allowedTags: ["p", "a"], allowedAttributes: { a: ["href"] } };
  return fn;
});

const compose = require("../../src/modules/mail/mail/compose");

const doc = (...content) => ({ type: "doc", content });
const p = (...content) => ({ type: "paragraph", content });
const t = (text, marks) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const html = (d, o) => compose.serialize(d, o).html;
const text = (d, o) => compose.serialize(d, o).text;

/* ── The rules that make it email HTML rather than web HTML ───────────────── */

describe("email HTML is not web HTML", () => {
  const rendered = html(doc(p(t("hello"))));

  test("NO <style> BLOCK — Gmail strips it and the message loses every rule at once", () => {
    expect(rendered).not.toMatch(/<style/i);
  });

  test("no classes — a class resolves against a stylesheet that does not exist at the recipient", () => {
    expect(rendered).not.toMatch(/class=/i);
  });

  test("no external stylesheet and no web font", () => {
    expect(rendered).not.toMatch(/<link/i);
    expect(rendered).not.toMatch(/@font-face|fonts\.googleapis/i);
  });

  test("NO FLEX, GRID OR CSS VARIABLES — Outlook renders with Word's engine and supports none of them", () => {
    expect(rendered).not.toMatch(/display\s*:\s*(flex|grid)/i);
    expect(rendered).not.toMatch(/var\(--/);
  });

  test("THERE IS NO NODE THAT CARRIES RAW MARKUP — the document arrives in a request body", () => {
    // The security property, stated as a test. A TipTap document is POSTed by
    // the client, so any node whose attrs were emitted verbatim would be an HTML
    // injection straight through the serializer, sent as the company. An earlier
    // draft of erpBlock did exactly that and put a sanitizer in front of it,
    // which is filtering a hole we dug ourselves. Now every node's text is
    // escaped, so markup in ANY attribute position comes out inert.
    const attack = "<script>steal()</script>";
    const out = html(doc(
      { type: "erpBlock", attrs: { label: attack, html: attack }, content: [p(t(attack))] },
      { type: "heading", attrs: { level: 1 }, content: [t(attack)] },
      { type: "image", attrs: { src: "cid:a", alt: attack } },
      p(t("x", [{ type: "link", attrs: { href: "https://x.cm", title: attack } }])),
    ));
    expect(out).not.toMatch(/<script/i);
    expect(out).toMatch(/&lt;script&gt;/); // present, inert, and visible as text
  });

  test("layout is tables, and they are marked presentational", () => {
    expect(rendered).toMatch(/<table[^>]*role="presentation"/);
  });

  test("the column is 600px — what fits Outlook's reading pane", () => {
    expect(rendered).toMatch(/width:600px/);
  });

  test("every style is inline", () => {
    const styles = rendered.match(/style="[^"]*"/g) || [];
    expect(styles.length).toBeGreaterThan(3);
  });
});

/* ── Colour ───────────────────────────────────────────────────────────────── */

describe("colour is always explicit hex", () => {
  test.each([
    ["#abc", "#aabbcc"],
    ["#AABBCC", "#aabbcc"],
    ["rgb(17, 24, 39)", "#111827"],
    ["rgba(17,24,39,0.5)", "#111827"],
  ])("%s becomes %s", (input, expected) => {
    expect(compose.hex(input)).toBe(expected);
  });

  test.each(["currentColor", "var(--primary)", "rebeccapurple", "", null, "inherit"])(
    "%s resolves against nothing at the recipient, so it is refused",
    (input) => { expect(compose.hex(input)).toBeNull(); },
  );

  test("a refused colour leaves the TEXT — it does not delete what someone wrote", () => {
    const out = html(doc(p(t("important", [{ type: "textStyle", attrs: { color: "var(--brand)" } }]))));
    expect(out).toMatch(/important/);
    expect(out).not.toMatch(/var\(--brand\)/);
  });

  test("a real colour is emitted", () => {
    expect(html(doc(p(t("red", [{ type: "textStyle", attrs: { color: "#ff0000" } }]))))).toMatch(/color:#ff0000/);
  });
});

/* ── Fonts ────────────────────────────────────────────────────────────────── */

describe("fonts are web-safe stacks only", () => {
  test("a known family becomes its full stack", () => {
    expect(html(doc(p(t("x", [{ type: "textStyle", attrs: { fontFamily: "georgia" } }])))))
      .toMatch(/font-family:Georgia, &#39;Times New Roman&#39;, serif|font-family:Georgia, 'Times New Roman', serif/);
  });

  test("AN UNKNOWN FAMILY IS DROPPED, NOT PASSED THROUGH", () => {
    // Montserrat would render as Times New Roman at the recipient and nobody
    // would ever know why. The codebase learned this from Outlook stripping
    // @font-face — see notification.service.js.
    const out = html(doc(p(t("x", [{ type: "textStyle", attrs: { fontFamily: "Montserrat" } }]))));
    expect(out).not.toMatch(/Montserrat/);
  });

  test("every stack in the table names a fallback and ends in a generic family", () => {
    for (const stack of Object.values(compose.FONT_STACKS)) {
      expect(stack.split(",").length).toBeGreaterThan(1);
      expect(stack).toMatch(/(sans-serif|serif|monospace)\s*$/);
    }
  });
});

/* ── Links ────────────────────────────────────────────────────────────────── */

describe("links", () => {
  const link = (href) => html(doc(p(t("click", [{ type: "link", attrs: { href } }]))));

  test("open in a new tab and cannot reach back at the opener", () => {
    expect(link("https://example.com")).toMatch(/target="_blank"[^>]*rel="noopener noreferrer"/);
  });

  test("A javascript: URL IS REFUSED — following one hands the sender script execution", () => {
    const out = link("javascript:alert(1)");
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toMatch(/click/); // the words survive; only the target is dropped
  });

  test("a data: URL is refused for the same reason", () => {
    expect(link("data:text/html,<script>x</script>")).not.toMatch(/data:text\/html/);
  });

  test("a bare domain is what people type, and is meant as https", () => {
    expect(link("example.com/bl")).toMatch(/href="https:\/\/example\.com\/bl"/);
  });

  test.each(["mailto:a@b.cm", "tel:+237600000000", "http://intranet.local"])("%s is allowed", (href) => {
    expect(compose.safeHref(href)).toBe(href);
  });

  test("links are visibly links — colour AND underline, since colour alone fails a colour-blind reader", () => {
    const out = link("https://example.com");
    expect(out).toMatch(/text-decoration:underline/);
    expect(out).toMatch(/color:#[0-9a-f]{6}/);
  });
});

/* ── Images ───────────────────────────────────────────────────────────────── */

describe("images", () => {
  const img = (attrs) => compose.serialize(doc({ type: "image", attrs }));

  test("an http image is refused — a mixed-content image is blocked by most clients anyway", () => {
    expect(compose.safeSrc("http://x.cm/a.png")).toBeNull();
    expect(compose.safeSrc("https://x.cm/a.png")).toBe("https://x.cm/a.png");
  });

  test("a cid: reference is collected so the sender knows which parts to attach", () => {
    const r = img({ src: "cid:logo1", alt: "Logo" });
    expect(r.cids).toEqual(["logo1"]);
    expect(r.html).toMatch(/src="cid:logo1"/);
  });

  test("display:block — without it Outlook leaves a descender gap under every image", () => {
    expect(img({ src: "cid:a", alt: "A" }).html).toMatch(/display:block/);
  });

  test("BOTH a width attribute AND a width in the style", () => {
    // Outlook reads the attribute; everything else reads the style. An image
    // with neither renders at intrinsic size and blows the 600px column apart.
    const out = img({ src: "cid:a", alt: "A", width: 300 }).html;
    expect(out).toMatch(/width="300"/);
    expect(out).toMatch(/width:300px/);
  });

  test("an oversized image is clamped to the column", () => {
    expect(img({ src: "cid:a", alt: "A", width: 5000 }).html).toMatch(/width="600"/);
  });

  test("A MISSING DESCRIPTION IS WARNED ABOUT — most recipients block images by default", () => {
    const r = img({ src: "cid:a" });
    expect(r.html).toMatch(/alt=""/);
    expect(r.warnings.join(" ")).toMatch(/no description/i);
  });

  test("an unusable src renders nothing rather than a broken image", () => {
    expect(img({ src: "javascript:x" }).html).not.toMatch(/<img/);
  });
});

/* ── Structure ────────────────────────────────────────────────────────────── */

describe("block structure", () => {
  test("an empty paragraph keeps its blank line — Outlook collapses an empty <p>", () => {
    expect(html(doc(p(), p(t("after"))))).toMatch(/&nbsp;/);
  });

  test("a list item's paragraph loses its bottom margin, or every bullet gains a blank line", () => {
    const out = html(doc({
      type: "bulletList",
      content: [{ type: "listItem", content: [p(t("one"))] }],
    }));
    expect(out).toMatch(/<li[^>]*><p style="margin:0;/);
  });

  test("an ordered list keeps its start number", () => {
    expect(html(doc({ type: "orderedList", attrs: { start: 5 }, content: [{ type: "listItem", content: [p(t("five"))] }] })))
      .toMatch(/<ol start="5"/);
  });

  test("a horizontal rule is a bordered table cell, because a styled <hr> is unreliable in Outlook", () => {
    const out = html(doc({ type: "horizontalRule" }));
    expect(out).not.toMatch(/<hr/);
    expect(out).toMatch(/border-bottom:1px solid/);
  });

  test("table cells are <td> with explicit borders, and a header cell is styled not <th>", () => {
    const out = html(doc({
      type: "table",
      content: [{ type: "tableRow", content: [
        { type: "tableHeader", content: [p(t("Ref"))] },
        { type: "tableCell", content: [p(t("SLAS-2026-0001"))] },
      ] }],
    }));
    expect(out).toMatch(/<td[^>]*font-weight:bold[^>]*>/);
    expect(out).toMatch(/border:1px solid/);
    expect(out).toMatch(/SLAS-2026-0001/);
  });

  test("colspan and rowspan survive", () => {
    const out = html(doc({
      type: "table",
      content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 2, rowspan: 3 }, content: [p(t("x"))] }] }],
    }));
    expect(out).toMatch(/colspan="2"/);
    expect(out).toMatch(/rowspan="3"/);
  });

  test("headings map to real heading levels, clamped to 1-6", () => {
    expect(html(doc({ type: "heading", attrs: { level: 2 }, content: [t("H")] }))).toMatch(/<h2/);
    expect(html(doc({ type: "heading", attrs: { level: 99 }, content: [t("H")] }))).toMatch(/<h6/);
  });

  test("AN UNKNOWN NODE STILL CONTRIBUTES ITS WORDS", () => {
    // A document written by a newer editor should degrade, not silently lose
    // the sentence inside a node this version has never heard of.
    expect(html(doc({ type: "somethingNew", content: [p(t("do not lose me"))] }))).toMatch(/do not lose me/);
  });

  test("an erpBlock renders its own child nodes, with the data pinned at insert time", () => {
    // Re-resolving here would change the numbers under a message the sender
    // already approved — and would need a database, which is what keeps this
    // function testable.
    const out = html(doc({
      type: "erpBlock",
      attrs: { label: "Invoice INV-2026-0007" },
      content: [p(t("1 250 000 XAF, due 30 Sep"))],
    }));
    expect(out).toMatch(/Invoice INV-2026-0007/);
    expect(out).toMatch(/1 250 000 XAF, due 30 Sep/);
    expect(out).toMatch(/border:1px solid/); // set apart from the prose around it
  });

  test("an erpBlock's plain-text form keeps its label and its rows", () => {
    const out = text(doc({
      type: "erpBlock",
      attrs: { label: "Invoice INV-2026-0007" },
      content: [p(t("1 250 000 XAF"))],
    }));
    expect(out).toMatch(/INVOICE INV-2026-0007/);
    expect(out).toMatch(/1 250 000 XAF/);
  });
});

/* ── Escaping ─────────────────────────────────────────────────────────────── */

describe("escaping", () => {
  test("typed markup is text, not markup", () => {
    const out = html(doc(p(t("<b>not bold</b> & <script>x</script>"))));
    expect(out).toMatch(/&lt;b&gt;not bold&lt;\/b&gt;/);
    expect(out).not.toMatch(/<script/i);
  });

  test("a quote in a link's text cannot break out of the attribute", () => {
    expect(html(doc(p(t('say "hi"', [{ type: "link", attrs: { href: "https://x.cm" } }]))))).toMatch(/&quot;hi&quot;/);
  });
});

/* ── The plain-text part ──────────────────────────────────────────────────── */

describe("the text part is built from the tree, not from the HTML", () => {
  test("it contains no markup at all", () => {
    const out = text(doc({ type: "heading", attrs: { level: 1 }, content: [t("Title")] }, p(t("Body"))));
    expect(out).not.toMatch(/[<>]/);
  });

  test("a heading is underlined, so structure survives a format with no headings", () => {
    expect(text(doc({ type: "heading", attrs: { level: 1 }, content: [t("Title")] }))).toMatch(/Title\n=====/);
  });

  test("A LINK'S DESTINATION IS PRESERVED — a text reader cannot click", () => {
    expect(text(doc(p(t("the invoice", [{ type: "link", attrs: { href: "https://x.cm/i" } }])))))
      .toBe("the invoice <https://x.cm/i>");
  });

  test("a link whose text already IS the url is not doubled", () => {
    expect(text(doc(p(t("https://x.cm", [{ type: "link", attrs: { href: "https://x.cm" } }]))))).toBe("https://x.cm");
  });

  test("list markers survive, numbered lists count, and nesting indents", () => {
    const out = text(doc(
      { type: "bulletList", content: [
        { type: "listItem", content: [p(t("one"))] },
        { type: "listItem", content: [p(t("two"))] },
      ] },
      { type: "orderedList", attrs: { start: 3 }, content: [
        { type: "listItem", content: [p(t("third"))] },
      ] },
    ));
    expect(out).toMatch(/- one/);
    expect(out).toMatch(/- two/);
    expect(out).toMatch(/3\. third/);
  });

  test("a quote is marked with > so the reader can tell it apart", () => {
    expect(text(doc({ type: "blockquote", content: [p(t("they said"))] }))).toMatch(/^> they said/m);
  });

  test("an image becomes its description rather than disappearing", () => {
    expect(text(doc({ type: "image", attrs: { src: "cid:a", alt: "The BL scan" } }))).toMatch(/\[image: The BL scan\]/);
  });

  test("table rows are one line each with separated cells, not an ASCII grid", () => {
    // A fixed-width grid built from variable content wraps into nonsense the
    // moment the reader resizes their window.
    const out = text(doc({
      type: "table",
      content: [{ type: "tableRow", content: [
        { type: "tableCell", content: [p(t("Ref"))] },
        { type: "tableCell", content: [p(t("Amount"))] },
      ] }],
    }));
    expect(out).toBe("Ref  |  Amount");
  });

  test("runs of blank lines are collapsed", () => {
    expect(text(doc(p(), p(), p(t("x"))))).not.toMatch(/\n\n\n/);
  });
});

/* ── Quoted history ───────────────────────────────────────────────────────── */

describe("quoted reply history", () => {
  const opts = { quotedHtml: "<p>What they wrote</p>", quotedText: "What they wrote" };

  test("is appended below a rule, in grey", () => {
    const out = html(doc(p(t("My reply"))), opts);
    expect(out.indexOf("My reply")).toBeLessThan(out.indexOf("What they wrote"));
    expect(out).toMatch(/border-top:1px solid/);
  });

  test("IS NOT RE-SERIALIZED — it is already delivered mail, and re-rendering would change what the other party wrote", () => {
    expect(html(doc(p(t("r"))), { quotedHtml: '<p style="color:#ff00ff">theirs</p>' })).toMatch(/color:#ff00ff/);
  });

  test("but it IS routed through the sanitizer — it is the one fragment that came from outside", () => {
    // Sanitised on ingest and again here, because it is about to leave over the
    // tenant's own signature. See the header for what the mock does and does not
    // prove: this asserts the fragment goes through sanitizeQuote, not what
    // sanitize-html does with it.
    const out = html(doc(p(t("r"))), { quotedHtml: "<p>kept</p><script>gone()</script>" });
    expect(out).toMatch(/kept/);
    expect(out).not.toMatch(/<script/i);
  });

  test("sanitizeQuote is the single entry point, and it refuses nothing silently", () => {
    expect(compose.sanitizeQuote("")).toBe("");
    expect(compose.sanitizeQuote(null)).toBe("");
    expect(compose.sanitizeQuote("<p>plain</p>")).toMatch(/plain/);
  });

  test("the quote allow-list is narrower than the inbound one, because this is being re-sent", () => {
    for (const dangerous of ["script", "style", "iframe", "object", "embed", "form", "input"]) {
      expect(compose.QUOTE_SANITIZE.allowedTags).not.toContain(dangerous);
    }
    // Dropped WITH their contents — stripping the tag alone leaves the CSS or
    // the script source sitting as visible words inside the quotation.
    expect(compose.QUOTE_SANITIZE.nonTextTags).toEqual(
      expect.arrayContaining(["script", "style", "iframe"]),
    );
    expect(compose.QUOTE_SANITIZE.allowedSchemes).not.toContain("javascript");
    expect(compose.QUOTE_SANITIZE.allowedSchemes).not.toContain("data");
  });

  test("the text part quotes it with >", () => {
    expect(text(doc(p(t("My reply"))), opts)).toMatch(/^> What they wrote/m);
  });
});

/* ── Size ─────────────────────────────────────────────────────────────────── */

describe("the 102 KB clip threshold", () => {
  test("an ordinary message warns about nothing", () => {
    expect(compose.serialize(doc(p(t("short")))).warnings).toEqual([]);
  });

  test("A LONG MESSAGE WARNS RATHER THAN BEING TRUNCATED", () => {
    // Gmail hides the remainder behind "View entire message", which to the
    // recipient looks like the sender simply stopped writing. Silently cutting
    // someone's message is worse than telling them it is too long.
    const big = compose.serialize(doc(...Array.from({ length: 900 }, () => p(t("x".repeat(120))))));
    expect(big.bytes).toBeGreaterThan(compose.CLIP_BYTES);
    expect(big.warnings.join(" ")).toMatch(/clips/i);
    expect(big.html).toMatch(/x{120}/); // reported, not truncated
  });

  test("bytes are measured as UTF-8, not as characters", () => {
    const accented = compose.serialize(doc(p(t("é".repeat(100)))));
    expect(accented.bytes).toBeGreaterThan(Buffer.byteLength(accented.html.replace(/é/g, "e"), "utf8"));
  });
});

/* ── Input handling ───────────────────────────────────────────────────────── */

describe("input handling", () => {
  test.each([null, undefined, "a string", 42])("%p is refused with a 422, not a crash", (bad) => {
    expect(() => compose.serialize(bad)).toThrow(expect.objectContaining({ status: 422 }));
  });

  test("an empty document still produces a well-formed message", () => {
    const r = compose.serialize(doc());
    expect(r.html).toMatch(/<\/html>/);
    expect(r.text).toBe("");
  });

  test("a document with no explicit type is accepted", () => {
    expect(compose.serialize({ content: [p(t("x"))] }).text).toBe("x");
  });

  test("marks stack in order without losing any", () => {
    const out = html(doc(p(t("all", [{ type: "bold" }, { type: "italic" }, { type: "underline" }]))));
    expect(out).toMatch(/<strong>/);
    expect(out).toMatch(/<em>/);
    expect(out).toMatch(/text-decoration:underline/);
  });

  test("an unknown mark contributes no formatting and no error", () => {
    expect(html(doc(p(t("plain", [{ type: "sparkle" }]))))).toMatch(/plain/);
  });
});
