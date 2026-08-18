"use strict";

/**
 * Every tenant path the client calls must be served by a real route.
 *
 * WHY THIS EXISTS. Landing B shipped a régie retirement form whose dossier
 * picker read `useList<Dossier>("/dossiers")`. There is no `/dossiers` module —
 * dossiers are served by `operations_file.routes.js` at `/operations`, which is
 * what all fourteen other call sites in the client use. The picker would have
 * been permanently empty and the RECEIPT path unusable, and nothing caught it:
 * TypeScript cannot type-check a string against an Express router, the client
 * test suite cannot run in this environment, and a 404 inside `useList` renders
 * as an ordinary empty list rather than an error.
 *
 * A wrong path is invisible until someone opens the screen. This makes it a
 * test failure instead.
 *
 * WHAT IT CHECKS. The first path segment of every literal tenant URL in the
 * client is resolved against the `basePath` of every registered module. It is
 * deliberately segment-level: matching whole paths would require modelling
 * Express parameter patterns, and the defect class this guards — a plausible
 * but non-existent resource name — is always visible in the first segment.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SRC = path.join(ROOT, "src", "modules");
const CLIENT = path.join(ROOT, "client", "src");

/** Every *.routes.js under src/modules, recursively. */
function routeFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) routeFiles(p, out);
    else if (e.name.endsWith(".routes.js")) out.push(p);
  }
  return out;
}

/**
 * The set of first path segments the API serves, e.g. "operations", "regie".
 *
 * TWO registration idioms exist and both count. Most modules export
 * `basePath: "/regie"` directly. Some — `app_user`, `treasury_account` — export
 * `basePath: "/"` and mount named sub-routers with
 * `router.use("/users", usersRouter)`. Reading only the first would report every
 * sub-router path as missing, which is a false failure, not a finding.
 */
function servedSegments() {
  const seg = new Set();
  const add = (p) => {
    const first = String(p).split("/").filter(Boolean)[0];
    if (first && !first.startsWith(":")) seg.add(first);
  };
  for (const f of routeFiles(SRC)) {
    const src = fs.readFileSync(f, "utf8");
    const base = src.match(/basePath:\s*"([^"]+)"/);
    if (base) add(base[1]);
    for (const m of src.matchAll(/router\.use\(\s*"(\/[^"]*)"/g)) add(m[1]);
    // Third idiom: a module with basePath "/" declaring named routes directly
    // (workflow.routes.js does this for /workflows and /event-types).
    if (base && base[1] === "/") {
      for (const m of src.matchAll(
        /router\.(?:get|post|patch|put|delete)\(\s*"(\/[^"]*)"/g,
      ))
        add(m[1]);
    }
  }
  // Fourth idiom: routes hung directly on the tenant router in the aggregator
  // (src/routes/index.js), which is not a *.routes.js module at all.
  const agg = path.join(ROOT, "src", "routes", "index.js");
  if (fs.existsSync(agg)) {
    const src = fs.readFileSync(agg, "utf8");
    for (const m of src.matchAll(
      /tenantRouter\.(?:get|post|patch|put|delete|use)\(\s*"(\/[^"]*)"/g,
    ))
      add(m[1]);
  }
  return seg;
}

/** Every .ts/.tsx under client/src. */
function clientFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) clientFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
      out.push(p);
  }
  return out;
}

/**
 * Literal tenant paths in a source file.
 *
 * Only the two call shapes that name a path directly — `tenant("/x")` (and its
 * paged/download variants) and `useList("/x")`. A path built from a variable is
 * skipped: there is no literal to check, and guessing would produce false
 * failures.
 */
function tenantPaths(src) {
  const found = new Set();
  // Strip comments first: `use-action.ts` documents a call in a docstring
  // (`tenantDownload("/invoices.csv", …)`) and a doc example is not a call site.
  src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const patterns = [
    /\btenant(?:Paged|Download|WithProgress)?\s*(?:<[^>]*>)?\s*\(\s*[`"']\/([a-zA-Z0-9_-]+)/g,
    /\buseList\s*(?:<[^>]*>)?\s*\(\s*[`"']\/([a-zA-Z0-9_-]+)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) found.add(m[1]);
  }
  return found;
}

describe("client tenant paths resolve to a registered module", () => {
  const served = servedSegments();

  test("the route scan found a plausible number of modules", () => {
    // Guards the guard: a broken scan would make every assertion below vacuous.
    expect(served.size).toBeGreaterThan(80);
    expect(served.has("operations")).toBe(true);
    expect(served.has("regie")).toBe(true);
    expect(served.has("costings")).toBe(true);
    expect(served.has("cash-requests")).toBe(true);
  });

  test("`/dossiers` is NOT a route — the Landing B bug, pinned", () => {
    // Dossiers are served at /operations. If a module is ever added at
    // /dossiers this test should be deleted, not worked around.
    expect(served.has("dossiers")).toBe(false);
  });

  test("no client file calls an unserved tenant path", () => {
    const offenders = [];
    for (const f of clientFiles(CLIENT)) {
      const rel = path.relative(ROOT, f);
      for (const seg of tenantPaths(fs.readFileSync(f, "utf8"))) {
        if (!served.has(seg)) offenders.push(`${rel}: /${seg}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the costing set's own paths all resolve", () => {
    const api = fs.readFileSync(
      path.join(CLIENT, "lib", "costing-api.ts"),
      "utf8",
    );
    const segs = [...tenantPaths(api)];
    expect(segs.length).toBeGreaterThan(3);
    for (const s of segs) expect(served.has(s)).toBe(true);
  });
});

describe("the costing set's write actions are reachable from the client", () => {
  const api = fs.readFileSync(
    path.join(CLIENT, "lib", "costing-api.ts"),
    "utf8",
  );

  /**
   * The gap this closes: `cash_request.ai.js` exposed `disburse` and `justify`
   * to the assistant while the client had no function for either, so the AI
   * could move money the UI could not. An AI-only capability on a write is a
   * worse state than no capability at all.
   */
  test("every cash_request route has a client function", () => {
    for (const fn of [
      "listCashRequests",
      "getCashRequest",
      "createCashRequest",
      "transitionCashRequest",
      "disburseCashRequest",
      "justifyCashRequest",
    ]) {
      expect(api).toMatch(new RegExp(`export const ${fn}\\b`));
    }
  });

  test("the costing unlock loop has one too", () => {
    expect(api).toMatch(/export const unlockCosting\b/);
    expect(api).toContain("/unlock");
  });

  test("disburse deliberately takes no amount", () => {
    // cash_request.regie_advance_id is a single uuid and the server disburses
    // cr.amount in full, so an amount field here would imply a partial
    // disbursement nothing can record. See plan §3.2.
    const block = api.slice(
      api.indexOf("export const disburseCashRequest"),
      api.indexOf("export const justifyCashRequest"),
    );
    expect(block).toContain("entity_id");
    expect(block).not.toMatch(/^\s*amount\??:/m);
  });

  test("no client function sends a GL account code", () => {
    // Accounts are resolved server-side from ('finance','accounts'). A
    // treasury_coa posted from the browser would hardcode an account number in
    // the client and skip the postable-account guard.
    expect(api).not.toMatch(/treasury_coa:/);
    expect(api).not.toMatch(/account_code:\s*["'][0-9]/);
  });
});
