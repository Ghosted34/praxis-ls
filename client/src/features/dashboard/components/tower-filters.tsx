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

  return (
    <section
      className="mb-5 rounded-xl border bg-card p-4"
      aria-label="Control Tower filters"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Filter operations
          </h2>
          <p className="micro text-muted-foreground">
            Filters are applied on the server and keep the result page stable.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={reset}>
            Reset
          </Button>
          <Button type="button" size="sm" onClick={apply}>
            Apply filters
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
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
