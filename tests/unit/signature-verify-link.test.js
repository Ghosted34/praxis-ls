"use strict";

/**
 * The verification link a document carries — doc/SIGNATURE_ENGINEERING_GUIDE.md
 * §3.7, §5.2.
 *
 * The QR's density budget is the reason several of these are pinned as numbers
 * rather than described in prose. §3.7 measured it: a phone camera wants ≥
 * 0.5mm per module at arm's length and 300dpi print needs ≥ 0.34mm. In the
 * 22mm the seal allocates, a 33-module symbol gives 0.67mm and a 45-module one
 * gives 0.49 — right on the phone threshold, before a photocopier touches it.
 *
 * A change that lengthens the URL degrades a printed artefact that cannot be
 * re-issued, so the module count is a test and not a comment.
 */

const qr = require("../../src/services/signatures/qr");
const tokens = require("../../src/services/signatures/tokens");
const verifyLink = require("../../src/services/signatures/verify-link");

describe("the URL the QR encodes", () => {
  test("it is /v/<code> on the host the caller names", async () => {
    const ctx = await verifyLink.verifyContext(null, { code: "A4B7K92MXQ1P", slug: "smartls" });
    expect(ctx.url).toBe("https://smartls.praxisls.com/v/A4B7K92MXQ1P");
  });

  test("a code a human typed with separators and lower case still resolves", async () => {
    // The code is read down phone lines and copied off paper. Crockford's
    // substitutions and any separator the reader felt like using are accepted.
    const ctx = await verifyLink.verifyContext(null, { code: " a4b7-k92m-xq1p ", slug: "smartls" });
    expect(ctx.code).toBe("A4B7K92MXQ1P");
    expect(ctx.url).toBe("https://smartls.praxisls.com/v/A4B7K92MXQ1P");
  });

  test("an explicit origin wins over a slug — a tenant that moved host", async () => {
    const ctx = await verifyLink.verifyContext(null, {
      code: "A4B7K92MXQ1P", slug: "smartls", origin: "https://docs.smartlogistics.cm",
    });
    expect(ctx.url).toBe("https://docs.smartlogistics.cm/v/A4B7K92MXQ1P");
  });

  test("a trailing slash on the origin does not double up", async () => {
    const ctx = await verifyLink.verifyContext(null, { code: "A4B7K92MXQ1P", origin: "https://x.cm///" });
    expect(ctx.url).toBe("https://x.cm/v/A4B7K92MXQ1P");
  });

  test("a bare host is given a scheme rather than producing a relative URL", async () => {
    const ctx = await verifyLink.verifyContext(null, { code: "A4B7K92MXQ1P", origin: "x.praxisls.com" });
    expect(ctx.url).toBe("https://x.praxisls.com/v/A4B7K92MXQ1P");
  });

  test("no code means no block — a QR resolving to /v/ is worse than none", async () => {
    expect(await verifyLink.verifyContext(null, { code: "", slug: "smartls" })).toBeNull();
    expect(await verifyLink.verifyContext(null, { code: null, slug: "smartls" })).toBeNull();
  });

  test("the tenant setting is consulted only when the caller has no host", async () => {
    const client = {
      query: async (sql) => (/FROM setting/.test(sql)
        ? { rows: [{ value: "https://verify.smartlogistics.cm" }] }
        : { rows: [] }),
    };
    const fromSetting = await verifyLink.verifyContext(client, { code: "A4B7K92MXQ1P" });
    expect(fromSetting.url).toBe("https://verify.smartlogistics.cm/v/A4B7K92MXQ1P");

    const fromCaller = await verifyLink.verifyContext(client, { code: "A4B7K92MXQ1P", slug: "smartls" });
    expect(fromCaller.url).toBe("https://smartls.praxisls.com/v/A4B7K92MXQ1P");
  });

  test("a sandbox-signed code carries ?e=sandbox — live URLs stay bare", async () => {
    // The env is baked into the printed URL, not sent as a client header, so a
    // stranger scanning a test-environment document lands on a page that pins
    // its own database read to sandbox rather than 404ing against live. A
    // live URL is unchanged so nothing prints differently for real documents.
    const live = await verifyLink.verifyContext(null, { code: "A4B7K92MXQ1P", slug: "smartls", env: "live" });
    expect(live.url).toBe("https://smartls.praxisls.com/v/A4B7K92MXQ1P");
    const sandbox = await verifyLink.verifyContext(null, { code: "A4B7K92MXQ1P", slug: "smartls", env: "sandbox" });
    expect(sandbox.url).toBe("https://smartls.praxisls.com/v/A4B7K92MXQ1P?e=sandbox");
  });
});

describe("the symbol itself", () => {
  const url = "https://smartls.praxisls.com/v/A4B7K92MXQ1P";

  test("§3.7 — the short code on the short path stays inside 33 modules", async () => {
    // Asserted on MODULES and millimetres, not on character count: the guide's
    // table quotes 40 characters for a short tenant host and a real one runs to
    // 43, but both land in the same QR version. The character count is a proxy;
    // the module pitch is the thing a phone camera actually sees.
    const modules = await qr.moduleCount(url);
    expect(modules).toBeLessThanOrEqual(33);
    // 22mm / 33 modules = 0.67mm — a third clear of the 0.5mm a phone wants at
    // arm's length, and double the 0.34mm 300dpi print needs.
    expect(22 / modules).toBeGreaterThan(0.6);
  });

  test("the seal's 22mm budget survives the longest realistic tenant host", async () => {
    // A tenant slug is bounded by its subdomain, so this is close to the worst
    // case the fleet can produce. If it ever stops fitting, the answer is the
    // dedicated short host §3.7 measured — not a smaller symbol.
    const worst = `https://a-fairly-long-tenant-slug.praxisls.com/v/A4B7K92MXQ1P`;
    expect(22 / (await qr.moduleCount(worst))).toBeGreaterThan(0.5);
  });

  test("the sandbox variant survives the same 22mm budget", async () => {
    // A sandbox-signed document adds `?e=sandbox` (10 chars). Measured on the
    // same worst-case host: 41 modules, 0.537 mm/module at 22mm — above the
    // 0.5mm phone-camera threshold in §3.7. A regression that pushes it past
    // one more QR version cliff would silently make test documents unscannable
    // in warehouse light, so it is a test.
    const worst = `https://a-fairly-long-tenant-slug.praxisls.com/v/A4B7K92MXQ1P?e=sandbox`;
    expect(22 / (await qr.moduleCount(worst))).toBeGreaterThan(0.5);
  });

  test("the long path this replaced would have cost a QR version", async () => {
    // Kept as a live comparison rather than a comment, so the claim in §3.7
    // stays true of the library actually installed.
    const long = "https://smartls.praxisls.com/public/verify/A4B7K92MXQ1P";
    expect(await qr.moduleCount(long)).toBeGreaterThan(await qr.moduleCount(url));
  });

  test("it is inline SVG sized in millimetres, not a data-URI image", async () => {
    const ctx = await verifyLink.verifyContext(null, { code: "A4B7K92MXQ1P", slug: "smartls", sizeMm: 22 });
    expect(ctx.qrSvg.startsWith("<svg")).toBe(true);
    expect(ctx.qrSvg).toContain('width="22mm"');
    expect(ctx.qrSvg).toContain('height="22mm"');
    // Puppeteer rasterises inline SVG at print resolution; a data-URI <img>
    // would be resampled from a bitmap and needs the renderer's CSP to allow it.
    expect(ctx.qrSvg).not.toContain("data:image");
  });

  test("error correction stays at Q — this gets photocopied and faxed", async () => {
    // Level Q tolerates ~25% damage against M's ~15%. Asserted by outcome: the
    // same payload at level M needs fewer modules, so a regression to M shows
    // up as a smaller symbol.
    const QRCode = require("qrcode");
    const atM = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 0 });
    const mModules = Number(atM.match(/viewBox="0 0 (\d+)/)[1]);
    expect(await qr.moduleCount(url)).toBeGreaterThan(mModules);
  });
});

describe("the printed code", () => {
  test("it is grouped in fours for someone reading it aloud", () => {
    expect(tokens.formatCode("A4B7K92MXQ1P")).toBe("A4B7-K92M-XQ1P");
  });

  test("grouping is display-only and never stored", () => {
    expect(tokens.normaliseCode("A4B7-K92M-XQ1P")).toBe("A4B7K92MXQ1P");
  });

  test("the alphabet excludes the characters that misread in 5pt type", () => {
    for (const ch of ["I", "L", "O", "U"]) expect(tokens.ALPHABET).not.toContain(ch);
  });
});
