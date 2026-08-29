import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Honeypot } from "@/components/ui/field";
import { newsletter } from "@/lib/intake-api";
import { useIntake } from "@/lib/use-intake";

/**
 * The footer newsletter — `POST /public/intake/newsletter`, whose schema is
 * `{ email, name? }` and nothing else.
 *
 * One field because that is all the endpoint accepts, and because a footer
 * subscribe box with four fields is a form nobody finishes while reading legal
 * small print. It is deliberately the smallest thing on the page: a tenant who
 * turns the marketing campaign module off sees this fail with a 403, and the
 * inline error says so without the page having to know what a 403 means.
 */
export function NewsletterForm() {
  const { t } = useTranslation();
  const [email, setEmail] = React.useState("");

  const intake = useIntake<{ received: boolean; reference: string }>({
    send: (body, startedAt) =>
      newsletter.send(body as Parameters<typeof newsletter.send>[0], startedAt),
    onRateLimited: t("site.footer.newsletterLimited"),
    onFailed: t("site.footer.newsletterErr"),
  });

  if (intake.result) {
    return (
      <p role="status" className="text-sm text-[var(--hero-foreground)]">
        {t("site.footer.newsletterOk")}
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!/.+@.+\..+/.test(email.trim())) return;
        void intake.submit({ email: email.trim() });
      }}
      className="relative flex max-w-md flex-col gap-2 sm:flex-row sm:items-start"
    >
      <div className="min-w-0 flex-1">
        <label htmlFor="newsletter-email" className="sr-only">
          {t("site.footer.newsletterEmail")}
        </label>
        <input
          id="newsletter-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("site.footer.newsletterEmail")}
          autoComplete="email"
          className="min-h-11 w-full rounded-[calc(var(--radius)-2px)] border border-[var(--hero-line)] bg-[rgb(237_238_238/0.08)] px-3.5 text-sm text-[var(--hero-foreground)] placeholder:text-[var(--hero-muted)] focus-visible:outline-2 focus-visible:outline-offset-1"
        />
        {intake.error ? (
          <p
            role="alert"
            className="mt-1.5 text-xs text-[var(--hero-foreground)]"
          >
            {intake.error}
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-[var(--hero-muted)]">
            {t("site.footer.newsletter")}
          </p>
        )}
      </div>
      <Honeypot value={intake.honeypot} onChange={intake.setHoneypot} />
      <Button
        type="submit"
        variant="onHero"
        size="default"
        loading={intake.busy}
        disabled={!email.trim() || intake.busy}
      >
        {intake.busy
          ? t("site.footer.sending")
          : t("site.footer.newsletterCta")}
      </Button>
    </form>
  );
}
