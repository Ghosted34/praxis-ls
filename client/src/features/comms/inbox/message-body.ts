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
 * do not control while rendering the message: `<img src="http(s)://…">`,
 * `srcset`, `<video>`/`<audio>`/`<source>`/`<track>`, and CSS `url()` inside a
 * surviving inline `style`. `cid:` and `data:` are LEFT ALONE — a `cid:` part
 * came with the message and is served from our own store, and a `data:` URI is
 * bytes already in hand. Neither reaches a third party, and blocking them would
 * hide the signature logo on every internal mail for no gain.
 *
 * WHY THE ORIGINAL URL IS KEPT. Moved to `data-blocked-src`, not deleted, so
 * "Show images" is a re-render rather than a re-fetch of the message — and so
 * the alt text still has something to be the alternative TO.
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
 *
 * ── WHY THIS IS A PURE MODULE ───────────────────────────────────────────────
 *
 * String in, string out, no React and no DOM API that needs a browser — so it
 * is unit-testable without a renderer, and so the same fold logic can be reused
 * by anything that needs to show a message body later.
 */

/** The attributes that make a browser fetch something while rendering. */
const URL_ATTRS = ["src", "srcset", "poster", "background"];

/** `cid:` and `data:` never leave the building; everything else might. */
const isRemote = (url: string): boolean => {
  const v = String(url || "").trim();
  if (!v) return false;
  return !/^(cid:|data:|blob:)/i.test(v);
};

export type BodyScan = {
  /** The HTML with remote references neutralised. */
  html: string;
  /** How many references were held back — 0 means nothing to offer. */
  blocked: number;
};

/**
 * Neutralise every remote reference in a message body.
 *
 * Regex rather than DOMParser deliberately: this runs on already-sanitized
 * HTML (`mail.service.cleanHtml` ran on ingest, so there is no script, no
 * event handler and no `<style>` block left to reason about), it runs on every
 * expanded message, and parsing a document per render to walk it is the more
 * expensive way to reach the same answer. The one thing a regex must not be
 * trusted with is SECURITY, and it is not doing security here — the sanitizer
 * did that on the way in. This is a privacy convenience over trusted markup.
 */
export function blockRemoteContent(html: string): BodyScan {
  let blocked = 0;
  if (!html) return { html: "", blocked: 0 };

  let out = html;

  // src / srcset / poster / background on any element.
  for (const attr of URL_ATTRS) {
    const re = new RegExp(`\\s${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, "gi");
    out = out.replace(re, (whole, _q, dq, sq) => {
      const value = dq ?? sq ?? "";
      if (!isRemote(value)) return whole;
      blocked += 1;
      return ` data-blocked-${attr}="${value.replace(/"/g, "&quot;")}"`;
    });
  }

  // url(...) inside a surviving inline style — a background image is a pixel
  // with extra steps, and it is the one people forget.
  out = out.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (whole, _q, value) => {
    if (!isRemote(value)) return whole;
    blocked += 1;
    return "none";
  });

  return { html: out, blocked };
}

/** Put back what `blockRemoteContent` held, for "Show images". */
export function restoreRemoteContent(html: string): string {
  let out = html;
  for (const attr of URL_ATTRS) {
    out = out.replace(
      new RegExp(`\\sdata-blocked-${attr}\\s*=\\s*"([^"]*)"`, "gi"),
      (_whole, value) => ` ${attr}="${value}"`,
    );
  }
  return out;
}

/**
 * The attribution line that introduces a quotation, in English and French.
 *
 * Anchored to the start of a line and required to end in a colon, because
 * "on Tuesday we wrote:" mid-paragraph is prose, not an attribution. The French
 * form takes a non-breaking space before the colon (Outlook and Thunderbird
 * both emit one) as well as a plain one.
 */
// The French non-breaking space before a colon is written as `\u00a0`, not
// typed: a literal one in source is invisible to whoever reads this next, and
// `no-irregular-whitespace` rejects it for exactly that reason.
const ATTRIBUTION =
  /^\s*(?:>+\s*)?(?:On\s.{0,200}?\swrote\s*:|Le\s.{0,200}?\sa\s[ée]crit\s*[\u00a0\s]*:|-{2,}\s*(?:Original Message|Message d'origine|Forwarded message|Message transf[ée]r[ée])\s*-{2,})\s*$/im;

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
    if (!ATTRIBUTION.test(lines[i])) continue;
    // Nothing above it is not a quotation, it is the whole message.
    if (!lines.slice(0, i).join("").trim()) break;
    return {
      visible: lines.slice(0, i).join("\n").replace(/\s+$/, ""),
      quoted: lines.slice(i).join("\n"),
    };
  }

  // The trailing `>` run.
  let cut = lines.length;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i];
    if (/^\s*>/.test(l)) { cut = i; continue; }
    if (!l.trim() && cut < lines.length) continue; // blank lines inside the run
    break;
  }
  if (cut < lines.length && lines.slice(0, cut).join("").trim()) {
    return {
      visible: lines.slice(0, cut).join("\n").replace(/\s+$/, ""),
      quoted: lines.slice(cut).join("\n"),
    };
  }

  return { visible: body, quoted: null };
}

/**
 * Split an HTML body at the FIRST `<blockquote>`, or at an attribution line.
 *
 * The first one is the right cut and nesting needs no counting: a thread quotes
 * itself outside-in, so the outermost quotation opens first in document order
 * and everything after it — however deeply nested — is history. Cutting at the
 * first open tag therefore folds the whole chain in one go.
 *
 * A quotation that starts at the very beginning is NOT folded: that is a
 * forward whose entire content is the quoted message, and folding it would
 * show the reader an empty message with a "show history" link.
 */
export function splitQuotedHtml(html: string): SplitBody {
  const body = String(html || "");
  if (!body.trim()) return { visible: body, quoted: null };

  const open = /<blockquote\b[^>]*>/i.exec(body);
  if (open) {
    const head = body.slice(0, open.index);
    // Text, not just markup, has to precede it — a wrapper <div> above the
    // quotation is not a reply.
    if (head.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim()) {
      return { visible: head, quoted: body.slice(open.index) };
    }
    return { visible: body, quoted: null };
  }

  // No blockquote: fall back to the attribution line, which Gmail's plain
  // "On … wrote:" + <div> form produces without ever opening one.
  const lines = body.split(/(?=<br\s*\/?>|<\/div>|<\/p>)/i);
  for (let i = 1; i < lines.length; i += 1) {
    const plain = lines[i].replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ");
    if (!ATTRIBUTION.test(plain.trim())) continue;
    const head = lines.slice(0, i).join("");
    if (!head.replace(/<[^>]*>/g, "").trim()) break;
    return { visible: head, quoted: lines.slice(i).join("") };
  }

  return { visible: body, quoted: null };
}
