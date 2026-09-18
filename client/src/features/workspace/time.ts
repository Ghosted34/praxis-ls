/**
 * Tenant-local Workspace time helpers.
 *
 * API timestamps are instants. Workspace date fields are tenant wall-clock
 * values. These helpers are the boundary: format an instant with the tenant
 * timezone, and seed a zoneless datetime input from the same timezone without
 * passing through the browser's local Date getters.
 */

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function parts(value: string | Date, timeZone: string): Parts | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const fields = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(fields.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The tenant-local calendar day for an instant. */
export function tenantDay(value: string | Date, timeZone: string): string {
  const p = parts(value, timeZone);
  return p ? `${p.year}-${pad(p.month)}-${pad(p.day)}` : "";
}

/** A date-only cursor moved by whole calendar days, independent of DST. */
export function addTenantDays(day: string, amount: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return "";
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/** A safe local Date used only for drawing a date-only calendar cursor. */
export function dateFromTenantDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
    0,
    0,
    0,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The current day on the tenant clock, not the browser clock. */
export function tenantToday(
  timeZone: string,
  value: Date = new Date(),
): string {
  return tenantDay(value, timeZone);
}

/**
 * Add wall-clock minutes to a zoneless `YYYY-MM-DDTHH:mm` value. This is used
 * only for a form default ("one hour after start"); the server remains the
 * authority that turns the submitted wall time into an instant around DST.
 */
export function addWallMinutes(value: string, amount: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return "";
  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    ),
  );
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCMinutes(date.getUTCMinutes() + amount);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export function tenantWallInput(
  value: string | Date,
  timeZone: string,
): string {
  const p = parts(value, timeZone);
  return p
    ? `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
    : "";
}

/** Just the clock, on the tenant's zone — a chip's worth of "17:30". */
export function tenantTimeFmt(
  value: string | Date | null | undefined,
  timeZone: string,
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function tenantDateTimeFmt(
  value: string | Date | null | undefined,
  timeZone: string,
): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
