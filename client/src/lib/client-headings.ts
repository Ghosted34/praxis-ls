/**
 * CLIENT HEADINGS on screen — the twin of
 * src/services/documents/templates/client-headings.js, which prints them.
 *
 * A quotation and an invoice print one line per family ("Customs
 * Formalities"), split by nature — disbursements and our own fees never share
 * a line (VAT and OHADA posting differ). The costing keeps every detailed line;
 * its "By family" view shows the pricer exactly what the client will read.
 * Change the rule here and in the template together.
 */
import { dictLabel } from "@/lib/dict-label";

export type HeadingRef = { code: string; name_fr?: string | null; name_en?: string | null; sort_order?: number | null };

/** What a line needs to be placed in a family. */
export type HeadedLine = {
  client_heading?: string | null;
  client_heading_code?: string | null;
  client_heading_fr?: string | null;
  client_heading_en?: string | null;
  is_disbursement?: boolean;
};

export type Heading = { key: string; fr: string; en: string; sort: number; custom: boolean };

export const OTHER_HEADING: Heading = { key: "OTHER", fr: "Autres Frais", en: "Other Charges", sort: 1000, custom: false };

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** Override → registry match → custom; else the catalogue's heading; else Other. */
export function resolveHeading(l: HeadedLine, registry: HeadingRef[] = []): Heading {
  const custom = text(l.client_heading);
  if (custom) {
    const lc = custom.toLowerCase();
    const hit = registry.find(
      (r) => text(r.name_fr).toLowerCase() === lc || text(r.name_en).toLowerCase() === lc || text(r.code).toLowerCase() === lc,
    );
    if (hit)
      return {
        key: hit.code,
        fr: text(hit.name_fr) || text(hit.name_en),
        en: text(hit.name_en) || text(hit.name_fr),
        sort: Number.isFinite(Number(hit.sort_order)) && hit.sort_order != null ? Number(hit.sort_order) : 900,
        custom: false,
      };
    return { key: `custom:${lc}`, fr: custom, en: custom, sort: 500, custom: true };
  }
  const fr = text(l.client_heading_fr);
  const en = text(l.client_heading_en);
  if (fr || en)
    return { key: text(l.client_heading_code) || `ref:${(en || fr).toLowerCase()}`, fr: fr || en, en: en || fr, sort: 900, custom: false };
  return OTHER_HEADING;
}

/** A heading in the reader's language. */
export const headingLabel = (h: Heading) => dictLabel({ label_fr: h.fr, label_en: h.en }) || h.en;

export type Family<T> = {
  heading: Heading;
  /** Disbursements and our fees are separate lines on the client document. */
  nature: "disbursement" | "service";
  /** True when the same family also has lines of the other nature. */
  mixed: boolean;
  lines: { line: T; index: number }[];
};

/** Group lines as the client document will print them, keeping each line's
 *  index so the view can edit the line in place. */
export function groupByFamily<T extends HeadedLine>(lines: T[], registry: HeadingRef[] = []): Family<T>[] {
  const out = new Map<string, Family<T>>();
  const natures = new Map<string, Set<string>>();
  lines.forEach((line, index) => {
    const heading = resolveHeading(line, registry);
    const nature = line.is_disbursement ? "disbursement" : "service";
    const key = `${heading.key}|${nature}`;
    if (!out.has(key)) out.set(key, { heading, nature, mixed: false, lines: [] });
    out.get(key)!.lines.push({ line, index });
    if (!natures.has(heading.key)) natures.set(heading.key, new Set());
    natures.get(heading.key)!.add(nature);
  });
  const sortOf = (h: Heading) => {
    const r = registry.find((x) => x.code === h.key);
    return r && r.sort_order != null ? Number(r.sort_order) : h.sort;
  };
  return [...out.values()]
    .map((f) => ({ ...f, mixed: (natures.get(f.heading.key)?.size ?? 0) > 1 }))
    .sort(
      (a, b) =>
        sortOf(a.heading) - sortOf(b.heading) ||
        headingLabel(a.heading).localeCompare(headingLabel(b.heading)) ||
        (a.nature === b.nature ? 0 : a.nature === "disbursement" ? -1 : 1),
    );
}
