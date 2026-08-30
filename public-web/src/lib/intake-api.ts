/**
 * The public intake API — the four ways a stranger puts something INTO this
 * tenant's pipeline: `/api/tenant/public/intake/*`.
 *
 * ── THE SHAPE OF EVERY CALL HERE IS NOT A STYLE CHOICE ─────────────────────
 *
 * `public_intake.validator.js` parses each body with a Zod schema that ends in
 * `.strict()`. An unrecognised key is not ignored — it is a 422 with
 * `error.fields`, and the request never reaches the service. That is the right
 * boundary for an anonymous write endpoint, and it has one consequence a
 * frontend must respect:
 *
 *   **A form may send only the keys below. Not one more.**
 *
 * `client/src/features/public/public-site.tsx` sent `service_type` and
 * `estimated_weight` on the quote form when neither was in `schemas.quote`, so
 * every quote request from the shipped marketing page was refused with a
 * generic "Something went wrong" (see `public-web/README.md` › FINDINGS). WS2
 * took the other branch of that fix and GREW the schema: `estimated_weight`,
 * `project_cargo_flag`, `warehouse_location`, `warehouse_duration` and
 * `additional_notes` are accepted now, and all but the last were already
 * columns on `quote_request` (migration 0683) waiting for a caller.
 *
 * `service_type` remains absent on purpose. On that table it is the INCOTERM
 * under a misleading name, and `incoterm` is the field this form actually
 * sends.
 *
 * ── THE SPAM TRAP ───────────────────────────────────────────────────────────
 *
 * Every intake schema also accepts two trap fields:
 *   · `website_url` — a honeypot that must be absent or EMPTY (`max(0)`), and
 *     is deleted before the service sees it;
 *   · `form_started_at` — an int (ms), and the middleware rejects a submission
 *     that arrives less than 1500 ms after it, as `SPAM_REJECTED`.
 *
 * A bot posts the payload it scraped; a human takes longer than 1.5 seconds to
 * type a name. `useIntakeForm` therefore stamps the mount time and sends it. It
 * costs one number and it is the only reason a 5-per-hour rate limit (see the
 * routes) is not going to be tripped by the first scraper that finds the
 * endpoint — which matters because the limit is per-connection, and an office
 * behind one NAT address shares it.
 */
import { publicApi, PublicApiError, type FieldErrors } from "./api";
import type { PlacePick } from "./places-api";

export type IntakeReceipt = { received: boolean; reference: string };

/** The honeypot + timing fields every intake schema accepts. */
export type Trap = { website_url?: ""; form_started_at?: number };

export type QuoteRequest = Trap & {
  requester_name?: string;
  requester_company?: string;
  requester_email?: string;
  requester_phone?: string;
  service_category?: string;
  origin_location?: string;
  destination_location?: string;
  cargo_description?: string;
  incoterm?: string;
  /* ── WS2 (migration 12756 + the grown public schema) ───────────────────── */
  estimated_weight?: number;
  project_cargo_flag?: boolean;
  warehouse_location?: string;
  warehouse_duration?:
    | "LESS_THAN_7_DAYS"
    | "DAYS_7_TO_14"
    | "DAYS_15_TO_30"
    | "OVER_30_DAYS"
    | "UNKNOWN";
  additional_notes?: string;
  /**
   * A place picked from `/public/places` — the provider's id and the text that
   * produced it, and deliberately NOT the coordinates the picker displayed.
   * The server re-asks the provider and stores ITS answer, so a body that could
   * carry a coordinate could carry any coordinate and have it stored as
   * provider-vouched. The schema rejects one if it is sent.
   */
  origin_place?: PlacePick;
  destination_place?: PlacePick;
  /** One optional file, as a base64 data URL. See `components/ui/file-input`. */
  attachment_data_url?: string;
  attachment_filename?: string;
};

export type ContactEnquiry = Trap & {
  name?: string;
  email?: string;
  phone?: string;
  company_name?: string;
  subject?: string;
  message: string;
  enquiry_type?: "GENERAL_ENQUIRY" | "PARTNERSHIP" | "CAREERS" | "MEDIA";
};

export type NewsletterSignup = Trap & { email: string; name?: string };

const submit = <T>(
  path: string,
  body: T & Trap,
  startedAt: number | undefined,
): Promise<IntakeReceipt> => {
  // Empty strings are dropped: `.strict()` accepts the key, but the services
  // write `data.x || null` and an empty subject on a lead is noise in a queue.
  //
  // `false` and `0` are NOT dropped, and the filter is written to compare
  // against the three empties explicitly for that reason. `project_cargo_flag:
  // false` is a real answer to a real question — a filter on falsiness would
  // silently turn "no, this is ordinary cargo" into "unanswered".
  const clean = Object.fromEntries(
    Object.entries({ ...body, form_started_at: startedAt }).filter(
      ([, v]) => v !== "" && v !== undefined && v !== null,
    ),
  ) as T & Trap;
  return publicApi<IntakeReceipt>(path, { method: "POST", body: clean });
};

export const quoteRequests = {
  path: "/public/intake/quote-requests" as const,
  send: (body: QuoteRequest, startedAt?: number) =>
    submit("/public/intake/quote-requests", body, startedAt),
};

export const contactEnquiries = {
  path: "/public/intake/contact-enquiries" as const,
  send: (body: ContactEnquiry, startedAt?: number) =>
    submit("/public/intake/contact-enquiries", body, startedAt),
};

export const newsletter = {
  path: "/public/intake/newsletter" as const,
  send: (body: NewsletterSignup, startedAt?: number) =>
    submit("/public/intake/newsletter", body, startedAt),
};

/**
 * The 422 the middleware builds from `flatten().fieldErrors` — turned back into
 * per-field messages so a form can print them where the mistake is rather than
 * as one undifferentiated "Something went wrong".
 *
 * `ApiError.fields` is `Record<string, string[] | string>` because that is what
 * Zod emits and what the response contract sends; both shapes are normalised
 * here so no call site has to know.
 */
export function fieldErrorsOf(e: unknown): Record<string, string> {
  if (!(e instanceof PublicApiError) || !e.fields) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(e.fields as FieldErrors)) {
    out[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}
