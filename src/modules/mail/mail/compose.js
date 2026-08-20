/**
 * TipTap JSON → email HTML. THE SERVER'S OUTPUT IS WHAT IS SENT.
 *
 * ── WHY THIS RUNS ON THE SERVER AND NOT IN THE EDITOR ───────────────────────
 *
 * The client has its own serializer for the live preview, and it will drift —
 * every client-side serializer does, because it is edited to make the preview
 * look right rather than to make the mail correct. If the client's output were
 * the thing that left the building, a bug in it would produce mail nobody
 * reviewed, sent as the company, to a customer. So the client's version is
 * decoration and this one is the record.
 *
 * ── EMAIL HTML IS NOT WEB HTML, AND THE LIST OF WHAT BREAKS IS NOT SHORT ────
 *
 * Outlook renders with Microsoft Word's engine. Gmail strips `<style>` blocks in
 * some contexts and rewrites classes in others. Neither supports flexbox, CSS
 * grid, custom properties, or `@font-face` — the codebase already learned that
 * last one the hard way; see the comment in `notification.service.js` about
 * Outlook silently substituting Times New Roman for a web font. So:
 *
 *   · TABLES for layout. Not divs. `<table role="presentation">` so a screen
 *     reader does not announce a layout grid as data.
 *   · EVERY style INLINE. No `<style>` block, no classes, no external CSS.
 *   · EXPLICIT HEX for every colour, never `currentColor` and never a variable —
 *     a colour that resolves against a stylesheet resolves against nothing here.
 *   · WEB-SAFE FONT STACKS ONLY. Offering Montserrat renders as Times New Roman
 *     at the recipient and nobody would ever know why.
 *   · 600px max width. Not a fashion — it is what fits Outlook's reading pane.
 *
 * ── THE PLAIN-TEXT PART COMES FROM THE TREE, NOT FROM THE HTML ──────────────
 *
 * Generating text by stripping tags out of the HTML gives you the HTML's
 * accidents: table cells run together, list markers vanish, link targets are
 * lost. Walking the same document twice costs nothing and produces a text part
 * someone can actually read — which matters, because it is what a screen reader
 * on a text-preferring client gets, and what lands in a spam filter's corpus.
 *
 * ── 102 KB IS A REAL CLIFF ──────────────────────────────────────────────────
 *
 * Gmail clips an HTML part over roughly 102 KB and hides the remainder behind
 * "View entire message". A clipped quotation looks to the recipient like the
 * sender simply stopped writing. We measure and report rather than truncate —
 * the composer warns before send, because silently cutting someone's message is
 * worse than telling them it is too long.
 *
 * PURE, and deliberately so: a document in, `{html, text, bytes, warnings}` out.
 * No database, no request, no config. Every rule above is therefore testable
 * without a mailbox.
 */
"use strict";

const { AppError } = require("../../../utils/errors");

/** Gmail clips past this. Measured on the HTML part alone, as Gmail measures it. */
const CLIP_BYTES = 102 * 1024;
const MAX_WIDTH = 600;

/**
 * Web-safe stacks only — see the header. Keyed by the value the editor's font
 * menu emits, so an unknown family falls back rather than being passed through
 * to a recipient who does not have it.
 */
const FONT_STACKS = {
  arial: "Arial, Helvetica, sans-serif",
  helvetica: "Helvetica, Arial, sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  times: "'Times New Roman', Times, serif",
  verdana: "Verdana, Geneva, sans-serif",
  tahoma: "Tahoma, Geneva, sans-serif",
  trebuchet: "'Trebuchet MS', Helvetica, sans-serif",
  courier: "'Courier New', Courier, monospace",
};
const DEFAULT_FONT = FONT_STACKS.arial;

/** The one place a colour is turned into something an email client will honour. */
function hex(value) {
  const v = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(v);
  if (rgb) {
    const to = (n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0");
    return `#${to(rgb[1])}${to(rgb[2])}${to(rgb[3])}`;
  }
  // A named colour, a CSS variable, `currentColor`, or junk. All of them resolve
  // against a stylesheet that does not exist at the recipient, so none is used.
  return null;
}

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A style attribute, or nothing at all — never `style=""`. */
const styleAttr = (parts) => {
  const s = parts.filter(Boolean).join(";");
  return s ? ` style="${esc(s)}"` : "";
};

/**
 * A URL safe to put in an href.
 *
 * `javascript:` and `data:` in a link are the two that matter: a mail client
 * that follows either has handed the sender script execution in the reader's
 * context. Rejected here rather than left to the sanitizer, so the serializer's
 * own output is already correct and sanitisation stays a second line rather
 * than the only one.
 */
function safeHref(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  if (/^(https?:|mailto:|tel:)/i.test(raw)) return raw;
  // A bare domain typed into the link dialog is the common case and is meant.
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(raw)) return `https://${raw}`;
  return null;
}

/** An image src: hosted over HTTPS, or a `cid:` part we are attaching. */
function safeSrc(url) {
  const raw = String(url || "").trim();
  if (/^https:/i.test(raw) || /^cid:[\w.@-]+$/i.test(raw)) return raw;
  return null;
}

/* ── Marks ────────────────────────────────────────────────────────────────── */

/**
 * Wrap a text run in its marks.
 *
 * `<strong>`/`<em>` rather than `<b>`/`<i>`: both render everywhere, and the
 * semantic pair is what a screen reader announces with emphasis. Underline has
 * no semantic tag, so it is a styled span — and it is deliberately NOT used for
 * links, which are underlined by the link rule itself.
 */
function applyMarks(html, marks = []) {
  let out = html;
  for (const mark of marks) {
    const attrs = mark.attrs || {};
    switch (mark.type) {
      case "bold": out = `<strong>${out}</strong>`; break;
      case "italic": out = `<em>${out}</em>`; break;
      case "underline": out = `<span style="text-decoration:underline">${out}</span>`; break;
      case "strike": out = `<span style="text-decoration:line-through">${out}</span>`; break;
      case "code":
        out = `<code style="font-family:${FONT_STACKS.courier};background-color:#f4f4f5;padding:1px 4px">${out}</code>`;
        break;
      case "textStyle": {
        const colour = hex(attrs.color);
        const family = FONT_STACKS[String(attrs.fontFamily || "").toLowerCase()];
        const s = styleAttr([colour && `color:${colour}`, family && `font-family:${family}`]);
        if (s) out = `<span${s}>${out}</span>`;
        break;
      }
      case "highlight": {
        const colour = hex(attrs.color) || "#fff3a3";
        out = `<span style="background-color:${colour}">${out}</span>`;
        break;
      }
      case "link": {
        const href = safeHref(attrs.href);
        // A link whose target we refuse keeps its TEXT. Dropping the words as
        // well would silently delete part of what the person wrote.
        if (!href) break;
        out = `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer"`
          + ` style="color:#1a56db;text-decoration:underline">${out}</a>`;
        break;
      }
      default: break; // an unknown mark contributes no formatting, never an error
    }
  }
  return out;
}

/* ── Blocks ───────────────────────────────────────────────────────────────── */

const ALIGN = new Set(["left", "center", "right", "justify"]);
const align = (attrs) => (ALIGN.has(attrs?.textAlign) ? `text-align:${attrs.textAlign}` : null);

const BASE_TEXT = `margin:0 0 12px 0;font-family:${DEFAULT_FONT};font-size:14px;line-height:1.5;color:#111827`;
const HEADING_SIZE = { 1: 24, 2: 20, 3: 17, 4: 15, 5: 14, 6: 13 };

function renderNodes(nodes = [], ctx) {
  return nodes.map((n) => renderNode(n, ctx)).join("");
}

function renderInline(nodes = [], ctx) {
  return nodes.map((n) => {
    if (n.type === "text") return applyMarks(esc(n.text), n.marks);
    if (n.type === "hardBreak") return "<br>";
    if (n.type === "image") return renderImage(n, ctx);
    if (n.type === "mention") {
      // PR-3 owns mentions. Rendered as plain bold text here so a document
      // written after PR-3 still serializes correctly if it reaches this path.
      return `<strong>${esc(n.attrs?.label || n.attrs?.id || "")}</strong>`;
    }
    return renderNode(n, ctx);
  }).join("");
}

/**
 * An image.
 *
 * `display:block` kills the descender gap Outlook leaves under an inline image.
 * An explicit `width` attribute AND a width in the style: Outlook reads the
 * attribute, everything else reads the style, and an image with neither renders
 * at its intrinsic size and blows the 600px column apart. `alt` always, because
 * a great many recipients block images by default and the alt text is the only
 * thing they will see.
 */
function renderImage(node, ctx) {
  const attrs = node.attrs || {};
  const src = safeSrc(attrs.src);
  if (!src) return "";
  if (src.startsWith("cid:")) ctx.cids.add(src.slice(4));
  const width = Math.min(Number(attrs.width) || MAX_WIDTH, MAX_WIDTH);
  const alt = esc(attrs.alt || attrs.title || "");
  if (!attrs.alt) ctx.warnings.add("An image has no description. Recipients who block images will see nothing in its place.");
  return `<img src="${esc(src)}" alt="${alt}" width="${width}"`
    + ` style="display:block;max-width:100%;width:${width}px;height:auto;border:0" />`;
}

function renderNode(node, ctx) {
  if (!node || typeof node !== "object") return "";
  const attrs = node.attrs || {};
  switch (node.type) {
    case "doc":
      return renderNodes(node.content, ctx);

    case "paragraph": {
      const inner = renderInline(node.content, ctx);
      // An empty paragraph is a deliberate blank line. `&nbsp;` because an empty
      // `<p>` collapses to nothing in Outlook and the spacing the writer put
      // there disappears.
      return `<p${styleAttr([BASE_TEXT, align(attrs)])}>${inner || "&nbsp;"}</p>`;
    }

    case "heading": {
      const level = Math.min(Math.max(Number(attrs.level) || 1, 1), 6);
      const size = HEADING_SIZE[level];
      return `<h${level}${styleAttr([
        `margin:0 0 8px 0`, `font-family:${DEFAULT_FONT}`, `font-size:${size}px`,
        "line-height:1.3", "color:#111827", "font-weight:bold", align(attrs),
      ])}>${renderInline(node.content, ctx)}</h${level}>`;
    }

    case "bulletList":
    case "orderedList": {
      const tag = node.type === "bulletList" ? "ul" : "ol";
      const start = tag === "ol" && Number(attrs.start) > 1 ? ` start="${Number(attrs.start)}"` : "";
      return `<${tag}${start}${styleAttr([
        "margin:0 0 12px 0", "padding-left:24px", `font-family:${DEFAULT_FONT}`,
        "font-size:14px", "line-height:1.5", "color:#111827",
      ])}>${renderNodes(node.content, ctx)}</${tag}>`;
    }

    case "listItem":
      // The paragraph inside a list item loses its bottom margin, or every
      // bullet gains a blank line under it in Outlook.
      return `<li style="margin:0 0 4px 0">${
        renderNodes(node.content, ctx).replace(/margin:0 0 12px 0/g, "margin:0")
      }</li>`;

    case "blockquote":
      return `<blockquote${styleAttr([
        "margin:0 0 12px 0", "padding:4px 0 4px 12px", "border-left:3px solid #d1d5db", "color:#4b5563",
      ])}>${renderNodes(node.content, ctx)}</blockquote>`;

    case "codeBlock":
      return `<pre${styleAttr([
        "margin:0 0 12px 0", "padding:12px", "background-color:#f4f4f5",
        `font-family:${FONT_STACKS.courier}`, "font-size:13px", "line-height:1.45",
        "color:#111827", "white-space:pre-wrap", "word-break:break-word",
      ])}>${esc(textOf(node))}</pre>`;

    case "horizontalRule":
      // A styled <hr> is unreliable in Outlook; a one-cell table with a bottom
      // border is the rule that actually renders.
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`
        + ` style="margin:0 0 12px 0"><tr><td style="border-bottom:1px solid #d1d5db;font-size:0;line-height:0">&nbsp;</td></tr></table>`;

    case "image":
      return `<p style="margin:0 0 12px 0">${renderImage(node, ctx)}</p>`;

    case "table":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`
        + `${styleAttr(["margin:0 0 12px 0", "border-collapse:collapse", `max-width:${MAX_WIDTH}px`])}>`
        + `<tbody>${renderNodes(node.content, ctx)}</tbody></table>`;

    case "tableRow":
      return `<tr>${renderNodes(node.content, ctx)}</tr>`;

    case "tableHeader":
    case "tableCell": {
      const isHeader = node.type === "tableHeader";
      const span = Number(attrs.colspan) > 1 ? ` colspan="${Number(attrs.colspan)}"` : "";
      const rows = Number(attrs.rowspan) > 1 ? ` rowspan="${Number(attrs.rowspan)}"` : "";
      return `<td${span}${rows}${styleAttr([
        "padding:6px 8px", "border:1px solid #d1d5db", "vertical-align:top",
        `font-family:${DEFAULT_FONT}`, "font-size:13px", "line-height:1.45", "color:#111827",
        isHeader && "background-color:#f4f4f5", isHeader && "font-weight:bold",
      ])}>${renderNodes(node.content, ctx).replace(/margin:0 0 12px 0/g, "margin:0")}</td>`;
    }

    /**
     * `erpBlock` — what a slash command inserts.
     *
     * ── IT CARRIES NODES, NOT AN HTML STRING, AND THAT IS THE SECURITY BOUNDARY ─
     *
     * The obvious design has the command render HTML at insert time and the
     * block carry it as `attrs.html`, which this function then emits verbatim.
     * That is an HTML injection straight through the serializer: the TipTap
     * document arrives in a request body, so anyone who can POST a draft can put
     * anything they like in that string and have it sent as the company. Adding a
     * sanitizer in front of it would be filtering a hole we dug ourselves.
     *
     * So a command returns a SUBTREE. Its cells and paragraphs are ordinary
     * nodes, rendered by the same escaped path as everything else, and there is
     * no route by which raw markup reaches the output at all.
     *
     * The DATA is still pinned at insert time — it lives in those nodes. Nothing
     * is re-resolved here: the numbers must not change under a message the
     * sender already approved, and re-resolving would need a database, which is
     * what keeps this function testable without one.
     */
    case "erpBlock": {
      const label = attrs.label ? `<p${styleAttr([
        "margin:0 0 4px 0", `font-family:${DEFAULT_FONT}`, "font-size:12px",
        "color:#6b7280", "font-weight:bold", "text-transform:uppercase", "letter-spacing:0.03em",
      ])}>${esc(attrs.label)}</p>` : "";
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"`
        + `${styleAttr(["margin:0 0 12px 0", `max-width:${MAX_WIDTH}px`])}>`
        + `<tr><td${styleAttr([
          "padding:12px", "border:1px solid #d1d5db", "background-color:#fafafa",
        ])}>${label}${renderNodes(node.content, ctx)}</td></tr></table>`;
    }

    case "text":
      return applyMarks(esc(node.text), node.marks);
    case "hardBreak":
      return "<br>";

    default:
      // An unknown node still contributes its children. A document from a newer
      // editor should degrade, not lose the words inside it.
      return node.content ? renderNodes(node.content, ctx) : "";
  }
}

/* ── The plain-text alternative, from the same tree ───────────────────────── */

const textOf = (node) =>
  (node?.content || []).map((c) => (c.type === "text" ? c.text || "" : textOf(c))).join("");

function renderText(node, ctx, depth = 0, index = null) {
  if (!node || typeof node !== "object") return "";
  const attrs = node.attrs || {};
  const kids = (n, d, listType) => (n.content || [])
    .map((c, i) => renderText(c, ctx, d, listType ? i : null)).join("");

  switch (node.type) {
    case "doc": return kids(node, 0);
    case "paragraph": return `${inlineText(node, ctx)}\n\n`;
    case "heading": {
      const t = inlineText(node, ctx);
      // Underlined with the character weight of the level, so structure survives
      // in a format that has no headings.
      return `${t}\n${(Number(attrs.level) <= 2 ? "=" : "-").repeat(Math.min(t.length, 60))}\n\n`;
    }
    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList";
      const start = ordered ? Math.max(Number(attrs.start) || 1, 1) : 1;
      return `${(node.content || []).map((c, i) => {
        const marker = ordered ? `${start + i}. ` : "- ";
        const body = renderText(c, ctx, depth + 1).trim().replace(/\n/g, `\n${" ".repeat(marker.length)}`);
        return `${"  ".repeat(depth)}${marker}${body}`;
      }).join("\n")}\n\n`;
    }
    case "listItem": return kids(node, depth);
    case "blockquote":
      return `${renderText({ ...node, type: "doc" }, ctx, depth).trim().split("\n").map((l) => `> ${l}`).join("\n")}\n\n`;
    case "codeBlock": return `${textOf(node)}\n\n`;
    case "horizontalRule": return `${"-".repeat(40)}\n\n`;
    case "image": {
      const alt = attrs.alt || attrs.title;
      return alt ? `[image: ${alt}]\n\n` : "[image]\n\n";
    }
    case "table":
      // One row per line, cells separated. Not an ASCII table: a fixed-width
      // grid built from variable content wraps into nonsense in any client the
      // reader has resized.
      return `${(node.content || []).map((r) => renderText(r, ctx, depth)).join("")}\n`;
    case "tableRow":
      return `${(node.content || []).map((c) => inlineText({ content: c.content }, ctx).trim()).filter(Boolean).join("  |  ")}\n`;
    case "erpBlock": {
      const label = attrs.label ? `${String(attrs.label).toUpperCase()}\n` : "";
      return `${label}${kids(node, depth).trim()}\n\n`;
    }
    case "text": return node.text || "";
    case "hardBreak": return "\n";
    default: return node.content ? kids(node, depth) : "";
  }
}

/** A run of inline content as text, with link targets preserved. */
function inlineText(node, ctx) {
  return (node.content || []).map((n) => {
    if (n.type === "text") {
      const link = (n.marks || []).find((m) => m.type === "link");
      const href = link && safeHref(link.attrs?.href);
      // `text <url>` rather than a bare word: a text-only reader cannot click,
      // and a link whose destination is invisible is not a link.
      if (href && href !== n.text) return `${n.text} <${href}>`;
      return n.text || "";
    }
    if (n.type === "hardBreak") return "\n";
    if (n.type === "image") return n.attrs?.alt ? `[image: ${n.attrs.alt}]` : "[image]";
    if (n.type === "mention") return `@${n.attrs?.label || n.attrs?.id || ""}`;
    return inlineText(n, ctx);
  }).join("");
}

/* ── The document shell ───────────────────────────────────────────────────── */

/**
 * The outer table.
 *
 * A single centred 600px column inside a full-width table. The outer table
 * carries the page background because Outlook ignores a background on `<body>`,
 * and the inner one is fixed-width because a fluid column is unreadable on a
 * wide monitor and clipped in a reading pane.
 */
const shell = (inner) => `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title></title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5">
<tr><td align="center" style="padding:16px">
<table role="presentation" width="${MAX_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${MAX_WIDTH}px;max-width:100%;background-color:#ffffff">
<tr><td style="padding:20px">
${inner}
</td></tr></table>
</td></tr></table>
</body></html>`;

/**
 * The ONE place third-party HTML enters this file: the quoted reply history.
 *
 * Everything the serializer builds is escaped by construction — text goes
 * through `esc`, every tag and every style is chosen here, and since the
 * erpBlock change there is no node that carries a markup string. The quoted
 * history is different: it is another party's `email_message.body_html`, and
 * although it was already sanitised on ingest, it is the one fragment that came
 * from outside and it is about to leave again over the tenant's own signature.
 * A second pass on the way out costs one parse of a fragment and removes the
 * whole class.
 *
 * Required lazily, matching `mail.service.cleanHtml`. `sanitize-html` pulls in
 * an ESM-only htmlparser2 that the CommonJS test runner cannot load, and a
 * top-level require would make this module unloadable in a unit test — which is
 * exactly where the serializer's rules need to be provable.
 *
 * The allow-list is narrower than the inbound one on purpose: this fragment is
 * being re-sent, not merely displayed.
 */
const QUOTE_SANITIZE = {
  allowedTags: [
    "p", "br", "div", "span", "strong", "b", "em", "i", "u", "s", "code", "pre",
    "blockquote", "ul", "ol", "li", "a", "img", "table", "tbody", "thead", "tr", "td", "th",
    "h1", "h2", "h3", "h4", "h5", "h6",
  ],
  allowedAttributes: {
    "*": ["style", "align", "valign", "width", "height", "bgcolor", "colspan", "rowspan"],
    a: ["href", "target", "rel"],
    img: ["src", "alt", "width", "height"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel", "cid"],
  allowedSchemesByTag: { img: ["https", "cid"], a: ["http", "https", "mailto", "tel"] },
  // Dropped WITH their contents. Stripping the tag alone leaves the CSS or the
  // script source sitting as visible words in the middle of the quotation.
  nonTextTags: ["script", "style", "textarea", "noscript", "iframe", "object", "embed"],
  allowedSchemesAppliedToAttributes: ["href", "src"],
};

function sanitizeQuote(fragment) {
  if (!fragment) return "";
   
  const sanitize = require("sanitize-html");
  return sanitize(String(fragment), QUOTE_SANITIZE);
}

/**
 * Serialize a TipTap document into a message.
 *
 * @param {object} doc   TipTap JSON (`{type:'doc', content:[…]}`)
 * @param {object} opts  `{ quotedHtml, quotedText }` — the reply history to
 *                       append below the new text, already rendered.
 * @returns {{html:string, text:string, bytes:number, cids:string[], warnings:string[]}}
 */
function serialize(doc, opts = {}) {
  if (!doc || typeof doc !== "object" || (doc.type && doc.type !== "doc")) {
    throw new AppError("VALIDATION_ERROR", "Expected a TipTap document", 422);
  }
  const ctx = { cids: new Set(), warnings: new Set() };

  let body = renderNode({ type: "doc", content: doc.content || [] }, ctx);

  // The quoted history goes below a rule, in grey, collapsed by the reader's own
  // client. Not re-serialized: it is already email HTML from a message that was
  // delivered, and re-rendering it would change what the other party wrote.
  if (opts.quotedHtml) {
    body += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0 0">`
      + `<tr><td style="border-top:1px solid #d1d5db;padding-top:12px;color:#6b7280;`
      + `font-family:${DEFAULT_FONT};font-size:13px;line-height:1.5">${sanitizeQuote(opts.quotedHtml)}</td></tr></table>`;
  }

  const html = shell(body);

  let text = renderText({ type: "doc", content: doc.content || [] }, ctx).replace(/\n{3,}/g, "\n\n").trim();
  if (opts.quotedText) {
    text += `\n\n${String(opts.quotedText).split("\n").map((l) => `> ${l}`).join("\n")}`;
  }

  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > CLIP_BYTES) {
    ctx.warnings.add(
      `This message is ${Math.round(bytes / 1024)} KB. Gmail clips anything over ${Math.round(CLIP_BYTES / 1024)} KB `
      + "and hides the rest behind “View entire message”, so the end of it may not be read.",
    );
  }

  return { html, text, bytes, cids: [...ctx.cids], warnings: [...ctx.warnings] };
}

module.exports = {
  serialize, hex, safeHref, safeSrc, sanitizeQuote,
  FONT_STACKS, CLIP_BYTES, MAX_WIDTH, QUOTE_SANITIZE,
};
