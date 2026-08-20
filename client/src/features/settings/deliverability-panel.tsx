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
import { ErrorState } from "@/components/ui/states";
import { useTranslation } from "react-i18next";
import * as api from "@/lib/mail-api";
import { reportActionError } from "@/lib/action-error";

const TONE: Record<string, "ok" | "warn" | "danger" | "mute"> = {
  PASS: "ok", FAIL: "danger", UNKNOWN: "warn",
};

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
    navigator.clipboard?.writeText(text).catch(() => { /* clipboard may be denied */ });
  }

  return (
    <section className={pageShell.reading}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={t("mail.deliverabilityTitle")}
        description={t("mail.deliverabilityDesc")}
      />
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
