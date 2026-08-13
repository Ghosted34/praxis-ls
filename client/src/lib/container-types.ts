/**
 * Container types, read the same way everywhere.
 *
 * `dictionary_ref` kind CONTAINER_TYPE is now read by three screens — the
 * dossier's container editor, the expense-rate grid, and the finder's equipment
 * step — and each of them wants the same two things: the list grouped by
 * `extra.family` (twenty-two flat options is a list nobody reads to the bottom
 * of) and one label to show. Three copies of that is how two of them end up
 * grouping "OTHER" differently, so it lives here once.
 */
import type { DictRef } from "@/lib/masterdata-api";

/** Group by family, preserving the server's sort order within each group.
 *  A type with no `family` lands in OTHER rather than vanishing — a tenant
 *  row created before the field was captured is still pickable. */
export function groupTypes(types: DictRef[]): [string, DictRef[]][] {
  const out = new Map<string, DictRef[]>();
  for (const t of types) {
    const fam = t.extra?.family || "OTHER";
    if (!out.has(fam)) out.set(fam, []);
    out.get(fam)!.push(t);
  }
  return [...out.entries()];
}

/** The name to show. English, French, then the code — the code is never blank,
 *  so a row always renders as something a person can point at. */
export const typeLabel = (t: DictRef) => t.name_en || t.name_fr || t.code;

/** TEU for one type, 0 when the registry row never got one. Callers total on
 *  this, which is exactly why the API refuses to create a type without it. */
export const teuOf = (t?: DictRef | null) => Number(t?.extra?.teu) || 0;
