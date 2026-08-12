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
import { Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchSelect } from "@/components/ui/search-select";
import type { DetailFieldDef, DetailGroupDef, DetailForm } from "@/lib/operations-api";

/** Values keyed by field key, exactly as the API takes them under `details`. */
export type DetailValues = Record<string, unknown>;

const COL: Record<DetailFieldDef["width"], string> = {
  THIRD: "sm:col-span-2",
  HALF: "sm:col-span-3",
  FULL: "sm:col-span-6",
};

const asString = (v: unknown) => (v === null || v === undefined ? "" : String(v));

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
  onChange,
}: {
  field: DetailFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
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
 */
export function DetailFieldGroups({
  groups,
  values,
  onChange,
  errors,
  disabled,
}: {
  groups: DetailGroupDef[];
  values: DetailValues;
  onChange: (key: string, value: unknown) => void;
  errors?: Record<string, string[]> | null;
  disabled?: boolean;
}) {
  if (!groups.length) return null;
  return (
    <div className="space-y-5">
      {groups.map((g) => (
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
                <Control field={f} value={values[f.key]} onChange={(v) => onChange(f.key, v)} />
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
