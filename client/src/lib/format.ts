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
  const cur =
    currency === null || currency === undefined || currency === ""
      ? "XAF"
      : String(currency);
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
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
  const dt = d instanceof Date ? d : parseLoose(String(d));
  if (!dt || Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** `YYYY-MM-DD`, optionally with a time part after it. */
const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse an API date value WITHOUT moving the day.
 *
 * `new Date("2021-09-21")` is midnight **UTC**, so `toLocaleDateString` in any
 * negative-offset timezone renders it as the 20th. A `date` column carries no
 * time and no zone — it is a calendar date — so a bare `YYYY-MM-DD` is built as
 * LOCAL midnight instead, which is the only reading that survives formatting.
 *
 * Anything with a time part is a real instant (`created_at`, or a `date` from a
 * server that predates `shared/db/pg-date-types`) and is parsed normally.
 */
function parseLoose(s: string): Date | null {
  const m = CALENDAR_DATE_RE.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * An API value as `<input type="date">` needs it: `YYYY-MM-DD`, or `""`.
 *
 * THE DEFECT THIS CLOSES. A date input given anything else renders BLANK and
 * keeps no value of its own, so a form seeded with `2021-09-21T00:00:00.000Z`
 * showed an empty control for a date that was saved — and posted the timestamp
 * back on save, which the API rejects (`Use the format YYYY-MM-DD.`). Users had
 * to retype every date on every edit, on rows they had not touched.
 *
 * `shared/db/pg-date-types` fixes that at the source, so `date` columns now
 * arrive already in this shape. This stays as the form-side guard: it is the one
 * place that decides what a date control is seeded with, so a timestamp reaching
 * a date field again (a `timestamptz` column bound to one, a cached response
 * from an older API) degrades to the right day instead of a blank box.
 *
 * A timestamp is resolved in the LOCAL timezone rather than sliced, because the
 * ten characters in front of the `T` are the UTC day: `2021-09-20T23:00:00Z` is
 * the 21st for the reader who saved it, and slicing would silently rewind it.
 */
export function toDateInput(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string" && CALENDAR_DATE_RE.test(v)) return v;
  const dt = v instanceof Date ? v : parseLoose(String(v));
  if (!dt || Number.isNaN(dt.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** Short date + time, e.g. "21 Jul 2026, 23:00". */
export function dateTimeFmt(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const { humanize } =
    require("./audit-humanize") as typeof import("./audit-humanize");
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
 * PREVIOUSLY THIS COVERED SIX CODES. Every module the ledger could actually
 * carry that wasn't one of those six rendered as its raw "MOD-11" / "MOD-04"
 * — that's what a Vacancies or Supplier row showed on the Control Tower
 * widget. Coverage is now the full catalogue (`platform.module_catalogue`,
 * seeded in migrations/seeds/9100_seed_platform_catalogue.sql, plus the two
 * modules added later in 9120/9130), so every module_key a row can carry
 * resolves to a name instead of a code.
 *
 * Labels are shortened/lower-cased from the catalogue's admin-console names
 * ("Supplier / Partner Master" → "Suppliers") to read as a place in the
 * product rather than a database row, and made to match the nav labels
 * visible elsewhere in the shell where one exists (e.g. "Vacancies",
 * "Purchase orders", "Cash requests").
 */
const MODULE_LABEL: Record<string, string> = {
  "MOD-00A": "Your workspace",
  "MOD-00B": "God Mode",
  "MOD-01": "Corporate entities",
  "MOD-02": "Employees",
  "MOD-03": "Clients",
  "MOD-04": "Suppliers",
  "MOD-05": "Financial dictionary",
  "MOD-06": "Chart of accounts",
  "MOD-07": "Tax",
  "MOD-08": "Currency & FX",
  "MOD-09": "Treasury accounts",
  "MOD-10": "Expense rates",
  "MOD-11": "Vacancies",
  "MOD-12": "Contracts",
  "MOD-13": "Appraisals",
  "MOD-14": "Attendance",
  "MOD-15": "Leave & allowances",
  "MOD-16": "Onboarding",
  "MOD-17": "Payroll",
  "MOD-18": "Trainings",
  "MOD-19": "Talent pool",
  "MOD-20": "Leads",
  "MOD-21": "Meetings",
  "MOD-22": "Campaigns",
  "MOD-23": "Proposals",
  "MOD-24": "Sales pipeline",
  "MOD-25": "Inbound intake",
  "MOD-26": "Project portfolio",
  "MOD-27": "Margin simulation",
  "MOD-28": "Extra-charge simulation",
  "MOD-29": "Operations files",
  "MOD-30": "Transit orders",
  "MOD-31": "Milestones",
  "MOD-32": "Delivery notes",
  "MOD-33": "Inbound operations",
  "MOD-34": "Warehouse locations",
  "MOD-35": "Inventory",
  "MOD-36": "Outbound operations",
  "MOD-37": "Equipment",
  "MOD-38": "Cycle counting",
  "MOD-39": "Vehicles",
  "MOD-40": "Vehicle compliance",
  "MOD-41": "Work orders",
  "MOD-42": "Dispatch",
  "MOD-43": "Fuel logs",
  "MOD-44": "Drivers",
  "MOD-45": "Incidents",
  "MOD-46": "Costing",
  "MOD-47": "Cost tracking",
  "MOD-48": "Cost reconciliation",
  "MOD-49": "Cash requests",
  "MOD-50": "Proforma invoices",
  "MOD-51": "Invoices",
  "MOD-52": "Receivables",
  "MOD-53": "Financing",
  "MOD-54": "Assets",
  "MOD-55": "Journal entries",
  "MOD-56": "General ledger",
  "MOD-57": "Income statement",
  "MOD-58": "Profit & loss",
  "MOD-59": "Cash-flow statement",
  "MOD-60": "Purchase orders",
  "MOD-61": "Goods received",
  "MOD-62": "Purchase requests",
  "MOD-63": "Reporting",
  "MOD-64": "Messaging",
  "MOD-65": "Compliance",
  "MOD-66": "Document verification",
  // The IAM/RBAC engine — every personal-account action (login, password,
  // 2FA — app_user.events.js) AND every RBAC-admin action (role/permission/
  // capability/field_visibility/scope changes) share this ONE code. This is
  // the code-only default; DOMAIN_LABEL below overrides it to "Your account"
  // specifically for the personal-account actions when we have the row's
  // action to check.
  "MOD-67": "Security & access",
  "MOD-68": "Sessions",
  "MOD-69": "Governance",
  "MOD-70": "Settings",
  "MOD-71": "HR discipline",
  "MOD-72": "Mail",
  "MOD-73": "Document vault",
  "MOD-74": "Support & feedback",
  "MOD-75": "Governance & approvals",
};

/**
 * Domain (the leading segment of `action`, e.g. "auth" in
 * "auth.login_succeeded") → Area label, for the handful of module codes one
 * code covers more than one area a user would recognise as different places
 * in the product. Consulted BEFORE the code-based table above when an action
 * is available, and also used as the legacy bare-domain fallback below (for
 * pre-MOD-xx rows that stored the domain string itself as module_key).
 *
 *   MOD-67 is both "you reset your password" (app_user.events.js) and "you
 *   changed a role's permissions" (permission/role/capability/… .events.js)
 *   — the previous code mapped the whole code to "Your account" unconditionally,
 *   so a role or permission change under MOD-67 always read as personal
 *   account activity, never as the security-sensitive access change it was.
 */
const DOMAIN_LABEL: Record<string, string> = {
  auth: "Your account",
  app_user: "Your account",
  permission: "Security & access",
  role: "Security & access",
  capability: "Security & access",
  field_visibility: "Security & access",
  scope: "Security & access",
  iam_role: "Security & access",
  audit_ledger: "Governance",
  soft_delete: "Governance",
  godmode: "God Mode",
  session: "Sessions",
  numbering_setting: "Numbering",
  comms: "Messaging",
  channel: "Messaging",
  attendance: "Attendance",
};

/**
 * `action` is optional and only needed to disambiguate the handful of
 * module codes DOMAIN_LABEL overrides (see above) — every other module_key
 * resolves from MODULE_LABEL alone, same as before.
 */
export function friendlyModule(
  moduleKey?: string | null,
  action?: string | null,
): string {
  if (!moduleKey) return "Activity";
  const s = String(moduleKey).trim();
  if (!s) return "Activity";

  const domain = action
    ? String(action).split(".")[0]?.trim().toLowerCase()
    : "";
  if (domain && DOMAIN_LABEL[domain]) return DOMAIN_LABEL[domain];

  const upper = s.toUpperCase();
  if (MODULE_LABEL[upper]) return MODULE_LABEL[upper];

  // Legacy rows that stored a bare domain instead of a MOD-xx code — same
  // table, keyed on the module_key itself this time, so those still read
  // sensibly.
  const lower = s.toLowerCase();
  if (DOMAIN_LABEL[lower]) return DOMAIN_LABEL[lower];
  if (lower.startsWith("auth")) return "Your account";
  if (lower.startsWith("comms")) return "Messaging";
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
  if (/^[A-Z][A-Z0-9]{3,}$/.test(s))
    return s.charAt(0) + s.slice(1).toLowerCase();
  return s;
}

/**
 * Acronyms and codes that must not be sentence-cased by `fieldLabel`. Mostly
 * OHADA / Cameroon statutory vocabulary, which is exactly the vocabulary that
 * looks wrong when a generic humaniser gets hold of it: "Total Ttc" instead of
 * "Total TTC" tells an accountant the screen was not built for them.
 */
const ACRONYMS = new Set([
  "ttc",
  "ht",
  "tva",
  "niu",
  "rccm",
  "coa",
  "xaf",
  "fx",
  "po",
  "kyc",
  "ai",
  "api",
  "url",
  "id",
  "hr",
  "vat",
  "iban",
  "bic",
  "cnps",
  "irpp",
  "sms",
  "pdf",
  "csv",
  "eta",
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
  if (words.length > 1 && words[words.length - 1].toLowerCase() === "id")
    words.pop();
  // "created_at" / "updated_at" read better without the preposition.
  if (words.length > 1 && words[words.length - 1].toLowerCase() === "at")
    words.pop();
  if (!words.length) return String(key);
  const out = words.map((w) =>
    ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase(),
  );
  out[0] = out[0].charAt(0).toUpperCase() + out[0].slice(1);
  return out.join(" ");
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  if (typeof v === "number")
    return Number.isInteger(v)
      ? v.toLocaleString("en-US")
      : v.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  if (Array.isArray(v))
    return v.length ? `${v.length} item${v.length === 1 ? "" : "s"}` : "—";
  if (typeof v === "object") {
    const pairs = Object.entries(v as Record<string, unknown>).filter(
      ([, x]) => x !== null && x !== undefined && x !== "",
    );
    if (!pairs.length) return "—";
    return (
      pairs
        .slice(0, 4)
        .map(
          ([k, x]) =>
            `${k.replace(/_/g, " ")}: ${typeof x === "object" ? "…" : String(x)}`,
        )
        .join(" · ") + (pairs.length > 4 ? " · …" : "")
    );
  }
  const s = String(v);
  if (ISO_DATETIME_RE.test(s)) return dateTimeFmt(s);
  if (ISO_DATE_RE.test(s)) return dateFmt(s);
  if (UUID_RE.test(s)) return s.slice(0, 8);
  // Group ONLY decimal strings (the ledger's "1200000.00" money shape) — integer
  // strings stay raw: they may be account codes, period years or doc numbers.
  if (/^-?\d+\.\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n))
      return n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
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
  if (Array.isArray(v))
    return v.length ? v.map((x) => cell(x)).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
