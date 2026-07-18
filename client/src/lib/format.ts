/** Display formatters. Money is grouped, 2dp, currency-suffixed (pair with the
 *  `.num` tabular class); dates are short + unambiguous. */

export function money(amount: number | string | null | undefined, currency = "XAF"): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function num(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}

export function dateFmt(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Render any value as table/detail cell text. Empty → em dash.
 *
 * This existed twice after the 2026-07-18 merge — in components/data-list.tsx and
 * features/sales/ui.tsx — and the copies had diverged on boolean casing
 * ("Yes"/"No" vs "yes"/"no"), so the same value rendered differently depending on
 * which scaffold a screen used. This is now the single implementation; both modules
 * re-export it, so every existing import path keeps working.
 */
export function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
