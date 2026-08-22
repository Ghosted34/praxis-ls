/**
 * LegalFormPicker — country-aware, closed selection over ISO 20275 + OHADA.
 *
 * It never accepts free text. The selected country determines the catalogue;
 * typing only filters local names, transliterations, abbreviations, ELF codes
 * and (for federations such as the US) state/province jurisdictions.
 */
import * as React from "react";
import {
  countries,
  legalForms,
  type LegalForm,
  type LegalFormReference,
} from "@shared";
import { Popover } from "@/components/ui/popover";
import { flagOf } from "@/components/smart-country-picker";
import { cn } from "@/lib/cn";

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// The US catalogue has 729 forms. Keeping every row searchable while rendering
// at most 200 avoids a 700-button DOM burst when the popover opens.
const MAX_RENDERED = 200;

const KIND_NOTE: Partial<Record<LegalForm["kind"], string>> = {
  REGISTERED_BUSINESS: "Registered business; not a separate legal person",
  UNINCORPORATED: "Unincorporated; no separate legal personality",
  ESTABLISHMENT: "Establishment of another legal person",
};

function searchIndex(form: LegalForm): string {
  return normalize(
    [
      form.code,
      form.abbreviation,
      form.name,
      form.country_name,
      form.jurisdiction_code,
      form.jurisdiction_name,
      ...form.aliases,
    ].join(" "),
  );
}

export type LegalFormSelection = Pick<
  LegalForm,
  "code" | "source" | "jurisdiction_code" | "abbreviation" | "name" | "kind"
>;

export function LegalFormPicker({
  countryCode,
  value,
  reference,
  onChange,
  label = "Legal form",
  allowEmpty = true,
  disabled = false,
}: {
  countryCode?: string | null;
  /** Printable legacy value (`SARL`, `GmbH`, `LLC`), retained for documents. */
  value?: string | null;
  reference?: LegalFormReference;
  onChange: (selection: LegalFormSelection | null) => void;
  label?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
}) {
  const reactId = React.useId();
  const listId = `${reactId}-legal-form-list`;
  const country = String(countryCode || "").toUpperCase();
  const countryRow = countries.byCode(country);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const forms = React.useMemo(
    () => (country ? [...legalForms.forCountry(country)] : []),
    [country],
  );
  const selected = React.useMemo(
    () =>
      (reference?.code
        ? legalForms.byReference({ ...reference, countryCode: country })
        : undefined) ||
      (value ? legalForms.matchStored(country, value) : undefined),
    [country, reference, value],
  );

  const indexed = React.useMemo(
    () => forms.map((form) => ({ form, search: searchIndex(form) })),
    [forms],
  );
  const filtered = React.useMemo(() => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return forms;
    return indexed
      .filter(({ search }) => terms.every((term) => search.includes(term)))
      .map(({ form }) => form);
  }, [forms, indexed, query]);
  const visible = React.useMemo(() => {
    const first = filtered.slice(0, MAX_RENDERED);
    if (
      selected &&
      filtered.some((form) => form.key === selected.key) &&
      !first.some((form) => form.key === selected.key)
    ) {
      return [selected, ...first.slice(0, MAX_RENDERED - 1)];
    }
    return first;
  }, [filtered, selected]);
  const choices = React.useMemo<Array<LegalForm | null>>(
    () => [...(allowEmpty && !query.trim() ? [null] : []), ...visible],
    [allowEmpty, query, visible],
  );

  React.useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [country]);

  React.useEffect(() => {
    if (open) requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const next =
      !query.trim() && selected
        ? choices.findIndex((form) => form?.key === selected.key)
        : 0;
    setActive(next >= 0 ? next : 0);
  }, [choices, open, query, selected]);

  React.useEffect(() => {
    if (open) optionRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (form: LegalForm | null) => {
    onChange(
      form
        ? {
            code: form.code,
            source: form.source,
            jurisdiction_code: form.jurisdiction_code,
            abbreviation: form.abbreviation,
            name: form.name,
            kind: form.kind,
          }
        : null,
    );
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
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

  const unavailable = disabled || !country;
  const resultText = query.trim()
    ? `${filtered.length} match${filtered.length === 1 ? "" : "es"}`
    : `${forms.length} verified form${forms.length === 1 ? "" : "s"}`;
  let previousJurisdiction = "";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (unavailable) return;
        setOpen(next);
        if (!next) setQuery("");
      }}
      align="start"
      label={label}
      className="w-[min(38rem,calc(100vw-1.5rem))] p-0"
      trigger={
        <button
          type="button"
          role="combobox"
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={unavailable}
          className="flex min-h-9 w-full items-center justify-between gap-3 rounded-md border bg-transparent px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selected ? (
            <span className="flex min-w-0 flex-1 items-baseline gap-2">
              <span className="shrink-0 font-semibold">
                {selected.abbreviation}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {selected.name}
              </span>
            </span>
          ) : value ? (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate">{value}</span>
              <span className="shrink-0 rounded-full bg-warn/10 px-1.5 py-0.5 text-[0.625rem] font-medium text-warn">
                Review selection
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              {country ? "Select a legal form…" : "Select a country first…"}
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
          <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <span aria-hidden>{flagOf(country)}</span>
            <span className="font-medium text-foreground">
              {countryRow?.name || country}
            </span>
            <span>·</span>
            <span>{resultText}</span>
          </div>
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
                choices.length ? `${reactId}-legal-form-${active}` : undefined
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search abbreviation, name, code or jurisdiction…"
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
          {choices.map((form, index) => {
            const showJurisdiction =
              form && form.jurisdiction_code !== previousJurisdiction;
            if (form) previousJurisdiction = form.jurisdiction_code;
            const isSelected = form
              ? form.key === selected?.key
              : !value && !reference?.code;
            const kindNote = form ? KIND_NOTE[form.kind] : undefined;

            return (
              <React.Fragment key={form?.key || "empty"}>
                {showJurisdiction && (
                  <li
                    role="presentation"
                    className="sticky top-0 z-10 flex items-center justify-between bg-popover px-2 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    <span>{form.jurisdiction_name}</span>
                    <span className="normal-case tracking-normal">
                      {form.jurisdiction_code}
                    </span>
                  </li>
                )}
                <li role="presentation">
                  <button
                    ref={(node) => {
                      optionRefs.current[index] = node;
                    }}
                    type="button"
                    id={`${reactId}-legal-form-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-label={
                      form
                        ? `${form.abbreviation}, ${form.name}, ${form.jurisdiction_name}, ${form.code}`
                        : "No legal form"
                    }
                    onMouseEnter={() => setActive(index)}
                    onClick={() => pick(form)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-md px-2 py-2 text-left text-sm",
                      index === active ? "bg-muted" : "hover:bg-muted/70",
                    )}
                  >
                    {form ? (
                      <>
                        <span className="min-w-16 max-w-28 shrink-0 rounded-md bg-primary/10 px-2 py-1 text-center text-xs font-semibold text-primary-ink">
                          {form.abbreviation}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-foreground">
                            {form.name}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {form.source === legalForms.SOURCE_ISO
                              ? `ISO 20275 · ELF ${form.code}`
                              : `${form.source} · ${form.code}`}
                            {kindNote ? ` · ${kindNote}` : ""}
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
                        <span className="min-w-16 shrink-0 rounded-md bg-muted px-2 py-1 text-center text-xs text-muted-foreground">
                          —
                        </span>
                        <span className="flex-1 py-1 text-muted-foreground">
                          No legal form
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

        {filtered.length > visible.length && (
          <div className="border-t border-dashed px-4 py-2 text-center text-xs text-muted-foreground">
            Showing the first {visible.length} of {filtered.length}. Type a
            name, abbreviation, state, or province to narrow the list.
          </div>
        )}

        {forms.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-medium text-foreground">
              No Phase 1 forms verified for {countryRow?.name || country}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              This country is queued for the country-by-country Phase 2 review.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-medium text-foreground">
              No legal form found
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try an abbreviation, local name, ELF code, state, or province.
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-1 border-t px-3 py-2 text-[0.6875rem] text-muted-foreground">
          <span>{resultText}</span>
          <span>
            ISO 20275 v{legalForms.GLEIF_VERSION}
            {legalForms.OHADA_MEMBERS.includes(country) ? " + OHADA" : ""}
          </span>
        </div>
      </section>
    </Popover>
  );
}
