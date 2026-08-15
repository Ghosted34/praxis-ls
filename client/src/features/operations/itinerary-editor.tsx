/**
 * The itinerary editor — where a file's actual route gets written down.
 *
 * WHAT IT REPLACES. Thirty-seven lines: a leg type, a mode, and two free-text
 * boxes. So the one screen whose job is to record where cargo goes could not
 * record a verified place, a date, a carrier, or the order the legs happen in —
 * `seq` was assigned by array position and there was no way to change it. Saving
 * geocoded whatever had been typed, which is the silent-guess path the dossier's
 * own save was fixed to stop taking.
 *
 * WHAT IT IS NOW, and each of these is a thing an operator was previously doing
 * in a notes field:
 *
 *   · verified places on both ends, through the same picker the file uses;
 *   · planned AND actual dates, because "due Tuesday" and "left Tuesday" are
 *     different facts and only one of them was storable;
 *   · reorder, because a customs leg moving before the inland leg is an ordinary
 *     Tuesday and `seq` is UNIQUE per file, so the swap has to be atomic;
 *   · a carrier per leg, since the trucker is rarely the shipping line;
 *   · optional legs, so a template's "maybe inland" can be dropped without
 *     arguing with the service type.
 *
 * UNSAVED CHANGES ARE VISIBLE AND REVERSIBLE. The editor holds a draft and says
 * so; nothing reaches the server until Save. A dirty form that looks identical to
 * a saved one is how an operator loses fifteen minutes of work to a navigation.
 *
 * THE SERVER STILL DECIDES. Every rule here is also enforced by
 * `itinerary.service` — verified places, structural legs, date order — because
 * two validators will disagree eventually and the one holding the database has to
 * win. What the browser adds is telling you before you press the button.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/states";
import { Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Pill } from "@/components/ui/pill";
import { PlacePicker } from "@/components/operations/place-picker";
import { SearchSelect } from "@/components/ui/search-select";
import { useCanUseModule } from "@/lib/route-access";
import { useResource, errMsg } from "@/lib/use-resource";
import { cn } from "@/lib/cn";
import * as api from "@/lib/operations-api";

/** Kept in step with `SINGLE_POINT_LEGS` in `itinerary.service.js`: a customs
 *  clearance and a warehouse custody period happen AT one place, so the editor
 *  stops asking for a second and the server stops requiring one. */
const SINGLE_POINT_LEGS = new Set<api.LegType>(["CUSTOMS", "WAREHOUSE", "OTHER"]);

const LEG_LABEL: Record<api.LegType, string> = {
  PICKUP: "Pickup",
  MAIN_CARRIAGE: "Main carriage",
  CUSTOMS: "Customs",
  INLAND_TRANSIT: "Inland transit",
  WAREHOUSE: "Warehouse",
  FINAL_DELIVERY: "Final delivery",
  OTHER: "Other",
};

const MODE_LABEL: Record<api.LegMode, string> = {
  AIR: "Air",
  SEA: "Sea",
  LAND: "Land",
  OTHER: "No transport",
};

const STATUS_LABEL: Record<api.LegStatus, string> = {
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  BLOCKED: "Blocked",
  CANCELLED: "Cancelled",
};

/** A leg the editor is holding, with a key that survives reordering. */
type DraftLeg = api.ItineraryLeg & { _key: string };

let keySeq = 0;
const withKey = (leg: api.ItineraryLeg): DraftLeg => ({
  ...leg,
  // The server id when there is one, so React keeps the row's DOM across a
  // save; a counter for a leg that does not exist yet. Array index would remount
  // every row below an insertion and drop focus mid-typing.
  _key: leg.itinerary_leg_id || `new-${(keySeq += 1)}`,
});

/** Only the fields the API accepts. A leg read from the server carries the
 *  projection's extra keys, and the validator rejects unknown ones. */
function toWireLeg(leg: DraftLeg, index: number): api.ItineraryLeg {
  return {
    seq: index + 1,
    leg_type: leg.leg_type,
    mode: leg.mode,
    origin: leg.origin || null,
    destination: leg.destination || null,
    origin_place_id: leg.origin_place_id || null,
    destination_place_id: leg.destination_place_id || null,
    planned_departure: leg.planned_departure || null,
    planned_arrival: leg.planned_arrival || null,
    actual_departure: leg.actual_departure || null,
    actual_arrival: leg.actual_arrival || null,
    status: leg.status || "PLANNED",
    provider_id: leg.provider_id || null,
    notes: leg.notes || null,
    is_optional: leg.is_optional === true,
    source: leg.source === "TEMPLATE" ? "TEMPLATE" : "MANUAL",
  };
}

const sameLegs = (a: DraftLeg[], b: DraftLeg[]) =>
  JSON.stringify(a.map(toWireLeg)) === JSON.stringify(b.map(toWireLeg));

export function ItineraryEditor({ dossierId }: { dossierId: string }) {
  const data = useResource(() => api.getItinerary(dossierId), [dossierId]);
  const canCreatePlace = useCanUseModule("MOD-29");

  const [legs, setLegs] = React.useState<DraftLeg[]>([]);
  /** What the server last confirmed, for the dirty check and for Revert. */
  const [saved, setSaved] = React.useState<DraftLeg[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]> | null>(null);
  const [justSaved, setJustSaved] = React.useState(false);

  React.useEffect(() => {
    if (!data.data) return;
    const loaded = data.data.map(withKey);
    setLegs(loaded);
    setSaved(loaded);
  }, [data.data]);

  const dirty = !sameLegs(legs, saved);

  function update(index: number, patch: Partial<api.ItineraryLeg>) {
    setJustSaved(false);
    setLegs((current) => current.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    // Clear the row's errors as soon as it is touched: an error message that
    // outlives the thing it described teaches people to ignore error messages.
    setFieldErrors((errs) => {
      if (!errs) return errs;
      const next = { ...errs };
      Object.keys(next).forEach((k) => {
        if (k.startsWith(`legs.${index}.`)) delete next[k];
      });
      return Object.keys(next).length ? next : null;
    });
  }

  function add() {
    setJustSaved(false);
    setLegs((current) => [
      ...current,
      withKey({ leg_type: "FINAL_DELIVERY", mode: "LAND", status: "PLANNED", is_optional: true, source: "MANUAL" }),
    ]);
  }

  function remove(index: number) {
    setJustSaved(false);
    setLegs((current) => current.filter((_, i) => i !== index));
  }

  /** Swap with the neighbour. A single move, because `seq` is UNIQUE per file and
   *  the whole list is rewritten on save anyway — so ordering is array order. */
  function move(index: number, delta: number) {
    setJustSaved(false);
    setLegs((current) => {
      const to = index + delta;
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    setFieldErrors(null);
    try {
      const rows = await api.replaceItinerary(dossierId, legs.map(toWireLeg));
      const fresh = rows.map(withKey);
      setLegs(fresh);
      setSaved(fresh);
      setJustSaved(true);
    } catch (e) {
      // `fields` first, `details` as the deprecated alias — reading only the
      // alias is the API F-2 defect: it was populated by exactly one route, so
      // field-level messages silently never arrived from any of the other ~700.
      const err = e as { fields?: Record<string, string[]>; details?: Record<string, string[]> };
      const detail = err?.fields ?? err?.details;
      if (detail && typeof detail === "object") setFieldErrors(detail);
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function revert() {
    setLegs(saved);
    setError(null);
    setFieldErrors(null);
    setJustSaved(false);
  }

  const errorFor = (index: number, field: string) => fieldErrors?.[`legs.${index}.${field}`]?.[0];
  /** Errors the server reported against the whole list rather than a row. */
  const listErrors = fieldErrors?.legs;

  if (data.loading) return <div className="micro">Loading itinerary…</div>;
  if (data.error) return <ErrorState message={data.error} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">Itinerary</h3>
          <p className="micro text-muted-foreground">
            Every movement on this file, in order. Legs from the service type are marked; you can add,
            reorder and remove your own.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <Pill tone="orange">Unsaved changes</Pill>}
          {justSaved && !dirty && <Pill tone="ok">Saved</Pill>}
          <Button size="sm" variant="outline" onClick={add} disabled={busy}>
            Add leg
          </Button>
        </div>
      </div>

      {listErrors && <Callout tone="warn" title="This service type needs a leg you removed">{listErrors.join(" ")}</Callout>}

      {legs.length === 0 && (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No structured itinerary yet. Add a leg to record where this file&apos;s cargo actually goes — the
          Control Tower map draws one segment per leg.
        </div>
      )}

      {legs.map((leg, i) => {
        const singlePoint = SINGLE_POINT_LEGS.has(leg.leg_type);
        const fromTemplate = leg.source === "TEMPLATE";
        return (
          <div
            key={leg._key}
            /*
             * A GROUP, named by its position and type. A leg is eight controls
             * that only make sense together, and without this a screen-reader user
             * moving through the form hears "Leg type, Mode, Status, Carrier,
             * Origin…" five times over with nothing saying which leg they are in.
             */
            role="group"
            aria-label={`Leg ${i + 1}: ${LEG_LABEL[leg.leg_type]}`}
            className={cn(
              "space-y-3 rounded-lg border p-3",
              (errorFor(i, "origin") || errorFor(i, "destination")) && "border-destructive/50",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="num text-micro font-semibold text-muted-foreground">{i + 1}</span>
                <span className="text-sm font-medium">{LEG_LABEL[leg.leg_type]}</span>
                {fromTemplate && (
                  <Pill tone="mute">From the service type</Pill>
                )}
                {leg.is_optional && <Pill tone="mute">Optional</Pill>}
              </span>
              <span className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move ${LEG_LABEL[leg.leg_type]} earlier`}
                  disabled={i === 0 || busy}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move ${LEG_LABEL[leg.leg_type]} later`}
                  disabled={i === legs.length - 1 || busy}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${LEG_LABEL[leg.leg_type]}`}
                  disabled={busy}
                  onClick={() => remove(i)}
                >
                  Remove
                </Button>
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Leg type">
                <Select
                  value={leg.leg_type}
                  onChange={(e) => update(i, { leg_type: e.target.value as api.LegType })}
                >
                  {api.LEG_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {LEG_LABEL[v]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Mode">
                <Select value={leg.mode} onChange={(e) => update(i, { mode: e.target.value as api.LegMode })}>
                  {api.LEG_MODES.map((v) => (
                    <option key={v} value={v}>
                      {MODE_LABEL[v]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Status">
                <Select
                  value={leg.status || "PLANNED"}
                  onChange={(e) => update(i, { status: e.target.value as api.LegStatus })}
                >
                  {api.LEG_STATUSES.map((v) => (
                    <option key={v} value={v}>
                      {STATUS_LABEL[v]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Carrier" hint="The provider moving this leg — often not the one on the file.">
                <SearchSelect
                  path="/rate-providers?active=true"
                  label="Carrier"
                  value={leg.provider_name || null}
                  placeholder="Search a carrier…"
                  getKey={(r) => String(r.rate_provider_id)}
                  getLabel={(r) => [r.name, r.carrier_code].filter(Boolean).join(" · ")}
                  onSelect={(r) =>
                    update(i, { provider_id: String(r.rate_provider_id), provider_name: String(r.name) })
                  }
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={singlePoint ? "Location" : "Origin"} error={errorFor(i, "origin")}>
                <PlacePicker
                  value={leg.origin || null}
                  label={singlePoint ? "Location" : "Origin"}
                  canCreate={canCreatePlace}
                  onSelect={({ name, place }) =>
                    update(i, { origin: name, origin_place_id: place.geo_place_id })
                  }
                />
              </Field>
              {/*
                A single-point leg has no destination, and asking for one is asking
                the operator to invent data — a customs clearance happens at one
                place. The server agrees (SINGLE_POINT_LEGS), so a leg switched to
                CUSTOMS does not suddenly fail validation for a field the form no
                longer shows.
              */}
              {!singlePoint && (
                <Field label="Destination" error={errorFor(i, "destination")}>
                  <PlacePicker
                    value={leg.destination || null}
                    label="Destination"
                    canCreate={canCreatePlace}
                    onSelect={({ name, place }) =>
                      update(i, { destination: name, destination_place_id: place.geo_place_id })
                    }
                  />
                </Field>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Planned departure" error={errorFor(i, "planned_departure")}>
                <DateField
                  value={(leg.planned_departure || "").slice(0, 10)}
                  onChange={(iso) => update(i, { planned_departure: iso || null })}
                />
              </Field>
              <Field label="Planned arrival" error={errorFor(i, "planned_arrival")}>
                <DateField
                  value={(leg.planned_arrival || "").slice(0, 10)}
                  onChange={(iso) => update(i, { planned_arrival: iso || null })}
                />
              </Field>
              {/*
                The actual dates are what turn a plan into tracking. A leg that
                departed three days late and arrived on time and a leg that has not
                moved at all were indistinguishable before 0677, because only the
                plan was stored.
              */}
              <Field label="Actual departure" error={errorFor(i, "actual_departure")}>
                <DateField
                  value={(leg.actual_departure || "").slice(0, 10)}
                  onChange={(iso) => update(i, { actual_departure: iso || null })}
                />
              </Field>
              <Field label="Actual arrival" error={errorFor(i, "actual_arrival")}>
                <DateField
                  value={(leg.actual_arrival || "").slice(0, 10)}
                  onChange={(iso) => update(i, { actual_arrival: iso || null })}
                />
              </Field>
            </div>

            <Field label="Notes" hint="Driver instructions, gate references, anything the next person needs.">
              <Input
                value={leg.notes || ""}
                maxLength={2000}
                onChange={(e) => update(i, { notes: e.target.value || null })}
              />
            </Field>

            <Checkbox
              checked={leg.is_optional === true}
              onCheckedChange={(c: boolean) => update(i, { is_optional: c === true })}
              label="Optional leg"
            />
          </div>
        );
      })}

      {error && <ErrorState message={error} />}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} loading={busy} disabled={!dirty}>
          Save itinerary
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={revert} disabled={busy}>
            Revert
          </Button>
        )}
      </div>
    </div>
  );
}
