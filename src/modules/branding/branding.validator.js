/**
 * API F-15. Four branding write routes read `req.body` with nothing checking
 * it: the whole appearance object, the whole login-screen object, and two
 * data-URL image uploads.
 *
 * The two uploads are the ones that matter. `dataUrl` went straight to
 * `service.uploadLogo` / `uploadLoginBackground`, which decode it and write a
 * file. An unbounded string on an authenticated-but-not-privileged-enough path
 * is a memory and disk problem before it is anything else, and a `dataUrl` that
 * is not actually a data URL produces a decode error rather than a 422.
 *
 * The size cap is on the ENCODED string. base64 inflates by about 4/3, so 8 MB
 * of characters is roughly a 6 MB image — generous for a logo, and bounded.
 */
"use strict";

const { z } = require("zod");
const { body } = require("../../shared/http/validate");

const MAX_DATA_URL = 8 * 1024 * 1024;

const dataUrl = z
  .string()
  .max(MAX_DATA_URL, "image is too large (8 MB of encoded data)")
  .regex(/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i, "expected a base64 image data URL");

const upload = z.object({ dataUrl }).strict();

/**
 * Appearance and login-screen payloads are open-ended by design — the service
 * picks the keys it knows and the shape grows with the product — so these are
 * bounded rather than enumerated: every value must be a short scalar. That
 * stops the unbounded-blob case without freezing the schema every time a colour
 * is added.
 *
 * Not `.strict()`, deliberately. Enumerating the appearance keys here and in
 * the service is two lists to keep in step, and the one that drifts is the one
 * that rejects a legitimate field.
 */
const scalar = z.union([z.string().max(2048), z.number(), z.boolean(), z.null()]);
const appearance = z.record(z.string().max(64), scalar);

module.exports = {
  put: body(appearance),
  putLogin: body(appearance),
  upload: body(upload),
  schemas: { appearance, upload },
};
