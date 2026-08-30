import * as React from "react";
import { cn } from "@/lib/cn";
import { tStatic } from "@/lib/i18n";
import { Spinner } from "@/components/state";
import { SearchIcon } from "@/components/ui/icons";
import {
  placeLabel,
  searchPlaces,
  type PlaceCandidate,
  type PlacePick,
} from "@/lib/places-api";

/**
 * A place field that suggests, and degrades to a text field that does not.
 *
 * ── THE DEGRADATION IS THE FEATURE ─────────────────────────────────────────
 *
 * `/public/places` answers `UNAVAILABLE` for a missing key, a rejected key, an
 * exhausted quota or a slow provider — the tenant may simply never have
 * configured Geoapify. When that happens this stays a working text input and
 * the wizard stays submittable, because the typed text is what the desk reads
 * and the pin was always enrichment. A picker that blocked the form when its
 * provider was down would lose enquiries to a nicety.
 *
 * ── WHY IT DOES NOT SEARCH ON EVERY KEYSTROKE ──────────────────────────────
 *
 * A request per keystroke is how their site spends someone else's quota and
 * ours would spend a key we pay for; the endpoint allows 60 per 15 minutes and
 * "Douala" alone is six. A 350 ms debounce turns a typed place name into one or
 * two requests, and the in-flight one is aborted when the next starts so a slow
 * answer cannot overwrite a newer one.
 *
 * ── WHAT IS SENT WHEN A SUGGESTION IS CHOSEN ───────────────────────────────
 *
 * The provider's id and the text that produced it — never the coordinates the
 * list displayed. The server re-asks the provider on submit and stores ITS
 * answer, so this component cannot make a claim about where anywhere is.
 *
 * Typing after choosing CLEARS the pick. Otherwise a visitor picks "Douala",
 * edits it to "Douala, Bonabéri terminal", and files a request whose pin says
 * something the text does not.
 *
 * `role="combobox"` with `aria-activedescendant` rather than moving focus into
 * the list: focus must stay in the input so the visitor can keep typing, which
 * is the whole ARIA combobox pattern and the reason the arrow keys are handled
 * here rather than by the browser.
 */
export function PlaceInput({
  id,
  label,
  value,
  onChange,
  onPick,
  error,
  hint,
  required,
  placeholder,
  country,
  className,
}: {
  id: string;
  label: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  /** Fires with the pick, or with null when the text stops matching it. */
  onPick: (pick: PlacePick | null) => void;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  placeholder?: string;
  country?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<PlaceCandidate[]>([]);
  const [available, setAvailable] = React.useState(true);
  const [active, setActive] = React.useState(-1);
  const [picked, setPicked] = React.useState<string | null>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  // The query the list currently describes. Held in a ref so the effect below
  // does not re-run on its own writes.
  const shownFor = React.useRef("");

  React.useEffect(() => {
    const q = value.trim();
    // Already showing this exact list (the visitor just picked from it), or too
    // short for the endpoint to spend a request on.
    if (q === shownFor.current || q.length < 3 || !available) {
      if (q.length < 3) setResults([]);
      return;
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      searchPlaces(q, { country, signal: ctl.signal })
        .then((r) => {
          shownFor.current = q;
          if (r.status === "UNAVAILABLE") {
            // Once, and for the life of the form. Re-asking a provider that is
            // out of quota on every field spends the rate limit to learn the
            // same thing.
            setAvailable(false);
            setResults([]);
            return;
          }
          setResults(r.results);
          setActive(-1);
          setOpen(r.results.length > 0);
        })
        .catch(() => {
          // An aborted request is the normal case here, not a failure. Either
          // way the field keeps working as text.
        })
        .finally(() => setBusy(false));
    }, 350);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [value, country, available]);

  // A click outside closes the list. Pointerdown rather than click so it fires
  // before the input's blur repaints anything.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function choose(c: PlaceCandidate) {
    const label = placeLabel(c);
    shownFor.current = label.trim();
    setPicked(c.provider_place_id);
    onChange(label);
    onPick({
      provider_place_id: c.provider_place_id,
      query: label,
      country: c.country || undefined,
    });
    setOpen(false);
    setActive(-1);
  }

  function edit(v: string) {
    onChange(v);
    // The pin described the old text. Keeping it would file a request whose
    // coordinates say something the words do not.
    if (picked) {
      setPicked(null);
      onPick(null);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) {
      if (e.key === "ArrowDown" && results.length > 0) setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      // Only when something is highlighted — otherwise Enter must submit the
      // step, which is what a visitor who typed a place we do not list expects.
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  const listId = `${id}-listbox`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cn("min-w-0", className)} ref={boxRef}>
      <label className="field-label" htmlFor={id}>
        {label}
        {required && (
          <span className="ml-1 text-[var(--primary-ink)]" aria-hidden>
            *
          </span>
        )}
      </label>
      <div className="relative">
        <input
          id={id}
          value={value}
          required={required}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => edit(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="field aria-[invalid=true]:border-[rgb(var(--bad))] pr-9"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        >
          {busy ? <Spinner className="h-4 w-4" /> : <SearchIcon size={16} />}
        </span>

        {open && results.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label={tStatic("site.quote.placeSuggestions")}
            // `lux-card` rather than a hand-rolled panel: it is the one recipe
            // that already carries the surface, border and shadow tokens, so a
            // tenant re-brand moves this popover with everything else.
            className="lux-card absolute z-30 mt-1 max-h-64 w-full overflow-auto py-1"
          >
            {results.map((c, i) => (
              <li
                key={c.provider_place_id}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                // Pointerdown, not click: click fires after blur, and blur has
                // already closed the list.
                onPointerDown={(e) => {
                  e.preventDefault();
                  choose(c);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "cursor-pointer px-3 py-2 text-sm",
                  i === active && "bg-[rgb(var(--ink)/0.06)]",
                )}
              >
                <span className="block truncate font-medium">{c.name || placeLabel(c)}</span>
                {c.formatted && c.formatted !== c.name && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.formatted}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
