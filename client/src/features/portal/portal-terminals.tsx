/**
 * Client portal — the three role terminals: client, investor, auditor.
 *
 * Split out of `features/portal/portal-app.tsx` in Phase 4 (audit F7). Each
 * shows a deliberately different slice: shipments for a client, financials for
 * an investor, the audit room for an auditor.
 */

import * as React from "react";
import { Panel } from "@/components/ui/panel";
import { num, dateFmt } from "@/lib/format";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { portalClientView, portalInvestorView, portalAuditorView, type PortalMe, type ClientView, type InvestorView, type AuditorView } from "@/lib/portal-api";
import { msg } from "./portal-chrome";
import { label } from "./portal-auth";

function Kpi({ label: k, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{k}</p>
      <p className="num mt-2 text-2xl text-foreground">{num(value)}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Line({ label: k, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2 ${strong ? "border-t border-border font-semibold" : ""}`}>
      <span className={strong ? "text-sm text-foreground" : "text-sm text-muted-foreground"}>{k}</span>
      <span className="num text-sm text-foreground">{num(value)}</span>
    </div>
  );
}

export function InvestorTerminal({ me }: { me: PortalMe }) {
  const [view, setView] = React.useState<InvestorView | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    portalInvestorView()
      .then((v) => alive && setView(v))
      .catch((e) => alive && setError(msg(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!view) return <SkeletonTable />;

  const { kpis, income_statement: is, balance_sheet: bs, cash_position: cash } = view;

  return (
    <>
      <h1 className="font-display text-2xl text-foreground">
        Financial position{me.portal_user.full_name ? `, ${me.portal_user.full_name.split(" ")[0]}` : ""}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {dateFmt(view.period.from)} to {dateFmt(view.period.to)} · {view.basis} basis
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Revenue" value={kpis.revenue} hint="Produits for the period" />
        <Kpi label="Net result" value={kpis.net_result} hint="Produits less charges" />
        <Kpi label="Cash on hand" value={kpis.cash_on_hand} hint="Today, not period-end" />
        <Kpi label="Balance sheet total" value={kpis.balance_sheet_total} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Compte de résultat">
          <Line label="Produits" value={is.produits} />
          <Line label="Charges" value={is.charges} />
          {is.hao_net ? <Line label="Hors activités ordinaires (net)" value={is.hao_net} /> : null}
          <Line label="Résultat net" value={is.result} strong />
        </Panel>

        <Panel title="Bilan">
          <Line label="Actif" value={bs.active} />
          <Line label="Passif" value={bs.passif} />
          <Line label="Résultat" value={bs.result} strong />
          {!bs.balanced ? (
            // Shown, not hidden: an unbalanced bilan means the books need
            // attention, and quietly rendering it as though it were final would
            // be the worse of the two failures.
            <p className="mt-2 text-xs text-[hsl(var(--warn))]">
              Actif and passif do not balance for this period — figures are provisional.
            </p>
          ) : null}
        </Panel>

        <Panel title="Cash position">
          {cash.accounts.length === 0 ? (
            <EmptyState title="No treasury accounts" hint="Class-5 balances will appear here." />
          ) : (
            <>
              {cash.accounts.map((a) => (
                <Line key={a.account_code} label={a.account_code} value={a.balance} />
              ))}
              <Line label="Total" value={cash.total_cash} strong />
            </>
          )}
        </Panel>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Read-only summary prepared on the {view.basis} basis. No operational detail is included.
      </p>
    </>
  );
}

/* ── auditor room ───────────────────────────────────────────────────────── */

export function AuditorTerminal({ me }: { me: PortalMe }) {
  const [view, setView] = React.useState<AuditorView | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    portalAuditorView()
      .then((v) => alive && setView(v))
      .catch((e) => alive && setError(msg(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!view) return <SkeletonTable />;

  const { income_statement: is, balance_sheet: bs, trial_balance: tb, audit_trail: trail } = view;
  const actionLabel = (a: string) => (a || "").replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());

  return (
    <>
      <h1 className="font-display text-2xl text-foreground">
        Audit room{me.portal_user.full_name ? `, ${me.portal_user.full_name.split(" ")[0]}` : ""}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {dateFmt(view.period.from)} to {dateFmt(view.period.to)} · {view.basis} basis
        {me.grants.AUDITOR?.expires_at ? ` · access to ${dateFmt(me.grants.AUDITOR.expires_at)}` : ""}
      </p>
      <p className="mt-3 rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">{view.disclosure}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Compte de résultat">
          <Line label="Produits" value={is.produits} />
          <Line label="Charges" value={is.charges} />
          <Line label="Résultat net" value={is.result} strong />
        </Panel>
        <Panel title="Bilan">
          <Line label="Actif" value={bs.active} />
          <Line label="Passif" value={bs.passif} />
          <Line label="Résultat" value={bs.result} strong />
          {!bs.balanced ? (
            <p className="mt-2 text-xs text-[hsl(var(--warn))]">Actif and passif do not balance for this period — figures are provisional.</p>
          ) : null}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="Trial balance">
          {tb.rows.length === 0 ? (
            <EmptyState title="No movements" hint="No ledger movements for this period." />
          ) : (
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 text-left font-medium">Account</th>
                    <th className="py-2 text-right font-medium">Debit</th>
                    <th className="py-2 text-right font-medium">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tb.rows.map((r) => (
                    <tr key={r.account_code}>
                      <td className="py-2 text-foreground">{r.account_code}</td>
                      <td className="num py-2 text-right text-foreground">{num(r.debit)}</td>
                      <td className="num py-2 text-right text-foreground">{num(r.credit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border">
                  <tr>
                    <td className="py-2 font-semibold text-foreground">Total</td>
                    <td className="num py-2 text-right font-semibold text-foreground">{num(tb.totals.debit)}</td>
                    <td className="num py-2 text-right font-semibold text-foreground">{num(tb.totals.credit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="Audit trail">
          {trail.length === 0 ? (
            <EmptyState title="No postings" hint="Financial and document postings for the period will appear here." />
          ) : (
            <div className="max-h-96 overflow-auto">
              <ul className="divide-y divide-border">
                {trail.map((t) => (
                  <li key={t.ledger_id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{actionLabel(t.action)}</p>
                      <p className="truncate text-xs text-muted-foreground">{t.entity_ref || "—"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm text-foreground">{t.actor_name || "System"}</p>
                      <p className="text-xs text-muted-foreground">{dateFmt(t.created_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Read-only, prepared on the {view.basis} basis for the period shown. HR, payroll and security events are excluded.
      </p>
    </>
  );
}

/* ── client view ────────────────────────────────────────────────────────── */

export function ClientTerminal({ me }: { me: PortalMe }) {
  const [view, setView] = React.useState<ClientView | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    portalClientView()
      .then((v) => alive && setView(v))
      .catch((e) => alive && setError(msg(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <ErrorState message={error} />;

  const dossiers = view?.dossiers ?? [];
  const invoices = view?.invoices ?? [];

  return (
    <>
      <h1 className="font-display text-2xl text-foreground">
        Welcome{me.portal_user.full_name ? `, ${me.portal_user.full_name.split(" ")[0]}` : ""}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {me.grants.CLIENT.expires_at ? `Your access runs to ${dateFmt(me.grants.CLIENT.expires_at)}.` : "Your current shipments and invoices."}
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel title="Shipments">
          {!view ? (
            <SkeletonTable />
          ) : dossiers.length === 0 ? (
            <EmptyState title="No shipments yet" hint="New files will appear here as they're opened." />
          ) : (
            <ul className="divide-y divide-border">
              {dossiers.map((d) => (
                <li key={d.dossier_id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{d.ref}</p>
                    <p className="text-xs text-muted-foreground">Opened {dateFmt(d.created_at)}</p>
                  </div>
                  <span className="status">{label(d.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Invoices">
          {!view ? (
            <SkeletonTable />
          ) : invoices.length === 0 ? (
            <EmptyState title="Nothing outstanding" hint="Issued invoices will appear here." />
          ) : (
            <ul className="divide-y divide-border">
              {invoices.map((i) => (
                <li key={i.invoice_id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{i.doc_number || "—"}</p>
                    <p className="text-xs text-muted-foreground">Due {dateFmt(i.payment_due_on)}</p>
                  </div>
                  <div className="text-right">
                    <p className="num text-sm text-foreground">{num(i.total_ttc)}</p>
                    <span className="status">{label(i.status)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

/**
 * Routes a signed-in portal user to whichever terminal(s) their grants allow.
 *
 * A single login can legitimately hold more than one grant (a CFO who is both a
 * client contact and on the board, or an auditor also given the investor view),
 * so this picks the first allowed in CLIENT → INVESTOR → AUDITOR order and offers
 * a switch when there's more than one. All three terminals are live.
 */
