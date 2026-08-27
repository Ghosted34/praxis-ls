/**
 * The rich composer as a NEW MESSAGE, opened from anywhere in the product.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * There are two composers. The rich one (./index.tsx) has drafts, attachments,
 * the undo window, slash commands and the guardrail bar — and it could only be
 * opened as a REPLY, from inside a thread. Every "compose" entry point in the
 * product opened the older modal in `features/comms/mail.tsx`, which cannot
 * attach a file at all.
 *
 * That was invisible until a document needed to be emailed WITH ITS PDF. There
 * was no path: the rich composer could carry the attachment but had no
 * new-message mode, and the modal that had a new-message mode could not carry
 * the attachment.
 *
 * ── Why the mailbox picker lives here and not in the composer ───────────────
 *
 * A reply already knows its mailbox — it is the one the thread arrived on. A
 * new message does not, so somebody has to choose, and the composer should not
 * grow a second identity as a mailbox chooser. This wrapper answers "from
 * where" and hands the composer a decided `connectionId`.
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/modal";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { Callout } from "@/components/ui/callout";
import { useResource } from "@/lib/use-resource";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";
import type { ExtraRecipient } from "./recipient-field";

/* TipTap and ProseMirror are ~150 kB gzipped. A document page that nobody
   emails should not pay for them — same reasoning as thread-view's lazy
   import, and the reason this wrapper is not in the same chunk. */
const Composer = React.lazy(() =>
  import("./index").then((m) => ({ default: m.Composer })),
);

export function NewMessageDialog({
  open,
  onClose,
  onSent,
  title,
  to = [],
  cc = [],
  subject = null,
  bodyText = null,
  vaultAttachments = [],
  recipientExtras = [],
  entityRef = null,
  languageNote = null,
}: {
  open: boolean;
  onClose: () => void;
  onSent?: () => void;
  title?: string;
  to?: string[];
  cc?: string[];
  subject?: string | null;
  bodyText?: string | null;
  vaultAttachments?: { vault_id: string; filename?: string | null }[];
  recipientExtras?: ExtraRecipient[];
  /** Files the message to a record — the thread then shows on that record. */
  entityRef?: string | null;
  /**
   * Which language the attachment and the covering note came out in.
   *
   * Stated because the control that chose it is on the page BEHIND this dialog.
   * An operator who opens the composer and cannot tell whether the PDF is
   * French has to close it, look, and press Send again — which renders a second
   * document. One line of text is cheaper than that.
   */
  languageNote?: string | null;
}) {
  const conns = useResource(() => api.listConnections(), []);
  const connected = (conns.data || []).filter((c) => c.status === "CONNECTED");
  const [connId, setConnId] = React.useState("");

  React.useEffect(() => {
    if (connId) return;
    const preferred =
      connected.find((c) => c.is_default)?.email_connection_id
      || connected[0]?.email_connection_id
      || "";
    if (preferred) setConnId(preferred);
  }, [connected, connId]);

  if (!open) return null;

  return (
    <Dialog open onClose={onClose} size="lg" title={title || tr("New message")}>
      <div className="space-y-3">
        {conns.error && <ErrorState message={conns.error} />}

        {!conns.loading && !connected.length && (
          /* Not an error — nothing is broken, the person simply has no mailbox
             yet. It names the screen that fixes it rather than saying "no
             connections", which is a fact about our schema, not about them. */
          <Callout tone="warn" title={tr("No mailbox connected")}>
            {tr("Connect your mailbox under Comms → Setup, then send from here.")}
          </Callout>
        )}

        {connected.length > 1 && (
          <Field label={tr("From mailbox")}>
            <Select value={connId} onChange={(e) => setConnId(e.target.value)}>
              {connected.map((c) => (
                <option key={c.email_connection_id} value={c.email_connection_id}>
                  {c.email_address}{c.is_default ? ` (${tr("default")})` : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {languageNote && (
          <p className="text-xs text-muted-foreground">{languageNote}</p>
        )}

        {conns.loading && <LoadingRow label={tr("Finding your mailbox…")} />}

        {connId && (
          <React.Suspense fallback={<LoadingRow label={tr("Opening the composer…")} />}>
            <div className="rounded-lg border border-border">
              <Composer
                connectionId={connId}
                kind="NEW"
                initialTo={to}
                initialCc={cc}
                initialSubject={subject}
                initialBodyText={bodyText}
                initialVaultAttachments={vaultAttachments}
                recipientExtras={recipientExtras}
                entityRef={entityRef}
                onClose={onClose}
                onSent={() => { onSent?.(); onClose(); }}
              />
            </div>
          </React.Suspense>
        )}
      </div>
    </Dialog>
  );
}
