/**
 * PlaceField — how a client names one place on a quote: a port, an airport, a
 * town, or the door we collect from or deliver to.
 *
 * ── WHERE IT COMES FROM ────────────────────────────────────────────────────
 *
 * The desk's PlacePicker (client/src/components/operations/place-picker.tsx)
 * is the engine this follows: the catalogue answers first, a worldwide search
 * fills what it lacks, every row carries the facts that tell two same-named
 * places apart (the code on the booking, the kind, the country), and a
 * provider suggestion becomes a place only when the SERVER re-asks the
 * provider. It cannot be imported — public-web installs only its own
 * dependencies in CI — so this is the portal's own copy of the idea, with
 * three deliberate differences for a client rather than an operator:
 *
 *   1. IT OPENS A SEARCH SHEET, NOT A DROPDOWN. The quote is itself a sheet,
 *      usually on a phone, and a popover under a field inside a scrolling
 *      sheet is what the keyboard covers. Tapping the field opens a full-height
 *      search with the box at the top and the results under the thumb.
 *   2. IT HAS SOMETHING TO SAY BEFORE THEY TYPE. The empty box shows the
 *      client's own places (every one already on their requests and files)
 *      and the tenant's most-used ports, so the common case — the same lane
 *      as last month — is one tap and no typing.
 *   3. IT ACCEPTS WHAT THEY WROTE. The desk's picker refuses free text because
 *      an unverified place on a FILE misroutes cargo. A quote REQUEST is a
 *      question, and a supplier's yard no map knows must not cost the enquiry.
 *      "Use it as written" is always the last row, and the field says plainly
 *      that the desk will pin it.
 *
 * ── DOORS ──────────────────────────────────────────────────────────────────
 *
 * A field with `doors` takes addresses, and an address is never in the
 * catalogue a client can see (the server offers them shared infrastructure
 * and their own places, never another client's door). So for a door the
 * worldwide search runs as they type rather than behind a button — the button
 * would be a step every single address needed. The server still skips it when
 * the catalogue has the exact answer, and a spent budget or a provider outage
 * turns it off for the rest of the sheet rather than failing the search.
 *
 * ── ACCESSIBILITY ──────────────────────────────────────────────────────────
 *
 * The APG combobox-with-listbox pattern, as the desk's picker and the public
 * wizard's PlaceInput do it: focus stays in the input, Up/Down walk every row
 * across every group (a keyboard user must reach an address suggestion as
 * easily as a port), Enter picks, Escape closes the sheet, and a polite live
 * region says how many places arrived. Provider text is rendered as text by
 * React — never as HTML.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import {
  portalPlaces,
  type PlaceKind,
  type PortalPlace,
  type PortalPlacePick,
  type PortalPlaceSearch,
  type PortalPlaceSuggestion,
} from "@/lib/portal-api";
import { Sheet } from "./kit";
import {
  ChevronRightIcon,
  CityIcon,
  CloseIcon,
  FlagIcon,
  GlobeIcon,
  PencilIcon,
  PinIcon,
  PlaneIcon,
  SearchIcon,
  ShipIcon,
  TrainIcon,
  WarehouseIcon,
} from "./icons";

/* ── the value ───────────────────────────────────────────────────────────── */

/**
 * One end of a route as the quote sheet holds it.
 *
 * `text` is what the request stores and the desk reads. `pick` is what the
 * server resolves to a verified place — null when the client wrote the place
 * themselves. The rest is only for showing the choice back to them.
 */
export type PlaceValue = {
  text: string;
  pick: PortalPlacePick | null;
  /** What the field shows as its title — the place's own name, where the
   *  stored text is a whole address line. Falls back to `text`. */
  name?: string | null;
  kind?: string | null;
  code?: string | null;
  region?: string | null;
  country?: string | null;
  formatted?: string | null;
};

export const EMPTY_PLACE: PlaceValue = { text: "", pick: null };

/** The request's text columns hold 200 characters (portal_auth.validator). */
const MAX_TEXT = 200;

/**
 * The code a client would recognise: UN/LOCODE where the place has one, else
 * the IATA code airports carry at the head of `formatted` ("DLA · Douala…").
 * The same rule as the desk's `place-meta.codeOf`.
 */
export function codeOf(p: { unlocode?: string | null; formatted?: string | null }): string | null {
  if (p.unlocode) return p.unlocode;
  const head = String(p.formatted || "")
    .split("·")[0]
    .trim();
  return /^[A-Z]{3}$/.test(head) ? head : null;
}

/** The address line without the code a chip already shows. */
function addressOf(formatted: string | null | undefined): string | null {
  const raw = String(formatted || "").trim();
  if (!raw) return null;
  const parts = raw.split("·");
  return (parts.length > 1 ? parts.slice(1).join("·") : raw).trim() || null;
}

export function placeValue(p: PortalPlace, text?: string | null): PlaceValue {
  return {
    text: (text || p.name).slice(0, MAX_TEXT),
    pick: { geo_place_id: p.geo_place_id },
    name: p.name,
    kind: p.kind,
    code: codeOf(p),
    region: p.region,
    country: p.country,
    formatted: p.formatted,
  };
}

/**
 * A worldwide suggestion as a value. `query` must be the text that FOUND it —
 * the server re-runs that search and matches the provider's id in the answer,
 * so the text in the box now (which may have moved on) is the wrong one.
 */
export function suggestionValue(s: PortalPlaceSuggestion, query: string): PlaceValue {
  const text = (s.formatted || s.name || query).trim().slice(0, MAX_TEXT);
  return {
    text,
    pick: {
      provider_place_id: s.provider_place_id,
      query: query.trim().slice(0, MAX_TEXT),
      ...(s.country ? { country: s.country } : {}),
    },
    name: s.name || null,
    kind: s.kind,
    code: null,
    country: s.country,
    formatted: s.formatted,
  };
}

export const typedValue = (text: string): PlaceValue => ({ text: text.trim().slice(0, MAX_TEXT), pick: null });

/**
 * The folding `geo_place.query_key` is built from — accents, apostrophes and
 * punctuation away, lowercased — so "N’Djamena" typed matches "Ndjamena" stored.
 */
export function placeKey(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['‘’`]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Pin text that arrived without a pick — the AI fill, "Like PRX-…" — when the
 * places the client may see hold EXACTLY that place. Never a near match: a
 * wrong pin is worse than none, and "none" still reads "we'll pin it".
 */
export async function pinExact(text: string, kinds?: PlaceKind[]): Promise<PlaceValue | null> {
  const key = placeKey(text);
  if (key.length < 2) return null;
  try {
    const res = await portalPlaces({ q: text, kinds });
    const code = text.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const all = [...(res?.recent || []), ...(res?.places || [])];
    const hit = all.find((p) => placeKey(p.name) === key || (!!p.unlocode && p.unlocode === code));
    return hit ? placeValue(hit) : null;
  } catch {
    // class D, best-effort — the text stands and the desk pins it.
    return null;
  }
}

/* ── glyphs and small pieces ─────────────────────────────────────────────── */

export function KindGlyph({ kind, size = 20 }: { kind?: string | null; size?: number }) {
  switch (kind) {
    case "SEAPORT":
      return <ShipIcon size={size} />;
    case "AIRPORT":
      return <PlaneIcon size={size} />;
    case "RAIL_TERMINAL":
      return <TrainIcon size={size} />;
    case "TERMINAL":
    case "WAREHOUSE":
    case "INLAND":
      return <WarehouseIcon size={size} />;
    case "BORDER_POST":
      return <FlagIcon size={size} />;
    case "CITY":
      return <CityIcon size={size} />;
    default:
      return <PinIcon size={size} />;
  }
}

/**
 * The line under a place's name: what it is, then where.
 *
 * The address is used only when it adds something. An airport's formatted line
 * repeats its own name ("Douala International Airport, Douala"), so it gives
 * way to region · country; a street address that starts with its own name
 * keeps only what follows it ("Rue Drouot, Bonabéri, Douala…" → "Bonabéri,
 * Douala…"), because the name is already the line above.
 */
export function placeLine(
  p: { name?: string | null; kind?: string | null; region?: string | null; country?: string | null; formatted?: string | null },
  kindLabel: string,
  lang: string,
): string | null {
  const name = String(p.name || "").trim();
  const addr = addressOf(p.formatted);
  let where: string | null = null;
  if (addr) {
    if (name && addr.toLowerCase().startsWith(`${name.toLowerCase()}, `)) where = addr.slice(name.length + 2).trim() || null;
    else if (!name || !placeKey(addr).includes(placeKey(name))) where = addr;
  }
  const parts = where ? [kindLabel, where] : [kindLabel, p.region, countryName(p.country, lang)];
  return parts.filter(Boolean).join(" · ") || null;
}

/** "CM" → "Cameroon" / "Cameroun", in the reader's language; the code itself if
 *  the browser cannot name it. */
function countryName(code: string | null | undefined, lang: string): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code.toUpperCase()) || code;
  } catch {
    // class D, best-effort — an old browser gets the ISO code, still readable.
    return code;
  }
}

/** The part of `name` that matched what they typed, emphasised. Plain text in,
 *  plain text out — no HTML is ever built from provider data. */
function Highlight({ text, term }: { text: string; term: string }) {
  const t = term.trim();
  const at = t.length >= 2 ? text.toLowerCase().indexOf(t.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="pt-hl">{text.slice(at, at + t.length)}</mark>
      {text.slice(at + t.length)}
    </>
  );
}

/* ── the field ───────────────────────────────────────────────────────────── */

export function PlaceField({
  label,
  value,
  onChange,
  kinds,
  doors = false,
  placeholder,
  autoOpen = false,
  onDismissEmpty,
  action,
  className,
}: {
  label: string;
  value: PlaceValue;
  onChange: (v: PlaceValue) => void;
  /** Restrict what the catalogue offers — an airport field asks for AIRPORT. */
  kinds?: PlaceKind[];
  /** This end takes addresses: the worldwide search runs as they type. */
  doors?: boolean;
  placeholder: string;
  /** Open the search as soon as the field appears (a door just added). */
  autoOpen?: boolean;
  /** The search was closed with nothing chosen on an empty field. */
  onDismissEmpty?: () => void;
  /** Something beside the label — a door's remove button. */
  action?: React.ReactNode;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const id = React.useId();
  const [open, setOpen] = React.useState(autoOpen);
  const [seed, setSeed] = React.useState<string | null>(null);
  const fieldRef = React.useRef<HTMLButtonElement>(null);
  /**
   * Back to the field when the search closes. The sheet restores focus to
   * whatever opened it — but a door's search is opened by the "add" button,
   * which this field REPLACES, so there is nothing to go back to and a
   * keyboard user was dropped on <body> (WCAG 2.4.3).
   */
  const settle = () => requestAnimationFrame(() => fieldRef.current?.focus());
  const kindText = value.kind ? t(`portal.place.kind.${value.kind}`, { defaultValue: "" }) : "";
  // Under the name: what it is and where, or — for a place they wrote — that
  // the desk will pin it, so "as written" never passes for a verified place.
  const detail = !value.text ? null : !value.pick ? t("portal.place.typed") : placeLine(value, kindText, i18n.language);
  const title = value.pick && value.name ? value.name : value.text;

  function openWith(first: string | null) {
    setSeed(first);
    setOpen(true);
  }

  return (
    <div className={className}>
      <div className="mb-2 flex min-h-[20px] items-center justify-between gap-2">
        <span id={`${id}-label`} className="pt-label !mb-0">
          {label}
        </span>
        {action}
      </div>
      <button
        ref={fieldRef}
        type="button"
        className="pt-field pt-place-field"
        data-empty={!value.text || undefined}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="dialog"
        onClick={() => openWith(null)}
        onKeyDown={(e) => {
          // Typing on the closed field starts the search with that letter, the
          // way a native select jumps — no need to open it first.
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") {
            e.preventDefault();
            openWith(e.key);
          }
        }}
      >
        <span className="pt-place-glyph" data-typed={(value.text && !value.pick) || undefined}>
          {value.text ? value.pick ? <KindGlyph kind={value.kind} /> : <PencilIcon size={18} /> : <SearchIcon size={18} />}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span id={`${id}-value`} className={cn("block truncate", value.text ? "font-semibold text-foreground" : "text-muted-foreground")}>
            {title || placeholder}
          </span>
          {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
        </span>
        {value.code ? <span className="pt-place-code pt-mono">{value.code}</span> : null}
        <ChevronRightIcon size={18} className="text-muted-foreground" />
      </button>
      <PlaceSearch
        open={open}
        title={label}
        placeholder={placeholder}
        seed={seed ?? (value.text && !value.pick ? value.text : "")}
        kinds={kinds}
        doors={doors}
        lang={i18n.language}
        onClose={() => {
          setOpen(false);
          if (!value.text && onDismissEmpty) onDismissEmpty();
          else settle();
        }}
        onPick={(v) => {
          onChange(v);
          setOpen(false);
          settle();
        }}
      />
    </div>
  );
}

/* ── the search sheet ────────────────────────────────────────────────────── */

type Row =
  | { type: "place"; place: PortalPlace; group: "recent" | "popular" | "places" }
  | { type: "suggestion"; suggestion: PortalPlaceSuggestion }
  | { type: "typed"; text: string };

type Result = PortalPlaceSearch & { term: string };

/** Debounces, in ms: a catalogue read tracks the typing; a worldwide one
 *  waits for a pause, because each one spends provider budget. */
const CATALOGUE_DEBOUNCE = 200;
const WORLD_DEBOUNCE = 380;
/** The provider's own floor — below it a worldwide search is not offered. */
const MIN_WORLD_CHARS = 3;
/** At or under this many offered places, "search addresses" is worth a button. */
const THIN = 3;

/** A response normalised at the boundary, so a proxy that trimmed it or an
 *  older server cannot crash the sheet mid-keystroke. */
function normalise(res: Partial<PortalPlaceSearch> | null | undefined, term: string): Result {
  const list = <T,>(v: T[] | undefined) => (Array.isArray(v) ? v : []);
  return {
    term,
    places: list(res?.places),
    recent: list(res?.recent),
    popular: list(res?.popular),
    has_exact: res?.has_exact === true,
    provider: {
      requested: res?.provider?.requested === true,
      status: res?.provider?.status || "NOT_REQUESTED",
      results: list(res?.provider?.results),
    },
  };
}

function PlaceSearch({
  open,
  title,
  placeholder,
  seed,
  kinds,
  doors,
  lang,
  onClose,
  onPick,
}: {
  open: boolean;
  title: string;
  placeholder: string;
  seed: string;
  kinds?: PlaceKind[];
  doors: boolean;
  lang: string;
  onClose: () => void;
  onPick: (v: PlaceValue) => void;
}) {
  const { t } = useTranslation();
  const baseId = React.useId();
  const listId = `${baseId}-list`;
  const [term, setTerm] = React.useState(seed);
  const [result, setResult] = React.useState<Result | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [worldLoading, setWorldLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  /** Once the worldwide half has said it cannot help, stop asking it. */
  const [worldOff, setWorldOff] = React.useState(false);
  const [active, setActive] = React.useState(0);
  /** Bumped per search, so a slow answer cannot overwrite a newer one. */
  const seq = React.useRef(0);
  const kindsKey = (kinds || []).join(",");
  const kindsRef = React.useRef(kinds);
  kindsRef.current = kinds;

  // A fresh sheet every time it opens, seeded with what was there.
  React.useEffect(() => {
    if (!open) return;
    setTerm(seed);
    setResult(null);
    setFailed(false);
    setActive(0);
  }, [open, seed]);

  const run = React.useCallback(async (q: string, world: boolean) => {
    const n = (seq.current += 1);
    if (world) setWorldLoading(true);
    else setLoading(true);
    setFailed(false);
    try {
      let res: PortalPlaceSearch;
      try {
        res = await portalPlaces({ q, kinds: kindsRef.current, provider: world });
      } catch (e) {
        if (!world) throw e;
        // The worldwide budget is spent, or that half failed: keep the
        // catalogue answering and stop spending on the other.
        setWorldOff(true);
        res = await portalPlaces({ q, kinds: kindsRef.current });
      }
      if (n !== seq.current) return;
      const next = normalise(res, q);
      if (next.provider.status === "UNAVAILABLE") setWorldOff(true);
      setResult(next);
      setActive(0);
    } catch {
      if (n !== seq.current) return;
      setFailed(true);
      setResult(null);
    } finally {
      if (n === seq.current) {
        setLoading(false);
        setWorldLoading(false);
      }
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const q = term.trim();
    const world = doors && !worldOff && q.length >= MIN_WORLD_CHARS;
    const handle = setTimeout(() => void run(q, world), world ? WORLD_DEBOUNCE : CATALOGUE_DEBOUNCE);
    return () => clearTimeout(handle);
  }, [term, open, doors, worldOff, kindsKey, run]);

  const trimmed = term.trim();
  const shownFor = result?.term ?? "";

  /** Every row the keyboard walks, in the order they are drawn. */
  const rows = React.useMemo<Row[]>(() => {
    if (!result) return [];
    const out: Row[] = [
      ...result.recent.map((place) => ({ type: "place" as const, place, group: "recent" as const })),
      ...result.places.map((place) => ({ type: "place" as const, place, group: "places" as const })),
      ...result.popular.map((place) => ({ type: "place" as const, place, group: "popular" as const })),
      ...result.provider.results.map((suggestion) => ({ type: "suggestion" as const, suggestion })),
    ];
    // "As written" is a real answer, so it is a row — last, and only when
    // nothing offered already IS what they typed.
    if (result.term.length >= 2 && !result.has_exact) out.push({ type: "typed", text: result.term });
    return out;
  }, [result]);

  function choose(row: Row | undefined) {
    if (!row) return;
    if (row.type === "place") onPick(placeValue(row.place));
    else if (row.type === "suggestion") onPick(suggestionValue(row.suggestion, shownFor));
    else onPick(typedValue(row.text));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const n = rows.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!n) return;
      e.preventDefault();
      setActive((i) => (((i + (e.key === "ArrowDown" ? 1 : -1)) % n) + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[active]) choose(rows[active]);
      else if (trimmed.length >= 2) onPick(typedValue(trimmed));
    }
  }

  const places = result?.places.length || 0;
  const offered = (result?.recent.length || 0) + places;
  const canSearchWorld =
    !doors &&
    !worldOff &&
    !!result &&
    result.term.length >= MIN_WORLD_CHARS &&
    !result.has_exact &&
    !result.provider.requested &&
    offered <= THIN;
  const worldUnavailable = !!result && (result.provider.status === "UNAVAILABLE" || (doors && worldOff && trimmed.length >= MIN_WORLD_CHARS));
  const busy = loading || worldLoading;
  const status = busy
    ? worldLoading
      ? t("portal.place.searchingWorld")
      : t("portal.place.searching")
    : result
      ? t("portal.place.results", { count: rows.filter((r) => r.type !== "typed").length })
      : "";

  // Row indices by position, so each group can render its slice and still
  // share the one active index the keyboard moves.
  let index = -1;
  const renderGroup = (key: string, heading: string | null, items: Row[], note?: string) => {
    if (!items.length) return null;
    return (
      <div role="group" aria-labelledby={heading ? `${baseId}-${key}` : undefined} className="mt-3 first:mt-0">
        {heading ? (
          <p id={`${baseId}-${key}`} className="pt-place-group">
            {heading}
            {note ? <span className="mt-0.5 block text-xs font-normal normal-case tracking-normal">{note}</span> : null}
          </p>
        ) : null}
        {items.map((row) => {
          index += 1;
          const i = index;
          return <OptionRow key={rowKey(row)} row={row} id={`${baseId}-opt-${i}`} selected={i === active} term={shownFor} lang={lang} onHover={() => setActive(i)} onPick={() => choose(row)} />;
        })}
      </div>
    );
  };
  const byGroup = (g: "recent" | "places" | "popular") => rows.filter((r) => r.type === "place" && r.group === g);

  return (
    <Sheet open={open} onClose={onClose} title={title} full className="pt-place-sheet">
      <div className="sticky top-0 z-10 -mx-5 bg-[var(--pt-surface)] px-5 pb-3 pt-1">
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">
            {busy ? <span className="pt-spinner animate-spin" /> : <SearchIcon size={18} />}
          </span>
          <input
            data-autofocus
            type="text"
            className="pt-field pl-11 pr-12"
            value={term}
            placeholder={placeholder}
            aria-label={title}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={rows[active] ? `${baseId}-opt-${active}` : undefined}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={120}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {term ? (
            <button type="button" className="pt-icon-btn absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label={t("portal.place.clear")} onClick={() => setTerm("")}>
              <CloseIcon size={18} />
            </button>
          ) : null}
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {status}
        </p>
      </div>

      <div id={listId} role="listbox" aria-label={title}>
        {renderGroup("recent", t("portal.place.recent"), byGroup("recent"))}
        {renderGroup("places", t("portal.place.matches"), byGroup("places"))}
        {renderGroup("popular", t("portal.place.popular"), byGroup("popular"))}
        {renderGroup(
          "world",
          t("portal.place.world"),
          rows.filter((r) => r.type === "suggestion"),
          t("portal.place.worldNote"),
        )}
        {renderGroup("typed", null, rows.filter((r) => r.type === "typed"))}
      </div>

      {result && !busy && rows.length === 0 ? <p className="px-1 py-6 text-center text-sm text-muted-foreground">{shownFor ? t("portal.place.none") : placeholder}</p> : null}
      {failed ? <p className="mt-3 rounded-[14px] bg-[var(--pt-soft)] px-4 py-3 text-sm text-muted-foreground">{t("portal.place.failed")}</p> : null}
      {worldUnavailable && !failed ? <p className="mt-3 rounded-[14px] bg-[var(--pt-soft)] px-4 py-3 text-sm text-muted-foreground">{t("portal.place.unavailable")}</p> : null}

      {canSearchWorld ? (
        <button type="button" className="pt-btn pt-btn-outline pt-btn-block mt-4 !justify-start" onClick={() => void run(result.term, true)} disabled={worldLoading}>
          {worldLoading ? <span className="pt-spinner animate-spin" aria-hidden="true" /> : <GlobeIcon size={18} />}
          <span className="truncate">{t("portal.place.searchWorld", { term: result.term })}</span>
        </button>
      ) : null}
    </Sheet>
  );
}

function rowKey(row: Row): string {
  if (row.type === "place") return `${row.group}-${row.place.geo_place_id}`;
  if (row.type === "suggestion") return `s-${row.suggestion.provider_place_id}`;
  return "typed";
}

/** One option. The combobox owns keyboard state; a row only reports a press. */
function OptionRow({
  row,
  id,
  selected,
  term,
  lang,
  onHover,
  onPick,
}: {
  row: Row;
  id: string;
  selected: boolean;
  term: string;
  lang: string;
  onHover: () => void;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  let glyph: React.ReactNode;
  let name: string;
  let line: string | null;
  let code: string | null = null;
  const kindLabel = (k: string | null | undefined) => (k ? t(`portal.place.kind.${k}`, { defaultValue: "" }) : "");
  if (row.type === "place") {
    const p = row.place;
    glyph = <KindGlyph kind={p.kind} />;
    name = p.name;
    code = codeOf(p);
    line = placeLine(p, kindLabel(p.kind), lang);
  } else if (row.type === "suggestion") {
    const s = row.suggestion;
    glyph = <KindGlyph kind={s.kind} />;
    name = s.name || s.formatted || "";
    line = placeLine(s, kindLabel(s.kind), lang);
  } else {
    glyph = <PencilIcon size={18} />;
    name = t("portal.place.useTyped", { term: row.text });
    line = t("portal.place.useTypedHint");
  }
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={selected}
      // Named explicitly: the highlight splits the name into two text nodes
      // either side of a <mark>, and the computed name came out "Guang zhou
      // Baiyun" — which is what a screen reader would have said.
      aria-label={[name, line, code].filter(Boolean).join(", ")}
      tabIndex={-1}
      className="pt-place-option"
      data-typed={row.type === "typed" || undefined}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        // Keep focus in the input: the combobox pattern, and on a phone it
        // keeps the keyboard from dropping and re-rising under the tap.
        e.preventDefault();
      }}
      onClick={onPick}
    >
      <span className="pt-place-glyph">{glyph}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-foreground">{row.type === "typed" ? name : <Highlight text={name} term={term} />}</span>
        {line ? <span className="block truncate text-xs text-muted-foreground">{line}</span> : null}
      </span>
      {code ? <span className="pt-place-code pt-mono">{code}</span> : null}
    </button>
  );
}
