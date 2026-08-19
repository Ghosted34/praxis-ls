/**
 * The tenant's base currency code, for screens that label amounts in it.
 *
 * WHY. Several admin screens hardcoded "(XAF)" in field labels and column
 * headers, because the `*_xaf` columns they read are base-currency amounts. The
 * currency master (Settings → Currencies) already lets a tenant change the base
 * away from XAF; those labels would then lie. This hook resolves the actual
 * base code from `/currencies` so a label reads "(USD)" or "(EUR)" when that is
 * what the tenant actually runs in.
 *
 * Falls back to "XAF" while loading / when no currency is flagged base, which
 * is the seeded default — so a screen never renders "(null)" or an empty
 * suffix, and behaviour for the unconfigured case is unchanged.
 */
import { useQuery } from "@tanstack/react-query";
import { tenant } from "./api-client";
import { tenantKey } from "./query-client";

type CurrencyRow = { code: string; is_base?: boolean };

export function useBaseCurrency(): string {
  const { data } = useQuery<CurrencyRow[]>({
    queryKey: tenantKey("currencies"),
    queryFn: () => tenant<CurrencyRow[]>("/currencies"),
    staleTime: 5 * 60 * 1000,
  });
  if (!Array.isArray(data) || data.length === 0) return "XAF";
  const base = data.find((c) => c.is_base);
  return (base && base.code) || "XAF";
}
