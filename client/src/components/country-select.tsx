/**
 * ISO-3166 alpha-2 country picker.
 *
 * Country was a free-text input on the corporate-entity form (and, as of 0480,
 * would have been on client and supplier too). That is a data-quality problem
 * rather than a cosmetic one: the column is `char(2)`, so "Cameroun", "Cameroon"
 * and "CMR" are all either rejected or silently truncated to two characters —
 * "Ca", "Ca", "CM" — and only one of those is right.
 *
 * ORDERING is deliberate: the OHADA member states and the tenants' usual trading
 * counterparties come first, then everything else alphabetically. A Douala
 * forwarder should not scroll past Afghanistan to reach Cameroon.
 *
 * The list is intentionally partial — the countries this product plausibly
 * touches, not all 249. `allowUnknown` keeps an existing out-of-list value
 * selectable so editing an old record can never silently change its country.
 */
// No React import: this file has no hooks and the project uses the automatic
// JSX runtime, so importing it trips TS6133 ("declared but never read") under
// noUnusedLocals — which is what broke the client build and, downstream, the
// Docker image. Other components here import React because they use hooks.
import { Select } from "@/components/ui/modal";

/** OHADA member states — the product's home region. */
const OHADA: [string, string][] = [
  ["CM", "Cameroun / Cameroon"],
  ["BJ", "Bénin"],
  ["BF", "Burkina Faso"],
  ["CF", "Centrafrique"],
  ["KM", "Comores"],
  ["CG", "Congo"],
  ["CI", "Côte d'Ivoire"],
  ["GA", "Gabon"],
  ["GN", "Guinée"],
  ["GW", "Guinée-Bissau"],
  ["GQ", "Guinée équatoriale"],
  ["ML", "Mali"],
  ["NE", "Niger"],
  ["CD", "RD Congo"],
  ["SN", "Sénégal"],
  ["TD", "Tchad"],
  ["TG", "Togo"],
];

/** Common counterparties: regional neighbours and the main trade lanes. */
const PARTNERS: [string, string][] = [
  ["NG", "Nigeria"],
  ["GH", "Ghana"],
  ["ZA", "South Africa"],
  ["KE", "Kenya"],
  ["MA", "Maroc / Morocco"],
  ["EG", "Egypt"],
  ["FR", "France"],
  ["BE", "Belgique / Belgium"],
  ["NL", "Nederland / Netherlands"],
  ["DE", "Deutschland / Germany"],
  ["ES", "España / Spain"],
  ["IT", "Italia / Italy"],
  ["GB", "United Kingdom"],
  ["PT", "Portugal"],
  ["TR", "Türkiye"],
  ["AE", "United Arab Emirates"],
  ["SA", "Saudi Arabia"],
  ["IN", "India"],
  ["CN", "China"],
  ["HK", "Hong Kong"],
  ["SG", "Singapore"],
  ["JP", "Japan"],
  ["KR", "Korea"],
  ["US", "United States"],
  ["CA", "Canada"],
  ["BR", "Brazil"],
];

export function CountrySelect({
  value,
  onChange,
  allowEmpty = true,
}: {
  value?: string | null;
  onChange: (code: string) => void;
  allowEmpty?: boolean;
}) {
  const current = (value || "").toUpperCase();
  const known = [...OHADA, ...PARTNERS].some(([c]) => c === current);

  return (
    <Select value={current} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">—</option>}
      {/* An existing value we don't list stays selectable, so opening and saving
          an old record can't silently rewrite its country. */}
      {current && !known && <option value={current}>{current}</option>}
      <optgroup label="OHADA">
        {OHADA.map(([code, label]) => (
          <option key={code} value={code}>{label}</option>
        ))}
      </optgroup>
      <optgroup label="Other">
        {PARTNERS.map(([code, label]) => (
          <option key={code} value={code}>{label}</option>
        ))}
      </optgroup>
    </Select>
  );
}
