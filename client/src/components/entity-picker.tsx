/**
 * EntityPicker — server-searched, ACTIVE-only picker over `/entities`.
 *
 * PR-09 (audit CE-03 / CE-35, Decision Q6). Every entity picker used to fetch
 * `ENTITY_LIST = "/entities?limit=200"` — `page()`'s maximum — and filter those
 * rows in the browser, so entity 201 was unreachable from the client, supplier,
 * parent and corporate-shareholder pickers no matter what it was called. And
 * because the list was fetched by the FORM, every nested modal that contained a
 * picker re-fetched the whole tenant-wide list just to open.
 *
 * This component moves the search to the server, which has supported `q`
 * (ILIKE over code / legal name / trading name) and `registration_status`
 * filtering all along:
 *
 *   - SEARCH IS SERVER-SIDE. Typing queries `/entities?registration_status=
 *     ACTIVE&q=…&limit=20`, debounced 250 ms, cached by TanStack under the
 *     URL. Entity 201+ is as findable as entity 1.
 *   - LIFECYCLE RULE (Decision Q6): only ACTIVE entities are OFFERED for a new
 *     or current link. The server filter does the work; a client-side guard
 *     drops any non-ACTIVE row that reaches the results anyway, so a future
 *     caller cannot quietly reintroduce the prohibited states.
 *   - HISTORY IS VISIBLE. An EXISTING link to an entity that has since been
 *     deactivated is not offered as a choice, but it is not hidden either: the
 *     closed trigger names it with an inactive marker, and the open panel pins
 *     a "currently linked" note explaining that the link is kept as history —
 *     with the active entities right below it as the explicit replacement path.
 *   - THE THREE STATES A PICKER OWES ITS USER: loading, empty and error are
 *     all rendered (with a Retry on error) rather than collapsing into
 *     "No matches", which is what the old pattern showed for a failed fetch.
 *
 * ACCESSIBILITY: the WAI-ARIA 1.2 combobox-with-listbox pattern, the same one
 * `LegalFormPicker` and `SearchSelect` implement — `role="combobox"` trigger
 * with `aria-expanded`/`aria-controls`, a search input carrying
 * `aria-activedescendant` into a `role="listbox"`, Up/Down/Home/End to move,
 * Enter to commit, Escape to close, and a live region announcing the result
 * count so the results arriving is heard rather than seen.
 *
 * @example
 * <EntityPicker
 *   label="Parent entity"
 *   value={v.parent_entity_id || null}
 *   onChange={(id) => set("parent_entity_id", id ?? "")}
 *   excludeIds={[row.entity_id]}
 * />
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { tenant } from "@/lib/api-client";
import { tenantKey } from "@/lib/query-client";
import { useDebounced } from "@/lib/use-debounced";
import { enumLabel } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { Popover } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/** The slice of `api.Entity` the picker searches over and renders. */
export type EntityOption = {
  entity_id: string;
  code: string;
  legal_name: string;
  trading_name?: string | null;
  registration_status?: string | null;
  is_active?: boolean | null;
};

/**
 * The authoritative lifecycle, preferring the ladder (0515) over the legacy
 * boolean exactly the way every status pill in the module does.
 */
const entityLifecycleOf = (e: {
  registration_status?: string | null;
  is_active?: boolean | null;
}): string =>
  e.registration_status || (e.is_active ? "ACTIVE" : "DEACTIVATED");

const labelOf = (e: EntityOption): string =>
  e.code ? `${e.code} — ${e.legal_name}` : e.legal_name;

/** How long typing stays quiet before it costs a request. */
const SEARCH_DEBOUNCE_MS = 250;
/** One screenful of options — a popover is not a list page. */
const SEARCH_LIMIT = 20;

export function EntityPicker({
  value,
  onChange,
  label = tr("Corporate entity"),
  placeholder,
  disabled = false,
  allowEmpty = true,
  emptyLabel = tr("— none —"),
  excludeIds = [],
}: {
  /** The linked entity id, or null/"" for no link. */
  value?: string | null;
  onChange: (entityId: string | null) => void;
  /** Accessible name. Match the surrounding `<Field>` label. */
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Offer the "no entity" choice. Default true — every current call site is optional. */
  allowEmpty?: boolean;
  emptyLabel?: string;
  /**
   * Ids never offered, on top of the lifecycle rule: the entity itself (and
   * its descendants, where the caller knows them) in the parent pickers, which
   * the API rejects with a cycle 422 anyway — a picker that leads straight to
   * a 422 is a picker that should not have offered the option.
   */
  excludeIds?: string[];
}) {
  const reactId = React.useId();
  const listId = `${reactId}-entity-list`;

  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const [active, setActive] = React.useState(0);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const settledTerm = useDebounced(term.trim(), SEARCH_DEBOUNCE_MS);

  /*
   * Options this instance has already seen — from a search result or a
   * resolved current value. Kept so that picking a row and then closing the
   * popover does not cost a GET just to re-render the label of the entity the
   * user was just looking at.
   */
  const seenRef = React.useRef(new Map<string, EntityOption>());
  const seen = seenRef.current;

  const searchUrl =
    `/entities?registration_status=ACTIVE&limit=${SEARCH_LIMIT}` +
    (settledTerm ? `&q=${encodeURIComponent(settledTerm)}` : "");
  const search = useQuery({
    queryKey: tenantKey(searchUrl),
    queryFn: () => tenant<EntityOption[]>(searchUrl),
    enabled: open && !disabled,
    // Keep the previous page of results visible while a new term resolves —
    // blanking to a spinner on every keystroke reads as the data vanishing.
    placeholderData: (prev) => prev,
  });

  /*
   * The current value's own row, for the closed trigger and the history note.
   * Only fetched when the value is not one this instance has already seen; the
   * result is registered into `seen` so a reopen does not refetch it.
   */
  const currentId = value ? String(value) : "";
  const current = useQuery({
    queryKey: tenantKey(`/entities/${currentId}`),
    queryFn: () => tenant<EntityOption>(`/entities/${currentId}`),
    enabled: !!currentId && !seen.has(currentId) && !disabled,
    staleTime: 60_000,
  });
  if (current.data?.entity_id) seen.set(current.data.entity_id, current.data);

  const rawRows = Array.isArray(search.data) ? search.data : [];
  // Register every result row, then apply the two offering rules: ACTIVE only
  // (Decision Q6), and never an excluded id.
  for (const row of rawRows) seen.set(row.entity_id, row);
  const excluded = new Set(excludeIds);
  const offered = rawRows.filter(
    (e) => entityLifecycleOf(e) === "ACTIVE" && !excluded.has(e.entity_id),
  );

  const currentRow = currentId ? seen.get(currentId) ?? null : null;
  const currentLifecycle = currentRow ? entityLifecycleOf(currentRow) : null;

  const choices = React.useMemo(
    () => [...(allowEmpty && !settledTerm ? [null] : []), ...offered],
    [allowEmpty, settledTerm, offered],
  );

  React.useEffect(() => {
    setActive(0);
  }, [settledTerm]);

  React.useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  React.useEffect(() => {
    if (open) optionRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function pick(e: EntityOption | null) {
    onChange(e ? e.entity_id : null);
    setOpen(false);
    setTerm("");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!choices.length) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + direction + choices.length) % choices.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(choices.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(choices[active] ?? null);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  const error = search.error ?? null;
  const loading = search.data === undefined && !error && open;

  /** Announced as results arrive. */
  const status = error
    ? tr("Search failed.")
    : loading
      ? tr("Searching…")
      : choices.length === 0
        ? tr("No matches.")
        : `${choices.length} ${choices.length === 1 ? tr("result") : tr("results")}.`;

  const triggerLabel = currentRow
    ? labelOf(currentRow)
    : currentId
      ? tr("Loading…")
      : null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (!next) setTerm("");
      }}
      align="start"
      label={label}
      className="w-[min(30rem,calc(100vw-1.5rem))] p-0"
      onOpenAutoFocus={(event) => event.preventDefault()}
      trigger={
        <button
          type="button"
          role="combobox"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={disabled}
          className="flex min-h-9 w-full items-center justify-between gap-3 rounded-md border bg-transparent px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {triggerLabel ? (
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="truncate">{triggerLabel}</span>
              {currentLifecycle && currentLifecycle !== "ACTIVE" && (
                <span className="shrink-0 rounded-full bg-warn/10 px-1.5 py-0.5 text-[0.625rem] font-medium text-warn">
                  {enumLabel(currentLifecycle)} — history
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {placeholder || tr("Select an entity…")}
            </span>
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
              aria-label={tr("Search entity")}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={
                choices.length ? `${reactId}-entity-${active}` : undefined
              }
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={tr("Search code or name…")}
              className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {status}
          </p>
        </div>

        {/*
         * HISTORY, NOT A CHOICE (Decision Q6). An existing link to a
         * deactivated (or suspended/draft) entity is kept as-is — it is real
         * history — and this note says so in plain words, with the active
         * entities directly below it as the replacement path. It is not a
         * role="option": offering it would be offering a prohibited lifecycle
         * state for a NEW link, which is exactly what this PR exists to stop.
         */}
        {currentRow && currentLifecycle !== "ACTIVE" && (
          <div className="border-b bg-muted/40 px-3 py-2">
            <p className="text-xs font-medium text-foreground">
              {tr("Currently linked")}: {labelOf(currentRow)}
            </p>
            <p className="micro text-muted-foreground">
              {enumLabel(currentLifecycle)} —{" "}
              {tr(
                "this link is kept as history. Only active entities can be newly linked; pick one below to replace it.",
              )}
            </p>
          </div>
        )}

        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} ${tr("results")}`}
          className="m-0 max-h-72 list-none overflow-y-auto p-1"
        >
          {choices.map((e, index) => {
            const isSelected = !!e && e.entity_id === currentId;
            return (
              <li role="presentation" key={e?.entity_id || "empty"}>
                <button
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  type="button"
                  id={`${reactId}-entity-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-label={e ? labelOf(e) : emptyLabel}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => pick(e)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm",
                    index === active ? "bg-muted" : "hover:bg-muted/70",
                  )}
                >
                  {e ? (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">
                          {e.legal_name}
                        </span>
                        <span className="micro block truncate text-muted-foreground">
                          {e.code}
                          {e.trading_name && e.trading_name !== e.legal_name
                            ? ` · ${e.trading_name}`
                            : ""}
                        </span>
                      </span>
                      {isSelected && (
                        <span aria-hidden className="shrink-0 text-primary-ink">
                          ✓
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="flex-1 py-0.5 text-muted-foreground">
                      {emptyLabel}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {error ? (
          <div className="border-t px-3 py-3">
            <p className="text-sm text-foreground">
              {tr("Couldn't load entities.")}
            </p>
            <p className="micro text-muted-foreground">
              {error instanceof Error ? error.message : String(error)}
            </p>
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => void search.refetch()}
            >
              {tr("Retry")}
            </Button>
          </div>
        ) : loading ? (
          <p
            role="status"
            className="border-t px-3 py-3 text-sm text-muted-foreground"
          >
            {tr("Searching entities…")}
          </p>
        ) : choices.length === 0 ? (
          <div className="border-t px-4 py-5 text-center">
            <p className="text-sm font-medium text-foreground">
              {tr("No active entity matches")}
              {settledTerm ? ` “${settledTerm}”` : ""}
            </p>
            <p className="micro mt-1 text-muted-foreground">
              {tr(
                "Try a code, legal name or trading name. Only active entities are offered.",
              )}
            </p>
          </div>
        ) : null}

        <div className="border-t px-3 py-2 text-[0.6875rem] text-muted-foreground">
          {tr("Only active entities are offered for new links.")}
        </div>
      </section>
    </Popover>
  );
}
