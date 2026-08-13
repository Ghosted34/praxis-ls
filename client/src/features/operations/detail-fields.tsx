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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchSelect, type Row } from "@/components/ui/search-select";
import { useResource } from "@/lib/use-resource";
import { listCurrencies } from "@/lib/masterdata-api";
import type { DetailFieldDef, DetailGroupDef, DetailForm } from "@/lib/operations-api";

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

const asString = (v: unknown) => (v === null || v === undefined ? "" : String(v));

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
}: {
  field: DetailFieldDef;
  value: unknown;
  display?: string;
  onChange: (v: unknown) => void;
  onCreate?: (term: string, kinds: string[]) => void;
}) {
  const [picked, setPicked] = React.useState<string | null>(null);
  // A newly-picked label wins; otherwise the projection's resolved name; and if
  // the field is empty, nothing (so the placeholder shows).
  const shown = picked ?? (value ? display || asString(value) : null);

  const kinds = React.useMemo(
    () => (field.ref_kind || "").split(",").map((k) => k.trim().toUpperCase()).filter(Boolean),
    [field.ref_kind],
  );
  const filter = React.useMemo(
    () => (kinds.length ? (r: Row) => kinds.includes(String(r.kind).toUpperCase()) : undefined),
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
function CurrencyControl({ field, value, onChange }: { field: DetailFieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const currencies = useResource(() => listCurrencies(), []);
  return (
    <Select value={asString(value)} onChange={(e) => onChange(e.target.value || null)} aria-label={field.label}>
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
 * One control, chosen by the field's declared type.
 *
 * GEO_PLACE gets the port picker rather than a text box, which is what keeps
 * POL/POD resolving to real `geo_place` rows (0479) — the reference that gives
 * the Control Tower map exact coordinates instead of a fuzzy name match. The
 * text is still what is stored, so a port not yet in the catalogue can be typed
 * and is geocoded server-side on save.
 */
function Control({
  field,
  value,
  display,
  onChange,
  onCreateCarrier,
}: {
  field: DetailFieldDef;
  value: unknown;
  display?: string;
  onChange: (v: unknown) => void;
  onCreateCarrier?: (term: string, kinds: string[]) => void;
}) {
  switch (field.data_type) {
    case "TEXTAREA":
      return (
        <Textarea
          rows={3}
          value={asString(value)}
          placeholder={field.placeholder || undefined}
          onChange={(e) => onChange(e.target.value)}
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
        />
      );
    case "SELECT":
      return (
        <Select value={asString(value)} onChange={(e) => onChange(e.target.value || null)} aria-label={field.label}>
          <option value="">—</option>
          {(field.options || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label_en || o.label_fr}
            </option>
          ))}
        </Select>
      );
    case "DATE":
      return <Input type="date" value={asString(value).slice(0, 10)} onChange={(e) => onChange(e.target.value || null)} />;
    case "DATETIME":
      return <Input type="datetime-local" value={asString(value)} onChange={(e) => onChange(e.target.value || null)} />;
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
        />
      );
    case "GEO_PLACE":
      return (
        <SearchSelect
          path="/geo-places"
          value={asString(value)}
          placeholder={field.placeholder || undefined}
          getKey={(r) => String(r.geo_place_id)}
          getLabel={(r) => [r.name, r.country].filter(Boolean).join(" · ")}
          onSelect={(r) => onChange(String(r.name))}
          allowFreeText
          onFreeText={(t) => onChange(t)}
        />
      );
    case "RATE_PROVIDER":
      return (
        <RateProviderControl
          field={field}
          value={value}
          display={display}
          onChange={onChange}
          onCreate={onCreateCarrier}
        />
      );
    case "CURRENCY":
      return <CurrencyControl field={field} value={value} onChange={onChange} />;
    default:
      return (
        <Input
          value={asString(value)}
          placeholder={field.placeholder || undefined}
          onChange={(e) => onChange(e.target.value)}
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
}: {
  groups: DetailGroupDef[];
  values: DetailValues;
  displays?: DetailDisplays;
  onChange: (key: string, value: unknown) => void;
  /** Offered on carrier fields as "+ Add carrier" when the search finds none.
   *  Omit for users without MOD-10 create — an affordance that always 403s is
   *  worse than no affordance. */
  onCreateCarrier?: (term: string, kinds: string[]) => void;
  errors?: Record<string, string[]> | null;
  disabled?: boolean;
  omitKeys?: readonly string[];
}) {
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
          <legend className="text-sm font-medium text-foreground">{g.label}</legend>
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
export function missingRequired(form: DetailForm | null, values: DetailValues): DetailFieldDef[] {
  if (!form) return [];
  const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
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
export function valuesFromDetails(groups: { fields: { key: string; value: unknown }[] }[]): DetailValues {
  const out: DetailValues = {};
  for (const g of groups) for (const f of g.fields) if (f.value !== null && f.value !== undefined) out[f.key] = f.value;
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
  for (const g of groups) for (const f of g.fields) if (f.display) out[f.key] = f.display;
  return out;
}
