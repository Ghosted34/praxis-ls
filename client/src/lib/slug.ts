/**
 * Accent-safe slug helper — typed twin of `src/shared/text/slug.js`.
 *
 * The server helper is the authority (guide §4.7). This twin powers the live
 * suggestion box on the Website tab; what the user accepts in the box is what
 * gets sent — the client never silently rewrites a typed slug on save.
 *
 * Algorithm (verbatim from the guide / server):
 *  1. NFD-normalise
 *  2. Strip combining marks (`\p{M}`)
 *  3. Lowercase
 *  4. Fold every `[^a-z0-9]+` run to a single dash
 *  5. Trim leading/trailing dashes
 *  6. Cap at 80 characters, cut at a dash boundary
 *  7. Never empty: fall back to the dashed `key`
 */
export const SLUG_MAX_LEN = 80;

function dashKey(fallback: string | null | undefined): string {
  return String(fallback ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LEN)
    .replace(/-+$/, "");
}

function truncateAtBoundary(s: string): string {
  if (s.length <= SLUG_MAX_LEN) return s;
  const cut = s.slice(0, SLUG_MAX_LEN);
  const lastDash = cut.lastIndexOf("-");
  return lastDash > 0 ? cut.slice(0, lastDash) : cut;
}

/**
 * Accent-safe slugify. Pass the service-type `key` as `fallback` so non-latin
 * input never yields an empty string.
 */
export function slug(
  input: string | null | undefined,
  fallback?: string | null,
): string {
  const raw = String(input ?? "");
  const stripped = raw.normalize("NFD").replace(/\p{M}/gu, "");
  const folded = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (folded) return truncateAtBoundary(folded);
  return dashKey(fallback);
}

/** Same regex the server validator enforces. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value) && value.length >= 1 && value.length <= SLUG_MAX_LEN;
}
