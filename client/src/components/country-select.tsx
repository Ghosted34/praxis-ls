/**
 * CountrySelect — now a thin wrapper over the Smart Country Picker (§8.1).
 *
 * The old native `<select>` listed only the ~40 countries this product plausibly
 * touched; the Smart Country Picker (components/smart-country-picker.tsx) is a
 * searchable Radix control over the full ISO list from the shared canonical
 * reference (Hard Rule 8: no native selects for country pickers). This name is
 * kept so every existing call site — client/supplier forms, corporate entities —
 * upgrades without churn.
 *
 * No React import: JSX uses the automatic runtime and this file has no hooks, so
 * importing React trips TS6133 under noUnusedLocals (the note that outlived the
 * original implementation).
 */
import { SmartCountryPicker } from "@/components/smart-country-picker";

export function CountrySelect({
  value,
  onChange,
  allowEmpty = true,
  label,
}: {
  value?: string | null;
  onChange: (code: string) => void;
  allowEmpty?: boolean;
  label?: string;
}) {
  return <SmartCountryPicker value={value} onChange={onChange} allowEmpty={allowEmpty} label={label} />;
}
