/**
 * Control Tower filter bar — server-backed filters with stable cursor paging.
 *
 * MOBILE REDESIGN (2026-09): the previous card squeezed "Filter operations" +
 * "Filters are applied…/Show filters/Reset/Apply" onto one flex row. On a
 * 360px phone the left text was ~70px wide → one word per line → 320px tall
 * empty card (screenshot Sept 20). Desktop was fine; mobile was not.
 *
 * New geometry:
 *  - Mobile (< lg): a single compact capsule (≈56px tall) — “Filters • 2”
 *    with a one-line active summary — taps open a full-screen grouped modal
 *    (native “Filter Room” pattern: large hit targets, grouped sections,
 *    sticky footer). No tall card, no word-wrap, map visible immediately.
 *  - Desktop (≥ lg): the previous card, fixed only for the flex-wrap squeeze
 *    (stacks header on narrow, shows 4–5 col grid). Grid is now `hidden lg:grid`
 *    → desktop always visible, mobile handled by the capsule + dialog.
 *
 * The dashboard owns query state; this only edits a local draft and applies it
 * deliberately so typing does not issue a request per keystroke.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Select } from "@/components/ui/modal";
import { Dialog } from "@/components/ui/dialog";
import { useList } from "@/lib/use-resource";
import type { ServiceType } from "@/lib/operations-api";
import type { ControlTowerFilters } from "../use-control-tower";
import { FilterIcon } from "@/components/ui/icons";

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
  { value: "OTHER", label: "No transport" },
] as const;

const LAYERS = [
  { value: "", label: "Everything" },
  { value: "MOVEMENT", label: "On the move" },
  { value: "ACTIVITY", label: "At a facility" },
] as const;

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
    <label className="space-y-1.5 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

export function TowerFilters({ value, page, onChange }: Props) {
  const { rows: serviceTypes } = useList<ServiceType>("/service-types");
  const [draft, setDraft] = React.useState<ControlTowerFilters>(value);
  const [sheetOpen, setSheetOpen] = React.useState(false);

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

  function resetDraft() {
    setDraft({});
  }

  function resetAndApply() {
    setDraft({});
    onChange({});
  }

  function openSheet() {
    setDraft(value);
    setSheetOpen(true);
  }

  function closeSheet() {
    setDraft(value);
    setSheetOpen(false);
  }

  function applyFromSheet() {
    const next: ControlTowerFilters = { ...draft, cursor: null };
    for (const key of Object.keys(next) as (keyof ControlTowerFilters)[]) {
      const current = next[key];
      if (current === "" || current === null || current === undefined)
        delete next[key];
    }
    onChange(next);
    setSheetOpen(false);
  }

  const completion =
    draft.include_completed === undefined
      ? ""
      : String(draft.include_completed);

  // Count of APPLIED filters (value) — for the compact bar badge & pager.
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

  // Chips for APPLIED (value) — shown in the compact capsule so the bar is useful even closed.
  const appliedChips = React.useMemo(() => {
    const chips: string[] = [];
    const v = value as Record<string, unknown> & ControlTowerFilters;
    if (v.mode)
      chips.push(MODES.find((m) => m.value === v.mode)?.label ?? String(v.mode));
    if (v.territory) chips.push(`Territory ${v.territory}`);
    if (v.service_type_id) {
      const svc = (serviceTypes ?? []).find(
        (s) => s.service_type_id === v.service_type_id,
      );
      chips.push(svc?.name_en || svc?.name_fr || "Service type");
    }
    if (v.layer)
      chips.push(LAYERS.find((l) => l.value === v.layer)?.label ?? String(v.layer));
    if (v.verified)
      chips.push(
        VERIFICATION.find((vv) => vv.value === v.verified)?.label ??
          String(v.verified),
      );
    if (v.from || v.to)
      chips.push([v.from ?? "…", v.to ?? "…"].join(" → "));
    if (v.include_completed !== undefined)
      chips.push(v.include_completed ? "Incl. completed" : "Open only");
    return chips;
  }, [value, serviceTypes]);

  // Draft summary (for preview inside sheet header, optional)
  const draftActive = React.useMemo(() => {
    const chips: string[] = [];
    if (draft.mode)
      chips.push(
        MODES.find((m) => m.value === draft.mode)?.label ?? String(draft.mode),
      );
    if (draft.territory) chips.push(`Territory ${draft.territory}`);
    if (draft.service_type_id) {
      const svc = (serviceTypes ?? []).find(
        (s) => s.service_type_id === draft.service_type_id,
      );
      chips.push(svc?.name_en || svc?.name_fr || "Service type");
    }
    if (draft.layer)
      chips.push(LAYERS.find((l) => l.value === draft.layer)?.label ?? String(draft.layer));
    if (draft.verified)
      chips.push(
        VERIFICATION.find((v) => v.value === draft.verified)?.label ??
          String(draft.verified),
      );
    if (draft.from || draft.to)
      chips.push([draft.from ?? "…", draft.to ?? "…"].join(" → "));
    if (draft.include_completed !== undefined)
      chips.push(draft.include_completed ? "Incl. completed" : "Open only");
    return chips;
  }, [draft, serviceTypes]);

  const pager =
    page.has_more || value.cursor ? (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
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
    ) : null;

  const desktopGrid = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
      <Field label="Transport mode">
        <Select
          value={draft.mode ?? ""}
          onChange={(event) =>
            set(
              "mode",
              (event.target.value || undefined) as ControlTowerFilters["mode"],
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
  );

  return (
    <>
      {/* ── MOBILE CAPSULE: ~56px tall, never wraps words vertically ── */}
      <section
        className="mb-4 flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-3 lg:hidden"
        aria-label="Control Tower filters summary"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold leading-none text-foreground">
              Filters
            </h2>
            {appliedCount > 0 && (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold leading-none text-primary-foreground">
                {appliedCount}
              </span>
            )}
            {appliedCount === 0 && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                — all operations
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs leading-none text-muted-foreground">
            {appliedChips.length
              ? appliedChips.slice(0, 2).join(" • ") +
                (appliedChips.length > 2 ? ` • +${appliedChips.length - 2}` : "")
              : "No filters — showing everything"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {appliedCount > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={resetAndApply}
              className="h-9 px-2.5 text-xs"
              aria-label="Clear all filters"
            >
              Reset
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={openSheet}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            className="h-9 gap-1.5 px-3.5 text-xs font-semibold"
          >
            <FilterIcon width={14} height={14} aria-hidden />
            <span>{appliedCount ? `Filters · ${appliedCount}` : "Filters"}</span>
          </Button>
        </div>
      </section>

      {/* Mobile active chips row — only when there is something to show, and wraps horizontally, not vertically per-word */}
      {appliedChips.length > 0 && (
        <div
          className="mb-4 flex flex-wrap gap-1.5 lg:hidden"
          aria-label="Active filters"
        >
          {appliedChips.slice(0, 3).map((label) => (
            <span
              key={label}
              className="inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-foreground"
            >
              {label}
            </span>
          ))}
          {appliedChips.length > 3 && (
            <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-xs text-muted-foreground">
              +{appliedChips.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Mobile pager — outside the capsule so capsule stays short */}
      {(page.has_more || value.cursor) && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2.5 lg:hidden">
          <span className="text-xs text-muted-foreground">
            Up to {page.limit}
          </span>
          <div className="flex gap-1.5">
            {value.cursor && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2.5 text-xs"
                onClick={() => onChange({ ...value, cursor: null })}
              >
                First
              </Button>
            )}
            {page.has_more && page.next_cursor && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2.5 text-xs"
                onClick={() => onChange({ ...value, cursor: page.next_cursor })}
              >
                Next
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── DESKTOP CARD: unchanged information, fixed header flex so it never squeezes ── */}
      <section
        className="mb-5 hidden rounded-xl border bg-card p-4 lg:block"
        aria-label="Control Tower filters"
      >
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">
              Filter operations
            </h2>
            <p className="micro mt-0.5 text-muted-foreground">
              Filters are applied on the server and keep the result page stable.
            </p>
            {appliedCount > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {appliedChips.slice(0, 4).map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-foreground"
                  >
                    {label}
                  </span>
                ))}
                {appliedChips.length > 4 && (
                  <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-xs text-muted-foreground">
                    +{appliedChips.length - 4} more
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={resetAndApply}>
              Reset
            </Button>
            <Button type="button" size="sm" onClick={apply}>
              ✓ Apply filters
            </Button>
          </div>
        </div>

        {desktopGrid}

        {pager && <div className="mt-3">{pager}</div>}
      </section>

      {/* ── FULL-SCREEN FILTER ROOM (native bottom-sheet on mobile, centred dialog on desktop) ── */}
      <Dialog
        open={sheetOpen}
        onClose={closeSheet}
        title="Filters"
        description={
          appliedCount
            ? `${appliedCount} active — ${appliedChips.slice(0, 3).join(" • ")}`
            : "Refine the operations shown in the Control Tower."
        }
        size="lg"
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={closeSheet}
              className="mr-auto hidden sm:inline-flex"
            >
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={resetDraft}>
              Clear
            </Button>
            <Button type="button" onClick={applyFromSheet}>
              Apply {draftActive.length ? `· ${draftActive.length}` : ""} filters
            </Button>
          </>
        }
      >
        {/* Grouped sections — large tap targets, iOS-style grouping, not a 10-field wall */}
        <div className="space-y-6">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Filters are applied on the server and keep the result page stable. Changes do not take effect until you tap Apply.
          </p>

          <div className="rounded-xl border bg-card">
            <div className="border-b px-4 py-2.5">
              <h3 className="text-sm font-semibold text-foreground">Transport</h3>
              <p className="text-xs text-muted-foreground">How the file moves.</p>
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Transport mode">
                <Select
                  value={draft.mode ?? ""}
                  onChange={(e) =>
                    set(
                      "mode",
                      (e.target.value || undefined) as ControlTowerFilters["mode"],
                    )
                  }
                >
                  {MODES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={tr("Layer")}>
                <Select
                  value={draft.layer ?? ""}
                  onChange={(e) =>
                    set(
                      "layer",
                      (e.target.value || undefined) as ControlTowerFilters["layer"],
                    )
                  }
                >
                  {LAYERS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>

          <div className="rounded-xl border bg-card">
            <div className="border-b px-4 py-2.5">
              <h3 className="text-sm font-semibold text-foreground">Place &amp; status</h3>
              <p className="text-xs text-muted-foreground">Where and in what state.</p>
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label={tr("Territory")}>
                <Input
                  value={draft.territory ?? ""}
                  placeholder="e.g. CM"
                  onChange={(e) => set("territory", e.target.value)}
                />
              </Field>
              <Field label={tr("Service type")}>
                <Select
                  value={draft.service_type_id ?? ""}
                  onChange={(e) =>
                    set("service_type_id", e.target.value || undefined)
                  }
                >
                  <option value="">All service types</option>
                  {(serviceTypes ?? []).map((s) => (
                    <option key={s.service_type_id} value={s.service_type_id}>
                      {s.name_en || s.name_fr || s.key}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={tr("Location")}>
                <Select
                  value={draft.verified ?? ""}
                  onChange={(e) =>
                    set(
                      "verified",
                      (e.target.value || undefined) as ControlTowerFilters["verified"],
                    )
                  }
                >
                  {VERIFICATION.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={tr("Completion")}>
                <Select
                  value={completion}
                  onChange={(e) =>
                    set(
                      "include_completed",
                      e.target.value === ""
                        ? undefined
                        : e.target.value === "true",
                    )
                  }
                >
                  <option value="">Open and completed</option>
                  <option value="false">Open only</option>
                  <option value="true">Include completed</option>
                </Select>
              </Field>
            </div>
          </div>

          <div className="rounded-xl border bg-card">
            <div className="border-b px-4 py-2.5">
              <h3 className="text-sm font-semibold text-foreground">Dates</h3>
              <p className="text-xs text-muted-foreground">Window to filter by.</p>
            </div>
            <div className="grid gap-4 p-4 sm:grid-cols-3">
              <Field label="Date field">
                <Select
                  value={draft.date_field ?? "created"}
                  onChange={(e) =>
                    set(
                      "date_field",
                      (e.target.value || undefined) as ControlTowerFilters["date_field"],
                    )
                  }
                >
                  {DATE_FIELDS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
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
            </div>
          </div>

          <div className="rounded-xl border bg-card">
            <div className="border-b px-4 py-2.5">
              <h3 className="text-sm font-semibold text-foreground">Results</h3>
            </div>
            <div className="p-4">
              <Field label="Page size">
                <Select
                  value={String(draft.limit ?? page.limit ?? 50)}
                  onChange={(e) => set("limit", Number(e.target.value))}
                >
                  {[25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n} rows
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
