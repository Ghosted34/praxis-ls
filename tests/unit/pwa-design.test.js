"use strict";

/**
 * The per-tenant installed-app design: what the manifest advertises, what the
 * home-screen PNG actually contains, and who can see whose.
 *
 * THREE THINGS ARE WORTH A TEST HERE, and they are not the obvious ones.
 *
 * 1. TENANT ISOLATION IS STRUCTURAL, SO PROVE IT STRUCTURALLY. Nothing in these
 *    routes takes a tenant from the request body, the query string or a header
 *    a caller controls — it comes from the Host, and the read runs inside that
 *    tenant's own connection. The test that matters is therefore not "does
 *    tenant A get tenant A's icon" (it trivially does) but "does asking under
 *    tenant B's origin ever reach tenant A's data" — including the in-process
 *    icon cache, which is the one piece of shared mutable state in the whole
 *    path and the obvious place for a cross-tenant leak to appear.
 *
 * 2. THE PREVIEW IS A CLAIM ABOUT THE PNG. The editor draws the icon from
 *    `iconLayout()` and tells the tenant "this is what your phone will show".
 *    That claim is only true if the server composites the artwork in the same
 *    place. So the icon test does not check that a PNG came back — it probes
 *    PIXELS, and asserts the artwork lands inside the box `iconLayout()`
 *    predicts and not outside it. If someone changes the padding arithmetic on
 *    one side only, this fails, which is the entire point of putting the
 *    resolver in @praxis/shared.
 *
 * 3. NOTHING MAY MAKE THE APP UNINSTALLABLE. The editor warns rather than
 *    blocks, so the safety net has to be real: an unconfigured tenant, an
 *    unknown host, a broken storage read and a database that throws must all
 *    still produce a valid manifest and a valid icon.
 */

const express = require("express");
const request = require("supertest");
const sharp = require("sharp");

const { effectivePwa, iconLayout, PWA_DEFAULTS } = require("@praxis/shared").pwaDesign;

/* ── fixtures ─────────────────────────────────────────────────────────────── */

/** A 512×512 PNG that is pure red — easy to find in a composite. */
async function redSquare(size = 512) {
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
    .png()
    .toBuffer();
}

/** Colour at a fractional position (0..1) of a raw RGBA buffer. */
function pixelAt(raw, info, fx, fy) {
  const x = Math.min(info.width - 1, Math.max(0, Math.round(fx * info.width)));
  const y = Math.min(info.height - 1, Math.max(0, Math.round(fy * info.height)));
  const i = (y * info.width + x) * info.channels;
  return { r: raw[i], g: raw[i + 1], b: raw[i + 2], a: info.channels === 4 ? raw[i + 3] : 255 };
}

const isRed = (p) => p.r > 200 && p.g < 60 && p.b < 60;

/* ── the shared resolver ──────────────────────────────────────────────────── */

describe("effectivePwa — null means inherit, not empty", () => {
  const brand = { name: "Acme Freight", primary: "#123456", logoUrl: "/media/tenant_acme/branding/logo.png", theme: "dark" };

  it("inherits the brand name, colour and logo when nothing is configured", () => {
    const cfg = effectivePwa(null, brand);
    expect(cfg.name).toBe("Acme Freight");
    expect(cfg.themeColor).toBe("#123456");
    expect(cfg.iconUrl).toBe("/media/tenant_acme/branding/logo.png");
    // The maskable plate takes the BRAND colour, not the plain icon's white —
    // a white maskable icon reads as a missing icon on a light launcher.
    expect(cfg.maskableBackground).toBe("#123456");
    expect(cfg.iconBackground).toBe(PWA_DEFAULTS.iconBackground);
  });

  it("lets a dedicated app icon override the brand logo without touching it", () => {
    const cfg = effectivePwa({ iconUrl: "/media/tenant_acme/branding/appicon_a1.png" }, brand);
    expect(cfg.iconUrl).toBe("/media/tenant_acme/branding/appicon_a1.png");
    expect(cfg.splashLogoUrl).toBe("/media/tenant_acme/branding/appicon_a1.png");
  });

  it("follows the tenant's theme mode for the launch background", () => {
    expect(effectivePwa(null, { ...brand, theme: "dark" }).backgroundColor).toBe("#071324");
    expect(effectivePwa(null, { ...brand, theme: "light" }).backgroundColor).toBe("#f3f6fb");
    expect(effectivePwa({ backgroundColor: "#ff00ff" }, brand).backgroundColor).toBe("#ff00ff");
  });

  it("caps the short name at what a home-screen label shows", () => {
    const cfg = effectivePwa(null, { ...brand, name: "Continental Logistics International" });
    expect(cfg.shortName).toHaveLength(12);
  });

  it("survives a tenant with no branding at all", () => {
    const cfg = effectivePwa(null, null);
    expect(cfg.name).toBe("Praxis LS");
    expect(cfg.display).toBe("standalone");
    expect(cfg.iconUrl).toBeNull();
  });

  it("treats an empty string as unset, so clearing a field inherits again", () => {
    expect(effectivePwa({ appName: "" }, brand).name).toBe("Acme Freight");
  });
});

describe("iconLayout — the arithmetic the preview and the renderer share", () => {
  const cfg = effectivePwa(null, { name: "A", primary: "#000000" });

  it("centres the artwork inside the padding box", () => {
    const plain = iconLayout(cfg, false);
    expect(plain.size).toBeCloseTo(1 - (PWA_DEFAULTS.iconPadding / 100) * 2, 6);
    expect(plain.left).toBeCloseTo((1 - plain.size) / 2, 6);
    expect(plain.left).toBeCloseTo(plain.top, 6);
  });

  it("uses the safe-zone padding for the maskable variant", () => {
    const maskable = iconLayout(cfg, true);
    // 20% padding each side → the artwork occupies the middle 60%, which fits
    // inside the 80% safe circle every launcher is guaranteed to keep.
    expect(maskable.size).toBeCloseTo(0.6, 6);
    expect(maskable.left).toBeCloseTo(0.2, 6);
  });

  it("moves the box by the nudge offsets, in canvas fractions", () => {
    const nudged = iconLayout({ ...cfg, iconOffsetX: 10, iconOffsetY: -10 }, false);
    const base = iconLayout(cfg, false);
    expect(nudged.left - base.left).toBeCloseTo(0.1, 6);
    expect(nudged.top - base.top).toBeCloseTo(-0.1, 6);
  });
});

/* ── the rendered PNG ─────────────────────────────────────────────────────── */

describe("renderIcon — the bytes a device masks", () => {
  const { renderIcon } = require("../../src/routes/pwa");
  const base = effectivePwa(null, { name: "Acme", primary: "#1188ff" });

  it("renders the requested size as a PNG", async () => {
    const png = await renderIcon({ size: 192, maskable: false, cfg: base, logoBuf: await redSquare() });
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(192);
    expect(meta.height).toBe(192);
  });

  it("places the artwork exactly where iconLayout says it will", async () => {
    const cfg = { ...base, iconPadding: 20, iconZoom: 100, iconOffsetX: 0, iconOffsetY: 0 };
    const png = await renderIcon({ size: 256, maskable: false, cfg, logoBuf: await redSquare() });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    const { size, left, top } = iconLayout(cfg, false);
    // Just inside each edge of the predicted box → artwork.
    expect(isRed(pixelAt(data, info, left + 0.02, top + 0.02))).toBe(true);
    expect(isRed(pixelAt(data, info, left + size - 0.02, top + size - 0.02))).toBe(true);
    // Just outside it → background, not artwork. This is the assertion that
    // fails if the two implementations of the padding drift apart.
    expect(isRed(pixelAt(data, info, left - 0.04, top - 0.04))).toBe(false);
    expect(isRed(pixelAt(data, info, 0.5, top - 0.04))).toBe(false);
  });

  it("honours the nudge offsets", async () => {
    const cfg = { ...base, iconPadding: 20, iconOffsetX: 15, iconOffsetY: 0 };
    const png = await renderIcon({ size: 256, maskable: false, cfg, logoBuf: await redSquare() });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { size, left, top } = iconLayout(cfg, false);
    expect(isRed(pixelAt(data, info, left + 0.02, top + size / 2))).toBe(true);
    // The space the artwork vacated on the left is now background.
    expect(isRed(pixelAt(data, info, 0.22, top + size / 2))).toBe(false);
  });

  it("does not throw when zoom and offset push the artwork off the canvas", async () => {
    // 200% zoom with a 50% nudge puts most of the image outside the square.
    // sharp refuses an oversized or out-of-bounds composite, so this is the
    // case that used to be a 500 on a perfectly reasonable design choice.
    const cfg = { ...base, iconZoom: 200, iconOffsetX: 50, iconOffsetY: 50, iconPadding: 0 };
    const png = await renderIcon({ size: 128, maskable: false, cfg, logoBuf: await redSquare() });
    expect((await sharp(png).metadata()).width).toBe(128);
  });

  it("keeps the maskable variant opaque to the corners", async () => {
    const cfg = { ...base, maskableBackground: "#1188ff" };
    const png = await renderIcon({ size: 128, maskable: true, cfg, logoBuf: await redSquare() });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // Every corner must be fully opaque, or the launcher's crop shows wallpaper.
    for (const [x, y] of [
      [0.01, 0.01],
      [0.99, 0.01],
      [0.01, 0.99],
      [0.99, 0.99],
    ]) {
      expect(pixelAt(data, info, x, y).a).toBe(255);
    }
  });

  it("ignores a transparent background request for the maskable variant", async () => {
    const cfg = { ...base, iconBackground: "transparent", maskableBackground: "#1188ff" };
    const plain = await renderIcon({ size: 64, maskable: false, cfg, logoBuf: null });
    const maskable = await renderIcon({ size: 64, maskable: true, cfg, logoBuf: await redSquare() });
    const m = await sharp(maskable).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(pixelAt(m.data, m.info, 0.02, 0.02).a).toBe(255);
    // The monogram fallback is opaque either way — it IS the background.
    expect((await sharp(plain).metadata()).width).toBe(64);
  });

  it("falls back to a brand monogram when there is no artwork", async () => {
    const png = await renderIcon({ size: 96, maskable: false, cfg: base, logoBuf: null });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const corner = pixelAt(data, info, 0.5, 0.06); // above the letter, on the plate
    expect(corner.a).toBe(255);
    expect(corner.b).toBeGreaterThan(corner.r); // the brand blue, not white
  });
});

/* ── the routes, per tenant ───────────────────────────────────────────────── */

describe("GET /manifest.webmanifest and /icons — resolved by Host, never cross-tenant", () => {
  /**
   * Two tenants with different names, colours and icons, plus a host that maps
   * to no tenant at all. `withTenantConnection` is faked to hand back the
   * settings for whichever tenant the resolver picked — if a route ever read a
   * tenant from anywhere but the Host, it would read the wrong fixture and the
   * assertions below would notice.
   */
  const TENANTS = {
    "acme.praxis.test": { slug: "acme", tenant_id: "t-acme" },
    "globex.praxis.test": { slug: "globex", tenant_id: "t-globex" },
  };
  const DATA = {
    acme: {
      brand: { name: "Acme Freight", primary: "#ff0000", logoUrl: "/media/tenant_acme/branding/logo.png", theme: "light" },
      pwa: { appName: "Acme Go", shortName: "AcmeGo", themeColor: "#ff0000" },
    },
    globex: {
      brand: { name: "Globex", primary: "#0000ff", logoUrl: "/media/tenant_globex/branding/logo.png", theme: "dark" },
      pwa: { appName: "Globex One", display: "fullscreen" },
    },
  };

  let app;
  let storageReads;

  beforeEach(() => {
    jest.resetModules();
    storageReads = [];

    jest.doMock("../../src/middleware/host-tenent-resolver", () => ({
      hostTenantResolver: (req, _res, next) => {
        req.tenant = TENANTS[req.headers.host] || null;
        next();
      },
    }));

    jest.doMock("../../src/services/tenant/registry.service", () => ({
      withTenantConnection: (tenant, env, fn) => {
        // The env is pinned to live on purpose: a device fetching a manifest
        // sends no environment header, and an installed app's identity must not
        // be changeable from a sandbox experiment.
        expect(env).toBe("live");
        return fn({ __slug: tenant.slug });
      },
    }));

    jest.doMock("../../src/modules/branding/branding.service", () => {
      const real = jest.requireActual("../../src/modules/branding/branding.service");
      return {
        ...real,
        getBranding: (c) => Promise.resolve(DATA[c.__slug].brand),
        getPwa: (c) => Promise.resolve(DATA[c.__slug].pwa),
      };
    });

    jest.doMock("../../src/services/storage.service", () => ({
      get: async (key) => {
        storageReads.push(key);
        // Distinguishable artwork per tenant: red for acme, green for globex.
        const rgb = key.startsWith("tenant_acme/") ? { r: 255, g: 0, b: 0 } : { r: 0, g: 255, b: 0 };
        return sharp({ create: { width: 512, height: 512, channels: 4, background: { ...rgb, alpha: 1 } } })
          .png()
          .toBuffer();
      },
    }));

    const { router } = require("../../src/routes/pwa");
    app = express();
    app.use("/", router);
  });

  afterEach(() => jest.resetModules());

  it("serves each tenant its own manifest, chosen by Host alone", async () => {
    const acme = await request(app).get("/manifest.webmanifest").set("Host", "acme.praxis.test");
    expect(acme.status).toBe(200);
    expect(acme.type).toBe("application/manifest+json");
    expect(acme.body.name).toBe("Acme Go");
    expect(acme.body.short_name).toBe("AcmeGo");
    expect(acme.body.background_color).toBe("#f3f6fb"); // light theme
    expect(acme.body.display).toBe("standalone");

    const globex = await request(app).get("/manifest.webmanifest").set("Host", "globex.praxis.test");
    expect(globex.body.name).toBe("Globex One");
    expect(globex.body.background_color).toBe("#071324"); // dark theme
    expect(globex.body.display).toBe("fullscreen");
  });

  /**
   * WINDOW CONTROLS OVERLAY. `theme_color` stops being the brand accent here,
   * and that is the point rather than a regression: with WCO the page draws the
   * title bar itself, and `theme_color` is left painting only the strip behind
   * the caption buttons. Set it to the accent and an installed window gets a
   * loud coloured band butted against the app's own bar — a seam a few hundred
   * pixels from the right edge, which is the exact "bolted-on" artefact the
   * feature exists to remove.
   */
  describe("window-controls-overlay", () => {
    it("asks for WCO, keeping the plain display mode as the fallback", async () => {
      const res = await request(app).get("/manifest.webmanifest").set("Host", "acme.praxis.test");
      expect(res.body.display_override).toEqual(["window-controls-overlay", "standalone"]);
      // `display` stays, so a browser with no WCO support loses nothing.
      expect(res.body.display).toBe("standalone");
    });

    it("does not claim WCO for a display mode that has no window controls", async () => {
      // Globex is fullscreen — there are no caption buttons to overlay.
      const res = await request(app).get("/manifest.webmanifest").set("Host", "globex.praxis.test");
      expect(res.body.display_override).toEqual(["fullscreen"]);
    });

    it("paints theme_color as the title bar's own base, per the tenant's theme", async () => {
      // Light-theme tenant → the light surface; dark-theme tenant → the dark one.
      // Neither is the brand accent, and that is the fix.
      const light = await request(app).get("/manifest.webmanifest").set("Host", "acme.praxis.test");
      expect(light.body.theme_color).toBe("#ffffff");
      expect(light.body.theme_color).not.toBe(DATA.acme.brand.primary);

      const dark = await request(app).get("/manifest.webmanifest").set("Host", "globex.praxis.test");
      expect(dark.body.theme_color).toBe("#12161e");
    });
  });

  it("advertises the icon set an installable PWA needs", async () => {
    const res = await request(app).get("/manifest.webmanifest").set("Host", "acme.praxis.test");
    const sizes = res.body.icons.map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
    expect(res.body.start_url).toBe("/");
    expect(res.body.scope).toBe("/");
  });

  /**
   * THE FIX FOR "I CHANGED THE ICON AND NOTHING CHANGED". The icon paths are
   * fixed, so without a version in the URL a redesign is invisible to every
   * cache between the server and the launcher — the bytes changed, but nothing
   * had any reason to ask again.
   */
  describe("icon URLs carry a version, so a redesign actually propagates", () => {
    it("fingerprints every icon URL in the manifest", async () => {
      const res = await request(app).get("/manifest.webmanifest").set("Host", "acme.praxis.test");
      for (const icon of res.body.icons) expect(icon.src).toMatch(/\?v=[0-9a-f]{12}$/);
    });

    it("changes the fingerprint when the design changes, and only then", async () => {
      const base = effectivePwa({ iconUrl: "/media/tenant_acme/branding/a.png" }, DATA.acme.brand);
      const same = effectivePwa({ iconUrl: "/media/tenant_acme/branding/a.png" }, DATA.acme.brand);
      const newIcon = effectivePwa({ iconUrl: "/media/tenant_acme/branding/b.png" }, DATA.acme.brand);
      const nudged = effectivePwa({ iconUrl: "/media/tenant_acme/branding/a.png", iconZoom: 120 }, DATA.acme.brand);

      const v = (c) => require("../../src/routes/pwa").iconVersion(c);
      expect(v(base)).toBe(v(same)); // stable — a redeploy must not orphan caches
      expect(v(base)).not.toBe(v(newIcon)); // a new upload
      expect(v(base)).not.toBe(v(nudged)); // a slider move, which also changes the bytes
    });

    it("keeps `id` stable across a redesign, so it stays the same installed app", async () => {
      const before = await request(app).get("/manifest.webmanifest").set("Host", "acme.praxis.test");
      const after = await request(app).get("/manifest.webmanifest").set("Host", "globex.praxis.test");
      expect(before.body.id).toBe("/");
      expect(after.body.id).toBe("/");
    });

    it("caches a versioned icon hard and an unversioned one briefly", async () => {
      const versioned = await request(app).get("/icons/app-icon-192.png?v=abc123").set("Host", "acme.praxis.test");
      expect(versioned.headers["cache-control"]).toMatch(/immutable/);

      // No version = an old link someone still holds. It must expire soon, or
      // that link pins the previous icon for a year.
      const bare = await request(app).get("/icons/app-icon-192.png").set("Host", "acme.praxis.test");
      expect(bare.headers["cache-control"]).toBe("public, max-age=300");
    });

    it("serves the icon regardless of the version value — the URL is the cache key, not a lookup", async () => {
      // The fingerprint exists to make the URL unique, not to select anything.
      // A stale `?v=` must still render the CURRENT icon rather than 404.
      const res = await request(app).get("/icons/app-icon-192.png?v=stale0000000").set("Host", "acme.praxis.test");
      expect(res.status).toBe(200);
      const { data, info } = await sharp(res.body).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(isRed(pixelAt(data, info, 0.5, 0.5))).toBe(true);
    });
  });

  it("never reads one tenant's storage while serving another's origin", async () => {
    await request(app).get("/icons/app-icon-192.png").set("Host", "acme.praxis.test");
    expect(storageReads).toEqual(["tenant_acme/branding/logo.png"]);

    storageReads.length = 0;
    await request(app).get("/icons/app-icon-192.png").set("Host", "globex.praxis.test");
    expect(storageReads).toEqual(["tenant_globex/branding/logo.png"]);
  });

  it("does not serve a cached icon across tenants", async () => {
    // The rendered-PNG cache is process-global. If its key ever stopped
    // including the tenant, the second request here would return the first
    // tenant's artwork — and it would do so silently, on a real deployment,
    // for as long as the cache lived.
    const acme = await request(app).get("/icons/app-icon-192.png").set("Host", "acme.praxis.test");
    const globex = await request(app).get("/icons/app-icon-192.png").set("Host", "globex.praxis.test");

    const a = await sharp(acme.body).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const g = await sharp(globex.body).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(isRed(pixelAt(a.data, a.info, 0.5, 0.5))).toBe(true);
    const centre = pixelAt(g.data, g.info, 0.5, 0.5);
    expect(centre.g).toBeGreaterThan(200);
    expect(centre.r).toBeLessThan(60);
  });

  it("still produces an installable manifest for a host with no tenant", async () => {
    const res = await request(app).get("/manifest.webmanifest").set("Host", "www.praxis.test");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Praxis LS");
    expect(res.body.icons).toHaveLength(3);
  });

  it("still returns an icon when the tenant's stored artwork cannot be read", async () => {
    jest.resetModules();
    jest.doMock("../../src/middleware/host-tenent-resolver", () => ({
      hostTenantResolver: (req, _res, next) => {
        req.tenant = TENANTS["acme.praxis.test"];
        next();
      },
    }));
    jest.doMock("../../src/services/tenant/registry.service", () => ({
      withTenantConnection: (t, e, fn) => fn({ __slug: "acme" }),
    }));
    jest.doMock("../../src/modules/branding/branding.service", () => {
      const real = jest.requireActual("../../src/modules/branding/branding.service");
      return { ...real, getBranding: () => Promise.resolve(DATA.acme.brand), getPwa: () => Promise.resolve(DATA.acme.pwa) };
    });
    jest.doMock("../../src/services/storage.service", () => ({
      get: () => Promise.reject(new Error("ENOENT")),
    }));

    const { router } = require("../../src/routes/pwa");
    const broken = express();
    broken.use("/", router);

    const res = await request(broken).get("/icons/app-icon-192.png").set("Host", "acme.praxis.test");
    expect(res.status).toBe(200);
    expect((await sharp(res.body).metadata()).width).toBe(192); // the monogram
  });

  it("still produces a manifest when the tenant database throws", async () => {
    jest.resetModules();
    jest.doMock("../../src/middleware/host-tenent-resolver", () => ({
      hostTenantResolver: (req, _res, next) => {
        req.tenant = { slug: "acme" };
        next();
      },
    }));
    jest.doMock("../../src/services/tenant/registry.service", () => ({
      withTenantConnection: () => Promise.reject(new Error("connection terminated")),
    }));

    const { router } = require("../../src/routes/pwa");
    const down = express();
    down.use("/", router);

    const res = await request(down).get("/manifest.webmanifest").set("Host", "acme.praxis.test");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("acme"); // the slug, so "Add to home screen" still works
  });
});

/* ── writes ───────────────────────────────────────────────────────────────── */

describe("setPwa — what the API accepts from the editor", () => {
  /** A fake tenant client that records what the repo would have written. */
  function fakeClient() {
    const written = {};
    return {
      written,
      query: jest.fn(async (sql, params) => {
        if (/SELECT key, value FROM setting/.test(sql)) {
          return { rows: Object.entries(written).map(([key, value]) => ({ key, value })) };
        }
        if (/INSERT INTO setting/.test(sql)) {
          written[params[1]] = JSON.parse(params[2]);
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
  }

  beforeEach(() => {
    jest.resetModules();
    // `doMock` registrations outlive resetModules, and the route suite above
    // replaced getPwa/getBranding with fixtures. This suite exercises the REAL
    // service, so it has to say so explicitly.
    jest.dontMock("../../src/modules/branding/branding.service");
    jest.dontMock("../../src/services/storage.service");
    jest.doMock("../../src/shared/events/emit", () => ({ audit: jest.fn() }));
  });
  afterEach(() => jest.resetModules());

  it("stores only the fields that were provided", async () => {
    const svc = require("../../src/modules/branding/branding.service");
    const c = fakeClient();
    await svc.setPwa(c, { actorId: "u1", appName: "Acme Go" });
    expect(c.written).toEqual({ app_name: "Acme Go" });
  });

  it("rejects a display mode it does not know", async () => {
    const svc = require("../../src/modules/branding/branding.service");
    await expect(svc.setPwa(fakeClient(), { actorId: "u1", display: "kiosk" })).rejects.toMatchObject({ status: 422 });
  });

  it("clamps slider values instead of failing the whole save", async () => {
    const svc = require("../../src/modules/branding/branding.service");
    const c = fakeClient();
    await svc.setPwa(c, { actorId: "u1", iconZoom: 900, maskablePadding: -5 });
    expect(c.written.icon_zoom).toBe(200);
    expect(c.written.maskable_padding).toBe(10);
  });

  it("stores empty as null, so clearing a field means inherit", async () => {
    const svc = require("../../src/modules/branding/branding.service");
    const c = fakeClient();
    await svc.setPwa(c, { actorId: "u1", appName: "" });
    expect(c.written.app_name).toBeNull();
    expect(effectivePwa(await svc.getPwa(c), { name: "Acme Freight" }).name).toBe("Acme Freight");
  });

  it("caps free text so a paste accident cannot bloat the manifest", async () => {
    const svc = require("../../src/modules/branding/branding.service");
    const c = fakeClient();
    await svc.setPwa(c, { actorId: "u1", shortName: "Continental Logistics", description: "x".repeat(5000) });
    expect(c.written.short_name).toHaveLength(12);
    expect(c.written.description).toHaveLength(300);
  });

  it("ignores keys that are not part of the contract", async () => {
    const svc = require("../../src/modules/branding/branding.service");
    const c = fakeClient();
    await svc.setPwa(c, { actorId: "u1", appName: "Acme", tenant_id: "somebody-elses", section: "appearance" });
    expect(Object.keys(c.written)).toEqual(["app_name"]);
  });
});

/**
 * The App & PWA screen is environment-independent, and that is load-bearing.
 *
 * `src/routes/pwa.js` reads `live` unconditionally, because a device fetching a
 * manifest sends no `X-Praxis-Env` header. So a sandbox-scoped write here would
 * produce a configuration nothing could ever read — and the editor, overlaying
 * sandbox on live, would show it back as if it had saved. Someone would upload
 * an icon in TEST, watch the preview render it, save, and conclude the feature
 * was broken. These pin both halves to the live binding so that cannot recur.
 */
describe("PWA config is live-only, in both directions", () => {
  const controller = require("../../src/modules/branding/branding.controller");

  /** A request in TEST mode: `tenantDb` is the sandbox schema, `identityDb` is
   *  live. Exactly the shape tenant-context.js builds. */
  function testModeReq(body) {
    const seen = [];
    return {
      req: {
        env: "sandbox",
        user: { user_id: "u1" },
        body,
        tenant: { slug: "acme" },
        tenantDb: (fn) => {
          seen.push("sandbox");
          return fn({ __env: "sandbox" });
        },
        identityDb: (fn) => {
          seen.push("live");
          return fn({ __env: "live" });
        },
      },
      seen,
    };
  }

  const res = () => {
    const out = {};
    return { json: (b) => Object.assign(out, b), body: out };
  };

  beforeEach(() => {
    jest.resetModules();
    jest.dontMock("../../src/modules/branding/branding.service");
  });
  afterEach(() => jest.resetModules());

  it("reads live even when the request is in TEST mode", async () => {
    jest.doMock("../../src/modules/branding/branding.service", () => ({
      getPwa: (c) => Promise.resolve({ __from: c.__env }),
    }));
    const c = require("../../src/modules/branding/branding.controller");
    const { req, seen } = testModeReq(null);
    const r = res();
    await c.getPwa(req, r, () => {});
    expect(seen).toEqual(["live"]);
    expect(r.body.data.__from).toBe("live");
  });

  it("writes live even when the request is in TEST mode", async () => {
    jest.doMock("../../src/modules/branding/branding.service", () => ({
      setPwa: (c, fields) => Promise.resolve({ __to: c.__env, ...fields }),
    }));
    const c = require("../../src/modules/branding/branding.controller");
    const { req, seen } = testModeReq({ appName: "Acme Go" });
    const r = res();
    await c.putPwa(req, r, () => {});
    expect(seen).toEqual(["live"]);
    expect(r.body.data.__to).toBe("live");
    expect(r.body.data.appName).toBe("Acme Go");
  });

  it("still works on a request with no identity binding", async () => {
    // Defensive: `identityDb` is set by tenant-context, but the fallback keeps
    // this from being a 500 if a route is ever mounted without it.
    jest.doMock("../../src/modules/branding/branding.service", () => ({
      getPwa: () => Promise.resolve({ ok: true }),
    }));
    const c = require("../../src/modules/branding/branding.controller");
    const r = res();
    await c.getPwa({ env: "live", tenantDb: (fn) => fn({}), tenant: { slug: "acme" } }, r, () => {});
    expect(r.body.data.ok).toBe(true);
  });

  it("leaves APPEARANCE env-scoped — this change is scoped to the PWA section", async () => {
    // The sandbox override exists for a real reason there (try a palette against
    // test data), and narrowing that was not the intent.
    jest.doMock("../../src/modules/branding/branding.service", () => ({
      setBranding: (c) => Promise.resolve({ __to: c.__env }),
    }));
    const c = require("../../src/modules/branding/branding.controller");
    const { req, seen } = testModeReq({ primary: "#123456" });
    const r = res();
    await c.put(req, r, () => {});
    expect(seen).toEqual(["sandbox"]);
  });
});

describe("uploadAppIcon — where the bytes land", () => {
  const PNG_1PX =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  beforeEach(() => {
    jest.resetModules();
    jest.dontMock("../../src/modules/branding/branding.service");
  });
  afterEach(() => jest.resetModules());

  it("namespaces the key under the tenant, in a segment /media serves publicly", async () => {
    let capturedKey;
    jest.doMock("../../src/services/storage.service", () => ({
      put: async (buf, opts) => {
        capturedKey = opts.key;
        return { public_url: `/media/${opts.key}` };
      },
    }));
    const svc = require("../../src/modules/branding/branding.service");
    const { isPublicStorageKey } = require("../../src/shared/http/media-guard");

    const { iconUrl } = await svc.uploadAppIcon({ dataUrl: PNG_1PX, slug: "acme" });
    expect(capturedKey).toMatch(/^tenant_acme\/branding\/appicon_[0-9a-f]{12}\.png$/);
    // The login screen and the install banner both render this pre-auth, so the
    // key has to be one the /media allow-list actually serves.
    expect(isPublicStorageKey(capturedKey)).toBe(true);
    expect(iconUrl).toBe(`/media/${capturedKey}`);
  });

  it("refuses anything that is not an image data URL", async () => {
    jest.doMock("../../src/services/storage.service", () => ({ put: jest.fn() }));
    const svc = require("../../src/modules/branding/branding.service");
    await expect(svc.uploadAppIcon({ dataUrl: "https://example.com/x.png", slug: "acme" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      svc.uploadAppIcon({ dataUrl: "data:application/pdf;base64,AAAA", slug: "acme" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
