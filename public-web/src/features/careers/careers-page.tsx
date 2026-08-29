import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import * as api from "@/lib/careers-api";
import { PublicApiError } from "@/lib/api";
import { currentLocale } from "@/lib/i18n";
import { enumText, withScheme } from "@/lib/format";
import { useIntake } from "@/lib/use-intake";
import { PageContainer, PageShell } from "@/components/site/page-shell";
import { Section } from "@/components/site/section";
import { Card } from "@/components/ui/card";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, SuccessState } from "@/components/ui/states";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Chip } from "@/components/ui/pill";
import { Markdown } from "@/components/ui/markdown";
import { AlertIcon, ClockIcon, DocumentIcon } from "@/components/ui/icons";
import { useDocumentMeta } from "@/lib/use-document-meta";

/**
 * `/public/careers` and `/public/careers/:token` — the one screen in this product
 * a stranger reads twice before they trust it, because what they are submitting is
 * themselves.
 *
 * ── WHAT THE PORT KEEPS FROM `client/src/features/careers/careers-page.tsx` ──
 *
 * Three behaviours, all of them load-bearing:
 *
 *   1. THE RECEIPT SAYS WHETHER THE CV LANDED. `apply()` returns
 *      `{ received, reference, cv_attached }`, and the server records the
 *      application even when the upload fails ("better a candidate with a
 *      reference than a candidate with nothing"). Rendering only "Thank you"
 *      would tell a person their CV is in a pile when it may not be — so the
 *      confirmation is a different sentence for each case.
 *   2. THE FILE IS SIZE-CHECKED BEFORE IT IS READ. `fileToDataUrl` refuses over
 *      8 MB, matching `CV_MAX_BYTES` in `careers.service`, so an oversized scan
 *      is a message at selection time and not a lost form after a minute on a
 *      metered connection.
 *   3. WHAT THE ROLE INSISTS ON IS SAID FIRST. `apply_config` carries
 *      `require_cover_letter` / `require_portfolio`; the server enforces them and
 *      returns named field errors, so the form marks them required up front
 *      instead of letting somebody write five paragraphs and then be refused.
 *
 * ── WHAT CHANGES HERE ─────────────────────────────────────────────────────
 *
 * The `salaryBand` phrase comes from the dictionary in both languages (the ERP's
 * version hardcodes "From"/"Up to", so a French advert read "From 1 250 000
 * FCFA"), and the sandbox banner is a sentence in both languages rather than an
 * English-only string. A test advert that only warns the English-reading half of
 * the applicants is a warning that did not happen.
 */
export function CareersPage() {
  const { t } = useTranslation();
  const [rows, setRows] = React.useState<api.PublicVacancy[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    api
      .listVacancies()
      .then((r) => alive && setRows(Array.isArray(r) ? r : []))
      .catch((e: unknown) => {
        if (!alive) return;
        // A 404/403 means the tenant has not published any roles: an empty list,
        // not a failure. Only a real fault gets an error line.
        if (e instanceof PublicApiError && (e.isNotFound || e.status === 403))
          setRows([]);
        else setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  useDocumentMeta({
    title: t("site.careers.title"),
    description: t("site.careers.sub"),
  });

  return (
    <PageShell label={t("site.careers.title")}>
      <Section
        eyebrow={t("site.careers.list")}
        title={t("site.careers.title")}
        lead={t("site.careers.sub")}
        // No hero band on the list page: this heading is the page title, so
        // it is the document h1 (see Section on why titleAs accepts one).
        titleAs="h1"
      >
        {error ? (
          <ErrorState message={error} />
        ) : rows === null ? (
          <PageSkeleton rows={4} cols={2} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t("site.careers.empty")}
            hint={t("site.careers.emptyHint")}
          />
        ) : (
          <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {rows.map((v) => (
              <li key={v.token}>
                <Link
                  to={`/public/careers/${encodeURIComponent(v.token)}`}
                  className="group flex flex-col gap-2 py-6 transition-colors sm:flex-row sm:items-start sm:justify-between sm:gap-8"
                >
                  <div className="min-w-0">
                    <h2 className="text-title font-semibold leading-snug tracking-tight group-hover:text-primary-ink">
                      {v.title}
                    </h2>
                    <VacancyFacts v={v} />
                  </div>
                  <span className="shrink-0 text-sm font-medium text-primary-ink underline-offset-4 group-hover:underline">
                    {t("site.careers.apply")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PageShell>
  );
}

/** Department · location · type · experience · salary, as chips.
 *
 *  `enumLabel`+`tr` on the employment type because the API stores `FULL_TIME` and
 *  a job advert that reads "FULL_TIME" to a French candidate is a database dump,
 *  not a page. */
function VacancyFacts({ v }: { v: api.PublicVacancy }) {
  const { t } = useTranslation();
  const band = api.salaryBand(v, {
    from: t("site.careers.salaryFrom"),
    upTo: t("site.careers.salaryUpTo"),
  });
  const chips = [
    v.department,
    v.location,
    v.employment_type ? enumText(v.employment_type) : null,
    v.experience_years_min
      ? `${v.experience_years_min}+ ${t("site.careers.years")}`
      : null,
    band,
  ].filter(Boolean) as string[];
  if (!chips.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <Chip key={c}>{c}</Chip>
      ))}
    </div>
  );
}

/* ── The advert ─────────────────────────────────────────────────────────── */

export function VacancyPage() {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  const [v, setV] = React.useState<api.PublicVacancy | null>(null);
  const [gone, setGone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    api
      .getVacancy(decodeURIComponent(token))
      .then((row) => alive && setV(row))
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof PublicApiError && e.isNotFound) setGone(true);
        else setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [token]);

  useDocumentMeta({
    title: v ? `${v.title} · ${t("site.careers.title")}` : undefined,
  });

  if (error) {
    return (
      <PageShell label={t("site.careers.title")}>
        <PageContainer>
          <ErrorState message={error} />
        </PageContainer>
      </PageShell>
    );
  }

  if (gone || !v) {
    // A withdrawn advert is not a 404 in the rude sense: the role may have been
    // filled yesterday, and the person reading this link has already spent time
    // on it. Say it closed, offer the list, invent nothing about why.
    return (
      <PageShell label={t("site.careers.title")}>
        <Section
          title={gone ? t("site.careers.closed") : t("site.careers.title")}
        >
          <div className="max-w-prose">
            {gone ? (
              <p className="text-sm text-muted-foreground">
                {t("site.careers.closedHint")}
              </p>
            ) : (
              <PageSkeleton rows={3} cols={2} />
            )}
            <div className="mt-6">
              <ButtonLink to="/public/careers" variant="outline">
                {t("site.careers.back")}
              </ButtonLink>
            </div>
          </div>
        </Section>
      </PageShell>
    );
  }

  const published = v.published_at
    ? new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium" }).format(
        new Date(v.published_at),
      )
    : null;
  const closes = v.closes_on
    ? new Intl.DateTimeFormat(currentLocale(), { dateStyle: "long" }).format(
        new Date(v.closes_on),
      )
    : null;

  return (
    <PageShell label={v.title}>
      <section className="band">
        <PageContainer size="reading">
          <nav aria-label={t("site.careers.title")} className="mb-6">
            <Link
              to="/public/careers"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              {t("site.careers.back")}
            </Link>
          </nav>

          {v.environment === "sandbox" && (
            <p
              role="note"
              className="mb-5 flex items-start gap-2 rounded-[calc(var(--radius)-2px)] border border-warn/40 bg-warn-fill/10 p-3 text-sm"
            >
              <AlertIcon size={16} className="mt-0.5 text-warn" />
              <span>{t("site.careers.testPosting")}</span>
            </p>
          )}

          <h1 className="text-h1 font-semibold leading-[1.08] tracking-tight">
            {v.title}
          </h1>
          <VacancyFacts v={v} />
          {(published || closes) && (
            <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
              {published ? (
                <span>
                  {t("site.careers.published")}{" "}
                  <span className="num">{published}</span>
                </span>
              ) : null}
              {closes ? (
                <span className="inline-flex items-center gap-1.5">
                  <ClockIcon size={14} />
                  {t("site.careers.closeNote")}{" "}
                  <span className="num">{closes}</span>
                </span>
              ) : null}
            </p>
          )}
        </PageContainer>
      </section>

      <Section divided>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="min-w-0 max-w-prose">
            {v.description ? (
              <div className="prose-site">
                {/* Tenant-authored advert copy, rendered by the same dependency-free
                    renderer the staff app uses. It escapes everything, so an HTML
                    snippet pasted into the advert field by a recruiter in a hurry is
                    text, not markup. */}
                <Markdown text={v.description} />
              </div>
            ) : null}

            {v.skills_required?.length ? (
              <Panel
                title={t("site.careers.lookingFor")}
                titleAs="h2"
                className="mt-8"
              >
                <ul className="grid gap-2 sm:grid-cols-2">
                  {v.skills_required.map((s) => (
                    <li key={s} className="flex items-start gap-2 text-sm">
                      <DocumentIcon
                        size={14}
                        className="mt-1 text-muted-foreground"
                      />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}
          </div>

          <Card padded className="h-fit lg:sticky lg:top-24">
            <h2 className="text-title font-semibold tracking-tight">
              {t("site.careers.applyTitle")}
            </h2>
            <ApplyForm key={v.token} vacancy={v} />
          </Card>
        </div>
      </Section>
    </PageShell>
  );
}

/** The application itself. */
function ApplyForm({ vacancy: v }: { vacancy: api.PublicVacancy }) {
  const { t } = useTranslation();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [cvDataUrl, setCvDataUrl] = React.useState<string | null>(null);
  const [f, setF] = React.useState({
    full_name: "",
    email: "",
    phone: "",
    address: "",
    experience_years: "",
    expected_salary: "",
    portfolio_url: "",
    cover_note: "",
  });
  const set = (k: keyof typeof f, val: string) =>
    setF((s) => ({ ...s, [k]: val }));

  const requireCover = !!v.apply_config?.require_cover_letter;
  const requirePortfolio = !!v.apply_config?.require_portfolio;

  const intake = useIntake<api.ApplyResult>({
    send: (body) => api.apply(v.token, body as api.ApplyInput),
    onRateLimited: t("site.careers.limited"),
    onFailed: t("site.careers.err"),
  });

  const canSend =
    f.full_name.trim().length > 1 &&
    /.+@.+\..+/.test(f.email.trim()) &&
    (!requireCover || f.cover_note.trim().length > 0) &&
    (!requirePortfolio || f.portfolio_url.trim().length > 0) &&
    !intake.busy;

  async function pick(ev: React.ChangeEvent<HTMLInputElement>) {
    const picked = ev.target.files?.[0] || null;
    setFile(picked);
    setFileError(null);
    setCvDataUrl(null);
    if (!picked) return;
    try {
      setCvDataUrl(await api.fileToDataUrl(picked));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    await intake.submit({
      full_name: f.full_name.trim(),
      email: f.email.trim(),
      phone: f.phone.trim() || undefined,
      address: f.address.trim() || undefined,
      // NO `skills`. The schema accepts them and the record stores them, but the
      // form does not ask the candidate for a skill list, and copying
      // `skills_required` in would write the job's own requirements into the
      // applicant's profile — where this product's CV scorer will read them back
      // as a match the person never claimed. A scaffold that inflates a score to
      // fill a column is worse than a null column.
      experience_years: f.experience_years
        ? Number(f.experience_years)
        : undefined,
      expected_salary: f.expected_salary
        ? Number(f.expected_salary)
        : undefined,
      portfolio_url: f.portfolio_url
        ? withScheme(f.portfolio_url.trim())
        : undefined,
      cover_note: f.cover_note.trim() || undefined,
      cv_data_url: cvDataUrl || undefined,
      cv_filename: file?.name,
    });
  }

  if (intake.result) {
    const r = intake.result;
    return (
      <div className="mt-4">
        <SuccessState
          title={t("site.careers.sentTitle")}
          hint={
            <>
              {r.cv_attached
                ? t("site.careers.sentCv", { reference: r.reference })
                : t("site.careers.sentNoCv", { reference: r.reference })}
              <span className="mt-2 block">{t("site.careers.sentNote")}</span>
            </>
          }
        />
        <Link
          to="/public/careers"
          className="mt-4 inline-flex text-sm text-primary-ink underline underline-offset-4"
        >
          {t("site.careers.anotherRole")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="relative mt-4 space-y-3.5">
      {intake.error && (
        <p
          role="alert"
          className="rounded-[calc(var(--radius)-2px)] border border-bad/35 bg-bad-fill/5 p-3 text-sm"
        >
          {intake.error}
        </p>
      )}
      <Input
        label={t("site.careers.fullName")}
        required
        autoComplete="name"
        value={f.full_name}
        error={intake.fields.full_name}
        onChange={(e) => set("full_name", e.target.value)}
      />
      <Input
        label={t("site.careers.email")}
        type="email"
        required
        autoComplete="email"
        value={f.email}
        error={intake.fields.email}
        onChange={(e) => set("email", e.target.value)}
      />
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Input
          label={`${t("site.careers.phone")} (${t("site.careers.optional")})`}
          type="tel"
          autoComplete="tel"
          value={f.phone}
          error={intake.fields.phone}
          onChange={(e) => set("phone", e.target.value)}
        />
        <Input
          label={`${t("site.careers.address")} (${t("site.careers.optional")})`}
          autoComplete="street-address"
          value={f.address}
          error={intake.fields.address}
          onChange={(e) => set("address", e.target.value)}
        />
        <Input
          label={`${t("site.careers.experience")} (${t("site.careers.optional")})`}
          type="number"
          min={0}
          max={70}
          inputMode="numeric"
          value={f.experience_years}
          error={intake.fields.experience_years}
          onChange={(e) => set("experience_years", e.target.value)}
        />
        <Input
          label={`${t("site.careers.expectedSalary")} (${t("site.careers.optional")})`}
          type="number"
          min={0}
          step="1000"
          inputMode="numeric"
          value={f.expected_salary}
          error={intake.fields.expected_salary}
          onChange={(e) => set("expected_salary", e.target.value)}
        />
      </div>
      <Input
        label={
          requirePortfolio
            ? t("site.careers.portfolio")
            : `${t("site.careers.portfolio")} (${t("site.careers.optional")})`
        }
        required={requirePortfolio}
        inputMode="url"
        placeholder="https://"
        value={f.portfolio_url}
        error={intake.fields.portfolio_url}
        onChange={(e) => set("portfolio_url", e.target.value)}
      />
      <Textarea
        label={
          requireCover
            ? t("site.careers.coverNote")
            : `${t("site.careers.coverNote")} (${t("site.careers.optional")})`
        }
        required={requireCover}
        hint={t("site.careers.coverHint")}
        rows={5}
        maxLength={5000}
        value={f.cover_note}
        error={intake.fields.cover_note}
        onChange={(e) => set("cover_note", e.target.value)}
      />

      <div>
        <p className="field-label">{t("site.careers.cv")}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={intake.busy}
          >
            {t("site.careers.cvPick")}
          </Button>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {file ? file.name : t("site.careers.cvNone")}
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          className="sr-only"
          accept={api.CV_ACCEPT}
          onChange={pick}
          aria-label={t("site.careers.cv")}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t("site.careers.cvHint")}
        </p>
        {(fileError || intake.fields.cv_data_url) && (
          <p role="alert" className="mt-1.5 text-xs text-bad">
            {fileError || intake.fields.cv_data_url}
          </p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full justify-center"
        loading={intake.busy}
        disabled={!canSend}
      >
        {intake.busy ? t("site.careers.sending") : t("site.careers.submit")}
      </Button>
    </form>
  );
}
