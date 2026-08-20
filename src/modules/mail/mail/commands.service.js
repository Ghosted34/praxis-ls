/**
 * The slash-command registry: which commands this person may run, and running one.
 *
 * ── FILTERING IS NOT COSMETIC ───────────────────────────────────────────────
 *
 * `list()` returns only the commands the caller holds the grant for, and `run()`
 * re-checks before it resolves anything. Both, not one: the list decides what is
 * OFFERED and the check decides what HAPPENS, and a client can call `run`
 * directly whatever the menu showed it.
 *
 * The thing being protected is specific. A composer lets an operator ask the
 * system for data and paste it into a message that leaves the company. Without
 * the check, a clerk who cannot open Treasury could still put the company's bank
 * details into an email — and nothing in the mail module would look wrong while
 * it happened.
 *
 * ── A COMMAND RETURNS NODES, NOT HTML ───────────────────────────────────────
 *
 * `run()` hands back a TipTap `erpBlock` whose content is ordinary nodes. The
 * serializer escapes them like anything else, so there is no path by which a
 * command's output — or something shaped like one — becomes markup in a sent
 * message. See the header of compose.js for why that boundary is where it is.
 */
"use strict";

const manifest = require("./mail.commands");
const identityCache = require("../../../shared/cache/identity-cache");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const ACTION_COLUMN = { view: "can_read", create: "can_create", edit: "can_update", delete: "can_delete" };

/**
 * Does this user hold `action` on `moduleKey`?
 *
 * A CEO holds everything — the same rule the route gate applies, restated here
 * because this is a second gate and not a call through the first one.
 * A command with no module needs nothing beyond being signed in.
 */
async function holds(client, user, moduleKey, action) {
  if (!moduleKey) return true;
  if (!user || !user.user_id) return false;
  if (user.is_ceo === true) return true;
  const column = ACTION_COLUMN[action || "view"] || "can_read";
  const grants = await identityCache.getGrants(client, { role_ids: user.role_ids, module: moduleKey });
  return grants.some((g) => g[column] === true);
}

const descriptor = (c, lang, allowed) => ({
  key: c.key,
  label: (String(lang).startsWith("fr") ? c.label_fr : c.label_en) || c.label_en,
  description: (String(lang).startsWith("fr") ? c.describe_fr : c.describe_en) || c.describe_en,
  params: c.params || [],
  module_key: c.module_key,
  attaches: Boolean(c.attaches),
  available: c.available !== false && allowed,
  // Why it is not available, in the user's words. A greyed-out command with no
  // explanation is worse than one that is absent.
  unavailable_reason: c.available === false
    ? ((String(lang).startsWith("fr") ? c.unavailable_fr : c.unavailable_en) || null)
    : (allowed ? null : (String(lang).startsWith("fr")
      ? "Vous n'avez pas accès à ces données."
      : "You do not have access to this data.")),
});

/**
 * The menu.
 *
 * Commands the caller cannot run are RETURNED but marked unavailable with a
 * reason, rather than omitted. Someone who has been told about `/bank` by a
 * colleague and finds nothing when they type it will file a bug; someone who
 * sees it greyed out with "you do not have access to this data" will not.
 */
async function list(client, user, { lang = "en" } = {}) {
  const out = [];
  for (const c of manifest) {
     
    const allowed = await holds(client, user, c.module_key, c.permission);
    out.push(descriptor(c, lang, allowed));
  }
  return out;
}

function find(key) {
  const c = manifest.find((x) => x.key === String(key || "").toLowerCase());
  if (!c) throw new AppError("NOT_FOUND", `There is no /${key} command.`, 404);
  return c;
}

/**
 * Run one command and return the block to insert.
 *
 * The permission is re-checked here even though `list` already filtered: the
 * menu is a hint and this is the gate. A 403 rather than a 404, because the
 * command's existence is not the secret — the data behind it is.
 */
async function run(client, user, key, params = {}, ctx = {}) {
  const c = find(key);
  const lang = String(ctx.lang || "en").toLowerCase().startsWith("fr") ? "fr" : "en";

  if (c.available === false) {
    throw new AppError("NOT_ENABLED", (lang === "fr" ? c.unavailable_fr : c.unavailable_en)
      || "That command is not enabled yet.", 400);
  }
  if (!(await holds(client, user, c.module_key, c.permission))) {
    throw new AppError(
      "PERMISSION_DENIED",
      lang === "fr"
        ? `Vous n'avez pas accès aux données de /${c.key}.`
        : `You do not have access to the data behind /${c.key}.`,
      403,
    );
  }

  const data = await c.resolve(client, params, { ...ctx, user, lang });
  if (!data) throw new AppError("NOT_FOUND", lang === "fr" ? "Introuvable." : "Not found.", 404);

  const { label, nodes } = c.render(data, lang);
  return {
    key: c.key,
    // A TipTap erpBlock. Its content is pinned NOW — the numbers must not move
    // under a message the sender is about to approve.
    node: {
      type: "erpBlock",
      attrs: { command: c.key, label: label || null, pinned_at: new Date().toISOString() },
      content: nodes,
    },
    // Present only for /document, whose block names a file the caller then
    // attaches. Everything else inserts data and attaches nothing.
    attach: c.attaches ? { vault_id: data.doc_id || data.vault_id || null } : null,
  };
}

/**
 * Boot check: every entry is well formed and names a real module.
 *
 * A key that is not in `platform.module_catalogue` has grants for nobody and
 * 403s every non-CEO user, and the failure looks like a permissions problem
 * rather than a typo. This file was written against a plan whose six suggested
 * keys were five-sixths wrong, so the check earns its place. Called by the test
 * suite; logs rather than throws at boot, because one bad command must not stop
 * the server from serving mail.
 */
function validateManifest(catalogueKeys = null) {
  const problems = [];
  const seen = new Set();
  for (const c of manifest) {
    if (!c.key || !/^[a-z][a-z0-9_]*$/.test(c.key)) problems.push(`bad key: ${JSON.stringify(c.key)}`);
    if (seen.has(c.key)) problems.push(`duplicate key: ${c.key}`);
    seen.add(c.key);
    if (typeof c.resolve !== "function") problems.push(`${c.key}: resolve must be a function`);
    if (typeof c.render !== "function") problems.push(`${c.key}: render must be a function`);
    if (!c.label_en || !c.describe_en) problems.push(`${c.key}: needs at least an English label and description`);
    if (c.module_key && !c.permission) problems.push(`${c.key}: has a module but no permission`);
    if (!c.module_key && c.permission) problems.push(`${c.key}: has a permission but no module`);
    if (c.module_key && catalogueKeys && !catalogueKeys.includes(c.module_key)) {
      problems.push(`${c.key}: ${c.module_key} is not in the module catalogue — it would 403 every non-CEO user`);
    }
  }
  return problems;
}

try {
  const problems = validateManifest();
  if (problems.length) logger.warn({ problems }, "[mail] slash-command manifest has problems");
} catch (err) {
  logger.warn({ err }, "[mail] could not validate the slash-command manifest");
}

module.exports = { list, run, find, holds, validateManifest, manifest };
