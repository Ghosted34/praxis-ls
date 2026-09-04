/**
 * The dynamic renderer for a service type's shipment/service detail form.
 *
 * This is the half of the feature a user actually asked for: pick a service
 * type when opening an operations file, and the fields that service needs
 * appear. There is no per-service-type code here and there never will be — the
 * definitions come from the server (`GET /service-types/:id/detail-form`) and a
 * tenant edits them from the Service Type screen without a deploy.
 *
 * WHAT IT DOES NOT DO. It does not decide what is valid. `is_required` and the
 * numeric bounds below only gate the SUBMIT BUTTON, as a courtesy — the real
 * check is `shipment_details.service` on the server, which knows the
 * definitions and refuses a value the browser let through. Two places would
 * disagree eventually; the server is the one that decides.
 */
import * as React from "react";
import { Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchSelect, type Row } from "@/components/ui/search-select";
import { PlacePicker } from "@/components/operations/place-picker";
import { useResource } from "@/lib/use-resource";
import { useCanUseModule } from "@/lib/route-access";
import { listCurrencies } from "@/lib/masterdata-api";
import { PLACE_KINDS, type PlaceKind } from "@/lib/operations-api";
import type {
  DetailFieldDef,
  DetailGroupDef,
  DetailForm,
} from "@/lib/operations-api";

/** Values keyed by field key, exactly as the API takes them under `details`. */
export type DetailValues = Record<string, unknown>;
/** Field key → the printable form of its stored value, as the projection
 *  computed it. Only reference types need one: a `RATE_PROVIDER` field stores a
 *  uuid, and a picker showing that uuid is no better than a text box. */
export type DetailDisplays = Record<string, string>;

const COL: Record<DetailFieldDef["width"], string> = {
  THIRD: "sm:col-span-2",
  HALF: "sm:col-span-3",
  FULL: "sm:col-span-6",
};

const asString = (v: unknown) =>
  v === null || v === undefined ? "" : String(v);

/**
 * The carrier picker for a `RATE_PROVIDER` field.
 *
 * WHY IT IS ITS OWN COMPONENT. It is the only control here that stores one
 * thing and shows another: `column_name` is `rate_provider_id`, a uuid FK, so
 * the VALUE is a uuid — but a uuid in a form control is unreadable, and the
 * projection already resolves the carrier's name for exactly this reason. So it
 * holds the label it last selected, falling back to the resolved display of
 * whatever was stored before the form opened.
 *
 * DO NOT COPY `GEO_PLACE` HERE. That case calls `onChange(r.name)` and stores
 * the display text, which is right for `pol`/`pod` (text columns with a
 * `*_place_id` alongside) and wrong for this one — a name written to a uuid
 * column is a 500 from Postgres, which is the bug this control exists to fix.
 *
 * `ref_kind` scopes which carrier kinds are offered. A sea file's field carries
 * `SHIPPING_LINE`, an inland file's carries `TRUCKING,RAIL`; a field with none
 * offers everything, so the control works before those definitions are seeded
 * and stays tenant-editable afterwards.
 */
function RateProviderControl({
  field,
  value,
  display,
  onChange,
  onCreate,
  id,
}: {
  field: DetailFieldDef;
  value: unknown;
  display?: string;
  onChange: (v: unknown) => void;
  onCreate?: (term: string, kinds: string[]) => void;
} & { id?: string }) {
  const [picked, setPicked] = React.useState<string | null>(null);
  // A newly-picked label wins; otherwise the projection's resolved name; and if
  // the field is empty, nothing (so the placeholder shows).
  const shown = picked ?? (value ? display || asString(value) : null);

  const kinds = React.useMemo(
    () =>
      (field.ref_kind || "")
        .split(",")
        .map((k) => k.trim().toUpperCase())
        .filter(Boolean),
    [field.ref_kind],
  );
  const filter = React.useMemo(
    () =>
      kinds.length
        ? (r: Row) => kinds.includes(String(r.kind).toUpperCase())
        : undefined,
    [kinds],
  );

  return (
    <SearchSelect
      path="/rate-providers?active=true"
      label={field.label}
      value={shown}
      placeholder={field.placeholder || "Search a carrier…"}
      getKey={(r) => String(r.rate_provider_id)}
      getLabel={(r) => [r.name, r.carrier_code].filter(Boolean).join(" · ")}
      onSelect={(r) => {
        setPicked(String(r.name));
        onChange(String(r.rate_provider_id));
      }}
      filter={filter}
      onCreate={onCreate ? (term) => onCreate(term, kinds) : undefined}
      createLabel={(term) => `Add carrier “${term}”`}
      id={id}
    />
  );
}

/**
 * The currency picker for a `CURRENCY` field.
 *
 * Seeded on the CUSTOMS declaration form (`9092:313`) and, like RATE_PROVIDER,
 * rendered as a plain text box until now — so "Declared currency" accepted
 * "dollars", "USD " and "usd" as three different values. The list is short and
 * fixed, so a native select beats a typeahead.
 */
function CurrencyControl({
  field,
  value,
  onChange,
  ...aria
}: {
  field: DetailFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
} & React.AriaAttributes & { id?: string }) {
  const currencies = useResource(() => listCurrencies(), []);
  return (
    <Select
      value={asString(value)}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={field.label}
      {...aria}
    >
      <option value="">—</option>
      {(currencies.data || [])
        .filter((c) => c.is_active !== false)
        .map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
            {c.name ? ` — ${c.name}` : ""}
          </option>
        ))}
    </Select>
  );
}

/**
 * A field the system fills in — marks & numbers being the one that does.
 *
 * LOCKED, WITH A KEY. Legacy made it read-only outright, which left nowhere to
 * describe a break-bulk consignment carrying the shipper's own marks; a lock
 * with no key just moves the problem into a notes box. So the value is shown
 * as text, and "Edit" turns it into a normal input.
 *
 * Unlocking is not a UI state — it is a decision the file records. Writing the
 * field sets `marks_numbers_is_manual` server-side, and from then on the
 * generator leaves it alone. Saying so here, before the click rather than
 * after, is the difference between an override and a surprise.
 */
function GeneratedControl({
  field,
  value,
  onChange,
  capturesContainers = false,
  ...aria
}: {
  field: DetailFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  /** On a file that captures equipment, this field mirrors the container list
   *  and is server-owned — there is no unlock, only a pointer to where the
   *  value actually comes from. Editing it here is the drift this removes. */
  capturesContainers?: boolean;
} & React.AriaAttributes & { id?: string }) {
  const [unlocked, setUnlocked] = React.useState(false);

  // Containerised files: marks & numbers belongs to the boxes. Read-only, no
  // key — the server refuses a manual value on these types, and offering an
  // "Edit" that cannot stick would be the surprise, not the courtesy.
  if (capturesContainers) {
    return (
      <div className="space-y-1">
        <div className="flex min-h-9 items-center rounded-md border bg-muted/40 px-3 py-1.5">
          <span className="min-w-0 truncate text-sm text-foreground">
            {asString(value) || (
              <span className="text-muted-foreground">
                Generated from the containers on this file
              </span>
            )}
          </span>
        </div>
        <p className="micro text-muted-foreground">
          Mirrors the boxes on this file — change it under Edit containers.
        </p>
      </div>
    );
  }

  if (unlocked) {
    return (
      <div className="space-y-1">
        <Input
          value={asString(value)}
          placeholder={field.placeholder || undefined}
          onChange={(e) => onChange(e.target.value)}
          {...aria}
        />
        <p className="micro text-muted-foreground">
          Editing this stops it updating from the containers on this file.
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-h-9 items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-1.5">
      <span className="min-w-0 truncate text-sm text-foreground">
        {asString(value) || (
          <span className="text-muted-foreground">
            Generated from the containers on this file
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => setUnlocked(true)}
        className="shrink-0 text-xs font-medium text-primary-ink underline"
      >
        Edit
      </button>
    </div>
  );
}

/**
 * Which place kinds a field will offer, if it says.
 *
 * Read from `ref_kind` — the same column that scopes a RATE_PROVIDER field to
 * shipping lines or truckers — so an airport field can be restricted to airports
 * from the Service Types screen with no code change here. A field that declares
 * nothing offers everything, which is the right default: guessing that a POL must
 * be a SEAPORT would refuse the perfectly ordinary inland dry port.
 */
function placeKindsOf(field: DetailFieldDef): PlaceKind[] | undefined {
  const declared = String(field.ref_kind || "")
    .split(",")
    .map((k) => k.trim().toUpperCase())
    .filter((k): k is PlaceKind =>
      (PLACE_KINDS as readonly string[]).includes(k),
    );
  return declared.length ? declared : undefined;
}

/**
 * One control, chosen by the field's declared type.
 *
 * GEO_PLACE gets `PlacePicker`, which will not commit free text. Before it, this
 * case was a typeahead with `allowFreeText`, and that flag was the whole defect:
 * "Doula" saved cleanly, the save path forward-geocoded it in the background, and
 * the file was linked to a plausible wrong coordinate with nothing on screen to
 * say so. The picker's four routes to a verified place (catalogue, worldwide
 * search, nearby reference point, manual entry) cover every case that flag was
 * there for — and the server refuses an unverified movement place at promotion,
 * so this control is the courtesy rather than the guarantee.
 */
function Control({
  field,
  value,
  display,
  onChange,
  onCreateCarrier,
  canCreatePlace = false,
  capturesContainers = false,
  ...aria
}: {
  field: DetailFieldDef;
  value: unknown;
  display?: string;
  onChange: (v: unknown) => void;
  onCreateCarrier?: (fieldKey: string, term: string, kinds: string[]) => void;
  /** May this user add a place by hand? Resolved once by the group renderer. */
  canCreatePlace?: boolean;
  /** Does this file capture equipment? Locks the generated marks field. */
  capturesContainers?: boolean;
} & React.AriaAttributes & { id?: string }) {
  /*
   * `aria` is what `<Field>` cloned onto this element — id, aria-labelledby,
   * aria-describedby, aria-invalid, aria-required.
   *
   * IT HAS TO BE FORWARDED, and was not. `Field` associates its label by
   * cloning ITS SINGLE CHILD with those props; the child here is this component
   * rather than a DOM element, so React set them on a function that ignored
   * them. The rendered `<label for="…-control">` therefore pointed at an id
   * nothing carried, and every field on every service type's form had no
   * accessible name — twenty-five controls per sea file that a screen reader
   * announces as "edit text, blank".
   *
   * Spreading it onto each control below is the fix, and the reason every case
   * ends with `{...aria}` rather than naming the props one at a time.
   */
  // Checked before the type switch: "the system fills this in" is a fact about
  // the field, not about what kind of value it holds.
  if (field.is_readonly)
    return (
      <GeneratedControl
        field={field}
        value={value}
        onChange={onChange}
        capturesContainers={capturesContainers}
        {...aria}
      />
    );
  switch (field.data_type) {
    case "TEXTAREA":
      return (
        <Textarea
          rows={3}
          value={asString(value)}
          placeholder={field.placeholder || undefined}
          onChange={(e) => onChange(e.target.value)}
          {...aria}
        />
      );
    case "BOOLEAN":
      return (
        // The Checkbox owns its own label (it is the clickable target), so the
        // surrounding Field renders the heading and this one names the control
        // itself — a checkbox whose only label sits above it is a checkbox
        // screen-reader users cannot identify.
        <Checkbox
          checked={value === true}
          onCheckedChange={(c: boolean) => onChange(c === true)}
          label={field.label}
          {...aria}
        />
      );
    case "SELECT":
      return (
        <Select
          value={asString(value)}
          onChange={(e) => onChange(e.target.value || null)}
          aria-label={field.label}
          {...aria}
        >
          <option value="">—</option>
          {(field.options || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label_en || o.label_fr}
            </option>
          ))}
        </Select>
      );
    case "DATE":
      // `DateField`, not a native date input: an ETA is read out loud in a room
      // where dates are day-first, and a native control renders in the OPERATING
      // SYSTEM's locale — so the same file showed 03/07 as the 3rd of July on one
      // machine and the 7th of March on the next, with nothing on screen to say
      // which. It still stores the ISO date the API wants.
      return (
        // The field's own placeholder is deliberately NOT forwarded: on a date
        // field it is almost always an example date in whatever format the seed
        // author had in mind, and it would displace the one hint that matters
        // here — the format the box actually expects.
        <DateField
          value={asString(value).slice(0, 10)}
          onChange={(iso) => onChange(iso || null)}
          {...aria}
        />
      );
    case "DATETIME":
      return (
        <Input
          type="datetime-local"
          value={asString(value)}
          onChange={(e) => onChange(e.target.value || null)}
          {...aria}
        />
      );
    case "NUMBER":
    case "INTEGER":
      return (
        <Input
          inputMode="decimal"
          value={asString(value)}
          placeholder={field.placeholder || undefined}
          onChange={(e) => {
            const t = e.target.value;
            // Empty clears the value; anything else is sent as typed and
            // coerced server-side, so a half-typed "12." is not destroyed
            // mid-keystroke by an eager Number().
            onChange(t === "" ? null : t);
          }}
          {...aria}
        />
      );
    case "GEO_PLACE":
      return (
        <PlacePicker
          value={asString(value) || null}
          label={field.label}
          placeholder={field.placeholder || undefined}
          kinds={placeKindsOf(field)}
          canCreate={canCreatePlace}
          // The NAME is stored, exactly as before — `pol` is a text column and
          // every document renders it. What has changed is that the name is now
          // guaranteed to be a catalogue place's own spelling, so the server can
          // resolve it to a coordinate with an equality check rather than a
          // fuzzy match, and the badge can say whether anybody vetted it.
          onSelect={({ name }) => onChange(name)}
          {...aria}
        />
      );
    case "RATE_PROVIDER":
      return (
        <RateProviderControl
          field={field}
          value={value}
          display={display}
          onChange={onChange}
          onCreate={
            onCreateCarrier &&
            ((term, kinds) => onCreateCarrier(field.key, term, kinds))
          }
          {...aria}
        />
      );
    case "CURRENCY":
      return (
        <CurrencyControl
          field={field}
          value={value}
          onChange={onChange}
          {...aria}
        />
      );
    case "REF":
      // Nothing seeds a REF field yet, so there is no storage convention to
      // honour and guessing one would be the wrong kind of certainty. It falls
      // through to text deliberately, and `ref_kind` is already carried on the
      // definition for whoever seeds the first one.
      return (
        <Input
          value={asString(value)}
          placeholder={field.placeholder || undefined}
          onChange={(e) => onChange(e.target.value)}
          {...aria}
        />
      );
    default:
      return (
        <Input
          value={asString(value)}
          placeholder={field.placeholder || undefined}
          onChange={(e) => onChange(e.target.value)}
          {...aria}
        />
      );
  }
}

/**
 * The form, grouped exactly as the service type defines it.
 *
 * `errors` takes the server's field-keyed validation map straight from a 422,
 * so a rejected save points at the control that caused it rather than showing
 * one message at the top of a twenty-field form.
 *
 * `omitKeys` drops fields the CALLER is rendering somewhere else. The creation
 * wizard hoists the carrier into step 1 and needs step 2 not to show it twice;
 * doing it by key here means one rule rather than a per-service-type list, and
 * a group left empty by the omission renders nothing rather than an empty
 * legend.
 */
export function DetailFieldGroups({
  groups,
  values,
  displays,
  onChange,
  onCreateCarrier,
  errors,
  disabled,
  omitKeys,
  capturesContainers,
}: {
  groups: DetailGroupDef[];
  values: DetailValues;
  displays?: DetailDisplays;
  onChange: (key: string, value: unknown) => void;
  /** Offered on carrier fields as "+ Add carrier" when the search finds none.
   *  Omit for users without MOD-10 create — an affordance that always 403s is
   *  worse than no affordance. */
  onCreateCarrier?: (fieldKey: string, term: string, kinds: string[]) => void;
  errors?: Record<string, string[]> | null;
  disabled?: boolean;
  omitKeys?: readonly string[];
  /** True when the file's service type captures equipment. Locks the generated
   *  marks & numbers field to the container list — see GeneratedControl. */
  capturesContainers?: boolean;
}) {
  // Resolved once here rather than inside each control: hooks cannot be called
  // from a switch, and a form with three place fields should ask about the grant
  // once. Same reasoning as `onCreateCarrier` above — an affordance that always
  // 403s is worse than no affordance, so the picker hides manual entry without it.
  const canCreatePlace = useCanUseModule("MOD-29");
  if (!groups.length) return null;
  const skip = new Set(omitKeys || []);
  const shown = groups
    .map((g) => ({ ...g, fields: g.fields.filter((f) => !skip.has(f.key)) }))
    .filter((g) => g.fields.length > 0);
  if (!shown.length) return null;
  return (
    <div className="space-y-5">
      {shown.map((g) => (
        <fieldset key={g.code} disabled={disabled} className="space-y-3">
          <legend className="text-sm font-medium text-foreground">
            {g.label}
          </legend>
          <div className="grid gap-4 sm:grid-cols-6">
            {g.fields.map((f) => (
              <Field
                key={f.key}
                label={f.label}
                required={f.is_required}
                hint={f.help || undefined}
                error={errors?.[f.key]?.[0]}
                className={COL[f.width] || COL.HALF}
              >
                <Control
                  field={f}
                  value={values[f.key]}
                  display={displays?.[f.key]}
                  onChange={(v) => onChange(f.key, v)}
                  onCreateCarrier={onCreateCarrier}
                  canCreatePlace={canCreatePlace}
                  capturesContainers={capturesContainers}
                />
              </Field>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

/**
 * Which required fields are still empty.
 *
 * Used to disable the submit button and to say WHY — "Port of loading and
 * Commodity are still needed" beats a button that is greyed out for no stated
 * reason. Only the fields the service-type owner marked required appear here;
 * everything else is captured progressively and reported as completeness on the
 * file itself.
 */
export function missingRequired(
  form: DetailForm | null,
  values: DetailValues,
): DetailFieldDef[] {
  if (!form) return [];
  const blank = (v: unknown) =>
    v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  return form.groups
    .flatMap((g) => g.fields)
    .filter((f) => f.is_required && blank(values[f.key]));
}

/**
 * Seed the form's values from a file being edited.
 *
 * Reads the PROJECTION's groups (which carry both the definition and the stored
 * value), so the edit form is populated by the same rule the panel displays by —
 * there is no second place that decides where a field's value lives.
 */
export function valuesFromDetails(
  groups: { fields: { key: string; value: unknown }[] }[],
): DetailValues {
  const out: DetailValues = {};
  for (const g of groups)
    for (const f of g.fields)
      if (f.value !== null && f.value !== undefined) out[f.key] = f.value;
  return out;
}

/**
 * The printable form of each stored value, from the same projection.
 *
 * Only reference types need it, and only one has it today: a `RATE_PROVIDER`
 * field stores `rate_provider_id`, and the server already resolves the carrier
 * name to print it on documents (`shipment_details.rules.displayValue`). Reusing
 * that here is what stops the edit form opening with a uuid in the carrier box —
 * and means the name is resolved in one place rather than by a second lookup
 * from the browser.
 */
export function displaysFromDetails(
  groups: { fields: { key: string; display?: string | null }[] }[],
): DetailDisplays {
  const out: DetailDisplays = {};
  for (const g of groups)
    for (const f of g.fields) if (f.display) out[f.key] = f.display;
  return out;
}
