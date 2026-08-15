/**
 * The public careers API — the only client module that talks to the server
 * WITHOUT a session.
 *
 * `auth: false` on every call, and it is not a formality. With the default
 * `auth: true`, a 401 sends `api()` down the refresh path and, when that fails,
 * fires the session-death signal that clears tokens and bounces to /login. A
 * candidate reading a job advert has no session to refresh and no login to be
 * bounced to, so a stray 401 would throw a stranger out of a public page into a
 * staff sign-in screen. Opting out keeps failures as plain errors this page can
 * render itself.
 *
 * The tenant is resolved server-side from the Host header, exactly as it is for
 * the authenticated app — so a careers link is just this workspace's own domain
 * and nothing here needs to know a slug.
 */
import { tenant } from "./api-client";

/** What the server chooses to make public — an allow-list built in
 *  careers.service, never a database row. Anything absent here is absent on
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

/** Deliberately thin: a reference to quote and whether the CV landed. The
 *  server never echoes the created applicant — it now carries an AI score, and
 *  handing a candidate the machine's opinion of them would be indefensible. */
export type ApplyResult = { received: boolean; reference: string; cv_attached: boolean };

const opts = { auth: false } as const;

export const listVacancies = () => tenant<PublicVacancy[]>("/careers", opts);
export const getVacancy = (token: string) => tenant<PublicVacancy>(`/careers/${encodeURIComponent(token)}`, opts);
export const apply = (token: string, body: ApplyInput) =>
  tenant<ApplyResult>(`/careers/${encodeURIComponent(token)}/apply`, { ...opts, method: "POST", body });

/** Matches CV_MAX_BYTES in careers.service. Checked here too so an 8 MB scan is
 *  refused before it is base64-encoded and pushed over a phone connection. */
export const CV_MAX_BYTES = 8 * 1024 * 1024;
export const CV_ACCEPT = "application/pdf,image/png,image/jpeg";

/** Read a picked file as a base64 data URL, which is the shape the vault's
 *  upload path takes. Rejects with a sentence the applicant can act on. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > CV_MAX_BYTES) {
      return reject(new Error(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 8 MB.`));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That file could not be read. Try saving it again, or pick another."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

/** Salary band as one human phrase, or null when the role does not publish one. */
export function salaryBand(v: PublicVacancy): string | null {
  const lo = v.salary_min == null ? null : Number(v.salary_min);
  const hi = v.salary_max == null ? null : Number(v.salary_max);
  if (lo === null && hi === null) return null;
  const money = (n: number) => n.toLocaleString();
  const cur = v.salary_currency ? ` ${v.salary_currency}` : "";
  if (lo !== null && hi !== null) return `${money(lo)} – ${money(hi)}${cur}`;
  return `${lo !== null ? "From " : "Up to "}${money((lo ?? hi) as number)}${cur}`;
}
