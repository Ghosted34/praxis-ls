/** Display formatters. Money is grouped, 2dp, currency-suffixed (pair with the
 *  `.num` tabular class); dates are short + unambiguous. */

/**
 * THE money formatter (F6 — there were five: this one plus
 * `components/document-view.tsx:67`, `features/sales/ui.tsx:31` (`fmtMoney`),
 * `features/finance/pages.tsx:106` and `features/portal/portal-app.tsx:225`,
 * which disagreed on locale, currency default and fraction digits — so the same
 * amount rendered differently on two screens of the same ERP).
 *
 * `currency` is intentionally loose: rows carry it as an untyped column off the
 * API, and the shadow `fmtMoney` it replaces accepted `unknown`. A null/empty
 * currency falls back to XAF rather than rendering "1,000.00 null".
 */
export function money(amount: unknown, currency: unknown = "XAF"): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "—";
  const cur = currency === null || currency === undefined || currency === "" ? "XAF" : String(currency);
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
}

/** Money for table columns whose HEADER carries the currency ("Costing · XAF"):
 *  grouped, no decimals, no suffix — "50,400,000". Zero/empty → "—" (in a list,
 *  0 almost always means "not costed/priced yet", and a column of 0.00s reads
 *  as noise — the Lovable reference leaves these blank). */
export function money0(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Grouped to exactly 2dp with NO currency suffix — for ledger columns whose
 *  header already names the currency ("Debit · XAF"), where repeating it on
 *  every row is noise. `money0` is the same idea at zero decimals; use this one
 *  where the cents are the point (journal lines, trial balance).
 *
 *  Absorbs the local `money` from `features/finance/pages.tsx:106` (F6). That
 *  copy formatted fr-FR while the canonical formatters format en-US, so the
 *  same figure carried a different decimal mark depending on which Finance
 *  screen you were on. One locale now — see the consolidation commit. */
export function amount(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function num(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}

/**
 * Short unambiguous date, e.g. "21 Jul 2026".
 *
 * Absorbs `when()` from the deleted `features/sales/ui.tsx:25` (F6), which
 * produced the same shape but through the browser's default locale rather than
 * en-GB — so the same timestamp rendered "21 Jul 2026" on one screen and
 * "Jul 21, 2026" on another for a US-locale operator. `unknown` is accepted
 * because that is what `when` took: these are `Row` values off the API, not
 * pre-narrowed strings.
 */
export function dateFmt(d: unknown): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(String(d));
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Short date + time, e.g. "21 Jul 2026, 23:00". */
export function dateTimeFmt(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Humanize an event/action key.
 *
 * FOLDED INTO `audit-humanize.ts` (2026-08-06). The old implementation was a
 * mechanical `"payroll.status_changed" → "Payroll status changed"`, which is
 * what produced "Auth token refreshed · App user c2d39ee8" on every screen
 * that rendered ledger rows. It now delegates to `humanize()`, so the
 * Governance page's `humanizeEvent(action)` returns the same sentences the
 * Control Tower widget does — one source of truth for how a ledger action is
 * phrased.
 *
 * The signature stays permissive (`string | null | undefined`) because the
 * existing callers pass raw column values off `useList` rows. `humanize`
 * wants an `AuditFeedRow`, so we synthesise the minimum viable row from the
 * key alone — the humaniser tolerates missing metadata and entity_ref (it
 * falls back to the verb-only branch).
 */
export function humanizeEvent(key?: string | null): string {
  if (!key) return "Event";
  // Local require rather than a top-level import to avoid a cycle: audit-humanize
  // imports types from features/dashboard/use-my-audit-feed which itself imports
  // from lib. A dynamic-shape row is enough — humanize reads only .action,
  // .entity_ref and .metadata off it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { humanize } = require("./audit-humanize") as typeof import("./audit-humanize");
  const row = {
    ledger_id: 0,
    created_at: "",
    action: String(key),
    module_key: null,
    entity_ref: null,
    metadata: null,
    is_sensitive: false,
    actor_name_snapshot: null,
  };
  return humanize(row).text;
}

/**
 * "just now", "12m ago", "3h ago", "2d ago" — relative time for a recent
 * event. Falls back to `dateTimeFmt` past 30 days, so anything older reads as
 * a concrete date rather than a lie like "45d ago".
 *
 * Rounds down (Math.floor): 59 seconds is "just now", not "1m ago". That is
 * the natural read for a widget that revalidates every 60s — otherwise the
 * label flickers on the boundary. Empty/malformed → em dash, same as the
 * other formatters.
 */
export function fmtRelative(iso?: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diffMs = Date.now() - t;
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days <= 30) return `${days}d ago`;
  return dateTimeFmt(iso);
}

/**
 * "MOD-69" → "Governance". Turns the MOD-xx codes the ledger stores into a
 * human word for the "Area" line on the Recent activity card and detail
 * modal. Anything unmapped falls back to the raw code so a new module lands
 * in the reader as-is rather than as "Unknown".
 *
 * Coverage is the module keys visible in `src/shared/notifications/categories.js`
 * — the same set that reaches the notification inbox. The Governance /
 * Security cluster is spelled out explicitly because it makes up the bulk of
 * a self-scoped feed (auth, RBAC, capability, session all point at MOD-69).
 */
const MODULE_LABEL: Record<string, string> = {
  "MOD-01": "Your account",
  "MOD-14": "Attendance",
  "MOD-64": "Messaging",
  "MOD-67": "Your account",
  "MOD-69": "Governance",
  "MOD-70": "Numbering",
  "MOD-00A": "Your workspace",
  "MOD-00B": "God Mode",
};

export function friendlyModule(moduleKey?: string | null): string {
  if (!moduleKey) return "Activity";
  const s = String(moduleKey).trim();
  if (!s) return "Activity";
  const upper = s.toUpperCase();
  if (MODULE_LABEL[upper]) return MODULE_LABEL[upper];
  // A domain-prefix mapping: "auth", "app_user", "permission" → Your account /
  // Governance, so a legacy row that stored a bare domain instead of MOD-xx
  // still reads sensibly.
  const lower = s.toLowerCase();
  if (lower.startsWith("auth") || lower === "app_user") return "Your account";
  if (["permission", "role", "field_visibility", "capability", "audit_ledger", "session", "scope", "godmode"].includes(lower)) {
    return "Governance";
  }
  if (lower.startsWith("comms") || lower === "channel") return "Messaging";
  if (lower.startsWith("attendance")) return "Attendance";
  // Anything else stays as-is — better a raw code the operator can google
  // than a wrong label the humaniser fabricated.
  return s;
}

/** Humanize an entity ref "type:id" → "Type <short-id>". UUIDs are shortened to
 *  8 chars; readable ids (e.g. "seed.money-path") are kept whole. */
export function humanizeRef(ref?: string | null): string {
  if (!ref) return "";
  const i = ref.indexOf(":");
  if (i === -1) return ref;
  const type = ref.slice(0, i).replace(/[._]+/g, " ");
  const id = ref.slice(i + 1);
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id);
  const shownId = isUuid ? id.slice(0, 8) : id;
  return `${typeLabel} ${shownId}`;
}

/** Expiry bucket for dated compliance/licence items (expiry boards). */
export type ExpiryLevel = "valid" | "soon" | "expired" | "none";
export function expiryStatus(d?: string | null, soonDays = 30): ExpiryLevel {
  if (!d) return "none";
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return "none";
  const now = Date.now();
  if (t < now) return "expired";
  if (t < now + soonDays * 864e5) return "soon";
  return "valid";
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Humanize a SCREAMING_SNAKE enum token: "SUBMITTED_FOR_VALIDATION" →
 *  "Submitted for validation", "OPEN" → "Open". Short all-caps tokens (≤3
 *  chars: XAF, TVA, RED…) keep their case — they're codes, not words. */
export function enumLabel(v?: string | null): string {
  if (!v) return "—";
  const s = String(v);
  if (s.includes("_")) {
    const spaced = s.replace(/_/g, " ").toLowerCase();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }
  if (/^[A-Z][A-Z0-9]{3,}$/.test(s)) return s.charAt(0) + s.slice(1).toLowerCase();
  return s;
}

/**
 * Acronyms and codes that must not be sentence-cased by `fieldLabel`. Mostly
 * OHADA / Cameroon statutory vocabulary, which is exactly the vocabulary that
 * looks wrong when a generic humaniser gets hold of it: "Total Ttc" instead of
 * "Total TTC" tells an accountant the screen was not built for them.
 */
const ACRONYMS = new Set([
  "ttc", "ht", "tva", "niu", "rccm", "coa", "xaf", "fx", "po", "kyc", "ai", "api",
  "url", "id", "hr", "vat", "iban", "bic", "cnps", "irpp", "sms", "pdf", "csv", "eta",
]);

/**
 * Turn a raw database column into a column HEADER: "total_ttc" → "Total TTC",
 * "client_id" → "Client", "created_at" → "Created".
 *
 * Audit A4: `vault/pages.tsx:32-60` inferred report table columns via
 * `Object.keys()` and printed them unchanged, so an operator running a
 * catalogue report saw `total_ttc` and `client_id` as headings. Reports are a
 * customer-facing surface — on the client portal, literally so.
 *
 * This is a fallback for genuinely dynamic payloads. A table whose shape is
 * known should still spell its headers out; a human-written "Amount due" beats
 * anything derivable from `amount_due_ttc`.
 */
export function fieldLabel(key: string): string {
  const words = String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase → spaced
    .split(/[_\-\s.]+/)
    .filter(Boolean);
  // A trailing "_id" is plumbing: "client_id" is the Client column.
  if (words.length > 1 && words[words.length - 1].toLowerCase() === "id") words.pop();
  // "created_at" / "updated_at" read better without the preposition.
  if (words.length > 1 && words[words.length - 1].toLowerCase() === "at") words.pop();
  if (!words.length) return String(key);
  const out = words.map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  out[0] = out[0].charAt(0).toUpperCase() + out[0].slice(1);
  return out.join(" ");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Generic human-readable cell (FE_DESIGN_RULES §5) for tables that render
 * unknown/dynamic values (report viewers, raw-record tables).
 * ISO timestamps → dateTimeFmt, plain dates → dateFmt, UUIDs → first 8 chars,
 * numeric strings → grouped, SCREAMING_SNAKE → spaced, objects → "k: v" pairs
 * instead of raw JSON. Known-shape tables should still use the specific
 * formatters (money/dateFmt/…) directly.
 */
export function smartCell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length === 1 ? "" : "s"}` : "—";
  if (typeof v === "object") {
    const pairs = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && x !== undefined && x !== "");
    if (!pairs.length) return "—";
    return pairs.slice(0, 4).map(([k, x]) => `${k.replace(/_/g, " ")}: ${typeof x === "object" ? "…" : String(x)}`).join(" · ") + (pairs.length > 4 ? " · …" : "");
  }
  const s = String(v);
  if (ISO_DATETIME_RE.test(s)) return dateTimeFmt(s);
  if (ISO_DATE_RE.test(s)) return dateFmt(s);
  if (UUID_RE.test(s)) return s.slice(0, 8);
  // Group ONLY decimal strings (the ledger's "1200000.00" money shape) — integer
  // strings stay raw: they may be account codes, period years or doc numbers.
  if (/^-?\d+\.\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (/^[A-Z][A-Z0-9_]*_[A-Z0-9_]+$/.test(s)) return enumLabel(s);
  return s;
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
  // Arrays render as their members, not as JSON. The fourth copy of this helper
  // (settings/config-pages.tsx:26, now deleted) had this and the canonical one
  // did not, so a `recipients` or `formats` column showed `["a@b.com"]` with the
  // brackets and quotes on some screens and not others (F6).
  if (Array.isArray(v)) return v.length ? v.map((x) => cell(x)).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
