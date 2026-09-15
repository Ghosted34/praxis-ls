/**
 * Forwarding a message to another channel.
 *
 * ── IT RE-POSTS, IT DOES NOT RE-UPLOAD ────────────────────────────────────
 *
 * The new message points at the SAME `comms_media` row and the same vault
 * document. Copying the bytes would double the storage for every forward and,
 * worse, give the copy a different `content_hash` — so a vault document
 * forwarded into a second channel would no longer verify against the signature
 * taken over the original. `document_verification` compares those two, and the
 * one thing this must not do is create a second artefact that looks like the
 * first and hashes differently.
 *
 * ── AN ERP REFERENCE FORWARDS AS A REFERENCE ──────────────────────────────
 *
 * Which is the whole reason it is a reference. The recipient in the new channel
 * resolves it against THEIR permissions: forwarding an invoice card into a
 * channel of people who cannot see invoices shows them the number and no
 * figures, rather than leaking what the sender could see.
 *
 * ── AND IT IS MARKED AS FORWARDED ─────────────────────────────────────────
 *
 * A prefix on the body, not a schema column. The alternative is a message that
 * reads as though the forwarder wrote it — which for an instruction ("ship it
 * tomorrow") is how somebody ends up acting on the authority of a person who
 * never said it to them.
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import * as api from "@/lib/smartcomm-api";
import type { Channel, CommMessage } from "@/lib/smartcomm-api";
import { forwardableAttachments } from "./forward-attachments";


/**
 * Focus this element once, on mount.
 *
 * Not the `autoFocus` attribute: that is banned by `jsx-a11y/no-autofocus`
 * because on a PAGE it yanks focus from wherever the reader was. Inside a panel
 * the reader has just opened by pressing a button, moving focus in is the
 * correct behaviour — and doing it in an effect makes that distinction explicit
 * rather than hiding it behind an attribute that means both things.
 */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  React.useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

export function ForwardDialog({
  message,
  channels,
  currentChannelId,
  onClose,
  onForwarded,
}: {
  message: CommMessage | null;
  channels: Channel[];
  currentChannelId: string;
  onClose: () => void;
  onForwarded: () => void;
}) {
  const toast = useToast();
  const [term, setTerm] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const searchRef = useFocusOnMount<HTMLInputElement>();

  React.useEffect(() => {
    if (message) { setTerm(""); setSelected([]); }
  }, [message]);

  if (!message) return null;

  const options = channels
    .filter((c) => c.group_id !== currentChannelId)
    .filter((c) => !term.trim() || c.name.toLowerCase().includes(term.trim().toLowerCase()));

  const attachments = forwardableAttachments(message);
  const body = message.body
    ? `${tr("Forwarded")}: ${message.body}`
    : attachments.length
      ? tr("Forwarded")
      : "";

  async function forward() {
    if (!selected.length || busy) return;
    setBusy(true);
    // Each target gets its own post. A partial failure leaves the ones that
    // worked in place and names the ones that did not — silently rolling all of
    // them back would be a worse answer for somebody forwarding to six channels.
    const failures: string[] = [];
    for (const groupId of selected) {
      try {
        // Sequential on purpose: a burst of parallel posts to one tenant is
        // rate-limited, and six forwards arriving as one 429 is worse than six
        // that take a moment.
        await api.postMessage(groupId, body, { attachments });
      } catch {
        /* @silent:network — collected and reported together below */
        failures.push(channels.find((c) => c.group_id === groupId)?.name || groupId);
      }
    }
    setBusy(false);
    if (failures.length) {
      toast.error(
        tr("Couldn't forward to") + " " + failures.join(", "),
      );
    } else {
      toast.success(
        selected.length > 1
          ? `${tr("Forwarded to")} ${selected.length} ${tr("conversations")}`
          : tr("Forwarded"),
      );
    }
    if (failures.length < selected.length) onForwarded();
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={tr("Forward to")}
      size="md"
      footer={
        <>
          <Button variant="ghost" icon={null} onClick={onClose}>{tr("Cancel")}</Button>
          <Button onClick={forward} loading={busy} disabled={!selected.length} icon={null}>
            {selected.length > 1 ? `${tr("Forward to")} ${selected.length}` : tr("Forward")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={tr("Search conversations…")}
          aria-label={tr("Search conversations")}
          ref={searchRef}
        />
        <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border">
          {options.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              {tr("No other conversations to forward to.")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {options.map((c) => {
                const on = selected.includes(c.group_id);
                return (
                  <li key={c.group_id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setSelected((s) =>
                          s.includes(c.group_id) ? s.filter((x) => x !== c.group_id) : [...s, c.group_id],
                        )
                      }
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                        on ? "bg-primary/10 text-primary-ink" : "hover:bg-accent/60",
                      )}
                    >
                      <span aria-hidden className="w-4 shrink-0">{on ? "✓" : ""}</span>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {c.kind && (
                        <span className="shrink-0 text-micro text-muted-foreground">
                          {c.kind.toLowerCase()}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <p className="text-micro text-muted-foreground">
          {tr("Attachments are forwarded as references — the file itself is not copied, and a record card still checks the reader's own access.")}
        </p>
      </div>
    </Dialog>
  );
}
