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
 * WHERE THE CITATIONS COME FROM, AND WHY THERE ARE TWO SOURCES OF THEM.
 *
 * `/ai/ask` now returns structured `sources[]`, built server-side from the rows
 * the orchestrator's read actions actually returned
 * (`src/services/ai/answer-sources.js`). Those are the real citations: they say
 * what was READ, under a known permission, which no amount of reading the prose
 * can establish.
 *
 * `extractSources` remains, and remains the FLOOR rather than the mechanism. It
 * was written on the assumption that the model writes internal links —
 * `[INV-2026-0031](/finance/invoices/8f2c)` — because the screen registry it is
 * grounded on is a map of routes. It does not, and the system prompt tells it
 * not to ("NEVER show the user raw database identifiers"), which is why the
 * footer had never rendered. What it still catches is the case the backend
 * cannot: a route the model knew from the registry and linked deliberately, in
 * an answer that read nothing. `mergeSources` folds the two together with the
 * backend's winning on collision.
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
  /**
   * The heading the table sits under, or a positional fallback.
   *
   * This is what makes several tables in one answer usable rather than a wall.
   * A financial model comes back as "Revenue (from trial balance)",
   * "Receivables (from ageing)", "Scenario A — Conservative", "Scenario B —
   * Realistic" — and stripped of those labels they are seven indistinguishable
   * grids of numbers. The label is already in the prose directly above each one;
   * it just has to be carried across.
   */
  title: string;
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
  return /\/(reports?|statements|ageing|analytics)\b/.test(href)
    ? "report"
    : "record";
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
  for (const s of supplied)
    byHref.set(s.href, { ...s, kind: s.kind ?? kindOf(s.href) });
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

/** Strip markdown decoration from a heading so it can be a label or a sheet name. */
function plain(s: string): string {
  return s
    .replace(LINK, "$1")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * EVERY markdown table in an answer, each labelled with the heading above it.
 *
 * This used to return only the first one, on the reasoning that "an answer with
 * two tables is an answer that should have been two answers". That was wrong,
 * and a real financial model is what proved it: actuals, receivables ageing, tax
 * position, model inputs, then three scenarios — seven tables, one coherent
 * answer, and no way to split it that would not be worse. The pane showed the
 * first two rows of the first one and silently dropped the rest, which on an
 * accounting product is not a missing feature, it is a wrong answer.
 *
 * Scenarios A, B and C only mean anything COMPARED, which is also why the pane
 * stacks them rather than putting them behind a selector.
 *
 * `components/markdown.tsx` still renders these inline and renders them well —
 * this is not a second renderer. It is the lift that lets the same rows open in
 * the right pane as real `<Table>`s, with the sorting and export a person
 * looking at a five-month projection actually wants.
 */
export function extractTables(text: string): AiTable[] {
  const lines = text.split("\n");
  const out: AiTable[] = [];
  // The most recent heading seen while scanning down — the label for whatever
  // table comes next. Cleared as it is consumed so two tables under one heading
  // do not both claim it verbatim.
  let heading = "";

  for (let i = 0; i < lines.length - 1; i++) {
    const h = lines[i].match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (h) {
      heading = plain(h[1]);
      continue;
    }
    // A bold line on its own is how models label a table when they have already
    // spent their heading levels — "**Scenario A — Conservative**".
    const b = lines[i].match(/^\s*\*\*(.+?)\*\*\s*$/);
    if (b) {
      heading = plain(b[1]);
      continue;
    }
    if (!lines[i].includes("|") || !DIVIDER.test(lines[i + 1])) continue;

    const header = cells(lines[i]);
    if (header.length < 2) continue;
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      if (!lines[j].includes("|") || !lines[j].trim()) break;
      const row = cells(lines[j]);
      // Ragged rows are padded rather than dropped — losing a row of financial
      // data because the model missed a pipe is the worse of the two failures.
      while (row.length < header.length) row.push("");
      rows.push(row.slice(0, header.length));
    }
    if (rows.length) {
      out.push({ title: heading || `Table ${out.length + 1}`, header, rows });
      heading = "";
    }
    i = j - 1; // resume after this table rather than rescanning its rows
  }
  return out;
}

/** The first table, for callers that only need to know whether there is one. */
export function extractTable(text: string): AiTable | null {
  return extractTables(text)[0] ?? null;
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
  const raw = (
    heading?.[1] ??
    text.split("\n").find((l) => l.trim()) ??
    "Draft"
  ).trim();
  const clean = raw
    .replace(LINK, "$1")
    .replace(/[*_`#]/g, "")
    .trim();
  return clean.length > 60
    ? clean.slice(0, 57).trimEnd() + "…"
    : clean || "Draft";
}

/**
 * The DOCUMENT inside an answer, with the conversation around it removed.
 *
 * THE PROBLEM. An answer that drafts something arrives wrapped in chat:
 *
 *     Here's a draft memo for the finance department based on the financial model.
 *     ---
 *     INTERNAL MEMORANDUM
 *     …the actual memo…
 *     Prepared by: Tom Blake
 *     ---
 *     Would you like me to:
 *     1. Add a section on operating expenses…
 *     Just let me know.
 *
 * In the THREAD all of that is correct — it is a conversation, and the offer at
 * the end is the assistant doing its job. On the CANVAS it is noise: the canvas
 * holds the document you are going to send to the finance department, and
 * "Here's a draft memo" is not part of it.
 *
 * NON-LOSSY BY CONSTRUCTION, and that is the whole design. Each end is trimmed
 * only when it is confidently recognised; anything unrecognised is left exactly
 * as it was. The worst case is the behaviour we already had — the full text —
 * and the failure mode of a heuristic that guesses wrong is a slightly untidy
 * canvas, never a truncated document. The full answer also remains in the
 * thread regardless, so nothing is ever only-here.
 *
 * WHY A HEURISTIC AT ALL, given that guessing at model output is what left the
 * sources footer dead for weeks. Because the alternative — asking the model to
 * fence its documents — has to be paid for on four surfaces: the marker has to
 * be stripped from the thread, the copy button, the download and the read-aloud,
 * or it leaks as literal text. And it would STILL need this function as the
 * fallback for the turns where the model does not comply. Given that, the fence
 * buys precision on top of a trim that has to exist anyway; it is worth adding
 * when this proves unreliable in practice, not before.
 */

/** Openers a model uses to hand over a draft, before the draft starts. */
const LEAD_IN =
  /^\s*(here('?s| is)|i'?ve (drafted|prepared|written)|below is|this is)\b/i;

/**
 * The wrap-up offer. Anchored to a line START and to phrasings that are
 * unambiguously a question back to the user, so a document that happens to
 * contain the word "would" mid-sentence is untouched.
 */
const OFFER =
  /^\s{0,3}(#{1,6}\s*)?(\*\*)?(would you like me to|want me to|shall i|do you want me to|let me know if|just let me know|would you like)\b/i;

export function documentBody(text: string): string {
  const lines = text.split("\n");
  let start = 0;
  let end = lines.length;

  // ── tail: from the offer to the end ──────────────────────────────────────
  //
  // Scanned DOWNWARD from the start of the final third, taking the FIRST match.
  // Scanning up from the bottom looks equivalent and is not: a wrap-up is
  // usually several lines — "Would you like me to:", a numbered list, then
  // "Just let me know." — and the bottom-up scan stops at the LAST of those,
  // trimming one line and leaving the block. The cut belongs at the first line
  // of the offer, not its last.
  //
  // Restricting to the final third is what stops a document that opens with
  // "Would you like to know the position?" losing its own body.
  for (let i = Math.floor(lines.length * 0.66); i < lines.length; i++) {
    if (!OFFER.test(lines[i])) continue;
    end = i;
    // Take the `---` immediately above it too; it was that block's separator.
    while (end > 0 && !lines[end - 1].trim()) end -= 1;
    if (end > 0 && /^\s*-{3,}\s*$/.test(lines[end - 1])) end -= 1;
    break;
  }

  // ── head: a short hand-over sentence before the document begins ──────────
  const firstText = lines.findIndex((l) => l.trim());
  if (firstText !== -1 && LEAD_IN.test(lines[firstText])) {
    // It has to be SHORT — one or two lines — or it is the answer, not a preamble.
    let i = firstText;
    while (i < end && lines[i].trim()) i += 1;
    if (i - firstText <= 2) {
      let j = i;
      while (j < end && !lines[j].trim()) j += 1;
      // And it has to be followed by a rule or a heading — the document starting.
      if (
        j < end &&
        (/^\s*-{3,}\s*$/.test(lines[j]) ||
          /^\s{0,3}#{1,6}\s/.test(lines[j]) ||
          /^\s*\*\*/.test(lines[j]))
      ) {
        start = /^\s*-{3,}\s*$/.test(lines[j]) ? j + 1 : j;
      }
    }
  }

  const body = lines.slice(start, end).join("\n").trim();
  // The safety net: never hand back something materially shorter than what a
  // document should be, and never hand back nothing.
  return body.length >= 120 ? body : text;
}
