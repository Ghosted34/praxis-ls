import * as React from "react";
import { scheduleInstant } from "./schedule-time";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/datetime-field";
import { Field } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import * as api from "@/lib/smartcomm-api";
import { MessageText } from "./message-text";

const timezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export function ScheduledMessages({
  channelId,
  open,
  onClose,
  canSchedule,
  onSchedule,
  busy,
}: {
  channelId: string;
  open: boolean;
  onClose: () => void;
  canSchedule: boolean;
  onSchedule: (sendAt: string, tz: string) => Promise<boolean>;
  busy: boolean;
}) {
  const toast = useToast();
  const [rows, setRows] = React.useState<api.ScheduledMessage[]>([]);
  const [when, setWhen] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRows(await api.listScheduledMessages(channelId));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [channelId]);
  React.useEffect(() => {
    if (!open) return;
    setWhen("");
    setEditing(null);
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [open, load]);
  async function save() {
    const instant = scheduleInstant(when);
    if (!instant || saving || busy) return;
    setSaving(true);
    try {
      if (editing) {
        await api.rescheduleMessage(editing, instant, timezone());
        setEditing(null);
        setWhen("");
        await load();
      } else if (await onSchedule(instant, timezone())) onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }
  async function cancel(id: string) {
    setSaving(true);
    try {
      await api.cancelScheduledMessage(id);
      if (editing === id) setEditing(null);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy && !saving) onClose();
      }}
      title={tr("Scheduled messages")}
      description={tr(
        "Server-delivered in LIVE, even when the app is closed. Delivery normally starts within 30 seconds of the chosen time; outages may delay it.",
      )}
    >
      <div className="space-y-4">
        <section className="space-y-3 rounded-xl border border-border p-3">
          <h3 className="text-sm font-semibold">
            {tr(editing ? "Reschedule message" : "Schedule current message")}
          </h3>
          <Field label={`${tr("Send at")} · ${timezone()}`}>
            <DateTimeField
              value={when}
              onChange={setWhen}
              disabled={busy || saving}
            />
          </Field>
          <p className="micro">
            {tr(
              "Time uses your device timezone. During a repeated daylight-saving hour, the first occurrence is used.",
            )}
          </p>
          {when && !scheduleInstant(when) && (
            <p role="alert" className="text-sm text-muted-foreground">
              {tr("Choose a valid future time.")}
            </p>
          )}
          {!canSchedule && !editing && (
            <p className="micro">
              {tr(
                "Write a message or finish attaching files before scheduling.",
              )}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {editing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(null)}
              >
                {tr("Cancel edit")}
              </Button>
            )}
            <Button
              size="sm"
              loading={busy || saving}
              disabled={!scheduleInstant(when) || (!editing && !canSchedule)}
              onClick={save}
            >
              {tr(editing ? "Save schedule" : "Schedule message")}
            </Button>
          </div>
        </section>
        <h3 className="text-sm font-semibold">
          {tr("Your scheduled messages in this conversation")}
        </h3>
        {error ? (
          <div role="alert">
            {error}
            <Button size="sm" onClick={load}>
              {tr("Retry")}
            </Button>
          </div>
        ) : loading && !rows.length ? (
          <p className="micro">{tr("Loading…")}</p>
        ) : !rows.length ? (
          <p className="micro">{tr("No scheduled messages yet.")}</p>
        ) : (
          rows.map((row) => (
            <article
              key={row.schedule_id}
              className="space-y-2 rounded-xl border border-border p-3 text-sm"
            >
              <div className="max-h-32 overflow-y-auto">
                <MessageText body={row.body || tr("Attachment message")} />
              </div>
              {!!row.attachments.length && (
                <p className="micro">
                  {row.attachments
                    .map(
                      (a) =>
                        ("filename" in a && a.filename) ||
                        ("erp_label" in a && a.erp_label) ||
                        tr("Attachment"),
                    )
                    .join(" · ")}
                </p>
              )}
              <p className="micro">
                {new Date(row.send_at).toLocaleString("en-GB", {
                  timeZone: row.timezone,
                  dateStyle: "short",
                  timeStyle: "short",
                })}{" "}
                · {row.timezone} · {tr(row.status.toLowerCase())}
              </p>
              {row.last_error && (
                <p role="status" className="micro">
                  {row.last_error}
                </p>
              )}
              {(row.status === "PENDING" || row.status === "FAILED") && (
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving || busy}
                    onClick={() => {
                      setEditing(row.schedule_id);
                      setWhen("");
                    }}
                  >
                    {tr("Reschedule")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving || busy}
                    onClick={() => cancel(row.schedule_id)}
                  >
                    {tr("Cancel scheduled message")}
                  </Button>
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </Dialog>
  );
}
