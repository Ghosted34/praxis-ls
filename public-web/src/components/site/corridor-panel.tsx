import { useTranslation } from "react-i18next";
import { MODE_ACCENT, type Corridor } from "@/lib/corridors-api";

/**
 * The lanes panel — the proof a tenant has before they have written any.
 *
 * ── WHY A LIST AND NOT A MAP ───────────────────────────────────────────────
 *
 * `geo_place` carries latitude and longitude, so a world map with arcs is one
 * projection away and it is the obvious thing to build. It is also the thing
 * that turns eight aggregated rows into a picture of somebody's network: an arc
 * drawn between two points invites the reader to trace it, and the endpoints are
 * exactly what the k-anonymity floor spent its design on protecting. A list
 * states the same fact — this lane, this often — and states it once.
 *
 * A list is also the honest shape for the data: these rows are ordered by volume
 * and that order is the information. A map has no first row.
 */
export function CorridorPanel({ lanes }: { lanes: Corridor[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border bg-[var(--secondary)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 pb-4 pt-5 md:px-6">
        <h3 className="font-display text-title font-semibold tracking-tight">
          {t("site.proof.lanes")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("site.proof.lanesSub")}
        </p>
      </div>
      {/* Hairline-separated rows rather than cards: eight cards is a grid of
          boxes competing with the four service cards directly above, and these
          are rows of a ledger, which is what they should look like. */}
      <ul className="border-t">
        {lanes.map((lane) => {
          const accent = MODE_ACCENT[lane.mode];
          return (
            <li
              key={`${lane.origin}-${lane.destination}-${lane.mode}`}
              className="flex items-center gap-4 border-b bg-background px-5 py-3.5 last:border-b-0 md:px-6"
            >
              <span
                aria-hidden
                className="h-8 w-1 shrink-0 rounded-full"
                style={{
                  background: accent
                    ? `rgb(var(--mode-${accent}))`
                    : "var(--border)",
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-semibold tracking-tight">
                  {lane.origin}
                  <span aria-hidden className="mx-2 text-muted-foreground">
                    &rarr;
                  </span>
                  {lane.destination}
                </p>
                {lane.origin_country || lane.destination_country ? (
                  <p className="micro mt-0.5 normal-case">
                    {[lane.origin_country, lane.destination_country]
                      .filter(Boolean)
                      .join(" \u2192 ")}
                  </p>
                ) : null}
              </div>
              <p className="shrink-0 text-right">
                <span className="num font-mono text-sm font-semibold tabular-nums">
                  {lane.files}
                </span>
                <span className="micro ml-2 normal-case">
                  {t("site.proof.files")}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
