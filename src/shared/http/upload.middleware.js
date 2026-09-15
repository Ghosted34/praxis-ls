/**
 * Multipart upload middleware.
 *
 * WHY MULTIPART, when every upload path here already accepts a base64 data URL
 * and works. Because base64 is a 4-bytes-per-3 encoding: a 5 MB scan becomes a
 * 6.7 MB request body, and that whole body is a JSON string the API has to hold
 * in memory, parse, and slice before a single byte reaches storage. The bytes
 * are the upload wait the user watches on the progress bar, and the memory is
 * a per-request spike that scales with concurrency.
 *
 * BOTH TRANSPORTS STAY. The base64 routes are not deprecated by this file and
 * are not being switched off underneath anyone: the ~30 frontend upload sites
 * migrate a few at a time, and a route that accepts either transport is what
 * makes that migration safe to do incrementally rather than as one landing.
 * `readUpload()` below is the seam — a handler calls it and stops caring which
 * transport delivered the file.
 *
 * MEMORY STORAGE, deliberately. Files go to a Buffer, never to a temp file on
 * disk. Every consumer here (the image pipeline, the hash, storage.put) wants
 * bytes in memory anyway, and a disk-backed upload adds a file that has to be
 * cleaned up on every error path — including the ones nobody remembers to
 * write. The size limit below is what makes holding it in memory safe.
 */

"use strict";

const multer = require("multer");
const { AppError } = require("../../utils/errors");
const { parseDataUrl } = require("../../utils/data-url");

/** Ceiling for any single multipart upload. Matches storage.service's own
 *  MAX_BYTES floor; individual routes apply their own tighter limits after
 *  this, where they always did. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const memory = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    // One file per request, and a small field budget. Both are DoS bounds, not
    // ergonomics: multer will otherwise happily accept an unbounded number of
    // parts and hold every one of them in memory at once.
    files: 1,
    fields: 24,
    parts: 32,
  },
});

/**
 * Accept one file under the given field name, translating multer's own errors
 * into the AppError shape the rest of the API speaks.
 *
 * Multer signals an oversized file with code LIMIT_FILE_SIZE on a plain Error,
 * which would otherwise surface as an unhandled 500 — the single most likely
 * thing a user hits here, since "my photo is too big" is exactly the case this
 * whole feature exists to address.
 */
function singleFile(field = "file") {
  const handler = memory.single(field);
  return (req, res, next) =>
    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(
          new AppError(
            "FILE_TOO_LARGE",
            `File exceeds ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`,
            413,
            {
              user_message: `That file is larger than ${Math.round(
                MAX_UPLOAD_BYTES / (1024 * 1024),
              )} MB. Try a smaller image, or export it at a lower resolution.`,
            },
          ),
        );
      }
      if (err.code === "LIMIT_UNEXPECTED_FILE" || err.code === "LIMIT_FILE_COUNT") {
        return next(
          new AppError("BAD_FILE", "Unexpected file in this upload", 400),
        );
      }
      return next(err);
    });
}

/**
 * Read the uploaded file out of a request, whichever transport carried it.
 *
 * This is the seam that lets a route accept multipart and base64 at the same
 * time, so the frontend can migrate one screen at a time. Returns a
 * multer-shaped file ({ buffer, mimetype, originalname }) — the shape the image
 * pipeline and media-compression already take — or null when the request
 * carries no file at all.
 *
 * @param {import("express").Request} req
 * @param {{ field?: string, dataUrlField?: string, nameField?: string }} opts
 */
function readUpload(req, opts = {}) {
  const {
    field = "file",
    dataUrlField = "data_url",
    nameField = "original_name",
  } = opts;

  // Multipart: multer has already parsed it onto req.file.
  if (req.file && Buffer.isBuffer(req.file.buffer)) {
    return {
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname || "upload",
    };
  }

  // Legacy base64 data URL in a JSON body. `parseDataUrl` is used rather than a
  // regex here because media-type PARAMETERS are legal in a data URL
  // (`;charset=`, `;codecs=`) and the hand-rolled patterns this replaced could
  // not cross them — see utils/data-url.
  const body = req.body || {};
  const raw = body[dataUrlField] ?? body[field] ?? null;
  if (typeof raw === "string" && raw.startsWith("data:")) {
    const parsed = parseDataUrl(raw);
    if (!parsed) {
      throw new AppError("BAD_FILE", "Expected a base64 data URL", 400);
    }
    return {
      buffer: parsed.buffer,
      mimetype: parsed.mimeType,
      originalname: body[nameField] || "upload",
    };
  }

  return null;
}

module.exports = { singleFile, readUpload, MAX_UPLOAD_BYTES };
