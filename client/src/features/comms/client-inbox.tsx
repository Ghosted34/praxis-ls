/**
 * Client inbox — every client's portal conversations in one place (client
 * portal PR 3). Comms › Clients.
 *
 * What the account team opens in the morning: the conversations waiting for
 * an answer first, then the rest by latest activity — General and one per
 * shipment, for every client, with who looks after each client. Three filters,
 * each with its count: Waiting, Mine (the clients I look after and the files I
 * own), All. Pick a conversation and it opens on the right, with the client's
 * account manager above it and the reply box below — the same panel as a
 * client's own Messages tab, so a reply looks the same wherever it was sent.
 *
 * Deep links — `?client=<id>&thread=<general|dossier id>` — are what the
 * team's alert for a new client message points at, so a tap on the
 * notification lands on the conversation itself.
 *
 * Gated on MOD-64C (the Client inbox permission, seeds 90997/9136): the
 * people who answer clients.
 */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { useResource } from "@/lib/use-resource";
import { dateTimeFmt } from "@/lib/format";
import { useIsDesktop } from "@/lib/use-media-query";
import { Chips } from "@/components/ui/chips";
import { Pill } from "@/components/ui/pill";
import { IndexRow } from "@/components/ui/index-row";
import { SplitPane } from "@/components/ui/split-pane";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { ClientChatPanel } from "@/features/portal/client-chat-panel";
import { AccountManagerCard } from "@/features/portal/account-manager";

type Filter = "waiting" | "mine" | "all";

export type InboxItem = {
  client_id: string;
  client_name: string;
  thread: string;
  dossier_id: string | null;
  dossier_ref: string | null;
  unread: number;
  waiting_since: string | null;
  last: {
    direction: "CLIENT" | "STAFF";
    preview: string | null;
    kind: string;
    at: string;
    /** The colleague at the client who wrote it (a client message only). */
    author?: { name: string | null; email: string | null } | null;
  };
  manager: { user_id: string; name: string | null } | null;
  mine: boolean;
};
/** `truncated`: the server read its limit, so the list and counts stop there. */
type Inbox = { filter: Filter; counts: Record<Filter, number>; items: InboxItem[]; truncated?: boolean };

/** Refreshed this often while the tab is visible — a client's question is not an email. */
const POLL_MS = 30_000;

const KIND: Record<string, string> = {
  IMAGE: "Photo",
  FILE: "Document",
  VOICE: "Voice note",
  LOCATION: "Location",
  TEXT: "Message",
};

/** "Paul Atiock · can you quote…" / "Team · done" — who wrote it, then the line. */
function lastLine(i: InboxItem): string {
  const what = i.last.preview || tr(KIND[i.last.kind] || KIND.TEXT);
  const who =
    i.last.direction === "CLIENT" ? (i.last.author && (i.last.author.name || i.last.author.email)) || tr("Client") : tr("Team");
  return `${who} · ${what}`;
}

export function ClientInboxPage() {
  const isDesktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = React.useState<Filter>("waiting");
  const [openKey, setOpenKey] = React.useState<{ client: string; thread: string } | null>(() => {
    const client = params.get("client");
    return client ? { client, thread: params.get("thread") || "general" } : null;
  });
  const inbox = useResource(() => tenant<Inbox>(`/portal/chat/inbox?filter=${filter}`), [filter], { fresh: true });

  // A notification's link opens the conversation, then leaves the URL clean.
  React.useEffect(() => {
    if (!params.get("client")) return;
    // Opened for one conversation: show it whatever the filter.
    setFilter("all");
    params.delete("client");
    params.delete("thread");
    setParams(params, { replace: true });
  }, [params, setParams]);

  const reload = inbox.reload;
  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [reload]);

  const items = inbox.data?.items || [];
  const counts = inbox.data?.counts;
  const open = openKey ? items.find((i) => i.client_id === openKey.client && i.thread === openKey.thread) || null : null;

  const options = (["waiting", "mine", "all"] as Filter[]).map((f) => ({
    value: f,
    label: f === "waiting" ? tr("Waiting") : f === "mine" ? tr("Mine") : tr("All"),
    count: counts ? counts[f] || undefined : undefined,
  }));

  return (
    <div className="grid gap-4">
      <Chips label={tr("Show")} value={filter} options={options} onChange={(v) => setFilter(v as Filter)} />
      {/* On a phone the list is the page and a conversation opens as a sheet
          over it (onClose), rather than underneath every other conversation. */}
      <SplitPane
        storageKey="comms.clients"
        label={tr("Conversation list width")}
        defaultSize={340}
        min={260}
        max={520}
        activeKind={tr("Conversation")}
        active={!!openKey}
        onClose={() => setOpenKey(null)}
        sheetTitle={open ? open.client_name : null}
      >
        <div className="space-y-1">
          {inbox.error ? (
            <ErrorState message={inbox.error} />
          ) : inbox.loading ? (
            <LoadingRow label={tr("Loading conversations…")} />
          ) : !items.length ? (
            <EmptyState
              title={filter === "waiting" ? tr("Nothing waiting — every client has an answer") : tr("No conversations")}
              hint={filter === "mine" ? tr("Your clients are the ones you look after, and the files you own.") : undefined}
            />
          ) : (
            items.map((i) => (
              <IndexRow
                key={`${i.client_id}:${i.thread}`}
                selected={!!openKey && openKey.client === i.client_id && openKey.thread === i.thread}
                onClick={() => setOpenKey({ client: i.client_id, thread: i.thread })}
                className="flex-col items-stretch gap-1"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold">{i.client_name}</span>
                  {i.unread ? <Pill tone="orange">{String(i.unread)}</Pill> : null}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="shrink-0 font-medium">{i.dossier_ref || tr("General")}</span>
                  <span className="truncate">{lastLine(i)}</span>
                </span>
                <span className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{i.manager ? i.manager.name || tr("Account manager") : tr("No account manager")}</span>
                  <span className="shrink-0">{dateTimeFmt(i.last.at)}</span>
                </span>
              </IndexRow>
            ))
          )}
          {inbox.data?.truncated ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {tr("Showing the most recent conversations — older ones are on each client's Messages tab.")}
            </p>
          ) : null}
        </div>
        {openKey ? (
          <div className="grid gap-3">
            <div>
              {/* The phone sheet already carries the client's name as its title. */}
              {isDesktop ? <h2 className="text-lg font-semibold text-foreground">{open ? open.client_name : tr("Conversation")}</h2> : null}
              <p className="text-sm text-muted-foreground">{open ? open.dossier_ref || tr("General") : null}</p>
            </div>
            <AccountManagerCard clientId={openKey.client} onChange={reload} />
            <ClientChatPanel key={`${openKey.client}:${openKey.thread}`} clientId={openKey.client} initialThread={openKey.thread} onActivity={reload} />
          </div>
        ) : (
          <EmptyState title={tr("No conversation open")} hint={tr("Choose one from the list.")} />
        )}
      </SplitPane>
    </div>
  );
}
