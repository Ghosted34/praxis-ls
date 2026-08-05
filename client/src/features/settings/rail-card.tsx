/**
 * The icon rail's shortcuts, edited — the destination of the `+` at the bottom
 * of the rail.
 *
 * WHY IT LIVES ON MY APPEARANCE. This is a personal display preference, in the
 * same family as the fonts on this page: it changes what one person sees and
 * nobody else, and it persists through the same `/me/preferences` endpoints
 * that are scoped to the caller by construction. Settings › Appearance is the
 * TENANT's editor, behind the Settings-edit grant — putting a personal
 * shortcut list there would mean needing permission to rewrite the company's
 * brand in order to pin Fleet to your own rail.
 *
 * ONLY WHAT THIS USER CAN REACH is offered. The candidate list is the areas the
 * ribbon resolved for them, so nobody can pin a destination they would be
 * refused at — and a pin whose grant is later revoked disappears from the rail
 * on its own (`resolveRailPins`).
 */
import * as React from "react";
import { SettingsCard } from "@/components/settings/controls";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useShell } from "@/app/layout/shell-context";
import { buildRibbon, iconForArea } from "@/app/layout/ribbon-model";
import { pinnableAreas, resolveRailPins, MAX_RAIL_PINS } from "@/app/layout/rail-model";

export function RailCard() {
  const { access, prefs, setPrefs } = useShell();
  const families = React.useMemo(() => buildRibbon(access), [access]);
  const candidates = React.useMemo(() => pinnableAreas(families), [families]);
  const pinned = React.useMemo(() => resolveRailPins(prefs.railPins, families), [prefs.railPins, families]);
  const pinnedKeys = React.useMemo(() => new Set(pinned.map((a) => a.key)), [pinned]);

  const full = pinned.length >= MAX_RAIL_PINS;

  function toggle(key: string) {
    // Written as an explicit list rather than as a diff against the defaults:
    // once a user touches this, the answer is theirs, and the starter set stops
    // applying. That is what makes an empty rail expressible at all.
    const next = pinnedKeys.has(key) ? pinned.filter((a) => a.key !== key).map((a) => a.key) : [...pinned.map((a) => a.key), key];
    setPrefs({ railPins: next.slice(0, MAX_RAIL_PINS) });
  }

  return (
    <SettingsCard
      title="Rail shortcuts"
      desc={`The strip of icons down the left of every screen. Up to ${MAX_RAIL_PINS}; the Control Tower, search and the quick actions are always there.`}
    >
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing to pin yet — this list fills in with the areas your role can open.
        </p>
      ) : (
        <>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {candidates.map((area) => {
              const Icon = iconForArea(area.label);
              const on = pinnedKeys.has(area.key);
              return (
                <Checkbox
                  key={area.key}
                  checked={on}
                  // A full rail must still be emptied one at a time, so only
                  // the UNCHECKED boxes go dead at the cap.
                  disabled={!on && full}
                  onCheckedChange={() => toggle(area.key)}
                  label={
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon />
                      <span className="truncate">{area.label}</span>
                    </span>
                  }
                />
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              {pinned.length} of {MAX_RAIL_PINS} pinned{full ? " — unpin one to add another." : "."}
            </p>
            {/* null, not [] — "never chosen", which is what restores the
                starter set rather than clearing the rail. */}
            <Button variant="ghost" size="sm" onClick={() => setPrefs({ railPins: null })}>
              Reset to defaults
            </Button>
          </div>
        </>
      )}
    </SettingsCard>
  );
}
