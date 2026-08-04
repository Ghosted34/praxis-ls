/**
 * Security — live sessions, and revoking them.
 *
 * Split out of `features/security/pages.tsx` in Phase 4 (audit F7).
 */

import * as React from "react";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Pill } from "@/components/ui/pill";
import { useList, errMsg } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";
import { tenant } from "@/lib/api-client";
import { RowActions } from "@/components/ui/row-actions";
import { type Session, shell } from "./shared";

export function SessionsPage() {
  const [tab, setTab] = React.useState<"mine" | "all">("mine");
  const mine = useList<Session>("/sessions/mine");
  const all = useList<Session>(tab === "all" ? "/sessions" : null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function killAllMine() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/sessions/mine/revoke-all", { method: "POST" });
      mine.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function kill(id: string) {
    setError(null);
    try {
      await tenant(`/sessions/${id}/kill`, { method: "POST" });
      mine.reload();
      all.reload();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const baseCols: Column<Session>[] = [
    { key: "created_at", label: "Started", render: (r) => <span className="num">{dateFmt(r.created_at)}</span> },
    { key: "last_seen_at", label: "Last seen", render: (r) => <span className="num">{dateFmt(r.last_seen_at)}</span> },
    { key: "ip", label: "IP", render: (r) => <span className="num text-muted-foreground">{r.ip || "—"}</span> },
    { key: "user_agent", label: "Device", render: (r) => <span className="text-muted-foreground">{(r.user_agent || "—").slice(0, 48)}</span> },
    { key: "state", label: "State", render: (r) => (r.revoked_at ? <Pill tone="bad">Revoked</Pill> : <Pill tone="ok">Active</Pill>) },
  ];

  const withKill: Column<Session>[] = [
    ...baseCols,
    { key: "_a", label: "", render: (r) => <RowActions><Button size="sm" variant="outline" disabled={!!r.revoked_at} onClick={() => kill(r.session_id)}>Revoke</Button></RowActions> },
  ];

  const adminCols: Column<Session>[] = [
    { key: "user_id", label: "User", render: (r) => <span className="num text-muted-foreground">{r.user_id ? `…${r.user_id.slice(-8)}` : "—"}</span> },
    ...withKill,
  ];

  return (
    <section className={shell}>
      <PageHeader
        eyebrow={<HubCrumb area="Security & access" to="/security" />}
        title="Sessions"
        description="Active sign-ins. Revoking a session invalidates its refresh token immediately — the next refresh is rejected as reuse."
        action={tab === "mine" ? <Button variant="outline" onClick={killAllMine} loading={busy}>Revoke all mine</Button> : undefined}
      />
      <HubTabs />
      <Segmented
        label="Session scope"
        variant="solid"
        className="mb-4"
        value={tab}
        onChange={setTab}
        options={[{ value: "mine", label: "My sessions" }, { value: "all", label: "All sessions" }]}
      />
      {error && <div className="mb-3"><ErrorState message={error} /></div>}
      {tab === "mine" ? (
        <DataList columns={withKill} rows={mine.rows} error={mine.error} loading={mine.loading} rowKey={(r) => r.session_id} empty={{ title: "No active sessions", hint: "You're signed in on this device only." }} />
      ) : (
        <DataList columns={adminCols} rows={all.rows} error={all.error} loading={all.loading} rowKey={(r) => r.session_id} empty={{ title: "No sessions", hint: "Listing every tenant session needs the session view grant." }} />
      )}
    </section>
  );
}
