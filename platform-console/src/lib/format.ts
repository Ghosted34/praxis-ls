/**
 * Date display for the console. ALL of it is day-first.
 *
 * `undefined` as the locale means "whatever this workstation is set to", which
 * on a US-configured machine renders "Sep 11, 2026" and — where the format is
 * all-numeric — "9/11/2026". Praxis is read day-first, and a support engineer
 * reading an error's first-seen date as the 9th of November when it was the
 * 11th of September is a wrong answer delivered confidently. en-GB is pinned
 * for the same reason the tenant client pins it: the shape must not depend on
 * who is looking. `scripts/check-date-format.js` fails the build on a
 * locale-less date format anywhere in the tree.
 */
const DATE_LOCALE = "en-GB";

export function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(DATE_LOCALE, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString(DATE_LOCALE, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Strict numeric day-first: dd/mm/yyyy. Built by hand rather than by locale,
 *  so it cannot flip to month-first however the workstation is configured. */
export function fmtDateDmy(v?: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function titleCase(s?: string | null): string {
  if (!s) return "—";
  return String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initials(name?: string | null, email?: string | null): string {
  const s = (name || email || "?").trim();
  const p = s.split(/[\s@._]+/).filter(Boolean);
  return ((p[0] || "?")[0] + ((p[1] || "")[0] || "")).toUpperCase();
}

/** Turn an audit action key into a human sentence:
 *  "tenant.plan_changed" → "Tenant plan changed", "feature.toggled" → "Feature toggled". */
export function humanizeAction(a?: string | null): string {
  if (!a) return "—";
  const w = String(a).replace(/[._]+/g, " ").trim();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : "—";
}

/** SCREAMING_SNAKE / dotted enum → "Sentence case": "IN_PROGRESS" → "In progress". */
export function enumLabel(v?: string | null): string {
  if (v === null || v === undefined || v === "") return "—";
  const w = String(v).replace(/[._]+/g, " ").trim().toLowerCase();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : "—";
}

/** Compact, human "key: value" summary of a small JSON payload (no raw braces). */
export function kvSummary(obj?: Record<string, unknown> | null): string {
  if (!obj || typeof obj !== "object") return "—";
  const entries = Object.entries(obj);
  if (!entries.length) return "—";
  return entries
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v && typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

export function money(v?: string | number | null): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
