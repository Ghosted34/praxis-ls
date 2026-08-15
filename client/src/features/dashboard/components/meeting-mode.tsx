/**
 * Meeting mode — the tower with everything that is not the operation removed.
 *
 * WHY A MODE AND NOT A SEPARATE SCREEN. The Monday operations meeting reads this
 * dashboard on a projector, and what it needs is the same data with a different
 * emphasis: a big map, the exception count, and the file currently being
 * discussed. A separate route would be a second surface to keep in step with the
 * first, and it would drift — so this wraps the same components with a different
 * layout, and every filter and selection carries straight into it.
 *
 * READ-ONLY BY CONSTRUCTION. Nothing in here writes. That is deliberate rather
 * than incidental: the person driving a projector is talking, not looking at their
 * cursor, and an "archive" or "cancel" one click from the mouse position is a
 * hazard. The way to act on a file is to leave the mode and open it.
 *
 * AUTO-REFRESH IS OPT-IN AND PAUSABLE. A map that silently re-fits mid-sentence
 * because a file was updated in another tab is worse than a stale one: the room
 * loses its place. So refresh is off until asked for, the interval is visible, and
 * the last refresh time is on screen — a number that is honestly stale beats one
 * that is silently moving.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { MapLegend } from "./map-legend";
import { ScreenOverlay } from "./screen-overlay";
import type { ShipmentMode } from "../model";

/** How often auto-refresh fires when enabled. Two minutes: long enough that the
 *  room is never interrupted mid-point, short enough to matter over an hour. */
const REFRESH_MS = 120_000;

export type MeetingStat = { label: string; value: string; tone?: "ok" | "warn" | "bad" | "mute" };

export function MeetingMode({
  open,
  onClose,
  onRefresh,
  stats,
  counts,
  stroke,
  activityCount,
  unresolvedCount,
  filterSummary,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Refetch. Called by the pause-able timer and by the manual button. */
  onRefresh: () => void;
  stats: MeetingStat[];
  counts: Record<ShipmentMode, number>;
  stroke: Record<ShipmentMode, string>;
  activityCount: number;
  unresolvedCount: number;
  /** The filters in force, in words — so the room knows what it is looking at. */
  filterSummary: string;
  /** The map, and the selected file's itinerary when there is one. */
  children: React.ReactNode;
}) {
  const [auto, setAuto] = React.useState(false);
  const [refreshedAt, setRefreshedAt] = React.useState(() => new Date());
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open || !auto) return;
    const handle = window.setInterval(() => {
      onRefresh();
      setRefreshedAt(new Date());
    }, REFRESH_MS);
    return () => window.clearInterval(handle);
  }, [open, auto, onRefresh]);

  // Escape leaves. Registered here rather than on the container so it works
  // wherever focus happens to be — including inside the map's own widget.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // The way out is the first thing a keyboard user lands on.
  React.useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const refreshed = refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <ScreenOverlay label="Operations meeting view" className="gap-3 p-3 sm:p-5">
      {/*
        Three rows, and only the middle one grows. The header, the stat tiles and
        the legend are `flex-none`, so a short viewport takes the height out of the
        MAP rather than out of the numbers the room is reading — and nothing
        scrolls, because a projected view that has to be scrolled to be complete is
        one whose bottom half nobody ever sees.
      */}
      <header className="flex flex-none flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-heading font-semibold leading-tight tracking-tight">Operations meeting</h1>
          <p className="mt-1 text-label text-muted-foreground">{filterSummary}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="text-micro font-semibold normal-case text-muted-foreground">
            Refreshed {refreshed}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={auto}
            onClick={() => setAuto((v) => !v)}
          >
            {auto ? "Pause auto-refresh" : "Auto-refresh every 2 min"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onRefresh();
              setRefreshedAt(new Date());
            }}
          >
            Refresh now
          </Button>
          <Button ref={closeRef} type="button" size="sm" onClick={onClose}>
            Exit meeting view
          </Button>
        </div>
      </header>

      {/* The numbers the meeting opens on. Exceptions are a tone, not a colour
          alone — every tile carries its own label. */}
      <ul className="m-0 grid flex-none list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <li
            key={s.label}
            className={cn(
              "rounded-xl border bg-card px-3 py-2.5",
              s.tone === "warn" && "border-[rgb(var(--warn)_/_0.4)]",
              s.tone === "bad" && "border-destructive/40",
            )}
          >
            <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p
              className={cn(
                "num mt-0.5 text-heading font-semibold leading-none",
                s.tone === "warn" && "text-[rgb(var(--warn))]",
                s.tone === "bad" && "text-destructive",
                s.tone === "ok" && "text-[rgb(var(--ok))]",
              )}
            >
              {s.value}
            </p>
          </li>
        ))}
      </ul>

      {/* The map. `flex flex-col` so its own Card can fill this box as a flex child. */}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>

      <footer className="flex flex-none flex-wrap items-center justify-between gap-3 border-t pt-3">
        <MapLegend
          counts={counts}
          stroke={stroke}
          activityCount={activityCount}
          unresolvedCount={unresolvedCount}
        />
        <Pill tone="mute">Read-only view</Pill>
      </footer>
    </ScreenOverlay>
  );
}
