import { currentLocale, tr } from "./i18n";

/**
 * Display formatters — the subset of `client/src/lib/format.ts` this app needs,
 * reproduced so a figure renders identically in the portal and in the ERP.
 *
 * THE RULE THIS FILE ENFORCES: nothing renders raw. A status, a date, a boolean
 * and an amount all go through here, because `IN_REVIEW` and `2026-07-03T00:00:00Z`
 * are database values, not sentences — and on a page a client's CFO reads, the
 * difference between "Trial balance" and "trial_balance" is the difference between
 * a product and a database dump.
 *
 * `parseLoose` is not paranoia. `new Date("2026-07-03")` is midnight UTC, so in a
 * negative-offset timezone `toLocaleDateString` reports the 2nd. A `date` column is
 * a calendar date with no instant in it; a shipment deadline that moves by a day
 * depending on where the reader is is worse than no deadline. The same reasoning is
 * why `dateDmy` is hand-built rather than delegated to `Intl`.
 *
 * NOT PORTED (no consumer here): `smartCell`, `fieldLabel`, `humanizeEvent`,
 * `friendlyModule`, `fmtRelative`, `expiryStatus`, `moneyCompact`. If a screen
 * needs one, port it from `client` rather than re-deriving it — five local money
 * formatters disagreeing on locale is the exact defect F6 in the frontend audit
 * exists to close.
 */

/** Grouped, 2dp, currency-suffixed: `1,250,000.00 XAF` / `1 250 000,00 XAF`. */
export function money(amount: unknown, currency: unknown = "XAF"): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "—";
  const cur =
    currency === null || currency === undefined || currency === ""
      ? "XAF"
      : String(currency);
  return `${n.toLocaleString(currentLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}

/** For a column whose HEADER already names the currency: grouped, no decimals,
 *  no suffix. Zero and empty both render "—" — in a client-facing list a 0 is
 *  almost always "not issued yet", and a column of zeros reads as noise. */
export function money0(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString(currentLocale(), { maximumFractionDigits: 0 });
}

/** Grouped 2dp, no suffix — ledger figures where the cents are the point. */
export function amount(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(currentLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function num(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n.toLocaleString(currentLocale()) : "—";
}

/** `YYYY-MM-DD`, optionally with a time part after it. */
const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseLoose(s: string): Date | null {
  const m = CALENDAR_DATE_RE.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** en keeps the shape the ERP settled on ("21 Jul 2026"); French uses fr-FR
 *  ("21 juil. 2026"). A public page must not depend on the OPERATOR's browser
 *  locale, which is what the pre-F6 code did. */
function dateLocale(): string {
  return currentLocale() === "fr-FR" ? "fr-FR" : "en-GB";
}

export function dateFmt(d: unknown): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : parseLoose(String(d));
  if (!dt || Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString(dateLocale(), {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function dateTimeFmt(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(String(d));
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString(dateLocale(), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * How long ago something happened, in words: "6 days ago" / "il y a 6 jours".
 *
 * ── WHY NOT THE ERP’S `fmtRelative` ──────────────────────────────────────
 *
 * `client/src/lib/format.ts` has one, and this file’s own header says to port
 * rather than re-derive. It cannot be ported: it returns "just now", "2d ago"
 * — English literals, on a surface whose whole claim is that it is bilingual to
 * the database column. `Intl.RelativeTimeFormat` says the same thing in the
 * reader’s language, at no bundle cost, and `numeric: "auto"` gives
 * "yesterday" / "hier" where a number would read as a machine.
 *
 * Days up to 30, then months, then null — past a year "13 months ago" is worse
 * than the date beside it, and every caller here prints that date anyway.
 */
export function dateAgo(d: unknown): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : parseLoose(String(d));
  if (!dt || Number.isNaN(dt.getTime())) return null;
  const days = Math.round((dt.getTime() - Date.now()) / 86_400_000);
  if (!Number.isFinite(days) || Math.abs(days) > 365) return null;
  const rtf = new Intl.RelativeTimeFormat(dateLocale(), { numeric: "auto" });
  return Math.abs(days) <= 30
    ? rtf.format(days, "day")
    : rtf.format(Math.round(days / 30), "month");
}

export function dateDmy(d: unknown): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : parseLoose(String(d));
  if (!dt || Number.isNaN(dt.getTime())) return "—";
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

/** `IN_REVIEW` → "In review". Acronym-shaped tokens keep their caps when they
 *  are statutory vocabulary — "Total Ttc" tells an accountant the page was not
 *  written for them, so the sentence-case rule stops at 3+ letter codes. */
export function enumLabel(v?: string | null): string {
  if (!v) return "—";
  const s = String(v);
  if (s.includes("_")) {
    const spaced = s.replace(/_/g, " ").toLowerCase();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
  if (/^[A-Z][A-Z0-9]{3,}$/.test(s))
    return s.charAt(0) + s.slice(1).toLowerCase();
  return s;
}

/**
 * An enum value as a label in the current language: `FULL_TIME` → "Full time" /
 * "Temps plein".
 *
 * `enumLabel` alone (which is all `client` does at its ~40 chip and table call
 * sites) is why the French ERP pages still read "In review" while their headings
 * are French: sentence-casing a token is a legibility fix, not a translation.
 * Anything that is not a `SNAKE_CASE` token passes through unchanged, so
 * `enumText("Douala")` is still "Douala" — the function never guesses.
 *
 * It lives here, next to `enumLabel`, and not in `i18n.ts`, because this module
 * already imports from that one; a helper in the other direction would make the
 * two files a cycle for the sake of one call.
 */
export function enumText(value?: string | null): string {
  return tr(enumLabel(value));
}

/**
 * A URL somebody actually typed, made into one a browser accepts.
 *
 * `<input type="url">` and Zod's `.url()` both demand a scheme and nobody writes
 * one, so a candidate's LinkedIn URL fails at SUBMIT — after the whole form, on
 * the one page in this product a stranger sees. Ported verbatim for the same
 * reason as the rest of this file.
 */
export function withScheme(value: string): string {
  const t = String(value || "").trim();
  if (!t) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("//")) return t;
  return `https://${t}`;
}
