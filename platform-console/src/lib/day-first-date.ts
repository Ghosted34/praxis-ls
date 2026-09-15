/**
 * Day-first date conversion — the canonical copy.
 *
 * ── THERE ARE TWO OF THIS FILE, BYTE FOR BYTE ──────────────────────────────
 *
 *   client/src/lib/day-first-date.ts
 *   platform-console/src/lib/day-first-date.ts
 *
 * Both apps render their own `DateField` (one is Tailwind + the `Input`
 * primitive, the other is the console's plain CSS), but the part that must not
 * differ is this: what counts as a real date, and how dd/mm/yyyy maps to the
 * ISO the API stores. A second answer to "is 31/02 a date" is a bug waiting for
 * whichever app gets less attention.
 *
 * A relative import across the two apps was tried first and does not work. The
 * Dockerfile's `consolebuild` stage copies ONLY `platform-console/` — the client
 * and public-web stages copy the whole repo because they have `file:..`
 * dependencies, and the console deliberately has none — so `../../../client/…`
 * resolves in a checkout, builds locally, and then fails inside the image. That
 * boundary is deliberate and worth more than the deduplication.
 *
 * So the copies are kept honest by a GATE instead of by an import:
 * `scripts/check-date-format.js` fails the build if the two files differ by a
 * single byte. Edit either one and copy it over the other; the gate prints the
 * command.
 *
 * Deliberately dependency-free — no imports, no path aliases, nothing that has
 * to resolve through a bundler config — so the copies cannot drift through
 * their surroundings either.
 */

/** ISO `YYYY-MM-DD` → display `dd/mm/yyyy` (empty for anything else). */
export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Display `dd/mm/yyyy` → ISO `YYYY-MM-DD`, or "" when incomplete/impossible.
 *  The round-trip check rejects a real-looking-but-invalid date like 31/02. */
export function displayToIso(display: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (!m) return "";
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1) return "";
  const dt = new Date(year, month - 1, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  )
    return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Keep only digits and re-insert the slashes as the operator types. */
export function maskInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * The sentence a browser shows when the box does not hold a usable date, or
 * `""` when it does. ISO strings compare lexicographically, so `min`/`max` need
 * no parsing.
 *
 * `t` translates; pass `tr` in the client, and leave it out in the console,
 * which is English-only and Praxis-side.
 */
export function validityMessage(
  text: string,
  iso: string,
  {
    required,
    min,
    max,
    t = (s: string) => s,
  }: {
    required?: boolean;
    min?: string;
    max?: string;
    t?: (s: string) => string;
  },
): string {
  if (!text) return required ? t("Enter a date.") : "";
  if (!iso) return t("Enter a real date as dd/mm/yyyy.");
  if (min && iso < min)
    return `${t("Choose a date on or after")} ${isoToDisplay(min)}.`;
  if (max && iso > max)
    return `${t("Choose a date on or before")} ${isoToDisplay(max)}.`;
  return "";
}

/* ── the same thing, with a time on the end ──────────────────────────────────
 *
 * `<input type="datetime-local">` has exactly the defect `type="date"` has, and
 * for the same reason: it renders its DATE part in the OS locale, so a US
 * workstation shows "09/11/2026, 02:00 PM" for the 11th of September. The ban on
 * native date inputs missed it at first because it is a different `type`.
 *
 * The wire format is `YYYY-MM-DDTHH:mm` — what the native control emits and what
 * the API already accepts — so only the display changes. Time is 24-hour: these
 * are operational timestamps (a vessel ETA, an incident, a scheduled send), and
 * "14:00" cannot be misread the way "2:00" can.
 */

/** ISO `YYYY-MM-DDTHH:mm` → display `dd/mm/yyyy HH:mm` ("" for anything else). */
export function isoToDisplayDateTime(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : "";
}

/** Display `dd/mm/yyyy HH:mm` → ISO `YYYY-MM-DDTHH:mm`, or "" when the date is
 *  incomplete/impossible or the clock time does not exist. */
export function displayToIsoDateTime(display: string): string {
  const m = /^(\d{2}\/\d{2}\/\d{4}) (\d{2}):(\d{2})$/.exec(display);
  if (!m) return "";
  const date = displayToIso(m[1]);
  if (!date) return "";
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (hour > 23 || minute > 59) return "";
  return `${date}T${m[2]}:${m[3]}`;
}

/** Keep only digits and re-insert the separators as the operator types. */
export function maskDateTimeInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 12);
  const date = maskInput(digits.slice(0, 8));
  if (digits.length <= 8) return date;
  if (digits.length <= 10) return `${date} ${digits.slice(8)}`;
  return `${date} ${digits.slice(8, 10)}:${digits.slice(10)}`;
}

/** The validity sentence for a date-and-time box. Bounds are compared on the
 *  ISO strings, which sort correctly for this shape too. */
export function validityMessageDateTime(
  text: string,
  iso: string,
  {
    required,
    min,
    max,
    t = (s: string) => s,
  }: {
    required?: boolean;
    min?: string;
    max?: string;
    t?: (s: string) => string;
  },
): string {
  if (!text) return required ? t("Enter a date and time.") : "";
  if (!iso) return t("Enter a real date and time as dd/mm/yyyy HH:mm.");
  if (min && iso < min)
    return `${t("Choose a time on or after")} ${isoToDisplayDateTime(min)}.`;
  if (max && iso > max)
    return `${t("Choose a time on or before")} ${isoToDisplayDateTime(max)}.`;
  return "";
}
