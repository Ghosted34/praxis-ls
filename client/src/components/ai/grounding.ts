/**
 * Turning an answer into things the user can CLICK.
 *
 * An assistant that says "three invoices are overdue" and leaves you to go and
 * find them has moved the work, not done it. Everything here exists to close
 * that gap: pull the records an answer refers to out of its prose and offer
 * them as source chips, lift a result table out of the markdown and into a real
 * one, and notice when an answer is long enough that it belongs on a canvas
 * rather than in a chat bubble.
 *
 * WHY DERIVE RATHER THAN WAIT FOR THE BACKEND. `/ai/ask` returns prose plus
 * proposed actions and nothing else today (`lib/ai-api.ts`), so a grounding
 * footer that renders only from a `sources[]` field would be a footer that never
 * renders. The model already writes internal links — `[INV-2026-0031](/finance/
 * invoices/8f2c)` — because the screen registry it is grounded on is a map of
 * routes. So the links ARE the citations; they just were not being treated as
 * such. When the backend does start sending structured sources, `mergeSources`
 * folds them in and the derived ones stay as the floor.
 *
 * Everything here is pure and string-in/data-out, so it is testable without a
 * render and cheap enough to run inside a `useMemo` on every turn.
 */

export type AiSourceKind = "record" | "external" | "report";

export type AiSource = {
  /** What the chip reads — the record's own identifier, ideally. */
  label: string;
  /** In-app route, or an absolute URL for an external reference. */
  href: string;
  kind: AiSourceKind;
};

export type AiTable = {
  header: string[];
  rows: string[][];
};

/** Markdown inline link: `[label](target)`. Targets never contain whitespace. */
const LINK = /\[([^\]\n]+)\]\((\S+?)\)/g;

/**
 * The records, documents and reports an answer refers to.
 *
 * Deduplicated on `href`, because a model that mentions the same invoice three
 * times in one paragraph should produce one chip, not three. First label wins —
 * the first mention is normally the fully qualified one ("INV-2026-0031"),
 * later ones the shorthand ("it", "that invoice").
 *
 * Order is preserved rather than sorted: the answer's own order of mention is
 * already a relevance ranking, and a better one than anything derivable here.
 */
export function extractSources(text: string): AiSource[] {
  const out: AiSource[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(LINK)) {
    const label = m[1].trim();
    const href = m[2].trim();
    if (!label || !href || seen.has(href)) continue;
    // Anchors and mailto: are navigation inside a message, not citations.
    if (href.startsWith("#") || href.startsWith("mailto:")) continue;
    seen.add(href);
    out.push({
      label,
      href,
      kind: href.startsWith("/")
        ? // A report route is still a record read, but it is a DIFFERENT kind of
          // provenance — "I ran the ageing report" rather than "I read invoice
          // 31" — and the footer draws them differently.
          /\/(reports?|statements|ageing|analytics)\b/.test(href)
          ? "report"
          : "record"
        : "external",
    });
  }
  return out;
}

/**
 * Classify a reference from its target, for a source that arrived without a kind.
 *
 * Same rule `extractSources` applies to the links it finds, factored out so a
 * backend-supplied source and a derived one are never drawn differently for no
 * reason other than which path they came in on.
 */
export function kindOf(href: string): AiSourceKind {
  if (!href.startsWith("/")) return "external";
  return /\/(reports?|statements|ageing|analytics)\b/.test(href) ? "report" : "record";
}

/**
 * Fold backend-supplied sources over the derived ones.
 *
 * The backend's are authoritative — they carry the permission the read was made
 * under — so they win on href collisions. The derived ones remain because an
 * answer can legitimately cite something the retrieval layer did not log as a
 * source (a route the model knew from the screen registry).
 *
 * `kind` is OPTIONAL on the wire (`AiSourceLike`) and required here, because a
 * chip has to be drawn somehow: a backend that sends one is believed, and one
 * that does not gets the same classification the derived sources get.
 */
export function mergeSources(
  derived: AiSource[],
  supplied?: { label: string; href: string; kind?: AiSourceKind }[],
): AiSource[] {
  if (!supplied?.length) return derived;
  const byHref = new Map(derived.map((s) => [s.href, s]));
  for (const s of supplied) byHref.set(s.href, { ...s, kind: s.kind ?? kindOf(s.href) });
  return [...byHref.values()];
}

/** One row of a pipe table, without the outer pipes, cells trimmed. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

const DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/**
 * The first markdown table in an answer, as data.
 *
 * `components/markdown.tsx` already renders these inline and renders them well,
 * so this is not a second renderer — it is the lift that lets the same rows open
 * in the right pane as a real `<Table>`, with the sorting and export a person
 * looking at twenty rows of receivables actually wants. Inline stays; the canvas
 * is the escalation.
 *
 * Only the FIRST table: an answer with two tables is an answer that should have
 * been two answers, and picking one to promote is better than a pane with a
 * silent second tab in it.
 */
export function extractTable(text: string): AiTable | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes("|") || !DIVIDER.test(lines[i + 1])) continue;
    const header = cells(lines[i]);
    if (header.length < 2) continue;
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length; j++) {
      if (!lines[j].includes("|") || !lines[j].trim()) break;
      const row = cells(lines[j]);
      // Ragged rows are padded rather than dropped — losing a row of financial
      // data because the model missed a pipe is the worse of the two failures.
      while (row.length < header.length) row.push("");
      rows.push(row.slice(0, header.length));
    }
    if (rows.length) return { header, rows };
  }
  return null;
}

/**
 * Is this answer long-form — a drafted document rather than a reply?
 *
 * The threshold is deliberately generous. Lifting a four-sentence answer onto a
 * canvas is a worse experience than leaving a slightly long one in the thread:
 * the canvas costs a pane and a mode switch, so it has to be earning them. What
 * earns them is a drafted artefact — a proforma, a memo, a reconciliation —
 * which in practice means either real length or a heading, because a model
 * writing a document gives it sections.
 */
export function isLongForm(text: string): boolean {
  if (/^#{1,3}\s/m.test(text) && text.length > 400) return true;
  return text.length > 900;
}

/** A short, human title for a lifted artefact: its first heading, or its first line. */
export function artifactTitle(text: string): string {
  const heading = text.match(/^#{1,3}\s+(.+)$/m);
  const raw = (heading?.[1] ?? text.split("\n").find((l) => l.trim()) ?? "Draft").trim();
  const clean = raw.replace(LINK, "$1").replace(/[*_`#]/g, "").trim();
  return clean.length > 60 ? clean.slice(0, 57).trimEnd() + "…" : clean || "Draft";
}
