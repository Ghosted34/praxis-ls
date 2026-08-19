/**
 * Comms → Setup → Send points (administrators).
 *
 * Every place the product sends mail, what each one currently sends from, and —
 * in its own column — WHY.
 *
 * ── THE "WHY" COLUMN IS THE FEATURE ─────────────────────────────────────────
 *
 * "Why did that go out from the wrong address?" is the most common question
 * anyone asks about email configuration, and answering it used to mean reading
 * a service and three tables. The server resolves each send point and returns a
 * sentence with the answer; this renders it verbatim. Bound directly, inherited
 * from a section sender, or falling back to the Praxis system sender — the row
 * says which, so nobody has to guess.
 *
 * ── AND WHY UNWIRED ROWS ARE LABELLED ───────────────────────────────────────
 *
 * Some send points are called by code today; others are declared because the
 * module exists and will mail from it. A screen listing twenty-two routable
 * events when only nine of them ever send is a screen that lies, and the
 * administrator finds out when a test message never arrives. So the ones nothing
 * calls yet say so.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Modal, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { Pill, type Tone } from "@/components/ui/pill";
import { PageHeader } from "@/components/data-list";
import { useResource, errMsg } from "@/lib/use-resource";
import { reportActionError } from "@/lib/action-error";
import * as api from "@/lib/mail-api";

const GROUP_LABEL: Record<string, string> = {
  FINANCE: "Finance",
  SALES: "Sales & commercial",
  OPERATIONS: "Operations",
  PROCUREMENT: "Procurement",
  HR: "People",
  SECURITY: "Sign-in & security",
  DOCUMENTS: "Documents",
  SYSTEM: "System",
};

const SOURCE_TONE: Record<string, Tone> = {
  ENTITY_BINDING: "ok",
  TENANT_BINDING: "ok",
  LEGACY_SECTION: "blue",
  LEGACY_PURPOSE: "blue",
  FALLBACK: "warn",
};
const SOURCE_LABEL: Record<string, string> = {
  ENTITY_BINDING: "Bound (this company)",
  TENANT_BINDING: "Bound",
  LEGACY_SECTION: "Inherited",
  LEGACY_PURPOSE: "Inherited",
  FALLBACK: "Not configured",
};

function BindModal({
  point, senders, mailboxes, onClose, onDone,
}: {
  point: api.SendPoint;
  senders: api.Sender[];
  mailboxes: api.Mailbox[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [choice, setChoice] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (!choice) {
        await api.unbindSendPoint(point.send_point_key);
      } else {
        const [kind, id] = choice.split(":");
        await api.bindSendPoint(point.send_point_key, {
          email_identity_id: kind === "identity" ? id : null,
          email_connection_id: kind === "mailbox" ? id : null,
        });
      }
      onDone(); onClose();
    } catch (err) { setError(err); reportActionError(err); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={point.label_en} description={point.description_en || undefined}>
      <form className="space-y-3" onSubmit={submit}>
        <div className="rounded-lg border border-border bg-card/40 px-3 py-2 text-sm">
          {point.resolved.why}
        </div>
        <Field
          label="Send this from"
          hint="Leave unset to inherit the section sender, then the Praxis system sender."
        >
          <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">— not set: inherit —</option>
            {senders.length > 0 && (
              <optgroup label="System sender identities">
                {senders.map((s) => (
                  <option key={s.email_identity_id} value={`identity:${s.email_identity_id}`}>
                    {s.from_address} ({s.purpose})
                  </option>
                ))}
              </optgroup>
            )}
            {mailboxes.length > 0 && (
              <optgroup label="Connected mailboxes">
                {mailboxes.map((m) => (
                  <option key={m.email_connection_id} value={`mailbox:${m.email_connection_id}`}>
                    {m.email_address}
                    {m.catalogue_label ? ` (${m.catalogue_label})` : ""}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        {!point.is_wired && (
          <p className="micro text-muted-foreground">
            Nothing in the product sends through this yet. Setting it now means it is already right
            when that part is built.
          </p>
        )}
        {error != null && <ErrorState message={errMsg(error)} />}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

export function SendPointsTab() {
  const points = useResource(() => api.listSendPoints(), []);
  const senders = useResource(() => api.listSenders(), []);
  const mailboxes = useResource(() => api.allMailboxes({ kind: "SHARED" }), []);
  const [editing, setEditing] = React.useState<api.SendPoint | null>(null);

  const rows = points.data || [];
  const groups = Array.from(new Set(rows.map((r) => r.group_key)));
  const unconfigured = rows.filter((r) => r.is_wired && r.resolved.source === "FALLBACK").length;

  return (
    <section className="space-y-5">
      <PageHeader
        title="Send points"
        description="Every place the product sends mail, and which address each one goes out from."
      />

      {points.error && <ErrorState message={points.error} />}

      <div className="rounded-lg border border-border bg-card/40 px-3 py-2 text-sm">
        A send point with no sender of its own falls back — first to the section sender for its
        purpose, then to the company&apos;s shared SMTP, then to the Praxis system sender. Nothing
        ever fails to send because a send point is unset.
        {unconfigured > 0 && (
          <>
            {" "}
            <strong>{unconfigured}</strong> of the send points the product actually uses are still on
            the fallback.
          </>
        )}
      </div>

      {groups.map((g) => (
        <div key={g}>
          <h3 className="text-sm font-medium">{GROUP_LABEL[g] || g}</h3>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {rows.filter((r) => r.group_key === g).map((r) => (
              <li key={r.send_point_key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">{r.label_en}</span>
                    {!r.is_wired && (
                      <span title="Declared for routing, but nothing in the product sends through it yet.">
                        <Pill tone="mute">not used yet</Pill>
                      </span>
                    )}
                  </div>
                  <div className="micro truncate text-muted-foreground">{r.resolved.why}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={SOURCE_TONE[r.resolved.source] || "mute"}>
                    {SOURCE_LABEL[r.resolved.source] || r.resolved.source}
                  </Pill>
                  <Button type="button" variant="outline" onClick={() => setEditing(r)}>Change</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {editing && (
        <BindModal
          point={editing}
          senders={senders.data || []}
          mailboxes={mailboxes.data || []}
          onClose={() => setEditing(null)}
          onDone={() => points.reload()}
        />
      )}
    </section>
  );
}
