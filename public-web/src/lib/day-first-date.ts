/**
 * Day-first date conversion for public-web — the three pure functions of
 * `client/src/lib/day-first-date.ts`, copied VERBATIM.
 *
 * ── WHY A SUBSET AND NOT THE THIRD TWIN ────────────────────────────────────
 *
 * The client and console copies are byte-identical twins (the date gate
 * compares them). This app cannot hold a third byte-identical copy: the
 * canonical file carries its validity SENTENCES as English literals, and
 * public-web's dictionary gate (`check:i18n`, rule 6) refuses a user-facing
 * sentence outside the dictionary — rightly, since a French client would read
 * them in English. The part that must never differ between apps is what
 * counts as a real date and how dd/mm/yyyy maps to ISO, and that part is here
 * unchanged; the sentences come from this app's dictionary instead.
 *
 * `day-first-date.test.ts` holds this copy to the canonical one function by
 * function, so the three answers to "is 31/02 a date" cannot drift apart.
 *
 * Dependency-free on purpose, like the canonical copy.
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
