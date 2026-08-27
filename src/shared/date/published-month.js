/**
 * Centralised "YYYY-MM" formatter for published_at columns on public
 * surfaces. Audit (comment 3 on PR #264) called out
 *   published_month: String(row.published_at).slice(0, 7)
 * in `portfolio_public.service.js:50` and the inlined version in the
 * new `service_type_web_public.routes.js`. Both would happily emit
 * "Wed Aug" if `published_at` came back as a JS Date from pg and
 * someone reached for the raw String() of it; a JS Date's toString()
 * starts "Wed Aug 27 2026 12:34:56 …", not "2026-08-…", so the first
 * seven characters are "Wed Aug ", not "2026-08".
 *
 * Both surfaces (and any future one) go through this helper:
 *   - pg returns timestamptz as a JS Date. `toISOString()` is the
 *     canonical wire form, and slicing [0, 7) gives "YYYY-MM".
 *   - if pg (or a test, or a JSON round-trip) gives a string, the
 *     leading seven characters of an ISO-8601 timestamp are also
 *     "YYYY-MM". Anything else (a free-form string, a Date's toString)
 *     returns null rather than emitting garbage.
 *   - the input is checked before the Date path, so an undefined
 *     column does not throw.
 */
"use strict";

function publishedMonth(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 7);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7);
  return null;
}

module.exports = { publishedMonth };
