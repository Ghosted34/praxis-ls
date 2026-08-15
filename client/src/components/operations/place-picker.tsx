/**
 * PlacePicker — how a location gets onto a file.
 *
 * ── THE PROBLEM IT REPLACES ─────────────────────────────────────────────────
 *
 * Every origin and destination on this product used to be a text box with a
 * typeahead that also accepted whatever you typed. That is two failures wearing
 * one control. First, a typo saved cleanly: "Doula" is one letter from Cameroon's
 * main port, and the save path then forward-geocoded it in the background, got a
 * confident wrong answer, and linked the file to a coordinate nobody had looked
 * at. Second, there was nothing in the UI that distinguished a port somebody
 * chose from the catalogue from a string somebody typed — so the map, the
 * itinerary and the Monday meeting all treated them as equally true.
 *
 * ── THE SHAPE OF THE ANSWER, AND WHY IT IS THIS SHAPE ───────────────────────
 *
 * A verified-places rule has to have an answer for every real case or operators
 * will route around it. There are four, and they are deliberately NOT four
 * equally-weighted options on screen — that would be a wall of choices in front
 * of a task that is usually one keystroke and one click:
 *
 *   1. THE CATALOGUE. Type, pick. 322 seeded ports, airports and terminals, so
 *      this is the answer almost every time, and it costs nothing.
 *   2. WORLDWIDE SEARCH. One button, and it appears only when the catalogue came
 *      back thin. Opt-in because it spends provider quota and because the
 *      decision to search the whole world should be one a person made.
 *   3. A NEARBY REFERENCE POINT. Not a separate flow at all — a toggle on the
 *      confirmation step, because the operator has usually already found the
 *      junction near the customer and just needs to say "this is near, not at".
 *   4. ADD IT BY HAND. A dialog, last in the list, permission-gated.
 *
 * Each step down that ladder is one interaction deeper than the last, and nothing
 * below step 1 is on screen until step 1 has visibly failed. That is the whole
 * design: the common case stays a two-key operation, and the hard case is
 * reachable without anybody having to know it exists in advance.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
 *
 * Commit free text. There is no "use what I typed" affordance, because that is
 * precisely the door this closes. An operator who cannot find their place gets
 * three escalating ways to create one instead — and the server enforces the same
 * rule (shipment_details.assertPlacesVerified), so the browser is the courtesy
 * and not the control.
 *
 * ── ACCESSIBILITY ──────────────────────────────────────────────────────────
 *
 * The WAI-ARIA 1.2 combobox-with-listbox pattern, as `SearchSelect` established
 * it here: `role="combobox"` with `aria-expanded`/`aria-controls`/
 * `aria-activedescendant`, a `role="listbox"` popup, Up/Down through results
 * (across BOTH groups, so keyboard users reach suggestions), Enter to commit,
 * Escape to close, and a polite live region announcing what arrived. Provider
 * text is rendered through React as text — never `innerHTML`, and no URL is ever
 * built from a provider field.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/cn";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";
import { LocationVerificationBadge } from "./location-verification-badge";
import { ManualPlaceDialog } from "./manual-place-dialog";
import { matchStoredValue, metaOfPlace, metaOfSuggestion, placeKey, verificationOf } from "./place-meta";
import { PlaceResultRow } from "./place-result";

/** Long enough that the catalogue query is not issued per keystroke, short
 *  enough that the list feels like it is tracking the typing. */
const DEBOUNCE_MS = 220;
/** The provider's own floor. Below this, "search worldwide" is not offered. */
const MIN_PROVIDER_CHARS = 3;
/** At or below this many catalogue hits, offer the worldwide search. Above it,
 *  the catalogue is clearly answering and the button would be noise. */
const THIN_RESULTS = 3;

/**
 * Resolved places, keyed by the normalised name — shared across every picker on
 * the page and across mounts.
 *
 * WHY A MODULE-LEVEL CACHE. A stored value is a NAME, so the badge cannot know
 * whether it is verified without asking. A sea form has three place fields, and
 * without this each one would ask on every open — and the two ends of an inland
 * file often name the same depot, which would then be asked for twice at once.
 * The answer is stable reference data, so caching it for the session is free
 * correctness. Cleared on a confirm or a manual create, because those are the
 * two moments the answer can change (see `rememberPlace`).
 */
const resolvedCache = new Map<string, api.GeoPlace | null>();

/** Record a place we just created, so its own picker and every other one on the
 *  page stop calling it unknown without a round trip. */
function rememberPlace(place: api.GeoPlace) {
  resolvedCache.set(placeKey(place.name), place);
}

type Props = {
  /** The stored value: a place NAME, as the dossier column holds it. */
  value?: string | null;
  /** The place record behind `value`, when the caller has resolved one. Drives
   *  the verification badge and the "verify this" prompt for legacy text. */
  place?: api.GeoPlace | null;
  /** Accessible name. Match the surrounding `<Field>` label. */
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  /** Restrict the catalogue to these kinds — an airport field offers airports. */
  kinds?: api.PlaceKind[];
  /** Bias the manual-entry defaults and the provider filter to one country. */
  country?: string;
  /** May this user add a place by hand? Pass `useCanUseModule("MOD-29")`. */
  canCreate?: boolean;
  /** Commit. `place` is the verified record; `name` is what to store. */
  onSelect: (selection: { name: string; place: api.GeoPlace }) => void;
};

type Stage =
  | { kind: "browsing" }
  /** A provider suggestion is selected and awaiting confirmation. */
  | { kind: "confirming"; suggestion: api.PlaceSuggestion };

export function PlacePicker({
  value,
  place,
  label,
  placeholder,
  disabled,
  id,
  kinds,
  country,
  canCreate = false,
  onSelect,
}: Props) {
  const reactId = React.useId();
  const baseId = id ?? reactId;
  const listId = `${baseId}-listbox`;

  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [result, setResult] = React.useState<api.PlaceSearchResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [searchingWorld, setSearchingWorld] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  /**
   * A message that must OUTLIVE the next search.
   *
   * When a confirmation fails because the suggestion aged out of the provider's
   * ranking, the right recovery is to re-search — and `runSearch` clears `error`
   * on entry, which would wipe the only explanation the operator was going to
   * get. So the reason lives here instead, and is cleared when they act on it
   * (pick something, or type again) rather than when the app happens to refetch.
   */
  const [notice, setNotice] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<Stage>({ kind: "browsing" });
  const [asReference, setAsReference] = React.useState(false);
  const [manualOpen, setManualOpen] = React.useState(false);

  /**
   * The place behind `value`, when the caller did not supply one.
   *
   * `undefined` means "not looked up yet", so the badge stays quiet rather than
   * flashing "No place record" for a perfectly good port while the lookup is in
   * flight — a badge that briefly lies is worse than one that arrives late.
   */
  const [resolved, setResolved] = React.useState<api.GeoPlace | null | undefined>(undefined);

  const boxRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  /** Bumped on every new search so a slow response cannot overwrite a fast one
   *  issued after it — the classic typeahead race. */
  const requestSeq = React.useRef(0);

  /**
   * The two groups, and the flat list the keyboard walks.
   *
   * ONE memo over `result` rather than three over derived arrays: `result?.places
   * ?? []` is a new array identity on every render, so a memo keyed on it never
   * memoises anything and `active` would be reset by any unrelated re-render
   * mid-keyboard-navigation.
   *
   * The flat list spans BOTH groups deliberately — a keyboard user must be able to
   * reach a provider suggestion, and a second listbox they have to tab into is
   * how that stops happening in practice.
   */
  const { places, suggestions, rows } = React.useMemo(() => {
    const p = result?.places ?? [];
    const s = result?.provider?.results ?? [];
    return {
      places: p,
      suggestions: s,
      rows: [
        ...p.map((item) => ({ type: "place" as const, place: item })),
        ...s.map((item) => ({ type: "suggestion" as const, suggestion: item })),
      ],
    };
  }, [result]);

  /* ── the catalogue query ─────────────────────────────────────────────────── */

  const runSearch = React.useCallback(
    async (text: string, { provider }: { provider: boolean }) => {
      const seq = (requestSeq.current += 1);
      if (provider) setSearchingWorld(true);
      else setLoading(true);
      setError(null);
      try {
        const next = await api.searchGeoPlaces({
          q: text.trim() || undefined,
          kind: kinds && kinds.length ? kinds : undefined,
          country: country || undefined,
          limit: 12,
          provider,
        });
        if (seq !== requestSeq.current) return; // a newer search has taken over
        // Normalised at the boundary rather than trusted. A truncated response, a
        // proxy that returned a bare array, or an older server that predates the
        // `provider` block would otherwise crash the control mid-keystroke — and
        // a picker that white-screens is a worse failure than one that says it
        // found nothing.
        setResult({
          places: Array.isArray(next?.places) ? next.places : [],
          has_exact: next?.has_exact === true,
          provider: {
            requested: next?.provider?.requested === true,
            status: next?.provider?.status || "NOT_REQUESTED",
            message: next?.provider?.message ?? null,
            results: Array.isArray(next?.provider?.results) ? next.provider.results : [],
          },
        });
        setActive(0);
      } catch (e) {
        if (seq !== requestSeq.current) return;
        setResult(null);
        setError(errMsg(e));
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setSearchingWorld(false);
        }
      }
    },
    [kinds, country],
  );

  React.useEffect(() => {
    if (!open) return;
    // Never a provider call from typing. That is what the button is for.
    const handle = setTimeout(() => void runSearch(term, { provider: false }), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [term, open, runSearch]);

  /**
   * Resolve the stored value to its place, so the badge can tell the truth.
   *
   * Only when the caller did not pass one — the Control Tower and the dossier 360
   * already hold the record and pass it, which costs nothing. Failure is silent
   * and lands on `null`: an unreachable lookup means we do not KNOW the place is
   * verified, and "No place record" is the honest thing to show for that.
   */
  React.useEffect(() => {
    if (place !== undefined) return;
    const text = String(value || "").trim();
    if (!text) {
      setResolved(null);
      return;
    }
    const key = placeKey(text);
    if (resolvedCache.has(key)) {
      setResolved(resolvedCache.get(key) ?? null);
      return;
    }
    let live = true;
    api
      .searchGeoPlaces({ q: text, limit: 5 })
      .then((res) => {
        const hit = matchStoredValue(text, Array.isArray(res?.places) ? res.places : []);
        resolvedCache.set(key, hit);
        if (live) setResolved(hit);
      })
      .catch(() => live && setResolved(null));
    return () => {
      live = false;
    };
  }, [value, place]);

  /**
   * Close when the operator presses somewhere else — decided in the CAPTURE phase,
   * and that is the whole fix.
   *
   * ── THE BUG ─────────────────────────────────────────────────────────────────
   *
   * This listener used to be on the BUBBLE phase, which puts it after React's own
   * handler for the same event. Pressing a provider suggestion calls
   * `setStage({ kind: "confirming" })`; React flushes that synchronously for a
   * discrete event like mousedown, so the row the operator just pressed is
   * unmounted and replaced by the confirmation step. By the time this ran,
   * `e.target` was DETACHED — and `Node.contains()` on a detached node is false.
   * So the control read its own row as "outside" and closed itself.
   *
   * What that looked like: search for an address, find it, click it, and the popup
   * vanishes leaving an empty box. Nothing stored, nothing said. Catalogue rows hid
   * it completely, because `commit` calls `close()` itself and sets a value, so the
   * spurious close was invisible on the path everybody tests.
   *
   * It also only reproduced in a browser. Under jsdom the flush lands after this
   * listener, so the target was still attached and every test passed — which is
   * why the regression test below removes the target explicitly rather than hoping
   * the environment reproduces React's timing.
   *
   * Capture runs BEFORE React's handler, so the target is always still in the tree
   * and the question being asked is the one intended: "was the press inside this
   * control, as it was when the operator made it?"
   *
   * ── AND THE PORTAL ──────────────────────────────────────────────────────────
   *
   * `manualOpen` disables this outright. The manual-place dialog renders in a
   * portal, which is outside this element by construction, so every press inside
   * it — including on its own form fields — looked "outside" and collapsed the
   * picker behind the dialog.
   */
  React.useEffect(() => {
    if (!open || manualOpen) return;
    const onDoc = (e: MouseEvent) => {
      const box = boxRef.current;
      if (box && !box.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDoc, true);
    return () => document.removeEventListener("mousedown", onDoc, true);
  }, [open, manualOpen]);

  function close(restoreFocus = true) {
    setOpen(false);
    setTerm("");
    setResult(null);
    setStage({ kind: "browsing" });
    setAsReference(false);
    setError(null);
    setNotice(null);
    // The input unmounts when the popup closes, so without this a keyboard user
    // is dropped on <body> — the same WCAG 2.4.3 failure SearchSelect documents.
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function commit(picked: api.GeoPlace) {
    rememberPlace(picked);
    setResolved(picked);
    onSelect({ name: picked.name, place: picked });
    close();
  }

  /* ── confirming a provider suggestion ───────────────────────────────────── */

  async function confirm(suggestion: api.PlaceSuggestion, isReference: boolean) {
    setSearchingWorld(true);
    setError(null);
    try {
      const created = await api.confirmGeoPlace({
        // The same text the suggestion came from: the server re-runs this search
        // and takes the coordinate from the provider's own answer.
        query: term.trim(),
        provider_place_id: suggestion.provider_place_id,
        ...(suggestion.country ? { country: suggestion.country } : {}),
        ...(suggestion.kind ? { kind: suggestion.kind as api.PlaceKind } : {}),
        ...(isReference ? { is_reference_point: true } : {}),
      });
      commit(created);
    } catch (e) {
      // A suggestion that aged out of the provider's ranking lands here. Say so
      // and re-run the search rather than storing something nobody confirmed.
      setNotice(errMsg(e));
      setStage({ kind: "browsing" });
      void runSearch(term, { provider: true });
    } finally {
      setSearchingWorld(false);
    }
  }

  /* ── keyboard ───────────────────────────────────────────────────────────── */

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (stage.kind === "confirming") {
      if (e.key === "Escape") {
        e.preventDefault();
        setStage({ kind: "browsing" });
      }
      if (e.key === "Enter") {
        e.preventDefault();
        void confirm(stage.suggestion, asReference);
      }
      return;
    }
    const n = rows.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!n) return;
      e.preventDefault();
      setActive((i) => (((i + (e.key === "ArrowDown" ? 1 : -1)) % n) + n) % n);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (!row) return;
      // Enter on a catalogue row commits. Enter on a suggestion opens the
      // confirmation step — it cannot commit directly, because confirming is
      // what turns a provider guess into a place.
      if (row.type === "place") commit(row.place);
      else setStage({ kind: "confirming", suggestion: row.suggestion });
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  /* ── what the popup says ────────────────────────────────────────────────── */

  const trimmed = term.trim();
  const searched = result !== null;
  const thin = searched && places.length <= THIN_RESULTS && !result.has_exact;
  const canSearchWorld = trimmed.length >= MIN_PROVIDER_CHARS && thin && !result.provider.requested;
  const providerFailed = result?.provider.requested && result.provider.status !== "OK";
  const nothingAnywhere = searched && rows.length === 0;

  const status = loading
    ? "Searching the catalogue…"
    : searchingWorld
      ? "Searching worldwide…"
      : !searched
        ? ""
        : rows.length === 0
          ? "No places matched."
          : `${places.length} catalogue ${places.length === 1 ? "place" : "places"}${
              suggestions.length ? `, ${suggestions.length} to confirm` : ""
            }.`;

  // The caller's record wins; otherwise our own lookup. `undefined` on both
  // means the answer has not arrived, and the badge waits rather than guessing.
  const effectivePlace = place !== undefined ? place : resolved;
  const state = verificationOf(effectivePlace);
  const knownYet = effectivePlace !== undefined;
  const showLegacyPrompt = !!value && knownYet && !effectivePlace;

  return (
    <div ref={boxRef} className="relative">
      {!open ? (
        <div className="space-y-1">
          <button
            ref={triggerRef}
            type="button"
            id={baseId}
            disabled={disabled}
            aria-label={label}
            onClick={() => {
              setOpen(true);
              setResult(null);
              // Seed the search with the current value so a legacy string is one
              // keystroke from being upgraded rather than retyped.
              setTerm(value || "");
            }}
            className="flex w-full items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className={cn("min-w-0 truncate", value ? "text-foreground" : "text-muted-foreground")}>
              {value || placeholder || "Search a place…"}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {value && knownYet && <LocationVerificationBadge state={state} />}
              <span aria-hidden className="text-muted-foreground">
                ▾
              </span>
            </span>
          </button>
          {showLegacyPrompt && (
            <p className="micro text-muted-foreground">
              Text only — not linked to a place, so it will not appear on the map.{" "}
              <span className="font-medium text-primary-ink">Open the search to fix it.</span>
            </p>
          )}
          {state === "unverified" && (
            <p className="micro text-muted-foreground">
              Resolved automatically and never confirmed. Open the search to check it.
            </p>
          )}
        </div>
      ) : (
        <input
          /*
           * Focus management, not an unsolicited grab: opening REPLACES the
           * trigger button with this input, so the focused element ceases to
           * exist. The APG combobox pattern requires focus on the input while it
           * is open.
           */
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          id={baseId}
          role="combobox"
          aria-label={label}
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            stage.kind === "browsing" && rows[active] ? `${baseId}-opt-${active}` : undefined
          }
          value={term}
          placeholder={placeholder || "Type a port, airport, city or address…"}
          onChange={(e) => {
            setTerm(e.target.value);
            setStage({ kind: "browsing" });
            setNotice(null);
          }}
          onKeyDown={onKeyDown}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
        />
      )}

      {open && (
        <div className="absolute z-50 mt-1 max-h-[22rem] w-full overflow-auto rounded-lg border bg-popover p-1.5 shadow-lg">
          <p role="status" aria-live="polite" className="sr-only">
            {status}
          </p>

          {stage.kind === "confirming" ? (
            <ConfirmStep
              suggestion={stage.suggestion}
              asReference={asReference}
              onToggleReference={setAsReference}
              busy={searchingWorld}
              error={error}
              onBack={() => setStage({ kind: "browsing" })}
              onConfirm={() => void confirm(stage.suggestion, asReference)}
            />
          ) : (
            <>
              {(loading || searchingWorld) && (
                <p className="px-2.5 py-2 text-sm text-muted-foreground">{status}</p>
              )}

              <ul id={listId} role="listbox" aria-label={label ? `${label} results` : "Places"} className="m-0 list-none p-0">
                {!loading &&
                  rows.map((row, i) =>
                    row.type === "place" ? (
                      <li key={`p-${row.place.geo_place_id}`} role="none">
                        <PlaceResultRow
                          meta={metaOfPlace(row.place)}
                          id={`${baseId}-opt-${i}`}
                          selected={i === active}
                          onHover={() => setActive(i)}
                          onPick={() => commit(row.place)}
                        />
                      </li>
                    ) : (
                      <li key={`s-${row.suggestion.provider_place_id}`} role="none">
                        {i === places.length && (
                          <p className="px-2.5 pb-1 pt-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                            From worldwide search — confirm to use
                          </p>
                        )}
                        <PlaceResultRow
                          meta={metaOfSuggestion(row.suggestion)}
                          id={`${baseId}-opt-${i}`}
                          selected={i === active}
                          onHover={() => setActive(i)}
                          onPick={() => setStage({ kind: "confirming", suggestion: row.suggestion })}
                        />
                      </li>
                    ),
                  )}
              </ul>

              {notice && (
                <div className="px-1 py-1.5">
                  <Callout tone="warn" title="That place was not saved">
                    {notice}
                  </Callout>
                </div>
              )}

              {error && !loading && (
                <div className="px-1 py-1.5">
                  <Callout tone="bad" title="Search failed">
                    {error}
                  </Callout>
                </div>
              )}

              {providerFailed && result.provider.message && (
                <div className="px-1 py-1.5">
                  <Callout tone="warn" title="Worldwide search unavailable">
                    {result.provider.message}
                  </Callout>
                </div>
              )}

              {nothingAnywhere && !result.provider.requested && trimmed.length < MIN_PROVIDER_CHARS && (
                <p className="px-2.5 py-2 text-sm text-muted-foreground">
                  Nothing in the catalogue. Type at least {MIN_PROVIDER_CHARS} characters to search
                  worldwide.
                </p>
              )}

              {/*
                The escalation ladder, and it only appears once the catalogue has
                visibly come up short. Rendered as a footer rather than as list
                options so Up/Down never lands on an action the operator did not
                mean to trigger.
              */}
              {(canSearchWorld || nothingAnywhere) && (
                <div className="mt-1 space-y-1 border-t pt-1.5">
                  {canSearchWorld && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="w-full justify-start"
                      loading={searchingWorld}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        void runSearch(term, { provider: true });
                      }}
                    >
                      Search worldwide for “{trimmed}”
                    </Button>
                  )}
                  {canCreate ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="w-full justify-start"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setManualOpen(true);
                      }}
                    >
                      ＋ Add “{trimmed || "a place"}” by hand
                    </Button>
                  ) : (
                    nothingAnywhere && (
                      <p className="px-2.5 py-1.5 text-micro normal-case text-muted-foreground">
                        Still nothing? Someone with permission to add operations reference data can
                        create this place.
                      </p>
                    )
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <ManualPlaceDialog
        open={manualOpen}
        defaults={{
          name: trimmed || undefined,
          kind: kinds && kinds.length ? kinds[0] : undefined,
          country: country || undefined,
        }}
        onClose={() => setManualOpen(false)}
        onCreated={(created) => {
          setManualOpen(false);
          commit(created);
        }}
      />
    </div>
  );
}

/**
 * The confirmation step for a provider suggestion.
 *
 * WHY IT IS A STEP AND NOT A CLICK. Picking a catalogue place is choosing
 * something a human already vetted. Picking a provider result is asserting that
 * an algorithm's guess is right — and that assertion is what gets stored and
 * reused by every future file. So it gets one screen showing exactly what is
 * about to be saved, plus the one question only the operator can answer: is this
 * the place, or somewhere near it?
 */
function ConfirmStep({
  suggestion,
  asReference,
  onToggleReference,
  busy,
  error,
  onBack,
  onConfirm,
}: {
  suggestion: api.PlaceSuggestion;
  asReference: boolean;
  onToggleReference: (next: boolean) => void;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const confidence = typeof suggestion.confidence === "number" ? Math.round(suggestion.confidence * 100) : null;
  return (
    <div className="space-y-3 p-1.5">
      <div>
        <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">
          Confirm this place
        </p>
        <p className="mt-1 text-sm font-medium text-foreground">{suggestion.name}</p>
        {suggestion.formatted && (
          <p className="text-micro normal-case text-muted-foreground">{suggestion.formatted}</p>
        )}
        <p className="mt-1 text-micro normal-case text-muted-foreground">
          {[
            suggestion.country,
            suggestion.kind ? api.PLACE_KIND_LABEL[suggestion.kind as api.PlaceKind] || suggestion.kind : null,
            confidence !== null ? `${confidence}% provider confidence` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <Checkbox
        checked={asReference}
        onCheckedChange={(c: boolean) => onToggleReference(c === true)}
        label="This is near the real place, not the exact spot"
      />
      <p className="micro text-muted-foreground">
        Tick this and it is saved as a reference point. The file keeps your delivery instructions;
        the map stops claiming a precision nobody promised.
      </p>

      {error && <Callout tone="bad" title="Could not save it">{error}</Callout>}

      <div className="flex gap-2">
        <Button type="button" size="sm" variant="ghost" onMouseDown={(e) => { e.preventDefault(); onBack(); }} disabled={busy}>
          Back
        </Button>
        <Button type="button" size="sm" loading={busy} onMouseDown={(e) => { e.preventDefault(); onConfirm(); }}>
          Use this place
        </Button>
      </div>
    </div>
  );
}
