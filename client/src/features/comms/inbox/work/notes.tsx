/**
 * INTERNAL THREAD NOTES (§7.8).
 *
 * A place for colleagues to say things to each other about a conversation, next
 * to the conversation, without those things being one wrong keystroke away from
 * the client.
 *
 * ── THE CONTAINMENT RULE ────────────────────────────────────────────────────
 *
 * A note is NEVER part of a message. Not quoted into a reply, not included in a
 * forward, not reachable by the AI's grounding whitelist — `email_thread_note`
 * is on that whitelist's permanent deny list, and `mail-notes-containment`
 * asserts it server-side.
 *
 * This component carries the client half: notes render in their own region,
 * visually distinct from the correspondence, with the boundary STATED rather
 * than implied by styling. Somebody eventually adds a "quote this" affordance
 * to anything that looks like a message, and the thing that stops them is
 * seeing, in the interface, that this is not one.
 *
 * ── MENTIONS REACH PEOPLE THROUGH THREE CHANNELS ────────────────────────────
 *
 * `@someone` in a note notifies them in-app, by email and in team chat. That
 * is the server's business; what matters here is that the operator can see who
 * they have mentioned before they post, because a mention is a message to a
 * person and posting one by accident is a small social cost you cannot undo.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LoadingRow, ErrorState, EmptyState } from "@/components/ui/states";
import { useResource } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import { dateTimeFmt } from "@/lib/format";
import * as api from "@/lib/mail-api";

/** Renders `@name` distinctly so the author can see who they addressed. */
function NoteBody({ body }: { body: string }) {
  const parts = body.split(/(@[\w.'-]+)/g);
  return (
    <p className="whitespace-pre-wrap text-sm">
      {parts.map((p, i) =>
        p.startsWith("@") ? (
          <span key={i} className="font-medium text-primary">
            {p}
          </span>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </p>
  );
}

export function ThreadNotes({ threadId }: { threadId: string }) {
  const notes = useResource(() => api.listNotes(threadId), [threadId]);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Cleared when the thread changes, or a half-typed note about one client
  // appears under another's conversation.
  React.useEffect(() => { setDraft(""); }, [threadId]);

  const live = (notes.data || []).filter((n) => !n.deleted_at);
  const mentions = Array.from(new Set((draft.match(/@[\w.'-]+/g) || [])));

  async function post() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      await api.addNote(threadId, { body });
      setDraft("");
      notes.reload();
    } catch (err) {
      reportActionError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Internal notes" className="space-y-2">
      {/* Stated, not implied. See the header — this sentence is what stops the
          next person adding a "quote in reply" button here. */}
      <p className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
        Internal only. Notes are never quoted into a reply or a forward, and the
        assistant cannot read them.
      </p>

      {notes.loading && <LoadingRow label="Loading notes…" />}
      {notes.error && <ErrorState message={notes.error} />}
      {!notes.loading && !notes.error && live.length === 0 && (
        <EmptyState title="No notes yet" />
      )}

      <ul className="space-y-1.5">
        {live.map((n) => (
          <li key={n.email_thread_note_id} className="rounded-lg border border-dashed border-border px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium">{n.author_name || "Someone"}</span>
              <span className="num text-xs text-muted-foreground">{dateTimeFmt(n.created_at)}</span>
            </div>
            <NoteBody body={n.body} />
          </li>
        ))}
      </ul>

      <div className="space-y-1.5">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Add a note for the team. Use @name to reach someone."
          aria-label="New internal note"
          className="text-sm"
        />
        {mentions.length > 0 && (
          // Shown BEFORE posting: a mention is a message to a person, and
          // sending one by accident is a small cost you cannot take back.
          <p className="text-xs text-muted-foreground">
            This will notify {mentions.join(", ")} in the app, by email and in
            team chat.
          </p>
        )}
        <Button size="sm" onClick={post} disabled={busy || !draft.trim()}>
          Add note
        </Button>
      </div>
    </section>
  );
}
