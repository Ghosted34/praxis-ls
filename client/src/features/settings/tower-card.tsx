/**
 * The Control Tower's shortcut grid, edited — the eleven modules a user
 * pins to the home screen's Applications block.
 *
 * WHY IT LIVES ON MY APPEARANCE, next to the rail picker: both are personal
 * display preferences persisted through `/me/preferences/shell`, both are
 * self-service (no permission required to change your own), and both are
 * about arranging the chrome — one pinned to the left edge, one pinned to
 * the home screen. Splitting them across two settings pages would mean two
 * places to teach a user "you can customise this" and would suggest they are
 * two different concepts. They are the same concept applied to two surfaces.
 *
 * ONLY WHAT THIS USER CAN REACH is offered — the candidate list is
 * `pinnableTowerAreas`, which is the ribbon's areas minus the Control Tower
 * itself and Support & feedback. A pin whose grant is later revoked
 * disappears from the launcher on its own (`resolveTowerPins`), same as the
 * rail.
 */
import * as React from "react";
import { SettingsCard } from "@/components/settings/controls";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useShell } from "@/app/layout/shell-context";
import { buildRibbon, iconForArea } from "@/app/layout/ribbon-model";
import {
  MAX_TOWER_PINS,
  pinnableTowerAreas,
  resolveTowerPins,
} from "@/features/dashboard/tower-model";

export function TowerCard() {
  const { access, prefs, setPrefs } = useShell();
  const families = React.useMemo(() => buildRibbon(access), [access]);
  const candidates = React.useMemo(() => pinnableTowerAreas(families), [families]);
  const pinned = React.useMemo(
    () => resolveTowerPins(prefs.towerPins, families),
    [prefs.towerPins, families],
  );
  const pinnedKeys = React.useMemo(() => new Set(pinned.map((a) => a.key)), [pinned]);

  const full = pinned.length >= MAX_TOWER_PINS;

  function toggle(key: string) {
    // Same explicit-list rule as the rail picker: once a user touches this,
    // the answer is theirs and the starter set stops applying. That is what
    // makes an empty grid expressible at all — the launcher answers `[]`
    // with "just the More card", not "back to defaults".
    const next = pinnedKeys.has(key)
      ? pinned.filter((a) => a.key !== key).map((a) => a.key)
      : [...pinned.map((a) => a.key), key];
    setPrefs({ towerPins: next.slice(0, MAX_TOWER_PINS) });
  }

  return (
    <SettingsCard
      title="Control Tower shortcuts"
      desc={`The Applications block on your home screen. Pick up to ${MAX_TOWER_PINS}; a "More" card in the twelfth slot expands the rest inline.`}
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
                  // A full grid must still be emptied one at a time, so only
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
              {pinned.length} of {MAX_TOWER_PINS} pinned{full ? " — unpin one to add another." : "."}
            </p>
            {/* null, not [] — "never chosen", which restores the starter set
                rather than clearing the grid. */}
            <Button variant="ghost" size="sm" onClick={() => setPrefs({ towerPins: null })}>
              Reset to defaults
            </Button>
          </div>
        </>
      )}
    </SettingsCard>
  );
}
