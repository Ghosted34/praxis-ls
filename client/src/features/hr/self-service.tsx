/**
 * My HR — employee self-service (PRD §4 / MOD self-service): your own
 * payslips (with PDF download), your leave balances, your leave requests
 * (and asking for leave), and your salary advances. Everything is the
 * caller's own data — the backend enforces ownership on every endpoint.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { tenant } from "@/lib/api-client";
import { tokenStore } from "@/lib/token-store";
import { errMsg } from "@/lib/use-resource";
import { num } from "@/lib/format";

type Payslip = {
  payroll_run_item_id: string;
  gross: number | string;
  net_pay: number | string;
  period_code: string;
  status: string;
};

type Balance = {
  leave_type_id?: string;
  code?: string;
  name?: string;
  balance?: number;
  taken?: number;
  accrued?: number;
  [k: string]: unknown;
};

type LeaveReq = {
  leave_request_id: string;
  kind: string;
  starts_on: string | null;
  ends_on: string | null;
  status: string;
  reason: string | null;
  created_at: string;
};

type Advance = {
  [k: string]: unknown;
};

/** Fetch a self-service binary with the session and save it (anchor click —
 *  the fetch is awaited first, so window.open would be pop-up blocked). */
async function saveSelfFile(path: string, filename: string) {
  const token = tokenStore.getAccess();
  const res = await fetch(`/api/tenant${path}`, {
    headers: {
      "X-Praxis-Env": tokenStore.getEnv(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const msg =
      res.status === 404
        ? "That payslip is not available."
        : res.status === 409
          ? "That payslip has not been rendered yet."
          : "Download failed.";
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function SelfServicePage() {
  const { t } = useTranslation();
  const [payslips, setPayslips] = React.useState<Payslip[] | null>(null);
  const [balances, setBalances] = React.useState<Balance[] | null>(null);
  const [leave, setLeave] = React.useState<LeaveReq[] | null>(null);
  const [advances, setAdvances] = React.useState<Advance[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  // Request-leave form.
  const [leaveForm, setLeaveForm] = React.useState({
    kind: "leave",
    leave_type_id: "",
    starts_on: "",
    ends_on: "",
    reason: "",
  });

  const loadAll = React.useCallback(() => {
    tenant<Payslip[]>("/payroll/mine").then(setPayslips).catch((e) => setError(errMsg(e)));
    tenant<Balance[]>("/leave/mine/balances").then(setBalances).catch((e) => setError(errMsg(e)));
    tenant<LeaveReq[]>("/leave/mine").then(setLeave).catch((e) => setError(errMsg(e)));
    tenant<Advance[]>("/payroll/advances/mine").then(setAdvances).catch((e) => setError(errMsg(e)));
  }, []);

  React.useEffect(loadAll, [loadAll]);

  async function downloadPayslip(p: Payslip) {
    setBusy(`ps:${p.payroll_run_item_id}`);
    setError(null);
    try {
      await saveSelfFile(
        `/payroll/mine/${p.payroll_run_item_id}/pdf`,
        `payslip-${p.period_code}.pdf`,
      );
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function requestLeave(e: React.FormEvent) {
    e.preventDefault();
    setBusy("leave");
    setError(null);
    try {
      await tenant("/leave/mine", {
        method: "POST",
        body: {
          kind: leaveForm.kind,
          leave_type_id: leaveForm.leave_type_id || undefined,
          starts_on: leaveForm.starts_on || undefined,
          ends_on: leaveForm.ends_on || undefined,
          reason: leaveForm.reason || undefined,
        },
      });
      setLeaveForm({
        kind: "leave",
        leave_type_id: "",
        starts_on: "",
        ends_on: "",
        reason: "",
      });
      loadAll();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="My HR" to="/settings" />}
        title={t("hr.myHrTitle")}
        description={t("hr.myHrSub")}
      />

      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t("hr.myPayslips")}>
          {payslips === null ? (
            <SkeletonTable />
          ) : payslips.length === 0 ? (
            <EmptyState
              title={t("hr.noPayslips")}
              hint={t("hr.noPayslipsHint")}
            />
          ) : (
            <ul className="divide-y divide-border">
              {payslips.map((p) => (
                <li
                  key={p.payroll_run_item_id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {p.period_code}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Net {num(Number(p.net_pay))}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busy === `ps:${p.payroll_run_item_id}`}
                    onClick={() => void downloadPayslip(p)}
                  >
                    {t("hr.downloadPdf")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("hr.leaveBalances")}>
          {balances === null ? (
            <SkeletonTable />
          ) : balances.length === 0 ? (
            <EmptyState title={t("hr.noBalances")} hint={t("hr.noBalancesHint")} />
          ) : (
            <ul className="divide-y divide-border">
              {balances.map((b, i) => (
                <li
                  key={String(b.leave_type_id || b.code || i)}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <span className="text-foreground">
                    {String(b.name || b.code || "Leave")}
                  </span>
                  <span className="num text-foreground">
                    {num(Number(b.balance ?? 0))} days
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t("hr.requestLeave")}>
          <form onSubmit={(e) => void requestLeave(e)} className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="date"
                required
                value={leaveForm.starts_on}
                onChange={(e) =>
                  setLeaveForm((f) => ({ ...f, starts_on: e.target.value }))
                }
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <input
                type="date"
                required
                value={leaveForm.ends_on}
                onChange={(e) =>
                  setLeaveForm((f) => ({ ...f, ends_on: e.target.value }))
                }
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <textarea
              value={leaveForm.reason}
              onChange={(e) =>
                setLeaveForm((f) => ({ ...f, reason: e.target.value }))
              }
              rows={2}
              maxLength={2000}
              placeholder={t("hr.reason")}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <Button size="sm" type="submit" loading={busy === "leave"}>
              {t("hr.submitRequest")}
            </Button>
          </form>

          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("hr.myRequests")}
            </p>
            {leave === null ? (
              <SkeletonTable />
            ) : leave.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("hr.noRequests")}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {leave.map((l) => (
                  <li
                    key={l.leave_request_id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <span className="text-foreground">
                      {l.starts_on || "—"} → {l.ends_on || "—"}
                    </span>
                    <span className="status">{l.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel title={t("hr.salaryAdvances")}>
          {advances === null ? (
            <SkeletonTable />
          ) : advances.length === 0 ? (
            <EmptyState
              title={t("hr.noAdvances")}
              hint={t("hr.noAdvancesHint")}
            />
          ) : (
            <ul className="divide-y divide-border">
              {advances.map((a, i) => (
                <li
                  key={String(a.advance_id || i)}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <span className="text-foreground">
                    {a.reason ? String(a.reason) : "Salary advance"}
                  </span>
                  <span className="status">
                    {String(a.status || "—")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </section>
  );
}

export default SelfServicePage;
