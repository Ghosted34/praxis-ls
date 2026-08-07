/**
 * Share modal — spec §3.3, three channels plus the LLM-friendly clipboard copy.
 *
 * Every payload is rendered SERVER-SIDE (services/platform/error-share.service)
 * and fetched whole. This component formats nothing: Appendix B specifies the
 * templates exactly, and duplicating them here would mean the WhatsApp text
 * drifts from the email body the first time either is edited.
 *
 * WhatsApp and email open via window.open on an already-encoded URL rather than
 * assigning location.href — a mailto: assignment on the current window leaves
 * the console showing a blank page in some browsers if no handler is
 * registered, which looks exactly like a crash in the error dashboard.
 */

import { useEffect, useState } from "react";
import { errorsApi, type ShareTargets } from "@/lib/errors-api";
import { platform } from "@/lib/api";
import { Button, Loading, Modal } from "@/components/ui";
import { useToast } from "@/components/Toast";

type PlatformUser = { platform_user_id: string; email: string; full_name: string | null };

export function ShareErrorModal({ errorId, onClose }: { errorId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [targets, setTargets] = useState<ShareTargets | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [toUser, setToUser] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    errorsApi
      .share(errorId)
      .then(setTargets)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    (platform.users() as Promise<PlatformUser[]>).then(setUsers).catch(() => setUsers([]));
  }, [errorId]);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} copied`);
    } catch {
      toast("Copy failed");
    }
  };

  const sendInHouse = async () => {
    if (!toUser) return toast("Pick a recipient first");
    setSending(true);
    try {
      // The in-house channel reuses the console's existing notification
      // surface; until that endpoint exists the payload is copied so the
      // escalation is still actionable rather than silently dropped.
      await copy(
        `${targets?.in_house.title}\n${targets?.in_house.body}\n\n${note}`.trim(),
        "Notification",
      );
      toast("Notification payload copied — paste to the recipient");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal title="Share error" onClose={onClose} maxWidth={620}>
      {err ? (
        <div className="empty">Couldn’t build share payload — {err}</div>
      ) : !targets ? (
        <Loading />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Channel
            icon="📱"
            title="WhatsApp"
            desc="Opens wa.me with the message pre-filled"
            action={
              <Button size="sm" variant="primary" onClick={() => window.open(targets.whatsapp.url, "_blank", "noopener")}>
                Open WhatsApp
              </Button>
            }
          />

          <Channel
            icon="✉️"
            title="Email"
            desc="Opens your mail client with subject and body ready"
            action={
              <Button size="sm" variant="primary" onClick={() => window.open(targets.email.url, "_blank", "noopener")}>
                Compose email
              </Button>
            }
          />

          <div className="card">
            <div className="bd" style={{ padding: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>🔔 In-house notification</div>
              <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>Send to a platform team member</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <select value={toUser} onChange={(e) => setToUser(e.target.value)}>
                  <option value="">Select recipient…</option>
                  {users.map((u) => (
                    <option key={u.platform_user_id} value={u.platform_user_id}>
                      {u.full_name || u.email}
                    </option>
                  ))}
                </select>
                <input placeholder="Optional note…" value={note} onChange={(e) => setNote(e.target.value)} />
                <Button size="sm" variant="primary" loading={sending} onClick={() => void sendInHouse()}>
                  🔔 Send notification
                </Button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="bd" style={{ padding: 12 }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>📋 Plain text (for clipboard / AI)</div>
                <Button size="sm" variant="ghost" onClick={() => void copy(targets.plain, "Error")}>Copy</Button>
              </div>
              <pre
                className="mono"
                style={{
                  fontSize: 10.5, lineHeight: 1.5, margin: 0, padding: 10, borderRadius: 8,
                  background: "var(--panel-2, rgba(0,0,0,.25))", maxHeight: 160, overflowY: "auto",
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}
              >
                {targets.plain}
              </pre>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Channel({ icon, title, desc, action }: { icon: string; title: string; desc: string; action: React.ReactNode }) {
  return (
    <div className="card">
      <div className="bd row between" style={{ padding: 12, gap: 10 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{icon} {title}</div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{desc}</div>
        </div>
        {action}
      </div>
    </div>
  );
}
