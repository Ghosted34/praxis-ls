/**
 * The map's key: what each colour and each marker means.
 *
 * WHY A LEGEND IS NOT DECORATION HERE. The map carries meaning in colour (mode),
 * in marker shape (kind of place), and in marker fill (whether the coordinate is
 * exact or a reference point near it). None of that is guessable, and one of them
 * — the hollow reference-point marker — is a claim about how much we know, which
 * is precisely the kind of thing a reader must not have to infer. WCAG §1.4.1 is
 * the floor: every distinction below is also carried by a word.
 *
 * It stays visible in full-screen and meeting mode, because those are the two
 * places where somebody who has never used the screen is reading it over a
 * shoulder.
 */
import { MODE_ICON, MODE_LABEL } from "../mode-icons";

import type { ShipmentMode } from "../model";

/** The modes that draw a route. `other` is a facility, listed separately. */
const ROUTE_MODES: ShipmentMode[] = ["sea", "air", "road", "rail"];

export function MapLegend({
  counts,
  stroke,
  activityCount,
  unresolvedCount,
  compact,
}: {
  counts: Record<ShipmentMode, number>;
  /** Mode → stroke colour, passed in so the map owns its palette in one place. */
  stroke: Record<ShipmentMode, string>;
  /** Files with no route — warehousing, brokerage, representation. */
  activityCount: number;
  /** Files whose endpoints are not verified, so they are NOT drawn. */
  unresolvedCount: number;
  /** Drop the explanatory sentences; used in the map footer where space is tight. */
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {ROUTE_MODES.map((m) => {
        const Icon = MODE_ICON[m];
        return (
          <span
            key={m}
            className="flex items-center gap-1.5 text-label font-semibold text-muted-foreground"
          >
            <Icon style={{ color: stroke[m] }} />
            <span className="num">{counts[m]}</span> {MODE_LABEL[m]}
          </span>
        );
      })}

      {activityCount > 0 && (
        <span
          className="flex items-center gap-1.5 text-label font-semibold text-muted-foreground"
          title="Warehousing, customs brokerage and business representation move nothing. They are listed rather than drawn as a route."
        >
          {(() => {
            const Icon = MODE_ICON.other;
            return <Icon />;
          })()}
          <span className="num">{activityCount}</span> facility only
        </span>
      )}

      {unresolvedCount > 0 && (
        <span
          className="flex items-center gap-1.5 text-label font-semibold text-[rgb(var(--warn))]"
          title="These files name a place that is not verified, so there is no coordinate to draw. They are listed instead — drawing them would be a guess."
        >
          <span
            aria-hidden
            className="grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-current"
          />
          <span className="num">{unresolvedCount}</span> need a location
        </span>
      )}

      {!compact && (
        <>
          {/*
            Shape and fill are two axes on the same marker, so they get two
            sentences. Collapsing them into one ("hollow ship = …") is how a reader
            comes away thinking a hollow marker is a kind of place.
          */}
          <span
            className="flex items-center gap-1.5 text-micro font-medium normal-case text-muted-foreground"
            title="A marker's shape is the kind of place it is: a ship for a seaport, a plane for an airport, rooftops for a city, a warehouse for a terminal or depot."
          >
            {(() => {
              const Sea = MODE_ICON.sea;
              const Air = MODE_ICON.air;
              return (
                <span aria-hidden className="flex items-center gap-0.5">
                  <Sea width={12} height={12} />
                  <Air width={12} height={12} />
                </span>
              );
            })()}
            Marker shape = kind of place
          </span>
          <span
            className="flex items-center gap-1.5 text-micro font-medium normal-case text-muted-foreground"
            title="A hollow marker is a point NEAR the real address, agreed as a stand-in for the map. The file still carries the exact delivery instructions."
          >
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full border-[1.5px] border-current bg-transparent"
            />
            Hollow marker = reference point, not the exact address
          </span>
        </>
      )}
    </div>
  );
}
