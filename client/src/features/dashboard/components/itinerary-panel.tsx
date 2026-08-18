/**
 * The selected file's itinerary — what a meeting actually reads off the map.
 *
 * WHY IT OPENS FROM A CLICK AND NOT FROM A NAVIGATION. The question in the room is
 * "what is happening with this one?", and the answer is five lines long. Sending
 * the operator to the file's own 360 page answers it, and loses the map, the other
 * eleven files and the thread of the conversation. So the answer comes to the map,
 * and the deep link to the full file is there for when the next question needs it.
 *
 * WHAT EACH LEG SHOWS, and why: its type and mode (what movement this is), both
 * endpoints with their verification state (whether we actually know where), the
 * planned dates and the actual ones where they exist (whether it happened), and
 * the carrier. That is the set an operator is asked about; anything less sends
 * them to another screen mid-sentence.
 */
import { Link } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import { dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { MODE_ICON, MODE_LABEL } from "../mode-icons";
import { LEG_STATUS_LABEL, LEG_TYPE_LABEL } from "../leg-labels";
import type {
  EndpointState,
  ItineraryLeg,
  LiveShipment,
  ShipmentMode,
} from "../model";

/** Endpoint state → how the panel says it. Words, not only colour (WCAG §1.4.1). */
const STATE_NOTE: Record<
  EndpointState,
  { label: string; tone: "ok" | "blue" | "warn" | "mute" } | null
> = {
  // The normal case says nothing: a badge on every row is a badge nobody reads.
  verified: null,
  reference: { label: "Reference point", tone: "blue" },
  unverified: { label: "Unverified", tone: "warn" },
  unknown: { label: "No location", tone: "mute" },
};

function Endpoint({
  name,
  state,
}: {
  name: string | null;
  state?: EndpointState;
}) {
  const note = state ? STATE_NOTE[state] : null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        className={cn(
          "truncate",
          name ? "text-foreground" : "italic text-muted-foreground",
        )}
      >
        {name || "not set"}
      </span>
      {note && <Pill tone={note.tone}>{note.label}</Pill>}
    </span>
  );
}

function LegRow({ leg }: { leg: ItineraryLeg }) {
  const Icon = MODE_ICON[leg.mode];
  const dates = [
    leg.actualDeparture
      ? `Left ${dateFmt(leg.actualDeparture)}`
      : leg.plannedDeparture
        ? `Due out ${dateFmt(leg.plannedDeparture)}`
        : null,
    leg.actualArrival
      ? `Arrived ${dateFmt(leg.actualArrival)}`
      : leg.plannedArrival
        ? `Due in ${dateFmt(leg.plannedArrival)}`
        : null,
  ].filter(Boolean);

  return (
    <li className="flex gap-3 py-2.5">
      <span aria-hidden className="mt-0.5 shrink-0 text-muted-foreground">
        <Icon width={15} height={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-label font-semibold text-foreground">
            {LEG_TYPE_LABEL[leg.legType] || leg.legType}
          </span>
          <span className="text-micro font-medium normal-case text-muted-foreground">
            {MODE_LABEL[leg.mode]}
          </span>
          {leg.isOptional && <Pill tone="mute">{tr("Optional")}</Pill>}
          {leg.status !== "PLANNED" && (
            <Pill tone="blue">
              {LEG_STATUS_LABEL[leg.status] || leg.status}
            </Pill>
          )}
        </div>

        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-label">
          <Endpoint name={leg.origin.name} state={leg.origin.state} />
          <span aria-hidden className="text-muted-foreground">
            →
          </span>
          <Endpoint name={leg.destination.name} state={leg.destination.state} />
        </div>

        {(dates.length > 0 || leg.providerName || leg.notes) && (
          <p className="mt-1 truncate text-micro normal-case text-muted-foreground">
            {[...dates, leg.providerName, leg.notes]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>
    </li>
  );
}

export function ItineraryPanel({
  shipment,
  legs,
  onClose,
}: {
  shipment: LiveShipment;
  legs: ItineraryLeg[];
  onClose: () => void;
}) {
  const unresolved = legs.filter((l) => l.needsLocation).length;

  return (
    // Named after the file it is showing, so a screen-reader user landing on the
    // landmark knows WHICH file's itinerary they are in — the panel's contents
    // change with the selection, and "itinerary" alone would not say which.
    <Card
      role="region"
      aria-label={`Itinerary for ${shipment.ref}`}
      className="flex min-w-0 flex-col"
    >
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="num truncate text-title font-semibold leading-tight tracking-tight">
            {shipment.ref}
          </h2>
          <p className="mt-0.5 truncate text-label text-muted-foreground">
            {[shipment.stage, shipment.eta && `due ${shipment.eta}`]
              .filter(Boolean)
              .join(" · ") || "No milestone yet"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Pill tone={shipment.tone}>{shipment.status}</Pill>
          {/* Escape does this too (the map owns the key handler); the button is
              the pointer user's equivalent and the screen-reader label. */}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClose}
            aria-label="Close itinerary"
          >
            Close
          </Button>
        </div>
      </div>

      {unresolved > 0 && (
        <p className="border-b bg-[rgb(var(--warn)_/_0.08)] px-4 py-2 text-micro font-medium normal-case text-foreground">
          {unresolved === 1 ? "One leg has" : `${unresolved} legs have`} no
          verified location, so {unresolved === 1 ? "it is" : "they are"} not
          drawn on the map.
        </p>
      )}

      {legs.length ? (
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col divide-y overflow-y-auto px-4 py-1">
          {legs.map((leg) => (
            <LegRow key={leg.id} leg={leg} />
          ))}
        </ul>
      ) : (
        <div className="p-4">
          <EmptyState
            title="No structured itinerary"
            hint="This file records a route on the file itself rather than as legs. Open it to add pickup, customs or delivery legs."
            className="border-0 p-6"
          />
        </div>
      )}

      <div className="border-t px-4 py-2.5">
        {/*
          The deep link, and the reason `dossier_id` now travels in the payload.
          `ref` seeds the hub's search so the row is on the page; `focus` is the
          hub's existing convention (`useFocusRow`) for scrolling to a row and
          opening its 360. The previous tower could only send `ref` — a display
          string — so the link landed on a filtered LIST and the operator had to
          click the row they had already chosen on the map.
        */}
        <Link
          to={`/operations/files?ref=${encodeURIComponent(shipment.ref)}&focus=${encodeURIComponent(shipment.dossierId)}`}
          className="flex w-full items-center justify-center rounded-[11px] border px-3 py-2 text-[13px] font-semibold text-primary-ink transition-colors hover:bg-accent/60"
        >
          Open the operations file
        </Link>
      </div>
    </Card>
  );
}

/** Re-exported so the map's props and this panel cannot disagree about a mode. */
export type { ShipmentMode };
