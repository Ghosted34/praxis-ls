/**
 * A client's account manager (client portal PR 3, 14200): the person on the
 * team who looks after the client, and the first one their portal messages
 * reach — with the owners of the shipment a message is about.
 *
 * Chosen with the employee picker, limited to people who have a login
 * (`requireAccount`): an account manager is someone a message must be able to
 * reach, and the server refuses a login that is not active. The picker
 * searches `/clients/account-manager-candidates` rather than `/employees`: the
 * sales and operations people who assign account managers hold the Client
 * inbox, not the employee master. Someone who has
 * since left shows as unreachable, and until a new manager is named the
 * client's messages go to the Client inbox team instead — which this says, so
 * nobody assumes a client is looked after when nobody is being told.
 *
 * Shown on the client's own screen (Overview and Messages) and at the top of a
 * conversation in the Client inbox.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { useResource, errMsg } from "@/lib/use-resource";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/use-confirm";
import { EmployeePicker, type EmployeeHit } from "@/components/employee-picker";
import { cn } from "@/lib/cn";

export type AccountManager = {
  client_id: string;
  manager: {
    user_id: string;
    name: string | null;
    job_title: string | null;
    email: string | null;
    employee_id: string | null;
    reachable: boolean;
  } | null;
};

const path = (clientId: string) => `/clients/${encodeURIComponent(clientId)}/account-manager`;

export function AccountManagerCard({
  clientId,
  className,
  onChange,
}: {
  clientId: string;
  className?: string;
  /** Called after a change — the Client inbox refreshes who looks after whom. */
  onChange?: () => void;
}) {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const res = useResource(() => tenant<AccountManager>(path(clientId)), [clientId], { fresh: true });
  const [picking, setPicking] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const m = res.data?.manager || null;

  async function save(userId: string | null) {
    setBusy(true);
    try {
      await tenant<AccountManager>(path(clientId), { method: "PUT", body: { user_id: userId } });
      toast.success(userId ? tr("Account manager saved") : tr("Account manager removed"));
      setPicking(false);
      res.reload();
      onChange?.();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function pick(hit: EmployeeHit) {
    if (!hit.account_user_id) return;
    void save(hit.account_user_id);
  }

  async function remove() {
    const ok = await confirm({
      title: tr("Remove the account manager?"),
      body: tr("Until someone else is named, this client's messages go to the client inbox team."),
      confirmLabel: tr("Remove"),
      cancelLabel: tr("Keep"),
    });
    if (ok) void save(null);
  }

  return (
    <div className={cn("rounded-xl border bg-card p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="micro">{tr("Account manager")}</p>
          {res.loading ? (
            <p className="text-sm text-muted-foreground">{tr("Loading…")}</p>
          ) : res.error ? (
            <p className="text-sm text-[rgb(var(--bad))]">{res.error}</p>
          ) : m ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-foreground">{m.name || m.email || tr("Unnamed")}</p>
              {m.job_title ? <span className="text-xs text-muted-foreground">{m.job_title}</span> : null}
              {!m.reachable ? <Pill tone="bad">{tr("No active login")}</Pill> : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{tr("Nobody yet — messages go to the client inbox team")}</p>
          )}
        </div>
        {!res.loading && !res.error ? (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant={m ? "outline" : "default"} onClick={() => setPicking((v) => !v)} disabled={busy}>
              {m ? tr("Change") : tr("Assign")}
            </Button>
            {m ? (
              <Button size="sm" variant="ghost" onClick={() => void remove()} disabled={busy}>
                {tr("Remove")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {picking ? (
        <div className="mt-3">
          <EmployeePicker
            id={`account-manager-${clientId}`}
            label={tr("Choose the account manager")}
            placeholder={tr("Search by name or job title…")}
            requireAccount
            source="/clients/account-manager-candidates"
            disabled={busy}
            exclude={m?.employee_id ? new Set([m.employee_id]) : undefined}
            onPick={pick}
          />
          <p className="mt-1 text-xs text-muted-foreground">{tr("Only people with a login can be told when the client writes.")}</p>
        </div>
      ) : null}
      {confirmDialog}
    </div>
  );
}
