/**
 * The public careers page — the one screen in this product a stranger sees.
 *
 * ── WHAT IT DELIBERATELY IS NOT ────────────────────────────────────────────
 *
 * It is not inside the app shell, and that is not a layout preference. The shell
 * carries the icon rail, the ribbon, the environment toggle, the clock and the
 * copilot — every one of which is staff furniture that a job applicant should
 * never see, and several of which would 401 without a session and start firing
 * the session-death path. So this renders standalone, above `RequireAuth`, and
 * imports nothing from the shell.
 *
 * It also does not use `useResource`/TanStack the way a staff screen does: those
 * are keyed on the tenant/env cache namespace and assume a session. Plain state
 * and one fetch is the honest shape for a page with no user.
 *
 * ── WHAT IT OWES THE CANDIDATE ─────────────────────────────────────────────
 *
 * Two things the internal pipeline does not have to worry about:
 *
 *   1. A REAL CONFIRMATION. The server returns a reference and whether the CV
 *      attached. Both are shown, because "did my CV actually go?" is the single
 *      thing an applicant wants to know and the one the server explicitly
 *      permits itself to answer honestly (it records the application even when
 *      the upload fails, rather than losing the candidate).
 *   2. NO SILENT DATA LOSS. The file is size-checked before it is read, and a
 *      rejected file is reported rather than dropped — a candidate who believes
 *      a recruiter has their CV when nobody received it does not come back.
 *
 * The tenant's own branding paints this via the branding provider's CSS
 * variables, so it is the company's careers page and not the vendor's.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { useParams, Link } from "react-router-dom";
import { useBranding } from "@/app/branding/branding-context";
// A standalone renderer, not shell furniture — see the note above about what
// this page may import.
import { Markdown } from "@/components/markdown";
import { withScheme } from "@/lib/format";
import * as api from "@/lib/careers-api";

const shell = "mx-auto w-full max-w-3xl px-4 py-10 sm:px-6";

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-[rgb(var(--ink)/0.06)] px-2 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

function Masthead({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl?: string | null;
}) {
  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-4 sm:px-6">
        {logoUrl ? (
          <img src={logoUrl} alt={name} className="h-8 w-auto" />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            {name.charAt(0)}
          </span>
        )}
        <div>
          <p className="text-sm font-semibold text-foreground">{name}</p>
          <p className="text-xs text-muted-foreground">Careers</p>
        </div>
      </div>
    </header>
  );
}

function Facts({ v }: { v: api.PublicVacancy }) {
  const band = api.salaryBand(v);
  const facts = [
    v.department,
    v.location,
    v.employment_type,
    v.experience_years_min ? `${v.experience_years_min}+ years` : null,
    band,
  ].filter(Boolean);
  if (!facts.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {facts.map((f) => (
        <Chip key={String(f)}>{f}</Chip>
      ))}
    </div>
  );
}

/* ── The index ───────────────────────────────────────────────────────────── */

function VacancyList() {
  const [rows, setRows] = React.useState<api.PublicVacancy[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    api
      .listVacancies()
      .then((r) => live && setRows(r))
      .catch(
        (e) =>
          live &&
          setError(
            e instanceof Error ? e.message : "Could not load our open roles.",
          ),
      );
    return () => {
      live = false;
    };
  }, []);

  if (error) return <p className="text-sm text-[rgb(var(--bad))]">{error}</p>;
  if (!rows)
    return <p className="text-sm text-muted-foreground">Loading open roles…</p>;
  if (!rows.length) {
    return (
      <div className="rounded-xl border p-8 text-center">
        <p className="font-medium text-foreground">No open roles right now</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Please check back — this page is kept up to date.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((v) => (
        <li key={v.token}>
          <Link
            to={`/public/careers/${v.token}`}
            className="block rounded-xl border p-4 transition-colors hover:bg-accent/40"
          >
            <span className="font-medium text-foreground">{v.title}</span>
            <Facts v={v} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ── The apply form ──────────────────────────────────────────────────────── */

type FormState = {
  full_name: string;
  email: string;
  phone: string;
  address: string;
  skills: string;
  experience_years: string;
  expected_salary: string;
  portfolio_url: string;
  cover_note: string;
};
const EMPTY: FormState = {
  full_name: "",
  email: "",
  phone: "",
  address: "",
  skills: "",
  experience_years: "",
  expected_salary: "",
  portfolio_url: "",
  cover_note: "",
};

const field = "w-full rounded-lg border bg-background px-3 py-2 text-sm";
const label = "block text-sm font-medium text-foreground";

function ApplyForm({
  token,
  role,
}: {
  token: string;
  role: api.PublicVacancy;
}) {
  // What this role insists on. The server refuses an application without them
  // with a named field error; marking them here is what stops somebody writing
  // a covering note's worth of answers and only then being told.
  const needsNote = Boolean(role.apply_config?.require_cover_letter);
  const needsPortfolio = Boolean(role.apply_config?.require_portfolio);
  const [f, setF] = React.useState(EMPTY);
  const set = (k: keyof FormState, v: string) =>
    setF((s) => ({ ...s, [k]: v }));
  const [cv, setCv] = React.useState<{ dataUrl: string; name: string } | null>(
    null,
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<api.ApplyResult | null>(null);

  async function pickCv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return setCv(null);
    setError(null);
    try {
      setCv({ dataUrl: await api.fileToDataUrl(file), name: file.name });
    } catch (err) {
      // Reported, never swallowed: a candidate who thinks their CV went with the
      // application and finds out later that it did not is a candidate lost.
      setCv(null);
      e.target.value = "";
      setError(
        err instanceof Error ? err.message : "That file could not be read.",
      );
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone(
        await api.apply(token, {
          full_name: f.full_name.trim(),
          email: f.email.trim(),
          phone: f.phone.trim() || undefined,
          address: f.address.trim() || undefined,
          // Split here rather than asking the candidate to produce an array. The
          // scorer matches these against the role's required skills, so the
          // splitting has to happen somewhere; a comma is what people type.
          skills: f.skills
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          experience_years: f.experience_years
            ? Number(f.experience_years)
            : undefined,
          expected_salary: f.expected_salary
            ? Number(f.expected_salary)
            : undefined,
          portfolio_url: withScheme(f.portfolio_url) || undefined,
          cover_note: f.cover_note.trim() || undefined,
          cv_data_url: cv?.dataUrl,
          cv_filename: cv?.name,
        }),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong sending your application.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border p-6" role="status">
        <p className="font-medium text-foreground">Application received</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your reference is{" "}
          <span className="num font-semibold text-foreground">
            {done.reference}
          </span>
          . Quote it if you get in touch about this application.
        </p>
        {/* Answered plainly because the server records the application even when
            the upload fails — so "we got you but not your file" is a real state
            and the candidate can act on it. */}
        <p className="mt-2 text-sm text-muted-foreground">
          {done.cv_attached
            ? "Your CV was attached."
            : "We could not attach your CV. Your application is safe — please email it to us separately."}
        </p>
      </div>
    );
  }

  const canSubmit =
    f.full_name.trim().length > 1 &&
    /.+@.+\..+/.test(f.email) &&
    (!needsNote || f.cover_note.trim().length > 0) &&
    (!needsPortfolio || f.portfolio_url.trim().length > 0) &&
    !busy;

  return (
    <form className="space-y-4" onSubmit={submit}>
      <h2 className="text-base font-semibold text-foreground">{tr("Apply")}</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="c-name">
            Full name
          </label>
          <input
            id="c-name"
            required
            className={field}
            value={f.full_name}
            onChange={(e) => set("full_name", e.target.value)}
          />
        </div>
        <div>
          <label className={label} htmlFor="c-email">
            Email
          </label>
          <input
            id="c-email"
            required
            type="email"
            className={field}
            value={f.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </div>
        <div>
          <label className={label} htmlFor="c-phone">
            Phone
          </label>
          <input
            id="c-phone"
            className={field}
            value={f.phone}
            onChange={(e) => set("phone", e.target.value)}
          />
        </div>
        <div>
          <label className={label} htmlFor="c-addr">
            Where you live
          </label>
          <input
            id="c-addr"
            className={field}
            value={f.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="c-skills">
          Skills
        </label>
        <input
          id="c-skills"
          className={field}
          placeholder="Customs clearance, French, forklift"
          value={f.skills}
          onChange={(e) => set("skills", e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Separate with commas.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="c-exp">
            Years of experience
          </label>
          <input
            id="c-exp"
            type="number"
            min="0"
            max="70"
            step="0.5"
            className={field}
            value={f.experience_years}
            onChange={(e) => set("experience_years", e.target.value)}
          />
        </div>
        <div>
          <label className={label} htmlFor="c-sal">
            Salary expectation
          </label>
          <input
            id="c-sal"
            type="number"
            min="0"
            className={field}
            value={f.expected_salary}
            onChange={(e) => set("expected_salary", e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="c-port">
          Portfolio or LinkedIn{needsPortfolio ? " (required)" : ""}
        </label>
        <input
          id="c-port"
          type="url"
          required={needsPortfolio}
          className={field}
          placeholder="linkedin.com/in/you"
          value={f.portfolio_url}
          onChange={(e) => set("portfolio_url", e.target.value)}
          // On blur, not on every keystroke: rewriting the value while somebody
          // is still typing moves their cursor. By the time the form is
          // submitted the field holds a URL the browser — and the server's
          // `z.string().url()` — will accept.
          onBlur={(e) => set("portfolio_url", withScheme(e.target.value))}
        />
      </div>

      <div>
        <label className={label} htmlFor="c-cv">
          CV
        </label>
        <input
          id="c-cv"
          type="file"
          accept={api.CV_ACCEPT}
          className={field}
          onChange={pickCv}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          PDF, PNG or JPEG, up to 8 MB.{cv ? ` Attached: ${cv.name}` : ""}
        </p>
      </div>

      <div>
        <label className={label} htmlFor="c-note">
          {needsNote
            ? "Your covering note (required)"
            : "Anything else you would like us to know"}
        </label>
        <textarea
          id="c-note"
          rows={5}
          required={needsNote}
          maxLength={5000}
          className={field}
          value={f.cover_note}
          onChange={(e) => set("cover_note", e.target.value)}
        />
      </div>

      {error && (
        <p className="text-sm text-[rgb(var(--bad))]" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {busy ? "Sending…" : "Send application"}
      </button>
    </form>
  );
}

/* ── One role ────────────────────────────────────────────────────────────── */

function VacancyDetail({ token }: { token: string }) {
  const [v, setV] = React.useState<api.PublicVacancy | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setV(null);
    setError(null);
    api
      .getVacancy(token)
      .then((r) => live && setV(r))
      // The server answers 404 identically for closed, unpublished and
      // never-existed, so this message must not speculate about which.
      .catch(
        () =>
          live && setError("This role is no longer accepting applications."),
      );
    return () => {
      live = false;
    };
  }, [token]);

  if (error) {
    return (
      <div className="rounded-xl border p-8 text-center">
        <p className="font-medium text-foreground">{error}</p>
        <Link
          to="/public/careers"
          className="mt-2 inline-block text-sm text-primary-ink underline"
        >
          See our other open roles
        </Link>
      </div>
    );
  }
  if (!v) return <p className="text-sm text-muted-foreground">{tr("Loading…")}</p>;

  return (
    <article className="space-y-8">
      {/* A rehearsal posting, opened by whoever was handed its link. It is a
          real page with a real application form writing to real (Test) rows —
          the one thing it must not do is look like the live advert, because the
          person reading it may be a candidate somebody forwarded it to. */}
      {v.environment === "sandbox" && (
        <p
          role="status"
          className="rounded-lg border border-[rgb(var(--warn)_/_0.4)] bg-[rgb(var(--warn)_/_0.1)] px-3 py-2 text-sm text-foreground"
        >
          <span className="font-semibold">TEST</span> — this is a test posting.
          Anything you send here goes to the test workspace, not to a real
          hiring team.
        </p>
      )}
      <div>
        <Link to="/public/careers" className="text-sm text-muted-foreground underline">
          ← All roles
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">
          {v.title}
        </h1>
        <Facts v={v} />
        {v.closes_on && (
          <p className="mt-2 text-xs text-muted-foreground">
            Applications close {v.closes_on}
          </p>
        )}
      </div>

      {/*
        The advert is markdown — the drafting model writes headings and bullets,
        and the editor's own preview renders it — so a candidate was reading
        `## Accountant` and `- Prepare financial statements` as literal text.
        `Markdown` builds React elements (no dangerouslySetInnerHTML), which is
        also why it is safe on the one page a stranger can reach.
      */}
      {v.description && (
        <div className="text-sm leading-relaxed text-muted-foreground">
          <Markdown text={v.description} />
        </div>
      )}

      {v.skills_required.length > 0 && (
        <div>
          <h2 className="mb-2 text-base font-semibold text-foreground">
            What we are looking for
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {v.skills_required.map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </div>
        </div>
      )}

      <ApplyForm token={token} role={v} />
    </article>
  );
}

export function CareersPage() {
  const { token } = useParams<{ token?: string }>();
  const { branding } = useBranding();
  const name = branding.name || "Careers";

  return (
    /*
     * This page OWNS ITS SCROLLING, which the staff screens do not have to.
     *
     * `html, body, #root` are `height: 100%; overflow: hidden` globally, because
     * inside the app the shell's <main> is the single custom scroll container.
     * This page renders outside the shell — so with only `min-h-screen` there
     * was no scroller anywhere, and every advert was silently clipped at the
     * fold: a candidate could read the first screenful of a job description and
     * nothing else, with no scrollbar to suggest there was more.
     */
    <div className="h-full overflow-y-auto bg-background">
      <Masthead name={name} logoUrl={branding.logoUrl} />
      <main className={shell}>
        {token ? (
          <VacancyDetail token={token} />
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-foreground">
              Open roles
            </h1>
            <p className="mb-6 mt-1 text-sm text-muted-foreground">
              Everything we are hiring for right now.
            </p>
            <VacancyList />
          </>
        )}
      </main>
    </div>
  );
}

export default CareersPage;
