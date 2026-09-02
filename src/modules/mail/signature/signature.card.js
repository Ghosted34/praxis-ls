/**
 * The signature CARD — PURE. Block model + palette → a complete HTML document
 * for the PNG renderer to screenshot.
 *
 * WHY THIS IS A SECOND RENDERER AND NOT A CHANGE TO signature.html.js. That
 * file emits what an EMAIL CLIENT can display: presentational tables, inline
 * styles, a web-safe stack, no flex, no gradients, no @font-face — the rules in
 * mail.compose.js, which exist because Outlook 2016 renders with Word's engine
 * and Gmail strips <style>. The card is the opposite of all of that: flexbox,
 * four gradients, a border-radius, two embedded webfonts. Both are correct, for
 * different targets. Trying to make one file serve both would mean either a
 * card that Outlook mangles or an email that is not the card.
 *
 * So: this document is NEVER sent. It is screenshotted (signature.png.js), and
 * the PNG is what reaches a recipient, with signature.html.js's table beneath it
 * as the live-text fallback for image-blocking clients and screen readers.
 *
 * FIDELITY. The geometry here is transcribed from the standalone generator the
 * tenant has been using — 650 × 325, the 5px top bar, the 225px logo column,
 * the 185px divider, the 52px pill. Those numbers are the deliverable: staff
 * have this signature in their mail clients already, and a card that is nearly
 * the same is worse than one that is obviously different. What changed is that
 * every colour and both font families now resolve from the tenant (see
 * signature.palette.js) instead of being literals.
 */
"use strict";

const { esc } = require("./signature.html");

const CARD_W = 650;
const CARD_H = 325;

/**
 * Material Design icons (Apache-2.0), 24×24 viewBox, drawn at 16px.
 *
 * `tone: "warm"` fills from the warm accent, `"ink"` from the brand blue —
 * matching the original, which alternates them so the five rows do not read as
 * one block of blue.
 *
 * ADDRESS AND PO_BOX SHARE THE PIN DELIBERATELY. The generator this is
 * transcribed from uses the same location-pin path for both rows. A parcel or
 * box glyph would be more literal, but changing it would change the card, and
 * the card is the thing being reproduced. If it is ever meant to differ, that is
 * a design decision to take once, here.
 */
const ICONS = {
  phone: {
    tone: "warm",
    path: "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
  },
  email: {
    tone: "ink",
    path: "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z",
  },
  address: {
    tone: "ink",
    path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
  },
  po_box: {
    tone: "ink",
    path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
  },
  website: {
    tone: "warm",
    path: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z",
  },
};

/** The five rows, in order. Every one is omitted entirely when it has no value —
 *  the original hides the row rather than leaving the icon stranded. */
const ROWS = ["phone", "email", "address", "po_box", "website"];

/**
 * One inline SVG. Inline rather than a data-URI `<img>` so the gradient stops
 * are the tenant's colours rather than a re-encoded blob, and so the screenshot
 * has nothing extra to fetch. The gradient id is suffixed per row because five
 * `<defs>` in one document would otherwise collide on the first one.
 */
function icon(name, palette) {
  const def = ICONS[name];
  if (!def) return "";
  const id = `sig-grad-${name}`;
  const [from, to] = def.tone === "warm"
    ? [palette.warm, palette.warmDeep]
    : [palette.ink, palette.glow];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="url(#${id})" aria-hidden="true">`
    + `<defs><linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%">`
    + `<stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>`
    + `</linearGradient></defs><path d="${def.path}"/></svg>`;
}

/**
 * The stylesheet. Every number is from the original; every colour and family is
 * a parameter. Written as one string rather than assembled from objects because
 * it is transcribed CSS — keeping it readable as CSS is what lets someone diff
 * it against the generator it came from.
 */
function css(palette, fonts, embeddedFontCss) {
  const p = palette;
  return `${embeddedFontCss || ""}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${CARD_W}px;height:${CARD_H}px;background:${p.paper}}
body{font-family:'${fonts.body}',sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
.card{width:${CARD_W}px;height:${CARD_H}px;background:linear-gradient(135deg,${p.paper} 40%,${p.surface} 100%);position:relative;display:flex;flex-direction:column;justify-content:space-between;padding:22px 28px 16px 24px;overflow:hidden;border-radius:14px;box-shadow:0 8px 26px ${p.cardShadow};border:1px solid ${p.cardBorder}}
.top-accent-bar{position:absolute;top:0;left:0;width:100%;height:5px;background:linear-gradient(90deg,${p.ink} 0%,${p.glow} 50%,${p.warm} 100%)}
.top-section{display:flex;align-items:center;justify-content:space-between;height:220px;margin-top:4px;z-index:2}
.left-brand{width:225px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding-right:12px}
.logo-img{max-width:205px;max-height:180px;object-fit:contain;filter:drop-shadow(0 3px 8px ${p.logoShadow})}
.logo-fallback{font-size:20px;font-weight:800;color:${p.ink};letter-spacing:0.5px;line-height:1.2}
.divider-line{width:2px;height:185px;background:linear-gradient(180deg,${p.dividerTop} 0%,${p.ink} 50%,${p.dividerTail} 100%);margin:0 14px;border-radius:2px;flex-shrink:0}
.right-info{flex:1;padding-left:12px;display:flex;flex-direction:column;justify-content:center;min-width:0}
.person-name{font-size:25px;font-weight:800;color:${p.ink};letter-spacing:0.8px;line-height:1.15;margin-bottom:4px;text-transform:uppercase}
.person-title-row{display:flex;align-items:center;margin-bottom:14px}
.title-dash{width:32px;height:2.5px;background:linear-gradient(90deg,${p.warm},${p.warmDeep});margin-right:10px;border-radius:2px;flex-shrink:0}
.person-title{font-size:15px;font-weight:600;color:${p.title};letter-spacing:0.5px}
.contact-list{display:flex;flex-direction:column;gap:6.5px}
.contact-item{display:flex;align-items:center;font-size:13px;color:${p.body};line-height:1.3;font-weight:500}
.contact-icon{width:22px;height:22px;display:flex;align-items:center;justify-content:flex-start;margin-right:8px;flex-shrink:0}
.contact-text{white-space:nowrap}
.contact-web{color:${p.ink};font-weight:700}
.sig-banner{width:100%;height:52px;background:linear-gradient(90deg,${p.surface} 0%,${p.surfaceDeep} 50%,${p.surface} 100%);border:1px solid ${p.pillBorder};border-radius:50px;display:flex;align-items:center;justify-content:center;padding:0 18px;text-align:center;margin-top:auto;box-shadow:0 3px 12px ${p.pillShadow};z-index:2}
.banner-text{font-family:'${fonts.motto}',cursive;font-size:26px;color:${p.ink};letter-spacing:0.5px;line-height:1;padding-top:4px;white-space:nowrap}`;
}

/**
 * The card's own field set, pulled off the resolved block model.
 *
 * Phone and mobile share ONE row joined by a pipe, which is why this cannot
 * just reuse `contact_line`: that string is built for the email table, where the
 * email address is part of the same run. Here the email has its own row and its
 * own icon.
 */
function fields(model) {
  const m = model || {};
  const person = m.person || {};
  const contact = m.contact || {};
  const company = m.company || {};

  const phones = [contact.phone_desk, contact.phone_mobile]
    .map((v) => (v === null || v === undefined ? "" : String(v).trim()))
    .filter(Boolean);

  // NON-BREAKING spaces around the pipe, not ordinary ones. HTML collapses a
  // run of ordinary whitespace to a single space, which pulls the two numbers
  // ~8px closer together than the original card and is visible at a glance when
  // the old signature and the new one are open side by side.

  return {
    name: person.full_name || person.person_line || company.legal_name || "",
    title: person.job_title || person.department || "",
    phone: phones.join(" \u00a0|\u00a0 "),
    email: contact.email || "",
    // The street on its own — `address_line` is the joined string the email
    // table wants, and would repeat the P.O. Box row underneath it.
    address: company.street_line || company.address_line || "",
    po_box: company.po_box_line || "",
    website: company.website || "",
    motto: company.motto || "",
    // `logo_data` before `logo_url`: only inlined bytes load in headless
    // Chromium, which has no page origin to resolve a relative URL against.
    logo_url: company.logo_data || company.logo_url || "",
    legal_name: company.legal_name || "",
  };
}

function contactRow(name, value, palette) {
  if (!value) return "";
  const cls = name === "website" ? "contact-text contact-web" : "contact-text";
  return `<div class="contact-item"><div class="contact-icon">${icon(name, palette)}</div>`
    + `<span class="${cls}">${esc(value)}</span></div>`;
}

/**
 * The card element on its own — no <html> wrapper. Exported separately because
 * the browser preview renders exactly this inside the app shell, so what the
 * user approves on screen is the markup that gets screenshotted.
 */
function body(model, palette, options = {}) {
  const f = fields(model);
  const showLogo = options.show_logo !== false && Boolean(f.logo_url);
  const showMotto = options.show_motto !== false && Boolean(f.motto);

  const brand = showLogo
    ? `<img class="logo-img" src="${esc(f.logo_url)}" alt="${esc(f.legal_name || "Logo")}" />`
    // A tenant with no logo gets their name in the brand colour rather than an
    // empty 225px column, which would leave the card visibly lopsided.
    : `<div class="logo-fallback">${esc(f.legal_name)}</div>`;

  const rows = ROWS.map((name) => contactRow(name, f[name], palette)).join("");

  const banner = showMotto
    ? `<div class="sig-banner"><div class="banner-text">${esc(f.motto)}</div></div>`
    : "";

  return `<div class="card">
  <div class="top-accent-bar"></div>
  <div class="top-section">
    <div class="left-brand">${brand}</div>
    <div class="divider-line"></div>
    <div class="right-info">
      <div class="person-name">${esc(f.name)}</div>
      <div class="person-title-row"><div class="title-dash"></div><div class="person-title">${esc(f.title)}</div></div>
      <div class="contact-list">${rows}</div>
    </div>
  </div>
  ${banner}
</div>`;
}

/**
 * The complete document handed to Chromium.
 *
 * `embeddedFontCss` is injected rather than required so this module stays pure
 * and its tests never touch the filesystem — the same seam signature.png.js uses
 * for the screenshot function.
 */
function document(model, palette, fonts, embeddedFontCss = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css(palette, fonts, embeddedFontCss)}</style></head>`
    + `<body>${body(model, palette)}</body></html>`;
}

module.exports = { document, body, css, fields, icon, ICONS, ROWS, CARD_W, CARD_H };
