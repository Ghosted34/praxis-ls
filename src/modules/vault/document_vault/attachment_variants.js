/**
 * The site-media derivative ladder — one leaf module, two readers.
 *
 * `site_settings.media.js` writes the derivatives; the attachment outbox
 * sweeps them. Both must derive the SAME key from the same master key, or the
 * sweep deletes a key the writer never wrote and leaves the real one behind —
 * which is an orphan with extra steps.
 *
 * This file is therefore a LEAF: no requires, no side effects, imported by
 * both. site_settings.media re-exports it so its public API (and the tests
 * that pin it) keep working.
 */
"use strict";

/** Three widths and two formats per width. A width is only written when the
 *  original is at least that wide — see media.js writeVariants. */
const VARIANT_WIDTHS = Object.freeze([480, 960, 1600]);
const VARIANT_FORMATS = Object.freeze(["avif", "webp"]);

/** The storage key of one derivative, derived from the original's.
 *
 *  THE ONE FUNCTION THAT KNOWS HOW A VARIANT IS NAMED. Both the writer and
 *  the sweeper call it, so a variant cannot be written under a name the
 *  other cannot rebuild. No part of a request ever reaches it: callers pass
 *  a recorded storage path and constants from this file. */
function variantKey(storagePath, width, format) {
  const base = String(storagePath).replace(/\.[a-z0-9]+$/i, "");
  return `${base}@${width}.${format}`;
}

module.exports = { VARIANT_WIDTHS, VARIANT_FORMATS, variantKey };
