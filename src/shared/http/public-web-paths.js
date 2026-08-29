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
 * The base a host serves the marketing site at when the site OWNS that host.
 *
 * A prefix exists to keep the marketing site out of the ERP's way on a shared
 * origin. On a domain the client brought — `surface = 'public'`, where the ERP is
 * not served at all — there is nothing to stay out of the way of, and the prefix
 * becomes a word in every URL they print that means nothing to them or their
 * customers. So those hosts serve at the root, and `public_base` applies to
 * workspace hosts only.
 *
 * `normaliseBase` still REFUSES "/" from the console, deliberately: it is not a
 * value anyone chooses, it is what being a public-surface host means.
 */
const ROOT_BASE = "/";

/**
 * The longest string `normaliseBase` will look at.
 *
 * A base is ONE short word — the column allows 31 characters — so 64 is already
 * generous, and anything past it is not a value to analyse, it is a value to
 * refuse. This exists so the refusal happens before any per-character work,
 * rather than depending on a cap in the validator two modules away.
 */
const MAX_BASE_INPUT = 64;

/** True for the root mount, where the base contributes nothing to a path. */
const isRoot = (base) => base === ROOT_BASE || base === "";

/**
 * Join a base and a path without producing "//track" at the root.
 *
 * Every caller that builds a URL from the base — the sitemap, the head's route
 * table, the app's own `p()` — needs this exact rule, so it lives once.
 */
function joinBase(base, rest = "") {
  const b = isRoot(base) ? "" : String(base || DEFAULT_BASE);
  if (!rest) return b || "/";
  return b + rest;
}

/**
 * The path with the host's base removed, or null when it is not under it.
 *
 * `/site/portfolio/x` on a `/site` host and `/portfolio/x` on a root host are the
 * same page, and anything keyed on the path — head tags, canonical links — has to
 * see them that way. Before this existed the head's route table matched a literal
 * `/public/...`, so a tenant who renamed the prefix silently lost every link
 * preview.
 */
function stripBase(urlPath, base) {
  const path = String(urlPath || "/");
  if (isRoot(base)) return path;
  const b = String(base);
  if (path === b) return "/";
  return path.startsWith(b + "/") ? path.slice(b.length) : null;
}

/**
 * `/Site/` → `/site`. One leading slash, no trailing one, lowercase.
 * Returns null when the input could not be a path segment at all.
 */
function normaliseBase(input) {
  // BOTH null and undefined, spelled out — `eqeqeq` is on, so the `== null`
  // shorthand is a lint error here. Catching undefined is load-bearing: a host
  // row read before migration 0104 has no `public_base` property at all, and
  // `String(undefined)` produces the base "/undefined", which mounts the
  // marketing app on a path no link points at.
  const empty = input === null || input === undefined;
  const raw = String(empty ? "" : input).trim().toLowerCase();
  if (!raw) return DEFAULT_BASE;

  // ── WHY THE SLASHES ARE NOT TRIMMED WITH A REGEX ────────────────────────
  //
  // This was `raw.replace(/^\/+/, "").replace(/\/+$/, "")`. CodeQL fails the
  // build on it (js/polynomial-redos) and is right to: `\/+$` is QUADRATIC on a
  // string of slashes that does not end in one, because the engine re-runs the
  // whole slash run from every start position. Measured on this repo's Node 22:
  // 20k slashes 168 ms, 100k 4.0 s, 200k 15.8 s — of a single-threaded server's
  // event loop, which means every other tenant's requests as well.
  //
  // It happens to be bounded today by two guards, neither visible from this
  // file: `domainBase` in platform.validator.js caps the field at 32 characters
  // and migration 0104's CHECK caps the column at 31. That is safety at a
  // distance, and the next caller — a CLI, a seed script, a backfill — inherits
  // none of it. The gate and the split make the property local and linear.
  //
  // House precedent for removing rather than fencing this shape:
  // `signatures/verify-link.js` (a while loop, with the reasoning written out),
  // `vault/qes/qes.service.js`, `spreadsheet/build.js` and
  // `spreadsheet/helpers.js`. A split is used here instead of a loop because
  // this function needs the segments anyway.
  if (raw.length > MAX_BASE_INPUT) return null;
  const parts = raw.split("/").filter(Boolean);
  // Exactly one segment. "" and "/" give none — the app cannot own a host's
  // root through this function, that is what `surface = 'public'` means —
  // and "/a/b" gives two.
  if (parts.length !== 1) return null;
  const segment = parts[0];
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

module.exports = {
  DEFAULT_BASE,
  ROOT_BASE,
  RESERVED_BASES,
  isRoot,
  joinBase,
  stripBase,
  normaliseBase,
  baseProblem,
  matcherFor,
};
