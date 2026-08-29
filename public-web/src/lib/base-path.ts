/**
 * Where this app's marketing pages live on this host.
 *
 * `/public` used to be typed into ninety-odd places, which made it a decision
 * the whole fleet shared and nobody could revisit — and it is a decision a
 * tenant has an opinion about, because the word appears in every URL they print,
 * email or hand to a search engine. It is now a per-host setting
 * (`platform.subdomain.public_base`, edited in the platform console).
 *
 * ── HOW THE BROWSER LEARNS IT ─────────────────────────────────────────────
 *
 * The server rewrites `index.html`'s head per request already — that is how
 * link previews got their tags — so it writes the prefix in there too, as
 * `<meta name="praxis:public-base">`. Read once, at module load, before any
 * component renders.
 *
 * Not a build-time variable, deliberately. A `VITE_` constant is baked into the
 * bundle, so one build could only ever serve one prefix, and the setting would
 * have to be right at `npm run build` rather than when someone changes it.
 *
 * ONE mechanism, not two: `index.html` ships the tag with the default in it, and
 * the server REPLACES that tag rather than adding a second one. So `vite dev`,
 * `vite preview` and production all read the same place, and a developer who
 * wants to see another prefix edits one line of `index.html`.
 *
 * ── WHAT DOES NOT MOVE ────────────────────────────────────────────────────
 *
 * `/portal` is fixed. Invitation and set-password emails already in circulation
 * point at it with a seven-day expiry, and the ERP links its staff there; a
 * setting that can break links already sitting in an inbox is a footgun.
 *
 * And note the OTHER `/public` in this codebase, which this module has nothing
 * to do with: `lib/*-api.ts` calls `/api/tenant/public/…`, the API's namespace.
 * Those are not paths in the browser and must never be built from `BASE`.
 */

const FALLBACK = "/public";

function read(): string {
  const fromMeta =
    typeof document !== "undefined"
      ? document
          .querySelector('meta[name="praxis:public-base"]')
          ?.getAttribute("content")
      : null;
  const raw = (fromMeta || FALLBACK).trim().toLowerCase();
  const segment = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  // Same shape the server's `normaliseBase` enforces. A value that fails it is a
  // deployment fault, not something to render a broken navigation over.
  return /^[a-z0-9][a-z0-9-]{0,30}$/.test(segment) ? `/${segment}` : FALLBACK;
}

/** The prefix, with a leading slash and no trailing one: `/public`, `/site`. */
export const BASE = read();

/** True when this host still uses the original prefix — the router uses it to
 *  decide whether `/public/*` needs a redirect to somewhere else. */
export const BASE_IS_DEFAULT = BASE === FALLBACK;

/** The path the original prefix now lives at, for the legacy redirect. */
export const LEGACY_BASE = FALLBACK;

/**
 * Build a path under the marketing prefix.
 *
 *   p()            → "/site"
 *   p("/track")    → "/site/track"
 *   p("#quote")    → "/site#quote"
 */
export function p(rest = ""): string {
  return `${BASE}${rest}`;
}
