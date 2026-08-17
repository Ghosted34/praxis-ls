/**
 * Client support — the account team's side of the client portal (MOD-67):
 * the message thread for a chosen client (reply from here) and their
 * onboarding checklist (tick steps off as they complete). The client sees
 * both in their portal; this is where the tenant's half of the conversation
 * happens.
 */
import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { tenant } from "@/lib/api-client";
import { errMsg, useList } from "@/lib/use-resource";
import { dateFmt } from "@/lib/format";

type ClientRow = { client_id: string; name?: string; legal_name?: string };
type Message = {
  message_id: string;
  direction: "STAFF" | "CLIENT";
  body: string;
  author_name: string | null;
  author_email: string | null;
  created_at: string;
};
type Onboarding = {
  client_id: string;
  progress: number;
  steps: {
    step_key: string;
    label_en: string;
    label_fr: string;
    done: boolean;
    done_at: string | null;
  }[];
};

export function ClientSupportPage() {
  const { rows: clients } = useList<ClientRow>("/clients");
  const [clientId, setClientId] = React.useState("");
  const [msgs, setMsgs] = React.useState<Message[] | null>(null);
  const [onb, setOnb] = React.useState<Onboarding | null>(null);
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(
    (id: string) => {
      if (!id) return;
      setMsgs(null);
      setOnb(null);
      setError(null);
      tenant<Message[]>(`/portal/messages?client_id=${encodeURIComponent(id)}`)
        .then(setMsgs)
        .catch((e) => setError(errMsg(e)));
      tenant<Onboarding>(`/portal/onboarding?client_id=${encodeURIComponent(id)}`)
        .then(setOnb)
        .catch((e) => setError(errMsg(e)));
    },
    [],
  );

  async function reply() {
    const body = draft.trim();
    if (!body || !clientId) return;
    setBusy("reply");
    setError(null);
    try {
      await tenant("/portal/messages", {
        method: "POST",
        body: { client_id: clientId, body },
      });
      setDraft("");
      load(clientId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggleStep(stepKey: string) {
    if (!clientId) return;
    setBusy(`step:${stepKey}`);
    setError(null);
    try {
      await tenant(`/portal/onboarding/${clientId}/${stepKey}`, {
        method: "POST",
      });
      load(clientId);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const clientName = (id: string) => {
    const c = (clients || []).find((x) => x.client_id === id);
    return c?.name || c?.legal_name || id.slice(0, 8);
  };

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title="Client support"
        description="Message a client's portal account and track their onboarding."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted-foreground" htmlFor="client-pick">
          Client
        </label>
        <select
          id="client-pick"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            load(e.target.value);
          }}
          className="max-w-sm rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="">— choose a client —</option>
          {(clients || []).map((c) => (
            <option key={c.client_id} value={c.client_id}>
              {c.name || c.legal_name || c.client_id.slice(0, 8)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      {!clientId ? (
        <EmptyState
          title="Choose a client"
          hint="Their portal messages and onboarding checklist will appear here."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title={`Messages · ${clientName(clientId)}`}>
            {msgs === null ? (
              <SkeletonTable />
            ) : msgs.length === 0 ? (
              <EmptyState
                title="No messages"
                hint="Messages the client sends from the portal appear here."
              />
            ) : (
              <div className="mb-3 max-h-72 space-y-2 overflow-auto">
                {msgs.map((m) => (
                  <div
                    key={m.message_id}
                    className={`rounded-xl px-3 py-2 text-sm ${
                      m.direction === "STAFF"
                        ? "ml-6 bg-primary/10 text-foreground"
                        : "mr-6 bg-card text-foreground"
                    }`}
                  >
                    <div className="mb-0.5 text-[11px] text-muted-foreground">
                      {m.direction === "STAFF"
                        ? m.author_name || "You"
                        : m.author_email || "Client"}{" "}
                      · {dateFmt(m.created_at)}
                    </div>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              maxLength={4000}
              placeholder="Reply to the client…"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <Button
              size="sm"
              className="mt-2"
              disabled={!draft.trim()}
              loading={busy === "reply"}
              onClick={() => void reply()}
            >
              Send reply
            </Button>
          </Panel>

          <Panel title={`Onboarding · ${clientName(clientId)}`}>
            {onb === null ? (
              <SkeletonTable />
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium text-foreground">
                    {onb.progress}%
                  </span>
                </div>
                <div className="mb-4 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${onb.progress}%` }}
                  />
                </div>
                <ul className="space-y-2">
                  {onb.steps.map((s) => (
                    <li key={s.step_key}>
                      <button
                        type="button"
                        disabled={busy === `step:${s.step_key}`}
                        onClick={() => void toggleStep(s.step_key)}
                        className="flex w-full items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2 text-left transition-colors hover:opacity-80 disabled:opacity-50"
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                            s.done
                              ? "bg-[rgb(var(--ok))] text-white"
                              : "border border-border text-muted-foreground"
                          }`}
                        >
                          {s.done ? "✓" : ""}
                        </span>
                        <span
                          className={
                            s.done
                              ? "flex-1 text-sm text-muted-foreground line-through"
                              : "flex-1 text-sm text-foreground"
                          }
                        >
                          {s.label_en}
                        </span>
                        {s.done_at && (
                          <span className="text-[11px] text-muted-foreground">
                            {dateFmt(s.done_at)}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        </div>
      )}
    </section>
  );
}

export default ClientSupportPage;
