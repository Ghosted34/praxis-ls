/**
 * Dictionary Finder (MOD-05) — the one control for choosing a financial
 * dictionary line, used from costing, quotation, cash request, purchase order,
 * supplier invoice and the dictionary itself.
 *
 * WHY IT EXISTS. The catalogue is 176 lines and nobody outside finance knows
 * what it calls things. An operations clerk looking at a carrier invoice sees
 * "surestaries"; the catalogue says Demurrage. A driver's paperwork says
 * "gasoil"; the catalogue says Fuel. A filed costing sheet says "#-1119"; that
 * code was retired at the migration. A native `<select>` over 176 options
 * answers none of those, so people pick the nearest-looking line and the
 * costing is wrong in a way nobody notices until the month-end.
 *
 * So the search is server-side and fuzzy (GET /financial-dictionary/search):
 * exact keyword hits first — the alternates, abbreviations, misspellings and
 * superseded codes seeded in 9081 — then code matches, then trigram similarity
 * over both labels and the description. Typing "demurage" with one r finds it.
 *
 * WHAT IT SHOWS, AND WHY. Each row carries the code, both labels, and the
 * direction as a badge. The direction is the part people get wrong: a DÉBOURS
 * line is money advanced for the client and re-billed at cost, a REVENUE line
 * is the company's own fee. Choosing between "Customs Clearance" (your fee) and
 * "Customs Duties & Taxes" (the client's money) is exactly the mistake this
 * badge is here to prevent, so it is on the row and not behind a tooltip.
 *
 * The description sits under the name because that is what disambiguates two
 * lines whose names look alike — and it is the field the fuzzy search matches
 * on, so the reason a row came back is visible.
 */
import * as React from "react";
import { Popover } from "@/components/ui/popover";
import { Pill, type Tone } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { searchDict, type DictSearchHit, type Direction } from "@/lib/masterdata-api";

/**
 * Direction → the shared status tones. Débours is `warn` deliberately: it is the
 * one a picker most needs to catch the eye, because choosing it commits the line
 * to being re-billed at cost with no VAT of ours, and choosing revenue by
 * mistake books the client's money as turnover.
 */
const DIRECTION_TONE: Record<Direction, { label: string; tone: Tone }> = {
  REVENUE: { label: "Revenue", tone: "ok" },
  DEBOURS: { label: "Débours", tone: "warn" },
  EXPENSE: { label: "Expense", tone: "blue" },
  ASSET: { label: "Asset", tone: "orange" },
};

const labelOf = (h: { label_en?: string | null; label_fr?: string | null; code: string }) =>
  h.label_en || h.label_fr || h.code;

export function DictionaryFinder({
  value,
  valueLabel,
  onPick,
  label = "Financial dictionary line",
  placeholder = "Search a charge…",
  direction,
  serviceTypeId,
  id,
  allowEmpty = true,
}: {
  value?: string | null;
  /** Display snapshot for the current value, so the trigger reads correctly
   *  before any search has run (the caller already stores a denormalised label). */
  valueLabel?: string | null;
  onPick: (id: string, label: string, hit?: DictSearchHit) => void;
  label?: string;
  placeholder?: string;
  /** Narrow to one direction — a cash request only ever advances débours. */
  direction?: Direction;
  /** Narrow to the lines mapped to a service type (the dossier's service). */
  serviceTypeId?: string | null;
  id?: string;
  allowEmpty?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<DictSearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  // Debounced, and every in-flight response is checked against the current term
  // before it is rendered — otherwise a slow "de" lands after a fast "demurage"
  // and overwrites the right answer with a stale one.
  React.useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) { setHits([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      searchDict({ q: term, direction, service_type_id: serviceTypeId || undefined, limit: 20 })
        .then((rows) => { if (!cancelled) setHits(rows); })
        .catch(() => { if (!cancelled) setHits([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open, direction, serviceTypeId]);

  const pick = (hit: DictSearchHit | null) => {
    if (hit) onPick(hit.dictionary_item_id, labelOf(hit), hit);
    else onPick("", "");
    setOpen(false);
    setQ("");
  };

  const term = q.trim();

  return (
    <Popover
      open={open}
      onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}
      align="start"
      label={label}
      className="w-[min(30rem,92vw)] p-0"
      trigger={
        <button
          type="button"
          id={id}
          aria-label={label}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 truncate">
            {value && valueLabel ? valueLabel : <span className="text-muted-foreground">{placeholder}</span>}
          </span>
          <span aria-hidden className="text-muted-foreground">▾</span>
        </button>
      }
    >
      <div className="border-b p-2">
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type a charge, a code, or what it is called locally…"
          aria-label={label}
          className="h-8 w-full rounded-md border bg-transparent px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="max-h-72 overflow-auto p-1" role="listbox" aria-label={label}>
        {allowEmpty && (
          <button
            type="button"
            onClick={() => pick(null)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
          >
            — None
          </button>
        )}
        {term.length < 2 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">
            Type at least two characters. Local names work too — “surestaries”, “gasoil”, “THC”.
          </div>
        ) : loading ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">Searching…</div>
        ) : hits.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">No line matches “{term}”.</div>
        ) : (
          hits.map((h) => {
            const badge = DIRECTION_TONE[h.direction] || DIRECTION_TONE.EXPENSE;
            return (
              <button
                key={h.dictionary_item_id}
                type="button"
                role="option"
                aria-selected={h.dictionary_item_id === value}
                onClick={() => pick(h)}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted",
                  h.dictionary_item_id === value ? "bg-primary/10" : "",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{h.code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{labelOf(h)}</span>
                  <Pill tone={badge.tone}>{badge.label}</Pill>
                </span>
                {h.description && (
                  <span className="line-clamp-2 text-xs text-muted-foreground">{h.description}</span>
                )}
              </button>
            );
          })
        )}
      </div>
    </Popover>
  );
}
