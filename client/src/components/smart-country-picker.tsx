/**
 * Smart Country Picker (spec §8.1) — a searchable, full ISO-3166 country control.
 *
 * Replaces the partial native `<CountrySelect>` (Hard Rule 8: no native HTML
 * selects for country/phone/category/document-type). It lists every country from
 * the shared canonical reference (`@shared` countries — the same data the API and
 * the seed use), priority-ordered so CEMAC/OHADA and the main trade lanes lead,
 * and filters as you type. Reused anywhere a country is chosen.
 *
 * It also exports `flagOf` and `dialCodeOf` so a phone field can compose an E.164
 * number from the selected country's calling code.
 */
import * as React from "react";
import { countries } from "@shared";
import { Popover, PopoverClose } from "@/components/ui/popover";
import { cn } from "@/lib/cn";

const CATALOGUE = countries.CATALOGUE;

/** ISO alpha-2 → flag emoji (regional-indicator pair). "" for a bad code. */
export function flagOf(code?: string | null): string {
  const c = String(code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  return String.fromCodePoint(...[...c].map((ch) => 127397 + ch.charCodeAt(0)));
}

/** The E.164 calling code (bare digits) for a country, or "". */
export const dialCodeOf = (code?: string | null): string => countries.phoneCodeFor(code || "");

export function SmartCountryPicker({
  value,
  onChange,
  allowEmpty = true,
  label = "Country",
  id,
}: {
  value?: string | null;
  onChange: (code: string) => void;
  allowEmpty?: boolean;
  label?: string;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);
  const current = (value || "").toUpperCase();
  const selected = CATALOGUE.find((c) => c.code === current);

  // Move focus into the search when the panel opens (the accessible alternative
  // to autoFocus, which jsx-a11y forbids). Radix has already trapped focus.
  React.useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return CATALOGUE;
    return CATALOGUE.filter((c) => c.name.toLowerCase().includes(needle) || c.code.toLowerCase() === needle);
  }, [q]);

  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
    setQ("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}
      align="start"
      label={label}
      className="w-[min(22rem,90vw)] p-0"
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
                <span aria-hidden>{flagOf(selected.code)}</span>
                <span className="truncate">{selected.name}</span>
                <span className="text-muted-foreground">+{selected.phone}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Select a country…</span>
            )}
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
          placeholder="Search countries…"
          aria-label="Search countries"
          className="h-8 w-full rounded-md border bg-transparent px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="max-h-64 overflow-auto p-1" role="listbox" aria-label={label}>
        {allowEmpty && (
          <PopoverClose asChild>
            <button type="button" onClick={() => pick("")} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted">
              — None
            </button>
          </PopoverClose>
        )}
        {filtered.length === 0 ? (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">No match.</div>
        ) : (
          filtered.map((c) => (
            <button
              key={c.code}
              type="button"
              role="option"
              aria-selected={c.code === current}
              onClick={() => pick(c.code)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                c.code === current ? "bg-primary/10 text-foreground" : "text-foreground",
              )}
            >
              <span aria-hidden className="w-5 text-center">{flagOf(c.code)}</span>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="text-muted-foreground">+{c.phone}</span>
              {c.code === current && <span aria-hidden className="text-primary-ink">✓</span>}
            </button>
          ))
        )}
      </div>
    </Popover>
  );
}
