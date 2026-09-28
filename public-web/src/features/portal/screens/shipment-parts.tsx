/**
 * The pieces every shipment is drawn with, on Home, in the list and on its own
 * page: the mode as an icon, the route as a line between two places, progress
 * as a bar, and the step it is on as a pill. A client should be able to read a
 * shipment card from across the room — where, how far, what now — without one
 * sentence on it.
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { Mode, ShipmentCard } from "@/lib/portal-api";
import { cn } from "@/lib/cn";
import { Pill, IconDisc } from "../ui/kit";
import { ShipIcon, PlaneIcon, TruckIcon, TrainIcon, WarehouseIcon, CustomsIcon, BoxIcon, ChevronRightIcon, UploadIcon } from "../ui/icons";
import { relDay, daysFromToday } from "../lib/when";

export function ModeIcon({ mode, size = 22 }: { mode: Mode; size?: number }) {
  const Icon =
    mode === "SEA"
      ? ShipIcon
      : mode === "AIR"
        ? PlaneIcon
        : mode === "ROAD"
          ? TruckIcon
          : mode === "RAIL"
            ? TrainIcon
            : mode === "STORAGE"
              ? WarehouseIcon
              : mode === "CUSTOMS"
                ? CustomsIcon
                : BoxIcon;
  return <Icon size={size} />;
}

/** origin ●──── ✈ ────○ destination — the moving half dashed until it arrives. */
export function RouteLine({
  origin,
  destination,
  mode,
  percent,
  big = false,
}: {
  origin: string | null;
  destination: string | null;
  mode: Mode;
  percent: number;
  big?: boolean;
}) {
  const { t } = useTranslation();
  if (!origin && !destination) return null;
  const done = percent >= 100;
  return (
    <div className={cn("pt-route", big ? "text-base" : "text-sm")}>
      <span className={cn("min-w-0 truncate font-semibold text-foreground", big ? "max-w-[9rem] sm:max-w-[14rem]" : "max-w-[7rem] sm:max-w-[12rem]")} title={origin || undefined}>
        {origin || t("portal.ship.unknownPlace")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="pt-route-dot" data-filled aria-hidden="true" />
        <span className="pt-route-line flex-1" data-done={percent > 0 || undefined} aria-hidden="true" />
      </span>
      <span className={cn("grid place-items-center rounded-full text-primary-ink", big ? "h-10 w-10 bg-[var(--pt-tint)]" : "h-7 w-7")} aria-hidden="true">
        <ModeIcon mode={mode} size={big ? 20 : 16} />
      </span>
      <span className="flex items-center gap-1.5">
        <span className="pt-route-line flex-1" data-done={done || undefined} aria-hidden="true" />
        <span className="pt-route-dot" data-filled={done || undefined} aria-hidden="true" />
      </span>
      <span className={cn("min-w-0 truncate text-right font-semibold text-foreground", big ? "max-w-[9rem] sm:max-w-[14rem]" : "max-w-[7rem] sm:max-w-[12rem]")} title={destination || undefined}>
        {destination || t("portal.ship.unknownPlace")}
      </span>
    </div>
  );
}

/** "ETA in 3 days" / "Arrived yesterday" — the one date a client asks for. */
export function ArrivalPill({ s }: { s: ShipmentCard }) {
  const { t } = useTranslation();
  if (!s.arrival) return null;
  if (s.arrived) return <Pill tone="ok">{t("portal.ship.arrived", { when: relDay(s.arrival) })}</Pill>;
  const late = (daysFromToday(s.arrival) ?? 0) < 0;
  return <Pill tone={late ? "warn" : "info"}>{t("portal.ship.eta", { when: relDay(s.arrival) })}</Pill>;
}

export function Progress({ percent, className }: { percent: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn("pt-progress", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={t("portal.ship.progress")}
      data-tone={percent >= 100 ? "ok" : undefined}
    >
      <span style={{ width: `${Math.max(percent, 3)}%` }} />
    </div>
  );
}

const isClosed = (s: ShipmentCard) => ["DONE", "CLOSED", "COMPLETED", "ARCHIVED", "DELIVERED"].includes(String(s.status).toUpperCase());

/** A shipment as a card — the whole thing is the link to its page. */
export function ShipmentCardView({ s }: { s: ShipmentCard }) {
  const { t } = useTranslation();
  const closed = isClosed(s) || s.progress.percent >= 100;
  return (
    <Link to={`/portal/shipments/${encodeURIComponent(s.dossier_id)}`} className="pt-card pt-card-press block p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <IconDisc tone={closed ? "ok" : "brand"}>
          <ModeIcon mode={s.mode} />
        </IconDisc>
        <div className="min-w-0 flex-1">
          <p className="pt-mono truncate text-[0.95rem] font-bold text-foreground">{s.ref}</p>
          <p className="truncate text-sm text-muted-foreground">{s.title || s.service || t(`portal.mode.${s.mode}`)}</p>
        </div>
        <ChevronRightIcon size={18} className="shrink-0 text-muted-foreground" />
      </div>
      {s.origin || s.destination ? (
        <div className="mt-4">
          <RouteLine origin={s.origin} destination={s.destination} mode={s.mode} percent={s.progress.percent} />
        </div>
      ) : null}
      {s.progress.total > 0 ? (
        <div className="mt-4">
          <Progress percent={s.progress.percent} />
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-foreground">
          {closed ? t("portal.ship.allDone") : s.current_step || t("portal.ship.settingUp")}
        </p>
        <span className="shrink-0">{closed ? <Pill tone="ok">{t("portal.ship.done")}</Pill> : <ArrivalPill s={s} />}</span>
      </div>
      {s.open_requests > 0 ? (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-[14px] bg-[rgb(var(--warn)/0.1)] px-3 py-2 text-sm font-semibold text-[rgb(var(--warn))]">
          <span className="inline-flex items-center gap-2">
            <UploadIcon size={16} />
            {t("portal.ship.needsYou", { count: s.open_requests })}
          </span>
          <ChevronRightIcon size={16} />
        </div>
      ) : null}
    </Link>
  );
}
