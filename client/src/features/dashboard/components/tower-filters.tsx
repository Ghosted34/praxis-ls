/**
 * Control Tower filter bar — server-backed filters with stable cursor paging.
 *
 * The dashboard owns the query state; this component only edits a local draft and
 * applies it deliberately, so typing a territory or date does not issue a request
 * on every keystroke. The service-type list is read from the same registry used by
 * dossier creation, keeping the filter vocabulary in sync with operations data.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Select } from "@/components/ui/modal";
import { useList } from "@/lib/use-resource";
import type { ServiceType } from "@/lib/operations-api";
import type { ControlTowerFilters } from "../use-control-tower";
import { cn } from "@/lib/cn";
import { ChevronIcon } from "@/app/layout/nav-icons";

type TowerPage = {
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
};

type Props = {
  value: ControlTowerFilters;
  page: TowerPage;
  onChange: (next: ControlTowerFilters) => void;
};

const MODES = [
  { value: "", label: "All modes" },
  { value: "AIR", label: "Air" },
  { value: "SEA", label: "Sea" },
  { value: "LAND", label: "Land" },
  { value: "RAIL", label: "Rail" },
  // A real answer, not a catch-all: warehousing, brokerage and business
  // representation move nothing, and the server derives this from the file's
  // itinerary rather than guessing from the service-type name.
  { value: "OTHER", label: "No transport" },
] as const;

/**
 * Movement work versus facility work.
 *
 * Server-side, like every other filter here, and for the reason the header note
 * gives: a layer filtered in the browser would leave the counts and the pager
 * describing a different set from the list.
 */
const LAYERS = [
  { value: "", label: "Everything" },
  { value: "MOVEMENT", label: "On the move" },
  { value: "ACTIVITY", label: "At a facility" },
] as const;

/**
 * The location-needed queue, as a filter.
 *
 * This is the one an operations lead uses on a Monday: show me the open files
 * whose origin or destination is not a verified place, because those are the ones
 * the map cannot honestly draw and somebody has to fix.
 */
const VERIFICATION = [
  { value: "", label: "Any location" },
  { value: "VERIFIED", label: "Verified only" },
  { value: "UNVERIFIED", label: "Needs a location" },
] as const;

const DATE_FIELDS = [
  { value: "created", label: "Created date" },
  { value: "updated", label: "Updated date" },
  { value: "arrival", label: "Planned arrival" },
  { value: "delivery", label: "Planned delivery" },
] as const;

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

export function TowerFilters({ value, page, onChange }: Props) {
  const { rows: serviceTypes } = useList<ServiceType>("/service-types");
  const [draft, setDraft] = React.useState<ControlTowerFilters>(value);
  // Mobile-only collapsible: filters occupy a full viewport on a phone, so the
  // section starts collapsed and can be expanded. Desktop is unaffected — the
  // grid is always visible there (hidden lg:grid pattern), so the toggle
  // itself is lg:hidden. Default collapsed avoids the screenshot-1 wall of
  // inputs; a user who filters often expands once per session.
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  function set<K extends keyof ControlTowerFilters>(
    key: K,
    next: ControlTowerFilters[K],
  ) {
    setDraft((current) => ({ ...current, [key]: next }));
  }

  function apply() {
    const next: ControlTowerFilters = { ...draft, cursor: null };
    for (const key of Object.keys(next) as (keyof ControlTowerFilters)[]) {
      const current = next[key];
      if (current === "" || current === null || current === undefined)
        delete next[key];
    }
    onChange(next);
  }

  function reset() {
    setDraft({});
    onChange({});
  }

  const completion =
    draft.include_completed === undefined
      ? ""
      : String(draft.include_completed);

  // Count of applied filters for the collapsed summary / toggle badge.
  const appliedCount = React.useMemo(() => {
    const v = value as Record<string, unknown>;
    let n = 0;
    if (v.mode) n += 1;
    if (v.territory) n += 1;
    if (v.service_type_id) n += 1;
    if (v.date_field && v.date_field !== "created") n += 1;
    if (v.from) n += 1;
    if (v.to) n += 1;
    if (v.layer) n += 1;
    if (v.verified) n += 1;
    if (v.include_completed !== undefined) n += 1;
    if (v.limit && v.limit !== page.limit) n += 1;
    return n;
  }, [value, page.limit]);

  // Draft summary for collapsed state — what WOULD be applied if the user
  // hit Apply. Kept tiny: a single line of chips.
  const draftActive = React.useMemo(() => {
    const chips: string[] = [];
    if (draft.mode) chips.push(MODES.find((m) => m.value === draft.mode)?.label ?? draft.mode);
    if (draft.territory) chips.push(`Territory ${draft.territory}`);
    if (draft.service_type_id) {
      const svc = (serviceTypes ?? []).find((s) => s.service_type_id === draft.service_type_id);
      chips.push(svc?.name_en || svc?.name_fr || "Service type");
    }
    if (draft.layer) chips.push(LAYERS.find((l) => l.value === draft.layer)?.label ?? draft.layer);
    if (draft.verified) chips.push(VERIFICATION.find((v) => v.value === draft.verified)?.label ?? draft.verified);
    if (draft.from || draft.to) chips.push([draft.from ?? "…", draft.to ?? "…"].join(" → "));
    if (draft.include_completed !== undefined) chips.push(draft.include_completed ? "Incl. completed" : "Open only");
    return chips;
  }, [draft, serviceTypes]);

  const filterGridId = React.useId();

  return (
    <section
      className="mb-5 rounded-xl border bg-card p-4"
      aria-label="Control Tower filters"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">
            Filter operations
          </h2>
          <p className="micro text-muted-foreground">
            Filters are applied on the server and keep the result page stable.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Mobile-only expand / collapse. Desktop always shows the grid, so
              this control is lg:hidden and the grid uses hidden lg:grid when
              collapsed. */}
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-expanded={mobileOpen}
            aria-controls={filterGridId}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-accent lg:hidden"
          >
            <span className="whitespace-nowrap">
              {mobileOpen ? "Hide filters" : "Show filters"}
              {appliedCount > 0 ? ` · ${appliedCount}` : ""}
            </span>
            <ChevronIcon
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-transform",
                mobileOpen ? "rotate-180" : "",
              )}
            />
          </button>
          <Button type="button" size="sm" variant="ghost" onClick={reset}>
            Reset
          </Button>
          <Button type="button" size="sm" onClick={apply}>
            ✓ Apply filters
          </Button>
        </div>
      </div>

      {/* Collapsed summary — mobile only, hidden on desktop where the full
          grid is always visible, and hidden when the grid is open (no need
          to show both). Keeps context without costing height. */}
      {!mobileOpen && draftActive.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5 lg:hidden" aria-label="Active filters">
          {draftActive.slice(0, 4).map((label) => (
            <span
              key={label}
              className="inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-foreground"
            >
              {label}
            </span>
          ))}
          {draftActive.length > 4 && (
            <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-xs text-muted-foreground">
              +{draftActive.length - 4} more
            </span>
          )}
        </div>
      )}

      <div
        id={filterGridId}
        className={cn(
          "grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5",
          mobileOpen ? "grid" : "hidden lg:grid",
        )}
      >
        <Field label="Transport mode">
          <Select
            value={draft.mode ?? ""}
            onChange={(event) =>
              set(
                "mode",
                (event.target.value ||
                  undefined) as ControlTowerFilters["mode"],
              )
            }
          >
            {MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={tr("Territory")}>
          <Input
            value={draft.territory ?? ""}
            placeholder="e.g. CM"
            onChange={(event) => set("territory", event.target.value)}
          />
        </Field>

        <Field label={tr("Service type")}>
          <Select
            value={draft.service_type_id ?? ""}
            onChange={(event) =>
              set("service_type_id", event.target.value || undefined)
            }
          >
            <option value="">All service types</option>
            {(serviceTypes ?? []).map((service) => (
              <option
                key={service.service_type_id}
                value={service.service_type_id}
              >
                {service.name_en || service.name_fr || service.key}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Date field">
          <Select
            value={draft.date_field ?? "created"}
            onChange={(event) =>
              set(
                "date_field",
                (event.target.value ||
                  undefined) as ControlTowerFilters["date_field"],
              )
            }
          >
            {DATE_FIELDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        {/* Day-first, like every other date on an operations screen — the window
            being filtered is read out loud in the meeting these filters drive. */}
        <Field label={tr("From")}>
          <DateField
            value={draft.from ?? ""}
            onChange={(iso) => set("from", iso || undefined)}
          />
        </Field>

        <Field label={tr("To")}>
          <DateField
            value={draft.to ?? ""}
            onChange={(iso) => set("to", iso || undefined)}
          />
        </Field>

        <Field label={tr("Layer")}>
          <Select
            value={draft.layer ?? ""}
            onChange={(event) =>
              set(
                "layer",
                (event.target.value ||
                  undefined) as ControlTowerFilters["layer"],
              )
            }
          >
            {LAYERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={tr("Location")}>
          <Select
            value={draft.verified ?? ""}
            onChange={(event) =>
              set(
                "verified",
                (event.target.value ||
                  undefined) as ControlTowerFilters["verified"],
              )
            }
          >
            {VERIFICATION.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={tr("Completion")}>
          <Select
            value={completion}
            onChange={(event) =>
              set(
                "include_completed",
                event.target.value === ""
                  ? undefined
                  : event.target.value === "true",
              )
            }
          >
            <option value="">Open and completed</option>
            <option value="false">Open only</option>
            <option value="true">Include completed</option>
          </Select>
        </Field>

        <Field label="Page size">
          <Select
            value={String(draft.limit ?? page.limit ?? 50)}
            onChange={(event) => set("limit", Number(event.target.value))}
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size} rows
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {(page.has_more || value.cursor) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <span className="micro">Showing up to {page.limit} operations.</span>
          <div className="flex gap-2">
            {value.cursor && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onChange({ ...value, cursor: null })}
              >
                First page
              </Button>
            )}
            {page.has_more && page.next_cursor && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onChange({ ...value, cursor: page.next_cursor })}
              >
                Next page
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
