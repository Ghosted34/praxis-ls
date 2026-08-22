/**
 * The two emails a signing chain sends: the link, and the code.
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §6.4, §3.14.
 *
 * ── Why the OTP email says what the code DOES ──────────────────────────────
 * §6.4 is explicit: *"No branding-only email that leaves the reader unsure
 * what they are approving."* A six-digit code with a logo above it is what
 * every phishing kit produces. Naming the document, the counterparty and the
 * expiry — and telling the reader what to do if they were not expecting it —
 * is the difference between a control and a formality.
 *
 * Both go through `email.service.send` with `purpose: "DOCUMENTS"`, so they
 * leave from the tenant's configured documents sender and land in
 * `email_send_log` like every other system mail. A signing email that bypassed
 * the send log would be the one piece of the evidence trail with no record.
 *
 * Bilingual, resolved from the PARTY's language and not the operator's: the
 * person reading it is the counterparty.
 */
"use strict";

const emailService = require("../../../services/email.service");
const { OTP } = require("../../../services/signatures/otp");

const t = (pair, lang) => (lang === "en" ? pair.en : pair.fr);
const esc = (s) => String(s === null || s === undefined ? "" : s)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * A plain, legible frame. No images, no tracking pixel, no vendor mark.
 *
 * The stacks are the ones the rest of the product's mail uses (portal_auth,
 * notification.service), and they are from the SHIPPED font library rather than
 * a system stack — `scripts/check-fonts.mjs` is the gate. A font name that
 * resolves to nothing does not error; it substitutes, silently, and the OTP
 * code is the one string in this file where substitution changes whether six
 * digits are legible.
 */
const shell = (bodyHtml) => `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Roboto,'Noto Sans',sans-serif;color:#101e34">
  <div style="max-width:560px;margin:0 auto;padding:28px 24px">${bodyHtml}</div>
</body></html>`;

const button = (href, label) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="display:inline-block;padding:12px 22px;background:#101e34;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">${esc(label)}</a></p>`;

/**
 * "Please sign this document."
 *
 * The link is the credential (§3.7), so the copy says so plainly rather than
 * treating it as an ordinary URL — a signer who forwards it has forwarded the
 * ability to sign as them.
 */
function signingLinkEmail({ party, request, url, tenantName, language }) {
  const lang = language === "en" ? "en" : "fr";
  const subject = t({
    fr: `Signature demandée — ${request.doc_type_label || request.doc_type}`,
    en: `Signature requested — ${request.doc_type_label || request.doc_type}`,
  }, lang);

  const lines = t({
    fr: [
      `Bonjour ${party.full_name},`,
      `${tenantName} vous demande de signer un document (${request.doc_type_label || request.doc_type}).`,
      request.message ? `Message de l'expéditeur : « ${request.message} »` : "",
      "Ce lien vous est personnel : toute personne qui l'ouvre peut signer en votre nom. Ne le transférez pas.",
      request.expires_at ? `Il expire le ${new Date(request.expires_at).toLocaleDateString("fr-FR")}.` : "",
    ],
    en: [
      `Hello ${party.full_name},`,
      `${tenantName} has asked you to sign a document (${request.doc_type_label || request.doc_type}).`,
      request.message ? `Message from the sender: “${request.message}”` : "",
      "This link is personal to you: anyone who opens it can sign in your name. Please do not forward it.",
      request.expires_at ? `It expires on ${new Date(request.expires_at).toLocaleDateString("en-GB")}.` : "",
    ],
  }, lang).filter(Boolean);

  const html = shell(
    lines.map((l) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.55">${esc(l)}</p>`).join("")
    + button(url, t({ fr: "Ouvrir le document", en: "Open the document" }, lang)),
  );
  return { subject, html, text: `${lines.join("\n\n")}\n\n${url}` };
}

/**
 * "Here is your code."
 *
 * States what the code AUTHORISES, in the first line. A reader who was not
 * expecting it is told what to do — reply — rather than left to guess.
 */
function otpEmail({ party, request, code, tenantName, language }) {
  const lang = language === "en" ? "en" : "fr";
  const doc = request.doc_type_label || request.doc_type;
  const subject = t({
    fr: `Votre code de signature — ${doc}`,
    en: `Your signing code — ${doc}`,
  }, lang);

  const lead = t({
    fr: `Ce code signe « ${doc} » pour ${tenantName}. Il expire dans ${OTP.TTL_MINUTES} minutes.`,
    en: `This code signs “${doc}” for ${tenantName}. It expires in ${OTP.TTL_MINUTES} minutes.`,
  }, lang);
  const warn = t({
    fr: "Si vous n'attendiez pas ce message, ne saisissez pas ce code et répondez à cet e-mail.",
    en: "If you were not expecting this, do not enter the code and reply to this message.",
  }, lang);

  const html = shell(
    `<p style="margin:0 0 8px;font-size:14px;line-height:1.55">${esc(`${t({ fr: "Bonjour", en: "Hello" }, lang)} ${party.full_name},`)}</p>`
    + `<p style="margin:0 0 20px;font-size:14px;line-height:1.55">${esc(lead)}</p>`
    + `<p style="margin:0 0 20px;font-family:'JetBrains Mono',monospace;font-size:34px;letter-spacing:.28em;font-weight:700">${esc(code)}</p>`
    + `<p style="margin:0;font-size:12.5px;line-height:1.5;color:#6b7a90">${esc(warn)}</p>`,
  );
  return { subject, html, text: `${lead}\n\n${code}\n\n${warn}` };
}

/** Send, through the tenant's documents identity, into the send log. */
function send(client, { to, subject, html, text, entityRef, documentVaultId = null, sendPoint }) {
  return emailService.send(client, {
    to, subject, html, text,
    purpose: "DOCUMENTS",
    moduleKey: "MOD-64",
    entityRef,
    documentVaultId,
    sendPoint,
  });
}

/**
 * The nudge.
 *
 * It says the earlier link has stopped working, because it has: the reminder
 * mints a fresh token and the old one dies (see
 * `signature_request.service.remintSignToken` for why). A signer who still has
 * the first message and finds it dead deserves to have been told, and a reader
 * who was not expecting any of this needs the sender named.
 */
function reminderEmail({ party, request, url, tenantName, language, nudge }) {
  const lang = language === "en" ? "en" : "fr";
  const doc = request.doc_type_label || request.doc_type;
  const subject = t({
    fr: `Rappel — signature en attente (${doc})`,
    en: `Reminder — a signature is still outstanding (${doc})`,
  }, lang);

  const lines = t({
    fr: [
      `Bonjour ${party.full_name},`,
      `${tenantName} attend toujours votre signature sur « ${doc} ».`,
      "Ce message contient un NOUVEAU lien : celui que vous avez reçu précédemment ne fonctionne plus.",
      nudge >= 2 ? "C'est notre dernier rappel." : "",
      request.expires_at ? `La demande expire le ${new Date(request.expires_at).toLocaleDateString("fr-FR")}.` : "",
    ],
    en: [
      `Hello ${party.full_name},`,
      `${tenantName} is still waiting for your signature on “${doc}”.`,
      "This message contains a NEW link — the one you were sent earlier no longer works.",
      nudge >= 2 ? "This is our last reminder." : "",
      request.expires_at ? `The request expires on ${new Date(request.expires_at).toLocaleDateString("en-GB")}.` : "",
    ],
  }, lang).filter(Boolean);

  const html = shell(
    lines.map((l) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.55">${esc(l)}</p>`).join("")
    + button(url, t({ fr: "Ouvrir le document", en: "Open the document" }, lang)),
  );
  return { subject, html, text: `${lines.join("\n\n")}\n\n${url}` };
}

module.exports = { signingLinkEmail, otpEmail, reminderEmail, send };
