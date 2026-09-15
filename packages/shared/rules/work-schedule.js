"use strict";
const { z } = require("zod");

/**
 * The working week, as data.
 *
 * ── WHY THIS IS NOT A TEXT BOX ─────────────────────────────────────────────
 *
 * `employee.working_hours` has been free text since 12763, and a contract
 * prints it verbatim: "Mon–Fri, 08:00–17:00". That was enough while everybody
 * worked the same five days in the same building. It stopped being enough the
 * moment somebody works Friday from home, because there is nowhere to say so —
 * a clerk types it into the same string in whatever words occur to them, and
 * the thing that has to ANSWER "is this person on site on Friday" (dispatch,
 * attendance, a hybrid-allowance rule) is left parsing prose.
 *
 * So the week is recorded per day: worked or not, from when to when, on site or
 * remote. `employee.work_schedule` holds that; `employee.working_hours` stays,
 * and is DERIVED from it by `summarise()` on every write — which is the point
 * of putting the shape here rather than in either app. The form draws the days,
 * the API validates them, and both render the printed line through one
 * function, so the sentence on the contract cannot drift from the grid HR
 * filled in.
 *
 * A record whose `working_hours` predates this carries no schedule, and that is
 * a distinct state from "works nothing": `normalise(null)` returns null and the
 * form offers to replace the old text rather than silently rewriting a term
 * somebody agreed to.
 */

/** Monday first — the working week as Cameroon (and the OHADA contract) reads it. */
const DAYS = [
  { code: "MON", label: "Monday", short: "Mon" },
  { code: "TUE", label: "Tuesday", short: "Tue" },
  { code: "WED", label: "Wednesday", short: "Wed" },
  { code: "THU", label: "Thursday", short: "Thu" },
  { code: "FRI", label: "Friday", short: "Fri" },
  { code: "SAT", label: "Saturday", short: "Sat" },
  { code: "SUN", label: "Sunday", short: "Sun" },
];
const DAY_CODES = DAYS.map((d) => d.code);

/** Where the day is worked. On site is the default and prints unannotated. */
const MODES = ["ON_SITE", "REMOTE"];

/** The default the form opens with: a nine-to-five, Monday to Friday, on site. */
const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";
const DEFAULT_WORKED = new Set(["MON", "TUE", "WED", "THU", "FRI"]);

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "9:5" → "09:05"; anything that is not a time of day → null. */
function normaliseTime(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw === "") return null;
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(raw);
  if (!m) return null;
  const hh = String(Number(m[1])).padStart(2, "0");
  const mm = String(Number(m[2])).padStart(2, "0");
  const out = `${hh}:${mm}`;
  return TIME_RE.test(out) ? out : null;
}

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** One day, filled in. */
function defaultDay(code) {
  return {
    day: code,
    worked: DEFAULT_WORKED.has(code),
    start: DEFAULT_START,
    end: DEFAULT_END,
    mode: "ON_SITE",
  };
}

/** The week the new-employee form opens with. */
function defaultSchedule() {
  return { days: DAY_CODES.map(defaultDay) };
}

/**
 * Coerce whatever arrived into the canonical shape, or null.
 *
 * Accepts the object form `{ days: [...] }` and a bare array of days, because
 * the first is what is stored and the second is what a hand-written API call
 * will send. Days may arrive in any order and may be partial: a code that is
 * not a weekday is dropped, a missing day is filled in as not worked, and a
 * worked day with an unreadable time falls back to the default hours rather
 * than being thrown away — a schedule with one mistyped field is still mostly
 * the answer somebody meant.
 *
 * Returns null for null/undefined/anything that is not a schedule, so "no
 * schedule recorded" stays distinguishable from "a week with no working days".
 */
function normalise(input) {
  if (input === null || input === undefined) return null;
  const rows = Array.isArray(input)
    ? input
    : typeof input === "object" && Array.isArray(input.days)
      ? input.days
      : null;
  if (!rows) return null;

  const byDay = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const code = String(row.day || row.code || "").toUpperCase();
    if (!DAY_CODES.includes(code) || byDay.has(code)) continue;
    const worked = row.worked !== false;
    const start = normaliseTime(row.start) || DEFAULT_START;
    const end = normaliseTime(row.end) || DEFAULT_END;
    const mode = MODES.includes(String(row.mode || "").toUpperCase())
      ? String(row.mode).toUpperCase()
      : "ON_SITE";
    byDay.set(code, { day: code, worked, start, end, mode });
  }
  if (!byDay.size) return null;

  return {
    days: DAY_CODES.map(
      (code) => byDay.get(code) || { ...defaultDay(code), worked: false },
    ),
  };
}

/** The days actually worked, in week order. */
const workedDays = (schedule) =>
  ((schedule && schedule.days) || []).filter((d) => d.worked);

/**
 * Hours in the week, as a number.
 *
 * An end before its start is a night shift that crosses midnight (a warehouse
 * 22:00–06:00), not a typo — counting it as negative eight hours would be the
 * only reading that is certainly wrong.
 */
function weeklyHours(schedule) {
  let minutes = 0;
  for (const d of workedDays(schedule)) {
    const span = minutesOf(d.end) - minutesOf(d.start);
    minutes += span >= 0 ? span : span + 24 * 60;
  }
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * On-site, Remote or Hybrid — the same three words `vacancy.work_mode` uses,
 * so an advert and the record it hires into describe the arrangement alike.
 */
function workMode(schedule) {
  const days = workedDays(schedule);
  if (!days.length) return null;
  const remote = days.filter((d) => d.mode === "REMOTE").length;
  if (remote === 0) return "On-site";
  if (remote === days.length) return "Remote";
  return "Hybrid";
}

const shortOf = (code) => (DAYS.find((d) => d.code === code) || {}).short || code;

/** "MON","TUE","WED" → "Mon–Wed"; "MON","WED" → "Mon, Wed". */
function labelRun(codes) {
  if (codes.length === 1) return shortOf(codes[0]);
  if (codes.length === 2) return `${shortOf(codes[0])}, ${shortOf(codes[1])}`;
  return `${shortOf(codes[0])}–${shortOf(codes[codes.length - 1])}`;
}

/**
 * The line a contract prints.
 *
 * Consecutive days on the same hours and in the same place collapse into one
 * run, because "Mon–Fri, 09:00–17:00" is what the clause says and
 * "Mon 09:00–17:00; Tue 09:00–17:00; …" is the same fact made unreadable. Only
 * remote is annotated: on site is the assumption everywhere else in the
 * document, and saying it seven times buys nothing.
 *
 * Stays inside the 200 characters `working_hours` accepts even in the worst
 * case (seven days, each different, each remote).
 */
function summarise(schedule) {
  const s = normalise(schedule);
  if (!s) return "";
  const days = workedDays(s);
  if (!days.length) return "No fixed working days";

  const runs = [];
  for (const d of days) {
    const last = runs[runs.length - 1];
    const contiguous =
      last &&
      DAY_CODES.indexOf(d.day) ===
        DAY_CODES.indexOf(last.codes[last.codes.length - 1]) + 1;
    if (last && contiguous && last.start === d.start && last.end === d.end && last.mode === d.mode) {
      last.codes.push(d.day);
    } else {
      runs.push({ codes: [d.day], start: d.start, end: d.end, mode: d.mode });
    }
  }

  const uniform =
    runs.length === 1 ||
    runs.every(
      (r) => r.start === runs[0].start && r.end === runs[0].end && r.mode === runs[0].mode,
    );
  if (uniform) {
    const label = runs.map((r) => labelRun(r.codes)).join(", ");
    const remote = runs[0].mode === "REMOTE" ? " (remote)" : "";
    return `${label}, ${runs[0].start}–${runs[0].end}${remote}`;
  }
  return runs
    .map(
      (r) =>
        `${labelRun(r.codes)} ${r.start}–${r.end}${r.mode === "REMOTE" ? " (remote)" : ""}`,
    )
    .join("; ");
}

/**
 * The wire shape, so the API and the form agree on what a schedule IS.
 *
 * It lives here rather than in `employees.validator.js` for the reason the whole
 * package exists: a `day` enum written out on the API side is one that gains an
 * eighth day, or loses SAT, without the control that draws the checkboxes ever
 * hearing about it. `DAY_CODES` and `MODES` above are the only statement of the
 * vocabulary, and this is the only statement of the payload.
 *
 * Every field but `day` is optional because `normalise()` fills the gaps: a
 * caller sending `{day:"MON"}` means "Monday, as it comes". No refinement that
 * `end` follows `start` — 22:00–06:00 is a night shift, not a typo.
 */
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time in the form HH:MM");
const daySchema = z.object({
  day: z.enum(DAY_CODES),
  worked: z.boolean().optional(),
  start: time.optional(),
  end: time.optional(),
  mode: z.enum(MODES).optional(),
});
/** The week, as `employee.work_schedule` accepts it. Nullable: clearing the
 *  grid is a real edit, and it takes the derived line with it. */
const schema = z.object({ days: z.array(daySchema).max(7) }).optional().nullable();

module.exports = {
  daySchema,
  schema,
  DAYS,
  DAY_CODES,
  MODES,
  DEFAULT_START,
  DEFAULT_END,
  defaultSchedule,
  normalise,
  normaliseTime,
  summarise,
  weeklyHours,
  workMode,
  workedDays,
};
