/**
 * Settings → Deliverability (PR-2). Traffic-light row per domain, expandable
 * to the exact DNS record to add, with a copy button.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Pill } from "@/components/ui/pill";
import { Input } from "@/components/ui/input";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { useTranslation } from "react-i18next";
import * as api from "@/lib/mail-api";
import { reportActionError } from "@/lib/action-error";

const TONE: Record<string, "ok" | "warn" | "bad" | "mute"> = {
  PASS: "ok", FAIL: "bad", UNKNOWN: "warn",
};

/**
 * "Does mail we send actually REACH this domain?"
 *
 * Everything else on this page is about a domain we send AS — its SPF, DKIM and
 * DMARC, our IP's reputation. All of that can be perfect while mail to a given
 * client still never arrives, because a relay that hosts the recipient's domain
 * files the message into a mailbox on ITSELF instead of routing it to their real
 * mail server. It is answered 250, recorded as sent, and never bounced.
 *
 * The send path already refuses such a recipient. This panel is for the question
 * that comes first: an administrator told "our mail to this client vanishes"
 * needs to ask directly, and needs to see the three facts the verdict rests on
 * rather than be asked to trust a red light.
 */
function DeliveryRouteCard() {
  const { t } = useTranslation();
  const [domain, setDomain] = React.useState("");
  const [verdict, setVerdict] = React.useState<api.DeliveryRouteVerdict | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function run() {
    if (!domain.trim()) return;
    setBusy(true);
    try { setVerdict(await api.checkDeliveryRoute(domain.trim())); }
    catch (err) { reportActionError(err); }
    finally { setBusy(false); }
  }

  // LOCAL_TRAP is the only state that is a fault. OK is reassurance; UNKNOWN is
  // an absence of evidence and must never be dressed up as a problem.
  const tone = verdict?.state === "LOCAL_TRAP" ? "bad"
    : verdict?.state === "OK" ? "ok" : "info";

  return (
    <div className="lux-card mb-4 p-3">
      <h2 className="font-medium">{t("mail.routeCheckTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("mail.routeCheckDesc")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
          placeholder="client-domain.cm"
          aria-label={t("mail.routeCheckTitle")}
          className="max-w-xs"
        />
        <Button size="sm" onClick={() => void run()} loading={busy} disabled={!domain.trim()}>
          {t("mail.routeCheckRun")}
        </Button>
      </div>
      {verdict && (
        <div className="mt-3">
          <Callout tone={tone} title={verdict.domain || domain}>
            {verdict.reason}
          </Callout>
          {/* The evidence, not just the verdict — these three lines are what an
              administrator forwards to their host to get it fixed. */}
          <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-[10rem_1fr]">
            <dt>{t("mail.routeSendingHost")}</dt>
            <dd className="break-all font-mono">
              {verdict.smtp_host || "—"}
              {verdict.relay_ips?.length ? ` (${verdict.relay_ips.join(", ")})` : ""}
            </dd>
            <dt>{t("mail.routeRecipientIps")}</dt>
            <dd className="break-all font-mono">{verdict.recipient_ips?.join(", ") || "—"}</dd>
            <dt>{t("mail.routeMailServer")}</dt>
            <dd className="break-all font-mono">{verdict.mx_hosts?.join(", ") || "—"}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}

export function DeliverabilityPage() {
  const { t } = useTranslation();
  const [rows, setRows] = React.useState<api.DomainHealthRow[]>([]);
  const [open, setOpen] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try { setRows(await api.listDeliverability()); }
    catch (err) { setError((err as { message?: string })?.message || "Could not load."); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const byDomain = React.useMemo(() => {
    const m = new Map<string, api.DomainHealthRow[]>();
    for (const r of rows) {
      const list = m.get(r.domain) || [];
      list.push(r);
      m.set(r.domain, list);
    }
    return [...m.entries()];
  }, [rows]);

  async function recheck() {
    setBusy(true); setError(null);
    try { await api.checkDeliverability(); await load(); }
    catch (err) { reportActionError(err); }
    finally { setBusy(false); }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).catch(() => { /* @silent:teardown clipboard may be denied */ });
  }

  return (
    <section className={pageShell.reading}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={t("mail.deliverabilityTitle")}
        description={t("mail.deliverabilityDesc")}
      />
      <DeliveryRouteCard />
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={recheck} loading={busy}>{t("mail.recheckNow")}</Button>
      </div>
      {error && <ErrorState message={error} />}
      <ul className="space-y-2">
        {byDomain.map(([domain, checks]) => {
          const worst = checks.some((c) => c.verdict === "FAIL") ? "FAIL"
            : checks.some((c) => c.verdict === "UNKNOWN") ? "UNKNOWN" : "PASS";
          return (
            <li key={domain} className="lux-card p-3">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left"
                onClick={() => setOpen(open === domain ? null : domain)}
                aria-expanded={open === domain}
              >
                <span className="font-medium">{domain}</span>
                <Pill tone={TONE[worst]}>{worst}</Pill>
              </button>
              {open === domain && (
                <ul className="mt-3 space-y-2 border-t border-border pt-3">
                  {checks.map((c) => (
                    <li key={c.domain_health_check_id} className="text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{c.record}</span>
                        <Pill tone={TONE[c.verdict] || "mute"}>{c.verdict}</Pill>
                      </div>
                      {c.value && <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{c.value}</p>}
                      {c.suggestion && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {c.suggestion}{" "}
                          <button type="button" className="underline" onClick={() => copy(c.value || c.suggestion || "")}>
                            {t("mail.copyRecord")}
                          </button>
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {byDomain.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">No sending domains yet. Connect a mailbox first.</p>
      )}
    </section>
  );
}

export default DeliverabilityPage;
