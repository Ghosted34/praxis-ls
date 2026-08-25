/**
 * THE AI SURFACE EXISTS AND IS WIRED (§8.11).
 *
 * Three of PR-4's acceptance criteria failed for the same dull reason: the
 * endpoint was not there. `assist.prompts` held all ten tone presets and all
 * five rewrite actions, correctly, and `/assist/compose` was the only route
 * that could reach any of them — so translation, summaries and voice were
 * complete implementations with no door.
 *
 * There is one subtler thing this file guards, and it fails silently rather
 * than loudly, which is why it is asserted mechanically:
 *
 *   EVERY ROUTE MUST PASS THE CALLER INTO THE SERVICE.
 *
 * The grounding whitelist re-checks RBAC per source against the caller. A
 * service called with no user withholds every source and returns an ungrounded
 * draft — no error, no warning, just a worse answer. Dropping `actor(req)` from
 * one route would restore exactly the defect this chapter was rebuilt to
 * remove, and no functional test would notice.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const FILE = path.resolve(__dirname, "../../src/modules/mail/assist/assist.routes.js");
const src = fs.readFileSync(FILE, "utf8");

/** Each router.<verb>("<path>", …) up to the next router. call. */
function routeBlocks() {
  const out = [];
  const re = /router\.(get|post|patch|put|delete)\("([^"]+)"([\s\S]*?)(?=\n\s*router\.|\nmodule\.exports)/g;
  let m;
  while ((m = re.exec(src))) out.push({ verb: m[1], path: m[2], body: m[3] });
  return out;
}
const ROUTES = routeBlocks();
const at = (p) => ROUTES.find((r) => r.path === p);

/* ── The doors ────────────────────────────────────────────────────────────── */

describe("every §8.11 capability has an endpoint", () => {
  test.each([
    ["/assist/compose", "post", "§8.11(1) tone presets"],
    ["/assist/draft", "post", "§8.11(2) grounded reply"],
    ["/assist/rewrite", "post", "§8.11(4) grammar / shorten / expand"],
    ["/assist/translate", "post", "§8.11(4) the glossary guarantee, on real output"],
    ["/assist/summary", "post", "§8.11(5) executive thread summary"],
    ["/assist/voice", "post", "§8.11(8) dictation"],
    ["/assist/search", "post", "§8.9 search by meaning"],
    ["/assist/guardrails", "post", "§8.11(9) the pre-send bar"],
    ["/assist/ocr/:attachmentId", "post", "§8.11(6) attachment extraction"],
    ["/assist/extractions/:id/review", "post", "§8.6 the review form"],
  ])("%s (%s) — %s", (p, verb) => {
    const r = at(p);
    expect(r).toBeTruthy();
    expect(r.verb).toBe(verb);
  });

  test("a summary is a POST, because a cache miss spends money", () => {
    // A GET that can bill the tenant is a GET a proxy, a prefetcher or a retry
    // will bill them for twice.
    expect(at("/assist/summary").verb).toBe("post");
  });
});

/* ── The caller reaches the service ───────────────────────────────────────── */

describe("the caller is passed into every service call", () => {
  const GENERATING = [
    "/assist/compose", "/assist/draft", "/assist/rewrite",
    "/assist/translate", "/assist/summary", "/assist/voice",
    "/assist/ocr/:attachmentId", "/assist/extractions/:id/review",
    "/assist/extractions/:id/dismiss",
  ];

  test.each(GENERATING)("%s passes actor(req)", (p) => {
    expect(at(p).body).toMatch(/actor\(req\)/);
  });

  test("search passes the user id, because the re-filter needs it", () => {
    expect(at("/assist/search").body).toMatch(/req\.user && req\.user\.user_id/);
  });

  test("`actor` is defined once and returns the real user or null", () => {
    expect(src).toMatch(/const actor = \(req\) => req\.user \|\| null;/);
    // Never a default object: a truthy stand-in would pass `mayRead`'s
    // null-check and then fail its grant lookup, which reads as "this user has
    // no permissions" rather than "nobody was authenticated".
  });
});

/* ── The gates ────────────────────────────────────────────────────────────── */

describe("authentication, feature and permission all stand in front", () => {
  test("the router authenticates, and mail.ai gates every /assist route — per route, never router-wide", () => {
    expect(src).toMatch(/router\.use\(authMiddleware\)/);
    // A router-level mail.ai gate used to sit on this router — and it was a
    // bug, not a style: the module mounts at /mail, the same base path as
    // mail/mail, and the first /mail module-loader mounts (alphabetical
    // discovery). The gate then ran for every /mail/* request that fell
    // through to it: with AI off (the default) GET /mail/threads,
    // GET /mail/folders and GET /mail/mailboxes/mine answered
    // FEATURE_DISABLED before they reached mail.routes.js. The whole inbox
    // was unreachable for every tenant that had not opted into AI.
    //
    // Asserted on comment-stripped source: the explanation of this very bug
    // quotes the offending line, and a check that matches prose is a check
    // that cannot pass once the file documents its own history.
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
    expect(code).not.toMatch(/router\.use\(requireFeature\("mail\.ai"\)\)/);
    expect(code).toMatch(/const requireAi = requireFeature\("mail\.ai"\)/);
  });

  test("every /assist route carries the mail.ai gate, before its permission check", () => {
    // The point of "before" is to refuse before the request costs a query.
    const assistRoutes = ROUTES.filter((r) => r.path.startsWith("/assist/"));
    expect(assistRoutes.length).toBeGreaterThanOrEqual(10);
    for (const r of assistRoutes) {
      expect({
        route: r.path,
        carriesGate: /\brequireAi\b/.test(r.body),
        gateBeforePermission:
          r.body.indexOf("requireAi") !== -1 &&
          r.body.indexOf("requireAi") < r.body.indexOf("requirePermission"),
      }).toEqual({ route: r.path, carriesGate: true, gateBeforePermission: true });
    }
  });

  test("the one route outside /assist is deliberately not under the AI gate", () => {
    // Its own gate is mail.ocr, whose catalogue row depends on mail.ai
    // (migrations/seeds/9114), so the floor still holds.
    const extractions = at("/messages/:id/extractions");
    expect({
      carriesOcrGate: /\brequireOcr\b/.test(extractions.body),
      carriesAiGate: /\brequireAi\b/.test(extractions.body),
    }).toEqual({ carriesOcrGate: true, carriesAiGate: false });
  });

  test("every route carries a MOD-72 permission", () => {
    for (const r of ROUTES) expect(r.body).toMatch(/requirePermission\("MOD-72", "(view|edit)"\)/);
  });

  test("reviewing and dismissing an extraction need edit, not view", () => {
    // They change a record's state. `create` would be wrong too — §8.6 is
    // explicit that nothing is created here.
    expect(at("/assist/extractions/:id/review").body).toMatch(/"MOD-72", "edit"/);
    expect(at("/assist/extractions/:id/dismiss").body).toMatch(/"MOD-72", "edit"/);
  });

  test("the middleware flag is the FLOOR — the service gates again", () => {
    const service = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/assist/assist.service.js"), "utf8",
    );
    // `requireFeature` refuses an unauthorised request before it costs a query.
    // It is not sufficient: the AI action catalogue and the job handlers do not
    // pass through Express at all.
    expect(service).toMatch(/canUseFeature/);
    expect(service).toMatch(/feature_key = 'mail\.ai'/);
  });
});

/* ── The payloads ─────────────────────────────────────────────────────────── */

describe("the request bodies are closed, and the vocabularies are enumerated", () => {
  test("every body schema is strict", () => {
    const bodies = src.match(/body\(z\.object\(\{[\s\S]*?\}\)\.strict\(\)\)/g) || [];
    const declared = (src.match(/body\(z\.object\(/g) || []).length;
    expect(bodies).toHaveLength(declared);
    // `.strict()` is what makes an undeclared field a 422 rather than a silent
    // no-op — the difference between "the composer sent send_at and it was
    // ignored" and "the composer sent send_at and was told".
  });

  test("tones and actions are enumerated, not free strings", () => {
    expect(src).toMatch(/const TONE = z\.enum\(\[/);
    expect(src).toMatch(/const ACTION = z\.enum\(\["grammar", "shorten", "expand", "to_fr", "to_en"\]\)/);
    // A free string would let a caller mint a metering category, and — worse —
    // fall through to "formal" silently when they typo one.
  });

  test("the ten tone presets on the API are exactly the ten in the catalogue", () => {
    const { PRESETS } = require("../../src/modules/mail/assist/assist.prompts");
    const declared = src.match(/const TONE = z\.enum\(\[([\s\S]*?)\]\)/)[1]
      .match(/"([a-z_]+)"/g).map((s) => s.replace(/"/g, "")).sort();
    expect(declared).toEqual(Object.keys(PRESETS).sort());
  });

  test("the five rewrite actions on the API are exactly the five in the catalogue", () => {
    const { ACTIONS } = require("../../src/modules/mail/assist/assist.prompts");
    const declared = src.match(/const ACTION = z\.enum\(\[([\s\S]*?)\]\)/)[1]
      .match(/"([a-z_]+)"/g).map((s) => s.replace(/"/g, "")).sort();
    expect(declared).toEqual(Object.keys(ACTIONS).sort());
  });

  test("free text is bounded everywhere it is accepted", () => {
    const unbounded = (src.match(/z\.string\(\)(?!\.uuid|\.email|\.datetime)(?![\s\S]{0,40}?(max\(|enum\())/g) || []);
    expect(unbounded).toEqual([]);
  });
});

/* ── The module loader ────────────────────────────────────────────────────── */

describe("the router is loadable on §3.2's terms", () => {
  test("it exports basePath and router", () => {
    const mod = require("../../src/modules/mail/assist/assist.routes");
    expect(mod.basePath).toBe("/mail");
    expect(typeof mod.router).toBe("function");
  });

  test("the directory name matches the routes filename", () => {
    // §3.2's landmine: `src/modules/mail/` is a GROUP, so any directory under
    // it needs a matching `<name>.routes.js` or the loader skips it silently
    // and every endpoint in it 404s with nothing in the log.
    const dir = path.resolve(__dirname, "../../src/modules/mail/assist");
    expect(fs.existsSync(path.join(dir, "assist.routes.js"))).toBe(true);
  });
});
