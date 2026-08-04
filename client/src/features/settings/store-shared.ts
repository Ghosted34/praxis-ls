/**
 * Settings key/value store — the row shape all four store-backed screens read.
 *
 * Split out of `features/settings/store-pages.tsx` in Phase 4 (audit F7).
 * Document templates, custom fields, email signatures and business policies are
 * all rows in ONE settings table, distinguished by key prefix, which is why they
 * share an `Entry` rather than each having a typed endpoint.
 */

import { type Row } from "@/lib/use-resource";

/** Key-safe slug for a user-entered name — the store's keys are the identity. */
export const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "").slice(0, 60);

export type Entry = { key: string; value: Row };

/** Read the object-value of a settings row, tolerant of shape. */
export function entryValue(r: Row): Row {
  const v = r.value;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
}

/* ═══════════════════════════════ Document templates ═══════════════════════════════ */
