import * as React from "react";
import { useTranslation } from "react-i18next";
import * as api from "@/lib/careers-api";
import { currentLocale } from "@/lib/i18n";
import { useIntake } from "@/lib/use-intake";
import { Card } from "@/components/ui/card";
import { Panel } from "@/components/ui/panel";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { SuccessState } from "@/components/state";
import { ClockIcon, DocumentIcon } from "@/components/ui/icons";
import { LazyCandidateForm } from "./candidate-form-lazy";
import { p } from "@/lib/base-path";
// Registers `site.careers.*`, which lives in this chunk rather than in the
// entry dictionary. Imported for the side effect; see careers-i18n.ts.
import "./careers-i18n";

/**
 * What the careers page says when nothing is open — the state it is in most of
 * the time (13792).
 *
 * ── WHY THIS IS NOT `<EmptyState>` ────────────────────────────────────────
 *
 * `EmptyState` draws a DASHED border, and `presentation.tsx` says in as many
 * words why: "a dashed outline reads as a placeholder waiting to be filled,
 * which is right for 'no milestones yet' and wrong for an answer." A company
 * that is not hiring this month is not a page waiting to be filled in. It is
 * the answer, and on a white-label product it is the answer a stranger forms
 * their impression of the tenant from — so it gets a solid surface, like
 * `NotFoundState` two functions below the one it used to use.
 *
 * ── WHY THE COPY CHANGED ──────────────────────────────────────────────────
 *
 * It read "Please check back — this page is kept up to date", which asks the
 * visitor to do the work and promises nothing a visitor can verify. The
 * replacement says the one thing that is true HERE and is not true of most
 * careers pages: a vacancy carries `closes_on` and drops off the public list on
 * its own date (`publishedList`), so this list cannot be the stale one somebody
 * forgot to take down. That is a fact about the product, not a boast.
 *
 * ── WHAT A VISITOR CAN ACTUALLY DO ────────────────────────────────────────
 *
 * Whatever the tenant has switched on, and nothing otherwise. Both switches
 * default false, so an unconfigured tenant — which is every tenant the day this
 * ships — gets the band, the sentence and a link to their contact page, which
 * is a far better dead end than a dashed rectangle but is still honest about
 * being one.
 */
export function NotHiring({ settings }: { settings: api.CareersSettings }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState<"cv" | "alert" | null>(null);

  const canCv = settings.open_applications;
  const canAlert = settings.alerts_enabled;

  return (
    <div className="mx-auto max-w-3xl">
      <Card className="p-8 text-center sm:p-10">
        <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--ink)/0.06)] text-muted-foreground">
          <ClockIcon size={20} />
        </span>
        <h2 className="text-title font-semibold tracking-tight">
          {t("site.careers.empty")}
        </h2>
        <p className="mx-auto mt-2 max-w-measure text-sm text-muted-foreground">
          {t("site.careers.emptyHint")}
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {canCv && (
            <Button
              size="lg"
              onClick={() => setOpen((o) => (o === "cv" ? null : "cv"))}
              aria-expanded={open === "cv"}
            >
              {t("site.careers.openCta")}
            </Button>
          )}
          {canAlert && (
            <Button
              size="lg"
              variant={canCv ? "outline" : "default"}
              onClick={() => setOpen((o) => (o === "alert" ? null : "alert"))}
              aria-expanded={open === "alert"}
            >
              {t("site.careers.alertCta")}
            </Button>
          )}
          {/* The fallback, and the only thing an unconfigured tenant offers.
              `/contact` rather than a `mailto:` — the contact form already
              carries a CAREERS enquiry type, and an address printed on a public
              page is a spam magnet the tenant cannot withdraw. */}
          {!canCv && !canAlert && (
            <ButtonLink to={p("/contact")} size="lg">
              {t("site.careers.quietCta")}
            </ButtonLink>
          )}
        </div>

        {!canCv && !canAlert && (
          <p className="mx-auto mt-3 max-w-measure text-xs text-muted-foreground">
            {t("site.careers.quietNote")}
          </p>
        )}
      </Card>

      {open === "cv" && canCv && <OpenApplication />}
      {open === "alert" && canAlert && <JobAlertForm />}
    </div>
  );
}

/**
 * An application with no role attached.
 *
 * The confirmation is deliberately NOT the one a role application gets. That
 * one says a reference and implies a pipeline; this one has neither a vacancy
 * nor a closing date behind it, and telling somebody "your application is in"
 * when nobody is reviewing applications this month is the kind of true-sounding
 * sentence people plan around.
 */
function OpenApplication() {
  const { t } = useTranslation();
  return (
    <Panel className="mt-4" title={t("site.careers.openFormTitle")}>
      <p className="max-w-measure text-sm text-muted-foreground">
        {t("site.careers.openLead")}
      </p>
      <LazyCandidateForm
        send={(body) => api.applyOpen(body)}
        coverLabel={t("site.careers.openWanted")}
        coverHint={t("site.careers.openWantedHint")}
        submitLabel={t("site.careers.openSubmit")}
        renderSent={(r) => (
          <div className="mt-4">
            <SuccessState
              title={t("site.careers.openSentTitle")}
              hint={
                <>
                  {r.cv_attached
                    ? t("site.careers.openSentCv", { reference: r.reference })
                    : t("site.careers.openSentNoCv", { reference: r.reference })}
                  <span className="mt-2 block">
                    {t("site.careers.openSentNote")}
                  </span>
                </>
              }
            />
          </div>
        )}
      />
    </Panel>
  );
}

/**
 * Two fields and a promise.
 *
 * `locale` is sent because the page knows what language it is being read in and
 * the digest is written in one — a careers page served in French that then
 * mails in English is the same defect as an untranslated advert, arriving a
 * fortnight later.
 *
 * The confirmation never says whether the address was already subscribed.
 * `careers.service` explains why: an answer that distinguishes the two turns
 * this form into a way of testing whether a named person is on a named
 * company's list.
 */
function JobAlertForm() {
  const { t } = useTranslation();
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");

  const intake = useIntake<{ received: boolean }>({
    send: (body) => api.subscribeAlert(body as api.AlertInput),
    onRateLimited: t("site.careers.limited"),
    onFailed: t("site.careers.err"),
  });

  const canSend = /.+@.+\..+/.test(email.trim()) && !intake.busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    await intake.submit({
      email: email.trim(),
      name: name.trim() || undefined,
      locale: currentLocale().startsWith("fr") ? "fr" : "en",
    });
  }

  return (
    <Panel className="mt-4" title={t("site.careers.alertTitle")}>
      {intake.result ? (
        <SuccessState
          title={t("site.careers.alertSentTitle")}
          hint={t("site.careers.alertSentNote")}
        />
      ) : (
        <form onSubmit={submit} className="space-y-3.5">
          <p className="max-w-measure text-sm text-muted-foreground">
            {t("site.careers.alertLead")}
          </p>
          {intake.error && (
            <p
              role="alert"
              className="rounded-[calc(var(--radius)-2px)] border border-bad/35 bg-bad-fill/5 p-3 text-sm"
            >
              {intake.error}
            </p>
          )}
          <Input
            label={t("site.careers.alertEmail")}
            type="email"
            required
            autoComplete="email"
            value={email}
            error={intake.fields.email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label={`${t("site.careers.alertName")} (${t("site.careers.optional")})`}
            autoComplete="name"
            value={name}
            error={intake.fields.name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <DocumentIcon size={14} />
            {t("site.careers.alertConsent")}
          </p>
          <Button
            type="submit"
            size="lg"
            className="w-full justify-center"
            loading={intake.busy}
            disabled={!canSend}
          >
            {intake.busy
              ? t("site.careers.alertSending")
              : t("site.careers.alertCta")}
          </Button>
        </form>
      )}
    </Panel>
  );
}

/**
 * `/careers/alerts/unsubscribe/:token` — the other end of every digest.
 *
 * It posts on mount rather than showing a confirm button, because the person
 * arrived here by clicking "unsubscribe" and has already expressed the
 * intention; asking them to express it twice is how an unsubscribe link earns
 * a spam complaint instead of preventing one. The POST is safe to fire from a
 * click because it is a POST — a prefetching mail client cannot trigger it.
 *
 * There is one outcome. A token that matched and a token that never existed
 * both render "you are off the list", for the reason the service returns the
 * same body for both: a page that said "no such subscription" would let anyone
 * probe tokens.
 */
export function UnsubscribePage({ token }: { token: string }) {
  const { t } = useTranslation();
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    api
      .unsubscribeAlert(token)
      // Resolved or rejected, the answer on screen is the same. A visitor who
      // cannot be told anything useful about the failure is better served by
      // the sentence that is true in every case they can act on.
      .catch(() => undefined)
      .then(() => {
        if (alive) setDone(true);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  /* No heading of its own: the page's `<h1>` is in the entrance band above,
     which is what `route-entrances.test.tsx` checks for and, more to the point,
     what stops this route being the one page in the app that opens on a bare
     card. */
  return (
    <div className="mx-auto max-w-2xl">
      <Card className="p-8 text-center sm:p-10">
        <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--ink)/0.06)] text-muted-foreground">
          <ClockIcon size={20} />
        </span>
        <p className="mx-auto max-w-measure text-sm font-medium">
          {done ? t("site.careers.unsubDone") : t("site.careers.unsubBusy")}
        </p>
        {done && (
          <>
            <p className="mx-auto mt-2 max-w-measure text-xs text-muted-foreground">
              {t("site.careers.unsubNote")}
            </p>
            <div className="mt-6">
              <ButtonLink to={p("/careers")} size="lg">
                {t("site.careers.back")}
              </ButtonLink>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
