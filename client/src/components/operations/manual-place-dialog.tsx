/**
 * The last resort, and a necessary one: name a place nothing else knows about.
 *
 * WHY THIS HAS TO EXIST. A verified-places rule with no escape hatch is a rule
 * that stops work. Real files route through places no catalogue and no geocoder
 * hold: a private terminal behind a gate, a bonded shed with no street address, a
 * customer's yard on a road that was built last year. Refusing those would push
 * the operator into typing the real location into a notes field and picking
 * something wrong from the picker to get past the form — which is worse than free
 * text was, because it looks verified.
 *
 * WHY IT IS PERMISSION-GATED. A place added here is reference data every future
 * file and the Control Tower map inherit, and it is recorded as MANUAL, which
 * makes it authoritative — a later geocode will not overwrite it. That is real
 * authority, so it needs the same grant as creating any other operations
 * reference record. Callers pass `canCreate` from `useCanUseModule`.
 *
 * WHY IT ASKS FOR COORDINATES AND DOES NOT PRETEND OTHERWISE. There is no
 * geocoder in this path by definition — we are here because geocoding failed. So
 * the form asks for latitude and longitude plainly, tells the operator where to
 * get them (a phone's map app, a right-click on any web map), and validates the
 * range. Hiding that behind a fake address box would just move the failure.
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/states";
import { Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";

/** A sensible default for a new place: the kind the field is asking for. */
export type ManualPlaceDefaults = {
  name?: string;
  kind?: api.PlaceKind;
  country?: string;
};

const COORD_HINT =
  "Long-press the spot in a phone map app, or right-click it on any web map, to copy the pair.";

export function ManualPlaceDialog({
  open,
  defaults,
  onClose,
  onCreated,
}: {
  open: boolean;
  defaults?: ManualPlaceDefaults;
  onClose: () => void;
  onCreated: (place: api.GeoPlace) => void;
}) {
  const [name, setName] = React.useState(defaults?.name || "");
  const [kind, setKind] = React.useState<api.PlaceKind>(
    defaults?.kind || "ADDRESS",
  );
  const [country, setCountry] = React.useState(defaults?.country || "");
  const [lat, setLat] = React.useState("");
  const [lng, setLng] = React.useState("");
  const [formatted, setFormatted] = React.useState("");
  const [isReference, setIsReference] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Re-seed when the dialog is reopened for a different field: the defaults
  // change with the caller, and a stale name from the last attempt is worse than
  // an empty box.
  React.useEffect(() => {
    if (!open) return;
    setName(defaults?.name || "");
    setKind(defaults?.kind || "ADDRESS");
    setCountry(defaults?.country || "");
    setLat("");
    setLng("");
    setFormatted("");
    setIsReference(false);
    setError(null);
  }, [open, defaults?.name, defaults?.kind, defaults?.country]);

  const latNum = Number(lat);
  const lngNum = Number(lng);
  const latOk =
    lat.trim() !== "" &&
    Number.isFinite(latNum) &&
    latNum >= -90 &&
    latNum <= 90;
  const lngOk =
    lng.trim() !== "" &&
    Number.isFinite(lngNum) &&
    lngNum >= -180 &&
    lngNum <= 180;
  const countryOk = country === "" || /^[A-Za-z]{2}$/.test(country.trim());
  const canSave =
    name.trim().length > 0 && latOk && lngOk && countryOk && !busy;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const place = await api.createGeoPlace({
        name: name.trim(),
        latitude: latNum,
        longitude: lngNum,
        kind,
        ...(country.trim() ? { country: country.trim().toUpperCase() } : {}),
        ...(formatted.trim() ? { formatted: formatted.trim() } : {}),
        ...(isReference ? { is_reference_point: true } : {}),
      });
      onCreated(place);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a place"
      description="For a terminal, warehouse or address that the catalogue and the worldwide search both miss."
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={!canSave}
            loading={busy}
          >
            Add place
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="info" title="This becomes reference data">
          Everyone on this tenant can pick it on future files, and it will not
          be overwritten by an automatic lookup. Name it the way an operator
          would search for it — including the town usually does it.
        </Callout>

        <Field
          label="Name"
          required
          hint="What people will type to find it, e.g. “Entrepôt Bonabéri, Douala”."
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind">
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as api.PlaceKind)}
              aria-label="Kind"
            >
              {api.PLACE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {api.PLACE_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Country"
            hint="Two-letter code, e.g. CM."
            error={countryOk ? undefined : "Use a two-letter ISO country code."}
          >
            <Input
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              maxLength={2}
              placeholder="CM"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Latitude"
            required
            hint={COORD_HINT}
            error={
              lat.trim() === "" || latOk
                ? undefined
                : "Must be a number between -90 and 90."
            }
          >
            <Input
              inputMode="decimal"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="4.0669"
            />
          </Field>
          <Field
            label="Longitude"
            required
            error={
              lng.trim() === "" || lngOk
                ? undefined
                : "Must be a number between -180 and 180."
            }
          >
            <Input
              inputMode="decimal"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              placeholder="9.6759"
            />
          </Field>
        </div>

        <Field
          label="Address or description"
          hint="Optional. Gate number, landmark, whatever the driver needs."
        >
          <Input
            value={formatted}
            onChange={(e) => setFormatted(e.target.value)}
            maxLength={500}
          />
        </Field>

        <Checkbox
          checked={isReference}
          onCheckedChange={(c: boolean) => setIsReference(c === true)}
          label="This is a nearby reference point, not the exact spot"
        />
        <p className="micro text-muted-foreground">
          Tick this when the coordinate is a junction or landmark you agreed to
          use because the real address cannot be pinned. The file still carries
          your delivery instructions; the map just stops claiming a precision
          nobody promised.
        </p>

        {error && <ErrorState message={error} />}
      </div>
    </Dialog>
  );
}
