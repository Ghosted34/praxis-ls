/**
 * PDF service (KB §8.4). Renders HTML → PDF (Puppeteer/Chromium, lazily required
 * so importing this module never launches a browser), stores it via the storage
 * driver, computes the SHA-256 content DNA, and captures it in document_vault
 * with a QR-verifiable token. Runs from the `pdf` worker job.
 */
"use strict";

const crypto = require("crypto");
const { config } = require("../config/env");
const storage = require("./storage.service");
const documents = require("./documents/document.service");
const { getSetting } = require("../shared/config/settings");
const { assertDocType } = require("../modules/vault/document_vault/document_vault.types");
const { AppError } = require("../utils/errors");

/** SHA-256 hex of the rendered bytes — the doc DNA a QR resolves and re-checks. */
function contentHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** QR-encodable verification token. */
function verifyToken(entityRef, hash) {
  return "praxis://verify/" + entityRef + "?h=" + String(hash).slice(0, 16);
}

/** Render HTML to a PDF Buffer. Chromium comes from PUPPETEER_EXECUTABLE_PATH. */
async function renderHtml(html) {
  /// eslint-disable-next-line global-require
  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({
    executablePath: config.PUPPETEER_EXECUTABLE_PATH || undefined,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    return await page.pdf({ format: "A4", printBackground: true });
  } finally {
    await browser.close();
  }
}

/**
 * Render → store → capture. `key` is the storage key (tenant-namespaced by the
 * caller). Returns { key, public_url, content_hash, verify }. `render` is
 * injectable for tests.
 */
async function renderAndStore(client, { html, key, entityRef, docType, render = renderHtml }) {
  const buffer = await render(html);
  const hash = contentHash(buffer);
  const stored = await storage.put(buffer, { key, contentType: "application/pdf" });
  await documents.capture(client, { entityRef, docType, storagePath: stored.key, contentHash: hash, status: "VERIFIED" });
  return { key: stored.key, public_url: stored.public_url, content_hash: hash, verify: verifyToken(entityRef, hash) };
}

// ── Template-driven rendering (GAP_FIXES_PLAN §5.1) ───────────────────────────
// The `document_template` setting (§1.1) was validated on write but never read:
// renderAndStore took fully-formed `html` from the caller, so a tenant's
// body_html / css_vars / published status rendered nothing. renderDocType closes
// that gap — it resolves the template a tenant configured for a doc_type and is
// the enforcement point for the "settings are a contract" rule.

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/** Resolve {{ path.to.value }} placeholders against `data` (HTML-escaped). */
function interpolate(body, data) {
  return String(body || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path) => {
    const v = path.split(".").reduce((o, k) => (o === null || o === undefined ? o : o[k]), data);
    return v === null || v === undefined ? "" : escapeHtml(v);
  });
}

/** Turn the template's css_vars object into a :root custom-property block. */
function cssVarsBlock(vars) {
  if (!vars || typeof vars !== "object" || Array.isArray(vars)) return "";
  const decls = Object.entries(vars)
    .map(([k, v]) => "--" + String(k).replace(/[^\w-]/g, "") + ": " + String(v) + ";")
    .join(" ");
  return decls ? "<style>:root{" + decls + "}</style>" : "";
}

/** Assemble a full HTML document from a resolved template + row data. */
function buildHtml(template, data) {
  const body = interpolate(template.body_html, data);
  return "<!doctype html><html><head><meta charset=\"utf-8\">"
    + cssVarsBlock(template.css_vars)
    + "</head><body>" + body + "</body></html>";
}

/**
 * Render a document from the tenant's configured template for `docType`, then
 * store + capture it (via renderAndStore). Enforces the template contract:
 *  - unknown docType            → UNKNOWN_DOC_TYPE (422, via the registry)
 *  - no template configured     → NOT_CONFIGURED  (422)
 *  - template not published     → TEMPLATE_NOT_PUBLISHED (409)
 * `data` is the row/context the template interpolates. `render` is injectable
 * for tests. Returns the same shape as renderAndStore.
 */
async function renderDocType(client, { docType, data = {}, entityRef, key, render = renderHtml }) {
  assertDocType(docType);
  if (docType === null || docType === undefined) throw new AppError("NO_DOC_TYPE", "docType is required to resolve a template", 422);
  if (!entityRef) throw new AppError("NO_ENTITY_REF", "entityRef is required", 422);
  const template = await getSetting(client, "document_template", docType, null);
  if (!template || typeof template !== "object") {
    // 424 CONFIG_MISSING — the request was valid; the template that would
    // render it hasn't been set up yet. The client renders a callout with a
    // link straight to the templates screen, so the user isn't left staring
    // at "Something went wrong" with no path forward.
    throw new AppError(
      "CONFIG_MISSING",
      `No '${docType}' document template has been set up yet.`,
      424,
      {
        setting_key: `document_template.${docType}`,
        settings_route: "/settings/document-templates",
        feature: `${docType} PDF rendering`,
      },
    );
  }
  const status = template.status || "draft";
  if (status !== "published") {
    throw new AppError("TEMPLATE_NOT_PUBLISHED", "document_template '" + docType + "' is '" + status + "'; publish it to render", 409);
  }
  const html = buildHtml(template, data);
  return renderAndStore(client, { html, key, entityRef, docType, render });
}

module.exports = {
  contentHash, verifyToken, renderHtml, renderAndStore,
  renderDocType, interpolate, cssVarsBlock, buildHtml,
};
