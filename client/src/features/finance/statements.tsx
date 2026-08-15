/**
 * Statements — SYSCOHADA financial statements, the general ledger, and the
 * guided monthly close.
 *
 * Split out of `features/finance/pages.tsx` in Phase 3 (audit F7).
 */
import * as React from "react";
import { ApiError } from "@/lib/api-client";
import { errMsg } from "@/lib/use-resource";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Modal } from "@/components/ui/modal";
import * as fin from "@/lib/finance-api";
import type { Period } from "@/lib/finance-api";
import { ReportTabs } from "./report-view";

/* Guided monthly close: list accounting periods, freeze/close the open ones. */
function PeriodStatusPill({ status }: { status: string }) {
  const s = status.toUpperCase();
  const tone =
    s === "OPEN"
      ? "bg-primary/10 text-primary-ink"
      : s === "FROZEN"
        ? "bg-[rgb(var(--warn)/0.15)] text-[rgb(var(--warn))]"
        : "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tone)}>
      {s}
    </span>
  );
}

function PeriodsPanel() {
  const [periods, setPeriods] = React.useState<Period[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [pending, setPending] = React.useState<{
    period: Period;
    to: "FROZEN" | "CLOSED";
  } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const reload = () => setNonce((n) => n + 1);

  React.useEffect(() => {
    let live = true;
    setPeriods(null);
    setError(null);
    fin
      .listPeriods()
      .then((d) => live && setPeriods(d.periods || []))
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 403)
          setError("You don't have permission to view accounting periods.");
        else
          setError(
            e instanceof ApiError ? e.message : "Failed to load periods.",
          );
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setActionError(null);
    try {
      await fin.closePeriod({
        period_id: pending.period.period_id,
        to: pending.to,
      });
      setPending(null);
      reload();
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error ? (
        <ErrorState message={error} />
      ) : periods === null ? (
        <SkeletonTable />
      ) : periods.length === 0 ? (
        <EmptyState
          title="No accounting periods"
          hint="Periods are provisioned per entity fiscal calendar."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Period</TH>
              <TH>Start</TH>
              <TH>End</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {periods.map((p) => {
              const s = String(p.status).toUpperCase();
              return (
                <TR key={p.period_id}>
                  <TD className="text-sm font-medium">{p.code}</TD>
                  <TD className="text-sm">{p.starts_on ?? "—"}</TD>
                  <TD className="text-sm">{p.ends_on ?? "—"}</TD>
                  <TD>
                    <PeriodStatusPill status={s} />
                  </TD>
                  <TD>
                    <div className="flex gap-2">
                      {s === "OPEN" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPending({ period: p, to: "FROZEN" })
                          }
                        >
                          Freeze
                        </Button>
                      )}
                      {(s === "OPEN" || s === "FROZEN") && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            setPending({ period: p, to: "CLOSED" })
                          }
                        >
                          Close
                        </Button>
                      )}
                      {s === "CLOSED" && (
                        <span className="text-xs text-muted-foreground">
                          locked
                        </span>
                      )}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <Modal
        open={!!pending}
        onClose={() => !busy && setPending(null)}
        title={pending?.to === "CLOSED" ? "Close period" : "Freeze period"}
        description={
          pending?.to === "CLOSED"
            ? "Closing locks the period — no further entries can post to it. Requires a balanced trial balance."
            : "Freezing soft-locks the period; it can still be closed afterwards."
        }
      >
        <div className="space-y-4">
          <p className="text-sm">
            {pending?.to === "CLOSED" ? "Close" : "Freeze"} period{" "}
            <span className="font-medium">{pending?.period.code}</span>?
          </p>
          {actionError && <ErrorState message={actionError} />}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setPending(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant={pending?.to === "CLOSED" ? "destructive" : "default"}
              onClick={confirm}
              loading={busy}
            >
              {pending?.to === "CLOSED" ? "Close period" : "Freeze period"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
export const StatementsPage = () => (
  <ReportTabs
    title="Statements"
    description="SYSCOHADA financial statements, general ledger and the guided monthly close."
    periodMode="period_id"
    tabs={[
      { key: "tb", label: "Trial balance", path: "/statements/trial-balance" },
      {
        key: "is",
        label: "Compte de résultat",
        path: "/statements/income-statement",
      },
      { key: "bs", label: "Bilan", path: "/statements/balance-sheet" },
      { key: "gl", label: "Grand livre", path: "/statements/grand-livre" },
      { key: "cf", label: "Cash flow", path: "/statements/cash-flow" },
      { key: "notes", label: "Notes", path: "/statements/notes" },
      {
        key: "periods",
        label: "Periods / close",
        render: () => <PeriodsPanel />,
      },
    ]}
  />
);
