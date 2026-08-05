#!/usr/bin/env node
/**
 * Generate the API reference and the error-code registry FROM THE CODE.
 *
 * Closes three findings that are all the same shape — a real part of the
 * contract that existed only in someone's head or in a prose comment:
 *
 *   API F-25  No API spec exists. The one artefact that did (a Postman
 *             collection) covered 137 of 731 routes and had already drifted.
 *             A hand-written spec would drift the same way, so this DERIVES the
 *             surface from `doc/api-contract.json`, which `check-api-contract.js`
 *             already produces from the mounted routers — the same artefact CI
 *             fails on. A spec that is generated cannot disagree with the code.
 *
 *   API F-23  61 routes run authMiddleware with NO requirePermission. They are
 *             legitimately self-scoped, and nearly all say so in a comment —
 *             but "self-scoped, no grant required" is a real access tier that
 *             was not expressible in the permission matrix, not visible to an
 *             administrator, and not discoverable by a consumer.
 *             `GET /appraisals/mine` and `GET /appraisals` differ enormously in
 *             who can call them and nothing declared it.
 *             NOT CLOSED HERE — see the note above renderApi. The contract JSON
 *             cannot distinguish the tiers, and a wrong tier table is worse
 *             than none.
 *
 *   API F-5   188 error codes with no registry, containing near-synonyms a
 *             consumer cannot switch on reliably (INVALID_AMOUNT vs BAD_AMOUNT;
 *             FORBIDDEN vs PERMISSION_DENIED vs NOT_YOURS). Publishing the list
 *             is additive and is the precondition for ever consolidating them —
 *             you cannot deprecate a code nobody has enumerated.
 *
 * Usage:  node scripts/generate-api-docs.js [--check]
 *   --check  exit 1 if the committed docs differ from what the code implies,
 *            so CI catches a route or code added without regenerating.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONTRACT = path.join(ROOT, "doc", "api-contract.json");
const OUT_API = path.join(ROOT, "doc", "API_REFERENCE.md");
const OUT_ERR = path.join(ROOT, "doc", "ERROR_CODES.md");

/**
 * NOT DERIVABLE FROM THE CONTRACT — and this is worth writing down.
 *
 * `doc/api-contract.json` records `auth`/`rbac` per route from the middleware
 * NAMES on that route's own stack. Almost every router applies auth once with
 * `router.use(authMiddleware)`, which never appears on an individual route — so
 * the flags read `auth: false` for hundreds of routes that ARE authenticated.
 *
 * A first version of this generator classified the tiers off those flags and
 * produced "713 public, 9 self-scoped", which is nonsense — the audit counted
 * 10 public and 61 self-scoped. Publishing that would have been the exact
 * failure this remediation keeps finding: a control described as working when
 * it is not, except here it would have been a SECURITY tier table that lied.
 *
 * So the tier section is not emitted. Deriving it properly needs static
 * analysis of the routes files (resolving router-level `use`), which belongs in
 * check-api-contract.js so that CI and this share one answer. F-23 stays open
 * until then; this file documents everything it CAN derive honestly.
 */

// ── error codes (F-5) ───────────────────────────────────────────────────────

/**
 * Near-synonyms the audit called out. Recorded as ALIASES rather than renamed:
 * renaming a code a client already switches on is a breaking change, and the
 * point of a registry is to make the duplication visible so it can be retired
 * deliberately.
 */
const ALIASES = {
  BAD_AMOUNT: "INVALID_AMOUNT",
  BAD_STATE: "BAD_STATUS",
  EMPLOYEE_NOT_FOUND: "NOT_FOUND",
  NOT_YOURS: "PERMISSION_DENIED",
  NOT_A_MEMBER: "PERMISSION_DENIED",
  FORBIDDEN: "PERMISSION_DENIED",
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".js")) out.push(full);
  }
  return out;
}

function collectErrorCodes() {
  const codes = new Map(); // code -> { count, statuses:Set, files:Set }
  const re = /new AppError\(\s*["'`]([A-Z0-9_]+)["'`]\s*,\s*(?:[^,]*,\s*)?(\d{3})?/g;
  for (const file of walk(path.join(ROOT, "src"))) {
    const src = fs.readFileSync(file, "utf8");
    let m;
    while ((m = re.exec(src)) !== null) {
      const code = m[1];
      if (!codes.has(code)) codes.set(code, { count: 0, statuses: new Set(), files: new Set() });
      const rec = codes.get(code);
      rec.count += 1;
      if (m[2]) rec.statuses.add(Number(m[2]));
      rec.files.add(path.relative(ROOT, file));
    }
  }
  return codes;
}

// ── rendering ───────────────────────────────────────────────────────────────

function renderApi(contract) {
  const routes = Object.entries(contract.routes).map(([k, v]) => {
    const [method, urlPath] = k.split(" ");
    return { method, path: urlPath, ...v };
  });

  const group = (r) => {
    const parts = r.path.split("/").filter(Boolean);
    if (parts[0] === "api" && parts[1]) return `${parts[1]}${parts[2] ? `/${parts[2]}` : ""}`;
    return parts[0] || "/";
  };

  const L = [];
  L.push("# API reference");
  L.push("");
  L.push("**GENERATED — do not edit by hand.** `node scripts/generate-api-docs.js`");
  L.push("");
  L.push(
    "Closes API F-25. Derived from `doc/api-contract.json`, which `check-api-contract.js` "
    + "builds by mounting the real routers — so this cannot drift from the code without CI "
    + "failing. The previous artefact (a Postman collection) covered 19% of the surface and "
    + "had already drifted; a hand-written spec would have done the same.",
  );
  L.push("");
  L.push(`| | |`);
  L.push(`|---|---|`);
  L.push(`| Routes | ${contract.route_count} |`);
  L.push(`| Modules mounted | ${contract.modules_mounted} |`);
  L.push(`| API version | ${contract.api_version || "unversioned (F-18)"} |`);
  L.push("");

  L.push("## The out-of-band request contract");
  L.push("");
  L.push(
    "F-25 called this out specifically: none of it was documented anywhere, and a third-party "
    + "integrator could not derive it from the routes.",
  );
  L.push("");
  L.push("| Header | Meaning |");
  L.push("|---|---|");
  L.push("| `Host` | **Selects the tenant.** `<slug>.<app-domain>` reaches that tenant's data. The platform hosts (`localhost`, `api.*`, `admin.*`, the apex) are NOT tenant hosts — a tenant-API request arriving on one now answers `400 WRONG_HOST` (F-4), where it used to answer 500. |");
  L.push("| `X-Praxis-Env: sandbox` | Selects the sandbox schema for BUSINESS data. Honoured only on a tenant that is not live. |");
  L.push("| `X-Request-Id` | Correlation id, echoed on the response and repeated in every error body. Generated if absent; ignored if longer than 64 chars. |");
  L.push("| `Authorization: Bearer <jwt>` | Access token (`typ: \"access\"`). A refresh or 2FA-pending token presented here is refused. |");
  L.push("");
  L.push(
    "**Identity always resolves against the LIVE schema**, whatever `X-Praxis-Env` says — so "
    + "flipping to sandbox changes which business data you see and never logs you out.",
  );
  L.push("");

  L.push("## List, filter, sort");
  L.push("");
  L.push("| Parameter | Meaning |");
  L.push("|---|---|");
  L.push("| `limit`, `offset` | Page window. `limit` is clamped to 200 and defaults to 50. |");
  L.push("| `q` | Free-text search, where the resource declares a search column. |");
  L.push("| `sort` | `?sort=created_at` ascending, `?sort=-created_at` descending. **Only columns the resource declares as sortable are accepted**; anything else is `422 INVALID_SORT` rather than silently ignored (F-29). |");
  L.push("");
  L.push(
    "Unknown filter keys are refused with `422 UNKNOWN_FILTER` on resources that declare their "
    + "filterable set (F-28). They used to be dropped silently, so `?stat=OPEN` returned the "
    + "UNFILTERED list and looked like it had worked.",
  );
  L.push("");
  L.push("Every list response carries the pre-`LIMIT` total in `X-Total-Count` (F-26).");
  L.push("");

  L.push("## Access tiers");
  L.push("");
  L.push(
    "**Not published here yet (API F-23 remains open).** `doc/api-contract.json` records the "
    + "auth/RBAC middleware attached to each individual route, but nearly every router applies "
    + "authentication once with `router.use(authMiddleware)`, which does not appear on the "
    + "route itself. Classifying tiers off those flags produces an answer that is badly wrong "
    + "(it reports almost the entire surface as public), and a security tier table that lies is "
    + "worse than none. Deriving it correctly requires resolving router-level middleware in "
    + "`check-api-contract.js` so that CI and this document share one answer.",
  );
  L.push("");
  L.push(
    "What IS true and worth stating: 61 authenticated routes carry no `requirePermission` and "
    + "are self-scoped by construction (`/notifications/*`, `/workspace`, `/sessions/mine`, "
    + "`/ai/*`, the seven `/{resource}/mine` endpoints, `/auth/*`), and 10 routes are "
    + "unauthenticated by design — each reviewed under F-24. Until the tier is machine-derived, "
    + "`doc/API_CONTRACT_AUDIT.md` §F-23/F-24 is the reference for both lists.",
  );
  L.push("");

  L.push("## Routes");
  L.push("");
  L.push(`All ${routes.length} mounted routes, grouped by path prefix.`);
  L.push("");
  {
    const groups = new Map();
    for (const r of routes) {
      const g = group(r);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
    for (const g of [...groups.keys()].sort()) {
      L.push(`### \`${g}\``);
      L.push("");
      L.push("| Method | Path | Body validated |");
      L.push("|---|---|---|");
      for (const r of groups.get(g).sort((a, b) => a.path.localeCompare(b.path))) {
        L.push(`| ${r.method} | \`${r.path}\` | ${r.validated ? "yes" : "—"} |`);
      }
      L.push("");
    }
  }
  return `${L.join("\n")}\n`;
}

function renderErrors(codes) {
  const L = [];
  L.push("# Error code registry");
  L.push("");
  L.push("**GENERATED — do not edit by hand.** `node scripts/generate-api-docs.js`");
  L.push("");
  L.push(
    "Closes API F-5. Every `AppError` code raised anywhere in `src/`, with how often it is "
    + "raised and the HTTP status it carries. There was no exported enum, so nothing prevented "
    + "the 189th code — and the long tail contains near-synonyms a consumer cannot switch on.",
  );
  L.push("");
  L.push("Every error body has the same shape:");
  L.push("");
  L.push("```json");
  L.push('{ "error": { "code": "…", "message": "…", "fields": { } }, "request_id": "…" }');
  L.push("```");
  L.push("");
  L.push(
    "`fields` appears on validation failures only. `request_id` is ALWAYS present — including "
    + "on the tenant-gate failures, which used to omit it (F-3).",
  );
  L.push("");

  const dupes = Object.entries(ALIASES).filter(([k]) => codes.has(k));
  if (dupes.length) {
    L.push("## Known near-synonyms");
    L.push("");
    L.push(
      "Recorded, deliberately NOT renamed: a code a client already switches on cannot be "
      + "changed without breaking it. Prefer the canonical form in new code; the alias stays "
      + "until a version boundary lets it be retired.",
    );
    L.push("");
    L.push("| Alias | Prefer | Raised |");
    L.push("|---|---|---|");
    for (const [alias, canonical] of dupes.sort()) {
      L.push(`| \`${alias}\` | \`${canonical}\` | ${codes.get(alias).count}× |`);
    }
    L.push("");
  }

  L.push(`## All codes (${codes.size})`);
  L.push("");
  L.push("| Code | Status | Raised | Alias of |");
  L.push("|---|---|---|---|");
  for (const code of [...codes.keys()].sort()) {
    const r = codes.get(code);
    const st = [...r.statuses].sort().join(", ") || "—";
    L.push(`| \`${code}\` | ${st} | ${r.count}× | ${ALIASES[code] ? `\`${ALIASES[code]}\`` : "—"} |`);
  }
  L.push("");
  return `${L.join("\n")}\n`;
}

function main() {
  if (!fs.existsSync(CONTRACT)) {
    console.error(
      `${path.relative(ROOT, CONTRACT)} is missing. Run:\n`
      + "  node scripts/check-api-contract.js --update",
    );
    return 1;
  }
  const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));
  const api = renderApi(contract);
  const errs = renderErrors(collectErrorCodes());

  const check = process.argv.includes("--check");
  let drift = false;
  for (const [file, content] of [[OUT_API, api], [OUT_ERR, errs]]) {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (check) {
      if (existing !== content) {
        drift = true;
        console.error(`DRIFT: ${path.relative(ROOT, file)} is out of date.`);
      }
    } else if (existing !== content) {
      fs.writeFileSync(file, content);
      console.log(`wrote ${path.relative(ROOT, file)}`);
    } else {
      console.log(`up to date ${path.relative(ROOT, file)}`);
    }
  }

  if (check && drift) {
    console.error("\nRegenerate with: node scripts/generate-api-docs.js");
    return 1;
  }
  if (check) console.log("API docs are in sync with the code.");
  return 0;
}

process.exit(main());
