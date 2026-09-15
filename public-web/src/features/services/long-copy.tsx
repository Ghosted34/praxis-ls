import * as React from "react";
import { Markdown } from "@/components/ui/markdown";
import { ChevronDownIcon } from "@/components/ui/icons";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

/**
 * A service page body, rendered so it can be read rather than merely published.
 *
 * WHY THIS EXISTS. A service page is the longest thing a tenant writes — the
 * case that prompted this is eleven thousand characters per language. Handed
 * straight to `<Markdown>` that is one undifferentiated column: around twenty
 * paragraphs, no headings, no anchors, nothing to tell a reader which part
 * answers their question. The copy was good and nobody was going to read it.
 *
 * WHAT IT DOES. Splits the body on its own `##` headings and gives the page a
 * shape: an opening that is always visible, a contents list to jump by, the
 * first section open, and the rest behind their own summaries. A reader
 * scanning for "what happens at destination" finds that heading instead of
 * paragraph fourteen.
 *
 * WHY `<details>` AND NOT CONDITIONAL RENDERING — this is the load-bearing
 * decision. Collapsed sections stay in the DOM; the browser hides them. React
 * that rendered only the open ones would strip the body out of the served HTML,
 * and the whole point of writing eleven thousand words is that a search engine
 * reads them. Progressive disclosure here is a display choice and nothing else:
 * view-source is identical whether a section is open or shut.
 *
 * WHAT IT DOES NOT DO. Copy with no `##` in it is not restructured into
 * headings this file invented — it renders as it always has, with a single
 * fold if it is long enough to need one. Every seeded page is in exactly that
 * state, and a heading a tenant did not write is a heading they cannot correct.
 */

/** Sections open on arrival. One: enough to show the page has a body. */
const OPEN_BY_DEFAULT = 1;
/** Below this a contents list is furniture, not navigation. */
const MIN_SECTIONS_FOR_NAV = 3;
/** Paragraphs shown before the fold when the copy carries no headings. */
const UNSTRUCTURED_LEAD = 3;

export type CopySection = { id: string; title: string; body: string };

/**
 * Anchor id for a heading. Deliberately derived from the heading TEXT rather
 * than its index: a shared link should survive the author inserting a section
 * above the one they linked to.
 */
export function headingId(text: string, index: number): string {
  const base = text
    .toLowerCase()
    .normalize("NFD")
    // Strip accents so `Opérations à destination` gives a clean ASCII anchor
    // rather than a percent-encoded one nobody can read in a shared link.
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base ? `s-${base}` : `s-${index + 1}`;
}

/**
 * Split a markdown body at its `##` headings.
 *
 * Only `##`. A `#` is the page title, which the hero already prints, and `###`
 * and below are structure WITHIN a section — folding those would bury a
 * sub-point inside a fold inside a fold.
 */
export function splitSections(src: string): {
  intro: string;
  sections: CopySection[];
} {
  const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
  const intro: string[] = [];
  const sections: CopySection[] = [];
  let current: { title: string; body: string[] } | null = null;
  let fenced = false;

  for (const line of lines) {
    // A `##` inside a fenced block is code, not a heading.
    if (/^\s*```/.test(line)) fenced = !fenced;
    const h = !fenced && /^##\s+(.+?)\s*$/.exec(line);
    if (h && !/^###/.test(line)) {
      if (current) sections.push(finish(current, sections.length));
      current = { title: h[1].trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
    else intro.push(line);
  }
  if (current) sections.push(finish(current, sections.length));

  return { intro: intro.join("\n").trim(), sections };

  function finish(s: { title: string; body: string[] }, i: number): CopySection {
    return { id: headingId(s.title, i), title: s.title, body: s.body.join("\n").trim() };
  }
}

/** Paragraph split for copy that carries no headings of its own. */
function splitParagraphs(src: string): string[] {
  return String(src || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function Disclosure({
  section,
  open,
  onToggle,
}: {
  section: CopySection;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  return (
    <details
      id={section.id}
      open={open}
      // React does not re-fire this when `open` is driven from state, so the
      // handler exists for the user's own click on the summary — the contents
      // list sets the state directly.
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
      className="scroll-mt-24 border-b border-border/60 last:border-b-0"
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-4 py-4",
          "text-left [&::-webkit-details-marker]:hidden",
          "hover:text-primary-ink focus-visible:outline-none focus-visible:ring-2",
          "focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2",
        )}
      >
        {/* h2 inside summary: the section headings are the page's real outline,
            and a screen reader's heading list is how a long page is skimmed
            without sight. The hero owns the only h1 (N10). */}
        <h2 className="text-title font-semibold">{section.title}</h2>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-5 shrink-0 text-muted-foreground transition-transform duration-200",
            "motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </summary>
      <div className="prose-site pb-6">
        <Markdown text={section.body} />
      </div>
    </details>
  );
}

export function LongCopy({ text }: { text: string }) {
  const { t } = useTranslation();
  const { intro, sections } = React.useMemo(() => splitSections(text), [text]);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  // Seeded from the section list rather than held per-render, so re-opening the
  // page does not fight the reader: what they opened stays open while they are
  // on it, and a language switch (new text, new ids) starts fresh.
  React.useEffect(() => {
    const next: Record<string, boolean> = {};
    sections.forEach((s, i) => { next[s.id] = i < OPEN_BY_DEFAULT; });
    setOpen(next);
  }, [sections]);

  const jump = React.useCallback((id: string) => {
    setOpen((o) => ({ ...o, [id]: true }));
    // After the open lands, so the browser scrolls to the expanded position
    // rather than to where the collapsed summary used to be.
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  }, []);

  // ── No headings: the copy has no outline to honour ───────────────────────
  if (sections.length === 0) {
    const paras = splitParagraphs(intro || text);
    if (paras.length <= UNSTRUCTURED_LEAD + 1) {
      return (
        <div className="prose-site">
          <Markdown text={intro || text} />
        </div>
      );
    }
    const lead = paras.slice(0, UNSTRUCTURED_LEAD).join("\n\n");
    const rest = paras.slice(UNSTRUCTURED_LEAD).join("\n\n");
    return (
      <div>
        <div className="prose-site">
          <Markdown text={lead} />
        </div>
        <details className="group mt-2">
          <summary
            className={cn(
              "inline-flex cursor-pointer list-none items-center gap-2 py-2",
              "text-sm font-medium text-primary-ink [&::-webkit-details-marker]:hidden",
              "focus-visible:outline-none focus-visible:ring-2",
              "focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2",
            )}
          >
            <span className="group-open:hidden">{t("site.servicesPage.readMore")}</span>
            <span className="hidden group-open:inline">{t("site.servicesPage.readLess")}</span>
            <ChevronDownIcon
              aria-hidden
              className="size-4 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="prose-site pt-2">
            <Markdown text={rest} />
          </div>
        </details>
      </div>
    );
  }

  return (
    <div>
      {intro && (
        <div className="prose-site mb-6">
          <Markdown text={intro} />
        </div>
      )}

      {sections.length >= MIN_SECTIONS_FOR_NAV && (
        <nav
          aria-label={t("site.servicesPage.onThisPage")}
          className="mb-8 rounded-[var(--radius)] border bg-muted/40 p-4"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("site.servicesPage.onThisPage")}
          </p>
          <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {sections.map((s, i) => (
              <li key={s.id} className="flex gap-2 text-sm">
                <span aria-hidden className="tabular-nums text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {/* A real href, so the link is shareable and works with
                    JavaScript unavailable; the handler only improves it by
                    opening the fold before the jump. */}
                <a
                  href={`#${s.id}`}
                  className="min-w-0 hover:text-primary-ink hover:underline"
                  onClick={(e) => {
                    e.preventDefault();
                    history.replaceState(null, "", `#${s.id}`);
                    jump(s.id);
                  }}
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="border-t border-border/60">
        {sections.map((s) => (
          <Disclosure
            key={s.id}
            section={s}
            open={Boolean(open[s.id])}
            onToggle={(v) => setOpen((o) => ({ ...o, [s.id]: v }))}
          />
        ))}
      </div>
    </div>
  );
}

export default LongCopy;
