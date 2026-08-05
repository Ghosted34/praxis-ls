/**
 * Live shipments panel — the open dossiers, newest ETA first.
 *
 * Each row is a link to Operations filtered to that dossier's ref. In the iframe
 * these were `<div>`s that the injection script retro-fitted with `role="link"`
 * and a keydown handler, then routed through a `postMessage` bridge because the
 * frame could not navigate the app itself. A `<Link>` does all of that by being
 * a link.
 *
 * The progress bar is milestone completion from the milestone engine. It is
 * ABSENT, not zero, for a dossier with no template instantiated: "not tracked"
 * and "not started" are different facts and a 0%-width bar asserts the wrong one.
 */
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { ArrowRightIcon } from "@/components/ui/icons";
import { MODE_ICON } from "../mode-icons";
import type { LiveShipment, ShipmentMode } from "../model";

const MODE_CHIP: Record<ShipmentMode, string> = {
  sea: "bg-[rgb(var(--brand-blue)_/_0.13)] text-[rgb(var(--brand-blue-ink))]",
  air: "bg-[rgb(var(--brand-blue-bright)_/_0.15)] text-[rgb(var(--brand-blue-bright))]",
  road: "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-primary-ink",
};

function ShipmentRow({ s }: { s: LiveShipment }) {
  const Icon = MODE_ICON[s.mode];
  const hasRoute = !!(s.from || s.to);
  const meta = [s.stage, s.eta].filter(Boolean).join(" · ");

  return (
    <li>
      <Link
        to={`/operations/files?ref=${encodeURIComponent(s.ref)}`}
        className="flex gap-3 rounded-md p-2.5 transition-colors hover:bg-accent/60"
      >
        <span aria-hidden className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-md", MODE_CHIP[s.mode])}>
          <Icon width={16} height={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="num truncate text-label font-semibold text-primary-ink">{s.ref}</span>
            <Pill tone={s.tone}>{s.status}</Pill>
          </span>
          {/* Hide the whole line when neither end is known, rather than drawing
              a lone arrow pointing at nothing — which is what shipped before. */}
          {hasRoute && (
            <span className="mt-1 flex items-center gap-1.5 text-label font-medium text-foreground">
              <ArrowRightIcon width={13} height={13} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{s.from && s.to ? `${s.from} → ${s.to}` : s.from || s.to}</span>
            </span>
          )}
          {meta && <span className="mt-1 block truncate text-micro normal-case text-muted-foreground">{meta}</span>}
          {s.progress !== null && (
            <span
              className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[rgb(var(--ink)_/_0.08)]"
              role="progressbar"
              aria-label={`${s.ref} milestone progress`}
              aria-valuenow={s.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span
                className="block h-full rounded-full bg-[linear-gradient(90deg,rgb(var(--brand-blue-bright)),var(--primary))]"
                style={{ width: `${s.progress}%` }}
              />
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

export function LiveShipments({ shipments }: { shipments: LiveShipment[] }) {
  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-title font-semibold leading-none tracking-tight">Live shipments</h2>
        <Pill tone={shipments.length ? "ok" : "mute"}>
          {`${shipments.length} active`}
        </Pill>
      </div>
      {shipments.length ? (
        // `flex-1 min-h-0` rather than a fixed max-height: from xl the grid
        // stretches this card to the map's height, so the list fills exactly
        // that and scrolls inside it. A hardcoded cap left a row sliced in half
        // against a taller map, which reads as a rendering fault rather than as
        // "there is more below". Below xl the card is auto-height and the whole
        // list shows.
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">

          {shipments.map((s) => (
            <ShipmentRow key={s.ref} s={s} />
          ))}
        </ul>
      ) : (
        <div className="p-4">
          <EmptyState
            title="No live shipments"
            hint="Dossiers appear here while they are open or in progress. Create an operation file to start tracking one."
            className="border-0 p-6"
          />
        </div>
      )}
    </Card>
  );
}
