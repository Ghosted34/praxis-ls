"use strict";

/**
 * The two gates a tenant's OWN domain has to pass, pinned.
 *
 * `staging.smartls.cm` was registered in the platform console, resolved, and
 * served its shell — and then every asset failed. Two separate refusals, one
 * cause each, and neither is reachable from `vite dev`:
 *
 *   · CORS. The allowlist read APP_BASE_DOMAIN and CORS_ORIGINS only. A custom
 *     domain is neither, so the module script and the stylesheet — both tagged
 *     `crossorigin` by Vite's build, both therefore sending an Origin — came
 *     back 403 ORIGIN_NOT_ALLOWED. The stylesheet arrived as `application/json`
 *     because what it actually received was the error body.
 *   · CSP. `script-src` is `'self'` with no `'unsafe-inline'` (SEC-M8), and the
 *     shell's no-flash theme block is inline by necessity. The browser refused
 *     it, so the page rendered before `data-theme` was ever written.
 *
 * Both are the same mistake in different clothes: a per-tenant fact — "this host
 * serves the public site" — read from configuration instead of from
 * `platform.subdomain`, which is where registering a domain actually writes it.
 */

const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "../..");
const hashes = require("../../src/shared/http/inline-script-hashes");

describe("inline script hashes", () => {
  it("hashes an inline block, and matches what a browser asks for", () => {
    // The digest a browser reports in its refusal is over the exact text
    // BETWEEN the tags — no tag, no attributes, whitespace included.
    const out = hashes.hashesForHtml('<script>\n  var a = 1;\n</script>');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);

    const crypto = require("crypto");
    const expected = crypto
      .createHash("sha256")
      .update("\n  var a = 1;\n", "utf8")
      .digest("base64");
    expect(out[0]).toBe(`'sha256-${expected}'`);
  });

  it("ignores external scripts — 'self' already covers those", () => {
    expect(hashes.hashesForHtml('<script src="/public-assets/index.js"></script>')).toEqual([]);
    expect(
      hashes.hashesForHtml('<script type="module" src="/public-assets/x.js"></script>'),
    ).toEqual([]);
  });

  it("ignores an empty block rather than emitting the hash of nothing", () => {
    // The sha256 of "" would match every other empty block on the site.
    expect(hashes.hashesForHtml("<script></script>")).toEqual([]);
  });

  it("deduplicates identical blocks", () => {
    const out = hashes.hashesForHtml("<script>x()</script><script>x()</script>");
    expect(out).toHaveLength(1);
  });

  it("returns nothing for a missing file instead of throwing", () => {
    // The app boots without public-web/dist; a CSP helper must not stop it.
    expect(hashes.hashesForFile(path.join(repo, "does/not/exist.html"))).toEqual([]);
  });

  it("covers the shell public-web actually ships", () => {
    // If the theme block is ever removed this goes green for the wrong reason,
    // so assert the block is THERE as well as that it hashes.
    const shell = path.join(repo, "public-web/index.html");
    const html = fs.readFileSync(shell, "utf8");
    expect(html).toMatch(/<script>[\s\S]*data-theme[\s\S]*<\/script>/);
    expect(hashes.hashesForFile(shell)).toHaveLength(1);
  });
});

describe("CSP wiring in server.js", () => {
  const serverSrc = fs.readFileSync(path.join(repo, "src/server.js"), "utf8");

  it("names the shell's inline script by hash, not by 'unsafe-inline'", () => {
    const scriptSrc = serverSrc.match(/const scriptSrc = \[([\s\S]*?)\n {2}\];/);
    expect(scriptSrc).not.toBeNull();
    expect(serverSrc).toContain('"script-src": scriptSrc,');
    expect(scriptSrc[1]).toContain("publicWebShellHashes");
    // SEC-M8: reopening this platform-wide would switch the primary XSS
    // mitigation off for every page, login included. Asserted against the
    // DIRECTIVE, not the file — the token appears in the comment above the
    // helmet config that explains why it was removed.
    expect(scriptSrc[1]).not.toContain("unsafe-inline");
  });

  it("computes the hash from the BUILT file, never a pasted literal", () => {
    expect(serverSrc).toContain("public-web/dist/index.html");
    // A hardcoded digest goes stale the first time the theme block is edited,
    // and fails silently in production when it does.
    expect(serverSrc).not.toMatch(/'sha256-[A-Za-z0-9+/]{40,}=*'/);
  });
});

describe("CORS allowlist", () => {
  const REGISTRY = "../../src/services/tenant/registry.service";

  /** Build the real options with the registry stubbed, fresh each time. */
  function optionsWith(resolveByHost) {
    let opts;
    jest.isolateModules(() => {
      jest.doMock(REGISTRY, () => ({ resolveByHost }));
      // The real builder, not a copy — a copy is how this drifts.
      opts = require("../../src/server").buildCorsOptions();
    });
    return opts;
  }

  /** Promisified `origin(origin, cb)` → resolves allowed, rejects with the error. */
  const check = (opts, origin) =>
    new Promise((resolve, reject) => {
      opts.origin(origin, (err, allowed) => (err ? reject(err) : resolve(allowed)));
    });

  const never = () => {
    throw new Error("registry must not be consulted for a first-party origin");
  };

  it("allows a request with no Origin at all", async () => {
    // A top-level navigation sends none — which is why the SHELL loaded on the
    // custom domain even while every asset was being refused.
    await expect(check(optionsWith(never), undefined)).resolves.toBe(true);
  });

  it("allows the base domain and its subdomains without a lookup", async () => {
    const opts = optionsWith(never);
    await expect(check(opts, "https://praxisls.com")).resolves.toBe(true);
    await expect(check(opts, "https://smartls.praxisls.com")).resolves.toBe(true);
  });

  it("allows a custom domain registered with surface='public'", async () => {
    const opts = optionsWith(async (host) =>
      host === "staging.smartls.cm" ? { surface: "public" } : null,
    );
    await expect(check(opts, "https://staging.smartls.cm")).resolves.toBe(true);
  });

  it("refuses a custom domain still on surface='erp'", async () => {
    // Registered, but not yet flipped — it has no business making cross-origin
    // calls, and saying so here is what keeps the flip meaningful.
    const opts = optionsWith(async () => ({ surface: "erp" }));
    await expect(check(opts, "https://staging.smartls.cm")).rejects.toMatchObject({
      status: 403,
      code: "ORIGIN_NOT_ALLOWED",
    });
  });

  it("refuses a host the registry has never heard of", async () => {
    const opts = optionsWith(async () => null);
    await expect(check(opts, "https://evil.example")).rejects.toMatchObject({
      status: 403,
      code: "ORIGIN_NOT_ALLOWED",
    });
  });

  it("refuses rather than throwing when the lookup fails", async () => {
    // A database hiccup must not turn into a 500 on every asset request.
    const opts = optionsWith(async () => {
      throw new Error("db down");
    });
    await expect(check(opts, "https://staging.smartls.cm")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("refuses a malformed Origin", async () => {
    await expect(check(optionsWith(never), "not-a-url")).rejects.toMatchObject({
      status: 403,
    });
  });
});
