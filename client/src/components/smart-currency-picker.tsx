/**
 * Smart Currency Picker — a searchable, full ISO-4217 currency control, sibling
 * to the Smart Country Picker.
 *
 * The twist the CEO asked for: it searches BY COUNTRY too. You have an invoice
 * for Holland and you are not sure of the currency — type "Holland" (or
 * "Netherlands") and EUR surfaces, because every currency carries the countries
 * that trade in it (from @shared, the same reference the country picker uses). A
 * small alias table covers the colloquial names people actually type ("UK",
 * "USA", "Holland").
 *
 * Lists the whole catalogue, lanes-first (CEMAC/OHADA and the main trade lanes
 * lead), filters as you type, and hides currencies already added (`exclude`).
 */
import * as React from "react";
import { currencies, countries } from "@shared";
import { flagOf } from "@/components/smart-country-picker";
import { Popover, PopoverClose } from "@/components/ui/popover";
import { cn } from "@/lib/cn";

const CATALOGUE = currencies.CATALOGUE;

// Colloquial names people type that the canonical country list does not carry.
const COUNTRY_ALIASES: Record<string, string> = {
  NL: "holland",
  GB: "uk britain england scotland wales",
  US: "usa america united states",
  AE: "uae emirates dubai",
  KR: "south korea",
  KP: "north korea",
  RU: "russia",
  CD: "drc congo kinshasa",
  CI: "ivory coast",
  CZ: "czechia",
};

// code → lowercased haystack of "code name <country names + aliases>", built once.
const SEARCH_INDEX: Map<string, string> = (() => {
  const byCur = new Map<string, string[]>();
  for (const c of countries.COUNTRIES) {
    const arr = byCur.get(c.currency) || [];
    arr.push(c.name);
    if (COUNTRY_ALIASES[c.code]) arr.push(COUNTRY_ALIASES[c.code]);
    byCur.set(c.currency, arr);
  }
  const idx = new Map<string, string>();
  for (const cur of CATALOGUE) {
    idx.set(
      cur.code,
      `${cur.code} ${cur.name} ${(byCur.get(cur.code) || []).join(" ")}`.toLowerCase(),
    );
  }
  return idx;
})();

export function SmartCurrencyPicker({
  value,
  onChange,
  exclude = [],
  label = "Currency",
  id,
}: {
  value?: string | null;
  onChange: (code: string) => void;
  /** Codes already in use — hidden from the list so nothing is added twice. */
  exclude?: string[];
  label?: string;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);
  const current = (value || "").toUpperCase();
  const excluded = React.useMemo(
    () => new Set(exclude.map((c) => c.toUpperCase())),
    [exclude],
  );
  const selected = CATALOGUE.find((c) => c.code === current);

  React.useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return CATALOGUE.filter((c) => !excluded.has(c.code)).filter(
      (c) => !needle || (SEARCH_INDEX.get(c.code) || "").includes(needle),
    );
  }, [q, excluded]);

  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
    setQ("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
      align="start"
      label={label}
      className="w-[min(24rem,90vw)] p-0"
      trigger={
        <button
          type="button"
          id={id}
          aria-label={label}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected ? (
              <>
                <span aria-hidden>{flagOf(selected.country_code)}</span>
                <span className="num font-medium">{selected.code}</span>
                <span className="truncate text-muted-foreground">
                  {selected.name}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Select a currency…</span>
            )}
          </span>
          <span aria-hidden className="text-muted-foreground">
            ▾
          </span>
        </button>
      }
    >
      <div className="border-b p-2">
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search currency or country…"
          aria-label="Search currency or country"
          className="h-8 w-full rounded-md border bg-transparent px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div
        className="max-h-72 overflow-auto p-1"
        role="listbox"
        aria-label={label}
      >
        {filtered.length === 0 ? (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
            No match.
          </div>
        ) : (
          filtered.map((c) => (
            <PopoverClose asChild key={c.code}>
              <button
                type="button"
                role="option"
                aria-selected={c.code === current}
                onClick={() => pick(c.code)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                  c.code === current
                    ? "bg-primary/10 text-foreground"
                    : "text-foreground",
                )}
              >
                <span aria-hidden className="w-5 text-center">
                  {flagOf(c.country_code)}
                </span>
                <span className="num w-10 font-medium">{c.code}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {c.name}
                </span>
                <span
                  aria-hidden
                  className="w-8 text-right text-muted-foreground"
                >
                  {c.symbol}
                </span>
                {c.code === current && (
                  <span aria-hidden className="text-primary-ink">
                    ✓
                  </span>
                )}
              </button>
            </PopoverClose>
          ))
        )}
      </div>
    </Popover>
  );
}
