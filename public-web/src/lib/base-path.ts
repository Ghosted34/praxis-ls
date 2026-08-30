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
  // Split rather than `replace(/\/+$/, "")` — the same quadratic trim the
  // server's `normaliseBase` was failing CodeQL on, removed the same way. This
  // copy reads a tag our own server wrote rather than anything a visitor sends,
  // so it is the less exposed of the two; that is a reason to keep the pair
  // identical, not a reason to leave one of them slow.
  const parts = raw.length > 64 ? [] : raw.split("/").filter(Boolean);
  const segment = parts.length === 1 ? parts[0] : "";
  // "" is the ROOT MOUNT, and the one case where an empty segment is a real
  // answer rather than a malformed one: the server sends "/" on a host whose
  // surface is 'public' — a domain the client brought, where this app is the
  // only thing served and a prefix would put a meaningless word in front of
  // every URL they print. Everything else must be one path segment, the same
  // shape the server's `normaliseBase` enforces; a value that fails it is a
  // deployment fault, not something to render a broken navigation over.
  if (raw === "/" || raw === "") return "";
  return /^[a-z0-9][a-z0-9-]{0,30}$/.test(segment) ? `/${segment}` : FALLBACK;
}

/**
 * The prefix, with a leading slash and no trailing one: `/public`, `/site` —
 * or `""` when this host serves the site at its root.
 *
 * Never interpolate it directly. `${BASE}/track` is `"/track"` at the root and
 * looks right; `${BASE}` alone is `""`, which as a react-router `to` means
 * "the current path" rather than "the home page". Use `p()`.
 */
export const BASE = read();

/** True when the site owns this host and lives at its root. */
export const IS_ROOT = BASE === "";

/** True when this host still uses the original prefix — the router uses it to
 *  decide whether `/public/*` needs a redirect to somewhere else. */
export const BASE_IS_DEFAULT = BASE === FALLBACK;

/** The path the original prefix now lives at, for the legacy redirect. */
export const LEGACY_BASE = FALLBACK;

/**
 * Build a path under the marketing prefix.
 *
 *   p()            → "/site"      · at the root: "/"
 *   p("/track")    → "/site/track" · at the root: "/track"
 *   p("#quote")    → "/site#quote" · at the root: "/#quote"
 *
 * The root cases are why this is a function and not a template literal at each
 * call site. `BASE + ""` is `""` and `BASE + "#quote"` is `"#quote"`; react-router
 * resolves both RELATIVE to whatever page you are on, so the home link on
 * `/careers/abc` would navigate to `/careers/abc` and the quote anchor would
 * scroll a page that has no quote form on it. Every result here is absolute.
 */
export function p(rest = ""): string {
  if (BASE) return `${BASE}${rest}`;
  if (!rest) return "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}
