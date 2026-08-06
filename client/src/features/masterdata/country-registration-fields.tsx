/**
 * Country-driven tax/legal ID fields (PR3-B §2.2).
 *
 * The revamped create/edit form is country-first: pick a country and the tax /
 * legal registration IDs it mandates render here — NIU + RCCM for CM/OHADA, VAT
 * (+ EORI) for the EU, EIN for the US — each with its statutory bilingual label,
 * placeholder and regex, from the SAME shared reference the backend validates
 * against (`countries.requirementsFor`), so the form and the API cannot show a
 * different set. The values are kept as a `{ kind: number }` map and turned into
 * the `registrations` array the create service persists.
 */
import * as React from "react";
import { countries, type RegistrationRequirement } from "@shared";
import { Input } from "@/components/ui/input";
import type { PartyRegistrationInput } from "@/lib/masterdata-api";

export type RegValues = Record<string, string>;

/** The registration requirements for a country (empty until one is chosen). */
export function useCountryRegistrations(country?: string | null): RegistrationRequirement[] {
  return React.useMemo(() => (country ? countries.requirementsFor(country) : []), [country]);
}

/** True when a value is present but does not match its requirement's regex. */
export function regInvalid(req: RegistrationRequirement, value: string): boolean {
  const v = (value || "").trim();
  if (!v || !req.regex) return false;
  try {
    return !new RegExp(req.regex).test(v);
  } catch {
    return false;
  }
}

/** Build the `registrations` payload from the entered values (blanks dropped). */
export function toRegistrationsPayload(
  reqs: RegistrationRequirement[],
  values: RegValues,
  country?: string | null,
): PartyRegistrationInput[] {
  return reqs
    .filter((r) => (values[r.kind] || "").trim())
    .map((r) => ({ kind: r.kind, number: (values[r.kind] || "").trim(), country_code: country || undefined }));
}

export function CountryRegistrationFields({
  country,
  values,
  onChange,
  lang = "fr",
}: {
  country?: string | null;
  values: RegValues;
  onChange: (next: RegValues) => void;
  lang?: "fr" | "en";
}) {
  const reqs = useCountryRegistrations(country);
  if (!country) {
    return <p className="sm:col-span-2 micro text-muted-foreground">Select a country to see its required tax &amp; legal IDs.</p>;
  }
  if (reqs.length === 0) {
    return <p className="sm:col-span-2 micro text-muted-foreground">No specific registration IDs are configured for this country — add any via the 360 “Registrations” tab.</p>;
  }
  return (
    <>
      {reqs.map((r) => {
        const v = values[r.kind] ?? "";
        const invalid = regInvalid(r, v);
        return (
          <div key={r.kind} className="space-y-1.5">
            <label htmlFor={`reg-${r.kind}`} className="block text-sm font-medium text-foreground">
              {lang === "fr" ? r.label_fr : r.label_en}
              {r.required && <span className="text-bad"> *</span>}
            </label>
            <Input
              id={`reg-${r.kind}`}
              value={v}
              placeholder={r.placeholder}
              aria-invalid={invalid || undefined}
              onChange={(e) => onChange({ ...values, [r.kind]: e.target.value })}
            />
            {invalid && <p className="micro text-bad">Invalid {r.kind} format.</p>}
          </div>
        );
      })}
    </>
  );
}
