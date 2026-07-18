/**
 * Smart Comms (MOD-64, feature `comms`) — corporate WhatsApp-style channels.
 * Two-pane: channel list (search + new) | selected channel thread + composer.
 * Wired to `/smartcomm` (channels, messages, colleagues). Membership is enforced
 * server-side (you only see channels you belong to). Feature-gated → graceful
 * "enable it" state when `comms` is off. Design on the app's --primary tokens.
 */
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { Row, errMsg, cell, useList, Avatar } from "@/features/sales/ui";

const COMMS_AI: AiAction[] = [
  { label: "Search messages", kind: "assist", describe: "Search across your channels for a topic, decision or file." },
  { label: "Summarise channel", kind: "assist", describe: "Summarise the recent discussion in a channel into key points and actions." },
];

const CHANNEL_KINDS = ["DEPARTMENT", "PROJECT", "DOSSIER", "DIRECT", "CLIENT"];

function isGated(msg: string | null): boolean {
  return !!msg && /feature|not enabled|disabled|forbidden|permission/i.test(msg);
}

function timeLabel(v: unknown): string {
  if (!v) return "";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function NewChannelModal({ open, colleagues, onClose, onCreated }: { open: boolean; colleagues: Row[] | null; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState("DEPARTMENT");
  const [topic, setTopic] = React.useState("");
  const [members, setMembers] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setKind("DEPARTMENT");
    setTopic("");
    setMembers(new Set());
    setError(null);
  }, [open]);

  function toggle(id: string) {
    setMembers((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const row = await tenant<Row>("/smartcomm/channels", {
        method: "POST",
        body: { name: name.trim(), kind, topic: topic.trim() || undefined, member_ids: members.size ? Array.from(members) : undefined },
      });
      onCreated(String(row.group_id));
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New channel" description="A channel groups a conversation — a department, project, dossier or client thread." size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Operations — Douala" />
          </Field>
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {CHANNEL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.charAt(0) + k.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Topic" className="sm:col-span-2">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What this channel is for" />
          </Field>
        </div>
        <Field label="Members" hint="You're added automatically; pick colleagues to include">
          <div className="max-h-48 space-y-1 overflow-auto rounded-lg border p-2">
            {(colleagues || []).length === 0 ? (
              <p className="px-2 py-1 text-sm text-muted-foreground">No colleagues found.</p>
            ) : (
              (colleagues || []).map((c) => {
                const id = String(c.user_id);
                return (
                  <label key={id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted">
                    <input type="checkbox" checked={members.has(id)} onChange={() => toggle(id)} />
                    <span>{cell(c.full_name ?? c.email)}</span>
                  </label>
                );
              })
            )}
          </div>
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!name.trim() || busy}>
            Create channel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Composer({ channelId, onSent }: { channelId: string; onSent: () => void }) {
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await tenant(`/smartcomm/channels/${channelId}/messages`, { method: "POST", body: { body: text } });
      setBody("");
      onSent();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t p-3">
      {error && (
        <div className="mb-2">
          <ErrorState message={error} />
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Write a message…  (Enter to send, Shift+Enter for a new line)"
          className="max-h-32 flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm"
        />
        <Button onClick={send} loading={busy} disabled={!body.trim() || busy}>
          Send
        </Button>
      </div>
    </div>
  );
}

export function SmartCommsPage() {
  const [nonce, setNonce] = React.useState(0);
  const reloadChannels = () => setNonce((n) => n + 1);
  const { rows: channels, error } = useList("/smartcomm/channels", nonce);
  const { rows: colleagues } = useList("/smartcomm/colleagues", nonce);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [threadNonce, setThreadNonce] = React.useState(0);
  const [q, setQ] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);

  const { rows: messages, error: threadError } = useList(activeId ? `/smartcomm/channels/${activeId}/messages` : "/smartcomm/channels", threadNonce, !!activeId);

  const nameOf = React.useMemo(() => new Map((colleagues || []).map((c) => [String(c.user_id), cell(c.full_name ?? c.email)])), [colleagues]);
  const active = React.useMemo(() => (channels || []).find((c) => String(c.group_id) === activeId) || null, [channels, activeId]);
  const gated = isGated(error);

  const shownChannels = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = channels || [];
    if (!term) return list;
    return list.filter((c) => [c.name, c.topic].some((v) => String(v ?? "").toLowerCase().includes(term)));
  }, [channels, q]);

  // Oldest → newest for display (the API returns newest first).
  const ordered = React.useMemo(() => [...(messages || [])].reverse(), [messages]);

  function openChannel(id: string) {
    setActiveId(id);
    setThreadNonce((n) => n + 1);
    tenant(`/smartcomm/channels/${id}/read`, { method: "POST" })
      .then(() => reloadChannels())
      .catch(() => {});
  }
  const afterSend = () => {
    setThreadNonce((n) => n + 1);
    reloadChannels();
  };

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Smart Comms</h1>
          <p className="mt-1 text-sm text-muted-foreground">Formal corporate channels — departments, projects, dossiers and client threads.</p>
        </div>
        {!gated && <Button onClick={() => setNewOpen(true)}>New channel</Button>}
      </header>

      {gated ? (
        <EmptyState title="Smart Comms isn't enabled" hint="The `comms` feature flag is off for this tenant (or you lack access)." />
      ) : error ? (
        <ErrorState message={error} />
      ) : channels === null ? (
        <LoadingRow label="Loading channels…" />
      ) : (
        <div className="grid h-[calc(100vh-13rem)] grid-cols-1 gap-3 md:grid-cols-[300px_1fr]">
          {/* Channel list */}
          <div className="flex min-h-0 flex-col rounded-xl border">
            <div className="border-b p-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels…" />
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1">
              {shownChannels.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">{(channels || []).length ? "No channels match." : "No channels yet — create one."}</p>
              ) : (
                shownChannels.map((c) => {
                  const id = String(c.group_id);
                  const unread = Number(c.unread ?? 0) || 0;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => openChannel(id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${activeId === id ? "bg-primary/10" : "hover:bg-muted"}`}
                    >
                      <Avatar name={String(c.name || "#")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{cell(c.name)}</span>
                          {unread > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">{unread}</span>}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{cell(c.topic) === "—" ? String(c.kind ?? "").toLowerCase() : cell(c.topic)}</p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Thread */}
          <div className="flex min-h-0 flex-col rounded-xl border">
            {!active ? (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState title="Pick a channel" hint="Choose a channel on the left to read and reply." />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 border-b p-3">
                  <Avatar name={String(active.name || "#")} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{cell(active.name)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {String(active.kind ?? "").toLowerCase()}
                      {cell(active.topic) !== "—" ? ` · ${cell(active.topic)}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex min-h-0 flex-1 flex-col-reverse overflow-auto p-3">
                  {/* flex-col-reverse keeps the latest message in view; render newest→oldest */}
                  {threadError ? (
                    <ErrorState message={threadError} />
                  ) : messages === null ? (
                    <LoadingRow label="Loading messages…" />
                  ) : ordered.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">No messages yet. Say hello.</p>
                  ) : (
                    [...ordered].reverse().map((m) => {
                      const id = String(m.message_id);
                      const deleted = !!m.deleted_at;
                      return (
                        <div key={id} className="mb-3 flex gap-2">
                          <Avatar name={nameOf.get(String(m.sender_user_id)) ?? "?"} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                              <span className="text-sm font-medium text-foreground">{nameOf.get(String(m.sender_user_id)) ?? "Someone"}</span>
                              <span className="text-[11px] text-muted-foreground">{timeLabel(m.created_at)}</span>
                              {m.edited_at && !deleted ? <span className="text-[11px] text-muted-foreground">(edited)</span> : null}
                            </div>
                            <p className={`whitespace-pre-wrap text-sm ${deleted ? "italic text-muted-foreground" : "text-foreground"}`}>{deleted ? "(message deleted)" : cell(m.body)}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <Composer channelId={String(active.group_id)} onSent={afterSend} />
              </>
            )}
          </div>
        </div>
      )}

      <div className="mt-5">
        <AiActions actions={COMMS_AI} />
      </div>

      <NewChannelModal
        open={newOpen}
        colleagues={colleagues}
        onClose={() => setNewOpen(false)}
        onCreated={(id) => {
          reloadChannels();
          openChannel(id);
        }}
      />
    </section>
  );
}
