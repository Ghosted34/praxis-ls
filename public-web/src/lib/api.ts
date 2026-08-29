/**
 * The public API client — the only way this app talks to the server.
 *
 * ── WHY IT IS NOT `client/src/lib/api-client.ts` ──────────────────────────
 *
 * That client is a session machine. It attaches a Bearer token, sends the
 * `X-Praxis-Env` header, and on a 401 tries one refresh and — when that fails —
 * fires the session-death signal that clears tokens and bounces the user to
 * `/login`. Every one of those behaviours is wrong for a stranger:
 *
 *   · they have no token, so there is nothing to attach and nothing to refresh;
 *   · a public endpoint is pinned to the LIVE schema server-side
 *     (`req.tenantDbIn("live", …)`), so an env header is not just useless, it is
 *     a surface an anonymous caller must not be able to influence;
 *   · the bounce is the bad one. A candidate reading a job advert, or a client
 *     forwarding a proposal link, would be thrown out of a public page into a
 *     STAFF sign-in screen because one fetch answered 401.
 *
 * `client/src/lib/careers-api.ts` documents the same conclusion from the other
 * side (`auth: false` on every call, "not a formality"). This file is that
 * conclusion taken to its end: there is no auth path to opt out of.
 *
 * The tenant is resolved by the backend from the request's `Host` header, so no
 * URL here contains a slug and nothing in the browser needs to know one.
 */

export type FieldErrors = Record<string, string[] | string>;

export class PublicApiError extends Error {
  code: string;
  status: number;
  fields?: FieldErrors;
  constructor(
    code: string,
    message: string,
    status: number,
    fields?: FieldErrors,
  ) {
    super(message);
    this.name = "PublicApiError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }

  /** A 404 on a public surface is a normal content state — an expired proposal
   *  token, a withdrawn advert, a reference nobody recognises — and the page
   *  should say so in its own words rather than as a failure. */
  get isNotFound(): boolean {
    return this.status === 404 || this.code === "NOT_FOUND";
  }

  /** Rate-limited intake (the quote desk allows a handful per hour). */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** Whether a failed read has already been given a message meant for a
   *  stranger. `readFailMessage` and `ErrorState` both key off this, so a
   *  component never has to re-decide whether a sentence is safe to print. */
  get isPublicMessage(): boolean {
    return this.status === 0 || this.isNotFound || this.isRateLimited;
  }
}

/** The message a stranger should be shown for a failed read. Deliberately does
 *  not name the endpoint or the status: on a public page those are for logs. */
export function readFailMessage(
  e: unknown,
  fallback = "We could not load this page.",
): string {
  if (e instanceof PublicApiError) {
    if (e.isNotFound) return fallback;
    if (e.isRateLimited) {
      return "Too many attempts from this connection. Please try again in a few minutes.";
    }
    if (e.message) return e.message;
  }
  return fallback;
}

export type PublicApiOpts = Omit<RequestInit, "body"> & {
  body?: unknown;
  /** Query parameters; `undefined` values are dropped rather than serialised. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Abort the in-flight request (used by every read effect on unmount). */
  signal?: AbortSignal;
};

function buildUrl(path: string, query?: PublicApiOpts["query"]): string {
  const url = `/api/tenant${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

/**
 * One request. Returns the UNWRAPPED payload — every public endpoint answers
 * `{ data: … }` (`src/modules/**\/*_public/*.routes.js`), and unwrapping here is
 * what stops sixty call sites from each re-guessing whether this one wraps.
 */
export async function publicApi<T = unknown>(
  path: string,
  opts: PublicApiOpts = {},
): Promise<T> {
  const { body, query, headers, ...rest } = opts;
  const h = new Headers(headers);
  if (body !== undefined) h.set("Content-Type", "application/json");

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      ...rest,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // No response at all: offline, DNS, a dead dev proxy. `TypeError: Failed to
    // fetch` is the browser's whole message, which no visitor can act on.
    throw new PublicApiError(
      "NETWORK_ERROR",
      "We could not reach the server. Check your connection and try again.",
      0,
    );
  }

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // An HTML body from a JSON endpoint is a proxy or routing fault, not a
      // content state — surface it rather than rendering "undefined".
      throw new PublicApiError(
        "BAD_RESPONSE",
        "The server answered in a way we could not read.",
        res.status,
      );
    }
  }

  if (!res.ok) {
    const err =
      json && typeof json === "object" && "error" in json
        ? (
            json as {
              error?: { code?: string; message?: string; fields?: FieldErrors };
            }
          ).error
        : undefined;
    throw new PublicApiError(
      err?.code || "ERROR",
      err?.message || res.statusText || "Request failed",
      res.status,
      err?.fields,
    );
  }

  return json && typeof json === "object" && "data" in json
    ? (json as { data: T }).data
    : (json as T);
}

/** `GET` shorthand — the shape most reads here take. */
export const publicGet = <T>(
  path: string,
  opts?: Omit<PublicApiOpts, "method" | "body">,
) => publicApi<T>(path, { ...opts, method: "GET" });

/**
 * The one sentence to show for a failed read.
 *
 * `client`'s screens print `e.message` straight into a `<p role="alert">`. That is
 * fine inside a staff app where the reader caused the 400 and needs the detail; it
 * is not fine here. A stranger's page is read on a phone by someone who may be
 * sent a screenshot of it, and the messages a Node driver produces — `connection
 * refused`, `timeout expired`, a stack fragment from a 500 — describe this
 * deployment rather than the reader's problem.
 *
 * So: a message this module built on purpose (offline, not-found, rate-limit) is
 * passed through, and everything else becomes the dictionary's sentence. The
 * detail is still recoverable — it goes to the console below, where it is useful
 * to whoever is debugging and invisible to whoever is reading.
 */
export function messageFor(e: unknown, fallback?: string): string {
  if (e instanceof PublicApiError) {
    if (e.isPublicMessage && e.message) return e.message;
    console.warn("[public-web] read failed", e.code, e.status, e.message);
    return fallback || readFailMessage(e);
  }
  return fallback || readFailMessage(e);
}
