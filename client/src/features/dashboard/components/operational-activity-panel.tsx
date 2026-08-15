/**
 * The work that is not a route — and the routes we cannot draw yet.
 *
 * WHY THIS PANEL EXISTS AT ALL. The Control Tower was a map, so the only files it
 * could represent were files with two coordinates. Three of this product's twelve
 * service types move nothing: Warehousing is custody at a place, Customs
 * Brokerage is a clearance, Business Representation is a mandate over a period.
 * They have deadlines, exceptions and clients like everything else, and the old
 * tower did one of two wrong things with them — dropped them off the screen, or
 * drew a lane between two places one of them happened to mention.
 *
 * THE SECOND HALF IS THE MORE IMPORTANT ONE. A file whose origin or destination is
 * named but NOT verified cannot honestly be plotted: the coordinate is either
 * absent or is a background geocode nobody confirmed. The previous behaviour was
 * to draw it anyway. Now it appears here, with what is wrong and a way to fix it —
 * which turns a silent wrong pin into a short, actionable list.
 *
 * EXCEPTION-FIRST ORDER. Files needing a location come before ordinary activity,
 * because one is a thing to fix and the other is a thing to note.
 */
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { MODE_ICON } from "../mode-icons";
import type { ActivityRecord } from "../model";

function ActivityRow({ record, selected, onSelect }: {
  record: ActivityRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = MODE_ICON.other;
  const needs = record.reason === "needs-location";
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "flex w-full gap-3 rounded-md p-2.5 text-left transition-colors",
          selected ? "bg-accent/70" : "hover:bg-accent/60",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-md",
            needs ? "bg-[rgb(var(--warn)_/_0.14)] text-[rgb(var(--warn))]" : "bg-muted text-muted-foreground",
          )}
        >
          {needs ? (
            <span className="h-3 w-3 rounded-full border-2 border-current" />
          ) : (
            <Icon width={16} height={16} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="num truncate text-label font-semibold text-primary-ink">{record.ref}</span>
            <Pill tone={needs ? "warn" : record.tone}>{needs ? "Needs a location" : record.status}</Pill>
          </span>
          <span className="mt-0.5 block truncate text-micro normal-case text-muted-foreground">
            {record.serviceName}
            {record.facility && ` · ${record.facility.name}`}
          </span>
          {(record.stage || record.eta) && (
            <span className="mt-0.5 block truncate text-micro normal-case text-muted-foreground">
              {[record.stage, record.eta].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

export function OperationalActivityPanel({
  records,
  selected,
  onSelect,
}: {
  records: ActivityRecord[];
  selected: string | null;
  onSelect: (dossierId: string) => void;
}) {
  // Exceptions first, then by reference so the order is stable between refreshes.
  const ordered = [...records].sort(
    (a, b) =>
      Number(b.reason === "needs-location") - Number(a.reason === "needs-location") ||
      a.ref.localeCompare(b.ref),
  );
  const needsCount = ordered.filter((r) => r.reason === "needs-location").length;

  return (
    // A named landmark, so a screen-reader user can jump straight to the exception
    // list instead of walking the map's routes to reach it — and so the tower's
    // panels are separate destinations rather than one undifferentiated blob.
    <Card role="region" aria-label="Not on the map" className="flex min-w-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-title font-semibold leading-none tracking-tight">Not on the map</h2>
          <p className="mt-1 text-micro normal-case text-muted-foreground">
            Facility work, and files whose location is not verified yet.
          </p>
        </div>
        {needsCount > 0 && <Pill tone="warn">{`${needsCount} to fix`}</Pill>}
      </div>

      {ordered.length ? (
        <>
          <ul className="m-0 flex max-h-80 min-h-0 flex-1 list-none flex-col gap-0.5 overflow-y-auto p-1.5">
            {ordered.map((r) => (
              <ActivityRow
                key={r.dossierId}
                record={r}
                selected={selected === r.dossierId}
                onSelect={() => onSelect(r.dossierId)}
              />
            ))}
          </ul>
          {needsCount > 0 && (
            <div className="border-t px-4 py-2.5">
              <Link
                to="/operations/files"
                className="flex w-full items-center justify-center rounded-[11px] border px-3 py-2 text-[13px] font-semibold text-primary-ink transition-colors hover:bg-accent/60"
              >
                Fix locations in Operations
              </Link>
            </div>
          )}
        </>
      ) : (
        <div className="p-4">
          <EmptyState
            title="Everything is on the map"
            hint="No facility-only files, and every open file's origin and destination is verified."
            className="border-0 p-6"
          />
        </div>
      )}
    </Card>
  );
}
