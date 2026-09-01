/**
 * Signature HTML — PURE. Same email-safe rules as mail.compose.js:
 * tables, inline styles, web-safe font stack, no <style>, no classes, no
 * flex/grid, no CSS variables, logo as absolute HTTPS with alt + width +
 * display:block.
 *
 * TWO KINDS, TWO RELATIONSHIPS TO THE PNG.
 *
 * For `classic` and `compact`, the PNG renderer screenshots THIS output, so the
 * two cannot drift: they share one HTML.
 *
 * For `card` they do not, and cannot — the card is flexbox, gradients and two
 * webfonts, none of which an email client can render (signature.card.js explains
 * why at length). There the PNG is screenshotted from the card document and this
 * file emits the `<img>` plus a live-text fallback. What keeps THOSE two honest
 * is that both are computed from the same resolved model, and
 * `mail-signature.test.js` asserts their text content is identical — the
 * drift-guard moved from "one HTML" to "one model", it did not disappear.
 */
"use strict";

const { textContent } = require("./signature.resolve");

const FONT = "Arial, Helvetica, sans-serif";

function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cell(html, style) {
  return `<td style="${style}">${html}</td>`;
}

function line(text, style) {
  if (!text) return "";
  return `<div style="${style}">${esc(text)}</div>`;
}

/**
 * @param {object} model  output of signature.resolve
 * @returns {string} email-safe HTML fragment (not a full document)
 */
function render(model) {
  if (!model) return "";
  const brand = model.brand_color || "#0f4c81";
  const accent = model.accent_color || "#c9a227";
  const width = Number(model.width_px) || 650;
  const p = model.person || {};
  const c = model.contact || {};
  const co = model.company || {};
  const kind = model.kind || "classic";

  if (kind === "card") {
    return cardHtml({ width, brand, p, c, co, model });
  }
  if (kind === "compact") {
    return compactHtml({ width, brand, p, c, co });
  }
  return classicHtml({ width, brand, accent, p, c, co, model });
}

/**
 * The CARD, as an email body: the rendered PNG, with the same content as live
 * text underneath it.
 *
 * WHY BOTH, and not just the image. The card is a designed object — Montserrat,
 * a script motto, four gradients — and no email client can lay that out (see
 * the header of signature.card.js). A picture of it is the only way a recipient
 * sees what the tenant designed. But an image alone is a bad signature: Outlook
 * and Gmail block remote images by default for unknown senders, so the first
 * mail a new client receives would carry a grey box where the sender's phone
 * number should be; a screen reader gets one alt string instead of a contact
 * block; and a mail full of image and empty of text scores worse with spam
 * filters. So the image carries the design and the text carries the content,
 * and a recipient who has images turned off still gets a working signature
 * rather than a broken one.
 *
 * The text half is deliberately the SAME markup the classic layout emits —
 * tables, inline styles, web-safe stack — because it is the half that has to
 * survive Outlook's Word engine.
 */
function cardHtml({ width, brand, p, c, co, model }) {
  const src = model.card_png_url || "";
  const alt = [p.person_line || p.department, p.job_title, co.legal_name]
    .filter(Boolean).join(" — ");

  const image = src
    ? `<tr><td style="padding:0 0 8px 0"><img src="${esc(src)}" alt="${esc(alt)}" width="${width}" style="display:block;width:${width}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none" /></td></tr>`
    : "";

  const text = line(p.person_line, `font-weight:bold;color:${brand};font-size:14px;line-height:20px`)
    + line(p.job_title, "color:#111827;font-size:12px;line-height:18px")
    + line(c.contact_line, "color:#374151;font-size:12px;line-height:18px;margin-top:6px")
    + line(co.legal_name, "color:#111827;font-size:12px;line-height:18px;margin-top:6px")
    + line(co.address_line, "color:#6b7280;font-size:12px;line-height:18px")
    + line(joinPhoneWeb(co), "color:#6b7280;font-size:12px;line-height:18px")
    + line(co.motto, "color:#6b7280;font-size:11px;line-height:16px;margin-top:6px")
    + line(co.confidentiality, "color:#9ca3af;font-size:10px;line-height:14px;margin-top:8px");

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${width}" style="width:${width}px;border-collapse:collapse;font-family:${FONT};max-width:${width}px">
  ${image}
  <tr>${cell(text, "padding:0")}</tr>
</table>`;
}

function compactHtml({ width, brand, p, c, co }) {
  const nameTitle = [p.person_line, p.job_title].filter(Boolean).join(" · ");
  const companyWeb = [co.legal_name, co.website].filter(Boolean).join(" · ");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${width}" style="width:${width}px;border-collapse:collapse;font-family:${FONT};font-size:13px;color:#111827;max-width:${width}px">
  <tr>${cell(
    line(nameTitle, `font-weight:bold;color:${brand};font-size:14px;line-height:20px`)
    + line(c.contact_line, "color:#374151;line-height:18px;margin-top:2px")
    + line(companyWeb, "color:#6b7280;line-height:18px;margin-top:2px"),
    "padding:0",
  )}</tr>
</table>`;
}

function classicHtml({ width, brand, accent, p, c, co, model }) {
  const logo = model.show_logo && co.logo_url
    ? `<img src="${esc(co.logo_url)}" alt="${esc(co.legal_name || "Logo")}" width="96" style="display:block;width:96px;border:0;outline:none" />`
    : "";
  const left = logo
    ? `<td width="120" valign="top" style="width:120px;padding:12px;border:1px solid ${accent};background:#ffffff">${logo}</td>`
    : "";
  const name = p.person_line || (model.system ? (p.department || co.legal_name) : "");
  const body = line(name, `font-weight:bold;color:${brand};font-size:16px;line-height:22px`)
    + line(p.job_title, "color:#111827;font-size:13px;line-height:18px")
    + line(p.department, "color:#6b7280;font-size:12px;line-height:18px")
    + line(c.contact_line, "color:#374151;font-size:12px;line-height:18px;margin-top:8px")
    + line(c.whatsapp && `WhatsApp ${c.whatsapp}`, "color:#374151;font-size:12px;line-height:18px")
    + (c.booking_url
      ? `<div style="margin-top:4px"><a href="${esc(c.booking_url)}" target="_blank" rel="noopener noreferrer" style="color:${brand};text-decoration:underline">${esc(c.booking_url)}</a></div>`
      : "")
    + line(co.legal_name, "color:#111827;font-size:12px;line-height:18px;margin-top:8px")
    + line(co.address_line, "color:#6b7280;font-size:12px;line-height:18px")
    + line(joinPhoneWeb(co), "color:#6b7280;font-size:12px;line-height:18px")
    + line(co.legal_line, "color:#6b7280;font-size:11px;line-height:16px;margin-top:6px")
    + line(co.confidentiality, "color:#9ca3af;font-size:10px;line-height:14px;margin-top:8px");

  const motto = model.show_motto_bar && co.motto
    ? `<tr><td colspan="2" style="background:${brand};color:#ffffff;font-family:${FONT};font-size:11px;letter-spacing:0.04em;padding:8px 12px;text-align:center">${esc(co.motto)}</td></tr>`
    : "";

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${width}" style="width:${width}px;border-collapse:collapse;font-family:${FONT};max-width:${width}px">
  <tr>${left}${cell(body, "padding:12px 16px;vertical-align:top")}</tr>
  ${motto}
</table>`;
}

function joinPhoneWeb(co) {
  return [co.phone, co.website].filter(Boolean).join(" · ");
}

/**
 * Append a signature fragment below a serialized message without re-parsing it.
 * The serializer already produced a full HTML document; we inject before </body>.
 */
function appendToHtml(html, signatureHtml) {
  if (!signatureHtml) return html || "";
  const block = `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb">${signatureHtml}</div>`;
  const src = String(html || "");
  if (/<\/body>/i.test(src)) return src.replace(/<\/body>/i, `${block}</body>`);
  return src + block;
}

function appendToText(text, signatureText) {
  if (!signatureText) return text || "";
  const body = String(text || "").trimEnd();
  const sig = String(signatureText).trimStart();
  return body ? `${body}\n\n-- \n${sig}` : `-- \n${sig}`;
}

module.exports = { render, appendToHtml, appendToText, textContent, esc };
