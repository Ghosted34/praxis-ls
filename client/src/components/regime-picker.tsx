/**
 * RegimePicker — Cameroon tax regime picker with inline add.
 *
 * Strict enum UX (REEL, NORMAL, SIMPLIFIE, LIBERATOIRE, FORFAIT, FRANCHISE)
 * but allows creating a new uppercase code inline, as requested:
 * "strict enum we must have the possibility of adding so an inline UI please."
 *
 * Single source of truth: packages/shared/data/tax-regimes.js, imported via
 * @shared alias. No round-trip, stays in sync with API Zod schema and migration.
 *
 * Features:
 * - Search by code, fr/en label, hint
 * - Shows hint (turnover, VAT, OHADA)
 * - Inline add: if typed value is valid uppercase 2-30 and not in list, offer
 *   "Add <CODE> as new regime" — on click, onChange(newCode) and closes
 * - Keyboard: ArrowUp/Down, Enter, Escape
 * - Allow empty: shows "— No regime" option
 */
import * as React from "react";
import { taxRegimes } from "@shared";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";

type Regime = (typeof taxRegimes.TAX_REGIMES)[number];

const normalize = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function regimeSearch(r: { code: string; label_fr: string; label_en: string; hint_fr: string; hint_en: string }): string {
  return normalize([r.code, r.label_fr, r.label_en, r.hint_fr, r.hint_en].join(" "));
}

const CODE_RE = /^[A-Z0-9_]{2,30}$/;

export function RegimePicker({
  value,
  onChange,
  label = "Regime",
  allowEmpty = true,
  disabled = false,
  lang = "fr",
}: {
  value?: string | null;
  onChange: (next: string | null) => void;
  label?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  lang?: "fr" | "en";
}) {
  const reactId = React.useId();
  const listId = `${reactId}-regime-list`;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const selectedCode = value ? String(value).trim().toUpperCase() : "";
  const selected = selectedCode ? taxRegimes.byCode(selectedCode) : null;
  const isCustomSelected = selectedCode && !selected && CODE_RE.test(selectedCode);

  const indexed = React.useMemo(
    () => (taxRegimes.TAX_REGIMES as readonly Regime[]).map((r) => ({ r, search: regimeSearch(r) })),
    [],
  );

  const filtered = React.useMemo(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return taxRegimes.TAX_REGIMES as readonly Regime[];
    return indexed
      .filter(({ search }: { search: string }) => terms.every((t) => search.includes(t)))
      .map(({ r }: { r: Regime }) => r);
  }, [indexed, query]);

  // Inline add candidate: query itself uppercased, if valid and not in known list
  const addCandidate = React.useMemo(() => {
    const raw = query.trim().toUpperCase();
    if (!raw) return null;
    if (taxRegimes.TAX_REGIME_CODES.includes(raw)) return null;
    if (!CODE_RE.test(raw)) return null;
    return raw;
  }, [query]);

  const choices = React.useMemo<(Regime | null | string)[]>(() => {
    const list: (Regime | null | string)[] = [];
    if (allowEmpty && !query.trim()) list.push(null);
    list.push(...(filtered as Regime[]));
    if (addCandidate) list.push(addCandidate); // string marks "create new"
    return list;
  }, [allowEmpty, filtered, query, addCandidate]);

  React.useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const idx = !query.trim() && selected
      ? choices.findIndex((c) => typeof c !== "string" && c !== null && (c as Regime).code === selected.code)
      : 0;
    setActive(idx >= 0 ? idx : 0);
  }, [choices, open, query, selected]);

  React.useEffect(() => {
    if (open) optionRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (item: Regime | null | string) => {
    if (item === null) {
      onChange(null);
    } else if (typeof item === "string") {
      onChange(item.toUpperCase());
    } else {
      onChange(item.code);
    }
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!choices.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + dir + choices.length) % choices.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(choices.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(choices[active] ?? null);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (!next) setQuery("");
      }}
      align="start"
      label={label}
      className="w-[min(28rem,calc(100vw-1.5rem))] p-0"
      trigger={
        <button
          type="button"
          role="combobox"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={disabled}
          className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selected ? (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary-ink">
                {selected.code}
              </span>
              <span className="truncate text-sm">
                {lang === "fr" ? selected.label_fr : selected.label_en}
              </span>
            </span>
          ) : isCustomSelected ? (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 rounded-md bg-warn/15 px-2 py-0.5 text-xs font-semibold">
                {selectedCode}
              </span>
              <span className="truncate text-xs text-muted-foreground">Custom</span>
            </span>
          ) : value ? (
            <span className="truncate">{value}</span>
          ) : (
            <span className="text-muted-foreground">Select regime…</span>
          )}
          <span aria-hidden className="shrink-0 text-muted-foreground">
            ▾
          </span>
        </button>
      }
    >
      <section aria-label={`${label} picker`}>
        <div className="border-b p-2">
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              ⌕
            </span>
            <input
              ref={searchRef}
              role="combobox"
              aria-label={`Search ${label.toLowerCase()}`}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={choices.length ? `${reactId}-regime-${active}` : undefined}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={lang === "fr" ? "Rechercher REEL, simplifié, libératoire…" : "Search REEL, simplified, flat-rate…"}
              className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <p className="mt-1.5 px-1 text-[0.6875rem] text-muted-foreground">
            {tr("Cameroon standard")}: REEL · SIMPLIFIE · LIBERATOIRE · FRANCHISE · NORMAL · FORFAIT —{" "}
            {lang === "fr" ? "tapez un nouveau code en majuscules pour l'ajouter" : "type a new uppercase code to add it"}
          </p>
        </div>

        <ul id={listId} role="listbox" aria-label={`${label} results`} className="m-0 max-h-80 list-none overflow-y-auto p-1">
          {choices.map((item, index) => {
            const isSelected =
              item === null
                ? !selectedCode
                : typeof item === "string"
                  ? false
                  : (item as Regime).code === selectedCode;

            // Create-new row
            if (typeof item === "string") {
              return (
                <li key={`add-${item}`} role="presentation">
                  <button
                    ref={(n) => {
                      optionRefs.current[index] = n;
                    }}
                    type="button"
                    id={`${reactId}-regime-${index}`}
                    role="option"
                    aria-selected={false}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(item)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm border border-dashed",
                      index === active ? "bg-warn/10 border-warn/30" : "hover:bg-muted border-border",
                    )}
                  >
                    <span className="rounded-md bg-warn/15 px-2 py-1 text-xs font-semibold">+ {item}</span>
                    <span className="text-xs text-muted-foreground">
                      {lang === "fr" ? "Ajouter ce régime" : "Add this regime"}
                    </span>
                  </button>
                </li>
              );
            }

            if (item === null) {
              return (
                <li key="empty" role="presentation">
                  <button
                    ref={(n) => {
                      optionRefs.current[index] = n;
                    }}
                    type="button"
                    id={`${reactId}-regime-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(null)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm",
                      index === active ? "bg-muted" : "hover:bg-muted/70",
                    )}
                  >
                    <span className="min-w-16 shrink-0 rounded-md bg-muted px-2 py-1 text-center text-xs text-muted-foreground">—</span>
                    <span className="flex-1 py-1 text-muted-foreground">{tr("No regime")}</span>
                    {isSelected && <span aria-hidden className="text-primary-ink">✓</span>}
                  </button>
                </li>
              );
            }

            const r = item as Regime;
            return (
              <li key={r.code} role="presentation">
                <button
                  ref={(n) => {
                    optionRefs.current[index] = n;
                  }}
                  type="button"
                  id={`${reactId}-regime-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-label={`${r.code}, ${r.label_fr}, ${r.label_en}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(r)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-md px-2 py-2 text-left text-sm",
                    index === active ? "bg-muted" : "hover:bg-muted/70",
                  )}
                >
                  <span className="min-w-16 shrink-0 rounded-md bg-primary/10 px-2 py-1 text-center text-xs font-semibold text-primary-ink">
                    {r.code}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-foreground">
                      {lang === "fr" ? r.label_fr : r.label_en}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        / {lang === "fr" ? r.label_en : r.label_fr}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {lang === "fr" ? r.hint_fr : r.hint_en}
                    </span>
                  </span>
                  {isSelected && <span aria-hidden className="shrink-0 text-primary-ink">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>

        {filtered.length === 0 && !addCandidate && (
          <div className="px-5 py-6 text-center">
            <p className="text-sm font-medium text-foreground">{tr("No regime found")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {tr("Type a new uppercase code, e.g. REEL, and press Enter to add it.")}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-1 border-t px-3 py-2 text-[0.6875rem] text-muted-foreground">
          <span>{filtered.length} regimes</span>
          <span>CM · OHADA</span>
        </div>
      </section>
    </Popover>
  );
}
