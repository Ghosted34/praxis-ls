/**
 * The currencies this tenant actually runs in.
 *
 * NOT `SmartCurrencyPicker`, and the difference matters. That control searches
 * the whole ISO-4217 catalogue, because Settings › Currencies is where you go to
 * ADD one. Everywhere else — a salary, a costing line, an allowance — the answer
 * has to be a currency the tenant has already set up: `salary_currency` is
 * `char(3) REFERENCES currency(code)`, so anything else is a foreign-key
 * violation dressed up as a save failure, and a free-text box invites exactly
 * that (an employee salary in "CFA" or "FCFA" — neither is a code).
 *
 * The base currency leads the list and is marked, because it is the answer
 * nine times in ten and the tenant may not run in XAF.
 *
 * @example
 * <Field label="Currency">
 *   <CurrencySelect value={f.salary_currency} onChange={(v) => set("salary_currency", v)} />
 * </Field>
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Select } from "@/components/ui/modal";
import { useResource } from "@/lib/use-resource";
import { listCurrencies } from "@/lib/masterdata-api";
import { useBaseCurrency } from "@/lib/use-base-currency";

export function CurrencySelect({
  value,
  onChange,
  /** Shown as the empty option. Omit `allowEmpty` to make the field required-ish. */
  placeholder = "—",
  allowEmpty = true,
  id,
  "aria-label": ariaLabel,
  className,
}: {
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}) {
  const currencies = useResource(() => listCurrencies(), []);
  const base = useBaseCurrency();

  const rows = React.useMemo(() => {
    const active = (currencies.data || []).filter((c) => c.is_active !== false);
    // Base first, then alphabetical. A tenant with forty currencies configured
    // should not scroll past AED to reach the one they pay salaries in.
    return active.sort((a, b) => {
      if (a.code === base) return -1;
      if (b.code === base) return 1;
      return a.code.localeCompare(b.code);
    });
  }, [currencies.data, base]);

  // A value the tenant has since deactivated (or that predates the currency
  // master) must still be shown — a select that silently drops the saved code
  // renders as "—" and the next save clears a field nobody meant to touch.
  const current = (value || "").toUpperCase();
  const orphan = current && !rows.some((c) => c.code === current);

  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      className={className}
      value={current}
      onChange={(e) => onChange(e.target.value)}
    >
      {(allowEmpty || !current) && <option value="">{placeholder}</option>}
      {orphan && (
        <option value={current}>{`${current} — ${tr("not in your currency list")}`}</option>
      )}
      {rows.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code}
          {c.name ? ` — ${c.name}` : ""}
          {c.code === base ? ` (${tr("base")})` : ""}
        </option>
      ))}
    </Select>
  );
}
