"use strict";

/**
 * Which paths belong to the stranger-facing app, on a given host.
 *
 * The marketing prefix is a per-tenant setting now — `platform.subdomain.public_base`,
 * editable in the platform console — so this can no longer be the module-level
 * constant it used to be. It is a builder, memoised per base, and it is the ONE
 * definition: `src/server.js` matches with it and
 * `tests/unit/public-web-mount.test.js` asserts against it, so the two cannot drift.
 *
 * ── WHAT IS AND IS NOT CONFIGURABLE ───────────────────────────────────────
 *
 * The MARKETING prefix moves. `/portal` does not, deliberately: invitation and
 * set-password emails already in circulation point at it with a seven-day expiry,
 * and the ERP links its staff there. A console setting that can break links
 * already sitting in someone's inbox is a footgun, not a feature.
 *
 * `/public-assets` does not move either — it is the build's output directory, a
 * fact about the bundle rather than about the tenant.
 */

/**
 * Prefixes a tenant must never be given, because the ERP answers them.
 *
 * Taken from `client/src/app/app.tsx`: the five top-level routes outside the
 * shell, every section inside it, and the paths the server itself claims. A
 * tenant whose marketing site were mounted at `/settings` would shadow the
 * staff screen of the same name on the same origin — and the person who set it
 * would have no idea that was what they had done.
 */
const RESERVED_BASES = new Set([
  // outside the ERP's shell
  "login", "reset-password", "sign", "v", "verify",
  // the ERP's sections
  "ai", "ai-control", "appearance", "approvals", "audit", "commercial", "comms",
  "costing", "documents", "finance", "fleet", "godmode", "governance", "help",
  "hr", "master", "my-appearance", "my-hr", "notifications", "operations",
  "procurement", "sales", "security", "self-service", "settings", "support",
  "vault", "wms", "workflows", "workspace",
  // served by the API or the build
  "api", "media", "assets", "public-assets", "icons", "portal",
  "robots.txt", "sitemap.xml", "manifest.webmanifest",
  // this app's own legacy redirects
  "track", "tracking", "portfolio", "proposal", "proposals", "careers",
  "client-portal",
]);

const DEFAULT_BASE = "/public";

/**
 * `/Site/` → `/site`. One leading slash, no trailing one, lowercase.
 * Returns null when the input could not be a path segment at all.
 */
function normaliseBase(input) {
  // `== null` catches undefined as well as null, and that is load-bearing: a
  // host row read before migration 0104 has no `public_base` property at all,
  // so `String(undefined)` would produce the base "/undefined" and mount the
  // marketing app on a path no link points at.
  const raw = String(input == null ? "" : input).trim().toLowerCase();
  if (!raw) return DEFAULT_BASE;
  const segment = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!segment) return null; // "/" — the app cannot own a host's root here
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(segment)) return null;
  return "/" + segment;
}

/** Why a base was refused, or null when it is fine. */
function baseProblem(input) {
  const norm = normaliseBase(input);
  if (norm === null) {
    return "Use one short word: lowercase letters, digits and hyphens, like /site.";
  }
  const segment = norm.slice(1);
  if (RESERVED_BASES.has(segment)) {
    return `'/${segment}' is already used by the workspace on this origin.`;
  }
  return null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const cache = new Map();

/**
 * The matcher for one base.
 *
 * Memoised because `server.js` asks for it on every request and there are as
 * many distinct answers as there are configured prefixes — in practice one or
 * two, never enough to grow.
 */
function matcherFor(base) {
  const norm = normaliseBase(base) || DEFAULT_BASE;
  const hit = cache.get(norm);
  if (hit) return hit;
  const re = new RegExp(
    `^${escapeRe(norm)}(\\/|$)` +
      "|^\\/portal(\\/|$)" +
      "|^\\/public-assets\\/" +
      // `public` is in the legacy group whatever the base is, and permanently:
      // it was the original prefix, so a tenant who renames to /site must not
      // strand every URL already printed, emailed or indexed under /public. The
      // app's router redirects it to the configured base.
      "|^\\/(public|track|tracking|portfolio|proposal|proposals|careers|client-portal)(\\/|$)",
  );
  cache.set(norm, re);
  return re;
}

module.exports = { DEFAULT_BASE, RESERVED_BASES, normaliseBase, baseProblem, matcherFor };
