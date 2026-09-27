/**
 * CLIENT HEADINGS — what a client document prints instead of the costing's detail.
 *
 * Tenant review "meeting 5" (21 Sep 2026, 01:28:21 → 01:35:46): operations cost
 * a file line by line (customs duties, the clearance fee, the officers'
 * transport to the customs office, a gate pass…) and the client reads one
 * line — "Customs Formalities 500 000". The owner's decisions (PR 2):
 *
 *   * The family comes from the dictionary line's default heading, which the
 *     pricer can override on any document — including a heading made up for
 *     that file (14130).
 *   * PRINT ONLY. The quotation and the invoice keep storing every detailed
 *     line — postings, margins, cash requests, reconciliation and the
 *     quotation → invoice price guard all work per line. Only the printed
 *     document is grouped, and it never carries the detail (no annex).
 *   * A family that mixes disbursements (no VAT, 4731) with our own fees (VAT,
 *     class 7) prints as TWO lines — "… — Disbursements" and "… — Service Fee"
 *     — because the two are taxed and posted differently and the client must
 *     be able to see which part was taxed. A family of one nature prints as
 *     one line with no suffix.
 *   * Small internal charges are simply inside their family's total.
 *
 * WHY HERE AND NOT IN THE DATA. `template.service.loadRecord`'s `data.lines`
 * is also the payload a signature hashes (services/signatures/canonical.js
 * `priceLines`). Grouping it there would change the hash of every document
 * already signed; grouping at render time changes only the paper. The signed
 * commitment stays the detailed lines, which is also the honest thing to sign.
 */
"use strict";

const OTHER = { key: "OTHER", fr: "Autres Frais", en: "Other Charges", sort: 1000 };
const SUFFIX = {
  disbursement: { fr: "Débours", en: "Disbursements" },
  service: { fr: "Honoraires", en: "Service Fee" },
};

const text = (v) => (v === null || v === undefined ? "" : String(v).trim());

/**
 * The family of one line: its own override, else its catalogue heading, else
 * "Other Charges".
 *
 * An override is stored as text. When that text is the name of a heading in
 * the registry (either language, case-insensitive) it IS that heading — the
 * pricer picked "Port & Terminal Charges" from the list, so it prints in the
 * document's language and in the registry's order. Any other text is a family
 * made up for this file ("DAP Douala–Bangui"), keyed by its text so every line
 * given it lands together.
 */
function resolveHeading(l = {}, registry = []) {
  const custom = text(l.client_heading);
  if (custom) {
    const lc = custom.toLowerCase();
    const hit = (registry || []).find(
      (r) => text(r.fr).toLowerCase() === lc || text(r.en).toLowerCase() === lc || text(r.code).toLowerCase() === lc,
    );
    if (hit) {
      return {
        key: text(hit.code) || `ref:${lc}`,
        fr: text(hit.fr) || text(hit.en),
        en: text(hit.en) || text(hit.fr),
        sort: Number.isFinite(Number(hit.sort)) && hit.sort !== null ? Number(hit.sort) : 900,
      };
    }
    return { key: `custom:${lc}`, fr: custom, en: custom, sort: 500 };
  }
  const fr = text(l.client_heading_fr);
  const en = text(l.client_heading_en);
  if (fr || en) {
    return {
      key: text(l.client_heading_code) || `ref:${(en || fr).toLowerCase()}`,
      fr: fr || en,
      en: en || fr,
      sort: Number.isFinite(Number(l.client_heading_sort)) && l.client_heading_sort !== null ? Number(l.client_heading_sort) : 900,
    };
  }
  return { ...OTHER };
}

/** A bilingual pair as the document's language prints it. */
function inLang(pair, lang) {
  if (lang === "fr") return pair.fr;
  if (lang === "en") return pair.en;
  return pair.fr === pair.en ? pair.fr : `${pair.fr} / ${pair.en}`;
}

const amountOf = (l) =>
  l.amount !== undefined && l.amount !== null ? Number(l.amount) : Number(l.qty || 1) * Number(l.unit || 0);

/**
 * Detailed lines → one printed line per heading × nature (× VAT rate, for the
 * rare family whose fees carry two rates). Input lines are `data.lines` as
 * `loadRecord` builds them, plus `is_disbursement` and the heading fields.
 * `registry` is the CLIENT_HEADING list (`{code, fr, en, sort}`), so an
 * override naming a registry heading prints as that heading.
 * Output is the same shape (`label`, `qty`, `unit`, `tax`, `amount`), so the
 * line table renders it unchanged. Ordered by the heading's registry order,
 * disbursements before fees within a family. Totals are untouched: the sum of
 * the groups IS the sum of the lines.
 */
function groupLines(lines = [], lang = "bilingual", registry = []) {
  const groups = new Map();
  const naturesByHeading = new Map();
  for (const l of Array.isArray(lines) ? lines : []) {
    const h = resolveHeading(l, registry);
    const nature = l.is_disbursement === true ? "disbursement" : "service";
    const tax = nature === "disbursement" ? null : (l.tax === null || l.tax === undefined ? null : Number(l.tax));
    const key = `${h.key}|${nature}|${tax === null ? "-" : tax}`;
    if (!groups.has(key)) groups.set(key, { heading: h, nature, tax, amount: 0 });
    groups.get(key).amount += amountOf(l);
    if (!naturesByHeading.has(h.key)) naturesByHeading.set(h.key, new Set());
    naturesByHeading.get(h.key).add(nature);
  }
  const round2 = (n) => Math.round(n * 100) / 100;
  return [...groups.values()]
    .sort((a, b) =>
      a.heading.sort - b.heading.sort
      || inLang(a.heading, lang).localeCompare(inLang(b.heading, lang))
      || (a.nature === b.nature ? 0 : a.nature === "disbursement" ? -1 : 1)
      || (a.tax ?? -1) - (b.tax ?? -1))
    .map((g) => {
      const mixed = naturesByHeading.get(g.heading.key).size > 1;
      const name = inLang(g.heading, lang);
      const label = mixed ? `${name} — ${inLang(SUFFIX[g.nature], lang)}` : name;
      const amount = round2(g.amount);
      return { label, qty: 1, unit: amount, tax: g.tax, amount, is_disbursement: g.nature === "disbursement" };
    });
}

module.exports = { groupLines, resolveHeading, OTHER };
