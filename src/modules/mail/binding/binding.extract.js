/**
 * Binding signals — PURE. Ingest writes SUGGESTIONS, never entity_ref (Q18).
 *
 * Scan order: subject, first 4 KB of body, attachment filenames. Quoted history
 * last and at reduced confidence — a reference inside a forwarded chain often
 * belongs to a different shipment.
 */
"use strict";

const REF = /[A-Za-z0-9]{2,}-\d{4}-\d{2,}/g;
const AWB = /\b\d{3}-\d{8}\b/g;
const QUOTE_MARKERS = /^(>+\s|On .+ wrote:|Le .+ a écrit)/im;

/**
 * ISO 6346 check digit. An unvalidated 11-character token matches all sorts of
 * things; the check digit removes essentially all false positives.
 *
 * Letters map A=10 … skipping multiples of 11. Weight = 2^position.
 * Check digit = sum % 11, with 10 written as 0.
 */
function iso6346Valid(raw) {
  const s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{4}\d{7}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = s[i];
    let n;
    if (ch >= "0" && ch <= "9") n = ch.charCodeAt(0) - 48;
    else {
      n = ch.charCodeAt(0) - 65 + 10;
      if (n >= 11) n += 1;
      if (n >= 22) n += 1;
      if (n >= 33) n += 1;
    }
    sum += n * (2 ** i);
  }
  const check = sum % 11 % 10;
  return check === Number(s[10]);
}

function splitQuoted(text) {
  const lines = String(text || "").split(/\r?\n/);
  const head = [];
  const quoted = [];
  let inQuote = false;
  for (const line of lines) {
    if (QUOTE_MARKERS.test(line) || /^>/.test(line)) inQuote = true;
    (inQuote ? quoted : head).push(line);
  }
  return { head: head.join("\n"), quoted: quoted.join("\n") };
}

/**
 * @param {object} message { subject, body_text, from_address, filenames[] }
 * @param {object} world   { dossiers, invoices, pos, quotes, contacts, domains, existingBinding }
 * @returns {Array<{signal, entity_ref, entity_label, matched_text, confidence}>}
 */
function extract(message = {}, world = {}) {
  const subject = String(message.subject || "");
  const body = String(message.body_text || "").slice(0, 4096);
  const { head, quoted } = splitQuoted(body);
  const filenames = (message.filenames || []).join(" ");
  const from = String(message.from_address || "").toLowerCase();
  const domain = from.includes("@") ? from.split("@")[1] : "";

  const out = [];
  const seen = new Set();
  const add = (s) => {
    const key = `${s.signal}|${s.entity_ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  if (world.existingBinding) {
    add({
      signal: "THREAD_HISTORY",
      entity_ref: world.existingBinding.entity_ref,
      entity_label: world.existingBinding.entity_label || null,
      matched_text: null,
      confidence: 0.99,
    });
  }

  const scan = (text, confMul) => {
    const refs = text.match(REF) || [];
    for (const r of refs) {
      const d = (world.dossiers || []).find((x) => String(x.ref).toUpperCase() === r.toUpperCase());
      if (d) add({ signal: "DOSSIER_REF", entity_ref: `dossier:${d.dossier_id}`, entity_label: d.ref, matched_text: r, confidence: round(0.97 * confMul) });
      const inv = (world.invoices || []).find((x) => String(x.doc_number).toUpperCase() === r.toUpperCase());
      if (inv) add({ signal: "INVOICE_REF", entity_ref: `invoice:${inv.invoice_id}`, entity_label: inv.doc_number, matched_text: r, confidence: round(0.95 * confMul) });
      const po = (world.pos || []).find((x) => String(x.doc_number).toUpperCase() === r.toUpperCase());
      if (po) add({ signal: "PO_REF", entity_ref: `po:${po.po_id}`, entity_label: po.doc_number, matched_text: r, confidence: round(0.95 * confMul) });
      const q = (world.quotes || []).find((x) => String(x.doc_number).toUpperCase() === r.toUpperCase());
      if (q) add({ signal: "QUOTE_REF", entity_ref: `quotation:${q.quotation_id}`, entity_label: q.doc_number, matched_text: r, confidence: round(0.92 * confMul) });
    }
    const awbs = text.match(AWB) || [];
    for (const a of awbs) {
      const d = (world.dossiers || []).find((x) => String(x.bl_awb || "").replace(/\s/g, "") === a.replace(/\s/g, ""));
      if (d) add({ signal: "BL_AWB_NO", entity_ref: `dossier:${d.dossier_id}`, entity_label: d.ref, matched_text: a, confidence: round(0.88 * confMul) });
    }
    const tokens = text.toUpperCase().match(/\b[A-Z]{4}\d{7}\b/g) || [];
    for (const t of tokens) {
      if (!iso6346Valid(t)) continue;
      const d = (world.dossiers || []).find((x) => String(x.container_no || "").toUpperCase().replace(/[^A-Z0-9]/g, "") === t);
      if (d) add({ signal: "CONTAINER_NO", entity_ref: `dossier:${d.dossier_id}`, entity_label: d.ref, matched_text: t, confidence: round(0.90 * confMul) });
    }
  };

  scan(subject, 1);
  scan(head, 1);
  scan(filenames, 1);
  scan(quoted, 0.6);

  const contact = (world.contacts || []).find((c) => String(c.email || "").toLowerCase() === from);
  if (contact) {
    add({
      signal: "SENDER_ADDRESS",
      entity_ref: contact.entity_ref,
      entity_label: contact.label || from,
      matched_text: from,
      confidence: 0.85,
    });
  }
  const dom = (world.domains || []).find((d) => d.domain === domain);
  if (dom) {
    add({
      signal: "SENDER_DOMAIN",
      entity_ref: dom.entity_ref,
      entity_label: dom.label || domain,
      matched_text: domain,
      confidence: 0.55,
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

function round(n) {
  return Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000;
}

module.exports = { extract, iso6346Valid, splitQuoted };
