/**
 * The storage half of the image pipeline: what gets written on upload, and the
 * on-demand regeneration that lets <picture> reference a derivative safely.
 *
 * Runs against a real local storage root in a temp directory rather than a
 * mock, because the interesting failures are in the key handling — the
 * traversal guard, the extension probe, the allow-list — and a mocked
 * storage.put would assert nothing about any of them.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "praxis-img-"));
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_PATH = root;

const sharp = require("sharp");
const storage = require("../../src/services/storage.service");
const {
  storeImage,
  ensureDerivative,
  parseDerivativeKey,
  derivativeKey,
} = require("../../src/services/image-pipeline.service");

async function photo(width = 800, height = 600) {
  return {
    buffer: await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 110, g: 150, b: 120 },
      },
    })
      .jpeg({ quality: 92 })
      .toBuffer(),
    mimetype: "image/jpeg",
    originalname: "warehouse.jpg",
  };
}

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("storeImage", () => {
  const key = "tenant_acme/site/hero_ab12cd34.jpg";

  it("writes the master and its derivatives under derived keys", async () => {
    const out = await storeImage(await photo(), { key, profile: "photo" });

    expect(out.key).toBe(key);
    expect(fs.existsSync(path.join(root, key))).toBe(true);
    expect(out.derivatives.length).toBeGreaterThan(0);

    for (const d of out.derivatives) {
      expect(d.key).toBe(derivativeKey(key, d.variant, d.format));
      expect(fs.existsSync(path.join(root, d.key))).toBe(true);
    }
  }, 30000);

  it("hashes the STORED bytes, not the bytes it was handed", async () => {
    // document_signature records artifact_hash from the vault row's
    // content_hash and document_verification compares the two, so a hash of the
    // pre-compression bytes would fail verification against the stored file.
    const file = await photo();
    const out = await storeImage(file, {
      key: "tenant_acme/site/hash_ab12cd34.jpg",
      profile: "photo",
    });

    const crypto = require("crypto");
    const onDisk = fs.readFileSync(
      path.join(root, "tenant_acme/site/hash_ab12cd34.jpg"),
    );
    expect(out.content_hash).toBe(
      crypto.createHash("sha256").update(onDisk).digest("hex"),
    );
    expect(out.content_hash).not.toBe(
      crypto.createHash("sha256").update(file.buffer).digest("hex"),
    );
  }, 30000);
});

describe("ensureDerivative", () => {
  it("regenerates a derivative from a master that predates the pipeline", async () => {
    // A legacy image: master written directly, no derivatives beside it.
    const legacy = "tenant_acme/site/legacy_99887766.jpg";
    const file = await photo();
    await storage.put(file.buffer, { key: legacy, contentType: "image/jpeg" });

    const want = derivativeKey(legacy, "thumb", "webp");
    expect(fs.existsSync(path.join(root, want))).toBe(false);

    const made = await ensureDerivative(want, { profile: "photo" });
    expect(made).not.toBeNull();
    expect(made.contentType).toBe("image/webp");

    // It is persisted, so the second request is a plain read.
    expect(fs.existsSync(path.join(root, want))).toBe(true);
    const meta = await sharp(made.buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width, meta.height)).toBe(256);
  }, 30000);

  it("returns null when no master exists, so the route 404s", async () => {
    const made = await ensureDerivative(
      "tenant_acme/site/nothing_here.thumb.avif",
      { profile: "photo" },
    );
    expect(made).toBeNull();
  }, 20000);

  it("refuses a variant it does not produce", async () => {
    // The guard that stops a public URL becoming a CPU-exhaustion primitive:
    // an attacker naming their own dimensions must never reach an encoder.
    for (const bad of [
      "tenant_acme/site/hero_ab12cd34.99999.avif",
      "tenant_acme/site/hero_ab12cd34.4000.webp",
      "tenant_acme/site/hero_ab12cd34.thumb.bmp",
      "tenant_acme/site/hero_ab12cd34.jpg",
    ]) {
      expect(parseDerivativeKey(bad)).toBeNull();
      await expect(ensureDerivative(bad, { profile: "photo" })).resolves.toBeNull();
    }
  }, 20000);

  it("does not let a derivative key escape the storage root", async () => {
    await expect(
      ensureDerivative("../../etc/passwd.thumb.avif", { profile: "photo" }),
    ).resolves.toBeNull();
    expect(fs.existsSync(path.join(root, "../../etc/passwd.thumb.avif"))).toBe(
      false,
    );
  }, 20000);
});
