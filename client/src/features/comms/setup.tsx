/**
 * Comms → Setup — messaging keys & channels.
 *
 * Shared SMTP login + channel credentials (secrets are write-only: blank keeps
 * current), the troubleshooting card, and the DNS/setup wizard. Review #25
 * removed the per-section sender table that used to sit above the credentials
 * — the Send points tab is the one surface for "which address does this part
 * of the product mail from?". Kit-styled; accents → --primary.
 */
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import { useResource, errMsg } from "@/lib/use-resource";
import * as scapi from "@/lib/smartcomm-api";
import {
  SmtpErrorGuide,
  MailTroubleshootingCard,
} from "@/components/mail/smtp-guide";
import { MailSetupWizard } from "./mail-setup-wizard";

/* Live test result line for the SMTP card. */
function TestLine({ result }: { result: scapi.TestResult | null }) {
  if (!result) return null;
  return result.ok ? (
    <span className="micro text-[rgb(var(--ok))]">
      ✓ Connected
      {typeof result.smtp_host === "string" ? ` · ${result.smtp_host}` : ""}
    </span>
  ) : (
    <span className="micro text-[rgb(var(--bad))]">
      ✗ {String(result.error || "Failed").slice(0, 80)}
    </span>
  );
}

/* SMTP provider config — encrypted password + a live connection test.
 * Secrets are write-only (blank keeps the current value). */
function ChannelConfig() {
  const cfg = useResource(() => scapi.getCommsConfig(), []);
  const em = cfg.data?.email;

  // SMTP
  const [emF, setEmF] = React.useState({
    smtp_host: "",
    smtp_port: "",
    smtp_user: "",
    smtp_pass: "",
  });
  const [emBusy, setEmBusy] = React.useState(false);
  const [emTest, setEmTest] = React.useState<scapi.TestResult | null>(null);
  const [emErr, setEmErr] = React.useState<unknown>(null);
  React.useEffect(() => {
    if (em)
      setEmF((s) => ({
        ...s,
        smtp_host: em.smtp_host || "",
        smtp_port: em.smtp_port ? String(em.smtp_port) : "",
        smtp_user: em.smtp_user || "",
      }));
  }, [em]);
  async function saveEm(e: React.FormEvent) {
    e.preventDefault();
    setEmBusy(true);
    setEmErr(null);
    setEmTest(null);
    try {
      await scapi.setEmailConfig({
        smtp_host: emF.smtp_host || undefined,
        smtp_port: emF.smtp_port === "" ? undefined : Number(emF.smtp_port),
        smtp_user: emF.smtp_user || undefined,
        smtp_pass: emF.smtp_pass || undefined,
      });
      setEmF((s) => ({ ...s, smtp_pass: "" }));
      cfg.reload();
    } catch (err) {
      setEmErr(err);
    } finally {
      setEmBusy(false);
    }
  }
  async function testEm() {
    setEmTest(null);
    setEmErr(null);
    try {
      setEmTest(await scapi.testEmail());
    } catch (err) {
      setEmErr(err);
    }
  }

  return (
    <>
      <form
        onSubmit={saveEm}
        className="rounded-2xl border border-border bg-card p-5 shadow-sm"
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-display text-base">Shared SMTP login</h3>
            <p className="micro">
              Transport for system emails (OTP, invoices, notifications) sent
              from the section senders above. Password encrypted.
            </p>
          </div>
          <Pill tone={em?.pass_set ? "ok" : "warn"}>
            {em?.pass_set ? "Password set" : "Not set"}
          </Pill>
        </div>
        <p className="mb-3 rounded-lg border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
          <strong>Two separate configs.</strong> These section senders + the
          SMTP login are your <strong>system-email</strong>
          config — how Praxis sends OTPs, invoices and notifications. Until you
          add a sender here, they go out from a Praxis address (
          <span className="num">no-reply@praxisls.com</span> /{" "}
          <span className="num">support@praxisls.com</span>) via the deploy-wide
          fallback, so nothing fails before you set your own DNS/SMTP. Your{" "}
          <strong>mailbox</strong>
          (reading &amp; replying to your own company-domain mail, inbound +
          outbound) is separate — connect it in{" "}
          <span className="num">Comms → Mailbox</span>.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("SMTP host")}>
            <Input
              value={emF.smtp_host}
              onChange={(e) =>
                setEmF((s) => ({ ...s, smtp_host: e.target.value }))
              }
              placeholder="smtp.provider.com"
            />
          </Field>
          <Field label={tr("SMTP port")}>
            <Input
              type="number"
              className="num"
              value={emF.smtp_port}
              onChange={(e) =>
                setEmF((s) => ({ ...s, smtp_port: e.target.value }))
              }
              placeholder="587"
            />
          </Field>
          <Field label="SMTP user">
            <Input
              value={emF.smtp_user}
              onChange={(e) =>
                setEmF((s) => ({ ...s, smtp_user: e.target.value }))
              }
              placeholder="apikey / user"
            />
          </Field>
          <Field
            label="SMTP password"
            hint={em?.pass_set ? "Leave blank to keep current." : undefined}
          >
            <Input
              type="password"
              value={emF.smtp_pass}
              onChange={(e) =>
                setEmF((s) => ({ ...s, smtp_pass: e.target.value }))
              }
              placeholder="••••••"
            />
          </Field>
        </div>
        {emErr != null && (
          <div className="mt-2">
            <ErrorState message={errMsg(emErr)} />
            <SmtpErrorGuide err={emErr} />
          </div>
        )}
        {emTest && !emTest.ok && (
          <SmtpErrorGuide code={emTest.code} message={emTest.error} />
        )}
        <div className="mt-3 flex items-center justify-end gap-3">
          <TestLine result={emTest} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={testEm}
            disabled={emBusy}
          >
            Test
          </Button>
          <Button type="submit" size="sm" loading={emBusy} disabled={emBusy}>
            Save
          </Button>
        </div>
      </form>
    </>
  );
}

/**
 * Review #25 — the "Section senders" table and its add/edit/view modal are
 * GONE from this page. That surface predated Send points and answered the same
 * question ("which address does this part of the product mail from?") with a
 * second, competing model — two places to configure one thing is how the two
 * drift apart. The Send points tab is the surviving surface: it lists every
 * place the product actually sends and binds each to a sender or a connected
 * mailbox, with the fallback chain spelled out per row.
 *
 * What legitimately remains here is what Send points does NOT cover: the
 * shared SMTP login and channel credentials (the transport), the mail
 * troubleshooting card, and the DNS/setup wizard.
 */
export function SetupPage() {
  const navigate = useNavigate();
  const [guideOpen, setGuideOpen] = React.useState(false);

  return (
    <section className={pageShell.wide}>
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <div className="micro uppercase tracking-wide">Comms</div>
          <h1 className="font-display text-2xl tracking-tight text-foreground">
            Setup &amp; channels
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Shared credentials, channels and the DNS setup guide. Which address
            each part of the product sends from lives under{" "}
            <strong>Send points</strong>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setGuideOpen(true)}>📖 Setup guide</Button>
          <Button variant="outline" onClick={() => navigate("/comms")}>
            ← Back to inbox
          </Button>
        </div>
      </div>

      <h2 className="mb-2 font-display text-lg">{tr("Credentials")}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChannelConfig />
        <MailTroubleshootingCard />
      </div>

      {guideOpen && (
        <MailSetupWizard
          open
          onClose={() => setGuideOpen(false)}
          onDone={() => setGuideOpen(false)}
        />
      )}
    </section>
  );
}
