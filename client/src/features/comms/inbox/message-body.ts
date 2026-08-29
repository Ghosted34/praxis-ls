/**
 * What the reading pane actually renders: images held back, history folded.
 *
 * ── REMOTE IMAGES ARE BLOCKED UNTIL SOMEBODY ASKS (§5.6.3) ──────────────────
 *
 * Q32 removed our own telemetry — no tracking pixel, no link rewriting — on the
 * grounds that EU counterparties and an EU entity make read tracking the wrong
 * trade. That decision protects the people we write to. It does nothing for the
 * people who work here, who are on the receiving end of everybody ELSE's
 * pixels: a 1×1 GIF in a supplier's footer reports the moment an invoice was
 * opened, from what IP, on what device, every time the message is displayed.
 *
 * Blocking remote images by default is the only privacy control the programme
 * has left on the inbound side, and §5.6.3 names it. It is also the standard
 * behaviour of every serious mail client, so it surprises nobody.
 *
 * WHAT IS BLOCKED, PRECISELY. Anything the browser would fetch from a host we
 * do not control while rendering the message: `src`, `srcset`, `poster` and
 * `background` on any element, and CSS `url()` inside an inline `style`.
 * `cid:` and `data:` are LEFT ALONE — a `cid:` part came with the message and
 * is served from our own store, and a `data:` URI is bytes already in hand.
 * Neither reaches a third party, and blocking them would hide the signature
 * logo on every internal mail for no gain.
 *
 * WHY THE ORIGINAL URL IS KEPT. Moved to `data-blocked-src`, not deleted, so
 * "Show images" is a re-render rather than a re-fetch of the message — and so
 * the alt text still has something to be the alternative TO.
 *
 * ── WHY THIS PARSES RATHER THAN PATTERN-MATCHES ─────────────────────────────
 *
 * The first version of this file did the whole job with regexes, on the
 * argument that the HTML is already sanitized (`mail.service.cleanHtml` runs on
 * ingest) so nothing security-critical was riding on the parse. The argument
 * was wrong twice over.
 *
 * It was wrong on the merits: `\ssrc\s*=\s*("[^"]*"|'[^']*')` requires QUOTES,
 * and `<img src=https://track.example/p.gif>` is valid HTML that no browser
 * needs quotes for. Every unquoted pixel went straight through the control
 * whose entire job is to stop pixels. A privacy filter with a hole shaped like
 * "the attacker omits two characters" is not a filter.
 *
 * And it was wrong about the risk: CodeQL's `js/bad-tag-filter` flagged the
 * tag-stripping regex below at high severity on PR #271, and it was right to.
 * Matching HTML with regular expressions is a losing game whose failure mode is
 * always silent.
 *
 * So it parses. `parseBody` below explains which parser and why — the short
 * version is that we get the browser's own understanding of what an attribute
 * is, without the browser doing anything about what it finds.
 *
 * ── QUOTED HISTORY IS FOLDED, NOT DROPPED (§5.6.3) ──────────────────────────
 *
 * A ten-message thread renders the same ten messages nested inside each other,
 * so the last one is ten copies deep and the reader scrolls through the whole
 * exchange to reach two new sentences. Every mail client folds this; §5.6.3
 * specifies the three signals to fold on, in BOTH languages, because half this
 * tenant's correspondence is French:
 *
 *   · `<blockquote>` — what most clients emit
 *   · `>` line prefixes — what plain-text mailers emit
 *   · "On … wrote:" / "Le … a écrit :" — the attribution line above either
 *
 * Folded, never dropped: the history is one click away and still selectable in
 * the plain-text branch. A mail client that quietly deletes the quotation is
 * one you cannot use to settle an argument about who said what.
 */

/** The attributes that make a browser fetch something while rendering. */
const URL_ATTRS = ["src", "srcset", "poster", "background"] as const;

/** `cid:` and `data:` never leave the building; everything else might. */
const isRemote = (url: string): boolean => {
  const v = String(url || "").trim();
  if (!v) return false;
  return !/^(cid:|data:|blob:)/i.test(v);
};

/**
 * Parse a message body into an inert fragment.
 *
 * ── TWO PROPERTIES, BOTH LOAD-BEARING ───────────────────────────────────────
 *
 * INERT. A `<template>`'s contents live in a separate "template contents owner
 * document" with no browsing context, so `<img src="https://track.example/
 * p.gif">` is parsed and NOT fetched. If this were
 * `document.createElement("div").innerHTML = html`, the pixel would fire inside
 * the very function written to stop it.
 *
 * TABLE-SAFE. `DOMParser.parseFromString(html, "text/html")` parses in BODY
 * context, and the HTML tree-construction algorithm silently discards
 * table-only elements that appear without a table ancestor — a body that
 * begins mid-table loses its `<td>`s, and this function's output is what the
 * reading pane renders. Mail is table-based HTML (our own `compose.js` emits
 * a table layout), so "silently drops table cells" is not a corner case here.
 * `<template>` parses in TEMPLATE context, which permits them.
 *
 * The empty `DOMParser` document is only there to own the element; nothing is
 * parsed into it.
 */
const OWNER = () => new DOMParser().parseFromString("", "text/html");

function parseBody(html: string): { doc: Document; root: DocumentFragment } {
  const doc = OWNER();
  const tpl = doc.createElement("template");
  tpl.innerHTML = html;
  return { doc, root: tpl.content };
}

/** Serialise a fragment back to the HTML the pane will render. */
function serialize(doc: Document, root: Node): string {
  const box = doc.createElement("div");
  box.appendChild(root.cloneNode(true));
  return box.innerHTML;
}

export type BodyScan = {
  /** The HTML with remote references neutralised. */
  html: string;
  /** How many references were held back — 0 means nothing to offer. */
  blocked: number;
};

/** Neutralise every remote reference in a message body. */
export function blockRemoteContent(html: string): BodyScan {
  if (!html) return { html: "", blocked: 0 };

  const { doc, root } = parseBody(html);
  let blocked = 0;

  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    for (const attr of URL_ATTRS) {
      const value = el.getAttribute(attr);
      if (value == null || !isRemote(value)) continue;
      el.removeAttribute(attr);
      el.setAttribute(`data-blocked-${attr}`, value);
      blocked += 1;
    }

    // A background image is a pixel with extra steps, and it is the one people
    // forget. The whole declaration is neutralised rather than surgically
    // edited: `style` here is an inline attribute on sanitized markup, and
    // rewriting one `url()` inside a shorthand correctly is the same losing
    // game as the regexes this file stopped playing.
    const style = el.getAttribute("style");
    if (style && /url\(/i.test(style)) {
      const cleaned = style.replace(/url\([^)]*\)/gi, (whole) => {
        const inner = whole.slice(4, -1).trim().replace(/^['"]|['"]$/g, "");
        if (!isRemote(inner)) return whole;
        blocked += 1;
        return "none";
      });
      if (cleaned !== style) el.setAttribute("style", cleaned);
    }
  }

  return { html: serialize(doc, root), blocked };
}

/** Put back what `blockRemoteContent` held, for "Show images". */
export function restoreRemoteContent(html: string): string {
  if (!html) return "";
  const { doc, root } = parseBody(html);
  for (const attr of URL_ATTRS) {
    for (const el of Array.from(
      root.querySelectorAll<HTMLElement>(`[data-blocked-${attr}]`),
    )) {
      const value = el.getAttribute(`data-blocked-${attr}`);
      if (value != null) el.setAttribute(attr, value);
      el.removeAttribute(`data-blocked-${attr}`);
    }
  }
  return serialize(doc, root);
}

/**
 * The attribution line that introduces a quotation, in English and French.
 *
 * Required to END in a colon, because "on Tuesday we wrote:" mid-paragraph is
 * prose, not an attribution. The French form takes a non-breaking space before
 * the colon (Outlook and Thunderbird both emit one) as well as a plain one —
 * written as the escape `\u00a0`, never typed: a literal one in source is
 * invisible to whoever reads this next, and `no-irregular-whitespace` rejects
 * it for exactly that reason.
 *
 * The caller trims before testing, so this anchors with `^` and `$` and carries
 * no leading or trailing `\s*`. That is not tidiness: `\s*$` after a literal is
 * the classic polynomial-backtracking shape, and this runs once per line of
 * every message body.
 */
const ATTRIBUTION =
  /^(?:>+ ?)?(?:On\s.{0,200}?\swrote:|Le\s.{0,200}?\sa\s[ée]crit[\u00a0 ]?:|-{2,}\s?(?:Original Message|Message d'origine|Forwarded message|Message transf[ée]r[ée])\s?-{2,})$/i;

/** Is this line the "On … wrote:" that introduces a quotation? */
const isAttribution = (line: string) => ATTRIBUTION.test(line.trim());

export type SplitBody = { visible: string; quoted: string | null };

/**
 * Split a PLAIN-TEXT body into what is new and what is history.
 *
 * The cut is made at whichever comes first: the attribution line, or the start
 * of an unbroken run of `>`-prefixed lines that reaches the end. Requiring it
 * to reach the end matters — somebody who quotes one line, answers it, and
 * quotes another has written an interleaved reply, and folding from the first
 * `>` would hide half of their answer.
 */
export function splitQuotedText(text: string): SplitBody {
  const body = String(text || "");
  if (!body.trim()) return { visible: body, quoted: null };

  const lines = body.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    if (!isAttribution(lines[i])) continue;
    // Nothing above it is not a quotation, it is the whole message.
    if (!lines.slice(0, i).join("").trim()) break;
    return {
      visible: trimEnd(lines.slice(0, i).join("\n")),
      quoted: lines.slice(i).join("\n"),
    };
  }

  // The trailing `>` run.
  let cut = lines.length;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i];
    if (/^ *>/.test(l)) { cut = i; continue; }
    if (!l.trim() && cut < lines.length) continue; // blank lines inside the run
    break;
  }
  if (cut < lines.length && lines.slice(0, cut).join("").trim()) {
    return {
      visible: trimEnd(lines.slice(0, cut).join("\n")),
      quoted: lines.slice(cut).join("\n"),
    };
  }

  return { visible: body, quoted: null };
}

/**
 * The native `trimEnd`, wrapped only so the call sites read as intent.
 *
 * Deliberately NOT `replace(/\s+$/, "")`: a trailing-whitespace regex on a
 * message-sized string is the classic polynomial-backtracking shape, and this
 * runs on every body the pane renders. The engine's own trim has none of that.
 */
function trimEnd(s: string): string {
  return s.trimEnd();
}

/**
 * Split an HTML body at the FIRST `<blockquote>`, or at an attribution line.
 *
 * The first blockquote is the right cut and nesting needs no counting: a thread
 * quotes itself outside-in, so the outermost quotation opens first in document
 * order and everything after it — however deeply nested — is history.
 *
 * A `Range` does the cutting rather than a substring, which is what makes both
 * of the shapes mail clients actually emit come out right:
 *
 *   <div>reply</div><div class="gmail_quote"><blockquote>…      → clean split
 *   <div>reply<blockquote>…</blockquote></div>                  → the div is
 *     partially selected, and `extractContents` splits it, so "reply" stays
 *     visible and the blockquote leaves inside a clone of its wrapper.
 *
 * A quotation that starts at the very beginning is NOT folded: that is a
 * forward whose entire content is the quoted message, and folding it would show
 * the reader an empty message with a "show history" link.
 */
export function splitQuotedHtml(html: string): SplitBody {
  const body = String(html || "");
  if (!body.trim()) return { visible: body, quoted: null };

  const { doc, root } = parseBody(body);
  const bq = root.querySelector("blockquote");

  if (bq) {
    const before = doc.createRange();
    before.setStart(root, 0);
    before.setEndBefore(bq);
    // Text, not markup: a wrapper `<div>` above the quotation is not a reply.
    if (!before.toString().trim()) return { visible: body, quoted: null };

    const rest = doc.createRange();
    rest.setStartBefore(bq);
    rest.setEnd(root, root.childNodes.length);
    const box = doc.createElement("div");
    box.appendChild(rest.extractContents());
    return { visible: serialize(doc, root), quoted: box.innerHTML };
  }

  /* No blockquote: fall back to the attribution line, which Gmail's plain
   * "On … wrote:" + <div> form produces without ever opening one. Walked as
   * top-level nodes rather than split on `<br>` — the DOM already knows where
   * the blocks are, and `textContent` is exact where tag-stripping was not. */
  const nodes = Array.from(root.childNodes);
  for (let i = 1; i < nodes.length; i += 1) {
    if (!isAttribution(nodes[i].textContent || "")) continue;
    const head = nodes.slice(0, i);
    if (!head.map((n) => n.textContent || "").join("").trim()) break;

    const rest = doc.createRange();
    rest.setStartBefore(nodes[i]);
    rest.setEnd(root, root.childNodes.length);
    const box = doc.createElement("div");
    box.appendChild(rest.extractContents());
    return { visible: serialize(doc, root), quoted: box.innerHTML };
  }

  return { visible: body, quoted: null };
}
