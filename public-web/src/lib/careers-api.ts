/**
 * The public careers API — moved from `client/src/lib/careers-api.ts`.
 *
 * The module comment there explains why every call is `auth: false`, and this
 * app makes that structural rather than per-call: `lib/api.ts` has no auth path
 * at all, so the bug it guarded against (a stray 401 firing the session-death
 * signal and throwing a stranger out of a job advert into a staff sign-in
 * screen) cannot be reintroduced here.
 *
 * The tenant is resolved server-side from `Host`, exactly as for the app — so a
 * careers link is this workspace's own domain and carries no slug.
 */
import { publicApi, publicGet } from "./api";
import { currentLocale } from "./i18n";

/** What the server chooses to make public — an allow-list built in
 *  `careers.service`, never a database row. Anything absent here is absent on
 *  purpose. */
export type PublicVacancy = {
  token: string;
  title: string;
  department?: string | null;
  location?: string | null;
  employment_type?: string | null;
  description?: string | null;
  experience_years_min?: number | null;
  skills_required: string[];
  salary_min?: number | string | null;
  salary_max?: number | string | null;
  salary_currency?: string | null;
  closes_on?: string | null;
  published_at?: string | null;
  /** What this role insists on. The server enforces it (`careers.service.apply`)
   *  and returns named field errors; this is so the form can SAY SO first,
   *  rather than letting somebody write five paragraphs and then be refused. */
  apply_config?: {
    require_cover_letter?: boolean;
    require_portfolio?: boolean;
  };
  /**
   * Which environment this role lives in — `sandbox` for a rehearsal posting.
   *
   * The server decides it from the token rather than from a header, because a
   * candidate has none. Present on the single-role read only; the index is
   * live-only.
   */
  environment?: "live" | "sandbox";
};

export type ApplyInput = {
  full_name: string;
  email: string;
  phone?: string;
  address?: string;
  skills?: string[];
  experience_years?: number;
  expected_salary?: number;
  portfolio_url?: string;
  cover_note?: string;
  cv_data_url?: string;
  cv_filename?: string;
};

/** Deliberately thin: a reference and whether the CV landed. The server never
 *  echoes the created applicant — it now carries an AI score, and handing a
 *  candidate the machine's opinion of them would be indefensible. */
export type ApplyResult = {
  received: boolean;
  reference: string;
  cv_attached: boolean;
};

export const listVacancies = () => publicGet<PublicVacancy[]>("/careers");

export const getVacancy = (token: string) =>
  publicGet<PublicVacancy>(`/careers/${encodeURIComponent(token)}`);

export const apply = (token: string, body: ApplyInput) =>
  publicApi<ApplyResult>(`/careers/${encodeURIComponent(token)}/apply`, {
    method: "POST",
    body,
  });

/** Matches CV_MAX_BYTES in careers.service. Checked here too so an 8 MB scan is
 *  refused before it is base64-encoded and pushed over a phone connection. */
export const CV_MAX_BYTES = 8 * 1024 * 1024;
export const CV_ACCEPT = "application/pdf,image/png,image/jpeg";

/** Read a picked file as a base64 data URL — the shape the vault upload path
 *  takes. Rejects with a sentence the applicant can act on. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > CV_MAX_BYTES) {
      return reject(
        new Error(
          `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 8 MB.`,
        ),
      );
    }
    const reader = new FileReader();
    reader.onerror = () =>
      reject(
        new Error(
          "That file could not be read. Try saving it again, or pick another.",
        ),
      );
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

/**
 * Salary band as one human phrase, or null when the role does not publish one.
 *
 * The `labels` argument is a deviation from `client/src/lib/careers-api.ts`,
 * where this function returns `From 1,250,000 FCFA` as a built string — on the
 * French page that reads "From …", because a locale-neutral formatter grew a
 * sentence inside it. On a page a stranger reads, the words belong to the
 * dictionary, so the caller supplies them and this file stays free of copy.
 */
export function salaryBand(
  v: PublicVacancy,
  labels: { from: string; upTo: string } = { from: "From", upTo: "Up to" },
): string | null {
  const lo = v.salary_min == null ? null : Number(v.salary_min);
  const hi = v.salary_max == null ? null : Number(v.salary_max);
  if (lo === null && hi === null) return null;
  // Grouped by the SITE language, not the browser's locale: `1 250 000` and
  // `1,250,000` on the same advert, depending on where the candidate sits, is
  // the F6 defect this repo already fixed once for the ERP's formatters.
  const money = (n: number) => n.toLocaleString(currentLocale());
  const cur = v.salary_currency ? ` ${v.salary_currency}` : "";
  if (lo !== null && hi !== null) return `${money(lo)} – ${money(hi)}${cur}`;
  const word = lo !== null ? labels.from : labels.upTo;
  return `${word} ${money((lo ?? hi) as number)}${cur}`;
}
