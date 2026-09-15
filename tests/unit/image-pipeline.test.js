/**
 * Image pipeline — behaviour that must not regress.
 *
 * The load-bearing test here is "document profile leaves the pixels alone".
 * Everything else is byte savings, which is recoverable; silently brightening
 * a scanned customs declaration or a KYC identity document is not, because the
 * damage is only discovered when someone compares the stored image to the
 * paper during an audit.
 */
"use strict";

const sharp = require("sharp");
const {
  processImage,
  derivativeKey,
  isProcessable,
  profileFor,
  PROFILES,
  SIZES,
} = require("../../src/services/image-pipeline.service");

/** Build a raw RGB image with a deliberate green cast and low exposure. */
async function dullPhoto(width = 900, height = 675, format = "jpeg") {
  const px = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    const y = (i / width) | 0;
    const base = 80 + Math.sin(x / 40) * 16 + Math.cos(y / 30) * 12;
    px[i * 3] = Math.max(0, Math.min(255, base - 14));
    px[i * 3 + 1] = Math.max(0, Math.min(255, base + 22));
    px[i * 3 + 2] = Math.max(0, Math.min(255, base - 8));
  }
  const img = sharp(px, { raw: { width, height, channels: 3 } });
  const buffer =
    format === "png"
      ? await img.png().toBuffer()
      : await img.jpeg({ quality: 95 }).toBuffer();
  return {
    buffer,
    mimetype: format === "png" ? "image/png" : "image/jpeg",
    originalname: `yard.${format === "png" ? "png" : "jpg"}`,
  };
}

/**
 * A flat image, cheap for AVIF to encode. The sizing tests only assert on
 * dimensions and byte direction, and a noisy fixture made them the slowest
 * thing in the backend suite for no extra coverage.
 */
async function flatImage(width, height) {
  return {
    buffer: await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 120, g: 140, b: 130 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer(),
    mimetype: "image/jpeg",
    originalname: "flat.jpg",
  };
}

/** Mean of each colour channel, as a cast/exposure fingerprint. */
async function channelMeans(buffer) {
  const { channels } = await sharp(buffer).stats();
  return channels.slice(0, 3).map((c) => c.mean);
}

describe("image pipeline — profiles", () => {
  it("leaves a document's colour balance and exposure untouched", async () => {
    const file = await dullPhoto();
    const before = await channelMeans(file.buffer);
    const out = await processImage(file, { profile: "document" });
    const after = await channelMeans(out.master.buffer);

    // The green cast must survive: G stays well above R and B, by very nearly
    // the amount it started with. A white-balance pass would close this gap.
    const gapBefore = before[1] - before[0];
    const gapAfter = after[1] - after[0];
    expect(gapAfter).toBeGreaterThan(gapBefore * 0.9);

    // And the exposure must not be lifted — normalise() would raise this a lot.
    expect(after[0]).toBeLessThan(before[0] + 6);
  }, 30000);

  it("corrects cast and exposure for a photo", async () => {
    const file = await dullPhoto();
    const before = await channelMeans(file.buffer);
    const out = await processImage(file, { profile: "photo" });
    const after = await channelMeans(out.master.buffer);

    // Exposure lifted by normalise().
    expect(after[0]).toBeGreaterThan(before[0]);
    // Cast reduced by the grey-world pass.
    expect(after[1] - after[0]).toBeLessThan(before[1] - before[0]);
  }, 30000);

  it("keeps a brand logo's colours byte-faithful", async () => {
    // The white-label invariant. A tenant's logo green must come back the same
    // green: normalise() would stretch the histogram and the grey-world pass
    // would shift channel gains, and nobody would ever file that as a bug.
    const logo = {
      buffer: await sharp({
        create: {
          width: 600,
          height: 400,
          channels: 3,
          background: { r: 18, g: 122, b: 74 },
        },
      })
        .png()
        .toBuffer(),
      mimetype: "image/png",
      originalname: "logo.png",
    };

    const out = await processImage(logo, { profile: "brand" });
    const [r, g, b] = await channelMeans(out.master.buffer);
    expect(Math.round(r)).toBe(18);
    expect(Math.round(g)).toBe(122);
    expect(Math.round(b)).toBe(74);
    expect(PROFILES.brand.enhance).toBe(false);
  }, 30000);

  it("crops an avatar square", async () => {
    const out = await processImage(await dullPhoto(), { profile: "avatar" });
    const meta = await sharp(out.master.buffer).metadata();
    expect(meta.width).toBe(meta.height);
    expect(meta.width).toBeLessThanOrEqual(PROFILES.avatar.maxEdge);
  }, 30000);

  it("falls back to the conservative profile when none is named", async () => {
    expect(profileFor(undefined)).toBe(PROFILES.document);
    expect(profileFor("nonsense")).toBe(PROFILES.document);
    expect(PROFILES.document.enhance).toBe(false);
  });
});

describe("image pipeline — sizing", () => {
  it("downscales an oversized image to the profile cap", async () => {
    const file = await flatImage(3200, 2400);
    const out = await processImage(file, { profile: "photo" });
    const meta = await sharp(out.master.buffer).metadata();
    expect(Math.max(meta.width, meta.height)).toBe(PROFILES.photo.maxEdge);
    expect(out.master.bytes).toBeLessThan(out.original_bytes);
  }, 30000);

  it("never enlarges an image that is already small", async () => {
    const file = await flatImage(320, 240);
    const out = await processImage(file, { profile: "photo" });
    const meta = await sharp(out.master.buffer).metadata();
    expect(meta.width).toBeLessThanOrEqual(320);
  }, 30000);
});

describe("image pipeline — derivatives", () => {
  it("emits an AVIF and a WebP per variant, at the variant's size", async () => {
    const out = await processImage(await flatImage(2000, 1500), {
      profile: "photo",
    });
    const formats = new Set(out.derivatives.map((d) => d.format));
    expect(formats).toEqual(new Set(["avif", "webp"]));

    const thumbs = out.derivatives.filter((d) => d.variant === "thumb");
    expect(thumbs).toHaveLength(2);
    for (const t of thumbs) {
      const meta = await sharp(t.buffer).metadata();
      expect(Math.max(meta.width, meta.height)).toBe(SIZES.thumb);
    }
  }, 40000);

  it("keeps a thumb far smaller than the master — the page-load win", async () => {
    const out = await processImage(await dullPhoto(1200, 900), {
      profile: "photo",
    });
    const thumb = out.derivatives.find(
      (d) => d.variant === "thumb" && d.format === "webp",
    );
    expect(thumb.bytes * 5).toBeLessThan(out.master.bytes);
  }, 40000);
});

describe("image pipeline — formats", () => {
  it("keeps the master in its source format so downloads stay portable", async () => {
    const jpeg = await processImage(await dullPhoto(600, 450, "jpeg"), {
      profile: "document",
    });
    expect(jpeg.master.mime_type).toBe("image/jpeg");
    expect((await sharp(jpeg.master.buffer).metadata()).format).toBe("jpeg");

    const png = await processImage(await dullPhoto(600, 450, "png"), {
      profile: "document",
    });
    expect(png.master.mime_type).toBe("image/png");
    expect((await sharp(png.master.buffer).metadata()).format).toBe("png");
  }, 40000);

  it("does not palette-quantise a PNG master", async () => {
    // A 256-colour palette would collapse this gradient; a lossless PNG keeps
    // far more distinct values than a quantised one can represent.
    const out = await processImage(await dullPhoto(600, 450, "png"), {
      profile: "document",
    });
    const meta = await sharp(out.master.buffer).metadata();
    expect(meta.paletteBitDepth).toBeUndefined();
  }, 30000);

  it("passes non-raster uploads through untouched", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    const out = await processImage(
      { buffer: svg, mimetype: "image/svg+xml", originalname: "logo.svg" },
      { profile: "photo" },
    );
    expect(out.master.buffer).toBe(svg);
    expect(out.derivatives).toHaveLength(0);
    expect(out.processed).toBe(false);
    expect(isProcessable("image/svg+xml")).toBe(false);
  });
});

describe("image pipeline — resilience", () => {
  it("returns a pass-through rather than throwing on unreadable bytes", async () => {
    const junk = Buffer.from("not an image at all");
    const out = await processImage(
      { buffer: junk, mimetype: "image/jpeg", originalname: "broken.jpg" },
      { profile: "photo" },
    );
    expect(out.processed).toBe(false);
    expect(out.master.buffer).toBe(junk);
  });

  it("handles an empty or absent file without throwing", async () => {
    await expect(processImage(null, {})).resolves.toMatchObject({
      processed: false,
    });
    await expect(
      processImage({ buffer: Buffer.alloc(0), mimetype: "image/png" }, {}),
    ).resolves.toMatchObject({ processed: false });
  });
});

describe("derivativeKey", () => {
  it("derives a sibling key from the master key", () => {
    expect(derivativeKey("tenant_acme/vault/doc_9f2c.jpg", "thumb", "avif")).toBe(
      "tenant_acme/vault/doc_9f2c.thumb.avif",
    );
  });

  it("handles a key with no extension", () => {
    expect(derivativeKey("tenant_acme/logo", "preview", "webp")).toBe(
      "tenant_acme/logo.preview.webp",
    );
  });

  it("produces keys the storage traversal guard accepts", () => {
    // Mirrors storage.service.js KEY_RE — a derivative key must never be the
    // thing that trips the path guard at write time.
    const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;
    for (const variant of ["thumb", "preview", "full"]) {
      for (const format of ["avif", "webp"]) {
        const key = derivativeKey("tenant_acme/vault/doc_9f2c.jpg", variant, format);
        expect(KEY_RE.test(key)).toBe(true);
        expect(key.includes("..")).toBe(false);
      }
    }
  });
});
