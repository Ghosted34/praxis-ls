/**
 * TimezonePicker — a closed, searchable picker over the complete IANA catalogue.
 *
 * The 418 geographic zones from tzdb 2026b plus UTC are bundled through
 * `@shared`, so opening this control is instant and works offline. The same data
 * validates API writes: typing narrows the list, but typed text can never be
 * committed as a timezone. Deprecated IANA names remain search aliases only
 * ("Kiev" finds Europe/Kyiv; "US/Eastern" finds America/New_York).
 */
import * as React from "react";
import { countries, timezones, type Timezone } from "@shared";
import { Popover } from "@/components/ui/popover";
import { flagOf } from "@/components/smart-country-picker";
import { cn } from "@/lib/cn";

type ZoneView = Timezone & {
  countryName: string;
  offsetMinutes: number;
  offsetLabel: string;
  abbreviation: string;
  search: string;
};

const normalizeSearch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+-]+/g, " ")
    .trim();

function offsetMinutes(id: string, at: Date): number {
  if (id === "UTC") return 0;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: id,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value || 0);
    const wallAsUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    return Math.round((wallAsUtc - at.getTime()) / 60_000);
  } catch {
    // A very old browser may not know a zone added by a newer tzdb. Keep it
    // selectable; the canonical id is still valid and the server knows it.
    return 0;
  }
}

function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const mins = String(absolute % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${mins}`;
}

function shortName(id: string, at: Date): string {
  if (id === "UTC") return "UTC";
  try {
    return (
      new Intl.DateTimeFormat("en", {
        timeZone: id,
        timeZoneName: "short",
      })
        .formatToParts(at)
        .find((part) => part.type === "timeZoneName")?.value || ""
    );
  } catch {
    return "";
  }
}

function offsetSearchTerms(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const mins = String(absolute % 60).padStart(2, "0");
  const padded = String(hours).padStart(2, "0");
  return `utc${sign}${hours} utc${sign}${padded}:${mins} gmt${sign}${hours} gmt${sign}${padded}:${mins} ${sign}${hours}`;
}

let cachedHour = "";
let cachedViews: ZoneView[] = [];

/** Build current offsets at most once an hour, even with several pickers open. */
function catalogueViews(): ZoneView[] {
  const now = new Date();
  const hour = now.toISOString().slice(0, 13);
  if (cachedHour === hour && cachedViews.length) return cachedViews;

  cachedHour = hour;
  cachedViews = timezones.CATALOGUE.map((zone) => {
    const countryName = zone.country_code
      ? countries.byCode(zone.country_code)?.name || zone.country_code
      : "";
    const minutes = offsetMinutes(zone.id, now);
    const abbreviation = shortName(zone.id, now);
    const search = normalizeSearch(
      [
        zone.id,
        zone.region,
        zone.city,
        zone.country_code || "",
        countryName,
        zone.comment,
        abbreviation,
        offsetSearchTerms(minutes),
        ...zone.aliases,
      ].join(" "),
    );
    return {
      ...zone,
      countryName,
      offsetMinutes: minutes,
      offsetLabel: offsetLabel(minutes),
      abbreviation,
      search,
    };
  });
  return cachedViews;
}

function currentDeviceZone(): string | null {
  try {
    const id = timezones.normalize(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    return timezones.byId(id) ? id : null;
  } catch {
    return null;
  }
}

export function TimezonePicker({
  value,
  onChange,
  label = "Timezone",
  id,
  allowEmpty = true,
  disabled = false,
}: {
  value?: string | null;
  onChange: (timezone: string) => void;
  label?: string;
  id?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
}) {
  const reactId = React.useId();
  const baseId = id || reactId;
  const listId = `${baseId}-timezone-list`;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const deviceZone = React.useMemo(currentDeviceZone, []);
  const canonicalValue = value ? timezones.normalize(value) : "";
  const views = React.useMemo(() => (open ? catalogueViews() : []), [open]);

  // The closed trigger needs only its own row; do not calculate 419 offsets until
  // the user actually opens the catalogue.
  const selected = React.useMemo(() => {
    if (!canonicalValue) return null;
    return catalogueViews().find((zone) => zone.id === canonicalValue) || null;
  }, [canonicalValue]);

  const filtered = React.useMemo(() => {
    const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return views;
    return views.filter((zone) =>
      terms.every((term) => zone.search.includes(term)),
    );
  }, [query, views]);

  const choices = React.useMemo<Array<ZoneView | null>>(
    () => [...(allowEmpty && !query.trim() ? [null] : []), ...filtered],
    [allowEmpty, filtered, query],
  );

  React.useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const preferred = query.trim() ? "" : canonicalValue || deviceZone || "";
    const next = preferred
      ? choices.findIndex((zone) => zone?.id === preferred)
      : 0;
    setActive(next >= 0 ? next : 0);
  }, [canonicalValue, choices, deviceZone, open, query]);

  React.useEffect(() => {
    if (!open) return;
    optionRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (zone: ZoneView | null) => {
    onChange(zone?.id || "");
    setOpen(false);
    setQuery("");
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!choices.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActive(
        (index) => (index + direction + choices.length) % choices.length,
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(choices.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(choices[active] ?? null);
    }
  };

  let previousRegion = "";
  const resultText = query.trim()
    ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}`
    : `${timezones.CATALOGUE.length} timezones`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      align="start"
      label={label}
      className="w-[min(34rem,calc(100vw-1.5rem))] p-0"
      trigger={
        <button
          type="button"
          id={baseId}
          role="combobox"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={disabled}
          className="flex h-9 w-full items-center justify-between gap-3 rounded-md border bg-transparent px-3 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selected ? (
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="num shrink-0 text-xs font-medium text-muted-foreground">
                {selected.offsetLabel}
              </span>
              <span className="truncate font-medium">{selected.city}</span>
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                {selected.id}
              </span>
            </span>
          ) : value ? (
            <span className="truncate">{value}</span>
          ) : (
            <span className="text-muted-foreground">Select a timezone…</span>
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
            <span
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              ⌕
            </span>
            <input
              ref={searchRef}
              role="combobox"
              aria-label={`Search ${label.toLowerCase()}`}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={
                choices.length ? `${baseId}-timezone-${active}` : undefined
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search city, country, zone or UTC offset…"
              className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {resultText}
          </p>
        </div>

        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} results`}
          className="m-0 max-h-80 list-none overflow-y-auto p-1"
        >
          {choices.map((zone, index) => {
            const showRegion = zone && zone.region !== previousRegion;
            if (zone) previousRegion = zone.region;
            const isSelected = zone
              ? zone.id === canonicalValue
              : !canonicalValue;
            const isDevice = zone?.id === deviceZone;

            return (
              <React.Fragment key={zone?.id || "empty"}>
                {showRegion && (
                  <li
                    role="presentation"
                    className="sticky top-0 z-10 bg-popover px-2 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {zone.region}
                  </li>
                )}
                <li role="presentation">
                  <button
                    ref={(node) => {
                      optionRefs.current[index] = node;
                    }}
                    type="button"
                    id={`${baseId}-timezone-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-label={
                      zone
                        ? `${zone.city}, ${zone.countryName || zone.region}, ${zone.id}, ${zone.offsetLabel}`
                        : "No timezone"
                    }
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(zone)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
                      index === active ? "bg-muted" : "hover:bg-muted/70",
                      isSelected && "text-foreground",
                    )}
                  >
                    {zone ? (
                      <>
                        <span className="num w-[5.25rem] shrink-0 text-xs text-muted-foreground">
                          {zone.offsetLabel}
                        </span>
                        <span aria-hidden className="w-5 shrink-0 text-center">
                          {flagOf(zone.country_code)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium">
                              {zone.city}
                            </span>
                            {isDevice && (
                              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.625rem] font-medium text-primary-ink">
                                Device
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[zone.countryName, zone.id]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        {isSelected && (
                          <span
                            aria-hidden
                            className="shrink-0 text-primary-ink"
                          >
                            ✓
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="w-[5.25rem] shrink-0" />
                        <span aria-hidden className="w-5 text-center">
                          —
                        </span>
                        <span className="flex-1 text-muted-foreground">
                          No timezone
                        </span>
                        {isSelected && (
                          <span aria-hidden className="text-primary-ink">
                            ✓
                          </span>
                        )}
                      </>
                    )}
                  </button>
                </li>
              </React.Fragment>
            );
          })}
        </ul>

        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium text-foreground">
              No timezone found
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a city, country, IANA name, or offset such as UTC+1.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between border-t px-3 py-2 text-[0.6875rem] text-muted-foreground">
          <span>{resultText}</span>
          <span>IANA tzdb {timezones.TZDB_VERSION}</span>
        </div>
      </section>
    </Popover>
  );
}
