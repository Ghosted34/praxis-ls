/**
 * Image pipeline — the one engine every image upload goes through.
 *
 * WHY THIS EXISTS. `media-compression.service.js` has done the sharp work
 * correctly since it was written, and nothing ever imported it. Uploads went
 * to storage at whatever size the phone produced: a 6000x4000 JPEG straight
 * off a camera, base64-inflated a further 33% on the way in, then served back
 * at full size into a 96px table thumbnail. That is the bytes, the upload
 * wait and the page load, all three, and it is why a "compression engine"
 * reads as missing even though the compression code was already here.
 *
 * So this module is deliberately NOT a second compressor. It keeps
 * media-compression as the HEIC/normalisation layer it already is and adds
 * the three things that were absent: per-purpose PROFILES, sized
 * DERIVATIVES, and modern-format (AVIF/WebP) encoding.
 *
 * ── PROFILES, and why the distinction is load-bearing ──────────────────────
 *
 * The same upload path carries a tenant's marketing photography AND a scanned
 * customs declaration. Those want opposite treatment:
 *
 *   'photo'    — auto-level, grey-world white balance, post-resize sharpen.
 *                A dull phone shot of a warehouse becomes a usable hero image.
 *   'document' — orientation fix, downscale, high-quality re-encode. NOTHING
 *                that alters what the page says. Auto-levels on a faint
 *                carbon-copy stamp or a pale signature pushes it to white, and
 *                an OHADA/KYC/customs scan that no longer matches the paper is
 *                a problem discovered during an audit, not in review.
 *   'avatar'   — square attention crop, small, enhanced.
 *
 * A caller that does not name a profile gets 'document', because the
 * conservative treatment is the safe default when nobody has thought about it.
 *
 * ── FORMATS ────────────────────────────────────────────────────────────────
 *
 * Derivatives are AVIF (primary) and WebP (fallback); the browser picks via
 * <picture>/srcset. The MASTER is kept in its source raster format — JPEG
 * stays JPEG, PNG stays PNG — because the master is what a download hands the
 * user, and an agent forwarding a customs scan to a broker, a bank or a
 * government e-portal cannot send a .webp to systems that refuse it.
 *
 * Two formats are NOT produced here and must not be: PWA/favicon icons
 * (icon-pipeline.service.js, PNG — the manifest spec and apple-touch-icon
 * require it) and email signature images (mail/signature/signature.png.js,
 * PNG — Outlook desktop still renders WebP as a broken-image box).
 *
 * ── HASHING ────────────────────────────────────────────────────────────────
 *
 * Callers must hash the MASTER THIS RETURNS, never the bytes they received.
 * document_signature records `artifact_hash` from the vault row's
 * `content_hash` and document_verification compares the two, so the recorded
 * hash has to describe the bytes actually in storage. For the same reason a
 * backfill may never re-encode a document that a signature already references.
 */

"use strict";

const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const { logger } = require("../config/logger");
const storage = require("./storage.service");
const { normalizeImageInput, isHeic } = require("./media-compression.service");

/* ── profiles and sizes ─────────────────────────────────────────────────── */

/** Longest-edge caps per derivative. `full` doubles as the master's cap. */
const SIZES = Object.freeze({ thumb: 256, preview: 1024, full: 2400 });

/**
 * Per-purpose treatment. `enhance` is the only field that changes pixels
 * beyond scaling, and it is false everywhere a human might later be asked to
 * trust the image as a record of something.
 */
const PROFILES = Object.freeze({
  photo: {
    maxEdge: SIZES.full,
    quality: 82,
    enhance: true,
    square: false,
    variants: ["thumb", "preview", "full"],
  },
  document: {
    // Scans carry small text; 2600 keeps a full A4 at ~220dpi, which stays
    // legible zoomed in where 1600 does not.
    maxEdge: 2600,
    quality: 88,
    enhance: false,
    square: false,
    variants: ["thumb", "preview"],
  },
  // A tenant's own logo and app icon. Enhancement is OFF and that is a
  // white-label requirement, not a quality preference: normalise() stretches
  // the histogram and the grey-world pass shifts channel gains, so a brand
  // whose logo is a specific green would get a SLIGHTLY DIFFERENT green back.
  // Nobody would file that bug, and it would be wrong on every screen.
  brand: {
    maxEdge: 1024,
    quality: 90,
    enhance: false,
    square: false,
    variants: ["thumb", "preview"],
  },
  avatar: {
    maxEdge: 512,
    quality: 85,
    enhance: true,
    square: true,
    variants: ["thumb", "preview"],
  },
});

const DEFAULT_PROFILE = "document";

/**
 * Infer a profile from a storage key's segment, so an on-demand derivative
 * matches what the upload itself would have produced.
 *
 * Keys are `tenant_<slug>/<segment>/<file>` (see shared/http/media-guard.js),
 * and the segment already encodes purpose: `vault` is evidence, `avatars` are
 * faces, the rest is presentation. Without this a regenerated thumbnail would
 * silently use different quality settings from the eager one beside it.
 */
function profileForKey(key) {
  const segment = String(key || "").split("/")[1] || "";
  if (segment === "avatars") return "avatar";
  if (segment === "vault" || segment === "documents") return "document";
  // `branding` and `entity` carry logos and app icons — brand colour must come
  // back byte-faithful. `site`/`login` are photographic backdrops.
  if (segment === "branding" || segment === "entity") return "brand";
  if (segment === "login" || segment === "site" || segment === "signatures") {
    return "photo";
  }
  return DEFAULT_PROFILE;
}

/** Rasters we re-encode. SVG and GIF pass through untouched — vector has no
 *  business being rasterised, and an animated GIF loses its animation. */
const RASTER = new Set(["image/jpeg", "image/png", "image/webp"]);

const EXT_FOR_MIME = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
});

function profileFor(name) {
  return PROFILES[String(name || "").toLowerCase()] || PROFILES[DEFAULT_PROFILE];
}

/** True when this mime is something the pipeline will re-encode. */
function isProcessable(mime) {
  return RASTER.has(String(mime || "").toLowerCase());
}

/* ── enhancement ────────────────────────────────────────────────────────── */

/**
 * Grey-world auto white balance.
 *
 * The assumption — that a scene averages to grey — is wrong often enough that
 * applying it at full strength ruins deliberately warm photography (a sunset
 * becomes grey sludge). So the per-channel multipliers are CLAMPED hard: at
 * most ±8%. That is enough to pull the green cast off a warehouse shot taken
 * under fluorescent tubes, which is the actual case in this corridor, and not
 * enough to meaningfully damage a photo that was already balanced.
 *
 * Returns null when the correction is not worth doing, so the caller can skip
 * a whole sharp op rather than apply an identity transform.
 */
async function greyWorldGains(img) {
  let stats;
  try {
    stats = await img.stats();
  } catch (err) {
    // stats() reads the whole image; on a truncated or exotic file it throws.
    // Skipping white balance is always acceptable — failing the upload is not.
    logger.debug({ err }, "image stats unavailable; skipping white balance");
    return null;
  }

  const ch = stats && Array.isArray(stats.channels) ? stats.channels : [];
  if (ch.length < 3) return null; // greyscale or single-channel: nothing to balance

  const [r, g, b] = ch;
  const means = [r.mean, g.mean, b.mean];
  if (means.some((m) => !Number.isFinite(m) || m <= 1)) return null; // near-black

  const grey = (means[0] + means[1] + means[2]) / 3;
  const clamp = (n) => Math.min(1.08, Math.max(0.92, n));
  const gains = means.map((m) => clamp(grey / m));

  // Within 1% of neutral on every channel means there is nothing to correct.
  if (gains.every((n) => Math.abs(n - 1) < 0.01)) return null;
  return gains;
}

/**
 * Apply the 'photo' enhancement chain to a sharp instance, in the order that
 * matters: white balance on the ORIGINAL pixels, then the caller resizes, then
 * sharpen. Sharpening before a downscale is wasted (the resample discards the
 * haloes) and normalising after one is measurably noisier.
 */
async function applyWhiteBalance(img) {
  const gains = await greyWorldGains(img);
  if (!gains) return img;
  // sharp's linear() takes per-channel arrays; offsets stay at zero because we
  // are correcting a cast, not lifting black point (normalise does that).
  return img.linear(gains, [0, 0, 0]);
}

/* ── the pipeline ───────────────────────────────────────────────────────── */

/**
 * Build one derivative buffer at a given longest edge and format.
 * `pipeline` must be a fresh sharp instance — sharp instances are single-use
 * once a format has been selected.
 */
async function encodeVariant(source, { edge, format, quality, enhance, square }) {
  let img = sharp(source, { failOn: "none" }).rotate(); // EXIF orientation first

  if (enhance) {
    img = await applyWhiteBalance(img);
    // normalise() stretches the luminance histogram to the full range — the
    // single biggest visual win on under-exposed phone photos, which is most
    // of what field agents upload.
    img = img.normalise();
  }

  img = img.resize({
    width: edge,
    height: square ? edge : undefined,
    fit: square ? "cover" : "inside",
    // 'attention' crops toward the region of highest entropy, which on a
    // portrait is the face far more often than a centre crop manages.
    position: square ? sharp.strategy.attention : undefined,
    withoutEnlargement: true,
  });

  if (enhance) {
    // Modest unsharp mask to recover the softness every downscale introduces.
    img = img.sharpen({ sigma: 0.7, m1: 0.5, m2: 2 });
  }

  if (format === "avif") {
    // AVIF is perceptually ~equal to WebP some 20 points lower on the quality
    // scale, so q55 here is not a downgrade against q82 WebP — it is roughly
    // the same picture for ~25% fewer bytes. effort:4 keeps encode time sane;
    // effort:9 is ~6x slower for low single-digit byte gains.
    return img.avif({ quality: Math.max(40, quality - 27), effort: 4 }).toBuffer();
  }
  if (format === "webp") {
    return img.webp({ quality }).toBuffer();
  }
  if (format === "png") {
    // NOT palette:true. Quantising to 256 colours is a big byte win on a flat
    // logo and visible banding on a scanned document or a photograph, and this
    // one branch serves both. PNG masters therefore stay LOSSLESS; the byte
    // saving for PNG sources comes from the downscale and from the AVIF/WebP
    // derivatives beside them, neither of which costs any fidelity here.
    return img.png({ compressionLevel: 9, palette: false }).toBuffer();
  }
  return img.jpeg({ quality, mozjpeg: true }).toBuffer();
}

/** Swap a filename's extension for one matching a (possibly converted) mime. */
function filenameFor(filename, mime) {
  const ext = EXT_FOR_MIME[String(mime || "").toLowerCase()];
  if (!ext) return filename;
  const base = filename
    ? path.basename(filename, path.extname(filename)) || "image"
    : "image";
  return `${base}.${ext}`;
}

/**
 * Derivative storage key, derived deterministically from the master's key:
 *
 *   tenant_acme/vault/doc_9f2c.jpg  →  tenant_acme/vault/doc_9f2c.thumb.avif
 *
 * WHY DERIVED AND NOT STORED. Recording three extra keys per image would mean
 * a migration on every table that holds a storage_path — vault documents,
 * employee photos, site assets, success stories — and a backfill for every
 * existing row. A derived key needs neither: any reader that has the master
 * key can compute the derivative key, and a missing derivative is detectable
 * (storage 404) and regenerable. The suffix charset stays inside
 * storage.service's KEY_RE, so the traversal guard still applies unchanged.
 */
function derivativeKey(masterKey, variant, format) {
  const key = String(masterKey || "");
  const ext = path.extname(key);
  const stem = ext ? key.slice(0, -ext.length) : key;
  return `${stem}.${variant}.${format}`;
}

/**
 * Run an upload through the pipeline.
 *
 * Accepts a multer-style file ({ buffer, mimetype, originalname }) so it can
 * sit behind either transport — multipart today, the legacy base64 data-URL
 * callers until PR2 migrates them.
 *
 * Never throws for a merely awkward image: anything it cannot improve comes
 * back as a pass-through master with no derivatives, because refusing an
 * upload is a far worse outcome than storing it uncompressed. HEIC decode
 * failure is the one exception and it propagates, since a stored HEIC is
 * unreadable by every browser we serve.
 *
 * @returns {Promise<{
 *   master: { buffer: Buffer, mime_type: string, filename: string,
 *             width: number|null, height: number|null, bytes: number },
 *   derivatives: Array<{ variant: string, format: string, buffer: Buffer,
 *                        bytes: number }>,
 *   profile: string, original_bytes: number, processed: boolean,
 *   converted: boolean
 * }>}
 */
async function processImage(file, { profile = DEFAULT_PROFILE } = {}) {
  const name = String(profile || DEFAULT_PROFILE).toLowerCase();
  const cfg = profileFor(name);
  const originalBytes = file && Buffer.isBuffer(file.buffer) ? file.buffer.length : 0;

  const passthrough = () => ({
    master: {
      buffer: file && file.buffer,
      mime_type: file && file.mimetype,
      filename: file && file.originalname,
      width: null,
      height: null,
      bytes: originalBytes,
    },
    derivatives: [],
    profile: name,
    original_bytes: originalBytes,
    processed: false,
    converted: false,
  });

  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    return passthrough();
  }

  // HEIC first: browsers cannot render it, so it is decoded to JPEG before any
  // decision about whether to process. A failure here throws by design.
  const heic = isHeic(file.mimetype, file.originalname, file.buffer);
  const normalised = heic ? await normalizeImageInput(file) : file;

  if (!isProcessable(normalised.mimetype)) {
    // SVG, GIF, PDF, anything else: store exactly what arrived. A HEIC that
    // decoded to JPEG is processable, so this only catches genuine opt-outs.
    return heic
      ? {
          ...passthrough(),
          master: {
            buffer: normalised.buffer,
            mime_type: normalised.mimetype,
            filename: normalised.originalname,
            width: null,
            height: null,
            bytes: normalised.buffer.length,
          },
          converted: true,
        }
      : passthrough();
  }

  const source = normalised.buffer;
  const masterMime = String(normalised.mimetype).toLowerCase();

  try {
    const meta = await sharp(source, { failOn: "none" }).metadata();

    const master = await encodeVariant(source, {
      edge: cfg.maxEdge,
      format: masterMime === "image/png" ? "png" : masterMime === "image/webp" ? "webp" : "jpeg",
      quality: cfg.quality,
      enhance: cfg.enhance,
      square: cfg.square,
    });

    // Never hand back a master bigger than what arrived — except for a decoded
    // HEIC, where the source is unusable regardless of size.
    const keepMaster = heic || master.length < source.length;
    const masterBuffer = keepMaster ? master : source;

    const derivatives = [];
    for (const variant of cfg.variants) {
      const edge = Math.min(SIZES[variant], cfg.maxEdge);
      // A variant at or above the master's own size is a duplicate; skip it.
      const longest = Math.max(meta.width || 0, meta.height || 0);
      if (!cfg.square && longest && edge >= longest && variant !== "thumb") continue;

      for (const format of ["avif", "webp"]) {
        try {
          const buffer = await encodeVariant(masterBuffer, {
            edge,
            format,
            quality: cfg.quality,
            enhance: false, // already baked into the master
            square: cfg.square && variant !== "full",
          });
          derivatives.push({ variant, format, buffer, bytes: buffer.length });
        } catch (err) {
          // One missing derivative is a slower page, not a failed upload. AVIF
          // encode in particular can OOM on very large images under memory
          // pressure; the WebP beside it still serves.
          logger.warn({ err, variant, format }, "derivative encode skipped");
        }
      }
    }

    return {
      master: {
        buffer: masterBuffer,
        mime_type: masterMime,
        // Only a HEIC conversion changes the extension; every other path keeps
        // the source format, so the uploader's own filename survives intact.
        filename: heic
          ? filenameFor(normalised.originalname, masterMime)
          : file.originalname,
        width: meta.width || null,
        height: meta.height || null,
        bytes: masterBuffer.length,
      },
      derivatives,
      profile: name,
      original_bytes: originalBytes,
      processed: keepMaster,
      converted: Boolean(heic),
    };
  } catch (err) {
    logger.warn({ err }, "image pipeline skipped; storing original");
    if (heic) {
      return {
        ...passthrough(),
        master: {
          buffer: normalised.buffer,
          mime_type: "image/jpeg",
          filename: filenameFor(normalised.originalname, "image/jpeg"),
          width: null,
          height: null,
          bytes: normalised.buffer.length,
        },
        converted: true,
      };
    }
    return passthrough();
  }
}

/**
 * Parse a derivative key back into its master key, variant and format.
 *
 * Returns null unless BOTH the variant and the format are ones we actually
 * produce. That allow-list is a security control, not tidiness: the /media
 * route generates a missing derivative on demand, so a parser that accepted
 * `doc_9f2c.99999.avif` would let an anonymous caller pick arbitrary encode
 * dimensions and turn a public image URL into a CPU exhaustion primitive.
 */
function parseDerivativeKey(key) {
  const m = /^(.*)\.([a-z]+)\.(avif|webp)$/.exec(String(key || ""));
  if (!m) return null;
  const [, stem, variant, format] = m;
  if (!Object.prototype.hasOwnProperty.call(SIZES, variant)) return null;
  if (!stem) return null;
  return { stem, variant, format };
}

/**
 * Find the master behind a derivative key. The master's extension is not
 * recoverable from the derivative key (`doc_9f.thumb.avif` could belong to a
 * `.jpg` or a `.png`), so this probes the raster extensions in turn.
 *
 * @returns {Promise<{key: string, buffer: Buffer}|null>}
 */
async function loadMasterFor(stem) {
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const key = `${stem}.${ext}`;
    try {
      const buffer = await storage.get(key);
      if (buffer && buffer.length) return { key, buffer };
    } catch {
      /* @silent:storage — a miss is the normal case for three of these four
         probes; only an all-miss is interesting, and the caller 404s on it. */
    }
  }
  return null;
}

/**
 * Produce and persist one derivative on demand, for a key whose master exists
 * but whose derivative does not.
 *
 * WHY ON DEMAND AT ALL, when uploads generate these eagerly. Two reasons, and
 * the second is the one that shaped the design:
 *
 *  1. Every image already in storage predates this engine. Without this path
 *     they would each need a backfill before a single <picture> could point at
 *     them, and a backfill that must skip signature-referenced documents is not
 *     something to put on the critical path of shipping the feature.
 *  2. <picture> does not fall back. If a <source srcset> 404s, the browser
 *     renders a broken image rather than dropping to the <img> — so a frontend
 *     may only reference a derivative it is CERTAIN exists. Generating on
 *     demand makes that certainty unconditional, which is what lets the
 *     delivery component stay dumb.
 *
 * Returns null when the master is missing or unprocessable, and the caller
 * 404s exactly as it would have anyway.
 */
async function ensureDerivative(key, { profile = DEFAULT_PROFILE } = {}) {
  const parsed = parseDerivativeKey(key);
  if (!parsed) return null;

  const master = await loadMasterFor(parsed.stem);
  if (!master) return null;

  const cfg = profileFor(profile);
  try {
    const buffer = await encodeVariant(master.buffer, {
      edge: Math.min(SIZES[parsed.variant], cfg.maxEdge),
      format: parsed.format,
      quality: cfg.quality,
      // The master was already enhanced at upload time if its profile called
      // for it. Re-running the chain here would double-sharpen and re-stretch
      // a histogram that is already stretched.
      enhance: false,
      square: false,
    });
    await storage.put(buffer, {
      key,
      contentType: `image/${parsed.format}`,
    });
    return { buffer, contentType: `image/${parsed.format}` };
  } catch (err) {
    logger.warn({ err, key }, "on-demand derivative failed");
    return null;
  }
}

/**
 * Persist a processed image's derivatives beside its master.
 *
 * Best-effort by design: a derivative that fails to store is regenerated on
 * demand by the /media route the first time it is requested, so failing an
 * upload over one would trade a recoverable slow path for a lost document.
 *
 * Separate from storeImage because callers that mint their own key and run
 * their own validation — the vault upload does both — still want the
 * derivatives written for them.
 */
async function putDerivatives(key, derivatives) {
  const stored = [];
  for (const d of derivatives || []) {
    const dKey = derivativeKey(key, d.variant, d.format);
    try {
      await storage.put(d.buffer, { key: dKey, contentType: `image/${d.format}` });
      stored.push({ ...d, key: dKey });
    } catch (err) {
      logger.warn({ err, key: dKey }, "derivative store skipped (regenerable)");
    }
  }
  return stored;
}

/**
 * Run an upload through the pipeline and persist every output.
 *
 * The ONE call for an upload site: hands back the master's storage key and the
 * hash of the bytes actually stored, which is what callers must record (see
 * the hashing note at the top of this file).
 *
 * Derivative writes are best-effort. A derivative that fails to store is
 * regenerated on demand by the /media route the first time it is requested, so
 * failing the whole upload over one would trade a recoverable slow path for an
 * unrecoverable lost document.
 */
async function storeImage(file, { key, profile = DEFAULT_PROFILE } = {}) {
  const result = await processImage(file, { profile });

  const put = await storage.put(result.master.buffer, {
    key,
    contentType: result.master.mime_type,
  });

  const stored = await putDerivatives(key, result.derivatives);

  return {
    key,
    // Mirrors storage.put's own return shape, so this is a drop-in replacement
    // at call sites that only ever wanted the URL back.
    public_url: put && put.public_url,
    size: result.master.bytes,
    content_type: result.master.mime_type,
    master: result.master,
    content_hash: crypto
      .createHash("sha256")
      .update(result.master.buffer)
      .digest("hex"),
    derivatives: stored,
    profile: result.profile,
    original_bytes: result.original_bytes,
    stored_bytes: result.master.bytes,
    processed: result.processed,
    converted: result.converted,
  };
}

module.exports = {
  processImage,
  storeImage,
  putDerivatives,
  ensureDerivative,
  parseDerivativeKey,
  derivativeKey,
  profileForKey,
  isProcessable,
  profileFor,
  filenameFor,
  PROFILES,
  SIZES,
  DEFAULT_PROFILE,
};
