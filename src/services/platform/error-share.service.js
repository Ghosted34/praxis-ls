/**
 * Share payload builder — spec §3.3 and Appendix B.
 *
 * Built SERVER-SIDE, deliberately. The same error has to render four ways
 * (WhatsApp deep link, mailto, in-house notification, LLM-friendly clipboard
 * text) and the templates are specified verbatim in Appendix B. Assembling them
 * in the console would mean the templates live in the client bundle, drift the
 * moment a second client exists, and cannot be covered by an API test.
 *
 * Appendix A point 2 — "plain-text copy format, formatted specifically for LLM
 * pasting" — is the reason `plain` is a distinct field rather than a reuse of
 * the WhatsApp body: emoji and deep links are noise when the destination is a
 * model, and the fields it wants (full trace, exact location) are the ones
 * WhatsApp truncates.
 */

"use strict";

const { config } = require("../../config/env");

const LEVEL_BADGE = {
  fatal: "🔴",
  error: "🟠",
  warning: "🟡",
  notice: "🔵",
  info: "⚪",
};

/**
 * Where the console lives, for the deep link back. Prefers the configured
 * console host; falls back to the request's own origin so a dev box produces
 * working links instead of links to production.
 */
function consoleBaseUrl(req) {
  const configured = config.PLATFORM_CONSOLE_HOST;
  if (configured) return `https://${String(configured).replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  if (req) {
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const host = req.headers.host;
    if (host) return `${proto}://${host}`;
  }
  return "";
}

const truncate = (s, n) => {
  const str = String(s || "");
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

/** Human "3 hours ago" — Appendix B's templates read as relative time. */
function ago(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "—";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function deepLink(baseUrl, row) {
  if (!baseUrl) return "";
  // HashRouter — the console's routes live after the #.
  return `${baseUrl}/#/error-center?sig=${encodeURIComponent(row.signature)}`;
}

function location(row) {
  if (!row.file_path) return "—";
  return row.line_number ? `${row.file_path}:${row.line_number}` : row.file_path;
}

function stackText(row, max = 12) {
  const frames = Array.isArray(row.stack_trace) ? row.stack_trace.slice(0, max) : [];
  if (!frames.length) return row.raw_stack ? String(row.raw_stack).slice(0, 2000) : "—";
  return frames.map((f) => `    at ${f.function || "?"} (${f.file || "?"}:${f.line || "?"})`).join("\n");
}

/** Appendix B — WhatsApp. */
function whatsappText(row, url) {
  return [
    `${LEVEL_BADGE[row.level] || "⚪"} [PRAXIS-LS] ${row.level === "fatal" ? "Fatal Error" : "Error"} Detected`,
    "",
    `❗ Error: ${truncate(row.message, 300)}`,
    `📦 Module: ${row.module || "—"}`,
    `🔗 Route: ${row.route || "—"}`,
    `📄 Location: ${location(row)}`,
    `⏱ Occurred: ${ago(row.first_seen)}`,
    `🔁 Count: ${row.occurrence_count}`,
    row.tenant_slug ? `🏢 Tenant: ${row.tenant_slug}` : "🌐 Scope: platform-wide",
    url ? "" : null,
    url ? `🔗 View in Admin: ${url}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** Appendix B — email subject + body. */
function emailSubject(row) {
  return `[PRAXIS-LS] [${String(row.level).toUpperCase()}] ${row.module || "Platform"} — ${truncate(row.message, 60)}`;
}

function emailBody(row, url) {
  return [
    `Error Level: ${row.level}`,
    `Module: ${row.module || "—"}`,
    `Route: ${row.route || "—"}`,
    `File: ${location(row)}`,
    `First Occurrence: ${row.first_seen}`,
    `Recent Occurrence: ${row.last_seen}`,
    `Occurrence Count: ${row.occurrence_count}`,
    row.tenant_slug ? `Tenant: ${row.tenant_slug}` : "Scope: platform-wide",
    "",
    "Message:",
    row.message,
    "",
    "Stack Trace:",
    stackText(row),
    "",
    url ? "View in Admin Dashboard:" : "",
    url || "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * Appendix A point 2 — the clipboard format aimed at an LLM. No emoji, no deep
 * link, everything a model needs to reason about the fault and nothing it has
 * to ignore.
 */
function plainText(row) {
  return [
    `[${String(row.level).toUpperCase()} ×${row.occurrence_count}] ${row.name || "Error"}: ${row.message}`,
    `Module: ${row.module || "—"} | Route: ${row.route || "—"}`,
    `File: ${location(row)}`,
    `Origin: ${row.origin} | Release: ${row.release || "—"} | Env: ${row.env || "—"}`,
    `First seen: ${row.first_seen} | Last seen: ${row.last_seen}`,
    row.tenant_slug ? `Tenant: ${row.tenant_slug}` : "Scope: platform-wide",
    "",
    "Stack trace:",
    stackText(row, 20),
  ].join("\n");
}

/** Appendix B — in-house notification. */
function inHouse(row) {
  return {
    title: `[${String(row.level).toUpperCase()}] ${row.module || "Platform"}`,
    body: `${truncate(row.message, 120)} — ${row.occurrence_count} occurrence${row.occurrence_count === 1 ? "" : "s"}`,
    metadata: {
      error_id: row.id,
      error_signature: row.signature,
      module: row.module,
      route: row.route,
    },
  };
}

/**
 * @returns everything the share modal needs, pre-rendered.
 * `whatsapp_url` and `mailto_url` are ready to assign to window.location — the
 * console does no encoding of its own, which is where these usually break.
 */
function build(row, { baseUrl = "" } = {}) {
  const url = deepLink(baseUrl, row);
  const wa = whatsappText(row, url);
  const subject = emailSubject(row);
  const body = emailBody(row, url);

  return {
    url,
    whatsapp: { text: wa, url: `https://wa.me/?text=${encodeURIComponent(wa)}` },
    email: {
      subject,
      body,
      url: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    },
    in_house: inHouse(row),
    plain: plainText(row),
  };
}

module.exports = { build, consoleBaseUrl, whatsappText, emailSubject, emailBody, plainText, inHouse };
